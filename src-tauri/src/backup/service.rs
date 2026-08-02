use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;
use crate::workspace::{RootId, WorkspaceRootsIdentity};

use super::{backup_unavailable, store, BackupKey};

/// Rust-authoritative backup persistence domain, scoped per independently
/// authorized root at
/// `<app_local_data_dir>/backups/roots/<stable-single-root-identity>/`.
///
/// The current random [`RootId`] is required on every operation, but never
/// becomes the on-disk directory name. Rust resolves it to a stable digest
/// of that exact root's canonical path. This preserves exact ownership when
/// root ids rotate after restart and keeps unchanged roots reachable across
/// add/remove/reorder topology changes. The digest and canonical path remain
/// Rust-only; read results carry only the current authorized root id.
///
/// F030's old single-root layout
/// `<app_local_data_dir>/backups/<singleton-roots-identity>/` is read and
/// discarded as a compatibility source. Because a singleton roots identity
/// is also an exact per-root identity, it can be mapped without guessing.
/// Legacy multi-root-set directories are intentionally ignored: their
/// opaque payloads never recorded which member root owned an entry.
///
/// The storage root is opened ambiently exactly once (lazily, on first use)
/// via `Dir::open_ambient_dir` and cached; every further operation, for every
/// window and workspace, is capability-relative from that single handle.
pub struct BackupService {
    state: Arc<BackupState>,
}

struct BackupState {
    base_path: PathBuf,
    /// Single domain-wide gate serializing every write/discard mutation
    /// across all windows, mirroring the workspace domain's per-window
    /// mutation gate but scoped once for the whole backup domain.
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
    window_dirs: Mutex<HashMap<(String, RootId), WindowBackupDir>>,
}

struct WindowBackupDir {
    identity: WorkspaceRootsIdentity,
    dir: Dir,
}

impl BackupService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(BackupState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
                window_dirs: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub async fn write(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        root_id: RootId,
        key: BackupKey,
        content: Vec<u8>,
    ) -> Result<(), CommandError> {
        let identity = authorized_root_identity(workspace, window_label, root_id)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let dir = state
                .root_dir(&window_label, root_id, identity, true)?
                .ok_or_else(backup_unavailable)?;
            store::write_entry(&dir, &key, &content)
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    pub async fn read_all(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<Vec<(RootId, String, Vec<u8>)>, CommandError> {
        let roots = authorized_roots(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let mut observed = BTreeMap::new();
            for (root_id, identity) in roots {
                // Legacy singleton entries are inserted first. A current v2
                // entry with the same `(root,key)` wins deterministically.
                if let Some(dir) = state.legacy_single_root_dir(&identity)? {
                    for (key, content) in store::read_all_entries(&dir)? {
                        observed.insert((root_id.as_wire(), key), (root_id, content));
                    }
                }
                if let Some(dir) = state.root_dir(&window_label, root_id, identity, false)? {
                    for (key, content) in store::read_all_entries(&dir)? {
                        observed.insert((root_id.as_wire(), key), (root_id, content));
                    }
                }
                if observed.len() > super::MAX_BACKUP_ENTRIES {
                    return Err(backup_unavailable());
                }
            }
            Ok(observed
                .into_iter()
                .map(|((_root_wire, key), (root_id, content))| (root_id, key, content))
                .collect())
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    pub async fn discard(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        root_id: RootId,
        key: BackupKey,
    ) -> Result<(), CommandError> {
        let identity = authorized_root_identity(workspace, window_label, root_id)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            if let Some(dir) = state.root_dir(&window_label, root_id, identity.clone(), false)? {
                store::discard_entry(&dir, &key)?;
            }
            if let Some(dir) = state.legacy_single_root_dir(&identity)? {
                store::discard_entry(&dir, &key)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    pub async fn discard_all(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<(), CommandError> {
        let roots = authorized_roots(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            for (root_id, identity) in roots {
                if let Some(dir) =
                    state.root_dir(&window_label, root_id, identity.clone(), false)?
                {
                    store::discard_all_entries(&dir)?;
                }
                if let Some(dir) = state.legacy_single_root_dir(&identity)? {
                    store::discard_all_entries(&dir)?;
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    /// Drops this window's cached backup directory handle. Disk content is
    /// left completely untouched so a future launch can still restore it;
    /// only the in-memory pending capability handle is released.
    pub fn close_window(&self, window_label: &str) {
        let mut window_dirs = self
            .state
            .window_dirs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        window_dirs.retain(|(candidate, _), _| candidate != window_label);
    }
}

fn authorized_roots(
    workspace: &WorkspaceService,
    window_label: &str,
) -> Result<Vec<(RootId, WorkspaceRootsIdentity)>, CommandError> {
    let roots = workspace.root_storage_identities(window_label)?;
    if roots.is_empty() {
        Err(backup_unavailable())
    } else {
        Ok(roots)
    }
}

fn authorized_root_identity(
    workspace: &WorkspaceService,
    window_label: &str,
    root_id: RootId,
) -> Result<WorkspaceRootsIdentity, CommandError> {
    authorized_roots(workspace, window_label)?
        .into_iter()
        .find_map(|(candidate, identity)| (candidate == root_id).then_some(identity))
        .ok_or_else(|| {
            CommandError::new(
                "ROOT_NOT_AUTHORIZED",
                "The workspace root is not authorized.",
            )
        })
}

impl BackupState {
    fn root_dir(
        &self,
        window_label: &str,
        root_id: RootId,
        identity: WorkspaceRootsIdentity,
        create: bool,
    ) -> Result<Option<Dir>, CommandError> {
        {
            let cache = lock(&self.window_dirs)?;
            if let Some(cached) = cache.get(&(window_label.to_owned(), root_id)) {
                if cached.identity == identity {
                    return cached
                        .dir
                        .try_clone()
                        .map(Some)
                        .map_err(|_| backup_unavailable());
                }
            }
        }

        let root = self.ensure_root()?;
        let roots = open_child_dir(&root, "roots", create)?;
        let Some(roots) = roots else { return Ok(None) };
        let name = identity.as_dir_name();
        let dir = open_child_dir(&roots, name, create)?;

        if let Some(dir) = &dir {
            let cached = dir.try_clone().map_err(|_| backup_unavailable())?;
            let mut cache = lock(&self.window_dirs)?;
            cache.insert(
                (window_label.to_owned(), root_id),
                WindowBackupDir {
                    identity,
                    dir: cached,
                },
            );
        }
        Ok(dir)
    }

    fn legacy_single_root_dir(
        &self,
        identity: &WorkspaceRootsIdentity,
    ) -> Result<Option<Dir>, CommandError> {
        open_child_dir(&self.ensure_root()?, identity.as_dir_name(), false)
    }

    /// The sole ambient directory open for the whole backup domain: the
    /// storage root is created (if missing) and opened once, then cached.
    /// Every subsequent operation, for every window and workspace, is
    /// capability-relative from the cached handle.
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut root = lock(&self.root)?;
        if let Some(dir) = root.as_ref() {
            return dir.try_clone().map_err(|_| backup_unavailable());
        }
        let backups_path = self.base_path.join("backups");
        ensure_directory_ambiently(&backups_path).map_err(|_| backup_unavailable())?;
        let dir = Dir::open_ambient_dir(&backups_path, ambient_authority())
            .map_err(|_| backup_unavailable())?;
        let clone = dir.try_clone().map_err(|_| backup_unavailable())?;
        *root = Some(dir);
        Ok(clone)
    }
}

fn open_child_dir(parent: &Dir, name: &str, create: bool) -> Result<Option<Dir>, CommandError> {
    if create {
        match parent.create_dir(name) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(backup_unavailable()),
        }
    }
    match parent.open_dir(name) {
        Ok(dir) => Ok(Some(dir)),
        Err(error) if !create && error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(backup_unavailable()),
    }
}

/// Creates `path`, and any missing ancestor, one level at a time. This is
/// deliberately not a call to an unbounded recursive helper: each level is
/// its own explicit, checked `create_dir` call, bounded by the path's actual
/// depth.
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
    mutex.lock().map_err(|_| backup_unavailable())
}

#[cfg(test)]
mod tests;
