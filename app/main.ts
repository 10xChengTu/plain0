import "@codingame/monaco-vscode-theme-defaults-default-extension";

import {
	getService,
	IContextKeyService,
	IWorkspaceContextService,
	initialize,
} from "@codingame/monaco-vscode-api";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";

import { EXCLUDED_SURFACE_GUARD_MARKER } from "./excluded-surface-policy";
import { enforceExcludedWorkbenchSurfaces } from "./excluded-surfaces";
import "./features/search/search-contribution";
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
import {
	applyDefaultColorTheme,
	applyDefaultFileIconTheme,
	applyDefaultProductIconTheme,
	applyPersistedFileIconThemeSelection,
	applyPersistedProductIconThemeSelection,
	applyPersistedThemeSelection,
	registerPlainFileIconThemePicker,
	registerPlainProductIconThemePicker,
	registerPlainThemePicker,
} from "./features/themes/plain-theme-picker";
import {
	createPlainFileIconThemeRegistry,
	createPlainProductIconThemeRegistry,
	createPlainThemeRegistry,
} from "./features/themes/plain-theme-registry";
import { registerPlainThemeCommands } from "./features/themes/plain-theme-commands";
import {
	consumeImportedThemePackages,
	PlainThemeRegistryStore,
} from "./features/themes/plain-theme-import-coordinator";
import { configureMonacoEnvironment } from "./monaco-environment";
import { createBridge, normalizeCommandError } from "./platform/tauri";
import { configurePlainSearchBridge } from "./features/search/plain-search-service";
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
	let themeCommandsRegistration:
		ReturnType<typeof registerPlainThemeCommands> | undefined;
	let fileIconThemePickerRegistration:
		ReturnType<typeof registerPlainFileIconThemePicker> | undefined;
	let productIconThemePickerRegistration:
		ReturnType<typeof registerPlainProductIconThemePicker> | undefined;
	window.addEventListener(
		"pagehide",
		() => {
			void stopListening();
			workspaceCommands?.dispose();
			workspaceDeleteCoordinator.dispose();
			themeCommandsRegistration?.dispose();
			fileIconThemePickerRegistration?.dispose();
			productIconThemePickerRegistration?.dispose();
		},
		{ once: true },
	);
	const runtime = await bridge.runtimeInfo();
	document.body.dataset.plainRuntime = runtime.runtime;
	document.body.dataset.plainIpcVersion = String(runtime.ipcVersion);

	configurePlainWorkingCopyBackupBridge(bridge);
	configurePlainSearchBridge(bridge);
	await initialize(createServiceOverrides(), container, {
		productConfiguration: {
			nameShort: "Plain",
			nameLong: "Plain",
		},
		configurationDefaults: {
			"window.menuBarVisibility": "hidden",
			"workbench.startupEditor": "none",
			"files.autoSave": "off",
			// Plain's Rust search domain (search::file_search/text_search) never
			// follows symlinks out of an authorized root, unconditionally —
			// there is no request field that could turn following on. Upstream
			// defaults `search.followSymlinks` to `true`; overriding it here
			// keeps the config surface honest about Plain's actual (narrower)
			// behavior rather than silently contradicting it. See
			// features/search/search-contribution.ts for the paired minimal
			// schema registration this default needs to have any observable
			// effect at all.
			"search.followSymlinks": false,
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

	const themeFileService = await getService(IFileService);
	const themeRegistry = await createPlainThemeRegistry(themeFileService);
	// `F060` S2's built-in file/product icon registries — constructed here
	// (rather than after the color theme block, as S2 originally had it) so
	// `F060` S3's unified `PlainThemeRegistryStore` below can be built once
	// with all three built-in axes together.
	const fileIconThemeRegistry =
		await createPlainFileIconThemeRegistry(themeFileService);
	const productIconThemeRegistry =
		await createPlainProductIconThemeRegistry(themeFileService);
	const themeService = await getService(IWorkbenchThemeService);
	await applyDefaultColorTheme(themeService, themeRegistry);
	await applyDefaultFileIconTheme(themeService, fileIconThemeRegistry);
	await applyDefaultProductIconTheme(themeService);
	const themeRegistryStore = new PlainThemeRegistryStore(
		themeRegistry,
		fileIconThemeRegistry,
		productIconThemeRegistry,
	);
	let themePickerRegistration = registerPlainThemePicker(
		bridge,
		themeRegistryStore.entries(),
	);
	fileIconThemePickerRegistration = registerPlainFileIconThemePicker(
		bridge,
		themeRegistryStore.fileIconEntries(),
	);
	productIconThemePickerRegistration = registerPlainProductIconThemePicker(
		bridge,
		themeRegistryStore.productIconEntries(),
	);
	const reRegisterThemePicker = (): void => {
		themePickerRegistration.dispose();
		themePickerRegistration = registerPlainThemePicker(
			bridge,
			themeRegistryStore.entries(),
		);
	};
	const reRegisterFileIconThemePicker = (): void => {
		fileIconThemePickerRegistration?.dispose();
		fileIconThemePickerRegistration = registerPlainFileIconThemePicker(
			bridge,
			themeRegistryStore.fileIconEntries(),
		);
	};
	const reRegisterProductIconThemePicker = (): void => {
		productIconThemePickerRegistration?.dispose();
		productIconThemePickerRegistration = registerPlainProductIconThemePicker(
			bridge,
			themeRegistryStore.productIconEntries(),
		);
	};
	// `F060` S3: a single import or removal can touch any/all of the three
	// axes at once (one VSIX may declare a color theme, a file icon theme
	// and a product icon theme together), so `registerPlainThemeCommands`'s
	// one re-registration callback re-registers all three pickers, not just
	// the color one `F050` S3 originally wired up.
	const reRegisterAllThemePickers = (): void => {
		reRegisterThemePicker();
		reRegisterFileIconThemePicker();
		reRegisterProductIconThemePicker();
	};
	// Every previously-imported package (from an earlier session) must
	// reappear in the picker after a restart — this is `F050` S3's own
	// consumption scope, extended by `F060` S3 to the two icon axes.
	await consumeImportedThemePackages(bridge, themeRegistryStore);
	reRegisterAllThemePickers();
	// `F050` S4/`F060` S3: only once each registry reflects every built-in
	// *and* already-imported entry can a persisted selection resolve against
	// the full set it was originally chosen from — see
	// `applyPersistedThemeSelection`'s own doc comment for why `null`/
	// no-match falls back to the default already applied above (same
	// contract for the two `applyPersisted*IconThemeSelection` siblings).
	await applyPersistedThemeSelection(
		bridge,
		themeService,
		themeRegistryStore.entries(),
	);
	await applyPersistedFileIconThemeSelection(
		bridge,
		themeService,
		themeRegistryStore.fileIconEntries(),
	);
	await applyPersistedProductIconThemeSelection(
		bridge,
		themeService,
		themeRegistryStore.productIconEntries(),
	);
	themeCommandsRegistration = registerPlainThemeCommands(
		bridge,
		themeRegistryStore,
		reRegisterAllThemePickers,
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
