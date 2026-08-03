//! Wire request/response shapes for the terminal commands. F070's "IPC 改造"
//! slice (docs/research/2026-07-24-libghostty-terminal.md) replaced the S2
//! placeholder raw-byte `TerminalInputRequest`/`TerminalDataEvent` shapes
//! with the render-state projection below: `plain://terminal-data` now
//! carries a [`TerminalFrame`] (a serializable projection of
//! `terminal::vt::DirtyFrame`) instead of raw pty bytes, and input is split
//! into [`TerminalInputTextRequest`] (IME-committed/pasted text, written to
//! the pty as-is) and [`TerminalInputKeyRequest`] (a structured key event,
//! encoded through `libghostty-vt`'s own encoder before being written) —
//! see this slice's final report for why.

use std::fmt;
use std::path::Path;

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::{Uuid, Variant};

use libghostty_vt::key;
use libghostty_vt::render::{Colors, CursorViewport, CursorVisualStyle, Dirty};
use libghostty_vt::screen::{CellSemanticContent, RowSemanticPrompt};
use libghostty_vt::style::{RgbColor, Style, Underline};

use crate::error::CommandError;
use crate::workspace::RootId;

use super::vt;

/// Defensive ceiling on `cols`/`rows` for both `terminal_start` and
/// `terminal_resize`: comfortably above any real display (a 16K monitor at
/// a 4px-wide monospace font is nowhere near this many columns), purely a
/// hostile-input backstop against a request trying to make Rust allocate an
/// unreasonable pty geometry.
const MAX_TERMINAL_DIMENSION: u16 = 2_000;
/// Defensive ceiling on a single `terminal_input_text` call's UTF-8 byte
/// length. Real keyboard/IME/paste input is a handful of bytes to a modest
/// pasted block, well under this — a hostile-input backstop, not an
/// expected value.
const MAX_TERMINAL_INPUT_BYTES: usize = 1024 * 1024;
/// Defensive ceiling on a single `terminal_input_key` call's optional
/// `utf8` field: a real keyboard layout produces at most a handful of UTF-8
/// bytes for one keypress (even a multi-codepoint grapheme), so this is a
/// hostile-input backstop, not an expected value.
const MAX_TERMINAL_KEY_UTF8_BYTES: usize = 64;
/// Defensive ceiling on a single `terminal_scrollback` call's `count`:
/// matches `terminal::vt::TERMINAL_VT_MAX_SCROLLBACK_LINES`, since no
/// session ever retains more scrollback than that regardless of what is
/// requested.
const MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS: u32 = 10_000;
const MAX_TERMINAL_PROFILE_ID_BYTES: usize = 64;
const MAX_TERMINAL_CWD_BYTES: usize = 4_096;
/// Matches `terminal::opener::MAX_EXTERNAL_LINK_BYTES` — kept as this
/// module's own independent constant since `into_parts` and `opener::open_external_link`
/// are two deliberately-independent validations of the same request (see
/// that function's own doc comment).
const MAX_TERMINAL_EXTERNAL_LINK_BYTES: usize = 8_192;

/// An opaque, window-bound identity for one terminal session. Validated the
/// same strict way `search::dto::SearchId` is (exact-length, version-4,
/// RFC4122 hyphenated string), and redacted in `Debug` for the same reason.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TerminalSessionId(Uuid);

impl TerminalSessionId {
    pub(crate) fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn as_wire(self) -> String {
        self.0.hyphenated().to_string()
    }
}

impl fmt::Debug for TerminalSessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("terminal session id")
            .field(&"<redacted>")
            .finish()
    }
}

impl Serialize for TerminalSessionId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_wire())
    }
}

impl<'de> Deserialize<'de> for TerminalSessionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = String::deserialize(deserializer)?;
        let value =
            Uuid::parse_str(&wire).map_err(|_| D::Error::custom("invalid terminal session id"))?;
        if value.get_version_num() != 4
            || value.get_variant() != Variant::RFC4122
            || value.hyphenated().to_string() != wire
        {
            return Err(D::Error::custom("invalid terminal session id"));
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalStartRequest {
    root_id: RootId,
    profile_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug)]
pub(crate) struct TerminalStartQuery {
    pub(crate) root_id: RootId,
    pub(crate) profile_id: String,
    pub(crate) cwd: Option<String>,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

impl TerminalStartRequest {
    pub(crate) fn into_parts(self) -> Result<TerminalStartQuery, CommandError> {
        validate_dimensions(self.cols, self.rows)?;
        if !is_valid_profile_id(&self.profile_id) {
            return Err(invalid_terminal_request());
        }
        if self.cwd.as_ref().is_some_and(|cwd| {
            cwd.is_empty()
                || cwd.len() > MAX_TERMINAL_CWD_BYTES
                || cwd.contains('\0')
                || Path::new(cwd).is_absolute()
        }) {
            return Err(invalid_terminal_request());
        }
        Ok(TerminalStartQuery {
            root_id: self.root_id,
            profile_id: self.profile_id,
            cwd: self.cwd,
            cols: self.cols,
            rows: self.rows,
        })
    }
}

fn is_valid_profile_id(profile_id: &str) -> bool {
    !profile_id.is_empty()
        && profile_id.len() <= MAX_TERMINAL_PROFILE_ID_BYTES
        && profile_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalProfilesRequest {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    id: String,
    label: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfilesResult {
    profiles: Vec<TerminalProfile>,
    default_profile_id: String,
}

impl TerminalProfilesResult {
    pub(crate) fn from_shell_profiles(profiles: Vec<super::shell::ShellProfile>) -> Self {
        Self {
            profiles: profiles
                .into_iter()
                .map(|profile| TerminalProfile {
                    id: profile.id.to_owned(),
                    label: profile.label,
                })
                .collect(),
            default_profile_id: super::shell::SYSTEM_DEFAULT_PROFILE_ID.to_owned(),
        }
    }
}

/// Wire projection of `terminal::shell_integration::ShellIntegrationStatus`
/// (F190 S4 "Ghostty metadata and links" — shell-integration injection's own
/// observable outcome, never silently pretended to have succeeded). See that
/// type's doc comment for what each variant means and how it is decided.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalShellIntegrationStatus {
    Injected,
    UnsupportedShell,
}

impl From<super::shell_integration::ShellIntegrationStatus> for TerminalShellIntegrationStatus {
    fn from(value: super::shell_integration::ShellIntegrationStatus) -> Self {
        match value {
            super::shell_integration::ShellIntegrationStatus::Injected => Self::Injected,
            super::shell_integration::ShellIntegrationStatus::Unsupported => Self::UnsupportedShell,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    session_id: TerminalSessionId,
    shell_integration: TerminalShellIntegrationStatus,
}

impl TerminalStartResult {
    pub(crate) fn new(
        session_id: TerminalSessionId,
        shell_integration: super::shell_integration::ShellIntegrationStatus,
    ) -> Self {
        Self {
            session_id,
            shell_integration: shell_integration.into(),
        }
    }
}

/// `terminal_input_text` request: raw text (an IME composition commit, or a
/// pasted block) written to the pty as its own UTF-8 bytes — no key
/// encoding involved, unlike [`TerminalInputKeyRequest`].
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalInputTextRequest {
    session_id: TerminalSessionId,
    text: String,
}

impl TerminalInputTextRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, String), CommandError> {
        if self.text.len() > MAX_TERMINAL_INPUT_BYTES {
            return Err(invalid_terminal_request());
        }
        Ok((self.session_id, self.text))
    }
}

/// `terminal_input_key` request: one structured key event, encoded through
/// `libghostty-vt`'s own key encoder (see `terminal::vt::encode_key_event`)
/// before being written to the pty. `action`/`key` are the literal
/// `libghostty_vt::key::{Action,Key}` `#[repr(u32)]` enum discriminant
/// values (validated via that crate's own derived `TryFrom<u32>`, not a
/// hand-maintained name lookup); `mods` is a strict `libghostty_vt::key::Mods`
/// bitmask (unknown bits rejected via `Mods::from_bits`, not silently
/// truncated). Translating a DOM `KeyboardEvent` into these numeric values
/// is the consuming WebView rendering slice's job, not this IPC contract's.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalInputKeyRequest {
    session_id: TerminalSessionId,
    action: u32,
    key: u32,
    mods: u16,
    utf8: Option<String>,
}

impl TerminalInputKeyRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, vt::KeyInput), CommandError> {
        let action = key::Action::try_from(self.action).map_err(|_| invalid_terminal_request())?;
        let key = key::Key::try_from(self.key).map_err(|_| invalid_terminal_request())?;
        let mods = key::Mods::from_bits(self.mods).ok_or_else(invalid_terminal_request)?;
        if self
            .utf8
            .as_ref()
            .is_some_and(|text| text.len() > MAX_TERMINAL_KEY_UTF8_BYTES)
        {
            return Err(invalid_terminal_request());
        }
        let mut input = vt::KeyInput::new(action, key, mods);
        if let Some(text) = self.utf8 {
            input = input.with_utf8(text);
        }
        Ok((self.session_id, input))
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalResizeRequest {
    session_id: TerminalSessionId,
    cols: u16,
    rows: u16,
}

impl TerminalResizeRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, u16, u16), CommandError> {
        validate_dimensions(self.cols, self.rows)?;
        Ok((self.session_id, self.cols, self.rows))
    }
}

/// `terminal_focus` request: whether this window's terminal view just
/// gained or lost focus. Encoded (via `terminal::vt::encode_focus_event`)
/// and written to the pty only if the session's live terminal currently has
/// focus-reporting mode (DEC 1004) enabled — see
/// `terminal::vt::TerminalModesSnapshot::focus_reporting_enabled`.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalFocusRequest {
    session_id: TerminalSessionId,
    focused: bool,
}

impl TerminalFocusRequest {
    pub(crate) fn into_parts(self) -> (TerminalSessionId, bool) {
        (self.session_id, self.focused)
    }
}

/// `terminal_ack` request: acknowledges that the frontend has applied every
/// `plain://terminal-data` frame up through `sequence`, freeing the vt
/// thread's single-frame-in-flight emission credit (see `service.rs`'s
/// module doc's "VT → frontend frame delivery backpressure" section) —
/// **not** a byte count. An over-generous or duplicate ack (a `sequence`
/// at or below what was already acked) is tolerated, not rejected, mirroring
/// `flow::FlowControl::ack`'s own tolerant contract for the still-separate
/// PTY → VT byte-level backpressure leg.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalAckRequest {
    session_id: TerminalSessionId,
    sequence: u64,
}

impl TerminalAckRequest {
    pub(crate) fn into_parts(self) -> (TerminalSessionId, u64) {
        (self.session_id, self.sequence)
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalKillRequest {
    session_id: TerminalSessionId,
    immediate: bool,
}

impl TerminalKillRequest {
    pub(crate) fn into_parts(self) -> (TerminalSessionId, bool) {
        (self.session_id, self.immediate)
    }
}

/// `terminal_scrollback` request: pulls up to `count` history rows starting
/// at history row `start` (`0` = oldest retained line) — see
/// `terminal::vt::VtSession::scrollback_rows`'s doc for the exact semantics
/// this delegates to. `count` must be `1..=MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS`;
/// a `start` past the end of retained scrollback is not an error (it simply
/// yields fewer, possibly zero, rows).
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalScrollbackRequest {
    session_id: TerminalSessionId,
    start: u32,
    count: u32,
}

impl TerminalScrollbackRequest {
    pub(crate) fn into_parts(self) -> Result<(TerminalSessionId, usize, usize), CommandError> {
        if self.count == 0 || self.count > MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS {
            return Err(invalid_terminal_request());
        }
        Ok((self.session_id, self.start as usize, self.count as usize))
    }
}

/// Wire projection of [`libghostty_vt::style::RgbColor`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRgb {
    r: u8,
    g: u8,
    b: u8,
}

impl From<RgbColor> for TerminalRgb {
    fn from(value: RgbColor) -> Self {
        Self {
            r: value.r,
            g: value.g,
            b: value.b,
        }
    }
}

/// Wire projection of [`libghostty_vt::style::Underline`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalUnderline {
    None,
    Single,
    Double,
    Curly,
    Dotted,
    Dashed,
}

impl From<Underline> for TerminalUnderline {
    fn from(value: Underline) -> Self {
        match value {
            Underline::None => Self::None,
            Underline::Single => Self::Single,
            Underline::Double => Self::Double,
            Underline::Curly => Self::Curly,
            Underline::Dotted => Self::Dotted,
            Underline::Dashed => Self::Dashed,
            // `Underline` is `#[non_exhaustive]` upstream: fall back to
            // "no underline" rather than fail the whole frame if a future
            // libghostty-vt version adds a variant this module does not
            // know about yet.
            _ => Self::None,
        }
    }
}

/// Wire projection of [`libghostty_vt::style::Style`]'s boolean attribute
/// flags plus `underline`. Deliberately omits `fg_color`/`bg_color`/
/// `underline_color` (all `StyleColor`, i.e. palette-index-or-RGB-or-unset):
/// [`TerminalCell`] already carries the *resolved* `fg`/`bg` RGB libghostty-vt
/// itself computed (see `terminal::vt::DirtyCell::fg_rgb`/`bg_rgb`'s doc),
/// which is what a renderer actually needs; a distinct underline color is
/// not currently wire-projected.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStyle {
    bold: bool,
    italic: bool,
    faint: bool,
    blink: bool,
    inverse: bool,
    invisible: bool,
    strikethrough: bool,
    overline: bool,
    underline: TerminalUnderline,
}

impl From<Style> for TerminalStyle {
    fn from(value: Style) -> Self {
        Self {
            bold: value.bold,
            italic: value.italic,
            faint: value.faint,
            blink: value.blink,
            inverse: value.inverse,
            invisible: value.invisible,
            strikethrough: value.strikethrough,
            overline: value.overline,
            underline: value.underline.into(),
        }
    }
}

/// Wire projection of [`libghostty_vt::screen::CellSemanticContent`] (OSC
/// 133) — see that type's own doc comment. Consumed by the renderer only
/// for CSS classification (e.g. dimming output vs highlighting a typed
/// command) and prompt-navigation commands; never widens process capability.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSemanticContent {
    Output,
    Input,
    Prompt,
}

impl From<CellSemanticContent> for TerminalSemanticContent {
    fn from(value: CellSemanticContent) -> Self {
        match value {
            CellSemanticContent::Output => Self::Output,
            CellSemanticContent::Input => Self::Input,
            CellSemanticContent::Prompt => Self::Prompt,
        }
    }
}

/// Wire projection of [`libghostty_vt::screen::RowSemanticPrompt`] (OSC 133)
/// — see that type's own doc comment. Drives "jump to previous/next prompt"
/// command navigation.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalRowSemanticPrompt {
    None,
    Prompt,
    Continuation,
}

impl From<RowSemanticPrompt> for TerminalRowSemanticPrompt {
    fn from(value: RowSemanticPrompt) -> Self {
        match value {
            RowSemanticPrompt::None => Self::None,
            RowSemanticPrompt::Prompt => Self::Prompt,
            RowSemanticPrompt::Continuation => Self::Continuation,
        }
    }
}

/// Wire projection of one [`terminal::vt::DirtyCell`]. `graphemes` is the
/// cell's base codepoint plus any combining marks, joined into a single
/// `String` (a JSON string already carries UTF-16/UTF-8 text losslessly, so
/// there is no reason to wire-project this as a `char` array). Deliberately
/// omits `DirtyCell::selected` — viewport selection rendering is not part of
/// this slice. `hyperlink` is already capped/validated by
/// `terminal::vt::read_hyperlink_uri` before this ever runs — see that
/// function's doc comment for the strict-byte-cap-then-drop policy; this
/// type does not re-validate it (an outgoing-only field, never parsed back).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCell {
    graphemes: String,
    fg: Option<TerminalRgb>,
    bg: Option<TerminalRgb>,
    style: TerminalStyle,
    hyperlink: Option<String>,
    semantic: TerminalSemanticContent,
}

impl From<vt::DirtyCell> for TerminalCell {
    fn from(value: vt::DirtyCell) -> Self {
        Self {
            graphemes: value.graphemes.into_iter().collect(),
            fg: value.fg_rgb.map(TerminalRgb::from),
            bg: value.bg_rgb.map(TerminalRgb::from),
            style: value.style.into(),
            hyperlink: value.hyperlink,
            semantic: value.semantic.into(),
        }
    }
}

/// Wire projection of one [`terminal::vt::DirtyRow`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRow {
    row_index: u32,
    semantic_prompt: TerminalRowSemanticPrompt,
    cells: Vec<TerminalCell>,
}

impl From<vt::DirtyRow> for TerminalRow {
    fn from(value: vt::DirtyRow) -> Self {
        Self {
            row_index: value.row_index as u32,
            semantic_prompt: value.semantic_prompt.into(),
            cells: value.cells.into_iter().map(TerminalCell::from).collect(),
        }
    }
}

/// Wire projection of [`libghostty_vt::render::CursorViewport`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCursorViewport {
    x: u16,
    y: u16,
    at_wide_tail: bool,
}

impl From<CursorViewport> for TerminalCursorViewport {
    fn from(value: CursorViewport) -> Self {
        Self {
            x: value.x,
            y: value.y,
            at_wide_tail: value.at_wide_tail,
        }
    }
}

/// Wire projection of [`libghostty_vt::render::CursorVisualStyle`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalCursorStyle {
    Bar,
    Block,
    Underline,
    BlockHollow,
}

impl From<CursorVisualStyle> for TerminalCursorStyle {
    fn from(value: CursorVisualStyle) -> Self {
        match value {
            CursorVisualStyle::Bar => Self::Bar,
            CursorVisualStyle::Block => Self::Block,
            CursorVisualStyle::Underline => Self::Underline,
            CursorVisualStyle::BlockHollow => Self::BlockHollow,
            // `CursorVisualStyle` is `#[non_exhaustive]` upstream; see
            // `TerminalUnderline::from`'s identical rationale.
            _ => Self::Block,
        }
    }
}

/// Wire projection of a [`terminal::vt::DirtyFrame`]'s cursor fields.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCursor {
    visible: bool,
    blinking: bool,
    viewport: Option<TerminalCursorViewport>,
    style: TerminalCursorStyle,
}

impl From<vt::CursorState> for TerminalCursor {
    fn from(value: vt::CursorState) -> Self {
        Self {
            visible: value.visible,
            blinking: value.blinking,
            viewport: value.viewport.map(TerminalCursorViewport::from),
            style: value.style.into(),
        }
    }
}

/// Wire projection of [`libghostty_vt::render::Colors`]. Deliberately omits
/// `Colors::palette` (the full 256-entry color palette): every cell's
/// `fg`/`bg` in [`TerminalCell`] is already fully resolved by libghostty-vt
/// itself (palette lookups included), so a renderer never needs to resolve
/// a palette index on its own — only `background`/`foreground`/`cursor` are
/// needed, as the frame-level defaults to paint where a cell has no
/// explicit color.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalColors {
    background: TerminalRgb,
    foreground: TerminalRgb,
    cursor: Option<TerminalRgb>,
}

impl From<Colors> for TerminalColors {
    fn from(value: Colors) -> Self {
        Self {
            background: value.background.into(),
            foreground: value.foreground.into(),
            cursor: value.cursor.map(TerminalRgb::from),
        }
    }
}

/// Wire projection of [`libghostty_vt::render::Dirty`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalDirty {
    Clean,
    Partial,
    Full,
}

impl From<Dirty> for TerminalDirty {
    fn from(value: Dirty) -> Self {
        match value {
            Dirty::Clean => Self::Clean,
            Dirty::Partial => Self::Partial,
            Dirty::Full => Self::Full,
        }
    }
}

/// Wire projection of a [`terminal::vt::DirtyFrame`] — the render-state
/// "what changed" snapshot that is `plain://terminal-data`'s payload as of
/// F070's "IPC 改造" slice (replacing the S2 raw-byte placeholder). Encoded
/// as structured JSON rather than a packed binary frame + base64: unlike
/// S2's raw pty bytes (a high-frequency, fixed-shape byte stream, for which
/// base64 was the right call), a dirty frame is emitted at most once per
/// vt-thread emission credit (see `service.rs`'s module doc — heavily
/// coalesced relative to raw bytes) and its cell grid has variable-length
/// nested data (a variable number of dirty rows, each with a variable
/// number of cells, each with a variable-length grapheme string and
/// optional colors) that does not map onto a fixed binary layout as cleanly
/// as a flat byte buffer did. Structured JSON keeps every field
/// individually Harness-lockable (`hasExactKeys` per level) and trivially
/// correct to decode, at some size cost this slice accepts given the
/// frequency is already throttled — see this slice's final report for the
/// full comparison.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFrame {
    dirty: TerminalDirty,
    cols: u16,
    rows: u16,
    cursor: TerminalCursor,
    colors: TerminalColors,
    rows_data: Vec<TerminalRow>,
    /// The session's current OSC 7/9/1337 working directory, root-relative
    /// to whichever workspace root this session was started in — `None` if
    /// no shell-integration cwd has been reported yet, or the shell's
    /// current directory is not (or no longer) inside that root. See
    /// `terminal::service::relativize_pwd`'s doc comment: this is never an
    /// absolute filesystem path, and is used only for (a) UI display and (b)
    /// as a candidate for the *next* split's cwd — which Rust re-validates
    /// via the exact same `resolve_cwd` containment check any other cwd
    /// goes through, exactly as any other `TerminalStartRequest::cwd` would.
    pwd: Option<String>,
}

impl From<vt::DirtyFrame> for TerminalFrame {
    fn from(value: vt::DirtyFrame) -> Self {
        Self {
            dirty: value.dirty.into(),
            cols: value.cols,
            rows: value.rows,
            cursor: value.cursor.into(),
            colors: value.colors.into(),
            rows_data: value.rows_data.into_iter().map(TerminalRow::from).collect(),
            pwd: value.pwd,
        }
    }
}

/// `plain://terminal-data` event payload (F070 "IPC 改造" slice): one
/// emitted [`TerminalFrame`], in the exact order and with the exact
/// `sequence` `terminal::service`'s vt thread assigned it (monotonic per
/// session, incremented once per *emitted* frame — not once per `feed`
/// call, since intervening feeds while emission credit is exhausted are
/// coalesced into the next frame rather than each getting their own
/// sequence number).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
    session_id: TerminalSessionId,
    sequence: u64,
    frame: TerminalFrame,
}

impl TerminalDataEvent {
    pub(crate) fn new(session_id: TerminalSessionId, sequence: u64, frame: vt::DirtyFrame) -> Self {
        Self {
            session_id,
            sequence,
            frame: frame.into(),
        }
    }
}

/// `plain://terminal-exit` event payload: `{ sessionId, exitCode, signal }`.
/// `F190` S6 "真实 exit banner": `signal` was dropped entirely by the prior
/// slice, but `portable_pty::ExitStatus::exit_code()` is **not** a reliable
/// "real exit code" on its own — see that type's own `From<std::process::
/// ExitStatus>` impl: when a process is terminated by a signal, `code` is
/// hardcoded to `1` (a placeholder, not the process's actual exit status)
/// and the *real* outcome is only ever carried by `signal`. A banner built
/// from `exitCode` alone would therefore report an inaccurate "exit code 1"
/// for e.g. `kill -9`, instead of the true "terminated by signal" outcome —
/// this field is what fixes that. `null` means "exited normally" (whatever
/// `exitCode` is, is the process's own real exit status); non-`null` means
/// the process was terminated by a signal and `exitCode` is not meaningful
/// on its own (see `TerminalExitStatus`'s own doc comment in `service.rs`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    session_id: TerminalSessionId,
    exit_code: u32,
    signal: Option<String>,
}

impl TerminalExitEvent {
    pub(crate) fn new(
        session_id: TerminalSessionId,
        status: super::service::TerminalExitStatus,
    ) -> Self {
        Self {
            session_id,
            exit_code: status.exit_code,
            signal: status.signal,
        }
    }
}

/// Wire projection of one [`terminal::vt::ScrollbackCell`]. Lighter than
/// [`TerminalCell`]: see `terminal::vt::VtSession::scrollback_rows`'s doc
/// for why scrollback rows do not carry resolved `fg`/`bg` RGB.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollbackCell {
    graphemes: String,
    style: TerminalStyle,
}

impl From<vt::ScrollbackCell> for TerminalScrollbackCell {
    fn from(value: vt::ScrollbackCell) -> Self {
        Self {
            graphemes: value.graphemes.into_iter().collect(),
            style: value.style.into(),
        }
    }
}

/// Wire projection of one [`terminal::vt::ScrollbackRow`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollbackRow {
    row_index: u32,
    cells: Vec<TerminalScrollbackCell>,
}

impl From<vt::ScrollbackRow> for TerminalScrollbackRow {
    fn from(value: vt::ScrollbackRow) -> Self {
        Self {
            row_index: value.row_index as u32,
            cells: value
                .cells
                .into_iter()
                .map(TerminalScrollbackCell::from)
                .collect(),
        }
    }
}

/// `terminal_scrollback` response.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalScrollbackResult {
    rows: Vec<TerminalScrollbackRow>,
}

impl TerminalScrollbackResult {
    pub(crate) fn new(rows: Vec<vt::ScrollbackRow>) -> Self {
        Self {
            rows: rows.into_iter().map(TerminalScrollbackRow::from).collect(),
        }
    }
}

/// `terminal_open_external_link` request: hands a terminal cell's OSC 8
/// hyperlink URI off to `terminal::opener::open_external_link` — see that
/// function's doc comment for the full "audited external opener" contract
/// this is the IPC-facing half of. Rejects anything but a well-formed,
/// size-bounded `http://`/`https://` URL *before* it ever reaches the
/// opener, exactly mirroring every other request-side validation in this
/// file (the opener itself re-validates independently regardless — belt
/// and suspenders, not "the frontend is trusted").
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalOpenExternalLinkRequest {
    url: String,
}

impl TerminalOpenExternalLinkRequest {
    pub(crate) fn into_parts(self) -> Result<String, CommandError> {
        if self.url.is_empty()
            || self.url.len() > MAX_TERMINAL_EXTERNAL_LINK_BYTES
            || self.url.contains('\0')
            || !(self.url.starts_with("http://") || self.url.starts_with("https://"))
        {
            return Err(invalid_terminal_request());
        }
        Ok(self.url)
    }
}

/// `terminal_lifecycle_marker` request: empty — the window comes from the
/// Tauri `WebviewWindow` extractor, exactly like every other window-scoped
/// terminal command.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalLifecycleMarkerRequest {}

/// `terminal_lifecycle_marker` response: how many of this window's terminal
/// sessions were left un-explicitly-closed by whatever ran immediately
/// before this call (see `terminal::service::TerminalService::
/// claim_lifecycle_marker`'s doc comment for the full "reload vs crash vs
/// ordinary re-open" contract this reports). `0` for an ordinary first mount
/// or a re-open after every prior session was explicitly closed — the
/// overwhelmingly common case — in which case the frontend shows no notice
/// at all.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLifecycleMarkerResult {
    non_restorable_count: u32,
}

impl TerminalLifecycleMarkerResult {
    pub(crate) const fn new(non_restorable_count: u32) -> Self {
        Self {
            non_restorable_count,
        }
    }
}

fn validate_dimensions(cols: u16, rows: u16) -> Result<(), CommandError> {
    if cols == 0 || rows == 0 || cols > MAX_TERMINAL_DIMENSION || rows > MAX_TERMINAL_DIMENSION {
        return Err(invalid_terminal_request());
    }
    Ok(())
}

fn invalid_terminal_request() -> CommandError {
    CommandError::new(
        "INVALID_TERMINAL_REQUEST",
        "The terminal request is invalid.",
    )
}

#[cfg(test)]
mod tests {
    use libghostty_vt::key;
    use libghostty_vt::render::{CursorVisualStyle, Dirty};
    use libghostty_vt::screen::{CellSemanticContent, RowSemanticPrompt};
    use libghostty_vt::style::{RgbColor, Style};

    use super::{
        TerminalAckRequest, TerminalFocusRequest, TerminalInputKeyRequest,
        TerminalInputTextRequest, TerminalKillRequest, TerminalLifecycleMarkerRequest,
        TerminalLifecycleMarkerResult, TerminalOpenExternalLinkRequest, TerminalProfilesRequest,
        TerminalProfilesResult, TerminalResizeRequest, TerminalScrollbackRequest,
        TerminalStartRequest, MAX_TERMINAL_EXTERNAL_LINK_BYTES, MAX_TERMINAL_INPUT_BYTES,
        MAX_TERMINAL_KEY_UTF8_BYTES, MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS,
    };
    use crate::terminal::service::TerminalExitStatus;
    use crate::terminal::vt::{self, DirtyCell, DirtyFrame, DirtyRow};

    const VALID_ID: &str = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

    fn valid_session_id() -> super::TerminalSessionId {
        serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap()
    }

    #[test]
    fn every_terminal_request_rejects_extra_fields() {
        assert!(
            serde_json::from_value::<TerminalStartRequest>(serde_json::json!({
                "rootId": VALID_ID, "profileId": "systemDefault", "cols": 80, "rows": 24, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalProfilesRequest>(serde_json::json!({
                "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalInputTextRequest>(serde_json::json!({
                "sessionId": VALID_ID, "text": "hi", "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalInputKeyRequest>(serde_json::json!({
                "sessionId": VALID_ID, "action": 0, "key": 20, "mods": 0, "utf8": null, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalResizeRequest>(serde_json::json!({
                "sessionId": VALID_ID, "cols": 80, "rows": 24, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalFocusRequest>(serde_json::json!({
                "sessionId": VALID_ID, "focused": true, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalAckRequest>(serde_json::json!({
                "sessionId": VALID_ID, "sequence": 10, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalKillRequest>(serde_json::json!({
                "sessionId": VALID_ID, "immediate": true, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalScrollbackRequest>(serde_json::json!({
                "sessionId": VALID_ID, "start": 0, "count": 10, "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalOpenExternalLinkRequest>(serde_json::json!({
                "url": "https://example.com", "extra": true
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalLifecycleMarkerRequest>(serde_json::json!({
                "extra": true
            }))
            .is_err()
        );
    }

    #[test]
    fn open_external_link_request_accepts_http_and_https_and_rejects_every_hostile_shape() {
        for url in ["https://example.com/path?q=1", "http://example.com"] {
            let request: TerminalOpenExternalLinkRequest =
                serde_json::from_value(serde_json::json!({ "url": url })).unwrap();
            assert_eq!(request.into_parts().unwrap(), url);
        }

        for url in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "ftp://example.com",
            "HTTPS://example.com",
        ] {
            let request: TerminalOpenExternalLinkRequest =
                serde_json::from_value(serde_json::json!({ "url": url })).unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_TERMINAL_REQUEST"
            );
        }

        let oversized = format!(
            "https://example.com/{}",
            "a".repeat(MAX_TERMINAL_EXTERNAL_LINK_BYTES)
        );
        let request: TerminalOpenExternalLinkRequest =
            serde_json::from_value(serde_json::json!({ "url": oversized })).unwrap();
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );
    }

    #[test]
    fn start_request_requires_root_and_profile_accepts_relative_cwd_and_rejects_invalid_fields() {
        let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
            "rootId": VALID_ID, "profileId": "systemDefault", "cols": 80, "rows": 24
        }))
        .unwrap();
        let query = request.into_parts().unwrap();
        assert_eq!(query.root_id.as_wire(), VALID_ID);
        assert_eq!(query.profile_id, "systemDefault");
        assert_eq!(query.cwd, None);
        assert_eq!(query.cols, 80);
        assert_eq!(query.rows, 24);

        assert!(
            serde_json::from_value::<TerminalStartRequest>(serde_json::json!({
                "profileId": "systemDefault", "cols": 80, "rows": 24
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<TerminalStartRequest>(serde_json::json!({
                "rootId": "not-a-root", "profileId": "systemDefault", "cols": 80, "rows": 24
            }))
            .is_err()
        );

        for (profile_id, cwd) in [
            ("", None),
            ("bad/profile", None),
            ("systemDefault", Some("")),
            ("systemDefault", Some("/absolute/path")),
        ] {
            let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
                "rootId": VALID_ID,
                "profileId": profile_id,
                "cwd": cwd,
                "cols": 80,
                "rows": 24
            }))
            .unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_TERMINAL_REQUEST"
            );
        }

        let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
            "rootId": VALID_ID,
            "profileId": "zsh",
            "cwd": "nested/project",
            "cols": 80,
            "rows": 24
        }))
        .unwrap();
        let query = request.into_parts().unwrap();
        assert_eq!(query.profile_id, "zsh");
        assert_eq!(query.cwd.as_deref(), Some("nested/project"));

        for (cols, rows) in [(0, 24), (80, 0), (3_000, 24), (80, 3_000)] {
            let request: TerminalStartRequest = serde_json::from_value(serde_json::json!({
                "rootId": VALID_ID, "profileId": "systemDefault", "cols": cols, "rows": rows
            }))
            .unwrap();
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_TERMINAL_REQUEST"
            );
        }
    }

    #[test]
    fn profiles_result_exposes_only_native_issued_ids_labels_and_default() {
        let result = TerminalProfilesResult::from_shell_profiles(vec![
            crate::terminal::shell::ShellProfile {
                id: crate::terminal::shell::SYSTEM_DEFAULT_PROFILE_ID,
                label: "zsh (System Default)".to_owned(),
            },
            crate::terminal::shell::ShellProfile {
                id: "bash",
                label: "bash".to_owned(),
            },
        ]);
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({
                "profiles": [
                    {"id": "systemDefault", "label": "zsh (System Default)"},
                    {"id": "bash", "label": "bash"}
                ],
                "defaultProfileId": "systemDefault"
            })
        );
    }

    #[test]
    fn input_text_request_rejects_oversized_text() {
        let oversized = "a".repeat(MAX_TERMINAL_INPUT_BYTES + 1);
        let request = TerminalInputTextRequest {
            session_id: valid_session_id(),
            text: oversized,
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );
    }

    #[test]
    fn input_text_request_round_trips_a_valid_payload() {
        let request: TerminalInputTextRequest = serde_json::from_value(serde_json::json!({
            "sessionId": VALID_ID, "text": "hello"
        }))
        .unwrap();
        let (session_id, text) = request.into_parts().unwrap();
        assert_eq!(session_id, valid_session_id());
        assert_eq!(text, "hello");
    }

    #[test]
    fn input_key_request_rejects_unknown_action_key_or_mods_bits() {
        // `action` out of `key::Action`'s valid discriminant range.
        let request = TerminalInputKeyRequest {
            session_id: valid_session_id(),
            action: 999,
            key: 20,
            mods: 0,
            utf8: None,
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );

        // `key` out of `key::Key`'s valid discriminant range.
        let request = TerminalInputKeyRequest {
            session_id: valid_session_id(),
            action: 0,
            key: 999_999,
            mods: 0,
            utf8: None,
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );

        // Every currently-defined `Mods` bit set except one unknown high bit.
        let request = TerminalInputKeyRequest {
            session_id: valid_session_id(),
            action: 0,
            key: 20,
            mods: 0b1000_0000_0000_0000,
            utf8: None,
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );
    }

    #[test]
    fn input_key_request_rejects_oversized_utf8() {
        let request = TerminalInputKeyRequest {
            session_id: valid_session_id(),
            action: 0,
            key: 20,
            mods: 0,
            utf8: Some("a".repeat(MAX_TERMINAL_KEY_UTF8_BYTES + 1)),
        };
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "INVALID_TERMINAL_REQUEST"
        );
    }

    #[test]
    fn input_key_request_resolves_a_valid_payload_into_a_key_input() {
        let request = TerminalInputKeyRequest {
            session_id: valid_session_id(),
            action: key::Action::Press as u32,
            key: key::Key::A as u32,
            mods: key::Mods::CTRL.bits(),
            utf8: Some("a".to_owned()),
        };
        let (session_id, input) = request.into_parts().unwrap();
        assert_eq!(session_id, valid_session_id());
        assert_eq!(input.action, key::Action::Press);
        assert_eq!(input.key, key::Key::A);
        assert_eq!(input.mods, key::Mods::CTRL);
        assert_eq!(input.utf8.as_deref(), Some("a"));
    }

    #[test]
    fn scrollback_request_rejects_zero_or_oversized_count() {
        for count in [0, MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS + 1] {
            let request = TerminalScrollbackRequest {
                session_id: valid_session_id(),
                start: 0,
                count,
            };
            assert_eq!(
                request.into_parts().unwrap_err().code(),
                "INVALID_TERMINAL_REQUEST"
            );
        }
    }

    #[test]
    fn scrollback_request_accepts_a_valid_payload() {
        let request = TerminalScrollbackRequest {
            session_id: valid_session_id(),
            start: 5,
            count: 10,
        };
        let (session_id, start, count) = request.into_parts().unwrap();
        assert_eq!(session_id, valid_session_id());
        assert_eq!(start, 5);
        assert_eq!(count, 10);
    }

    #[test]
    fn focus_request_extracts_session_and_focused() {
        let request = TerminalFocusRequest {
            session_id: valid_session_id(),
            focused: true,
        };
        assert_eq!(request.into_parts(), (valid_session_id(), true));
    }

    #[test]
    fn ack_request_extracts_session_and_sequence() {
        let request = TerminalAckRequest {
            session_id: valid_session_id(),
            sequence: 42,
        };
        assert_eq!(request.into_parts(), (valid_session_id(), 42));
    }

    #[test]
    fn session_id_round_trips_and_rejects_malformed_wire_strings() {
        let value: super::TerminalSessionId =
            serde_json::from_value(serde_json::Value::String(VALID_ID.to_owned())).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), VALID_ID);

        for malformed in [
            "not-a-uuid",
            "0D3F4B0E-6F1A-4C9D-9C3A-1A2B3C4D5E6F",
            "0d3f4b0e6f1a4c9d9c3a1a2b3c4d5e6f",
        ] {
            assert!(
                serde_json::from_value::<super::TerminalSessionId>(serde_json::Value::String(
                    malformed.to_owned()
                ))
                .is_err()
            );
        }
    }

    #[test]
    fn exit_event_projects_a_normal_exit_code_with_a_null_signal() {
        let event = super::TerminalExitEvent::new(
            valid_session_id(),
            TerminalExitStatus {
                exit_code: 130,
                signal: None,
            },
        );
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "sessionId": VALID_ID, "exitCode": 130, "signal": null })
        );
    }

    /// `F190` S6: `portable_pty::ExitStatus::exit_code()` is a meaningless
    /// placeholder (`1`) whenever `signal` is set — see
    /// `TerminalExitEvent`'s own doc comment. This projection must carry the
    /// real `signal` through untouched rather than let a caller be misled by
    /// that placeholder `exitCode` into reporting "exit code 1".
    #[test]
    fn exit_event_projects_a_signal_terminated_exit_with_its_real_signal_name() {
        let event = super::TerminalExitEvent::new(
            valid_session_id(),
            TerminalExitStatus {
                exit_code: 1,
                signal: Some("Killed: 9".to_owned()),
            },
        );
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["exitCode"], 1);
        assert_eq!(value["signal"], "Killed: 9");
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["sessionId", "exitCode", "signal"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        );
    }

    #[test]
    fn lifecycle_marker_result_projects_exactly() {
        let result = TerminalLifecycleMarkerResult::new(3);
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::json!({ "nonRestorableCount": 3 })
        );
    }

    fn sample_dirty_frame() -> DirtyFrame {
        DirtyFrame {
            dirty: Dirty::Partial,
            cols: 10,
            rows: 2,
            cursor: vt::CursorState {
                visible: true,
                blinking: false,
                viewport: Some(libghostty_vt::render::CursorViewport {
                    x: 1,
                    y: 0,
                    at_wide_tail: false,
                }),
                style: CursorVisualStyle::Block,
            },
            colors: libghostty_vt::render::Colors {
                background: RgbColor { r: 0, g: 0, b: 0 },
                foreground: RgbColor {
                    r: 255,
                    g: 255,
                    b: 255,
                },
                cursor: None,
                palette: [RgbColor::default(); 256],
            },
            rows_data: vec![DirtyRow {
                row_index: 0,
                semantic_prompt: RowSemanticPrompt::Prompt,
                cells: vec![DirtyCell {
                    graphemes: vec!['h', 'i'],
                    style: Style::default(),
                    fg_rgb: Some(RgbColor {
                        r: 0xCC,
                        g: 0x66,
                        b: 0x66,
                    }),
                    bg_rgb: None,
                    selected: false,
                    hyperlink: Some("https://example.com".to_owned()),
                    semantic: CellSemanticContent::Prompt,
                }],
            }],
            pwd: Some("nested/project".to_owned()),
        }
    }

    #[test]
    fn data_event_projects_the_dirty_frame_field_by_field() {
        let event = super::TerminalDataEvent::new(valid_session_id(), 7, sample_dirty_frame());
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["sessionId"], VALID_ID);
        assert_eq!(value["sequence"], 7);
        let frame = &value["frame"];
        assert_eq!(frame["dirty"], "partial");
        assert_eq!(frame["cols"], 10);
        assert_eq!(frame["rows"], 2);
        assert_eq!(frame["cursor"]["visible"], true);
        assert_eq!(frame["cursor"]["style"], "block");
        assert_eq!(frame["cursor"]["viewport"]["x"], 1);
        assert_eq!(
            frame["colors"]["background"],
            serde_json::json!({"r":0,"g":0,"b":0})
        );
        assert_eq!(frame["colors"]["cursor"], serde_json::Value::Null);
        assert_eq!(frame["pwd"], "nested/project");
        let row0 = &frame["rowsData"][0];
        assert_eq!(row0["rowIndex"], 0);
        assert_eq!(row0["semanticPrompt"], "prompt");
        assert_eq!(row0["cells"][0]["graphemes"], "hi");
        assert_eq!(
            row0["cells"][0]["fg"],
            serde_json::json!({"r": 0xCC, "g": 0x66, "b": 0x66})
        );
        assert_eq!(row0["cells"][0]["bg"], serde_json::Value::Null);
        assert_eq!(row0["cells"][0]["style"]["bold"], false);
        assert_eq!(row0["cells"][0]["style"]["underline"], "none");
        assert_eq!(row0["cells"][0]["hyperlink"], "https://example.com");
        assert_eq!(row0["cells"][0]["semantic"], "prompt");
        // Every field name is exactly what `hasExactKeys`-style TypeScript
        // decoding expects — no extraneous, e.g. no raw `Colors::palette`.
        assert_eq!(
            frame
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["dirty", "cols", "rows", "cursor", "colors", "rowsData", "pwd"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        );
        assert_eq!(
            row0.as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["rowIndex", "semanticPrompt", "cells"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        );
        assert_eq!(
            row0["cells"][0]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["graphemes", "fg", "bg", "style", "hyperlink", "semantic"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        );
    }

    #[test]
    fn a_missing_pwd_and_hyperlink_serialize_as_null_and_semantic_defaults_project_exactly() {
        let mut frame = sample_dirty_frame();
        frame.pwd = None;
        frame.rows_data[0].semantic_prompt = RowSemanticPrompt::None;
        frame.rows_data[0].cells[0].hyperlink = None;
        frame.rows_data[0].cells[0].semantic = CellSemanticContent::Output;
        let event = super::TerminalDataEvent::new(valid_session_id(), 1, frame);
        let value = serde_json::to_value(event).unwrap();
        let row0 = &value["frame"]["rowsData"][0];
        assert_eq!(value["frame"]["pwd"], serde_json::Value::Null);
        assert_eq!(row0["semanticPrompt"], "none");
        assert_eq!(row0["cells"][0]["hyperlink"], serde_json::Value::Null);
        assert_eq!(row0["cells"][0]["semantic"], "output");
    }

    #[test]
    fn shell_integration_status_projects_exactly() {
        for (status, expected) in [
            (
                super::super::shell_integration::ShellIntegrationStatus::Injected,
                "injected",
            ),
            (
                super::super::shell_integration::ShellIntegrationStatus::Unsupported,
                "unsupportedShell",
            ),
        ] {
            let result = super::TerminalStartResult::new(valid_session_id(), status);
            let value = serde_json::to_value(result).unwrap();
            assert_eq!(value["shellIntegration"], expected);
            assert_eq!(
                value
                    .as_object()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<std::collections::BTreeSet<_>>(),
                ["sessionId", "shellIntegration"]
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
            );
        }
    }

    #[test]
    fn scrollback_result_projects_rows_without_resolved_colors() {
        let rows = vec![vt::ScrollbackRow {
            row_index: 3,
            cells: vec![vt::ScrollbackCell {
                graphemes: vec!['x'],
                style: Style::default(),
            }],
        }];
        let result = super::TerminalScrollbackResult::new(rows);
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["rows"][0]["rowIndex"], 3);
        assert_eq!(value["rows"][0]["cells"][0]["graphemes"], "x");
        assert_eq!(
            value["rows"][0]["cells"][0]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            ["graphemes", "style"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
        );
    }
}
