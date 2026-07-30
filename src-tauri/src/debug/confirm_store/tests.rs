use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;

use crate::debug::dto::{AdapterConfirmationSubject, AdapterTransportKind};

use super::{confirmation_key, discard_entry, entry_exists, write_entry};

fn open_temp_dir() -> (TempDir, Dir) {
    let temp = TempDir::new().expect("tempdir creates");
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
    (temp, dir)
}

fn subject(
    command: &str,
    args: &[&str],
    transport: AdapterTransportKind,
) -> AdapterConfirmationSubject {
    AdapterConfirmationSubject {
        command: command.to_owned(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        transport,
    }
}

#[test]
fn a_never_written_subject_does_not_exist() {
    let (_temp, dir) = open_temp_dir();
    let subject = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    assert!(!entry_exists(&dir, &subject));
}

#[test]
fn write_then_exists_round_trips_and_leaves_no_stage_residue() {
    let (temp, dir) = open_temp_dir();
    let subject = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    write_entry(&dir, &subject).unwrap();
    assert!(entry_exists(&dir, &subject));

    let names: Vec<String> = std::fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec![confirmation_key(&subject).unwrap()]);
}

#[test]
fn writing_twice_is_a_harmless_idempotent_overwrite() {
    let (_temp, dir) = open_temp_dir();
    let subject = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    write_entry(&dir, &subject).unwrap();
    write_entry(&dir, &subject).unwrap();
    assert!(entry_exists(&dir, &subject));
}

#[test]
fn discard_is_idempotent_for_a_subject_that_was_never_written() {
    let (_temp, dir) = open_temp_dir();
    let subject = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    discard_entry(&dir, &subject).unwrap();
    discard_entry(&dir, &subject).unwrap();
}

#[test]
fn discard_removes_exactly_the_named_subject() {
    let (_temp, dir) = open_temp_dir();
    let keep = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    let drop = subject("/usr/bin/lldb-dap", &[], AdapterTransportKind::Stdio);
    write_entry(&dir, &keep).unwrap();
    write_entry(&dir, &drop).unwrap();
    discard_entry(&dir, &drop).unwrap();
    assert!(entry_exists(&dir, &keep));
    assert!(!entry_exists(&dir, &drop));
    discard_entry(&dir, &drop).unwrap();
}

/// Every field independently changes the key — the three components of "主导
/// 会话裁定" item 2's triple are each, on their own, part of the identity.
#[test]
fn every_component_of_the_triple_independently_changes_the_key() {
    let base = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    let different_command = subject(
        "/usr/bin/python3.11",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    let different_args = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter", "--extra"],
        AdapterTransportKind::Stdio,
    );
    let different_transport = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Tcp,
    );

    let base_key = confirmation_key(&base).unwrap();
    assert_ne!(base_key, confirmation_key(&different_command).unwrap());
    assert_ne!(base_key, confirmation_key(&different_args).unwrap());
    assert_ne!(base_key, confirmation_key(&different_transport).unwrap());
}

/// A naive delimiter-joined key would collide here (`command="a"`,
/// `args=["b","c"]` vs. `command="ab"`, `args=["c"]`) — the canonical-JSON
/// encoding this module actually uses must not.
#[test]
fn structurally_different_subjects_that_a_naive_join_would_collide_on_do_not() {
    let left = subject("a", &["b", "c"], AdapterTransportKind::Stdio);
    let right = subject("ab", &["c"], AdapterTransportKind::Stdio);
    assert_ne!(
        confirmation_key(&left).unwrap(),
        confirmation_key(&right).unwrap()
    );
}

#[test]
fn a_directory_at_the_expected_key_is_reported_as_not_confirmed_not_an_error() {
    let (temp, dir) = open_temp_dir();
    let subject = subject(
        "/usr/bin/python3",
        &["-m", "debugpy.adapter"],
        AdapterTransportKind::Stdio,
    );
    let key = confirmation_key(&subject).unwrap();
    std::fs::create_dir(temp.path().join(&key)).unwrap();
    assert!(!entry_exists(&dir, &subject));
}
