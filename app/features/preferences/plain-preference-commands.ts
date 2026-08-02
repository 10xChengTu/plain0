import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";

import { userDataUri } from "./user-data-file-system-provider";

export const OPEN_LOCAL_SETTINGS_COMMAND_ID =
	"plain.preferences.openLocalSettings";
export const OPEN_LOCAL_KEYBINDINGS_COMMAND_ID =
	"plain.preferences.openLocalKeybindings";

export interface PlainPreferenceCommandsRegistration {
	dispose(): void;
}

/**
 * Plain intentionally exposes raw, local JSONC resources rather than the
 * broad upstream Preferences contribution. Both URIs are backed by the exact
 * Rust-owned provider allowlist; no native path, profile, task, snippet or
 * sync surface is made reachable by these commands.
 */
export function registerPlainPreferenceCommands(): PlainPreferenceCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			OPEN_LOCAL_SETTINGS_COMMAND_ID,
			(accessor) =>
				accessor.get(IEditorService).openEditor({
					resource: userDataUri("settings"),
					options: { pinned: true },
				}),
		),
		CommandsRegistry.registerCommand(
			OPEN_LOCAL_KEYBINDINGS_COMMAND_ID,
			(accessor) =>
				accessor.get(IEditorService).openEditor({
					resource: userDataUri("keybindings"),
					options: { pinned: true },
				}),
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: OPEN_LOCAL_SETTINGS_COMMAND_ID,
				title: "Open Local Settings (JSON)",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: OPEN_LOCAL_KEYBINDINGS_COMMAND_ID,
				title: "Open Local Keyboard Shortcuts (JSON)",
				category: "Plain",
			},
		}),
	];
	return {
		dispose() {
			for (const disposable of disposables) disposable.dispose();
		},
	};
}
