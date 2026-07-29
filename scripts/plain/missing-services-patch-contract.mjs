// `F110` S2 (`docs/research/2026-07-28-legacy-retirement.md`, "主导会话裁定"
// point 1): the patch this module guards deletes the `mcp` (16),
// `syncEditSessions` (8) and 9-of-10 non-`globalCompositeBar` `authAccount`
// debt-source tokens' `import`/`class`/`registerSingleton` three-part
// registration from `@codingame/monaco-vscode-api`'s `missing-services.js`,
// and the matching `export { X } from 'Y'` re-export line from that same
// package's `services.js` (a *second*, independent reachability path into the
// bundle this slice discovered empirically — deleting only the
// `missing-services.js` copy left every one of these files in the real
// `dist` output, because `services.js`'s own re-export line keeps the
// underlying vendor file reachable regardless of whether
// `missing-services.js` still registers anything against it).
//
// `F110` S3 (same research document, `chatAgent` clear-out, the largest and
// most-populated of the six categories) extends the same two-file surgery to
// 89 more tokens covering the `chat`/`inlineChat`/`agentHost`/
// `agentEditorComments`/`agentPlugins`/`agentsVoice` trees. S3 also
// discovered two things S2's smaller scope never surfaced:
//
// 1. Several tokens registered in `missing-services.js` are **not** ever
//    re-exported by `services.js` at all (`REMOVED_MISSING_SERVICES_TOKENS`
//    is therefore *not* a subset check against `REMOVED_SERVICES_REEXPORT_TOKENS`
//    for S3's share — unlike S2's 34, where all 34 happened to also be
//    re-exported).
// 2. A real dependency-graph audit restricted to the *actual, currently
//    bundled* 2179-source corpus (not a static grep over the whole vendor
//    tree, which is dominated by false positives from generic filenames and
//    dead vendor code that never reaches the real bundle) found **seven**
//    chat-family tokens that real, always-instantiated Plain features
//    depend on as **non-optional constructor parameters** — removing their
//    registration would not just leave dead code behind, it would throw a
//    "service not registered" error the moment a user opened the Command
//    Palette (`Ctrl+Shift+P`) or Quick Open (`Ctrl+P` / Go to Symbol /
//    Workspace Symbols), because `@codingame/monaco-vscode-quickaccess-service-override`'s
//    `CommandsQuickAccessProvider` and `@codingame/monaco-vscode-api`'s own
//    `AnythingQuickAccessProvider`/`GotoSymbolQuickAccessProvider`/
//    `SymbolsQuickAccessProvider` inject `IChatAgentService`/`IChatWidgetService`
//    (respectively) with no `optional()` wrapper. These seven are
//    deliberately kept registered — see `KEPT_TOKEN_REGISTRATIONS` below —
//    exactly as S2 kept `IAuthenticationService` for `globalCompositeBar.js`'s
//    sake, just seven of them instead of one.
//
// `F110` S4 (same research document, "主导会话裁定" point 2) finally removes
// `IAuthenticationService`'s own `import`/`class`/`registerSingleton`
// three-part registration — the one token S2 could not remove because
// `globalCompositeBar.js` injected it as a non-optional constructor
// dependency (`AccountsActivityActionViewItem`). S4 migrates
// `globalCompositeBar.js`'s surviving, reachable logic (the "Manage" gear)
// into `app/features/workbench/plain-global-composite-bar.ts` as
// `PlainGlobalCompositeBar`/`PlainGlobalActivityActionViewItem`, dropping
// `AccountsActivityActionViewItem` entirely (that class's whole reason to
// exist — the account UI branch — was already dead code from an earlier
// patch; see that file's own doc comment). With no class anywhere in the
// migrated code injecting `IAuthenticationService`, the registration this
// slice previously had to keep is now provably unused, so
// `REMOVED_MISSING_SERVICES_TOKENS`' `authAccount` section grows from 8 to 9
// (all of them now removed) and `KEPT_TOKEN_REGISTRATIONS` shrinks from eight
// entries to seven (S3's chat-family tokens only).
//
// `F110` S5 (same research document, "主导会话裁定" point 3): extends the same
// two-file surgery to 12 `extensionRuntime` registrations
// (`platform/debug/common/extensionHostDebug.service.js`'s
// `IExtensionHostDebugService`; the platform-level
// `extensionsScannerService.service.js`/`extensionsProfileScannerService.service.js`/
// `extensions.service.js` (builtin scanner)/`extensionStorage.service.js`
// tokens; the workbench-level `extensionManifestPropertiesService.service.js`/
// `extensionUrlHandler.service.js`/`extensionBisect.service.js`/
// `extensionFeatures.service.js`/`extensionGalleryManifest.service.js`
// tokens; and — the one this slice's whole surgery centers on —
// `IExtensionService`/`NullExtensionService` itself). Unlike every earlier
// category, `extensionRuntime` is not driven to zero: `docs/bundle-baseline.json`'s
// `categoryNotes.extensionRuntime` is the full per-file enumeration of what
// remains and why. This module's own share of that evidence is
// `KEPT_TOKEN_REGISTRATIONS`' nine new S5 entries below (real, currently
// bundled, non-optional consumers a dependency-graph audit found *outside*
// missing-services.js/services.js's own facade) — a real content check that
// none of these nine registrations have been silently deleted alongside the
// 12 that were.
//
// The `IExtensionService` removal is also paired with a third change this
// module does not itself assert (out of its own scope: it only checks
// `missing-services.js`/`services.js`): `services.js`'s `initialize()` no
// longer spreads `getServiceOverride$4()` (the vendor's own
// extensions-service-override package's default export) into the service
// collection at all, and `app/services.ts`'s own `createServiceOverrides()`
// now binds `IExtensionService` to `app/services/plain-null-extension-service.ts`'s
// `PlainNullExtensionService` — Plain's own, directly testable inert
// implementation, replacing what used to be a real, instantiated
// `ExtensionServiceOverride` (host creation was already impossible via the
// existing `DisabledExtensionHostFactory`/`DisabledExtensionHostKindPicker`
// patch to that package, but the object itself was real). That whole
// vendor package — 11 bundle sources — drops out of the bundle once
// `services.js` stops importing it, since a real audit confirmed no other
// installed package or `app/` source imports it at all.
//
// `scripts/plain/workbench-patch-contracts.mjs` already locks the *patch
// file's own bytes* (sha256) and its diff/hunk-header shape. That catches "a
// human or agent hand-edited the `.patch` file (or ran `pnpm patch-commit`
// with unintended changes) without updating the audited hash" — but it does
// **not** catch "a future `@codingame/monaco-vscode-api` version bump changed
// `missing-services.js`/`services.js` enough that the patch either fails to
// apply (a hard, loud pnpm-install error — already a strong existing
// safeguard) or, worse, applies with fuzz/coincidental context match and
// silently produces a *semantically* wrong result" — e.g. the patch happens
// to still apply because nearby context lines match, but the specific
// tokens this slice assumed gone have crept back in via a differently-shaped
// registration this patch's exact line-range deletions never touch.
//
// This module is the "the shape hasn't drifted out from under our
// assumptions" contract the "主导会话裁定" point 1 requires for every new
// patch hunk. It asserts against the *patched, currently-installed* file
// content (not the pristine upstream source) for two reasons: (a) the
// pristine pre-patch source isn't persisted anywhere inside the repo or
// workspace once `pnpm patch-commit` completes, only the diff is; (b) what
// actually matters for correctness is the shape of what ends up running, not
// what the patch's diff context happens to look like.
//
// What this **can** prove: none of the removed tokens are reachable through
// either of the two files this patch touches, and every token this slice
// deliberately keeps bound (S3's seven chat-family tokens; F110 S4 removed
// the last non-chat-family kept token, `IAuthenticationService`) is still
// registered.
//
// What this **cannot** prove: that some *third*, not-yet-discovered
// reachability path (a future vendor file added by an upstream version bump,
// or a currently-dead file this slice never had reason to inspect) doesn't
// independently resurrect one of these tokens. That residual risk is exactly
// what `scripts/plain/check-bundle.mjs`'s per-category ratchet ceilings exist
// to catch at the full-bundle level — this module is a faster, more directly
// diagnostic *first* line of defense (runs against `node_modules` during
// `check:architecture`, no `vite build` required, and names the exact token
// instead of a bare category-count delta), not a replacement for the ratchet.

export const REMOVED_MISSING_SERVICES_TOKENS = Object.freeze([
	// --- F110 S2 (34 registrations) ---
	// mcp (12 registrations; the other 4 mcp debt files —
	// mcpManagement.js, mcpManagementIpc.js, mcpManagementService.js,
	// modelContextProtocol.js — were never separately registered, only
	// pulled in transitively by these tokens' registrations)
	"IMcpGalleryService",
	"IAllowedMcpServersService",
	"IMcpResourceScannerService",
	"IMcpRegistry",
	"IMcpService",
	"IMcpWorkbenchService",
	"IMcpSamplingService",
	"IMcpElicitationService",
	"IWorkbenchMcpManagementService",
	"IMcpGalleryManifestService",
	"IWorkbenchMcpGatewayService",
	"IMcpSandboxService",
	// syncEditSessions (14 registrations)
	"IIgnoredExtensionsManagementService",
	"IUserDataAutoSyncService",
	"IUserDataSyncEnablementService",
	"IUserDataSyncStoreManagementService",
	"IUserDataSyncStoreService",
	"IUserDataSyncLogService",
	"IUserDataSyncService",
	"IUserDataSyncResourceProviderService",
	"IUserDataSyncLocalStoreService",
	"IUserDataSyncUtilService",
	"IUserDataSyncAccountService",
	"IUserDataSyncMachinesService",
	"IEditSessionsLogService",
	"IEditSessionsStorageService",
	// authAccount (all 9 non-globalCompositeBar registrations — F110 S4 removed
	// the 9th, IAuthenticationService, once globalCompositeBar.js's migration
	// into app/ dropped the only class that ever injected it as a non-optional
	// constructor dependency; nothing is kept in this category anymore)
	"IAuthenticationAccessService",
	"IAuthenticationMcpAccessService",
	"IAuthenticationMcpService",
	"IAuthenticationMcpUsageService",
	"IAuthenticationUsageService",
	"IAuthenticationExtensionsService",
	"IAuthenticationQueryService",
	"IDynamicAuthenticationProviderStorageService",
	"IAuthenticationService",

	// --- F110 S3 (89 registrations/imports) ---
	"AgentStatusMode",
	"ChatEntitlement",
	"IAICustomizationItemsModel",
	"IAICustomizationWorkspaceService",
	"IAgentEditorCommentsBridge",
	"IAgentHostActiveClientService",
	"IAgentHostConnectionsService",
	"IAgentHostCustomizationService",
	"IAgentHostDebugLogsExportService",
	"IAgentHostFileSystemService",
	"IAgentHostNewSessionFolderService",
	"IAgentHostResourceService",
	"IAgentHostService",
	"IAgentHostSessionWorkingDirectoryResolver",
	"IAgentHostToolSetEnablementService",
	"IAgentHostUntitledProvisionalSessionService",
	"IAgentPluginRepositoryService",
	"IAgentPluginService",
	"IAgentSessionProjectionService",
	"IAgentSessionsService",
	"IAgentTitleBarStatusService",
	"IAgentsVoiceWindowService",
	"IChatArtifactsService",
	"IChatAttachmentResolveService",
	"IChatAttachmentWidgetRegistry",
	"IChatContextPickService",
	"IChatContextService",
	"IChatDebugService",
	"IChatEditingExplanationModelManager",
	"IChatEditingService",
	"IChatEntitlementService",
	"IChatGoalSummaryService",
	"IChatImageCarouselService",
	"IChatInputNotificationService",
	"IChatLayoutService",
	"IChatMarkdownAnchorService",
	"IChatModeService",
	"IChatOutputPartStateCache",
	"IChatOutputRendererService",
	"IChatPhoneInputPresenter",
	"IChatResponseFileChangesService",
	"IChatResponseResourceFileSystemProvider",
	"IChatService",
	"IChatSessionsService",
	"IChatSlashCommandService",
	"IChatStatusItemService",
	"IChatTipService",
	"IChatTodoListService",
	"IChatToolRiskAssessmentService",
	"IChatTransferService",
	"IChatVariablesService",
	"IChatWidgetHistoryService",
	"ICodeCompareModelService",
	"ICodeMapperService",
	"ICustomizationHarnessService",
	"IInlineChatSessionService",
	"ILanguageModelIgnoredFilesService",
	"ILanguageModelStatsService",
	"ILanguageModelToolsConfirmationService",
	"ILanguageModelToolsService",
	"ILanguageModelsConfigurationService",
	"ILanguageModelsService",
	"IMicCaptureService",
	"IPlanReviewFeedbackService",
	"IPluginGitService",
	"IPluginInstallService",
	"IPluginMarketplaceService",
	"IPromptsService",
	"IRemoteAgentHostService",
	"IRemoteCodingAgentsService",
	"ISSHRemoteAgentHostService",
	"ITerminalChatService",
	"IToolResultCompressor",
	"ITtsPlaybackService",
	"IVoiceClientService",
	"IVoicePlaybackService",
	"IVoiceSessionController",
	"IVoiceToolDispatchService",
	"IVoiceTranscriptStore",
	"IWorkspacePluginSettingsService",
	"NullAgentHostService",
	"NullRemoteAgentHostService",
	"NullSSHRemoteAgentHostService",
	"SessionType",
	"Target",
	"ToolDataSource",
	"ToolSet",
	"VSCodeToolReference",
	"createVSCodeHarnessDescriptor",

	// --- F110 S5 (12 registrations, `extensionRuntime`) ---
	"IExtensionHostDebugService",
	"IExtensionsScannerService",
	"IExtensionsProfileScannerService",
	"IBuiltinExtensionsScannerService",
	"IExtensionStorageService",
	"IExtensionManifestPropertiesService",
	"IExtensionUrlHandler",
	"IExtensionBisectService",
	"IExtensionFeaturesManagementService",
	"IExtensionGalleryManifestService",
	"IExtensionService",
	"NullExtensionService",
]);

// The 32 tokens above that are imported by missing-services.js but were
// never *also* re-exported by services.js's facade (pure enums, plain
// consts, or imported concrete classes used only as a registerSingleton
// implementation argument, e.g. `NullAgentHostService`) -- removing them
// from missing-services.js is sufficient on its own; there is no second
// services.js re-export line to also delete for these specific names. Kept
// as an explicit list (rather than silently computed) so a future slice
// cannot accidentally assume every missing-services.js token has a services.js
// mirror -- S2's 34 happened to (by coincidence, not necessity), S3's 89 do
// not.
const S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED = Object.freeze([
	"AgentStatusMode",
	"ChatEntitlement",
	"IAICustomizationItemsModel",
	"IAgentHostResourceService",
	"IAgentSessionProjectionService",
	"IAgentTitleBarStatusService",
	"IChatArtifactsService",
	"IChatEditingExplanationModelManager",
	"IChatImageCarouselService",
	"IChatInputNotificationService",
	"IChatModeService",
	"IChatOutputRendererService",
	"IChatPhoneInputPresenter",
	"IChatResponseResourceFileSystemProvider",
	"IChatSessionsService",
	"IChatTipService",
	"IChatTodoListService",
	"IChatToolRiskAssessmentService",
	"ILanguageModelsConfigurationService",
	"IPlanReviewFeedbackService",
	"ITerminalChatService",
	"IToolResultCompressor",
	"IWorkspacePluginSettingsService",
	"NullAgentHostService",
	"NullRemoteAgentHostService",
	"NullSSHRemoteAgentHostService",
	"SessionType",
	"Target",
	"ToolDataSource",
	"ToolSet",
	"VSCodeToolReference",
	"createVSCodeHarnessDescriptor",
]);

// services.js's own `export { X } from 'Y'` facade re-exports a subset of
// REMOVED_MISSING_SERVICES_TOKENS, plus one name that was never part of
// missing-services.js's own registration set at all:
// - `IMcpManagementService`: the base token `IWorkbenchMcpManagementService`
//   (already in the list above) is derived from via
//   `refineServiceDecorator(IMcpManagementService)` in
//   `mcpWorkbenchManagementService.service.js` — real consumer sweep found no
//   other reachable reference to it once that refinement's own file is gone.
// `IAuthenticationService` used to be a second such special case (F110 S2
// kept its missing-services.js registration for globalCompositeBar.js's sake
// but still dropped its services.js facade re-export, since nothing in
// `app/` ever imported it from the bare `"@codingame/monaco-vscode-api"`
// package). F110 S4 folded it into the general mechanism instead: now that
// `IAuthenticationService` is a genuine `REMOVED_MISSING_SERVICES_TOKENS`
// member (not excluded from `S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED`), the
// filtered spread below already includes it — no hardcoded second entry is
// needed anymore.
export const REMOVED_SERVICES_REEXPORT_TOKENS = Object.freeze([
	...REMOVED_MISSING_SERVICES_TOKENS.filter(
		(token) => !S3_MISSING_SERVICES_ONLY_NOT_REEXPORTED.includes(token),
	),
	"IMcpManagementService",
]);

// F110 S3: seven chat-family tokens a real dependency-graph audit (restricted
// to the actual, currently bundled 2179-source corpus, not a static grep
// over the whole vendor tree) found are non-optional constructor
// dependencies of always-instantiated Plain features:
//
// - `IQuickChatService`/`IChatWidgetService`/`IChatAccessibilityService`/
//   `IChatCodeBlockContextProviderService` all come from the same
//   `chat/browser/chat.service.js` file. `IChatWidgetService` alone is
//   injected as a non-optional `__param` by THREE real, always-registered
//   Quick Access providers: `AnythingQuickAccessProvider` ("Go to Anything",
//   `@codingame/monaco-vscode-api`'s own `anythingQuickAccess.js`),
//   `GotoSymbolQuickAccessProvider` ("Go to Symbol in File",
//   `gotoSymbolQuickAccess.js`) and `SymbolsQuickAccessProvider` ("Go to
//   Symbol in Workspace", `symbolsQuickAccess.js`). Since the file stays
//   reachable regardless (for `IChatWidgetService`'s sake), and none of the
//   other three tokens it exports has an independent reason to be removed,
//   all four registrations are kept as a group rather than splitting the one
//   file's import line for zero file-count benefit.
// - `IChatAgentService` is a non-optional `__param` of
//   `@codingame/monaco-vscode-quickaccess-service-override`'s
//   `CommandsQuickAccessProvider` -- i.e. the Command Palette
//   (`Ctrl+Shift+P`) itself. `IChatAgentNameService` shares the same
//   `chat/common/participants/chatAgents.service.js` import line and has no
//   independent reason to be removed either, so both stay.
// - `IAgentNetworkFilterService` is a non-optional `__param` of
//   `browserView.js`'s real `BrowserViewModel` ("Share with Agent" +
//   Playwright-based agent browser-observation bridge). Untangling this
//   would require refactoring `BrowserViewModel`'s tracked-sharing-state
//   machinery (`IPlaywrightService` alone is threaded through five separate
//   call sites in that class) -- a materially deeper surgery than a
//   dependency-line removal, out of scope for this slice. Flagged as a
//   follow-up candidate, not attempted here.
export const KEPT_TOKEN_REGISTRATIONS = Object.freeze([
	{
		token: "IQuickChatService",
		pattern:
			/registerSingleton\(\s*IQuickChatService\s*,\s*QuickChatService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"AnythingQuickAccessProvider/GotoSymbolQuickAccessProvider/SymbolsQuickAccessProvider all import chat.service.js for the sibling IChatWidgetService token below, so the file stays reachable regardless; kept alongside it rather than split for zero benefit",
	},
	{
		token: "IChatWidgetService",
		pattern:
			/registerSingleton\(\s*IChatWidgetService\s*,\s*ChatWidgetService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"non-optional __param of AnythingQuickAccessProvider (anythingQuickAccess.js), GotoSymbolQuickAccessProvider (gotoSymbolQuickAccess.js) and SymbolsQuickAccessProvider (symbolsQuickAccess.js) -- three real, always-registered Quick Access providers (Go to Anything / Go to Symbol in File / Go to Symbol in Workspace)",
	},
	{
		token: "IChatAccessibilityService",
		pattern:
			/registerSingleton\(\s*IChatAccessibilityService\s*,\s*ChatAccessibilityService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares chat.service.js's import line with IQuickChatService/IChatWidgetService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IChatCodeBlockContextProviderService",
		pattern:
			/registerSingleton\(\s*IChatCodeBlockContextProviderService\s*,\s*ChatCodeBlockContextProviderService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares chat.service.js's import line with IQuickChatService/IChatWidgetService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IChatAgentService",
		pattern:
			/registerSingleton\(\s*IChatAgentService\s*,\s*QuickChatAgentService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"non-optional __param of @codingame/monaco-vscode-quickaccess-service-override's CommandsQuickAccessProvider -- the Command Palette (Ctrl+Shift+P) itself",
	},
	{
		token: "IChatAgentNameService",
		pattern:
			/registerSingleton\(\s*IChatAgentNameService\s*,\s*ChatAgentNameService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares chatAgents.service.js's import line with IChatAgentService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IAgentNetworkFilterService",
		pattern:
			/registerSingleton\(\s*IAgentNetworkFilterService\s*,\s*AgentNetworkFilterService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			'non-optional __param of browserView.js\'s BrowserViewModel ("Share with Agent" + Playwright-based agent browser-observation bridge); removing it requires a deeper BrowserViewModel/IPlaywrightService refactor out of scope for this slice',
	},

	// F110 S5: nine extensionRuntime tokens a real dependency-graph audit
	// (restricted to the actual, currently bundled 2015-source corpus, not a
	// static grep over the whole vendor tree) found are non-optional
	// constructor dependencies of always-instantiated Plain features, or
	// (`IExtensionGalleryService`/`IExtensionsWorkbenchService`) resolved
	// unconditionally via `accessor.get(...)` at the top of a real, always-
	// registered command/editor-action `run()` method before any early
	// return -- removing the registration would throw "service not
	// registered" the instant that command runs, not just leave dead code
	// behind. See `docs/bundle-baseline.json`'s `categoryNotes.extensionRuntime`
	// for the full discovery story.
	{
		token: "IExtensionGalleryService",
		pattern:
			/registerSingleton\(\s*IExtensionGalleryService\s*,\s*ExtensionGalleryService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			'resolved unconditionally via accessor.get(IExtensionGalleryService) at the top of ChangeLanguageModeAction.run() (editorStatus.js, the real "Change Language Mode" / Ctrl+K Ctrl+M command, f1: true) before any other logic runs; also a non-optional __param of MarketplaceThemesPicker/InstalledThemesPicker (theme-service-override\'s themes.contribution.js)',
	},
	{
		token: "IExtensionTipsService",
		pattern:
			/registerSingleton\(\s*IExtensionTipsService\s*,\s*ExtensionTipsService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares platform/extensionManagement/common/extensionManagement.service.js's import line with IExtensionGalleryService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IGlobalExtensionEnablementService",
		pattern:
			/registerSingleton\(\s*IGlobalExtensionEnablementService\s*,\s*GlobalExtensionEnablementService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares extensionManagement.service.js's import line with IExtensionGalleryService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IAllowedExtensionsService",
		pattern:
			/registerSingleton\(\s*IAllowedExtensionsService\s*,\s*AllowedExtensionsService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares extensionManagement.service.js's import line with IExtensionGalleryService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IExtensionsWorkbenchService",
		pattern:
			/registerSingleton\(\s*IExtensionsWorkbenchService\s*,\s*ExtensionsWorkbenchService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			'resolved unconditionally via accessor.get(IExtensionsWorkbenchService) at the top of FormatDocumentMultipleAction.run() (formatActionsNone.js, the real "Format Document" / Shift+Alt+F fallback action, active whenever a document has no formatter) before any other logic runs; also a non-optional __param of MarketplaceThemesPicker/InstalledThemesPicker',
	},
	{
		token: "IWorkbenchExtensionEnablementService",
		pattern:
			/registerSingleton\(\s*IWorkbenchExtensionEnablementService\s*,\s*WorkbenchExtensionEnablementService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"non-optional __param of DefaultFormatter (formatActionsMultiple.js), a real, always-registered Workbench contribution that resolves conflicting formatters",
	},
	{
		token: "IExtensionManagementServerService",
		pattern:
			/registerSingleton\(\s*IExtensionManagementServerService\s*,\s*ExtensionManagementServerService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares workbench/services/extensionManagement/common/extensionManagement.service.js's import line with IWorkbenchExtensionEnablementService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IWebExtensionsScannerService",
		pattern:
			/registerSingleton\(\s*IWebExtensionsScannerService\s*,\s*WebExtensionsScannerService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares extensionManagement.service.js's import line with IWorkbenchExtensionEnablementService, which must stay; no benefit to removing just this one",
	},
	{
		token: "IWorkbenchExtensionManagementService",
		pattern:
			/registerSingleton\(\s*IWorkbenchExtensionManagementService\s*,\s*WorkbenchExtensionManagementService\s*,\s*InstantiationType\.\w+\s*,?\s*\)/u,
		reason:
			"shares extensionManagement.service.js's import line with IWorkbenchExtensionEnablementService, which must stay; no benefit to removing just this one",
	},
]);

function findReintroducedTokens(source, tokens) {
	const found = [];
	for (const token of tokens) {
		if (new RegExp(`\\b${token}\\b`, "u").test(source)) {
			found.push(token);
		}
	}
	return found;
}

/**
 * Checks the patched, currently-installed `missing-services.js` source for
 * this slice's two shape assumptions: none of the removed tokens have
 * reappeared, and every deliberately-kept registration
 * (`KEPT_TOKEN_REGISTRATIONS`) is still present.
 */
export function checkMissingServicesShape(missingServicesSource) {
	const failures = [];
	for (const token of findReintroducedTokens(
		missingServicesSource,
		REMOVED_MISSING_SERVICES_TOKENS,
	)) {
		failures.push(
			`missing-services.js unexpectedly still references ${token} — F110 removed its import/class/registerSingleton registration; either the patch failed to apply as assumed or upstream reintroduced this token through a different registration this patch's exact line ranges never touch`,
		);
	}
	for (const kept of KEPT_TOKEN_REGISTRATIONS) {
		if (!kept.pattern.test(missingServicesSource)) {
			failures.push(
				`missing-services.js no longer registers ${kept.token} — this binding is deliberately kept because ${kept.reason}`,
			);
		}
	}
	return failures;
}

/**
 * Checks the patched, currently-installed `services.js` source for this
 * slice's shape assumption: none of the removed re-export tokens have
 * reappeared as a facade re-export.
 */
export function checkServicesReexportShape(servicesSource) {
	const failures = [];
	for (const token of findReintroducedTokens(
		servicesSource,
		REMOVED_SERVICES_REEXPORT_TOKENS,
	)) {
		failures.push(
			`services.js unexpectedly still re-exports ${token} — F110 removed this facade re-export line; either the patch failed to apply as assumed or upstream reintroduced this token under a different re-export this patch's exact line deletions never touch`,
		);
	}
	return failures;
}

/**
 * Combined entry point `scripts/plain/check-boundaries.mjs` calls against the
 * real, currently-installed (post-patch) file contents.
 */
export function validateMissingServicesPatchShape({
	missingServicesSource,
	servicesSource,
}) {
	return [
		...checkMissingServicesShape(missingServicesSource),
		...checkServicesReexportShape(servicesSource),
	];
}
