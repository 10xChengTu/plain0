use super::expand_replacements;
use crate::search::dto::{WorkspaceSearchExpandReplacementsQuery, MAX_REPLACE_EXPAND_OUTPUT_BYTES};

fn query(
    pattern: &str,
    template: &str,
    expected_texts: &[&str],
) -> WorkspaceSearchExpandReplacementsQuery {
    WorkspaceSearchExpandReplacementsQuery {
        pattern: pattern.to_owned(),
        is_case_sensitive: true,
        is_word_match: false,
        replacement_template: template.to_owned(),
        expected_texts: expected_texts
            .iter()
            .map(|text| (*text).to_owned())
            .collect(),
    }
}

#[test]
fn expands_numbered_groups_and_the_whole_match() {
    let result = expand_replacements(query(r"(\w+)-(\d+)", "$2-$1 ($0)", &["item-42"])).unwrap();
    assert_eq!(result.items().len(), 1);
    assert_eq!(result.items()[0].as_ok(), Some("42-item (item-42)"));
}

#[test]
fn dollar_dollar_escapes_to_a_literal_dollar() {
    let result = expand_replacements(query(r"(\w+)", "$$$1", &["price"])).unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("$price"));
}

#[test]
fn expands_named_groups() {
    let result = expand_replacements(query(
        r"(?P<year>\d{4})-(?P<month>\d{2})",
        "$month/$year",
        &["2026-08"],
    ))
    .unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("08/2026"));
}

#[test]
fn braced_named_group_disambiguates_from_trailing_text() {
    let result = expand_replacements(query(r"(?P<a>\w+)", "${a}_suffix", &["needle"])).unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("needle_suffix"));
}

#[test]
fn out_of_range_numbered_group_fails_closed_per_entry() {
    let result = expand_replacements(query(r"(\w+)", "$1-$2", &["needle"])).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_INVALID_GROUP")
    );
}

#[test]
fn unresolvable_named_group_fails_closed_per_entry() {
    let result = expand_replacements(query(r"(\w+)", "$nope", &["needle"])).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_INVALID_GROUP")
    );
}

#[test]
fn in_range_non_participating_group_expands_to_empty_string_not_an_error() {
    // Group 1 participates for "cat", group 2 never does; referencing group 2
    // is in-range (capture_count is 3: whole match + two groups) so it must
    // NOT be treated the same as an out-of-range reference.
    let result = expand_replacements(query(r"(cat)|(dog)", "[$1][$2]", &["cat"])).unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("[cat][]"));
}

#[test]
fn anchored_rematch_failure_is_fail_closed_not_a_partial_match() {
    // "needle" contains "eed" but the recorded expectedText is no longer
    // exactly what the pattern matches in full.
    let result = expand_replacements(query("eed", "$0", &["needle"])).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_NO_MATCH")
    );
}

#[test]
fn no_match_at_all_is_fail_closed() {
    let result = expand_replacements(query("zzz", "$0", &["needle"])).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_NO_MATCH")
    );
}

#[test]
fn output_over_the_byte_cap_fails_closed_per_entry_not_the_whole_command() {
    let long_match = "a".repeat(MAX_REPLACE_EXPAND_OUTPUT_BYTES);
    let result = expand_replacements(query(
        r"(a+)",
        "$1$1$1", // triples the match length, well past the cap
        &[&long_match, "aaa"],
    ))
    .unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_TOO_LARGE")
    );
    // A sibling entry in the same batch is unaffected by the first one's
    // failure.
    assert_eq!(result.items()[1].as_error_code(), None);
}

#[test]
fn each_entry_is_evaluated_independently_in_the_same_batch() {
    let result = expand_replacements(query(r"(\w+)", "$1!", &["alpha", "beta", "gamma"])).unwrap();
    assert_eq!(result.items().len(), 3);
    assert_eq!(result.items()[0].as_ok(), Some("alpha!"));
    assert_eq!(result.items()[1].as_ok(), Some("beta!"));
    assert_eq!(result.items()[2].as_ok(), Some("gamma!"));
}

#[test]
fn case_sensitivity_flag_is_honored_by_the_rematch() {
    let mut sensitive = query(r"needle", "$0", &["NEEDLE"]);
    sensitive.is_case_sensitive = true;
    let result = expand_replacements(sensitive).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_NO_MATCH")
    );

    let mut insensitive = query(r"needle", "$0", &["NEEDLE"]);
    insensitive.is_case_sensitive = false;
    let result = expand_replacements(insensitive).unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("NEEDLE"));
}

#[test]
fn word_match_flag_is_honored_by_the_rematch() {
    // Without word matching, "cat" alone anchored-matches "cat" fine, but the
    // *search* that produced "concatenate" as a substring hit would never
    // have recorded "concatenate" itself as expectedText for pattern "cat" —
    // this test instead proves the flag changes what counts as a full-string
    // anchored match: with `isWordMatch`, the pattern is wrapped in `\b`,
    // so it still matches a standalone word...
    let mut word_matched = query(r"cat", "$0", &["cat"]);
    word_matched.is_word_match = true;
    let result = expand_replacements(word_matched).unwrap();
    assert_eq!(result.items()[0].as_ok(), Some("cat"));

    // ...but no longer matches when the same literal isn't itself a whole
    // word (here the recorded text is not a word boundary case at all).
    let mut word_matched_partial = query(r"cat", "$0", &["cats"]);
    word_matched_partial.is_word_match = true;
    let result = expand_replacements(word_matched_partial).unwrap();
    assert_eq!(
        result.items()[0].as_error_code(),
        Some("SEARCH_REPLACE_EXPAND_NO_MATCH")
    );
}

#[test]
fn invalid_pattern_fails_the_whole_command_not_per_entry() {
    let error = expand_replacements(query("(unclosed", "$0", &["x"])).unwrap_err();
    assert_eq!(error.code(), "INVALID_SEARCH_REGEX");
}

#[test]
fn pcre2_only_constructs_are_rejected_as_invalid_regex() {
    for pattern in ["(?=lookahead)", "(?<=lookbehind)", r"(a)\1"] {
        let error = expand_replacements(query(pattern, "$0", &["a"])).unwrap_err();
        assert_eq!(error.code(), "INVALID_SEARCH_REGEX");
        assert!(!error.message().is_empty());
    }
}
