use std::future::Future;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use crate::path_policy::RelativePath;
use crate::theme::fixtures::{minimal_manifest, minimal_theme_json, PackageFixture};
use crate::theme::picker::{
    FilePicker, FilePickerFuture, FilePickerResult, ThemeDirectoryPicker,
    ThemeDirectoryPickerFuture, ThemeDirectoryPickerResult,
};

use super::ThemeService;

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakeFilePicker {
    outcome: Option<PathBuf>,
}

impl FilePicker for FakeFilePicker {
    fn pick_file(&self) -> FilePickerFuture<'_> {
        let outcome = self.outcome.clone();
        Box::pin(async move {
            Ok(match outcome {
                Some(path) => FilePickerResult::Selected(path),
                None => FilePickerResult::Cancelled,
            })
        })
    }
}

struct FakeDirectoryPicker {
    outcome: Option<PathBuf>,
}

impl ThemeDirectoryPicker for FakeDirectoryPicker {
    fn pick_directory(&self) -> ThemeDirectoryPickerFuture<'_> {
        let outcome = self.outcome.clone();
        Box::pin(async move {
            Ok(match outcome {
                Some(path) => ThemeDirectoryPickerResult::Selected(path),
                None => ThemeDirectoryPickerResult::Cancelled,
            })
        })
    }
}

const ONE_DARK_THEME: &str = r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#;

fn write_valid_vsix(dir: &Path) -> PathBuf {
    let mut fixture = PackageFixture::new();
    fixture.manifest(&minimal_manifest(ONE_DARK_THEME));
    fixture.file("themes/dark.json", minimal_theme_json().as_bytes());
    let bytes = fixture.finish();
    let path = dir.join("package.vsix");
    std::fs::write(&path, bytes).expect("write vsix fixture");
    path
}

fn write_valid_theme_directory(dir: &Path) -> PathBuf {
    let source = dir.join("unpacked-theme");
    std::fs::create_dir(&source).expect("create source dir");
    std::fs::write(
        source.join("package.json"),
        minimal_manifest(ONE_DARK_THEME),
    )
    .expect("write manifest");
    std::fs::create_dir(source.join("themes")).expect("create themes dir");
    std::fs::write(
        source.join("themes").join("dark.json"),
        minimal_theme_json(),
    )
    .expect("write theme json");
    source
}

#[test]
fn import_vsix_returns_cancelled_without_touching_the_library() {
    let temp = TempDir::new().expect("tempdir");
    let service = ThemeService::new(temp.path().to_path_buf());

    let result = block_on(service.import_vsix(FakeFilePicker { outcome: None }))
        .expect("cancellation is not an error");
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["status"], "cancelled");
    assert!(value.get("package").is_none());

    let listing = block_on(service.list()).expect("list succeeds");
    let listing_value = serde_json::to_value(&listing).unwrap();
    assert_eq!(listing_value["packages"].as_array().unwrap().len(), 0);
}

#[test]
fn import_vsix_imports_a_selected_valid_package_and_it_appears_in_list() {
    let source_temp = TempDir::new().expect("source tempdir");
    let library_temp = TempDir::new().expect("library tempdir");
    let vsix_path = write_valid_vsix(source_temp.path());
    let service = ThemeService::new(library_temp.path().to_path_buf());

    let result = block_on(service.import_vsix(FakeFilePicker {
        outcome: Some(vsix_path),
    }))
    .expect("valid package imports");
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["status"], "imported");
    assert_eq!(value["package"]["id"], "demo-publisher.demo-theme@1.0.0");
    assert_eq!(
        value["package"]["resources"],
        serde_json::json!(["themes/dark.json"])
    );

    let listing = block_on(service.list()).expect("list succeeds");
    let listing_value = serde_json::to_value(&listing).unwrap();
    assert_eq!(listing_value["packages"].as_array().unwrap().len(), 1);
}

#[test]
fn import_vsix_propagates_a_validation_failure() {
    let source_temp = TempDir::new().expect("source tempdir");
    let library_temp = TempDir::new().expect("library tempdir");
    let mut fixture = PackageFixture::new();
    fixture.manifest(r#"{"name":"demo","publisher":"demo","version":"1.0.0"}"#);
    let path = source_temp.path().join("package.vsix");
    std::fs::write(&path, fixture.finish()).expect("write vsix");
    let service = ThemeService::new(library_temp.path().to_path_buf());

    let error = block_on(service.import_vsix(FakeFilePicker {
        outcome: Some(path),
    }))
    .expect_err("a package with no themes must fail import");
    assert_eq!(error.code(), "THEME_PACKAGE_NO_THEMES");
}

#[test]
fn import_directory_cancelled_and_selected_mirror_import_vsix() {
    let source_temp = TempDir::new().expect("source tempdir");
    let library_temp = TempDir::new().expect("library tempdir");
    let service = ThemeService::new(library_temp.path().to_path_buf());

    let cancelled = block_on(service.import_directory(FakeDirectoryPicker { outcome: None }))
        .expect("cancellation is not an error");
    assert_eq!(
        serde_json::to_value(&cancelled).unwrap()["status"],
        "cancelled"
    );

    let source = write_valid_theme_directory(source_temp.path());
    let imported = block_on(service.import_directory(FakeDirectoryPicker {
        outcome: Some(source),
    }))
    .expect("valid directory imports");
    let value = serde_json::to_value(&imported).unwrap();
    assert_eq!(value["status"], "imported");
    assert_eq!(value["package"]["id"], "demo-publisher.demo-theme@1.0.0");
}

#[test]
fn read_resource_enforces_the_per_package_whitelist_and_reports_unknown_ids() {
    let source_temp = TempDir::new().expect("source tempdir");
    let library_temp = TempDir::new().expect("library tempdir");
    let vsix_path = write_valid_vsix(source_temp.path());
    let service = ThemeService::new(library_temp.path().to_path_buf());
    block_on(service.import_vsix(FakeFilePicker {
        outcome: Some(vsix_path),
    }))
    .expect("valid package imports");

    let bytes = block_on(service.read_resource(
        "demo-publisher.demo-theme@1.0.0".to_owned(),
        RelativePath::parse_wire("themes/dark.json").unwrap(),
    ))
    .expect("whitelisted resource reads");
    assert_eq!(bytes, minimal_theme_json().as_bytes());

    let unlisted = block_on(service.read_resource(
        "demo-publisher.demo-theme@1.0.0".to_owned(),
        RelativePath::parse_wire("package.json").unwrap(),
    ))
    .expect_err("package.json is never in the whitelist");
    assert_eq!(unlisted.code(), "THEME_RESOURCE_NOT_FOUND");

    let unknown_package = block_on(service.read_resource(
        "nonexistent.pkg@1.0.0".to_owned(),
        RelativePath::parse_wire("themes/dark.json").unwrap(),
    ))
    .expect_err("unknown package id must fail");
    assert_eq!(unknown_package.code(), "THEME_RESOURCE_NOT_FOUND");
}

#[test]
fn remove_deletes_the_package_and_is_idempotent() {
    let source_temp = TempDir::new().expect("source tempdir");
    let library_temp = TempDir::new().expect("library tempdir");
    let vsix_path = write_valid_vsix(source_temp.path());
    let service = ThemeService::new(library_temp.path().to_path_buf());
    block_on(service.import_vsix(FakeFilePicker {
        outcome: Some(vsix_path),
    }))
    .expect("valid package imports");

    block_on(service.remove("demo-publisher.demo-theme@1.0.0".to_owned()))
        .expect("remove succeeds");
    let listing = block_on(service.list()).expect("list succeeds");
    let listing_value = serde_json::to_value(&listing).unwrap();
    assert_eq!(listing_value["packages"].as_array().unwrap().len(), 0);

    // Idempotent: removing again, or removing an id that never existed, is
    // still a plain success rather than an error.
    block_on(service.remove("demo-publisher.demo-theme@1.0.0".to_owned()))
        .expect("second remove is a no-op success");
    block_on(service.remove("never-existed.pkg@1.0.0".to_owned()))
        .expect("removing an unknown id is a no-op success");
}
