import type {
	TerminalDataEvent,
	TerminalExitEvent,
	TerminalStartResult,
	WorkspaceTrustState,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Mirrors `terminal::dto::MAX_TERMINAL_DIMENSION`. */
const MAX_TERMINAL_DIMENSION = 2_000;
/** Mirrors `terminal::dto::MAX_TERMINAL_INPUT_BYTES`. */
const MAX_TERMINAL_INPUT_BYTES = 1_024 * 1_024;
/** `byteCount`'s Rust wire type is `u32`; anything outside this range could
 * never deserialize there, so it is rejected here rather than sent. */
const MAX_U32 = 0xff_ff_ff_ff;
/** Mirrors `terminal::service::TERMINAL_READ_BUFFER_BYTES` (8192): the
 * largest a single pty read — and therefore a single `TerminalDataEvent`
 * chunk — can ever be. Expressed here as the base64-encoded length this
 * decoder actually measures: `ceil(8192 / 3) * 4 = 10924` characters. */
const MAX_TERMINAL_DATA_BASE64_LENGTH = 10_924;
const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain terminal contract.";

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

class TerminalIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "TerminalIpcContractViolation";
	}
}

function violation(): never {
	throw new TerminalIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function invalidTerminalRequest(): never {
	return requestViolation(
		"INVALID_TERMINAL_REQUEST",
		"The terminal request is invalid.",
	);
}

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar own data
	// property. Structured clone can therefore serve only as a Proxy brand
	// check and cannot traverse attacker-controlled nested payloads.
	structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const keys = Reflect.ownKeys(value);
	return (
		keys.length === expected.length &&
		keys.every((key) => typeof key === "string" && expected.includes(key))
	);
}

function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function frozenSessionId(value: unknown): string {
	if (!isUuidV4(value)) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenCwd(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string" || value.length === 0) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenDimension(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value <= 0 ||
		value > MAX_TERMINAL_DIMENSION
	) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenByteCount(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > MAX_U32
	) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenImmediate(value: unknown): boolean {
	if (typeof value !== "boolean") {
		return invalidTerminalRequest();
	}
	return value;
}

/**
 * Validates and snapshots an own-data `Uint8Array` the exact way
 * `backup-codec.ts`'s `backupContentSnapshot` does (typed-array-prototype
 * descriptor reads rather than direct property access, so a Proxy or
 * poisoned-prototype value cannot lie about its own length/backing buffer).
 * Rejects anything that is not a genuine, non-detached `Uint8Array`.
 */
function terminalInputSnapshot(value: unknown): Uint8Array {
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
			return invalidTerminalRequest();
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
			return invalidTerminalRequest();
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
			return invalidTerminalRequest();
		}
		// A zero-length detached ArrayBuffer otherwise looks identical to a
		// valid empty view through the length getters.
		Reflect.apply(arrayBufferSlice, buffer, [0, 0]);
	} catch {
		return invalidTerminalRequest();
	}

	if (byteLength > MAX_TERMINAL_INPUT_BYTES) {
		return invalidTerminalRequest();
	}
	try {
		const snapshot = new Uint8Array(byteLength);
		Reflect.apply(typedArraySet, snapshot, [value, 0]);
		return snapshot;
	} catch {
		return invalidTerminalRequest();
	}
}

/**
 * Validates and freezes a `terminal_start` request's own-data fields,
 * independent of transport — shared by the native encoder (which forwards
 * the frozen object as-is to `invoke`) and the browser mock, so both
 * transports reject the same hostile inputs identically.
 */
export function frozenTerminalStartRequest(
	cwd: unknown,
	cols: unknown,
	rows: unknown,
): Readonly<{ cwd: string | null; cols: number; rows: number }> {
	return Object.freeze({
		cwd: frozenCwd(cwd),
		cols: frozenDimension(cols),
		rows: frozenDimension(rows),
	});
}

/**
 * Validates a `terminal_input` request and produces the exact wire shape
 * `TerminalInputRequest::data: Vec<u8>` expects today: a dense JSON
 * `number[]` (see `src-tauri/src/terminal/dto.rs`'s module doc — this is the
 * one placeholder encoding this slice deliberately leaves as-is, since input
 * volume/frequency is nowhere near the streamed-output side this slice's
 * transport-efficiency evaluation was about; see this slice's final report).
 */
export function frozenTerminalInputRequest(
	sessionId: unknown,
	data: unknown,
): Readonly<{ sessionId: string; data: readonly number[] }> {
	const validSessionId = frozenSessionId(sessionId);
	const snapshot = terminalInputSnapshot(data);
	return Object.freeze({
		sessionId: validSessionId,
		data: Object.freeze(Array.from(snapshot)),
	});
}

export function frozenTerminalResizeRequest(
	sessionId: unknown,
	cols: unknown,
	rows: unknown,
): Readonly<{ sessionId: string; cols: number; rows: number }> {
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		cols: frozenDimension(cols),
		rows: frozenDimension(rows),
	});
}

export function frozenTerminalAckRequest(
	sessionId: unknown,
	byteCount: unknown,
): Readonly<{ sessionId: string; byteCount: number }> {
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		byteCount: frozenByteCount(byteCount),
	});
}

export function frozenTerminalKillRequest(
	sessionId: unknown,
	immediate: unknown,
): Readonly<{ sessionId: string; immediate: boolean }> {
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		immediate: frozenImmediate(immediate),
	});
}

/**
 * Decodes a `terminal_start` response: an own-data, exactly `{ sessionId }`
 * object.
 */
export function decodeTerminalStartResult(value: unknown): TerminalStartResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["sessionId"])) {
		return violation();
	}
	if (!isUuidV4(value.sessionId)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ sessionId: value.sessionId });
}

/** Decodes the `void` (JSON `null`) result of `terminal_input`/
 * `terminal_resize`/`terminal_ack`/`terminal_kill`. */
export function decodeTerminalVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

function decodeBase64Bytes(value: unknown): Uint8Array {
	if (
		typeof value !== "string" ||
		value.length > MAX_TERMINAL_DATA_BASE64_LENGTH ||
		value.length % 4 !== 0 ||
		!BASE64_PATTERN.test(value)
	) {
		return violation();
	}
	let binary: string;
	try {
		binary = atob(value);
	} catch {
		return violation();
	}
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/**
 * Decodes a `plain://terminal-data` event payload: an own-data, exactly
 * `{ sessionId, sequence, bytes }` object, `bytes` base64-decoded into a
 * fresh `Uint8Array` snapshot — see `TerminalDataEvent`'s doc comment in
 * `contracts.ts` for why base64 rather than `ArrayBuffer`/`number[]`.
 */
export function decodeTerminalDataEvent(value: unknown): TerminalDataEvent {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "sequence", "bytes"])
	) {
		return violation();
	}
	if (!isUuidV4(value.sessionId)) {
		return violation();
	}
	if (
		typeof value.sequence !== "number" ||
		!Number.isSafeInteger(value.sequence) ||
		value.sequence < 0
	) {
		return violation();
	}
	const bytes = decodeBase64Bytes(value.bytes);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		sessionId: value.sessionId,
		sequence: value.sequence,
		bytes,
	});
}

/**
 * Builds a frozen `TerminalDataEvent` directly from an already-`Uint8Array`
 * payload, for the browser mock — which has no wire boundary to round-trip
 * through (there is no base64 layer to encode into and back out of, unlike
 * `TerminalDataEvent.bytes`'s real transport). Mirrors
 * `search-codec.ts`'s `frozenWorkspaceSearchFilesResult`'s own
 * "for-the-mock, skips the wire encoding" precedent.
 */
export function frozenTerminalDataEvent(
	sessionId: unknown,
	sequence: unknown,
	bytes: unknown,
): TerminalDataEvent {
	if (!isUuidV4(sessionId)) {
		return violation();
	}
	if (
		typeof sequence !== "number" ||
		!Number.isSafeInteger(sequence) ||
		sequence < 0
	) {
		return violation();
	}
	const snapshot = terminalInputSnapshot(bytes);
	return Object.freeze({ sessionId, sequence, bytes: snapshot });
}

/**
 * Builds a frozen `TerminalExitEvent` directly, for the browser mock — same
 * "no wire boundary to round-trip through" rationale as
 * [`frozenTerminalDataEvent`].
 */
export function frozenTerminalExitEvent(
	sessionId: unknown,
	exitCode: unknown,
): TerminalExitEvent {
	if (!isUuidV4(sessionId)) {
		return violation();
	}
	if (
		typeof exitCode !== "number" ||
		!Number.isSafeInteger(exitCode) ||
		exitCode < 0 ||
		exitCode > MAX_U32
	) {
		return violation();
	}
	return Object.freeze({ sessionId, exitCode });
}

/**
 * Decodes a `plain://terminal-exit` event payload: an own-data, exactly
 * `{ sessionId, exitCode }` object.
 */
export function decodeTerminalExitEvent(value: unknown): TerminalExitEvent {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "exitCode"])
	) {
		return violation();
	}
	if (!isUuidV4(value.sessionId)) {
		return violation();
	}
	if (
		typeof value.exitCode !== "number" ||
		!Number.isSafeInteger(value.exitCode) ||
		value.exitCode < 0 ||
		value.exitCode > MAX_U32
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		sessionId: value.sessionId,
		exitCode: value.exitCode,
	});
}

/**
 * Decodes a `workspace_trust_state`/`workspace_trust_grant` response: an
 * own-data, exactly `{ trusted }` object.
 */
export function decodeWorkspaceTrustState(value: unknown): WorkspaceTrustState {
	if (!isPlainObject(value) || !hasExactKeys(value, ["trusted"])) {
		return violation();
	}
	if (typeof value.trusted !== "boolean") {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ trusted: value.trusted });
}

/** Decodes the `void` (JSON `null`) result of `workspace_trust_revoke`. */
export function decodeWorkspaceTrustVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}
