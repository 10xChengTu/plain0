import { describe, expect, it, vi } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import { normalizeCommandError } from "../../app/platform/tauri/errors";

describe("Plain bridge contract", () => {
	it("returns and emits the same versioned runtime payload", async () => {
		const bridge = createBrowserMockBridge();
		const listener = vi.fn();
		const unlisten = await bridge.onRuntimeReady(listener);

		const runtime = await bridge.runtimeInfo();
		await Promise.resolve();

		expect(runtime).toEqual({
			application: "Plain",
			ipcVersion: 1,
			runtime: "browser-mock",
		});
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(runtime);

		await unlisten();
	});

	it("preserves stable structured command errors", () => {
		expect(
			normalizeCommandError({
				code: "WORKSPACE_DENIED",
				message: "Denied",
				details: { root: 1 },
			}),
		).toEqual({
			code: "WORKSPACE_DENIED",
			message: "Denied",
			details: { root: 1 },
		});
	});

	it("maps unknown failures to IPC_FAILED", () => {
		expect(normalizeCommandError(new Error("transport closed"))).toEqual({
			code: "IPC_FAILED",
			message: "transport closed",
		});
	});
});
