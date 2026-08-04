import {
	KeyCode,
	KeyMod,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	KeybindingWeight,
	KeybindingsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry";
import { VIEW_ID } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import { PlainSearchView } from "./plain-search-view";

/**
 * Plain's own commands — never a vendor `workbench.action.search.*`/`workbench.
 * view.search` id takeover. `search-contribution.ts` registers the Search
 * view container with `doNotRegisterOpenCommand: true` specifically so the
 * vendor's own generic "open Search view" command never appears; these two
 * commands are Plain's deliberate replacement, each opening the view *and*
 * focusing one specific input (see `search-contribution.ts`'s own module doc
 * comment for the full excluded-surface audit this view's registration
 * already passed).
 *
 * `docs/research/2026-08-04-complete-search.md` §"架构裁定 1" froze this
 * exact pair — `Cmd/Ctrl+Shift+F` for Find, `Cmd/Ctrl+Shift+H` for Replace,
 * matching VS Code's own real command titles ("Search: Find in Files...",
 * "Search: Replace in Files...") closely enough to be discoverable, while
 * keeping the *id* in Plain's own `plain.*` namespace like every other
 * hand-registered command in this repository (`plain.terminal.*`,
 * `plain.debug.*`, `plain.theme.*`, …). The `%`-prefixed
 * `TextSearchQuickAccess` quick-open provider is explicitly *not* added — see
 * the same research doc section — so these two commands are the entire F200
 * S1 entry surface.
 */
export const FIND_IN_FILES_COMMAND_ID = "plain.search.findInFiles";
export const REPLACE_IN_FILES_COMMAND_ID = "plain.search.replaceInFiles";

export interface PlainSearchCommandsRegistration {
	dispose(): void;
}

/**
 * Shared open+focus routine for both commands. `IViewsService.openView` is
 * idempotent — reveals (opening the sidebar/creating the view if needed) on
 * first use, and simply resolves to the already-live instance on any
 * subsequent call — so this never resets an in-flight query or the rendered
 * result set; it only ever changes which single input element has focus and
 * a full text selection, exactly like VS Code's own `Cmd/Ctrl+F`/`Cmd/Ctrl+H`
 * (a repeat press re-selects the existing query text instead of doing
 * nothing). See `PlainSearchView.focusSearchInput`/`focusReplaceInput`'s own
 * doc comments for the actual DOM-level focus+select-all behavior.
 */
async function openAndFocusSearchView(
	viewsService: IViewsService,
	target: "search" | "replace",
): Promise<void> {
	const view = await viewsService.openView<PlainSearchView>(VIEW_ID, true);
	if (target === "search") {
		view?.focusSearchInput();
	} else {
		view?.focusReplaceInput();
	}
}

export function registerPlainSearchCommands(): PlainSearchCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(FIND_IN_FILES_COMMAND_ID, (accessor) => {
			void openAndFocusSearchView(accessor.get(IViewsService), "search");
		}),
		CommandsRegistry.registerCommand(
			REPLACE_IN_FILES_COMMAND_ID,
			(accessor) => {
				void openAndFocusSearchView(accessor.get(IViewsService), "replace");
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: FIND_IN_FILES_COMMAND_ID,
				title: "Find in Files",
				category: "Search",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REPLACE_IN_FILES_COMMAND_ID,
				title: "Replace in Files",
				category: "Search",
			},
		}),
		KeybindingsRegistry.registerKeybindingRule({
			id: FIND_IN_FILES_COMMAND_ID,
			weight: KeybindingWeight.WorkbenchContrib + 1,
			when: undefined,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
		}),
		KeybindingsRegistry.registerKeybindingRule({
			id: REPLACE_IN_FILES_COMMAND_ID,
			weight: KeybindingWeight.WorkbenchContrib + 1,
			when: undefined,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		}),
	];
	return {
		dispose() {
			for (const disposable of disposables.reverse()) {
				disposable.dispose();
			}
		},
	};
}
