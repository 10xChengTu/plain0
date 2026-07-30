//! `refs::list_refs`/`refs::parse_refs`/`refs::classify_ref_name` contract
//! tests — every fixture spawns a *real* `git` binary, mirroring
//! `log::tests`'s/`blame::tests`'s own rationale for never hand-typing wire
//! bytes for an end-to-end assertion. Several tests below are *control-group*
//! fixtures: they run the same real repository through both a raw/differently
//! -flagged invocation and this domain's actual production path, and assert
//! the two genuinely differ (or genuinely agree, when the point is proving a
//! flag has *no* effect) — never merely that the chosen path happens to pass.

use std::path::Path;
use std::process::Command;

use tempfile::TempDir;

use super::{classify_ref_name, list_refs, parse_refs, RefGroupKind};
use crate::trust::service::TrustService;
use crate::workspace::dto::WorkspacePickRootsMode;
use crate::workspace::picker::{DirectoryPicker, DirectoryPickerFuture, DirectoryPickerResult};
use crate::workspace::service::WorkspaceService;

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

struct FakePicker {
    paths: Vec<std::path::PathBuf>,
}

impl DirectoryPicker for FakePicker {
    fn pick_directories(&self, _allow_multiple: bool) -> DirectoryPickerFuture<'_> {
        let paths = self.paths.clone();
        Box::pin(async move { Ok(DirectoryPickerResult::Selected(paths)) })
    }
}

fn trusted_workspace(
    window_label: &str,
    root: &Path,
    trust_base: &Path,
) -> (WorkspaceService, TrustService) {
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![root.to_path_buf()],
    };
    block_on(workspace.pick_roots(window_label, picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust = TrustService::new(trust_base.to_path_buf());
    block_on(trust.grant(&workspace, window_label)).expect("grant succeeds");
    (workspace, trust)
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .status()
        .is_ok_and(|status| status.success())
}

fn raw_git_ok(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Same shape as `raw_git_ok` but returns the completed process instead of
/// asserting success — used by control groups that expect a *failing*
/// invocation.
fn raw_git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git fixture command spawns")
}

fn head_sha(dir: &Path) -> String {
    String::from_utf8(raw_git(dir, &["rev-parse", "HEAD"]).stdout)
        .unwrap()
        .trim()
        .to_owned()
}

fn init_repo() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    raw_git_ok(dir.path(), &["init", "--quiet", "-b", "main"]);
    raw_git_ok(
        dir.path(),
        &["config", "user.email", "plain-test@example.invalid"],
    );
    raw_git_ok(dir.path(), &["config", "user.name", "Plain Test"]);
    dir
}

// --- list_refs: kinds, short names, upstream, HEAD, annotated vs. lightweight tags

/// One repository, fully wired with every ref shape this command cares about
/// at once: a local branch (the checked-out one, with an upstream), a real
/// `refs/remotes/*` entry (created the ordinary way, via a real local bare
/// "remote" and a real `git push`, never faked via a bare `update-ref`), a
/// lightweight tag, and an annotated tag.
struct RefsFixture {
    repo: TempDir,
    // Kept alive only for its own `TempDir` `Drop` (deletes the bare "remote"
    // clone on disk once the fixture itself goes out of scope) — never read
    // again after `build_refs_fixture` returns.
    #[allow(dead_code)]
    remote: TempDir,
    root_sha: String,
}

fn build_refs_fixture() -> RefsFixture {
    let repo = init_repo();
    std::fs::write(repo.path().join("a.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "a.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let root_sha = head_sha(repo.path());

    raw_git_ok(repo.path(), &["tag", "light-tag"]);
    raw_git_ok(
        repo.path(),
        &["tag", "-a", "annot-tag", "-m", "an annotated tag"],
    );

    let remote = TempDir::new().expect("tempdir");
    raw_git_ok(remote.path(), &["init", "--quiet", "--bare"]);
    raw_git_ok(
        repo.path(),
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    raw_git_ok(repo.path(), &["push", "--quiet", "origin", "main"]);
    raw_git_ok(
        repo.path(),
        &["branch", "--set-upstream-to=origin/main", "main"],
    );

    // A second local branch with no upstream at all — `list_refs` must model
    // this as `None`, not an empty-string sentinel.
    raw_git_ok(repo.path(), &["branch", "feature"]);

    RefsFixture {
        repo,
        remote,
        root_sha,
    }
}

#[test]
fn list_refs_lists_branches_tags_and_remotes_with_correct_kinds_and_short_names() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let fixture = build_refs_fixture();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", fixture.repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");
    assert!(!result.truncated);

    let find = |short: &str, kind: RefGroupKind| {
        result
            .entries
            .iter()
            .find(|entry| entry.short_name.as_bytes() == short.as_bytes() && entry.kind == kind)
            .unwrap_or_else(|| panic!("missing {kind:?} entry named {short:?}"))
    };

    let main = find("main", RefGroupKind::Branch);
    assert_eq!(main.full_name.as_bytes(), b"refs/heads/main");
    assert_eq!(main.target_sha, fixture.root_sha);
    assert!(!main.is_annotated_tag);
    assert_eq!(main.peeled_sha, None);

    let feature = find("feature", RefGroupKind::Branch);
    assert_eq!(
        feature.upstream, None,
        "an un-tracked branch has no upstream"
    );

    let remote = find("origin/main", RefGroupKind::RemoteBranch);
    assert_eq!(remote.full_name.as_bytes(), b"refs/remotes/origin/main");
    assert_eq!(remote.target_sha, fixture.root_sha);

    let light = find("light-tag", RefGroupKind::Tag);
    assert!(
        !light.is_annotated_tag,
        "a lightweight tag reports objecttype=commit"
    );
    assert_eq!(light.target_sha, fixture.root_sha);
    assert_eq!(
        light.peeled_sha, None,
        "a lightweight tag's *objectname is empty, modeled as None, not the same commit again"
    );

    let annot = find("annot-tag", RefGroupKind::Tag);
    assert!(
        annot.is_annotated_tag,
        "an annotated tag reports objecttype=tag"
    );
    assert_ne!(
        annot.target_sha, fixture.root_sha,
        "an annotated tag's own objectname is the tag object itself, not the commit"
    );
    assert_eq!(
        annot.peeled_sha.as_deref(),
        Some(fixture.root_sha.as_str()),
        "an annotated tag's *objectname is the commit it ultimately points at"
    );
}

#[test]
fn list_refs_distinguishes_an_annotated_tag_from_a_lightweight_tag() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // A narrower, single-purpose repeat of the assertion embedded in the
    // combined fixture above — kept as its own named test because this is
    // the exact scenario this module's own doc comment cites by name.
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let sha = head_sha(repo.path());
    raw_git_ok(repo.path(), &["tag", "light"]);
    raw_git_ok(repo.path(), &["tag", "-a", "annot", "-m", "msg"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");

    let light = result
        .entries
        .iter()
        .find(|entry| entry.short_name.as_bytes() == b"light")
        .unwrap();
    let annot = result
        .entries
        .iter()
        .find(|entry| entry.short_name.as_bytes() == b"annot")
        .unwrap();
    assert!(!light.is_annotated_tag);
    assert_eq!(light.target_sha, sha);
    assert!(annot.is_annotated_tag);
    assert_eq!(annot.peeled_sha.as_deref(), Some(sha.as_str()));
}

#[test]
fn list_refs_marks_the_checked_out_branch_as_head_and_no_other_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    raw_git_ok(repo.path(), &["branch", "other"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");

    let head_entries: Vec<&[u8]> = result
        .entries
        .iter()
        .filter(|entry| entry.is_head)
        .map(|entry| entry.short_name.as_bytes())
        .collect();
    assert_eq!(head_entries, vec![b"main".as_slice()]);
}

#[test]
fn list_refs_marks_no_entry_as_head_while_head_is_detached() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let sha = head_sha(repo.path());
    raw_git_ok(repo.path(), &["checkout", "--quiet", &sha]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");
    assert!(
        result.entries.iter().all(|entry| !entry.is_head),
        "no ref is HEAD while HEAD is detached — a caller distinguishing this from \
         \"no branches at all\" must cross-reference git::status's own BranchHead::Detached"
    );
}

#[test]
fn list_refs_excludes_a_real_stash_entry() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    std::fs::write(repo.path().join("f.txt"), "2\n").unwrap();
    raw_git_ok(repo.path(), &["stash", "push", "--quiet", "-m", "wip"]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");
    assert!(
        result
            .entries
            .iter()
            .all(|entry| entry.full_name.as_bytes() != b"refs/stash"),
        "refs/stash is a real, distinct top-level namespace, never one of the three requested"
    );
}

// --- byte-safety: non-ASCII/punctuation ref names, quotePath irrelevance, 0x1f/NUL impossibility

#[test]
fn list_refs_preserves_a_real_non_ascii_and_punctuation_heavy_ref_name_byte_for_byte() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);

    let non_ascii_branch = "分支-emoji-🎉";
    let punctuation_branch = "weird,name\"with#stuff$and%percent";
    raw_git_ok(repo.path(), &["branch", non_ascii_branch]);
    raw_git_ok(repo.path(), &["branch", punctuation_branch]);

    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main")).expect("list_refs succeeds");

    assert!(result
        .entries
        .iter()
        .any(|entry| entry.short_name.as_bytes() == non_ascii_branch.as_bytes()));
    assert!(result
        .entries
        .iter()
        .any(|entry| entry.short_name.as_bytes() == punctuation_branch.as_bytes()));
}

#[test]
fn for_each_ref_refname_output_is_unaffected_by_core_quote_path_confirming_it_never_applies_to_ref_names(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    raw_git_ok(repo.path(), &["branch", "分支-emoji-🎉"]);

    // Side-by-side control group: with and without `-c core.quotePath=false`,
    // requesting only `%(refname)` for refs/heads.
    let with_default_quoting = raw_git(
        repo.path(),
        &["for-each-ref", "--format=%(refname)", "refs/heads"],
    );
    let with_quoting_disabled = raw_git(
        repo.path(),
        &[
            "-c",
            "core.quotePath=false",
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads",
        ],
    );
    assert!(with_default_quoting.status.success());
    assert!(with_quoting_disabled.status.success());
    assert_eq!(
        with_default_quoting.stdout, with_quoting_disabled.stdout,
        "core.quotePath must have zero effect on for-each-ref's %(refname) output — \
         unlike git blame's filename field, which this same flag genuinely changes \
         (see super::blame's own module doc comment)"
    );
    assert!(
        with_default_quoting
            .stdout
            .windows("分支".len())
            .any(|window| window == "分支".as_bytes()),
        "the non-ASCII branch name must come back as raw, unescaped UTF-8 bytes, \
         confirming quoting was never applied in the first place (not merely \
         that turning it off had no effect)"
    );
}

#[test]
fn a_ref_name_containing_the_unit_separator_or_a_nul_byte_is_impossible_to_construct_confirming_the_delimiter_is_structurally_unreachable(
) {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    let repo = init_repo();
    std::fs::write(repo.path().join("f.txt"), "1\n").unwrap();
    raw_git_ok(repo.path(), &["add", "f.txt"]);
    raw_git_ok(repo.path(), &["commit", "--quiet", "-m", "root"]);
    let sha = head_sha(repo.path());

    // Half 1: a literal 0x1f byte (this command's own field separator) in a
    // ref name is rejected outright by git's own ref-name grammar — the
    // exact same rejection `git check-ref-format` gives that byte directly.
    let hostile_ref_name = format!("refs/heads/evil{}name", '\u{1f}');
    let attempt = raw_git(repo.path(), &["update-ref", &hostile_ref_name, &sha]);
    assert!(
        !attempt.status.success(),
        "git must refuse to create a ref whose name contains a literal 0x1f byte"
    );
    assert_eq!(attempt.status.code(), Some(128));
    let stderr = String::from_utf8_lossy(&attempt.stderr);
    assert!(
        stderr.contains("refusing to update ref with bad name") || stderr.contains("fatal"),
        "unexpected stderr for a 0x1f ref name attempt: {stderr}"
    );

    // Half 2: a literal NUL byte cannot even be *encoded* as a single process
    // argument in the first place (every OS process argument is itself a
    // NUL-terminated C string) — confirmed here by constructing one via raw
    // bytes and observing the spawn itself fails, before any git process is
    // even created, let alone asked to interpret the name.
    #[cfg(unix)]
    {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let raw_bytes = b"refs/heads/evil\0name";
        let hostile_os_arg = OsStr::from_bytes(raw_bytes);
        let spawn_result = Command::new("git")
            .current_dir(repo.path())
            .arg("update-ref")
            .arg(hostile_os_arg)
            .arg(&sha)
            .output();
        assert!(
            spawn_result.is_err(),
            "a NUL byte inside a single process argument must fail before a process is \
             even spawned, not be silently truncated or passed through to git"
        );
    }
}

// --- misc closed-shape checks ------------------------------------------------

#[test]
fn list_refs_of_a_repository_with_zero_refs_is_an_empty_non_error_result() {
    if !git_available() {
        eprintln!("skipping: git not found on PATH");
        return;
    }
    // A freshly `git init`ed repository with zero commits has zero refs
    // under any of refs/heads, refs/tags or refs/remotes at all.
    let repo = init_repo();
    let trust_base = TempDir::new().unwrap();
    let (workspace, trust) = trusted_workspace("main", repo.path(), trust_base.path());
    let result = block_on(list_refs(&trust, &workspace, "main"))
        .expect("list_refs succeeds on a repository with zero commits/refs");
    assert!(result.entries.is_empty());
    assert!(!result.truncated);
}

#[test]
fn list_refs_rejects_an_untrusted_workspace() {
    let dir = TempDir::new().unwrap();
    let workspace = WorkspaceService::new();
    let picker = FakePicker {
        paths: vec![dir.path().to_path_buf()],
    };
    block_on(workspace.pick_roots("main", picker, WorkspacePickRootsMode::Add))
        .expect("root authorizes");
    let trust_base = TempDir::new().unwrap();
    let trust = TrustService::new(trust_base.path().to_path_buf());
    // Deliberately never granted.

    let error =
        block_on(list_refs(&trust, &workspace, "main")).expect_err("untrusted workspace rejects");
    assert_ne!(error.code(), "");
}

// --- parse_refs: pure-function edge cases -----------------------------------

fn hex40(byte: u8) -> String {
    let mut sha = String::with_capacity(40);
    for _ in 0..40 {
        sha.push(char::from_digit((byte % 16) as u32, 16).unwrap());
    }
    sha
}

fn ref_record(
    refname: &str,
    objecttype: &str,
    objectname: &str,
    peeled: &str,
    upstream: &str,
    head_marker: &str,
) -> Vec<u8> {
    let mut line = Vec::new();
    line.extend_from_slice(refname.as_bytes());
    line.push(0);
    line.extend_from_slice(objecttype.as_bytes());
    line.push(0);
    line.extend_from_slice(objectname.as_bytes());
    line.push(0);
    line.extend_from_slice(peeled.as_bytes());
    line.push(0);
    line.extend_from_slice(upstream.as_bytes());
    line.push(0);
    line.extend_from_slice(head_marker.as_bytes());
    line.push(b'\n');
    line
}

#[test]
fn parse_refs_of_empty_output_is_zero_entries_not_truncated() {
    let result = parse_refs(b"", 500).expect("parses");
    assert!(result.entries.is_empty());
    assert!(!result.truncated);
}

#[test]
fn parse_refs_parses_a_well_formed_branch_record_with_no_upstream() {
    let sha = hex40(0xa);
    let output = ref_record("refs/heads/main", "commit", &sha, "", "", "*");
    let result = parse_refs(&output, 500).expect("parses");
    assert_eq!(result.entries.len(), 1);
    let entry = &result.entries[0];
    assert_eq!(entry.kind, RefGroupKind::Branch);
    assert_eq!(entry.full_name.as_bytes(), b"refs/heads/main");
    assert_eq!(entry.short_name.as_bytes(), b"main");
    assert_eq!(entry.target_sha, sha);
    assert!(!entry.is_annotated_tag);
    assert_eq!(entry.peeled_sha, None);
    assert_eq!(entry.upstream, None);
    assert!(entry.is_head);
}

#[test]
fn parse_refs_rejects_a_record_with_the_wrong_field_count() {
    let mut line = b"refs/heads/main\0commit\0".to_vec();
    line.extend_from_slice(hex40(0xa).as_bytes());
    line.push(b'\n'); // only 3 fields, missing peeled/upstream/HEAD
    let error = parse_refs(&line, 500).expect_err("wrong field count is rejected");
    assert_eq!(error.code(), "GIT_REFS_PARSE_FAILED");
}

#[test]
fn parse_refs_rejects_an_objectname_that_is_not_lowercase_hex40() {
    let output = ref_record("refs/heads/main", "commit", "not-a-real-sha", "", "", " ");
    let error = parse_refs(&output, 500).expect_err("malformed objectname is rejected");
    assert_eq!(error.code(), "GIT_REFS_PARSE_FAILED");
}

#[test]
fn parse_refs_rejects_a_peeled_objectname_that_is_present_but_not_lowercase_hex40() {
    let sha = hex40(0xa);
    let output = ref_record("refs/tags/v1", "tag", &sha, "not-a-real-sha", "", " ");
    let error = parse_refs(&output, 500).expect_err("malformed peeled objectname is rejected");
    assert_eq!(error.code(), "GIT_REFS_PARSE_FAILED");
}

#[test]
fn parse_refs_rejects_a_head_marker_that_is_neither_star_nor_space() {
    let sha = hex40(0xa);
    let output = ref_record("refs/heads/main", "commit", &sha, "", "", "?");
    let error = parse_refs(&output, 500).expect_err("unrecognized HEAD marker is rejected");
    assert_eq!(error.code(), "GIT_REFS_PARSE_FAILED");
}

#[test]
fn parse_refs_rejects_a_refname_outside_the_three_requested_namespaces() {
    let sha = hex40(0xa);
    let output = ref_record("refs/stash", "commit", &sha, "", "", " ");
    let error =
        parse_refs(&output, 500).expect_err("a refname outside heads/tags/remotes is rejected");
    assert_eq!(error.code(), "GIT_REFS_PARSE_FAILED");
}

#[test]
fn parse_refs_caps_at_the_defensive_ceiling_and_reports_truncated() {
    let mut output = Vec::new();
    for index in 0..10u8 {
        output.extend_from_slice(&ref_record(
            &format!("refs/heads/branch-{index}"),
            "commit",
            &hex40(index),
            "",
            "",
            " ",
        ));
    }
    let result = parse_refs(&output, 5).expect("parses");
    assert_eq!(result.entries.len(), 5);
    assert!(result.truncated);
}

// --- classify_ref_name -------------------------------------------------------

#[test]
fn classify_ref_name_strips_each_of_the_three_expected_prefixes() {
    assert_eq!(
        classify_ref_name(b"refs/heads/main"),
        Some((RefGroupKind::Branch, b"main".to_vec()))
    );
    assert_eq!(
        classify_ref_name(b"refs/tags/v1"),
        Some((RefGroupKind::Tag, b"v1".to_vec()))
    );
    assert_eq!(
        classify_ref_name(b"refs/remotes/origin/main"),
        Some((RefGroupKind::RemoteBranch, b"origin/main".to_vec()))
    );
    assert_eq!(classify_ref_name(b"refs/stash"), None);
    assert_eq!(classify_ref_name(b"refs/notes/commits"), None);
}
