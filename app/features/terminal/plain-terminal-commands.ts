import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import { PlainTerminalView } from "./plain-terminal-view";
import { TERMINAL_VIEW_ID } from "./terminal-contribution";

/** Plain's own commands — never a vendor id takeover (there is no vendor
 * `workbench.action.terminal.*` registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-terminal-service-override` is never imported —
 * see `plain-terminal-view.ts`'s module doc comment). */
export const CREATE_TERMINAL_COMMAND_ID = "plain.terminal.create";
export const KILL_TERMINAL_COMMAND_ID = "plain.terminal.kill";
export const SPLIT_TERMINAL_RIGHT_COMMAND_ID = "plain.terminal.splitRight";
export const SPLIT_TERMINAL_DOWN_COMMAND_ID = "plain.terminal.splitDown";

export interface PlainTerminalCommandsRegistration {
	dispose(): void;
}

/**
 * Registers this domain's four commands (F070 "多 tab/split/scrollback"
 * slice extends the single prior `Plain: Create Terminal` with three more):
 *
 * - `Plain: Create Terminal` reveals (opening the Panel if hidden) this
 *   view via `IViewsService.openView`, then — every time it runs, whether
 *   the view was just created or was already open — calls
 *   `PlainTerminalView.openNewTab()`. This is deliberately unconditional:
 *   there is no other path that ever opens this view, so "open the view"
 *   and "add one tab to it" happening together on every invocation is what
 *   makes running this command twice produce two tabs rather than one
 *   (compare the prior slice, where "create" and "reveal" were the same
 *   single-tab action).
 * - `Plain: Kill Terminal` closes the *active* tab of the terminal view, if
 *   it is currently open — this uses `IViewsService.getViewWithId` (a
 *   synchronous lookup, unlike `openView`) rather than opening/creating the
 *   view: killing a terminal that is not even open has nothing to do.
 * - `Plain: Split Terminal Right`/`Plain: Split Terminal Down` split the
 *   active tab (same `getViewWithId` lookup — see `TerminalTabsModel`'s own
 *   doc for the two-panes-per-tab cap and the row/column orientation
 *   meaning).
 *
 * None of these four commands have any IPC side effect of their own — the
 * actual trust check / session start (or kill) happens inside the view/pane
 * itself, exactly as the prior slice's single `Create Terminal` command
 * already established.
 */
export function registerPlainTerminalCommands(): PlainTerminalCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			CREATE_TERMINAL_COMMAND_ID,
			async (accessor) => {
				const viewsService = accessor.get(IViewsService);
				const view = await viewsService.openView<PlainTerminalView>(
					TERMINAL_VIEW_ID,
					true,
				);
				view?.openNewTab();
			},
		),
		CommandsRegistry.registerCommand(KILL_TERMINAL_COMMAND_ID, (accessor) => {
			const viewsService = accessor.get(IViewsService);
			const view =
				viewsService.getViewWithId<PlainTerminalView>(TERMINAL_VIEW_ID);
			view?.closeActiveTab();
		}),
		CommandsRegistry.registerCommand(
			SPLIT_TERMINAL_RIGHT_COMMAND_ID,
			(accessor) => {
				const viewsService = accessor.get(IViewsService);
				const view =
					viewsService.getViewWithId<PlainTerminalView>(TERMINAL_VIEW_ID);
				view?.splitActiveTab("row");
			},
		),
		CommandsRegistry.registerCommand(
			SPLIT_TERMINAL_DOWN_COMMAND_ID,
			(accessor) => {
				const viewsService = accessor.get(IViewsService);
				const view =
					viewsService.getViewWithId<PlainTerminalView>(TERMINAL_VIEW_ID);
				view?.splitActiveTab("column");
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: CREATE_TERMINAL_COMMAND_ID,
				title: "Create Terminal",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: KILL_TERMINAL_COMMAND_ID,
				title: "Kill Terminal",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: SPLIT_TERMINAL_RIGHT_COMMAND_ID,
				title: "Split Terminal Right",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: SPLIT_TERMINAL_DOWN_COMMAND_ID,
				title: "Split Terminal Down",
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
