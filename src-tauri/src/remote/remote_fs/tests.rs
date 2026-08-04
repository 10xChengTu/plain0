//! `F220` S3 hermetic integration tests: a real loopback sshd serving a real
//! SFTP subsystem (`super::super::test_support`) backed by a real local
//! temp directory — every test drives `remote_fs`'s own public async API
//! exactly like `workspace::remote_backend` does in production, over the
//! genuine wire protocol.

use std::path::Path;

use russh::keys::ssh_key::PrivateKey;

use super::super::test_support::{
    connect_test_session, generate_key, start_sftp_fixture, test_service,
};
use super::*;
use crate::path_policy::RelativePath;

fn rel(wire: &str) -> RelativePath {
    RelativePath::parse_wire(wire).expect("valid relative path fixture")
}

/// The fixture's served directory, in its own `realpath`d canonical form —
/// on macOS `TempDir::path()` returns a `/var/...` path that is itself a
/// symlink to `/private/var/...`, so a `base_path` taken verbatim from
/// `TempDir::path()` would never match what SFTP's own `realpath` reports
/// for anything under it. Every real root-authorization call
/// (`canonicalize_for_root`) already produces this canonical form; tests
/// must start from the same form their `base_path` input, exactly like a
/// real caller would.
async fn base_path_of(fixture: &super::super::test_support::SftpFixture) -> String {
    tokio::fs::canonicalize(fixture.served_dir.path())
        .await
        .expect("canonicalize fixture dir")
        .to_string_lossy()
        .into_owned()
}

async fn write_local(path: &Path, content: &[u8]) {
    tokio::fs::write(path, content)
        .await
        .expect("write fixture file");
}

#[tokio::test]
async fn readdir_stat_and_read_round_trip() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;

    write_local(&fixture.served_dir.path().join("hello.txt"), b"hello sftp").await;
    tokio::fs::create_dir(fixture.served_dir.path().join("subdir"))
        .await
        .expect("mkdir fixture dir");

    let base_path = base_path_of(&fixture).await;

    let entries = read_directory(&service, "window-a", session_id, &base_path, &rel(""))
        .await
        .expect("readdir succeeds");
    let mut names = entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    names.sort_unstable();
    assert_eq!(names, ["hello.txt", "subdir"]);
    let file_entry = entries
        .iter()
        .find(|entry| entry.name == "hello.txt")
        .unwrap();
    assert_eq!(file_entry.kind, RemoteEntryKind::File);
    let dir_entry = entries.iter().find(|entry| entry.name == "subdir").unwrap();
    assert_eq!(dir_entry.kind, RemoteEntryKind::Directory);

    let stat = stat(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("hello.txt"),
    )
    .await
    .expect("stat succeeds");
    assert_eq!(stat.kind, RemoteEntryKind::File);
    assert_eq!(stat.size, 10);
    assert!(stat.version.is_some());

    let read = read_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("hello.txt"),
    )
    .await
    .expect("read succeeds");
    assert_eq!(read.content, b"hello sftp");
    assert_eq!(read.stat.size, 10);
}

#[tokio::test]
async fn write_file_rejects_a_stale_expected_version() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    write_local(&fixture.served_dir.path().join("f.txt"), b"one").await;
    let base_path = base_path_of(&fixture).await;

    let error = write_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("f.txt"),
        "wv1:0000000000000000000000000000000000000000000000000000000000000000",
        b"two",
    )
    .await
    .expect_err("stale version must be rejected");
    assert_eq!(error.code(), "WORKSPACE_FILE_MODIFIED");
    let on_disk = tokio::fs::read(fixture.served_dir.path().join("f.txt"))
        .await
        .unwrap();
    assert_eq!(on_disk, b"one");
}

#[tokio::test]
async fn write_file_publishes_via_a_staged_temp_name_and_rename() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    write_local(&fixture.served_dir.path().join("f.txt"), b"one").await;
    let base_path = base_path_of(&fixture).await;

    let current = stat(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("f.txt"),
    )
    .await
    .expect("stat succeeds");
    let version = current.version.expect("file carries a version");

    let written = write_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("f.txt"),
        &version,
        b"two!",
    )
    .await
    .expect("write with the fresh version succeeds");
    assert_eq!(written.size, 4);
    assert_ne!(written.version.as_deref(), Some(version.as_str()));

    let on_disk = tokio::fs::read(fixture.served_dir.path().join("f.txt"))
        .await
        .unwrap();
    assert_eq!(on_disk, b"two!");

    // No leftover `.plain-write-*` staging artifact.
    let mut leftovers = tokio::fs::read_dir(fixture.served_dir.path())
        .await
        .unwrap();
    let mut names = Vec::new();
    while let Some(entry) = leftovers.next_entry().await.unwrap() {
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    assert_eq!(names, ["f.txt"]);
}

#[tokio::test]
async fn publish_file_is_atomic_and_rejects_an_existing_target() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    let base_path = base_path_of(&fixture).await;

    let published = publish_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("new.txt"),
        b"fresh",
    )
    .await
    .expect("publishing a new file succeeds");
    assert_eq!(published.size, 5);
    assert_eq!(
        tokio::fs::read(fixture.served_dir.path().join("new.txt"))
            .await
            .unwrap(),
        b"fresh"
    );

    let error = publish_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("new.txt"),
        b"again",
    )
    .await
    .expect_err("publishing onto an existing file must fail");
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    assert_eq!(
        tokio::fs::read(fixture.served_dir.path().join("new.txt"))
            .await
            .unwrap(),
        b"fresh"
    );
}

#[tokio::test]
async fn create_file_and_create_directory_are_atomic() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    let base_path = base_path_of(&fixture).await;

    let created = create_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("empty.txt"),
    )
    .await
    .expect("create_file succeeds");
    assert_eq!(created.size, 0);
    assert_eq!(created.kind, RemoteEntryKind::File);
    let error = create_file(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("empty.txt"),
    )
    .await
    .expect_err("re-creating must fail");
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");

    create_directory(&service, "window-a", session_id, &base_path, &rel("dir"))
        .await
        .expect("create_directory succeeds");
    let error = create_directory(&service, "window-a", session_id, &base_path, &rel("dir"))
        .await
        .expect_err("re-creating a directory must fail");
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
}

#[tokio::test]
async fn rename_entry_moves_and_rejects_an_existing_target() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    write_local(&fixture.served_dir.path().join("a.txt"), b"a").await;
    write_local(&fixture.served_dir.path().join("b.txt"), b"b").await;
    let base_path = base_path_of(&fixture).await;

    rename_entry(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("a.txt"),
        &rel("c.txt"),
    )
    .await
    .expect("rename to a fresh name succeeds");
    assert!(!fixture.served_dir.path().join("a.txt").exists());
    assert!(fixture.served_dir.path().join("c.txt").exists());

    let error = rename_entry(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("c.txt"),
        &rel("b.txt"),
    )
    .await
    .expect_err("renaming onto an existing target must fail");
    assert_eq!(error.code(), "ENTRY_ALREADY_EXISTS");
    assert!(fixture.served_dir.path().join("c.txt").exists());
}

#[tokio::test]
async fn delete_entry_honors_recursive_flag_and_reports_partial_progress() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    let nested = fixture.served_dir.path().join("tree").join("inner");
    tokio::fs::create_dir_all(&nested).await.unwrap();
    write_local(&nested.join("leaf.txt"), b"leaf").await;
    let base_path = base_path_of(&fixture).await;

    let non_recursive = delete_entry(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("tree"),
        false,
    )
    .await
    .expect("non-recursive delete of a non-empty dir does not error");
    assert!(!non_recursive.fully_deleted);
    assert_eq!(non_recursive.removed_entries, 0);
    assert!(fixture.served_dir.path().join("tree").exists());

    let recursive = delete_entry(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel("tree"),
        true,
    )
    .await
    .expect("recursive delete succeeds");
    assert!(recursive.fully_deleted);
    assert_eq!(recursive.removed_entries, 3); // tree, inner, leaf.txt
    assert!(!fixture.served_dir.path().join("tree").exists());
}

#[tokio::test]
async fn a_symlink_escaping_the_base_path_is_rejected() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;

    let outside = tempfile::TempDir::new().expect("outside tempdir");
    write_local(&outside.path().join("secret.txt"), b"do not read me").await;
    #[cfg(unix)]
    std::os::unix::fs::symlink(outside.path(), fixture.served_dir.path().join("escape"))
        .expect("create escaping symlink");

    let base_path = base_path_of(&fixture).await;

    let error = stat(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("escape/secret.txt"),
    )
    .await
    .expect_err("a path resolving outside base_path must be rejected");
    assert_eq!(error.code(), "PATH_OUTSIDE_ROOT");

    let error = read_directory(&service, "window-a", session_id, &base_path, &rel("escape"))
        .await
        .expect_err("readdir through the escaping symlink must be rejected");
    assert_eq!(error.code(), "PATH_OUTSIDE_ROOT");
}

#[tokio::test]
async fn a_malformed_remote_path_request_fails_closed() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;

    let error = pick_directory(&service, "window-a", session_id, "", 0, 50)
        .await
        .expect_err("an empty path must be rejected");
    assert_eq!(error.code(), "REMOTE_REQUEST_INVALID");

    let error = pick_directory(&service, "window-a", session_id, "has\0nul", 0, 50)
        .await
        .expect_err("a NUL byte must be rejected");
    assert_eq!(error.code(), "REMOTE_REQUEST_INVALID");

    let oversized = "a".repeat(MAX_REMOTE_PATH_CHARS + 1);
    let error = canonicalize_for_root(&service, "window-a", session_id, &oversized)
        .await
        .expect_err("an oversized path must be rejected");
    assert_eq!(error.code(), "REMOTE_REQUEST_INVALID");
}

#[tokio::test]
async fn directory_listing_and_file_read_respect_their_bounded_ceilings() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    for index in 0..4 {
        write_local(
            &fixture.served_dir.path().join(format!("f{index}.txt")),
            b"x",
        )
        .await;
    }
    write_local(&fixture.served_dir.path().join("big.bin"), &[0_u8; 32]).await;
    let base_path = base_path_of(&fixture).await;

    let error = read_directory_for_test_with_limit(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel(""),
        3,
    )
    .await
    .expect_err("a directory with more than max_entries must be rejected");
    assert_eq!(error.code(), "DIRECTORY_TOO_LARGE");
    // Under the ceiling, the same directory reads back fine.
    let ok = read_directory_for_test_with_limit(
        &service,
        "window-a",
        session_id,
        &base_path,
        &rel(""),
        100,
    )
    .await
    .expect("within the ceiling succeeds");
    assert_eq!(ok.len(), 5);

    let error = read_file_for_test_with_limit(
        &service,
        "window-a",
        session_id,
        &base_path,
        "fp",
        &rel("big.bin"),
        10,
    )
    .await
    .expect_err("a file larger than max_bytes must be rejected");
    assert_eq!(error.code(), "FILE_TOO_LARGE");
}

#[tokio::test]
async fn root_authorization_canonicalizes_and_rejects_a_non_directory() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    write_local(&fixture.served_dir.path().join("plain.txt"), b"x").await;

    let expected = base_path_of(&fixture).await;
    let canonical = canonicalize_for_root(
        &service,
        "window-a",
        session_id,
        &fixture.served_dir.path().to_string_lossy(),
    )
    .await
    .expect("a real directory canonicalizes");
    assert_eq!(canonical, expected);

    let error = canonicalize_for_root(
        &service,
        "window-a",
        session_id,
        &fixture
            .served_dir
            .path()
            .join("plain.txt")
            .to_string_lossy(),
    )
    .await
    .expect_err("a plain file cannot become a workspace root");
    assert_eq!(error.code(), "ENTRY_TYPE_MISMATCH");
}

#[tokio::test]
async fn operations_fail_closed_once_the_session_is_disconnected() {
    let identity: PrivateKey = generate_key();
    let fixture = start_sftp_fixture(&identity).await;
    let (_temp, service) = test_service();
    let session_id = connect_test_session(&service, "window-a", &fixture, &identity).await;
    let base_path = base_path_of(&fixture).await;

    service
        .disconnect(
            "window-a",
            session_id,
            &crate::remote::session::NullRemoteSessionEventSink,
        )
        .await
        .expect("disconnect succeeds");

    let error = stat(&service, "window-a", session_id, &base_path, "fp", &rel(""))
        .await
        .expect_err("a stat after disconnect must fail closed");
    assert_eq!(error.code(), "REMOTE_SESSION_NOT_FOUND");
}
