import { describe, expect, it } from "vitest";

import type {
	GitRefEntry,
	GitRefsListResult,
} from "../../app/platform/tauri/contracts";
import {
	buildRefBadgesBySha,
	groupRefsByKind,
	refBadgeText,
} from "../../app/features/scm/plain-git-refs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TAG_OBJECT_SHA = "c".repeat(40);

function entry(overrides: Partial<GitRefEntry> = {}): GitRefEntry {
	return {
		kind: "branch",
		fullName: "refs/heads/main",
		shortName: "main",
		targetSha: SHA_A,
		isAnnotatedTag: false,
		peeledSha: null,
		upstream: null,
		isHead: false,
		...overrides,
	};
}

function refsResult(entries: readonly GitRefEntry[]): GitRefsListResult {
	return { entries, truncated: false };
}

describe("groupRefsByKind", () => {
	it("splits entries into branches/remoteBranches/tags, each sorted by short name", () => {
		const result = refsResult([
			entry({ kind: "tag", shortName: "v2", fullName: "refs/tags/v2" }),
			entry({
				kind: "remoteBranch",
				shortName: "origin/zeta",
				fullName: "refs/remotes/origin/zeta",
			}),
			entry({ kind: "branch", shortName: "zeta", fullName: "refs/heads/zeta" }),
			entry({ kind: "tag", shortName: "v1", fullName: "refs/tags/v1" }),
			entry({
				kind: "branch",
				shortName: "alpha",
				fullName: "refs/heads/alpha",
			}),
		]);
		const grouped = groupRefsByKind(result);
		expect(grouped.branches.map((e) => e.shortName)).toEqual(["alpha", "zeta"]);
		expect(grouped.remoteBranches.map((e) => e.shortName)).toEqual([
			"origin/zeta",
		]);
		expect(grouped.tags.map((e) => e.shortName)).toEqual(["v1", "v2"]);
	});

	it("returns three empty arrays for an empty result", () => {
		const grouped = groupRefsByKind(refsResult([]));
		expect(grouped.branches).toEqual([]);
		expect(grouped.remoteBranches).toEqual([]);
		expect(grouped.tags).toEqual([]);
	});
});

describe("buildRefBadgesBySha", () => {
	it("joins a lightweight tag/branch by its own targetSha", () => {
		const result = refsResult([
			entry({ kind: "branch", shortName: "main", targetSha: SHA_A }),
			entry({
				kind: "tag",
				shortName: "v1",
				targetSha: SHA_B,
				isAnnotatedTag: false,
				peeledSha: null,
			}),
		]);
		const map = buildRefBadgesBySha(result);
		expect(map.get(SHA_A)).toEqual([
			{ label: "main", kind: "branch", isHead: false },
		]);
		expect(map.get(SHA_B)).toEqual([
			{ label: "v1", kind: "tag", isHead: false },
		]);
	});

	it("joins an annotated tag by its peeledSha, not its own targetSha (the tag object itself)", () => {
		const result = refsResult([
			entry({
				kind: "tag",
				shortName: "v2",
				targetSha: TAG_OBJECT_SHA,
				isAnnotatedTag: true,
				peeledSha: SHA_A,
			}),
		]);
		const map = buildRefBadgesBySha(result);
		expect(map.get(SHA_A)).toEqual([
			{ label: "v2", kind: "tag", isHead: false },
		]);
		expect(map.has(TAG_OBJECT_SHA)).toBe(false);
	});

	it("collects multiple refs pointing at the same commit under one key", () => {
		const result = refsResult([
			entry({ kind: "branch", shortName: "main", targetSha: SHA_A }),
			entry({
				kind: "remoteBranch",
				shortName: "origin/main",
				targetSha: SHA_A,
			}),
		]);
		const map = buildRefBadgesBySha(result);
		expect(map.get(SHA_A)?.map((badge) => badge.label)).toEqual([
			"main",
			"origin/main",
		]);
	});

	it("returns an empty map for an empty result", () => {
		const map = buildRefBadgesBySha(refsResult([]));
		expect(map.size).toBe(0);
	});
});

describe("refBadgeText", () => {
	it("prefixes a tag badge with 'tag: '", () => {
		expect(refBadgeText({ label: "v1", kind: "tag", isHead: false })).toBe(
			"tag: v1",
		);
	});

	it("prefixes the current HEAD branch with '* '", () => {
		expect(refBadgeText({ label: "main", kind: "branch", isHead: true })).toBe(
			"* main",
		);
	});

	it("renders a plain branch/remote badge with no prefix", () => {
		expect(refBadgeText({ label: "main", kind: "branch", isHead: false })).toBe(
			"main",
		);
		expect(
			refBadgeText({
				label: "origin/main",
				kind: "remoteBranch",
				isHead: false,
			}),
		).toBe("origin/main");
	});
});
