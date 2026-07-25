import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { ITextModel } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";
import type { ITextModelContentProvider } from "@codingame/monaco-vscode-model-service-override/vscode/vs/editor/common/services/resolverService";

import type { GitShowBlobResult } from "../../platform/tauri/contracts";
import { decodeGitResourceUri, GIT_URI_SCHEME } from "./git-uri";
import type { PlainScmModelFactory } from "./plain-scm-provider";

const utf8Decoder = new TextDecoder();

/** Structural subset of `PlainBridge` this provider needs. */
export interface PlainGitContentBridge {
	gitShowBlob(rev: "head" | "index", path: string): Promise<GitShowBlobResult>;
}

/**
 * `F080` S2 decision 4's `git:` read-only content provider — the same
 * "self-built `ITextModelContentProvider`, never a full `IFileSystemProvider`"
 * shape a real diff/quick-diff source only ever needs (no directory listing,
 * no stat, no write), registered on the already-active `ITextModelService`
 * (`@codingame/monaco-vscode-model-service-override`, already a dependency —
 * see `app/services.ts`) exactly the way `plain-workspace-config:` registers
 * its own read-only `IFileSystemProvider` for a *different* scheme in
 * `app/features/workspace/workspace-configuration-provider.ts`.
 *
 * One model per distinct `(rev, path)` pair is cached for the lifetime of
 * this provider (never invalidated mid-session) — matching upstream
 * `vscode.git`'s own quick-diff model caching: a `HEAD`/index blob is
 * immutable at the moment it's read (the whole point of asking for a
 * specific rev rather than "current"), so there is nothing to invalidate
 * short of disposing the model outright, which happens only when the model
 * itself is disposed by its last reference holder (the normal
 * `ITextModelService` reference-counting contract, not this provider).
 */
export class PlainGitTextModelContentProvider implements ITextModelContentProvider {
	readonly #cache = new Map<string, ITextModel>();

	constructor(
		private readonly bridge: PlainGitContentBridge,
		private readonly modelService: PlainScmModelFactory,
	) {}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const query = decodeGitResourceUri(resource);
		if (query === undefined) {
			return null;
		}
		const cacheKey = resource.toString();
		const cached = this.#cache.get(cacheKey);
		if (cached !== null && cached !== undefined && !cached.isDisposed()) {
			return cached;
		}
		const result = await this.bridge.gitShowBlob(query.rev, query.path);
		if (result.content === null) {
			return null;
		}
		const text = utf8Decoder.decode(result.content);
		const model = this.modelService.createModel(text, null, resource);
		this.#cache.set(cacheKey, model);
		return model;
	}

	dispose(): void {
		for (const model of this.#cache.values()) {
			if (!model.isDisposed()) {
				model.dispose();
			}
		}
		this.#cache.clear();
	}
}

/** Plain construction wrapper — `app/main.ts`'s own "audited bootstrap
 * bridge" AST guard (`scripts/plain/boundary-contracts.mjs`'s
 * `validateWorkspaceProviderBootstrap`) only recognizes `bridge` being
 * passed as the first argument to a *function call*, matching every other
 * `configurePlain*Bridge`/`createPlainWorkspaceFileSystemProvider` call site
 * already there — never a bare `new` expression. */
export function createPlainGitTextModelContentProvider(
	bridge: PlainGitContentBridge,
	modelService: PlainScmModelFactory,
): PlainGitTextModelContentProvider {
	return new PlainGitTextModelContentProvider(bridge, modelService);
}

export { GIT_URI_SCHEME };
