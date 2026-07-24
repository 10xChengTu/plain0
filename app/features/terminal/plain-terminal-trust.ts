/**
 * Terminal trust UX state machine (F070 "WebView DOM 渲染 + trust UX").
 * Deliberately DOM/service-free at the type level — like
 * `plain-terminal-input.ts`, this takes small structural interfaces a real
 * `PlainBridge`/`IDialogService` satisfy, but a plain fake object satisfies
 * just as well, so this module's unit tests never need a DOM or a real
 * Workbench service instance (see `vitest.config.ts`: Node-only, no jsdom).
 *
 * `PlainTerminalView.startSession` is this module's only real caller: before
 * ever calling `terminalStart`, it must resolve one of four outcomes —
 *
 * - `"empty-workspace"`: no folder is open at all. `workspace_trust_state`
 *   itself would happily report `{ trusted: false }` for this case too (per
 *   `src-tauri/src/trust/commands.rs`'s own doc), but silently offering "grant
 *   trust?" for a workspace with nothing to run code *against* is actively
 *   misleading — the fix is "open a folder", not "trust this workspace", so
 *   this case gets its own message and never reaches `workspaceTrustGrant`
 *   (which itself rejects with `TRUST_UNAVAILABLE` for `EMPTY`, confirming
 *   this module's own is-empty check, not just Rust's).
 * - `"trusted"`: already granted in a previous session — proceed straight to
 *   `terminalStart`, no dialog at all.
 * - `"granted"`: the user just confirmed the risk dialog and
 *   `workspaceTrustGrant` succeeded.
 * - `"declined"`: the user dismissed/cancelled the risk dialog — the caller
 *   must not start a session and should render a disabled explanation
 *   instead (see `PlainTerminalView`'s own "declined" branch).
 */

/** Structural subset of `PlainBridge` this module needs. */
export interface TerminalTrustBridge {
	workspaceTrustState(): Promise<{ readonly trusted: boolean }>;
	workspaceTrustGrant(): Promise<{ readonly trusted: boolean }>;
}

export interface TerminalTrustConfirmation {
	readonly confirmed: boolean;
}

/** Structural subset of `IDialogService` this module needs. */
export interface TerminalTrustDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<TerminalTrustConfirmation>;
	info(message: string, detail?: string): Promise<void>;
}

export const TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE =
	"Plain needs an open folder before it can start a terminal.";
export const TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL =
	"Open a folder, then try again.";

export const TERMINAL_TRUST_CONFIRM_MESSAGE =
	"Trust this workspace to run a terminal?";
export const TERMINAL_TRUST_CONFIRM_DETAIL =
	"Plain will allow starting shell processes (and anything they in turn run) in this workspace. Only continue if you trust the code and configuration here.";
export const TERMINAL_TRUST_CONFIRM_PRIMARY_BUTTON = "Trust & Continue";

/** The user-facing explanation `PlainTerminalView` shows in place of a
 * terminal grid for each non-`"trusted"`/`"granted"` outcome. Exported so
 * both the view and its tests reference the exact same copy. */
export const TERMINAL_TRUST_DECLINED_STATUS_MESSAGE =
	"Terminal is disabled until you trust this workspace.";
export const TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE =
	"Open a folder to use the terminal.";

export type TerminalTrustDecision =
	| Readonly<{ kind: "empty-workspace" }>
	| Readonly<{ kind: "trusted" }>
	| Readonly<{ kind: "granted" }>
	| Readonly<{ kind: "declined" }>;

/**
 * Resolves whether a terminal session may start, prompting for execution
 * trust exactly when needed (never for an already-trusted workspace, never
 * by silently granting it). `isEmptyWorkspace` is supplied by the caller
 * (from `IWorkspaceContextService`) rather than inferred from
 * `workspaceTrustState()`'s own `false` — see the module doc for why the two
 * cases need different copy even though Rust reports the same boolean for
 * both.
 */
export async function resolveTerminalTrust(
	bridge: TerminalTrustBridge,
	dialogService: TerminalTrustDialogService,
	isEmptyWorkspace: boolean,
): Promise<TerminalTrustDecision> {
	if (isEmptyWorkspace) {
		await dialogService.info(
			TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE,
			TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL,
		);
		return Object.freeze({ kind: "empty-workspace" });
	}
	const state = await bridge.workspaceTrustState();
	if (state.trusted) {
		return Object.freeze({ kind: "trusted" });
	}
	const confirmation = await dialogService.confirm({
		message: TERMINAL_TRUST_CONFIRM_MESSAGE,
		detail: TERMINAL_TRUST_CONFIRM_DETAIL,
		primaryButton: TERMINAL_TRUST_CONFIRM_PRIMARY_BUTTON,
	});
	if (!confirmation.confirmed) {
		return Object.freeze({ kind: "declined" });
	}
	await bridge.workspaceTrustGrant();
	return Object.freeze({ kind: "granted" });
}
