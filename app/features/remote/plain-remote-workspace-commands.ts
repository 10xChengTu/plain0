/**
 * `F220` S3's two remote-workspace commands — "Plain: Open Remote Folder…"
 * (browses a live session's remote filesystem via a QuickPick loop built on
 * `plain-remote-workspace-browse.ts`'s pure item logic, then authorizes the
 * chosen directory as a new workspace root) and "Plain: Refresh Remote
 * Folder" (ADR 0007 §3's own explicit rescan-on-demand affordance for a
 * backend with no realtime watcher). Mirrors `plain-remote-ssh-commands.ts`'s
 * identical "module-level bridge reference configured once at startup"
 * shape.
 */

import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import type { IQuickPickItem } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput";

import type { PlainBridge } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import type { PlainWorkspaceRemoteRefreshProvider } from "../workspace/file-system-provider";
import type { WorkspaceTopologyCoordinator } from "../workspace/workspace-projection";
import {
	remoteWorkspaceBrowseItems,
	type RemoteWorkspaceBrowseItem,
} from "./plain-remote-workspace-browse";

export const REMOTE_OPEN_FOLDER_COMMAND_ID = "plain.remote.openFolder";
export const REMOTE_REFRESH_FOLDER_COMMAND_ID = "plain.remote.refreshFolder";

/** Bounded page size for each `remoteWorkspacePickDirectory` round trip —
 * generous for an interactive picker, far below the wire's own
 * `MAX_REMOTE_PICK_PAGE_SIZE` (500). */
const BROWSE_PAGE_SIZE = 100;
const BROWSE_START_PATH = "/";

let configuredBridge: PlainBridge | undefined;
let configuredTopologyCoordinator: WorkspaceTopologyCoordinator | undefined;
let configuredRefreshProvider: PlainWorkspaceRemoteRefreshProvider | undefined;
/** Root ids this window has itself authorized via `Open Remote Folder…` —
 * `Refresh Remote Folder`'s own data source. Intentionally in-memory only:
 * a `WorkspaceSnapshot`'s own `WorkspaceRootSnapshot` carries no backend
 * tag (ADR 0007's `rootId` abstraction is deliberately backend-opaque to
 * the frontend), and persisting which roots are remote across a reload is
 * `F220` S4's own "cold-start needs reconnect" scope, not this slice's. */
const knownRemoteRoots = new Map<string, string>();

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

/** Wires the module-level references every command handler below reads —
 * see the module doc. Safe to call again (e.g. across a hot-reloaded dev
 * session). */
export function configurePlainRemoteWorkspaceBridge(
	nextBridge: PlainBridge,
	nextTopologyCoordinator: WorkspaceTopologyCoordinator,
	nextRefreshProvider: PlainWorkspaceRemoteRefreshProvider,
): { dispose(): void } {
	configuredBridge = nextBridge;
	configuredTopologyCoordinator = nextTopologyCoordinator;
	configuredRefreshProvider = nextRefreshProvider;
	return {
		dispose() {
			configuredBridge = undefined;
			configuredTopologyCoordinator = undefined;
			configuredRefreshProvider = undefined;
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
	}));
	const pickedSession = await quickInputService.pick(sessionItems, {
		placeHolder: "Select an SSH session to browse",
		canPickMany: false,
	});
	if (pickedSession === undefined) {
		return;
	}
	const sessionId = pickedSession.sessionId;

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

async function finishOpenRemoteFolder(
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
	sessionId: string,
	canonicalPath: string,
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
			displayName ?? addedRoot?.displayName ?? canonicalPath,
		);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
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
	const items = [...knownRemoteRoots.entries()].map(([rootId, label]) => ({
		label,
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
	];
	return {
		dispose() {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}
