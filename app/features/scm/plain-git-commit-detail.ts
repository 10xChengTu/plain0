import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ValueWithChangeEvent } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type { ITextModel } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";
import type { ITextModelContentProvider } from "@codingame/monaco-vscode-model-service-override/vscode/vs/editor/common/services/resolverService";
import {
	MultiDiffEditorItem,
	type IMultiDiffSourceResolver,
	type IResolvedMultiDiffSource,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService";

import type {
	GitShowBlobResult,
	GitShowCommitResult,
} from "../../platform/tauri/contracts";
import type { PlainScmModelFactory } from "./plain-scm-provider";

const utf8Decoder = new TextDecoder();

/**
 * `F090` S2's own read-only content scheme for "one version of a file at an
 * arbitrary, already-validated historical commit" — deliberately a *separate*
 * scheme from `git-uri.ts`'s own `GIT_URI_SCHEME` (`"git"`, `head`/`index`
 * only): this is a strictly wider closed set (any validated commit sha, not
 * just the two workspace-relative revisions `PlainScmProvider` deals in), and
 * keeping it a distinct scheme means neither `git-uri.ts` nor
 * `plain-git-content-provider.ts` (both already tested against the narrower
 * `head`/`index` shape) needs to grow a third case at all — this file is the
 * *only* consumer of `git_show_commit_blob`.
 */
export const PLAIN_GIT_COMMIT_BLOB_SCHEME = "plain-git-commit-blob";

/**
 * The multi-diff editor's own `multiDiffSource` scheme for "the file list
 * this commit changed" — resolved by [`PlainGitCommitMultiDiffSourceResolver`]
 * into the actual [`MultiDiffEditorItem`] array via `gitShowCommit`. The sha
 * is carried directly in the URI path (never the query): it is always exactly
 * 40 lowercase hex characters, which needs no escaping the way an arbitrary
 * repository path does (see `git-uri.ts`'s own doc comment for why *that*
 * scheme instead uses the query for its `path` field).
 */
export const PLAIN_GIT_COMMIT_SOURCE_SCHEME = "plain-git-commit";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ROOT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isCommitSha(value: string): boolean {
	return COMMIT_SHA_PATTERN.test(value);
}

export interface GitCommitBlobResourceQuery {
	readonly rootId: string;
	readonly sha: string;
	readonly path: string;
}

export function encodeGitCommitBlobResourceUri(
	rootId: string,
	sha: string,
	relativePath: string,
): URI {
	return URI.from({
		scheme: PLAIN_GIT_COMMIT_BLOB_SCHEME,
		authority: rootId,
		path: relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
		query: JSON.stringify({ sha, path: relativePath }),
	});
}

/** Returns `undefined` for any URI that is not one of ours (wrong scheme, or
 * a query that does not decode to the exact shape this module encodes) —
 * [`PlainGitCommitBlobContentProvider.provideTextContent`] treats that as
 * "not mine to resolve" (returns `null`), never a thrown error — mirrors
 * `git-uri.ts`'s own `decodeGitResourceUri` precedent exactly. */
export function decodeGitCommitBlobResourceUri(
	uri: URI,
): GitCommitBlobResourceQuery | undefined {
	if (
		uri.scheme !== PLAIN_GIT_COMMIT_BLOB_SCHEME ||
		!ROOT_ID_PATTERN.test(uri.authority)
	) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(uri.query) as unknown;
	} catch {
		return undefined;
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		Object.getPrototypeOf(parsed) !== Object.prototype ||
		Reflect.ownKeys(parsed).length !== 2 ||
		!("sha" in parsed) ||
		!("path" in parsed)
	) {
		return undefined;
	}
	const { sha, path } = parsed as Record<string, unknown>;
	if (
		typeof sha !== "string" ||
		!isCommitSha(sha) ||
		typeof path !== "string" ||
		path.length === 0
	) {
		return undefined;
	}
	return Object.freeze({ rootId: uri.authority, sha, path });
}

/** Encodes the `multiDiffSource` URI [`PlainGitHistoryView`] hands to
 * `IEditorService.openEditor({ multiDiffSource, ... })` to open a commit's
 * changed-file list as a multi-diff editor. */
export function encodeGitCommitSourceUri(rootId: string, sha: string): URI {
	return URI.from({
		scheme: PLAIN_GIT_COMMIT_SOURCE_SCHEME,
		authority: rootId,
		path: `/${sha}`,
	});
}

/** Returns `undefined` for any URI that is not one of ours, mirroring
 * [`decodeGitCommitBlobResourceUri`]'s own contract. */
export function decodeGitCommitSourceUri(
	uri: URI,
): Readonly<{ rootId: string; sha: string }> | undefined {
	if (
		uri.scheme !== PLAIN_GIT_COMMIT_SOURCE_SCHEME ||
		!ROOT_ID_PATTERN.test(uri.authority)
	) {
		return undefined;
	}
	const sha = uri.path.startsWith("/") ? uri.path.slice(1) : uri.path;
	return isCommitSha(sha)
		? Object.freeze({ rootId: uri.authority, sha })
		: undefined;
}

/** Structural subset of `PlainBridge` [`PlainGitCommitBlobContentProvider`]
 * needs. */
export interface PlainGitCommitBlobBridge {
	gitShowCommitBlob(
		sha: string,
		path: string,
		rootId?: string,
	): Promise<GitShowBlobResult>;
}

/**
 * `F090` S2's read-only content provider for [`PLAIN_GIT_COMMIT_BLOB_SCHEME`]
 * — the same "self-built `ITextModelContentProvider`, never a full
 * `IFileSystemProvider`" shape `PlainGitTextModelContentProvider`
 * (`plain-git-content-provider.ts`) already establishes for the `git:`
 * scheme, just backed by `gitShowCommitBlob` instead of `gitShowBlob`. One
 * model per distinct `(rootId, sha, path)` tuple is cached for the lifetime of this
 * provider, for the identical reason that file's own doc comment gives: a
 * historical commit's blob is immutable the moment it is read, so there is
 * nothing to invalidate short of the model's own normal disposal.
 */
export class PlainGitCommitBlobContentProvider implements ITextModelContentProvider {
	readonly #cache = new Map<string, ITextModel>();

	constructor(
		private readonly bridge: PlainGitCommitBlobBridge,
		private readonly modelService: PlainScmModelFactory,
	) {}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const query = decodeGitCommitBlobResourceUri(resource);
		if (query === undefined) {
			return null;
		}
		const cacheKey = resource.toString();
		const cached = this.#cache.get(cacheKey);
		if (cached !== null && cached !== undefined && !cached.isDisposed()) {
			return cached;
		}
		const result = await this.bridge.gitShowCommitBlob(
			query.sha,
			query.path,
			query.rootId,
		);
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

/** Structural subset of `PlainBridge`
 * [`PlainGitCommitMultiDiffSourceResolver`] needs. */
export interface PlainGitCommitResolverBridge {
	gitShowCommit(sha: string, rootId?: string): Promise<GitShowCommitResult>;
}

/**
 * Maps one `GitShowCommitResult` file entry to the `[originalUri,
 * modifiedUri]` pair the multi-diff editor needs — `undefined` on either side
 * means "this side does not exist" (an added file has no original, a deleted
 * file has no modified), exactly matching `DiffStatusKind`'s own semantics.
 * `parentSha === null` (a root commit) never reaches the "needs an original
 * side" branch at all: every file in that case is `kind: "added"` (see
 * `GitShowCommitResult`'s own doc comment), so no root-commit special case is
 * needed here.
 */
function commitDiffUris(
	rootId: string,
	sha: string,
	parentSha: string | null,
	file: GitShowCommitResult["files"][number],
): { originalUri: URI | undefined; modifiedUri: URI | undefined } {
	const originalPath = file.origPath ?? file.path;
	const hasOriginal = file.kind !== "added" && parentSha !== null;
	const hasModified = file.kind !== "deleted";
	return {
		originalUri: hasOriginal
			? encodeGitCommitBlobResourceUri(
					rootId,
					parentSha as string,
					originalPath,
				)
			: undefined,
		modifiedUri: hasModified
			? encodeGitCommitBlobResourceUri(rootId, sha, file.path)
			: undefined,
	};
}

/**
 * `F090` S2's own `plain-git-commit:` `IMultiDiffSourceResolver` —
 * registered directly on `IMultiDiffSourceResolverService` (the override's
 * own clean service seam, see `docs/research/2026-07-26-git-history.md`'s
 * chat/AI-coupling audit), never the package's own bundled
 * `ScmMultiDiffSourceResolverContribution` (which resolves a *different*
 * scheme keyed off `ISCMProvider.historyProvider` — left as
 * `constObservable(undefined)`, per `PlainScmProvider`'s own established
 * contract, and therefore never reachable regardless). Each changed file
 * becomes one [`MultiDiffEditorItem`] whose `originalUri`/`modifiedUri` are
 * this module's own [`PLAIN_GIT_COMMIT_BLOB_SCHEME`] URIs, lazily resolved by
 * [`PlainGitCommitBlobContentProvider`] only once the multi-diff editor
 * actually renders that file's pane. `goToFileUri` is deliberately omitted
 * (`undefined`) for every item — a disclosed scope cut for this slice: the
 * diff panes themselves are fully functional without it, and wiring a
 * "reveal in the current working copy" action would need a workspace-root-
 * relative-to-absolute resolution this view has no other reason to import.
 */
export class PlainGitCommitMultiDiffSourceResolver implements IMultiDiffSourceResolver {
	constructor(private readonly bridge: PlainGitCommitResolverBridge) {}

	canHandleUri(uri: URI): boolean {
		return decodeGitCommitSourceUri(uri) !== undefined;
	}

	async resolveDiffSource(uri: URI): Promise<IResolvedMultiDiffSource> {
		const query = decodeGitCommitSourceUri(uri);
		if (query === undefined) {
			throw new Error(
				"plain-git-commit: URI does not carry a valid commit sha",
			);
		}
		const result = await this.bridge.gitShowCommit(query.sha, query.rootId);
		const items = result.files.map((file) => {
			const { originalUri, modifiedUri } = commitDiffUris(
				query.rootId,
				result.sha,
				result.parentSha,
				file,
			);
			return new MultiDiffEditorItem(
				originalUri,
				modifiedUri,
				undefined,
				undefined,
				undefined,
			);
		});
		return { resources: ValueWithChangeEvent.const(items) };
	}
}

/** Plain construction wrappers — mirror
 * `createPlainGitTextModelContentProvider`'s own "audited bootstrap bridge"
 * shape (`scripts/plain/boundary-contracts.mjs`'s
 * `validateWorkspaceProviderBootstrap` only recognizes `bridge` passed as the
 * first argument to a *function call*, never a bare `new` expression). */
export function createPlainGitCommitBlobContentProvider(
	bridge: PlainGitCommitBlobBridge,
	modelService: PlainScmModelFactory,
): PlainGitCommitBlobContentProvider {
	return new PlainGitCommitBlobContentProvider(bridge, modelService);
}

export function createPlainGitCommitMultiDiffSourceResolver(
	bridge: PlainGitCommitResolverBridge,
): PlainGitCommitMultiDiffSourceResolver {
	return new PlainGitCommitMultiDiffSourceResolver(bridge);
}
