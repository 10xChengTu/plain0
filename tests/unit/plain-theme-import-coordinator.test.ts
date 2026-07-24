import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeRegisteredExtension {
	readonly id: string;
	readonly dispose: ReturnType<typeof vi.fn>;
	readonly whenReady: ReturnType<typeof vi.fn>;
	readonly isEnabled: ReturnType<typeof vi.fn>;
	readonly registerFileUrl: ReturnType<typeof vi.fn>;
}

const registeredExtensions: FakeRegisteredExtension[] = [];

vi.mock("@codingame/monaco-vscode-api/extensions", () => ({
	registerExtension: vi.fn((manifest: { publisher: string; name: string }) => {
		const extension: FakeRegisteredExtension = {
			id: `${manifest.publisher}.${manifest.name}`,
			dispose: vi.fn(async () => undefined),
			whenReady: vi.fn(async () => undefined),
			isEnabled: vi.fn(async () => true),
			registerFileUrl: vi.fn(() => ({ dispose: () => undefined })),
		};
		registeredExtensions.push(extension);
		return extension;
	}),
}));

import type {
	PlainBridge,
	ThemeImportResult,
	ThemePackageSummary,
} from "../../app/platform/tauri/contracts";
import {
	consumeImportedThemePackages,
	importThemePackageViaDirectory,
	importThemePackageViaVsix,
	PlainThemeRegistryStore,
	removeImportedThemePackage,
	themeCommandErrorMessage,
} from "../../app/features/themes/plain-theme-import-coordinator";

function notImplemented(): never {
	throw new Error("not implemented in fake bridge for this test");
}

function fakeBridge(overrides: Partial<PlainBridge> = {}): PlainBridge {
	return {
		runtimeInfo: notImplemented,
		onRuntimeReady: notImplemented,
		workspaceCapabilities: notImplemented,
		workspaceSnapshot: notImplemented,
		workspaceReconcileWatchRoots: notImplemented,
		workspaceWatch: notImplemented,
		workspacePickRoots: notImplemented,
		workspaceRemoveRoot: notImplemented,
		workspaceCreateFile: notImplemented,
		workspaceCreateDirectory: notImplemented,
		workspaceRename: notImplemented,
		workspaceCopy: notImplemented,
		workspaceMove: notImplemented,
		workspacePrepareDelete: notImplemented,
		workspaceCancelDelete: notImplemented,
		workspaceBeginDelete: notImplemented,
		workspaceCommitDeleteEntry: notImplemented,
		workspaceStat: notImplemented,
		workspaceReadDirectory: notImplemented,
		workspaceReadFile: notImplemented,
		workspaceWriteFile: notImplemented,
		workspaceSearchFiles: notImplemented,
		workspaceSearchTextStart: notImplemented,
		workspaceSearchTextPoll: notImplemented,
		workspaceSearchTextCancel: notImplemented,
		workspaceSearchTextWatch: notImplemented,
		backupWrite: notImplemented,
		backupReadAll: notImplemented,
		backupDiscard: notImplemented,
		backupDiscardAll: notImplemented,
		themeImportVsix: notImplemented,
		themeImportDirectory: notImplemented,
		themeList: notImplemented,
		themeReadResource: notImplemented,
		themeRemove: notImplemented,
		themeGetSelection: notImplemented,
		themeSetSelection: notImplemented,
		...overrides,
	};
}

function samplePackage(
	overrides: Partial<ThemePackageSummary> = {},
): ThemePackageSummary {
	return {
		id: "demo-publisher.demo-theme@1.0.0",
		publisher: "demo-publisher",
		name: "demo-theme",
		version: "1.0.0",
		themes: [
			{ label: "Demo Dark", uiTheme: "vs-dark", path: "themes/dark.json" },
		],
		resources: ["themes/dark.json"],
		containsCode: false,
		...overrides,
	};
}

const DEMO_THEME_JSON = '{ "colors": { "editor.background": "#1f1f1f" } }';

function bridgeWithResourceBytes(
	overrides: Partial<PlainBridge> = {},
): PlainBridge {
	return fakeBridge({
		themeReadResource: async () => new TextEncoder().encode(DEMO_THEME_JSON),
		...overrides,
	});
}

const createdObjectUrls: string[] = [];
const revokedObjectUrls: string[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function trackObjectUrls(): void {
	URL.createObjectURL = ((blob: Blob) => {
		const url = originalCreateObjectURL.call(URL, blob);
		createdObjectUrls.push(url);
		return url;
	}) as typeof URL.createObjectURL;
	URL.revokeObjectURL = ((url: string) => {
		revokedObjectUrls.push(url);
		return originalRevokeObjectURL.call(URL, url);
	}) as typeof URL.revokeObjectURL;
}

afterEach(() => {
	registeredExtensions.length = 0;
	createdObjectUrls.length = 0;
	revokedObjectUrls.length = 0;
	URL.createObjectURL = originalCreateObjectURL;
	URL.revokeObjectURL = originalRevokeObjectURL;
});

describe("PlainThemeRegistryStore", () => {
	it("starts with only the built-in entries and combines imported entries into entries()", () => {
		const builtinEntry = {
			id: "vs-dark builtin",
			label: "Builtin",
			settingsId: "Builtin",
			uiTheme: "vs-dark" as const,
			data: {} as never,
		};
		const store = new PlainThemeRegistryStore([builtinEntry]);
		expect(store.entries()).toEqual([builtinEntry]);
		expect(store.builtin).toEqual([builtinEntry]);
		expect(store.importedPackageIds()).toEqual([]);

		const importedEntry = {
			id: "vs-dark imported",
			label: "Imported",
			settingsId: "Imported",
			uiTheme: "vs-dark" as const,
			data: {} as never,
		};
		store.setImported("demo.pkg@1.0.0", [importedEntry]);
		expect(store.entries()).toEqual([builtinEntry, importedEntry]);
		expect(store.importedPackageIds()).toEqual(["demo.pkg@1.0.0"]);
		expect(store.importedEntries("demo.pkg@1.0.0")).toEqual([importedEntry]);
		expect(store.importedEntries("unknown")).toBeUndefined();

		store.removeImported("demo.pkg@1.0.0");
		expect(store.entries()).toEqual([builtinEntry]);
		expect(store.importedPackageIds()).toEqual([]);
	});

	it("sorts importedPackageIds", () => {
		const store = new PlainThemeRegistryStore([]);
		store.setImported("z.pkg@1.0.0", []);
		store.setImported("a.pkg@1.0.0", []);
		expect(store.importedPackageIds()).toEqual(["a.pkg@1.0.0", "z.pkg@1.0.0"]);
	});
});

describe("importThemePackageViaVsix / importThemePackageViaDirectory", () => {
	it("returns cancelled without registering anything", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const bridge = fakeBridge({
			themeImportVsix: async () =>
				({ status: "cancelled" }) satisfies ThemeImportResult,
		});
		const result = await importThemePackageViaVsix(bridge, store);
		expect(result).toEqual({ status: "cancelled" });
		expect(store.entries()).toEqual([]);
		expect(registeredExtensions).toHaveLength(0);
	});

	it("registers an imported package's resources as blob URLs and registry entries", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "register-test.pkg@1.0.0",
			name: "register-test",
		});
		const bridge = bridgeWithResourceBytes({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
		});

		const result = await importThemePackageViaVsix(bridge, store);
		expect(result).toEqual({ status: "imported", package: pkg });
		expect(registeredExtensions).toHaveLength(1);
		expect(registeredExtensions[0]?.registerFileUrl).toHaveBeenCalledTimes(1);
		expect(registeredExtensions[0]?.registerFileUrl).toHaveBeenCalledWith(
			"themes/dark.json",
			expect.stringMatching(/^blob:/),
		);
		expect(createdObjectUrls).toHaveLength(1);

		const entries = store.importedEntries(pkg.id);
		expect(entries).toHaveLength(1);
		expect(entries?.[0]?.uiTheme).toBe("vs-dark");
		expect(store.entries()).toHaveLength(1);
	});

	it("importThemePackageViaDirectory follows the same path", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "directory-test.pkg@1.0.0",
			name: "directory-test",
		});
		const bridge = bridgeWithResourceBytes({
			themeImportDirectory: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
		});
		const result = await importThemePackageViaDirectory(bridge, store);
		expect(result).toEqual({ status: "imported", package: pkg });
		expect(store.importedPackageIds()).toEqual([pkg.id]);
	});

	it("revokes every already-created blob URL and disposes the extension when a later resource fetch fails", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "failure-test.pkg@1.0.0",
			name: "failure-test",
			resources: ["themes/dark.json", "themes/base.json"],
		});
		let calls = 0;
		const bridge = fakeBridge({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			themeReadResource: async () => {
				calls += 1;
				if (calls === 1) {
					return new TextEncoder().encode(DEMO_THEME_JSON);
				}
				throw { code: "THEME_RESOURCE_NOT_FOUND", message: "gone" };
			},
		});

		await expect(importThemePackageViaVsix(bridge, store)).rejects.toBeTruthy();
		expect(createdObjectUrls).toHaveLength(1);
		expect(revokedObjectUrls).toEqual(createdObjectUrls);
		expect(registeredExtensions[0]?.dispose).toHaveBeenCalledTimes(1);
		expect(store.importedPackageIds()).toEqual([]);
	});
});

describe("consumeImportedThemePackages", () => {
	it("registers every package theme_list returns", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const first = samplePackage({ id: "a.pkg@1.0.0", name: "a" });
		const second = samplePackage({ id: "b.pkg@1.0.0", name: "b" });
		const bridge = bridgeWithResourceBytes({
			themeList: async () => ({ packages: [first, second], skipped: 0 }),
		});
		await consumeImportedThemePackages(bridge, store);
		expect(store.importedPackageIds()).toEqual(["a.pkg@1.0.0", "b.pkg@1.0.0"]);
	});

	it("skips a package that fails to register without throwing or blocking others", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const bad = samplePackage({ id: "bad.pkg@1.0.0", name: "bad" });
		const good = samplePackage({ id: "good.pkg@1.0.0", name: "good" });
		const bridge = fakeBridge({
			themeList: async () => ({ packages: [bad, good], skipped: 0 }),
			themeReadResource: async (packageId) => {
				if (packageId === "bad.pkg@1.0.0") {
					throw { code: "THEME_RESOURCE_NOT_FOUND", message: "gone" };
				}
				return new TextEncoder().encode(DEMO_THEME_JSON);
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await consumeImportedThemePackages(bridge, store);
		expect(store.importedPackageIds()).toEqual(["good.pkg@1.0.0"]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("does not throw and leaves the store empty when theme_list itself fails", async () => {
		const store = new PlainThemeRegistryStore([]);
		const bridge = fakeBridge({
			themeList: async () => {
				throw { code: "THEME_UNAVAILABLE", message: "unavailable" };
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		await expect(
			consumeImportedThemePackages(bridge, store),
		).resolves.toBeUndefined();
		expect(store.importedPackageIds()).toEqual([]);
		warn.mockRestore();
	});
});

describe("removeImportedThemePackage", () => {
	function fakeThemeService(currentThemeId: string) {
		return {
			getColorTheme: vi.fn(() => ({ id: currentThemeId })),
			setColorTheme: vi.fn(async () => null),
		};
	}

	it("tells Rust to remove, disposes the extension, revokes blob URLs, and drops the package", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "remove-test.pkg@1.0.0",
			name: "remove-test",
		});
		const themeRemove = vi.fn(async () => undefined);
		const bridge = bridgeWithResourceBytes({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			themeRemove,
		});

		await importThemePackageViaVsix(bridge, store);
		expect(store.importedPackageIds()).toEqual([pkg.id]);
		const blobUrlsBefore = [...createdObjectUrls];

		const themeService = fakeThemeService("unrelated-theme-id");
		await removeImportedThemePackage(
			bridge,
			store,
			themeService as never,
			pkg.id,
		);

		expect(themeRemove).toHaveBeenCalledWith(pkg.id);
		expect(store.importedPackageIds()).toEqual([]);
		expect(registeredExtensions[0]?.dispose).toHaveBeenCalledTimes(1);
		expect(revokedObjectUrls).toEqual(blobUrlsBefore);
		expect(themeService.setColorTheme).not.toHaveBeenCalled();
	});

	it("falls back to Dark Modern when the currently active theme belonged to the removed package", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([
			{
				id: "dark-modern-id",
				label: "Dark Modern",
				settingsId: "Dark Modern",
				uiTheme: "vs-dark",
				data: { id: "dark-modern-id" } as never,
			},
		]);
		const pkg = samplePackage({
			id: "fallback-test.pkg@1.0.0",
			name: "fallback-test",
		});
		const themeRemove = vi.fn(async () => undefined);
		const bridge = bridgeWithResourceBytes({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			themeRemove,
		});
		await importThemePackageViaVsix(bridge, store);
		const importedEntries = store.importedEntries(pkg.id);
		const activeThemeId = importedEntries?.[0]?.data.id as string;

		const themeService = fakeThemeService(activeThemeId);
		await removeImportedThemePackage(
			bridge,
			store,
			themeService as never,
			pkg.id,
		);

		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			expect.objectContaining({ id: "dark-modern-id" }),
			undefined,
		);
	});

	it("is safe to call for an id that was never imported (idempotent remove)", async () => {
		const store = new PlainThemeRegistryStore([]);
		const themeRemove = vi.fn(async () => undefined);
		const bridge = fakeBridge({ themeRemove });
		const themeService = fakeThemeService("unrelated");
		await expect(
			removeImportedThemePackage(
				bridge,
				store,
				themeService as never,
				"never-imported.pkg@1.0.0",
			),
		).resolves.toBeUndefined();
		expect(themeRemove).toHaveBeenCalledWith("never-imported.pkg@1.0.0");
	});
});

describe("themeCommandErrorMessage", () => {
	it("maps a known code to its specific sentence", () => {
		expect(
			themeCommandErrorMessage({
				code: "THEME_PACKAGE_NO_THEMES",
				message: "raw",
			}),
		).toBe("Plain: the theme package does not contribute any color themes.");
	});

	it("falls back to a generic sentence that still surfaces the code", () => {
		expect(
			themeCommandErrorMessage({ code: "SOMETHING_NEW", message: "raw" }),
		).toBe("Plain: could not complete the theme operation (SOMETHING_NEW).");
	});

	it("normalizes a non-CommandError thrown value", () => {
		expect(themeCommandErrorMessage(new Error("boom"))).toBe(
			"Plain: could not complete the theme operation (IPC_FAILED).",
		);
	});

	// `F060` S1's six icon/product icon theme validation error codes — every
	// one gets its own specific, non-leaking sentence, not the generic
	// "could not complete the theme operation (CODE)" fallback.
	it.each([
		["THEME_ICON_JSON_INVALID"],
		["THEME_ICON_RESOURCE_INVALID"],
		["THEME_ICON_TOO_MANY_ASSOCIATIONS"],
		["THEME_PRODUCT_ICON_JSON_INVALID"],
		["THEME_SVG_UNSAFE"],
		["THEME_FONT_INVALID"],
	])("maps %s to a specific sentence, not the generic fallback", (code) => {
		const message = themeCommandErrorMessage({ code, message: "raw" });
		expect(
			message.startsWith("Plain: could not complete the theme operation"),
		).toBe(false);
		expect(message.startsWith("Plain: ")).toBe(true);
	});
});

describe("mimeTypeForResource (via registerImportedPackage's blob creation)", () => {
	function capturedBlobTypes(): {
		types: string[];
		restore: () => void;
	} {
		const types: string[] = [];
		const original = URL.createObjectURL;
		URL.createObjectURL = ((blob: Blob) => {
			types.push(blob.type);
			return original.call(URL, blob);
		}) as typeof URL.createObjectURL;
		return {
			types,
			restore: () => {
				URL.createObjectURL = original;
			},
		};
	}

	it.each([
		["themes/base.tmtheme", "application/xml"],
		["fileicons/images/folder-dark.svg", "image/svg+xml"],
		["fileicons/fonts/glyphs.woff2", "font/woff2"],
		["fileicons/fonts/glyphs.woff", "font/woff"],
		["fileicons/fonts/glyphs.ttf", "font/ttf"],
		["fileicons/fonts/glyphs.otf", "font/otf"],
		["fileicons/vs-minimal-icon-theme.json", "application/json"],
		// Case-insensitive: a hostile/unusual-cased manifest path still maps
		// correctly rather than falling through to the JSON default.
		["THEMES/BASE.TMTHEME", "application/xml"],
		["FONTS/GLYPHS.WOFF2", "font/woff2"],
	])("maps %s to %s", async (resourcePath, expectedMimeType) => {
		const { types, restore } = capturedBlobTypes();
		try {
			const store = new PlainThemeRegistryStore([]);
			const pkg = samplePackage({
				id: "mime-test.pkg@1.0.0",
				name: "mime-test",
				themes: [],
				resources: [resourcePath],
			});
			const bridge = fakeBridge({
				themeReadResource: async () => new Uint8Array([1, 2, 3]),
				themeImportVsix: async () =>
					({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			});
			await importThemePackageViaVsix(bridge, store);
			expect(types).toEqual([expectedMimeType]);
		} finally {
			restore();
		}
	});
});
