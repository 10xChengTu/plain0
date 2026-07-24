use std::future::Future;
use std::path::Path;
use std::sync::Arc;

use tempfile::TempDir;

use super::TrustService;
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

/// Authorizes `window_label` with a single root at `root_path` and returns
/// the fresh `WorkspaceService` — mirrors `backup::service::tests`'s own
/// `workspace_with_root` helper exactly.
fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

#[test]
fn empty_workspace_is_never_trusted() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(base.path().to_path_buf());

    assert!(!block_on(trust.is_trusted(&workspace, "main")).unwrap());
    assert_eq!(
        block_on(trust.require_trusted(&workspace, "main"))
            .unwrap_err()
            .code(),
        "WORKSPACE_NOT_TRUSTED"
    );
}

#[test]
fn empty_workspace_rejects_grant_and_revoke() {
    let base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(base.path().to_path_buf());

    assert_eq!(
        block_on(trust.grant(&workspace, "main"))
            .unwrap_err()
            .code(),
        "TRUST_UNAVAILABLE"
    );
    assert_eq!(
        block_on(trust.revoke(&workspace, "main"))
            .unwrap_err()
            .code(),
        "TRUST_UNAVAILABLE"
    );
}

#[test]
fn a_freshly_authorized_workspace_is_untrusted_until_granted() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(base.path().to_path_buf());

    assert!(!block_on(trust.is_trusted(&workspace, "main")).unwrap());
    block_on(trust.grant(&workspace, "main")).unwrap();
    assert!(block_on(trust.is_trusted(&workspace, "main")).unwrap());
    block_on(trust.require_trusted(&workspace, "main")).unwrap();
}

#[test]
fn revoke_undoes_a_grant_and_is_idempotent() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(base.path().to_path_buf());

    block_on(trust.grant(&workspace, "main")).unwrap();
    assert!(block_on(trust.is_trusted(&workspace, "main")).unwrap());

    block_on(trust.revoke(&workspace, "main")).unwrap();
    assert!(!block_on(trust.is_trusted(&workspace, "main")).unwrap());
    // Revoking an already-untrusted identity is a no-op success, not an
    // error.
    block_on(trust.revoke(&workspace, "main")).unwrap();
    assert!(!block_on(trust.is_trusted(&workspace, "main")).unwrap());
}

#[test]
fn trust_is_scoped_to_the_exact_root_set_identity() {
    let base = TempDir::new().unwrap();
    let root_a = TempDir::new().unwrap();
    let root_b = TempDir::new().unwrap();
    let trust = TrustService::new(base.path().to_path_buf());

    let workspace_a = workspace_with_root("main", root_a.path());
    block_on(trust.grant(&workspace_a, "main")).unwrap();
    assert!(block_on(trust.is_trusted(&workspace_a, "main")).unwrap());

    // A different root set (even in the same window label) is a distinct
    // identity and starts out untrusted, mirroring the backup domain's own
    // "root-set identity, not window/session identity" semantics.
    let workspace_b = workspace_with_root("main", root_b.path());
    assert!(!block_on(trust.is_trusted(&workspace_b, "main")).unwrap());
}

#[test]
fn trust_persists_across_a_simulated_restart() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();

    {
        let workspace = workspace_with_root("main", root.path());
        let trust = TrustService::new(base.path().to_path_buf());
        block_on(trust.grant(&workspace, "main")).unwrap();
    }

    // A brand new `TrustService` over the same `base_path` (standing in for
    // a fresh process launch) must still see the identity as trusted, and a
    // brand new `WorkspaceService`/window re-authorizing the exact same
    // ambient root reproduces the exact same identity.
    let workspace = workspace_with_root("second-window", root.path());
    let trust = TrustService::new(base.path().to_path_buf());
    assert!(block_on(trust.is_trusted(&workspace, "second-window")).unwrap());
}

#[test]
fn a_corrupted_trust_file_falls_back_to_distrust_everything() {
    let base = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).unwrap();
    assert!(block_on(trust.is_trusted(&workspace, "main")).unwrap());

    std::fs::write(
        base.path().join("trust").join("trusted.plain.json"),
        b"not valid json at all",
    )
    .unwrap();

    assert!(!block_on(trust.is_trusted(&workspace, "main")).unwrap());
}

#[test]
fn concurrent_grants_for_distinct_identities_all_land() {
    let base = TempDir::new().unwrap();
    let trust = Arc::new(TrustService::new(base.path().to_path_buf()));

    let roots: Vec<TempDir> = (0..8).map(|_| TempDir::new().unwrap()).collect();
    let workspaces: Vec<Arc<WorkspaceService>> = roots
        .iter()
        .enumerate()
        .map(|(index, root)| Arc::new(workspace_with_root(&format!("window-{index}"), root.path())))
        .collect();

    let handles: Vec<_> = workspaces
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, workspace)| {
            let trust = Arc::clone(&trust);
            std::thread::spawn(move || {
                block_on(trust.grant(&workspace, &format!("window-{index}"))).unwrap();
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }

    for (index, workspace) in workspaces.iter().enumerate() {
        assert!(
            block_on(trust.is_trusted(workspace, &format!("window-{index}"))).unwrap(),
            "identity {index} should have survived the concurrent gate"
        );
    }
}
