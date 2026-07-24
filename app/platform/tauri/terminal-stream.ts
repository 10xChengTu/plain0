import type {
	PlainBridge,
	TerminalDataEvent,
	TerminalExitEvent,
} from "./contracts";

/**
 * The narrow slice of `PlainBridge` this module actually calls — lets tests
 * supply a minimal fake instead of the entire bridge surface, mirroring
 * `text-search-stream.ts`'s own `TextSearchStreamTransport`.
 */
export type TerminalStreamTransport = Pick<
	PlainBridge,
	| "terminalStart"
	| "terminalInput"
	| "terminalResize"
	| "terminalAck"
	| "terminalKill"
	| "terminalWatchData"
	| "terminalWatchExit"
>;

export interface TerminalStreamStartRequest {
	readonly cwd: string | null;
	readonly cols: number;
	readonly rows: number;
}

export interface TerminalStreamHandlers {
	/** Called with each chunk's raw bytes, in delivery order (see the module
	 * doc's ordering/dedupe note). */
	readonly onData: (bytes: Uint8Array) => void;
	/** Called once, the first time this session's exit is observed. Does
	 * *not* imply `onData` will never fire again for this session — see the
	 * module doc. */
	readonly onExit: (exitCode: number) => void;
}

export interface TerminalStream {
	readonly sessionId: string;
	/** Writes `data` to the session's pty (keystrokes/pasted input). */
	write(data: Uint8Array): Promise<void>;
	resize(cols: number, rows: number): Promise<void>;
	/** Acknowledges `byteCount` bytes of output this caller has now finished
	 * consuming (e.g. handed off to a terminal renderer), resuming a paused
	 * session's reader once enough has been acknowledged — see
	 * `flow::FlowControl`'s doc comment in `src-tauri/src/terminal/flow.rs`
	 * for the high/low water mark this drives. This module has no built-in
	 * ack policy of its own (it never calls this on the caller's behalf):
	 * exactly when a "batch" is considered consumed is a rendering concern
	 * that belongs to whatever calls `write`/observes `onData`, not to this
	 * transport-level bridge. */
	ack(byteCount: number): Promise<void>;
	/** `immediate: true` waits for full teardown before resolving. */
	kill(immediate: boolean): Promise<void>;
	/** Stops listening to this session's events. Does not kill the session —
	 * call `kill` first if that is also wanted. Safe to call more than
	 * once. */
	dispose(): void;
}

/**
 * Opens one terminal session and wires its push-delivered output/exit events
 * to `handlers` — the push-stream analogue of `text-search-stream.ts`'s
 * `runTextSearchStream`. Unlike that poll/cursor protocol, there is no
 * "re-fetch": every `plain://terminal-data` delivery for this session is
 * itself the next authoritative chunk of output.
 *
 * # Listening before the session id is known
 *
 * `terminalWatchData`/`terminalWatchExit` are all-sessions-in-one-window
 * listeners (mirroring `workspaceSearchTextWatch`'s own shape) that this
 * function subscribes to *before* awaiting `terminalStart`, precisely
 * because a spawned shell can produce output before that call's promise
 * settles; events observed before the session id is known are buffered and
 * replayed (filtered to this session) the instant it becomes known, rather
 * than risking losing a real chunk to that race.
 *
 * # Ordering, dedupe, and the exit/data race
 *
 * A single session's chunk delivery is already strictly ordered by the Rust
 * side (`terminal::service`'s single delivery thread — see that module's
 * doc), so this layer's `sequence` tracking exists only as a defensive
 * backstop against a transport-level exact duplicate, not to reorder
 * anything; a genuine gap (a chunk this stream never received) cannot be
 * recovered from here — the same "cannot invent missing data" limit
 * `search`'s poll/cursor protocol has for a lost wake, via a different
 * mechanism.
 *
 * `onExit` fires the moment `plain://terminal-exit` arrives for this
 * session, but that does **not** mean no further `onData` will fire — the
 * Rust side's exit-reporting thread is not synchronized with its delivery
 * thread having drained every chunk the reader ever produced (see
 * `terminal::service`'s module doc for the exact race). Callers must not
 * treat "exited" as license to stop reading; call `dispose()` once truly
 * done with the session.
 */
export async function openTerminalStream(
	transport: TerminalStreamTransport,
	request: TerminalStreamStartRequest,
	handlers: TerminalStreamHandlers,
): Promise<TerminalStream> {
	let sessionId: string | undefined;
	let nextExpectedSequence = 0;
	let disposed = false;
	const pendingData: TerminalDataEvent[] = [];
	const pendingExit: TerminalExitEvent[] = [];

	function deliverData(event: TerminalDataEvent): void {
		if (event.sequence < nextExpectedSequence) {
			// Exact duplicate (or older) — already delivered, ignore.
			return;
		}
		nextExpectedSequence = event.sequence + 1;
		handlers.onData(event.bytes);
	}

	const unlistenData = transport.terminalWatchData((event) => {
		if (sessionId === undefined) {
			pendingData.push(event);
			return;
		}
		if (event.sessionId === sessionId) {
			deliverData(event);
		}
	});
	const unlistenExit = transport.terminalWatchExit((event) => {
		if (sessionId === undefined) {
			pendingExit.push(event);
			return;
		}
		if (event.sessionId === sessionId) {
			handlers.onExit(event.exitCode);
		}
	});

	try {
		const result = await transport.terminalStart(
			request.cwd,
			request.cols,
			request.rows,
		);
		sessionId = result.sessionId;
	} catch (error) {
		unlistenData();
		unlistenExit();
		throw error;
	}

	for (const event of pendingData) {
		if (event.sessionId === sessionId) {
			deliverData(event);
		}
	}
	pendingData.length = 0;
	for (const event of pendingExit) {
		if (event.sessionId === sessionId) {
			handlers.onExit(event.exitCode);
		}
	}
	pendingExit.length = 0;

	const openedSessionId = sessionId;
	return {
		sessionId: openedSessionId,
		async write(data) {
			if (disposed) {
				return;
			}
			await transport.terminalInput(openedSessionId, data);
		},
		async resize(cols, rows) {
			if (disposed) {
				return;
			}
			await transport.terminalResize(openedSessionId, cols, rows);
		},
		async ack(byteCount) {
			if (disposed) {
				return;
			}
			await transport.terminalAck(openedSessionId, byteCount);
		},
		async kill(immediate) {
			await transport.terminalKill(openedSessionId, immediate);
		},
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			unlistenData();
			unlistenExit();
		},
	};
}
