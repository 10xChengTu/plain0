use std::fs;

use tempfile::TempDir;

use super::{
    WorkspaceHistoryRemoteRoot, WorkspaceHistoryRoot, WorkspaceHistoryService, CORRUPT_PREFIX,
    HISTORY_DIRECTORY, HISTORY_FILE, MAX_HISTORY_ENTRIES,
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
    service
        .record(&[first.clone(), second.clone()], &[])
        .unwrap();

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
        service.record(std::slice::from_ref(item), &[]).unwrap();
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
    service
        .record(std::slice::from_ref(&roots[1]), &[])
        .unwrap();
    let reordered = service.snapshot().unwrap();
    assert_eq!(reordered.entries[0].label(), "root-01");
    assert_eq!(reordered.entries[0].recent_id(), retained_id);
}

#[test]
fn empty_workspace_clears_last_without_erasing_recent_entries() {
    let temp = TempDir::new().unwrap();
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let root = root(&temp, "kept");
    service.record(std::slice::from_ref(&root), &[]).unwrap();
    service.record(&[], &[]).unwrap();

    assert_eq!(service.last_roots().unwrap(), None);
    assert_eq!(service.snapshot().unwrap().entries.len(), 1);
}

#[test]
fn remove_and_clear_are_exact_and_persistent() {
    let temp = TempDir::new().unwrap();
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let first = root(&temp, "first");
    let second = root(&temp, "second");
    service.record(std::slice::from_ref(&first), &[]).unwrap();
    service.record(std::slice::from_ref(&second), &[]).unwrap();
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

fn remote_root(host: &str, path: &str, label: &str) -> WorkspaceHistoryRemoteRoot {
    WorkspaceHistoryRemoteRoot {
        host: host.to_owned(),
        port: 22,
        user: "octocat".to_owned(),
        canonical_path: path.to_owned(),
        display_name: label.to_owned(),
    }
}

/// `F220` S4 (ADR 0007 §4): a workspace with both a local and a remote root
/// records both halves, and the remote half round-trips through
/// `snapshot()` — the same query `workspace_recent_list` serves — with its
/// full `(host, port, user, path, label)` shape intact. `snapshot()` is the
/// chosen "front-end already calls this" data path this slice picked (see
/// the module-level doc comment on [`WorkspaceHistoryService::record`]).
#[test]
fn records_a_mixed_local_and_remote_workspace_and_round_trips_remote_roots_through_recent_list() {
    let temp = TempDir::new().unwrap();
    let local = root(&temp, "local-project");
    let remote = remote_root("example.com", "/srv/project", "Remote Project");
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    service
        .record(std::slice::from_ref(&local), std::slice::from_ref(&remote))
        .unwrap();

    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.entries.len(), 1);
    let entry = &snapshot.entries[0];
    assert_eq!(entry.root_labels(), ["local-project"]);
    assert_eq!(entry.remote_roots().len(), 1);
    let remote_wire = &entry.remote_roots()[0];
    assert_eq!(remote_wire.host(), "example.com");
    assert_eq!(remote_wire.port(), 22);
    assert_eq!(remote_wire.user(), "octocat");
    assert_eq!(remote_wire.path(), "/srv/project");
    assert_eq!(remote_wire.label(), "Remote Project");

    // Recording the identical mixed root set again reuses the same
    // `recent_id` rather than minting a duplicate entry — the dedup
    // comparison covers both halves, not just the local one.
    let first_id = entry.recent_id();
    service
        .record(std::slice::from_ref(&local), std::slice::from_ref(&remote))
        .unwrap();
    let after = service.snapshot().unwrap();
    assert_eq!(after.entries.len(), 1);
    assert_eq!(after.entries[0].recent_id(), first_id);
}

/// A workspace made *entirely* of remote roots (no local root at all) still
/// records as its own Recent entry, with an empty local root list and its
/// full remote root list intact — ADR 0007 §4's requirement that Recent can
/// represent a purely-remote workspace, not just a mixed one.
#[test]
fn records_a_remote_only_workspace_with_no_local_roots() {
    let temp = TempDir::new().unwrap();
    let remote = remote_root("example.com", "/srv/only-remote", "Only Remote");
    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    service.record(&[], std::slice::from_ref(&remote)).unwrap();

    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.entries.len(), 1);
    let entry = &snapshot.entries[0];
    assert!(entry.root_labels().is_empty());
    assert_eq!(entry.remote_roots().len(), 1);
    assert_eq!(entry.remote_roots()[0].path(), "/srv/only-remote");
    assert_eq!(entry.label(), "Only Remote");
}

/// Backward compatibility: a `workspaces.plain.json` written by a pre-`F220`
/// build never had a `remoteRoots` field at all. Reading it back must not
/// error, and every entry's `remote_roots()` must come back empty rather
/// than the read being quarantined as corrupt.
#[test]
fn a_pre_f220_history_file_without_remote_roots_reads_back_with_an_empty_remote_list() {
    let temp = TempDir::new().unwrap();
    let state_dir = temp.path().join(HISTORY_DIRECTORY);
    fs::create_dir(&state_dir).unwrap();
    let legacy_json = serde_json::json!({
        "schemaVersion": 1,
        "revision": 2,
        "lastRecentId": "00000000-0000-4000-8000-000000000001",
        "entries": [
            {
                "recentId": "00000000-0000-4000-8000-000000000001",
                "canonicalRoots": [temp.path().join("legacy").to_str().unwrap()],
                "rootLabels": ["legacy"],
                "label": "legacy",
                "lastOpenedUnixMs": 0
            }
        ]
    });
    fs::write(
        state_dir.join(HISTORY_FILE),
        serde_json::to_vec(&legacy_json).unwrap(),
    )
    .unwrap();

    let service = WorkspaceHistoryService::new(temp.path().to_path_buf());
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.entries.len(), 1);
    assert!(snapshot.entries[0].remote_roots().is_empty());
    assert_eq!(snapshot.entries[0].root_labels(), ["legacy"]);
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
