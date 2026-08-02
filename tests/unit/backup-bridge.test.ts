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
const ROOT_ID = "00000000-0000-4000-8000-000000000101";
const PLB2_HEADER_BYTES = 45;

function decodePlb2(frame: Uint8Array): {
	rootId: string;
	key: string;
	content: Uint8Array;
} {
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const rootId = new TextDecoder().decode(frame.slice(4, 40));
	const keyLength = view.getUint8(40);
	const contentLength = view.getUint32(41, false);
	const key = new TextDecoder().decode(
		frame.slice(PLB2_HEADER_BYTES, PLB2_HEADER_BYTES + keyLength),
	);
	const content = frame.slice(
		PLB2_HEADER_BYTES + keyLength,
		PLB2_HEADER_BYTES + keyLength + contentLength,
	);
	return { rootId, key, content };
}

function encodePla2(
	entries: readonly (readonly [string, string, Uint8Array])[],
): Uint8Array {
	const encoder = new TextEncoder();
	const parts: number[] = [0x50, 0x4c, 0x41, 0x32];
	const countBytes = new Uint8Array(4);
	new DataView(countBytes.buffer).setUint32(0, entries.length, false);
	parts.push(...countBytes);
	for (const [rootId, key, content] of entries) {
		const rootBytes = encoder.encode(rootId);
		const keyBytes = encoder.encode(key);
		const lengthBytes = new Uint8Array(4);
		new DataView(lengthBytes.buffer).setUint32(0, content.byteLength, false);
		parts.push(
			...rootBytes,
			keyBytes.byteLength,
			...lengthBytes,
			...keyBytes,
			...content,
		);
	}
	return Uint8Array.from(parts);
}

describe("backup codec", () => {
	it("round trips a valid write request through the root-bound PLB2 frame", () => {
		const frame = encodeBackupWriteRequest(
			ROOT_ID,
			"alpha-123",
			Uint8Array.from([1, 2, 3]),
		);
		const decoded = decodePlb2(frame);
		expect(decoded.rootId).toBe(ROOT_ID);
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
			expect(() =>
				encodeBackupWriteRequest(ROOT_ID, key, new Uint8Array()),
			).toThrow(expect.objectContaining({ code: "INVALID_BACKUP_KEY" }));
		}
	});

	it("accepts the exact frame limit (header + key + content) and rejects one byte more", () => {
		// The 8 MiB ceiling covers the whole wire frame, not just the content:
		// account for the PLB2 header and key bytes when sizing the boundary.
		const key = "k";
		const maxContent = MAX_BACKUP_ENTRY_BYTES - PLB2_HEADER_BYTES - key.length;
		const exact = new Uint8Array(maxContent);
		expect(() => encodeBackupWriteRequest(ROOT_ID, key, exact)).not.toThrow();

		const oversized = new Uint8Array(maxContent + 1);
		expect(() => encodeBackupWriteRequest(ROOT_ID, key, oversized)).toThrow(
			expect.objectContaining({ code: "BACKUP_TOO_LARGE" }),
		);
	});

	it("takes an exact private snapshot instead of the caller's live buffer", () => {
		const backing = new Uint8Array([9, 9, 0, 0x41, 0xff, 9]);
		const content = backing.subarray(2, 5);
		const { content: snapshot } = frozenBackupWriteInputs(
			ROOT_ID,
			"k",
			content,
		);
		backing.fill(0);
		expect([...snapshot]).toEqual([0, 0x41, 0xff]);
	});

	it("rejects a boxed, proxied or detached byte payload", () => {
		expect(() => encodeBackupWriteRequest(ROOT_ID, "k", "not-bytes")).toThrow();
		expect(() =>
			encodeBackupWriteRequest(
				ROOT_ID,
				"k",
				new Proxy(new Uint8Array([1]), {}),
			),
		).toThrow();
		const detachable = new Uint8Array(new ArrayBuffer(4));
		expect(() =>
			encodeBackupWriteRequest(ROOT_ID, "k", detachable),
		).not.toThrow();
	});

	it("builds and rejects a closed-set discard request", () => {
		expect(frozenBackupDiscardRequest(ROOT_ID, "valid-key")).toEqual({
			rootId: ROOT_ID,
			key: "valid-key",
		});
		expect(() => frozenBackupDiscardRequest(ROOT_ID, "../etc")).toThrow(
			expect.objectContaining({ code: "INVALID_BACKUP_KEY" }),
		);
		expect(() => frozenBackupDiscardRequest(ROOT_ID, 42)).toThrow(
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
		const entries: [string, string, Uint8Array][] = [
			[ROOT_ID, "alpha", Uint8Array.from([1, 2, 3])],
			[ROOT_ID, "beta", new Uint8Array(0)],
		];
		const frame = encodePla2(entries);

		const fromBuffer = decodeBackupReadAllResult(frame.buffer);
		expect(fromBuffer).toEqual([
			{ rootId: ROOT_ID, key: "alpha", bytes: Uint8Array.from([1, 2, 3]) },
			{ rootId: ROOT_ID, key: "beta", bytes: new Uint8Array(0) },
		]);
		expect(Object.isFrozen(fromBuffer)).toBe(true);
		expect(Object.isFrozen(fromBuffer[0])).toBe(true);

		const fromArray = decodeBackupReadAllResult([...frame]);
		expect(fromArray).toEqual(fromBuffer);
	});

	it("rejects malformed read-all frames: bad magic, truncated, trailing, and duplicate keys", () => {
		const golden = encodePla2([[ROOT_ID, "one", Uint8Array.from([9])]]);
		const badMagic = golden.slice();
		badMagic[0] = 0x58;
		expect(() => decodeBackupReadAllResult(badMagic.buffer)).toThrow();

		const truncated = golden.slice(0, golden.byteLength - 1);
		expect(() => decodeBackupReadAllResult(truncated.buffer)).toThrow();

		const extraTail = Uint8Array.from([...golden, 0]);
		expect(() => decodeBackupReadAllResult(extraTail.buffer)).toThrow();

		const duplicate = encodePla2([
			[ROOT_ID, "dup", Uint8Array.from([1])],
			[ROOT_ID, "dup", Uint8Array.from([2])],
		]);
		expect(() => decodeBackupReadAllResult(duplicate.buffer)).toThrow();
	});

	it("rejects a Proxy-wrapped number[] response even when every element looks valid", () => {
		const golden = [...encodePla2([[ROOT_ID, "one", Uint8Array.from([9])]])];
		const proxied = new Proxy(golden, {});
		expect(() => decodeBackupReadAllResult(proxied)).toThrow();
	});
});

describe("native backup bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("dispatches backup_write with the raw PLB2 frame as a top-level argument", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.backupWrite(ROOT_ID, "alpha-1", Uint8Array.from([1, 2, 3]));

		expect(tauri.invoke).toHaveBeenCalledTimes(1);
		const [command, raw] = tauri.invoke.mock.calls[0]!;
		expect(command).toBe("backup_write");
		expect(Object.getPrototypeOf(raw)).toBe(Uint8Array.prototype);
		expect(decodePlb2(raw as Uint8Array)).toEqual({
			rootId: ROOT_ID,
			key: "alpha-1",
			content: Uint8Array.from([1, 2, 3]),
		});
	});

	it("dispatches backup_read_all with an empty JSON request and decodes the frame", async () => {
		const frame = encodePla2([[ROOT_ID, "k", Uint8Array.from([7, 8])]]);
		tauri.invoke.mockResolvedValueOnce(frame.buffer);
		const bridge = createNativeBridge();

		const entries = await bridge.backupReadAll();

		expect(tauri.invoke).toHaveBeenCalledWith("backup_read_all", {
			request: {},
		});
		expect(entries).toEqual([
			{ rootId: ROOT_ID, key: "k", bytes: Uint8Array.from([7, 8]) },
		]);
	});

	it("dispatches backup_discard with the exact key request", async () => {
		tauri.invoke.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await bridge.backupDiscard(ROOT_ID, "gamma-2");

		expect(tauri.invoke).toHaveBeenCalledWith("backup_discard", {
			request: { rootId: ROOT_ID, key: "gamma-2" },
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

		await bridge.backupWrite(ROOT_ID, "k", new Uint8Array());
		tauri.invoke.mockResolvedValueOnce(encodePla2([]).buffer);
		await bridge.backupReadAll();
		await bridge.backupDiscard(ROOT_ID, "k");
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
			bridge.backupWrite(ROOT_ID, "k", new Uint8Array()),
		).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupReadAll()).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupDiscard(ROOT_ID, "k")).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
		await expect(bridge.backupDiscardAll()).rejects.toMatchObject({
			code: "BACKUP_UNAVAILABLE",
		});
	});

	it("writes, reads back, discards and bulk-discards once a workspace root is open", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		if (selected.status !== "selected") throw new Error("expected root");
		const rootId = selected.snapshot.roots[0]!.rootId;

		await bridge.backupWrite(rootId, "alpha", Uint8Array.from([1, 2, 3]));
		await bridge.backupWrite(rootId, "beta", Uint8Array.from([4, 5]));
		expect([...(await bridge.backupReadAll())]).toEqual([
			{ rootId, key: "alpha", bytes: Uint8Array.from([1, 2, 3]) },
			{ rootId, key: "beta", bytes: Uint8Array.from([4, 5]) },
		]);

		await bridge.backupDiscard(rootId, "alpha");
		await bridge.backupDiscard(rootId, "alpha");
		expect([...(await bridge.backupReadAll())]).toEqual([
			{ rootId, key: "beta", bytes: Uint8Array.from([4, 5]) },
		]);

		await bridge.backupDiscardAll();
		await bridge.backupDiscardAll();
		expect(await bridge.backupReadAll()).toEqual([]);
	});

	it("copies bytes on write and on read so neither side can mutate the other's state", async () => {
		const bridge = createBrowserMockBridge();
		const selected = await bridge.workspacePickRoots("replace");
		if (selected.status !== "selected") throw new Error("expected root");
		const rootId = selected.snapshot.roots[0]!.rootId;

		const input = Uint8Array.from([1, 2, 3]);
		await bridge.backupWrite(rootId, "k", input);
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
		const firstSelected = await first.workspacePickRoots("replace");
		const secondSelected = await second.workspacePickRoots("replace");
		if (
			firstSelected.status !== "selected" ||
			secondSelected.status !== "selected"
		)
			throw new Error("expected roots");
		const firstRootId = firstSelected.snapshot.roots[0]!.rootId;

		await first.backupWrite(firstRootId, "only-in-first", Uint8Array.from([1]));

		expect(await first.backupReadAll()).toEqual([
			{
				rootId: firstRootId,
				key: "only-in-first",
				bytes: Uint8Array.from([1]),
			},
		]);
		expect(await second.backupReadAll()).toEqual([]);
	});

	it("seeds the isolated store from a test fixture before any interaction", async () => {
		const seed: readonly BrowserMockBackupSeedEntryForTest[] = [
			{ rootId: ROOT_ID, key: "restored", bytes: [1, 2, 3] },
		];
		const bridge = createBrowserMockBridge({ backupFixtureForTest: seed });
		const selected = await bridge.workspacePickRoots("replace");
		if (selected.status !== "selected") throw new Error("expected root");
		const selectedRootId = selected.snapshot.roots[0]!.rootId;

		expect(selectedRootId).toBe(ROOT_ID);
		expect(await bridge.backupReadAll()).toEqual([
			{ rootId: ROOT_ID, key: "restored", bytes: Uint8Array.from([1, 2, 3]) },
		]);

		const unseeded = createBrowserMockBridge();
		await unseeded.workspacePickRoots("replace");
		expect(await unseeded.backupReadAll()).toEqual([]);
	});

	it("rejects an invalid seed key or an oversized seed payload", () => {
		expect(() =>
			createBrowserMockBridge({
				backupFixtureForTest: [{ rootId: ROOT_ID, key: "Invalid", bytes: [1] }],
			}),
		).toThrow(expect.objectContaining({ code: "INVALID_BACKUP_KEY" }));
		expect(() =>
			createBrowserMockBridge({
				backupFixtureForTest: [
					{
						rootId: ROOT_ID,
						key: "k",
						bytes: Array.from({ length: MAX_BACKUP_ENTRY_BYTES + 1 }, () => 0),
					},
				],
			}),
		).toThrow(expect.objectContaining({ code: "BACKUP_TOO_LARGE" }));
	});
});
