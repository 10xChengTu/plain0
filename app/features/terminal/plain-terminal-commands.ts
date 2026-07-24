import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import { TERMINAL_VIEW_ID } from "./terminal-contribution";

/** Plain's own command — never a vendor id takeover (there is no vendor
 * `workbench.action.terminal.new` registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-terminal-service-override` is never imported —
 * see `plain-terminal-view.ts`'s module doc comment). */
export const CREATE_TERMINAL_COMMAND_ID = "plain.terminal.create";

export interface PlainTerminalCommandsRegistration {
	dispose(): void;
}

/**
 * Registers `Plain: Create Terminal`, which reveals (opening the Panel if
 * it is currently hidden) and focuses `PlainTerminalView` via
 * `IViewsService.openView` — the one view this slice has, so "create a
 * terminal" and "show the terminal view" are the same action for now (see
 * `terminal-contribution.ts`'s own doc comment: multi-tab is a later
 * slice). The actual trust check / session start happens inside the view
 * itself once it becomes visible (`PlainTerminalView.layoutBody`), not
 * here — this command has no IPC side effect of its own.
 */
export function registerPlainTerminalCommands(): PlainTerminalCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			CREATE_TERMINAL_COMMAND_ID,
			async (accessor) => {
				const viewsService = accessor.get(IViewsService);
				await viewsService.openView(TERMINAL_VIEW_ID, true);
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: CREATE_TERMINAL_COMMAND_ID,
				title: "Create Terminal",
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
