use std::collections::BTreeSet;

use crate::path_policy::RelativePath;
use crate::theme::fixtures::{vsix_source, PackageFixture};
use crate::theme::font_check::WOFF_MAGIC;
use crate::theme::unpack::stage_vsix;
use crate::theme::MAX_ICON_ASSOCIATIONS;

use super::validate_product_icon_theme_document;

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).expect("valid fixture wire path")
}

fn assert_code(result: Result<(), crate::error::CommandError>, code: &str) {
    let error = result.expect_err("expected product icon theme document validation to fail");
    assert_eq!(error.code(), code);
}

macro_rules! validate_fixture {
    ($fixture:expr, $entry:expr) => {{
        let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
        let bytes = $fixture.finish();
        let (_source_temp, file) = vsix_source(&bytes);
        let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
        let file_set: BTreeSet<String> = files.into_iter().collect();
        let mut resources = BTreeSet::new();
        let result =
            validate_product_icon_theme_document(&staged, &file_set, &path($entry), &mut resources);
        (result, resources)
    }};
}

#[test]
fn accepts_a_full_document_and_collects_every_referenced_resource() {
    let document = r#"{
        "fonts": [{ "id": "codicon", "src": [{ "path": "codicon.woff", "format": "woff" }] }],
        "iconDefinitions": {
            "close": { "fontCharacter": "\\e001", "fontId": "codicon" }
        }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    fixture.file("producticons/codicon.woff", WOFF_MAGIC);

    let (result, resources) = validate_fixture!(fixture, "producticons/theme.json");
    result.expect("well-formed product icon theme document validates");
    assert_eq!(
        resources,
        BTreeSet::from([
            "producticons/theme.json".to_owned(),
            "producticons/codicon.woff".to_owned(),
        ])
    );
}

#[test]
fn rejects_a_document_that_is_not_valid_jsonc_or_not_an_object() {
    for body in ["not json at all", "[1, 2, 3]"] {
        let mut fixture = PackageFixture::new();
        fixture.file("producticons/theme.json", body.as_bytes());
        let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
        assert_code(result, "THEME_PRODUCT_ICON_JSON_INVALID");
    }
}

#[test]
fn rejects_a_document_missing_the_fonts_field_entirely() {
    let document = r#"{ "iconDefinitions": { "close": { "fontCharacter": "\\e001" } } }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_PRODUCT_ICON_JSON_INVALID");
}

#[test]
fn rejects_a_document_whose_fonts_array_is_empty() {
    let document =
        r#"{ "fonts": [], "iconDefinitions": { "close": { "fontCharacter": "\\e001" } } }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_PRODUCT_ICON_JSON_INVALID");
}

#[test]
fn rejects_a_document_missing_icon_definitions_entirely() {
    let document =
        r#"{ "fonts": [{ "id": "codicon", "src": [{ "path": "a.woff", "format": "woff" }] }] }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_PRODUCT_ICON_JSON_INVALID");
}

#[test]
fn rejects_a_document_whose_icon_definitions_is_not_an_object() {
    let document = r#"{
        "fonts": [{ "id": "codicon", "src": [{ "path": "a.woff", "format": "woff" }] }],
        "iconDefinitions": "not an object"
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_PRODUCT_ICON_JSON_INVALID");
}

#[test]
fn font_entries_with_invalid_id_or_missing_src_are_skipped_leniently() {
    let document = r#"{
        "fonts": [
            { "id": "bad id!", "src": [{ "path": "a.woff", "format": "woff" }] },
            { "id": "no-src" },
            "not an object"
        ],
        "iconDefinitions": { "close": { "fontCharacter": "\\e001" } }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, resources) = validate_fixture!(fixture, "producticons/theme.json");
    result.expect("every font entry here is individually unusable and must be skipped");
    assert_eq!(
        resources,
        BTreeSet::from(["producticons/theme.json".to_owned()])
    );
}

#[test]
fn font_src_with_forged_extension_content_mismatch_is_rejected() {
    let document = r#"{
        "fonts": [{ "id": "codicon", "src": [{ "path": "codicon.woff", "format": "woff" }] }],
        "iconDefinitions": { "close": { "fontCharacter": "\\e001" } }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    fixture.file("producticons/codicon.woff", b"not a real font");
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_FONT_INVALID");
}

#[test]
fn font_src_format_svg_dispatches_to_the_svg_sanitizer() {
    let document = r#"{
        "fonts": [{ "id": "codicon", "src": [{ "path": "codicon.svg", "format": "svg" }] }],
        "iconDefinitions": { "close": { "fontCharacter": "\\e001" } }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    fixture.file(
        "producticons/codicon.svg",
        b"<svg onload=\"alert(1)\"></svg>",
    );
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_SVG_UNSAFE");
}

#[test]
fn font_src_path_escaping_the_package_root_is_rejected() {
    let document = r#"{
        "fonts": [{ "id": "codicon", "src": [{ "path": "../../escape.woff", "format": "woff" }] }],
        "iconDefinitions": { "close": { "fontCharacter": "\\e001" } }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("producticons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_ICON_RESOURCE_INVALID");
}

#[test]
fn too_many_icon_definitions_is_rejected() {
    let mut icon_definitions = serde_json::Map::new();
    for index in 0..=MAX_ICON_ASSOCIATIONS {
        icon_definitions.insert(
            format!("icon{index}"),
            serde_json::json!({ "fontCharacter": "\\e001" }),
        );
    }
    let document = serde_json::json!({
        "fonts": [{ "id": "codicon", "src": [{ "path": "a.woff", "format": "woff" }] }],
        "iconDefinitions": serde_json::Value::Object(icon_definitions),
    });
    let mut fixture = PackageFixture::new();
    fixture.file(
        "producticons/theme.json",
        serde_json::to_vec(&document)
            .expect("serializes")
            .as_slice(),
    );
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    assert_code(result, "THEME_ICON_TOO_MANY_ASSOCIATIONS");
}

#[test]
fn exactly_at_the_icon_definitions_budget_is_accepted() {
    let mut icon_definitions = serde_json::Map::new();
    for index in 0..MAX_ICON_ASSOCIATIONS {
        icon_definitions.insert(
            format!("icon{index}"),
            serde_json::json!({ "fontCharacter": "\\e001" }),
        );
    }
    let document = serde_json::json!({
        "fonts": [{ "id": "codicon", "src": [{ "path": "a.woff", "format": "woff" }] }],
        "iconDefinitions": serde_json::Value::Object(icon_definitions),
    });
    let mut fixture = PackageFixture::new();
    fixture.file(
        "producticons/theme.json",
        serde_json::to_vec(&document)
            .expect("serializes")
            .as_slice(),
    );
    fixture.file("producticons/a.woff", WOFF_MAGIC);
    let (result, _resources) = validate_fixture!(fixture, "producticons/theme.json");
    result.expect("exactly MAX_ICON_ASSOCIATIONS iconDefinitions entries is accepted");
}
