//! Rust-private persistence for recent and last-opened workspace root sets.
//!
//! Canonical native paths are intentionally confined to this module's
//! app-local JSON envelope. IPC receives only opaque recent ids and display
//! labels; reopening an entry re-authorizes every stored directory before the
//! live workspace scope changes.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::CommandError;

use crate::workspace::dto::{WorkspaceRecentEntry, WorkspaceRecentId, WorkspaceRecentRemoteRoot};
use crate::workspace::MAX_WORKSPACE_ROOTS;

const HISTORY_DIRECTORY: &str = "workspace-state";
const HISTORY_FILE: &str = "workspaces.plain.json";
const HISTORY_SCHEMA_VERSION: u8 = 1;
const MAX_HISTORY_ENTRIES: usize = 20;
const MAX_HISTORY_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LABEL_BYTES: usize = 1024;
const STAGE_PREFIX: &str = ".plain-workspace-history-stage-";
const CORRUPT_PREFIX: &str = ".plain-workspace-history-corrupt-";
const MAX_STAGING_ATTEMPTS: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceHistoryRoot {
    pub(crate) canonical_path: PathBuf,
    pub(crate) display_name: String,
}

/// One remote root to record alongside a workspace's local roots — `F220`
/// S4, ADR 0007 §4. The caller (`workspace::commands::record_current_workspace`)
/// assembles this from two sources this module deliberately never depends on
/// itself: `workspace::service::WorkspaceService::remote_history_roots` (for
/// `canonical_path`/`display_name`) and `remote::session::RemoteSessionService::state`
/// (for `host`/`port`/`user`, resolved from the root's live `session_id`) —
/// this module knows nothing about `RemoteSessionService`'s existence, only
/// about these five already-resolved plain fields.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceHistoryRemoteRoot {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
    pub(crate) canonical_path: String,
    pub(crate) display_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WorkspaceHistorySnapshot {
    pub(crate) revision: u64,
    pub(crate) entries: Vec<WorkspaceRecentEntry>,
}

#[derive(Clone)]
pub struct WorkspaceHistoryService {
    state: Arc<HistoryState>,
}

struct HistoryState {
    base_path: PathBuf,
    gate: Mutex<HistoryCache>,
    root: Mutex<Option<Dir>>,
}

struct HistoryCache {
    loaded: bool,
    stored: StoredHistory,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredHistory {
    schema_version: u8,
    revision: u64,
    last_recent_id: Option<String>,
    entries: Vec<StoredRecentEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRecentEntry {
    recent_id: String,
    canonical_roots: Vec<String>,
    root_labels: Vec<String>,
    label: String,
    last_opened_unix_ms: u64,
    /// `F220` S4 addition — `#[serde(default)]` so every pre-`F220` entry an
    /// existing user's `workspaces.plain.json` already has on disk (written
    /// by a schema version that never had this field at all) deserializes
    /// with an empty `Vec` here instead of failing `deny_unknown_fields`'s
    /// sibling concern, forward-compat rejection of a *missing* field —
    /// no schema-version bump or migration code needed (see the module doc).
    #[serde(default)]
    remote_roots: Vec<StoredRecentRemoteRoot>,
}

/// On-disk twin of [`WorkspaceHistoryRemoteRoot`]/[`crate::workspace::dto::WorkspaceRecentRemoteRoot`]
/// — see either's own doc comment for the field contract (ADR 0007 §4: no
/// host-key fingerprint or any credential material, ever).
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredRecentRemoteRoot {
    host: String,
    port: u16,
    user: String,
    path: String,
    label: String,
}

impl Default for StoredHistory {
    fn default() -> Self {
        Self {
            schema_version: HISTORY_SCHEMA_VERSION,
            revision: 1,
            last_recent_id: None,
            entries: Vec::new(),
        }
    }
}

impl WorkspaceHistoryService {
    pub fn new(base_path: PathBuf) -> Self {
        Self {
            state: Arc::new(HistoryState {
                base_path,
                gate: Mutex::new(HistoryCache {
                    loaded: false,
                    stored: StoredHistory::default(),
                }),
                root: Mutex::new(None),
            }),
        }
    }

    pub(crate) fn snapshot(&self) -> Result<WorkspaceHistorySnapshot, CommandError> {
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let entries = cache
            .stored
            .entries
            .iter()
            .map(stored_entry_to_wire)
            .collect::<Result<Vec<_>, CommandError>>()?;
        drop(root);
        Ok(WorkspaceHistorySnapshot {
            revision: cache.stored.revision,
            entries,
        })
    }

    pub(crate) fn last_roots(&self) -> Result<Option<Vec<PathBuf>>, CommandError> {
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let result = cache
            .stored
            .last_recent_id
            .as_deref()
            .and_then(|recent_id| {
                cache
                    .stored
                    .entries
                    .iter()
                    .find(|entry| entry.recent_id == recent_id)
            })
            .map(stored_paths);
        drop(root);
        result.transpose()
    }

    pub(crate) fn roots_for(
        &self,
        recent_id: WorkspaceRecentId,
    ) -> Result<Vec<PathBuf>, CommandError> {
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let wire = recent_id.as_wire();
        let result = cache
            .stored
            .entries
            .iter()
            .find(|entry| entry.recent_id == wire)
            .ok_or_else(workspace_recent_not_found)
            .and_then(stored_paths);
        drop(root);
        result
    }

    /// Records the current workspace's full root set — local *and* remote
    /// halves together, since a real live [`crate::workspace::WorkspaceScope`]
    /// may hold both at once (`F220` S4, ADR 0007 §4). A workspace is only
    /// ever treated as "the same one" (reusing its existing `recent_id`
    /// rather than minting a new entry) when *both* halves match exactly —
    /// the local canonical-path list byte-for-byte (pre-existing behavior,
    /// unchanged) *and* the remote `(host, port, user, path)` list
    /// byte-for-byte (labels excluded from both comparisons, exactly like
    /// local `root_labels` already was: a display-name-only rename is not a
    /// different workspace).
    pub(crate) fn record(
        &self,
        roots: &[WorkspaceHistoryRoot],
        remote_roots: &[WorkspaceHistoryRemoteRoot],
    ) -> Result<(), CommandError> {
        validate_roots(roots, remote_roots)?;
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let mut next = cache.stored.clone();
        let next_revision = next
            .revision
            .checked_add(1)
            .ok_or_else(workspace_history_unavailable)?;

        if roots.is_empty() && remote_roots.is_empty() {
            next.last_recent_id = None;
            next.revision = next_revision;
            write_history(&root, &next)?;
            cache.stored = next;
            return Ok(());
        }

        let canonical_roots = roots
            .iter()
            .map(|root| {
                root.canonical_path
                    .to_str()
                    .map(ToOwned::to_owned)
                    .ok_or_else(workspace_history_unavailable)
            })
            .collect::<Result<Vec<_>, CommandError>>()?;
        let stored_remote_roots = remote_roots
            .iter()
            .map(|remote_root| StoredRecentRemoteRoot {
                host: remote_root.host.clone(),
                port: remote_root.port,
                user: remote_root.user.clone(),
                path: remote_root.canonical_path.clone(),
                label: remote_root.display_name.clone(),
            })
            .collect::<Vec<_>>();
        let remote_identity = remote_root_identity_keys(&stored_remote_roots);
        let existing_index = next.entries.iter().position(|entry| {
            entry.canonical_roots == canonical_roots
                && remote_root_identity_keys(&entry.remote_roots) == remote_identity
        });
        let recent_id = existing_index
            .map(|index| next.entries.remove(index).recent_id)
            .unwrap_or_else(|| WorkspaceRecentId::new().as_wire());
        let root_labels = roots
            .iter()
            .map(|root| root.display_name.clone())
            .collect::<Vec<_>>();
        let all_labels = root_labels
            .iter()
            .cloned()
            .chain(
                remote_roots
                    .iter()
                    .map(|remote_root| remote_root.display_name.clone()),
            )
            .collect::<Vec<_>>();
        let label = workspace_label(&all_labels);
        next.entries.insert(
            0,
            StoredRecentEntry {
                recent_id: recent_id.clone(),
                canonical_roots,
                root_labels,
                label,
                last_opened_unix_ms: now_unix_ms(),
                remote_roots: stored_remote_roots,
            },
        );
        next.entries.truncate(MAX_HISTORY_ENTRIES);
        next.last_recent_id = Some(recent_id);
        next.revision = next_revision;
        write_history(&root, &next)?;
        cache.stored = next;
        Ok(())
    }

    pub(crate) fn remove(&self, recent_id: WorkspaceRecentId) -> Result<(), CommandError> {
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let wire = recent_id.as_wire();
        let mut next = cache.stored.clone();
        let before = next.entries.len();
        next.entries.retain(|entry| entry.recent_id != wire);
        if next.entries.len() == before {
            return Err(workspace_recent_not_found());
        }
        if next.last_recent_id.as_deref() == Some(wire.as_str()) {
            next.last_recent_id = None;
        }
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or_else(workspace_history_unavailable)?;
        write_history(&root, &next)?;
        cache.stored = next;
        Ok(())
    }

    pub(crate) fn clear(&self) -> Result<(), CommandError> {
        let mut cache = lock(&self.state.gate)?;
        let root = self.ensure_loaded(&mut cache)?;
        let mut next = cache.stored.clone();
        next.entries.clear();
        next.last_recent_id = None;
        next.revision = next
            .revision
            .checked_add(1)
            .ok_or_else(workspace_history_unavailable)?;
        write_history(&root, &next)?;
        cache.stored = next;
        Ok(())
    }

    fn ensure_loaded(&self, cache: &mut HistoryCache) -> Result<Dir, CommandError> {
        let root = self.state.ensure_root()?;
        if !cache.loaded {
            cache.stored = read_history(&root)?;
            cache.loaded = true;
        }
        Ok(root)
    }
}

impl HistoryState {
    fn ensure_root(&self) -> Result<Dir, CommandError> {
        let mut cached = lock(&self.root)?;
        if let Some(root) = cached.as_ref() {
            return root
                .try_clone()
                .map_err(|_| workspace_history_unavailable());
        }
        let path = self.base_path.join(HISTORY_DIRECTORY);
        ensure_directory_ambiently(&path).map_err(|_| workspace_history_unavailable())?;
        let root = Dir::open_ambient_dir(&path, ambient_authority())
            .map_err(|_| workspace_history_unavailable())?;
        let clone = root
            .try_clone()
            .map_err(|_| workspace_history_unavailable())?;
        *cached = Some(root);
        Ok(clone)
    }
}

fn validate_roots(
    roots: &[WorkspaceHistoryRoot],
    remote_roots: &[WorkspaceHistoryRemoteRoot],
) -> Result<(), CommandError> {
    if roots.len() > MAX_WORKSPACE_ROOTS || remote_roots.len() > MAX_WORKSPACE_ROOTS {
        return Err(workspace_history_unavailable());
    }
    let mut paths = std::collections::BTreeSet::new();
    for root in roots {
        let Some(path) = root.canonical_path.to_str() else {
            return Err(workspace_history_unavailable());
        };
        if !root.canonical_path.is_absolute()
            || path.len() > crate::path_policy::MAX_RELATIVE_PATH_BYTES * 4
            || !paths.insert(path)
            || root.display_name.is_empty()
            || root.display_name.len() > MAX_LABEL_BYTES
        {
            return Err(workspace_history_unavailable());
        }
    }
    let mut remote_keys = std::collections::BTreeSet::new();
    for remote_root in remote_roots {
        validate_remote_root_fields(
            &remote_root.host,
            &remote_root.user,
            &remote_root.canonical_path,
            &remote_root.display_name,
        )?;
        let key = (
            remote_root.host.as_str(),
            remote_root.port,
            remote_root.user.as_str(),
            remote_root.canonical_path.as_str(),
        );
        if !remote_keys.insert(key) {
            return Err(workspace_history_unavailable());
        }
    }
    Ok(())
}

/// Shared shape check for one remote root's `(host, user, path, label)`
/// fields — used both by [`validate_roots`] (the in-memory
/// [`WorkspaceHistoryRemoteRoot`] a caller is about to record) and
/// [`validate_stored`] (a [`StoredRecentRemoteRoot`] just read back off
/// disk), so a hand-corrupted or downgraded-then-upgraded history file can
/// never smuggle in an oversized or malformed remote root any more than a
/// live `record()` call could. Reuses `remote::dto`'s own host/user length
/// ceilings and `MAX_REMOTE_PICK_PATH_CHARS` (the same bound
/// `remote_workspace_pick_directory`/`remote_workspace_add_root` already
/// apply to an absolute remote path) rather than inventing new ones; `port`
/// itself needs no check beyond its own `u16` type. `path` must start with
/// `/` — SFTP paths are always POSIX-absolute on the wire (see
/// `remote::remote_fs::join_remote_path`'s identical assumption).
fn validate_remote_root_fields(
    host: &str,
    user: &str,
    path: &str,
    label: &str,
) -> Result<(), CommandError> {
    if host.is_empty() || host.len() > crate::remote::dto::MAX_REMOTE_HOST_CHARS {
        return Err(workspace_history_unavailable());
    }
    if user.is_empty() || user.len() > crate::remote::dto::MAX_REMOTE_USER_CHARS {
        return Err(workspace_history_unavailable());
    }
    if path.is_empty()
        || !path.starts_with('/')
        || path.len() > crate::remote::dto::MAX_REMOTE_PICK_PATH_CHARS
    {
        return Err(workspace_history_unavailable());
    }
    if label.is_empty() || label.len() > MAX_LABEL_BYTES {
        return Err(workspace_history_unavailable());
    }
    Ok(())
}

/// The `(host, port, user, path)` identity every entry's remote roots are
/// deduplicated and matched by — deliberately excludes `label` (a display
/// rename is not a different workspace), mirroring `canonical_roots`
/// excluding `root_labels` from the local dedup comparison in
/// [`WorkspaceHistoryService::record`].
fn remote_root_identity_keys(
    entries: &[StoredRecentRemoteRoot],
) -> Vec<(String, u16, String, String)> {
    entries
        .iter()
        .map(|entry| {
            (
                entry.host.clone(),
                entry.port,
                entry.user.clone(),
                entry.path.clone(),
            )
        })
        .collect()
}

fn validate_stored(stored: &StoredHistory) -> Result<(), CommandError> {
    if stored.schema_version != HISTORY_SCHEMA_VERSION
        || stored.revision == 0
        || stored.entries.len() > MAX_HISTORY_ENTRIES
    {
        return Err(workspace_history_unavailable());
    }
    let mut ids = std::collections::BTreeSet::new();
    for entry in &stored.entries {
        let recent_id = WorkspaceRecentId::parse_v4_wire(&entry.recent_id)
            .map_err(|_| workspace_history_unavailable())?;
        if !ids.insert(recent_id)
            || (entry.canonical_roots.is_empty() && entry.remote_roots.is_empty())
            || entry.canonical_roots.len() > MAX_WORKSPACE_ROOTS
            || entry.remote_roots.len() > MAX_WORKSPACE_ROOTS
            || entry.canonical_roots.len() != entry.root_labels.len()
            || entry.label.is_empty()
            || entry.label.len() > MAX_LABEL_BYTES
        {
            return Err(workspace_history_unavailable());
        }
        let mut paths = std::collections::BTreeSet::new();
        for (path, label) in entry.canonical_roots.iter().zip(&entry.root_labels) {
            if !Path::new(path).is_absolute()
                || path.len() > crate::path_policy::MAX_RELATIVE_PATH_BYTES * 4
                || !paths.insert(path)
                || label.is_empty()
                || label.len() > MAX_LABEL_BYTES
            {
                return Err(workspace_history_unavailable());
            }
        }
        let mut remote_keys = std::collections::BTreeSet::new();
        for remote_root in &entry.remote_roots {
            validate_remote_root_fields(
                &remote_root.host,
                &remote_root.user,
                &remote_root.path,
                &remote_root.label,
            )?;
            let key = (
                remote_root.host.as_str(),
                remote_root.port,
                remote_root.user.as_str(),
                remote_root.path.as_str(),
            );
            if !remote_keys.insert(key) {
                return Err(workspace_history_unavailable());
            }
        }
    }
    if let Some(last) = stored.last_recent_id.as_deref() {
        let parsed =
            WorkspaceRecentId::parse_v4_wire(last).map_err(|_| workspace_history_unavailable())?;
        if !ids.contains(&parsed) {
            return Err(workspace_history_unavailable());
        }
    }
    Ok(())
}

fn stored_paths(entry: &StoredRecentEntry) -> Result<Vec<PathBuf>, CommandError> {
    entry
        .canonical_roots
        .iter()
        .map(|path| {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                Ok(path)
            } else {
                Err(workspace_history_unavailable())
            }
        })
        .collect()
}

fn stored_entry_to_wire(entry: &StoredRecentEntry) -> Result<WorkspaceRecentEntry, CommandError> {
    let remote_roots = entry
        .remote_roots
        .iter()
        .map(|remote_root| {
            WorkspaceRecentRemoteRoot::new(
                remote_root.host.clone(),
                remote_root.port,
                remote_root.user.clone(),
                remote_root.path.clone(),
                remote_root.label.clone(),
            )
        })
        .collect();
    Ok(WorkspaceRecentEntry::new(
        WorkspaceRecentId::parse_v4_wire(&entry.recent_id)
            .map_err(|_| workspace_history_unavailable())?,
        entry.label.clone(),
        entry.root_labels.clone(),
        remote_roots,
    ))
}

fn workspace_label(root_labels: &[String]) -> String {
    match root_labels {
        [] => "Empty Workspace".to_owned(),
        [label] => label.clone(),
        [first, rest @ ..] => format!("{first} + {} folders", rest.len()),
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn read_history(root: &Dir) -> Result<StoredHistory, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    let mut file = match root.open_with(HISTORY_FILE, &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StoredHistory::default());
        }
        Err(_) => return Err(workspace_history_unavailable()),
    };
    let metadata = file
        .metadata()
        .map_err(|_| workspace_history_unavailable())?;
    if !metadata.is_file() {
        return Err(workspace_history_unavailable());
    }
    if metadata.len() > MAX_HISTORY_BYTES {
        return quarantine_and_default(root);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| workspace_history_unavailable())?;
    let Some(stored) = serde_json::from_slice::<StoredHistory>(&bytes).ok() else {
        return quarantine_and_default(root);
    };
    if validate_stored(&stored).is_err() {
        return quarantine_and_default(root);
    }
    Ok(stored)
}

fn quarantine_and_default(root: &Dir) -> Result<StoredHistory, CommandError> {
    let quarantine = format!("{CORRUPT_PREFIX}{}.json", Uuid::new_v4().simple());
    root.rename(HISTORY_FILE, root, quarantine)
        .map_err(|_| workspace_history_unavailable())?;
    Ok(StoredHistory::default())
}

fn write_history(root: &Dir, stored: &StoredHistory) -> Result<(), CommandError> {
    validate_stored(stored)?;
    let payload = serde_json::to_vec(stored).map_err(|_| workspace_history_unavailable())?;
    if payload.len() as u64 > MAX_HISTORY_BYTES {
        return Err(workspace_history_unavailable());
    }
    let mut stage = create_stage(root)?;
    stage
        .file
        .write_all(&payload)
        .map_err(|_| workspace_history_unavailable())?;
    stage
        .file
        .sync_all()
        .map_err(|_| workspace_history_unavailable())?;
    verify_stage(&mut stage.file, &payload)?;
    root.rename(&stage.name, root, HISTORY_FILE)
        .map_err(|_| workspace_history_unavailable())?;
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
            Err(_) => return Err(workspace_history_unavailable()),
        }
    }
    Err(workspace_history_unavailable())
}

fn verify_stage(file: &mut File, expected: &[u8]) -> Result<(), CommandError> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| workspace_history_unavailable())?;
    let mut hasher = Sha256::new();
    let mut observed = 0_u64;
    let mut buffer = [0_u8; 4096];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| workspace_history_unavailable())?;
        if read == 0 {
            break;
        }
        observed = observed
            .checked_add(read as u64)
            .ok_or_else(workspace_history_unavailable)?;
        hasher.update(&buffer[..read]);
    }
    if observed == expected.len() as u64
        && hasher.finalize().as_slice() == Sha256::digest(expected).as_slice()
    {
        Ok(())
    } else {
        Err(workspace_history_unavailable())
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
    mutex.lock().map_err(|_| workspace_history_unavailable())
}

fn workspace_history_unavailable() -> CommandError {
    CommandError::new(
        "WORKSPACE_HISTORY_UNAVAILABLE",
        "Recent workspaces are unavailable.",
    )
}

fn workspace_recent_not_found() -> CommandError {
    CommandError::new(
        "WORKSPACE_RECENT_NOT_FOUND",
        "The selected recent workspace is no longer available.",
    )
}

#[cfg(test)]
mod tests;
