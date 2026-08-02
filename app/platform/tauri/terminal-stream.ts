import type {
	PlainBridge,
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalFrame,
	TerminalScrollbackResult,
} from "./contracts";

/**
 * The narrow slice of `PlainBridge` this module actually calls — lets tests
 * supply a minimal fake instead of the entire bridge surface, mirroring
 * `text-search-stream.ts`'s own `TextSearchStreamTransport`.
 */
export type TerminalStreamTransport = Pick<
	PlainBridge,
	| "terminalStart"
	| "terminalInputText"
	| "terminalInputKey"
	| "terminalFocus"
	| "terminalResize"
	| "terminalAck"
	| "terminalScrollback"
	| "terminalKill"
	| "terminalWatchData"
	| "terminalWatchExit"
>;

export interface TerminalStreamStartRequest {
	readonly rootId: string;
	readonly cwd: string | null;
	readonly cols: number;
	readonly rows: number;
}

export interface TerminalStreamHandlers {
	/** Called with each emitted render-state frame, in delivery order (see
	 * the module doc's ordering/dedupe note). A frame's `rowsData` lists
	 * only the rows that changed since the last one this session emitted
	 * (or every row, when `dirty` is `"full"`) — the caller is responsible
	 * for applying it onto its own retained grid. `sequence` is this frame's
	 * own monotonic delivery number (see `TerminalDataEvent.sequence`'s doc
	 * comment) — passed through unmodified so a rendering-layer caller can
	 * drive `TerminalStream.ack` once it has actually consumed (e.g. painted)
	 * the frame, exactly the "rendering concern" this module's own doc
	 * comment defers to callers rather than building an ack policy in here. */
	readonly onFrame: (frame: TerminalFrame, sequence: number) => void;
	/** Called once, the first time this session's exit is observed. Does
	 * *not* imply `onFrame` will never fire again for this session — see
	 * the module doc. */
	readonly onExit: (exitCode: number) => void;
}

export interface TerminalStream {
	readonly sessionId: string;
	/** Writes `text` (an IME composition commit, or a pasted block) to the
	 * session's pty as its own UTF-8 bytes — no key encoding involved. */
	writeText(text: string): Promise<void>;
	/** Encodes one structured key event through `libghostty-vt`'s own key
	 * encoder and writes the resulting bytes to the session's pty. See
	 * `PlainBridge.terminalInputKey`'s doc comment for what `action`/`key`/
	 * `mods` mean. */
	writeKey(
		action: number,
		key: number,
		mods: number,
		utf8: string | null,
	): Promise<void>;
	/** Reports a focus gained/lost transition — a silent no-op unless the
	 * session's live terminal currently has focus-reporting mode enabled. */
	focus(focused: boolean): Promise<void>;
	resize(cols: number, rows: number): Promise<void>;
	/** Acknowledges every frame up through `sequence` this caller has now
	 * finished consuming (e.g. applied to a retained grid and painted),
	 * freeing the vt thread's single-frame-in-flight emission credit — see
	 * `flow::FlowControl`'s doc comment in `src-tauri/src/terminal/flow.rs`
	 * for the *separate*, byte-level PTY → VT gate this is not the same as
	 * (that leg is driven entirely by the vt thread itself now — see
	 * `src-tauri/src/terminal/service.rs`'s module doc). This module has no
	 * built-in ack policy of its own (it never calls this on the caller's
	 * behalf): exactly when a frame is considered "consumed" is a rendering
	 * concern that belongs to whatever calls `onFrame`, not to this
	 * transport-level bridge. */
	ack(sequence: number): Promise<void>;
	/** Pulls up to `count` scrollback rows starting at history row `start`
	 * — see `PlainBridge.terminalScrollback`'s doc comment. */
	scrollback(start: number, count: number): Promise<TerminalScrollbackResult>;
	/** `immediate: true` waits for full teardown before resolving. */
	kill(immediate: boolean): Promise<void>;
	/** Stops listening to this session's events. Does not kill the session —
	 * call `kill` first if that is also wanted. Safe to call more than
	 * once. */
	dispose(): void;
}

/**
 * Opens one terminal session and wires its push-delivered render-state
 * frames/exit events to `handlers` — the push-stream analogue of
 * `text-search-stream.ts`'s `runTextSearchStream`. Unlike that poll/cursor
 * protocol, there is no "re-fetch": every `plain://terminal-data` delivery
 * for this session is itself the next authoritative frame.
 *
 * # Listening before the session id is known
 *
 * `terminalWatchData`/`terminalWatchExit` are all-sessions-in-one-window
 * listeners (mirroring `workspaceSearchTextWatch`'s own shape) that this
 * function subscribes to *before* awaiting `terminalStart`, precisely
 * because a spawned shell can produce output before that call's promise
 * settles; events observed before the session id is known are buffered and
 * replayed (filtered to this session) the instant it becomes known, rather
 * than risking losing a real frame to that race.
 *
 * # Ordering, dedupe, and the exit/data race
 *
 * A single session's frame delivery is already strictly ordered by the Rust
 * side (`terminal::service`'s vt thread is the sole emitter — see that
 * module's doc), so this layer's `sequence` tracking exists only as a
 * defensive backstop against a transport-level exact duplicate, not to
 * reorder anything; a genuine gap (a frame this stream never received)
 * cannot be recovered from here — the same "cannot invent missing data"
 * limit `search`'s poll/cursor protocol has for a lost wake, via a
 * different mechanism.
 *
 * `onExit` fires the moment `plain://terminal-exit` arrives for this
 * session, but that does **not** mean no further `onFrame` will fire — the
 * Rust side's exit-reporting thread is not synchronized with the vt thread
 * having drained and emitted every frame the reader ever produced (see
 * `terminal::service`'s module doc for the exact race). Callers must not
 * treat "exited" as license to stop reading; call `dispose()` once truly
 * done with the session.
 */
/**
 * Builds the returned `TerminalStream` handle's method surface for
 * `sessionId` — shared by `openTerminalStream` (session created by *this*
 * call, via `terminalStart`) and `attachTerminalStream` (`F100` S4: session
 * already exists, created by Rust's own `runInTerminal` reverse-request
 * handling — see that function's own doc comment), so the two only differ in
 * *how* they come to have a `sessionId` and how they wire up delivery, never
 * in what a caller can subsequently do with the resulting handle.
 */
function buildStreamHandle(
	transport: Omit<TerminalStreamTransport, "terminalStart">,
	sessionId: string,
	unlistenData: () => void,
	unlistenExit: () => void,
	disposedRef: { value: boolean },
): TerminalStream {
	return {
		sessionId,
		async writeText(text) {
			if (disposedRef.value) {
				return;
			}
			await transport.terminalInputText(sessionId, text);
		},
		async writeKey(action, key, mods, utf8) {
			if (disposedRef.value) {
				return;
			}
			await transport.terminalInputKey(sessionId, action, key, mods, utf8);
		},
		async focus(focused) {
			if (disposedRef.value) {
				return;
			}
			await transport.terminalFocus(sessionId, focused);
		},
		async resize(cols, rows) {
			if (disposedRef.value) {
				return;
			}
			await transport.terminalResize(sessionId, cols, rows);
		},
		async ack(sequence) {
			if (disposedRef.value) {
				return;
			}
			await transport.terminalAck(sessionId, sequence);
		},
		async scrollback(start, count) {
			return transport.terminalScrollback(sessionId, start, count);
		},
		async kill(immediate) {
			await transport.terminalKill(sessionId, immediate);
		},
		dispose() {
			if (disposedRef.value) {
				return;
			}
			disposedRef.value = true;
			unlistenData();
			unlistenExit();
		},
	};
}

export async function openTerminalStream(
	transport: TerminalStreamTransport,
	request: TerminalStreamStartRequest,
	handlers: TerminalStreamHandlers,
): Promise<TerminalStream> {
	let sessionId: string | undefined;
	let nextExpectedSequence = 0;
	const disposedRef = { value: false };
	const pendingData: TerminalDataEvent[] = [];
	const pendingExit: TerminalExitEvent[] = [];

	function deliverData(event: TerminalDataEvent): void {
		if (event.sequence < nextExpectedSequence) {
			// Exact duplicate (or older) — already delivered, ignore.
			return;
		}
		nextExpectedSequence = event.sequence + 1;
		handlers.onFrame(event.frame, event.sequence);
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
			request.rootId,
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

	return buildStreamHandle(
		transport,
		sessionId,
		unlistenData,
		unlistenExit,
		disposedRef,
	);
}

/**
 * `F100` S4: attaches to a terminal session that **already exists** —
 * created not by this call (there is no `terminalStart` here at all) but by
 * Rust's own `runInTerminal` reverse-request handling
 * (`debug::commands::handle_run_in_terminal_reverse_request`, via
 * `TerminalService::start_program`), which has already emitted a
 * `"plain/runInTerminal"` notification (see
 * `plain-debug-terminal-integration.ts`) carrying the real `sessionId` this
 * function is handed. The listeners can therefore filter on `sessionId` from
 * the instant this function begins. There is still one earlier-frame race:
 * the process may have emitted a frame before the frontend learned the id,
 * leaving Rust's one-frame gate waiting for an ack no future listener can
 * produce. After installing both listeners, this function deliberately acks
 * through `Number.MAX_SAFE_INTEGER`; the pane immediately resizes after this
 * await, and resize forces a full redraw of the current VT state. If a frame
 * arrived after listener installation, the high-water ack merely duplicates
 * the renderer's ordinary ack and remains harmless. Never calls
 * `terminalStart`: `transport` intentionally excludes it (the type omits that
 * one method) so a caller cannot accidentally spawn a *second*, unrelated
 * session while believing it is attaching to the first — the whole point of
 * "复用既有 TerminalService" is exactly one spawn, ever, per `runInTerminal`
 * reverse request.
 */
export async function attachTerminalStream(
	transport: Omit<TerminalStreamTransport, "terminalStart">,
	sessionId: string,
	handlers: TerminalStreamHandlers,
): Promise<TerminalStream> {
	let nextExpectedSequence = 0;
	const disposedRef = { value: false };

	function deliverData(event: TerminalDataEvent): void {
		if (event.sequence < nextExpectedSequence) {
			return;
		}
		nextExpectedSequence = event.sequence + 1;
		handlers.onFrame(event.frame, event.sequence);
	}

	const unlistenData = transport.terminalWatchData((event) => {
		if (event.sessionId === sessionId) {
			deliverData(event);
		}
	});
	const unlistenExit = transport.terminalWatchExit((event) => {
		if (event.sessionId === sessionId) {
			handlers.onExit(event.exitCode);
		}
	});

	const stream = buildStreamHandle(
		transport,
		sessionId,
		unlistenData,
		unlistenExit,
		disposedRef,
	);
	try {
		await stream.ack(Number.MAX_SAFE_INTEGER);
	} catch (error) {
		stream.dispose();
		throw error;
	}
	return stream;
}
