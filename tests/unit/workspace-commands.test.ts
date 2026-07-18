import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { describe, expect, it, vi } from "vitest";

import {
	registerWorkspaceCommands,
	WORKSPACE_COMMAND_IDS,
} from "../../app/features/workspace/commands";
import { MULTI_ROOT_WORKSPACE_UNSUPPORTED } from "../../app/features/workspace/workspace-projection";
import type { PlainBridge } from "../../app/platform/tauri";

describe("workspace Workbench command overrides", () => {
	it("keeps the existing command ids and passes each picker mode", async () => {
		const workspacePickRoots = vi.fn(async () => ({
			status: "cancelled" as const,
			snapshot: {
				workspaceId: "00000000-0000-4000-8000-000000000001",
				revision: 0,
				roots: [],
			},
		}));
		const bridge: PlainBridge = {
			runtimeInfo: vi.fn(),
			onRuntimeReady: vi.fn(),
			workspaceSnapshot: vi.fn(),
			workspacePickRoots,
			workspaceRemoveRoot: vi.fn(),
			workspaceCreateFile: vi.fn(),
			workspaceCreateDirectory: vi.fn(),
			workspaceRename: vi.fn(),
			workspaceCopy: vi.fn(),
			workspaceStat: vi.fn(),
			workspaceReadDirectory: vi.fn(),
			workspaceReadFile: vi.fn(),
		};
		const contextValues = new Map<string, unknown>([
			["openFolderWorkspaceSupport", false],
		]);
		const contextKeyService = {
			createKey: vi.fn((key: string, defaultValue: unknown) => {
				if (!contextValues.has(key)) {
					contextValues.set(key, defaultValue);
				}
				return {
					set: (value: unknown) => contextValues.set(key, value),
					reset: () => contextValues.set(key, defaultValue),
					get: () => contextValues.get(key),
				};
			}),
			getContextKeyValue: vi.fn((key: string) => contextValues.get(key)),
		} as unknown as IContextKeyService;
		const applySnapshot = vi.fn();
		const registration = registerWorkspaceCommands(
			bridge,
			contextKeyService,
			applySnapshot,
		);

		try {
			expect(Object.values(WORKSPACE_COMMAND_IDS)).toEqual([
				"workbench.action.files.openFolder",
				"workbench.action.files.openFolderViaWorkspace",
				"addRootFolder",
			]);
			expect(contextValues.get("openFolderWorkspaceSupport")).toBe(true);
			for (const id of [
				WORKSPACE_COMMAND_IDS.openFolder,
				WORKSPACE_COMMAND_IDS.openFolderViaWorkspace,
			]) {
				const command = CommandsRegistry.getCommand(id);
				expect(command?.id).toBe(id);
				expect(command?.metadata).toBeUndefined();
				await command?.handler(undefined as never);
			}
			const addRoot = CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.addRootFolder,
			);
			expect(addRoot?.id).toBe(WORKSPACE_COMMAND_IDS.addRootFolder);
			await expect(addRoot?.handler(undefined as never)).rejects.toMatchObject({
				code: MULTI_ROOT_WORKSPACE_UNSUPPORTED,
			});

			expect(workspacePickRoots.mock.calls).toEqual([["replace"], ["replace"]]);
			expect(applySnapshot).not.toHaveBeenCalled();
			expect(contextValues.get("enterMultiRootWorkspaceSupport")).toBe(false);
		} finally {
			registration.dispose();
		}
		expect(contextValues.get("openFolderWorkspaceSupport")).toBe(false);
		expect(contextValues.get("enterMultiRootWorkspaceSupport")).toBe(true);
	});

	it("waits for a selected snapshot projection before resolving", async () => {
		const calls: string[] = [];
		const snapshot = {
			workspaceId: "00000000-0000-4000-8000-000000000001",
			revision: 1,
			roots: [],
		};
		const bridge = {
			workspacePickRoots: vi.fn(async () => {
				calls.push("pick");
				return { status: "selected" as const, snapshot };
			}),
		} as unknown as PlainBridge;
		const contextValues = new Map<string, unknown>();
		const contextKeyService = {
			createKey: vi.fn((key: string, defaultValue: unknown) => {
				contextValues.set(key, defaultValue);
				return {
					set: (value: unknown) => contextValues.set(key, value),
					reset: () => contextValues.set(key, defaultValue),
					get: () => contextValues.get(key),
				};
			}),
			getContextKeyValue: vi.fn((key: string) => contextValues.get(key)),
		} as unknown as IContextKeyService;
		const registration = registerWorkspaceCommands(
			bridge,
			contextKeyService,
			async (nextSnapshot) => {
				expect(nextSnapshot).toBe(snapshot);
				await Promise.resolve();
				calls.push("project");
			},
		);

		try {
			await CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.openFolder,
			)?.handler(undefined as never);
			expect(calls).toEqual(["pick", "project"]);
		} finally {
			registration.dispose();
		}
	});
});
