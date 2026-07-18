import { createBrowserMockBridge } from "./browser-mock";
import type { PlainBridge } from "./contracts";
import { createNativeBridge } from "./native";

interface TauriGlobal extends Window {
	__TAURI_INTERNALS__?: unknown;
}

export function createBridge(target: Window = window): PlainBridge {
	return (target as TauriGlobal).__TAURI_INTERNALS__ === undefined
		? createBrowserMockBridge()
		: createNativeBridge();
}

export * from "./contracts";
export { normalizeCommandError } from "./errors";
