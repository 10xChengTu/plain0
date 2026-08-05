import type {
	RemoteHostKeyEntry,
	RemoteHostKeyListResult,
	RemoteSessionConnectResult,
	RemoteSessionDisconnectReason,
	RemoteSessionEventPayload,
	RemoteSessionStateEntry,
	RemoteSessionStateResult,
	RemoteWorkspaceDirectoryPage,
} from "./contracts";

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain remote SSH contract.";

class RemoteIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "RemoteIpcContractViolation";
	}
}

function violation(): never {
	throw new RemoteIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar own data
	// property. Structured clone can therefore serve only as a Proxy brand
	// check and cannot traverse attacker-controlled nested payloads. Mirrors
	// every other codec file's identical precedent (e.g. `debug-codec.ts`).
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
 * `decodeElement` — mirrors `debug-codec.ts`'s identical
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

// Mirrors `src-tauri/src/remote/dto.rs`'s own ceilings exactly — a
// hostile-input backstop, not an expected value.
const MAX_REMOTE_HOST_CHARS = 255;
const MAX_REMOTE_USER_CHARS = 256;
const MAX_REMOTE_ALGORITHM_CHARS = 64;
const MAX_REMOTE_FINGERPRINT_CHARS = 128;
/** Generous ceilings on decode-side lists — well above
 * `dto::MAX_REMOTE_SESSIONS_PER_WINDOW`/`known_hosts::MAX_KNOWN_HOSTS_ENTRIES`,
 * purely a defensive parse bound on a hostile/malformed response. */
const MAX_REMOTE_SESSIONS_DECODE = 256;
const MAX_REMOTE_HOST_KEYS_DECODE = 4_096;

const UUID_V4_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

/** A type-predicate (not a bare `Number.isSafeInteger` call) so every decode
 * call site below actually narrows `value` to `number` afterward — mirrors
 * `debug-codec.ts`'s identical `isSafeNonNegativeInteger` precedent. */
function isValidPort(value: unknown): value is number {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= 65_535
	);
}

/** `F220` S3: a type-predicate twin of `isValidPort`, for the (unbounded-
 * above, non-port) `total`/`offset` fields `remoteWorkspacePickDirectory`
 * decodes. */
function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function remoteRequestInvalid(): never {
	return requestViolation(
		"REMOTE_REQUEST_INVALID",
		"The remote SSH request is missing required fields, exceeds a size limit, or contains a " +
			"character this domain does not accept.",
	);
}

// A DNS name, IPv4 literal, IPv6 literal (including a `%`-separated zone id)
// — mirrors `remote::dto::validate_host`'s exact allowed byte set.
const HOST_PATTERN = /^[A-Za-z0-9.\-_:%]+$/;

function validateHost(host: string): void {
	if (
		typeof host !== "string" ||
		host.length === 0 ||
		host.length > MAX_REMOTE_HOST_CHARS ||
		!HOST_PATTERN.test(host)
	) {
		return remoteRequestInvalid();
	}
}

function validatePort(port: number): void {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		return remoteRequestInvalid();
	}
}

/** Mirrors `remote::dto::validate_user`'s exact `u8::is_ascii_control`
 * range (`0x00..=0x1F` and `0x7F`) — checked code point by code point like
 * `theme-codec.ts`'s `isWellFormedThemeSelectionId`, not with a regex
 * (which would also trip a control-character lint rule). */
function containsAsciiControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
			return true;
		}
	}
	return false;
}

function validateUser(user: string): void {
	if (
		typeof user !== "string" ||
		user.length === 0 ||
		user.length > MAX_REMOTE_USER_CHARS
	) {
		return remoteRequestInvalid();
	}
	if (containsAsciiControlCharacter(user)) {
		return remoteRequestInvalid();
	}
}

const ALGORITHM_PATTERN = /^[A-Za-z0-9\-@.]+$/;

function validateAlgorithm(algorithm: string): void {
	if (
		typeof algorithm !== "string" ||
		algorithm.length === 0 ||
		algorithm.length > MAX_REMOTE_ALGORITHM_CHARS ||
		!ALGORITHM_PATTERN.test(algorithm)
	) {
		return remoteRequestInvalid();
	}
}

const FINGERPRINT_DIGEST_PATTERN = /^[A-Za-z0-9+/=]+$/;

function validateFingerprint(fingerprint: string): void {
	if (
		typeof fingerprint !== "string" ||
		fingerprint.length === 0 ||
		fingerprint.length > MAX_REMOTE_FINGERPRINT_CHARS ||
		!fingerprint.startsWith("SHA256:")
	) {
		return remoteRequestInvalid();
	}
	const digest = fingerprint.slice("SHA256:".length);
	if (digest.length === 0 || !FINGERPRINT_DIGEST_PATTERN.test(digest)) {
		return remoteRequestInvalid();
	}
}

/** Encodes `remote_session_connect`'s request. */
export function frozenRemoteSessionConnectRequest(
	host: string,
	port: number,
	user: string,
): Readonly<Record<string, unknown>> {
	validateHost(host);
	validatePort(port);
	validateUser(user);
	return Object.freeze({ host, port, user });
}

/** Encodes `remote_host_key_confirm`'s request — binds the confirmation to
 * the exact `(algorithm, sha256Fingerprint)` pair a prior
 * `hostKeyPendingConfirmation` response reported, per ADR 0006 §3's "确认必须
 * 绑定这次给出的精确指纹" requirement. */
export function frozenRemoteHostKeyConfirmRequest(
	host: string,
	port: number,
	user: string,
	algorithm: string,
	sha256Fingerprint: string,
): Readonly<Record<string, unknown>> {
	validateHost(host);
	validatePort(port);
	validateUser(user);
	validateAlgorithm(algorithm);
	validateFingerprint(sha256Fingerprint);
	return Object.freeze({
		host,
		port,
		user,
		algorithm,
		sha256Fingerprint,
	});
}

/** Encodes `remote_session_connect_cancel`/`remote_host_key_forget`'s shared
 * `(host, port)` request shape. */
export function frozenRemoteHostTargetRequest(
	host: string,
	port: number,
): Readonly<Record<string, unknown>> {
	validateHost(host);
	validatePort(port);
	return Object.freeze({ host, port });
}

/** Encodes `remote_session_disconnect`'s request. */
export function frozenRemoteSessionIdRequest(
	sessionId: string,
): Readonly<Record<string, unknown>> {
	if (!isUuidV4(sessionId)) {
		return remoteRequestInvalid();
	}
	return Object.freeze({ sessionId });
}

/** Decodes the `void` (JSON `null`) result of `remote_session_disconnect`/
 * `remote_host_key_forget`/`remote_session_connect_cancel`. */
export function decodeRemoteVoid(value: unknown): void {
	if (value !== null) {
		violation();
	}
}

/** Decodes `remote_session_connect`/`remote_host_key_confirm`'s response —
 * see `RemoteSessionConnectResult`'s own doc comment for the two-variant
 * shape. */
export function decodeRemoteSessionConnectResult(
	value: unknown,
): RemoteSessionConnectResult {
	if (!isPlainObject(value) || typeof value.status !== "string") {
		return violation();
	}
	if (value.status === "connected") {
		if (!hasExactKeys(value, ["status", "sessionId"])) {
			return violation();
		}
		if (!isUuidV4(value.sessionId)) {
			return violation();
		}
		try {
			rejectProxyObject(value);
		} catch {
			return violation();
		}
		return Object.freeze({
			status: "connected",
			sessionId: value.sessionId,
		});
	}
	if (value.status === "hostKeyPendingConfirmation") {
		if (
			!hasExactKeys(value, [
				"status",
				"algorithm",
				"sha256Fingerprint",
				"knownHostsHit",
			])
		) {
			return violation();
		}
		if (
			typeof value.algorithm !== "string" ||
			value.algorithm.length === 0 ||
			typeof value.sha256Fingerprint !== "string" ||
			value.sha256Fingerprint.length === 0 ||
			typeof value.knownHostsHit !== "boolean"
		) {
			return violation();
		}
		try {
			rejectProxyObject(value);
		} catch {
			return violation();
		}
		return Object.freeze({
			status: "hostKeyPendingConfirmation",
			algorithm: value.algorithm,
			sha256Fingerprint: value.sha256Fingerprint,
			knownHostsHit: value.knownHostsHit,
		});
	}
	return violation();
}

function decodeRemoteSessionStateEntry(
	entry: unknown,
): RemoteSessionStateEntry {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, ["sessionId", "host", "port", "user"])
	) {
		return violation();
	}
	if (
		!isUuidV4(entry.sessionId) ||
		typeof entry.host !== "string" ||
		!isValidPort(entry.port) ||
		typeof entry.user !== "string"
	) {
		return violation();
	}
	const decoded = {
		sessionId: entry.sessionId,
		host: entry.host,
		port: entry.port,
		user: entry.user,
	};
	try {
		rejectProxyObject(entry);
	} catch {
		return violation();
	}
	return Object.freeze(decoded);
}

/** Decodes `remote_session_state`'s response. */
export function decodeRemoteSessionStateResult(
	value: unknown,
): RemoteSessionStateResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["sessions"])) {
		return violation();
	}
	const sessions = ownObjectArraySnapshot(
		value.sessions,
		MAX_REMOTE_SESSIONS_DECODE,
		decodeRemoteSessionStateEntry,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ sessions });
}

function decodeRemoteHostKeyEntry(entry: unknown): RemoteHostKeyEntry {
	if (
		!isPlainObject(entry) ||
		!hasExactKeys(entry, ["host", "port", "algorithm", "sha256Fingerprint"])
	) {
		return violation();
	}
	if (
		typeof entry.host !== "string" ||
		!isValidPort(entry.port) ||
		typeof entry.algorithm !== "string" ||
		typeof entry.sha256Fingerprint !== "string"
	) {
		return violation();
	}
	const decoded = {
		host: entry.host,
		port: entry.port,
		algorithm: entry.algorithm,
		sha256Fingerprint: entry.sha256Fingerprint,
	};
	try {
		rejectProxyObject(entry);
	} catch {
		return violation();
	}
	return Object.freeze(decoded);
}

/** Decodes `remote_host_key_list`'s response. */
export function decodeRemoteHostKeyListResult(
	value: unknown,
): RemoteHostKeyListResult {
	if (!isPlainObject(value) || !hasExactKeys(value, ["entries"])) {
		return violation();
	}
	const entries = ownObjectArraySnapshot(
		value.entries,
		MAX_REMOTE_HOST_KEYS_DECODE,
		decodeRemoteHostKeyEntry,
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({ entries });
}

const DISCONNECT_REASONS: readonly RemoteSessionDisconnectReason[] = [
	"userRequested",
	"windowClosed",
	"transportClosed",
];

function isRemoteSessionDisconnectReason(
	value: unknown,
): value is RemoteSessionDisconnectReason {
	return (
		typeof value === "string" &&
		(DISCONNECT_REASONS as readonly string[]).includes(value)
	);
}

/** Decodes one `plain://remote-session-event` delivery. */
export function decodeRemoteSessionEventPayload(
	value: unknown,
): RemoteSessionEventPayload {
	if (!isPlainObject(value) || typeof value.event !== "string") {
		return violation();
	}
	if (value.event === "connected") {
		if (!hasExactKeys(value, ["event", "sessionId", "host", "port", "user"])) {
			return violation();
		}
		if (
			!isUuidV4(value.sessionId) ||
			typeof value.host !== "string" ||
			!isValidPort(value.port) ||
			typeof value.user !== "string"
		) {
			return violation();
		}
		try {
			rejectProxyObject(value);
		} catch {
			return violation();
		}
		return Object.freeze({
			event: "connected",
			sessionId: value.sessionId,
			host: value.host,
			port: value.port,
			user: value.user,
		});
	}
	if (value.event === "disconnected") {
		if (
			!hasExactKeys(value, [
				"event",
				"sessionId",
				"host",
				"port",
				"user",
				"reason",
			])
		) {
			return violation();
		}
		if (
			!isUuidV4(value.sessionId) ||
			typeof value.host !== "string" ||
			!isValidPort(value.port) ||
			typeof value.user !== "string" ||
			!isRemoteSessionDisconnectReason(value.reason)
		) {
			return violation();
		}
		try {
			rejectProxyObject(value);
		} catch {
			return violation();
		}
		return Object.freeze({
			event: "disconnected",
			sessionId: value.sessionId,
			host: value.host,
			port: value.port,
			user: value.user,
			reason: value.reason,
		});
	}
	return violation();
}

// --- Remote SSH workspace filesystem (F220 S3) ------------------------------

// Mirrors `remote::dto::MAX_REMOTE_PICK_PATH_CHARS`/`MAX_REMOTE_PICK_PAGE_SIZE`
// exactly — a hostile-input backstop, not an expected value.
const MAX_REMOTE_PICK_PATH_CHARS = 8_192;
const MAX_REMOTE_PICK_PAGE_SIZE = 500;
/** Generous ceiling on a decoded page's own entry list — well above
 * `MAX_REMOTE_PICK_PAGE_SIZE` (the *requested* `limit`), purely a defensive
 * parse bound on a hostile/malformed response. */
const MAX_REMOTE_PICK_ENTRIES_DECODE = 4_096;

function validateRemotePickPath(path: unknown): asserts path is string {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > MAX_REMOTE_PICK_PATH_CHARS
	) {
		remoteRequestInvalid();
	}
}

/** Encodes `remote_workspace_pick_directory`'s request. */
export function frozenRemoteWorkspacePickDirectoryRequest(
	sessionId: string,
	path: string,
	offset: number,
	limit: number,
): Readonly<Record<string, unknown>> {
	if (!isUuidV4(sessionId)) {
		return remoteRequestInvalid();
	}
	validateRemotePickPath(path);
	if (!Number.isSafeInteger(offset) || offset < 0) {
		return remoteRequestInvalid();
	}
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > MAX_REMOTE_PICK_PAGE_SIZE
	) {
		return remoteRequestInvalid();
	}
	return Object.freeze({ sessionId, path, offset, limit });
}

/** Decodes `remote_workspace_pick_directory`'s response. */
export function decodeRemoteWorkspaceDirectoryPage(
	value: unknown,
): RemoteWorkspaceDirectoryPage {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"canonicalPath",
			"parentPath",
			"entries",
			"total",
			"offset",
			"hasMore",
		])
	) {
		return violation();
	}
	if (
		typeof value.canonicalPath !== "string" ||
		value.canonicalPath.length === 0 ||
		(value.parentPath !== null && typeof value.parentPath !== "string") ||
		!isSafeNonNegativeInteger(value.total) ||
		!isSafeNonNegativeInteger(value.offset) ||
		typeof value.hasMore !== "boolean"
	) {
		return violation();
	}
	const entries = ownObjectArraySnapshot(
		value.entries,
		MAX_REMOTE_PICK_ENTRIES_DECODE,
		(entry) => {
			if (
				typeof entry !== "string" ||
				entry.length === 0 ||
				entry.length > MAX_REMOTE_PICK_PATH_CHARS
			) {
				return violation();
			}
			return entry;
		},
	);
	try {
		rejectProxyObject(value);
	} catch {
		return violation();
	}
	return Object.freeze({
		canonicalPath: value.canonicalPath,
		parentPath: value.parentPath,
		entries,
		total: value.total,
		offset: value.offset,
		hasMore: value.hasMore,
	});
}

/** Encodes `remote_workspace_add_root`'s request. */
export function frozenRemoteWorkspaceAddRootRequest(
	sessionId: string,
	path: string,
	displayName: string | undefined,
): Readonly<Record<string, unknown>> {
	if (!isUuidV4(sessionId)) {
		return remoteRequestInvalid();
	}
	validateRemotePickPath(path);
	if (displayName !== undefined) {
		if (
			typeof displayName !== "string" ||
			displayName.length === 0 ||
			displayName.length > 512
		) {
			return remoteRequestInvalid();
		}
		return Object.freeze({ sessionId, path, displayName });
	}
	return Object.freeze({ sessionId, path });
}

/** Encodes `remote_workspace_reconnect_root`'s request (`F220` S4) — the
 * response is a plain `WorkspaceSnapshot`, decoded by
 * `workspace-codec.ts`'s own `decodeWorkspaceSnapshot` exactly like
 * `remoteWorkspaceAddRoot`'s, so this module only owns the request side. */
export function frozenRemoteWorkspaceReconnectRootRequest(
	rootId: string,
	sessionId: string,
): Readonly<Record<string, unknown>> {
	if (!isUuidV4(rootId)) {
		return remoteRequestInvalid();
	}
	if (!isUuidV4(sessionId)) {
		return remoteRequestInvalid();
	}
	return Object.freeze({ rootId, sessionId });
}
