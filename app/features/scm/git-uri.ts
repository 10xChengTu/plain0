import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import type { GitBlobRev } from "../../platform/tauri/contracts";

/**
 * `F080` S2's own read-only content scheme for "one version of a file as
 * git knows it" — consumed by `PlainGitTextModelContentProvider`
 * (./plain-git-content-provider.ts) and produced by
 * `PlainScmProvider.getOriginalResource` (./plain-scm-provider.ts). Mirrors
 * the real `vscode.git` extension's own `toGitUri` convention (JSON-encoded
 * `{ path, ref }` in the query string) rather than inventing a new one —
 * encoding the repository-toplevel-relative path and revision in the query
 * (not the URI path segment) means the path can contain any byte a real git
 * path can (spaces, non-ASCII, even a leading `-`) without needing its own
 * escaping scheme; `URI`'s own query serialization already round-trips
 * arbitrary JSON text.
 */
export const GIT_URI_SCHEME = "git" as const;

export interface GitResourceQuery {
	readonly rootId: string;
	readonly rev: GitBlobRev;
	readonly path: string;
}

const ROOT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isGitBlobRev(value: unknown): value is GitBlobRev {
	return value === "head" || value === "index";
}

export function encodeGitResourceUri(
	rootId: string,
	rev: GitBlobRev,
	relativePath: string,
): URI {
	return URI.from({
		scheme: GIT_URI_SCHEME,
		authority: rootId,
		path: relativePath.startsWith("/") ? relativePath : `/${relativePath}`,
		query: JSON.stringify({ rev, path: relativePath }),
	});
}

/** Returns `undefined` for any URI that is not one of ours (wrong scheme, or
 * a query that does not decode to the exact shape this module encodes) —
 * `PlainGitTextModelContentProvider.provideTextContent` treats that as "not
 * mine to resolve" (returns `null`), never a thrown error. */
export function decodeGitResourceUri(uri: URI): GitResourceQuery | undefined {
	if (uri.scheme !== GIT_URI_SCHEME || !ROOT_ID_PATTERN.test(uri.authority)) {
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
		!("rev" in parsed) ||
		!("path" in parsed)
	) {
		return undefined;
	}
	const { rev, path } = parsed as Record<string, unknown>;
	if (!isGitBlobRev(rev) || typeof path !== "string" || path.length === 0) {
		return undefined;
	}
	return Object.freeze({ rootId: uri.authority, rev, path });
}
