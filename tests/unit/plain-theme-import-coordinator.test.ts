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
		themeSetFileIconThemeSelection: notImplemented,
		themeSetProductIconThemeSelection: notImplemented,
		terminalStart: notImplemented,
		terminalInputText: notImplemented,
		terminalInputKey: notImplemented,
		terminalFocus: notImplemented,
		terminalResize: notImplemented,
		terminalAck: notImplemented,
		terminalScrollback: notImplemented,
		terminalKill: notImplemented,
		terminalWatchData: notImplemented,
		terminalWatchExit: notImplemented,
		workspaceTrustState: notImplemented,
		workspaceTrustGrant: notImplemented,
		workspaceTrustRevoke: notImplemented,
		gitStatus: notImplemented,
		gitDiffFiles: notImplemented,
		gitShowBlob: notImplemented,
		gitStagePaths: notImplemented,
		gitUnstagePaths: notImplemented,
		gitStageBlob: notImplemented,
		gitCommit: notImplemented,
		gitDiscardPaths: notImplemented,
		gitNetworkPreview: notImplemented,
		gitFetch: notImplemented,
		gitPull: notImplemented,
		gitPush: notImplemented,
		gitNetworkCancel: notImplemented,
		gitBlameFile: notImplemented,
		gitBlameCommitMessages: notImplemented,
		gitFileHistory: notImplemented,
		gitLineHistoryList: notImplemented,
		gitLineHistoryDetail: notImplemented,
		gitShowCommit: notImplemented,
		gitShowCommitBlob: notImplemented,
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
		iconThemes: [],
		productIconThemes: [],
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

	it("omitting the two icon-axis constructor arguments defaults them to empty (pre-F060 call sites keep working)", () => {
		const store = new PlainThemeRegistryStore([]);
		expect(store.builtinFileIcon).toEqual([]);
		expect(store.builtinProductIcon).toEqual([]);
		expect(store.fileIconEntries()).toEqual([]);
		expect(store.productIconEntries()).toEqual([]);
	});

	it("`F060` S3: tracks the file icon and product icon axes independently of the color axis and of each other", () => {
		const builtinFileIcon = {
			id: "vs-minimal-id",
			label: "Minimal",
			settingsId: "vs-minimal",
			data: {} as never,
		};
		const builtinProductIcon = {
			id: "default-product-icon-id",
			label: "Default",
			settingsId: "",
			data: {} as never,
		};
		const store = new PlainThemeRegistryStore(
			[],
			[builtinFileIcon],
			[builtinProductIcon],
		);
		expect(store.fileIconEntries()).toEqual([builtinFileIcon]);
		expect(store.productIconEntries()).toEqual([builtinProductIcon]);

		const importedFileIcon = {
			id: "acme.icons-id",
			label: "Acme Icons",
			settingsId: "acme.icons",
			data: {} as never,
		};
		const importedProductIcon = {
			id: "acme.picons-id",
			label: "Acme Product Icons",
			settingsId: "acme.picons",
			data: {} as never,
		};
		store.setImportedFileIcon("demo.pkg@1.0.0", [importedFileIcon]);
		store.setImportedProductIcon("demo.pkg@1.0.0", [importedProductIcon]);
		// A package that contributes icon axes but no color theme still never
		// appears via `setImported` (color) alone — `importedPackageIds()`
		// itself is unaffected by this test, which only exercises the two icon
		// axis maps directly.
		expect(store.fileIconEntries()).toEqual([
			builtinFileIcon,
			importedFileIcon,
		]);
		expect(store.productIconEntries()).toEqual([
			builtinProductIcon,
			importedProductIcon,
		]);
		expect(store.importedFileIconEntries("demo.pkg@1.0.0")).toEqual([
			importedFileIcon,
		]);
		expect(store.importedProductIconEntries("demo.pkg@1.0.0")).toEqual([
			importedProductIcon,
		]);
		expect(store.importedFileIconEntries("unknown")).toBeUndefined();

		store.removeImported("demo.pkg@1.0.0");
		expect(store.fileIconEntries()).toEqual([builtinFileIcon]);
		expect(store.productIconEntries()).toEqual([builtinProductIcon]);
		expect(store.importedFileIconEntries("demo.pkg@1.0.0")).toBeUndefined();
		expect(store.importedProductIconEntries("demo.pkg@1.0.0")).toBeUndefined();
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

	it("registers a package's iconThemes/productIconThemes into the store's own two axes (the `F060` S3 gap this closes)", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "icon-register-test.pkg@1.0.0",
			name: "icon-register-test",
			themes: [],
			iconThemes: [
				{
					id: "acme.icons",
					label: "Acme Icons",
					path: "fileicons/icons.json",
				},
			],
			productIconThemes: [
				{ id: "acme.picons", label: null, path: "picons/theme.json" },
			],
			resources: ["fileicons/icons.json", "picons/theme.json"],
		});
		const bridge = fakeBridge({
			themeReadResource: async () =>
				new TextEncoder().encode(
					JSON.stringify({ iconDefinitions: {}, fonts: [] }),
				),
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
		});

		await importThemePackageViaVsix(bridge, store);

		const fileIconEntries = store.importedFileIconEntries(pkg.id);
		expect(fileIconEntries).toHaveLength(1);
		expect(fileIconEntries?.[0]?.settingsId).toBe("acme.icons");
		expect(fileIconEntries?.[0]?.label).toBe("Acme Icons");

		const productIconEntries = store.importedProductIconEntries(pkg.id);
		expect(productIconEntries).toHaveLength(1);
		expect(productIconEntries?.[0]?.settingsId).toBe("acme.picons");
		// No label was given — falls back to the resource path's basename,
		// mirroring the color theme axis's own no-label fallback.
		expect(productIconEntries?.[0]?.label).toBe("theme.json");

		expect(store.fileIconEntries()).toEqual(fileIconEntries);
		expect(store.productIconEntries()).toEqual(productIconEntries);
		// A color-theme-less package still registers cleanly with an empty
		// color axis.
		expect(store.importedEntries(pkg.id)).toEqual([]);
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
	function fakeThemeService(
		currentThemeId: string,
		currentFileIconThemeId = "unrelated-file-icon-theme-id",
		currentProductIconThemeId = "unrelated-product-icon-theme-id",
	) {
		return {
			getColorTheme: vi.fn(() => ({ id: currentThemeId })),
			setColorTheme: vi.fn(async () => null),
			getFileIconTheme: vi.fn(() => ({ id: currentFileIconThemeId })),
			setFileIconTheme: vi.fn(async () => undefined),
			getProductIconTheme: vi.fn(() => ({ id: currentProductIconThemeId })),
			setProductIconTheme: vi.fn(async () => undefined),
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
		expect(themeService.setFileIconTheme).not.toHaveBeenCalled();
		expect(themeService.setProductIconTheme).not.toHaveBeenCalled();
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
		// A package that only contributes a color theme must not disturb either
		// icon axis.
		expect(themeService.setFileIconTheme).not.toHaveBeenCalled();
		expect(themeService.setProductIconTheme).not.toHaveBeenCalled();
	});

	it("falls back the file icon theme and clears its persisted selection when it belonged to the removed package, independently of the color axis", async () => {
		trackObjectUrls();
		const vsMinimalBuiltin = {
			id: "vs-minimal-builtin-id",
			label: "Minimal",
			settingsId: "vs-minimal",
			data: { id: "vs-minimal-builtin-id" } as never,
		};
		const store = new PlainThemeRegistryStore([], [vsMinimalBuiltin]);
		const pkg = samplePackage({
			id: "icon-fallback-test.pkg@1.0.0",
			name: "icon-fallback-test",
			themes: [],
			iconThemes: [
				{ id: "acme.icons", label: "Acme Icons", path: "fileicons/icons.json" },
			],
			resources: ["fileicons/icons.json"],
		});
		const themeRemove = vi.fn(async () => undefined);
		const themeSetFileIconThemeSelection = vi.fn(async () => undefined);
		const bridge = bridgeWithResourceBytes({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			themeRemove,
			themeSetFileIconThemeSelection,
		});
		await importThemePackageViaVsix(bridge, store);
		const importedFileIconEntries = store.importedFileIconEntries(pkg.id);
		const activeFileIconThemeId = importedFileIconEntries?.[0]?.data
			.id as string;

		const themeService = fakeThemeService(
			"unrelated-color-theme-id",
			activeFileIconThemeId,
		);
		await removeImportedThemePackage(
			bridge,
			store,
			themeService as never,
			pkg.id,
		);

		expect(themeService.setFileIconTheme).toHaveBeenCalledWith(
			expect.objectContaining({ id: "vs-minimal-builtin-id" }),
			undefined,
		);
		expect(themeSetFileIconThemeSelection).toHaveBeenCalledWith(null);
		expect(themeService.setColorTheme).not.toHaveBeenCalled();
		expect(themeService.setProductIconTheme).not.toHaveBeenCalled();
	});

	it("falls back the product icon theme and clears its persisted selection when it belonged to the removed package", async () => {
		trackObjectUrls();
		const store = new PlainThemeRegistryStore([]);
		const pkg = samplePackage({
			id: "product-icon-fallback-test.pkg@1.0.0",
			name: "product-icon-fallback-test",
			themes: [],
			productIconThemes: [
				{ id: "acme.picons", label: null, path: "picons/theme.json" },
			],
			resources: ["picons/theme.json"],
		});
		const themeRemove = vi.fn(async () => undefined);
		const themeSetProductIconThemeSelection = vi.fn(async () => undefined);
		const bridge = bridgeWithResourceBytes({
			themeImportVsix: async () =>
				({ status: "imported", package: pkg }) satisfies ThemeImportResult,
			themeRemove,
			themeSetProductIconThemeSelection,
		});
		await importThemePackageViaVsix(bridge, store);
		const importedProductIconEntries = store.importedProductIconEntries(pkg.id);
		const activeProductIconThemeId = importedProductIconEntries?.[0]?.data
			.id as string;

		const themeService = fakeThemeService(
			"unrelated-color-theme-id",
			"unrelated-file-icon-theme-id",
			activeProductIconThemeId,
		);
		await removeImportedThemePackage(
			bridge,
			store,
			themeService as never,
			pkg.id,
		);

		// `applyDefaultProductIconTheme` passes `undefined` (which upstream's
		// own `internalSetProductIconTheme` resolves to the
		// `ProductIconThemeData.defaultTheme` singleton) — see that function's
		// own doc comment in `plain-theme-picker.ts`.
		expect(themeService.setProductIconTheme).toHaveBeenCalledWith(
			undefined,
			undefined,
		);
		expect(themeSetProductIconThemeSelection).toHaveBeenCalledWith(null);
		expect(themeService.setColorTheme).not.toHaveBeenCalled();
		expect(themeService.setFileIconTheme).not.toHaveBeenCalled();
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
