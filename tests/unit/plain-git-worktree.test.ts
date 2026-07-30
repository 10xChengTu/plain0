import { describe, expect, it, vi } from "vitest";

import type { GitWorktreeListResult } from "../../app/platform/tauri/contracts";
import {
	PlainGitWorktreeController,
	worktreeEntryLabel,
	worktreeHeadStateLabel,
	type PlainGitWorktreeBridge,
} from "../../app/features/scm/plain-git-worktree";

const SHA_A = "a".repeat(40);

function listResult(
	overrides: Partial<GitWorktreeListResult> = {},
): GitWorktreeListResult {
	return {
		entries: [
			{
				path: "/repo",
				headSha: SHA_A,
				headState: { kind: "branch", refName: "refs/heads/main" },
				lockReason: null,
				prunableReason: null,
				isMain: true,
			},
			{
				path: "/parent/linked",
				headSha: SHA_A,
				headState: { kind: "branch", refName: "refs/heads/feature-1" },
				lockReason: null,
				prunableReason: null,
				isMain: false,
			},
		],
		truncated: false,
		...overrides,
	};
}

function fakeBridge(
	overrides: Partial<PlainGitWorktreeBridge> = {},
): PlainGitWorktreeBridge {
	return {
		gitWorktreeList: vi.fn().mockResolvedValue(listResult()),
		...overrides,
	};
}

describe("PlainGitWorktreeController", () => {
	it("starts with an empty list before any refresh", () => {
		const controller = new PlainGitWorktreeController(fakeBridge());
		expect(controller.entries).toEqual([]);
		expect(controller.truncated).toBe(false);
	});

	it("refresh() fetches the worktree list and exposes it", async () => {
		const bridge = fakeBridge();
		const controller = new PlainGitWorktreeController(bridge);
		await controller.refresh();
		expect(bridge.gitWorktreeList).toHaveBeenCalledTimes(1);
		expect(controller.entries).toHaveLength(2);
		expect(controller.entries[0]!.isMain).toBe(true);
	});

	it("exposes truncated as reported by the bridge", async () => {
		const controller = new PlainGitWorktreeController(
			fakeBridge({
				gitWorktreeList: vi
					.fn()
					.mockResolvedValue(listResult({ truncated: true })),
			}),
		);
		await controller.refresh();
		expect(controller.truncated).toBe(true);
	});
});

describe("worktreeHeadStateLabel", () => {
	it("strips the refs/heads/ prefix for a branch head state", () => {
		expect(
			worktreeHeadStateLabel({
				path: "/repo",
				headSha: SHA_A,
				headState: { kind: "branch", refName: "refs/heads/main" },
				lockReason: null,
				prunableReason: null,
				isMain: true,
			}),
		).toBe("main");
	});

	it("keeps a branch ref name verbatim when it has no refs/heads/ prefix", () => {
		expect(
			worktreeHeadStateLabel({
				path: "/repo",
				headSha: SHA_A,
				headState: { kind: "branch", refName: "weird-ref" },
				lockReason: null,
				prunableReason: null,
				isMain: false,
			}),
		).toBe("weird-ref");
	});

	it("names the short sha for a detached head state", () => {
		expect(
			worktreeHeadStateLabel({
				path: "/repo",
				headSha: SHA_A,
				headState: { kind: "detached" },
				lockReason: null,
				prunableReason: null,
				isMain: false,
			}),
		).toBe(`detached at ${SHA_A.slice(0, 7)}`);
	});

	it("falls back to 'unknown' for a detached head state with no sha", () => {
		expect(
			worktreeHeadStateLabel({
				path: "/repo",
				headSha: null,
				headState: { kind: "detached" },
				lockReason: null,
				prunableReason: null,
				isMain: false,
			}),
		).toBe("detached at unknown");
	});

	it("names bare for a bare head state", () => {
		expect(
			worktreeHeadStateLabel({
				path: "/repo.git",
				headSha: null,
				headState: { kind: "bare" },
				lockReason: null,
				prunableReason: null,
				isMain: true,
			}),
		).toBe("bare");
	});
});

describe("worktreeEntryLabel", () => {
	it("marks the main worktree distinctly from a linked one", () => {
		const main = worktreeEntryLabel({
			path: "/repo",
			headSha: SHA_A,
			headState: { kind: "branch", refName: "refs/heads/main" },
			lockReason: null,
			prunableReason: null,
			isMain: true,
		});
		const linked = worktreeEntryLabel({
			path: "/parent/linked",
			headSha: SHA_A,
			headState: { kind: "branch", refName: "refs/heads/feature-1" },
			lockReason: null,
			prunableReason: null,
			isMain: false,
		});
		expect(main).toBe("main — main (/repo)");
		expect(linked).toBe("feature-1 (/parent/linked)");
		expect(linked).not.toContain("main — ");
	});
});
