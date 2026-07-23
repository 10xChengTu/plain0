import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
	RUNTIME_READY_EVENT,
	WORKSPACE_SEARCH_TEXT_WAKE_EVENT,
	WORKSPACE_WATCH_WAKE_EVENT,
	type PlainBridge,
} from "./contracts";
import {
	decodeBackupReadAllResult,
	decodeBackupVoid,
	encodeBackupWriteRequest,
	frozenBackupDiscardRequest,
} from "./backup-codec";
import {
	decodeRuntimeInfo,
	decodeWorkspaceCapabilities,
	decodeWorkspaceEntryStat,
	decodeWorkspaceDeleteBatchPlan,
	decodeWorkspaceDeleteResult,
	decodeWorkspaceReadFile,
	decodeWorkspaceWritePrepublicationError,
	decodeWorkspaceWriteResult,
	decodeWorkspaceMoveResult,
	decodeWorkspacePickResult,
	decodeWorkspaceReadDirectory,
	decodeWorkspaceSnapshot,
	decodeWorkspaceVoid,
	decodeWorkspaceWatchSyncResult,
	decodeWorkspaceWatchWakeEvent,
	encodeWorkspaceWriteFileRequest,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceCommitDeleteEntryRequest,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceDeleteBatchRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceMoveRequest,
	frozenWorkspacePrepareDeleteRequest,
	frozenWorkspaceRenameRequest,
	frozenWorkspaceWatchSyncRequest,
	workspaceWriteResponseUnavailable,
} from "./workspace-codec";
import { createWorkspaceWatcherManager } from "./workspace-watcher";
import {
	decodeWorkspaceSearchFilesResult,
	decodeWorkspaceSearchTextPollResult,
	decodeWorkspaceSearchTextStartResult,
	decodeWorkspaceSearchTextWakeEvent,
	frozenWorkspaceSearchFilesRequest,
	frozenWorkspaceSearchTextCancelRequest,
	frozenWorkspaceSearchTextPollRequest,
	frozenWorkspaceSearchTextStartRequest,
} from "./search-codec";
import {
	decodeThemeImportResult,
	decodeThemeListResult,
	decodeThemeReadResourceBytes,
	decodeThemeSelectionResult,
	decodeThemeVoid,
	frozenThemeReadResourceRequest,
	frozenThemeRemoveRequest,
	frozenThemeSetSelectionRequest,
} from "./theme-codec";

export function createNativeBridge(): PlainBridge {
	const workspaceWatcher = createWorkspaceWatcherManager({
		listenWake: async (listener) =>
			listen<unknown>(WORKSPACE_WATCH_WAKE_EVENT, (event) =>
				listener(decodeWorkspaceWatchWakeEvent(event.payload)),
			),
		sync: async ({ roots }) => {
			const request = frozenWorkspaceWatchSyncRequest(roots);
			return decodeWorkspaceWatchSyncResult(
				await invoke<unknown>("workspace_watch_sync", { request }),
				request,
			);
		},
	});
	return {
		runtimeInfo: async () =>
			decodeRuntimeInfo(await invoke<unknown>("runtime_info")),
		onRuntimeReady: async (listener) => {
			return listen<unknown>(RUNTIME_READY_EVENT, (event) =>
				listener(decodeRuntimeInfo(event.payload)),
			);
		},
		workspaceCapabilities: async () =>
			decodeWorkspaceCapabilities(
				await invoke<unknown>("workspace_capabilities", { request: {} }),
			),
		workspaceSnapshot: async () =>
			decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_snapshot", { request: {} }),
			),
		workspaceReconcileWatchRoots: workspaceWatcher.reconcileRoots,
		workspaceWatch: workspaceWatcher.workspaceWatch,
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
			return decodeWorkspaceEntryStat(
				await invoke<unknown>("workspace_create_file", { request }),
			);
		},
		workspaceCreateDirectory: async (rootId, relativePath) => {
			const request = frozenWorkspaceCreateEntryRequest(rootId, relativePath);
			return decodeWorkspaceEntryStat(
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
		workspaceWriteFile: async (
			rootId,
			relativePath,
			expectedVersion,
			content,
		) => {
			const frame = encodeWorkspaceWriteFileRequest(
				rootId,
				relativePath,
				expectedVersion,
				content,
			);
			const expectedContentLength =
				frame[10]! * 0x1_00_00_00 +
				frame[11]! * 0x1_00_00 +
				frame[12]! * 0x1_00 +
				frame[13]!;
			try {
				return decodeWorkspaceWriteResult(
					await invoke<unknown>("workspace_write_file", frame),
					expectedVersion,
					expectedContentLength,
				);
			} catch (error) {
				const commandError = decodeWorkspaceWritePrepublicationError(error);
				if (commandError !== undefined) {
					throw commandError;
				}
				return workspaceWriteResponseUnavailable();
			}
		},
		workspaceSearchFiles: async (
			roots,
			filePattern,
			excludeGlobs,
			maxResults,
		) => {
			const request = frozenWorkspaceSearchFilesRequest(
				roots,
				filePattern,
				excludeGlobs,
				maxResults,
			);
			return decodeWorkspaceSearchFilesResult(
				await invoke<unknown>("workspace_search_files", { request }),
			);
		},
		workspaceSearchTextStart: async (candidate) => {
			const request = frozenWorkspaceSearchTextStartRequest(
				candidate.roots,
				candidate.pattern,
				candidate.isRegExp,
				candidate.isCaseSensitive,
				candidate.isWordMatch,
				candidate.excludeGlobs,
				candidate.maxResults,
				candidate.maxFileSize,
			);
			return decodeWorkspaceSearchTextStartResult(
				await invoke<unknown>("workspace_search_text_start", { request }),
			);
		},
		workspaceSearchTextPoll: async (searchId, cursor) => {
			const request = frozenWorkspaceSearchTextPollRequest(searchId, cursor);
			return decodeWorkspaceSearchTextPollResult(
				await invoke<unknown>("workspace_search_text_poll", { request }),
			);
		},
		workspaceSearchTextCancel: async (searchId) => {
			const request = frozenWorkspaceSearchTextCancelRequest(searchId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_search_text_cancel", { request }),
			);
		},
		workspaceSearchTextWatch: (listener) => {
			let unlisten: (() => void) | undefined;
			let disposed = false;
			void listen<unknown>(WORKSPACE_SEARCH_TEXT_WAKE_EVENT, (event) => {
				listener(decodeWorkspaceSearchTextWakeEvent(event.payload).searchId);
			}).then((resolved) => {
				if (disposed) {
					void resolved();
					return;
				}
				unlisten = resolved;
			});
			return () => {
				disposed = true;
				unlisten?.();
			};
		},
		backupWrite: async (key, bytes) => {
			const frame = encodeBackupWriteRequest(key, bytes);
			decodeBackupVoid(await invoke<unknown>("backup_write", frame));
		},
		backupReadAll: async () => {
			return decodeBackupReadAllResult(
				await invoke<ArrayBuffer | number[]>("backup_read_all", {
					request: {},
				}),
			);
		},
		backupDiscard: async (key) => {
			const request = frozenBackupDiscardRequest(key);
			decodeBackupVoid(await invoke<unknown>("backup_discard", { request }));
		},
		backupDiscardAll: async () => {
			decodeBackupVoid(
				await invoke<unknown>("backup_discard_all", { request: {} }),
			);
		},
		themeImportVsix: async () =>
			decodeThemeImportResult(
				await invoke<unknown>("theme_import_vsix", { request: {} }),
			),
		themeImportDirectory: async () =>
			decodeThemeImportResult(
				await invoke<unknown>("theme_import_directory", { request: {} }),
			),
		themeList: async () =>
			decodeThemeListResult(
				await invoke<unknown>("theme_list", { request: {} }),
			),
		themeReadResource: async (packageId, relativePath) => {
			const request = frozenThemeReadResourceRequest(packageId, relativePath);
			return decodeThemeReadResourceBytes(
				await invoke<ArrayBuffer | number[]>("theme_read_resource", {
					request,
				}),
			);
		},
		themeRemove: async (packageId) => {
			const request = frozenThemeRemoveRequest(packageId);
			decodeThemeVoid(await invoke<unknown>("theme_remove", { request }));
		},
		themeGetSelection: async () =>
			decodeThemeSelectionResult(
				await invoke<unknown>("theme_get_selection", { request: {} }),
			),
		themeSetSelection: async (themeId) => {
			const request = frozenThemeSetSelectionRequest(themeId);
			decodeThemeVoid(
				await invoke<unknown>("theme_set_selection", { request }),
			);
		},
	};
}
