//! `F220` S5 hermetic tests for `remote::remote_terminal` — a real
//! `russh::server` on loopback (see `test_support::TerminalFixture`), a real
//! agent server, and this module's own `open_remote_terminal_channel` client
//! calls. Every scenario here exercises the real wire protocol end to end:
//! nothing about `pty-req`/`shell`/`window-change`/`exit-status`/
//! `exit-signal` is mocked.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

use crate::remote::test_support::{self, TerminalFixture};

use super::{open_remote_terminal_channel, RemoteTerminalExitOutcome};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

async fn connected_fixture() -> (
    tempfile::TempDir,
    crate::remote::session::RemoteSessionService,
    TerminalFixture,
    crate::remote::dto::RemoteSessionId,
) {
    let base = tempfile::TempDir::new().unwrap();
    let service = crate::remote::session::RemoteSessionService::new(base.path().to_path_buf());
    let identity = test_support::generate_key();
    let fixture = test_support::start_terminal_fixture(&identity).await;
    let session_id = test_support::connect_terminal_test_session(&service, "main", &fixture).await;
    (base, service, fixture, session_id)
}

#[test]
fn opens_a_channel_drives_pty_req_and_shell_and_reports_the_requested_geometry() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 100, 40)
            .await
            .expect("opens a pty/shell channel");
        drop(handles);

        let pty_request = fixture.last_pty_request().await;
        assert_eq!(
            pty_request,
            Some(("xterm-256color".to_owned(), 100, 40)),
            "pty-req must carry the requested cols/rows and the fixed local TERM value"
        );
    });
}

#[test]
fn input_written_through_the_writer_is_echoed_back_through_the_reader() {
    block_on(async {
        let (_base, service, _fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut writer = handles.writer;
        let mut reader = handles.reader;

        let reader_thread = std::thread::spawn(move || {
            let mut buffer = [0_u8; 64];
            let mut collected = Vec::new();
            while collected.len() < b"hello remote".len() {
                let read = reader.read(&mut buffer).expect("read succeeds");
                if read == 0 {
                    break;
                }
                collected.extend_from_slice(&buffer[..read]);
            }
            collected
        });

        // `Write::write_all` internally blocks on the async channel-send
        // (see `RemoteTerminalWriter`'s own doc comment) — like every other
        // backend method built the same way, it must run on a plain OS
        // thread, never directly inside an already-running async task (this
        // test's own outer `block_on`), or the nested `block_on` panics.
        // `TerminalService::input_text`'s real production call site already
        // goes through `tauri::async_runtime::spawn_blocking` for exactly
        // this reason.
        std::thread::spawn(move || writer.write_all(b"hello remote").expect("write succeeds"))
            .join()
            .expect("writer thread joins");

        let collected = reader_thread.join().expect("reader thread joins");
        assert_eq!(collected, b"hello remote");
    });
}

#[test]
fn resize_sends_a_real_window_change_request_with_the_new_geometry() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");

        // See `input_written_through_the_writer_is_echoed_back_through_the_reader`'s
        // own comment on why this runs on a plain OS thread rather than
        // directly inside this test's outer `block_on`.
        std::thread::spawn(move || {
            handles
                .resizer
                .window_change(120, 48)
                .expect("resize succeeds")
        })
        .join()
        .expect("resizer thread joins");

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if fixture.last_window_change().await == Some((120, 48)) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "the fixture must observe a real window-change request for the new geometry"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
}

#[test]
fn a_normal_exit_status_maps_to_the_exited_outcome() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut waiter = handles.waiter;
        drop(handles.writer);
        drop(handles.reader);

        fixture.exit_normally(0).await;

        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            tauri::async_runtime::spawn_blocking(move || waiter.wait_exit()),
        )
        .await
        .expect("wait_exit resolves before the test timeout")
        .expect("spawn_blocking join succeeds");
        assert_eq!(outcome, RemoteTerminalExitOutcome::Exited { code: 0 });
    });
}

#[test]
fn a_nonzero_exit_status_is_carried_through_exactly() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut waiter = handles.waiter;
        drop(handles.writer);
        drop(handles.reader);

        fixture.exit_normally(17).await;

        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            tauri::async_runtime::spawn_blocking(move || waiter.wait_exit()),
        )
        .await
        .expect("wait_exit resolves before the test timeout")
        .expect("spawn_blocking join succeeds");
        assert_eq!(outcome, RemoteTerminalExitOutcome::Exited { code: 17 });
    });
}

#[test]
fn a_real_exit_signal_maps_to_the_signaled_outcome_with_its_readable_name() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut waiter = handles.waiter;
        drop(handles.writer);
        drop(handles.reader);

        fixture.exit_with_signal("TERM").await;

        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            tauri::async_runtime::spawn_blocking(move || waiter.wait_exit()),
        )
        .await
        .expect("wait_exit resolves before the test timeout")
        .expect("spawn_blocking join succeeds");
        assert_eq!(
            outcome,
            RemoteTerminalExitOutcome::Signaled {
                signal: "TERM".to_owned()
            }
        );
    });
}

/// The channel-level analogue of "the peer disappeared without ever telling
/// us why" — a whole-session disconnect (no `exit-status`/`exit-signal` for
/// this fixture's one live channel, ever) must report
/// [`RemoteTerminalExitOutcome::Disconnected`], never a disguised normal
/// exit, and the reader must observe real end-of-file.
#[test]
fn a_whole_session_disconnect_with_no_exit_status_maps_to_the_disconnected_outcome() {
    block_on(async {
        let (_base, service, fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut waiter = handles.waiter;
        let mut reader = handles.reader;
        drop(handles.writer);

        fixture.force_server_disconnect().await;

        let read_thread = std::thread::spawn(move || {
            let mut buffer = [0_u8; 8];
            reader.read(&mut buffer)
        });
        let eof = read_thread
            .join()
            .expect("reader thread joins")
            .expect("read completes without an I/O error");
        assert_eq!(eof, 0, "the reader must observe real end-of-file");

        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            tauri::async_runtime::spawn_blocking(move || waiter.wait_exit()),
        )
        .await
        .expect("wait_exit resolves before the test timeout")
        .expect("spawn_blocking join succeeds");
        assert_eq!(outcome, RemoteTerminalExitOutcome::Disconnected);
    });
}

/// `RemoteTerminalKiller::shutdown`'s own "graceful signal, then
/// unconditional local release" contract (see that method's own doc
/// comment): the fixture cooperatively acks the close (see
/// `TerminalTestSshHandler::channel_close`), so this resolves promptly
/// rather than needing the full `REMOTE_TERMINAL_KILL_GRACE` grace window —
/// but either way, `shutdown` must return, the reader must observe EOF, and
/// the waiter must report `Disconnected` (a kill was never a real exit).
#[test]
fn kill_releases_local_resources_and_reports_disconnected() {
    block_on(async {
        let (_base, service, _fixture, session_id) = connected_fixture().await;
        let handles = open_remote_terminal_channel(&service, "main", session_id, 80, 24)
            .await
            .expect("opens a pty/shell channel");
        let mut killer = handles.killer;
        let mut waiter = handles.waiter;
        let mut reader = handles.reader;
        drop(handles.writer);

        let started = Instant::now();
        tauri::async_runtime::spawn_blocking(move || {
            killer.shutdown().expect("shutdown reports Ok");
        })
        .await
        .expect("spawn_blocking join succeeds");
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "a cooperative close must not need the full forced-release grace window"
        );

        let read_thread = std::thread::spawn(move || {
            let mut buffer = [0_u8; 8];
            reader.read(&mut buffer)
        });
        let eof = read_thread
            .join()
            .expect("reader thread joins")
            .expect("read completes without an I/O error");
        assert_eq!(
            eof, 0,
            "the reader must observe real end-of-file after kill"
        );

        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            tauri::async_runtime::spawn_blocking(move || waiter.wait_exit()),
        )
        .await
        .expect("wait_exit resolves before the test timeout")
        .expect("spawn_blocking join succeeds");
        assert_eq!(outcome, RemoteTerminalExitOutcome::Disconnected);
    });
}

/// `F220` S4 parity (see `open_remote_terminal_channel`'s own doc comment):
/// a `session_id` that no longer names a live session reports the same
/// `REMOTE_SESSION_DISCONNECTED` translation `remote::remote_fs::open`
/// already performs for the SFTP path, never the raw "never existed"
/// `REMOTE_SESSION_NOT_FOUND`.
#[test]
fn a_session_id_that_no_longer_exists_reports_session_disconnected() {
    block_on(async {
        let base = tempfile::TempDir::new().unwrap();
        let service = crate::remote::session::RemoteSessionService::new(base.path().to_path_buf());
        let bogus_session_id = crate::remote::dto::RemoteSessionId::new();

        let result = open_remote_terminal_channel(&service, "main", bogus_session_id, 80, 24).await;
        match result {
            Ok(_) => panic!("a never-connected session id must not open a channel"),
            Err(error) => assert_eq!(error.code(), "REMOTE_SESSION_DISCONNECTED"),
        }
    });
}
