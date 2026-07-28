import { describe, expect, it } from "vitest";

import {
	decodeDebugAdapterConfirmationState,
	decodeDebugAdapterConfirmationVoid,
	frozenDebugAdapterConfirmationRequest,
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
