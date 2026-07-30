import { describe, expect, it, vi } from "vitest";

import type { GitStashListResult } from "../../app/platform/tauri/contracts";
import {
	PlainGitStashController,
	stashEntryLabel,
	stashEntrySummary,
	type PlainGitStashBridge,
} from "../../app/features/scm/plain-git-stash";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function listResult(
	overrides: Partial<GitStashListResult> = {},
): GitStashListResult {
	return {
		entries: [
			{
				index: 0,
				sha: SHA_A,
				committerTime: 1_700_000_100,
				message: "second\n",
			},
			{
				index: 1,
				sha: SHA_B,
				committerTime: 1_700_000_000,
				message: "first\n",
			},
		],
		truncated: false,
		...overrides,
	};
}

function fakeBridge(
	overrides: Partial<PlainGitStashBridge> = {},
): PlainGitStashBridge {
	return {
		gitStashList: vi.fn().mockResolvedValue(listResult()),
		...overrides,
	};
}

describe("PlainGitStashController", () => {
	it("starts with an empty list before any refresh", () => {
		const controller = new PlainGitStashController(fakeBridge());
		expect(controller.entries).toEqual([]);
		expect(controller.truncated).toBe(false);
	});

	it("refresh() fetches the stash list and exposes it", async () => {
		const bridge = fakeBridge();
		const controller = new PlainGitStashController(bridge);
		await controller.refresh();
		expect(bridge.gitStashList).toHaveBeenCalledTimes(1);
		expect(controller.entries).toHaveLength(2);
		expect(controller.entries[0]!.sha).toBe(SHA_A);
	});

	it("exposes truncated as reported by the bridge", async () => {
		const controller = new PlainGitStashController(
			fakeBridge({
				gitStashList: vi
					.fn()
					.mockResolvedValue(listResult({ truncated: true })),
			}),
		);
		await controller.refresh();
		expect(controller.truncated).toBe(true);
	});
});

describe("stashEntrySummary", () => {
	it("returns the message's first line only", () => {
		expect(
			stashEntrySummary({
				index: 0,
				sha: SHA_A,
				committerTime: 0,
				message: "first line\nsecond line\n",
			}),
		).toBe("first line");
	});

	it("falls back to the short sha when the message is empty", () => {
		expect(
			stashEntrySummary({
				index: 0,
				sha: SHA_A,
				committerTime: 0,
				message: "",
			}),
		).toBe(SHA_A.slice(0, 7));
	});
});

describe("stashEntryLabel", () => {
	it("combines the index and the message summary", () => {
		expect(
			stashEntryLabel({
				index: 3,
				sha: SHA_A,
				committerTime: 0,
				message: "On main: fix login bug\n",
			}),
		).toBe("#3 — On main: fix login bug");
	});
});
