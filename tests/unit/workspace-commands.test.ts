import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { ICommandService } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service";
import type { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { describe, expect, it, vi } from "vitest";

import {
	GUARDED_WORKSPACE_COMMAND_IDS,
	PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID,
	registerWorkspaceCommands,
	WORKSPACE_COMMAND_IDS,
} from "../../app/features/workspace/commands";
import {
	LOCAL_WORKSPACE_COMMAND_IDS,
	registerLocalWorkspaceCommands,
	reportInitialWorkspaceRestoreStatus,
} from "../../app/features/workspace/local-workflow-commands";
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
		windowCreate: vi.fn(),
		onRuntimeReady: vi.fn(),
		onNativeCloseRequested: vi.fn(),
		lifecycleCompleteClose: vi.fn(),
		lifecycleRequestClose: vi.fn(),
		userDataRead: vi.fn(),
		userDataWrite: vi.fn(),
		onUserDataChanged: vi.fn(),
		workspaceCapabilities: vi.fn(),
		workspaceSnapshot: vi.fn(),
		workspaceReconcileWatchRoots: vi.fn(),
		workspaceWatch: vi.fn(() => () => {}),
		workspacePickRoots: vi.fn(),
		workspaceOpenFiles: vi.fn(),
		workspacePickSaveTarget: vi.fn(),
		workspaceRecentList: vi.fn(),
		workspaceOpenRecent: vi.fn(),
		workspaceRemoveRecent: vi.fn(),
		workspaceClearRecent: vi.fn(),
		workspaceRemoveRoot: vi.fn(),
		workspaceCloseFolder: vi.fn(),
		workspaceCreateFile: vi.fn(),
		workspaceCreateDirectory: vi.fn(),
		workspaceRename: vi.fn(),
		workspaceCopy: vi.fn(),
		workspaceMove: vi.fn(),
		workspacePrepareDelete: vi.fn(),
		workspaceCancelDelete: vi.fn(),
		workspaceBeginDelete: vi.fn(),
		workspaceCommitDeleteEntry: vi.fn(),
		workspacePrepareTrash: vi.fn(),
		workspaceCancelTrash: vi.fn(),
		workspaceBeginTrash: vi.fn(),
		workspaceCommitTrashEntry: vi.fn(),
		workspaceStat: vi.fn(),
		workspaceReadDirectory: vi.fn(),
		workspaceReadFile: vi.fn(),
		workspaceWriteFile: vi.fn(),
		workspacePublishFile: vi.fn(),
		workspaceSearchFiles: vi.fn(),
		workspaceSearchTextStart: vi.fn(),
		workspaceSearchTextPoll: vi.fn(),
		workspaceSearchTextCancel: vi.fn(),
		workspaceSearchTextWatch: vi.fn(() => () => {}),
		workspaceSearchExpandReplacements: vi.fn(),
		backupWrite: vi.fn(),
		backupReadAll: vi.fn(),
		backupDiscard: vi.fn(),
		backupDiscardAll: vi.fn(),
		scratchCreate: vi.fn(),
		scratchWrite: vi.fn(),
		scratchReadAll: vi.fn(),
		scratchDiscard: vi.fn(),
		scratchDiscardAll: vi.fn(),
		themeImportVsix: vi.fn(),
		themeImportDirectory: vi.fn(),
		themeList: vi.fn(),
		themeReadResource: vi.fn(),
		themeRemove: vi.fn(),
		themeGetSelection: vi.fn(),
		themeSetSelection: vi.fn(),
		themeSetFileIconThemeSelection: vi.fn(),
		themeSetProductIconThemeSelection: vi.fn(),
		terminalProfiles: vi.fn(),
		terminalStart: vi.fn(),
		terminalInputText: vi.fn(),
		terminalInputKey: vi.fn(),
		terminalFocus: vi.fn(),
		terminalResize: vi.fn(),
		terminalAck: vi.fn(),
		terminalScrollback: vi.fn(),
		terminalKill: vi.fn(),
		terminalOpenExternalLink: vi.fn(),
		terminalLifecycleMarker: vi.fn(),
		terminalWatchData: vi.fn(),
		terminalWatchExit: vi.fn(),
		workspaceTrustState: vi.fn(),
		workspaceTrustGrant: vi.fn(),
		workspaceTrustRevoke: vi.fn(),
		gitStatus: vi.fn(),
		gitDiffFiles: vi.fn(),
		gitShowBlob: vi.fn(),
		gitStagePaths: vi.fn(),
		gitUnstagePaths: vi.fn(),
		gitStageBlob: vi.fn(),
		gitCommit: vi.fn(),
		gitDiscardPaths: vi.fn(),
		gitNetworkPreview: vi.fn(),
		gitFetch: vi.fn(),
		gitPull: vi.fn(),
		gitPush: vi.fn(),
		gitNetworkCancel: vi.fn(),
		gitBlameFile: vi.fn(),
		gitBlameCommitMessages: vi.fn(),
		gitFileHistory: vi.fn(),
		gitLineHistoryList: vi.fn(),
		gitLineHistoryDetail: vi.fn(),
		gitShowCommit: vi.fn(),
		gitShowCommitBlob: vi.fn(),
		gitLogGraph: vi.fn(),
		gitRefsList: vi.fn(),
		gitRemotesList: vi.fn(),
		gitReflogList: vi.fn(),
		gitContributorsList: vi.fn(),
		gitBranchCreate: vi.fn(),
		gitBranchSwitch: vi.fn(),
		gitBranchRename: vi.fn(),
		gitBranchDelete: vi.fn(),
		gitTagCreate: vi.fn(),
		gitTagDelete: vi.fn(),
		gitRemoteAdd: vi.fn(),
		gitRemoteRename: vi.fn(),
		gitRemoteSetUrl: vi.fn(),
		gitRemoteRemove: vi.fn(),
		gitUpstreamSet: vi.fn(),
		gitUpstreamUnset: vi.fn(),
		gitHistoryState: vi.fn(),
		gitHistoryPreview: vi.fn(),
		gitMerge: vi.fn(),
		gitRebase: vi.fn(),
		gitCherryPick: vi.fn(),
		gitRevert: vi.fn(),
		gitReset: vi.fn(),
		gitHistoryContinue: vi.fn(),
		gitHistoryAbort: vi.fn(),
		gitHistoryCancel: vi.fn(),
		gitStashList: vi.fn(),
		gitStashShow: vi.fn(),
		gitStashPush: vi.fn(),
		gitStashApply: vi.fn(),
		gitStashPop: vi.fn(),
		gitStashDrop: vi.fn(),
		gitWorktreeList: vi.fn(),
		gitWorktreeAdd: vi.fn(),
		gitWorktreeRemove: vi.fn(),
		debugAdapterConfirmationState: vi.fn(),
		debugAdapterConfirmationGrant: vi.fn(),
		debugAdapterConfirmationRevoke: vi.fn(),
		debugLaunch: vi.fn(),
		debugAttach: vi.fn(),
		debugDisconnect: vi.fn(),
		debugSetBreakpoints: vi.fn(),
		debugStackTrace: vi.fn(),
		debugScopes: vi.fn(),
		debugVariables: vi.fn(),
		debugEvaluate: vi.fn(),
		debugContinue: vi.fn(),
		debugNext: vi.fn(),
		debugStepIn: vi.fn(),
		debugStepInTargets: vi.fn(),
		debugStepOut: vi.fn(),
		debugPause: vi.fn(),
		debugDisassemble: vi.fn(),
		debugOutputAck: vi.fn(),
		debugWatchEvent: vi.fn(),
		remoteSessionConnect: vi.fn(),
		remoteHostKeyConfirm: vi.fn(),
		remoteSessionConnectCancel: vi.fn(),
		remoteSessionDisconnect: vi.fn(),
		remoteSessionState: vi.fn(),
		remoteHostKeyForget: vi.fn(),
		remoteHostKeyList: vi.fn(),
		remoteSessionWatchEvent: vi.fn(),
		remoteWorkspacePickDirectory: vi.fn(),
		remoteWorkspaceAddRoot: vi.fn(),
		remoteWorkspaceReconnectRoot: vi.fn(),
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

function testServiceAccessor(services: ReadonlyMap<unknown, unknown>) {
	return {
		get(service: unknown) {
			if (!services.has(service)) {
				throw new Error("unexpected service token requested");
			}
			return services.get(service);
		},
	};
}

function testNotificationService() {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
			windowCreate: vi.fn(),
			onRuntimeReady: vi.fn(),
			onNativeCloseRequested: vi.fn(),
			lifecycleCompleteClose: vi.fn(),
			lifecycleRequestClose: vi.fn(),
			userDataRead: vi.fn(),
			userDataWrite: vi.fn(),
			onUserDataChanged: vi.fn(),
			workspaceCapabilities: vi.fn(),
			workspaceSnapshot: vi.fn(),
			workspaceReconcileWatchRoots: vi.fn(),
			workspaceWatch: vi.fn(() => () => {}),
			workspacePickRoots,
			workspaceOpenFiles: vi.fn(),
			workspacePickSaveTarget: vi.fn(),
			workspaceRecentList: vi.fn(),
			workspaceOpenRecent: vi.fn(),
			workspaceRemoveRecent: vi.fn(),
			workspaceClearRecent: vi.fn(),
			workspaceRemoveRoot: vi.fn(),
			workspaceCloseFolder: vi.fn(),
			workspaceCreateFile: vi.fn(),
			workspaceCreateDirectory: vi.fn(),
			workspaceRename: vi.fn(),
			workspaceCopy: vi.fn(),
			workspaceMove: vi.fn(),
			workspacePrepareDelete: vi.fn(),
			workspaceCancelDelete: vi.fn(),
			workspaceBeginDelete: vi.fn(),
			workspaceCommitDeleteEntry: vi.fn(),
			workspacePrepareTrash: vi.fn(),
			workspaceCancelTrash: vi.fn(),
			workspaceBeginTrash: vi.fn(),
			workspaceCommitTrashEntry: vi.fn(),
			workspaceStat: vi.fn(),
			workspaceReadDirectory: vi.fn(),
			workspaceReadFile: vi.fn(),
			workspaceWriteFile: vi.fn(),
			workspacePublishFile: vi.fn(),
			workspaceSearchFiles: vi.fn(),
			workspaceSearchTextStart: vi.fn(),
			workspaceSearchTextPoll: vi.fn(),
			workspaceSearchTextCancel: vi.fn(),
			workspaceSearchTextWatch: vi.fn(() => () => {}),
			workspaceSearchExpandReplacements: vi.fn(),
			backupWrite: vi.fn(),
			backupReadAll: vi.fn(),
			backupDiscard: vi.fn(),
			backupDiscardAll: vi.fn(),
			scratchCreate: vi.fn(),
			scratchWrite: vi.fn(),
			scratchReadAll: vi.fn(),
			scratchDiscard: vi.fn(),
			scratchDiscardAll: vi.fn(),
			themeImportVsix: vi.fn(),
			themeImportDirectory: vi.fn(),
			themeList: vi.fn(),
			themeReadResource: vi.fn(),
			themeRemove: vi.fn(),
			themeGetSelection: vi.fn(),
			themeSetSelection: vi.fn(),
			themeSetFileIconThemeSelection: vi.fn(),
			themeSetProductIconThemeSelection: vi.fn(),
			terminalProfiles: vi.fn(),
			terminalStart: vi.fn(),
			terminalInputText: vi.fn(),
			terminalInputKey: vi.fn(),
			terminalFocus: vi.fn(),
			terminalResize: vi.fn(),
			terminalAck: vi.fn(),
			terminalScrollback: vi.fn(),
			terminalKill: vi.fn(),
			terminalOpenExternalLink: vi.fn(),
			terminalLifecycleMarker: vi.fn(),
			terminalWatchData: vi.fn(),
			terminalWatchExit: vi.fn(),
			workspaceTrustState: vi.fn(),
			workspaceTrustGrant: vi.fn(),
			workspaceTrustRevoke: vi.fn(),
			gitStatus: vi.fn(),
			gitDiffFiles: vi.fn(),
			gitShowBlob: vi.fn(),
			gitStagePaths: vi.fn(),
			gitUnstagePaths: vi.fn(),
			gitStageBlob: vi.fn(),
			gitCommit: vi.fn(),
			gitDiscardPaths: vi.fn(),
			gitNetworkPreview: vi.fn(),
			gitFetch: vi.fn(),
			gitPull: vi.fn(),
			gitPush: vi.fn(),
			gitNetworkCancel: vi.fn(),
			gitBlameFile: vi.fn(),
			gitBlameCommitMessages: vi.fn(),
			gitFileHistory: vi.fn(),
			gitLineHistoryList: vi.fn(),
			gitLineHistoryDetail: vi.fn(),
			gitShowCommit: vi.fn(),
			gitShowCommitBlob: vi.fn(),
			gitLogGraph: vi.fn(),
			gitRefsList: vi.fn(),
			gitRemotesList: vi.fn(),
			gitReflogList: vi.fn(),
			gitContributorsList: vi.fn(),
			gitBranchCreate: vi.fn(),
			gitBranchSwitch: vi.fn(),
			gitBranchRename: vi.fn(),
			gitBranchDelete: vi.fn(),
			gitTagCreate: vi.fn(),
			gitTagDelete: vi.fn(),
			gitRemoteAdd: vi.fn(),
			gitRemoteRename: vi.fn(),
			gitRemoteSetUrl: vi.fn(),
			gitRemoteRemove: vi.fn(),
			gitUpstreamSet: vi.fn(),
			gitUpstreamUnset: vi.fn(),
			gitHistoryState: vi.fn(),
			gitHistoryPreview: vi.fn(),
			gitMerge: vi.fn(),
			gitRebase: vi.fn(),
			gitCherryPick: vi.fn(),
			gitRevert: vi.fn(),
			gitReset: vi.fn(),
			gitHistoryContinue: vi.fn(),
			gitHistoryAbort: vi.fn(),
			gitHistoryCancel: vi.fn(),
			gitStashList: vi.fn(),
			gitStashShow: vi.fn(),
			gitStashPush: vi.fn(),
			gitStashApply: vi.fn(),
			gitStashPop: vi.fn(),
			gitStashDrop: vi.fn(),
			gitWorktreeList: vi.fn(),
			gitWorktreeAdd: vi.fn(),
			gitWorktreeRemove: vi.fn(),
			debugAdapterConfirmationState: vi.fn(),
			debugAdapterConfirmationGrant: vi.fn(),
			debugAdapterConfirmationRevoke: vi.fn(),
			debugLaunch: vi.fn(),
			debugAttach: vi.fn(),
			debugDisconnect: vi.fn(),
			debugSetBreakpoints: vi.fn(),
			debugStackTrace: vi.fn(),
			debugScopes: vi.fn(),
			debugVariables: vi.fn(),
			debugEvaluate: vi.fn(),
			debugContinue: vi.fn(),
			debugNext: vi.fn(),
			debugStepIn: vi.fn(),
			debugStepInTargets: vi.fn(),
			debugStepOut: vi.fn(),
			debugPause: vi.fn(),
			debugDisassemble: vi.fn(),
			debugOutputAck: vi.fn(),
			debugWatchEvent: vi.fn(),
			remoteSessionConnect: vi.fn(),
			remoteHostKeyConfirm: vi.fn(),
			remoteSessionConnectCancel: vi.fn(),
			remoteSessionDisconnect: vi.fn(),
			remoteSessionState: vi.fn(),
			remoteHostKeyForget: vi.fn(),
			remoteHostKeyList: vi.fn(),
			remoteSessionWatchEvent: vi.fn(),
			remoteWorkspacePickDirectory: vi.fn(),
			remoteWorkspaceAddRoot: vi.fn(),
			remoteWorkspaceReconnectRoot: vi.fn(),
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

	it("creates an isolated window and flushes before atomically closing the current folder", async () => {
		const calls: string[] = [];
		const finalSnapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000010",
			revision: 2,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const windowCreate = vi.fn(async () => {
			calls.push("new-window");
		});
		const workspaceCloseFolder = vi.fn(async () => {
			calls.push("native-close-folder");
			return finalSnapshot;
		});
		const flushWorkingCopyBackups = vi.fn(async () => {
			calls.push("stable-backup");
		});
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				calls.push("queue");
				const result = await mutation();
				expect(result.snapshot).toBe(finalSnapshot);
				calls.push("project");
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({ windowCreate, workspaceCloseFolder }),
			topologyCoordinator,
			flushWorkingCopyBackups,
		);
		const accessor = testServiceAccessor(
			new Map([[INotificationService, notificationService]]),
		);

		try {
			expect(Object.values(LOCAL_WORKSPACE_COMMAND_IDS)).toEqual([
				"workbench.action.files.openFile",
				"workbench.action.openRecent",
				"workbench.action.quickOpenRecent",
				"workbench.action.clearRecentFiles",
				"workbench.action.newWindow",
				"workbench.action.closeFolder",
			]);
			expect(GUARDED_WORKSPACE_COMMAND_IDS).not.toContain(
				LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
			);
			expect(GUARDED_WORKSPACE_COMMAND_IDS).not.toContain(
				LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			);

			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
			)?.handler(accessor as never);
			expect(topologyCoordinator.runMutation).not.toHaveBeenCalled();
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			)?.handler(accessor as never);

			expect(calls).toEqual([
				"new-window",
				"queue",
				"stable-backup",
				"native-close-folder",
				"project",
			]);
			expect(windowCreate).toHaveBeenCalledOnce();
			expect(workspaceCloseFolder).toHaveBeenCalledOnce();
			expect(notificationService.error).not.toHaveBeenCalled();

			for (const menuId of [MenuId.CommandPalette, MenuId.MenubarFileMenu]) {
				const commandIds = MenuRegistry.getMenuItems(menuId).flatMap((item) =>
					"command" in item ? [item.command.id] : [],
				);
				expect(commandIds).toContain(LOCAL_WORKSPACE_COMMAND_IDS.newWindow);
				expect(commandIds).toContain(LOCAL_WORKSPACE_COMMAND_IDS.closeFolder);
			}
		} finally {
			registration.dispose();
		}
	});

	it("keeps native topology untouched when the stable backup flush fails", async () => {
		const flushFailure = Object.freeze({
			code: "PLAIN_WORKING_COPY_BACKUP_FLUSH_FAILED",
			message: "Plain could not preserve every modified file. Try again.",
		});
		const workspaceCloseFolder = vi.fn();
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => mutation()),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({ workspaceCloseFolder }),
			topologyCoordinator,
			vi.fn(async () => Promise.reject(flushFailure)),
		);
		const accessor = testServiceAccessor(
			new Map([[INotificationService, notificationService]]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			)?.handler(accessor as never);
			expect(workspaceCloseFolder).not.toHaveBeenCalled();
			expect(notificationService.error).toHaveBeenCalledExactlyOnceWith(
				flushFailure.message,
			);
		} finally {
			registration.dispose();
		}
	});

	it("reports fixed new-window and native close failures without retrying", async () => {
		const windowCreate = vi.fn(async () =>
			Promise.reject({
				code: "WINDOW_CREATE_FAILED",
				message: "The Plain window could not be created.",
			}),
		);
		const workspaceCloseFolder = vi.fn(async () =>
			Promise.reject({
				code: "WORKSPACE_CONFLICT",
				message: "The workspace changed before it could be closed.",
			}),
		);
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => mutation()),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({ windowCreate, workspaceCloseFolder }),
			topologyCoordinator,
			vi.fn(async () => undefined),
		);
		const accessor = testServiceAccessor(
			new Map([[INotificationService, notificationService]]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.newWindow,
			)?.handler(accessor as never);
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.closeFolder,
			)?.handler(accessor as never);
			expect(windowCreate).toHaveBeenCalledOnce();
			expect(workspaceCloseFolder).toHaveBeenCalledOnce();
			expect(notificationService.error.mock.calls).toEqual([
				["The Plain window could not be created."],
				["The workspace changed before it could be closed."],
			]);
		} finally {
			registration.dispose();
		}
	});

	it("opens selected files only after their adopted workspace snapshot is projected and treats cancellation as a no-op", async () => {
		const snapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000010",
			revision: 4,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const calls: string[] = [];
		const workspaceOpenFiles = vi
			.fn()
			.mockImplementationOnce(async () => {
				calls.push("native-selected");
				return Object.freeze({
					status: "selected" as const,
					snapshot,
					files: Object.freeze([
						Object.freeze({ rootId, relativePath: "docs/README.md" }),
					]),
				});
			})
			.mockImplementationOnce(async () => {
				calls.push("native-cancelled");
				return Object.freeze({
					status: "cancelled" as const,
					snapshot,
					files: Object.freeze([]),
				});
			});
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const result = await mutation();
				if (result.snapshot !== undefined) calls.push("projected");
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const editorService = {
			openEditors: vi.fn(async (_editors: readonly { resource: URI }[]) => {
				calls.push("editors-opened");
			}),
		};
		const notificationService = testNotificationService();
		const bridge = testBridge({ workspaceOpenFiles });
		const registration = registerLocalWorkspaceCommands(
			bridge,
			topologyCoordinator,
		);
		const accessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IEditorService, editorService],
				[INotificationService, notificationService],
			]),
		);

		try {
			expect(
				MenuRegistry.getMenuItems(MenuId.CommandPalette).some(
					(item) =>
						"command" in item &&
						item.command.id === LOCAL_WORKSPACE_COMMAND_IDS.openFile,
				),
			).toBe(true);
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openFile,
			)?.handler(accessor as never);
			expect(calls).toEqual(["native-selected", "projected", "editors-opened"]);
			const resource =
				editorService.openEditors.mock.calls[0]?.[0][0]?.resource;
			expect(resource).toMatchObject({
				scheme: "plain-workspace",
				authority: rootId,
				path: "/docs/README.md",
			});

			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openFile,
			)?.handler(accessor as never);
			expect(editorService.openEditors).toHaveBeenCalledOnce();
			expect(topologyCoordinator.runMutation).toHaveBeenCalledTimes(2);
			expect(calls).toEqual([
				"native-selected",
				"projected",
				"editors-opened",
				"native-cancelled",
			]);
			expect(notificationService.error).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	it("opens a recent workspace by opaque id and removes an entry only after native success", async () => {
		const snapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000011",
			revision: 8,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const entry = Object.freeze({
			recentId: "00000000-0000-4000-8000-000000000099",
			label: "alpha + 1 folders",
			rootLabels: Object.freeze(["alpha", "beta"]),
			remoteRoots: Object.freeze([]),
		});
		const workspaceRecentList = vi.fn(async () =>
			Object.freeze({
				revision: 3,
				restoreStatus: "restored" as const,
				entries: Object.freeze([entry]),
			}),
		);
		const workspaceOpenRecent = vi.fn(async () => snapshot);
		const workspaceRemoveRecent = vi.fn(async () => undefined);
		let lastItems: readonly (typeof entry & {
			readonly buttons: readonly unknown[];
		})[] = [];
		let lastOptions: {
			onDidTriggerItemButton?: (context: {
				button: unknown;
				item: (typeof lastItems)[number];
				removeItem(): void;
			}) => Promise<void>;
		} = {};
		const quickInputService = {
			pick: vi.fn(async (items, options) => {
				lastItems = items;
				lastOptions = options;
				return items[0];
			}),
		};
		const projected: WorkspaceSnapshot[] = [];
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const result = await mutation();
				if (result.snapshot !== undefined) projected.push(result.snapshot);
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({
				workspaceRecentList,
				workspaceOpenRecent,
				workspaceRemoveRecent,
			}),
			topologyCoordinator,
		);
		const accessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IQuickInputService, quickInputService],
				[INotificationService, notificationService],
			]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			)?.handler(accessor as never);
			expect(workspaceOpenRecent).toHaveBeenCalledWith(entry.recentId);
			expect(projected).toEqual([snapshot]);
			expect(lastItems).toHaveLength(1);
			expect(lastItems[0]).toMatchObject({
				label: entry.label,
				description: "alpha · beta",
				recentId: entry.recentId,
			});
			expect(JSON.stringify(lastItems)).not.toContain("/Users/");

			const removeItem = vi.fn();
			await lastOptions.onDidTriggerItemButton?.({
				button: lastItems[0]!.buttons[0],
				item: lastItems[0]!,
				removeItem,
			});
			expect(workspaceRemoveRecent).toHaveBeenCalledWith(entry.recentId);
			expect(removeItem).toHaveBeenCalledOnce();
			expect(notificationService.error).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	// `F220` S4 (ADR 0007 §4)
	it("invokes onRecentRemoteRootsSelected with a picked entry's remote roots, after the local half opens", async () => {
		const snapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000011",
			revision: 8,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const remoteRoot = Object.freeze({
			host: "build.example.com",
			port: 2222,
			user: "dev",
			path: "/srv/project",
			label: "project",
		});
		const entry = Object.freeze({
			recentId: "00000000-0000-4000-8000-000000000099",
			label: "project",
			rootLabels: Object.freeze([]),
			remoteRoots: Object.freeze([remoteRoot]),
		});
		const workspaceRecentList = vi.fn(async () =>
			Object.freeze({
				revision: 3,
				restoreStatus: "restored" as const,
				entries: Object.freeze([entry]),
			}),
		);
		const workspaceOpenRecent = vi.fn(async () => snapshot);
		const callOrder: string[] = [];
		workspaceOpenRecent.mockImplementation(async () => {
			callOrder.push("workspaceOpenRecent");
			return snapshot;
		});
		const onRecentRemoteRootsSelected = vi.fn(async (remoteRoots) => {
			callOrder.push("onRecentRemoteRootsSelected");
			expect(remoteRoots).toEqual([remoteRoot]);
		});
		const quickInputService = {
			pick: vi.fn(async (items) => items[0]),
		};
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const result = await mutation();
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({ workspaceRecentList, workspaceOpenRecent }),
			topologyCoordinator,
			async () => {},
			onRecentRemoteRootsSelected,
		);
		const accessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IQuickInputService, quickInputService],
				[INotificationService, notificationService],
			]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			)?.handler(accessor as never);
			expect(onRecentRemoteRootsSelected).toHaveBeenCalledExactlyOnceWith([
				remoteRoot,
			]);
			expect(callOrder).toEqual([
				"workspaceOpenRecent",
				"onRecentRemoteRootsSelected",
			]);
			expect(notificationService.error).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	// `F220` S4
	it("never invokes onRecentRemoteRootsSelected for a purely local Recent entry", async () => {
		const snapshot = Object.freeze({
			workspaceId: "00000000-0000-4000-8000-000000000011",
			revision: 8,
			roots: Object.freeze([]),
		}) satisfies WorkspaceSnapshot;
		const entry = Object.freeze({
			recentId: "00000000-0000-4000-8000-000000000099",
			label: "alpha",
			rootLabels: Object.freeze(["alpha"]),
			remoteRoots: Object.freeze([]),
		});
		const workspaceRecentList = vi.fn(async () =>
			Object.freeze({
				revision: 3,
				restoreStatus: "restored" as const,
				entries: Object.freeze([entry]),
			}),
		);
		const workspaceOpenRecent = vi.fn(async () => snapshot);
		const onRecentRemoteRootsSelected = vi.fn(async () => {});
		const quickInputService = {
			pick: vi.fn(async (items) => items[0]),
		};
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const result = await mutation();
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const notificationService = testNotificationService();
		const registration = registerLocalWorkspaceCommands(
			testBridge({ workspaceRecentList, workspaceOpenRecent }),
			topologyCoordinator,
			async () => {},
			onRecentRemoteRootsSelected,
		);
		const accessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IQuickInputService, quickInputService],
				[INotificationService, notificationService],
			]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			)?.handler(accessor as never);
			expect(onRecentRemoteRootsSelected).not.toHaveBeenCalled();
		} finally {
			registration.dispose();
		}
	});

	it("keeps empty, dismissed, failed-remove and clear-history branches side-effect safe", async () => {
		const entry = Object.freeze({
			recentId: "00000000-0000-4000-8000-000000000098",
			label: "alpha",
			rootLabels: Object.freeze(["alpha"]),
			remoteRoots: Object.freeze([]),
		});
		const workspaceRecentList = vi
			.fn()
			.mockResolvedValueOnce({
				revision: 0,
				restoreStatus: "none",
				entries: [],
			})
			.mockResolvedValueOnce({
				revision: 1,
				restoreStatus: "none",
				entries: [entry],
			})
			.mockResolvedValueOnce({
				revision: 1,
				restoreStatus: "none",
				entries: [entry],
			});
		let buttonContext:
			| {
					onDidTriggerItemButton?: (context: {
						button: unknown;
						item: { recentId: string; buttons: readonly unknown[] };
						removeItem(): void;
					}) => Promise<void>;
			  }
			| undefined;
		let items: readonly {
			recentId: string;
			buttons: readonly unknown[];
		}[] = [];
		const quickInputService = {
			pick: vi.fn(async (nextItems, options) => {
				items = nextItems;
				buttonContext = options;
				return undefined;
			}),
		};
		const removeFailure = new Error("remove failed");
		const workspaceRemoveRecent = vi.fn(async () =>
			Promise.reject(removeFailure),
		);
		const workspaceOpenRecent = vi.fn();
		const workspaceClearRecent = vi.fn(async () => undefined);
		const notificationService = testNotificationService();
		const dialogService = {
			confirm: vi
				.fn()
				.mockResolvedValueOnce({ confirmed: false })
				.mockResolvedValueOnce({ confirmed: true }),
		};
		const topologyCoordinator = {
			runMutation: vi.fn(async (mutation: TestTopologyMutation) => {
				const result = await mutation();
				return result.result;
			}),
		} as unknown as WorkspaceTopologyCoordinator;
		const registration = registerLocalWorkspaceCommands(
			testBridge({
				workspaceRecentList,
				workspaceOpenRecent,
				workspaceRemoveRecent,
				workspaceClearRecent,
			}),
			topologyCoordinator,
		);
		const recentAccessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IQuickInputService, quickInputService],
				[INotificationService, notificationService],
			]),
		);
		const clearAccessor = testServiceAccessor(
			new Map<unknown, unknown>([
				[IDialogService, dialogService],
				[INotificationService, notificationService],
			]),
		);

		try {
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			)?.handler(recentAccessor as never);
			expect(notificationService.info).toHaveBeenCalledWith(
				"Plain: there are no recent workspaces.",
			);
			expect(quickInputService.pick).not.toHaveBeenCalled();

			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.quickOpenRecent,
			)?.handler(recentAccessor as never);
			expect(workspaceOpenRecent).not.toHaveBeenCalled();
			expect(topologyCoordinator.runMutation).not.toHaveBeenCalled();

			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.openRecent,
			)?.handler(recentAccessor as never);
			const removeItem = vi.fn();
			await buttonContext?.onDidTriggerItemButton?.({
				button: items[0]!.buttons[0],
				item: items[0]!,
				removeItem,
			});
			expect(removeItem).not.toHaveBeenCalled();
			expect(notificationService.error).toHaveBeenCalledWith("remove failed");

			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.clearRecent,
			)?.handler(clearAccessor as never);
			expect(workspaceClearRecent).not.toHaveBeenCalled();
			await CommandsRegistry.getCommand(
				LOCAL_WORKSPACE_COMMAND_IDS.clearRecent,
			)?.handler(clearAccessor as never);
			expect(workspaceClearRecent).toHaveBeenCalledOnce();
			expect(dialogService.confirm).toHaveBeenLastCalledWith(
				expect.objectContaining({
					detail: expect.stringContaining(
						"does not delete any files or folders",
					),
				}),
			);
		} finally {
			registration.dispose();
		}
	});

	it("reports only failed initial restore state while normal states stay quiet", async () => {
		const notificationService = testNotificationService();
		await reportInitialWorkspaceRestoreStatus(
			testBridge({
				workspaceRecentList: vi.fn(async () => ({
					revision: 1,
					restoreStatus: "restored" as const,
					entries: [],
				})),
			}),
			notificationService as unknown as INotificationService,
		);
		expect(notificationService.warn).not.toHaveBeenCalled();

		await reportInitialWorkspaceRestoreStatus(
			testBridge({
				workspaceRecentList: vi.fn(async () => ({
					revision: 2,
					restoreStatus: "failed" as const,
					entries: [],
				})),
			}),
			notificationService as unknown as INotificationService,
		);
		expect(notificationService.warn).toHaveBeenCalledOnce();
		expect(notificationService.warn).toHaveBeenCalledWith(
			"Plain could not restore the last workspace. Use Open Recent to retry.",
		);
	});
});
