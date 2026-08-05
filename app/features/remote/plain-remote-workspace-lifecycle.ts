/**
 * `F220` S4's pure remote-root lifecycle logic — reconnect candidate
 * selection, the disconnect-event state transition `knownRemoteRoots`
 * undergoes, and the user-facing text for every reconnect outcome.
 * Deliberately DOM/service-free, mirroring `plain-remote-workspace-browse.ts`'s
 * own "pure item logic lives in its own file" discipline (`F220` S3) and
 * `plain-debug-configuration-pick.ts`'s "pure function + injected picker"
 * split (`F210` S1) — `plain-remote-workspace-commands.ts` is the only real
 * caller, wiring real Workbench services to the decisions made here.
 *
 * A `Plain: Reconnect Remote Session…` candidate is one of two kinds,
 * distinguished by whether a `rootId` already exists for it:
 *
 * - `"existing"`: an already-authorized remote root (via `Plain: Open Remote
 *   Folder…`, or a prior successful reconnect) whose bound SSH session has
 *   since disconnected (`RemoteSessionDisconnectReason.transportClosed`).
 *   Reconnecting it calls `remoteWorkspaceReconnectRoot(rootId, sessionId)` —
 *   the root itself never moves, only its session binding does.
 * - `"pending"`: a remote root named by the *stored* last-workspace/Recent
 *   entry that this window has never authorized at all — ADR 0007 §4's own
 *   "冷启动恢复远程 workspace 不自动连接" means cold start (and `Open Recent`)
 *   never create it automatically. Reconnecting it calls
 *   `remoteWorkspaceAddRoot(sessionId, path, label)` instead — there is no
 *   existing `rootId` to rebind.
 *
 * Both kinds share one QuickPick and one connect-then-act flow because, from
 * the user's point of view, they are the same action ("get this remote
 * folder working again"); only the one bridge call `plain-remote-workspace-commands.ts`
 * makes afterward differs.
 */

import type {
	CommandError,
	WorkspaceRecentRemoteRoot,
} from "../../platform/tauri/contracts";

/** One remote root this window has itself authorized (via `Plain: Open
 * Remote Folder…`, or reconnected). Keyed by `rootId` in `knownRemoteRoots`
 * — see that map's own doc comment in `plain-remote-workspace-commands.ts`.
 * `path` is carried only so a *cold-start-pending* candidate (which has no
 * `rootId` yet) can still be told apart, by identity, from an already-known
 * one — see `coldStartPendingRemoteRootCandidates`. */
export interface KnownRemoteRootRecord {
	readonly label: string;
	readonly sessionId: string;
	readonly host: string;
	readonly port: number;
	readonly user: string;
	readonly path: string;
	readonly disconnected: boolean;
}

export type RemoteRootReconnectCandidate =
	| Readonly<{
			kind: "existing";
			rootId: string;
			label: string;
			host: string;
			port: number;
			user: string;
	  }>
	| Readonly<{
			kind: "pending";
			path: string;
			label: string;
			host: string;
			port: number;
			user: string;
	  }>;

export interface RemoteRootReconnectPickItem {
	readonly label: string;
	readonly description: string;
	readonly candidate: RemoteRootReconnectCandidate;
}

export type RemoteRootReconnectPicker = (
	items: readonly RemoteRootReconnectPickItem[],
) => Promise<RemoteRootReconnectPickItem | undefined>;

/**
 * Resolves which remote root `Plain: Reconnect Remote Session…` reconnects.
 * Zero candidates resolves to `undefined` without ever calling `pick` (the
 * caller shows an accurate "nothing to reconnect" message instead of an
 * empty picker). Unlike `selectPlainLaunchConfiguration`'s "a sole
 * configuration is safe to use automatically" precedent, a *single*
 * candidate here still goes through the picker — reconnecting is a
 * comparatively higher-risk, explicit action (a fresh host-key confirmation
 * may be involved), so the user always makes the final selection themselves,
 * even when there is only one thing to select.
 */
export async function selectRemoteRootToReconnect(
	candidates: readonly RemoteRootReconnectCandidate[],
	pick: RemoteRootReconnectPicker,
): Promise<RemoteRootReconnectCandidate | undefined> {
	if (candidates.length === 0) {
		return undefined;
	}
	const items = candidates.map((candidate): RemoteRootReconnectPickItem =>
		Object.freeze({
			label: candidate.label,
			description: `${candidate.user}@${candidate.host}:${candidate.port}`,
			candidate,
		}),
	);
	return (await pick(Object.freeze(items)))?.candidate;
}

function remoteRootIdentityKey(
	host: string,
	port: number,
	user: string,
	path: string,
): string {
	return `${host}\0${port}\0${user}\0${path}`;
}

/** `"existing"` candidates: every currently-known remote root whose bound
 * session has disconnected (`disconnected: true`) — a live/connected root is
 * never offered, there is nothing to reconnect. */
export function existingDisconnectedRemoteRootCandidates(
	knownRoots: ReadonlyMap<string, KnownRemoteRootRecord>,
): readonly RemoteRootReconnectCandidate[] {
	return [...knownRoots.entries()]
		.filter(([, record]) => record.disconnected)
		.map(([rootId, record]): RemoteRootReconnectCandidate =>
			Object.freeze({
				kind: "existing",
				rootId,
				label: record.label,
				host: record.host,
				port: record.port,
				user: record.user,
			}),
		);
}

/** `"pending"` candidates: every remote root a stored Recent entry names
 * that is *not* already `knownRoots` (by `(host, port, user, path)`
 * identity — the same identity ADR 0007 §2 uses for a remote root, minus
 * the host-key fingerprint this frontend never sees) — i.e. one this window
 * has never authorized at all yet. `remoteRoots` is typically
 * `entries[0].remoteRoots` from a fresh `workspaceRecentList()` call (the
 * MRU entry — the one cold start would have driven local restoration from). */
export function coldStartPendingRemoteRootCandidates(
	knownRoots: ReadonlyMap<string, KnownRemoteRootRecord>,
	remoteRoots: readonly WorkspaceRecentRemoteRoot[],
): readonly RemoteRootReconnectCandidate[] {
	const knownIdentities = new Set(
		[...knownRoots.values()].map((record) =>
			remoteRootIdentityKey(record.host, record.port, record.user, record.path),
		),
	);
	return remoteRoots
		.filter(
			(remoteRoot) =>
				!knownIdentities.has(
					remoteRootIdentityKey(
						remoteRoot.host,
						remoteRoot.port,
						remoteRoot.user,
						remoteRoot.path,
					),
				),
		)
		.map((remoteRoot): RemoteRootReconnectCandidate =>
			Object.freeze({
				kind: "pending",
				path: remoteRoot.path,
				label: remoteRoot.label,
				host: remoteRoot.host,
				port: remoteRoot.port,
				user: remoteRoot.user,
			}),
		);
}

/**
 * The pure state transition backing "a `Disconnected{reason:"transportClosed"}`
 * event flips every `knownRemoteRoots` entry bound to that session to
 * `disconnected: true`". Returns the *same* `knownRoots` reference,
 * unchanged, when nothing matches (a non-`"transportClosed"` reason, an
 * unknown `sessionId`, or every matching entry already `disconnected`) —
 * `plain-remote-workspace-commands.ts`'s own event listener uses that
 * reference equality to decide whether there is anything new to notify
 * about, rather than re-deriving the diff itself.
 */
export function applyRemoteSessionDisconnectedEvent(
	knownRoots: ReadonlyMap<string, KnownRemoteRootRecord>,
	event: Readonly<{ sessionId: string; reason: string }>,
): ReadonlyMap<string, KnownRemoteRootRecord> {
	if (event.reason !== "transportClosed") {
		return knownRoots;
	}
	let changed = false;
	const next = new Map(knownRoots);
	for (const [rootId, record] of knownRoots) {
		if (record.sessionId === event.sessionId && !record.disconnected) {
			next.set(rootId, Object.freeze({ ...record, disconnected: true }));
			changed = true;
		}
	}
	return changed ? next : knownRoots;
}

export function remoteRootReconnectSuccessMessage(
	candidate: RemoteRootReconnectCandidate,
): string {
	return `Plain: reconnected "${candidate.label}" to ${candidate.user}@${candidate.host}:${candidate.port}.`;
}

/**
 * The four reconnect-outcome branches' own user-visible text: the two new
 * `remoteWorkspaceReconnectRoot`-specific codes get an accurate, distinct
 * explanation each (never a generic "reconnect failed"); anything else
 * falls back to the thrown error's own `message` (already accurate and
 * specific — e.g. a `REMOTE_HOST_KEY_CHANGED` from the *connect* phase
 * already states old/new fingerprints inline).
 */
export function remoteRootReconnectFailureMessage(
	candidate: RemoteRootReconnectCandidate,
	error: Pick<CommandError, "code" | "message">,
): string {
	if (error.code === "REMOTE_ROOT_IDENTITY_CHANGED") {
		return (
			`Plain: cannot reconnect "${candidate.label}" — the SSH session's host identity no ` +
			`longer matches what ${candidate.host}:${candidate.port} was originally opened under. ` +
			"This may mean the host was reinstalled, or something is impersonating it; verify the " +
			"new identity out of band before trusting it."
		);
	}
	if (error.code === "REMOTE_ROOT_PATH_CHANGED") {
		return (
			`Plain: cannot reconnect "${candidate.label}" — its directory no longer resolves to ` +
			`the same path on ${candidate.host}:${candidate.port}. It may have been moved, renamed, ` +
			"or replaced since this folder was opened."
		);
	}
	return `Plain: failed to reconnect "${candidate.label}": ${error.message}`;
}

/** The actionable "lost connection" notification's own text (`F220` S4
 * §四 point 2) — always names the exact root/host, never a bare
 * "disconnected". */
export function remoteRootTransportClosedNotificationMessage(
	record: Readonly<{ label: string; host: string; port: number; user: string }>,
): string {
	return (
		`Plain: lost the SSH connection to "${record.label}" (${record.user}@${record.host}:` +
		`${record.port}). Run Plain: Reconnect Remote Session… to restore it.`
	);
}

/** The cold-start "needs reconnect" notification's own text (`F220` S4 §四
 * point 3) — one per remote root a fresh window's MRU Recent entry names
 * that was never auto-connected. */
export function remoteRootColdStartNeedsReconnectMessage(
	remoteRoot: Readonly<{
		label: string;
		host: string;
		port: number;
		user: string;
	}>,
): string {
	return (
		`Plain: "${remoteRoot.label}" (${remoteRoot.user}@${remoteRoot.host}:${remoteRoot.port}) ` +
		"needs to reconnect. Run Plain: Reconnect Remote Session… to restore it."
	);
}
