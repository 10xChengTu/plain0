use super::{WorkspaceSearchFilesRequest, WorkspaceSearchFilesResult, MAX_SEARCH_RESULTS_HARD_CAP};

const ROOT_A: &str = "00000000-0000-4000-8000-000000000001";
const ROOT_B: &str = "00000000-0000-4000-8000-000000000002";

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
    let result = WorkspaceSearchFilesResult::new(vec!["src/main.rs".to_owned()], true);
    let value = serde_json::to_value(&result).unwrap();
    let object = value.as_object().unwrap();
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(keys, ["entries", "limitHit"]);
    assert_eq!(value["entries"], serde_json::json!(["src/main.rs"]));
    assert_eq!(value["limitHit"], true);
    assert_eq!(result.entries(), ["src/main.rs"]);
    assert!(result.limit_hit());
}
