import type {
	WorkspaceSearchFilesResult,
	WorkspaceSearchFileEntry,
	WorkspaceSearchTextBatch,
	WorkspaceSearchTextMatch,
	WorkspaceSearchTextPollResult,
	WorkspaceSearchTextSkipped,
	WorkspaceSearchTextStartRequest,
	WorkspaceSearchTextStartResult,
	WorkspaceSearchTextWakeEvent,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SEARCH_ROOTS = 256;
const MAX_SEARCH_PATTERN_BYTES = 4_096;
const MAX_SEARCH_EXCLUDE_GLOBS = 64;
const MAX_SEARCH_EXCLUDE_GLOB_BYTES = 1_024;
const MAX_SEARCH_RESULTS_HARD_CAP = 2_048;
// --- Streaming text search (F040 S3) — mirrors search::dto's exact wire
// constants; see src-tauri/src/search/dto.rs for the authoritative values.
const MAX_TEXT_SEARCH_RESULTS_HARD_CAP = 20_000;
const MAX_TEXT_SEARCH_MAX_FILE_SIZE_HARD_CAP = 64 * 1_024 * 1_024;
const TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS = 256;
/** Mirrors `search::text_search::SEARCH_BATCH_QUEUE_CAPACITY`: the most
 * batches a single poll response can ever contain (the channel itself never
 * buffers more than this many unconsumed). */
const MAX_TEXT_SEARCH_BATCHES_PER_POLL = 512;
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
 * Decodes one root-bound file-search entry. Full `RelativePath` grammar stays
 * Rust-authoritative; this boundary rejects malformed ids, empty/oversized
 * paths, accessors, proxies and extra keys.
 */
function decodeFileSearchEntry(value: unknown): WorkspaceSearchFileEntry {
	if (!isPlainObject(value) || !hasExactKeys(value, ["rootId", "path"])) {
		return violation();
	}
	if (
		!isUuidV4(value.rootId) ||
		typeof value.path !== "string" ||
		value.path.length === 0 ||
		value.path.length > MAX_SEARCH_PATTERN_BYTES
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ rootId: value.rootId, path: value.path });
}

/** Decodes an exact `{ entries, limitHit }` file-search response. */
export function decodeWorkspaceSearchFilesResult(
	value: unknown,
): WorkspaceSearchFilesResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["entries", "limitHit"])) {
		return violation();
	}
	const entries = ownObjectArraySnapshot(
		value.entries,
		MAX_SEARCH_RESULTS_HARD_CAP,
		decodeFileSearchEntry,
	);
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
	entries: readonly WorkspaceSearchFileEntry[],
	limitHit: boolean,
): WorkspaceSearchFilesResult {
	return decodeWorkspaceSearchFilesResult({
		entries: entries.map((entry) => ({
			rootId: entry.rootId,
			path: entry.path,
		})),
		limitHit,
	});
}

// --- Streaming text search (F040 S3) ----------------------------------------

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function frozenSearchId(value: unknown): string {
	if (!isUuidV4(value)) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return value;
}

function frozenTextSearchPattern(pattern: unknown): string {
	if (
		typeof pattern !== "string" ||
		pattern.length === 0 ||
		pattern.length > MAX_SEARCH_PATTERN_BYTES
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return pattern;
}

function frozenStrictBoolean(value: unknown): boolean {
	if (typeof value !== "boolean") {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return value;
}

function frozenTextSearchMaxResults(maxResults: unknown): number {
	if (
		typeof maxResults !== "number" ||
		!Number.isSafeInteger(maxResults) ||
		maxResults < 0
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return Math.min(Math.max(maxResults, 1), MAX_TEXT_SEARCH_RESULTS_HARD_CAP);
}

function frozenTextSearchMaxFileSize(maxFileSize: unknown): number | null {
	if (maxFileSize === null || maxFileSize === undefined) {
		return null;
	}
	if (
		typeof maxFileSize !== "number" ||
		!Number.isSafeInteger(maxFileSize) ||
		maxFileSize < 0
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return Math.min(
		Math.max(maxFileSize, 1),
		MAX_TEXT_SEARCH_MAX_FILE_SIZE_HARD_CAP,
	);
}

function frozenTextSearchCursor(cursor: unknown): number {
	if (
		typeof cursor !== "number" ||
		!Number.isSafeInteger(cursor) ||
		cursor < 0
	) {
		return requestViolation(
			"INVALID_SEARCH_REQUEST",
			"The workspace text search request is invalid.",
		);
	}
	return cursor;
}

/**
 * Validates and freezes a `workspace_search_text_start` request's own-data
 * fields, independent of transport — the same shared-by-both-transports
 * pattern `frozenWorkspaceSearchFilesRequest` already establishes.
 */
export function frozenWorkspaceSearchTextStartRequest(
	roots: unknown,
	pattern: unknown,
	isRegExp: unknown,
	isCaseSensitive: unknown,
	isWordMatch: unknown,
	excludeGlobs: unknown,
	maxResults: unknown,
	maxFileSize: unknown,
): WorkspaceSearchTextStartRequest {
	return Object.freeze({
		roots: frozenSearchRoots(roots),
		pattern: frozenTextSearchPattern(pattern),
		isRegExp: frozenStrictBoolean(isRegExp),
		isCaseSensitive: frozenStrictBoolean(isCaseSensitive),
		isWordMatch: frozenStrictBoolean(isWordMatch),
		excludeGlobs: frozenSearchExcludeGlobs(excludeGlobs),
		maxResults: frozenTextSearchMaxResults(maxResults),
		maxFileSize: frozenTextSearchMaxFileSize(maxFileSize),
	});
}

/**
 * Decodes a `workspace_search_text_start` response: an own-data, exactly
 * `{ searchId }` object.
 */
export function decodeWorkspaceSearchTextStartResult(
	value: unknown,
): WorkspaceSearchTextStartResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["searchId"])) {
		return violation();
	}
	if (!isUuidV4(value.searchId)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ searchId: value.searchId });
}

export function frozenWorkspaceSearchTextPollRequest(
	searchId: unknown,
	cursor: unknown,
): Readonly<{ searchId: string; cursor: number }> {
	return Object.freeze({
		searchId: frozenSearchId(searchId),
		cursor: frozenTextSearchCursor(cursor),
	});
}

export function frozenWorkspaceSearchTextCancelRequest(
	searchId: unknown,
): Readonly<{ searchId: string }> {
	return Object.freeze({ searchId: frozenSearchId(searchId) });
}

/**
 * Validates and freezes an own-data array of plain objects, each decoded by
 * `decodeElement`. Generalizes `ownStringArraySnapshot`'s own-data rigor
 * (exact `Array.prototype`, exact-count property descriptors, no getters)
 * to elements that are themselves objects rather than bare strings.
 */
function ownObjectArraySnapshot<T>(
	value: unknown,
	maxLength: number,
	decodeElement: (element: unknown) => T,
): readonly T[] {
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

	const items: T[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = (descriptors as Record<string, PropertyDescriptor>)[
			String(index)
		];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
		items.push(decodeElement(descriptor.value));
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze(items);
}

function decodeTextSearchMatch(value: unknown): WorkspaceSearchTextMatch {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"line",
			"column",
			"length",
			"previewText",
			"absoluteColumn",
		])
	) {
		return violation();
	}
	if (
		!isSafeNonNegativeInteger(value.line) ||
		!isSafeNonNegativeInteger(value.column) ||
		!isSafeNonNegativeInteger(value.length) ||
		!isSafeNonNegativeInteger(value.absoluteColumn)
	) {
		return violation();
	}
	if (
		typeof value.previewText !== "string" ||
		value.previewText.length > TEXT_SEARCH_PREVIEW_MAX_UTF16_UNITS
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		line: value.line,
		column: value.column,
		length: value.length,
		previewText: value.previewText,
		absoluteColumn: value.absoluteColumn,
	});
}

function decodeTextSearchBatch(value: unknown): WorkspaceSearchTextBatch {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["rootId", "path", "matches"])
	) {
		return violation();
	}
	if (
		!isUuidV4(value.rootId) ||
		typeof value.path !== "string" ||
		value.path.length === 0 ||
		value.path.length > MAX_SEARCH_PATTERN_BYTES
	) {
		return violation();
	}
	const matches = ownObjectArraySnapshot(
		value.matches,
		MAX_TEXT_SEARCH_RESULTS_HARD_CAP,
		decodeTextSearchMatch,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ rootId: value.rootId, path: value.path, matches });
}

function decodeTextSearchSkipped(value: unknown): WorkspaceSearchTextSkipped {
	if (!isPlainObject(value) || !hasExactKeys(value, ["binary", "oversize"])) {
		return violation();
	}
	if (
		!isSafeNonNegativeInteger(value.binary) ||
		!isSafeNonNegativeInteger(value.oversize)
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ binary: value.binary, oversize: value.oversize });
}

/**
 * Decodes a `workspace_search_text_poll` response: an own-data, exactly
 * `{ batches, nextCursor, done, limitHit, skipped }` object.
 */
export function decodeWorkspaceSearchTextPollResult(
	value: unknown,
): WorkspaceSearchTextPollResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"batches",
			"nextCursor",
			"done",
			"limitHit",
			"skipped",
		])
	) {
		return violation();
	}
	const batches = ownObjectArraySnapshot(
		value.batches,
		MAX_TEXT_SEARCH_BATCHES_PER_POLL,
		decodeTextSearchBatch,
	);
	if (!isSafeNonNegativeInteger(value.nextCursor)) {
		return violation();
	}
	if (typeof value.done !== "boolean" || typeof value.limitHit !== "boolean") {
		return violation();
	}
	const skipped = decodeTextSearchSkipped(value.skipped);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		batches,
		nextCursor: value.nextCursor,
		done: value.done,
		limitHit: value.limitHit,
		skipped,
	});
}

/**
 * Decodes a `workspace_search_text_wake` event payload: an own-data, exactly
 * `{ searchId }` object.
 */
export function decodeWorkspaceSearchTextWakeEvent(
	value: unknown,
): WorkspaceSearchTextWakeEvent {
	if (!isPlainObject(value) || !hasExactKeys(value, ["searchId"])) {
		return violation();
	}
	if (!isUuidV4(value.searchId)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ searchId: value.searchId });
}

/**
 * Builds a frozen `workspace_search_text_poll` response directly, for the
 * browser mock (which has no wire boundary to round-trip through).
 */
export function frozenWorkspaceSearchTextPollResult(
	batches: readonly {
		readonly rootId: string;
		readonly path: string;
		readonly matches: readonly WorkspaceSearchTextMatch[];
	}[],
	nextCursor: number,
	done: boolean,
	limitHit: boolean,
	skipped: WorkspaceSearchTextSkipped,
): WorkspaceSearchTextPollResult {
	return decodeWorkspaceSearchTextPollResult({
		batches: batches.map((batch) => ({
			rootId: batch.rootId,
			path: batch.path,
			matches: batch.matches.map((match) => ({ ...match })),
		})),
		nextCursor,
		done,
		limitHit,
		skipped: { ...skipped },
	});
}
