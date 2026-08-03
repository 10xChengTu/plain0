import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	historyPreviewDetail,
	PlainGitHistoryActionsController,
	type PlainGitHistoryActionsDialog,
	type PlainGitHistoryActionsQuickInput,
} from "../../app/features/scm/plain-git-history-actions";
import { plainGitInvalidation } from "../../app/features/scm/plain-git-invalidation";
import { plainGitRootSelection } from "../../app/features/scm/plain-git-root";
import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

class QueuedQuickInput implements PlainGitHistoryActionsQuickInput {
	readonly calls: Array<{
		readonly items: readonly Readonly<{
			readonly label: string;
			readonly description?: string;
			readonly detail?: string;
		}>[];
		readonly title: string;
	}> = [];

	constructor(readonly picks: Array<string | undefined>) {}

	async pick<T extends { readonly label: string }>(
		items: readonly T[],
		options: Readonly<{ title: string }>,
	): Promise<T | undefined> {
		this.calls.push({ items, title: options.title });
		const wanted = this.picks.shift();
		if (wanted === undefined) {
			return undefined;
		}
		const item = items.find((candidate) => candidate.label.includes(wanted));
		if (item === undefined) {
			throw new Error(`No Quick Pick item matched ${wanted}`);
		}
		return item;
	}
}

class QueuedDialog implements PlainGitHistoryActionsDialog {
	readonly calls: Array<{
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}> = [];

	constructor(readonly confirmations: boolean[]) {}

	async confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }> {
		this.calls.push(options);
		return { confirmed: this.confirmations.shift() ?? false };
	}
}

function fixture() {
	return {
		status: {
			branch: { oid: SHA_A, head: "main", upstream: null },
			entries: [
				{
					type: "ordinary" as const,
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
					hashHead: SHA_A,
					hashIndex: SHA_B,
					path: "tracked.txt",
				},
			],
		},
		graphForTest: {
			nodes: [
				{ sha: SHA_A, parents: [SHA_B], subject: "current" },
				{ sha: SHA_B, parents: [], subject: "feature commit" },
			],
			truncated: false,
		},
		refsForTest: {
			entries: [
				{
					kind: "branch" as const,
					fullName: "refs/heads/main",
					shortName: "main",
					targetSha: SHA_A,
					isAnnotatedTag: false,
					peeledSha: null,
					upstream: null,
					isHead: true,
				},
				{
					kind: "branch" as const,
					fullName: "refs/heads/feature",
					shortName: "feature",
					targetSha: SHA_B,
					isAnnotatedTag: false,
					peeledSha: null,
					upstream: null,
					isHead: false,
				},
			],
			truncated: false,
		},
		reflogForTest: {
			entries: [
				{
					sha: SHA_C,
					selector: "HEAD@{1}",
					committerTime: 123,
					summary: "orphaned work",
				},
			],
			truncated: false,
		},
		contributorsForTest: {
			entries: [
				{ name: "Ada", email: "ada@example.invalid", commits: 3 },
				{ name: "", email: "anonymous@example.invalid", commits: 1 },
			],
			truncated: false,
		},
	};
}

async function setup(
	quickInput: QueuedQuickInput,
	dialog = new QueuedDialog([]),
	overrides: Record<string, unknown> = {},
) {
	const bridge = createBrowserMockBridge({
		gitFixtureForTest: { ...fixture(), ...overrides },
	});
	const picked = await bridge.workspacePickRoots("add");
	await bridge.workspaceTrustGrant();
	const selectedRoot = picked.snapshot.roots[0]!;
	const root = Object.freeze({
		rootId: selectedRoot.rootId,
		label: selectedRoot.displayName,
		uri: URI.parse(selectedRoot.uri),
	});
	const notifications = { info: vi.fn(), error: vi.fn() };
	const controller = new PlainGitHistoryActionsController(bridge, {
		quickInput,
		dialog,
		notifications,
		roots: () => [root],
	});
	return { bridge, controller, dialog, notifications, root };
}

beforeEach(() => {
	plainGitRootSelection.synchronize([]);
});

describe("PlainGitHistoryActionsController", () => {
	it("selects a strict graph/ref target, confirms the Rust preview and merges", async () => {
		const run = await setup(
			new QueuedQuickInput(["feature"]),
			new QueuedDialog([true]),
		);
		const invalidation = vi.fn();
		const listener = plainGitInvalidation.onDidInvalidate(invalidation);

		await run.controller.merge();

		expect(run.dialog.calls[0]).toMatchObject({
			message: "Merge to feature?",
			primaryButton: "Merge",
		});
		expect(run.dialog.calls[0]?.detail).toContain(`Target: ${SHA_B}`);
		expect((await run.bridge.gitHistoryState(run.root.rootId)).headSha).toBe(
			SHA_B,
		);
		expect(invalidation).toHaveBeenCalledWith({ rootId: run.root.rootId });
		expect(run.notifications.info).toHaveBeenCalledWith(
			"Plain: Merge completed.",
		);
		listener.dispose();
	});

	it("keeps a cancelled hard reset write-free and names tracked discarded paths", async () => {
		const run = await setup(
			new QueuedQuickInput(["Hard Reset", "feature"]),
			new QueuedDialog([false]),
		);
		const reset = vi.spyOn(run.bridge, "gitReset");

		await run.controller.reset();

		expect(run.dialog.calls[0]?.primaryButton).toBe(
			"Hard Reset and Discard Tracked Changes",
		);
		expect(run.dialog.calls[0]?.detail).toContain(
			"Tracked local paths that will be discarded (1):\n  tracked.txt",
		);
		expect(run.dialog.calls[0]?.detail).toContain(
			"Untracked files are not deleted.",
		);
		expect(reset).not.toHaveBeenCalled();
	});

	it("surfaces conflicts, binds Continue to the current sequencer kind and refreshes", async () => {
		const run = await setup(
			new QueuedQuickInput(["feature"]),
			new QueuedDialog([true]),
			{ historyConflictForTest: { cherryPick: ["conflicted.txt"] } },
		);
		const invalidation = vi.fn();
		const listener = plainGitInvalidation.onDidInvalidate(invalidation);

		await run.controller.cherryPick();
		expect(
			(await run.bridge.gitHistoryState(run.root.rootId)).sequencer,
		).toMatchObject({
			kind: "cherryPick",
			conflictedPaths: ["conflicted.txt"],
		});
		expect(run.notifications.error).toHaveBeenCalledWith(
			expect.stringContaining("stopped with conflicts"),
		);

		const continuation = new PlainGitHistoryActionsController(run.bridge, {
			quickInput: new QueuedQuickInput([]),
			dialog: run.dialog,
			notifications: run.notifications,
			roots: () => [run.root],
		});
		await continuation.continueOperation();
		expect(
			(await run.bridge.gitHistoryState(run.root.rootId)).sequencer,
		).toBeNull();
		expect(invalidation).toHaveBeenCalledTimes(2);
		listener.dispose();
	});

	it("requires a DOM confirmation before abort and leaves Cancel as a distinct request", async () => {
		const run = await setup(
			new QueuedQuickInput(["feature"]),
			new QueuedDialog([true]),
			{ historyConflictForTest: { rebase: ["conflicted.txt"] } },
		);
		await run.controller.rebase();
		const abort = vi.spyOn(run.bridge, "gitHistoryAbort");
		const cancelledAbort = new PlainGitHistoryActionsController(run.bridge, {
			quickInput: new QueuedQuickInput([]),
			dialog: new QueuedDialog([false]),
			notifications: run.notifications,
			roots: () => [run.root],
		});
		await cancelledAbort.abortOperation();
		expect(abort).not.toHaveBeenCalled();

		const confirmedAbort = new PlainGitHistoryActionsController(run.bridge, {
			quickInput: new QueuedQuickInput([]),
			dialog: new QueuedDialog([true]),
			notifications: run.notifications,
			roots: () => [run.root],
		});
		await confirmedAbort.abortOperation();
		expect(abort).toHaveBeenCalledWith("rebase", run.root.rootId);
		expect(
			(await run.bridge.gitHistoryState(run.root.rootId)).sequencer,
		).toBeNull();

		const cancel = vi.spyOn(run.bridge, "gitHistoryCancel");
		await confirmedAbort.cancelOperation();
		expect(cancel).toHaveBeenCalledWith(run.root.rootId);
		expect(run.notifications.info).toHaveBeenCalledWith(
			expect.stringContaining("cancellation requested"),
		);
	});

	it("shows bounded reflog and contributor DTOs without issuing mutations", async () => {
		const reflogInput = new QueuedQuickInput([undefined]);
		const run = await setup(reflogInput);
		const merge = vi.spyOn(run.bridge, "gitMerge");
		await run.controller.showReflog();
		expect(reflogInput.calls[0]).toMatchObject({ title: "HEAD Reflog" });
		expect(reflogInput.calls[0]?.items[0]).toMatchObject({
			label: "HEAD@{1} orphaned work",
			description: "ccccccc",
		});

		const contributorInput = new QueuedQuickInput([undefined]);
		const contributor = new PlainGitHistoryActionsController(run.bridge, {
			quickInput: contributorInput,
			dialog: run.dialog,
			notifications: run.notifications,
			roots: () => [run.root],
		});
		await contributor.showContributors();
		expect(contributorInput.calls[0]).toMatchObject({ title: "Contributors" });
		expect(contributorInput.calls[0]?.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "Ada",
					description: "ada@example.invalid",
					detail: "3 commits",
				}),
			]),
		);
		expect(merge).not.toHaveBeenCalled();
	});
});

describe("historyPreviewDetail", () => {
	it("deduplicates bounded tracked path projections for hard-reset copy", () => {
		expect(
			historyPreviewDetail({
				operation: "resetHard",
				targetSha: SHA_B,
				headSha: SHA_A,
				ahead: 1,
				behind: 2,
				workingTreePaths: ["same.txt", "working.txt"],
				stagedPaths: ["same.txt", "staged.txt"],
				conflictedPaths: ["same.txt", "conflict.txt"],
				pathsTruncated: false,
				sequencer: null,
				previewToken: "d".repeat(64),
			}),
		).toContain(
			"Tracked local paths that will be discarded (4):\n  same.txt\n  working.txt\n  staged.txt\n  conflict.txt",
		);
	});
});
