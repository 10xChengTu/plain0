import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { describe, expect, it, vi } from "vitest";

import {
	GUARDED_WORKSPACE_COMMAND_IDS,
	registerWorkspaceCommands,
	WORKSPACE_COMMAND_IDS,
} from "../../app/features/workspace/commands";
import type { WorkspaceTopologyCoordinator } from "../../app/features/workspace/workspace-projection";
import type { PlainBridge, WorkspaceSnapshot } from "../../app/platform/tauri";
import { PLAIN_WORKSPACE_OPERATION_UNSUPPORTED } from "../../app/services/plain-workspace-services";

type TestTopologyMutation = () => Promise<{
	readonly result: unknown;
	readonly snapshot: WorkspaceSnapshot | undefined;
}>;

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
			workspaceCapabilities: vi.fn(),
			workspaceSnapshot: vi.fn(),
			workspaceWatch: vi.fn(() => () => {}),
			workspacePickRoots,
			workspaceRemoveRoot: vi.fn(),
			workspaceCreateFile: vi.fn(),
			workspaceCreateDirectory: vi.fn(),
			workspaceRename: vi.fn(),
			workspaceCopy: vi.fn(),
			workspaceMove: vi.fn(),
			workspacePrepareDelete: vi.fn(),
			workspaceCancelDelete: vi.fn(),
			workspaceBeginDelete: vi.fn(),
			workspaceCommitDeleteEntry: vi.fn(),
			workspaceStat: vi.fn(),
			workspaceReadDirectory: vi.fn(),
			workspaceReadFile: vi.fn(),
			workspaceWriteFile: vi.fn(),
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
		const projectedSnapshots: unknown[] = [];
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const mutationResult = await mutation();
				if (mutationResult.snapshot !== undefined) {
					projectedSnapshots.push(mutationResult.snapshot);
				}
				return mutationResult.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerWorkspaceCommands(
			bridge,
			contextKeyService,
			topologyCoordinator,
		);

		try {
			expect(Object.values(WORKSPACE_COMMAND_IDS)).toEqual([
				"workbench.action.files.openFolder",
				"workbench.action.files.openFolderViaWorkspace",
				"setRootFolder",
				"addRootFolder",
			]);
			expect(contextValues.get("openFolderWorkspaceSupport")).toBe(true);
			for (const [id] of [
				[WORKSPACE_COMMAND_IDS.openFolder, "replace"],
				[WORKSPACE_COMMAND_IDS.openFolderViaWorkspace, "replace"],
				[WORKSPACE_COMMAND_IDS.setRootFolder, "replace"],
				[WORKSPACE_COMMAND_IDS.addRootFolder, "add"],
			] as const) {
				const command = CommandsRegistry.getCommand(id);
				expect(command?.id).toBe(id);
				expect(command?.metadata).toBeUndefined();
				await command?.handler(undefined as never);
			}
			for (const id of GUARDED_WORKSPACE_COMMAND_IDS) {
				const guarded = CommandsRegistry.getCommand(id);
				expect(guarded?.id).toBe(id);
				await expect(
					guarded?.handler(undefined as never),
				).rejects.toMatchObject({
					code: PLAIN_WORKSPACE_OPERATION_UNSUPPORTED,
				});
			}

			expect(workspacePickRoots.mock.calls).toEqual([
				["replace"],
				["replace"],
				["replace"],
				["add"],
			]);
			expect(projectedSnapshots).toEqual([]);
			expect(contextValues.get("enterMultiRootWorkspaceSupport")).toBe(false);
		} finally {
			registration.dispose();
		}
		expect(contextValues.get("openFolderWorkspaceSupport")).toBe(false);
		expect(contextValues.get("enterMultiRootWorkspaceSupport")).toBe(true);
	});

	it("waits for every replace and add snapshot projection before resolving", async () => {
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
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				calls.push("queue");
				const mutationResult = await mutation();
				expect(mutationResult.snapshot).toBe(snapshot);
				await Promise.resolve();
				calls.push("project");
				return mutationResult.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerWorkspaceCommands(
			bridge,
			contextKeyService,
			topologyCoordinator,
		);

		try {
			for (const id of [
				WORKSPACE_COMMAND_IDS.openFolder,
				WORKSPACE_COMMAND_IDS.setRootFolder,
				WORKSPACE_COMMAND_IDS.addRootFolder,
			]) {
				await CommandsRegistry.getCommand(id)?.handler(undefined as never);
			}
			expect(calls).toEqual([
				"queue",
				"pick",
				"project",
				"queue",
				"pick",
				"project",
				"queue",
				"pick",
				"project",
			]);
			expect(bridge.workspacePickRoots).toHaveBeenNthCalledWith(1, "replace");
			expect(bridge.workspacePickRoots).toHaveBeenNthCalledWith(2, "replace");
			expect(bridge.workspacePickRoots).toHaveBeenNthCalledWith(3, "add");
		} finally {
			registration.dispose();
		}
	});

	it("lets the coordinator reject before a native picker mutation runs", async () => {
		const workspacePickRoots = vi.fn();
		const bridge = { workspacePickRoots } as unknown as PlainBridge;
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
		const fatal = Object.freeze({ code: "WORKSPACE_PROJECTION_FAILED" });
		const topologyCoordinator = {
			runMutation: vi.fn(async () => Promise.reject(fatal)),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerWorkspaceCommands(
			bridge,
			contextKeyService,
			topologyCoordinator,
		);

		try {
			for (const id of [
				WORKSPACE_COMMAND_IDS.openFolder,
				WORKSPACE_COMMAND_IDS.addRootFolder,
			]) {
				await expect(
					CommandsRegistry.getCommand(id)?.handler(undefined as never),
				).rejects.toBe(fatal);
			}
			expect(workspacePickRoots).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});
});
