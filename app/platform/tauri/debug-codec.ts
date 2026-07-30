import type {
	DebugAdapterConfirmationState,
	DebugAdapterConfirmationSubject,
	DebugAdapterTarget,
	DebugBreakpointRequest,
	DebugBreakpointResult,
	DebugContinueResult,
	DebugEvaluateContext,
	DebugEvaluateResult,
	DebugEventPayload,
	DebugScope,
	DebugScopesResult,
	DebugSessionStartResult,
	DebugSetBreakpointsResult,
	DebugStackFrame,
	DebugStackTraceResult,
	DebugVariable,
	DebugVariablesFilter,
	DebugVariablesResult,
} from "./contracts";

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain debug contract.";

class DebugIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "DebugIpcContractViolation";
	}
}

function violation(): never {
	throw new DebugIpcContractViolation();
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

// Defensive encode-side ceilings — mirrors `src-tauri/src/debug/confirm_store.rs`'s
// own `MAX_CONFIRMATION_ENTRY_BYTES` intent (a hostile-input bound, not an
// expected value): real adapter argv lists are a handful of short flags.
const MAX_DEBUG_ADAPTER_COMMAND_CHARS = 4_096;
const MAX_DEBUG_ADAPTER_ARG_CHARS = 4_096;
const MAX_DEBUG_ADAPTER_ARGS = 256;

// `F100` S3 — the real session-lifecycle/interactive-debugging ceilings.
// Every one below mirrors a same-named (or clearly corresponding) Rust
// constant in `src-tauri/src/debug/dto.rs` — a hostile-input backstop, not an
// expected value (the framing layer's own `MAX_DAP_MESSAGE_BYTES` is the
// systemic ceiling on total wire message size; these exist purely to fail
// fast on the frontend before ever building an IPC call).
const MAX_DEBUG_ADAPTER_ID_CHARS = 4_096;
const MAX_DEBUG_ADAPTER_HOST_CHARS = 1_024;
const MAX_DEBUG_PATH_CHARS = 65_536;
/** Mirrors `debug::dto::MAX_DEBUG_SET_BREAKPOINTS_ENTRIES`. */
const MAX_DEBUG_BREAKPOINTS_PER_REQUEST = 4_096;
const MAX_DEBUG_BREAKPOINT_TEXT_CHARS = 8_192;
/** No corresponding Rust ceiling (the framing layer's byte cap is the real
 * limit) — generous purely so a genuinely large call stack/variable page
 * still decodes instead of being rejected by this layer itself. */
const MAX_DEBUG_STACK_FRAMES = 1_000_000;
const MAX_DEBUG_SCOPES = 4_096;
const MAX_DEBUG_VARIABLES = 1_000_000;
/** Mirrors `debug::dto::MAX_DEBUG_EVALUATE_EXPRESSION_BYTES` — a UTF-8
 * byte-length ceiling, like `terminal-codec.ts`'s own `MAX_TERMINAL_INPUT_BYTES`. */
const MAX_DEBUG_EVALUATE_EXPRESSION_BYTES = 8_192;

const textEncoder = new TextEncoder();

function utf8ByteLength(text: string): number {
	return textEncoder.encode(text).length;
}

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Validates and freezes an own-data array of plain objects, each decoded by
 * `decodeElement` — mirrors `terminal-codec.ts`'s identical
 * `ownObjectArraySnapshot`: exact `Array.prototype`, exact-count property
 * descriptors, no getters, so a Proxy or a sparse/getter-laden array cannot
 * lie about its own length or elements.
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

function debugSessionRequestInvalid(): never {
	return requestViolation(
		"DEBUG_SESSION_REQUEST_INVALID",
		"The debug session request is missing required fields or exceeds a size limit.",
	);
}

function debugAdapterConfirmationRequestInvalid(): never {
	return requestViolation(
		"DEBUG_ADAPTER_CONFIRMATION_INVALID_REQUEST",
		"The debug adapter confirmation subject is invalid.",
	);
}

/**
 * Encodes/validates the `(command, args, transport)` triple sent to all
 * three `debug_adapter_confirmation_*` Tauri commands — the sole encode path
 * for this request shape, mirroring every other `frozenGit*Request`'s
 * "validate untyped caller input before it reaches `invoke`" precedent.
 */
export function frozenDebugAdapterConfirmationRequest(
	descriptor: unknown,
): DebugAdapterConfirmationSubject {
	if (!isPlainObject(descriptor)) {
		return debugAdapterConfirmationRequestInvalid();
	}
	const { command, args, transport } = descriptor;
	if (
		typeof command !== "string" ||
		command.length === 0 ||
		command.length > MAX_DEBUG_ADAPTER_COMMAND_CHARS
	) {
		return debugAdapterConfirmationRequestInvalid();
	}
	if (!Array.isArray(args) || args.length > MAX_DEBUG_ADAPTER_ARGS) {
		return debugAdapterConfirmationRequestInvalid();
	}
	const frozenArgs: string[] = [];
	for (const element of args) {
		if (
			typeof element !== "string" ||
			element.length > MAX_DEBUG_ADAPTER_ARG_CHARS
		) {
			return debugAdapterConfirmationRequestInvalid();
		}
		frozenArgs.push(element);
	}
	if (transport !== "stdio" && transport !== "tcp") {
		return debugAdapterConfirmationRequestInvalid();
	}
	return Object.freeze({
		command,
		args: Object.freeze(frozenArgs),
		transport,
	});
}

/**
 * Decodes a `debug_adapter_confirmation_state` response: an own-data,
 * exactly `{ confirmed }` object — mirrors
 * `terminal-codec.ts`'s `decodeWorkspaceTrustState`.
 */
export function decodeDebugAdapterConfirmationState(
	value: unknown,
): DebugAdapterConfirmationState {
	if (!isPlainObject(value) || !hasExactKeys(value, ["confirmed"])) {
		return violation();
	}
	if (typeof value.confirmed !== "boolean") {
		return violation();
	}
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ confirmed: value.confirmed });
}

/** Decodes the `void` (JSON `null`) result of `debug_adapter_confirmation_grant`/
 * `debug_adapter_confirmation_revoke`. */
export function decodeDebugAdapterConfirmationVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

// ---------------------------------------------------------------------
// `F100` S3 — real session-lifecycle and interactive-debugging encode/decode.
// ---------------------------------------------------------------------

function frozenSessionId(value: unknown): string {
	if (!isUuidV4(value)) {
		return debugSessionRequestInvalid();
	}
	return value;
}

/**
 * Encodes `debug_launch`/`debug_attach`'s shared request shape from a
 * type-safe `DebugAdapterTarget` — see that type's own doc comment for why an
 * invalid transport/host/port combination is unrepresentable here rather
 * than merely rejected. `initialBreakpoints` is always sent as an empty
 * array: this codebase's own launch orchestration
 * (`plain-debug-session.ts`) syncs every breakpoint through
 * `debugSetBreakpoints` instead, whether set before or after the session
 * starts, so this encoder never needs to duplicate that serialization here.
 */
export function frozenDebugSessionStartRequest(
	target: DebugAdapterTarget,
	adapterId: string,
	launchArguments: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (
		typeof target.command !== "string" ||
		target.command.length === 0 ||
		target.command.length > MAX_DEBUG_ADAPTER_COMMAND_CHARS
	) {
		return debugSessionRequestInvalid();
	}
	if (
		!Array.isArray(target.args) ||
		target.args.length > MAX_DEBUG_ADAPTER_ARGS
	) {
		return debugSessionRequestInvalid();
	}
	const frozenArgs: string[] = [];
	for (const element of target.args) {
		if (
			typeof element !== "string" ||
			element.length > MAX_DEBUG_ADAPTER_ARG_CHARS
		) {
			return debugSessionRequestInvalid();
		}
		frozenArgs.push(element);
	}
	if (
		typeof adapterId !== "string" ||
		adapterId.length === 0 ||
		adapterId.length > MAX_DEBUG_ADAPTER_ID_CHARS
	) {
		return debugSessionRequestInvalid();
	}
	if (!isPlainObject(launchArguments)) {
		return debugSessionRequestInvalid();
	}
	try {
		rejectProxyObject(launchArguments);
	} catch {
		return debugSessionRequestInvalid();
	}
	const base = {
		transport: target.transport,
		command: target.command,
		args: Object.freeze(frozenArgs),
		adapterId,
		arguments: { ...launchArguments },
		initialBreakpoints: Object.freeze([]),
	};
	if (target.transport === "tcp") {
		if (
			typeof target.host !== "string" ||
			target.host.length === 0 ||
			target.host.length > MAX_DEBUG_ADAPTER_HOST_CHARS
		) {
			return debugSessionRequestInvalid();
		}
		if (
			!Number.isInteger(target.port) ||
			target.port < 0 ||
			target.port > 65_535
		) {
			return debugSessionRequestInvalid();
		}
		return Object.freeze({ ...base, host: target.host, port: target.port });
	}
	return Object.freeze(base);
}

/** Decodes `debug_launch`/`debug_attach`'s response — `capabilities` is
 * deliberately not deep-validated beyond "a plain object" (see
 * `DebugSessionStartResult`'s own doc comment for why it is an open,
 * adapter-defined bag of `supportsXxx` fields, not a fixed shape). */
export function decodeDebugSessionStartResult(
	value: unknown,
): DebugSessionStartResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "capabilities"])
	) {
		return violation();
	}
	if (!isUuidV4(value.sessionId) || !isPlainObject(value.capabilities)) {
		return violation();
	}
	const capabilities = { ...value.capabilities };
	try {
		rejectProxyObject(value);
		rejectProxyObject(value.capabilities);
	} catch {
		return violation();
	}
	return Object.freeze({
		sessionId: value.sessionId,
		capabilities: Object.freeze(capabilities),
	});
}

/** Encodes `debug_disconnect`'s request. */
export function frozenDebugSessionIdRequest(
	sessionId: unknown,
): Readonly<Record<string, unknown>> {
	return Object.freeze({ sessionId: frozenSessionId(sessionId) });
}

/** Decodes the `void` (JSON `null`) result of `debug_disconnect` — a
 * separate function from `decodeDebugAdapterConfirmationVoid` purely to keep
 * each command group's own decode functions named after what they cover,
 * not because the wire shape differs (both are a bare JSON `null`). */
export function decodeDebugVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

function frozenDebugBreakpointRequest(
	entry: DebugBreakpointRequest,
): Readonly<Record<string, unknown>> {
	if (!isSafeNonNegativeInteger(entry.line)) {
		return debugSessionRequestInvalid();
	}
	if (
		entry.condition !== null &&
		(typeof entry.condition !== "string" ||
			entry.condition.length > MAX_DEBUG_BREAKPOINT_TEXT_CHARS)
	) {
		return debugSessionRequestInvalid();
	}
	if (
		entry.logMessage !== null &&
		(typeof entry.logMessage !== "string" ||
			entry.logMessage.length > MAX_DEBUG_BREAKPOINT_TEXT_CHARS)
	) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({
		line: entry.line,
		condition: entry.condition,
		logMessage: entry.logMessage,
	});
}

/** Encodes `debug_set_breakpoints`'s request — `breakpoints` is always the
 * complete current set for `path` (see `PlainBridge.debugSetBreakpoints`'s
 * own doc comment). */
export function frozenDebugSetBreakpointsRequest(
	sessionId: unknown,
	path: string,
	breakpoints: readonly DebugBreakpointRequest[],
): Readonly<Record<string, unknown>> {
	if (typeof path !== "string" || path.length > MAX_DEBUG_PATH_CHARS) {
		return debugSessionRequestInvalid();
	}
	if (
		!Array.isArray(breakpoints) ||
		breakpoints.length > MAX_DEBUG_BREAKPOINTS_PER_REQUEST
	) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		path,
		breakpoints: Object.freeze(
			breakpoints.map((entry) => frozenDebugBreakpointRequest(entry)),
		),
	});
}

function decodeDebugBreakpointResult(entry: unknown): DebugBreakpointResult {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, ["verified", "line", "id", "message"])
	) {
		return violation();
	}
	if (
		typeof entry.verified !== "boolean" ||
		(entry.line !== null && !isSafeNonNegativeInteger(entry.line)) ||
		(entry.id !== null && !isSafeInteger(entry.id)) ||
		(entry.message !== null && typeof entry.message !== "string")
	) {
		return violation();
	}
	const result = {
		verified: entry.verified,
		line: entry.line,
		id: entry.id,
		message: entry.message,
	};
	rejectProxyObject(entry);
	return Object.freeze(result);
}

export function decodeDebugSetBreakpointsResult(
	value: unknown,
): DebugSetBreakpointsResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["breakpoints"])) {
		return violation();
	}
	const breakpoints = ownObjectArraySnapshot(
		value.breakpoints,
		MAX_DEBUG_BREAKPOINTS_PER_REQUEST,
		decodeDebugBreakpointResult,
	);
	rejectProxyObject(value);
	return Object.freeze({ breakpoints });
}

/** Encodes `debug_stack_trace`'s request. */
export function frozenDebugStackTraceRequest(
	sessionId: unknown,
	threadId: number,
	startFrame: number | null,
	levels: number | null,
): Readonly<Record<string, unknown>> {
	if (!isSafeInteger(threadId)) {
		return debugSessionRequestInvalid();
	}
	if (startFrame !== null && !isSafeNonNegativeInteger(startFrame)) {
		return debugSessionRequestInvalid();
	}
	if (levels !== null && !isSafeNonNegativeInteger(levels)) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		threadId,
		startFrame,
		levels,
	});
}

function decodeDebugStackFrame(entry: unknown): DebugStackFrame {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, [
			"id",
			"name",
			"line",
			"column",
			"sourcePath",
			"sourceName",
		])
	) {
		return violation();
	}
	if (
		!isSafeInteger(entry.id) ||
		typeof entry.name !== "string" ||
		!isSafeNonNegativeInteger(entry.line) ||
		!isSafeNonNegativeInteger(entry.column) ||
		(entry.sourcePath !== null && typeof entry.sourcePath !== "string") ||
		(entry.sourceName !== null && typeof entry.sourceName !== "string")
	) {
		return violation();
	}
	const frame = {
		id: entry.id,
		name: entry.name,
		line: entry.line,
		column: entry.column,
		sourcePath: entry.sourcePath,
		sourceName: entry.sourceName,
	};
	rejectProxyObject(entry);
	return Object.freeze(frame);
}

export function decodeDebugStackTraceResult(
	value: unknown,
): DebugStackTraceResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["stackFrames", "totalFrames"])
	) {
		return violation();
	}
	if (
		value.totalFrames !== null &&
		!isSafeNonNegativeInteger(value.totalFrames)
	) {
		return violation();
	}
	const stackFrames = ownObjectArraySnapshot(
		value.stackFrames,
		MAX_DEBUG_STACK_FRAMES,
		decodeDebugStackFrame,
	);
	rejectProxyObject(value);
	return Object.freeze({ stackFrames, totalFrames: value.totalFrames });
}

/** Encodes `debug_scopes`'s request. */
export function frozenDebugScopesRequest(
	sessionId: unknown,
	frameId: number,
): Readonly<Record<string, unknown>> {
	if (!isSafeInteger(frameId)) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({ sessionId: frozenSessionId(sessionId), frameId });
}

function decodeDebugScope(entry: unknown): DebugScope {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, [
			"name",
			"variablesReference",
			"namedVariables",
			"indexedVariables",
			"expensive",
		])
	) {
		return violation();
	}
	if (
		typeof entry.name !== "string" ||
		!isSafeInteger(entry.variablesReference) ||
		(entry.namedVariables !== null &&
			!isSafeNonNegativeInteger(entry.namedVariables)) ||
		(entry.indexedVariables !== null &&
			!isSafeNonNegativeInteger(entry.indexedVariables)) ||
		typeof entry.expensive !== "boolean"
	) {
		return violation();
	}
	const scope = {
		name: entry.name,
		variablesReference: entry.variablesReference,
		namedVariables: entry.namedVariables,
		indexedVariables: entry.indexedVariables,
		expensive: entry.expensive,
	};
	rejectProxyObject(entry);
	return Object.freeze(scope);
}

export function decodeDebugScopesResult(value: unknown): DebugScopesResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["scopes"])) {
		return violation();
	}
	const scopes = ownObjectArraySnapshot(
		value.scopes,
		MAX_DEBUG_SCOPES,
		decodeDebugScope,
	);
	rejectProxyObject(value);
	return Object.freeze({ scopes });
}

/** Encodes `debug_variables`'s request — see `PlainBridge.debugVariables`'s
 * own doc comment for the lazy-expansion/pagination contract. */
export function frozenDebugVariablesRequest(
	sessionId: unknown,
	variablesReference: number,
	start: number | null,
	count: number | null,
	filter: DebugVariablesFilter | null,
): Readonly<Record<string, unknown>> {
	if (!isSafeInteger(variablesReference)) {
		return debugSessionRequestInvalid();
	}
	if (start !== null && !isSafeNonNegativeInteger(start)) {
		return debugSessionRequestInvalid();
	}
	if (count !== null && !isSafeNonNegativeInteger(count)) {
		return debugSessionRequestInvalid();
	}
	if (filter !== null && filter !== "indexed" && filter !== "named") {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		variablesReference,
		start,
		count,
		filter,
	});
}

function decodeDebugVariable(entry: unknown): DebugVariable {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, [
			"name",
			"value",
			"type",
			"variablesReference",
			"namedVariables",
			"indexedVariables",
		])
	) {
		return violation();
	}
	if (
		typeof entry.name !== "string" ||
		typeof entry.value !== "string" ||
		(entry.type !== null && typeof entry.type !== "string") ||
		!isSafeInteger(entry.variablesReference) ||
		(entry.namedVariables !== null &&
			!isSafeNonNegativeInteger(entry.namedVariables)) ||
		(entry.indexedVariables !== null &&
			!isSafeNonNegativeInteger(entry.indexedVariables))
	) {
		return violation();
	}
	const variable = {
		name: entry.name,
		value: entry.value,
		type: entry.type,
		variablesReference: entry.variablesReference,
		namedVariables: entry.namedVariables,
		indexedVariables: entry.indexedVariables,
	};
	rejectProxyObject(entry);
	return Object.freeze(variable);
}

export function decodeDebugVariablesResult(
	value: unknown,
): DebugVariablesResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["variables"])) {
		return violation();
	}
	const variables = ownObjectArraySnapshot(
		value.variables,
		MAX_DEBUG_VARIABLES,
		decodeDebugVariable,
	);
	rejectProxyObject(value);
	return Object.freeze({ variables });
}

/** Encodes `debug_evaluate`'s request. */
export function frozenDebugEvaluateRequest(
	sessionId: unknown,
	expression: string,
	frameId: number | null,
	context: DebugEvaluateContext,
): Readonly<Record<string, unknown>> {
	if (
		typeof expression !== "string" ||
		expression.length === 0 ||
		utf8ByteLength(expression) > MAX_DEBUG_EVALUATE_EXPRESSION_BYTES
	) {
		return debugSessionRequestInvalid();
	}
	if (frameId !== null && !isSafeInteger(frameId)) {
		return debugSessionRequestInvalid();
	}
	if (
		context !== "watch" &&
		context !== "repl" &&
		context !== "hover" &&
		context !== "clipboard" &&
		context !== "variables"
	) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({
		sessionId: frozenSessionId(sessionId),
		expression,
		frameId,
		context,
	});
}

export function decodeDebugEvaluateResult(value: unknown): DebugEvaluateResult {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"result",
			"type",
			"variablesReference",
			"namedVariables",
			"indexedVariables",
		])
	) {
		return violation();
	}
	if (
		typeof value.result !== "string" ||
		(value.type !== null && typeof value.type !== "string") ||
		!isSafeInteger(value.variablesReference) ||
		(value.namedVariables !== null &&
			!isSafeNonNegativeInteger(value.namedVariables)) ||
		(value.indexedVariables !== null &&
			!isSafeNonNegativeInteger(value.indexedVariables))
	) {
		return violation();
	}
	const result = {
		result: value.result,
		type: value.type,
		variablesReference: value.variablesReference,
		namedVariables: value.namedVariables,
		indexedVariables: value.indexedVariables,
	};
	rejectProxyObject(value);
	return Object.freeze(result);
}

// ---------------------------------------------------------------------
// `F100` S4 — execution/step control. All five share one request encoder
// (`frozenDebugThreadRequest`) — see `src-tauri/src/debug/dto.rs`'s
// `DebugThreadRequest` doc comment for why: every one of `continue`/`next`/
// `stepIn`/`stepOut`/`pause` takes an identical `{sessionId, threadId}` wire
// shape on this side too.
// ---------------------------------------------------------------------

/** Encodes `debug_continue`/`debug_next`/`debug_step_in`/`debug_step_out`/
 * `debug_pause`'s shared request shape. */
export function frozenDebugThreadRequest(
	sessionId: unknown,
	threadId: number,
): Readonly<Record<string, unknown>> {
	if (!isSafeInteger(threadId)) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({ sessionId: frozenSessionId(sessionId), threadId });
}

export function decodeDebugContinueResult(value: unknown): DebugContinueResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["allThreadsContinued"])) {
		return violation();
	}
	if (typeof value.allThreadsContinued !== "boolean") {
		return violation();
	}
	const result = { allThreadsContinued: value.allThreadsContinued };
	rejectProxyObject(value);
	return Object.freeze(result);
}

/** Decodes the `void` (JSON `null`) result `debug_next`/`debug_step_in`/
 * `debug_step_out`/`debug_pause` all share — a separate function from
 * `decodeDebugVoid` purely to keep this command group's own decode functions
 * named after what they cover (both are a bare JSON `null` on the wire). */
export function decodeDebugStepVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

// ---------------------------------------------------------------------
// `F100` S5 — `output`-event backpressure ack.
// ---------------------------------------------------------------------

/** Encodes `debug_output_ack`'s request. `sequence` only needs to be a safe
 * non-negative integer — any value (including one beyond what has ever
 * actually been emitted) is handled tolerantly server-side (see
 * `PlainBridge.debugOutputAck`'s own doc comment), so this encoder does not
 * additionally reject an out-of-range value the way it would for a field
 * with a real invariant to protect. */
export function frozenDebugOutputAckRequest(
	sessionId: unknown,
	sequence: number,
): Readonly<Record<string, unknown>> {
	if (!isSafeNonNegativeInteger(sequence)) {
		return debugSessionRequestInvalid();
	}
	return Object.freeze({ sessionId: frozenSessionId(sessionId), sequence });
}

/** Decodes the `void` (JSON `null`) result of `debug_output_ack`. */
export function decodeDebugOutputAckVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

const MAX_DEBUG_EVENT_NAME_CHARS = 4_096;

/** Decodes one `plain://debug-event` delivery — `body` is deliberately not
 * deep-validated (see `DebugEventPayload`'s own doc comment: it covers both
 * arbitrary real DAP event bodies and this domain's own synthetic
 * notifications, an open shape by design), but the envelope itself
 * (`sessionId`/`event`) is strictly checked. */
export function decodeDebugEventPayload(value: unknown): DebugEventPayload {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["sessionId", "event", "body"])
	) {
		return violation();
	}
	if (
		!isUuidV4(value.sessionId) ||
		typeof value.event !== "string" ||
		value.event.length === 0 ||
		value.event.length > MAX_DEBUG_EVENT_NAME_CHARS
	) {
		return violation();
	}
	const body = value.body;
	rejectProxyObject(value);
	return Object.freeze({
		sessionId: value.sessionId,
		event: value.event,
		body,
	});
}
