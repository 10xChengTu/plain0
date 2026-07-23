use std::collections::BTreeSet;

use crate::path_policy::RelativePath;
use crate::theme::fixtures::{minimal_safe_svg, vsix_source, PackageFixture};
use crate::theme::font_check::WOFF_MAGIC;
use crate::theme::unpack::stage_vsix;
use crate::theme::MAX_ICON_ASSOCIATIONS;

use super::validate_icon_theme_document;

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).expect("valid fixture wire path")
}

fn assert_code(result: Result<(), crate::error::CommandError>, code: &str) {
    let error = result.expect_err("expected icon theme document validation to fail");
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
            validate_icon_theme_document(&staged, &file_set, &path($entry), &mut resources);
        (result, resources)
    }};
}

#[test]
fn accepts_a_full_document_and_collects_every_referenced_resource() {
    let document = r#"{
        "fonts": [{ "id": "myfont", "src": [{ "path": "myfont.woff", "format": "woff" }] }],
        "iconDefinitions": {
            "_file": { "iconPath": "file.svg" },
            "_folder": { "fontCharacter": "\\e001", "fontId": "myfont" }
        },
        "file": "_file",
        "folder": "_folder",
        "folderExpanded": "_folder",
        "rootFolder": "_folder",
        "rootFolderExpanded": "_folder",
        "fileExtensions": { "rs": "_file" },
        "fileNames": { "cargo.toml": "_file" },
        "folderNames": { "src": "_folder" },
        "languageIds": { "rust": "_file" },
        "light": { "file": "_file" },
        "highContrast": { "file": "_file" },
        "hidesExplorerArrows": true
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    fixture.file("icons/file.svg", minimal_safe_svg().as_bytes());
    fixture.file("icons/myfont.woff", WOFF_MAGIC);

    let (result, resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect("well-formed icon theme document validates");
    assert_eq!(
        resources,
        BTreeSet::from([
            "icons/theme.json".to_owned(),
            "icons/file.svg".to_owned(),
            "icons/myfont.woff".to_owned(),
        ])
    );
}

#[test]
fn rejects_a_document_that_is_not_valid_jsonc_or_not_an_object() {
    for body in ["not json at all", "[1, 2, 3]", "\"just a string\""] {
        let mut fixture = PackageFixture::new();
        fixture.file("icons/theme.json", body.as_bytes());
        let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
        assert_code(result, "THEME_ICON_JSON_INVALID");
    }
}

#[test]
fn an_icon_path_missing_from_the_unpack_manifest_is_rejected() {
    let document =
        r#"{ "iconDefinitions": { "_file": { "iconPath": "missing.svg" } }, "file": "_file" }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_ICON_RESOURCE_INVALID");
}

#[test]
fn an_icon_path_escaping_the_package_root_is_rejected() {
    let document = r#"{ "iconDefinitions": { "_file": { "iconPath": "../../escape.svg" } } }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_ICON_RESOURCE_INVALID");
}

#[test]
fn an_unsafe_svg_icon_path_rejects_the_whole_document() {
    let document = r#"{ "iconDefinitions": { "_file": { "iconPath": "evil.svg" } } }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    fixture.file("icons/evil.svg", b"<svg><script>alert(1)</script></svg>");
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_SVG_UNSAFE");
}

#[test]
fn malformed_icon_definition_entries_are_skipped_leniently() {
    let document = r#"{
        "iconDefinitions": {
            "_a": "not an object",
            "_b": { "fontCharacter": "\\e001" },
            "_c": { "iconPath": 42 }
        }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect("malformed individual icon definitions are skipped, not rejected");
    assert_eq!(resources, BTreeSet::from(["icons/theme.json".to_owned()]));
}

#[test]
fn fonts_with_missing_id_invalid_id_or_no_src_are_skipped_leniently() {
    let document = r#"{
        "fonts": [
            { "src": [{ "path": "a.woff", "format": "woff" }] },
            { "id": "bad id!", "src": [{ "path": "b.woff", "format": "woff" }] },
            { "id": "ok-font" },
            "not an object"
        ]
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect("every font entry here is individually unusable and must be skipped");
    assert_eq!(resources, BTreeSet::from(["icons/theme.json".to_owned()]));
}

#[test]
fn font_src_with_unrecognized_format_is_skipped_leniently() {
    let document = r#"{
        "fonts": [{ "id": "ok", "src": [{ "path": "missing.ttf", "format": "ttf" }] }]
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect("an unrecognized font format is ignored, never resolved as a resource");
    assert_eq!(resources, BTreeSet::from(["icons/theme.json".to_owned()]));
}

#[test]
fn font_src_with_forged_extension_content_mismatch_is_rejected() {
    let document = r#"{
        "fonts": [{ "id": "ok", "src": [{ "path": "font.woff", "format": "woff" }] }]
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    fixture.file("icons/font.woff", b"this is not a real font file at all");
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_FONT_INVALID");
}

#[test]
fn font_src_format_svg_dispatches_to_the_svg_sanitizer() {
    let document = r#"{
        "fonts": [{ "id": "ok", "src": [{ "path": "glyphs.svg", "format": "svg" }] }]
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    fixture.file("icons/glyphs.svg", b"<svg onload=\"alert(1)\"></svg>");
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_SVG_UNSAFE");
}

#[test]
fn font_src_path_escaping_the_package_root_is_rejected() {
    let document = r#"{
        "fonts": [{ "id": "ok", "src": [{ "path": "../../escape.woff", "format": "woff" }] }]
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_ICON_RESOURCE_INVALID");
}

#[test]
fn too_many_total_association_entries_is_rejected() {
    let mut file_extensions = serde_json::Map::new();
    for index in 0..=MAX_ICON_ASSOCIATIONS {
        file_extensions.insert(
            format!("ext{index}"),
            serde_json::Value::String("_common".to_owned()),
        );
    }
    let document = serde_json::json!({
        "iconDefinitions": { "_common": { "fontCharacter": "e001" } },
        "fileExtensions": serde_json::Value::Object(file_extensions),
    });
    let mut fixture = PackageFixture::new();
    fixture.file(
        "icons/theme.json",
        serde_json::to_vec(&document)
            .expect("serializes")
            .as_slice(),
    );
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    assert_code(result, "THEME_ICON_TOO_MANY_ASSOCIATIONS");
}

#[test]
fn exactly_at_the_association_budget_is_accepted() {
    let mut file_extensions = serde_json::Map::new();
    for index in 0..(MAX_ICON_ASSOCIATIONS - 1) {
        file_extensions.insert(
            format!("ext{index}"),
            serde_json::Value::String("_common".to_owned()),
        );
    }
    let document = serde_json::json!({
        "iconDefinitions": { "_common": { "fontCharacter": "e001" } },
        "fileExtensions": serde_json::Value::Object(file_extensions),
    });
    let mut fixture = PackageFixture::new();
    fixture.file(
        "icons/theme.json",
        serde_json::to_vec(&document)
            .expect("serializes")
            .as_slice(),
    );
    let (result, _resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect(
        "exactly MAX_ICON_ASSOCIATIONS total entries (1 iconDefinitions + N-1 fileExtensions) \
         is accepted",
    );
}

#[test]
fn unknown_top_level_fields_are_ignored() {
    let document = r#"{
        "showLanguageModeIcons": true,
        "somethingPlainDoesNotKnowAbout": { "nested": [1, 2, 3] }
    }"#;
    let mut fixture = PackageFixture::new();
    fixture.file("icons/theme.json", document.as_bytes());
    let (result, resources) = validate_fixture!(fixture, "icons/theme.json");
    result.expect("unknown fields never fail validation");
    assert_eq!(resources, BTreeSet::from(["icons/theme.json".to_owned()]));
}
