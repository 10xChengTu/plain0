use std::fs;

use crate::theme::fixtures::{minimal_manifest, minimal_theme_json, vsix_source, PackageFixture};
use crate::theme::library::ThemeLibrary;
use crate::theme::record::RECORD_FILE_NAME;

use super::{import_directory, import_vsix};

const ONE_DARK_THEME: &str = r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#;

fn valid_fixture_bytes() -> Vec<u8> {
    let mut fixture = PackageFixture::new();
    fixture.manifest(&minimal_manifest(ONE_DARK_THEME));
    fixture.file("themes/dark.json", minimal_theme_json().as_bytes());
    fixture.finish()
}

/// Every entry directly inside the library's `themes/` root, sorted. Used
/// both to check a successful import lands under the expected semantic id
/// and to prove a rejected import leaves no staging or partial-package
/// residue.
fn library_entries(base_path: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(base_path.join("themes"))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn successful_import_round_trips_through_list_packages() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let bytes = valid_fixture_bytes();
    let (_source_temp, file) = vsix_source(&bytes);

    let imported = import_vsix(&library, file).expect("valid package imports");
    assert_eq!(imported.manifest.id, "demo-publisher.demo-theme@1.0.0");

    let listing = library.list_packages().expect("listing succeeds");
    assert_eq!(listing.skipped, 0);
    assert_eq!(listing.packages.len(), 1);
    let record = &listing.packages[0];
    assert_eq!(record.id, "demo-publisher.demo-theme@1.0.0");
    assert_eq!(record.publisher, "demo-publisher");
    assert_eq!(record.name, "demo-theme");
    assert_eq!(record.version, "1.0.0");
    assert_eq!(record.themes.len(), 1);
    assert_eq!(record.themes[0].path, "themes/dark.json");
    assert!(!record.contains_code);
    assert!(record.icon_themes.is_none());
    assert_eq!(record.resources, vec!["themes/dark.json".to_owned()]);

    assert_eq!(
        library_entries(temp.path()),
        vec!["demo-publisher.demo-theme@1.0.0".to_owned()]
    );
}

#[test]
fn duplicate_import_is_rejected_and_leaves_the_existing_package_untouched() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let bytes = valid_fixture_bytes();

    let (_first_source, first_file) = vsix_source(&bytes);
    import_vsix(&library, first_file).expect("first import succeeds");

    let (_second_source, second_file) = vsix_source(&bytes);
    let error = import_vsix(&library, second_file).expect_err("duplicate import is rejected");
    assert_eq!(error.code(), "THEME_PACKAGE_ALREADY_IMPORTED");

    // Exactly the one, first-imported package remains — the rejected
    // second import's own staging tree left no residue behind.
    assert_eq!(
        library_entries(temp.path()),
        vec!["demo-publisher.demo-theme@1.0.0".to_owned()]
    );
    let listing = library.list_packages().expect("listing succeeds");
    assert_eq!(listing.packages.len(), 1);
    assert_eq!(listing.skipped, 0);
}

#[test]
fn a_manifest_with_no_themes_is_rejected_and_leaves_no_residue() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());

    let mut fixture = PackageFixture::new();
    fixture.manifest(r#"{"name":"demo-theme","publisher":"demo-publisher","version":"1.0.0"}"#);
    let bytes = fixture.finish();
    let (_source_temp, file) = vsix_source(&bytes);

    let error = import_vsix(&library, file).expect_err("manifest without themes is rejected");
    assert_eq!(error.code(), "THEME_PACKAGE_NO_THEMES");
    assert!(
        library_entries(temp.path()).is_empty(),
        "no staging or package directory may remain"
    );
}

#[test]
fn a_bad_theme_document_is_rejected_after_a_successful_unpack_and_leaves_no_residue() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());

    let mut fixture = PackageFixture::new();
    fixture.manifest(&minimal_manifest(ONE_DARK_THEME));
    // The manifest and unpack are both entirely well-formed; only the theme
    // document itself is malformed (a self-referential include).
    fixture.file("themes/dark.json", br#"{ "include": "./dark.json" }"#);
    let bytes = fixture.finish();
    let (_source_temp, file) = vsix_source(&bytes);

    let error = import_vsix(&library, file).expect_err("cyclic theme document is rejected");
    assert_eq!(error.code(), "THEME_INCLUDE_CYCLE");
    assert!(
        library_entries(temp.path()).is_empty(),
        "a failure discovered only after unpack succeeded must still leave zero residue"
    );
}

#[test]
fn a_corrupt_record_is_skipped_and_counted_but_other_packages_still_list() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let bytes = valid_fixture_bytes();
    let (_source_temp, file) = vsix_source(&bytes);
    import_vsix(&library, file).expect("valid package imports");

    // Directly corrupt the just-imported package's stored record on disk,
    // and add a second bogus directory with no record file at all.
    let themes_root = temp.path().join("themes");
    fs::write(
        themes_root
            .join("demo-publisher.demo-theme@1.0.0")
            .join(RECORD_FILE_NAME),
        b"not json",
    )
    .expect("overwrite record with garbage");
    fs::create_dir(themes_root.join("stray-directory-without-a-record")).expect("create stray dir");

    let listing = library
        .list_packages()
        .expect("listing tolerates corruption");
    assert_eq!(listing.packages.len(), 0);
    assert_eq!(listing.skipped, 2);
}

#[test]
fn directory_import_shares_the_exact_same_validation_and_finalize_pipeline() {
    let temp = tempfile::TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());

    let source = tempfile::TempDir::new().expect("source tempdir");
    fs::write(
        source.path().join("package.json"),
        minimal_manifest(ONE_DARK_THEME),
    )
    .expect("write manifest");
    fs::create_dir(source.path().join("themes")).expect("create themes dir");
    fs::write(
        source.path().join("themes").join("dark.json"),
        minimal_theme_json(),
    )
    .expect("write theme json");

    let imported = import_directory(&library, source.path()).expect("directory import succeeds");
    assert_eq!(imported.manifest.id, "demo-publisher.demo-theme@1.0.0");
    assert_eq!(
        library_entries(temp.path()),
        vec!["demo-publisher.demo-theme@1.0.0".to_owned()]
    );
}
