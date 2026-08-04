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
 *
 * Before applying edits, each target model is resolved and the text still at
 * every recorded range must equal the exact match text captured by the
 * search result. This closes the unopened-file race where resolving only
 * inside `apply()` could load already-rewritten disk content, apply stale
 * coordinates to it, and then save successfully with that fresh file's own
 * fresh version token. Once resolved, the model pins the normal wv1 baseline;
 * any later external write is still rejected by the existing save path.
 *
 * `F200` S2 adds capture-group replacement: `replaceSearchMatches`'s fourth
 * parameter is a [`ReplacementInput`] rather than a bare string, so a
 * literal-mode caller must now wrap its replacement text as
 * `{ kind: "literal", text }` — verbatim per-target application (this
 * module's whole reason for existing over upstream's `ReplaceService`, see
 * above) is completely unchanged in that branch, only the call shape moved.
 * A regex-mode caller instead passes `{ kind: "template", expand }`, where
 * `expand` is the caller-supplied capture-group expander (in practice
 * `plain-search-service.ts`'s `expandReplacementTemplate`, itself a thin
 * wrapper over the Rust `workspace_search_expand_replacements` command — see
 * `docs/research/2026-08-04-complete-search.md`'s "架构裁定 2": capture-group
 * expansion is Rust's single regex authority, never a second, parallel JS
 * `RegExp` implementation here). `expand` is called exactly once with every
 * target's `expectedText` (in the same order as `targets`), and its result
 * array must be the same length — that 1:1 correspondence is how each
 * target's own expanded replacement text is recovered. Any target whose
 * entry comes back `{ status: "error" }` marks its *entire owning resource*
 * as failed — not just that one match — reusing the exact same `"conflict"`
 * outcome (and therefore the exact same Reload/Save As/Details UI) a stale
 * on-disk version already produces, per the frozen decision's "该文件降级为
 * conflict 处理零写入（复用既有冲突分支）": the file is never partially
 * rewritten with some matches expanded and others not, and `apply()`/
 * `save()` are never even called for it.
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
	readonly expectedText: string;
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

/** The narrow slice of `ITextFileEditorModel` this coordinator needs for the
 * pre-edit stale-range check and final save. */
export interface ReplaceModelHandle {
	readonly textEditorModel: {
		getValueInRange(range: ReplaceRange): string;
	} | null;
	isResolved(): boolean;
	save(options: { readonly source: string }): Promise<boolean>;
}

/** The narrow slice of `ITextFileService.files` this coordinator calls. */
export interface ReplaceFileModels {
	get(resource: URI): ReplaceModelHandle | undefined;
	resolve(resource: URI): Promise<ReplaceModelHandle>;
}

export type ReplaceResourceOutcome =
	| { readonly status: "replaced" }
	| { readonly status: "conflict" }
	| { readonly status: "failed" };

export interface ReplaceOutcome {
	/** Keyed by `resource.toString()`, one entry per distinct resource named
	 * by the input `targets` (never by individual match). */
	readonly perResource: ReadonlyMap<string, ReplaceResourceOutcome>;
}

const REPLACE_SAVE_SOURCE = "plainSearch.replace";

interface ResourceGroup {
	readonly resource: URI;
	readonly edits: ResourceTextEdit[];
	readonly targets: ReplaceTarget[];
}

/** One `expectedTexts` entry's capture-group expansion outcome — the
 * frontend-side mirror of Rust's `WorkspaceSearchExpandReplacementItem`
 * (`src-tauri/src/search/dto.rs`), decoded by
 * `search-codec.ts`'s `decodeWorkspaceSearchExpandReplacementsResult`. */
export type ExpandedReplacement =
	| { readonly status: "ok"; readonly replacement: string }
	| {
			readonly status: "error";
			readonly code: string;
			readonly message: string;
	  };

/** Expands a replacement template's capture-group references against a
 * batch of previously-recorded match texts, in the same order, returning
 * exactly one [`ExpandedReplacement`] per entry. In practice this is
 * `plain-search-service.ts`'s `expandReplacementTemplate`, a thin wrapper
 * over the Rust `workspace_search_expand_replacements` command — see this
 * module's own doc comment for why capture-group expansion never has a
 * second, JS-side implementation here. */
export type ReplaceExpander = (
	expectedTexts: readonly string[],
) => Promise<readonly ExpandedReplacement[]>;

/** `replaceSearchMatches`'s replacement-text input: `"literal"` applies
 * `text` verbatim to every target (pre-`F200`-S2 behavior, byte-for-byte
 * unchanged); `"template"` expands each target's own replacement text
 * through `expand` first — see this module's own doc comment for the
 * per-resource fail-closed semantics that branch uses. */
export type ReplacementInput =
	| { readonly kind: "literal"; readonly text: string }
	| { readonly kind: "template"; readonly expand: ReplaceExpander };

/**
 * Applies `replacement` at every one of `targets`' ranges and saves each
 * affected resource, grouped so that one resource's failure never touches
 * another's edits or save outcome. Every entry in the returned map's
 * `perResource` corresponds to exactly one distinct resource named by
 * `targets` — never throws itself (except if `replacement.kind ===
 * "template"` and `expand` itself returns a result array whose length does
 * not match `targets`, which is a caller/IPC-contract bug, not a normal
 * failure mode, and is therefore let through as a thrown error rather than
 * silently mis-paired); a target resource that fails to resolve, edit, or
 * save is reported as `{ status: "failed" }`, not an exception.
 */
export async function replaceSearchMatches(
	bulkEditService: ReplaceBulkEditService,
	fileModels: ReplaceFileModels,
	targets: readonly ReplaceTarget[],
	replacement: ReplacementInput,
): Promise<ReplaceOutcome> {
	if (targets.length === 0) {
		return Object.freeze({ perResource: new Map() });
	}
	const groups =
		replacement.kind === "literal"
			? literalGroups(targets, replacement.text)
			: await templateGroups(targets, replacement.expand);

	const perResource = new Map<string, ReplaceResourceOutcome>();
	await Promise.all(
		[...groups.entries()].map(async ([key, group]) => {
			if (group === "conflict") {
				perResource.set(key, { status: "conflict" });
				return;
			}
			perResource.set(
				key,
				await replaceOneResource(bulkEditService, fileModels, group),
			);
		}),
	);
	return Object.freeze({ perResource });
}

function literalGroups(
	targets: readonly ReplaceTarget[],
	replacementText: string,
): Map<string, ResourceGroup> {
	const groups = new Map<string, ResourceGroup>();
	for (const target of targets) {
		const key = target.resource.toString();
		let group = groups.get(key);
		if (group === undefined) {
			group = { resource: target.resource, edits: [], targets: [] };
			groups.set(key, group);
		}
		group.targets.push(target);
		group.edits.push(
			new ResourceTextEdit(target.resource, {
				range: target.range,
				text: replacementText,
			}),
		);
	}
	return groups;
}

/**
 * Builds one group per resource named by `targets`, using `expand`'s
 * per-target expanded replacement text instead of one shared string. A
 * resource with *any* target whose expansion came back `{ status: "error"
 * }` is mapped to the sentinel `"conflict"` instead of a real
 * [`ResourceGroup`] — reused directly by `replaceSearchMatches` as a
 * `{ status: "conflict" }` outcome without ever building an edit or calling
 * `bulkEditService`/`fileModels` for that resource, so a partially-expandable
 * file is never partially rewritten.
 */
async function templateGroups(
	targets: readonly ReplaceTarget[],
	expand: ReplaceExpander,
): Promise<Map<string, ResourceGroup | "conflict">> {
	const expanded = await expand(targets.map((target) => target.expectedText));
	if (expanded.length !== targets.length) {
		throw new Error(
			"replaceSearchMatches: capture-group expansion returned a different number of results than targets requested",
		);
	}

	const groups = new Map<string, ResourceGroup | "conflict">();
	targets.forEach((target, index) => {
		const key = target.resource.toString();
		const result = expanded[index]!;
		if (result.status === "error") {
			// One failing entry conflicts its *whole* owning resource,
			// regardless of how many sibling targets in the same resource
			// already expanded successfully (order-independent: an
			// error-then-ok or ok-then-error sequence for the same resource
			// both end up "conflict").
			groups.set(key, "conflict");
			return;
		}
		const existing = groups.get(key);
		if (existing === "conflict") {
			return;
		}
		const group: ResourceGroup = existing ?? {
			resource: target.resource,
			edits: [],
			targets: [],
		};
		group.targets.push(target);
		group.edits.push(
			new ResourceTextEdit(target.resource, {
				range: target.range,
				text: result.replacement,
			}),
		);
		groups.set(key, group);
	});
	return groups;
}

async function replaceOneResource(
	bulkEditService: ReplaceBulkEditService,
	fileModels: ReplaceFileModels,
	group: ResourceGroup,
): Promise<ReplaceResourceOutcome> {
	let model: ReplaceModelHandle;
	try {
		model = await fileModels.resolve(group.resource);
	} catch {
		return { status: "failed" };
	}
	if (!model.isResolved() || model.textEditorModel === null) {
		return { status: "failed" };
	}
	const textModel = model.textEditorModel;
	if (
		group.targets.some(
			(target) =>
				textModel.getValueInRange(target.range) !== target.expectedText,
		)
	) {
		// The file changed before a model (and therefore a wv1 baseline) was
		// resolved. Do not apply stale search coordinates to fresh content.
		return { status: "conflict" };
	}
	try {
		await bulkEditService.apply(group.edits);
	} catch {
		return { status: "failed" };
	}
	const savedModel = fileModels.get(group.resource);
	if (savedModel === undefined) {
		return { status: "failed" };
	}
	const saved = await savedModel.save({ source: REPLACE_SAVE_SOURCE });
	return saved ? { status: "replaced" } : { status: "failed" };
}
