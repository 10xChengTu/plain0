use tauri::ipc::InvokeBody;

use crate::error::CommandError;

use super::{
    invalid_scratch_id, invalid_scratch_request, scratch_too_large, scratch_unavailable, ScratchId,
    MAX_SCRATCH_ENTRIES, MAX_SCRATCH_ENTRY_BYTES,
};

const SCRATCH_ID_BYTES: usize = 36;
const PSW1_MAGIC: &[u8; 4] = b"PSW1";
const PSW1_HEADER_BYTES: usize = 4 + SCRATCH_ID_BYTES + 4;
const PSL1_MAGIC: &[u8; 4] = b"PSL1";
pub(crate) const MAX_SCRATCH_FRAME_BYTES: usize = 8 * 1_024 * 1_024;

#[derive(Debug)]
pub(crate) struct ScratchWriteFrame {
    scratch_id: ScratchId,
    content: Vec<u8>,
}

impl ScratchWriteFrame {
    pub(crate) fn parse_invoke_body(body: &InvokeBody) -> Result<Self, CommandError> {
        match body {
            InvokeBody::Raw(bytes) => Self::parse(bytes),
            InvokeBody::Json(_) => Err(invalid_scratch_request()),
        }
    }

    pub(crate) fn parse(frame: &[u8]) -> Result<Self, CommandError> {
        if frame.len() > MAX_SCRATCH_FRAME_BYTES {
            return Err(scratch_too_large());
        }
        if frame.len() < PSW1_HEADER_BYTES || &frame[..4] != PSW1_MAGIC {
            return Err(invalid_scratch_request());
        }
        let id_wire = std::str::from_utf8(&frame[4..4 + SCRATCH_ID_BYTES])
            .map_err(|_| invalid_scratch_id())?;
        let scratch_id = ScratchId::parse_v4_wire(id_wire)?;
        let content_len = usize::try_from(u32::from_be_bytes(
            frame[4 + SCRATCH_ID_BYTES..PSW1_HEADER_BYTES]
                .try_into()
                .map_err(|_| invalid_scratch_request())?,
        ))
        .map_err(|_| invalid_scratch_request())?;
        let frame_end = PSW1_HEADER_BYTES
            .checked_add(content_len)
            .ok_or_else(invalid_scratch_request)?;
        if frame_end != frame.len() {
            return Err(invalid_scratch_request());
        }
        Ok(Self {
            scratch_id,
            content: frame[PSW1_HEADER_BYTES..].to_vec(),
        })
    }

    pub(crate) fn into_parts(self) -> (ScratchId, Vec<u8>) {
        (self.scratch_id, self.content)
    }
}

pub(crate) fn encode_read_all_frame(
    entries: &[(ScratchId, Vec<u8>)],
) -> Result<Vec<u8>, CommandError> {
    if entries.len() > MAX_SCRATCH_ENTRIES {
        return Err(scratch_unavailable());
    }
    let entry_count = u32::try_from(entries.len()).map_err(|_| scratch_unavailable())?;
    let mut frame = Vec::new();
    frame.extend_from_slice(PSL1_MAGIC);
    frame.extend_from_slice(&entry_count.to_be_bytes());
    for (scratch_id, content) in entries {
        if content.len() > MAX_SCRATCH_ENTRY_BYTES {
            return Err(scratch_unavailable());
        }
        let id_wire = scratch_id.as_wire();
        debug_assert_eq!(id_wire.len(), SCRATCH_ID_BYTES);
        let content_len = u32::try_from(content.len()).map_err(|_| scratch_unavailable())?;
        frame.extend_from_slice(id_wire.as_bytes());
        frame.extend_from_slice(&content_len.to_be_bytes());
        frame.extend_from_slice(content);
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::{encode_read_all_frame, ScratchWriteFrame, PSW1_HEADER_BYTES};
    use crate::scratch::ScratchId;

    const SCRATCH_ID: &str = "00000000-0000-4000-8000-000000000001";

    fn encode(content: &[u8]) -> Vec<u8> {
        let mut frame = Vec::new();
        frame.extend_from_slice(b"PSW1");
        frame.extend_from_slice(SCRATCH_ID.as_bytes());
        frame.extend_from_slice(&(content.len() as u32).to_be_bytes());
        frame.extend_from_slice(content);
        frame
    }

    #[test]
    fn write_frame_round_trips_content_and_id() {
        let (scratch_id, content) = ScratchWriteFrame::parse(&encode(b"draft"))
            .unwrap()
            .into_parts();
        assert_eq!(scratch_id.as_wire(), SCRATCH_ID);
        assert_eq!(content, b"draft");
    }

    #[test]
    fn write_frame_rejects_malformed_envelopes() {
        let golden = encode(b"draft");
        let mut bad_magic = golden.clone();
        bad_magic[0] = b'X';
        let mut bad_length = golden.clone();
        bad_length[PSW1_HEADER_BYTES - 1] = 0xff;
        let mut bad_id = golden.clone();
        bad_id[4] = b'X';
        for invalid in [
            golden[..PSW1_HEADER_BYTES - 1].to_vec(),
            bad_magic,
            bad_length,
            bad_id,
        ] {
            assert!(ScratchWriteFrame::parse(&invalid).is_err());
        }
    }

    #[test]
    fn read_all_frame_uses_ids_and_exact_lengths() {
        let id = ScratchId::parse_v4_wire(SCRATCH_ID).unwrap();
        let frame = encode_read_all_frame(&[(id, b"one".to_vec())]).unwrap();
        assert_eq!(&frame[..4], b"PSL1");
        assert_eq!(u32::from_be_bytes(frame[4..8].try_into().unwrap()), 1);
        assert_eq!(&frame[8..44], SCRATCH_ID.as_bytes());
        assert_eq!(u32::from_be_bytes(frame[44..48].try_into().unwrap()), 3);
        assert_eq!(&frame[48..], b"one");
    }
}
