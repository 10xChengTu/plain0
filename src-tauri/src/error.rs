#[derive(Debug, PartialEq, serde::Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[cfg(test)]
mod tests {
    use super::CommandError;

    #[test]
    fn command_error_contract_has_stable_fields() {
        let value = serde_json::to_value(CommandError::new("TEST_ERROR", "failure"))
            .expect("command error serializes");
        assert_eq!(value["code"], "TEST_ERROR");
        assert_eq!(value["message"], "failure");
    }
}
