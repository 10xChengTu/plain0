use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File, OpenOptions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;
use crate::workspace::WorkspaceRootsIdentity;

use super::dto::{LayoutStorageEntry, LayoutStorageScope, LayoutStorageSnapshot};
use super::{layout_invalid, layout_too_large, layout_unavailable};

const LAYOUT_DIRECTORY: &str = "layout";
const PROFILE_FILE: &str = "profile.json";
const STORED_SCHEMA_VERSION: u8 = 1;
const MAX_STORED_BYTES: u64 = 640 * 1024;
const STAGE_PREFIX: &str = ".plain-layout-stage-";
const CORRUPT_PREFIX: &str = ".plain-layout-corrupt-";
const MAX_STAGING_ATTEMPTS: usize = 16;

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredLayout {
    schema_version: u8,
    entries: Vec<LayoutStorageEntry>,
}

pub struct LayoutService {
    state: Arc<LayoutState>,
}

struct LayoutState {
    base_path: PathBuf,
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
}

impl LayoutService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(LayoutState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
            }),
        }
    }

    pub(crate) async fn read(
        &self,
        workspace_identity: Option<WorkspaceRootsIdentity>,
    ) -> Result<LayoutStorageSnapshot, CommandError> {
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            let mut entries = read_file(&root, PROFILE_FILE, LayoutStorageScope::Profile)?;
            if let Some(ref identity) = workspace_identity {
                entries.extend(read_file(
                    &root,
                    &workspace_file_name(identity),
                    LayoutStorageScope::Workspace,
                )?);
            }
            let snapshot = LayoutStorageSnapshot::new(workspace_identity.is_some(), entries);
            snapshot.validate()?;
            Ok(snapshot)
        })
        .await
        .map_err(|_| layout_unavailable())?
    }

    pub(crate) async fn write(
        &self,
        workspace_identity: Option<WorkspaceRootsIdentity>,
        entries: Vec<LayoutStorageEntry>,
    ) -> Result<(), CommandError> {
        LayoutStorageSnapshot::new(workspace_identity.is_some(), entries.clone()).validate()?;
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            let mut profile = Vec::new();
            let mut workspace = Vec::new();
            for entry in entries {
                match entry.scope() {
                    LayoutStorageScope::Profile => profile.push(entry),
                    LayoutStorageScope::Workspace => workspace.push(entry),
                }
            }
            if workspace_identity.is_none() && !workspace.is_empty() {
                return Err(layout_invalid());
            }
            write_file(&root, PROFILE_FILE, &profile)?;
            if let Some(identity) = workspace_identity {
                write_file(&root, &workspace_file_name(&identity), &workspace)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| layout_unavailable())?
    }
}

impl LayoutState {
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut cached = self.root.lock().map_err(|_| layout_unavailable())?;
        if let Some(root) = cached.as_ref() {
            return root.try_clone().map_err(|_| layout_unavailable());
        }
        let path = self.base_path.join(LAYOUT_DIRECTORY);
        ensure_directory_ambiently(&path).map_err(|_| layout_unavailable())?;
        let root =
            Dir::open_ambient_dir(&path, ambient_authority()).map_err(|_| layout_unavailable())?;
        let clone = root.try_clone().map_err(|_| layout_unavailable())?;
        *cached = Some(root);
        Ok(clone)
    }
}

fn workspace_file_name(identity: &WorkspaceRootsIdentity) -> String {
    format!("workspace-{}.json", identity.as_dir_name())
}

fn read_file(
    root: &Dir,
    file_name: &str,
    expected_scope: LayoutStorageScope,
) -> Result<Vec<LayoutStorageEntry>, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = match root.open_with(file_name, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(layout_unavailable()),
    };
    let metadata = file.metadata().map_err(|_| layout_unavailable())?;
    if !metadata.is_file() {
        return Err(layout_unavailable());
    }
    if metadata.len() > MAX_STORED_BYTES {
        quarantine(root, file_name)?;
        return Ok(Vec::new());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| layout_unavailable())?;
    let Some(stored) = serde_json::from_slice::<StoredLayout>(&bytes).ok() else {
        quarantine(root, file_name)?;
        return Ok(Vec::new());
    };
    let snapshot = LayoutStorageSnapshot::new(
        expected_scope == LayoutStorageScope::Workspace,
        stored.entries,
    );
    if stored.schema_version != STORED_SCHEMA_VERSION
        || snapshot.validate().is_err()
        || snapshot
            .entries()
            .iter()
            .any(|entry| entry.scope() != expected_scope)
    {
        quarantine(root, file_name)?;
        return Ok(Vec::new());
    }
    Ok(snapshot.into_entries())
}

fn quarantine(root: &Dir, file_name: &str) -> Result<(), CommandError> {
    let target = format!("{CORRUPT_PREFIX}{}.json", Uuid::new_v4().simple());
    root.rename(file_name, root, target)
        .map_err(|_| layout_unavailable())
}

fn write_file(
    root: &Dir,
    file_name: &str,
    entries: &[LayoutStorageEntry],
) -> Result<(), CommandError> {
    let payload = serde_json::to_vec(&StoredLayout {
        schema_version: STORED_SCHEMA_VERSION,
        entries: entries.to_vec(),
    })
    .map_err(|_| layout_unavailable())?;
    if payload.len() as u64 > MAX_STORED_BYTES {
        return Err(layout_too_large());
    }
    let mut stage = create_stage(root)?;
    stage
        .file
        .write_all(&payload)
        .map_err(|_| layout_unavailable())?;
    stage.file.sync_all().map_err(|_| layout_unavailable())?;
    verify_stage(&mut stage.file, &payload)?;
    root.rename(&stage.name, root, file_name)
        .map_err(|_| layout_unavailable())?;
    stage.published = true;
    Ok(())
}

struct Stage<'a> {
    root: &'a Dir,
    name: PathBuf,
    file: File,
    published: bool,
}

impl Drop for Stage<'_> {
    fn drop(&mut self) {
        if !self.published {
            let _ = self.root.remove_file(&self.name);
        }
    }
}

fn create_stage(root: &Dir) -> Result<Stage<'_>, CommandError> {
    for _ in 0..MAX_STAGING_ATTEMPTS {
        let name = PathBuf::from(format!("{STAGE_PREFIX}{}.tmp", Uuid::new_v4().simple()));
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        match root.open_with(&name, &options) {
            Ok(file) => {
                return Ok(Stage {
                    root,
                    name,
                    file,
                    published: false,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(layout_unavailable()),
        }
    }
    Err(layout_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| layout_unavailable())?;
    let mut observed = Vec::with_capacity(expected.len());
    file.read_to_end(&mut observed)
        .map_err(|_| layout_unavailable())?;
    if observed.len() == expected.len()
        && Sha256::digest(&observed).as_slice() == Sha256::digest(expected).as_slice()
    {
        Ok(())
    } else {
        Err(layout_unavailable())
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
    mutex.lock().map_err(|_| layout_unavailable())
}

#[cfg(test)]
mod tests;
