use tauri::ipc::InvokeBody;

use crate::error::CommandError;

use super::{
    backup_too_large, backup_unavailable, invalid_backup_key, BackupKey, MAX_BACKUP_ENTRIES,
};

const PLBK_MAGIC: &[u8; 4] = b"PLBK";
const PLBK_HEADER_BYTES: usize = 9;
const PLBA_MAGIC: &[u8; 4] = b"PLBA";

/// The wire frame is capped at 8 MiB *including* its magic/length preamble
/// and key bytes, not just the content: a request that would otherwise carry
/// an 8 MiB payload plus header is rejected rather than silently accepted.
pub(crate) const MAX_BACKUP_FRAME_BYTES: usize = 8 * 1_024 * 1_024;

/// Parsed `backup_write` request body.
///
/// Layout: `PLBK` magic (4 bytes) + key length (1 byte) + content length
/// (4 bytes, big-endian) + key bytes + content bytes. There is no version
/// token: backup writes always publish over whatever previously existed for
/// the same key.
#[derive(Debug)]
pub(crate) struct BackupWriteFrame {
    key: BackupKey,
    content: Vec<u8>,
}

impl BackupWriteFrame {
    pub(crate) fn parse_invoke_body(body: &InvokeBody) -> Result<Self, CommandError> {
        match body {
            InvokeBody::Raw(bytes) => Self::parse(bytes),
            InvokeBody::Json(_) => Err(invalid_backup_key()),
        }
    }

    pub(crate) fn parse(frame: &[u8]) -> Result<Self, CommandError> {
        if frame.len() > MAX_BACKUP_FRAME_BYTES {
            return Err(backup_too_large());
        }
        if frame.len() < PLBK_HEADER_BYTES || &frame[..4] != PLBK_MAGIC {
            return Err(invalid_backup_key());
        }

        let key_len = usize::from(frame[4]);
        let content_len_bytes: [u8; 4] =
            frame[5..9].try_into().map_err(|_| invalid_backup_key())?;
        let content_len = usize::try_from(u32::from_be_bytes(content_len_bytes))
            .map_err(|_| invalid_backup_key())?;

        if key_len == 0 {
            return Err(invalid_backup_key());
        }
        let key_end = PLBK_HEADER_BYTES
            .checked_add(key_len)
            .ok_or_else(invalid_backup_key)?;
        let frame_end = key_end
            .checked_add(content_len)
            .ok_or_else(invalid_backup_key)?;
        if frame_end != frame.len() {
            return Err(invalid_backup_key());
        }

        let key_wire = std::str::from_utf8(&frame[PLBK_HEADER_BYTES..key_end])
            .map_err(|_| invalid_backup_key())?;
        let key = BackupKey::parse(key_wire)?;

        Ok(Self {
            key,
            content: frame[key_end..].to_vec(),
        })
    }

    pub(crate) fn into_parts(self) -> (BackupKey, Vec<u8>) {
        (self.key, self.content)
    }
}

/// Encodes the `backup_read_all` response as a single raw frame instead of a
/// JSON array of byte arrays, matching the project's existing convention for
/// bulk binary IPC payloads (see `write_frame.rs`/`PLR1`).
///
/// Layout: `PLBA` magic (4 bytes) + entry count (4 bytes, big-endian), then
/// for each entry: key length (1 byte) + content length (4 bytes,
/// big-endian) + key bytes + content bytes.
pub(crate) fn encode_read_all_frame(
    entries: &[(String, Vec<u8>)],
) -> Result<Vec<u8>, CommandError> {
    if entries.len() > MAX_BACKUP_ENTRIES {
        return Err(backup_unavailable());
    }
    let entry_count = u32::try_from(entries.len()).map_err(|_| backup_unavailable())?;

    let mut frame = Vec::new();
    frame.extend_from_slice(PLBA_MAGIC);
    frame.extend_from_slice(&entry_count.to_be_bytes());
    for (key, content) in entries {
        let key_bytes = key.as_bytes();
        let key_len = u8::try_from(key_bytes.len()).map_err(|_| backup_unavailable())?;
        let content_len = u32::try_from(content.len()).map_err(|_| backup_unavailable())?;
        if key_bytes.is_empty() {
            return Err(backup_unavailable());
        }
        frame.push(key_len);
        frame.extend_from_slice(&content_len.to_be_bytes());
        frame.extend_from_slice(key_bytes);
        frame.extend_from_slice(content);
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::{
        encode_read_all_frame, BackupWriteFrame, MAX_BACKUP_FRAME_BYTES, PLBK_HEADER_BYTES,
    };

    fn encode(key: &str, content: &[u8]) -> Vec<u8> {
        let mut frame = Vec::new();
        frame.extend_from_slice(b"PLBK");
        frame.push(key.len() as u8);
        frame.extend_from_slice(&(content.len() as u32).to_be_bytes());
        frame.extend_from_slice(key.as_bytes());
        frame.extend_from_slice(content);
        frame
    }

    #[test]
    fn round_trips_a_valid_frame() {
        let frame = encode("abc-123", b"hello world");
        let parsed = BackupWriteFrame::parse(&frame).expect("valid frame parses");
        let (key, content) = parsed.into_parts();
        assert_eq!(key.as_str(), "abc-123");
        assert_eq!(content, b"hello world");
    }

    #[test]
    fn accepts_zero_length_content() {
        let frame = encode("k", b"");
        let (key, content) = BackupWriteFrame::parse(&frame).unwrap().into_parts();
        assert_eq!(key.as_str(), "k");
        assert!(content.is_empty());
    }

    #[test]
    fn rejects_malformed_envelopes() {
        let golden = encode("abc-123", b"hello world");
        let mut cases = Vec::new();
        cases.push(golden[..PLBK_HEADER_BYTES - 1].to_vec());
        let mut bad_magic = golden.clone();
        bad_magic[0] = b'X';
        cases.push(bad_magic);
        let mut zero_key = golden.clone();
        zero_key[4] = 0;
        cases.push(zero_key);
        let mut truncated = golden.clone();
        truncated.pop();
        cases.push(truncated);
        let mut extra_tail = golden.clone();
        extra_tail.push(0);
        cases.push(extra_tail);
        cases.push(encode("ABC", b"x"));
        let mut non_utf8_key = golden.clone();
        non_utf8_key[PLBK_HEADER_BYTES] = 0xff;
        cases.push(non_utf8_key);

        for case in cases {
            assert_eq!(
                BackupWriteFrame::parse(&case).unwrap_err().code(),
                "INVALID_BACKUP_KEY"
            );
        }
    }

    #[test]
    fn accepts_the_exact_frame_limit_but_rejects_one_byte_more() {
        let key = "k";
        let header_and_key = PLBK_HEADER_BYTES + key.len();
        let max_content = MAX_BACKUP_FRAME_BYTES - header_and_key;
        let frame = encode(key, &vec![0x5a; max_content]);
        assert_eq!(frame.len(), MAX_BACKUP_FRAME_BYTES);
        assert!(BackupWriteFrame::parse(&frame).is_ok());

        let oversized = encode(key, &vec![0x5a; max_content + 1]);
        assert_eq!(oversized.len(), MAX_BACKUP_FRAME_BYTES + 1);
        assert_eq!(
            BackupWriteFrame::parse(&oversized).unwrap_err().code(),
            "BACKUP_TOO_LARGE"
        );
    }

    #[test]
    fn read_all_frame_round_trips_multiple_entries_in_encoded_order() {
        let entries = vec![
            ("alpha".to_owned(), b"one".to_vec()),
            ("beta".to_owned(), b"two-two".to_vec()),
            ("gamma".to_owned(), Vec::new()),
        ];
        let frame = encode_read_all_frame(&entries).expect("entries encode");
        assert_eq!(&frame[..4], b"PLBA");
        assert_eq!(u32::from_be_bytes(frame[4..8].try_into().unwrap()), 3);

        let mut offset = 8;
        for (expected_key, expected_content) in &entries {
            let key_len = frame[offset] as usize;
            offset += 1;
            let content_len =
                u32::from_be_bytes(frame[offset..offset + 4].try_into().unwrap()) as usize;
            offset += 4;
            let key = std::str::from_utf8(&frame[offset..offset + key_len]).unwrap();
            offset += key_len;
            let content = &frame[offset..offset + content_len];
            offset += content_len;
            assert_eq!(key, expected_key);
            assert_eq!(content, expected_content.as_slice());
        }
        assert_eq!(offset, frame.len());
    }

    #[test]
    fn read_all_frame_rejects_more_than_the_bounded_entry_count() {
        let entries: Vec<(String, Vec<u8>)> = (0..(super::super::MAX_BACKUP_ENTRIES + 1))
            .map(|index| (format!("k{index}"), Vec::new()))
            .collect();
        assert_eq!(
            encode_read_all_frame(&entries).unwrap_err().code(),
            "BACKUP_UNAVAILABLE"
        );
    }
}
