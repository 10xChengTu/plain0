import { describe, expect, it, vi } from "vitest";

import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ColorThemeData } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/colorThemeData";

// `vi.mock` factories are hoisted above every import in this file (including
// the `URI` import above), so the fixture extensions — which need a real
// `URI` instance for `location` (createPlainThemeRegistry calls
// `URI.joinPath(extension.location, theme.path)`, which in turn calls
// `location.with(...)` — a real URI instance method a hand-rolled plain
// object cannot provide) — are built from a *dynamic* re-import inside the
// factory itself rather than referencing the module-scope `URI` binding
// above, which would still be in its temporal dead zone at hoist time.
vi.mock("@codingame/monaco-vscode-api/extensions", async () => {
	const { URI: DynamicUri } =
		await import("@codingame/monaco-vscode-api/vscode/vs/base/common/uri");
	function extension(
		publisher: string,
		name: string,
		themes: readonly {
			id: string;
			label: string;
			uiTheme: "vs" | "vs-dark" | "hc-black" | "hc-light";
			path: string;
		}[],
		// `F060` S2: the same manifest object real `theme-defaults` uses can
		// carry `iconThemes`/`productIconThemes` alongside `themes` — kept as
		// trailing optional parameters (defaulting to "field absent entirely",
		// not merely "empty array", mirroring a real manifest that never
		// declares the field) so every existing call site above is unaffected.
		iconThemes?: readonly {
			id: string;
			label: string;
			path: string;
		}[],
		productIconThemes?: readonly {
			id: string;
			label: string;
			path: string;
		}[],
	): unknown {
		return {
			type: 0,
			isBuiltin: true,
			identifier: { id: `${publisher}.${name}` },
			manifest: {
				name,
				publisher,
				version: "1.0.0",
				engines: { vscode: "*" },
				contributes:
					themes.length > 0 ||
					iconThemes !== undefined ||
					productIconThemes !== undefined
						? {
								...(themes.length > 0 ? { themes } : {}),
								...(iconThemes !== undefined ? { iconThemes } : {}),
								...(productIconThemes !== undefined
									? { productIconThemes }
									: {}),
							}
						: undefined,
			},
			location: DynamicUri.from({
				scheme: "extension-file",
				authority: `${publisher}.${name}`,
				path: "/extension",
			}),
			targetPlatform: "web",
			isValid: true,
			validations: [],
			preRelease: false,
		};
	}
	const builtinExtensionsFixture = [
		extension(
			"vscode",
			"theme-defaults",
			[
				{
					id: "Dark Modern",
					label: "%darkModernThemeLabel%",
					uiTheme: "vs-dark",
					path: "./themes/dark_modern.json",
				},
				{
					id: "Visual Studio Light",
					label: "%lightColorThemeLabel%",
					uiTheme: "vs",
					path: "./themes/light_vs.json",
				},
			],
			// Mirrors the real `@codingame/monaco-vscode-theme-defaults-default-
			// extension` build-time manifest object exactly (see
			// `VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID`'s own doc comment):
			// `theme-defaults` contributes both axes side by side, and zero
			// `productIconThemes`.
			[
				{
					id: "vs-minimal",
					label: "%minimalIconThemeLabel%",
					path: "./fileicons/vs_minimal-icon-theme.json",
				},
			],
		),
		// No `contributes.themes` at all — must be filtered out entirely.
		extension("vscode", "no-themes", []),
		// A second extension whose nls bundle is deliberately missing, so its
		// placeholder label must degrade to the raw `%key%` string rather than
		// throwing or blocking the first extension's themes.
		extension("acme", "broken-nls", [
			{
				id: "Acme Theme",
				label: "%acmeThemeLabel%",
				uiTheme: "hc-black",
				path: "./themes/acme.json",
			},
		]),
		// Contributes only a product icon theme (zero color themes, zero file
		// icon themes) — proves each of the three registries filters
		// independently by its own axis, not by "this extension contributes
		// something".
		extension("acme", "product-icons-only", [], undefined, [
			{
				id: "Acme Product Icons",
				label: "%acmeProductIconThemeLabel%",
				path: "./producticons/acme.json",
			},
		]),
	];
	return {
		getBuiltinExtensions: () => builtinExtensionsFixture,
	};
});

const {
	buildPlainFileIconThemeRegistryEntry,
	buildPlainProductIconThemeRegistryEntry,
	createPlainFileIconThemeRegistry,
	createPlainProductIconThemeRegistry,
	createPlainThemeRegistry,
	DARK_MODERN_SETTINGS_ID,
	PlainExtensionResourceLoaderService,
	VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID,
} = await import("../../app/features/themes/plain-theme-registry");

interface FakeFileService {
	readFile(uri: URI): Promise<{ value: { toString(): string } }>;
}

function fakeFileService(
	nlsBundlesByAuthority: ReadonlyMap<string, unknown>,
): FakeFileService {
	return {
		async readFile(uri: URI) {
			if (
				uri.scheme === "extension-file" &&
				uri.path === "/extension/package.nls.json" &&
				nlsBundlesByAuthority.has(uri.authority)
			) {
				const bundle = nlsBundlesByAuthority.get(uri.authority);
				return { value: { toString: () => JSON.stringify(bundle) } };
			}
			throw new Error(`unexpected readFile: ${uri.toString()}`);
		},
	};
}

describe("PlainThemeRegistry", () => {
	it("enumerates only extensions that contribute themes, resolving NLS labels and skipping unreadable bundles", async () => {
		const fileService = fakeFileService(
			new Map([
				[
					"vscode.theme-defaults",
					{
						darkModernThemeLabel: "Dark Modern",
						lightColorThemeLabel: "Light (Visual Studio)",
					},
				],
				// acme.broken-nls intentionally has no entry — readFile throws.
			]),
		);

		const registry = await createPlainThemeRegistry(
			fileService as unknown as Parameters<typeof createPlainThemeRegistry>[0],
		);

		expect(registry).toHaveLength(3);
		expect(registry.map((entry) => entry.settingsId)).toEqual([
			"Dark Modern",
			"Visual Studio Light",
			"Acme Theme",
		]);
		expect(registry.map((entry) => entry.label)).toEqual([
			"Dark Modern",
			"Light (Visual Studio)",
			// nls bundle for acme.broken-nls could not be read: raw placeholder
			// label passes through unresolved rather than throwing.
			"%acmeThemeLabel%",
		]);
		expect(registry.map((entry) => entry.uiTheme)).toEqual([
			"vs-dark",
			"vs",
			"hc-black",
		]);
		for (const entry of registry) {
			expect(entry.data).toBeInstanceOf(ColorThemeData);
			expect(entry.data.isLoaded).toBe(false);
			expect(entry.id).toBe(entry.data.id);
			expect(entry.label).toBe(entry.data.label);
			expect(entry.settingsId).toBe(entry.data.settingsId);
			expect(Object.isFrozen(entry)).toBe(true);
		}
		expect(Object.isFrozen(registry)).toBe(true);
	});

	it("degrades to an empty registry (not a throw) when the NLS bundle is malformed JSON", async () => {
		const fileService: FakeFileService = {
			async readFile() {
				return { value: { toString: () => "not json {" } };
			},
		};
		const registry = await createPlainThemeRegistry(
			fileService as unknown as Parameters<typeof createPlainThemeRegistry>[0],
		);
		expect(registry).toHaveLength(3);
		// All three labels stay as their raw, unresolved placeholders since the
		// (shared, malformed) nls bundle could not be parsed for any extension.
		expect(registry.map((entry) => entry.label)).toEqual([
			"%darkModernThemeLabel%",
			"%lightColorThemeLabel%",
			"%acmeThemeLabel%",
		]);
	});

	it("degrades to an empty bundle (not a throw) when the NLS bundle is valid JSON but not an object", async () => {
		const fileService: FakeFileService = {
			async readFile() {
				return { value: { toString: () => "[1,2,3]" } };
			},
		};
		const registry = await createPlainThemeRegistry(
			fileService as unknown as Parameters<typeof createPlainThemeRegistry>[0],
		);
		expect(registry[0]?.label).toBe("%darkModernThemeLabel%");
	});

	it("exposes the exact settingsId of the theme Plain applies as its bootstrap default", () => {
		expect(DARK_MODERN_SETTINGS_ID).toBe("Dark Modern");
	});
});

describe("PlainFileIconThemeRegistry", () => {
	it("enumerates only the one built-in file icon theme contribution, resolving its NLS label", async () => {
		const fileService = fakeFileService(
			new Map([
				[
					"vscode.theme-defaults",
					{ minimalIconThemeLabel: "Minimal (Visual Studio Code)" },
				],
			]),
		);

		const registry = await createPlainFileIconThemeRegistry(
			fileService as unknown as Parameters<
				typeof createPlainFileIconThemeRegistry
			>[0],
		);

		expect(registry).toHaveLength(1);
		const [entry] = registry;
		expect(entry?.settingsId).toBe("vs-minimal");
		expect(entry?.label).toBe("Minimal (Visual Studio Code)");
		expect(entry?.id).toBe(entry?.data.id);
		expect(entry?.data.isLoaded).toBe(false);
		expect(Object.isFrozen(entry)).toBe(true);
		expect(Object.isFrozen(registry)).toBe(true);
	});

	it("degrades to the raw NLS placeholder when the bundle cannot be read, without throwing", async () => {
		const fileService: FakeFileService = {
			async readFile() {
				throw new Error("boom");
			},
		};
		const registry = await createPlainFileIconThemeRegistry(
			fileService as unknown as Parameters<
				typeof createPlainFileIconThemeRegistry
			>[0],
		);
		expect(registry).toHaveLength(1);
		expect(registry[0]?.label).toBe("%minimalIconThemeLabel%");
	});

	it("exposes the exact settingsId of the file icon theme Plain applies as its bootstrap default", () => {
		expect(VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID).toBe("vs-minimal");
	});
});

describe("PlainProductIconThemeRegistry", () => {
	it("enumerates only extensions that contribute product icon themes, independent of the other two axes", async () => {
		const fileService = fakeFileService(
			new Map([
				[
					"acme.product-icons-only",
					{ acmeProductIconThemeLabel: "Acme Product Icons" },
				],
			]),
		);

		const registry = await createPlainProductIconThemeRegistry(
			fileService as unknown as Parameters<
				typeof createPlainProductIconThemeRegistry
			>[0],
		);

		expect(registry).toHaveLength(1);
		const [entry] = registry;
		expect(entry?.settingsId).toBe("Acme Product Icons");
		expect(entry?.label).toBe("Acme Product Icons");
		expect(entry?.id).toBe(entry?.data.id);
		expect(Object.isFrozen(entry)).toBe(true);
	});

	it("returns an empty (still frozen) registry when no built-in extension contributes any product icon theme", async () => {
		// `theme-defaults` itself never declares `productIconThemes` (see
		// `createPlainProductIconThemeRegistry`'s own doc comment) — this
		// fixture's other three extensions collectively cover that "field
		// absent" shape already; asserting the shape of the *returned* value
		// here (frozen empty array, not `undefined`/a throw) is the point.
		const fileService: FakeFileService = {
			async readFile() {
				throw new Error("unexpected — no productIconThemes to resolve NLS for");
			},
		};
		const registry = await createPlainProductIconThemeRegistry(
			fileService as unknown as Parameters<
				typeof createPlainProductIconThemeRegistry
			>[0],
		);
		expect(registry).toHaveLength(1);
		expect(Object.isFrozen(registry)).toBe(true);
	});
});

describe("buildPlainFileIconThemeRegistryEntry / buildPlainProductIconThemeRegistryEntry", () => {
	it("both set settingsId to the given id verbatim, with no label fallback", async () => {
		const { URI: DynamicUri } =
			await import("@codingame/monaco-vscode-api/vscode/vs/base/common/uri");
		const { ExtensionData } =
			await import("@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService");
		const location = DynamicUri.from({
			scheme: "extension-file",
			authority: "acme.icons",
			path: "/extension",
		});
		const extensionData = ExtensionData.fromName("acme", "icons", true);
		const theme = {
			id: "acme-icon-theme",
			label: "Acme Icons",
			path: "./fileicons/acme.json",
		};

		const fileIconEntry = buildPlainFileIconThemeRegistryEntry(
			location,
			extensionData,
			theme,
		);
		expect(fileIconEntry.settingsId).toBe("acme-icon-theme");
		expect(fileIconEntry.id).toBe(fileIconEntry.data.id);
		expect(Object.isFrozen(fileIconEntry)).toBe(true);

		const productIconEntry = buildPlainProductIconThemeRegistryEntry(
			location,
			extensionData,
			theme,
		);
		expect(productIconEntry.settingsId).toBe("acme-icon-theme");
		expect(productIconEntry.id).toBe(productIconEntry.data.id);
		expect(Object.isFrozen(productIconEntry)).toBe(true);
	});
});

describe("PlainExtensionResourceLoaderService", () => {
	function serviceWithFakeFileService(content: string): {
		service: InstanceType<typeof PlainExtensionResourceLoaderService>;
		readFile: ReturnType<typeof vi.fn>;
	} {
		const readFile = vi.fn(async () => ({
			value: { toString: () => content },
		}));
		const fileService = { readFile } as unknown as ConstructorParameters<
			typeof PlainExtensionResourceLoaderService
		>[0];
		return {
			service: new PlainExtensionResourceLoaderService(fileService),
			readFile,
		};
	}

	it("reads extension resources through the injected IFileService, verbatim", async () => {
		const { service, readFile } = serviceWithFakeFileService("hello world");
		const uri = URI.parse("extension-file://vscode.theme-defaults/extension/x");

		await expect(service.readExtensionResource(uri)).resolves.toBe(
			"hello world",
		);
		expect(readFile).toHaveBeenCalledTimes(1);
		expect(readFile).toHaveBeenCalledWith(uri);
	});

	it("never claims gallery resource support", async () => {
		const { service } = serviceWithFakeFileService("");
		await expect(service.supportsExtensionGalleryResources()).resolves.toBe(
			false,
		);
		await expect(
			service.isExtensionGalleryResource(URI.parse("https://example.invalid")),
		).resolves.toBe(false);
		await expect(
			service.getExtensionGalleryResourceURL({
				publisher: "vscode",
				name: "theme-defaults",
				version: "1.0.0",
			}),
		).resolves.toBeUndefined();
	});

	it("propagates a failing read rather than swallowing it", async () => {
		const readFile = vi.fn(async () => {
			throw new Error("boom");
		});
		const service = new PlainExtensionResourceLoaderService({
			readFile,
		} as unknown as ConstructorParameters<
			typeof PlainExtensionResourceLoaderService
		>[0]);
		await expect(
			service.readExtensionResource(
				URI.parse("extension-file://vscode.theme-defaults/extension/x"),
			),
		).rejects.toThrow("boom");
	});
});
