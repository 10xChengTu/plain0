use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WindowCreateRequest {}

impl WindowCreateRequest {
    pub(crate) const fn validate(self) {}
}
