import { describe, expect, it, vi } from "vitest";

import {
	createWorkspaceWatcherManager as createRawWorkspaceWatcherManager,
	type WorkspaceWatcherClock,
	type WorkspaceWatcherManagerOptions,
	type WorkspaceWatcherPageLifecycle,
	type WorkspaceWatcherTransport,
	type WorkspaceWatchPendingRoot,
	type WorkspaceWatchSyncRequest,
	type WorkspaceWatchSyncResult,
	type WorkspaceWatchWakeEvent,
} from "../../app/platform/tauri/workspace-watcher";

const ROOT_A = "00112233-4455-4677-8899-aabbccddeeff";
const ROOT_B = "11112233-4455-4677-8899-aabbccddeeff";
const WORKSPACE_ID = "22222233-4455-4677-8899-aabbccddeeff";
const OTHER_WORKSPACE_ID = "33332233-4455-4677-8899-aabbccddeeff";

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

interface ClockTask {
	readonly id: number;
	readonly dueAt: number;
	readonly callback: () => void;
}

class FakeClock implements WorkspaceWatcherClock {
	#now = 0;
	#nextId = 1;
	readonly #tasks = new Map<number, ClockTask>();

	get pendingCount(): number {
		return this.#tasks.size;
	}

	get nextDelay(): number | undefined {
		const task = this.#nextTask();
		return task === undefined ? undefined : task.dueAt - this.#now;
	}

	setTimeout(callback: () => void, delayMs: number): number {
		const id = this.#nextId++;
		this.#tasks.set(id, {
			id,
			dueAt: this.#now + delayMs,
			callback,
		});
		return id;
	}

	clearTimeout(handle: unknown): void {
		if (typeof handle === "number") {
			this.#tasks.delete(handle);
		}
	}

	advanceBy(milliseconds: number): void {
		const target = this.#now + milliseconds;
		for (;;) {
			const task = this.#nextTask();
			if (task === undefined || task.dueAt > target) {
				break;
			}
			this.#tasks.delete(task.id);
			this.#now = task.dueAt;
			task.callback();
		}
		this.#now = target;
	}

	#nextTask(): ClockTask | undefined {
		return Array.from(this.#tasks.values()).sort(
			(left, right) => left.dueAt - right.dueAt || left.id - right.id,
		)[0];
	}
}

class FakePageLifecycle implements WorkspaceWatcherPageLifecycle {
	listener: EventListener | undefined;
	readonly addEventListener = vi.fn(
		(_type: "pagehide", listener: EventListener): void => {
			this.listener = listener;
		},
	);
	readonly removeEventListener = vi.fn(
		(_type: "pagehide", listener: EventListener): void => {
			if (this.listener === listener) {
				this.listener = undefined;
			}
		},
	);

	pageHide(): void {
		this.listener?.({ type: "pagehide" } as Event);
	}
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function watchResult(
	roots: readonly WorkspaceWatchPendingRoot[] = [],
): WorkspaceWatchSyncResult {
	return { workspaceId: WORKSPACE_ID, roots };
}

function workspaceWatchResult(
	workspaceId: string,
	roots: readonly WorkspaceWatchPendingRoot[] = [],
): WorkspaceWatchSyncResult {
	return { workspaceId, roots };
}

function pending(
	rootId: string,
	generation: number,
	rescanRequired = false,
): WorkspaceWatchPendingRoot {
	return { rootId, generation, rescanRequired };
}

function snapshotRequest(request: WorkspaceWatchSyncRequest): unknown {
	return {
		roots: request.roots.map((root) => ({ ...root })),
	};
}

async function flushMicrotasks(rounds = 12): Promise<void> {
	for (let index = 0; index < rounds; index += 1) {
		await Promise.resolve();
	}
}

async function runDue(clock: FakeClock): Promise<void> {
	clock.advanceBy(0);
	await flushMicrotasks();
}

function createTransport(
	sync: WorkspaceWatcherTransport["sync"],
): WorkspaceWatcherTransport & {
	readonly listenWake: ReturnType<typeof vi.fn>;
	readonly wakeListeners: Set<(wake: WorkspaceWatchWakeEvent) => void>;
	readonly unlisten: ReturnType<typeof vi.fn>;
} {
	const wakeListeners = new Set<(wake: WorkspaceWatchWakeEvent) => void>();
	const unlisten = vi.fn(
		(listener: (wake: WorkspaceWatchWakeEvent) => void) => {
			wakeListeners.delete(listener);
		},
	);
	const listenWake = vi.fn(
		async (listener: (wake: WorkspaceWatchWakeEvent) => void) => {
			wakeListeners.add(listener);
			return (): void => unlisten(listener);
		},
	);
	return { listenWake, sync, wakeListeners, unlisten };
}

function createWorkspaceWatcherManager(
	transport: WorkspaceWatcherTransport,
	options: WorkspaceWatcherManagerOptions = {},
): ReturnType<typeof createRawWorkspaceWatcherManager> {
	const manager = createRawWorkspaceWatcherManager(transport, options);
	manager.reconcileRoots([ROOT_A, ROOT_B]);
	return manager;
}

function emitWake(
	transport: ReturnType<typeof createTransport>,
	workspaceId = WORKSPACE_ID,
): void {
	for (const listener of transport.wakeListeners) {
		listener({ workspaceId });
	}
}

describe("per-bridge workspace watcher manager", () => {
	it("starts with an empty authority set and refuses unknown roots without side effects", () => {
		const clock = new FakeClock();
		const transport = createTransport(vi.fn(async () => watchResult()));
		const manager = createRawWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});

		const stop = manager.workspaceWatch(ROOT_A, vi.fn());
		stop();

		expect(transport.listenWake).not.toHaveBeenCalled();
		expect(transport.sync).not.toHaveBeenCalled();
		expect(clock.pendingCount).toBe(0);
	});

	it("ref-counts root listeners while sharing one wake listener and one timer", async () => {
		const clock = new FakeClock();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult(),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();

		const unlistenFirst = manager.workspaceWatch(ROOT_A, listener);
		const unlistenSecond = manager.workspaceWatch(ROOT_A, listener);
		await flushMicrotasks();

		expect(transport.listenWake).toHaveBeenCalledOnce();
		expect(transport.wakeListeners.size).toBe(1);
		expect(clock.pendingCount).toBe(1);
		await runDue(clock);
		expect(sync).toHaveBeenCalledOnce();
		expect(snapshotRequest(sync.mock.calls[0]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(clock.pendingCount).toBe(1);

		unlistenFirst();
		await flushMicrotasks();
		expect(transport.unlisten).not.toHaveBeenCalled();
		expect(clock.pendingCount).toBe(1);

		unlistenSecond();
		await flushMicrotasks();
		expect(transport.unlisten).toHaveBeenCalledOnce();
		expect(transport.wakeListeners.size).toBe(0);
		expect(clock.pendingCount).toBe(0);
	});

	it("revokes removed roots and detaches every watcher when accepted authority becomes empty", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			return watchResult();
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		manager.reconcileRoots([ROOT_A, ROOT_B]);
		const stopRootA = manager.workspaceWatch(ROOT_A, vi.fn());
		manager.workspaceWatch(ROOT_B, vi.fn());

		await runDue(clock);
		expect(requests).toEqual([
			{
				roots: [
					{ rootId: ROOT_A, acknowledgedGeneration: null },
					{ rootId: ROOT_B, acknowledgedGeneration: null },
				],
			},
		]);

		manager.reconcileRoots([ROOT_B]);
		await runDue(clock);
		expect(requests[1]).toEqual({
			roots: [{ rootId: ROOT_B, acknowledgedGeneration: null }],
		});
		expect(() => manager.reconcileRoots([ROOT_A, ROOT_A])).toThrow(
			"The workspace watcher root set is invalid.",
		);
		const rejectedListener = vi.fn();
		manager.workspaceWatch(ROOT_A, rejectedListener);
		expect(clock.pendingCount).toBe(1);
		emitWake(transport);
		await runDue(clock);
		expect(requests[2]).toEqual({
			roots: [{ rootId: ROOT_B, acknowledgedGeneration: null }],
		});

		manager.reconcileRoots([]);
		await flushMicrotasks();
		expect(transport.unlisten).toHaveBeenCalledOnce();
		expect(transport.wakeListeners.size).toBe(0);
		expect(clock.pendingCount).toBe(0);
		expect(rejectedListener).not.toHaveBeenCalled();

		stopRootA();
	});

	it("ignores an in-flight revoked result and protects a same-root replacement from the old disposer", async () => {
		const clock = new FakeClock();
		const first = deferred<WorkspaceWatchSyncResult>();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			sync.mock.calls.length === 1
				? first.promise
				: watchResult([pending(ROOT_A, 5, true)]),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		manager.reconcileRoots([ROOT_A]);
		const oldListener = vi.fn();
		const stopOld = manager.workspaceWatch(ROOT_A, oldListener);

		await runDue(clock);
		expect(sync).toHaveBeenCalledOnce();
		manager.reconcileRoots([]);
		manager.reconcileRoots([ROOT_A]);
		const replacement = vi.fn();
		manager.workspaceWatch(ROOT_A, replacement);
		stopOld();

		first.resolve(watchResult([pending(ROOT_A, 4, true)]));
		await flushMicrotasks();
		expect(oldListener).not.toHaveBeenCalled();
		expect(replacement).not.toHaveBeenCalled();
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(replacement).toHaveBeenCalledOnce();
		expect(snapshotRequest(sync.mock.calls[1]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
	});

	it("delivers a generation once and sends its acknowledgement in the next serial sync", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			return requests.length === 1
				? watchResult([pending(ROOT_A, 1, true)])
				: watchResult();
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		expect(listener).toHaveBeenCalledOnce();
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(requests).toEqual([
			{ roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }] },
			{ roots: [{ rootId: ROOT_A, acknowledgedGeneration: 1 }] },
		]);
		expect(listener).toHaveBeenCalledOnce();
		expect(clock.nextDelay).toBe(100);
	});

	it("keeps the saturated generation convergent without a zero-delay retry loop", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			return watchResult([pending(ROOT_A, 0xffff_ffff, true)]);
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		expect(listener).toHaveBeenCalledOnce();
		expect(requests[0]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(listener).toHaveBeenCalledTimes(2);
		expect(requests[1]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: 0xffff_ffff }],
		});
		expect(clock.nextDelay).toBe(100);

		clock.advanceBy(100);
		await flushMicrotasks();
		expect(listener).toHaveBeenCalledTimes(3);
		expect(clock.nextDelay).toBe(100);
	});

	it("uses wake only to lower timer latency and still pulls after a lost wake", async () => {
		const clock = new FakeClock();
		let generationAvailable = false;
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			generationAvailable ? watchResult([pending(ROOT_A, 1)]) : watchResult(),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		expect(clock.nextDelay).toBe(100);
		generationAvailable = true;
		clock.advanceBy(99);
		await flushMicrotasks();
		expect(sync).toHaveBeenCalledOnce();
		clock.advanceBy(1);
		await flushMicrotasks();
		expect(sync).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenCalledOnce();

		await runDue(clock);
		expect(clock.nextDelay).toBe(100);
		emitWake(transport);
		emitWake(transport);
		emitWake(transport);
		expect(clock.pendingCount).toBe(1);
		expect(clock.nextDelay).toBe(0);
		await runDue(clock);
		expect(sync).toHaveBeenCalledTimes(4);
	});

	it("binds the first sync workspace and never delivers or acknowledges a mismatched result", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			switch (requests.length) {
				case 1:
					return watchResult();
				case 2:
					return workspaceWatchResult(OTHER_WORKSPACE_ID, [pending(ROOT_A, 1)]);
				case 3:
					return watchResult([pending(ROOT_A, 1)]);
				default:
					return watchResult();
			}
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		emitWake(transport);
		await runDue(clock);
		expect(listener).not.toHaveBeenCalled();
		expect(requests[1]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(clock.nextDelay).toBe(100);

		clock.advanceBy(100);
		await flushMicrotasks();
		expect(listener).toHaveBeenCalledOnce();
		expect(requests[2]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(requests[3]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: 1 }],
		});
	});

	it("ignores foreign workspace wakes after the first sync binds identity", async () => {
		const clock = new FakeClock();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult(),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		manager.workspaceWatch(ROOT_A, vi.fn());

		await runDue(clock);
		expect(clock.nextDelay).toBe(100);
		emitWake(transport, OTHER_WORKSPACE_ID);
		expect(clock.nextDelay).toBe(100);
		clock.advanceBy(99);
		await flushMicrotasks();
		expect(sync).toHaveBeenCalledOnce();
		clock.advanceBy(1);
		await flushMicrotasks();
		expect(sync).toHaveBeenCalledTimes(2);
	});

	it("never overlaps sync calls when wakes arrive during an in-flight pull", async () => {
		const clock = new FakeClock();
		const first = deferred<WorkspaceWatchSyncResult>();
		let activeSyncs = 0;
		let maximumActiveSyncs = 0;
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) => {
			activeSyncs += 1;
			maximumActiveSyncs = Math.max(maximumActiveSyncs, activeSyncs);
			try {
				return sync.mock.calls.length === 1
					? await first.promise
					: watchResult();
			} finally {
				activeSyncs -= 1;
			}
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		manager.workspaceWatch(ROOT_A, vi.fn());

		await runDue(clock);
		expect(sync).toHaveBeenCalledOnce();
		emitWake(transport);
		emitWake(transport);
		clock.advanceBy(1_000);
		await flushMicrotasks();
		expect(sync).toHaveBeenCalledOnce();

		first.resolve(watchResult());
		await flushMicrotasks();
		expect(clock.nextDelay).toBe(0);
		await runDue(clock);
		expect(sync).toHaveBeenCalledTimes(2);
		expect(maximumActiveSyncs).toBe(1);
	});

	it("retains ack after listener and transport errors, then retries only unfinished listeners", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		let transportFailure = true;
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			if (transportFailure) {
				transportFailure = false;
				throw new Error("offline");
			}
			return request.roots[0]!.acknowledgedGeneration === null
				? watchResult([pending(ROOT_A, 3, true)])
				: watchResult();
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const successful = vi.fn();
		const flaky = vi
			.fn<() => void>()
			.mockImplementationOnce(() => {
				throw new Error("refresh failed");
			})
			.mockImplementation(() => undefined);
		manager.workspaceWatch(ROOT_A, successful);
		manager.workspaceWatch(ROOT_A, flaky);

		await runDue(clock);
		expect(requests).toEqual([
			{ roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }] },
		]);
		expect(clock.nextDelay).toBe(100);

		clock.advanceBy(100);
		await flushMicrotasks();
		expect(successful).toHaveBeenCalledOnce();
		expect(flaky).toHaveBeenCalledOnce();
		expect(clock.nextDelay).toBe(100);

		clock.advanceBy(100);
		await flushMicrotasks();
		expect(successful).toHaveBeenCalledOnce();
		expect(flaky).toHaveBeenCalledTimes(2);
		expect(requests[2]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(requests[3]).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: 3 }],
		});
	});

	it("advances acknowledgements independently for multiple roots", async () => {
		const clock = new FakeClock();
		const requests: unknown[] = [];
		const sync = vi.fn(async (request: WorkspaceWatchSyncRequest) => {
			requests.push(snapshotRequest(request));
			const rootA = request.roots.find(({ rootId }) => rootId === ROOT_A)!;
			const rootB = request.roots.find(({ rootId }) => rootId === ROOT_B)!;
			const roots: WorkspaceWatchPendingRoot[] = [];
			if (rootA.acknowledgedGeneration === null) {
				roots.push(pending(ROOT_A, 1));
			}
			if (rootB.acknowledgedGeneration === null) {
				roots.push(pending(ROOT_B, 2, true));
			}
			return watchResult(roots);
		});
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const rootAListener = vi.fn();
		const rootBListener = vi
			.fn<() => void>()
			.mockImplementationOnce(() => {
				throw new Error("root B refresh failed");
			})
			.mockImplementation(() => undefined);
		manager.workspaceWatch(ROOT_A, rootAListener);
		manager.workspaceWatch(ROOT_B, rootBListener);

		await runDue(clock);
		expect(rootAListener).toHaveBeenCalledOnce();
		expect(rootBListener).toHaveBeenCalledOnce();
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(requests[1]).toEqual({
			roots: [
				{ rootId: ROOT_A, acknowledgedGeneration: 1 },
				{ rootId: ROOT_B, acknowledgedGeneration: null },
			],
		});
		expect(rootAListener).toHaveBeenCalledOnce();
		expect(rootBListener).toHaveBeenCalledTimes(2);
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(requests[2]).toEqual({
			roots: [
				{ rootId: ROOT_A, acknowledgedGeneration: 1 },
				{ rootId: ROOT_B, acknowledgedGeneration: 2 },
			],
		});
	});

	it("coalesces duplicate generations and ignores stale out-of-order results", async () => {
		const clock = new FakeClock();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			sync.mock.calls.length === 1
				? watchResult([
						pending(ROOT_A, 2),
						pending(ROOT_A, 1, true),
						pending(ROOT_A, 2),
					])
				: watchResult([pending(ROOT_A, 1, true)]),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		expect(listener).toHaveBeenCalledOnce();
		await runDue(clock);
		expect(listener).toHaveBeenCalledOnce();
		expect(snapshotRequest(sync.mock.calls[1]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: 2 }],
		});
		expect(clock.nextDelay).toBe(100);
	});

	it("drops a late result after unsubscribe and same-root re-subscribe", async () => {
		const clock = new FakeClock();
		const first = deferred<WorkspaceWatchSyncResult>();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			sync.mock.calls.length === 1
				? first.promise
				: watchResult([pending(ROOT_A, 5)]),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const oldListener = vi.fn();
		const newListener = vi.fn();
		const stopOld = manager.workspaceWatch(ROOT_A, oldListener);

		await runDue(clock);
		stopOld();
		manager.workspaceWatch(ROOT_A, newListener);
		first.resolve(watchResult([pending(ROOT_A, 4)]));
		await flushMicrotasks();
		expect(oldListener).not.toHaveBeenCalled();
		expect(newListener).not.toHaveBeenCalled();
		expect(clock.nextDelay).toBe(0);

		await runDue(clock);
		expect(newListener).toHaveBeenCalledOnce();
		expect(snapshotRequest(sync.mock.calls[1]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
	});

	it("cancellation releases an in-flight async listener without acknowledging it", async () => {
		const clock = new FakeClock();
		const listenerResult = deferred<void>();
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult([pending(ROOT_A, 1)]),
		);
		const transport = createTransport(sync);
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const listener = vi.fn(() => listenerResult.promise);
		const stop = manager.workspaceWatch(ROOT_A, listener);

		await runDue(clock);
		expect(listener).toHaveBeenCalledOnce();
		stop();
		await flushMicrotasks();
		expect(clock.pendingCount).toBe(0);

		const replacement = vi.fn();
		manager.workspaceWatch(ROOT_A, replacement);
		await runDue(clock);
		expect(sync).toHaveBeenCalledTimes(2);
		expect(snapshotRequest(sync.mock.calls[1]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(replacement).toHaveBeenCalledOnce();

		listenerResult.reject(new Error("late failure"));
		await flushMicrotasks();
	});

	it("cleans up a wake listener that finishes initialization after the last root leaves", async () => {
		const clock = new FakeClock();
		const initialized = deferred<() => void>();
		const unlisten = vi.fn();
		const transport: WorkspaceWatcherTransport = {
			listenWake: vi.fn(() => initialized.promise),
			sync: vi.fn(async () => watchResult()),
		};
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const stop = manager.workspaceWatch(ROOT_A, vi.fn());
		stop();
		expect(clock.pendingCount).toBe(0);

		initialized.resolve(unlisten);
		await flushMicrotasks();
		expect(unlisten).toHaveBeenCalledOnce();
		expect(transport.sync).not.toHaveBeenCalled();
	});

	it("keeps polling and retries wake-listener initialization after a setup error", async () => {
		const clock = new FakeClock();
		const wakeListeners = new Set<(wake: WorkspaceWatchWakeEvent) => void>();
		const listenWake = vi
			.fn<WorkspaceWatcherTransport["listenWake"]>()
			.mockRejectedValueOnce(new Error("event channel unavailable"))
			.mockImplementation(async (listener) => {
				wakeListeners.add(listener);
				return (): void => {
					wakeListeners.delete(listener);
				};
			});
		const sync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult([pending(ROOT_A, 1)]),
		);
		const manager = createWorkspaceWatcherManager(
			{ listenWake, sync },
			{
				clock,
				pageLifecycle: null,
				pollIntervalMs: 100,
			},
		);
		const listener = vi.fn();
		manager.workspaceWatch(ROOT_A, listener);
		await flushMicrotasks();
		expect(listenWake).toHaveBeenCalledOnce();

		await runDue(clock);
		expect(sync).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledOnce();
		expect(listenWake).toHaveBeenCalledTimes(2);
		expect(wakeListeners.size).toBe(1);
	});

	it("waits for async unlisten before installing a replacement wake listener", async () => {
		const clock = new FakeClock();
		const firstUnlisten = deferred<void>();
		let activeWakeListeners = 0;
		let maximumWakeListeners = 0;
		const listenWake = vi.fn(
			async (_listener: (wake: WorkspaceWatchWakeEvent) => void) => {
				activeWakeListeners += 1;
				maximumWakeListeners = Math.max(
					maximumWakeListeners,
					activeWakeListeners,
				);
				const call = listenWake.mock.calls.length;
				return async (): Promise<void> => {
					if (call === 1) {
						await firstUnlisten.promise;
					}
					activeWakeListeners -= 1;
				};
			},
		);
		const transport: WorkspaceWatcherTransport = {
			listenWake,
			sync: vi.fn(async () => watchResult()),
		};
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});

		const stop = manager.workspaceWatch(ROOT_A, vi.fn());
		await flushMicrotasks();
		stop();
		manager.workspaceWatch(ROOT_B, vi.fn());
		await flushMicrotasks();
		expect(listenWake).toHaveBeenCalledOnce();
		expect(activeWakeListeners).toBe(1);

		firstUnlisten.resolve();
		await flushMicrotasks();
		expect(listenWake).toHaveBeenCalledTimes(2);
		expect(activeWakeListeners).toBe(1);
		expect(maximumWakeListeners).toBe(1);
	});

	it("disposes all roots, timer and wake listener on pagehide", async () => {
		const clock = new FakeClock();
		const lifecycle = new FakePageLifecycle();
		const transport = createTransport(vi.fn(async () => watchResult()));
		const manager = createWorkspaceWatcherManager(transport, {
			clock,
			pageLifecycle: lifecycle,
			pollIntervalMs: 100,
		});
		manager.workspaceWatch(ROOT_A, vi.fn());
		manager.workspaceWatch(ROOT_B, vi.fn());
		await flushMicrotasks();
		expect(lifecycle.addEventListener).toHaveBeenCalledOnce();
		expect(clock.pendingCount).toBe(1);

		lifecycle.pageHide();
		await flushMicrotasks();
		expect(lifecycle.removeEventListener).toHaveBeenCalledOnce();
		expect(transport.unlisten).toHaveBeenCalledOnce();
		expect(clock.pendingCount).toBe(0);
		expect(() => manager.workspaceWatch(ROOT_A, vi.fn())).toThrow(
			"The workspace watcher manager has been disposed.",
		);
	});

	it("keeps clocks, listeners and acknowledgement state isolated per manager", async () => {
		const firstClock = new FakeClock();
		const secondClock = new FakeClock();
		const firstSync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult([pending(ROOT_A, 1)]),
		);
		const secondSync = vi.fn(async (_request: WorkspaceWatchSyncRequest) =>
			watchResult(),
		);
		const firstTransport = createTransport(firstSync);
		const secondTransport = createTransport(secondSync);
		const firstManager = createWorkspaceWatcherManager(firstTransport, {
			clock: firstClock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const secondManager = createWorkspaceWatcherManager(secondTransport, {
			clock: secondClock,
			pageLifecycle: null,
			pollIntervalMs: 100,
		});
		const firstListener = vi.fn();
		const secondListener = vi.fn();
		firstManager.workspaceWatch(ROOT_A, firstListener);
		secondManager.workspaceWatch(ROOT_A, secondListener);

		await runDue(firstClock);
		expect(firstSync).toHaveBeenCalledOnce();
		expect(firstListener).toHaveBeenCalledOnce();
		expect(secondSync).not.toHaveBeenCalled();
		expect(secondListener).not.toHaveBeenCalled();

		await runDue(secondClock);
		expect(secondSync).toHaveBeenCalledOnce();
		expect(snapshotRequest(secondSync.mock.calls[0]![0])).toEqual({
			roots: [{ rootId: ROOT_A, acknowledgedGeneration: null }],
		});
		expect(secondListener).not.toHaveBeenCalled();
	});
});
