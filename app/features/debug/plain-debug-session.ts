/**
 * `F100` S3 — the real session controller: the first production consumer of
 * `debug_launch`/`debug_attach`/`debug_disconnect` (`F100` S2's own report
 * disclosed these had zero frontend callers) plus this slice's own
 * interactive commands (`debug_set_breakpoints`/`debug_stack_trace`/
 * `debug_scopes`/`debug_variables`/`debug_evaluate`). Deliberately DOM-free
 * and Workbench-service-free — same testability discipline as
 * `plain-debug-adapter-confirmation.ts`/`plain-git-blame.ts`'s own
 * controller classes — so its event-filtering and state-transition logic is
 * unit-testable against a plain fake bridge.
 *
 * # Why breakpoints always go through this controller, never `debugLaunch`'s
 * own `initialBreakpoints` field
 *
 * `DebugSetBreakpointsRequest`'s own doc comment (`src-tauri/src/debug/dto.rs`)
 * already recorded this decision: every breakpoint, whether placed before or
 * after a session starts, is synced through `debugSetBreakpoints` — never
 * through `debug_launch`/`debug_attach`'s own `initialBreakpoints` field
 * (which this controller's `start` always sends as empty). `start` pushes
 * every currently-placed breakpoint (across every file) immediately after
 * the session becomes ready, and this controller keeps pushing further
 * changes for as long as the session stays alive — see `#watchBreakpoints`.
 *
 * # `stopped` drives the call stack; `plain/sessionEnded` clears everything
 *
 * `state.stoppedThreadId` becomes non-`null` the instant a real `stopped`
 * event names a thread, and `null` again on `continued` — the call-stack
 * view's own "re-fetch on stop" wiring reacts to this transition, not to a
 * raw event stream itself. `plain/sessionEnded` (Plain's own synthetic
 * "transport died" signal — never a real DAP event name, see
 * `src-tauri/src/debug/session.rs`'s module doc) tears down `state` to
 * `null` outright. A real `terminated` DAP event is first forwarded to
 * listeners, then completes the client half of the protocol by calling the
 * same `disconnect()` path as the user-facing Stop command. This matters for
 * adapters such as debugpy, which stay alive after the debuggee exits so they
 * can still answer `disconnect`; waiting for transport EOF in that state
 * would leave the UI saying "Running…" and the adapter process resident
 * forever. `exited` remains informational because DAP adapters may send it
 * before their final `terminated` event.
 */

import type {
	DebugAdapterTarget,
	DebugBreakpointRequest,
	DebugContinueResult,
	DebugEvaluateContext,
	DebugEvaluateResult,
	DebugEventPayload,
	DebugScopesResult,
	DebugSetBreakpointsResult,
	DebugStackTraceResult,
	DebugVariablesFilter,
	DebugVariablesResult,
	PlainBridge,
	Unlisten,
} from "../../platform/tauri/contracts";
import type {
	DebugBreakpointStore,
	DebugBreakpointVerification,
} from "./plain-debug-breakpoints";

/** The narrow slice of `PlainBridge` this controller actually calls — lets
 * tests supply a minimal fake, mirroring `terminal-stream.ts`'s own
 * `TerminalStreamTransport`. */
export type DebugSessionBridge = Pick<
	PlainBridge,
	| "debugLaunch"
	| "debugAttach"
	| "debugDisconnect"
	| "debugSetBreakpoints"
	| "debugStackTrace"
	| "debugScopes"
	| "debugVariables"
	| "debugEvaluate"
	| "debugContinue"
	| "debugNext"
	| "debugStepIn"
	| "debugStepOut"
	| "debugPause"
	| "debugWatchEvent"
>;

/** Reserved event name for Plain's own inferred "the session's transport
 * died" signal — mirrors `src-tauri/src/debug/session.rs`'s
 * `SESSION_ENDED_EVENT_NAME` constant exactly (kept as a literal here rather
 * than importing a Rust constant, since this is the one wire-level string
 * both sides must independently agree on, like every other DAP event name). */
export const SESSION_ENDED_EVENT_NAME = "plain/sessionEnded";

export interface DebugSessionState {
	readonly sessionId: string;
	readonly rootId: string;
	readonly capabilities: Readonly<Record<string, unknown>>;
	/** The thread a real `stopped` event most recently named, or `null` if
	 * the debuggee is currently running (or has not stopped yet). */
	readonly stoppedThreadId: number | null;
	/** `F100` S4: the most recent thread id *any* `stopped` (or `thread`,
	 * `reason: "started"`) event has named — unlike `stoppedThreadId`, this is
	 * **not** cleared on `continued`; it only ever changes to a newer real
	 * thread id or resets to `null` when the session itself restarts/ends.
	 * The step-control toolbar (`plain-debug-call-stack-view.ts`) uses this,
	 * not `stoppedThreadId`, as `pause`'s own target thread — `pause` is only
	 * ever meaningful while the debuggee is *running* (when `stoppedThreadId`
	 * is already `null`), so `stoppedThreadId` alone cannot answer "which
	 * thread should a pause request target". */
	readonly lastKnownThreadId: number | null;
}

export type DebugSessionChangeListener = (
	state: DebugSessionState | null,
) => void;
export type DebugSessionEventListener = (event: DebugEventPayload) => void;

function threadIdFromStoppedBody(body: unknown): number | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return null;
	}
	const threadId = (body as Record<string, unknown>).threadId;
	return typeof threadId === "number" && Number.isSafeInteger(threadId)
		? threadId
		: null;
}

export class DebugSessionController {
	readonly #bridge: DebugSessionBridge;
	readonly #breakpoints: DebugBreakpointStore;
	readonly #stateListeners = new Set<DebugSessionChangeListener>();
	readonly #eventListeners = new Set<DebugSessionEventListener>();
	#state: DebugSessionState | null = null;
	#pendingStartEvents: DebugEventPayload[] | undefined;
	#unwatch: Unlisten | undefined;
	#unwatchBreakpoints: { dispose(): void } | undefined;

	constructor(bridge: DebugSessionBridge, breakpoints: DebugBreakpointStore) {
		this.#bridge = bridge;
		this.#breakpoints = breakpoints;
	}

	get state(): DebugSessionState | null {
		return this.#state;
	}

	onDidChangeState(listener: DebugSessionChangeListener): { dispose(): void } {
		this.#stateListeners.add(listener);
		return {
			dispose: () => {
				this.#stateListeners.delete(listener);
			},
		};
	}

	/** Every event for the *current* session — a listener added before any
	 * session exists simply never fires until one does; this controller
	 * never buffers events for a session that has already ended. */
	onEvent(listener: DebugSessionEventListener): { dispose(): void } {
		this.#eventListeners.add(listener);
		return {
			dispose: () => {
				this.#eventListeners.delete(listener);
			},
		};
	}

	#setState(state: DebugSessionState | null): void {
		this.#state = state;
		for (const listener of this.#stateListeners) {
			listener(state);
		}
	}

	#handleEvent(event: DebugEventPayload): void {
		if (this.#state === null) {
			// A real adapter may emit events before the launch/attach request has
			// returned its session id. debugpy's runInTerminal reverse request does
			// exactly that during launch configuration. Keep this bounded startup
			// window and replay only the events matching the returned session below.
			if (this.#pendingStartEvents !== undefined) {
				if (this.#pendingStartEvents.length === 256) {
					this.#pendingStartEvents.shift();
				}
				this.#pendingStartEvents.push(event);
			}
			return;
		}
		if (event.sessionId !== this.#state.sessionId) {
			return;
		}
		for (const listener of this.#eventListeners) {
			listener(event);
		}
		if (event.event === "stopped") {
			const threadId = threadIdFromStoppedBody(event.body);
			this.#setState({
				...this.#state,
				stoppedThreadId: threadId,
				lastKnownThreadId: threadId ?? this.#state.lastKnownThreadId,
			});
			return;
		}
		if (event.event === "continued") {
			this.#setState({ ...this.#state, stoppedThreadId: null });
			return;
		}
		if (event.event === "thread") {
			// A real `started` thread event is the only other place a valid
			// thread id can become known before the debuggee has ever actually
			// stopped once — this domain does not otherwise track the full
			// thread list (no `threads` request is implemented), but grabbing
			// this one field from an event we already forward regardless costs
			// nothing and gives `pause` a real target sooner.
			const threadId = threadIdFromStoppedBody(event.body);
			if (threadId !== null) {
				this.#setState({ ...this.#state, lastKnownThreadId: threadId });
			}
			return;
		}
		if (event.event === "terminated") {
			// `disconnect()` clears state synchronously before awaiting the bridge,
			// so duplicate/late events for this session are ignored immediately.
			// The backend request itself is best-effort here: the debuggee has
			// already terminated, and a transport race must not recreate an active
			// UI state or surface an unhandled promise rejection.
			void this.disconnect().catch(() => {});
			return;
		}
		if (event.event === SESSION_ENDED_EVENT_NAME) {
			this.#setState(null);
			this.#breakpoints.clearAllVerification();
		}
	}

	/** Pushes every currently-placed breakpoint for `path` to the live
	 * session and records whatever the adapter reports — the single path
	 * both {@link start} (every path, once) and the live breakpoint-change
	 * subscription (one path at a time, as the user edits) funnel through. */
	async #pushBreakpointsForPath(rootId: string, path: string): Promise<void> {
		if (this.#state === null || this.#state.rootId !== rootId) {
			return;
		}
		const sessionId = this.#state.sessionId;
		const descriptors = this.#breakpoints.descriptorsForPath(rootId, path);
		const requestEntries: DebugBreakpointRequest[] = descriptors.map(
			(descriptor) => ({
				line: descriptor.line,
				condition: descriptor.condition,
				logMessage: descriptor.logMessage,
				hitCondition: descriptor.hitCondition,
			}),
		);
		let result: DebugSetBreakpointsResult;
		try {
			result = await this.#bridge.debugSetBreakpoints(
				sessionId,
				rootId,
				path,
				requestEntries,
			);
		} catch {
			// A transient failure (e.g. the session just ended) leaves
			// whatever verification was already recorded untouched rather
			// than guessing at a new one.
			return;
		}
		if (
			this.#state === null ||
			this.#state.sessionId !== sessionId ||
			this.#state.rootId !== rootId
		) {
			// The session moved on while the request was in flight.
			return;
		}
		const verifications: DebugBreakpointVerification[] = result.breakpoints.map(
			(entry) => ({
				verified: entry.verified,
				actualLine: entry.line,
				message: entry.message,
			}),
		);
		this.#breakpoints.setVerification(rootId, path, verifications);
	}

	async #pushEveryPath(rootId: string): Promise<void> {
		await Promise.all(
			this.#breakpoints
				.pathsWithBreakpoints(rootId)
				.map((path) => this.#pushBreakpointsForPath(rootId, path)),
		);
	}

	/** Starts watching `PlainBridge.debugWatchEvent` (idempotent — a second
	 * `start` call while already watching is a no-op) and, independently,
	 * watching the breakpoint store so any further edit while a session is
	 * live is immediately re-synced. */
	#ensureWatching(): void {
		this.#unwatch ??= this.#bridge.debugWatchEvent((event) => {
			this.#handleEvent(event);
		});
		// Deliberately filters to `"breakpoints"` only — see
		// `DebugBreakpointChangeKind`'s own doc comment for why reacting to
		// `"verification"` too would recurse forever (this controller's own
		// `setVerification` call, made *because* it just synced, would
		// otherwise be mistaken for a fresh reason to sync again).
		this.#unwatchBreakpoints ??= this.#breakpoints.onDidChange(
			(rootId, path, kind) => {
				if (
					kind === "breakpoints" &&
					this.#state !== null &&
					this.#state.rootId === rootId
				) {
					void this.#pushBreakpointsForPath(rootId, path);
				}
			},
		);
	}

	async start(
		rootId: string,
		kind: "launch" | "attach",
		target: DebugAdapterTarget,
		adapterId: string,
		launchArguments: Readonly<Record<string, unknown>>,
	): Promise<DebugSessionState> {
		this.#ensureWatching();
		this.#pendingStartEvents = [];
		let result: Awaited<ReturnType<DebugSessionBridge["debugLaunch"]>>;
		try {
			result =
				kind === "launch"
					? await this.#bridge.debugLaunch(
							rootId,
							target,
							adapterId,
							launchArguments,
						)
					: await this.#bridge.debugAttach(
							rootId,
							target,
							adapterId,
							launchArguments,
						);
		} catch (error) {
			this.#pendingStartEvents = undefined;
			throw error;
		}
		const pendingStartEvents = this.#pendingStartEvents;
		this.#pendingStartEvents = undefined;
		const started: DebugSessionState = {
			sessionId: result.sessionId,
			rootId,
			capabilities: result.capabilities,
			stoppedThreadId: null,
			lastKnownThreadId: null,
		};
		this.#setState(started);
		for (const event of pendingStartEvents) {
			this.#handleEvent(event);
		}
		await this.#pushEveryPath(rootId);
		return started;
	}

	async disconnect(): Promise<void> {
		if (this.#state === null) {
			return;
		}
		const sessionId = this.#state.sessionId;
		this.#setState(null);
		this.#breakpoints.clearAllVerification();
		await this.#bridge.debugDisconnect(sessionId);
	}

	async stackTrace(
		threadId: number,
		startFrame: number | null,
		levels: number | null,
	): Promise<DebugStackTraceResult | undefined> {
		if (this.#state === null) {
			return undefined;
		}
		return this.#bridge.debugStackTrace(
			this.#state.sessionId,
			threadId,
			startFrame,
			levels,
		);
	}

	async scopes(frameId: number): Promise<DebugScopesResult | undefined> {
		if (this.#state === null) {
			return undefined;
		}
		return this.#bridge.debugScopes(this.#state.sessionId, frameId);
	}

	async variables(
		variablesReference: number,
		start: number | null,
		count: number | null,
		filter: DebugVariablesFilter | null,
	): Promise<DebugVariablesResult | undefined> {
		if (this.#state === null) {
			return undefined;
		}
		return this.#bridge.debugVariables(
			this.#state.sessionId,
			variablesReference,
			start,
			count,
			filter,
		);
	}

	async evaluate(
		expression: string,
		frameId: number | null,
		context: DebugEvaluateContext,
	): Promise<DebugEvaluateResult | undefined> {
		if (this.#state === null) {
			return undefined;
		}
		return this.#bridge.debugEvaluate(
			this.#state.sessionId,
			expression,
			frameId,
			context,
		);
	}

	/** Resumes execution of `threadId` — see `DebugContinueResult`'s own doc
	 * comment for the `allThreadsContinued` default. A no-op returning
	 * `undefined` if there is no live session (mirrors every other command
	 * method above), *not* a thrown error — the toolbar itself is expected to
	 * already gate these buttons on session/thread state via
	 * `DebugSessionState`, so this defensive `undefined` return only matters
	 * for a caller that did not check first. */
	async continue_(threadId: number): Promise<DebugContinueResult | undefined> {
		if (this.#state === null) {
			return undefined;
		}
		return this.#bridge.debugContinue(this.#state.sessionId, threadId);
	}

	/** Steps over the current line ("step over"/`next` in DAP terms). */
	async next(threadId: number): Promise<void> {
		if (this.#state === null) {
			return;
		}
		await this.#bridge.debugNext(this.#state.sessionId, threadId);
	}

	/** Steps into the current line's call ("step into"/`stepIn` in DAP
	 * terms). */
	async stepIn(threadId: number): Promise<void> {
		if (this.#state === null) {
			return;
		}
		await this.#bridge.debugStepIn(this.#state.sessionId, threadId);
	}

	/** Steps out of the current function ("step out"/`stepOut` in DAP
	 * terms). */
	async stepOut(threadId: number): Promise<void> {
		if (this.#state === null) {
			return;
		}
		await this.#bridge.debugStepOut(this.#state.sessionId, threadId);
	}

	/** Interrupts a running thread. */
	async pause(threadId: number): Promise<void> {
		if (this.#state === null) {
			return;
		}
		await this.#bridge.debugPause(this.#state.sessionId, threadId);
	}

	dispose(): void {
		this.#pendingStartEvents = undefined;
		this.#stateListeners.clear();
		this.#eventListeners.clear();
		this.#unwatchBreakpoints?.dispose();
		this.#unwatchBreakpoints = undefined;
		if (this.#unwatch !== undefined) {
			void this.#unwatch();
			this.#unwatch = undefined;
		}
	}
}
