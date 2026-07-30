import { describe, expect, it, vi } from "vitest";

import type {
	GitHistoryEntry,
	GitHistoryListResult,
	GitLineHistoryDetail,
} from "../../app/platform/tauri/contracts";
import {
	historyEntrySummary,
	PlainGitHistoryController,
	shortCommitSha,
	type PlainGitHistoryBridge,
} from "../../app/features/scm/plain-git-history";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function entry(overrides: Partial<GitHistoryEntry> = {}): GitHistoryEntry {
	return {
		sha: SHA_A,
		message: "initial commit\n\nlonger body text",
		...overrides,
	};
}

function historyList(
	entries: readonly GitHistoryEntry[],
): GitHistoryListResult {
	return { entries, truncated: false };
}

describe("shortCommitSha", () => {
	it("returns the first 7 characters", () => {
		expect(shortCommitSha(SHA_A)).toBe("aaaaaaa");
	});
});

describe("historyEntrySummary", () => {
	it("returns the message's first line, trimmed", () => {
		expect(
			historyEntrySummary(entry({ message: "  fix off-by-one  \nbody" })),
		).toBe("fix off-by-one");
	});

	it("returns a placeholder for a message with no non-whitespace first line", () => {
		expect(historyEntrySummary(entry({ message: "\nbody only" }))).toBe(
			"(no commit message)",
		);
		expect(historyEntrySummary(entry({ message: "" }))).toBe(
			"(no commit message)",
		);
	});

	it("does not include the message's later lines", () => {
		const summary = historyEntrySummary(
			entry({ message: "subject\nsecond line\nthird line" }),
		);
		expect(summary).toBe("subject");
		expect(summary).not.toContain("second line");
	});
});

function fakeBridge(
	overrides: Partial<PlainGitHistoryBridge> = {},
): PlainGitHistoryBridge {
	return {
		gitFileHistory: vi.fn().mockResolvedValue(historyList([])),
		gitLineHistoryList: vi.fn().mockResolvedValue(historyList([])),
		gitLineHistoryDetail: vi
			.fn()
			.mockResolvedValue({ sha: SHA_A, diffText: "commit " + SHA_A }),
		...overrides,
	};
}

describe("PlainGitHistoryController.loadFileHistory", () => {
	it("fetches and stores the file history for the given path", async () => {
		const list = historyList([entry()]);
		const gitFileHistory = vi.fn().mockResolvedValue(list);
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitFileHistory }),
		);

		const result = await controller.loadFileHistory("src/file.txt");

		expect(gitFileHistory).toHaveBeenCalledWith("src/file.txt");
		expect(result).toBe(list);
		expect(controller.fileHistory).toBe(list);
		expect(controller.fileHistoryPath).toBe("src/file.txt");
	});

	it("propagates a bridge rejection rather than swallowing it", async () => {
		const gitFileHistory = vi
			.fn()
			.mockRejectedValue(new Error("GIT_NO_REPOSITORY"));
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitFileHistory }),
		);

		await expect(controller.loadFileHistory("f.txt")).rejects.toThrow(
			"GIT_NO_REPOSITORY",
		);
	});
});

describe("PlainGitHistoryController.loadLineHistory", () => {
	it("fetches and stores the line history for the given path/range", async () => {
		const list = historyList([entry({ sha: SHA_A }), entry({ sha: SHA_B })]);
		const gitLineHistoryList = vi.fn().mockResolvedValue(list);
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitLineHistoryList }),
		);

		const result = await controller.loadLineHistory("f.txt", {
			start: 2,
			end: 2,
		});

		expect(gitLineHistoryList).toHaveBeenCalledWith("f.txt", {
			start: 2,
			end: 2,
		});
		expect(result).toBe(list);
		expect(controller.lineHistory).toBe(list);
		expect(controller.lineHistoryPath).toBe("f.txt");
		expect(controller.lineHistoryRange).toEqual({ start: 2, end: 2 });
	});
});

describe("PlainGitHistoryController.openLineHistoryDetail", () => {
	it("throws before any loadLineHistory call has happened", async () => {
		const controller = new PlainGitHistoryController(fakeBridge());
		await expect(controller.openLineHistoryDetail(0)).rejects.toThrow(
			/loadLineHistory/,
		);
	});

	it("rejects an out-of-range index without calling the bridge", async () => {
		const gitLineHistoryDetail = vi.fn();
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitLineHistoryDetail }),
		);
		await controller.loadLineHistory("f.txt", { start: 1, end: 1 });

		await expect(controller.openLineHistoryDetail(5)).rejects.toThrow(
			/index out of range/,
		);
		expect(gitLineHistoryDetail).not.toHaveBeenCalled();
	});

	it("derives path/range/skip/expectedSha from the loaded list — never from caller-supplied extras", async () => {
		const list = historyList([entry({ sha: SHA_A }), entry({ sha: SHA_B })]);
		const gitLineHistoryList = vi.fn().mockResolvedValue(list);
		const detail: GitLineHistoryDetail = {
			sha: SHA_B,
			diffText: "commit " + SHA_B,
		};
		const gitLineHistoryDetail = vi.fn().mockResolvedValue(detail);
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitLineHistoryList, gitLineHistoryDetail }),
		);
		await controller.loadLineHistory("f.txt", { start: 3, end: 3 });

		const result = await controller.openLineHistoryDetail(1);

		expect(gitLineHistoryDetail).toHaveBeenCalledWith(
			"f.txt",
			{ start: 3, end: 3 },
			1,
			SHA_B,
		);
		expect(result).toBe(detail);
	});

	it("uses whichever path/range was most recently loaded, not a stale earlier one", async () => {
		const firstList = historyList([entry({ sha: SHA_A })]);
		const secondList = historyList([entry({ sha: SHA_B })]);
		const gitLineHistoryList = vi
			.fn()
			.mockResolvedValueOnce(firstList)
			.mockResolvedValueOnce(secondList);
		const gitLineHistoryDetail = vi
			.fn()
			.mockResolvedValue({ sha: SHA_B, diffText: "" });
		const controller = new PlainGitHistoryController(
			fakeBridge({ gitLineHistoryList, gitLineHistoryDetail }),
		);
		await controller.loadLineHistory("old.txt", { start: 1, end: 1 });
		await controller.loadLineHistory("new.txt", { start: 2, end: 2 });

		await controller.openLineHistoryDetail(0);

		expect(gitLineHistoryDetail).toHaveBeenCalledWith(
			"new.txt",
			{ start: 2, end: 2 },
			0,
			SHA_B,
		);
	});
});

describe("PlainGitHistoryController.clearLineHistory", () => {
	it("resets the line history state so a subsequent detail call fails cleanly", async () => {
		const controller = new PlainGitHistoryController(fakeBridge());
		await controller.loadLineHistory("f.txt", { start: 1, end: 1 });
		expect(controller.lineHistoryPath).toBe("f.txt");

		controller.clearLineHistory();

		expect(controller.lineHistoryPath).toBeUndefined();
		expect(controller.lineHistoryRange).toBeUndefined();
		expect(controller.lineHistory).toEqual({ entries: [], truncated: false });
		await expect(controller.openLineHistoryDetail(0)).rejects.toThrow(
			/loadLineHistory/,
		);
	});
});
