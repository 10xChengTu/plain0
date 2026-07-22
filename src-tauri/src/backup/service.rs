use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;
use crate::workspace::WorkspaceId;

use super::{backup_unavailable, store, BackupKey};

/// Rust-authoritative backup persistence domain, scoped to
/// `<app_local_data_dir>/backups/<workspace-id>/`.
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
    window_dirs: Mutex<HashMap<String, WindowBackupDir>>,
}

struct WindowBackupDir {
    workspace_id: WorkspaceId,
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
        key: BackupKey,
        content: Vec<u8>,
    ) -> Result<(), CommandError> {
        let workspace_id = authorized_workspace_id(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let dir = state
                .workspace_dir(&window_label, workspace_id, true)?
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
    ) -> Result<Vec<(String, Vec<u8>)>, CommandError> {
        let workspace_id = authorized_workspace_id(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            match state.workspace_dir(&window_label, workspace_id, false)? {
                Some(dir) => store::read_all_entries(&dir),
                None => Ok(Vec::new()),
            }
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    pub async fn discard(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
        key: BackupKey,
    ) -> Result<(), CommandError> {
        let workspace_id = authorized_workspace_id(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            match state.workspace_dir(&window_label, workspace_id, false)? {
                Some(dir) => store::discard_entry(&dir, &key),
                None => Ok(()),
            }
        })
        .await
        .map_err(|_| backup_unavailable())?
    }

    pub async fn discard_all(
        &self,
        workspace: &WorkspaceService,
        window_label: &str,
    ) -> Result<(), CommandError> {
        let workspace_id = authorized_workspace_id(workspace, window_label)?;
        let window_label = window_label.to_owned();
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            match state.workspace_dir(&window_label, workspace_id, false)? {
                Some(dir) => store::discard_all_entries(&dir),
                None => Ok(()),
            }
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
        window_dirs.remove(window_label);
    }
}

fn authorized_workspace_id(
    workspace: &WorkspaceService,
    window_label: &str,
) -> Result<WorkspaceId, CommandError> {
    let snapshot = workspace.snapshot(window_label)?;
    if snapshot.roots().is_empty() {
        return Err(backup_unavailable());
    }
    Ok(snapshot.workspace_id())
}

impl BackupState {
    fn workspace_dir(
        &self,
        window_label: &str,
        workspace_id: WorkspaceId,
        create: bool,
    ) -> Result<Option<Dir>, CommandError> {
        {
            let cache = lock(&self.window_dirs)?;
            if let Some(cached) = cache.get(window_label) {
                if cached.workspace_id == workspace_id {
                    return cached
                        .dir
                        .try_clone()
                        .map(Some)
                        .map_err(|_| backup_unavailable());
                }
            }
        }

        let root = self.ensure_root()?;
        let name = workspace_id.as_wire();
        let dir = if create {
            match root.create_dir(&name) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(backup_unavailable()),
            }
            Some(root.open_dir(&name).map_err(|_| backup_unavailable())?)
        } else {
            match root.open_dir(&name) {
                Ok(dir) => Some(dir),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err(backup_unavailable()),
            }
        };

        if let Some(dir) = &dir {
            let cached = dir.try_clone().map_err(|_| backup_unavailable())?;
            let mut cache = lock(&self.window_dirs)?;
            cache.insert(
                window_label.to_owned(),
                WindowBackupDir {
                    workspace_id,
                    dir: cached,
                },
            );
        }
        Ok(dir)
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
