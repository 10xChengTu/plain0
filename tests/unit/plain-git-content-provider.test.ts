import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import { encodeGitResourceUri } from "../../app/features/scm/git-uri";
import {
	PlainGitTextModelContentProvider,
	type PlainGitContentBridge,
} from "../../app/features/scm/plain-git-content-provider";
import type { PlainScmModelFactory } from "../../app/features/scm/plain-scm-provider";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";

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

function fakeBridge(
	blobs: Record<string, string | undefined>,
): PlainGitContentBridge & { calls: number; rootIds: string[] } {
	let calls = 0;
	const rootIds: string[] = [];
	return {
		get calls() {
			return calls;
		},
		rootIds,
		async gitShowBlob(rev, path, rootId) {
			calls += 1;
			if (rootId !== undefined) {
				rootIds.push(rootId);
			}
			const key = `${rev}:${path}`;
			const text = blobs[key];
			return {
				content: text === undefined ? null : new TextEncoder().encode(text),
			};
		},
	};
}

describe("PlainGitTextModelContentProvider", () => {
	it("returns null for a resource whose scheme/query is not the git-uri.ts encoding", async () => {
		const provider = new PlainGitTextModelContentProvider(
			fakeBridge({}),
			fakeModelFactory(),
		);
		expect(
			await provider.provideTextContent(
				URI.from({ scheme: "file", path: "/a.txt" }),
			),
		).toBeNull();
	});

	it("fetches the blob, decodes it as UTF-8, and creates a model for it", async () => {
		const bridge = fakeBridge({ "head:src/a.ts": "console.log('hi');\n" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitTextModelContentProvider(bridge, modelFactory);

		const uri = encodeGitResourceUri(ROOT_A, "head", "src/a.ts");
		const model = await provider.provideTextContent(uri);

		expect(bridge.calls).toBe(1);
		expect(bridge.rootIds).toEqual([ROOT_A]);
		expect(modelFactory.created).toHaveLength(1);
		expect(modelFactory.created[0]!.value).toBe("console.log('hi');\n");
		expect(modelFactory.created[0]!.resource.toString()).toBe(uri.toString());
		expect(model).not.toBeNull();
	});

	it("returns null, without creating a model, when git reports no such version", async () => {
		const bridge = fakeBridge({});
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitTextModelContentProvider(bridge, modelFactory);

		const result = await provider.provideTextContent(
			encodeGitResourceUri(ROOT_A, "index", "does-not-exist.txt"),
		);

		expect(result).toBeNull();
		expect(modelFactory.created).toHaveLength(0);
	});

	it("caches the model for a repeated request of the exact same URI, without a second bridge call", async () => {
		const bridge = fakeBridge({ "head:a.txt": "one" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitTextModelContentProvider(bridge, modelFactory);
		const uri = encodeGitResourceUri(ROOT_A, "head", "a.txt");

		const first = await provider.provideTextContent(uri);
		const second = await provider.provideTextContent(uri);

		expect(bridge.calls).toBe(1);
		expect(modelFactory.created).toHaveLength(1);
		expect(second).toBe(first);
	});

	it("dispose() disposes and drops every cached model, so a later request re-fetches", async () => {
		const bridge = fakeBridge({ "head:a.txt": "one", "index:b.txt": "two" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitTextModelContentProvider(bridge, modelFactory);
		await provider.provideTextContent(
			encodeGitResourceUri(ROOT_A, "head", "a.txt"),
		);
		await provider.provideTextContent(
			encodeGitResourceUri(ROOT_A, "index", "b.txt"),
		);
		expect(bridge.calls).toBe(2);

		provider.dispose();

		// Re-request after dispose must re-fetch from the bridge rather than
		// reuse a (now-disposed, since dispose() also clears the cache) model.
		await provider.provideTextContent(
			encodeGitResourceUri(ROOT_A, "head", "a.txt"),
		);
		expect(bridge.calls).toBe(3);
	});

	it("does not share a cached model between two roots with the same revision and path", async () => {
		const bridge = fakeBridge({ "head:same.txt": "same" });
		const modelFactory = fakeModelFactory();
		const provider = new PlainGitTextModelContentProvider(bridge, modelFactory);

		await provider.provideTextContent(
			encodeGitResourceUri(ROOT_A, "head", "same.txt"),
		);
		await provider.provideTextContent(
			encodeGitResourceUri(ROOT_B, "head", "same.txt"),
		);

		expect(bridge.calls).toBe(2);
		expect(bridge.rootIds).toEqual([ROOT_A, ROOT_B]);
		expect(modelFactory.created).toHaveLength(2);
	});
});
