use super::{
    SearchId, WorkspaceSearchExpandReplacementsRequest, WorkspaceSearchFileEntry,
    WorkspaceSearchFilesRequest, WorkspaceSearchFilesResult, WorkspaceSearchTextBatch,
    WorkspaceSearchTextCancelRequest, WorkspaceSearchTextMatch, WorkspaceSearchTextPollRequest,
    WorkspaceSearchTextPollResult, WorkspaceSearchTextSkipped, WorkspaceSearchTextStartRequest,
    WorkspaceSearchTextStartResult, WorkspaceSearchTextWakeEvent, MAX_SEARCH_RESULTS_HARD_CAP,
    MAX_TEXT_SEARCH_RESULTS_HARD_CAP,
};
use crate::workspace::RootId;

const ROOT_A: &str = "00000000-0000-4000-8000-000000000001";
const ROOT_B: &str = "00000000-0000-4000-8000-000000000002";

fn root_id(value: &str) -> RootId {
    serde_json::from_value(serde_json::json!(value)).unwrap()
}

fn request(value: serde_json::Value) -> Result<WorkspaceSearchFilesRequest, ()> {
    serde_json::from_value(value).map_err(|_| ())
}

#[test]
fn valid_request_round_trips_and_clamps_max_results() {
    let query = request(serde_json::json!({
        "roots": [ROOT_A, ROOT_B],
        "filePattern": "main",
        "excludeGlobs": ["**/node_modules"],
        "maxResults": 10,
    }))
    .unwrap()
    .into_parts()
    .unwrap();
    assert_eq!(query.roots.len(), 2);
    assert_eq!(query.file_pattern, "main");
    assert_eq!(query.exclude_globs, ["**/node_modules"]);
    assert_eq!(query.max_results, 10);
}

#[test]
fn max_results_is_clamped_to_a_safe_always_satisfiable_range() {
    let zero = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "",
        "excludeGlobs": [],
        "maxResults": 0,
    }))
    .unwrap()
    .into_parts()
    .unwrap();
    assert_eq!(zero.max_results, 1);

    let huge = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "",
        "excludeGlobs": [],
        "maxResults": 4_000_000_000_u32,
    }))
    .unwrap()
    .into_parts()
    .unwrap();
    assert_eq!(huge.max_results, MAX_SEARCH_RESULTS_HARD_CAP as usize);
}

#[test]
fn empty_or_oversized_roots_are_rejected() {
    let empty = request(serde_json::json!({
        "roots": [],
        "filePattern": "",
        "excludeGlobs": [],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        empty.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );

    let roots = (0..257)
        .map(|index| format!("00000000-0000-4000-8000-{index:012}"))
        .collect::<Vec<_>>();
    let oversized = request(serde_json::json!({
        "roots": roots,
        "filePattern": "",
        "excludeGlobs": [],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        oversized.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn oversized_file_pattern_is_rejected() {
    let request = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "a".repeat(4_097),
        "excludeGlobs": [],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        request.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn exclude_globs_are_bounded_in_count_and_length_and_reject_empty_strings() {
    let too_many = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "",
        "excludeGlobs": vec!["**/a"; 65],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        too_many.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );

    let too_long = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "",
        "excludeGlobs": ["*".repeat(1_025)],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        too_long.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );

    let empty_glob = request(serde_json::json!({
        "roots": [ROOT_A],
        "filePattern": "",
        "excludeGlobs": [""],
        "maxResults": 512,
    }))
    .unwrap();
    assert_eq!(
        empty_glob.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn request_is_a_closed_set_of_exactly_four_camel_case_fields() {
    for invalid in [
        serde_json::json!({
            "roots": [ROOT_A],
            "filePattern": "",
            "excludeGlobs": [],
            "maxResults": 512,
            "includeGlobs": [],
        }),
        serde_json::json!({
            "roots": [ROOT_A],
            "filePattern": "",
            "excludeGlobs": [],
            "maxResults": 512,
            "useIgnoreFiles": true,
        }),
        serde_json::json!({
            "roots": [ROOT_A],
            "filePattern": "",
            "maxResults": 512,
        }),
    ] {
        assert!(
            serde_json::from_value::<WorkspaceSearchFilesRequest>(invalid.clone()).is_err(),
            "request must reject {invalid}"
        );
    }
}

#[test]
fn result_serializes_as_the_exact_frozen_camel_case_contract() {
    let result = WorkspaceSearchFilesResult::new(
        vec![WorkspaceSearchFileEntry::new(
            root_id(ROOT_B),
            "src/main.rs".to_owned(),
        )],
        true,
    );
    let value = serde_json::to_value(&result).unwrap();
    let object = value.as_object().unwrap();
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(keys, ["entries", "limitHit"]);
    assert_eq!(
        value["entries"],
        serde_json::json!([{ "rootId": ROOT_B, "path": "src/main.rs" }])
    );
    assert_eq!(value["limitHit"], true);
    assert_eq!(result.entries(), ["src/main.rs"]);
    assert!(result.limit_hit());
}

// --- Streaming text search (F040 S3) ----------------------------------------

fn text_start_request(value: serde_json::Value) -> Result<WorkspaceSearchTextStartRequest, ()> {
    serde_json::from_value(value).map_err(|_| ())
}

fn base_text_start_json() -> serde_json::Value {
    serde_json::json!({
        "roots": [ROOT_A],
        "pattern": "needle",
        "isRegExp": false,
        "isCaseSensitive": false,
        "isWordMatch": false,
        "excludeGlobs": [],
        "maxResults": 512,
        "maxFileSize": null,
    })
}

#[test]
fn text_start_request_round_trips_and_defaults_max_file_size() {
    let query = text_start_request(base_text_start_json())
        .unwrap()
        .into_parts()
        .unwrap();
    assert_eq!(query.roots.len(), 1);
    assert_eq!(query.pattern, "needle");
    assert!(!query.is_reg_exp);
    assert!(!query.is_case_sensitive);
    assert!(!query.is_word_match);
    assert_eq!(query.max_results, 512);
    assert_eq!(query.max_file_size, 8 * 1_024 * 1_024);
}

#[test]
fn text_start_request_clamps_max_results_and_max_file_size() {
    let mut huge = base_text_start_json();
    huge["maxResults"] = serde_json::json!(4_000_000_000_u32);
    huge["maxFileSize"] = serde_json::json!(u64::MAX);
    let query = text_start_request(huge).unwrap().into_parts().unwrap();
    assert_eq!(query.max_results, MAX_TEXT_SEARCH_RESULTS_HARD_CAP as usize);
    assert_eq!(query.max_file_size, 64 * 1_024 * 1_024);

    let mut zero = base_text_start_json();
    zero["maxResults"] = serde_json::json!(0);
    zero["maxFileSize"] = serde_json::json!(0);
    let query = text_start_request(zero).unwrap().into_parts().unwrap();
    assert_eq!(query.max_results, 1);
    assert_eq!(query.max_file_size, 1);
}

#[test]
fn text_start_request_rejects_empty_pattern_and_empty_roots() {
    let mut empty_pattern = base_text_start_json();
    empty_pattern["pattern"] = serde_json::json!("");
    assert_eq!(
        text_start_request(empty_pattern)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );

    let mut empty_roots = base_text_start_json();
    empty_roots["roots"] = serde_json::json!([]);
    assert_eq!(
        text_start_request(empty_roots)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn text_start_request_is_a_closed_set_of_exactly_eight_camel_case_fields() {
    let mut extra = base_text_start_json();
    extra["usePCRE2"] = serde_json::json!(true);
    assert!(serde_json::from_value::<WorkspaceSearchTextStartRequest>(extra).is_err());

    let mut missing = base_text_start_json();
    missing.as_object_mut().unwrap().remove("isWordMatch");
    assert!(serde_json::from_value::<WorkspaceSearchTextStartRequest>(missing).is_err());
}

#[test]
fn search_id_serializes_as_a_wire_string_and_is_redacted_in_debug() {
    let search_id = SearchId::new();
    let start_result = WorkspaceSearchTextStartResult::new(search_id);
    let value = serde_json::to_value(start_result).unwrap();
    let object = value.as_object().unwrap();
    assert_eq!(object.keys().collect::<Vec<_>>(), ["searchId"]);
    let wire = value["searchId"].as_str().unwrap();
    assert_eq!(wire, search_id.as_wire());
    assert!(is_valid_v4_uuid_wire(wire), "not a v4 UUID: {wire}");
    assert_eq!(start_result.search_id().as_wire().len(), 36);

    let debug = format!("{search_id:?}");
    assert!(!debug.contains(&wire.to_owned()));
    assert!(debug.contains("redacted"));
}

/// Minimal, dependency-free v4 hyphenated UUID string check — this crate's
/// production code never needs its own regex-based validator for this shape
/// (parsing goes through the `uuid` crate instead), so this stays local to
/// the test rather than becoming a new production helper.
fn is_valid_v4_uuid_wire(candidate: &str) -> bool {
    let bytes = candidate.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[14] == b'4'
        && bytes[18] == b'-'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes[23] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

#[test]
fn search_id_deserialize_rejects_non_v4_and_non_canonical_strings() {
    for invalid in [
        "not-a-uuid",
        "00000000-0000-0000-8000-000000000000", // version 0, not 4
        "00000000-0000-4000-0000-000000000000", // bad variant nibble
        "00000000-0000-4000-8000-00000000000",  // too short
        "00000000-0000-4000-8000-0000000000000", // too long
    ] {
        let wrapped = serde_json::json!({ "searchId": invalid });
        assert!(
            serde_json::from_value::<WorkspaceSearchTextCancelRequest>(wrapped).is_err(),
            "must reject {invalid}"
        );
    }
    // Contains real hex letters (unlike the all-digit fixture above, where
    // uppercasing would be a silent no-op): proves the strict lowercase-only
    // wire comparison, not just version/variant nibble checks.
    let uppercased = serde_json::json!({
        "searchId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".to_ascii_uppercase(),
    });
    assert!(serde_json::from_value::<WorkspaceSearchTextCancelRequest>(uppercased).is_err());

    let valid = serde_json::json!({ "searchId": ROOT_A });
    // ROOT_A is itself a valid v4 hyphenated UUID string, so it is also a
    // structurally valid (if semantically unrelated) SearchId wire value.
    let request: WorkspaceSearchTextCancelRequest = serde_json::from_value(valid).unwrap();
    assert_eq!(request.search_id().as_wire(), ROOT_A);
}

#[test]
fn text_poll_request_round_trips_and_rejects_extra_fields() {
    let request: WorkspaceSearchTextPollRequest = serde_json::from_value(serde_json::json!({
        "searchId": ROOT_A,
        "cursor": 3,
    }))
    .unwrap();
    let (search_id, cursor) = request.into_parts().unwrap();
    assert_eq!(search_id.as_wire(), ROOT_A);
    assert_eq!(cursor, 3);

    assert!(
        serde_json::from_value::<WorkspaceSearchTextPollRequest>(serde_json::json!({
            "searchId": ROOT_A,
            "cursor": 3,
            "extra": true,
        }))
        .is_err()
    );
}

#[test]
fn text_poll_result_serializes_the_exact_frozen_camel_case_contract() {
    let batch = WorkspaceSearchTextBatch::new(
        root_id(ROOT_B),
        "src/main.rs".to_owned(),
        vec![WorkspaceSearchTextMatch::new(
            1,
            5,
            6,
            "needle here".to_owned(),
            5,
        )],
    );
    let result = WorkspaceSearchTextPollResult::new(
        vec![batch],
        7,
        false,
        true,
        WorkspaceSearchTextSkipped::new(1, 2),
    );
    let value = serde_json::to_value(&result).unwrap();
    let object = value.as_object().unwrap();
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["batches", "done", "limitHit", "nextCursor", "skipped"]
    );
    assert_eq!(value["nextCursor"], 7);
    assert_eq!(value["done"], false);
    assert_eq!(value["limitHit"], true);
    assert_eq!(value["skipped"]["binary"], 1);
    assert_eq!(value["skipped"]["oversize"], 2);
    let batch_value = &value["batches"][0];
    assert_eq!(batch_value["rootId"], ROOT_B);
    assert_eq!(batch_value["path"], "src/main.rs");
    let match_value = &batch_value["matches"][0];
    assert_eq!(match_value["line"], 1);
    assert_eq!(match_value["column"], 5);
    assert_eq!(match_value["length"], 6);
    assert_eq!(match_value["previewText"], "needle here");
    assert_eq!(match_value["absoluteColumn"], 5);

    assert_eq!(result.next_cursor(), 7);
    assert!(!result.done());
    assert!(result.limit_hit());
    assert_eq!(result.skipped().binary(), 1);
    assert_eq!(result.skipped().oversize(), 2);
    assert_eq!(result.batches()[0].path(), "src/main.rs");
    assert_eq!(result.batches()[0].root_id(), root_id(ROOT_B));
    assert_eq!(
        result.batches()[0].matches()[0].preview_text(),
        "needle here"
    );
    assert_eq!(result.batches()[0].matches()[0].absolute_column(), 5);
}

#[test]
fn text_cancel_request_round_trips_and_rejects_extra_fields() {
    let request: WorkspaceSearchTextCancelRequest =
        serde_json::from_value(serde_json::json!({ "searchId": ROOT_A })).unwrap();
    assert_eq!(request.search_id().as_wire(), ROOT_A);

    assert!(
        serde_json::from_value::<WorkspaceSearchTextCancelRequest>(serde_json::json!({
            "searchId": ROOT_A,
            "extra": 1,
        }))
        .is_err()
    );
}

#[test]
fn text_wake_event_serializes_as_a_single_search_id_field() {
    let event = WorkspaceSearchTextWakeEvent::new(SearchId::new());
    let value = serde_json::to_value(event).unwrap();
    let object = value.as_object().unwrap();
    assert_eq!(object.keys().collect::<Vec<_>>(), ["searchId"]);
}

// --- Capture-group replacement expansion (F200 S2) --------------------------

fn expand_request(
    value: serde_json::Value,
) -> Result<WorkspaceSearchExpandReplacementsRequest, ()> {
    serde_json::from_value(value).map_err(|_| ())
}

fn valid_expand_request_json() -> serde_json::Value {
    serde_json::json!({
        "pattern": r"(\w+)-(\d+)",
        "isRegExp": true,
        "isCaseSensitive": false,
        "isWordMatch": false,
        "replacementTemplate": "$2-$1",
        "expectedTexts": ["item-42"],
    })
}

#[test]
fn valid_expand_request_round_trips() {
    let query = expand_request(valid_expand_request_json())
        .unwrap()
        .into_parts()
        .unwrap();
    assert_eq!(query.pattern, r"(\w+)-(\d+)");
    assert!(!query.is_case_sensitive);
    assert!(!query.is_word_match);
    assert_eq!(query.replacement_template, "$2-$1");
    assert_eq!(query.expected_texts, vec!["item-42".to_owned()]);
}

#[test]
fn expand_request_rejects_unknown_fields() {
    let mut json = valid_expand_request_json();
    json["extra"] = serde_json::json!(1);
    assert!(expand_request(json).is_err());
}

#[test]
fn expand_request_rejects_literal_mode_is_reg_exp_false() {
    let mut json = valid_expand_request_json();
    json["isRegExp"] = serde_json::json!(false);
    let request = expand_request(json).unwrap();
    assert_eq!(
        request.into_parts().unwrap_err().code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn expand_request_rejects_empty_or_oversized_pattern() {
    let mut empty = valid_expand_request_json();
    empty["pattern"] = serde_json::json!("");
    assert_eq!(
        expand_request(empty)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );

    let mut oversized = valid_expand_request_json();
    oversized["pattern"] = serde_json::json!("a".repeat(4_097));
    assert_eq!(
        expand_request(oversized)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn expand_request_rejects_oversized_replacement_template() {
    let mut json = valid_expand_request_json();
    json["replacementTemplate"] = serde_json::json!("$".repeat(4_097));
    assert_eq!(
        expand_request(json)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn expand_request_rejects_empty_or_oversized_expected_texts_list() {
    let mut empty = valid_expand_request_json();
    empty["expectedTexts"] = serde_json::json!([]);
    assert_eq!(
        expand_request(empty)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );

    let mut oversized = valid_expand_request_json();
    oversized["expectedTexts"] = serde_json::Value::Array(vec![serde_json::json!("x"); 20_001]);
    assert_eq!(
        expand_request(oversized)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );

    // The hard cap itself is satisfiable.
    let mut at_cap = valid_expand_request_json();
    at_cap["expectedTexts"] = serde_json::Value::Array(vec![serde_json::json!("x"); 20_000]);
    assert!(expand_request(at_cap).unwrap().into_parts().is_ok());
}

#[test]
fn expand_request_rejects_an_oversized_individual_expected_text() {
    let mut json = valid_expand_request_json();
    json["expectedTexts"] = serde_json::json!(["a".repeat(4_097)]);
    assert_eq!(
        expand_request(json)
            .unwrap()
            .into_parts()
            .unwrap_err()
            .code(),
        "INVALID_SEARCH_REQUEST"
    );
}

#[test]
fn expand_replacement_item_serializes_with_a_status_tag() {
    let ok = super::WorkspaceSearchExpandReplacementItem::ok("42-item".to_owned());
    let ok_value = serde_json::to_value(&ok).unwrap();
    assert_eq!(ok_value["status"], "ok");
    assert_eq!(ok_value["replacement"], "42-item");

    let error = super::WorkspaceSearchExpandReplacementItem::error(
        "SEARCH_REPLACE_EXPAND_NO_MATCH",
        "no match",
    );
    let error_value = serde_json::to_value(&error).unwrap();
    assert_eq!(error_value["status"], "error");
    assert_eq!(error_value["code"], "SEARCH_REPLACE_EXPAND_NO_MATCH");
    assert_eq!(error_value["message"], "no match");
}
