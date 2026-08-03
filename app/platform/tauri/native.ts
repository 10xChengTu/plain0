import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
	DEBUG_EVENT,
	NATIVE_CLOSE_REQUEST_EVENT,
	RUNTIME_READY_EVENT,
	TERMINAL_DATA_EVENT,
	TERMINAL_EXIT_EVENT,
	WORKSPACE_SEARCH_TEXT_WAKE_EVENT,
	WORKSPACE_WATCH_WAKE_EVENT,
	USER_DATA_CHANGED_EVENT,
	type PlainBridge,
} from "./contracts";
import {
	decodeLifecycleVoid,
	decodeNativeCloseRequest,
	frozenCompleteCloseRequest,
} from "./lifecycle-codec";
import {
	decodeUserDataChangedEvent,
	decodeUserDataResult,
	frozenUserDataReadRequest,
	frozenUserDataWriteRequest,
} from "./user-data-codec";
import {
	decodeBackupReadAllResult,
	decodeBackupVoid,
	encodeBackupWriteRequest,
	frozenBackupDiscardRequest,
} from "./backup-codec";
import {
	decodeScratchCreateResult,
	decodeScratchReadAllResult,
	decodeScratchVoid,
	encodeScratchWriteRequest,
	frozenScratchDiscardRequest,
} from "./scratch-codec";
import {
	decodeRuntimeInfo,
	decodeWorkspaceCapabilities,
	decodeWorkspaceEntryStat,
	decodeWorkspaceDeleteBatchPlan,
	decodeWorkspaceDeleteResult,
	decodeWorkspaceTrashBatchPlan,
	decodeWorkspaceTrashResult,
	decodeWorkspaceReadFile,
	decodeWorkspaceWritePrepublicationError,
	decodeWorkspaceWriteResult,
	decodeWorkspaceMoveResult,
	decodeWorkspaceOpenFilesResult,
	decodeWorkspacePickSaveTargetResult,
	decodeWorkspacePickResult,
	decodeWorkspacePublishPrepublicationError,
	decodeWorkspacePublishFileResult,
	decodeWorkspaceRecentListResult,
	decodeWorkspaceReadDirectory,
	decodeWorkspaceSnapshot,
	decodeWorkspaceVoid,
	decodeWorkspaceWatchSyncResult,
	decodeWorkspaceWatchWakeEvent,
	encodeWorkspaceWriteFileRequest,
	encodeWorkspacePublishFileRequest,
	frozenWorkspaceCopyRequest,
	frozenWorkspaceCommitDeleteEntryRequest,
	frozenWorkspaceCommitTrashEntryRequest,
	frozenWorkspaceCreateEntryRequest,
	frozenWorkspaceDeleteBatchRequest,
	frozenWorkspaceTrashBatchRequest,
	frozenWorkspaceEntryRequest,
	frozenWorkspaceMoveRequest,
	frozenWorkspacePickSaveTargetRequest,
	frozenWorkspacePrepareDeleteRequest,
	frozenWorkspacePrepareTrashRequest,
	frozenWorkspaceRenameRequest,
	frozenWorkspaceRecentRequest,
	frozenWorkspaceWatchSyncRequest,
	workspaceWriteResponseUnavailable,
} from "./workspace-codec";
import { createWorkspaceWatcherManager } from "./workspace-watcher";
import {
	decodeDebugAdapterConfirmationState,
	decodeDebugAdapterConfirmationVoid,
	decodeDebugContinueResult,
	decodeDebugEvaluateResult,
	decodeDebugEventPayload,
	decodeDebugOutputAckVoid,
	decodeDebugScopesResult,
	decodeDebugSessionStartResult,
	decodeDebugSetBreakpointsResult,
	decodeDebugStackTraceResult,
	decodeDebugStepVoid,
	decodeDebugVariablesResult,
	decodeDebugVoid,
	frozenDebugAdapterConfirmationRequest,
	frozenDebugEvaluateRequest,
	frozenDebugOutputAckRequest,
	frozenDebugScopesRequest,
	frozenDebugSessionIdRequest,
	frozenDebugSessionStartRequest,
	frozenDebugSetBreakpointsRequest,
	frozenDebugStackTraceRequest,
	frozenDebugThreadRequest,
	frozenDebugVariablesRequest,
} from "./debug-codec";
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
	frozenThemeSetFileIconThemeSelectionRequest,
	frozenThemeSetProductIconThemeSelectionRequest,
	frozenThemeSetSelectionRequest,
} from "./theme-codec";
import {
	decodeTerminalDataEvent,
	decodeTerminalExitEvent,
	decodeTerminalScrollbackResult,
	decodeTerminalStartResult,
	decodeTerminalVoid,
	decodeWorkspaceTrustState,
	decodeWorkspaceTrustVoid,
	frozenTerminalAckRequest,
	frozenTerminalFocusRequest,
	frozenTerminalInputKeyRequest,
	frozenTerminalInputTextRequest,
	frozenTerminalKillRequest,
	frozenTerminalResizeRequest,
	frozenTerminalScrollbackRequest,
	frozenTerminalStartRequest,
} from "./terminal-codec";
import {
	decodeGitBlameCommitMessagesResult,
	decodeGitBlameFileResult,
	decodeGitDiffFilesResult,
	decodeGitHistoryListResult,
	decodeGitLineHistoryDetailResult,
	decodeGitLogGraphResult,
	decodeGitNetworkPreviewResult,
	decodeGitRefsListResult,
	decodeGitShowBlobResult,
	decodeGitShowCommitResult,
	decodeGitStashApplyOutcome,
	decodeGitStashListResult,
	decodeGitStashPushOutcome,
	decodeGitStashShowResult,
	decodeGitStatusResult,
	decodeGitVoid,
	decodeGitWorktreeAddOutcome,
	decodeGitWorktreeListResult,
	decodeGitWorktreeRemoveOutcome,
	frozenGitBlameCommitMessagesRequest,
	frozenGitBlameFileRequest,
	frozenGitCommitRequest,
	frozenGitDiffFilesRequest,
	frozenGitDiscardPathsRequest,
	frozenGitFileHistoryRequest,
	frozenGitLineHistoryDetailRequest,
	frozenGitLineHistoryListRequest,
	frozenGitLogGraphRequest,
	frozenGitNetworkPreviewRequest,
	frozenGitPushRequest,
	frozenGitRootId,
	frozenGitShowBlobRequest,
	frozenGitShowCommitBlobRequest,
	frozenGitShowCommitRequest,
	frozenGitStageBlobRequest,
	frozenGitStagePathsRequest,
	frozenGitStashApplyRequest,
	frozenGitStashDropRequest,
	frozenGitStashPopRequest,
	frozenGitStashPushRequest,
	frozenGitStashShowRequest,
	frozenGitUnstagePathsRequest,
	frozenGitWorktreeAddRequest,
	frozenGitWorktreeRemoveRequest,
} from "./git-codec";
import { decodeWindowVoid } from "./window-codec";

async function resolveNativeGitRootId(
	rootId: string | undefined,
): Promise<string> {
	if (rootId !== undefined) {
		return frozenGitRootId(rootId);
	}
	const snapshot = decodeWorkspaceSnapshot(
		await invoke<unknown>("workspace_snapshot", { request: {} }),
	);
	if (snapshot.roots.length !== 1) {
		throw Object.freeze({
			code: "GIT_ROOT_REQUIRED",
			message: "Select a workspace root before running a Git operation.",
		});
	}
	return frozenGitRootId(snapshot.roots[0]!.rootId);
}

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
		windowCreate: async () => {
			decodeWindowVoid(
				await invoke<unknown>("window_create", {
					request: Object.freeze({}),
				}),
			);
		},
		onRuntimeReady: async (listener) => {
			return listen<unknown>(RUNTIME_READY_EVENT, (event) =>
				listener(decodeRuntimeInfo(event.payload)),
			);
		},
		onNativeCloseRequested: async (listener) => {
			return listen<unknown>(NATIVE_CLOSE_REQUEST_EVENT, (event) =>
				listener(decodeNativeCloseRequest(event.payload)),
			);
		},
		lifecycleCompleteClose: async (requestId, outcome) => {
			const request = frozenCompleteCloseRequest(requestId, outcome);
			decodeLifecycleVoid(
				await invoke<unknown>("lifecycle_complete_close", { request }),
			);
		},
		lifecycleRequestClose: async () => {
			decodeLifecycleVoid(
				await invoke<unknown>("lifecycle_request_close", { request: {} }),
			);
		},
		userDataRead: async (resource) => {
			const request = frozenUserDataReadRequest(resource);
			return decodeUserDataResult(
				await invoke<unknown>("user_data_read", { request }),
			);
		},
		userDataWrite: async (resource, expectedRevision, content) => {
			const request = frozenUserDataWriteRequest(
				resource,
				expectedRevision,
				content,
			);
			return decodeUserDataResult(
				await invoke<unknown>("user_data_write", { request }),
			);
		},
		onUserDataChanged: async (listener) => {
			return listen<unknown>(USER_DATA_CHANGED_EVENT, (event) =>
				listener(decodeUserDataChangedEvent(event.payload)),
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
		workspaceOpenFiles: async () =>
			decodeWorkspaceOpenFilesResult(
				await invoke<unknown>("workspace_open_files", {
					request: Object.freeze({}),
				}),
			),
		workspacePickSaveTarget: async (suggestedName) => {
			const request = frozenWorkspacePickSaveTargetRequest(suggestedName);
			return decodeWorkspacePickSaveTargetResult(
				await invoke<unknown>("workspace_pick_save_target", { request }),
			);
		},
		workspaceRecentList: async () =>
			decodeWorkspaceRecentListResult(
				await invoke<unknown>("workspace_recent_list", {
					request: Object.freeze({}),
				}),
			),
		workspaceOpenRecent: async (recentId) => {
			const request = frozenWorkspaceRecentRequest(recentId);
			return decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_open_recent", { request }),
			);
		},
		workspaceRemoveRecent: async (recentId) => {
			const request = frozenWorkspaceRecentRequest(recentId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_remove_recent", { request }),
			);
		},
		workspaceClearRecent: async () => {
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_clear_recent", {
					request: Object.freeze({}),
				}),
			);
		},
		workspaceRemoveRoot: async (rootId) =>
			decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_remove_root", {
					request: { rootId },
				}),
			),
		workspaceCloseFolder: async () =>
			decodeWorkspaceSnapshot(
				await invoke<unknown>("workspace_close_folder", {
					request: Object.freeze({}),
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
		workspacePrepareTrash: async (entries) => {
			const request = frozenWorkspacePrepareTrashRequest(entries);
			return decodeWorkspaceTrashBatchPlan(
				await invoke<unknown>("workspace_prepare_trash", { request }),
				request,
			);
		},
		workspaceCancelTrash: async (confirmationId) => {
			const request = frozenWorkspaceTrashBatchRequest(confirmationId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_cancel_trash", { request }),
			);
		},
		workspaceBeginTrash: async (confirmationId) => {
			const request = frozenWorkspaceTrashBatchRequest(confirmationId);
			decodeWorkspaceVoid(
				await invoke<unknown>("workspace_begin_trash", { request }),
			);
		},
		workspaceCommitTrashEntry: async (
			confirmationId,
			entryId,
			rootId,
			relativePath,
		) => {
			const request = frozenWorkspaceCommitTrashEntryRequest(
				confirmationId,
				entryId,
				rootId,
				relativePath,
			);
			return decodeWorkspaceTrashResult(
				await invoke<unknown>("workspace_commit_trash_entry", { request }),
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
		workspacePublishFile: async (rootId, relativePath, content) => {
			const frame = encodeWorkspacePublishFileRequest(
				rootId,
				relativePath,
				content,
			);
			const expectedContentLength = new DataView(
				frame.buffer,
				frame.byteOffset,
				frame.byteLength,
			).getUint32(8, false);
			try {
				return decodeWorkspacePublishFileResult(
					await invoke<unknown>("workspace_publish_file", frame),
					expectedContentLength,
				);
			} catch (error) {
				const commandError = decodeWorkspacePublishPrepublicationError(error);
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
		backupWrite: async (rootId, key, bytes) => {
			const frame = encodeBackupWriteRequest(rootId, key, bytes);
			decodeBackupVoid(await invoke<unknown>("backup_write", frame));
		},
		backupReadAll: async () => {
			return decodeBackupReadAllResult(
				await invoke<ArrayBuffer | number[]>("backup_read_all", {
					request: {},
				}),
			);
		},
		backupDiscard: async (rootId, key) => {
			const request = frozenBackupDiscardRequest(rootId, key);
			decodeBackupVoid(await invoke<unknown>("backup_discard", { request }));
		},
		backupDiscardAll: async () => {
			decodeBackupVoid(
				await invoke<unknown>("backup_discard_all", { request: {} }),
			);
		},
		scratchCreate: async () =>
			decodeScratchCreateResult(
				await invoke<unknown>("scratch_create", { request: Object.freeze({}) }),
			),
		scratchWrite: async (scratchId, bytes) => {
			const frame = encodeScratchWriteRequest(scratchId, bytes);
			decodeScratchVoid(await invoke<unknown>("scratch_write", frame));
		},
		scratchReadAll: async () =>
			decodeScratchReadAllResult(
				await invoke<ArrayBuffer | number[]>("scratch_read_all", {
					request: Object.freeze({}),
				}),
			),
		scratchDiscard: async (scratchId) => {
			const request = frozenScratchDiscardRequest(scratchId);
			decodeScratchVoid(await invoke<unknown>("scratch_discard", { request }));
		},
		scratchDiscardAll: async () => {
			decodeScratchVoid(
				await invoke<unknown>("scratch_discard_all", {
					request: Object.freeze({}),
				}),
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
		themeSetFileIconThemeSelection: async (fileIconThemeId) => {
			const request =
				frozenThemeSetFileIconThemeSelectionRequest(fileIconThemeId);
			decodeThemeVoid(
				await invoke<unknown>("theme_set_selection", { request }),
			);
		},
		themeSetProductIconThemeSelection: async (productIconThemeId) => {
			const request =
				frozenThemeSetProductIconThemeSelectionRequest(productIconThemeId);
			decodeThemeVoid(
				await invoke<unknown>("theme_set_selection", { request }),
			);
		},
		terminalStart: async (rootId, cwd, cols, rows) => {
			const request = frozenTerminalStartRequest(rootId, cwd, cols, rows);
			return decodeTerminalStartResult(
				await invoke<unknown>("terminal_start", { request }),
			);
		},
		terminalInputText: async (sessionId, text) => {
			const request = frozenTerminalInputTextRequest(sessionId, text);
			decodeTerminalVoid(
				await invoke<unknown>("terminal_input_text", { request }),
			);
		},
		terminalInputKey: async (sessionId, action, key, mods, utf8) => {
			const request = frozenTerminalInputKeyRequest(
				sessionId,
				action,
				key,
				mods,
				utf8,
			);
			decodeTerminalVoid(
				await invoke<unknown>("terminal_input_key", { request }),
			);
		},
		terminalFocus: async (sessionId, focused) => {
			const request = frozenTerminalFocusRequest(sessionId, focused);
			decodeTerminalVoid(await invoke<unknown>("terminal_focus", { request }));
		},
		terminalResize: async (sessionId, cols, rows) => {
			const request = frozenTerminalResizeRequest(sessionId, cols, rows);
			decodeTerminalVoid(await invoke<unknown>("terminal_resize", { request }));
		},
		terminalAck: async (sessionId, sequence) => {
			const request = frozenTerminalAckRequest(sessionId, sequence);
			decodeTerminalVoid(await invoke<unknown>("terminal_ack", { request }));
		},
		terminalScrollback: async (sessionId, start, count) => {
			const request = frozenTerminalScrollbackRequest(sessionId, start, count);
			return decodeTerminalScrollbackResult(
				await invoke<unknown>("terminal_scrollback", { request }),
			);
		},
		terminalKill: async (sessionId, immediate) => {
			const request = frozenTerminalKillRequest(sessionId, immediate);
			decodeTerminalVoid(await invoke<unknown>("terminal_kill", { request }));
		},
		terminalWatchData: (listener) => {
			let unlisten: (() => void) | undefined;
			let disposed = false;
			void listen<unknown>(TERMINAL_DATA_EVENT, (event) => {
				listener(decodeTerminalDataEvent(event.payload));
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
		terminalWatchExit: (listener) => {
			let unlisten: (() => void) | undefined;
			let disposed = false;
			void listen<unknown>(TERMINAL_EXIT_EVENT, (event) => {
				listener(decodeTerminalExitEvent(event.payload));
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
		workspaceTrustState: async () =>
			decodeWorkspaceTrustState(
				await invoke<unknown>("workspace_trust_state", { request: {} }),
			),
		workspaceTrustGrant: async () =>
			decodeWorkspaceTrustState(
				await invoke<unknown>("workspace_trust_grant", { request: {} }),
			),
		workspaceTrustRevoke: async () => {
			decodeWorkspaceTrustVoid(
				await invoke<unknown>("workspace_trust_revoke", { request: {} }),
			);
		},
		gitStatus: async (rootId) =>
			decodeGitStatusResult(
				await invoke<unknown>("git_status", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			),
		gitDiffFiles: async (cached, rootId) => {
			const request = frozenGitDiffFilesRequest(cached);
			return decodeGitDiffFilesResult(
				await invoke<unknown>("git_diff_files", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitShowBlob: async (rev, path, rootId) => {
			const request = frozenGitShowBlobRequest(rev, path);
			return decodeGitShowBlobResult(
				await invoke<unknown>("git_show_blob", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStagePaths: async (paths, rootId) => {
			const request = frozenGitStagePathsRequest(paths);
			decodeGitVoid(
				await invoke<unknown>("git_stage_paths", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitUnstagePaths: async (paths, rootId) => {
			const request = frozenGitUnstagePathsRequest(paths);
			decodeGitVoid(
				await invoke<unknown>("git_unstage_paths", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStageBlob: async (path, content, rootId) => {
			const request = frozenGitStageBlobRequest(path, content);
			decodeGitVoid(
				await invoke<unknown>("git_stage_blob", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitCommit: async (message, amend, rootId) => {
			const request = frozenGitCommitRequest(message, amend);
			decodeGitVoid(
				await invoke<unknown>("git_commit", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitDiscardPaths: async (paths, rootId) => {
			const request = frozenGitDiscardPathsRequest(paths);
			decodeGitVoid(
				await invoke<unknown>("git_discard_paths", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitNetworkPreview: async (operation, rootId) => {
			const request = frozenGitNetworkPreviewRequest(operation);
			return decodeGitNetworkPreviewResult(
				await invoke<unknown>("git_network_preview", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitFetch: async (rootId) => {
			decodeGitVoid(
				await invoke<unknown>("git_fetch", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitPull: async (rootId) => {
			decodeGitVoid(
				await invoke<unknown>("git_pull", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitPush: async (force, rootId) => {
			const request = frozenGitPushRequest(force);
			decodeGitVoid(
				await invoke<unknown>("git_push", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitNetworkCancel: async (rootId) => {
			decodeGitVoid(
				await invoke<unknown>("git_network_cancel", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitBlameFile: async (path, range, rootId) => {
			const request = frozenGitBlameFileRequest(path, range);
			return decodeGitBlameFileResult(
				await invoke<unknown>("git_blame_file", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitBlameCommitMessages: async (shas, rootId) => {
			const request = frozenGitBlameCommitMessagesRequest(shas);
			return decodeGitBlameCommitMessagesResult(
				await invoke<unknown>("git_blame_commit_messages", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitFileHistory: async (path, rootId) => {
			const request = frozenGitFileHistoryRequest(path);
			return decodeGitHistoryListResult(
				await invoke<unknown>("git_file_history", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitLineHistoryList: async (path, range, rootId) => {
			const request = frozenGitLineHistoryListRequest(path, range);
			return decodeGitHistoryListResult(
				await invoke<unknown>("git_line_history_list", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitLineHistoryDetail: async (path, range, skip, expectedSha, rootId) => {
			const request = frozenGitLineHistoryDetailRequest(
				path,
				range,
				skip,
				expectedSha,
			);
			return decodeGitLineHistoryDetailResult(
				await invoke<unknown>("git_line_history_detail", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitShowCommit: async (sha, rootId) => {
			const request = frozenGitShowCommitRequest(sha);
			return decodeGitShowCommitResult(
				await invoke<unknown>("git_show_commit", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitShowCommitBlob: async (sha, path, rootId) => {
			const request = frozenGitShowCommitBlobRequest(sha, path);
			return decodeGitShowBlobResult(
				await invoke<unknown>("git_show_commit_blob", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitLogGraph: async (maxCount, rootId) => {
			const request = frozenGitLogGraphRequest(maxCount);
			return decodeGitLogGraphResult(
				await invoke<unknown>("git_log_graph", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitRefsList: async (rootId) => {
			return decodeGitRefsListResult(
				await invoke<unknown>("git_refs_list", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitStashList: async (rootId) => {
			return decodeGitStashListResult(
				await invoke<unknown>("git_stash_list", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitStashShow: async (sha, rootId) => {
			const request = frozenGitStashShowRequest(sha);
			return decodeGitStashShowResult(
				await invoke<unknown>("git_stash_show", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStashPush: async (message, includeUntracked, rootId) => {
			const request = frozenGitStashPushRequest(message, includeUntracked);
			return decodeGitStashPushOutcome(
				await invoke<unknown>("git_stash_push", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStashApply: async (sha, useIndex, rootId) => {
			const request = frozenGitStashApplyRequest(sha, useIndex);
			return decodeGitStashApplyOutcome(
				await invoke<unknown>("git_stash_apply", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStashPop: async (sha, useIndex, rootId) => {
			const request = frozenGitStashPopRequest(sha, useIndex);
			return decodeGitStashApplyOutcome(
				await invoke<unknown>("git_stash_pop", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitStashDrop: async (sha, rootId) => {
			const request = frozenGitStashDropRequest(sha);
			return decodeGitVoid(
				await invoke<unknown>("git_stash_drop", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitWorktreeList: async (rootId) => {
			return decodeGitWorktreeListResult(
				await invoke<unknown>("git_worktree_list", {
					rootId: await resolveNativeGitRootId(rootId),
					request: {},
				}),
			);
		},
		gitWorktreeAdd: async (childSegment, detach, commitIsh, rootId) => {
			const request = frozenGitWorktreeAddRequest(
				childSegment,
				detach,
				commitIsh,
			);
			return decodeGitWorktreeAddOutcome(
				await invoke<unknown>("git_worktree_add", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		gitWorktreeRemove: async (path, force, rootId) => {
			const request = frozenGitWorktreeRemoveRequest(path, force);
			return decodeGitWorktreeRemoveOutcome(
				await invoke<unknown>("git_worktree_remove", {
					rootId: await resolveNativeGitRootId(rootId),
					request,
				}),
			);
		},
		debugAdapterConfirmationState: async (descriptor) => {
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			return decodeDebugAdapterConfirmationState(
				await invoke<unknown>("debug_adapter_confirmation_state", { request }),
			);
		},
		debugAdapterConfirmationGrant: async (descriptor) => {
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			decodeDebugAdapterConfirmationVoid(
				await invoke<unknown>("debug_adapter_confirmation_grant", { request }),
			);
		},
		debugAdapterConfirmationRevoke: async (descriptor) => {
			const request = frozenDebugAdapterConfirmationRequest(descriptor);
			decodeDebugAdapterConfirmationVoid(
				await invoke<unknown>("debug_adapter_confirmation_revoke", { request }),
			);
		},
		debugLaunch: async (rootId, target, adapterId, launchArguments) => {
			const request = frozenDebugSessionStartRequest(
				rootId,
				target,
				adapterId,
				launchArguments,
			);
			return decodeDebugSessionStartResult(
				await invoke<unknown>("debug_launch", { request }),
			);
		},
		debugAttach: async (rootId, target, adapterId, launchArguments) => {
			const request = frozenDebugSessionStartRequest(
				rootId,
				target,
				adapterId,
				launchArguments,
			);
			return decodeDebugSessionStartResult(
				await invoke<unknown>("debug_attach", { request }),
			);
		},
		debugDisconnect: async (sessionId) => {
			const request = frozenDebugSessionIdRequest(sessionId);
			decodeDebugVoid(await invoke<unknown>("debug_disconnect", { request }));
		},
		debugSetBreakpoints: async (sessionId, rootId, path, breakpoints) => {
			const request = frozenDebugSetBreakpointsRequest(
				sessionId,
				rootId,
				path,
				breakpoints,
			);
			return decodeDebugSetBreakpointsResult(
				await invoke<unknown>("debug_set_breakpoints", { request }),
			);
		},
		debugStackTrace: async (sessionId, threadId, startFrame, levels) => {
			const request = frozenDebugStackTraceRequest(
				sessionId,
				threadId,
				startFrame,
				levels,
			);
			return decodeDebugStackTraceResult(
				await invoke<unknown>("debug_stack_trace", { request }),
			);
		},
		debugScopes: async (sessionId, frameId) => {
			const request = frozenDebugScopesRequest(sessionId, frameId);
			return decodeDebugScopesResult(
				await invoke<unknown>("debug_scopes", { request }),
			);
		},
		debugVariables: async (
			sessionId,
			variablesReference,
			start,
			count,
			filter,
		) => {
			const request = frozenDebugVariablesRequest(
				sessionId,
				variablesReference,
				start,
				count,
				filter,
			);
			return decodeDebugVariablesResult(
				await invoke<unknown>("debug_variables", { request }),
			);
		},
		debugEvaluate: async (sessionId, expression, frameId, context) => {
			const request = frozenDebugEvaluateRequest(
				sessionId,
				expression,
				frameId,
				context,
			);
			return decodeDebugEvaluateResult(
				await invoke<unknown>("debug_evaluate", { request }),
			);
		},
		debugContinue: async (sessionId, threadId) => {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			return decodeDebugContinueResult(
				await invoke<unknown>("debug_continue", { request }),
			);
		},
		debugNext: async (sessionId, threadId) => {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			decodeDebugStepVoid(await invoke<unknown>("debug_next", { request }));
		},
		debugStepIn: async (sessionId, threadId) => {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			decodeDebugStepVoid(await invoke<unknown>("debug_step_in", { request }));
		},
		debugStepOut: async (sessionId, threadId) => {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			decodeDebugStepVoid(await invoke<unknown>("debug_step_out", { request }));
		},
		debugPause: async (sessionId, threadId) => {
			const request = frozenDebugThreadRequest(sessionId, threadId);
			decodeDebugStepVoid(await invoke<unknown>("debug_pause", { request }));
		},
		debugOutputAck: async (sessionId, sequence) => {
			const request = frozenDebugOutputAckRequest(sessionId, sequence);
			decodeDebugOutputAckVoid(
				await invoke<unknown>("debug_output_ack", { request }),
			);
		},
		debugWatchEvent: (listener) => {
			let unlisten: (() => void) | undefined;
			let disposed = false;
			void listen<unknown>(DEBUG_EVENT, (event) => {
				listener(decodeDebugEventPayload(event.payload));
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
	};
}
