import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
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

// Not imported from ../workspace/file-system-provider: that module's
// PLAIN_WORKSPACE_SCHEME/createPlainWorkspaceFileSystemProvider/
// PlainWorkspaceFileSystemProvider triple is a closed import contract owned
// by app/main.ts alone (see validateProviderBindingAuthority in
// scripts/plain/workspace-topology-contracts.mjs). app/features/workspace/
// commands.ts already establishes the precedent this file follows: redeclare
// the scheme string locally rather than reach into that provider module.
const PLAIN_WORKSPACE_SCHEME = "plain-workspace";

/**
 * Module-private, Rust-authority-free stand-in for the real
 * `plain-workspace:` search backend. This slice only wires the reachable
 * shape: both `fileSearch` and `textSearch` unconditionally resolve to empty
 * result sets, and `clearCache` is a no-op — there is no per-instance state
 * to clear yet. `getAIName` is part of the frozen `ISearchResultProvider`
 * contract (required so the provider type-checks and so any future AI-search
 * entry point that probes `getAIName()` gets an honest "no AI name" answer)
 * but is not, itself, an AI feature: Plain never registers an AI/aiText
 * search provider, never emits `aiKeywords`, and never wires
 * `IChatContextPickService` — see `./search-contribution.ts` for why the
 * upstream package's own `search.contribution.js` is not imported wholesale.
 *
 * A later slice (F040 S2/S3) replaces the bodies of `fileSearch`/`textSearch`
 * with calls into the Rust search domain via the platform bridge; this class
 * intentionally does not reach for `window`/global state so that swap stays
 * confined to this file.
 */
class PlainSearchResultProvider implements ISearchResultProvider {
	async getAIName(): Promise<string | undefined> {
		return undefined;
	}

	async fileSearch(
		_query: IFileQuery,
		_token?: CancellationToken,
	): Promise<ISearchComplete> {
		return { results: [], messages: [] };
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
