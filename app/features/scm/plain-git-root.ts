import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import type { PlainBridge } from "../../platform/tauri/contracts";

const ROOT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PlainGitWorkspaceRoot {
	readonly rootId: string;
	readonly label: string;
	readonly uri: URI;
}

interface WorkspaceFolderLike {
	readonly name: string;
	readonly uri: URI;
}

/** Projects the Workbench folder list back into Plain's opaque native root
 * identities. Invalid or duplicate authorities fail closed as an empty
 * result: workspace topology already enforces this shape, but Git must not
 * turn a corrupted projection into a best-effort repository guess. */
export function plainGitRootsFromWorkspaceFolders(
	folders: readonly WorkspaceFolderLike[],
): readonly PlainGitWorkspaceRoot[] {
	const seen = new Set<string>();
	const roots: PlainGitWorkspaceRoot[] = [];
	for (const folder of folders) {
		const rootId = folder.uri.authority;
		if (
			folder.uri.scheme !== "plain-workspace" ||
			folder.uri.path !== "/" ||
			!ROOT_ID_PATTERN.test(rootId) ||
			seen.has(rootId)
		) {
			return Object.freeze([]);
		}
		seen.add(rootId);
		roots.push(Object.freeze({ rootId, label: folder.name, uri: folder.uri }));
	}
	return Object.freeze(roots);
}

type RootSelectionListener = () => void;

/** Shared Source Control repository selection. A sole root is safe to select
 * automatically; the moment a second root appears, an automatic selection is
 * cleared and the user must make an explicit choice. Explicit choices survive
 * unrelated topology changes only while that exact root remains authorized. */
export class PlainGitRootSelection {
	#rootId: string | undefined;
	#explicit = false;
	readonly #listeners = new Set<RootSelectionListener>();

	onDidChange(listener: RootSelectionListener): { dispose(): void } {
		this.#listeners.add(listener);
		return {
			dispose: () => {
				this.#listeners.delete(listener);
			},
		};
	}

	#update(rootId: string | undefined, explicit: boolean): void {
		if (this.#rootId === rootId && this.#explicit === explicit) {
			return;
		}
		this.#rootId = rootId;
		this.#explicit = explicit;
		for (const listener of Array.from(this.#listeners)) {
			listener();
		}
	}

	synchronize(roots: readonly PlainGitWorkspaceRoot[]): string | undefined {
		if (roots.length === 0) {
			this.#update(undefined, false);
			return undefined;
		}
		if (roots.length === 1) {
			this.#update(roots[0]!.rootId, false);
			return roots[0]!.rootId;
		}
		if (
			this.#explicit &&
			this.#rootId !== undefined &&
			roots.some(({ rootId }) => rootId === this.#rootId)
		) {
			return this.#rootId;
		}
		this.#update(undefined, false);
		return undefined;
	}

	select(
		rootId: string | undefined,
		roots: readonly PlainGitWorkspaceRoot[],
	): boolean {
		if (rootId === undefined) {
			this.#update(undefined, false);
			return true;
		}
		if (!roots.some((root) => root.rootId === rootId)) {
			return false;
		}
		this.#update(rootId, true);
		return true;
	}

	resolve(
		roots: readonly PlainGitWorkspaceRoot[],
	): PlainGitWorkspaceRoot | undefined {
		const rootId = this.synchronize(roots);
		return roots.find((root) => root.rootId === rootId);
	}
}

export const plainGitRootSelection = new PlainGitRootSelection();

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
