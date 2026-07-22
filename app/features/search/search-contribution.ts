import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { Registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform";
import { ViewPaneContainer } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer";
import {
	Extensions,
	ViewContainerLocation,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";
import { searchViewIcon } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/search/browser/searchIcons";
import {
	VIEW_ID,
	VIEWLET_ID,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";

import "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/search/browser/searchQuickAccess.contribution";

import { PlainSearchView } from "./plain-search-view";

/**
 * Registers exactly the Search view container and its one view pane, plus
 * (via the bare import above) the empty-prefix `AnythingQuickAccessProvider`
 * (Cmd+P), the `#` `SymbolsQuickAccessProvider`, and the
 * `workbench.action.showAllSymbols` command it brings with it.
 *
 * This is a hand-reproduction of a *subset* of what
 * `@codingame/monaco-vscode-search-service-override`'s own
 * `search.contribution.js` registers upstream, not an import of that file.
 * `search.contribution.js` unconditionally imports `searchChatContext.js`
 * and, at module scope, does
 * `registerWorkbenchContribution2(SearchChatContextContribution.ID,
 * SearchChatContextContribution, WorkbenchPhase.AfterRestored)` — a real,
 * eagerly-instantiated Workbench contribution (not a lazily-constructed
 * quick-access/view ctor) that wires "Search Results" / "Files & Folders" /
 * "Symbols" pickers into `IChatContextPickService`, i.e. a Chat/AI context
 * attachment surface. AGENTS.md forbids adding AI/Chat/Agent/MCP surfaces
 * (see the repository root AGENTS.md, "不可破坏的产品边界" item 1), and the
 * existing runtime excluded-surface guard
 * (`app/excluded-surface-policy.ts`/`app/excluded-surfaces.ts`) cannot catch
 * this: it only audits `commandIds`/`viewContainerIds`/`viewIds`, not the ids
 * passed to `registerWorkbenchContribution2`. Even though
 * `IChatContextPickService` currently resolves to a no-op
 * `missing-services.js` stub (`registerChatContextItem` returns
 * `Disposable.None`), instantiating that contribution class would newly make
 * Chat-context-attachment code a real, executing part of every window's
 * bootstrap — a category change from "unreachable bundle debt" (the
 * documented, already-accepted state of the 203 excluded-domain source-map
 * files) to "reachable, running Chat plumbing" — so `search.contribution.js`
 * is not imported here, in whole or via a dynamic re-export.
 *
 * The view registered below uses Plain's own `PlainSearchView` (see
 * `./plain-search-view.ts`), not the vendor `SearchView`. That file's own
 * doc comment records a *second*, independently confirmed excluded-surface
 * violation found only by actually booting the real Workbench: `SearchView`
 * imports `NotebookEditor`, whose own module graph unconditionally registers
 * a notebook command and two Marketplace/extensions commands as an
 * import-time side effect, tripping
 * `PLAIN_EXCLUDED_SURFACE_GUARD_V1` on every bootstrap. `searchQuickAccess.
 * contribution.js` (imported above for Cmd+P) was independently re-audited
 * against the same failure mode and does not import `SearchView` or
 * `NotebookEditor` anywhere in its own graph — only two `Quickaccess`
 * provider registrations and one `registerAction2` command
 * (`workbench.action.showAllSymbols`, via its own `searchActionsSymbol.js`
 * dependency), none of which touch Chat, notebook, extensions, or any other
 * excluded domain; the real bootstrap run that caught the `SearchView` issue
 * is the same run that confirms Cmd+P itself stays clean.
 *
 * Deliberately not reproduced in this slice: the ~30 `search.*`
 * configuration keys, the search view's actions/menus/keybindings/replace
 * UI, and the `%`-prefixed `TextSearchQuickAccess` quick-open provider. None
 * of those are required for this slice's acceptance (the Search view is
 * reachable via the Activity Bar and stays stable with empty results); they
 * are deferred to later F040 slices rather than hand-duplicated ahead of
 * need.
 */
const searchViewContainer = Registry.as<IViewContainersRegistry>(
	Extensions.ViewContainersRegistry,
).registerViewContainer(
	{
		id: VIEWLET_ID,
		title: { value: "Search", original: "Search" },
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			VIEWLET_ID,
			{ mergeViewWithContainerWhenSingleView: true },
		]),
		hideIfEmpty: true,
		icon: searchViewIcon,
		order: 1,
	},
	ViewContainerLocation.Sidebar,
	{ doNotRegisterOpenCommand: true },
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(
	[
		{
			id: VIEW_ID,
			containerIcon: searchViewIcon,
			name: { value: "Search", original: "Search" },
			ctorDescriptor: new SyncDescriptor(PlainSearchView),
			canToggleVisibility: false,
			canMoveView: true,
		},
	],
	searchViewContainer,
);
