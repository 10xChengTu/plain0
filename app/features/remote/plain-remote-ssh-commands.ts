/**
 * `F220` S1's three SSH commands — "Plain: Connect to SSH Host…"/
 * "Plain: Disconnect SSH Session…"/"Plain: Forget SSH Host Key…". Each is a
 * thin QuickInput/QuickPick wrapper: all real decision logic (host-key
 * confirmation, the notification text for a session event) lives in
 * `plain-remote-host-key-confirmation.ts`, unit tested there without any DOM
 * — this file's own job is only wiring real Workbench services to that
 * logic, exactly mirroring `plain-debug-commands.ts`'s identical split.
 *
 * `configurePlainRemoteSshBridge` must be called exactly once, before any of
 * these commands run — mirrors `plain-terminal-view.ts`'s
 * `configurePlainTerminalBridge` precedent (a module-level bridge reference
 * set once at startup, read by every command handler below). It also wires
 * the single persistent `remoteSessionWatchEvent` listener that is this
 * slice's own "会话状态可见" minimum (ADR 0006 — a full session-list view is
 * deferred to a later slice): every `plain://remote-session-event` delivery
 * becomes one notification, so the connect/disconnect commands themselves
 * never show a duplicate "connected"/"disconnected" toast on top of it.
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

import type { PlainBridge } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import {
	remoteSessionEventNotification,
	resolveRemoteSessionConnect,
} from "./plain-remote-host-key-confirmation";

export const REMOTE_CONNECT_COMMAND_ID = "plain.remote.connect";
export const REMOTE_DISCONNECT_COMMAND_ID = "plain.remote.disconnect";
export const REMOTE_FORGET_HOST_KEY_COMMAND_ID = "plain.remote.forgetHostKey";

/** Not a security fallback (host/port/user are not credentials — see
 * `RemoteSessionConnectRequest`'s own doc comment) — just the ordinary SSH
 * default port, prefilled so the common case needs no typing. */
const DEFAULT_SSH_PORT = 22;

let configuredBridge: PlainBridge | undefined;
let unlistenRemoteSessionEvents: (() => void | Promise<void>) | undefined;

function bridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"plain-remote-ssh-commands used before configurePlainRemoteSshBridge",
		);
	}
	return configuredBridge;
}

/** Wires the module-level bridge reference and the one persistent session-
 * event listener — see the module doc. Safe to call again (e.g. across a
 * hot-reloaded dev session): a prior listener is torn down first. */
export function configurePlainRemoteSshBridge(
	nextBridge: PlainBridge,
	notificationService: INotificationService,
): { dispose(): void } {
	configuredBridge = nextBridge;
	unlistenRemoteSessionEvents?.();
	unlistenRemoteSessionEvents = nextBridge.remoteSessionWatchEvent((event) => {
		const message = remoteSessionEventNotification(event);
		if (message !== undefined) {
			notificationService.info(message);
		}
	});
	return {
		dispose() {
			unlistenRemoteSessionEvents?.();
			unlistenRemoteSessionEvents = undefined;
			configuredBridge = undefined;
		},
	};
}

function isValidPortInput(value: string): number | undefined {
	if (value.trim().length === 0) {
		return DEFAULT_SSH_PORT;
	}
	const port = Number(value.trim());
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return undefined;
	}
	return port;
}

/**
 * "Plain: Connect to SSH Host…" — three sequential `IQuickInputService.input`
 * prompts (host, user, port — non-credential connection targets, per ADR
 * 0006 §2's own "连接目标…可经产品 UI 输入" carve-out), then
 * `resolveRemoteSessionConnect`. Cancelling any one of the three prompts
 * (an `undefined` return) aborts with zero further side effects — no
 * `remoteSessionConnect` call at all, matching every other cancellable
 * QuickInput flow in this codebase (`runStartDebugging`'s launch-
 * configuration picker, etc.).
 */
async function runConnectToSshHost(
	dialogService: IDialogService,
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	const title = "Plain: Connect to SSH Host…";
	const hostInput = await quickInputService.input({
		title,
		prompt: "Host",
		placeHolder: "example.com or 192.168.1.10",
	});
	const host = hostInput?.trim();
	if (host === undefined || host.length === 0) {
		return;
	}
	const userInput = await quickInputService.input({
		title,
		prompt: "User",
		placeHolder: "octocat",
	});
	const user = userInput?.trim();
	if (user === undefined || user.length === 0) {
		return;
	}
	const portInput = await quickInputService.input({
		title,
		prompt: "Port",
		value: String(DEFAULT_SSH_PORT),
		placeHolder: String(DEFAULT_SSH_PORT),
	});
	if (portInput === undefined) {
		return;
	}
	const port = isValidPortInput(portInput);
	if (port === undefined) {
		notificationService.error(`Plain: "${portInput}" is not a valid port.`);
		return;
	}
	try {
		await resolveRemoteSessionConnect(
			bridge(),
			dialogService,
			host,
			port,
			user,
		);
		// A `"connected"` decision is already surfaced by the persistent
		// `remoteSessionWatchEvent` listener (`configurePlainRemoteSshBridge`);
		// a `"declined"` decision (the user dismissed the host-key
		// confirmation dialog) is a deliberate, silent no-op, mirroring every
		// other cancelled-confirmation flow in this codebase.
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

interface RemoteSessionQuickPickItem extends IQuickPickItem {
	readonly sessionId: string;
}

/** "Plain: Disconnect SSH Session…" — lists this window's live sessions via
 * `remoteSessionState`, shows an accurate "no live sessions" message instead
 * of an empty picker when there are none. */
async function runDisconnectSshSession(
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
		notificationService.info("Plain: no live SSH sessions in this window.");
		return;
	}
	const items: RemoteSessionQuickPickItem[] = state.sessions.map((session) => ({
		label: `${session.user}@${session.host}:${session.port}`,
		sessionId: session.sessionId,
	}));
	const picked = await quickInputService.pick(items, {
		placeHolder: "Select an SSH session to disconnect",
		canPickMany: false,
	});
	if (picked === undefined) {
		return;
	}
	try {
		await bridge().remoteSessionDisconnect(picked.sessionId);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

interface RemoteHostKeyQuickPickItem extends IQuickPickItem {
	readonly host: string;
	readonly port: number;
}

/** "Plain: Forget SSH Host Key…" — lists every pinned host via
 * `remoteHostKeyList`, then a real DOM confirmation (deletion is
 * irreversible: the next connect to that host starts over as unknown)
 * before actually forgetting it. */
async function runForgetSshHostKey(
	dialogService: IDialogService,
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	let listed;
	try {
		listed = await bridge().remoteHostKeyList();
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
		return;
	}
	if (listed.entries.length === 0) {
		notificationService.info("Plain: no pinned SSH host keys.");
		return;
	}
	const items: RemoteHostKeyQuickPickItem[] = listed.entries.map((entry) => ({
		label: `${entry.host}:${entry.port}`,
		description: entry.algorithm,
		host: entry.host,
		port: entry.port,
	}));
	const picked = await quickInputService.pick(items, {
		placeHolder: "Select a pinned SSH host key to forget",
		canPickMany: false,
	});
	if (picked === undefined) {
		return;
	}
	const confirmation = await dialogService.confirm({
		message: `Forget the pinned host key for ${picked.host}:${picked.port}?`,
		detail:
			"The next connection to this host will be treated as unknown again, and will need a " +
			"fresh confirmation before it can connect.",
		primaryButton: "Forget Host Key",
	});
	if (!confirmation.confirmed) {
		return;
	}
	try {
		await bridge().remoteHostKeyForget(picked.host, picked.port);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

export function registerPlainRemoteSshCommands(): { dispose(): void } {
	const disposables = [
		CommandsRegistry.registerCommand(REMOTE_CONNECT_COMMAND_ID, (accessor) => {
			void runConnectToSshHost(
				accessor.get(IDialogService),
				accessor.get(INotificationService),
				accessor.get(IQuickInputService),
			);
		}),
		CommandsRegistry.registerCommand(
			REMOTE_DISCONNECT_COMMAND_ID,
			(accessor) => {
				void runDisconnectSshSession(
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
		CommandsRegistry.registerCommand(
			REMOTE_FORGET_HOST_KEY_COMMAND_ID,
			(accessor) => {
				void runForgetSshHostKey(
					accessor.get(IDialogService),
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_CONNECT_COMMAND_ID,
				title: "Connect to SSH Host…",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_DISCONNECT_COMMAND_ID,
				title: "Disconnect SSH Session…",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOTE_FORGET_HOST_KEY_COMMAND_ID,
				title: "Forget SSH Host Key…",
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
