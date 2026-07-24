import { describe, expect, it } from "vitest";

import {
	decodeTerminalDataEvent,
	decodeTerminalExitEvent,
	decodeTerminalStartResult,
	decodeTerminalVoid,
	decodeWorkspaceTrustState,
	frozenTerminalAckRequest,
	frozenTerminalDataEvent,
	frozenTerminalExitEvent,
	frozenTerminalInputRequest,
	frozenTerminalKillRequest,
	frozenTerminalResizeRequest,
	frozenTerminalStartRequest,
} from "../../app/platform/tauri/terminal-codec";

const VALID_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

describe("terminal_start request/result codec", () => {
	it("builds a frozen own-data request from valid inputs, defaulting a missing cwd to null", () => {
		expect(frozenTerminalStartRequest(null, 80, 24)).toEqual({
			cwd: null,
			cols: 80,
			rows: 24,
		});
		expect(frozenTerminalStartRequest(undefined, 80, 24)).toEqual({
			cwd: null,
			cols: 80,
			rows: 24,
		});
		expect(frozenTerminalStartRequest("/tmp/project", 80, 24)).toEqual({
			cwd: "/tmp/project",
			cols: 80,
			rows: 24,
		});
		expect(Object.isFrozen(frozenTerminalStartRequest(null, 80, 24))).toBe(
			true,
		);
	});

	it("rejects zero, negative, non-integer, or oversized dimensions", () => {
		for (const [cols, rows] of [
			[0, 24],
			[80, 0],
			[-1, 24],
			[80, 24.5],
			[2_001, 24],
			[80, 2_001],
		] as const) {
			expect(() => frozenTerminalStartRequest(null, cols, rows)).toThrow();
		}
	});

	it("rejects a non-string, empty-string cwd", () => {
		expect(() => frozenTerminalStartRequest(123, 80, 24)).toThrow();
		expect(() => frozenTerminalStartRequest("", 80, 24)).toThrow();
	});

	it("decodes a well-formed start result and rejects a non-UUID or extra field", () => {
		expect(decodeTerminalStartResult({ sessionId: VALID_ID })).toEqual({
			sessionId: VALID_ID,
		});
		expect(() =>
			decodeTerminalStartResult({ sessionId: "not-a-uuid" }),
		).toThrow();
		expect(() =>
			decodeTerminalStartResult({ sessionId: VALID_ID, extra: true }),
		).toThrow();
		expect(() => decodeTerminalStartResult(null)).toThrow();
	});

	it("rejects a Proxy-wrapped start result", () => {
		const proxied = new Proxy(
			{ sessionId: VALID_ID },
			{ get: (target, key) => Reflect.get(target, key) },
		);
		expect(() => decodeTerminalStartResult(proxied)).toThrow();
	});
});

describe("terminal_input request codec", () => {
	it("converts a Uint8Array into a frozen dense number[] request", () => {
		const request = frozenTerminalInputRequest(
			VALID_ID,
			Uint8Array.from([104, 105]),
		);
		expect(request).toEqual({ sessionId: VALID_ID, data: [104, 105] });
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(request.data)).toBe(true);
	});

	it("accepts an empty Uint8Array", () => {
		expect(frozenTerminalInputRequest(VALID_ID, new Uint8Array(0))).toEqual({
			sessionId: VALID_ID,
			data: [],
		});
	});

	it("rejects data over the 1 MiB input bound", () => {
		const oversized = new Uint8Array(1_024 * 1_024 + 1);
		expect(() => frozenTerminalInputRequest(VALID_ID, oversized)).toThrow();
	});

	it("rejects a non-Uint8Array, a plain number[] masquerading as bytes, and a Proxy-wrapped Uint8Array", () => {
		expect(() => frozenTerminalInputRequest(VALID_ID, [1, 2, 3])).toThrow();
		expect(() => frozenTerminalInputRequest(VALID_ID, "bytes")).toThrow();
		const proxied = new Proxy(Uint8Array.from([1, 2, 3]), {});
		expect(() => frozenTerminalInputRequest(VALID_ID, proxied)).toThrow();
	});

	it("rejects a malformed sessionId", () => {
		expect(() =>
			frozenTerminalInputRequest("not-a-uuid", Uint8Array.from([1])),
		).toThrow();
	});
});

describe("terminal_resize/ack/kill request codecs", () => {
	it("builds frozen resize requests and rejects invalid dimensions", () => {
		expect(frozenTerminalResizeRequest(VALID_ID, 100, 40)).toEqual({
			sessionId: VALID_ID,
			cols: 100,
			rows: 40,
		});
		expect(() => frozenTerminalResizeRequest(VALID_ID, 0, 40)).toThrow();
	});

	it("builds frozen ack requests and rejects a negative or over-u32 byteCount", () => {
		expect(frozenTerminalAckRequest(VALID_ID, 5_000)).toEqual({
			sessionId: VALID_ID,
			byteCount: 5_000,
		});
		expect(frozenTerminalAckRequest(VALID_ID, 0)).toEqual({
			sessionId: VALID_ID,
			byteCount: 0,
		});
		expect(() => frozenTerminalAckRequest(VALID_ID, -1)).toThrow();
		expect(() =>
			frozenTerminalAckRequest(VALID_ID, 0xff_ff_ff_ff + 1),
		).toThrow();
		expect(() => frozenTerminalAckRequest(VALID_ID, 1.5)).toThrow();
	});

	it("builds frozen kill requests and rejects a non-boolean immediate", () => {
		expect(frozenTerminalKillRequest(VALID_ID, true)).toEqual({
			sessionId: VALID_ID,
			immediate: true,
		});
		expect(() => frozenTerminalKillRequest(VALID_ID, "true")).toThrow();
	});
});

describe("terminal_input/resize/ack/kill void result codec", () => {
	it("accepts JSON null and rejects anything else", () => {
		expect(decodeTerminalVoid(null)).toBeUndefined();
		expect(() => decodeTerminalVoid(undefined)).toThrow();
		expect(() => decodeTerminalVoid({})).toThrow();
	});
});

describe("plain://terminal-data event codec", () => {
	it("decodes a well-formed base64 payload into a fresh Uint8Array, matching the RFC 4648 vectors", () => {
		const event = decodeTerminalDataEvent({
			sessionId: VALID_ID,
			sequence: 7,
			bytes: "aGk=",
		});
		expect(event.sessionId).toBe(VALID_ID);
		expect(event.sequence).toBe(7);
		expect(Array.from(event.bytes)).toEqual([104, 105]); // "hi"
		expect(Object.isFrozen(event)).toBe(true);
	});

	it("decodes an empty chunk", () => {
		const event = decodeTerminalDataEvent({
			sessionId: VALID_ID,
			sequence: 0,
			bytes: "",
		});
		expect(event.bytes.byteLength).toBe(0);
	});

	it("rejects extra/missing fields, a non-UUID sessionId, and a negative/non-integer sequence", () => {
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				bytes: "",
				extra: true,
			}),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({ sessionId: "bad", sequence: 0, bytes: "" }),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({ sessionId: VALID_ID, sequence: -1, bytes: "" }),
		).toThrow();
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 1.5,
				bytes: "",
			}),
		).toThrow();
	});

	it("rejects malformed base64: bad charset, wrong padding, and non-multiple-of-4 length", () => {
		for (const bytes of ["not base64!!", "aGk", "a===", "aGk=extra"]) {
			expect(() =>
				decodeTerminalDataEvent({ sessionId: VALID_ID, sequence: 0, bytes }),
			).toThrow();
		}
	});

	it("rejects an oversized base64 string beyond one pty read chunk", () => {
		const oversized = "A".repeat(10_928); // 4 chars over the 10,924 cap (itself a multiple of 4)
		expect(() =>
			decodeTerminalDataEvent({
				sessionId: VALID_ID,
				sequence: 0,
				bytes: oversized,
			}),
		).toThrow();
	});

	it("rejects a Proxy-wrapped event payload", () => {
		const proxied = new Proxy(
			{ sessionId: VALID_ID, sequence: 0, bytes: "" },
			{},
		);
		expect(() => decodeTerminalDataEvent(proxied)).toThrow();
	});
});

describe("plain://terminal-exit event codec", () => {
	it("decodes a well-formed payload and omits any signal field", () => {
		expect(
			decodeTerminalExitEvent({ sessionId: VALID_ID, exitCode: 130 }),
		).toEqual({ sessionId: VALID_ID, exitCode: 130 });
	});

	it("rejects extra/missing fields and an invalid exitCode", () => {
		expect(() =>
			decodeTerminalExitEvent({
				sessionId: VALID_ID,
				exitCode: 0,
				signal: "SIGKILL",
			}),
		).toThrow();
		expect(() => decodeTerminalExitEvent({ sessionId: VALID_ID })).toThrow();
		expect(() =>
			decodeTerminalExitEvent({ sessionId: VALID_ID, exitCode: -1 }),
		).toThrow();
	});
});

describe("frozenTerminalDataEvent/frozenTerminalExitEvent (browser mock helpers)", () => {
	it("builds a frozen data event directly from a Uint8Array, with no wire round trip", () => {
		const event = frozenTerminalDataEvent(
			VALID_ID,
			3,
			Uint8Array.from([1, 2, 3]),
		);
		expect(event).toEqual({
			sessionId: VALID_ID,
			sequence: 3,
			bytes: Uint8Array.from([1, 2, 3]),
		});
		expect(Object.isFrozen(event)).toBe(true);
	});

	it("rejects a hostile bytes value and a non-UUID sessionId", () => {
		expect(() =>
			frozenTerminalDataEvent(VALID_ID, 0, [1, 2, 3] as unknown),
		).toThrow();
		expect(() =>
			frozenTerminalDataEvent("bad", 0, Uint8Array.from([1])),
		).toThrow();
	});

	it("builds a frozen exit event directly", () => {
		expect(frozenTerminalExitEvent(VALID_ID, 0)).toEqual({
			sessionId: VALID_ID,
			exitCode: 0,
		});
	});
});

describe("workspace_trust_state/grant response codec", () => {
	it("decodes a well-formed state and rejects extra/mistyped fields", () => {
		expect(decodeWorkspaceTrustState({ trusted: true })).toEqual({
			trusted: true,
		});
		expect(decodeWorkspaceTrustState({ trusted: false })).toEqual({
			trusted: false,
		});
		expect(() =>
			decodeWorkspaceTrustState({ trusted: true, extra: 1 }),
		).toThrow();
		expect(() => decodeWorkspaceTrustState({ trusted: "yes" })).toThrow();
	});
});
