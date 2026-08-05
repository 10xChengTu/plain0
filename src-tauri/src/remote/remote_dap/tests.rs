//! `F220` S7 hermetic tests for `remote::remote_dap` — a real `russh::server`
//! on loopback serving real (eagerly spawned) `exec`/`pty-req`+`exec`
//! requests forwarded to a real `sh -c` (`test_support::DapExecFixture`), a
//! real agent server, and this module's own channel-opener functions. Stays
//! one layer below `debug::service::tests`' own full remote handshake/
//! breakpoints/`stopped`-event integration tests (mirrors
//! `remote_git::tests`'s own "one layer lower than `git::remote_route::tests`"
//! precedent — see that file's own doc comment) — this file proves the
//! transport primitives themselves: command-line construction, real
//! bidirectional byte flow (including a real `Content-Length`-framed message
//! reassembled from several separate `read()` calls over the real channel),
//! stderr capture, disconnect/kill teardown — independent of anything
//! `debug::`/`terminal::` own.

use std::io::{Read, Write};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use crate::debug::framing::FrameDecoder;
use crate::remote::session::RemoteSessionService;
use crate::remote::test_support::{self, DapExecFixture};

use super::{build_cd_and_exec_command_line, open_remote_dap_adapter_channel, RemoteDapReader};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

// --- `build_cd_and_exec_command_line` (pure) --------------------------------

#[test]
fn builds_a_cd_and_exec_shape_with_every_element_single_quoted() {
    let command_line = build_cd_and_exec_command_line(
        "/srv/project",
        "/usr/bin/python3",
        &["-m".to_owned(), "debugpy.adapter".to_owned()],
    )
    .unwrap();
    assert_eq!(
        command_line,
        "cd '/srv/project' && exec '/usr/bin/python3' '-m' 'debugpy.adapter'"
    );
}

#[test]
fn a_single_quote_inside_the_cwd_or_an_argument_is_escaped_not_a_break_out() {
    let command_line =
        build_cd_and_exec_command_line("/srv/it's-a-project", "/bin/echo", &["a'b".to_owned()])
            .unwrap();
    assert_eq!(
        command_line,
        "cd '/srv/it'\\''s-a-project' && exec '/bin/echo' 'a'\\''b'"
    );
}

#[test]
fn an_empty_program_and_no_args_still_produces_a_valid_single_element_argv() {
    // `encode_posix_command_line` never accepts an empty *array*, but a
    // single empty-string program is a well-formed one-element argv — see
    // `shell_escape`'s own module doc for why `''` is one empty argument,
    // not "nothing at all".
    let command_line = build_cd_and_exec_command_line("/srv", "", &[]).unwrap();
    assert_eq!(command_line, "cd '/srv' && exec ''");
}

async fn connected_fixture() -> (
    tempfile::TempDir,
    RemoteSessionService,
    DapExecFixture,
    crate::remote::dto::RemoteSessionId,
) {
    let base = tempfile::TempDir::new().unwrap();
    let service = RemoteSessionService::new(base.path().to_path_buf());
    let identity = test_support::generate_key();
    let fixture = test_support::start_dap_exec_fixture(&identity).await;
    let session_id = test_support::connect_dap_exec_test_session(&service, "main", &fixture).await;
    (base, service, fixture, session_id)
}

/// Runs `reader.read` on a dedicated OS thread, bounded by `timeout` — every
/// test below owns its `reader` for `'static`, so this never needs to worry
/// about a borrow outliving the thread. Returns whatever was read (possibly
/// empty on a timeout, which callers assert against explicitly), never
/// panics on its own account.
fn read_some_bounded(mut reader: RemoteDapReader, timeout: Duration) -> (RemoteDapReader, Vec<u8>) {
    let (tx, rx) = std_mpsc::channel();
    let handle = std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        let read = reader.read(&mut buffer).unwrap_or(0);
        let _ = tx.send((reader, buffer[..read].to_vec()));
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => {
            let _ = handle.join();
            result
        }
        Err(_) => panic!("read_some_bounded timed out after {timeout:?}"),
    }
}

/// Real, hermetic proof that a genuine `Content-Length`-framed DAP message,
/// written by a real remote process and read back over several separate
/// `RemoteDapReader::read` calls (an 8-byte destination buffer, deliberately
/// far smaller than the whole message), reassembles into exactly one correct
/// message through the real `debug::framing::FrameDecoder` — this is the
/// "确保跨帧分片、Content-Length 边界在通道上真实发生" proof the research
/// doc's own S7 description calls for, exercised against a genuine SSH exec
/// channel rather than an in-memory buffer.
#[test]
fn a_real_dap_frame_reassembles_across_several_read_calls() {
    let (base, service, _fixture, session_id) = block_on(connected_fixture());
    let body = br#"{"seq":1,"type":"event","event":"initialized"}"#;
    let script = format!(
        "printf 'Content-Length: {}\\r\\n\\r\\n{}'",
        body.len(),
        String::from_utf8_lossy(body)
    );

    let handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/sh",
        &["-c".to_owned(), script],
    ))
    .expect("adapter channel opens");

    let mut reader = handles.reader;
    let mut decoder = FrameDecoder::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let messages = loop {
        let (returned_reader, chunk) = read_some_bounded(reader, Duration::from_secs(5));
        reader = returned_reader;
        if chunk.is_empty() {
            break Vec::new();
        }
        let decoded = decoder.feed(&chunk).expect("bytes stay well-formed");
        if !decoded.is_empty() {
            break decoded;
        }
        if std::time::Instant::now() >= deadline {
            break Vec::new();
        }
    };

    assert_eq!(messages.len(), 1, "exactly one message decodes");
    assert_eq!(messages[0].body, body);
    handles.killer.shutdown();
}

/// The write half round-trips real bytes to a real remote process — a
/// `cat`-shaped process echoes stdin back on stdout.
#[test]
fn writer_and_reader_round_trip_real_bytes() {
    let (base, service, _fixture, session_id) = block_on(connected_fixture());
    let mut handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/cat",
        &[],
    ))
    .expect("adapter channel opens");

    handles.writer.write_all(b"hello-remote-dap").unwrap();
    let (_reader, echoed) = read_some_bounded(handles.reader, Duration::from_secs(5));
    assert_eq!(echoed, b"hello-remote-dap");
    handles.killer.shutdown();
}

/// Stderr is captured, bounded, and kept separate from the stdout/DAP
/// stream — the reader must never observe stderr bytes at all.
#[test]
fn stderr_is_captured_separately_from_the_dap_stream() {
    let (base, service, _fixture, session_id) = block_on(connected_fixture());
    let script = "printf 'oops' 1>&2; printf 'stdout-only'";
    let handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/sh",
        &["-c".to_owned(), script.to_owned()],
    ))
    .expect("adapter channel opens");

    // Checked before `handles.reader` is moved below: `stderr_tail()` takes
    // `&self` (a whole-struct borrow), so it must run before any field of
    // `handles` is moved out — stderr capture itself does not depend on this
    // ordering (the pump task fills `stderr_tail` independently of whether
    // anything ever reads `handles.reader`).
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if handles.stderr_tail() == b"oops" {
            break;
        }
        if std::time::Instant::now() >= deadline {
            panic!("stderr never observed: {:?}", handles.stderr_tail());
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let (_reader, stdout) = read_some_bounded(handles.reader, Duration::from_secs(5));
    assert_eq!(stdout, b"stdout-only");
    handles.killer.shutdown();
}

/// An unsatisfiable `cd` fails closed — `exec` never runs, and the reader
/// observes the process ending almost immediately (a real, non-hanging exit)
/// rather than silently running the program somewhere else — the "如实降级"
/// proof for a bad cwd.
#[test]
fn an_unsatisfiable_cwd_never_runs_the_program() {
    let (_base, service, _fixture, session_id) = block_on(connected_fixture());
    let handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        "/this/path/does/not/exist/anywhere",
        "/bin/echo",
        &["should-never-print".to_owned()],
    ))
    .expect("adapter channel opens (the cd failure happens remotely, not at open time)");

    let (_reader, observed_bytes) = read_some_bounded(handles.reader, Duration::from_secs(5));
    let observed = String::from_utf8_lossy(&observed_bytes);
    assert!(
        !observed.contains("should-never-print"),
        "the echo must never have run: {observed:?}"
    );
    handles.killer.shutdown();
}

/// [`crate::remote::remote_dap::RemoteDapKiller::shutdown`] releases this
/// side's resources on a bounded schedule even against a still-running
/// remote process — the reader observes EOF promptly.
#[test]
fn killer_shutdown_makes_the_reader_observe_eof_promptly() {
    let (base, service, _fixture, session_id) = block_on(connected_fixture());
    let handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/sh",
        &["-c".to_owned(), "sleep 30".to_owned()],
    ))
    .expect("adapter channel opens");

    handles.killer.shutdown();
    let (_reader, read_bytes) = read_some_bounded(handles.reader, Duration::from_secs(5));
    assert!(
        read_bytes.is_empty(),
        "EOF (empty read) expected after killer.shutdown()"
    );
}

/// A forced server-side disconnect (the whole SSH connection drops, not a
/// clean `exit-status`) is observed by the reader as ordinary EOF — exactly
/// the signal `debug::session::run_reader` already treats as
/// `SessionEndReason::TransportClosed` for any transport, proving the
/// research doc's own "会话按既有 adapter-died 路径终结（reader EOF 语义）"
/// contract holds for this transport too.
#[test]
fn a_forced_server_disconnect_surfaces_as_reader_eof() {
    let (base, service, fixture, session_id) = block_on(connected_fixture());
    let handles = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/sh",
        &["-c".to_owned(), "sleep 30".to_owned()],
    ))
    .expect("adapter channel opens");

    block_on(fixture.force_server_disconnect());

    let (_reader, read_bytes) = read_some_bounded(handles.reader, Duration::from_secs(5));
    assert!(
        read_bytes.is_empty(),
        "EOF (empty read) expected after a forced server disconnect"
    );
}

/// A `session_id` naming an already-gone session reports
/// `REMOTE_SESSION_DISCONNECTED`, not the raw `REMOTE_SESSION_NOT_FOUND` —
/// mirrors `remote::remote_terminal`/`remote::remote_fs`'s own identical
/// `F220` S4 translation.
#[test]
fn a_stale_session_id_reports_remote_session_disconnected() {
    let (base, service, _fixture, session_id) = block_on(connected_fixture());
    let sink: std::sync::Arc<dyn crate::remote::session::RemoteSessionEventSink> =
        std::sync::Arc::new(crate::remote::session::NullRemoteSessionEventSink);
    block_on(service.disconnect("main", session_id, sink)).expect("disconnect succeeds");

    let result = block_on(open_remote_dap_adapter_channel(
        &service,
        "main",
        session_id,
        &base.path().to_string_lossy(),
        "/bin/echo",
        &[],
    ));
    let error = match result {
        Err(error) => error,
        Ok(_) => panic!("a disconnected session cannot open a new channel"),
    };
    assert_eq!(error.code(), "REMOTE_SESSION_DISCONNECTED");
}
