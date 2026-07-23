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
				contributes: themes.length > 0 ? { themes } : undefined,
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
		extension("vscode", "theme-defaults", [
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
		]),
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
	];
	return {
		getBuiltinExtensions: () => builtinExtensionsFixture,
	};
});

const {
	createPlainThemeRegistry,
	DARK_MODERN_SETTINGS_ID,
	PlainExtensionResourceLoaderService,
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
