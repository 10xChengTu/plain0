/**
 * `F100` S3 — the breakpoint store: a DOM-free, service-free model of every
 * line breakpoint the user has placed, plus whatever verification state the
 * live session (if any) most recently reported for it. Deliberately
 * extracted into its own module with no editor/Workbench dependency at all,
 * mirroring `plain-terminal-trust.ts`/`plain-debug-adapter-confirmation.ts`'s
 * own "small structural interfaces, no DOM" testability discipline — the
 * glyph-margin rendering and click handling live in
 * `plain-debug-breakpoints-contribution.ts`; this module only tracks state
 * and notifies listeners when it changes.
 *
 * # Breakpoints are keyed by the line the user set them at, not the
 * adapter-reported line
 *
 * A real adapter may move a verified breakpoint to a different line, or
 * reject one outright (`verified: false`) —
 * `docs/research/2026-07-28-generic-dap.md`'s own acceptance language calls
 * this out by name. This store keeps the user's original line as the stable
 * identity (matching where the editor's own glyph-margin click landed) and
 * records the adapter's report — `verified`/`actualLine`/`message` — as a
 * *separate* piece of state alongside it, rather than moving the breakpoint
 * to track the adapter's report. This is a disclosed simplification (real
 * VS Code visually relocates the glyph itself); the adapter's actual verdict
 * is still fully surfaced (the contribution renders it, e.g. as a hover
 * tooltip), just not by moving the glyph's line.
 */

export interface DebugBreakpointDescriptor {
	readonly line: number;
	readonly condition: string | null;
	readonly logMessage: string | null;
}

export interface DebugBreakpointVerification {
	readonly verified: boolean;
	readonly actualLine: number | null;
	readonly message: string | null;
}

/**
 * The two independent things a caller might need to react to:
 * `"breakpoints"` — the user actually changed which lines are breakpointed,
 * or a breakpoint's condition/log-message — and `"verification"` — a live
 * session merely reported back on the *existing* set (via
 * {@link DebugBreakpointStore.setVerification}/`clearVerification`/
 * `clearAllVerification`). Kept as two separate event kinds (not one) for a
 * concrete, load-bearing reason: `DebugSessionController` must re-sync with
 * the adapter exactly when the *first* kind fires, and must **not** when
 * only the second fires — `setVerification` is itself the direct result of
 * a sync the controller just performed, so treating it as *another* reason
 * to sync again would recurse forever (sync → verification recorded →
 * "changed" → sync again → …). The glyph-margin contribution, by contrast,
 * needs to redraw on *either* kind (a verification update changes a glyph's
 * rendered color/tooltip even though no line was added or removed).
 */
export type DebugBreakpointChangeKind = "breakpoints" | "verification";

export type DebugBreakpointChangeListener = (
	path: string,
	kind: DebugBreakpointChangeKind,
) => void;

/**
 * One (path, line) breakpoint's complete client-side state — what the
 * `debugSetBreakpoints` request already carries (`condition`/`logMessage`)
 * merged with whatever verification response the store has recorded for it.
 * `verification` is `null` until a live session has actually reported on
 * this exact line at least once (no session yet, or the session has not
 * been asked about this path yet) — never a default guess.
 */
export interface DebugBreakpointView {
	readonly line: number;
	readonly condition: string | null;
	readonly logMessage: string | null;
	readonly verification: DebugBreakpointVerification | null;
}

/**
 * Tracks every placed breakpoint across every open file and the most recent
 * verification report for each, notifying listeners (scoped to one `path` at
 * a time) whenever either changes. Has no bridge/session dependency of its
 * own — `plain-debug-session.ts`'s `DebugSessionController` is the only
 * thing that ever calls `setVerification` (after a real `debugSetBreakpoints`
 * round trip) or reads `descriptorsForPath` (to know what to send).
 */
export class DebugBreakpointStore {
	readonly #descriptors = new Map<
		string,
		Map<number, DebugBreakpointDescriptor>
	>();
	readonly #verification = new Map<
		string,
		Map<number, DebugBreakpointVerification>
	>();
	readonly #listeners = new Set<DebugBreakpointChangeListener>();

	onDidChange(listener: DebugBreakpointChangeListener): { dispose(): void } {
		this.#listeners.add(listener);
		return {
			dispose: () => {
				this.#listeners.delete(listener);
			},
		};
	}

	#notify(path: string, kind: DebugBreakpointChangeKind): void {
		for (const listener of this.#listeners) {
			listener(path, kind);
		}
	}

	/** Adds a plain breakpoint at `line` if none exists there yet, otherwise
	 * removes the existing one — the glyph-margin click gesture's exact
	 * behavior. Clears any prior verification for that line either way (a
	 * removed breakpoint has no verification; a newly added one has none
	 * yet). */
	toggle(path: string, line: number): void {
		const forPath = this.#descriptors.get(path);
		if (forPath?.has(line) === true) {
			forPath.delete(line);
			this.#verification.get(path)?.delete(line);
			this.#notify(path, "breakpoints");
			return;
		}
		const map = forPath ?? new Map<number, DebugBreakpointDescriptor>();
		map.set(line, { line, condition: null, logMessage: null });
		this.#descriptors.set(path, map);
		this.#verification.get(path)?.delete(line);
		this.#notify(path, "breakpoints");
	}

	remove(path: string, line: number): void {
		const forPath = this.#descriptors.get(path);
		if (forPath?.delete(line) !== true) {
			return;
		}
		this.#verification.get(path)?.delete(line);
		this.#notify(path, "breakpoints");
	}

	/** Sets (or clears, with `null`) `line`'s condition expression — always
	 * accepted regardless of whether the current session's `Capabilities`
	 * advertise `supportsConditionalBreakpoints`; the calling UI is
	 * responsible for not offering this input at all when unsupported (see
	 * `plain-debug-breakpoints-contribution.ts`'s own capability-gating
	 * doc comment). A line with no existing breakpoint is a no-op. */
	setCondition(path: string, line: number, condition: string | null): void {
		const forPath = this.#descriptors.get(path);
		const existing = forPath?.get(line);
		if (forPath === undefined || existing === undefined) {
			return;
		}
		forPath.set(line, { ...existing, condition });
		this.#notify(path, "breakpoints");
	}

	/** Same contract as {@link setCondition}, for the log-point message. */
	setLogMessage(path: string, line: number, logMessage: string | null): void {
		const forPath = this.#descriptors.get(path);
		const existing = forPath?.get(line);
		if (forPath === undefined || existing === undefined) {
			return;
		}
		forPath.set(line, { ...existing, logMessage });
		this.#notify(path, "breakpoints");
	}

	/** Sets both `condition` and `logMessage` in one atomic update — a single
	 * notification, not two. This is what the breakpoint popup's own "Save"
	 * button calls (rather than `setCondition` then `setLogMessage`
	 * separately): a real E2E run caught that calling both individually for
	 * one logical edit fired two independent `DebugSessionController`
	 * re-syncs (two real `debug_set_breakpoints` round trips for what the
	 * user experienced as a single save), which is wasteful even though
	 * harmless (DAP's own `setBreakpoints` replaces the whole set each time,
	 * so it is not *incorrect*, just redundant chatter this method avoids). */
	setDetails(
		path: string,
		line: number,
		condition: string | null,
		logMessage: string | null,
	): void {
		const forPath = this.#descriptors.get(path);
		const existing = forPath?.get(line);
		if (forPath === undefined || existing === undefined) {
			return;
		}
		forPath.set(line, { ...existing, condition, logMessage });
		this.#notify(path, "breakpoints");
	}

	descriptorsForPath(path: string): readonly DebugBreakpointDescriptor[] {
		const forPath = this.#descriptors.get(path);
		if (forPath === undefined) {
			return [];
		}
		return [...forPath.values()].sort((a, b) => a.line - b.line);
	}

	pathsWithBreakpoints(): readonly string[] {
		return [...this.#descriptors.keys()].filter(
			(path) => (this.#descriptors.get(path)?.size ?? 0) > 0,
		);
	}

	/** Records the live session's `debugSetBreakpoints` response for `path` —
	 * `results` must be in the exact same order as
	 * {@link descriptorsForPath}'s own output for that same path (the DAP
	 * `setBreakpoints` response is positionally correlated with its request,
	 * never by line number — see `DebugSetBreakpointsResult`'s own doc
	 * comment), which is exactly how `DebugSessionController.pushBreakpoints`
	 * calls this. A results array of the wrong length is ignored entirely
	 * (defensive: better to show stale verification than misattribute one
	 * breakpoint's real verdict to a different line). */
	setVerification(
		path: string,
		results: readonly DebugBreakpointVerification[],
	): void {
		const descriptors = this.descriptorsForPath(path);
		if (results.length !== descriptors.length) {
			return;
		}
		const map = this.#verification.get(path) ?? new Map();
		descriptors.forEach((descriptor, index) => {
			map.set(descriptor.line, results[index]!);
		});
		this.#verification.set(path, map);
		this.#notify(path, "verification");
	}

	/** Clears every recorded verification for `path` (but not the
	 * breakpoints themselves) — called when a session ends, since a
	 * verification report is only meaningful for the session that produced
	 * it. */
	clearVerification(path: string): void {
		if (this.#verification.delete(path)) {
			this.#notify(path, "verification");
		}
	}

	clearAllVerification(): void {
		const paths = [...this.#verification.keys()];
		this.#verification.clear();
		for (const path of paths) {
			this.#notify(path, "verification");
		}
	}

	viewsForPath(path: string): readonly DebugBreakpointView[] {
		const verification = this.#verification.get(path);
		return this.descriptorsForPath(path).map((descriptor) => ({
			...descriptor,
			verification: verification?.get(descriptor.line) ?? null,
		}));
	}
}
