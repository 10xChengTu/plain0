import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";
import { WorkingCopyService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { IWorkspacesService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";
import { IWorkingCopyEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service";
import { IWorkingCopyService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyService.service";
import { IWorkspaceEditingService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service";

import { EmptyLanguageStatusService } from "./services/empty-language-status";
import {
	PlainWorkspaceEditingService,
	PlainWorkspacesService,
} from "./services/plain-workspace-services";

/**
 * The only Workbench services directly selected by Plain. Core services pulled
 * in by initialize() remain inert; in particular no Extension Host is enabled.
 *
 * IWorkingCopyService/IWorkingCopyEditorService are wired from their exact
 * class submodules rather than the working-copy-service-override package's
 * aggregating default export. That default export unconditionally imports
 * browser/workingCopyBackupService.js and common/workingCopyHistoryService.js,
 * which register BrowserWorkingCopyBackupTracker and WorkingCopyHistoryTracker
 * as real Workbench contributions purely as an import-time side effect,
 * regardless of the factory's `storage` option. The history tracker calls
 * IFileService.cloneFile() on every save to snapshot local history, which
 * Plain's own files-service patch always rejects for plain-workspace
 * resources (clone is unsupported), producing an unhandled rejection on every
 * save. IWorkingCopyBackupService therefore also stays untouched here: it
 * keeps resolving to the existing missing-services.js no-op stub; the real
 * Rust-backed backup service lands in a later slice (S4/S5).
 */
export function createServiceOverrides() {
	return {
		...getConfigurationServiceOverride(),
		...getFilesServiceOverride(),
		...getModelServiceOverride(),
		...getWorkbenchServiceOverride(),
		...getNotificationServiceOverride(),
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
		[IWorkingCopyService.toString()]: new SyncDescriptor(
			WorkingCopyService,
			[],
			false,
		),
		[IWorkingCopyEditorService.toString()]: new SyncDescriptor(
			WorkingCopyEditorService,
			[],
			false,
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
