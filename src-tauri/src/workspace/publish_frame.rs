use tauri::ipc::InvokeBody;

use crate::error::CommandError;
use crate::path_policy::{RelativePath, MAX_RELATIVE_PATH_BYTES};

use super::version::MAX_VERSIONED_FILE_BYTES;
use super::RootId;

const PLN1_MAGIC: &[u8; 4] = b"PLN1";
const PLN1_HEADER_BYTES: usize = 12;
const ROOT_ID_BYTES: usize = 36;

pub(crate) struct WorkspacePublishFileFrame {
    root_id: RootId,
    relative_path: RelativePath,
    content: Vec<u8>,
}

impl std::fmt::Debug for WorkspacePublishFileFrame {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkspacePublishFileFrame")
            .field("root_id", &self.root_id)
            .field("relative_path", &self.relative_path)
            .field("content_length", &self.content.len())
            .finish_non_exhaustive()
    }
}

impl WorkspacePublishFileFrame {
    pub(crate) fn parse_invoke_body(body: &InvokeBody) -> Result<Self, CommandError> {
        match body {
            InvokeBody::Raw(bytes) => Self::parse(bytes),
            InvokeBody::Json(_) => Err(invalid_publish_request()),
        }
    }

    pub(crate) fn parse(frame: &[u8]) -> Result<Self, CommandError> {
        if frame.len() < PLN1_HEADER_BYTES || &frame[..4] != PLN1_MAGIC {
            return Err(invalid_publish_request());
        }
        let root_id_length = usize::from(read_u16(frame, 4)?);
        let path_length = usize::from(read_u16(frame, 6)?);
        let content_length =
            usize::try_from(read_u32(frame, 8)?).map_err(|_| invalid_publish_request())?;
        if root_id_length != ROOT_ID_BYTES
            || path_length == 0
            || path_length > MAX_RELATIVE_PATH_BYTES
        {
            return Err(invalid_publish_request());
        }
        if content_length > MAX_VERSIONED_FILE_BYTES as usize {
            return Err(file_too_large());
        }
        let root_id_end = PLN1_HEADER_BYTES
            .checked_add(root_id_length)
            .ok_or_else(invalid_publish_request)?;
        let path_end = root_id_end
            .checked_add(path_length)
            .ok_or_else(invalid_publish_request)?;
        let frame_end = path_end
            .checked_add(content_length)
            .ok_or_else(invalid_publish_request)?;
        if frame_end != frame.len() {
            return Err(invalid_publish_request());
        }
        let root_wire = std::str::from_utf8(&frame[PLN1_HEADER_BYTES..root_id_end])
            .map_err(|_| invalid_publish_request())?;
        let path_wire = std::str::from_utf8(&frame[root_id_end..path_end])
            .map_err(|_| invalid_publish_request())?;
        let root_id = RootId::parse_v4_wire(root_wire).map_err(|_| invalid_publish_request())?;
        let relative_path =
            RelativePath::parse_wire(path_wire).map_err(|_| invalid_publish_request())?;
        if relative_path.is_root() {
            return Err(invalid_publish_request());
        }
        Ok(Self {
            root_id,
            relative_path,
            content: frame[path_end..].to_vec(),
        })
    }

    pub(crate) fn into_parts(self) -> (RootId, RelativePath, Vec<u8>) {
        (self.root_id, self.relative_path, self.content)
    }
}

fn read_u16(frame: &[u8], offset: usize) -> Result<u16, CommandError> {
    let end = offset.checked_add(2).ok_or_else(invalid_publish_request)?;
    let bytes = frame.get(offset..end).ok_or_else(invalid_publish_request)?;
    Ok(u16::from_be_bytes(
        bytes.try_into().map_err(|_| invalid_publish_request())?,
    ))
}

fn read_u32(frame: &[u8], offset: usize) -> Result<u32, CommandError> {
    let end = offset.checked_add(4).ok_or_else(invalid_publish_request)?;
    let bytes = frame.get(offset..end).ok_or_else(invalid_publish_request)?;
    Ok(u32::from_be_bytes(
        bytes.try_into().map_err(|_| invalid_publish_request())?,
    ))
}

fn invalid_publish_request() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_PUBLISH_REQUEST",
        "The workspace publish request is invalid.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported write limit.",
    )
}

#[cfg(test)]
mod tests {
    use super::{WorkspacePublishFileFrame, PLN1_HEADER_BYTES};

    const ROOT: &str = "00000000-0000-4000-8000-000000000001";

    fn encode(path: &str, content: &[u8]) -> Vec<u8> {
        let mut frame = Vec::new();
        frame.extend_from_slice(b"PLN1");
        frame.extend_from_slice(&(ROOT.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(path.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(content.len() as u32).to_be_bytes());
        frame.extend_from_slice(ROOT.as_bytes());
        frame.extend_from_slice(path.as_bytes());
        frame.extend_from_slice(content);
        frame
    }

    #[test]
    fn round_trips_a_valid_new_file_publication() {
        let (root, path, content) =
            WorkspacePublishFileFrame::parse(&encode("drafts/新文件.txt", b"exact bytes"))
                .unwrap()
                .into_parts();
        assert_eq!(root.as_wire(), ROOT);
        assert_eq!(path.as_wire(), "drafts/新文件.txt");
        assert_eq!(content, b"exact bytes");
    }

    #[test]
    fn rejects_malformed_or_escaping_frames() {
        let golden = encode("new.txt", b"bytes");
        let mut bad_magic = golden.clone();
        bad_magic[0] = b'X';
        let mut bad_length = golden.clone();
        bad_length[7] = 0xff;
        for invalid in [
            golden[..PLN1_HEADER_BYTES - 1].to_vec(),
            bad_magic,
            bad_length,
            encode("../escape", b"bytes"),
            encode("", b"bytes"),
        ] {
            assert!(WorkspacePublishFileFrame::parse(&invalid).is_err());
        }
    }
}
