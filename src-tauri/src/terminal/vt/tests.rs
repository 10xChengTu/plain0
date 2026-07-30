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

/// Documents a real, empirically-verified behavior discovered while
/// implementing F070's "IPC 改造" slice's `terminal_scrollback` command:
/// [`TERMINAL_VT_MAX_SCROLLBACK_LINES`] is an *upper bound* Ghostty accepts
/// at construction, not a guarantee that exactly that many lines survive.
/// Feeding 3,000 unique, fully-styled-width lines (far under the configured
/// 10,000-line cap) into an 80x24 session and asking for every retained
/// scrollback row back reliably returns *far fewer than 3,000* — this
/// crate's own scrollback storage appears to be governed by an internal
/// memory/page budget rather than a literal per-row count, so wider/more
/// distinct-content rows are retained in smaller quantity than blank or
/// highly-repetitive ones would be. This test does not assert an exact
/// count (that number is an implementation detail of the vendored Ghostty
/// build, not a contract this module makes) — only the properties this
/// module's own callers can actually rely on: retention never exceeds the
/// configured cap, whatever is retained is contiguous and in the correct
/// order, and the oldest lines are what get evicted first (never the
/// newest). See `terminal::service::tests`' throughput test for how a
/// caller-level consumer accounts for this instead of assuming unbounded
/// retention.
#[test]
fn scrollback_retention_is_bounded_by_an_internal_budget_not_only_the_configured_line_cap() {
    let mut session = VtSession::new(80, 24).unwrap();
    let fed_lines = 3_000_u32;
    for i in 0..fed_lines {
        session
            .feed(format!("line-{i:04}-0123456789012345678901234567890123456789\r\n").as_bytes());
    }
    let rows = session
        .scrollback_rows(0, TERMINAL_VT_MAX_SCROLLBACK_LINES)
        .unwrap();

    assert!(
        !rows.is_empty(),
        "some scrollback should have been retained"
    );
    assert!(
        rows.len() < fed_lines as usize,
        "retention must never exceed what was actually fed"
    );
    assert!(
        rows.len() <= TERMINAL_VT_MAX_SCROLLBACK_LINES,
        "retention must never exceed the configured cap"
    );

    // Whatever is retained must be a contiguous, correctly-ordered *suffix*
    // of the fed lines (the oldest lines are what get evicted, never a gap
    // in the middle or the newest content).
    let first_index: u32 = {
        let text: String = rows[0]
            .cells
            .iter()
            .flat_map(|cell| cell.graphemes.iter())
            .collect();
        text.strip_prefix("line-")
            .and_then(|rest| rest.get(0..4))
            .and_then(|digits| digits.parse().ok())
            .expect("retained row text starts with a parseable line index")
    };
    for (offset, row) in rows.iter().enumerate() {
        let expected = format!("line-{:04}-", first_index + offset as u32);
        let text: String = row
            .cells
            .iter()
            .flat_map(|cell| cell.graphemes.iter())
            .collect();
        assert!(
            text.starts_with(&expected),
            "retained scrollback rows must be contiguous and in order: expected prefix {expected:?}, got {text:?}"
        );
    }
    // The viewport itself (not queried here) holds the final 23 content
    // lines plus one trailing blank row (the cursor's new, not-yet-written
    // line after the last fed `\r\n`) — 24 rows total, matching the
    // session's configured height — so the last retained scrollback row
    // must be exactly the line just before those final 23.
    let last_index = first_index + rows.len() as u32 - 1;
    assert_eq!(last_index, fed_lines - 23 - 1);
}

// ---------------------------------------------------------------------
// Output fragmentation: a real pty reader's fixed-size read buffer can
// split any byte stream — including in the middle of an escape sequence or
// a multi-byte UTF-8 character — at an arbitrary offset. `VtSession::feed`
// is called once per `read()` in production (`service.rs`'s reader
// thread), so `libghostty-vt`'s own parser, not this module, is what must
// carry state across that boundary correctly; these tests prove it does,
// directly at the `feed()` level rather than only opportunistically via a
// real (timing-dependent) pty in `terminal::service::tests`.
// ---------------------------------------------------------------------

#[test]
fn feeding_an_escape_sequence_split_across_two_reads_parses_identically_regardless_of_the_split_point(
) {
    // The exact byte stream `feeding_sgr_and_newlines_produces_correct_dirty_row_content`
    // feeds in a single call — re-fed here split into exactly two `feed()`
    // calls, at *every* possible byte offset (including the two degenerate
    // splits, an empty first or second call), so every way a pty reader
    // could split this stream — including squarely inside the `\x1b[31m`/
    // `\x1b[0m` escape sequences or the trailing `\r\n` — is covered by one
    // test.
    let script: &[u8] = b"Hi\x1b[31mRed\x1b[0m\r\n";

    let mut reference = VtSession::new(10, 3).unwrap();
    reference.feed(script);
    let reference_frame = reference.dirty_frame().unwrap();

    for split in 0..=script.len() {
        let mut session = VtSession::new(10, 3).unwrap();
        session.feed(&script[..split]);
        session.feed(&script[split..]);
        let frame = session.dirty_frame().unwrap();
        assert_eq!(
            frame,
            reference_frame,
            "splitting the byte stream into two feed() calls at offset {split} (of {}) must \
             parse identically to feeding it in one call",
            script.len()
        );
    }
}

#[test]
fn feeding_the_same_bytes_one_byte_at_a_time_produces_an_identical_dirty_frame_to_one_call() {
    // A stricter, complementary variant of the two-way split above: every
    // byte arrives in its own `feed()` call, the worst-case fragmentation a
    // reader could ever produce (one byte per `read()`), and the result
    // must still be byte-for-byte identical to feeding the whole script at
    // once.
    let script: &[u8] = b"Hi\x1b[31mRed\x1b[0m\r\n";

    let mut whole = VtSession::new(10, 3).unwrap();
    whole.feed(script);
    let whole_frame = whole.dirty_frame().unwrap();

    let mut fragmented = VtSession::new(10, 3).unwrap();
    for byte in script {
        fragmented.feed(std::slice::from_ref(byte));
    }
    let fragmented_frame = fragmented.dirty_frame().unwrap();

    assert_eq!(
        fragmented_frame, whole_frame,
        "feeding the same bytes one at a time must produce an identical DirtyFrame to feeding \
         them in one call"
    );
}

#[test]
fn feeding_a_multi_byte_utf8_character_split_across_two_feed_calls_still_decodes_correctly() {
    // "é" (U+00E9) encodes as the two UTF-8 bytes 0xC3 0xA9 — a real pty
    // reader's fixed-size read buffer can just as easily split a read in
    // the middle of a multi-byte UTF-8 sequence as in the middle of an
    // escape sequence.
    let bytes = "é".as_bytes();
    assert_eq!(bytes.len(), 2, "test assumption: a 2-byte UTF-8 character");

    let mut session = VtSession::new(10, 3).unwrap();
    session.feed(&bytes[..1]);
    session.feed(&bytes[1..]);

    let frame = session.dirty_frame().unwrap();
    let row0 = frame
        .rows_data
        .iter()
        .find(|row| row.row_index == 0)
        .expect("row 0 is dirty");
    let text: String = row0
        .cells
        .iter()
        .flat_map(|cell| cell.graphemes.iter())
        .collect();
    assert!(
        text.starts_with('é'),
        "a UTF-8 character split across two feed() calls must still decode to the complete \
         character rather than mojibake or a dropped cell: got {text:?}"
    );
}
