/**
 * `F100` S1 first-run debug adapter confirmation state machine — deliberately
 * extracted into its own DOM/service-free module, mirroring
 * `plain-terminal-trust.ts`'s own "small structural interfaces, no DOM, no
 * real Workbench service instance" testability discipline (see that file's
 * module doc comment) for this codebase's *third* confirm-before-native-
 * execution flow (workspace trust and git discard/network/stash are the
 * other three-ish; this one differs from all of them in shape — see below).
 *
 * `resolveDebugAdapterConfirmation` is the **only** place in `app/` that may
 * ever call `PlainBridge.debugAdapterConfirmationState`/
 * `debugAdapterConfirmationGrant` — `plain-debug-adapter-launch.ts`'s
 * `prepareDebugAdapterLaunch` is this module's sole production caller
 * (`scripts/plain/boundary-contracts.mjs`'s `validateDebugAdapterConfirmationBoundary`
 * mechanically locks both facts). This function never itself spawns a
 * process or opens a network connection — like every other confirmation
 * module in this codebase, its entire job is deciding *whether* the caller
 * may proceed; the caller (a later slice's real launch command, once S2
 * lands it) is the only thing that ever touches `Command`/`TcpStream`.
 *
 * # Why this one has a "skip the dialog" branch and discard/network do not
 *
 * `resolveDiscardConfirmation`/`resolveNetworkConfirmation` always show their
 * dialog for a non-empty request (ADR 0003's "所有破坏性动作在显示目标/影响后
 * 确认" — every fetch/pull/push/discard is itself the destructive action,
 * with no persisted "already confirmed, skip it" state). This module is
 * different by design: ADR 0003 calls for *first-run* confirmation of a
 * `(command, args, transport)` triple, mirroring
 * `plain-terminal-trust.ts`'s `resolveTerminalTrust` shape instead — query
 * Rust's persisted decision first (`debugAdapterConfirmationState`), and only
 * show the dialog when it reports `confirmed: false`. There is, however,
 * still **no branch that skips the dialog for an unconfirmed triple** — the
 * only way past an unconfirmed triple is a real, user-answered `confirm()`
 * call.
 */

/** Structural subset of `PlainBridge` this module needs. */
export interface DebugAdapterConfirmBridge {
	debugAdapterConfirmationState(
		descriptor: DebugAdapterConfirmationSubject,
	): Promise<{ readonly confirmed: boolean }>;
	debugAdapterConfirmationGrant(
		descriptor: DebugAdapterConfirmationSubject,
	): Promise<void>;
}

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance. */
export interface DebugAdapterConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** The exact "主导会话裁定" item 2 identity: `(command, args, transport)`,
 * verbatim — deliberately excludes `host`/`port` (see
 * `src-tauri/src/debug/dto.rs`'s `TcpConnectDescriptor` doc comment for why),
 * matching the wire shape the three `debug_adapter_confirmation_*` Tauri
 * commands accept. */
export interface DebugAdapterConfirmationSubject {
	readonly command: string;
	readonly args: readonly string[];
	readonly transport: "stdio" | "tcp";
}

/** Everything the confirmation dialog needs to show — acceptance criterion 4
 * / ADR 0003's confirmation requirement is only meaningful if the user can
 * actually see what is about to run: the full literal command line, and
 * where that command line came from (`.plain/debug-adapters.json`, or an
 * inline `.vscode/launch.json` `plainAdapter` override). */
export interface DebugAdapterConfirmationRequest {
	readonly subject: DebugAdapterConfirmationSubject;
	readonly configSource: string;
}

function quoteArgIfNeeded(arg: string): string {
	return /\s/.test(arg) ? `"${arg}"` : arg;
}

/** Renders the exact literal command line the confirmation dialog shows —
 * `command` followed by each `args` element, quoting only the elements that
 * actually contain whitespace (matching a human's mental model of "what
 * would I have typed at a shell", without implying any of this is ever
 * actually interpreted by a shell — `src-tauri/src/debug/exec.rs` never uses
 * one). */
export function debugAdapterCommandLine(
	subject: DebugAdapterConfirmationSubject,
): string {
	return [subject.command, ...subject.args.map(quoteArgIfNeeded)].join(" ");
}

export function debugAdapterConfirmationMessage(
	request: DebugAdapterConfirmationRequest,
): string {
	return `Run "${request.subject.command}"?`;
}

/** Acceptance criterion 4 / ADR 0003's "首次执行确认": states the full literal
 * command line and its configuration source, so the user can judge whether
 * to trust it — the frozen research doc's own example copy
 * ("即将运行：… ——配置来自 …——允许？") made concrete. */
export function debugAdapterConfirmationDetail(
	request: DebugAdapterConfirmationRequest,
): string {
	const transportLabel = request.subject.transport === "tcp" ? "TCP" : "stdio";
	return `About to run:\n${debugAdapterCommandLine(request.subject)}\n\nTransport: ${transportLabel}\nConfiguration source: ${request.configSource}\n\nThis workspace has been granted execution trust, but running this exact command has not been confirmed before. Only continue if you trust this configuration.`;
}

export const DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON = "Run Adapter";

/** The three outcomes `resolveDebugAdapterConfirmation` can reach:
 * `"already-confirmed"` (a prior grant exists for this exact triple — the
 * dialog is never shown), `"confirmed"` (the dialog was shown and the user
 * accepted, and the grant has been persisted), `"declined"` (the dialog was
 * shown and the user dismissed it — no grant is persisted). Callers must
 * only proceed to actually running the adapter on `"already-confirmed"` or
 * `"confirmed"`. */
export type DebugAdapterConfirmDecision =
	| Readonly<{ kind: "already-confirmed" }>
	| Readonly<{ kind: "confirmed" }>
	| Readonly<{ kind: "declined" }>;

/**
 * Never spawns a process or opens a connection itself — this function's
 * entire job is deciding whether the caller may. Queries the persisted
 * decision first; for an unconfirmed triple, **always** shows the dialog —
 * there is no branch that skips it and treats the triple as confirmed
 * anyway.
 */
export async function resolveDebugAdapterConfirmation(
	bridge: DebugAdapterConfirmBridge,
	dialogService: DebugAdapterConfirmDialogService,
	request: DebugAdapterConfirmationRequest,
): Promise<DebugAdapterConfirmDecision> {
	const state = await bridge.debugAdapterConfirmationState(request.subject);
	if (state.confirmed) {
		return Object.freeze({ kind: "already-confirmed" });
	}
	const confirmation = await dialogService.confirm({
		message: debugAdapterConfirmationMessage(request),
		detail: debugAdapterConfirmationDetail(request),
		primaryButton: DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON,
	});
	if (!confirmation.confirmed) {
		return Object.freeze({ kind: "declined" });
	}
	await bridge.debugAdapterConfirmationGrant(request.subject);
	return Object.freeze({ kind: "confirmed" });
}
