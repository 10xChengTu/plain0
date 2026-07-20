import { describe, expect, it, vi } from "vitest";

import {
	createBrowserMockBridge,
	type BrowserMockWorkspaceWatchControllerForTest,
} from "../../app/platform/tauri/browser-mock";

async function settleImmediateWatcherWork(): Promise<void> {
	for (let index = 0; index < 8; index += 1) {
		await vi.advanceTimersByTimeAsync(1);
		await Promise.resolve();
	}
}

describe("browser mock workspace watcher transport", () => {
	it("uses the shared manager and preserves changes that arrive behind a sticky pending generation", async () => {
		vi.useFakeTimers();
		try {
			let controller!: BrowserMockWorkspaceWatchControllerForTest;
			const bridge = createBrowserMockBridge({
				onWorkspaceWatchControllerForTest(value) {
					controller = value;
				},
			});
			const picked = await bridge.workspacePickRoots("replace");
			const root = picked.snapshot.roots[0]!;
			bridge.workspaceReconcileWatchRoots([root.rootId]);
			const listener = vi.fn();
			const stop = bridge.workspaceWatch(root.rootId, listener);

			await settleImmediateWatcherWork();
			expect(listener).toHaveBeenCalledOnce();
			expect(Object.isFrozen(controller)).toBe(true);

			controller.invalidateRoot(root.rootId, {
				emitWake: true,
				rescanRequired: false,
			});
			controller.invalidateRoot(root.rootId, {
				emitWake: true,
				rescanRequired: true,
			});
			await settleImmediateWatcherWork();

			// The second change arrived while the first generation was pending. It
			// must survive that generation's acknowledgement as a second delivery.
			expect(listener).toHaveBeenCalledTimes(3);
			stop();
			await Promise.resolve();
		} finally {
			vi.useRealTimers();
		}
	});

	it("recovers a path-free external invalidation when its wake hint is lost", async () => {
		vi.useFakeTimers();
		try {
			let controller!: BrowserMockWorkspaceWatchControllerForTest;
			const bridge = createBrowserMockBridge({
				onWorkspaceWatchControllerForTest(value) {
					controller = value;
				},
			});
			const picked = await bridge.workspacePickRoots("replace");
			const root = picked.snapshot.roots[0]!;
			bridge.workspaceReconcileWatchRoots([root.rootId]);
			const listener = vi.fn();
			const stop = bridge.workspaceWatch(root.rootId, listener);
			await settleImmediateWatcherWork();
			expect(listener).toHaveBeenCalledOnce();

			controller.invalidateRoot(root.rootId, {
				emitWake: false,
				rescanRequired: true,
			});
			await vi.advanceTimersByTimeAsync(1);
			expect(listener).toHaveBeenCalledOnce();
			await vi.advanceTimersToNextTimerAsync();
			await settleImmediateWatcherWork();
			expect(listener).toHaveBeenCalledTimes(2);

			expect(() =>
				controller.invalidateRoot(root.rootId, {
					path: "/private/workspace",
				} as never),
			).toThrow("Invalid browser mock workspace-watch invalidation.");
			stop();
			await Promise.resolve();
		} finally {
			vi.useRealTimers();
		}
	});

	it("revokes listeners and protects a same-root replacement from the old disposer", async () => {
		vi.useFakeTimers();
		try {
			let controller!: BrowserMockWorkspaceWatchControllerForTest;
			const bridge = createBrowserMockBridge({
				onWorkspaceWatchControllerForTest(value) {
					controller = value;
				},
			});
			const picked = await bridge.workspacePickRoots("replace");
			const root = picked.snapshot.roots[0]!;
			bridge.workspaceReconcileWatchRoots([root.rootId]);
			const oldListener = vi.fn();
			const stopOld = bridge.workspaceWatch(root.rootId, oldListener);
			await settleImmediateWatcherWork();
			expect(oldListener).toHaveBeenCalledOnce();

			bridge.workspaceReconcileWatchRoots([]);
			controller.invalidateRoot(root.rootId, {
				emitWake: true,
				rescanRequired: true,
			});
			await settleImmediateWatcherWork();
			expect(oldListener).toHaveBeenCalledOnce();

			bridge.workspaceReconcileWatchRoots([root.rootId]);
			const replacement = vi.fn();
			const stopReplacement = bridge.workspaceWatch(root.rootId, replacement);
			stopOld();
			await settleImmediateWatcherWork();
			expect(replacement).toHaveBeenCalledOnce();

			controller.invalidateRoot(root.rootId, { emitWake: true });
			await settleImmediateWatcherWork();
			expect(replacement).toHaveBeenCalledTimes(2);
			stopReplacement();
			await Promise.resolve();
		} finally {
			vi.useRealTimers();
		}
	});
});
