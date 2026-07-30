import { describe, expect, it, vi } from "vitest";

import type {
	GitBlameCommitHeader,
	GitBlameFileResult,
	GitBlameLineEntry,
} from "../../app/platform/tauri/contracts";
import {
	blameAgeBucketIndex,
	buildBlameDecorations,
	DEFAULT_BLAME_AGE_BUCKET_COUNT,
	formatBlameHoverMarkdown,
	formatInlineBlameText,
	formatRelativeTime,
	PlainGitBlameEditorController,
	PlainGitBlameFileIndex,
	PlainGitBlameHoverProvider,
	type PlainGitBlameBridge,
	type PlainGitBlameEditorLike,
} from "../../app/features/scm/plain-git-blame";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const ZERO_SHA = "0".repeat(40);

function commitHeader(
	overrides: Partial<GitBlameCommitHeader> = {},
): GitBlameCommitHeader {
	return {
		author: "Author A",
		authorMail: "<a@example.com>",
		authorTime: 1_700_000_000,
		authorTz: "+0800",
		committer: "Author A",
		committerMail: "<a@example.com>",
		committerTime: 1_700_000_000,
		committerTz: "+0800",
		summary: "initial commit",
		...overrides,
	};
}

function lineEntry(
	overrides: Partial<GitBlameLineEntry> = {},
): GitBlameLineEntry {
	return {
		commitSha: SHA_A,
		isUncommitted: false,
		origLine: 1,
		finalLine: 1,
		isBoundary: false,
		filename: "a.txt",
		previous: null,
		...overrides,
	};
}

describe("blameAgeBucketIndex", () => {
	it("returns bucket 0 (warmest) for the newest commit", () => {
		expect(blameAgeBucketIndex(200, 100, 200)).toBe(0);
	});

	it("returns the last bucket (coolest) for the oldest commit", () => {
		expect(blameAgeBucketIndex(100, 100, 200)).toBe(
			DEFAULT_BLAME_AGE_BUCKET_COUNT - 1,
		);
	});

	it("distributes evenly-spaced times across the full bucket range", () => {
		const oldest = 0;
		const newest = 600;
		const buckets = [0, 100, 200, 300, 400, 500, 600].map((time) =>
			blameAgeBucketIndex(time, oldest, newest, 6),
		);
		// Monotonic: newer time -> same or lower (warmer) bucket index.
		for (let index = 1; index < buckets.length; index += 1) {
			expect(buckets[index]).toBeLessThanOrEqual(buckets[index - 1]!);
		}
		expect(buckets[0]).toBe(5); // oldest (time 0) -> coolest
		expect(buckets[6]).toBe(0); // newest (time 600) -> warmest
	});

	it("returns bucket 0 when every commit shares the same time (no spread)", () => {
		expect(blameAgeBucketIndex(500, 500, 500)).toBe(0);
		expect(blameAgeBucketIndex(500, 500, 400)).toBe(0); // newest <= oldest guard
	});

	it("clamps a commit time outside the [oldest, newest] range", () => {
		expect(blameAgeBucketIndex(50, 100, 200)).toBe(
			blameAgeBucketIndex(100, 100, 200),
		);
		expect(blameAgeBucketIndex(300, 100, 200)).toBe(
			blameAgeBucketIndex(200, 100, 200),
		);
	});

	it("returns bucket 0 for a bucketCount of 1 or less", () => {
		expect(blameAgeBucketIndex(100, 0, 200, 1)).toBe(0);
		expect(blameAgeBucketIndex(100, 0, 200, 0)).toBe(0);
	});
});

describe("formatRelativeTime", () => {
	const nowMs = Date.parse("2024-06-15T12:00:00Z");
	const nowSeconds = nowMs / 1000;

	it("reports 'just now' for anything under a minute, including future clock skew", () => {
		expect(formatRelativeTime(nowSeconds, nowMs)).toBe("just now");
		expect(formatRelativeTime(nowSeconds - 30, nowMs)).toBe("just now");
		expect(formatRelativeTime(nowSeconds + 500, nowMs)).toBe("just now");
	});

	it("formats minutes, singular and plural", () => {
		expect(formatRelativeTime(nowSeconds - 60, nowMs)).toBe("1 minute ago");
		expect(formatRelativeTime(nowSeconds - 60 * 5, nowMs)).toBe(
			"5 minutes ago",
		);
	});

	it("formats hours, days, weeks, months and years", () => {
		expect(formatRelativeTime(nowSeconds - 3600, nowMs)).toBe("1 hour ago");
		expect(formatRelativeTime(nowSeconds - 3600 * 5, nowMs)).toBe(
			"5 hours ago",
		);
		expect(formatRelativeTime(nowSeconds - 86400, nowMs)).toBe("1 day ago");
		expect(formatRelativeTime(nowSeconds - 86400 * 3, nowMs)).toBe(
			"3 days ago",
		);
		expect(formatRelativeTime(nowSeconds - 86400 * 7, nowMs)).toBe(
			"1 week ago",
		);
		expect(formatRelativeTime(nowSeconds - 86400 * 65, nowMs)).toBe(
			"2 months ago",
		);
		expect(formatRelativeTime(nowSeconds - 86400 * 400, nowMs)).toBe(
			"1 year ago",
		);
	});
});

describe("formatInlineBlameText", () => {
	const nowMs = Date.parse("2024-06-15T12:00:00Z");

	it("reports 'Uncommitted changes' regardless of header content", () => {
		expect(formatInlineBlameText(commitHeader(), true, nowMs)).toBe(
			"Uncommitted changes",
		);
	});

	it("includes author, relative time and summary", () => {
		const header = commitHeader({
			author: "Ada",
			authorTime: nowMs / 1000 - 3600,
			summary: "fix off-by-one",
		});
		expect(formatInlineBlameText(header, false, nowMs)).toBe(
			"Ada, 1 hour ago • fix off-by-one",
		);
	});

	it("omits the summary separator when the summary is empty", () => {
		const header = commitHeader({ authorTime: nowMs / 1000, summary: "" });
		expect(formatInlineBlameText(header, false, nowMs)).toBe(
			"Author A, just now",
		);
	});

	it("falls back to 'Unknown' for a blank author name", () => {
		const header = commitHeader({ author: "   ", authorTime: nowMs / 1000 });
		expect(formatInlineBlameText(header, false, nowMs)).toContain("Unknown,");
	});
});

describe("formatBlameHoverMarkdown", () => {
	const nowMs = Date.parse("2024-06-15T12:00:00Z");

	it("reports an uncommitted-changes message for an uncommitted entry", () => {
		const value = formatBlameHoverMarkdown(
			lineEntry({ isUncommitted: true, commitSha: ZERO_SHA }),
			commitHeader(),
			undefined,
			nowMs,
		);
		expect(value).toContain("Uncommitted changes");
	});

	it("uses the full fetched body when available", () => {
		const value = formatBlameHoverMarkdown(
			lineEntry({ commitSha: SHA_A }),
			commitHeader({ authorTime: nowMs / 1000, summary: "fix bug" }),
			"fix bug\n\nlonger explanation",
			nowMs,
		);
		expect(value).toContain("fix bug\n\nlonger explanation");
		expect(value).toContain(SHA_A.slice(0, 7));
	});

	it("falls back to the header's summary when no full body is available", () => {
		const value = formatBlameHoverMarkdown(
			lineEntry({ commitSha: SHA_A }),
			commitHeader({ authorTime: nowMs / 1000, summary: "fix bug" }),
			undefined,
			nowMs,
		);
		expect(value).toContain("fix bug");
	});
});

describe("PlainGitBlameFileIndex", () => {
	it("looks up an entry by final line and derives the oldest/newest spread", () => {
		const index = new PlainGitBlameFileIndex();
		const result: GitBlameFileResult = {
			entries: [
				lineEntry({ commitSha: SHA_A, finalLine: 1 }),
				lineEntry({ commitSha: SHA_B, finalLine: 2 }),
			],
			commits: {
				[SHA_A]: commitHeader({ authorTime: 100 }),
				[SHA_B]: commitHeader({ authorTime: 200 }),
			},
		};
		index.setResult(result);
		expect(index.lineLookup(1)?.entry.commitSha).toBe(SHA_A);
		expect(index.lineLookup(2)?.header?.authorTime).toBe(200);
		expect(index.lineLookup(3)).toBeUndefined();
		expect(index.ageBucket(2)).toBe(0); // newest
		expect(index.ageBucket(1)).toBe(DEFAULT_BLAME_AGE_BUCKET_COUNT - 1); // oldest
	});

	it("returns undefined ageBucket for a line with no entry", () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({ entries: [], commits: {} });
		expect(index.ageBucket(1)).toBeUndefined();
	});
});

describe("buildBlameDecorations", () => {
	it("builds one after-decoration per known line, skipping unknown lines", () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({
			entries: [
				lineEntry({ commitSha: SHA_A, finalLine: 1 }),
				lineEntry({ commitSha: SHA_A, finalLine: 3 }),
			],
			commits: { [SHA_A]: commitHeader({ authorTime: 100, summary: "x" }) },
		});
		const nowMs = Date.parse("2024-06-15T12:00:00Z");
		const decorations = buildBlameDecorations(index, 3, nowMs);
		expect(decorations).toHaveLength(2);
		expect(decorations[0]?.range.startLineNumber).toBe(1);
		expect(decorations[1]?.range.startLineNumber).toBe(3);
		expect(decorations[0]?.options.after?.inlineClassName).toContain(
			"plain-git-blame-age-0",
		);
		expect(decorations[0]?.options.description).toBe("plain-git-blame-inline");
	});

	it("produces no decorations for a file with an empty blame result", () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({ entries: [], commits: {} });
		expect(buildBlameDecorations(index, 5, Date.now())).toEqual([]);
	});
});

// --- editor controller (narrow fake editor, no real Monaco involved) -------

class FakeEditor implements PlainGitBlameEditorLike {
	#model: { uri: { toString(): string }; getLineCount(): number } | null;
	appliedDecorations: unknown[] = [];

	constructor(initialUri: string, lineCount: number) {
		this.#model = {
			uri: { toString: () => initialUri },
			getLineCount: () => lineCount,
		};
	}

	getModel(): { uri: { toString(): string }; getLineCount(): number } | null {
		return this.#model;
	}

	deltaDecorations(
		_oldDecorationIds: readonly string[],
		newDecorations: readonly unknown[],
	): string[] {
		this.appliedDecorations = [...newDecorations];
		return newDecorations.map((_decoration, index) => `deco-${index}`);
	}

	setModel(uri: string | null, lineCount: number): void {
		this.#model =
			uri === null
				? null
				: { uri: { toString: () => uri }, getLineCount: () => lineCount };
	}
}

function fakeEditor(initialUri: string, lineCount: number): FakeEditor {
	return new FakeEditor(initialUri, lineCount);
}

describe("PlainGitBlameEditorController", () => {
	it("fetches whole-file blame and applies decorations for the current model", async () => {
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(async () => ({
				entries: [lineEntry({ commitSha: SHA_A, finalLine: 1 })],
				commits: { [SHA_A]: commitHeader({ authorTime: 100, summary: "x" }) },
			})),
			gitBlameCommitMessages: vi.fn(async () => ({ messages: {} })),
		};
		const controller = new PlainGitBlameEditorController(bridge, () =>
			Date.now(),
		);
		const editor = fakeEditor("file:///a.txt", 3);
		await controller.refresh(editor, "a.txt");
		expect(bridge.gitBlameFile).toHaveBeenCalledWith("a.txt", null);
		expect(controller.index.lineLookup(1)?.entry.commitSha).toBe(SHA_A);
	});

	it("abandons a stale fetch if the editor's model changed while it was in flight", async () => {
		let resolveBlame: (value: GitBlameFileResult) => void = () => {
			/* replaced below */
		};
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(
				() =>
					new Promise<GitBlameFileResult>((resolve) => {
						resolveBlame = resolve;
					}),
			),
			gitBlameCommitMessages: vi.fn(async () => ({ messages: {} })),
		};
		const controller = new PlainGitBlameEditorController(bridge, () =>
			Date.now(),
		);
		const editor = fakeEditor("file:///a.txt", 3);
		const refreshPromise = controller.refresh(editor, "a.txt");
		// The user switches to a different file before the fetch resolves.
		editor.setModel("file:///b.txt", 5);
		resolveBlame({
			entries: [lineEntry({ commitSha: SHA_A, finalLine: 1 })],
			commits: { [SHA_A]: commitHeader() },
		});
		await refreshPromise;
		// The index was still populated (harmless), but no decorations were
		// applied to the now-current (different) model.
		expect(editor.appliedDecorations).toEqual([]);
	});

	it("never rejects when gitBlameFile fails — the real regression this test guards against", async () => {
		// Reproduces a real bug caught by the full Browser E2E suite: an
		// untrusted workspace, a missing repository, or (as here) a test
		// harness that does not recognize the command all reject
		// `gitBlameFile`; a naive `refresh` would let that rejection escape
		// as an unhandled promise rejection the moment a caller does the real
		// contribution's own fire-and-forget `void controller.refresh(...)`
		// (which this test also exercises directly, not just via `await`).
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(async () => {
				throw new Error(
					"Unexpected Tauri multi-root test command: git_blame_file",
				);
			}),
			gitBlameCommitMessages: vi.fn(),
		};
		const controller = new PlainGitBlameEditorController(bridge);
		const editor = fakeEditor("file:///a.txt", 3);
		await expect(controller.refresh(editor, "a.txt")).resolves.toBeUndefined();
		expect(editor.appliedDecorations).toEqual([]);

		const unhandledRejections: unknown[] = [];
		const listener = (reason: unknown) => unhandledRejections.push(reason);
		process.on("unhandledRejection", listener);
		try {
			void controller.refresh(editor, "a.txt");
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			process.off("unhandledRejection", listener);
		}
		expect(unhandledRejections).toEqual([]);
	});

	it("clear() removes any previously-applied decorations", () => {
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(),
		};
		const controller = new PlainGitBlameEditorController(bridge);
		const editor = fakeEditor("file:///a.txt", 3);
		const deltaSpy = vi.spyOn(editor, "deltaDecorations");
		controller.clear(editor);
		expect(deltaSpy).toHaveBeenCalledWith([], []);
	});
});

describe("PlainGitBlameHoverProvider", () => {
	const cancellationToken = {} as never;

	it("returns undefined for a model with no tracked blame index", async () => {
		const provider = new PlainGitBlameHoverProvider(() => undefined, {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(),
		});
		const model = { uri: { toString: () => "file:///untracked.txt" } } as never;
		const position = { lineNumber: 1 } as never;
		const hover = await provider.provideHover(
			model,
			position,
			cancellationToken,
		);
		expect(hover).toBeUndefined();
	});

	it("returns a hover with the fetched full body for a tracked, committed line", async () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({
			entries: [lineEntry({ commitSha: SHA_A, finalLine: 1 })],
			commits: { [SHA_A]: commitHeader({ summary: "fix bug" }) },
		});
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(async () => ({
				messages: { [SHA_A]: "fix bug\n\nlong body" },
			})),
		};
		const provider = new PlainGitBlameHoverProvider(
			(uri) => (uri.toString() === "file:///a.txt" ? index : undefined),
			bridge,
		);
		const model = { uri: { toString: () => "file:///a.txt" } } as never;
		const position = { lineNumber: 1 } as never;
		const hover = await provider.provideHover(
			model,
			position,
			cancellationToken,
		);
		expect(hover?.contents[0]?.value).toContain("long body");
		expect(bridge.gitBlameCommitMessages).toHaveBeenCalledWith([SHA_A]);
	});

	it("falls back to the summary when the commit-messages fetch rejects", async () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({
			entries: [lineEntry({ commitSha: SHA_A, finalLine: 1 })],
			commits: { [SHA_A]: commitHeader({ summary: "fix bug" }) },
		});
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(async () => {
				throw new Error("workspace lost trust");
			}),
		};
		const provider = new PlainGitBlameHoverProvider(() => index, bridge);
		const model = { uri: { toString: () => "file:///a.txt" } } as never;
		const position = { lineNumber: 1 } as never;
		const hover = await provider.provideHover(
			model,
			position,
			cancellationToken,
		);
		expect(hover?.contents[0]?.value).toContain("fix bug");
	});

	it("never calls gitBlameCommitMessages for an uncommitted line", async () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({
			entries: [
				lineEntry({ commitSha: ZERO_SHA, isUncommitted: true, finalLine: 1 }),
			],
			commits: {
				[ZERO_SHA]: commitHeader({
					author: "Not Committed Yet",
					summary: "Version of a.txt from a.txt",
				}),
			},
		});
		const bridge: PlainGitBlameBridge = {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(async () => ({ messages: {} })),
		};
		const provider = new PlainGitBlameHoverProvider(() => index, bridge);
		const model = { uri: { toString: () => "file:///a.txt" } } as never;
		const position = { lineNumber: 1 } as never;
		const hover = await provider.provideHover(
			model,
			position,
			cancellationToken,
		);
		expect(hover?.contents[0]?.value).toContain("Uncommitted changes");
		expect(bridge.gitBlameCommitMessages).not.toHaveBeenCalled();
	});

	it("returns undefined for a tracked model but a line with no blame entry", async () => {
		const index = new PlainGitBlameFileIndex();
		index.setResult({ entries: [], commits: {} });
		const provider = new PlainGitBlameHoverProvider(() => index, {
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(),
		});
		const model = { uri: { toString: () => "file:///a.txt" } } as never;
		const position = { lineNumber: 1 } as never;
		const hover = await provider.provideHover(
			model,
			position,
			cancellationToken,
		);
		expect(hover).toBeUndefined();
	});
});
