//! Real-subprocess Rust tests for `debug::exec`'s hardened spawn primitive.
//! `sh -c '...'`/`sleep`/`touch` fixtures are used freely here — this file's
//! name ends in `tests.rs`, the domain-wide carve-out
//! `scripts/plain/boundary-contracts.mjs` grants test fixtures (mirroring
//! `terminal::service::tests`'s own identical precedent for its own
//! `sh -c` fixtures); production code under `debug::exec` never constructs a
//! shell command string this way — see `spawn_adapter_sync`'s own doc
//! comment and `validateDebugSpawnConstructionShape`'s mechanical lock.
//!
//! # Control-group notes (read before adding more tests here)
//!
//! The env-passthrough tests below are genuine before/after control-group
//! proofs: [`only_allowlisted_names_are_forwarded_after_env_clear`] proves
//! the allowlisted names *are* forwarded, its sibling
//! [`a_missing_allowlisted_name_is_simply_absent_not_a_blank_value`] proves
//! everything else genuinely is not, and
//! [`the_real_spawned_childs_environment_matches_the_allowlist_empirically`]
//! is the same proof one level up the stack, against a real spawned process
//! rather than just the `Command` builder's own recorded state.
//!
//! [`argv_elements_containing_shell_metacharacters_are_never_shell_interpreted`]
//! is a **different kind of proof**: there is no "unhardened" sibling spawn
//! path in this domain to diff against (unlike git's pathspec-glob case,
//! which had a real vulnerable flag combination to demonstrate against) —
//! `Command::new(...).args(...)` is the only construction shape this file has
//! ever had. So that test is an adversarial-input positive-proof instead: it
//! shows a hostile argv element survives intact and unexecuted, which is the
//! honest substitute when there is no vulnerable code path to A/B against.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tempfile::TempDir;

use crate::debug::confirm::ConfirmationService;
use crate::debug::dto::{AdapterSpawnDescriptor, AdapterTransportKind};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

use super::{
    apply_env_passthrough, spawn_adapter, spawn_adapter_as_tcp_companion, spawn_adapter_sync,
    DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES,
};

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<PathBuf>,
}

impl FakePicker {
    fn selected(paths: Vec<PathBuf>) -> Self {
        Self { paths }
    }
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn workspace_with_root(window_label: &str, root_path: &Path) -> WorkspaceService {
    let workspace = WorkspaceService::new();
    let picker = FakePicker::selected(vec![root_path.to_path_buf()]);
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    workspace
}

/// Guards every test below that mutates process-wide environment variables —
/// mirrors `git::exec::tests`'s own `with_env_vars`/`NETWORK_ENV_MUTATION_LOCK`
/// exactly (same rationale: `cargo test` runs tests on multiple threads
/// within one process, and `std::env::set_var`/`remove_var` are process-wide).
static ENV_MUTATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_env_vars<R>(overrides: &[(&str, Option<&str>)], body: impl FnOnce() -> R) -> R {
    let _guard = ENV_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let previous: Vec<(String, Option<String>)> = overrides
        .iter()
        .map(|(name, _)| ((*name).to_owned(), std::env::var(name).ok()))
        .collect();
    for (name, value) in overrides {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }
    let result = body();
    for (name, value) in previous {
        match value {
            Some(value) => std::env::set_var(&name, value),
            None => std::env::remove_var(&name),
        }
    }
    result
}

fn get_env_value(command: &Command, name: &str) -> Option<String> {
    command.get_envs().find_map(|(key, value)| {
        if key.to_str() == Some(name) {
            value.map(|value| value.to_string_lossy().into_owned())
        } else {
            None
        }
    })
}

// ---------------------------------------------------------------------
// Env passthrough — fast, Command-builder-introspection-only tests
// (no spawn), mirroring terminal::shell::tests's own style.
// ---------------------------------------------------------------------

#[test]
fn only_allowlisted_names_are_forwarded_after_env_clear() {
    let mut command = Command::new("test-fixture-program");
    apply_env_passthrough(
        &mut command,
        vec![
            ("PATH".to_owned(), "/usr/bin".to_owned()),
            ("HOME".to_owned(), "/home/plain".to_owned()),
            ("TMPDIR".to_owned(), "/tmp/plain".to_owned()),
            ("SECRET_TOKEN".to_owned(), "leaked-if-forwarded".to_owned()),
            (
                "SSH_AUTH_SOCK".to_owned(),
                "should-not-be-forwarded".to_owned(),
            ),
        ],
    );
    assert_eq!(get_env_value(&command, "PATH").as_deref(), Some("/usr/bin"));
    assert_eq!(
        get_env_value(&command, "HOME").as_deref(),
        Some("/home/plain")
    );
    assert_eq!(
        get_env_value(&command, "TMPDIR").as_deref(),
        Some("/tmp/plain")
    );
    assert_eq!(get_env_value(&command, "SECRET_TOKEN"), None);
    assert_eq!(get_env_value(&command, "SSH_AUTH_SOCK"), None);
}

#[test]
fn a_missing_allowlisted_name_is_simply_absent_not_a_blank_value() {
    let mut command = Command::new("test-fixture-program");
    apply_env_passthrough(&mut command, Vec::new());
    for name in DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES {
        assert_eq!(
            get_env_value(&command, name),
            None,
            "{name} should be absent"
        );
    }
}

// ---------------------------------------------------------------------
// Env passthrough — real-process empirical proof
// ---------------------------------------------------------------------

/// Empirical, real-`Command::spawn()`-backed proof that
/// [`DEBUG_ADAPTER_ENV_PASSTHROUGH_NAMES`] is exactly what a genuinely
/// spawned child process sees — not merely what the `Command` builder's own
/// recorded state looks like (the fast tests above). Uses `sh -c` printing
/// each variable's own value via shell parameter expansion (never an
/// external `env` binary, so this does not depend on `PATH` resolving
/// anything) to a script that then exits — `spawn_adapter_sync` reports that
/// as a startup crash, and the crash error's captured stderr tail *is* the
/// child's real, observed view of its own environment.
///
/// Deliberately does **not** mutate the real `PATH`/`HOME`/`TMPDIR` process
/// environment variables the way `with_env_vars` mutates a synthetic one
/// below: `cargo test` runs this whole crate's tests concurrently in one
/// process, and other, unrelated tests (most concretely `git::exec::tests`,
/// which spawns a real `git` subprocess and itself reads ambient `PATH`/`HOME`
/// to build its own child's environment) depend on those three actually
/// holding their real, working values for the *entire* test run — forcing
/// them to a fake path process-wide, even briefly, would risk making an
/// unrelated concurrently-running test's own subprocess spawn fail. Instead,
/// this test reads whatever `PATH`/`HOME`/`TMPDIR` *actually* already are
/// (via `std::env::var`) and asserts the exact same real values reach the
/// child — proof enough that they are forwarded, without ever touching them.
/// The negative side (an arbitrary non-allowlisted variable is *not*
/// forwarded) uses two synthetic names scoped to this test file
/// (`PLAIN_DEBUG_EXEC_TEST_SECRET_ONE`/`_TWO`) rather than reusing a name any
/// other domain's tests also mutate (e.g. `git::exec::tests` already owns
/// real, concurrent, `SSH_AUTH_SOCK`-mutating tests of its own) — for exactly
/// the same cross-test-interference reason.
#[test]
fn the_real_spawned_childs_environment_matches_the_allowlist_empirically() {
    let real_path = std::env::var("PATH").expect("PATH is set in this test environment");
    let real_home = std::env::var("HOME").expect("HOME is set in this test environment");
    let real_tmpdir = std::env::var("TMPDIR").unwrap_or_default();

    with_env_vars(
        &[
            (
                "PLAIN_DEBUG_EXEC_TEST_SECRET_ONE",
                Some("leaked-if-forwarded"),
            ),
            (
                "PLAIN_DEBUG_EXEC_TEST_SECRET_TWO",
                Some("should-not-forward"),
            ),
        ],
        || {
            let descriptor = AdapterSpawnDescriptor {
                command: "/bin/sh".to_owned(),
                args: vec![
                    "-c".to_owned(),
                    "printf 'PATH=%s\\nHOME=%s\\nTMPDIR=%s\\nSECRET1=%s\\nSECRET2=%s\\n' \
                     \"$PATH\" \"$HOME\" \"$TMPDIR\" \"$PLAIN_DEBUG_EXEC_TEST_SECRET_ONE\" \
                     \"$PLAIN_DEBUG_EXEC_TEST_SECRET_TWO\" 1>&2"
                        .to_owned(),
                ],
            };
            let cancel = AtomicBool::new(false);
            let error = spawn_adapter_sync(&descriptor, &cancel)
                .expect_err("a trivial printf-then-exit script is reported as a startup crash");
            assert_eq!(error.code(), "DEBUG_ADAPTER_STARTUP_CRASHED");
            let message = error.message();
            assert!(
                message.contains(&format!("PATH={real_path}")),
                "message: {message}"
            );
            assert!(
                message.contains(&format!("HOME={real_home}")),
                "message: {message}"
            );
            assert!(
                message.contains(&format!("TMPDIR={real_tmpdir}")),
                "message: {message}"
            );
            assert!(
                !message.contains("leaked-if-forwarded"),
                "message: {message}"
            );
            assert!(
                !message.contains("should-not-forward"),
                "message: {message}"
            );
        },
    );
}

// ---------------------------------------------------------------------
// Startup-crash detection / cancellation / spawn failure
// ---------------------------------------------------------------------

#[test]
fn a_healthy_process_survives_the_startup_grace_window_and_can_be_killed() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sleep".to_owned(),
        args: vec!["2".to_owned()],
    };
    let cancel = AtomicBool::new(false);
    let handle = spawn_adapter_sync(&descriptor, &cancel).expect(
        "a process that outlives the grace window must be handed back, not reported as crashed",
    );
    handle.kill();
}

#[test]
fn a_process_that_exits_immediately_is_reported_as_a_startup_crash_with_captured_stderr() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec![
            "-c".to_owned(),
            "echo boom-from-adapter 1>&2; exit 7".to_owned(),
        ],
    };
    let cancel = AtomicBool::new(false);
    let error = spawn_adapter_sync(&descriptor, &cancel)
        .expect_err("an immediately-exiting process must be reported as a startup crash");
    assert_eq!(error.code(), "DEBUG_ADAPTER_STARTUP_CRASHED");
    assert!(error.message().contains("boom-from-adapter"));
    assert!(error.message().contains('7'));
}

#[test]
fn cancelling_during_the_grace_window_kills_the_child_and_returns_cancelled() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sleep".to_owned(),
        args: vec!["5".to_owned()],
    };
    // Pre-set: the very first cancel check inside the grace-window poll loop
    // must already observe it, aborting well before the 5-second sleep could
    // ever finish on its own.
    let cancel = AtomicBool::new(true);
    let error = spawn_adapter_sync(&descriptor, &cancel)
        .expect_err("a pre-set cancel flag must abort the grace-window wait");
    assert_eq!(error.code(), "DEBUG_ADAPTER_CANCELLED");
}

#[test]
fn a_nonexistent_command_path_fails_with_spawn_unavailable() {
    let descriptor = AdapterSpawnDescriptor {
        command: "/definitely/does/not/exist/plain-debug-adapter-fixture".to_owned(),
        args: Vec::new(),
    };
    let cancel = AtomicBool::new(false);
    let error =
        spawn_adapter_sync(&descriptor, &cancel).expect_err("a missing executable cannot spawn");
    assert_eq!(error.code(), "DEBUG_ADAPTER_SPAWN_UNAVAILABLE");
}

// ---------------------------------------------------------------------
// Spawn-construction hardening — adversarial-input proof (no vulnerable
// sibling path exists to diff against; see the module doc).
// ---------------------------------------------------------------------

#[test]
fn argv_elements_containing_shell_metacharacters_are_never_shell_interpreted() {
    let marker_dir = TempDir::new().expect("tempdir");
    let canary = marker_dir
        .path()
        .join("should-not-exist-if-args-array-is-honored");
    // One whole argv element containing `;`, `&&` and `$(...)` all at once —
    // if this were ever handed to a shell for interpretation (instead of
    // reaching the child as a single literal string), any one of these would
    // execute `touch` against the canary path.
    let hostile_arg = format!(
        "; touch {} && echo pwned $(touch {}.also-should-not-exist)",
        canary.display(),
        canary.display()
    );
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec![
            "-c".to_owned(),
            // `"$@"` iterates the positional args *after* $0 — each one
            // printed verbatim, proving whatever this test fixture receives
            // arrives unmangled, one argv element at a time.
            "for arg in \"$@\"; do printf '%s\\n' \"$arg\" 1>&2; done".to_owned(),
            "sh".to_owned(),
            hostile_arg.clone(),
        ],
    };
    let cancel = AtomicBool::new(false);
    let error = spawn_adapter_sync(&descriptor, &cancel)
        .expect_err("a trivial for-loop-then-exit script is reported as a startup crash");
    assert_eq!(error.code(), "DEBUG_ADAPTER_STARTUP_CRASHED");
    assert!(
        error.message().contains(&hostile_arg),
        "the hostile argv element must arrive as one literal, unmangled string: {}",
        error.message()
    );
    assert!(
        !canary.exists(),
        "embedded shell metacharacters inside a single argv element must never be executed"
    );
    assert!(
        !Path::new(&format!("{}.also-should-not-exist", canary.display())).exists(),
        "the embedded $(...) command substitution must never be executed either"
    );
}

// ---------------------------------------------------------------------
// Trust gate — "never spawns when untrusted" proof (canary file), plus its
// positive-control counterpart.
// ---------------------------------------------------------------------

fn unconfirmed_confirmation_service() -> (TempDir, ConfirmationService) {
    let base = TempDir::new().unwrap();
    let confirmation = ConfirmationService::new(base.path().to_path_buf());
    (base, confirmation)
}

#[test]
fn spawn_adapter_never_spawns_a_child_process_when_the_workspace_is_untrusted() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
    assert!(
        !canary.exists(),
        "an untrusted workspace must never spawn the adapter process at all, not merely return an error"
    );
}

#[test]
fn spawn_adapter_rejects_the_empty_workspace_without_spawning() {
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");
    let workspace = WorkspaceService::new();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();
    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "WORKSPACE_NOT_TRUSTED");
    assert!(!canary.exists());
}

// ---------------------------------------------------------------------
// Confirmation gate — "never spawns when trusted but unconfirmed" proof
// (canary file), plus its positive-control counterpart. Trust alone is not
// enough: this proves the *second* gate independently stops the spawn even
// once the *first* gate (trust) has already been satisfied.
// ---------------------------------------------------------------------

#[test]
fn spawn_adapter_never_spawns_when_trusted_but_not_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(
        !canary.exists(),
        "an unconfirmed (command, args, transport) triple must never spawn, even in a trusted workspace"
    );
}

/// Positive control: the *same* fixture descriptor, with real trust granted
/// AND the exact matching subject confirmed, genuinely does spawn and does
/// touch the canary — proving the negative result above means "the
/// confirmation gate stopped it", not "this fixture never runs regardless".
#[test]
fn spawn_adapter_positive_control_the_same_descriptor_does_spawn_once_trusted_and_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    // A `touch`-only script exits almost immediately, so this is reported as
    // a startup crash — expected, and beside the point of this test: what
    // matters here is only that the fixture command genuinely ran.
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_STARTUP_CRASHED");
    assert!(
        canary.exists(),
        "with real trust granted and the matching subject confirmed, the identical descriptor's fixture command must actually run"
    );
}

/// A confirmation granted for a *different* argv must not silently cover this
/// descriptor — the spawn-level analogue of `confirm::tests`'s own
/// per-component sensitivity proofs, exercised through the full gated entry
/// point rather than the confirmation service alone.
#[test]
fn spawn_adapter_rejects_a_descriptor_whose_args_differ_from_what_was_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let confirmed_descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), "exit 0".to_owned()],
    };
    block_on(confirmation.grant(
        &workspace,
        "main",
        &confirmed_descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("confirmation grant succeeds");

    let edited_descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &edited_descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(
        !canary.exists(),
        "confirming one argv must never silently authorize spawning a descriptor with different args"
    );
}

// ---------------------------------------------------------------------
// `F100` S5 — `spawn_adapter_as_tcp_companion`: the `Tcp`-confirmed
// companion-spawn primitive. The two tests below are the confirmation-
// identity-isolation proof `debug::mod`'s own module doc calls for —
// same descriptor, same trusted workspace, only the confirmed *transport
// variant* differs, with the opposite outcome each time — plus a positive
// control proving the matching-variant case genuinely does spawn.
// ---------------------------------------------------------------------

#[test]
fn spawn_adapter_as_tcp_companion_rejects_a_subject_confirmed_only_for_stdio_transport() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    // Confirmed for `Stdio` only — never for `Tcp`.
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Stdio),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter_as_tcp_companion(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(
        !canary.exists(),
        "a confirmation granted only for the Stdio transport variant must never be silently \
         reused to authorize a Tcp-companion spawn of the identical (command, args)"
    );
}

/// The exact reverse of the test above — a subject confirmed only for `Tcp`
/// must not authorize an ordinary (`Stdio`-transport) [`spawn_adapter`] call
/// either. Together the pair proves the isolation holds in both directions,
/// not just the one this slice's own task instructions happened to name
/// first.
#[test]
fn spawn_adapter_rejects_a_subject_confirmed_only_for_tcp_transport() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-not-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    // Confirmed for `Tcp` only — never for `Stdio`.
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Tcp),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_NOT_CONFIRMED");
    assert!(
        !canary.exists(),
        "a confirmation granted only for the Tcp transport variant must never be silently \
         reused to authorize an ordinary Stdio spawn_adapter call of the identical (command, args)"
    );
}

/// Positive control for the pair above: the *same* descriptor, with real
/// trust granted and the exact matching `Tcp` subject confirmed, genuinely
/// does spawn via [`spawn_adapter_as_tcp_companion`] — proving the negative
/// results above mean "the wrong confirmation variant was rejected", not
/// "this fixture never runs regardless".
#[test]
fn spawn_adapter_as_tcp_companion_positive_control_spawns_once_trusted_and_tcp_confirmed() {
    let root = TempDir::new().unwrap();
    let trust_base = TempDir::new().unwrap();
    let canary_dir = TempDir::new().unwrap();
    let canary = canary_dir.path().join("should-exist");

    let workspace = workspace_with_root("main", root.path());
    let trust = TrustService::new(trust_base.path().to_path_buf());
    block_on(trust.grant(&workspace, "main")).expect("grant succeeds");
    let (_confirm_base, confirmation) = unconfirmed_confirmation_service();

    let descriptor = AdapterSpawnDescriptor {
        command: "/bin/sh".to_owned(),
        args: vec!["-c".to_owned(), format!(": > '{}'", canary.display())],
    };
    block_on(confirmation.grant(
        &workspace,
        "main",
        &descriptor.confirmation_subject(AdapterTransportKind::Tcp),
    ))
    .expect("confirmation grant succeeds");

    let cancel = Arc::new(AtomicBool::new(false));
    let result = block_on(spawn_adapter_as_tcp_companion(
        &trust,
        &workspace,
        "main",
        &confirmation,
        &descriptor,
        cancel,
    ));
    // A `touch`-only script exits almost immediately, so this is reported as
    // a startup crash — expected, and beside the point of this test: what
    // matters here is only that the fixture command genuinely ran.
    assert_eq!(result.unwrap_err().code(), "DEBUG_ADAPTER_STARTUP_CRASHED");
    assert!(
        canary.exists(),
        "with real trust granted and the matching Tcp subject confirmed, spawn_adapter_as_tcp_companion must actually run the fixture command"
    );
}
