use std::io::{Seek, SeekFrom, Write};

use cap_fs_ext::DirExt;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{unpack_directory, unpack_vsix};
use crate::theme::{MAX_THEME_ENTRY_BYTES, MAX_THEME_PACKAGE_ENTRIES};

fn open_temp_dir() -> (TempDir, Dir) {
    let temp = TempDir::new().expect("tempdir creates");
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
    (temp, dir)
}

/// A tiny builder over an in-memory `ZipWriter`. Every fixture in this file
/// is constructed here, in code — no binary zip fixture is ever committed.
struct ZipFixture {
    writer: ZipWriter<std::io::Cursor<Vec<u8>>>,
}

impl ZipFixture {
    fn new() -> Self {
        Self {
            writer: ZipWriter::new(std::io::Cursor::new(Vec::new())),
        }
    }

    fn add_file_with(
        &mut self,
        name: &str,
        contents: &[u8],
        method: CompressionMethod,
    ) -> &mut Self {
        self.writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(method),
            )
            .unwrap_or_else(|error| panic!("start_file({name}): {error}"));
        self.writer
            .write_all(contents)
            .expect("write file contents");
        self
    }

    fn add_file(&mut self, name: &str, contents: &[u8]) -> &mut Self {
        self.add_file_with(name, contents, CompressionMethod::Stored)
    }

    fn add_directory(&mut self, name: &str) -> &mut Self {
        self.writer
            .add_directory(name, SimpleFileOptions::default())
            .unwrap_or_else(|error| panic!("add_directory({name}): {error}"));
        self
    }

    /// Marks the entry as a symlink via the zip crate's dedicated symlink
    /// API, which sets the Unix external-attributes `S_IFLNK` file-type bits
    /// (`unix_permissions` alone only preserves permission bits and cannot
    /// denote a symlink) — matching how real archivers encode symlinks.
    fn add_symlink(&mut self, name: &str, target: &str) -> &mut Self {
        self.writer
            .add_symlink(name, target, SimpleFileOptions::default())
            .unwrap_or_else(|error| panic!("add_symlink({name}): {error}"));
        self
    }

    fn finish(self) -> Vec<u8> {
        self.writer.finish().expect("finish").into_inner()
    }
}

/// Writes `bytes` to a freshly opened file in its own, throwaway ambient
/// directory — never inside the theme library root, matching the real
/// production shape where the source VSIX file comes from an arbitrary
/// user-picked location. Returns the owning `TempDir` alongside the open
/// `File`; the caller only needs to keep the guard alive for the duration
/// of the `unpack_vsix` call.
fn vsix_file(bytes: &[u8]) -> (TempDir, cap_std::fs::File) {
    let (temp, dir) = open_temp_dir();
    let mut options = cap_std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(true);
    let mut file = dir
        .open_with("package.vsix", &options)
        .expect("create vsix file");
    file.write_all(bytes).expect("write vsix bytes");
    file.seek(SeekFrom::Start(0)).expect("seek to start");
    (temp, file)
}

/// Every filesystem entry directly inside the theme library root, sorted.
/// Used to assert "no residue": on any rejected import the library root
/// must contain none of `.plain-theme-*.tmp` staging leftovers or the
/// package directory that was never actually published.
fn library_root_entries(temp: &TempDir) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(temp.path())
        .expect("read library root")
        .map(|entry| {
            entry
                .expect("dir entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

fn assert_error(result: Result<super::UnpackedTheme, crate::error::CommandError>, code: &str) {
    let error = result.expect_err("expected the import to be rejected");
    assert_eq!(error.code(), code);
}

// --- VSIX (zip) unpacking -------------------------------------------------

#[test]
fn round_trips_a_normal_small_package_and_ignores_non_extension_entries() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture
        .add_directory("extension/")
        .add_file("extension/package.json", br#"{"name":"demo"}"#)
        .add_directory("extension/themes/")
        .add_file("extension/themes/dark.json", b"{}")
        .add_file("README.md", b"not part of the theme")
        .add_file(".vsixmanifest", b"<manifest/>");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    let unpacked = unpack_vsix(&root, file).expect("unpack succeeds");
    assert_eq!(
        unpacked.files,
        vec!["package.json".to_owned(), "themes/dark.json".to_owned()]
    );

    let published = root
        .open_dir_nofollow(&unpacked.id)
        .expect("published package directory exists");
    assert!(published.is_file("package.json"));
    assert!(published.is_dir("themes"));
    assert!(published.is_file("themes/dark.json"));
    assert_eq!(
        published.read_to_string("package.json").unwrap(),
        r#"{"name":"demo"}"#
    );

    // The library root now contains exactly the published package: no
    // leftover staging directory.
    assert_eq!(library_root_entries(&temp), vec![unpacked.id]);
}

#[test]
fn empty_zip_unpacks_to_an_empty_published_package() {
    let (temp, root) = open_temp_dir();
    let bytes = ZipFixture::new().finish();
    let (_source, file) = vsix_file(&bytes);

    let unpacked = unpack_vsix(&root, file).expect("empty archive is not itself an error");
    assert!(unpacked.files.is_empty());
    assert_eq!(library_root_entries(&temp), vec![unpacked.id]);
}

#[test]
fn zip_with_no_entries_under_extension_prefix_publishes_an_empty_package() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture
        .add_file("README.md", b"hello")
        .add_file(".vsixmanifest", b"<manifest/>");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    let unpacked = unpack_vsix(&root, file).expect("unpack succeeds");
    assert!(unpacked.files.is_empty());
    assert_eq!(library_root_entries(&temp), vec![unpacked.id]);
}

#[test]
fn corrupt_archive_is_rejected_without_residue() {
    let (temp, root) = open_temp_dir();
    let (_source, file) = vsix_file(b"this is not a zip file at all");

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_CORRUPT");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn zip_slip_parent_dir_traversal_is_rejected_without_residue() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture.add_file("extension/../../../etc/passwd", b"pwned");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_UNSAFE_PATH");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn zip_slip_absolute_path_is_rejected_without_residue() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture.add_file("extension//etc/passwd", b"pwned");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_UNSAFE_PATH");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn zip_slip_windows_drive_letter_is_rejected_without_residue() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture.add_file("extension/C:/evil.dll", b"pwned");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_UNSAFE_PATH");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn symlink_entry_is_rejected_without_residue() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture
        .add_file("extension/package.json", b"{}")
        .add_symlink("extension/themes/evil-link.json", "/etc/passwd");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_UNSAFE_PATH");
    assert!(
        library_root_entries(&temp).is_empty(),
        "the successfully-written package.json entry must be rolled back too"
    );
}

#[test]
fn entry_at_exactly_the_byte_limit_is_accepted_and_one_byte_more_is_rejected() {
    let max_content = vec![0x5a_u8; MAX_THEME_ENTRY_BYTES as usize];
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture.add_file("extension/theme.json", &max_content);
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);
    let unpacked = unpack_vsix(&root, file).expect("exact limit is accepted");
    assert_eq!(unpacked.files, vec!["theme.json".to_owned()]);

    let (temp_over, root_over) = open_temp_dir();
    let mut over_content = max_content;
    over_content.push(0x5a);
    let mut fixture = ZipFixture::new();
    fixture.add_file("extension/theme.json", &over_content);
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);
    assert_error(unpack_vsix(&root_over, file), "THEME_PACKAGE_TOO_LARGE");
    assert!(library_root_entries(&temp_over).is_empty());
    drop(temp);
}

#[test]
fn too_many_entries_is_rejected_up_front() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    for index in 0..(MAX_THEME_PACKAGE_ENTRIES + 1) {
        fixture.add_file(&format!("extension/{index}.json"), b"{}");
    }
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_TOO_LARGE");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn aggregate_decompressed_bytes_over_the_package_cap_is_rejected_even_though_every_entry_is_individually_small(
) {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    // Each entry sits exactly at the per-entry cap (8 MiB); the ninth entry
    // pushes the running total from 64 MiB to 72 MiB, tripping the
    // whole-package cap even though no single entry ever exceeds its own
    // limit.
    let chunk = vec![0_u8; MAX_THEME_ENTRY_BYTES as usize];
    for index in 0..9 {
        fixture.add_file(&format!("extension/{index}.bin"), &chunk);
    }
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_TOO_LARGE");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn a_high_compression_ratio_zip_bomb_entry_is_rejected_without_exhausting_memory() {
    let (temp, root) = open_temp_dir();
    // 32 MiB of zero bytes compresses to only a few kilobytes under
    // Deflate, but must still be rejected once the *actual* decompressed
    // byte count crosses the per-entry cap: the streaming copy counts real
    // bytes read from the decompressor, never trusting the declared size
    // alone.
    let payload = vec![0_u8; 32 * 1_024 * 1_024];
    let mut fixture = ZipFixture::new();
    fixture.add_file_with("extension/bomb.json", &payload, CompressionMethod::Deflated);
    let bytes = fixture.finish();
    assert!(
        bytes.len() < 1_024 * 1_024,
        "fixture sanity: the archive itself must stay tiny (compressed size {})",
        bytes.len()
    );
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_TOO_LARGE");
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn staging_is_fully_cleaned_up_after_a_failure_partway_through_a_multi_entry_package() {
    let (temp, root) = open_temp_dir();
    let mut fixture = ZipFixture::new();
    fixture
        .add_directory("extension/")
        .add_file("extension/package.json", b"{}")
        .add_directory("extension/themes/")
        .add_file("extension/themes/dark.json", b"{}")
        .add_file("extension/themes/light.json", b"{}")
        // The failing entry lands after several successful writes, proving
        // cleanup unwinds everything already staged, not just the last step.
        .add_file("extension/../escape.json", b"pwned");
    let bytes = fixture.finish();
    let (_source, file) = vsix_file(&bytes);

    assert_error(unpack_vsix(&root, file), "THEME_PACKAGE_UNSAFE_PATH");
    assert!(
        library_root_entries(&temp).is_empty(),
        "no staging directory, package.json, or themes/ subtree may remain"
    );
}

// --- Directory import -----------------------------------------------------

#[test]
fn directory_import_round_trips_a_normal_small_package() {
    let (temp, root) = open_temp_dir();
    let source = TempDir::new().expect("source tempdir creates");
    std::fs::write(source.path().join("package.json"), br#"{"name":"demo"}"#).unwrap();
    std::fs::create_dir(source.path().join("themes")).unwrap();
    std::fs::write(source.path().join("themes").join("dark.json"), b"{}").unwrap();

    let unpacked = unpack_directory(&root, source.path()).expect("directory import succeeds");
    assert_eq!(
        unpacked.files,
        vec!["package.json".to_owned(), "themes/dark.json".to_owned()]
    );
    assert_eq!(library_root_entries(&temp), vec![unpacked.id]);
}

#[test]
fn directory_import_rejects_a_symlink_anywhere_in_the_source_tree() {
    let (temp, root) = open_temp_dir();
    let source = TempDir::new().expect("source tempdir creates");
    std::fs::write(source.path().join("package.json"), b"{}").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("/etc/passwd", source.path().join("evil-link")).unwrap();

    #[cfg(unix)]
    {
        assert_error(
            unpack_directory(&root, source.path()),
            "THEME_PACKAGE_UNSAFE_PATH",
        );
        assert!(library_root_entries(&temp).is_empty());
    }
    #[cfg(not(unix))]
    {
        let _ = (temp, root, source);
    }
}

#[test]
fn directory_import_rejects_an_oversized_file() {
    let (temp, root) = open_temp_dir();
    let source = TempDir::new().expect("source tempdir creates");
    let over = vec![0x5a_u8; MAX_THEME_ENTRY_BYTES as usize + 1];
    std::fs::write(source.path().join("huge.bin"), &over).unwrap();

    assert_error(
        unpack_directory(&root, source.path()),
        "THEME_PACKAGE_TOO_LARGE",
    );
    assert!(library_root_entries(&temp).is_empty());
}

#[test]
fn directory_import_rejects_too_many_entries() {
    let (temp, root) = open_temp_dir();
    let source = TempDir::new().expect("source tempdir creates");
    for index in 0..(MAX_THEME_PACKAGE_ENTRIES + 1) {
        std::fs::write(source.path().join(format!("{index}.json")), b"{}").unwrap();
    }

    assert_error(
        unpack_directory(&root, source.path()),
        "THEME_PACKAGE_TOO_LARGE",
    );
    assert!(library_root_entries(&temp).is_empty());
}
