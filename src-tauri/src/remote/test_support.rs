//! `F220` S3's hermetic SFTP-serving test fixture — extends `session::tests`'
//! own "real `russh::server` on loopback, fixed test host key, real agent
//! server on a temp Unix socket" fixture with a real SFTP subsystem: any
//! channel that requests the `"sftp"` subsystem gets a real
//! `russh_sftp::server::run` loop backed by [`FixtureSftpHandler`], which
//! proxies every request directly onto the *real* local filesystem with no
//! virtual root or chroot of any kind — exactly how a real OpenSSH
//! `sftp-server` behaves (unrestricted; confinement is the *client's* job).
//! This lets `remote::remote_fs`'s own path re-validation
//! (`realpath`-under-`base_path`) be exercised against a genuine symlink
//! that really does point outside the served directory, using the real
//! wire protocol end to end — nothing about SFTP itself is mocked.
//!
//! Kept in its own module (rather than duplicated per test file, or folded
//! into `session::tests`) so both `session::tests` (S1, no subsystem) and
//! `remote_fs::tests` (S3, real SFTP) can each start exactly the shape of
//! fixture they need without the other's tests changing.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::keys::agent::client::AgentClient;
use russh::keys::agent::server as agent_server;
use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::ssh_key::PrivateKey;
use russh::server::Msg;
use russh::server::{
    Auth, ChannelOpenHandle, Handle as ServerHandle, Handler as ServerHandler,
    Server as ServerTrait, Session,
};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{FileAttributes, Handle, Name, OpenFlags, Status, StatusCode};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UnixListener};
use tokio::sync::Mutex as AsyncMutex;

use super::dto::{
    RemoteConnectTarget, RemoteHostKeyConfirmParts, RemoteSessionConnectResult, RemoteSessionId,
};
use super::session::{NullRemoteSessionEventSink, RemoteSessionEventSink, RemoteSessionService};

static KEY_SEED_COUNTER: AtomicU64 = AtomicU64::new(1_000_000);

pub(crate) fn generate_key() -> PrivateKey {
    let counter = KEY_SEED_COUNTER.fetch_add(1, Ordering::SeqCst);
    let mut seed = [0_u8; 32];
    seed[..8].copy_from_slice(&counter.to_le_bytes());
    PrivateKey::from(Ed25519Keypair::from_seed(&seed))
}

pub(crate) fn test_service() -> (TempDir, RemoteSessionService) {
    let temp = TempDir::new().expect("tempdir creates");
    let service = RemoteSessionService::new(temp.path().to_path_buf());
    (temp, service)
}

/// One open SFTP handle: either a real local file or a pre-enumerated
/// directory listing (SFTP's own `opendir`/`readdir` split, mirrored here by
/// eagerly reading the directory once at `opendir` time — real, bounded
/// content in every test, so eager enumeration is never a scalability
/// concern for this fixture).
enum FixtureHandle {
    File(tokio::fs::File),
    Dir(std::vec::IntoIter<(String, FileAttributes, bool)>),
}

#[derive(Default)]
struct FixtureSftpHandler {
    handles: HashMap<String, FixtureHandle>,
    next_handle: u64,
}

// The SFTP `permissions` field's high nibble (bits 12-15, POSIX `S_IFMT`)
// encodes the entry *type* as one mutually-exclusive value, not a set of
// independent flags — `FileAttributes::set_dir`/`set_regular`/`set_symlink`
// are each a plain OR/AND-NOT against that whole nibble, so calling more
// than one in sequence corrupts the result (`S_IFLNK` (`0xA000`) and
// `S_IFREG` (`0x8000`) share bit 15, so `set_symlink(false)` after
// `set_regular(true)` clears the just-set regular-file bit too). This
// fixture sets the nibble directly instead, in one assignment, to sidestep
// that footgun entirely.
const S_IFDIR: u32 = 0x4000;
const S_IFREG: u32 = 0x8000;
const S_IFLNK: u32 = 0xA000;

fn to_file_attributes(metadata: &std::fs::Metadata) -> FileAttributes {
    let file_type = metadata.file_type();
    let mode = if file_type.is_symlink() {
        S_IFLNK
    } else if file_type.is_dir() {
        S_IFDIR
    } else {
        S_IFREG
    };
    let mut attrs = FileAttributes {
        size: Some(metadata.len()),
        permissions: Some(mode | 0o644),
        ..FileAttributes::empty()
    };
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
            attrs.mtime = Some(duration.as_secs() as u32);
            attrs.atime = Some(duration.as_secs() as u32);
        }
    }
    attrs
}

impl FixtureSftpHandler {
    fn allocate_handle(&mut self) -> String {
        self.next_handle += 1;
        format!("h{}", self.next_handle)
    }
}

impl russh_sftp::server::Handler for FixtureSftpHandler {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let mut tokio_options = tokio::fs::OpenOptions::new();
        tokio_options
            .read(pflags.contains(OpenFlags::READ) || !pflags.contains(OpenFlags::WRITE))
            .write(pflags.contains(OpenFlags::WRITE))
            .append(pflags.contains(OpenFlags::APPEND))
            .truncate(pflags.contains(OpenFlags::TRUNCATE));
        if pflags.contains(OpenFlags::CREATE) {
            if pflags.contains(OpenFlags::EXCLUDE) {
                tokio_options.create_new(true);
            } else {
                tokio_options.create(true);
            }
        }
        let file = tokio_options
            .open(&filename)
            .await
            .map_err(|_| StatusCode::Failure)?;
        let handle = self.allocate_handle();
        self.handles
            .insert(handle.clone(), FixtureHandle::File(file));
        Ok(Handle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.handles.remove(&handle);
        Ok(ok_status(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<russh_sftp::protocol::Data, Self::Error> {
        use tokio::io::{AsyncReadExt, AsyncSeekExt};
        let Some(FixtureHandle::File(file)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|_| StatusCode::Failure)?;
        let mut buffer = vec![0_u8; len as usize];
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| StatusCode::Failure)?;
        if read == 0 {
            return Err(StatusCode::Eof);
        }
        buffer.truncate(read);
        Ok(russh_sftp::protocol::Data { id, data: buffer })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        use tokio::io::{AsyncSeekExt, AsyncWriteExt};
        let Some(FixtureHandle::File(file)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|_| StatusCode::Failure)?;
        file.write_all(&data)
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn lstat(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|_| StatusCode::NoSuchFile)?;
        Ok(russh_sftp::protocol::Attrs {
            id,
            attrs: to_file_attributes(&metadata),
        })
    }

    async fn stat(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|_| StatusCode::NoSuchFile)?;
        Ok(russh_sftp::protocol::Attrs {
            id,
            attrs: to_file_attributes(&metadata),
        })
    }

    async fn fstat(
        &mut self,
        id: u32,
        handle: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        let Some(FixtureHandle::File(file)) = self.handles.get(&handle) else {
            return Err(StatusCode::Failure);
        };
        let metadata = file.metadata().await.map_err(|_| StatusCode::Failure)?;
        Ok(russh_sftp::protocol::Attrs {
            id,
            attrs: to_file_attributes(&metadata),
        })
    }

    async fn setstat(
        &mut self,
        id: u32,
        _path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        Ok(ok_status(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let mut entries = tokio::fs::read_dir(&path)
            .await
            .map_err(|_| StatusCode::NoSuchFile)?;
        let mut collected = Vec::new();
        loop {
            let next = entries
                .next_entry()
                .await
                .map_err(|_| StatusCode::Failure)?;
            let Some(entry) = next else { break };
            let name = entry.file_name().to_string_lossy().into_owned();
            let metadata = entry.metadata().await.map_err(|_| StatusCode::Failure)?;
            let is_symlink = metadata.file_type().is_symlink();
            collected.push((name, to_file_attributes(&metadata), is_symlink));
            if collected.len() > 200_000 {
                return Err(StatusCode::Failure);
            }
        }
        let handle = self.allocate_handle();
        self.handles
            .insert(handle.clone(), FixtureHandle::Dir(collected.into_iter()));
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(FixtureHandle::Dir(iter)) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        let mut files = Vec::new();
        for _ in 0..256 {
            match iter.next() {
                Some((name, attrs, _)) => files.push(russh_sftp::protocol::File::new(name, attrs)),
                None => break,
            }
        }
        if files.is_empty() {
            return Err(StatusCode::Eof);
        }
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        tokio::fs::remove_file(&filename)
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        tokio::fs::create_dir(&path)
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        tokio::fs::remove_dir(&path)
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let canonical = tokio::fs::canonicalize(&path)
            .await
            .map_err(|_| StatusCode::NoSuchFile)?;
        let filename = canonical.to_string_lossy().into_owned();
        Ok(Name {
            id,
            files: vec![russh_sftp::protocol::File::dummy(filename)],
        })
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        // SFTP v3 semantics: SSH_FXP_RENAME must fail outright if `newpath`
        // already exists (no `posix-rename@openssh.com` extension offered by
        // this fixture) — real host `rename(2)` would silently overwrite,
        // so this check is what makes the fixture behave like a real SFTP
        // server rather than like bare POSIX rename.
        if tokio::fs::symlink_metadata(&newpath).await.is_ok() {
            return Err(StatusCode::Failure);
        }
        tokio::fs::rename(&oldpath, &newpath)
            .await
            .map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn symlink(
        &mut self,
        id: u32,
        linkpath: String,
        targetpath: String,
    ) -> Result<Status, Self::Error> {
        #[cfg(unix)]
        {
            tokio::fs::symlink(&targetpath, &linkpath)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }
        #[cfg(not(unix))]
        {
            let _ = (id, linkpath, targetpath);
            Err(StatusCode::OpUnsupported)
        }
    }
}

fn ok_status(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".to_owned(),
        language_tag: "en-US".to_owned(),
    }
}

/// The hermetic test sshd's own `Handler`/`Server`: accepts exactly one
/// configured public key for `publickey` auth, and — unlike `session::tests`'
/// own minimal handler — accepts a channel and answers a `"sftp"` subsystem
/// request with a real [`FixtureSftpHandler`] loop.
#[derive(Clone)]
struct SftpTestSshHandler {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    open_channels: Arc<AsyncMutex<HashMap<ChannelId, Channel<Msg>>>>,
    /// `F220` S4: captures the server-side [`ServerHandle`] the instant this
    /// connection authenticates — see [`SftpFixture::force_server_disconnect`]'s
    /// own doc comment for why this, and not `channel_open_session`, is the
    /// right capture point (a reactive-disconnect test needs to force a
    /// disconnect on a connection that has not necessarily opened any
    /// channel yet).
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
}

impl ServerHandler for SftpTestSshHandler {
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        let accepted = self
            .accepted_key
            .as_ref()
            .is_some_and(|accepted| accepted == public_key);
        Ok(if accepted {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_succeeded(&mut self, session: &mut Session) -> Result<(), Self::Error> {
        *self.kill_switch.lock().await = Some(session.handle());
        Ok(())
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.open_channels
            .lock()
            .await
            .insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != "sftp" {
            session.channel_failure(channel_id)?;
            return Ok(());
        }
        let Some(channel) = self.open_channels.lock().await.remove(&channel_id) else {
            session.channel_failure(channel_id)?;
            return Ok(());
        };
        session.channel_success(channel_id)?;
        russh_sftp::server::run(channel.into_stream(), FixtureSftpHandler::default()).await;
        Ok(())
    }
}

struct SftpTestSshServer {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    /// Shared across every connection this server accepts — every test using
    /// this fixture only ever opens the one connection `force_server_disconnect`
    /// needs to reach, so a single shared slot (rather than one per
    /// connection) keeps the plumbing simple.
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
}

impl ServerTrait for SftpTestSshServer {
    type Handler = SftpTestSshHandler;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> SftpTestSshHandler {
        SftpTestSshHandler {
            accepted_key: self.accepted_key.clone(),
            open_channels: Arc::new(AsyncMutex::new(HashMap::new())),
            kill_switch: Arc::clone(&self.kill_switch),
        }
    }
}

pub(crate) struct SftpFixture {
    pub(crate) address: SocketAddr,
    pub(crate) agent_socket_path: PathBuf,
    /// A real, empty local directory this fixture's SFTP server will happily
    /// serve — the test's own "remote root" content. Kept alive for the
    /// fixture's lifetime.
    pub(crate) served_dir: TempDir,
    /// `F220` S4: the server-side handle to this fixture's one live
    /// connection, captured the moment it authenticates — see
    /// [`Self::force_server_disconnect`].
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    _agent_temp: TempDir,
    _server_task: tokio::task::JoinHandle<()>,
    _agent_task: tokio::task::JoinHandle<()>,
}

impl SftpFixture {
    /// `F220` S4: forces the **server** side of this fixture's live
    /// connection to send a real SSH disconnect message — the "the peer
    /// actively disconnects" scenario the reactive-disconnect detection test
    /// needs, deliberately distinct from a test ever calling the client's
    /// own `RemoteSessionService::disconnect()` (which only exercises the
    /// already-covered explicit-disconnect path). Polls briefly for the
    /// server-side handle to become available — it is only captured once a
    /// connection actually authenticates (`SftpTestSshHandler::auth_succeeded`)
    /// — bounded so a test that calls this before any connection ever
    /// authenticated fails fast with a clear panic instead of hanging.
    pub(crate) async fn force_server_disconnect(&self) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let handle = self.kill_switch.lock().await.clone();
            if let Some(handle) = handle {
                handle
                    .disconnect(
                        russh::Disconnect::ByApplication,
                        "forced test disconnect".to_owned(),
                        "en-US".to_owned(),
                    )
                    .await
                    .expect("server-side disconnect message sends");
                return;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!(
                    "server-side session handle never became available — did the client \
                     actually authenticate before this was called?"
                );
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

fn connect_target(fixture: &SftpFixture, user: &str) -> RemoteConnectTarget {
    RemoteConnectTarget {
        host: fixture.address.ip().to_string(),
        port: fixture.address.port(),
        user: user.to_owned(),
    }
}

/// Drives the full two-phase connect (see `session`'s own module doc) to a
/// live, authenticated session against `fixture` — the shared "get a
/// connected `RemoteSessionId`" first step every `remote_fs`/`workspace`
/// remote-root test needs, mirroring `session::tests::expect_pending_confirmation`
/// plus its own follow-up `confirm_host_key` call.
pub(crate) async fn connect_test_session(
    service: &RemoteSessionService,
    window_label: &str,
    fixture: &SftpFixture,
    identity: &PrivateKey,
) -> RemoteSessionId {
    let _ = identity;
    connect_test_session_with_sink(
        service,
        window_label,
        fixture,
        Arc::new(NullRemoteSessionEventSink),
    )
    .await
}

/// `F220` S4: the sink-observable twin of [`connect_test_session`] — every
/// detail is identical except the caller supplies the exact
/// `Arc<dyn RemoteSessionEventSink>` both connect phases use, so a test can
/// observe the `Connected` event (and, later, whatever `Disconnected` event
/// the session's own reactive-disconnect monitor task eventually emits on
/// that same sink — see `session`'s own module doc). [`connect_test_session`]
/// itself is just this with a throwaway [`NullRemoteSessionEventSink`].
pub(crate) async fn connect_test_session_with_sink(
    service: &RemoteSessionService,
    window_label: &str,
    fixture: &SftpFixture,
    sink: Arc<dyn RemoteSessionEventSink>,
) -> RemoteSessionId {
    let target = connect_target(fixture, "octocat");
    let pending = service
        .connect(
            window_label,
            target.clone(),
            &fixture.agent_socket_path,
            Arc::clone(&sink),
        )
        .await
        .expect("connect call itself succeeds for an unknown host");
    let (algorithm, sha256_fingerprint) = match pending {
        RemoteSessionConnectResult::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    let confirmed = service
        .confirm_host_key(
            window_label,
            RemoteHostKeyConfirmParts {
                target,
                algorithm,
                sha256_fingerprint,
            },
            &fixture.agent_socket_path,
            sink,
        )
        .await
        .expect("confirm_host_key succeeds");
    match confirmed {
        RemoteSessionConnectResult::Connected { session_id } => session_id,
        other => panic!("expected connected, got {other:?}"),
    }
}

/// `F220` S4: the "reconnect" twin of [`connect_test_session`] — used once
/// `fixture`'s host key is *already* pinned for `window_label` (a prior
/// [`connect_test_session`] call already ran, or an earlier session against
/// this same fixture was disconnected). Unlike a never-before-seen host,
/// `RemoteClientHandler::check_server_key` matches the live key against the
/// existing pin directly (see `session::tests::a_pinned_host_that_still_matches_connects_directly_with_no_pending_step`),
/// so `RemoteSessionService::connect` alone goes straight to `Connected` —
/// no `confirm_host_key` round needed, and calling [`connect_test_session`]
/// again here would itself panic (it only ever expects the first-time
/// pending-confirmation response).
pub(crate) async fn reconnect_test_session(
    service: &RemoteSessionService,
    window_label: &str,
    fixture: &SftpFixture,
) -> RemoteSessionId {
    let sink: Arc<dyn RemoteSessionEventSink> = Arc::new(NullRemoteSessionEventSink);
    let result = service
        .connect(
            window_label,
            connect_target(fixture, "octocat"),
            &fixture.agent_socket_path,
            sink,
        )
        .await
        .expect("reconnect to an already-pinned host succeeds");
    match result {
        RemoteSessionConnectResult::Connected { session_id } => session_id,
        other => panic!("expected connected (host already pinned), got {other:?}"),
    }
}

/// `F220` S4: bundles one fixture sshd with the client identity its agent
/// offers, so a caller *outside* the `remote` domain — whose own
/// `validateRemoteSshLibraryOwnershipBoundary` architecture guard forbids
/// naming `russh`/`russh::keys::ssh_key::PrivateKey` directly, even in a
/// `tests.rs`-pattern file (that guard, unlike the others in
/// `boundary-contracts.mjs`, exempts by *domain* — anything under
/// `src-tauri/src/remote/` — not by filename, so it does not recognize
/// `workspace/commands/tests.rs` as a test file the way
/// `WORKSPACE_TEST_SOURCE_PATTERN` does) — can drive a full remote-root
/// connect/reconnect cycle (`workspace::commands::tests`'s own `F220` S4
/// reconnect tests) without ever spelling out the SSH library's own types.
/// `identity` is deliberately not `pub(crate)`: every operation a caller
/// outside this module needs is exposed as one of the three functions below
/// instead, so `PrivateKey` itself never has to leave `remote::test_support`.
pub(crate) struct RemoteRootFixture {
    pub(crate) fixture: SftpFixture,
    identity: PrivateKey,
}

/// Starts a fresh fixture sshd plus the client identity its agent offers,
/// bundled together — see [`RemoteRootFixture`]'s own doc comment.
pub(crate) async fn start_remote_root_fixture() -> RemoteRootFixture {
    let identity = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    RemoteRootFixture { fixture, identity }
}

/// [`connect_test_session`] against `remote_root_fixture`'s own fixture —
/// see [`RemoteRootFixture`]'s own doc comment for why this indirection
/// exists.
pub(crate) async fn connect_remote_root_fixture(
    service: &RemoteSessionService,
    window_label: &str,
    remote_root_fixture: &RemoteRootFixture,
) -> RemoteSessionId {
    connect_test_session(
        service,
        window_label,
        &remote_root_fixture.fixture,
        &remote_root_fixture.identity,
    )
    .await
}

/// [`reconnect_test_session`] against `remote_root_fixture`'s own fixture —
/// see [`RemoteRootFixture`]'s own doc comment for why this indirection
/// exists.
pub(crate) async fn reconnect_remote_root_fixture(
    service: &RemoteSessionService,
    window_label: &str,
    remote_root_fixture: &RemoteRootFixture,
) -> RemoteSessionId {
    reconnect_test_session(service, window_label, &remote_root_fixture.fixture).await
}

/// Starts a loopback sshd (real SFTP subsystem) plus a real agent server
/// offering `identity`.
pub(crate) async fn start_sftp_fixture(identity: &PrivateKey) -> SftpFixture {
    let agent_temp = TempDir::new().expect("tempdir creates");
    let served_dir = TempDir::new().expect("tempdir creates");

    let host_key = generate_key();
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("local addr");

    let kill_switch: Arc<AsyncMutex<Option<ServerHandle>>> = Arc::new(AsyncMutex::new(None));
    let mut server = SftpTestSshServer {
        accepted_key: Some(identity.public_key().clone()),
        kill_switch: Arc::clone(&kill_switch),
    };
    let server_task = tokio::spawn(async move {
        let running = server.run_on_socket(config, &listener);
        let _ = running.await;
    });

    let agent_socket_path = agent_temp.path().join("agent.sock");
    let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
    let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
    let agent_task = tokio::spawn(async move {
        let _ = agent_server::serve(stream, ()).await;
    });
    let mut loader = AgentClient::connect_uds(&agent_socket_path)
        .await
        .expect("connect to test agent");
    loader
        .add_identity(identity, &[])
        .await
        .expect("load identity into test agent");

    SftpFixture {
        address,
        agent_socket_path,
        served_dir,
        kill_switch,
        _agent_temp: agent_temp,
        _server_task: server_task,
        _agent_task: agent_task,
    }
}

// -----------------------------------------------------------------------
// `F220` S5's own hermetic `pty-req`/`shell`-serving test fixture — see
// `remote::remote_terminal`'s own module doc for what this exercises.
// Deliberately a *separate* handler/server/fixture triple from
// `SftpTestSshHandler`/`SftpTestSshServer`/`SftpFixture` above (mirroring
// this file's own module doc rationale for why the SFTP fixture is not
// reused by `session::tests` either): every existing S1-S4 test keeps using
// exactly the fixture shape it already does, untouched by this addition.
// -----------------------------------------------------------------------

/// The one live session channel this fixture ever serves, plus whatever this
/// slice's tests need to observe/act on it from outside the `Handler`
/// callbacks that populate it (mirrors `SftpTestSshHandler`'s own
/// `kill_switch` capture pattern, generalized to more than one piece of
/// state).
#[derive(Default)]
struct TerminalChannelState {
    channel_id: Option<ChannelId>,
    last_pty_request: Option<(String, u32, u32)>,
    last_window_change: Option<(u32, u32)>,
}

/// Real server-side `pty-req`/`shell` handling plus a deterministic "echo
/// shell": every byte of client input this fixture's one live channel
/// receives (`Handler::data`) is reflected straight back — a `cat`-like
/// stand-in for a real interactive shell, exactly like
/// `terminal::service::tests`' own local `cat`/`sh -c` fixture programs, just
/// served over a real SSH channel instead of a real pty. `pty_request`/
/// `shell_request`/`window_change_request` each reply with a real
/// `SSH_MSG_CHANNEL_SUCCESS` — this fixture never simulates a rejected
/// request (a dedicated hostile-mutation test covers `expect_success`'s own
/// `Failure`/unrelated-message handling with a purpose-built minimal
/// handler instead, so this shared fixture's happy path stays simple).
#[derive(Clone)]
struct TerminalTestSshHandler {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    channel_state: Arc<AsyncMutex<TerminalChannelState>>,
}

impl ServerHandler for TerminalTestSshHandler {
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        let accepted = self
            .accepted_key
            .as_ref()
            .is_some_and(|accepted| accepted == public_key);
        Ok(if accepted {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_succeeded(&mut self, session: &mut Session) -> Result<(), Self::Error> {
        *self.kill_switch.lock().await = Some(session.handle());
        Ok(())
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channel_state.lock().await.channel_id = Some(channel.id());
        reply.accept().await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channel_state.lock().await.last_pty_request =
            Some((term.to_owned(), col_width, row_height));
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channel_state.lock().await.last_window_change = Some((col_width, row_height));
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, data.to_vec())?;
        Ok(())
    }

    /// Replies with the server's own `SSH_MSG_CHANNEL_CLOSE` the instant the
    /// client sends one — the real-sshd-like cooperative half of
    /// `remote::remote_terminal::RemoteTerminalKiller::shutdown`'s "graceful
    /// signal" leg, so a hermetic kill test observes the channel finish
    /// closing promptly rather than needing to wait out the full
    /// `REMOTE_TERMINAL_KILL_GRACE` forced-release timeout.
    async fn channel_close(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.close(channel)?;
        Ok(())
    }
}

struct TerminalTestSshServer {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    channel_state: Arc<AsyncMutex<TerminalChannelState>>,
}

impl ServerTrait for TerminalTestSshServer {
    type Handler = TerminalTestSshHandler;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> TerminalTestSshHandler {
        TerminalTestSshHandler {
            accepted_key: self.accepted_key.clone(),
            kill_switch: Arc::clone(&self.kill_switch),
            channel_state: Arc::clone(&self.channel_state),
        }
    }
}

pub(crate) struct TerminalFixture {
    pub(crate) address: SocketAddr,
    pub(crate) agent_socket_path: PathBuf,
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    channel_state: Arc<AsyncMutex<TerminalChannelState>>,
    _agent_temp: TempDir,
    _server_task: tokio::task::JoinHandle<()>,
    _agent_task: tokio::task::JoinHandle<()>,
}

impl TerminalFixture {
    /// Polls briefly for the server-side session `Handle` to become
    /// available — mirrors [`SftpFixture::force_server_disconnect`]'s own
    /// identical bounded-poll rationale (only captured once a connection
    /// actually authenticates).
    async fn server_handle(&self) -> ServerHandle {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(handle) = self.kill_switch.lock().await.clone() {
                return handle;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("server-side session handle never became available");
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// Polls briefly for this fixture's one live channel id to become
    /// available — only set once `channel_open_session` actually ran.
    async fn channel_id(&self) -> ChannelId {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(channel_id) = self.channel_state.lock().await.channel_id {
                return channel_id;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("server-side channel id never became available");
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    /// The most recent `pty-req`'s `(term, cols, rows)`, if any yet.
    pub(crate) async fn last_pty_request(&self) -> Option<(String, u32, u32)> {
        self.channel_state.lock().await.last_pty_request.clone()
    }

    /// The most recent `window-change`'s `(cols, rows)`, if any yet.
    pub(crate) async fn last_window_change(&self) -> Option<(u32, u32)> {
        self.channel_state.lock().await.last_window_change
    }

    /// Sends a real `exit-status` channel request for this fixture's one
    /// live channel, then `eof`/`close` — mirroring exactly the sequence a
    /// real sshd sends once its spawned program exits normally.
    pub(crate) async fn exit_normally(&self, code: u32) {
        let handle = self.server_handle().await;
        let channel = self.channel_id().await;
        let _ = handle.exit_status_request(channel, code).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
    }

    /// Sends a real `exit-signal` channel request for this fixture's one
    /// live channel, then `eof`/`close` — mirrors [`Self::exit_normally`]'s
    /// identical trailing sequence.
    pub(crate) async fn exit_with_signal(&self, signal_name: &str) {
        let handle = self.server_handle().await;
        let channel = self.channel_id().await;
        let _ = handle
            .exit_signal_request(
                channel,
                russh::Sig::Custom(signal_name.to_owned()),
                false,
                String::new(),
                "en-US".to_owned(),
            )
            .await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
    }

    /// Forces the **server** side of this fixture's live connection to send
    /// a real SSH disconnect message — the whole-session "the peer actively
    /// disconnects" scenario, tearing down every channel (including this
    /// fixture's one live terminal channel) without either side ever having
    /// sent `exit-status`/`exit-signal` for it. Mirrors
    /// [`SftpFixture::force_server_disconnect`] exactly (see that method's
    /// own doc comment for the full rationale).
    pub(crate) async fn force_server_disconnect(&self) {
        let handle = self.server_handle().await;
        handle
            .disconnect(
                russh::Disconnect::ByApplication,
                "forced test disconnect".to_owned(),
                "en-US".to_owned(),
            )
            .await
            .expect("server-side disconnect message sends");
    }
}

/// Starts a loopback sshd serving real `pty-req`/`shell` channel requests
/// (see [`TerminalTestSshHandler`]'s own doc comment) plus a real agent
/// server offering `identity`.
pub(crate) async fn start_terminal_fixture(identity: &PrivateKey) -> TerminalFixture {
    let agent_temp = TempDir::new().expect("tempdir creates");

    let host_key = generate_key();
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("local addr");

    let kill_switch: Arc<AsyncMutex<Option<ServerHandle>>> = Arc::new(AsyncMutex::new(None));
    let channel_state = Arc::new(AsyncMutex::new(TerminalChannelState::default()));
    let mut server = TerminalTestSshServer {
        accepted_key: Some(identity.public_key().clone()),
        kill_switch: Arc::clone(&kill_switch),
        channel_state: Arc::clone(&channel_state),
    };
    let server_task = tokio::spawn(async move {
        let running = server.run_on_socket(config, &listener);
        let _ = running.await;
    });

    let agent_socket_path = agent_temp.path().join("agent.sock");
    let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
    let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
    let agent_task = tokio::spawn(async move {
        let _ = agent_server::serve(stream, ()).await;
    });
    let mut loader = AgentClient::connect_uds(&agent_socket_path)
        .await
        .expect("connect to test agent");
    loader
        .add_identity(identity, &[])
        .await
        .expect("load identity into test agent");

    TerminalFixture {
        address,
        agent_socket_path,
        kill_switch,
        channel_state,
        _agent_temp: agent_temp,
        _server_task: server_task,
        _agent_task: agent_task,
    }
}

fn terminal_connect_target(fixture: &TerminalFixture, user: &str) -> RemoteConnectTarget {
    RemoteConnectTarget {
        host: fixture.address.ip().to_string(),
        port: fixture.address.port(),
        user: user.to_owned(),
    }
}

/// [`connect_test_session`]'s twin for [`TerminalFixture`] — see that
/// function's own doc comment for the full two-phase-connect rationale this
/// drives identically.
pub(crate) async fn connect_terminal_test_session(
    service: &RemoteSessionService,
    window_label: &str,
    fixture: &TerminalFixture,
) -> RemoteSessionId {
    let sink: Arc<dyn RemoteSessionEventSink> = Arc::new(NullRemoteSessionEventSink);
    let target = terminal_connect_target(fixture, "octocat");
    let pending = service
        .connect(
            window_label,
            target.clone(),
            &fixture.agent_socket_path,
            Arc::clone(&sink),
        )
        .await
        .expect("connect call itself succeeds for an unknown host");
    let (algorithm, sha256_fingerprint) = match pending {
        RemoteSessionConnectResult::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    let confirmed = service
        .confirm_host_key(
            window_label,
            RemoteHostKeyConfirmParts {
                target,
                algorithm,
                sha256_fingerprint,
            },
            &fixture.agent_socket_path,
            sink,
        )
        .await
        .expect("confirm_host_key succeeds");
    match confirmed {
        RemoteSessionConnectResult::Connected { session_id } => session_id,
        other => panic!("expected connected, got {other:?}"),
    }
}

// -----------------------------------------------------------------------
// `F220` S6's own hermetic `exec`-serving test fixture — see
// `remote::remote_git`'s own module doc for what this exercises. A
// deliberately separate handler/server/fixture triple from the two above
// (mirroring this file's own established precedent), but — unlike either —
// its `exec_request` handler genuinely forwards the received command string
// to a **real** `sh -c "<command>"` child process rather than simulating a
// fixed response: `remote_git::run_remote_git` always sends a real,
// `shell_escape`-encoded POSIX command line, so the most direct way to
// verify the whole pipeline end to end (encoder → SSH `exec` wire format →
// a real shell's own parser → a real `git` binary) is to actually let a real
// shell parse and run it, exactly as a real `sshd` would.
// -----------------------------------------------------------------------

/// One live `exec` channel's accumulated request state — populated across
/// two independent `Handler` callbacks (`exec_request` for the command
/// string, `data` for stdin bytes) before `channel_eof` signals "the client
/// is done sending input, run it now".
#[derive(Default)]
struct GitExecChannelState {
    command: Option<Vec<u8>>,
    stdin: Vec<u8>,
}

/// Real server-side `exec` handling: `exec_request` records the command
/// string and replies success; `data` accumulates stdin bytes; `channel_eof`
/// — signaling the client has finished writing stdin, exactly what
/// `remote_git::run_remote_git` always sends immediately after any stdin
/// payload (or immediately, for the no-stdin case) — is what actually spawns
/// `sh -c "<command>"` and streams its stdout/stderr/exit-status back over
/// the channel. Deliberately waits for `channel_eof` rather than spawning
/// eagerly inside `exec_request`: this fixture's whole point is exercising
/// `remote_git`'s exact real protocol sequence (exec → optional stdin data →
/// eof → read stdout/stderr/exit-status → channel close), and every one of
/// this domain's six routed commands sends stdin (if any) fully before ever
/// starting to read a reply, so there is no scenario this ordering fails to
/// cover.
#[derive(Clone)]
struct GitExecTestSshHandler {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    channels: Arc<AsyncMutex<HashMap<ChannelId, GitExecChannelState>>>,
    /// Artificial delay [`run_exec_and_stream`] sleeps before spawning the
    /// real child process — the sole knob `remote_git::tests`' timeout/
    /// cancellation tests need (a real `git` invocation against a tiny test
    /// repository returns far too quickly on its own to exercise either
    /// path): configured once at fixture construction, shared by every
    /// channel this one connection ever opens.
    artificial_delay: Duration,
}

impl ServerHandler for GitExecTestSshHandler {
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        let accepted = self
            .accepted_key
            .as_ref()
            .is_some_and(|accepted| accepted == public_key);
        Ok(if accepted {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_succeeded(&mut self, session: &mut Session) -> Result<(), Self::Error> {
        *self.kill_switch.lock().await = Some(session.handle());
        Ok(())
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels
            .lock()
            .await
            .insert(channel.id(), GitExecChannelState::default());
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(state) = self.channels.lock().await.get_mut(&channel) {
            state.command = Some(data.to_vec());
        }
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(state) = self.channels.lock().await.get_mut(&channel) {
            state.stdin.extend_from_slice(data);
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let Some(state) = self.channels.lock().await.remove(&channel) else {
            return Ok(());
        };
        let Some(command) = state.command else {
            // EOF arrived before (or without) any exec request — nothing to
            // run; not exercised by any real `remote_git` call, kept
            // fail-soft rather than panicking the fixture's own event loop.
            return Ok(());
        };
        let handle = session.handle();
        let delay = self.artificial_delay;
        tokio::spawn(async move {
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            run_exec_and_stream(handle, channel, command, state.stdin).await;
        });
        Ok(())
    }
}

/// Spawns `sh -c "<command>"` (`command` is exactly the bytes the client's
/// `channel.exec(..)` sent — this fixture performs no decoding of its own;
/// see the section-level doc comment above for why forwarding to a real
/// shell, rather than reverse-parsing `shell_escape`'s own encoding, is this
/// fixture's chosen verification strategy), writes `stdin` to the child's
/// stdin then closes it, streams stdout as channel `Data` and stderr as
/// channel `ExtendedData` (stream 1) concurrently, then reports the real
/// exit code via `exit-status` followed by `eof`/`close` — the same trailing
/// sequence [`TerminalFixture::exit_normally`] already uses for the sibling
/// pty fixture.
async fn run_exec_and_stream(
    handle: ServerHandle,
    channel: ChannelId,
    command: Vec<u8>,
    stdin: Vec<u8>,
) {
    let Ok(command_text) = String::from_utf8(command) else {
        let _ = handle.exit_status_request(channel, 127).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
        return;
    };

    let mut child = match tokio::process::Command::new("sh")
        .arg("-c")
        .arg(&command_text)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            let _ = handle.exit_status_request(channel, 127).await;
            let _ = handle.eof(channel).await;
            let _ = handle.close(channel).await;
            return;
        }
    };

    if let Some(mut child_stdin) = child.stdin.take() {
        let _ = child_stdin.write_all(&stdin).await;
        // Dropping the handle closes the write end, signaling EOF to the
        // child — required for anything reading stdin to completion (e.g.
        // `git commit --file -`) to actually see the end of input.
        drop(child_stdin);
    }

    let mut stdout = child.stdout.take().expect("stdout is always piped here");
    let mut stderr = child.stderr.take().expect("stderr is always piped here");

    let stdout_handle = handle.clone();
    let stdout_task = tokio::spawn(async move {
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            match stdout.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if stdout_handle
                        .data(channel, buffer[..read].to_vec())
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });
    let stderr_handle = handle.clone();
    let stderr_task = tokio::spawn(async move {
        let mut buffer = [0_u8; 32 * 1024];
        loop {
            match stderr.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if stderr_handle
                        .extended_data(channel, 1, buffer[..read].to_vec())
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });

    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let status = child.wait().await;
    let code = status.ok().and_then(|status| status.code()).unwrap_or(-1);
    let _ = handle.exit_status_request(channel, code as u32).await;
    let _ = handle.eof(channel).await;
    let _ = handle.close(channel).await;
}

struct GitExecTestSshServer {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    kill_switch: Arc<AsyncMutex<Option<ServerHandle>>>,
    artificial_delay: Duration,
}

impl ServerTrait for GitExecTestSshServer {
    type Handler = GitExecTestSshHandler;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> GitExecTestSshHandler {
        GitExecTestSshHandler {
            accepted_key: self.accepted_key.clone(),
            kill_switch: Arc::clone(&self.kill_switch),
            channels: Arc::new(AsyncMutex::new(HashMap::new())),
            artificial_delay: self.artificial_delay,
        }
    }
}

pub(crate) struct GitExecFixture {
    pub(crate) address: SocketAddr,
    pub(crate) agent_socket_path: PathBuf,
    /// A real, empty local directory the test itself populates with a real
    /// git repository (`std::process::Command`-driven, exactly like
    /// `git::status::tests`' own `init_repo`/`raw_git_ok` fixture helpers) —
    /// this fixture serves it only in the sense that `sh -c "git -C
    /// <this path> …"` is what every routed invocation ultimately runs
    /// against.
    pub(crate) repo_dir: TempDir,
    _agent_temp: TempDir,
    _server_task: tokio::task::JoinHandle<()>,
    _agent_task: tokio::task::JoinHandle<()>,
}

/// Starts a loopback sshd serving real `exec` requests (see
/// [`GitExecTestSshHandler`]'s own doc comment) plus a real agent server
/// offering `identity`. `artificial_delay`, when nonzero, is
/// [`run_exec_and_stream`]'s own injected startup delay — `Duration::ZERO`
/// for every ordinary test; a real, human-perceptible-but-test-bounded value
/// (a few hundred milliseconds) for the timeout/cancellation tests, which
/// also inject a much smaller client-side timeout via
/// `remote_git::run_remote_git_for_test` so the two race deterministically
/// without either side needing to wait out this domain's real 60-second
/// production ceiling.
pub(crate) async fn start_git_exec_fixture(
    identity: &PrivateKey,
    artificial_delay: Duration,
) -> GitExecFixture {
    let agent_temp = TempDir::new().expect("tempdir creates");
    let repo_dir = TempDir::new().expect("tempdir creates");

    let host_key = generate_key();
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("local addr");

    let kill_switch: Arc<AsyncMutex<Option<ServerHandle>>> = Arc::new(AsyncMutex::new(None));
    let mut server = GitExecTestSshServer {
        accepted_key: Some(identity.public_key().clone()),
        kill_switch: Arc::clone(&kill_switch),
        artificial_delay,
    };
    let server_task = tokio::spawn(async move {
        let running = server.run_on_socket(config, &listener);
        let _ = running.await;
    });

    let agent_socket_path = agent_temp.path().join("agent.sock");
    let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
    let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
    let agent_task = tokio::spawn(async move {
        let _ = agent_server::serve(stream, ()).await;
    });
    let mut loader = AgentClient::connect_uds(&agent_socket_path)
        .await
        .expect("connect to test agent");
    loader
        .add_identity(identity, &[])
        .await
        .expect("load identity into test agent");

    GitExecFixture {
        address,
        agent_socket_path,
        repo_dir,
        _agent_temp: agent_temp,
        _server_task: server_task,
        _agent_task: agent_task,
    }
}

fn git_exec_connect_target(fixture: &GitExecFixture, user: &str) -> RemoteConnectTarget {
    RemoteConnectTarget {
        host: fixture.address.ip().to_string(),
        port: fixture.address.port(),
        user: user.to_owned(),
    }
}

/// [`connect_test_session`]'s twin for [`GitExecFixture`] — see that
/// function's own doc comment for the full two-phase-connect rationale this
/// drives identically.
pub(crate) async fn connect_git_exec_test_session(
    service: &RemoteSessionService,
    window_label: &str,
    fixture: &GitExecFixture,
) -> RemoteSessionId {
    let sink: Arc<dyn RemoteSessionEventSink> = Arc::new(NullRemoteSessionEventSink);
    let target = git_exec_connect_target(fixture, "octocat");
    let pending = service
        .connect(
            window_label,
            target.clone(),
            &fixture.agent_socket_path,
            Arc::clone(&sink),
        )
        .await
        .expect("connect call itself succeeds for an unknown host");
    let (algorithm, sha256_fingerprint) = match pending {
        RemoteSessionConnectResult::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    let confirmed = service
        .confirm_host_key(
            window_label,
            RemoteHostKeyConfirmParts {
                target,
                algorithm,
                sha256_fingerprint,
            },
            &fixture.agent_socket_path,
            sink,
        )
        .await
        .expect("confirm_host_key succeeds");
    match confirmed {
        RemoteSessionConnectResult::Connected { session_id } => session_id,
        other => panic!("expected connected, got {other:?}"),
    }
}
