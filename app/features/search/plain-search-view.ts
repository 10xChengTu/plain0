import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { CancellationTokenSource } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
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
import {
	isFileMatch,
	QueryType,
	resultIsMatch,
	type IFileMatch,
	type ISearchProgressItem,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";

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
 * `CommandsRegistry.registerCommand` for `_notebook.selectKernel`, and for
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
 * text input debounced against `ISearchService.textSearch()`, streaming
 * results grouped by file as `PlainSearchResultProvider` delivers them via
 * `onProgress` (F040 S3 — see ./plain-search-service.ts and
 * src-tauri/src/search/text_search.rs for the streaming poll/wake protocol
 * underneath). A new query cancels whatever query is still in flight;
 * clicking a match opens the file and selects the matched range. UI only
 * needs to be functionally correct here — no attempt is made to visually
 * match upstream's `SearchView` (result tree chrome, sort/filter actions,
 * replace UI); those stay explicit follow-on work.
 */
export class PlainSearchView extends ViewPane {
	static readonly ID = "plain.workbench.view.search";

	/** Guards a stale search's progress/completion callbacks from touching the
	 * DOM after a newer query (or view disposal) has superseded it. */
	#generation = 0;
	#tokenSource: CancellationTokenSource | undefined;

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
		private readonly editorService: IEditorService,
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

		const regexLabel = document.createElement("label");
		regexLabel.className = "plain-search-view-regex-label";
		const regexToggle = document.createElement("input");
		regexToggle.type = "checkbox";
		regexToggle.className = "plain-search-view-regex-toggle";
		regexToggle.setAttribute("aria-label", "Use Regular Expression");
		regexLabel.append(
			regexToggle,
			document.createTextNode("Use Regular Expression"),
		);

		const status = document.createElement("div");
		status.className = "plain-search-view-status";
		status.setAttribute("role", "status");

		const messages = document.createElement("div");
		messages.className = "plain-search-view-messages";
		messages.setAttribute("role", "status");

		const results = document.createElement("div");
		results.className = "plain-search-view-results";

		container.append(input, regexLabel, status, messages, results);

		this._register(
			toDisposable(() => {
				this.#generation += 1;
				this.#tokenSource?.cancel();
				this.#tokenSource?.dispose();
				this.#tokenSource = undefined;
			}),
		);

		let debounceHandle: ReturnType<typeof setTimeout> | undefined;
		this._register(
			toDisposable(() => {
				if (debounceHandle !== undefined) {
					clearTimeout(debounceHandle);
				}
			}),
		);
		const scheduleSearch = (): void => {
			if (debounceHandle !== undefined) {
				clearTimeout(debounceHandle);
			}
			const pattern = input.value;
			const isRegExp = regexToggle.checked;
			debounceHandle = setTimeout(() => {
				void this.runSearch(pattern, isRegExp, status, messages, results);
			}, 200);
		};
		this._register(addDisposableListener(input, "input", scheduleSearch));
		this._register(
			addDisposableListener(regexToggle, "change", scheduleSearch),
		);
	}

	private async runSearch(
		pattern: string,
		isRegExp: boolean,
		status: HTMLElement,
		messages: HTMLElement,
		results: HTMLElement,
	): Promise<void> {
		// A new query always supersedes whatever is still in flight — cancel
		// it first so `PlainSearchResultProvider.textSearch` tells Rust to
		// stop and reclaim that search's queue rather than letting it run to
		// completion unread.
		this.#generation += 1;
		const generation = this.#generation;
		this.#tokenSource?.cancel();
		this.#tokenSource?.dispose();
		this.#tokenSource = undefined;

		results.replaceChildren();
		messages.textContent = "";

		if (pattern.length === 0) {
			status.textContent = "";
			return;
		}
		status.textContent = "Searching…";

		const tokenSource = new CancellationTokenSource();
		this.#tokenSource = tokenSource;

		const folderQueries = this.workspaceContextService
			.getWorkspace()
			.folders.map((folder) => ({ folder: folder.uri }));

		let fileCount = 0;
		let matchCount = 0;
		const onProgress = (progress: ISearchProgressItem): void => {
			if (generation !== this.#generation || !isFileMatch(progress)) {
				return;
			}
			fileCount += 1;
			matchCount += progress.results?.length ?? 0;
			results.append(this.renderFileGroup(progress));
			status.textContent = formatSearchStatus(fileCount, matchCount, false);
		};

		try {
			const complete = await this.searchService.textSearch(
				{
					type: QueryType.Text,
					folderQueries,
					contentPattern: { pattern, isRegExp },
				},
				tokenSource.token,
				onProgress,
			);
			if (generation !== this.#generation) {
				return;
			}
			status.textContent = formatSearchStatus(fileCount, matchCount, true);
			const messageTexts: string[] = [];
			if (complete.limitHit === true) {
				messageTexts.push(
					"Too many results — only a partial set is shown. Refine your search.",
				);
			}
			for (const message of complete.messages) {
				messageTexts.push(message.text);
			}
			messages.textContent = messageTexts.join(" ");
		} catch (error) {
			// A search this view itself cancelled (by starting a newer one)
			// is expected to reject once `ISearchService`'s own base-class
			// cancellation racing observes the token — not a real failure,
			// and must not become an unhandled rejection. Anything else,
			// for a query that is still current, is a genuine unexpected
			// error and is surfaced rather than silently dropped.
			if (
				generation !== this.#generation ||
				tokenSource.token.isCancellationRequested
			) {
				return;
			}
			throw error;
		} finally {
			if (this.#tokenSource === tokenSource) {
				this.#tokenSource = undefined;
			}
			tokenSource.dispose();
		}
	}

	private renderFileGroup(fileMatch: IFileMatch): HTMLElement {
		const group = document.createElement("div");
		group.className = "plain-search-view-file";

		const header = document.createElement("div");
		header.className = "plain-search-view-file-path";
		header.textContent = fileMatch.resource.path.replace(/^\//, "");
		group.append(header);

		const list = document.createElement("ul");
		list.className = "plain-search-view-file-matches";
		for (const result of fileMatch.results ?? []) {
			if (!resultIsMatch(result)) {
				continue;
			}
			for (const location of result.rangeLocations) {
				const item = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.className = "plain-search-view-match";
				button.textContent = `${location.source.startLineNumber}: ${result.previewText}`;
				button.addEventListener("click", () => {
					void this.openMatch(fileMatch.resource, location.source);
				});
				item.append(button);
				list.append(item);
			}
		}
		group.append(list);
		return group;
	}

	private async openMatch(
		resource: IFileMatch["resource"],
		range: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		},
	): Promise<void> {
		await this.editorService.openEditor({
			resource,
			options: {
				selection: {
					startLineNumber: range.startLineNumber,
					startColumn: range.startColumn,
					endLineNumber: range.endLineNumber,
					endColumn: range.endColumn,
				},
			},
		});
	}
}

function formatSearchStatus(
	fileCount: number,
	matchCount: number,
	done: boolean,
): string {
	if (matchCount === 0) {
		return done ? "No results found." : "Searching…";
	}
	const matchWord = matchCount === 1 ? "result" : "results";
	const fileWord = fileCount === 1 ? "file" : "files";
	return `${matchCount} ${matchWord} in ${fileCount} ${fileWord}`;
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
IEditorService(PlainSearchView, undefined, 12);
