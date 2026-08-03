import { Codicon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/codicons";
import {
	KeyChord,
	KeyCode,
	KeyMod,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes";
import { ThemeIcon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/themables";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import {
	KeybindingWeight,
	KeybindingsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry";
import type { IQuickPickItem } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { WorkbenchStateContext } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys";

import {
	normalizeCommandError,
	type PlainBridge,
	type WorkspaceOpenFilesResult,
	type WorkspaceRecentEntry,
} from "../../platform/tauri";
import type { WorkspaceTopologyCoordinator } from "./workspace-projection";
import { flushPlainWorkingCopyBackupsForTopologyChange } from "../../services/plain-workspace-backup-tracker";

export const LOCAL_WORKSPACE_COMMAND_IDS = Object.freeze({
	openFile: "workbench.action.files.openFile",
	openRecent: "workbench.action.openRecent",
	quickOpenRecent: "workbench.action.quickOpenRecent",
	clearRecent: "workbench.action.clearRecentFiles",
	newWindow: "workbench.action.newWindow",
	closeFolder: "workbench.action.closeFolder",
});

const PLAIN_WORKSPACE_SCHEME = "plain-workspace";
const REMOVE_RECENT_BUTTON = Object.freeze({
	iconClass: ThemeIcon.asClassName(Codicon.removeClose),
	tooltip: "Remove from Recently Opened",
});

interface RecentWorkspaceQuickPickItem extends IQuickPickItem {
	readonly recentId: string;
	readonly buttons: readonly [typeof REMOVE_RECENT_BUTTON];
}

export interface LocalWorkspaceCommandRegistration {
	dispose(): void;
}

function reportWorkspaceWorkflowError(
	notificationService: INotificationService,
	error: unknown,
): void {
	notificationService.error(normalizeCommandError(error).message);
}

export async function reportInitialWorkspaceRestoreStatus(
	bridge: PlainBridge,
	notificationService: INotificationService,
): Promise<void> {
	try {
		const history = await bridge.workspaceRecentList();
		if (history.restoreStatus === "failed") {
			notificationService.warn(
				"Plain could not restore the last workspace. Use Open Recent to retry.",
			);
		}
	} catch (error) {
		reportWorkspaceWorkflowError(notificationService, error);
	}
}

function openFileResource(
	target: WorkspaceOpenFilesResult["files"][number],
): URI {
	return URI.from({
		scheme: PLAIN_WORKSPACE_SCHEME,
		authority: target.rootId,
		path: `/${target.relativePath}`,
	});
}

async function openSelectedFiles(
	result: WorkspaceOpenFilesResult,
	editorService: IEditorService,
): Promise<void> {
	if (result.status === "cancelled") return;
	await editorService.openEditors(
		result.files.map((target) => ({
			resource: openFileResource(target),
			options: { pinned: true },
		})),
	);
}

function recentQuickPickItem(
	entry: WorkspaceRecentEntry,
): RecentWorkspaceQuickPickItem {
	return Object.freeze({
		label: entry.label,
		description:
			entry.rootLabels.length > 1 ? entry.rootLabels.join(" · ") : undefined,
		recentId: entry.recentId,
		buttons: Object.freeze([REMOVE_RECENT_BUTTON] as const),
	});
}

export function registerLocalWorkspaceCommands(
	bridge: PlainBridge,
	topologyCoordinator: WorkspaceTopologyCoordinator,
	flushWorkingCopyBackups: () => Promise<void> = flushPlainWorkingCopyBackupsForTopologyChange,
): LocalWorkspaceCommandRegistration {
	const newWindow = async (notificationService: INotificationService) => {
		try {
			await bridge.windowCreate();
		} catch (error) {
			reportWorkspaceWorkflowError(notificationService, error);
		}
	};
	const closeFolder = async (notificationService: INotificationService) => {
		try {
			await topologyCoordinator.runMutation(async () => {
				await flushWorkingCopyBackups();
				const snapshot = await bridge.workspaceCloseFolder();
				return Object.freeze({ result: undefined, snapshot });
			});
		} catch (error) {
			reportWorkspaceWorkflowError(notificationService, error);
		}
	};
	const openFiles = async (
		editorService: IEditorService,
		notificationService: INotificationService,
	) => {
		try {
			const result = await topologyCoordinator.runMutation(async () => {
				const opened = await bridge.workspaceOpenFiles();
				return Object.freeze({
					result: opened,
					snapshot: opened.status === "selected" ? opened.snapshot : undefined,
				});
			});
			await openSelectedFiles(result, editorService);
		} catch (error) {
			reportWorkspaceWorkflowError(notificationService, error);
		}
	};
	const openRecent = async (
		quickInputService: IQuickInputService,
		notificationService: INotificationService,
	) => {
		try {
			const history = await bridge.workspaceRecentList();
			if (history.entries.length === 0) {
				notificationService.info("Plain: there are no recent workspaces.");
				return;
			}
			const picked = await quickInputService.pick(
				history.entries.map(recentQuickPickItem),
				{
					placeHolder: "Select a recent workspace to open",
					sortByLabel: false,
					matchOnDescription: true,
					onDidTriggerItemButton: async (context) => {
						if (context.button !== REMOVE_RECENT_BUTTON) return;
						try {
							await bridge.workspaceRemoveRecent(context.item.recentId);
							context.removeItem();
						} catch (error) {
							reportWorkspaceWorkflowError(notificationService, error);
						}
					},
				},
			);
			if (picked === undefined) return;
			await topologyCoordinator.runMutation(async () =>
				Object.freeze({
					result: undefined,
					snapshot: await bridge.workspaceOpenRecent(picked.recentId),
				}),
			);
		} catch (error) {
			reportWorkspaceWorkflowError(notificationService, error);
		}
	};
	const clearRecent = async (
		dialogService: IDialogService,
		notificationService: INotificationService,
	) => {
		try {
			const confirmation = await dialogService.confirm({
				type: "warning",
				message: "Clear all recent workspaces?",
				detail:
					"This only clears Plain's local history. It does not delete any files or folders.",
				primaryButton: "Clear",
			});
			if (!confirmation.confirmed) return;
			await bridge.workspaceClearRecent();
			notificationService.info("Plain: cleared recent workspaces.");
		} catch (error) {
			reportWorkspaceWorkflowError(notificationService, error);
		}
	};
	const registrations = [
		MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
			group: "1_new",
			command: {
				id: LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
				title: "New Window",
			},
			order: 2,
		}),
		MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
			group: "3_workspace",
			command: {
				id: LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
				title: "Close Folder",
				precondition: WorkbenchStateContext.notEqualsTo("empty"),
			},
			order: 4,
			when: WorkbenchStateContext.notEqualsTo("empty"),
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: LOCAL_WORKSPACE_COMMAND_IDS.openFile,
				title: "Open File...",
				category: "File",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
				title: "New Window",
				category: "File",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
				title: "Close Folder",
				category: "File",
				precondition: WorkbenchStateContext.notEqualsTo("empty"),
			},
			when: WorkbenchStateContext.notEqualsTo("empty"),
		}),
		KeybindingsRegistry.registerKeybindingRule({
			id: LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
			weight: KeybindingWeight.WorkbenchContrib + 1,
			when: undefined,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN,
		}),
		KeybindingsRegistry.registerKeybindingRule({
			id: LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			weight: KeybindingWeight.WorkbenchContrib + 1,
			when: WorkbenchStateContext.notEqualsTo("empty"),
			primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyF),
		}),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
			(accessor) => newWindow(accessor.get(INotificationService)),
		),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			(accessor) => closeFolder(accessor.get(INotificationService)),
		),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.openFile,
			(accessor) =>
				openFiles(
					accessor.get(IEditorService),
					accessor.get(INotificationService),
				),
		),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			(accessor) =>
				openRecent(
					accessor.get(IQuickInputService),
					accessor.get(INotificationService),
				),
		),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.quickOpenRecent,
			(accessor) =>
				openRecent(
					accessor.get(IQuickInputService),
					accessor.get(INotificationService),
				),
		),
		CommandsRegistry.registerCommand(
			LOCAL_WORKSPACE_COMMAND_IDS.clearRecent,
			(accessor) =>
				clearRecent(
					accessor.get(IDialogService),
					accessor.get(INotificationService),
				),
		),
	];

	return {
		dispose() {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
		},
	};
}
