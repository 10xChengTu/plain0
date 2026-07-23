import {
	ConfigurationScope,
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
 * Deliberately not reproduced: the search view's actions/menus/keybindings/
 * replace UI (Plain's own `PlainSearchView` implements replace directly —
 * see `plain-replace-coordinator.ts`) and the `%`-prefixed
 * `TextSearchQuickAccess` quick-open provider. Not required for this
 * slice's acceptance; deferred rather than hand-duplicated ahead of need.
 *
 * Of the ~30 upstream `search.*` configuration keys, F040 S5 hand-registers
 * exactly two below (`search.exclude`, `search.followSymlinks`) — see that
 * registration's own doc comment for why those two and not the rest.
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

/**
 * Minimal, hand-written subset of the `search.*` configuration schema —
 * exactly the two keys whose absence would make Plain's config surface
 * actively misleading, not the ~30 upstream `search.contribution.js`
 * registers wholesale (still not imported, per this file's own doc comment
 * above).
 *
 * `search.exclude`: without a registered schema for this key,
 * `QueryBuilder.getExcludes()` (see
 * docs/research/2026-07-23-search-quickopen.md's queryBuilder findings)
 * only ever sees `files.exclude` — already registered with real defaults
 * by the existing Explorer service override import chain
 * (`files.contribution._configuration.js`, confirmed at runtime: `.git`,
 * `.svn`, `.hg`, `.DS_Store`, `Thumbs.db`) — and never
 * `search.exclude`'s own upstream defaults (`node_modules`,
 * `bower_components`, `*.code-search`). Every search would therefore
 * silently include `node_modules` unless a workspace's own `.gitignore`
 * happened to cover it. Registering the exact upstream default here closes
 * that gap through the already-working `excludePattern` plumbing (see
 * `plain-search-service.ts`'s `collectExcludeGlobs`) — no new Rust or
 * bridge surface, no change to `search::file_search`/`search::text_search`.
 *
 * `search.followSymlinks`: registered as a plain boolean purely so that
 * `app/main.ts`'s `configurationDefaults: { "search.followSymlinks": false
 * }` is a *real* override rather than inert decoration. Without a
 * registered schema, `DefaultConfiguration.resetConfigurationModel` (in
 * `@codingame/monaco-vscode-configuration-service-override`) only ever
 * visits `Registry.as(Extensions.Configuration).getConfigurationProperties()`
 * keys when rebuilding its model; a `configurationDefaults` entry for an
 * unregistered key is accepted by `registerDefaultConfigurations` but then
 * never surfaces through `getValue()`, silently. Rust's search domain
 * never follows symlinks out of an authorized root regardless of this
 * setting's value — the schema exists so the setting, if ever inspected,
 * says so honestly instead of either not existing or silently keeping
 * upstream's `true` claim.
 *
 * Deliberately NOT registered: `search.useIgnoreFiles`,
 * `search.useGlobalIgnoreFiles`, `search.useParentIgnoreFiles`. Rust's
 * `search::file_search`/`search::text_search` hardcode "always honor
 * `.gitignore`, never global/parent ignore files" (F040 S2 decision) and
 * read no such flag from any request DTO — registering a schema for a
 * setting neither side consumes would make the toggle *look* functional
 * while silently doing nothing, which is the opposite of this
 * registration's purpose.
 */
Registry.as<IConfigurationRegistry>(
	ConfigurationExtensions.Configuration,
).registerConfiguration({
	id: "search",
	order: 13,
	title: "Search",
	type: "object",
	properties: {
		"search.exclude": {
			type: "object",
			default: {
				"**/node_modules": true,
				"**/bower_components": true,
				"**/*.code-search": true,
			},
			scope: ConfigurationScope.RESOURCE,
			description:
				"Glob patterns excluded from Quick Open file search and workspace text search. Inherits files.exclude.",
		},
		"search.followSymlinks": {
			type: "boolean",
			default: true,
			description:
				"Controls whether to follow symlinks while searching. Plain's search never follows symlinks out of a workspace root regardless of this value.",
		},
	},
});
