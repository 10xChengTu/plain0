use crate::path_policy::RelativePath;
use crate::theme::manifest::UiTheme;
use crate::theme::record::{
    StoredIconThemeContribution, StoredThemeContribution, StoredThemePackageManifest,
};
use crate::theme::selection::PersistedThemeSelection;

use super::{
    IconThemeContributionSummary, ThemeContributionSummary, ThemeEmptyRequest, ThemeImportResult,
    ThemeListResult, ThemePackageSummary, ThemeReadResourceRequest, ThemeRemoveRequest,
    ThemeSelectionResult, ThemeSetSelectionRequest,
};

fn sample_manifest() -> StoredThemePackageManifest {
    StoredThemePackageManifest {
        id: "demo-publisher.demo-theme@1.0.0".to_owned(),
        publisher: "demo-publisher".to_owned(),
        name: "demo-theme".to_owned(),
        version: "1.0.0".to_owned(),
        themes: vec![StoredThemeContribution {
            label: Some("%displayName%".to_owned()),
            ui_theme: UiTheme::Dark,
            path: "themes/dark.json".to_owned(),
        }],
        icon_themes: vec![StoredIconThemeContribution {
            id: "demo-icons".to_owned(),
            label: Some("Demo Icons".to_owned()),
            path: "fileicons/demo-icon-theme.json".to_owned(),
        }],
        product_icon_themes: Vec::new(),
        contains_code: true,
        resources: vec![
            "themes/dark.json".to_owned(),
            "fileicons/demo-icon-theme.json".to_owned(),
        ],
    }
}

#[test]
fn empty_request_rejects_every_extra_field() {
    serde_json::from_value::<ThemeEmptyRequest>(serde_json::json!({})).unwrap();
    assert!(
        serde_json::from_value::<ThemeEmptyRequest>(serde_json::json!({ "extra": 1 })).is_err()
    );
}

#[test]
fn package_summary_serializes_camel_case_from_the_stored_manifest() {
    let summary: ThemePackageSummary = sample_manifest().into();
    let value = serde_json::to_value(&summary).expect("summary serializes");
    assert_eq!(value["id"], "demo-publisher.demo-theme@1.0.0");
    assert_eq!(value["publisher"], "demo-publisher");
    assert_eq!(value["name"], "demo-theme");
    assert_eq!(value["version"], "1.0.0");
    assert_eq!(value["containsCode"], true);
    assert_eq!(
        value["resources"],
        serde_json::json!(["themes/dark.json", "fileicons/demo-icon-theme.json"])
    );
    assert!(value.get("contains_code").is_none());
    assert!(value.get("icon_themes").is_none());

    let themes = value["themes"].as_array().expect("themes array");
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0]["label"], "%displayName%");
    assert_eq!(themes[0]["uiTheme"], "vs-dark");
    assert_eq!(themes[0]["path"], "themes/dark.json");

    // `F060` S3: the wire projection this test's own module doc comment
    // describes as previously missing — `iconThemes` now carries the same
    // structurally-validated data `manifest.plain.json` has stored since
    // `F060` S1, and `productIconThemes` is an empty array (not omitted)
    // when a package contributes none.
    let icon_themes = value["iconThemes"].as_array().expect("iconThemes array");
    assert_eq!(icon_themes.len(), 1);
    assert_eq!(icon_themes[0]["id"], "demo-icons");
    assert_eq!(icon_themes[0]["label"], "Demo Icons");
    assert_eq!(icon_themes[0]["path"], "fileicons/demo-icon-theme.json");
    assert_eq!(value["productIconThemes"], serde_json::json!([]));
}

#[test]
fn icon_theme_contribution_summary_serializes_camel_case_and_an_absent_label() {
    let contribution = IconThemeContributionSummary::from(StoredIconThemeContribution {
        id: "acme.icons".to_owned(),
        label: None,
        path: "fileicons/icons.json".to_owned(),
    });
    let value = serde_json::to_value(contribution).expect("contribution serializes");
    assert_eq!(value["id"], "acme.icons");
    assert_eq!(value["label"], serde_json::Value::Null);
    assert_eq!(value["path"], "fileicons/icons.json");
}

#[test]
fn contribution_summary_omits_no_fields_and_uses_camel_case() {
    let contribution = ThemeContributionSummary {
        label: None,
        ui_theme: UiTheme::Light,
        path: "themes/light.json".to_owned(),
    };
    let value = serde_json::to_value(contribution).expect("contribution serializes");
    assert_eq!(value["label"], serde_json::Value::Null);
    assert_eq!(value["uiTheme"], "vs");
    assert_eq!(value["path"], "themes/light.json");
}

#[test]
fn import_result_imported_carries_the_package_and_cancelled_omits_it() {
    let imported = ThemeImportResult::imported(sample_manifest().into());
    let imported_value = serde_json::to_value(&imported).expect("imported serializes");
    assert_eq!(imported_value["status"], "imported");
    assert!(imported_value["package"].is_object());

    let cancelled = ThemeImportResult::cancelled();
    let cancelled_value = serde_json::to_value(&cancelled).expect("cancelled serializes");
    assert_eq!(cancelled_value["status"], "cancelled");
    assert!(
        cancelled_value
            .as_object()
            .unwrap()
            .get("package")
            .is_none(),
        "a cancelled result must not even carry a null `package` key"
    );
}

#[test]
fn list_result_serializes_packages_and_skipped_count() {
    let result = ThemeListResult::new(vec![sample_manifest().into()], 2);
    let value = serde_json::to_value(&result).expect("list result serializes");
    assert_eq!(value["skipped"], 2);
    assert_eq!(value["packages"].as_array().unwrap().len(), 1);
}

#[test]
fn read_resource_request_requires_both_fields_camel_cased_and_rejects_extras() {
    let request: ThemeReadResourceRequest = serde_json::from_value(serde_json::json!({
        "packageId": "demo-publisher.demo-theme@1.0.0",
        "relativePath": "themes/dark.json",
    }))
    .expect("valid request parses");
    let (package_id, relative_path) = request.into_parts();
    assert_eq!(package_id, "demo-publisher.demo-theme@1.0.0");
    assert_eq!(
        relative_path,
        RelativePath::parse_wire("themes/dark.json").unwrap()
    );

    assert!(
        serde_json::from_value::<ThemeReadResourceRequest>(serde_json::json!({
            "packageId": "demo-publisher.demo-theme@1.0.0",
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ThemeReadResourceRequest>(serde_json::json!({
            "packageId": "demo-publisher.demo-theme@1.0.0",
            "relativePath": "themes/dark.json",
            "extra": 1,
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ThemeReadResourceRequest>(serde_json::json!({
            "packageId": "demo-publisher.demo-theme@1.0.0",
            "relativePath": "../escape",
        }))
        .is_err()
    );
}

#[test]
fn remove_request_requires_package_id_and_rejects_extras() {
    let request: ThemeRemoveRequest = serde_json::from_value(serde_json::json!({
        "packageId": "demo-publisher.demo-theme@1.0.0",
    }))
    .expect("valid request parses");
    assert_eq!(request.into_package_id(), "demo-publisher.demo-theme@1.0.0");

    assert!(serde_json::from_value::<ThemeRemoveRequest>(serde_json::json!({})).is_err());
    assert!(
        serde_json::from_value::<ThemeRemoveRequest>(serde_json::json!({
            "packageId": "demo-publisher.demo-theme@1.0.0",
            "extra": 1,
        }))
        .is_err()
    );
}

#[test]
fn selection_result_serializes_all_three_axes_camel_cased() {
    let present = ThemeSelectionResult::new(PersistedThemeSelection {
        theme_id: Some("Dark Modern".to_owned()),
        file_icon_theme_id: Some("vs-minimal".to_owned()),
        product_icon_theme_id: None,
    });
    let value = serde_json::to_value(&present).unwrap();
    assert_eq!(value["themeId"], "Dark Modern");
    assert_eq!(value["fileIconThemeId"], "vs-minimal");
    assert_eq!(value["productIconThemeId"], serde_json::Value::Null);

    let absent = ThemeSelectionResult::new(PersistedThemeSelection::default());
    let absent_value = serde_json::to_value(&absent).unwrap();
    assert_eq!(absent_value["themeId"], serde_json::Value::Null);
    assert_eq!(absent_value["fileIconThemeId"], serde_json::Value::Null);
    assert_eq!(absent_value["productIconThemeId"], serde_json::Value::Null);
}

#[test]
fn set_selection_request_distinguishes_omitted_null_and_a_string_per_field() {
    // A present string sets that axis.
    let present: ThemeSetSelectionRequest = serde_json::from_value(serde_json::json!({
        "themeId": "Dark Modern",
    }))
    .expect("a string themeId parses");
    let update = present.as_update();
    assert_eq!(update.theme_id, Some(Some("Dark Modern")));
    assert_eq!(
        update.file_icon_theme_id, None,
        "an omitted field must leave that axis untouched"
    );
    assert_eq!(update.product_icon_theme_id, None);

    // An explicit `null` clears that axis (distinct from omission).
    let cleared: ThemeSetSelectionRequest = serde_json::from_value(serde_json::json!({
        "themeId": null,
    }))
    .expect("an explicit null themeId parses");
    assert_eq!(
        cleared.as_update().theme_id,
        Some(None),
        "an explicit null must be distinguishable from an omitted field"
    );

    // Omitting every field entirely is a fully-absent (no-op) update.
    let omitted: ThemeSetSelectionRequest =
        serde_json::from_value(serde_json::json!({})).expect("an empty body parses");
    let omitted_update = omitted.as_update();
    assert_eq!(omitted_update.theme_id, None);
    assert_eq!(omitted_update.file_icon_theme_id, None);
    assert_eq!(omitted_update.product_icon_theme_id, None);

    // All three fields can be present together, each independently
    // leave/clear/set.
    let combined: ThemeSetSelectionRequest = serde_json::from_value(serde_json::json!({
        "themeId": "Dark Modern",
        "fileIconThemeId": null,
        "productIconThemeId": "acme.icons",
    }))
    .expect("all three fields parse together");
    let combined_update = combined.as_update();
    assert_eq!(combined_update.theme_id, Some(Some("Dark Modern")));
    assert_eq!(combined_update.file_icon_theme_id, Some(None));
    assert_eq!(
        combined_update.product_icon_theme_id,
        Some(Some("acme.icons"))
    );

    assert!(
        serde_json::from_value::<ThemeSetSelectionRequest>(serde_json::json!({
            "themeId": "Dark Modern",
            "extra": 1,
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ThemeSetSelectionRequest>(serde_json::json!({
            "fileIconThemeId": "vs-minimal",
            "productIconThemeId": null,
        }))
        .is_ok(),
        "themeId may be omitted while the other two axes are present"
    );
}
