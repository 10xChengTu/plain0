//! `status::parse_porcelain_v2` contract tests. Every fixture below spawns a
//! *real* `git` binary (never a hand-typed byte literal standing in for its
//! output) and feeds the actual captured stdout straight into the parser —
//! see the module doc's "S1 输出格式实测事实" cross-reference for why: this
//! format has enough sharp corners (NUL-vs-TAB separators, header lines that
//! vanish rather than go empty, literal `(initial)`/`(detached)` tokens)
//! that a hand-written fixture risks silently testing the test author's
//! mental model instead of git's actual behavior.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{git_status, parse_porcelain_v2, BranchHead, BranchOid, RenameOrCopyKind, StatusEntry};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn trusted_workspace(
    window_label: &str,
    root: &Path,
    trust_base: &Path,
) -> (WorkspaceService, TrustService) {
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.to_path_buf()],
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    (workspace, trust)
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git_ok(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_repo() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    raw_git_ok(dir.path(), &["init", "--quiet", "-b", "main"]);
    raw_git_ok(
        dir.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(dir.path(), &["config", "user.name", "Plain Test"]);
    dir
}

fn raw_status_bytes(dir: &Path) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(["status", "--porcelain=v2", "-z", "--branch", "--ignored"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git status fixture command spawns");
    assert!(
        output.status.success(),
        "git status must succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn a_brand_new_repository_with_no_commits_reports_initial_oid_and_no_upstream() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.branch.oid, BranchOid::Initial);
    assert_eq!(status.branch.head, BranchHead::Named("main".to_owned()));
    assert_eq!(status.branch.upstream, None);
    assert!(status.entries.is_empty());
}

#[test]
fn a_clean_committed_repository_reports_a_real_oid_and_no_entries() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "hello\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    match status.branch.oid {
        BranchOid::Commit(oid) => assert_eq!(oid.len(), 40),
        BranchOid::Initial => panic!("expected a real commit oid"),
    }
    assert!(status.entries.is_empty());
}

#[test]
fn an_ordinary_modified_file_reports_the_expected_status_mode_and_hash_fields() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\n").unwrap();

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => {
            assert_eq!(entry.index_status, '.');
            assert_eq!(entry.worktree_status, 'M');
            assert_eq!(entry.mode_head, "100644");
            assert_eq!(entry.mode_index, "100644");
            assert_eq!(entry.mode_worktree, "100644");
            assert_eq!(entry.hash_index.len(), 40);
            assert_eq!(entry.path.to_wire_lossy(), "a.txt");
            assert!(!entry.submodule.is_submodule);
        }
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn staged_delete_with_worktree_also_removed_reports_index_status_d() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    raw_git_ok(repo.path(), &["rm", "--quiet", "a.txt"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => {
            assert_eq!(entry.index_status, 'D');
            assert_eq!(entry.worktree_status, '.');
        }
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn unstaged_worktree_delete_reports_worktree_status_d() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::remove_file(repo.path().join("a.txt")).unwrap();

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => {
            assert_eq!(entry.index_status, '.');
            assert_eq!(entry.worktree_status, 'D');
        }
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn cached_delete_of_a_file_still_present_on_disk_reports_delete_plus_a_separate_untracked_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    raw_git_ok(repo.path(), &["rm", "--quiet", "--cached", "a.txt"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 2);
    let has_staged_delete = status.entries.iter().any(|entry| {
        matches!(entry, StatusEntry::Ordinary(ordinary) if ordinary.index_status == 'D' && ordinary.path.to_wire_lossy() == "a.txt")
    });
    let has_untracked = status.entries.iter().any(
        |entry| matches!(entry, StatusEntry::Untracked(path) if path.to_wire_lossy() == "a.txt"),
    );
    assert!(has_staged_delete, "expected a staged-delete ordinary entry");
    assert!(
        has_untracked,
        "expected the disk copy to reappear as untracked"
    );
}

#[test]
fn a_type_change_reports_status_t() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::remove_file(repo.path().join("a.txt")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("nowhere", repo.path().join("a.txt")).unwrap();
    #[cfg(not(unix))]
    std::fs::write(
        repo.path().join("a.txt"),
        "not really a type change on this platform",
    )
    .unwrap();

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    #[cfg(unix)]
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => assert_eq!(entry.worktree_status, 'T'),
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

/// The single easiest-to-get-wrong detail in this whole format: the rename
/// line's `path`/`origPath` separator under `-z` is `NUL`, not `TAB` — see
/// the module doc.
#[test]
fn a_rename_is_split_across_two_nul_records_not_a_tab() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::rename(repo.path().join("a.txt"), repo.path().join("a-renamed.txt")).unwrap();
    std::fs::write(
        repo.path().join("a-renamed.txt"),
        "line1\nline2\nline3\nline4\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let raw = raw_status_bytes(repo.path());
    // Sanity: the raw bytes really do contain a `NUL`-separated pair, not a
    // `TAB` between the two paths, before even reaching the parser.
    assert!(
        raw.windows(b"a-renamed.txt\0a.txt".len())
            .any(|window| window == b"a-renamed.txt\0a.txt"),
        "raw git output must NUL-separate path/origPath for a rename line"
    );
    assert!(!raw.windows(2).any(|window| window == b"t\t"));

    let status = parse_porcelain_v2(&raw).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::RenameOrCopy(entry) => {
            assert_eq!(entry.kind, RenameOrCopyKind::Rename);
            assert_eq!(entry.path.to_wire_lossy(), "a-renamed.txt");
            assert_eq!(entry.orig_path.to_wire_lossy(), "a.txt");
            assert!(entry.similarity <= 100);
        }
        other => panic!("expected RenameOrCopy, got {other:?}"),
    }
}

#[test]
fn a_copy_is_reported_when_status_renames_copies_is_configured_and_the_source_also_changed() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(repo.path(), &["config", "status.renames", "copies"]);
    std::fs::write(repo.path().join("src.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "src.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::copy(repo.path().join("src.txt"), repo.path().join("copy.txt")).unwrap();
    std::fs::write(repo.path().join("src.txt"), "line1\nline2\nline3\nline4\n").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    let copy_entry = status.entries.iter().find_map(|entry| match entry {
        StatusEntry::RenameOrCopy(entry) if entry.kind == RenameOrCopyKind::Copy => Some(entry),
        _ => None,
    });
    let copy_entry = copy_entry.expect("expected a Copy entry");
    assert_eq!(copy_entry.path.to_wire_lossy(), "copy.txt");
    assert_eq!(copy_entry.orig_path.to_wire_lossy(), "src.txt");
    let source_still_modified = status.entries.iter().any(|entry| {
        matches!(entry, StatusEntry::Ordinary(ordinary) if ordinary.path.to_wire_lossy() == "src.txt")
    });
    assert!(
        source_still_modified,
        "the copy source's own edit must still be reported"
    );
}

#[test]
fn a_merge_conflict_reports_an_unmerged_entry_with_three_stages() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "base"]);
    raw_git_ok(repo.path(), &["checkout", "-q", "-b", "branch-a"]);
    std::fs::write(repo.path().join("f.txt"), "aaa\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "a"]);
    raw_git_ok(repo.path(), &["checkout", "-q", "main"]);
    std::fs::write(repo.path().join("f.txt"), "bbb\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "b"]);
    // Merge is expected to conflict — ignore its own (non-zero) exit code.
    let _ = Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "branch-a", "-q"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .status();

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Unmerged(entry) => {
            assert_eq!(entry.index_status, 'U');
            assert_eq!(entry.worktree_status, 'U');
            assert_eq!(entry.hash_stage1.len(), 40);
            assert_eq!(entry.hash_stage2.len(), 40);
            assert_eq!(entry.hash_stage3.len(), 40);
            assert_eq!(entry.path.to_wire_lossy(), "f.txt");
        }
        other => panic!("expected Unmerged, got {other:?}"),
    }
}

#[test]
fn untracked_and_ignored_entries_are_both_reported_with_ignored_explicitly_requested() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join(".gitignore"), "*.ign\n").unwrap();
    raw_git_ok(repo.path(), &["add", ".gitignore"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "gitignore"]);
    std::fs::write(repo.path().join("new.txt"), "x").unwrap();
    std::fs::write(repo.path().join("skip.ign"), "x").unwrap();

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    let has_untracked = status.entries.iter().any(
        |entry| matches!(entry, StatusEntry::Untracked(path) if path.to_wire_lossy() == "new.txt"),
    );
    let has_ignored = status.entries.iter().any(
        |entry| matches!(entry, StatusEntry::Ignored(path) if path.to_wire_lossy() == "skip.ign"),
    );
    assert!(has_untracked);
    assert!(has_ignored);
}

#[test]
fn ignored_entries_are_omitted_without_the_ignored_flag() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join(".gitignore"), "*.ign\n").unwrap();
    raw_git_ok(repo.path(), &["add", ".gitignore"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "gitignore"]);
    std::fs::write(repo.path().join("skip.ign"), "x").unwrap();

    let output = Command::new("git")
        .current_dir(repo.path())
        .args(["status", "--porcelain=v2", "-z", "--branch"])
        .output()
        .expect("git status without --ignored spawns");
    let status = parse_porcelain_v2(&output.stdout).expect("parses");
    assert!(status.entries.is_empty());
}

#[test]
fn detached_head_reports_the_detached_variant() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    raw_git_ok(repo.path(), &["checkout", "-q", "--detach", "main"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.branch.head, BranchHead::Detached);
}

#[test]
fn an_upstream_with_ahead_and_behind_commits_reports_both_counts() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "base"],
    );
    raw_git_ok(repo.path(), &["checkout", "-q", "-b", "feature"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "feature-only"],
    );
    raw_git_ok(
        repo.path(),
        &["branch", "--set-upstream-to=main", "feature"],
    );

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    let upstream = status.branch.upstream.expect("upstream must be present");
    assert_eq!(upstream.name, "main");
    assert_eq!(upstream.ahead, 1);
    assert_eq!(upstream.behind, 0);
}

#[test]
fn submodule_states_cover_all_four_flag_combinations() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let inner = TempDir::new().expect("tempdir");
    raw_git_ok(inner.path(), &["init", "--quiet", "-b", "main"]);
    raw_git_ok(
        inner.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(inner.path(), &["config", "user.name", "Plain Test"]);
    std::fs::write(inner.path().join("f.txt"), "hi\n").unwrap();
    raw_git_ok(inner.path(), &["add", "f.txt"]);
    raw_git_ok(inner.path(), &["commit", "--quiet", "-m", "init"]);

    let outer = init_repo();
    let inner_url = format!("file://{}", inner.path().display());
    raw_git_ok(
        outer.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            &inner_url,
            "sub",
        ],
    );
    raw_git_ok(outer.path(), &["commit", "--quiet", "-m", "add submodule"]);

    // Clean: no entries at all.
    let clean = parse_porcelain_v2(&raw_status_bytes(outer.path())).expect("parses");
    assert!(clean.entries.is_empty());

    // Commit changed inside the submodule.
    let sub_dir = outer.path().join("sub");
    raw_git_ok(
        &sub_dir,
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(&sub_dir, &["config", "user.name", "Plain Test"]);
    std::fs::write(sub_dir.join("f.txt"), "hi\nmore\n").unwrap();
    raw_git_ok(&sub_dir, &["commit", "--quiet", "-am", "more"]);
    let commit_changed = parse_porcelain_v2(&raw_status_bytes(outer.path())).expect("parses");
    assert_eq!(commit_changed.entries.len(), 1);
    match &commit_changed.entries[0] {
        StatusEntry::Ordinary(entry) => {
            assert!(entry.submodule.is_submodule);
            assert!(entry.submodule.commit_changed);
            assert!(!entry.submodule.untracked_changed);
        }
        other => panic!("expected Ordinary, got {other:?}"),
    }

    // Untracked file inside the submodule, on top of the commit change.
    std::fs::write(sub_dir.join("untracked-in-sub.txt"), "x").unwrap();
    let untracked_inside = parse_porcelain_v2(&raw_status_bytes(outer.path())).expect("parses");
    assert_eq!(untracked_inside.entries.len(), 1);
    match &untracked_inside.entries[0] {
        StatusEntry::Ordinary(entry) => {
            assert!(entry.submodule.is_submodule);
            assert!(entry.submodule.commit_changed);
            assert!(entry.submodule.untracked_changed);
        }
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn paths_with_spaces_lf_and_non_ascii_bytes_round_trip_through_the_parser() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file with spaces.txt"), "x").unwrap();
    let lf_name = "file\nwith\nlf.txt";
    std::fs::write(repo.path().join(lf_name), "x").unwrap();
    std::fs::write(repo.path().join("文件.txt"), "x").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    let paths: Vec<String> = status
        .entries
        .iter()
        .map(|entry| match entry {
            StatusEntry::Ordinary(entry) => entry.path.to_wire_lossy(),
            other => panic!("expected Ordinary, got {other:?}"),
        })
        .collect();
    assert!(paths.contains(&"file with spaces.txt".to_owned()));
    assert!(paths.contains(&lf_name.to_owned()));
    assert!(paths.contains(&"文件.txt".to_owned()));
}

#[test]
fn a_dash_prefixed_path_is_preserved_verbatim() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("-dashfile.txt"), "x").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let status = parse_porcelain_v2(&raw_status_bytes(repo.path())).expect("parses");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => assert_eq!(entry.path.to_wire_lossy(), "-dashfile.txt"),
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn malformed_output_is_rejected_not_panicked() {
    assert!(parse_porcelain_v2(b"not a real record\0").is_err());
    assert!(parse_porcelain_v2(b"# branch.ab +1\0").is_err());
    assert!(parse_porcelain_v2(b"1 M\0").is_err());
    // A rename header with no following origPath record.
    assert!(parse_porcelain_v2(
        b"# branch.oid abc\0# branch.head main\x002 R. N... 100644 100644 100644 aaa bbb R100 a\0"
    )
    .is_err());
}

#[test]
fn missing_oid_or_head_header_is_rejected() {
    assert!(parse_porcelain_v2(b"").is_err());
    assert!(parse_porcelain_v2(b"# branch.head main\0").is_err());
}

#[test]
fn the_end_to_end_git_status_wrapper_resolves_the_repo_and_parses_a_real_invocation() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = init_repo();
    std::fs::write(root.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(root.path(), &["add", "a.txt"]);
    raw_git_ok(root.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(root.path().join("a.txt"), "one\ntwo\n").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    let status = block_on(git_status(&trust, &workspace, "main")).expect("git_status succeeds");
    assert_eq!(status.entries.len(), 1);
    match &status.entries[0] {
        StatusEntry::Ordinary(entry) => assert_eq!(entry.path.to_wire_lossy(), "a.txt"),
        other => panic!("expected Ordinary, got {other:?}"),
    }
}

#[test]
fn the_end_to_end_git_status_wrapper_rejects_an_untrusted_workspace() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(git_status(&trust, &workspace, "main"))
        .expect_err("an untrusted workspace must be rejected before spawning");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
