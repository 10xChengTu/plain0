import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import { SCM_VIEW_ID } from "./scm-contribution";
import { PlainScmView } from "./plain-scm-view";

/** Plain's own command — never a vendor `workbench.scm.*`/`git.*` id
 * takeover (there is no such id registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-scm-service-override`'s own `scm.contribution.js`
 * is never imported — see `plain-scm-view.ts`'s module doc comment). */
export const REFRESH_SCM_COMMAND_ID = "plain.scm.refresh";

export interface PlainScmCommandsRegistration {
	dispose(): void;
}

/**
 * `Plain: Refresh Source Control` opens (revealing the Sidebar if hidden)
 * `PlainScmView` and re-runs its own discovery/refresh — the "手动刷新"
 * half of `F080` S2's refresh story (see `plain-scm-view.ts`'s own doc
 * comment for the other half: a best-effort re-refresh on workspace
 * file-change notifications, wired from `app/main.ts`). Useful right after
 * granting workspace trust from the terminal panel (this view never prompts
 * for trust itself) or after a `.git` operation performed outside Plain
 * entirely (a separate terminal, another app).
 */
export function registerPlainScmCommands(): PlainScmCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			REFRESH_SCM_COMMAND_ID,
			async (accessor) => {
				const viewsService = accessor.get(IViewsService);
				const view = await viewsService.openView<PlainScmView>(
					SCM_VIEW_ID,
					true,
				);
				await view?.refresh();
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REFRESH_SCM_COMMAND_ID,
				title: "Refresh Source Control",
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
