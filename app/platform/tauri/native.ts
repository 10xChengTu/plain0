import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
	RUNTIME_READY_EVENT,
	type PlainBridge,
	type RuntimeInfo,
} from "./contracts";

export function createNativeBridge(): PlainBridge {
	return {
		runtimeInfo: () => invoke<RuntimeInfo>("runtime_info"),
		onRuntimeReady: async (listener) => {
			return listen<RuntimeInfo>(RUNTIME_READY_EVENT, (event) =>
				listener(event.payload),
			);
		},
	};
}
