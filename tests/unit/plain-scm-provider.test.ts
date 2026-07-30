import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import type {
	GitStatusEntry,
	GitStatusResult,
} from "../../app/platform/tauri/contracts";
import {
	classifyStatusEntries,
	PlainScmProvider,
	type PlainScmEditorOpener,
	type PlainScmModelFactory,
	type PlainScmProviderBridge,
} from "../../app/features/scm/plain-scm-provider";

const rootUri = URI.from({
	scheme: "plain-workspace",
	authority: "root-1",
	path: "/",
});

function fakeModelFactory(): PlainScmModelFactory {
	return {
		createModel(value, _languageSelection, resource) {
			let disposed = false;
			return {
				dispose() {
					disposed = true;
				},
				isDisposed() {
					return disposed;
				},
				uri: resource,
				getValue: () => value,
			} as unknown as ReturnType<PlainScmModelFactory["createModel"]>;
		},
	};
}

function fakeEditorOpener(): PlainScmEditorOpener & { readonly opened: URI[] } {
	const opened: URI[] = [];
	return {
		opened,
		async openEditor(input) {
			opened.push(input.resource);
			return undefined;
		},
	};
}

function fakeBridge(
	status: GitStatusResult,
): PlainScmProviderBridge & { calls: number } {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		set calls(value: number) {
			calls = value;
		},
		async gitStatus() {
			calls += 1;
			return status;
		},
	};
}

function statusWith(entries: readonly GitStatusEntry[]): GitStatusResult {
	return {
		branch: { oid: "0".repeat(40), head: "main", upstream: null },
		entries,
	};
}

describe("classifyStatusEntries", () => {
	it("puts an unstaged-only ordinary modification only in the working tree group", () => {
		const { workingTree, staged } = classifyStatusEntries([
			{
				type: "ordinary",
				indexStatus: ".",
				worktreeStatus: "M",
				submodule: {
					isSubmodule: false,
					commitChanged: false,
					trackedChanged: false,
					untrackedChanged: false,
				},
				modeHead: "100644",
				modeIndex: "100644",
				modeWorktree: "100644",
				hashHead: "a".repeat(40),
				hashIndex: "a".repeat(40),
				path: "src/a.ts",
			},
		]);
		expect(staged).toEqual([]);
		expect(workingTree).toEqual([
			{
				relativePath: "src/a.ts",
				origRelativePath: undefined,
				statusChar: "M",
				isConflict: false,
			},
		]);
	});

	it("puts a staged-and-unstaged (MM) ordinary entry in both groups", () => {
		const { workingTree, staged } = classifyStatusEntries([
			{
				type: "ordinary",
				indexStatus: "M",
				worktreeStatus: "M",
				submodule: {
					isSubmodule: false,
					commitChanged: false,
					trackedChanged: false,
					untrackedChanged: false,
				},
				modeHead: "100644",
				modeIndex: "100644",
				modeWorktree: "100644",
				hashHead: "a".repeat(40),
				hashIndex: "b".repeat(40),
				path: "src/b.ts",
			},
		]);
		expect(staged).toEqual([
			{
				relativePath: "src/b.ts",
				origRelativePath: undefined,
				statusChar: "M",
				isConflict: false,
			},
		]);
		expect(workingTree).toEqual([
			{
				relativePath: "src/b.ts",
				origRelativePath: undefined,
				statusChar: "M",
				isConflict: false,
			},
		]);
	});

	it("carries origPath for a staged rename", () => {
		const { staged } = classifyStatusEntries([
			{
				type: "renameOrCopy",
				indexStatus: "R",
				worktreeStatus: ".",
				submodule: {
					isSubmodule: false,
					commitChanged: false,
					trackedChanged: false,
					untrackedChanged: false,
				},
				modeHead: "100644",
				modeIndex: "100644",
				modeWorktree: "100644",
				hashHead: "a".repeat(40),
				hashIndex: "a".repeat(40),
				renameOrCopyKind: "rename",
				similarity: 100,
				path: "src/new-name.ts",
				origPath: "src/old-name.ts",
			},
		]);
		expect(staged).toEqual([
			{
				relativePath: "src/new-name.ts",
				origRelativePath: "src/old-name.ts",
				statusChar: "R",
				isConflict: false,
			},
		]);
	});

	it("maps untracked to the working tree group with a synthetic '?' status", () => {
		const { workingTree, staged } = classifyStatusEntries([
			{ type: "untracked", path: "new-file.txt" },
		]);
		expect(staged).toEqual([]);
		expect(workingTree).toEqual([
			{
				relativePath: "new-file.txt",
				origRelativePath: undefined,
				statusChar: "?",
				isConflict: false,
			},
		]);
	});

	it("maps unmerged to the working tree group flagged as a conflict", () => {
		const { workingTree, staged } = classifyStatusEntries([
			{
				type: "unmerged",
				indexStatus: "U",
				worktreeStatus: "U",
				submodule: {
					isSubmodule: false,
					commitChanged: false,
					trackedChanged: false,
					untrackedChanged: false,
				},
				modeStage1: "100644",
				modeStage2: "100644",
				modeStage3: "100644",
				modeWorktree: "100644",
				hashStage1: "a".repeat(40),
				hashStage2: "b".repeat(40),
				hashStage3: "c".repeat(40),
				path: "src/conflict.ts",
			},
		]);
		expect(staged).toEqual([]);
		expect(workingTree).toEqual([
			{
				relativePath: "src/conflict.ts",
				origRelativePath: undefined,
				statusChar: "U",
				isConflict: true,
			},
		]);
	});

	it("drops ignored entries entirely", () => {
		expect(classifyStatusEntries([{ type: "ignored", path: "dist/" }])).toEqual(
			{
				workingTree: [],
				staged: [],
			},
		);
	});
});

describe("PlainScmProvider", () => {
	it("applies a status snapshot into exactly two resource groups with matching ids and rootUri-relative source URIs", () => {
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			fakeBridge(statusWith([])),
			fakeEditorOpener(),
			fakeModelFactory(),
		);
		provider.applyStatus(
			statusWith([
				{ type: "untracked", path: "a.txt" },
				{
					type: "ordinary",
					indexStatus: "M",
					worktreeStatus: ".",
					submodule: {
						isSubmodule: false,
						commitChanged: false,
						trackedChanged: false,
						untrackedChanged: false,
					},
					modeHead: "100644",
					modeIndex: "100644",
					modeWorktree: "100644",
					hashHead: "a".repeat(40),
					hashIndex: "b".repeat(40),
					path: "b.txt",
				},
			]),
		);

		expect(provider.groups).toHaveLength(2);
		const [workingTree, staged] = provider.groups;
		expect(workingTree!.id).toBe("workingTree");
		expect(workingTree!.label).toBe("Changes");
		expect(workingTree!.resources).toHaveLength(1);
		expect(workingTree!.resources[0]!.sourceUri.toString()).toBe(
			URI.joinPath(rootUri, "a.txt").toString(),
		);
		expect(staged!.id).toBe("staged");
		expect(staged!.label).toBe("Staged Changes");
		expect(staged!.resources).toHaveLength(1);
		expect(staged!.resources[0]!.sourceUri.toString()).toBe(
			URI.joinPath(rootUri, "b.txt").toString(),
		);

		provider.dispose();
	});

	it("fires onDidChangeResourceGroups and onDidChangeResources on every applyStatus call", () => {
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			fakeBridge(statusWith([])),
			fakeEditorOpener(),
			fakeModelFactory(),
		);
		let groupChanges = 0;
		let resourceChanges = 0;
		provider.onDidChangeResourceGroups(() => {
			groupChanges += 1;
		});
		provider.onDidChangeResources(() => {
			resourceChanges += 1;
		});

		provider.applyStatus(statusWith([]));
		provider.applyStatus(statusWith([]));

		expect(groupChanges).toBe(2);
		expect(resourceChanges).toBe(2);
		provider.dispose();
	});

	it("refresh() calls the bridge once and re-derives groups from the result", async () => {
		const bridge = fakeBridge(
			statusWith([{ type: "untracked", path: "only-file.txt" }]),
		);
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			bridge,
			fakeEditorOpener(),
			fakeModelFactory(),
		);

		await provider.refresh();

		expect(bridge.calls).toBe(1);
		expect(provider.groups[0]!.resources).toHaveLength(1);
		provider.dispose();
	});

	it("getOriginalResource resolves a rootUri-relative path to a head git: URI, and null for a foreign resource", async () => {
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			fakeBridge(statusWith([])),
			fakeEditorOpener(),
			fakeModelFactory(),
		);

		const uri = await provider.getOriginalResource(
			URI.joinPath(rootUri, "src/a.ts"),
		);
		expect(uri).not.toBeNull();
		expect(uri!.scheme).toBe("git");

		const foreign = await provider.getOriginalResource(
			URI.from({
				scheme: "plain-workspace",
				authority: "other-root",
				path: "/a.ts",
			}),
		);
		expect(foreign).toBeNull();
		provider.dispose();
	});

	it("open() opens the resource's sourceUri via the injected editor opener and swallows a failure", async () => {
		const opener = fakeEditorOpener();
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			fakeBridge(statusWith([])),
			opener,
			fakeModelFactory(),
		);
		provider.applyStatus(statusWith([{ type: "untracked", path: "a.txt" }]));

		await provider.groups[0]!.resources[0]!.open(false);

		expect(opener.opened).toEqual([URI.joinPath(rootUri, "a.txt")]);
		provider.dispose();
	});

	it("dispose() disposes the input box text model", () => {
		let disposedModel = false;
		const modelFactory: PlainScmModelFactory = {
			createModel: () =>
				({
					dispose: () => {
						disposedModel = true;
					},
					isDisposed: () => disposedModel,
				}) as unknown as ReturnType<PlainScmModelFactory["createModel"]>,
		};
		const provider = new PlainScmProvider(
			"plain-git",
			rootUri,
			fakeBridge(statusWith([])),
			fakeEditorOpener(),
			modelFactory,
		);

		provider.dispose();

		expect(disposedModel).toBe(true);
	});
});
