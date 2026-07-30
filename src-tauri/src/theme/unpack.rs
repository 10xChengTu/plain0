//! Bounded, capability-relative unpacking of a theme package (VSIX zip or an
//! already-unpacked directory) into the theme package library.
//!
//! Both entry points build a private, high-entropy staging directory inside
//! the library root, fill it under strict per-entry/aggregate limits, then
//! rename it into place as the final package directory. Any failure at any
//! point — corrupt archive, unsafe path, oversized entry, oversized package —
//! leaves no half-finished package: the staging directory and everything
//! written into it are removed by `Staging`'s `Drop` guard, exactly mirroring
//! `backup::store::Stage` and `workspace::directory_copy::StagedTree`.
//!
//! `unpack_vsix`/`unpack_directory` finalize a package under a fresh random
//! id (`Uuid::new_v4`) — a standalone, fully self-contained unpack that
//! never looks at `extension/package.json` at all, kept exactly as S1 left
//! it (and still covered by S1's own test suite below) for its own sake as
//! "safe bytes landed in a package directory, nothing more".
//!
//! `F050` S2's import pipeline (`theme::import`) does not call either of
//! those two functions: it calls the lower-level [`stage_vsix`]/
//! [`stage_directory`] instead, which do everything the S1 functions do
//! *except* the final publish rename. This keeps exactly one `Staging`
//! session alive across unpack → manifest parse → theme JSON validation,
//! so a validation failure is cleaned up by the very same tracked-entry
//! `Drop` guard S1 already relies on — never a second pass that has to
//! rediscover and delete an already-published, arbitrarily deep directory
//! tree. Only once every check has passed does `theme::import` rename the
//! still-staged tree directly into its final `publisher.name@version`
//! identity via [`Staging::publish_as`].

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, DirBuilder, DirBuilderExt, File, OpenOptions};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::CommandError;
use crate::path_policy::RelativePath;

use super::{
    theme_io_failed, theme_package_already_imported, theme_package_corrupt,
    theme_package_too_large, theme_package_unsafe_path, theme_stage_cleanup_failed,
    EXTENSION_PREFIX, MAX_STAGING_ATTEMPTS, MAX_THEME_ENTRY_BYTES, MAX_THEME_ENTRY_NAME_BYTES,
    MAX_THEME_PACKAGE_BYTES, MAX_THEME_PACKAGE_ENTRIES, STAGE_PREFIX,
};

const COPY_BUFFER_BYTES: usize = 64 * 1_024;

/// The result of successfully unpacking and publishing a theme package.
///
/// `F050` S3 note: neither this type nor [`unpack_vsix`]/
/// [`unpack_directory`]/[`Staging::publish`] below are reachable from any
/// production call path any more — `theme::import` (S2) publishes under the
/// package's real semantic identity via [`Staging::publish_as`] instead (see
/// this module's own top-level doc comment for why). They are kept,
/// deliberately unremoved, purely as what S1 already described as "safe
/// bytes landed in a package directory, nothing more" — a standalone,
/// self-contained unpack this module's own (frozen, S1-authored) test suite
/// below continues to exercise directly. `dead_code` is allowed narrowly on
/// this cluster rather than the whole module, so any *other* genuinely dead
/// code introduced here later is still caught.
#[derive(Debug, Eq, PartialEq)]
#[allow(dead_code)]
pub(crate) struct UnpackedTheme {
    /// The placeholder package directory id (see module docs).
    pub(crate) id: String,
    /// Every extracted file's package-relative wire path (`/`-separated,
    /// `extension/`-stripped for VSIX), sorted. Directories are not listed;
    /// they are implied by their files' paths.
    pub(crate) files: Vec<String>,
}

/// Safely unpacks an already-opened VSIX (zip) file into a fresh package
/// directory under `root` (the theme library root).
#[allow(dead_code)]
pub(crate) fn unpack_vsix(root: &Dir, source: File) -> Result<UnpackedTheme, CommandError> {
    let (staged, files) = stage_vsix(root, source)?;
    staged.publish(files)
}

/// Builds a validated, staged package tree from an already-opened VSIX
/// (zip) file, without publishing it. See the module docs for why `F050`
/// S2's import pipeline uses this instead of [`unpack_vsix`].
pub(crate) fn stage_vsix(
    root: &Dir,
    mut source: File,
) -> Result<(Staging<'_>, Vec<String>), CommandError> {
    source
        .seek(SeekFrom::Start(0))
        .map_err(|_| theme_io_failed())?;
    let mut archive = ZipArchive::new(source).map_err(|_| theme_package_corrupt())?;
    if archive.len() > MAX_THEME_PACKAGE_ENTRIES {
        return Err(theme_package_too_large());
    }

    let mut staged = Staging::create(root)?;
    let mut aggregate_bytes = 0_u64;
    let mut files = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| theme_package_corrupt())?;

        // `enclosed_name()` returning `None` means the entry cannot be
        // resolved to any path inside the extraction root at all (for
        // example an entry with more `..` segments than it has leading
        // components). `is_symlink()` is the zip format's only channel for
        // "this entry should become a symlink on extraction" (a Unix mode
        // external attribute bit); rejecting it outright means we never
        // create a filesystem symlink from untrusted archive content.
        if entry.enclosed_name().is_none() || entry.is_symlink() {
            return Err(theme_package_unsafe_path());
        }

        let is_directory_entry = entry.is_dir();
        let raw_name = entry.name();
        let Some(stripped) = raw_name.strip_prefix(EXTENSION_PREFIX) else {
            // Not under `extension/`: manifest sibling files (README,
            // CHANGELOG, `.vsixmanifest`, ...) are ignored, not rejected.
            continue;
        };
        let stripped = if is_directory_entry {
            stripped.strip_suffix('/').unwrap_or(stripped)
        } else {
            stripped
        };
        if stripped.is_empty() {
            // The bare `extension/` directory marker itself.
            continue;
        }

        let relative = validate_member_wire(stripped)?;

        if is_directory_entry {
            staged.ensure_directory(relative.as_path())?;
            continue;
        }

        // Fast, non-authoritative pre-check: a declared size already over
        // the cap lets us skip decompressing entirely. The authoritative
        // enforcement is the byte-counted streaming copy below, which does
        // not trust this (or any) declared size.
        if entry.size() > MAX_THEME_ENTRY_BYTES {
            return Err(theme_package_too_large());
        }

        let parent = relative.as_path().parent().unwrap_or(Path::new(""));
        staged.ensure_directory(parent)?;
        staged.write_file(relative.as_path(), &mut entry, &mut aggregate_bytes)?;
        files.push(relative.as_wire().to_owned());
    }

    files.sort();
    Ok((staged, files))
}

/// Safely copies an already-unpacked theme directory (picked by the user via
/// a directory picker, so an arbitrary ambient location — never one of the
/// process's authorized workspace roots) into a fresh package directory
/// under `root`. Shares every limit and the staging/publish machinery with
/// [`unpack_vsix`]; only the input enumeration differs.
#[allow(dead_code)]
pub(crate) fn unpack_directory(
    root: &Dir,
    source_path: &Path,
) -> Result<UnpackedTheme, CommandError> {
    let (staged, files) = stage_directory(root, source_path)?;
    staged.publish(files)
}

/// Builds a validated, staged package tree from an already-unpacked source
/// directory, without publishing it. See the module docs for why `F050` S2's
/// import pipeline uses this instead of [`unpack_directory`].
pub(crate) fn stage_directory<'root>(
    root: &'root Dir,
    source_path: &Path,
) -> Result<(Staging<'root>, Vec<String>), CommandError> {
    let source_root =
        Dir::open_ambient_dir(source_path, ambient_authority()).map_err(|_| theme_io_failed())?;

    let mut staged = Staging::create(root)?;
    let mut aggregate_bytes = 0_u64;
    let mut files = Vec::new();
    let mut entries_seen = 0_usize;

    struct Frame {
        dir: Dir,
        wire: String,
        names: Vec<String>,
        next: usize,
    }

    let root_names = collect_sorted_names(&source_root)?;
    let mut frames = vec![Frame {
        dir: source_root,
        wire: String::new(),
        names: root_names,
        next: 0,
    }];

    while let Some(frame) = frames.last_mut() {
        if frame.next == frame.names.len() {
            frames.pop();
            continue;
        }
        let name = frame.names[frame.next].clone();
        frame.next += 1;

        entries_seen = entries_seen
            .checked_add(1)
            .ok_or_else(theme_package_too_large)?;
        if entries_seen > MAX_THEME_PACKAGE_ENTRIES {
            return Err(theme_package_too_large());
        }

        let child_wire = if frame.wire.is_empty() {
            name.clone()
        } else {
            format!("{}/{name}", frame.wire)
        };
        // `RelativePath::parse_wire` bounds segment count at
        // `MAX_RELATIVE_PATH_SEGMENTS` (256), which doubles as this walk's
        // depth limit: a path that would exceed it is rejected before a new
        // frame is ever pushed.
        let relative = validate_member_wire(&child_wire)?;

        let metadata = frame
            .dir
            .symlink_metadata(Path::new(&name))
            .map_err(|_| theme_io_failed())?;
        if metadata.file_type().is_symlink() {
            return Err(theme_package_unsafe_path());
        }

        if metadata.is_dir() {
            staged.ensure_directory(relative.as_path())?;
            let child_dir = frame
                .dir
                .open_dir_nofollow(Path::new(&name))
                .map_err(|_| theme_io_failed())?;
            let child_names = collect_sorted_names(&child_dir)?;
            frames.push(Frame {
                dir: child_dir,
                wire: child_wire,
                names: child_names,
                next: 0,
            });
        } else if metadata.is_file() {
            if metadata.len() > MAX_THEME_ENTRY_BYTES {
                return Err(theme_package_too_large());
            }
            let parent = relative.as_path().parent().unwrap_or(Path::new(""));
            staged.ensure_directory(parent)?;
            let mut options = OpenOptions::new();
            options.read(true).follow(FollowSymlinks::No);
            let mut source_file = frame
                .dir
                .open_with(Path::new(&name), &options)
                .map_err(|_| theme_io_failed())?;
            staged.write_file(relative.as_path(), &mut source_file, &mut aggregate_bytes)?;
            files.push(relative.as_wire().to_owned());
        } else {
            return Err(theme_package_unsafe_path());
        }
    }

    files.sort();
    Ok((staged, files))
}

fn collect_sorted_names(dir: &Dir) -> Result<Vec<String>, CommandError> {
    let mut names = Vec::new();
    for entry in dir.entries().map_err(|_| theme_io_failed())? {
        let entry = entry.map_err(|_| theme_io_failed())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| theme_package_unsafe_path())?;
        if name.len() > MAX_THEME_ENTRY_NAME_BYTES {
            return Err(theme_package_unsafe_path());
        }
        names.push(name);
    }
    names.sort_unstable();
    Ok(names)
}

/// Validates a package-relative wire path shared by both unpack entry
/// points: reuses the workspace-relative path policy (rejects absolute
/// paths, `.`/`..` segments, NUL/backslash/colon, Windows-ambiguous
/// segments, and bounds total length and segment count) and additionally
/// enforces this domain's own per-segment byte cap.
fn validate_member_wire(wire: &str) -> Result<RelativePath, CommandError> {
    for segment in wire.split('/') {
        if segment.len() > MAX_THEME_ENTRY_NAME_BYTES {
            return Err(theme_package_unsafe_path());
        }
    }
    RelativePath::parse_wire(wire).map_err(|_| theme_package_unsafe_path())
}

/// One entry created inside a `Staging` tree, recorded in creation order so
/// cleanup can undo them in reverse (every child is always created after its
/// parent, so removing in reverse creation order always removes children
/// before the now-empty parent directory that contained them).
#[derive(Clone)]
struct CreatedEntry {
    parent: PathBuf,
    name: OsString,
    is_dir: bool,
}

/// A private, high-entropy staging directory inside the theme library root,
/// filled one validated member at a time and published with a single
/// rename. Every directory created (staging root included) is `0700`.
///
/// `pub(crate)` (rather than private to this module) so `theme::import` can
/// hold a still-active `Staging` across `manifest`/`theme_json` validation
/// before deciding whether to [`Staging::publish_as`] it or simply drop it —
/// see the module docs.
pub(crate) struct Staging<'root> {
    root: &'root Dir,
    stage_name: PathBuf,
    // Only read by the now-production-unreachable `publish` below — see
    // `UnpackedTheme`'s own doc comment for why this whole cluster stays.
    #[allow(dead_code)]
    id: String,
    /// Memoized open handles for every directory created so far, keyed by
    /// package-relative path (`""` is the staging root itself).
    dirs: HashMap<PathBuf, Dir>,
    created: Vec<CreatedEntry>,
    active: bool,
}

impl<'root> Staging<'root> {
    fn create(root: &'root Dir) -> Result<Self, CommandError> {
        for _ in 0..MAX_STAGING_ATTEMPTS {
            let id = Uuid::new_v4().simple().to_string();
            let stage_name = PathBuf::from(format!("{STAGE_PREFIX}{id}.tmp"));
            match create_private_directory(root, &stage_name) {
                Ok(()) => {
                    let stage_dir = root
                        .open_dir_nofollow(&stage_name)
                        .map_err(|_| theme_io_failed())?;
                    let mut dirs = HashMap::new();
                    dirs.insert(PathBuf::new(), stage_dir);
                    return Ok(Self {
                        root,
                        stage_name,
                        id,
                        dirs,
                        created: Vec::new(),
                        active: true,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(theme_io_failed()),
            }
        }
        Err(theme_io_failed())
    }

    /// Idempotently creates every missing directory along `relative`. A
    /// directory that already exists as a memoized entry is skipped; a name
    /// collision with a different entry kind (a file already occupying a
    /// directory's name, or vice versa) is rejected rather than silently
    /// reused.
    fn ensure_directory(&mut self, relative: &Path) -> Result<(), CommandError> {
        let mut walked = PathBuf::new();
        for component in relative.components() {
            let Component::Normal(segment) = component else {
                return Err(theme_package_unsafe_path());
            };
            let parent_key = walked.clone();
            walked.push(segment);
            if self.dirs.contains_key(&walked) {
                continue;
            }
            let parent = self
                .dirs
                .get(&parent_key)
                .ok_or_else(theme_package_unsafe_path)?;
            match create_private_directory(parent, Path::new(segment)) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    return Err(theme_package_unsafe_path());
                }
                Err(_) => return Err(theme_io_failed()),
            }
            let child = parent
                .open_dir_nofollow(Path::new(segment))
                .map_err(|_| theme_io_failed())?;
            self.created.push(CreatedEntry {
                parent: parent_key,
                name: segment.to_owned(),
                is_dir: true,
            });
            self.dirs.insert(walked.clone(), child);
        }
        Ok(())
    }

    /// Streams `reader` into a newly created file at `relative` (whose
    /// parent must already have been ensured), enforcing the per-entry cap
    /// against actual bytes read and folding them into `aggregate_bytes`
    /// against the whole-package cap. Both checks are against bytes that
    /// were actually produced by the reader, never a declared size.
    fn write_file(
        &mut self,
        relative: &Path,
        reader: &mut impl Read,
        aggregate_bytes: &mut u64,
    ) -> Result<(), CommandError> {
        let parent_key = relative.parent().unwrap_or(Path::new("")).to_path_buf();
        let name = relative.file_name().ok_or_else(theme_package_unsafe_path)?;
        let parent = self
            .dirs
            .get(&parent_key)
            .ok_or_else(theme_package_unsafe_path)?;

        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = parent.open_with(name, &options).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                theme_package_unsafe_path()
            } else {
                theme_io_failed()
            }
        })?;
        self.created.push(CreatedEntry {
            parent: parent_key,
            name: name.to_owned(),
            is_dir: false,
        });

        let mut buffer = [0_u8; COPY_BUFFER_BYTES];
        let mut entry_bytes = 0_u64;
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|_| theme_package_corrupt())?;
            if read == 0 {
                break;
            }
            entry_bytes = entry_bytes
                .checked_add(read as u64)
                .ok_or_else(theme_package_too_large)?;
            if entry_bytes > MAX_THEME_ENTRY_BYTES {
                return Err(theme_package_too_large());
            }
            *aggregate_bytes = aggregate_bytes
                .checked_add(read as u64)
                .ok_or_else(theme_package_too_large)?;
            if *aggregate_bytes > MAX_THEME_PACKAGE_BYTES {
                return Err(theme_package_too_large());
            }
            file.write_all(&buffer[..read])
                .map_err(|_| theme_io_failed())?;
        }
        Ok(())
    }

    /// Renames the fully built staging directory into place as `self.id`,
    /// consuming `self` so `Drop` becomes a no-op. An id collision (an
    /// astronomically unlikely UUIDv4 clash) mints a fresh id and retries
    /// rather than ever overwriting an existing package.
    #[allow(dead_code)]
    fn publish(mut self, files: Vec<String>) -> Result<UnpackedTheme, CommandError> {
        for _ in 0..MAX_STAGING_ATTEMPTS {
            match self.root.rename(&self.stage_name, self.root, &self.id) {
                Ok(()) => {
                    self.active = false;
                    return Ok(UnpackedTheme {
                        id: self.id.clone(),
                        files,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    self.id = Uuid::new_v4().simple().to_string();
                    continue;
                }
                Err(_) => return Err(theme_io_failed()),
            }
        }
        Err(theme_io_failed())
    }

    /// Renames the fully built staging directory into place as the caller's
    /// chosen `id` (the package's `publisher.name@version` semantic
    /// identity), consuming `self` so `Drop` becomes a no-op on success.
    ///
    /// Unlike [`Staging::publish`], an `id` collision is never raced past
    /// with a fresh id: a directory already present at that exact semantic
    /// identity means a genuine duplicate import, not an entropy collision,
    /// so it is rejected outright. On any error `self` is still dropped at
    /// the end of this call with `active` still `true`, so the normal
    /// tracked-entry cleanup removes everything this staging session wrote —
    /// the duplicate-import case leaves the *existing* published package
    /// completely untouched.
    pub(crate) fn publish_as(mut self, id: &str) -> Result<(), CommandError> {
        match self.root.rename(&self.stage_name, self.root, id) {
            Ok(()) => {
                self.active = false;
                Ok(())
            }
            // A rename onto an existing directory can surface as either
            // kind depending on the platform/filesystem: `AlreadyExists`
            // (e.g. an empty existing target on some platforms) or
            // `DirectoryNotEmpty` (confirmed the actual kind on macOS/most
            // Linux filesystems for a non-empty existing target — which a
            // genuinely already-published package directory always is,
            // since it holds at least `package.json` and this domain's own
            // stored record). Either way it means the exact same thing: a
            // package already lives at this semantic identity.
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
                ) =>
            {
                Err(theme_package_already_imported())
            }
            Err(_) => Err(theme_io_failed()),
        }
    }

    /// Opens an already-staged file for reading, nofollow. `relative` must
    /// name a file this same `Staging` session already wrote via
    /// [`Staging::write_file`] or [`Staging::write_new_file`] — its parent
    /// must therefore already be a memoized directory.
    pub(crate) fn open_file_read(&self, relative: &Path) -> Result<File, CommandError> {
        let parent_key = relative.parent().unwrap_or(Path::new("")).to_path_buf();
        let name = relative.file_name().ok_or_else(theme_package_unsafe_path)?;
        let parent = self
            .dirs
            .get(&parent_key)
            .ok_or_else(theme_package_unsafe_path)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        parent
            .open_with(name, &options)
            .map_err(|_| theme_io_failed())
    }

    /// Writes a brand-new, Plain-authored file (never attacker content — the
    /// only caller is `theme::import` writing its own serialized
    /// `manifest.plain.json` record) directly from an in-memory buffer.
    /// `create_new` means this also safely rejects the (extremely unlikely
    /// but not impossible) case of an unpacked package that already shipped
    /// its own same-named file at this path — that path fails the whole
    /// import rather than silently overwriting attacker-controlled content.
    pub(crate) fn write_new_file(
        &mut self,
        relative: &Path,
        contents: &[u8],
    ) -> Result<(), CommandError> {
        let parent_key = relative.parent().unwrap_or(Path::new("")).to_path_buf();
        let name = relative.file_name().ok_or_else(theme_package_unsafe_path)?;
        let parent = self
            .dirs
            .get(&parent_key)
            .ok_or_else(theme_package_unsafe_path)?;

        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut file = parent.open_with(name, &options).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                theme_package_unsafe_path()
            } else {
                theme_io_failed()
            }
        })?;
        self.created.push(CreatedEntry {
            parent: parent_key,
            name: name.to_owned(),
            is_dir: false,
        });
        file.write_all(contents).map_err(|_| theme_io_failed())?;
        Ok(())
    }

    /// Removes every entry this staging tree created, in reverse creation
    /// order, then the (now-empty) staging directory itself. Best-effort per
    /// entry so one stubborn removal does not stop the rest from being
    /// cleaned up.
    fn cleanup(&mut self) -> Result<(), CommandError> {
        let mut failed = false;
        for entry in self.created.iter().rev() {
            let Some(parent) = self.dirs.get(&entry.parent) else {
                failed = true;
                continue;
            };
            let result = if entry.is_dir {
                parent.remove_dir(&entry.name)
            } else {
                parent.remove_file(&entry.name)
            };
            if result.is_err() {
                failed = true;
            }
        }
        if self.root.remove_dir(&self.stage_name).is_err() {
            failed = true;
        }
        if failed {
            Err(theme_stage_cleanup_failed())
        } else {
            Ok(())
        }
    }
}

impl Drop for Staging<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = self.cleanup();
        }
    }
}

fn create_private_directory(parent: &Dir, name: &Path) -> io::Result<()> {
    let mut builder = DirBuilder::new();
    builder.mode(0o700);
    parent.create_dir_with(name, &builder)
}

#[cfg(test)]
mod tests;
