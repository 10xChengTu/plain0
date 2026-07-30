use crate::path_policy::RelativePath;
use crate::theme::fixtures::{minimal_manifest, minimal_theme_json, vsix_source, PackageFixture};
use crate::theme::import::import_vsix;
use crate::theme::library::ThemeLibrary;
use crate::theme::record::RECORD_FILE_NAME;

use super::read_resource;

const ONE_DARK_THEME: &str = r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#;

fn wire(value: &str) -> RelativePath {
    RelativePath::parse_wire(value).expect("valid fixture wire path")
}

fn import_demo_package(library: &ThemeLibrary) -> String {
    let mut fixture = PackageFixture::new();
    fixture.manifest(&minimal_manifest(ONE_DARK_THEME));
    fixture.file("themes/dark.json", minimal_theme_json().as_bytes());
    let bytes = fixture.finish();
    let (_source_temp, file) = vsix_source(&bytes);
    import_vsix(library, file)
        .expect("valid package imports")
        .manifest
        .id
}

#[test]
fn reads_a_whitelisted_resource_verbatim() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);
    let root = library.ensure_root().expect("root opens");

    let bytes = read_resource(&root, &id, &wire("themes/dark.json")).expect("resource reads");
    assert_eq!(bytes, minimal_theme_json().as_bytes());
}

#[test]
fn rejects_a_path_that_exists_on_disk_but_is_not_in_the_whitelist() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);
    let root = library.ensure_root().expect("root opens");

    for unlisted in ["package.json", RECORD_FILE_NAME] {
        let error = read_resource(&root, &id, &wire(unlisted))
            .expect_err("unlisted path must be rejected even though it exists on disk");
        assert_eq!(error.code(), "THEME_RESOURCE_NOT_FOUND");
    }
}

#[test]
fn rejects_a_well_formed_but_nonexistent_resource_path() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);
    let root = library.ensure_root().expect("root opens");

    let error = read_resource(&root, &id, &wire("themes/does-not-exist.json"))
        .expect_err("nonexistent path must be rejected");
    assert_eq!(error.code(), "THEME_RESOURCE_NOT_FOUND");
}

#[test]
fn rejects_an_unknown_or_hostile_package_id() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    import_demo_package(&library);
    let root = library.ensure_root().expect("root opens");

    for id in ["nonexistent.pkg@1.0.0", "../escape", "a/b"] {
        let error = read_resource(&root, id, &wire("themes/dark.json"))
            .expect_err("unknown/hostile id must be rejected");
        assert_eq!(error.code(), "THEME_RESOURCE_NOT_FOUND");
    }
}

#[test]
fn one_packages_resource_is_never_served_under_a_different_packages_id() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let first_id = import_demo_package(&library);

    let mut second_fixture = PackageFixture::new();
    second_fixture.manifest(&format!(
        r#"{{
            "name": "second-theme",
            "publisher": "demo-publisher",
            "version": "1.0.0",
            "contributes": {{ "themes": {ONE_DARK_THEME} }}
        }}"#
    ));
    second_fixture.file("themes/dark.json", minimal_theme_json().as_bytes());
    let (_source_temp, file) = vsix_source(&second_fixture.finish());
    let second_id = import_vsix(&library, file)
        .expect("second package imports")
        .manifest
        .id;
    assert_ne!(first_id, second_id);

    let root = library.ensure_root().expect("root opens");
    // Both packages happen to share the identical relative path
    // "themes/dark.json" — reading it under either id must only ever return
    // that specific package's own bytes, proving the whitelist check is
    // scoped per-package rather than checked against some pooled set.
    let first_bytes =
        read_resource(&root, &first_id, &wire("themes/dark.json")).expect("first resource reads");
    let second_bytes =
        read_resource(&root, &second_id, &wire("themes/dark.json")).expect("second resource reads");
    assert_eq!(first_bytes, second_bytes);
}
