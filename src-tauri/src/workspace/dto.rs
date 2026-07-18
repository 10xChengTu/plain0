use serde::{Deserialize, Serialize};

use super::{RootId, WorkspaceId};

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

#[cfg(test)]
mod tests {
    use super::{WorkspacePickRootsMode, WorkspacePickRootsRequest};

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
}
