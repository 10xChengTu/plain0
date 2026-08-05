use std::fs;
use std::path::PathBuf;

use tempfile::TempDir;

use super::dto::WorkspaceCloseFolderRequest;
use super::{RootId, WorkspaceScope, MAX_WORKSPACE_ROOTS};
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

/// `F220` S2 (ADR 0007 §1 §2): remote root identity is `(host-key
/// fingerprint, canonical remote path)`, and the same identity deduplicates
/// exactly like a local root's device/inode identity does — reauthorizing
/// the identical `(fingerprint, path)` pair reuses the same [`RootId`],
/// while either field alone changing mints a genuinely distinct root.
#[test]
fn remote_root_identity_deduplicates_by_fingerprint_and_path_together() {
    let mut scope = WorkspaceScope::new();
    let fingerprint = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let other_fingerprint = "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    let first = scope
        .authorize_remote_root_for_test(fingerprint, "/srv/project", "Remote Project")
        .expect("first remote authorization succeeds");
    let reauthorized = scope
        .authorize_remote_root_for_test(fingerprint, "/srv/project", "Remote Project")
        .expect("reauthorizing the identical identity succeeds");
    assert_eq!(
        first, reauthorized,
        "same fingerprint and same path must deduplicate to the same root id"
    );
    assert_eq!(scope.snapshot().roots().len(), 1);

    let different_path = scope
        .authorize_remote_root_for_test(fingerprint, "/srv/other", "Remote Other")
        .expect("a distinct remote path authorizes");
    assert_ne!(
        first, different_path,
        "same fingerprint but a different path must not deduplicate"
    );

    let different_fingerprint = scope
        .authorize_remote_root_for_test(other_fingerprint, "/srv/project", "Remote Project")
        .expect("a distinct fingerprint authorizes");
    assert_ne!(
        first, different_fingerprint,
        "same path but a different fingerprint must not deduplicate"
    );
    assert_eq!(scope.snapshot().roots().len(), 3);
}

/// The 256-root ceiling is shared across backends, not doubled by adding a
/// second kind of root — proven here by filling it with one local root plus
/// 255 distinct remote roots (cheap: remote authorization touches no real
/// filesystem), then showing the 257th of *either* backend is rejected.
#[test]
fn remote_and_local_roots_share_one_workspace_root_limit() {
    let temp = TempDir::new().unwrap();
    let mut scope = WorkspaceScope::new();
    scope.authorize_root(temp.path()).unwrap();

    for index in 0..(MAX_WORKSPACE_ROOTS - 1) {
        scope
            .authorize_remote_root_for_test(
                "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                &format!("/srv/project-{index}"),
                "Remote Project",
            )
            .unwrap_or_else(|error| panic!("remote root {index} authorizes: {error:?}"));
    }
    assert_eq!(scope.snapshot().roots().len(), MAX_WORKSPACE_ROOTS);

    let overflow_remote = scope.authorize_remote_root_for_test(
        "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "/srv/one-too-many",
        "Remote Overflow",
    );
    assert_eq!(
        overflow_remote.unwrap_err().code(),
        "WORKSPACE_ROOT_LIMIT_EXCEEDED"
    );

    let overflow_local = TempDir::new().unwrap();
    assert_eq!(
        scope
            .authorize_root(overflow_local.path())
            .unwrap_err()
            .code(),
        "WORKSPACE_ROOT_LIMIT_EXCEEDED"
    );
}

/// `F220` S2 (ADR 0007 §5): every consumption point this slice swept —
/// `lease`/`resolve`/the singular `root_canonical_path` — fails closed with
/// `ROOT_BACKEND_UNSUPPORTED` for a remote-backed root, distinctly from
/// `ROOT_NOT_AUTHORIZED` for a root id the scope has never heard of at all.
#[test]
fn remote_backed_root_fails_closed_across_every_local_dir_consumption_point() {
    let mut scope = WorkspaceScope::new();
    let remote_id = scope
        .authorize_remote_root_for_test(
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root authorizes");
    let root_path = RelativePath::parse_wire("").unwrap();

    assert_eq!(
        scope.lease(remote_id).unwrap_err().code(),
        "ROOT_BACKEND_UNSUPPORTED"
    );
    assert_eq!(
        scope.resolve(remote_id, &root_path).unwrap_err().code(),
        "ROOT_BACKEND_UNSUPPORTED"
    );
    assert_eq!(
        scope.root_canonical_path(remote_id).unwrap_err().code(),
        "ROOT_BACKEND_UNSUPPORTED"
    );

    let unknown: RootId = serde_json::from_str("\"00000000-0000-4000-8000-000000000000\"").unwrap();
    assert_eq!(
        scope.root_canonical_path(unknown).unwrap_err().code(),
        "ROOT_NOT_AUTHORIZED",
        "an unknown root id must stay distinguishable from a known-but-remote one"
    );
}

/// The aggregate local-only lists (`root_canonical_paths`/`history_roots`)
/// silently exclude remote roots rather than erroring — they describe "every
/// root this concept currently applies to", not a lookup for one
/// caller-selected root (that is `root_canonical_path`'s job, proven fail-
/// closed above).
#[test]
fn aggregate_local_root_lists_silently_exclude_remote_roots() {
    let temp = TempDir::new().unwrap();
    let mut scope = WorkspaceScope::new();
    let local_id = scope.authorize_root(temp.path()).unwrap();
    scope
        .authorize_remote_root_for_test(
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root authorizes");

    let canonical_paths = scope.root_canonical_paths();
    assert_eq!(canonical_paths.len(), 1);
    assert_eq!(canonical_paths[0].0, local_id);

    let history = scope.history_roots();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].0, temp.path().canonicalize().unwrap());
}

/// The *per-root* storage identity (`root_storage_identities`, the backup
/// domain's key) covers both backends — ADR 0007 §2's own requirement that
/// the remote digest be implemented — and, as of `F220` S6, is also the
/// exact set of building blocks `stable_identity()`'s own mixed-backend path
/// folds into one whole-set digest (see that method's own doc comment).
#[test]
fn root_storage_identities_produce_distinct_reproducible_digests_for_both_backends() {
    let temp = TempDir::new().unwrap();
    let mut scope = WorkspaceScope::new();
    let local_id = scope.authorize_root(temp.path()).unwrap();
    let remote_id = scope
        .authorize_remote_root_for_test(
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root authorizes");
    let other_remote_id = scope
        .authorize_remote_root_for_test(
            "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "/srv/project",
            "Remote Project",
        )
        .expect("a distinct-fingerprint remote root authorizes");

    let identities = scope.root_storage_identities();
    assert_eq!(identities.len(), 3);
    let find = |root_id: RootId| {
        identities
            .iter()
            .find(|(candidate, _)| *candidate == root_id)
            .map(|(_, identity)| identity.as_dir_name().to_owned())
            .expect("every authorized root has a storage identity")
    };
    let local_digest = find(local_id);
    let remote_digest = find(remote_id);
    let other_remote_digest = find(other_remote_id);
    assert_ne!(local_digest, remote_digest);
    assert_ne!(remote_digest, other_remote_digest);
    assert_ne!(local_digest, other_remote_digest);

    // Reopening the identical local directory in a brand-new scope must
    // reproduce the local digest byte-for-byte (existing on-disk backup
    // partitions are keyed by this exact string) — this slice's refactor
    // must not have perturbed the pre-`F220` local hash construction.
    let mut reopened = WorkspaceScope::new();
    let reopened_local_id = reopened.authorize_root(temp.path()).unwrap();
    let reopened_identities = reopened.root_storage_identities();
    let reopened_digest = reopened_identities
        .iter()
        .find(|(candidate, _)| *candidate == reopened_local_id)
        .map(|(_, identity)| identity.as_dir_name().to_owned())
        .unwrap();
    assert_eq!(local_digest, reopened_digest);
}

/// Registers the `ROOT_BACKEND_UNSUPPORTED` code alongside this domain's
/// other stable-code assertions (mirrors the `error_constructors_have_
/// stable_codes` precedent every other domain's `mod.rs` keeps).
#[test]
fn root_backend_unsupported_has_a_stable_code() {
    assert_eq!(
        super::root_backend_unsupported().code(),
        "ROOT_BACKEND_UNSUPPORTED"
    );
}

// --- `F220` S6: `stable_identity()` extended to cover remote roots --------

/// `F220` S6 requirement 1: a purely-remote workspace (zero local roots) now
/// produces a real identity instead of `None` — this is the exact gap the
/// trust domain's own module doc previously recorded (`TrustService::grant`
/// reported `TRUST_UNAVAILABLE` for such a workspace because `stable_identity`
/// had nothing to hash). Covers zero local + one remote, and zero local +
/// several remote, since neither count is special-cased in the implementation.
#[test]
fn stable_identity_is_some_for_a_purely_remote_workspace_with_one_or_many_roots() {
    let mut single = WorkspaceScope::new();
    single
        .authorize_remote_root_for_test(
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/project",
            "Remote Project",
        )
        .expect("remote root authorizes");
    let identity = single.stable_identity();
    assert!(
        identity.is_some(),
        "a purely-remote workspace must now be able to produce a stable identity"
    );
    assert_eq!(identity.unwrap().as_dir_name().len(), 64);

    let mut several = WorkspaceScope::new();
    for index in 0..5 {
        several
            .authorize_remote_root_for_test(
                "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                &format!("/srv/project-{index}"),
                "Remote Project",
            )
            .expect("remote root authorizes");
    }
    assert!(several.stable_identity().is_some());
}

/// `F220` S6 requirement 2: the mixed-backend whole-set identity is
/// order-independent, exactly like the pre-existing local-only path already
/// is (`stable_identity_is_none_for_the_empty_scope_and_independent_of_
/// authorization_order`, above).
#[test]
fn stable_identity_for_a_mixed_workspace_is_independent_of_authorization_order() {
    let temp = TempDir::new().unwrap();
    let local_a = temp.path().join("local-a");
    let local_b = temp.path().join("local-b");
    fs::create_dir(&local_a).unwrap();
    fs::create_dir(&local_b).unwrap();
    let remote_fingerprint_a = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let remote_fingerprint_b = "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    let mut in_order = WorkspaceScope::new();
    in_order.authorize_root(&local_a).unwrap();
    in_order
        .authorize_remote_root_for_test(remote_fingerprint_a, "/srv/one", "Remote One")
        .unwrap();
    in_order.authorize_root(&local_b).unwrap();
    in_order
        .authorize_remote_root_for_test(remote_fingerprint_b, "/srv/two", "Remote Two")
        .unwrap();

    let mut reverse_order = WorkspaceScope::new();
    reverse_order
        .authorize_remote_root_for_test(remote_fingerprint_b, "/srv/two", "Remote Two")
        .unwrap();
    reverse_order.authorize_root(&local_b).unwrap();
    reverse_order
        .authorize_remote_root_for_test(remote_fingerprint_a, "/srv/one", "Remote One")
        .unwrap();
    reverse_order.authorize_root(&local_a).unwrap();

    assert_eq!(
        in_order.stable_identity().unwrap().as_dir_name(),
        reverse_order.stable_identity().unwrap().as_dir_name(),
        "a mixed local+remote root set's identity must not depend on \
         authorization order"
    );
}

/// `F220` S6 requirement 3: the purely-local hash construction must be
/// byte-for-byte unchanged by this slice — an already-granted local-only
/// trust record on disk must stay valid. Pinned against a literal,
/// hand-computed SHA-256 digest (domain separator `plain.workspace.roots-
/// identity.v1\0`, big-endian u32 path count, then each path's big-endian u64
/// byte length followed by its raw UTF-8 bytes) rather than merely comparing
/// two calls to the function to each other, so an accidental change to the
/// hash construction itself (not just a regression in order-independence)
/// would fail this test.
#[test]
fn stable_roots_identity_pins_a_known_hash_for_a_fixed_single_path_input() {
    let paths = vec![PathBuf::from("/plain/fixed/regression/path")];
    let identity =
        super::stable_roots_identity(&paths).expect("non-empty path set has an identity");
    assert_eq!(
        identity, "f4d90a9b8c00e7b42cc8579bceba8942109adbe11588ba6ae729a97de8278888",
        "the local-only hash construction must never change without a deliberate migration"
    );
}

/// `F220` S6: the new mixed-backend whole-set hash construction, pinned the
/// same way as [`stable_roots_identity_pins_a_known_hash_for_a_fixed_single_path_input`]
/// — a regression guard against an accidental change to
/// [`super::stable_mixed_roots_identity`]'s own domain separator, length-
/// prefixing, or sort order, computed independently (Python `hashlib`, not
/// by calling the function under test) against the same fixed inputs
/// [`root_storage_identities_produce_distinct_reproducible_digests_for_both_backends`]-style
/// tests already use elsewhere in this file.
#[test]
fn stable_mixed_roots_identity_pins_a_known_hash_for_fixed_digest_inputs() {
    let local_digest =
        "f4d90a9b8c00e7b42cc8579bceba8942109adbe11588ba6ae729a97de8278888".to_owned();
    let remote_digest =
        "7df330225d5ca7de5ae2cde9cc708175d45c423661732664e728f37f56b9fc49".to_owned();
    let mixed = super::stable_mixed_roots_identity(&[local_digest, remote_digest])
        .expect("non-empty digest set has an identity");
    assert_eq!(
        mixed,
        "d6a7f4dd737cdbdb507970ef329cc3ced95bfc48e999dac08cc5f4dc09070567"
    );

    assert!(super::stable_mixed_roots_identity(&[]).is_none());
}

fn read_resolved(scope: &WorkspaceScope, root_id: RootId, path: &RelativePath) -> Vec<u8> {
    let resolved = scope.resolve(root_id, path).expect("path resolves");
    assert_eq!(resolved.root_id(), root_id);
    resolved
        .directory()
        .read(resolved.relative_path())
        .expect("resolved entry reads")
}
