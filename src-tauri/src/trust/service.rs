use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::{store, trust_unavailable, workspace_not_trusted};

/// Rust-authoritative execution-trust domain, scoped to
/// `<app_local_data_dir>/trust/trusted.plain.json` (see `store` for the
/// on-disk format). `.manage()`d exactly once by `lib.rs`, shared by every
/// window.
///
/// Unlike `BackupService` (one subdirectory *per* identity), this domain
/// keeps a single flat set of every identity ever granted, because trust is
/// a yes/no fact about an identity rather than per-identity content — see
/// `store`'s module doc for the full rationale.
pub struct TrustService {
    state: Arc<TrustState>,
}

struct TrustState {
    base_path: PathBuf,
    /// Serializes every grant/revoke read-modify-write cycle across all
    /// windows — the read-then-insert-or-remove-then-write sequence in
    /// [`TrustService::grant`]/[`TrustService::revoke`] is not safe to run
    /// concurrently against the same on-disk set without this, mirroring
    /// `BackupState::gate`'s exact rationale (a single domain-wide gate,
    /// not a per-window one, because the underlying storage is one file
    /// shared by every window/identity). Plain reads (`is_trusted`) do not
    /// take this gate: the staged-atomic-write publish in `store` already
    /// guarantees a concurrent reader only ever observes a fully-written
    /// old or new file, never a torn one.
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
}

impl TrustService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(TrustState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
            }),
        }
    }

    /// `false` for the `EMPTY` workspace (no authorized roots — there is no
    /// stable identity to look up, so nothing can ever be trusted) without
    /// touching disk at all; otherwise reads the persisted trusted-identity
    /// set and reports whether the window's current
    /// [`crate::workspace::WorkspaceRootsIdentity`] is a member.
    pub async fn is_trusted(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<bool, CommandError> {
        let Some(identity) = workspace.stable_identity(window_label)? else {
            return Ok(false);
        };
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let root = state.ensure_root()?;
            let trusted = store::read_trusted(&root);
            Ok(trusted.contains(identity.as_dir_name()))
        })
        .await
        .map_err(|_| trust_unavailable())?
    }

    /// [`Self::is_trusted`], turned into the fail-closed gate every
    /// subprocess-spawning domain (PTY here; Git/DAP in later features) must
    /// call before ever constructing a spawn command: `Ok(())` only if the
    /// window's current workspace is trusted, otherwise
    /// `WORKSPACE_NOT_TRUSTED` — never a bare `false` a caller could
    /// forget to check.
    pub async fn require_trusted(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<(), CommandError> {
        if self.is_trusted(workspace, window_label).await? {
            Ok(())
        } else {
            Err(workspace_not_trusted())
        }
    }

    /// Grants trust to the window's current identity. Fails with
    /// `TRUST_UNAVAILABLE` for the `EMPTY` workspace: there is no stable
    /// identity to record a grant against.
    pub async fn grant(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<(), CommandError> {
        let identity = workspace
            .stable_identity(window_label)?
            .ok_or_else(trust_unavailable)?;
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            let mut trusted = store::read_trusted(&root);
            trusted.insert(identity.as_dir_name().to_owned());
            store::write_trusted(&root, &trusted)
        })
        .await
        .map_err(|_| trust_unavailable())?
    }

    /// Revokes trust for the window's current identity. Idempotent: revoking
    /// an identity that was never (or no longer) trusted succeeds silently,
    /// mirroring `backup::store::discard_entry`'s own idempotent-removal
    /// precedent. Fails with `TRUST_UNAVAILABLE` for the `EMPTY` workspace,
    /// same as [`Self::grant`].
    pub async fn revoke(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<(), CommandError> {
        let identity = workspace
            .stable_identity(window_label)?
            .ok_or_else(trust_unavailable)?;
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            let mut trusted = store::read_trusted(&root);
            trusted.remove(identity.as_dir_name());
            store::write_trusted(&root, &trusted)
        })
        .await
        .map_err(|_| trust_unavailable())?
    }
}

impl TrustState {
    /// The sole ambient directory open for the whole trust domain: created
    /// (if missing) and opened once, then cached — identical pattern to
    /// `backup::service::BackupState::ensure_root`.
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut root = lock(&self.root)?;
        if let Some(dir) = root.as_ref() {
            return dir.try_clone().map_err(|_| trust_unavailable());
        }
        let trust_path = self.base_path.join("trust");
        ensure_directory_ambiently(&trust_path).map_err(|_| trust_unavailable())?;
        let dir = Dir::open_ambient_dir(&trust_path, ambient_authority())
            .map_err(|_| trust_unavailable())?;
        let clone = dir.try_clone().map_err(|_| trust_unavailable())?;
        *root = Some(dir);
        Ok(clone)
    }
}

/// Creates `path`, and any missing ancestor, one level at a time — the exact
/// duplicate of `backup::service::ensure_directory_ambiently`. Not factored
/// into a shared helper: it is four lines of recursion with no domain
/// knowledge, and introducing a cross-domain utility module purely to host
/// it would add a new shared surface both domains would need to keep in
/// sync for a helper this small, which is more indirection than the
/// duplication it would remove (the same trade-off `text_search.rs`'s module
/// doc documents for its own traversal-loop duplication).
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
    mutex.lock().map_err(|_| trust_unavailable())
}

#[cfg(test)]
mod tests;
