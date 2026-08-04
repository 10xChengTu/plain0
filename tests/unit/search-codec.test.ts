import { describe, expect, it } from "vitest";

import {
	decodeWorkspaceSearchExpandReplacementsResult,
	decodeWorkspaceSearchFilesResult,
	decodeWorkspaceSearchTextPollResult,
	decodeWorkspaceSearchTextStartResult,
	decodeWorkspaceSearchTextWakeEvent,
	frozenWorkspaceSearchExpandReplacementsRequest,
	frozenWorkspaceSearchExpandReplacementsResult,
	frozenWorkspaceSearchFilesRequest,
	frozenWorkspaceSearchFilesResult,
	frozenWorkspaceSearchTextCancelRequest,
	frozenWorkspaceSearchTextPollRequest,
	frozenWorkspaceSearchTextPollResult,
	frozenWorkspaceSearchTextStartRequest,
} from "../../app/platform/tauri/search-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000102";
const contractError = { code: "IPC_CONTRACT_VIOLATION" };

describe("search codec", () => {
	it("builds a frozen own-data request from valid inputs", () => {
		const request = frozenWorkspaceSearchFilesRequest(
			[rootId, secondRootId],
			"main",
			["**/node_modules"],
			512,
		);
		expect(request).toEqual({
			roots: [rootId, secondRootId],
			filePattern: "main",
			excludeGlobs: ["**/node_modules"],
			maxResults: 512,
		});
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("rejects an empty or non-UUID roots array", () => {
		for (const roots of [[], ["not-a-uuid"], [rootId, "bad"], "not-an-array"]) {
			expect(() =>
				frozenWorkspaceSearchFilesRequest(roots, "", [], 512),
			).toThrowError();
		}
		expect(() =>
			frozenWorkspaceSearchFilesRequest([], "", [], 512),
		).toThrowError(expect.objectContaining({ code: "ROOT_NOT_AUTHORIZED" }));
	});

	it("rejects an oversized file pattern", () => {
		expect(() =>
			frozenWorkspaceSearchFilesRequest([rootId], "a".repeat(4_097), [], 512),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
		expect(() =>
			frozenWorkspaceSearchFilesRequest([rootId], "a".repeat(4_096), [], 512),
		).not.toThrowError();
	});

	it("rejects too many or oversized exclude globs as a shape violation, and an empty pattern as an invalid request", () => {
		// Count/length overflow is caught by the shared own-data array
		// snapshot (a structural/hostile-input concern), not the
		// search-specific request validator.
		expect(() =>
			frozenWorkspaceSearchFilesRequest(
				[rootId],
				"",
				Array.from({ length: 65 }, () => "**/a"),
				512,
			),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			frozenWorkspaceSearchFilesRequest([rootId], "", ["*".repeat(1_025)], 512),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			frozenWorkspaceSearchFilesRequest([rootId], "", [""], 512),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
	});

	it("clamps maxResults to the 1..2048 range client-side too, and rejects a non-integer or non-number", () => {
		expect(
			frozenWorkspaceSearchFilesRequest([rootId], "", [], 0).maxResults,
		).toBe(1);
		expect(
			frozenWorkspaceSearchFilesRequest([rootId], "", [], 4_000_000).maxResults,
		).toBe(2_048);
		expect(
			frozenWorkspaceSearchFilesRequest([rootId], "", [], 2_048).maxResults,
		).toBe(2_048);
		for (const maxResults of [1.5, "512", Number.NaN, -1, -0.5]) {
			expect(() =>
				frozenWorkspaceSearchFilesRequest([rootId], "", [], maxResults),
			).toThrowError(
				expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }),
			);
		}
	});

	it("rejects Proxy-wrapped roots and excludeGlobs arrays", () => {
		const proxiedRoots = new Proxy([rootId], {});
		expect(() =>
			frozenWorkspaceSearchFilesRequest(proxiedRoots, "", [], 512),
		).toThrowError(expect.objectContaining(contractError));
		const proxiedGlobs = new Proxy(["**/a"], {});
		expect(() =>
			frozenWorkspaceSearchFilesRequest([rootId], "", proxiedGlobs, 512),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("decodes a well-formed result and freezes it", () => {
		const result = decodeWorkspaceSearchFilesResult({
			entries: [
				{ rootId, path: "src/main.ts" },
				{ rootId: secondRootId, path: "README.md" },
			],
			limitHit: true,
		});
		expect(result).toEqual({
			entries: [
				{ rootId, path: "src/main.ts" },
				{ rootId: secondRootId, path: "README.md" },
			],
			limitHit: true,
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.entries)).toBe(true);
		expect(Object.isFrozen(result.entries[0])).toBe(true);
	});

	it("rejects a response with extra, missing, or mistyped fields", () => {
		for (const value of [
			{ entries: [], limitHit: false, extra: true },
			{ entries: [] },
			{ limitHit: false },
			{ entries: "not-an-array", limitHit: false },
			{ entries: [123], limitHit: false },
			{ entries: [{ rootId, path: "" }], limitHit: false },
			{ entries: [{ rootId: "bad", path: "a.txt" }], limitHit: false },
			{ entries: [{ rootId }], limitHit: false },
			{ entries: [{ rootId, path: "a.txt", extra: true }], limitHit: false },
			{ entries: [], limitHit: "false" },
			null,
			[],
			"not-an-object",
		]) {
			expect(() => decodeWorkspaceSearchFilesResult(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("rejects a Proxy-wrapped response or entries array", () => {
		expect(() =>
			decodeWorkspaceSearchFilesResult(
				new Proxy({ entries: [], limitHit: false }, {}),
			),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeWorkspaceSearchFilesResult({
				entries: new Proxy([], {}),
				limitHit: false,
			}),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("frozenWorkspaceSearchFilesResult round-trips a plain owned array through the same decoder", () => {
		const source = [
			{ rootId, path: "a.txt" },
			{ rootId: secondRootId, path: "b.txt" },
		];
		const result = frozenWorkspaceSearchFilesResult(source, false);
		expect(result).toEqual({
			entries: [
				{ rootId, path: "a.txt" },
				{ rootId: secondRootId, path: "b.txt" },
			],
			limitHit: false,
		});
		expect(result.entries).not.toBe(source);
		source[0]!.path = "changed";
		expect(result.entries[0]).toEqual({ rootId, path: "a.txt" });
	});
});

describe("streaming text search codec (F040 S3)", () => {
	it("builds a frozen own-data start request from valid inputs, defaulting maxFileSize", () => {
		const request = frozenWorkspaceSearchTextStartRequest(
			[rootId],
			"needle",
			false,
			false,
			false,
			["**/node_modules"],
			512,
			null,
		);
		expect(request).toEqual({
			roots: [rootId],
			pattern: "needle",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
			excludeGlobs: ["**/node_modules"],
			maxResults: 512,
			maxFileSize: null,
		});
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("rejects an empty pattern and clamps maxResults/maxFileSize", () => {
		expect(() =>
			frozenWorkspaceSearchTextStartRequest(
				[rootId],
				"",
				false,
				false,
				false,
				[],
				512,
				null,
			),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));

		expect(
			frozenWorkspaceSearchTextStartRequest(
				[rootId],
				"needle",
				false,
				false,
				false,
				[],
				4_000_000_000,
				null,
			).maxResults,
		).toBe(20_000);
		expect(
			frozenWorkspaceSearchTextStartRequest(
				[rootId],
				"needle",
				false,
				false,
				false,
				[],
				0,
				null,
			).maxResults,
		).toBe(1);
		expect(
			frozenWorkspaceSearchTextStartRequest(
				[rootId],
				"needle",
				false,
				false,
				false,
				[],
				512,
				0,
			).maxFileSize,
		).toBe(1);
		expect(
			frozenWorkspaceSearchTextStartRequest(
				[rootId],
				"needle",
				false,
				false,
				false,
				[],
				512,
				Number.MAX_SAFE_INTEGER,
			).maxFileSize,
		).toBe(64 * 1_024 * 1_024);
	});

	it("rejects non-strict-boolean flags", () => {
		for (const flags of [
			[1, false, false],
			[false, "true", false],
			[false, false, undefined],
		]) {
			expect(() =>
				frozenWorkspaceSearchTextStartRequest(
					[rootId],
					"needle",
					flags[0],
					flags[1],
					flags[2],
					[],
					512,
					null,
				),
			).toThrowError(
				expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }),
			);
		}
	});

	it("decodes a well-formed start result and rejects a non-UUID or extra field", () => {
		const decoded = decodeWorkspaceSearchTextStartResult({ searchId: rootId });
		expect(decoded).toEqual({ searchId: rootId });
		expect(Object.isFrozen(decoded)).toBe(true);
		for (const value of [
			{ searchId: "not-a-uuid" },
			{ searchId: rootId, extra: 1 },
			{},
			null,
		]) {
			expect(() => decodeWorkspaceSearchTextStartResult(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("builds and validates poll/cancel requests", () => {
		const poll = frozenWorkspaceSearchTextPollRequest(rootId, 3);
		expect(poll).toEqual({ searchId: rootId, cursor: 3 });
		expect(Object.isFrozen(poll)).toBe(true);
		expect(() => frozenWorkspaceSearchTextPollRequest(rootId, -1)).toThrowError(
			expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }),
		);
		expect(() =>
			frozenWorkspaceSearchTextPollRequest("not-a-uuid", 0),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));

		const cancel = frozenWorkspaceSearchTextCancelRequest(rootId);
		expect(cancel).toEqual({ searchId: rootId });
		expect(() => frozenWorkspaceSearchTextCancelRequest("bad")).toThrowError(
			expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }),
		);
	});

	it("decodes a well-formed poll result with nested batches/matches and freezes every level", () => {
		const decoded = decodeWorkspaceSearchTextPollResult({
			batches: [
				{
					rootId,
					path: "src/main.ts",
					matches: [
						{
							line: 1,
							column: 5,
							length: 6,
							previewText: "needle here",
							absoluteColumn: 5,
						},
					],
				},
			],
			nextCursor: 1,
			done: true,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		expect(decoded.batches[0]?.path).toBe("src/main.ts");
		expect(decoded.batches[0]?.matches[0]).toEqual({
			line: 1,
			column: 5,
			length: 6,
			previewText: "needle here",
			absoluteColumn: 5,
		});
		expect(Object.isFrozen(decoded)).toBe(true);
		expect(Object.isFrozen(decoded.batches)).toBe(true);
		expect(Object.isFrozen(decoded.batches[0])).toBe(true);
		expect(Object.isFrozen(decoded.batches[0]?.matches)).toBe(true);
	});

	it("rejects a poll result with extra/missing/mistyped fields, oversized previewText, or Proxy nesting", () => {
		const base = () => ({
			batches: [],
			nextCursor: 0,
			done: false,
			limitHit: false,
			skipped: { binary: 0, oversize: 0 },
		});
		for (const value of [
			{ ...base(), extra: 1 },
			{ ...base(), nextCursor: -1 },
			{ ...base(), done: "false" },
			{
				...base(),
				batches: [{ rootId, path: "", matches: [] }],
			},
			{
				...base(),
				batches: [{ rootId: "bad", path: "a.ts", matches: [] }],
			},
			{
				...base(),
				batches: [
					{
						rootId,
						path: "a.ts",
						matches: [
							{
								line: 1,
								column: 1,
								length: 1,
								previewText: "x".repeat(257),
								absoluteColumn: 1,
							},
						],
					},
				],
			},
			{
				...base(),
				batches: [
					{
						rootId,
						path: "a.ts",
						matches: [{ line: 1, column: 1, length: 1, previewText: "a" }],
					},
				],
			},
			{
				...base(),
				batches: [
					{
						rootId,
						path: "a.ts",
						matches: [
							{
								line: 1,
								column: 1,
								length: 1,
								previewText: "a",
								absoluteColumn: -1,
							},
						],
					},
				],
			},
			{ ...base(), skipped: { binary: -1, oversize: 0 } },
			{ ...base(), batches: new Proxy([], {}) },
		]) {
			expect(() => decodeWorkspaceSearchTextPollResult(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("frozenWorkspaceSearchTextPollResult round-trips owned batch/match objects through the same decoder", () => {
		const result = frozenWorkspaceSearchTextPollResult(
			[
				{
					rootId,
					path: "a.ts",
					matches: [
						{
							line: 1,
							column: 1,
							length: 1,
							previewText: "a",
							absoluteColumn: 1,
						},
					],
				},
			],
			1,
			true,
			false,
			{ binary: 1, oversize: 2 },
		);
		expect(result.batches[0]?.path).toBe("a.ts");
		expect(result.skipped).toEqual({ binary: 1, oversize: 2 });
	});

	it("decodes a well-formed wake event and rejects a non-UUID or extra field", () => {
		const decoded = decodeWorkspaceSearchTextWakeEvent({ searchId: rootId });
		expect(decoded).toEqual({ searchId: rootId });
		for (const value of [
			{ searchId: "bad" },
			{ searchId: rootId, extra: true },
		]) {
			expect(() => decodeWorkspaceSearchTextWakeEvent(value)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});
});

// --- Capture-group replacement expansion (F200 S2) --------------------------

describe("workspace_search_expand_replacements codec", () => {
	it("builds a frozen own-data request with isRegExp hard-coded true", () => {
		const request = frozenWorkspaceSearchExpandReplacementsRequest(
			String.raw`(\w+)-(\d+)`,
			false,
			false,
			"$2-$1",
			["item-42"],
		);
		expect(request).toEqual({
			pattern: String.raw`(\w+)-(\d+)`,
			isRegExp: true,
			isCaseSensitive: false,
			isWordMatch: false,
			replacementTemplate: "$2-$1",
			expectedTexts: ["item-42"],
		});
		expect(Object.isFrozen(request)).toBe(true);
	});

	it("rejects an empty pattern or an oversized pattern/template", () => {
		expect(() =>
			frozenWorkspaceSearchExpandReplacementsRequest("", false, false, "$1", [
				"x",
			]),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
		expect(() =>
			frozenWorkspaceSearchExpandReplacementsRequest(
				"a".repeat(4_097),
				false,
				false,
				"$1",
				["x"],
			),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
		expect(() =>
			frozenWorkspaceSearchExpandReplacementsRequest(
				"a",
				false,
				false,
				"$".repeat(4_097),
				["x"],
			),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
	});

	it("rejects an empty or oversized expectedTexts list as a shape violation", () => {
		expect(() =>
			frozenWorkspaceSearchExpandReplacementsRequest(
				"a",
				false,
				false,
				"$0",
				[],
			),
		).toThrowError(expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }));
		expect(() =>
			frozenWorkspaceSearchExpandReplacementsRequest(
				"a",
				false,
				false,
				"$0",
				Array.from({ length: 20_001 }, () => "x"),
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects a non-boolean isCaseSensitive/isWordMatch as a shape violation", () => {
		for (const value of [
			frozenWorkspaceSearchExpandReplacementsRequest.bind(
				null,
				"a",
				"true",
				false,
				"$0",
				["x"],
			),
			frozenWorkspaceSearchExpandReplacementsRequest.bind(
				null,
				"a",
				false,
				"true",
				"$0",
				["x"],
			),
		]) {
			expect(value).toThrowError(
				expect.objectContaining({ code: "INVALID_SEARCH_REQUEST" }),
			);
		}
	});

	it("decodes a well-formed ok/error item mix and rejects malformed shapes", () => {
		const decoded = decodeWorkspaceSearchExpandReplacementsResult({
			items: [
				{ status: "ok", replacement: "42-item" },
				{
					status: "error",
					code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
					message: "no match",
				},
			],
		});
		expect(decoded).toEqual({
			items: [
				{ status: "ok", replacement: "42-item" },
				{
					status: "error",
					code: "SEARCH_REPLACE_EXPAND_NO_MATCH",
					message: "no match",
				},
			],
		});
		expect(Object.isFrozen(decoded)).toBe(true);

		for (const malformed of [
			{ items: [{ status: "ok" }] },
			{ items: [{ status: "ok", replacement: "x", extra: 1 }] },
			{ items: [{ status: "error", code: "X" }] },
			{ items: [{ status: "error", code: "", message: "x" }] },
			{ items: [{ status: "unknown" }] },
			{ items: [{ status: "ok", replacement: "x" }], extra: 1 },
		]) {
			expect(() =>
				decodeWorkspaceSearchExpandReplacementsResult(malformed),
			).toThrowError(expect.objectContaining(contractError));
		}
	});

	it("frozenWorkspaceSearchExpandReplacementsResult round-trips ok/error items through the same decoder", () => {
		const result = frozenWorkspaceSearchExpandReplacementsResult([
			{ status: "ok", replacement: "42-item" },
			{
				status: "error",
				code: "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
				message: "no such group",
			},
		]);
		expect(result.items).toEqual([
			{ status: "ok", replacement: "42-item" },
			{
				status: "error",
				code: "SEARCH_REPLACE_EXPAND_INVALID_GROUP",
				message: "no such group",
			},
		]);
		expect(Object.isFrozen(result)).toBe(true);
	});
});
