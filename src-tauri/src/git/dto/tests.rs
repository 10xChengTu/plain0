use super::{
    GitBlobRevWire, GitCommitRequest, GitDiffFilesRequest, GitDiffFilesResult,
    GitDiscardPathsRequest, GitShowBlobRequest, GitShowBlobResult, GitStageBlobRequest,
    GitStagePathsRequest, GitStatusResult, GitUnstagePathsRequest,
};
use crate::git::diff::{DiffFileEntry, DiffStatusKind};
use crate::git::status::{
    BranchHead, BranchInfo, BranchOid, GitStatus, OrdinaryStatusEntry, RenameOrCopyKind,
    RenameOrCopyStatusEntry, StatusEntry, SubmoduleState, UnmergedStatusEntry,
};
use crate::git::wire::GitPathBuf;

fn sample_submodule() -> SubmoduleState {
    SubmoduleState {
        is_submodule: false,
        commit_changed: false,
        tracked_changed: false,
        untracked_changed: false,
    }
}

#[test]
fn git_status_result_serializes_with_camel_case_and_initial_detached_tokens() {
    let status = GitStatus {
        branch: BranchInfo {
            oid: BranchOid::Initial,
            head: BranchHead::Detached,
            upstream: None,
        },
        entries: vec![StatusEntry::Ordinary(OrdinaryStatusEntry {
            index_status: '.',
            worktree_status: 'M',
            submodule: sample_submodule(),
            mode_head: "100644".to_owned(),
            mode_index: "100644".to_owned(),
            mode_worktree: "100644".to_owned(),
            hash_head: "a".repeat(40),
            hash_index: "a".repeat(40),
            path: GitPathBuf::from_bytes(b"a.txt".to_vec()),
        })],
    };
    let value = serde_json::to_value(GitStatusResult::from(status)).expect("serializes");
    assert_eq!(value["branch"]["oid"], "(initial)");
    assert_eq!(value["branch"]["head"], "(detached)");
    assert!(value["branch"]["upstream"].is_null());
    assert_eq!(value["entries"][0]["type"], "ordinary");
    assert_eq!(value["entries"][0]["worktreeStatus"], "M");
    assert_eq!(value["entries"][0]["path"], "a.txt");
    assert!(value["entries"][0].get("mode_head").is_none());
}

#[test]
fn rename_or_copy_entry_serializes_its_kind_as_a_camel_case_string() {
    let status = GitStatus {
        branch: BranchInfo {
            oid: BranchOid::Commit("f".repeat(40)),
            head: BranchHead::Named("main".to_owned()),
            upstream: None,
        },
        entries: vec![StatusEntry::RenameOrCopy(RenameOrCopyStatusEntry {
            index_status: 'R',
            worktree_status: '.',
            submodule: sample_submodule(),
            mode_head: "100644".to_owned(),
            mode_index: "100644".to_owned(),
            mode_worktree: "100644".to_owned(),
            hash_head: "a".repeat(40),
            hash_index: "b".repeat(40),
            kind: RenameOrCopyKind::Copy,
            similarity: 90,
            path: GitPathBuf::from_bytes(b"new.txt".to_vec()),
            orig_path: GitPathBuf::from_bytes(b"old.txt".to_vec()),
        })],
    };
    let value = serde_json::to_value(GitStatusResult::from(status)).expect("serializes");
    assert_eq!(value["entries"][0]["type"], "renameOrCopy");
    assert_eq!(value["entries"][0]["renameOrCopyKind"], "copy");
    assert_eq!(value["entries"][0]["similarity"], 90);
    assert_eq!(value["entries"][0]["origPath"], "old.txt");
}

#[test]
fn unmerged_untracked_and_ignored_entries_serialize_their_discriminant() {
    let status = GitStatus {
        branch: BranchInfo {
            oid: BranchOid::Commit("f".repeat(40)),
            head: BranchHead::Named("main".to_owned()),
            upstream: None,
        },
        entries: vec![
            StatusEntry::Unmerged(UnmergedStatusEntry {
                index_status: 'U',
                worktree_status: 'U',
                submodule: sample_submodule(),
                mode_stage1: "100644".to_owned(),
                mode_stage2: "100644".to_owned(),
                mode_stage3: "100644".to_owned(),
                mode_worktree: "100644".to_owned(),
                hash_stage1: "a".repeat(40),
                hash_stage2: "b".repeat(40),
                hash_stage3: "c".repeat(40),
                path: GitPathBuf::from_bytes(b"conflict.txt".to_vec()),
            }),
            StatusEntry::Untracked(GitPathBuf::from_bytes(b"new.txt".to_vec())),
            StatusEntry::Ignored(GitPathBuf::from_bytes(b"skip.ign".to_vec())),
        ],
    };
    let value = serde_json::to_value(GitStatusResult::from(status)).expect("serializes");
    assert_eq!(value["entries"][0]["type"], "unmerged");
    assert_eq!(value["entries"][1]["type"], "untracked");
    assert_eq!(value["entries"][1]["path"], "new.txt");
    assert_eq!(value["entries"][2]["type"], "ignored");
    assert_eq!(value["entries"][2]["path"], "skip.ign");
}

#[test]
fn upstream_serializes_its_ahead_behind_counts() {
    let status = GitStatus {
        branch: BranchInfo {
            oid: BranchOid::Commit("f".repeat(40)),
            head: BranchHead::Named("feature".to_owned()),
            upstream: Some(crate::git::status::BranchUpstream {
                name: "main".to_owned(),
                ahead: 3,
                behind: 1,
            }),
        },
        entries: vec![],
    };
    let value = serde_json::to_value(GitStatusResult::from(status)).expect("serializes");
    assert_eq!(value["branch"]["upstream"]["name"], "main");
    assert_eq!(value["branch"]["upstream"]["ahead"], 3);
    assert_eq!(value["branch"]["upstream"]["behind"], 1);
}

#[test]
fn git_diff_files_request_deserializes_cached_and_rejects_unknown_fields() {
    let request: GitDiffFilesRequest =
        serde_json::from_value(serde_json::json!({ "cached": true })).expect("deserializes");
    assert!(request.into_parts());

    let rejected: Result<GitDiffFilesRequest, _> =
        serde_json::from_value(serde_json::json!({ "cached": true, "extra": 1 }));
    assert!(rejected.is_err());
}

#[test]
fn git_diff_files_result_serializes_diff_status_kind_as_camel_case() {
    let entries = vec![DiffFileEntry {
        kind: DiffStatusKind::TypeChanged,
        similarity: None,
        path: GitPathBuf::from_bytes(b"a.txt".to_vec()),
        orig_path: None,
        added: Some(1),
        deleted: Some(2),
        binary: false,
    }];
    let value = serde_json::to_value(GitDiffFilesResult::new(entries)).expect("serializes");
    assert_eq!(value["entries"][0]["kind"], "typeChanged");
    assert_eq!(value["entries"][0]["added"], 1);
    assert_eq!(value["entries"][0]["deleted"], 2);
    assert_eq!(value["entries"][0]["binary"], false);
}

#[test]
fn git_show_blob_request_rejects_an_empty_path() {
    let request = GitShowBlobRequest {
        rev: GitBlobRevWire::Head,
        path: String::new(),
    };
    let error = request
        .into_parts()
        .expect_err("empty path must be rejected");
    assert_eq!(error.code(), "GIT_SHOW_BLOB_INVALID_REQUEST");
}

#[test]
fn git_show_blob_request_rejects_an_oversized_path() {
    let request = GitShowBlobRequest {
        rev: GitBlobRevWire::Index,
        path: "x".repeat(5_000),
    };
    assert!(request.into_parts().is_err());
}

#[test]
fn git_show_blob_request_accepts_a_valid_path_and_maps_the_rev() {
    let request = GitShowBlobRequest {
        rev: GitBlobRevWire::Index,
        path: "a.txt".to_owned(),
    };
    let (rev, path) = request.into_parts().expect("valid request");
    assert_eq!(rev, crate::git::diff::GitBlobRev::Index);
    assert_eq!(path, "a.txt");
}

#[test]
fn git_show_blob_result_serializes_content_as_a_byte_array_or_null() {
    let found = serde_json::to_value(GitShowBlobResult::new(Some(vec![1, 2, 3]))).unwrap();
    assert_eq!(found["content"], serde_json::json!([1, 2, 3]));

    let not_found = serde_json::to_value(GitShowBlobResult::new(None)).unwrap();
    assert!(not_found["content"].is_null());
}

// --- git_stage_paths / git_unstage_paths / git_discard_paths ---------------

#[test]
fn git_stage_paths_request_accepts_a_non_empty_path_list() {
    let request: GitStagePathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": ["a.txt", "b.txt"] }))
            .expect("deserializes");
    let paths = request.into_parts().expect("valid paths accepted");
    assert_eq!(paths, vec!["a.txt".to_owned(), "b.txt".to_owned()]);
}

#[test]
fn git_stage_paths_request_rejects_an_empty_list() {
    let request: GitStagePathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": [] })).expect("deserializes");
    let error = request
        .into_parts()
        .expect_err("empty list must be rejected");
    assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
}

#[test]
fn git_stage_paths_request_rejects_a_traversal_or_absolute_path() {
    for hostile in ["../outside.txt", "/etc/passwd", "a/../../b"] {
        let request: GitStagePathsRequest =
            serde_json::from_value(serde_json::json!({ "paths": [hostile] }))
                .expect("deserializes");
        let error = request
            .into_parts()
            .expect_err("hostile path must be rejected");
        assert_eq!(error.code(), "GIT_MUTATE_PATHS_INVALID_REQUEST");
    }
}

#[test]
fn git_stage_paths_request_rejects_unknown_fields() {
    let rejected: Result<GitStagePathsRequest, _> =
        serde_json::from_value(serde_json::json!({ "paths": ["a.txt"], "extra": 1 }));
    assert!(rejected.is_err());
}

#[test]
fn git_unstage_paths_request_accepts_and_validates_like_stage() {
    let request: GitUnstagePathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": ["a.txt"] })).expect("deserializes");
    assert_eq!(request.into_parts().unwrap(), vec!["a.txt".to_owned()]);

    let rejected: GitUnstagePathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": [] })).expect("deserializes");
    assert_eq!(
        rejected.into_parts().unwrap_err().code(),
        "GIT_MUTATE_PATHS_INVALID_REQUEST"
    );
}

#[test]
fn git_discard_paths_request_accepts_and_validates_like_stage() {
    let request: GitDiscardPathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": ["a.txt"] })).expect("deserializes");
    assert_eq!(request.into_parts().unwrap(), vec!["a.txt".to_owned()]);

    let rejected: GitDiscardPathsRequest =
        serde_json::from_value(serde_json::json!({ "paths": ["/abs"] })).expect("deserializes");
    assert_eq!(
        rejected.into_parts().unwrap_err().code(),
        "GIT_MUTATE_PATHS_INVALID_REQUEST"
    );
}

// --- git_stage_blob ----------------------------------------------------------

#[test]
fn git_stage_blob_request_accepts_a_valid_path_and_content() {
    let request: GitStageBlobRequest =
        serde_json::from_value(serde_json::json!({ "path": "a.txt", "content": [1, 2, 3] }))
            .expect("deserializes");
    let (path, content) = request.into_parts().expect("valid request accepted");
    assert_eq!(path, "a.txt");
    assert_eq!(content, vec![1, 2, 3]);
}

#[test]
fn git_stage_blob_request_rejects_an_invalid_path() {
    let request: GitStageBlobRequest =
        serde_json::from_value(serde_json::json!({ "path": "../outside.txt", "content": [] }))
            .expect("deserializes");
    let error = request
        .into_parts()
        .expect_err("invalid path must be rejected");
    assert_eq!(error.code(), "GIT_STAGE_BLOB_INVALID_REQUEST");
}

#[test]
fn git_stage_blob_request_rejects_oversized_content() {
    let oversized = vec![0_u8; 8 * 1024 * 1024 + 1];
    let request = GitStageBlobRequest {
        path: "a.txt".to_owned(),
        content: oversized,
    };
    let error = request
        .into_parts()
        .expect_err("oversized content must be rejected");
    assert_eq!(error.code(), "GIT_STAGE_BLOB_INVALID_REQUEST");
}

// --- git_commit --------------------------------------------------------------

#[test]
fn git_commit_request_accepts_a_message_and_amend_flag() {
    let request: GitCommitRequest =
        serde_json::from_value(serde_json::json!({ "message": "feat: x", "amend": true }))
            .expect("deserializes");
    let (message, amend) = request.into_parts().expect("valid request accepted");
    assert_eq!(message, "feat: x");
    assert!(amend);
}

#[test]
fn git_commit_request_rejects_an_empty_or_whitespace_only_message() {
    for message in ["", "   ", "\n\t"] {
        let request = GitCommitRequest {
            message: message.to_owned(),
            amend: false,
        };
        let error = request
            .into_parts()
            .expect_err("empty/whitespace message must be rejected");
        assert_eq!(error.code(), "GIT_COMMIT_INVALID_REQUEST");
    }
}

#[test]
fn git_commit_request_rejects_an_oversized_message() {
    let request = GitCommitRequest {
        message: "a".repeat(100_001),
        amend: false,
    };
    let error = request
        .into_parts()
        .expect_err("oversized message must be rejected");
    assert_eq!(error.code(), "GIT_COMMIT_INVALID_REQUEST");
}

#[test]
fn git_commit_request_rejects_unknown_fields() {
    let rejected: Result<GitCommitRequest, _> = serde_json::from_value(serde_json::json!({
        "message": "x",
        "amend": false,
        "extra": 1
    }));
    assert!(rejected.is_err());
}
