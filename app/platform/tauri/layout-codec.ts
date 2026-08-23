import type {
	LayoutStorageEntry,
	LayoutStorageScope,
	LayoutStorageSnapshot,
} from "./contracts";

const MAX_LAYOUT_ENTRIES = 128;
const MAX_LAYOUT_KEY_BYTES = 256;
const MAX_LAYOUT_VALUE_BYTES = 64 * 1024;
const MAX_LAYOUT_TOTAL_VALUE_BYTES = 512 * 1024;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain layout contract.";
const encoder = new TextEncoder();

class LayoutIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "LayoutIpcContractViolation";
	}
}

function violation(): never {
	throw new LayoutIpcContractViolation();
}

function exactDataObject(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return violation();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return violation();
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== expectedKeys.length ||
		!keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
	) {
		return violation();
	}
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return violation();
		}
	}
	structuredClone(value);
	return value as Record<string, unknown>;
}

function decodeScope(value: unknown): LayoutStorageScope {
	if (value === "profile" || value === "workspace") return value;
	return violation();
}

function decodeEntry(value: unknown): LayoutStorageEntry {
	const record = exactDataObject(value, ["scope", "key", "value"]);
	const scope = decodeScope(record.scope);
	if (
		typeof record.key !== "string" ||
		encoder.encode(record.key).byteLength === 0 ||
		encoder.encode(record.key).byteLength > MAX_LAYOUT_KEY_BYTES
	) {
		return violation();
	}
	if (
		typeof record.value !== "string" ||
		encoder.encode(record.value).byteLength > MAX_LAYOUT_VALUE_BYTES
	) {
		return violation();
	}
	return Object.freeze({ scope, key: record.key, value: record.value });
}

export function decodeLayoutStorageSnapshot(
	value: unknown,
): LayoutStorageSnapshot {
	const record = exactDataObject(value, ["workspaceAvailable", "entries"]);
	if (typeof record.workspaceAvailable !== "boolean") return violation();
	return Object.freeze({
		workspaceAvailable: record.workspaceAvailable,
		entries: decodeEntries(record.entries),
	});
}

function decodeEntries(value: unknown): readonly LayoutStorageEntry[] {
	if (!Array.isArray(value) || value.length > MAX_LAYOUT_ENTRIES) {
		return violation();
	}
	const entries = value.map(decodeEntry);
	const identities = new Set<string>();
	let totalBytes = 0;
	for (const entry of entries) {
		const identity = `${entry.scope}\0${entry.key}`;
		if (identities.has(identity)) return violation();
		identities.add(identity);
		totalBytes += encoder.encode(entry.value).byteLength;
	}
	if (totalBytes > MAX_LAYOUT_TOTAL_VALUE_BYTES) {
		return violation();
	}
	return Object.freeze(entries);
}

export function frozenLayoutWriteRequest(
	entries: readonly LayoutStorageEntry[],
): Readonly<{ entries: readonly LayoutStorageEntry[] }> {
	return Object.freeze({ entries: decodeEntries([...entries]) });
}

export function decodeLayoutVoid(value: unknown): void {
	if (value !== null) return violation();
}
