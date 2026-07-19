import { describe, expect, it } from "vitest";

import workspaceVersionFixture from "../fixtures/workspace-version-v1.json" with { type: "json" };

import {
	compareWorkspaceEntryNames,
	decodeWorkspaceEntryStat,
	decodeWorkspaceFileData,
	decodeWorkspaceReadFile,
	decodeWorkspaceReadDirectory,
	decodeWorkspaceVoid,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceFileData,
	frozenWorkspaceRenameRequest,
	isPortableWorkspaceEntryName,
} from "../../app/platform/tauri/workspace-codec";

const rootId = "00000000-0000-4000-8000-000000000101";
const targetRootId = "00000000-0000-4000-8000-000000000102";
const contractError = {
	code: "IPC_CONTRACT_VIOLATION",
	message: "Native IPC returned a payload that violates the Plain contract.",
};
const version = `wv1:${"a".repeat(64)}`;

function plr1Frame({
	kind = "file",
	version: frameVersion = version,
	content = new Uint8Array([0, 255, 128, 42]),
	size = content.byteLength,
	mtime = 1_700_000_000_123,
	ctime = 1_699_999_999_000,
}: {
	readonly kind?: "file" | "symlinkFile";
	readonly version?: string | null;
	readonly content?: Uint8Array;
	readonly size?: number;
	readonly mtime?: number;
	readonly ctime?: number;
} = {}): ArrayBuffer {
	const versionBytes =
		frameVersion === null
			? new Uint8Array()
			: new TextEncoder().encode(frameVersion);
	const frame = new Uint8Array(
		36 + versionBytes.byteLength + content.byteLength,
	);
	const view = new DataView(frame.buffer);
	frame.set([0x50, 0x4c, 0x52, 0x31], 0);
	frame[4] = kind === "file" ? 1 : 2;
	frame[5] = versionBytes.byteLength;
	view.setUint16(6, 0, false);
	view.setUint32(8, content.byteLength, false);
	view.setBigUint64(12, BigInt(size), false);
	view.setBigUint64(20, BigInt(mtime), false);
	view.setBigUint64(28, BigInt(ctime), false);
	frame.set(versionBytes, 36);
	frame.set(content, 36 + versionBytes.byteLength);
	return frame.buffer;
}

function mutatedFrame(
	frame: ArrayBuffer,
	mutate: (bytes: Uint8Array, view: DataView) => void,
): ArrayBuffer {
	const copy = frame.slice(0);
	mutate(new Uint8Array(copy), new DataView(copy));
	return copy;
}

function arrayBufferFromHex(hex: string): ArrayBuffer {
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes.buffer;
}

describe("workspace file data codec", () => {
	it("accepts only null for void native command responses", () => {
		expect(decodeWorkspaceVoid(null)).toBeUndefined();
		for (const payload of [undefined, false, 0, "", {}, []]) {
			expect(() => decodeWorkspaceVoid(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("decodes exact immutable stat payloads and rejects unsafe fields", () => {
		const stat = decodeWorkspaceEntryStat({
			kind: "file",
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 0,
			version,
		});
		expect(stat).toEqual({
			kind: "file",
			size: 42,
			mtime: 1_700_000_000_000,
			ctime: 0,
			version,
		});
		expect(Object.isFrozen(stat)).toBe(true);
		expect(
			decodeWorkspaceEntryStat({
				kind: "file",
				size: Number.MAX_SAFE_INTEGER,
				mtime: 0,
				ctime: 0,
				version: null,
			}).size,
		).toBe(Number.MAX_SAFE_INTEGER);

		for (const payload of [
			{ kind: "unknown", size: 0, mtime: 0, ctime: 0, version: null },
			{ kind: "file", size: -1, mtime: 0, ctime: 0, version: null },
			{ kind: "file", size: 1.5, mtime: 0, ctime: 0, version: null },
			{
				kind: "file",
				size: 0,
				mtime: Number.MAX_VALUE,
				ctime: 0,
				version: null,
			},
			{ kind: "file", size: 0, mtime: 0, ctime: 0 },
			{ kind: "directory", size: 0, mtime: 0, ctime: 0, version },
			{ kind: "file", size: 0, mtime: 0, ctime: 0, version: "wv1:ABC" },
			{
				kind: "file",
				size: 0,
				mtime: 0,
				ctime: 0,
				version: null,
				path: "/private",
			},
		]) {
			expect(() => decodeWorkspaceEntryStat(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
	});

	it("decodes stat fields from one own-data snapshot without invoking accessors or Proxy reads", () => {
		let accessorReads = 0;
		const accessorStat = {
			kind: "file",
			size: 1,
			mtime: 2,
			ctime: 3,
			get version() {
				accessorReads += 1;
				return version;
			},
		};
		let proxyReads = 0;
		const proxyStat = new Proxy(
			{
				kind: "file",
				size: 1,
				mtime: 2,
				ctime: 3,
				version,
			},
			{
				get(target, property, receiver) {
					proxyReads += 1;
					if (property === "version") {
						return proxyReads % 2 === 0 ? `wv1:${"b".repeat(64)}` : version;
					}
					return Reflect.get(target, property, receiver);
				},
			},
		);
		let descriptorVersionReads = 0;
		const changingDescriptorStat = new Proxy(
			{
				kind: "file",
				size: 1,
				mtime: 2,
				ctime: 3,
				version,
			},
			{
				getOwnPropertyDescriptor(target, property) {
					const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
					if (
						property !== "version" ||
						descriptor === undefined ||
						!("value" in descriptor)
					) {
						return descriptor;
					}
					descriptorVersionReads += 1;
					return {
						...descriptor,
						value:
							descriptorVersionReads % 2 === 0
								? `wv1:${"b".repeat(64)}`
								: version,
					};
				},
			},
		);

		for (const payload of [accessorStat, proxyStat, changingDescriptorStat]) {
			expect(() => decodeWorkspaceEntryStat(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
		expect(accessorReads).toBe(0);
		expect(proxyReads).toBe(0);
		expect(descriptorVersionReads).toBeGreaterThan(0);
	});

	it("decodes the shared golden PLR1 into one immutable read receipt", () => {
		const source = arrayBufferFromHex(workspaceVersionFixture.read.frameHex);
		const receipt = decodeWorkspaceReadFile(source);
		const fallbackSource = [
			...new Uint8Array(
				arrayBufferFromHex(workspaceVersionFixture.read.frameHex),
			),
		];
		const fallbackReceipt = decodeWorkspaceReadFile(fallbackSource);

		expect(receipt.stat).toEqual({
			kind: workspaceVersionFixture.read.kind,
			size: workspaceVersionFixture.read.size,
			mtime: workspaceVersionFixture.read.mtimeMs,
			ctime: workspaceVersionFixture.read.ctimeMs,
			version: workspaceVersionFixture.read.version,
		});
		expect(receipt.value.byteLength).toBe(4);
		expect(Buffer.from(receipt.value.copy()).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
		expect(Object.isFrozen(receipt)).toBe(true);
		expect(Object.isFrozen(receipt.stat)).toBe(true);
		expect(Object.isFrozen(receipt.value)).toBe(true);
		expect(fallbackReceipt.stat).toEqual(receipt.stat);
		expect(fallbackReceipt.value.copy()).toEqual(receipt.value.copy());
		expect(fallbackSource).toHaveLength(0);

		new Uint8Array(source).fill(7);
		fallbackSource.fill(7);
		const first = receipt.value.copy();
		const second = receipt.value.copy();
		first[0] = 99;
		expect(Buffer.from(second).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
		expect(Buffer.from(receipt.value.copy()).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
		expect(Buffer.from(fallbackReceipt.value.copy()).toString("hex")).toBe(
			workspaceVersionFixture.read.contentHex,
		);
	});

	it(
		"decodes and consumes the maximum dense macOS fallback without reflective amplification",
		{ timeout: 60_000 },
		() => {
			const frame = plr1Frame({
				version: null,
				content: new Uint8Array(8 * 1_024 * 1_024),
			});
			const fallback = Array.from(new Uint8Array(frame));
			const receipt = decodeWorkspaceReadFile(fallback);

			expect(fallback).toHaveLength(0);
			expect(receipt.stat).toMatchObject({
				kind: "file",
				size: 8 * 1_024 * 1_024,
				version: null,
			});
			expect(receipt.value.byteLength).toBe(8 * 1_024 * 1_024);
		},
	);

	it("accepts only the closed tokenless PLR1 kinds and bounded content", () => {
		for (const kind of ["file", "symlinkFile"] as const) {
			const receipt = decodeWorkspaceReadFile(
				plr1Frame({ kind, version: null, content: new Uint8Array() }),
			);
			expect(receipt.stat).toEqual({
				kind,
				size: 0,
				mtime: 1_700_000_000_123,
				ctime: 1_699_999_999_000,
				version: null,
			});
		}

		const maximum = decodeWorkspaceReadFile(
			plr1Frame({
				content: new Uint8Array(8 * 1_024 * 1_024),
			}),
		);
		expect(maximum.value.byteLength).toBe(8 * 1_024 * 1_024);
		expect(() =>
			decodeWorkspaceReadFile(
				plr1Frame({ content: new Uint8Array(8 * 1_024 * 1_024 + 1) }),
			),
		).toThrowError(expect.objectContaining(contractError));
	});

	it("rejects malformed, unsafe and non-raw PLR1 transports", () => {
		const valid = plr1Frame();
		class ArrayBufferSubclass extends ArrayBuffer {}
		const withOwnProperty = valid.slice(0);
		Object.defineProperty(withOwnProperty, "private", { value: true });
		const proxy = new Proxy(valid.slice(0), {});
		const shared = new SharedArrayBuffer(valid.byteLength);
		new Uint8Array(shared).set(new Uint8Array(valid));
		const detached = valid.slice(0);
		structuredClone(detached, { transfer: [detached] });
		const withTrailingByte = new Uint8Array(valid.byteLength + 1);
		withTrailingByte.set(new Uint8Array(valid));

		const sparse: number[] = [];
		sparse.length = valid.byteLength;
		const accessor = [...new Uint8Array(valid)];
		let accessorReads = 0;
		Object.defineProperty(accessor, "0", {
			get() {
				accessorReads += 1;
				return 0x50;
			},
		});
		class ByteArraySubclass extends Array<number> {}
		const withExtraArrayKey = [...new Uint8Array(valid)];
		Object.defineProperty(withExtraArrayKey, "private", { value: true });
		const withSymbolKey = [...new Uint8Array(valid)];
		Object.defineProperty(withSymbolKey, Symbol("private"), { value: true });
		const withNonstandardIndex = [...new Uint8Array(valid)];
		Object.defineProperty(withNonstandardIndex, "00", { value: 0x50 });
		const withNonconfigurableIndex = [...new Uint8Array(valid)];
		Object.defineProperty(withNonconfigurableIndex, "0", {
			configurable: false,
		});
		let proxyReads = 0;
		const proxyArray = new Proxy([...new Uint8Array(valid)], {
			get(target, property, receiver) {
				proxyReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		const oversizedArray: number[] = [];
		oversizedArray.length = 36 + 68 + 8 * 1_024 * 1_024 + 1;
		const negativeByte = [...new Uint8Array(valid)];
		negativeByte[0] = -1;
		const oversizedByte = [...new Uint8Array(valid)];
		oversizedByte[0] = 256;
		const fractionalByte = [...new Uint8Array(valid)];
		fractionalByte[0] = 0.5;

		for (const payload of [
			new Uint8Array(valid),
			new ArrayBufferSubclass(valid.byteLength),
			withOwnProperty,
			proxy,
			shared,
			detached,
			withTrailingByte.buffer,
			sparse,
			accessor,
			new ByteArraySubclass(...new Uint8Array(valid)),
			withExtraArrayKey,
			withSymbolKey,
			withNonstandardIndex,
			withNonconfigurableIndex,
			proxyArray,
			oversizedArray,
			negativeByte,
			oversizedByte,
			fractionalByte,
			valid.slice(0, -1),
			new ArrayBuffer(0),
			mutatedFrame(valid, (bytes) => {
				bytes[0] = 0;
			}),
			mutatedFrame(valid, (bytes) => {
				bytes[4] = 3;
			}),
			mutatedFrame(valid, (bytes) => {
				bytes[5] = 1;
			}),
			mutatedFrame(valid, (_bytes, view) => {
				view.setUint16(6, 1, false);
			}),
			mutatedFrame(valid, (_bytes, view) => {
				view.setUint32(8, 3, false);
			}),
			mutatedFrame(valid, (_bytes, view) => {
				view.setBigUint64(12, 3n, false);
			}),
			mutatedFrame(valid, (_bytes, view) => {
				view.setBigUint64(20, BigInt(Number.MAX_SAFE_INTEGER) + 1n, false);
			}),
			mutatedFrame(valid, (bytes) => {
				bytes[36] = 0x57;
			}),
			plr1Frame({ kind: "symlinkFile", version }),
		]) {
			expect(() => decodeWorkspaceReadFile(payload)).toThrowError(
				expect.objectContaining(contractError),
			);
		}
		expect(accessorReads).toBe(0);
		// Promise/Array brand checks may read `then`; the PLR1 decoder itself must
		// still reject the Proxy before consuming indexed values.
		expect(proxyReads).toBe(0);
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
		const inheritedSetterNumbers = [5, 6, 7, 8];
		let inheritedSetterCalls = 0;
		Object.defineProperty(Array.prototype, "3", {
			configurable: true,
			set() {
				inheritedSetterCalls += 1;
			},
		});
		const inheritedSetterData = (() => {
			try {
				return decodeWorkspaceFileData(inheritedSetterNumbers);
			} finally {
				Reflect.deleteProperty(Array.prototype, "3");
			}
		})();
		expect(Object.isFrozen(bufferData)).toBe(true);
		expect(Object.isFrozen(numberData)).toBe(true);
		expect(bufferData.byteLength).toBe(4);
		expect(numberData.byteLength).toBe(4);
		expect(numbers).toEqual([1, 2, 3, 4]);
		expect(inheritedSetterCalls).toBe(0);
		expect(inheritedSetterNumbers).toEqual([5, 6, 7, 8]);
		expect([...inheritedSetterData.copy()]).toEqual([5, 6, 7, 8]);

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
		const createRequest = frozenWorkspaceCreateEntryRequest(
			rootId,
			"src/new.ts",
		);
		const renameRequest = frozenWorkspaceRenameRequest(
			rootId,
			"src/old.ts",
			"src/new.ts",
		);
		expect(request).toEqual({ rootId, relativePath: "src/main.ts" });
		expect(createRequest).toEqual({
			rootId,
			relativePath: "src/new.ts",
		});
		expect(renameRequest).toEqual({
			rootId,
			sourcePath: "src/old.ts",
			targetPath: "src/new.ts",
		});
		expect(Object.isFrozen(request)).toBe(true);
		expect(Object.isFrozen(createRequest)).toBe(true);
		expect(Object.isFrozen(renameRequest)).toBe(true);
		expect(() =>
			frozenWorkspaceCreateEntryRequest(
				"00000000-0000-3000-8000-000000000101",
				"new.ts",
			),
		).toThrowError(
			expect.objectContaining({
				code: "ROOT_NOT_AUTHORIZED",
				message: "The workspace root is not authorized.",
			}),
		);
		expect(() =>
			frozenWorkspaceRenameRequest(
				"00000000-0000-3000-8000-000000000101",
				"source",
				"target",
			),
		).toThrowError(expect.objectContaining({ code: "ROOT_NOT_AUTHORIZED" }));

		for (const [relativePath, code, message] of [
			[
				"",
				"ENTRY_TYPE_MISMATCH",
				"The workspace entry has an incompatible type.",
			],
			[
				"../private-secret",
				"INVALID_RELATIVE_PATH",
				"The workspace-relative path is invalid.",
			],
		] as const) {
			try {
				frozenWorkspaceCreateEntryRequest(rootId, relativePath);
				expect.fail("invalid create request must throw");
			} catch (error) {
				expect(error).toEqual({
					code,
					message,
				});
				expect(Object.isFrozen(error)).toBe(true);
				expect(JSON.stringify(error)).not.toContain("private-secret");
			}
		}

		for (const [sourcePath, targetPath, code] of [
			["", "target", "ENTRY_TYPE_MISMATCH"],
			["source", "", "ENTRY_TYPE_MISMATCH"],
			["../private-source", "target", "INVALID_RELATIVE_PATH"],
			["source", "../private-target", "INVALID_RELATIVE_PATH"],
		] as const) {
			try {
				frozenWorkspaceRenameRequest(rootId, sourcePath, targetPath);
				expect.fail("invalid rename request must throw");
			} catch (error) {
				expect(error).toMatchObject({ code });
				expect(Object.isFrozen(error)).toBe(true);
				expect(JSON.stringify(error)).not.toContain("private");
			}
		}
		expect(frozenWorkspaceRenameRequest(rootId, "%2e%2e", "%2F")).toEqual({
			rootId,
			sourcePath: "%2e%2e",
			targetPath: "%2F",
		});
		expect(() =>
			frozenWorkspaceRenameRequest(rootId, "source", "source"),
		).toThrowError(expect.objectContaining({ code: "ENTRY_ALREADY_EXISTS" }));
		expect(() =>
			frozenWorkspaceRenameRequest(rootId, "source", "source/nested"),
		).toThrowError(expect.objectContaining({ code: "WORKSPACE_CONFLICT" }));
		expect(frozenWorkspaceRenameRequest(rootId, "a", "ab")).toEqual({
			rootId,
			sourcePath: "a",
			targetPath: "ab",
		});

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

	it("builds strict frozen copy requests for one or two roots", () => {
		const crossRoot = frozenWorkspaceCopyRequest(
			rootId,
			"src/main.ts",
			targetRootId,
			"packages/main.ts",
		);
		expect(crossRoot).toEqual({
			sourceRootId: rootId,
			sourcePath: "src/main.ts",
			targetRootId,
			targetPath: "packages/main.ts",
		});
		expect(Object.isFrozen(crossRoot)).toBe(true);
		expect(
			frozenWorkspaceCopyRequest(
				rootId,
				"same/path",
				targetRootId,
				"same/path",
			),
		).toEqual({
			sourceRootId: rootId,
			sourcePath: "same/path",
			targetRootId,
			targetPath: "same/path",
		});
		expect(
			frozenWorkspaceCopyRequest(rootId, "%2e%2e", targetRootId, "%2F"),
		).toEqual({
			sourceRootId: rootId,
			sourcePath: "%2e%2e",
			targetRootId,
			targetPath: "%2F",
		});
		expect(frozenWorkspaceCopyRequest(rootId, "", rootId, "")).toEqual({
			sourceRootId: rootId,
			sourcePath: "",
			targetRootId: rootId,
			targetPath: "",
		});
		expect(
			frozenWorkspaceCopyRequest(rootId, "source", rootId, "source"),
		).toEqual({
			sourceRootId: rootId,
			sourcePath: "source",
			targetRootId: rootId,
			targetPath: "source",
		});
		expect(
			frozenWorkspaceCopyRequest(rootId, "source", rootId, "source/nested"),
		).toEqual({
			sourceRootId: rootId,
			sourcePath: "source",
			targetRootId: rootId,
			targetPath: "source/nested",
		});
	});

	it("rejects only malformed copy UUIDs and path syntax", () => {
		const invalidCases: readonly (readonly [
			unknown,
			unknown,
			unknown,
			unknown,
			string,
		])[] = [
			[
				"00000000-0000-3000-8000-000000000101",
				"source",
				targetRootId,
				"target",
				"ROOT_NOT_AUTHORIZED",
			],
			[
				rootId,
				"source",
				"00000000-0000-4000-8000-000000000ABC",
				"target",
				"ROOT_NOT_AUTHORIZED",
			],
			[
				rootId,
				"../private-source",
				targetRootId,
				"target",
				"INVALID_RELATIVE_PATH",
			],
			[
				rootId,
				"source",
				targetRootId,
				"../private-target",
				"INVALID_RELATIVE_PATH",
			],
			[rootId, 42, targetRootId, "target", "INVALID_RELATIVE_PATH"],
			[rootId, "source", targetRootId, undefined, "INVALID_RELATIVE_PATH"],
		];
		for (const [
			sourceRoot,
			sourcePath,
			targetRoot,
			targetPath,
			code,
		] of invalidCases) {
			try {
				frozenWorkspaceCopyRequest(
					sourceRoot,
					sourcePath,
					targetRoot,
					targetPath,
				);
				expect.fail("invalid copy request must throw");
			} catch (error) {
				expect(error).toMatchObject({ code });
				expect(Object.isFrozen(error)).toBe(true);
				expect(JSON.stringify(error)).not.toContain("private");
			}
		}

		expect(frozenWorkspaceCopyRequest(rootId, "a", rootId, "ab")).toEqual({
			sourceRootId: rootId,
			sourcePath: "a",
			targetRootId: rootId,
			targetPath: "ab",
		});
	});
});
