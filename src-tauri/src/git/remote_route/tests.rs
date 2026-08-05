//! `F220` S6 hermetic, full-stack tests for `git::remote_route` — a real
//! `russh::server` fixture serving real `exec` requests forwarded to a real
//! `git` binary (`remote::test_support::GitExecFixture`), a real
//! `RemoteSessionService` session connected to it, a real workspace remote
//! root bound to that session with real execution trust granted, and this
//! domain's real production `status`/`diff`/`log`/`stage`/`commit` functions
//! — exactly the path production IPC reaches for a remote root, unlike any
//! lower-layer seam. `remote::remote_git::tests` is the sibling suite one
//! layer down (transport-only, no `git::` involved at all); this file proves
//! the two are wired together correctly end to end, plus the routing-layer
//! concerns only this layer can express: toplevel boundary enforcement,
//! trust-gate ordering, and confirming the "every out-of-scope command fails
//! closed for free" assumption the S6 plan rests its narrow scope on.

use std::future::Future;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use tempfile::TempDir;

use crate::git::commit;
use crate::git::diff;
use crate::git::log;
use crate::git::management;
use crate::git::network::{self, GitNetworkService, NetworkOperation};
use crate::git::refs;
use crate::git::repo::SelectedGitRoot;
use crate::git::stage;
use crate::git::stash;
use crate::git::status;
use crate::git::worktree;
use crate::remote::dto::RemoteSessionId;
use crate::remote::session::RemoteSessionService;
use crate::remote::test_support::{self, GitExecFixture};
use crate::trust::service::TrustService;
use crate::workspace::service::WorkspaceService;
use crate::workspace::RootId;

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
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

fn init_repo(dir: &Path) {
    raw_git_ok(dir, &["init", "--quiet", "-b", "main"]);
    raw_git_ok(dir, &["config", "user.email", "plain-test@example.invalid"]);
    raw_git_ok(dir, &["config", "user.name", "Plain Test"]);
}

fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path)
        .expect("path canonicalizes")
        .to_string_lossy()
        .into_owned()
}

/// Everything one full-stack remote-git test needs: a connected exec
/// fixture (real sshd, real repo directory on disk), a trusted workspace
/// with exactly one remote root bound to it, and fresh
/// `GitNetworkService`/`RemoteSessionService` instances to route through —
/// mirrors `terminal::service::remote_tests::RemoteHarness`'s own shape for
/// the sibling terminal domain.
struct RemoteRepoHarness {
    _remote_base: TempDir,
    _trust_base: TempDir,
    fixture: GitExecFixture,
    remote: RemoteSessionService,
    network: GitNetworkService,
    workspace: WorkspaceService,
    trust: TrustService,
    root_id: RootId,
}

/// Builds a [`RemoteRepoHarness`] whose remote root points at a real,
/// initialized (but otherwise empty) git repository. `window_label` is
/// always `"main"`.
fn remote_repo_harness(artificial_delay: Duration) -> RemoteRepoHarness {
    block_on(async {
        let window_label = "main";
        let remote_base = TempDir::new().unwrap();
        let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
        let identity = test_support::generate_key();
        let fixture = test_support::start_git_exec_fixture(&identity, artificial_delay).await;
        init_repo(fixture.repo_dir.path());
        let repo_path = canonical(fixture.repo_dir.path());

        let session_id =
            test_support::connect_git_exec_test_session(&remote, window_label, &fixture).await;
        let fingerprint = remote
            .session_host_key_fingerprint(window_label, session_id)
            .expect("live session reports its own pinned fingerprint");

        let workspace = WorkspaceService::new();
        let (root_id, _snapshot) = workspace
            .authorize_remote_root(
                window_label,
                session_id,
                &fingerprint,
                &repo_path,
                "Remote Repo",
            )
            .expect("remote root authorizes");

        let trust_base = TempDir::new().unwrap();
        let trust = TrustService::new(trust_base.path().to_path_buf());
        trust
            .grant(&workspace, window_label)
            .await
            .expect("grant succeeds");

        RemoteRepoHarness {
            _remote_base: remote_base,
            _trust_base: trust_base,
            fixture,
            remote,
            network: GitNetworkService::new(),
            workspace,
            trust,
            root_id,
        }
    })
}

fn scope(harness: &RemoteRepoHarness) -> SelectedGitRoot<'_> {
    SelectedGitRoot::new(&harness.workspace, harness.root_id)
}

// --- Real six-command pipeline, end to end -------------------------------

#[test]
fn status_diff_stage_unstage_commit_and_log_all_work_against_a_real_remote_repository() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    let harness = remote_repo_harness(Duration::ZERO);
    std::fs::write(harness.fixture.repo_dir.path().join("a.txt"), b"one\n").unwrap();

    // status: an untracked file shows up.
    let initial_status = block_on(status::git_status(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
    ))
    .expect("remote status succeeds");
    assert_eq!(initial_status.entries.len(), 1);

    // stage: the untracked file moves into the index.
    block_on(stage::stage_paths(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &["a.txt".to_owned()],
    ))
    .expect("remote stage succeeds");

    let staged_diff = block_on(diff::diff_files(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        true,
    ))
    .expect("remote cached diff succeeds");
    assert_eq!(staged_diff.len(), 1);

    // unstage: the file moves back out of the index.
    block_on(stage::unstage_paths(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &["a.txt".to_owned()],
    ))
    .expect("remote unstage succeeds");
    let unstaged_diff = block_on(diff::diff_files(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        true,
    ))
    .expect("remote cached diff succeeds");
    assert!(unstaged_diff.is_empty());

    // stage again, then commit.
    block_on(stage::stage_paths(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &["a.txt".to_owned()],
    ))
    .expect("remote stage succeeds");
    block_on(commit::commit(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        "remote commit",
        false,
    ))
    .expect("remote commit succeeds");

    // status is now clean.
    let post_commit_status = block_on(status::git_status(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
    ))
    .expect("remote status succeeds");
    assert!(post_commit_status.entries.is_empty());

    // log: the graph now has exactly one node with our commit's subject.
    let graph = block_on(log::log_graph(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        100,
    ))
    .expect("remote log succeeds");
    assert_eq!(graph.nodes.len(), 1);
    assert_eq!(graph.nodes[0].subject, "remote commit");
}

#[test]
fn commit_amend_works_against_a_real_remote_repository() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    let harness = remote_repo_harness(Duration::ZERO);
    std::fs::write(harness.fixture.repo_dir.path().join("a.txt"), b"one\n").unwrap();
    block_on(stage::stage_paths(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &["a.txt".to_owned()],
    ))
    .unwrap();
    block_on(commit::commit(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        "first message",
        false,
    ))
    .unwrap();

    block_on(commit::commit(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        "amended message",
        true,
    ))
    .expect("remote amend succeeds");

    let graph = block_on(log::log_graph(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        100,
    ))
    .unwrap();
    assert_eq!(graph.nodes.len(), 1, "amend must not add a second commit");
    assert_eq!(graph.nodes[0].subject, "amended message");
}

#[test]
fn commit_rejects_an_empty_and_a_whitespace_only_message_without_any_remote_exec() {
    let harness = remote_repo_harness(Duration::ZERO);
    for message in ["", "   ", "\n\t"] {
        let error = block_on(commit::commit(
            &harness.trust,
            &scope(&harness),
            &harness.network,
            &harness.remote,
            "main",
            message,
            false,
        ))
        .expect_err("an empty/whitespace-only message must be rejected");
        assert_eq!(error.code(), "GIT_COMMIT_EMPTY_MESSAGE");
    }
}

#[test]
fn commit_rejects_an_oversized_message_without_any_remote_exec() {
    let harness = remote_repo_harness(Duration::ZERO);
    let huge_message = "x".repeat(200_000);
    let error = block_on(commit::commit(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &huge_message,
        false,
    ))
    .expect_err("an oversized message must be rejected");
    assert_eq!(error.code(), "GIT_COMMIT_MESSAGE_TOO_LARGE");
}

/// Mirrors `commit::tests`' own `commit_runs_the_repositorys_own_hooks` for
/// the local `Write` path: a real `post-commit` hook the *remote* repository
/// configures must genuinely fire, proving `RemoteGitExecMode::Write` does
/// not neutralize hooks — the disclosed asymmetry from `BackgroundRead`
/// documented on that type.
#[test]
fn a_real_remote_repositorys_own_post_commit_hook_fires_under_write_mode() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    let harness = remote_repo_harness(Duration::ZERO);
    let hooks_dir = harness.fixture.repo_dir.path().join(".git").join("hooks");
    let marker = harness.fixture.repo_dir.path().join("post-commit-ran");
    std::fs::write(
        hooks_dir.join("post-commit"),
        format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            hooks_dir.join("post-commit"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }

    std::fs::write(harness.fixture.repo_dir.path().join("a.txt"), b"one\n").unwrap();
    block_on(stage::stage_paths(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        &["a.txt".to_owned()],
    ))
    .unwrap();
    block_on(commit::commit(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        &harness.remote,
        "main",
        "triggers hook",
        false,
    ))
    .expect("remote commit succeeds");

    assert!(
        marker.exists(),
        "the repository's own post-commit hook must have fired under Write mode"
    );
}

// --- Toplevel boundary enforcement, remote's own equivalent of
//     `repo::tests`' local fixtures -----------------------------------

#[test]
fn a_remote_repository_toplevel_above_the_selected_root_is_rejected() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let window_label = "main";
        let remote_base = TempDir::new().unwrap();
        let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
        let identity = test_support::generate_key();
        let fixture = test_support::start_git_exec_fixture(&identity, Duration::ZERO).await;
        init_repo(fixture.repo_dir.path());
        let child = fixture.repo_dir.path().join("child");
        std::fs::create_dir(&child).unwrap();
        let child_path = canonical(&child);

        let session_id =
            test_support::connect_git_exec_test_session(&remote, window_label, &fixture).await;
        let fingerprint = remote
            .session_host_key_fingerprint(window_label, session_id)
            .unwrap();

        let workspace = WorkspaceService::new();
        // The workspace root is the *child* directory — a subdirectory of a
        // larger repository — exactly `repo::tests`'
        // `a_repository_toplevel_above_the_selected_root_is_rejected`'s own
        // local fixture shape.
        let (root_id, _snapshot) = workspace
            .authorize_remote_root(window_label, session_id, &fingerprint, &child_path, "Child")
            .unwrap();
        let trust_base = TempDir::new().unwrap();
        let trust = TrustService::new(trust_base.path().to_path_buf());
        trust.grant(&workspace, window_label).await.unwrap();
        let network = GitNetworkService::new();
        let selected = SelectedGitRoot::new(&workspace, root_id);

        let error = status::git_status(&trust, &selected, &network, &remote, window_label)
            .await
            .expect_err("repository-wide Git access may not escape above the root");
        assert_eq!(error.code(), "GIT_REPOSITORY_OUTSIDE_ROOT");
    });
}

#[test]
fn a_trusted_remote_root_that_is_not_a_repository_reports_git_no_repository() {
    if !git_available() {
        eprintln!("skipping: git is not available on PATH");
        return;
    }
    block_on(async {
        let window_label = "main";
        let remote_base = TempDir::new().unwrap();
        let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
        let identity = test_support::generate_key();
        // Deliberately never `init_repo` — a plain, non-repository directory.
        let fixture = test_support::start_git_exec_fixture(&identity, Duration::ZERO).await;
        let repo_path = canonical(fixture.repo_dir.path());

        let session_id =
            test_support::connect_git_exec_test_session(&remote, window_label, &fixture).await;
        let fingerprint = remote
            .session_host_key_fingerprint(window_label, session_id)
            .unwrap();

        let workspace = WorkspaceService::new();
        let (root_id, _snapshot) = workspace
            .authorize_remote_root(window_label, session_id, &fingerprint, &repo_path, "Plain")
            .unwrap();
        let trust_base = TempDir::new().unwrap();
        let trust = TrustService::new(trust_base.path().to_path_buf());
        trust.grant(&workspace, window_label).await.unwrap();
        let network = GitNetworkService::new();
        let selected = SelectedGitRoot::new(&workspace, root_id);

        let error = status::git_status(&trust, &selected, &network, &remote, window_label)
            .await
            .expect_err("a plain remote directory is not a repository");
        assert_eq!(error.code(), "GIT_NO_REPOSITORY");
    });
}

// --- Untrusted fail-closed: zero SSH exec ever attempted -------------------

/// Proves all six routed commands fail closed with `WORKSPACE_NOT_TRUSTED`
/// for an untrusted remote root, and — critically — that trust is checked
/// *before* any SSH exec is attempted: `session_id` here names a session
/// that was **never connected** (`RemoteSessionId::new()`, a bare random
/// id), so any attempt to actually reach it would surface a session-related
/// transport error (`GIT_EXEC_UNAVAILABLE`/`REMOTE_SESSION_DISCONNECTED`),
/// never `WORKSPACE_NOT_TRUSTED` — observing the trust error specifically is
/// what proves no exec was ever attempted.
#[test]
fn all_six_routed_commands_fail_closed_as_not_trusted_with_zero_ssh_exec() {
    let remote_base = TempDir::new().unwrap();
    let remote = RemoteSessionService::new(remote_base.path().to_path_buf());
    let network = GitNetworkService::new();
    let workspace = WorkspaceService::new();
    let never_connected_session_id = RemoteSessionId::new();
    let root_id = workspace
        .authorize_remote_root(
            "main",
            never_connected_session_id,
            "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "/srv/never-connected",
            "Never Connected",
        )
        .unwrap()
        .0;
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    // Deliberately never granted.
    let selected = SelectedGitRoot::new(&workspace, root_id);

    let assert_not_trusted = |code: &str| {
        assert_eq!(
            code, "WORKSPACE_NOT_TRUSTED",
            "must fail as untrusted, not as a transport/session error — a transport error \
             here would mean an exec was actually attempted against a session that was never \
             connected"
        );
    };

    assert_not_trusted(
        block_on(status::git_status(
            &trust, &selected, &network, &remote, "main",
        ))
        .unwrap_err()
        .code(),
    );
    assert_not_trusted(
        block_on(diff::diff_files(
            &trust, &selected, &network, &remote, "main", false,
        ))
        .unwrap_err()
        .code(),
    );
    assert_not_trusted(
        block_on(log::log_graph(
            &trust, &selected, &network, &remote, "main", 10,
        ))
        .unwrap_err()
        .code(),
    );
    assert_not_trusted(
        block_on(stage::stage_paths(
            &trust,
            &selected,
            &network,
            &remote,
            "main",
            &["a.txt".to_owned()],
        ))
        .unwrap_err()
        .code(),
    );
    assert_not_trusted(
        block_on(stage::unstage_paths(
            &trust,
            &selected,
            &network,
            &remote,
            "main",
            &["a.txt".to_owned()],
        ))
        .unwrap_err()
        .code(),
    );
    assert_not_trusted(
        block_on(commit::commit(
            &trust, &selected, &network, &remote, "main", "message", false,
        ))
        .unwrap_err()
        .code(),
    );
}

// --- fetch/pull/push/preview fail closed with the dedicated new code -----

#[test]
fn preview_fetch_pull_and_push_fail_closed_for_a_remote_root_with_the_dedicated_code() {
    let harness = remote_repo_harness(Duration::ZERO);

    let preview_error = block_on(network::preview(
        &harness.trust,
        &scope(&harness),
        "main",
        NetworkOperation::Fetch,
    ))
    .expect_err("preview must fail closed for a remote root");
    assert_eq!(preview_error.code(), "GIT_REMOTE_NETWORK_UNSUPPORTED");

    let fetch_error = block_on(network::fetch(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        "main",
    ))
    .expect_err("fetch must fail closed for a remote root");
    assert_eq!(fetch_error.code(), "GIT_REMOTE_NETWORK_UNSUPPORTED");

    let pull_error = block_on(network::pull(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        "main",
    ))
    .expect_err("pull must fail closed for a remote root");
    assert_eq!(pull_error.code(), "GIT_REMOTE_NETWORK_UNSUPPORTED");

    let push_error = block_on(network::push(
        &harness.trust,
        &scope(&harness),
        &harness.network,
        "main",
        false,
    ))
    .expect_err("push must fail closed for a remote root");
    assert_eq!(push_error.code(), "GIT_REMOTE_NETWORK_UNSUPPORTED");

    // Not the generic backend-unsupported fallback — the whole point of the
    // dedicated code is that this domain *does* support this backend for
    // git in general (the S6 core subset), just not network operations.
    assert_ne!(fetch_error.code(), "ROOT_BACKEND_UNSUPPORTED");
}

// --- Out-of-scope commands: the "no code changes needed" assumption, verified ---

/// Proves — rather than assumes — that a representative sample of
/// out-of-scope commands (branch/tag/remote management, stash, worktree —
/// the S6 plan's own explicit non-goals) still fail closed with
/// `ROOT_BACKEND_UNSUPPORTED` for a remote root purely through the existing
/// `resolve_repo_toplevel` -> `root_canonical_path` chokepoint, with zero
/// source changes to any of these three modules.
#[test]
fn representative_out_of_scope_commands_fail_closed_with_root_backend_unsupported() {
    let harness = remote_repo_harness(Duration::ZERO);

    let branch_error = block_on(management::create_branch(
        &harness.trust,
        &scope(&harness),
        "main",
        "feature",
        "0000000000000000000000000000000000000000",
    ))
    .expect_err("branch creation must stay out of scope for a remote root");
    assert_eq!(branch_error.code(), "ROOT_BACKEND_UNSUPPORTED");

    let stash_error = block_on(stash::push_stash(
        &harness.trust,
        &scope(&harness),
        "main",
        "wip",
        false,
    ))
    .expect_err("stash must stay out of scope for a remote root");
    assert_eq!(stash_error.code(), "ROOT_BACKEND_UNSUPPORTED");

    let worktree_error = block_on(worktree::list_worktrees(
        &harness.trust,
        &scope(&harness),
        "main",
    ))
    .expect_err("worktree listing must stay out of scope for a remote root");
    assert_eq!(worktree_error.code(), "ROOT_BACKEND_UNSUPPORTED");

    let refs_error = block_on(refs::list_refs(&harness.trust, &scope(&harness), "main"))
        .expect_err("refs listing must stay out of scope for a remote root");
    assert_eq!(refs_error.code(), "ROOT_BACKEND_UNSUPPORTED");
}
