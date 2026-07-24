import { Codicon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/codicons";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { Registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform";
import { ViewPaneContainer } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer";
import {
	Extensions,
	ViewContainerLocation,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import { PlainTerminalView } from "./plain-terminal-view";

/** `Plain: Create Terminal` reveals this view (and, transitively, its
 * container) via `IViewsService.openView` — see `plain-terminal-commands.ts`. */
export const TERMINAL_VIEW_CONTAINER_ID =
	"plain.workbench.viewContainer.terminal";
export const TERMINAL_VIEW_ID = PlainTerminalView.ID;

/**
 * Registers exactly one Panel-location view container and its one view pane
 * — Plain's own `PlainTerminalView` (see that file's own module doc comment
 * for why this is a from-scratch `ViewPane`, never the vendor terminal
 * override/xterm.js). This is a from-scratch registration, not an import of
 * any upstream `terminal.contribution.js` — that file (part of
 * `@codingame/monaco-vscode-terminal-service-override`, never imported by
 * Plain at all) additionally wires xterm.js, shell integration, task
 * integration, and tab/split UI this slice deliberately does not build yet
 * (see `docs/research/2026-07-24-libghostty-terminal.md`'s slice list: "多
 * tab/split + 生命周期 + scrollback" is the next slice).
 *
 * `doNotRegisterOpenCommand: true` mirrors `search-contribution.ts`'s own
 * choice: Plain registers its own `Plain: Create Terminal` command instead
 * (see `plain-terminal-commands.ts`) rather than accepting whatever
 * auto-generated open-command `registerViewContainer` would otherwise add.
 */
const terminalViewContainer = Registry.as<IViewContainersRegistry>(
	Extensions.ViewContainersRegistry,
).registerViewContainer(
	{
		id: TERMINAL_VIEW_CONTAINER_ID,
		title: { value: "Terminal", original: "Terminal" },
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			TERMINAL_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: true },
		]),
		hideIfEmpty: true,
		icon: Codicon.terminal,
		order: 2,
	},
	ViewContainerLocation.Panel,
	{ doNotRegisterOpenCommand: true },
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(
	[
		{
			id: TERMINAL_VIEW_ID,
			containerIcon: Codicon.terminal,
			name: { value: "Terminal", original: "Terminal" },
			ctorDescriptor: new SyncDescriptor(PlainTerminalView),
			canToggleVisibility: false,
			canMoveView: true,
		},
	],
	terminalViewContainer,
);
