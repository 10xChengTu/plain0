use std::fs;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::PathBuf;
use std::sync::{Arc, Barrier};

use tempfile::TempDir;

use super::{create_directory, create_file, rename as rename_entry};
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
