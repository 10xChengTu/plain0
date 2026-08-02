use std::num::NonZeroU64;

use serde::{Deserialize, Serialize};

use crate::error::CommandError;

use super::service::{validate_content, MAX_KEYBINDINGS_BYTES, MAX_SETTINGS_BYTES};
use super::user_data_too_large;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UserDataResource {
    Settings,
    Keybindings,
}

impl UserDataResource {
    pub(crate) const fn file_name(self) -> &'static str {
        match self {
            Self::Settings => "settings.plain.json",
            Self::Keybindings => "keybindings.plain.json",
        }
    }

    pub(crate) const fn default_content(self) -> &'static str {
        match self {
            Self::Settings => "{}\n",
            Self::Keybindings => "[]\n",
        }
    }

    pub(crate) const fn max_content_bytes(self) -> usize {
        match self {
            Self::Settings => MAX_SETTINGS_BYTES,
            Self::Keybindings => MAX_KEYBINDINGS_BYTES,
        }
    }

    pub(crate) const fn as_wire(self) -> &'static str {
        match self {
            Self::Settings => "settings",
            Self::Keybindings => "keybindings",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserDataReadRequest {
    resource: UserDataResource,
}

impl UserDataReadRequest {
    pub(crate) const fn into_resource(self) -> UserDataResource {
        self.resource
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserDataWriteRequest {
    resource: UserDataResource,
    expected_revision: NonZeroU64,
    content: String,
}

impl UserDataWriteRequest {
    pub(crate) fn into_parts(self) -> Result<(UserDataResource, u64, String), CommandError> {
        if self.content.len() > self.resource.max_content_bytes() {
            return Err(user_data_too_large());
        }
        validate_content(self.resource, &self.content)?;
        Ok((self.resource, self.expected_revision.get(), self.content))
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDataResult {
    resource: UserDataResource,
    revision: u64,
    content: String,
}

impl UserDataResult {
    pub(crate) fn new(resource: UserDataResource, revision: u64, content: String) -> Self {
        Self {
            resource,
            revision,
            content,
        }
    }

    pub(crate) const fn resource(&self) -> UserDataResource {
        self.resource
    }

    pub(crate) const fn revision(&self) -> u64 {
        self.revision
    }

    #[cfg(test)]
    pub(crate) fn content(&self) -> &str {
        &self.content
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDataChangedEvent {
    resource: UserDataResource,
    revision: u64,
}

impl From<&UserDataResult> for UserDataChangedEvent {
    fn from(result: &UserDataResult) -> Self {
        Self {
            resource: result.resource(),
            revision: result.revision(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{UserDataReadRequest, UserDataWriteRequest};

    #[test]
    fn read_request_rejects_missing_unknown_and_extra_fields() {
        serde_json::from_value::<UserDataReadRequest>(serde_json::json!({
            "resource": "settings"
        }))
        .unwrap();
        assert!(serde_json::from_value::<UserDataReadRequest>(serde_json::json!({})).is_err());
        assert!(
            serde_json::from_value::<UserDataReadRequest>(serde_json::json!({
                "resource": "snippets"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<UserDataReadRequest>(serde_json::json!({
                "resource": "settings",
                "path": "/tmp/settings.json"
            }))
            .is_err()
        );
    }

    #[test]
    fn write_request_requires_a_positive_revision_and_matching_jsonc_shape() {
        let valid = serde_json::from_value::<UserDataWriteRequest>(serde_json::json!({
            "resource": "settings",
            "expectedRevision": 1,
            "content": "{ // comment\n \"files.autoSave\": \"off\",\n}"
        }))
        .unwrap();
        assert!(valid.into_parts().is_ok());

        assert!(
            serde_json::from_value::<UserDataWriteRequest>(serde_json::json!({
                "resource": "settings",
                "expectedRevision": 0,
                "content": "{}"
            }))
            .is_err()
        );

        let wrong_shape = serde_json::from_value::<UserDataWriteRequest>(serde_json::json!({
            "resource": "keybindings",
            "expectedRevision": 1,
            "content": "{}"
        }))
        .unwrap();
        assert_eq!(
            wrong_shape.into_parts().unwrap_err().code(),
            "USER_DATA_INVALID"
        );
    }
}
