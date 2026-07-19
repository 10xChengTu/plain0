use tauri::ipc::InvokeBody;

use crate::error::CommandError;
use crate::path_policy::{RelativePath, MAX_RELATIVE_PATH_BYTES};

use super::version::{is_version_token, MAX_VERSIONED_FILE_BYTES, VERSION_TOKEN_BYTES};
use super::RootId;

const PLW1_MAGIC: &[u8; 4] = b"PLW1";
const PLW1_HEADER_BYTES: usize = 14;
const ROOT_ID_BYTES: usize = 36;

pub(crate) struct WorkspaceWriteFileFrame {
    root_id: RootId,
    relative_path: RelativePath,
    expected_version: String,
    content: Vec<u8>,
}

impl std::fmt::Debug for WorkspaceWriteFileFrame {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkspaceWriteFileFrame")
            .field("root_id", &self.root_id)
            .field("relative_path", &self.relative_path)
            .field("content_length", &self.content.len())
            .finish_non_exhaustive()
    }
}

impl WorkspaceWriteFileFrame {
    pub(crate) fn parse_invoke_body(body: &InvokeBody) -> Result<Self, CommandError> {
        match body {
            InvokeBody::Raw(bytes) => Self::parse(bytes),
            InvokeBody::Json(_) => Err(invalid_write_request()),
        }
    }

    pub(crate) fn parse(frame: &[u8]) -> Result<Self, CommandError> {
        if frame.len() < PLW1_HEADER_BYTES || &frame[..4] != PLW1_MAGIC {
            return Err(invalid_write_request());
        }

        let root_id_length = usize::from(read_u16(frame, 4)?);
        let path_length = usize::from(read_u16(frame, 6)?);
        let version_length = usize::from(read_u16(frame, 8)?);
        let content_length =
            usize::try_from(read_u32(frame, 10)?).map_err(|_| invalid_write_request())?;

        if root_id_length != ROOT_ID_BYTES
            || path_length == 0
            || path_length > MAX_RELATIVE_PATH_BYTES
            || version_length != VERSION_TOKEN_BYTES
        {
            return Err(invalid_write_request());
        }
        if content_length > MAX_VERSIONED_FILE_BYTES as usize {
            return Err(file_too_large());
        }

        let root_id_end = PLW1_HEADER_BYTES
            .checked_add(root_id_length)
            .ok_or_else(invalid_write_request)?;
        let path_end = root_id_end
            .checked_add(path_length)
            .ok_or_else(invalid_write_request)?;
        let version_end = path_end
            .checked_add(version_length)
            .ok_or_else(invalid_write_request)?;
        let frame_end = version_end
            .checked_add(content_length)
            .ok_or_else(invalid_write_request)?;
        if frame_end != frame.len() {
            return Err(invalid_write_request());
        }

        let root_id_wire = decode_utf8(&frame[PLW1_HEADER_BYTES..root_id_end])?;
        let path_wire = decode_utf8(&frame[root_id_end..path_end])?;
        let expected_version = decode_ascii(&frame[path_end..version_end])?;
        if !is_version_token(expected_version) {
            return Err(workspace_file_modified());
        }
        let root_id = RootId::parse_v4_wire(root_id_wire).map_err(|_| invalid_write_request())?;
        let relative_path =
            RelativePath::parse_wire(path_wire).map_err(|_| invalid_write_request())?;
        if relative_path.is_root() {
            return Err(invalid_write_request());
        }

        Ok(Self {
            root_id,
            relative_path,
            expected_version: expected_version.to_owned(),
            content: frame[version_end..].to_vec(),
        })
    }

    pub(crate) fn into_parts(self) -> (RootId, RelativePath, String, Vec<u8>) {
        (
            self.root_id,
            self.relative_path,
            self.expected_version,
            self.content,
        )
    }
}

fn read_u16(frame: &[u8], offset: usize) -> Result<u16, CommandError> {
    let end = offset.checked_add(2).ok_or_else(invalid_write_request)?;
    let bytes = frame.get(offset..end).ok_or_else(invalid_write_request)?;
    Ok(u16::from_be_bytes(
        bytes.try_into().map_err(|_| invalid_write_request())?,
    ))
}

fn read_u32(frame: &[u8], offset: usize) -> Result<u32, CommandError> {
    let end = offset.checked_add(4).ok_or_else(invalid_write_request)?;
    let bytes = frame.get(offset..end).ok_or_else(invalid_write_request)?;
    Ok(u32::from_be_bytes(
        bytes.try_into().map_err(|_| invalid_write_request())?,
    ))
}

fn decode_utf8(bytes: &[u8]) -> Result<&str, CommandError> {
    std::str::from_utf8(bytes).map_err(|_| invalid_write_request())
}

fn decode_ascii(bytes: &[u8]) -> Result<&str, CommandError> {
    if !bytes.is_ascii() {
        return Err(invalid_write_request());
    }
    decode_utf8(bytes)
}

fn invalid_write_request() -> CommandError {
    CommandError::new(
        "INVALID_WORKSPACE_WRITE_REQUEST",
        "The workspace write request is invalid.",
    )
}

fn file_too_large() -> CommandError {
    CommandError::new(
        "FILE_TOO_LARGE",
        "The workspace file exceeds the supported write limit.",
    )
}

fn workspace_file_modified() -> CommandError {
    CommandError::new(
        "WORKSPACE_FILE_MODIFIED",
        "The workspace file version is not a valid write baseline.",
    )
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceWriteFileFrame, PLW1_HEADER_BYTES};

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        root_id: String,
        relative_path: String,
        version: String,
        write: WriteFixture,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct WriteFixture {
        content_hex: String,
        frame_hex: String,
    }

    fn fixture() -> Fixture {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/workspace-version-v1.json"
        ))
        .unwrap()
    }

    #[test]
    fn plw1_parser_matches_the_shared_golden_fixture() {
        let fixture = fixture();
        let parsed = WorkspaceWriteFileFrame::parse(&decode_hex(&fixture.write.frame_hex)).unwrap();
        let (root_id, relative_path, expected_version, content) = parsed.into_parts();
        assert_eq!(root_id.as_wire(), fixture.root_id);
        assert_eq!(relative_path.as_wire(), fixture.relative_path);
        assert_eq!(expected_version, fixture.version);
        assert_eq!(content, decode_hex(&fixture.write.content_hex));
    }

    #[test]
    fn plw1_rejects_json_bodies_and_every_non_exact_envelope() {
        assert_eq!(
            WorkspaceWriteFileFrame::parse_invoke_body(&tauri::ipc::InvokeBody::Json(
                serde_json::json!({ "bytes": [] }),
            ))
            .unwrap_err()
            .code(),
            "INVALID_WORKSPACE_WRITE_REQUEST"
        );

        let fixture = fixture();
        let golden = decode_hex(&fixture.write.frame_hex);
        let mut cases = Vec::new();
        cases.push(golden[..PLW1_HEADER_BYTES - 1].to_vec());
        let mut bad_magic = golden.clone();
        bad_magic[0] = b'X';
        cases.push(bad_magic);
        let mut bad_root_length = golden.clone();
        bad_root_length[4..6].copy_from_slice(&35_u16.to_be_bytes());
        cases.push(bad_root_length);
        let mut empty_path = golden.clone();
        empty_path[6..8].copy_from_slice(&0_u16.to_be_bytes());
        cases.push(empty_path);
        let mut bad_version_length = golden.clone();
        bad_version_length[8..10].copy_from_slice(&67_u16.to_be_bytes());
        cases.push(bad_version_length);
        let mut extra_tail = golden.clone();
        extra_tail.push(0);
        cases.push(extra_tail);
        let mut truncated = golden.clone();
        truncated.pop();
        cases.push(truncated);

        for case in cases {
            assert_eq!(
                WorkspaceWriteFileFrame::parse(&case).unwrap_err().code(),
                "INVALID_WORKSPACE_WRITE_REQUEST"
            );
        }
    }

    #[test]
    fn plw1_rejects_non_v4_roots_invalid_paths_and_noncanonical_versions() {
        let fixture = fixture();
        for (root, path) in [
            (
                "00112233-4455-1677-8899-aabbccddeeff",
                fixture.relative_path.as_str(),
            ),
            (fixture.root_id.as_str(), "../private"),
        ] {
            let frame = encode(root, path, &fixture.version, b"");
            assert_eq!(
                WorkspaceWriteFileFrame::parse(&frame).unwrap_err().code(),
                "INVALID_WORKSPACE_WRITE_REQUEST"
            );
        }
        let frame = encode(
            &fixture.root_id,
            &fixture.relative_path,
            "wv1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            b"",
        );
        assert_eq!(
            WorkspaceWriteFileFrame::parse(&frame).unwrap_err().code(),
            "WORKSPACE_FILE_MODIFIED"
        );
    }

    #[test]
    fn plw1_accepts_zero_and_exact_limit_but_rejects_limit_plus_one() {
        let fixture = fixture();
        for length in [0, super::MAX_VERSIONED_FILE_BYTES as usize] {
            let content = vec![0x5a; length];
            let frame = encode(
                &fixture.root_id,
                &fixture.relative_path,
                &fixture.version,
                &content,
            );
            assert_eq!(
                WorkspaceWriteFileFrame::parse(&frame)
                    .unwrap()
                    .into_parts()
                    .3
                    .len(),
                length
            );
        }

        let oversized = vec![0; super::MAX_VERSIONED_FILE_BYTES as usize + 1];
        let frame = encode(
            &fixture.root_id,
            &fixture.relative_path,
            &fixture.version,
            &oversized,
        );
        assert_eq!(
            WorkspaceWriteFileFrame::parse(&frame).unwrap_err().code(),
            "FILE_TOO_LARGE"
        );
    }

    fn encode(root_id: &str, path: &str, version: &str, content: &[u8]) -> Vec<u8> {
        let mut frame = Vec::new();
        frame.extend_from_slice(b"PLW1");
        frame.extend_from_slice(&(root_id.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(path.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(version.len() as u16).to_be_bytes());
        frame.extend_from_slice(&(content.len() as u32).to_be_bytes());
        frame.extend_from_slice(root_id.as_bytes());
        frame.extend_from_slice(path.as_bytes());
        frame.extend_from_slice(version.as_bytes());
        frame.extend_from_slice(content);
        frame
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }
}
