use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_std::ambient_authority;
use cap_std::fs::Dir;

use crate::backup::{store, BackupKey};
use crate::error::CommandError;

use super::{
    scratch_too_large, scratch_unavailable, ScratchId, MAX_SCRATCH_ENTRIES, MAX_SCRATCH_ENTRY_BYTES,
};

pub struct ScratchService {
    state: Arc<ScratchState>,
}

struct ScratchState {
    base_path: PathBuf,
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
    owners: Mutex<HashMap<ScratchId, String>>,
}

impl ScratchService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(ScratchState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
                owners: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn create(&self, window_label: &str) -> Result<ScratchId, CommandError> {
        let mut owners = lock(&self.state.owners)?;
        for _ in 0..16 {
            let scratch_id = ScratchId::new();
            if let std::collections::hash_map::Entry::Vacant(entry) = owners.entry(scratch_id) {
                entry.insert(window_label.to_owned());
                return Ok(scratch_id);
            }
        }
        Err(scratch_unavailable())
    }

    pub async fn write(
        &self,
        window_label: &str,
        scratch_id: ScratchId,
        content: Vec<u8>,
    ) -> Result<(), CommandError> {
        if content.len() > MAX_SCRATCH_ENTRY_BYTES {
            return Err(scratch_too_large());
        }
        self.ensure_owner(window_label, scratch_id)?;
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root(true)?.ok_or_else(scratch_unavailable)?;
            store::write_entry(&root, &storage_key(scratch_id)?, &content).map_err(map_store_error)
        })
        .await
        .map_err(|_| scratch_unavailable())?
    }

    pub async fn read_all(
        &self,
        window_label: &str,
    ) -> Result<Vec<(ScratchId, Vec<u8>)>, CommandError> {
        let state = Arc::clone(&self.state);
        let window_label = window_label.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let Some(root) = state.ensure_root(false)? else {
                return Ok(Vec::new());
            };
            let stored = store::read_all_entries(&root).map_err(map_store_error)?;
            if stored.len() > MAX_SCRATCH_ENTRIES {
                return Err(scratch_unavailable());
            }
            let mut owners = lock(&state.owners)?;
            let mut result = Vec::new();
            for (wire, content) in stored {
                let Ok(scratch_id) = ScratchId::parse_v4_wire(&wire) else {
                    continue;
                };
                let owner = owners
                    .entry(scratch_id)
                    .or_insert_with(|| window_label.clone());
                if owner == &window_label {
                    result.push((scratch_id, content));
                }
            }
            result.sort_by_key(|(scratch_id, _)| *scratch_id);
            Ok(result)
        })
        .await
        .map_err(|_| scratch_unavailable())?
    }

    pub async fn discard(
        &self,
        window_label: &str,
        scratch_id: ScratchId,
    ) -> Result<(), CommandError> {
        self.ensure_owner(window_label, scratch_id)?;
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            if let Some(root) = state.ensure_root(false)? {
                store::discard_entry(&root, &storage_key(scratch_id)?).map_err(map_store_error)?;
            }
            lock(&state.owners)?.remove(&scratch_id);
            Ok(())
        })
        .await
        .map_err(|_| scratch_unavailable())?
    }

    pub async fn discard_all(&self, window_label: &str) -> Result<(), CommandError> {
        let state = Arc::clone(&self.state);
        let window_label = window_label.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let ids = lock(&state.owners)?
                .iter()
                .filter_map(|(scratch_id, owner)| (owner == &window_label).then_some(*scratch_id))
                .collect::<Vec<_>>();
            if let Some(root) = state.ensure_root(false)? {
                for scratch_id in &ids {
                    store::discard_entry(&root, &storage_key(*scratch_id)?)
                        .map_err(map_store_error)?;
                }
            }
            let mut owners = lock(&state.owners)?;
            for scratch_id in ids {
                owners.remove(&scratch_id);
            }
            Ok(())
        })
        .await
        .map_err(|_| scratch_unavailable())?
    }

    pub fn close_window(&self, window_label: &str) {
        let mut owners = self
            .state
            .owners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        owners.retain(|_, owner| owner != window_label);
    }

    fn ensure_owner(&self, window_label: &str, scratch_id: ScratchId) -> Result<(), CommandError> {
        let owners = lock(&self.state.owners)?;
        match owners.get(&scratch_id) {
            Some(owner) if owner == window_label => Ok(()),
            _ => Err(scratch_unavailable()),
        }
    }
}

impl ScratchState {
    fn ensure_root(&self, create: bool) -> Result<Option<Dir>, CommandError> {
        let mut slot = lock(&self.root)?;
        if let Some(root) = slot.as_ref() {
            return root
                .try_clone()
                .map(Some)
                .map_err(|_| scratch_unavailable());
        }
        let path = self.base_path.join("scratch");
        if create {
            ensure_directory_ambiently(&path).map_err(|_| scratch_unavailable())?;
        } else if !path.exists() {
            return Ok(None);
        }
        let root =
            Dir::open_ambient_dir(&path, ambient_authority()).map_err(|_| scratch_unavailable())?;
        let clone = root.try_clone().map_err(|_| scratch_unavailable())?;
        *slot = Some(root);
        Ok(Some(clone))
    }
}

fn storage_key(scratch_id: ScratchId) -> Result<BackupKey, CommandError> {
    BackupKey::parse(&scratch_id.as_wire()).map_err(|_| scratch_unavailable())
}

fn map_store_error(error: CommandError) -> CommandError {
    if error.code() == "BACKUP_TOO_LARGE" {
        scratch_too_large()
    } else {
        scratch_unavailable()
    }
}

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
    mutex.lock().map_err(|_| scratch_unavailable())
}

#[cfg(test)]
mod tests {
    use std::future::Future;

    use tempfile::TempDir;

    use super::ScratchService;

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn scratch_round_trip_is_owned_by_one_window_and_survives_service_restart() {
        let base = TempDir::new().unwrap();
        let service = ScratchService::new(base.path().to_path_buf());
        let id = service.create("main").unwrap();
        block_on(service.write("main", id, b"draft".to_vec())).unwrap();
        assert_eq!(
            block_on(service.read_all("main")).unwrap(),
            vec![(id, b"draft".to_vec())]
        );
        assert!(block_on(service.read_all("second")).unwrap().is_empty());

        drop(service);
        let restarted = ScratchService::new(base.path().to_path_buf());
        assert_eq!(
            block_on(restarted.read_all("main")).unwrap(),
            vec![(id, b"draft".to_vec())]
        );
        block_on(restarted.discard("main", id)).unwrap();
        assert!(block_on(restarted.read_all("main")).unwrap().is_empty());
    }

    #[test]
    fn close_releases_ownership_without_deleting_bytes() {
        let base = TempDir::new().unwrap();
        let service = ScratchService::new(base.path().to_path_buf());
        let id = service.create("first").unwrap();
        block_on(service.write("first", id, b"kept".to_vec())).unwrap();
        service.close_window("first");
        assert_eq!(
            block_on(service.read_all("second")).unwrap(),
            vec![(id, b"kept".to_vec())]
        );
    }

    #[test]
    fn guessed_or_cross_window_ids_fail_closed() {
        let base = TempDir::new().unwrap();
        let service = ScratchService::new(base.path().to_path_buf());
        let id = service.create("main").unwrap();
        assert_eq!(
            block_on(service.write("other", id, b"no".to_vec()))
                .unwrap_err()
                .code(),
            "SCRATCH_UNAVAILABLE"
        );
        assert_eq!(
            block_on(service.discard("other", id)).unwrap_err().code(),
            "SCRATCH_UNAVAILABLE"
        );
    }

    #[test]
    fn discard_all_only_removes_the_calling_windows_entries() {
        let base = TempDir::new().unwrap();
        let service = ScratchService::new(base.path().to_path_buf());
        let first = service.create("first").unwrap();
        let second = service.create("second").unwrap();
        block_on(service.write("first", first, b"one".to_vec())).unwrap();
        block_on(service.write("second", second, b"two".to_vec())).unwrap();
        block_on(service.discard_all("first")).unwrap();
        assert!(block_on(service.read_all("first")).unwrap().is_empty());
        assert_eq!(
            block_on(service.read_all("second")).unwrap(),
            vec![(second, b"two".to_vec())]
        );
    }
}
