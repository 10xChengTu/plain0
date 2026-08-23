import { registerPlainBuiltinThemeResources } from "./features/themes/plain-builtin-theme-extension";
import { registerPlainBuiltinGrammarResources } from "./features/themes/plain-builtin-grammar-extension";

import {
	getService,
	IContextKeyService,
	ILifecycleService,
	INotificationService,
	IWorkspaceContextService,
	initialize,
} from "@codingame/monaco-vscode-api";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { ICodeEditorService } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service";
import { IModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service";
import { ILanguageService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/languages/language.service";
import { ITextModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/resolverService.service";
import { ILanguageFeaturesService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service";
import { IMultiDiffSourceResolverService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService.service";
import { IFileService } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { LifecyclePhase } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle";
import { positionToString } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/layout/browser/layoutService";
import { IWorkbenchLayoutService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/layout/browser/layoutService.service";
import { IPaneCompositePartService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/panecomposite/browser/panecomposite.service";
import { IWorkbenchThemeService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { ITextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textEditorService.service";
import { IUntitledTextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/untitled/common/untitledTextEditorService.service";
import { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";
import { ITextMateTokenizationService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textMate/browser/textMateTokenizationFeature.service";

import { EXCLUDED_SURFACE_GUARD_MARKER } from "./excluded-surface-policy";
import { enforceExcludedWorkbenchSurfaces } from "./excluded-surfaces";
import "./features/debug/debug-contribution";
import { createPlainDebugBreakpointsContribution } from "./features/debug/plain-debug-breakpoints-contribution";
import { registerPlainDebugCommands } from "./features/debug/plain-debug-commands";
import { createAndConfigurePlainDebugRuntime } from "./features/debug/plain-debug-runtime";
import "./features/debug/plain-debug-session-alerts";
import "./features/debug/plain-debug-terminal-integration";
import { registerPlainPreferenceCommands } from "./features/preferences/plain-preference-commands";
import {
	configurePlainRemoteSshBridge,
	registerPlainRemoteSshCommands,
} from "./features/remote/plain-remote-ssh-commands";
import {
	configurePlainRemoteWorkspaceBridge,
	connectAndMountRecentRemoteRoots,
	registerPlainRemoteWorkspaceCommands,
	reportColdStartRemoteRootsNeedReconnect,
} from "./features/remote/plain-remote-workspace-commands";
import {
	createPlainUserDataFileSystemProvider,
	PLAIN_USER_DATA_SCHEME,
} from "./features/preferences/user-data-file-system-provider";
import { registerPlainSearchCommands } from "./features/search/plain-search-commands";
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
import { configurePlainGitWorktreeBridge } from "./features/scm/plain-git-worktree-view";
import { registerPlainScmCommands } from "./features/scm/plain-scm-commands";
import { configurePlainScmBridge } from "./features/scm/plain-scm-view";
import "./features/scm/scm-contribution";
import { registerWorkspaceCommands } from "./features/workspace/commands";
import { registerWorkspaceDeleteCoordinator } from "./features/workspace/delete-coordinator";
import {
	registerLocalWorkspaceCommands,
	reportInitialWorkspaceRestoreStatus,
} from "./features/workspace/local-workflow-commands";
import { registerPlainUntitledWorkflow } from "./features/workspace/untitled-workflow";
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
import { PlainLayoutStorageService } from "./services/plain-layout-storage-service";
import { configurePlainLifecycleBridge } from "./services/plain-lifecycle-service";
import { configurePlainWorkingCopyBackupBridge } from "./services/plain-workspace-backup-service";
import { flushPlainWorkingCopyBackupsForTopologyChange } from "./services/plain-workspace-backup-tracker";
import "./styles.css";

async function bootstrap(): Promise<void> {
	configureMonacoEnvironment();

	const container = document.querySelector<HTMLElement>("#workbench");
	if (container === null) {
		throw new Error("Plain bootstrap container is missing");
	}

	const bridge = createBridge();
	const userDataFileSystemProvider =
		createPlainUserDataFileSystemProvider(bridge);
	registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);
	const workspaceCapabilities = await bridge.workspaceCapabilities();
	const workspaceFileSystemProvider = createPlainWorkspaceFileSystemProvider(
		bridge,
		workspaceCapabilities,
	);
	const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
		bridge,
		workspaceFileSystemProvider,
		() => getService(INotificationService),
	);
	const workspaceConfigurationProvider =
		createPlainWorkspaceConfigurationProvider();
	registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
	registerCustomProvider(
		PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
		workspaceConfigurationProvider,
	);
	const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
	const layoutStorageService = new PlainLayoutStorageService(
		bridge,
		await bridge.layoutRead(),
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
		() => layoutStorageService.switchWorkspacePartition(),
	);
	const initialWorkspace = workspaceTopologyCoordinator.prepareInitial(
		initialWorkspaceSnapshot,
	);
	const stopListening = await bridge.onRuntimeReady((payload) => {
		document.body.dataset.plainRuntimeEvent = payload.runtime;
	});
	let workspaceCommands:
		ReturnType<typeof registerWorkspaceCommands> | undefined;
	let localWorkspaceCommands:
		ReturnType<typeof registerLocalWorkspaceCommands> | undefined;
	let untitledWorkflowRegistration:
		ReturnType<typeof registerPlainUntitledWorkflow> | undefined;
	let preferenceCommandsRegistration:
		ReturnType<typeof registerPlainPreferenceCommands> | undefined;
	let themeCommandsRegistration:
		ReturnType<typeof registerPlainThemeCommands> | undefined;
	let fileIconThemePickerRegistration:
		ReturnType<typeof registerPlainFileIconThemePicker> | undefined;
	let productIconThemePickerRegistration:
		ReturnType<typeof registerPlainProductIconThemePicker> | undefined;
	let terminalCommandsRegistration:
		ReturnType<typeof registerPlainTerminalCommands> | undefined;
	let searchCommandsRegistration:
		ReturnType<typeof registerPlainSearchCommands> | undefined;
	let scmCommandsRegistration:
		ReturnType<typeof registerPlainScmCommands> | undefined;
	let gitBlameContributionRegistration:
		ReturnType<typeof createPlainGitBlameContribution> | undefined;
	let debugCommandsRegistration:
		ReturnType<typeof registerPlainDebugCommands> | undefined;
	let debugBreakpointsContributionRegistration:
		ReturnType<typeof createPlainDebugBreakpointsContribution> | undefined;
	let remoteSshBridgeRegistration:
		ReturnType<typeof configurePlainRemoteSshBridge> | undefined;
	let remoteSshCommandsRegistration:
		ReturnType<typeof registerPlainRemoteSshCommands> | undefined;
	let remoteWorkspaceBridgeRegistration:
		ReturnType<typeof configurePlainRemoteWorkspaceBridge> | undefined;
	let remoteWorkspaceCommandsRegistration:
		ReturnType<typeof registerPlainRemoteWorkspaceCommands> | undefined;
	// `F100` S3: constructed and configured here (before `initialize()`),
	// exactly like every other `configuredBridge`-style singleton in this
	// file — `debug-contribution.ts` registers the three debug `ViewPane`s'
	// `ctorDescriptor`s at module-import time, long before the Workbench
	// actually constructs one, so this must be ready the instant
	// `initialize()` runs.
	const debugRuntime = createAndConfigurePlainDebugRuntime(bridge);
	window.addEventListener(
		"pagehide",
		() => {
			void stopListening();
			workspaceCommands?.dispose();
			localWorkspaceCommands?.dispose();
			untitledWorkflowRegistration?.dispose();
			preferenceCommandsRegistration?.dispose();
			workspaceDeleteCoordinator.dispose();
			themeCommandsRegistration?.dispose();
			fileIconThemePickerRegistration?.dispose();
			productIconThemePickerRegistration?.dispose();
			terminalCommandsRegistration?.dispose();
			searchCommandsRegistration?.dispose();
			scmCommandsRegistration?.dispose();
			gitBlameContributionRegistration?.dispose();
			debugCommandsRegistration?.dispose();
			debugBreakpointsContributionRegistration?.dispose();
			debugRuntime.session.dispose();
			remoteSshCommandsRegistration?.dispose();
			remoteSshBridgeRegistration?.dispose();
			remoteWorkspaceCommandsRegistration?.dispose();
			remoteWorkspaceBridgeRegistration?.dispose();
		},
		{ once: true },
	);
	const runtime = await bridge.runtimeInfo();
	document.body.dataset.plainRuntime = runtime.runtime;
	document.body.dataset.plainIpcVersion = String(runtime.ipcVersion);

	configurePlainWorkingCopyBackupBridge(bridge);
	configurePlainLifecycleBridge(bridge);
	configurePlainSearchBridge(bridge);
	configurePlainTerminalBridge(bridge);
	configurePlainScmBridge(bridge);
	configurePlainGitHistoryBridge(bridge);
	configurePlainGitGraphBridge(bridge);
	configurePlainGitStashBridge(bridge);
	configurePlainGitWorktreeBridge(bridge);
	await initialize(createServiceOverrides(layoutStorageService), container, {
		// `F120` S0 (`docs/research/2026-07-29-branding-packaging.md`, "结论
		// 2.1"/"5.1"): the vendor `product.json.js` blob `initialize()` mixes
		// in underneath this override still ships full Code OSS branding
		// (`"Code - OSS"`, `code-oss`, `.vscode-oss`, microsoft.com URLs, a
		// GitHub Copilot `defaultChatAgent` block, etc.) as the live,
		// currently-bundled `IProductService` singleton's field values --
		// `mixin()` only shallow-merges what is listed here on top of that
		// blob, so every field Plain cares about must be named explicitly.
		// `dataFolderName`/`urlProtocol` are security-relevant, not cosmetic:
		// left at their Code OSS defaults, Plain would read/write the same
		// user-data directory and claim the same URL scheme as a real,
		// separately-installed VS Code on the same machine. This object is a
		// closed set locked by `scripts/plain/boundary-contracts.mjs`'s
		// `validateProductConfigurationBoundary` (see
		// `EXPECTED_PRODUCT_CONFIGURATION` there for the field-by-field
		// rationale) -- do not add or remove a field here without updating
		// that lock in the same change.
		productConfiguration: {
			nameShort: "Plain",
			nameLong: "Plain",
			applicationName: "plain",
			dataFolderName: ".plain",
			sharedDataFolderName: ".plain-shared",
			urlProtocol: "plain",
			reportIssueUrl: "https://github.com/10xChengTu/plain0/issues/new",
			licenseUrl: "https://github.com/10xChengTu/plain0/blob/main/LICENSE.txt",
			serverApplicationName: "plain-server",
		},
		configurationDefaults: {
			"window.menuBarVisibility": "hidden",
			// Tauri's native CloseCoordinator already owns the complete close
			// confirmation/veto/flush sequence. The Workbench Web default
			// `keyboardOnly` otherwise adds a second confirmation veto after a
			// Cmd shortcut and prevents the native final storage flush.
			"window.confirmBeforeClose": "never",
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
	// Plain owns the primary-side-bar position per stable workspace root set.
	// The paired audited vendor patch makes the layout actions update the
	// Workbench runtime state directly instead of persisting VS Code's legacy
	// global `workbench.sideBar.location` setting. Seed its menu/context state
	// from the position restored out of PlainLayoutStorageService.
	const workbenchLayoutService = await getService(IWorkbenchLayoutService);
	const sideBarPositionContext = (
		await getService(IContextKeyService)
	).createKey<string>("plain.workbench.sideBarPosition", "left");
	sideBarPositionContext.set(
		positionToString(workbenchLayoutService.getSideBarPosition()),
	);
	layoutStorageService.configureWorkspaceRuntime({
		layoutService: workbenchLayoutService,
		paneCompositePartService: await getService(IPaneCompositePartService),
		setSideBarPositionContext: (position) =>
			sideBarPositionContext.set(position),
	});
	registerPlainBuiltinThemeResources();
	registerPlainBuiltinGrammarResources(await getService(ILanguageService));
	await workspaceTopologyCoordinator.completeInitial();
	workspaceCommands = registerWorkspaceCommands(
		bridge,
		await getService(IContextKeyService),
		workspaceTopologyCoordinator,
	);
	localWorkspaceCommands = registerLocalWorkspaceCommands(
		bridge,
		workspaceTopologyCoordinator,
		flushPlainWorkingCopyBackupsForTopologyChange,
		// `F220` S4 (ADR 0007 §4): "Open Recent" selecting an entry with
		// remote roots drives the same connect-then-authorize flow
		// `Plain: Reconnect Remote Session…`'s own `"pending"` branch uses —
		// wired here rather than as a direct `features/workspace` →
		// `features/remote` import, keeping the two features decoupled.
		(remoteRoots) => connectAndMountRecentRemoteRoots(remoteRoots),
	);
	untitledWorkflowRegistration = registerPlainUntitledWorkflow(
		bridge,
		workspaceTopologyCoordinator,
		workspaceFileSystemProvider,
		{
			editorService: await getService(IEditorService),
			textEditorService: await getService(ITextEditorService),
			untitledTextEditorService: await getService(IUntitledTextEditorService),
			workingCopyBackupService: await getService(IWorkingCopyBackupService),
			dialogService: await getService(IDialogService),
			notificationService: await getService(INotificationService),
		},
	);
	await reportInitialWorkspaceRestoreStatus(
		bridge,
		await getService(INotificationService),
	);
	// `F220` S4 (ADR 0007 §4): cold start never auto-connects a remote root —
	// `reportInitialWorkspaceRestoreStatus` above only ever restored the
	// *local* half of the last workspace. A second, independent
	// `workspace_recent_list` round trip (rather than threading the first
	// call's own result through a changed signature, which would disturb
	// `workspace-topology-contracts.mjs`'s pinned call-site shape for that
	// exact statement) reads the same MRU entry's `remoteRoots` and surfaces
	// one "needs reconnect" notification per remote root it names.
	await reportColdStartRemoteRootsNeedReconnect(
		bridge,
		await getService(INotificationService),
	);
	preferenceCommandsRegistration = registerPlainPreferenceCommands();
	terminalCommandsRegistration = registerPlainTerminalCommands();
	searchCommandsRegistration = registerPlainSearchCommands();
	scmCommandsRegistration = registerPlainScmCommands(bridge);
	// `F090` S0: inline blame decoration + hover + age heatmap — see
	// `plain-git-blame-contribution.ts`'s own module doc comment.
	gitBlameContributionRegistration = createPlainGitBlameContribution(
		bridge,
		await getService(ICodeEditorService),
		await getService(ILanguageFeaturesService),
		await getService(IWorkspaceContextService),
	);

	// `F100` S3: breakpoint glyph margin + "Plain: Start/Stop Debugging" —
	// see `plain-debug-breakpoints-contribution.ts`'s own module doc comment.
	debugCommandsRegistration = registerPlainDebugCommands();
	debugBreakpointsContributionRegistration =
		createPlainDebugBreakpointsContribution(
			await getService(ICodeEditorService),
			await getService(IWorkspaceContextService),
			debugRuntime.breakpoints,
			debugRuntime.session,
		);

	// `F220` S1: "Plain: Connect to SSH Host…"/"Disconnect SSH Session…"/
	// "Forget SSH Host Key…" plus the one persistent
	// `remoteSessionWatchEvent` notification listener — see
	// `plain-remote-ssh-commands.ts`'s own module doc comment for why this
	// needs a real `INotificationService` instance (unlike
	// `configurePlainTerminalBridge` above, which runs before `initialize()`)
	// and therefore is wired here rather than alongside that earlier group.
	remoteSshBridgeRegistration = configurePlainRemoteSshBridge(
		bridge,
		await getService(INotificationService),
	);
	remoteSshCommandsRegistration = registerPlainRemoteSshCommands();

	// `F220` S3: "Plain: Open Remote Folder…"/"Plain: Refresh Remote Folder"
	// — needs the same topology coordinator `registerWorkspaceCommands`
	// (below) drives root-set mutations through, plus the workspace file
	// system provider's own rescan-on-demand capability.
	remoteWorkspaceBridgeRegistration = configurePlainRemoteWorkspaceBridge(
		bridge,
		workspaceTopologyCoordinator,
		workspaceFileSystemProvider,
		{
			notificationService: await getService(INotificationService),
			dialogService: await getService(IDialogService),
			quickInputService: await getService(IQuickInputService),
		},
	);
	remoteWorkspaceCommandsRegistration = registerPlainRemoteWorkspaceCommands();

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
			rootId: string,
			rev: "head" | "index",
			relativePath: string,
		): Promise<string | null> => {
			const reference = await textModelService.createModelReference(
				encodeGitResourceUri(rootId, rev, relativePath),
			);
			try {
				return reference.object.textEditorModel.getValue();
			} finally {
				reference.dispose();
			}
		};
		(
			window as unknown as Record<string, unknown>
		).__PLAIN_TEST_TOKENIZE_WORKSPACE_LINE__ = async (
			rootId: string,
			relativePath: string,
			lineNumber = 1,
		): Promise<Readonly<{
			languageId: string;
			tokens: readonly Readonly<{
				startIndex: number;
				endIndex: number;
				scopes: readonly string[];
			}>[];
		}> | null> => {
			const model = modelServiceForGitContent
				.getModels()
				.find(
					(candidate) =>
						candidate.uri.scheme === "plain-workspace" &&
						candidate.uri.authority === rootId &&
						candidate.uri.path === `/${relativePath}`,
				);
			if (
				model === undefined ||
				lineNumber < 1 ||
				lineNumber > model.getLineCount()
			) {
				return null;
			}
			const languageId = model.getLanguageId();
			const grammar = await (
				await getService(ITextMateTokenizationService)
			).createTokenizer(languageId);
			if (grammar === null) {
				return null;
			}
			const line = model.getLineContent(lineNumber);
			const tokens = grammar
				.tokenizeLine(line, null)
				.tokens.map(
					(token: {
						readonly startIndex: number;
						readonly endIndex: number;
						readonly scopes: readonly string[];
					}) => ({
						startIndex: token.startIndex,
						endIndex: token.endIndex,
						scopes: Object.freeze([...token.scopes]),
					}),
				);
			return Object.freeze({
				languageId,
				tokens: Object.freeze(tokens),
			});
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
	// `initialize()` resolves once services reach LifecyclePhase.Ready, while
	// Workbench layout restoration continues asynchronously and can still apply
	// its own stored/unloaded theme before LifecyclePhase.Restored. Chromium's
	// Browser E2E happened to settle in the opposite order, but a real WKWebView
	// reproducibly overwrote both Plain's default and a persisted imported theme
	// after these calls returned. Do not apply a theme axis before restoration;
	// the actual default/persisted apply block also stays after imported-package
	// consumption below so no asynchronous registration work can supersede it.
	await (await getService(ILifecycleService)).when(LifecyclePhase.Restored);
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
	// This is the final startup theme authority: establish each default only
	// after the full imported registry exists, then replace it with a valid
	// persisted choice where one exists. Keeping these six calls adjacent also
	// makes a missing/stale selection reliably leave Dark Modern/vs-minimal/
	// Default active in a real WKWebView.
	await applyDefaultColorTheme(themeService, themeRegistry);
	await applyDefaultFileIconTheme(themeService, fileIconThemeRegistry);
	await applyDefaultProductIconTheme(themeService);
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
