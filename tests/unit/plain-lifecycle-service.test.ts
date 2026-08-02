import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type { ILogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service";
import type { IStorageService } from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage.service";
import { describe, expect, it, vi } from "vitest";

import type {
	NativeCloseRequest,
	PlainBridge,
} from "../../app/platform/tauri/contracts";
import {
	configurePlainLifecycleBridge,
	PlainLifecycleService,
} from "../../app/services/plain-lifecycle-service";

const REQUEST_ID = "0d3f4b0e-6f1a-4c9d-9c3a-1a2b3c4d5e6f";

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function createHarness(
	onFlush: () => Promise<void> = async () => {},
): Readonly<{
	service: PlainLifecycleService;
	emit: (request: NativeCloseRequest) => void;
	complete: ReturnType<typeof vi.fn>;
	requestClose: ReturnType<typeof vi.fn>;
	logError: ReturnType<typeof vi.fn>;
}> {
	let listener: ((request: NativeCloseRequest) => void) | undefined;
	const complete = vi.fn(async () => {});
	const requestClose = vi.fn(async () => {});
	const bridge = {
		async onNativeCloseRequested(
			registered: (request: NativeCloseRequest) => void,
		) {
			listener = registered;
			return () => {};
		},
		lifecycleCompleteClose: complete,
		lifecycleRequestClose: requestClose,
	} as unknown as PlainBridge;
	configurePlainLifecycleBridge(bridge);

	const logError = vi.fn();
	const logService = {
		trace: vi.fn(),
		warn: vi.fn(),
		error: logError,
	} as unknown as ILogService;
	const storageService = {
		onWillSaveState: Event.None,
		getNumber: vi.fn(() => undefined),
		remove: vi.fn(),
		flush: vi.fn(onFlush),
	} as unknown as IStorageService;
	const service = new PlainLifecycleService(logService, storageService);
	return Object.freeze({
		service,
		emit(request) {
			if (listener === undefined)
				throw new Error("listener was not registered");
			listener(request);
		},
		complete,
		requestClose,
		logError,
	});
}

function closeRequest(reason: "close" | "quit" = "close"): NativeCloseRequest {
	return Object.freeze({ requestId: REQUEST_ID, reason, timeoutMs: 5_000 });
}

describe("PlainLifecycleService", () => {
	it("orders final veto, storage flush and will-shutdown joiners before allow", async () => {
		const sequence: string[] = [];
		const completed = deferred<void>();
		const harness = createHarness(async () => {
			sequence.push("storage");
		});
		harness.complete.mockImplementation(async (_requestId, outcome) => {
			sequence.push(`complete:${String(outcome)}`);
			completed.resolve();
		});
		harness.service.onBeforeShutdown((event) => {
			event.veto(Promise.resolve(false), "regular-test-veto");
			event.finalVeto(async () => {
				sequence.push("final-backup");
				return false;
			}, "final-test-veto");
		});
		harness.service.onWillShutdown((event) => {
			event.join(
				Promise.resolve().then(() => {
					sequence.push("will-shutdown");
				}),
				{ id: "test-joiner", label: "test joiner" },
			);
		});

		harness.emit(closeRequest("quit"));
		await completed.promise;

		expect(sequence).toEqual([
			"final-backup",
			"storage",
			"will-shutdown",
			"complete:allow",
		]);
		expect(harness.complete).toHaveBeenCalledExactlyOnceWith(
			REQUEST_ID,
			"allow",
		);
		expect(harness.service.willShutdown).toBe(true);
		harness.service.dispose();
	});

	it("fails closed when the final veto throws and remains retryable", async () => {
		const completed = deferred<void>();
		const flush = vi.fn(async () => {});
		const harness = createHarness(flush);
		const shutdownVeto = vi.fn();
		const beforeError = vi.fn();
		harness.service.onShutdownVeto(shutdownVeto);
		harness.service.onBeforeShutdownError(beforeError);
		harness.service.onBeforeShutdown((event) => {
			event.finalVeto(async () => {
				throw new Error("backup failed");
			}, "final-test-veto");
		});
		harness.complete.mockImplementation(async () => completed.resolve());

		harness.emit(closeRequest());
		await completed.promise;

		expect(harness.complete).toHaveBeenCalledExactlyOnceWith(
			REQUEST_ID,
			"veto",
		);
		expect(flush).not.toHaveBeenCalled();
		expect(shutdownVeto).toHaveBeenCalledOnce();
		expect(beforeError).toHaveBeenCalledOnce();
		expect(harness.logError).toHaveBeenCalled();
		expect(harness.service.willShutdown).toBe(false);
		harness.service.dispose();
	});

	it("delegates explicit Workbench shutdown to native close", async () => {
		const harness = createHarness();
		await harness.service.shutdown();
		expect(harness.requestClose).toHaveBeenCalledOnce();
		harness.service.dispose();
	});
});
