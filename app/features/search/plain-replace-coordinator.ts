import { ResourceTextEdit } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

/**
 * Plain's own, minimal search-and-replace coordinator — deliberately not the
 * upstream `ReplaceService`/`IReplaceService`
 * (`@codingame/monaco-vscode-search-service-override`'s
 * `.../contrib/search/browser/replaceService.js`).
 *
 * That class's public `replace(arg)` only recognizes upstream's own
 * `SearchTreeMatch`/`SearchTreeFileMatch` tree objects (`createEdits` calls
 * `isSearchTreeMatch`/`isSearchTreeFileMatch`, both of which are
 * duck-typed/branded checks against instances the vendor `SearchModel`
 * class tree produces) — passing it Plain's own bare `IFileMatch`/
 * `ITextSearchMatch` results (which is all `PlainSearchView` has; F040 S1/S3
 * deliberately did not adopt the vendor `SearchModel`/
 * `ISearchViewModelWorkbenchService` tree, for the same reasons `SearchView`
 * itself was rejected — see `./plain-search-view.ts`'s own doc comment)
 * would silently produce zero edits. Reaching that class also drags in
 * `INotebookEditorModelResolverService`/`CellUri`/`isIMatchInNotebook` from
 * `.../notebookSearch/notebookSearchModelBase` and the full
 * `ISearchViewModelWorkbenchService`/`SearchModel` tree — a much larger,
 * more deeply-coupled surface than this feature needs.
 *
 * Upstream's `ReplaceService.replace()` itself boils down to exactly two
 * steps once its tree-walking `createEdits()` has produced a
 * `ResourceTextEdit[]`: `IBulkEditService.apply(edits)`, then
 * `ITextFileService.files.get(resource)?.save({source})` for every touched
 * resource. This module reproduces exactly those two steps directly against
 * Plain's own match locations, which already carry the `resource`/`range`
 * `createEdits` would have derived from a `Match` instance — see
 * `plain-search-service.ts`'s `getReplaceMatchLocation`. Reusing
 * `IBulkEditService`/`ITextFileService` this way is exactly "reuse upstream
 * semantics, skip the branded UI tree": edits still flow through the same
 * bulk-edit apply, the same `TextFileEditorModel`/`StoredFileWorkingCopy`
 * working-copy save, and therefore the exact same wv1/PLR1/PLW1 versioned
 * save chain and `FILE_MODIFIED_SINCE` conflict handling
 * (`TextFileSaveErrorHandler`, already patched into
 * `@codingame/monaco-vscode-api`) that manual editor saves already use.
 *
 * Grouping is per-resource rather than one shared `apply()` call across
 * every target (which is what upstream's own `ReplaceService.replace()`
 * does): each resource's own `ResourceTextEdit[]` batch is applied and saved
 * independently, so one resource that fails to resolve (e.g. because it
 * exceeds the platform's 8 MiB read ceiling) does not also abort edits to
 * every other, unrelated file in the same "Replace All" — the failure stays
 * visible and scoped to that one resource instead of silently taking down
 * sibling replacements. This is a deliberate, small improvement over
 * upstream's single-batch call, not a behavior upstream itself guarantees;
 * the trade-off is that "Replace All" no longer produces one shared
 * undo-group across every file (each resource gets its own undo step) —
 * acceptable here since this view does not otherwise attempt to match
 * upstream's UI/UX 1:1 (see `plain-search-view.ts`'s own doc comment).
 *
 * `TextFileEditorModel.save()` does *not* reject on a save failure (e.g.
 * `FILE_MODIFIED_SINCE`) unless called with `ignoreErrorHandler: true` —
 * passing that flag would also *skip* the patched `TextFileSaveErrorHandler`
 * notification entirely (its `handleSaveError` throws before ever calling
 * `saveErrorHandler.onSaveError`), which would silently drop the very
 * Reload/Save As conflict affordance F040 S4's acceptance criteria depend
 * on. So this coordinator never sets that flag, and determines success from
 * `save()`'s own boolean return value (`true` only once the model's state is
 * genuinely `SAVED`) rather than from a thrown error.
 */

export interface ReplaceRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface ReplaceTarget {
	readonly resource: URI;
	readonly range: ReplaceRange;
}

/** The narrow slice of `IBulkEditService` this coordinator calls — lets
 * tests supply a minimal fake instead of the whole vendor interface. Takes a
 * mutable array (matching the real `IBulkEditService.apply(edit:
 * ResourceEdit[] | WorkspaceEdit, ...)` signature exactly) rather than
 * `readonly ResourceTextEdit[]`: a `readonly` array is not assignable to a
 * mutable one, so the real service would not structurally satisfy this
 * interface otherwise. */
export interface ReplaceBulkEditService {
	apply(edits: ResourceTextEdit[]): Promise<unknown>;
}

/** The narrow slice of one resolved `ITextFileEditorModel` this coordinator
 * needs: `save()`'s own boolean return value is the sole success signal
 * (see this module's own doc comment for why a thrown error is not). */
export interface ReplaceModelHandle {
	save(options: { readonly source: string }): Promise<boolean>;
}

/** The narrow slice of `ITextFileService.files` this coordinator calls. */
export interface ReplaceFileModels {
	get(resource: URI): ReplaceModelHandle | undefined;
}

export type ReplaceResourceOutcome =
	{ readonly status: "replaced" } | { readonly status: "failed" };

export interface ReplaceOutcome {
	/** Keyed by `resource.toString()`, one entry per distinct resource named
	 * by the input `targets` (never by individual match). */
	readonly perResource: ReadonlyMap<string, ReplaceResourceOutcome>;
}

const REPLACE_SAVE_SOURCE = "plainSearch.replace";

interface ResourceGroup {
	readonly resource: URI;
	readonly edits: ResourceTextEdit[];
}

/**
 * Applies `replacementText` at every one of `targets`' ranges and saves each
 * affected resource, grouped so that one resource's failure never touches
 * another's edits or save outcome. Every entry in the returned map's
 * `perResource` corresponds to exactly one distinct resource named by
 * `targets` — never throws itself; a target resource that fails to resolve,
 * edit, or save is reported as `{ status: "failed" }`, not an exception.
 */
export async function replaceSearchMatches(
	bulkEditService: ReplaceBulkEditService,
	fileModels: ReplaceFileModels,
	targets: readonly ReplaceTarget[],
	replacementText: string,
): Promise<ReplaceOutcome> {
	const groups = new Map<string, ResourceGroup>();
	for (const target of targets) {
		const key = target.resource.toString();
		let group = groups.get(key);
		if (group === undefined) {
			group = { resource: target.resource, edits: [] };
			groups.set(key, group);
		}
		group.edits.push(
			new ResourceTextEdit(target.resource, {
				range: target.range,
				text: replacementText,
			}),
		);
	}

	const perResource = new Map<string, ReplaceResourceOutcome>();
	await Promise.all(
		[...groups.entries()].map(async ([key, group]) => {
			perResource.set(
				key,
				await replaceOneResource(bulkEditService, fileModels, group),
			);
		}),
	);
	return Object.freeze({ perResource });
}

async function replaceOneResource(
	bulkEditService: ReplaceBulkEditService,
	fileModels: ReplaceFileModels,
	group: ResourceGroup,
): Promise<ReplaceResourceOutcome> {
	try {
		await bulkEditService.apply(group.edits);
	} catch {
		return { status: "failed" };
	}
	const model = fileModels.get(group.resource);
	if (model === undefined) {
		return { status: "failed" };
	}
	const saved = await model.save({ source: REPLACE_SAVE_SOURCE });
	return saved ? { status: "replaced" } : { status: "failed" };
}
