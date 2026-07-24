use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Duration;

use tempfile::TempDir;

use crate::path_policy::RelativePath;
use crate::theme::fixtures::{minimal_manifest, minimal_theme_json, vsix_source, PackageFixture};
use crate::theme::import::import_vsix;
use crate::theme::selection::SelectionUpdate;

use super::ThemeLibrary;

fn color_update(id: Option<&str>) -> SelectionUpdate<'_> {
    SelectionUpdate {
        theme_id: Some(id),
        ..Default::default()
    }
}

const ONE_DARK_THEME: &str = r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#;

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
fn ensure_root_bootstraps_once_and_is_capability_relative_thereafter() {
    let temp = TempDir::new().expect("tempdir creates");
    let base_path = temp.path().join("app-local-data");
    let library = ThemeLibrary::new(base_path.clone());

    let first = library.ensure_root().expect("root bootstraps");
    let second = library.ensure_root().expect("root reuses cache");

    first
        .create_dir("marker")
        .expect("write through first handle");
    assert!(
        second.is_dir("marker"),
        "second handle must observe writes made through the first, proving \
         both come from the same bootstrapped root"
    );
    assert!(base_path.join("themes").is_dir());
}

#[test]
fn ensure_root_creates_missing_multi_level_app_local_data_dir() {
    let temp = TempDir::new().expect("tempdir creates");
    let base_path = temp.path().join("a").join("b").join("c");
    let library = ThemeLibrary::new(base_path.clone());

    library
        .ensure_root()
        .expect("root bootstraps through missing ancestors");
    assert!(base_path.join("themes").is_dir());
}

#[test]
fn lock_serializes_and_is_reentrant_safe_across_calls() {
    let temp = TempDir::new().expect("tempdir creates");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    {
        let _guard = library.lock().expect("gate locks");
    }
    let _guard = library.lock().expect("gate locks again after release");
}

#[test]
fn read_resource_serves_a_whitelisted_path_through_the_public_api() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);

    let bytes = library
        .read_resource(&id, &RelativePath::parse_wire("themes/dark.json").unwrap())
        .expect("resource reads");
    assert_eq!(bytes, minimal_theme_json().as_bytes());
}

#[test]
fn remove_package_deletes_the_package_directory_and_is_idempotent() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);
    let package_dir = temp.path().join("themes").join(&id);
    assert!(package_dir.is_dir());

    library.remove_package(&id).expect("first remove succeeds");
    assert!(!package_dir.exists());

    // Idempotent: removing an already-gone package is still Ok(()).
    library
        .remove_package(&id)
        .expect("second remove is a no-op success");
    library
        .remove_package("never-imported.pkg@1.0.0")
        .expect("removing an unknown id is a no-op success");
    library
        .remove_package("../hostile")
        .expect("removing a malformed id is a no-op success, never an ambient delete");

    let listing = library.list_packages().expect("listing still succeeds");
    assert!(listing.packages.is_empty());
    assert_eq!(listing.skipped, 0);
}

#[cfg(unix)]
#[test]
fn remove_package_refuses_to_touch_a_symlink_masquerading_as_a_package() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    library.ensure_root().expect("root bootstraps");
    let themes_root = temp.path().join("themes");

    let elsewhere = TempDir::new().expect("tempdir for the real target");
    let real_dir = elsewhere.path().join("real-elsewhere");
    std::fs::create_dir(&real_dir).expect("create real dir");
    std::os::unix::fs::symlink(&real_dir, themes_root.join("linked.pkg@1.0.0"))
        .expect("create symlink");

    let error = library
        .remove_package("linked.pkg@1.0.0")
        .expect_err("a symlinked entry must never be treated as a removable package");
    assert_eq!(error.code(), "THEME_IO_FAILED");
    assert!(
        real_dir.exists(),
        "the real directory the symlink points at must be untouched"
    );
    assert!(
        themes_root.join("linked.pkg@1.0.0").exists(),
        "the symlink itself must be left in place, not silently unlinked"
    );
}

#[test]
fn get_and_set_selection_round_trip_through_the_public_api() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());

    assert_eq!(
        library.get_selection().expect("read succeeds").theme_id,
        None
    );

    library
        .set_selection(color_update(Some("Dark Modern")))
        .expect("write succeeds");
    assert_eq!(
        library.get_selection().expect("read succeeds").theme_id,
        Some("Dark Modern".to_owned())
    );

    library
        .set_selection(color_update(None))
        .expect("clear succeeds");
    assert_eq!(
        library.get_selection().expect("read succeeds").theme_id,
        None
    );
}

#[test]
fn get_and_set_selection_covers_the_file_icon_and_product_icon_axes_too() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());

    library
        .set_selection(SelectionUpdate {
            theme_id: Some(Some("Dark Modern")),
            file_icon_theme_id: Some(Some("vs-minimal")),
            product_icon_theme_id: Some(Some("acme.icons")),
        })
        .expect("write succeeds");
    let selection = library.get_selection().expect("read succeeds");
    assert_eq!(selection.theme_id, Some("Dark Modern".to_owned()));
    assert_eq!(selection.file_icon_theme_id, Some("vs-minimal".to_owned()));
    assert_eq!(
        selection.product_icon_theme_id,
        Some("acme.icons".to_owned())
    );

    library
        .set_selection(SelectionUpdate {
            file_icon_theme_id: Some(None),
            ..Default::default()
        })
        .expect("clearing one axis succeeds");
    let after_clear = library.get_selection().expect("read succeeds");
    assert_eq!(after_clear.theme_id, Some("Dark Modern".to_owned()));
    assert_eq!(after_clear.file_icon_theme_id, None);
    assert_eq!(
        after_clear.product_icon_theme_id,
        Some("acme.icons".to_owned())
    );
}

#[test]
fn set_selection_rejects_an_invalid_id_without_touching_the_library() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    library
        .set_selection(color_update(Some("Dark Modern")))
        .expect("initial write succeeds");

    let error = library
        .set_selection(color_update(Some("")))
        .expect_err("an empty id must be rejected");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    assert_eq!(
        library.get_selection().expect("read succeeds").theme_id,
        Some("Dark Modern".to_owned()),
        "a rejected write must leave the previously persisted selection untouched"
    );
}

#[test]
fn a_persisted_selection_file_does_not_break_package_listing() {
    let temp = TempDir::new().expect("tempdir");
    let library = ThemeLibrary::new(temp.path().to_path_buf());
    let id = import_demo_package(&library);
    library
        .set_selection(color_update(Some("Dark Modern")))
        .expect("write succeeds");

    // The selection file is a plain, non-directory sibling of every package
    // directory directly under the library root — the exact shape
    // `record::list_theme_packages` already tolerates (and counts toward
    // `skipped`) for any stray non-package entry, so it neither hides nor
    // corrupts the real package's own listing.
    let listing = library.list_packages().expect("listing still succeeds");
    assert_eq!(listing.packages.len(), 1);
    assert_eq!(listing.packages[0].id, id);
    assert_eq!(listing.skipped, 1);
}

#[test]
fn remove_and_import_serialize_through_the_same_gate() {
    let temp = TempDir::new().expect("tempdir");
    let library = Arc::new(ThemeLibrary::new(temp.path().to_path_buf()));
    let id = import_demo_package(&library);

    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let holder_library = Arc::clone(&library);
    let holder_entered = Arc::clone(&entered);
    let holder_release = Arc::clone(&release);
    let holder = thread::spawn(move || {
        let _guard = holder_library.lock().expect("holder locks the gate");
        holder_entered.wait();
        holder_release.wait();
    });
    entered.wait();

    let order: Arc<Mutex<Vec<&'static str>>> = Arc::new(Mutex::new(Vec::new()));
    let order_for_remover = Arc::clone(&order);
    let remover_library = Arc::clone(&library);
    let remover = thread::spawn(move || {
        remover_library
            .remove_package(&id)
            .expect("remove succeeds once the gate is free");
        order_for_remover.lock().unwrap().push("removed");
    });

    // Give the remover ample opportunity to (incorrectly) race ahead of
    // the gate before this thread records that it is about to release
    // it — if `remove_package` did not block on the same gate, "removed"
    // would already be in `order` at this point.
    thread::sleep(Duration::from_millis(50));
    order.lock().unwrap().push("about-to-release");
    release.wait();
    remover.join().expect("remover thread completes");
    holder.join().expect("holder thread completes");

    assert_eq!(*order.lock().unwrap(), vec!["about-to-release", "removed"]);
}
