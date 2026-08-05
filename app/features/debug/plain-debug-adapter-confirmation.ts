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

/** Structural subset of `PlainBridge` this module needs. `rootId` (`F220`
 * S7) is the workspace root this launch config targets — passed through
 * opaquely; this module never inspects it, Rust alone decides whether that
 * root is local or remote (see `DebugAdapterConfirmationRequest.rootId`'s
 * own doc comment). */
export interface DebugAdapterConfirmBridge {
	debugAdapterConfirmationState(
		descriptor: DebugAdapterConfirmationSubject,
		rootId: string,
	): Promise<{ readonly confirmed: boolean }>;
	debugAdapterConfirmationGrant(
		descriptor: DebugAdapterConfirmationSubject,
		rootId: string,
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
	/** `F220` S7 — the workspace root this launch config targets. Forwarded
	 * verbatim to both `debugAdapterConfirmationState`/`Grant` calls below;
	 * this module never itself decides whether that root is local or remote
	 * (Rust resolves the remote confirmation dimension server-side — see
	 * `src-tauri/src/debug/dto.rs`'s `AdapterConfirmationSubject::remote_host_fingerprint`
	 * doc comment) — this keeps `resolveDebugAdapterConfirmation` exactly as
	 * backend-agnostic as it already is about every other root-scoped
	 * concern. */
	readonly rootId: string;
	/** `F220` S7 — `true` when `rootId` is a known remote-backed root (the
	 * caller resolves this itself, e.g. via `isKnownRemoteRootId`, purely for
	 * dialog copy — this module still never inspects `rootId`'s own value or
	 * decides local/remote itself). ADR 0003's "如实反映" principle, already
	 * applied to the spawn-then-connect case below, extended to the equally
	 * trust-relevant fact that the confirmed command is about to run on a
	 * *remote* host, not this machine. */
	readonly isRemoteRoot?: boolean;
	readonly configSource: string;
	/** `F210` S6 — `true` when this confirmation gates a spawn-then-connect
	 * (`AdapterDescriptor.transport === "tcpSpawn"`) adapter: the confirmed
	 * `subject` (still the plain `(command, args, "tcp")` triple — see
	 * `src-tauri/src/debug/exec.rs`'s `spawn_adapter_as_tcp_companion` doc
	 * comment for why it is deliberately not a fourth confirmation identity)
	 * also authorizes *spawning* `subject.command`, not merely connecting to
	 * an already-running process the way an ordinary `"tcp"` confirmation
	 * does. Only meaningful alongside `port`; both are frontend-only
	 * presentation detail this codebase's own confirmation dialog copy
	 * consults — the wire `debugAdapterConfirmationState`/`Grant` requests
	 * built from `subject` never carry either. */
	readonly spawnBeforeConnect?: boolean;
	readonly port?: number;
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

/** `F210` S6 — `true` exactly when `request` names a spawn-then-connect
 * confirmation with a `port` to show — the shared guard both
 * [`debugAdapterConfirmationMessage`] and [`debugAdapterConfirmationDetail`]
 * use so the two functions can never disagree about which branch of copy to
 * render. */
function isSpawnBeforeConnectRequest(
	request: DebugAdapterConfirmationRequest,
): request is DebugAdapterConfirmationRequest & { readonly port: number } {
	return request.spawnBeforeConnect === true && request.port !== undefined;
}

export function debugAdapterConfirmationMessage(
	request: DebugAdapterConfirmationRequest,
): string {
	if (isSpawnBeforeConnectRequest(request)) {
		return `Start "${request.subject.command}" and connect to 127.0.0.1:${request.port}?`;
	}
	return `Run "${request.subject.command}"?`;
}

/** Acceptance criterion 4 / ADR 0003's "首次执行确认": states the full literal
 * command line and its configuration source, so the user can judge whether
 * to trust it — the frozen research doc's own example copy
 * ("即将运行：… ——配置来自 …——允许？") made concrete. `F210` S6's
 * spawn-then-connect branch additionally names the fixed `127.0.0.1:<port>`
 * loopback target the spawned process is expected to open, so the dialog
 * "如实反映" (`docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §6")
 * the full "启动 <command> 并连接 127.0.0.1:<port>" semantics — not merely
 * "run this command", which alone would understate what confirming actually
 * authorizes. */
export function debugAdapterConfirmationDetail(
	request: DebugAdapterConfirmationRequest,
): string {
	const transportLabel = request.subject.transport === "tcp" ? "TCP" : "stdio";
	// `F220` S7 — a real, visible fact about *where* the confirmed command
	// runs, not merely a cosmetic label: an identical `(command, args,
	// transport)` triple confirmed for a local root never silently covers a
	// remote one (see `AdapterConfirmationSubject::remote_host_fingerprint`'s
	// own doc comment for the matching backend-side key isolation) — this
	// line is this dialog's own "如实反映" of that same distinction to the
	// user.
	const remoteNotice = request.isRemoteRoot
		? "\n\nThis command will run on the remote host for this workspace root, not on this machine."
		: "";
	if (isSpawnBeforeConnectRequest(request)) {
		return `About to run:\n${debugAdapterCommandLine(request.subject)}\n\nThen connect to 127.0.0.1:${request.port} once its TCP listener is ready.\n\nTransport: ${transportLabel} (spawned)\nConfiguration source: ${request.configSource}${remoteNotice}\n\nThis workspace has been granted execution trust, but running this exact command has not been confirmed before. Only continue if you trust this configuration.`;
	}
	return `About to run:\n${debugAdapterCommandLine(request.subject)}\n\nTransport: ${transportLabel}\nConfiguration source: ${request.configSource}${remoteNotice}\n\nThis workspace has been granted execution trust, but running this exact command has not been confirmed before. Only continue if you trust this configuration.`;
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
	const state = await bridge.debugAdapterConfirmationState(
		request.subject,
		request.rootId,
	);
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
	await bridge.debugAdapterConfirmationGrant(request.subject, request.rootId);
	return Object.freeze({ kind: "confirmed" });
}
