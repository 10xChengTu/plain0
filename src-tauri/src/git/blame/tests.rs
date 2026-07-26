//! `blame::parse_line_porcelain`/`blame::parse_commit_messages`/
//! `blame::blame_file`/`blame::blame_commit_messages` contract tests — every
//! fixture spawns a *real* `git` binary, mirroring `status::tests`'s own
//! rationale for never hand-typing wire bytes. Several tests below are
//! *control-group* fixtures: they run the same real repository through both
//! an unhardened (or differently-flagged) raw invocation and this domain's
//! actual hardened path, and assert the two genuinely differ — proving a
//! hardening measure changes real behavior, not just that the hardened path
//! happens to pass.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{
    blame_commit_messages, blame_file, parse_commit_messages, parse_line_porcelain, BlameLineRange,
    BLAME_UNCOMMITTED_SHA,
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

/// Runs an arbitrary `git <leading_args>... -- <path>` invocation directly
/// (bypassing this domain's own hardened [`super::exec::run_git`] entirely)
/// — used only to construct *control groups* that prove a specific hardening
/// flag (`--root`, `-c core.quotePath=false`) genuinely changes git's raw
/// output, never as this domain's own production spawn path.
fn raw_blame(dir: &Path, leading_args: &[&str], path: &str) -> std::process::Output {
    let mut args: Vec<&str> = leading_args.to_vec();
    args.push("--");
    args.push(path);
    Command::new("git")
        .current_dir(dir)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git blame fixture command spawns")
}

// --- basic attribution -----------------------------------------------------

#[test]
fn blame_file_reports_correct_commit_attribution_for_a_two_commit_file() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(
        repo.path(),
        &[
            "-c",
            "user.name=Author A",
            "-c",
            "user.email=a@example.com",
            "commit",
            "--quiet",
            "-m",
            "initial commit",
        ],
    );
    std::fs::write(
        repo.path().join("file.txt"),
        "line1\nline2-changed\nline3\nline4\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(
        repo.path(),
        &[
            "-c",
            "user.name=Author B",
            "-c",
            "user.email=b@example.com",
            "commit",
            "--quiet",
            "-am",
            "second commit",
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", "file.txt", None))
        .expect("blame_file succeeds");

    assert_eq!(result.entries.len(), 4);
    assert_eq!(result.entries[0].final_line, 1);
    assert_eq!(result.entries[1].final_line, 2);
    let line1_sha = result.entries[0].commit_sha.clone();
    let line2_sha = result.entries[1].commit_sha.clone();
    let line3_sha = result.entries[2].commit_sha.clone();
    let line4_sha = result.entries[3].commit_sha.clone();
    assert_eq!(
        line1_sha, line3_sha,
        "line1/line3 both from the first commit"
    );
    assert_eq!(
        line2_sha, line4_sha,
        "line2/line4 both from the second commit"
    );
    assert_ne!(line1_sha, line2_sha);

    let first_commit = result
        .commits
        .get(&line1_sha)
        .expect("commit metadata present");
    assert_eq!(first_commit.author, "Author A");
    assert_eq!(first_commit.author_mail, "<a@example.com>");
    assert_eq!(first_commit.summary, "initial commit");
    let second_commit = result
        .commits
        .get(&line2_sha)
        .expect("commit metadata present");
    assert_eq!(second_commit.author, "Author B");
    assert_eq!(second_commit.summary, "second commit");
    assert_eq!(
        result.commits.len(),
        2,
        "exactly two distinct commits, deduplicated"
    );
}

// --- `--root` boundary-marker control group --------------------------------

#[test]
fn blame_root_flag_avoids_a_boundary_marker_that_a_control_invocation_without_it_reports() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file.txt"), "only line\n").unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root commit"]);

    // Control: the exact same repository, blamed WITHOUT --root, reports a
    // `boundary` porcelain line for the root commit's lines.
    let without_root = raw_blame(repo.path(), &["blame", "--line-porcelain"], "file.txt");
    assert!(without_root.status.success());
    let without_root_text = String::from_utf8_lossy(&without_root.stdout);
    assert!(
        without_root_text.contains("\nboundary\n"),
        "control group (no --root) must report a boundary marker for the root commit; got: {without_root_text}"
    );

    // Treatment: the same repository, blamed WITH --root, has no boundary
    // marker at all.
    let with_root = raw_blame(
        repo.path(),
        &["blame", "--line-porcelain", "--root"],
        "file.txt",
    );
    assert!(with_root.status.success());
    let with_root_text = String::from_utf8_lossy(&with_root.stdout);
    assert!(
        !with_root_text.contains("\nboundary\n"),
        "--root must suppress the boundary marker; got: {with_root_text}"
    );

    // This domain's own production path always passes --root, so its
    // parsed result must agree with the "with_root" treatment above, not
    // the control.
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", "file.txt", None))
        .expect("blame_file succeeds");
    assert!(result.entries.iter().all(|entry| !entry.is_boundary));
}

// --- rename mid-output ------------------------------------------------------

#[test]
fn blame_reports_the_old_filename_for_lines_that_predate_a_rename_and_the_new_filename_after_it() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("old-name.txt"), "alpha\nbeta\ngamma\n").unwrap();
    raw_git_ok(repo.path(), &["add", "old-name.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add old-name"]);
    raw_git_ok(repo.path(), &["mv", "old-name.txt", "new-name.txt"]);
    std::fs::write(
        repo.path().join("new-name.txt"),
        "alpha\nbeta\ngamma\ndelta\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "new-name.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-am", "rename and add delta"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", "new-name.txt", None))
        .expect("blame_file succeeds");

    assert_eq!(result.entries.len(), 4);
    for entry in &result.entries[0..3] {
        assert_eq!(
            entry.filename.as_bytes(),
            b"old-name.txt",
            "lines predating the rename must report the old filename"
        );
    }
    assert_eq!(
        result.entries[3].filename.as_bytes(),
        b"new-name.txt",
        "the line added in the same commit as the rename must report the new filename"
    );
    assert_ne!(
        result.entries[0].commit_sha, result.entries[3].commit_sha,
        "sanity: the pre-rename and post-rename lines are genuinely different commits"
    );
    let previous = result.entries[3]
        .previous
        .as_ref()
        .expect("the rename commit's line has a previous pointer");
    assert_eq!(previous.sha, result.entries[0].commit_sha);
    assert_eq!(previous.path.as_bytes(), b"old-name.txt");
}

// --- uncommitted working-tree lines -----------------------------------------

#[test]
fn blame_reports_uncommitted_lines_with_the_zero_sha_and_a_previous_pointer() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file.txt"), "alpha\nbeta\n").unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    std::fs::write(repo.path().join("file.txt"), "alpha\nbeta\nuncommitted\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", "file.txt", None))
        .expect("blame_file succeeds");

    assert_eq!(result.entries.len(), 3);
    let uncommitted = &result.entries[2];
    assert_eq!(uncommitted.commit_sha, BLAME_UNCOMMITTED_SHA);
    let commit = result
        .commits
        .get(BLAME_UNCOMMITTED_SHA)
        .expect("the sentinel sha still has a synthesized commit header");
    assert_eq!(commit.author, "Not Committed Yet");
    assert_eq!(commit.author_mail, "<not.committed.yet>");
    assert!(uncommitted.previous.is_some());
    assert_ne!(result.entries[0].commit_sha, BLAME_UNCOMMITTED_SHA);
}

// --- `-L` line ranges --------------------------------------------------------

#[test]
fn blame_line_range_returns_only_the_requested_lines() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(
        repo.path().join("file.txt"),
        "line1\nline2\nline3\nline4\nline5\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(
        &trust,
        &workspace,
        "main",
        "file.txt",
        Some(BlameLineRange { start: 2, end: 4 }),
    ))
    .expect("blame_file succeeds");

    assert_eq!(result.entries.len(), 3);
    assert_eq!(result.entries[0].final_line, 2);
    assert_eq!(result.entries[1].final_line, 3);
    assert_eq!(result.entries[2].final_line, 4);
}

#[test]
fn blame_line_range_out_of_bounds_is_a_structured_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file.txt"), "only\n").unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(blame_file(
        &trust,
        &workspace,
        "main",
        "file.txt",
        Some(BlameLineRange { start: 10, end: 10 }),
    ))
    .expect_err("out-of-bounds range must fail");
    assert_eq!(error.code(), "GIT_BLAME_RANGE_OUT_OF_BOUNDS");
}

#[test]
fn blame_invalid_range_is_rejected_as_a_structured_error_before_conflicting_with_git() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("file.txt"), "only\n").unwrap();
    raw_git_ok(repo.path(), &["add", "file.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let zero_start = block_on(blame_file(
        &trust,
        &workspace,
        "main",
        "file.txt",
        Some(BlameLineRange { start: 0, end: 1 }),
    ))
    .expect_err("start == 0 must be rejected");
    assert_eq!(zero_start.code(), "GIT_BLAME_INVALID_RANGE");

    let end_before_start = block_on(blame_file(
        &trust,
        &workspace,
        "main",
        "file.txt",
        Some(BlameLineRange { start: 5, end: 2 }),
    ))
    .expect_err("end < start must be rejected");
    assert_eq!(end_before_start.code(), "GIT_BLAME_INVALID_RANGE");
}

// --- not-found paths ---------------------------------------------------------

#[test]
fn blame_nonexistent_untracked_and_directory_paths_are_structured_not_found_errors() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::create_dir(repo.path().join("subdir")).unwrap();
    std::fs::write(repo.path().join("subdir/y.txt"), "y\n").unwrap();
    std::fs::write(repo.path().join("untracked.txt"), "u\n").unwrap();
    raw_git_ok(repo.path(), &["add", "subdir"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    for path in ["does-not-exist.txt", "untracked.txt", "subdir"] {
        let error = block_on(blame_file(&trust, &workspace, "main", path, None))
            .expect_err(&format!("{path} must be reported as not found"));
        assert_eq!(error.code(), "GIT_BLAME_PATH_NOT_FOUND", "path: {path}");
    }
}

#[test]
fn blame_file_rejects_an_invalid_path_without_needing_a_repository() {
    let repo = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    for path in ["", "/etc/passwd", "a/../b"] {
        let error = block_on(blame_file(&trust, &workspace, "main", path, None))
            .expect_err(&format!("{path:?} must be rejected"));
        assert_eq!(error.code(), "GIT_BLAME_INVALID_PATH", "path: {path:?}");
    }
}

#[test]
fn blame_file_rejects_an_untrusted_workspace() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(blame_file(&trust, &workspace, "main", "file.txt", None))
        .expect_err("an ungranted trust must reject before ever spawning git");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- quote-path hardening: the central control-group cluster ----------------

#[test]
fn blame_hardened_call_recovers_the_real_filename_while_an_unhardened_control_is_octal_escaped() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "文件.txt";
    std::fs::write(repo.path().join(filename), "line one\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "add unicode file"],
    );

    // Control: git's own DEFAULT quoting (no `-c core.quotePath=false`
    // override at all) — the raw `filename` line is octal-escaped and
    // quote-wrapped, not the real UTF-8 bytes.
    let control = raw_blame(
        repo.path(),
        &["blame", "--line-porcelain", "--root"],
        filename,
    );
    assert!(control.status.success());
    let control_text = String::from_utf8_lossy(&control.stdout);
    assert!(
        control_text.contains(r#"filename "\346\226\207\344\273\266.txt""#),
        "control group must reproduce git's own default octal-escaped quoting; got: {control_text}"
    );
    assert!(
        !control.stdout.windows(filename.len()).any(|window| window == filename.as_bytes()),
        "the control group's raw bytes must NOT contain the real filename's literal UTF-8 bytes anywhere"
    );

    // Defense in depth: even the *unhardened* control output is still
    // correctly recoverable by this parser's C-quote-aware dequoting.
    let parsed_control = parse_line_porcelain(&control.stdout).expect("parses the quoted form");
    assert_eq!(
        parsed_control.entries[0].filename.as_bytes(),
        filename.as_bytes()
    );

    // Treatment: this domain's real, hardened `blame_file` — which does
    // include `-c core.quotePath=false` — reports the correct filename too,
    // and (checked directly below) does so via genuinely different raw wire
    // bytes, not merely "the parser coped anyway".
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());

    let hardened_raw = raw_blame(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "blame",
            "--line-porcelain",
            "--root",
        ],
        filename,
    );
    let hardened_text = String::from_utf8_lossy(&hardened_raw.stdout);
    assert!(
        hardened_text.contains(&format!("filename {filename}")),
        "the hardened flag must make git emit the real raw UTF-8 bytes unquoted; got: {hardened_text}"
    );
    assert!(
        !hardened_text.contains("\\346"),
        "no octal escaping once the flag is set"
    );
}

#[test]
fn blame_quoting_still_wraps_a_literal_quote_character_even_with_quote_path_false() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "a \"quoted\" name.txt";
    std::fs::write(repo.path().join(filename), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "add quote-char name"],
    );

    // This is the second half of the "-c core.quotePath=false is necessary
    // but not sufficient" finding: even WITH the override, a literal `"` in
    // the filename still forces quoting — proving a parser that assumed
    // "the flag means always-raw" would still be wrong.
    let hardened_raw = raw_blame(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "blame",
            "--line-porcelain",
            "--root",
        ],
        filename,
    );
    assert!(hardened_raw.status.success());
    let text = String::from_utf8_lossy(&hardened_raw.stdout);
    assert!(
        text.contains(r#"filename "a \"quoted\" name.txt""#),
        "a literal quote character must still be quoted+escaped even with core.quotePath=false; got: {text}"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

#[test]
fn blame_quoting_still_escapes_a_literal_backslash_character() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "a\\backslash.txt";
    std::fs::write(repo.path().join(filename), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "add backslash name"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

#[test]
fn blame_quoting_still_escapes_a_literal_tab_character_via_a_named_escape() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "tab\tname.txt";
    std::fs::write(repo.path().join(filename), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add tab name"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

#[test]
fn blame_quoting_still_escapes_a_control_byte_via_a_three_digit_octal_escape() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "ctrl\u{1}name.txt"; // literal 0x01 control byte
    std::fs::write(repo.path().join(filename), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "add control-char name"],
    );

    let hardened_raw = raw_blame(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "blame",
            "--line-porcelain",
            "--root",
        ],
        filename,
    );
    assert!(hardened_raw.status.success());
    assert!(
        String::from_utf8_lossy(&hardened_raw.stdout).contains(r#"filename "ctrl\001name.txt""#),
        "an unnamed control byte must be octal-escaped even with core.quotePath=false"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

/// Refutes a stated assumption in the frozen research doc
/// (`docs/research/2026-07-26-git-history.md`'s "风险与未知项" #3): that a
/// literal-LF filename cannot be constructed on macOS/APFS. It can — a
/// literal `\n` byte in a filename requires no special raw-byte/`OsStr`
/// tooling at all, just an ordinary Rust string literal used directly with
/// `std::fs::write`/`Command::arg` (no shell is ever involved, so there is
/// no shell-level word-splitting concern either). This was verified
/// independently against this exact filesystem before writing this test.
#[test]
fn blame_handles_a_filename_containing_a_literal_line_feed_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "lf\nname.txt";
    std::fs::write(repo.path().join(filename), "x\n")
        .expect("this filesystem allows a literal LF byte in a filename (verified empirically)");
    raw_git_ok(repo.path(), &["add", "--", filename]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add lf name"]);

    let hardened_raw = raw_blame(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "blame",
            "--line-porcelain",
            "--root",
        ],
        filename,
    );
    assert!(hardened_raw.status.success());
    assert!(
        String::from_utf8_lossy(&hardened_raw.stdout).contains(r#"filename "lf\nname.txt""#),
        "a literal LF byte must be escaped as the two-byte `\\n` sequence, never a raw 0x0a"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

#[test]
fn blame_handles_a_filename_containing_spaces() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let filename = "a file with spaces.txt";
    std::fs::write(repo.path().join(filename), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", filename]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add spaced name"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", filename, None))
        .expect("blame_file succeeds");
    assert_eq!(result.entries[0].filename.as_bytes(), filename.as_bytes());
}

#[test]
fn blame_parses_a_binary_files_content_line_without_panicking() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("bin.dat"), [0u8, 1, 2, 3, 255, 254, b'\n']).unwrap();
    raw_git_ok(repo.path(), &["add", "bin.dat"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "binary file"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(blame_file(&trust, &workspace, "main", "bin.dat", None))
        .expect("blame_file succeeds even for binary content");
    assert_eq!(result.entries.len(), 1);
}

// --- `git log --no-walk` batch commit-message fetch -------------------------

#[test]
fn blame_commit_messages_returns_the_full_body_for_requested_shas() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(
        repo.path(),
        &[
            "commit",
            "--quiet",
            "-m",
            "subject one\n\nbody line one\nbody line two",
        ],
    );
    let first_sha = String::from_utf8(
        Command::new("git")
            .current_dir(repo.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let messages = block_on(blame_commit_messages(
        &trust,
        &workspace,
        "main",
        std::slice::from_ref(&first_sha),
    ))
    .expect("blame_commit_messages succeeds");

    assert_eq!(
        messages.get(&first_sha).map(String::as_str),
        Some("subject one\n\nbody line one\nbody line two\n")
    );
}

#[test]
fn blame_commit_messages_of_an_empty_batch_succeeds_without_a_git_spawn_but_still_checks_trust() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();

    // Trust check still runs even for an empty batch.
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let untrusted = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(blame_commit_messages(&untrusted, &workspace, "main", &[]))
        .expect_err("an empty batch still requires trust");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");

    if !git_available() {
        eprintln!("skipping remainder: git not found on PATH");
        return;
    }
    // A trusted-but-non-repository root also still returns Ok for an empty
    // batch once resolve_repo_toplevel succeeds against a real repo.
    let repo = init_repo();
    let trust_base2 = TempDir::new().unwrap();
    let (workspace2, trust2) = trusted_workspace("second", repo.path(), trust_base2.path());
    let messages = block_on(blame_commit_messages(&trust2, &workspace2, "second", &[]))
        .expect("empty batch succeeds");
    assert!(messages.is_empty());
}

#[test]
fn blame_commit_messages_dedupes_repeated_shas_into_one_lookup() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "a\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let sha = String::from_utf8(
        Command::new("git")
            .current_dir(repo.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let messages = block_on(blame_commit_messages(
        &trust,
        &workspace,
        "main",
        &[sha.clone(), sha.clone(), sha.clone()],
    ))
    .expect("blame_commit_messages succeeds");
    assert_eq!(messages.len(), 1);
    assert!(messages.contains_key(&sha));
}

#[test]
fn blame_commit_messages_rejects_the_uncommitted_sentinel_sha() {
    let repo = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(blame_commit_messages(
        &trust,
        &workspace,
        "main",
        &[BLAME_UNCOMMITTED_SHA.to_owned()],
    ))
    .expect_err("the zero sha has no real commit to look up");
    assert_eq!(error.code(), "GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST");
}

#[test]
fn blame_commit_messages_rejects_a_malformed_sha() {
    let repo = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    for malformed in ["", "not-hex", "deadbeef", &"a".repeat(41), &"A".repeat(40)] {
        let error = block_on(blame_commit_messages(
            &trust,
            &workspace,
            "main",
            &[malformed.to_owned()],
        ))
        .expect_err(&format!("{malformed:?} must be rejected"));
        assert_eq!(
            error.code(),
            "GIT_BLAME_COMMIT_MESSAGES_INVALID_REQUEST",
            "input: {malformed:?}"
        );
    }
}

/// The security-relevant finding this module's own doc comment documents:
/// `git config user.name` accepts a raw `0x1f` byte through completely
/// normal, no-special-tooling `git commit` — the exact delimiter byte the
/// frozen research doc's own multi-field format sketch used *before* the
/// message body. This proves the redesigned `%H%x1f%B`-only format (and its
/// `splitn(2, ..)` parser) is immune: the hostile byte lives only in the
/// author name, a field this format string never even requests, so it can
/// never reach the parser to shift anything.
#[test]
fn blame_commit_messages_is_immune_to_a_hostile_author_name_containing_a_unit_separator_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let hostile_author_name = format!("evil{}author", '\u{1f}');
    std::fs::write(repo.path().join("f.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(
        repo.path(),
        &[
            "-c",
            &format!("user.name={hostile_author_name}"),
            "commit",
            "--quiet",
            "-m",
            "seed",
        ],
    );
    let sha = String::from_utf8(
        Command::new("git")
            .current_dir(repo.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();

    // Confirm the hostile byte really did land in the author name field on
    // a real commit (the premise of this test, not merely assumed).
    let raw_check = Command::new("git")
        .current_dir(repo.path())
        .args(["log", "-1", "--format=%an"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&raw_check.stdout).trim_end(),
        hostile_author_name
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let messages = block_on(blame_commit_messages(
        &trust,
        &workspace,
        "main",
        std::slice::from_ref(&sha),
    ))
    .expect("blame_commit_messages succeeds despite the hostile author name");
    assert_eq!(messages.get(&sha).map(String::as_str), Some("seed\n"));
}

/// Pure-function control group for the same finding: demonstrates that a
/// *naive* "split every occurrence of the delimiter" parser really would be
/// corrupted by a body containing an embedded `0x1f` byte, while the real
/// [`parse_commit_messages`] (which only splits on the *first* occurrence)
/// is not.
#[test]
fn parse_commit_messages_splitn_is_not_confused_by_an_embedded_separator_in_the_body_while_a_naive_full_split_would_be(
) {
    let sha = "a".repeat(40);
    let body_with_embedded_separator = format!("subject line with a {} char\n", '\u{1f}');
    let mut record = sha.clone().into_bytes();
    record.push(0x1f);
    record.extend_from_slice(body_with_embedded_separator.as_bytes());
    let mut output = record.clone();
    output.push(0);

    let messages = parse_commit_messages(&output).expect("parses");
    assert_eq!(
        messages.get(&sha).map(String::as_str),
        Some(body_with_embedded_separator.as_str()),
        "the real parser must capture the body verbatim, embedded separator included"
    );

    // Control: a naive parser that splits on *every* 0x1f occurrence would
    // instead see three fields (sha, "subject line with a ", " char\n") and
    // either lose data or misattribute a fourth field — demonstrating the
    // vulnerability this test's sibling integration test proves is reachable
    // via entirely normal git usage (a hostile author name), not just a
    // synthetic byte string.
    let naive_fields: Vec<&[u8]> = record.split(|&byte| byte == 0x1f).collect();
    assert_eq!(
        naive_fields.len(),
        3,
        "the naive full-split approach really would misparse this record into extra fields"
    );
}

// --- hostile/malformed `--line-porcelain` output ----------------------------

fn real_valid_blame_output(repo: &Path, filename: &str) -> Vec<u8> {
    let output = raw_blame(
        repo,
        &[
            "-c",
            "core.quotePath=false",
            "blame",
            "--line-porcelain",
            "--root",
        ],
        filename,
    );
    assert!(output.status.success());
    output.stdout
}

#[test]
fn parse_line_porcelain_of_empty_output_is_zero_entries() {
    let result = parse_line_porcelain(b"").expect("parses");
    assert!(result.entries.is_empty());
    assert!(result.commits.is_empty());
}

#[test]
fn parse_line_porcelain_rejects_output_truncated_before_the_filename_line() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let real = real_valid_blame_output(repo.path(), "a.txt");

    // Cut the output off right before the "filename " line (which always
    // immediately precedes the tab-prefixed content line).
    let filename_index = real
        .windows(b"filename ".len())
        .position(|window| window == b"filename ")
        .expect("real output contains a filename line");
    let truncated = &real[..filename_index];
    let error = parse_line_porcelain(truncated).expect_err("truncated output must not parse");
    assert_eq!(error.code(), "GIT_BLAME_PARSE_FAILED");
}

#[test]
fn parse_line_porcelain_rejects_an_unterminated_quoted_filename() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("文件.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "文件.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    // Deliberately omit `-c core.quotePath=false` so the filename line is
    // quoted, then corrupt the closing quote.
    let output = raw_blame(
        repo.path(),
        &["blame", "--line-porcelain", "--root"],
        "文件.txt",
    );
    assert!(output.status.success());
    let corrupted = String::from_utf8_lossy(&output.stdout).replace(
        r#"filename "\346\226\207\344\273\266.txt""#,
        r#"filename "\346\226\207\344\273\266.txt"#, // missing the final closing quote
    );
    let error =
        parse_line_porcelain(corrupted.as_bytes()).expect_err("an unterminated quote must fail");
    assert_eq!(error.code(), "GIT_BLAME_PARSE_FAILED");
}

#[test]
fn parse_line_porcelain_rejects_an_invalid_octal_escape() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("文件.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "文件.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let output = raw_blame(
        repo.path(),
        &["blame", "--line-porcelain", "--root"],
        "文件.txt",
    );
    assert!(output.status.success());
    // `\346` is a valid 3-digit octal escape; `\389` uses non-octal digits.
    let corrupted = String::from_utf8_lossy(&output.stdout).replace(r"\346", r"\389");
    let error =
        parse_line_porcelain(corrupted.as_bytes()).expect_err("an invalid octal escape must fail");
    assert_eq!(error.code(), "GIT_BLAME_PARSE_FAILED");
}

#[test]
fn parse_line_porcelain_rejects_a_non_numeric_group_size() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let real = real_valid_blame_output(repo.path(), "a.txt");
    let real_text = String::from_utf8_lossy(&real);
    let first_line_end = real_text.find('\n').expect("has a first line");
    let first_line = &real_text[..first_line_end];
    assert!(first_line.ends_with(" 1"), "sanity: group size is 1 here");
    let corrupted_first_line = format!("{} not-a-number", &first_line[..first_line.len() - 2]);
    let corrupted = corrupted_first_line + &real_text[first_line_end..];
    let error =
        parse_line_porcelain(corrupted.as_bytes()).expect_err("a non-numeric group size must fail");
    assert_eq!(error.code(), "GIT_BLAME_PARSE_FAILED");
}
