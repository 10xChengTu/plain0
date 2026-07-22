import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import { IOpenerService } from "@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import {
	ViewPane,
	type IViewPaneOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane";
import { IViewDescriptorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service";
import { QueryType } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";

/**
 * Plain's own, hand-written Search view pane — deliberately NOT the vendor
 * `SearchView` shipped by @codingame/monaco-vscode-search-service-override
 * (re-exported from @codingame/monaco-vscode-api). That class was tried
 * first and rejected after a real Chromium bootstrap run reproduced an
 * excluded-surface violation: `SearchView` imports `NotebookEditor`
 * (`vscode/vs/workbench/contrib/notebook/browser/notebookEditor.js`, for an
 * `instanceof` check against notebook cell editors that Plain never
 * produces), and loading that module alone — regardless of whether the
 * class is ever instantiated — unconditionally executes
 * `CommandsRegistry.registerCommand` for `_notebook.selectKernel` (via
 * notebookEditor.js's own `coreActions.js` dependency) and for
 * `workbench.extensions.action.showExtensionsForLanguage` /
 * `showExtensionsWithIds` (via notebookEditor.js's `InstallRecommended
 * ExtensionAction` import from `contrib/extensions/browser/
 * extensionsActions.js`). All three match app/excluded-surface-policy.ts's
 * "notebooks, tasks or testing" and "extensions, gallery or marketplace"
 * categories and threw `PLAIN_EXCLUDED_SURFACE_GUARD_V1` out of
 * `enforceExcludedWorkbenchSurfaces()` during `app/main.ts` bootstrap,
 * breaking every existing Browser E2E scenario that reaches a successful
 * `initialize()` — confirmed by running the existing suite, not merely
 * inferred from source. AGENTS.md forbids restoring notebook/testing
 * surfaces and Marketplace execution capability (product boundaries 3 and
 * 5), and the reachable-command check has no per-file exemption mechanism
 * to carve out (unlike the IFileService token check in
 * validateWorkspaceProviderRetrievalBoundary, which only needed one typed
 * constructor parameter, this is two live CommandsRegistry entries plus one
 * notebook command baked into a single, monolithic, ~2000-line vendor
 * source file with no finer-grained submodule to import instead).
 *
 * This view pane is therefore a minimal, from-scratch replacement: a single
 * text input wired directly to `ISearchService.textSearch()` against the
 * currently open workspace folders, and a status line reporting the result
 * count. For this slice `PlainSearchService` always resolves to an empty
 * result set (see ./plain-search-service.ts), so the only acceptance this
 * needs to satisfy is "reachable, stable, empty, and free of pageerror";
 * richer results rendering, filters, and replace UI are explicit follow-on
 * work once F040 S2/S3 give the provider something real to return.
 */
export class PlainSearchView extends ViewPane {
	static readonly ID = "plain.workbench.view.search";

	constructor(
		options: IViewPaneOptions,
		keybindingService: IKeybindingService,
		contextMenuService: IContextMenuService,
		configurationService: IConfigurationService,
		contextKeyService: IContextKeyService,
		viewDescriptorService: IViewDescriptorService,
		instantiationService: IInstantiationService,
		openerService: IOpenerService,
		themeService: IThemeService,
		hoverService: IHoverService,
		private readonly searchService: ISearchService,
		private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add("plain-search-view-body");

		const input = document.createElement("input");
		input.type = "text";
		input.className = "plain-search-view-input";
		input.placeholder = "Search";
		input.setAttribute("aria-label", "Search");

		const status = document.createElement("div");
		status.className = "plain-search-view-status";
		status.setAttribute("role", "status");

		container.append(input, status);

		let disposed = false;
		this._register(toDisposable(() => (disposed = true)));

		let debounceHandle: ReturnType<typeof setTimeout> | undefined;
		this._register(
			toDisposable(() => {
				if (debounceHandle !== undefined) {
					clearTimeout(debounceHandle);
				}
			}),
		);
		this._register(
			addDisposableListener(input, "input", () => {
				if (debounceHandle !== undefined) {
					clearTimeout(debounceHandle);
				}
				const pattern = input.value;
				debounceHandle = setTimeout(() => {
					void this.runSearch(pattern, status, () => disposed);
				}, 200);
			}),
		);
	}

	private async runSearch(
		pattern: string,
		status: HTMLElement,
		isDisposed: () => boolean,
	): Promise<void> {
		if (pattern.length === 0) {
			status.textContent = "";
			return;
		}
		const folderQueries = this.workspaceContextService
			.getWorkspace()
			.folders.map((folder) => ({ folder: folder.uri }));
		const complete = await this.searchService.textSearch({
			type: QueryType.Text,
			folderQueries,
			contentPattern: { pattern },
		});
		if (isDisposed()) {
			return;
		}
		status.textContent =
			complete.results.length === 0
				? "No results found."
				: `${complete.results.length} results`;
	}
}

Object.freeze(PlainSearchView.prototype);

IKeybindingService(PlainSearchView, undefined, 1);
IContextMenuService(PlainSearchView, undefined, 2);
IConfigurationService(PlainSearchView, undefined, 3);
IContextKeyService(PlainSearchView, undefined, 4);
IViewDescriptorService(PlainSearchView, undefined, 5);
IInstantiationService(PlainSearchView, undefined, 6);
IOpenerService(PlainSearchView, undefined, 7);
IThemeService(PlainSearchView, undefined, 8);
IHoverService(PlainSearchView, undefined, 9);
ISearchService(PlainSearchView, undefined, 10);
IWorkspaceContextService(PlainSearchView, undefined, 11);
