import type {
	CommandError,
	PlainBridge,
	RuntimeInfo,
	WorkspaceRoot,
} from "./contracts";
import {
	frozenWorkspacePickResult,
	frozenWorkspaceSnapshot,
} from "./workspace-codec";

const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
});

const MOCK_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const mockRoots = Object.freeze([
	Object.freeze({
		rootId: "00000000-0000-4000-8000-000000000101",
		displayName: "plain-workspace",
		uri: "plain-workspace://00000000-0000-4000-8000-000000000101/",
	}),
	Object.freeze({
		rootId: "00000000-0000-4000-8000-000000000102",
		displayName: "plain-library",
		uri: "plain-workspace://00000000-0000-4000-8000-000000000102/",
	}),
] satisfies readonly WorkspaceRoot[]);

export type BrowserMockWorkspacePick = "selected" | "cancelled";

export interface BrowserMockBridgeOptions {
	readonly workspacePicks?: readonly BrowserMockWorkspacePick[];
}

function rootNotAuthorized(): CommandError {
	return {
		code: "ROOT_NOT_AUTHORIZED",
		message: "The workspace root is not authorized.",
	};
}

export function createBrowserMockBridge(
	options: BrowserMockBridgeOptions = {},
): PlainBridge {
	const listeners = new Set<(payload: RuntimeInfo) => void>();
	const scriptedPicks = [...(options.workspacePicks ?? [])];
	const roots = new Map<string, WorkspaceRoot>();
	let revision = 0;

	const snapshot = () =>
		frozenWorkspaceSnapshot(MOCK_WORKSPACE_ID, revision, [...roots.values()]);

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
		async workspaceSnapshot() {
			return snapshot();
		},
		async workspacePickRoots(mode) {
			const status = scriptedPicks.shift() ?? "selected";
			if (status === "cancelled") {
				return frozenWorkspacePickResult(status, snapshot());
			}

			const selected = mode === "add" ? mockRoots : mockRoots.slice(0, 1);
			if (mode === "replace") {
				const replacement = selected[0]!;
				if (roots.size !== 1 || !roots.has(replacement.rootId)) {
					roots.clear();
					roots.set(replacement.rootId, replacement);
					revision += 1;
				}
				return frozenWorkspacePickResult(status, snapshot());
			}

			const before = roots.size;
			for (const root of selected) {
				roots.set(root.rootId, root);
			}
			if (roots.size !== before) {
				revision += 1;
			}

			return frozenWorkspacePickResult(status, snapshot());
		},
		async workspaceRemoveRoot(rootId) {
			if (!roots.delete(rootId)) {
				throw rootNotAuthorized();
			}
			revision += 1;
			return snapshot();
		},
	};
}
