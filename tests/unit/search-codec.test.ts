import { describe, expect, it } from "vitest";

import {
	decodeWorkspaceSearchFilesResult,
	frozenWorkspaceSearchFilesRequest,
	frozenWorkspaceSearchFilesResult,
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
			entries: ["src/main.ts", "README.md"],
			limitHit: true,
		});
		expect(result).toEqual({
			entries: ["src/main.ts", "README.md"],
			limitHit: true,
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.entries)).toBe(true);
	});

	it("rejects a response with extra, missing, or mistyped fields", () => {
		for (const value of [
			{ entries: [], limitHit: false, extra: true },
			{ entries: [] },
			{ limitHit: false },
			{ entries: "not-an-array", limitHit: false },
			{ entries: [123], limitHit: false },
			{ entries: [""], limitHit: false },
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
		const source = ["a.txt", "b.txt"];
		const result = frozenWorkspaceSearchFilesResult(source, false);
		expect(result).toEqual({ entries: ["a.txt", "b.txt"], limitHit: false });
		expect(result.entries).not.toBe(source);
		source[0] = "changed";
		expect(result.entries[0]).toBe("a.txt");
	});
});
