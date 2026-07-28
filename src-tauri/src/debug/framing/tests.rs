//! [`FrameDecoder`] contract tests. Covers every malformed-input case this
//! slice's own report enumerates (header/body split across reads, multiple
//! messages in one `feed` call, malformed/oversized `Content-Length`, a
//! header that never terminates, and the deliberate `\n\n`-is-never-valid
//! choice) plus the two mandatory fixed-shape stress categories the task
//! requires: byte-by-byte feeding and randomly-split feeding across several
//! fixed-seed partitions of the same byte stream, both proving the exact same
//! messages come out regardless of how the bytes were chopped up.

use super::{DecodedMessage, FrameDecoder, FramingError, MAX_DAP_HEADER_BYTES};

fn encode_message(body: &[u8]) -> Vec<u8> {
    let mut framed = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    framed.extend_from_slice(body);
    framed
}

fn encode_messages(bodies: &[Vec<u8>]) -> Vec<u8> {
    let mut framed = Vec::new();
    for body in bodies {
        framed.extend(encode_message(body));
    }
    framed
}

/// Frozen regression fixture: the real `lldb-dap` `initialize` response byte
/// shape captured in `docs/research/2026-07-28-generic-dap.md`'s "协议基础
/// 事实" section (`Content-Length: 1646\r\n\r\n{"body":{"$__lldb_version"...`).
/// The doc's own quoted JSON is truncated with `...` in several places (the
/// full `exceptionBreakpointFilters` array is elided as "6 个过滤器", the tail
/// of the object is elided too) — this fixture reconstructs a complete, valid
/// JSON object using every field the doc actually names
/// (`$__lldb_version`, all six named exception-breakpoint filters split by
/// language/kind, every `supportsXxx` flag it lists, and the envelope fields
/// `command`/`request_seq`/`seq`/`success`/`type`, including the doc's own
/// highlighted "`seq` is `0`, not `1`" real-world surprise). This is
/// deliberately **not** claimed to be a byte-for-byte reproduction of the
/// original capture: the doc did not preserve the full literal bytes, only
/// representative fields, so the `Content-Length` header below is computed
/// from *this* reconstructed body's real length, never hardcoded to the doc's
/// `1646` (which was measured against the original, uncaptured full text).
fn lldb_dap_initialize_response_body() -> Vec<u8> {
    br#"{"body":{"$__lldb_version":"lldb-2100.0.16.4","exceptionBreakpointFilters":[{"filter":"cpp_catch","label":"C++ Catch"},{"filter":"cpp_throw","label":"C++ Throw"},{"filter":"objc_catch","label":"Objective-C Catch"},{"filter":"objc_throw","label":"Objective-C Throw"},{"filter":"swift_catch","label":"Swift Catch"},{"filter":"swift_throw","label":"Swift Throw"}],"supportsConditionalBreakpoints":true,"supportsConfigurationDoneRequest":true,"supportsDataBreakpoints":true,"supportsDelayedStackTraceLoading":true,"supportsDisassembleRequest":true,"supportsSteppingGranularity":true},"command":"initialize","request_seq":1,"seq":0,"success":true,"type":"response"}"#.to_vec()
}

/// A small synthetic multi-message session (plus the real fixture above) used
/// as the shared input for the byte-by-byte and random-split stress tests —
/// several distinct message shapes (`request`/`response`/`event`) back to
/// back, so a boundary-handling bug that only shows up between two
/// *different*-length messages has a chance to surface.
fn sample_session_bodies() -> Vec<Vec<u8>> {
    vec![
        br#"{"seq":1,"type":"request","command":"initialize"}"#.to_vec(),
        br#"{"seq":2,"type":"response","request_seq":1,"success":true,"command":"initialize","body":{}}"#.to_vec(),
        br#"{"seq":3,"type":"event","event":"initialized"}"#.to_vec(),
        lldb_dap_initialize_response_body(),
        br#"{"seq":4,"type":"event","event":"output","body":{"category":"stdout","output":"sum=7\n"}}"#.to_vec(),
    ]
}

// ---------------------------------------------------------------------
// Basic decode shape
// ---------------------------------------------------------------------

#[test]
fn a_single_complete_message_in_one_feed_call_decodes() {
    let body = br#"{"seq":1,"type":"event","event":"output"}"#.to_vec();
    let framed = encode_message(&body);
    let mut decoder = FrameDecoder::new();
    let messages = decoder.feed(&framed).expect("well-formed message decodes");
    assert_eq!(
        messages,
        vec![DecodedMessage {
            content_length: body.len(),
            body,
        }]
    );
}

#[test]
fn a_zero_length_content_length_decodes_an_empty_body_message_immediately() {
    let mut decoder = FrameDecoder::new();
    let messages = decoder
        .feed(b"Content-Length: 0\r\n\r\n")
        .expect("zero-length body decodes without waiting for further bytes");
    assert_eq!(
        messages,
        vec![DecodedMessage {
            content_length: 0,
            body: Vec::new(),
        }]
    );
}

#[test]
fn content_length_value_surrounding_whitespace_is_trimmed() {
    let body = vec![b'x'; 10];
    let mut framed = b"Content-Length:    10   \r\n\r\n".to_vec();
    framed.extend_from_slice(&body);
    let mut decoder = FrameDecoder::new();
    let messages = decoder
        .feed(&framed)
        .expect("whitespace around the header value is tolerated");
    assert_eq!(messages[0].body, body);
}

#[test]
fn a_single_feed_call_can_decode_every_back_to_back_message_in_the_chunk() {
    let bodies = sample_session_bodies();
    let framed = encode_messages(&bodies);
    let mut decoder = FrameDecoder::new();
    let messages = decoder
        .feed(&framed)
        .expect("a whole well-formed multi-message stream decodes in one call");
    assert_eq!(messages.len(), bodies.len());
    for (message, expected_body) in messages.iter().zip(bodies.iter()) {
        assert_eq!(&message.body, expected_body);
    }
}

#[test]
fn a_message_boundary_landing_exactly_at_a_chunk_end_still_decodes_both_messages() {
    let first_body = br#"{"seq":1,"type":"event","event":"a"}"#.to_vec();
    let second_body = br#"{"seq":2,"type":"event","event":"b"}"#.to_vec();
    let mut decoder = FrameDecoder::new();

    let first_messages = decoder
        .feed(&encode_message(&first_body))
        .expect("first message, ending exactly at this chunk's end, decodes");
    assert_eq!(
        first_messages,
        vec![DecodedMessage {
            content_length: first_body.len(),
            body: first_body,
        }]
    );

    let second_messages = decoder
        .feed(&encode_message(&second_body))
        .expect("second message decodes from the next chunk");
    assert_eq!(
        second_messages,
        vec![DecodedMessage {
            content_length: second_body.len(),
            body: second_body,
        }]
    );
}

// ---------------------------------------------------------------------
// Splitting across multiple `feed` calls
// ---------------------------------------------------------------------

#[test]
fn a_header_split_across_multiple_feed_calls_still_decodes() {
    let body = br#"{"seq":1,"type":"event","event":"output"}"#.to_vec();
    let framed = encode_message(&body);
    let header_len = framed.len() - body.len();
    let split_at = header_len / 2;
    assert!(
        split_at > 0,
        "fixture must actually split inside the header"
    );

    let mut decoder = FrameDecoder::new();
    let first = decoder
        .feed(&framed[..split_at])
        .expect("a partial header is not itself an error");
    assert!(first.is_empty());
    let second = decoder
        .feed(&framed[split_at..])
        .expect("the remainder completes the header and the whole message");
    assert_eq!(
        second,
        vec![DecodedMessage {
            content_length: body.len(),
            body
        }]
    );
}

#[test]
fn a_body_split_across_multiple_feed_calls_still_decodes() {
    let body = br#"{"seq":1,"type":"event","event":"a fairly long body on purpose"}"#.to_vec();
    let framed = encode_message(&body);
    let header_len = framed.len() - body.len();
    let split_at = header_len + body.len() / 2;

    let mut decoder = FrameDecoder::new();
    let first = decoder
        .feed(&framed[..split_at])
        .expect("a partial body is not itself an error");
    assert!(first.is_empty());
    let second = decoder
        .feed(&framed[split_at..])
        .expect("the remainder completes the body");
    assert_eq!(
        second,
        vec![DecodedMessage {
            content_length: body.len(),
            body
        }]
    );
}

#[test]
fn byte_by_byte_feeding_reconstructs_every_message_in_a_multi_message_session() {
    let bodies = sample_session_bodies();
    let framed = encode_messages(&bodies);
    let mut decoder = FrameDecoder::new();
    let mut decoded = Vec::new();
    for byte in &framed {
        let mut messages = decoder
            .feed(std::slice::from_ref(byte))
            .expect("a well-formed stream decodes even one byte at a time");
        decoded.append(&mut messages);
    }
    assert_eq!(decoded.len(), bodies.len());
    for (message, expected_body) in decoded.iter().zip(bodies.iter()) {
        assert_eq!(&message.body, expected_body);
    }
}

/// Tiny deterministic PRNG (splitmix64) used only to choose fixed-seed random
/// chunk-partition boundaries for the test below — no new crate dependency
/// needed, and a fixed seed makes every run of this test reproducible.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A chunk length between 1 and `remaining.min(7)` inclusive — capped
    /// small on purpose so a long byte stream still gets split into many
    /// chunks instead of occasionally drawing one giant chunk that defeats
    /// the point of this test.
    fn next_chunk_len(&mut self, remaining: usize) -> usize {
        let max_len = remaining.clamp(1, 7);
        1 + (self.next_u64() as usize % max_len)
    }
}

fn random_split_feed(bytes: &[u8], seed: u64) -> Vec<DecodedMessage> {
    let mut rng = SplitMix64::new(seed);
    let mut decoder = FrameDecoder::new();
    let mut decoded = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        let len = rng.next_chunk_len(bytes.len() - offset);
        let mut messages = decoder
            .feed(&bytes[offset..offset + len])
            .expect("a well-formed stream decodes regardless of chunk boundaries");
        decoded.append(&mut messages);
        offset += len;
    }
    decoded
}

#[test]
fn randomly_split_feeding_reconstructs_every_message_regardless_of_chunk_boundaries() {
    let bodies = sample_session_bodies();
    let framed = encode_messages(&bodies);
    for seed in [1_u64, 42, 1_337, 777_777, 9_001] {
        let decoded = random_split_feed(&framed, seed);
        assert_eq!(decoded.len(), bodies.len(), "seed {seed}");
        for (message, expected_body) in decoded.iter().zip(bodies.iter()) {
            assert_eq!(&message.body, expected_body, "seed {seed}");
        }
    }
}

// ---------------------------------------------------------------------
// Real captured evidence, frozen as a regression fixture
// ---------------------------------------------------------------------

#[test]
fn lldb_dap_initialize_response_fixture_decodes_as_a_single_complete_message() {
    let body = lldb_dap_initialize_response_body();
    let framed = encode_message(&body);
    let mut decoder = FrameDecoder::new();
    let messages = decoder
        .feed(&framed)
        .expect("the frozen lldb-dap fixture decodes");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content_length, body.len());
    let text = String::from_utf8(messages[0].body.clone()).expect("fixture body is valid utf8");
    assert!(text.contains("\"seq\":0"));
    assert!(text.contains("\"request_seq\":1"));
    assert!(text.contains("lldb-2100.0.16.4"));
    assert!(text.contains("supportsDisassembleRequest"));
}

// ---------------------------------------------------------------------
// Unknown header fields / Content-Length casing
// ---------------------------------------------------------------------

#[test]
fn unknown_header_fields_are_tolerated_and_ignored() {
    let body = br#"{"seq":1,"type":"event","event":"output"}"#.to_vec();
    let mut framed = format!(
        "X-Plain-Test: ignored\r\nContent-Length: {}\r\nX-Another: also-ignored\r\n\r\n",
        body.len()
    )
    .into_bytes();
    framed.extend_from_slice(&body);
    let mut decoder = FrameDecoder::new();
    let messages = decoder
        .feed(&framed)
        .expect("unknown header fields must not break decoding");
    assert_eq!(
        messages,
        vec![DecodedMessage {
            content_length: body.len(),
            body
        }]
    );
}

#[test]
fn a_differently_cased_content_length_header_is_not_recognized() {
    let framed = b"content-length: 5\r\n\r\nhello".to_vec();
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(&framed)
        .expect_err("lowercase header name must not match");
    assert_eq!(error, FramingError::MissingContentLength);
}

// ---------------------------------------------------------------------
// Missing / malformed / oversized Content-Length
// ---------------------------------------------------------------------

#[test]
fn an_empty_header_block_is_missing_content_length() {
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(b"\r\n\r\n")
        .expect_err("an empty header block has no fields at all");
    assert_eq!(error, FramingError::MissingContentLength);
}

#[test]
fn a_header_block_without_content_length_is_an_error() {
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(b"X-Custom: 1\r\n\r\n")
        .expect_err("no Content-Length field is present");
    assert_eq!(error, FramingError::MissingContentLength);
}

#[test]
fn a_non_numeric_content_length_value_is_invalid() {
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(b"Content-Length: banana\r\n\r\n")
        .expect_err("non-numeric text does not parse as usize");
    assert_eq!(error, FramingError::InvalidContentLength);
}

#[test]
fn a_negative_content_length_value_is_invalid() {
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(b"Content-Length: -5\r\n\r\n")
        .expect_err("a negative number does not parse as usize");
    assert_eq!(error, FramingError::InvalidContentLength);
}

#[test]
fn a_content_length_value_with_too_many_digits_to_fit_usize_is_invalid() {
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(b"Content-Length: 999999999999999999999999999999999999999999\r\n\r\n")
        .expect_err("a value with too many digits overflows usize");
    assert_eq!(error, FramingError::InvalidContentLength);
}

#[test]
fn a_content_length_exceeding_the_message_cap_fails_promptly_without_buffering_the_claimed_size() {
    // Only a handful of body bytes ever follow the (enormous, but validly
    // numeric) claimed Content-Length — if the decoder tried to wait for or
    // allocate anywhere near the claimed size, this call would return
    // `Ok(vec![])` (still waiting for more body bytes) instead of promptly
    // erroring out the moment the header itself was parsed.
    let framed = b"Content-Length: 9999999999999\r\n\r\nabc".to_vec();
    let mut decoder = FrameDecoder::new();
    let error = decoder
        .feed(&framed)
        .expect_err("a validly-numeric but policy-exceeding length must fail immediately");
    assert_eq!(error, FramingError::MessageTooLarge);
}

// ---------------------------------------------------------------------
// Header that never terminates (bounded by MAX_DAP_HEADER_BYTES),
// including the `\r\n` vs `\n` separator-strictness proof
// ---------------------------------------------------------------------

#[test]
fn a_header_block_that_never_terminates_fails_once_the_cap_is_exceeded() {
    let mut decoder = FrameDecoder::new();
    let filler = vec![b'A'; MAX_DAP_HEADER_BYTES + 1];
    let error = decoder
        .feed(&filler)
        .expect_err("a header with no terminator anywhere must eventually fail, not hang");
    assert_eq!(error, FramingError::HeaderTooLarge);
}

#[test]
fn lf_only_separator_under_the_cap_never_resolves_as_a_valid_header() {
    // A well-under-cap `\n\n`-only "header" must NOT be accidentally treated
    // as a valid `\r\n\r\n` terminator — this proves the decoder does not
    // silently also accept it. It simply stays incomplete (no error, no
    // decoded message) until either a real `\r\n\r\n` arrives or the cap is
    // exceeded (see the sibling test below).
    let mut decoder = FrameDecoder::new();
    let framed = b"Content-Length: 5\n\nhello".to_vec();
    let messages = decoder
        .feed(&framed)
        .expect("an unterminated (by this decoder's strict rule) header is not yet an error");
    assert!(messages.is_empty());
}

#[test]
fn lf_only_separator_exceeding_the_cap_fails_with_header_too_large() {
    let mut decoder = FrameDecoder::new();
    let mut framed = Vec::new();
    while framed.len() <= MAX_DAP_HEADER_BYTES {
        framed.extend_from_slice(b"Content-Length: 5\n\n");
    }
    let error = decoder
        .feed(&framed)
        .expect_err("a \\n\\n-only stream never terminates a header, so it must bound out");
    assert_eq!(error, FramingError::HeaderTooLarge);
}
