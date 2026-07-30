use std::future::Future;
use std::path::Path;

use tempfile::TempDir;

use super::ConfirmationService;
use crate::debug::dto::{AdapterConfirmationSubject, AdapterTransportKind};
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

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

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

/// Mirrors `trust::service::tests`/`backup::service::tests`'s own identical
/// `workspace_with_root` helper.
fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

fn subject(
    command: &str,
    args: &[&str],
    transport: AdapterTransportKind,
) -> AdapterConfirmationSubject {
    AdapterConfirmationSubject {
        command: command.to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        transport,
    }
}

fn debugpy_subject() -> AdapterConfirmationSubject {
    subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    )
}

#[test]
fn empty_workspace_is_never_confirmed() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
    assert_eq!(
        block_on(confirmation.require_confirmed(&workspace, "main", &subject))
            .unwrap_err()
            .code(),
        "DEBUG_ADAPTER_NOT_CONFIRMED"
    );
}

#[test]
fn empty_workspace_rejects_grant_and_revoke() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    assert_eq!(
        block_on(confirmation.grant(&workspace, "main", &subject))
            .unwrap_err()
            .code(),
        "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE"
    );
    assert_eq!(
        block_on(confirmation.revoke(&workspace, "main", &subject))
            .unwrap_err()
            .code(),
        "DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE"
    );
}

#[test]
fn a_freshly_authorized_workspace_is_unconfirmed_until_granted() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
    block_on(confirmation.grant(&workspace, "main", &subject)).unwrap();
    assert!(block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
}

#[test]
fn revoking_an_ungranted_subject_is_a_harmless_no_op() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    block_on(confirmation.revoke(&workspace, "main", &subject)).unwrap();
    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
}

/// "撤销后重新弹窗": granting, then revoking, must return to requiring
/// confirmation again — a revoke must never leave a stale affirmative state
/// behind.
#[test]
fn revoking_a_granted_subject_requires_reconfirmation() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    block_on(confirmation.grant(&workspace, "main", &subject)).unwrap();
    assert!(block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());

    block_on(confirmation.revoke(&workspace, "main", &subject)).unwrap();
    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
    assert_eq!(
        block_on(confirmation.require_confirmed(&workspace, "main", &subject))
            .unwrap_err()
            .code(),
        "DEBUG_ADAPTER_NOT_CONFIRMED"
    );
}

/// Three independent test cases, one per component of "主导会话裁定" item 2's
/// triple: granting one subject must never be mistaken for confirmation of a
/// subject that differs in exactly one field.
#[test]
fn a_different_command_is_not_confirmed_by_granting_the_original() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    block_on(confirmation.grant(&workspace, "main", &debugpy_subject())).unwrap();

    let edited_command = subject(
        "/usr/bin/python3.11",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &edited_command)).unwrap());
}

#[test]
fn different_args_are_not_confirmed_by_granting_the_original() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    block_on(confirmation.grant(&workspace, "main", &debugpy_subject())).unwrap();

    let edited_args = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter", "--extra-flag"],
        AdapterTransportKind::Stdio,
    );
    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &edited_args)).unwrap());
}

#[test]
fn a_different_transport_is_not_confirmed_by_granting_the_original() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    block_on(confirmation.grant(&workspace, "main", &debugpy_subject())).unwrap();

    let edited_transport = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Tcp,
    );
    assert!(!block_on(confirmation.is_confirmed(&workspace, "main", &edited_transport)).unwrap());
}

/// Persistence must be disk-backed, not merely in-memory: a fresh
/// `ConfirmationService` instance pointed at the same `base_path` must
/// observe an earlier instance's grant.
#[test]
fn confirmation_persists_across_independent_service_instances() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let subject = debugpy_subject();

    {
        let confirmation = ConfirmationService::new(base.path().to_path_buf());
        block_on(confirmation.grant(&workspace, "main", &subject)).unwrap();
    }

    let reopened = ConfirmationService::new(base.path().to_path_buf());
    assert!(block_on(reopened.is_confirmed(&workspace, "main", &subject)).unwrap());
}

/// Reopening the exact same root set under a different window label reaches
/// the same stable identity and therefore the same confirmation decisions —
/// mirroring `BackupService`'s own identity-not-session-scoped precedent.
#[test]
fn confirmation_is_scoped_to_stable_roots_identity_not_window_label() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    let first_window = workspace_with_root("window-a", root.path());
    block_on(confirmation.grant(&first_window, "window-a", &subject)).unwrap();

    let second_window = workspace_with_root("window-b", root.path());
    assert!(block_on(confirmation.is_confirmed(&second_window, "window-b", &subject)).unwrap());
}

#[test]
fn close_window_drops_the_cache_without_touching_disk_state() {
    let root = TempDir::new().unwrap();
    let base = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    let subject = debugpy_subject();

    block_on(confirmation.grant(&workspace, "main", &subject)).unwrap();
    confirmation.close_window("main");
    assert!(block_on(confirmation.is_confirmed(&workspace, "main", &subject)).unwrap());
}
