import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	decodeBackupReadAllResult,
	decodeBackupVoid,
	encodeBackupWriteRequest,
	frozenBackupDiscardRequest,
	frozenBackupWriteInputs,
} from "../../app/platform/tauri/backup-codec";
import {
	createBrowserMockBridge,
	type BrowserMockBackupSeedEntryForTest,
} from "../../app/platform/tauri/browser-mock";

const tauri = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

// Imported after the mocks above so `createNativeBridge` picks them up.
const { createNativeBridge } = await import("../../app/platform/tauri/native");

const MAX_BACKUP_ENTRY_BYTES = 8 * 1_024 * 1_024;
const PLBK_HEADER_BYTES = 9;

function decodePlbk(frame: Uint8Array): { key: string; content: Uint8Array } {
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const keyLength = view.getUint8(4);
	const contentLength = view.getUint32(5, false);
	const key = new TextDecoder().decode(
		frame.slice(PLBK_HEADER_BYTES, PLBK_HEADER_BYTES + keyLength),
	);
	const content = frame.slice(
		PLBK_HEADER_BYTES + keyLength,
		PLBK_HEADER_BYTES + keyLength + contentLength,
	);
	return { key, content };
}

function encodePlba(
	entries: readonly (readonly [string, Uint8Array])[],
): Uint8Array {
	const encoder = new TextEncoder();
	const parts: number[] = [0x50, 0x4c, 0x42, 0x41];
	const countBytes = new Uint8Array(4);
	new DataView(countBytes.buffer).setUint32(0, entries.length, false);
	parts.push(...countBytes);
	for (const [key, content] of entries) {
		const keyBytes = encoder.encode(key);
		const lengthBytes = new Uint8Array(4);
		new DataView(lengthBytes.buffer).setUint32(0, content.byteLength, false);
		parts.push(keyBytes.byteLength, ...lengthBytes, ...keyBytes, ...content);
	}
	return Uint8Array.from(parts);
}

describe("backup codec", () => {
	it("round trips a valid write request through the PLBK frame", () => {
		const frame = encodeBackupWriteRequest(
			"alpha-123",
			Uint8Array.from([1, 2, 3]),
		);
		const decoded = decodePlbk(frame);
		expect(decoded.key).toBe("alpha-123");
		expect([...decoded.content]).toEqual([1, 2, 3]);
		expect(frame.byteOffset).toBe(0);
		expect(frame.byteLength).toBe(frame.buffer.byteLength);
	});

	it("rejects every invalid key shape before touching the content", () => {
		for (const key of [
			"",
			"Abc",
			"abc.txt",
			"abc/def",
			"..",
			"a".repeat(129),
		]) {
			expect(() => encodeBackupWriteRequest(key, new Uint8Array())).toThrow(
				expect.objectContaining({ code: "INVALID_BACKUP_KEY" }),
			);
		}
	});

	it("accepts the exact frame limit (header + key + content) and rejects one byte more", () => {
		// The 8 MiB ceiling covers the whole wire frame, not just the content:
		// account for the PLBK header and key bytes when sizing the boundary.
		const key = "k";
		const maxContent = MAX_BACKUP_ENTRY_BYTES - PLBK_HEADER_BYTES - key.length;
		const exact = new Uint8Array(maxContent);
		expect(() => encodeBackupWriteRequest(key, exact)).not.toThrow();

		const oversized = new Uint8Array(maxContent + 1);
		expect(() => encodeBackupWriteRequest(key, oversized)).toThrow(
			expect.objectContaining({ code: "BACKUP_TOO_LARGE" }),
		);
	});

	it("takes an exact private snapshot instead of the caller's live buffer", () => {
		const backing = new Uint8Array([9, 9, 0, 0x41, 0xff, 9]);
		const content = backing.subarray(2, 5);
		const { content: snapshot } = frozenBackupWriteInputs("k", content);
		backing.fill(0);
		expect([...snapshot]).toEqual([0, 0x41, 0xff]);
	});

	it("rejects a boxed, proxied or detached byte payload", () => {
		expect(() => encodeBackupWriteRequest("k", "not-bytes")).toThrow();
		expect(() =>
			encodeBackupWriteRequest("k", new Proxy(new Uint8Array([1]), {})),
		).toThrow();
		const detachable = new Uint8Array(new ArrayBuffer(4));
		expect(() => encodeBackupWriteRequest("k", detachable)).not.toThrow();
	});

	it("builds and rejects a closed-set discard request", () => {
		expect(frozenBackupDiscardRequest("valid-key")).toEqual({
			key: "valid-key",
		});
		expect(() => frozenBackupDiscardRequest("../etc")).toThrow(
			expect.objectContaining({ code: "INVALID_BACKUP_KEY" }),
		);
		expect(() => frozenBackupDiscardRequest(42)).toThrow(
			expect.objectContaining({ code: "INVALID_BACKUP_KEY" }),
		);
	});

	it("decodes void as strictly null and rejects anything else", () => {
		expect(decodeBackupVoid(null)).toBeUndefined();
		for (const value of [undefined, 0, "", {}, []]) {
			expect(() => decodeBackupVoid(value)).toThrow();
		}
	});

	it("round trips backup_read_all through both ArrayBuffer and number[] transports", () => {
		const entries: [string, Uint8Array][] = [
			["alpha", Uint8Array.from([1, 2, 3])],
			["beta", new Uint8Array(0)],
		];
		const frame = encodePlba(entries);

		const fromBuffer = decodeBackupReadAllResult(frame.buffer);
		expect(fromBuffer).toEqual([
			{ key: "alpha", bytes: Uint8Array.from([1, 2, 3]) },
			{ key: "beta", bytes: new Uint8Array(0) },
		]);
		expect(Object.isFrozen(fromBuffer)).toBe(true);
		expect(Object.isFrozen(fromBuffer[0])).toBe(true);

		const fromArray = decodeBackupReadAllResult([...frame]);
		expect(fromArray).toEqual(fromBuffer);
	});

	it("rejects malformed read-all frames: bad magic, truncated, trailing, and duplicate keys", () => {
		const golden = encodePlba([["one", Uint8Array.from([9])]]);
		const badMagic = golden.slice();
		badMagic[0] = 0x58;
		expect(() => decodeBackupReadAllResult(badMagic.buffer)).toThrow();

		const truncated = golden.slice(0, golden.byteLength - 1);
		expect(() => decodeBackupReadAllResult(truncated.buffer)).toThrow();

		const extraTail = Uint8Array.from([...golden, 0]);
		expect(() => decodeBackupReadAllResult(extraTail.buffer)).toThrow();

		const duplicate = encodePlba([
			["dup", Uint8Array.from([1])],
			["dup", Uint8Array.from([2])],
		]);
		expect(() => decodeBackupReadAllResult(duplicate.buffer)).toThrow();
	});

	it("rejects a Proxy-wrapped number[] response even when every element looks valid", () => {
		const golden = [...encodePlba([["one", Uint8Array.from([9])]])];
		const proxied = new Proxy(golden, {});
		expect(() => decodeBackupReadAllResult(proxied)).toThrow();
	});
});

describe("native backup bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("dispatches backup_write with the raw PLBK frame as a top-level argument", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.backupWrite("alpha-1", Uint8Array.from([1, 2, 3]));

		expect(tauri.invoke).toHaveBeenCalledTimes(1);
		const [command, raw] = tauri.invoke.mock.calls[0]!;
		expect(command).toBe("backup_write");
		expect(Object.getPrototypeOf(raw)).toBe(Uint8Array.prototype);
		expect(decodePlbk(raw as Uint8Array)).toEqual({
			key: "alpha-1",
			content: Uint8Array.from([1, 2, 3]),
		});
	});

	it("dispatches backup_read_all with an empty JSON request and decodes the frame", async () => {
		const frame = encodePlba([["k", Uint8Array.from([7, 8])]]);
		tauri.invoke.mockResolvedValueOnce(frame.buffer);
		const bridge = createNativeBridge();

		const entries = await bridge.backupReadAll();

		expect(tauri.invoke).toHaveBeenCalledWith("backup_read_all", {
			request: {},
		});
		expect(entries).toEqual([{ key: "k", bytes: Uint8Array.from([7, 8]) }]);
	});

	it("dispatches backup_discard with the exact key request", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.backupDiscard("gamma-2");

		expect(tauri.invoke).toHaveBeenCalledWith("backup_discard", {
			request: { key: "gamma-2" },
		});
	});

	it("dispatches backup_discard_all with an empty JSON request", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.backupDiscardAll();

		expect(tauri.invoke).toHaveBeenCalledWith("backup_discard_all", {
			request: {},
		});
	});

	it("routes each of the four backup methods to a distinct command exactly once", async () => {
		tauri.invoke.mockResolvedValue(null);
		const bridge = createNativeBridge();

		await bridge.backupWrite("k", new Uint8Array());
		tauri.invoke.mockResolvedValueOnce(encodePlba([]).buffer);
		await bridge.backupReadAll();
		await bridge.backupDiscard("k");
		await bridge.backupDiscardAll();

		const commands = tauri.invoke.mock.calls.map(([command]) => command);
		expect(commands).toEqual([
			"backup_write",
			"backup_read_all",
			"backup_discard",
			"backup_discard_all",
		]);
		expect(new Set(commands).size).toBe(4);
	});
});

describe("browser mock backup bridge", () => {
	it("reports BACKUP_UNAVAILABLE for every operation before any workspace root is open", async () => {
		const bridge = createBrowserMockBridge();

		await expect(
			bridge.backupWrite("k", new Uint8Array()),
		).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupReadAll()).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupDiscard("k")).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupDiscardAll()).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
	});

	it("writes, reads back, discards and bulk-discards once a workspace root is open", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		await bridge.backupWrite("alpha", Uint8Array.from([1, 2, 3]));
		await bridge.backupWrite("beta", Uint8Array.from([4, 5]));
		expect([...(await bridge.backupReadAll())]).toEqual([
			{ key: "alpha", bytes: Uint8Array.from([1, 2, 3]) },
			{ key: "beta", bytes: Uint8Array.from([4, 5]) },
		]);

		await bridge.backupDiscard("alpha");
		await bridge.backupDiscard("alpha");
		expect([...(await bridge.backupReadAll())]).toEqual([
			{ key: "beta", bytes: Uint8Array.from([4, 5]) },
		]);

		await bridge.backupDiscardAll();
		await bridge.backupDiscardAll();
		expect(await bridge.backupReadAll()).toEqual([]);
	});

	it("copies bytes on write and on read so neither side can mutate the other's state", async () => {
		const bridge = createBrowserMockBridge();
		await bridge.workspacePickRoots("replace");

		const input = Uint8Array.from([1, 2, 3]);
		await bridge.backupWrite("k", input);
		input.fill(0);

		const firstRead = await bridge.backupReadAll();
		expect([...firstRead[0]!.bytes]).toEqual([1, 2, 3]);
		firstRead[0]!.bytes.fill(9);

		const secondRead = await bridge.backupReadAll();
		expect([...secondRead[0]!.bytes]).toEqual([1, 2, 3]);
	});

	it("isolates backup state between independently created mock instances", async () => {
		const first = createBrowserMockBridge();
		const second = createBrowserMockBridge();
		await first.workspacePickRoots("replace");
		await second.workspacePickRoots("replace");

		await first.backupWrite("only-in-first", Uint8Array.from([1]));

		expect(await first.backupReadAll()).toEqual([
			{ key: "only-in-first", bytes: Uint8Array.from([1]) },
		]);
		expect(await second.backupReadAll()).toEqual([]);
	});

	it("seeds the isolated store from a test fixture before any interaction", async () => {
		const seed: readonly BrowserMockBackupSeedEntryForTest[] = [
			{ key: "restored", bytes: [1, 2, 3] },
		];
		const bridge = createBrowserMockBridge({ backupFixtureForTest: seed });
		await bridge.workspacePickRoots("replace");

		expect(await bridge.backupReadAll()).toEqual([
			{ key: "restored", bytes: Uint8Array.from([1, 2, 3]) },
		]);

		const unseeded = createBrowserMockBridge();
		await unseeded.workspacePickRoots("replace");
		expect(await unseeded.backupReadAll()).toEqual([]);
	});

	it("rejects an invalid seed key or an oversized seed payload", () => {
		expect(() =>
			createBrowserMockBridge({
				backupFixtureForTest: [{ key: "Invalid", bytes: [1] }],
			}),
		).toThrow(expect.objectContaining({ code: "INVALID_BACKUP_KEY" }));
		expect(() =>
			createBrowserMockBridge({
				backupFixtureForTest: [
					{
						key: "k",
						bytes: Array.from({ length: MAX_BACKUP_ENTRY_BYTES + 1 }, () => 0),
					},
				],
			}),
		).toThrow(expect.objectContaining({ code: "BACKUP_TOO_LARGE" }));
	});
});
