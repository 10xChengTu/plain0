//! VT (terminal state) integration for one session, built on the
//! `libghostty-vt` crate (docs/research/2026-07-24-libghostty-terminal.md,
//! "VT 集成" slice). This module owns exactly three things per session:
//!
//! 1. [`VtSession`] — a `libghostty-vt` `Terminal` plus the render-state
//!    machinery needed to turn PTY bytes into a serializable, `Send`-safe
//!    "what changed" snapshot ([`DirtyFrame`]).
//! 2. On-demand scrollback row reads ([`VtSession::scrollback_rows`]), for
//!    content outside the current viewport.
//! 3. Stateless key/mouse/focus input encoders ([`encode_key_event`],
//!    [`encode_mouse_event`], [`encode_focus_event`]) that turn a normalized
//!    input event into the escape-sequence bytes to write to the pty.
//!
//! # Thread safety
//!
//! `libghostty-vt`'s own crate documentation is explicit: "the entire
//! `libghostty-vt` library is not thread-safe unless otherwise noted"; every
//! type it exposes (`Terminal`, `RenderState`, `RowIterator`, `CellIterator`,
//! `key::Encoder`, `key::Event`, `mouse::Encoder`, `mouse::Event`, ...) is
//! neither `Send` nor `Sync`. The Rust compiler enforces this for us — none
//! of these types can be stored in the `Send + Sync` `Arc<TerminalSession>`
//! that `service.rs` shares across its reader/waiter/vt threads, and none can
//! be moved into a closure that runs on a different thread than the one that
//! created them.
//!
//! [`VtSession`] is therefore designed to live entirely on one thread: in
//! production that is `service.rs`'s dedicated per-session **vt** thread — a
//! thread separate from the pty reader thread, on purpose, not merely as an
//! implementation detail (see `service.rs`'s module doc for the full
//! rationale: real `libghostty-vt` calls proved measurably expensive under a
//! debug-mode Zig build, and isolating them onto their own thread is what
//! keeps that cost from ever affecting the reader's own timing). That thread
//! constructs a `VtSession` once at session start, calls [`VtSession::feed`]
//! with every chunk of bytes forwarded to it, and calls
//! [`VtSession::dirty_frame`] to extract a snapshot. Nothing about
//! `VtSession` is exposed across threads directly; instead, the vt thread
//! copies out the fully-owned, `Send`-safe [`DirtyFrame`] it produces into a
//! plain `Mutex<Option<DirtyFrame>>` that other threads may read — copying
//! *data* across the thread boundary rather than ever sharing the live,
//! non-thread-safe libghostty-vt objects themselves.
//!
//! The same constraint applies to input encoding. [`encode_key_event`] and
//! [`encode_mouse_event`] are deliberately *stateless per call*: each one
//! constructs a fresh `key::Encoder`/`mouse::Encoder` and
//! `key::Event`/`mouse::Event`, uses it, and drops it, all within the one
//! function call — which makes them safe to call from *any* single thread
//! (whichever thread happens to own the IPC command that needs an encode),
//! since the non-`Send` objects never survive past that one call and never
//! cross threads. What they cannot safely do is stay synchronized with a
//! *live* `Terminal`'s modes (e.g. DECCKM cursor-key-application, Kitty
//! keyboard flags) the way `key::Encoder::set_options_from_terminal` would,
//! because that terminal only exists on the vt thread. This module therefore
//! accepts an explicit, plain-data `KeyEncodeModes`/`MouseEncodeModes`
//! snapshot instead of a live `&Terminal`: `service.rs`'s vt thread answers a
//! `VtCommand::ModesRequest` by publishing a [`TerminalModesSnapshot`] (a
//! small `Copy` struct, mirroring how `DirtyFrame` is published) for the
//! `terminal_input_key`/`terminal_focus` command's own thread to read and
//! pass in here, without the two non-`Send` object graphs (encoder,
//! terminal) ever touching each other across threads.
//!
//! # Dirty tracking
//!
//! See `libghostty_vt::render`'s own module documentation for the underlying
//! two-layer dirty model (global `Dirty::{Clean,Partial,Full}` plus a
//! per-row flag). [`VtSession::dirty_frame`] fully drains both layers on
//! every call — it clears every row's dirty flag (and the global flag) as
//! it reads them, mirroring the crate's own documented renderer-loop
//! pattern, rather than leaving a caller to remember to do so separately.
//! A caller that skips a `dirty_frame` call simply sees the *union* of
//! changes across however many `feed` calls happened since the last one:
//! nothing is lost, only coalesced.
//!
//! [`VtSession::resize`] additionally forces the *next* `dirty_frame` call
//! to report [`libghostty_vt::render::Dirty::Full`] and include every row,
//! regardless of what libghostty-vt's own dirty computation reports — a
//! resize can reflow every line on screen, and a renderer that only saw a
//! `Partial` set of rows after a resize could leave stale content on
//! screen. This is a guarantee this module makes on its own (via a plain
//! Rust-side flag), not one it assumes libghostty-vt already provides.
//!
//! # Scrollback
//!
//! Scrollback content lives entirely inside the `libghostty-vt` `Terminal`
//! (bounded by [`TERMINAL_VT_MAX_SCROLLBACK_LINES`], configured at
//! construction) and is never part of [`DirtyFrame`], which only ever
//! describes the current viewport. [`VtSession::scrollback_rows`] is the
//! on-demand "pull" counterpart for content above the viewport — the
//! `terminal_scrollback` IPC command asks for a specific range of history
//! rows only when it actually needs to render them (e.g. the user scrolled
//! up), rather than this module ever pushing scrollback content unprompted.
//!
//! **`TERMINAL_VT_MAX_SCROLLBACK_LINES` is an upper bound, not a guarantee**
//! — this module's own test
//! (`scrollback_retention_is_bounded_by_an_internal_budget_not_only_the_configured_line_cap`)
//! empirically verified that feeding far fewer lines than the configured cap
//! (3,000 unique, fully-styled-width lines against a 10,000-line cap) still
//! evicts the oldest ones once retained content grows large enough:
//! `libghostty-vt`'s scrollback storage appears to be governed by an
//! internal memory/page budget rather than a literal per-row count, so
//! wider/more visually distinct rows are retained in smaller quantity than
//! blank or highly-repetitive ones would be. Any caller pulling scrollback
//! at scale (see `terminal::service::tests`' own throughput test) must treat
//! "the oldest requested rows may already be gone" as a normal outcome, not
//! an error — exactly as [`VtSession::scrollback_rows`]'s own doc already
//! describes for a `start` that runs off the end.

use libghostty_vt::render::{
    CellIterator, Colors, CursorViewport, CursorVisualStyle, Dirty, RowIterator, Snapshot,
};
use libghostty_vt::screen::{CellSemanticContent, GridRef, RowSemanticPrompt};
use libghostty_vt::style::{RgbColor, Style};
use libghostty_vt::terminal::{Mode, Options as TerminalOptions, Point, PointCoordinate};
use libghostty_vt::{focus, key, mouse};
use libghostty_vt::{Error as VtFfiError, RenderState, Terminal};

/// Scrollback ceiling for every [`VtSession`] this domain creates: matches
/// both `libghostty-vt`'s own doctest examples and Ghostty's shipped
/// default, and is frozen by this module's own test (mirroring how
/// `terminal::MAX_TERMINAL_SESSIONS_PER_WINDOW` is frozen) so a future
/// change to it is a deliberate, reviewed edit rather than an accidental
/// one.
pub(crate) const TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 10_000;

/// Strict byte ceiling on one cell's projected OSC 8 hyperlink URI (F190 S4's
/// "Ghostty metadata and links" slice, `docs/research/2026-08-03-complete-terminal.md`
/// §3). A real URI is nowhere near this size; this exists purely so a
/// hostile/broken program cannot balloon a frame's wire size by writing an
/// enormous OSC 8 payload. [`read_hyperlink_uri`] drops (returns `None` for)
/// any link whose real length exceeds this cap rather than truncating it
/// into a malformed URI — a dropped link renders as plain, non-clickable
/// text, never a corrupted address a click could misdirect to.
pub(crate) const TERMINAL_VT_MAX_HYPERLINK_URI_BYTES: usize = 2_048;

/// Strict byte ceiling on the raw OSC 7/9/1337 payload [`VtSession::dirty_frame`]
/// reads via `Terminal::pwd()` before attempting to parse it into a
/// filesystem path (see [`parse_osc7_pwd_uri`]). An oversized or malformed
/// payload simply yields `DirtyFrame::pwd == None` — pwd projection fails
/// closed, it never panics or reports a truncated/garbled path.
pub(crate) const TERMINAL_VT_MAX_PWD_URI_BYTES: usize = 4_096;

/// A `vt.rs`-internal error, deliberately distinct from the
/// `tauri`-facing `CommandError` the rest of this domain returns: nothing in
/// this module talks to Tauri directly (see the module doc — it is used
/// exclusively from `service.rs`'s vt thread and this module's own
/// tests), so its errors stay in terms of `libghostty_vt::Error` until
/// `service.rs` decides how to fold a failure into its own error handling
/// (today: best-effort, see `service.rs`'s module doc for the VT
/// integration's failure policy).
#[derive(Clone, Copy, Debug)]
pub(crate) enum VtError {
    /// The underlying libghostty-vt call itself failed (e.g. out of
    /// memory, or a buffer was too small and the caller does not retry).
    Ffi(VtFfiError),
    /// A `cols == 0 || rows == 0` construction/resize was requested, which
    /// libghostty-vt's own `Options`/`resize` docs require to be non-zero.
    InvalidDimensions,
}

impl From<VtFfiError> for VtError {
    fn from(value: VtFfiError) -> Self {
        Self::Ffi(value)
    }
}

impl std::fmt::Display for VtError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ffi(error) => write!(formatter, "libghostty-vt error: {error}"),
            Self::InvalidDimensions => {
                write!(
                    formatter,
                    "terminal cols/rows must both be greater than zero"
                )
            }
        }
    }
}

impl std::error::Error for VtError {}

/// One session's live `libghostty-vt` terminal plus the render-state
/// machinery used to extract [`DirtyFrame`]s from it. See the module doc's
/// "Thread safety" section for the single-thread-confinement contract this
/// type must be used under — nothing here is `Send` or `Sync` (inherited
/// automatically from the `libghostty-vt` types it wraps; this module adds
/// no `unsafe impl` to override that).
pub(crate) struct VtSession {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState<'static>,
    row_iter: RowIterator<'static>,
    cell_iter: CellIterator<'static>,
    // Read by `Self::scrollback_rows` and the `#[cfg(test)]`-only
    // `Self::dimensions`; not yet read by any production call site (see
    // `Self::resize`/`Self::scrollback_rows`'s own `allow(dead_code)`).
    #[allow(dead_code)]
    cols: u16,
    #[allow(dead_code)]
    rows: u16,
    /// Set by [`Self::resize`]; consumed (and cleared) by the next
    /// [`Self::dirty_frame`] call. See the module doc's "Dirty tracking"
    /// section for why this is a guarantee this module makes itself.
    force_full_dirty_next: bool,
}

impl VtSession {
    /// Creates a new session-scoped VT terminal at the given viewport size,
    /// with scrollback bounded by [`TERMINAL_VT_MAX_SCROLLBACK_LINES`].
    pub(crate) fn new(cols: u16, rows: u16) -> Result<Self, VtError> {
        if cols == 0 || rows == 0 {
            return Err(VtError::InvalidDimensions);
        }
        let terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: TERMINAL_VT_MAX_SCROLLBACK_LINES,
        })?;
        let render_state = RenderState::new()?;
        let row_iter = RowIterator::new()?;
        let cell_iter = CellIterator::new()?;
        Ok(Self {
            terminal,
            render_state,
            row_iter,
            cell_iter,
            cols,
            rows,
            force_full_dirty_next: false,
        })
    }

    /// Feeds raw PTY bytes through the VT parser. This never fails — see
    /// `libghostty_vt::Terminal::vt_write`'s own doc: malformed or
    /// unexpected input is only ever logged internally, never surfaced as
    /// an error, which is exactly the contract a reader thread feeding
    /// bytes from an untrusted child process needs.
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        self.terminal.vt_write(bytes);
    }

    /// Resizes the terminal, and guarantees the next [`Self::dirty_frame`]
    /// call reports a full-frame redraw (see the module doc).
    ///
    /// Called from `service.rs`'s vt thread in response to a
    /// `VtCommand::Resize` hand-off from `TerminalService::resize` (F070's
    /// "IPC 改造" slice) — the real pty master resize happens independently
    /// (and unconditionally) in `service.rs`; this call only keeps the VT
    /// mirror's own viewport in sync with it.
    pub(crate) fn resize(&mut self, cols: u16, rows: u16) -> Result<(), VtError> {
        if cols == 0 || rows == 0 {
            return Err(VtError::InvalidDimensions);
        }
        self.terminal.resize(cols, rows, 0, 0)?;
        self.cols = cols;
        self.rows = rows;
        self.force_full_dirty_next = true;
        Ok(())
    }

    /// The viewport size this session was created (or last resized) with.
    #[cfg(test)]
    pub(crate) fn dimensions(&self) -> (u16, u16) {
        (self.cols, self.rows)
    }

    /// Updates the render state from the current terminal state and
    /// serializes every dirty row (or, on a full redraw, every row) into an
    /// owned [`DirtyFrame`] — draining both dirty-tracking layers as it
    /// goes (see the module doc's "Dirty tracking" section).
    pub(crate) fn dirty_frame(&mut self) -> Result<DirtyFrame, VtError> {
        let snapshot = self.render_state.update(&self.terminal)?;
        let force_full = std::mem::take(&mut self.force_full_dirty_next);
        let mut frame = frame_from_snapshot(
            &snapshot,
            &self.terminal,
            &mut self.row_iter,
            &mut self.cell_iter,
            force_full,
        )?;
        // Read *after* the snapshot/row/cell borrows above have all ended —
        // see the module doc's "Thread safety" section: nothing here holds
        // `self.terminal` borrowed across this call, so this is just one
        // more independent immutable read of it. Projected regardless of
        // `frame.dirty` (a pure OSC 7 write with no accompanying cell writes
        // would otherwise never surface a pwd change) — see
        // `service::FrameEmitGate`'s own pwd-change bypass for the other
        // half of that guarantee.
        frame.pwd = self
            .terminal
            .pwd()
            .ok()
            .filter(|raw| !raw.is_empty())
            .and_then(|raw| parse_osc7_pwd_uri(raw, TERMINAL_VT_MAX_PWD_URI_BYTES));
        Ok(frame)
    }

    /// Reads up to `count` scrollback rows starting at history row `start`
    /// (`0` = oldest retained line). See the module doc's "Scrollback"
    /// section for why this is a separate, on-demand "pull" API rather than
    /// part of [`DirtyFrame`]. Returns fewer than `count` rows (possibly
    /// zero) if `start` is at or past the end of retained scrollback;
    /// never errors purely because the requested range runs off the end.
    ///
    /// Deliberately lighter-weight than [`DirtyRow`]/[`DirtyCell`]: no
    /// resolved fg/bg RGB (that requires the render state's palette
    /// resolution, which only covers the viewport) and no selection state
    /// (a viewport-only render-state concept). Callers get the raw
    /// [`Style`] (with palette-indexed or RGB colors, see
    /// [`libghostty_vt::style::StyleColor`]) and resolve colors themselves
    /// if/when needed.
    ///
    /// Called from `service.rs`'s vt thread in response to a
    /// `VtCommand::ScrollbackRequest` (F070's "IPC 改造" slice's
    /// `terminal_scrollback` command) — see the module doc's "Scrollback"
    /// section.
    pub(crate) fn scrollback_rows(
        &self,
        start: usize,
        count: usize,
    ) -> Result<Vec<ScrollbackRow>, VtError> {
        let available = self.terminal.scrollback_rows()?;
        if start >= available || count == 0 {
            return Ok(Vec::new());
        }
        let end = start.saturating_add(count).min(available);
        let mut rows = Vec::with_capacity(end - start);
        for y in start..end {
            let mut cells = Vec::with_capacity(self.cols as usize);
            for x in 0..self.cols {
                let point = Point::History(PointCoordinate { x, y: y as u32 });
                let grid_ref = self.terminal.grid_ref(point)?;
                cells.push(ScrollbackCell {
                    graphemes: read_grid_ref_graphemes(&grid_ref)?,
                    style: grid_ref.style()?,
                });
            }
            rows.push(ScrollbackRow {
                row_index: y,
                cells,
            });
        }
        Ok(rows)
    }

    /// Reads every live terminal mode this domain's input encoders need —
    /// see [`TerminalModesSnapshot`]'s doc. Called from `service.rs`'s vt
    /// thread in response to a `VtCommand::ModesRequest` hand-off (F070's
    /// "IPC 改造" slice): the requesting thread (whichever one is handling a
    /// `terminal_input_key`/`terminal_focus` command) cannot read a live
    /// `Terminal` itself (see the module doc's "Thread safety" section), so
    /// it asks the vt thread for a plain-data snapshot instead, then calls
    /// [`encode_key_event`]/[`encode_focus_event`] itself with that snapshot.
    pub(crate) fn modes_snapshot(&self) -> TerminalModesSnapshot {
        TerminalModesSnapshot {
            key: KeyEncodeModes {
                cursor_key_application: self.terminal.mode(Mode::DECCKM).unwrap_or(false),
                keypad_key_application: self.terminal.mode(Mode::KEYPAD_KEYS).unwrap_or(false),
                alt_esc_prefix: self.terminal.mode(Mode::ALT_ESC_PREFIX).unwrap_or(false),
                kitty_flags: self
                    .terminal
                    .kitty_keyboard_flags()
                    .unwrap_or(key::KittyKeyFlags::DISABLED),
            },
            focus_reporting_enabled: self.terminal.mode(Mode::FOCUS_EVENT).unwrap_or(false),
        }
    }
}

/// A snapshot of every live terminal mode this domain's input encoders need
/// — the same four fields [`key::Encoder::set_options_from_terminal`] itself
/// reads (see [`KeyEncodeModes`]'s doc), plus whether focus-reporting (DEC
/// mode 1004) is currently enabled, which [`encode_focus_event`]'s caller
/// needs in order to decide whether writing a focus escape sequence to the
/// pty is meaningful for whatever program is currently running in it. Read
/// from a live [`Terminal`] by [`VtSession::modes_snapshot`] — the vt thread
/// is the only thread ever allowed to touch one (see the module doc) — and
/// handed as plain `Copy` data to whichever thread is handling the input
/// command that needs it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TerminalModesSnapshot {
    pub(crate) key: KeyEncodeModes,
    pub(crate) focus_reporting_enabled: bool,
}

/// One cell's worth of owned, `Send`-safe render-state content — the base
/// codepoint plus any combining grapheme codepoints, its resolved style,
/// and (for the viewport-only [`DirtyRow`] case) its resolved colors and
/// selection state.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DirtyCell {
    pub(crate) graphemes: Vec<char>,
    pub(crate) style: Style,
    pub(crate) fg_rgb: Option<RgbColor>,
    pub(crate) bg_rgb: Option<RgbColor>,
    pub(crate) selected: bool,
    /// This cell's OSC 8 hyperlink URI, or `None` if the cell carries no
    /// hyperlink *or* its real URI exceeded [`TERMINAL_VT_MAX_HYPERLINK_URI_BYTES`]
    /// (see [`read_hyperlink_uri`] — a dropped link is indistinguishable from
    /// "no link" on the wire, which is fine: both render as plain text).
    pub(crate) hyperlink: Option<String>,
    /// This cell's OSC 133 semantic classification (prompt/input/output) —
    /// see `libghostty_vt::screen::CellSemanticContent`'s own doc. Used only
    /// for CSS styling by the consuming renderer; never widens what the
    /// underlying process can do.
    pub(crate) semantic: CellSemanticContent,
}

/// One dirty (or, on a full redraw, every) row's cells, in column order.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DirtyRow {
    pub(crate) row_index: usize,
    /// Whether OSC 133 marked this row (or any part of it) as a shell
    /// prompt line — see `libghostty_vt::screen::RowSemanticPrompt`'s own
    /// doc. Used only for "jump to previous/next prompt" command navigation.
    pub(crate) semantic_prompt: RowSemanticPrompt,
    pub(crate) cells: Vec<DirtyCell>,
}

/// Cursor state as of a [`DirtyFrame`]'s snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CursorState {
    pub(crate) visible: bool,
    pub(crate) blinking: bool,
    pub(crate) viewport: Option<CursorViewport>,
    pub(crate) style: CursorVisualStyle,
}

/// An owned, `Send`-safe snapshot of "what a renderer needs to draw the
/// current frame" — the output of [`VtSession::dirty_frame`]. See the
/// module doc's "Dirty tracking" section for the exact dirty-row inclusion
/// and clearing semantics.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DirtyFrame {
    pub(crate) dirty: Dirty,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) cursor: CursorState,
    pub(crate) colors: Colors,
    pub(crate) rows_data: Vec<DirtyRow>,
    /// The current OSC 7/9/1337 working directory, already parsed out of its
    /// `file://` URI form into a plain absolute filesystem path — `None` if
    /// no shell-integration cwd has been reported yet, or if the raw payload
    /// was empty, oversized, or failed to parse (see [`parse_osc7_pwd_uri`]).
    /// This is a *raw* absolute path with no workspace-root awareness at
    /// all — `vt.rs` deliberately knows nothing about workspace roots (see
    /// the module doc's "owns exactly three things" framing). `service.rs`'s
    /// vt thread is what turns this into the root-relative value the
    /// frontend actually receives (see `service::relativize_pwd`), so this
    /// absolute path itself never crosses the IPC boundary.
    pub(crate) pwd: Option<String>,
}

/// One scrollback row read via [`VtSession::scrollback_rows`]. See that
/// method's doc for why this is lighter-weight than [`DirtyRow`].
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ScrollbackRow {
    pub(crate) row_index: usize,
    pub(crate) cells: Vec<ScrollbackCell>,
}

/// One scrollback cell: see [`VtSession::scrollback_rows`]'s doc for why
/// this omits resolved colors/selection that [`DirtyCell`] carries.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ScrollbackCell {
    pub(crate) graphemes: Vec<char>,
    pub(crate) style: Style,
}

fn frame_from_snapshot<'alloc>(
    snapshot: &Snapshot<'alloc, '_>,
    terminal: &Terminal<'_, '_>,
    row_iter: &mut RowIterator<'alloc>,
    cell_iter: &mut CellIterator<'alloc>,
    force_full: bool,
) -> Result<DirtyFrame, VtError> {
    let dirty = if force_full {
        Dirty::Full
    } else {
        snapshot.dirty()?
    };
    let cols = snapshot.cols()?;
    let rows = snapshot.rows()?;
    let colors = snapshot.colors()?;
    let cursor = CursorState {
        visible: snapshot.cursor_visible()?,
        blinking: snapshot.cursor_blinking()?,
        viewport: snapshot.cursor_viewport()?,
        style: snapshot.cursor_visual_style()?,
    };

    let mut rows_data = Vec::new();
    let mut row_iteration = row_iter.update(snapshot)?;
    let mut row_index = 0_usize;
    while let Some(row) = row_iteration.next() {
        let row_is_dirty = row.dirty()?;
        let include_row = dirty == Dirty::Full || row_is_dirty;
        if include_row {
            let semantic_prompt = row
                .raw_row()
                .and_then(libghostty_vt::screen::Row::semantic_prompt)
                .unwrap_or(RowSemanticPrompt::None);
            let mut cells = Vec::with_capacity(cols as usize);
            let mut cell_iteration = cell_iter.update(row)?;
            let mut col_index: u16 = 0;
            while let Some(cell) = cell_iteration.next() {
                let raw_cell = cell.raw_cell()?;
                let hyperlink = if raw_cell.has_hyperlink()? {
                    read_hyperlink_uri(
                        terminal,
                        Point::Viewport(PointCoordinate {
                            x: col_index,
                            y: row_index as u32,
                        }),
                        TERMINAL_VT_MAX_HYPERLINK_URI_BYTES,
                    )
                } else {
                    None
                };
                cells.push(DirtyCell {
                    graphemes: cell.graphemes()?,
                    style: cell.style()?,
                    fg_rgb: cell.fg_color()?,
                    bg_rgb: cell.bg_color()?,
                    selected: cell.is_selected()?,
                    hyperlink,
                    // Fails closed to `Output` (plain text, no special
                    // styling) rather than propagating — see this module's
                    // own hostile-input test: an out-of-range/unrecognized
                    // semantic tag must never fail the whole frame, only
                    // that one cell's classification.
                    semantic: raw_cell
                        .semantic_content()
                        .unwrap_or(CellSemanticContent::Output),
                });
                col_index = col_index.saturating_add(1);
            }
            rows_data.push(DirtyRow {
                row_index,
                semantic_prompt,
                cells,
            });
        }
        // Drain the per-row dirty flag regardless of whether this row was
        // included above (a clean row's flag is already `false`, so this is
        // a harmless no-op for it) — see the module doc's "Dirty tracking"
        // section.
        row.set_dirty(false)?;
        row_index += 1;
    }
    snapshot.set_dirty(Dirty::Clean)?;

    Ok(DirtyFrame {
        dirty,
        cols,
        rows,
        cursor,
        colors,
        rows_data,
        // Filled in by `VtSession::dirty_frame` (needs a fresh, non-conflicting
        // borrow of `terminal` taken *after* this function returns).
        pwd: None,
    })
}

/// Reads the real hyperlink URI at `point`, bounded by `cap` bytes — the
/// hyperlink counterpart to [`read_grid_ref_graphemes`], except a URI whose
/// real length exceeds `cap` is dropped entirely (`None`) rather than grown
/// into arbitrarily (see [`TERMINAL_VT_MAX_HYPERLINK_URI_BYTES`]'s doc for
/// why: a strict cap only protects against a hostile/broken program if
/// exceeding it always fails closed, never truncates into a differently-
/// meaning URI). Also fails closed (`None`) if the URI's bytes are not valid
/// UTF-8, or if resolving `point` itself fails.
fn read_hyperlink_uri(terminal: &Terminal<'_, '_>, point: Point, cap: usize) -> Option<String> {
    let grid_ref = terminal.grid_ref(point).ok()?;
    let mut buf = vec![0_u8; cap.clamp(1, 256)];
    loop {
        match grid_ref.hyperlink_uri(&mut buf) {
            Ok(0) => return None,
            Ok(len) => {
                buf.truncate(len);
                return String::from_utf8(buf).ok();
            }
            Err(VtFfiError::OutOfSpace { required }) => {
                if required > cap {
                    return None;
                }
                buf.resize(required, 0);
            }
            Err(_) => return None,
        }
    }
}

/// Parses `Terminal::pwd()`'s raw OSC 7 payload (a `file://<host>/<path>`
/// URI, verbatim from whatever the shell sent — see `libghostty-vt`'s own
/// `pwd()` doctest) into a plain absolute filesystem path, ignoring the host
/// component entirely (this domain never trusts hostname matching for
/// anything security-relevant — the resulting path is re-validated by
/// `service::relativize_pwd`'s canonicalize + containment check exactly
/// like any other candidate cwd). Fails closed (`None`, never a truncated or
/// mis-decoded path) for: an oversized payload, a non-`file://` scheme, a
/// missing path component, invalid percent-encoding, or a decoded path
/// containing a NUL byte.
fn parse_osc7_pwd_uri(raw: &str, cap: usize) -> Option<String> {
    if raw.is_empty() || raw.len() > cap {
        return None;
    }
    let after_scheme = raw.strip_prefix("file://")?;
    let path_start = after_scheme.find('/')?;
    let encoded_path = &after_scheme[path_start..];
    let decoded = percent_decode_ascii(encoded_path)?;
    if decoded.is_empty() || decoded.contains('\0') {
        return None;
    }
    Some(decoded)
}

/// Minimal, dependency-free percent-decoder for the path component of an
/// OSC 7 `file://` URI. Fails closed (`None`) on a truncated or non-hex
/// `%`-escape, or on a decoded byte sequence that is not valid UTF-8 —
/// never substitutes a placeholder or best-effort guess.
fn percent_decode_ascii(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let high = char::from(*bytes.get(index + 1)?).to_digit(16)?;
                let low = char::from(*bytes.get(index + 2)?).to_digit(16)?;
                out.push(((high << 4) | low) as u8);
                index += 3;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Reads the full grapheme cluster for a grid reference, growing the buffer
/// as needed — the same retry-on-`OutOfSpace` pattern
/// `render::CellIteration::graphemes` uses internally, reimplemented here
/// because [`GridRef`] only exposes the fixed-buffer variant. Only called
/// from [`VtSession::scrollback_rows`].
fn read_grid_ref_graphemes(grid_ref: &GridRef<'_>) -> Result<Vec<char>, VtError> {
    let mut buf = vec!['\0'; 2];
    loop {
        match grid_ref.graphemes(&mut buf) {
            Ok(len) => {
                buf.truncate(len);
                return Ok(buf);
            }
            Err(VtFfiError::OutOfSpace { required }) => buf.resize(required, '\0'),
            Err(other) => return Err(other.into()),
        }
    }
}

/// Plain, `Send`-safe description of one key event to encode. Deliberately
/// not `libghostty_vt::key::Event` itself — see the module doc's "Thread
/// safety" section for why. [`encode_key_event`] builds the real,
/// thread-confined `key::Event`/`key::Encoder` from this internally.
///
/// Built by `terminal::commands::terminal_input_key` (F070's "IPC 改造"
/// slice) from a `TerminalInputKeyRequest`'s validated fields.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct KeyInput {
    pub(crate) action: key::Action,
    pub(crate) key: key::Key,
    pub(crate) mods: key::Mods,
    /// The unmodified UTF-8 text the key produces for the current keyboard
    /// layout, if any — see `key::Event::set_utf8`'s doc for the exact
    /// contract (no C0 controls, no platform PUA function-key codes).
    pub(crate) utf8: Option<String>,
}

impl KeyInput {
    pub(crate) fn new(action: key::Action, key: key::Key, mods: key::Mods) -> Self {
        Self {
            action,
            key,
            mods,
            utf8: None,
        }
    }

    pub(crate) fn with_utf8(mut self, text: impl Into<String>) -> Self {
        self.utf8 = Some(text.into());
        self
    }
}

/// The subset of live terminal modes that
/// `key::Encoder::set_options_from_terminal` would otherwise read directly
/// from a `Terminal` — plain `Copy` data so it can cross threads safely
/// (see the module doc's "Thread safety" section). `Default` matches a
/// terminal that has not enabled any of these modes, i.e. the state a
/// freshly-created [`VtSession`] starts in. Populated for a *live* session
/// via [`VtSession::modes_snapshot`] (part of [`TerminalModesSnapshot`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct KeyEncodeModes {
    pub(crate) cursor_key_application: bool,
    pub(crate) keypad_key_application: bool,
    pub(crate) alt_esc_prefix: bool,
    pub(crate) kitty_flags: key::KittyKeyFlags,
}

impl Default for KeyEncodeModes {
    fn default() -> Self {
        Self {
            cursor_key_application: false,
            keypad_key_application: false,
            alt_esc_prefix: false,
            kitty_flags: key::KittyKeyFlags::DISABLED,
        }
    }
}

/// Encodes one key event into the escape-sequence bytes that should be
/// written to the pty. See the module doc's "Thread safety" section: this
/// constructs, uses, and drops its `key::Encoder`/`key::Event` entirely
/// within this one call, so it is safe to call from any single thread.
pub(crate) fn encode_key_event(
    input: &KeyInput,
    modes: KeyEncodeModes,
) -> Result<Vec<u8>, VtError> {
    let mut encoder = key::Encoder::new()?;
    encoder
        .set_cursor_key_application(modes.cursor_key_application)
        .set_keypad_key_application(modes.keypad_key_application)
        .set_alt_esc_prefix(modes.alt_esc_prefix)
        .set_kitty_flags(modes.kitty_flags);

    let mut event = key::Event::new()?;
    event
        .set_action(input.action)
        .set_key(input.key)
        .set_mods(input.mods);
    if let Some(text) = &input.utf8 {
        event.set_utf8(Some(text.clone()));
    }

    let mut buf = Vec::new();
    encoder.encode_to_vec(&event, &mut buf)?;
    Ok(buf)
}

/// Plain, `Send`-safe description of one mouse event to encode — the mouse
/// counterpart to [`KeyInput`], for the same reason (see the module doc's
/// "Thread safety" section). Not `PartialEq`: `mouse::Position` (a plain FFI
/// `f32` pair) does not implement it upstream.
///
/// Deliberately **not** wired to a `terminal_input_mouse` IPC command in
/// F070's "IPC 改造" slice, unlike [`KeyInput`]/[`encode_focus_event`]:
/// unlike key modes (four independent booleans/flags read directly off the
/// terminal) or focus reporting (a single mode bit), correctly driving
/// [`MouseEncodeModes::tracking_mode`]/`format` from live terminal state
/// requires inferring an effective tracking mode from *several*
/// simultaneously-settable DEC mouse modes (`X10_MOUSE`/`NORMAL_MOUSE`/
/// `BUTTON_MOUSE`/`ANY_MOUSE`, `SGR_MOUSE`/`UTF8_MOUSE` for format) with a
/// precedence order this domain has not yet audited against a real
/// program's expectations — and there is no consuming renderer yet either
/// (that lands in a later "WebView 渲染" slice) to exercise it against. This
/// cluster stays a tested, working, but IPC-unwired interface, exactly like
/// [`Self`]/[`MouseEncodeModes`]/[`encode_mouse_event`] were for the whole
/// key/mouse/focus cluster before this slice wired key and focus.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct MouseInput {
    pub(crate) action: mouse::Action,
    pub(crate) button: Option<mouse::Button>,
    pub(crate) mods: key::Mods,
    pub(crate) position: mouse::Position,
}

/// Encoder configuration for [`encode_mouse_event`] — the mouse counterpart
/// to [`KeyEncodeModes`].
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MouseEncodeModes {
    pub(crate) tracking_mode: mouse::TrackingMode,
    pub(crate) format: mouse::Format,
    pub(crate) size: mouse::EncoderSize,
    pub(crate) any_button_pressed: bool,
    pub(crate) track_last_cell: bool,
}

/// Encodes one mouse event into the escape-sequence bytes that should be
/// written to the pty. See [`encode_key_event`]'s doc (and the module doc's
/// "Thread safety" section) for why this is safe to call from any single
/// thread.
#[allow(dead_code)]
pub(crate) fn encode_mouse_event(
    input: &MouseInput,
    modes: MouseEncodeModes,
) -> Result<Vec<u8>, VtError> {
    let mut encoder = mouse::Encoder::new()?;
    encoder
        .set_tracking_mode(modes.tracking_mode)
        .set_format(modes.format)
        .set_size(modes.size)
        .set_any_button_pressed(modes.any_button_pressed)
        .set_track_last_cell(modes.track_last_cell);

    let mut event = mouse::Event::new()?;
    event
        .set_action(input.action)
        .set_button(input.button)
        .set_mods(input.mods)
        .set_position(input.position);

    let mut buf = Vec::new();
    encoder.encode_to_vec(&event, &mut buf)?;
    Ok(buf)
}

/// Encodes a focus gained/lost event (mode 1004) into the escape-sequence
/// bytes that should be written to the pty. Unlike key/mouse encoding this
/// needs no encoder state at all (`libghostty_vt::focus::Event::encode` is
/// already a pure function on a plain enum) — wrapped here only so callers
/// have one consistent `vt::encode_*` entry point per input kind. Called by
/// `terminal::commands::terminal_focus`, gated on
/// `TerminalModesSnapshot::focus_reporting_enabled` (see that struct's doc).
pub(crate) fn encode_focus_event(event: focus::Event) -> Result<Vec<u8>, VtError> {
    let mut buf = [0_u8; 8];
    let written = event.encode(&mut buf)?;
    Ok(buf[..written].to_vec())
}

#[cfg(test)]
mod tests;
