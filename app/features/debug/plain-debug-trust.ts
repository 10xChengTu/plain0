/**
 * `F100` S3 — debug workspace-execution-trust UX, mirroring
 * `plain-terminal-trust.ts`'s exact "small structural interfaces, no DOM"
 * state machine and discipline for the identical underlying gate
 * (`trust::mod`'s own module doc already named `F100`/DAP as this gate's
 * third consumer, alongside terminal and git). Kept as its own small module
 * — rather than reusing `resolveTerminalTrust` verbatim — purely so the
 * dialog copy accurately says "run a debug adapter", not "run a terminal";
 * the state machine itself is otherwise identical.
 *
 * `plain-debug-commands.ts`'s `runStartDebugging` is this module's only real
 * caller: before ever resolving/starting an adapter, it must resolve one of
 * the same four outcomes `resolveTerminalTrust` documents (`"empty-workspace"`/
 * `"trusted"`/`"granted"`/`"declined"`) — without this, a `debug_launch` call
 * against an untrusted workspace would simply throw `WORKSPACE_NOT_TRUSTED`
 * with no way for the user to grant trust from this flow at all.
 */

export interface DebugTrustBridge {
	workspaceTrustState(): Promise<{ readonly trusted: boolean }>;
	workspaceTrustGrant(): Promise<{ readonly trusted: boolean }>;
}

export interface DebugTrustConfirmation {
	readonly confirmed: boolean;
}

export interface DebugTrustDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<DebugTrustConfirmation>;
	info(message: string, detail?: string): Promise<void>;
}

export const DEBUG_TRUST_EMPTY_WORKSPACE_MESSAGE =
	"Plain needs an open folder before it can start a debug session.";
export const DEBUG_TRUST_EMPTY_WORKSPACE_DETAIL =
	"Open a folder, then try again.";

export const DEBUG_TRUST_CONFIRM_MESSAGE =
	"Trust this workspace to run a debug adapter?";
export const DEBUG_TRUST_CONFIRM_DETAIL =
	"Plain will allow starting debug adapter processes (and anything they in turn run) in this workspace. Only continue if you trust the code and configuration here.";
export const DEBUG_TRUST_CONFIRM_PRIMARY_BUTTON = "Trust & Continue";

export type DebugTrustDecision =
	| Readonly<{ kind: "empty-workspace" }>
	| Readonly<{ kind: "trusted" }>
	| Readonly<{ kind: "granted" }>
	| Readonly<{ kind: "declined" }>;

/**
 * Resolves whether a debug session may start, prompting for execution trust
 * exactly when needed — never for an already-trusted workspace, never by
 * silently granting it. `isEmptyWorkspace` is supplied by the caller (from
 * `IWorkspaceContextService`), matching `resolveTerminalTrust`'s identical
 * reasoning for why this is not inferred from `workspaceTrustState()`'s own
 * `false` alone.
 */
export async function resolveDebugTrust(
	bridge: DebugTrustBridge,
	dialogService: DebugTrustDialogService,
	isEmptyWorkspace: boolean,
): Promise<DebugTrustDecision> {
	if (isEmptyWorkspace) {
		await dialogService.info(
			DEBUG_TRUST_EMPTY_WORKSPACE_MESSAGE,
			DEBUG_TRUST_EMPTY_WORKSPACE_DETAIL,
		);
		return Object.freeze({ kind: "empty-workspace" });
	}
	const state = await bridge.workspaceTrustState();
	if (state.trusted) {
		return Object.freeze({ kind: "trusted" });
	}
	const confirmation = await dialogService.confirm({
		message: DEBUG_TRUST_CONFIRM_MESSAGE,
		detail: DEBUG_TRUST_CONFIRM_DETAIL,
		primaryButton: DEBUG_TRUST_CONFIRM_PRIMARY_BUTTON,
	});
	if (!confirmation.confirmed) {
		return Object.freeze({ kind: "declined" });
	}
	await bridge.workspaceTrustGrant();
	return Object.freeze({ kind: "granted" });
}
