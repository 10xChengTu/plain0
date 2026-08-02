use std::future::Future;

use tempfile::TempDir;

use super::{UserDataResource, UserDataService, CORRUPT_PREFIX, STAGE_PREFIX};

fn block_on<F: Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

#[test]
fn missing_resources_have_typed_defaults_and_persisted_revisions_survive_restart() {
    let temp = TempDir::new().unwrap();
    let service = UserDataService::new(temp.path().to_path_buf());
    let settings = block_on(service.read(UserDataResource::Settings)).unwrap();
    let keybindings = block_on(service.read(UserDataResource::Keybindings)).unwrap();
    assert_eq!((settings.revision(), settings.content()), (1, "{}\n"));
    assert_eq!((keybindings.revision(), keybindings.content()), (1, "[]\n"));

    let written = block_on(service.write(
        UserDataResource::Settings,
        1,
        "{\n  // local\n  \"files.autoSave\": \"afterDelay\",\n}\n".to_owned(),
    ))
    .unwrap();
    assert_eq!(written.revision(), 2);

    let restarted = UserDataService::new(temp.path().to_path_buf());
    let restored = block_on(restarted.read(UserDataResource::Settings)).unwrap();
    assert_eq!(restored.revision(), 2);
    assert!(restored.content().contains("afterDelay"));
}

#[test]
fn stale_revision_and_wrong_jsonc_shape_leave_the_published_value_unchanged() {
    let temp = TempDir::new().unwrap();
    let service = UserDataService::new(temp.path().to_path_buf());
    block_on(service.write(UserDataResource::Keybindings, 1, "[]\n".to_owned())).unwrap();

    let stale = block_on(service.write(
        UserDataResource::Keybindings,
        1,
        "[{ \"key\": \"cmd+x\", \"command\": \"x\" }]\n".to_owned(),
    ))
    .unwrap_err();
    assert_eq!(stale.code(), "USER_DATA_CONFLICT");

    let invalid = block_on(service.write(
        UserDataResource::Keybindings,
        2,
        "{ \"not\": \"an array\" }\n".to_owned(),
    ))
    .unwrap_err();
    assert_eq!(invalid.code(), "USER_DATA_INVALID");
    let current = block_on(service.read(UserDataResource::Keybindings)).unwrap();
    assert_eq!((current.revision(), current.content()), (2, "[]\n"));
}

#[test]
fn corrupt_regular_envelope_is_quarantined_without_stage_residue() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("user-data");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("settings.plain.json"), b"not-json").unwrap();
    let service = UserDataService::new(temp.path().to_path_buf());
    let result = block_on(service.read(UserDataResource::Settings)).unwrap();
    assert_eq!((result.revision(), result.content()), (1, "{}\n"));

    let names = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(names.len(), 1);
    assert!(names[0].starts_with(CORRUPT_PREFIX));
    assert!(!names.iter().any(|name| name.starts_with(STAGE_PREFIX)));
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_store_filename_is_never_followed_or_quarantined() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let sentinel = outside.path().join("sentinel");
    std::fs::write(&sentinel, b"outside").unwrap();
    let root = temp.path().join("user-data");
    std::fs::create_dir_all(&root).unwrap();
    symlink(&sentinel, root.join("settings.plain.json")).unwrap();

    let service = UserDataService::new(temp.path().to_path_buf());
    let error = block_on(service.read(UserDataResource::Settings)).unwrap_err();
    assert_eq!(error.code(), "USER_DATA_UNAVAILABLE");
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"outside");
    assert!(root.join("settings.plain.json").symlink_metadata().is_ok());
}
