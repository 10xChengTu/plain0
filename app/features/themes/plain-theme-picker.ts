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

import {
	DARK_MODERN_SETTINGS_ID,
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
	registry: readonly PlainThemeRegistryEntry[],
): PlainThemePickerRegistration {
	const registration = CommandsRegistry.registerCommand(
		SELECT_COLOR_THEME_COMMAND_ID,
		(accessor) =>
			runSelectColorThemeQuickPick(
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
