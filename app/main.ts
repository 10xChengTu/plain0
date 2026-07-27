import "@codingame/monaco-vscode-theme-defaults-default-extension";

import {
	getService,
	IContextKeyService,
	IWorkspaceContextService,
	initialize,
} from "@codingame/monaco-vscode-api";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { ICodeEditorService } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service";
import { IModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service";
import { ITextModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/resolverService.service";
import { ILanguageFeaturesService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service";
import { IMultiDiffSourceResolverService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService.service";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";

import { EXCLUDED_SURFACE_GUARD_MARKER } from "./excluded-surface-policy";
import { enforceExcludedWorkbenchSurfaces } from "./excluded-surfaces";
import "./features/search/search-contribution";
import "./features/terminal/terminal-contribution";
import { registerPlainTerminalCommands } from "./features/terminal/plain-terminal-commands";
import { configurePlainTerminalBridge } from "./features/terminal/plain-terminal-view";
import { encodeGitResourceUri, GIT_URI_SCHEME } from "./features/scm/git-uri";
import { createPlainGitBlameContribution } from "./features/scm/plain-git-blame-contribution";
import {
	createPlainGitCommitBlobContentProvider,
	createPlainGitCommitMultiDiffSourceResolver,
	PLAIN_GIT_COMMIT_BLOB_SCHEME,
} from "./features/scm/plain-git-commit-detail";
import { createPlainGitTextModelContentProvider } from "./features/scm/plain-git-content-provider";
import { configurePlainGitGraphBridge } from "./features/scm/plain-git-graph-view";
import { configurePlainGitHistoryBridge } from "./features/scm/plain-git-history-view";
import { configurePlainGitStashBridge } from "./features/scm/plain-git-stash-view";
import { registerPlainScmCommands } from "./features/scm/plain-scm-commands";
import { configurePlainScmBridge } from "./features/scm/plain-scm-view";
import "./features/scm/scm-contribution";
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
	let terminalCommandsRegistration:
		ReturnType<typeof registerPlainTerminalCommands> | undefined;
	let scmCommandsRegistration:
		ReturnType<typeof registerPlainScmCommands> | undefined;
	let gitBlameContributionRegistration:
		ReturnType<typeof createPlainGitBlameContribution> | undefined;
	window.addEventListener(
		"pagehide",
		() => {
			void stopListening();
			workspaceCommands?.dispose();
			workspaceDeleteCoordinator.dispose();
			themeCommandsRegistration?.dispose();
			fileIconThemePickerRegistration?.dispose();
			productIconThemePickerRegistration?.dispose();
			terminalCommandsRegistration?.dispose();
			scmCommandsRegistration?.dispose();
			gitBlameContributionRegistration?.dispose();
		},
		{ once: true },
	);
	const runtime = await bridge.runtimeInfo();
	document.body.dataset.plainRuntime = runtime.runtime;
	document.body.dataset.plainIpcVersion = String(runtime.ipcVersion);

	configurePlainWorkingCopyBackupBridge(bridge);
	configurePlainSearchBridge(bridge);
	configurePlainTerminalBridge(bridge);
	configurePlainScmBridge(bridge);
	configurePlainGitHistoryBridge(bridge);
	configurePlainGitGraphBridge(bridge);
	configurePlainGitStashBridge(bridge);
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
	terminalCommandsRegistration = registerPlainTerminalCommands();
	scmCommandsRegistration = registerPlainScmCommands();
	// `F090` S0: inline blame decoration + hover + age heatmap — see
	// `plain-git-blame-contribution.ts`'s own module doc comment.
	gitBlameContributionRegistration = createPlainGitBlameContribution(
		bridge,
		await getService(ICodeEditorService),
		await getService(ILanguageFeaturesService),
		await getService(IWorkspaceContextService),
	);

	// `F080` S2: the `git:` read-only content provider (decision 4) — a
	// `PlainScmProvider.getOriginalResource` URI is only ever resolved once
	// something (a future diff editor, this slice's Browser E2E) asks
	// `ITextModelService` to create a model reference for it; registering
	// here (rather than lazily inside the view) means it is available the
	// moment any `git:` URI exists, independent of whether the Source
	// Control view itself has ever been opened.
	const textModelService = await getService(ITextModelService);
	const modelServiceForGitContent = await getService(IModelService);
	const gitContentProvider = createPlainGitTextModelContentProvider(
		bridge,
		modelServiceForGitContent,
	);
	textModelService.registerTextModelContentProvider(
		GIT_URI_SCHEME,
		gitContentProvider,
	);
	// DEV-only Browser E2E diagnostic hook — mirrors
	// `window.__PLAIN_WORKBENCH_SURFACES__` below (same `import.meta.env.DEV`
	// gate, same "real Chromium can resolve internal Workbench state that
	// Playwright itself has no other way to reach" purpose): resolves a
	// `git:` URI through the exact same registered `ITextModelService`
	// `PlainScmProvider.getOriginalResource` itself returns, proving the
	// `git_show_blob` → content-provider → model pipeline end to end rather
	// than only unit-testing `PlainGitTextModelContentProvider` in isolation.
	if (import.meta.env.DEV) {
		(
			window as unknown as Record<string, unknown>
		).__PLAIN_TEST_RESOLVE_GIT_TEXT__ = async (
			rev: "head" | "index",
			relativePath: string,
		): Promise<string | null> => {
			const reference = await textModelService.createModelReference(
				encodeGitResourceUri(rev, relativePath),
			);
			try {
				return reference.object.textEditorModel.getValue();
			} finally {
				reference.dispose();
			}
		};
	}

	// `F090` S2: the `plain-git-commit-blob:` read-only content provider and
	// the `plain-git-commit:` multi-diff source resolver — registered here for
	// the same "available independent of whether any view has opened it yet"
	// reason as the `git:` provider immediately above. Never touches
	// `PlainScmProvider.historyProvider` (still `constObservable(undefined)`)
	// and never consumes the multi-diff-editor override's own bundled
	// `ScmMultiDiffSourceResolverContribution` — see `plain-git-commit-
	// detail.ts`'s own module doc comment for the full audit trail.
	const gitCommitBlobContentProvider = createPlainGitCommitBlobContentProvider(
		bridge,
		modelServiceForGitContent,
	);
	textModelService.registerTextModelContentProvider(
		PLAIN_GIT_COMMIT_BLOB_SCHEME,
		gitCommitBlobContentProvider,
	);
	const multiDiffSourceResolverService = await getService(
		IMultiDiffSourceResolverService,
	);
	multiDiffSourceResolverService.registerResolver(
		createPlainGitCommitMultiDiffSourceResolver(bridge),
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
