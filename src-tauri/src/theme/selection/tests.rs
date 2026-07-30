use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;

use super::{
    read_selection, write_selection, PersistedThemeSelection, SelectionUpdate, SELECTION_FILE_NAME,
};

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

fn color(id: Option<&str>) -> SelectionUpdate<'_> {
    SelectionUpdate {
        theme_id: Some(id),
        ..Default::default()
    }
}

fn file_icon(id: Option<&str>) -> SelectionUpdate<'_> {
    SelectionUpdate {
        file_icon_theme_id: Some(id),
        ..Default::default()
    }
}

fn product_icon(id: Option<&str>) -> SelectionUpdate<'_> {
    SelectionUpdate {
        product_icon_theme_id: Some(id),
        ..Default::default()
    }
}

fn all_none() -> PersistedThemeSelection {
    PersistedThemeSelection::default()
}

#[test]
fn round_trips_a_color_selection() {
    let (_temp, dir) = open_temp_dir();
    assert_eq!(read_selection(&dir), all_none());

    write_selection(&dir, color(Some("Dark Modern"))).expect("write succeeds");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: Some("Dark Modern".to_owned()),
            ..Default::default()
        }
    );
}

#[test]
fn writing_a_new_selection_overwrites_rather_than_accumulating() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("Dark Modern"))).expect("first write succeeds");
    write_selection(&dir, color(Some("Light+"))).expect("second write succeeds");

    assert_eq!(read_selection(&dir).theme_id, Some("Light+".to_owned()));

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
fn none_on_every_axis_removes_the_file() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("Dark Modern"))).expect("write succeeds");
    write_selection(&dir, color(None)).expect("clear succeeds");

    assert_eq!(read_selection(&dir), all_none());
    assert!(
        !temp.path().join(SELECTION_FILE_NAME).exists(),
        "clearing the only populated axis must remove the file, not just empty it"
    );
}

#[test]
fn clearing_one_axis_leaves_the_file_in_place_when_another_axis_is_still_set() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("Dark Modern"))).expect("color write succeeds");
    write_selection(&dir, file_icon(Some("vs-minimal"))).expect("file icon write succeeds");

    write_selection(&dir, color(None)).expect("clearing color alone succeeds");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: None,
            file_icon_theme_id: Some("vs-minimal".to_owned()),
            product_icon_theme_id: None,
        },
        "clearing one axis must not disturb a still-set sibling axis"
    );
    assert!(
        temp.path().join(SELECTION_FILE_NAME).exists(),
        "the file must remain while any axis is still populated"
    );
}

#[test]
fn clearing_when_nothing_was_ever_written_is_idempotent() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, color(None)).expect("first clear on an absent file succeeds");
    write_selection(&dir, color(None)).expect("second clear is still a no-op success");
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn a_completely_empty_update_is_a_true_no_op_that_never_touches_the_file() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, SelectionUpdate::default())
        .expect("an update with every axis absent must succeed trivially");
    assert!(
        !temp.path().join(SELECTION_FILE_NAME).exists(),
        "a no-op update on an absent file must never create one"
    );

    write_selection(&dir, color(Some("Dark Modern"))).expect("write succeeds");
    write_selection(&dir, SelectionUpdate::default())
        .expect("an update with every axis absent must succeed trivially");
    assert_eq!(
        read_selection(&dir).theme_id,
        Some("Dark Modern".to_owned()),
        "a no-op update must never disturb whatever is already persisted"
    );
}

#[test]
fn each_axis_persists_and_clears_independently_of_the_other_two() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("Dark Modern"))).expect("color write succeeds");
    write_selection(&dir, file_icon(Some("vs-minimal"))).expect("file icon write succeeds");
    write_selection(&dir, product_icon(Some("acme.icons"))).expect("product icon write succeeds");

    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: Some("Dark Modern".to_owned()),
            file_icon_theme_id: Some("vs-minimal".to_owned()),
            product_icon_theme_id: Some("acme.icons".to_owned()),
        }
    );

    write_selection(&dir, file_icon(None)).expect("clearing file icon alone succeeds");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: Some("Dark Modern".to_owned()),
            file_icon_theme_id: None,
            product_icon_theme_id: Some("acme.icons".to_owned()),
        },
        "clearing the file icon axis must leave color and product icon untouched"
    );
}

#[test]
fn a_single_call_can_update_more_than_one_axis_atomically() {
    let (_temp, dir) = open_temp_dir();
    write_selection(
        &dir,
        SelectionUpdate {
            theme_id: Some(Some("Dark Modern")),
            file_icon_theme_id: Some(Some("vs-minimal")),
            product_icon_theme_id: Some(None),
        },
    )
    .expect("a multi-axis update succeeds in one call");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: Some("Dark Modern".to_owned()),
            file_icon_theme_id: Some("vs-minimal".to_owned()),
            product_icon_theme_id: None,
        }
    );
}

#[test]
fn rejects_an_empty_theme_id() {
    let (_temp, dir) = open_temp_dir();
    let error = write_selection(&dir, color(Some(""))).expect_err("empty id must be rejected");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    assert_eq!(
        read_selection(&dir),
        all_none(),
        "a rejected write leaves nothing persisted"
    );
}

#[test]
fn a_rejected_update_leaves_every_axis_including_other_fields_in_the_same_call_untouched() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, product_icon(Some("existing.icons"))).expect("initial write succeeds");

    let error = write_selection(
        &dir,
        SelectionUpdate {
            theme_id: Some(Some("Dark Modern")),
            file_icon_theme_id: Some(Some("")),
            product_icon_theme_id: Some(None),
        },
    )
    .expect_err("an invalid file icon id anywhere in the update rejects the whole call");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: None,
            file_icon_theme_id: None,
            product_icon_theme_id: Some("existing.icons".to_owned()),
        },
        "the valid theme_id/product_icon_theme_id changes in the same rejected call must not \
         apply either — the whole update is all-or-nothing"
    );
}

#[test]
fn accepts_the_exact_byte_limit_and_rejects_one_byte_more() {
    let (_temp, dir) = open_temp_dir();
    let max_id = "a".repeat(super::MAX_THEME_SELECTION_ID_BYTES);
    write_selection(&dir, color(Some(&max_id))).expect("id at the exact limit is accepted");
    assert_eq!(read_selection(&dir).theme_id, Some(max_id));

    let over_limit = "a".repeat(super::MAX_THEME_SELECTION_ID_BYTES + 1);
    let error = write_selection(&dir, color(Some(&over_limit)))
        .expect_err("one byte over the limit is rejected");
    assert_eq!(error.code(), "THEME_SELECTION_INVALID");
}

#[test]
fn rejects_a_theme_id_containing_a_control_character() {
    let (_temp, dir) = open_temp_dir();
    for hostile in ["line\nbreak", "tab\ttab", "nul\u{0}byte", "\u{7f}del"] {
        let error = write_selection(&dir, color(Some(hostile)))
            .expect_err("a control character anywhere in the id must be rejected");
        assert_eq!(error.code(), "THEME_SELECTION_INVALID");
    }
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn accepts_non_ascii_unicode_that_contains_no_control_characters() {
    let (_temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("主题 🎨 thème"))).expect("printable unicode is accepted");
    assert_eq!(
        read_selection(&dir).theme_id,
        Some("主题 🎨 thème".to_owned())
    );
}

#[test]
fn a_missing_file_reads_as_all_none() {
    let (_temp, dir) = open_temp_dir();
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn malformed_json_falls_back_to_all_none_instead_of_erroring() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(temp.path().join(SELECTION_FILE_NAME), b"not json at all")
        .expect("write corrupt file");
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn valid_json_with_the_wrong_shape_falls_back_to_all_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(temp.path().join(SELECTION_FILE_NAME), b"[1,2,3]")
        .expect("write mis-shaped json");
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn a_null_theme_id_field_reads_as_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(
        temp.path().join(SELECTION_FILE_NAME),
        br#"{"themeId":null}"#,
    )
    .expect("write null themeId");
    assert_eq!(read_selection(&dir), all_none());
}

#[test]
fn a_pre_f060_file_with_only_theme_id_defaults_the_two_new_fields_to_none() {
    let (temp, dir) = open_temp_dir();
    // The exact on-disk shape a session before `F060` S3 ever wrote — no
    // `fileIconThemeId`/`productIconThemeId` key at all, not even `null`.
    std::fs::write(
        temp.path().join(SELECTION_FILE_NAME),
        br#"{"themeId":"Dark Modern"}"#,
    )
    .expect("write a pre-F060-shaped file");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: Some("Dark Modern".to_owned()),
            file_icon_theme_id: None,
            product_icon_theme_id: None,
        },
        "an old file missing the two new fields must still parse, falling back to None for them"
    );
}

#[test]
fn a_stored_theme_id_that_itself_fails_validation_falls_back_to_none_without_affecting_siblings() {
    let (temp, dir) = open_temp_dir();
    std::fs::write(
        temp.path().join(SELECTION_FILE_NAME),
        br#"{"themeId":"line\nbreak","fileIconThemeId":"vs-minimal","productIconThemeId":"acme.icons"}"#,
    )
    .expect("write a value that is valid JSON but an invalid selection id on one axis");
    assert_eq!(
        read_selection(&dir),
        PersistedThemeSelection {
            theme_id: None,
            file_icon_theme_id: Some("vs-minimal".to_owned()),
            product_icon_theme_id: Some("acme.icons".to_owned()),
        },
        "a corrupted/tampered value on one axis must never surface a control character to the \
         caller, and must never drag down the other two independently-valid axes"
    );
}

#[cfg(unix)]
#[test]
fn a_directory_at_the_selection_filename_reads_as_all_none() {
    let (temp, dir) = open_temp_dir();
    std::fs::create_dir(temp.path().join(SELECTION_FILE_NAME)).expect("create directory");
    assert_eq!(read_selection(&dir), all_none());
}

#[cfg(unix)]
#[test]
fn a_symlink_at_the_selection_filename_is_never_followed_and_reads_as_all_none() {
    let (temp, dir) = open_temp_dir();
    let elsewhere = TempDir::new().expect("tempdir for the real target");
    let real_file = elsewhere.path().join("real-selection.plain.json");
    std::fs::write(&real_file, br#"{"themeId":"Dark Modern"}"#).expect("write real file");
    std::os::unix::fs::symlink(&real_file, temp.path().join(SELECTION_FILE_NAME))
        .expect("create symlink");

    assert_eq!(
        read_selection(&dir),
        all_none(),
        "a symlink at the selection filename must never be followed"
    );
}

#[test]
fn no_staging_residue_is_left_after_a_normal_write_or_a_rejected_write() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, color(Some("Dark Modern"))).expect("write succeeds");
    assert_eq!(stage_residue_count(&temp), 0);

    let _ = write_selection(&dir, color(Some("")));
    assert_eq!(
        stage_residue_count(&temp),
        0,
        "a rejected (invalid id) write must never even create a stage"
    );
}

#[test]
fn a_no_op_update_never_creates_staging_residue_either() {
    let (temp, dir) = open_temp_dir();
    write_selection(&dir, SelectionUpdate::default()).expect("no-op succeeds");
    assert_eq!(stage_residue_count(&temp), 0);
}
