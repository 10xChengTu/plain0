use std::collections::BTreeSet;
use std::fmt;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant};

use super::{RootId, WorkspaceId};
use crate::error::CommandError;
use crate::path_policy::RelativePath;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceCapabilitiesRequest {}

impl WorkspaceCapabilitiesRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceCloseFolderRequest {}

impl WorkspaceCloseFolderRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilities {
    create: bool,
    rename_no_replace: bool,
    copy_move: bool,
    delete: bool,
    trash: bool,
    versioned_write: bool,
}

impl WorkspaceCapabilities {
    pub const fn current_platform() -> Self {
        const HAS_EXCLUSIVE_NAMESPACE_MUTATIONS: bool =
            ::core::cfg!(any(target_os = "linux", target_os = "macos"));

        Self {
            create: true,
            rename_no_replace: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
            copy_move: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
            delete: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
            trash: ::core::cfg!(target_os = "macos"),
            versioned_write: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRootSnapshot {
    root_id: RootId,
    display_name: String,
    uri: String,
}

impl WorkspaceRootSnapshot {
    pub(crate) fn new(root_id: RootId, display_name: String) -> Self {
        Self {
            root_id,
            display_name,
            uri: format!("plain-workspace://{root_id}/"),
        }
    }

    pub const fn root_id(&self) -> RootId {
        self.root_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn uri(&self) -> &str {
        &self.uri
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    workspace_id: WorkspaceId,
    revision: u64,
    roots: Vec<WorkspaceRootSnapshot>,
}

impl WorkspaceSnapshot {
    pub(crate) fn new(
        workspace_id: WorkspaceId,
        revision: u64,
        roots: Vec<WorkspaceRootSnapshot>,
    ) -> Self {
        Self {
            workspace_id,
            revision,
            roots,
        }
    }

    pub const fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    pub const fn revision(&self) -> u64 {
        self.revision
    }

    pub fn roots(&self) -> &[WorkspaceRootSnapshot] {
        &self.roots
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspacePickRootsStatus {
    Selected,
    Cancelled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePickRootsResult {
    status: WorkspacePickRootsStatus,
    snapshot: WorkspaceSnapshot,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceOpenFilesRequest {}

impl WorkspaceOpenFilesRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenFileTarget {
    root_id: RootId,
    relative_path: RelativePath,
}

impl WorkspaceOpenFileTarget {
    pub(crate) const fn new(root_id: RootId, relative_path: RelativePath) -> Self {
        Self {
            root_id,
            relative_path,
        }
    }

    pub const fn root_id(&self) -> RootId {
        self.root_id
    }

    pub fn relative_path(&self) -> &RelativePath {
        &self.relative_path
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenFilesResult {
    status: WorkspacePickRootsStatus,
    snapshot: WorkspaceSnapshot,
    files: Vec<WorkspaceOpenFileTarget>,
}

impl WorkspaceOpenFilesResult {
    pub(crate) const fn new(
        status: WorkspacePickRootsStatus,
        snapshot: WorkspaceSnapshot,
        files: Vec<WorkspaceOpenFileTarget>,
    ) -> Self {
        Self {
            status,
            snapshot,
            files,
        }
    }

    pub const fn status(&self) -> WorkspacePickRootsStatus {
        self.status
    }

    pub const fn snapshot(&self) -> &WorkspaceSnapshot {
        &self.snapshot
    }

    pub fn files(&self) -> &[WorkspaceOpenFileTarget] {
        &self.files
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspacePickSaveTargetRequest {
    suggested_name: String,
}

impl WorkspacePickSaveTargetRequest {
    pub(crate) fn into_suggested_name(self) -> Result<String, CommandError> {
        let path = RelativePath::parse_wire(&self.suggested_name)
            .map_err(|_| workspace_save_target_request_invalid())?;
        if path.is_root() || self.suggested_name.len() > 255 || self.suggested_name.contains('/') {
            return Err(workspace_save_target_request_invalid());
        }
        Ok(self.suggested_name)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSaveTarget {
    root_id: RootId,
    relative_path: RelativePath,
    existing_stat: Option<WorkspaceEntryStat>,
}

impl WorkspaceSaveTarget {
    pub(crate) const fn new(
        root_id: RootId,
        relative_path: RelativePath,
        existing_stat: Option<WorkspaceEntryStat>,
    ) -> Self {
        Self {
            root_id,
            relative_path,
            existing_stat,
        }
    }

    pub const fn root_id(&self) -> RootId {
        self.root_id
    }

    pub fn relative_path(&self) -> &RelativePath {
        &self.relative_path
    }

    pub const fn existing_stat(&self) -> Option<&WorkspaceEntryStat> {
        self.existing_stat.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePickSaveTargetResult {
    status: WorkspacePickRootsStatus,
    snapshot: WorkspaceSnapshot,
    target: Option<WorkspaceSaveTarget>,
}

impl WorkspacePickSaveTargetResult {
    pub(crate) const fn new(
        status: WorkspacePickRootsStatus,
        snapshot: WorkspaceSnapshot,
        target: Option<WorkspaceSaveTarget>,
    ) -> Self {
        Self {
            status,
            snapshot,
            target,
        }
    }

    pub const fn status(&self) -> WorkspacePickRootsStatus {
        self.status
    }

    pub const fn snapshot(&self) -> &WorkspaceSnapshot {
        &self.snapshot
    }

    pub const fn target(&self) -> Option<&WorkspaceSaveTarget> {
        self.target.as_ref()
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorkspaceRecentId(Uuid);

impl WorkspaceRecentId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }

    pub(crate) fn parse_v4_wire(wire: &str) -> Result<Self, CommandError> {
        let value = Uuid::parse_str(wire).map_err(|_| workspace_recent_request_invalid())?;
        if value.hyphenated().to_string() != wire
            || value.get_version() != Some(uuid::Version::Random)
            || value.get_variant() != uuid::Variant::RFC4122
        {
            return Err(workspace_recent_request_invalid());
        }
        Ok(Self(value))
    }
}

impl fmt::Debug for WorkspaceRecentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("WorkspaceRecentId")
            .field(&self.as_wire())
            .finish()
    }
}

impl Serialize for WorkspaceRecentId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for WorkspaceRecentId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        Self::parse_v4_wire(&wire).map_err(|_| D::Error::custom("invalid recent id"))
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceRestoreStatus {
    #[default]
    Pending,
    None,
    Restored,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecentEntry {
    recent_id: WorkspaceRecentId,
    label: String,
    root_labels: Vec<String>,
}

impl WorkspaceRecentEntry {
    pub(crate) fn new(
        recent_id: WorkspaceRecentId,
        label: String,
        root_labels: Vec<String>,
    ) -> Self {
        Self {
            recent_id,
            label,
            root_labels,
        }
    }

    pub const fn recent_id(&self) -> WorkspaceRecentId {
        self.recent_id
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn root_labels(&self) -> &[String] {
        &self.root_labels
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecentListResult {
    revision: u64,
    restore_status: WorkspaceRestoreStatus,
    entries: Vec<WorkspaceRecentEntry>,
}

impl WorkspaceRecentListResult {
    pub(crate) const fn new(
        revision: u64,
        restore_status: WorkspaceRestoreStatus,
        entries: Vec<WorkspaceRecentEntry>,
    ) -> Self {
        Self {
            revision,
            restore_status,
            entries,
        }
    }

    pub const fn revision(&self) -> u64 {
        self.revision
    }

    pub const fn restore_status(&self) -> WorkspaceRestoreStatus {
        self.restore_status
    }

    pub fn entries(&self) -> &[WorkspaceRecentEntry] {
        &self.entries
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceRecentListRequest {}

impl WorkspaceRecentListRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceOpenRecentRequest {
    recent_id: WorkspaceRecentId,
}

impl WorkspaceOpenRecentRequest {
    pub const fn recent_id(self) -> WorkspaceRecentId {
        self.recent_id
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRemoveRecentRequest {
    recent_id: WorkspaceRecentId,
}

impl WorkspaceRemoveRecentRequest {
    pub const fn recent_id(self) -> WorkspaceRecentId {
        self.recent_id
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceClearRecentRequest {}

impl WorkspaceClearRecentRequest {
    pub const fn validate(self) {}
}

impl WorkspacePickRootsResult {
    pub(crate) const fn new(status: WorkspacePickRootsStatus, snapshot: WorkspaceSnapshot) -> Self {
        Self { status, snapshot }
    }

    pub const fn status(&self) -> WorkspacePickRootsStatus {
        self.status
    }

    pub const fn snapshot(&self) -> &WorkspaceSnapshot {
        &self.snapshot
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceSnapshotRequest {}

impl WorkspaceSnapshotRequest {
    pub const fn validate(self) {}
}

const MAX_WORKSPACE_WATCH_ROOTS: usize = 256;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum WorkspaceWatchAcknowledgedGeneration {
    #[default]
    Missing,
    None,
    Generation(u32),
}

impl<'de> Deserialize<'de> for WorkspaceWatchAcknowledgedGeneration {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct NullableGenerationVisitor;

        impl<'de> serde::de::Visitor<'de> for NullableGenerationVisitor {
            type Value = WorkspaceWatchAcknowledgedGeneration;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("null or a positive 32-bit watcher generation")
            }

            fn visit_none<E>(self) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(WorkspaceWatchAcknowledgedGeneration::None)
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(WorkspaceWatchAcknowledgedGeneration::None)
            }

            fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
            where
                D: Deserializer<'de>,
            {
                let generation = u32::deserialize(deserializer)?;
                if generation == 0 {
                    return Err(D::Error::custom(
                        "watcher generation must be greater than zero",
                    ));
                }
                Ok(WorkspaceWatchAcknowledgedGeneration::Generation(generation))
            }

            fn visit_u64<E>(self, generation: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                let generation = u32::try_from(generation)
                    .map_err(|_| E::custom("watcher generation is out of range"))?;
                if generation == 0 {
                    return Err(E::custom("watcher generation must be greater than zero"));
                }
                Ok(WorkspaceWatchAcknowledgedGeneration::Generation(generation))
            }
        }

        deserializer.deserialize_option(NullableGenerationVisitor)
    }
}

#[derive(Clone, Copy, Debug)]
struct WorkspaceWatchSyncRootRequest {
    root_id: RootId,
    acknowledged_generation: WorkspaceWatchAcknowledgedGeneration,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceWatchSyncRootRequestWire {
    root_id: RootId,
    #[serde(default)]
    acknowledged_generation: WorkspaceWatchAcknowledgedGeneration,
}

impl<'de> Deserialize<'de> for WorkspaceWatchSyncRootRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = WorkspaceWatchSyncRootRequestWire::deserialize(deserializer)?;
        if wire.acknowledged_generation == WorkspaceWatchAcknowledgedGeneration::Missing {
            return Err(D::Error::missing_field("acknowledgedGeneration"));
        }
        Ok(Self {
            root_id: wire.root_id,
            acknowledged_generation: wire.acknowledged_generation,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceWatchSyncRequest {
    roots: Vec<WorkspaceWatchSyncRootRequest>,
}

impl WorkspaceWatchSyncRequest {
    pub fn into_parts(self) -> Result<Vec<(RootId, Option<u32>)>, CommandError> {
        if self.roots.is_empty() || self.roots.len() > MAX_WORKSPACE_WATCH_ROOTS {
            return Err(workspace_watch_request_invalid());
        }
        let mut unique = BTreeSet::new();
        let mut roots = Vec::with_capacity(self.roots.len());
        for root in self.roots {
            if !unique.insert(root.root_id) {
                return Err(workspace_watch_request_invalid());
            }
            let acknowledged_generation = match root.acknowledged_generation {
                WorkspaceWatchAcknowledgedGeneration::Missing => {
                    return Err(workspace_watch_request_invalid());
                }
                WorkspaceWatchAcknowledgedGeneration::None => None,
                WorkspaceWatchAcknowledgedGeneration::Generation(generation) => Some(generation),
            };
            roots.push((root.root_id, acknowledged_generation));
        }
        Ok(roots)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWatchPendingRoot {
    root_id: RootId,
    generation: u32,
    rescan_required: bool,
}

impl WorkspaceWatchPendingRoot {
    pub(crate) const fn new(root_id: RootId, generation: u32, rescan_required: bool) -> Self {
        Self {
            root_id,
            generation,
            rescan_required,
        }
    }

    pub const fn root_id(self) -> RootId {
        self.root_id
    }

    pub const fn generation(self) -> u32 {
        self.generation
    }

    pub const fn rescan_required(self) -> bool {
        self.rescan_required
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWatchSyncResult {
    workspace_id: WorkspaceId,
    roots: Vec<WorkspaceWatchPendingRoot>,
}

impl WorkspaceWatchSyncResult {
    pub(crate) const fn new(
        workspace_id: WorkspaceId,
        roots: Vec<WorkspaceWatchPendingRoot>,
    ) -> Self {
        Self {
            workspace_id,
            roots,
        }
    }

    pub const fn workspace_id(&self) -> WorkspaceId {
        self.workspace_id
    }

    pub fn roots(&self) -> &[WorkspaceWatchPendingRoot] {
        &self.roots
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceWatchWakeEvent {
    workspace_id: WorkspaceId,
}

impl WorkspaceWatchWakeEvent {
    pub(crate) const fn new(workspace_id: WorkspaceId) -> Self {
        Self { workspace_id }
    }
}

fn workspace_watch_request_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_WATCH_REQUEST_INVALID",
        "The workspace watcher synchronization request is invalid.",
    )
}

fn workspace_recent_request_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_RECENT_REQUEST_INVALID",
        "The recent workspace request is invalid.",
    )
}

fn workspace_save_target_request_invalid() -> CommandError {
    CommandError::new(
        "WORKSPACE_SAVE_TARGET_REQUEST_INVALID",
        "The save target request is invalid.",
    )
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspacePickRootsRequest {
    mode: WorkspacePickRootsMode,
}

impl WorkspacePickRootsRequest {
    pub const fn mode(self) -> WorkspacePickRootsMode {
        self.mode
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspacePickRootsMode {
    Replace,
    Add,
}

impl WorkspacePickRootsMode {
    pub const fn allows_multiple(self) -> bool {
        matches!(self, Self::Add)
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRemoveRootRequest {
    root_id: RootId,
}

impl WorkspaceRemoveRootRequest {
    pub const fn root_id(self) -> RootId {
        self.root_id
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceEntryRequest {
    root_id: RootId,
    relative_path: String,
}

impl WorkspaceEntryRequest {
    pub fn into_parts(self) -> Result<(RootId, RelativePath), CommandError> {
        let relative_path = RelativePath::parse_wire(&self.relative_path)?;
        Ok((self.root_id, relative_path))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRenameRequest {
    root_id: RootId,
    source_path: String,
    target_path: String,
}

impl WorkspaceRenameRequest {
    pub fn into_parts(self) -> Result<(RootId, RelativePath, RelativePath), CommandError> {
        let source_path = RelativePath::parse_wire(&self.source_path)?;
        let target_path = RelativePath::parse_wire(&self.target_path)?;
        Ok((self.root_id, source_path, target_path))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceCopyRequest {
    source_root_id: RootId,
    source_path: String,
    target_root_id: RootId,
    target_path: String,
}

impl WorkspaceCopyRequest {
    pub fn into_parts(self) -> Result<(RootId, RelativePath, RootId, RelativePath), CommandError> {
        let source_path = RelativePath::parse_wire(&self.source_path)?;
        let target_path = RelativePath::parse_wire(&self.target_path)?;
        Ok((
            self.source_root_id,
            source_path,
            self.target_root_id,
            target_path,
        ))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceMoveRequest {
    source_root_id: RootId,
    source_path: String,
    target_root_id: RootId,
    target_path: String,
}

impl WorkspaceMoveRequest {
    pub fn into_parts(self) -> Result<(RootId, RelativePath, RootId, RelativePath), CommandError> {
        if self.source_root_id == self.target_root_id {
            return Err(CommandError::new(
                "WORKSPACE_CONFLICT",
                "A cross-root move requires two different workspace roots.",
            ));
        }
        let source_path = RelativePath::parse_wire(&self.source_path)?;
        let target_path = RelativePath::parse_wire(&self.target_path)?;
        Ok((
            self.source_root_id,
            source_path,
            self.target_root_id,
            target_path,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMoveIncompleteReason {
    SourceChanged,
    TargetChanged,
    SourceUnverifiable,
    TargetUnverifiable,
    DeleteFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceMoveResult {
    Moved,
    TargetPublishedSourceRetained {
        reason: WorkspaceMoveIncompleteReason,
    },
    TargetPublishedSourcePartiallyDeleted {
        reason: WorkspaceMoveIncompleteReason,
        #[serde(rename = "removedEntries")]
        removed_entries: u32,
    },
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DeleteConfirmationId(Uuid);

impl DeleteConfirmationId {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DeleteEntryId(Uuid);

impl DeleteEntryId {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

macro_rules! opaque_delete_id_wire {
    ($name:ident, $label:literal) => {
        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.debug_tuple($label).field(&"<redacted>").finish()
            }
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(&self.as_wire())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let wire = String::deserialize(deserializer)?;
                let value = Uuid::parse_str(&wire)
                    .map_err(|_| D::Error::custom(concat!("invalid ", $label)))?;
                if value.get_version_num() != 4
                    || value.get_variant() != Variant::RFC4122
                    || value.hyphenated().to_string() != wire
                {
                    return Err(D::Error::custom(concat!("invalid ", $label)));
                }
                Ok(Self(value))
            }
        }
    };
}

opaque_delete_id_wire!(DeleteConfirmationId, "delete confirmation id");
opaque_delete_id_wire!(DeleteEntryId, "delete entry id");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspacePrepareDeleteEntryRequest {
    root_id: RootId,
    relative_path: String,
    recursive: bool,
}

impl WorkspacePrepareDeleteEntryRequest {
    fn into_parts(self) -> Result<(RootId, RelativePath, bool), CommandError> {
        let relative_path = RelativePath::parse_wire(&self.relative_path)?;
        if relative_path.is_root() {
            return Err(CommandError::new(
                "ENTRY_TYPE_MISMATCH",
                "The workspace root cannot be deleted.",
            ));
        }
        Ok((self.root_id, relative_path, self.recursive))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspacePrepareDeleteRequest {
    entries: Vec<WorkspacePrepareDeleteEntryRequest>,
}

impl WorkspacePrepareDeleteRequest {
    pub fn into_parts(self) -> Result<Vec<(RootId, RelativePath, bool)>, CommandError> {
        if self.entries.is_empty() || self.entries.len() > 64 {
            return Err(CommandError::new(
                "WORKSPACE_CONFLICT",
                "A delete batch must contain between one and 64 entries.",
            ));
        }
        self.entries
            .into_iter()
            .map(WorkspacePrepareDeleteEntryRequest::into_parts)
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceDeleteEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteEntryPlan {
    entry_id: DeleteEntryId,
    kind: WorkspaceDeleteEntryKind,
    descendant_entries: u32,
}

impl WorkspaceDeleteEntryPlan {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(crate) const fn new(
        entry_id: DeleteEntryId,
        kind: WorkspaceDeleteEntryKind,
        descendant_entries: u32,
    ) -> Self {
        Self {
            entry_id,
            kind,
            descendant_entries,
        }
    }

    pub const fn entry_id(self) -> DeleteEntryId {
        self.entry_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDeleteBatchPlan {
    confirmation_id: DeleteConfirmationId,
    entries: Vec<WorkspaceDeleteEntryPlan>,
}

impl WorkspaceDeleteBatchPlan {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(crate) const fn new(
        confirmation_id: DeleteConfirmationId,
        entries: Vec<WorkspaceDeleteEntryPlan>,
    ) -> Self {
        Self {
            confirmation_id,
            entries,
        }
    }

    pub const fn confirmation_id(&self) -> DeleteConfirmationId {
        self.confirmation_id
    }

    pub fn entries(&self) -> &[WorkspaceDeleteEntryPlan] {
        &self.entries
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceDeleteBatchRequest {
    confirmation_id: DeleteConfirmationId,
}

impl WorkspaceDeleteBatchRequest {
    pub const fn confirmation_id(self) -> DeleteConfirmationId {
        self.confirmation_id
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceCommitDeleteEntryRequest {
    confirmation_id: DeleteConfirmationId,
    entry_id: DeleteEntryId,
    root_id: RootId,
    relative_path: String,
    recursive: bool,
}

impl WorkspaceCommitDeleteEntryRequest {
    pub fn into_parts(
        self,
    ) -> Result<
        (
            DeleteConfirmationId,
            DeleteEntryId,
            RootId,
            RelativePath,
            bool,
        ),
        CommandError,
    > {
        let relative_path = RelativePath::parse_wire(&self.relative_path)?;
        if relative_path.is_root() {
            return Err(CommandError::new(
                "ENTRY_TYPE_MISMATCH",
                "The workspace root cannot be deleted.",
            ));
        }
        Ok((
            self.confirmation_id,
            self.entry_id,
            self.root_id,
            relative_path,
            self.recursive,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceDeleteIncompleteReason {
    EntryChanged,
    EntryUnverifiable,
    DeleteFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceDeleteResult {
    Deleted,
    EntryRetained {
        reason: WorkspaceDeleteIncompleteReason,
    },
    EntryPartiallyDeleted {
        reason: WorkspaceDeleteIncompleteReason,
        #[serde(rename = "removedEntries")]
        removed_entries: u32,
    },
}

impl WorkspaceDeleteResult {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    pub(super) const fn incomplete(
        reason: WorkspaceDeleteIncompleteReason,
        removed_entries: u32,
    ) -> Self {
        if removed_entries == 0 {
            Self::EntryRetained { reason }
        } else {
            Self::EntryPartiallyDeleted {
                reason,
                removed_entries,
            }
        }
    }

    pub const fn is_deleted(self) -> bool {
        matches!(self, Self::Deleted)
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TrashConfirmationId(Uuid);

impl TrashConfirmationId {
    #[cfg(target_os = "macos")]
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TrashEntryId(Uuid);

impl TrashEntryId {
    #[cfg(target_os = "macos")]
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

opaque_delete_id_wire!(TrashConfirmationId, "trash confirmation id");
opaque_delete_id_wire!(TrashEntryId, "trash entry id");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspacePrepareTrashEntryRequest {
    root_id: RootId,
    relative_path: String,
}

impl WorkspacePrepareTrashEntryRequest {
    fn into_parts(self) -> Result<(RootId, RelativePath), CommandError> {
        let relative_path = RelativePath::parse_wire(&self.relative_path)?;
        if relative_path.is_root() {
            return Err(CommandError::new(
                "ENTRY_TYPE_MISMATCH",
                "The workspace root cannot be moved to Trash.",
            ));
        }
        Ok((self.root_id, relative_path))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspacePrepareTrashRequest {
    entries: Vec<WorkspacePrepareTrashEntryRequest>,
}

impl WorkspacePrepareTrashRequest {
    pub fn into_parts(self) -> Result<Vec<(RootId, RelativePath)>, CommandError> {
        if self.entries.is_empty() || self.entries.len() > 64 {
            return Err(CommandError::new(
                "WORKSPACE_CONFLICT",
                "A Trash batch must contain between one and 64 entries.",
            ));
        }
        self.entries
            .into_iter()
            .map(WorkspacePrepareTrashEntryRequest::into_parts)
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceTrashEntryKind {
    File,
    Directory,
    Symlink,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrashEntryPlan {
    entry_id: TrashEntryId,
    kind: WorkspaceTrashEntryKind,
}

impl WorkspaceTrashEntryPlan {
    #[cfg(target_os = "macos")]
    pub(crate) const fn new(entry_id: TrashEntryId, kind: WorkspaceTrashEntryKind) -> Self {
        Self { entry_id, kind }
    }

    pub const fn entry_id(self) -> TrashEntryId {
        self.entry_id
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrashBatchPlan {
    confirmation_id: TrashConfirmationId,
    entries: Vec<WorkspaceTrashEntryPlan>,
}

impl WorkspaceTrashBatchPlan {
    #[cfg(target_os = "macos")]
    pub(crate) const fn new(
        confirmation_id: TrashConfirmationId,
        entries: Vec<WorkspaceTrashEntryPlan>,
    ) -> Self {
        Self {
            confirmation_id,
            entries,
        }
    }

    pub const fn confirmation_id(&self) -> TrashConfirmationId {
        self.confirmation_id
    }

    pub fn entries(&self) -> &[WorkspaceTrashEntryPlan] {
        &self.entries
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceTrashBatchRequest {
    confirmation_id: TrashConfirmationId,
}

impl WorkspaceTrashBatchRequest {
    pub const fn confirmation_id(self) -> TrashConfirmationId {
        self.confirmation_id
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceCommitTrashEntryRequest {
    confirmation_id: TrashConfirmationId,
    entry_id: TrashEntryId,
    root_id: RootId,
    relative_path: String,
}

impl WorkspaceCommitTrashEntryRequest {
    pub fn into_parts(
        self,
    ) -> Result<(TrashConfirmationId, TrashEntryId, RootId, RelativePath), CommandError> {
        let relative_path = RelativePath::parse_wire(&self.relative_path)?;
        if relative_path.is_root() {
            return Err(CommandError::new(
                "ENTRY_TYPE_MISMATCH",
                "The workspace root cannot be moved to Trash.",
            ));
        }
        Ok((
            self.confirmation_id,
            self.entry_id,
            self.root_id,
            relative_path,
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceTrashIncompleteReason {
    EntryChanged,
    EntryUnverifiable,
    TrashFailed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WorkspaceTrashResult {
    Trashed,
    EntryRetained {
        reason: WorkspaceTrashIncompleteReason,
    },
    OutcomeUnknown,
}

impl WorkspaceTrashResult {
    pub const fn is_trashed(self) -> bool {
        matches!(self, Self::Trashed)
    }
}

impl WorkspaceMoveResult {
    pub(super) const fn incomplete(
        reason: WorkspaceMoveIncompleteReason,
        removed_entries: u32,
    ) -> Self {
        if removed_entries == 0 {
            Self::TargetPublishedSourceRetained { reason }
        } else {
            Self::TargetPublishedSourcePartiallyDeleted {
                reason,
                removed_entries,
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    File,
    Directory,
    Symlink,
    SymlinkFile,
    SymlinkDirectory,
    Other,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntryStat {
    kind: WorkspaceEntryKind,
    size: u64,
    mtime: u64,
    ctime: u64,
    version: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWritePublicationEvidence {
    RenameReportedSuccess,
    TargetObservedWritten,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWriteRenameObservation {
    ReportedSuccess,
    ReportedFailure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceWriteDirectorySyncObservation {
    Synced,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceWriteTargetObservation {
    MatchesWritten,
    Changed,
    Unverifiable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWriteNativeObservation {
    Native,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWriteFailedRenameObservation {
    ReportedFailure,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWriteUnknownDirectorySyncObservation {
    NotAttempted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum WorkspaceWriteAmbiguousTargetObservation {
    Ambiguous,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum WorkspaceWriteResultWire {
    Written {
        stat: WorkspaceEntryStat,
    },
    TargetPublished {
        publication_evidence: WorkspaceWritePublicationEvidence,
        rename: WorkspaceWriteRenameObservation,
        directory_sync: WorkspaceWriteDirectorySyncObservation,
        target: WorkspaceWriteTargetObservation,
    },
    OutcomeUnknown {
        observation: WorkspaceWriteNativeObservation,
        rename: WorkspaceWriteFailedRenameObservation,
        directory_sync: WorkspaceWriteUnknownDirectorySyncObservation,
        target: WorkspaceWriteAmbiguousTargetObservation,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct WorkspaceWriteResult(WorkspaceWriteResultWire);

impl WorkspaceWriteResult {
    pub(crate) const fn written(stat: WorkspaceEntryStat) -> Self {
        Self(WorkspaceWriteResultWire::Written { stat })
    }

    pub(crate) const fn rename_succeeded_sync_failed_with_written_target() -> Self {
        Self(WorkspaceWriteResultWire::TargetPublished {
            publication_evidence: WorkspaceWritePublicationEvidence::TargetObservedWritten,
            rename: WorkspaceWriteRenameObservation::ReportedSuccess,
            directory_sync: WorkspaceWriteDirectorySyncObservation::Failed,
            target: WorkspaceWriteTargetObservation::MatchesWritten,
        })
    }

    pub(crate) const fn rename_succeeded_with_changed_target(
        directory_sync: WorkspaceWriteDirectorySyncObservation,
    ) -> Self {
        Self(WorkspaceWriteResultWire::TargetPublished {
            publication_evidence: WorkspaceWritePublicationEvidence::RenameReportedSuccess,
            rename: WorkspaceWriteRenameObservation::ReportedSuccess,
            directory_sync,
            target: WorkspaceWriteTargetObservation::Changed,
        })
    }

    pub(crate) const fn rename_succeeded_with_unverifiable_target(
        directory_sync: WorkspaceWriteDirectorySyncObservation,
    ) -> Self {
        Self(WorkspaceWriteResultWire::TargetPublished {
            publication_evidence: WorkspaceWritePublicationEvidence::RenameReportedSuccess,
            rename: WorkspaceWriteRenameObservation::ReportedSuccess,
            directory_sync,
            target: WorkspaceWriteTargetObservation::Unverifiable,
        })
    }

    pub(crate) const fn rename_failed_with_observed_target(
        directory_sync: WorkspaceWriteDirectorySyncObservation,
        target: WorkspaceWriteTargetObservation,
    ) -> Self {
        Self(WorkspaceWriteResultWire::TargetPublished {
            publication_evidence: WorkspaceWritePublicationEvidence::TargetObservedWritten,
            rename: WorkspaceWriteRenameObservation::ReportedFailure,
            directory_sync,
            target,
        })
    }

    pub(crate) const fn native_unknown() -> Self {
        Self(WorkspaceWriteResultWire::OutcomeUnknown {
            observation: WorkspaceWriteNativeObservation::Native,
            rename: WorkspaceWriteFailedRenameObservation::ReportedFailure,
            directory_sync: WorkspaceWriteUnknownDirectorySyncObservation::NotAttempted,
            target: WorkspaceWriteAmbiguousTargetObservation::Ambiguous,
        })
    }

    #[cfg(test)]
    pub(crate) const fn written_stat(&self) -> Option<&WorkspaceEntryStat> {
        match &self.0 {
            WorkspaceWriteResultWire::Written { stat } => Some(stat),
            WorkspaceWriteResultWire::TargetPublished { .. }
            | WorkspaceWriteResultWire::OutcomeUnknown { .. } => None,
        }
    }
}

impl WorkspaceEntryStat {
    pub(crate) const fn new(
        kind: WorkspaceEntryKind,
        size: u64,
        mtime: u64,
        ctime: u64,
        version: Option<String>,
    ) -> Self {
        Self {
            kind,
            size,
            mtime,
            ctime,
            version,
        }
    }

    pub const fn kind(&self) -> WorkspaceEntryKind {
        self.kind
    }

    pub const fn size(&self) -> u64 {
        self.size
    }

    pub const fn mtime(&self) -> u64 {
        self.mtime
    }

    pub const fn ctime(&self) -> u64 {
        self.ctime
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryEntry {
    name: String,
    kind: WorkspaceEntryKind,
}

impl WorkspaceDirectoryEntry {
    pub(crate) const fn new(name: String, kind: WorkspaceEntryKind) -> Self {
        Self { name, kind }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub const fn kind(&self) -> WorkspaceEntryKind {
        self.kind
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct WorkspaceReadDirectoryResult {
    entries: Vec<WorkspaceDirectoryEntry>,
}

impl WorkspaceReadDirectoryResult {
    pub(crate) const fn new(entries: Vec<WorkspaceDirectoryEntry>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[WorkspaceDirectoryEntry] {
        &self.entries
    }
}

#[cfg(test)]
mod tests {
    use super::{
        WorkspaceCommitDeleteEntryRequest, WorkspaceCommitTrashEntryRequest, WorkspaceCopyRequest,
        WorkspaceDeleteBatchRequest, WorkspaceDeleteIncompleteReason, WorkspaceDeleteResult,
        WorkspaceEntryKind, WorkspaceEntryRequest, WorkspaceMoveIncompleteReason,
        WorkspaceMoveRequest, WorkspaceMoveResult, WorkspaceOpenFilesRequest,
        WorkspaceOpenRecentRequest, WorkspacePickRootsMode, WorkspacePickRootsRequest,
        WorkspacePickSaveTargetRequest, WorkspacePrepareDeleteRequest,
        WorkspacePrepareTrashRequest, WorkspaceRecentListRequest, WorkspaceRemoveRecentRequest,
        WorkspaceRenameRequest, WorkspaceTrashBatchRequest, WorkspaceTrashIncompleteReason,
        WorkspaceTrashResult, WorkspaceWatchPendingRoot, WorkspaceWatchSyncRequest,
        WorkspaceWatchSyncResult, WorkspaceWatchWakeEvent, WorkspaceWriteDirectorySyncObservation,
        WorkspaceWriteResult, WorkspaceWriteTargetObservation,
    };
    use crate::workspace::{RootId, WorkspaceId};

    #[test]
    fn pick_roots_mode_is_a_closed_lowercase_wire_enum() {
        let replace: WorkspacePickRootsRequest =
            serde_json::from_str(r#"{"mode":"replace"}"#).unwrap();
        assert_eq!(replace.mode(), WorkspacePickRootsMode::Replace);
        assert!(!replace.mode().allows_multiple());

        let add: WorkspacePickRootsRequest = serde_json::from_str(r#"{"mode":"add"}"#).unwrap();
        assert_eq!(add.mode(), WorkspacePickRootsMode::Add);
        assert!(add.mode().allows_multiple());

        for invalid in [
            r#"{"mode":"Replace"}"#,
            r#"{"mode":"multiple"}"#,
            r#"{"allowMultiple":true}"#,
            r#"{"mode":"add","unknown":true}"#,
            r#"{}"#,
        ] {
            assert!(
                serde_json::from_str::<WorkspacePickRootsRequest>(invalid).is_err(),
                "request must reject {invalid}"
            );
        }
    }

    #[test]
    fn open_file_and_recent_requests_are_closed_and_path_free() {
        serde_json::from_str::<WorkspaceOpenFilesRequest>(r#"{}"#).unwrap();
        serde_json::from_str::<WorkspaceRecentListRequest>(r#"{}"#).unwrap();
        for invalid in [r#"{"path":"/tmp/private"}"#, r#"{"mode":"multiple"}"#] {
            assert!(serde_json::from_str::<WorkspaceOpenFilesRequest>(invalid).is_err());
            assert!(serde_json::from_str::<WorkspaceRecentListRequest>(invalid).is_err());
        }

        let wire = r#"{"recentId":"00000000-0000-4000-8000-000000000123"}"#;
        serde_json::from_str::<WorkspaceOpenRecentRequest>(wire).unwrap();
        serde_json::from_str::<WorkspaceRemoveRecentRequest>(wire).unwrap();
        for invalid in [
            r#"{"recentId":"00000000-0000-1000-8000-000000000123"}"#,
            r#"{"recentId":"00000000-0000-4000-8000-000000000123","path":"/tmp/private"}"#,
            r#"{"recentId":"00000000000040008000000000000123"}"#,
        ] {
            assert!(serde_json::from_str::<WorkspaceOpenRecentRequest>(invalid).is_err());
            assert!(serde_json::from_str::<WorkspaceRemoveRecentRequest>(invalid).is_err());
        }
    }

    #[test]
    fn save_target_request_is_one_closed_portable_file_name() {
        let request: WorkspacePickSaveTargetRequest =
            serde_json::from_str(r#"{"suggestedName":"Untitled-1.txt"}"#).unwrap();
        assert_eq!(request.into_suggested_name().unwrap(), "Untitled-1.txt");

        for invalid in [
            r#"{}"#,
            r#"{"suggestedName":""}"#,
            r#"{"suggestedName":".."}"#,
            r#"{"suggestedName":"nested/file.txt"}"#,
            r#"{"suggestedName":"draft.txt","path":"/tmp/private"}"#,
        ] {
            let rejected = serde_json::from_str::<WorkspacePickSaveTargetRequest>(invalid)
                .map_or(true, |request| request.into_suggested_name().is_err());
            assert!(rejected, "request must reject {invalid}");
        }
    }

    #[test]
    fn watch_sync_request_requires_one_to_256_unique_roots_and_explicit_ack() {
        let request: WorkspaceWatchSyncRequest = serde_json::from_str(
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":null},{"rootId":"00000000-0000-4000-8000-000000000002","acknowledgedGeneration":7}]}"#,
        )
        .unwrap();
        let roots = request.into_parts().unwrap();
        assert_eq!(roots.len(), 2);
        assert_eq!(roots[0].1, None);
        assert_eq!(roots[1].1, Some(7));

        for invalid in [
            r#"{"roots":[]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-0000-0000-000000000000","acknowledgedGeneration":null}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-1000-8000-000000000001","acknowledgedGeneration":null}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-0000-000000000001","acknowledgedGeneration":null}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001"}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":0}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":4294967296}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":1,"relativePath":"src"}]}"#,
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":null}],"path":"/tmp"}"#,
        ] {
            let rejected = serde_json::from_str::<WorkspaceWatchSyncRequest>(invalid)
                .map_or(true, |request| request.into_parts().is_err());
            assert!(rejected, "request must reject {invalid}");
        }

        let duplicate: WorkspaceWatchSyncRequest = serde_json::from_str(
            r#"{"roots":[{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":null},{"rootId":"00000000-0000-4000-8000-000000000001","acknowledgedGeneration":1}]}"#,
        )
        .unwrap();
        assert_eq!(
            duplicate.into_parts().unwrap_err().code(),
            "WORKSPACE_WATCH_REQUEST_INVALID"
        );

        let roots = (0..257)
            .map(|index| {
                serde_json::json!({
                    "rootId": format!("00000000-0000-4000-8000-{index:012}"),
                    "acknowledgedGeneration": null,
                })
            })
            .collect::<Vec<_>>();
        let oversized: WorkspaceWatchSyncRequest =
            serde_json::from_value(serde_json::json!({ "roots": roots })).unwrap();
        assert_eq!(
            oversized.into_parts().unwrap_err().code(),
            "WORKSPACE_WATCH_REQUEST_INVALID"
        );
    }

    #[test]
    fn watch_sync_response_and_wake_are_path_free_closed_camel_case_dtos() {
        let workspace_id =
            WorkspaceId(uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000010").unwrap());
        let root_id =
            RootId(uuid::Uuid::parse_str("00000000-0000-4000-8000-000000000011").unwrap());
        let pending = WorkspaceWatchPendingRoot::new(root_id, 3, true);
        assert_eq!(pending.root_id(), root_id);
        assert_eq!(pending.generation(), 3);
        assert!(pending.rescan_required());

        let result = WorkspaceWatchSyncResult::new(workspace_id, vec![pending]);
        assert_eq!(result.workspace_id(), workspace_id);
        assert_eq!(result.roots(), &[pending]);
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "workspaceId": "00000000-0000-4000-8000-000000000010",
                "roots": [{
                    "rootId": "00000000-0000-4000-8000-000000000011",
                    "generation": 3,
                    "rescanRequired": true,
                }],
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceWatchWakeEvent::new(workspace_id)).unwrap(),
            serde_json::json!({
                "workspaceId": "00000000-0000-4000-8000-000000000010",
            })
        );
    }

    #[test]
    fn entry_request_owns_and_validates_the_relative_path() {
        let request: WorkspaceEntryRequest = serde_json::from_str(
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"src/main.rs"}"#,
        )
        .unwrap();
        let (root_id, relative_path) = request.into_parts().unwrap();
        assert_eq!(root_id.as_wire(), "00000000-0000-4000-8000-000000000000");
        assert_eq!(relative_path.as_wire(), "src/main.rs");

        for invalid in [
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"src","path":"private"}"#,
            r#"{"rootId":"00000000-0000-4000-8000-000000000000"}"#,
            r#"{"relativePath":"src"}"#,
        ] {
            assert!(
                serde_json::from_str::<WorkspaceEntryRequest>(invalid).is_err(),
                "request must reject {invalid}"
            );
        }

        let traversal: WorkspaceEntryRequest = serde_json::from_str(
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"../private"}"#,
        )
        .unwrap();
        assert_eq!(
            traversal.into_parts().unwrap_err().code(),
            "INVALID_RELATIVE_PATH"
        );
    }

    #[test]
    fn rename_request_owns_one_root_and_two_validated_paths() {
        let request: WorkspaceRenameRequest = serde_json::from_str(
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","sourcePath":"src/old.rs","targetPath":"src/new.rs"}"#,
        )
        .unwrap();
        let (root_id, source_path, target_path) = request.into_parts().unwrap();
        assert_eq!(root_id.as_wire(), "00000000-0000-4000-8000-000000000000");
        assert_eq!(source_path.as_wire(), "src/old.rs");
        assert_eq!(target_path.as_wire(), "src/new.rs");

        for invalid in [
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetPath":"new","overwrite":false}"#,
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old"}"#,
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","targetPath":"new"}"#,
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","targetRootId":"00000000-0000-4000-8000-000000000001","sourcePath":"old","targetPath":"new"}"#,
        ] {
            assert!(
                serde_json::from_str::<WorkspaceRenameRequest>(invalid).is_err(),
                "request must reject {invalid}"
            );
        }

        for (source_path, target_path) in [("../private", "new"), ("old", "../private")] {
            let wire = format!(
                r#"{{"rootId":"00000000-0000-4000-8000-000000000000","sourcePath":"{source_path}","targetPath":"{target_path}"}}"#
            );
            let request: WorkspaceRenameRequest = serde_json::from_str(&wire).unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_RELATIVE_PATH"
            );
        }
    }

    #[test]
    fn copy_request_owns_exactly_two_roots_and_two_validated_paths() {
        let request: WorkspaceCopyRequest = serde_json::from_str(
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"src/old.rs","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"backup/new.rs"}"#,
        )
        .unwrap();
        let (source_root_id, source_path, target_root_id, target_path) =
            request.into_parts().unwrap();
        assert_eq!(
            source_root_id.as_wire(),
            "00000000-0000-4000-8000-000000000000"
        );
        assert_eq!(source_path.as_wire(), "src/old.rs");
        assert_eq!(
            target_root_id.as_wire(),
            "00000000-0000-4000-8000-000000000001"
        );
        assert_eq!(target_path.as_wire(), "backup/new.rs");

        for invalid in [
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"new","overwrite":false}"#,
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetRootId":"00000000-0000-4000-8000-000000000001"}"#,
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"new"}"#,
            r#"{"rootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetPath":"new"}"#,
        ] {
            assert!(
                serde_json::from_str::<WorkspaceCopyRequest>(invalid).is_err(),
                "request must reject {invalid}"
            );
        }

        for (source_path, target_path) in [("../private", "new"), ("old", "../private")] {
            let wire = format!(
                r#"{{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"{source_path}","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"{target_path}"}}"#
            );
            let request: WorkspaceCopyRequest = serde_json::from_str(&wire).unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_RELATIVE_PATH"
            );
        }
    }

    #[test]
    fn move_request_requires_exactly_two_different_roots_and_validated_paths() {
        let request: WorkspaceMoveRequest = serde_json::from_str(
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"src/old.rs","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"backup/new.rs"}"#,
        )
        .unwrap();
        let (source_root_id, source_path, target_root_id, target_path) =
            request.into_parts().unwrap();
        assert_ne!(source_root_id, target_root_id);
        assert_eq!(source_path.as_wire(), "src/old.rs");
        assert_eq!(target_path.as_wire(), "backup/new.rs");

        let same_root: WorkspaceMoveRequest = serde_json::from_str(
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetRootId":"00000000-0000-4000-8000-000000000000","targetPath":"new"}"#,
        )
        .unwrap();
        assert_eq!(
            same_root.into_parts().unwrap_err().code(),
            "WORKSPACE_CONFLICT"
        );

        for invalid in [
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"new","overwrite":false}"#,
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","sourcePath":"old","targetRootId":"00000000-0000-4000-8000-000000000001"}"#,
            r#"{"sourceRootId":"00000000-0000-4000-8000-000000000000","targetRootId":"00000000-0000-4000-8000-000000000001","targetPath":"new"}"#,
        ] {
            assert!(serde_json::from_str::<WorkspaceMoveRequest>(invalid).is_err());
        }
    }

    #[test]
    fn move_result_is_a_strict_camel_case_structured_terminal_state() {
        assert_eq!(
            serde_json::to_value(WorkspaceMoveResult::Moved).unwrap(),
            serde_json::json!({ "status": "moved" })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceMoveResult::TargetPublishedSourceRetained {
                reason: WorkspaceMoveIncompleteReason::TargetUnverifiable,
            })
            .unwrap(),
            serde_json::json!({
                "status": "targetPublishedSourceRetained",
                "reason": "targetUnverifiable",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceMoveResult::TargetPublishedSourcePartiallyDeleted {
                reason: WorkspaceMoveIncompleteReason::DeleteFailed,
                removed_entries: 7,
            })
            .unwrap(),
            serde_json::json!({
                "status": "targetPublishedSourcePartiallyDeleted",
                "reason": "deleteFailed",
                "removedEntries": 7,
            })
        );
    }

    #[test]
    fn write_result_constructors_only_emit_valid_camel_case_terminal_states() {
        let stat = super::WorkspaceEntryStat::new(
            WorkspaceEntryKind::File,
            4,
            5,
            6,
            Some(format!("wv1:{}", "a".repeat(64))),
        );
        assert_eq!(
            serde_json::to_value(WorkspaceWriteResult::written(stat)).unwrap(),
            serde_json::json!({
                "status": "written",
                "stat": {
                    "kind": "file",
                    "size": 4,
                    "mtime": 5,
                    "ctime": 6,
                    "version": format!("wv1:{}", "a".repeat(64)),
                },
            })
        );
        assert_eq!(
            serde_json::to_value(
                WorkspaceWriteResult::rename_succeeded_sync_failed_with_written_target(),
            )
            .unwrap(),
            serde_json::json!({
                "status": "targetPublished",
                "publicationEvidence": "targetObservedWritten",
                "rename": "reportedSuccess",
                "directorySync": "failed",
                "target": "matchesWritten",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceWriteResult::rename_succeeded_with_changed_target(
                WorkspaceWriteDirectorySyncObservation::Synced,
            ))
            .unwrap(),
            serde_json::json!({
                "status": "targetPublished",
                "publicationEvidence": "renameReportedSuccess",
                "rename": "reportedSuccess",
                "directorySync": "synced",
                "target": "changed",
            })
        );
        assert_eq!(
            serde_json::to_value(
                WorkspaceWriteResult::rename_succeeded_with_unverifiable_target(
                    WorkspaceWriteDirectorySyncObservation::Failed,
                ),
            )
            .unwrap(),
            serde_json::json!({
                "status": "targetPublished",
                "publicationEvidence": "renameReportedSuccess",
                "rename": "reportedSuccess",
                "directorySync": "failed",
                "target": "unverifiable",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceWriteResult::rename_failed_with_observed_target(
                WorkspaceWriteDirectorySyncObservation::Synced,
                WorkspaceWriteTargetObservation::Changed,
            ))
            .unwrap(),
            serde_json::json!({
                "status": "targetPublished",
                "publicationEvidence": "targetObservedWritten",
                "rename": "reportedFailure",
                "directorySync": "synced",
                "target": "changed",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceWriteResult::native_unknown()).unwrap(),
            serde_json::json!({
                "status": "outcomeUnknown",
                "observation": "native",
                "rename": "reportedFailure",
                "directorySync": "notAttempted",
                "target": "ambiguous",
            })
        );
    }

    #[test]
    fn delete_requests_are_closed_and_bind_uuid_v4_ids_paths_and_options() {
        let request: WorkspacePrepareDeleteRequest = serde_json::from_str(
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"src/main.rs","recursive":false}]}"#,
        )
        .unwrap();
        let entries = request.into_parts().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1.as_wire(), "src/main.rs");
        assert!(!entries[0].2);

        for invalid in [
            r#"{"entries":[],"confirmed":true}"#,
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"a","recursive":true,"useTrash":false}]}"#,
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"a"}]}"#,
        ] {
            assert!(serde_json::from_str::<WorkspacePrepareDeleteRequest>(invalid).is_err());
        }

        let root: WorkspacePrepareDeleteRequest = serde_json::from_str(
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"","recursive":true}]}"#,
        )
        .unwrap();
        assert_eq!(root.into_parts().unwrap_err().code(), "ENTRY_TYPE_MISMATCH");

        let batch: WorkspaceDeleteBatchRequest =
            serde_json::from_str(r#"{"confirmationId":"00000000-0000-4000-8000-000000000000"}"#)
                .unwrap();
        assert_eq!(
            batch.confirmation_id().as_wire(),
            "00000000-0000-4000-8000-000000000000"
        );
        assert!(!format!("{batch:?}").contains("00000000-0000-4000-8000-000000000000"));
        for invalid in [
            r#"{"confirmationId":"00000000-0000-1000-8000-000000000000"}"#,
            r#"{"confirmationId":"00000000-0000-4000-0000-000000000000"}"#,
            r#"{"confirmationId":"00000000000040008000000000000000"}"#,
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001"}"#,
        ] {
            assert!(serde_json::from_str::<WorkspaceDeleteBatchRequest>(invalid).is_err());
        }

        let commit: WorkspaceCommitDeleteEntryRequest = serde_json::from_str(
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001","rootId":"00000000-0000-4000-8000-000000000002","relativePath":"src/main.rs","recursive":false}"#,
        )
        .unwrap();
        let (_, _, _, path, recursive) = commit.into_parts().unwrap();
        assert_eq!(path.as_wire(), "src/main.rs");
        assert!(!recursive);
        assert!(serde_json::from_str::<WorkspaceCommitDeleteEntryRequest>(
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001","rootId":"00000000-0000-4000-8000-000000000002","relativePath":"src/main.rs","recursive":false,"atomic":false}"#,
        )
        .is_err());
    }

    #[test]
    fn delete_result_is_a_strict_structured_terminal_state() {
        assert_eq!(
            serde_json::to_value(WorkspaceDeleteResult::Deleted).unwrap(),
            serde_json::json!({ "status": "deleted" })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceDeleteResult::EntryRetained {
                reason: WorkspaceDeleteIncompleteReason::EntryChanged,
            })
            .unwrap(),
            serde_json::json!({
                "status": "entryRetained",
                "reason": "entryChanged",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceDeleteResult::EntryPartiallyDeleted {
                reason: WorkspaceDeleteIncompleteReason::DeleteFailed,
                removed_entries: 3,
            })
            .unwrap(),
            serde_json::json!({
                "status": "entryPartiallyDeleted",
                "reason": "deleteFailed",
                "removedEntries": 3,
            })
        );
    }

    #[test]
    fn trash_requests_are_closed_and_cannot_be_replayed_as_permanent_delete() {
        let request: WorkspacePrepareTrashRequest = serde_json::from_str(
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"src/main.rs"}]}"#,
        )
        .unwrap();
        let entries = request.into_parts().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1.as_wire(), "src/main.rs");

        for invalid in [
            r#"{"entries":[],"confirmed":true}"#,
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"a","recursive":true}]}"#,
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":"a","useTrash":true}]}"#,
        ] {
            assert!(serde_json::from_str::<WorkspacePrepareTrashRequest>(invalid).is_err());
        }
        let root: WorkspacePrepareTrashRequest = serde_json::from_str(
            r#"{"entries":[{"rootId":"00000000-0000-4000-8000-000000000000","relativePath":""}]}"#,
        )
        .unwrap();
        assert_eq!(root.into_parts().unwrap_err().code(), "ENTRY_TYPE_MISMATCH");

        let batch: WorkspaceTrashBatchRequest =
            serde_json::from_str(r#"{"confirmationId":"00000000-0000-4000-8000-000000000000"}"#)
                .unwrap();
        assert_eq!(
            batch.confirmation_id().as_wire(),
            "00000000-0000-4000-8000-000000000000"
        );
        assert!(!format!("{batch:?}").contains("00000000-0000-4000-8000-000000000000"));
        assert!(serde_json::from_str::<WorkspaceTrashBatchRequest>(
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","permanent":false}"#,
        )
        .is_err());

        let commit: WorkspaceCommitTrashEntryRequest = serde_json::from_str(
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001","rootId":"00000000-0000-4000-8000-000000000002","relativePath":"src/main.rs"}"#,
        )
        .unwrap();
        let (_, _, _, path) = commit.into_parts().unwrap();
        assert_eq!(path.as_wire(), "src/main.rs");
        for invalid in [
            r#"{"confirmationId":"00000000-0000-4000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001","rootId":"00000000-0000-4000-8000-000000000002","relativePath":"src/main.rs","recursive":true}"#,
            r#"{"confirmationId":"00000000-0000-1000-8000-000000000000","entryId":"00000000-0000-4000-8000-000000000001","rootId":"00000000-0000-4000-8000-000000000002","relativePath":"src/main.rs"}"#,
        ] {
            assert!(serde_json::from_str::<WorkspaceCommitTrashEntryRequest>(invalid).is_err());
        }
    }

    #[test]
    fn trash_result_has_only_trashed_retained_and_unknown_terminal_states() {
        assert_eq!(
            serde_json::to_value(WorkspaceTrashResult::Trashed).unwrap(),
            serde_json::json!({ "status": "trashed" })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceTrashResult::EntryRetained {
                reason: WorkspaceTrashIncompleteReason::EntryChanged,
            })
            .unwrap(),
            serde_json::json!({
                "status": "entryRetained",
                "reason": "entryChanged",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceTrashResult::EntryRetained {
                reason: WorkspaceTrashIncompleteReason::TrashFailed,
            })
            .unwrap(),
            serde_json::json!({
                "status": "entryRetained",
                "reason": "trashFailed",
            })
        );
        assert_eq!(
            serde_json::to_value(WorkspaceTrashResult::OutcomeUnknown).unwrap(),
            serde_json::json!({ "status": "outcomeUnknown" })
        );
    }

    #[test]
    fn entry_kind_is_a_closed_camel_case_wire_enum() {
        let values = [
            (WorkspaceEntryKind::File, "file"),
            (WorkspaceEntryKind::Directory, "directory"),
            (WorkspaceEntryKind::Symlink, "symlink"),
            (WorkspaceEntryKind::SymlinkFile, "symlinkFile"),
            (WorkspaceEntryKind::SymlinkDirectory, "symlinkDirectory"),
            (WorkspaceEntryKind::Other, "other"),
        ];

        for (kind, wire) in values {
            assert_eq!(serde_json::to_value(kind).unwrap(), wire);
        }
    }
}
