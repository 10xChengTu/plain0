import type {
	CommandError,
	RuntimeInfo,
	WorkspaceCapabilities,
	WorkspaceCommitDeleteEntryRequest,
	WorkspaceDeleteBatchPlan,
	WorkspaceDeleteBatchPlanEntry,
	WorkspaceDeleteBatchRequest,
	WorkspaceDeleteEntryKind,
	WorkspaceDeleteEntryRequest,
	WorkspaceDeleteIncompleteReason,
	WorkspaceDeleteResult,
	WorkspaceDirectoryEntry,
	WorkspaceCopyRequest,
	WorkspaceEntryKind,
	WorkspaceEntryStat,
	WorkspaceFileData,
	WorkspaceMoveIncompleteReason,
	WorkspaceMoveRequest,
	WorkspaceMoveResult,
	WorkspacePrepareDeleteRequest,
	WorkspacePickResult,
	WorkspaceReadDirectoryResult,
	WorkspaceReadFileResult,
	WorkspaceRoot,
	WorkspaceSnapshot,
	WorkspaceWatchPendingRoot,
	WorkspaceWatchSyncRequest,
	WorkspaceWatchSyncResult,
	WorkspaceWatchWakeEvent,
	WorkspaceWriteResult,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_WORKSPACE_ROOTS = 256;
const MAX_WORKSPACE_WATCH_GENERATION = 0xffff_ffff;
const MAX_DISPLAY_NAME_LENGTH = 255;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_ENTRY_NAME_BYTES = 1_024;
const MAX_DIRECTORY_NAME_PAYLOAD_BYTES = 2 * 1_024 * 1_024;
const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
const MAX_MOVE_REMOVED_ENTRIES = 10_000;
const MAX_DELETE_BATCH_ENTRIES = 64;
const MAX_DELETE_DESCENDANT_ENTRIES = 10_000;
const MAX_RELATIVE_PATH_BYTES = 4_096;
const MAX_RELATIVE_PATH_SEGMENTS = 256;
const PLR1_HEADER_BYTES = 36;
const PLW1_HEADER_BYTES = 14;
const WORKSPACE_VERSION_BYTES = 68;
const MAX_PLR1_FRAME_BYTES =
	PLR1_HEADER_BYTES + WORKSPACE_VERSION_BYTES + MAX_FILE_BYTES;
const WORKSPACE_VERSION_PATTERN = /^wv1:[0-9a-f]{64}$/u;
const MAX_JS_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_COMMAND_ERROR_MESSAGE_LENGTH = 512;
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
export const WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES = Object.freeze([
	"ROOT_NOT_AUTHORIZED",
	"ROOT_UNAVAILABLE",
	"PERMISSION_DENIED",
	"FILE_TOO_LARGE",
	"INVALID_WORKSPACE_WRITE_REQUEST",
	"WORKSPACE_CONFLICT",
	"WORKSPACE_FILE_MODIFIED",
	"WORKSPACE_WRITE_UNSUPPORTED",
	"WORKSPACE_WINDOW_CLOSED",
	"IO_FAILED",
] as const);
const WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET = new Set<string>(
	WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES,
);
const WORKSPACE_MOVE_INCOMPLETE_REASONS =
	new Set<WorkspaceMoveIncompleteReason>([
		"sourceChanged",
		"targetChanged",
		"sourceUnverifiable",
		"targetUnverifiable",
		"deleteFailed",
	]);
const WORKSPACE_DELETE_ENTRY_KINDS = new Set<WorkspaceDeleteEntryKind>([
	"file",
	"directory",
	"symlink",
]);
const WORKSPACE_DELETE_INCOMPLETE_REASONS =
	new Set<WorkspaceDeleteIncompleteReason>([
		"entryChanged",
		"entryUnverifiable",
		"deleteFailed",
	]);
const utf8Encoder = new TextEncoder();
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
	if (keys.length !== expected.length) {
		return false;
	}
	for (const key of keys) {
		if (typeof key !== "string") {
			return false;
		}
		let expectedKey = false;
		for (let index = 0; index < expected.length; index += 1) {
			if (expected[index] === key) {
				expectedKey = true;
				break;
			}
		}
		if (!expectedKey) {
			return false;
		}
	}
	return true;
}

function ownPlainDataSnapshot(
	value: unknown,
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return violation();
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return violation();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);

	const snapshot: Record<string, unknown> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== "string") {
			return violation();
		}
		const descriptor = descriptors[key];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
		snapshot[key] = descriptor.value;
	}

	return Object.freeze(snapshot);
}

function ownArrayDataSnapshot(
	value: unknown,
	minimumLength: number,
	maximumLength: number,
): Readonly<{ value: object; entries: readonly unknown[] }> {
	if (typeof value !== "object" || value === null || !Array.isArray(value)) {
		return violation();
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		return violation();
	}
	const declaredLengthDescriptor = Object.getOwnPropertyDescriptor(
		value,
		"length",
	);
	if (
		declaredLengthDescriptor === undefined ||
		!("value" in declaredLengthDescriptor) ||
		!Number.isSafeInteger(declaredLengthDescriptor.value) ||
		declaredLengthDescriptor.value < minimumLength ||
		declaredLengthDescriptor.value > maximumLength
	) {
		return violation();
	}
	const declaredLength = declaredLengthDescriptor.value as number;

	const descriptors = Object.getOwnPropertyDescriptors(value);
	const descriptorMap = descriptors as unknown as Record<
		PropertyKey,
		PropertyDescriptor
	>;
	const lengthDescriptor = descriptorMap.length;
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value !== declaredLength
	) {
		return violation();
	}
	const length = declaredLength;
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== length + 1) {
		return violation();
	}

	const entries: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = descriptorMap[String(index)];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
		entries.push(descriptor.value);
	}
	for (const key of keys) {
		if (key === "length") {
			continue;
		}
		if (
			typeof key !== "string" ||
			!/^(?:0|[1-9][0-9]*)$/u.test(key) ||
			Number(key) >= length
		) {
			return violation();
		}
	}

	return Object.freeze({ value, entries: Object.freeze(entries) });
}

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar own data
	// property. Structured clone can therefore serve only as a Proxy brand check
	// and cannot traverse attacker-controlled nested payloads or accessors.
	structuredClone(value);
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

function workspaceWatchRequestInvalid(): never {
	return requestViolation(
		"WORKSPACE_WATCH_REQUEST_INVALID",
		"The workspace watcher synchronization request is invalid.",
	);
}

export function frozenWorkspaceWatchSyncRequest(
	roots: unknown,
): Readonly<WorkspaceWatchSyncRequest> {
	let arraySnapshot: ReturnType<typeof ownArrayDataSnapshot>;
	try {
		arraySnapshot = ownArrayDataSnapshot(roots, 1, MAX_WORKSPACE_ROOTS);
	} catch {
		return workspaceWatchRequestInvalid();
	}

	const unique = new Set<string>();
	const frozenRoots = arraySnapshot.entries.map((value) => {
		let snapshot: Readonly<Record<string, unknown>>;
		try {
			snapshot = ownPlainDataSnapshot(value);
			if (
				!hasExactKeys(snapshot, ["rootId", "acknowledgedGeneration"]) ||
				!isUuidV4(snapshot.rootId) ||
				(snapshot.acknowledgedGeneration !== null &&
					(typeof snapshot.acknowledgedGeneration !== "number" ||
						!Number.isSafeInteger(snapshot.acknowledgedGeneration) ||
						snapshot.acknowledgedGeneration < 1 ||
						snapshot.acknowledgedGeneration > MAX_WORKSPACE_WATCH_GENERATION))
			) {
				return workspaceWatchRequestInvalid();
			}
			rejectProxyObject(value as object);
		} catch {
			return workspaceWatchRequestInvalid();
		}
		if (unique.has(snapshot.rootId)) {
			return workspaceWatchRequestInvalid();
		}
		unique.add(snapshot.rootId);
		return Object.freeze({
			rootId: snapshot.rootId,
			acknowledgedGeneration: snapshot.acknowledgedGeneration,
		});
	});
	try {
		rejectProxyObject(arraySnapshot.value);
	} catch {
		return workspaceWatchRequestInvalid();
	}
	return Object.freeze({ roots: Object.freeze(frozenRoots) });
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

function workspaceWriteContentSnapshot(value: unknown): Uint8Array {
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
		// A zero-length detached ArrayBuffer otherwise looks identical to a valid
		// empty view through the length getters.
		Reflect.apply(arrayBufferSlice, buffer, [0, 0]);
	} catch {
		return violation();
	}

	if (byteLength > MAX_FILE_BYTES) {
		return requestViolation(
			"FILE_TOO_LARGE",
			"The workspace file exceeds the supported size limit.",
		);
	}

	try {
		// Only intrinsic byteOffset/byteLength bytes cross the IPC boundary.
		// Arbitrary own JS properties are deliberately neither enumerated nor read:
		// the private exact Uint8Array snapshot is the complete raw request body.
		const snapshot = new Uint8Array(byteLength);
		Reflect.apply(typedArraySet, snapshot, [value, 0]);
		return snapshot;
	} catch {
		return violation();
	}
}

export function encodeWorkspaceWriteFileRequest(
	rootId: unknown,
	relativePath: unknown,
	expectedVersion: unknown,
	content: unknown,
): Uint8Array {
	const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
	if (
		typeof expectedVersion !== "string" ||
		!WORKSPACE_VERSION_PATTERN.test(expectedVersion)
	) {
		return requestViolation(
			"WORKSPACE_FILE_MODIFIED",
			"The workspace file changed since it was read.",
		);
	}
	const contentSnapshot = workspaceWriteContentSnapshot(content);
	const rootBytes = utf8Encoder.encode(request.rootId);
	const pathBytes = utf8Encoder.encode(request.relativePath);
	const versionBytes = utf8Encoder.encode(expectedVersion);
	if (
		rootBytes.byteLength !== 36 ||
		pathBytes.byteLength < 1 ||
		pathBytes.byteLength > MAX_RELATIVE_PATH_BYTES ||
		versionBytes.byteLength !== WORKSPACE_VERSION_BYTES
	) {
		return violation();
	}

	const frame = new Uint8Array(
		PLW1_HEADER_BYTES +
			rootBytes.byteLength +
			pathBytes.byteLength +
			versionBytes.byteLength +
			contentSnapshot.byteLength,
	);
	const view = new DataView(frame.buffer);
	frame.set([0x50, 0x4c, 0x57, 0x31], 0);
	view.setUint16(4, rootBytes.byteLength, false);
	view.setUint16(6, pathBytes.byteLength, false);
	view.setUint16(8, versionBytes.byteLength, false);
	view.setUint32(10, contentSnapshot.byteLength, false);
	let offset = PLW1_HEADER_BYTES;
	frame.set(rootBytes, offset);
	offset += rootBytes.byteLength;
	frame.set(pathBytes, offset);
	offset += pathBytes.byteLength;
	frame.set(versionBytes, offset);
	offset += versionBytes.byteLength;
	frame.set(contentSnapshot, offset);
	return frame;
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

export function frozenWorkspaceCopyRequest(
	sourceRootId: unknown,
	sourcePath: unknown,
	targetRootId: unknown,
	targetPath: unknown,
): Readonly<WorkspaceCopyRequest> {
	const source = frozenWorkspaceEntryRequest(sourceRootId, sourcePath);
	const target = frozenWorkspaceEntryRequest(targetRootId, targetPath);
	return Object.freeze({
		sourceRootId: source.rootId,
		sourcePath: source.relativePath,
		targetRootId: target.rootId,
		targetPath: target.relativePath,
	});
}

export function frozenWorkspaceMoveRequest(
	sourceRootId: unknown,
	sourcePath: unknown,
	targetRootId: unknown,
	targetPath: unknown,
): Readonly<WorkspaceMoveRequest> {
	const request = frozenWorkspaceCopyRequest(
		sourceRootId,
		sourcePath,
		targetRootId,
		targetPath,
	);
	if (request.sourceRootId === request.targetRootId) {
		return requestViolation(
			"WORKSPACE_CONFLICT",
			"The workspace move requires distinct workspace roots.",
		);
	}
	return Object.freeze({ ...request });
}

function workspaceDeletePlanInvalid(): never {
	return requestViolation(
		"WORKSPACE_DELETE_PLAN_INVALID",
		"The workspace delete plan is invalid.",
	);
}

function workspaceDeleteConflict(): never {
	return requestViolation(
		"WORKSPACE_CONFLICT",
		"The workspace delete selection conflicts with another entry.",
	);
}

function deleteEntryRequestFromSnapshot(
	value: unknown,
): WorkspaceDeleteEntryRequest {
	let snapshot: Readonly<Record<string, unknown>>;
	try {
		snapshot = ownPlainDataSnapshot(value);
		if (!hasExactKeys(snapshot, ["rootId", "relativePath", "recursive"])) {
			return workspaceDeletePlanInvalid();
		}
		rejectProxyObject(value as object);
	} catch {
		return workspaceDeletePlanInvalid();
	}
	const entry = frozenWorkspaceCreateEntryRequest(
		snapshot.rootId,
		snapshot.relativePath,
	);
	if (typeof snapshot.recursive !== "boolean") {
		return workspaceDeletePlanInvalid();
	}
	return Object.freeze({
		rootId: entry.rootId,
		relativePath: entry.relativePath,
		recursive: snapshot.recursive,
	});
}

export function frozenWorkspacePrepareDeleteRequest(
	entries: unknown,
): Readonly<WorkspacePrepareDeleteRequest> {
	let declaredLength: number;
	try {
		if (
			typeof entries !== "object" ||
			entries === null ||
			!Array.isArray(entries) ||
			Object.getPrototypeOf(entries) !== Array.prototype
		) {
			return workspaceDeletePlanInvalid();
		}
		const descriptor = Object.getOwnPropertyDescriptor(entries, "length");
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			!Number.isSafeInteger(descriptor.value) ||
			descriptor.value < 0
		) {
			return workspaceDeletePlanInvalid();
		}
		declaredLength = descriptor.value as number;
	} catch {
		return workspaceDeletePlanInvalid();
	}
	if (declaredLength < 1 || declaredLength > MAX_DELETE_BATCH_ENTRIES) {
		return workspaceDeleteConflict();
	}
	let arraySnapshot: ReturnType<typeof ownArrayDataSnapshot>;
	try {
		arraySnapshot = ownArrayDataSnapshot(
			entries,
			declaredLength,
			declaredLength,
		);
	} catch {
		return workspaceDeletePlanInvalid();
	}
	const frozenEntries = arraySnapshot.entries.map(
		deleteEntryRequestFromSnapshot,
	);
	try {
		rejectProxyObject(arraySnapshot.value);
	} catch {
		return workspaceDeletePlanInvalid();
	}

	for (let leftIndex = 0; leftIndex < frozenEntries.length; leftIndex += 1) {
		const left = frozenEntries[leftIndex]!;
		const leftSegments = workspaceRelativePathSegments(left.relativePath);
		if (leftSegments === undefined || leftSegments.length === 0) {
			return workspaceDeletePlanInvalid();
		}
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < frozenEntries.length;
			rightIndex += 1
		) {
			const right = frozenEntries[rightIndex]!;
			if (left.rootId !== right.rootId) {
				continue;
			}
			const rightSegments = workspaceRelativePathSegments(right.relativePath);
			if (rightSegments === undefined || rightSegments.length === 0) {
				return workspaceDeletePlanInvalid();
			}
			const commonLength = Math.min(leftSegments.length, rightSegments.length);
			if (
				leftSegments
					.slice(0, commonLength)
					.every((segment, index) => rightSegments[index] === segment)
			) {
				return workspaceDeleteConflict();
			}
		}
	}

	return Object.freeze({ entries: Object.freeze(frozenEntries) });
}

export function frozenWorkspaceDeleteBatchRequest(
	confirmationId: unknown,
): Readonly<WorkspaceDeleteBatchRequest> {
	if (!isUuidV4(confirmationId)) {
		return workspaceDeletePlanInvalid();
	}
	return Object.freeze({ confirmationId });
}

export function frozenWorkspaceCommitDeleteEntryRequest(
	confirmationId: unknown,
	entryId: unknown,
	rootId: unknown,
	relativePath: unknown,
	recursive: unknown,
): Readonly<WorkspaceCommitDeleteEntryRequest> {
	const batch = frozenWorkspaceDeleteBatchRequest(confirmationId);
	if (!isUuidV4(entryId) || entryId === batch.confirmationId) {
		return workspaceDeletePlanInvalid();
	}
	const entry = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
	if (typeof recursive !== "boolean") {
		return workspaceDeletePlanInvalid();
	}
	return Object.freeze({
		confirmationId: batch.confirmationId,
		entryId,
		rootId: entry.rootId,
		relativePath: entry.relativePath,
		recursive,
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
	const snapshot = ownPlainDataSnapshot(value);
	if (
		!hasExactKeys(snapshot, ["kind", "size", "mtime", "ctime", "version"]) ||
		!isWorkspaceEntryKind(snapshot.kind) ||
		!isSafeNonnegativeInteger(snapshot.size) ||
		!isSafeNonnegativeInteger(snapshot.mtime) ||
		!isSafeNonnegativeInteger(snapshot.ctime) ||
		(snapshot.version !== null &&
			(typeof snapshot.version !== "string" ||
				!WORKSPACE_VERSION_PATTERN.test(snapshot.version))) ||
		(snapshot.kind !== "file" && snapshot.version !== null)
	) {
		return violation();
	}
	rejectProxyObject(value as object);

	return Object.freeze({
		kind: snapshot.kind,
		size: snapshot.size,
		mtime: snapshot.mtime,
		ctime: snapshot.ctime,
		version: snapshot.version,
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

function decodeStrictByteArray(
	value: unknown,
	minimumLength = 0,
	maximumLength = MAX_FILE_BYTES,
	consume = false,
): Uint8Array {
	if (
		typeof value !== "object" ||
		value === null ||
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype
	) {
		return violation();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < minimumLength ||
		lengthDescriptor.value > maximumLength ||
		lengthDescriptor.writable !== true ||
		lengthDescriptor.enumerable !== false ||
		lengthDescriptor.configurable !== false
	) {
		return violation();
	}
	const length = lengthDescriptor.value as number;
	const bytes = new Uint8Array(length);
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			typeof descriptor.value !== "number" ||
			!Number.isInteger(descriptor.value) ||
			descriptor.value < 0 ||
			descriptor.value > 255 ||
			descriptor.writable !== true ||
			descriptor.enumerable !== true ||
			descriptor.configurable !== true
		) {
			return violation();
		}
		bytes[index] = descriptor.value;
	}

	// Remove the verified JSON-style indices before exact-key and Proxy checks:
	// a valid 8 MiB array then has only `length`, so reflection and structured
	// clone cannot amplify millions of descriptors, strings, or boxed numbers.
	// Only the private Tauri raw-response route requests permanent consumption;
	// other valid callers are restored synchronously after the brand check.
	if (!Reflect.defineProperty(value, "length", { value: 0 })) {
		return violation();
	}
	const consumedLength = Object.getOwnPropertyDescriptor(value, "length");
	if (
		consumedLength === undefined ||
		!("value" in consumedLength) ||
		consumedLength.value !== 0 ||
		consumedLength.writable !== true ||
		consumedLength.enumerable !== false ||
		consumedLength.configurable !== false
	) {
		return violation();
	}
	const remainingKeys = Reflect.ownKeys(value);
	if (remainingKeys.length !== 1 || remainingKeys[0] !== "length") {
		return violation();
	}
	rejectProxyObject(value);
	if (!consume) {
		for (let index = 0; index < length; index += 1) {
			if (
				!Reflect.defineProperty(value, String(index), {
					value: bytes[index]!,
					writable: true,
					enumerable: true,
					configurable: true,
				})
			) {
				return violation();
			}
		}
		const restoredLength = Object.getOwnPropertyDescriptor(value, "length");
		if (
			restoredLength === undefined ||
			!("value" in restoredLength) ||
			restoredLength.value !== length ||
			restoredLength.writable !== true ||
			restoredLength.enumerable !== false ||
			restoredLength.configurable !== false
		) {
			return violation();
		}
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

function exactRawFrameSnapshot(value: unknown): Uint8Array {
	if (Array.isArray(value)) {
		return decodeStrictByteArray(
			value,
			PLR1_HEADER_BYTES,
			MAX_PLR1_FRAME_BYTES,
			true,
		);
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
		byteLength < PLR1_HEADER_BYTES ||
		byteLength > MAX_PLR1_FRAME_BYTES
	) {
		return violation();
	}

	const snapshot = new Uint8Array(byteLength);
	snapshot.set(new Uint8Array(value as ArrayBuffer));
	return snapshot;
}

function safeUint64(view: DataView, offset: number): number {
	const value = view.getBigUint64(offset, false);
	if (value > MAX_JS_SAFE_INTEGER_BIGINT) {
		return violation();
	}
	return Number(value);
}

function decodeWorkspaceVersion(
	bytes: Uint8Array,
	offset: number,
	length: number,
): string | null {
	if (length === 0) {
		return null;
	}
	if (length !== WORKSPACE_VERSION_BYTES) {
		return violation();
	}

	let version = "";
	for (let index = 0; index < length; index += 1) {
		const byte = bytes[offset + index];
		if (byte === undefined || byte > 0x7f) {
			return violation();
		}
		version += String.fromCharCode(byte);
	}
	return WORKSPACE_VERSION_PATTERN.test(version) ? version : violation();
}

function frozenWorkspaceReadFileResult(
	stat: WorkspaceEntryStat,
	bytes: Uint8Array,
): WorkspaceReadFileResult {
	if (
		(stat.kind !== "file" && stat.kind !== "symlinkFile") ||
		stat.size !== bytes.byteLength ||
		(stat.kind === "symlinkFile" && stat.version !== null)
	) {
		return violation();
	}
	return Object.freeze({
		stat,
		value: frozenWorkspaceFileDataFromBytes(bytes),
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

export function decodeWorkspaceCapabilities(
	value: unknown,
): WorkspaceCapabilities {
	return sanitizedDecode(() => {
		const snapshot = ownPlainDataSnapshot(value);
		if (
			!hasExactKeys(snapshot, [
				"create",
				"renameNoReplace",
				"copyMove",
				"delete",
				"versionedWrite",
			]) ||
			typeof snapshot.create !== "boolean" ||
			typeof snapshot.renameNoReplace !== "boolean" ||
			typeof snapshot.copyMove !== "boolean" ||
			typeof snapshot.delete !== "boolean" ||
			typeof snapshot.versionedWrite !== "boolean"
		) {
			return violation();
		}
		rejectProxyObject(value as object);

		return Object.freeze({
			create: snapshot.create,
			renameNoReplace: snapshot.renameNoReplace,
			copyMove: snapshot.copyMove,
			delete: snapshot.delete,
			versionedWrite: snapshot.versionedWrite,
		});
	});
}

export function decodeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
	return sanitizedDecode(() => decodeWorkspaceSnapshotValue(value));
}

export function decodeWorkspaceWatchWakeEvent(
	value: unknown,
): WorkspaceWatchWakeEvent {
	return sanitizedDecode(() => {
		const snapshot = ownPlainDataSnapshot(value);
		if (
			!hasExactKeys(snapshot, ["workspaceId"]) ||
			!isUuidV4(snapshot.workspaceId)
		) {
			return violation();
		}
		rejectProxyObject(value as object);
		return Object.freeze({ workspaceId: snapshot.workspaceId });
	});
}

export function decodeWorkspaceWatchSyncResult(
	value: unknown,
	request: Readonly<WorkspaceWatchSyncRequest>,
): WorkspaceWatchSyncResult {
	return sanitizedDecode(() => {
		const snapshot = ownPlainDataSnapshot(value);
		if (
			!hasExactKeys(snapshot, ["workspaceId", "roots"]) ||
			!isUuidV4(snapshot.workspaceId)
		) {
			return violation();
		}
		const arraySnapshot = ownArrayDataSnapshot(
			snapshot.roots,
			0,
			request.roots.length,
		);
		const requested = new Map(
			request.roots.map((root) => [root.rootId, root] as const),
		);
		const unique = new Set<string>();
		const roots = arraySnapshot.entries.map(
			(entry): WorkspaceWatchPendingRoot => {
				const root = ownPlainDataSnapshot(entry);
				const requestedRoot =
					typeof root.rootId === "string"
						? requested.get(root.rootId)
						: undefined;
				const saturatedReplay =
					root.generation === MAX_WORKSPACE_WATCH_GENERATION &&
					requestedRoot?.acknowledgedGeneration ===
						MAX_WORKSPACE_WATCH_GENERATION &&
					root.rescanRequired === true;
				if (
					!hasExactKeys(root, ["rootId", "generation", "rescanRequired"]) ||
					requestedRoot === undefined ||
					unique.has(requestedRoot.rootId) ||
					typeof root.generation !== "number" ||
					!Number.isSafeInteger(root.generation) ||
					root.generation < 1 ||
					root.generation > MAX_WORKSPACE_WATCH_GENERATION ||
					(requestedRoot.acknowledgedGeneration !== null &&
						root.generation <= requestedRoot.acknowledgedGeneration &&
						!saturatedReplay) ||
					typeof root.rescanRequired !== "boolean"
				) {
					return violation();
				}
				rejectProxyObject(entry as object);
				unique.add(requestedRoot.rootId);
				return Object.freeze({
					rootId: requestedRoot.rootId,
					generation: root.generation,
					rescanRequired: root.rescanRequired,
				});
			},
		);
		rejectProxyObject(arraySnapshot.value);
		rejectProxyObject(value as object);
		return Object.freeze({
			workspaceId: snapshot.workspaceId,
			roots: Object.freeze(roots),
		});
	});
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

export function decodeWorkspaceReadFile(
	value: unknown,
): WorkspaceReadFileResult {
	return sanitizedDecode(() => {
		const bytes = exactRawFrameSnapshot(value);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (
			bytes[0] !== 0x50 ||
			bytes[1] !== 0x4c ||
			bytes[2] !== 0x52 ||
			bytes[3] !== 0x31 ||
			view.getUint16(6, false) !== 0
		) {
			return violation();
		}

		const kindByte = bytes[4];
		const versionLength = bytes[5];
		if (
			(kindByte !== 1 && kindByte !== 2) ||
			versionLength === undefined ||
			(versionLength !== 0 && versionLength !== WORKSPACE_VERSION_BYTES) ||
			(kindByte === 2 && versionLength !== 0)
		) {
			return violation();
		}

		const contentLength = view.getUint32(8, false);
		const expectedLength = PLR1_HEADER_BYTES + versionLength + contentLength;
		if (contentLength > MAX_FILE_BYTES || expectedLength !== bytes.byteLength) {
			return violation();
		}

		const size = safeUint64(view, 12);
		const mtime = safeUint64(view, 20);
		const ctime = safeUint64(view, 28);
		if (size !== contentLength) {
			return violation();
		}
		const version = decodeWorkspaceVersion(
			bytes,
			PLR1_HEADER_BYTES,
			versionLength,
		);
		const kind = kindByte === 1 ? "file" : "symlinkFile";
		const stat = Object.freeze({ kind, size, mtime, ctime, version });
		const contentOffset = PLR1_HEADER_BYTES + versionLength;
		return frozenWorkspaceReadFileResult(
			stat,
			bytes.subarray(contentOffset, contentOffset + contentLength),
		);
	});
}

export function decodeWorkspaceWriteResult(
	value: unknown,
	expectedVersion: string,
	expectedContentLength: number,
): WorkspaceWriteResult {
	return sanitizedDecode(() => {
		if (
			typeof expectedVersion !== "string" ||
			!WORKSPACE_VERSION_PATTERN.test(expectedVersion) ||
			!Number.isSafeInteger(expectedContentLength) ||
			expectedContentLength < 0 ||
			expectedContentLength > MAX_FILE_BYTES
		) {
			return violation();
		}
		const snapshot = ownPlainDataSnapshot(value);
		if (snapshot.status === "written") {
			if (!hasExactKeys(snapshot, ["status", "stat"])) {
				return violation();
			}
			const stat = decodeWorkspaceEntryStatValue(snapshot.stat);
			if (
				stat.kind !== "file" ||
				typeof stat.version !== "string" ||
				stat.version === expectedVersion ||
				stat.size !== expectedContentLength
			) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({ status: snapshot.status, stat });
		}

		if (snapshot.status === "targetPublished") {
			if (
				!hasExactKeys(snapshot, [
					"status",
					"publicationEvidence",
					"rename",
					"directorySync",
					"target",
				]) ||
				(snapshot.publicationEvidence !== "renameReportedSuccess" &&
					snapshot.publicationEvidence !== "targetObservedWritten") ||
				(snapshot.rename !== "reportedSuccess" &&
					snapshot.rename !== "reportedFailure") ||
				(snapshot.directorySync !== "synced" &&
					snapshot.directorySync !== "failed") ||
				(snapshot.target !== "matchesWritten" &&
					snapshot.target !== "changed" &&
					snapshot.target !== "unverifiable") ||
				(snapshot.rename === "reportedSuccess" &&
					snapshot.publicationEvidence === "targetObservedWritten" &&
					(snapshot.directorySync !== "failed" ||
						snapshot.target !== "matchesWritten")) ||
				(snapshot.rename === "reportedSuccess" &&
					snapshot.publicationEvidence === "renameReportedSuccess" &&
					snapshot.target === "matchesWritten") ||
				(snapshot.rename === "reportedFailure" &&
					snapshot.publicationEvidence !== "targetObservedWritten")
			) {
				return violation();
			}
			rejectProxyObject(value as object);
			if (
				snapshot.rename === "reportedSuccess" &&
				snapshot.publicationEvidence === "targetObservedWritten"
			) {
				return Object.freeze({
					status: snapshot.status,
					publicationEvidence: snapshot.publicationEvidence,
					rename: snapshot.rename,
					directorySync: "failed",
					target: "matchesWritten",
				});
			}
			if (snapshot.rename === "reportedSuccess") {
				return Object.freeze({
					status: snapshot.status,
					publicationEvidence: "renameReportedSuccess",
					rename: snapshot.rename,
					directorySync: snapshot.directorySync,
					target: snapshot.target as "changed" | "unverifiable",
				});
			}
			return Object.freeze({
				status: snapshot.status,
				publicationEvidence: "targetObservedWritten",
				rename: snapshot.rename,
				directorySync: snapshot.directorySync,
				target: snapshot.target,
			});
		}

		if (
			snapshot.status !== "outcomeUnknown" ||
			!hasExactKeys(snapshot, [
				"status",
				"observation",
				"rename",
				"directorySync",
				"target",
			]) ||
			snapshot.target !== "ambiguous"
		) {
			return violation();
		}
		if (snapshot.observation === "native") {
			if (
				snapshot.rename !== "reportedFailure" ||
				snapshot.directorySync !== "notAttempted"
			) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({
				status: snapshot.status,
				observation: snapshot.observation,
				rename: snapshot.rename,
				directorySync: snapshot.directorySync,
				target: snapshot.target,
			});
		}
		if (
			snapshot.observation !== "responseUnavailable" ||
			snapshot.rename !== "unobserved" ||
			snapshot.directorySync !== "unobserved"
		) {
			return violation();
		}
		rejectProxyObject(value as object);
		return Object.freeze({
			status: snapshot.status,
			observation: snapshot.observation,
			rename: snapshot.rename,
			directorySync: snapshot.directorySync,
			target: snapshot.target,
		});
	});
}

export function workspaceWriteResponseUnavailable(): WorkspaceWriteResult {
	return Object.freeze({
		status: "outcomeUnknown",
		observation: "responseUnavailable",
		rename: "unobserved",
		directorySync: "unobserved",
		target: "ambiguous",
	});
}

export function decodeWorkspaceWritePrepublicationError(
	value: unknown,
): CommandError | undefined {
	try {
		const snapshot = ownPlainDataSnapshot(value);
		if (
			!hasExactKeys(snapshot, ["code", "message"]) ||
			typeof snapshot.code !== "string" ||
			!WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET.has(snapshot.code) ||
			typeof snapshot.message !== "string" ||
			snapshot.message.length < 1 ||
			snapshot.message.length > MAX_COMMAND_ERROR_MESSAGE_LENGTH ||
			!isWellFormedUtf16(snapshot.message)
		) {
			return undefined;
		}
		rejectProxyObject(value as object);
		return Object.freeze({
			code: snapshot.code,
			message: snapshot.message,
		});
	} catch {
		return undefined;
	}
}

export function decodeWorkspaceVoid(value: unknown): void {
	return sanitizedDecode(() => {
		if (value !== null) {
			return violation();
		}
	});
}

function isWorkspaceMoveIncompleteReason(
	value: unknown,
): value is WorkspaceMoveIncompleteReason {
	return (
		typeof value === "string" &&
		WORKSPACE_MOVE_INCOMPLETE_REASONS.has(
			value as WorkspaceMoveIncompleteReason,
		)
	);
}

export function decodeWorkspaceMoveResult(value: unknown): WorkspaceMoveResult {
	return sanitizedDecode(() => {
		const snapshot = ownPlainDataSnapshot(value);
		if (typeof snapshot.status !== "string") {
			return violation();
		}
		if (snapshot.status === "moved") {
			if (!hasExactKeys(snapshot, ["status"])) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({ status: snapshot.status });
		}
		if (snapshot.status === "targetPublishedSourceRetained") {
			if (
				!hasExactKeys(snapshot, ["status", "reason"]) ||
				!isWorkspaceMoveIncompleteReason(snapshot.reason)
			) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({
				status: snapshot.status,
				reason: snapshot.reason,
			});
		}
		if (
			snapshot.status !== "targetPublishedSourcePartiallyDeleted" ||
			!hasExactKeys(snapshot, ["status", "reason", "removedEntries"]) ||
			!isWorkspaceMoveIncompleteReason(snapshot.reason) ||
			typeof snapshot.removedEntries !== "number" ||
			!Number.isSafeInteger(snapshot.removedEntries) ||
			snapshot.removedEntries < 1 ||
			snapshot.removedEntries > MAX_MOVE_REMOVED_ENTRIES
		) {
			return violation();
		}
		rejectProxyObject(value as object);
		return Object.freeze({
			status: snapshot.status,
			reason: snapshot.reason,
			removedEntries: snapshot.removedEntries,
		});
	});
}

function isWorkspaceDeleteEntryKind(
	value: unknown,
): value is WorkspaceDeleteEntryKind {
	return (
		typeof value === "string" &&
		WORKSPACE_DELETE_ENTRY_KINDS.has(value as WorkspaceDeleteEntryKind)
	);
}

function isWorkspaceDeleteIncompleteReason(
	value: unknown,
): value is WorkspaceDeleteIncompleteReason {
	return (
		typeof value === "string" &&
		WORKSPACE_DELETE_INCOMPLETE_REASONS.has(
			value as WorkspaceDeleteIncompleteReason,
		)
	);
}

export function decodeWorkspaceDeleteBatchPlan(
	value: unknown,
	request: WorkspacePrepareDeleteRequest,
): WorkspaceDeleteBatchPlan {
	return sanitizedDecode(() => {
		const requestSnapshot = ownPlainDataSnapshot(request);
		if (!hasExactKeys(requestSnapshot, ["entries"])) {
			return violation();
		}
		const frozenRequest = frozenWorkspacePrepareDeleteRequest(
			requestSnapshot.entries,
		);
		rejectProxyObject(request as object);

		const snapshot = ownPlainDataSnapshot(value);
		if (
			!hasExactKeys(snapshot, ["confirmationId", "entries"]) ||
			!isUuidV4(snapshot.confirmationId)
		) {
			return violation();
		}
		const entriesSnapshot = ownArrayDataSnapshot(
			snapshot.entries,
			frozenRequest.entries.length,
			frozenRequest.entries.length,
		);
		const seenIds = new Set<string>([snapshot.confirmationId]);
		let totalDescendants = 0;
		const entries = entriesSnapshot.entries.map(
			(candidate): WorkspaceDeleteBatchPlanEntry => {
				const entry = ownPlainDataSnapshot(candidate);
				if (
					!hasExactKeys(entry, ["entryId", "kind", "descendantEntries"]) ||
					!isUuidV4(entry.entryId) ||
					seenIds.has(entry.entryId) ||
					!isWorkspaceDeleteEntryKind(entry.kind) ||
					!isSafeNonnegativeInteger(entry.descendantEntries) ||
					entry.descendantEntries > MAX_DELETE_DESCENDANT_ENTRIES ||
					(entry.kind !== "directory" && entry.descendantEntries !== 0)
				) {
					return violation();
				}
				seenIds.add(entry.entryId);
				totalDescendants += entry.descendantEntries;
				if (
					!Number.isSafeInteger(totalDescendants) ||
					totalDescendants > MAX_DELETE_DESCENDANT_ENTRIES
				) {
					return violation();
				}
				rejectProxyObject(candidate as object);
				return Object.freeze({
					entryId: entry.entryId,
					kind: entry.kind,
					descendantEntries: entry.descendantEntries,
				});
			},
		);
		rejectProxyObject(entriesSnapshot.value);
		rejectProxyObject(value as object);
		return Object.freeze({
			confirmationId: snapshot.confirmationId,
			entries: Object.freeze(entries),
		});
	});
}

export function decodeWorkspaceDeleteResult(
	value: unknown,
): WorkspaceDeleteResult {
	return sanitizedDecode(() => {
		const snapshot = ownPlainDataSnapshot(value);
		if (snapshot.status === "deleted") {
			if (!hasExactKeys(snapshot, ["status"])) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({ status: snapshot.status });
		}
		if (snapshot.status === "entryRetained") {
			if (
				!hasExactKeys(snapshot, ["status", "reason"]) ||
				!isWorkspaceDeleteIncompleteReason(snapshot.reason)
			) {
				return violation();
			}
			rejectProxyObject(value as object);
			return Object.freeze({
				status: snapshot.status,
				reason: snapshot.reason,
			});
		}
		if (
			snapshot.status !== "entryPartiallyDeleted" ||
			!hasExactKeys(snapshot, ["status", "reason", "removedEntries"]) ||
			!isWorkspaceDeleteIncompleteReason(snapshot.reason) ||
			typeof snapshot.removedEntries !== "number" ||
			!Number.isSafeInteger(snapshot.removedEntries) ||
			snapshot.removedEntries < 1 ||
			snapshot.removedEntries > MAX_DELETE_DESCENDANT_ENTRIES
		) {
			return violation();
		}
		rejectProxyObject(value as object);
		return Object.freeze({
			status: snapshot.status,
			reason: snapshot.reason,
			removedEntries: snapshot.removedEntries,
		});
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
	version: string | null,
): WorkspaceEntryStat {
	return decodeWorkspaceEntryStat({ kind, size, mtime, ctime, version });
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

export function frozenWorkspaceReadFile(
	stat: WorkspaceEntryStat,
	bytes: Uint8Array,
): WorkspaceReadFileResult {
	const frozenStat = decodeWorkspaceEntryStat(stat);
	return frozenWorkspaceReadFileResult(frozenStat, bytes.slice());
}

export function frozenWorkspaceWriteResult(
	result: WorkspaceWriteResult,
	expectedVersion: string,
	expectedContentLength: number,
): WorkspaceWriteResult {
	return decodeWorkspaceWriteResult(
		result,
		expectedVersion,
		expectedContentLength,
	);
}

export function frozenWorkspaceMoveResult(
	result: WorkspaceMoveResult,
): WorkspaceMoveResult {
	return decodeWorkspaceMoveResult(result);
}

export function frozenWorkspaceDeleteBatchPlan(
	plan: WorkspaceDeleteBatchPlan,
	request: WorkspacePrepareDeleteRequest,
): WorkspaceDeleteBatchPlan {
	return decodeWorkspaceDeleteBatchPlan(plan, request);
}

export function frozenWorkspaceDeleteResult(
	result: WorkspaceDeleteResult,
): WorkspaceDeleteResult {
	return decodeWorkspaceDeleteResult(result);
}
