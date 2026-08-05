/**
 * `F220` S3's two remote-workspace commands — "Plain: Open Remote Folder…"
 * (browses a live session's remote filesystem via a QuickPick loop built on
 * `plain-remote-workspace-browse.ts`'s pure item logic, then authorizes the
 * chosen directory as a new workspace root) and "Plain: Refresh Remote
 * Folder" (ADR 0007 §3's own explicit rescan-on-demand affordance for a
 * backend with no realtime watcher) — plus `F220` S4's own third command,
 * "Plain: Reconnect Remote Session…", and the reactive "session disconnected
 * out from under an open root" handling that command exists to recover from.
 * Mirrors `plain-remote-ssh-commands.ts`'s identical "module-level bridge
 * reference configured once at startup" shape.
 */

import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import type { IQuickPickItem } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput";

import type {
	PlainBridge,
	RemoteSessionEventPayload,
	WorkspaceRecentRemoteRoot,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { restorePlainWorkingCopyBackupsForTopologyChange } from "../../services/plain-workspace-backup-tracker";
import type { PlainWorkspaceRemoteRefreshProvider } from "../workspace/file-system-provider";
import type { WorkspaceTopologyCoordinator } from "../workspace/workspace-projection";
import { resolveRemoteSessionConnect } from "./plain-remote-host-key-confirmation";
import {
	coldStartPendingRemoteRootCandidates,
	existingDisconnectedRemoteRootCandidates,
	applyRemoteSessionDisconnectedEvent,
	remoteRootColdStartNeedsReconnectMessage,
	remoteRootReconnectFailureMessage,
	remoteRootReconnectSuccessMessage,
	remoteRootTransportClosedNotificationMessage,
	selectRemoteRootToReconnect,
	type KnownRemoteRootRecord,
	type RemoteRootReconnectCandidate,
} from "./plain-remote-workspace-lifecycle";
import {
	remoteWorkspaceBrowseItems,
	type RemoteWorkspaceBrowseItem,
} from "./plain-remote-workspace-browse";

export const REMOTE_OPEN_FOLDER_COMMAND_ID = "plain.remote.openFolder";
export const REMOTE_REFRESH_FOLDER_COMMAND_ID = "plain.remote.refreshFolder";
export const REMOTE_RECONNECT_COMMAND_ID = "plain.remote.reconnect";

/** Bounded page size for each `remoteWorkspacePickDirectory` round trip —
 * generous for an interactive picker, far below the wire's own
 * `MAX_REMOTE_PICK_PAGE_SIZE` (500). */
const BROWSE_PAGE_SIZE = 100;
const BROWSE_START_PATH = "/";

let configuredBridge: PlainBridge | undefined;
let configuredTopologyCoordinator: WorkspaceTopologyCoordinator | undefined;
let configuredRefreshProvider: PlainWorkspaceRemoteRefreshProvider | undefined;
let unlistenRemoteSessionEvents: (() => void | Promise<void>) | undefined;
/** Root ids this window has itself authorized via `Open Remote Folder…` (or
 * subsequently reconnected) — `Refresh Remote Folder`'s own data source, and
 * (`F220` S4) `Plain: Reconnect Remote Session…`'s own "which roots are
 * already known, and which of those are currently disconnected" state.
 * `disconnected` starts `false` at authorization and flips to `true` when a
 * `Disconnected{reason:"transportClosed"}` event names this root's bound
 * session (`applyRemoteSessionDisconnectedEvent`) — flips back to `false`
 * once `remoteWorkspaceReconnectRoot` succeeds. Intentionally in-memory
 * only, exactly like before `F220` S4: a `WorkspaceSnapshot`'s own
 * `WorkspaceRootSnapshot` carries no backend tag (ADR 0007's `rootId`
 * abstraction is deliberately backend-opaque to the frontend), so this
 * module's own bookkeeping is the only place that knows which roots are
 * remote at all. A *cold-start-pending* remote root (one a stored Recent
 * entry names that this window has never authorized) deliberately never
 * enters this map at all — see `coldStartPendingRemoteRootCandidates`,
 * which re-derives those fresh from `workspaceRecentList()` on every
 * `Plain: Reconnect Remote Session…` invocation instead. */
const knownRemoteRoots = new Map<string, KnownRemoteRootRecord>();

function bridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"plain-remote-workspace-commands used before configurePlainRemoteWorkspaceBridge",
		);
	}
	return configuredBridge;
}

function topologyCoordinator(): WorkspaceTopologyCoordinator {
	if (configuredTopologyCoordinator === undefined) {
		throw new Error(
			"plain-remote-workspace-commands used before configurePlainRemoteWorkspaceBridge",
		);
	}
	return configuredTopologyCoordinator;
}

/** Structural services this module needs at configuration time — `F220` S4
 * addition: the reactive "session disconnected out from under an open root"
 * listener below needs a real `INotificationService`/`IDialogService`/
 * `IQuickInputService` instance the moment it is registered (mirrors
 * `configurePlainRemoteSshBridge`'s own identical need for
 * `INotificationService`, and `registerPlainUntitledWorkflow`'s "small
 * services bag object" parameter shape for a module that needs more than
 * one). */
export interface PlainRemoteWorkspaceServices {
	readonly notificationService: INotificationService;
	readonly dialogService: IDialogService;
	readonly quickInputService: IQuickInputService;
}

let configuredServices: PlainRemoteWorkspaceServices | undefined;

/** Only `connectAndMountRecentRemoteRoots` reads this outside
 * `configurePlainRemoteWorkspaceBridge` itself (the reactive session-event
 * listener below closes over its own `nextServices` directly instead) — it
 * needs `dialogService`/`notificationService` but is invoked as a bare
 * `(remoteRoots) => Promise<void>` callback (`local-workflow-commands.ts`'s
 * own `onRecentRemoteRootsSelected` parameter shape), with nowhere else to
 * source them from. */
function services(): PlainRemoteWorkspaceServices {
	if (configuredServices === undefined) {
		throw new Error(
			"plain-remote-workspace-commands used before configurePlainRemoteWorkspaceBridge",
		);
	}
	return configuredServices;
}

// `INotificationService.prompt`'s severity parameter is a default-exported
// enum, while Plain's closed import authority intentionally forbids default
// imports from the Monaco API package — mirrors `plain-search-view.ts`'s own
// identical `ERROR_NOTIFICATION_SEVERITY` workaround. Numeric enum member 1
// is the stable `Severity.Info` wire/runtime value in this pinned Code OSS
// surface.
const INFO_NOTIFICATION_SEVERITY = 1 as const;

/** `F220` S4: reacts to every `plain://remote-session-event` delivery this
 * window sees — the *only* thing it does is keep `knownRemoteRoots` accurate
 * and raise one actionable notification per root that just became
 * unreachable, its "Reconnect" choice driving the exact same
 * `runReconnectRemoteSession` flow the command itself runs (candidates are
 * re-derived fresh at click time, so this is never stale even if several
 * roots disconnect before the user acts). Deliberately separate from
 * `plain-remote-ssh-commands.ts`'s own persistent `remoteSessionWatchEvent`
 * listener (which still renders its own generic "connected"/"disconnected
 * from user@host:port" toast for *every* session event, `"transportClosed"`
 * included, via its existing non-`"windowClosed"` branch) — the two are not
 * deduplicated on purpose: the generic toast is this window's general
 * session-visibility minimum (ADR 0006), while this one names the specific
 * *root* the loss affects and points at the recovery command, which the
 * generic toast has no way to know about (it never sees `knownRemoteRoots`).
 */
function handleRemoteSessionEventForWorkspaceLifecycle(
	dialogService: IDialogService,
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): (event: RemoteSessionEventPayload) => void {
	return (event) => {
		if (event.event !== "disconnected") {
			return;
		}
		const next = applyRemoteSessionDisconnectedEvent(knownRemoteRoots, event);
		if (next === knownRemoteRoots) {
			return;
		}
		for (const [rootId, record] of next) {
			const previous = knownRemoteRoots.get(rootId);
			if (previous === record) {
				continue;
			}
			knownRemoteRoots.set(rootId, record);
			notificationService.prompt(
				INFO_NOTIFICATION_SEVERITY,
				remoteRootTransportClosedNotificationMessage(record),
				[
					{
						label: "Reconnect",
						run: () => {
							void runReconnectRemoteSession(
								dialogService,
								notificationService,
								quickInputService,
							);
						},
					},
				],
			);
		}
	};
}

/** Wires the module-level references every command handler below reads —
 * see the module doc. Safe to call again (e.g. across a hot-reloaded dev
 * session): a prior `remoteSessionWatchEvent` listener is torn down first. */
export function configurePlainRemoteWorkspaceBridge(
	nextBridge: PlainBridge,
	nextTopologyCoordinator: WorkspaceTopologyCoordinator,
	nextRefreshProvider: PlainWorkspaceRemoteRefreshProvider,
	nextServices: PlainRemoteWorkspaceServices,
): { dispose(): void } {
	configuredBridge = nextBridge;
	configuredTopologyCoordinator = nextTopologyCoordinator;
	configuredRefreshProvider = nextRefreshProvider;
	configuredServices = nextServices;
	unlistenRemoteSessionEvents?.();
	unlistenRemoteSessionEvents = nextBridge.remoteSessionWatchEvent(
		handleRemoteSessionEventForWorkspaceLifecycle(
			nextServices.dialogService,
			nextServices.notificationService,
			nextServices.quickInputService,
		),
	);
	return {
		dispose() {
			unlistenRemoteSessionEvents?.();
			unlistenRemoteSessionEvents = undefined;
			configuredBridge = undefined;
			configuredTopologyCoordinator = undefined;
			configuredRefreshProvider = undefined;
			configuredServices = undefined;
			knownRemoteRoots.clear();
		},
	};
}

interface BrowseQuickPickItem extends IQuickPickItem {
	readonly entry: RemoteWorkspaceBrowseItem;
}

function toQuickPickItem(
	entry: RemoteWorkspaceBrowseItem,
): BrowseQuickPickItem {
	return { label: entry.label, description: entry.description, entry };
}

/**
 * "Plain: Open Remote Folder…" — requires an existing live session (per the
 * contract's own "无会话时…提示先连接"); otherwise drives a QuickPick loop
 * over `remoteWorkspacePickDirectory`, growing the requested page size on
 * "Show more…" rather than tracking a separate offset (simplest correct
 * behavior for an interactive picker: the whole, growing page is always
 * re-requested from the start).
 */
async function runOpenRemoteFolder(
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	let state;
	try {
		state = await bridge().remoteSessionState();
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
		return;
	}
	if (state.sessions.length === 0) {
		notificationService.info(
			"Plain: connect to an SSH host first (Plain: Connect to SSH Host…).",
		);
		return;
	}
	const sessionItems = state.sessions.map((session) => ({
		label: `${session.user}@${session.host}:${session.port}`,
		sessionId: session.sessionId,
		host: session.host,
		port: session.port,
		user: session.user,
	}));
	const pickedSession = await quickInputService.pick(sessionItems, {
		placeHolder: "Select an SSH session to browse",
		canPickMany: false,
	});
	if (pickedSession === undefined) {
		return;
	}
	const { sessionId, host, port, user } = pickedSession;

	let currentPath = BROWSE_START_PATH;
	let pageLimit = BROWSE_PAGE_SIZE;
	for (;;) {
		let page;
		try {
			page = await bridge().remoteWorkspacePickDirectory(
				sessionId,
				currentPath,
				0,
				pageLimit,
			);
		} catch (error) {
			notificationService.error(normalizeCommandError(error).message);
			return;
		}
		const items = remoteWorkspaceBrowseItems(page).map(toQuickPickItem);
		const picked = await quickInputService.pick(items, {
			title: "Plain: Open Remote Folder…",
			placeHolder: page.canonicalPath,
			canPickMany: false,
		});
		if (picked === undefined) {
			return;
		}
		if (picked.entry.kind === "useCurrent") {
			await finishOpenRemoteFolder(
				notificationService,
				quickInputService,
				sessionId,
				page.canonicalPath,
				host,
				port,
				user,
			);
			return;
		}
		if (picked.entry.kind === "loadMore") {
			pageLimit += BROWSE_PAGE_SIZE;
			continue;
		}
		// "up" and "directory" both carry the next directory to browse.
		currentPath = picked.entry.targetPath ?? currentPath;
		pageLimit = BROWSE_PAGE_SIZE;
	}
}

/**
 * Authorizes `canonicalPath` on `sessionId` as a new — or, by identity,
 * already-existing — workspace root, and records it into `knownRemoteRoots`
 * (`rootId`-keyed; see that map's own doc comment). Shared by
 * `finishOpenRemoteFolder`'s own interactive display-name prompt and
 * `runReconnectRemoteSession`'s `"pending"` branch (a cold-start-pending
 * remote root already has a display name — the one its Recent entry stored —
 * so that branch never re-prompts for one).
 */
async function mountRemoteRoot(
	notificationService: INotificationService,
	sessionId: string,
	canonicalPath: string,
	host: string,
	port: number,
	user: string,
	displayName: string | undefined,
): Promise<void> {
	try {
		const previouslyKnownRootIds = new Set(knownRemoteRoots.keys());
		const snapshot = await topologyCoordinator().runMutation(async () => {
			const snapshot = await bridge().remoteWorkspaceAddRoot(
				sessionId,
				canonicalPath,
				displayName,
			);
			return { result: snapshot, snapshot };
		});
		const addedRoot = snapshot.roots.find(
			(root) => !previouslyKnownRootIds.has(root.rootId),
		);
		knownRemoteRoots.set(
			addedRoot?.rootId ?? canonicalPath,
			Object.freeze({
				label: displayName ?? addedRoot?.displayName ?? canonicalPath,
				sessionId,
				host,
				port,
				user,
				path: canonicalPath,
				disconnected: false,
			}),
		);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

async function finishOpenRemoteFolder(
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
	sessionId: string,
	canonicalPath: string,
	host: string,
	port: number,
	user: string,
): Promise<void> {
	const displayNameInput = await quickInputService.input({
		title: "Plain: Open Remote Folder…",
		prompt: "Display name (optional)",
		placeHolder: canonicalPath,
	});
	// A cancelled name prompt (`undefined`) does not abort authorization —
	// only the directory-selection loop above has cancel-means-abort
	// semantics; a name is a cosmetic default the backend already computes.
	const displayName =
		displayNameInput !== undefined && displayNameInput.trim().length > 0
			? displayNameInput.trim()
			: undefined;
	await mountRemoteRoot(
		notificationService,
		sessionId,
		canonicalPath,
		host,
		port,
		user,
		displayName,
	);
}

/**
 * `F220` S4: `Open Recent`'s own remote-root counterpart. Wired as
 * `local-workflow-commands.ts`'s `onRecentRemoteRootsSelected` callback (via
 * `main.ts` — never a direct `features/workspace` → `features/remote`
 * import, keeping the two features decoupled) — called once, with the full
 * `remoteRoots` list a *picked* Recent entry names, right after that
 * entry's local half has already been opened via `workspaceOpenRecent`.
 *
 * For each remote root, drives the exact same "connect (possibly through a
 * host-key confirmation dialog) then authorize" flow
 * `runReconnectRemoteSession`'s own `"pending"` branch uses, sequentially
 * (never in parallel — two concurrent `remoteWorkspaceAddRoot` calls would
 * only contend pointlessly for `topologyCoordinator.runMutation()`'s single
 * mutation queue). A declined host-key confirmation, or any other failure,
 * for one remote root does not abort the rest — each is fully independent,
 * mirroring `mountRemoteRoot`'s own per-root error reporting.
 */
export async function connectAndMountRecentRemoteRoots(
	remoteRoots: readonly WorkspaceRecentRemoteRoot[],
): Promise<void> {
	const { dialogService, notificationService } = services();
	for (const remoteRoot of remoteRoots) {
		let decision;
		try {
			decision = await resolveRemoteSessionConnect(
				bridge(),
				dialogService,
				remoteRoot.host,
				remoteRoot.port,
				remoteRoot.user,
			);
		} catch (error) {
			notificationService.error(normalizeCommandError(error).message);
			continue;
		}
		if (decision.kind === "declined") {
			// The user dismissed the host-key confirmation dialog for this one
			// remote root — zero side effects for it; the rest are unaffected.
			continue;
		}
		await mountRemoteRoot(
			notificationService,
			decision.sessionId,
			remoteRoot.path,
			remoteRoot.host,
			remoteRoot.port,
			remoteRoot.user,
			remoteRoot.label,
		);
	}
}

/**
 * "Plain: Refresh Remote Folder" — fires a full-rescan `onDidChangeFile`
 * (via `PlainWorkspaceRemoteRefreshProvider.plainRefreshRoot`) for the one
 * remote root this window has opened, or a chosen one if it has opened
 * several. A no-op with an accurate message when none has been opened yet.
 */
async function runRefreshRemoteFolder(
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	if (configuredRefreshProvider === undefined) {
		return;
	}
	if (knownRemoteRoots.size === 0) {
		notificationService.info("Plain: no remote folder is open.");
		return;
	}
	if (knownRemoteRoots.size === 1) {
		const [rootId] = knownRemoteRoots.keys();
		configuredRefreshProvider.plainRefreshRoot(rootId!);
		return;
	}
	const items = [...knownRemoteRoots.entries()].map(([rootId, record]) => ({
		label: record.label,
		rootId,
	}));
	const picked = await quickInputService.pick(items, {
		placeHolder: "Select a remote folder to refresh",
		canPickMany: false,
	});
	if (picked === undefined) {
		return;
	}
	configuredRefreshProvider.plainRefreshRoot(picked.rootId);
}

/**
 * "Plain: Reconnect Remote Session…" (`F220` S4, ADR 0006 §5's own "显式重连
 * 是新的信任决策") — offers every reconnect candidate this window currently
 * has (see `plain-remote-workspace-lifecycle.ts`'s own module doc for the
 * `"existing"`/`"pending"` split), lets the user pick exactly one (never
 * auto-selected, even when there is only one — reconnecting is a
 * deliberately explicit action), reconnects via
 * `resolveRemoteSessionConnect` (the same two-phase host-key-confirmation
 * flow `Plain: Connect to SSH Host…` itself uses — a changed pinned key
 * hard-fails here exactly as it does there, with no bypass), then either
 * rebinds the existing root (`"existing"`) or authorizes a brand-new one
 * (`"pending"`).
 */
async function runReconnectRemoteSession(
	dialogService: IDialogService,
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	const existing = existingDisconnectedRemoteRootCandidates(knownRemoteRoots);
	let pending: readonly RemoteRootReconnectCandidate[] = [];
	try {
		const history = await bridge().workspaceRecentList();
		pending = coldStartPendingRemoteRootCandidates(
			knownRemoteRoots,
			history.entries[0]?.remoteRoots ?? [],
		);
	} catch {
		// Best-effort: an unavailable Recent list should not block reconnecting
		// an already-known, already-disconnected root — only the "pending"
		// (never-yet-authorized) half of the candidate list is lost.
	}
	const candidates = [...existing, ...pending];
	if (candidates.length === 0) {
		notificationService.info("Plain: no remote folder needs reconnecting.");
		return;
	}
	const picked = await selectRemoteRootToReconnect(candidates, (items) =>
		quickInputService.pick([...items], {
			title: "Plain: Reconnect Remote Session…",
			placeHolder: "Select a remote folder to reconnect",
			canPickMany: false,
		}),
	);
	if (picked === undefined) {
		return;
	}

	let decision;
	try {
		decision = await resolveRemoteSessionConnect(
			bridge(),
			dialogService,
			picked.host,
			picked.port,
			picked.user,
		);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
		return;
	}
	if (decision.kind === "declined") {
		// The user dismissed the host-key confirmation dialog — zero side
		// effects, mirroring every other cancelled-confirmation flow.
		return;
	}

	if (picked.kind === "pending") {
		await mountRemoteRoot(
			notificationService,
			decision.sessionId,
			picked.path,
			picked.host,
			picked.port,
			picked.user,
			picked.label,
		);
		return;
	}

	try {
		await topologyCoordinator().runMutation(async () => {
			const snapshot = await bridge().remoteWorkspaceReconnectRoot(
				picked.rootId,
				decision.sessionId,
			);
			return { result: snapshot, snapshot };
		});
	} catch (error) {
		notificationService.error(
			remoteRootReconnectFailureMessage(picked, normalizeCommandError(error)),
		);
		return;
	}
	const record = knownRemoteRoots.get(picked.rootId);
	if (record !== undefined) {
		knownRemoteRoots.set(
			picked.rootId,
			Object.freeze({
				...record,
				sessionId: decision.sessionId,
				disconnected: false,
			}),
		);
	}
	// `reconnect_remote_root` leaves the root set's `revision` untouched (see
	// `WorkspaceScope::reconnect_remote_root`'s own doc comment), so
	// `WorkspaceTopologyCoordinator.runMutation()` above never calls
	// `reinitializeWorkspace()` for this mutation — Monaco's own
	// `onDidChangeWorkspaceFolders` never fires. Both of the following are
	// therefore explicit, not automatic, for this one command:
	configuredRefreshProvider?.plainRefreshRoot(picked.rootId);
	void restorePlainWorkingCopyBackupsForTopologyChange();
	notificationService.info(remoteRootReconnectSuccessMessage(picked));
}

/** Pure: the notification text for every remote root a cold-start MRU
 * Recent entry names — factored out from `reportColdStartRemoteRootsNeedReconnect`
 * so a unit test can cover the 0/1/many-remote-roots text without faking a
 * `PlainBridge`/`INotificationService` at all. */
export function coldStartRemoteRootsNeedReconnectMessages(
	remoteRoots: readonly WorkspaceRecentRemoteRoot[],
): readonly string[] {
	return remoteRoots.map(remoteRootColdStartNeedsReconnectMessage);
}

/** `F220` S4: reports every cold-start "needs reconnect" remote root — see
 * `local-workflow-commands.ts`'s own `reportInitialWorkspaceRestoreStatus`,
 * this module's counterpart for the *local* restore-status report. A
 * deliberately *separate* `workspace_recent_list` round trip from that
 * function's own (see `main.ts`'s call site for why: threading that other
 * call's result through here would change its pinned call-site shape) — an
 * extra IPC round trip at cold start, traded for zero cross-feature-module
 * coupling between `features/workspace/` and `features/remote/`. A remote
 * root reported here never auto-connects (ADR 0007 §4) — it only becomes a
 * `Plain: Reconnect Remote Session…` candidate (`"pending"`, re-derived
 * fresh on that command's own next invocation). */
export async function reportColdStartRemoteRootsNeedReconnect(
	bridge: PlainBridge,
	notificationService: INotificationService,
): Promise<void> {
	try {
		const history = await bridge.workspaceRecentList();
		for (const message of coldStartRemoteRootsNeedReconnectMessages(
			history.entries[0]?.remoteRoots ?? [],
		)) {
			notificationService.info(message);
		}
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

export function registerPlainRemoteWorkspaceCommands(): { dispose(): void } {
	const disposables = [
		CommandsRegistry.registerCommand(
			REMOTE_OPEN_FOLDER_COMMAND_ID,
			(accessor) => {
				void runOpenRemoteFolder(
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
		CommandsRegistry.registerCommand(
			REMOTE_REFRESH_FOLDER_COMMAND_ID,
			(accessor) => {
				void runRefreshRemoteFolder(
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
		CommandsRegistry.registerCommand(
			REMOTE_RECONNECT_COMMAND_ID,
			(accessor) => {
				void runReconnectRemoteSession(
					accessor.get(IDialogService),
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_OPEN_FOLDER_COMMAND_ID,
				title: "Open Remote Folder…",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_REFRESH_FOLDER_COMMAND_ID,
				title: "Refresh Remote Folder",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_RECONNECT_COMMAND_ID,
				title: "Reconnect Remote Session…",
				category: "Plain",
			},
		}),
	];
	return {
		dispose() {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}
