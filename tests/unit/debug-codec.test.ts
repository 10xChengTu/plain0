import { describe, expect, it } from "vitest";

import {
	decodeDebugAdapterConfirmationState,
	decodeDebugAdapterConfirmationVoid,
	decodeDebugContinueResult,
	decodeDebugStepVoid,
	frozenDebugAdapterConfirmationRequest,
	frozenDebugThreadRequest,
} from "../../app/platform/tauri/debug-codec";

describe("frozenDebugAdapterConfirmationRequest", () => {
	it("accepts a well-formed stdio descriptor", () => {
		const request = frozenDebugAdapterConfirmationRequest({
			command: "/usr/bin/python3",
			args: ["-m", "debugpy.adapter"],
			transport: "stdio",
		});
		expect(request).toEqual({
			command: "/usr/bin/python3",
			args: ["-m", "debugpy.adapter"],
			transport: "stdio",
		});
	});

	it("accepts a well-formed tcp descriptor (host/port are not part of this wire shape)", () => {
		const request = frozenDebugAdapterConfirmationRequest({
			command: "/usr/bin/lldb-dap",
			args: [],
			transport: "tcp",
		});
		expect(request).toEqual({
			command: "/usr/bin/lldb-dap",
			args: [],
			transport: "tcp",
		});
	});

	it("rejects a non-object descriptor", () => {
		expect(() => frozenDebugAdapterConfirmationRequest(null)).toThrow();
		expect(() => frozenDebugAdapterConfirmationRequest("nope")).toThrow();
		expect(() => frozenDebugAdapterConfirmationRequest([])).toThrow();
	});

	it("rejects an empty or missing command", () => {
		expect(() =>
			frozenDebugAdapterConfirmationRequest({
				command: "",
				args: [],
				transport: "stdio",
			}),
		).toThrow();
		expect(() =>
			frozenDebugAdapterConfirmationRequest({ args: [], transport: "stdio" }),
		).toThrow();
	});

	it("rejects a non-array or non-string-element args", () => {
		expect(() =>
			frozenDebugAdapterConfirmationRequest({
				command: "/bin/true",
				args: "not-an-array",
				transport: "stdio",
			}),
		).toThrow();
		expect(() =>
			frozenDebugAdapterConfirmationRequest({
				command: "/bin/true",
				args: [1, 2],
				transport: "stdio",
			}),
		).toThrow();
	});

	it("rejects an unrecognized transport", () => {
		expect(() =>
			frozenDebugAdapterConfirmationRequest({
				command: "/bin/true",
				args: [],
				transport: "http",
			}),
		).toThrow();
	});
});

describe("decodeDebugAdapterConfirmationState", () => {
	it("decodes a well-formed confirmed/unconfirmed state", () => {
		expect(decodeDebugAdapterConfirmationState({ confirmed: true })).toEqual({
			confirmed: true,
		});
		expect(decodeDebugAdapterConfirmationState({ confirmed: false })).toEqual({
			confirmed: false,
		});
	});

	it("rejects extra or mistyped fields", () => {
		expect(() =>
			decodeDebugAdapterConfirmationState({ confirmed: true, extra: 1 }),
		).toThrow();
		expect(() =>
			decodeDebugAdapterConfirmationState({ confirmed: "yes" }),
		).toThrow();
		expect(() => decodeDebugAdapterConfirmationState(null)).toThrow();
	});

	it("rejects a Proxy-wrapped response", () => {
		const proxied = new Proxy({ confirmed: true }, {});
		expect(() => decodeDebugAdapterConfirmationState(proxied)).toThrow();
	});
});

describe("decodeDebugAdapterConfirmationVoid", () => {
	it("accepts null and rejects anything else", () => {
		expect(() => decodeDebugAdapterConfirmationVoid(null)).not.toThrow();
		expect(() => decodeDebugAdapterConfirmationVoid(undefined)).toThrow();
		expect(() => decodeDebugAdapterConfirmationVoid({})).toThrow();
	});
});

// ---------------------------------------------------------------------
// `F100` S4 — execution/step control (`continue`/`next`/`stepIn`/`stepOut`/
// `pause` share one request encoder — see `DebugThreadRequest`'s own doc
// comment in `src-tauri/src/debug/dto.rs`).
// ---------------------------------------------------------------------

const VALID_SESSION_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

describe("frozenDebugThreadRequest", () => {
	it("encodes a well-formed sessionId/threadId pair", () => {
		expect(frozenDebugThreadRequest(VALID_SESSION_ID, 7)).toEqual({
			sessionId: VALID_SESSION_ID,
			threadId: 7,
		});
	});

	it("rejects a non-integer threadId", () => {
		expect(() => frozenDebugThreadRequest(VALID_SESSION_ID, 1.5)).toThrow();
	});

	it("rejects a malformed sessionId", () => {
		expect(() => frozenDebugThreadRequest("not-a-uuid", 1)).toThrow();
	});
});

describe("decodeDebugContinueResult", () => {
	it("accepts a well-formed result", () => {
		expect(decodeDebugContinueResult({ allThreadsContinued: true })).toEqual({
			allThreadsContinued: true,
		});
		expect(decodeDebugContinueResult({ allThreadsContinued: false })).toEqual({
			allThreadsContinued: false,
		});
	});

	it("rejects extra or mistyped fields", () => {
		expect(() =>
			decodeDebugContinueResult({ allThreadsContinued: true, extra: 1 }),
		).toThrow();
		expect(() =>
			decodeDebugContinueResult({ allThreadsContinued: "yes" }),
		).toThrow();
		expect(() => decodeDebugContinueResult(null)).toThrow();
	});

	it("rejects a Proxy-wrapped response", () => {
		const proxied = new Proxy({ allThreadsContinued: true }, {});
		expect(() => decodeDebugContinueResult(proxied)).toThrow();
	});
});

describe("decodeDebugStepVoid", () => {
	it("accepts null and rejects anything else", () => {
		expect(() => decodeDebugStepVoid(null)).not.toThrow();
		expect(() => decodeDebugStepVoid(undefined)).toThrow();
		expect(() => decodeDebugStepVoid({})).toThrow();
	});
});
