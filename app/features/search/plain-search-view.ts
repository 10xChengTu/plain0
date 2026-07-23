import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { CancellationTokenSource } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import type { IExpression } from "@codingame/monaco-vscode-api/vscode/vs/base/common/glob";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IBulkEditService } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService.service";
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
	type ITextSearchMatch,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { ITextFileService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textfiles.service";

import { getReplaceMatchLocation } from "./plain-search-service";
import {
	replaceSearchMatches,
	type ReplaceTarget,
} from "./plain-replace-coordinator";

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
 * replace preview diff); those stay explicit follow-on work.
 *
 * F040 S4 adds replace: a single replace-text input plus three action
 * granularities — one "Replace" button per match, one "Replace All in File"
 * button per file group, and one global "Replace All" button — all routed
 * through `./plain-replace-coordinator.ts`'s `replaceSearchMatches`, never
 * the vendor `IReplaceService`/`ReplaceService` (see that module's own doc
 * comment for why). Each match's precise, absolute-position edit range is
 * resolved once at render time — see `ResolvedMatchLocation`'s own doc
 * comment for the two distinct sources a match can come from (Plain's own
 * provider vs. the vendor base class's open-editor override) and why each
 * needs a different range source, never the preview-relative coordinates
 * already used to render `previewText`.
 */

/**
 * One match's resolved, absolute-position replace/jump range plus its own
 * rendered `<li>` element. Resolved exactly once, at render time in
 * `renderFileGroup`, from whichever of two sources actually produced this
 * particular `ITextSearchMatch`:
 *
 * 1. Plain's own `plain-workspace:` search provider
 *    (`plain-search-service.ts`'s `textSearchFileMatch`) — for these,
 *    `getReplaceMatchLocation` returns the precise range built from Rust's
 *    `absoluteColumn`, independent of any preview-window truncation.
 * 2. The vendor `SearchService` base class's *own* `getOpenEditorResults`
 *    (`@codingame/monaco-vscode-search-service-override`'s
 *    `common/searchService.js`): for any resource that is *currently open in
 *    an editor*, the base class silently substitutes a `FileMatch` it builds
 *    itself directly from the live model (`model.findMatches(...)`),
 *    bypassing Plain's provider — and therefore Plain's own WeakMap —
 *    entirely for that one resource. Discovered via a real Chromium
 *    Playwright run reproducing exactly this: replacing a file that was
 *    already open silently replaced nothing, because
 *    `getReplaceMatchLocation` returned `undefined` for its matches. These
 *    substituted matches are *not* window-truncated at all (they never go
 *    through Rust's DTO), so their own `rangeLocations[0].source` carries a
 *    genuine, real position in the live model — used as the fallback here,
 *    with one correction: `@codingame/monaco-vscode-api`'s own
 *    `searchHelpers.js` (`editorMatchToTextSearchResult`, a fixed passthrough
 *    dependency, confirmed by reading its source) deliberately constructs
 *    that `source` range zero-indexed (`startLineNumber - 1`, etc.) rather
 *    than on Monaco's normal 1-indexed convention every other Range API
 *    (including Plain's own provider matches) uses, so it is corrected back
 *    with `+ 1` at the point it is consumed below — a second real bug this
 *    same Playwright run caught (an off-by-one edit silently corrupting an
 *    already-open file's content) before this fallback path accounted for it.
 */
interface ResolvedMatchLocation {
	readonly element: HTMLLIElement;
	readonly range: {
		readonly startLineNumber: number;
		readonly startColumn: number;
		readonly endLineNumber: number;
		readonly endColumn: number;
	};
}

/** Tracked DOM/state for one rendered file group, keyed by
 * `resource.toString()` in `PlainSearchView.#fileGroups` — lets a replace
 * action remove exactly the match `<li>` elements it actually replaced (and
 * the whole group once it has none left) without re-rendering the result
 * set, and gives each file its own inline error slot for a failed replace
 * (e.g. a save conflict) that does not affect any other file. */
interface FileGroupState {
	readonly resource: IFileMatch["resource"];
	readonly groupElement: HTMLElement;
	readonly listElement: HTMLElement;
	readonly errorElement: HTMLElement;
	readonly matches: Map<ITextSearchMatch, ResolvedMatchLocation>;
}

/** One resolved match ready to be replaced: everything `replaceSearchMatches`
 * and the post-replace DOM update need, gathered up front by the three click
 * handlers (single match / whole file / whole result set) rather than
 * re-resolved from the match object alone. */
interface ReplaceCandidate {
	readonly resourceKey: string;
	readonly resource: IFileMatch["resource"];
	readonly match: ITextSearchMatch;
	readonly location: ResolvedMatchLocation;
}

export class PlainSearchView extends ViewPane {
	static readonly ID = "plain.workbench.view.search";

	/** Guards a stale search's progress/completion callbacks from touching the
	 * DOM after a newer query (or view disposal) has superseded it. */
	#generation = 0;
	#tokenSource: CancellationTokenSource | undefined;

	/** One entry per file currently rendered in the results list, keyed by
	 * `resource.toString()` — lets a replace action remove exactly the
	 * matches (and, once empty, the whole file group) it actually replaced,
	 * without having to re-render the entire result set. Reset every time a
	 * new search starts. */
	readonly #fileGroups = new Map<string, FileGroupState>();

	/** Populated once by `renderBody` (called exactly once per view
	 * instance); read by `renderFileGroup` and the replace click handlers,
	 * which are separate methods from `renderBody` and so cannot simply
	 * close over its local variables the way `runSearch`'s own callers do. */
	#replaceInput: HTMLInputElement | undefined;
	#statusElement: HTMLElement | undefined;
	#messagesElement: HTMLElement | undefined;

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
		private readonly bulkEditService: IBulkEditService,
		private readonly textFileService: ITextFileService,
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

		const replaceInput = document.createElement("input");
		replaceInput.type = "text";
		replaceInput.className = "plain-search-view-replace-input";
		replaceInput.placeholder = "Replace";
		replaceInput.setAttribute("aria-label", "Replace");
		this.#replaceInput = replaceInput;

		const replaceAllButton = document.createElement("button");
		replaceAllButton.type = "button";
		replaceAllButton.className = "plain-search-view-replace-all";
		replaceAllButton.textContent = "Replace All";
		replaceAllButton.addEventListener("click", () => {
			void this.onReplaceAllClicked();
		});

		const status = document.createElement("div");
		status.className = "plain-search-view-status";
		status.setAttribute("role", "status");
		this.#statusElement = status;

		const messages = document.createElement("div");
		messages.className = "plain-search-view-messages";
		messages.setAttribute("role", "status");
		this.#messagesElement = messages;

		const results = document.createElement("div");
		results.className = "plain-search-view-results";

		container.append(
			input,
			regexLabel,
			replaceInput,
			replaceAllButton,
			status,
			messages,
			results,
		);

		this._register(
			toDisposable(() => {
				this.#generation += 1;
				this.#tokenSource?.cancel();
				this.#tokenSource?.dispose();
				this.#tokenSource = undefined;
				this.#fileGroups.clear();
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
		this.#fileGroups.clear();

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

		// This view builds its ITextQuery by hand rather than through
		// upstream's QueryBuilder (see this file's own module doc comment for
		// why), so it must reproduce QueryBuilder.getFolderQueryForRoot's own
		// `getExcludes()` merge itself — search.exclude overrides files.exclude
		// on key conflicts, matching upstream's `mixin(..., true)` — or
		// `search.exclude`'s F040 S5 default (see search-contribution.ts) would
		// silently apply to Quick Open file search but not to this view's text
		// search, which found and fixed exactly that gap during this slice.
		const filesExclude = this.configurationService.getValue<
			IExpression | undefined
		>("files.exclude");
		const searchExclude = this.configurationService.getValue<
			IExpression | undefined
		>("search.exclude");
		const excludePattern: IExpression = {
			...filesExclude,
			...searchExclude,
		};

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
					excludePattern,
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
		const resourceKey = fileMatch.resource.toString();

		const group = document.createElement("div");
		group.className = "plain-search-view-file";

		const header = document.createElement("div");
		header.className = "plain-search-view-file-header";

		const pathLabel = document.createElement("span");
		pathLabel.className = "plain-search-view-file-path";
		pathLabel.textContent = fileMatch.resource.path.replace(/^\//, "");
		header.append(pathLabel);

		const replaceFileButton = document.createElement("button");
		replaceFileButton.type = "button";
		replaceFileButton.className = "plain-search-view-replace-file";
		replaceFileButton.textContent = "Replace All in File";
		replaceFileButton.addEventListener("click", () => {
			void this.onReplaceFileClicked(resourceKey);
		});
		header.append(replaceFileButton);

		const errorElement = document.createElement("div");
		errorElement.className = "plain-search-view-file-error";
		errorElement.setAttribute("role", "status");

		const list = document.createElement("ul");
		list.className = "plain-search-view-file-matches";

		const state: FileGroupState = {
			resource: fileMatch.resource,
			groupElement: group,
			listElement: list,
			errorElement,
			matches: new Map(),
		};

		for (const result of fileMatch.results ?? []) {
			if (!resultIsMatch(result)) {
				continue;
			}
			for (const rangeLocation of result.rangeLocations) {
				// Prefer Plain's own absolute-column location (correct even for a
				// match far into a line longer than the 256-unit preview window);
				// fall back to this `ITextSearchMatch`'s own `source` range for a
				// match Plain's provider never constructed in the first place —
				// see `ResolvedMatchLocation`'s own doc comment for why that
				// happens (an already-open file's live-buffer match, substituted
				// in by the vendor `SearchService` base class).
				//
				// That fallback `source` is *not* on the same 1-indexed line/
				// column convention every other Monaco Range API (including
				// Plain's own provider matches) uses: the vendor's own
				// `editorMatchToTextSearchResult` (`@codingame/monaco-vscode-api`'s
				// `searchHelpers.js`, a fixed passthrough dependency, confirmed by
				// reading its source) deliberately constructs this one `source`
				// range with `startLineNumber - 1`/`startColumn - 1`/etc., i.e.
				// zero-indexed — evidently meant only for that same file's own
				// downstream `Match`/`FileMatch` consumers (the vendor
				// `SearchModel` tree Plain does not use) to re-add. Naively
				// treating it as already-1-indexed silently produces a one-line/
				// one-column-off edit range — confirmed by a real Chromium run
				// that corrupted an already-open file's content this way before
				// this `+ 1` correction was added — so it is corrected back to
				// Monaco's normal 1-indexed convention here, once, at the single
				// point this range is resolved.
				const range = getReplaceMatchLocation(result)?.range ?? {
					startLineNumber: rangeLocation.source.startLineNumber + 1,
					startColumn: rangeLocation.source.startColumn + 1,
					endLineNumber: rangeLocation.source.endLineNumber + 1,
					endColumn: rangeLocation.source.endColumn + 1,
				};

				const item = document.createElement("li");
				item.className = "plain-search-view-match-row";

				const jumpButton = document.createElement("button");
				jumpButton.type = "button";
				jumpButton.className = "plain-search-view-match";
				jumpButton.textContent = `${range.startLineNumber}: ${result.previewText}`;
				jumpButton.addEventListener("click", () => {
					void this.openMatch(fileMatch.resource, range);
				});

				const replaceButton = document.createElement("button");
				replaceButton.type = "button";
				replaceButton.className = "plain-search-view-replace-match";
				replaceButton.textContent = "Replace";
				replaceButton.addEventListener("click", () => {
					void this.runReplace([
						{
							resourceKey,
							resource: fileMatch.resource,
							match: result,
							location: { element: item, range },
						},
					]);
				});

				item.append(jumpButton, replaceButton);
				list.append(item);
				state.matches.set(result, { element: item, range });
			}
		}
		group.append(header, errorElement, list);
		this.#fileGroups.set(resourceKey, state);
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

	private async onReplaceFileClicked(resourceKey: string): Promise<void> {
		await this.runReplace(this.candidatesFor(resourceKey));
	}

	private async onReplaceAllClicked(): Promise<void> {
		const candidates = [...this.#fileGroups.keys()].flatMap((resourceKey) =>
			this.candidatesFor(resourceKey),
		);
		await this.runReplace(candidates);
	}

	private candidatesFor(resourceKey: string): ReplaceCandidate[] {
		const group = this.#fileGroups.get(resourceKey);
		if (group === undefined) {
			return [];
		}
		return [...group.matches.entries()].map(([match, location]) => ({
			resourceKey,
			resource: group.resource,
			match,
			location,
		}));
	}

	/**
	 * Shared replace entry point for all three action granularities (single
	 * match, whole file, whole result set): each candidate already carries
	 * its own resolved, absolute-position range (from `renderFileGroup`, at
	 * render time — see `ResolvedMatchLocation`'s doc comment), so this only
	 * has to build the `ReplaceTarget[]` and route it through
	 * `replaceSearchMatches` exactly once (letting the coordinator group by
	 * resource itself), then update the DOM to reflect exactly which
	 * matches were actually replaced. `#generation` is checked after the
	 * (asynchronous) replace completes so a replace started against one
	 * search's results never mutates the DOM of a newer search that has
	 * since superseded it.
	 */
	private async runReplace(
		candidates: readonly ReplaceCandidate[],
	): Promise<void> {
		if (candidates.length === 0) {
			return;
		}
		const generation = this.#generation;
		const replacementText = this.#replaceInput?.value ?? "";

		const targets: ReplaceTarget[] = candidates.map((candidate) => ({
			resource: candidate.resource,
			range: candidate.location.range,
		}));

		const outcome = await replaceSearchMatches(
			this.bulkEditService,
			this.textFileService.files,
			targets,
			replacementText,
		);
		if (generation !== this.#generation) {
			return;
		}
		this.applyReplaceOutcome(outcome, candidates);
	}

	private applyReplaceOutcome(
		outcome: Awaited<ReturnType<typeof replaceSearchMatches>>,
		candidates: readonly ReplaceCandidate[],
	): void {
		let replacedCount = 0;
		let failedCount = 0;
		const failedResourceKeys = new Set<string>();

		for (const candidate of candidates) {
			const { resourceKey, match } = candidate;
			const group = this.#fileGroups.get(resourceKey);
			if (group === undefined) {
				continue;
			}
			const status = outcome.perResource.get(resourceKey);
			if (status?.status === "replaced") {
				replacedCount += 1;
				group.matches.get(match)?.element.remove();
				group.matches.delete(match);
				group.errorElement.textContent = "";
			} else {
				failedCount += 1;
				failedResourceKeys.add(resourceKey);
			}
		}

		for (const resourceKey of failedResourceKeys) {
			const group = this.#fileGroups.get(resourceKey);
			if (group !== undefined && group.matches.size > 0) {
				group.errorElement.textContent =
					"Replace failed to save this file (see notification for details).";
			}
		}

		// Snapshotted via `Array.from` (not a bare spread, which
		// `unicorn/no-useless-spread` flags as unnecessary for a plain
		// for-of): the loop body deletes from `#fileGroups` while iterating
		// it, and this snapshot keeps that mutation from being able to affect
		// which entries the loop itself still visits.
		for (const [resourceKey, group] of Array.from(this.#fileGroups.entries())) {
			if (group.matches.size === 0) {
				group.groupElement.remove();
				this.#fileGroups.delete(resourceKey);
			}
		}

		let remainingFiles = 0;
		let remainingMatches = 0;
		for (const group of this.#fileGroups.values()) {
			remainingFiles += 1;
			remainingMatches += group.matches.size;
		}
		if (this.#statusElement !== undefined) {
			this.#statusElement.textContent = formatSearchStatus(
				remainingFiles,
				remainingMatches,
				true,
			);
		}

		if (
			this.#messagesElement !== undefined &&
			(replacedCount > 0 || failedCount > 0)
		) {
			const parts: string[] = [];
			if (replacedCount > 0) {
				parts.push(
					`Replaced ${replacedCount} match${replacedCount === 1 ? "" : "es"}.`,
				);
			}
			if (failedCount > 0) {
				parts.push(
					`${failedCount} replacement${failedCount === 1 ? "" : "s"} failed to save.`,
				);
			}
			this.#messagesElement.textContent = parts.join(" ");
		}
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
IBulkEditService(PlainSearchView, undefined, 13);
ITextFileService(PlainSearchView, undefined, 14);
