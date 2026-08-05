//! `workspace::commands`'s own test module — split into this dedicated file
//! (rather than staying inline in `commands.rs`) because `F220` S4's
//! reconnect tests below need real fixture-side filesystem manipulation
//! (creating a hostile symlink to prove a "path now resolves elsewhere"
//! rejection, deleting a fixture directory to prove a "path is gone"
//! propagation, and a raw `to_string_lossy()` path→string conversion for
//! test setup) that `scripts/plain/boundary-contracts.mjs` correctly
//! forbids in ordinary production Rust sources — the same reason
//! `remote/session/tests.rs`, `remote/remote_fs/tests.rs`,
//! `remote/test_support.rs`, `workspace/service/tests.rs` and
//! `backup/service/tests.rs` are each their own file rather than an inline
//! `mod tests { .. }`: `WORKSPACE_TEST_SOURCE_PATTERN` exempts any file
//! literally named `tests.rs`/`test_support.rs`, not `#[cfg(test)]` blocks
//! wherever they happen to live. This file deliberately never names
//! `russh`/`russh::keys::ssh_key::PrivateKey` directly, even though it is
//! itself a `tests.rs` file: `validateRemoteSshLibraryOwnershipBoundary`
//! (the guard locking SSH-library usage to the `remote` domain) exempts by
//! *domain* — anything under `src-tauri/src/remote/` — not by filename, so
//! it does not recognize this file the way `WORKSPACE_TEST_SOURCE_PATTERN`
//! does. `remote::test_support::RemoteRootFixture` and its three helper
//! functions exist precisely so a test outside `remote/` can drive a full
//! connect/reconnect cycle without ever spelling out the SSH library's own
//! types — see that struct's own doc comment.

use tauri::ipc::{InvokeResponse, InvokeResponseBody, IpcResponse};

use super::raw_bytes_response;
use crate::error::CommandError;
use crate::recent::service::WorkspaceHistoryService;
use crate::remote::session::RemoteSessionService;
use crate::remote::test_support::{
    connect_remote_root_fixture, reconnect_remote_root_fixture, start_remote_root_fixture,
    test_service, RemoteRootFixture,
};
use crate::workspace::dto::{WorkspaceCapabilities, WorkspaceCapabilitiesRequest};
use crate::workspace::service::WorkspaceService;

#[test]
fn capabilities_are_an_exact_platform_closed_set() {
    let value = serde_json::to_value(WorkspaceCapabilities::current_platform())
        .expect("workspace capabilities serialize");
    let object = value
        .as_object()
        .expect("workspace capabilities are an object");
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "copyMove",
            "create",
            "delete",
            "renameNoReplace",
            "trash",
            "versionedWrite",
        ]
    );
    assert_eq!(value["create"], true);
    let namespace_mutations = cfg!(any(target_os = "linux", target_os = "macos"));
    for key in ["renameNoReplace", "copyMove", "delete", "versionedWrite"] {
        assert_eq!(value[key], namespace_mutations, "unexpected {key} value");
    }
    assert_eq!(value["trash"], cfg!(target_os = "macos"));
}

#[test]
fn capabilities_request_rejects_every_extra_field() {
    serde_json::from_value::<WorkspaceCapabilitiesRequest>(serde_json::json!({}))
        .expect("empty capability request is valid");
    assert!(
        serde_json::from_value::<WorkspaceCapabilitiesRequest>(serde_json::json!({
            "rootId": "00000000-0000-4000-8000-000000000001"
        }))
        .is_err()
    );
}

#[test]
fn file_response_uses_raw_ipc_bytes_instead_of_json_numbers() {
    let bytes = vec![0, 255, 128, 1, 0, 42];
    match raw_bytes_response(bytes.clone()).body().unwrap() {
        InvokeResponseBody::Raw(body) => assert_eq!(body, bytes),
        InvokeResponseBody::Json(_) => panic!("file bytes must not be JSON serialized"),
    }
}

#[test]
fn successful_empty_command_results_serialize_as_json_null() {
    let response: InvokeResponse = Result::<(), CommandError>::Ok(()).into();
    match response {
        InvokeResponse::Ok(InvokeResponseBody::Json(body)) => assert_eq!(body, "null"),
        InvokeResponse::Ok(InvokeResponseBody::Raw(_)) => {
            panic!("empty command success must use JSON null")
        }
        InvokeResponse::Err(_) => panic!("empty command success must not reject the invoke"),
    }
}

async fn base_path_of(remote_root_fixture: &RemoteRootFixture) -> String {
    tokio::fs::canonicalize(remote_root_fixture.fixture.served_dir.path())
        .await
        .expect("canonicalize fixture dir")
        .to_string_lossy()
        .into_owned()
}

/// Authorizes a fresh remote root against `remote_root_fixture` and returns
/// `(root_id, session_id, base_path)` — the common setup every reconnect
/// test below starts from.
async fn authorized_remote_root(
    service: &WorkspaceService,
    remote: &RemoteSessionService,
    window_label: &str,
    remote_root_fixture: &RemoteRootFixture,
) -> (
    super::super::RootId,
    crate::remote::dto::RemoteSessionId,
    String,
) {
    let session_id = connect_remote_root_fixture(remote, window_label, remote_root_fixture).await;
    let base_path = base_path_of(remote_root_fixture).await;
    let host_key_fingerprint = remote
        .session_host_key_fingerprint(window_label, session_id)
        .expect("live session has a fingerprint");
    let (root_id, _snapshot) = service
        .authorize_remote_root(
            window_label,
            session_id,
            &host_key_fingerprint,
            &base_path,
            "Test Root",
        )
        .expect("remote root authorizes");
    (root_id, session_id, base_path)
}

/// `F220` S4: a successful reconnect — same host (so the same
/// fingerprint), same still-existing path — rebinds the root onto the
/// new session and leaves everything else about it untouched.
#[tokio::test]
async fn reconnect_rebinds_the_root_onto_the_new_session_when_identity_and_path_both_match() {
    let remote_root_fixture = start_remote_root_fixture().await;
    let (_remote_temp, remote) = test_service();
    let service = WorkspaceService::new();
    let (root_id, first_session_id, base_path) =
        authorized_remote_root(&service, &remote, "window-a", &remote_root_fixture).await;

    let second_session_id =
        reconnect_remote_root_fixture(&remote, "window-a", &remote_root_fixture).await;
    assert_ne!(first_session_id, second_session_id);

    let snapshot =
        super::reconnect_remote_root(&service, &remote, "window-a", root_id, second_session_id)
            .await
            .expect("reconnect succeeds when identity and path both still match");
    assert!(snapshot
        .roots()
        .iter()
        .any(|root| root.root_id() == root_id));

    let context = service
        .remote_context("window-a", root_id)
        .unwrap()
        .expect("root is still remote-backed");
    assert_eq!(context.session_id, second_session_id);
    assert_eq!(context.base_path, base_path);
}

/// `F220` S4 (ADR 0006 §5): the freshly (re)connected session speaks for
/// a *different* host identity than the one this root was originally
/// authorized under — `REMOTE_ROOT_IDENTITY_CHANGED`, and the root keeps
/// pointing at its original session untouched.
#[tokio::test]
async fn reconnect_rejects_a_session_whose_live_fingerprint_does_not_match() {
    let remote_root_fixture_a = start_remote_root_fixture().await;
    let remote_root_fixture_b = start_remote_root_fixture().await;
    let (_remote_temp, remote) = test_service();
    let service = WorkspaceService::new();
    let (root_id, first_session_id, _base_path) =
        authorized_remote_root(&service, &remote, "window-a", &remote_root_fixture_a).await;

    // A live, real, but *differently identified* session — connecting to
    // a wholly different fixture, never this root's own host.
    let other_session_id =
        connect_remote_root_fixture(&remote, "window-a", &remote_root_fixture_b).await;

    let error =
        super::reconnect_remote_root(&service, &remote, "window-a", root_id, other_session_id)
            .await
            .expect_err("a different host identity must be rejected");
    assert_eq!(error.code(), "REMOTE_ROOT_IDENTITY_CHANGED");

    let context = service
        .remote_context("window-a", root_id)
        .unwrap()
        .expect("root is still remote-backed");
    assert_eq!(
        context.session_id, first_session_id,
        "root must be untouched"
    );
}

/// `F220` S4: the root's original directory has been deleted out from
/// under it since it was authorized — re-`realpath`ing it over the new
/// session fails outright (rather than resolving to something else), and
/// that failure (`remote::remote_fs::canonicalize_for_root`'s own,
/// unmodified `ENTRY_NOT_FOUND`) is propagated verbatim, not folded into
/// `REMOTE_ROOT_PATH_CHANGED`. The root is left untouched, so the same
/// reconnect can be retried later (e.g. after the directory reappears).
#[tokio::test]
async fn reconnect_propagates_canonicalize_for_roots_own_error_when_the_path_is_gone() {
    let remote_root_fixture = start_remote_root_fixture().await;
    let (_remote_temp, remote) = test_service();
    let service = WorkspaceService::new();
    let session_id = connect_remote_root_fixture(&remote, "window-a", &remote_root_fixture).await;
    tokio::fs::create_dir(
        remote_root_fixture
            .fixture
            .served_dir
            .path()
            .join("project"),
    )
    .await
    .expect("mkdir fixture project dir");
    let base_path = super::super::remote_backend::canonicalize_for_root(
        &remote,
        "window-a",
        session_id,
        &remote_root_fixture
            .fixture
            .served_dir
            .path()
            .join("project")
            .to_string_lossy(),
    )
    .await
    .expect("project dir canonicalizes");
    let host_key_fingerprint = remote
        .session_host_key_fingerprint("window-a", session_id)
        .unwrap();
    let (root_id, _snapshot) = service
        .authorize_remote_root(
            "window-a",
            session_id,
            &host_key_fingerprint,
            &base_path,
            "Test Root",
        )
        .expect("remote root authorizes");

    tokio::fs::remove_dir(
        remote_root_fixture
            .fixture
            .served_dir
            .path()
            .join("project"),
    )
    .await
    .expect("remove fixture project dir");

    let second_session_id =
        reconnect_remote_root_fixture(&remote, "window-a", &remote_root_fixture).await;
    let error =
        super::reconnect_remote_root(&service, &remote, "window-a", root_id, second_session_id)
            .await
            .expect_err("a vanished path cannot be re-canonicalized");
    assert_eq!(error.code(), "ENTRY_NOT_FOUND");

    let context = service
        .remote_context("window-a", root_id)
        .unwrap()
        .expect("root is still remote-backed");
    assert_eq!(context.session_id, session_id, "root must be untouched");
}

/// `F220` S4: the root's original directory name now resolves somewhere
/// *else* (replaced by a symlink to a different real directory) rather
/// than failing to resolve at all — `REMOTE_ROOT_PATH_CHANGED`, root
/// left untouched. Distinct scenario from the "path is gone entirely"
/// test above: this one exercises the actual mismatch branch, not
/// `canonicalize_for_root`'s own propagated failure.
#[cfg(unix)]
#[tokio::test]
async fn reconnect_rejects_a_path_that_now_resolves_somewhere_else() {
    let remote_root_fixture = start_remote_root_fixture().await;
    let (_remote_temp, remote) = test_service();
    let service = WorkspaceService::new();
    let session_id = connect_remote_root_fixture(&remote, "window-a", &remote_root_fixture).await;
    let served = remote_root_fixture.fixture.served_dir.path();
    tokio::fs::create_dir(served.join("project"))
        .await
        .expect("mkdir fixture project dir");
    tokio::fs::create_dir(served.join("elsewhere"))
        .await
        .expect("mkdir fixture elsewhere dir");
    let base_path = super::super::remote_backend::canonicalize_for_root(
        &remote,
        "window-a",
        session_id,
        &served.join("project").to_string_lossy(),
    )
    .await
    .expect("project dir canonicalizes");
    let host_key_fingerprint = remote
        .session_host_key_fingerprint("window-a", session_id)
        .unwrap();
    let (root_id, _snapshot) = service
        .authorize_remote_root(
            "window-a",
            session_id,
            &host_key_fingerprint,
            &base_path,
            "Test Root",
        )
        .expect("remote root authorizes");

    // Replace the real `project` directory with a symlink to a
    // different real directory — `project` still exists (so this is not
    // the "vanished" scenario above), but now `realpath`s to somewhere
    // else entirely.
    tokio::fs::remove_dir(served.join("project"))
        .await
        .expect("remove fixture project dir");
    tokio::fs::symlink(served.join("elsewhere"), served.join("project"))
        .await
        .expect("symlink project -> elsewhere");

    let second_session_id =
        reconnect_remote_root_fixture(&remote, "window-a", &remote_root_fixture).await;
    let error =
        super::reconnect_remote_root(&service, &remote, "window-a", root_id, second_session_id)
            .await
            .expect_err("a path that now resolves elsewhere must be rejected");
    assert_eq!(error.code(), "REMOTE_ROOT_PATH_CHANGED");

    let context = service
        .remote_context("window-a", root_id)
        .unwrap()
        .expect("root is still remote-backed");
    assert_eq!(context.session_id, session_id, "root must be untouched");
}

/// `F220` S4: `record_current_workspace`'s own degrade path — a remote
/// root whose session has already disconnected (so it no longer appears
/// in `RemoteSessionService::state`) is silently skipped rather than
/// failing the whole Recent write; a *live* remote root recorded
/// alongside it is unaffected. `authorize_remote_root_for_test` mints a
/// root bound to a `session_id` that was never actually connected —
/// exactly "a session that has disconnected" looks like from
/// `remote_history_roots`'s point of view (nothing in `remote.state`
/// will ever match it).
#[tokio::test]
async fn record_current_workspace_skips_a_remote_root_whose_session_has_disconnected() {
    let remote_root_fixture = start_remote_root_fixture().await;
    let (_remote_temp, remote) = test_service();
    let service = WorkspaceService::new();
    let (_live_root_id, live_session_id, _base_path) =
        authorized_remote_root(&service, &remote, "window-a", &remote_root_fixture).await;
    service
        .authorize_remote_root_for_test(
            "window-a",
            "SHA256:dead-dead-dead-dead",
            "/srv/dead",
            "Dead Root",
        )
        .expect("dead remote root authorizes");

    let history_temp = tempfile::TempDir::new().unwrap();
    let history = WorkspaceHistoryService::new(history_temp.path().to_path_buf());

    super::record_current_workspace("window-a", &service, &history, &remote)
        .await
        .expect("recording succeeds despite the disconnected remote root");

    let snapshot = history.snapshot().unwrap();
    assert_eq!(snapshot.entries.len(), 1);
    let entry = &snapshot.entries[0];
    assert_eq!(
        entry.remote_roots().len(),
        1,
        "only the live root is recorded"
    );
    assert_eq!(entry.remote_roots()[0].label(), "Test Root");
    assert!(entry
        .remote_roots()
        .iter()
        .all(|remote_root| remote_root.label() != "Dead Root"));

    let live_state = remote.state("window-a");
    assert!(live_state
        .sessions
        .iter()
        .any(|entry| entry.session_id == live_session_id));
}
