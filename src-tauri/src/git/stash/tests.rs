//! `git::stash` contract tests (`F090` S4). Every fixture spawns a *real*
//! `git` binary, mirroring `refs::tests`'s/`log::tests`'s own rationale for
//! never hand-typing wire bytes for an end-to-end assertion. Several tests
//! below are *control-group* fixtures: they run the same real repository
//! through both a raw/differently-shaped invocation and this domain's actual
//! production path, and assert the two genuinely differ — never merely that
//! the chosen path happens to pass.

use std::path::Path;
use std::process::{Command, Output};

use tempfile::TempDir;

use super::{
    apply_stash, drop_stash, list_stashes, parse_stash_list, pop_stash, push_stash, show_stash,
    StashApplyOutcome, StashPushOutcome,
};
use crate::git::diff::DiffStatusKind;
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
    let output = raw_git(dir, args);
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn raw_git(dir: &Path, args: &[&str]) -> Output {
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

fn stash_sha(dir: &Path, index: u32) -> String {
    String::from_utf8(raw_git(dir, &["rev-parse", &format!("stash@{{{index}}}")]).stdout)
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

// --- list_stashes ------------------------------------------------------------

#[test]
fn list_stashes_of_a_clean_repo_with_no_stash_entries_is_empty_and_not_an_error() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_stashes(&trust, &workspace, "main")).expect("list_stashes succeeds");
    assert_eq!(result.entries, Vec::new());
    assert!(!result.truncated);
}

#[test]
fn list_stashes_returns_multiple_entries_newest_first_with_correct_index() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    std::fs::write(repo.path().join("b.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "first"]);

    std::fs::write(repo.path().join("b.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "second"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_stashes(&trust, &workspace, "main")).expect("list_stashes succeeds");
    assert_eq!(result.entries.len(), 2);
    assert!(!result.truncated);
    assert_eq!(result.entries[0].index, 0);
    assert!(result.entries[0].message.contains("second"));
    assert_eq!(result.entries[0].sha, stash_sha(repo.path(), 0));
    assert_eq!(result.entries[1].index, 1);
    assert!(result.entries[1].message.contains("first"));
    assert_eq!(result.entries[1].sha, stash_sha(repo.path(), 1));
}

#[test]
fn list_stashes_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(list_stashes(&trust, &workspace, "main"))
        .expect_err("untrusted workspace must reject list_stashes");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- hostile fixture: stash message field safety ----------------------------

#[test]
fn list_stashes_is_immune_to_a_hostile_message_containing_a_unit_separator_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let hostile_message = format!("evil{}message{}with{}units", '\u{1f}', '\u{1f}', '\u{1f}');
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", &hostile_message],
    );

    // Confirm the hostile bytes really did land in the stash's own subject on
    // a real stash entry (the premise of this test, not merely assumed).
    let raw_check = raw_git(repo.path(), &["log", "-1", "--format=%s", "stash@{0}"]);
    assert_eq!(
        String::from_utf8_lossy(&raw_check.stdout).trim_end_matches('\n'),
        format!("On main: {hostile_message}")
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_stashes(&trust, &workspace, "main"))
        .expect("list_stashes succeeds despite the hostile message");
    assert_eq!(result.entries.len(), 1);
    assert_eq!(
        result.entries[0].message,
        format!("On main: {hostile_message}"),
        "the full message body must be recovered verbatim, embedded separator included \
         (no trailing newline: confirmed empirically that a stash's own synthesized \
         subject, unlike a stdin-piped multi-line commit message, is stored with none)"
    );
}

/// Pure-function control group: demonstrates that a *naive* "split every
/// occurrence of the delimiter" parser really would misparse a two-record
/// buffer whose first record's message contains an embedded `0x1f` byte,
/// while the real [`parse_stash_list`] (which only splits each record on its
/// first three `0x1f` bytes) is not — mirrors `log::tests`'s identical
/// `parse_history_entries_splitn_is_not_confused_by_an_embedded_separator...`
/// technique, independently re-verified for this module's own four-field
/// format rather than assumed to transfer.
#[test]
fn parse_stash_list_splitn_is_not_confused_by_a_message_containing_an_embedded_separator_byte() {
    let sha_a = "a".repeat(40);
    let sha_b = "b".repeat(40);
    let hostile_message = format!("subject with a {} char\nsecond line", '\u{1f}');

    let mut record_a = b"stash@{0}".to_vec();
    record_a.push(0x1f);
    record_a.extend_from_slice(sha_a.as_bytes());
    record_a.push(0x1f);
    record_a.extend_from_slice(b"1700000000");
    record_a.push(0x1f);
    record_a.extend_from_slice(hostile_message.as_bytes());

    let mut record_b = b"stash@{1}".to_vec();
    record_b.push(0x1f);
    record_b.extend_from_slice(sha_b.as_bytes());
    record_b.push(0x1f);
    record_b.extend_from_slice(b"1600000000");
    record_b.push(0x1f);
    record_b.extend_from_slice(b"a plain second message");

    let mut output = record_a.clone();
    output.push(0);
    output.extend_from_slice(&record_b);
    output.push(0);

    let result = parse_stash_list(&output, 10_000).expect("parses");
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].index, 0);
    assert_eq!(result.entries[0].sha, sha_a);
    assert_eq!(result.entries[0].committer_time, 1_700_000_000);
    assert_eq!(result.entries[0].message, hostile_message);
    assert_eq!(result.entries[1].index, 1);
    assert_eq!(result.entries[1].sha, sha_b);
    assert_eq!(result.entries[1].message, "a plain second message");

    // Control: a naive parser that splits *every* record on every 0x1f
    // occurrence would instead see 5 fields for record_a (the 3 real
    // separators plus the message's own embedded one), not the intended 4 —
    // demonstrating the vulnerability is real, not merely synthetic.
    let naive_fields: Vec<&[u8]> = record_a.split(|&byte| byte == 0x1f).collect();
    assert_eq!(
        naive_fields.len(),
        5,
        "a naive full split sees an extra field where the hostile message's own embedded \
         separator falls — this is exactly the corruption splitn(4, ..) avoids"
    );
}

#[test]
fn parse_stash_list_truncates_and_reports_truncated_when_more_than_max_entries_exist() {
    let mut output = Vec::new();
    for index in 0..3u32 {
        output.extend_from_slice(format!("stash@{{{index}}}").as_bytes());
        output.push(0x1f);
        output.extend_from_slice("c".repeat(40).as_bytes());
        output.push(0x1f);
        output.extend_from_slice(b"1700000000");
        output.push(0x1f);
        output.extend_from_slice(format!("message {index}").as_bytes());
        output.push(0);
    }
    let result = parse_stash_list(&output, 2).expect("parses");
    assert!(result.truncated);
    assert_eq!(result.entries.len(), 2);
    assert_eq!(result.entries[0].index, 0);
    assert_eq!(result.entries[1].index, 1);
}

#[test]
fn parse_stash_list_rejects_a_record_whose_gd_index_does_not_match_its_position() {
    // A well-formed record shape, but claiming index 5 while being the very
    // first (position 0) record — must be rejected defensively rather than
    // silently trusted (see this module's own doc comment).
    let mut output = b"stash@{5}".to_vec();
    output.push(0x1f);
    output.extend_from_slice("d".repeat(40).as_bytes());
    output.push(0x1f);
    output.extend_from_slice(b"1700000000");
    output.push(0x1f);
    output.extend_from_slice(b"message");
    output.push(0);
    let error = parse_stash_list(&output, 10_000).expect_err("must reject index/position mismatch");
    assert_eq!(error.code(), "GIT_STASH_PARSE_FAILED");
}

// --- show_stash ---------------------------------------------------------------

#[test]
fn show_stash_reports_modified_added_and_untracked_files_together() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    std::fs::write(repo.path().join("tracked.txt"), "base\nmore\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    std::fs::write(repo.path().join("new-staged.txt"), "new\n").unwrap();
    raw_git_ok(repo.path(), &["add", "new-staged.txt"]);
    std::fs::write(repo.path().join("new-untracked.txt"), "untracked\n").unwrap();
    raw_git_ok(
        repo.path(),
        &[
            "stash",
            "push",
            "--quiet",
            "--include-untracked",
            "-m",
            "combo",
        ],
    );
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_stash(&trust, &workspace, "main", &sha)).expect("show_stash succeeds");
    assert_eq!(result.sha, sha);
    assert_eq!(
        result.parent_sha.as_deref(),
        Some(head_sha(repo.path()).as_str())
    );

    let find = |name: &str| {
        result
            .files
            .iter()
            .find(|file| file.path.as_bytes() == name.as_bytes())
            .unwrap_or_else(|| panic!("missing file entry {name:?}"))
    };
    assert_eq!(find("tracked.txt").kind, DiffStatusKind::Modified);
    assert_eq!(find("new-staged.txt").kind, DiffStatusKind::Added);
    assert_eq!(find("new-untracked.txt").kind, DiffStatusKind::Added);
    assert_eq!(result.files.len(), 3);
}

#[test]
fn show_stash_of_an_entry_pushed_without_include_untracked_still_succeeds_and_omits_untracked_files(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("tracked.txt"), "changed\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", "no untracked"],
    );
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_stash(&trust, &workspace, "main", &sha))
        .expect("show_stash succeeds even though -u finds nothing extra");
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path.as_bytes(), b"tracked.txt");
}

/// Mirrors `show_commit::tests`'s
/// `show_commit_reports_a_copy_record_that_requires_find_copies_harder_to_detect_at_all`:
/// a byte-identical copy of a file left untouched by the stash is only
/// recognized as `Copied` (rather than reported as a plain `Added`) with
/// `--find-copies-harder`; without it, git's default (non-"harder") copy
/// heuristic only considers files *also* modified in the same diff as
/// candidate sources, so an untouched source is never even considered.
#[test]
fn show_stash_reports_a_copy_record_that_requires_find_copies_harder_to_detect_at_all() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(
        repo.path().join("source.txt"),
        "aaaa\nbbbb\ncccc\ndddd\neeee\n",
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "source.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    std::fs::copy(repo.path().join("source.txt"), repo.path().join("copy.txt")).unwrap();
    raw_git_ok(repo.path(), &["add", "copy.txt"]);
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", "copy test"],
    );
    let sha = stash_sha(repo.path(), 0);

    // Control: plain `-M -C` (no `--find-copies-harder`) reports a bare
    // `Added` record for the untouched source — the production path (which
    // includes `--find-copies-harder`) must differ from this.
    let control = raw_git(
        repo.path(),
        &[
            "stash",
            "show",
            "--no-color",
            "-z",
            "-u",
            "-M",
            "-C",
            "--no-textconv",
            "--no-ext-diff",
            "--name-status",
            &sha,
        ],
    );
    assert!(control.status.success());
    assert_eq!(control.stdout, b"A\0copy.txt\0");

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_stash(&trust, &workspace, "main", &sha)).expect("show_stash succeeds");
    let copy_entry = result
        .files
        .iter()
        .find(|file| file.path.as_bytes() == b"copy.txt")
        .expect("copy.txt entry present");
    assert_eq!(copy_entry.kind, DiffStatusKind::Copied);
    assert_eq!(
        copy_entry.orig_path.as_ref().map(|path| path.as_bytes()),
        Some(&b"source.txt"[..])
    );
}

/// Confirms this slice's own report ("`-c core.quotePath=false` is
/// unnecessary for `stash show`") with a real control group: a file whose
/// name contains a literal double quote, a literal tab, a literal backslash
/// *and* non-ASCII bytes all at once, compared byte-for-byte with and
/// without the override.
#[test]
fn show_stash_name_status_path_quoting_is_unaffected_by_core_quote_path() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let weird_name = "weird\"quote\tand\\backslash-文件.txt";
    std::fs::write(repo.path().join(weird_name), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", weird_name]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add weird name"]);
    std::fs::write(repo.path().join(weird_name), "base\nmore\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", weird_name]);
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", "weird stash"],
    );
    let sha = stash_sha(repo.path(), 0);

    let without_override = raw_git(
        repo.path(),
        &[
            "stash",
            "show",
            "--no-color",
            "-z",
            "-u",
            "-M",
            "-C",
            "--find-copies-harder",
            "--no-textconv",
            "--no-ext-diff",
            "--name-status",
            &sha,
        ],
    );
    let with_override = raw_git(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "stash",
            "show",
            "--no-color",
            "-z",
            "-u",
            "-M",
            "-C",
            "--find-copies-harder",
            "--no-textconv",
            "--no-ext-diff",
            "--name-status",
            &sha,
        ],
    );
    assert!(without_override.status.success() && with_override.status.success());
    assert_eq!(
        without_override.stdout, with_override.stdout,
        "core.quotePath must have no observable effect on stash show's --name-status -z output"
    );
    assert_eq!(
        without_override.stdout,
        format!("M\0{weird_name}\0").into_bytes(),
        "the path must come back fully unescaped, literal quote/tab/backslash/non-ASCII bytes intact"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_stash(&trust, &workspace, "main", &sha)).expect("show_stash succeeds");
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path.to_wire_lossy(), weird_name);
}

#[test]
fn show_stash_handles_a_stash_touching_a_file_with_a_literal_lf_byte_in_its_name() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    // A literal LF byte is a legal Rust string char and a legal APFS/Linux
    // filename byte — confirmed constructible directly, no `OsStr` byte
    // trick needed (see `F090` S0's own correction of the opposite, wrongly
    // assumed, platform limitation).
    let lf_name = "weird\nname.txt";
    std::fs::write(repo.path().join(lf_name), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", lf_name]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add lf name"]);
    std::fs::write(repo.path().join(lf_name), "base\nmore\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", lf_name]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "lf stash"]);
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_stash(&trust, &workspace, "main", &sha)).expect("show_stash succeeds");
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path.to_wire_lossy(), lf_name);
}

#[test]
fn show_stash_rejects_a_sha_that_is_not_a_stash_like_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    let ordinary_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(show_stash(&trust, &workspace, "main", &ordinary_sha))
        .expect_err("an ordinary commit is not a stash-like commit");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

#[test]
fn show_stash_rejects_a_malformed_sha_before_touching_git() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(show_stash(&trust, &workspace, "main", "not-a-sha"))
        .expect_err("malformed sha must be rejected");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

// --- push_stash ----------------------------------------------------------------

#[test]
fn push_stash_creates_an_entry_from_modified_tracked_content() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(push_stash(&trust, &workspace, "main", "my message", false))
        .expect("push_stash succeeds");
    assert!(matches!(outcome, StashPushOutcome::Created));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "1\n",
        "the working tree must be reverted to HEAD after a successful stash"
    );
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(String::from_utf8_lossy(&list.stdout).contains("my message"));
}

#[test]
fn push_stash_on_an_untracked_only_tree_without_include_untracked_reports_no_local_changes() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("only-untracked.txt"), "content\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(push_stash(&trust, &workspace, "main", "msg", false))
        .expect("push_stash succeeds even with nothing to save");
    assert!(matches!(outcome, StashPushOutcome::NoLocalChanges));
    assert!(
        repo.path().join("only-untracked.txt").exists(),
        "the untracked file must be left alone when there was nothing to stash"
    );
}

#[test]
fn push_stash_with_include_untracked_on_an_untracked_only_tree_creates_an_entry_and_removes_the_file(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("only-untracked.txt"), "content\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome =
        block_on(push_stash(&trust, &workspace, "main", "msg", true)).expect("push_stash succeeds");
    assert!(matches!(outcome, StashPushOutcome::Created));
    assert!(
        !repo.path().join("only-untracked.txt").exists(),
        "include_untracked must move the untracked file into the stash"
    );
}

/// The required control-group proof for this module's own doc comment's
/// biggest finding: `GIT_LITERAL_PATHSPECS=1` (this *entire domain's* own
/// universal hardening, applied to every command in every exec mode) breaks
/// `git stash push --include-untracked`'s own untracked-file removal *unless*
/// an explicit `-- .` pathspec is also given — demonstrated here by running
/// the exact same real-git operation twice, once *without* the fix (bare
/// `--include-untracked`, no explicit pathspec) and once *with* it, both
/// under the identical hardened environment `GitExecMode::Write` actually
/// uses, and asserting the two genuinely differ.
#[test]
fn stash_push_include_untracked_needs_an_explicit_pathspec_under_literal_pathspec_hardening() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let hardened_env = [
        ("GIT_LITERAL_PATHSPECS", "1"),
        ("GIT_TERMINAL_PROMPT", "0"),
        ("LANG", "en_US.UTF-8"),
        ("LC_ALL", "en_US.UTF-8"),
    ];

    let without_fix_repo = init_repo();
    std::fs::write(without_fix_repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(without_fix_repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(
        without_fix_repo.path(),
        &["commit", "--quiet", "-m", "init"],
    );
    std::fs::write(
        without_fix_repo.path().join("only-untracked.txt"),
        "content\n",
    )
    .unwrap();
    let without_fix = Command::new("git")
        .current_dir(without_fix_repo.path())
        .args(["stash", "push", "--include-untracked", "-m", "msg"])
        .envs(hardened_env)
        .output()
        .expect("git spawns");
    assert!(without_fix.status.success());
    assert!(
        without_fix_repo.path().join("only-untracked.txt").exists(),
        "control group: without the explicit pathspec, the bug must reproduce \
         (git reports success but silently fails to remove the untracked file)"
    );

    let with_fix_repo = init_repo();
    std::fs::write(with_fix_repo.path().join("tracked.txt"), "base\n").unwrap();
    raw_git_ok(with_fix_repo.path(), &["add", "tracked.txt"]);
    raw_git_ok(with_fix_repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(with_fix_repo.path().join("only-untracked.txt"), "content\n").unwrap();
    let with_fix = Command::new("git")
        .current_dir(with_fix_repo.path())
        .args([
            "stash",
            "push",
            "--include-untracked",
            "-m",
            "msg",
            "--",
            ".",
        ])
        .envs(hardened_env)
        .output()
        .expect("git spawns");
    assert!(with_fix.status.success());
    assert!(
        !with_fix_repo.path().join("only-untracked.txt").exists(),
        "production fix: the explicit `-- .` pathspec must restore correct removal \
         even with GIT_LITERAL_PATHSPECS=1 still set"
    );
}

#[test]
fn push_stash_accepts_a_message_that_itself_looks_like_a_flag() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let hostile_message = "--not-a-real-flag --include-untracked";
    let outcome = block_on(push_stash(
        &trust,
        &workspace,
        "main",
        hostile_message,
        false,
    ))
    .expect("a message beginning with dashes must be treated as plain content, never a flag");
    assert!(matches!(outcome, StashPushOutcome::Created));
    let subject = raw_git(repo.path(), &["log", "-1", "--format=%s", "stash@{0}"]);
    assert_eq!(
        String::from_utf8_lossy(&subject.stdout).trim_end_matches('\n'),
        format!("On main: {hostile_message}")
    );
}

#[test]
fn push_stash_on_an_unborn_head_reports_no_initial_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(push_stash(&trust, &workspace, "main", "msg", false))
        .expect_err("an unborn HEAD has nothing to base a stash commit on");
    assert_eq!(error.code(), "GIT_STASH_PUSH_NO_INITIAL_COMMIT");
}

#[test]
fn push_stash_rejects_an_empty_message() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(push_stash(&trust, &workspace, "main", "   ", false))
        .expect_err("an empty (whitespace-only) message must be rejected");
    assert_eq!(error.code(), "GIT_STASH_PUSH_EMPTY_MESSAGE");
}

#[test]
fn push_stash_rejects_an_oversized_message() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let oversized = "a".repeat(100_001);
    let error = block_on(push_stash(&trust, &workspace, "main", &oversized, false))
        .expect_err("an oversized message must be rejected");
    assert_eq!(error.code(), "GIT_STASH_PUSH_MESSAGE_TOO_LARGE");
}

// --- apply_stash -----------------------------------------------------------

#[test]
fn apply_stash_applies_changes_without_removing_the_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "msg"]);
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(apply_stash(&trust, &workspace, "main", &sha, false))
        .expect("apply_stash succeeds");
    assert!(matches!(outcome, StashApplyOutcome::Applied));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "2\n"
    );
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(
        !String::from_utf8_lossy(&list.stdout).trim().is_empty(),
        "apply must never remove the stash entry, unlike pop"
    );
}

#[test]
fn apply_stash_reports_conflict_and_retains_the_entry_when_the_same_lines_changed_on_head() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("f.txt"), "line1\nSTASHED\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", "conflict test"],
    );
    let sha = stash_sha(repo.path(), 0);
    std::fs::write(repo.path().join("f.txt"), "line1\nHEAD-CHANGE\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "conflicting head change"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(apply_stash(&trust, &workspace, "main", &sha, false))
        .expect("apply_stash returns a structured outcome, not an error, for a conflict");
    match outcome {
        StashApplyOutcome::Conflict { conflicted_paths } => {
            assert_eq!(conflicted_paths.len(), 1);
            assert_eq!(conflicted_paths[0].as_bytes(), b"f.txt");
        }
        StashApplyOutcome::Applied => panic!("expected a conflict, applied cleanly instead"),
    }
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(
        !String::from_utf8_lossy(&list.stdout).trim().is_empty(),
        "the stash entry must be retained after a conflicting apply"
    );
}

#[test]
fn apply_stash_reports_would_overwrite_when_local_changes_collide_with_the_stashed_paths() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "A\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("f.txt"), "B\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "b-change"]);
    let sha = stash_sha(repo.path(), 0);
    // Uncommitted local change to the same path, never staged/committed —
    // git detects this *before* attempting a real merge and aborts outright
    // (a different failure mode from a true content CONFLICT).
    std::fs::write(repo.path().join("f.txt"), "C\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(apply_stash(&trust, &workspace, "main", &sha, false))
        .expect_err("must reject rather than silently clobber the local change");
    assert_eq!(error.code(), "GIT_STASH_APPLY_WOULD_OVERWRITE");
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f.txt")).unwrap(),
        "C\n",
        "the local uncommitted change must be left untouched"
    );
}

#[test]
fn apply_stash_rejects_a_sha_that_does_not_correspond_to_any_stash() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    let fake_sha = "d".repeat(40);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(apply_stash(&trust, &workspace, "main", &fake_sha, false))
        .expect_err("a well-formed but nonexistent sha must be rejected");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

#[test]
fn apply_stash_rejects_a_malformed_sha_before_touching_git() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(apply_stash(&trust, &workspace, "main", "not-a-sha", false))
        .expect_err("malformed sha must be rejected");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

#[test]
fn apply_stash_with_index_option_restores_the_staged_state_too() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "msg"]);
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(apply_stash(&trust, &workspace, "main", &sha, true)).expect("apply_stash succeeds");
    let diff_cached = raw_git(repo.path(), &["diff", "--cached", "--name-only"]);
    assert_eq!(
        String::from_utf8_lossy(&diff_cached.stdout).trim(),
        "a.txt",
        "--index must restore the staged state, not just the working tree"
    );
}

// --- pop_stash ---------------------------------------------------------------

#[test]
fn pop_stash_applies_and_removes_the_entry_on_success() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "msg"]);
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome =
        block_on(pop_stash(&trust, &workspace, "main", &sha, false)).expect("pop_stash succeeds");
    assert!(matches!(outcome, StashApplyOutcome::Applied));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a.txt")).unwrap(),
        "2\n"
    );
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(
        String::from_utf8_lossy(&list.stdout).trim().is_empty(),
        "pop must remove the entry on success"
    );
}

/// The key semantic requirement per this feature's own task brief: a
/// conflicting pop must **retain** the stash entry, exactly like `git stash
/// pop`'s own documented behavior ("The stash entry is kept in case you need
/// it again").
#[test]
fn pop_stash_on_conflict_retains_the_stash_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("f.txt"), "line1\nSTASHED\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(
        repo.path(),
        &["stash", "push", "--quiet", "-m", "conflict test"],
    );
    let sha = stash_sha(repo.path(), 0);
    std::fs::write(repo.path().join("f.txt"), "line1\nHEAD-CHANGE\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "conflicting head change"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let outcome = block_on(pop_stash(&trust, &workspace, "main", &sha, false))
        .expect("pop_stash returns a structured outcome, not an error, for a conflict");
    match outcome {
        StashApplyOutcome::Conflict { conflicted_paths } => {
            assert_eq!(conflicted_paths.len(), 1);
            assert_eq!(conflicted_paths[0].as_bytes(), b"f.txt");
        }
        StashApplyOutcome::Applied => panic!("expected a conflict, applied cleanly instead"),
    }
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(
        !String::from_utf8_lossy(&list.stdout).trim().is_empty(),
        "a conflicting pop must retain the stash entry — this is the key pop-specific semantic"
    );
    assert_eq!(
        stash_sha(repo.path(), 0),
        sha,
        "the retained entry must still be the same one"
    );
}

/// Control group: git's own grammar rejects a bare sha for `pop`/`drop`
/// (confirmed empirically, this slice's own report) — demonstrating *why*
/// [`pop_stash`]/[`drop_stash`] must resolve `expected_sha` to a
/// `stash@{N}` form themselves rather than passing the sha straight through
/// the way [`apply_stash`]/[`show_stash`] safely can.
#[test]
fn raw_git_stash_pop_rejects_a_bare_sha_confirming_the_resolve_step_is_necessary() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "msg"]);
    let sha = stash_sha(repo.path(), 0);

    let raw_result = raw_git(repo.path(), &["stash", "pop", &sha]);
    assert!(
        !raw_result.status.success(),
        "a bare sha must be rejected by real git stash pop"
    );
    assert!(String::from_utf8_lossy(&raw_result.stderr).contains("is not a stash reference"));
}

#[test]
fn pop_stash_rejects_a_sha_that_is_not_currently_in_the_stash_list() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    let fake_sha = "e".repeat(40);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(pop_stash(&trust, &workspace, "main", &fake_sha, false))
        .expect_err("must fail closed rather than pop an arbitrary entry");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

// --- drop_stash + the index-shift race --------------------------------------

#[test]
fn drop_stash_removes_the_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "msg"]);
    let sha = stash_sha(repo.path(), 0);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(drop_stash(&trust, &workspace, "main", &sha)).expect("drop_stash succeeds");
    let list = raw_git(repo.path(), &["stash", "list"]);
    assert!(String::from_utf8_lossy(&list.stdout).trim().is_empty());
}

#[test]
fn drop_stash_rejects_a_sha_that_is_not_currently_in_the_stash_list() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    let fake_sha = "f".repeat(40);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(drop_stash(&trust, &workspace, "main", &fake_sha))
        .expect_err("must fail closed rather than drop an arbitrary entry");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

#[test]
fn drop_stash_rejects_a_malformed_sha_before_touching_git() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(drop_stash(&trust, &workspace, "main", "not-a-sha"))
        .expect_err("malformed sha must be rejected");
    assert_eq!(error.code(), "GIT_STASH_NOT_FOUND");
}

/// The required real-fixture proof for this module's own doc comment's
/// central safety claim: dropping a middle entry shifts a later entry's own
/// `stash@{N}` index down by one, and this module's sha-based resolution
/// still acts on the *correct* entry despite the shift — the control half of
/// this test demonstrates that blindly reusing the pre-drop index would
/// instead fail outright (in this fixture's case, out of range) rather than
/// silently doing the wrong thing, which is itself already the sharper,
/// disclosed half of the story this module's own doc comment tells.
#[test]
fn drop_stash_shifts_a_later_entrys_index_but_it_is_still_acted_on_correctly_by_its_own_sha() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f-a.txt"), "base\n").unwrap();
    std::fs::write(repo.path().join("f-b.txt"), "base\n").unwrap();
    std::fs::write(repo.path().join("f-c.txt"), "base\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f-a.txt", "f-b.txt", "f-c.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    std::fs::write(repo.path().join("f-a.txt"), "changed-a\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f-a.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "first"]);
    let sha_a = stash_sha(repo.path(), 0);

    std::fs::write(repo.path().join("f-b.txt"), "changed-b\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f-b.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "second"]);
    let sha_b = stash_sha(repo.path(), 0);

    std::fs::write(repo.path().join("f-c.txt"), "changed-c\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f-c.txt"]);
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "third"]);
    let sha_c = stash_sha(repo.path(), 0);

    // Before the drop: stash@{0}=C, stash@{1}=B, stash@{2}=A.
    assert_eq!(stash_sha(repo.path(), 0), sha_c);
    assert_eq!(stash_sha(repo.path(), 1), sha_b);
    assert_eq!(stash_sha(repo.path(), 2), sha_a);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(drop_stash(&trust, &workspace, "main", &sha_b)).expect("drop_stash succeeds");

    // After the drop: A's own index has shifted from 2 down to 1.
    assert_eq!(stash_sha(repo.path(), 0), sha_c);
    assert_eq!(stash_sha(repo.path(), 1), sha_a);

    // Control: naively reusing A's *stale* pre-drop index (2) is now
    // out of range and fails outright — proof the race is real, not
    // hypothetical.
    let stale_index_attempt = raw_git(repo.path(), &["stash", "pop", "stash@{2}"]);
    assert!(
        !stale_index_attempt.status.success(),
        "a stale index must not silently succeed against a different entry"
    );

    // Production: `pop_stash` re-resolves `sha_a`'s *current* index (1) from
    // a fresh list, and correctly pops A specifically — never touching B
    // (already dropped) or C (still present, untouched).
    let outcome = block_on(pop_stash(&trust, &workspace, "main", &sha_a, false))
        .expect("pop_stash re-resolves the shifted index and succeeds");
    assert!(matches!(outcome, StashApplyOutcome::Applied));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f-a.txt")).unwrap(),
        "changed-a\n"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f-b.txt")).unwrap(),
        "base\n",
        "B's own change must never have been touched by A's pop"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f-c.txt")).unwrap(),
        "base\n",
        "C's own stash entry must remain untouched and still poppable"
    );
    assert_eq!(stash_sha(repo.path(), 0), sha_c, "only C should remain");

    let outcome_c = block_on(pop_stash(&trust, &workspace, "main", &sha_c, false))
        .expect("popping the last remaining entry still succeeds");
    assert!(matches!(outcome_c, StashApplyOutcome::Applied));
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f-c.txt")).unwrap(),
        "changed-c\n"
    );
    let final_list = raw_git(repo.path(), &["stash", "list"]);
    assert!(String::from_utf8_lossy(&final_list.stdout)
        .trim()
        .is_empty());
}

#[test]
fn apply_stash_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(apply_stash(
        &trust,
        &workspace,
        "main",
        &"a".repeat(40),
        false,
    ))
    .expect_err("untrusted workspace must reject apply_stash");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn pop_stash_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(pop_stash(
        &trust,
        &workspace,
        "main",
        &"a".repeat(40),
        false,
    ))
    .expect_err("untrusted workspace must reject pop_stash");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn drop_stash_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(drop_stash(&trust, &workspace, "main", &"a".repeat(40)))
        .expect_err("untrusted workspace must reject drop_stash");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn push_stash_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(push_stash(&trust, &workspace, "main", "msg", false))
        .expect_err("untrusted workspace must reject push_stash");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

#[test]
fn show_stash_rejects_when_workspace_is_not_trusted() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let error = block_on(show_stash(&trust, &workspace, "main", &"a".repeat(40)))
        .expect_err("untrusted workspace must reject show_stash");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
