use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::error::CommandError;

use super::invalid_close_request;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct CloseRequestId(Uuid);

impl CloseRequestId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub(crate) fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }

    fn parse(wire: &str) -> Result<Self, CommandError> {
        let value = Uuid::parse_str(wire).map_err(|_| invalid_close_request())?;
        if value.hyphenated().to_string() != wire
            || value.get_version() != Some(uuid::Version::Random)
            || value.get_variant() != uuid::Variant::RFC4122
        {
            return Err(invalid_close_request());
        }
        Ok(Self(value))
    }
}

impl Serialize for CloseRequestId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for CloseRequestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        Self::parse(&wire).map_err(|_| D::Error::custom("invalid close request id"))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloseReason {
    Close,
    Quit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloseOutcome {
    Allow,
    Veto,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloseRequestEvent {
    pub(crate) request_id: CloseRequestId,
    pub(crate) reason: CloseReason,
    pub(crate) timeout_ms: u32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CompleteCloseRequest {
    pub(crate) request_id: CloseRequestId,
    pub(crate) outcome: CloseOutcome,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RequestCloseRequest {}

impl RequestCloseRequest {
    pub(crate) const fn validate(self) {}
}

#[cfg(test)]
mod tests {
    use super::{
        CloseOutcome, CloseReason, CloseRequestEvent, CloseRequestId, CompleteCloseRequest,
    };

    #[test]
    fn event_and_completion_use_a_closed_camel_case_contract() {
        let event = CloseRequestEvent {
            request_id: CloseRequestId::new(),
            reason: CloseReason::Quit,
            timeout_ms: 5_000,
        };
        let value = serde_json::to_value(&event).unwrap();
        assert!(value["requestId"].as_str().unwrap().len() == 36);
        assert_eq!(value["reason"], "quit");
        assert_eq!(value["timeoutMs"], 5_000);
        assert!(value.get("request_id").is_none());

        let completion: CompleteCloseRequest = serde_json::from_value(serde_json::json!({
            "requestId": value["requestId"],
            "outcome": "allow"
        }))
        .unwrap();
        assert_eq!(completion.request_id, event.request_id);
        assert_eq!(completion.outcome, CloseOutcome::Allow);
    }

    #[test]
    fn completion_rejects_unknown_fields_bad_ids_and_open_outcomes() {
        for value in [
            serde_json::json!({ "requestId": "bad", "outcome": "allow" }),
            serde_json::json!({
                "requestId": "00000000-0000-4000-8000-000000000001",
                "outcome": "force"
            }),
            serde_json::json!({
                "requestId": "00000000-0000-4000-8000-000000000001",
                "outcome": "veto",
                "extra": true
            }),
        ] {
            assert!(serde_json::from_value::<CompleteCloseRequest>(value).is_err());
        }
    }
}
