import type {
	TerminalCell,
	TerminalColors,
	TerminalCursor,
	TerminalCursorStyle,
	TerminalCursorViewport,
	TerminalDataEvent,
	TerminalDirty,
	TerminalExitEvent,
	TerminalFrame,
	TerminalLifecycleMarkerResult,
	TerminalProfile,
	TerminalProfilesResult,
	TerminalRgb,
	TerminalRow,
	TerminalRowSemanticPrompt,
	TerminalScrollbackCell,
	TerminalScrollbackResult,
	TerminalScrollbackRow,
	TerminalSemanticContent,
	TerminalShellIntegrationStatus,
	TerminalStartResult,
	TerminalStyle,
	TerminalUnderline,
	WorkspaceTrustState,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Mirrors `terminal::dto::MAX_TERMINAL_DIMENSION`. */
const MAX_TERMINAL_DIMENSION = 2_000;
/** Mirrors `terminal::dto::MAX_TERMINAL_INPUT_BYTES` — a UTF-8 byte-length
 * ceiling on `terminal_input_text`'s `text` field. */
const MAX_TERMINAL_INPUT_BYTES = 1_024 * 1_024;
/** Mirrors `terminal::dto::MAX_TERMINAL_KEY_UTF8_BYTES`. */
const MAX_TERMINAL_KEY_UTF8_BYTES = 64;
/** Mirrors `terminal::dto::MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS`. */
const MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS = 10_000;
const MAX_TERMINAL_PROFILE_ID_BYTES = 64;
const MAX_TERMINAL_PROFILE_LABEL_BYTES = 256;
const MAX_TERMINAL_PROFILES = 32;
const MAX_TERMINAL_CWD_BYTES = 4_096;
/** `F190` S6 "真实 exit banner": generous ceiling on a real signal name's
 * UTF-8 byte length (portable_pty's own `strsignal`-derived strings — e.g.
 * `"Killed: 9"` — are a handful of bytes; a hostile-input backstop, not an
 * expected value) — mirrors `terminal::dto`'s own defensive-ceiling
 * precedent for every other native-issued string this codec decodes. */
const MAX_TERMINAL_EXIT_SIGNAL_BYTES = 256;
/** Defensive ceiling on `terminal_lifecycle_marker`'s `nonRestorableCount` —
 * matches `MAX_TERMINAL_SESSIONS_PER_WINDOW` in spirit (this count can never
 * exceed however many sessions a single window could ever have accumulated
 * without an explicit close), generous enough it never needs to track that
 * constant exactly.
 */
const MAX_TERMINAL_NON_RESTORABLE_COUNT = 4_096;
/** A frame can never report more rows than `MAX_TERMINAL_DIMENSION`, nor a
 * row more cells than that same bound (it doubles as the max column count
 * `terminal_start`/`terminal_resize` accept). */
const MAX_TERMINAL_ROWS_PER_FRAME = MAX_TERMINAL_DIMENSION;
const MAX_TERMINAL_CELLS_PER_ROW = MAX_TERMINAL_DIMENSION;
/** `action`/`key`'s wire type is Rust's `u32`; anything outside this range
 * could never deserialize there. */
const MAX_U32 = 0xff_ff_ff_ff;
/** `mods`'s wire type is Rust's `u16`. */
const MAX_U16 = 0xff_ff;

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain terminal contract.";

const textEncoder = new TextEncoder();

function utf8ByteLength(text: string): number {
	return textEncoder.encode(text).length;
}

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

/**
 * Validates and freezes an own-data array of plain objects, each decoded by
 * `decodeElement`. Mirrors `search-codec.ts`'s `ownObjectArraySnapshot`:
 * exact `Array.prototype`, exact-count property descriptors, no getters —
 * so a Proxy or a sparse/getter-laden array cannot lie about its own
 * length or elements.
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

function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function frozenSessionId(value: unknown): string {
	if (!isUuidV4(value)) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenRootId(value: unknown): string {
	if (!isUuidV4(value)) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenCwd(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		utf8ByteLength(value) > MAX_TERMINAL_CWD_BYTES ||
		value.includes("\0") ||
		/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)
	) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenProfileId(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		utf8ByteLength(value) > MAX_TERMINAL_PROFILE_ID_BYTES ||
		!/^[A-Za-z0-9.-]+$/.test(value)
	) {
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

function frozenU32(value: unknown): number {
	if (!isSafeNonNegativeInteger(value) || value > MAX_U32) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenU16(value: unknown): number {
	if (!isSafeNonNegativeInteger(value) || value > MAX_U16) {
		return invalidTerminalRequest();
	}
	return value;
}

function frozenSequence(value: unknown): number {
	if (!isSafeNonNegativeInteger(value)) {
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
 * Validates and freezes a `terminal_start` request's own-data fields,
 * independent of transport — shared by the native encoder (which forwards
 * the frozen object as-is to `invoke`) and the browser mock, so both
 * transports reject the same hostile inputs identically.
 */
interface FrozenTerminalStartRequest {
	readonly rootId: string;
	readonly profileId: string;
	readonly cwd: string | null;
	readonly cols: number;
	readonly rows: number;
}

export function frozenTerminalStartRequest(
	rootId: unknown,
	profileId: unknown,
	cwd: unknown,
	cols: unknown,
	rows: unknown,
): FrozenTerminalStartRequest {
	return Object.freeze({
		rootId: frozenRootId(rootId),
		profileId: frozenProfileId(profileId),
		cwd: frozenCwd(cwd),
		cols: frozenDimension(cols),
		rows: frozenDimension(rows),
	});
}

export function frozenTerminalProfilesRequest(): Readonly<
	Record<never, never>
> {
	return Object.freeze({});
}

/** `F190` S6: `terminal_lifecycle_marker`'s request is empty — the window
 * itself is this call's whole subject, supplied natively by Tauri's own
 * `WebviewWindow` extractor, never by this request body. */
export function frozenTerminalLifecycleMarkerRequest(): Readonly<
	Record<never, never>
> {
	return Object.freeze({});
}

/**
 * Validates a `terminal_input_text` request: raw text (an IME composition
 * commit, or a pasted block) written to the pty as its own UTF-8 bytes.
 */
export function frozenTerminalInputTextRequest(
	sessionId: unknown,
	text: unknown,
): Readonly<{ sessionId: string; text: string }> {
	const validSessionId = frozenSessionId(sessionId);
	if (
		typeof text !== "string" ||
		utf8ByteLength(text) > MAX_TERMINAL_INPUT_BYTES
	) {
		return invalidTerminalRequest();
	}
	return Object.freeze({ sessionId: validSessionId, text });
}

/**
 * Validates a `terminal_input_key` request. `action`/`key` are the literal
 * `libghostty_vt::key::{Action,Key}` `#[repr(u32)]` enum discriminant
 * values — this codec only checks they are in-range `u32`s, not that they
 * name a currently-defined variant (Rust's own `TryFrom` is the
 * authoritative check for that; duplicating its ~180-variant vocabulary
 * here would be pure churn for no additional safety, since an out-of-range
 * value is rejected by Rust either way). `mods` is a `u16` bitmask.
 */
export function frozenTerminalInputKeyRequest(
	sessionId: unknown,
	action: unknown,
	key: unknown,
	mods: unknown,
	utf8: unknown,
): Readonly<{
	sessionId: string;
	action: number;
	key: number;
	mods: number;
	utf8: string | null;
}> {
	const validSessionId = frozenSessionId(sessionId);
	const validAction = frozenU32(action);
	const validKey = frozenU32(key);
	const validMods = frozenU16(mods);
	let validUtf8: string | null;
	if (utf8 === null || utf8 === undefined) {
		validUtf8 = null;
	} else if (
		typeof utf8 === "string" &&
		utf8ByteLength(utf8) <= MAX_TERMINAL_KEY_UTF8_BYTES
	) {
		validUtf8 = utf8;
	} else {
		return invalidTerminalRequest();
	}
	return Object.freeze({
		sessionId: validSessionId,
		action: validAction,
		key: validKey,
		mods: validMods,
		utf8: validUtf8,
	});
}

export function frozenTerminalFocusRequest(
	sessionId: unknown,
	focused: unknown,
): Readonly<{ sessionId: string; focused: boolean }> {
	const validSessionId = frozenSessionId(sessionId);
	if (typeof focused !== "boolean") {
		return invalidTerminalRequest();
	}
	return Object.freeze({ sessionId: validSessionId, focused });
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

/**
 * Validates a `terminal_ack` request. `sequence` acknowledges every
 * `plain://terminal-data` frame up through it — **not** a byte count (see
 * `src-tauri/src/terminal/dto.rs`'s `TerminalAckRequest` doc comment for
 * why this changed from S2's `byteCount`).
 */
export function frozenTerminalAckRequest(
	sessionId: unknown,
	sequence: unknown,
): Readonly<{ sessionId: string; sequence: number }> {
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		sequence: frozenSequence(sequence),
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

function frozenExternalLinkUrl(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		utf8ByteLength(value) > MAX_TERMINAL_EXTERNAL_LINK_BYTES ||
		value.includes("\0") ||
		!(value.startsWith("http://") || value.startsWith("https://"))
	) {
		return invalidTerminalRequest();
	}
	return value;
}

/**
 * Validates a `terminal_open_external_link` request — mirrors
 * `src-tauri/src/terminal/dto.rs`'s `TerminalOpenExternalLinkRequest::into_parts`
 * exactly (non-empty, size-bounded, no NUL, `http://`/`https://` only).
 * This is the request-encode-side check; the renderer's own click policy
 * (only `http:`/`https:` cells are ever clickable in the first place) is a
 * separate, earlier gate — this one exists so native/mock transports reject
 * the same hostile input identically even if that renderer gate were ever
 * bypassed.
 */
export function frozenTerminalOpenExternalLinkRequest(
	url: unknown,
): Readonly<{ url: string }> {
	return Object.freeze({ url: frozenExternalLinkUrl(url) });
}

/** Validates a `terminal_scrollback` request. */
export function frozenTerminalScrollbackRequest(
	sessionId: unknown,
	start: unknown,
	count: unknown,
): Readonly<{ sessionId: string; start: number; count: number }> {
	const validSessionId = frozenSessionId(sessionId);
	if (!isSafeNonNegativeInteger(start)) {
		return invalidTerminalRequest();
	}
	if (
		typeof count !== "number" ||
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		count > MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS
	) {
		return invalidTerminalRequest();
	}
	return Object.freeze({ sessionId: validSessionId, start, count });
}

/**
 * Decodes a `terminal_start` response: an own-data, exactly
 * `{ sessionId, shellIntegration }` object.
 */
export function decodeTerminalStartResult(value: unknown): TerminalStartResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "shellIntegration"])
	) {
		return violation();
	}
	if (!isUuidV4(value.sessionId)) {
		return violation();
	}
	if (!isOneOf(value.shellIntegration, SHELL_INTEGRATION_STATUS_VALUES)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		sessionId: value.sessionId,
		shellIntegration: value.shellIntegration,
	});
}

function decodeTerminalProfile(value: unknown): TerminalProfile {
	if (!isPlainObject(value) || !hasExactKeys(value, ["id", "label"])) {
		return violation();
	}
	let id: string;
	try {
		id = frozenProfileId(value.id);
	} catch {
		return violation();
	}
	if (
		typeof value.label !== "string" ||
		value.label.length === 0 ||
		utf8ByteLength(value.label) > MAX_TERMINAL_PROFILE_LABEL_BYTES ||
		Array.from(value.label).some((character) => {
			const codepoint = character.codePointAt(0)!;
			return codepoint <= 0x1f || codepoint === 0x7f;
		})
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ id, label: value.label });
}

export function decodeTerminalProfilesResult(
	value: unknown,
): TerminalProfilesResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["profiles", "defaultProfileId"])
	) {
		return violation();
	}
	const profiles = ownObjectArraySnapshot(
		value.profiles,
		MAX_TERMINAL_PROFILES,
		decodeTerminalProfile,
	);
	if (profiles.length === 0) {
		return violation();
	}
	let defaultProfileId: string;
	try {
		defaultProfileId = frozenProfileId(value.defaultProfileId);
	} catch {
		return violation();
	}
	const ids = new Set(profiles.map((profile) => profile.id));
	if (ids.size !== profiles.length || !ids.has(defaultProfileId)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ profiles, defaultProfileId });
}

/** Decodes the `void` (JSON `null`) result of `terminal_input_text`/
 * `terminal_input_key`/`terminal_focus`/`terminal_resize`/`terminal_ack`/
 * `terminal_kill`. */
export function decodeTerminalVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

/** Decodes a `terminal_lifecycle_marker` response: an own-data, exactly
 * `{ nonRestorableCount }` object whose value is a bounded non-negative
 * integer. */
export function decodeTerminalLifecycleMarkerResult(
	value: unknown,
): TerminalLifecycleMarkerResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["nonRestorableCount"])) {
		return violation();
	}
	const { nonRestorableCount } = value;
	if (
		typeof nonRestorableCount !== "number" ||
		!Number.isSafeInteger(nonRestorableCount) ||
		nonRestorableCount < 0 ||
		nonRestorableCount > MAX_TERMINAL_NON_RESTORABLE_COUNT
	) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ nonRestorableCount });
}

const UNDERLINE_VALUES: readonly TerminalUnderline[] = Object.freeze([
	"none",
	"single",
	"double",
	"curly",
	"dotted",
	"dashed",
]);
const CURSOR_STYLE_VALUES: readonly TerminalCursorStyle[] = Object.freeze([
	"bar",
	"block",
	"underline",
	"blockHollow",
]);
const DIRTY_VALUES: readonly TerminalDirty[] = Object.freeze([
	"clean",
	"partial",
	"full",
]);
const SEMANTIC_CONTENT_VALUES: readonly TerminalSemanticContent[] =
	Object.freeze(["output", "input", "prompt"]);
const ROW_SEMANTIC_PROMPT_VALUES: readonly TerminalRowSemanticPrompt[] =
	Object.freeze(["none", "prompt", "continuation"]);
const SHELL_INTEGRATION_STATUS_VALUES: readonly TerminalShellIntegrationStatus[] =
	Object.freeze(["injected", "unsupportedShell"]);
/** Mirrors `terminal::dto::MAX_TERMINAL_EXTERNAL_LINK_BYTES`. */
const MAX_TERMINAL_EXTERNAL_LINK_BYTES = 8_192;

function isOneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
): value is T {
	return (
		typeof value === "string" && (allowed as readonly string[]).includes(value)
	);
}

function isByteValue(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= 255
	);
}

function decodeRgb(value: unknown): TerminalRgb {
	if (!isPlainObject(value) || !hasExactKeys(value, ["r", "g", "b"])) {
		return violation();
	}
	if (!isByteValue(value.r) || !isByteValue(value.g) || !isByteValue(value.b)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ r: value.r, g: value.g, b: value.b });
}

function decodeNullableRgb(value: unknown): TerminalRgb | null {
	if (value === null) {
		return null;
	}
	return decodeRgb(value);
}

function decodeUnderline(value: unknown): TerminalUnderline {
	if (!isOneOf(value, UNDERLINE_VALUES)) {
		return violation();
	}
	return value;
}

const STYLE_BOOLEAN_KEYS = Object.freeze([
	"bold",
	"italic",
	"faint",
	"blink",
	"inverse",
	"invisible",
	"strikethrough",
	"overline",
] as const);

function decodeStyle(value: unknown): TerminalStyle {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [...STYLE_BOOLEAN_KEYS, "underline"])
	) {
		return violation();
	}
	for (const key of STYLE_BOOLEAN_KEYS) {
		if (typeof value[key] !== "boolean") {
			return violation();
		}
	}
	const underline = decodeUnderline(value.underline);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		bold: value.bold as boolean,
		italic: value.italic as boolean,
		faint: value.faint as boolean,
		blink: value.blink as boolean,
		inverse: value.inverse as boolean,
		invisible: value.invisible as boolean,
		strikethrough: value.strikethrough as boolean,
		overline: value.overline as boolean,
		underline,
	});
}

function decodeNullableHyperlink(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return violation();
	}
	return value;
}

function decodeCell(value: unknown): TerminalCell {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"graphemes",
			"fg",
			"bg",
			"style",
			"hyperlink",
			"semantic",
		])
	) {
		return violation();
	}
	if (typeof value.graphemes !== "string") {
		return violation();
	}
	const fg = decodeNullableRgb(value.fg);
	const bg = decodeNullableRgb(value.bg);
	const style = decodeStyle(value.style);
	const hyperlink = decodeNullableHyperlink(value.hyperlink);
	if (!isOneOf(value.semantic, SEMANTIC_CONTENT_VALUES)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		graphemes: value.graphemes,
		fg,
		bg,
		style,
		hyperlink,
		semantic: value.semantic,
	});
}

function decodeRow(value: unknown): TerminalRow {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["rowIndex", "semanticPrompt", "cells"])
	) {
		return violation();
	}
	if (!isSafeNonNegativeInteger(value.rowIndex)) {
		return violation();
	}
	if (!isOneOf(value.semanticPrompt, ROW_SEMANTIC_PROMPT_VALUES)) {
		return violation();
	}
	const cells = ownObjectArraySnapshot(
		value.cells,
		MAX_TERMINAL_CELLS_PER_ROW,
		decodeCell,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		rowIndex: value.rowIndex,
		semanticPrompt: value.semanticPrompt,
		cells,
	});
}

function decodeCursorViewport(value: unknown): TerminalCursorViewport {
	if (!isPlainObject(value) || !hasExactKeys(value, ["x", "y", "atWideTail"])) {
		return violation();
	}
	if (
		!isSafeNonNegativeInteger(value.x) ||
		!isSafeNonNegativeInteger(value.y)
	) {
		return violation();
	}
	if (typeof value.atWideTail !== "boolean") {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		x: value.x,
		y: value.y,
		atWideTail: value.atWideTail,
	});
}

function decodeCursor(value: unknown): TerminalCursor {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["visible", "blinking", "viewport", "style"])
	) {
		return violation();
	}
	if (
		typeof value.visible !== "boolean" ||
		typeof value.blinking !== "boolean"
	) {
		return violation();
	}
	const viewport =
		value.viewport === null ? null : decodeCursorViewport(value.viewport);
	if (!isOneOf(value.style, CURSOR_STYLE_VALUES)) {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		visible: value.visible,
		blinking: value.blinking,
		viewport,
		style: value.style,
	});
}

function decodeColors(value: unknown): TerminalColors {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["background", "foreground", "cursor"])
	) {
		return violation();
	}
	const background = decodeRgb(value.background);
	const foreground = decodeRgb(value.foreground);
	const cursor = decodeNullableRgb(value.cursor);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ background, foreground, cursor });
}

function decodeNullablePwd(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return violation();
	}
	return value;
}

function decodeFrame(value: unknown): TerminalFrame {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"dirty",
			"cols",
			"rows",
			"cursor",
			"colors",
			"rowsData",
			"pwd",
		])
	) {
		return violation();
	}
	if (!isOneOf(value.dirty, DIRTY_VALUES)) {
		return violation();
	}
	const cols = frozenDimensionForDecode(value.cols);
	const rows = frozenDimensionForDecode(value.rows);
	const cursor = decodeCursor(value.cursor);
	const colors = decodeColors(value.colors);
	const rowsData = ownObjectArraySnapshot(
		value.rowsData,
		MAX_TERMINAL_ROWS_PER_FRAME,
		decodeRow,
	);
	const pwd = decodeNullablePwd(value.pwd);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		dirty: value.dirty,
		cols,
		rows,
		cursor,
		colors,
		rowsData,
		pwd,
	});
}

/** Same dimension bound as request-side validation, but reports a decode
 * `violation()` (an untrusted-response contract break) rather than an
 * `INVALID_TERMINAL_REQUEST` (an outgoing-request rejection) — the two
 * error shapes this file distinguishes throughout. */
function frozenDimensionForDecode(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value <= 0 ||
		value > MAX_TERMINAL_DIMENSION
	) {
		return violation();
	}
	return value;
}

/**
 * Decodes a `plain://terminal-data` event payload: an own-data, exactly
 * `{ sessionId, sequence, frame }` object, `frame` recursively validated
 * field-by-field (see `decodeFrame`).
 */
export function decodeTerminalDataEvent(value: unknown): TerminalDataEvent {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "sequence", "frame"])
	) {
		return violation();
	}
	if (!isUuidV4(value.sessionId)) {
		return violation();
	}
	if (!isSafeNonNegativeInteger(value.sequence)) {
		return violation();
	}
	const frame = decodeFrame(value.frame);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		sessionId: value.sessionId,
		sequence: value.sequence,
		frame,
	});
}

/**
 * Builds a frozen `TerminalDataEvent` directly from an already-shaped
 * `frame` value, for the browser mock — which has no wire boundary to
 * round-trip through. Reuses `decodeFrame`'s exact validation (so a mock
 * bug that produces a malformed frame fails loudly, the same as a real
 * malformed wire payload would), mirroring `search-codec.ts`'s
 * `frozenWorkspaceSearchFilesResult`'s own "for-the-mock, skips the wire
 * encoding" precedent.
 */
export function frozenTerminalDataEvent(
	sessionId: unknown,
	sequence: unknown,
	frame: unknown,
): TerminalDataEvent {
	if (!isUuidV4(sessionId)) {
		return violation();
	}
	if (!isSafeNonNegativeInteger(sequence)) {
		return violation();
	}
	const decodedFrame = decodeFrame(frame);
	return Object.freeze({ sessionId, sequence, frame: decodedFrame });
}

/**
 * Builds a frozen `TerminalExitEvent` directly, for the browser mock — same
 * "no wire boundary to round-trip through" rationale as
 * [`frozenTerminalDataEvent`].
 */
/** Shared by [`frozenTerminalExitEvent`]/[`decodeTerminalExitEvent`]: `null`
 * (a normal exit) or a non-empty, byte-bounded signal name. */
function isValidExitSignal(value: unknown): value is string | null {
	if (value === null) {
		return true;
	}
	return (
		typeof value === "string" &&
		value.length > 0 &&
		utf8ByteLength(value) <= MAX_TERMINAL_EXIT_SIGNAL_BYTES
	);
}

export function frozenTerminalExitEvent(
	sessionId: unknown,
	exitCode: unknown,
	signal: unknown,
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
	if (!isValidExitSignal(signal)) {
		return violation();
	}
	return Object.freeze({ sessionId, exitCode, signal });
}

/**
 * Decodes a `plain://terminal-exit` event payload: an own-data, exactly
 * `{ sessionId, exitCode, signal }` object. `F190` S6: `signal` is `null`
 * for a normal exit (`exitCode` alone is then the real exit status) or a
 * real signal name, in which case `exitCode` is not meaningful on its own
 * — see `TerminalExitEvent`'s own doc comment.
 */
export function decodeTerminalExitEvent(value: unknown): TerminalExitEvent {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "exitCode", "signal"])
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
	if (!isValidExitSignal(value.signal)) {
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
		signal: value.signal,
	});
}

function decodeScrollbackCell(value: unknown): TerminalScrollbackCell {
	if (!isPlainObject(value) || !hasExactKeys(value, ["graphemes", "style"])) {
		return violation();
	}
	if (typeof value.graphemes !== "string") {
		return violation();
	}
	const style = decodeStyle(value.style);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ graphemes: value.graphemes, style });
}

function decodeScrollbackRow(value: unknown): TerminalScrollbackRow {
	if (!isPlainObject(value) || !hasExactKeys(value, ["rowIndex", "cells"])) {
		return violation();
	}
	if (!isSafeNonNegativeInteger(value.rowIndex)) {
		return violation();
	}
	const cells = ownObjectArraySnapshot(
		value.cells,
		MAX_TERMINAL_CELLS_PER_ROW,
		decodeScrollbackCell,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ rowIndex: value.rowIndex, cells });
}

/** Decodes a `terminal_scrollback` response. */
export function decodeTerminalScrollbackResult(
	value: unknown,
): TerminalScrollbackResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["rows"])) {
		return violation();
	}
	const rows = ownObjectArraySnapshot(
		value.rows,
		MAX_TERMINAL_SCROLLBACK_REQUEST_ROWS,
		decodeScrollbackRow,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ rows });
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
