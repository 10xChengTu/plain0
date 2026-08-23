import type { PlainBridge } from "../../platform/tauri/contracts";
import {
	PlainWorkspaceRootSelection,
	plainWorkspaceRootsFromFolders,
	type PlainWorkspaceRoot,
} from "../workspace/plain-workspace-roots";

export type PlainGitWorkspaceRoot = PlainWorkspaceRoot;
export const plainGitRootsFromWorkspaceFolders = plainWorkspaceRootsFromFolders;

/** Shared Source Control repository selection. A sole root is safe to select
 * automatically; the moment a second root appears, an automatic selection is
 * cleared and the user must make an explicit choice. Explicit choices survive
 * unrelated topology changes only while that exact root remains authorized. */
export class PlainGitRootSelection extends PlainWorkspaceRootSelection {}

export const plainGitRootSelection = new PlainGitRootSelection();

/** `git for-each-ref %(upstream)` reports the full tracking ref while every
 * user-facing Git convention uses its short `remote/branch` name. Preserve
 * an unexpected non-remote ref verbatim rather than guessing another
 * namespace. */
export function gitUpstreamDisplayName(upstream: string): string {
	const prefix = "refs/remotes/";
	return upstream.startsWith(prefix) ? upstream.slice(prefix.length) : upstream;
}

/** Rootless facade used by the existing narrow Git controllers. Every
 * method closes over one immutable root id and appends it to the actual
 * `PlainBridge` call, so a multi-step controller cannot accidentally change
 * repositories halfway through an operation. */
export function bindPlainGitBridge(bridge: PlainBridge, rootId: string) {
	return Object.freeze({
		gitStatus: () => bridge.gitStatus(rootId),
		gitDiffFiles: (cached: boolean) => bridge.gitDiffFiles(cached, rootId),
		gitShowBlob: (rev: "head" | "index", path: string) =>
			bridge.gitShowBlob(rev, path, rootId),
		gitStagePaths: (paths: readonly string[]) =>
			bridge.gitStagePaths(paths, rootId),
		gitUnstagePaths: (paths: readonly string[]) =>
			bridge.gitUnstagePaths(paths, rootId),
		gitStageBlob: (path: string, content: Uint8Array) =>
			bridge.gitStageBlob(path, content, rootId),
		gitCommit: (message: string, amend: boolean) =>
			bridge.gitCommit(message, amend, rootId),
		gitDiscardPaths: (paths: readonly string[]) =>
			bridge.gitDiscardPaths(paths, rootId),
		gitNetworkPreview: (operation: "fetch" | "pull" | "push") =>
			bridge.gitNetworkPreview(operation, rootId),
		gitFetch: () => bridge.gitFetch(rootId),
		gitPull: () => bridge.gitPull(rootId),
		gitPush: (force: boolean) => bridge.gitPush(force, rootId),
		gitNetworkCancel: () => bridge.gitNetworkCancel(rootId),
		gitBlameFile: (
			path: string,
			range: { readonly start: number; readonly end: number } | null,
		) => bridge.gitBlameFile(path, range, rootId),
		gitBlameCommitMessages: (shas: readonly string[]) =>
			bridge.gitBlameCommitMessages(shas, rootId),
		gitFileHistory: (path: string) => bridge.gitFileHistory(path, rootId),
		gitHistorySearch: (mode: "message" | "author" | "sha", query: string) =>
			bridge.gitHistorySearch(mode, query, rootId),
		gitLineHistoryList: (
			path: string,
			range: { readonly start: number; readonly end: number },
		) => bridge.gitLineHistoryList(path, range, rootId),
		gitLineHistoryDetail: (
			path: string,
			range: { readonly start: number; readonly end: number },
			skip: number,
			expectedSha: string,
		) => bridge.gitLineHistoryDetail(path, range, skip, expectedSha, rootId),
		gitShowCommit: (sha: string) => bridge.gitShowCommit(sha, rootId),
		gitShowCommitBlob: (sha: string, path: string) =>
			bridge.gitShowCommitBlob(sha, path, rootId),
		gitLogGraph: (maxCount: number) => bridge.gitLogGraph(maxCount, rootId),
		gitRefsList: () => bridge.gitRefsList(rootId),
		gitRemotesList: () => bridge.gitRemotesList(rootId),
		gitReflogList: () => bridge.gitReflogList(rootId),
		gitContributorsList: () => bridge.gitContributorsList(rootId),
		gitBranchCreate: (name: string, targetSha: string) =>
			bridge.gitBranchCreate(name, targetSha, rootId),
		gitBranchSwitch: (name: string) => bridge.gitBranchSwitch(name, rootId),
		gitBranchRename: (oldName: string, newName: string) =>
			bridge.gitBranchRename(oldName, newName, rootId),
		gitBranchDelete: (name: string, force: boolean) =>
			bridge.gitBranchDelete(name, force, rootId),
		gitTagCreate: (name: string, targetSha: string, message: string | null) =>
			bridge.gitTagCreate(name, targetSha, message, rootId),
		gitTagDelete: (name: string) => bridge.gitTagDelete(name, rootId),
		gitRemoteAdd: (name: string, url: string) =>
			bridge.gitRemoteAdd(name, url, rootId),
		gitRemoteRename: (oldName: string, newName: string) =>
			bridge.gitRemoteRename(oldName, newName, rootId),
		gitRemoteSetUrl: (name: string, kind: "fetch" | "push", url: string) =>
			bridge.gitRemoteSetUrl(name, kind, url, rootId),
		gitRemoteRemove: (name: string) => bridge.gitRemoteRemove(name, rootId),
		gitUpstreamSet: (branch: string, upstream: string) =>
			bridge.gitUpstreamSet(branch, upstream, rootId),
		gitUpstreamUnset: (branch: string) =>
			bridge.gitUpstreamUnset(branch, rootId),
		gitHistoryState: () => bridge.gitHistoryState(rootId),
		gitHistoryPreview: (
			operation:
				| "merge"
				| "rebase"
				| "cherryPick"
				| "revert"
				| "resetSoft"
				| "resetMixed"
				| "resetHard",
			targetSha: string,
		) => bridge.gitHistoryPreview(operation, targetSha, rootId),
		gitMerge: (targetSha: string, previewToken: string) =>
			bridge.gitMerge(targetSha, previewToken, rootId),
		gitRebase: (targetSha: string, previewToken: string) =>
			bridge.gitRebase(targetSha, previewToken, rootId),
		gitCherryPick: (targetSha: string, previewToken: string) =>
			bridge.gitCherryPick(targetSha, previewToken, rootId),
		gitRevert: (targetSha: string, previewToken: string) =>
			bridge.gitRevert(targetSha, previewToken, rootId),
		gitReset: (
			targetSha: string,
			mode: "soft" | "mixed" | "hard",
			previewToken: string,
		) => bridge.gitReset(targetSha, mode, previewToken, rootId),
		gitHistoryContinue: (kind: "merge" | "rebase" | "cherryPick" | "revert") =>
			bridge.gitHistoryContinue(kind, rootId),
		gitHistoryAbort: (kind: "merge" | "rebase" | "cherryPick" | "revert") =>
			bridge.gitHistoryAbort(kind, rootId),
		gitHistoryCancel: () => bridge.gitHistoryCancel(rootId),
		gitStashList: () => bridge.gitStashList(rootId),
		gitStashShow: (sha: string) => bridge.gitStashShow(sha, rootId),
		gitStashPush: (message: string, includeUntracked: boolean) =>
			bridge.gitStashPush(message, includeUntracked, rootId),
		gitStashApply: (sha: string, useIndex: boolean) =>
			bridge.gitStashApply(sha, useIndex, rootId),
		gitStashPop: (sha: string, useIndex: boolean) =>
			bridge.gitStashPop(sha, useIndex, rootId),
		gitStashDrop: (sha: string) => bridge.gitStashDrop(sha, rootId),
		gitWorktreeList: () => bridge.gitWorktreeList(rootId),
		gitWorktreeAdd: (
			childSegment: string,
			detach: boolean,
			commitIsh: string | null,
		) => bridge.gitWorktreeAdd(childSegment, detach, commitIsh, rootId),
		gitWorktreeRemove: (path: string, force: boolean) =>
			bridge.gitWorktreeRemove(path, force, rootId),
	});
}

export type PlainRootedGitBridge = ReturnType<typeof bindPlainGitBridge>;
