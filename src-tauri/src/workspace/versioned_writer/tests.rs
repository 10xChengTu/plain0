use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use cap_std::fs::{Dir, File, OpenOptions};
use tempfile::TempDir;

use super::{write_file_with_hooks, WriteHooks, MAX_STAGING_ATTEMPTS, STAGING_PREFIX};
use crate::path_policy::RelativePath;
use crate::workspace::dto::{
    WorkspaceWriteDirectorySyncObservation, WorkspaceWriteResult, WorkspaceWriteTargetObservation,
};
use crate::workspace::{WorkspaceRootLease, WorkspaceScope};

#[test]
fn versioned_write_atomically_replaces_zero_and_exact_limit_contents() {
    use std::os::unix::fs::PermissionsExt;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);

    let old_version = version(&lease, "target.txt");
    let result = super::write_file(&lease, &path("target.txt"), &old_version, b"").unwrap();
    let empty_version = assert_written(result);
    assert_ne!(empty_version, old_version);
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"");

    let exact = vec![0x5a; super::MAX_VERSIONED_FILE_BYTES as usize];
    let result = super::write_file(&lease, &path("target.txt"), &empty_version, &exact).unwrap();
    assert_written(result);
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), exact);
    assert_eq!(
        fs::metadata(root.join("target.txt"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o644
    );
    assert_no_stages(&root);
}

#[test]
fn versioned_write_rejects_limit_plus_one_stale_and_replayed_tokens() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");

    assert_eq!(
        super::write_file(
            &lease,
            &path("target.txt"),
            &token,
            &vec![0; super::MAX_VERSIONED_FILE_BYTES as usize + 1],
        )
        .unwrap_err()
        .code(),
        "FILE_TOO_LARGE"
    );
    assert_eq!(
        super::write_file(
            &lease,
            &path("target.txt"),
            &format!("wv1:{}", "0".repeat(64)),
            b"new",
        )
        .unwrap_err()
        .code(),
        "WORKSPACE_FILE_MODIFIED"
    );
    let result = super::write_file(&lease, &path("target.txt"), &token, b"new").unwrap();
    assert_written(result);
    assert_eq!(
        super::write_file(&lease, &path("target.txt"), &token, b"replay")
            .unwrap_err()
            .code(),
        "WORKSPACE_FILE_MODIFIED"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"new");
    assert_no_stages(&root);
}

#[test]
fn tokens_are_bound_to_the_authorized_root_and_requested_path() {
    let temp = TempDir::new().unwrap();
    let root_a = temp.path().join("root-a");
    let root_b = temp.path().join("root-b");
    fs::create_dir(&root_a).unwrap();
    fs::create_dir(&root_b).unwrap();
    fs::write(root_a.join("target.txt"), b"same").unwrap();
    fs::write(root_b.join("target.txt"), b"same").unwrap();
    let lease_a = authorize(&root_a);
    let lease_b = authorize(&root_b);
    let token_a = version(&lease_a, "target.txt");

    assert_eq!(
        super::write_file(&lease_b, &path("target.txt"), &token_a, b"cross-root")
            .unwrap_err()
            .code(),
        "WORKSPACE_FILE_MODIFIED"
    );
    fs::write(root_a.join("other.txt"), b"same").unwrap();
    assert_eq!(
        super::write_file(&lease_a, &path("other.txt"), &token_a, b"cross-path")
            .unwrap_err()
            .code(),
        "WORKSPACE_FILE_MODIFIED"
    );
    assert_eq!(fs::read(root_b.join("target.txt")).unwrap(), b"same");
    assert_eq!(fs::read(root_a.join("other.txt")).unwrap(), b"same");
}

#[test]
fn symlinks_hardlinks_readonly_special_modes_and_shared_parents_are_ineligible() {
    use std::os::unix::fs::MetadataExt;
    use std::os::unix::fs::{symlink, PermissionsExt};

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("plain.txt"), b"plain").unwrap();
    symlink("plain.txt", root.join("link.txt")).unwrap();
    fs::hard_link(root.join("plain.txt"), root.join("hard.txt")).unwrap();
    fs::write(root.join("readonly.txt"), b"readonly").unwrap();
    fs::set_permissions(root.join("readonly.txt"), fs::Permissions::from_mode(0o444)).unwrap();
    fs::write(root.join("special.txt"), b"special").unwrap();
    fs::set_permissions(root.join("special.txt"), fs::Permissions::from_mode(0o4644)).unwrap();
    fs::create_dir(root.join("linked-parent-target")).unwrap();
    fs::write(root.join("linked-parent-target/child.txt"), b"child").unwrap();
    symlink("linked-parent-target", root.join("linked-parent")).unwrap();
    fs::create_dir(root.join("shared-parent")).unwrap();
    fs::set_permissions(
        root.join("shared-parent"),
        fs::Permissions::from_mode(0o777),
    )
    .unwrap();
    fs::write(root.join("shared-parent/child.txt"), b"shared").unwrap();
    let lease = authorize(&root);
    let dummy = format!("wv1:{}", "a".repeat(64));

    let mut candidates = vec![
        "plain.txt",
        "hard.txt",
        "link.txt",
        "readonly.txt",
        "linked-parent/child.txt",
        "shared-parent/child.txt",
    ];
    if fs::metadata(root.join("special.txt")).unwrap().mode() & 0o7000 != 0 {
        candidates.push("special.txt");
    }
    for candidate in candidates {
        assert_eq!(
            super::write_file(&lease, &path(candidate), &dummy, b"blocked")
                .unwrap_err()
                .code(),
            "WORKSPACE_WRITE_UNSUPPORTED",
            "{candidate} must remain ineligible"
        );
    }
}

#[test]
fn prepublication_target_ancestor_and_stage_swaps_conflict_without_overwriting() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::create_dir(root.join("parent")).unwrap();
    fs::write(root.join("parent/target.txt"), b"old").unwrap();
    let lease = authorize(&root);

    let replacement = root.join("replacement.txt");
    fs::write(&replacement, b"external").unwrap();
    let token = version(&lease, "parent/target.txt");
    let target_path = root.join("parent/target.txt");
    let mut hooks = TestHooks {
        after_initial_target: Some(Box::new(move || {
            fs::rename(&replacement, &target_path).unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("parent/target.txt"),
            &token,
            b"plain",
            &mut hooks,
        )
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    assert_eq!(
        fs::read(root.join("parent/target.txt")).unwrap(),
        b"external"
    );

    let token = version(&lease, "parent/target.txt");
    let root_for_ancestor = root.clone();
    let mut hooks = TestHooks {
        before_prepublication_rewalk: Some(Box::new(move || {
            fs::rename(
                root_for_ancestor.join("parent"),
                root_for_ancestor.join("old-parent"),
            )
            .unwrap();
            fs::create_dir(root_for_ancestor.join("parent")).unwrap();
            fs::write(root_for_ancestor.join("parent/target.txt"), b"new-parent").unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("parent/target.txt"),
            &token,
            b"plain",
            &mut hooks,
        )
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    assert_eq!(
        fs::read(root.join("parent/target.txt")).unwrap(),
        b"new-parent"
    );
    assert_no_stages(&root.join("old-parent"));

    let token = version(&lease, "parent/target.txt");
    let mut hooks = TestHooks {
        after_stage_synced: Some(Box::new(|parent, name| {
            parent.remove_file(name).unwrap();
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut replacement = parent.open_with(name, &options).unwrap();
            replacement.write_all(b"replacement-stage").unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("parent/target.txt"),
            &token,
            b"plain",
            &mut hooks,
        )
        .unwrap_err()
        .code(),
        "WORKSPACE_CONFLICT"
    );
    assert_eq!(
        fs::read(root.join("parent/target.txt")).unwrap(),
        b"new-parent"
    );
    assert!(fs::read_dir(root.join("parent")).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(STAGING_PREFIX)));
}

#[test]
fn sixteen_stage_collisions_fail_without_touching_the_target() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");
    let names = (0..MAX_STAGING_ATTEMPTS)
        .map(|index| PathBuf::from(format!("{STAGING_PREFIX}collision-{index}.tmp")))
        .collect::<Vec<_>>();
    for name in &names {
        fs::write(root.join(name), b"sentinel").unwrap();
    }
    let mut hooks = TestHooks {
        stage_names: Some(names),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"new", &mut hooks)
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"old");
}

#[test]
fn directory_sync_and_postcheck_failures_are_structured_after_publication() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        fail_directory_sync: true,
        ..TestHooks::default()
    };
    let result =
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"new", &mut hooks).unwrap();
    assert_eq!(
        result,
        WorkspaceWriteResult::rename_succeeded_sync_failed_with_written_target()
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"new");

    let token = version(&lease, "target.txt");
    let target = root.join("target.txt");
    let replacement = root.join("postcheck-replacement.txt");
    fs::write(&replacement, b"external").unwrap();
    let mut hooks = TestHooks {
        before_postcheck: Some(Box::new(move || {
            fs::rename(&replacement, &target).unwrap();
        })),
        ..TestHooks::default()
    };
    let result = write_file_with_hooks(
        &lease,
        &path("target.txt"),
        &token,
        b"requested",
        &mut hooks,
    )
    .unwrap();
    assert_eq!(
        result,
        WorkspaceWriteResult::rename_succeeded_with_changed_target(
            WorkspaceWriteDirectorySyncObservation::Synced,
        )
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"external");
}

#[test]
fn final_stage_and_ancestor_races_are_classified_without_rollback() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        before_rename: Some(Box::new(|parent, stage, _target| {
            use cap_std::fs::PermissionsExt;
            parent.remove_file(stage).unwrap();
            let mut options = OpenOptions::new();
            options.read(true).write(true).create_new(true);
            use cap_std::fs::OpenOptionsExt;
            options.mode(0o600);
            let mut replacement = parent.open_with(stage, &options).unwrap();
            replacement.write_all(b"external-stage").unwrap();
            replacement
                .set_permissions(cap_std::fs::Permissions::from_mode(0o644))
                .unwrap();
            replacement.sync_all().unwrap();
        })),
        ..TestHooks::default()
    };
    let result = write_file_with_hooks(
        &lease,
        &path("target.txt"),
        &token,
        b"requested",
        &mut hooks,
    )
    .unwrap();
    assert_eq!(
        result,
        WorkspaceWriteResult::rename_succeeded_with_changed_target(
            WorkspaceWriteDirectorySyncObservation::Synced,
        )
    );
    assert_eq!(
        fs::read(root.join("target.txt")).unwrap(),
        b"external-stage"
    );

    fs::create_dir(root.join("parent")).unwrap();
    fs::write(root.join("parent/target.txt"), b"old-parent").unwrap();
    let token = version(&lease, "parent/target.txt");
    let root_for_swap = root.clone();
    let mut hooks = TestHooks {
        after_rename: Some(Box::new(move || {
            fs::rename(
                root_for_swap.join("parent"),
                root_for_swap.join("published-parent"),
            )
            .unwrap();
            fs::create_dir(root_for_swap.join("parent")).unwrap();
            fs::write(root_for_swap.join("parent/target.txt"), b"external-parent").unwrap();
        })),
        ..TestHooks::default()
    };
    let result = write_file_with_hooks(
        &lease,
        &path("parent/target.txt"),
        &token,
        b"requested-parent",
        &mut hooks,
    )
    .unwrap();
    assert_eq!(
        result,
        WorkspaceWriteResult::rename_succeeded_with_unverifiable_target(
            WorkspaceWriteDirectorySyncObservation::Synced,
        )
    );
    assert_eq!(
        fs::read(root.join("published-parent/target.txt")).unwrap(),
        b"requested-parent"
    );
    assert_eq!(
        fs::read(root.join("parent/target.txt")).unwrap(),
        b"external-parent"
    );
}

#[test]
fn reported_rename_failure_distinguishes_not_published_published_and_unknown() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);

    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"new", &mut hooks)
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"old");
    assert_no_stages(&root);

    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        rename_behavior: RenameBehavior::PublishButFail,
        ..TestHooks::default()
    };
    let result = write_file_with_hooks(
        &lease,
        &path("target.txt"),
        &token,
        b"published",
        &mut hooks,
    )
    .unwrap();
    assert_eq!(
        result,
        WorkspaceWriteResult::rename_failed_with_observed_target(
            WorkspaceWriteDirectorySyncObservation::Synced,
            WorkspaceWriteTargetObservation::MatchesWritten,
        )
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"published");

    let token = version(&lease, "target.txt");
    let target = root.join("target.txt");
    let mut hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        after_rename: Some(Box::new(move || {
            fs::write(&target, b"ambiguous-external").unwrap();
        })),
        ..TestHooks::default()
    };
    let result =
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"unknown", &mut hooks).unwrap();
    assert_eq!(result, WorkspaceWriteResult::native_unknown());
}

#[test]
fn reported_failure_revalidates_and_removes_the_stage_before_returning_an_error() {
    use std::sync::{Arc, Mutex};

    let moved = TempDir::new().unwrap();
    let moved_root = create_root(&moved);
    fs::write(moved_root.join("target.txt"), b"old").unwrap();
    let moved_lease = authorize(&moved_root);
    let moved_token = version(&moved_lease, "target.txt");
    let mut moved_hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        after_not_published_proof: Some(Box::new(|parent, stage, target| {
            rustix::fs::renameat(parent, stage, parent, target).unwrap();
        })),
        ..TestHooks::default()
    };
    let moved_result = write_file_with_hooks(
        &moved_lease,
        &path("target.txt"),
        &moved_token,
        b"moved-after-proof",
        &mut moved_hooks,
    )
    .unwrap();
    assert_eq!(
        moved_result,
        WorkspaceWriteResult::rename_failed_with_observed_target(
            WorkspaceWriteDirectorySyncObservation::Synced,
            WorkspaceWriteTargetObservation::MatchesWritten,
        )
    );
    assert_eq!(
        fs::read(moved_root.join("target.txt")).unwrap(),
        b"moved-after-proof"
    );
    assert_no_stages(&moved_root);

    let missing = TempDir::new().unwrap();
    let missing_root = create_root(&missing);
    fs::write(missing_root.join("target.txt"), b"old").unwrap();
    let missing_lease = authorize(&missing_root);
    let missing_token = version(&missing_lease, "target.txt");
    let mut missing_hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        after_not_published_proof: Some(Box::new(|parent, stage, _target| {
            parent.remove_file(stage).unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &missing_lease,
            &path("target.txt"),
            &missing_token,
            b"missing-after-proof",
            &mut missing_hooks,
        )
        .unwrap(),
        WorkspaceWriteResult::native_unknown()
    );
    assert_eq!(fs::read(missing_root.join("target.txt")).unwrap(), b"old");
    assert_no_stages(&missing_root);

    let replaced = TempDir::new().unwrap();
    let replaced_root = create_root(&replaced);
    fs::write(replaced_root.join("target.txt"), b"old").unwrap();
    let replaced_lease = authorize(&replaced_root);
    let replaced_token = version(&replaced_lease, "target.txt");
    let replacement_name = Arc::new(Mutex::new(None));
    let observed_name = Arc::clone(&replacement_name);
    let mut replaced_hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        after_not_published_proof: Some(Box::new(move |parent, stage, _target| {
            *observed_name.lock().unwrap() = Some(stage.to_path_buf());
            parent.remove_file(stage).unwrap();
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut replacement = parent.open_with(stage, &options).unwrap();
            replacement.write_all(b"external replacement").unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &replaced_lease,
            &path("target.txt"),
            &replaced_token,
            b"replaced-after-proof",
            &mut replaced_hooks,
        )
        .unwrap(),
        WorkspaceWriteResult::native_unknown()
    );
    let replacement_name = replacement_name.lock().unwrap().clone().unwrap();
    assert_eq!(
        fs::read(replaced_root.join(replacement_name)).unwrap(),
        b"external replacement"
    );
    assert_eq!(fs::read(replaced_root.join("target.txt")).unwrap(), b"old");

    let failed_remove = TempDir::new().unwrap();
    let failed_remove_root = create_root(&failed_remove);
    fs::write(failed_remove_root.join("target.txt"), b"old").unwrap();
    let failed_remove_lease = authorize(&failed_remove_root);
    let failed_remove_token = version(&failed_remove_lease, "target.txt");
    let mut failed_remove_hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        fail_stage_remove: true,
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &failed_remove_lease,
            &path("target.txt"),
            &failed_remove_token,
            b"remove-failed",
            &mut failed_remove_hooks,
        )
        .unwrap(),
        WorkspaceWriteResult::native_unknown()
    );
    assert_eq!(
        fs::read(failed_remove_root.join("target.txt")).unwrap(),
        b"old"
    );
    assert!(fs::read_dir(&failed_remove_root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(STAGING_PREFIX)));

    let raced_remove = TempDir::new().unwrap();
    let raced_remove_root = create_root(&raced_remove);
    fs::write(raced_remove_root.join("target.txt"), b"old").unwrap();
    let raced_remove_lease = authorize(&raced_remove_root);
    let raced_remove_token = version(&raced_remove_lease, "target.txt");
    let mut raced_remove_hooks = TestHooks {
        rename_behavior: RenameBehavior::Fail,
        before_stage_remove: Some(Box::new(|parent, stage| {
            let moved = Path::new("externally-moved-stage");
            rustix::fs::renameat(parent, stage, parent, moved).unwrap();
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut replacement = parent.open_with(stage, &options).unwrap();
            replacement.write_all(b"external replacement").unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &raced_remove_lease,
            &path("target.txt"),
            &raced_remove_token,
            b"moved-during-remove",
            &mut raced_remove_hooks,
        )
        .unwrap(),
        WorkspaceWriteResult::native_unknown()
    );
    assert_eq!(
        fs::read(raced_remove_root.join("target.txt")).unwrap(),
        b"old"
    );
    assert_eq!(
        fs::read(raced_remove_root.join("externally-moved-stage")).unwrap(),
        b"moved-during-remove"
    );
}

#[test]
fn stage_sync_failure_is_prepublication_and_cleans_the_owned_stage() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        fail_stage_sync: true,
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"new", &mut hooks)
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"old");
    assert_no_stages(&root);
}

#[test]
fn prepublication_cleanup_reports_owned_stage_io_instead_of_hiding_it_as_conflict() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");
    let mut hooks = TestHooks {
        after_stage_synced: Some(Box::new(|parent, _stage| {
            parent.remove_file("target.txt").unwrap();
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut replacement = parent.open_with("target.txt", &options).unwrap();
            replacement.write_all(b"external").unwrap();
        })),
        fail_stage_remove: true,
        ..TestHooks::default()
    };

    assert_eq!(
        write_file_with_hooks(&lease, &path("target.txt"), &token, b"new", &mut hooks)
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"external");
    assert_no_stages(&root);
}

#[test]
fn stage_guard_covers_parent_clone_initial_validation_and_name_replacement_failures() {
    use std::sync::{Arc, Mutex};

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"old").unwrap();
    let lease = authorize(&root);
    let token = version(&lease, "target.txt");

    let mut clone_failure = TestHooks {
        fail_parent_clone: true,
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("target.txt"),
            &token,
            b"new",
            &mut clone_failure,
        )
        .unwrap_err()
        .code(),
        "IO_FAILED"
    );
    assert_no_stages(&root);

    let mut invalid_metadata = TestHooks {
        after_stage_identity: Some(Box::new(|parent, name| {
            use cap_std::fs::PermissionsExt;
            let file = parent.open(name).unwrap();
            file.set_permissions(cap_std::fs::Permissions::from_mode(0o400))
                .unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("target.txt"),
            &token,
            b"new",
            &mut invalid_metadata,
        )
        .unwrap_err()
        .code(),
        "IO_FAILED"
    );
    assert_no_stages(&root);

    let replacement_name = Arc::new(Mutex::new(None));
    let observed_name = Arc::clone(&replacement_name);
    let mut replaced_name = TestHooks {
        after_stage_identity: Some(Box::new(move |parent, name| {
            *observed_name.lock().unwrap() = Some(name.to_path_buf());
            parent.remove_file(name).unwrap();
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            let mut replacement = parent.open_with(name, &options).unwrap();
            replacement.write_all(b"external replacement").unwrap();
        })),
        ..TestHooks::default()
    };
    assert_eq!(
        write_file_with_hooks(
            &lease,
            &path("target.txt"),
            &token,
            b"new",
            &mut replaced_name,
        )
        .unwrap_err()
        .code(),
        "IO_FAILED"
    );
    let replacement_name = replacement_name.lock().unwrap().clone().unwrap();
    assert_eq!(
        fs::read(root.join(replacement_name)).unwrap(),
        b"external replacement"
    );
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"old");
}

#[derive(Clone, Copy, Default)]
enum RenameBehavior {
    #[default]
    Normal,
    Fail,
    PublishButFail,
}

#[derive(Default)]
struct TestHooks {
    stage_names: Option<Vec<PathBuf>>,
    after_initial_target: Option<Box<dyn FnMut()>>,
    after_stage_identity: Option<StagePathHook>,
    after_stage_synced: Option<StagePathHook>,
    before_prepublication_rewalk: Option<Box<dyn FnMut()>>,
    before_rename: Option<StageRenameHook>,
    after_rename: Option<Box<dyn FnMut()>>,
    before_postcheck: Option<Box<dyn FnMut()>>,
    after_not_published_proof: Option<StageRenameHook>,
    before_stage_remove: Option<StagePathHook>,
    fail_stage_sync: bool,
    fail_parent_clone: bool,
    fail_directory_sync: bool,
    fail_stage_remove: bool,
    rename_behavior: RenameBehavior,
}

type StagePathHook = Box<dyn FnMut(&Dir, &Path)>;
type StageRenameHook = Box<dyn FnMut(&Dir, &Path, &Path)>;

impl WriteHooks for TestHooks {
    fn stage_name(&mut self, attempt: usize) -> PathBuf {
        self.stage_names
            .as_ref()
            .and_then(|names| names.get(attempt))
            .cloned()
            .unwrap_or_else(|| {
                PathBuf::from(format!(
                    "{STAGING_PREFIX}{}.tmp",
                    uuid::Uuid::new_v4().simple()
                ))
            })
    }

    fn after_initial_target(&mut self) {
        if let Some(hook) = self.after_initial_target.as_mut() {
            hook();
        }
    }

    fn clone_stage_parent(&mut self, parent: &Dir) -> std::io::Result<Dir> {
        if self.fail_parent_clone {
            Err(std::io::Error::other("injected parent clone failure"))
        } else {
            parent.try_clone()
        }
    }

    fn after_stage_identity(&mut self, parent: &Dir, name: &Path) {
        if let Some(hook) = self.after_stage_identity.as_mut() {
            hook(parent, name);
        }
    }

    fn sync_stage(&mut self, file: &File) -> std::io::Result<()> {
        if self.fail_stage_sync {
            Err(std::io::Error::other("injected stage sync failure"))
        } else {
            file.sync_all()
        }
    }

    fn after_stage_synced(&mut self, parent: &Dir, name: &Path) {
        if let Some(hook) = self.after_stage_synced.as_mut() {
            hook(parent, name);
        }
    }

    fn before_prepublication_rewalk(&mut self) {
        if let Some(hook) = self.before_prepublication_rewalk.as_mut() {
            hook();
        }
    }

    fn before_rename(&mut self, parent: &Dir, stage: &Path, target: &Path) {
        if let Some(hook) = self.before_rename.as_mut() {
            hook(parent, stage, target);
        }
    }

    fn rename(&mut self, parent: &Dir, stage: &Path, target: &Path) -> rustix::io::Result<()> {
        match self.rename_behavior {
            RenameBehavior::Normal => rustix::fs::renameat(parent, stage, parent, target),
            RenameBehavior::Fail => Err(rustix::io::Errno::IO),
            RenameBehavior::PublishButFail => {
                rustix::fs::renameat(parent, stage, parent, target)?;
                Err(rustix::io::Errno::IO)
            }
        }
    }

    fn after_rename(&mut self, _reported_success: bool) {
        if let Some(hook) = self.after_rename.as_mut() {
            hook();
        }
    }

    fn sync_directory(&mut self, parent: &Dir) -> rustix::io::Result<()> {
        if self.fail_directory_sync {
            Err(rustix::io::Errno::IO)
        } else {
            rustix::fs::fsync(parent)
        }
    }

    fn before_postcheck(&mut self) {
        if let Some(hook) = self.before_postcheck.as_mut() {
            hook();
        }
    }

    fn after_not_published_proof(&mut self, parent: &Dir, stage: &Path, target: &Path) {
        if let Some(hook) = self.after_not_published_proof.as_mut() {
            hook(parent, stage, target);
        }
    }

    fn remove_stage(&mut self, parent: &Dir, stage: &Path) -> std::io::Result<()> {
        if let Some(hook) = self.before_stage_remove.as_mut() {
            hook(parent, stage);
        }
        if self.fail_stage_remove {
            Err(std::io::Error::other("injected stage removal failure"))
        } else {
            parent.remove_file(stage)
        }
    }
}

fn assert_written(result: WorkspaceWriteResult) -> String {
    let stat = result
        .written_stat()
        .unwrap_or_else(|| panic!("expected written, got {result:?}"));
    assert_eq!(stat.kind(), crate::workspace::dto::WorkspaceEntryKind::File);
    stat.version().unwrap().to_owned()
}

fn version(lease: &WorkspaceRootLease, wire: &str) -> String {
    crate::workspace::reader::stat(lease, &path(wire))
        .unwrap()
        .version()
        .unwrap()
        .to_owned()
}

fn authorize(root: &Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn create_root(temp: &TempDir) -> PathBuf {
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    root
}

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}

fn assert_no_stages(directory: &Path) {
    assert!(fs::read_dir(directory).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(STAGING_PREFIX)
    }));
}
