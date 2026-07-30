use super::{
    OutputGate, OutputGateOutcome, DEBUG_OUTPUT_HIGH_WATER_EVENTS, DEBUG_OUTPUT_MAX_CATEGORIES,
    DEBUG_OUTPUT_MERGE_CAP_BYTES,
};

fn expect_emit(outcome: OutputGateOutcome) -> u64 {
    match outcome {
        OutputGateOutcome::Emit(sequence) => sequence,
        OutputGateOutcome::Buffered => panic!("expected Emit, got Buffered"),
    }
}

fn expect_buffered(outcome: OutputGateOutcome) {
    match outcome {
        OutputGateOutcome::Buffered => {}
        OutputGateOutcome::Emit(sequence) => {
            panic!("expected Buffered, got Emit({sequence})")
        }
    }
}

#[test]
fn emits_every_event_immediately_while_under_the_high_water_mark() {
    let gate = OutputGate::new();
    let mut previous = 0;
    for _ in 0..(DEBUG_OUTPUT_HIGH_WATER_EVENTS - 1) {
        let sequence = expect_emit(gate.on_output("stdout", "line\n"));
        assert!(sequence > previous, "sequence must strictly increase");
        previous = sequence;
    }
    assert_eq!(gate.merged_category_count_for_test(), 0);
}

#[test]
fn reaching_the_high_water_mark_switches_to_merging() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "line\n"));
    }
    assert_eq!(gate.unacked_for_test(), DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    // Credit is now fully spent — the very next event must be merged, not
    // emitted, regardless of its own category.
    expect_buffered(gate.on_output("stdout", "one more line\n"));
    assert_eq!(gate.merged_category_count_for_test(), 1);
}

#[test]
fn merged_content_for_a_brand_new_category_still_buffers_while_backlog_exists() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "line\n"));
    }
    expect_buffered(gate.on_output("stdout", "first backlog chunk\n"));
    // `stderr` has never been merged before, and considered on its own would
    // have plenty of "per-category" room — but the gate is a global backlog
    // decision, not a per-category one, so this must still buffer rather
    // than jump the queue and emit immediately.
    expect_buffered(gate.on_output("stderr", "a brand new category\n"));
    assert_eq!(gate.merged_category_count_for_test(), 2);
}

#[test]
fn merge_buffer_concatenates_multiple_chunks_for_the_same_category_in_order() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "x"));
    }
    expect_buffered(gate.on_output("stdout", "alpha "));
    expect_buffered(gate.on_output("stdout", "beta "));
    expect_buffered(gate.on_output("stdout", "gamma"));

    // Ack everything already emitted so the merge fully drains.
    let flushed = gate.ack(DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    assert_eq!(flushed.len(), 1);
    let entry = &flushed[0];
    assert_eq!(entry.category, "stdout");
    assert_eq!(entry.text, "alpha beta gamma");
    assert_eq!(entry.elided_bytes, 0);
    assert_eq!(entry.elided_lines, 0);
}

#[test]
fn merge_buffer_drops_the_oldest_bytes_once_the_per_category_cap_is_exceeded_and_reports_the_elision(
) {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "x"));
    }

    // Push a distinguishable "oldest" marker, then pad well past the cap,
    // then a distinguishable "newest" marker — proves the retained tail is
    // the *newest* content, not the oldest.
    expect_buffered(gate.on_output("stdout", "OLDEST-MARKER\n"));
    let padding = "a".repeat(DEBUG_OUTPUT_MERGE_CAP_BYTES + 4096);
    expect_buffered(gate.on_output("stdout", &padding));
    expect_buffered(gate.on_output("stdout", "\nNEWEST-MARKER"));

    let flushed = gate.ack(DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    assert_eq!(flushed.len(), 1);
    let entry = &flushed[0];
    assert!(entry.text.len() <= DEBUG_OUTPUT_MERGE_CAP_BYTES);
    assert!(
        !entry.text.contains("OLDEST-MARKER"),
        "the oldest content must have been dropped, not retained"
    );
    assert!(
        entry.text.ends_with("NEWEST-MARKER"),
        "the newest content must be retained at the tail"
    );
    assert!(
        entry.elided_bytes > 0,
        "some content must be reported dropped"
    );
    assert_eq!(
        entry.elided_bytes as usize + entry.text.len(),
        "OLDEST-MARKER\n".len() + padding.len() + "\nNEWEST-MARKER".len(),
        "every byte must be accounted for as either kept or elided, never silently lost"
    );
}

#[test]
fn ack_is_tolerant_of_stale_duplicate_and_out_of_order_acks() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "x"));
    }
    expect_buffered(gate.on_output("stdout", "buffered\n"));

    // Ack enough to free exactly one slot: the one merged category must
    // drain.
    let flushed = gate.ack(DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    assert_eq!(flushed.len(), 1);

    // A stale ack — for a sequence already superseded by the ack above —
    // must be a harmless no-op: it must not regress `highest_acked` or
    // re-flush anything a second time.
    assert!(
        gate.ack(1).is_empty(),
        "a stale ack must not re-flush anything"
    );

    // A duplicate/out-of-order ack for the same (or an even later,
    // clamped-to-highest-emitted) sequence must also be a harmless no-op, not
    // a panic or a negative-credit underflow.
    assert!(gate.ack(u64::MAX).is_empty());
}

#[test]
fn ack_drains_multiple_merged_categories_in_one_call_when_credit_allows() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "x"));
    }
    expect_buffered(gate.on_output("stdout", "out\n"));
    expect_buffered(gate.on_output("stderr", "err\n"));
    expect_buffered(gate.on_output("console", "console\n"));
    assert_eq!(gate.merged_category_count_for_test(), 3);

    let flushed = gate.ack(DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    assert_eq!(flushed.len(), 3);
    let mut categories: Vec<&str> = flushed
        .iter()
        .map(|entry| entry.category.as_str())
        .collect();
    categories.sort_unstable();
    assert_eq!(categories, ["console", "stderr", "stdout"]);
    assert_eq!(gate.merged_category_count_for_test(), 0);
}

#[test]
fn category_bucket_count_is_capped_and_overflow_categories_share_one_bucket() {
    let gate = OutputGate::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        expect_emit(gate.on_output("stdout", "x"));
    }
    // Feed far more distinct category strings than the cap allows — a
    // hostile/malformed adapter minting a unique category per event.
    for index in 0..(DEBUG_OUTPUT_MAX_CATEGORIES * 4) {
        expect_buffered(gate.on_output(&format!("category-{index}"), "chunk"));
    }
    assert!(
        gate.merged_category_count_for_test() <= DEBUG_OUTPUT_MAX_CATEGORIES,
        "distinct merged buckets must never exceed the declared cap, no matter how many \
         distinct category strings the adapter sends"
    );
}

#[test]
fn sequence_numbers_are_never_reused_across_immediate_emits_and_later_flushes() {
    let gate = OutputGate::new();
    let mut seen = std::collections::HashSet::new();
    for _ in 0..DEBUG_OUTPUT_HIGH_WATER_EVENTS {
        let sequence = expect_emit(gate.on_output("stdout", "x"));
        assert!(
            seen.insert(sequence),
            "sequence {sequence} was assigned twice"
        );
    }
    expect_buffered(gate.on_output("stdout", "a\n"));
    expect_buffered(gate.on_output("stderr", "b\n"));
    let flushed = gate.ack(DEBUG_OUTPUT_HIGH_WATER_EVENTS);
    for entry in &flushed {
        assert!(
            seen.insert(entry.sequence),
            "sequence {} was assigned twice across emit and flush",
            entry.sequence
        );
    }
}
