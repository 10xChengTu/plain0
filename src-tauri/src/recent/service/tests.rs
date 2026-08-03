use std::fs;

use tempfile::TempDir;

use super::{
    WorkspaceHistoryRoot, WorkspaceHistoryService, CORRUPT_PREFIX, HISTORY_DIRECTORY, HISTORY_FILE,
    MAX_HISTORY_ENTRIES,
};

fn root(temp: &TempDir, name: &str) -> WorkspaceHistoryRoot {
    let path = temp.path().join(name);
    fs::create_dir_all(&path).unwrap();
    WorkspaceHistoryRoot {
        canonical_path: fs::canonicalize(path).unwrap(),
        display_name: name.to_owned(),
    }
}

#[test]
fn persists_ordered_roots_and_exposes_only_opaque_labels() {
    let temp = TempDir::new().unwrap();
    let first = root(&temp, "first");
    let second = root(&temp, "second");
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    service.record(&[first.clone(), second.clone()]).unwrap();

    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].label(), "first + 1 folders");
    assert_eq!(snapshot.entries[0].root_labels(), ["first", "second"]);
    let wire = serde_json::to_string(&snapshot.entries).unwrap();
    assert!(!wire.contains(temp.path().to_str().unwrap()));

    let restarted = WorkspaceHistoryService::new(temp.path().to_path_buf());
    assert_eq!(
        restarted.last_roots().unwrap().unwrap(),
        vec![first.canonical_path, second.canonical_path]
    );
}

#[test]
fn moves_existing_entries_to_the_front_and_caps_history() {
    let temp = TempDir::new().unwrap();
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let roots = (0..=MAX_HISTORY_ENTRIES)
        .map(|index| root(&temp, &format!("root-{index:02}")))
        .collect::<Vec<_>>();
    for item in &roots {
        service.record(std::slice::from_ref(item)).unwrap();
    }
    let capped = service.snapshot().unwrap();
    assert_eq!(capped.entries.len(), MAX_HISTORY_ENTRIES);
    assert_eq!(capped.entries[0].label(), "root-20");
    assert!(!capped
        .entries
        .iter()
        .any(|entry| entry.label() == "root-00"));

    let retained_id = capped
        .entries
        .iter()
        .find(|entry| entry.label() == "root-01")
        .unwrap()
        .recent_id();
    service.record(std::slice::from_ref(&roots[1])).unwrap();
    let reordered = service.snapshot().unwrap();
    assert_eq!(reordered.entries[0].label(), "root-01");
    assert_eq!(reordered.entries[0].recent_id(), retained_id);
}

#[test]
fn empty_workspace_clears_last_without_erasing_recent_entries() {
    let temp = TempDir::new().unwrap();
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let root = root(&temp, "kept");
    service.record(std::slice::from_ref(&root)).unwrap();
    service.record(&[]).unwrap();

    assert_eq!(service.last_roots().unwrap(), None);
    assert_eq!(service.snapshot().unwrap().entries.len(), 1);
}

#[test]
fn remove_and_clear_are_exact_and_persistent() {
    let temp = TempDir::new().unwrap();
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let first = root(&temp, "first");
    let second = root(&temp, "second");
    service.record(std::slice::from_ref(&first)).unwrap();
    service.record(std::slice::from_ref(&second)).unwrap();
    let snapshot = service.snapshot().unwrap();
    let first_id = snapshot
        .entries
        .iter()
        .find(|entry| entry.label() == "first")
        .unwrap()
        .recent_id();
    service.remove(first_id).unwrap();
    assert_eq!(
        service.remove(first_id).unwrap_err().code(),
        "WORKSPACE_RECENT_NOT_FOUND"
    );
    assert_eq!(service.snapshot().unwrap().entries.len(), 1);

    service.clear().unwrap();
    let restarted = WorkspaceHistoryService::new(temp.path().to_path_buf());
    assert!(restarted.snapshot().unwrap().entries.is_empty());
    assert_eq!(restarted.last_roots().unwrap(), None);
}

#[test]
fn corrupt_regular_history_is_quarantined_without_leaking_paths() {
    let temp = TempDir::new().unwrap();
    let state_dir = temp.path().join(HISTORY_DIRECTORY);
    fs::create_dir(&state_dir).unwrap();
    fs::write(state_dir.join(HISTORY_FILE), b"{not-json").unwrap();

    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    assert!(service.snapshot().unwrap().entries.is_empty());
    assert!(!state_dir.join(HISTORY_FILE).exists());
    assert!(fs::read_dir(&state_dir).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(CORRUPT_PREFIX)
    }));
}

#[cfg(unix)]
#[test]
fn final_history_symlink_fails_closed_and_preserves_its_target() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let state_dir = temp.path().join(HISTORY_DIRECTORY);
    fs::create_dir(&state_dir).unwrap();
    let target = temp.path().join("outside.json");
    fs::write(&target, b"outside").unwrap();
    symlink(&target, state_dir.join(HISTORY_FILE)).unwrap();

    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    assert_eq!(
        service.snapshot().unwrap_err().code(),
        "WORKSPACE_HISTORY_UNAVAILABLE"
    );
    assert_eq!(fs::read(target).unwrap(), b"outside");
}
