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
 * `null` outright; a real `terminated`/`exited` DAP event is forwarded to
 * listeners like any other but does *not* itself clear `state` (the adapter
 * may still reply to a `disconnect` afterward) — mirroring the Rust side's
 * own "two independent 'the session is over' signals" design.
 */

import type {
	DebugAdapterTarget,
	DebugBreakpointRequest,
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
	readonly capabilities: Readonly<Record<string, unknown>>;
	/** The thread a real `stopped` event most recently named, or `null` if
	 * the debuggee is currently running (or has not stopped yet). */
	readonly stoppedThreadId: number | null;
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
		if (this.#state === null || event.sessionId !== this.#state.sessionId) {
			return;
		}
		for (const listener of this.#eventListeners) {
			listener(event);
		}
		if (event.event === "stopped") {
			this.#setState({
				...this.#state,
				stoppedThreadId: threadIdFromStoppedBody(event.body),
			});
			return;
		}
		if (event.event === "continued") {
			this.#setState({ ...this.#state, stoppedThreadId: null });
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
	async #pushBreakpointsForPath(path: string): Promise<void> {
		if (this.#state === null) {
			return;
		}
		const sessionId = this.#state.sessionId;
		const descriptors = this.#breakpoints.descriptorsForPath(path);
		const requestEntries: DebugBreakpointRequest[] = descriptors.map(
			(descriptor) => ({
				line: descriptor.line,
				condition: descriptor.condition,
				logMessage: descriptor.logMessage,
			}),
		);
		let result: DebugSetBreakpointsResult;
		try {
			result = await this.#bridge.debugSetBreakpoints(
				sessionId,
				path,
				requestEntries,
			);
		} catch {
			// A transient failure (e.g. the session just ended) leaves
			// whatever verification was already recorded untouched rather
			// than guessing at a new one.
			return;
		}
		if (this.#state === null || this.#state.sessionId !== sessionId) {
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
		this.#breakpoints.setVerification(path, verifications);
	}

	async #pushEveryPath(): Promise<void> {
		await Promise.all(
			this.#breakpoints
				.pathsWithBreakpoints()
				.map((path) => this.#pushBreakpointsForPath(path)),
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
		this.#unwatchBreakpoints ??= this.#breakpoints.onDidChange((path, kind) => {
			if (kind === "breakpoints" && this.#state !== null) {
				void this.#pushBreakpointsForPath(path);
			}
		});
	}

	async start(
		kind: "launch" | "attach",
		target: DebugAdapterTarget,
		adapterId: string,
		launchArguments: Readonly<Record<string, unknown>>,
	): Promise<DebugSessionState> {
		this.#ensureWatching();
		const result =
			kind === "launch"
				? await this.#bridge.debugLaunch(target, adapterId, launchArguments)
				: await this.#bridge.debugAttach(target, adapterId, launchArguments);
		const started: DebugSessionState = {
			sessionId: result.sessionId,
			capabilities: result.capabilities,
			stoppedThreadId: null,
		};
		this.#setState(started);
		await this.#pushEveryPath();
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

	dispose(): void {
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
