import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import {
	EnterMultiRootWorkspaceSupportContext,
	OpenFolderWorkspaceSupportContext,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys";

import type { PlainBridge, WorkspaceSnapshot } from "../../platform/tauri";
import { MultiRootWorkspaceUnsupportedError } from "./workspace-projection";

export const WORKSPACE_COMMAND_IDS = Object.freeze({
	openFolder: "workbench.action.files.openFolder",
	openFolderViaWorkspace: "workbench.action.files.openFolderViaWorkspace",
	addRootFolder: "addRootFolder",
});

export interface WorkspaceCommandRegistration {
	dispose(): void;
}

export function registerWorkspaceCommands(
	bridge: PlainBridge,
	contextKeyService: IContextKeyService,
	applySnapshot: (snapshot: WorkspaceSnapshot) => void | Promise<void>,
): WorkspaceCommandRegistration {
	const previousOpenFolderSupport =
		contextKeyService.getContextKeyValue<boolean>(
			OpenFolderWorkspaceSupportContext.key,
		);
	const openFolderSupported =
		OpenFolderWorkspaceSupportContext.bindTo(contextKeyService);
	openFolderSupported.set(true);
	const previousMultiRootSupport =
		contextKeyService.getContextKeyValue<boolean>(
			EnterMultiRootWorkspaceSupportContext.key,
		);
	const multiRootSupported =
		EnterMultiRootWorkspaceSupportContext.bindTo(contextKeyService);
	const restoreMultiRootSupport =
		previousMultiRootSupport ?? multiRootSupported.get() ?? false;
	multiRootSupported.set(false);

	const pickRoots = async (mode: "replace" | "add") => {
		const result = await bridge.workspacePickRoots(mode);
		if (result.status === "selected") {
			await applySnapshot(result.snapshot);
		}
		return result;
	};
	const registrations = [
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.openFolder, () =>
			pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.openFolderViaWorkspace,
			() => pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.addRootFolder, () =>
			Promise.reject(new MultiRootWorkspaceUnsupportedError()),
		),
	];

	return {
		dispose() {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
			openFolderSupported.set(previousOpenFolderSupport ?? false);
			multiRootSupported.set(restoreMultiRootSupport);
		},
	};
}
