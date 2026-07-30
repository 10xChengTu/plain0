//! `log::file_history`/`log::line_history_list`/`log::line_history_detail`/
//! `log::parse_history_entries` contract tests — every fixture spawns a
//! *real* `git` binary, mirroring `blame::tests`'s own rationale for never
//! hand-typing wire bytes for an end-to-end assertion. Several tests below
//! are *control-group* fixtures: they run the same real repository through
//! both a raw/unhardened or differently-shaped invocation and this domain's
//! actual production path, and assert the two genuinely differ — proving a
//! design decision changes real behavior, not just that the chosen path
//! happens to pass.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{
    file_history, line_history_detail, line_history_list, log_graph, parse_graph_entries,
    parse_history_entries, LineRange,
};
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

/// Same shape as `raw_git_ok` but returns the completed process instead of
/// asserting success — used by control groups that expect a *failing*
/// invocation.
fn raw_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns")
}

fn head_sha(dir: &Path) -> String {
    String::from_utf8(raw_git(dir, &["rev-parse", "HEAD"]).stdout)
        .unwrap()
        .trim()
        .to_owned()
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

fn range(start: u32, end: u32) -> LineRange {
    LineRange { start, end }
}

// --- file_history: basics ----------------------------------------------

#[test]
fn file_history_lists_commits_touching_the_whole_file_newest_first() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\nb\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "first"]);
    let first_sha = head_sha(repo.path());
    std::fs::write(repo.path().join("f.txt"), "a\nb changed\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "second"]);
    let second_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(file_history(&trust, &workspace, "main", "f.txt")).expect("file_history succeeds");

    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].sha, second_sha, "newest first");
    assert_eq!(result.entries[0].message, "second\n");
    assert_eq!(result.entries[1].sha, first_sha);
    assert_eq!(result.entries[1].message, "first\n");
    assert!(!result.truncated);
}

#[test]
fn file_history_of_an_untracked_or_never_existed_path_is_an_empty_non_error_result() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("tracked.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    std::fs::write(repo.path().join("untracked.txt"), "y\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    // Confirmed empirically (this slice's own report): `git log --follow --
    // <path>` for a path with zero history exits 0 with empty output, not an
    // error — this is not a special case this domain's own code adds, it is
    // git's own real behavior, reproduced here end to end.
    let untracked = block_on(file_history(&trust, &workspace, "main", "untracked.txt"))
        .expect("file_history succeeds for an untracked path");
    assert_eq!(untracked.entries.len(), 0);
    assert!(!untracked.truncated);

    let never_existed = block_on(file_history(
        &trust,
        &workspace,
        "main",
        "never-existed.txt",
    ))
    .expect("file_history succeeds for a path that never existed");
    assert_eq!(never_existed.entries.len(), 0);
}

#[test]
fn file_history_works_for_a_file_only_touched_by_the_initial_root_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("root.txt"), "only ever this\n").unwrap();
    raw_git_ok(repo.path(), &["add", "root.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root commit"]);
    let sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(file_history(&trust, &workspace, "main", "root.txt"))
        .expect("file_history succeeds");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].sha, sha);
}

// --- file_history: `--follow` rename fixture (heuristic, not guaranteed) --

#[test]
fn file_history_follow_crosses_a_single_rename_while_the_unfollowed_call_stops_at_it() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("old.txt"), "line1\nline2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "old.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create old.txt"]);
    let create_sha = head_sha(repo.path());

    std::fs::write(repo.path().join("old.txt"), "line1\nline2 edited\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "edit old.txt"]);
    let edit_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["mv", "old.txt", "new.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "rename to new.txt"],
    );
    let rename_sha = head_sha(repo.path());

    std::fs::write(
        repo.path().join("new.txt"),
        "line1\nline2 edited\nline3 after rename\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "edit new.txt"]);
    let post_rename_edit_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let followed = block_on(file_history(&trust, &workspace, "main", "new.txt"))
        .expect("file_history succeeds");
    let followed_shas: Vec<&str> = followed
        .entries
        .iter()
        .map(|entry| entry.sha.as_str())
        .collect();
    assert_eq!(
        followed_shas,
        vec![
            post_rename_edit_sha.as_str(),
            rename_sha.as_str(),
            edit_sha.as_str(),
            create_sha.as_str(),
        ],
        "--follow crosses the rename and finds all 4 commits"
    );

    // Control group: the exact same repository, queried WITHOUT --follow (a
    // raw invocation of this module's own GIT_LOG_COMMIT_META_ARGS minus
    // --follow), stops at the rename commit itself — proving --follow is a
    // real, load-bearing heuristic and not a no-op this production code path
    // happens to always get for free.
    let unfollowed = raw_git(
        repo.path(),
        &[
            "log",
            "-z",
            "--format=%H%x1f%B",
            "--no-patch",
            "--",
            "new.txt",
        ],
    );
    assert!(unfollowed.status.success());
    let unfollowed_records: Vec<&[u8]> = unfollowed
        .stdout
        .split(|&byte| byte == 0)
        .filter(|record| !record.is_empty())
        .collect();
    assert_eq!(
        unfollowed_records.len(),
        2,
        "without --follow, only the rename commit and the post-rename edit are visible"
    );
}

// --- line_history_list: basics + rename-by-default ------------------------

#[test]
fn line_history_list_returns_only_commits_that_touched_the_requested_line() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\nb\nc\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create"]);
    let create_sha = head_sha(repo.path());

    // Touches line 3 (`c`), not line 2 — must not appear in line 2's history.
    std::fs::write(repo.path().join("f.txt"), "a\nb\nc changed\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "touch line 3"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].sha, create_sha);
}

#[test]
fn line_history_list_crosses_a_rename_by_default_without_needing_follow() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("old.txt"), "l1\nl2\nl3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "old.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create"]);
    let create_sha = head_sha(repo.path());

    std::fs::write(repo.path().join("old.txt"), "l1\nl2 changed\nl3\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "change line2"]);
    let change_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["mv", "old.txt", "new.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "rename"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "new.txt",
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    // Confirmed empirically (this slice's own report): `-L` already follows
    // the rename for its own tracked line without any `--follow` flag at
    // all (this domain's `line_history_list` never passes `--follow` —
    // see this module's own doc comment for why the two are in fact mutually
    // exclusive at the git CLI level). Two entries, not one: `-L`'s own
    // semantics report the *full* provenance of the tracked line — both the
    // commit that last changed it (`change_sha`) and the earlier commit that
    // introduced it (`create_sha`, from before the rename) — not merely the
    // most recent touch; the rename commit itself never appears (a pure
    // rename with no content change to this line is invisible to `-L`).
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].sha, change_sha, "newest first");
    assert_eq!(result.entries[1].sha, create_sha, "crosses the rename");
}

#[test]
fn line_history_list_rejects_a_nonexistent_path_as_a_structured_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "does-not-exist.txt",
        range(1, 1),
    ))
    .expect_err("nonexistent path is rejected");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_PATH_NOT_FOUND");
}

#[test]
fn line_history_list_range_beyond_the_files_line_count_is_a_structured_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\nb\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(100, 100),
    ))
    .expect_err("out-of-bounds range is rejected");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_RANGE_OUT_OF_BOUNDS");
}

#[test]
fn line_history_list_rejects_an_invalid_range_before_ever_invoking_git() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    // No repository/trust set up at all — if this reached git, it would fail
    // with a *different* error (trust/repository), so seeing the range error
    // here proves validation runs first, exactly like
    // `blame_invalid_range_is_rejected_as_a_structured_error_before_conflicting_with_git`.
    let error = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(5, 1),
    ))
    .expect_err("start > end is rejected");
    assert_eq!(error.code(), "GIT_LOG_INVALID_RANGE");

    let error = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(0, 1),
    ))
    .expect_err("start == 0 is rejected");
    assert_eq!(error.code(), "GIT_LOG_INVALID_RANGE");
}

#[test]
fn file_history_and_line_history_list_reject_an_invalid_path_without_needing_a_repository() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(file_history(&trust, &workspace, "main", "../escape.txt"))
        .expect_err("path traversal is rejected");
    assert_eq!(error.code(), "GIT_LOG_INVALID_PATH");

    let error = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "/absolute.txt",
        range(1, 1),
    ))
    .expect_err("absolute path is rejected");
    assert_eq!(error.code(), "GIT_LOG_INVALID_PATH");
}

#[test]
fn file_history_rejects_an_untrusted_workspace() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    // Deliberately never granted.

    let error = block_on(file_history(&trust, &workspace, "main", "f.txt"))
        .expect_err("untrusted workspace is rejected");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- tricky filenames: quotes/spaces/non-ASCII/literal LF -----------------

#[test]
fn file_history_and_line_history_list_find_the_right_commits_for_a_filename_with_quotes_spaces_and_non_ascii(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let name = "a \"quoted\" 文件.txt";
    std::fs::write(repo.path().join(name), "x\ny\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", name]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create tricky"]);
    let create_sha = head_sha(repo.path());
    std::fs::write(repo.path().join(name), "x\ny changed\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "edit tricky"]);
    let edit_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let file_result =
        block_on(file_history(&trust, &workspace, "main", name)).expect("file_history succeeds");
    assert_eq!(file_result.entries.len(), 2);
    assert_eq!(file_result.entries[0].sha, edit_sha);
    assert_eq!(file_result.entries[1].sha, create_sha);

    let line_result = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        name,
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    assert_eq!(line_result.entries.len(), 2);
}

#[test]
fn file_history_and_line_history_list_find_the_right_commits_for_a_filename_with_a_literal_line_feed(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    // A literal LF byte in a filename is legal on this filesystem (confirmed
    // empirically by `F090` S0 against the earlier, incorrect assumption
    // that it was not constructible — see `blame.rs`'s own module doc
    // comment's disclosed correction) — `std::fs::write`/`Command::arg` need
    // no raw-byte `OsStr` trick to create or pass it.
    let name = "weird\nname.txt";
    std::fs::write(repo.path().join(name), "one\ntwo\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", name]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create lf-named"]);
    let create_sha = head_sha(repo.path());
    std::fs::write(repo.path().join(name), "one\ntwo changed\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "edit lf-named"]);
    let edit_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let file_result =
        block_on(file_history(&trust, &workspace, "main", name)).expect("file_history succeeds");
    assert_eq!(file_result.entries.len(), 2);
    assert_eq!(file_result.entries[0].sha, edit_sha);
    assert_eq!(file_result.entries[1].sha, create_sha);

    let line_result = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        name,
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    assert_eq!(line_result.entries.len(), 2);
}

// --- hostile fixture: format-string safety ---------------------------------

#[test]
fn file_history_is_immune_to_a_hostile_commit_message_containing_a_unit_separator_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    let hostile_message = format!(
        "Hostile subject with an embedded {} unit-separator byte, then more text.\nSecond body line.",
        '\u{1f}'
    );
    let commit = Command::new("git")
        .current_dir(repo.path())
        .args(["commit", "--quiet", "-F", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(hostile_message.as_bytes())?;
            child.wait_with_output()
        })
        .expect("git commit with hostile message spawns");
    assert!(
        commit.status.success(),
        "hostile commit message failed: {}",
        String::from_utf8_lossy(&commit.stderr)
    );
    let sha = head_sha(repo.path());

    // Confirm the hostile byte really did land in the commit body on a real
    // commit (the premise of this test, not merely assumed) — mirrors
    // `blame::tests`'s identical "confirm the premise against real git before
    // trusting the parser's own result" discipline.
    let raw_check = Command::new("git")
        .current_dir(repo.path())
        .args(["log", "-1", "--format=%B"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&raw_check.stdout).trim_end_matches('\n'),
        hostile_message
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(file_history(&trust, &workspace, "main", "f.txt"))
        .expect("file_history succeeds despite the hostile message");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].sha, sha);
    assert_eq!(
        result.entries[0].message,
        format!("{hostile_message}\n"),
        "the full message body must be recovered verbatim, embedded separator included"
    );
}

/// Pure-function control group: demonstrates that a *naive* "split every
/// occurrence of the delimiter" parser really would be corrupted by a
/// message containing an embedded `0x1f` byte, while the real
/// [`parse_history_entries`] (which only splits on the *first* occurrence)
/// is not — the same technique `blame::tests`'s
/// `parse_commit_messages_splitn_is_not_confused_by_an_embedded_separator_in_the_body_while_a_naive_full_split_would_be`
/// establishes, independently re-verified against this module's own parser
/// rather than assumed to transfer just because the format string is the
/// same text.
#[test]
fn parse_history_entries_splitn_is_not_confused_by_an_embedded_separator_in_the_body_while_a_naive_full_split_would_be(
) {
    let sha = "a".repeat(40);
    let message_with_embedded_separator = format!("subject with a {} char\nbody line", '\u{1f}');
    let mut record = sha.clone().into_bytes();
    record.push(0x1f);
    record.extend_from_slice(message_with_embedded_separator.as_bytes());
    let mut output = record.clone();
    output.push(0);

    let result = parse_history_entries(&output).expect("parses");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].sha, sha);
    assert_eq!(result.entries[0].message, message_with_embedded_separator);

    // Control: a naive parser that splits on *every* 0x1f occurrence would
    // instead see three fields, not two — demonstrating the vulnerability
    // this test's sibling integration test proves is reachable via entirely
    // normal git usage (a hostile commit message), not just a synthetic byte
    // string.
    let naive_fields: Vec<&[u8]> = record.split(|&byte| byte == 0x1f).collect();
    assert_eq!(
        naive_fields.len(),
        3,
        "the naive full-split approach really would misparse this record into extra fields"
    );
}

#[test]
fn parse_history_entries_caps_at_the_defensive_ceiling_and_reports_truncated() {
    // Hand-constructed (not spawned through real git — this exercises only
    // this module's own pure truncation logic, which a 501-real-commit
    // fixture would exercise identically but far more slowly): 501 distinct,
    // well-formed records.
    let mut output = Vec::new();
    for index in 0..501u32 {
        let sha = format!("{index:040x}");
        output.extend_from_slice(sha.as_bytes());
        output.push(0x1f);
        output.extend_from_slice(format!("message {index}\n").as_bytes());
        output.push(0);
    }
    let result = parse_history_entries(&output).expect("parses");
    assert_eq!(result.entries.len(), 500);
    assert!(result.truncated);
}

#[test]
fn parse_history_entries_of_empty_output_is_zero_entries_not_truncated() {
    let result = parse_history_entries(b"").expect("parses");
    assert_eq!(result.entries.len(), 0);
    assert!(!result.truncated);
}

#[test]
fn parse_history_entries_rejects_a_record_with_no_separator_at_all() {
    let error = parse_history_entries(b"not-a-real-record\0").expect_err("must fail");
    assert_eq!(error.code(), "GIT_LOG_PARSE_FAILED");
}

#[test]
fn parse_history_entries_rejects_a_sha_that_is_not_lowercase_hex40() {
    let mut output = b"NOT-LOWERCASE-HEX-AND-WRONG-LENGTH".to_vec();
    output.push(0x1f);
    output.extend_from_slice(b"message\n");
    output.push(0);
    let error = parse_history_entries(&output).expect_err("must fail");
    assert_eq!(error.code(), "GIT_LOG_PARSE_FAILED");
}

// --- line_history_detail: the skip/max-count drill-down -------------------

/// Builds a small history: a file created, then a line edited (touching line
/// 2), then renamed. Returns `(repo, trust_base, workspace, trust, edit_sha)`
/// — both `TempDir`s must stay alive for as long as `workspace`/`trust` are
/// used (their backing directories must not be deleted mid-test).
fn rename_line_history_fixture() -> (TempDir, TempDir, WorkspaceService, TrustService, String) {
    let repo = init_repo();
    std::fs::write(repo.path().join("old.txt"), "l1\nl2\nl3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "old.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "create"]);

    std::fs::write(repo.path().join("old.txt"), "l1\nl2 changed\nl3\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "change line2"]);
    let edit_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["mv", "old.txt", "new.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "rename"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    (repo, trust_base, workspace, trust, edit_sha)
}

#[test]
fn line_history_detail_drills_into_the_correct_pre_rename_commit_via_skip_and_max_count() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, _trust_base, workspace, trust, edit_sha) = rename_line_history_fixture();

    // Confirm the premise: the plain, unrestricted list has the pre-rename
    // edit commit at position 0 (newest) — see this module's own sibling
    // test for why there are two entries total (the edit, then the earlier
    // creation), not one.
    let list = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "new.txt",
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    assert_eq!(list.entries.len(), 2);
    assert_eq!(list.entries[0].sha, edit_sha);

    let detail = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "new.txt",
        range(2, 2),
        0,
        &edit_sha,
    ))
    .expect("line_history_detail succeeds across the rename");
    assert_eq!(detail.sha, edit_sha);
    assert!(detail
        .diff_text
        .starts_with(&format!("commit {edit_sha}\n")));
    assert!(detail.diff_text.contains("l2 changed"));
    let _ = repo; // keep the TempDir alive for the duration of this test
}

#[test]
fn line_history_detail_of_a_pre_rename_commit_using_the_frozen_plans_bare_sha_form_fails() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, _trust_base, _workspace, _trust, edit_sha) = rename_line_history_fixture();

    // Documents the empirically-discovered deviation from the frozen plan's
    // original drill-down sketch (`["log", "-1", "-L<range>:<path>",
    // <sha>]`) — a permanent regression/documentation test, not merely a
    // one-off investigation, so a future change cannot silently "fix" this
    // module back onto the broken shape without a test noticing the
    // *control* itself started passing (which would mean git's own behavior
    // changed, worth knowing about on its own).
    let bare_sha_form = raw_git(repo.path(), &["log", "-1", "-L2,2:new.txt", &edit_sha]);
    assert!(
        !bare_sha_form.status.success(),
        "the frozen plan's bare <sha> form must fail for a pre-rename commit"
    );
    assert!(String::from_utf8_lossy(&bare_sha_form.stderr).contains("There is no path"));
}

#[test]
fn line_history_detail_rejects_a_position_beyond_the_available_history() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\nb\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "only commit"]);
    let sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    // Position 0 is the only real entry.
    let detail = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(2, 2),
        0,
        &sha,
    ))
    .expect("position 0 succeeds");
    assert_eq!(detail.sha, sha);

    // Position 1 (and beyond) does not exist — confirmed empirically that
    // git itself exits 0 with empty output for `--skip` beyond the number of
    // matching commits, so this module must turn that into a distinguishable
    // structured error rather than a confusing empty success or a generic
    // parse failure.
    let error = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(2, 2),
        1,
        &sha,
    ))
    .expect_err("position 1 does not exist");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_DETAIL_NOT_FOUND");
}

#[test]
fn line_history_detail_rejects_a_stale_index_when_the_underlying_history_shifted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "a\nb\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "first touch"]);
    let first_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    // Caller fetches the list: position 0 is `first_sha`.
    let list = block_on(line_history_list(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(2, 2),
    ))
    .expect("line_history_list succeeds");
    assert_eq!(list.entries.len(), 1);
    assert_eq!(list.entries[0].sha, first_sha);

    // Between the list fetch and the click, a *new* commit lands on the same
    // line — position 0 now refers to a different commit than the caller's
    // stale list said it would.
    std::fs::write(repo.path().join("f.txt"), "a\nb changed again\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "second touch"]);

    let error = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(2, 2),
        0,
        &first_sha,
    ))
    .expect_err("stale index must be rejected, not silently shown as the wrong commit");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_DETAIL_STALE_INDEX");
}

#[test]
fn line_history_detail_rejects_a_malformed_expected_sha_before_ever_invoking_git() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(1, 1),
        0,
        "not-a-real-sha",
    ))
    .expect_err("malformed sha is rejected");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_DETAIL_INVALID_REQUEST");

    let uppercase = "A".repeat(40);
    let error = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(1, 1),
        0,
        &uppercase,
    ))
    .expect_err("uppercase hex is rejected (not a real git sha encoding)");
    assert_eq!(error.code(), "GIT_LINE_HISTORY_DETAIL_INVALID_REQUEST");
}

#[test]
fn line_history_detail_rejects_an_invalid_range_before_ever_invoking_git() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let sha = "a".repeat(40);

    let error = block_on(line_history_detail(
        &trust,
        &workspace,
        "main",
        "f.txt",
        range(5, 1),
        0,
        &sha,
    ))
    .expect_err("start > end is rejected");
    assert_eq!(error.code(), "GIT_LOG_INVALID_RANGE");
}

// --- F090 S3: log_graph -----------------------------------------------------
//
// Every fixture below spawns a *real* `git` binary (mirroring this file's own
// header rationale); several are control-group fixtures proving a specific
// design decision (topo-order, the `--branches --tags --remotes` scope, the
// single-absorbing-subject-field format string) genuinely changes behavior
// relative to a naive/differently-shaped alternative, not merely that the
// chosen shape happens to pass.

#[test]
fn log_graph_topo_orders_a_multi_branch_merge_dag_including_an_octopus_merge() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "a1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let root_sha = head_sha(repo.path());

    std::fs::write(repo.path().join("a.txt"), "a1\na2\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "mainchange"]);
    let main_tip_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["checkout", "--quiet", "-b", "bA", &root_sha]);
    std::fs::write(repo.path().join("b.txt"), "b\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "ba"]);
    let a_tip_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["checkout", "--quiet", "-b", "bB", &root_sha]);
    std::fs::write(repo.path().join("c.txt"), "c\n").unwrap();
    raw_git_ok(repo.path(), &["add", "c.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "bb"]);
    let b_tip_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["checkout", "--quiet", "-b", "bC", &root_sha]);
    std::fs::write(repo.path().join("d.txt"), "d\n").unwrap();
    raw_git_ok(repo.path(), &["add", "d.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "bc"]);
    let c_tip_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["checkout", "--quiet", "main"]);
    raw_git_ok(
        repo.path(),
        &["merge", "--quiet", "--no-edit", "bA", "bB", "bC"],
    );
    let merge_sha = head_sha(repo.path());
    assert_ne!(
        merge_sha, main_tip_sha,
        "the octopus merge must actually create a new commit"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 100)).expect("log_graph succeeds");

    assert_eq!(
        result.nodes.len(),
        6,
        "root + mainchange + 3 branch tips + the octopus merge itself"
    );
    assert!(!result.truncated);

    // `--topo-order`'s own guarantee: a commit is never shown until all of
    // its children have been shown. The merge commit has no children at all
    // (it is the tip), so it must be the very first record; the root commit
    // is every other commit's ancestor, so it must be the very last.
    assert_eq!(
        result.nodes[0].sha, merge_sha,
        "the octopus merge has no children, so topo-order emits it first"
    );
    assert_eq!(
        result.nodes[0].parents,
        vec![
            main_tip_sha.clone(),
            a_tip_sha.clone(),
            b_tip_sha.clone(),
            c_tip_sha.clone(),
        ],
        "parent order must be first-parent (the previous HEAD) then the merge \
         command's own branch argument order — confirmed against real git output"
    );
    assert_eq!(
        result.nodes.last().unwrap().sha,
        root_sha,
        "the root commit is every other commit's ancestor, so topo-order emits it last"
    );
    assert_eq!(
        result.nodes.last().unwrap().parents,
        Vec::<String>::new(),
        "a root commit has zero parents"
    );

    let ordinary_parent_counts: Vec<usize> = result
        .nodes
        .iter()
        .filter(|node| node.sha != merge_sha && node.sha != root_sha)
        .map(|node| node.parents.len())
        .collect();
    assert!(
        ordinary_parent_counts.iter().all(|&count| count == 1),
        "every non-merge, non-root commit has exactly one parent"
    );

    let shas: std::collections::HashSet<&str> =
        result.nodes.iter().map(|node| node.sha.as_str()).collect();
    for expected in [
        &merge_sha,
        &main_tip_sha,
        &a_tip_sha,
        &b_tip_sha,
        &c_tip_sha,
        &root_sha,
    ] {
        assert!(shas.contains(expected.as_str()), "missing {expected}");
    }
}

#[test]
fn log_graph_excludes_a_commit_reachable_only_from_a_detached_head() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "on-branch"]);
    let branch_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["checkout", "--quiet", &branch_sha]);
    std::fs::write(repo.path().join("f.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "detached-only"]);
    let detached_sha = head_sha(repo.path());
    assert_ne!(detached_sha, branch_sha);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 100)).expect("log_graph succeeds");

    let shas: Vec<&str> = result.nodes.iter().map(|node| node.sha.as_str()).collect();
    assert!(
        shas.contains(&branch_sha.as_str()),
        "the commit still reachable from a real branch must appear"
    );
    assert!(
        !shas.contains(&detached_sha.as_str()),
        "a commit reachable only from a detached HEAD (no branch/tag/remote-tracking \
         ref points at it) is invisible to `--branches --tags --remotes`, by design — \
         see this module's own doc comment's ref-namespace-scope section"
    );
}

#[test]
fn log_graph_is_unaffected_by_a_real_non_ascii_branch_name_existing_in_the_repository() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let root_sha = head_sha(repo.path());

    // A real, deliberately weird-bytes branch name — this command never
    // decodes ref names at all (see this module's own doc comment's
    // "deliberately never asks git for ref/branch/tag decoration" section),
    // so this only confirms the scan itself does not choke on its existence.
    raw_git_ok(repo.path(), &["branch", "分支-emoji-🎉"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 100))
        .expect("log_graph tolerates a real non-ASCII branch name existing in the repository");
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].sha, root_sha);
}

#[test]
fn log_graph_is_immune_to_a_hostile_subject_line_containing_a_unit_separator_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    let hostile_subject = format!(
        "Hostile subject with an embedded {} unit-separator byte, then more subject text.",
        '\u{1f}'
    );
    let commit = Command::new("git")
        .current_dir(repo.path())
        .args(["commit", "--quiet", "-F", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(hostile_subject.as_bytes())?;
            child.wait_with_output()
        })
        .expect("git commit with hostile subject spawns");
    assert!(
        commit.status.success(),
        "hostile commit failed: {}",
        String::from_utf8_lossy(&commit.stderr)
    );
    let sha = head_sha(repo.path());

    // Confirm the premise against real git before trusting the parser's own
    // result — mirrors `file_history_is_immune_to_a_hostile_commit_message...`
    // 's identical discipline: for a genuinely single-line message, `%s`
    // returns the hostile byte verbatim.
    let raw_check = Command::new("git")
        .current_dir(repo.path())
        .args(["log", "-1", "--format=%s"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&raw_check.stdout).trim_end_matches('\n'),
        hostile_subject
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 10))
        .expect("log_graph succeeds despite the hostile subject");
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].sha, sha);
    assert_eq!(
        result.nodes[0].subject, hostile_subject,
        "the full subject must be recovered verbatim, embedded separator included"
    );
}

/// Pure-function control group: demonstrates that a *naive* "split every
/// occurrence of the delimiter" parser really would be corrupted by a
/// subject containing an embedded `0x1f` byte, while the real
/// [`parse_graph_entries`] (which only splits on the *first two*
/// occurrences) is not — the same technique
/// `parse_history_entries_splitn_is_not_confused_by_an_embedded_separator...`
/// establishes above, independently re-verified against this module's own
/// three-field graph parser rather than assumed to transfer.
#[test]
fn parse_graph_entries_splitn_is_not_confused_by_an_embedded_separator_in_the_subject_while_a_naive_full_split_would_be(
) {
    let sha = "a".repeat(40);
    let parent1 = "b".repeat(40);
    let parent2 = "c".repeat(40);
    let subject_with_embedded_separator = format!("subject with a {} char in it", '\u{1f}');
    let mut record = sha.clone().into_bytes();
    record.push(0x1f);
    record.extend_from_slice(parent1.as_bytes());
    record.push(b' ');
    record.extend_from_slice(parent2.as_bytes());
    record.push(0x1f);
    record.extend_from_slice(subject_with_embedded_separator.as_bytes());
    let mut output = record.clone();
    output.push(0);

    let result = parse_graph_entries(&output, 500).expect("parses");
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].sha, sha);
    assert_eq!(result.nodes[0].parents, vec![parent1, parent2]);
    assert_eq!(result.nodes[0].subject, subject_with_embedded_separator);

    // Control: a naive parser that splits on *every* 0x1f occurrence would
    // instead see 4 fields (3 delimiters: the two structural ones plus the
    // one embedded in the subject), not 3 — demonstrating the vulnerability
    // this test's sibling integration test proves is reachable via entirely
    // normal git usage (a hostile commit subject), not just a synthetic byte
    // string.
    let naive_fields: Vec<&[u8]> = record.split(|&byte| byte == 0x1f).collect();
    assert_eq!(
        naive_fields.len(),
        4,
        "the naive full-split approach really would misparse this record into an extra field"
    );
}

#[test]
fn log_graph_excludes_a_real_stash_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    std::fs::write(repo.path().join("f.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "wip"]);
    let stash_sha = String::from_utf8(raw_git(repo.path(), &["rev-parse", "refs/stash"]).stdout)
        .unwrap()
        .trim()
        .to_owned();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 100)).expect("log_graph succeeds");
    let shas: Vec<&str> = result.nodes.iter().map(|node| node.sha.as_str()).collect();
    assert!(
        !shas.contains(&stash_sha.as_str()),
        "a real `git stash push`'s own commit must never appear in \
         `--branches --tags --remotes` output"
    );
}

#[test]
fn log_graph_of_a_repository_with_zero_commits_is_an_empty_non_error_result() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 100))
        .expect("log_graph succeeds on a repository with zero commits");
    assert!(result.nodes.is_empty());
    assert!(!result.truncated);
}

#[test]
fn log_graph_caps_at_the_callers_max_count_and_reports_truncated() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let mut shas = Vec::new();
    for message in ["one", "two", "three"] {
        std::fs::write(repo.path().join("f.txt"), message).unwrap();
        raw_git_ok(repo.path(), &["add", "f.txt"]);
        raw_git_ok(repo.path(), &["commit", "--quiet", "-m", message]);
        shas.push(head_sha(repo.path()));
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(log_graph(&trust, &workspace, "main", 2)).expect("log_graph succeeds");
    assert_eq!(result.nodes.len(), 2);
    assert!(result.truncated);
    assert_eq!(result.nodes[0].sha, shas[2], "newest first");
    assert_eq!(result.nodes[1].sha, shas[1]);
}

#[test]
fn log_graph_rejects_a_zero_max_count_before_ever_invoking_git() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error =
        block_on(log_graph(&trust, &workspace, "main", 0)).expect_err("max_count=0 is rejected");
    assert_eq!(error.code(), "GIT_LOG_GRAPH_INVALID_REQUEST");
}

#[test]
fn log_graph_rejects_a_max_count_above_the_defensive_ceiling_before_ever_invoking_git() {
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(log_graph(&trust, &workspace, "main", 5_001))
        .expect_err("max_count above MAX_GRAPH_MAX_COUNT is rejected");
    assert_eq!(error.code(), "GIT_LOG_GRAPH_INVALID_REQUEST");
}

// --- parse_graph_entries: pure-function edge cases --------------------------

#[test]
fn parse_graph_entries_of_empty_output_is_zero_nodes_not_truncated() {
    let result = parse_graph_entries(b"", 500).expect("parses");
    assert!(result.nodes.is_empty());
    assert!(!result.truncated);
}

#[test]
fn parse_graph_entries_parses_a_root_commits_empty_parents_field() {
    let sha = "a".repeat(40);
    let mut output = sha.clone().into_bytes();
    output.push(0x1f);
    output.push(0x1f);
    output.extend_from_slice(b"root");
    output.push(0);
    let result = parse_graph_entries(&output, 500).expect("parses");
    assert_eq!(result.nodes.len(), 1);
    assert_eq!(result.nodes[0].sha, sha);
    assert_eq!(result.nodes[0].parents, Vec::<String>::new());
}

#[test]
fn parse_graph_entries_parses_multiple_space_separated_parents() {
    let sha = "a".repeat(40);
    let p1 = "b".repeat(40);
    let p2 = "c".repeat(40);
    let p3 = "d".repeat(40);
    let mut output = sha.into_bytes();
    output.push(0x1f);
    output.extend_from_slice(format!("{p1} {p2} {p3}").as_bytes());
    output.push(0x1f);
    output.extend_from_slice(b"octopus");
    output.push(0);
    let result = parse_graph_entries(&output, 500).expect("parses");
    assert_eq!(result.nodes[0].parents, vec![p1, p2, p3]);
}

#[test]
fn parse_graph_entries_rejects_a_record_missing_the_subject_separator() {
    let sha = "a".repeat(40);
    let mut output = sha.into_bytes();
    output.push(0x1f);
    output.extend_from_slice(b"only-one-field-after-sha");
    output.push(0);
    let error =
        parse_graph_entries(&output, 500).expect_err("missing second separator is rejected");
    assert_eq!(error.code(), "GIT_LOG_GRAPH_PARSE_FAILED");
}

#[test]
fn parse_graph_entries_rejects_a_sha_that_is_not_lowercase_hex40() {
    let uppercase_sha = "A".repeat(40);
    let mut output = uppercase_sha.into_bytes();
    output.push(0x1f);
    output.push(0x1f);
    output.extend_from_slice(b"subject");
    output.push(0);
    let error = parse_graph_entries(&output, 500).expect_err("uppercase hex sha is rejected");
    assert_eq!(error.code(), "GIT_LOG_GRAPH_PARSE_FAILED");
}

#[test]
fn parse_graph_entries_rejects_a_parent_token_that_is_not_lowercase_hex40() {
    let sha = "a".repeat(40);
    let mut output = sha.into_bytes();
    output.push(0x1f);
    output.extend_from_slice(b"not-a-real-parent-sha");
    output.push(0x1f);
    output.extend_from_slice(b"subject");
    output.push(0);
    let error = parse_graph_entries(&output, 500).expect_err("malformed parent token is rejected");
    assert_eq!(error.code(), "GIT_LOG_GRAPH_PARSE_FAILED");
}

#[test]
fn parse_graph_entries_caps_at_the_defensive_ceiling_and_reports_truncated() {
    // Hand-constructed (not spawned through real git — this exercises only
    // this module's own pure truncation logic, mirroring
    // `parse_history_entries_caps_at_the_defensive_ceiling_and_reports_truncated`'s
    // identical rationale above): 10 distinct, well-formed records, capped at 5.
    let mut output = Vec::new();
    for index in 0..10u32 {
        let sha = format!("{index:040x}");
        output.extend_from_slice(sha.as_bytes());
        output.push(0x1f);
        output.push(0x1f);
        output.extend_from_slice(format!("subject {index}").as_bytes());
        output.push(0);
    }
    let result = parse_graph_entries(&output, 5).expect("parses");
    assert_eq!(result.nodes.len(), 5);
    assert!(result.truncated);
}
