import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import {
	PlainGitManagementController,
	redactRemoteLocationForDisplay,
	type PlainGitManagementDialog,
	type PlainGitManagementQuickInput,
} from "../../app/features/scm/plain-git-management";
import { plainGitInvalidation } from "../../app/features/scm/plain-git-invalidation";
import { plainGitRootSelection } from "../../app/features/scm/plain-git-root";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

class QueuedQuickInput implements PlainGitManagementQuickInput {
	readonly picks: Array<string | undefined>;
	readonly inputs: Array<string | undefined>;

	constructor(
		picks: Array<string | undefined>,
		inputs: Array<string | undefined> = [],
	) {
		this.picks = [...picks];
		this.inputs = [...inputs];
	}

	async pick<T extends { readonly label: string }>(
		items: readonly T[],
	): Promise<T | undefined> {
		const wanted = this.picks.shift();
		if (wanted === undefined) {
			return undefined;
		}
		const picked = items.find(
			(item) => item.label === wanted || item.label.includes(wanted),
		);
		if (picked === undefined) {
			throw new Error(`No Quick Pick item matched ${wanted}`);
		}
		return picked;
	}

	async input(): Promise<string | undefined> {
		return this.inputs.shift();
	}
}

class QueuedDialog implements PlainGitManagementDialog {
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

function gitFixture() {
	return {
		status: {
			branch: { oid: SHA_A, head: "main", upstream: null },
			entries: [],
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
					fullName: "refs/heads/unmerged",
					shortName: "unmerged",
					targetSha: SHA_B,
					isAnnotatedTag: false,
					peeledSha: null,
					upstream: null,
					isHead: false,
				},
				{
					kind: "remoteBranch" as const,
					fullName: "refs/remotes/origin/main",
					shortName: "origin/main",
					targetSha: SHA_A,
					isAnnotatedTag: false,
					peeledSha: null,
					upstream: null,
					isHead: false,
				},
				{
					kind: "tag" as const,
					fullName: "refs/tags/existing",
					shortName: "existing",
					targetSha: SHA_A,
					isAnnotatedTag: false,
					peeledSha: null,
					upstream: null,
					isHead: false,
				},
			],
			truncated: false,
		},
		remotesForTest: {
			entries: [
				{
					name: "origin",
					fetchUrls: ["https://example.invalid/repo.git"],
					pushUrls: [],
				},
			],
			truncated: false,
		},
		branchUnmergedForTest: ["unmerged"],
	};
}

async function setup(
	quickInput: QueuedQuickInput,
	dialog = new QueuedDialog([]),
) {
	const bridge = createBrowserMockBridge({ gitFixtureForTest: gitFixture() });
	const selected = await bridge.workspacePickRoots("add");
	await bridge.workspaceTrustGrant();
	const selectedRoot = selected.snapshot.roots[0]!;
	const root = Object.freeze({
		rootId: selectedRoot.rootId,
		label: selectedRoot.displayName,
		uri: URI.parse(selectedRoot.uri),
	});
	const notifications = { info: vi.fn(), error: vi.fn() };
	const controller = new PlainGitManagementController(bridge, {
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

describe("PlainGitManagementController", () => {
	it("creates a branch and annotated tag from snapshot targets, then sets and unsets upstream", async () => {
		const created = await setup(
			new QueuedQuickInput(["Create Branch…", "HEAD"], ["feature"]),
		);
		const invalidations: string[] = [];
		const listener = plainGitInvalidation.onDidInvalidate(({ rootId }) =>
			invalidations.push(rootId),
		);
		await created.controller.manageBranches();
		expect(
			(await created.bridge.gitRefsList(created.root.rootId)).entries,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "branch", shortName: "feature" }),
			]),
		);

		const tagController = new PlainGitManagementController(created.bridge, {
			quickInput: new QueuedQuickInput(
				["Create Annotated Tag…", "HEAD"],
				["v1", "release message"],
			),
			dialog: created.dialog,
			notifications: created.notifications,
			roots: () => [created.root],
		});
		await tagController.manageTags();
		expect(
			(await created.bridge.gitRefsList(created.root.rootId)).entries,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tag",
					shortName: "v1",
					isAnnotatedTag: true,
				}),
			]),
		);

		const upstreamController = new PlainGitManagementController(
			created.bridge,
			{
				quickInput: new QueuedQuickInput([
					"feature",
					"Set Upstream…",
					"origin/main",
				]),
				dialog: created.dialog,
				notifications: created.notifications,
				roots: () => [created.root],
			},
		);
		await upstreamController.manageUpstream();
		expect(
			(await created.bridge.gitRefsList(created.root.rootId)).entries.find(
				(entry) => entry.shortName === "feature",
			)?.upstream,
		).toBe("refs/remotes/origin/main");

		const unsetController = new PlainGitManagementController(created.bridge, {
			quickInput: new QueuedQuickInput(["feature", "Unset Upstream"]),
			dialog: created.dialog,
			notifications: created.notifications,
			roots: () => [created.root],
		});
		await unsetController.manageUpstream();
		expect(
			(await created.bridge.gitRefsList(created.root.rootId)).entries.find(
				(entry) => entry.shortName === "feature",
			)?.upstream,
		).toBeNull();
		expect(invalidations).toEqual(Array(4).fill(created.root.rootId));
		expect(created.notifications.error).not.toHaveBeenCalled();
		listener.dispose();
	});

	it("does not force-delete an unmerged branch until the danger dialog confirms", async () => {
		const cancelled = await setup(
			new QueuedQuickInput(["unmerged", "Delete Branch"]),
			new QueuedDialog([false]),
		);
		const invalidation = vi.fn();
		const listener = plainGitInvalidation.onDidInvalidate(invalidation);
		await cancelled.controller.manageBranches();
		expect(
			(await cancelled.bridge.gitRefsList(cancelled.root.rootId)).entries.some(
				(entry) => entry.shortName === "unmerged",
			),
		).toBe(true);
		expect(cancelled.dialog.calls[0]).toMatchObject({
			primaryButton: "Force Delete Branch",
		});
		expect(invalidation).not.toHaveBeenCalled();

		const confirmed = new PlainGitManagementController(cancelled.bridge, {
			quickInput: new QueuedQuickInput(["unmerged", "Delete Branch"]),
			dialog: new QueuedDialog([true]),
			notifications: cancelled.notifications,
			roots: () => [cancelled.root],
		});
		await confirmed.manageBranches();
		expect(
			(await cancelled.bridge.gitRefsList(cancelled.root.rootId)).entries.some(
				(entry) => entry.shortName === "unmerged",
			),
		).toBe(false);
		expect(invalidation).toHaveBeenCalledOnce();
		listener.dispose();
	});

	it("redacts the new remote URL in confirmation and keeps cancel write-free", async () => {
		const raw =
			"https://token:secret@example.invalid/new.git?access_token=private";
		const cancelled = await setup(
			new QueuedQuickInput(["origin", "Change Fetch URL…"], [raw]),
			new QueuedDialog([false]),
		);
		await cancelled.controller.manageRemotes();
		expect(cancelled.dialog.calls[0]?.detail).toContain(
			"https://<redacted>@example.invalid/new.git?<redacted>",
		);
		expect(cancelled.dialog.calls[0]?.detail).not.toContain("secret");
		expect(cancelled.dialog.calls[0]?.detail).not.toContain("private");
		expect(
			(await cancelled.bridge.gitRemotesList(cancelled.root.rootId)).entries[0]
				?.fetchUrls,
		).toEqual(["https://example.invalid/repo.git"]);

		const confirmed = new PlainGitManagementController(cancelled.bridge, {
			quickInput: new QueuedQuickInput(["origin", "Change Fetch URL…"], [raw]),
			dialog: new QueuedDialog([true]),
			notifications: cancelled.notifications,
			roots: () => [cancelled.root],
		});
		await confirmed.manageRemotes();
		expect(
			(await cancelled.bridge.gitRemotesList(cancelled.root.rootId)).entries[0]
				?.fetchUrls,
		).toEqual(["https://<redacted>@example.invalid/new.git?<redacted>"]);
	});

	it("keeps tag and remote removal cancel paths free of mutation", async () => {
		const tag = await setup(
			new QueuedQuickInput(["Delete existing"]),
			new QueuedDialog([false]),
		);
		await tag.controller.manageTags();
		expect(
			(await tag.bridge.gitRefsList(tag.root.rootId)).entries.some(
				(entry) => entry.shortName === "existing",
			),
		).toBe(true);

		const remote = new PlainGitManagementController(tag.bridge, {
			quickInput: new QueuedQuickInput(["origin", "Remove Remote"]),
			dialog: new QueuedDialog([false]),
			notifications: tag.notifications,
			roots: () => [tag.root],
		});
		await remote.manageRemotes();
		expect(await tag.bridge.gitRemotesList(tag.root.rootId)).toMatchObject({
			entries: [{ name: "origin" }],
		});
	});
});

describe("redactRemoteLocationForDisplay", () => {
	it("hides local paths, userinfo and query/fragment values", () => {
		expect(redactRemoteLocationForDisplay("/Users/private/repo")).toBe(
			"<local-path>",
		);
		expect(
			redactRemoteLocationForDisplay(
				"ssh://user:secret@example.invalid/repo.git#token",
			),
		).toBe("ssh://<redacted>@example.invalid/repo.git?<redacted>");
		expect(
			redactRemoteLocationForDisplay("git@example.invalid:org/repo.git"),
		).toBe("<redacted>@example.invalid:org/repo.git");
	});
});
