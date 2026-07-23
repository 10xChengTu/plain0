import { afterEach, describe, expect, it, vi } from "vitest";

const { importVsixMock, importDirectoryMock, removeMock, errorMessageMock } =
	vi.hoisted(() => ({
		importVsixMock: vi.fn(),
		importDirectoryMock: vi.fn(),
		removeMock: vi.fn(),
		errorMessageMock: vi.fn(
			(error: unknown) => `mapped-error:${JSON.stringify(error)}`,
		),
	}));

vi.mock("../../app/features/themes/plain-theme-import-coordinator", () => ({
	importThemePackageViaVsix: importVsixMock,
	importThemePackageViaDirectory: importDirectoryMock,
	removeImportedThemePackage: removeMock,
	themeCommandErrorMessage: errorMessageMock,
}));

import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";

import {
	IMPORT_DIRECTORY_COMMAND_ID,
	IMPORT_VSIX_COMMAND_ID,
	REMOVE_COMMAND_ID,
	registerPlainThemeCommands,
} from "../../app/features/themes/plain-theme-commands";
import type { PlainThemeRegistryStore } from "../../app/features/themes/plain-theme-import-coordinator";
import type { PlainBridge } from "../../app/platform/tauri/contracts";

function fakeStore(packageIds: readonly string[]): PlainThemeRegistryStore {
	return {
		importedPackageIds: () => packageIds,
	} as unknown as PlainThemeRegistryStore;
}

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

async function invokeCommand(
	commandId: string,
	services: Map<unknown, unknown>,
) {
	const command = CommandsRegistry.getCommand(commandId);
	if (command === undefined) {
		throw new Error(`command ${commandId} was not registered`);
	}
	return command.handler(
		fakeAccessor(services) as Parameters<typeof command.handler>[0],
	);
}

// Resolved once, lazily, purely so tests can compare against the exact same
// token identities the command handlers resolve through `accessor.get(...)`.
const serviceTokens = await (async () => {
	const [
		{ IDialogService },
		{ IQuickInputService },
		{ INotificationService },
		{ IWorkbenchThemeService },
	] = await Promise.all([
		import("@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service"),
		import("@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service"),
		import("@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service"),
		import("@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service"),
	]);
	return {
		dialog: IDialogService,
		quickInput: IQuickInputService,
		notification: INotificationService,
		theme: IWorkbenchThemeService,
	};
})();

function fakeNotificationService() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("registerPlainThemeCommands", () => {
	let disposeRegistration: (() => void) | undefined;

	afterEach(() => {
		disposeRegistration?.();
		disposeRegistration = undefined;
		importVsixMock.mockReset();
		importDirectoryMock.mockReset();
		removeMock.mockReset();
		errorMessageMock.mockClear();
	});

	function register(
		store: PlainThemeRegistryStore,
		reRegisterPicker = vi.fn(),
	) {
		const registration = registerPlainThemeCommands(
			{} as PlainBridge,
			store,
			reRegisterPicker,
		);
		disposeRegistration = () => registration.dispose();
		return { registration, reRegisterPicker };
	}

	it("registers the exact three plain-prefixed command ids", () => {
		register(fakeStore([]));
		for (const id of [
			IMPORT_VSIX_COMMAND_ID,
			IMPORT_DIRECTORY_COMMAND_ID,
			REMOVE_COMMAND_ID,
		]) {
			expect(CommandsRegistry.getCommand(id)).toBeDefined();
		}
		expect(IMPORT_VSIX_COMMAND_ID).toBe("plain.theme.importVsix");
		expect(IMPORT_DIRECTORY_COMMAND_ID).toBe("plain.theme.importDirectory");
		expect(REMOVE_COMMAND_ID).toBe("plain.theme.remove");
	});

	it("registers a Command Palette entry with the Plain category for each command", () => {
		register(fakeStore([]));
		const paletteCommandIds = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.map((item) => ("command" in item ? item.command.id : undefined))
			.filter((id): id is string => id !== undefined);
		for (const id of [
			IMPORT_VSIX_COMMAND_ID,
			IMPORT_DIRECTORY_COMMAND_ID,
			REMOVE_COMMAND_ID,
		]) {
			expect(paletteCommandIds).toContain(id);
		}
		const importEntry = MenuRegistry.getMenuItems(MenuId.CommandPalette).find(
			(item) => "command" in item && item.command.id === IMPORT_VSIX_COMMAND_ID,
		);
		expect(
			importEntry && "command" in importEntry && importEntry.command,
		).toEqual(
			expect.objectContaining({
				id: IMPORT_VSIX_COMMAND_ID,
				title: "Import Color Theme (VSIX)...",
				category: "Plain",
			}),
		);
	});

	it("dispose() removes every registered command", () => {
		const { registration } = register(fakeStore([]));
		registration.dispose();
		disposeRegistration = undefined;
		for (const id of [
			IMPORT_VSIX_COMMAND_ID,
			IMPORT_DIRECTORY_COMMAND_ID,
			REMOVE_COMMAND_ID,
		]) {
			expect(CommandsRegistry.getCommand(id)).toBeUndefined();
		}
	});

	it("import vsix: re-registers the picker and notifies on success, does nothing on cancel, notifies error on failure", async () => {
		const notificationService = fakeNotificationService();
		const { reRegisterPicker } = register(fakeStore([]));

		importVsixMock.mockResolvedValueOnce({ status: "cancelled" });
		await invokeCommand(
			IMPORT_VSIX_COMMAND_ID,
			new Map([[serviceTokens.notification, notificationService]]),
		);
		expect(reRegisterPicker).not.toHaveBeenCalled();
		expect(notificationService.info).not.toHaveBeenCalled();

		importVsixMock.mockResolvedValueOnce({
			status: "imported",
			package: { id: "demo.pkg@1.0.0" },
		});
		await invokeCommand(
			IMPORT_VSIX_COMMAND_ID,
			new Map([[serviceTokens.notification, notificationService]]),
		);
		expect(reRegisterPicker).toHaveBeenCalledTimes(1);
		expect(notificationService.info).toHaveBeenCalledWith(
			expect.stringContaining("demo.pkg@1.0.0"),
		);

		const failure = { code: "THEME_PACKAGE_NO_THEMES", message: "raw" };
		importVsixMock.mockRejectedValueOnce(failure);
		await invokeCommand(
			IMPORT_VSIX_COMMAND_ID,
			new Map([[serviceTokens.notification, notificationService]]),
		);
		expect(errorMessageMock).toHaveBeenCalledWith(failure);
		expect(notificationService.error).toHaveBeenCalledWith(
			errorMessageMock.mock.results.at(-1)?.value,
		);
	});

	it("import directory: mirrors the same success/cancel/error handling", async () => {
		const notificationService = fakeNotificationService();
		const { reRegisterPicker } = register(fakeStore([]));

		importDirectoryMock.mockResolvedValueOnce({
			status: "imported",
			package: { id: "folder.pkg@1.0.0" },
		});
		await invokeCommand(
			IMPORT_DIRECTORY_COMMAND_ID,
			new Map([[serviceTokens.notification, notificationService]]),
		);
		expect(reRegisterPicker).toHaveBeenCalledTimes(1);
		expect(notificationService.info).toHaveBeenCalledWith(
			expect.stringContaining("folder.pkg@1.0.0"),
		);
	});

	it("remove: informs when there is nothing to remove and never opens a picker", async () => {
		const notificationService = fakeNotificationService();
		const quickInputService = { pick: vi.fn() };
		register(fakeStore([]));

		await invokeCommand(
			REMOVE_COMMAND_ID,
			new Map<unknown, unknown>([
				[serviceTokens.notification, notificationService],
				[serviceTokens.quickInput, quickInputService],
				[serviceTokens.dialog, { confirm: vi.fn() }],
				[serviceTokens.theme, {}],
			]),
		);
		expect(quickInputService.pick).not.toHaveBeenCalled();
		expect(notificationService.info).toHaveBeenCalledWith(
			expect.stringContaining("no imported theme packages"),
		);
		expect(removeMock).not.toHaveBeenCalled();
	});

	it("remove: does nothing when the quick pick is dismissed without a selection", async () => {
		const notificationService = fakeNotificationService();
		const quickInputService = { pick: vi.fn(async () => undefined) };
		register(fakeStore(["demo.pkg@1.0.0"]));

		await invokeCommand(
			REMOVE_COMMAND_ID,
			new Map<unknown, unknown>([
				[serviceTokens.notification, notificationService],
				[serviceTokens.quickInput, quickInputService],
				[serviceTokens.dialog, { confirm: vi.fn() }],
				[serviceTokens.theme, {}],
			]),
		);
		expect(removeMock).not.toHaveBeenCalled();
	});

	it("remove: does nothing when the confirmation dialog is declined", async () => {
		const notificationService = fakeNotificationService();
		const quickInputService = {
			pick: vi.fn(async () => ({ packageId: "demo.pkg@1.0.0" })),
		};
		const dialogService = {
			confirm: vi.fn(async () => ({ confirmed: false })),
		};
		register(fakeStore(["demo.pkg@1.0.0"]));

		await invokeCommand(
			REMOVE_COMMAND_ID,
			new Map<unknown, unknown>([
				[serviceTokens.notification, notificationService],
				[serviceTokens.quickInput, quickInputService],
				[serviceTokens.dialog, dialogService],
				[serviceTokens.theme, {}],
			]),
		);
		expect(removeMock).not.toHaveBeenCalled();
	});

	it("remove: removes the confirmed package, re-registers the picker, and notifies", async () => {
		const notificationService = fakeNotificationService();
		const quickInputService = {
			pick: vi.fn(async () => ({ packageId: "demo.pkg@1.0.0" })),
		};
		const dialogService = { confirm: vi.fn(async () => ({ confirmed: true })) };
		const { reRegisterPicker } = register(fakeStore(["demo.pkg@1.0.0"]));
		removeMock.mockResolvedValueOnce(undefined);

		await invokeCommand(
			REMOVE_COMMAND_ID,
			new Map<unknown, unknown>([
				[serviceTokens.notification, notificationService],
				[serviceTokens.quickInput, quickInputService],
				[serviceTokens.dialog, dialogService],
				[serviceTokens.theme, {}],
			]),
		);
		expect(removeMock).toHaveBeenCalledWith(
			{},
			expect.anything(),
			{},
			"demo.pkg@1.0.0",
		);
		expect(reRegisterPicker).toHaveBeenCalledTimes(1);
		expect(notificationService.info).toHaveBeenCalledWith(
			expect.stringContaining("demo.pkg@1.0.0"),
		);
	});

	it("remove: notifies an error and does not re-register the picker when removal fails", async () => {
		const notificationService = fakeNotificationService();
		const quickInputService = {
			pick: vi.fn(async () => ({ packageId: "demo.pkg@1.0.0" })),
		};
		const dialogService = { confirm: vi.fn(async () => ({ confirmed: true })) };
		const { reRegisterPicker } = register(fakeStore(["demo.pkg@1.0.0"]));
		const failure = { code: "THEME_IO_FAILED", message: "raw" };
		removeMock.mockRejectedValueOnce(failure);

		await invokeCommand(
			REMOVE_COMMAND_ID,
			new Map<unknown, unknown>([
				[serviceTokens.notification, notificationService],
				[serviceTokens.quickInput, quickInputService],
				[serviceTokens.dialog, dialogService],
				[serviceTokens.theme, {}],
			]),
		);
		expect(errorMessageMock).toHaveBeenCalledWith(failure);
		expect(notificationService.error).toHaveBeenCalled();
		expect(reRegisterPicker).not.toHaveBeenCalled();
	});
});
