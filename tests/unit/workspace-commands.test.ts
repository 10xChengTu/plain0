import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { describe, expect, it, vi } from "vitest";

import {
	registerWorkspaceCommands,
	WORKSPACE_COMMAND_IDS,
} from "../../app/features/workspace/commands";
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
		const registration = registerWorkspaceCommands(bridge, contextKeyService);

		try {
			expect(Object.values(WORKSPACE_COMMAND_IDS)).toEqual([
				"workbench.action.files.openFolder",
				"workbench.action.files.openFolderViaWorkspace",
				"addRootFolder",
			]);
			expect(contextValues.get("openFolderWorkspaceSupport")).toBe(true);
			expect(contextValues.has("enterMultiRootWorkspaceSupport")).toBe(false);
			for (const id of Object.values(WORKSPACE_COMMAND_IDS)) {
				const command = CommandsRegistry.getCommand(id);
				expect(command?.id).toBe(id);
				expect(command?.metadata).toBeUndefined();
				await command?.handler(undefined as never);
			}

			expect(workspacePickRoots.mock.calls).toEqual([
				["replace"],
				["replace"],
				["add"],
			]);
		} finally {
			registration.dispose();
		}
		expect(contextValues.get("openFolderWorkspaceSupport")).toBe(false);
	});
});
