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

export type Unlisten = () => void | Promise<void>;

export interface PlainBridge {
	runtimeInfo(): Promise<RuntimeInfo>;
	onRuntimeReady(listener: (payload: RuntimeInfo) => void): Promise<Unlisten>;
}
