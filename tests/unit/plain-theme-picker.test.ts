import { afterEach, describe, expect, it, vi } from "vitest";

// app/features/themes/plain-theme-picker.ts imports app/features/themes/
// plain-theme-registry.ts purely for the `DARK_MODERN_SETTINGS_ID` constant
// and the `PlainThemeRegistryEntry` type (erased). That file's own
// `getBuiltinExtensions` import (`@codingame/monaco-vscode-api/extensions`)
// pulls in Monaco's standalone-editor `StandaloneServices` bootstrap, whose
// module graph statically imports a `.css` file — something only a
// browser-targeting bundler (real Vite, not vitest's plain Node module
// loader) can handle. Nothing in this file calls
// `createPlainThemeRegistry`/`getBuiltinExtensions` itself (see
// tests/unit/plain-theme-registry.test.ts for that), so a trivial,
// side-effect-free stub is enough to keep this suite decoupled from that
// unrelated, environment-only limitation.
vi.mock("@codingame/monaco-vscode-api/extensions", () => ({
	getBuiltinExtensions: () => [],
}));

import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { ColorScheme } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme";

import type {
	PlainFileIconThemeRegistryEntry,
	PlainProductIconThemeRegistryEntry,
	PlainThemeRegistryEntry,
} from "../../app/features/themes/plain-theme-registry";
import {
	applyDefaultColorTheme,
	applyDefaultFileIconTheme,
	applyDefaultProductIconTheme,
	applyPersistedThemeSelection,
	persistThemeSelectionBestEffort,
	registerPlainFileIconThemePicker,
	registerPlainProductIconThemePicker,
	registerPlainThemePicker,
	SELECT_COLOR_THEME_COMMAND_ID,
	SELECT_FILE_ICON_THEME_COMMAND_ID,
	SELECT_PRODUCT_ICON_THEME_COMMAND_ID,
} from "../../app/features/themes/plain-theme-picker";
import type { PlainBridge } from "../../app/platform/tauri";
// Real, unmocked classes — both are pure data-class modules with no
// side-effecting import (see plain-theme-registry.ts's own doc comment on
// the identical deep imports), so — like `ColorThemeData` in plain-theme-
// registry.test.ts — there is nothing to stub here.
import { FileIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/fileIconThemeData";
import { ProductIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/productIconThemeData";

function notImplemented(): never {
	throw new Error("not implemented in fake bridge for this test");
}

function fakeBridge(overrides: Partial<PlainBridge> = {}): PlainBridge {
	return {
		themeGetSelection: notImplemented,
		themeSetSelection: notImplemented,
		...overrides,
	} as unknown as PlainBridge;
}

interface FakeColorThemeData {
	readonly id: string;
	readonly type: ColorScheme;
}

function fakeEntry(
	settingsId: string,
	type: ColorScheme,
	label = settingsId,
): PlainThemeRegistryEntry {
	const data: FakeColorThemeData = { id: `id-${settingsId}`, type };
	return {
		id: data.id,
		label,
		settingsId,
		uiTheme: "vs-dark",
		data: data as unknown as PlainThemeRegistryEntry["data"],
	};
}

function fakeFileIconEntry(
	settingsId: string,
	label = settingsId,
): PlainFileIconThemeRegistryEntry {
	const data = { id: `id-${settingsId}` };
	return {
		id: data.id,
		label,
		settingsId,
		data: data as unknown as PlainFileIconThemeRegistryEntry["data"],
	};
}

function fakeProductIconEntry(
	settingsId: string,
	label = settingsId,
): PlainProductIconThemeRegistryEntry {
	const data = { id: `id-${settingsId}` };
	return {
		id: data.id,
		label,
		settingsId,
		data: data as unknown as PlainProductIconThemeRegistryEntry["data"],
	};
}

function fakeFileIconThemeService(currentThemeId: string) {
	return {
		getFileIconTheme: vi.fn(() => ({ id: currentThemeId })),
		setFileIconTheme: vi.fn(async () => undefined),
	};
}

function fakeProductIconThemeService(currentThemeId: string) {
	return {
		getProductIconTheme: vi.fn(() => ({ id: currentThemeId })),
		setProductIconTheme: vi.fn(async () => undefined),
	};
}

function fakeThemeService(
	currentThemeId: string,
	currentSettingsId: string = currentThemeId,
) {
	return {
		getColorTheme: vi.fn(() => ({
			id: currentThemeId,
			settingsId: currentSettingsId,
		})),
		setColorTheme: vi.fn(async () => null),
	};
}

class FakeQuickPick {
	items: unknown[] = [];
	placeholder: string | undefined;
	matchOnDescription = true;
	canSelectMany = true;
	activeItems: unknown[] = [];
	selectedItems: unknown[] = [];
	disposed = false;
	shown = false;
	#activeListeners: Array<(items: unknown[]) => void> = [];
	#acceptListeners: Array<() => void> = [];
	#hideListeners: Array<() => void> = [];

	onDidChangeActive(listener: (items: unknown[]) => void) {
		this.#activeListeners.push(listener);
		return { dispose: () => undefined };
	}

	onDidAccept(listener: () => void) {
		this.#acceptListeners.push(listener);
		return { dispose: () => undefined };
	}

	onDidHide(listener: () => void) {
		this.#hideListeners.push(listener);
		return { dispose: () => undefined };
	}

	show(): void {
		this.shown = true;
	}

	hide(): void {
		for (const listener of this.#hideListeners) {
			listener();
		}
	}

	dispose(): void {
		this.disposed = true;
	}

	fireActiveChange(items: unknown[]): void {
		for (const listener of this.#activeListeners) {
			listener(items);
		}
	}

	fireAccept(): void {
		for (const listener of this.#acceptListeners) {
			listener();
		}
	}
}

function fakeQuickInputService(quickPick: FakeQuickPick) {
	return {
		createQuickPick: vi.fn(() => quickPick),
	};
}

function fakeAccessor(quickInputService: unknown, themeService: unknown) {
	return {
		get(token: unknown) {
			// The real ServicesAccessor resolves by identity of the imported
			// token value; the two tokens Plain's picker asks for are distinct
			// object identities in this module graph, so a simple reference
			// table (rather than name-based dispatch) is exact.
			if (token === accessorTokens.quickInput) {
				return quickInputService;
			}
			if (token === accessorTokens.theme) {
				return themeService;
			}
			throw new Error("unexpected service token requested");
		},
	};
}

// Imported once, lazily, purely so `fakeAccessor` above can compare against
// the exact same token identities `registerPlainThemePicker`'s handler
// resolves through `accessor.get(...)`.
const accessorTokens = await (async () => {
	const [{ IQuickInputService }, { IWorkbenchThemeService }] =
		await Promise.all([
			import("@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service"),
			import("@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service"),
		]);
	return { quickInput: IQuickInputService, theme: IWorkbenchThemeService };
})();

describe("applyDefaultColorTheme", () => {
	it("applies the Dark Modern entry as a normal (non-preview) theme change", async () => {
		const darkModern = fakeEntry("Dark Modern", ColorScheme.DARK);
		const other = fakeEntry("Light+", ColorScheme.LIGHT);
		const themeService = fakeThemeService("unrelated");

		await applyDefaultColorTheme(
			themeService as never,
			Object.freeze([other, darkModern]),
		);

		expect(themeService.setColorTheme).toHaveBeenCalledTimes(1);
		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			darkModern.data,
			undefined,
		);
	});

	it("warns and does not throw when Dark Modern is absent from the registry", async () => {
		const themeService = fakeThemeService("unrelated");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyDefaultColorTheme(
				themeService as never,
				Object.freeze([fakeEntry("Light+", ColorScheme.LIGHT)]),
			),
		).resolves.toBeUndefined();

		expect(themeService.setColorTheme).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("warns and does not throw when applying the default theme fails", async () => {
		const darkModern = fakeEntry("Dark Modern", ColorScheme.DARK);
		const themeService = {
			getColorTheme: vi.fn(),
			setColorTheme: vi.fn(async () => {
				throw new Error("read failed");
			}),
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyDefaultColorTheme(
				themeService as never,
				Object.freeze([darkModern]),
			),
		).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("persistThemeSelectionBestEffort", () => {
	it("calls theme_set_selection with the given id", async () => {
		const themeSetSelection = vi.fn(async () => undefined);
		await persistThemeSelectionBestEffort(
			fakeBridge({ themeSetSelection }),
			"Dark Modern",
		);
		expect(themeSetSelection).toHaveBeenCalledWith("Dark Modern");
	});

	it("calls theme_set_selection with null to clear", async () => {
		const themeSetSelection = vi.fn(async () => undefined);
		await persistThemeSelectionBestEffort(
			fakeBridge({ themeSetSelection }),
			null,
		);
		expect(themeSetSelection).toHaveBeenCalledWith(null);
	});

	it("warns and does not throw when the bridge call fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const bridge = fakeBridge({
			themeSetSelection: async () => {
				throw new Error("boom");
			},
		});
		await expect(
			persistThemeSelectionBestEffort(bridge, "Dark Modern"),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("applyPersistedThemeSelection", () => {
	it("applies the registry entry matching the persisted settingsId", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const themeService = fakeThemeService(dark.data.id);
		const bridge = fakeBridge({
			themeGetSelection: async () => ({ themeId: "Light+" }),
		});

		await applyPersistedThemeSelection(
			bridge,
			themeService as never,
			Object.freeze([dark, light]),
		);

		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			light.data,
			undefined,
		);
	});

	it("does nothing when nothing is persisted", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const themeService = fakeThemeService(dark.data.id);
		const bridge = fakeBridge({
			themeGetSelection: async () => ({ themeId: null }),
		});

		await applyPersistedThemeSelection(
			bridge,
			themeService as never,
			Object.freeze([dark]),
		);

		expect(themeService.setColorTheme).not.toHaveBeenCalled();
	});

	it("warns, clears the stale selection, and leaves the default applied when the id matches nothing", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const themeService = fakeThemeService(dark.data.id);
		const themeSetSelection = vi.fn(async () => undefined);
		const bridge = fakeBridge({
			themeGetSelection: async () => ({ themeId: "Ghost Theme" }),
			themeSetSelection,
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await applyPersistedThemeSelection(
			bridge,
			themeService as never,
			Object.freeze([dark]),
		);

		expect(themeService.setColorTheme).not.toHaveBeenCalled();
		expect(themeSetSelection).toHaveBeenCalledWith(null);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("warns and does not throw when reading the persisted selection fails", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const themeService = fakeThemeService(dark.data.id);
		const bridge = fakeBridge({
			themeGetSelection: async () => {
				throw new Error("boom");
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyPersistedThemeSelection(
				bridge,
				themeService as never,
				Object.freeze([dark]),
			),
		).resolves.toBeUndefined();
		expect(themeService.setColorTheme).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("warns and does not throw when applying the matched theme fails", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const themeService = {
			getColorTheme: vi.fn(),
			setColorTheme: vi.fn(async () => {
				throw new Error("boom");
			}),
		};
		const bridge = fakeBridge({
			themeGetSelection: async () => ({ themeId: "Dark Modern" }),
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyPersistedThemeSelection(
				bridge,
				themeService as never,
				Object.freeze([dark]),
			),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("registerPlainThemePicker", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
	});

	function register(
		registry: readonly PlainThemeRegistryEntry[],
		bridge: PlainBridge = fakeBridge({
			themeSetSelection: async () => undefined,
		}),
	) {
		const registration = registerPlainThemePicker(bridge, registry);
		disposeRegistration = () => registration.dispose();
		return registration;
	}

	async function invoke(
		registry: readonly PlainThemeRegistryEntry[],
		quickPick: FakeQuickPick,
		themeService: ReturnType<typeof fakeThemeService>,
		bridge?: PlainBridge,
	) {
		register(registry, bridge);
		const command = CommandsRegistry.getCommand(SELECT_COLOR_THEME_COMMAND_ID);
		if (command === undefined) {
			throw new Error("command was not registered");
		}
		const quickInputService = fakeQuickInputService(quickPick);
		return command.handler(
			fakeAccessor(quickInputService, themeService) as Parameters<
				typeof command.handler
			>[0],
		);
	}

	it("takes over the exact vendor command id", () => {
		register([]);
		const command = CommandsRegistry.getCommand(SELECT_COLOR_THEME_COMMAND_ID);
		expect(command).toBeDefined();
		expect(SELECT_COLOR_THEME_COMMAND_ID).toBe("workbench.action.selectTheme");
	});

	it("does nothing when the registry is empty", async () => {
		const quickPick = new FakeQuickPick();
		const themeService = fakeThemeService("current");
		await invoke([], quickPick, themeService);
		expect(quickPick.shown).toBe(false);
	});

	it("groups items by uiTheme kind under separators and previews on active change", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const highContrast = fakeEntry(
			"Default High Contrast",
			ColorScheme.HIGH_CONTRAST_DARK,
		);
		const themeService = fakeThemeService(dark.data.id);
		const quickPick = new FakeQuickPick();

		const pending = invoke(
			[light, dark, highContrast],
			quickPick,
			themeService,
		);
		// Let the picker's synchronous setup (items/activeItems assignment,
		// listener registration, show()) run before the Promise it returns
		// settles on hide.
		await Promise.resolve();

		expect(quickPick.shown).toBe(true);
		const separatorLabels = quickPick.items
			.filter(
				(item): item is { type: string; label?: string } =>
					typeof item === "object" &&
					item !== null &&
					(item as { type?: string }).type === "separator",
			)
			.map((item) => item.label);
		expect(separatorLabels).toEqual([
			"Dark themes",
			"Light themes",
			"High contrast themes",
		]);
		// The active theme (dark.data.id) must be pre-selected.
		expect(quickPick.activeItems).toEqual([
			expect.objectContaining({ entry: dark }),
		]);

		quickPick.fireActiveChange([{ entry: light }]);
		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			light.data,
			"preview",
		);

		quickPick.hide();
		await pending;
	});

	it("applies the selected theme, persists its settingsId, and hides on accept, without restoring the original", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const themeService = fakeThemeService(dark.data.id);
		const quickPick = new FakeQuickPick();
		const themeSetSelection = vi.fn(async () => undefined);
		const bridge = fakeBridge({ themeSetSelection });

		const pending = invoke([dark, light], quickPick, themeService, bridge);
		await Promise.resolve();

		quickPick.selectedItems = [{ entry: light }];
		quickPick.fireAccept();
		await pending;

		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			light.data,
			undefined,
		);
		expect(themeService.setColorTheme).not.toHaveBeenCalledWith(
			{ id: dark.data.id },
			undefined,
		);
		expect(themeSetSelection).toHaveBeenCalledWith("Light+");
		expect(quickPick.disposed).toBe(true);
	});

	it("persists the original theme's settingsId when Enter re-confirms without navigating", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const themeService = fakeThemeService(dark.data.id, dark.settingsId);
		const quickPick = new FakeQuickPick();
		const themeSetSelection = vi.fn(async () => undefined);
		const bridge = fakeBridge({ themeSetSelection });

		const pending = invoke([dark, light], quickPick, themeService, bridge);
		await Promise.resolve();

		// No `selectedItems` set — accepting without navigating away from the
		// pre-selected active item.
		quickPick.fireAccept();
		await pending;

		expect(themeSetSelection).toHaveBeenCalledWith("Dark Modern");
	});

	it("restores the original theme when dismissed without accepting, and never persists a selection", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const originalTheme = { id: dark.data.id, settingsId: dark.settingsId };
		const themeService = {
			getColorTheme: vi.fn(() => originalTheme),
			setColorTheme: vi.fn(async () => null),
		};
		const quickPick = new FakeQuickPick();
		const themeSetSelection = vi.fn(async () => undefined);
		const bridge = fakeBridge({ themeSetSelection });

		const pending = invoke([dark, light], quickPick, themeService, bridge);
		await Promise.resolve();

		quickPick.fireActiveChange([{ entry: light }]);
		expect(themeService.setColorTheme).toHaveBeenCalledWith(
			light.data,
			"preview",
		);

		// Dismiss (e.g. Escape) without ever firing onDidAccept.
		quickPick.hide();
		await pending;

		expect(themeService.setColorTheme).toHaveBeenLastCalledWith(
			originalTheme,
			undefined,
		);
		expect(quickPick.disposed).toBe(true);
		expect(themeSetSelection).not.toHaveBeenCalled();
	});
});

describe("applyDefaultFileIconTheme", () => {
	it("applies the vs-minimal entry as a normal (non-preview) theme change", async () => {
		const vsMinimal = fakeFileIconEntry("vs-minimal");
		const other = fakeFileIconEntry("other-theme");
		const themeService = { setFileIconTheme: vi.fn(async () => undefined) };

		await applyDefaultFileIconTheme(
			themeService as never,
			Object.freeze([other, vsMinimal]),
		);

		expect(themeService.setFileIconTheme).toHaveBeenCalledTimes(1);
		expect(themeService.setFileIconTheme).toHaveBeenCalledWith(
			vsMinimal.data,
			undefined,
		);
	});

	it("warns and does not throw when vs-minimal is absent from the registry", async () => {
		const themeService = { setFileIconTheme: vi.fn(async () => undefined) };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyDefaultFileIconTheme(
				themeService as never,
				Object.freeze([fakeFileIconEntry("other-theme")]),
			),
		).resolves.toBeUndefined();

		expect(themeService.setFileIconTheme).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it("warns and does not throw when applying the default theme fails", async () => {
		const vsMinimal = fakeFileIconEntry("vs-minimal");
		const themeService = {
			setFileIconTheme: vi.fn(async () => {
				throw new Error("read failed");
			}),
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyDefaultFileIconTheme(
				themeService as never,
				Object.freeze([vsMinimal]),
			),
		).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("applyDefaultProductIconTheme", () => {
	it("resolves the always-available Default singleton via undefined, not a registry lookup", async () => {
		const themeService = { setProductIconTheme: vi.fn(async () => undefined) };

		await applyDefaultProductIconTheme(themeService as never);

		expect(themeService.setProductIconTheme).toHaveBeenCalledTimes(1);
		expect(themeService.setProductIconTheme).toHaveBeenCalledWith(
			undefined,
			undefined,
		);
	});

	it("warns and does not throw when applying it fails", async () => {
		const themeService = {
			setProductIconTheme: vi.fn(async () => {
				throw new Error("boom");
			}),
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await expect(
			applyDefaultProductIconTheme(themeService as never),
		).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe("registerPlainFileIconThemePicker", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
	});

	function register(registry: readonly PlainFileIconThemeRegistryEntry[]) {
		const registration = registerPlainFileIconThemePicker(registry);
		disposeRegistration = () => registration.dispose();
		return registration;
	}

	async function invoke(
		registry: readonly PlainFileIconThemeRegistryEntry[],
		quickPick: FakeQuickPick,
		themeService: ReturnType<typeof fakeFileIconThemeService>,
	) {
		register(registry);
		const command = CommandsRegistry.getCommand(
			SELECT_FILE_ICON_THEME_COMMAND_ID,
		);
		if (command === undefined) {
			throw new Error("command was not registered");
		}
		const quickInputService = fakeQuickInputService(quickPick);
		return command.handler(
			fakeAccessor(quickInputService, themeService) as Parameters<
				typeof command.handler
			>[0],
		);
	}

	it("takes over the exact vendor command id", () => {
		register([]);
		const command = CommandsRegistry.getCommand(
			SELECT_FILE_ICON_THEME_COMMAND_ID,
		);
		expect(command).toBeDefined();
		expect(SELECT_FILE_ICON_THEME_COMMAND_ID).toBe(
			"workbench.action.selectIconTheme",
		);
	});

	it("always shows, offering None first, even with an empty registry", async () => {
		const quickPick = new FakeQuickPick();
		const themeService = fakeFileIconThemeService("");

		const pending = invoke([], quickPick, themeService);
		await Promise.resolve();

		expect(quickPick.shown).toBe(true);
		expect(quickPick.items).toEqual([
			{ type: "separator", label: "File icon themes" },
			expect.objectContaining({ id: "", label: "None" }),
		]);
		// None (id "") is the real `FileIconThemeData.noIconTheme` singleton —
		// not a stand-in placeholder.
		const [, noneItem] = quickPick.items as Array<{ data: unknown }>;
		expect(noneItem?.data).toBe(FileIconThemeData.noIconTheme);

		quickPick.hide();
		await pending;
	});

	it("pre-selects the currently active registry entry and previews on active change", async () => {
		const vsMinimal = fakeFileIconEntry("vs-minimal");
		const other = fakeFileIconEntry("other-theme");
		const themeService = fakeFileIconThemeService(vsMinimal.data.id);
		const quickPick = new FakeQuickPick();

		const pending = invoke([other, vsMinimal], quickPick, themeService);
		await Promise.resolve();

		expect(quickPick.activeItems).toEqual([
			expect.objectContaining({ data: vsMinimal.data }),
		]);

		quickPick.fireActiveChange([{ data: other.data }]);
		expect(themeService.setFileIconTheme).toHaveBeenCalledWith(
			other.data,
			"preview",
		);

		quickPick.hide();
		await pending;
	});

	it("applies None on accept when the user navigates to it, disabling file icons", async () => {
		const vsMinimal = fakeFileIconEntry("vs-minimal");
		const themeService = fakeFileIconThemeService(vsMinimal.data.id);
		const quickPick = new FakeQuickPick();

		const pending = invoke([vsMinimal], quickPick, themeService);
		await Promise.resolve();

		quickPick.selectedItems = [
			{ id: "", label: "None", data: FileIconThemeData.noIconTheme },
		];
		quickPick.fireAccept();
		await pending;

		expect(themeService.setFileIconTheme).toHaveBeenCalledWith(
			FileIconThemeData.noIconTheme,
			undefined,
		);
		expect(quickPick.disposed).toBe(true);
	});

	it("restores the original theme when dismissed without accepting", async () => {
		const vsMinimal = fakeFileIconEntry("vs-minimal");
		const other = fakeFileIconEntry("other-theme");
		const originalTheme = { id: vsMinimal.data.id };
		const themeService = {
			getFileIconTheme: vi.fn(() => originalTheme),
			setFileIconTheme: vi.fn(async () => undefined),
		};
		const quickPick = new FakeQuickPick();

		const pending = invoke([vsMinimal, other], quickPick, themeService);
		await Promise.resolve();

		quickPick.fireActiveChange([{ data: other.data }]);
		expect(themeService.setFileIconTheme).toHaveBeenCalledWith(
			other.data,
			"preview",
		);

		quickPick.hide();
		await pending;

		expect(themeService.setFileIconTheme).toHaveBeenLastCalledWith(
			originalTheme,
			undefined,
		);
		expect(quickPick.disposed).toBe(true);
	});
});

describe("registerPlainProductIconThemePicker", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
	});

	function register(registry: readonly PlainProductIconThemeRegistryEntry[]) {
		const registration = registerPlainProductIconThemePicker(registry);
		disposeRegistration = () => registration.dispose();
		return registration;
	}

	async function invoke(
		registry: readonly PlainProductIconThemeRegistryEntry[],
		quickPick: FakeQuickPick,
		themeService: ReturnType<typeof fakeProductIconThemeService>,
	) {
		register(registry);
		const command = CommandsRegistry.getCommand(
			SELECT_PRODUCT_ICON_THEME_COMMAND_ID,
		);
		if (command === undefined) {
			throw new Error("command was not registered");
		}
		const quickInputService = fakeQuickInputService(quickPick);
		return command.handler(
			fakeAccessor(quickInputService, themeService) as Parameters<
				typeof command.handler
			>[0],
		);
	}

	it("takes over the exact vendor command id", () => {
		register([]);
		const command = CommandsRegistry.getCommand(
			SELECT_PRODUCT_ICON_THEME_COMMAND_ID,
		);
		expect(command).toBeDefined();
		expect(SELECT_PRODUCT_ICON_THEME_COMMAND_ID).toBe(
			"workbench.action.selectProductIconTheme",
		);
	});

	it("always shows, offering Default first, even with an empty registry", async () => {
		const quickPick = new FakeQuickPick();
		const themeService = fakeProductIconThemeService(
			ProductIconThemeData.defaultTheme.id,
		);

		const pending = invoke([], quickPick, themeService);
		await Promise.resolve();

		expect(quickPick.shown).toBe(true);
		expect(quickPick.items).toEqual([
			{ type: "separator", label: "Product icon themes" },
			expect.objectContaining({ label: "Default" }),
		]);
		const [, defaultItem] = quickPick.items as Array<{ data: unknown }>;
		expect(defaultItem?.data).toBe(ProductIconThemeData.defaultTheme);
		// Pre-selected: the fake theme service's current id matches Default's.
		expect(quickPick.activeItems).toEqual([
			expect.objectContaining({ label: "Default" }),
		]);

		quickPick.hide();
		await pending;
	});

	it("applies a registered entry on accept and does not disturb Default's own id", async () => {
		const acme = fakeProductIconEntry("Acme Product Icons");
		const themeService = fakeProductIconThemeService(
			ProductIconThemeData.defaultTheme.id,
		);
		const quickPick = new FakeQuickPick();

		const pending = invoke([acme], quickPick, themeService);
		await Promise.resolve();

		quickPick.selectedItems = [{ data: acme.data }];
		quickPick.fireAccept();
		await pending;

		expect(themeService.setProductIconTheme).toHaveBeenCalledWith(
			acme.data,
			undefined,
		);
		expect(quickPick.disposed).toBe(true);
	});

	it("restores the original theme when dismissed without accepting", async () => {
		const acme = fakeProductIconEntry("Acme Product Icons");
		const originalTheme = { id: ProductIconThemeData.defaultTheme.id };
		const themeService = {
			getProductIconTheme: vi.fn(() => originalTheme),
			setProductIconTheme: vi.fn(async () => undefined),
		};
		const quickPick = new FakeQuickPick();

		const pending = invoke([acme], quickPick, themeService);
		await Promise.resolve();

		quickPick.fireActiveChange([{ data: acme.data }]);
		expect(themeService.setProductIconTheme).toHaveBeenCalledWith(
			acme.data,
			"preview",
		);

		quickPick.hide();
		await pending;

		expect(themeService.setProductIconTheme).toHaveBeenLastCalledWith(
			originalTheme,
			undefined,
		);
		expect(quickPick.disposed).toBe(true);
	});
});
