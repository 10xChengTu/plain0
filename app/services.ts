import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";

/**
 * The only Workbench services directly selected by Plain. Core services pulled
 * in by initialize() remain inert; in particular no Extension Host is enabled.
 */
export function createServiceOverrides() {
	return {
		...getWorkbenchServiceOverride(),
		...getThemeServiceOverride(),
		...getTextmateServiceOverride(),
	};
}
