import type {
	PlainBridge,
	WorkspaceSearchTextBatch,
	WorkspaceSearchTextSkipped,
	WorkspaceSearchTextStartRequest,
} from "./contracts";

/**
 * The narrow slice of `PlainBridge` this module actually calls — lets tests
 * supply a minimal fake instead of the entire bridge surface.
 */
export type TextSearchStreamTransport = Pick<
	PlainBridge,
	| "workspaceSearchTextStart"
	| "workspaceSearchTextPoll"
	| "workspaceSearchTextCancel"
	| "workspaceSearchTextWatch"
>;

export interface TextSearchStreamClock {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

const systemClock: TextSearchStreamClock = Object.freeze({
	setTimeout(callback: () => void, delayMs: number): unknown {
		return globalThis.setTimeout(callback, delayMs);
	},
	clearTimeout(handle: unknown): void {
		globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
	},
});

/** A minimal, structurally-typed subset of `CancellationToken` — avoids this
 * platform-adjacent module depending on the full Workbench cancellation
 * type just to read two members. */
export interface TextSearchStreamCancellationToken {
	readonly isCancellationRequested: boolean;
	readonly onCancellationRequested: (listener: () => void) => {
		dispose(): void;
	};
}

export interface TextSearchStreamOptions {
	/** How long to wait for a wake hint before polling anyway (the lost-wake
	 * fallback — mirrors `workspace-watcher.ts`'s own low-frequency retry for
	 * exactly the same reason: the wake event is fire-and-forget and may
	 * never arrive). Defaults to 1000ms. */
	readonly fallbackPollIntervalMs?: number;
	readonly clock?: TextSearchStreamClock;
}

export interface TextSearchStreamResult {
	readonly limitHit: boolean;
	readonly skipped: WorkspaceSearchTextSkipped;
}

const NO_SKIPPED: WorkspaceSearchTextSkipped = Object.freeze({
	binary: 0,
	oversize: 0,
});

/**
 * Runs one streaming `workspace_search_text_*` request/poll/cancel cycle to
 * completion (or until `token` is cancelled), delivering every batch to
 * `onBatch` as it streams in. Does not catch a synchronous rejection from
 * `workspaceSearchTextStart` itself (e.g. `INVALID_SEARCH_REGEX`) — the
 * caller decides how to surface a pattern that failed to even compile.
 */
export async function runTextSearchStream(
	transport: TextSearchStreamTransport,
	request: WorkspaceSearchTextStartRequest,
	onBatch: (batch: WorkspaceSearchTextBatch) => void,
	token: TextSearchStreamCancellationToken | undefined,
	options: TextSearchStreamOptions = {},
): Promise<TextSearchStreamResult> {
	const clock = options.clock ?? systemClock;
	const fallbackPollIntervalMs = options.fallbackPollIntervalMs ?? 1_000;

	const { searchId } = await transport.workspaceSearchTextStart(request);
	// Read through a function, not a repeated direct property access: `token`
	// is a live, externally-mutated flag (cancellation can be requested at
	// any time between checks), and TypeScript's control-flow narrowing
	// otherwise treats one `=== true` check as proof the same expression can
	// never be `true` again later in the function.
	const isCancelled = (): boolean => token?.isCancellationRequested === true;

	if (isCancelled()) {
		await safeCancel(transport, searchId);
		return { limitHit: false, skipped: NO_SKIPPED };
	}

	let wake: (() => void) | undefined;
	const unlistenWake = transport.workspaceSearchTextWatch((wokenSearchId) => {
		if (wokenSearchId === searchId) {
			wake?.();
		}
	});
	const cancelSubscription = token?.onCancellationRequested(() => {
		wake?.();
	});

	try {
		let cursor = 0;
		for (;;) {
			const result = await transport.workspaceSearchTextPoll(searchId, cursor);
			cursor = result.nextCursor;
			for (const batch of result.batches) {
				onBatch(batch);
			}
			if (result.done) {
				return { limitHit: result.limitHit, skipped: result.skipped };
			}
			if (isCancelled()) {
				await safeCancel(transport, searchId);
				return { limitHit: result.limitHit, skipped: result.skipped };
			}
			await waitForWakeOrTimeout(clock, fallbackPollIntervalMs, (resolve) => {
				wake = resolve;
			});
			if (isCancelled()) {
				await safeCancel(transport, searchId);
				return { limitHit: result.limitHit, skipped: result.skipped };
			}
		}
	} finally {
		wake = undefined;
		void unlistenWake();
		cancelSubscription?.dispose();
	}
}

function waitForWakeOrTimeout(
	clock: TextSearchStreamClock,
	timeoutMs: number,
	registerResolver: (resolve: () => void) => void,
): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const timer = clock.setTimeout(() => {
			if (!settled) {
				settled = true;
				resolve();
			}
		}, timeoutMs);
		registerResolver(() => {
			if (!settled) {
				settled = true;
				clock.clearTimeout(timer);
				resolve();
			}
		});
	});
}

async function safeCancel(
	transport: TextSearchStreamTransport,
	searchId: string,
): Promise<void> {
	try {
		await transport.workspaceSearchTextCancel(searchId);
	} catch {
		// Already gone (raced with natural completion or another cancel) —
		// cancellation is best-effort from the caller's point of view.
	}
}
