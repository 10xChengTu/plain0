import type {
	ThemeContribution,
	ThemeImportResult,
	ThemeListResult,
	ThemePackageSummary,
	ThemeSelectionResult,
	ThemeUiTheme,
} from "./contracts";

const CONTRACT_ERROR_MESSAGE =
	"Native IPC returned a payload that violates the Plain theme contract.";

/** Mirrors `src-tauri/src/path_policy.rs`'s own limits — the exact charset
 * beyond length/segment count is re-validated authoritatively by Rust; this
 * is an early, cheap rejection so a malformed path never even reaches an
 * IPC round trip. */
const MAX_RELATIVE_PATH_BYTES = 4_096;
const MAX_RELATIVE_PATH_SEGMENTS = 256;
/** `manifest.rs`'s `publisher`/`name`/`version` charsets are each bounded at
 * 128/128/64 bytes and joined with `.`/`@`, so a real semantic id never
 * exceeds this; comfortably generous rather than exact. */
const MAX_PACKAGE_ID_BYTES = 512;
/** Mirrors `theme::MAX_THEME_ENTRY_BYTES` — the exact cap
 * `theme_read_resource` enforces server-side; this is a client-side sanity
 * bound on the decoded frame, never the sole enforcement. */
const MAX_THEME_RESOURCE_BYTES = 8 * 1_024 * 1_024;
/** Mirrors `theme::selection::MAX_THEME_SELECTION_ID_BYTES` — the exact cap
 * `theme_set_selection` enforces server-side. */
const MAX_THEME_SELECTION_ID_BYTES = 256;

const utf8Encoder = new TextEncoder();

class ThemeIpcContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION";

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "ThemeIpcContractViolation";
	}
}

function violation(): never {
	throw new ThemeIpcContractViolation();
}

function requestViolation(code: string, message: string): never {
	throw Object.freeze({ code, message });
}

function sanitizedDecode<T>(decoder: () => T): T {
	try {
		return decoder();
	} catch {
		return violation();
	}
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

function rejectProxyObject(value: object): void {
	// The caller has already proved every accepted field is a scalar or an
	// already-validated own-data array/object, so structured clone can only
	// ever serve as a Proxy brand check here — it never has to traverse an
	// attacker-controlled nested payload it hasn't already walked itself.
	structuredClone(value);
}

function isPortablePathSegment(segment: string): boolean {
	return (
		segment.length > 0 &&
		segment !== "." &&
		segment !== ".." &&
		!segment.includes(" ") &&
		!segment.includes("\\") &&
		!segment.includes(":")
	);
}

/** Cheap client-side approximation of `RelativePath::parse_wire`'s shape
 * rules (non-empty, no leading `/`, no NUL/backslash/colon in any segment,
 * no `.`/`..` segment, bounded length/segment count). Rust re-validates
 * authoritatively; this only avoids sending an obviously-malformed path. */
function isWellFormedThemeRelativePath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) {
		return false;
	}
	if (
		value.startsWith("/") ||
		value.includes(" ") ||
		value.includes("\\") ||
		value.includes(":")
	) {
		return false;
	}
	if (utf8Encoder.encode(value).byteLength > MAX_RELATIVE_PATH_BYTES) {
		return false;
	}
	const segments = value.split("/");
	return (
		segments.length <= MAX_RELATIVE_PATH_SEGMENTS &&
		segments.every((segment) => isPortablePathSegment(segment))
	);
}

/** A theme package id (`publisher.name@version`) is always exactly one
 * `RelativePath` segment — no `/` at all, unlike a resource's relative
 * path. */
function isWellFormedThemePackageId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("/") &&
		!value.includes(" ") &&
		!value.includes("\\") &&
		!value.includes(":") &&
		value !== "." &&
		value !== ".." &&
		utf8Encoder.encode(value).byteLength <= MAX_PACKAGE_ID_BYTES
	);
}

export function frozenThemeReadResourceRequest(
	packageId: unknown,
	relativePath: unknown,
): Readonly<{ packageId: string; relativePath: string }> {
	if (!isWellFormedThemePackageId(packageId)) {
		return requestViolation(
			"THEME_PACKAGE_NOT_FOUND",
			"No imported theme package matches the given id.",
		);
	}
	if (!isWellFormedThemeRelativePath(relativePath)) {
		return requestViolation(
			"THEME_RESOURCE_NOT_FOUND",
			"The requested theme package resource is not available.",
		);
	}
	return Object.freeze({ packageId, relativePath });
}

export function frozenThemeRemoveRequest(
	packageId: unknown,
): Readonly<{ packageId: string }> {
	if (!isWellFormedThemePackageId(packageId)) {
		return requestViolation(
			"THEME_PACKAGE_NOT_FOUND",
			"No imported theme package matches the given id.",
		);
	}
	return Object.freeze({ packageId });
}

/** Cheap client-side approximation of `theme::selection::validate_theme_
 * selection_id`'s charset/length rules: non-empty, at most
 * `MAX_THEME_SELECTION_ID_BYTES` UTF-8 bytes, and free of every C0/C1
 * control character (`char::is_control`'s exact range: `U+0000..=U+001F`
 * and `U+007F..=U+009F`) — mirrors the Rust check code-point by code-point
 * rather than UTF-16 code unit by code unit, so a surrogate pair never
 * misclassifies as a lone control character. Rust re-validates
 * authoritatively; this only avoids sending an obviously-invalid id. */
function isWellFormedThemeSelectionId(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) {
		return false;
	}
	if (utf8Encoder.encode(value).byteLength > MAX_THEME_SELECTION_ID_BYTES) {
		return false;
	}
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (
			codePoint === undefined ||
			codePoint <= 0x1f ||
			(codePoint >= 0x7f && codePoint <= 0x9f)
		) {
			return false;
		}
	}
	return true;
}

export function frozenThemeSetSelectionRequest(
	themeId: unknown,
): Readonly<{ themeId: string | null }> {
	if (themeId === null) {
		return Object.freeze({ themeId: null });
	}
	if (!isWellFormedThemeSelectionId(themeId)) {
		return requestViolation(
			"THEME_SELECTION_INVALID",
			"The theme selection id is empty, too long, or contains a control character.",
		);
	}
	return Object.freeze({ themeId });
}

function isThemeUiTheme(value: unknown): value is ThemeUiTheme {
	return (
		value === "vs" ||
		value === "vs-dark" ||
		value === "hc-black" ||
		value === "hc-light"
	);
}

function decodeThemeContribution(value: unknown): ThemeContribution {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, ["label", "uiTheme", "path"]) ||
		(value.label !== null && typeof value.label !== "string") ||
		!isThemeUiTheme(value.uiTheme) ||
		typeof value.path !== "string"
	) {
		return violation();
	}
	rejectProxyObject(value);
	return Object.freeze({
		label: value.label as string | null,
		uiTheme: value.uiTheme,
		path: value.path,
	});
}

function decodeThemeContributionArray(
	value: unknown,
): readonly ThemeContribution[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype
	) {
		return violation();
	}
	rejectProxyObject(value);
	return Object.freeze(value.map((entry) => decodeThemeContribution(entry)));
}

function decodeStringArray(value: unknown): readonly string[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype
	) {
		return violation();
	}
	rejectProxyObject(value);
	if (!value.every((entry) => typeof entry === "string")) {
		return violation();
	}
	return Object.freeze([...(value as readonly string[])]);
}

function decodeThemePackageSummary(value: unknown): ThemePackageSummary {
	if (
		!isPlainObject(value) ||
		!hasExactKeys(value, [
			"id",
			"publisher",
			"name",
			"version",
			"themes",
			"resources",
			"containsCode",
		]) ||
		typeof value.id !== "string" ||
		typeof value.publisher !== "string" ||
		typeof value.name !== "string" ||
		typeof value.version !== "string" ||
		typeof value.containsCode !== "boolean"
	) {
		return violation();
	}
	const themes = decodeThemeContributionArray(value.themes);
	const resources = decodeStringArray(value.resources);
	rejectProxyObject(value);
	return Object.freeze({
		id: value.id,
		publisher: value.publisher,
		name: value.name,
		version: value.version,
		themes,
		resources,
		containsCode: value.containsCode,
	});
}

export function decodeThemeImportResult(value: unknown): ThemeImportResult {
	return sanitizedDecode(() => {
		if (!isPlainObject(value)) {
			return violation();
		}
		if (value.status === "cancelled") {
			if (!hasExactKeys(value, ["status"])) {
				return violation();
			}
			rejectProxyObject(value);
			return Object.freeze({ status: "cancelled" as const });
		}
		if (value.status === "imported") {
			if (!hasExactKeys(value, ["status", "package"])) {
				return violation();
			}
			const packageSummary = decodeThemePackageSummary(value.package);
			rejectProxyObject(value);
			return Object.freeze({
				status: "imported" as const,
				package: packageSummary,
			});
		}
		return violation();
	});
}

export function decodeThemeListResult(value: unknown): ThemeListResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["packages", "skipped"]) ||
			typeof value.skipped !== "number" ||
			!Number.isInteger(value.skipped) ||
			value.skipped < 0
		) {
			return violation();
		}
		const packagesValue = value.packages;
		if (
			typeof packagesValue !== "object" ||
			packagesValue === null ||
			!Array.isArray(packagesValue) ||
			Object.getPrototypeOf(packagesValue) !== Array.prototype
		) {
			return violation();
		}
		rejectProxyObject(packagesValue);
		const packages = Object.freeze(
			packagesValue.map((entry) => decodeThemePackageSummary(entry)),
		);
		rejectProxyObject(value);
		return Object.freeze({ packages, skipped: value.skipped });
	});
}

export function decodeThemeSelectionResult(
	value: unknown,
): ThemeSelectionResult {
	return sanitizedDecode(() => {
		if (
			!isPlainObject(value) ||
			!hasExactKeys(value, ["themeId"]) ||
			(value.themeId !== null && typeof value.themeId !== "string")
		) {
			return violation();
		}
		rejectProxyObject(value);
		return Object.freeze({ themeId: value.themeId as string | null });
	});
}

export function decodeThemeVoid(value: unknown): void {
	sanitizedDecode(() => {
		if (value !== null) {
			return violation();
		}
	});
}

/**
 * Decodes `theme_read_resource`'s raw-bytes IPC response into a fresh
 * `Uint8Array` snapshot. Deliberately no magic-header envelope (unlike
 * `PLR1`/`PLBA`) — a theme resource is Plain's own already-validated,
 * immutable library content with no version/mtime save-conflict metadata to
 * carry alongside it, so the response is exactly the content bytes and
 * nothing else. Accepts both the real Tauri desktop `ArrayBuffer` transport
 * and the dense `number[]` shape some environments use, mirroring
 * `workspace_read_file`'s own dual-transport precedent.
 */
export function decodeThemeReadResourceBytes(value: unknown): Uint8Array {
	return sanitizedDecode(() => {
		if (Array.isArray(value)) {
			if (Object.getPrototypeOf(value) !== Array.prototype) {
				return violation();
			}
			const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
			if (
				lengthDescriptor === undefined ||
				!("value" in lengthDescriptor) ||
				!Number.isSafeInteger(lengthDescriptor.value) ||
				(lengthDescriptor.value as number) < 0 ||
				(lengthDescriptor.value as number) > MAX_THEME_RESOURCE_BYTES
			) {
				return violation();
			}
			const length = lengthDescriptor.value as number;
			const bytes = new Uint8Array(length);
			for (let index = 0; index < length; index += 1) {
				const descriptor = Object.getOwnPropertyDescriptor(
					value,
					String(index),
				);
				if (
					descriptor === undefined ||
					!("value" in descriptor) ||
					typeof descriptor.value !== "number" ||
					!Number.isInteger(descriptor.value) ||
					descriptor.value < 0 ||
					descriptor.value > 255
				) {
					return violation();
				}
				bytes[index] = descriptor.value;
			}
			return bytes;
		}

		if (
			typeof value !== "object" ||
			value === null ||
			Object.getPrototypeOf(value) !== ArrayBuffer.prototype ||
			Reflect.ownKeys(value).length !== 0
		) {
			return violation();
		}
		const byteLengthGetter = Object.getOwnPropertyDescriptor(
			ArrayBuffer.prototype,
			"byteLength",
		)?.get;
		if (byteLengthGetter === undefined) {
			return violation();
		}
		const byteLength: unknown = Reflect.apply(byteLengthGetter, value, []);
		if (
			typeof byteLength !== "number" ||
			!Number.isSafeInteger(byteLength) ||
			byteLength < 0 ||
			byteLength > MAX_THEME_RESOURCE_BYTES
		) {
			return violation();
		}
		return new Uint8Array(value as ArrayBuffer).slice();
	});
}
