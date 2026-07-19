export const RUNTIME_READY_EVENT = "plain://runtime-ready" as const;

export interface RuntimeInfo {
	application: "Plain";
	ipcVersion: 1;
	runtime: "tauri" | "browser-mock";
}

export interface CommandError {
	readonly code: string;
	readonly message: string;
	readonly details?: unknown;
}

export interface WorkspaceRoot {
	readonly rootId: string;
	readonly displayName: string;
	readonly uri: string;
}

export interface WorkspaceSnapshot {
	readonly workspaceId: string;
	readonly revision: number;
	readonly roots: readonly WorkspaceRoot[];
}

export interface WorkspacePickResult {
	readonly status: "selected" | "cancelled";
	readonly snapshot: WorkspaceSnapshot;
}

export type WorkspacePickMode = "replace" | "add";

export type WorkspaceEntryKind =
	| "file"
	| "directory"
	| "symlink"
	| "symlinkFile"
	| "symlinkDirectory"
	| "other";

export interface WorkspaceEntryStat {
	readonly kind: WorkspaceEntryKind;
	readonly size: number;
	readonly mtime: number;
	readonly ctime: number;
}

export interface WorkspaceDirectoryEntry {
	readonly name: string;
	readonly kind: WorkspaceEntryKind;
}

export interface WorkspaceReadDirectoryResult {
	readonly entries: readonly WorkspaceDirectoryEntry[];
}

export interface WorkspaceCopyRequest {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
}

export interface WorkspaceMoveRequest {
	readonly sourceRootId: string;
	readonly sourcePath: string;
	readonly targetRootId: string;
	readonly targetPath: string;
}

export type WorkspaceMoveIncompleteReason =
	| "sourceChanged"
	| "targetChanged"
	| "sourceUnverifiable"
	| "targetUnverifiable"
	| "deleteFailed";

export type WorkspaceMoveResult =
	| Readonly<{ status: "moved" }>
	| Readonly<{
			status: "targetPublishedSourceRetained";
			reason: WorkspaceMoveIncompleteReason;
	  }>
	| Readonly<{
			status: "targetPublishedSourcePartiallyDeleted";
			reason: WorkspaceMoveIncompleteReason;
			removedEntries: number;
	  }>;

export interface WorkspaceDeleteEntryRequest {
	readonly rootId: string;
	readonly relativePath: string;
	readonly recursive: boolean;
}

export interface WorkspacePrepareDeleteRequest {
	readonly entries: readonly WorkspaceDeleteEntryRequest[];
}

export type WorkspaceDeleteEntryKind = "file" | "directory" | "symlink";

export interface WorkspaceDeleteBatchPlanEntry {
	readonly entryId: string;
	readonly kind: WorkspaceDeleteEntryKind;
	readonly descendantEntries: number;
}

export interface WorkspaceDeleteBatchPlan {
	readonly confirmationId: string;
	readonly entries: readonly WorkspaceDeleteBatchPlanEntry[];
}

export interface WorkspaceDeleteBatchRequest {
	readonly confirmationId: string;
}

export interface WorkspaceCommitDeleteEntryRequest extends WorkspaceDeleteEntryRequest {
	readonly confirmationId: string;
	readonly entryId: string;
}

export type WorkspaceDeleteIncompleteReason =
	"entryChanged" | "entryUnverifiable" | "deleteFailed";

export type WorkspaceDeleteResult =
	| Readonly<{ status: "deleted" }>
	| Readonly<{
			status: "entryRetained";
			reason: WorkspaceDeleteIncompleteReason;
	  }>
	| Readonly<{
			status: "entryPartiallyDeleted";
			reason: WorkspaceDeleteIncompleteReason;
			removedEntries: number;
	  }>;

/**
 * Immutable file payload. The backing bytes are closure-private; each call to
 * copy returns a new Uint8Array that the caller may mutate independently.
 */
export interface WorkspaceFileData {
	readonly byteLength: number;
	readonly copy: () => Uint8Array;
}

export type Unlisten = () => void | Promise<void>;

export interface PlainBridge {
	runtimeInfo(): Promise<RuntimeInfo>;
	onRuntimeReady(listener: (payload: RuntimeInfo) => void): Promise<Unlisten>;
	workspaceSnapshot(): Promise<WorkspaceSnapshot>;
	workspacePickRoots(mode: WorkspacePickMode): Promise<WorkspacePickResult>;
	workspaceRemoveRoot(rootId: string): Promise<WorkspaceSnapshot>;
	workspaceCreateFile(rootId: string, relativePath: string): Promise<void>;
	workspaceCreateDirectory(rootId: string, relativePath: string): Promise<void>;
	workspaceRename(
		rootId: string,
		sourcePath: string,
		targetPath: string,
	): Promise<void>;
	workspaceCopy(
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): Promise<void>;
	workspaceMove(
		sourceRootId: string,
		sourcePath: string,
		targetRootId: string,
		targetPath: string,
	): Promise<WorkspaceMoveResult>;
	workspacePrepareDelete(
		entries: readonly WorkspaceDeleteEntryRequest[],
	): Promise<WorkspaceDeleteBatchPlan>;
	workspaceCancelDelete(confirmationId: string): Promise<void>;
	workspaceBeginDelete(confirmationId: string): Promise<void>;
	workspaceCommitDeleteEntry(
		confirmationId: string,
		entryId: string,
		rootId: string,
		relativePath: string,
		recursive: boolean,
	): Promise<WorkspaceDeleteResult>;
	workspaceStat(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceEntryStat>;
	workspaceReadDirectory(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceReadDirectoryResult>;
	workspaceReadFile(
		rootId: string,
		relativePath: string,
	): Promise<WorkspaceFileData>;
}
