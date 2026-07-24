use libghostty_vt::key::{Action, Key, Mods};
use libghostty_vt::mouse;
use libghostty_vt::style::StyleColor;

use super::{
    encode_focus_event, encode_key_event, encode_mouse_event, KeyEncodeModes, KeyInput,
    MouseEncodeModes, MouseInput, VtError, VtSession, TERMINAL_VT_MAX_SCROLLBACK_LINES,
};

// ---------------------------------------------------------------------
// VtSession construction / dimensions
// ---------------------------------------------------------------------

#[test]
fn scrollback_cap_is_frozen_at_ten_thousand_lines() {
    assert_eq!(TERMINAL_VT_MAX_SCROLLBACK_LINES, 10_000);
}

#[test]
fn zero_cols_or_rows_is_rejected_at_construction() {
    assert!(matches!(
        VtSession::new(0, 24),
        Err(VtError::InvalidDimensions)
    ));
    assert!(matches!(
        VtSession::new(80, 0),
        Err(VtError::InvalidDimensions)
    ));
}

#[test]
fn vt_error_display_messages_are_stable() {
    assert_eq!(
        VtError::InvalidDimensions.to_string(),
        "terminal cols/rows must both be greater than zero"
    );
    let ffi_error = libghostty_vt::Error::OutOfMemory;
    assert_eq!(
        VtError::from(ffi_error).to_string(),
        "libghostty-vt error: out of memory"
    );
}

#[test]
fn dimensions_reflect_construction_and_resize() {
    let mut session = VtSession::new(80, 24).unwrap();
    assert_eq!(session.dimensions(), (80, 24));
    session.resize(120, 40).unwrap();
    assert_eq!(session.dimensions(), (120, 40));
}

#[test]
fn zero_cols_or_rows_is_rejected_at_resize() {
    let mut session = VtSession::new(80, 24).unwrap();
    assert!(matches!(
        session.resize(0, 24),
        Err(VtError::InvalidDimensions)
    ));
    assert!(matches!(
        session.resize(80, 0),
        Err(VtError::InvalidDimensions)
    ));
    // A rejected resize must not have applied a partial change.
    assert_eq!(session.dimensions(), (80, 24));
}

// ---------------------------------------------------------------------
// Feeding bytes / dirty frame content (SGR, newline, cursor movement)
// ---------------------------------------------------------------------

#[test]
fn feeding_sgr_and_newlines_produces_correct_dirty_row_content() {
    let mut session = VtSession::new(10, 3).unwrap();
    // "Hi" in the default style, then "Red" in SGR 31 (ANSI red), then a
    // hard newline moving the cursor to row 1.
    session.feed(b"Hi\x1b[31mRed\x1b[0m\r\n");
    let frame = session.dirty_frame().unwrap();

    assert_eq!(frame.cols, 10);
    assert_eq!(frame.rows, 3);
    // The very first frame after construction is always a full redraw:
    // nothing has been rendered yet.
    assert_eq!(frame.dirty, libghostty_vt::render::Dirty::Full);

    let row0 = frame
        .rows_data
        .iter()
        .find(|row| row.row_index == 0)
        .expect("row 0 is dirty");
    let text: String = row0
        .cells
        .iter()
        .take(5)
        .flat_map(|cell| cell.graphemes.iter())
        .collect();
    assert_eq!(text, "HiRed");

    // "Hi" carries no explicit style/color.
    for cell in &row0.cells[0..2] {
        assert_eq!(cell.fg_rgb, None);
        assert!(cell.style.fg_color == StyleColor::None);
    }
    // "Red" resolves to Ghostty's built-in ANSI-red palette color (#cc6666)
    // through the SGR 31 palette index, exactly as F070's SP spike observed.
    for cell in &row0.cells[2..5] {
        assert_eq!(
            cell.fg_rgb,
            Some(libghostty_vt::style::RgbColor {
                r: 0xCC,
                g: 0x66,
                b: 0x66
            })
        );
    }

    // The `\r\n` moved the cursor to the start of row 1.
    assert!(frame.cursor.visible);
    assert_eq!(
        frame.cursor.viewport,
        Some(libghostty_vt::render::CursorViewport {
            x: 0,
            y: 1,
            at_wide_tail: false,
        })
    );
}

// ---------------------------------------------------------------------
// Dirty tracking clearing semantics
// ---------------------------------------------------------------------

#[test]
fn dirty_frame_drains_both_dirty_layers_until_the_next_feed() {
    let mut session = VtSession::new(10, 3).unwrap();
    session.feed(b"hello");
    let first = session.dirty_frame().unwrap();
    assert!(!first.rows_data.is_empty(), "first frame reports content");

    // Nothing fed since: both the global and per-row dirty flags must have
    // been cleared by the first `dirty_frame` call.
    let second = session.dirty_frame().unwrap();
    assert_eq!(second.dirty, libghostty_vt::render::Dirty::Clean);
    assert!(
        second.rows_data.is_empty(),
        "no rows should be reported once dirty state is drained"
    );

    // Feeding again marks exactly the touched row dirty again.
    session.feed(b"!");
    let third = session.dirty_frame().unwrap();
    assert!(!third.rows_data.is_empty());
}

// ---------------------------------------------------------------------
// Resize -> forced FULL dirty + correct dimensions
// ---------------------------------------------------------------------

#[test]
fn resize_forces_a_full_dirty_frame_with_every_row_and_the_new_dimensions() {
    let mut session = VtSession::new(10, 3).unwrap();
    session.feed(b"hello");
    // Drain dirty state so the post-resize frame can't coast on leftover
    // dirty bits from the initial feed.
    let _ = session.dirty_frame().unwrap();
    let clean = session.dirty_frame().unwrap();
    assert_eq!(clean.dirty, libghostty_vt::render::Dirty::Clean);

    session.resize(20, 5).unwrap();
    let after_resize = session.dirty_frame().unwrap();

    assert_eq!(after_resize.dirty, libghostty_vt::render::Dirty::Full);
    assert_eq!(after_resize.cols, 20);
    assert_eq!(after_resize.rows, 5);
    assert_eq!(
        after_resize.rows_data.len(),
        5,
        "every row must be included on a forced full redraw"
    );

    // The force-full guarantee applies only to the *next* frame, not every
    // subsequent one.
    let following = session.dirty_frame().unwrap();
    assert_eq!(following.dirty, libghostty_vt::render::Dirty::Clean);
}

// ---------------------------------------------------------------------
// Scrollback (on-demand pull, skeleton)
// ---------------------------------------------------------------------

#[test]
fn scrollback_rows_reads_lines_scrolled_off_the_active_area() {
    let mut session = VtSession::new(10, 2).unwrap();
    for i in 0..5 {
        session.feed(format!("line{i}\r\n").as_bytes());
    }
    let _ = session.dirty_frame().unwrap();

    // With a 2-row viewport, feeding 5 lines scrolls the first 4 into
    // history (the 5th remains in the active area) — verified against the
    // real crate's actual scroll behavior, not assumed.
    let rows = session.scrollback_rows(0, 100).unwrap();
    assert_eq!(rows.len(), 4);
    for (i, row) in rows.iter().enumerate() {
        let text: String = row
            .cells
            .iter()
            .flat_map(|cell| cell.graphemes.iter())
            .collect();
        assert_eq!(text.trim_end(), format!("line{i}"));
    }
}

#[test]
fn scrollback_rows_past_the_end_returns_empty_without_erroring() {
    let session = VtSession::new(10, 2).unwrap();
    assert_eq!(session.scrollback_rows(0, 10).unwrap(), Vec::new());
    assert_eq!(session.scrollback_rows(1_000, 10).unwrap(), Vec::new());
}

// ---------------------------------------------------------------------
// Key input encoding matrix
// ---------------------------------------------------------------------

#[test]
fn plain_character_encodes_as_its_own_utf8_text() {
    let input = KeyInput::new(Action::Press, Key::A, Mods::empty()).with_utf8("a");
    assert_eq!(
        encode_key_event(&input, KeyEncodeModes::default()).unwrap(),
        b"a"
    );
}

#[test]
fn ctrl_c_encodes_as_the_c0_control_byte() {
    let input = KeyInput::new(Action::Press, Key::C, Mods::CTRL).with_utf8("c");
    assert_eq!(
        encode_key_event(&input, KeyEncodeModes::default()).unwrap(),
        vec![0x03]
    );
}

#[test]
fn arrow_keys_encode_as_normal_mode_csi_sequences_by_default() {
    let modes = KeyEncodeModes::default();
    let up = KeyInput::new(Action::Press, Key::ArrowUp, Mods::empty());
    let down = KeyInput::new(Action::Press, Key::ArrowDown, Mods::empty());
    let left = KeyInput::new(Action::Press, Key::ArrowLeft, Mods::empty());
    let right = KeyInput::new(Action::Press, Key::ArrowRight, Mods::empty());

    assert_eq!(encode_key_event(&up, modes).unwrap(), b"\x1b[A");
    assert_eq!(encode_key_event(&down, modes).unwrap(), b"\x1b[B");
    assert_eq!(encode_key_event(&left, modes).unwrap(), b"\x1b[D");
    assert_eq!(encode_key_event(&right, modes).unwrap(), b"\x1b[C");
}

#[test]
fn arrow_up_encodes_as_application_mode_ss3_when_cursor_key_application_is_set() {
    let modes = KeyEncodeModes {
        cursor_key_application: true,
        ..Default::default()
    };
    let up = KeyInput::new(Action::Press, Key::ArrowUp, Mods::empty());
    assert_eq!(encode_key_event(&up, modes).unwrap(), b"\x1bOA");
}

#[test]
fn enter_and_backspace_encode_to_their_control_bytes() {
    let modes = KeyEncodeModes::default();
    let enter = KeyInput::new(Action::Press, Key::Enter, Mods::empty()).with_utf8("\r");
    assert_eq!(encode_key_event(&enter, modes).unwrap(), b"\r");

    // Default `backarrow_key_mode` is `false`, so backspace emits 0x7f (DEL)
    // — see `key::Encoder::set_backarrow_key_mode`'s own doc.
    let backspace = KeyInput::new(Action::Press, Key::Backspace, Mods::empty());
    assert_eq!(encode_key_event(&backspace, modes).unwrap(), vec![0x7f]);
}

#[test]
fn a_key_release_produces_no_bytes_under_legacy_encoding() {
    let input = KeyInput::new(Action::Release, Key::A, Mods::empty()).with_utf8("a");
    assert!(encode_key_event(&input, KeyEncodeModes::default())
        .unwrap()
        .is_empty());
}

// ---------------------------------------------------------------------
// Mouse input encoding
// ---------------------------------------------------------------------

fn sgr_mouse_modes() -> MouseEncodeModes {
    MouseEncodeModes {
        tracking_mode: mouse::TrackingMode::Any,
        format: mouse::Format::Sgr,
        size: mouse::EncoderSize {
            screen_width: 800,
            screen_height: 600,
            cell_width: 10,
            cell_height: 20,
            padding_top: 0,
            padding_bottom: 0,
            padding_right: 0,
            padding_left: 0,
        },
        any_button_pressed: false,
        track_last_cell: false,
    }
}

#[test]
fn mouse_press_and_release_encode_sgr_with_upper_and_lower_case_terminators() {
    let modes = sgr_mouse_modes();
    let press = MouseInput {
        action: mouse::Action::Press,
        button: Some(mouse::Button::Left),
        mods: Mods::empty(),
        position: mouse::Position { x: 5.0, y: 25.0 },
    };
    // Cell (5px, 25px) at a 10x20 cell size resolves to 1-indexed column 1,
    // row 2; SGR format encodes button 0 (left) with an uppercase `M`
    // terminator for press and a lowercase `m` for release.
    assert_eq!(
        encode_mouse_event(&press, modes).unwrap(),
        b"\x1b[<0;1;2M".to_vec()
    );

    let release = MouseInput {
        action: mouse::Action::Release,
        ..press
    };
    assert_eq!(
        encode_mouse_event(&release, modes).unwrap(),
        b"\x1b[<0;1;2m".to_vec()
    );
}

// ---------------------------------------------------------------------
// Focus input encoding
// ---------------------------------------------------------------------

#[test]
fn focus_gained_and_lost_encode_to_csi_i_and_csi_o() {
    assert_eq!(
        encode_focus_event(libghostty_vt::focus::Event::Gained).unwrap(),
        b"\x1b[I"
    );
    assert_eq!(
        encode_focus_event(libghostty_vt::focus::Event::Lost).unwrap(),
        b"\x1b[O"
    );
}
