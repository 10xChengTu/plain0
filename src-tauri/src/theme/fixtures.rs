//! Test-only fixture builders shared by `manifest`, `theme_json`, `record`
//! and `import`'s own test modules. Every fixture here is constructed in
//! code — no binary zip or `.tmTheme` file is ever committed — mirroring
//! `unpack::tests`'s own (private, S1-only) `ZipFixture`. This module is
//! deliberately separate from `unpack::tests` rather than a shared import
//! from it, so nothing here can ever perturb S1's already-frozen test
//! suite.

#![cfg(test)]

use std::io::{Seek, SeekFrom, Write};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use tempfile::TempDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Opens a fresh, empty ambient temp directory to stand in for the theme
/// library root. The returned `TempDir` must be kept alive for as long as
/// `Dir` is used.
pub(crate) fn open_temp_dir() -> (TempDir, Dir) {
    let temp = TempDir::new().expect("tempdir creates");
    let dir = Dir::open_ambient_dir(temp.path(), ambient_authority()).expect("open tempdir");
    (temp, dir)
}

/// A tiny builder over an in-memory `ZipWriter`, producing a VSIX-shaped
/// archive (every real entry lives under `extension/`).
pub(crate) struct PackageFixture {
    writer: ZipWriter<std::io::Cursor<Vec<u8>>>,
}

impl PackageFixture {
    pub(crate) fn new() -> Self {
        Self {
            writer: ZipWriter::new(std::io::Cursor::new(Vec::new())),
        }
    }

    /// Adds `extension/package.json` with the given (already-serialized)
    /// JSONC/JSON text.
    pub(crate) fn manifest(&mut self, contents: &str) -> &mut Self {
        self.file("package.json", contents.as_bytes())
    }

    /// Adds a file under `extension/`, `path` given relative to the
    /// extension root (no leading `extension/`).
    pub(crate) fn file(&mut self, path: &str, contents: &[u8]) -> &mut Self {
        let name = format!("extension/{path}");
        self.writer
            .start_file(
                &name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap_or_else(|error| panic!("start_file({name}): {error}"));
        self.writer
            .write_all(contents)
            .expect("write file contents");
        self
    }

    pub(crate) fn finish(self) -> Vec<u8> {
        self.writer.finish().expect("finish").into_inner()
    }
}

/// Writes `bytes` to a freshly opened file in its own, throwaway ambient
/// directory — never inside the theme library root, matching the real
/// production shape where the source VSIX file comes from an arbitrary
/// user-picked location.
pub(crate) fn vsix_source(bytes: &[u8]) -> (TempDir, cap_std::fs::File) {
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

/// A minimal, otherwise-valid manifest body: fill in `{themes}` with a
/// `contributes.themes` array literal (e.g. `r#"[{"uiTheme":"vs-dark","path":"./themes/dark.json"}]"#`).
pub(crate) fn minimal_manifest(themes_array: &str) -> String {
    format!(
        r#"{{
            "name": "demo-theme",
            "publisher": "demo-publisher",
            "version": "1.0.0",
            "engines": {{ "vscode": "^1.0.0" }},
            "contributes": {{ "themes": {themes_array} }}
        }}"#
    )
}

/// A minimal, valid JSON color theme document body (no `include`, no
/// `tokenColors`).
pub(crate) fn minimal_theme_json() -> &'static str {
    r##"{ "colors": { "editor.background": "#1f1f1f" } }"##
}

/// A minimal, structurally valid `.tmTheme` property list.
pub(crate) fn minimal_tmtheme() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>name</key>
    <string>Demo</string>
</dict>
</plist>"#
}
