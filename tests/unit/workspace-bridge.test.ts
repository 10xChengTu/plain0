import { describe, expect, it } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";

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
