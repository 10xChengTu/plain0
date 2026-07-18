use std::fs;

use tempfile::TempDir;

use super::{RootId, WorkspaceScope};
use crate::path_policy::RelativePath;

#[test]
fn isolates_multiple_roots_and_reuses_only_the_same_directory() {
    let temp = TempDir::new().expect("temporary directory");
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    fs::write(first.join("shared.txt"), b"first").unwrap();
    fs::write(second.join("shared.txt"), b"second").unwrap();

    let mut scope = WorkspaceScope::new();
    let first_id = scope.authorize_root(&first).unwrap();
    let first_again = scope.authorize_root(&first).unwrap();
    let second_id = scope.authorize_root(&second).unwrap();
    let first_after_second = scope.authorize_root(&first).unwrap();
    assert_eq!(first_id, first_again);
    assert_eq!(first_id, first_after_second);
    assert_ne!(first_id, second_id);
    let snapshot = scope.snapshot();
    assert_eq!(snapshot.roots().len(), 2);
    assert_eq!(snapshot.roots()[0].root_id(), first_id);
    assert_eq!(snapshot.roots()[1].root_id(), second_id);

    let path = RelativePath::parse_wire("shared.txt").unwrap();
    assert_eq!(read_resolved(&scope, first_id, &path), b"first");
    assert_eq!(read_resolved(&scope, second_id, &path), b"second");

    scope.remove(first_id).unwrap();
    let snapshot = scope.snapshot();
    assert_eq!(snapshot.roots().len(), 1);
    assert_eq!(snapshot.roots()[0].root_id(), second_id);
}

#[test]
fn rejects_unknown_and_revoked_roots() {
    let temp = TempDir::new().unwrap();
    let mut scope = WorkspaceScope::new();
    let authorized = scope.authorize_root(temp.path()).unwrap();
    let unknown: RootId = serde_json::from_str("\"00000000-0000-4000-8000-000000000000\"").unwrap();
    let root = RelativePath::parse_wire("").unwrap();

    assert_eq!(
        scope.resolve(unknown, &root).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
    scope.remove(authorized).unwrap();
    assert_eq!(
        scope.resolve(authorized, &root).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
    assert_eq!(
        scope.remove(authorized).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );
}

#[cfg(unix)]
#[test]
fn held_directory_handle_does_not_jump_when_the_ambient_root_is_replaced() {
    let temp = TempDir::new().unwrap();
    let selected = temp.path().join("selected");
    let original = temp.path().join("original-moved");
    fs::create_dir(&selected).unwrap();
    fs::write(selected.join("identity.txt"), b"original").unwrap();

    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&selected).unwrap();
    fs::rename(&selected, &original).unwrap();
    fs::create_dir(&selected).unwrap();
    fs::write(selected.join("identity.txt"), b"replacement").unwrap();

    let path = RelativePath::parse_wire("identity.txt").unwrap();
    assert_eq!(read_resolved(&scope, root_id, &path), b"original");
    let replacement_id = scope.authorize_root(&selected).unwrap();
    assert_ne!(root_id, replacement_id);
    assert_eq!(read_resolved(&scope, replacement_id, &path), b"replacement");
}

#[cfg(windows)]
#[test]
fn held_directory_handle_prevents_ambient_root_replacement() {
    let temp = TempDir::new().unwrap();
    let selected = temp.path().join("selected");
    let replacement_target = temp.path().join("replacement-target");
    fs::create_dir(&selected).unwrap();
    fs::write(selected.join("identity.txt"), b"original").unwrap();

    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&selected).unwrap();
    assert!(fs::rename(&selected, &replacement_target).is_err());

    let path = RelativePath::parse_wire("identity.txt").unwrap();
    assert_eq!(read_resolved(&scope, root_id, &path), b"original");
}

#[cfg(unix)]
#[test]
fn follows_internal_symlinks_but_rejects_external_symlinks() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    let outside = temp.path().join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("inside.txt"), b"inside").unwrap();
    fs::write(outside.join("secret.txt"), b"secret").unwrap();
    symlink("inside.txt", root.join("inside-link")).unwrap();
    symlink(outside.join("secret.txt"), root.join("outside-link")).unwrap();

    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&root).unwrap();
    let internal = RelativePath::parse_wire("inside-link").unwrap();
    assert_eq!(read_resolved(&scope, root_id, &internal), b"inside");

    let external = RelativePath::parse_wire("outside-link").unwrap();
    let error = scope.resolve(root_id, &external).unwrap_err();
    assert_eq!(error.code(), "PATH_OUTSIDE_ROOT");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));
}

#[test]
fn authorization_and_resolution_errors_do_not_expose_ambient_paths() {
    let temp = TempDir::new().unwrap();
    let secret = temp.path().join("private-user-name").join("missing-root");
    let mut scope = WorkspaceScope::new();
    let error = scope.authorize_root(&secret).unwrap_err();
    let json = serde_json::to_string(&error).unwrap();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert!(!json.contains("private-user-name"));
    assert!(!json.contains(temp.path().to_str().unwrap()));
    assert!(!json.contains("No such file"));
}

#[cfg(unix)]
#[test]
fn distinguishes_os_permission_errors_from_capability_escape_errors() {
    let os_denied = super::map_resolve_error(std::io::Error::from_raw_os_error(13));
    assert_eq!(os_denied.code(), "PERMISSION_DENIED");

    let capability_denied = super::map_resolve_error(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "capability escape",
    ));
    assert_eq!(capability_denied.code(), "PATH_OUTSIDE_ROOT");
}

fn read_resolved(scope: &WorkspaceScope, root_id: RootId, path: &RelativePath) -> Vec<u8> {
    let resolved = scope.resolve(root_id, path).expect("path resolves");
    assert_eq!(resolved.root_id(), root_id);
    resolved
        .directory()
        .read(resolved.relative_path())
        .expect("resolved entry reads")
}
