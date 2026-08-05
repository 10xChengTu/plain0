//! `git::stage` contract tests (`F080` S3) — every fixture spawns a real
//! `git` binary and inspects real `git status`/`ls-files`/`show` output,
//! mirroring `status/tests.rs`'s/`diff/tests.rs`'s own "never a hand-typed
//! fixture" discipline. [`stage_blob_partially_stages_a_file_and_status_reports_mm`]
//! is this slice's single most important piece of evidence: it proves the
//! hunk-level `hash-object`/`update-index` path leaves a file genuinely
//! *partially* staged, which is the whole point of not reusing whole-file
//! `git add`.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{stage_blob, stage_paths, unstage_paths};
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

fn raw_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns")
}

fn raw_git_ok(dir: &Path, args: &[&str]) {
    let output = raw_git(dir, args);
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

/// `-z` is essential here (not just for the real product parser): without it
/// git's default `core.quotePath` behavior octal-escapes and quotes non-ASCII
/// path bytes (confirmed empirically — see
/// `docs/research/2026-07-25-core-git.md`'s S1 notes), which would make this
/// fixture's own plain-substring assertions against a literal non-ASCII path
/// fail for a reason that has nothing to do with `git::stage` itself.
fn porcelain_status(dir: &Path) -> String {
    let output = raw_git(dir, &["status", "--porcelain=v2", "-z", "--branch"]);
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn stage_paths_stages_a_modified_file() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "two\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["a.txt".to_owned()],
    ))
    .expect("stage_paths succeeds");

    let status = porcelain_status(repo.path());
    assert!(
        status.contains("1 M. "),
        "expected a fully staged modification, got: {status}"
    );
}

#[test]
fn unstage_paths_reverses_a_staged_addition() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    std::fs::write(repo.path().join("new.txt"), "content\n").unwrap();
    raw_git_ok(repo.path(), &["add", "new.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(unstage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["new.txt".to_owned()],
    ))
    .expect("unstage_paths succeeds");

    let status = porcelain_status(repo.path());
    assert!(
        status.contains("? new.txt"),
        "expected new.txt back to untracked, got: {status}"
    );
}

#[test]
fn stage_paths_rejects_an_empty_path_list() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &[],
    ))
    .expect_err("empty path list must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

#[test]
fn stage_paths_rejects_a_path_traversal_segment() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["../outside.txt".to_owned()],
    ))
    .expect_err("path traversal must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

#[test]
fn stage_paths_rejects_an_absolute_path() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["/etc/passwd".to_owned()],
    ))
    .expect_err("an absolute path must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

#[test]
fn stage_paths_stages_paths_with_spaces_non_ascii_and_a_leading_dash() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    let names = ["path with spaces.txt", "café-日本語.txt", "-dash.txt"];
    for name in names {
        std::fs::write(repo.path().join(name), "content\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let path_args: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &path_args,
    ))
    .expect("stage_paths succeeds for all three paths");

    let status = porcelain_status(repo.path());
    for name in names {
        assert!(
            status.contains(name),
            "expected {name} staged, got: {status}"
        );
    }
    assert!(
        !status.split('\0').any(|record| record.starts_with('?')),
        "nothing should remain untracked: {status}"
    );
}

// ---------------------------------------------------------------------
// Pathspec-glob-expansion regression (same fix/defect class as
// `discard::tests`'s glob tests): `--` only stops *option* parsing, never
// git's own pathspec-magic glob expansion, so an unhardened `git add -A --
// 'a*.txt'`/`git reset -q -- 'a*.txt'` would silently touch every sibling
// file whose name happens to match the glob too. `stage_paths`/
// `unstage_paths` go through `exec::apply_universal_hardening`
// (`GIT_LITERAL_PATHSPECS=1`), so only the literally-named target is
// affected.
// ---------------------------------------------------------------------

#[test]
fn stage_paths_stages_only_the_literal_glob_named_file_not_wildcard_siblings() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        std::fs::write(repo.path().join(name), "content\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["a*.txt".to_owned()],
    ))
    .expect("stage_paths succeeds for the literal glob-named file");

    let status = porcelain_status(repo.path());
    assert!(
        status
            .split('\0')
            .any(|record| record.starts_with("1 A.") && record.ends_with("a*.txt")),
        "expected a*.txt staged as an addition, got: {status}"
    );
    for name in ["a1.txt", "a2.txt"] {
        assert!(
            status.contains(&format!("? {name}")),
            "expected {name} to remain untracked (unstaged) — a wildcard-matching sibling must \
             never be silently staged, got: {status}"
        );
    }
}

#[test]
fn unstage_paths_unstages_only_the_literal_glob_named_file_not_wildcard_siblings() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        std::fs::write(repo.path().join(name), "content\n").unwrap();
    }
    raw_git_ok(repo.path(), &["add", "a1.txt", "a2.txt", "a*.txt"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(unstage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["a*.txt".to_owned()],
    ))
    .expect("unstage_paths succeeds for the literal glob-named file");

    let status = porcelain_status(repo.path());
    assert!(
        status.contains("? a*.txt"),
        "expected a*.txt back to untracked, got: {status}"
    );
    for name in ["a1.txt", "a2.txt"] {
        assert!(
            status
                .split('\0')
                .any(|record| record.starts_with("1 A.") && record.ends_with(name)),
            "expected {name} to remain staged — a wildcard-matching sibling must never be \
             silently unstaged, got: {status}"
        );
    }
}

/// `resolve_blob_mode`'s `git ls-files -s -- <path>` call is exactly the
/// same pathspec-glob-expansion defect class: proves it would resolve the
/// WRONG file's mode when unpatched. `b1.txt` (executable, mode `100755`)
/// sorts *before* the literal target `b?.txt` (regular, mode `100644`) in
/// git's own path ordering (`'1'` is `0x31`, `'?'` is `0x3F`), so an
/// unhardened `ls-files -s -- 'b?.txt'` — which pathspec-glob-matches both
/// files, since `?` matches any single character including a literal `?` —
/// lists the executable sibling's entry *first*; `resolve_blob_mode` only
/// ever reads the first line, so it would observably resolve mode `100755`
/// for a target that is actually `100644`.
#[test]
fn control_unhardened_ls_files_glob_matches_multiple_files_and_lists_the_wrong_one_first() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let exec_path = repo.path().join("b1.txt");
    std::fs::write(&exec_path, "exec\n").unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&exec_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&exec_path, perms).unwrap();
    }
    std::fs::write(repo.path().join("b?.txt"), "regular\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b1.txt", "b?.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    // Control: a bare, unhardened `git ls-files -s -- 'b?.txt'` (the exact
    // shape `resolve_blob_mode` uses, minus GIT_LITERAL_PATHSPECS) matches
    // BOTH files via glob-magic, listing the executable sibling first.
    let output = raw_git(repo.path(), &["ls-files", "-s", "--", "b?.txt"]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(
        lines.len(),
        2,
        "control: pathspec glob-magic must match both files, proving the vulnerability is \
         real: {stdout}"
    );
    assert!(
        lines[0].starts_with("100755"),
        "control: the executable sibling must sort/appear first, proving resolve_blob_mode \
         would read its mode instead of the target's own: {stdout}"
    );
}

/// The hardened contrast to the control above: `stage_blob`'s
/// `resolve_blob_mode` must resolve `b?.txt`'s own (non-executable) mode
/// despite the executable, glob-matching `b1.txt` sibling sorting first in
/// an unhardened listing.
#[test]
fn stage_blob_resolves_the_correct_mode_for_a_glob_named_path_despite_an_executable_sibling() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let exec_path = repo.path().join("b1.txt");
    std::fs::write(&exec_path, "exec\n").unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&exec_path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&exec_path, perms).unwrap();
    }
    std::fs::write(repo.path().join("b?.txt"), "regular\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b1.txt", "b?.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(stage_blob(
        &trust,
        &workspace,
        "main",
        "b?.txt",
        b"new content\n".to_vec(),
    ))
    .expect("stage_blob succeeds for the literal glob-named file");

    // Query the *whole* index (not a pathspec-restricted query, so this
    // verification step itself is not subject to the same glob-matching
    // ambiguity) and find the exact entry for `b?.txt` by its unique
    // filename suffix.
    let ls_all = raw_git(repo.path(), &["ls-files", "-s"]);
    let ls_output = String::from_utf8_lossy(&ls_all.stdout);
    let target_line = ls_output
        .lines()
        .find(|line| line.ends_with("b?.txt"))
        .expect("b?.txt entry present in the index");
    assert!(
        target_line.starts_with("100644"),
        "expected the literal target's own (non-executable) mode to be preserved despite an \
         executable glob-matching sibling, got: {target_line}"
    );
}

/// The core evidence this slice's report is built around: a hunk-level
/// `stage_blob` call (`hash-object` + `update-index`) leaves the file
/// **partially** staged — `git status` must report it with a non-`.`
/// character on *both* the index and worktree axes (an `MM`-shaped ordinary
/// entry), because only part of the on-disk change was written into the
/// index.
#[test]
fn stage_blob_partially_stages_a_file_and_status_reports_mm() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    // Working tree now differs from HEAD/index in two independent hunks.
    std::fs::write(repo.path().join("a.txt"), "ONE\ntwo\nTHREE\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    // Stage only a hand-crafted "first hunk applied" content — line 1
    // changed, line 3 left as the original ("three\n") — simulating what the
    // frontend's Monaco-diff-driven hunk selection computes for "stage just
    // the first hunk".
    block_on(stage_blob(
        &trust,
        &workspace,
        "main",
        "a.txt",
        b"ONE\ntwo\nthree\n".to_vec(),
    ))
    .expect("stage_blob succeeds");

    let status = porcelain_status(repo.path());
    assert!(
        status.contains("1 MM "),
        "expected a partially staged (MM) file, got: {status}"
    );

    // The index's blob must be exactly the hand-crafted partial content, not
    // the full on-disk content.
    let show_output = raw_git(repo.path(), &["show", ":a.txt"]);
    assert_eq!(
        String::from_utf8_lossy(&show_output.stdout),
        "ONE\ntwo\nthree\n"
    );
    // The working tree file itself must be completely untouched.
    let worktree_content = std::fs::read_to_string(repo.path().join("a.txt")).unwrap();
    assert_eq!(worktree_content, "ONE\ntwo\nTHREE\n");
}

#[test]
fn stage_blob_stages_a_brand_new_file_with_the_default_mode() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--allow-empty", "-m", "init"],
    );
    std::fs::write(repo.path().join("brand-new.txt"), "hello\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(stage_blob(
        &trust,
        &workspace,
        "main",
        "brand-new.txt",
        b"hello\n".to_vec(),
    ))
    .expect("stage_blob succeeds for a brand-new file");

    let ls_files = raw_git(repo.path(), &["ls-files", "-s", "--", "brand-new.txt"]);
    let ls_output = String::from_utf8_lossy(&ls_files.stdout);
    assert!(
        ls_output.starts_with("100644 "),
        "expected default 100644 mode, got: {ls_output}"
    );
}

#[test]
fn stage_blob_preserves_an_existing_executable_mode() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    use std::os::unix::fs::PermissionsExt;

    let repo = init_repo();
    let script_path = repo.path().join("run.sh");
    std::fs::write(&script_path, "#!/bin/sh\necho one\n").unwrap();
    let mut perms = std::fs::metadata(&script_path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script_path, perms).unwrap();
    raw_git_ok(repo.path(), &["add", "run.sh"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(&script_path, "#!/bin/sh\necho two\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(stage_blob(
        &trust,
        &workspace,
        "main",
        "run.sh",
        b"#!/bin/sh\necho two\n".to_vec(),
    ))
    .expect("stage_blob succeeds");

    let ls_files = raw_git(repo.path(), &["ls-files", "-s", "--", "run.sh"]);
    let ls_output = String::from_utf8_lossy(&ls_files.stdout);
    assert!(
        ls_output.starts_with("100755 "),
        "expected the executable mode to be preserved, got: {ls_output}"
    );
}

#[test]
fn stage_blob_rejects_content_over_the_size_limit() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let oversized = vec![b'a'; 8 * 1024 * 1024 + 1];
    let error = block_on(stage_blob(&trust, &workspace, "main", "a.txt", oversized))
        .expect_err("oversized content must be rejected");
    assert_eq!(error.code(), "GIT_STAGE_BLOB_CONTENT_TOO_LARGE");
}

#[test]
fn stage_blob_rejects_an_empty_path() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(stage_blob(
        &trust,
        &workspace,
        "main",
        "",
        b"content".to_vec(),
    ))
    .expect_err("empty path must be rejected");
    assert_eq!(error.code(), "GIT_STAGE_BLOB_INVALID_PATH");
}

#[test]
fn stage_and_unstage_reject_when_workspace_is_not_trusted() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let stage_error = block_on(stage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["a.txt".to_owned()],
    ))
    .expect_err("untrusted workspace must reject stage_paths");
    assert_eq!(stage_error.code(), "WORKSPACE_NOT_TRUSTED");

    let unstage_error = block_on(unstage_paths(
        &trust,
        &workspace,
        &GitNetworkService::new(),
        &RemoteSessionService::new(std::env::temp_dir()),
        "main",
        &["a.txt".to_owned()],
    ))
    .expect_err("untrusted workspace must reject unstage_paths");
    assert_eq!(unstage_error.code(), "WORKSPACE_NOT_TRUSTED");
}
