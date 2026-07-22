import "@codingame/monaco-vscode-theme-defaults-default-extension";

import {
	getService,
	IContextKeyService,
	IWorkspaceContextService,
	initialize,
} from "@codingame/monaco-vscode-api";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";

import { EXCLUDED_SURFACE_GUARD_MARKER } from "./excluded-surface-policy";
import { enforceExcludedWorkbenchSurfaces } from "./excluded-surfaces";
import { registerWorkspaceCommands } from "./features/workspace/commands";
import { registerWorkspaceDeleteCoordinator } from "./features/workspace/delete-coordinator";
import {
	createPlainWorkspaceConfigurationProvider,
	PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
} from "./features/workspace/workspace-configuration-provider";
import {
	createPlainWorkspaceFileSystemProvider,
	PLAIN_WORKSPACE_SCHEME,
} from "./features/workspace/file-system-provider";
import { createWorkspaceTopologyCoordinator } from "./features/workspace/workspace-projection";
import { configureMonacoEnvironment } from "./monaco-environment";
import { createBridge, normalizeCommandError } from "./platform/tauri";
import { createServiceOverrides } from "./services";
import { configurePlainWorkingCopyBackupBridge } from "./services/plain-workspace-backup-service";
import "./styles.css";

async function bootstrap(): Promise<void> {
	configureMonacoEnvironment();

	const container = document.querySelector<HTMLElement>("#workbench");
	if (container === null) {
		throw new Error("Plain bootstrap container is missing");
	}

	const bridge = createBridge();
	const workspaceCapabilities = await bridge.workspaceCapabilities();
	const workspaceFileSystemProvider = createPlainWorkspaceFileSystemProvider(
		bridge,
		workspaceCapabilities,
	);
	const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
		bridge,
		workspaceFileSystemProvider,
	);
	const workspaceConfigurationProvider =
		createPlainWorkspaceConfigurationProvider();
	registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
	registerCustomProvider(
		PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
		workspaceConfigurationProvider,
	);
	const workspaceTopologyCoordinator = createWorkspaceTopologyCoordinator(
		workspaceConfigurationProvider,
		reinitializeWorkspace,
		() => bridge.workspaceSnapshot(),
		async () => {
			const workspace = (
				await getService(IWorkspaceContextService)
			).getWorkspace();
			return Object.freeze({
				id: workspace.id,
				configPath: workspace.configuration ?? undefined,
				rootUris: Object.freeze(
					workspace.folders.map(({ uri }) => uri.toString()),
				),
			});
		},
		() => {
			document.body.dataset.plainWorkspaceProjection = "reload-required";
		},
		(rootIds) => bridge.workspaceReconcileWatchRoots(rootIds),
	);
	const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
	const initialWorkspace = workspaceTopologyCoordinator.prepareInitial(
		initialWorkspaceSnapshot,
	);
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
			workspaceDeleteCoordinator.dispose();
		},
		{ once: true },
	);
	const runtime = await bridge.runtimeInfo();
	document.body.dataset.plainRuntime = runtime.runtime;
	document.body.dataset.plainIpcVersion = String(runtime.ipcVersion);

	configurePlainWorkingCopyBackupBridge(bridge);
	await initialize(createServiceOverrides(), container, {
		productConfiguration: {
			nameShort: "Plain",
			nameLong: "Plain",
		},
		configurationDefaults: {
			"window.menuBarVisibility": "hidden",
			"workbench.startupEditor": "none",
			"files.autoSave": "off",
		},
		enableWorkspaceTrust: false,
		workspaceProvider: initialWorkspace.provider,
	});
	await workspaceTopologyCoordinator.completeInitial();
	workspaceCommands = registerWorkspaceCommands(
		bridge,
		await getService(IContextKeyService),
		workspaceTopologyCoordinator,
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
