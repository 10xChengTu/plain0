import type {
	RuntimeInfo,
	WorkspacePickResult,
	WorkspaceRoot,
	WorkspaceSnapshot,
} from "./contracts";

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_WORKSPACE_ROOTS = 256;
const MAX_DISPLAY_NAME_LENGTH = 255;
const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain contract.";

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
