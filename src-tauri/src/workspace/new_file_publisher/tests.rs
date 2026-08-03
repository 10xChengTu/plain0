use cap_std::ambient_authority;
use tempfile::TempDir;

use super::{publish_file, publish_file_with_hook, publish_file_with_hooks, STAGING_PREFIX};
use crate::path_policy::RelativePath;
use crate::workspace::WorkspaceScope;

fn lease(temp: &TempDir) -> crate::workspace::WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let id = scope
        .authorize_roots_atomically(&[temp.path().to_path_buf()])
        .unwrap()[0];
    scope.lease(id).unwrap()
}

fn has_stage(temp: &TempDir) -> bool {
    std::fs::read_dir(temp.path()).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
    })
}

#[test]
fn publishes_exact_bytes_without_stage_residue() {
    let temp = TempDir::new().unwrap();
    let lease = lease(&temp);
    let path = RelativePath::parse_wire("new.txt").unwrap();
    let result = publish_file(&lease, &path, b"exact bytes").unwrap();
    assert!(result.written_stat().is_some());
    assert_eq!(
        std::fs::read(temp.path().join("new.txt")).unwrap(),
        b"exact bytes"
    );
    assert!(!has_stage(&temp));
}

#[test]
fn existing_regular_file_and_symlink_are_never_replaced() {
    let temp = TempDir::new().unwrap();
    std::fs::write(temp.path().join("existing.txt"), b"keep").unwrap();
    std::os::unix::fs::symlink("existing.txt", temp.path().join("link.txt")).unwrap();
    let lease = lease(&temp);
    for name in ["existing.txt", "link.txt"] {
        let error =
            publish_file(&lease, &RelativePath::parse_wire(name).unwrap(), b"replace").unwrap_err();
        assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    }
    assert_eq!(
        std::fs::read(temp.path().join("existing.txt")).unwrap(),
        b"keep"
    );
    assert!(!has_stage(&temp));
}

#[test]
fn a_racing_target_wins_without_being_overwritten_and_stage_is_removed() {
    let temp = TempDir::new().unwrap();
    let lease = lease(&temp);
    let path = RelativePath::parse_wire("race.txt").unwrap();
    let error = publish_file_with_hook(&lease, &path, b"ours", |parent, name| {
        parent.write(name, b"racer").unwrap();
    })
    .unwrap_err();
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    assert_eq!(
        std::fs::read(temp.path().join("race.txt")).unwrap(),
        b"racer"
    );
    assert!(!has_stage(&temp));
}

#[test]
fn missing_parent_fails_before_target_side_effect() {
    let temp = TempDir::new().unwrap();
    let lease = lease(&temp);
    let error = publish_file(
        &lease,
        &RelativePath::parse_wire("missing/new.txt").unwrap(),
        b"bytes",
    )
    .unwrap_err();
    assert_eq!(error.code(), "ENTRY_NOT_FOUND");
    assert!(!temp.path().join("missing").exists());
    assert!(!has_stage(&temp));
}

#[test]
fn target_is_visible_through_the_root_capability_after_publication() {
    let temp = TempDir::new().unwrap();
    let root = cap_std::fs::Dir::open_ambient_dir(temp.path(), ambient_authority()).unwrap();
    let lease = lease(&temp);
    publish_file(
        &lease,
        &RelativePath::parse_wire("visible.txt").unwrap(),
        b"visible",
    )
    .unwrap();
    assert_eq!(root.read("visible.txt").unwrap(), b"visible");
}

#[test]
fn group_or_world_writable_parent_is_rejected_without_residue() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().unwrap();
    std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o777)).unwrap();
    let lease = lease(&temp);
    let error = publish_file(
        &lease,
        &RelativePath::parse_wire("unsafe.txt").unwrap(),
        b"bytes",
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_STAGE_VERIFY_FAILED");
    assert!(!temp.path().join("unsafe.txt").exists());
    assert!(!has_stage(&temp));
}

#[test]
fn every_parent_component_metadata_participates_in_the_final_recheck() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().unwrap();
    let outer = temp.path().join("outer");
    let inner = outer.join("inner");
    std::fs::create_dir(&outer).unwrap();
    std::fs::create_dir(&inner).unwrap();
    let lease = lease(&temp);
    let error = publish_file_with_hooks(
        &lease,
        &RelativePath::parse_wire("outer/inner/new.txt").unwrap(),
        b"bytes",
        || {
            std::fs::set_permissions(&outer, std::fs::Permissions::from_mode(0o700)).unwrap();
        },
        |_, _| {},
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert!(!inner.join("new.txt").exists());
    assert!(!std::fs::read_dir(&inner).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
    }));
}
