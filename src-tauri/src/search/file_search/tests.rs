use std::fs;
use std::path::Path;

use tempfile::TempDir;

use super::{collect_entries, search_roots, MAX_SEARCH_TREE_ENTRIES};
use crate::search::dto::WorkspaceSearchFilesQuery;
use crate::workspace::{WorkspaceRootLease, WorkspaceScope};

fn authorized_lease(root: &Path) -> WorkspaceRootLease {
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(root).unwrap();
    scope.lease(root_id).unwrap()
}

fn query(
    lease: &WorkspaceRootLease,
    file_pattern: &str,
    max_results: usize,
) -> WorkspaceSearchFilesQuery {
    WorkspaceSearchFilesQuery {
        roots: vec![lease.root_id()],
        file_pattern: file_pattern.to_owned(),
        exclude_globs: Vec::new(),
        max_results,
    }
}

#[test]
fn empty_pattern_returns_the_full_bounded_listing() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), b"a").unwrap();
    fs::create_dir(temp.path().join("dir")).unwrap();
    fs::write(temp.path().join("dir").join("b.txt"), b"b").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    let mut entries = result.entries().to_vec();
    entries.sort();
    assert_eq!(entries, ["a.txt", "dir/b.txt"]);
    assert!(!result.limit_hit());
}

#[test]
fn subsequence_prefilter_matches_case_insensitively_and_out_of_order_gaps() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("Main.rs"), b"fn main() {}").unwrap();
    fs::write(temp.path().join("other.rs"), b"// other").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "mr", 512)).unwrap();
    assert_eq!(result.entries(), ["Main.rs"]);
}

#[test]
fn max_results_truncates_and_reports_limit_hit() {
    let temp = TempDir::new().unwrap();
    for name in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"] {
        fs::write(temp.path().join(name), b"x").unwrap();
    }
    let lease = authorized_lease(temp.path());

    let capped = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 2)).unwrap();
    assert_eq!(capped.entries().len(), 2);
    assert!(capped.limit_hit());

    let uncapped = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 10)).unwrap();
    assert_eq!(uncapped.entries().len(), 5);
    assert!(!uncapped.limit_hit());
}

#[test]
fn gitignore_ignores_matching_files_and_respects_negation() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join(".gitignore"), "*.log\n!keep.log\n").unwrap();
    fs::write(temp.path().join("drop.log"), b"drop").unwrap();
    fs::write(temp.path().join("keep.log"), b"keep").unwrap();
    fs::write(temp.path().join("kept.txt"), b"kept").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    let mut entries = result.entries().to_vec();
    entries.sort();
    // `.gitignore` itself is an ordinary tracked file (git does not ignore
    // its own ignore file by default), so it is expected to appear here too.
    assert_eq!(entries, [".gitignore", "keep.log", "kept.txt"]);
}

#[test]
fn nested_gitignore_takes_precedence_over_the_parent_gitignore() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join(".gitignore"), "*.tmp\n").unwrap();
    fs::create_dir(temp.path().join("sub")).unwrap();
    fs::write(
        temp.path().join("sub").join(".gitignore"),
        "!important.tmp\n",
    )
    .unwrap();
    fs::write(temp.path().join("a.tmp"), b"a").unwrap();
    fs::write(temp.path().join("sub").join("b.tmp"), b"b").unwrap();
    fs::write(temp.path().join("sub").join("important.tmp"), b"important").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    let mut entries = result.entries().to_vec();
    entries.sort();
    assert_eq!(
        entries,
        [".gitignore", "sub/.gitignore", "sub/important.tmp"]
    );
}

#[test]
fn oversized_gitignore_is_skipped_rather_than_failing_the_search() {
    let temp = TempDir::new().unwrap();
    let oversized = "secret.txt\n".to_owned() + &" ".repeat(8 * 1_024 * 1_024 + 1);
    fs::write(temp.path().join(".gitignore"), oversized).unwrap();
    fs::write(temp.path().join("secret.txt"), b"secret").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    let mut entries = result.entries().to_vec();
    entries.sort();
    // The oversized .gitignore's *content* is skipped (so it fails to ignore
    // secret.txt), but the file itself is still an ordinary search result.
    assert_eq!(entries, [".gitignore", "secret.txt"]);
}

#[test]
fn exclude_globs_prune_matching_directories_and_files() {
    let temp = TempDir::new().unwrap();
    fs::create_dir(temp.path().join("node_modules")).unwrap();
    fs::write(
        temp.path().join("node_modules").join("pkg.js"),
        b"module.exports = {}",
    )
    .unwrap();
    fs::write(temp.path().join("keep.js"), b"keep").unwrap();
    let lease = authorized_lease(temp.path());

    let mut search_query = query(&lease, "", 512);
    search_query.exclude_globs = vec!["**/node_modules".to_owned()];
    let result = search_roots(std::slice::from_ref(&lease), &search_query).unwrap();
    assert_eq!(result.entries(), ["keep.js"]);
}

#[cfg(unix)]
#[test]
fn symlinks_are_never_followed_or_reported() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("real.txt"), b"real").unwrap();
    symlink(temp.path().join("real.txt"), temp.path().join("link.txt")).unwrap();
    fs::create_dir(temp.path().join("target-dir")).unwrap();
    fs::write(temp.path().join("target-dir").join("inside.txt"), b"inside").unwrap();
    symlink(temp.path().join("target-dir"), temp.path().join("linkdir")).unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    let mut entries = result.entries().to_vec();
    entries.sort();
    assert_eq!(entries, ["real.txt", "target-dir/inside.txt"]);
}

// macOS's filesystems (APFS/HFS+) reject non-UTF-8 names at `write` time, so
// this can only be exercised for real on a filesystem that allows arbitrary
// bytes.
#[cfg(target_os = "linux")]
#[test]
fn non_utf8_file_names_are_skipped_not_fatal() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("valid.txt"), b"ok").unwrap();
    let invalid_name = OsString::from_vec(vec![0xff, 0xfe, 0x00 + b'x']);
    fs::write(temp.path().join(&invalid_name), b"bad").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    assert_eq!(result.entries(), ["valid.txt"]);
}

#[test]
fn depth_budget_stops_the_search_and_reports_limit_hit() {
    let temp = TempDir::new().unwrap();
    let mut path = temp.path().to_path_buf();
    for _ in 0..257 {
        path.push("a");
        fs::create_dir(&path).unwrap();
    }
    fs::write(path.join("marker.txt"), b"deep").unwrap();
    fs::write(temp.path().join("a").join("shallow.txt"), b"shallow").unwrap();
    let lease = authorized_lease(temp.path());

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    assert!(result.limit_hit());
    assert!(result
        .entries()
        .iter()
        .any(|entry| entry == "a/shallow.txt"));
    assert!(!result
        .entries()
        .iter()
        .any(|entry| entry.ends_with("marker.txt")));
}

#[test]
fn collect_entries_budget_rejects_only_once_the_ceiling_would_be_exceeded() {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), b"a").unwrap();
    fs::write(temp.path().join("b.txt"), b"b").unwrap();
    let directory =
        cap_std::fs::Dir::open_ambient_dir(temp.path(), cap_std::ambient_authority()).unwrap();

    let mut within_budget = MAX_SEARCH_TREE_ENTRIES - 2;
    assert!(collect_entries(&directory, &mut within_budget).is_ok());
    assert_eq!(within_budget, MAX_SEARCH_TREE_ENTRIES);

    let mut over_budget = MAX_SEARCH_TREE_ENTRIES - 1;
    assert!(collect_entries(&directory, &mut over_budget).is_err());
}

#[test]
fn root_revocation_between_lease_and_traversal_is_not_this_layer_s_concern() {
    // search_roots operates on already-leased Dir handles; revocation
    // detection and rejection is WorkspaceService::search_files's job (it
    // revalidates every leased root after the blocking traversal completes).
    // This test only documents that a lease clone keeps working after the
    // originating WorkspaceScope is dropped, which is why the service layer
    // must do its own post-hoc revalidation rather than relying on this
    // layer to notice revocation.
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("a.txt"), b"a").unwrap();
    let mut scope = WorkspaceScope::new();
    let root_id = scope.authorize_root(temp.path()).unwrap();
    let lease = scope.lease(root_id).unwrap();
    drop(scope);

    let result = search_roots(std::slice::from_ref(&lease), &query(&lease, "", 512)).unwrap();
    assert_eq!(result.entries(), ["a.txt"]);
}
