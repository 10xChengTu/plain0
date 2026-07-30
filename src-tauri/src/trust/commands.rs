use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};

use crate::error::CommandError;
use crate::workspace::service::WorkspaceService;

use super::service::TrustService;

/// Response shape shared by `workspace_trust_state` and
/// `workspace_trust_grant` (the latter always reports `trusted: true` on
/// success, since a successful grant call has, by definition, just made the
/// current workspace trusted).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTrustState {
    trusted: bool,
}

impl WorkspaceTrustState {
    const fn new(trusted: bool) -> Self {
        Self { trusted }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceTrustStateRequest {}

impl WorkspaceTrustStateRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceTrustGrantRequest {}

impl WorkspaceTrustGrantRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceTrustRevokeRequest {}

impl WorkspaceTrustRevokeRequest {
    pub const fn validate(self) {}
}

#[tauri::command]
pub(crate) async fn workspace_trust_state(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: WorkspaceTrustStateRequest,
) -> Result<WorkspaceTrustState, CommandError> {
    request.validate();
    let trusted = trust
        .inner()
        .is_trusted(workspace.inner(), window.label())
        .await?;
    Ok(WorkspaceTrustState::new(trusted))
}

#[tauri::command]
pub(crate) async fn workspace_trust_grant(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: WorkspaceTrustGrantRequest,
) -> Result<WorkspaceTrustState, CommandError> {
    request.validate();
    trust
        .inner()
        .grant(workspace.inner(), window.label())
        .await?;
    Ok(WorkspaceTrustState::new(true))
}

#[tauri::command]
pub(crate) async fn workspace_trust_revoke(
    window: WebviewWindow,
    trust: State<'_, TrustService>,
    workspace: State<'_, WorkspaceService>,
    request: WorkspaceTrustRevokeRequest,
) -> Result<(), CommandError> {
    request.validate();
    trust
        .inner()
        .revoke(workspace.inner(), window.label())
        .await
}

#[cfg(test)]
mod tests {
    use super::{
        WorkspaceTrustGrantRequest, WorkspaceTrustRevokeRequest, WorkspaceTrustState,
        WorkspaceTrustStateRequest,
    };

    #[test]
    fn every_trust_request_rejects_any_extra_field() {
        serde_json::from_value::<WorkspaceTrustStateRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<WorkspaceTrustStateRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
        serde_json::from_value::<WorkspaceTrustGrantRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<WorkspaceTrustGrantRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
        serde_json::from_value::<WorkspaceTrustRevokeRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<WorkspaceTrustRevokeRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
    }

    #[test]
    fn trust_state_response_is_camel_case() {
        let value = serde_json::to_value(WorkspaceTrustState::new(true)).unwrap();
        assert_eq!(value, serde_json::json!({ "trusted": true }));
    }
}
