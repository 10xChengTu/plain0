import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";

import { EmptyLanguageStatusService } from "./services/empty-language-status";

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
		[ILanguageStatusService.toString()]: new SyncDescriptor(
			EmptyLanguageStatusService,
			[],
			true,
		),
	};
}
