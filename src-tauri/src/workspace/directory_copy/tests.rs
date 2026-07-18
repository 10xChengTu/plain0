use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::{
    checked_limited_u64, checked_limited_usize, copy_directory_with_limits_and_hooks, decode_name,
    DirectoryCopyHooks, DirectoryCopyLimits, ManifestBudget, DIRECTORY_COPY_LIMITS,
    DIRECTORY_STAGING_PREFIX,
};
use crate::path_policy::RelativePath;
use crate::workspace::{writer::copy_entry, WorkspaceRootLease, WorkspaceScope};

#[test]
fn checked_accumulators_accept_exact_limits_and_reject_probe_and_overflow() {
    assert_eq!(checked_limited_usize(8, 2, 10).unwrap(), 10);
    assert_eq!(checked_limited_u64(8, 2, 10).unwrap(), 10);
    for error in [
        checked_limited_usize(10, 1, 10).unwrap_err(),
        checked_limited_usize(usize::MAX, 1, usize::MAX).unwrap_err(),
        checked_limited_u64(10, 1, 10).unwrap_err(),
        checked_limited_u64(u64::MAX, 1, u64::MAX).unwrap_err(),
    ] {
        assert_directory_too_large(error);
    }
}

#[test]
fn manifest_budget_checks_every_aggregate_before_mutating_state() {
    let limits = limits(2, 4, 5, 2, 4, 5, 4, 5);
    let mut budget = ManifestBudget::default();
    budget.reserve_entry_name(2, limits).unwrap();
    budget.add_leaf_payload(2, 2, limits).unwrap();
    budget.reserve_entry_name(2, limits).unwrap();
    budget.add_leaf_payload(2, 2, limits).unwrap();
    assert_eq!(budget.descendants, 2);
    assert_eq!(budget.name_bytes, 4);
    assert_eq!(budget.link_bytes, 4);
    assert_eq!(budget.file_bytes, 4);
    assert_directory_too_large(budget.reserve_entry_name(1, limits).unwrap_err());
}

#[cfg(unix)]
#[test]
fn non_utf8_and_oversized_names_have_distinct_stable_errors() {
    use std::os::unix::ffi::OsStringExt;

    let encoding = decode_name(
        std::ffi::OsString::from_vec(b"private-\xff".to_vec()),
        1_024,
    )
    .unwrap_err();
    assert_eq!(encoding.code(), "PATH_ENCODING_UNSUPPORTED");
    assert_eq!(
        encoding.message(),
        "The workspace entry name cannot be represented safely."
    );
    let oversized = decode_name(std::ffi::OsString::from("abc"), 2).unwrap_err();
    assert_directory_too_large(oversized);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn copies_mixed_and_empty_trees_in_same_and_different_roots() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{symlink, PermissionsExt};

    let temp = TempDir::new().unwrap();
    let source_root = make_dir(temp.path(), "source-root");
    let target_root = make_dir(temp.path(), "target-root");
    let outside = make_dir(temp.path(), "outside");
    fs::write(outside.join("sentinel"), b"outside").unwrap();
    fs::create_dir(source_root.join("tree")).unwrap();
    fs::create_dir_all(source_root.join("tree/nested/empty")).unwrap();
    fs::write(
        source_root.join("tree/nested/data.bin"),
        b"plain-directory-copy",
    )
    .unwrap();
    symlink("../missing", source_root.join("tree/nested/dangling")).unwrap();
    symlink("data.bin", source_root.join("tree/nested/internal")).unwrap();
    symlink("loop", source_root.join("tree/loop")).unwrap();
    symlink(outside.join("sentinel"), source_root.join("tree/external")).unwrap();
    symlink("/plain/absolute/target", source_root.join("tree/absolute")).unwrap();
    symlink(
        std::ffi::OsStr::from_bytes(b"raw-\xff-target"),
        source_root.join("tree/non-utf8"),
    )
    .unwrap();
    fs::set_permissions(
        source_root.join("tree/nested"),
        fs::Permissions::from_mode(0o751),
    )
    .unwrap();

    let (source, same, cross) = authorize_two(&source_root, &target_root);
    copy_entry(&source, &path("tree"), &same, &path("same-copy")).unwrap();
    copy_entry(&source, &path("tree"), &cross, &path("cross-copy")).unwrap();

    for copied in [
        source_root.join("same-copy"),
        target_root.join("cross-copy"),
    ] {
        assert_eq!(
            fs::read(copied.join("nested/data.bin")).unwrap(),
            b"plain-directory-copy"
        );
        assert!(copied.join("nested/empty").is_dir());
        assert_eq!(
            fs::read_link(copied.join("nested/dangling")).unwrap(),
            Path::new("../missing")
        );
        assert_eq!(
            fs::read_link(copied.join("loop")).unwrap(),
            Path::new("loop")
        );
        for relative in [
            "nested/internal",
            "nested/dangling",
            "loop",
            "external",
            "absolute",
            "non-utf8",
        ] {
            let source_payload = fs::read_link(source_root.join("tree").join(relative)).unwrap();
            let copied_payload = fs::read_link(copied.join(relative)).unwrap();
            assert_eq!(
                copied_payload.as_os_str().as_bytes(),
                source_payload.as_os_str().as_bytes()
            );
        }
        assert_eq!(
            fs::metadata(copied.join("nested"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o751
        );
    }
    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"outside");
    assert_no_stages(&source_root);
    assert_no_stages(&target_root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn preflight_rejects_special_descendants_before_target_side_effects() {
    use std::os::unix::fs::FileTypeExt;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("special-tree")).unwrap();
    create_fifo(&root.join("special-tree/fifo"));
    let lease = authorize_one(&root);

    let special = copy_entry(
        &lease,
        &path("special-tree"),
        &lease,
        &path("special-target"),
    )
    .unwrap_err();
    assert_eq!(special.code(), "ENTRY_TYPE_MISMATCH");
    assert!(fs::symlink_metadata(root.join("special-tree/fifo"))
        .unwrap()
        .file_type()
        .is_fifo());

    assert_entry_absent(&root.join("special-target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn non_portable_descendant_fails_with_sanitized_encoding_error() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/private:name"), b"private").unwrap();
    let lease = authorize_one(&root);
    let error = copy_entry(&lease, &path("tree"), &lease, &path("target")).unwrap_err();
    assert_eq!(error.code(), "PATH_ENCODING_UNSUPPORTED");
    assert_eq!(
        error.message(),
        "The workspace entry name cannot be represented safely."
    );
    assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_descendant_fails_before_target_side_effects() {
    use std::os::unix::ffi::OsStrExt;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("encoding-tree")).unwrap();
    let invalid = std::ffi::OsStr::from_bytes(b"invalid-\xff");
    fs::write(root.join("encoding-tree").join(invalid), b"data").unwrap();
    let lease = authorize_one(&root);
    let encoding = copy_entry(
        &lease,
        &path("encoding-tree"),
        &lease,
        &path("encoding-target"),
    )
    .unwrap_err();
    assert_eq!(encoding.code(), "PATH_ENCODING_UNSUPPORTED");
    assert_eq!(
        encoding.message(),
        "The workspace entry name cannot be represented safely."
    );
    assert_entry_absent(&root.join("encoding-target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn injected_manifest_limits_cover_exact_and_plus_one_without_large_fixtures() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/aa"), b"12").unwrap();
    symlink("xy", root.join("tree/bb")).unwrap();
    let lease = authorize_one(&root);
    let exact = limits(2, 16, 4, 1, 2, 2, 2, 2);
    let mut hooks = TestHooks::default();
    copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("exact"),
        exact,
        &mut hooks,
    )
    .unwrap();

    for (target, changed) in [
        ("entries", limits(1, 16, 4, 1, 2, 2, 2, 2)),
        ("names", limits(2, 16, 3, 1, 2, 2, 2, 2)),
        ("links", limits(2, 16, 4, 1, 2, 1, 2, 2)),
        ("files", limits(2, 16, 4, 1, 2, 2, 2, 1)),
    ] {
        let error = copy_directory_with_limits_and_hooks(
            &lease,
            &path("tree"),
            &lease,
            &path(target),
            changed,
            &mut TestHooks::default(),
        )
        .unwrap_err();
        assert_directory_too_large(error);
        assert_entry_absent(&root.join(target));
    }
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn source_and_target_root_basenames_accept_exact_limit_and_reject_plus_one() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::create_dir(root.join("trees")).unwrap();
    let lease = authorize_one(&root);
    let limits = limits(0, 4, 0, 1, 4, 0, 4, 0);

    copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("copy"),
        limits,
        &mut TestHooks::default(),
    )
    .unwrap();
    assert!(root.join("copy").is_dir());

    let target_error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("large"),
        limits,
        &mut TestHooks::default(),
    )
    .unwrap_err();
    assert_directory_too_large(target_error);
    assert_entry_absent(&root.join("large"));

    let source_error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("trees"),
        &lease,
        &path("next"),
        limits,
        &mut TestHooks::default(),
    )
    .unwrap_err();
    assert_directory_too_large(source_error);
    assert_entry_absent(&root.join("next"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn individual_file_and_link_limits_keep_file_too_large_contracts() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/file"), b"12").unwrap();
    symlink("xy", root.join("tree/link")).unwrap();
    let lease = authorize_one(&root);

    let file_error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("file-target"),
        limits(2, 32, 8, 1, 4, 8, 1, 8),
        &mut TestHooks::default(),
    )
    .unwrap_err();
    assert_eq!(file_error.code(), "FILE_TOO_LARGE");
    assert_eq!(
        file_error.message(),
        "The workspace file exceeds the supported copy limit."
    );

    let link_error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("link-target"),
        limits(2, 32, 8, 1, 1, 8, 2, 8),
        &mut TestHooks::default(),
    )
    .unwrap_err();
    assert_eq!(link_error.code(), "FILE_TOO_LARGE");
    assert_eq!(
        link_error.message(),
        "The workspace symbolic link exceeds the supported copy limit."
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn growing_leaf_consumes_shared_actual_budget_without_writing_probe_byte() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/file"), b"12").unwrap();
    let lease = authorize_one(&root);
    let source = root.join("tree/file");
    let mut hooks = TestHooks {
        after_file_open: Some(Box::new(move |_| {
            use std::io::Write;
            fs::OpenOptions::new()
                .append(true)
                .open(&source)
                .unwrap()
                .write_all(b"3")
                .unwrap();
        })),
        ..TestHooks::default()
    };
    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        limits(1, 16, 4, 1, 4, 4, 4, 2),
        &mut hooks,
    )
    .unwrap_err();
    assert_directory_too_large(error);
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn depth_and_full_wire_addressability_fail_before_staging() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir_all(root.join("tree/a/b")).unwrap();
    let lease = authorize_one(&root);
    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        limits(3, 4, 8, 1, 4, 8, 4, 8),
        &mut TestHooks::default(),
    )
    .unwrap_err();
    assert_directory_too_large(error);

    let long_target = std::iter::repeat_n("t".repeat(1_023), 4)
        .collect::<Vec<_>>()
        .join("/");
    let error = copy_entry(&lease, &path("tree"), &lease, &path(&long_target)).unwrap_err();
    assert_eq!(error.code(), "PATH_ENCODING_UNSUPPORTED");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn overlapping_root_alias_cannot_place_target_parent_inside_source_tree() {
    let temp = TempDir::new().unwrap();
    let outer = make_dir(temp.path(), "outer");
    fs::create_dir_all(outer.join("source/inside")).unwrap();
    fs::write(outer.join("source/data"), b"data").unwrap();
    let source_root = outer.join("source");
    let mut scope = WorkspaceScope::new();
    let ids = scope
        .authorize_roots_atomically(&[source_root.clone(), outer.clone()])
        .unwrap();
    let source = scope.lease(ids[0]).unwrap();
    let overlapping = scope.lease(ids[1]).unwrap();

    let error = copy_entry(
        &source,
        &path("inside"),
        &overlapping,
        &path("source/inside/copy"),
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&outer.join("source/inside/copy"));
    assert_no_stages(&outer.join("source/inside"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn source_root_replacement_after_manifest_never_touches_target() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"original").unwrap();
    let lease = authorize_one(&root);
    let source = root.join("tree");
    let replacement = root.join("replacement");
    fs::create_dir(&replacement).unwrap();
    fs::write(replacement.join("data"), b"replacement").unwrap();
    let mut hooks = TestHooks {
        after_manifest: Some(Box::new(move || {
            fs::rename(&source, source.with_extension("old")).unwrap();
            fs::rename(&replacement, &source).unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn post_stage_source_member_add_delete_rewrite_and_link_swap_all_conflict() {
    use std::os::unix::fs::symlink;

    assert_post_stage_source_mutation_conflicts(|tree| {
        fs::write(tree.join("added"), b"added").unwrap();
    });
    assert_post_stage_source_mutation_conflicts(|tree| {
        fs::remove_file(tree.join("removable")).unwrap();
    });
    assert_post_stage_source_mutation_conflicts(|tree| {
        fs::write(tree.join("file"), b"WXYZ").unwrap();
    });
    assert_post_stage_source_mutation_conflicts(|tree| {
        fs::remove_file(tree.join("link")).unwrap();
        symlink("two", tree.join("link")).unwrap();
    });
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn nested_source_parent_swap_is_detected_before_its_stage_side_effect() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir_all(root.join("tree/nested")).unwrap();
    fs::write(root.join("tree/nested/data"), b"original").unwrap();
    fs::create_dir(root.join("replacement")).unwrap();
    fs::write(root.join("replacement/data"), b"replacement").unwrap();
    let lease = authorize_one(&root);
    let nested = root.join("tree/nested");
    let replacement = root.join("replacement");
    let mut hooks = TestHooks {
        after_stage_created: Some(Box::new(move |_| {
            fs::rename(&nested, nested.with_extension("old")).unwrap();
            fs::rename(&replacement, &nested).unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn unknown_staging_member_is_never_recursively_deleted() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"data").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_built: Some(Box::new(move |stage_name| {
            fs::write(hook_root.join(stage_name).join("unknown"), b"sentinel").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_eq!(
        error.message(),
        "The workspace staging entry could not be cleaned up safely."
    );
    assert_entry_absent(&root.join("target"));
    let stages = staging_paths(&root);
    assert_eq!(stages.len(), 1);
    assert_eq!(fs::read(stages[0].join("unknown")).unwrap(), b"sentinel");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn replaced_nested_stage_directory_is_not_chmoded_or_deleted() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir_all(root.join("tree/nested")).unwrap();
    fs::write(root.join("tree/nested/data"), b"data").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_built: Some(Box::new(move |stage_name| {
            let stage = hook_root.join(stage_name);
            fs::rename(stage.join("nested"), stage.join("original-nested")).unwrap();
            fs::create_dir(stage.join("nested")).unwrap();
            fs::write(stage.join("nested/replacement"), b"sentinel").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_eq!(staging_paths(&root).len(), 1);
    assert_eq!(
        fs::read(staging_paths(&root)[0].join("nested/replacement")).unwrap(),
        b"sentinel"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_file_path_replacement_after_nofollow_open_is_rejected_and_preserved() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"original").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_file_open: Some(Box::new(move |stage_name, relative| {
            let staged_path = hook_root.join(stage_name).join(relative);
            fs::rename(&staged_path, hook_root.join("escaped-original")).unwrap();
            fs::write(&staged_path, b"replacement").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_entry_absent(&root.join("target"));
    let stages = staging_paths(&root);
    assert_eq!(stages.len(), 1);
    assert_eq!(fs::read(stages[0].join("data")).unwrap(), b"replacement");
    assert_eq!(
        fs::read(root.join("escaped-original")).unwrap(),
        b"original"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_symlink_path_replacement_during_payload_read_is_rejected_and_preserved() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    symlink("original", root.join("tree/link")).unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_symlink_read: Some(Box::new(move |stage_name, relative| {
            let staged_path = hook_root.join(stage_name).join(relative);
            fs::rename(&staged_path, hook_root.join("escaped-link")).unwrap();
            symlink("replacement", &staged_path).unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_entry_absent(&root.join("target"));
    let stages = staging_paths(&root);
    assert_eq!(stages.len(), 1);
    assert_eq!(
        fs::read_link(stages[0].join("link")).unwrap(),
        Path::new("replacement")
    );
    assert_eq!(
        fs::read_link(root.join("escaped-link")).unwrap(),
        Path::new("original")
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn unknown_stage_member_added_after_initial_member_check_never_publishes() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"data").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_file_open: Some(Box::new(move |stage_name, _| {
            fs::write(hook_root.join(stage_name).join("late-unknown"), b"sentinel").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_entry_absent(&root.join("target"));
    let stages = staging_paths(&root);
    assert_eq!(stages.len(), 1);
    assert_eq!(
        fs::read(stages[0].join("late-unknown")).unwrap(),
        b"sentinel"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn nested_source_addition_after_member_verification_never_publishes() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    let nested = root.join("tree/nested");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("data"), b"data").unwrap();
    let lease = authorize_one(&root);
    let hook_nested = nested.clone();
    let mut hooks = TestHooks {
        after_stage_file_open: Some(Box::new(move |_, _| {
            fs::write(hook_nested.join("late-added"), b"late").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
    assert_eq!(fs::read(nested.join("late-added")).unwrap(), b"late");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn later_leaf_hook_cannot_mutate_an_already_verified_staged_file() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/a"), b"aaaa").unwrap();
    fs::write(root.join("tree/b"), b"bbbb").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        after_stage_file_open_each: Some(Box::new(move |stage_name, relative| {
            if relative == Path::new("b") {
                fs::write(hook_root.join(stage_name).join("a"), b"zzzz").unwrap();
            }
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn before_publish_file_rewrite_is_caught_by_final_hookless_verification() {
    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"good").unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        before_publish: Some(Box::new(move |stage_name| {
            fs::write(hook_root.join(stage_name).join("data"), b"evil").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn before_publish_symlink_replacement_is_caught_and_preserved() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    symlink("good", root.join("tree/link")).unwrap();
    let lease = authorize_one(&root);
    let hook_root = root.clone();
    let mut hooks = TestHooks {
        before_publish: Some(Box::new(move |stage_name| {
            let link = hook_root.join(stage_name).join("link");
            fs::remove_file(&link).unwrap();
            symlink("evil", &link).unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "IO_FAILED");
    assert_entry_absent(&root.join("target"));
    let stages = staging_paths(&root);
    assert_eq!(stages.len(), 1);
    assert_eq!(
        fs::read_link(stages[0].join("link")).unwrap(),
        Path::new("evil")
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn target_competitor_wins_without_clobber_and_verified_stage_is_cleaned() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"data").unwrap();
    fs::set_permissions(root.join("tree"), fs::Permissions::from_mode(0o555)).unwrap();
    let lease = authorize_one(&root);
    let target = root.join("target");
    let mut hooks = TestHooks {
        before_publish: Some(Box::new(move |_| {
            fs::write(&target, b"competitor").unwrap();
        })),
        ..TestHooks::default()
    };

    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    assert_eq!(fs::read(root.join("target")).unwrap(), b"competitor");
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn concurrent_directory_publications_have_exactly_one_winner() {
    use std::sync::{Arc, Barrier};

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"data").unwrap();
    let first = authorize_one(&root);
    let second = authorize_one(&root);
    let barrier = Arc::new(Barrier::new(2));
    let spawn = |lease: WorkspaceRootLease| {
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            copy_entry(&lease, &path("tree"), &lease, &path("target"))
        })
    };
    let first = spawn(first);
    let second = spawn(second);
    let results = [first.join().unwrap(), second.join().unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .filter(|error| error.code() == "ENTRY_ALREADY_EXISTS")
            .count(),
        1
    );
    assert_eq!(fs::read(root.join("target/data")).unwrap(), b"data");
    assert_no_stages(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn opened_target_parent_does_not_follow_an_external_replacement() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    let outside = make_dir(temp.path(), "outside");
    fs::create_dir(root.join("tree")).unwrap();
    fs::write(root.join("tree/data"), b"data").unwrap();
    fs::create_dir(root.join("target-parent")).unwrap();
    fs::write(outside.join("sentinel"), b"outside").unwrap();
    let lease = authorize_one(&root);
    let parent = root.join("target-parent");
    let moved = root.join("target-parent-opened");
    let outside_hook = outside.clone();
    let mut hooks = TestHooks {
        after_target_parent_open: Some(Box::new(move || {
            fs::rename(&parent, &moved).unwrap();
            symlink(&outside_hook, &parent).unwrap();
        })),
        ..TestHooks::default()
    };

    copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target-parent/copied"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap();
    assert!(root.join("target-parent-opened/copied/data").is_file());
    assert_entry_absent(&outside.join("copied"));
    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"outside");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn assert_post_stage_source_mutation_conflicts<F>(mutation: F)
where
    F: FnOnce(&Path) + 'static,
{
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = make_dir(temp.path(), "root");
    let tree = root.join("tree");
    fs::create_dir(&tree).unwrap();
    fs::write(tree.join("file"), b"ABCD").unwrap();
    fs::write(tree.join("removable"), b"remove").unwrap();
    symlink("one", tree.join("link")).unwrap();
    let lease = authorize_one(&root);
    let hook_tree = tree.clone();
    let mut hooks = TestHooks {
        after_stage_built: Some(Box::new(move |_| mutation(&hook_tree))),
        ..TestHooks::default()
    };
    let error = copy_directory_with_limits_and_hooks(
        &lease,
        &path("tree"),
        &lease,
        &path("target"),
        DIRECTORY_COPY_LIMITS,
        &mut hooks,
    )
    .unwrap_err();
    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_entry_absent(&root.join("target"));
    assert_no_stages(&root);
}

type PathHook = Box<dyn FnOnce(&Path)>;
type PathPairHook = Box<dyn FnOnce(&Path, &Path)>;
type PathPairMutHook = Box<dyn FnMut(&Path, &Path)>;

#[derive(Default)]
struct TestHooks {
    after_manifest: Option<Box<dyn FnOnce()>>,
    after_target_parent_open: Option<Box<dyn FnOnce()>>,
    after_stage_created: Option<PathHook>,
    after_stage_built: Option<PathHook>,
    after_file_open: Option<PathHook>,
    after_stage_file_open: Option<PathPairHook>,
    after_stage_file_open_each: Option<PathPairMutHook>,
    after_stage_symlink_read: Option<PathPairHook>,
    before_publish: Option<PathHook>,
}

impl DirectoryCopyHooks for TestHooks {
    fn after_manifest(&mut self) {
        if let Some(hook) = self.after_manifest.take() {
            hook();
        }
    }

    fn after_target_parent_open(&mut self) {
        if let Some(hook) = self.after_target_parent_open.take() {
            hook();
        }
    }

    fn after_stage_created(&mut self, stage_name: &Path) {
        if let Some(hook) = self.after_stage_created.take() {
            hook(stage_name);
        }
    }

    fn after_stage_built(&mut self, stage_name: &Path) {
        if let Some(hook) = self.after_stage_built.take() {
            hook(stage_name);
        }
    }

    fn after_file_open(&mut self, relative: &Path) {
        if let Some(hook) = self.after_file_open.take() {
            hook(relative);
        }
    }

    fn after_stage_file_open(&mut self, stage_name: &Path, relative: &Path) {
        if let Some(hook) = self.after_stage_file_open_each.as_mut() {
            hook(stage_name, relative);
        }
        if let Some(hook) = self.after_stage_file_open.take() {
            hook(stage_name, relative);
        }
    }

    fn after_stage_symlink_read(&mut self, stage_name: &Path, relative: &Path) {
        if let Some(hook) = self.after_stage_symlink_read.take() {
            hook(stage_name, relative);
        }
    }

    fn before_publish(&mut self, stage_name: &Path) {
        if let Some(hook) = self.before_publish.take() {
            hook(stage_name);
        }
    }
}

#[allow(clippy::too_many_arguments)]
const fn limits(
    descendants: usize,
    name_bytes: usize,
    name_aggregate_bytes: usize,
    depth: usize,
    link_bytes: usize,
    link_aggregate_bytes: u64,
    file_bytes: u64,
    file_aggregate_bytes: u64,
) -> DirectoryCopyLimits {
    DirectoryCopyLimits {
        descendants,
        name_bytes,
        name_aggregate_bytes,
        depth,
        link_bytes,
        link_aggregate_bytes,
        file_bytes,
        file_aggregate_bytes,
    }
}

fn path(value: &str) -> RelativePath {
    RelativePath::parse_wire(value).unwrap()
}

fn make_dir(parent: &Path, name: &str) -> PathBuf {
    let path = parent.join(name);
    fs::create_dir(&path).unwrap();
    path
}

fn authorize_one(root: &Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope
        .authorize_roots_atomically(&[root.to_owned()])
        .unwrap()[0];
    scope.lease(root_id).unwrap()
}

fn authorize_two(
    source_root: &Path,
    target_root: &Path,
) -> (WorkspaceRootLease, WorkspaceRootLease, WorkspaceRootLease) {
    let mut scope = WorkspaceScope::new();
    let ids = scope
        .authorize_roots_atomically(&[source_root.to_owned(), target_root.to_owned()])
        .unwrap();
    (
        scope.lease(ids[0]).unwrap(),
        scope.lease(ids[0]).unwrap(),
        scope.lease(ids[1]).unwrap(),
    )
}

fn staging_paths(root: &Path) -> Vec<PathBuf> {
    fs::read_dir(root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(DIRECTORY_STAGING_PREFIX)
        })
        .map(|entry| entry.path())
        .collect()
}

fn assert_no_stages(root: &Path) {
    assert!(staging_paths(root).is_empty(), "staging artifact remains");
}

fn assert_entry_absent(path: &Path) {
    let error = fs::symlink_metadata(path)
        .expect_err("entry must be absent, including when it is a dangling symlink");
    assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
}

fn assert_directory_too_large(error: crate::error::CommandError) {
    assert_eq!(error.code(), "DIRECTORY_TOO_LARGE");
    assert_eq!(
        error.message(),
        "The workspace directory exceeds the supported copy limits."
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn create_fifo(path: &Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let native = CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `native` owns a NUL-terminated pathname for the duration of the
    // call and the mode contains only ordinary permission bits.
    let result = unsafe { libc::mkfifo(native.as_ptr(), 0o600) };
    assert_eq!(result, 0);
}
