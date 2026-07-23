import {
	registerExtension,
	type IExtensionManifest,
	type RegisterLocalExtensionResult,
} from "@codingame/monaco-vscode-api/extensions";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";
import { ExtensionData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService";

import type {
	PlainBridge,
	ThemeImportResult,
	ThemePackageSummary,
} from "../../platform/tauri";
import { normalizeCommandError } from "../../platform/tauri";
import { applyDefaultColorTheme } from "./plain-theme-picker";
import {
	buildPlainThemeRegistryEntry,
	type PlainThemeRegistryEntry,
} from "./plain-theme-registry";

/**
 * Mirrors `CustomSchemas.extensionFile` from `@codingame/monaco-vscode-
 * files-service-override` (confirmed a fixed literal via that package's own
 * source: `const extensionFile = "extension-file"`). Hardcoded here rather
 * than imported so this module does not need a new direct dependency on
 * that package just for one string constant.
 */
const EXTENSION_FILE_SCHEME = "extension-file";

/**
 * Mirrors `getExtensionId(publisher, name)` from `@codingame/monaco-vscode-
 * api`'s `extensionManagementUtil` (confirmed via that module's own source:
 * `` `${publisher}.${name}` `` — nothing more). Inlined for the same reason
 * as [`EXTENSION_FILE_SCHEME`].
 */
function extensionIdFor(
	pkg: Pick<ThemePackageSummary, "publisher" | "name">,
): string {
	return `${pkg.publisher}.${pkg.name}`;
}

/**
 * The `extension-file:` location an imported package's resources are
 * registered under — the exact same URI shape `registerExtension`'s own
 * (unexported) internals compute from `{ publisher, name }` and the default
 * `path: "/extension"`, recomputed here because a manifest registered after
 * Workbench `initialize()` is never added to any queryable registry (see
 * `registerImportedPackage`'s own doc comment) and so exposes no `location`
 * of its own to read back.
 */
function extensionLocationFor(
	pkg: Pick<ThemePackageSummary, "publisher" | "name">,
): URI {
	return URI.from({
		scheme: EXTENSION_FILE_SCHEME,
		authority: extensionIdFor(pkg),
		path: "/extension",
	});
}

function basenameOf(path: string): string {
	const segments = path.split("/");
	return segments.at(-1) ?? path;
}

function mimeTypeForResource(path: string): string {
	return path.toLowerCase().endsWith(".tmtheme")
		? "application/xml"
		: "application/json";
}

/**
 * Builds the minimal, purely declarative `IExtensionManifest` `theme_read_
 * resource`'s consumer needs to call `registerExtension` — deliberately
 * omitting `main`/`browser`/`activationEvents` entirely (Plain's Rust layer
 * never even reads their *values*, only records whether they were present;
 * this manifest never gives them anywhere to be read from in the first
 * place) and `iconThemes`/`productIconThemes` (F060's own scope).
 */
function buildImportedManifest(pkg: ThemePackageSummary): IExtensionManifest {
	return Object.freeze({
		name: pkg.name,
		publisher: pkg.publisher,
		version: pkg.version,
		engines: Object.freeze({ vscode: "*" }),
		contributes: Object.freeze({
			themes: pkg.themes.map((theme) => {
				// Upstream's own fallback (`ColorThemeData.fromExtensionTheme`:
				// `settingsId = theme.id || label`) is mirrored here rather than
				// left to chance: `IColorTheme.id` is typed as required, but F050
				// S2 never captures a theme-level `id` from the imported
				// manifest at all (out of scope), so every imported entry is
				// always in the "no `id`" case upstream itself already handles.
				const resolvedLabel = theme.label ?? basenameOf(theme.path);
				return Object.freeze({
					id: resolvedLabel,
					label: resolvedLabel,
					uiTheme: theme.uiTheme,
					path: theme.path,
				});
			}),
		}),
	}) as unknown as IExtensionManifest;
}

/** One imported package's live bookkeeping: the handle `registerExtension`
 * returned (for `dispose()` on removal) and every blob URL created for its
 * resources (for `URL.revokeObjectURL()` on removal). */
interface ImportedPackageHandle {
	readonly registered: RegisterLocalExtensionResult;
	readonly blobUrls: readonly string[];
}

/**
 * The live, mutable registry `F050` S3 consumption maintains: a fixed
 * built-in set (frozen at bootstrap) plus zero or more imported packages,
 * each keyed by package id so a specific import can be replaced or removed
 * independently. `entries()` is what every re-registration of the theme
 * picker (see `plain-theme-commands.ts`) reads.
 */
export class PlainThemeRegistryStore {
	readonly #builtin: readonly PlainThemeRegistryEntry[];
	readonly #importedByPackage = new Map<
		string,
		readonly PlainThemeRegistryEntry[]
	>();

	constructor(builtin: readonly PlainThemeRegistryEntry[]) {
		this.#builtin = builtin;
	}

	get builtin(): readonly PlainThemeRegistryEntry[] {
		return this.#builtin;
	}

	entries(): readonly PlainThemeRegistryEntry[] {
		return Object.freeze([
			...this.#builtin,
			...[...this.#importedByPackage.values()].flat(),
		]);
	}

	importedPackageIds(): readonly string[] {
		return Object.freeze([...this.#importedByPackage.keys()].sort());
	}

	importedEntries(
		packageId: string,
	): readonly PlainThemeRegistryEntry[] | undefined {
		return this.#importedByPackage.get(packageId);
	}

	setImported(
		packageId: string,
		entries: readonly PlainThemeRegistryEntry[],
	): void {
		this.#importedByPackage.set(packageId, entries);
	}

	removeImported(packageId: string): void {
		this.#importedByPackage.delete(packageId);
	}
}

const handlesByPackage = new Map<string, ImportedPackageHandle>();

/**
 * Fetches every one of `pkg`'s whitelisted resources (see
 * `ThemePackageSummary.resources`'s own doc comment), registers each as a
 * `Blob` object URL via the handle `registerExtension` returns, and
 * registers the resulting registry entries into `store`.
 *
 * `registerExtension(manifest, undefined)` is the official, purely
 * declarative seam (no second argument — never an Extension Host of any
 * kind): called this long after Workbench `initialize()`, its own internal
 * "add this extension to `IExtensionService`" step is a real no-op (`Null
 * ExtensionService.canAddExtension()` always returns `false`, confirmed via
 * that class's own source), so the manifest never becomes reachable through
 * `getBuiltinExtensions()` or any other enumeration. What still works
 * unconditionally is `registered.registerFileUrl`, which is exactly the
 * same `extension-file:` virtual-tree registration built-in themes get at
 * build time (`registerExtensionFile`/`FileAccess.registerStaticBrowserUri`,
 * confirmed via `registerExtension`'s own source) — independent of whether
 * the extension was ever "added" anywhere. This is why `location` is
 * recomputed by [`extensionLocationFor`] rather than read off the returned
 * handle: nothing exposes it once this no-op path is taken.
 */
async function registerImportedPackage(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
	pkg: ThemePackageSummary,
): Promise<void> {
	const manifest = buildImportedManifest(pkg);
	const registered = registerExtension(
		manifest,
		undefined,
	) as unknown as RegisterLocalExtensionResult;
	const location = extensionLocationFor(pkg);
	const blobUrls: string[] = [];
	try {
		for (const resourcePath of pkg.resources) {
			const bytes = await bridge.themeReadResource(pkg.id, resourcePath);
			// `Blob`'s DOM typings require an `ArrayBufferView<ArrayBuffer>`
			// (never the wider `ArrayBufferLike`/`SharedArrayBuffer`-compatible
			// shape a bridge-returned `Uint8Array` is typed as); copying into a
			// fresh `Uint8Array` guarantees a plain `ArrayBuffer` backing.
			const blob = new Blob([new Uint8Array(bytes)], {
				type: mimeTypeForResource(resourcePath),
			});
			const url = URL.createObjectURL(blob);
			blobUrls.push(url);
			registered.registerFileUrl(resourcePath, url);
		}
	} catch (error) {
		for (const url of blobUrls) {
			URL.revokeObjectURL(url);
		}
		await registered.dispose();
		throw error;
	}

	const extensionData = ExtensionData.fromName(pkg.publisher, pkg.name, true);
	const entries = pkg.themes.map((theme) => {
		const resolvedLabel = theme.label ?? basenameOf(theme.path);
		return buildPlainThemeRegistryEntry(location, extensionData, {
			id: resolvedLabel,
			label: resolvedLabel,
			uiTheme: theme.uiTheme,
			path: theme.path,
		});
	});

	// Defensive: a re-registration of an id already present (should not
	// normally happen — Rust rejects duplicate imports, and a package is
	// only ever consumed once per session) tears down the previous handle
	// first rather than leaking it.
	const previous = handlesByPackage.get(pkg.id);
	if (previous !== undefined) {
		for (const url of previous.blobUrls) {
			URL.revokeObjectURL(url);
		}
		await previous.registered.dispose();
	}
	handlesByPackage.set(pkg.id, {
		registered,
		blobUrls: Object.freeze(blobUrls),
	});
	store.setImported(pkg.id, Object.freeze(entries));
}

/** Consumed once at startup (`main.ts`): every already-imported package
 * (from a previous session) is registered the same way a fresh import is,
 * so it reappears in the theme picker without the user re-importing it. A
 * single package that fails to register (e.g. a resource became
 * unreadable) is skipped rather than blocking every other package or
 * failing Plain's own bootstrap. */
export async function consumeImportedThemePackages(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
): Promise<void> {
	let listing;
	try {
		listing = await bridge.themeList();
	} catch (error) {
		console.warn("Plain: failed to list imported theme packages", error);
		return;
	}
	for (const pkg of listing.packages) {
		try {
			await registerImportedPackage(bridge, store, pkg);
		} catch (error) {
			console.warn(
				`Plain: failed to register imported theme package "${pkg.id}"`,
				error,
			);
		}
	}
}

async function runImport(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
	pick: () => Promise<ThemeImportResult>,
): Promise<ThemeImportResult> {
	const result = await pick();
	if (result.status === "imported") {
		await registerImportedPackage(bridge, store, result.package);
	}
	return result;
}

export function importThemePackageViaVsix(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
): Promise<ThemeImportResult> {
	return runImport(bridge, store, () => bridge.themeImportVsix());
}

export function importThemePackageViaDirectory(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
): Promise<ThemeImportResult> {
	return runImport(bridge, store, () => bridge.themeImportDirectory());
}

/**
 * Removes an imported package: tells Rust to delete it (idempotent — see
 * `ThemeService::remove`'s own contract), tears down its `extension-file:`
 * registration and every blob URL, drops it from `store`, and — only if the
 * currently active color theme came from this exact package — falls back
 * to Dark Modern (Rust's own `remove` never touches theme *selection*, only
 * the library; this frontend-side fallback is this slice's whole
 * responsibility for that case).
 */
export async function removeImportedThemePackage(
	bridge: PlainBridge,
	store: PlainThemeRegistryStore,
	themeService: IWorkbenchThemeService,
	packageId: string,
): Promise<void> {
	await bridge.themeRemove(packageId);

	const removedEntries = store.importedEntries(packageId) ?? [];
	const currentThemeId = themeService.getColorTheme().id;
	const currentThemeBelongsToRemovedPackage = removedEntries.some(
		(entry) => entry.data.id === currentThemeId,
	);

	store.removeImported(packageId);
	const handle = handlesByPackage.get(packageId);
	handlesByPackage.delete(packageId);
	if (handle !== undefined) {
		for (const url of handle.blobUrls) {
			URL.revokeObjectURL(url);
		}
		await handle.registered.dispose();
	}

	if (currentThemeBelongsToRemovedPackage) {
		await applyDefaultColorTheme(themeService, store.builtin);
	}
}

const THEME_COMMAND_ERROR_MESSAGES: Readonly<Record<string, string>> =
	Object.freeze({
		THEME_PACKAGE_CORRUPT:
			"Plain: the selected file is not a valid theme package archive.",
		THEME_PACKAGE_UNSAFE_PATH:
			"Plain: the theme package contains an unsafe file path and was rejected.",
		THEME_PACKAGE_TOO_LARGE:
			"Plain: the theme package exceeds the supported size limits.",
		THEME_MANIFEST_MISSING:
			"Plain: the theme package is missing its extension manifest.",
		THEME_MANIFEST_INVALID:
			"Plain: the theme package's manifest is not a valid JSON document.",
		THEME_MANIFEST_FIELD_INVALID:
			"Plain: the theme package's manifest has an invalid or missing field.",
		THEME_PACKAGE_NO_THEMES:
			"Plain: the theme package does not contribute any color themes.",
		THEME_CONTRIBUTION_INVALID:
			"Plain: one of the theme package's theme entries is malformed.",
		THEME_CONTRIBUTION_PATH_INVALID:
			"Plain: one of the theme package's theme files is missing or invalid.",
		THEME_JSON_INVALID:
			"Plain: one of the theme package's theme documents is not valid.",
		THEME_INCLUDE_CYCLE:
			"Plain: one of the theme package's theme documents has a circular include.",
		THEME_INCLUDE_TOO_DEEP:
			"Plain: one of the theme package's theme documents nests includes too deeply.",
		THEME_INCLUDE_TOO_MANY:
			"Plain: the theme package's theme documents reference too many files.",
		THEME_INCLUDE_INVALID:
			"Plain: one of the theme package's included files is missing or invalid.",
		THEME_TMTHEME_INVALID:
			"Plain: one of the theme package's TextMate theme files is not valid.",
		THEME_PACKAGE_ALREADY_IMPORTED:
			"Plain: this theme package is already imported.",
		THEME_PICK_FAILED: "Plain: the file/folder picker could not be completed.",
		THEME_PICK_PATH_UNAVAILABLE:
			"Plain: the selected item could not be accessed.",
		THEME_UNAVAILABLE: "Plain: the theme library is not available right now.",
		THEME_STAGE_CLEANUP_FAILED:
			"Plain: a temporary import file could not be cleaned up.",
		THEME_IO_FAILED: "Plain: the theme package could not be processed.",
	});

/** Maps a thrown `theme_*` command failure to a user-facing toast message —
 * every code in the closed set gets a specific, non-leaking sentence (no
 * paths, no raw Rust error text); an unrecognized code still surfaces
 * *which* code it was rather than a bare "something went wrong". */
export function themeCommandErrorMessage(error: unknown): string {
	const normalized = normalizeCommandError(error);
	return (
		THEME_COMMAND_ERROR_MESSAGES[normalized.code] ??
		`Plain: could not complete the theme operation (${normalized.code}).`
	);
}
