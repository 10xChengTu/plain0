use std::fs;
use std::sync::{Arc, Barrier};

use tempfile::TempDir;

use super::{create_directory, create_file};
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
