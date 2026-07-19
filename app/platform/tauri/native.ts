import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { RUNTIME_READY_EVENT, type PlainBridge } from "./contracts";
import {
	decodeRuntimeInfo,
	decodeWorkspaceEntryStat,
	decodeWorkspaceDeleteBatchPlan,
	decodeWorkspaceDeleteResult,
	decodeWorkspaceReadFile,
	decodeWorkspaceMoveResult,
	decodeWorkspacePickResult,
	decodeWorkspaceReadDirectory,
	decodeWorkspaceSnapshot,
	decodeWorkspaceVoid,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceCommitDeleteEntryRequest,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceDeleteBatchRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceMoveRequest,
	frozenWorkspacePrepareDeleteRequest,
	frozenWorkspaceRenameRequest,
} from "./workspace-codec";

export function createNativeBridge(): PlainBridge {
	return {
		runtimeInfo: async () =>
			decodeRuntimeInfo(await invoke<unknown>("runtime_info")),
		onRuntimeReady: async (listener) => {
			return listen<unknown>(RUNTIME_READY_EVENT, (event) =>
				listener(decodeRuntimeInfo(event.payload)),
			);
		},
		workspaceSnapshot: async () =>
			decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_snapshot", { request: {} }),
			),
		workspacePickRoots: async (mode) =>
			decodeWorkspacePickResult(
				await invoke<unknown>("workspace_pick_roots", {
					request: { mode },
				}),
			),
		workspaceRemoveRoot: async (rootId) =>
			decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_remove_root", {
					request: { rootId },
				}),
			),
		workspaceCreateFile: async (rootId, relativePath) => {
			const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_create_file", { request }),
			);
		},
		workspaceCreateDirectory: async (rootId, relativePath) => {
			const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_create_directory", { request }),
			);
		},
		workspaceRename: async (rootId, sourcePath, targetPath) => {
			const request = frozenWorkspaceRenameRequest(
				rootId,
				sourcePath,
				targetPath,
			);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_rename", { request }),
			);
		},
		workspaceCopy: async (
			sourceRootId,
			sourcePath,
			targetRootId,
			targetPath,
		) => {
			const request = frozenWorkspaceCopyRequest(
				sourceRootId,
				sourcePath,
				targetRootId,
				targetPath,
			);
			decodeWorkspaceVoid(await invoke<unknown>("workspace_copy", { request }));
		},
		workspaceMove: async (
			sourceRootId,
			sourcePath,
			targetRootId,
			targetPath,
		) => {
			const request = frozenWorkspaceMoveRequest(
				sourceRootId,
				sourcePath,
				targetRootId,
				targetPath,
			);
			return decodeWorkspaceMoveResult(
				await invoke<unknown>("workspace_move", { request }),
			);
		},
		workspacePrepareDelete: async (entries) => {
			const request = frozenWorkspacePrepareDeleteRequest(entries);
			return decodeWorkspaceDeleteBatchPlan(
				await invoke<unknown>("workspace_prepare_delete", { request }),
				request,
			);
		},
		workspaceCancelDelete: async (confirmationId) => {
			const request = frozenWorkspaceDeleteBatchRequest(confirmationId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_cancel_delete", { request }),
			);
		},
		workspaceBeginDelete: async (confirmationId) => {
			const request = frozenWorkspaceDeleteBatchRequest(confirmationId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_begin_delete", { request }),
			);
		},
		workspaceCommitDeleteEntry: async (
			confirmationId,
			entryId,
			rootId,
			relativePath,
			recursive,
		) => {
			const request = frozenWorkspaceCommitDeleteEntryRequest(
				confirmationId,
				entryId,
				rootId,
				relativePath,
				recursive,
			);
			return decodeWorkspaceDeleteResult(
				await invoke<unknown>("workspace_commit_delete_entry", { request }),
			);
		},
		workspaceStat: async (rootId, relativePath) => {
			const request = frozenWorkspaceEntryRequest(rootId, relativePath);
			return decodeWorkspaceEntryStat(
				await invoke<unknown>("workspace_stat", { request }),
			);
		},
		workspaceReadDirectory: async (rootId, relativePath) => {
			const request = frozenWorkspaceEntryRequest(rootId, relativePath);
			return decodeWorkspaceReadDirectory(
				await invoke<unknown>("workspace_read_dir", { request }),
				request.relativePath,
			);
		},
		workspaceReadFile: async (rootId, relativePath) => {
			const request = frozenWorkspaceEntryRequest(rootId, relativePath);
			return decodeWorkspaceReadFile(
				await invoke<ArrayBuffer | number[]>("workspace_read_file", {
					request,
				}),
			);
		},
	};
}
