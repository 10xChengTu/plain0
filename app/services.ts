import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { IWorkspacesService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";
import { IWorkspaceEditingService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service";

import { EmptyLanguageStatusService } from "./services/empty-language-status";
import {
	PlainWorkspaceEditingService,
	PlainWorkspacesService,
} from "./services/plain-workspace-services";

/**
 * The only Workbench services directly selected by Plain. Core services pulled
 * in by initialize() remain inert; in particular no Extension Host is enabled.
 */
export function createServiceOverrides() {
	return {
		...getConfigurationServiceOverride(),
		...getFilesServiceOverride(),
		...getModelServiceOverride(),
		...getWorkbenchServiceOverride(),
		...getExplorerServiceOverride(),
		...getThemeServiceOverride(),
		...getTextmateServiceOverride(),
		[IWorkspaceEditingService.toString()]: new SyncDescriptor(
			PlainWorkspaceEditingService,
			[],
			true,
		),
		[IWorkspacesService.toString()]: new SyncDescriptor(
			PlainWorkspacesService,
			[],
			true,
		),
		[IDialogService.toString()]: new SyncDescriptor(
			DialogService,
			undefined,
			true,
		),
		[ILanguageStatusService.toString()]: new SyncDescriptor(
			EmptyLanguageStatusService,
			[],
			true,
		),
	};
}
