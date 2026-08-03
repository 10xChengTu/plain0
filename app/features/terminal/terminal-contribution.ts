import { Codicon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/codicons";
import {
	Extensions as ConfigurationExtensions,
	type IConfigurationRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configurationRegistry";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { Registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform";
import { ViewPaneContainer } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer";
import {
	Extensions,
	ViewContainerLocation,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import {
	TERMINAL_DEFAULT_CWD_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
} from "./plain-terminal-defaults";
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
 * Plain at all) additionally wires xterm.js, shell integration and task
 * integration this domain does not build at all.
 *
 * Multiple tabs and splits (F070 "多 tab/split/scrollback + 生命周期" slice)
 * are *not* multiple registered views/view-containers — this remains
 * exactly one view container and one view pane, which self-manages a small
 * tab strip internally (see `plain-terminal-view.ts`'s own module doc for
 * why: registering N views for N open terminals has no supported "do this
 * at runtime" upstream API and was rejected).
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

/**
 * `F190` S2 "future-tab defaults UI": the configuration schema backing
 * `PlainTerminalView`'s profile/cwd controls — the same hand-written,
 * minimal-subset precedent `search-contribution.ts` established for
 * `search.exclude`/`search.followSymlinks` (this is not an upstream
 * `terminal.contribution.js` key; Plain's terminal domain has no vendor
 * schema to subset from at all, see `plain-terminal-view.ts`'s own module
 * doc for why nothing from `@codingame/monaco-vscode-terminal-service-
 * override` is ever imported).
 *
 * Both keys are **future-tab defaults only** — `PlainTerminalView` reads
 * them exactly once per new tab/split (`#resolveFutureTabDefaults`) and
 * freezes the result onto that tab; changing either value here never
 * redirects an already-running tab/pane (see
 * `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §1").
 *
 * `plain.terminal.defaultProfile`'s default mirrors
 * `src-tauri/src/terminal/shell.rs`'s `SYSTEM_DEFAULT_PROFILE_ID` — the one
 * profile id every `terminal_profiles` snapshot always contains — so an
 * unconfigured installation behaves exactly as it did before this slice
 * (every existing terminal Browser test's `terminal_start` assertion of
 * `profileId: "systemDefault"` keeps holding). `plain.terminal.cwd` defaults
 * to the empty string, which `plain-terminal-defaults.ts`'s
 * `validateFutureTabCwdInput` treats identically to `cwd: null` (start in
 * the selected root itself) — the same pre-`F190`-S2 behavior.
 */
// Computed property keys (not repeated literals) so this schema can never
// silently drift from `plain-terminal-defaults.ts`'s own exported
// `TERMINAL_DEFAULT_PROFILE_CONFIG_KEY`/`TERMINAL_DEFAULT_CWD_CONFIG_KEY` —
// the same constants `PlainTerminalView` reads/writes through
// `IConfigurationService`.
Registry.as<IConfigurationRegistry>(
	ConfigurationExtensions.Configuration,
).registerConfiguration({
	id: "plain.terminal",
	order: 14,
	title: "Plain Terminal",
	type: "object",
	properties: {
		[TERMINAL_DEFAULT_PROFILE_CONFIG_KEY]: {
			type: "string",
			default: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
			description:
				"The terminal profile new terminal tabs start with. Only affects tabs opened after this is changed; already-running tabs keep whatever profile they started with.",
		},
		[TERMINAL_DEFAULT_CWD_CONFIG_KEY]: {
			type: "string",
			default: "",
			description:
				'A workspace-relative starting directory for new terminal tabs (empty, or ".", starts in the selected working folder itself). Must not be an absolute path or use ".." to leave the workspace root. Only affects tabs opened after this is changed.',
		},
	},
});
