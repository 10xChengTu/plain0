use serde::Deserialize;

use super::BackupKey;
use crate::workspace::RootId;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupReadAllRequest {}

impl BackupReadAllRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupDiscardAllRequest {}

impl BackupDiscardAllRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupDiscardRequest {
    root_id: RootId,
    key: BackupKey,
}

impl BackupDiscardRequest {
    pub(crate) fn into_parts(self) -> (RootId, BackupKey) {
        (self.root_id, self.key)
    }
}

#[cfg(test)]
mod tests {
    use super::{BackupDiscardAllRequest, BackupDiscardRequest, BackupReadAllRequest};

    #[test]
    fn empty_requests_reject_every_extra_field() {
        serde_json::from_value::<BackupReadAllRequest>(serde_json::json!({})).unwrap();
        assert!(
            serde_json::from_value::<BackupReadAllRequest>(serde_json::json!({ "key": "a" }))
                .is_err()
        );
        serde_json::from_value::<BackupDiscardAllRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<BackupDiscardAllRequest>(
            serde_json::json!({ "key": "a" })
        )
        .is_err());
    }

    #[test]
    fn discard_request_requires_exactly_one_valid_key_field() {
        let request: BackupDiscardRequest = serde_json::from_value(serde_json::json!({
            "rootId": "00000000-0000-4000-8000-000000000001",
            "key": "abc-123"
        }))
        .unwrap();
        let (root_id, key) = request.into_parts();
        assert_eq!(root_id.as_wire(), "00000000-0000-4000-8000-000000000001");
        assert_eq!(key.as_str(), "abc-123");

        assert!(serde_json::from_value::<BackupDiscardRequest>(serde_json::json!({})).is_err());
        assert!(
            serde_json::from_value::<BackupDiscardRequest>(serde_json::json!({
                "rootId": "00000000-0000-4000-8000-000000000001",
                "key": "abc-123",
                "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<BackupDiscardRequest>(serde_json::json!({
                "rootId": "00000000-0000-4000-8000-000000000001",
                "key": "../etc"
            }))
            .is_err()
        );
        assert!(serde_json::from_value::<BackupDiscardRequest>(
            serde_json::json!({ "rootId": "not-a-root", "key": "abc-123" })
        )
        .is_err());
    }
}
