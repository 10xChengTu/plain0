import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type {
	IQuickPickItem,
	IQuickPickSeparator,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import {
	ColorScheme,
	isHighContrast,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme";
import { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";
// Same deep-import rationale as `plain-theme-registry.ts`'s own doc comment
// on these two imports: pure data classes, no module-level side effects,
// live only inside the override package's `browser/` folder.
import { FileIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/fileIconThemeData";
import { ProductIconThemeData } from "@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/productIconThemeData";

import type { PlainBridge } from "../../platform/tauri";
import {
	DARK_MODERN_SETTINGS_ID,
	VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID,
	type PlainFileIconThemeRegistryEntry,
	type PlainProductIconThemeRegistryEntry,
	type PlainThemeRegistryEntry,
} from "./plain-theme-registry";

/**
 * The exact vendor command id (`@codingame/monaco-vscode-theme-service-
 * override`'s `themes.contribution.js`, imported transitively by `app/
 * services.ts`'s `getThemeServiceOverride()`) Plain takes over below. That
 * file registers it via `registerAction2` — forbidden for Plain's own code
 * (see `FORBIDDEN_COMMAND_WRITER_NAMES` in `scripts/plain/workspace-
 * topology-contracts.mjs`) — but `registerAction2` itself, under the hood,
 * only ever calls `CommandsRegistry.registerCommand({id, ...})`. Re-
 * registering the same id later (this module is imported after `app/
 * services.ts` in `app/main.ts`) prepends Plain's handler to that id's
 * registration list; `CommandsRegistry.getCommand`/`ICommandService.
 * executeCommand` always resolve the most recently registered handler for a
 * given id (see `CommandsRegistry`'s `LinkedList#unshift` + `Iterable.
 * first` in `@codingame/monaco-vscode-api`), so Plain's handler runs and the
 * vendor's own (always-empty, see `plain-theme-registry.ts`'s module doc
 * comment) picker is never reached again. This is the exact technique
 * `app/features/workspace/commands.ts` already uses for `workbench.action.
 * files.openFolder`.
 */
export const SELECT_COLOR_THEME_COMMAND_ID = "workbench.action.selectTheme";

/** Same takeover mechanism as `SELECT_COLOR_THEME_COMMAND_ID` — the vendor
 * id for `workbench.action.selectIconTheme`, confirmed via that same
 * `themes.contribution.js`'s own source (`SelectFileIconThemeCommandId`). */
export const SELECT_FILE_ICON_THEME_COMMAND_ID =
	"workbench.action.selectIconTheme";

/** Same takeover mechanism, for `workbench.action.selectProductIconTheme`
 * (`SelectProductIconThemeCommandId` in the same vendor file). */
export const SELECT_PRODUCT_ICON_THEME_COMMAND_ID =
	"workbench.action.selectProductIconTheme";

interface PlainThemeQuickPickItem extends IQuickPickItem {
	readonly entry: PlainThemeRegistryEntry;
}

function isThemeItem(
	item: PlainThemeQuickPickItem | IQuickPickSeparator,
): item is PlainThemeQuickPickItem {
	return item.type !== "separator";
}

const THEME_GROUP_LABELS = Object.freeze({
	dark: "Dark themes",
	light: "Light themes",
	highContrast: "High contrast themes",
} as const);

type ThemeGroupKey = keyof typeof THEME_GROUP_LABELS;

function themeGroupKey(entry: PlainThemeRegistryEntry): ThemeGroupKey {
	if (isHighContrast(entry.data.type)) {
		return "highContrast";
	}
	return entry.data.type === ColorScheme.LIGHT ? "light" : "dark";
}

/** Groups the registry by `uiTheme`/`ColorScheme` kind (dark, light, high
 * contrast — the same three buckets upstream's own `SelectColorThemeAction`
 * groups its picks into, see `toEntries` in `@codingame/monaco-vscode-
 * theme-service-override`'s `themes.contribution.js`), each under its own
 * separator, functionality-first flat ordering within a group (manifest
 * order). */
function buildThemeQuickPickItems(
	registry: readonly PlainThemeRegistryEntry[],
): ReadonlyArray<PlainThemeQuickPickItem | IQuickPickSeparator> {
	const groups: Record<ThemeGroupKey, PlainThemeRegistryEntry[]> = {
		dark: [],
		light: [],
		highContrast: [],
	};
	for (const entry of registry) {
		groups[themeGroupKey(entry)].push(entry);
	}
	const items: Array<PlainThemeQuickPickItem | IQuickPickSeparator> = [];
	for (const key of ["dark", "light", "highContrast"] as const) {
		const groupEntries = groups[key];
		if (groupEntries.length === 0) {
			continue;
		}
		items.push({ type: "separator", label: THEME_GROUP_LABELS[key] });
		for (const entry of groupEntries) {
			items.push({ id: entry.settingsId, label: entry.label, entry });
		}
	}
	return Object.freeze(items);
}

/**
 * Applies Plain's default theme (Dark Modern) at bootstrap, replacing the
 * unthemed `ColorThemeData.createUnloadedThemeForThemeType` placeholder the
 * Workbench otherwise starts on (see `plain-theme-registry.ts`'s module doc
 * comment for the root cause). A missing entry or a failed load (e.g. an
 * unreadable theme resource) is reported to the console and otherwise
 * swallowed — Plain must never fail to boot because a color theme could not
 * be applied.
 */
export async function applyDefaultColorTheme(
	themeService: IWorkbenchThemeService,
	registry: readonly PlainThemeRegistryEntry[],
): Promise<void> {
	const defaultTheme = registry.find(
		(entry) => entry.settingsId === DARK_MODERN_SETTINGS_ID,
	);
	if (defaultTheme === undefined) {
		console.warn(
			`Plain: default color theme "${DARK_MODERN_SETTINGS_ID}" was not found among ${registry.length} registered theme(s)`,
		);
		return;
	}
	try {
		await themeService.setColorTheme(defaultTheme.data, undefined);
	} catch (error) {
		console.warn("Plain: failed to apply the default color theme", error);
	}
}

/**
 * `F060` S2's file icon theme analogue of `applyDefaultColorTheme`: applies
 * `vs-minimal` (`VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID`) at bootstrap,
 * replacing the inert `FileIconThemeData.createUnloadedTheme("")` the
 * Workbench otherwise starts on (confirmed by direct browser probe: before
 * this function runs, `.monaco-workbench` never carries the vendor's own
 * `file-icons-enabled` class and the `contributedFileIconTheme` `<style>`
 * element the vendor's own `_applyRules` always creates in `<head>` stays
 * present-but-empty). Same never-fail-boot contract as its color theme
 * sibling — persisting a user's own selection is `F060` S3's scope, not
 * this bootstrap default.
 */
export async function applyDefaultFileIconTheme(
	themeService: IWorkbenchThemeService,
	registry: readonly PlainFileIconThemeRegistryEntry[],
): Promise<void> {
	const defaultTheme = registry.find(
		(entry) => entry.settingsId === VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID,
	);
	if (defaultTheme === undefined) {
		console.warn(
			`Plain: default file icon theme "${VS_MINIMAL_FILE_ICON_THEME_SETTINGS_ID}" was not found among ${registry.length} registered theme(s)`,
		);
		return;
	}
	try {
		await themeService.setFileIconTheme(defaultTheme.data, undefined);
	} catch (error) {
		console.warn("Plain: failed to apply the default file icon theme", error);
	}
}

/**
 * `F060` S2's product icon theme analogue. There is no built-in
 * `productIconThemes` contribution to look up (`theme-defaults` declares
 * none — see `createPlainProductIconThemeRegistry`'s own doc comment), so
 * unlike its two siblings this takes no registry: `undefined` resolves to
 * the always-available `ProductIconThemeData.defaultTheme` singleton inside
 * `internalSetProductIconTheme` (`themeId = ""` matches the registry's own
 * `builtInTheme.id`), the exact same fallback upstream's own picker's
 * "Default" entry uses.
 */
export async function applyDefaultProductIconTheme(
	themeService: IWorkbenchThemeService,
): Promise<void> {
	try {
		await themeService.setProductIconTheme(undefined, undefined);
	} catch (error) {
		console.warn(
			"Plain: failed to apply the default product icon theme",
			error,
		);
	}
}

/**
 * `F050` S4: best-effort persistence of the current theme selection.
 * `themeId` is a `ColorThemeData#settingsId` to persist, or `null` to clear
 * it back to "nothing stored" (Plain's default applies at the next boot).
 * Never throws — a failed `theme_set_selection` call is reported to the
 * console and otherwise swallowed, matching `applyDefaultColorTheme`'s own
 * "must never fail to boot/operate over a theme-preference hiccup" rule.
 * Called both by [`runSelectColorThemeQuickPick`]'s own Enter handler below
 * and by `removeImportedThemePackage` (`./plain-theme-import-coordinator.ts`)
 * when the removed package owned the currently active theme.
 */
export async function persistThemeSelectionBestEffort(
	bridge: PlainBridge,
	themeId: string | null,
): Promise<void> {
	try {
		await bridge.themeSetSelection(themeId);
	} catch (error) {
		console.warn("Plain: failed to persist the color theme selection", error);
	}
}

/**
 * `F050` S4: resolves and applies whatever theme selection Rust has
 * persisted from a previous session, once `registry` reflects every
 * built-in *and* already-imported entry (so a selection pointing at an
 * imported theme can resolve too — see `app/main.ts`'s bootstrap ordering).
 *
 * Three outcomes, matching this slice's own acceptance:
 * - `themeId` is `null` (nothing was ever persisted, or it was already
 *   cleared): nothing to do — `applyDefaultColorTheme` already applied
 *   Plain's default earlier in bootstrap, and that default stands.
 * - `themeId` matches a `registry` entry's `settingsId`: that theme is
 *   applied for real (not a preview).
 * - `themeId` is a non-null string that matches nothing in `registry`
 *   (stale — its package was removed in a way that did not go through
 *   `removeImportedThemePackage`'s own clearing path, or was imported in a
 *   session this one never restored): reported to the console and the
 *   stale value is cleared via [`persistThemeSelectionBestEffort`], leaving
 *   the already-applied default in place rather than a broken reference
 *   that would just repeat this same warning every future boot.
 *
 * Reading the persisted selection itself failing (the `theme_get_selection`
 * call throwing) is treated the same as "nothing was ever persisted": a
 * console warning, and the already-applied default stands — never a boot
 * failure.
 */
export async function applyPersistedThemeSelection(
	bridge: PlainBridge,
	themeService: IWorkbenchThemeService,
	registry: readonly PlainThemeRegistryEntry[],
): Promise<void> {
	let themeId: string | null;
	try {
		({ themeId } = await bridge.themeGetSelection());
	} catch (error) {
		console.warn(
			"Plain: failed to read the persisted color theme selection",
			error,
		);
		return;
	}
	if (themeId === null) {
		return;
	}
	const entry = registry.find((candidate) => candidate.settingsId === themeId);
	if (entry === undefined) {
		console.warn(
			`Plain: persisted color theme "${themeId}" is no longer available; falling back to the default`,
		);
		await persistThemeSelectionBestEffort(bridge, null);
		return;
	}
	try {
		await themeService.setColorTheme(entry.data, undefined);
	} catch (error) {
		console.warn(
			"Plain: failed to apply the persisted color theme selection",
			error,
		);
	}
}

/**
 * Plain's own Quick Pick for `workbench.action.selectTheme`, replacing the
 * vendor picker that upstream's `themes.contribution.js` registers (see
 * this module's own doc comment on `SELECT_COLOR_THEME_COMMAND_ID` for why
 * that picker is always empty and how Plain takes the id over). Behavior
 * mirrors upstream's core semantics — live preview while navigating,
 * Escape/dismiss restores the theme that was active before the picker
 * opened, Enter commits — without upstream's marketplace/gallery browsing,
 * which Plain does not have (no `extensions-service-override`, no gallery).
 */
async function runSelectColorThemeQuickPick(
	bridge: PlainBridge,
	quickInputService: IQuickInputService,
	themeService: IWorkbenchThemeService,
	registry: readonly PlainThemeRegistryEntry[],
): Promise<void> {
	if (registry.length === 0) {
		return;
	}
	const originalTheme = themeService.getColorTheme();
	const items = buildThemeQuickPickItems(registry);
	const quickPick = quickInputService.createQuickPick<PlainThemeQuickPickItem>({
		useSeparators: true,
	});
	quickPick.items = items;
	quickPick.placeholder = "Select Color Theme";
	quickPick.matchOnDescription = false;
	quickPick.canSelectMany = false;
	const activeItem = items.find(
		(item): item is PlainThemeQuickPickItem =>
			isThemeItem(item) && item.entry.data.id === originalTheme.id,
	);
	if (activeItem !== undefined) {
		quickPick.activeItems = [activeItem];
	}

	let accepted = false;
	const previewSubscription = quickPick.onDidChangeActive((activeItems) => {
		const [active] = activeItems;
		if (active !== undefined) {
			void themeService
				.setColorTheme(active.entry.data, "preview")
				.catch(() => undefined);
		}
	});
	const acceptSubscription = quickPick.onDidAccept(() => {
		accepted = true;
		const [selected] = quickPick.selectedItems;
		void themeService
			.setColorTheme(selected?.entry.data ?? originalTheme, undefined)
			.catch(() => undefined);
		// `F050` S4: Enter is the one user action that commits a selection —
		// persist it (best-effort) whether the user actually picked a
		// different entry or simply re-confirmed the one already active
		// (`selected` undefined), matching `originalTheme.settingsId` either
		// way.
		void persistThemeSelectionBestEffort(
			bridge,
			selected?.entry.settingsId ?? originalTheme.settingsId,
		);
		quickPick.hide();
	});

	try {
		await new Promise<void>((resolve) => {
			const hideSubscription = quickPick.onDidHide(() => {
				hideSubscription.dispose();
				if (!accepted) {
					void themeService
						.setColorTheme(originalTheme, undefined)
						.catch(() => undefined);
				}
				resolve();
			});
			quickPick.show();
		});
	} finally {
		previewSubscription.dispose();
		acceptSubscription.dispose();
		quickPick.dispose();
	}
}

export interface PlainThemePickerRegistration {
	dispose(): void;
}

/** Registers Plain's takeover of `workbench.action.selectTheme` — see
 * `SELECT_COLOR_THEME_COMMAND_ID`'s own doc comment for the exact mechanism
 * and why it is safe to register the same id a second time. Must be called
 * after `app/services.ts` has already been imported (so the vendor
 * registration this overrides already exists) — `app/main.ts` guarantees
 * this via import order. */
export function registerPlainThemePicker(
	bridge: PlainBridge,
	registry: readonly PlainThemeRegistryEntry[],
): PlainThemePickerRegistration {
	const registration = CommandsRegistry.registerCommand(
		SELECT_COLOR_THEME_COMMAND_ID,
		(accessor) =>
			runSelectColorThemeQuickPick(
				bridge,
				accessor.get(IQuickInputService),
				accessor.get(IWorkbenchThemeService),
				registry,
			),
	);
	return {
		dispose() {
			registration.dispose();
		},
	};
}

interface PlainFileIconThemeQuickPickItem extends IQuickPickItem {
	readonly data: FileIconThemeData;
}

function isFileIconThemeItem(
	item: PlainFileIconThemeQuickPickItem | IQuickPickSeparator,
): item is PlainFileIconThemeQuickPickItem {
	return item.type !== "separator";
}

/** Upstream's own "None" entry (`SelectFileIconThemeCommandId`'s handler in
 * `themes.contribution.js`): id `""`, description "Disable File Icons", and
 * — the part that actually does the disabling — `FileIconThemeData.
 * noIconTheme` itself as the applied instance (not a lookup by id). Passing
 * this singleton straight to `setFileIconTheme` hits its `instanceof
 * FileIconThemeData` fallback branch exactly like any other bare instance
 * this module constructs, and its own `id === ""` is what clears the
 * vendor's `file-icons-enabled` workbench class (see `applyAndSetFileIconTheme`
 * in `workbenchThemeService.js`: `if (iconThemeData.id) { add } else {
 * remove }`) — confirmed by reading that source, not inferred from the name.
 */
function noFileIconThemeItem(): PlainFileIconThemeQuickPickItem {
	return {
		id: "",
		label: "None",
		description: "Disable File Icons",
		data: FileIconThemeData.noIconTheme,
	};
}

function buildFileIconThemeQuickPickItems(
	registry: readonly PlainFileIconThemeRegistryEntry[],
): ReadonlyArray<PlainFileIconThemeQuickPickItem | IQuickPickSeparator> {
	const items: Array<PlainFileIconThemeQuickPickItem | IQuickPickSeparator> = [
		{ type: "separator", label: "File icon themes" },
		noFileIconThemeItem(),
	];
	for (const entry of registry) {
		items.push({ id: entry.settingsId, label: entry.label, data: entry.data });
	}
	return Object.freeze(items);
}

/**
 * Plain's own Quick Pick for `workbench.action.selectIconTheme` — same
 * preview/Escape-restores/Enter-commits semantics as
 * `runSelectColorThemeQuickPick`, with "None" always offered first (see
 * `noFileIconThemeItem`'s own doc comment for its exact upstream-matching
 * semantics). Unlike the color theme picker this never short-circuits on an
 * empty `registry`: "None" is always a valid, meaningful choice even when no
 * file icon theme is registered at all.
 */
async function runSelectFileIconThemeQuickPick(
	quickInputService: IQuickInputService,
	themeService: IWorkbenchThemeService,
	registry: readonly PlainFileIconThemeRegistryEntry[],
): Promise<void> {
	const originalTheme = themeService.getFileIconTheme();
	const items = buildFileIconThemeQuickPickItems(registry);
	const quickPick =
		quickInputService.createQuickPick<PlainFileIconThemeQuickPickItem>({
			useSeparators: true,
		});
	quickPick.items = items;
	quickPick.placeholder = "Select File Icon Theme (Up/Down Keys to Preview)";
	quickPick.matchOnDescription = false;
	quickPick.canSelectMany = false;
	const activeItem = items.find(
		(item): item is PlainFileIconThemeQuickPickItem =>
			isFileIconThemeItem(item) && item.data.id === originalTheme.id,
	);
	if (activeItem !== undefined) {
		quickPick.activeItems = [activeItem];
	}

	let accepted = false;
	const previewSubscription = quickPick.onDidChangeActive((activeItems) => {
		const [active] = activeItems;
		if (active !== undefined) {
			void themeService
				.setFileIconTheme(active.data, "preview")
				.catch(() => undefined);
		}
	});
	const acceptSubscription = quickPick.onDidAccept(() => {
		accepted = true;
		const [selected] = quickPick.selectedItems;
		void themeService
			.setFileIconTheme(selected?.data ?? originalTheme, undefined)
			.catch(() => undefined);
		quickPick.hide();
	});

	try {
		await new Promise<void>((resolve) => {
			const hideSubscription = quickPick.onDidHide(() => {
				hideSubscription.dispose();
				if (!accepted) {
					void themeService
						.setFileIconTheme(originalTheme, undefined)
						.catch(() => undefined);
				}
				resolve();
			});
			quickPick.show();
		});
	} finally {
		previewSubscription.dispose();
		acceptSubscription.dispose();
		quickPick.dispose();
	}
}

/** Registers Plain's takeover of `workbench.action.selectIconTheme` — same
 * same-id-re-registration mechanism as `registerPlainThemePicker` (see
 * `SELECT_FILE_ICON_THEME_COMMAND_ID`'s own doc comment). Persisting the
 * user's selection (`F060` S3) is not this slice's scope: unlike
 * `registerPlainThemePicker`, this never calls back into a `PlainBridge`. */
export function registerPlainFileIconThemePicker(
	registry: readonly PlainFileIconThemeRegistryEntry[],
): PlainThemePickerRegistration {
	const registration = CommandsRegistry.registerCommand(
		SELECT_FILE_ICON_THEME_COMMAND_ID,
		(accessor) =>
			runSelectFileIconThemeQuickPick(
				accessor.get(IQuickInputService),
				accessor.get(IWorkbenchThemeService),
				registry,
			),
	);
	return {
		dispose() {
			registration.dispose();
		},
	};
}

interface PlainProductIconThemeQuickPickItem extends IQuickPickItem {
	readonly data: ProductIconThemeData;
}

function isProductIconThemeItem(
	item: PlainProductIconThemeQuickPickItem | IQuickPickSeparator,
): item is PlainProductIconThemeQuickPickItem {
	return item.type !== "separator";
}

/** Upstream's own "Default" entry (`SelectProductIconThemeCommandId`'s
 * handler): `ProductIconThemeData.defaultTheme`, the always-loaded singleton
 * with id `""` — applying it clears any custom product icon rules
 * (`contributedProductIconTheme`'s `<style>` textContent back to empty),
 * which is exactly what leaves every codicon rendering through its own
 * built-in CSS unset by any theme rule (confirmed by reading
 * `applyAndSetProductIconTheme`/`_resolveIconDefinition`'s upstream source,
 * not inferred). */
function defaultProductIconThemeItem(): PlainProductIconThemeQuickPickItem {
	return {
		id: ProductIconThemeData.defaultTheme.id,
		label: "Default",
		data: ProductIconThemeData.defaultTheme,
	};
}

function buildProductIconThemeQuickPickItems(
	registry: readonly PlainProductIconThemeRegistryEntry[],
): ReadonlyArray<PlainProductIconThemeQuickPickItem | IQuickPickSeparator> {
	const items: Array<PlainProductIconThemeQuickPickItem | IQuickPickSeparator> =
		[
			{ type: "separator", label: "Product icon themes" },
			defaultProductIconThemeItem(),
		];
	for (const entry of registry) {
		items.push({ id: entry.settingsId, label: entry.label, data: entry.data });
	}
	return Object.freeze(items);
}

/** Plain's own Quick Pick for `workbench.action.selectProductIconTheme` —
 * same shape as `runSelectFileIconThemeQuickPick`, with "Default" always
 * offered first instead of "None" (a product icon theme is never fully
 * "disabled", only reset to built-in codicons). */
async function runSelectProductIconThemeQuickPick(
	quickInputService: IQuickInputService,
	themeService: IWorkbenchThemeService,
	registry: readonly PlainProductIconThemeRegistryEntry[],
): Promise<void> {
	const originalTheme = themeService.getProductIconTheme();
	const items = buildProductIconThemeQuickPickItems(registry);
	const quickPick =
		quickInputService.createQuickPick<PlainProductIconThemeQuickPickItem>({
			useSeparators: true,
		});
	quickPick.items = items;
	quickPick.placeholder = "Select Product Icon Theme (Up/Down Keys to Preview)";
	quickPick.matchOnDescription = false;
	quickPick.canSelectMany = false;
	const activeItem = items.find(
		(item): item is PlainProductIconThemeQuickPickItem =>
			isProductIconThemeItem(item) && item.data.id === originalTheme.id,
	);
	if (activeItem !== undefined) {
		quickPick.activeItems = [activeItem];
	}

	let accepted = false;
	const previewSubscription = quickPick.onDidChangeActive((activeItems) => {
		const [active] = activeItems;
		if (active !== undefined) {
			void themeService
				.setProductIconTheme(active.data, "preview")
				.catch(() => undefined);
		}
	});
	const acceptSubscription = quickPick.onDidAccept(() => {
		accepted = true;
		const [selected] = quickPick.selectedItems;
		void themeService
			.setProductIconTheme(selected?.data ?? originalTheme, undefined)
			.catch(() => undefined);
		quickPick.hide();
	});

	try {
		await new Promise<void>((resolve) => {
			const hideSubscription = quickPick.onDidHide(() => {
				hideSubscription.dispose();
				if (!accepted) {
					void themeService
						.setProductIconTheme(originalTheme, undefined)
						.catch(() => undefined);
				}
				resolve();
			});
			quickPick.show();
		});
	} finally {
		previewSubscription.dispose();
		acceptSubscription.dispose();
		quickPick.dispose();
	}
}

/** Registers Plain's takeover of `workbench.action.selectProductIconTheme` —
 * same mechanism as `registerPlainFileIconThemePicker`. */
export function registerPlainProductIconThemePicker(
	registry: readonly PlainProductIconThemeRegistryEntry[],
): PlainThemePickerRegistration {
	const registration = CommandsRegistry.registerCommand(
		SELECT_PRODUCT_ICON_THEME_COMMAND_ID,
		(accessor) =>
			runSelectProductIconThemeQuickPick(
				accessor.get(IQuickInputService),
				accessor.get(IWorkbenchThemeService),
				registry,
			),
	);
	return {
		dispose() {
			registration.dispose();
		},
	};
}
