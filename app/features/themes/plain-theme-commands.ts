import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import type { IQuickPickItem } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";

import type { PlainBridge } from "../../platform/tauri";
import {
	importThemePackageViaDirectory,
	importThemePackageViaVsix,
	removeImportedThemePackage,
	themeCommandErrorMessage,
	type PlainThemeRegistryStore,
} from "./plain-theme-import-coordinator";

export const IMPORT_VSIX_COMMAND_ID = "plain.theme.importVsix";
export const IMPORT_DIRECTORY_COMMAND_ID = "plain.theme.importDirectory";
export const REMOVE_COMMAND_ID = "plain.theme.remove";

interface PackageQuickPickItem extends IQuickPickItem {
	readonly packageId: string;
}

async function runRemoveQuickPick(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
	quickInputService: IQuickInputService,
	dialogService: IDialogService,
	notificationService: INotificationService,
	themeService: IWorkbenchThemeService,
	reRegisterPicker: () => void,
): Promise<void> {
	const packageIds = store.importedPackageIds();
	if (packageIds.length === 0) {
		notificationService.info(
			"Plain: there are no imported theme packages to remove.",
		);
		return;
	}
	const items: PackageQuickPickItem[] = packageIds.map((packageId) => ({
		label: packageId,
		packageId,
	}));
	const picked = await quickInputService.pick(items, {
		placeHolder: "Select an imported theme package to remove",
	});
	if (picked === undefined) {
		return;
	}
	const confirmation = await dialogService.confirm({
		message: `Remove imported theme package "${picked.packageId}"?`,
		detail:
			"This cannot be undone. If a theme from this package is currently active, Plain will switch back to Dark Modern.",
		primaryButton: "Remove",
	});
	if (!confirmation.confirmed) {
		return;
	}
	try {
		await removeImportedThemePackage(
			bridge,
			store,
			themeService,
			picked.packageId,
		);
		reRegisterPicker();
		notificationService.info(
			`Plain: removed theme package "${picked.packageId}".`,
		);
	} catch (error) {
		notificationService.error(themeCommandErrorMessage(error));
	}
}

export interface PlainThemeCommandsRegistration {
	dispose(): void;
}

/**
 * Registers `F050` S3's three new, Plain-authored commands (never a vendor
 * id takeover, unlike `plain-theme-picker.ts`'s `workbench.action.
 * selectTheme`) and their Command Palette entries. The file dialog behind
 * the two import commands only ever opens from a user explicitly invoking
 * one of these — never from startup or any other implicit path.
 */
export function registerPlainThemeCommands(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
	reRegisterPicker: () => void,
): PlainThemeCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			IMPORT_VSIX_COMMAND_ID,
			async (accessor) => {
				const notificationService = accessor.get(INotificationService);
				try {
					const result = await importThemePackageViaVsix(bridge, store);
					if (result.status === "imported") {
						reRegisterPicker();
						notificationService.info(
							`Plain: imported color theme package "${result.package.id}".`,
						);
					}
				} catch (error) {
					notificationService.error(themeCommandErrorMessage(error));
				}
			},
		),
		CommandsRegistry.registerCommand(
			IMPORT_DIRECTORY_COMMAND_ID,
			async (accessor) => {
				const notificationService = accessor.get(INotificationService);
				try {
					const result = await importThemePackageViaDirectory(bridge, store);
					if (result.status === "imported") {
						reRegisterPicker();
						notificationService.info(
							`Plain: imported color theme package "${result.package.id}".`,
						);
					}
				} catch (error) {
					notificationService.error(themeCommandErrorMessage(error));
				}
			},
		),
		CommandsRegistry.registerCommand(REMOVE_COMMAND_ID, async (accessor) => {
			await runRemoveQuickPick(
				bridge,
				store,
				accessor.get(IQuickInputService),
				accessor.get(IDialogService),
				accessor.get(INotificationService),
				accessor.get(IWorkbenchThemeService),
				reRegisterPicker,
			);
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: IMPORT_VSIX_COMMAND_ID,
				title: "Import Color Theme (VSIX)...",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: IMPORT_DIRECTORY_COMMAND_ID,
				title: "Import Color Theme (Folder)...",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REMOVE_COMMAND_ID,
				title: "Remove Imported Color Theme...",
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
