use tempfile::TempDir;

use crate::workspace::{stable_roots_identity, WorkspaceRootsIdentity};

use super::*;

fn identity(path: &str) -> WorkspaceRootsIdentity {
    WorkspaceRootsIdentity::from_test_digest(
        stable_roots_identity(&[PathBuf::from(path)]).expect("non-empty identity"),
    )
}

fn profile_entry(value: &str) -> LayoutStorageEntry {
    LayoutStorageEntry::new(
        LayoutStorageScope::Profile,
        "workbench.sideBar.size".to_owned(),
        value.to_owned(),
    )
}

fn workspace_entry(value: &str) -> LayoutStorageEntry {
    LayoutStorageEntry::new(
        LayoutStorageScope::Workspace,
        "workbench.sideBar.hidden".to_owned(),
        value.to_owned(),
    )
}

#[tokio::test]
async fn profile_and_workspace_layout_survive_a_service_restart() {
    let base = TempDir::new().expect("temp");
    let first = LayoutService::new(base.path().to_path_buf());
    let root = identity("/plain/layout-a");
    first
        .write(
            Some(root.clone()),
            vec![profile_entry("318"), workspace_entry("true")],
        )
        .await
        .expect("write");

    let restarted = LayoutService::new(base.path().to_path_buf());
    assert_eq!(
        restarted.read(Some(root)).await.expect("read").entries(),
        &[profile_entry("318"), workspace_entry("true")]
    );
}

#[tokio::test]
async fn workspace_layout_never_attaches_to_another_root_set_or_empty_window() {
    let base = TempDir::new().expect("temp");
    let service = LayoutService::new(base.path().to_path_buf());
    let first = identity("/plain/layout-a");
    let second = identity("/plain/layout-b");
    service
        .write(
            Some(first.clone()),
            vec![profile_entry("320"), workspace_entry("true")],
        )
        .await
        .expect("write first");

    assert_eq!(
        service.read(Some(second)).await.expect("second").entries(),
        &[profile_entry("320")]
    );
    assert_eq!(
        service.read(None).await.expect("empty").entries(),
        &[profile_entry("320")]
    );
    assert_eq!(
        service
            .write(None, vec![workspace_entry("false")])
            .await
            .unwrap_err()
            .code(),
        "LAYOUT_INVALID"
    );
}

#[tokio::test]
async fn corrupt_profile_is_quarantined_without_hiding_valid_workspace_state() {
    let base = TempDir::new().expect("temp");
    let service = LayoutService::new(base.path().to_path_buf());
    let root_identity = identity("/plain/layout-a");
    service
        .write(
            Some(root_identity.clone()),
            vec![profile_entry("300"), workspace_entry("true")],
        )
        .await
        .expect("write");
    std::fs::write(base.path().join("layout/profile.json"), b"not-json").expect("corrupt profile");

    assert_eq!(
        service
            .read(Some(root_identity))
            .await
            .expect("read")
            .entries(),
        &[workspace_entry("true")]
    );
    assert!(std::fs::read_dir(base.path().join("layout"))
        .expect("layout directory")
        .any(|entry| entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .starts_with(CORRUPT_PREFIX)));
}
