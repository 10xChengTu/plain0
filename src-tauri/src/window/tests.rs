use uuid::{Uuid, Variant, Version};

use super::commands::{create_error_for_test, label_for_test, template_error_for_test};
use super::dto::WindowCreateRequest;
use super::{should_restore_last_workspace, SECONDARY_WINDOW_LABEL_PREFIX};

#[test]
fn generated_window_labels_are_canonical_random_uuid_tokens() {
    for _ in 0..32 {
        let label = label_for_test();
        let wire = label
            .strip_prefix(SECONDARY_WINDOW_LABEL_PREFIX)
            .expect("window label prefix");
        assert_eq!(wire.len(), 32);
        assert!(wire
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()));
        let parsed = Uuid::parse_str(wire).expect("simple UUID label token");
        assert_eq!(parsed.get_version(), Some(Version::Random));
        assert_eq!(parsed.get_variant(), Variant::RFC4122);
        assert_eq!(parsed.simple().to_string(), wire);
    }
}

#[test]
fn only_the_static_main_window_restores_the_last_workspace() {
    assert!(should_restore_last_workspace("main"));
    assert!(!should_restore_last_workspace(
        "plain-window-00000000000040008000000000000000"
    ));
    assert!(!should_restore_last_workspace("other"));
}

#[test]
fn window_failures_are_sanitized_and_stable() {
    let missing = template_error_for_test();
    assert_eq!(missing.code(), "WINDOW_TEMPLATE_UNAVAILABLE");
    assert_eq!(
        missing.message(),
        "The Plain window template is unavailable."
    );

    let failed = create_error_for_test();
    assert_eq!(failed.code(), "WINDOW_CREATE_FAILED");
    assert_eq!(failed.message(), "The Plain window could not be created.");
}

#[test]
fn window_create_request_is_closed_and_empty() {
    assert!(serde_json::from_value::<WindowCreateRequest>(serde_json::json!({})).is_ok());
    assert!(
        serde_json::from_value::<WindowCreateRequest>(serde_json::json!({
            "url": "https://example.com",
        }))
        .is_err()
    );
}
