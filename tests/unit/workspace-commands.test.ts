import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { ICommandService } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	GUARDED_WORKSPACE_COMMAND_IDS,
	PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID,
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

const rootId = "00000000-0000-4000-8000-000000000001";

function workspaceRootUri(
	authority = rootId,
	overrides: Readonly<{
		scheme?: string;
		path?: string;
		query?: string;
		fragment?: string;
	}> = {},
): URI {
	return URI.from(
		{
			scheme: overrides.scheme ?? "plain-workspace",
			authority,
			path: overrides.path ?? "/",
			query: overrides.query,
			fragment: overrides.fragment,
		},
		true,
	);
}

function testContextKeyService(): IContextKeyService {
	const contextValues = new Map<string, unknown>();
	return {
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
}

function testBridge(overrides: Partial<PlainBridge> = {}): PlainBridge {
	return {
		runtimeInfo: vi.fn(),
		onRuntimeReady: vi.fn(),
		workspaceCapabilities: vi.fn(),
		workspaceSnapshot: vi.fn(),
		workspaceReconcileWatchRoots: vi.fn(),
		workspaceWatch: vi.fn(() => () => {}),
		workspacePickRoots: vi.fn(),
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
		workspaceSearchFiles: vi.fn(),
		workspaceSearchTextStart: vi.fn(),
		workspaceSearchTextPoll: vi.fn(),
		workspaceSearchTextCancel: vi.fn(),
		workspaceSearchTextWatch: vi.fn(() => () => {}),
		backupWrite: vi.fn(),
		backupReadAll: vi.fn(),
		backupDiscard: vi.fn(),
		backupDiscardAll: vi.fn(),
		themeImportVsix: vi.fn(),
		themeImportDirectory: vi.fn(),
		themeList: vi.fn(),
		themeReadResource: vi.fn(),
		themeRemove: vi.fn(),
		themeGetSelection: vi.fn(),
		themeSetSelection: vi.fn(),
		...overrides,
	};
}

function testCommandAccessor(executeCommand = vi.fn()) {
	const commandService = { executeCommand } as unknown as ICommandService;
	return Object.freeze({
		accessor: {
			get: vi.fn((service) => {
				expect(service).toBe(ICommandService);
				return commandService;
			}),
		},
		commandService,
		executeCommand,
	});
}

describe("workspace Workbench command overrides", () => {
	it("keeps the product and guarded command ids and passes each picker mode", async () => {
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
			workspaceReconcileWatchRoots: vi.fn(),
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
			workspaceSearchFiles: vi.fn(),
			workspaceSearchTextStart: vi.fn(),
			workspaceSearchTextPoll: vi.fn(),
			workspaceSearchTextCancel: vi.fn(),
			workspaceSearchTextWatch: vi.fn(() => () => {}),
			backupWrite: vi.fn(),
			backupReadAll: vi.fn(),
			backupDiscard: vi.fn(),
			backupDiscardAll: vi.fn(),
			themeImportVsix: vi.fn(),
			themeImportDirectory: vi.fn(),
			themeList: vi.fn(),
			themeReadResource: vi.fn(),
			themeRemove: vi.fn(),
			themeGetSelection: vi.fn(),
			themeSetSelection: vi.fn(),
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
				"removeRootFolder",
				"workbench.action.removeRootFolder",
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
			for (const id of [
				WORKSPACE_COMMAND_IDS.removeRootFolder,
				WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
			]) {
				const command = CommandsRegistry.getCommand(id);
				expect(command?.id).toBe(id);
				expect(command?.metadata).toBeUndefined();
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

	it("removes one exact Explorer root URI and projects the final empty snapshot", async () => {
		const calls: string[] = [];
		const finalSnapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000010",
			revision: 2,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const workspaceRemoveRoot = vi.fn(async () => {
			calls.push("native-remove");
			return finalSnapshot;
		});
		const bridge = testBridge({ workspaceRemoveRoot });
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				calls.push("queue");
				const mutationResult = await mutation();
				expect(mutationResult.snapshot).toBe(finalSnapshot);
				calls.push("project");
				return mutationResult.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const { accessor, executeCommand } = testCommandAccessor();
		const registration = registerWorkspaceCommands(
			bridge,
			testContextKeyService(),
			topologyCoordinator,
		);

		try {
			const result = await CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.removeRootFolder,
			)?.handler(accessor as never, workspaceRootUri());

			expect(result).toBeUndefined();
			expect(calls).toEqual(["queue", "native-remove", "project"]);
			expect(workspaceRemoveRoot).toHaveBeenCalledOnce();
			expect(workspaceRemoveRoot).toHaveBeenCalledWith(rootId);
			expect(executeCommand).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	it("uses the fixed folder picker for Explorer fallback and palette while cancellation has no side effect", async () => {
		const secondRootId = "00000000-0000-4000-8000-000000000002";
		const snapshots = [
			Object.freeze({
				workspaceId: "00000000-0000-4000-8000-000000000010",
				revision: 2,
				roots: Object.freeze([]),
			}),
			Object.freeze({
				workspaceId: "00000000-0000-4000-8000-000000000010",
				revision: 3,
				roots: Object.freeze([]),
			}),
		] satisfies WorkspaceSnapshot[];
		const calls: string[] = [];
		const workspaceRemoveRoot = vi.fn(async () => {
			calls.push("native-remove");
			return snapshots.shift()!;
		});
		const executeCommand = vi
			.fn()
			.mockImplementationOnce(async () => {
				calls.push("pick");
				return { uri: workspaceRootUri() };
			})
			.mockImplementationOnce(async () => {
				calls.push("pick");
				return { uri: workspaceRootUri(secondRootId) };
			})
			.mockImplementationOnce(async () => {
				calls.push("pick-cancel");
				return undefined;
			});
		const { accessor } = testCommandAccessor(executeCommand);
		const projectedSnapshots: WorkspaceSnapshot[] = [];
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				calls.push("queue");
				const mutationResult = await mutation();
				if (mutationResult.snapshot !== undefined) {
					projectedSnapshots.push(mutationResult.snapshot);
					calls.push("project");
				}
				return mutationResult.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerWorkspaceCommands(
			testBridge({ workspaceRemoveRoot }),
			testContextKeyService(),
			topologyCoordinator,
		);

		try {
			await CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.removeRootFolder,
			)?.handler(accessor as never, undefined);
			await CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
			)?.handler(accessor as never);
			const cancelled = await CommandsRegistry.getCommand(
				WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
			)?.handler(accessor as never);

			expect(cancelled).toBeUndefined();
			expect(executeCommand.mock.calls).toEqual([
				["_workbench.pickWorkspaceFolder"],
				["_workbench.pickWorkspaceFolder"],
				["_workbench.pickWorkspaceFolder"],
			]);
			expect(workspaceRemoveRoot.mock.calls).toEqual([
				[rootId],
				[secondRootId],
			]);
			expect(projectedSnapshots).toHaveLength(2);
			expect(calls).toEqual([
				"queue",
				"pick",
				"native-remove",
				"project",
				"queue",
				"pick",
				"native-remove",
				"project",
				"queue",
				"pick-cancel",
			]);
		} finally {
			registration.dispose();
		}
	});

	it("rejects non-URI, non-root, accessor and Proxy resources without native disclosure", async () => {
		let componentAccessorReads = 0;
		const accessorResource = workspaceRootUri();
		Object.defineProperty(accessorResource, "path", {
			configurable: true,
			enumerable: true,
			get() {
				componentAccessorReads += 1;
				return "/";
			},
		});
		let proxyReads = 0;
		const proxyResource = new Proxy(workspaceRootUri(), {
			get(target, property, receiver) {
				proxyReads += 1;
				return Reflect.get(target, property, receiver);
			},
		});
		const invalidResources: unknown[] = [
			{
				scheme: "plain-workspace",
				authority: rootId,
				path: "/",
				query: "",
				fragment: "",
			},
			workspaceRootUri(rootId, { scheme: "file" }),
			workspaceRootUri("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
			workspaceRootUri("00000000-0000-3000-8000-000000000001"),
			workspaceRootUri(rootId, { path: "/child" }),
			workspaceRootUri(rootId, { query: "private-secret" }),
			workspaceRootUri(rootId, { fragment: "private-secret" }),
			accessorResource,
			proxyResource,
		];
		const workspaceRemoveRoot = vi.fn();
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => mutation()),
		} as unknown as WorkspaceTopologyCoordinator;
		const { accessor, executeCommand } = testCommandAccessor();
		const registration = registerWorkspaceCommands(
			testBridge({ workspaceRemoveRoot }),
			testContextKeyService(),
			topologyCoordinator,
		);

		try {
			for (const resource of invalidResources) {
				await expect(
					CommandsRegistry.getCommand(
						WORKSPACE_COMMAND_IDS.removeRootFolder,
					)?.handler(accessor as never, resource),
				).rejects.toMatchObject({
					name: "PlainWorkspaceRootResourceInvalidError",
					code: PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID,
					message: "The workspace root URI is invalid.",
				});
			}
			expect(componentAccessorReads).toBe(0);
			expect(proxyReads).toBe(0);
			expect(executeCommand).not.toHaveBeenCalled();
			expect(workspaceRemoveRoot).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	it("rejects picker URI accessors and never reads unrelated folder getters", async () => {
		let folderAccessorReads = 0;
		const accessorFolder = Object.create(null);
		Object.defineProperty(accessorFolder, "uri", {
			enumerable: true,
			get() {
				folderAccessorReads += 1;
				return workspaceRootUri();
			},
		});
		let unrelatedGetterReads = 0;
		const selectedUri = workspaceRootUri();
		const folderWithUnrelatedGetter = { uri: selectedUri };
		Object.defineProperty(folderWithUnrelatedGetter, "name", {
			enumerable: true,
			get() {
				unrelatedGetterReads += 1;
				Object.defineProperty(selectedUri, "authority", {
					value: "00000000-0000-4000-8000-000000000002",
					writable: true,
					enumerable: true,
					configurable: true,
				});
				return "changed";
			},
		});
		const executeCommand = vi
			.fn()
			.mockResolvedValueOnce(accessorFolder)
			.mockResolvedValueOnce(folderWithUnrelatedGetter);
		const { accessor } = testCommandAccessor(executeCommand);
		const workspaceRemoveRoot = vi.fn(async () => ({
			workspaceId: "00000000-0000-4000-8000-000000000010",
			revision: 2,
			roots: [],
		}));
		const topologyCoordinator = {
			runMutation: vi.fn(
				async (mutation: TestTopologyMutation) => (await mutation()).result,
			),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerWorkspaceCommands(
			testBridge({ workspaceRemoveRoot }),
			testContextKeyService(),
			topologyCoordinator,
		);

		try {
			await expect(
				CommandsRegistry.getCommand(
					WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
				)?.handler(accessor as never),
			).rejects.toMatchObject({
				code: PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID,
				message: "The workspace root URI is invalid.",
			});
			await expect(
				CommandsRegistry.getCommand(
					WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
				)?.handler(accessor as never),
			).resolves.toBeUndefined();
			expect(folderAccessorReads).toBe(0);
			expect(unrelatedGetterReads).toBe(0);
			expect(workspaceRemoveRoot).toHaveBeenCalledOnce();
			expect(workspaceRemoveRoot).toHaveBeenCalledWith(rootId);
		} finally {
			registration.dispose();
		}
	});

	it("propagates an unknown-root native failure from inside the topology mutation", async () => {
		const unknownRoot = Object.freeze({
			code: "ROOT_NOT_AUTHORIZED",
			message: "The workspace root is not authorized.",
		});
		const workspaceRemoveRoot = vi.fn(async () => Promise.reject(unknownRoot));
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => mutation()),
		} as unknown as WorkspaceTopologyCoordinator;
		const { accessor, executeCommand } = testCommandAccessor();
		const registration = registerWorkspaceCommands(
			testBridge({ workspaceRemoveRoot }),
			testContextKeyService(),
			topologyCoordinator,
		);

		try {
			await expect(
				CommandsRegistry.getCommand(
					WORKSPACE_COMMAND_IDS.removeRootFolder,
				)?.handler(accessor as never, workspaceRootUri()),
			).rejects.toBe(unknownRoot);
			expect(workspaceRemoveRoot).toHaveBeenCalledOnce();
			expect(workspaceRemoveRoot).toHaveBeenCalledWith(rootId);
			expect(executeCommand).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	it("lets a fatal coordinator reject before picker, URI accessors or native mutations run", async () => {
		const workspacePickRoots = vi.fn();
		const workspaceRemoveRoot = vi.fn();
		const bridge = {
			workspacePickRoots,
			workspaceRemoveRoot,
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
		const fatal = Object.freeze({ code: "WORKSPACE_PROJECTION_FAILED" });
		const topologyCoordinator = {
			runMutation: vi.fn(async () => Promise.reject(fatal)),
		} as unknown as WorkspaceTopologyCoordinator;
		const executeCommand = vi.fn();
		const { accessor } = testCommandAccessor(executeCommand);
		let resourceAccessorReads = 0;
		const unreadableResource = workspaceRootUri();
		Object.defineProperty(unreadableResource, "path", {
			configurable: true,
			enumerable: true,
			get() {
				resourceAccessorReads += 1;
				return "/";
			},
		});
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
			await expect(
				CommandsRegistry.getCommand(
					WORKSPACE_COMMAND_IDS.removeRootFolder,
				)?.handler(accessor as never, unreadableResource),
			).rejects.toBe(fatal);
			await expect(
				CommandsRegistry.getCommand(
					WORKSPACE_COMMAND_IDS.removeRootFolderViaPicker,
				)?.handler(accessor as never),
			).rejects.toBe(fatal);
			expect(workspacePickRoots).not.toHaveBeenCalled();
			expect(executeCommand).not.toHaveBeenCalled();
			expect(resourceAccessorReads).toBe(0);
			expect(workspaceRemoveRoot).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});
});
