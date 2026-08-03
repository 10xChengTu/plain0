import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBrowserMockBridge } from "../../app/platform/tauri/browser-mock";
import {
	decodeScratchCreateResult,
	decodeScratchReadAllResult,
	decodeScratchVoid,
	encodeScratchWriteRequest,
	frozenScratchDiscardRequest,
	frozenScratchWriteInputs,
} from "../../app/platform/tauri/scratch-codec";

const tauri = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

const { createNativeBridge } = await import("../../app/platform/tauri/native");

const SCRATCH_ID = "00000000-0000-4000-8000-000000000101";
const PSW1_HEADER_BYTES = 44;

function encodePsl1(
	entries: readonly (readonly [string, Uint8Array])[],
): Uint8Array {
	const parts = [0x50, 0x53, 0x4c, 0x31];
	const count = new Uint8Array(4);
	new DataView(count.buffer).setUint32(0, entries.length, false);
	parts.push(...count);
	for (const [scratchId, content] of entries) {
		const length = new Uint8Array(4);
		new DataView(length.buffer).setUint32(0, content.byteLength, false);
		parts.push(...new TextEncoder().encode(scratchId), ...length, ...content);
	}
	return Uint8Array.from(parts);
}

describe("scratch codec", () => {
	it("strictly decodes a Rust-generated scratch id", () => {
		expect(decodeScratchCreateResult({ scratchId: SCRATCH_ID })).toEqual({
			scratchId: SCRATCH_ID,
		});
		for (const invalid of [
			{},
			{ scratchId: SCRATCH_ID, extra: true },
			{ scratchId: "not-an-id" },
			Object.create({ scratchId: SCRATCH_ID }),
		]) {
			expect(() => decodeScratchCreateResult(invalid)).toThrow();
		}
		expect(() =>
			decodeScratchCreateResult(new Proxy({ scratchId: SCRATCH_ID }, {})),
		).toThrow();
	});

	it("encodes an exact PSW1 frame and snapshots the caller bytes", () => {
		const source = Uint8Array.from([0, 0x41, 0xff]);
		const { content } = frozenScratchWriteInputs(SCRATCH_ID, source);
		source.fill(0);
		expect([...content]).toEqual([0, 0x41, 0xff]);

		const frame = encodeScratchWriteRequest(SCRATCH_ID, content);
		expect(new TextDecoder().decode(frame.slice(0, 4))).toBe("PSW1");
		expect(new TextDecoder().decode(frame.slice(4, 40))).toBe(SCRATCH_ID);
		expect(new DataView(frame.buffer).getUint32(40, false)).toBe(3);
		expect(Array.from(frame.slice(PSW1_HEADER_BYTES))).toEqual([0, 0x41, 0xff]);
	});

	it("rejects invalid ids, byte impostors and over-limit frames", () => {
		expect(() =>
			encodeScratchWriteRequest("not-an-id", new Uint8Array()),
		).toThrow(expect.objectContaining({ code: "INVALID_SCRATCH_ID" }));
		expect(() => encodeScratchWriteRequest(SCRATCH_ID, "bytes")).toThrow();
		expect(() =>
			encodeScratchWriteRequest(SCRATCH_ID, new Proxy(new Uint8Array([1]), {})),
		).toThrow();
		const maxContent = 8 * 1_024 * 1_024 - PSW1_HEADER_BYTES;
		expect(() =>
			encodeScratchWriteRequest(SCRATCH_ID, new Uint8Array(maxContent)),
		).not.toThrow();
		expect(() =>
			encodeScratchWriteRequest(SCRATCH_ID, new Uint8Array(maxContent + 1)),
		).toThrow(expect.objectContaining({ code: "SCRATCH_TOO_LARGE" }));
	});

	it("strictly decodes PSL1 ArrayBuffer and number-array transports", () => {
		const frame = encodePsl1([
			[SCRATCH_ID, Uint8Array.from([1, 2])],
			["00000000-0000-4000-8000-000000000102", new Uint8Array()],
		]);
		const expected = [
			{ scratchId: SCRATCH_ID, bytes: Uint8Array.from([1, 2]) },
			{
				scratchId: "00000000-0000-4000-8000-000000000102",
				bytes: new Uint8Array(),
			},
		];
		expect(decodeScratchReadAllResult(frame.buffer)).toEqual(expected);
		expect(decodeScratchReadAllResult([...frame])).toEqual(expected);
		expect(Object.isFrozen(decodeScratchReadAllResult(frame.buffer))).toBe(
			true,
		);
	});

	it("rejects malformed, duplicate, trailing and proxied PSL1 frames", () => {
		const frame = encodePsl1([[SCRATCH_ID, Uint8Array.from([1])]]);
		const badMagic = frame.slice();
		badMagic[0] = 0;
		expect(() => decodeScratchReadAllResult(badMagic.buffer)).toThrow();
		expect(() =>
			decodeScratchReadAllResult(frame.slice(0, -1).buffer),
		).toThrow();
		expect(() =>
			decodeScratchReadAllResult(Uint8Array.from([...frame, 0]).buffer),
		).toThrow();
		expect(() =>
			decodeScratchReadAllResult(
				encodePsl1([
					[SCRATCH_ID, Uint8Array.from([1])],
					[SCRATCH_ID, Uint8Array.from([2])],
				]).buffer,
			),
		).toThrow();
		expect(() =>
			decodeScratchReadAllResult(new Proxy([...frame], {})),
		).toThrow();
	});

	it("freezes the discard request and accepts only null void", () => {
		expect(frozenScratchDiscardRequest(SCRATCH_ID)).toEqual({
			scratchId: SCRATCH_ID,
		});
		expect(Object.isFrozen(frozenScratchDiscardRequest(SCRATCH_ID))).toBe(true);
		expect(decodeScratchVoid(null)).toBeUndefined();
		for (const invalid of [undefined, {}, [], 0]) {
			expect(() => decodeScratchVoid(invalid)).toThrow();
		}
	});
});

describe("native scratch bridge", () => {
	beforeEach(() => {
		tauri.invoke.mockReset();
		tauri.listen.mockReset();
	});

	it("uses exact JSON envelopes for create/read/discard and raw PSW1 for write", async () => {
		const readFrame = encodePsl1([[SCRATCH_ID, Uint8Array.from([7])]]);
		tauri.invoke
			.mockResolvedValueOnce({ scratchId: SCRATCH_ID })
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(readFrame.buffer)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null);
		const bridge = createNativeBridge();

		await expect(bridge.scratchCreate()).resolves.toEqual({
			scratchId: SCRATCH_ID,
		});
		await bridge.scratchWrite(SCRATCH_ID, Uint8Array.from([7]));
		await expect(bridge.scratchReadAll()).resolves.toEqual([
			{ scratchId: SCRATCH_ID, bytes: Uint8Array.from([7]) },
		]);
		await bridge.scratchDiscard(SCRATCH_ID);
		await bridge.scratchDiscardAll();

		expect(tauri.invoke.mock.calls[0]).toEqual([
			"scratch_create",
			{ request: {} },
		]);
		expect(tauri.invoke.mock.calls[1]?.[0]).toBe("scratch_write");
		expect(Object.getPrototypeOf(tauri.invoke.mock.calls[1]?.[1])).toBe(
			Uint8Array.prototype,
		);
		expect(tauri.invoke.mock.calls[2]).toEqual([
			"scratch_read_all",
			{ request: {} },
		]);
		expect(tauri.invoke.mock.calls[3]).toEqual([
			"scratch_discard",
			{ request: { scratchId: SCRATCH_ID } },
		]);
		expect(tauri.invoke.mock.calls[4]).toEqual([
			"scratch_discard_all",
			{ request: {} },
		]);
	});
});

describe("browser scratch bridge", () => {
	it("round trips isolated snapshots and idempotent discard", async () => {
		const bridge = createBrowserMockBridge();
		const { scratchId } = await bridge.scratchCreate();
		const source = Uint8Array.from([1, 2, 3]);
		await bridge.scratchWrite(scratchId, source);
		source.fill(0);
		const first = await bridge.scratchReadAll();
		expect(first).toEqual([{ scratchId, bytes: Uint8Array.from([1, 2, 3]) }]);
		first[0]!.bytes.fill(9);
		expect(await bridge.scratchReadAll()).toEqual([
			{ scratchId, bytes: Uint8Array.from([1, 2, 3]) },
		]);
		await bridge.scratchDiscard(scratchId);
		await bridge.scratchDiscard(scratchId);
		expect(await bridge.scratchReadAll()).toEqual([]);
	});
});
