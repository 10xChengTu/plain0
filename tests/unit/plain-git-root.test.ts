import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	bindPlainGitBridge,
	gitUpstreamDisplayName,
	PlainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainGitWorkspaceRoot,
} from "../../app/features/scm/plain-git-root";
import type { PlainBridge } from "../../app/platform/tauri/contracts";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";

function folder(name: string, rootId: string) {
	return {
		name,
		uri: URI.from({
			scheme: "plain-workspace",
			authority: rootId,
			path: "/",
		}),
	};
}

function roots(): readonly PlainGitWorkspaceRoot[] {
	return plainGitRootsFromWorkspaceFolders([
		folder("alpha", ROOT_A),
		folder("beta", ROOT_B),
	]);
}

describe("plainGitRootsFromWorkspaceFolders", () => {
	it("projects valid workspace folders to stable Git roots", () => {
		const result = roots();
		expect(result.map(({ rootId, label }) => ({ rootId, label }))).toEqual([
			{ rootId: ROOT_A, label: "alpha" },
			{ rootId: ROOT_B, label: "beta" },
		]);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("fails closed for a malformed or duplicate root projection", () => {
		expect(
			plainGitRootsFromWorkspaceFolders([
				{
					name: "file",
					uri: URI.from({ scheme: "file", path: "/tmp" }),
				},
			]),
		).toEqual([]);
		expect(
			plainGitRootsFromWorkspaceFolders([
				{
					name: "nested",
					uri: URI.from({
						scheme: "plain-workspace",
						authority: ROOT_A,
						path: "/nested",
					}),
				},
			]),
		).toEqual([]);
		expect(
			plainGitRootsFromWorkspaceFolders([
				folder("alpha", ROOT_A),
				folder("duplicate", ROOT_A),
			]),
		).toEqual([]);
	});
});

describe("gitUpstreamDisplayName", () => {
	it("shortens a remote-tracking ref without rewriting another namespace", () => {
		expect(gitUpstreamDisplayName("refs/remotes/origin/main")).toBe(
			"origin/main",
		);
		expect(gitUpstreamDisplayName("refs/heads/main")).toBe("refs/heads/main");
	});
});

describe("PlainGitRootSelection", () => {
	it("auto-selects only a sole root and requires an explicit choice for multiple roots", () => {
		const selection = new PlainGitRootSelection();
		const [alpha, beta] = roots();
		expect(selection.resolve([alpha!])?.rootId).toBe(ROOT_A);
		expect(selection.resolve([alpha!, beta!])).toBeUndefined();
		expect(selection.select(ROOT_B, [alpha!, beta!])).toBe(true);
		expect(selection.resolve([alpha!, beta!])?.rootId).toBe(ROOT_B);
	});

	it("drops a stale explicit selection and rejects a foreign root id", () => {
		const selection = new PlainGitRootSelection();
		const [alpha, beta] = roots();
		expect(selection.select(ROOT_A, [alpha!, beta!])).toBe(true);
		expect(selection.resolve([beta!])).toEqual(beta);
		expect(selection.select(ROOT_A, [beta!])).toBe(false);
		expect(selection.resolve([alpha!, beta!])).toBeUndefined();
	});

	it("emits only for real state transitions and stops after disposal", () => {
		const selection = new PlainGitRootSelection();
		const listener = vi.fn();
		const registration = selection.onDidChange(listener);
		const [alpha, beta] = roots();
		selection.synchronize([alpha!]);
		selection.synchronize([alpha!]);
		selection.synchronize([alpha!, beta!]);
		expect(listener).toHaveBeenCalledTimes(2);
		registration.dispose();
		selection.select(ROOT_B, [alpha!, beta!]);
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("bindPlainGitBridge", () => {
	it("appends the immutable root id to every Git bridge method", async () => {
		const calls: Array<{ method: string; args: unknown[] }> = [];
		const bridge = new Proxy(
			{},
			{
				get:
					(_target, property) =>
					(...args: unknown[]) => {
						calls.push({ method: String(property), args });
						return Promise.resolve(undefined);
					},
			},
		) as PlainBridge;
		const rooted = bindPlainGitBridge(bridge, ROOT_A);

		await rooted.gitStatus();
		await rooted.gitDiffFiles(true);
		await rooted.gitShowBlob("head", "a.txt");
		await rooted.gitStagePaths(["a.txt"]);
		await rooted.gitUnstagePaths(["a.txt"]);
		await rooted.gitStageBlob("a.txt", new Uint8Array([1]));
		await rooted.gitCommit("message", false);
		await rooted.gitDiscardPaths(["a.txt"]);
		await rooted.gitNetworkPreview("fetch");
		await rooted.gitFetch();
		await rooted.gitPull();
		await rooted.gitPush(false);
		await rooted.gitNetworkCancel();
		await rooted.gitBlameFile("a.txt", null);
		await rooted.gitBlameCommitMessages(["a".repeat(40)]);
		await rooted.gitFileHistory("a.txt");
		await rooted.gitHistorySearch("message", "release");
		await rooted.gitLineHistoryList("a.txt", { start: 1, end: 2 });
		await rooted.gitLineHistoryDetail(
			"a.txt",
			{ start: 1, end: 2 },
			0,
			"a".repeat(40),
		);
		await rooted.gitShowCommit("a".repeat(40));
		await rooted.gitShowCommitBlob("a".repeat(40), "a.txt");
		await rooted.gitLogGraph(10);
		await rooted.gitRefsList();
		await rooted.gitRemotesList();
		await rooted.gitReflogList();
		await rooted.gitContributorsList();
		await rooted.gitBranchCreate("topic", "a".repeat(40));
		await rooted.gitBranchSwitch("topic");
		await rooted.gitBranchRename("topic", "renamed");
		await rooted.gitBranchDelete("renamed", false);
		await rooted.gitTagCreate("v1", "a".repeat(40), null);
		await rooted.gitTagDelete("v1");
		await rooted.gitRemoteAdd("origin", "https://example.invalid/repo.git");
		await rooted.gitRemoteRename("origin", "upstream");
		await rooted.gitRemoteSetUrl(
			"upstream",
			"push",
			"ssh://example.invalid/repo.git",
		);
		await rooted.gitRemoteRemove("upstream");
		await rooted.gitUpstreamSet("main", "origin/main");
		await rooted.gitUpstreamUnset("main");
		await rooted.gitHistoryState();
		await rooted.gitHistoryPreview("merge", "a".repeat(40));
		await rooted.gitMerge("a".repeat(40), "b".repeat(64));
		await rooted.gitRebase("a".repeat(40), "b".repeat(64));
		await rooted.gitCherryPick("a".repeat(40), "b".repeat(64));
		await rooted.gitRevert("a".repeat(40), "b".repeat(64));
		await rooted.gitReset("a".repeat(40), "hard", "b".repeat(64));
		await rooted.gitHistoryContinue("rebase");
		await rooted.gitHistoryAbort("rebase");
		await rooted.gitHistoryCancel();
		await rooted.gitStashList();
		await rooted.gitStashShow("a".repeat(40));
		await rooted.gitStashPush("message", true);
		await rooted.gitStashApply("a".repeat(40), false);
		await rooted.gitStashPop("a".repeat(40), false);
		await rooted.gitStashDrop("a".repeat(40));
		await rooted.gitWorktreeList();
		await rooted.gitWorktreeAdd("child", false, null);
		await rooted.gitWorktreeRemove("/tmp/child", false);

		expect(calls).toHaveLength(57);
		for (const call of calls) {
			expect(call.args.at(-1), call.method).toBe(ROOT_A);
		}
	});
});
