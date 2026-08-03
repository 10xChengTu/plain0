use serde::{Deserialize, Serialize};

use super::ScratchId;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScratchCreateRequest {}

impl ScratchCreateRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScratchCreateResult {
    scratch_id: ScratchId,
}

impl ScratchCreateResult {
    pub(crate) const fn new(scratch_id: ScratchId) -> Self {
        Self { scratch_id }
    }

    pub const fn scratch_id(self) -> ScratchId {
        self.scratch_id
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScratchReadAllRequest {}

impl ScratchReadAllRequest {
    pub const fn validate(self) {}
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScratchDiscardRequest {
    scratch_id: ScratchId,
}

impl ScratchDiscardRequest {
    pub const fn scratch_id(self) -> ScratchId {
        self.scratch_id
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScratchDiscardAllRequest {}

impl ScratchDiscardAllRequest {
    pub const fn validate(self) {}
}

#[cfg(test)]
mod tests {
    use super::{
        ScratchCreateRequest, ScratchDiscardAllRequest, ScratchDiscardRequest,
        ScratchReadAllRequest,
    };

    const SCRATCH_ID: &str = "00000000-0000-4000-8000-000000000001";

    #[test]
    fn empty_requests_reject_extra_fields() {
        serde_json::from_value::<ScratchCreateRequest>(serde_json::json!({})).unwrap();
        serde_json::from_value::<ScratchReadAllRequest>(serde_json::json!({})).unwrap();
        serde_json::from_value::<ScratchDiscardAllRequest>(serde_json::json!({})).unwrap();
        assert!(serde_json::from_value::<ScratchCreateRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
        assert!(serde_json::from_value::<ScratchReadAllRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
        assert!(serde_json::from_value::<ScratchDiscardAllRequest>(
            serde_json::json!({ "extra": true })
        )
        .is_err());
    }

    #[test]
    fn discard_requires_one_canonical_scratch_id() {
        let request: ScratchDiscardRequest = serde_json::from_value(serde_json::json!({
            "scratchId": SCRATCH_ID
        }))
        .unwrap();
        assert_eq!(request.scratch_id().as_wire(), SCRATCH_ID);
        assert!(serde_json::from_value::<ScratchDiscardRequest>(serde_json::json!({})).is_err());
        assert!(
            serde_json::from_value::<ScratchDiscardRequest>(serde_json::json!({
                "scratchId": SCRATCH_ID,
                "extra": true
            }))
            .is_err()
        );
    }
}
