//! Pure in-memory Rust tests for `debug::protocol`'s envelope parser/encoder
//! — no transport, no threads, no subprocess: every test here feeds raw
//! bytes straight into [`parse_incoming_message`] or inspects
//! [`encode_request`]/[`encode_response`]'s output directly.

use serde_json::json;

use super::{
    encode_request, encode_response, parse_incoming_message, Capabilities, IncomingMessage,
    ProtocolError,
};

// ---------------------------------------------------------------------
// Response parsing — including the real `lldb-dap` "seq is 0" evidence and
// the "we never even look at seq" proof.
// ---------------------------------------------------------------------

#[test]
fn a_response_with_seq_zero_parses_identically_to_one_with_a_large_seq() {
    // The exact shape `docs/research/2026-07-28-generic-dap.md` captured
    // from real `lldb-dap`: response `seq` is 0, not 1.
    let lldb_style = br#"{"seq":0,"type":"response","request_seq":1,"success":true,"command":"initialize","body":{"supportsConditionalBreakpoints":true}}"#;
    let large_seq_style = br#"{"seq":987654321,"type":"response","request_seq":1,"success":true,"command":"initialize","body":{"supportsConditionalBreakpoints":true}}"#;

    let lldb_parsed = parse_incoming_message(lldb_style).expect("well-formed response");
    let large_seq_parsed = parse_incoming_message(large_seq_style).expect("well-formed response");

    let IncomingMessage::Response(lldb_response) = lldb_parsed else {
        panic!("expected a response envelope");
    };
    let IncomingMessage::Response(large_seq_response) = large_seq_parsed else {
        panic!("expected a response envelope");
    };
    // Both parse to the exact same `ResponseEnvelope` — `seq`'s numeric
    // value never leaks into anything this module exposes.
    assert_eq!(lldb_response, large_seq_response);
    assert_eq!(lldb_response.request_seq, 1);
    assert!(lldb_response.success);
}

#[test]
fn response_missing_request_seq_is_malformed() {
    let body = br#"{"seq":1,"type":"response","success":true,"command":"initialize"}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedResponse
    );
}

#[test]
fn response_missing_success_is_malformed() {
    let body = br#"{"seq":1,"type":"response","request_seq":1,"command":"initialize"}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedResponse
    );
}

#[test]
fn response_missing_command_is_malformed() {
    let body = br#"{"seq":1,"type":"response","request_seq":1,"success":true}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedResponse
    );
}

#[test]
fn a_failed_response_carries_its_message_and_omits_body() {
    let body =
        br#"{"seq":0,"type":"response","request_seq":2,"success":false,"command":"launch","message":"boom"}"#;
    let IncomingMessage::Response(response) = parse_incoming_message(body).unwrap() else {
        panic!("expected a response envelope");
    };
    assert!(!response.success);
    assert_eq!(response.message.as_deref(), Some("boom"));
    assert_eq!(response.body, None);
}

// ---------------------------------------------------------------------
// Event parsing.
// ---------------------------------------------------------------------

#[test]
fn an_event_with_a_body_parses() {
    let body = br#"{"seq":4,"type":"event","event":"stopped","body":{"reason":"breakpoint","threadId":1}}"#;
    let IncomingMessage::Event(event) = parse_incoming_message(body).unwrap() else {
        panic!("expected an event envelope");
    };
    assert_eq!(event.event, "stopped");
    assert_eq!(
        event.body,
        Some(json!({"reason":"breakpoint","threadId":1}))
    );
}

#[test]
fn an_event_without_a_body_parses_with_a_none_body() {
    let body = br#"{"seq":4,"type":"event","event":"initialized"}"#;
    let IncomingMessage::Event(event) = parse_incoming_message(body).unwrap() else {
        panic!("expected an event envelope");
    };
    assert_eq!(event.event, "initialized");
    assert_eq!(event.body, None);
}

#[test]
fn event_missing_event_name_is_malformed() {
    let body = br#"{"seq":4,"type":"event","body":{}}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedEvent
    );
}

// ---------------------------------------------------------------------
// Reverse-request parsing — the one place `seq` is actually read.
// ---------------------------------------------------------------------

#[test]
fn a_reverse_request_keeps_its_own_seq_for_echoing_back() {
    let body = br#"{"seq":9,"type":"request","command":"runInTerminal","arguments":{"cwd":"/tmp","args":["python3"]}}"#;
    let IncomingMessage::Request(request) = parse_incoming_message(body).unwrap() else {
        panic!("expected a reverse request envelope");
    };
    assert_eq!(request.seq, 9);
    assert_eq!(request.command, "runInTerminal");
    assert_eq!(
        request.arguments,
        Some(json!({"cwd":"/tmp","args":["python3"]}))
    );
}

#[test]
fn reverse_request_missing_seq_is_malformed() {
    let body = br#"{"type":"request","command":"runInTerminal"}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedRequest
    );
}

#[test]
fn reverse_request_missing_command_is_malformed() {
    let body = br#"{"seq":9,"type":"request"}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::MalformedRequest
    );
}

// ---------------------------------------------------------------------
// Hostile/malformed input.
// ---------------------------------------------------------------------

#[test]
fn invalid_utf8_is_reported_distinctly() {
    let body: &[u8] = &[0xFF, 0xFE, 0xFD];
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::InvalidUtf8
    );
}

#[test]
fn invalid_json_is_reported_distinctly() {
    let body = b"{not json at all";
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::InvalidJson
    );
}

#[test]
fn a_json_array_instead_of_an_object_is_invalid_json() {
    let body = b"[1,2,3]";
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::InvalidJson
    );
}

#[test]
fn missing_type_field_is_invalid_json() {
    let body = br#"{"seq":1}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::InvalidJson
    );
}

#[test]
fn an_unknown_type_value_is_reported_distinctly_from_invalid_json() {
    let body = br#"{"seq":1,"type":"telemetry"}"#;
    assert_eq!(
        parse_incoming_message(body).unwrap_err(),
        ProtocolError::UnknownMessageType
    );
}

// ---------------------------------------------------------------------
// Encoding — round trip through the parser, and exact framing shape.
// ---------------------------------------------------------------------

#[test]
fn encode_request_produces_a_well_formed_content_length_frame() {
    let framed = encode_request(1, "initialize", Some(json!({"adapterID": "plain"})));
    let text = String::from_utf8(framed).unwrap();
    let (header, body) = text
        .split_once("\r\n\r\n")
        .expect("has a header terminator");
    assert_eq!(header, format!("Content-Length: {}", body.len()));
    let value: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(value["seq"], 1);
    assert_eq!(value["type"], "request");
    assert_eq!(value["command"], "initialize");
    assert_eq!(value["arguments"]["adapterID"], "plain");
}

#[test]
fn encode_request_omits_the_arguments_key_when_none() {
    let framed = encode_request(2, "configurationDone", None);
    let text = String::from_utf8(framed).unwrap();
    let (_, body) = text.split_once("\r\n\r\n").unwrap();
    let value: serde_json::Value = serde_json::from_str(body).unwrap();
    assert!(value.get("arguments").is_none());
}

#[test]
fn encode_response_round_trips_through_the_parser_as_a_reverse_request_reply_shape() {
    let framed = encode_response(5, 9, "runInTerminal", false, Some("not supported"), None);
    let text = String::from_utf8(framed).unwrap();
    let (header, body) = text.split_once("\r\n\r\n").unwrap();
    assert_eq!(header, format!("Content-Length: {}", body.len()));

    // Feeding it back through the real parser proves this is genuinely a
    // well-formed `ResponseEnvelope`, not merely "looks right by eye".
    let IncomingMessage::Response(response) = parse_incoming_message(body.as_bytes()).unwrap()
    else {
        panic!("expected a response envelope");
    };
    assert_eq!(response.request_seq, 9);
    assert!(!response.success);
    assert_eq!(response.command, "runInTerminal");
    assert_eq!(response.message.as_deref(), Some("not supported"));
    assert_eq!(response.body, None);
}

// ---------------------------------------------------------------------
// Capabilities — "missing means unsupported", never a fixed struct.
// ---------------------------------------------------------------------

#[test]
fn capabilities_reports_true_only_for_an_explicit_true_field() {
    let capabilities = Capabilities::from_body(Some(json!({
        "supportsConditionalBreakpoints": true,
        "supportsDataBreakpoints": false,
    })));
    assert!(capabilities.supports("supportsConditionalBreakpoints"));
    assert!(!capabilities.supports("supportsDataBreakpoints"));
    // Never mentioned at all — still a deterministic `false`, not a panic
    // or a third "unknown" state.
    assert!(!capabilities.supports("supportsDisassembleRequest"));
}

#[test]
fn capabilities_from_a_missing_body_is_an_empty_but_usable_set() {
    let capabilities = Capabilities::from_body(None);
    assert!(!capabilities.supports("anything"));
    assert_eq!(capabilities.as_value(), json!({}));
}

#[test]
fn capabilities_from_a_non_object_body_degrades_to_empty_rather_than_panicking() {
    let capabilities = Capabilities::from_body(Some(json!("not an object")));
    assert!(!capabilities.supports("anything"));
    assert_eq!(capabilities.as_value(), json!({}));
}

/// Freezes the real `lldb-dap`/`debugpy` disjoint-capability-set evidence
/// `docs/research/2026-07-28-generic-dap.md` captured — two genuinely
/// different real adapters reporting almost entirely non-overlapping
/// `supportsXxx` sets — as a regression proving [`Capabilities`] handles
/// both without any hardcoded assumption about which fields exist.
#[test]
fn capabilities_handles_two_real_captured_disjoint_adapter_shapes() {
    let lldb_dap = Capabilities::from_body(Some(json!({
        "supportsConditionalBreakpoints": true,
        "supportsDataBreakpoints": true,
        "supportsDelayedStackTraceLoading": true,
        "supportsDisassembleRequest": true,
        "supportsSteppingGranularity": true,
    })));
    let debugpy = Capabilities::from_body(Some(json!({
        "supportsConditionalBreakpoints": true,
        "supportsDebuggerProperties": true,
        "supportsSetExpression": true,
        "supportsGotoTargetsRequest": true,
        "supportsClipboardContext": true,
    })));

    assert!(lldb_dap.supports("supportsDisassembleRequest"));
    assert!(!debugpy.supports("supportsDisassembleRequest"));
    assert!(debugpy.supports("supportsDebuggerProperties"));
    assert!(!lldb_dap.supports("supportsDebuggerProperties"));
    // The one capability both real adapters actually reported.
    assert!(lldb_dap.supports("supportsConditionalBreakpoints"));
    assert!(debugpy.supports("supportsConditionalBreakpoints"));
}
