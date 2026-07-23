use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;

use super::{read_selection, write_selection, SELECTION_FILE_NAME};

fn open_temp_dir() -> (TempDir, Dir) {
    let temp = TempDir::new().expect("tempdir");
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
    (temp, dir)
}

fn stage_residue_count(temp: &TempDir) -> usize {
    std::fs::read_dir(temp.path())
        .expect("read temp dir")
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(super::STAGE_PREFIX)
        })
        .count()
}

#[test]
fn round_trips_a_selection() {
    let (_temp, dir) = open_temp_dir();
    assert_eq!(read_selection(&dir), None);

    write_selection(&dir, Some("Dark Modern")).expect("write succeeds");
    assert_eq!(read_selection(&dir), Some("Dark Modern".to_owned()));
}

#[test]
fn writing_a_new_selection_overwrites_rather_than_accumulating() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, Some("Dark Modern")).expect("first write succeeds");
    write_selection(&dir, Some("Light+")).expect("second write succeeds");

    assert_eq!(read_selection(&dir), Some("Light+".to_owned()));

    let names: Vec<String> = std::fs::read_dir(temp.path())
        .expect("read temp dir")
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names,
        vec![SELECTION_FILE_NAME.to_owned()],
        "only the single published selection file should remain on disk"
    );
}

#[test]
fn none_clears_an_existing_selection() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, Some("Dark Modern")).expect("write succeeds");
    write_selection(&dir, None).expect("clear succeeds");

    assert_eq!(read_selection(&dir), None);
    assert!(
        !temp.path().join(SELECTION_FILE_NAME).exists(),
        "clearing must remove the file, not just empty it"
    );
}

#[test]
fn clearing_when_nothing_was_ever_written_is_idempotent() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, None).expect("first clear on an absent file succeeds");
    write_selection(&dir, None).expect("second clear is still a no-op success");
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn rejects_an_empty_theme_id() {
    let (_temp, dir) = open_temp_dir();
    let error = write_selection(&dir, Some("")).expect_err("empty id must be rejected");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    assert_eq!(
        read_selection(&dir),
        None,
        "a rejected write leaves nothing persisted"
    );
}

#[test]
fn accepts_the_exact_byte_limit_and_rejects_one_byte_more() {
    let (_temp, dir) = open_temp_dir();
    let max_id = "a".repeat(super::MAX_THEME_SELECTION_ID_BYTES);
    write_selection(&dir, Some(&max_id)).expect("id at the exact limit is accepted");
    assert_eq!(read_selection(&dir), Some(max_id));

    let over_limit = "a".repeat(super::MAX_THEME_SELECTION_ID_BYTES + 1);
    let error =
        write_selection(&dir, Some(&over_limit)).expect_err("one byte over the limit is rejected");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
}

#[test]
fn rejects_a_theme_id_containing_a_control_character() {
    let (_temp, dir) = open_temp_dir();
    for hostile in ["line\nbreak", "tab\ttab", "nul\u{0}byte", "\u{7f}del"] {
        let error = write_selection(&dir, Some(hostile))
            .expect_err("a control character anywhere in the id must be rejected");
        assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    }
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn accepts_non_ascii_unicode_that_contains_no_control_characters() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, Some("主题 🎨 thème")).expect("printable unicode is accepted");
    assert_eq!(read_selection(&dir), Some("主题 🎨 thème".to_owned()));
}

#[test]
fn a_missing_file_reads_as_none() {
    let (_temp, dir) = open_temp_dir();
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn malformed_json_falls_back_to_none_instead_of_erroring() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(temp.path().join(SELECTION_FILE_NAME), b"not json at all")
        .expect("write corrupt file");
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn valid_json_with_the_wrong_shape_falls_back_to_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(temp.path().join(SELECTION_FILE_NAME), b"[1,2,3]")
        .expect("write mis-shaped json");
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn a_null_theme_id_field_reads_as_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(
        temp.path().join(SELECTION_FILE_NAME),
        br#"{"themeId":null}"#,
    )
    .expect("write null themeId");
    assert_eq!(read_selection(&dir), None);
}

#[test]
fn a_stored_theme_id_that_itself_fails_validation_falls_back_to_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(
        temp.path().join(SELECTION_FILE_NAME),
        br#"{"themeId":"line\nbreak"}"#,
    )
    .expect("write a value that is valid JSON but an invalid selection id");
    assert_eq!(
        read_selection(&dir),
        None,
        "a corrupted/tampered file must never surface a control character to the caller"
    );
}

#[cfg(unix)]
#[test]
fn a_directory_at_the_selection_filename_reads_as_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::create_dir(temp.path().join(SELECTION_FILE_NAME)).expect("create directory");
    assert_eq!(read_selection(&dir), None);
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_selection_filename_is_never_followed_and_reads_as_none() {
    let (temp, dir) = open_temp_dir();
    let elsewhere = TempDir::new().expect("tempdir for the real target");
    let real_file = elsewhere.path().join("real-selection.plain.json");
    std::fs::write(&real_file, br#"{"themeId":"Dark Modern"}"#).expect("write real file");
    std::os::unix::fs::symlink(&real_file, temp.path().join(SELECTION_FILE_NAME))
        .expect("create symlink");

    assert_eq!(
        read_selection(&dir),
        None,
        "a symlink at the selection filename must never be followed"
    );
}

#[test]
fn no_staging_residue_is_left_after_a_normal_write_or_a_rejected_write() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, Some("Dark Modern")).expect("write succeeds");
    assert_eq!(stage_residue_count(&temp), 0);

    let _ = write_selection(&dir, Some(""));
    assert_eq!(
        stage_residue_count(&temp),
        0,
        "a rejected (invalid id) write must never even create a stage"
    );
}
