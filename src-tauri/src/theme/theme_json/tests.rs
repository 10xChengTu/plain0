use std::collections::BTreeSet;

use crate::path_policy::RelativePath;
use crate::theme::fixtures::{minimal_tmtheme, vsix_source, PackageFixture};
use crate::theme::unpack::stage_vsix;
use crate::theme::MAX_INCLUDE_CHAIN_FILES;

use super::validate_theme_contribution_document;

fn path(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).expect("valid fixture wire path")
}

fn assert_code(result: Result<(), crate::error::CommandError>, code: &str) {
    let error = result.expect_err("expected theme document validation to fail");
    assert_eq!(error.code(), code);
}

macro_rules! validate_fixture {
    ($fixture:expr, $entry:expr) => {{
        let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
        let bytes = $fixture.finish();
        let (_source_temp, file) = vsix_source(&bytes);
        let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
        let file_set: BTreeSet<String> = files.into_iter().collect();
        let mut budget = MAX_INCLUDE_CHAIN_FILES;
        validate_theme_contribution_document(&staged, &file_set, &path($entry), &mut budget)
    }};
}

#[test]
fn accepts_a_minimal_json_document_with_comments_and_trailing_commas() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br##"{
            // a comment right here
            "colors": { "editor.background": "#1f1f1f", },
        }"##,
    );
    validate_fixture!(fixture, "themes/dark.json").expect("comments/trailing commas accepted");
}

#[test]
fn colors_values_must_all_be_strings() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br#"{ "colors": { "editor.background": 123 } }"#,
    );
    assert_code(
        validate_fixture!(fixture, "themes/dark.json"),
        "THEME_JSON_INVALID",
    );
}

#[test]
fn colors_field_present_but_not_an_object_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/dark.json", br#"{ "colors": "nope" }"#);
    assert_code(
        validate_fixture!(fixture, "themes/dark.json"),
        "THEME_JSON_INVALID",
    );
}

#[test]
fn token_colors_as_an_array_is_accepted_without_inspecting_elements() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br##"{ "tokenColors": [{"scope": "comment", "settings": {"foreground": "#888888"}}] }"##,
    );
    validate_fixture!(fixture, "themes/dark.json").expect("array tokenColors accepted");
}

#[test]
fn token_colors_of_the_wrong_type_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/dark.json", br#"{ "tokenColors": 42 }"#);
    assert_code(
        validate_fixture!(fixture, "themes/dark.json"),
        "THEME_JSON_INVALID",
    );
}

#[test]
fn semantic_token_colors_must_be_an_object_when_present_but_its_contents_are_never_inspected() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br##"{ "semanticTokenColors": { "anything.goes.here": { "foreground": "#fff" } } }"##,
    );
    validate_fixture!(fixture, "themes/dark.json").expect("object semanticTokenColors accepted");

    let mut wrong_type = PackageFixture::new();
    wrong_type.file("themes/dark.json", br#"{ "semanticTokenColors": "nope" }"#);
    assert_code(
        validate_fixture!(wrong_type, "themes/dark.json"),
        "THEME_JSON_INVALID",
    );
}

#[test]
fn a_single_level_include_chain_resolves() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/a.json",
        br##"{ "include": "./b.json", "colors": { "editor.background": "#111111" } }"##,
    );
    fixture.file(
        "themes/b.json",
        br##"{ "colors": { "editor.foreground": "#eeeeee" } }"##,
    );
    validate_fixture!(fixture, "themes/a.json").expect("single-level include resolves");
}

#[test]
fn a_multi_level_include_chain_resolves() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": "./b.json" }"#);
    fixture.file("themes/b.json", br#"{ "include": "./c.json" }"#);
    fixture.file(
        "themes/c.json",
        br##"{ "colors": { "editor.background": "#000000" } }"##,
    );
    validate_fixture!(fixture, "themes/a.json").expect("multi-level include resolves");
}

#[test]
fn a_self_referential_include_is_rejected_as_a_cycle() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": "./a.json" }"#);
    assert_code(
        validate_fixture!(fixture, "themes/a.json"),
        "THEME_INCLUDE_CYCLE",
    );
}

#[test]
fn a_mutual_two_file_include_cycle_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": "./b.json" }"#);
    fixture.file("themes/b.json", br#"{ "include": "./a.json" }"#);
    assert_code(
        validate_fixture!(fixture, "themes/a.json"),
        "THEME_INCLUDE_CYCLE",
    );
}

#[test]
fn include_chain_of_exactly_the_depth_cap_is_accepted_and_one_more_is_rejected() {
    // 32 files, chain_0 -> chain_1 -> ... -> chain_31 (no further include):
    // exactly MAX_INCLUDE_CHAIN_DEPTH (32) files/levels, must succeed.
    let mut ok_fixture = PackageFixture::new();
    for index in 0..32 {
        let body = if index == 31 {
            r##"{ "colors": { "editor.background": "#000000" } }"##.to_owned()
        } else {
            format!(r#"{{ "include": "./chain_{}.json" }}"#, index + 1)
        };
        ok_fixture.file(&format!("chain_{index}.json"), body.as_bytes());
    }
    validate_fixture!(ok_fixture, "chain_0.json").expect("exactly 32 levels is accepted");

    // 33 files: one level too many.
    let mut over_fixture = PackageFixture::new();
    for index in 0..33 {
        let body = if index == 32 {
            r##"{ "colors": { "editor.background": "#000000" } }"##.to_owned()
        } else {
            format!(r#"{{ "include": "./chain_{}.json" }}"#, index + 1)
        };
        over_fixture.file(&format!("chain_{index}.json"), body.as_bytes());
    }
    assert_code(
        validate_fixture!(over_fixture, "chain_0.json"),
        "THEME_INCLUDE_TOO_DEEP",
    );
}

#[test]
fn include_target_missing_from_the_unpack_manifest_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": "./missing.json" }"#);
    assert_code(
        validate_fixture!(fixture, "themes/a.json"),
        "THEME_INCLUDE_INVALID",
    );
}

#[test]
fn include_target_escaping_the_package_root_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": "../../escape.json" }"#);
    assert_code(
        validate_fixture!(fixture, "themes/a.json"),
        "THEME_INCLUDE_INVALID",
    );
}

#[test]
fn include_field_present_but_not_a_string_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/a.json", br#"{ "include": 42 }"#);
    assert_code(
        validate_fixture!(fixture, "themes/a.json"),
        "THEME_JSON_INVALID",
    );
}

#[test]
fn token_colors_string_pointing_at_a_valid_tmtheme_resolves() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br#"{ "tokenColors": "./dark.tmTheme" }"#,
    );
    fixture.file("themes/dark.tmTheme", minimal_tmtheme().as_bytes());
    validate_fixture!(fixture, "themes/dark.json").expect("valid tmTheme reference resolves");
}

#[test]
fn token_colors_string_pointing_at_a_missing_tmtheme_is_rejected() {
    let mut fixture = PackageFixture::new();
    fixture.file(
        "themes/dark.json",
        br#"{ "tokenColors": "./missing.tmTheme" }"#,
    );
    assert_code(
        validate_fixture!(fixture, "themes/dark.json"),
        "THEME_INCLUDE_INVALID",
    );
}

#[test]
fn a_top_level_contribution_path_may_point_directly_at_a_tmtheme_file() {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/dark.tmTheme", minimal_tmtheme().as_bytes());
    validate_fixture!(fixture, "themes/dark.tmTheme")
        .expect("a bare top-level .tmTheme path is a valid theme document on its own");
}

#[test]
fn structurally_invalid_tmtheme_content_is_rejected() {
    for garbage in [
        &b"not xml at all"[..],
        br#"{"just": "json, not a plist"}"#,
        b"<?xml version=\"1.0\"?><notaplist></notaplist>",
        b"<?xml version=\"1.0\"?><plist version=\"1.0\"></plist>",
    ] {
        let mut fixture = PackageFixture::new();
        fixture.file("themes/dark.tmTheme", garbage);
        assert_code(
            validate_fixture!(fixture, "themes/dark.tmTheme"),
            "THEME_TMTHEME_INVALID",
        );
    }
}

#[test]
fn the_visited_set_resets_per_top_level_entry_so_two_entries_sharing_an_included_file_do_not_collide(
) {
    let mut fixture = PackageFixture::new();
    fixture.file("themes/shared-base.json", br#"{ "colors": {} }"#);
    fixture.file("themes/a.json", br#"{ "include": "./shared-base.json" }"#);
    fixture.file("themes/b.json", br#"{ "include": "./shared-base.json" }"#);
    let bytes = fixture.finish();
    let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
    let (_source_temp, file) = vsix_source(&bytes);
    let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
    let file_set: BTreeSet<String> = files.into_iter().collect();
    let mut budget = MAX_INCLUDE_CHAIN_FILES;

    validate_theme_contribution_document(&staged, &file_set, &path("themes/a.json"), &mut budget)
        .expect("first entry's chain (including the shared file) validates");
    validate_theme_contribution_document(&staged, &file_set, &path("themes/b.json"), &mut budget)
        .expect(
            "second, unrelated entry including the SAME shared file must not be treated as a \
             cycle just because the first entry's now-discarded visited set already saw it",
        );
}

#[test]
fn the_file_count_budget_is_shared_across_every_entry_in_one_import() {
    // 65 entirely independent, depth-1 (no include) documents share ONE
    // budget counter across 65 separate `validate_theme_contribution_document`
    // calls — one per `contributes.themes[]` entry, as `theme::import` does.
    // MAX_INCLUDE_CHAIN_FILES (64) must be exhausted by the 65th call, and
    // this can never be confused with the depth cap: every chain here has
    // depth exactly 1.
    let total = MAX_INCLUDE_CHAIN_FILES + 1;
    let mut fixture = PackageFixture::new();
    for index in 0..total {
        fixture.file(
            &format!("solo_{index}.json"),
            br##"{ "colors": { "editor.background": "#000000" } }"##,
        );
    }
    let bytes = fixture.finish();
    let (_library_temp, root) = crate::theme::fixtures::open_temp_dir();
    let (_source_temp, file) = vsix_source(&bytes);
    let (staged, files) = stage_vsix(&root, file).expect("fixture stages cleanly");
    let file_set: BTreeSet<String> = files.into_iter().collect();
    let mut budget = MAX_INCLUDE_CHAIN_FILES;

    for index in 0..(total - 1) {
        validate_theme_contribution_document(
            &staged,
            &file_set,
            &path(&format!("solo_{index}.json")),
            &mut budget,
        )
        .unwrap_or_else(|error| {
            panic!(
                "entry {index} of {} must fit the budget: {error:?}",
                total - 1
            )
        });
    }
    assert_eq!(
        budget, 0,
        "budget must be fully exhausted after MAX_INCLUDE_CHAIN_FILES entries"
    );

    let error = validate_theme_contribution_document(
        &staged,
        &file_set,
        &path(&format!("solo_{}.json", total - 1)),
        &mut budget,
    )
    .expect_err("the 65th distinct file must exceed the shared budget");
    assert_eq!(error.code(), "THEME_INCLUDE_TOO_MANY");
}
