use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;
use crate::workspace::dto::{WorkspaceMoveIncompleteReason, WorkspaceMoveResult};
use crate::workspace::WorkspaceScope;

#[test]
fn moves_files_symlinks_empty_directories_and_mixed_trees_between_roots() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new();
    fs::write(fixture.source.join("file.txt"), b"plain-file").unwrap();
    symlink("raw-target", fixture.source.join("link")).unwrap();
    fs::create_dir_all(fixture.source.join("tree/nested/empty")).unwrap();
    fs::write(fixture.source.join("tree/nested/data.bin"), b"plain-tree").unwrap();
    symlink("data.bin", fixture.source.join("tree/nested/link")).unwrap();

    assert_eq!(
        move_entry(
            &fixture.source_lease,
            &path("file.txt"),
            &fixture.target_lease,
            &path("file.txt"),
        )
        .unwrap(),
        WorkspaceMoveResult::Moved
    );
    assert_eq!(
        move_entry(
            &fixture.source_lease,
            &path("link"),
            &fixture.target_lease,
            &path("link"),
        )
        .unwrap(),
        WorkspaceMoveResult::Moved
    );
    assert_eq!(
        move_entry(
            &fixture.source_lease,
            &path("tree"),
            &fixture.target_lease,
            &path("tree"),
        )
        .unwrap(),
        WorkspaceMoveResult::Moved
    );

    assert!(!fixture.source.join("file.txt").exists());
    assert_entry_absent(&fixture.source.join("link"));
    assert!(!fixture.source.join("tree").exists());
    assert_eq!(
        fs::read(fixture.target.join("file.txt")).unwrap(),
        b"plain-file"
    );
    assert_eq!(
        fs::read_link(fixture.target.join("link")).unwrap(),
        Path::new("raw-target")
    );
    assert_eq!(
        fs::read(fixture.target.join("tree/nested/data.bin")).unwrap(),
        b"plain-tree"
    );
    assert!(fixture.target.join("tree/nested/empty").is_dir());
    assert_eq!(
        fs::read_link(fixture.target.join("tree/nested/link")).unwrap(),
        Path::new("data.bin")
    );
}

#[test]
fn same_root_is_rejected_before_copy_publication() {
    let fixture = Fixture::new();
    fs::write(fixture.source.join("source"), b"source").unwrap();

    let error = move_entry(
        &fixture.source_lease,
        &path("source"),
        &fixture.source_lease,
        &path("target"),
    )
    .unwrap_err();

    assert_eq!(error.code(), "WORKSPACE_CONFLICT");
    assert_eq!(fs::read(fixture.source.join("source")).unwrap(), b"source");
    assert!(!fixture.source.join("target").exists());
}

#[test]
fn source_change_after_publication_retains_source_and_published_target() {
    let fixture = Fixture::new();
    let source = fixture.source.join("source");
    fs::write(&source, b"before").unwrap();
    let mut hooks = TestHooks::after_publication({
        let source = source.clone();
        move || fs::write(source, b"after!").unwrap()
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("target"),
        &mut hooks,
    )
    .unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::SourceChanged,
        }
    );
    assert_eq!(fs::read(source).unwrap(), b"after!");
    assert_eq!(fs::read(fixture.target.join("target")).unwrap(), b"before");
}

#[test]
fn target_replacement_after_publication_retains_source_without_rollback() {
    let fixture = Fixture::new();
    fs::write(fixture.source.join("source"), b"source").unwrap();
    let target = fixture.target.join("target");
    let mut hooks = TestHooks::after_publication({
        let target = target.clone();
        move || {
            fs::remove_file(&target).unwrap();
            fs::write(&target, b"replacement").unwrap();
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("target"),
        &mut hooks,
    )
    .unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetChanged,
        }
    );
    assert_eq!(fs::read(fixture.source.join("source")).unwrap(), b"source");
    assert_eq!(fs::read(target).unwrap(), b"replacement");
}

#[test]
fn directory_change_after_first_delete_reports_exact_partial_count() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.source.join("tree")).unwrap();
    fs::write(fixture.source.join("tree/a.txt"), b"a").unwrap();
    fs::write(fixture.source.join("tree/b.txt"), b"b").unwrap();
    let source_to_change = fixture.source.join("tree/a.txt");
    let mut hooks = TestHooks::after_delete(move |removed| {
        if removed == 1 {
            fs::write(&source_to_change, b"changed").unwrap();
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("tree"),
        &fixture.target_lease,
        &path("tree"),
        &mut hooks,
    )
    .unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourcePartiallyDeleted {
            reason: WorkspaceMoveIncompleteReason::SourceChanged,
            removed_entries: 1,
        }
    );
    assert_eq!(
        fs::read(fixture.source.join("tree/a.txt")).unwrap(),
        b"changed"
    );
    assert!(!fixture.source.join("tree/b.txt").exists());
    assert_eq!(fs::read(fixture.target.join("tree/a.txt")).unwrap(), b"a");
    assert_eq!(fs::read(fixture.target.join("tree/b.txt")).unwrap(), b"b");
}

#[test]
fn hardlink_aliases_track_plain_nlink_and_ctime_changes() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.source.join("tree")).unwrap();
    fs::write(fixture.source.join("tree/a"), b"hardlink").unwrap();
    fs::hard_link(fixture.source.join("tree/a"), fixture.source.join("tree/b")).unwrap();

    let result = move_entry(
        &fixture.source_lease,
        &path("tree"),
        &fixture.target_lease,
        &path("tree"),
    )
    .unwrap();

    assert_eq!(result, WorkspaceMoveResult::Moved);
    assert!(!fixture.source.join("tree").exists());
    assert_eq!(
        fs::read(fixture.target.join("tree/a")).unwrap(),
        b"hardlink"
    );
    assert_eq!(
        fs::read(fixture.target.join("tree/b")).unwrap(),
        b"hardlink"
    );
}

#[test]
fn publication_digest_rejects_restored_mtime_and_coordinated_rewrites_source_first() {
    let fixture = Fixture::new();
    let source = fixture.source.join("source");
    let target = fixture.target.join("target");
    fs::write(&source, b"before").unwrap();
    let source_times = FileTimes::capture(&source);
    let mut hooks = TestHooks::after_publication({
        let source = source.clone();
        let target = target.clone();
        move || {
            let target_times = FileTimes::capture(&target);
            fs::write(&source, b"after!").unwrap();
            fs::write(&target, b"after!").unwrap();
            source_times.restore(&source);
            target_times.restore(&target);
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("target"),
        &mut hooks,
    )
    .unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::SourceChanged,
        }
    );
    assert_eq!(fs::read(source).unwrap(), b"after!");
    assert_eq!(fs::read(target).unwrap(), b"after!");
}

#[test]
fn target_digest_detects_equal_length_rewrite_with_restored_mtime() {
    let fixture = Fixture::new();
    fs::write(fixture.source.join("source"), b"before").unwrap();
    let target = fixture.target.join("target");
    let mut hooks = TestHooks::after_publication({
        let target = target.clone();
        move || {
            let times = FileTimes::capture(&target);
            fs::write(&target, b"after!").unwrap();
            times.restore(&target);
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("target"),
        &mut hooks,
    )
    .unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetChanged,
        }
    );
    assert_eq!(fs::read(fixture.source.join("source")).unwrap(), b"before");
    assert_eq!(fs::read(target).unwrap(), b"after!");
}

#[test]
fn symlink_payload_and_target_swaps_are_attributed_to_the_changed_side() {
    use std::os::unix::fs::symlink;

    let source_case = Fixture::new();
    let source_link = source_case.source.join("link");
    symlink("before", &source_link).unwrap();
    let mut source_hooks = TestHooks::after_publication({
        let source_link = source_link.clone();
        move || {
            fs::remove_file(&source_link).unwrap();
            symlink("after", &source_link).unwrap();
        }
    });
    let source_result = move_entry_with_hooks(
        &source_case.source_lease,
        &path("link"),
        &source_case.target_lease,
        &path("link"),
        &mut source_hooks,
    )
    .unwrap();
    assert_eq!(
        source_result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::SourceChanged,
        }
    );

    let target_case = Fixture::new();
    symlink("before", target_case.source.join("link")).unwrap();
    let target_link = target_case.target.join("link");
    let mut target_hooks = TestHooks::after_publication({
        let target_link = target_link.clone();
        move || {
            fs::remove_file(&target_link).unwrap();
            symlink("after", &target_link).unwrap();
        }
    });
    let target_result = move_entry_with_hooks(
        &target_case.source_lease,
        &path("link"),
        &target_case.target_lease,
        &path("link"),
        &mut target_hooks,
    )
    .unwrap();
    assert_eq!(
        target_result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetChanged,
        }
    );
    assert_eq!(fs::read_link(target_link).unwrap(), Path::new("after"));
}

#[test]
fn unknown_source_and_target_members_before_delete_retain_the_complete_source() {
    for mutate_source in [true, false] {
        let fixture = Fixture::new();
        fs::create_dir(fixture.source.join("tree")).unwrap();
        fs::write(fixture.source.join("tree/data"), b"data").unwrap();
        let injected = if mutate_source {
            fixture.source.join("tree/unknown")
        } else {
            fixture.target.join("tree/unknown")
        };
        let mut hooks = TestHooks::after_publication(move || {
            fs::write(injected, b"unknown").unwrap();
        });

        let result = move_entry_with_hooks(
            &fixture.source_lease,
            &path("tree"),
            &fixture.target_lease,
            &path("tree"),
            &mut hooks,
        )
        .unwrap();
        assert_eq!(
            result,
            WorkspaceMoveResult::TargetPublishedSourceRetained {
                reason: if mutate_source {
                    WorkspaceMoveIncompleteReason::SourceChanged
                } else {
                    WorkspaceMoveIncompleteReason::TargetChanged
                },
            }
        );
        assert_eq!(fs::read(fixture.source.join("tree/data")).unwrap(), b"data");
        assert_eq!(fs::read(fixture.target.join("tree/data")).unwrap(), b"data");
    }
}

#[test]
fn unknown_members_inserted_after_delete_report_exact_partial_counts() {
    for mutate_source in [true, false] {
        let fixture = Fixture::new();
        fs::create_dir(fixture.source.join("tree")).unwrap();
        fs::write(fixture.source.join("tree/a"), b"a").unwrap();
        fs::write(fixture.source.join("tree/b"), b"b").unwrap();
        let injected = if mutate_source {
            fixture.source.join("tree/unknown")
        } else {
            fixture.target.join("tree/unknown")
        };
        let mut hooks = TestHooks::after_delete(move |removed| {
            if removed == 1 {
                fs::write(&injected, b"unknown").unwrap();
            }
        });

        let result = move_entry_with_hooks(
            &fixture.source_lease,
            &path("tree"),
            &fixture.target_lease,
            &path("tree"),
            &mut hooks,
        )
        .unwrap();
        assert_eq!(
            result,
            WorkspaceMoveResult::TargetPublishedSourcePartiallyDeleted {
                reason: if mutate_source {
                    WorkspaceMoveIncompleteReason::SourceChanged
                } else {
                    WorkspaceMoveIncompleteReason::TargetChanged
                },
                removed_entries: 2,
            }
        );
    }
}

#[test]
fn nth_remove_failure_reports_delete_failed_without_touching_target() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new();
    let source_tree = fixture.source.join("tree");
    fs::create_dir(&source_tree).unwrap();
    fs::write(source_tree.join("a"), b"a").unwrap();
    fs::write(source_tree.join("b"), b"b").unwrap();
    let mut hooks = TestHooks::before_remove({
        let source_tree = source_tree.clone();
        move |next| {
            if next == 2 {
                fs::set_permissions(&source_tree, fs::Permissions::from_mode(0o555)).unwrap();
            }
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("tree"),
        &fixture.target_lease,
        &path("tree"),
        &mut hooks,
    )
    .unwrap();
    fs::set_permissions(&source_tree, fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourcePartiallyDeleted {
            reason: WorkspaceMoveIncompleteReason::DeleteFailed,
            removed_entries: 1,
        }
    );
    assert_eq!(fs::read(fixture.target.join("tree/a")).unwrap(), b"a");
    assert_eq!(fs::read(fixture.target.join("tree/b")).unwrap(), b"b");
}

#[test]
fn nofollow_parent_reopen_rejects_source_and_target_component_swaps() {
    use std::os::unix::fs::symlink;

    let source_case = Fixture::new();
    fs::create_dir(source_case.source.join("parent")).unwrap();
    fs::write(source_case.source.join("parent/file"), b"source").unwrap();
    let outside = source_case._temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("file"), b"sentinel").unwrap();
    let held = source_case.source.join("parent-held");
    let parent = source_case.source.join("parent");
    let mut source_hooks = TestHooks::after_publication({
        let parent = parent.clone();
        let held = held.clone();
        let outside = outside.clone();
        move || {
            fs::rename(&parent, &held).unwrap();
            symlink(&outside, &parent).unwrap();
        }
    });
    let source_result = move_entry_with_hooks(
        &source_case.source_lease,
        &path("parent/file"),
        &source_case.target_lease,
        &path("file"),
        &mut source_hooks,
    )
    .unwrap();
    assert_eq!(
        source_result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::SourceChanged,
        }
    );
    assert_eq!(fs::read(outside.join("file")).unwrap(), b"sentinel");
    fs::remove_file(&parent).unwrap();
    fs::rename(&held, &parent).unwrap();

    let target_case = Fixture::new();
    fs::write(target_case.source.join("file"), b"source").unwrap();
    fs::create_dir(target_case.target.join("parent")).unwrap();
    let outside = target_case._temp.path().join("target-outside");
    fs::create_dir(&outside).unwrap();
    let held = target_case.target.join("parent-held");
    let parent = target_case.target.join("parent");
    let mut target_hooks = TestHooks::after_publication({
        let parent = parent.clone();
        let held = held.clone();
        let outside = outside.clone();
        move || {
            fs::rename(&parent, &held).unwrap();
            symlink(&outside, &parent).unwrap();
        }
    });
    let target_result = move_entry_with_hooks(
        &target_case.source_lease,
        &path("file"),
        &target_case.target_lease,
        &path("parent/file"),
        &mut target_hooks,
    )
    .unwrap();
    assert_eq!(
        target_result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetChanged,
        }
    );
    assert!(held.join("file").is_file());
    fs::remove_file(&parent).unwrap();
    fs::rename(&held, &parent).unwrap();
}

#[test]
fn final_target_mode_that_prevents_reopen_is_target_unverifiable() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new();
    fs::create_dir_all(fixture.source.join("tree/nested")).unwrap();
    fs::write(fixture.source.join("tree/nested/data"), b"data").unwrap();
    let nested_target = fixture.target.join("tree/nested");
    let mut hooks = TestHooks::after_publication({
        let nested_target = nested_target.clone();
        move || {
            fs::set_permissions(&nested_target, fs::Permissions::from_mode(0o000)).unwrap();
        }
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("tree"),
        &fixture.target_lease,
        &path("tree"),
        &mut hooks,
    )
    .unwrap();
    fs::set_permissions(&nested_target, fs::Permissions::from_mode(0o755)).unwrap();

    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetUnverifiable,
        }
    );
    assert!(fixture.source.join("tree/nested/data").is_file());
}

#[test]
fn change_before_last_delete_validation_is_detected_without_source_remove() {
    let fixture = Fixture::new();
    fs::write(fixture.source.join("source"), b"source").unwrap();
    let target = fixture.target.join("target");
    let mut hooks = TestHooks::before_delete({
        let target = target.clone();
        move || fs::write(target, b"target").unwrap()
    });

    let result = move_entry_with_hooks(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("target"),
        &mut hooks,
    )
    .unwrap();
    assert_eq!(
        result,
        WorkspaceMoveResult::TargetPublishedSourceRetained {
            reason: WorkspaceMoveIncompleteReason::TargetChanged,
        }
    );
    assert!(fixture.source.join("source").is_file());
}

#[test]
fn prepublication_errors_leave_source_and_target_unchanged() {
    let fixture = Fixture::new();
    fs::write(fixture.source.join("source"), b"source").unwrap();
    fs::write(fixture.target.join("existing"), b"target").unwrap();
    create_fifo(&fixture.source.join("special"));

    let existing = move_entry(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("existing"),
    )
    .unwrap_err();
    assert_eq!(existing.code(), "ENTRY_ALREADY_EXISTS");
    let missing_parent = move_entry(
        &fixture.source_lease,
        &path("source"),
        &fixture.target_lease,
        &path("missing/target"),
    )
    .unwrap_err();
    assert_eq!(missing_parent.code(), "ENTRY_NOT_FOUND");
    let special = move_entry(
        &fixture.source_lease,
        &path("special"),
        &fixture.target_lease,
        &path("special"),
    )
    .unwrap_err();
    assert_eq!(special.code(), "ENTRY_TYPE_MISMATCH");
    assert_eq!(fs::read(fixture.source.join("source")).unwrap(), b"source");
    assert_eq!(
        fs::read(fixture.target.join("existing")).unwrap(),
        b"target"
    );
    assert!(!fixture.target.join("special").exists());
}

#[test]
fn target_pass_rechecks_source_and_preserves_source_first_failure_priority() {
    for mutate_source_too in [true, false] {
        let fixture = Fixture::new();
        fs::create_dir(fixture.source.join("tree")).unwrap();
        fs::write(fixture.source.join("tree/a"), b"a").unwrap();
        fs::write(fixture.source.join("tree/b"), b"b").unwrap();
        let source_b = fixture.source.join("tree/b");
        let target_b = fixture.target.join("tree/b");
        let mut hooks = TestHooks::after_target(move |verified| {
            if verified == 1 {
                if mutate_source_too {
                    fs::write(&source_b, b"source-changed").unwrap();
                }
                fs::write(&target_b, b"target-changed").unwrap();
            }
        });

        let result = move_entry_with_hooks(
            &fixture.source_lease,
            &path("tree"),
            &fixture.target_lease,
            &path("tree"),
            &mut hooks,
        )
        .unwrap();

        assert_eq!(
            result,
            WorkspaceMoveResult::TargetPublishedSourceRetained {
                reason: if mutate_source_too {
                    WorkspaceMoveIncompleteReason::SourceChanged
                } else {
                    WorkspaceMoveIncompleteReason::TargetChanged
                },
            }
        );
        assert!(fixture.source.join("tree/a").is_file());
        assert!(fixture.source.join("tree/b").is_file());
        assert_eq!(
            fs::read(fixture.target.join("tree/b")).unwrap(),
            b"target-changed"
        );
    }
}

struct Fixture {
    _temp: TempDir,
    source: PathBuf,
    target: PathBuf,
    source_lease: WorkspaceRootLease,
    target_lease: WorkspaceRootLease,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source-root");
        let target = temp.path().join("target-root");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        let mut scope = WorkspaceScope::new();
        let roots = scope
            .authorize_roots_atomically(&[source.clone(), target.clone()])
            .unwrap();
        Self {
            source_lease: scope.lease(roots[0]).unwrap(),
            target_lease: scope.lease(roots[1]).unwrap(),
            _temp: temp,
            source,
            target,
        }
    }
}

struct TestHooks {
    after_publication: Option<Box<dyn FnOnce()>>,
    before_delete: Option<Box<dyn FnOnce()>>,
    after_target: Option<Box<dyn FnMut(u32)>>,
    before_remove: Option<Box<dyn FnMut(u32)>>,
    after_delete: Option<Box<dyn FnMut(u32)>>,
}

impl TestHooks {
    fn after_publication(callback: impl FnOnce() + 'static) -> Self {
        Self {
            after_publication: Some(Box::new(callback)),
            before_delete: None,
            after_target: None,
            before_remove: None,
            after_delete: None,
        }
    }

    fn after_delete(callback: impl FnMut(u32) + 'static) -> Self {
        Self {
            after_publication: None,
            before_delete: None,
            after_target: None,
            before_remove: None,
            after_delete: Some(Box::new(callback)),
        }
    }

    fn before_delete(callback: impl FnOnce() + 'static) -> Self {
        Self {
            after_publication: None,
            before_delete: Some(Box::new(callback)),
            after_target: None,
            before_remove: None,
            after_delete: None,
        }
    }

    fn before_remove(callback: impl FnMut(u32) + 'static) -> Self {
        Self {
            after_publication: None,
            before_delete: None,
            after_target: None,
            before_remove: Some(Box::new(callback)),
            after_delete: None,
        }
    }

    fn after_target(callback: impl FnMut(u32) + 'static) -> Self {
        Self {
            after_publication: None,
            before_delete: None,
            after_target: Some(Box::new(callback)),
            before_remove: None,
            after_delete: None,
        }
    }
}

impl MoveHooks for TestHooks {
    fn after_publication(&mut self) {
        if let Some(callback) = self.after_publication.take() {
            callback();
        }
    }

    fn before_delete(&mut self) {
        if let Some(callback) = self.before_delete.take() {
            callback();
        }
    }

    fn after_target_entry(&mut self, verified_entries: u32) {
        if let Some(callback) = self.after_target.as_mut() {
            callback(verified_entries);
        }
    }

    fn after_delete_entry(&mut self, removed_entries: u32) {
        if let Some(callback) = self.after_delete.as_mut() {
            callback(removed_entries);
        }
    }

    fn before_remove_entry(&mut self, next_removed_entries: u32) {
        if let Some(callback) = self.before_remove.as_mut() {
            callback(next_removed_entries);
        }
    }
}

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).unwrap()
}

fn assert_entry_absent(path: &Path) {
    assert_eq!(
        fs::symlink_metadata(path).unwrap_err().kind(),
        io::ErrorKind::NotFound
    );
}

#[derive(Clone, Copy)]
struct FileTimes {
    atime: i64,
    atime_nsec: i64,
    mtime: i64,
    mtime_nsec: i64,
}

impl FileTimes {
    fn capture(path: &Path) -> Self {
        use std::os::unix::fs::MetadataExt;

        let metadata = fs::metadata(path).unwrap();
        Self {
            atime: metadata.atime(),
            atime_nsec: metadata.atime_nsec(),
            mtime: metadata.mtime(),
            mtime_nsec: metadata.mtime_nsec(),
        }
    }

    fn restore(self, path: &Path) {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let native = CString::new(path.as_os_str().as_bytes()).unwrap();
        let times = [
            libc::timespec {
                tv_sec: self.atime,
                tv_nsec: self.atime_nsec,
            },
            libc::timespec {
                tv_sec: self.mtime,
                tv_nsec: self.mtime_nsec,
            },
        ];
        // SAFETY: `native` is a NUL-terminated path owned for the call and
        // `times` contains two initialized timestamps.
        assert_eq!(
            unsafe { libc::utimensat(libc::AT_FDCWD, native.as_ptr(), times.as_ptr(), 0) },
            0
        );
    }
}

fn create_fifo(path: &Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let native = CString::new(path.as_os_str().as_bytes()).unwrap();
    // SAFETY: `native` is a NUL-terminated path owned for the call.
    assert_eq!(unsafe { libc::mkfifo(native.as_ptr(), 0o600) }, 0);
}
