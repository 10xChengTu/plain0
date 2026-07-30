//! Byte-level primitives shared by [`super::status`] and [`super::diff`]'s
//! `-z` parsers.
//!
//! # Why paths are bytes, not `String`
//!
//! A tracked file's name is not guaranteed to be valid UTF-8 on Linux (any
//! byte sequence except `NUL` and `/` is a legal filename there); `git`
//! itself never validates this and, under `-z`, emits the name's raw bytes
//! verbatim (see the module doc's "quoting" note below). Modeling a path as
//! `String` anywhere in this parsing pipeline would therefore either panic,
//! silently corrupt the bytes, or require rejecting an otherwise perfectly
//! valid repository state. [`GitPathBuf`] carries the raw bytes end to end;
//! [`GitPathBuf::to_wire_lossy`] is the *one* sanctioned place a lossy UTF-8
//! projection happens, and only because the Tauri IPC boundary this DTO
//! layer eventually crosses is JSON (which requires valid UTF-8) — this is a
//! genuine, documented information loss on a byte sequence that cannot
//! round-trip, not a cosmetic detail to wave away.
//!
//! # Why `-z` output is split on `NUL` only
//!
//! `git status --porcelain=v2 -z` / `git diff --name-status -z` / `git diff
//! --numstat -z` all disable path quoting entirely (independent of
//! `core.quotePath`) once `-z` is given, and a legal filename may itself
//! contain a literal LF byte — so `NUL` is the only byte these formats never
//! emit inside a field, and therefore the only safe record separator.
//! [`split_nul_records`] is the one place that split happens for both
//! parsers.

#[derive(Clone, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub(crate) struct GitPathBuf(Vec<u8>);

impl GitPathBuf {
    pub(crate) fn from_bytes(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Lossy UTF-8 projection for the wire/display boundary only — see the
    /// module doc's "Why paths are bytes" section. Never call this to make
    /// an internal comparison or lookup decision; compare [`GitPathBuf`]s
    /// (or their [`Self::as_bytes`]) directly instead, exactly like
    /// [`super::diff::merge_diff_files`] does when joining `--name-status`
    /// and `--numstat` records by path.
    pub(crate) fn to_wire_lossy(&self) -> String {
        String::from_utf8_lossy(&self.0).into_owned()
    }
}

impl std::fmt::Debug for GitPathBuf {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("GitPathBuf")
            .field(&String::from_utf8_lossy(&self.0))
            .finish()
    }
}

/// Splits a complete `-z` command output into its `NUL`-delimited records,
/// dropping the single empty trailing element the final terminating `NUL`
/// always produces (and returning zero records for empty output, rather
/// than one empty record).
pub(crate) fn split_nul_records(output: &[u8]) -> Vec<&[u8]> {
    if output.is_empty() {
        return Vec::new();
    }
    let mut records: Vec<&[u8]> = output.split(|&byte| byte == 0).collect();
    if records.last().is_some_and(|record| record.is_empty()) {
        records.pop();
    }
    records
}

/// Splits `record` on the first `count - 1` space (`0x20`) bytes, returning
/// exactly `count` fields whose *last* element is the untouched remainder —
/// including any further embedded spaces or literal LF bytes. This is how
/// every fixed-shape porcelain-v2/name-status record's trailing path field
/// is recovered without truncating a path that itself contains a space.
/// Returns `None` if `record` does not contain at least `count - 1` spaces.
pub(crate) fn split_n_fields(record: &[u8], count: usize) -> Option<Vec<&[u8]>> {
    debug_assert!(count > 0);
    let mut fields = Vec::with_capacity(count);
    let mut rest = record;
    for _ in 0..count - 1 {
        let space_index = rest.iter().position(|&byte| byte == b' ')?;
        fields.push(&rest[..space_index]);
        rest = &rest[space_index + 1..];
    }
    fields.push(rest);
    Some(fields)
}

#[cfg(test)]
mod tests {
    use super::{split_n_fields, split_nul_records, GitPathBuf};

    #[test]
    fn split_nul_records_drops_the_single_trailing_empty_element() {
        assert_eq!(
            split_nul_records(b"a\0b\0c\0"),
            vec![&b"a"[..], &b"b"[..], &b"c"[..]]
        );
    }

    #[test]
    fn split_nul_records_of_empty_output_is_zero_records() {
        assert_eq!(split_nul_records(b""), Vec::<&[u8]>::new());
    }

    #[test]
    fn split_nul_records_preserves_embedded_lf_bytes() {
        assert_eq!(
            split_nul_records(b"line\none\0plain\0"),
            vec![&b"line\none"[..], &b"plain"[..]]
        );
    }

    #[test]
    fn split_n_fields_captures_the_remainder_verbatim_including_spaces() {
        let record = b"1 M. N... 100644 100644 100644 aaa bbb path with spaces.txt";
        let fields = split_n_fields(record, 9).expect("9 fields present");
        assert_eq!(fields.len(), 9);
        assert_eq!(fields[0], b"1");
        assert_eq!(fields[8], b"path with spaces.txt");
    }

    #[test]
    fn split_n_fields_rejects_a_record_with_too_few_spaces() {
        assert!(split_n_fields(b"1 M.", 9).is_none());
    }

    #[test]
    fn git_path_buf_to_wire_lossy_replaces_invalid_utf8() {
        let path = GitPathBuf::from_bytes(vec![0xFF, 0xFE, b'a']);
        assert_eq!(path.to_wire_lossy(), "\u{FFFD}\u{FFFD}a");
    }

    #[test]
    fn git_path_buf_debug_does_not_panic_on_invalid_utf8() {
        let path = GitPathBuf::from_bytes(vec![0xFF]);
        assert!(format!("{path:?}").contains("GitPathBuf"));
    }
}
