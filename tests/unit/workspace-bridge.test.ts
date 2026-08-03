import { describe, expect, it } from "vitest";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

import {
	createBrowserMockBridge,
	type BrowserMockBridgeOptions,
	type BrowserMockDirectoryCopyLimitsForTest,
	type BrowserMockDirectoryCopyObservation,
	type BrowserMockDirectoryFixtureEntryForTest,
	type BrowserMockSymlinkCopyObservation,
} from "../../app/platform/tauri/browser-mock";

const workspaceVersionPattern = /^wv1:[0-9a-f]{64}$/u;

function bytesFromHex(value: string): Uint8Array {
	return Uint8Array.from(
		value.match(/.{2}/gu)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
	);
}

describe("browser mock workspace bridge", () => {
	it("creates a fixed same-app window without mutating the current workspace", async () => {
		const calls: unknown[][] = [];
		const bridge = createBrowserMockBridge({
			onWindowCreateForTest: (...args: unknown[]) => calls.push(args),
		});
		const selected = await bridge.workspacePickRoots("replace");

		await bridge.windowCreate();

		expect(calls).toEqual([[]]);
		expect(await bridge.workspaceSnapshot()).toEqual(selected.snapshot);
	});

	it("closes every root once, preserves recent entries, and revokes old identities", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("add");
		const recentBefore = await bridge.workspaceRecentList();

		const closed = await bridge.workspaceCloseFolder();
		expect(closed.revision).toBe(selected.snapshot.revision + 1);
		expect(closed.roots).toEqual([]);
		const recentAfter = await bridge.workspaceRecentList();
		expect(recentAfter.revision).toBe(recentBefore.revision + 1);
		expect(recentAfter.entries).toEqual(recentBefore.entries);
		for (const root of selected.snapshot.roots) {
			await expect(bridge.workspaceStat(root.rootId, "")).rejects.toMatchObject(
				{
					code: "ROOT_NOT_AUTHORIZED",
				},
			);
		}

		const closedAgain = await bridge.workspaceCloseFolder();
		expect(closedAgain).toEqual(closed);
		expect((await bridge.workspaceRecentList()).revision).toBe(
			recentAfter.revision,
		);
	});

	it("requires an explicit authorized root for Git in a multi-root workspace", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("add");
		await bridge.workspaceTrustGrant();

		await expect(bridge.gitStatus()).rejects.toMatchObject({
			code: "GIT_ROOT_REQUIRED",
		});
		await expect(
			bridge.gitStatus(selected.snapshot.roots[1]!.rootId),
		).resolves.toMatchObject({ entries: [] });
		await expect(
			bridge.gitStatus("00000000-0000-4000-8000-000000000199"),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
	});

	it("returns root-bound F180 remote, reflog and contributor fixtures", async () => {
		const sha = "a".repeat(40);
		const bridge = createBrowserMockBridge({
			gitFixtureForTest: {
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
				reflogForTest: {
					entries: [
						{
							sha,
							selector: "HEAD@{0}",
							committerTime: 1,
							summary: "commit: sample",
						},
					],
					truncated: false,
				},
				contributorsForTest: {
					entries: [
						{
							name: "Plain",
							email: "plain@example.invalid",
							commits: 2,
						},
					],
					truncated: false,
				},
			},
		});
		const selected = await bridge.workspacePickRoots("add");
		await bridge.workspaceTrustGrant();
		const rootId = selected.snapshot.roots[0]!.rootId;

		expect(await bridge.gitRemotesList(rootId)).toMatchObject({
			entries: [{ name: "origin" }],
		});
		expect(await bridge.gitReflogList(rootId)).toMatchObject({
			entries: [{ sha }],
		});
		expect(await bridge.gitContributorsList(rootId)).toMatchObject({
			entries: [{ name: "Plain", commits: 2 }],
		});
		await expect(
			bridge.gitRemotesList("00000000-0000-4000-8000-000000000199"),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
	});

	it("simulates the root-bound F180 branch, tag, remote and upstream mutations", async () => {
		const shaA = "a".repeat(40);
		const shaB = "b".repeat(40);
		const bridge = createBrowserMockBridge({
			gitFixtureForTest: {
				status: {
					branch: { oid: shaA, head: "main", upstream: null },
					entries: [],
				},
				refsForTest: {
					entries: [
						{
							kind: "branch",
							fullName: "refs/heads/main",
							shortName: "main",
							targetSha: shaA,
							isAnnotatedTag: false,
							peeledSha: null,
							upstream: null,
							isHead: true,
						},
						{
							kind: "branch",
							fullName: "refs/heads/topic",
							shortName: "topic",
							targetSha: shaB,
							isAnnotatedTag: false,
							peeledSha: null,
							upstream: null,
							isHead: false,
						},
						{
							kind: "remoteBranch",
							fullName: "refs/remotes/origin/main",
							shortName: "origin/main",
							targetSha: shaA,
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
				branchUnmergedForTest: ["new-branch"],
			},
		});
		const selected = await bridge.workspacePickRoots("add");
		await bridge.workspaceTrustGrant();
		const rootId = selected.snapshot.roots[0]!.rootId;

		await bridge.gitBranchCreate("new-branch", shaA, rootId);
		await bridge.gitBranchSwitch("new-branch", rootId);
		expect((await bridge.gitStatus(rootId)).branch.head).toBe("new-branch");
		await bridge.gitBranchRename("new-branch", "renamed", rootId);
		await bridge.gitBranchSwitch("main", rootId);
		expect(await bridge.gitBranchDelete("renamed", false, rootId)).toBe(
			"needsForce",
		);
		expect(await bridge.gitBranchDelete("renamed", true, rootId)).toBe(
			"deleted",
		);

		await bridge.gitTagCreate("v1", shaA, "release", rootId);
		expect((await bridge.gitRefsList(rootId)).entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					shortName: "v1",
					isAnnotatedTag: true,
				}),
			]),
		);
		await bridge.gitTagDelete("v1", rootId);

		await bridge.gitRemoteAdd(
			"backup",
			"https://token@example.invalid/backup.git?secret=yes",
			rootId,
		);
		await bridge.gitRemoteSetUrl(
			"backup",
			"push",
			"ssh://user@example.invalid/backup.git",
			rootId,
		);
		await bridge.gitRemoteRename("backup", "mirror", rootId);
		expect(await bridge.gitRemotesList(rootId)).toMatchObject({
			entries: expect.arrayContaining([
				{
					name: "mirror",
					fetchUrls: [
						"https://<redacted>@example.invalid/backup.git?<redacted>",
					],
					pushUrls: ["ssh://<redacted>@example.invalid/backup.git"],
				},
			]),
		});

		await bridge.gitUpstreamSet("topic", "origin/main", rootId);
		expect(
			(await bridge.gitRefsList(rootId)).entries.find(
				(entry) => entry.shortName === "topic",
			)?.upstream,
		).toBe("refs/remotes/origin/main");
		await bridge.gitUpstreamUnset("topic", rootId);
		await bridge.gitRemoteRemove("origin", rootId);
		expect(
			(await bridge.gitRefsList(rootId)).entries.some(
				(entry) => entry.shortName === "origin/main",
			),
		).toBe(false);

		await expect(
			bridge.gitRemoteAdd("bad/name", "https://example.invalid", rootId),
		).rejects.toMatchObject({ code: "GIT_REMOTE_MANAGEMENT_INVALID_REQUEST" });
	});

	it("isolates each instance and preserves revisions for cancellation and duplicates", async () => {
		const bridge = createBrowserMockBridge({
			workspacePicks: ["selected", "cancelled", "selected"],
		});
		const isolated = createBrowserMockBridge();

		const selected = await bridge.workspacePickRoots("replace");
		const cancelled = await bridge.workspacePickRoots("add");
		const duplicate = await bridge.workspacePickRoots("replace");

		expect(selected.status).toBe("selected");
		expect(selected.snapshot.revision).toBe(1);
		expect(selected.snapshot.roots).toHaveLength(1);
		expect(cancelled.status).toBe("cancelled");
		expect(cancelled.snapshot).toEqual(selected.snapshot);
		expect(duplicate.snapshot.revision).toBe(1);
		expect(await isolated.workspaceSnapshot()).toMatchObject({
			revision: 0,
			roots: [],
		});
	});

	it("authorizes the selected Save As parent, preserves cancellation, and reports existing receipts", async () => {
		const bridge = createBrowserMockBridge({
			workspaceSavePicks: [
				{ status: "cancelled" },
				{ status: "selected", rootIndex: 1, name: "draft.txt" },
				{ status: "selected", rootIndex: 0, name: "README.md" },
			],
		});
		const before = await bridge.workspaceSnapshot();
		const cancelled = await bridge.workspacePickSaveTarget("Untitled-1.txt");
		expect(cancelled).toEqual({
			status: "cancelled",
			snapshot: before,
			target: null,
		});

		const fresh = await bridge.workspacePickSaveTarget("Untitled-1.txt");
		expect(fresh.snapshot.revision).toBe(1);
		expect(fresh.snapshot.roots[0]?.displayName).toBe("plain-library");
		expect(fresh.target).toMatchObject({
			relativePath: "draft.txt",
			existingStat: null,
		});
		const existing = await bridge.workspacePickSaveTarget("ignored.txt");
		expect(existing.snapshot.revision).toBe(2);
		expect(existing.target?.existingStat).toMatchObject({
			kind: "file",
			version: expect.stringMatching(workspaceVersionPattern),
		});
		expect(Object.isFrozen(existing.target?.existingStat)).toBe(true);
	});

	it("returns deeply frozen copies rather than mutable mock state", async () => {
		const bridge = createBrowserMockBridge();
		const first = await bridge.workspacePickRoots("add");
		const second = await bridge.workspaceSnapshot();

		expect(first.snapshot).not.toBe(second);
		expect(first.snapshot.roots).not.toBe(second.roots);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.snapshot)).toBe(true);
		expect(Object.isFrozen(first.snapshot.roots)).toBe(true);
		expect(Object.isFrozen(first.snapshot.roots[0])).toBe(true);
		expect(() => {
			(first.snapshot.roots as unknown[]).push({});
		}).toThrow(TypeError);
		expect(await bridge.workspaceSnapshot()).toEqual(second);
	});

	it("increments once per changed selection and returns structured removal errors", async () => {
		const bridge = createBrowserMockBridge();
		const picked = await bridge.workspacePickRoots("add");
		expect(picked.snapshot.revision).toBe(1);
		expect(picked.snapshot.roots).toHaveLength(2);

		const removed = await bridge.workspaceRemoveRoot(
			picked.snapshot.roots[0]!.rootId,
		);
		expect(removed.revision).toBe(2);
		expect(removed.roots).toHaveLength(1);
		await expect(
			bridge.workspaceRemoveRoot(picked.snapshot.roots[0]!.rootId),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
	});

	it("replaces prior roots and revokes the removed mock capability", async () => {
		const bridge = createBrowserMockBridge();
		const added = await bridge.workspacePickRoots("add");
		const removedRootId = added.snapshot.roots[1]!.rootId;

		const replaced = await bridge.workspacePickRoots("replace");
		expect(replaced.snapshot.revision).toBe(2);
		expect(replaced.snapshot.roots).toEqual([added.snapshot.roots[0]]);
		await expect(
			bridge.workspaceRemoveRoot(removedRootId),
		).rejects.toMatchObject({
			code: "ROOT_NOT_AUTHORIZED",
		});

		const unchanged = await bridge.workspacePickRoots("replace");
		expect(unchanged.snapshot).toEqual(replaced.snapshot);
	});

	it("serves a deterministic immutable bounded file tree", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		const rootStat = await bridge.workspaceStat(rootId, "");
		const fileStat = await bridge.workspaceStat(rootId, "binary.bin");
		const root = await bridge.workspaceReadDirectory(rootId, "");
		const source = await bridge.workspaceReadDirectory(rootId, "src");
		const file = await bridge.workspaceReadFile(rootId, "binary.bin");

		expect(rootStat).toMatchObject({ kind: "directory", size: 0 });
		expect(fileStat).toMatchObject({ kind: "file", size: 6 });
		expect(fileStat.version).toMatch(workspaceVersionPattern);
		expect(root.entries.map(({ name }) => name)).toEqual([
			".plainrc",
			"README.md",
			"binary.bin",
			"empty",
			"fixtures",
			"src",
		]);
		expect(source.entries).toEqual([{ name: "main.ts", kind: "file" }]);
		expect(Object.isFrozen(rootStat)).toBe(true);
		expect(Object.isFrozen(root)).toBe(true);
		expect(Object.isFrozen(root.entries)).toBe(true);
		expect(Object.isFrozen(file)).toBe(true);
		expect(Object.isFrozen(file.stat)).toBe(true);
		expect(Object.isFrozen(file.value)).toBe(true);
		expect(file.stat).toEqual({
			kind: "file",
			size: 6,
			mtime: 1_700_000_000_000,
			ctime: 1_699_999_000_000,
			version: fileStat.version,
		});
		const first = file.value.copy();
		const second = file.value.copy();
		expect([...first]).toEqual([0, 255, 128, 1, 0, 42]);
		expect(first).not.toBe(second);
		first[0] = 99;
		expect([...second]).toEqual([0, 255, 128, 1, 0, 42]);
		expect([...file.value.copy()]).toEqual([0, 255, 128, 1, 0, 42]);

		const symlinkFile = await bridge.workspaceReadFile(
			rootId,
			"fixtures/file-link",
		);
		expect(symlinkFile.stat).toMatchObject({
			kind: "symlinkFile",
			version: null,
		});
		expect(new TextDecoder().decode(symlinkFile.value.copy())).toBe(
			"# Plain browser workspace\n",
		);
	});

	it("reads tokenless files through only root-internal symlink directories", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const linkStat = await bridge.workspaceStat(
			rootId,
			"fixtures/directory-link",
		);
		const linkedDirectory = await bridge.workspaceReadDirectory(
			rootId,
			"fixtures/directory-link",
		);
		const direct = await bridge.workspaceReadFile(rootId, "src/main.ts");
		const nestedStat = await bridge.workspaceStat(
			rootId,
			"fixtures/directory-link/main.ts",
		);
		const throughInternalLink = await bridge.workspaceReadFile(
			rootId,
			"fixtures/directory-link/main.ts",
		);

		expect(linkStat).toMatchObject({
			kind: "symlinkDirectory",
			version: null,
		});
		expect(linkedDirectory.entries).toEqual([
			{ name: "main.ts", kind: "file" },
		]);
		expect(nestedStat).toMatchObject({ kind: "file", version: null });
		expect(throughInternalLink.stat).toEqual({
			kind: "file",
			size: direct.stat.size,
			mtime: direct.stat.mtime,
			ctime: direct.stat.ctime,
			version: null,
		});
		expect(throughInternalLink.value.copy()).toEqual(direct.value.copy());

		for (const basePath of [
			"fixtures/external-link",
			"fixtures/dangling-link",
			"fixtures/loop-link",
		]) {
			expect(await bridge.workspaceStat(rootId, basePath)).toMatchObject({
				kind: "symlink",
				version: null,
			});
			for (const operation of [
				() => bridge.workspaceReadDirectory(rootId, basePath),
				() => bridge.workspaceReadFile(rootId, basePath),
				() => bridge.workspaceStat(rootId, `${basePath}/private.ts`),
				() => bridge.workspaceReadDirectory(rootId, `${basePath}/private.ts`),
				() => bridge.workspaceReadFile(rootId, `${basePath}/private.ts`),
			]) {
				await expect(operation()).rejects.toEqual({
					code: "ENTRY_TYPE_MISMATCH",
					message: "The workspace entry has an incompatible type.",
				});
			}
		}
	});

	it("writes only against the exact issued version and rotates the token", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const before = await bridge.workspaceReadFile(rootId, "binary.bin");
		const content = bytesFromHex(workspaceVersionFixture.write.contentHex);

		expect(before.stat.version).toMatch(workspaceVersionPattern);
		const first = await bridge.workspaceWriteFile(
			rootId,
			"binary.bin",
			before.stat.version!,
			content,
		);
		expect(first.status).toBe("written");
		if (first.status !== "written") {
			throw new Error("Expected the browser mock write to finish.");
		}
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.stat)).toBe(true);
		expect(first.stat).toMatchObject({
			kind: "file",
			size: content.byteLength,
		});
		expect(first.stat.version).toMatch(workspaceVersionPattern);
		expect(first.stat.version).not.toBe(before.stat.version);
		expect(
			(await bridge.workspaceReadFile(rootId, "binary.bin")).value.copy(),
		).toEqual(content);

		await expect(
			bridge.workspaceWriteFile(
				rootId,
				"binary.bin",
				before.stat.version!,
				new Uint8Array(content.byteLength),
			),
		).rejects.toMatchObject({ code: "WORKSPACE_FILE_MODIFIED" });
		const second = await bridge.workspaceWriteFile(
			rootId,
			"binary.bin",
			first.stat.version!,
			new Uint8Array(),
		);
		expect(second.status).toBe("written");
		if (second.status === "written") {
			expect(second.stat.size).toBe(0);
			expect(second.stat.version).not.toBe(first.stat.version);
		}
	});

	it("publishes a new file atomically and never replaces an existing target", async () => {
		const bridge = createBrowserMockBridge({
			workspaceSavePicks: [
				{ status: "selected", rootIndex: 1, name: "draft.bin" },
			],
		});
		const picked = await bridge.workspacePickSaveTarget("Untitled-1.txt");
		const target = picked.target!;
		const backing = new Uint8Array([9, 0, 0x41, 0xff, 0x0a, 9]);
		const content = backing.subarray(1, 5);
		const published = await bridge.workspacePublishFile(
			target.rootId,
			target.relativePath,
			content,
		);
		backing.fill(7);

		expect(published.status).toBe("written");
		if (published.status !== "written") {
			throw new Error("Expected new-file publication to finish.");
		}
		expect(published.stat).toMatchObject({
			kind: "file",
			size: 4,
			version: expect.stringMatching(workspaceVersionPattern),
		});
		expect(
			(
				await bridge.workspaceReadFile(target.rootId, target.relativePath)
			).value.copy(),
		).toEqual(Uint8Array.from([0, 0x41, 0xff, 0x0a]));
		await expect(
			bridge.workspacePublishFile(
				target.rootId,
				target.relativePath,
				new Uint8Array([1]),
			),
		).rejects.toMatchObject({ code: "ENTRY_ALREADY_EXISTS" });
		expect(
			(
				await bridge.workspaceReadFile(target.rootId, target.relativePath)
			).value.copy(),
		).toEqual(Uint8Array.from([0, 0x41, 0xff, 0x0a]));
	});

	it("treats deletion after a versioned read as modification, never create", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const before = await bridge.workspaceReadFile(rootId, "binary.bin");
		const plan = await bridge.workspacePrepareDelete([
			{ rootId, relativePath: "binary.bin", recursive: false },
		]);
		await bridge.workspaceBeginDelete(plan.confirmationId);
		await expect(
			bridge.workspaceCommitDeleteEntry(
				plan.confirmationId,
				plan.entries[0]!.entryId,
				rootId,
				"binary.bin",
				false,
			),
		).resolves.toEqual({ status: "deleted" });

		await expect(
			bridge.workspaceWriteFile(
				rootId,
				"binary.bin",
				before.stat.version!,
				new Uint8Array([1, 2, 3]),
			),
		).rejects.toMatchObject({ code: "WORKSPACE_FILE_MODIFIED" });
		await expect(
			bridge.workspaceStat(rootId, "binary.bin"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("accepts exactly 8 MiB and rejects malformed tokens or 8 MiB plus one", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const baseline = await bridge.workspaceReadFile(rootId, "binary.bin");

		await expect(
			bridge.workspaceWriteFile(
				rootId,
				"binary.bin",
				"WV1:INVALID",
				new Uint8Array(),
			),
		).rejects.toMatchObject({ code: "WORKSPACE_FILE_MODIFIED" });
		await expect(
			bridge.workspaceWriteFile(
				rootId,
				"binary.bin",
				baseline.stat.version!,
				new Uint8Array(8 * 1_024 * 1_024 + 1),
			),
		).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });

		const maximum = new Uint8Array(8 * 1_024 * 1_024);
		maximum[0] = 1;
		maximum[maximum.byteLength - 1] = 2;
		const result = await bridge.workspaceWriteFile(
			rootId,
			"binary.bin",
			baseline.stat.version!,
			maximum,
		);
		expect(result.status).toBe("written");
		if (result.status === "written") {
			expect(result.stat.size).toBe(maximum.byteLength);
		}
	});

	it("keeps symlink and hardlink reads tokenless and refuses versioned writes", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "write-ineligible",
				entries: [
					{ path: ["source.bin"], kind: "file", bytes: [1] },
					{
						path: ["alias.bin"],
						kind: "hardlink",
						targetPath: ["source.bin"],
					},
				],
			},
		});
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const validLookingVersion = `wv1:${"a".repeat(64)}`;

		expect(
			(await bridge.workspaceReadFile(rootId, "fixtures/file-link")).stat
				.version,
		).toBeNull();
		expect(
			(await bridge.workspaceReadFile(rootId, "write-ineligible/source.bin"))
				.stat.version,
		).toBeNull();
		for (const path of [
			"fixtures/file-link",
			"fixtures/directory-link/main.ts",
			"write-ineligible/source.bin",
			"write-ineligible/alias.bin",
		]) {
			await expect(
				bridge.workspaceWriteFile(
					rootId,
					path,
					validLookingVersion,
					new Uint8Array(),
				),
			).rejects.toMatchObject({ code: "WORKSPACE_WRITE_UNSUPPORTED" });
		}
	});

	it("keeps files tokenless below writable or special-mode parents", async () => {
		for (const parentMode of [0o777, 0o2755]) {
			let rootId = "";
			const bridge = createBrowserMockBridge({
				onWorkspaceDeletePreparedForTest(_observation, mutations) {
					mutations.chmod(rootId, "src", parentMode);
				},
			});
			const selected = await bridge.workspacePickRoots("replace");
			rootId = selected.snapshot.roots[0]!.rootId;
			const before = await bridge.workspaceReadFile(rootId, "src/main.ts");
			expect(before.stat.version).toMatch(workspaceVersionPattern);

			const plan = await bridge.workspacePrepareDelete([
				{ rootId, relativePath: "README.md", recursive: false },
			]);
			await bridge.workspaceCancelDelete(plan.confirmationId);
			expect(
				(await bridge.workspaceReadFile(rootId, "src/main.ts")).stat.version,
			).toBeNull();
			await expect(
				bridge.workspaceWriteFile(
					rootId,
					"src/main.ts",
					before.stat.version!,
					new Uint8Array(),
				),
			).rejects.toMatchObject({ code: "WORKSPACE_WRITE_UNSUPPORTED" });
		}
	});

	it("rejects target, stage, and ancestor receipt changes before publication", async () => {
		const cases = [
			{
				name: "target",
				code: "WORKSPACE_CONFLICT",
				mutate: (
					mutations: Parameters<
						NonNullable<
							BrowserMockBridgeOptions["onWorkspaceWriteBeforePublicationForTest"]
						>
					>[1],
				) => mutations.rewriteTarget([1, 2, 3, 4, 5, 6]),
			},
			{
				name: "stage",
				code: "WORKSPACE_CONFLICT",
				mutate: (
					mutations: Parameters<
						NonNullable<
							BrowserMockBridgeOptions["onWorkspaceWriteBeforePublicationForTest"]
						>
					>[1],
				) => mutations.replaceStage([9, 9, 9, 9]),
			},
			{
				name: "ancestor",
				code: "WORKSPACE_CONFLICT",
				mutate: (
					mutations: Parameters<
						NonNullable<
							BrowserMockBridgeOptions["onWorkspaceWriteBeforePublicationForTest"]
						>
					>[1],
				) => mutations.changeAncestor(),
			},
		];

		for (const testCase of cases) {
			const bridge = createBrowserMockBridge({
				onWorkspaceWriteBeforePublicationForTest(_observation, mutations) {
					testCase.mutate(mutations);
				},
			});
			const selected = await bridge.workspacePickRoots("replace");
			const rootId = selected.snapshot.roots[0]!.rootId;
			const before = await bridge.workspaceReadFile(rootId, "binary.bin");
			await expect(
				bridge.workspaceWriteFile(
					rootId,
					"binary.bin",
					before.stat.version!,
					new Uint8Array([7, 7, 7, 7]),
				),
			).rejects.toMatchObject({ code: testCase.code });
			const after = await bridge.workspaceReadFile(rootId, "binary.bin");
			expect([...after.value.copy()]).not.toEqual([7, 7, 7, 7]);
			expect(testCase.name).toBeTruthy();
		}
	});

	it("preserves publication evidence across rename, sync, and postcheck failures", async () => {
		const renameFailure = createBrowserMockBridge({
			onWorkspaceWriteRenameForTest(_observation, mutations) {
				mutations.publishStage();
				return "reportedFailure";
			},
			onWorkspaceWriteAfterPublicationForTest(_observation, mutations) {
				mutations.rewriteTarget([9, 9, 9, 9]);
				return "changed";
			},
		});
		const renameRoot = (await renameFailure.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const renameBefore = await renameFailure.workspaceReadFile(
			renameRoot,
			"binary.bin",
		);
		expect(
			await renameFailure.workspaceWriteFile(
				renameRoot,
				"binary.bin",
				renameBefore.stat.version!,
				new Uint8Array([7, 7, 7, 7]),
			),
		).toEqual({
			status: "targetPublished",
			publicationEvidence: "targetObservedWritten",
			rename: "reportedFailure",
			directorySync: "synced",
			target: "changed",
		});

		const syncFailure = createBrowserMockBridge({
			onWorkspaceWriteDirectorySyncForTest: () => "failed",
		});
		const syncRoot = (await syncFailure.workspacePickRoots("replace")).snapshot
			.roots[0]!.rootId;
		const syncBefore = await syncFailure.workspaceReadFile(
			syncRoot,
			"binary.bin",
		);
		expect(
			await syncFailure.workspaceWriteFile(
				syncRoot,
				"binary.bin",
				syncBefore.stat.version!,
				new Uint8Array([8]),
			),
		).toEqual({
			status: "targetPublished",
			publicationEvidence: "targetObservedWritten",
			rename: "reportedSuccess",
			directorySync: "failed",
			target: "matchesWritten",
		});

		const syncChanged = createBrowserMockBridge({
			onWorkspaceWriteDirectorySyncForTest(_observation, mutations) {
				mutations.rewriteTarget([4, 4, 4, 4]);
				return "synced";
			},
		});
		const syncChangedRoot = (await syncChanged.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const syncChangedBefore = await syncChanged.workspaceReadFile(
			syncChangedRoot,
			"binary.bin",
		);
		expect(
			await syncChanged.workspaceWriteFile(
				syncChangedRoot,
				"binary.bin",
				syncChangedBefore.stat.version!,
				new Uint8Array([3, 3, 3, 3]),
			),
		).toEqual({
			status: "targetPublished",
			publicationEvidence: "renameReportedSuccess",
			rename: "reportedSuccess",
			directorySync: "synced",
			target: "changed",
		});

		for (const [targetResult, mutation] of [
			["changed", "rewriteTarget"],
			["unverifiable", "markTargetUnverifiable"],
		] as const) {
			const bridge = createBrowserMockBridge({
				onWorkspaceWriteAfterPublicationForTest(_observation, mutations) {
					if (mutation === "rewriteTarget") {
						mutations.rewriteTarget([6, 6, 6, 6]);
					} else {
						mutations.markTargetUnverifiable();
					}
					return targetResult;
				},
			});
			const rootId = (await bridge.workspacePickRoots("replace")).snapshot
				.roots[0]!.rootId;
			const before = await bridge.workspaceReadFile(rootId, "binary.bin");
			expect(
				await bridge.workspaceWriteFile(
					rootId,
					"binary.bin",
					before.stat.version!,
					new Uint8Array([5, 5, 5, 5]),
				),
			).toEqual({
				status: "targetPublished",
				publicationEvidence: "renameReportedSuccess",
				rename: "reportedSuccess",
				directorySync: "synced",
				target: targetResult,
			});
		}

		for (const targetResult of ["changed", "unverifiable"] as const) {
			const overrideOnly = createBrowserMockBridge({
				onWorkspaceWriteAfterPublicationForTest() {
					return targetResult;
				},
			});
			const rootId = (await overrideOnly.workspacePickRoots("replace")).snapshot
				.roots[0]!.rootId;
			const before = await overrideOnly.workspaceReadFile(rootId, "binary.bin");
			expect(
				await overrideOnly.workspaceWriteFile(
					rootId,
					"binary.bin",
					before.stat.version!,
					new Uint8Array([7, 7, 7, 7]),
				),
			).toEqual({
				status: "targetPublished",
				publicationEvidence: "renameReportedSuccess",
				rename: "reportedSuccess",
				directorySync: "synced",
				target: targetResult,
			});
		}
	});

	it("distinguishes safe rename failure from ambiguous native outcomes", async () => {
		const safe = createBrowserMockBridge({
			onWorkspaceWriteRenameForTest: () => "reportedFailure",
		});
		const safeRoot = (await safe.workspacePickRoots("replace")).snapshot
			.roots[0]!.rootId;
		const safeBefore = await safe.workspaceReadFile(safeRoot, "binary.bin");
		await expect(
			safe.workspaceWriteFile(
				safeRoot,
				"binary.bin",
				safeBefore.stat.version!,
				new Uint8Array([1]),
			),
		).rejects.toMatchObject({ code: "IO_FAILED" });
		expect(
			(await safe.workspaceReadFile(safeRoot, "binary.bin")).value.copy(),
		).toEqual(safeBefore.value.copy());

		let ambiguousSyncCalls = 0;
		const ambiguous = createBrowserMockBridge({
			onWorkspaceWriteRenameForTest(_observation, mutations) {
				mutations.changeAncestor();
				return "reportedFailure";
			},
			onWorkspaceWriteDirectorySyncForTest() {
				ambiguousSyncCalls += 1;
				return "failed";
			},
		});
		const ambiguousRoot = (await ambiguous.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const ambiguousBefore = await ambiguous.workspaceReadFile(
			ambiguousRoot,
			"binary.bin",
		);
		expect(
			await ambiguous.workspaceWriteFile(
				ambiguousRoot,
				"binary.bin",
				ambiguousBefore.stat.version!,
				new Uint8Array([2]),
			),
		).toEqual({
			status: "outcomeUnknown",
			observation: "native",
			rename: "reportedFailure",
			directorySync: "notAttempted",
			target: "ambiguous",
		});
		expect(ambiguousSyncCalls).toBe(0);

		const unavailable = createBrowserMockBridge({
			onWorkspaceWriteRenameForTest(_observation, mutations) {
				mutations.publishStage();
				throw new Error("simulated rename observation loss");
			},
		});
		const unavailableRoot = (await unavailable.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const unavailableBefore = await unavailable.workspaceReadFile(
			unavailableRoot,
			"binary.bin",
		);
		const unavailableResult = await unavailable.workspaceWriteFile(
			unavailableRoot,
			"binary.bin",
			unavailableBefore.stat.version!,
			new Uint8Array([3]),
		);
		expect(unavailableResult).toEqual({
			status: "outcomeUnknown",
			observation: "responseUnavailable",
			rename: "unobserved",
			directorySync: "unobserved",
			target: "ambiguous",
		});
		expect(Object.isFrozen(unavailableResult)).toBe(true);
		expect(
			(
				await unavailable.workspaceReadFile(unavailableRoot, "binary.bin")
			).value.copy(),
		).toEqual(new Uint8Array([3]));
	});

	it("linearizes root revocation and window close around an in-flight write", async () => {
		const rootFirst = createBrowserMockBridge();
		const rootFirstPick = await rootFirst.workspacePickRoots("replace");
		const rootFirstId = rootFirstPick.snapshot.roots[0]!.rootId;
		const rootFirstRead = await rootFirst.workspaceReadFile(
			rootFirstId,
			"binary.bin",
		);
		await rootFirst.workspaceRemoveRoot(rootFirstId);
		await expect(
			rootFirst.workspaceWriteFile(
				rootFirstId,
				"binary.bin",
				rootFirstRead.stat.version!,
				new Uint8Array([1]),
			),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });

		const writeFirst = createBrowserMockBridge({
			onWorkspaceWriteBeforePublicationForTest(_observation, mutations) {
				mutations.revokeRoot();
			},
		});
		const writeFirstId = (await writeFirst.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const writeFirstRead = await writeFirst.workspaceReadFile(
			writeFirstId,
			"binary.bin",
		);
		expect(
			(
				await writeFirst.workspaceWriteFile(
					writeFirstId,
					"binary.bin",
					writeFirstRead.stat.version!,
					new Uint8Array([2]),
				)
			).status,
		).toBe("written");
		await expect(
			writeFirst.workspaceStat(writeFirstId, "binary.bin"),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });

		const windowFirst = createBrowserMockBridge({
			onWorkspaceWriteBeforePublicationForTest(_observation, mutations) {
				mutations.closeWindow();
			},
		});
		const windowRoot = (await windowFirst.workspacePickRoots("replace"))
			.snapshot.roots[0]!.rootId;
		const windowRead = await windowFirst.workspaceReadFile(
			windowRoot,
			"binary.bin",
		);
		const firstWindowWrite = await windowFirst.workspaceWriteFile(
			windowRoot,
			"binary.bin",
			windowRead.stat.version!,
			new Uint8Array([3]),
		);
		expect(firstWindowWrite.status).toBe("written");
		if (firstWindowWrite.status !== "written") {
			throw new Error("Expected the first window write to finish.");
		}
		await expect(
			windowFirst.workspaceWriteFile(
				windowRoot,
				"binary.bin",
				firstWindowWrite.stat.version!,
				new Uint8Array([4]),
			),
		).rejects.toMatchObject({ code: "WORKSPACE_WINDOW_CLOSED" });
	});

	it("creates empty files and single directories without changing root revisions", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		const fileReceipt = await bridge.workspaceCreateFile(rootId, "created.txt");
		const directoryReceipt = await bridge.workspaceCreateDirectory(
			rootId,
			"created-directory",
		);
		const nestedReceipt = await bridge.workspaceCreateFile(
			rootId,
			"created-directory/nested.txt",
		);

		expect(await bridge.workspaceSnapshot()).toMatchObject({ revision: 1 });
		expect(fileReceipt).toEqual({
			kind: "file",
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
		});
		expect(directoryReceipt).toEqual({
			kind: "directory",
			size: 0,
			mtime: 0,
			ctime: 0,
			version: null,
		});
		expect(nestedReceipt.kind).toBe("file");
		expect(Object.isFrozen(fileReceipt)).toBe(true);
		expect(Object.isFrozen(directoryReceipt)).toBe(true);
		expect(await bridge.workspaceStat(rootId, "created.txt")).toMatchObject({
			kind: "file",
			size: 0,
		});
		expect(
			await bridge.workspaceStat(rootId, "created-directory"),
		).toMatchObject({ kind: "directory" });
		expect(
			(await bridge.workspaceReadDirectory(rootId, "created-directory"))
				.entries,
		).toEqual([{ name: "nested.txt", kind: "file" }]);
		expect(
			(
				await bridge.workspaceReadFile(rootId, "created-directory/nested.txt")
			).value.copy(),
		).toEqual(new Uint8Array());
	});

	it("creates atomically without clobbering any existing entry", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const before = (
			await bridge.workspaceReadFile(rootId, "README.md")
		).value.copy();

		for (const operation of [
			() => bridge.workspaceCreateFile(rootId, "README.md"),
			() => bridge.workspaceCreateDirectory(rootId, "README.md"),
			() => bridge.workspaceCreateFile(rootId, "src"),
			() => bridge.workspaceCreateDirectory(rootId, "src"),
		]) {
			await expect(operation()).rejects.toEqual({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
		}
		expect(
			(await bridge.workspaceReadFile(rootId, "README.md")).value.copy(),
		).toEqual(before);
		expect((await bridge.workspaceStat(rootId, "src")).kind).toBe("directory");

		const racing = await Promise.allSettled([
			bridge.workspaceCreateFile(rootId, "racing.txt"),
			bridge.workspaceCreateFile(rootId, "racing.txt"),
		]);
		expect(racing.filter(({ status }) => status === "fulfilled")).toHaveLength(
			1,
		);
		const rejected = racing.find(({ status }) => status === "rejected");
		expect(rejected).toMatchObject({
			status: "rejected",
			reason: { code: "ENTRY_ALREADY_EXISTS" },
		});
	});

	it("keeps mutable trees isolated per bridge and returns sanitized create errors", async () => {
		const first = createBrowserMockBridge();
		const second = createBrowserMockBridge();
		const firstRoot = (await first.workspacePickRoots("replace")).snapshot
			.roots[0]!;
		const secondRoot = (await second.workspacePickRoots("replace")).snapshot
			.roots[0]!;

		await first.workspaceCreateDirectory(firstRoot.rootId, "isolated");
		await expect(
			second.workspaceStat(secondRoot.rootId, "isolated"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			first.workspaceCreateFile(firstRoot.rootId, "missing/child.txt"),
		).rejects.toEqual({
			code: "ENTRY_NOT_FOUND",
			message: "The workspace entry does not exist.",
		});
		await expect(
			first.workspaceCreateDirectory(firstRoot.rootId, "README.md/child"),
		).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		await expect(
			first.workspaceCreateFile(firstRoot.rootId, ""),
		).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		const error = await first
			.workspaceCreateFile(firstRoot.rootId, "../private-secret")
			.catch((candidate: unknown) => candidate);
		expect(error).toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		expect(Object.isFrozen(error)).toBe(true);
		expect(JSON.stringify(error)).not.toContain("private-secret");
		await expect(
			first.workspaceCreateFile(
				"00000000-0000-4000-8000-000000000999",
				"private-secret",
			),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
	});

	it("renames files and directory subtrees within one root", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const readme = (
			await bridge.workspaceReadFile(rootId, "README.md")
		).value.copy();

		await bridge.workspaceRename(rootId, "README.md", "GUIDE.md");
		await expect(
			bridge.workspaceStat(rootId, "README.md"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		expect(
			(await bridge.workspaceReadFile(rootId, "GUIDE.md")).value.copy(),
		).toEqual(readme);

		await bridge.workspaceRename(rootId, "src", "source");
		await expect(bridge.workspaceStat(rootId, "src")).rejects.toMatchObject({
			code: "ENTRY_NOT_FOUND",
		});
		expect(
			(await bridge.workspaceReadDirectory(rootId, "source")).entries,
		).toEqual([{ name: "main.ts", kind: "file" }]);
		expect(
			(await bridge.workspaceReadFile(rootId, "source/main.ts")).value
				.byteLength,
		).toBeGreaterThan(0);

		await bridge.workspaceCreateDirectory(rootId, "destination");
		await bridge.workspaceRename(
			rootId,
			"source/main.ts",
			"destination/main.ts",
		);
		expect(
			(await bridge.workspaceReadDirectory(rootId, "source")).entries,
		).toEqual([]);
		expect(
			(await bridge.workspaceReadDirectory(rootId, "destination")).entries,
		).toEqual([{ name: "main.ts", kind: "file" }]);
		expect(await bridge.workspaceSnapshot()).toMatchObject({ revision: 1 });
	});

	it("renames atomically without clobbering targets", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const readme = (
			await bridge.workspaceReadFile(rootId, "README.md")
		).value.copy();
		const binary = (
			await bridge.workspaceReadFile(rootId, "binary.bin")
		).value.copy();

		for (const operation of [
			() => bridge.workspaceRename(rootId, "README.md", "binary.bin"),
			() => bridge.workspaceRename(rootId, "src", "empty"),
			() => bridge.workspaceRename(rootId, "README.md", "README.md"),
			() => bridge.workspaceRename(rootId, "missing", "missing"),
		]) {
			await expect(operation()).rejects.toEqual({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
		}
		expect(
			(await bridge.workspaceReadFile(rootId, "README.md")).value.copy(),
		).toEqual(readme);
		expect(
			(await bridge.workspaceReadFile(rootId, "binary.bin")).value.copy(),
		).toEqual(binary);
		expect((await bridge.workspaceStat(rootId, "src")).kind).toBe("directory");
		expect((await bridge.workspaceStat(rootId, "empty")).kind).toBe(
			"directory",
		);

		const racing = await Promise.allSettled([
			bridge.workspaceRename(rootId, "README.md", "racing-target"),
			bridge.workspaceRename(rootId, "binary.bin", "racing-target"),
		]);
		expect(racing.filter(({ status }) => status === "fulfilled")).toHaveLength(
			1,
		);
		expect(racing.filter(({ status }) => status === "rejected")).toHaveLength(
			1,
		);
		const remainingSources = await Promise.all(
			["README.md", "binary.bin"].map(async (path) =>
				bridge
					.workspaceStat(rootId, path)
					.then(() => path)
					.catch(() => undefined),
			),
		);
		expect(remainingSources.filter(Boolean)).toHaveLength(1);
		expect((await bridge.workspaceStat(rootId, "racing-target")).kind).toBe(
			"file",
		);
	});

	it("rejects invalid rename relationships and parents before mutation", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		await expect(
			bridge.workspaceRename(rootId, "missing", "target"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			bridge.workspaceRename(rootId, "README.md", "missing/target"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			bridge.workspaceRename(rootId, "README.md/child", "target"),
		).rejects.toMatchObject({ code: "ENTRY_TYPE_MISMATCH" });
		await expect(
			bridge.workspaceRename(rootId, "README.md", "binary.bin/target"),
		).rejects.toMatchObject({ code: "ENTRY_TYPE_MISMATCH" });
		for (const [sourcePath, targetPath] of [
			["", "target"],
			["source", ""],
		] as const) {
			await expect(
				bridge.workspaceRename(rootId, sourcePath, targetPath),
			).rejects.toEqual({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
		}

		for (const [sourcePath, targetPath] of [
			["src", "src/nested/target"],
			["README.md", "README.md/target"],
		] as const) {
			await expect(
				bridge.workspaceRename(rootId, sourcePath, targetPath),
			).rejects.toEqual({
				code: "WORKSPACE_CONFLICT",
				message: "The workspace rename conflicts with the source path.",
			});
		}
		expect((await bridge.workspaceStat(rootId, "src")).kind).toBe("directory");
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");

		await bridge.workspaceRename(rootId, "src", "src-copy");
		expect((await bridge.workspaceStat(rootId, "src-copy")).kind).toBe(
			"directory",
		);
	});

	it("keeps rename state isolated per bridge and errors sanitized", async () => {
		const first = createBrowserMockBridge();
		const second = createBrowserMockBridge();
		const firstRoot = (await first.workspacePickRoots("replace")).snapshot
			.roots[0]!;
		const secondRoot = (await second.workspacePickRoots("replace")).snapshot
			.roots[0]!;

		await first.workspaceRename(firstRoot.rootId, "README.md", "renamed.md");
		await expect(
			first.workspaceStat(firstRoot.rootId, "README.md"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		expect(
			(await second.workspaceStat(secondRoot.rootId, "README.md")).kind,
		).toBe("file");
		await expect(
			first.workspaceRename(
				"00000000-0000-4000-8000-000000000999",
				"private-source",
				"private-target",
			),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
		const error = await first
			.workspaceRename(firstRoot.rootId, "../private-source", "target")
			.catch((candidate: unknown) => candidate);
		expect(error).toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		expect(Object.isFrozen(error)).toBe(true);
		expect(JSON.stringify(error)).not.toContain("private");
	});

	it("copies bounded ordinary files within and across authorized roots", async () => {
		const bridge = createBrowserMockBridge();
		const isolated = createBrowserMockBridge();
		const added = await bridge.workspacePickRoots("add");
		const isolatedRoot = (await isolated.workspacePickRoots("replace")).snapshot
			.roots[0]!;
		const [workspaceRoot, libraryRoot] = added.snapshot.roots;
		const source = (
			await bridge.workspaceReadFile(workspaceRoot!.rootId, "binary.bin")
		).value.copy();

		await bridge.workspaceCopy(
			workspaceRoot!.rootId,
			"binary.bin",
			workspaceRoot!.rootId,
			"empty/copied.bin",
		);
		await bridge.workspaceCopy(
			workspaceRoot!.rootId,
			"binary.bin",
			libraryRoot!.rootId,
			"packages/copied.bin",
		);
		await bridge.workspaceCopy(
			workspaceRoot!.rootId,
			"README.md",
			libraryRoot!.rootId,
			"README.md",
		);

		expect(
			(
				await bridge.workspaceReadFile(
					workspaceRoot!.rootId,
					"empty/copied.bin",
				)
			).value.copy(),
		).toEqual(source);
		expect(
			(
				await bridge.workspaceReadFile(
					libraryRoot!.rootId,
					"packages/copied.bin",
				)
			).value.copy(),
		).toEqual(source);
		expect(
			(
				await bridge.workspaceReadFile(workspaceRoot!.rootId, "binary.bin")
			).value.copy(),
		).toEqual(source);
		expect(await bridge.workspaceSnapshot()).toMatchObject({ revision: 1 });
		await expect(
			isolated.workspaceStat(isolatedRoot.rootId, "empty/copied.bin"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("copies without clobbering and requires an existing directory parent", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const readme = (
			await bridge.workspaceReadFile(rootId, "README.md")
		).value.copy();
		const binary = (
			await bridge.workspaceReadFile(rootId, "binary.bin")
		).value.copy();

		await expect(
			bridge.workspaceCopy(rootId, "README.md", rootId, "binary.bin"),
		).rejects.toEqual({
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		});
		await expect(
			bridge.workspaceCopy(rootId, "README.md", rootId, "missing/copied.md"),
		).rejects.toEqual({
			code: "ENTRY_NOT_FOUND",
			message: "The workspace entry does not exist.",
		});
		await expect(
			bridge.workspaceCopy(rootId, "README.md", rootId, "binary.bin/copied.md"),
		).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		expect(
			(await bridge.workspaceReadFile(rootId, "README.md")).value.copy(),
		).toEqual(readme);
		expect(
			(await bridge.workspaceReadFile(rootId, "binary.bin")).value.copy(),
		).toEqual(binary);

		const racing = await Promise.allSettled([
			bridge.workspaceCopy(rootId, "README.md", rootId, "racing-copy"),
			bridge.workspaceCopy(rootId, "binary.bin", rootId, "racing-copy"),
		]);
		expect(racing.filter(({ status }) => status === "fulfilled")).toHaveLength(
			1,
		);
		expect(racing.filter(({ status }) => status === "rejected")).toHaveLength(
			1,
		);
		expect((await bridge.workspaceStat(rootId, "racing-copy")).kind).toBe(
			"file",
		);
	});

	it("rejects invalid copy relationships and unsupported source kinds", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		for (const [sourcePath, targetPath] of [
			["", "target"],
			["source", ""],
		] as const) {
			await expect(
				bridge.workspaceCopy(rootId, sourcePath, rootId, targetPath),
			).rejects.toEqual({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
		}

		await expect(
			bridge.workspaceCopy(rootId, "README.md", rootId, "README.md"),
		).rejects.toEqual({
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		});
		await expect(
			bridge.workspaceCopy(rootId, "README.md", rootId, "README.md/nested"),
		).rejects.toEqual({
			code: "WORKSPACE_CONFLICT",
			message: "The workspace copy conflicts with the source path.",
		});

		await expect(
			bridge.workspaceCopy(rootId, "fixtures/other", rootId, "copy-target"),
		).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		await expect(
			bridge.workspaceCopy(
				rootId,
				"fixtures/oversized.bin",
				rootId,
				"copy-target",
			),
		).rejects.toEqual({
			code: "FILE_TOO_LARGE",
			message: "The workspace file exceeds the supported copy limit.",
		});
		await expect(
			bridge.workspaceCopy(rootId, "../private-source", rootId, "copy-target"),
		).rejects.toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		await expect(
			bridge.workspaceCopy(
				rootId,
				"README.md",
				"00000000-0000-4000-8000-000000000999",
				"private-target",
			),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
	});

	it("copies bounded mixed directories within and across roots as detached trees", async () => {
		const observations: BrowserMockDirectoryCopyObservation[] = [];
		const fixtureEntries = [
			{ path: ["empty"], kind: "directory" },
			{ path: ["data.bin"], kind: "file", bytes: [0, 255, 128, 1] },
			{ path: ["nested"], kind: "directory" },
			{
				path: ["nested", "message.txt"],
				kind: "file",
				bytes: [111, 107],
			},
			{
				path: ["binary-link"],
				kind: "symlink",
				payload: [0xff, 0x80, 0x2f, 0x2e],
			},
			{
				path: ["readme-link"],
				kind: "symlink",
				payload: [...new TextEncoder().encode("../README.md")],
			},
			{
				path: ["nested-link"],
				kind: "symlink",
				payload: [...new TextEncoder().encode("nested")],
			},
		] satisfies readonly BrowserMockDirectoryFixtureEntryForTest[];
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "copy-tree",
				entries: fixtureEntries,
			},
			onDirectoryCopyForTest: (observation) => observations.push(observation),
		});
		const [workspaceRoot, libraryRoot] = (
			await bridge.workspacePickRoots("add")
		).snapshot.roots;

		await bridge.workspaceCopy(
			workspaceRoot!.rootId,
			"copy-tree",
			workspaceRoot!.rootId,
			"tree-copy",
		);
		await bridge.workspaceCopy(
			workspaceRoot!.rootId,
			"copy-tree",
			libraryRoot!.rootId,
			"packages/tree-copy",
		);

		for (const [rootId, path] of [
			[workspaceRoot!.rootId, "tree-copy/data.bin"],
			[libraryRoot!.rootId, "packages/tree-copy/data.bin"],
		] as const) {
			const first = (await bridge.workspaceReadFile(rootId, path)).value.copy();
			expect([...first]).toEqual([0, 255, 128, 1]);
			first[0] = 99;
			expect([
				...(await bridge.workspaceReadFile(rootId, path)).value.copy(),
			]).toEqual([0, 255, 128, 1]);
		}
		expect(
			(
				await bridge.workspaceReadDirectory(
					workspaceRoot!.rootId,
					"tree-copy/empty",
				)
			).entries,
		).toEqual([]);
		expect(
			await bridge.workspaceStat(
				workspaceRoot!.rootId,
				"tree-copy/readme-link",
			),
		).toMatchObject({ kind: "symlinkFile" });
		expect(
			await bridge.workspaceStat(
				libraryRoot!.rootId,
				"packages/tree-copy/readme-link",
			),
		).toMatchObject({ kind: "symlink" });
		expect(
			await bridge.workspaceStat(
				libraryRoot!.rootId,
				"packages/tree-copy/nested-link",
			),
		).toMatchObject({ kind: "symlinkDirectory" });

		await bridge.workspaceRename(
			workspaceRoot!.rootId,
			"copy-tree/data.bin",
			"copy-tree/source-renamed.bin",
		);
		expect([
			...(
				await bridge.workspaceReadFile(
					workspaceRoot!.rootId,
					"tree-copy/data.bin",
				)
			).value.copy(),
		]).toEqual([0, 255, 128, 1]);

		expect(observations).toHaveLength(2);
		for (const observation of observations) {
			expect(Object.isFrozen(observation)).toBe(true);
			expect(Object.isFrozen(observation.manifest)).toBe(true);
			expect(Object.isFrozen(observation.manifest.entries)).toBe(true);
			expect(observation.manifest).toMatchObject({
				descendants: fixtureEntries.length,
				maximumDepth: 2,
				logicalFileBytes: 6,
				actualFileBytes: 6,
			});
			const rawLink = observation.manifest.entries.find(
				(entry) => entry.relativePath === "binary-link",
			);
			expect(rawLink).toMatchObject({
				kind: "symlink",
				payload: [0xff, 0x80, 0x2f, 0x2e],
			});
			expect(Object.isFrozen(rawLink)).toBe(true);
			expect(Object.isFrozen(rawLink?.payload)).toBe(true);
		}
		expect(
			observations[0]!.manifest.entries.find(
				(entry) => entry.relativePath === "binary-link",
			)?.payload,
		).not.toBe(
			observations[1]!.manifest.entries.find(
				(entry) => entry.relativePath === "binary-link",
			)?.payload,
		);

		await expect(
			bridge.workspaceCopy(
				workspaceRoot!.rootId,
				"copy-tree",
				workspaceRoot!.rootId,
				"copy-tree/nested/descendant",
			),
		).rejects.toEqual({
			code: "WORKSPACE_CONFLICT",
			message: "The workspace copy conflicts with the source path.",
		});
		await expect(
			bridge.workspaceCopy(
				workspaceRoot!.rootId,
				"copy-tree",
				workspaceRoot!.rootId,
				"README.md",
			),
		).rejects.toMatchObject({ code: "ENTRY_ALREADY_EXISTS" });
		await expect(
			bridge.workspaceCopy(
				workspaceRoot!.rootId,
				"copy-tree",
				workspaceRoot!.rootId,
				"missing/tree-copy",
			),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("enforces every directory manifest budget at exact and plus-one boundaries", async () => {
		const copyFixture = async (
			entries: readonly BrowserMockDirectoryFixtureEntryForTest[],
			limits: BrowserMockDirectoryCopyLimitsForTest,
			options: Readonly<{
				fixtureName?: string;
				targetPath?: string;
				expectedError?: string;
			}> = {},
		): Promise<void> => {
			const bridge = createBrowserMockBridge({
				directoryCopyFixtureForTest: {
					name: options.fixtureName ?? "box",
					entries,
				},
				directoryCopyLimitsForTest: limits,
			});
			const rootId = (await bridge.workspacePickRoots("replace")).snapshot
				.roots[0]!.rootId;
			const targetPath = options.targetPath ?? "out";
			const copy = bridge.workspaceCopy(
				rootId,
				options.fixtureName ?? "box",
				rootId,
				targetPath,
			);
			if (options.expectedError === undefined) {
				await copy;
				expect((await bridge.workspaceStat(rootId, targetPath)).kind).toBe(
					"directory",
				);
				return;
			}
			const message =
				options.expectedError === "DIRECTORY_TOO_LARGE"
					? "The workspace directory exceeds the supported copy limits."
					: "The workspace entry name cannot be represented safely.";
			await expect(copy).rejects.toEqual({
				code: options.expectedError,
				message,
			});
			await expect(
				bridge.workspaceStat(rootId, targetPath),
			).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		};
		const directoryTooLarge = Object.freeze({
			expectedError: "DIRECTORY_TOO_LARGE",
		});

		await copyFixture([], { descendants: 0 });
		await copyFixture(
			[
				{ path: ["a"], kind: "directory" },
				{ path: ["a", "b"], kind: "file", bytes: [] },
			],
			{ descendants: 2 },
		);
		await copyFixture(
			[
				{ path: ["a"], kind: "directory" },
				{ path: ["a", "b"], kind: "file", bytes: [] },
				{ path: ["c"], kind: "file", bytes: [] },
			],
			{ descendants: 2 },
			directoryTooLarge,
		);

		await copyFixture([{ path: ["abc"], kind: "file", bytes: [] }], {
			entryNameBytes: 3,
			namePayloadBytes: 3,
		});
		await copyFixture(
			[{ path: ["abcd"], kind: "file", bytes: [] }],
			{ entryNameBytes: 3 },
			directoryTooLarge,
		);
		await copyFixture(
			[
				{ path: ["ab"], kind: "file", bytes: [] },
				{ path: ["cd"], kind: "file", bytes: [] },
			],
			{ namePayloadBytes: 3 },
			directoryTooLarge,
		);

		await copyFixture(
			[
				{ path: ["a"], kind: "directory" },
				{ path: ["a", "b"], kind: "file", bytes: [] },
			],
			{ depth: 2 },
		);
		await copyFixture(
			[
				{ path: ["a"], kind: "directory" },
				{ path: ["a", "b"], kind: "directory" },
				{ path: ["a", "b", "c"], kind: "file", bytes: [] },
			],
			{ depth: 2 },
			directoryTooLarge,
		);

		await copyFixture([{ path: ["a"], kind: "file", bytes: [1, 2, 3] }], {
			fileBytes: 3,
			totalFileBytes: 3,
		});
		await copyFixture(
			[
				{ path: ["a"], kind: "file", bytes: [1, 2] },
				{ path: ["b"], kind: "file", bytes: [3, 4] },
			],
			{ fileBytes: 3, totalFileBytes: 3 },
			directoryTooLarge,
		);
		await copyFixture([{ path: ["a"], kind: "symlink", payload: [1, 2, 3] }], {
			symlinkBytes: 3,
			totalSymlinkBytes: 3,
		});
		await copyFixture(
			[
				{ path: ["a"], kind: "symlink", payload: [1, 2] },
				{ path: ["b"], kind: "symlink", payload: [3, 4] },
			],
			{ symlinkBytes: 3, totalSymlinkBytes: 3 },
			directoryTooLarge,
		);

		await copyFixture([{ path: ["a"], kind: "file", bytes: [] }], {
			pathBytes: 5,
			pathSegments: 2,
		});
		await copyFixture(
			[{ path: ["ab"], kind: "file", bytes: [] }],
			{ pathBytes: 5 },
			{ expectedError: "PATH_ENCODING_UNSUPPORTED" },
		);
		await copyFixture(
			[
				{ path: ["a"], kind: "directory" },
				{ path: ["a", "b"], kind: "file", bytes: [] },
			],
			{ pathSegments: 2 },
			{ expectedError: "PATH_ENCODING_UNSUPPORTED" },
		);

		await copyFixture([], { entryNameBytes: 3 });
		await copyFixture(
			[],
			{ entryNameBytes: 3 },
			{
				...directoryTooLarge,
				fixtureName: "four",
			},
		);
		await copyFixture(
			[],
			{ entryNameBytes: 3 },
			{
				...directoryTooLarge,
				targetPath: "four",
			},
		);
	});

	it("rejects unsafe or unsupported directory descendants without publication", async () => {
		const rejectFixture = async (
			entries: readonly BrowserMockDirectoryFixtureEntryForTest[],
			limits: BrowserMockDirectoryCopyLimitsForTest,
			code: string,
			message: string,
		): Promise<void> => {
			const bridge = createBrowserMockBridge({
				directoryCopyFixtureForTest: { name: "copy-box", entries },
				directoryCopyLimitsForTest: limits,
			});
			const rootId = (await bridge.workspacePickRoots("replace")).snapshot
				.roots[0]!.rootId;
			await expect(
				bridge.workspaceCopy(rootId, "copy-box", rootId, "out"),
			).rejects.toEqual({ code, message });
			await expect(bridge.workspaceStat(rootId, "out")).rejects.toMatchObject({
				code: "ENTRY_NOT_FOUND",
			});
		};

		await rejectFixture(
			[
				{ path: ["nested"], kind: "directory" },
				{ path: ["nested", "socket"], kind: "other" },
			],
			{},
			"ENTRY_TYPE_MISMATCH",
			"The workspace entry has an incompatible type.",
		);
		await rejectFixture(
			[{ path: ["\ud800"], kind: "file", bytes: [] }],
			{},
			"PATH_ENCODING_UNSUPPORTED",
			"The workspace entry name cannot be represented safely.",
		);
		await rejectFixture(
			[{ path: ["large"], kind: "file", bytes: [1, 2, 3, 4] }],
			{ fileBytes: 3 },
			"FILE_TOO_LARGE",
			"The workspace file exceeds the supported copy limit.",
		);
		await rejectFixture(
			[{ path: ["large"], kind: "symlink", payload: [1, 2, 3, 4] }],
			{ symlinkBytes: 3 },
			"FILE_TOO_LARGE",
			"The workspace symbolic link exceeds the supported copy limit.",
		);

		expect(() =>
			createBrowserMockBridge({
				directoryCopyLimitsForTest: { descendants: Number.NaN },
			}),
		).toThrow("Invalid browser mock directory-copy limits.");
		expect(() =>
			createBrowserMockBridge({
				directoryCopyLimitsForTest: {
					descendants: Number.MAX_SAFE_INTEGER,
				},
			}),
		).toThrow("Invalid browser mock directory-copy limits.");
	});

	it("publishes no directory when its frozen detached observer rejects", async () => {
		let observation: BrowserMockDirectoryCopyObservation | undefined;
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "copy-box",
				entries: [
					{ path: ["file"], kind: "file", bytes: [1] },
					{ path: ["link"], kind: "symlink", payload: [0xff] },
				],
			},
			onDirectoryCopyForTest: (candidate) => {
				observation = candidate;
				throw new Error("observer rejected directory copy");
			},
		});
		const rootId = (await bridge.workspacePickRoots("replace")).snapshot
			.roots[0]!.rootId;

		await expect(
			bridge.workspaceCopy(rootId, "copy-box", rootId, "empty/rejected"),
		).rejects.toThrow("observer rejected directory copy");
		await expect(
			bridge.workspaceStat(rootId, "empty/rejected"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		expect(Object.isFrozen(observation)).toBe(true);
		expect(Object.isFrozen(observation?.manifest)).toBe(true);
		expect(Object.isFrozen(observation?.manifest.entries)).toBe(true);
		const payload = observation?.manifest.entries.find(
			(entry) => entry.kind === "symlink",
		)?.payload;
		expect(payload).toEqual([0xff]);
		expect(Object.isFrozen(payload)).toBe(true);
		expect(() => (payload as number[]).push(0)).toThrow(TypeError);
	});

	it("does not clobber a target published by the directory observer seam", async () => {
		let rootId = "";
		let bridge: ReturnType<typeof createBrowserMockBridge>;
		bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "copy-box",
				entries: [{ path: ["file"], kind: "file", bytes: [1] }],
			},
			onDirectoryCopyForTest: () => {
				void bridge.workspaceCreateFile(rootId, "empty/raced-target");
			},
		});
		rootId = (await bridge.workspacePickRoots("replace")).snapshot.roots[0]!
			.rootId;

		await expect(
			bridge.workspaceCopy(rootId, "copy-box", rootId, "empty/raced-target"),
		).rejects.toEqual({
			code: "ENTRY_ALREADY_EXISTS",
			message: "The workspace entry already exists.",
		});
		expect(
			await bridge.workspaceStat(rootId, "empty/raced-target"),
		).toMatchObject({ kind: "file", size: 0 });
	});

	it("copies raw symlink payloads and reclassifies them at each location", async () => {
		const observations: BrowserMockSymlinkCopyObservation[] = [];
		const bridge = createBrowserMockBridge({
			onSymlinkCopyForTest: (observation) => observations.push(observation),
		});
		const added = await bridge.workspacePickRoots("add");
		const [workspaceRoot, libraryRoot] = added.snapshot.roots;
		const utf8 = (value: string): readonly number[] => [
			...new TextEncoder().encode(value),
		];
		const fixtures = [
			{
				name: "binary-link",
				kind: "symlink",
				payload: [0xff, 0x80, 0x2f, 0x2e],
			},
			{
				name: "dangling-link",
				kind: "symlink",
				payload: utf8("missing-target"),
			},
			{
				name: "directory-link",
				kind: "symlinkDirectory",
				payload: utf8("../src"),
			},
			{
				name: "external-link",
				kind: "symlink",
				payload: utf8("../../outside-sentinel"),
			},
			{
				name: "file-link",
				kind: "symlinkFile",
				payload: utf8("../README.md"),
			},
			{
				name: "loop-link",
				kind: "symlink",
				payload: utf8("loop-link"),
			},
			{
				name: "maximum-link",
				kind: "symlink",
				payload: utf8("x".repeat(4 * 1_024)),
			},
		] as const;

		for (const { name, kind, payload } of fixtures) {
			const sourcePath = `fixtures/${name}`;
			const sameParentPath = `fixtures/same-parent-${name}`;
			const crossRootPath = `packages/cross-root-${name}`;
			const sourceStat = await bridge.workspaceStat(
				workspaceRoot!.rootId,
				sourcePath,
			);
			expect(sourceStat.kind).toBe(kind);

			await bridge.workspaceCopy(
				workspaceRoot!.rootId,
				sourcePath,
				workspaceRoot!.rootId,
				sameParentPath,
			);
			expect(
				await bridge.workspaceStat(workspaceRoot!.rootId, sameParentPath),
			).toMatchObject({ kind, size: sourceStat.size });

			await bridge.workspaceCopy(
				workspaceRoot!.rootId,
				sourcePath,
				libraryRoot!.rootId,
				crossRootPath,
			);
			const crossRootStat = await bridge.workspaceStat(
				libraryRoot!.rootId,
				crossRootPath,
			);
			expect(crossRootStat).toMatchObject({
				kind: "symlink",
				size: payload.length,
			});
			await expect(
				bridge.workspaceReadFile(libraryRoot!.rootId, crossRootPath),
			).rejects.toMatchObject({ code: "ENTRY_TYPE_MISMATCH" });

			const [sameParentObservation, crossRootObservation] = observations.filter(
				(observation) => observation.sourcePath === sourcePath,
			);
			expect(sameParentObservation?.targetPath).toBe(sameParentPath);
			expect(crossRootObservation?.targetPath).toBe(crossRootPath);
			expect(sameParentObservation?.payload).toEqual(payload);
			expect(crossRootObservation?.payload).toEqual(payload);
			expect(sameParentObservation?.payload).not.toBe(
				crossRootObservation?.payload,
			);
			expect(Object.isFrozen(sameParentObservation)).toBe(true);
			expect(Object.isFrozen(sameParentObservation?.payload)).toBe(true);
		}

		const sourceEntries = (
			await bridge.workspaceReadDirectory(workspaceRoot!.rootId, "fixtures")
		).entries;
		expect(sourceEntries).toContainEqual({
			name: "directory-link",
			kind: "symlinkDirectory",
		});
		expect(sourceEntries).toContainEqual({
			name: "file-link",
			kind: "symlinkFile",
		});
		const crossRootEntries = (
			await bridge.workspaceReadDirectory(libraryRoot!.rootId, "packages")
		).entries;
		for (const { name } of fixtures) {
			expect(crossRootEntries).toContainEqual({
				name: `cross-root-${name}`,
				kind: "symlink",
			});
		}
		expect(observations).toHaveLength(fixtures.length * 2);
		expect(
			observations.find(
				(observation) =>
					observation.sourcePath === "fixtures/binary-link" &&
					observation.targetPath === "fixtures/same-parent-binary-link",
			)?.payload,
		).toEqual([0xff, 0x80, 0x2f, 0x2e]);
		expect(
			(
				await bridge.workspaceStat(
					libraryRoot!.rootId,
					"packages/cross-root-maximum-link",
				)
			).size,
		).toBe(4 * 1_024);
	});

	it("copies symlinks without clobbering or creating parent directories", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const originalLink = await bridge.workspaceStat(
			rootId,
			"fixtures/dangling-link",
		);

		for (const targetPath of ["README.md", "src", "fixtures/dangling-link"]) {
			await expect(
				bridge.workspaceCopy(rootId, "fixtures/file-link", rootId, targetPath),
			).rejects.toEqual({
				code: "ENTRY_ALREADY_EXISTS",
				message: "The workspace entry already exists.",
			});
		}
		await expect(
			bridge.workspaceCopy(
				rootId,
				"fixtures/file-link",
				rootId,
				"missing/copied-link",
			),
		).rejects.toEqual({
			code: "ENTRY_NOT_FOUND",
			message: "The workspace entry does not exist.",
		});
		await expect(
			bridge.workspaceCopy(
				rootId,
				"fixtures/file-link",
				rootId,
				"README.md/copied-link",
			),
		).rejects.toEqual({
			code: "ENTRY_TYPE_MISMATCH",
			message: "The workspace entry has an incompatible type.",
		});
		await expect(
			bridge.workspaceCopy(
				rootId,
				"fixtures/oversized-link",
				rootId,
				"missing/copied-link",
			),
		).rejects.toEqual({
			code: "FILE_TOO_LARGE",
			message: "The workspace symbolic link exceeds the supported copy limit.",
		});

		expect(
			await bridge.workspaceStat(rootId, "fixtures/dangling-link"),
		).toEqual(originalLink);
		await expect(
			bridge.workspaceStat(rootId, "missing/copied-link"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("does not publish a mock symlink when its test observer rejects the copy", async () => {
		const bridge = createBrowserMockBridge({
			onSymlinkCopyForTest: () => {
				throw new Error("observer rejected copy");
			},
		});
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		await expect(
			bridge.workspaceCopy(
				rootId,
				"fixtures/dangling-link",
				rootId,
				"empty/rejected-link",
			),
		).rejects.toThrow("observer rejected copy");
		await expect(
			bridge.workspaceStat(rootId, "empty/rejected-link"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("keeps exact copied symlink payload bytes isolated across paths and mocks", async () => {
		const observations: BrowserMockSymlinkCopyObservation[] = [];
		const first = createBrowserMockBridge({
			onSymlinkCopyForTest: (observation) => observations.push(observation),
		});
		const second = createBrowserMockBridge();
		const firstRoots = (await first.workspacePickRoots("add")).snapshot.roots;
		const secondRoots = (await second.workspacePickRoots("add")).snapshot.roots;
		const firstSource = firstRoots[0]!;
		const firstTarget = firstRoots[1]!;
		const sourceStat = await first.workspaceStat(
			firstSource.rootId,
			"fixtures/binary-link",
		);

		await first.workspaceCopy(
			firstSource.rootId,
			"fixtures/binary-link",
			firstTarget.rootId,
			"packages/copied-binary-link",
		);
		await first.workspaceRename(
			firstSource.rootId,
			"fixtures/binary-link",
			"fixtures/binary-link-renamed",
		);
		await first.workspaceCopy(
			firstTarget.rootId,
			"packages/copied-binary-link",
			firstSource.rootId,
			"empty/copied-again",
		);
		expect(observations).toHaveLength(2);
		for (const observation of observations) {
			expect(observation.payload).toEqual([0xff, 0x80, 0x2f, 0x2e]);
			expect(Object.isFrozen(observation)).toBe(true);
			expect(Object.isFrozen(observation.payload)).toBe(true);
		}
		expect(observations[0]!.payload).not.toBe(observations[1]!.payload);
		expect(() => {
			(observations[0]!.payload as number[]).push(0);
		}).toThrow(TypeError);

		for (const [rootId, path] of [
			[firstTarget.rootId, "packages/copied-binary-link"],
			[firstSource.rootId, "empty/copied-again"],
		] as const) {
			expect(await first.workspaceStat(rootId, path)).toMatchObject({
				kind: "symlink",
				size: sourceStat.size,
			});
		}
		expect(
			await second.workspaceStat(
				secondRoots[0]!.rootId,
				"fixtures/binary-link",
			),
		).toMatchObject({ kind: "symlink", size: sourceStat.size });
		await expect(
			second.workspaceStat(
				secondRoots[1]!.rootId,
				"packages/copied-binary-link",
			),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			second.workspaceStat(
				secondRoots[0]!.rootId,
				"fixtures/binary-link-renamed",
			),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("checks both root leases before copy path semantics", async () => {
		const bridge = createBrowserMockBridge();
		const added = await bridge.workspacePickRoots("add");
		const sourceRootId = added.snapshot.roots[0]!.rootId;
		const revokedRootId = added.snapshot.roots[1]!.rootId;
		const unknownRootId = "00000000-0000-4000-8000-000000000999";
		await bridge.workspaceRemoveRoot(revokedRootId);

		for (const [sourceRoot, sourcePath, targetRoot, targetPath] of [
			[unknownRootId, "", unknownRootId, "target"],
			[unknownRootId, "same", unknownRootId, "same"],
			[unknownRootId, "source", unknownRootId, "source/nested"],
			[revokedRootId, "", revokedRootId, "target"],
			[revokedRootId, "same", revokedRootId, "same"],
			[revokedRootId, "source", revokedRootId, "source/nested"],
			[sourceRootId, "", revokedRootId, ""],
		] as const) {
			const error = await bridge
				.workspaceCopy(sourceRoot, sourcePath, targetRoot, targetPath)
				.catch((candidate: unknown) => candidate);
			expect(error).toEqual({
				code: "ROOT_NOT_AUTHORIZED",
				message: "The workspace root is not authorized.",
			});
			expect(Object.isFrozen(error)).toBe(true);
		}
	});

	it("returns frozen stable file errors with Rust-compatible precedence", async () => {
		const bridge = createBrowserMockBridge();
		const knownRootId = "00000000-0000-4000-8000-000000000101";

		const invalidBeforeAuthorization = await bridge
			.workspaceStat(knownRootId, "../private-secret")
			.catch((error: unknown) => error);
		expect(invalidBeforeAuthorization).toEqual({
			code: "INVALID_RELATIVE_PATH",
			message: "The workspace-relative path is invalid.",
		});
		expect(Object.isFrozen(invalidBeforeAuthorization)).toBe(true);
		await expect(
			bridge.workspaceStat(knownRootId, "README.md"),
		).rejects.toEqual({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});

		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		await expect(
			bridge.workspaceStat(rootId, "missing.txt"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		await expect(
			bridge.workspaceReadDirectory(rootId, "README.md"),
		).rejects.toMatchObject({ code: "ENTRY_TYPE_MISMATCH" });
		await expect(bridge.workspaceReadFile(rootId, "src")).rejects.toMatchObject(
			{
				code: "ENTRY_TYPE_MISMATCH",
			},
		);
		await expect(
			bridge.workspaceReadFile(rootId, "fixtures/oversized.bin"),
		).rejects.toEqual({
			code: "FILE_TOO_LARGE",
			message: "The workspace file exceeds the supported read limit.",
		});

		await bridge.workspaceRemoveRoot(rootId);
		const revoked = await bridge
			.workspaceReadFile(rootId, "README.md")
			.catch((error: unknown) => error);
		expect(revoked).toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
		expect(Object.isFrozen(revoked)).toBe(true);
		expect(JSON.stringify(revoked)).not.toContain("private-secret");
	});

	it("keeps added roots isolated while exposing their deterministic trees", async () => {
		const bridge = createBrowserMockBridge();
		const added = await bridge.workspacePickRoots("add");
		const [workspaceRoot, libraryRoot] = added.snapshot.roots;

		expect(
			(await bridge.workspaceReadDirectory(workspaceRoot!.rootId, "src"))
				.entries,
		).toEqual([{ name: "main.ts", kind: "file" }]);
		expect(
			(await bridge.workspaceReadDirectory(libraryRoot!.rootId, "")).entries,
		).toEqual([
			{ name: "notes.txt", kind: "file" },
			{ name: "packages", kind: "directory" },
		]);
		await expect(
			bridge.workspaceStat(libraryRoot!.rootId, "src/main.ts"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
	});

	it("moves detached files, raw symlinks, and directories across roots", async () => {
		const bridge = createBrowserMockBridge();
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const sourceRootId = sourceRoot!.rootId;
		const targetRootId = targetRoot!.rootId;

		const file = await bridge.workspaceMove(
			sourceRootId,
			"README.md",
			targetRootId,
			"packages/README.md",
		);
		const symlink = await bridge.workspaceMove(
			sourceRootId,
			"fixtures/binary-link",
			targetRootId,
			"packages/binary-link",
		);
		const directory = await bridge.workspaceMove(
			sourceRootId,
			"src",
			targetRootId,
			"packages/src",
		);

		for (const result of [file, symlink, directory]) {
			expect(result).toEqual({ status: "moved" });
			expect(Object.isFrozen(result)).toBe(true);
		}
		expect(
			(
				await bridge.workspaceReadFile(targetRootId, "packages/README.md")
			).value.copy(),
		).toEqual(new TextEncoder().encode("# Plain browser workspace\n"));
		expect(
			await bridge.workspaceStat(targetRootId, "packages/binary-link"),
		).toMatchObject({ kind: "symlink", size: 4 });
		expect(
			(
				await bridge.workspaceReadFile(targetRootId, "packages/src/main.ts")
			).value.copy(),
		).toEqual(new TextEncoder().encode('export const editor = "Plain";\n'));
		for (const path of ["README.md", "fixtures/binary-link", "src"]) {
			await expect(
				bridge.workspaceStat(sourceRootId, path),
			).rejects.toMatchObject({
				code: "ENTRY_NOT_FOUND",
			});
		}
	});

	it("keeps directory move receipt verification linear in manifest size", async () => {
		const entryCount = 256;
		let receiptVisits = 0;
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "linear-tree",
				entries: Array.from({ length: entryCount }, (_, index) => ({
					path: [`file-${index.toString().padStart(3, "0")}.bin`],
					kind: "file" as const,
					bytes: [index % 256],
				})),
			},
			onWorkspaceMoveReceiptVisitForTest() {
				receiptVisits += 1;
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"linear-tree",
				targetRoot!.rootId,
				"packages/linear-tree",
			),
		).resolves.toEqual({ status: "moved" });
		expect(receiptVisits).toBeGreaterThan(entryCount);
		expect(receiptVisits).toBeLessThanOrEqual(entryCount * 8 + 16);
	});

	it("rejects same-root move before publishing or deleting anything", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		await expect(
			bridge.workspaceMove(rootId, "README.md", rootId, "moved.md"),
		).rejects.toEqual({
			code: "WORKSPACE_CONFLICT",
			message: "The workspace move requires distinct workspace roots.",
		});
		expect((await bridge.workspaceStat(rootId, "README.md")).kind).toBe("file");
		await expect(
			bridge.workspaceStat(rootId, "moved.md"),
		).rejects.toMatchObject({
			code: "ENTRY_NOT_FOUND",
		});
	});

	it("captures and validates every move seam exactly once before publication", async () => {
		const seamNames = [
			"onWorkspaceMoveAfterPublicationForTest",
			"onWorkspaceMoveBeforeDeleteForTest",
			"onWorkspaceMoveAfterDeleteEntryForTest",
			"onWorkspaceMoveDeleteForTest",
			"onWorkspaceMoveReceiptVisitForTest",
		] as const;
		const reads = new Map<PropertyKey, number>();
		const options = new Proxy({} as BrowserMockBridgeOptions, {
			get(target, property, receiver) {
				if (seamNames.some((name) => name === property)) {
					const count = (reads.get(property) ?? 0) + 1;
					reads.set(property, count);
					if (count > 1) {
						throw new Error("move seam was read after capture");
					}
					return property === "onWorkspaceMoveAfterPublicationForTest"
						? () => undefined
						: undefined;
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const bridge = createBrowserMockBridge(options);
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/captured.md",
			),
		).resolves.toEqual({ status: "moved" });
		for (const name of seamNames) {
			expect(reads.get(name)).toBe(1);
		}

		const throwingAccessor = {} as BrowserMockBridgeOptions;
		Object.defineProperty(
			throwingAccessor,
			"onWorkspaceMoveBeforeDeleteForTest",
			{
				get() {
					throw new Error("seam capture failed");
				},
			},
		);
		expect(() => createBrowserMockBridge(throwingAccessor)).toThrow(
			"seam capture failed",
		);
		expect(() =>
			createBrowserMockBridge({
				onWorkspaceMoveAfterDeleteEntryForTest: "invalid",
			} as unknown as BrowserMockBridgeOptions),
		).toThrow("Invalid browser mock workspace-move seam.");
	});

	it("uses a private pre-publication content receipt and attributes coordinated rewrites source-first", async () => {
		let replacement: readonly number[] = [];
		let observationFrozen = false;
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveAfterPublicationForTest(observation, mutations) {
				observationFrozen =
					Object.isFrozen(observation) && !("receipt" in observation);
				mutations.rewriteSourceFile("", replacement);
				mutations.rewriteTargetFile("", replacement);
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const original = (
			await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
		).value.copy();
		replacement = [...original].map((byte) => byte ^ 0xff);

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"README.md",
			targetRoot!.rootId,
			"packages/rewritten.md",
		);

		expect(result).toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceChanged",
		});
		expect(observationFrozen).toBe(true);
		expect([
			...(
				await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
			).value.copy(),
		]).toEqual(replacement);
		expect([
			...(
				await bridge.workspaceReadFile(
					targetRoot!.rootId,
					"packages/rewritten.md",
				)
			).value.copy(),
		]).toEqual(replacement);
	});

	it("attributes a post-publication target content rewrite without deleting source", async () => {
		let replacement: readonly number[] = [];
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveAfterPublicationForTest(_observation, mutations) {
				mutations.rewriteTargetFile("", replacement);
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const original = (
			await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
		).value.copy();
		replacement = [...original].map((byte) => byte ^ 0xaa);

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/target-rewritten.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "targetChanged",
		});
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "README.md")).kind,
		).toBe("file");
	});

	it("turns observer failures into unverifiable outcomes instead of delete failures", async () => {
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveAfterPublicationForTest() {
				throw new Error("simulated observer failure");
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"README.md",
			targetRoot!.rootId,
			"packages/published.md",
		);

		expect(result).toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceUnverifiable",
		});
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "README.md")).kind,
		).toBe("file");
		expect(
			(await bridge.workspaceStat(targetRoot!.rootId, "packages/published.md"))
				.kind,
		).toBe("file");
	});

	it("revalidates source before applying a thrown observer outcome", async () => {
		let replacement: readonly number[] = [];
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveAfterPublicationForTest(_observation, mutations) {
				mutations.rewriteSourceFile("", replacement);
				throw new Error("observer failed after mutating source");
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const original = (
			await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
		).value.copy();
		replacement = [...original].map((byte) => byte ^ 0x55);

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/source-first.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceChanged",
		});
	});

	it("honors a frozen before-delete seam without removing the published source", async () => {
		let beforeDeleteCalled = false;
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveBeforeDeleteForTest(observation) {
				beforeDeleteCalled = Object.isFrozen(observation);
				return "targetUnverifiable";
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/unverifiable.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "targetUnverifiable",
		});
		expect(beforeDeleteCalled).toBe(true);
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "README.md")).kind,
		).toBe("file");
		expect(
			(
				await bridge.workspaceStat(
					targetRoot!.rootId,
					"packages/unverifiable.md",
				)
			).kind,
		).toBe("file");
	});

	it("checks both receipts source-first before applying an observer reason", async () => {
		let replacement: readonly number[] = [];
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveBeforeDeleteForTest(_observation, mutations) {
				mutations.rewriteSourceFile("", replacement);
				mutations.rewriteTargetFile("", replacement);
				return "targetUnverifiable";
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const original = (
			await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
		).value.copy();
		replacement = [...original].map((byte) => byte ^ 0x33);

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/source-first-reason.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceChanged",
		});
	});

	it("preserves source rewrite history before a target-side observer reason", async () => {
		let original: readonly number[] = [];
		let replacement: readonly number[] = [];
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveBeforeDeleteForTest(_observation, mutations) {
				mutations.rewriteSourceFile("", replacement);
				mutations.rewriteSourceFile("", original);
				return "targetUnverifiable";
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		original = [
			...(
				await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
			).value.copy(),
		];
		replacement = original.map((byte) => byte ^ 0x77);

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/rewrite-history.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceChanged",
		});
	});

	it("applies a source-side observer reason before a concrete target mutation", async () => {
		let replacement: readonly number[] = [];
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveAfterPublicationForTest(_observation, mutations) {
				mutations.rewriteTargetFile("", replacement);
				return "sourceUnverifiable";
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		const original = (
			await bridge.workspaceReadFile(sourceRoot!.rootId, "README.md")
		).value.copy();
		replacement = [...original].map((byte) => byte ^ 0x66);

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/source-reason-first.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "sourceUnverifiable",
		});
	});

	it("reports deleteFailed only from the simulated remove syscall", async () => {
		const bridge = createBrowserMockBridge({
			onWorkspaceMoveDeleteForTest() {
				throw new Error("simulated remove syscall failure");
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"README.md",
				targetRoot!.rootId,
				"packages/delete-failed.md",
			),
		).resolves.toEqual({
			status: "targetPublishedSourceRetained",
			reason: "deleteFailed",
		});
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "README.md")).kind,
		).toBe("file");
		expect(
			(
				await bridge.workspaceStat(
					targetRoot!.rootId,
					"packages/delete-failed.md",
				)
			).kind,
		).toBe("file");
	});

	it("contains unexpected post-publication exceptions with the exact removal count", async () => {
		const originalDelete = Map.prototype.delete;
		let patched = false;
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation) {
				if (observation.removedEntries === 1) {
					Map.prototype.delete = function () {
						throw new Error("simulated post-publication intrinsic failure");
					};
					patched = true;
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		try {
			await expect(
				bridge.workspaceMove(
					sourceRoot!.rootId,
					"move-tree",
					targetRoot!.rootId,
					"packages/move-tree",
				),
			).resolves.toEqual({
				status: "targetPublishedSourcePartiallyDeleted",
				reason: "sourceUnverifiable",
				removedEntries: 1,
			});
		} finally {
			if (patched) {
				Map.prototype.delete = originalDelete;
			}
		}
	});

	it("returns an exact partial count when deletion is interrupted", async () => {
		const observations: unknown[] = [];
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["nested"], kind: "directory" },
					{ path: ["nested", "b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation) {
				observations.push(observation);
			},
			onWorkspaceMoveDeleteForTest(observation) {
				if (observation.removedEntries === 1) {
					throw new Error("simulated remove failure");
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"move-tree",
			targetRoot!.rootId,
			"packages/move-tree",
		);

		expect(result).toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "deleteFailed",
			removedEntries: 1,
		});
		expect(observations).toHaveLength(1);
		expect(Object.isFrozen(observations[0])).toBe(true);
		expect(observations[0]).toMatchObject({
			removedEntries: 1,
			relativePath: "nested/b.bin",
			kind: "file",
		});
		expect(
			(
				await bridge.workspaceReadFile(
					targetRoot!.rootId,
					"packages/move-tree/a.bin",
				)
			).value.byteLength,
		).toBe(1);
		await expect(
			bridge.workspaceStat(sourceRoot!.rootId, "move-tree/nested/b.bin"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "move-tree/a.bin")).kind,
		).toBe("file");
	});

	it("revalidates the complete target after the last descendant deletion", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [{ path: ["only.bin"], kind: "file", bytes: [1] }],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(_observation, mutations) {
				mutations.rewriteTargetFile("only.bin", [2]);
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"move-tree",
				targetRoot!.rootId,
				"packages/move-tree",
			),
		).resolves.toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "targetChanged",
			removedEntries: 1,
		});
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "move-tree")).kind,
		).toBe("directory");
	});

	it("revalidates a partial source first after each deletion observer", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation, mutations) {
				if (observation.removedEntries === 1) {
					mutations.rewriteSourceFile("b.bin", [3]);
					mutations.rewriteTargetFile("b.bin", [3]);
					return "targetUnverifiable";
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"move-tree",
				targetRoot!.rootId,
				"packages/move-tree",
			),
		).resolves.toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "sourceChanged",
			removedEntries: 1,
		});
	});

	it("applies an after-delete source reason before a target mutation", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation, mutations) {
				if (observation.removedEntries === 1) {
					mutations.rewriteTargetFile("b.bin", [3]);
					return "sourceUnverifiable";
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"move-tree",
				targetRoot!.rootId,
				"packages/move-tree",
			),
		).resolves.toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "sourceUnverifiable",
			removedEntries: 1,
		});
	});

	it("does not mark an identical observer rewrite as a receipt change", async () => {
		const bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation, mutations) {
				if (observation.removedEntries === 1) {
					mutations.rewriteSourceFile("b.bin", [2]);
					mutations.rewriteTargetFile("b.bin", [2]);
					return "targetUnverifiable";
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		await expect(
			bridge.workspaceMove(
				sourceRoot!.rootId,
				"move-tree",
				targetRoot!.rootId,
				"packages/move-tree",
			),
		).resolves.toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "targetUnverifiable",
			removedEntries: 1,
		});
	});

	it("detects an unknown source member at directory removal without deleting it", async () => {
		let injected: Promise<unknown> | undefined;
		let bridge!: ReturnType<typeof createBrowserMockBridge>;
		bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation) {
				if (observation.removedEntries === 1) {
					injected = bridge.workspaceCreateFile(
						observation.sourceRootId,
						`${observation.sourcePath}/unknown.txt`,
					);
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"move-tree",
			targetRoot!.rootId,
			"packages/move-tree",
		);
		await injected;

		expect(result).toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "sourceChanged",
			removedEntries: 2,
		});
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "move-tree/unknown.txt"))
				.kind,
		).toBe("file");
		expect(
			(
				await bridge.workspaceStat(
					targetRoot!.rootId,
					"packages/move-tree/a.bin",
				)
			).kind,
		).toBe("file");
	});

	it.each(["source", "target"] as const)(
		"classifies a revoked %s root as unverifiable after a partial deletion",
		async (side) => {
			let revocation: Promise<unknown> | undefined;
			let bridge!: ReturnType<typeof createBrowserMockBridge>;
			bridge = createBrowserMockBridge({
				directoryCopyFixtureForTest: {
					name: "move-tree",
					entries: [
						{ path: ["a.bin"], kind: "file", bytes: [1] },
						{ path: ["b.bin"], kind: "file", bytes: [2] },
					],
				},
				onWorkspaceMoveAfterDeleteEntryForTest(observation) {
					if (observation.removedEntries === 1) {
						revocation = bridge.workspaceRemoveRoot(
							side === "source"
								? observation.sourceRootId
								: observation.targetRootId,
						);
					}
				},
			});
			const added = await bridge.workspacePickRoots("add");
			const [sourceRoot, targetRoot] = added.snapshot.roots;

			const result = await bridge.workspaceMove(
				sourceRoot!.rootId,
				"move-tree",
				targetRoot!.rootId,
				"packages/move-tree",
			);
			await revocation;

			expect(result).toEqual({
				status: "targetPublishedSourcePartiallyDeleted",
				reason: side === "source" ? "sourceUnverifiable" : "targetUnverifiable",
				removedEntries: 1,
			});
		},
	);

	it("classifies a missing partial source path as changed", async () => {
		let rename: Promise<void> | undefined;
		let bridge!: ReturnType<typeof createBrowserMockBridge>;
		bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation) {
				if (observation.removedEntries === 1) {
					rename = bridge.workspaceRename(
						observation.sourceRootId,
						observation.sourcePath,
						"move-tree-away",
					);
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"move-tree",
			targetRoot!.rootId,
			"packages/move-tree",
		);
		await rename;

		expect(result).toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "sourceChanged",
			removedEntries: 1,
		});
	});

	it("stops a partial directory move when the published target changes", async () => {
		let targetRootId = "";
		let targetRename: Promise<void> | undefined;
		let bridge!: ReturnType<typeof createBrowserMockBridge>;
		bridge = createBrowserMockBridge({
			directoryCopyFixtureForTest: {
				name: "move-tree",
				entries: [
					{ path: ["a.bin"], kind: "file", bytes: [1] },
					{ path: ["b.bin"], kind: "file", bytes: [2] },
				],
			},
			onWorkspaceMoveAfterDeleteEntryForTest(observation) {
				if (observation.removedEntries === 1) {
					targetRename = bridge.workspaceRename(
						targetRootId,
						"packages/move-tree",
						"packages/move-tree-away",
					);
				}
			},
		});
		const added = await bridge.workspacePickRoots("add");
		const [sourceRoot, targetRoot] = added.snapshot.roots;
		targetRootId = targetRoot!.rootId;

		const result = await bridge.workspaceMove(
			sourceRoot!.rootId,
			"move-tree",
			targetRootId,
			"packages/move-tree",
		);
		await targetRename;

		expect(result).toEqual({
			status: "targetPublishedSourcePartiallyDeleted",
			reason: "targetChanged",
			removedEntries: 1,
		});
		expect(
			(
				await bridge.workspaceStat(
					targetRootId,
					"packages/move-tree-away/b.bin",
				)
			).kind,
		).toBe("file");
		expect(
			(await bridge.workspaceStat(sourceRoot!.rootId, "move-tree/b.bin")).kind,
		).toBe("file");
	});
});
