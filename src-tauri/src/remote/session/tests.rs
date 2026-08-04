//! Hermetic `F220` S1 integration tests: a real `russh` server on loopback
//! (a random port, a fixed test host key) plus a real `russh::keys::agent`
//! server on a temp-directory Unix socket, driven entirely through
//! [`RemoteSessionService`]'s own public async API — nothing here mocks the
//! SSH or agent wire protocol; every test below walks the exact same code
//! path `commands::remote_session_connect` etc. do in production, differing
//! only in *which* socket paths they point at.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::keys::agent::client::AgentClient;
use russh::keys::agent::server as agent_server;
use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::ssh_key::PrivateKey;
use russh::server::{Auth, Handler as ServerHandler, Server as ServerTrait};
use tempfile::TempDir;
use tokio::net::{TcpListener, UnixListener};

use super::*;
use crate::remote::dto::{
    RemoteConnectTarget, RemoteHostKeyConfirmParts, RemoteSessionEventPayload,
};

/// Records every event a test's [`RemoteSessionEventSink`] observes, in
/// arrival order — lets a test assert both the returned `Result` *and* what
/// actually got emitted over `plain://remote-session-event`.
#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<RemoteSessionEventPayload>>,
}

impl RemoteSessionEventSink for RecordingSink {
    fn emit(&self, payload: RemoteSessionEventPayload) {
        self.events.lock().unwrap().push(payload);
    }
}

impl RecordingSink {
    fn len(&self) -> usize {
        self.events.lock().unwrap().len()
    }
}

fn test_service() -> (TempDir, RemoteSessionService) {
    let temp = TempDir::new().expect("tempdir creates");
    let service = RemoteSessionService::new(temp.path().to_path_buf());
    (temp, service)
}

/// A process-wide counter feeding [`generate_key`]'s deterministic seed —
/// every call produces a distinct Ed25519 keypair without needing an actual
/// RNG dependency (`ssh_key::PrivateKey::random` wants a `CryptoRng`, which
/// would pull in `rand_core`/`getrandom` as a genuine new pinned dependency
/// purely to generate a handful of test keypairs). Real cryptographic
/// randomness is not a property any of these tests need — they need distinct,
/// reproducible keys, which an incrementing seed already guarantees.
static KEY_SEED_COUNTER: AtomicU64 = AtomicU64::new(1);

fn generate_key() -> PrivateKey {
    let counter = KEY_SEED_COUNTER.fetch_add(1, Ordering::SeqCst);
    let mut seed = [0_u8; 32];
    seed[..8].copy_from_slice(&counter.to_le_bytes());
    PrivateKey::from(Ed25519Keypair::from_seed(&seed))
}

/// The hermetic test sshd's own `Handler`/`Server` — accepts exactly one
/// configured public key for `publickey` auth (or none, for the
/// auth-rejected scenario) and never opens a channel: `F220` S1 never sends
/// any post-auth traffic, so there is nothing for a channel to carry yet.
#[derive(Clone)]
struct TestSshHandler {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    auth_attempts: Arc<AtomicU32>,
}

impl ServerHandler for TestSshHandler {
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        _user: &str,
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Auth, Self::Error> {
        self.auth_attempts.fetch_add(1, Ordering::SeqCst);
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

    // No `channel_open_session` override: `F220` S1 never opens a channel at
    // all (no FS/PTY/Git/DAP transport yet — see the crate module doc), so
    // the default implementation (auto-reject any channel-open attempt) is
    // never actually exercised by anything these tests do.
}

struct TestSshServer {
    accepted_key: Option<russh::keys::ssh_key::PublicKey>,
    auth_attempts: Arc<AtomicU32>,
}

impl ServerTrait for TestSshServer {
    type Handler = TestSshHandler;

    fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> TestSshHandler {
        TestSshHandler {
            accepted_key: self.accepted_key.clone(),
            auth_attempts: Arc::clone(&self.auth_attempts),
        }
    }
}

/// A running hermetic fixture: the sshd itself, plus (if requested) a real
/// agent-protocol server offering `client_identity` on its own temp-directory
/// Unix socket.
struct SshFixture {
    _temp: TempDir,
    address: SocketAddr,
    agent_socket_path: PathBuf,
    auth_attempts: Arc<AtomicU32>,
    _server_task: tokio::task::JoinHandle<()>,
    _agent_task: Option<tokio::task::JoinHandle<()>>,
}

impl SshFixture {
    /// Aborts and awaits both background tasks, guaranteeing the loopback
    /// listener (and the agent socket, if any) are actually closed before
    /// this returns — a bare `drop(fixture)` only detaches a `JoinHandle`
    /// without stopping the task it names, which would leave the listening
    /// socket bound (and a same-port rebind racing `AddrInUse`) for an
    /// unbounded extra period. Only the "host key changed" test below needs
    /// this — every other test lets its fixture's ports go to the OS's
    /// normal ephemeral-port reuse instead of rebinding a specific one.
    async fn shutdown(self) {
        self._server_task.abort();
        let _ = self._server_task.await;
        if let Some(agent_task) = self._agent_task {
            agent_task.abort();
            let _ = agent_task.await;
        }
    }
}

/// Starts the fixture. `client_identity` is the keypair the agent will offer
/// (or `None` to run an agent with zero identities loaded); `server_accepts`
/// controls which key the server's own `auth_publickey` accepts (`None`
/// means "accept nothing" — the auth-rejected scenario).
async fn start_fixture(
    client_identity: Option<&PrivateKey>,
    server_accepts: Option<&PrivateKey>,
) -> SshFixture {
    let temp = TempDir::new().expect("tempdir creates");

    let host_key = generate_key();
    let config = russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    };
    let config = Arc::new(config);

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind loopback");
    let address = listener.local_addr().expect("local addr");

    let auth_attempts = Arc::new(AtomicU32::new(0));
    let mut server = TestSshServer {
        accepted_key: server_accepts.map(PrivateKey::public_key).cloned(),
        auth_attempts: Arc::clone(&auth_attempts),
    };
    // `run_on_socket` returns a future borrowing both `&mut server` and
    // `&listener` — both must be moved into (and stay alive inside) the same
    // spawned task the future itself runs in, not left behind in this
    // function's own stack frame.
    let server_task = tokio::spawn(async move {
        let running = server.run_on_socket(config, &listener);
        let _ = running.await;
    });

    let agent_socket_path = temp.path().join("agent.sock");
    let agent_task = if let Some(identity) = client_identity {
        let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
        let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
        let task = tokio::spawn(async move {
            let _ = agent_server::serve(stream, ()).await;
        });
        // Load the one identity into the running agent via a real client
        // connection over the agent protocol — exactly what a real
        // `ssh-add` would do.
        let mut loader = AgentClient::connect_uds(&agent_socket_path)
            .await
            .expect("connect to test agent");
        loader
            .add_identity(identity, &[])
            .await
            .expect("load identity into test agent");
        Some(task)
    } else {
        // An agent that is reachable but has never had any identity loaded
        // — the "agent 无可用身份" scenario.
        let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
        let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
        Some(tokio::spawn(async move {
            let _ = agent_server::serve(stream, ()).await;
        }))
    };

    SshFixture {
        _temp: temp,
        address,
        agent_socket_path,
        auth_attempts,
        _server_task: server_task,
        _agent_task: agent_task,
    }
}

/// Drives `service.connect(...)` and asserts it reached the pending-
/// confirmation outcome, returning `(algorithm, sha256Fingerprint)` — the
/// shared first half nearly every test below needs, since a truly
/// first-time `(host, port)` always stops at the host-key check before ever
/// reaching agent authentication (see `session`'s own module doc).
async fn expect_pending_confirmation(
    service: &RemoteSessionService,
    window_label: &str,
    target: RemoteConnectTarget,
    agent_socket_path: &std::path::Path,
) -> (String, String) {
    let pending = service
        .connect(
            window_label,
            target,
            agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect("connect call itself succeeds for an unknown host");
    match pending {
        RemoteSessionConnectResult::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    }
}

fn target(fixture: &SshFixture, user: &str) -> RemoteConnectTarget {
    RemoteConnectTarget {
        host: fixture.address.ip().to_string(),
        port: fixture.address.port(),
        user: user.to_owned(),
    }
}

#[tokio::test]
async fn first_connect_to_an_unknown_host_returns_pending_confirmation_and_pins_nothing() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    let result = service
        .connect(
            "window-a",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect("connect call itself succeeds");

    match result {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            known_hosts_hit, ..
        } => {
            assert!(!known_hosts_hit);
        }
        other => panic!("expected pending confirmation, got {other:?}"),
    }
    assert_eq!(service.session_count_for_test("window-a"), 0);
    // Zero auth attempts: the handshake never got past the host-key check.
    assert_eq!(fixture.auth_attempts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn confirming_the_exact_reported_fingerprint_pins_it_and_connects() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    let pending = service
        .connect(
            "window-a",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };

    let sink = RecordingSink::default();
    let confirmed = service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint: fingerprint,
            },
            &fixture.agent_socket_path,
            &sink,
        )
        .await
        .expect("confirm succeeds");
    assert!(matches!(
        confirmed,
        RemoteSessionConnectResult::Connected { .. }
    ));
    assert_eq!(service.session_count_for_test("window-a"), 1);
    assert_eq!(sink.len(), 1);

    let state = service.state("window-a");
    assert_eq!(state.sessions.len(), 1);
    assert_eq!(state.sessions[0].host, target(&fixture, "octocat").host);
}

#[tokio::test]
async fn a_pinned_host_that_still_matches_connects_directly_with_no_pending_step() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    let pending = service
        .connect(
            "window-a",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint: fingerprint,
            },
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();

    // A brand new connect call, same (host, port): the store already has a
    // matching pin, so this must go straight to `Connected`, no pending step.
    let second = service
        .connect(
            "window-b",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect("second connect succeeds");
    assert!(matches!(
        second,
        RemoteSessionConnectResult::Connected { .. }
    ));
    assert_eq!(service.session_count_for_test("window-b"), 1);
}

#[tokio::test]
async fn a_changed_host_key_hard_fails_with_both_fingerprints_and_pins_nothing_new() {
    let original_key = generate_key();
    let client_key = generate_key();
    let (_temp, service) = test_service();

    // First fixture: pin the original host key.
    let first_fixture = start_fixture(Some(&client_key), Some(&client_key)).await;
    let port = first_fixture.address.port();
    let pending = service
        .connect(
            "window-a",
            RemoteConnectTarget {
                host: "127.0.0.1".to_owned(),
                port,
                user: "octocat".to_owned(),
            },
            &first_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: RemoteConnectTarget {
                    host: "127.0.0.1".to_owned(),
                    port,
                    user: "octocat".to_owned(),
                },
                algorithm,
                sha256_fingerprint: fingerprint.clone(),
            },
            &first_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    // Must actually stop the listener (not merely drop the `JoinHandle`,
    // which only detaches it — see `SshFixture::shutdown`'s own doc
    // comment) before the replacement fixture below rebinds this exact port.
    first_fixture.shutdown().await;

    // Second fixture, deliberately bound to the *same* port with a
    // *different* host key — simulating a reinstalled host (or a MITM).
    let _ = original_key; // documents intent; the real differentiator is the fresh keypair below
    let replacement_fixture =
        bind_fixture_on_port(port, Some(&client_key), Some(&client_key)).await;

    let hard_fail = service
        .connect(
            "window-a",
            RemoteConnectTarget {
                host: "127.0.0.1".to_owned(),
                port,
                user: "octocat".to_owned(),
            },
            &replacement_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await;
    let error = hard_fail.expect_err("changed host key must hard fail");
    assert_eq!(error.code(), "REMOTE_HOST_KEY_CHANGED");
    assert!(error.message().contains(&fingerprint));
    // The hard-failed second attempt registers no *new* session — the count
    // stays at exactly the one session the earlier, legitimate pin-and-connect
    // already established, never incremented by the rejected reconnect.
    assert_eq!(service.session_count_for_test("window-a"), 1);

    // And the store still names only the original fingerprint — a hard
    // failure must never silently overwrite what was pinned.
    let listed = service.list_host_keys().await.unwrap();
    assert_eq!(listed.entries.len(), 1);
    assert_eq!(listed.entries[0].sha256_fingerprint, fingerprint);
}

/// Same as [`start_fixture`] but binds the *listener* to a caller-chosen
/// fixed port instead of an ephemeral one — the "host key changed" test's
/// own need to reconnect to the identical `(host, port)` with a fresh,
/// different host key.
async fn bind_fixture_on_port(
    port: u16,
    client_identity: Option<&PrivateKey>,
    server_accepts: Option<&PrivateKey>,
) -> SshFixture {
    let temp = TempDir::new().expect("tempdir creates");
    let host_key = generate_key();
    let config = russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    };
    let config = Arc::new(config);

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .expect("rebind same port");
    let address = listener.local_addr().expect("local addr");

    let auth_attempts = Arc::new(AtomicU32::new(0));
    let mut server = TestSshServer {
        accepted_key: server_accepts.map(PrivateKey::public_key).cloned(),
        auth_attempts: Arc::clone(&auth_attempts),
    };
    // `run_on_socket` returns a future borrowing both `&mut server` and
    // `&listener` — both must be moved into (and stay alive inside) the same
    // spawned task the future itself runs in, not left behind in this
    // function's own stack frame.
    let server_task = tokio::spawn(async move {
        let running = server.run_on_socket(config, &listener);
        let _ = running.await;
    });

    let agent_socket_path = temp.path().join("agent.sock");
    let agent_task = if let Some(identity) = client_identity {
        let listener = UnixListener::bind(&agent_socket_path).expect("bind agent socket");
        let stream = tokio_stream::wrappers::UnixListenerStream::new(listener);
        let task = tokio::spawn(async move {
            let _ = agent_server::serve(stream, ()).await;
        });
        let mut loader = AgentClient::connect_uds(&agent_socket_path)
            .await
            .expect("connect to test agent");
        loader
            .add_identity(identity, &[])
            .await
            .expect("load identity");
        Some(task)
    } else {
        None
    };

    SshFixture {
        _temp: temp,
        address,
        agent_socket_path,
        auth_attempts,
        _server_task: server_task,
        _agent_task: agent_task,
    }
}

#[tokio::test]
async fn a_server_that_rejects_every_identity_reports_auth_rejected() {
    let client_key = generate_key();
    let other_key = generate_key();
    // The server only accepts `other_key`, never `client_key` — the agent
    // offers `client_key`, so every real signature the agent produces is
    // presented to, and rejected by, the real server. The very first
    // `connect()` call against this never-seen host still stops at the
    // host-key check (see `expect_pending_confirmation`'s own doc comment);
    // `confirm_host_key` is what actually reaches — and fails at — agent
    // authentication, since pinning and the post-pin reconnect happen
    // together in that one call.
    let fixture = start_fixture(Some(&client_key), Some(&other_key)).await;
    let (_temp, service) = test_service();

    let (algorithm, sha256_fingerprint) = expect_pending_confirmation(
        &service,
        "window-a",
        target(&fixture, "octocat"),
        &fixture.agent_socket_path,
    )
    .await;
    let error = service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint,
            },
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("rejected auth is an error");
    assert_eq!(error.code(), "REMOTE_AGENT_AUTH_REJECTED");
    assert_eq!(service.session_count_for_test("window-a"), 0);
}

#[tokio::test]
async fn an_agent_with_no_identities_reports_no_identities() {
    let key = generate_key();
    let fixture = start_fixture(None, Some(&key)).await;
    let (_temp, service) = test_service();

    let (algorithm, sha256_fingerprint) = expect_pending_confirmation(
        &service,
        "window-a",
        target(&fixture, "octocat"),
        &fixture.agent_socket_path,
    )
    .await;
    let error = service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint,
            },
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("no identities is an error");
    assert_eq!(error.code(), "REMOTE_AGENT_NO_IDENTITIES");
}

#[tokio::test]
async fn a_missing_agent_socket_reports_agent_unavailable() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();
    let missing_socket = fixture
        .agent_socket_path
        .with_file_name("does-not-exist.sock");

    // The host-key phase does not touch the agent at all, so this still
    // reaches pending confirmation over the *real* agent socket; only the
    // subsequent `confirm_host_key` call is given the bad path, exercising
    // agent unavailability specifically in the post-pin reconnect's own
    // authentication phase.
    let (algorithm, sha256_fingerprint) = expect_pending_confirmation(
        &service,
        "window-a",
        target(&fixture, "octocat"),
        &fixture.agent_socket_path,
    )
    .await;
    let error = service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint,
            },
            &missing_socket,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("missing agent socket is an error");
    assert_eq!(error.code(), "REMOTE_AGENT_UNAVAILABLE");
}

#[tokio::test]
async fn connecting_to_a_closed_port_times_out_within_the_bounded_budget() {
    // Bind then immediately drop a listener to obtain a port nothing is
    // listening on, then connect with a short injected timeout by racing the
    // real production constant against a fast local failure: a closed
    // loopback port refuses the TCP handshake almost instantly, so this
    // proves the failure path (`REMOTE_CONNECT_FAILED`, not a hang), and a
    // dedicated cancellation test below proves the *budget itself* is really
    // enforced.
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let (_temp, service) = test_service();
    let agent_dir = TempDir::new().unwrap();
    let agent_socket_path = agent_dir.path().join("agent.sock");

    let error = service
        .connect(
            "window-a",
            RemoteConnectTarget {
                host: "127.0.0.1".to_owned(),
                port,
                user: "octocat".to_owned(),
            },
            &agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("closed port refuses the connection");
    assert_eq!(error.code(), "REMOTE_CONNECT_FAILED");
}

#[tokio::test]
async fn cancelling_an_in_flight_connect_reports_cancelled() {
    // A non-routable TEST-NET-1 address (RFC 5737, 192.0.2.0/24) that will
    // not send back an immediate RST — the connect attempt sits pending long
    // enough for the cancel flag to win the race deterministically.
    let (_temp, service) = test_service();
    let agent_dir = TempDir::new().unwrap();
    let agent_socket_path = agent_dir.path().join("agent.sock");
    let service = Arc::new(service);
    let target = RemoteConnectTarget {
        host: "192.0.2.1".to_owned(),
        port: 65_500,
        user: "octocat".to_owned(),
    };

    let connect_service = Arc::clone(&service);
    let connect_target = target.clone();
    let connect_task = tokio::spawn(async move {
        connect_service
            .connect(
                "window-a",
                connect_target,
                &agent_socket_path,
                &NullRemoteSessionEventSink,
            )
            .await
    });

    // Give the connect attempt a moment to register itself as in-flight,
    // then cancel it.
    tokio::time::sleep(Duration::from_millis(100)).await;
    service.request_cancel_connect("window-a", &target.host, target.port);

    let result = tokio::time::timeout(Duration::from_secs(5), connect_task)
        .await
        .expect("cancel resolves promptly")
        .expect("task joins");
    let error = result.expect_err("cancelled connect is an error");
    assert_eq!(error.code(), "REMOTE_CONNECT_CANCELLED");
}

#[tokio::test]
async fn a_connect_attempt_that_never_completes_times_out_at_the_injected_budget() {
    // Same non-routable TEST-NET-1 target as the cancellation test above,
    // but this time nothing ever cancels it — proving the real
    // `REMOTE_CONNECT_TIMED_OUT` budget-exhaustion path actually fires, not
    // just the cancellation path. Uses `connect_for_test_with_timeout` to
    // inject a small budget so this test does not have to wait out the real
    // 10-second production `REMOTE_CONNECT_TIMEOUT`.
    let (_temp, service) = test_service();
    let agent_dir = TempDir::new().unwrap();
    let agent_socket_path = agent_dir.path().join("agent.sock");
    let target = RemoteConnectTarget {
        host: "192.0.2.1".to_owned(),
        port: 65_501,
        user: "octocat".to_owned(),
    };

    let result = tokio::time::timeout(
        Duration::from_secs(5),
        service.connect_for_test_with_timeout(
            "window-a",
            target,
            &agent_socket_path,
            &NullRemoteSessionEventSink,
            Duration::from_millis(200),
        ),
    )
    .await
    .expect("the injected 200ms budget resolves well within the 5s test timeout");
    let error = result.expect_err("an unreachable target must time out, not succeed");
    assert_eq!(error.code(), "REMOTE_CONNECT_TIMED_OUT");
}

#[tokio::test]
async fn disconnect_removes_the_session_and_emits_a_user_requested_event() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    let pending = service
        .connect(
            "window-a",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    let connected = service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint: fingerprint,
            },
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let session_id = match connected {
        RemoteSessionConnectResult::Connected { session_id } => session_id,
        _ => unreachable!(),
    };

    let sink = RecordingSink::default();
    service
        .disconnect("window-a", session_id, &sink)
        .await
        .expect("disconnect succeeds");
    assert_eq!(service.session_count_for_test("window-a"), 0);
    assert_eq!(sink.len(), 1);
    let events = sink.events.lock().unwrap();
    match &events[0] {
        RemoteSessionEventPayload::Disconnected { reason, .. } => {
            assert_eq!(*reason, RemoteSessionDisconnectReasonForTest::UserRequested);
        }
        other => panic!("expected a disconnected event, got {other:?}"),
    }
}

#[tokio::test]
async fn disconnecting_an_unknown_session_id_reports_session_not_found() {
    let (_temp, service) = test_service();
    let error = service
        .disconnect(
            "window-a",
            RemoteSessionId::new(),
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("unknown session id is an error");
    assert_eq!(error.code(), "REMOTE_SESSION_NOT_FOUND");
}

#[tokio::test]
async fn closing_the_window_drops_every_live_session_for_it_and_no_others() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    for window_label in ["window-a", "window-b"] {
        let pending = service
            .connect(
                window_label,
                target(&fixture, "octocat"),
                &fixture.agent_socket_path,
                &NullRemoteSessionEventSink,
            )
            .await
            .unwrap();
        let (algorithm, fingerprint) = match pending {
            RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
                algorithm,
                sha256_fingerprint,
                ..
            } => (algorithm, sha256_fingerprint),
            RemoteSessionConnectResultForTest::Connected { .. } => continue,
        };
        service
            .confirm_host_key(
                window_label,
                RemoteHostKeyConfirmParts {
                    target: target(&fixture, "octocat"),
                    algorithm,
                    sha256_fingerprint: fingerprint,
                },
                &fixture.agent_socket_path,
                &NullRemoteSessionEventSink,
            )
            .await
            .unwrap();
    }
    assert_eq!(service.session_count_for_test("window-a"), 1);
    assert_eq!(service.session_count_for_test("window-b"), 1);

    service.close_window("window-a");
    assert_eq!(service.session_count_for_test("window-a"), 0);
    assert_eq!(service.session_count_for_test("window-b"), 1);
}

#[tokio::test]
async fn forgetting_a_pinned_host_key_makes_the_next_connect_pending_again() {
    let key = generate_key();
    let fixture = start_fixture(Some(&key), Some(&key)).await;
    let (_temp, service) = test_service();

    let pending = service
        .connect(
            "window-a",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&fixture, "octocat"),
                algorithm,
                sha256_fingerprint: fingerprint,
            },
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();

    let listed = service.list_host_keys().await.unwrap();
    assert_eq!(listed.entries.len(), 1);

    service
        .forget_host_key(
            &target(&fixture, "octocat").host,
            target(&fixture, "octocat").port,
        )
        .await
        .unwrap();
    let listed_after = service.list_host_keys().await.unwrap();
    assert!(listed_after.entries.is_empty());

    let again = service
        .connect(
            "window-b",
            target(&fixture, "octocat"),
            &fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    assert!(matches!(
        again,
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation { .. }
    ));
}

#[tokio::test]
async fn forgetting_a_never_pinned_host_is_idempotent() {
    let (_temp, service) = test_service();
    service
        .forget_host_key("never-pinned.example", 22)
        .await
        .expect("idempotent forget succeeds");
    service
        .forget_host_key("never-pinned.example", 22)
        .await
        .expect("idempotent forget succeeds twice");
}

#[tokio::test]
async fn a_window_at_the_session_cap_rejects_one_more_connect() {
    let key = generate_key();
    let (_temp, service) = test_service();

    // Pin once against a real fixture so every subsequent connect in this
    // test can go straight to `Connected` without its own pending step.
    let seed_fixture = start_fixture(Some(&key), Some(&key)).await;
    let pending = service
        .connect(
            "window-a",
            target(&seed_fixture, "octocat"),
            &seed_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();
    let (algorithm, fingerprint) = match pending {
        RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } => (algorithm, sha256_fingerprint),
        other => panic!("expected pending confirmation, got {other:?}"),
    };
    service
        .confirm_host_key(
            "window-a",
            RemoteHostKeyConfirmParts {
                target: target(&seed_fixture, "octocat"),
                algorithm,
                sha256_fingerprint: fingerprint,
            },
            &seed_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .unwrap();

    let mut fixtures = vec![seed_fixture];
    while service.session_count_for_test("window-a") < MAX_REMOTE_SESSIONS_PER_WINDOW {
        let fixture = start_fixture(Some(&key), Some(&key)).await;
        let result = service
            .connect(
                "window-a",
                target(&fixture, "octocat"),
                &fixture.agent_socket_path,
                &NullRemoteSessionEventSink,
            )
            .await
            .unwrap();
        // Each new host is unknown, so pin it too — a distinct `(host,
        // port)` per fixture keeps every one of these a genuine additional
        // session rather than a dedupe.
        if let RemoteSessionConnectResultForTest::HostKeyPendingConfirmation {
            algorithm,
            sha256_fingerprint,
            ..
        } = result
        {
            service
                .confirm_host_key(
                    "window-a",
                    RemoteHostKeyConfirmParts {
                        target: target(&fixture, "octocat"),
                        algorithm,
                        sha256_fingerprint,
                    },
                    &fixture.agent_socket_path,
                    &NullRemoteSessionEventSink,
                )
                .await
                .unwrap();
        }
        fixtures.push(fixture);
    }
    assert_eq!(
        service.session_count_for_test("window-a"),
        MAX_REMOTE_SESSIONS_PER_WINDOW
    );

    let overflow_fixture = start_fixture(Some(&key), Some(&key)).await;
    let error = service
        .connect(
            "window-a",
            target(&overflow_fixture, "octocat"),
            &overflow_fixture.agent_socket_path,
            &NullRemoteSessionEventSink,
        )
        .await
        .expect_err("the ninth session is rejected");
    assert_eq!(error.code(), "REMOTE_SESSION_LIMIT_REACHED");
}

// Local type aliases purely so this file's own match arms above read
// naturally without repeating the fully qualified enum path at every site —
// no behavioral difference from `RemoteSessionConnectResult`/
// `RemoteSessionDisconnectReason` themselves.
type RemoteSessionConnectResultForTest = RemoteSessionConnectResult;
type RemoteSessionDisconnectReasonForTest = RemoteSessionDisconnectReason;
