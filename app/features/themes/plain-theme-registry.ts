import {
	getBuiltinExtensions,
	type IExtensionManifest,
} from "@codingame/monaco-vscode-api/extensions";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { IColorTheme } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import type { ThemeTypeSelector } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme";
import { IExtensionResourceLoaderService } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service";
import { ColorThemeData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/colorThemeData";
import { ExtensionData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService";

/**
 * The settingsId (upstream's `contributes.themes[].id`, matching what
 * `ColorThemeData.fromExtensionTheme` assigns as `settingsId`) of the theme
 * Plain applies at bootstrap, before any user selection — see
 * `applyDefaultColorTheme` in `./plain-theme-picker.ts`.
 */
export const DARK_MODERN_SETTINGS_ID = "Dark Modern" as const;

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
			const colorThemeLocation = URI.joinPath(extension.location, theme.path);
			const data = ColorThemeData.fromExtensionTheme(
				{
					id: theme.id,
					label,
					path: theme.path,
					uiTheme: theme.uiTheme as ThemeTypeSelector,
					_watch: false,
				},
				colorThemeLocation,
				extensionData,
			);
			entries.push(
				Object.freeze({
					id: data.id,
					label: data.label,
					settingsId: data.settingsId,
					uiTheme: theme.uiTheme,
					data,
				}),
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
