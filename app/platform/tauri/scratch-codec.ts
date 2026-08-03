import type { ScratchCreateResult, ScratchEntry } from "./contracts";

const SCRATCH_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SCRATCH_ID_BYTES = 36;
const PSW1_HEADER_BYTES = 4 + SCRATCH_ID_BYTES + 4;
const PSL1_HEADER_BYTES = 8;
const MAX_SCRATCH_ENTRY_BYTES = 8 * 1_024 * 1_024;
const MAX_SCRATCH_ENTRIES = 4_096;
const MAX_SCRATCH_FRAME_BYTES = 8 * 1_024 * 1_024;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain scratch contract.";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	"buffer",
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	"byteLength",
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	"byteOffset",
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"byteLength",
)?.get;

class ScratchIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "ScratchIpcContractViolation";
	}
}

function violation(): never {
	throw new ScratchIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function scratchIdOrViolation(value: unknown): string {
	if (typeof value !== "string" || !SCRATCH_ID_PATTERN.test(value)) {
		return requestViolation(
			"INVALID_SCRATCH_ID",
			"The scratch identifier is invalid.",
		);
	}
	return value;
}

function rejectProxyObject(value: object): void {
	structuredClone(value);
}

function exactObject(value: unknown, keys: readonly string[]): object {
	if (
		typeof value !== "object" ||
		value === null ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return violation();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(descriptors).length !== keys.length ||
		keys.some((key) => {
			const descriptor = descriptors[key];
			return (
				descriptor === undefined ||
				!("value" in descriptor) ||
				descriptor.get !== undefined ||
				descriptor.set !== undefined
			);
		})
	) {
		return violation();
	}
	rejectProxyObject(value);
	return value;
}

function scratchContentSnapshot(value: unknown): Uint8Array {
	try {
		if (
			typeof value !== "object" ||
			value === null ||
			Object.getPrototypeOf(value) !== Uint8Array.prototype ||
			typedArrayBufferGetter === undefined ||
			typedArrayByteLengthGetter === undefined ||
			typedArrayByteOffsetGetter === undefined ||
			arrayBufferByteLengthGetter === undefined
		) {
			return violation();
		}
		const buffer = Reflect.apply(
			typedArrayBufferGetter,
			value,
			[],
		) as ArrayBuffer;
		const byteLength = Reflect.apply(
			typedArrayByteLengthGetter,
			value,
			[],
		) as number;
		const byteOffset = Reflect.apply(
			typedArrayByteOffsetGetter,
			value,
			[],
		) as number;
		const bufferLength = Reflect.apply(
			arrayBufferByteLengthGetter,
			buffer,
			[],
		) as number;
		if (
			!Number.isSafeInteger(byteLength) ||
			!Number.isSafeInteger(byteOffset) ||
			byteLength < 0 ||
			byteOffset < 0 ||
			byteOffset + byteLength > bufferLength
		) {
			return violation();
		}
		if (byteLength > MAX_SCRATCH_ENTRY_BYTES) {
			return requestViolation(
				"SCRATCH_TOO_LARGE",
				"The scratch payload exceeds the supported size limit.",
			);
		}
		return Uint8Array.from(value as Uint8Array);
	} catch {
		return violation();
	}
}

export function decodeScratchCreateResult(value: unknown): ScratchCreateResult {
	const object = exactObject(value, ["scratchId"]);
	return Object.freeze({
		scratchId: scratchIdOrViolation(
			(object as { scratchId: unknown }).scratchId,
		),
	});
}

export function frozenScratchDiscardRequest(
	scratchId: unknown,
): Readonly<{ scratchId: string }> {
	return Object.freeze({ scratchId: scratchIdOrViolation(scratchId) });
}

export function frozenScratchWriteInputs(
	scratchId: unknown,
	bytes: unknown,
): Readonly<{ scratchId: string; content: Uint8Array }> {
	return Object.freeze({
		scratchId: scratchIdOrViolation(scratchId),
		content: scratchContentSnapshot(bytes),
	});
}

export function encodeScratchWriteRequest(
	scratchId: unknown,
	bytes: unknown,
): Uint8Array {
	const validated = frozenScratchWriteInputs(scratchId, bytes);
	const idBytes = new TextEncoder().encode(validated.scratchId);
	const frameLength = PSW1_HEADER_BYTES + validated.content.byteLength;
	if (
		idBytes.byteLength !== SCRATCH_ID_BYTES ||
		frameLength > MAX_SCRATCH_FRAME_BYTES
	) {
		return requestViolation(
			"SCRATCH_TOO_LARGE",
			"The scratch payload exceeds the supported size limit.",
		);
	}
	const frame = new Uint8Array(frameLength);
	const view = new DataView(frame.buffer);
	frame.set([0x50, 0x53, 0x57, 0x31], 0); // PSW1
	frame.set(idBytes, 4);
	view.setUint32(4 + SCRATCH_ID_BYTES, validated.content.byteLength, false);
	frame.set(validated.content, PSW1_HEADER_BYTES);
	return frame;
}

function exactFrameBytes(value: unknown): Uint8Array {
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) return violation();
		const length = value.length;
		if (
			!Number.isSafeInteger(length) ||
			length < PSL1_HEADER_BYTES ||
			length > MAX_SCRATCH_FRAME_BYTES * MAX_SCRATCH_ENTRIES
		) {
			return violation();
		}
		const bytes = new Uint8Array(length);
		for (let index = 0; index < length; index += 1) {
			const byte = value[index];
			if (
				typeof byte !== "number" ||
				!Number.isInteger(byte) ||
				byte < 0 ||
				byte > 255
			) {
				return violation();
			}
			bytes[index] = byte;
		}
		rejectProxyObject(value);
		return bytes;
	}
	if (
		typeof value !== "object" ||
		value === null ||
		Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
		Reflect.ownKeys(value).length !== 0 ||
		arrayBufferByteLengthGetter === undefined
	) {
		return violation();
	}
	const byteLength = Reflect.apply(arrayBufferByteLengthGetter, value, []);
	if (
		typeof byteLength !== "number" ||
		!Number.isSafeInteger(byteLength) ||
		byteLength < PSL1_HEADER_BYTES ||
		byteLength > MAX_SCRATCH_FRAME_BYTES * MAX_SCRATCH_ENTRIES
	) {
		return violation();
	}
	return Uint8Array.from(new Uint8Array(value as ArrayBuffer));
}

export function decodeScratchReadAllResult(
	value: unknown,
): readonly ScratchEntry[] {
	const frame = exactFrameBytes(value);
	if (
		frame[0] !== 0x50 ||
		frame[1] !== 0x53 ||
		frame[2] !== 0x4c ||
		frame[3] !== 0x31
	) {
		return violation();
	}
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const count = view.getUint32(4, false);
	if (count > MAX_SCRATCH_ENTRIES) return violation();
	const entries: ScratchEntry[] = [];
	const seen = new Set<string>();
	let offset = PSL1_HEADER_BYTES;
	for (let index = 0; index < count; index += 1) {
		if (offset + SCRATCH_ID_BYTES + 4 > frame.byteLength) {
			return violation();
		}
		let scratchId: string;
		try {
			scratchId = new TextDecoder("utf-8", { fatal: true }).decode(
				frame.slice(offset, offset + SCRATCH_ID_BYTES),
			);
		} catch {
			return violation();
		}
		offset += SCRATCH_ID_BYTES;
		const contentLength = view.getUint32(offset, false);
		offset += 4;
		if (
			contentLength > MAX_SCRATCH_ENTRY_BYTES ||
			offset + contentLength > frame.byteLength
		) {
			return violation();
		}
		scratchId = scratchIdOrViolation(scratchId);
		if (seen.has(scratchId)) return violation();
		seen.add(scratchId);
		const bytes = frame.slice(offset, offset + contentLength);
		offset += contentLength;
		entries.push(Object.freeze({ scratchId, bytes }));
	}
	if (offset !== frame.byteLength) return violation();
	return Object.freeze(entries);
}

export function decodeScratchVoid(value: unknown): void {
	if (value !== null) violation();
}
