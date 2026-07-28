//! `F100` S1 first-run adapter-execution confirmation gate — the second,
//! independent gate ADR 0003 requires beyond workspace trust ("workspace 未
//! 信任或首次执行 adapter 时要求确认"): even inside an already-trusted
//! workspace, the *first* time a specific `(command, args, transport)` triple
//! (see [`super::dto::AdapterConfirmationSubject`]) is about to be spawned or
//! connected to, the user must explicitly confirm it — and that decision is
//! then persisted per-workspace-identity so it is not asked again for the
//! exact same triple.
//!
//! # Why this is its own domain-scoped service, not folded into `trust::`
//!
//! Unlike `trust::` (one flat yes/no fact per workspace identity — see that
//! module's own doc comment), this gate needs a *set* of independently
//! granted/revoked identities per workspace (a workspace can have many
//! distinct confirmed adapter descriptors), so it needs
//! [`BackupService`](crate::backup::service::BackupService)'s
//! per-identity-subdirectory storage shape, not `TrustService`'s single flat
//! file. It stays inside `debug::` rather than becoming a fourth top-level
//! domain because — unlike trust, which `terminal`/`git`/`debug` all
//! independently gate spawns on — nothing outside `debug::` needs this
//! concept.
//!
//! # Persistence key: [`crate::workspace::WorkspaceRootsIdentity`]
//!
//! Exactly like `BackupService`/`TrustService`, confirmations are scoped to
//! the window's current stable roots identity, not the per-session
//! `WorkspaceId` — reopening the same root set (any window, any process,
//! after a restart) reproduces the same confirmation decisions; changing the
//! root set always starts from a clean slate.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;
use crate::workspace::WorkspaceRootsIdentity;

use super::confirmation_unavailable;
use super::dto::AdapterConfirmationSubject;
use super::{confirm_store as store, debug_adapter_not_confirmed};

/// Rust-authoritative first-run confirmation domain, scoped to
/// `<app_local_data_dir>/debug-adapter-confirmations/<stable-roots-identity>/`
/// — see the module doc for why this mirrors `BackupService`'s layout rather
/// than `TrustService`'s.
pub struct ConfirmationService {
    state: Arc<ConfirmationState>,
}

struct ConfirmationState {
    base_path: PathBuf,
    /// Serializes every grant/revoke read-modify-write cycle, mirroring
    /// `TrustState::gate`/`BackupState::gate`'s exact rationale.
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
    window_dirs: Mutex<HashMap<String, WindowConfirmationDir>>,
}

struct WindowConfirmationDir {
    identity: WorkspaceRootsIdentity,
    dir: Dir,
}

impl ConfirmationService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(ConfirmationState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
                window_dirs: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// `false` for the `EMPTY` workspace (no stable identity — nothing can
    /// ever have been confirmed) without touching disk, exactly mirroring
    /// `TrustService::is_trusted`'s identical precedent.
    pub(crate) async fn is_confirmed(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        subject: &AdapterConfirmationSubject,
    ) -> Result<bool, CommandError> {
        let Some(identity) = workspace.stable_identity(window_label)? else {
            return Ok(false);
        };
        let subject = subject.clone();
        let state = Arc::clone(&self.state);
        let window_label = window_label.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            match state.workspace_dir(&window_label, identity, false)? {
                Some(dir) => Ok(store::entry_exists(&dir, &subject)),
                None => Ok(false),
            }
        })
        .await
        .map_err(|_| confirmation_unavailable())?
    }

    /// [`Self::is_confirmed`], turned into the fail-closed gate
    /// [`super::exec::spawn_adapter`]/[`super::tcp::connect_adapter`] call
    /// immediately after `trust.require_trusted` — `Ok(())` only if `subject`
    /// has already been confirmed for the current workspace, otherwise
    /// [`debug_adapter_not_confirmed`] (never a bare `false` a caller could
    /// forget to check).
    pub(crate) async fn require_confirmed(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        subject: &AdapterConfirmationSubject,
    ) -> Result<(), CommandError> {
        if self.is_confirmed(workspace, window_label, subject).await? {
            Ok(())
        } else {
            Err(debug_adapter_not_confirmed())
        }
    }

    /// Grants confirmation for `subject`, scoped to the window's current
    /// stable identity. Fails with `DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE`
    /// for the `EMPTY` workspace: there is no stable identity to record a
    /// grant against.
    pub(crate) async fn grant(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        subject: &AdapterConfirmationSubject,
    ) -> Result<(), CommandError> {
        let identity = workspace
            .stable_identity(window_label)?
            .ok_or_else(confirmation_unavailable)?;
        let subject = subject.clone();
        let state = Arc::clone(&self.state);
        let window_label = window_label.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let dir = state
                .workspace_dir(&window_label, identity, true)?
                .ok_or_else(confirmation_unavailable)?;
            store::write_entry(&dir, &subject)
        })
        .await
        .map_err(|_| confirmation_unavailable())?
    }

    /// Revokes confirmation for `subject`. Idempotent: revoking a subject
    /// that was never (or no longer) confirmed succeeds silently, mirroring
    /// `TrustService::revoke`. Fails with
    /// `DEBUG_ADAPTER_CONFIRMATION_UNAVAILABLE` for the `EMPTY` workspace,
    /// same as [`Self::grant`].
    pub(crate) async fn revoke(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        subject: &AdapterConfirmationSubject,
    ) -> Result<(), CommandError> {
        let identity = workspace
            .stable_identity(window_label)?
            .ok_or_else(confirmation_unavailable)?;
        let subject = subject.clone();
        let state = Arc::clone(&self.state);
        let window_label = window_label.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            match state.workspace_dir(&window_label, identity, false)? {
                Some(dir) => store::discard_entry(&dir, &subject),
                None => Ok(()),
            }
        })
        .await
        .map_err(|_| confirmation_unavailable())?
    }

    /// Drops this window's cached confirmation directory handle. Disk content
    /// is left untouched — mirrors `BackupService::close_window` exactly.
    pub fn close_window(&self, window_label: &str) {
        let mut window_dirs = self
            .state
            .window_dirs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        window_dirs.remove(window_label);
    }
}

impl ConfirmationState {
    fn workspace_dir(
        &self,
        window_label: &str,
        identity: WorkspaceRootsIdentity,
        create: bool,
    ) -> Result<Option<Dir>, CommandError> {
        {
            let cache = lock(&self.window_dirs)?;
            if let Some(cached) = cache.get(window_label) {
                if cached.identity == identity {
                    return cached
                        .dir
                        .try_clone()
                        .map(Some)
                        .map_err(|_| confirmation_unavailable());
                }
            }
        }

        let root = self.ensure_root()?;
        let name = identity.as_dir_name();
        let dir = if create {
            match root.create_dir(name) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(confirmation_unavailable()),
            }
            Some(
                root.open_dir(name)
                    .map_err(|_| confirmation_unavailable())?,
            )
        } else {
            match root.open_dir(name) {
                Ok(dir) => Some(dir),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err(confirmation_unavailable()),
            }
        };

        if let Some(dir) = &dir {
            let cached = dir.try_clone().map_err(|_| confirmation_unavailable())?;
            let mut cache = lock(&self.window_dirs)?;
            cache.insert(
                window_label.to_owned(),
                WindowConfirmationDir {
                    identity,
                    dir: cached,
                },
            );
        }
        Ok(dir)
    }

    /// The sole ambient directory open for the whole confirmation domain —
    /// created (if missing) and opened once, then cached, mirroring
    /// `BackupState::ensure_root`/`TrustState::ensure_root`.
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut root = lock(&self.root)?;
        if let Some(dir) = root.as_ref() {
            return dir.try_clone().map_err(|_| confirmation_unavailable());
        }
        let confirmations_path = self.base_path.join("debug-adapter-confirmations");
        ensure_directory_ambiently(&confirmations_path).map_err(|_| confirmation_unavailable())?;
        let dir = Dir::open_ambient_dir(&confirmations_path, ambient_authority())
            .map_err(|_| confirmation_unavailable())?;
        let clone = dir.try_clone().map_err(|_| confirmation_unavailable())?;
        *root = Some(dir);
        Ok(clone)
    }
}

/// Creates `path`, and any missing ancestor, one level at a time — the exact
/// duplicate of `backup::service::ensure_directory_ambiently`/
/// `trust::service::ensure_directory_ambiently` (see either's own doc comment
/// for why this small duplication is deliberate, not an oversight).
fn ensure_directory_ambiently(path: &Path) -> std::io::Result<()> {
    match std::fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| std::io::Error::from(error.kind()))?;
            ensure_directory_ambiently(parent)?;
            match std::fs::create_dir(path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error),
            }
        }
        Err(error) => Err(error),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, CommandError> {
    mutex.lock().map_err(|_| confirmation_unavailable())
}

#[cfg(test)]
mod tests;
