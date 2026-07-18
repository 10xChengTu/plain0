export const RUNTIME_READY_EVENT = "plain://runtime-ready" as const;

export interface RuntimeInfo {
	application: "Plain";
	ipcVersion: 1;
	runtime: "tauri" | "browser-mock";
}

export interface CommandError {
	code: string;
	message: string;
	details?: unknown;
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

export type Unlisten = () => void | Promise<void>;

export interface PlainBridge {
	runtimeInfo(): Promise<RuntimeInfo>;
	onRuntimeReady(listener: (payload: RuntimeInfo) => void): Promise<Unlisten>;
	workspaceSnapshot(): Promise<WorkspaceSnapshot>;
	workspacePickRoots(mode: WorkspacePickMode): Promise<WorkspacePickResult>;
	workspaceRemoveRoot(rootId: string): Promise<WorkspaceSnapshot>;
}
