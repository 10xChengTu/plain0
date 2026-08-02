import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	decodeLifecycleVoid,
	decodeNativeCloseRequest,
	frozenCompleteCloseRequest,
} from "../../app/platform/tauri/lifecycle-codec";

const tauri = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

const { createNativeBridge } = await import("../../app/platform/tauri/native");

const REQUEST_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

describe("lifecycle codec", () => {
	it("decodes and freezes the exact native close event", () => {
		const decoded = decodeNativeCloseRequest({
			requestId: REQUEST_ID,
			reason: "quit",
			timeoutMs: 5_000,
		});
		expect(decoded).toEqual({
			requestId: REQUEST_ID,
			reason: "quit",
			timeoutMs: 5_000,
		});
		expect(Object.isFrozen(decoded)).toBe(true);
	});

	it("rejects malformed ids, open reasons, wrong budgets and extra fields", () => {
		for (const value of [
			null,
			[],
			{ requestId: "bad", reason: "close", timeoutMs: 5_000 },
			{
				requestId: "0d3f4b0e-6f1a-1c9d-9c3a-1a2b3c4d5e6f",
				reason: "close",
				timeoutMs: 5_000,
			},
			{ requestId: REQUEST_ID, reason: "reload", timeoutMs: 5_000 },
			{ requestId: REQUEST_ID, reason: "close", timeoutMs: 8_000 },
			{
				requestId: REQUEST_ID,
				reason: "close",
				timeoutMs: 5_000,
				extra: true,
			},
		]) {
			expect(() => decodeNativeCloseRequest(value)).toThrow();
		}
	});

	it("rejects accessors, custom prototypes and Proxy-wrapped events", () => {
		const accessor = {
			requestId: REQUEST_ID,
			reason: "close",
			get timeoutMs() {
				return 5_000;
			},
		};
		expect(() => decodeNativeCloseRequest(accessor)).toThrow();
		expect(() =>
			decodeNativeCloseRequest(
				Object.assign(Object.create(null), {
					requestId: REQUEST_ID,
					reason: "close",
					timeoutMs: 5_000,
				}),
			),
		).toThrow();
		expect(() =>
			decodeNativeCloseRequest(
				new Proxy(
					{ requestId: REQUEST_ID, reason: "close", timeoutMs: 5_000 },
					{},
				),
			),
		).toThrow();
	});

	it("builds a closed completion request and treats only null as void", () => {
		const completion = frozenCompleteCloseRequest(REQUEST_ID, "allow");
		expect(completion).toEqual({ requestId: REQUEST_ID, outcome: "allow" });
		expect(Object.isFrozen(completion)).toBe(true);
		expect(() => frozenCompleteCloseRequest(REQUEST_ID, "force")).toThrow();
		expect(() => frozenCompleteCloseRequest("bad", "veto")).toThrow();
		expect(decodeLifecycleVoid(null)).toBeUndefined();
		for (const value of [undefined, false, 0, {}, []]) {
			expect(() => decodeLifecycleVoid(value)).toThrow();
		}
	});
});

describe("native lifecycle bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("strictly decodes close events and invokes the two exact commands", async () => {
		let eventHandler:
			((event: { readonly payload: unknown }) => void) | undefined;
		const unlisten = vi.fn();
		tauri.listen.mockImplementation(
			async (
				eventName: string,
				handler: (event: { readonly payload: unknown }) => void,
			) => {
				expect(eventName).toBe("plain://close-requested");
				eventHandler = handler;
				return unlisten;
			},
		);
		tauri.invoke.mockResolvedValue(null);
		const bridge = createNativeBridge();
		const listener = vi.fn();

		const stop = await bridge.onNativeCloseRequested(listener);
		eventHandler?.({
			payload: {
				requestId: REQUEST_ID,
				reason: "close",
				timeoutMs: 5_000,
			},
		});
		expect(listener).toHaveBeenCalledExactlyOnceWith({
			requestId: REQUEST_ID,
			reason: "close",
			timeoutMs: 5_000,
		});
		expect(() =>
			eventHandler?.({
				payload: {
					requestId: REQUEST_ID,
					reason: "close",
					timeoutMs: 5_000,
					nativePath: "/private/secret",
				},
			}),
		).toThrow();

		await bridge.lifecycleCompleteClose(REQUEST_ID, "veto");
		await bridge.lifecycleRequestClose();
		expect(tauri.invoke.mock.calls).toEqual([
			[
				"lifecycle_complete_close",
				{ request: { requestId: REQUEST_ID, outcome: "veto" } },
			],
			["lifecycle_request_close", { request: {} }],
		]);
		await stop();
		expect(unlisten).toHaveBeenCalledOnce();
	});
});
