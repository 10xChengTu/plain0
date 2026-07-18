import "@codingame/monaco-vscode-theme-defaults-default-extension";

import {
	getService,
	IContextKeyService,
	initialize,
} from "@codingame/monaco-vscode-api";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";

import { EXCLUDED_SURFACE_GUARD_MARKER } from "./excluded-surface-policy";
import { enforceExcludedWorkbenchSurfaces } from "./excluded-surfaces";
import { registerWorkspaceCommands } from "./features/workspace/commands";
import {
	createPlainWorkspaceFileSystemProvider,
	PLAIN_WORKSPACE_SCHEME,
} from "./features/workspace/file-system-provider";
import { createWorkspaceProjector } from "./features/workspace/workspace-projection";
import { configureMonacoEnvironment } from "./monaco-environment";
import { createBridge, normalizeCommandError } from "./platform/tauri";
import { createServiceOverrides } from "./services";
import "./styles.css";

async function bootstrap(): Promise<void> {
	configureMonacoEnvironment();

	const container = document.querySelector<HTMLElement>("#workbench");
	if (container === null) {
		throw new Error("Plain bootstrap container is missing");
	}

	const bridge = createBridge();
	const workspaceFileSystemProvider =
		createPlainWorkspaceFileSystemProvider(bridge);
	registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
	const workspaceProjector = createWorkspaceProjector(reinitializeWorkspace);
	const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
	const initialWorkspace = workspaceProjector.project(initialWorkspaceSnapshot);
	const stopListening = await bridge.onRuntimeReady((payload) => {
		document.body.dataset.plainRuntimeEvent = payload.runtime;
	});
	let workspaceCommands:
		ReturnType<typeof registerWorkspaceCommands> | undefined;
	window.addEventListener(
		"pagehide",
		() => {
			void stopListening();
			workspaceCommands?.dispose();
		},
		{ once: true },
	);
	const runtime = await bridge.runtimeInfo();
	document.body.dataset.plainRuntime = runtime.runtime;
	document.body.dataset.plainIpcVersion = String(runtime.ipcVersion);

	await initialize(createServiceOverrides(), container, {
		productConfiguration: {
			nameShort: "Plain",
			nameLong: "Plain",
		},
		configurationDefaults: {
			"window.menuBarVisibility": "hidden",
			"workbench.startupEditor": "none",
		},
		enableWorkspaceTrust: false,
		workspaceProvider: initialWorkspace.provider,
	});
	if (initialWorkspace.provider.workspace === undefined) {
		await workspaceProjector.apply(initialWorkspaceSnapshot);
	}
	workspaceCommands = registerWorkspaceCommands(
		bridge,
		await getService(IContextKeyService),
		async (snapshot) => {
			await workspaceProjector.apply(snapshot);
		},
	);
	const surfaceSnapshot = enforceExcludedWorkbenchSurfaces();
	document.body.dataset.plainSurfaceGuard = EXCLUDED_SURFACE_GUARD_MARKER;
	if (import.meta.env.DEV) {
		window.__PLAIN_WORKBENCH_SURFACES__ = Object.freeze(surfaceSnapshot);
	}

	document.body.dataset.plainReady = "true";
}

void bootstrap().catch((error) => {
	const normalized = normalizeCommandError(error);
	document.body.dataset.plainReady = "error";
	const status = document.querySelector<HTMLElement>("#plain-bootstrap-status");
	if (status !== null) {
		status.textContent = `${normalized.code}: ${normalized.message}`;
	}
	console.error("Plain bootstrap failed", normalized);
});
