use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File, OpenOptions};
use jsonc_parser::{parse_to_value, JsonValue, ParseOptions};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;

use super::dto::{UserDataResource, UserDataResult};
use super::{user_data_conflict, user_data_invalid, user_data_too_large, user_data_unavailable};

pub(crate) const MAX_SETTINGS_BYTES: usize = 256 * 1024;
pub(crate) const MAX_KEYBINDINGS_BYTES: usize = 512 * 1024;

const USER_DATA_DIRECTORY: &str = "user-data";
const STORED_SCHEMA_VERSION: u8 = 1;
const MAX_ENVELOPE_OVERHEAD_BYTES: u64 = 64 * 1024;
const STAGE_PREFIX: &str = ".plain-user-data-stage-";
const CORRUPT_PREFIX: &str = ".plain-user-data-corrupt-";
const MAX_STAGING_ATTEMPTS: usize = 16;

const JSONC_PARSE_OPTIONS: ParseOptions = ParseOptions {
    allow_comments: true,
    allow_trailing_commas: true,
    allow_loose_object_property_names: false,
    allow_missing_commas: false,
    allow_single_quoted_strings: false,
    allow_hexadecimal_numbers: false,
    allow_unary_plus_numbers: false,
};

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredUserData {
    schema_version: u8,
    revision: u64,
    content: String,
}

pub struct UserDataService {
    state: Arc<UserDataState>,
}

struct UserDataState {
    base_path: PathBuf,
    gate: Mutex<()>,
    root: Mutex<Option<Dir>>,
}

impl UserDataService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(UserDataState {
                base_path,
                gate: Mutex::new(()),
                root: Mutex::new(None),
            }),
        }
    }

    pub async fn read(&self, resource: UserDataResource) -> Result<UserDataResult, CommandError> {
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            read_entry(&root, resource)
        })
        .await
        .map_err(|_| user_data_unavailable())?
    }

    pub async fn write(
        &self,
        resource: UserDataResource,
        expected_revision: u64,
        content: String,
    ) -> Result<UserDataResult, CommandError> {
        let state = Arc::clone(&self.state);
        tauri::async_runtime::spawn_blocking(move || {
            let _gate = lock(&state.gate)?;
            let root = state.ensure_root()?;
            let current = read_entry(&root, resource)?;
            if current.revision() != expected_revision {
                return Err(user_data_conflict());
            }
            validate_content(resource, &content)?;
            let revision = expected_revision
                .checked_add(1)
                .ok_or_else(user_data_unavailable)?;
            write_entry(&root, resource, revision, &content)?;
            Ok(UserDataResult::new(resource, revision, content))
        })
        .await
        .map_err(|_| user_data_unavailable())?
    }
}

impl UserDataState {
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut cached = self.root.lock().map_err(|_| user_data_unavailable())?;
        if let Some(root) = cached.as_ref() {
            return root.try_clone().map_err(|_| user_data_unavailable());
        }
        let path = self.base_path.join(USER_DATA_DIRECTORY);
        ensure_directory_ambiently(&path).map_err(|_| user_data_unavailable())?;
        let root = Dir::open_ambient_dir(&path, ambient_authority())
            .map_err(|_| user_data_unavailable())?;
        let clone = root.try_clone().map_err(|_| user_data_unavailable())?;
        *cached = Some(root);
        Ok(clone)
    }
}

pub(crate) fn validate_content(
    resource: UserDataResource,
    content: &str,
) -> Result<(), CommandError> {
    if content.len() > resource.max_content_bytes() {
        return Err(user_data_too_large());
    }
    let value = parse_to_value(content, &JSONC_PARSE_OPTIONS)
        .map_err(|_| user_data_invalid())?
        .ok_or_else(user_data_invalid)?;
    let valid_shape = matches!(
        (resource, value),
        (UserDataResource::Settings, JsonValue::Object(_))
            | (UserDataResource::Keybindings, JsonValue::Array(_))
    );
    if valid_shape {
        Ok(())
    } else {
        Err(user_data_invalid())
    }
}

fn read_entry(root: &Dir, resource: UserDataResource) -> Result<UserDataResult, CommandError> {
    let file_name = resource.file_name();
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = match root.open_with(file_name, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_result(resource));
        }
        Err(_) => return Err(user_data_unavailable()),
    };
    let metadata = file.metadata().map_err(|_| user_data_unavailable())?;
    if !metadata.is_file() {
        return Err(user_data_unavailable());
    }
    if metadata.len() > resource.max_content_bytes() as u64 + MAX_ENVELOPE_OVERHEAD_BYTES {
        return quarantine_and_default(root, resource);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| user_data_unavailable())?;
    let stored = serde_json::from_slice::<StoredUserData>(&bytes).ok();
    let Some(stored) = stored else {
        return quarantine_and_default(root, resource);
    };
    if stored.schema_version != STORED_SCHEMA_VERSION
        || stored.revision == 0
        || validate_content(resource, &stored.content).is_err()
    {
        return quarantine_and_default(root, resource);
    }
    Ok(UserDataResult::new(
        resource,
        stored.revision,
        stored.content,
    ))
}

fn default_result(resource: UserDataResource) -> UserDataResult {
    UserDataResult::new(resource, 1, resource.default_content().to_owned())
}

fn quarantine_and_default(
    root: &Dir,
    resource: UserDataResource,
) -> Result<UserDataResult, CommandError> {
    let quarantine = format!(
        "{CORRUPT_PREFIX}{}-{}.json",
        resource.as_wire(),
        Uuid::new_v4().simple()
    );
    root.rename(resource.file_name(), root, &quarantine)
        .map_err(|_| user_data_unavailable())?;
    Ok(default_result(resource))
}

fn write_entry(
    root: &Dir,
    resource: UserDataResource,
    revision: u64,
    content: &str,
) -> Result<(), CommandError> {
    let payload = serde_json::to_vec(&StoredUserData {
        schema_version: STORED_SCHEMA_VERSION,
        revision,
        content: content.to_owned(),
    })
    .map_err(|_| user_data_unavailable())?;
    if payload.len() as u64 > resource.max_content_bytes() as u64 + MAX_ENVELOPE_OVERHEAD_BYTES {
        return Err(user_data_too_large());
    }

    let mut stage = create_stage(root)?;
    stage
        .file
        .write_all(&payload)
        .map_err(|_| user_data_unavailable())?;
    stage.file.sync_all().map_err(|_| user_data_unavailable())?;
    verify_stage(&mut stage.file, &payload)?;
    root.rename(&stage.name, root, resource.file_name())
        .map_err(|_| user_data_unavailable())?;
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
            Err(_) => return Err(user_data_unavailable()),
        }
    }
    Err(user_data_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| user_data_unavailable())?;
    let mut hasher = Sha256::new();
    let mut observed = 0_u64;
    let mut buffer = [0_u8; 4096];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| user_data_unavailable())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(user_data_unavailable)?;
        hasher.update(&buffer[..read]);
    }
    if observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice()
    {
        Ok(())
    } else {
        Err(user_data_unavailable())
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
    mutex.lock().map_err(|_| user_data_unavailable())
}

#[cfg(test)]
mod tests;
