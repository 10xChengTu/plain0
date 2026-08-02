//! `git::network` contract tests (`F080` S4). Every fixture spawns a real
//! `git` binary and uses a real local `git init --bare` directory standing
//! in for "the remote" — fetch/pull/push are exercised end to end through
//! real porcelain behavior with **zero network access**, per this slice's
//! explicit testing constraint. `exec::tests::network_mode_fixtures` covers
//! the lower-level exec-hardening evidence (SSH agent passthrough, askpass/
//! credential precedence, hook passthrough, timeout/cancellation); this file
//! covers `network::preview`/`fetch`/`pull`/`push`'s own porcelain-level
//! correctness and error mapping.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{fetch, preview, pull, push, GitNetworkService, NetworkOperation, NetworkPreview};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

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

/// A real, local `git init --bare` directory standing in for "the remote" —
/// this domain's own tests must never touch the network (task requirement),
/// so every fetch/pull/push fixture below points `origin` at one of these
/// instead of a real hosted remote. Cloning/pushing/pulling against a local
/// filesystem path exercises the exact same porcelain code paths (refspecs,
/// ahead/behind, fast-forward/non-fast-forward, `--force-with-lease`) a real
/// `https://`/`ssh://` remote would.
fn init_bare_remote() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    raw_git_ok(dir.path(), &["init", "--quiet", "--bare", "-b", "main"]);
    dir
}

/// Creates a local repo with one commit, adds `origin` pointing at a fresh
/// local bare remote, and pushes+sets-upstream so `@{upstream}` resolves —
/// the common starting point most tests below build on.
fn repo_synced_with_a_bare_remote() -> (TempDir, TempDir) {
    let remote = init_bare_remote();
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    raw_git_ok(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            remote.path().to_str().expect("utf8 tempdir path"),
        ],
    );
    raw_git_ok(
        repo.path(),
        &["push", "--quiet", "-u", "origin", "HEAD:refs/heads/main"],
    );
    (repo, remote)
}

/// Clones `remote` into a second, independent working copy — used to push
/// changes to the shared bare remote "from someone else" without touching
/// the original `repo` fixture directly, mirroring real multi-clone
/// divergence.
fn clone_bare_remote(remote: &Path) -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    raw_git_ok(
        &std::env::temp_dir(),
        &[
            "clone",
            "--quiet",
            remote.to_str().expect("utf8 path"),
            dir.path().to_str().expect("utf8 path"),
        ],
    );
    raw_git_ok(
        dir.path(),
        &["config", "user.email", "plain-test-other@example.invalid"],
    );
    raw_git_ok(dir.path(), &["config", "user.name", "Plain Test Other"]);
    dir
}

// --- preview -------------------------------------------------------------

#[test]
fn preview_reports_no_upstream_data_for_fetch_when_none_is_configured() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let result = block_on(preview(&trust, &workspace, "main", NetworkOperation::Fetch))
        .expect("fetch preview succeeds even with no upstream configured");
    assert_eq!(
        result,
        NetworkPreview {
            upstream: None,
            ahead: None,
            behind: None,
        }
    );
}

#[test]
fn preview_rejects_pull_and_push_when_no_upstream_is_configured() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    let pull_error = block_on(preview(&trust, &workspace, "main", NetworkOperation::Pull))
        .expect_err("pull preview must fail closed without an upstream");
    assert_eq!(pull_error.code(), "GIT_NETWORK_NO_UPSTREAM");
    let push_error = block_on(preview(&trust, &workspace, "main", NetworkOperation::Push))
        .expect_err("push preview must fail closed without an upstream");
    assert_eq!(push_error.code(), "GIT_NETWORK_NO_UPSTREAM");
}

#[test]
fn preview_reports_zero_ahead_zero_behind_when_in_sync() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, _remote) = repo_synced_with_a_bare_remote();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());

    for operation in [
        NetworkOperation::Fetch,
        NetworkOperation::Pull,
        NetworkOperation::Push,
    ] {
        let result = block_on(preview(&trust, &workspace, "main", operation))
            .expect("preview succeeds once in sync with a configured upstream");
        assert_eq!(result.upstream.as_deref(), Some("origin/main"));
        assert_eq!(result.ahead, Some(0));
        assert_eq!(result.behind, Some(0));
    }
}

#[test]
fn preview_reports_ahead_after_local_commits() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, _remote) = repo_synced_with_a_bare_remote();
    std::fs::write(repo.path().join("b.txt"), "two\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "second"]);
    std::fs::write(repo.path().join("c.txt"), "three\n").unwrap();
    raw_git_ok(repo.path(), &["add", "c.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "third"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(preview(&trust, &workspace, "main", NetworkOperation::Push))
        .expect("preview succeeds");
    assert_eq!(result.ahead, Some(2));
    assert_eq!(result.behind, Some(0));
}

#[test]
fn preview_reports_ahead_and_behind_after_divergence() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    // "Someone else" pushes to the shared remote via an independent clone.
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);

    // The original clone commits locally without ever fetching the above —
    // a real divergence, not just a fast-forward.
    std::fs::write(repo.path().join("mine.txt"), "mine\n").unwrap();
    raw_git_ok(repo.path(), &["add", "mine.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "my change"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    // The local remote-tracking ref (`origin/main`) is stale until an actual
    // fetch happens — `preview` deliberately reports the *last known* state
    // (see this module's own doc comment), so before fetching it still shows
    // 0 behind even though the shared remote has actually moved.
    let before_fetch = block_on(preview(&trust, &workspace, "main", NetworkOperation::Push))
        .expect("preview succeeds");
    assert_eq!(before_fetch.ahead, Some(1));
    assert_eq!(before_fetch.behind, Some(0));

    let network = GitNetworkService::new();
    block_on(fetch(&trust, &workspace, &network, "main")).expect("fetch succeeds");
    let after_fetch = block_on(preview(&trust, &workspace, "main", NetworkOperation::Push))
        .expect("preview succeeds");
    assert_eq!(after_fetch.ahead, Some(1));
    assert_eq!(after_fetch.behind, Some(1));
}

#[test]
fn preview_rejects_when_workspace_is_not_trusted() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());

    let error = block_on(preview(&trust, &workspace, "main", NetworkOperation::Fetch))
        .expect_err("untrusted workspace must reject preview");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- fetch -----------------------------------------------------------------

#[test]
fn fetch_updates_the_remote_tracking_branch_from_a_local_bare_remote() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);

    let before = raw_git(repo.path(), &["rev-parse", "origin/main"]);
    let remote_head = raw_git(other.path(), &["rev-parse", "HEAD"]);
    assert_ne!(
        String::from_utf8_lossy(&before.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
        "remote-tracking ref must be stale before fetch"
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    block_on(fetch(&trust, &workspace, &network, "main")).expect("fetch succeeds");

    let after = raw_git(repo.path(), &["rev-parse", "origin/main"]);
    assert_eq!(
        String::from_utf8_lossy(&after.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
        "fetch must update the remote-tracking ref to match the real remote"
    );
    // fetch must not touch the local working branch/tree at all.
    let local_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);
    assert_ne!(
        String::from_utf8_lossy(&local_head.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
    );
}

#[test]
fn fetch_rejects_when_workspace_is_not_trusted() {
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![repo.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let network = GitNetworkService::new();

    let error = block_on(fetch(&trust, &workspace, &network, "main"))
        .expect_err("untrusted workspace must reject fetch");
    assert_eq!(error.code(), "WORKSPACE_NOT_TRUSTED");
}

// --- pull ------------------------------------------------------------------

#[test]
fn pull_fast_forwards_the_local_branch() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);
    let remote_head = raw_git(other.path(), &["rev-parse", "HEAD"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    block_on(pull(&trust, &workspace, &network, "main")).expect("pull succeeds");

    let local_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);
    assert_eq!(
        String::from_utf8_lossy(&local_head.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
        "pull must fast-forward the local branch to match the remote"
    );
    assert!(repo.path().join("other.txt").exists());
}

/// Whether the ambient environment already has a default pull-reconcile
/// strategy configured (`pull.rebase`/`pull.ff`, at any config level `git
/// pull` consults) — if so,
/// [`pull_reports_needs_strategy_for_a_real_divergence_without_a_configured_strategy`]
/// cannot reproduce the "no strategy configured" failure (a real ambient
/// default would resolve it), so that test skips itself rather than
/// asserting something environment-dependent. This workspace's own dev
/// environment has neither set (confirmed via `git config --global --list`
/// while writing this slice), so in practice the test below does run here.
fn ambient_pull_strategy_is_configured() -> bool {
    ["pull.rebase", "pull.ff"].iter().any(|key| {
        ["--global", "--system"].iter().any(|scope| {
            Command::new("git")
                .args(["config", scope, "--get", key])
                .output()
                .is_ok_and(|output| output.status.success())
        })
    })
}

#[test]
fn pull_reports_needs_strategy_for_a_real_divergence_without_a_configured_strategy() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    if ambient_pull_strategy_is_configured() {
        eprintln!(
            "skipping: this environment has an ambient pull.rebase/pull.ff default configured, \
             which would resolve the divergence this test needs to leave unresolved"
        );
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);

    std::fs::write(repo.path().join("mine.txt"), "mine\n").unwrap();
    raw_git_ok(repo.path(), &["add", "mine.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "my change"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    let error = block_on(pull(&trust, &workspace, &network, "main"))
        .expect_err("a real divergence with no configured strategy must fail");
    assert_eq!(error.code(), "GIT_PULL_NEEDS_STRATEGY");
}

// --- push --------------------------------------------------------------

#[test]
fn push_uploads_local_commits_to_a_local_bare_remote() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    std::fs::write(repo.path().join("b.txt"), "two\n").unwrap();
    raw_git_ok(repo.path(), &["add", "b.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "second"]);
    let local_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    block_on(push(&trust, &workspace, &network, "main", false)).expect("push succeeds");

    let remote_head = raw_git(remote.path(), &["rev-parse", "refs/heads/main"]);
    assert_eq!(
        String::from_utf8_lossy(&local_head.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
        "push must upload the local commit to the bare remote"
    );
}

/// A remote exists (so the failure is specifically "no upstream *tracking*
/// branch", the real message this test pins down — confirmed empirically),
/// but `push -u`/`branch --set-upstream-to` was never run, unlike
/// [`repo_synced_with_a_bare_remote`]'s fixture.
#[test]
fn push_without_upstream_is_rejected() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let remote = init_bare_remote();
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "one\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "init"]);
    raw_git_ok(
        repo.path(),
        &[
            "remote",
            "add",
            "origin",
            remote.path().to_str().expect("utf8 tempdir path"),
        ],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    let error = block_on(push(&trust, &workspace, &network, "main", false))
        .expect_err("push with no upstream configured must be rejected");
    assert_eq!(error.code(), "GIT_PUSH_NO_UPSTREAM");
}

#[test]
fn plain_push_is_rejected_when_the_remote_has_diverged() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);

    std::fs::write(repo.path().join("mine.txt"), "mine\n").unwrap();
    raw_git_ok(repo.path(), &["add", "mine.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "my change"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    let error = block_on(push(&trust, &workspace, &network, "main", false))
        .expect_err("a plain push must be rejected when the remote has diverged");
    assert_eq!(error.code(), "GIT_PUSH_REJECTED");
}

/// The `--force-with-lease` vs. bare `--force` distinction this module's own
/// doc comment describes, proven end to end: a force push whose local
/// remote-tracking ref is still an accurate "lease" (nothing else has
/// touched the remote since) succeeds even though it rewrites history —
/// [`stale_force_push_is_still_rejected_by_force_with_lease`] below is the
/// contrasting case that must fail.
#[test]
fn force_push_with_a_valid_lease_rewrites_the_remote() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--amend", "-m", "rewritten init"],
    );
    let amended_head = raw_git(repo.path(), &["rev-parse", "HEAD"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    block_on(push(&trust, &workspace, &network, "main", true))
        .expect("force-with-lease succeeds when the lease is valid");

    let remote_head = raw_git(remote.path(), &["rev-parse", "refs/heads/main"]);
    assert_eq!(
        String::from_utf8_lossy(&amended_head.stdout).trim(),
        String::from_utf8_lossy(&remote_head.stdout).trim(),
    );
}

/// The safety half of the `--force-with-lease` claim: when the shared remote
/// has moved since this clone's last fetch (a stale "lease"), a
/// force-with-lease push must be rejected exactly like a real collaborator
/// would want — this domain never exposes bare `--force`, which would have
/// silently clobbered the other person's push instead.
#[test]
fn stale_force_push_is_still_rejected_by_force_with_lease() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let (repo, remote) = repo_synced_with_a_bare_remote();
    let other = clone_bare_remote(remote.path());
    std::fs::write(other.path().join("other.txt"), "other\n").unwrap();
    raw_git_ok(other.path(), &["add", "other.txt"]);
    raw_git_ok(other.path(), &["commit", "--quiet", "-m", "other change"]);
    raw_git_ok(other.path(), &["push", "--quiet"]);

    // `repo` never fetched the above — its remote-tracking ref is stale —
    // then amends its own history and attempts a force-with-lease push.
    raw_git_ok(
        repo.path(),
        &["commit", "--quiet", "--amend", "-m", "rewritten init"],
    );

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let network = GitNetworkService::new();
    let error = block_on(push(&trust, &workspace, &network, "main", true))
        .expect_err("force-with-lease must reject a stale lease rather than clobber the remote");
    assert_eq!(error.code(), "GIT_PUSH_REJECTED");
}

// --- GitNetworkService::request_cancel -------------------------------------

#[test]
fn request_cancel_sets_the_flag_for_an_in_flight_window_and_is_a_no_op_otherwise() {
    let service = GitNetworkService::new();
    // No operation ever began for "main" — must not panic, must do nothing.
    service.request_cancel_for_root_id("main", None);

    let flag = service.begin_for_root("main", None);
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst));
    service.request_cancel_for_root_id("main", None);
    assert!(flag.load(std::sync::atomic::Ordering::SeqCst));

    service.end_for_root("main", None);
    // Cancelling again after `end` must not resurrect or panic — there is
    // simply nothing left to cancel.
    service.request_cancel_for_root_id("main", None);
}

#[test]
fn rooted_network_cancellation_never_crosses_to_another_repository() {
    let service = GitNetworkService::new();
    let first = RootId::parse_v4_wire("00000000-0000-4000-8000-000000000101").unwrap();
    let second = RootId::parse_v4_wire("00000000-0000-4000-8000-000000000102").unwrap();
    let first_flag = service.begin_for_root("main", Some(first));
    let second_flag = service.begin_for_root("main", Some(second));

    service.request_cancel_for_root("main", first);

    assert!(first_flag.load(std::sync::atomic::Ordering::SeqCst));
    assert!(!second_flag.load(std::sync::atomic::Ordering::SeqCst));
    service.end_for_root("main", Some(first));
    service.end_for_root("main", Some(second));
}
