import {
	getBuiltinExtensions,
	type IExtensionManifest,
} from "@codingame/monaco-vscode-api/extensions";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type {
	IColorTheme,
	IIconTheme,
	IProductTheme,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import type { ThemeTypeSelector } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme";
import { IExtensionResourceLoaderService } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service";
import { ColorThemeData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/colorThemeData";
import { ExtensionData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService";
// `FileIconThemeData`/`ProductIconThemeData` (unlike `ColorThemeData`) are not
// re-exported from `@codingame/monaco-vscode-api` itself — they only exist
// inside the override package's own `browser/` folder (confirmed via that
// package's own source: `workbenchThemeService.js`'s browser implementation
// imports both from the sibling `./fileIconThemeData.js`/
// `./productIconThemeData.js` files, never from `monaco-vscode-api`). Both
// modules are pure data-class definitions with no side effects at import
// time (mirrors why a deep import of `colorThemeData` is safe) — this is not
// the forbidden `getThemeServiceOverride()` default export `app/services.ts`
// already imports once for its contribution side effects.
import { FileIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/fileIconThemeData";
import { ProductIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/productIconThemeData";

/**
 * The settingsId (upstream's `contributes.themes[].id`, matching what
 * `ColorThemeData.fromExtensionTheme` assigns as `settingsId`) of the theme
 * Plain applies at bootstrap, before any user selection — see
 * `applyDefaultColorTheme` in `./plain-theme-picker.ts`.
 */
export const DARK_MODERN_SETTINGS_ID = "Dark Modern" as const;

/**
 * The settingsId (`contributes.iconThemes[].id`) of the file icon theme
 * Plain applies at bootstrap, before any user selection — see
 * `applyDefaultFileIconTheme` in `./plain-theme-picker.ts`. `theme-defaults`
 * (the sole built-in extension `app/main.ts` imports) contributes exactly
 * one file icon theme under this id (`./fileicons/vs_minimal-icon-theme.json`,
 * labelled `%minimalIconThemeLabel%` — "Minimal (Visual Studio Code)");
 * confirmed by reading that package's own build-time manifest object, not
 * assumed. Upstream's own default (`ThemeSettingDefaults.FILE_ICON_THEME`,
 * `"vs-seti"`) belongs to the separate `vscode-theme-seti` extension, which
 * Plain does not bundle — there is no seam to reach it, so this is Plain's
 * own default rather than a port of upstream's.
 */
export const VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID = "vs-minimal" as const;

/** One built-in (or, in a later slice, imported) color theme entry Plain
 * knows how to apply. `data` is a bare `ColorThemeData` instance constructed
 * the same way upstream's (never-running, see this module's own doc comment
 * below) extension-point handler would — `IWorkbenchThemeService.
 * setColorTheme()` accepts such an instance directly via its `instanceof
 * ColorThemeData` fallback branch, without any registry of its own knowing
 * about it. */
export interface PlainThemeRegistryEntry {
	/** `ColorThemeData#id`: `${uiTheme} ${extensionId}-${themePath}`, unique
	 * per theme resource. Not user-facing. */
	readonly id: string;
	/** Resolved (NLS-substituted, see `resolveNlsValue`) display label. */
	readonly label: string;
	/** `ColorThemeData#settingsId`: the manifest's own
	 * `contributes.themes[].id`, e.g. `"Dark Modern"` — what a real
	 * `workbench.colorTheme` setting value would hold. */
	readonly settingsId: string;
	readonly uiTheme: IColorTheme["uiTheme"];
	readonly data: ColorThemeData;
}

const NLS_PLACEHOLDER_PATTERN = /^%(.+)%$/;

function isStringRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Best-effort `package.nls.json` reader for one extension's own
 * `extension-file:` location. Absence or malformed content degrades to an
 * empty bundle (leaving any `%placeholder%` label unresolved) rather than
 * failing registry construction for every other extension — this mirrors
 * how a single bad theme is expected to degrade in isolation, not take the
 * whole picker down.
 */
async function readNlsBundle(
	fileService: IFileService,
	extensionLocation: URI,
): Promise<Readonly<Record<string, string>>> {
	try {
		const content = await fileService.readFile(
			URI.joinPath(extensionLocation, "package.nls.json"),
		);
		const parsed: unknown = JSON.parse(content.value.toString());
		if (!isStringRecord(parsed)) {
			return Object.freeze({});
		}
		const bundle: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") {
				bundle[key] = value;
			}
		}
		return Object.freeze(bundle);
	} catch {
		return Object.freeze({});
	}
}

/**
 * Resolves one manifest string against an extension's NLS bundle. Manifest
 * values that are not an exact `%key%` placeholder (Plain never generates
 * them, but a hostile/malformed manifest could) pass through unchanged,
 * matching upstream's own translator leaving non-placeholder strings alone.
 */
function resolveNlsValue(
	raw: string,
	bundle: Readonly<Record<string, string>>,
): string {
	const match = NLS_PLACEHOLDER_PATTERN.exec(raw);
	if (match === null) {
		return raw;
	}
	const key = match[1]!;
	return bundle[key] ?? raw;
}

function hasThemeContributions(
	manifest: IExtensionManifest,
): manifest is IExtensionManifest & {
	contributes: { themes: readonly IColorTheme[] };
} {
	const themes = manifest.contributes?.themes;
	return Array.isArray(themes) && themes.length > 0;
}

function hasIconThemeContributions(
	manifest: IExtensionManifest,
): manifest is IExtensionManifest & {
	contributes: { iconThemes: readonly IIconTheme[] };
} {
	const iconThemes = manifest.contributes?.iconThemes;
	return Array.isArray(iconThemes) && iconThemes.length > 0;
}

function hasProductIconThemeContributions(
	manifest: IExtensionManifest,
): manifest is IExtensionManifest & {
	contributes: { productIconThemes: readonly IProductTheme[] };
} {
	const productIconThemes = manifest.contributes?.productIconThemes;
	return Array.isArray(productIconThemes) && productIconThemes.length > 0;
}

/** One built-in file icon theme entry Plain knows how to apply — the
 * `FileIconThemeData` analogue of `PlainThemeRegistryEntry`. `settingsId` is
 * always the manifest's own `contributes.iconThemes[].id` verbatim: unlike
 * `ColorThemeData#settingsId`'s `theme.id || label` fallback,
 * `FileIconThemeData.fromExtensionTheme`'s `settingsId = iconTheme.id` has no
 * fallback — upstream's own `ThemeRegistry` for this axis is constructed
 * with `idRequired = true` (confirmed in `workbenchThemeService.js`'s
 * `fileIconThemeRegistry` construction), so an entry actually built from a
 * manifest contribution never has a missing id in the first place. */
export interface PlainFileIconThemeRegistryEntry {
	readonly id: string;
	readonly label: string;
	readonly settingsId: string;
	readonly data: FileIconThemeData;
}

/** The `ProductIconThemeData` analogue of `PlainFileIconThemeRegistryEntry` —
 * same `idRequired = true` guarantee applies (see that interface's own doc
 * comment), confirmed via `workbenchThemeService.js`'s
 * `productIconThemeRegistry` construction. */
export interface PlainProductIconThemeRegistryEntry {
	readonly id: string;
	readonly label: string;
	readonly settingsId: string;
	readonly data: ProductIconThemeData;
}

/**
 * Enumerates every built-in color theme and constructs a ready-to-apply
 * `ColorThemeData` instance for each, entirely bypassing the (inert, see
 * below) extension-point/`ExtensionsRegistry` machinery upstream normally
 * uses to populate this list.
 *
 * `getBuiltinExtensions()` (from `@codingame/monaco-vscode-api/extensions`,
 * the lazily-static contribution registry read AGENTS.md permits — see the
 * repository root AGENTS.md's native-services rules on `monaco-vscode-api`)
 * returns every extension `registerExtension`-ed before Workbench
 * `initialize()` — today, exactly `@codingame/monaco-vscode-theme-defaults-
 * default-extension`'s 10 themes, imported for its side effect at the very
 * top of `app/main.ts`. Their manifest is never translated (VS Code's own
 * `ExtensionManifestTranslator` only runs from `registerExtension`'s
 * `deltaExtensions` branch, which requires `servicesInitialized` to already
 * be true — never the case for anything registered before `initialize()`),
 * so `label` fields still hold raw `%key%` NLS placeholders; this function
 * resolves them itself via each extension's own `package.nls.json` (also
 * already reachable through the same `extension-file:` virtual tree).
 *
 * The resulting entries are never registered into any `ThemeRegistry`
 * (upstream's `IWorkbenchThemeService` has no public API to do that, and
 * none is needed): `IWorkbenchThemeService.setColorTheme()` accepts a bare
 * `ColorThemeData` instance directly through its `instanceof ColorThemeData`
 * fallback branch once `colorThemeRegistry.findThemeById` reports no match
 * (see `WorkbenchThemeService.internalSetColorTheme` in `@codingame/
 * monaco-vscode-theme-service-override`) — exactly what `applyDefaultColorTheme`
 * and `PlainThemePicker` (`./plain-theme-picker.ts`) both do.
 */
/**
 * Builds one registry entry the same way for every source (built-in at
 * bootstrap, or an imported package's resource at `F050` S3 consumption
 * time — see `plain-theme-import-coordinator.ts`): resolve the theme
 * document's location under `extensionLocation`, construct the bare
 * `ColorThemeData` instance directly (bypassing `ExtensionsRegistry`, see
 * this module's own top-level doc comment on why that is always safe here),
 * and freeze the entry.
 */
export function buildPlainThemeRegistryEntry(
	extensionLocation: URI,
	extensionData: ExtensionData,
	theme: Readonly<{
		readonly id?: string;
		readonly label: string;
		readonly uiTheme: IColorTheme["uiTheme"];
		readonly path: string;
	}>,
): PlainThemeRegistryEntry {
	const colorThemeLocation = URI.joinPath(extensionLocation, theme.path);
	const data = ColorThemeData.fromExtensionTheme(
		{
			// `fromExtensionTheme`'s own fallback is `settingsId = theme.id ||
			// label` — an empty string is exactly as falsy as `undefined` for
			// that check, so this preserves the exact upstream semantics for a
			// manifest that never had a theme-level `id` (F050 S3's imported
			// packages never do — that field is out of scope, see `theme::
			// manifest`) while still satisfying this constructor's own `id:
			// string` (non-optional) parameter type.
			id: theme.id ?? "",
			label: theme.label,
			path: theme.path,
			uiTheme: theme.uiTheme as ThemeTypeSelector,
			_watch: false,
		},
		colorThemeLocation,
		extensionData,
	);
	return Object.freeze({
		id: data.id,
		label: data.label,
		settingsId: data.settingsId,
		uiTheme: theme.uiTheme,
		data,
	});
}

export async function createPlainThemeRegistry(
	fileService: IFileService,
): Promise<readonly PlainThemeRegistryEntry[]> {
	const entries: PlainThemeRegistryEntry[] = [];
	for (const extension of getBuiltinExtensions()) {
		const manifest = extension.manifest;
		if (!hasThemeContributions(manifest)) {
			continue;
		}
		const nlsBundle = await readNlsBundle(fileService, extension.location);
		const extensionData = ExtensionData.fromName(
			manifest.publisher,
			manifest.name,
			true,
		);
		for (const theme of manifest.contributes.themes) {
			const label = resolveNlsValue(theme.label, nlsBundle);
			entries.push(
				buildPlainThemeRegistryEntry(extension.location, extensionData, {
					id: theme.id,
					label,
					uiTheme: theme.uiTheme,
					path: theme.path,
				}),
			);
		}
	}
	return Object.freeze(entries);
}

/** `buildPlainThemeRegistryEntry`'s `FileIconThemeData` analogue. There is
 * no imported-package consumption side yet (`F060` S2's own scope is
 * built-in activation only — see `docs/research/2026-07-24-icon-themes.md`'s
 * "实施偏差记录" for why: the Rust `theme_list`/`theme_import_*` wire
 * contract does not project `iconThemes`/`productIconThemes` onto
 * `ThemePackageSummary` yet, only `theme::record::StoredThemePackageManifest`
 * carries them — extending the wire contract is a `src-tauri/src/theme/
 * dto.rs` change, out of this slice's scope), but this is still exported
 * (rather than kept as a private implementation detail of
 * `createPlainFileIconThemeRegistry` below) for the same reason
 * `buildPlainThemeRegistryEntry` is: a future slice's import consumption can
 * reuse it verbatim once that wire contract exists. */
export function buildPlainFileIconThemeRegistryEntry(
	extensionLocation: URI,
	extensionData: ExtensionData,
	theme: Readonly<{
		readonly id: string;
		readonly label: string;
		readonly path: string;
	}>,
): PlainFileIconThemeRegistryEntry {
	const location = URI.joinPath(extensionLocation, theme.path);
	const data = FileIconThemeData.fromExtensionTheme(
		{
			id: theme.id,
			label: theme.label,
			path: theme.path,
			_watch: false,
		},
		location,
		extensionData,
	);
	return Object.freeze({
		id: data.id,
		label: data.label,
		// See `PlainFileIconThemeRegistryEntry`'s own doc comment: this axis's
		// `settingsId` is always `theme.id` verbatim, never a `label` fallback.
		settingsId: theme.id,
		data,
	});
}

/** `buildPlainThemeRegistryEntry`'s `ProductIconThemeData` analogue — see
 * `buildPlainFileIconThemeRegistryEntry`'s own doc comment for why imported
 * packages are out of scope here too. */
export function buildPlainProductIconThemeRegistryEntry(
	extensionLocation: URI,
	extensionData: ExtensionData,
	theme: Readonly<{
		readonly id: string;
		readonly label: string;
		readonly path: string;
	}>,
): PlainProductIconThemeRegistryEntry {
	const location = URI.joinPath(extensionLocation, theme.path);
	const data = ProductIconThemeData.fromExtensionTheme(
		{
			id: theme.id,
			label: theme.label,
			path: theme.path,
			_watch: false,
		},
		location,
		extensionData,
	);
	return Object.freeze({
		id: data.id,
		label: data.label,
		settingsId: theme.id,
		data,
	});
}

/** Enumerates every built-in file icon theme the same way
 * `createPlainThemeRegistry` enumerates color themes — see that function's
 * own doc comment for the full explanation of `getBuiltinExtensions()`/NLS
 * resolution shared by both. Today this is exactly `theme-defaults`'s single
 * `vs-minimal` contribution (see `VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID`'s
 * own doc comment). */
export async function createPlainFileIconThemeRegistry(
	fileService: IFileService,
): Promise<readonly PlainFileIconThemeRegistryEntry[]> {
	const entries: PlainFileIconThemeRegistryEntry[] = [];
	for (const extension of getBuiltinExtensions()) {
		const manifest = extension.manifest;
		if (!hasIconThemeContributions(manifest)) {
			continue;
		}
		const nlsBundle = await readNlsBundle(fileService, extension.location);
		const extensionData = ExtensionData.fromName(
			manifest.publisher,
			manifest.name,
			true,
		);
		for (const theme of manifest.contributes.iconThemes) {
			const label = resolveNlsValue(theme.label, nlsBundle);
			entries.push(
				buildPlainFileIconThemeRegistryEntry(
					extension.location,
					extensionData,
					{
						id: theme.id,
						label,
						path: theme.path,
					},
				),
			);
		}
	}
	return Object.freeze(entries);
}

/** `createPlainFileIconThemeRegistry`'s product icon theme analogue. Today
 * this always returns an empty array: `theme-defaults` (the sole built-in
 * extension) contributes no `productIconThemes` (confirmed by reading its
 * own build-time manifest object — the field is entirely absent), so
 * `PlainThemePicker`'s product icon theme Quick Pick only ever offers
 * "Default" (`ProductIconThemeData.defaultTheme`, always available without
 * any registry entry — see `./plain-theme-picker.ts`). */
export async function createPlainProductIconThemeRegistry(
	fileService: IFileService,
): Promise<readonly PlainProductIconThemeRegistryEntry[]> {
	const entries: PlainProductIconThemeRegistryEntry[] = [];
	for (const extension of getBuiltinExtensions()) {
		const manifest = extension.manifest;
		if (!hasProductIconThemeContributions(manifest)) {
			continue;
		}
		const nlsBundle = await readNlsBundle(fileService, extension.location);
		const extensionData = ExtensionData.fromName(
			manifest.publisher,
			manifest.name,
			true,
		);
		for (const theme of manifest.contributes.productIconThemes) {
			const label = resolveNlsValue(theme.label, nlsBundle);
			entries.push(
				buildPlainProductIconThemeRegistryEntry(
					extension.location,
					extensionData,
					{ id: theme.id, label, path: theme.path },
				),
			);
		}
	}
	return Object.freeze(entries);
}

/**
 * Plain's own, minimal `IExtensionResourceLoaderService`. The only
 * implementation either `@codingame/monaco-vscode-theme-service-override`
 * or `@codingame/monaco-vscode-files-service-override` provides for this
 * token is `missing-services.js`'s `Unsupported`-decorated stub (every
 * method throws) — without a real implementation,
 * `ColorThemeData#ensureLoaded`/`WorkbenchThemeService.setColorTheme` would
 * throw for every theme, built-in or imported, since both call
 * `readExtensionResource` directly (see `_loadColorTheme` in `@codingame/
 * monaco-vscode-api`'s `colorThemeData.js`). This class only ever reads
 * already-registered `extension-file:` resources through the existing,
 * already-wired `IFileService` — it does not add any new filesystem access,
 * scheme, or provider.
 */
export class PlainExtensionResourceLoaderService implements IExtensionResourceLoaderService {
	readonly _serviceBrand: undefined;
	readonly #fileService: IFileService;

	constructor(fileService: IFileService) {
		this.#fileService = fileService;
	}

	async readExtensionResource(uri: URI): Promise<string> {
		const content = await this.#fileService.readFile(uri);
		return content.value.toString();
	}

	async supportsExtensionGalleryResources(): Promise<boolean> {
		return false;
	}

	async isExtensionGalleryResource(_uri: URI): Promise<boolean> {
		return false;
	}

	async getExtensionGalleryResourceURL(
		_galleryExtension: {
			readonly publisher: string;
			readonly name: string;
			readonly version: string;
		},
		_path?: string,
	): Promise<URI | undefined> {
		return undefined;
	}
}

Object.freeze(PlainExtensionResourceLoaderService.prototype);

// Manual DI-dependency registration — see the identical pattern (and its
// own doc comment on *why*) in `app/features/search/plain-search-service.ts`.
IFileService(PlainExtensionResourceLoaderService, undefined, 0);
