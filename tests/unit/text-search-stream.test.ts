import { describe, expect, it } from "vitest";

import type {
	WorkspaceSearchTextBatch,
	WorkspaceSearchTextPollResult,
} from "../../app/platform/tauri/contracts";
import {
	runTextSearchStream,
	type TextSearchStreamCancellationToken,
	type TextSearchStreamClock,
	type TextSearchStreamTransport,
} from "../../app/platform/tauri/text-search-stream";

const NO_SKIPPED = Object.freeze({ binary: 0, oversize: 0 });
const ROOT_ID = "00000000-0000-4000-8000-000000000101";

function batch(path: string): WorkspaceSearchTextBatch {
	return Object.freeze({
		rootId: ROOT_ID,
		path,
		matches: [
			Object.freeze({
				line: 1,
				column: 1,
				length: 1,
				previewText: path,
				absoluteColumn: 1,
			}),
		],
	});
}

/** A deterministic, manually-advanced clock: `setTimeout` never fires on its
 * own — only `advance()` (synchronously, no real event loop involvement)
 * triggers due timers. Lets the fallback-poll tests control exactly when the
 * lost-wake timer fires without any real wall-clock waiting. */
class FakeClock implements TextSearchStreamClock {
	#nextId = 1;
	#timers = new Map<number, { fireAt: number; callback: () => void }>();
	#now = 0;

	setTimeout(callback: () => void, delayMs: number): unknown {
		const id = this.#nextId;
		this.#nextId += 1;
		this.#timers.set(id, { fireAt: this.#now + delayMs, callback });
		return id;
	}

	clearTimeout(handle: unknown): void {
		this.#timers.delete(handle as number);
	}

	advance(ms: number): void {
		this.#now += ms;
		// Snapshot before firing: a fired callback may schedule a new timer
		// (mutating `#timers`), and iterating the live Map while that happens
		// would be undefined behavior for this loop's purposes.
		const snapshot = Array.from(this.#timers);
		for (const [id, timer] of snapshot) {
			if (timer.fireAt <= this.#now) {
				this.#timers.delete(id);
				timer.callback();
			}
		}
	}
}

class FakeCancellationToken implements TextSearchStreamCancellationToken {
	isCancellationRequested = false;
	#listeners = new Set<() => void>();

	readonly onCancellationRequested = (
		listener: () => void,
	): { dispose(): void } => {
		this.#listeners.add(listener);
		return { dispose: () => this.#listeners.delete(listener) };
	};

	cancel(): void {
		this.isCancellationRequested = true;
		// Snapshot before firing: a listener may call `dispose()` on its own
		// registration (removing itself from `#listeners`), which would mutate
		// the Set mid-iteration.
		const snapshot = Array.from(this.#listeners);
		for (const listener of snapshot) {
			listener();
		}
	}
}

interface FakeTransportHandle {
	readonly searchId: string;
	readonly transport: TextSearchStreamTransport;
	readonly pollCalls: Array<{ searchId: string; cursor: number }>;
	readonly cancelCalls: string[];
	readonly wakeListenerCount: () => number;
	enqueuePoll(result: WorkspaceSearchTextPollResult): void;
	fireWake(searchId?: string): void;
}

function createFakeTransport(
	searchId = "00000000-0000-4000-8000-000000000001",
): FakeTransportHandle {
	const pollQueue: WorkspaceSearchTextPollResult[] = [];
	const pollCalls: Array<{ searchId: string; cursor: number }> = [];
	const cancelCalls: string[] = [];
	const wakeListeners = new Set<(searchId: string) => void>();
	return {
		searchId,
		pollCalls,
		cancelCalls,
		wakeListenerCount: () => wakeListeners.size,
		enqueuePoll(result) {
			pollQueue.push(result);
		},
		fireWake(id = searchId) {
			for (const listener of wakeListeners) {
				listener(id);
			}
		},
		transport: {
			async workspaceSearchTextStart() {
				return { searchId };
			},
			async workspaceSearchTextPoll(id, cursor) {
				pollCalls.push({ searchId: id, cursor });
				const next = pollQueue.shift();
				if (next === undefined) {
					throw new Error("test transport: no more poll results queued");
				}
				return next;
			},
			async workspaceSearchTextCancel(id) {
				cancelCalls.push(id);
			},
			workspaceSearchTextWatch(listener) {
				wakeListeners.add(listener);
				return () => {
					wakeListeners.delete(listener);
				};
			},
		},
	};
}

async function waitUntil(
	predicate: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("waitUntil timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

const request = Object.freeze({
	roots: ["00000000-0000-4000-8000-000000000101"],
	pattern: "needle",
	isRegExp: false,
	isCaseSensitive: false,
	isWordMatch: false,
	excludeGlobs: [],
	maxResults: 20_000,
	maxFileSize: null,
});

describe("runTextSearchStream", () => {
	it("delivers every batch and returns the final limitHit/skipped on immediate completion", async () => {
		const fake = createFakeTransport();
		fake.enqueuePoll({
			batches: [batch("a.ts")],
			nextCursor: 1,
			done: true,
			limitHit: true,
			skipped: { binary: 1, oversize: 2 },
		});
		const delivered: WorkspaceSearchTextBatch[] = [];
		const result = await runTextSearchStream(
			fake.transport,
			request,
			(item) => delivered.push(item),
			undefined,
			{ clock: new FakeClock() },
		);
		expect(delivered).toEqual([batch("a.ts")]);
		expect(result).toEqual({
			limitHit: true,
			skipped: { binary: 1, oversize: 2 },
		});
		expect(fake.pollCalls).toEqual([{ searchId: fake.searchId, cursor: 0 }]);
		expect(fake.wakeListenerCount()).toBe(0);
	});

	it("polls again after a matching wake hint, advancing the cursor across calls", async () => {
		const fake = createFakeTransport();
		fake.enqueuePoll({
			batches: [batch("a.ts")],
			nextCursor: 1,
			done: false,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		fake.enqueuePoll({
			batches: [batch("b.ts")],
			nextCursor: 2,
			done: true,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		const delivered: WorkspaceSearchTextBatch[] = [];
		const promise = runTextSearchStream(
			fake.transport,
			request,
			(item) => delivered.push(item),
			undefined,
			{ clock: new FakeClock(), fallbackPollIntervalMs: 999_999 },
		);
		await waitUntil(() => fake.pollCalls.length === 1);
		fake.fireWake();
		await promise;
		expect(delivered).toEqual([batch("a.ts"), batch("b.ts")]);
		expect(fake.pollCalls).toEqual([
			{ searchId: fake.searchId, cursor: 0 },
			{ searchId: fake.searchId, cursor: 1 },
		]);
	});

	it("falls back to polling once the fallback interval elapses without any wake", async () => {
		const fake = createFakeTransport();
		fake.enqueuePoll({
			batches: [batch("a.ts")],
			nextCursor: 1,
			done: false,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		fake.enqueuePoll({
			batches: [],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		const clock = new FakeClock();
		const promise = runTextSearchStream(
			fake.transport,
			request,
			() => {},
			undefined,
			{ clock, fallbackPollIntervalMs: 5_000 },
		);
		await waitUntil(() => fake.pollCalls.length === 1);
		clock.advance(5_000);
		await promise;
		expect(fake.pollCalls.length).toBe(2);
	});

	it("ignores a wake hint for a different searchId and still relies on the fallback timer", async () => {
		const fake = createFakeTransport();
		fake.enqueuePoll({
			batches: [],
			nextCursor: 0,
			done: false,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		fake.enqueuePoll({
			batches: [],
			nextCursor: 0,
			done: true,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		const clock = new FakeClock();
		const promise = runTextSearchStream(
			fake.transport,
			request,
			() => {},
			undefined,
			{ clock, fallbackPollIntervalMs: 1_000 },
		);
		await waitUntil(() => fake.pollCalls.length === 1);
		fake.fireWake("00000000-0000-4000-8000-000000000999");
		// A stray wake for another search must not advance this one; only the
		// fallback timer (still pending) should eventually do so.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fake.pollCalls.length).toBe(1);
		clock.advance(1_000);
		await promise;
		expect(fake.pollCalls.length).toBe(2);
	});

	it("cancels immediately, without ever polling, when the token is already cancelled", async () => {
		const fake = createFakeTransport();
		const token = new FakeCancellationToken();
		token.cancel();
		const result = await runTextSearchStream(
			fake.transport,
			request,
			() => {},
			token,
			{ clock: new FakeClock() },
		);
		expect(result).toEqual({ limitHit: false, skipped: NO_SKIPPED });
		expect(fake.cancelCalls).toEqual([fake.searchId]);
		expect(fake.pollCalls).toEqual([]);
	});

	it("cancels mid-stream when the token fires while waiting for a wake hint, keeping batches already delivered", async () => {
		const fake = createFakeTransport();
		fake.enqueuePoll({
			batches: [batch("a.ts")],
			nextCursor: 1,
			done: false,
			limitHit: false,
			skipped: NO_SKIPPED,
		});
		const token = new FakeCancellationToken();
		const delivered: WorkspaceSearchTextBatch[] = [];
		const promise = runTextSearchStream(
			fake.transport,
			request,
			(item) => delivered.push(item),
			token,
			{ clock: new FakeClock(), fallbackPollIntervalMs: 999_999 },
		);
		await waitUntil(() => fake.pollCalls.length === 1);
		token.cancel();
		await promise;
		expect(delivered).toEqual([batch("a.ts")]);
		expect(fake.cancelCalls).toEqual([fake.searchId]);
	});

	it("propagates a rejection from workspaceSearchTextStart (e.g. an invalid regex) without catching it", async () => {
		const transport: TextSearchStreamTransport = {
			async workspaceSearchTextStart() {
				throw { code: "INVALID_SEARCH_REGEX", message: "bad regex" };
			},
			async workspaceSearchTextPoll() {
				throw new Error("must not be called: start rejected");
			},
			async workspaceSearchTextCancel() {},
			workspaceSearchTextWatch() {
				return () => {};
			},
		};
		await expect(
			runTextSearchStream(transport, request, () => {}, undefined, {
				clock: new FakeClock(),
			}),
		).rejects.toEqual({ code: "INVALID_SEARCH_REGEX", message: "bad regex" });
	});
});
