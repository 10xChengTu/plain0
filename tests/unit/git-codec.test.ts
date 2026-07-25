import { describe, expect, it } from "vitest";

import {
	decodeGitDiffFilesResult,
	decodeGitShowBlobResult,
	decodeGitStatusResult,
	decodeGitVoid,
	frozenGitCommitRequest,
	frozenGitDiffFilesRequest,
	frozenGitDiscardPathsRequest,
	frozenGitShowBlobRequest,
	frozenGitShowBlobResult,
	frozenGitStageBlobRequest,
	frozenGitStagePathsRequest,
	frozenGitUnstagePathsRequest,
} from "../../app/platform/tauri/git-codec";

const contractError = { code: "IPC_CONTRACT_VIOLATION" };

function sampleOrdinary() {
	return {
		type: "ordinary",
		indexStatus: ".",
		worktreeStatus: "M",
		submodule: {
			isSubmodule: false,
			commitChanged: false,
			trackedChanged: false,
			untrackedChanged: false,
		},
		modeHead: "100644",
		modeIndex: "100644",
		modeWorktree: "100644",
		hashHead: "a".repeat(40),
		hashIndex: "a".repeat(40),
		path: "a.txt",
	};
}

function sampleStatusResult(entries: unknown[] = [sampleOrdinary()]) {
	return {
		branch: { oid: "(initial)", head: "(detached)", upstream: null },
		entries,
	};
}

describe("git status codec", () => {
	it("decodes a clean status result with camelCase branch fields", () => {
		const result = decodeGitStatusResult(sampleStatusResult([]));
		expect(result).toEqual({
			branch: { oid: "(initial)", head: "(detached)", upstream: null },
			entries: [],
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.entries)).toBe(true);
	});

	it("decodes a branch with an upstream", () => {
		const result = decodeGitStatusResult({
			branch: {
				oid: "f".repeat(40),
				head: "feature",
				upstream: { name: "main", ahead: 3, behind: 1 },
			},
			entries: [],
		});
		expect(result.branch.upstream).toEqual({
			name: "main",
			ahead: 3,
			behind: 1,
		});
	});

	it("decodes each of the five status entry variants", () => {
		const entries = [
			sampleOrdinary(),
			{
				type: "renameOrCopy",
				indexStatus: "R",
				worktreeStatus: ".",
				submodule: sampleOrdinary().submodule,
				modeHead: "100644",
				modeIndex: "100644",
				modeWorktree: "100644",
				hashHead: "a".repeat(40),
				hashIndex: "b".repeat(40),
				renameOrCopyKind: "copy",
				similarity: 90,
				path: "new.txt",
				origPath: "old.txt",
			},
			{
				type: "unmerged",
				indexStatus: "U",
				worktreeStatus: "U",
				submodule: sampleOrdinary().submodule,
				modeStage1: "100644",
				modeStage2: "100644",
				modeStage3: "100644",
				modeWorktree: "100644",
				hashStage1: "a".repeat(40),
				hashStage2: "b".repeat(40),
				hashStage3: "c".repeat(40),
				path: "conflict.txt",
			},
			{ type: "untracked", path: "new-untracked.txt" },
			{ type: "ignored", path: "skip.ign" },
		];
		const result = decodeGitStatusResult(sampleStatusResult(entries));
		expect(result.entries).toHaveLength(5);
		expect(result.entries[0]).toMatchObject({
			type: "ordinary",
			path: "a.txt",
		});
		expect(result.entries[1]).toMatchObject({
			type: "renameOrCopy",
			renameOrCopyKind: "copy",
			similarity: 90,
			origPath: "old.txt",
		});
		expect(result.entries[2]).toMatchObject({
			type: "unmerged",
			path: "conflict.txt",
		});
		expect(result.entries[3]).toEqual({
			type: "untracked",
			path: "new-untracked.txt",
		});
		expect(result.entries[4]).toEqual({ type: "ignored", path: "skip.ign" });
	});

	it("rejects an unknown entry type discriminant", () => {
		expect(() =>
			decodeGitStatusResult(sampleStatusResult([{ type: "bogus", path: "x" }])),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a status result with extra or missing top-level keys", () => {
		for (const value of [
			{ ...sampleStatusResult([]), extra: 1 },
			{ branch: sampleStatusResult([]).branch },
			{ entries: [] },
			null,
			[],
			"not-an-object",
		]) {
			expect(() => decodeGitStatusResult(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("rejects an entry missing a required field or with an extra field", () => {
		const { path: _path, ...withoutPath } = sampleOrdinary();
		expect(() =>
			decodeGitStatusResult(sampleStatusResult([withoutPath])),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeGitStatusResult(
				sampleStatusResult([{ ...sampleOrdinary(), extra: "x" }]),
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a similarity outside 0..100 or a non-integer", () => {
		const rename = {
			type: "renameOrCopy",
			indexStatus: "R",
			worktreeStatus: ".",
			submodule: sampleOrdinary().submodule,
			modeHead: "100644",
			modeIndex: "100644",
			modeWorktree: "100644",
			hashHead: "a".repeat(40),
			hashIndex: "b".repeat(40),
			renameOrCopyKind: "rename",
			path: "new.txt",
			origPath: "old.txt",
		};
		for (const similarity of [-1, 101, 1.5, "90"]) {
			expect(() =>
				decodeGitStatusResult(sampleStatusResult([{ ...rename, similarity }])),
			).toThrowError(expect.objectContaining(contractError));
		}
	});

	it("rejects a Proxy-wrapped result, entries array, or entry object", () => {
		expect(() =>
			decodeGitStatusResult(new Proxy(sampleStatusResult([]), {})),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeGitStatusResult({
				branch: sampleStatusResult([]).branch,
				entries: new Proxy([], {}),
			}),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeGitStatusResult(
				sampleStatusResult([new Proxy(sampleOrdinary(), {})]),
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a getter-based (non-own-data) entry array", () => {
		const entries: unknown[] = [];
		Object.defineProperty(entries, "0", {
			enumerable: true,
			configurable: true,
			get: () => sampleOrdinary(),
		});
		Object.defineProperty(entries, "length", { value: 1 });
		expect(() =>
			decodeGitStatusResult({ branch: sampleStatusResult([]).branch, entries }),
		).toThrowError(expect.objectContaining(contractError));
	});
});

describe("git diff files codec", () => {
	it("builds a frozen request from a boolean and rejects a non-boolean", () => {
		expect(frozenGitDiffFilesRequest(true)).toEqual({ cached: true });
		expect(Object.isFrozen(frozenGitDiffFilesRequest(false))).toBe(true);
		expect(() => frozenGitDiffFilesRequest("true")).toThrowError(
			expect.objectContaining({ code: "GIT_DIFF_FILES_INVALID_REQUEST" }),
		);
	});

	it("decodes diff file entries including null similarity/counts for a binary file", () => {
		const result = decodeGitDiffFilesResult({
			entries: [
				{
					kind: "modified",
					similarity: null,
					path: "a.txt",
					origPath: null,
					added: 3,
					deleted: 1,
					binary: false,
				},
				{
					kind: "renamed",
					similarity: 100,
					path: "b-renamed.dat",
					origPath: "b.dat",
					added: null,
					deleted: null,
					binary: true,
				},
			],
		});
		expect(result.entries).toHaveLength(2);
		expect(result.entries[0]).toMatchObject({
			kind: "modified",
			added: 3,
			deleted: 1,
		});
		expect(result.entries[1]).toMatchObject({
			kind: "renamed",
			similarity: 100,
			origPath: "b.dat",
			binary: true,
			added: null,
			deleted: null,
		});
	});

	it("rejects an unknown diff status kind", () => {
		expect(() =>
			decodeGitDiffFilesResult({
				entries: [
					{
						kind: "bogus",
						similarity: null,
						path: "a.txt",
						origPath: null,
						added: null,
						deleted: null,
						binary: false,
					},
				],
			}),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a result with an extra top-level key or a Proxy-wrapped entries array", () => {
		expect(() =>
			decodeGitDiffFilesResult({ entries: [], extra: 1 }),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeGitDiffFilesResult({ entries: new Proxy([], {}) }),
		).toThrowError(expect.objectContaining(contractError));
	});
});

describe("git show blob codec", () => {
	it("builds a frozen request for a valid rev/path and rejects an invalid rev or path", () => {
		expect(frozenGitShowBlobRequest("head", "a.txt")).toEqual({
			rev: "head",
			path: "a.txt",
		});
		expect(frozenGitShowBlobRequest("index", "a.txt")).toEqual({
			rev: "index",
			path: "a.txt",
		});
		for (const [rev, path] of [
			["bogus", "a.txt"],
			["head", ""],
			["head", "a".repeat(4_097)],
		] as const) {
			expect(() => frozenGitShowBlobRequest(rev, path)).toThrowError(
				expect.objectContaining({ code: "GIT_SHOW_BLOB_INVALID_REQUEST" }),
			);
		}
	});

	it("decodes content as a byte array or null", () => {
		const found = decodeGitShowBlobResult({ content: [104, 105] });
		expect(found.content).toBeInstanceOf(Uint8Array);
		expect([...(found.content ?? [])]).toEqual([104, 105]);

		const notFound = decodeGitShowBlobResult({ content: null });
		expect(notFound.content).toBeNull();
	});

	it("rejects an out-of-range byte value or a Proxy-wrapped content array", () => {
		expect(() => decodeGitShowBlobResult({ content: [256] })).toThrowError(
			expect.objectContaining(contractError),
		);
		expect(() => decodeGitShowBlobResult({ content: [-1] })).toThrowError(
			expect.objectContaining(contractError),
		);
		expect(() =>
			decodeGitShowBlobResult({ content: new Proxy([1, 2], {}) }),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("frozenGitShowBlobResult round-trips a Uint8Array or null through the same decoder", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const found = frozenGitShowBlobResult(bytes);
		expect([...(found.content ?? [])]).toEqual([1, 2, 3]);
		expect(found.content).not.toBe(bytes);

		const notFound = frozenGitShowBlobResult(null);
		expect(notFound.content).toBeNull();
	});
});

// --- F080 S3 write command codecs -------------------------------------

const mutatePathsInvalid = { code: "GIT_MUTATE_PATHS_INVALID_REQUEST" };

describe.each([
	["frozenGitStagePathsRequest", frozenGitStagePathsRequest],
	["frozenGitUnstagePathsRequest", frozenGitUnstagePathsRequest],
	["frozenGitDiscardPathsRequest", frozenGitDiscardPathsRequest],
] as const)("%s", (_name, build) => {
	it("accepts a non-empty array of valid paths and freezes the result", () => {
		const result = build(["a.txt", "b/c.txt"]);
		expect(result).toEqual({ paths: ["a.txt", "b/c.txt"] });
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.paths)).toBe(true);
	});

	it("rejects an empty array", () => {
		expect(() => build([])).toThrowError(
			expect.objectContaining(mutatePathsInvalid),
		);
	});

	it("rejects a non-array, a Proxy-wrapped array, or a getter-based array", () => {
		expect(() => build("a.txt")).toThrowError(
			expect.objectContaining(mutatePathsInvalid),
		);
		expect(() => build(new Proxy(["a.txt"], {}))).toThrowError(
			expect.objectContaining(mutatePathsInvalid),
		);
		const getterArray: unknown[] = [];
		Object.defineProperty(getterArray, "0", {
			enumerable: true,
			get: () => "a.txt",
		});
		Object.defineProperty(getterArray, "length", { value: 1 });
		expect(() => build(getterArray)).toThrowError(
			expect.objectContaining(mutatePathsInvalid),
		);
	});

	it("rejects an array containing a non-string, empty string, or oversized path", () => {
		for (const hostile of [["a.txt", 1], [""], ["a".repeat(4_097)]]) {
			expect(() => build(hostile)).toThrowError(
				expect.objectContaining(mutatePathsInvalid),
			);
		}
	});
});

describe("frozenGitStageBlobRequest", () => {
	it("accepts a valid path and Uint8Array content, converted to a plain number array", () => {
		const result = frozenGitStageBlobRequest(
			"a.txt",
			new Uint8Array([1, 2, 3]),
		);
		expect(result).toEqual({ path: "a.txt", content: [1, 2, 3] });
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.content)).toBe(true);
	});

	it("rejects an empty or oversized path", () => {
		const invalidRequest = { code: "GIT_STAGE_BLOB_INVALID_REQUEST" };
		expect(() => frozenGitStageBlobRequest("", new Uint8Array())).toThrowError(
			expect.objectContaining(invalidRequest),
		);
		expect(() =>
			frozenGitStageBlobRequest("a".repeat(4_097), new Uint8Array()),
		).toThrowError(expect.objectContaining(invalidRequest));
	});

	it("rejects content that is not a Uint8Array, or exceeds 8 MiB", () => {
		const invalidRequest = { code: "GIT_STAGE_BLOB_INVALID_REQUEST" };
		expect(() => frozenGitStageBlobRequest("a.txt", [1, 2, 3])).toThrowError(
			expect.objectContaining(invalidRequest),
		);
		expect(() =>
			frozenGitStageBlobRequest("a.txt", new Uint8Array(8 * 1024 * 1024 + 1)),
		).toThrowError(expect.objectContaining(invalidRequest));
	});
});

describe("frozenGitCommitRequest", () => {
	it("accepts a non-empty message and boolean amend", () => {
		expect(frozenGitCommitRequest("feat: x", true)).toEqual({
			message: "feat: x",
			amend: true,
		});
		expect(frozenGitCommitRequest("feat: x", false)).toEqual({
			message: "feat: x",
			amend: false,
		});
	});

	it("rejects an empty, whitespace-only, or oversized message", () => {
		const invalidRequest = { code: "GIT_COMMIT_INVALID_REQUEST" };
		for (const message of ["", "   ", "\n\t", "a".repeat(100_001)]) {
			expect(() => frozenGitCommitRequest(message, false)).toThrowError(
				expect.objectContaining(invalidRequest),
			);
		}
	});

	it("rejects a non-boolean amend", () => {
		expect(() =>
			frozenGitCommitRequest("feat: x", "true" as unknown as boolean),
		).toThrowError(
			expect.objectContaining({ code: "GIT_COMMIT_INVALID_REQUEST" }),
		);
	});
});

describe("decodeGitVoid", () => {
	it("accepts a literal null", () => {
		expect(decodeGitVoid(null)).toBeUndefined();
	});

	it("rejects any non-null value", () => {
		for (const value of [undefined, {}, "ok", 0, false]) {
			expect(() => decodeGitVoid(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});
