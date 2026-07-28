import type {
	DebugAdapterConfirmationState,
	DebugAdapterConfirmationSubject,
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
