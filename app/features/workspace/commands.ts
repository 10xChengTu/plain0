import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { OpenFolderWorkspaceSupportContext } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys";

import type { PlainBridge } from "../../platform/tauri";

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
): WorkspaceCommandRegistration {
	const previousOpenFolderSupport =
		contextKeyService.getContextKeyValue<boolean>(
			OpenFolderWorkspaceSupportContext.key,
		);
	const openFolderSupported =
		OpenFolderWorkspaceSupportContext.bindTo(contextKeyService);
	openFolderSupported.set(true);

	const registrations = [
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.openFolder, () =>
			bridge.workspacePickRoots("replace"),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.openFolderViaWorkspace,
			() => bridge.workspacePickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.addRootFolder, () =>
			bridge.workspacePickRoots("add"),
		),
	];

	return {
		dispose() {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
			openFolderSupported.set(previousOpenFolderSupport ?? false);
		},
	};
}
