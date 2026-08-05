//! `diff::parse_name_status`/`diff::parse_numstat`/`diff::merge_diff_files`
//! and `diff::is_missing_blob_stderr` contract tests — every fixture spawns
//! a real `git` binary, mirroring `status::tests`'s own rationale for never
//! hand-typing wire bytes.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{
    diff_files, is_missing_blob_stderr, merge_diff_files, parse_name_status, parse_numstat,
    show_blob, DiffStatusKind, GitBlobRev,
};
use crate::git::network::GitNetworkService;
use crate::remote::session::RemoteSessionService;
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

fn raw_diff(dir: &Path, cached: bool, format_flag: &str) -> Vec<u8> {
    let mut args = vec![
        "diff",
        "--no-color",
        "-z",
        "-M",
        "--no-textconv",
        "--no-ext-diff",
    ];
    if cached {
        args.push("--cached");
    }
    args.push(format_flag);
    let output = Command::new("git")
        .current_dir(dir)
        .args(&args)
        .output()
        .expect("git diff fixture command spawns");
    assert!(
        output.status.success(),
        "git diff {args:?} must succeed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn name_status_reports_two_tokens_for_a_plain_modify_and_three_for_a_rename() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "line1\nline2\nline3\n").unwrap();
    std::fs::write(repo.path().join("b.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("b.txt"), "one\ntwo\n").unwrap();
    std::fs::rename(repo.path().join("a.txt"), repo.path().join("a-renamed.txt")).unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let raw = raw_diff(repo.path(), true, "--name-status");
    let entries = parse_name_status(&raw).expect("parses");
    assert_eq!(entries.len(), 2);

    let modified = entries
        .iter()
        .find(|entry| entry.kind == DiffStatusKind::Modified)
        .expect("modified entry present");
    assert_eq!(modified.path.to_wire_lossy(), "b.txt");
    assert_eq!(modified.orig_path, None);

    let renamed = entries
        .iter()
        .find(|entry| entry.kind == DiffStatusKind::Renamed)
        .expect("renamed entry present");
    assert_eq!(renamed.path.to_wire_lossy(), "a-renamed.txt");
    assert_eq!(
        renamed.orig_path.as_ref().map(|path| path.to_wire_lossy()),
        Some("a.txt".to_owned())
    );
    assert_eq!(renamed.similarity, Some(100));
}

#[test]
fn numstat_reports_tab_separated_counts_and_nul_separated_records() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "a\nb\nc\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "a\nb\nc\nd\ne\n").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let raw = raw_diff(repo.path(), true, "--numstat");
    assert!(
        raw.windows(1).any(|w| w == b"\t"),
        "numstat must contain TAB field separators"
    );
    let entries = parse_numstat(&raw).expect("parses");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].added, Some(2));
    assert_eq!(entries[0].deleted, Some(0));
    assert_eq!(entries[0].path.to_wire_lossy(), "a.txt");
}

#[test]
fn numstat_reports_binary_files_as_dash_dash_path() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("bin.dat"), b"\x00\x01one").unwrap();
    raw_git_ok(repo.path(), &["add", "bin.dat"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("bin.dat"), b"\x00\x01two-longer").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let entries = parse_numstat(&raw_diff(repo.path(), true, "--numstat")).expect("parses");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].added, None);
    assert_eq!(entries[0].deleted, None);
    assert_eq!(entries[0].path.to_wire_lossy(), "bin.dat");
}

/// The single most easily-missed rule in this whole file: a numstat rename
/// record has an **empty** path field followed by two more NUL records for
/// old/new path — a completely different shape from `--name-status`'s own
/// (always-non-empty) path field.
#[test]
fn numstat_rename_reports_an_empty_path_field_followed_by_two_nul_records() {
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

    let raw = raw_diff(repo.path(), true, "--numstat");
    assert!(
        raw.windows(b"\t\0a.txt\0a-renamed.txt\0".len())
            .any(|window| window == b"\t\0a.txt\0a-renamed.txt\0"),
        "raw numstat must contain an empty path field immediately before the NUL-separated old/new pair"
    );
    let entries = parse_numstat(&raw).expect("parses");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path.to_wire_lossy(), "a-renamed.txt");
    assert_eq!(entries[0].added, Some(1));
    assert_eq!(entries[0].deleted, Some(0));
}

#[test]
fn numstat_binary_rename_with_identical_content_reports_dash_dash_and_the_nul_pair() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("bin.dat"), b"\x00\x01AAAA").unwrap();
    raw_git_ok(repo.path(), &["add", "bin.dat"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::rename(
        repo.path().join("bin.dat"),
        repo.path().join("bin-renamed.dat"),
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let raw = raw_diff(repo.path(), true, "--numstat");
    let entries = parse_numstat(&raw).expect("parses");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].added, None);
    assert_eq!(entries[0].deleted, None);
    assert_eq!(entries[0].path.to_wire_lossy(), "bin-renamed.dat");

    let name_status =
        parse_name_status(&raw_diff(repo.path(), true, "--name-status")).expect("parses");
    assert_eq!(name_status.len(), 1);
    assert_eq!(name_status[0].kind, DiffStatusKind::Renamed);
    assert_eq!(name_status[0].similarity, Some(100));
}

#[test]
fn merge_diff_files_joins_name_status_and_numstat_by_path() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
    raw_git_ok(repo.path(), &["add", "-A"]);

    let name_status =
        parse_name_status(&raw_diff(repo.path(), true, "--name-status")).expect("parses");
    let numstat = parse_numstat(&raw_diff(repo.path(), true, "--numstat")).expect("parses");
    let merged = merge_diff_files(name_status, numstat);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].kind, DiffStatusKind::Modified);
    assert_eq!(merged[0].added, Some(2));
    assert_eq!(merged[0].deleted, Some(0));
    assert!(!merged[0].binary);
}

#[test]
fn cached_and_worktree_diffs_are_independent() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();

    let cached_entries =
        parse_name_status(&raw_diff(repo.path(), true, "--name-status")).expect("parses");
    let worktree_entries =
        parse_name_status(&raw_diff(repo.path(), false, "--name-status")).expect("parses");
    assert_eq!(cached_entries.len(), 1);
    assert_eq!(worktree_entries.len(), 1);
}

#[test]
fn malformed_name_status_and_numstat_are_rejected_not_panicked() {
    assert!(parse_name_status(b"Z\0path\0").is_err());
    assert!(parse_name_status(b"R100\0onlyone\0").is_err());
    assert!(parse_numstat(b"only-one-field\0").is_err());
    assert!(parse_numstat(b"1\t0\t\0onlyold\0").is_err());
}

// --- git show <rev>:<path> "not found" stderr classification -------------

#[test]
fn the_three_documented_missing_blob_messages_are_all_recognized() {
    assert!(is_missing_blob_stderr(
        "fatal: path 'x' does not exist in 'HEAD'\n"
    ));
    assert!(is_missing_blob_stderr(
        "fatal: path 'x' exists on disk, but not in 'HEAD'\n"
    ));
    assert!(is_missing_blob_stderr(
        "fatal: path 'x' does not exist (neither on disk nor in the index)\n"
    ));
}

#[test]
fn an_unrelated_stderr_message_is_not_classified_as_missing() {
    assert!(!is_missing_blob_stderr("fatal: not a git repository\n"));
    assert!(!is_missing_blob_stderr(
        "fatal: ambiguous argument ':./x': unknown revision or path not in the working tree.\n"
    ));
}

// --- end-to-end diff_files/show_blob (real trust + workspace wiring) -----

#[test]
fn the_end_to_end_diff_files_wrapper_reports_cached_and_worktree_changes_independently() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = init_repo();
    std::fs::write(root.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(root.path(), &["add", "a.txt"]);
    raw_git_ok(root.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(root.path().join("a.txt"), "one\ntwo\n").unwrap();
    raw_git_ok(root.path(), &["add", "a.txt"]);
    std::fs::write(root.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    let cached = block_on(diff_files(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        true,
    ))
    .expect("diff_files succeeds");
    let worktree = block_on(diff_files(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        false,
    ))
    .expect("diff_files succeeds");
    assert_eq!(cached.len(), 1);
    assert_eq!(cached[0].added, Some(1));
    assert_eq!(worktree.len(), 1);
    assert_eq!(worktree[0].added, Some(1));
}

#[test]
fn the_end_to_end_show_blob_wrapper_reads_head_and_index_versions() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = init_repo();
    std::fs::write(root.path().join("a.txt"), "head-content\n").unwrap();
    raw_git_ok(root.path(), &["add", "a.txt"]);
    raw_git_ok(root.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(root.path().join("a.txt"), "staged-content\n").unwrap();
    raw_git_ok(root.path(), &["add", "a.txt"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    let head = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Head,
        "a.txt",
    ))
    .expect("show_blob succeeds");
    assert_eq!(head, Some(b"head-content\n".to_vec()));

    let index = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Index,
        "a.txt",
    ))
    .expect("show_blob succeeds");
    assert_eq!(index, Some(b"staged-content\n".to_vec()));
}

#[test]
fn the_end_to_end_show_blob_wrapper_reports_none_for_all_three_documented_not_found_cases() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let root = init_repo();
    std::fs::write(root.path().join("tracked.txt"), "content\n").unwrap();
    raw_git_ok(root.path(), &["add", "tracked.txt"]);
    raw_git_ok(root.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(root.path().join("untracked-only.txt"), "x\n").unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", root.path(), trust_base.path());

    // (1) does not exist anywhere.
    let nowhere = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Head,
        "nope.txt",
    ))
    .expect("show_blob succeeds");
    assert_eq!(nowhere, None);

    // (2) exists on disk, but not in HEAD.
    let disk_only = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Head,
        "untracked-only.txt",
    ))
    .expect("show_blob succeeds");
    assert_eq!(disk_only, None);

    // (3) neither on disk nor in the index — `:0:./<path>` reliably hits
    // this third message rather than the bare `:<path>` shorthand's
    // "ambiguous argument" failure (see the module doc).
    let neither = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Index,
        "nope.txt",
    ))
    .expect("show_blob succeeds");
    assert_eq!(neither, None);
}

#[test]
fn the_end_to_end_show_blob_wrapper_rejects_an_untrusted_workspace() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(show_blob(
        &trust,
        &workspace,
        "main",
        GitBlobRev::Head,
        "a.txt",
    ))
    .expect_err("an untrusted workspace must be rejected before spawning");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
