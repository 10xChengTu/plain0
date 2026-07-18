import type {
	RuntimeInfo,
	WorkspaceDirectoryEntry,
	WorkspaceEntryKind,
	WorkspaceEntryStat,
	WorkspaceFileData,
	WorkspacePickResult,
	WorkspaceReadDirectoryResult,
	WorkspaceRoot,
	WorkspaceSnapshot,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_WORKSPACE_ROOTS = 256;
const MAX_DISPLAY_NAME_LENGTH = 255;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_ENTRY_NAME_BYTES = 1_024;
const MAX_DIRECTORY_NAME_PAYLOAD_BYTES = 2 * 1_024 * 1_024;
const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
const MAX_RELATIVE_PATH_BYTES = 4_096;
const MAX_RELATIVE_PATH_SEGMENTS = 256;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain contract.";
const WORKSPACE_ENTRY_KINDS = new Set<WorkspaceEntryKind>([
	"file",
	"directory",
	"symlink",
	"symlinkFile",
	"symlinkDirectory",
	"other",
]);
const utf8Encoder = new TextEncoder();

class IpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "IpcContractViolation";
	}
}

function violation(): never {
	throw new IpcContractViolation();
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

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function isSafeNonnegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWorkspaceEntryKind(value: unknown): value is WorkspaceEntryKind {
	return (
		typeof value === "string" &&
		WORKSPACE_ENTRY_KINDS.has(value as WorkspaceEntryKind)
	);
}

function isWellFormedUtf16(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) {
				return false;
			}
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) {
				return false;
			}
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function isWindowsReservedSegment(value: string): boolean {
	const rawStem = value.split(".", 1)[0] ?? value;
	const stem = rawStem.replace(/[a-z]/g, (character) =>
		String.fromCharCode(character.charCodeAt(0) - 32),
	);
	return (
		["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].includes(stem) ||
		/^(?:COM|LPT)(?:[1-9¹²³])$/u.test(stem)
	);
}

function hasForbiddenWorkspaceSegmentCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 0x1f || code === 0x7f || '/\\:<>"|?*'.includes(character)) {
			return true;
		}
	}
	return false;
}

export function isPortableWorkspaceEntryName(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= MAX_ENTRY_NAME_BYTES &&
		isPortableWorkspacePathSegment(value) &&
		utf8Encoder.encode(value).byteLength <= MAX_ENTRY_NAME_BYTES &&
		value.length > 0
	);
}

function isPortableWorkspacePathSegment(value: string): boolean {
	return (
		value.length > 0 &&
		isWellFormedUtf16(value) &&
		value !== "." &&
		value !== ".." &&
		!value.endsWith(".") &&
		!value.endsWith(" ") &&
		!hasForbiddenWorkspaceSegmentCharacter(value) &&
		!isWindowsReservedSegment(value)
	);
}

export function workspaceRelativePathSegments(
	relativePath: unknown,
): readonly string[] | undefined {
	if (
		typeof relativePath !== "string" ||
		relativePath.length > MAX_RELATIVE_PATH_BYTES ||
		!isWellFormedUtf16(relativePath) ||
		utf8Encoder.encode(relativePath).byteLength > MAX_RELATIVE_PATH_BYTES
	) {
		return undefined;
	}
	if (relativePath.length === 0) {
		return Object.freeze([]);
	}

	const segments = relativePath.split("/");
	if (
		segments.length > MAX_RELATIVE_PATH_SEGMENTS ||
		segments.some((segment) => !isPortableWorkspacePathSegment(segment))
	) {
		return undefined;
	}
	return Object.freeze(segments);
}

export function frozenWorkspaceEntryRequest(
	rootId: unknown,
	relativePath: unknown,
): Readonly<{ rootId: string; relativePath: string }> {
	if (!isUuidV4(rootId)) {
		return requestViolation(
			"ROOT_NOT_AUTHORIZED",
			"The workspace root is not authorized.",
		);
	}
	if (
		typeof relativePath !== "string" ||
		workspaceRelativePathSegments(relativePath) === undefined
	) {
		return requestViolation(
			"INVALID_RELATIVE_PATH",
			"The workspace-relative path is invalid.",
		);
	}
	return Object.freeze({ rootId, relativePath });
}

export function frozenWorkspaceCreateEntryRequest(
	rootId: unknown,
	relativePath: unknown,
): Readonly<{ rootId: string; relativePath: string }> {
	const request = frozenWorkspaceEntryRequest(rootId, relativePath);
	if (request.relativePath.length === 0) {
		return requestViolation(
			"ENTRY_TYPE_MISMATCH",
			"The workspace entry has an incompatible type.",
		);
	}
	return request;
}

export function frozenWorkspaceRenameRequest(
	rootId: unknown,
	sourcePath: unknown,
	targetPath: unknown,
): Readonly<{ rootId: string; sourcePath: string; targetPath: string }> {
	const source = frozenWorkspaceCreateEntryRequest(rootId, sourcePath);
	const target = frozenWorkspaceCreateEntryRequest(rootId, targetPath);
	if (source.relativePath === target.relativePath) {
		return requestViolation(
			"ENTRY_ALREADY_EXISTS",
			"The workspace entry already exists.",
		);
	}
	const sourceSegments = workspaceRelativePathSegments(source.relativePath);
	const targetSegments = workspaceRelativePathSegments(target.relativePath);
	if (sourceSegments === undefined || targetSegments === undefined) {
		return violation();
	}
	if (
		targetSegments.length > sourceSegments.length &&
		sourceSegments.every((segment, index) => targetSegments[index] === segment)
	) {
		return requestViolation(
			"WORKSPACE_CONFLICT",
			"The workspace rename conflicts with the source path.",
		);
	}
	return Object.freeze({
		rootId: source.rootId,
		sourcePath: source.relativePath,
		targetPath: target.relativePath,
	});
}

function compareUtf8(left: Uint8Array, right: Uint8Array): number {
	const length = Math.min(left.byteLength, right.byteLength);
	for (let index = 0; index < length; index += 1) {
		const difference = left[index]! - right[index]!;
		if (difference !== 0) {
			return difference;
		}
	}
	return left.byteLength - right.byteLength;
}

export function compareWorkspaceEntryNames(
	left: string,
	right: string,
): number {
	return compareUtf8(utf8Encoder.encode(left), utf8Encoder.encode(right));
}

function decodeWorkspaceRoot(value: unknown): WorkspaceRoot {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["rootId", "displayName", "uri"]) ||
		!isUuidV4(value.rootId) ||
		typeof value.displayName !== "string" ||
		value.displayName.length === 0 ||
		value.displayName.length > MAX_DISPLAY_NAME_LENGTH ||
		value.uri !== `plain-workspace://${value.rootId}/`
	) {
		return violation();
	}

	return Object.freeze({
		rootId: value.rootId,
		displayName: value.displayName,
		uri: value.uri,
	});
}

function decodeWorkspaceSnapshotValue(value: unknown): WorkspaceSnapshot {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["workspaceId", "revision", "roots"]) ||
		!isUuidV4(value.workspaceId) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		!Array.isArray(value.roots) ||
		value.roots.length > MAX_WORKSPACE_ROOTS
	) {
		return violation();
	}

	const roots = value.roots.map(decodeWorkspaceRoot);
	if (new Set(roots.map(({ rootId }) => rootId)).size !== roots.length) {
		return violation();
	}

	return Object.freeze({
		workspaceId: value.workspaceId,
		revision: value.revision,
		roots: Object.freeze(roots),
	});
}

function decodeWorkspaceEntryStatValue(value: unknown): WorkspaceEntryStat {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["kind", "size", "mtime", "ctime"]) ||
		!isWorkspaceEntryKind(value.kind) ||
		!isSafeNonnegativeInteger(value.size) ||
		!isSafeNonnegativeInteger(value.mtime) ||
		!isSafeNonnegativeInteger(value.ctime)
	) {
		return violation();
	}

	return Object.freeze({
		kind: value.kind,
		size: value.size,
		mtime: value.mtime,
		ctime: value.ctime,
	});
}

function decodeWorkspaceDirectoryEntry(
	value: unknown,
): WorkspaceDirectoryEntry {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["name", "kind"]) ||
		!isPortableWorkspaceEntryName(value.name) ||
		!isWorkspaceEntryKind(value.kind)
	) {
		return violation();
	}

	return Object.freeze({ name: value.name, kind: value.kind });
}

function decodeWorkspaceReadDirectoryValue(
	value: unknown,
	parentRelativePath: string,
): WorkspaceReadDirectoryResult {
	const parentSegments = workspaceRelativePathSegments(parentRelativePath);
	if (
		parentSegments === undefined ||
		!isPlainObject(value) ||
		!hasExactKeys(value, ["entries"]) ||
		!Array.isArray(value.entries) ||
		value.entries.length > MAX_DIRECTORY_ENTRIES
	) {
		return violation();
	}

	const entries = value.entries.map(decodeWorkspaceDirectoryEntry);
	const parentBytes = utf8Encoder.encode(parentRelativePath).byteLength;
	let namePayloadBytes = 0;
	let previousNameBytes: Uint8Array | undefined;
	for (const entry of entries) {
		const nameBytes = utf8Encoder.encode(entry.name);
		namePayloadBytes += nameBytes.byteLength;
		if (
			namePayloadBytes > MAX_DIRECTORY_NAME_PAYLOAD_BYTES ||
			parentSegments.length + 1 > MAX_RELATIVE_PATH_SEGMENTS ||
			parentBytes + (parentBytes === 0 ? 0 : 1) + nameBytes.byteLength >
				MAX_RELATIVE_PATH_BYTES ||
			(previousNameBytes !== undefined &&
				compareUtf8(previousNameBytes, nameBytes) >= 0)
		) {
			return violation();
		}
		previousNameBytes = nameBytes;
	}
	if (new Set(entries.map(({ name }) => name)).size !== entries.length) {
		return violation();
	}

	return Object.freeze({ entries: Object.freeze(entries) });
}

function decodeStrictByteArray(value: unknown[]): Uint8Array {
	if (
		Object.getPrototypeOf(value) !== Array.prototype ||
		value.length > MAX_FILE_BYTES
	) {
		return violation();
	}

	const bytes = new Uint8Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			typeof descriptor.value !== "number" ||
			!Number.isInteger(descriptor.value) ||
			descriptor.value < 0 ||
			descriptor.value > 255
		) {
			return violation();
		}
		bytes[index] = descriptor.value;
	}
	return bytes;
}

function frozenWorkspaceFileDataFromBytes(
	input: Uint8Array,
): WorkspaceFileData {
	if (input.byteLength > MAX_FILE_BYTES) {
		return violation();
	}
	const bytes = input.slice();
	return Object.freeze({
		byteLength: bytes.byteLength,
		copy: () => bytes.slice(),
	});
}

function sanitizedDecode<T>(decoder: () => T): T {
	try {
		return decoder();
	} catch {
		return violation();
	}
}

export function decodeRuntimeInfo(value: unknown): RuntimeInfo {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["application", "ipcVersion", "runtime"]) ||
			value.application !== "Plain" ||
			value.ipcVersion !== 1 ||
			value.runtime !== "tauri"
		) {
			return violation();
		}

		return Object.freeze({
			application: value.application,
			ipcVersion: value.ipcVersion,
			runtime: value.runtime,
		});
	});
}

export function decodeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
	return sanitizedDecode(() => decodeWorkspaceSnapshotValue(value));
}

export function decodeWorkspacePickResult(value: unknown): WorkspacePickResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["status", "snapshot"]) ||
			(value.status !== "selected" && value.status !== "cancelled")
		) {
			return violation();
		}

		return Object.freeze({
			status: value.status,
			snapshot: decodeWorkspaceSnapshotValue(value.snapshot),
		});
	});
}

export function decodeWorkspaceEntryStat(value: unknown): WorkspaceEntryStat {
	return sanitizedDecode(() => decodeWorkspaceEntryStatValue(value));
}

export function decodeWorkspaceReadDirectory(
	value: unknown,
	parentRelativePath: string,
): WorkspaceReadDirectoryResult {
	return sanitizedDecode(() =>
		decodeWorkspaceReadDirectoryValue(value, parentRelativePath),
	);
}

export function decodeWorkspaceFileData(value: unknown): WorkspaceFileData {
	return sanitizedDecode(() => {
		let bytes: Uint8Array;
		if (value instanceof ArrayBuffer) {
			if (value.byteLength > MAX_FILE_BYTES) {
				return violation();
			}
			bytes = new Uint8Array(value);
		} else if (Array.isArray(value)) {
			bytes = decodeStrictByteArray(value);
		} else {
			return violation();
		}
		return frozenWorkspaceFileDataFromBytes(bytes);
	});
}

export function decodeWorkspaceVoid(value: unknown): void {
	return sanitizedDecode(() => {
		if (value !== null) {
			return violation();
		}
	});
}

export function frozenWorkspaceSnapshot(
	workspaceId: string,
	revision: number,
	roots: readonly WorkspaceRoot[],
): WorkspaceSnapshot {
	return decodeWorkspaceSnapshot({ workspaceId, revision, roots });
}

export function frozenWorkspacePickResult(
	status: WorkspacePickResult["status"],
	snapshot: WorkspaceSnapshot,
): WorkspacePickResult {
	return decodeWorkspacePickResult({ status, snapshot });
}

export function frozenWorkspaceEntryStat(
	kind: WorkspaceEntryKind,
	size: number,
	mtime: number,
	ctime: number,
): WorkspaceEntryStat {
	return decodeWorkspaceEntryStat({ kind, size, mtime, ctime });
}

export function frozenWorkspaceReadDirectory(
	entries: readonly WorkspaceDirectoryEntry[],
	parentRelativePath: string,
): WorkspaceReadDirectoryResult {
	return decodeWorkspaceReadDirectory({ entries }, parentRelativePath);
}

export function frozenWorkspaceFileData(
	bytes: ArrayBuffer | readonly number[] | Uint8Array,
): WorkspaceFileData {
	if (bytes instanceof Uint8Array) {
		return frozenWorkspaceFileDataFromBytes(bytes);
	}
	return decodeWorkspaceFileData(bytes);
}
