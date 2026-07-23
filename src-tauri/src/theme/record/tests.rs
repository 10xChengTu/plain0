use std::fs;

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;

use crate::theme::manifest::UiTheme;

use super::{
    list_theme_packages, StoredThemeContribution, StoredThemePackageManifest, RECORD_FILE_NAME,
};

fn sample_record(id: &str) -> StoredThemePackageManifest {
    StoredThemePackageManifest {
        id: id.to_owned(),
        publisher: "demo-publisher".to_owned(),
        name: "demo-theme".to_owned(),
        version: "1.0.0".to_owned(),
        themes: vec![StoredThemeContribution {
            label: None,
            ui_theme: UiTheme::Dark,
            path: "themes/dark.json".to_owned(),
        }],
        icon_themes: None,
        product_icon_themes: None,
        contains_code: false,
    }
}

fn write_package(root: &std::path::Path, dir_name: &str, record: &StoredThemePackageManifest) {
    let package_dir = root.join(dir_name);
    fs::create_dir(&package_dir).expect("create package dir");
    let bytes = serde_json::to_vec(record).expect("serialize record");
    fs::write(package_dir.join(RECORD_FILE_NAME), bytes).expect("write record");
}

#[test]
fn lists_every_package_with_a_valid_record_sorted_by_id() {
    let temp = TempDir::new().expect("tempdir");
    write_package(temp.path(), "b.pkg@2.0.0", &sample_record("b.pkg@2.0.0"));
    write_package(temp.path(), "a.pkg@1.0.0", &sample_record("a.pkg@1.0.0"));
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing succeeds");
    assert_eq!(listing.skipped, 0);
    let ids: Vec<&str> = listing
        .packages
        .iter()
        .map(|record| record.id.as_str())
        .collect();
    assert_eq!(ids, vec!["a.pkg@1.0.0", "b.pkg@2.0.0"]);
}

#[test]
fn a_directory_with_invalid_json_in_its_record_is_skipped_and_counted() {
    let temp = TempDir::new().expect("tempdir");
    let package_dir = temp.path().join("broken.pkg@1.0.0");
    fs::create_dir(&package_dir).expect("create dir");
    fs::write(package_dir.join(RECORD_FILE_NAME), b"not json").expect("write garbage");
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing tolerates corruption");
    assert_eq!(listing.skipped, 1);
    assert!(listing.packages.is_empty());
}

#[test]
fn a_directory_with_no_record_file_at_all_is_skipped_and_counted() {
    let temp = TempDir::new().expect("tempdir");
    fs::create_dir(temp.path().join("stray-directory")).expect("create dir");
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing tolerates missing records");
    assert_eq!(listing.skipped, 1);
    assert!(listing.packages.is_empty());
}

#[test]
fn a_plain_file_directly_in_the_library_root_is_skipped_and_counted() {
    let temp = TempDir::new().expect("tempdir");
    fs::write(temp.path().join("not-a-package.txt"), b"stray file").expect("write stray file");
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing tolerates stray files");
    assert_eq!(listing.skipped, 1);
    assert!(listing.packages.is_empty());
}

#[cfg(unix)]
#[test]
fn a_symlink_masquerading_as_a_package_directory_is_skipped_and_counted() {
    let temp = TempDir::new().expect("tempdir");
    // The real target directory lives *outside* the library root entirely,
    // so the only thing this test's listing can observe inside the library
    // root is the symlink itself — proving the symlink is never followed,
    // rather than incidentally also listing the real directory as its own,
    // separate, legitimate package.
    let elsewhere = TempDir::new().expect("tempdir for the real target");
    let real_dir = elsewhere.path().join("real-elsewhere");
    fs::create_dir(&real_dir).expect("create real dir");
    fs::write(
        real_dir.join(RECORD_FILE_NAME),
        serde_json::to_vec(&sample_record("x.y@1.0.0")).expect("serialize"),
    )
    .expect("write record in real dir");
    std::os::unix::fs::symlink(&real_dir, temp.path().join("linked.pkg@1.0.0"))
        .expect("create symlink");
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing tolerates a symlink entry");
    assert_eq!(listing.skipped, 1);
    assert!(listing.packages.is_empty());
}

#[test]
fn round_trips_every_stored_field_including_icon_themes_and_contains_code() {
    let temp = TempDir::new().expect("tempdir");
    let mut record = sample_record("demo-publisher.demo-theme@1.0.0");
    record.contains_code = true;
    record.icon_themes = Some(serde_json::json!([{ "id": "demo-icons" }]));
    record.themes[0].label = Some("%displayName%".to_owned());
    let id = record.id.clone();
    write_package(temp.path(), &id, &record);
    let root = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open root");

    let listing = list_theme_packages(&root).expect("listing succeeds");
    assert_eq!(listing.packages.len(), 1);
    assert_eq!(listing.packages[0], record);
}
