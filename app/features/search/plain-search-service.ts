import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import type { IExpression } from "@codingame/monaco-vscode-api/vscode/vs/base/common/glob";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import { ILogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service";
import { ITelemetryService } from "@codingame/monaco-vscode-api/vscode/vs/platform/telemetry/common/telemetry.service";
import { IUriIdentityService } from "@codingame/monaco-vscode-api/vscode/vs/platform/uriIdentity/common/uriIdentity.service";
import { IModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { IExtensionService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service";
import {
	SearchProviderType,
	type IFileQuery,
	type ISearchComplete,
	type ISearchProgressItem,
	type ISearchResultProvider,
	type ITextQuery,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search";

import { SearchService } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";

import type { PlainBridge } from "../../platform/tauri/contracts";

/** Client-side backstop mirroring upstream `AnythingQuickAccessProvider.
 * MAX_RESULTS`; Rust clamps to its own, independent hard cap regardless of
 * what this sends. */
const MAX_FILE_SEARCH_RESULTS = 512;

let configuredBridge: PlainBridge | undefined;

/**
 * Wires the Tauri/browser-mock bridge into `PlainSearchResultProvider`
 * without adding a non-service constructor parameter (which the DI
 * container cannot supply automatically) — the exact same pattern as
 * `configurePlainWorkingCopyBackupBridge` in
 * `app/services/plain-workspace-backup-service.ts`. Must be called exactly
 * once, before Workbench `initialize()` ever resolves `ISearchService`.
 */
export function configurePlainSearchBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

function requireBridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"PlainSearchResultProvider was used before configurePlainSearchBridge",
		);
	}
	return configuredBridge;
}

/**
 * Flattens an upstream `glob.IExpression` (a map of glob pattern to
 * `true | { when } | false`) into the plain pattern strings Rust's
 * `globset` consumes. A `when`-clause pattern object still counts as "on"
 * here (Plain never populates `when`, so treating it as unconditionally
 * included is equivalent in practice and avoids silently dropping patterns
 * a future caller might add).
 */
function flattenGlobExpression(
	expression: IExpression | undefined,
): readonly string[] {
	if (expression === undefined || expression === null) {
		return [];
	}
	return Object.entries(expression)
		.filter(([, value]) => value !== false)
		.map(([pattern]) => pattern);
}

/**
 * Collects every exclude glob a `IFileQuery`/`ITextQuery` carries: the rare
 * top-level `excludePattern` (only ever set by explicit search-path syntax,
 * which Quick Open's `AnythingQuickAccessProvider` never uses) plus each
 * folder query's own `excludePattern` array — the one upstream's
 * `QueryBuilder.getFolderQueryForRoot` actually populates from
 * `search.exclude`/`files.exclude` (see
 * docs/research/2026-07-23-search-quickopen.md's queryBuilder findings).
 */
function collectExcludeGlobs(
	query: Pick<IFileQuery, "excludePattern" | "folderQueries">,
): readonly string[] {
	const globs = new Set<string>();
	for (const pattern of flattenGlobExpression(query.excludePattern)) {
		globs.add(pattern);
	}
	for (const folderQuery of query.folderQueries) {
		for (const exclude of folderQuery.excludePattern ?? []) {
			for (const pattern of flattenGlobExpression(exclude.pattern)) {
				globs.add(pattern);
			}
		}
	}
	return Object.freeze([...globs]);
}

/** Root ids named by a query's folder scheme-filtered `plain-workspace:`
 * folders, in the order the query lists them. */
function plainWorkspaceRoots(
	query: Pick<IFileQuery, "folderQueries">,
): readonly string[] {
	return Object.freeze(
		query.folderQueries
			.map((folderQuery) => folderQuery.folder)
			.filter((folder) => folder.scheme === PLAIN_WORKSPACE_SCHEME)
			.map((folder) => folder.authority),
	);
}

/**
 * Rebuilds the `plain-workspace:` resource URI for one root-relative search
 * result. This slice's response does not pair each entry with a root id
 * (see `WorkspaceSearchFilesResult`'s own doc comment): Plain currently
 * authorizes exactly one workspace root, so every entry is resolved against
 * `roots[0]`.
 */
function searchResultResource(rootId: string, relativePath: string): URI {
	return URI.from({
		scheme: PLAIN_WORKSPACE_SCHEME,
		authority: rootId,
		path: `/${relativePath}`,
	});
}

// Not imported from ../workspace/file-system-provider: that module's
// PLAIN_WORKSPACE_SCHEME/createPlainWorkspaceFileSystemProvider/
// PlainWorkspaceFileSystemProvider triple is a closed import contract owned
// by app/main.ts alone (see validateProviderBindingAuthority in
// scripts/plain/workspace-topology-contracts.mjs). app/features/workspace/
// commands.ts already establishes the precedent this file follows: redeclare
// the scheme string locally rather than reach into that provider module.
const PLAIN_WORKSPACE_SCHEME = "plain-workspace";

/**
 * Module-private search backend for the `plain-workspace:` scheme.
 * `fileSearch` (F040 S2) routes through the Rust search domain via the
 * platform bridge (`configurePlainSearchBridge`); `textSearch` (F040 S3)
 * still unconditionally resolves to an empty result set, and `clearCache` is
 * a no-op — there is no cache to clear on either path. `getAIName` is part
 * of the frozen `ISearchResultProvider` contract (required so the provider
 * type-checks and so any future AI-search entry point that probes
 * `getAIName()` gets an honest "no AI name" answer) but is not, itself, an
 * AI feature: Plain never registers an AI/aiText search provider, never
 * emits `aiKeywords`, and never wires `IChatContextPickService` — see
 * `./search-contribution.ts` for why the upstream package's own
 * `search.contribution.js` is not imported wholesale.
 */
class PlainSearchResultProvider implements ISearchResultProvider {
	/** Guards against an out-of-order response to a superseded query
	 * overwriting a newer one's result; defense-in-depth alongside whatever
	 * `token` cancellation upstream already provides. */
	#sequence = 0;

	async getAIName(): Promise<string | undefined> {
		return undefined;
	}

	async fileSearch(
		query: IFileQuery,
		token?: CancellationToken,
	): Promise<ISearchComplete> {
		const roots = plainWorkspaceRoots(query);
		if (roots.length === 0) {
			return { results: [], messages: [] };
		}
		const excludeGlobs = collectExcludeGlobs(query);
		const requestedMaxResults = query.maxResults;
		const maxResults =
			requestedMaxResults === undefined
				? MAX_FILE_SEARCH_RESULTS
				: Math.min(MAX_FILE_SEARCH_RESULTS, requestedMaxResults);

		this.#sequence += 1;
		const sequence = this.#sequence;
		const result = await requireBridge().workspaceSearchFiles(
			roots,
			query.filePattern ?? "",
			excludeGlobs,
			maxResults,
		);
		if (
			sequence !== this.#sequence ||
			token?.isCancellationRequested === true
		) {
			return { results: [], messages: [] };
		}

		const primaryRoot = roots[0]!;
		return {
			results: result.entries.map((relativePath) => ({
				resource: searchResultResource(primaryRoot, relativePath),
			})),
			limitHit: result.limitHit,
			messages: [],
		};
	}

	async textSearch(
		_query: ITextQuery,
		_onProgress?: (progress: ISearchProgressItem) => void,
		_token?: CancellationToken,
	): Promise<ISearchComplete> {
		return { results: [], messages: [] };
	}

	async clearCache(_cacheKey: string): Promise<void> {
		// No cache is kept yet; nothing to clear.
	}
}

Object.freeze(PlainSearchResultProvider.prototype);

/**
 * Plain's own `ISearchService` implementation.
 *
 * Extends the upstream, unpatched `SearchService` base class imported from
 * its exact submodule — never the search-service-override package's
 * aggregating default export. That default export's `CustomSearchService`
 * constructor unconditionally does
 * `isHTMLFileSystemProvider(fileService.getProvider(Schemas.file))`; Plain
 * registers no `file:` provider at all, so `getProvider(Schemas.file)`
 * returns `undefined` and the property access throws `TypeError` before the
 * Workbench can finish starting. Both of that factory's fallbacks (a File
 * System Access Worker file searcher and a plain in-browser regex file
 * searcher) are also front-end implementations hard-coded to the `file:`
 * scheme, which would bypass Rust's search authority even if the crash were
 * worked around — so the base class is extended directly instead, exactly
 * like the working-copy override precedent in `app/services.ts`.
 *
 * The base class's own constructor already resolves each dependency lazily
 * against the DI container; this subclass adds nothing to that list, only a
 * single `plain-workspace:` provider registration for both the `file` and
 * `text` provider slots (mirroring the base class's own scheme-keyed
 * dispatch — see its `registerSearchResultProvider`/`searchWithProviders`).
 */
export class PlainSearchService extends SearchService {
	constructor(
		modelService: IModelService,
		editorService: IEditorService,
		telemetryService: ITelemetryService,
		logService: ILogService,
		extensionService: IExtensionService,
		fileService: IFileService,
		uriIdentityService: IUriIdentityService,
	) {
		super(
			modelService,
			editorService,
			telemetryService,
			logService,
			extensionService,
			fileService,
			uriIdentityService,
		);
		const provider = new PlainSearchResultProvider();
		this._register(
			this.registerSearchResultProvider(
				PLAIN_WORKSPACE_SCHEME,
				SearchProviderType.file,
				provider,
			),
		);
		this._register(
			this.registerSearchResultProvider(
				PLAIN_WORKSPACE_SCHEME,
				SearchProviderType.text,
				provider,
			),
		);
	}
}

Object.freeze(PlainSearchService.prototype);

// Manual DI-dependency registration, equivalent to what TypeScript's
// `@IFoo`-style legacy parameter decorators would emit — this repository
// does not enable `experimentalDecorators`. `PlainSearchService` is its own
// constructor function distinct from `SearchService`, and the DI container
// looks up dependencies via `ctor[DI_DEPENDENCIES]` on the exact class
// passed to `SyncDescriptor` (see
// `@codingame/monaco-vscode-api`'s `vscode/vs/platform/instantiation/common/instantiation`),
// not by walking the prototype chain — so this subclass must redeclare the
// same seven tokens, in the same order, as the base class constructor above,
// exactly like `PlainWorkingCopyBackupTracker` already does in
// `app/services/plain-workspace-backup-tracker.ts`.
IModelService(PlainSearchService, undefined, 0);
IEditorService(PlainSearchService, undefined, 1);
ITelemetryService(PlainSearchService, undefined, 2);
ILogService(PlainSearchService, undefined, 3);
IExtensionService(PlainSearchService, undefined, 4);
IFileService(PlainSearchService, undefined, 5);
IUriIdentityService(PlainSearchService, undefined, 6);
