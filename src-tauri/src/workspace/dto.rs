use serde::{Deserialize, Serialize};

use super::{RootId, WorkspaceId};
use crate::error::CommandError;
use crate::path_policy::RelativePath;

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
}

impl WorkspaceEntryStat {
    pub(crate) const fn new(kind: WorkspaceEntryKind, size: u64, mtime: u64, ctime: u64) -> Self {
        Self {
            kind,
            size,
            mtime,
            ctime,
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
        WorkspaceCopyRequest, WorkspaceEntryKind, WorkspaceEntryRequest,
        WorkspaceMoveIncompleteReason, WorkspaceMoveRequest, WorkspaceMoveResult,
        WorkspacePickRootsMode, WorkspacePickRootsRequest, WorkspaceRenameRequest,
    };

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
