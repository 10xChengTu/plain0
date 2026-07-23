import type { WorkspaceSearchFilesResult } from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SEARCH_ROOTS = 256;
const MAX_SEARCH_PATTERN_BYTES = 4_096;
const MAX_SEARCH_EXCLUDE_GLOBS = 64;
const MAX_SEARCH_EXCLUDE_GLOB_BYTES = 1_024;
const MAX_SEARCH_RESULTS_HARD_CAP = 2_048;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain search contract.";

class SearchIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "SearchIpcContractViolation";
	}
}

function violation(): never {
	throw new SearchIpcContractViolation();
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

function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
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

/**
 * Validates and freezes an own-data string array: a real `Array.prototype`
 * array whose `length` and every index `0..length` are plain data
 * properties (no getters, no extra/sparse holes), each element a string
 * within `maxItemBytes` (UTF-16 code units, an intentionally coarse but
 * cheap bound — Rust re-validates the exact UTF-8 byte length). Rejects a
 * Proxy wrapper via `rejectProxyObject`.
 */
function ownStringArraySnapshot(
	value: unknown,
	maxLength: number,
	maxItemBytes: number,
): readonly string[] {
	if (typeof value !== "object" || value === null || !Array.isArray(value)) {
		return violation();
	}
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		return violation();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		(lengthDescriptor.value as number) < 0 ||
		(lengthDescriptor.value as number) > maxLength
	) {
		return violation();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== length + 1) {
		return violation();
	}

	const items: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined ||
			typeof descriptor.value !== "string" ||
			descriptor.value.length > maxItemBytes
		) {
			return violation();
		}
		items.push(descriptor.value);
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze(items);
}

function frozenSearchRoots(roots: unknown): readonly string[] {
	const snapshot = ownStringArraySnapshot(roots, MAX_SEARCH_ROOTS, 64);
	if (snapshot.length === 0 || !snapshot.every(isUuidV4)) {
		return requestViolation(
			"ROOT_NOT_AUTHORIZED",
			"The workspace search request names no authorized root.",
		);
	}
	return snapshot;
}

function frozenSearchExcludeGlobs(excludeGlobs: unknown): readonly string[] {
	const snapshot = ownStringArraySnapshot(
		excludeGlobs,
		MAX_SEARCH_EXCLUDE_GLOBS,
		MAX_SEARCH_EXCLUDE_GLOB_BYTES,
	);
	if (snapshot.some((pattern) => pattern.length === 0)) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace file search request is invalid.",
		);
	}
	return snapshot;
}

function frozenSearchFilePattern(filePattern: unknown): string {
	if (
		typeof filePattern !== "string" ||
		filePattern.length > MAX_SEARCH_PATTERN_BYTES
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace file search request is invalid.",
		);
	}
	return filePattern;
}

function frozenSearchMaxResults(maxResults: unknown): number {
	// Mirrors Rust's `u32` wire type and its own `.clamp(1, HARD_CAP)`: a
	// negative, fractional, or non-numeric value could never deserialize into
	// a `u32` at all, so those are rejected outright; every other integer
	// (including 0 and values far above the cap) is clamped, never rejected,
	// exactly like the server side.
	if (
		typeof maxResults !== "number" ||
		!Number.isSafeInteger(maxResults) ||
		maxResults < 0
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace file search request is invalid.",
		);
	}
	return Math.min(Math.max(maxResults, 1), MAX_SEARCH_RESULTS_HARD_CAP);
}

/**
 * Validates and freezes a `workspace_search_files` request's own-data
 * fields, independent of transport. Shared by the native encoder (which
 * forwards the frozen object as-is to `invoke`) and the browser mock (which
 * searches its in-memory tree with the same validated inputs), so both
 * transports reject the same hostile inputs identically.
 */
export function frozenWorkspaceSearchFilesRequest(
	roots: unknown,
	filePattern: unknown,
	excludeGlobs: unknown,
	maxResults: unknown,
): Readonly<{
	roots: readonly string[];
	filePattern: string;
	excludeGlobs: readonly string[];
	maxResults: number;
}> {
	return Object.freeze({
		roots: frozenSearchRoots(roots),
		filePattern: frozenSearchFilePattern(filePattern),
		excludeGlobs: frozenSearchExcludeGlobs(excludeGlobs),
		maxResults: frozenSearchMaxResults(maxResults),
	});
}

/**
 * Decodes a `workspace_search_files` response: an own-data, exactly
 * `{ entries, limitHit }` object. `entries` are root-relative wire paths —
 * validated for shape/length here, not full `RelativePath` grammar (Rust is
 * the sole authority on well-formed relative paths; this decoder only
 * refuses to accept something structurally impossible, such as a non-string
 * element, a Proxy-wrapped array, or a huge oversized listing).
 */
export function decodeWorkspaceSearchFilesResult(
	value: unknown,
): WorkspaceSearchFilesResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["entries", "limitHit"])) {
		return violation();
	}
	const entries = ownStringArraySnapshot(
		value.entries,
		MAX_SEARCH_RESULTS_HARD_CAP,
		MAX_SEARCH_PATTERN_BYTES,
	);
	if (entries.some((entry) => entry.length === 0)) {
		return violation();
	}
	if (typeof value.limitHit !== "boolean") {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ entries, limitHit: value.limitHit });
}

/**
 * Builds a frozen `workspace_search_files` response directly, for the
 * browser mock (which has no wire boundary to round-trip through).
 */
export function frozenWorkspaceSearchFilesResult(
	entries: readonly string[],
	limitHit: boolean,
): WorkspaceSearchFilesResult {
	return decodeWorkspaceSearchFilesResult({
		entries: [...entries],
		limitHit,
	});
}
