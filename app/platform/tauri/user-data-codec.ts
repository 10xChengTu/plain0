import type {
	UserDataChangedEvent,
	UserDataResource,
	UserDataResult,
} from "./contracts";

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain user-data contract.";

export const MAX_SETTINGS_BYTES = 256 * 1024;
export const MAX_KEYBINDINGS_BYTES = 512 * 1024;

const encoder = new TextEncoder();

class UserDataIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "UserDataIpcContractViolation";
	}
}

function violation(): never {
	throw new UserDataIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function isResource(value: unknown): value is UserDataResource {
	return value === "settings" || value === "keybindings";
}

function exactDataObject(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return violation();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return violation();
	}
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

function isRevision(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function maxBytes(resource: UserDataResource): number {
	return resource === "settings" ? MAX_SETTINGS_BYTES : MAX_KEYBINDINGS_BYTES;
}

export function frozenUserDataReadRequest(
	resource: unknown,
): Readonly<{ resource: UserDataResource }> {
	if (!isResource(resource)) {
		return requestViolation(
			"USER_DATA_INVALID",
			"The local user-data resource is not supported.",
		);
	}
	return Object.freeze({ resource });
}

export function frozenUserDataWriteRequest(
	resource: unknown,
	expectedRevision: unknown,
	content: unknown,
): Readonly<{
	resource: UserDataResource;
	expectedRevision: number;
	content: string;
}> {
	if (!isResource(resource) || !isRevision(expectedRevision)) {
		return requestViolation(
			"USER_DATA_INVALID",
			"The local user-data write request is invalid.",
		);
	}
	if (
		typeof content !== "string" ||
		encoder.encode(content).byteLength > maxBytes(resource)
	) {
		return requestViolation(
			"USER_DATA_TOO_LARGE",
			"The local user-data resource exceeds its supported size limit.",
		);
	}
	return Object.freeze({ resource, expectedRevision, content });
}

export function decodeUserDataResult(value: unknown): UserDataResult {
	try {
		const object = exactDataObject(value, ["resource", "revision", "content"]);
		if (
			!isResource(object.resource) ||
			!isRevision(object.revision) ||
			typeof object.content !== "string" ||
			encoder.encode(object.content).byteLength > maxBytes(object.resource)
		) {
			return violation();
		}
		return Object.freeze({
			resource: object.resource,
			revision: object.revision,
			content: object.content,
		});
	} catch {
		return violation();
	}
}

export function decodeUserDataChangedEvent(
	value: unknown,
): UserDataChangedEvent {
	try {
		const object = exactDataObject(value, ["resource", "revision"]);
		if (!isResource(object.resource) || !isRevision(object.revision)) {
			return violation();
		}
		return Object.freeze({
			resource: object.resource,
			revision: object.revision,
		});
	} catch {
		return violation();
	}
}
