import { afterEach, describe, expect, it, vi } from "vitest";

import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { KeybindingsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import {
	FIND_IN_FILES_COMMAND_ID,
	REPLACE_IN_FILES_COMMAND_ID,
	registerPlainSearchCommands,
} from "../../app/features/search/plain-search-commands";

function fakeAccessor(services: Map<unknown, unknown>) {
	return {
		get(token: unknown) {
			if (!services.has(token)) {
				throw new Error("unexpected service token requested");
			}
			return services.get(token);
		},
	};
}

/** Invokes a registered command's handler and flushes the fire-and-forget
 * async chain (`void openAndFocusSearchView(...)`) so its effects on the
 * fake `IViewsService`/view are observable before assertions run. */
async function invokeCommand(
	commandId: string,
	services: Map<unknown, unknown>,
): Promise<void> {
	const command = CommandsRegistry.getCommand(commandId);
	if (command === undefined) {
		throw new Error(`command ${commandId} was not registered`);
	}
	command.handler(
		fakeAccessor(services) as Parameters<typeof command.handler>[0],
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeSearchView() {
	return {
		focusSearchInput: vi.fn(),
		focusReplaceInput: vi.fn(),
	};
}

describe("registerPlainSearchCommands", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
	});

	function register() {
		const registration = registerPlainSearchCommands();
		disposeRegistration = () => registration.dispose();
		return registration;
	}

	it("registers the exact two plain-prefixed command ids", () => {
		register();
		expect(FIND_IN_FILES_COMMAND_ID).toBe("plain.search.findInFiles");
		expect(REPLACE_IN_FILES_COMMAND_ID).toBe("plain.search.replaceInFiles");
		for (const id of [FIND_IN_FILES_COMMAND_ID, REPLACE_IN_FILES_COMMAND_ID]) {
			expect(CommandsRegistry.getCommand(id)).toBeDefined();
		}
	});

	it("registers a Command Palette entry titled 'Search: <title>' for each command", () => {
		register();
		const items = MenuRegistry.getMenuItems(MenuId.CommandPalette);
		const findEntry = items.find(
			(item) =>
				"command" in item && item.command.id === FIND_IN_FILES_COMMAND_ID,
		);
		expect(
			findEntry && "command" in findEntry ? findEntry.command : undefined,
		).toEqual(
			expect.objectContaining({
				id: FIND_IN_FILES_COMMAND_ID,
				title: "Find in Files",
				category: "Search",
			}),
		);
		const replaceEntry = items.find(
			(item) =>
				"command" in item && item.command.id === REPLACE_IN_FILES_COMMAND_ID,
		);
		expect(
			replaceEntry && "command" in replaceEntry
				? replaceEntry.command
				: undefined,
		).toEqual(
			expect.objectContaining({
				id: REPLACE_IN_FILES_COMMAND_ID,
				title: "Replace in Files",
				category: "Search",
			}),
		);
	});

	it("registers an unconditional (no when-clause) default keybinding for each command", () => {
		register();
		const defaults = KeybindingsRegistry.getDefaultKeybindings();
		const findRule = defaults.find(
			(entry) => entry.command === FIND_IN_FILES_COMMAND_ID,
		);
		const replaceRule = defaults.find(
			(entry) => entry.command === REPLACE_IN_FILES_COMMAND_ID,
		);
		expect(findRule).toBeDefined();
		expect(findRule?.when).toBeUndefined();
		expect(replaceRule).toBeDefined();
		expect(replaceRule?.when).toBeUndefined();
		// The two keybindings must be distinct (Find must not silently also
		// trigger Replace, or vice versa).
		expect(findRule?.keybinding).not.toEqual(replaceRule?.keybinding);
	});

	it("dispose() removes every registered command and keybinding", () => {
		const registration = register();
		registration.dispose();
		disposeRegistration = undefined;
		for (const id of [FIND_IN_FILES_COMMAND_ID, REPLACE_IN_FILES_COMMAND_ID]) {
			expect(CommandsRegistry.getCommand(id)).toBeUndefined();
		}
		const defaults = KeybindingsRegistry.getDefaultKeybindings();
		expect(
			defaults.some(
				(entry) =>
					entry.command === FIND_IN_FILES_COMMAND_ID ||
					entry.command === REPLACE_IN_FILES_COMMAND_ID,
			),
		).toBe(false);
	});

	it("Find in Files opens the Search view and focuses only the search input", async () => {
		register();
		const view = fakeSearchView();
		const openView = vi.fn(async () => view);
		await invokeCommand(
			FIND_IN_FILES_COMMAND_ID,
			new Map([[IViewsService, { openView }]]),
		);
		expect(openView).toHaveBeenCalledTimes(1);
		expect(openView).toHaveBeenCalledWith(expect.any(String), true);
		expect(view.focusSearchInput).toHaveBeenCalledTimes(1);
		expect(view.focusReplaceInput).not.toHaveBeenCalled();
	});

	it("Replace in Files opens the Search view and focuses only the replace input", async () => {
		register();
		const view = fakeSearchView();
		const openView = vi.fn(async () => view);
		await invokeCommand(
			REPLACE_IN_FILES_COMMAND_ID,
			new Map([[IViewsService, { openView }]]),
		);
		expect(openView).toHaveBeenCalledTimes(1);
		expect(openView).toHaveBeenCalledWith(expect.any(String), true);
		expect(view.focusReplaceInput).toHaveBeenCalledTimes(1);
		expect(view.focusSearchInput).not.toHaveBeenCalled();
	});

	it("both commands open the identical view id (idempotent open-or-reveal, never two ids)", async () => {
		register();
		const view = fakeSearchView();
		const openedViewIds: unknown[] = [];
		const openView = vi.fn(async (id: unknown) => {
			openedViewIds.push(id);
			return view;
		});
		await invokeCommand(
			FIND_IN_FILES_COMMAND_ID,
			new Map([[IViewsService, { openView }]]),
		);
		await invokeCommand(
			REPLACE_IN_FILES_COMMAND_ID,
			new Map([[IViewsService, { openView }]]),
		);
		expect(openedViewIds).toHaveLength(2);
		expect(openedViewIds[0]).toBe(openedViewIds[1]);
	});

	it("does nothing (does not throw) when openView resolves to null", async () => {
		register();
		const openView = vi.fn(async () => null);
		await expect(
			invokeCommand(
				FIND_IN_FILES_COMMAND_ID,
				new Map([[IViewsService, { openView }]]),
			),
		).resolves.toBeUndefined();
		expect(openView).toHaveBeenCalledTimes(1);
	});
});
