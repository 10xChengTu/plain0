use std::collections::BTreeSet;

use crate::theme::fixtures::{minimal_manifest, minimal_theme_json, vsix_source, PackageFixture};
use crate::theme::unpack::stage_vsix;

use super::parse_and_validate;

/// Builds a fixture VSIX with `manifest_body` as `package.json` plus any
/// `extra_files`, stages it (reusing the already-tested S1 unpack path),
/// and returns `parse_and_validate`'s result. The staging session and its
/// backing temp directories are all dropped at the end of this call — every
/// test only inspects the `Result`, never residual filesystem state (that is
/// `unpack`'s own, already-covered concern).
fn validate_manifest_fixture(
    manifest_body: &str,
    extra_files: &[(&str, &[u8])],
) -> Result<super::ValidatedManifest, crate::error::CommandError> {
    let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
    let mut fixture = PackageFixture::new();
    fixture.manifest(manifest_body);
    for (path, contents) in extra_files {
        fixture.file(path, contents);
    }
    let bytes = fixture.finish();
    let (_source_temp, file) = vsix_source(&bytes);

    let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
    let file_set: BTreeSet<String> = files.into_iter().collect();
    parse_and_validate(&staged, &file_set)
}

fn assert_code(result: Result<super::ValidatedManifest, crate::error::CommandError>, code: &str) {
    let error = result.expect_err("expected manifest validation to fail");
    assert_eq!(error.code(), code);
}

const ONE_DARK_THEME: &str = r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#;

#[test]
fn accepts_a_minimal_well_formed_manifest_and_extracts_every_field() {
    let manifest = minimal_manifest(ONE_DARK_THEME);
    let validated = validate_manifest_fixture(
        &manifest,
        &[("themes/dark.json", minimal_theme_json().as_bytes())],
    )
    .expect("well-formed manifest validates");
    assert_eq!(validated.publisher, "demo-publisher");
    assert_eq!(validated.name, "demo-theme");
    assert_eq!(validated.version, "1.0.0");
    assert_eq!(validated.semantic_id(), "demo-publisher.demo-theme@1.0.0");
    assert_eq!(validated.themes.len(), 1);
    assert_eq!(validated.themes[0].path.as_wire(), "themes/dark.json");
    assert_eq!(validated.themes[0].ui_theme, super::UiTheme::Dark);
    assert!(validated.themes[0].label.is_none());
    assert!(!validated.contains_code);
    assert!(validated.icon_themes.is_empty());
    assert!(validated.product_icon_themes.is_empty());
}

#[test]
fn missing_manifest_file_entirely_is_rejected() {
    let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
    let mut fixture = PackageFixture::new();
    fixture.file("README.md", b"no package.json in this package");
    let bytes = fixture.finish();
    let (_source_temp, file) = vsix_source(&bytes);
    let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
    let file_set: BTreeSet<String> = files.into_iter().collect();
    assert_code(
        parse_and_validate(&staged, &file_set),
        "THEME_MANIFEST_MISSING",
    );
}

#[test]
fn manifest_that_is_not_a_json_object_is_rejected() {
    assert_code(
        validate_manifest_fixture("[1, 2, 3]", &[]),
        "THEME_MANIFEST_INVALID",
    );
    assert_code(
        validate_manifest_fixture("not json at all", &[]),
        "THEME_MANIFEST_INVALID",
    );
}

#[test]
fn missing_required_identity_fields_are_rejected() {
    for manifest in [
        r#"{"publisher":"demo","version":"1.0.0","contributes":{"themes":[]}}"#,
        r#"{"name":"demo","version":"1.0.0","contributes":{"themes":[]}}"#,
        r#"{"name":"demo","publisher":"demo","contributes":{"themes":[]}}"#,
    ] {
        assert_code(
            validate_manifest_fixture(manifest, &[]),
            "THEME_MANIFEST_FIELD_INVALID",
        );
    }
}

#[test]
fn identity_fields_with_disallowed_characters_are_rejected() {
    for (name, publisher, version) in [
        ("../etc", "demo-publisher", "1.0.0"),
        ("demo theme", "demo-publisher", "1.0.0"),
        ("demo-theme", "demo publisher", "1.0.0"),
        ("demo-theme", "demo-publisher", "1.0.0/../escape"),
        ("demo-theme", "demo-publisher", ""),
        (".hidden", "demo-publisher", "1.0.0"),
    ] {
        let manifest = format!(
            r#"{{"name":"{name}","publisher":"{publisher}","version":"{version}","contributes":{{"themes":{ONE_DARK_THEME}}}}}"#
        );
        assert_code(
            validate_manifest_fixture(
                &manifest,
                &[("themes/dark.json", minimal_theme_json().as_bytes())],
            ),
            "THEME_MANIFEST_FIELD_INVALID",
        );
    }
}

#[test]
fn identity_composed_into_a_windows_reserved_device_name_is_rejected() {
    // Each field individually satisfies the plain alphanumeric/hyphen/dot
    // charset whitelist, but the *composed* `publisher.name@version` string
    // begins with the Windows-reserved stem `CON` — the final
    // `RelativePath::parse_wire` check on the composed identity must still
    // catch this even though no individual field looked unsafe on its own.
    let manifest =
        r#"{"name":"theme","publisher":"CON","version":"1.0.0","contributes":{"themes":[]}}"#;
    assert_code(
        validate_manifest_fixture(manifest, &[]),
        "THEME_MANIFEST_FIELD_INVALID",
    );
}

#[test]
fn absent_contributes_themes_is_rejected() {
    assert_code(
        validate_manifest_fixture(
            r#"{"name":"demo-theme","publisher":"demo-publisher","version":"1.0.0"}"#,
            &[],
        ),
        "THEME_PACKAGE_NO_THEMES",
    );
}

#[test]
fn empty_contributes_themes_array_is_rejected() {
    assert_code(
        validate_manifest_fixture(&minimal_manifest("[]"), &[]),
        "THEME_PACKAGE_NO_THEMES",
    );
}

#[test]
fn contributes_themes_not_an_array_is_rejected() {
    let manifest = r#"{"name":"demo-theme","publisher":"demo-publisher","version":"1.0.0","contributes":{"themes":"nope"}}"#;
    assert_code(
        validate_manifest_fixture(manifest, &[]),
        "THEME_PACKAGE_NO_THEMES",
    );
}

#[test]
fn contribution_with_an_invalid_ui_theme_value_is_rejected() {
    let manifest = minimal_manifest(r#"[{"uiTheme":"solarized","path":"./themes/dark.json"}]"#);
    assert_code(
        validate_manifest_fixture(
            &manifest,
            &[("themes/dark.json", minimal_theme_json().as_bytes())],
        ),
        "THEME_CONTRIBUTION_INVALID",
    );
}

#[test]
fn contribution_missing_ui_theme_or_path_is_rejected() {
    for themes in [
        r#"[{"path":"./themes/dark.json"}]"#,
        r#"[{"uiTheme":"vs-dark"}]"#,
        r#"[{"uiTheme":"vs-dark","path":42}]"#,
        r#"["not-an-object"]"#,
    ] {
        let manifest = minimal_manifest(themes);
        assert_code(
            validate_manifest_fixture(
                &manifest,
                &[("themes/dark.json", minimal_theme_json().as_bytes())],
            ),
            "THEME_CONTRIBUTION_INVALID",
        );
    }
}

#[test]
fn contribution_path_escaping_the_package_root_is_rejected() {
    let manifest = minimal_manifest(r#"[{"uiTheme":"vs-dark","path":"../../escape.json"}]"#);
    assert_code(
        validate_manifest_fixture(&manifest, &[]),
        "THEME_CONTRIBUTION_PATH_INVALID",
    );
}

#[test]
fn contribution_path_missing_from_the_unpack_manifest_is_rejected() {
    // Well-formed relative path, but this fixture never actually extracts
    // `themes/dark.json` — the manifest is the only file in the package.
    let manifest = minimal_manifest(ONE_DARK_THEME);
    assert_code(
        validate_manifest_fixture(&manifest, &[]),
        "THEME_CONTRIBUTION_PATH_INVALID",
    );
}

#[test]
fn contains_code_flag_is_set_when_main_browser_or_activation_events_are_present_but_never_dereferenced(
) {
    for extra_field in [
        r#""main": "./out/extension.js""#,
        r#""browser": "./out/web.js""#,
        r#""activationEvents": ["onStartupFinished"]"#,
    ] {
        let manifest = format!(
            r#"{{
                "name": "demo-theme",
                "publisher": "demo-publisher",
                "version": "1.0.0",
                {extra_field},
                "contributes": {{ "themes": {ONE_DARK_THEME} }}
            }}"#
        );
        let validated = validate_manifest_fixture(
            &manifest,
            &[("themes/dark.json", minimal_theme_json().as_bytes())],
        )
        .expect("manifest with main/browser/activationEvents still validates");
        assert!(
            validated.contains_code,
            "containsCode must be true for {extra_field}"
        );
    }
}

#[test]
fn contains_code_is_false_when_none_of_the_three_fields_are_present() {
    let manifest = minimal_manifest(ONE_DARK_THEME);
    let validated = validate_manifest_fixture(
        &manifest,
        &[("themes/dark.json", minimal_theme_json().as_bytes())],
    )
    .expect("validates");
    assert!(!validated.contains_code);
}

#[test]
fn nls_placeholder_label_is_stored_verbatim_never_translated() {
    let manifest = minimal_manifest(
        r#"[{"label":"%displayName%","uiTheme":"vs-dark","path":"./themes/dark.json"}]"#,
    );
    let validated = validate_manifest_fixture(
        &manifest,
        &[("themes/dark.json", minimal_theme_json().as_bytes())],
    )
    .expect("validates");
    assert_eq!(validated.themes[0].label.as_deref(), Some("%displayName%"));
}

#[test]
fn engines_field_is_tolerated_in_any_shape_without_validation() {
    for engines in [
        r#""engines": "not even an object""#,
        r#""engines": 42"#,
        r#""engines": null"#,
    ] {
        let manifest = format!(
            r#"{{
                "name": "demo-theme",
                "publisher": "demo-publisher",
                "version": "1.0.0",
                {engines},
                "contributes": {{ "themes": {ONE_DARK_THEME} }}
            }}"#
        );
        validate_manifest_fixture(
            &manifest,
            &[("themes/dark.json", minimal_theme_json().as_bytes())],
        )
        .expect("malformed engines field must never fail validation");
    }
}

#[test]
fn icon_themes_and_product_icon_themes_are_validated_structurally() {
    let manifest = format!(
        r#"{{
            "name": "demo-theme",
            "publisher": "demo-publisher",
            "version": "1.0.0",
            "contributes": {{
                "themes": {ONE_DARK_THEME},
                "iconThemes": [{{"id": "demo-icons", "label": "Demo Icons", "path": "./icons/theme.json"}}],
                "productIconThemes": [{{"id": "demo-product-icons", "path": "./producticons/theme.json"}}]
            }}
        }}"#
    );
    let validated = validate_manifest_fixture(
        &manifest,
        &[
            ("themes/dark.json", minimal_theme_json().as_bytes()),
            ("icons/theme.json", b"{}"),
            ("producticons/theme.json", b"{}"),
        ],
    )
    .expect("well-formed iconThemes/productIconThemes entries validate");

    assert_eq!(validated.icon_themes.len(), 1);
    assert_eq!(validated.icon_themes[0].id, "demo-icons");
    assert_eq!(
        validated.icon_themes[0].label.as_deref(),
        Some("Demo Icons")
    );
    assert_eq!(validated.icon_themes[0].path.as_wire(), "icons/theme.json");

    assert_eq!(validated.product_icon_themes.len(), 1);
    assert_eq!(validated.product_icon_themes[0].id, "demo-product-icons");
    assert!(validated.product_icon_themes[0].label.is_none());
    assert_eq!(
        validated.product_icon_themes[0].path.as_wire(),
        "producticons/theme.json"
    );
}

#[test]
fn icon_theme_entries_missing_id_or_path_are_rejected() {
    for icon_themes in [
        r#"[{"path": "./icons/theme.json"}]"#,
        r#"[{"id": "demo-icons"}]"#,
        r#"[{"id": "demo-icons", "path": 42}]"#,
        r#"["not-an-object"]"#,
    ] {
        let manifest = format!(
            r#"{{
                "name": "demo-theme",
                "publisher": "demo-publisher",
                "version": "1.0.0",
                "contributes": {{ "iconThemes": {icon_themes} }}
            }}"#
        );
        assert_code(
            validate_manifest_fixture(&manifest, &[("icons/theme.json", b"{}")]),
            "THEME_CONTRIBUTION_INVALID",
        );
    }
}

#[test]
fn icon_theme_id_that_is_empty_or_too_long_is_rejected() {
    let too_long_id = "a".repeat(crate::theme::selection::MAX_THEME_SELECTION_ID_BYTES + 1);
    for id_literal in ["\"\"".to_owned(), format!("\"{too_long_id}\"")] {
        let manifest = format!(
            r#"{{
                "name": "demo-theme",
                "publisher": "demo-publisher",
                "version": "1.0.0",
                "contributes": {{ "iconThemes": [{{"id": {id_literal}, "path": "./icons/theme.json"}}] }}
            }}"#
        );
        assert_code(
            validate_manifest_fixture(&manifest, &[("icons/theme.json", b"{}")]),
            "THEME_CONTRIBUTION_INVALID",
        );
    }
}

#[test]
fn icon_theme_id_charset_check_rejects_empty_too_long_and_control_characters() {
    // Exercised directly against the private charset predicate rather than
    // round-tripped through a JSON fixture, since embedding a literal
    // control character inside a JSON string in Rust source text is fragile
    // to author reliably. The control character itself is built at test run
    // time from its numeric code point, never typed as a literal escape.
    let too_long_id = "a".repeat(crate::theme::selection::MAX_THEME_SELECTION_ID_BYTES + 1);
    let control_char = char::from_u32(1).expect("U+0001 is a valid char");
    let id_with_control_char = format!("bad{control_char}id");

    assert!(!super::is_valid_icon_theme_id(""));
    assert!(!super::is_valid_icon_theme_id(&too_long_id));
    assert!(!super::is_valid_icon_theme_id(&id_with_control_char));
    assert!(super::is_valid_icon_theme_id("demo-icons"));
    assert!(super::is_valid_icon_theme_id(
        &"a".repeat(crate::theme::selection::MAX_THEME_SELECTION_ID_BYTES)
    ));
}

#[test]
fn icon_theme_id_is_permissive_beyond_the_strict_font_id_charset() {
    // Deliberately more permissive than `fontIdRegex` (`^[\w_-]+$`) — see
    // `manifest::is_valid_icon_theme_id`'s own doc comment for why: spaces,
    // dots and unicode are all fine here.
    let manifest = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "iconThemes": [{"id": "Demo Icons v1.0 主题", "path": "./icons/theme.json"}] }
    }"#;
    let validated = validate_manifest_fixture(manifest, &[("icons/theme.json", b"{}")])
        .expect("a permissively-charactered icon theme id validates");
    assert_eq!(validated.icon_themes[0].id, "Demo Icons v1.0 主题");
}

#[test]
fn icon_theme_path_escaping_the_package_or_missing_from_the_unpack_manifest_is_rejected() {
    let escaping = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "iconThemes": [{"id": "demo-icons", "path": "../../escape.json"}] }
    }"#;
    assert_code(
        validate_manifest_fixture(escaping, &[]),
        "THEME_CONTRIBUTION_PATH_INVALID",
    );

    let missing = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "iconThemes": [{"id": "demo-icons", "path": "./icons/theme.json"}] }
    }"#;
    assert_code(
        validate_manifest_fixture(missing, &[]),
        "THEME_CONTRIBUTION_PATH_INVALID",
    );
}

#[test]
fn a_manifest_with_only_icon_themes_and_no_color_themes_is_now_accepted() {
    // `F060` broadens `THEME_PACKAGE_NO_THEMES`: a package need not declare
    // `contributes.themes` at all as long as some other theme-family
    // contribution exists.
    let manifest = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "iconThemes": [{"id": "demo-icons", "path": "./icons/theme.json"}] }
    }"#;
    let validated = validate_manifest_fixture(manifest, &[("icons/theme.json", b"{}")])
        .expect("iconThemes alone is enough to avoid THEME_PACKAGE_NO_THEMES");
    assert!(validated.themes.is_empty());
    assert_eq!(validated.icon_themes.len(), 1);
}

#[test]
fn a_manifest_with_only_product_icon_themes_and_no_other_contribution_is_now_accepted() {
    let manifest = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "productIconThemes": [{"id": "demo-product-icons", "path": "./producticons/theme.json"}] }
    }"#;
    let validated = validate_manifest_fixture(manifest, &[("producticons/theme.json", b"{}")])
        .expect("productIconThemes alone is enough to avoid THEME_PACKAGE_NO_THEMES");
    assert!(validated.themes.is_empty());
    assert!(validated.icon_themes.is_empty());
    assert_eq!(validated.product_icon_themes.len(), 1);
}

#[test]
fn a_manifest_with_themes_icon_themes_and_product_icon_themes_all_empty_is_still_rejected() {
    let manifest = r#"{
        "name": "demo-theme",
        "publisher": "demo-publisher",
        "version": "1.0.0",
        "contributes": { "themes": [], "iconThemes": [], "productIconThemes": [] }
    }"#;
    assert_code(
        validate_manifest_fixture(manifest, &[]),
        "THEME_PACKAGE_NO_THEMES",
    );
}

#[test]
fn a_non_array_icon_themes_field_collapses_to_empty_rather_than_a_separate_hard_failure() {
    // Mirrors the existing `contributes_themes_not_an_array_is_rejected`
    // behavior: a malformed-shape field contributes nothing on its own axis
    // rather than failing differently from an absent field. This manifest
    // still has a valid color theme, so the overall import succeeds.
    let manifest = format!(
        r#"{{
            "name": "demo-theme",
            "publisher": "demo-publisher",
            "version": "1.0.0",
            "contributes": {{ "themes": {ONE_DARK_THEME}, "iconThemes": "nope" }}
        }}"#
    );
    let validated = validate_manifest_fixture(
        &manifest,
        &[("themes/dark.json", minimal_theme_json().as_bytes())],
    )
    .expect("a non-array iconThemes field never independently fails the import");
    assert!(validated.icon_themes.is_empty());
}

#[test]
fn jsonc_comments_and_trailing_commas_are_accepted_in_the_manifest() {
    let manifest = format!(
        r#"{{
            // this is a comment
            "name": "demo-theme",
            "publisher": "demo-publisher",
            "version": "1.0.0",
            "contributes": {{ "themes": {ONE_DARK_THEME}, }},
        }}"#
    );
    validate_manifest_fixture(
        &manifest,
        &[("themes/dark.json", minimal_theme_json().as_bytes())],
    )
    .expect("comments and trailing commas must be accepted");
}
