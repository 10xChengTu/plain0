//! `show_commit::show_commit`/`show_commit::show_commit_blob`/
//! `show_commit::resolve_first_parent` contract tests — every fixture spawns
//! a *real* `git` binary, mirroring `log::tests`'s own rationale for never
//! hand-typing wire bytes. Several tests below are *control-group* fixtures:
//! they run the same real repository through a raw/unhardened or
//! differently-shaped invocation and this module's actual production path,
//! and assert the two genuinely differ — proving the "`--first-parent`
//! avoids the empty-diff trap" claim is real, not merely asserted.

use std::path::Path;
use std::process::{Command, Output};

use tempfile::TempDir;

use super::{
    is_lowercase_hex40, resolve_first_parent, show_commit, show_commit_blob, EMPTY_TREE_SHA,
    GIT_SHOW_COMMIT_DIFF_BASE_ARGS,
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

/// Same shape as `raw_git_ok` but returns the completed process instead of
/// asserting success — used by control groups that expect a *failing* (or
/// merely differently-shaped) invocation, and by the merge fixture's own
/// intentionally-conflicting merge step.
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

fn find_file<'a>(
    files: &'a [crate::git::diff::DiffFileEntry],
    path: &str,
) -> &'a crate::git::diff::DiffFileEntry {
    files
        .iter()
        .find(|entry| entry.path.to_wire_lossy() == path)
        .unwrap_or_else(|| panic!("expected a file entry for {path}, got {files:?}"))
}

// --- basic non-merge commit -------------------------------------------------

#[test]
fn show_commit_returns_the_ordinary_file_list_for_a_non_merge_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let root_sha = head_sha(repo.path());
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "second"]);
    let second_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &second_sha))
        .expect("show_commit succeeds");

    assert_eq!(result.sha, second_sha);
    assert_eq!(result.parent_sha.as_deref(), Some(root_sha.as_str()));
    assert_eq!(result.files.len(), 1);
    let entry = &result.files[0];
    assert_eq!(entry.kind, DiffStatusKind::Modified);
    assert_eq!(entry.path.to_wire_lossy(), "a.txt");
    assert_eq!(entry.added, Some(1));
    assert_eq!(entry.deleted, Some(0));
}

// --- clean merge commit: the central "--first-parent avoids a misleading
// empty diff" trap, with control groups proving the trap is real ----------

struct CleanMergeFixture {
    repo: TempDir,
    merge_sha: String,
    main_before_merge_sha: String,
}

fn build_clean_merge_fixture() -> CleanMergeFixture {
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "line1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root commit"]);
    let root_sha = head_sha(repo.path());

    std::fs::write(repo.path().join("a.txt"), "line1\nline2\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "main change"]);
    let main_before_merge_sha = head_sha(repo.path());

    raw_git_ok(
        repo.path(),
        &["checkout", "--quiet", "-b", "feature", &root_sha],
    );
    std::fs::write(repo.path().join("b.txt"), "feature line\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "feature change"]);

    raw_git_ok(repo.path(), &["checkout", "--quiet", "main"]);
    raw_git_ok(repo.path(), &["merge", "--quiet", "--no-edit", "feature"]);
    let merge_sha = head_sha(repo.path());
    assert_ne!(
        merge_sha, main_before_merge_sha,
        "the merge must actually create a new commit"
    );

    CleanMergeFixture {
        repo,
        merge_sha,
        main_before_merge_sha,
    }
}

/// Control group 1 of 2: a bare `git show --name-status` (no `--first-parent`,
/// the naive/frozen-plan-warned-against shape) on a clean merge commit is
/// misleadingly empty — proving the trap this module's own doc comment
/// describes is real, not merely asserted from the research doc.
#[test]
fn clean_merge_commit_bare_git_show_name_status_is_misleadingly_empty_without_first_parent() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let fixture = build_clean_merge_fixture();
    let output = raw_git(
        fixture.repo.path(),
        &["show", "--no-color", "--name-status", &fixture.merge_sha],
    );
    assert!(output.status.success());
    // The whole point of this control group: the combined-diff default
    // reports *zero* file-status lines for a clean merge — only the
    // human-readable commit header (which itself may start with `M` for its
    // own `Merge: <p1> <p2>` line, so this checks for a real name-status
    // record shape — a status letter immediately followed by a literal TAB —
    // rather than naively matching on leading letters).
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        !stdout
            .lines()
            .any(|line| line.starts_with(['A', 'M', 'D', 'R', 'C']) && line.contains('\t')),
        "expected the naive bare `git show` to report no file-status lines at all, got: {stdout}"
    );
}

/// Control group 2 of 2: `git diff-tree --no-commit-id --name-status -r`
/// (without `-m`) is *also* misleadingly empty for the same merge commit —
/// a second, independently-tempting-but-wrong shape someone might reach for
/// instead of `git show`.
#[test]
fn clean_merge_commit_bare_diff_tree_is_also_misleadingly_empty_without_first_parent() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let fixture = build_clean_merge_fixture();
    let output = raw_git(
        fixture.repo.path(),
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            &fixture.merge_sha,
        ],
    );
    assert!(output.status.success());
    assert!(
        output.stdout.is_empty(),
        "expected bare diff-tree (no -m) to report empty output, got: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

/// The positive case: this module's own production `show_commit` correctly
/// reports the file the merge brought in from `feature`, proving the trap
/// above has actually been avoided (not merely documented).
#[test]
fn show_commit_on_a_clean_merge_commit_shows_files_brought_in_from_the_merged_branch() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let fixture = build_clean_merge_fixture();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", fixture.repo.path(), trust_base.path());

    let result = block_on(show_commit(&trust, &workspace, "main", &fixture.merge_sha))
        .expect("show_commit succeeds for a clean merge commit");

    assert_eq!(result.sha, fixture.merge_sha);
    assert_eq!(
        result.parent_sha.as_deref(),
        Some(fixture.main_before_merge_sha.as_str()),
        "the resolved parent must be the first parent (main before merge), not the second"
    );
    assert_eq!(result.files.len(), 1, "files: {:?}", result.files);
    let entry = find_file(&result.files, "b.txt");
    assert_eq!(entry.kind, DiffStatusKind::Added);
}

// --- merge commit with a hand-resolved conflict -----------------------------

#[test]
fn show_commit_on_a_merge_commit_with_a_hand_resolved_conflict_shows_the_resolved_content() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("c.txt"), "shared line\n").unwrap();
    raw_git_ok(repo.path(), &["add", "c.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "base"]);
    let base_sha = head_sha(repo.path());

    raw_git_ok(
        repo.path(),
        &["checkout", "--quiet", "-b", "left", &base_sha],
    );
    std::fs::write(repo.path().join("c.txt"), "left change\n").unwrap();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-am", "left changes c.txt"],
    );
    let left_sha = head_sha(repo.path());

    raw_git_ok(
        repo.path(),
        &["checkout", "--quiet", "-b", "right", &base_sha],
    );
    std::fs::write(repo.path().join("c.txt"), "right change\n").unwrap();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-am", "right changes c.txt"],
    );

    raw_git_ok(repo.path(), &["checkout", "--quiet", "left"]);
    let merge_attempt = raw_git(repo.path(), &["merge", "--quiet", "--no-edit", "right"]);
    assert!(
        !merge_attempt.status.success(),
        "the merge must genuinely conflict for this fixture to be meaningful"
    );
    std::fs::write(repo.path().join("c.txt"), "resolved by hand\n").unwrap();
    raw_git_ok(repo.path(), &["add", "c.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "resolve conflict by hand"],
    );
    let merge_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &merge_sha))
        .expect("show_commit succeeds for a conflict-resolution merge commit");

    assert_eq!(result.parent_sha.as_deref(), Some(left_sha.as_str()));
    assert_eq!(result.files.len(), 1);
    let entry = find_file(&result.files, "c.txt");
    assert_eq!(entry.kind, DiffStatusKind::Modified);
    assert_eq!(entry.added, Some(1));
    assert_eq!(entry.deleted, Some(1));

    let modified_content = block_on(show_commit_blob(
        &trust, &workspace, "main", &merge_sha, "c.txt",
    ))
    .expect("show_commit_blob succeeds")
    .expect("c.txt exists at the merge commit");
    assert_eq!(modified_content, b"resolved by hand\n");
}

// --- initial (root) commit --------------------------------------------------

#[test]
fn show_commit_on_the_root_commit_has_no_parent_and_reports_every_file_as_added() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "root content\n").unwrap();
    std::fs::write(repo.path().join("b.txt"), "also root content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root commit"]);
    let root_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &root_sha))
        .expect("show_commit succeeds for the root commit");

    assert_eq!(result.parent_sha, None);
    assert_eq!(result.files.len(), 2);
    assert!(result
        .files
        .iter()
        .all(|entry| entry.kind == DiffStatusKind::Added));
}

/// `resolve_first_parent` in isolation, confirming `None` for a root commit —
/// the direct evidence for the claim above, not merely inferred from
/// `show_commit`'s own aggregate result.
#[test]
fn resolve_first_parent_returns_none_for_a_root_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "x\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let root_sha = head_sha(repo.path());

    let parent = block_on(resolve_first_parent(repo.path(), &root_sha))
        .expect("resolve_first_parent succeeds");
    assert_eq!(parent, None);
}

#[test]
fn resolve_first_parent_returns_the_first_parent_of_a_merge_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let fixture = build_clean_merge_fixture();
    let parent = block_on(resolve_first_parent(
        fixture.repo.path(),
        &fixture.merge_sha,
    ))
    .expect("resolve_first_parent succeeds");
    assert_eq!(
        parent.as_deref(),
        Some(fixture.main_before_merge_sha.as_str())
    );
}

// --- rename / copy records ---------------------------------------------------

#[test]
fn show_commit_reports_a_rename_record() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("old.txt"), "unchanged content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "old.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    raw_git_ok(repo.path(), &["mv", "old.txt", "new.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "rename"]);
    let rename_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &rename_sha))
        .expect("show_commit succeeds");

    assert_eq!(result.files.len(), 1);
    let entry = &result.files[0];
    assert_eq!(entry.kind, DiffStatusKind::Renamed);
    assert_eq!(entry.path.to_wire_lossy(), "new.txt");
    assert_eq!(
        entry.orig_path.as_ref().map(|path| path.to_wire_lossy()),
        Some("old.txt".to_owned())
    );
    assert_eq!(entry.similarity, Some(100));
}

/// Proves `--find-copies-harder` (not just `-C`) is genuinely required: a
/// control group first shows plain `-M -C` (no `--find-copies-harder`) does
/// **not** detect the copy even though the copy is byte-for-byte identical
/// to an existing, unmodified file — git's non-"harder" copy heuristic only
/// ever considers files *also modified in the same commit* as candidate
/// copy sources, and `source.txt` here is untouched. The production
/// function, which does add `--find-copies-harder` (a bounded, one-off-
/// per-commit-detail-request cost — see `show_commit.rs`'s own module doc
/// comment for why this differs from the live working-tree diff's cheaper
/// `-M`-only args), correctly reports it as `Copied`.
#[test]
fn show_commit_reports_a_copy_record_that_requires_find_copies_harder_to_detect_at_all() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("source.txt"), "line1\nline2\nline3\n").unwrap();
    raw_git_ok(repo.path(), &["add", "source.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let seed_sha = head_sha(repo.path());

    // `copy.txt` is an exact duplicate of `source.txt`, which is itself
    // untouched by this commit — the case git's own copy detection only
    // recognizes when `--find-copies-harder` is given (see the control-group
    // assertion below for the proof it is genuinely required here).
    std::fs::copy(repo.path().join("source.txt"), repo.path().join("copy.txt")).unwrap();
    raw_git_ok(repo.path(), &["add", "copy.txt"]);
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "add a copy, source untouched"],
    );
    let copy_sha = head_sha(repo.path());

    // Control group: the plain `-M -C` shape (no `--find-copies-harder`)
    // does NOT recognize this as a copy — it reports a plain `A copy.txt`,
    // never a `C` record, even though the content is identical.
    let control = raw_git(
        repo.path(),
        &[
            "diff",
            "--no-color",
            "-M",
            "-C",
            "--no-textconv",
            "--no-ext-diff",
            "--name-status",
            &seed_sha,
            &copy_sha,
        ],
    );
    assert!(control.status.success());
    let control_stdout = String::from_utf8_lossy(&control.stdout);
    assert!(
        !control_stdout.contains('C'),
        "expected plain -M -C (no --find-copies-harder) to miss the copy, got: {control_stdout}"
    );
    assert!(control_stdout.contains("A\tcopy.txt"));

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_commit(&trust, &workspace, "main", &copy_sha)).expect("show_commit succeeds");
    let copy_entry = find_file(&result.files, "copy.txt");
    assert_eq!(
        copy_entry.kind,
        DiffStatusKind::Copied,
        "production show_commit (which adds --find-copies-harder) must detect the copy \
         the control group above proved plain -M -C misses; files: {:?}",
        result.files
    );
    assert_eq!(
        copy_entry
            .orig_path
            .as_ref()
            .map(|path| path.to_wire_lossy()),
        Some("source.txt".to_owned())
    );
    assert_eq!(copy_entry.similarity, Some(100));
}

// --- tricky filenames: quotes/spaces/non-ASCII/literal LF -------------------

#[test]
fn show_commit_handles_filenames_with_quotes_spaces_and_non_ascii() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );
    let seed_sha = head_sha(repo.path());
    let names = ["a \"quoted\" file.txt", "space name.txt", "非ASCII文件.txt"];
    for name in names {
        std::fs::write(repo.path().join(name), "hello\n").unwrap();
        raw_git_ok(repo.path(), &["add", "--", name]);
    }
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "-m", "special filenames"],
    );
    let special_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &special_sha))
        .expect("show_commit succeeds");

    assert_eq!(result.parent_sha.as_deref(), Some(seed_sha.as_str()));
    assert_eq!(result.files.len(), names.len());
    for name in names {
        let entry = find_file(&result.files, name);
        assert_eq!(entry.kind, DiffStatusKind::Added);
    }
}

#[test]
fn show_commit_handles_a_filename_with_a_literal_line_feed() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );
    let seed_sha = head_sha(repo.path());
    // Confirmed constructible without any raw-byte `OsStr` trick — see
    // `blame.rs`'s own disclosed correction of the earlier (wrong)
    // "platform cannot construct this" assumption.
    let name = "literal\nlf.txt";
    std::fs::write(repo.path().join(name), "hello\n").unwrap();
    raw_git_ok(repo.path(), &["add", "--", name]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "lf-named file"]);
    let lf_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_commit(&trust, &workspace, "main", &lf_sha)).expect("show_commit succeeds");

    assert_eq!(result.parent_sha.as_deref(), Some(seed_sha.as_str()));
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path.to_wire_lossy(), name);
}

// --- binary file -------------------------------------------------------------

#[test]
fn show_commit_reports_a_binary_file_as_binary_with_no_added_deleted_counts() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );
    let seed_sha = head_sha(repo.path());
    std::fs::write(
        repo.path().join("bin.dat"),
        [0u8, 1, 2, 0xff, 0xfe, 0, b'b', b'i', b'n'],
    )
    .unwrap();
    raw_git_ok(repo.path(), &["add", "bin.dat"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "add binary file"]);
    let bin_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result =
        block_on(show_commit(&trust, &workspace, "main", &bin_sha)).expect("show_commit succeeds");

    assert_eq!(result.parent_sha.as_deref(), Some(seed_sha.as_str()));
    assert_eq!(result.files.len(), 1);
    let entry = &result.files[0];
    assert_eq!(entry.kind, DiffStatusKind::Added);
    assert!(entry.binary);
    assert_eq!(entry.added, None);
    assert_eq!(entry.deleted, None);
}

// --- genuinely empty diff (`--allow-empty`), distinguished from the
// missing-`--first-parent` false-empty trap --------------------------------

#[test]
fn show_commit_on_a_truly_empty_allow_empty_commit_reports_zero_files() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let seed_sha = head_sha(repo.path());
    raw_git_ok(
        repo.path(),
        &[
            "commit",
            "--quiet",
            "--allow-empty",
            "-m",
            "truly empty commit",
        ],
    );
    let empty_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(show_commit(&trust, &workspace, "main", &empty_sha))
        .expect("show_commit succeeds for a truly empty commit");

    assert_eq!(result.parent_sha.as_deref(), Some(seed_sha.as_str()));
    assert!(
        result.files.is_empty(),
        "a real --allow-empty commit must report zero changed files: {:?}",
        result.files
    );
}

// --- rejections: malformed sha, non-commit object, nonexistent sha ---------

#[test]
fn show_commit_rejects_a_malformed_sha_before_touching_git() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    for bad_sha in [
        "short",
        &"a".repeat(41),
        &"g".repeat(40),
        &"A".repeat(40), // uppercase hex is not accepted — lowercase only
        "",
    ] {
        let error = block_on(show_commit(&trust, &workspace, "main", bad_sha))
            .expect_err("a malformed sha must be rejected");
        assert_eq!(error.code(), "GIT_SHOW_COMMIT_INVALID_SHA");
    }
}

#[test]
fn show_commit_rejects_a_sha_that_names_a_real_blob_not_a_commit() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let blob_sha_output = raw_git(repo.path(), &["hash-object", "a.txt"]);
    assert!(blob_sha_output.status.success());
    let blob_sha = String::from_utf8(blob_sha_output.stdout)
        .unwrap()
        .trim()
        .to_owned();
    assert!(is_lowercase_hex40(blob_sha.as_bytes()));

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(show_commit(&trust, &workspace, "main", &blob_sha))
        .expect_err("a blob sha must be rejected as not-a-commit");
    assert_eq!(error.code(), "GIT_SHOW_COMMIT_NOT_FOUND");
}

#[test]
fn show_commit_rejects_a_nonexistent_sha() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let nonexistent_sha = "0123456789abcdef0123456789abcdef01234567";
    let error = block_on(show_commit(&trust, &workspace, "main", nonexistent_sha))
        .expect_err("a nonexistent sha must be rejected");
    assert_eq!(error.code(), "GIT_SHOW_COMMIT_NOT_FOUND");
}

#[test]
fn show_commit_rejects_an_untrusted_workspace() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "seed"],
    );
    let seed_sha = head_sha(repo.path());

    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    // Deliberately never granted.

    let error = block_on(show_commit(&trust, &workspace, "main", &seed_sha))
        .expect_err("untrusted workspace is rejected");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- show_commit_blob --------------------------------------------------------

#[test]
fn show_commit_blob_reads_content_at_the_commit_and_at_its_resolved_parent() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "before\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "before"]);
    let before_sha = head_sha(repo.path());
    std::fs::write(repo.path().join("a.txt"), "after\n").unwrap();
    raw_git_ok(repo.path(), &["commit", "--quiet", "-am", "after"]);
    let after_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let modified = block_on(show_commit_blob(
        &trust, &workspace, "main", &after_sha, "a.txt",
    ))
    .expect("show_commit_blob succeeds")
    .expect("content exists at the commit itself");
    assert_eq!(modified, b"after\n");

    let original = block_on(show_commit_blob(
        &trust,
        &workspace,
        "main",
        &before_sha,
        "a.txt",
    ))
    .expect("show_commit_blob succeeds")
    .expect("content exists at the parent commit");
    assert_eq!(original, b"before\n");
}

#[test]
fn show_commit_blob_returns_none_for_a_path_absent_at_that_revision() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "seed"]);
    let seed_sha = head_sha(repo.path());

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let content = block_on(show_commit_blob(
        &trust,
        &workspace,
        "main",
        &seed_sha,
        "never-existed.txt",
    ))
    .expect("show_commit_blob succeeds (not-found is not an error)");
    assert_eq!(content, None);
}

// --- defensive, redundant with the AST contract: never spawn `git show` ----

#[test]
fn git_show_commit_diff_base_args_never_contains_the_show_subcommand_token() {
    assert!(
        !GIT_SHOW_COMMIT_DIFF_BASE_ARGS.contains(&"show"),
        "show_commit.rs must never spawn `git show` for the file list — see this \
         module's own doc comment for why (mixed header + NUL-record output)"
    );
    assert_eq!(GIT_SHOW_COMMIT_DIFF_BASE_ARGS[0], "diff");
}

#[test]
fn empty_tree_sha_is_gits_own_well_known_constant() {
    assert_eq!(EMPTY_TREE_SHA, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    assert_eq!(EMPTY_TREE_SHA.len(), 40);
    assert!(is_lowercase_hex40(EMPTY_TREE_SHA.as_bytes()));
}
