/**
 * `F220` S1's SSH host-key confirmation flow — ADR 0006 §3's two-phase
 * design made concrete on the frontend. Deliberately extracted into its own
 * DOM/service-free module, mirroring `plain-debug-adapter-confirmation.ts`'s
 * own "small structural interfaces, no DOM, no real Workbench service
 * instance" testability discipline.
 *
 * `resolveRemoteSessionConnect` is the sole place in `app/` that decides
 * whether an unknown or changed host key gets a chance to be trusted: it
 * calls `bridge.remoteSessionConnect` first, and only for a
 * `"hostKeyPendingConfirmation"` result does it ever show the confirmation
 * dialog — a real, user-answered `confirm()` call, never a silent
 * auto-accept. Cancelling that dialog calls nothing further (zero pin, zero
 * session — see `RemoteSessionConnectDecision`'s own doc comment). A
 * *changed* pinned key never reaches this dialog at all: `bridge.
 * remoteSessionConnect`/`remoteHostKeyConfirm` reject with a thrown
 * `REMOTE_HOST_KEY_CHANGED` error instead (ADR 0006 §3's "无旁路"), which
 * this module deliberately does not catch — the caller (`plain-remote-ssh-commands.ts`)
 * surfaces it as an ordinary error notification, exactly like every other
 * thrown `CommandError` in this codebase.
 */

import type {
	RemoteSessionConnectResult,
	RemoteSessionEventPayload,
} from "../../platform/tauri/contracts";

/** Structural subset of `PlainBridge` this module needs. */
export interface RemoteHostKeyConfirmBridge {
	remoteSessionConnect(
		host: string,
		port: number,
		user: string,
	): Promise<RemoteSessionConnectResult>;
	remoteHostKeyConfirm(
		host: string,
		port: number,
		user: string,
		algorithm: string,
		sha256Fingerprint: string,
	): Promise<RemoteSessionConnectResult>;
}

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance, mirroring
 * `DebugAdapterConfirmDialogService`'s identical shape. */
export interface RemoteHostKeyConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** The exact pending-confirmation fields the dialog shows — re-exported here
 * (rather than importing the full `RemoteSessionConnectResult` union into
 * every call site) so `remoteHostKeyConfirmationMessage`/`…Detail` have a
 * narrow, already-discriminated input shape. */
export interface RemoteHostKeyPendingConfirmation {
	readonly algorithm: string;
	readonly sha256Fingerprint: string;
	readonly knownHostsHit: boolean;
}

export function remoteHostKeyConfirmationMessage(
	host: string,
	port: number,
): string {
	return `Connect to ${host}:${port}? This host's identity has not been seen before.`;
}

/** States the full algorithm/fingerprint so the user can judge whether to
 * trust it — ADR 0006 §3's own requirement that an unknown host's
 * confirmation dialog "展示全量指纹". `knownHostsHit` is surfaced as an
 * additional, purely informational data point (never a trust decision on its
 * own — Plain's own pinned store is what actually governs trust either
 * way). */
export function remoteHostKeyConfirmationDetail(
	host: string,
	port: number,
	pending: RemoteHostKeyPendingConfirmation,
): string {
	const knownHostsNote = pending.knownHostsHit
		? "This also matches an entry in your own ~/.ssh/known_hosts file."
		: "This host is not present in your own ~/.ssh/known_hosts file either.";
	return `Host: ${host}:${port}\nAlgorithm: ${pending.algorithm}\nFingerprint: ${pending.sha256Fingerprint}\n\n${knownHostsNote}\n\nOnly continue if you trust this fingerprint. Plain will remember this exact key and will refuse to connect silently if it ever changes.`;
}

export const REMOTE_HOST_KEY_CONFIRM_PRIMARY_BUTTON = "Connect";

/**
 * The two outcomes `resolveRemoteSessionConnect` can reach without throwing:
 * `"connected"` (either the host key was already pinned and matched, or the
 * user confirmed an unknown one and the follow-up pin-and-connect
 * succeeded), or `"declined"` (the user dismissed the confirmation dialog —
 * no pin was ever written, no session was ever created). A changed pinned
 * key, or any other connect failure (agent unavailable, timed out, …),
 * surfaces as a thrown error instead — see the module doc.
 */
export type RemoteSessionConnectDecision =
	| Readonly<{ kind: "connected"; sessionId: string }>
	| Readonly<{ kind: "declined" }>;

/**
 * Drives one full `Plain: Connect to SSH Host…` attempt for an already-
 * validated `(host, port, user)` target. Never itself pins a host key or
 * establishes a session — that is exactly what `bridge.remoteSessionConnect`/
 * `remoteHostKeyConfirm` do; this function's only job is deciding whether,
 * and with which exact confirmed fingerprint, to make the second call.
 */
export async function resolveRemoteSessionConnect(
	bridge: RemoteHostKeyConfirmBridge,
	dialogService: RemoteHostKeyConfirmDialogService,
	host: string,
	port: number,
	user: string,
): Promise<RemoteSessionConnectDecision> {
	const first = await bridge.remoteSessionConnect(host, port, user);
	if (first.status === "connected") {
		return Object.freeze({ kind: "connected", sessionId: first.sessionId });
	}
	const confirmation = await dialogService.confirm({
		message: remoteHostKeyConfirmationMessage(host, port),
		detail: remoteHostKeyConfirmationDetail(host, port, first),
		primaryButton: REMOTE_HOST_KEY_CONFIRM_PRIMARY_BUTTON,
	});
	if (!confirmation.confirmed) {
		return Object.freeze({ kind: "declined" });
	}
	// Binds the confirmation to the *exact* fingerprint just shown — ADR 0006
	// §3's "确认必须绑定这次给出的精确指纹" requirement; there is no code path
	// here that could confirm a different value than what `first` reported.
	const second = await bridge.remoteHostKeyConfirm(
		host,
		port,
		user,
		first.algorithm,
		first.sha256Fingerprint,
	);
	if (second.status !== "connected") {
		// Never actually reachable in production (see
		// `RemoteSessionConnectResult`'s own doc comment: a fresh pin
		// immediately re-validated against a fresh live handshake either
		// matches — `"connected"` — or hard-fails as a thrown
		// `REMOTE_HOST_KEY_CHANGED` error, never a second pending result) —
		// kept as a defensive `"declined"` return, not a thrown exception, so
		// a future change to that invariant fails visibly (a silent no-op)
		// rather than crashing the Workbench.
		return Object.freeze({ kind: "declined" });
	}
	return Object.freeze({ kind: "connected", sessionId: second.sessionId });
}

/** Renders a `plain://remote-session-event` delivery as one human-readable
 * notification line — the S1 "会话状态可见" minimum this feature's own
 * contract calls for (a full session-list view is deferred to a later
 * slice). `"windowClosed"` disconnects are deliberately not rendered at all:
 * the window showing the notification is itself going away, so there is
 * nothing left to show it to. Never includes a filesystem path — only the
 * connection identity (`user@host:port`), matching every other domain's own
 * "accurate, path-free" notification precedent. */
export function remoteSessionEventNotification(
	event: RemoteSessionEventPayload,
): string | undefined {
	const identity = `${event.user}@${event.host}:${event.port}`;
	if (event.event === "connected") {
		return `Plain: connected to ${identity}.`;
	}
	if (event.reason === "windowClosed") {
		return undefined;
	}
	return `Plain: disconnected from ${identity}.`;
}
