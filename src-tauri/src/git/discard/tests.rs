//! `git::discard` contract tests (`F080` S3). Every fixture spawns a real
//! `git` binary.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::discard_paths;
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

#[test]
fn discard_paths_restores_a_modified_files_original_content() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "original\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "changed\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["a.txt".to_owned()],
    ))
    .expect("discard_paths succeeds");

    let content = std::fs::read_to_string(repo.path().join("a.txt")).unwrap();
    assert_eq!(content, "original\n");
}

#[test]
fn discard_paths_restores_a_path_with_spaces_non_ascii_and_a_leading_dash() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let names = ["path with spaces.txt", "café-日本語.txt", "-dash.txt"];
    for name in names {
        std::fs::write(repo.path().join(name), "original\n").unwrap();
    }
    raw_git_ok(repo.path(), &["add", "."]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    for name in names {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let path_args: Vec<String> = names.iter().map(|name| (*name).to_owned()).collect();
    block_on(discard_paths(&trust, &workspace, "main", &path_args))
        .expect("discard_paths succeeds for all three paths");

    for name in names {
        let content = std::fs::read_to_string(repo.path().join(name)).unwrap();
        assert_eq!(content, "original\n", "expected {name} restored");
    }
}

/// Empirically confirmed (this slice's own report): `git checkout -q --
/// <paths...>` validates every pathspec before touching any of them. A batch
/// containing one untracked path (which has no index/HEAD version to
/// restore from) fails atomically — none of the paths, including the
/// perfectly valid ones in the same batch, are touched.
#[test]
fn discard_paths_is_all_or_nothing_when_one_path_is_untracked() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "original\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    std::fs::write(repo.path().join("a.txt"), "changed\n").unwrap();
    std::fs::write(repo.path().join("untracked.txt"), "new\n").unwrap();

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["a.txt".to_owned(), "untracked.txt".to_owned()],
    ))
    .expect_err("a batch containing an untracked path must fail");
    assert_eq!(error.code(), "GIT_DISCARD_FAILED");

    let content = std::fs::read_to_string(repo.path().join("a.txt")).unwrap();
    assert_eq!(
        content, "changed\n",
        "a.txt must be untouched when the batch as a whole fails"
    );
}

#[test]
fn discard_paths_rejects_an_empty_path_list() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(discard_paths(&trust, &workspace, "main", &[]))
        .expect_err("empty path list must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

#[test]
fn discard_paths_rejects_a_path_traversal_segment() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let error = block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["../outside.txt".to_owned()],
    ))
    .expect_err("path traversal must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

// ---------------------------------------------------------------------
// Pathspec-glob-expansion regression (fix for the highest-severity data-loss
// defect found in review): `--` only stops *option* parsing, never git's own
// pathspec-magic glob expansion, so a bare, unhardened `git checkout -q --
// 'a*.txt'` reverts every sibling file whose name happens to match the
// glob, not just the literally-named file the UI showed/confirmed. Each
// test below has its own control (a bare, unhardened invocation identical
// in shape to `GIT_DISCARD_ARGS` but without `GIT_LITERAL_PATHSPECS=1`)
// proving the vulnerability is real, then proves `discard_paths` (which
// goes through `exec::apply_universal_hardening`) reverts only the
// literally-named target.
// ---------------------------------------------------------------------

#[test]
fn discard_paths_reverts_only_the_literal_star_named_file_not_wildcard_siblings() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        std::fs::write(repo.path().join(name), "orig\n").unwrap();
    }
    raw_git_ok(repo.path(), &["add", "a1.txt", "a2.txt", "a*.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    // Control: a bare, unhardened `git checkout -q -- 'a*.txt'` — the exact
    // shape of GIT_DISCARD_ARGS, minus GIT_LITERAL_PATHSPECS=1 — reverts
    // ALL THREE files, proving the vulnerability is real absent the fix.
    raw_git_ok(repo.path(), &["checkout", "-q", "--", "a*.txt"]);
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        assert_eq!(
            std::fs::read_to_string(repo.path().join(name)).unwrap(),
            "orig\n",
            "control: {name} must ALSO revert absent GIT_LITERAL_PATHSPECS, proving the \
             vulnerability is real"
        );
    }

    // Re-dirty all three for the hardened run through the real production
    // code path.
    for name in ["a1.txt", "a2.txt", "a*.txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["a*.txt".to_owned()],
    ))
    .expect("discard_paths succeeds for the literal glob-named file");

    assert_eq!(
        std::fs::read_to_string(repo.path().join("a*.txt")).unwrap(),
        "orig\n",
        "the literally-named target must revert"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a1.txt")).unwrap(),
        "changed\n",
        "sibling a1.txt must SURVIVE — this is the fix under test"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("a2.txt")).unwrap(),
        "changed\n",
        "sibling a2.txt must SURVIVE — this is the fix under test"
    );
}

#[test]
fn discard_paths_reverts_only_the_literal_question_mark_named_file_not_wildcard_siblings() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    for name in ["b1.txt", "b2.txt", "b?.txt"] {
        std::fs::write(repo.path().join(name), "orig\n").unwrap();
    }
    raw_git_ok(repo.path(), &["add", "b1.txt", "b2.txt", "b?.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    for name in ["b1.txt", "b2.txt", "b?.txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    // Control: `?` matches exactly one arbitrary character as pathspec
    // glob-magic, so `b1.txt`/`b2.txt` both match the pattern `b?.txt` —
    // proving the vulnerability is real for this wildcard character too.
    raw_git_ok(repo.path(), &["checkout", "-q", "--", "b?.txt"]);
    for name in ["b1.txt", "b2.txt", "b?.txt"] {
        assert_eq!(
            std::fs::read_to_string(repo.path().join(name)).unwrap(),
            "orig\n",
            "control: {name} must ALSO revert absent GIT_LITERAL_PATHSPECS, proving the \
             vulnerability is real"
        );
    }

    for name in ["b1.txt", "b2.txt", "b?.txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["b?.txt".to_owned()],
    ))
    .expect("discard_paths succeeds for the literal glob-named file");

    assert_eq!(
        std::fs::read_to_string(repo.path().join("b?.txt")).unwrap(),
        "orig\n",
        "the literally-named target must revert"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("b1.txt")).unwrap(),
        "changed\n",
        "sibling b1.txt must SURVIVE — this is the fix under test"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("b2.txt")).unwrap(),
        "changed\n",
        "sibling b2.txt must SURVIVE — this is the fix under test"
    );
}

#[test]
fn discard_paths_reverts_only_the_literal_bracket_named_file_not_a_wildcard_sibling() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    // The pathspec-magic glob character class `[x]` matches exactly the
    // single character `x` — so the *literal* filename `c[x].txt` and a
    // sibling literally named `cx.txt` are the pair that demonstrates
    // collateral damage for `[`, confirmed empirically (this slice's
    // report): `git checkout -q -- 'c[x].txt'` unhardened reverts both.
    for name in ["cx.txt", "c[x].txt"] {
        std::fs::write(repo.path().join(name), "orig\n").unwrap();
    }
    raw_git_ok(repo.path(), &["add", "cx.txt", "c[x].txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    for name in ["cx.txt", "c[x].txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    // Control.
    raw_git_ok(repo.path(), &["checkout", "-q", "--", "c[x].txt"]);
    for name in ["cx.txt", "c[x].txt"] {
        assert_eq!(
            std::fs::read_to_string(repo.path().join(name)).unwrap(),
            "orig\n",
            "control: {name} must ALSO revert absent GIT_LITERAL_PATHSPECS, proving the \
             vulnerability is real"
        );
    }

    for name in ["cx.txt", "c[x].txt"] {
        std::fs::write(repo.path().join(name), "changed\n").unwrap();
    }

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["c[x].txt".to_owned()],
    ))
    .expect("discard_paths succeeds for the literal glob-named file");

    assert_eq!(
        std::fs::read_to_string(repo.path().join("c[x].txt")).unwrap(),
        "orig\n",
        "the literally-named target must revert"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("cx.txt")).unwrap(),
        "changed\n",
        "sibling cx.txt must SURVIVE — this is the fix under test"
    );
}

#[test]
fn discard_paths_rejects_when_workspace_is_not_trusted() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(discard_paths(
        &trust,
        &workspace,
        "main",
        &["a.txt".to_owned()],
    ))
    .expect_err("untrusted workspace must reject discard_paths");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}
