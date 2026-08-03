use std::fs;
use std::path::PathBuf;

use tempfile::TempDir;

use super::dto::WorkspaceCloseFolderRequest;
use super::{RootId, WorkspaceScope};
use crate::error::CommandError;
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

#[test]
fn clear_roots_is_atomic_revisioned_and_idempotent() {
    let temp = TempDir::new().unwrap();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();
    let mut scope = WorkspaceScope::new();
    let root_ids = scope.authorize_roots_atomically(&[first, second]).unwrap();
    let before_revision = scope.snapshot().revision();

    assert!(scope.clear_roots().unwrap());
    let cleared = scope.snapshot();
    assert_eq!(cleared.revision(), before_revision + 1);
    assert!(cleared.roots().is_empty());
    for root_id in root_ids {
        assert_eq!(
            scope
                .resolve(root_id, &RelativePath::parse_wire("").unwrap())
                .unwrap_err()
                .code(),
            "ROOT_NOT_AUTHORIZED"
        );
    }

    assert!(!scope.clear_roots().unwrap());
    assert_eq!(scope.snapshot(), cleared);
}

#[test]
fn close_folder_request_is_closed_and_empty() {
    assert!(serde_json::from_value::<WorkspaceCloseFolderRequest>(serde_json::json!({})).is_ok());
    assert!(
        serde_json::from_value::<WorkspaceCloseFolderRequest>(serde_json::json!({
            "rootId": "00000000-0000-4000-8000-000000000000",
        }))
        .is_err()
    );
}

#[test]
fn replace_is_atomic_reuses_existing_identity_and_revokes_old_capabilities() {
    let temp = TempDir::new().unwrap();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    let third = temp.path().join("third");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();
    fs::create_dir(&third).unwrap();
    fs::write(first.join("identity.txt"), b"first").unwrap();
    fs::write(second.join("identity.txt"), b"second").unwrap();

    let mut scope = WorkspaceScope::new();
    let ids = scope
        .authorize_roots_atomically(&[first.clone(), second.clone()])
        .unwrap();
    let first_id = ids[0];
    let second_id = ids[1];

    let selected = scope.replace_root_atomically(&first).unwrap();
    assert_eq!(selected, first_id);
    assert_eq!(scope.snapshot().revision(), 2);
    assert_eq!(scope.snapshot().roots().len(), 1);
    assert_eq!(scope.snapshot().roots()[0].root_id(), first_id);
    let root_path = RelativePath::parse_wire("").unwrap();
    assert_eq!(
        scope.resolve(second_id, &root_path).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );

    let unchanged = scope.snapshot();
    assert_eq!(scope.replace_root_atomically(&first).unwrap(), first_id);
    assert_eq!(scope.snapshot(), unchanged);

    let third_id = scope.replace_root_atomically(&third).unwrap();
    assert_ne!(third_id, first_id);
    assert_eq!(scope.snapshot().revision(), 3);
    assert_eq!(
        scope.resolve(first_id, &root_path).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED"
    );

    let before_failure = scope.snapshot();
    let error = scope
        .replace_root_atomically(&temp.path().join("private-missing"))
        .unwrap_err();
    assert_eq!(error.code(), "ROOT_UNAVAILABLE");
    assert_eq!(scope.snapshot(), before_failure);
}

#[test]
fn watcher_preparation_failure_preserves_the_complete_scope_transaction() {
    let temp = TempDir::new().unwrap();
    let existing = temp.path().join("existing");
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir(&existing).unwrap();
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();

    let mut scope = WorkspaceScope::new();
    scope.authorize_root(&existing).unwrap();
    let before_add = scope.snapshot();
    let mut prepared = Vec::new();
    let error = scope
        .authorize_roots_atomically_with(&[first.clone(), second.clone()], |_, path, lease| {
            assert!(path.is_absolute());
            assert!(lease.directory().dir_metadata().unwrap().is_dir());
            prepared.push(path.to_path_buf());
            if prepared.len() == 2 {
                Err(CommandError::new(
                    "WORKSPACE_WATCH_UNAVAILABLE",
                    "The workspace watcher could not be started.",
                ))
            } else {
                Ok(())
            }
        })
        .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WATCH_UNAVAILABLE");
    assert_eq!(prepared.len(), 2);
    assert_eq!(scope.snapshot(), before_add);

    let before_replace = scope.snapshot();
    let error = scope
        .replace_root_atomically_with(&first, |_, path, _| {
            assert!(path.is_absolute());
            Err(CommandError::new(
                "WORKSPACE_WATCH_UNAVAILABLE",
                "The workspace watcher could not be started.",
            ))
        })
        .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_WATCH_UNAVAILABLE");
    assert_eq!(scope.snapshot(), before_replace);
}

#[cfg(unix)]
#[test]
fn replace_through_an_alias_preserves_the_original_display_name() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let original = temp.path().join("original-name");
    let other = temp.path().join("other");
    let alias = temp.path().join("alias-name");
    fs::create_dir(&original).unwrap();
    fs::create_dir(&other).unwrap();
    symlink(&original, &alias).unwrap();

    let mut scope = WorkspaceScope::new();
    let ids = scope
        .authorize_roots_atomically(&[original, other])
        .unwrap();
    assert_eq!(scope.replace_root_atomically(&alias).unwrap(), ids[0]);
    let snapshot = scope.snapshot();
    assert_eq!(snapshot.roots().len(), 1);
    assert_eq!(snapshot.roots()[0].root_id(), ids[0]);
    assert_eq!(snapshot.roots()[0].display_name(), "original-name");
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

#[test]
fn stable_identity_is_none_for_the_empty_scope_and_independent_of_authorization_order() {
    let temp = TempDir::new().unwrap();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();

    let empty = WorkspaceScope::new();
    assert!(empty.stable_identity().is_none());

    let mut in_order = WorkspaceScope::new();
    in_order.authorize_root(&first).unwrap();
    in_order.authorize_root(&second).unwrap();

    let mut reverse_order = WorkspaceScope::new();
    reverse_order.authorize_root(&second).unwrap();
    reverse_order.authorize_root(&first).unwrap();

    let in_order_identity = in_order.stable_identity().expect("non-empty scope");
    let reverse_order_identity = reverse_order.stable_identity().expect("non-empty scope");
    assert_eq!(
        in_order_identity.as_dir_name(),
        reverse_order_identity.as_dir_name(),
        "identity must not depend on the order roots were authorized in"
    );
    assert_eq!(in_order_identity.as_dir_name().len(), 64);
    assert!(in_order_identity
        .as_dir_name()
        .bytes()
        .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')));
}

#[test]
fn stable_identity_changes_with_add_remove_and_replace_and_is_reproducible_on_reauthorization() {
    let temp = TempDir::new().unwrap();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir(&first).unwrap();
    fs::create_dir(&second).unwrap();

    let mut scope = WorkspaceScope::new();
    let first_id = scope.authorize_root(&first).unwrap();
    let identity_with_first_only = scope.stable_identity().unwrap();

    scope.authorize_root(&second).unwrap();
    let identity_with_both = scope.stable_identity().unwrap();
    assert_ne!(
        identity_with_first_only.as_dir_name(),
        identity_with_both.as_dir_name()
    );

    scope.remove(first_id).unwrap();
    let identity_with_second_only = scope.stable_identity().unwrap();
    assert_ne!(
        identity_with_second_only.as_dir_name(),
        identity_with_first_only.as_dir_name()
    );
    assert_ne!(
        identity_with_second_only.as_dir_name(),
        identity_with_both.as_dir_name()
    );

    // Replacing the sole root back to `first` reproduces the exact same
    // identity the scope had when `first` was previously its only root.
    scope.replace_root_atomically(&first).unwrap();
    assert_eq!(
        scope.stable_identity().unwrap().as_dir_name(),
        identity_with_first_only.as_dir_name()
    );

    // A brand-new scope that reauthorizes exactly `first` again (simulating
    // reopening the same folder in a fresh session/window/process)
    // reproduces the identical identity string, byte for byte.
    let mut reopened = WorkspaceScope::new();
    reopened.authorize_root(&first).unwrap();
    assert_eq!(
        reopened.stable_identity().unwrap().as_dir_name(),
        identity_with_first_only.as_dir_name()
    );

    assert!(scope.remove(scope.root_ids()[0]).is_ok());
    assert!(scope.stable_identity().is_none());
}

/// Adversarial concatenation-ambiguity matrix for the pure hashing function:
/// distinct path sets that would collide under naive separator-free
/// concatenation must still hash to distinct identities.
#[test]
fn stable_roots_identity_never_collides_across_naive_concatenation_ambiguity() {
    let matrix: [(&[&str], &[&str]); 3] = [
        (&["/a/b", "/c"], &["/a", "/b/c"]),
        (&["/ab", "/c"], &["/a", "/bc"]),
        (&["/a", "/b", "/c"], &["/a", "/bc"]),
    ];
    for (left, right) in matrix {
        let left_paths: Vec<PathBuf> = left.iter().map(PathBuf::from).collect();
        let right_paths: Vec<PathBuf> = right.iter().map(PathBuf::from).collect();
        let left_identity =
            super::stable_roots_identity(&left_paths).expect("non-empty set has an identity");
        let right_identity =
            super::stable_roots_identity(&right_paths).expect("non-empty set has an identity");
        assert_ne!(
            left_identity, right_identity,
            "{left:?} and {right:?} must not collide"
        );
    }

    assert!(super::stable_roots_identity(&[]).is_none());
    assert_eq!(
        super::stable_roots_identity(&[PathBuf::from("/a")]),
        super::stable_roots_identity(&[PathBuf::from("/a")]),
        "identical single-root input is reproducible"
    );
}

fn read_resolved(scope: &WorkspaceScope, root_id: RootId, path: &RelativePath) -> Vec<u8> {
    let resolved = scope.resolve(root_id, path).expect("path resolves");
    assert_eq!(resolved.root_id(), root_id);
    resolved
        .directory()
        .read(resolved.relative_path())
        .expect("resolved entry reads")
}
