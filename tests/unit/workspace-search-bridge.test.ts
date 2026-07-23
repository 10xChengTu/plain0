import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

import { createNativeBridge } from "../../app/platform/tauri/native";
import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";

const rootId = "00000000-0000-4000-8000-000000000101";
const searchId = "00000000-0000-4000-8000-000000000201";

describe("native workspace search bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

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

describe("native streaming text search bridge (F040 S3)", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("invokes workspace_search_text_start with the exact frozen request and decodes the searchId", async () => {
		tauri.invoke.mockResolvedValueOnce({ searchId });
		const bridge = createNativeBridge();

		const result = await bridge.workspaceSearchTextStart({
			roots: [rootId],
			pattern: "needle",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
			excludeGlobs: [],
			maxResults: 512,
			maxFileSize: null,
		});

		expect(tauri.invoke.mock.calls).toEqual([
			[
				"workspace_search_text_start",
				{
					request: {
						roots: [rootId],
						pattern: "needle",
						isRegExp: false,
						isCaseSensitive: false,
						isWordMatch: false,
						excludeGlobs: [],
						maxResults: 512,
						maxFileSize: null,
					},
				},
			],
		]);
		expect(result).toEqual({ searchId });
	});

	it("invokes workspace_search_text_poll with searchId/cursor and decodes a poll result", async () => {
		tauri.invoke.mockResolvedValueOnce({
			batches: [
				{
					path: "a.ts",
					matches: [{ line: 1, column: 1, length: 6, previewText: "needle" }],
				},
			],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		const bridge = createNativeBridge();

		const result = await bridge.workspaceSearchTextPoll(searchId, 0);

		expect(tauri.invoke.mock.calls).toEqual([
			["workspace_search_text_poll", { request: { searchId, cursor: 0 } }],
		]);
		expect(result.batches[0]?.path).toBe("a.ts");
		expect(result.done).toBe(true);
	});

	it("invokes workspace_search_text_cancel with the searchId and decodes void", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.workspaceSearchTextCancel(searchId);

		expect(tauri.invoke.mock.calls).toEqual([
			["workspace_search_text_cancel", { request: { searchId } }],
		]);
	});

	it("registers exactly one wake listener and decodes the event's searchId", async () => {
		let wakeHandler:
			((event: { readonly payload: unknown }) => void) | undefined;
		const unlisten = vi.fn();
		tauri.listen.mockImplementation(
			async (eventName: string, handler: never) => {
				expect(eventName).toBe("plain://workspace-search-text-wake");
				wakeHandler = handler;
				return unlisten;
			},
		);
		const bridge = createNativeBridge();
		const received: string[] = [];
		const stop = bridge.workspaceSearchTextWatch((id) => received.push(id));
		await Promise.resolve();
		await Promise.resolve();

		wakeHandler?.({ payload: { searchId } });
		expect(received).toEqual([searchId]);
		expect(tauri.listen).toHaveBeenCalledOnce();

		stop();
		await Promise.resolve();
		await Promise.resolve();
		expect(unlisten).toHaveBeenCalledOnce();
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

describe("browser mock streaming text search bridge (F040 S3)", () => {
	function startRequest(
		overrides: Partial<{
			pattern: string;
			isRegExp: boolean;
			isCaseSensitive: boolean;
			isWordMatch: boolean;
			excludeGlobs: readonly string[];
			maxResults: number;
			maxFileSize: number | null;
		}> = {},
	) {
		return {
			roots: [rootId],
			pattern: "needle",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
			excludeGlobs: [],
			maxResults: 20_000,
			maxFileSize: null,
			...overrides,
		};
	}

	async function pollAllBatches(
		bridge: ReturnType<typeof createBrowserMockBridge>,
		id: string,
	) {
		const batches: Array<{ path: string; matches: readonly unknown[] }> = [];
		let cursor = 0;
		for (let iterations = 0; iterations < 1_000; iterations += 1) {
			const result = await bridge.workspaceSearchTextPoll(id, cursor);
			cursor = result.nextCursor;
			batches.push(...result.batches);
			if (result.done) {
				return { batches, limitHit: result.limitHit, skipped: result.skipped };
			}
		}
		throw new Error(
			"pollAllBatches: too many iterations, search never completed",
		);
	}

	it("streams matches across multiple files one batch per poll by default", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/a.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/a.txt",
			(await bridge.workspaceStat(rootId, "fixture/a.txt")).version!,
			new TextEncoder().encode("needle here\n"),
		);
		await bridge.workspaceCreateFile(rootId, "fixture/b.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/b.txt",
			(await bridge.workspaceStat(rootId, "fixture/b.txt")).version!,
			new TextEncoder().encode("another needle\n"),
		);

		const { searchId: startedId } =
			await bridge.workspaceSearchTextStart(startRequest());
		const perPollBatchCounts: number[] = [];
		let cursor = 0;
		let done = false;
		const batches: Array<{ path: string }> = [];
		while (!done) {
			const result = await bridge.workspaceSearchTextPoll(startedId, cursor);
			perPollBatchCounts.push(result.batches.length);
			batches.push(...result.batches);
			cursor = result.nextCursor;
			done = result.done;
		}
		// The default `textSearchBatchesPerPollForTest` of 1 means each poll
		// (until the final, empty, done=true one) delivers exactly one batch —
		// genuine evidence of multi-poll streaming, not everything arriving at
		// once.
		expect(perPollBatchCounts.filter((count) => count > 0)).toEqual([1, 1]);
		const paths = [...new Set(batches.map((b) => b.path))].sort();
		expect(paths).toEqual(["fixture/a.txt", "fixture/b.txt"]);
	});

	it("reports limitHit once the (lowered, test-only) match budget is exhausted", async () => {
		const bridge = createBrowserMockBridge({ textSearchMaxMatchesForTest: 1 });
		await bridge.workspacePickRoots("replace");
		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/a.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/a.txt",
			(await bridge.workspaceStat(rootId, "fixture/a.txt")).version!,
			new TextEncoder().encode("needle\n"),
		);
		await bridge.workspaceCreateFile(rootId, "fixture/b.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/b.txt",
			(await bridge.workspaceStat(rootId, "fixture/b.txt")).version!,
			new TextEncoder().encode("needle\n"),
		);

		const { searchId: startedId } =
			await bridge.workspaceSearchTextStart(startRequest());
		const { batches, limitHit } = await pollAllBatches(bridge, startedId);
		const totalMatches = batches.reduce((sum, b) => sum + b.matches.length, 0);
		expect(totalMatches).toBe(1);
		expect(limitHit).toBe(true);
	});

	it("skips and counts binary and oversized files without reporting them as matches", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/normal.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/normal.txt",
			(await bridge.workspaceStat(rootId, "fixture/normal.txt")).version!,
			new TextEncoder().encode("needle\n"),
		);
		await bridge.workspaceCreateFile(rootId, "fixture/binary.bin");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/binary.bin",
			(await bridge.workspaceStat(rootId, "fixture/binary.bin")).version!,
			new Uint8Array([...new TextEncoder().encode("needle"), 0]),
		);
		await bridge.workspaceCreateFile(rootId, "fixture/huge.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/huge.txt",
			(await bridge.workspaceStat(rootId, "fixture/huge.txt")).version!,
			new TextEncoder().encode("needle\n".repeat(5)),
		);

		const { searchId: startedId } = await bridge.workspaceSearchTextStart(
			startRequest({
				maxFileSize: 10,
				// The default mock tree's own root-level entries are unrelated
				// to this test's own "fixture/" files and would otherwise also
				// count as oversized/binary against the tiny 10-byte budget
				// above; exclude every one of them by exact name so the counts
				// below reflect only what this test created.
				excludeGlobs: [
					".plainrc",
					"README.md",
					"binary.bin",
					"empty",
					"fixtures",
					"src",
				],
			}),
		);
		const { batches, skipped } = await pollAllBatches(bridge, startedId);
		expect(batches.map((b) => b.path)).toEqual(["fixture/normal.txt"]);
		expect(skipped.binary).toBe(1);
		expect(skipped.oversize).toBe(1);
	});

	it("supports case-insensitive, case-sensitive, word-match and regex modes", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/a.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/a.txt",
			(await bridge.workspaceStat(rootId, "fixture/a.txt")).version!,
			new TextEncoder().encode("Needles and needle 123\n"),
		);

		const insensitive = await bridge.workspaceSearchTextStart(
			startRequest({ pattern: "needle" }),
		);
		const insensitiveResult = await pollAllBatches(
			bridge,
			insensitive.searchId,
		);
		expect(insensitiveResult.batches[0]?.matches).toHaveLength(2);

		const sensitive = await bridge.workspaceSearchTextStart(
			startRequest({ pattern: "needle", isCaseSensitive: true }),
		);
		const sensitiveResult = await pollAllBatches(bridge, sensitive.searchId);
		expect(sensitiveResult.batches[0]?.matches).toHaveLength(1);

		const wordMatch = await bridge.workspaceSearchTextStart(
			startRequest({ pattern: "needle", isWordMatch: true }),
		);
		const wordMatchResult = await pollAllBatches(bridge, wordMatch.searchId);
		expect(wordMatchResult.batches[0]?.matches).toHaveLength(1);

		const regex = await bridge.workspaceSearchTextStart(
			startRequest({ pattern: "\\d+", isRegExp: true }),
		);
		const regexResult = await pollAllBatches(bridge, regex.searchId);
		expect(regexResult.batches[0]?.matches[0]).toMatchObject({
			previewText: "Needles and needle 123",
			length: 3,
		});
	});

	it("rejects an invalid regex pattern with INVALID_SEARCH_REGEX", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		await expect(
			bridge.workspaceSearchTextStart(
				startRequest({ pattern: "(unclosed", isRegExp: true }),
			),
		).rejects.toMatchObject({ code: "INVALID_SEARCH_REGEX" });
	});

	it("rejects a request naming an unauthorized root", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const unauthorized = "00000000-0000-4000-8000-000000000999";

		await expect(
			bridge.workspaceSearchTextStart({
				...startRequest(),
				roots: [unauthorized],
			}),
		).rejects.toMatchObject({ code: "ROOT_NOT_AUTHORIZED" });
	});

	it("supersedes an in-flight search and rejects the superseded id with WORKSPACE_SEARCH_NOT_FOUND", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		const first = await bridge.workspaceSearchTextStart(startRequest());
		const second = await bridge.workspaceSearchTextStart(startRequest());
		expect(second.searchId).not.toBe(first.searchId);

		await expect(
			bridge.workspaceSearchTextPoll(first.searchId, 0),
		).rejects.toMatchObject({ code: "WORKSPACE_SEARCH_NOT_FOUND" });
		await expect(
			pollAllBatches(bridge, second.searchId),
		).resolves.toBeDefined();
	});

	it("cancel is not idempotent in outcome: a second cancel on the same id rejects", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");
		const { searchId: startedId } =
			await bridge.workspaceSearchTextStart(startRequest());

		await bridge.workspaceSearchTextCancel(startedId);
		await expect(
			bridge.workspaceSearchTextCancel(startedId),
		).rejects.toMatchObject({ code: "WORKSPACE_SEARCH_NOT_FOUND" });
		await expect(
			bridge.workspaceSearchTextPoll(startedId, 0),
		).rejects.toMatchObject({ code: "WORKSPACE_SEARCH_NOT_FOUND" });
	});

	it("emits a wake hint carrying the searchId whenever a batch becomes available", async () => {
		const bridge = createBrowserMockBridge({
			textSearchBatchesPerPollForTest: 1,
		});
		await bridge.workspacePickRoots("replace");
		await bridge.workspaceCreateDirectory(rootId, "fixture");
		await bridge.workspaceCreateFile(rootId, "fixture/a.txt");
		await bridge.workspaceWriteFile(
			rootId,
			"fixture/a.txt",
			(await bridge.workspaceStat(rootId, "fixture/a.txt")).version!,
			new TextEncoder().encode("needle\n"),
		);

		const wakes: string[] = [];
		const stop = bridge.workspaceSearchTextWatch((id) => wakes.push(id));
		const { searchId: startedId } =
			await bridge.workspaceSearchTextStart(startRequest());
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(wakes).toContain(startedId);
		stop();
	});
});
