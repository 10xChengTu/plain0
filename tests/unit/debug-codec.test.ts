import { describe, expect, it } from "vitest";

import {
	decodeDebugAdapterConfirmationState,
	decodeDebugAdapterConfirmationVoid,
	decodeDebugContinueResult,
	decodeDebugStepInTargetsResult,
	decodeDebugStepVoid,
	frozenDebugAdapterConfirmationRequest,
	frozenDebugSessionStartRequest,
	frozenDebugSetBreakpointsRequest,
	frozenDebugStepInRequest,
	frozenDebugStepInTargetsRequest,
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
const VALID_ROOT_ID = "11111111-1111-4111-8111-111111111111";

describe("root-scoped debug request encoders", () => {
	it("includes the exact rootId in stdio and tcp session starts", () => {
		expect(
			frozenDebugSessionStartRequest(
				VALID_ROOT_ID,
				{
					transport: "stdio",
					command: "/usr/bin/python3",
					args: ["-m", "debugpy.adapter"],
				},
				"debugpy",
				{ program: "main.py" },
			),
		).toEqual({
			rootId: VALID_ROOT_ID,
			transport: "stdio",
			command: "/usr/bin/python3",
			args: ["-m", "debugpy.adapter"],
			adapterId: "debugpy",
			arguments: { program: "main.py" },
			initialBreakpoints: [],
		});
		expect(
			frozenDebugSessionStartRequest(
				VALID_ROOT_ID,
				{
					transport: "tcp",
					command: "/usr/bin/lldb-dap",
					args: [],
					host: "127.0.0.1",
					port: 4711,
				},
				"lldb",
				{},
			),
		).toMatchObject({
			rootId: VALID_ROOT_ID,
			transport: "tcp",
			host: "127.0.0.1",
			port: 4711,
		});
	});

	it("includes rootId in setBreakpoints and rejects missing or malformed roots", () => {
		expect(
			frozenDebugSetBreakpointsRequest(
				VALID_SESSION_ID,
				VALID_ROOT_ID,
				"src/main.py",
				[{ line: 7, condition: null, logMessage: null, hitCondition: null }],
			),
		).toEqual({
			sessionId: VALID_SESSION_ID,
			rootId: VALID_ROOT_ID,
			path: "src/main.py",
			breakpoints: [
				{ line: 7, condition: null, logMessage: null, hitCondition: null },
			],
		});
		expect(() =>
			frozenDebugSessionStartRequest(
				undefined,
				{ transport: "stdio", command: "/bin/true", args: [] },
				"mock",
				{},
			),
		).toThrow();
		expect(() =>
			frozenDebugSetBreakpointsRequest(
				VALID_SESSION_ID,
				"not-a-root-id",
				"main.py",
				[],
			),
		).toThrow();
	});

	it("encodes a non-null hitCondition and rejects an oversized one", () => {
		expect(
			frozenDebugSetBreakpointsRequest(
				VALID_SESSION_ID,
				VALID_ROOT_ID,
				"src/main.py",
				[
					{
						line: 7,
						condition: null,
						logMessage: null,
						hitCondition: ">=3",
					},
				],
			),
		).toEqual({
			sessionId: VALID_SESSION_ID,
			rootId: VALID_ROOT_ID,
			path: "src/main.py",
			breakpoints: [
				{ line: 7, condition: null, logMessage: null, hitCondition: ">=3" },
			],
		});
		expect(() =>
			frozenDebugSetBreakpointsRequest(
				VALID_SESSION_ID,
				VALID_ROOT_ID,
				"src/main.py",
				[
					{
						line: 7,
						condition: null,
						logMessage: null,
						hitCondition: "x".repeat(8_193),
					},
				],
			),
		).toThrow();
	});
});

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

// ---------------------------------------------------------------------
// `F210` S4 — the `stepInTargets` target picker and `stepIn`'s own
// `targetId` field.
// ---------------------------------------------------------------------

describe("frozenDebugStepInRequest", () => {
	it("always includes the targetId key, null when absent", () => {
		expect(frozenDebugStepInRequest(VALID_SESSION_ID, 7, null)).toEqual({
			sessionId: VALID_SESSION_ID,
			threadId: 7,
			targetId: null,
		});
	});

	it("encodes a well-formed non-null targetId", () => {
		expect(frozenDebugStepInRequest(VALID_SESSION_ID, 7, 3)).toEqual({
			sessionId: VALID_SESSION_ID,
			threadId: 7,
			targetId: 3,
		});
	});

	it("rejects a non-integer threadId or targetId", () => {
		expect(() =>
			frozenDebugStepInRequest(VALID_SESSION_ID, 1.5, null),
		).toThrow();
		expect(() => frozenDebugStepInRequest(VALID_SESSION_ID, 1, 2.5)).toThrow();
	});

	it("rejects a malformed sessionId", () => {
		expect(() => frozenDebugStepInRequest("not-a-uuid", 1, null)).toThrow();
	});
});

describe("frozenDebugStepInTargetsRequest", () => {
	it("encodes a well-formed sessionId/frameId pair", () => {
		expect(frozenDebugStepInTargetsRequest(VALID_SESSION_ID, 9)).toEqual({
			sessionId: VALID_SESSION_ID,
			frameId: 9,
		});
	});

	it("rejects a non-integer frameId", () => {
		expect(() =>
			frozenDebugStepInTargetsRequest(VALID_SESSION_ID, 1.5),
		).toThrow();
	});

	it("rejects a malformed sessionId", () => {
		expect(() => frozenDebugStepInTargetsRequest("not-a-uuid", 1)).toThrow();
	});
});

describe("decodeDebugStepInTargetsResult", () => {
	it("accepts a genuinely empty targets array", () => {
		expect(
			decodeDebugStepInTargetsResult({ targets: [], truncated: false }),
		).toEqual({ targets: [], truncated: false });
	});

	it("accepts well-formed targets and preserves the truncated flag", () => {
		expect(
			decodeDebugStepInTargetsResult({
				targets: [
					{ id: 1, label: "quicksort(arr, lo, hi)" },
					{ id: 2, label: "partition(arr, lo, hi)" },
				],
				truncated: true,
			}),
		).toEqual({
			targets: [
				{ id: 1, label: "quicksort(arr, lo, hi)" },
				{ id: 2, label: "partition(arr, lo, hi)" },
			],
			truncated: true,
		});
	});

	it("rejects extra or mistyped top-level fields", () => {
		expect(() =>
			decodeDebugStepInTargetsResult({
				targets: [],
				truncated: false,
				extra: 1,
			}),
		).toThrow();
		expect(() =>
			decodeDebugStepInTargetsResult({ targets: [], truncated: "yes" }),
		).toThrow();
		expect(() => decodeDebugStepInTargetsResult(null)).toThrow();
	});

	it("rejects a target missing id/label or with a mistyped field", () => {
		expect(() =>
			decodeDebugStepInTargetsResult({
				targets: [{ label: "x" }],
				truncated: false,
			}),
		).toThrow();
		expect(() =>
			decodeDebugStepInTargetsResult({
				targets: [{ id: 1 }],
				truncated: false,
			}),
		).toThrow();
		expect(() =>
			decodeDebugStepInTargetsResult({
				targets: [{ id: 1, label: 5 }],
				truncated: false,
			}),
		).toThrow();
	});

	it("rejects more targets than the defensive ceiling", () => {
		const targets = Array.from({ length: 257 }, (_unused, index) => ({
			id: index,
			label: `target${index}`,
		}));
		expect(() =>
			decodeDebugStepInTargetsResult({ targets, truncated: true }),
		).toThrow();
	});

	it("rejects a Proxy-wrapped response", () => {
		const proxied = new Proxy({ targets: [], truncated: false }, {});
		expect(() => decodeDebugStepInTargetsResult(proxied)).toThrow();
	});
});
