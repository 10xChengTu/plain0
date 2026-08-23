use super::{
    GitBlobRevWire, GitBranchCreateRequest, GitBranchDeleteOutcomeWire, GitBranchDeleteRequest,
    GitBranchRenameRequest, GitBranchSwitchRequest, GitCommitRequest, GitContributorsListRequest,
    GitContributorsListResultWire, GitDiffFilesRequest, GitDiffFilesResult, GitDiscardPathsRequest,
    GitHistoryAbortRequest, GitHistoryContinueRequest, GitHistoryMutationOutcomeWire,
    GitHistoryPreviewRequest, GitHistoryPreviewResultWire, GitHistorySearchRequest,
    GitMergeRequest, GitReflogListRequest, GitReflogListResultWire, GitRemoteAddRequest,
    GitRemoteRemoveRequest, GitRemoteRenameRequest, GitRemoteSetUrlRequest, GitRemotesListRequest,
    GitRemotesListResultWire, GitResetRequest, GitShowBlobRequest, GitShowBlobResult,
    GitStageBlobRequest, GitStagePathsRequest, GitStatusResult, GitTagCreateRequest,
    GitTagDeleteRequest, GitUnstagePathsRequest, GitUpstreamSetRequest, GitUpstreamUnsetRequest,
};
use crate::git::contributors::{ContributorEntry, ContributorList};
use crate::git::diff::{DiffFileEntry, DiffStatusKind};
use crate::git::history_operation::{
    HistoryMutationOutcome, HistoryMutationOutcomeKind, HistoryOperation, HistoryPreview,
    HistoryState, SequencerKind, SequencerState,
};
use crate::git::log::HistorySearchMode;
use crate::git::management::{BranchDeleteOutcome, RemoteUrlKind};
use crate::git::reflog::{ReflogEntry, ReflogList};
use crate::git::remote::{RemoteEntry, RemoteList};
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
fn git_history_search_request_trims_and_closes_its_mode_query_shape() {
    let request: GitHistorySearchRequest =
        serde_json::from_value(serde_json::json!({"mode":"message","query":"  release  "}))
            .unwrap();
    assert_eq!(
        request.into_parts().unwrap(),
        (HistorySearchMode::Message, "release".to_owned())
    );

    for value in [
        serde_json::json!({"mode":"unknown","query":"release"}),
        serde_json::json!({"mode":"message","query":"release","argv":[]}),
    ] {
        assert!(serde_json::from_value::<GitHistorySearchRequest>(value).is_err());
    }
}

#[test]
fn git_history_search_request_rejects_invalid_queries() {
    for value in [
        serde_json::json!({"mode":"message","query":"  "}),
        serde_json::json!({"mode":"author","query":"bad\nname"}),
        serde_json::json!({"mode":"sha","query":"abc"}),
        serde_json::json!({"mode":"sha","query":"abcdz"}),
    ] {
        let request: GitHistorySearchRequest = serde_json::from_value(value).unwrap();
        assert_eq!(
            request.into_parts().unwrap_err().code(),
            "GIT_HISTORY_SEARCH_INVALID_QUERY"
        );
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

// --- F180 S1A read models ---------------------------------------------------

#[test]
fn git_read_model_requests_are_exact_empty_objects() {
    let remotes: GitRemotesListRequest = serde_json::from_value(serde_json::json!({})).unwrap();
    remotes.validate();
    let reflog: GitReflogListRequest = serde_json::from_value(serde_json::json!({})).unwrap();
    reflog.validate();
    let contributors: GitContributorsListRequest =
        serde_json::from_value(serde_json::json!({})).unwrap();
    contributors.validate();

    assert!(
        serde_json::from_value::<GitRemotesListRequest>(serde_json::json!({
            "extra": true
        }))
        .is_err()
    );
}

#[test]
fn git_read_model_results_serialize_only_their_audited_camel_case_fields() {
    let remotes = serde_json::to_value(GitRemotesListResultWire::from(RemoteList {
        entries: vec![RemoteEntry {
            name: "origin".to_owned(),
            fetch_urls: vec!["https://example.invalid/repo.git".to_owned()],
            push_urls: Vec::new(),
        }],
        truncated: false,
    }))
    .unwrap();
    assert_eq!(
        remotes,
        serde_json::json!({
            "entries": [{
                "name": "origin",
                "fetchUrls": ["https://example.invalid/repo.git"],
                "pushUrls": []
            }],
            "truncated": false
        })
    );

    let reflog = serde_json::to_value(GitReflogListResultWire::from(ReflogList {
        entries: vec![ReflogEntry {
            sha: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            selector: "HEAD@{0}".to_owned(),
            committer_time: 1,
            summary: "commit: sample".to_owned(),
        }],
        truncated: false,
    }))
    .unwrap();
    assert_eq!(reflog["entries"][0]["committerTime"], 1);

    let contributors = serde_json::to_value(GitContributorsListResultWire::from(ContributorList {
        entries: vec![ContributorEntry {
            name: "Plain".to_owned(),
            email: "plain@example.invalid".to_owned(),
            commits: 2,
        }],
        truncated: false,
    }))
    .unwrap();
    assert_eq!(contributors["entries"][0]["commits"], 2);
}

// --- F180 S1B branch/tag/remote/upstream mutation requests ----------------

#[test]
fn git_management_requests_accept_only_their_audited_fields_and_values() {
    let sha = "0123456789abcdef0123456789abcdef01234567";
    let branch_create: GitBranchCreateRequest = serde_json::from_value(serde_json::json!({
        "name": "feature/nested",
        "targetSha": sha
    }))
    .unwrap();
    assert_eq!(
        branch_create.into_parts().unwrap(),
        ("feature/nested".to_owned(), sha.to_owned())
    );
    let branch_switch: GitBranchSwitchRequest =
        serde_json::from_value(serde_json::json!({ "name": "main" })).unwrap();
    assert_eq!(branch_switch.into_parts().unwrap(), "main");
    let branch_rename: GitBranchRenameRequest = serde_json::from_value(serde_json::json!({
        "oldName": "old",
        "newName": "new"
    }))
    .unwrap();
    assert_eq!(
        branch_rename.into_parts().unwrap(),
        ("old".to_owned(), "new".to_owned())
    );
    let branch_delete: GitBranchDeleteRequest =
        serde_json::from_value(serde_json::json!({ "name": "old", "force": true })).unwrap();
    assert_eq!(
        branch_delete.into_parts().unwrap(),
        ("old".to_owned(), true)
    );

    let tag_create: GitTagCreateRequest = serde_json::from_value(serde_json::json!({
        "name": "v1",
        "targetSha": sha,
        "message": "release"
    }))
    .unwrap();
    assert_eq!(
        tag_create.into_parts().unwrap(),
        ("v1".to_owned(), sha.to_owned(), Some("release".to_owned()))
    );
    let tag_delete: GitTagDeleteRequest =
        serde_json::from_value(serde_json::json!({ "name": "v1" })).unwrap();
    assert_eq!(tag_delete.into_parts().unwrap(), "v1");

    let remote_add: GitRemoteAddRequest = serde_json::from_value(serde_json::json!({
        "name": "origin",
        "url": "https://example.invalid/repo.git"
    }))
    .unwrap();
    assert_eq!(
        remote_add.into_parts().unwrap(),
        (
            "origin".to_owned(),
            "https://example.invalid/repo.git".to_owned()
        )
    );
    let remote_rename: GitRemoteRenameRequest = serde_json::from_value(serde_json::json!({
        "oldName": "origin",
        "newName": "upstream"
    }))
    .unwrap();
    assert_eq!(
        remote_rename.into_parts().unwrap(),
        ("origin".to_owned(), "upstream".to_owned())
    );
    let remote_url: GitRemoteSetUrlRequest = serde_json::from_value(serde_json::json!({
        "name": "origin",
        "kind": "push",
        "url": "ssh://example.invalid/repo.git"
    }))
    .unwrap();
    let (name, kind, url) = remote_url.into_parts().unwrap();
    assert_eq!(name, "origin");
    assert_eq!(kind, RemoteUrlKind::Push);
    assert_eq!(url, "ssh://example.invalid/repo.git");
    let remote_remove: GitRemoteRemoveRequest =
        serde_json::from_value(serde_json::json!({ "name": "origin" })).unwrap();
    assert_eq!(remote_remove.into_parts().unwrap(), "origin");

    let upstream_set: GitUpstreamSetRequest = serde_json::from_value(serde_json::json!({
        "branch": "main",
        "upstream": "origin/main"
    }))
    .unwrap();
    assert_eq!(
        upstream_set.into_parts().unwrap(),
        ("main".to_owned(), "origin/main".to_owned())
    );
    let upstream_unset: GitUpstreamUnsetRequest =
        serde_json::from_value(serde_json::json!({ "branch": "main" })).unwrap();
    assert_eq!(upstream_unset.into_parts().unwrap(), "main");
}

#[test]
fn git_management_requests_reject_hostile_or_extra_values_before_routing() {
    let sha = "0123456789abcdef0123456789abcdef01234567";
    let branch: GitBranchCreateRequest = serde_json::from_value(serde_json::json!({
        "name": "refs/tags/forged",
        "targetSha": sha
    }))
    .unwrap();
    assert_eq!(
        branch.into_parts().unwrap_err().code(),
        "GIT_BRANCH_MANAGEMENT_INVALID_REQUEST"
    );
    let tag: GitTagCreateRequest = serde_json::from_value(serde_json::json!({
        "name": "v1",
        "targetSha": sha,
        "message": "   "
    }))
    .unwrap();
    assert_eq!(
        tag.into_parts().unwrap_err().code(),
        "GIT_TAG_MANAGEMENT_INVALID_REQUEST"
    );
    let remote: GitRemoteAddRequest = serde_json::from_value(serde_json::json!({
        "name": "nested/name",
        "url": "https://example.invalid/repo.git\nsecret"
    }))
    .unwrap();
    assert_eq!(
        remote.into_parts().unwrap_err().code(),
        "GIT_REMOTE_MANAGEMENT_INVALID_REQUEST"
    );
    let upstream: GitUpstreamSetRequest = serde_json::from_value(serde_json::json!({
        "branch": "main",
        "upstream": "refs/remotes/origin/main"
    }))
    .unwrap();
    assert_eq!(
        upstream.into_parts().unwrap_err().code(),
        "GIT_UPSTREAM_MANAGEMENT_INVALID_REQUEST"
    );
    assert!(
        serde_json::from_value::<GitBranchSwitchRequest>(serde_json::json!({
            "name": "main",
            "extra": true
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<GitRemoteSetUrlRequest>(serde_json::json!({
            "name": "origin",
            "kind": "unknown",
            "url": "https://example.invalid/repo.git"
        }))
        .is_err()
    );
}

#[test]
fn git_branch_delete_outcome_serializes_as_the_exact_camel_case_string() {
    assert_eq!(
        serde_json::to_value(GitBranchDeleteOutcomeWire::from(
            BranchDeleteOutcome::Deleted
        ))
        .unwrap(),
        serde_json::json!("deleted")
    );
    assert_eq!(
        serde_json::to_value(GitBranchDeleteOutcomeWire::from(
            BranchDeleteOutcome::NeedsForce
        ))
        .unwrap(),
        serde_json::json!("needsForce")
    );
}

#[test]
fn git_history_requests_are_exact_bounded_and_convert_to_domain_enums() {
    let sha = "a".repeat(40);
    let token = "b".repeat(64);
    let preview: GitHistoryPreviewRequest = serde_json::from_value(serde_json::json!({
        "operation": "resetHard",
        "targetSha": sha
    }))
    .unwrap();
    assert_eq!(
        preview.into_parts().unwrap(),
        (HistoryOperation::ResetHard, "a".repeat(40))
    );
    let merge: GitMergeRequest = serde_json::from_value(serde_json::json!({
        "targetSha": "a".repeat(40),
        "previewToken": token
    }))
    .unwrap();
    assert_eq!(
        merge.into_parts().unwrap(),
        ("a".repeat(40), "b".repeat(64))
    );
    let reset: GitResetRequest = serde_json::from_value(serde_json::json!({
        "targetSha": "a".repeat(40),
        "mode": "mixed",
        "previewToken": "b".repeat(64)
    }))
    .unwrap();
    assert_eq!(
        reset.into_parts().unwrap(),
        (HistoryOperation::ResetMixed, "a".repeat(40), "b".repeat(64))
    );
    let continuation: GitHistoryContinueRequest =
        serde_json::from_value(serde_json::json!({ "kind": "cherryPick" })).unwrap();
    assert_eq!(continuation.into_parts(), SequencerKind::CherryPick);
    let abort: GitHistoryAbortRequest =
        serde_json::from_value(serde_json::json!({ "kind": "rebase" })).unwrap();
    assert_eq!(abort.into_parts(), SequencerKind::Rebase);

    let bad_token: GitMergeRequest = serde_json::from_value(serde_json::json!({
        "targetSha": "a".repeat(40),
        "previewToken": "B".repeat(64)
    }))
    .unwrap();
    assert_eq!(
        bad_token.into_parts().unwrap_err().code(),
        "GIT_HISTORY_MUTATION_INVALID_REQUEST"
    );
    assert!(
        serde_json::from_value::<GitHistoryPreviewRequest>(serde_json::json!({
            "operation": "merge",
            "targetSha": "a".repeat(40),
            "extra": true
        }))
        .is_err()
    );
}

#[test]
fn git_history_preview_and_outcome_serialize_with_exact_camel_case_shapes() {
    let sequencer = SequencerState {
        kind: SequencerKind::Merge,
        conflicted_paths: vec![GitPathBuf::from_bytes(b"conflict.txt".to_vec())],
        paths_truncated: false,
    };
    let preview = GitHistoryPreviewResultWire::from(HistoryPreview {
        operation: HistoryOperation::Merge,
        target_sha: "a".repeat(40),
        head_sha: "b".repeat(40),
        ahead: 2,
        behind: 1,
        working_tree_paths: vec![GitPathBuf::from_bytes(b"working.txt".to_vec())],
        staged_paths: vec![GitPathBuf::from_bytes(b"staged.txt".to_vec())],
        conflicted_paths: vec![GitPathBuf::from_bytes(b"conflict.txt".to_vec())],
        paths_truncated: false,
        sequencer: Some(sequencer.clone()),
        preview_token: "c".repeat(64),
    });
    let value = serde_json::to_value(preview).unwrap();
    assert_eq!(value["operation"], "merge");
    assert_eq!(
        value["workingTreePaths"],
        serde_json::json!(["working.txt"])
    );
    assert_eq!(value["sequencer"]["kind"], "merge");
    assert_eq!(value["previewToken"], "c".repeat(64));
    assert!(value.get("preview_token").is_none());

    let outcome = GitHistoryMutationOutcomeWire::from(HistoryMutationOutcome {
        kind: HistoryMutationOutcomeKind::Conflicts,
        state: HistoryState {
            head_sha: "b".repeat(40),
            sequencer: Some(sequencer),
        },
    });
    assert_eq!(
        serde_json::to_value(outcome).unwrap(),
        serde_json::json!({
            "kind": "conflicts",
            "state": {
                "headSha": "b".repeat(40),
                "sequencer": {
                    "kind": "merge",
                    "conflictedPaths": ["conflict.txt"],
                    "pathsTruncated": false
                }
            }
        })
    );
}
