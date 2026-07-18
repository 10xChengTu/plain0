use std::fs;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::PathBuf;
use std::sync::{Arc, Barrier};

use tempfile::TempDir;

use super::{copy_regular_file, create_directory, create_file, rename as rename_entry};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use super::{
    copy_regular_file_with_hooks, copy_regular_file_with_pre_open_hook, MAX_COPY_FILE_BYTES,
    STAGING_PREFIX,
};
use crate::path_policy::RelativePath;
use crate::workspace::{WorkspaceRootLease, WorkspaceScope};

#[test]
fn creates_empty_files_and_single_directories_without_accepting_the_root() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let lease = authorize(&root);

    create_file(&lease, &path("empty.txt")).unwrap();
    create_directory(&lease, &path("folder")).unwrap();

    assert_eq!(fs::read(root.join("empty.txt")).unwrap(), b"");
    assert!(root.join("folder").is_dir());
    for create in [
        create_file as fn(&WorkspaceRootLease, &RelativePath) -> _,
        create_directory,
    ] {
        assert_eq!(
            create(&lease, &path("")).unwrap_err().code(),
            "ENTRY_TYPE_MISMATCH"
        );
    }
}

#[test]
fn creation_never_replaces_an_existing_file_or_directory() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("existing.txt"), b"sentinel").unwrap();
    fs::create_dir(root.join("existing-dir")).unwrap();
    let lease = authorize(&root);

    for (create, target) in [
        (
            create_file as fn(&WorkspaceRootLease, &RelativePath) -> _,
            "existing.txt",
        ),
        (create_file, "existing-dir"),
        (create_directory, "existing.txt"),
        (create_directory, "existing-dir"),
    ] {
        assert_eq!(
            create(&lease, &path(target)).unwrap_err().code(),
            "ENTRY_ALREADY_EXISTS"
        );
    }
    assert_eq!(fs::read(root.join("existing.txt")).unwrap(), b"sentinel");
    assert!(root.join("existing-dir").is_dir());
}

#[test]
fn creation_reports_missing_and_incompatible_parents_without_side_effects() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("parent-file"), b"sentinel").unwrap();
    let lease = authorize(&root);

    for create in [
        create_file as fn(&WorkspaceRootLease, &RelativePath) -> _,
        create_directory,
    ] {
        assert_eq!(
            create(&lease, &path("missing/child")).unwrap_err().code(),
            "ENTRY_NOT_FOUND"
        );
        assert_eq!(
            create(&lease, &path("parent-file/child"))
                .unwrap_err()
                .code(),
            "ENTRY_TYPE_MISMATCH"
        );
    }
    assert_eq!(fs::read(root.join("parent-file")).unwrap(), b"sentinel");
    assert!(!root.join("missing").exists());
}

#[test]
fn concurrent_creators_have_exactly_one_winner_for_each_entry_kind() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);

    assert_single_winner(&root, "race.txt", create_file);
    assert_single_winner(&root, "race-dir", create_directory);
    assert!(root.join("race.txt").is_file());
    assert!(root.join("race-dir").is_dir());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn renames_files_directories_and_symlinks_between_opened_parents() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::create_dir_all(root.join("source/nested")).unwrap();
    fs::create_dir_all(root.join("target/deep")).unwrap();
    fs::write(root.join("source/nested/file.txt"), b"file").unwrap();
    fs::create_dir(root.join("source/nested/folder")).unwrap();
    symlink("file.txt", root.join("source/nested/link")).unwrap();
    let lease = authorize(&root);

    rename_entry(
        &lease,
        &path("source/nested/file.txt"),
        &path("target/deep/file.txt"),
    )
    .unwrap();
    rename_entry(
        &lease,
        &path("source/nested/folder"),
        &path("target/deep/folder"),
    )
    .unwrap();
    rename_entry(
        &lease,
        &path("source/nested/link"),
        &path("target/deep/link"),
    )
    .unwrap();

    assert_eq!(
        fs::read(root.join("target/deep/file.txt")).unwrap(),
        b"file"
    );
    assert!(root.join("target/deep/folder").is_dir());
    assert!(fs::symlink_metadata(root.join("target/deep/link"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        fs::read_link(root.join("target/deep/link")).unwrap(),
        path("file.txt").as_path()
    );
    assert!(!root.join("source/nested/file.txt").exists());
    assert!(!root.join("source/nested/folder").exists());
    assert!(fs::symlink_metadata(root.join("source/nested/link")).is_err());
}

#[test]
fn rename_rejects_roots_same_paths_and_strict_descendants() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::create_dir_all(root.join("tree/child")).unwrap();
    fs::create_dir(root.join("tree-copy")).unwrap();
    fs::write(root.join("same.txt"), b"same").unwrap();
    let lease = authorize(&root);

    assert_eq!(
        rename_entry(&lease, &path(""), &path("target"))
            .unwrap_err()
            .code(),
        "ENTRY_TYPE_MISMATCH"
    );
    assert_eq!(
        rename_entry(&lease, &path("same.txt"), &path(""))
            .unwrap_err()
            .code(),
        "ENTRY_TYPE_MISMATCH"
    );
    for same in ["same.txt", "missing.txt"] {
        assert_eq!(
            rename_entry(&lease, &path(same), &path(same))
                .unwrap_err()
                .code(),
            "ENTRY_ALREADY_EXISTS"
        );
    }
    assert_eq!(
        rename_entry(&lease, &path("tree"), &path("tree/child/moved"))
            .unwrap_err()
            .code(),
        "WORKSPACE_CONFLICT"
    );
    assert!(root.join("tree").is_dir());

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        rename_entry(&lease, &path("tree"), &path("tree-copy/moved-tree")).unwrap();
        assert!(root.join("tree-copy/moved-tree").is_dir());
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rename_reports_missing_and_incompatible_parents_without_side_effects() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("parent-file"), b"parent").unwrap();
    fs::write(root.join("source-a"), b"a").unwrap();
    fs::write(root.join("source-b"), b"b").unwrap();
    let lease = authorize(&root);

    for (source, target, expected) in [
        ("missing", "target", "ENTRY_NOT_FOUND"),
        ("missing-parent/source", "target", "ENTRY_NOT_FOUND"),
        ("source-a", "missing-parent/target", "ENTRY_NOT_FOUND"),
        ("parent-file/source", "target", "ENTRY_TYPE_MISMATCH"),
        ("source-b", "parent-file/target", "ENTRY_TYPE_MISMATCH"),
    ] {
        assert_eq!(
            rename_entry(&lease, &path(source), &path(target))
                .unwrap_err()
                .code(),
            expected
        );
    }
    assert_eq!(fs::read(root.join("source-a")).unwrap(), b"a");
    assert_eq!(fs::read(root.join("source-b")).unwrap(), b"b");
    assert_eq!(fs::read(root.join("parent-file")).unwrap(), b"parent");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rename_never_replaces_existing_files_directories_or_symlinks() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source-file"), b"source-file").unwrap();
    fs::create_dir(root.join("source-dir")).unwrap();
    symlink("source-file", root.join("source-link")).unwrap();
    fs::write(root.join("source-dangling-target"), b"source").unwrap();

    fs::write(root.join("target-file"), b"target-file").unwrap();
    fs::create_dir(root.join("target-dir")).unwrap();
    fs::write(root.join("target-dir/sentinel"), b"target-dir").unwrap();
    symlink("target-file", root.join("target-link")).unwrap();
    symlink("missing", root.join("target-dangling-link")).unwrap();
    let lease = authorize(&root);

    for (source, target) in [
        ("source-file", "target-file"),
        ("source-dir", "target-dir"),
        ("source-link", "target-link"),
        ("source-dangling-target", "target-dangling-link"),
    ] {
        assert_eq!(
            rename_entry(&lease, &path(source), &path(target))
                .unwrap_err()
                .code(),
            "ENTRY_ALREADY_EXISTS"
        );
    }

    assert_eq!(fs::read(root.join("source-file")).unwrap(), b"source-file");
    assert!(root.join("source-dir").is_dir());
    assert!(fs::symlink_metadata(root.join("source-link"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        fs::read(root.join("source-dangling-target")).unwrap(),
        b"source"
    );
    assert_eq!(fs::read(root.join("target-file")).unwrap(), b"target-file");
    assert_eq!(
        fs::read(root.join("target-dir/sentinel")).unwrap(),
        b"target-dir"
    );
    assert_eq!(
        fs::read_link(root.join("target-link")).unwrap(),
        path("target-file").as_path()
    );
    assert_eq!(
        fs::read_link(root.join("target-dangling-link")).unwrap(),
        path("missing").as_path()
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn concurrent_renames_to_one_target_have_at_most_one_winner() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("first"), b"first").unwrap();
    fs::write(root.join("second"), b"second").unwrap();
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&root).unwrap();
    let first_lease = scope.lease(root_id).unwrap();
    let second_lease = scope.lease(root_id).unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let spawn = |lease: WorkspaceRootLease, source: &'static str| {
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            rename_entry(&lease, &path(source), &path("target"))
        })
    };
    let first = spawn(first_lease, "first");
    let second = spawn(second_lease, "second");
    barrier.wait();
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
    let target = fs::read(root.join("target")).unwrap();
    assert!(target == b"first" || target == b"second");
    assert_eq!(
        [root.join("first"), root.join("second")]
            .iter()
            .filter(|source| source.exists())
            .count(),
        1
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn rename_follows_only_parent_symlinks_that_stay_inside_the_root() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(root.join("inside-source")).unwrap();
    fs::create_dir(root.join("inside-target")).unwrap();
    fs::write(root.join("inside-source/item"), b"inside").unwrap();
    fs::write(outside.join("sentinel"), b"outside").unwrap();
    symlink("inside-source", root.join("inside-source-link")).unwrap();
    symlink("inside-target", root.join("inside-target-link")).unwrap();
    symlink(&outside, root.join("outside-link")).unwrap();
    symlink("missing", root.join("dangling-link")).unwrap();
    symlink("loop-link", root.join("loop-link")).unwrap();
    let lease = authorize(&root);

    rename_entry(
        &lease,
        &path("inside-source-link/item"),
        &path("inside-target-link/moved"),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.join("inside-target/moved")).unwrap(),
        b"inside"
    );

    fs::write(root.join("stable-source"), b"stable").unwrap();
    for (source, target) in [
        ("outside-link/sentinel", "stolen"),
        ("stable-source", "outside-link/private"),
        ("dangling-link/source", "target"),
        ("stable-source", "dangling-link/target"),
        ("loop-link/source", "target"),
        ("stable-source", "loop-link/target"),
    ] {
        let error = rename_entry(&lease, &path(source), &path(target)).unwrap_err();
        assert_sanitized_parent_error(&error);
    }
    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"outside");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
    assert_eq!(fs::read(root.join("stable-source")).unwrap(), b"stable");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn symlink_alias_cannot_hide_a_directory_move_into_its_own_descendant() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::create_dir(root.join("source-directory")).unwrap();
    fs::write(root.join("source-directory/sentinel"), b"source").unwrap();
    symlink("source-directory", root.join("source-alias")).unwrap();
    let lease = authorize(&root);

    let error = rename_entry(
        &lease,
        &path("source-directory"),
        &path("source-alias/moved"),
    )
    .unwrap_err();

    assert_eq!(error.code(), "IO_FAILED");
    assert_eq!(
        fs::read(root.join("source-directory/sentinel")).unwrap(),
        b"source"
    );
    assert!(fs::symlink_metadata(root.join("source-alias"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(!root.join("source-directory/moved").exists());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn symlink_parent_swap_never_renames_from_or_into_an_external_directory() {
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicBool, Ordering};

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    for directory in ["inside-source", "inside-target-a", "inside-target-b"] {
        fs::create_dir(root.join(directory)).unwrap();
    }
    fs::write(outside.join("sentinel.txt"), b"outside").unwrap();
    symlink("inside-source", root.join("racing-source")).unwrap();
    symlink("inside-target-a", root.join("racing-target")).unwrap();
    let lease = authorize(&root);

    let stop = Arc::new(AtomicBool::new(false));
    let swap_root = root.clone();
    let swap_outside = outside.clone();
    let swap_stop = Arc::clone(&stop);
    let swapper = std::thread::spawn(move || {
        let source_targets = [PathBuf::from("inside-source"), swap_outside.clone()];
        let target_targets = [
            PathBuf::from("inside-target-a"),
            swap_outside,
            PathBuf::from("inside-target-b"),
        ];
        let mut index = 0usize;
        while !swap_stop.load(Ordering::Relaxed) {
            let source_link = swap_root.join("racing-source");
            let target_link = swap_root.join("racing-target");
            let _ = fs::remove_file(&source_link);
            let _ = symlink(&source_targets[index % source_targets.len()], &source_link);
            let _ = fs::remove_file(&target_link);
            let _ = symlink(&target_targets[index % target_targets.len()], &target_link);
            index += 1;
        }
    });

    for index in 0..400 {
        let source = format!("stable-source-{index}");
        fs::write(root.join(&source), b"stable").unwrap();
        if let Err(error) = rename_entry(
            &lease,
            &path(&source),
            &path(&format!("racing-target/target-{index}")),
        ) {
            assert_sanitized_parent_error(&error);
        }

        fs::write(root.join("inside-source/sentinel.txt"), b"inside").unwrap();
        if let Err(error) = rename_entry(
            &lease,
            &path("racing-source/sentinel.txt"),
            &path(&format!("moved-source-{index}")),
        ) {
            assert_sanitized_parent_error(&error);
        }
    }
    stop.store(true, Ordering::Relaxed);
    swapper.join().unwrap();

    assert_eq!(fs::read(outside.join("sentinel.txt")).unwrap(), b"outside");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn one_logical_parent_uses_one_opened_directory_during_symlink_swaps() {
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicBool, Ordering};

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(root.join("inside-a")).unwrap();
    fs::create_dir(root.join("inside-b")).unwrap();
    fs::write(outside.join("sentinel"), b"outside").unwrap();
    symlink("inside-a", root.join("racing-parent")).unwrap();
    let lease = authorize(&root);

    let stop = Arc::new(AtomicBool::new(false));
    let swap_root = root.clone();
    let swap_outside = outside.clone();
    let swap_stop = Arc::clone(&stop);
    let swapper = std::thread::spawn(move || {
        let targets = [
            PathBuf::from("inside-a"),
            PathBuf::from("inside-b"),
            swap_outside,
        ];
        let mut index = 0usize;
        while !swap_stop.load(Ordering::Relaxed) {
            let link = swap_root.join("racing-parent");
            let _ = fs::remove_file(&link);
            let _ = symlink(&targets[index % targets.len()], &link);
            index += 1;
        }
    });

    for index in 0..400 {
        let source_name = format!("source-{index}");
        let target_name = format!("target-{index}");
        fs::write(root.join("inside-a").join(&source_name), b"a").unwrap();
        fs::write(root.join("inside-b").join(&source_name), b"b").unwrap();
        let result = rename_entry(
            &lease,
            &path(&format!("racing-parent/{source_name}")),
            &path(&format!("racing-parent/{target_name}")),
        );
        if let Err(error) = result {
            assert_sanitized_parent_error(&error);
        }

        for (directory, expected) in [("inside-a", b"a"), ("inside-b", b"b")] {
            let source = root.join(directory).join(&source_name);
            let target = root.join(directory).join(&target_name);
            match (source.exists(), target.exists()) {
                (true, false) => {}
                (false, true) => assert_eq!(fs::read(target).unwrap(), expected),
                state => panic!("rename must stay within one opened parent, got {state:?}"),
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    swapper.join().unwrap();

    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"outside");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_supports_same_and_cross_root_files_and_preserves_basic_mode() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let temp = TempDir::new().unwrap();
    let source_root = temp.path().join("source-root");
    let target_root = temp.path().join("target-root");
    fs::create_dir(&source_root).unwrap();
    fs::create_dir(&target_root).unwrap();
    fs::create_dir(target_root.join("nested")).unwrap();
    fs::write(source_root.join("source.bin"), b"plain-copy").unwrap();
    fs::set_permissions(
        source_root.join("source.bin"),
        fs::Permissions::from_mode(0o754),
    )
    .unwrap();

    let mut scope = WorkspaceScope::new();
    let ids = scope
        .authorize_roots_atomically(&[source_root.clone(), target_root.clone()])
        .unwrap();
    let source_lease = scope.lease(ids[0]).unwrap();
    let same_root_target = scope.lease(ids[0]).unwrap();
    let cross_root_target = scope.lease(ids[1]).unwrap();

    copy_regular_file(
        &source_lease,
        &path("source.bin"),
        &same_root_target,
        &path("same-root.bin"),
    )
    .unwrap();
    copy_regular_file(
        &source_lease,
        &path("source.bin"),
        &cross_root_target,
        &path("nested/cross-root.bin"),
    )
    .unwrap();

    assert_eq!(
        fs::read(source_root.join("source.bin")).unwrap(),
        b"plain-copy"
    );
    assert_eq!(
        fs::read(source_root.join("same-root.bin")).unwrap(),
        b"plain-copy"
    );
    assert_eq!(
        fs::read(target_root.join("nested/cross-root.bin")).unwrap(),
        b"plain-copy"
    );
    assert_eq!(
        fs::metadata(target_root.join("nested/cross-root.bin"))
            .unwrap()
            .mode()
            & 0o777,
        0o754
    );
    assert_no_staging_entries(&source_root);
    assert_no_staging_entries(&target_root.join("nested"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_rejects_invalid_paths_types_and_missing_target_parents() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    fs::create_dir(root.join("source-dir")).unwrap();
    fs::write(root.join("parent-file"), b"parent").unwrap();
    let lease = authorize(&root);

    for (source, target, expected) in [
        ("", "target", "ENTRY_TYPE_MISMATCH"),
        ("source", "", "ENTRY_TYPE_MISMATCH"),
        ("missing", "target", "ENTRY_NOT_FOUND"),
        ("source-dir", "target", "ENTRY_TYPE_MISMATCH"),
        ("source", "missing-parent/target", "ENTRY_NOT_FOUND"),
        ("source", "parent-file/target", "ENTRY_TYPE_MISMATCH"),
    ] {
        assert_eq!(
            copy_regular_file(&lease, &path(source), &lease, &path(target))
                .unwrap_err()
                .code(),
            expected
        );
    }
    assert_eq!(
        copy_regular_file(&lease, &path("missing"), &lease, &path("missing"))
            .unwrap_err()
            .code(),
        "ENTRY_ALREADY_EXISTS"
    );
    assert_eq!(
        copy_regular_file(&lease, &path("source"), &lease, &path("source/descendant"))
            .unwrap_err()
            .code(),
        "WORKSPACE_CONFLICT"
    );
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_rejects_symlinks_special_files_and_every_existing_target_kind() {
    use std::os::unix::fs::{symlink, FileTypeExt};
    use std::os::unix::net::UnixDatagram;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    symlink("source", root.join("source-link")).unwrap();
    symlink("missing", root.join("source-dangling")).unwrap();
    create_fifo(&root.join("source-fifo"));
    fs::write(root.join("target-file"), b"target").unwrap();
    fs::create_dir(root.join("target-dir")).unwrap();
    symlink("target-file", root.join("target-link")).unwrap();
    symlink("missing", root.join("target-dangling-link")).unwrap();
    create_fifo(&root.join("target-fifo"));
    let _target_socket = UnixDatagram::bind(root.join("target-socket")).unwrap();
    let lease = authorize(&root);

    for source in ["source-link", "source-dangling", "source-fifo"] {
        assert_eq!(
            copy_regular_file(&lease, &path(source), &lease, &path("unused"))
                .unwrap_err()
                .code(),
            "ENTRY_TYPE_MISMATCH"
        );
    }
    for target in [
        "target-file",
        "target-dir",
        "target-link",
        "target-dangling-link",
        "target-fifo",
        "target-socket",
    ] {
        assert_eq!(
            copy_regular_file(&lease, &path("source"), &lease, &path(target))
                .unwrap_err()
                .code(),
            "ENTRY_ALREADY_EXISTS"
        );
    }

    assert_eq!(fs::read(root.join("target-file")).unwrap(), b"target");
    assert!(root.join("target-dir").is_dir());
    assert_eq!(
        fs::read_link(root.join("target-link")).unwrap(),
        path("target-file").as_path()
    );
    assert_eq!(
        fs::read_link(root.join("target-dangling-link")).unwrap(),
        path("missing").as_path()
    );
    assert!(fs::symlink_metadata(root.join("target-fifo"))
        .unwrap()
        .file_type()
        .is_fifo());
    assert!(fs::symlink_metadata(root.join("target-socket"))
        .unwrap()
        .file_type()
        .is_socket());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_does_not_block_when_source_is_swapped_to_a_fifo_before_open() {
    use std::sync::mpsc;
    use std::time::Duration;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let source = root.join("source");
    fs::write(&source, b"source").unwrap();
    let lease = authorize(&root);
    let hook_source = source.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let result = copy_regular_file_with_pre_open_hook(
            &lease,
            &path("source"),
            &lease,
            &path("target"),
            move || {
                fs::remove_file(&hook_source).unwrap();
                create_fifo(&hook_source);
            },
        );
        result_tx.send(result).unwrap();
    });

    let first_result = result_rx.recv_timeout(Duration::from_secs(2));
    let timed_out = first_result.is_err();
    let result = match first_result {
        Ok(result) => result,
        Err(_) => {
            let _rescue = fs::OpenOptions::new().write(true).open(&source).unwrap();
            result_rx.recv_timeout(Duration::from_secs(2)).unwrap()
        }
    };
    worker.join().unwrap();

    assert!(!timed_out, "copy source open must be nonblocking");
    assert_eq!(result.unwrap_err().code(), "ENTRY_TYPE_MISMATCH");
    assert!(!root.join("target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_never_follows_a_final_symlink_swapped_in_before_source_open() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("source"), b"inside").unwrap();
    fs::write(outside.join("sentinel"), b"outside").unwrap();
    let lease = authorize(&root);
    let source = root.join("source");
    let outside_sentinel = outside.join("sentinel");

    let error = copy_regular_file_with_pre_open_hook(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        move || {
            fs::remove_file(&source).unwrap();
            symlink(&outside_sentinel, &source).unwrap();
        },
    )
    .unwrap_err();

    assert_eq!(error.code(), "ENTRY_TYPE_MISMATCH");
    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"outside");
    assert!(!root.join("target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staged_copy_accepts_exactly_eight_mib_and_reads_only_one_probe_byte_more() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::File::create(root.join("exact"))
        .unwrap()
        .set_len(MAX_COPY_FILE_BYTES as u64)
        .unwrap();
    fs::File::create(root.join("oversized"))
        .unwrap()
        .set_len(MAX_COPY_FILE_BYTES as u64 + 1)
        .unwrap();
    fs::write(root.join("growing"), b"small").unwrap();
    let lease = authorize(&root);

    copy_regular_file(&lease, &path("exact"), &lease, &path("exact-target")).unwrap();
    assert_eq!(
        fs::metadata(root.join("exact-target")).unwrap().len(),
        MAX_COPY_FILE_BYTES as u64
    );
    assert_eq!(
        copy_regular_file(
            &lease,
            &path("oversized"),
            &lease,
            &path("oversized-target")
        )
        .unwrap_err()
        .code(),
        "FILE_TOO_LARGE"
    );

    let growing = root.join("growing");
    assert_eq!(
        copy_regular_file_with_hooks(
            &lease,
            &path("growing"),
            &lease,
            &path("growing-target"),
            move || {
                fs::OpenOptions::new()
                    .write(true)
                    .open(&growing)
                    .unwrap()
                    .set_len(MAX_COPY_FILE_BYTES as u64 + 1)
                    .unwrap();
            },
            || {},
            || {},
        )
        .unwrap_err()
        .code(),
        "FILE_TOO_LARGE"
    );
    assert!(!root.join("oversized-target").exists());
    assert!(!root.join("growing-target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn opened_source_handle_does_not_jump_when_its_basename_is_replaced() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"opened-handle").unwrap();
    let lease = authorize(&root);
    let hook_root = root.clone();

    copy_regular_file_with_hooks(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        move || {
            fs::rename(hook_root.join("source"), hook_root.join("moved-source")).unwrap();
            fs::write(hook_root.join("source"), b"replacement").unwrap();
        },
        || {},
        || {},
    )
    .unwrap();

    assert_eq!(fs::read(root.join("target")).unwrap(), b"opened-handle");
    assert_eq!(fs::read(root.join("source")).unwrap(), b"replacement");
    assert_eq!(
        fs::read(root.join("moved-source")).unwrap(),
        b"opened-handle"
    );
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn same_length_rewrite_of_renamed_source_with_restored_mtime_returns_conflict() {
    use std::io::Write as _;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let original = b"original-content";
    let rewritten = b"rewritten-bytes!";
    assert_eq!(original.len(), rewritten.len());
    fs::write(root.join("source"), original).unwrap();
    let original_metadata = fs::metadata(root.join("source")).unwrap();
    let original_times = [
        libc::timespec {
            tv_sec: original_metadata.atime() as _,
            tv_nsec: original_metadata.atime_nsec() as _,
        },
        libc::timespec {
            tv_sec: original_metadata.mtime() as _,
            tv_nsec: original_metadata.mtime_nsec() as _,
        },
    ];
    let lease = authorize(&root);
    let rename_root = root.clone();
    let rewrite_root = root.clone();

    let error = copy_regular_file_with_hooks(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        move || {
            fs::rename(rename_root.join("source"), rename_root.join("moved-source")).unwrap();
            fs::write(rename_root.join("source"), b"replacement-name").unwrap();
        },
        move || {
            let mut moved_source = fs::OpenOptions::new()
                .write(true)
                .open(rewrite_root.join("moved-source"))
                .unwrap();
            moved_source.write_all(rewritten).unwrap();
            moved_source.sync_all().unwrap();
            // SAFETY: `moved_source` owns a valid descriptor and `original_times`
            // contains exactly the two timespec values required by futimens.
            assert_eq!(
                unsafe { libc::futimens(moved_source.as_raw_fd(), original_times.as_ptr()) },
                0
            );
        },
        || {},
    )
    .unwrap_err();

    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_eq!(fs::read(root.join("moved-source")).unwrap(), rewritten);
    assert_eq!(fs::read(root.join("source")).unwrap(), b"replacement-name");
    assert!(!root.join("target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn source_growth_after_transfer_returns_conflict_and_removes_its_stage() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    let lease = authorize(&root);
    let source = root.join("source");

    let error = copy_regular_file_with_hooks(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        || {},
        move || {
            use std::io::Write as _;
            fs::OpenOptions::new()
                .append(true)
                .open(&source)
                .unwrap()
                .write_all(b"!")
                .unwrap();
        },
        || {},
    )
    .unwrap_err();

    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_eq!(
        error.message(),
        "The workspace copy conflicts with the source path."
    );
    assert!(!root.join("target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn source_truncation_after_transfer_returns_conflict_and_removes_its_stage() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source-data").unwrap();
    let lease = authorize(&root);
    let source = root.join("source");

    let error = copy_regular_file_with_hooks(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        || {},
        move || {
            fs::OpenOptions::new()
                .write(true)
                .open(&source)
                .unwrap()
                .set_len(1)
                .unwrap();
        },
        || {},
    )
    .unwrap_err();

    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert!(!root.join("target").exists());
    assert_no_staging_entries(&root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn opened_source_and_target_parents_do_not_jump_during_external_symlink_swaps() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(root.join("inside-source")).unwrap();
    fs::create_dir(root.join("inside-target")).unwrap();
    fs::write(root.join("inside-source/source"), b"inside").unwrap();
    fs::write(outside.join("source"), b"outside-source").unwrap();
    fs::write(outside.join("sentinel"), b"outside-sentinel").unwrap();
    symlink("inside-source", root.join("source-parent")).unwrap();
    symlink("inside-target", root.join("target-parent")).unwrap();
    let lease = authorize(&root);
    let source_link = root.join("source-parent");
    let target_link = root.join("target-parent");
    let outside_for_source = outside.clone();
    let outside_for_target = outside.clone();

    copy_regular_file_with_hooks(
        &lease,
        &path("source-parent/source"),
        &lease,
        &path("target-parent/target"),
        move || {
            fs::remove_file(&source_link).unwrap();
            symlink(&outside_for_source, &source_link).unwrap();
        },
        || {},
        move || {
            fs::remove_file(&target_link).unwrap();
            symlink(&outside_for_target, &target_link).unwrap();
        },
    )
    .unwrap();

    assert_eq!(
        fs::read(root.join("inside-target/target")).unwrap(),
        b"inside"
    );
    assert_eq!(fs::read(outside.join("source")).unwrap(), b"outside-source");
    assert_eq!(
        fs::read(outside.join("sentinel")).unwrap(),
        b"outside-sentinel"
    );
    assert!(!outside.join("target").exists());
    assert_no_staging_entries(&root.join("inside-target"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn staging_identity_mismatch_never_publishes_or_deletes_the_replacement() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    let lease = authorize(&root);
    let hook_root = root.clone();

    let error = copy_regular_file_with_hooks(
        &lease,
        &path("source"),
        &lease,
        &path("target"),
        || {},
        || {},
        move || {
            let staging = staging_paths(&hook_root).pop().unwrap();
            fs::remove_file(&staging).unwrap();
            fs::write(&staging, b"replacement-stage").unwrap();
        },
    )
    .unwrap_err();

    assert_eq!(error.code(), "IO_FAILED");
    assert!(!root.join("target").exists());
    let artifacts = staging_paths(&root);
    assert_eq!(artifacts.len(), 1);
    assert_eq!(fs::read(&artifacts[0]).unwrap(), b"replacement-stage");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn concurrent_staged_copies_to_one_target_have_exactly_one_winner() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("first"), b"first").unwrap();
    fs::write(root.join("second"), b"second").unwrap();
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(&root).unwrap();
    let first_source = scope.lease(root_id).unwrap();
    let first_target = scope.lease(root_id).unwrap();
    let second_source = scope.lease(root_id).unwrap();
    let second_target = scope.lease(root_id).unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let spawn = |source_lease: WorkspaceRootLease,
                 target_lease: WorkspaceRootLease,
                 source: &'static str| {
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            copy_regular_file(&source_lease, &path(source), &target_lease, &path("target"))
        })
    };
    let first = spawn(first_source, first_target, "first");
    let second = spawn(second_source, second_target, "second");
    barrier.wait();
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
    let target = fs::read(root.join("target")).unwrap();
    assert!(target == b"first" || target == b"second");
    assert_eq!(fs::read(root.join("first")).unwrap(), b"first");
    assert_eq!(fs::read(root.join("second")).unwrap(), b"second");
    assert_no_staging_entries(&root);
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[test]
fn atomic_rename_fails_closed_on_unsupported_platforms() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    let lease = authorize(&root);

    assert_eq!(
        rename_entry(&lease, &path("source"), &path("target"))
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("source")).unwrap(), b"source");
    assert!(!root.join("target").exists());
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[test]
fn atomic_copy_fails_closed_on_unsupported_platforms() {
    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("source"), b"source").unwrap();
    let lease = authorize(&root);

    assert_eq!(
        copy_regular_file(&lease, &path("source"), &lease, &path("target"))
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );
    assert_eq!(fs::read(root.join("source")).unwrap(), b"source");
    assert!(!root.join("target").exists());
}

#[cfg(unix)]
#[test]
fn creation_treats_final_symlinks_as_existing_entries() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    fs::write(root.join("target.txt"), b"sentinel").unwrap();
    symlink("target.txt", root.join("file-link")).unwrap();
    symlink("missing.txt", root.join("dangling-link")).unwrap();
    let lease = authorize(&root);

    for link in ["file-link", "dangling-link"] {
        assert_eq!(
            create_file(&lease, &path(link)).unwrap_err().code(),
            "ENTRY_ALREADY_EXISTS"
        );
        assert_eq!(
            create_directory(&lease, &path(link)).unwrap_err().code(),
            "ENTRY_ALREADY_EXISTS"
        );
    }
    assert_eq!(fs::read(root.join("target.txt")).unwrap(), b"sentinel");
    assert!(fs::symlink_metadata(root.join("dangling-link"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[cfg(unix)]
#[test]
fn creation_follows_only_intermediate_symlinks_that_stay_inside_the_root() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(root.join("inside")).unwrap();
    fs::write(outside.join("sentinel.txt"), b"outside").unwrap();
    symlink("inside", root.join("inside-link")).unwrap();
    symlink(&outside, root.join("outside-link")).unwrap();
    symlink("missing", root.join("dangling-parent")).unwrap();
    symlink("loop-parent", root.join("loop-parent")).unwrap();
    let lease = authorize(&root);

    create_file(&lease, &path("inside-link/created.txt")).unwrap();
    create_directory(&lease, &path("inside-link/created-dir")).unwrap();
    assert!(root.join("inside/created.txt").is_file());
    assert!(root.join("inside/created-dir").is_dir());

    for parent in ["outside-link", "dangling-parent", "loop-parent"] {
        for create in [
            create_file as fn(&WorkspaceRootLease, &RelativePath) -> _,
            create_directory,
        ] {
            let error = create(&lease, &path(&format!("{parent}/private"))).unwrap_err();
            assert!(
                matches!(
                    error.code(),
                    "PATH_OUTSIDE_ROOT" | "ENTRY_NOT_FOUND" | "ENTRY_TYPE_MISMATCH" | "IO_FAILED"
                ),
                "unexpected sanitized error: {}",
                error.code()
            );
        }
    }
    assert_eq!(fs::read(outside.join("sentinel.txt")).unwrap(), b"outside");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_parent_swap_never_creates_an_entry_outside_the_capability() {
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicBool, Ordering};

    let temp = TempDir::new().unwrap();
    let root = create_root(&temp);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::create_dir(root.join("inside-a")).unwrap();
    fs::create_dir(root.join("inside-b")).unwrap();
    fs::write(outside.join("sentinel.txt"), b"outside").unwrap();
    symlink("inside-a", root.join("racing-parent")).unwrap();
    let lease = authorize(&root);

    let stop = Arc::new(AtomicBool::new(false));
    let swap_root = root.clone();
    let swap_outside = outside.clone();
    let swap_stop = Arc::clone(&stop);
    let swapper = std::thread::spawn(move || {
        let targets = [
            std::path::PathBuf::from("inside-a"),
            swap_outside,
            std::path::PathBuf::from("inside-b"),
        ];
        let mut index = 0usize;
        while !swap_stop.load(Ordering::Relaxed) {
            let link = swap_root.join("racing-parent");
            let _ = fs::remove_file(&link);
            let _ = symlink(&targets[index % targets.len()], &link);
            index += 1;
        }
    });

    for index in 0..400 {
        let relative_path = path(&format!("racing-parent/created-{index}"));
        let result = if index % 2 == 0 {
            create_file(&lease, &relative_path)
        } else {
            create_directory(&lease, &relative_path)
        };
        if let Err(error) = result {
            assert!(
                matches!(
                    error.code(),
                    "PATH_OUTSIDE_ROOT" | "ENTRY_NOT_FOUND" | "ENTRY_TYPE_MISMATCH" | "IO_FAILED"
                ),
                "unexpected sanitized race error: {}",
                error.code()
            );
        }
    }
    stop.store(true, Ordering::Relaxed);
    swapper.join().unwrap();

    assert_eq!(fs::read(outside.join("sentinel.txt")).unwrap(), b"outside");
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
}

#[test]
fn mutation_errors_are_stable_and_never_expose_private_paths() {
    let cases = [
        (
            std::io::Error::new(std::io::ErrorKind::NotFound, "/private/missing"),
            "ENTRY_NOT_FOUND",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::AlreadyExists, "/private/existing"),
            "ENTRY_ALREADY_EXISTS",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::NotADirectory, "/private/file"),
            "ENTRY_TYPE_MISMATCH",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "/private/outside"),
            "PATH_OUTSIDE_ROOT",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "/private/invalid"),
            "PATH_OUTSIDE_ROOT",
        ),
        (std::io::Error::other("/private/io"), "IO_FAILED"),
    ];

    for (source, expected) in cases {
        let error = super::map_workspace_mutation_error(source);
        assert_eq!(error.code(), expected);
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    #[cfg(unix)]
    for (source, expected) in [
        (
            std::io::Error::from_raw_os_error(libc::EACCES),
            "PERMISSION_DENIED",
        ),
        (std::io::Error::from_raw_os_error(libc::EINVAL), "IO_FAILED"),
    ] {
        let error = super::map_workspace_mutation_error(source);
        assert_eq!(error.code(), expected);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    for (source, expected) in [
        (rustix::io::Errno::EXIST, "ENTRY_ALREADY_EXISTS"),
        (rustix::io::Errno::NOTEMPTY, "ENTRY_ALREADY_EXISTS"),
        (rustix::io::Errno::NOENT, "ENTRY_NOT_FOUND"),
        (rustix::io::Errno::NOTDIR, "ENTRY_TYPE_MISMATCH"),
        (rustix::io::Errno::ISDIR, "ENTRY_TYPE_MISMATCH"),
        (rustix::io::Errno::ACCESS, "PERMISSION_DENIED"),
        (rustix::io::Errno::PERM, "PERMISSION_DENIED"),
        (rustix::io::Errno::ROFS, "PERMISSION_DENIED"),
        (rustix::io::Errno::NOSYS, "IO_FAILED"),
        (rustix::io::Errno::NOTSUP, "IO_FAILED"),
        (rustix::io::Errno::INVAL, "IO_FAILED"),
        (rustix::io::Errno::XDEV, "IO_FAILED"),
        (rustix::io::Errno::BUSY, "IO_FAILED"),
    ] {
        let error = super::map_rename_error(source);
        assert_eq!(error.code(), expected);
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        for (source, expected) in [
            (rustix::io::Errno::EXIST, "ENTRY_ALREADY_EXISTS"),
            (rustix::io::Errno::NOTEMPTY, "ENTRY_ALREADY_EXISTS"),
            (rustix::io::Errno::ACCESS, "PERMISSION_DENIED"),
            (rustix::io::Errno::NOTSUP, "IO_FAILED"),
            (rustix::io::Errno::XDEV, "IO_FAILED"),
        ] {
            assert_eq!(super::map_copy_publish_error(source).code(), expected);
        }
        for source in [libc::ELOOP, libc::ENXIO, libc::ENODEV] {
            assert_eq!(
                super::map_copy_source_open_error(std::io::Error::from_raw_os_error(source)).code(),
                "ENTRY_TYPE_MISMATCH"
            );
        }
    }
}

fn assert_single_winner(
    root: &std::path::Path,
    relative_path: &'static str,
    create: fn(&WorkspaceRootLease, &RelativePath) -> Result<(), crate::error::CommandError>,
) {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    let first_lease = scope.lease(root_id).unwrap();
    let second_lease = scope.lease(root_id).unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let spawn = |lease: WorkspaceRootLease| {
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            create(&lease, &path(relative_path))
        })
    };
    let first = spawn(first_lease);
    let second = spawn(second_lease);
    barrier.wait();
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
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn assert_sanitized_parent_error(error: &crate::error::CommandError) {
    assert!(
        matches!(
            error.code(),
            "PATH_OUTSIDE_ROOT" | "ENTRY_NOT_FOUND" | "ENTRY_TYPE_MISMATCH" | "IO_FAILED"
        ),
        "unexpected sanitized parent error: {}",
        error.code()
    );
    assert!(!serde_json::to_string(error).unwrap().contains("private"));
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn staging_paths(directory: &std::path::Path) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(STAGING_PREFIX))
        })
        .map(|entry| entry.path())
        .collect()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn assert_no_staging_entries(directory: &std::path::Path) {
    assert!(
        staging_paths(directory).is_empty(),
        "copy staging entries must be cleaned up"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn create_fifo(path: &std::path::Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let native = CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `native` is a NUL-terminated path owned for the call and the
    // mode contains only ordinary permission bits.
    let result = unsafe { libc::mkfifo(native.as_ptr(), 0o600) };
    assert_eq!(result, 0);
}

fn create_root(temp: &TempDir) -> std::path::PathBuf {
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    root
}

fn authorize(root: &std::path::Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}
