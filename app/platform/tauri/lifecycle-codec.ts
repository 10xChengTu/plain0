import type { NativeCloseRequest } from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTRACT_MESSAGE =
	"Native IPC returned a payload that violates the Plain lifecycle contract.";

class LifecycleIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_MESSAGE);
		this.name = "LifecycleIpcContractViolation";
	}
}

function violation(): never {
	throw new LifecycleIpcContractViolation();
}

function exactDataObject(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Object.getPrototypeOf(value) !== Object.prototype ||
		Reflect.ownKeys(value).length !== keys.length
	) {
		return violation();
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.enumerable !== true
		) {
			return violation();
		}
	}
	structuredClone(value);
	return value as Record<string, unknown>;
}

function closeRequestId(value: unknown): string {
	if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
		return violation();
	}
	return value;
}

export function decodeNativeCloseRequest(value: unknown): NativeCloseRequest {
	const record = exactDataObject(value, ["requestId", "reason", "timeoutMs"]);
	const requestId = closeRequestId(record.requestId);
	const reason = record.reason;
	if (reason !== "close" && reason !== "quit") {
		return violation();
	}
	if (record.timeoutMs !== 5_000) {
		return violation();
	}
	return Object.freeze({ requestId, reason, timeoutMs: 5_000 });
}

export function frozenCompleteCloseRequest(
	requestId: unknown,
	outcome: unknown,
): Readonly<{ requestId: string; outcome: "allow" | "veto" }> {
	const validRequestId = closeRequestId(requestId);
	if (outcome !== "allow" && outcome !== "veto") {
		return violation();
	}
	return Object.freeze({ requestId: validRequestId, outcome });
}

export function decodeLifecycleVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}
