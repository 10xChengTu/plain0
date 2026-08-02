//! Real-socket Rust tests for `debug::tcp`'s hardened TCP-connect primitive
//! and, separately, a real-TCP proof that `debug::framing::FrameDecoder`
//! (S0's core, entirely unmodified here) correctly reassembles a fragmented
//! multi-message session read off an actual local socket — the concrete
//! "TCP 传输：复用 S0 的分帧状态机核心，只换字节来源" proof this slice's task
//! calls for.
//!
//! # Canary technique for TCP: "did the listener ever see a connection"
//!
//! Mirrors `debug::exec::tests`'s file-touch canary, adapted to this domain:
//! a `TcpListener` bound to an ephemeral loopback port plays the canary's
//! role. Standard sockets queue a completed TCP handshake in the listen
//! backlog even before the application calls `accept()`, so
//! "`accept()` (non-blocking, polled briefly) never observes a pending
//! connection" is exactly as strong a "this genuinely never tried to
//! connect" proof as "the canary file was never created" is for a spawn —
//! and, symmetrically, "`accept()` does observe one" is the positive-control
//! proof that the fixture (a real listening socket) was capable of receiving
//! a connection all along.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tempfile::TempDir;

use crate::debug::confirm::ConfirmationService;
use crate::debug::dto::{AdapterSpawnDescriptor, AdapterTransportKind, TcpConnectDescriptor};
use crate::debug::framing::FrameDecoder;
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

use super::{connect_adapter, connect_adapter_sync};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl FakePicker {
    fn selected(paths: Vec<std::path::PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn workspace_with_root(window_label: &str, root_path: &std::path::Path) -> WorkspaceService {
    workspace_with_roots(window_label, vec![root_path.to_path_buf()])
}

fn workspace_with_roots(
    window_label: &str,
    root_paths: Vec<std::path::PathBuf>,
) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(root_paths);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

fn root_id_at(workspace: &WorkspaceService, window_label: &str, index: usize) -> RootId {
    workspace.snapshot(window_label).unwrap().roots()[index].root_id()
}

fn arbitrary_root_id() -> RootId {
    RootId::parse_v4_wire("0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f").unwrap()
}

fn unconfirmed_confirmation_service() -> (TempDir, ConfirmationService) {
    let base = TempDir::new().unwrap();
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    (base, confirmation)
}

fn bind_loopback_listener() -> TcpListener {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds an ephemeral loopback port");
    listener
        .set_nonblocking(true)
        .expect("nonblocking mode for polling accept");
    listener
}

/// Polls `listener.accept()` (non-blocking) for up to `timeout`, returning
/// `true` the instant a pending connection is observed, `false` if the whole
/// window elapses without one.
fn observed_a_connection_within(listener: &TcpListener, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if listener.accept().is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

const NEVER_CONNECTS_POLL_WINDOW: Duration = Duration::from_millis(200);

fn tcp_descriptor(listener: &TcpListener) -> TcpConnectDescriptor {
    TcpConnectDescriptor {
        host: "127.0.0.1".to_owned(),
        port: listener.local_addr().unwrap().port(),
    }
}

fn command_descriptor() -> AdapterSpawnDescriptor {
    AdapterSpawnDescriptor {
        command: "/usr/bin/python3".to_owned(),
        args: vec!["-m".to_owned(), "debugpy.adapter".to_owned()],
    }
}

// ---------------------------------------------------------------------
// Trust gate — "never connects when untrusted" proof, plus empty-workspace.
// ---------------------------------------------------------------------

#[test]
fn connect_adapter_never_connects_when_the_workspace_is_untrusted() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let listener = bind_loopback_listener();

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        &confirmation,
        &command_descriptor(),
        &tcp_descriptor(&listener),
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
    assert!(
        !observed_a_connection_within(&listener, NEVER_CONNECTS_POLL_WINDOW),
        "an untrusted workspace must never open the TCP connection at all"
    );
}

#[test]
fn connect_adapter_rejects_the_empty_workspace_without_connecting() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let listener = bind_loopback_listener();

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        arbitrary_root_id(),
        &confirmation,
        &command_descriptor(),
        &tcp_descriptor(&listener),
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
    assert!(!observed_a_connection_within(
        &listener,
        NEVER_CONNECTS_POLL_WINDOW
    ));
}

#[test]
fn connect_adapter_rejects_a_removed_root_before_opening_a_socket() {
    let retained_root = TempDir::new().unwrap();
    let removed_root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_roots(
        "main",
        vec![
            retained_root.path().to_path_buf(),
            removed_root.path().to_path_buf(),
        ],
    );
    let removed_root_id = root_id_at(&workspace, "main", 1);
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let descriptor = command_descriptor();
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Tcp),
    ))
    .expect("confirmation grant succeeds");
    workspace
        .remove_root("main", removed_root_id)
        .expect("root removal succeeds");
    block_on(trust.grant(&workspace, "main")).expect("remaining topology trust succeeds");
    let listener = bind_loopback_listener();

    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        removed_root_id,
        &confirmation,
        &descriptor,
        &tcp_descriptor(&listener),
        Arc::new(AtomicBool::new(false)),
    ));
    assert_eq!(result.unwrap_err().code(), "ROOT_NOT_AUTHORIZED");
    assert!(!observed_a_connection_within(
        &listener,
        NEVER_CONNECTS_POLL_WINDOW
    ));
}

// ---------------------------------------------------------------------
// Confirmation gate — "never connects when trusted but unconfirmed" proof,
// plus its positive-control counterpart.
// ---------------------------------------------------------------------

#[test]
fn connect_adapter_never_connects_when_trusted_but_not_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let listener = bind_loopback_listener();

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        &confirmation,
        &command_descriptor(),
        &tcp_descriptor(&listener),
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(
        !observed_a_connection_within(&listener, NEVER_CONNECTS_POLL_WINDOW),
        "an unconfirmed (command, args, transport) triple must never connect, even in a trusted workspace"
    );
}

/// Positive control: the same fixture, with real trust granted AND the
/// matching `(command, args, "tcp")` subject confirmed, genuinely opens the
/// connection — proving the negative results above mean "a gate stopped it",
/// not "this fixture never connects regardless".
#[test]
fn connect_adapter_positive_control_connects_once_trusted_and_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let listener = bind_loopback_listener();

    let descriptor = command_descriptor();
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Tcp),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        &confirmation,
        &descriptor,
        &tcp_descriptor(&listener),
        cancel,
    ));
    assert!(
        result.is_ok(),
        "with real trust granted and the matching subject confirmed, the connection must succeed: {:?}",
        result.err()
    );
    assert!(
        observed_a_connection_within(&listener, Duration::from_secs(2)),
        "the listener must observe the real connection the gated primitive just opened"
    );
}

/// A confirmation granted for `"stdio"` must not silently cover the same
/// `command`/`args` under `"tcp"` — the connect-side analogue of `exec::tests`'s
/// args-sensitivity proof, this time varying the transport component.
#[test]
fn connect_adapter_rejects_a_subject_confirmed_only_for_stdio_transport() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let listener = bind_loopback_listener();

    let descriptor = command_descriptor();
    // Confirm the *stdio* transport for this exact command/args — the tcp
    // variant must remain unconfirmed.
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(connect_adapter(
        &trust,
        &workspace,
        "main",
        root_id_at(&workspace, "main", 0),
        &confirmation,
        &descriptor,
        &tcp_descriptor(&listener),
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(!observed_a_connection_within(
        &listener,
        NEVER_CONNECTS_POLL_WINDOW
    ));
}

// ---------------------------------------------------------------------
// `connect_adapter_sync` — cancellation and failure, exercised directly
// (bypassing the trust/confirmation gates, exactly like `exec::tests`
// exercises `spawn_adapter_sync` directly for the same class of behavior).
// ---------------------------------------------------------------------

#[test]
fn a_preset_cancel_flag_aborts_before_any_connection_attempt() {
    let listener = bind_loopback_listener();
    let descriptor = tcp_descriptor(&listener);
    let cancel = AtomicBool::new(true);
    let error = connect_adapter_sync(&descriptor, &cancel)
        .expect_err("a pre-set cancel flag must abort before connecting");
    assert_eq!(error.code(), "DEBUG_ADAPTER_CANCELLED");
    assert!(!observed_a_connection_within(
        &listener,
        NEVER_CONNECTS_POLL_WINDOW
    ));
}

#[test]
fn connecting_to_a_port_with_nothing_listening_fails_with_connect_failed() {
    // Bind, read the assigned ephemeral port, then drop the listener so the
    // port is (almost certainly) refusing new connections again.
    let port = {
        let listener = bind_loopback_listener();
        listener.local_addr().unwrap().port()
    };
    let descriptor = TcpConnectDescriptor {
        host: "127.0.0.1".to_owned(),
        port,
    };
    let cancel = AtomicBool::new(false);
    let error = connect_adapter_sync(&descriptor, &cancel)
        .expect_err("nothing is listening on this port anymore");
    assert_eq!(error.code(), "DEBUG_ADAPTER_CONNECT_FAILED");
}

#[test]
fn connect_adapter_sync_connects_to_a_real_listening_socket() {
    let listener = bind_loopback_listener();
    let descriptor = tcp_descriptor(&listener);
    let cancel = AtomicBool::new(false);
    let stream = connect_adapter_sync(&descriptor, &cancel)
        .expect("a real listening loopback socket must be reachable");
    drop(stream);
    assert!(observed_a_connection_within(
        &listener,
        Duration::from_secs(2)
    ));
}

// ---------------------------------------------------------------------
// Real-TCP framing proof: `debug::framing::FrameDecoder` — S0's core,
// unmodified — correctly reassembles a fragmented multi-message session read
// off a genuine local socket. "TCP 传输：复用 S0 的分帧状态机核心，只换字节
// 来源" — this is that proof.
// ---------------------------------------------------------------------

fn framed_message(body: &str) -> Vec<u8> {
    let mut framed = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    framed.extend_from_slice(body.as_bytes());
    framed
}

#[test]
fn frame_decoder_reassembles_a_fragmented_multi_message_session_over_a_real_tcp_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("binds an ephemeral loopback port");
    let port = listener.local_addr().unwrap().port();

    let message_one = framed_message(r#"{"seq":1,"type":"request","command":"initialize"}"#);
    let message_two =
        framed_message(r#"{"seq":0,"type":"response","request_seq":1,"success":true}"#);
    let message_three = framed_message(r#"{"seq":2,"type":"event","event":"initialized"}"#);
    let mut all_bytes = Vec::new();
    all_bytes.extend_from_slice(&message_one);
    all_bytes.extend_from_slice(&message_two);
    all_bytes.extend_from_slice(&message_three);

    // Writer: accept the one connection the test below establishes, then
    // dribble the combined byte stream out in small, deliberately
    // back-to-back-unaligned chunks with tiny pauses — the real-network
    // equivalent of the S0 in-memory "randomly split feeding" fixture,
    // proving the reassembly survives arbitrary TCP-level fragmentation, not
    // just synthetic byte slicing.
    let writer = std::thread::spawn(move || {
        let (mut stream, _addr) = listener.accept().expect("accepts the test's connection");
        const CHUNK_LEN: usize = 5;
        for chunk in all_bytes.chunks(CHUNK_LEN) {
            stream.write_all(chunk).expect("write succeeds");
            stream.flush().expect("flush succeeds");
            std::thread::sleep(Duration::from_millis(2));
        }
    });

    let mut client =
        TcpStream::connect(("127.0.0.1", port)).expect("connects to the local fixture listener");

    let mut decoder = FrameDecoder::new();
    let mut decoded = Vec::new();
    let mut buffer = [0_u8; 64];
    // Keep reading until all three messages have been decoded — a real
    // socket read can return anywhere from 1 byte to the whole remaining
    // stream per call, exactly the "arbitrarily-sized chunk" contract
    // `FrameDecoder::feed` is documented to handle.
    while decoded.len() < 3 {
        let read = client.read(&mut buffer).expect("read succeeds");
        assert!(read > 0, "the writer thread must not close early");
        let messages = decoder.feed(&buffer[..read]).expect("well-formed frames");
        decoded.extend(messages);
    }

    writer.join().expect("writer thread completes");

    assert_eq!(decoded.len(), 3);
    assert_eq!(
        String::from_utf8(decoded[0].body.clone()).unwrap(),
        r#"{"seq":1,"type":"request","command":"initialize"}"#
    );
    assert_eq!(
        String::from_utf8(decoded[1].body.clone()).unwrap(),
        r#"{"seq":0,"type":"response","request_seq":1,"success":true}"#
    );
    assert_eq!(
        String::from_utf8(decoded[2].body.clone()).unwrap(),
        r#"{"seq":2,"type":"event","event":"initialized"}"#
    );
}
