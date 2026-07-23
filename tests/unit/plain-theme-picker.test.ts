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

import type { PlainThemeRegistryEntry } from "../../app/features/themes/plain-theme-registry";
import {
	applyDefaultColorTheme,
	registerPlainThemePicker,
	SELECT_COLOR_THEME_COMMAND_ID,
} from "../../app/features/themes/plain-theme-picker";

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

function fakeThemeService(currentThemeId: string) {
	return {
		getColorTheme: vi.fn(() => ({ id: currentThemeId })),
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

describe("registerPlainThemePicker", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
	});

	function register(registry: readonly PlainThemeRegistryEntry[]) {
		const registration = registerPlainThemePicker(registry);
		disposeRegistration = () => registration.dispose();
		return registration;
	}

	async function invoke(
		registry: readonly PlainThemeRegistryEntry[],
		quickPick: FakeQuickPick,
		themeService: ReturnType<typeof fakeThemeService>,
	) {
		register(registry);
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

	it("applies the selected theme and hides on accept, without restoring the original", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const themeService = fakeThemeService(dark.data.id);
		const quickPick = new FakeQuickPick();

		const pending = invoke([dark, light], quickPick, themeService);
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
		expect(quickPick.disposed).toBe(true);
	});

	it("restores the original theme when dismissed without accepting", async () => {
		const dark = fakeEntry("Dark Modern", ColorScheme.DARK);
		const light = fakeEntry("Light+", ColorScheme.LIGHT);
		const originalTheme = { id: dark.data.id };
		const themeService = {
			getColorTheme: vi.fn(() => originalTheme),
			setColorTheme: vi.fn(async () => null),
		};
		const quickPick = new FakeQuickPick();

		const pending = invoke([dark, light], quickPick, themeService);
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
	});
});
