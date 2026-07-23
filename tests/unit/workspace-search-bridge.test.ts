import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { createNativeBridge } from "../../app/platform/tauri/native";
import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";

const rootId = "00000000-0000-4000-8000-000000000101";

describe("native workspace search bridge", () => {
	beforeEach(() => tauri.invoke.mockReset());

	it("invokes workspace_search_files with the exact frozen request and decodes the response", async () => {
		tauri.invoke.mockResolvedValueOnce({
			entries: ["src/main.ts", "README.md"],
			limitHit: true,
		});
		const bridge = createNativeBridge();

		const result = await bridge.workspaceSearchFiles(
			[rootId],
			"main",
			["**/node_modules"],
			512,
		);

		expect(tauri.invoke.mock.calls).toEqual([
			[
				"workspace_search_files",
				{
					request: {
						roots: [rootId],
						filePattern: "main",
						excludeGlobs: ["**/node_modules"],
						maxResults: 512,
					},
				},
			],
		]);
		expect(result).toEqual({
			entries: ["src/main.ts", "README.md"],
			limitHit: true,
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("rejects a malformed native response before it reaches the caller", async () => {
		tauri.invoke.mockResolvedValueOnce({ entries: ["a.txt"] });
		const bridge = createNativeBridge();

		await expect(
			bridge.workspaceSearchFiles([rootId], "", [], 512),
		).rejects.toMatchObject({ code: "IPC_CONTRACT_VIOLATION" });
	});
});

describe("browser mock workspace search bridge", () => {
	it("honors a nested .gitignore, exclude globs, and returns unignored files", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/.gitignore");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/.gitignore",
			(await bridge.workspaceStat(rootId, "fixture/.gitignore")).version!,
			new TextEncoder().encode("secret.txt\n"),
		);
		await bridge.workspaceCreateFile(rootId, "fixture/secret.txt");
		await bridge.workspaceCreateFile(rootId, "fixture/visible.txt");
		await bridge.workspaceCreateDirectory(rootId, "fixture/node_modules");
		await bridge.workspaceCreateFile(rootId, "fixture/node_modules/pkg.js");

		const result = await bridge.workspaceSearchFiles(
			[rootId],
			"",
			["**/node_modules"],
			512,
		);

		expect(result.entries).toContain("fixture/visible.txt");
		expect(result.entries).not.toContain("fixture/secret.txt");
		expect(result.entries).not.toContain("fixture/node_modules/pkg.js");
		expect(result.limitHit).toBe(false);
	});

	it("applies the cheap case-insensitive subsequence prefilter", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		const all = await bridge.workspaceSearchFiles([rootId], "", [], 512);
		expect(all.entries).toContain("README.md");

		const matched = await bridge.workspaceSearchFiles(
			[rootId],
			"readme",
			[],
			512,
		);
		expect(matched.entries).toEqual(["README.md"]);

		const unmatched = await bridge.workspaceSearchFiles(
			[rootId],
			"zzz-no-such-file",
			[],
			512,
		);
		expect(unmatched.entries).toEqual([]);
		expect(unmatched.limitHit).toBe(false);
	});

	it("truncates at maxResults and reports limitHit", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		const capped = await bridge.workspaceSearchFiles([rootId], "", [], 1);
		expect(capped.entries).toHaveLength(1);
		expect(capped.limitHit).toBe(true);
	});

	it("rejects a request naming an unauthorized root", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const unauthorized = "00000000-0000-4000-8000-000000000999";

		await expect(
			bridge.workspaceSearchFiles([unauthorized], "", [], 512),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
	});

	it("never reports a symlink as a match and never traverses through one", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		const result = await bridge.workspaceSearchFiles([rootId], "", [], 512);
		expect(result.entries).not.toContain("fixtures/file-link");
		expect(result.entries).not.toContain("fixtures/directory-link/main.ts");
	});
});
