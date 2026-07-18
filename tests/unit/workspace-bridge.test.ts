import { describe, expect, it } from "vitest";

import {
	createBrowserMockBridge,
	type BrowserMockSymlinkCopyObservation,
} from "../../app/platform/tauri/browser-mock";

describe("browser mock workspace bridge", () => {
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
		const first = file.copy();
		const second = file.copy();
		expect([...first]).toEqual([0, 255, 128, 1, 0, 42]);
		expect(first).not.toBe(second);
		first[0] = 99;
		expect([...second]).toEqual([0, 255, 128, 1, 0, 42]);
		expect([...file.copy()]).toEqual([0, 255, 128, 1, 0, 42]);
	});

	it("creates empty files and single directories without changing root revisions", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;

		await bridge.workspaceCreateFile(rootId, "created.txt");
		await bridge.workspaceCreateDirectory(rootId, "created-directory");
		await bridge.workspaceCreateFile(rootId, "created-directory/nested.txt");

		expect(await bridge.workspaceSnapshot()).toMatchObject({ revision: 1 });
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
			).copy(),
		).toEqual(new Uint8Array());
	});

	it("creates atomically without clobbering any existing entry", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		const rootId = selected.snapshot.roots[0]!.rootId;
		const before = (await bridge.workspaceReadFile(rootId, "README.md")).copy();

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
			(await bridge.workspaceReadFile(rootId, "README.md")).copy(),
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
		const readme = (await bridge.workspaceReadFile(rootId, "README.md")).copy();

		await bridge.workspaceRename(rootId, "README.md", "GUIDE.md");
		await expect(
			bridge.workspaceStat(rootId, "README.md"),
		).rejects.toMatchObject({ code: "ENTRY_NOT_FOUND" });
		expect((await bridge.workspaceReadFile(rootId, "GUIDE.md")).copy()).toEqual(
			readme,
		);

		await bridge.workspaceRename(rootId, "src", "source");
		await expect(bridge.workspaceStat(rootId, "src")).rejects.toMatchObject({
			code: "ENTRY_NOT_FOUND",
		});
		expect(
			(await bridge.workspaceReadDirectory(rootId, "source")).entries,
		).toEqual([{ name: "main.ts", kind: "file" }]);
		expect(
			(await bridge.workspaceReadFile(rootId, "source/main.ts")).byteLength,
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
		const readme = (await bridge.workspaceReadFile(rootId, "README.md")).copy();
		const binary = (
			await bridge.workspaceReadFile(rootId, "binary.bin")
		).copy();

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
			(await bridge.workspaceReadFile(rootId, "README.md")).copy(),
		).toEqual(readme);
		expect(
			(await bridge.workspaceReadFile(rootId, "binary.bin")).copy(),
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
		).copy();

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
			).copy(),
		).toEqual(source);
		expect(
			(
				await bridge.workspaceReadFile(
					libraryRoot!.rootId,
					"packages/copied.bin",
				)
			).copy(),
		).toEqual(source);
		expect(
			(
				await bridge.workspaceReadFile(workspaceRoot!.rootId, "binary.bin")
			).copy(),
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
		const readme = (await bridge.workspaceReadFile(rootId, "README.md")).copy();
		const binary = (
			await bridge.workspaceReadFile(rootId, "binary.bin")
		).copy();

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
			(await bridge.workspaceReadFile(rootId, "README.md")).copy(),
		).toEqual(readme);
		expect(
			(await bridge.workspaceReadFile(rootId, "binary.bin")).copy(),
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

		for (const sourcePath of ["src", "fixtures/other"]) {
			await expect(
				bridge.workspaceCopy(rootId, sourcePath, rootId, "copy-target"),
			).rejects.toEqual({
				code: "ENTRY_TYPE_MISMATCH",
				message: "The workspace entry has an incompatible type.",
			});
		}
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
});
