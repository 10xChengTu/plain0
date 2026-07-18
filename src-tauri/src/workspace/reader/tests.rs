use std::fs;

use tempfile::TempDir;

use super::{read_directory_with_limits, read_file_with_limit, stat, ReaderLimits};
use crate::path_policy::RelativePath;
use crate::workspace::dto::WorkspaceEntryKind;
use crate::workspace::{WorkspaceRootLease, WorkspaceScope};

#[test]
fn stat_and_read_directory_return_owned_exact_sorted_contracts() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("folder")).unwrap();
    fs::write(root.join("z.txt"), b"plain").unwrap();
    fs::write(root.join(".hidden"), b"hidden").unwrap();
    fs::write(root.join("é.txt"), b"unicode").unwrap();
    let lease = authorize(&root);

    let root_stat = stat(&lease, &path("")).unwrap();
    assert_eq!(root_stat.kind(), WorkspaceEntryKind::Directory);
    assert!(root_stat.size() <= 9_007_199_254_740_991);
    assert!(root_stat.mtime() <= 9_007_199_254_740_991);
    assert!(root_stat.ctime() <= 9_007_199_254_740_991);

    let file_stat = stat(&lease, &path("z.txt")).unwrap();
    assert_eq!(file_stat.kind(), WorkspaceEntryKind::File);
    assert_eq!(file_stat.size(), 5);
    let stat_value = serde_json::to_value(&file_stat).unwrap();
    assert_exact_keys(&stat_value, &["ctime", "kind", "mtime", "size"]);
    assert_eq!(stat_value["kind"], "file");

    let listing = super::read_directory(&lease, &path("")).unwrap();
    let names = listing
        .entries()
        .iter()
        .map(|entry| entry.name())
        .collect::<Vec<_>>();
    assert_eq!(names, [".hidden", "folder", "z.txt", "é.txt"]);
    assert_eq!(listing.entries()[1].kind(), WorkspaceEntryKind::Directory);

    let listing_value = serde_json::to_value(&listing).unwrap();
    assert_exact_keys(&listing_value, &["entries"]);
    for entry in listing_value["entries"].as_array().unwrap() {
        assert_exact_keys(entry, &["kind", "name"]);
    }
}

#[test]
fn read_directory_rejects_missing_and_non_directory_entries() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("file.txt"), b"plain").unwrap();
    let lease = authorize(&root);

    assert_eq!(
        super::read_directory(&lease, &path("file.txt"))
            .unwrap_err()
            .code(),
        "ENTRY_TYPE_MISMATCH"
    );
    assert_eq!(
        stat(&lease, &path("missing.txt")).unwrap_err().code(),
        "ENTRY_NOT_FOUND"
    );
}

#[test]
fn read_file_preserves_binary_bytes_and_rejects_non_files() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("directory")).unwrap();
    let binary = [0, 255, 128, 1, 0, 42];
    fs::write(root.join("binary.bin"), binary).unwrap();
    fs::write(root.join("empty.bin"), []).unwrap();
    let lease = authorize(&root);

    assert_eq!(
        super::read_file(&lease, &path("binary.bin")).unwrap(),
        binary
    );
    assert!(super::read_file(&lease, &path("empty.bin"))
        .unwrap()
        .is_empty());
    for relative_path in ["", "directory"] {
        assert_eq!(
            super::read_file(&lease, &path(relative_path))
                .unwrap_err()
                .code(),
            "ENTRY_TYPE_MISMATCH"
        );
    }
    assert_eq!(
        super::read_file(&lease, &path("missing.bin"))
            .unwrap_err()
            .code(),
        "ENTRY_NOT_FOUND"
    );
}

#[test]
fn read_file_accepts_the_exact_limit_and_rejects_one_byte_more() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let exact_path = root.join("exact.bin");
    let oversized_path = root.join("oversized.bin");
    fs::File::create(&exact_path)
        .unwrap()
        .set_len(super::MAX_FILE_BYTES as u64)
        .unwrap();
    fs::File::create(&oversized_path)
        .unwrap()
        .set_len(super::MAX_FILE_BYTES as u64 + 1)
        .unwrap();
    let lease = authorize(&root);

    let exact = super::read_file(&lease, &path("exact.bin")).unwrap();
    assert_eq!(exact.len(), super::MAX_FILE_BYTES);
    assert!(exact.iter().all(|byte| *byte == 0));
    assert_eq!(
        super::read_file(&lease, &path("oversized.bin"))
            .unwrap_err()
            .code(),
        "FILE_TOO_LARGE"
    );

    fs::write(root.join("small-boundary.bin"), b"12345").unwrap();
    assert_eq!(
        read_file_with_limit(&lease, &path("small-boundary.bin"), 5).unwrap(),
        b"12345"
    );
    assert_eq!(
        read_file_with_limit(&lease, &path("small-boundary.bin"), 4)
            .unwrap_err()
            .code(),
        "FILE_TOO_LARGE"
    );
}

#[test]
fn bounded_read_detects_growth_after_metadata_and_stops_at_limit_plus_one() {
    use std::io::Cursor;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let growing_path = root.join("growing.bin");
    fs::write(&growing_path, b"1234").unwrap();
    let lease = authorize(&root);
    let mut opened = lease.directory().open("growing.bin").unwrap();
    let prechecked_size = opened.metadata().unwrap().len();
    assert_eq!(prechecked_size, 4);
    fs::write(&growing_path, b"12345").unwrap();

    assert_eq!(
        super::read_bounded(&mut opened, prechecked_size, 4)
            .unwrap_err()
            .code(),
        "FILE_TOO_LARGE"
    );

    let mut unbounded_source = Cursor::new(vec![7; 1_024]);
    assert_eq!(
        super::read_bounded(&mut unbounded_source, 4, 4)
            .unwrap_err()
            .code(),
        "FILE_TOO_LARGE"
    );
    assert_eq!(unbounded_source.position(), 5);
}

#[cfg(unix)]
#[test]
fn read_file_rejects_special_files_before_opening_them() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    create_fifo(&root.join("private.fifo"));
    let lease = authorize(&root);
    let error = super::read_file(&lease, &path("private.fifo")).unwrap_err();
    assert_eq!(error.code(), "ENTRY_TYPE_MISMATCH");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains("private.fifo"));
}

#[cfg(unix)]
#[test]
fn read_file_does_not_block_when_a_regular_file_is_swapped_for_a_fifo() {
    use std::sync::mpsc;
    use std::time::Duration;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    let target = root.join("racing-entry");
    fs::write(&target, b"regular").unwrap();
    let lease = authorize(&root);
    let reader_target = target.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let result =
            super::read_file_with_limit_and_hook(&lease, &path("racing-entry"), 64, || {
                fs::remove_file(&reader_target).unwrap();
                create_fifo(&reader_target);
            });
        result_tx.send(result).unwrap();
    });

    let first_result = result_rx.recv_timeout(Duration::from_secs(2));
    let timed_out = first_result.is_err();
    let recovered_result = match first_result {
        Ok(result) => Some(result),
        Err(_) => {
            let _rescue = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&target)
                .ok();
            result_rx.recv_timeout(Duration::from_secs(2)).ok()
        }
    };
    let result = match recovered_result {
        Some(result) => {
            reader
                .join()
                .expect("FIFO reader thread must exit after cleanup");
            result
        }
        None => {
            drop(reader);
            panic!("FIFO rescue must release a blocking reader");
        }
    };
    assert!(!timed_out, "capability file open must set O_NONBLOCK");
    let error = result.unwrap_err();
    assert_eq!(error.code(), "ENTRY_TYPE_MISMATCH");
}

#[cfg(unix)]
#[test]
fn read_file_rejects_a_symlink_swapped_outside_after_metadata_precheck() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    let outside = temp.path().join("private-outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("inside.txt"), b"inside").unwrap();
    let outside_file = outside.join("secret.txt");
    fs::write(&outside_file, b"secret sentinel").unwrap();
    let link = root.join("racing-link");
    symlink("inside.txt", &link).unwrap();
    let lease = authorize(&root);

    let result = super::read_file_with_limit_and_hook(&lease, &path("racing-link"), 64, || {
        fs::remove_file(&link).unwrap();
        symlink(&outside_file, &link).unwrap();
    });
    let error = match result {
        Ok(_) => panic!("an external symlink target must never be returned"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "PATH_OUTSIDE_ROOT");
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));
}

#[cfg(unix)]
fn create_fifo(path: &std::path::Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let native = CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `native` is a NUL-terminated path owned for the duration of the
    // call, and the mode contains only ordinary permission bits.
    let result = unsafe { libc::mkfifo(native.as_ptr(), 0o600) };
    assert_eq!(result, 0);
}

#[test]
fn directory_limits_fail_the_whole_listing_without_truncation() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("aa"), b"").unwrap();
    fs::write(root.join("bb"), b"").unwrap();
    let lease = authorize(&root);

    let entry_limit = ReaderLimits {
        max_entries: 1,
        max_name_bytes: 10,
        max_name_payload_bytes: 10,
    };
    assert_eq!(
        read_directory_with_limits(&lease, &path(""), entry_limit)
            .unwrap_err()
            .code(),
        "DIRECTORY_TOO_LARGE"
    );

    let payload_limit = ReaderLimits {
        max_entries: 2,
        max_name_bytes: 10,
        max_name_payload_bytes: 3,
    };
    assert_eq!(
        read_directory_with_limits(&lease, &path(""), payload_limit)
            .unwrap_err()
            .code(),
        "DIRECTORY_TOO_LARGE"
    );

    let exact_limits = ReaderLimits {
        max_entries: 2,
        max_name_bytes: 2,
        max_name_payload_bytes: 4,
    };
    assert_eq!(
        read_directory_with_limits(&lease, &path(""), exact_limits)
            .unwrap()
            .entries()
            .len(),
        2
    );

    let name_limit = ReaderLimits {
        max_entries: 2,
        max_name_bytes: 1,
        max_name_payload_bytes: 10,
    };
    assert_eq!(
        read_directory_with_limits(&lease, &path(""), name_limit)
            .unwrap_err()
            .code(),
        "DIRECTORY_TOO_LARGE"
    );
}

#[test]
fn child_names_must_remain_addressable_within_the_complete_relative_path() {
    let segment_limit = std::iter::repeat_n("a", crate::path_policy::MAX_RELATIVE_PATH_SEGMENTS)
        .collect::<Vec<_>>()
        .join("/");
    let parent = path(&segment_limit);
    assert_eq!(
        super::validate_entry_name(&parent, "child", 1_024)
            .unwrap_err()
            .code(),
        "PATH_ENCODING_UNSUPPORTED"
    );

    let byte_limit = "a".repeat(crate::path_policy::MAX_RELATIVE_PATH_BYTES);
    let parent = path(&byte_limit);
    assert_eq!(
        super::validate_entry_name(&parent, "child", 1_024)
            .unwrap_err()
            .code(),
        "PATH_ENCODING_UNSUPPORTED"
    );
}

#[cfg(unix)]
#[test]
fn non_portable_names_fail_without_exposing_the_name() {
    let temp = TempDir::new().unwrap();
    let portable_root = temp.path().join("portable-root");
    fs::create_dir(&portable_root).unwrap();
    fs::write(portable_root.join("private:name"), b"private").unwrap();
    let portable_lease = authorize(&portable_root);
    let portable_error = super::read_directory(&portable_lease, &path("")).unwrap_err();
    assert_eq!(portable_error.code(), "PATH_ENCODING_UNSUPPORTED");
    assert!(!serde_json::to_string(&portable_error)
        .unwrap()
        .contains("private:name"));
}

#[cfg(unix)]
#[test]
fn non_utf8_name_decoding_fails_without_lossy_output() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let error =
        super::decode_entry_name(OsString::from_vec(b"private-\xFF-name".to_vec())).unwrap_err();
    assert_eq!(error.code(), "PATH_ENCODING_UNSUPPORTED");
    assert!(!serde_json::to_string(&error).unwrap().contains("private"));
}

#[cfg(target_os = "linux")]
#[test]
fn non_utf8_filesystem_entries_fail_the_whole_listing() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let temp = TempDir::new().unwrap();
    let utf8_root = temp.path().join("utf8-root");
    fs::create_dir(&utf8_root).unwrap();
    fs::write(
        utf8_root.join(OsString::from_vec(b"private-\xFF-name".to_vec())),
        b"private",
    )
    .unwrap();
    let utf8_lease = authorize(&utf8_root);
    let utf8_error = super::read_directory(&utf8_lease, &path("")).unwrap_err();
    assert_eq!(utf8_error.code(), "PATH_ENCODING_UNSUPPORTED");
    assert!(!serde_json::to_string(&utf8_error)
        .unwrap()
        .contains("private"));
}

#[cfg(unix)]
#[test]
fn symlinks_are_classified_without_following_targets_outside_the_root() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    let outside = temp.path().join("private-outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("inside-dir")).unwrap();
    fs::write(root.join("inside.txt"), b"inside").unwrap();
    fs::write(root.join("inside-dir/child.txt"), b"child").unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret.txt"), b"secret").unwrap();
    symlink("inside.txt", root.join("inside-file-link")).unwrap();
    symlink("inside-dir", root.join("inside-dir-link")).unwrap();
    symlink(outside.join("secret.txt"), root.join("outside-file-link")).unwrap();
    symlink(&outside, root.join("outside-dir-link")).unwrap();
    symlink("missing", root.join("dangling-link")).unwrap();
    symlink("loop-link", root.join("loop-link")).unwrap();
    let lease = authorize(&root);

    let listing = super::read_directory(&lease, &path("")).unwrap();
    let kind = |name: &str| {
        listing
            .entries()
            .iter()
            .find(|entry| entry.name() == name)
            .unwrap()
            .kind()
    };
    assert_eq!(kind("inside-file-link"), WorkspaceEntryKind::SymlinkFile);
    assert_eq!(
        kind("inside-dir-link"),
        WorkspaceEntryKind::SymlinkDirectory
    );
    assert_eq!(kind("outside-file-link"), WorkspaceEntryKind::Symlink);
    assert_eq!(kind("outside-dir-link"), WorkspaceEntryKind::Symlink);
    assert_eq!(kind("dangling-link"), WorkspaceEntryKind::Symlink);
    assert_eq!(kind("loop-link"), WorkspaceEntryKind::Symlink);

    assert_eq!(
        super::read_file(&lease, &path("inside-file-link")).unwrap(),
        b"inside"
    );
    assert_eq!(
        super::read_file(&lease, &path("inside-dir-link"))
            .unwrap_err()
            .code(),
        "ENTRY_TYPE_MISMATCH"
    );
    let external_read = super::read_file(&lease, &path("outside-file-link")).unwrap_err();
    assert_eq!(external_read.code(), "PATH_OUTSIDE_ROOT");
    assert!(!serde_json::to_string(&external_read)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));
    assert_eq!(
        super::read_file(&lease, &path("dangling-link"))
            .unwrap_err()
            .code(),
        "ENTRY_NOT_FOUND"
    );
    assert_eq!(
        super::read_file(&lease, &path("loop-link"))
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );

    let link_stat = stat(&lease, &path("inside-file-link")).unwrap();
    assert_eq!(link_stat.kind(), WorkspaceEntryKind::SymlinkFile);
    assert_eq!(link_stat.size(), 6);
    assert_eq!(
        stat(&lease, &path("outside-file-link")).unwrap().kind(),
        WorkspaceEntryKind::Symlink
    );
    assert_eq!(
        stat(&lease, &path("dangling-link")).unwrap().kind(),
        WorkspaceEntryKind::Symlink
    );
    assert_eq!(
        stat(&lease, &path("loop-link")).unwrap().kind(),
        WorkspaceEntryKind::Symlink
    );
    assert_eq!(
        stat(&lease, &path("outside-dir-link/secret.txt"))
            .unwrap_err()
            .code(),
        "PATH_OUTSIDE_ROOT"
    );

    let internal = super::read_directory(&lease, &path("inside-dir-link")).unwrap();
    assert_eq!(internal.entries()[0].name(), "child.txt");
    let outside_error = super::read_directory(&lease, &path("outside-dir-link")).unwrap_err();
    assert_eq!(outside_error.code(), "PATH_OUTSIDE_ROOT");
    assert!(!serde_json::to_string(&outside_error)
        .unwrap()
        .contains(temp.path().to_str().unwrap()));
    assert_eq!(
        super::read_directory(&lease, &path("dangling-link"))
            .unwrap_err()
            .code(),
        "ENTRY_NOT_FOUND"
    );
}

#[cfg(unix)]
#[test]
fn symlink_swap_never_projects_metadata_from_outside_the_root() {
    use std::os::unix::fs::symlink;
    use std::sync::{Arc, Barrier};

    const OUTSIDE_SIZE: usize = 65_537;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("root");
    let outside = temp.path().join("private-outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(root.join("inside.txt"), b"inside").unwrap();
    let outside_file = outside.join("secret.txt");
    fs::write(&outside_file, vec![0; OUTSIDE_SIZE]).unwrap();
    let link = root.join("racing-link");
    symlink("inside.txt", &link).unwrap();
    let lease = authorize(&root);

    let start = Arc::new(Barrier::new(2));
    let swapper_start = Arc::clone(&start);
    let swapper_link = link.clone();
    let swapper = std::thread::spawn(move || {
        swapper_start.wait();
        for _ in 0..2_000 {
            fs::remove_file(&swapper_link).unwrap();
            symlink(&outside_file, &swapper_link).unwrap();
            fs::remove_file(&swapper_link).unwrap();
            symlink("inside.txt", &swapper_link).unwrap();
        }
    });

    start.wait();
    for _ in 0..4_000 {
        match stat(&lease, &path("racing-link")) {
            Ok(entry) => {
                assert_ne!(entry.size(), OUTSIDE_SIZE as u64);
                assert!(matches!(
                    entry.kind(),
                    WorkspaceEntryKind::Symlink | WorkspaceEntryKind::SymlinkFile
                ));
                if entry.kind() == WorkspaceEntryKind::SymlinkFile {
                    assert_eq!(entry.size(), 6);
                }
            }
            Err(error) => assert!(
                matches!(
                    error.code(),
                    "ENTRY_NOT_FOUND" | "PATH_OUTSIDE_ROOT" | "IO_FAILED"
                ),
                "unexpected sanitized race error: {}",
                error.code()
            ),
        }
    }
    swapper.join().unwrap();
}

#[test]
fn filesystem_errors_are_mapped_to_stable_sanitized_codes() {
    let cases = [
        (
            std::io::Error::new(std::io::ErrorKind::NotFound, "private path"),
            "ENTRY_NOT_FOUND",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::NotADirectory, "private path"),
            "ENTRY_TYPE_MISMATCH",
        ),
        (
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "private path"),
            "PATH_OUTSIDE_ROOT",
        ),
        (std::io::Error::other("private path"), "IO_FAILED"),
    ];

    for (source, expected_code) in cases {
        let error = super::map_workspace_io_error(source);
        assert_eq!(error.code(), expected_code);
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    #[cfg(unix)]
    {
        let error = super::map_workspace_io_error(std::io::Error::from_raw_os_error(13));
        assert_eq!(error.code(), "PERMISSION_DENIED");
        assert!(!serde_json::to_string(&error).unwrap().contains("denied"));
    }
}

#[test]
fn opened_handle_errors_never_claim_a_capability_path_escape() {
    for source in [
        std::io::Error::new(std::io::ErrorKind::PermissionDenied, "private handle"),
        std::io::Error::from(std::io::ErrorKind::PermissionDenied),
    ] {
        let error = super::map_handle_io_error(source);
        assert_eq!(error.code(), "PERMISSION_DENIED");
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    let error = super::map_handle_io_error(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "private handle",
    ));
    assert_eq!(error.code(), "IO_FAILED");
    assert!(!serde_json::to_string(&error).unwrap().contains("private"));
}

#[test]
fn numeric_metadata_boundaries_never_cross_javascript_safe_integer_limits() {
    assert_eq!(
        super::safe_size(super::MAX_JS_SAFE_INTEGER).unwrap(),
        super::MAX_JS_SAFE_INTEGER
    );
    assert_eq!(
        super::safe_size(super::MAX_JS_SAFE_INTEGER + 1)
            .unwrap_err()
            .code(),
        "IO_FAILED"
    );

    assert_eq!(
        super::safe_time_millis(u128::from(super::MAX_JS_SAFE_INTEGER)),
        super::MAX_JS_SAFE_INTEGER
    );
    assert_eq!(
        super::safe_time_millis(u128::from(super::MAX_JS_SAFE_INTEGER) + 1),
        0
    );
    assert_eq!(super::safe_time_millis(u128::MAX), 0);
    assert_eq!(
        super::system_time_millis(cap_std::time::SystemTime::from_std(
            std::time::UNIX_EPOCH - std::time::Duration::from_millis(1),
        )),
        0
    );
}

fn authorize(root: &std::path::Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}

fn assert_exact_keys(value: &serde_json::Value, expected: &[&str]) {
    let mut actual = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    actual.sort_unstable();
    assert_eq!(actual, expected);
}
