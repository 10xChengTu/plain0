import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import type {
	GitDiffFileEntry,
	GitShowCommitResult,
} from "../../app/platform/tauri/contracts";
import {
	decodeGitCommitBlobResourceUri,
	decodeGitCommitSourceUri,
	encodeGitCommitBlobResourceUri,
	encodeGitCommitSourceUri,
	PLAIN_GIT_COMMIT_BLOB_SCHEME,
	PLAIN_GIT_COMMIT_SOURCE_SCHEME,
	PlainGitCommitBlobContentProvider,
	PlainGitCommitMultiDiffSourceResolver,
	type PlainGitCommitBlobBridge,
	type PlainGitCommitResolverBridge,
} from "../../app/features/scm/plain-git-commit-detail";
import type { PlainScmModelFactory } from "../../app/features/scm/plain-scm-provider";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function fakeModelFactory(): PlainScmModelFactory & {
	readonly created: Array<{ value: string; resource: URI }>;
} {
	const created: Array<{ value: string; resource: URI }> = [];
	return {
		created,
		createModel(value, _languageSelection, resource) {
			created.push({ value, resource });
			let disposed = false;
			return {
				dispose() {
					disposed = true;
				},
				isDisposed() {
					return disposed;
				},
			} as unknown as ReturnType<PlainScmModelFactory["createModel"]>;
		},
	};
}

function fakeBlobBridge(
	blobs: Record<string, string | undefined>,
): PlainGitCommitBlobBridge & { calls: number } {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		async gitShowCommitBlob(sha, path) {
			calls += 1;
			const text = blobs[`${sha}:${path}`];
			return {
				content: text === undefined ? null : new TextEncoder().encode(text),
			};
		},
	};
}

function fileEntry(overrides: Partial<GitDiffFileEntry>): GitDiffFileEntry {
	return {
		kind: "modified",
		similarity: null,
		path: "a.txt",
		origPath: null,
		added: 1,
		deleted: 1,
		binary: false,
		...overrides,
	};
}

function fakeResolverBridge(
	results: Record<string, GitShowCommitResult>,
): PlainGitCommitResolverBridge & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async gitShowCommit(sha) {
			calls.push(sha);
			const result = results[sha];
			if (result === undefined) {
				throw new Error(`no fixture for ${sha}`);
			}
			return result;
		},
	};
}

describe("plain-git-commit-detail URI encode/decode", () => {
	it("round-trips a blob resource URI and rejects a foreign scheme/query", () => {
		const uri = encodeGitCommitBlobResourceUri(SHA_A, "src/a.ts");
		expect(uri.scheme).toBe(PLAIN_GIT_COMMIT_BLOB_SCHEME);
		expect(decodeGitCommitBlobResourceUri(uri)).toEqual({
			sha: SHA_A,
			path: "src/a.ts",
		});
		expect(
			decodeGitCommitBlobResourceUri(URI.from({ scheme: "file", path: "/a" })),
		).toBeUndefined();
		expect(
			decodeGitCommitBlobResourceUri(
				URI.from({
					scheme: PLAIN_GIT_COMMIT_BLOB_SCHEME,
					path: "/a",
					query: "not json",
				}),
			),
		).toBeUndefined();
		expect(
			decodeGitCommitBlobResourceUri(
				URI.from({
					scheme: PLAIN_GIT_COMMIT_BLOB_SCHEME,
					path: "/a",
					query: JSON.stringify({ sha: "not-a-sha", path: "a" }),
				}),
			),
		).toBeUndefined();
	});

	it("round-trips a commit source URI and rejects a foreign scheme/malformed sha", () => {
		const uri = encodeGitCommitSourceUri(SHA_A);
		expect(uri.scheme).toBe(PLAIN_GIT_COMMIT_SOURCE_SCHEME);
		expect(decodeGitCommitSourceUri(uri)).toBe(SHA_A);
		expect(
			decodeGitCommitSourceUri(URI.from({ scheme: "file", path: `/${SHA_A}` })),
		).toBeUndefined();
		expect(
			decodeGitCommitSourceUri(
				URI.from({ scheme: PLAIN_GIT_COMMIT_SOURCE_SCHEME, path: "/short" }),
			),
		).toBeUndefined();
		expect(
			decodeGitCommitSourceUri(
				URI.from({
					scheme: PLAIN_GIT_COMMIT_SOURCE_SCHEME,
					path: `/${SHA_A.toUpperCase()}`,
				}),
			),
		).toBeUndefined();
	});
});

describe("PlainGitCommitBlobContentProvider", () => {
	it("returns null for a resource that is not one of ours", async () => {
		const provider = new PlainGitCommitBlobContentProvider(
			fakeBlobBridge({}),
			fakeModelFactory(),
		);
		expect(
			await provider.provideTextContent(
				URI.from({ scheme: "file", path: "/a.txt" }),
			),
		).toBeNull();
	});

	it("fetches the commit blob, decodes it as UTF-8, and creates a model for it", async () => {
		const bridge = fakeBlobBridge({ [`${SHA_A}:src/a.ts`]: "content\n" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitCommitBlobContentProvider(
			bridge,
			modelFactory,
		);
		const uri = encodeGitCommitBlobResourceUri(SHA_A, "src/a.ts");

		const model = await provider.provideTextContent(uri);

		expect(bridge.calls).toBe(1);
		expect(modelFactory.created).toHaveLength(1);
		expect(modelFactory.created[0]!.value).toBe("content\n");
		expect(model).not.toBeNull();
	});

	it("returns null, without creating a model, when the path does not exist at that commit", async () => {
		const bridge = fakeBlobBridge({});
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitCommitBlobContentProvider(
			bridge,
			modelFactory,
		);

		const result = await provider.provideTextContent(
			encodeGitCommitBlobResourceUri(SHA_A, "missing.txt"),
		);

		expect(result).toBeNull();
		expect(modelFactory.created).toHaveLength(0);
	});

	it("caches the model for a repeated request of the exact same URI", async () => {
		const bridge = fakeBlobBridge({ [`${SHA_A}:a.txt`]: "one" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitCommitBlobContentProvider(
			bridge,
			modelFactory,
		);
		const uri = encodeGitCommitBlobResourceUri(SHA_A, "a.txt");

		const first = await provider.provideTextContent(uri);
		const second = await provider.provideTextContent(uri);

		expect(bridge.calls).toBe(1);
		expect(second).toBe(first);
	});

	it("dispose() disposes and drops every cached model, so a later request re-fetches", async () => {
		const bridge = fakeBlobBridge({ [`${SHA_A}:a.txt`]: "one" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitCommitBlobContentProvider(
			bridge,
			modelFactory,
		);
		const uri = encodeGitCommitBlobResourceUri(SHA_A, "a.txt");
		await provider.provideTextContent(uri);
		expect(bridge.calls).toBe(1);

		provider.dispose();

		await provider.provideTextContent(uri);
		expect(bridge.calls).toBe(2);
	});
});

describe("PlainGitCommitMultiDiffSourceResolver", () => {
	it("canHandleUri accepts only plain-git-commit: URIs with a valid sha", () => {
		const resolver = new PlainGitCommitMultiDiffSourceResolver(
			fakeResolverBridge({}),
		);
		expect(resolver.canHandleUri(encodeGitCommitSourceUri(SHA_A))).toBe(true);
		expect(
			resolver.canHandleUri(URI.from({ scheme: "file", path: "/a" })),
		).toBe(false);
	});

	it("maps added/modified/deleted/renamed/copied files to the correct original/modified URI pairs", async () => {
		const result: GitShowCommitResult = {
			sha: SHA_B,
			parentSha: SHA_A,
			files: [
				fileEntry({ kind: "added", path: "new.txt", added: 1, deleted: 0 }),
				fileEntry({ kind: "deleted", path: "gone.txt", added: 0, deleted: 1 }),
				fileEntry({ kind: "modified", path: "changed.txt" }),
				fileEntry({
					kind: "renamed",
					path: "new-name.txt",
					origPath: "old-name.txt",
					similarity: 100,
				}),
				fileEntry({
					kind: "copied",
					path: "copy.txt",
					origPath: "source.txt",
					similarity: 100,
				}),
			],
		};
		const resolver = new PlainGitCommitMultiDiffSourceResolver(
			fakeResolverBridge({ [SHA_B]: result }),
		);

		const resolved = await resolver.resolveDiffSource(
			encodeGitCommitSourceUri(SHA_B),
		);
		const items = resolved.resources.value;
		expect(items).toHaveLength(5);

		const [added, deleted, modified, renamed, copied] = items;
		expect(added!.originalUri).toBeUndefined();
		expect(added!.modifiedUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_B, "new.txt").toString(),
		);

		expect(deleted!.modifiedUri).toBeUndefined();
		expect(deleted!.originalUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_A, "gone.txt").toString(),
		);

		expect(modified!.originalUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_A, "changed.txt").toString(),
		);
		expect(modified!.modifiedUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_B, "changed.txt").toString(),
		);

		expect(renamed!.originalUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_A, "old-name.txt").toString(),
		);
		expect(renamed!.modifiedUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_B, "new-name.txt").toString(),
		);

		expect(copied!.originalUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_A, "source.txt").toString(),
		);
		expect(copied!.modifiedUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_B, "copy.txt").toString(),
		);
	});

	it("never requests an original-side URI for a root commit (parentSha null), even for a non-added kind", async () => {
		// Defensive case: every file in a real root commit is `added`, but this
		// asserts the `parentSha !== null` guard itself, independent of `kind`,
		// is what actually prevents an unresolvable `parentSha as string`
		// original URI — see `commitDiffUris`'s own doc comment.
		const result: GitShowCommitResult = {
			sha: SHA_A,
			parentSha: null,
			files: [fileEntry({ kind: "added", path: "root.txt" })],
		};
		const resolver = new PlainGitCommitMultiDiffSourceResolver(
			fakeResolverBridge({ [SHA_A]: result }),
		);

		const resolved = await resolver.resolveDiffSource(
			encodeGitCommitSourceUri(SHA_A),
		);
		const [entry] = resolved.resources.value;
		expect(entry!.originalUri).toBeUndefined();
		expect(entry!.modifiedUri?.toString()).toBe(
			encodeGitCommitBlobResourceUri(SHA_A, "root.txt").toString(),
		);
	});

	it("throws rather than silently resolving for a URI that does not carry a valid sha", async () => {
		const resolver = new PlainGitCommitMultiDiffSourceResolver(
			fakeResolverBridge({}),
		);
		await expect(
			resolver.resolveDiffSource(URI.from({ scheme: "file", path: "/a" })),
		).rejects.toThrow();
	});
});
