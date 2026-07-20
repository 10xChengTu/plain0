import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import {
	EnterMultiRootWorkspaceSupportContext,
	OpenFolderWorkspaceSupportContext,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys";

import type { PlainBridge } from "../../platform/tauri";
import { PlainWorkspaceOperationUnsupportedError } from "../../services/plain-workspace-services";
import type { WorkspaceTopologyCoordinator } from "./workspace-projection";

export const WORKSPACE_COMMAND_IDS = Object.freeze({
	openFolder: "workbench.action.files.openFolder",
	openFolderViaWorkspace: "workbench.action.files.openFolderViaWorkspace",
	setRootFolder: "setRootFolder",
	addRootFolder: "addRootFolder",
});

export const GUARDED_WORKSPACE_COMMAND_IDS = Object.freeze([
	"removeRootFolder",
	"workbench.action.removeRootFolder",
	"workbench.action.closeFolder",
	"workbench.action.openWorkspace",
	"workbench.action.openWorkspaceConfigFile",
	"workbench.action.openWorkspaceInNewWindow",
	"workbench.action.saveWorkspaceAs",
	"workbench.action.duplicateWorkspaceInNewWindow",
	"workbench.action.files.openFile",
	"workbench.action.files.openFileFolder",
	"workbench.action.files.openFileInNewWindow",
	"workbench.action.newWindow",
	"vscode.openFolder",
	"vscode.newWindow",
	"_files.pickFolderAndOpen",
	"_files.newWindow",
	"_files.windowOpen",
] as const);

export interface WorkspaceCommandRegistration {
	dispose(): void;
}

export function registerWorkspaceCommands(
	bridge: PlainBridge,
	contextKeyService: IContextKeyService,
	topologyCoordinator: WorkspaceTopologyCoordinator,
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

	const pickRoots = (mode: "replace" | "add") =>
		topologyCoordinator.runMutation(async () => {
			const result = await bridge.workspacePickRoots(mode);
			return Object.freeze({
				result,
				snapshot: result.status === "selected" ? result.snapshot : undefined,
			});
		});
	const registrations = [
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.openFolder, () =>
			pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(
			WORKSPACE_COMMAND_IDS.openFolderViaWorkspace,
			() => pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.setRootFolder, () =>
			pickRoots("replace"),
		),
		CommandsRegistry.registerCommand(WORKSPACE_COMMAND_IDS.addRootFolder, () =>
			pickRoots("add"),
		),
		...GUARDED_WORKSPACE_COMMAND_IDS.map((id) =>
			CommandsRegistry.registerCommand(id, () =>
				Promise.reject(new PlainWorkspaceOperationUnsupportedError()),
			),
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
