import type { PlainBridge, RuntimeInfo } from "./contracts";

const runtimeInfo: RuntimeInfo = {
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
};

export function createBrowserMockBridge(): PlainBridge {
	const listeners = new Set<(payload: RuntimeInfo) => void>();

	return {
		async runtimeInfo() {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener(runtimeInfo);
				}
			});
			return runtimeInfo;
		},
		async onRuntimeReady(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
