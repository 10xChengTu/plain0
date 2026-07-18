import { describe, expect, it } from "vitest";

import {
	compareWorkspaceEntryNames,
	decodeWorkspaceEntryStat,
	decodeWorkspaceFileData,
	decodeWorkspaceReadDirectory,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceFileData,
	isPortableWorkspaceEntryName,
} from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const contractError = {
	code: "IPC_CONTRACT_VIOLATION",
	message: "Native IPC returned a payload that violates the Plain contract.",
};

describe("workspace file data codec", () => {
	it("decodes exact immutable stat payloads and rejects unsafe fields", () => {
		const stat = decodeWorkspaceEntryStat({
			kind: "file",
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 0,
		});
		expect(stat).toEqual({
			kind: "file",
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 0,
		});
		expect(Object.isFrozen(stat)).toBe(true);
		expect(
			decodeWorkspaceEntryStat({
				kind: "file",
				size: Number.MAX_SAFE_INTEGER,
				mtime: 0,
				ctime: 0,
			}).size,
		).toBe(Number.MAX_SAFE_INTEGER);

		for (const payload of [
			{ kind: "unknown", size: 0, mtime: 0, ctime: 0 },
			{ kind: "file", size: -1, mtime: 0, ctime: 0 },
			{ kind: "file", size: 1.5, mtime: 0, ctime: 0 },
			{ kind: "file", size: 0, mtime: Number.MAX_VALUE, ctime: 0 },
			{ kind: "file", size: 0, mtime: 0, ctime: 0, path: "/private" },
		]) {
			expect(() => decodeWorkspaceEntryStat(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("decodes only sorted unique addressable directory entries", () => {
		const result = decodeWorkspaceReadDirectory(
			{
				entries: [
					{ name: ".plainrc", kind: "file" },
					{ name: "src", kind: "directory" },
					{ name: "é.txt", kind: "file" },
				],
			},
			"",
		);
		expect(result.entries.map(({ name }) => name)).toEqual([
			".plainrc",
			"src",
			"é.txt",
		]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.entries)).toBe(true);
		expect(result.entries.every(Object.isFrozen)).toBe(true);

		for (const entries of [
			[
				{ name: "b", kind: "file" },
				{ name: "a", kind: "file" },
			],
			[
				{ name: "same", kind: "file" },
				{ name: "same", kind: "file" },
			],
			[{ name: "src", kind: "invalid" }],
			[{ name: "src", kind: "directory", nativePath: "/private" }],
		]) {
			expect(() => decodeWorkspaceReadDirectory({ entries }, "")).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("uses Rust UTF-8 byte ordering instead of JavaScript UTF-16 ordering", () => {
		const bmp = "\ue000";
		const supplementary = "\u{10000}";
		expect([bmp, supplementary].sort()).toEqual([supplementary, bmp]);
		expect(compareWorkspaceEntryNames(bmp, supplementary)).toBeLessThan(0);
		expect(
			decodeWorkspaceReadDirectory(
				{
					entries: [
						{ name: bmp, kind: "file" },
						{ name: supplementary, kind: "file" },
					],
				},
				"",
			).entries.map(({ name }) => name),
		).toEqual([bmp, supplementary]);
		expect(() =>
			decodeWorkspaceReadDirectory(
				{
					entries: [
						{ name: supplementary, kind: "file" },
						{ name: bmp, kind: "file" },
					],
				},
				"",
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("mirrors portable name, payload and complete child path limits", () => {
		for (const invalidName of [
			"",
			".",
			"..",
			"a/b",
			"a\\b",
			"a:b",
			"a\u0000b",
			"a\u007fb",
			"a?b",
			"trailing.",
			"trailing ",
			"CON",
			"com1.txt",
			"\ud800",
			"x".repeat(1_025),
			"😀".repeat(257),
		]) {
			expect(
				isPortableWorkspaceEntryName(invalidName),
				JSON.stringify(invalidName),
			).toBe(false);
			expect(() =>
				decodeWorkspaceReadDirectory(
					{ entries: [{ name: invalidName, kind: "file" }] },
					"",
				),
			).toThrowError(expect.objectContaining(contractError));
		}
		expect(() =>
			decodeWorkspaceReadDirectory({ entries: [], path: "/private" }, ""),
		).toThrowError(expect.objectContaining(contractError));
		expect(isPortableWorkspaceEntryName("conın$")).toBe(true);
		expect(isPortableWorkspaceEntryName("%2e%2e")).toBe(true);
		expect(isPortableWorkspaceEntryName("%2F")).toBe(true);
		expect(
			decodeWorkspaceReadDirectory(
				{
					entries: [
						{ name: "%2F", kind: "file" },
						{ name: "%2e%2e", kind: "directory" },
					],
				},
				"%2e%2e",
			).entries.map(({ name }) => name),
		).toEqual(["%2F", "%2e%2e"]);
		expect(frozenWorkspaceEntryRequest(rootId, "%2e%2e/%2F")).toEqual({
			rootId,
			relativePath: "%2e%2e/%2F",
		});

		const maximumParentSegments = Array.from({ length: 256 }, () => "a").join(
			"/",
		);
		const addressableParentSegments = Array.from(
			{ length: 255 },
			() => "a",
		).join("/");
		expect(
			decodeWorkspaceReadDirectory(
				{ entries: [{ name: "child", kind: "file" }] },
				addressableParentSegments,
			).entries,
		).toEqual([{ name: "child", kind: "file" }]);
		expect(() =>
			decodeWorkspaceReadDirectory(
				{ entries: [{ name: "child", kind: "file" }] },
				maximumParentSegments,
			),
		).toThrowError(expect.objectContaining(contractError));
		expect(
			decodeWorkspaceReadDirectory(
				{ entries: [{ name: "b", kind: "file" }] },
				"a".repeat(4_094),
			).entries,
		).toEqual([{ name: "b", kind: "file" }]);
		expect(() =>
			decodeWorkspaceReadDirectory(
				{ entries: [{ name: "child", kind: "file" }] },
				"a".repeat(4_096),
			),
		).toThrowError(expect.objectContaining(contractError));

		const payloadOverflow = Array.from({ length: 2_049 }, (_, index) => ({
			name: `${String(index).padStart(4, "0")}${"a".repeat(1_020)}`,
			kind: "file",
		}));
		expect(
			decodeWorkspaceReadDirectory(
				{ entries: payloadOverflow.slice(0, 2_048) },
				"",
			).entries,
		).toHaveLength(2_048);
		expect(() =>
			decodeWorkspaceReadDirectory({ entries: payloadOverflow }, ""),
		).toThrowError(expect.objectContaining(contractError));
		expect(() =>
			decodeWorkspaceReadDirectory(
				{
					entries: Array.from({ length: 10_001 }, (_, index) => ({
						name: String(index).padStart(5, "0"),
						kind: "file",
					})),
				},
				"",
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("copies and isolates ArrayBuffer and strict number-array payloads", () => {
		const buffer = new Uint8Array([0, 255, 128, 42]).buffer;
		const bufferData = decodeWorkspaceFileData(buffer);
		const numbers = [1, 2, 3, 4];
		const numberData = decodeWorkspaceFileData(numbers);
		expect(Object.isFrozen(bufferData)).toBe(true);
		expect(Object.isFrozen(numberData)).toBe(true);
		expect(bufferData.byteLength).toBe(4);
		expect(numberData.byteLength).toBe(4);

		new Uint8Array(buffer)[0] = 99;
		numbers[0] = 99;
		expect([...bufferData.copy()]).toEqual([0, 255, 128, 42]);
		expect([...numberData.copy()]).toEqual([1, 2, 3, 4]);

		const first = bufferData.copy();
		const second = bufferData.copy();
		expect(first).not.toBe(second);
		first[1] = 0;
		expect([...second]).toEqual([0, 255, 128, 42]);
		expect([...bufferData.copy()]).toEqual([0, 255, 128, 42]);
	});

	it("handles empty bytes and rejects non-byte or oversized transports", () => {
		for (const payload of [new ArrayBuffer(0), []]) {
			const data = decodeWorkspaceFileData(payload);
			expect(Object.isFrozen(data)).toBe(true);
			expect(data.byteLength).toBe(0);
			expect(data.copy()).toEqual(new Uint8Array());
		}
		expect(
			decodeWorkspaceFileData(new ArrayBuffer(8 * 1_024 * 1_024)).byteLength,
		).toBe(8 * 1_024 * 1_024);

		const sparse: number[] = [];
		sparse.length = 2;
		const accessor = [1, 2];
		Object.defineProperty(accessor, "0", { get: () => 1 });
		class ByteArray extends Array<number> {}
		const oversizedFallback: number[] = [];
		oversizedFallback.length = 8 * 1_024 * 1_024 + 1;
		for (const payload of [
			new Uint8Array([1, 2]),
			[-1],
			[256],
			[1.5],
			sparse,
			accessor,
			new ByteArray(1, 2),
			oversizedFallback,
			new ArrayBuffer(8 * 1_024 * 1_024 + 1),
		]) {
			expect(() => decodeWorkspaceFileData(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}

		expect(() =>
			frozenWorkspaceFileData(new Uint8Array(8 * 1_024 * 1_024 + 1)),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("builds frozen owned requests and rejects invalid inputs without leakage", () => {
		const request = frozenWorkspaceEntryRequest(rootId, "src/main.ts");
		expect(request).toEqual({ rootId, relativePath: "src/main.ts" });
		expect(Object.isFrozen(request)).toBe(true);

		for (const [candidateRoot, path, code] of [
			["00000000-0000-3000-8000-000000000101", "src", "ROOT_NOT_AUTHORIZED"],
			["00000000-0000-4000-8000-000000000ABC", "src", "ROOT_NOT_AUTHORIZED"],
			[rootId, "../private-secret", "INVALID_RELATIVE_PATH"],
			[
				"00000000-0000-4000-8000-000000000999",
				"../private-secret",
				"INVALID_RELATIVE_PATH",
			],
		] as const) {
			try {
				frozenWorkspaceEntryRequest(candidateRoot, path);
				expect.fail("invalid request must throw");
			} catch (error) {
				expect(error).toMatchObject({ code });
				expect(Object.isFrozen(error)).toBe(true);
				expect(JSON.stringify(error)).not.toContain("private-secret");
			}
		}
	});
});
