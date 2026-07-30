/**
 * `F100` S3 — module-level wiring shared by the three self-built debug
 * `ViewPane`s (`plain-debug-call-stack-view.ts`/`plain-debug-variables-view.ts`/
 * `plain-debug-watch-view.ts`). Mirrors `plain-git-stash-view.ts`'s own
 * `configuredBridge`/`configurePlainGitStashBridge` module-level pattern,
 * needed for the identical reason: `debug-contribution.ts` registers each
 * view's `ctorDescriptor` at module-import time, long before `app/main.ts`
 * has a real `DebugSessionController`/`DebugBreakpointStore` to hand them —
 * and `IInstantiationService.createInstance` only ever passes a `ViewPane`
 * subclass its declared DI-decorated constructor parameters, which cannot
 * include an app-specific, not-yet-registered service token. Bundled into
 * one `PlainDebugRuntime` object (rather than three separate
 * `configurePlain*Bridge`-style functions) purely because all three views
 * need all three pieces together.
 */

import type { PlainBridge } from "../../platform/tauri/contracts";
import { DebugBreakpointStore } from "./plain-debug-breakpoints";
import { DebugSessionController } from "./plain-debug-session";

/**
 * Which stack frame the Variables view should show scopes/variables for —
 * written only by `PlainDebugCallStackView` (the frame picker), read by
 * `PlainDebugVariablesView`/`PlainDebugWatchView` (watch expressions
 * evaluate in the selected frame's lexical context). A tiny, dependency-free
 * observable rather than reusing `DebugSessionController`'s own state
 * machine: frame selection is a *view-local* UI concern (which frame is
 * highlighted), not part of the session's own DAP-level state.
 */
export class DebugFrameSelection {
	#frameId: number | null = null;
	readonly #listeners = new Set<(frameId: number | null) => void>();

	get frameId(): number | null {
		return this.#frameId;
	}

	select(frameId: number | null): void {
		this.#frameId = frameId;
		for (const listener of this.#listeners) {
			listener(frameId);
		}
	}

	onDidChange(listener: (frameId: number | null) => void): {
		dispose(): void;
	} {
		this.#listeners.add(listener);
		return {
			dispose: () => {
				this.#listeners.delete(listener);
			},
		};
	}
}

export interface PlainDebugRuntime {
	readonly session: DebugSessionController;
	readonly breakpoints: DebugBreakpointStore;
	readonly frameSelection: DebugFrameSelection;
	/** The raw bridge — `plain-debug-commands.ts`'s "Plain: Start Debugging"
	 * command needs `workspaceReadFile`/`workspaceSnapshot` too (to read
	 * `.vscode/launch.json`/`.plain/debug-adapters.json`), which
	 * `DebugSessionController`'s own narrower `DebugSessionBridge` slice does
	 * not include. */
	readonly bridge: PlainBridge;
}

let configuredRuntime: PlainDebugRuntime | undefined;

/**
 * Constructs the runtime (a fresh `DebugBreakpointStore`/`DebugFrameSelection`/
 * `DebugSessionController`, the latter wired to `bridge`) and configures it in
 * one call — `app/main.ts`'s sole entry point into this module, called
 * exactly once during bootstrap, before `initialize()`. Kept as a single
 * factory (rather than `main.ts` constructing `DebugSessionController` itself
 * and handing it to a separate `configurePlainDebugRuntime`) so `main.ts`
 * only ever passes `bridge` as call-site argument 0 to a named function —
 * `scripts/plain/boundary-contracts.mjs`'s bootstrap-bridge-usage audit and
 * `workspace-topology-contracts.mjs`'s whole-app authority analysis both
 * mechanically require every `bridge` reference in `main.ts` to match one of
 * a small, enumerated set of exactly this shape (`someNamedFunction(bridge)`),
 * the same discipline every existing `configurePlain*Bridge(bridge)` call
 * already follows.
 */
export function createAndConfigurePlainDebugRuntime(
	bridge: PlainBridge,
): PlainDebugRuntime {
	const breakpoints = new DebugBreakpointStore();
	const frameSelection = new DebugFrameSelection();
	const session = new DebugSessionController(bridge, breakpoints);
	const runtime: PlainDebugRuntime = {
		session,
		breakpoints,
		frameSelection,
		bridge,
	};
	configuredRuntime = runtime;
	return runtime;
}

export function getPlainDebugRuntime(): PlainDebugRuntime | undefined {
	return configuredRuntime;
}
