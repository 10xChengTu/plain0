import type { BackupEntry } from "./contracts";

const MAX_BACKUP_KEY_BYTES = 128;
const MAX_BACKUP_ENTRY_BYTES = 8 * 1_024 * 1_024;
const MAX_BACKUP_ENTRIES = 4_096;
const PLBK_HEADER_BYTES = 9;
const PLBA_HEADER_BYTES = 8;
/** The wire frame is capped at 8 MiB including its header and key bytes. */
const MAX_BACKUP_FRAME_BYTES = 8 * 1_024 * 1_024;
const BACKUP_KEY_PATTERN = /^[a-z0-9-]{1,128}$/;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain backup contract.";

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
const typedArraySet = Uint8Array.prototype.set;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	"byteLength",
)?.get;
const arrayBufferSlice = ArrayBuffer.prototype.slice;

class BackupIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "BackupIpcContractViolation";
	}
}

function violation(): never {
	throw new BackupIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar own data
	// property. Structured clone can therefore serve only as a Proxy brand
	// check and cannot traverse attacker-controlled nested payloads.
	structuredClone(value);
}

function isBackupKey(value: unknown): value is string {
	return typeof value === "string" && BACKUP_KEY_PATTERN.test(value);
}

function frozenBackupKeyOrViolation(key: unknown): string {
	if (!isBackupKey(key)) {
		return requestViolation("INVALID_BACKUP_KEY", "The backup key is invalid.");
	}
	return key;
}

export function frozenBackupDiscardRequest(
	key: unknown,
): Readonly<{ key: string }> {
	return Object.freeze({ key: frozenBackupKeyOrViolation(key) });
}

/**
 * Shared client-side "no workspace is open yet" rejection. The native
 * command reports the same code from the Rust domain; the browser mock
 * throws this directly so both transports agree on the closed error set.
 */
export function backupUnavailable(): never {
	return requestViolation(
		"BACKUP_UNAVAILABLE",
		"The backup store is not available for this window.",
	);
}

function backupContentSnapshot(value: unknown): Uint8Array {
	let buffer: ArrayBuffer;
	let byteLength: number;
	let byteOffset: number;
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
		buffer = Reflect.apply(typedArrayBufferGetter, value, []) as ArrayBuffer;
		byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
		byteOffset = Reflect.apply(typedArrayByteOffsetGetter, value, []) as number;
		if (
			Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0 ||
			!Number.isSafeInteger(byteOffset) ||
			byteOffset < 0
		) {
			return violation();
		}
		const bufferByteLength = Reflect.apply(
			arrayBufferByteLengthGetter,
			buffer,
			[],
		) as number;
		if (
			!Number.isSafeInteger(bufferByteLength) ||
			byteOffset + byteLength > bufferByteLength
		) {
			return violation();
		}
		// A zero-length detached ArrayBuffer otherwise looks identical to a
		// valid empty view through the length getters.
		Reflect.apply(arrayBufferSlice, buffer, [0, 0]);
	} catch {
		return violation();
	}

	if (byteLength > MAX_BACKUP_ENTRY_BYTES) {
		return requestViolation(
			"BACKUP_TOO_LARGE",
			"The backup payload exceeds the supported size limit.",
		);
	}

	try {
		// Only intrinsic byteOffset/byteLength bytes cross the IPC boundary; a
		// private exact Uint8Array snapshot is the complete raw request body.
		const snapshot = new Uint8Array(byteLength);
		Reflect.apply(typedArraySet, snapshot, [value, 0]);
		return snapshot;
	} catch {
		return violation();
	}
}

/**
 * Validates a `backup_write` request's own-data key and content snapshot
 * without framing them. Shared by the native encoder (which frames the
 * result for IPC) and the browser mock (which stores the snapshot directly),
 * so both transports reject the same hostile inputs identically.
 */
export function frozenBackupWriteInputs(
	key: unknown,
	bytes: unknown,
): Readonly<{ key: string; content: Uint8Array }> {
	const validKey = frozenBackupKeyOrViolation(key);
	const content = backupContentSnapshot(bytes);
	if (content.byteLength > MAX_BACKUP_ENTRY_BYTES) {
		return requestViolation(
			"BACKUP_TOO_LARGE",
			"The backup payload exceeds the supported size limit.",
		);
	}
	return Object.freeze({ key: validKey, content });
}

/**
 * Encodes a `backup_write` request as a `PLBK` frame: magic (4 bytes) + key
 * length (1 byte) + content length (4 bytes, big-endian) + key bytes +
 * content bytes. There is no version token: a backup write always publishes
 * over whatever previously existed for the same key.
 */
export function encodeBackupWriteRequest(
	key: unknown,
	bytes: unknown,
): Uint8Array {
	const { key: validKey, content } = frozenBackupWriteInputs(key, bytes);
	const keyBytes = new TextEncoder().encode(validKey);
	if (keyBytes.byteLength < 1 || keyBytes.byteLength > MAX_BACKUP_KEY_BYTES) {
		return violation();
	}

	const frameLength =
		PLBK_HEADER_BYTES + keyBytes.byteLength + content.byteLength;
	if (frameLength > MAX_BACKUP_FRAME_BYTES) {
		return requestViolation(
			"BACKUP_TOO_LARGE",
			"The backup payload exceeds the supported size limit.",
		);
	}

	const frame = new Uint8Array(frameLength);
	const view = new DataView(frame.buffer);
	frame.set([0x50, 0x4c, 0x42, 0x4b], 0); // "PLBK"
	view.setUint8(4, keyBytes.byteLength);
	view.setUint32(5, content.byteLength, false);
	frame.set(keyBytes, PLBK_HEADER_BYTES);
	frame.set(content, PLBK_HEADER_BYTES + keyBytes.byteLength);
	return frame;
}

export function decodeBackupVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

function exactBackupFrameBytes(value: unknown): Uint8Array {
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) {
			return violation();
		}
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
		if (
			lengthDescriptor === undefined ||
			!("value" in lengthDescriptor) ||
			!Number.isSafeInteger(lengthDescriptor.value) ||
			lengthDescriptor.value < PLBA_HEADER_BYTES ||
			lengthDescriptor.value > MAX_BACKUP_FRAME_BYTES * MAX_BACKUP_ENTRIES
		) {
			return violation();
		}
		const length = lengthDescriptor.value as number;
		try {
			const bytes = new Uint8Array(length);
			for (let index = 0; index < length; index += 1) {
				const element = value[index];
				if (
					typeof element !== "number" ||
					!Number.isInteger(element) ||
					element < 0 ||
					element > 255
				) {
					return violation();
				}
				bytes[index] = element;
			}
			rejectProxyObject(value);
			return bytes;
		} catch {
			return violation();
		}
	}

	if (
		typeof value !== "object" ||
		value === null ||
		Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
		Reflect.ownKeys(value).length !== 0
	) {
		return violation();
	}
	const byteLengthGetter = Object.getOwnPropertyDescriptor(
		ArrayBuffer.prototype,
		"byteLength",
	)?.get;
	if (byteLengthGetter === undefined) {
		return violation();
	}
	const byteLength = Reflect.apply(byteLengthGetter, value, []);
	if (
		typeof byteLength !== "number" ||
		!Number.isSafeInteger(byteLength) ||
		byteLength < PLBA_HEADER_BYTES
	) {
		return violation();
	}
	const snapshot = new Uint8Array(byteLength);
	snapshot.set(new Uint8Array(value as ArrayBuffer));
	return snapshot;
}

/**
 * Decodes a `backup_read_all` response frame: `PLBA` magic (4 bytes) + entry
 * count (4 bytes, big-endian), then for each entry: key length (1 byte) +
 * content length (4 bytes, big-endian) + key bytes + content bytes.
 */
export function decodeBackupReadAllResult(
	value: unknown,
): readonly BackupEntry[] {
	const frame = exactBackupFrameBytes(value);
	if (
		frame.byteLength < PLBA_HEADER_BYTES ||
		frame[0] !== 0x50 ||
		frame[1] !== 0x4c ||
		frame[2] !== 0x42 ||
		frame[3] !== 0x41
	) {
		return violation();
	}
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const entryCount = view.getUint32(4, false);
	if (entryCount > MAX_BACKUP_ENTRIES) {
		return violation();
	}

	const entries: BackupEntry[] = [];
	const seenKeys = new Set<string>();
	let offset = PLBA_HEADER_BYTES;
	for (let index = 0; index < entryCount; index += 1) {
		if (offset + 5 > frame.byteLength) {
			return violation();
		}
		const keyLength = frame[offset]!;
		const contentLength = view.getUint32(offset + 1, false);
		offset += 5;
		if (
			keyLength < 1 ||
			keyLength > MAX_BACKUP_KEY_BYTES ||
			contentLength > MAX_BACKUP_ENTRY_BYTES ||
			offset + keyLength + contentLength > frame.byteLength
		) {
			return violation();
		}
		const keyBytes = frame.slice(offset, offset + keyLength);
		offset += keyLength;
		const content = frame.slice(offset, offset + contentLength);
		offset += contentLength;

		const key = new TextDecoder("utf-8", { fatal: true }).decode(keyBytes);
		if (!isBackupKey(key) || seenKeys.has(key)) {
			return violation();
		}
		seenKeys.add(key);
		entries.push(Object.freeze({ key, bytes: content }));
	}
	if (offset !== frame.byteLength) {
		return violation();
	}
	return Object.freeze(entries);
}
