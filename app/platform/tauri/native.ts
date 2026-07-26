import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
	RUNTIME_READY_EVENT,
	TERMINAL_DATA_EVENT,
	TERMINAL_EXIT_EVENT,
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
	decodeGitNetworkPreviewResult,
	decodeGitShowBlobResult,
	decodeGitStatusResult,
	decodeGitVoid,
	frozenGitBlameCommitMessagesRequest,
	frozenGitBlameFileRequest,
	frozenGitCommitRequest,
	frozenGitDiffFilesRequest,
	frozenGitDiscardPathsRequest,
	frozenGitFileHistoryRequest,
	frozenGitLineHistoryDetailRequest,
	frozenGitLineHistoryListRequest,
	frozenGitNetworkPreviewRequest,
	frozenGitPushRequest,
	frozenGitShowBlobRequest,
	frozenGitStageBlobRequest,
	frozenGitStagePathsRequest,
	frozenGitUnstagePathsRequest,
} from "./git-codec";

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
		terminalStart: async (cwd, cols, rows) => {
			const request = frozenTerminalStartRequest(cwd, cols, rows);
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
		gitStatus: async () =>
			decodeGitStatusResult(
				await invoke<unknown>("git_status", { request: {} }),
			),
		gitDiffFiles: async (cached) => {
			const request = frozenGitDiffFilesRequest(cached);
			return decodeGitDiffFilesResult(
				await invoke<unknown>("git_diff_files", { request }),
			);
		},
		gitShowBlob: async (rev, path) => {
			const request = frozenGitShowBlobRequest(rev, path);
			return decodeGitShowBlobResult(
				await invoke<unknown>("git_show_blob", { request }),
			);
		},
		gitStagePaths: async (paths) => {
			const request = frozenGitStagePathsRequest(paths);
			decodeGitVoid(await invoke<unknown>("git_stage_paths", { request }));
		},
		gitUnstagePaths: async (paths) => {
			const request = frozenGitUnstagePathsRequest(paths);
			decodeGitVoid(await invoke<unknown>("git_unstage_paths", { request }));
		},
		gitStageBlob: async (path, content) => {
			const request = frozenGitStageBlobRequest(path, content);
			decodeGitVoid(await invoke<unknown>("git_stage_blob", { request }));
		},
		gitCommit: async (message, amend) => {
			const request = frozenGitCommitRequest(message, amend);
			decodeGitVoid(await invoke<unknown>("git_commit", { request }));
		},
		gitDiscardPaths: async (paths) => {
			const request = frozenGitDiscardPathsRequest(paths);
			decodeGitVoid(await invoke<unknown>("git_discard_paths", { request }));
		},
		gitNetworkPreview: async (operation) => {
			const request = frozenGitNetworkPreviewRequest(operation);
			return decodeGitNetworkPreviewResult(
				await invoke<unknown>("git_network_preview", { request }),
			);
		},
		gitFetch: async () => {
			decodeGitVoid(await invoke<unknown>("git_fetch", { request: {} }));
		},
		gitPull: async () => {
			decodeGitVoid(await invoke<unknown>("git_pull", { request: {} }));
		},
		gitPush: async (force) => {
			const request = frozenGitPushRequest(force);
			decodeGitVoid(await invoke<unknown>("git_push", { request }));
		},
		gitNetworkCancel: async () => {
			decodeGitVoid(
				await invoke<unknown>("git_network_cancel", { request: {} }),
			);
		},
		gitBlameFile: async (path, range) => {
			const request = frozenGitBlameFileRequest(path, range);
			return decodeGitBlameFileResult(
				await invoke<unknown>("git_blame_file", { request }),
			);
		},
		gitBlameCommitMessages: async (shas) => {
			const request = frozenGitBlameCommitMessagesRequest(shas);
			return decodeGitBlameCommitMessagesResult(
				await invoke<unknown>("git_blame_commit_messages", { request }),
			);
		},
		gitFileHistory: async (path) => {
			const request = frozenGitFileHistoryRequest(path);
			return decodeGitHistoryListResult(
				await invoke<unknown>("git_file_history", { request }),
			);
		},
		gitLineHistoryList: async (path, range) => {
			const request = frozenGitLineHistoryListRequest(path, range);
			return decodeGitHistoryListResult(
				await invoke<unknown>("git_line_history_list", { request }),
			);
		},
		gitLineHistoryDetail: async (path, range, skip, expectedSha) => {
			const request = frozenGitLineHistoryDetailRequest(
				path,
				range,
				skip,
				expectedSha,
			);
			return decodeGitLineHistoryDetailResult(
				await invoke<unknown>("git_line_history_detail", { request }),
			);
		},
	};
}
