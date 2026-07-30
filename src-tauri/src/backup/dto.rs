use serde::Deserialize;

use super::BackupKey;

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
    key: BackupKey,
}

impl BackupDiscardRequest {
    pub(crate) fn into_key(self) -> BackupKey {
        self.key
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
        let request: BackupDiscardRequest =
            serde_json::from_value(serde_json::json!({ "key": "abc-123" })).unwrap();
        assert_eq!(request.into_key().as_str(), "abc-123");

        assert!(serde_json::from_value::<BackupDiscardRequest>(serde_json::json!({})).is_err());
        assert!(serde_json::from_value::<BackupDiscardRequest>(
            serde_json::json!({ "key": "abc-123", "extra": true })
        )
        .is_err());
        assert!(serde_json::from_value::<BackupDiscardRequest>(
            serde_json::json!({ "key": "../etc" })
        )
        .is_err());
    }
}
