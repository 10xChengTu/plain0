import { IChatSessionsService } from "./chatSessionsService.service.js";
import { IConfigurationService } from "../../../../platform/configuration/common/configuration.service.js";
import { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { RawContextKey } from "../../../../platform/contextkey/common/contextkey.js";
import { URI } from "../../../../base/common/uri.js";
export declare enum BYOKUtilityModelDefault {
    None = "none",
    MainAgent = "mainAgent",
    Copilot = "copilot"
}
export declare enum ChatConfiguration {
    AIDisabled = "chat.disableAIFeatures",
    PluginsEnabled = "chat.plugins.enabled",
    PluginLocations = "chat.pluginLocations",
    PluginMarketplaces = "chat.plugins.marketplaces",
    ExtraMarketplaces = "chat.plugins.extraMarketplaces",
    StrictMarketplaces = "chat.plugins.strictMarketplaces",
    EnabledPlugins = "chat.plugins.enabledPlugins",
    AgentEnabled = "chat.agent.enabled",
    PlanAgentDefaultModel = "chat.planAgent.defaultModel",
    ExploreAgentDefaultModel = "chat.exploreAgent.defaultModel",
    UtilityModel = "chat.utilityModel",
    UtilitySmallModel = "chat.utilitySmallModel",
    BYOKUtilityModelDefault = "chat.byokUtilityModelDefault",
    RequestQueueingDefaultAction = "chat.requestQueuing.defaultAction",
    AgentStatusEnabled = "chat.agentsControl.enabled",
    EditorAssociations = "chat.editorAssociations",
    UnifiedAgentsBar = "chat.unifiedAgentsBar.enabled",
    AgentSessionProjectionEnabled = "chat.agentSessionProjection.enabled",
    ExtensionToolsEnabled = "chat.extensionTools.enabled",
    RepoInfoEnabled = "chat.repoInfo.enabled",
    EditRequests = "chat.editRequests",
    InlineReferencesStyle = "chat.inlineReferences.style",
    AutoReply = "chat.autoReply",
    GlobalAutoApprove = "chat.tools.global.autoApprove",
    AutoApproveEdits = "chat.tools.edits.autoApprove",
    AutoApprovedUrls = "chat.tools.urls.autoApprove",
    EligibleForAutoApproval = "chat.tools.eligibleForAutoApproval",
    EnableMath = "chat.math.enabled",
    CheckpointsEnabled = "chat.checkpoints.enabled",
    ThinkingStyle = "chat.agent.thinkingStyle",
    ThinkingGenerateTitles = "chat.agent.thinking.generateTitles",
    TerminalToolsInThinking = "chat.agent.thinking.terminalTools",
    SimpleTerminalCollapsible = "chat.tools.terminal.simpleCollapsible",
    CompressOutputEnabled = "chat.tools.compressOutput.enabled",
    ThinkingPhrases = "chat.agent.thinking.phrases",
    AutoExpandToolFailures = "chat.tools.autoExpandFailures",
    TodosShowWidget = "chat.tools.todos.showWidget",
    NotifyWindowOnConfirmation = "chat.notifyWindowOnConfirmation",
    NotifyWindowOnResponseReceived = "chat.notifyWindowOnResponseReceived",
    ChatViewSessionsEnabled = "chat.viewSessions.enabled",
    SessionSyncEnabled = "chat.sessionSync.enabled",
    SessionSyncExcludeRepositories = "chat.sessionSync.excludeRepositories",
    ChatViewSessionsGrouping = "chat.viewSessions.grouping",
    ChatViewSessionsOrientation = "chat.viewSessions.orientation",
    ChatViewProgressBadgeEnabled = "chat.viewProgressBadge.enabled",
    ChatContextUsageEnabled = "chat.contextUsage.enabled",
    ChatPersistentProgressEnabled = "chat.persistentProgress.enabled",
    ProgressBorder = "chat.progressBorder.enabled",
    SubagentToolCustomAgents = "chat.customAgentInSubagent.enabled",
    GeneralPurposeAgentEnabled = "chat.generalPurposeAgent.enabled",
    SubagentsAllowInvocationsFromSubagents = "chat.subagents.allowInvocationsFromSubagents",
    ShowCodeBlockProgressAnimation = "chat.agent.codeBlockProgress",
    RestoreLastPanelSession = "chat.restoreLastPanelSession",
    ExitAfterDelegation = "chat.exitAfterDelegation",
    ExplainChangesEnabled = "chat.editing.explainChanges.enabled",
    RevealNextChangeOnResolve = "chat.editing.revealNextChangeOnResolve",
    OpenChangedFileInDiffEditor = "chat.editing.openChangedFileInDiffEditor",
    GrowthNotificationEnabled = "chat.growthNotification.enabled",
    TitleBarSignInEnabled = "chat.titleBar.signIn.enabled",
    TitleBarOpenInAgentsWindowEnabled = "chat.titleBar.openInAgentsWindow.enabled",
    ChatCustomizationsStructuredPreviewEnabled = "chat.customizations.structuredPreview.enabled",
    AutopilotAdvancedEnabled = "chat.autopilot.advanced.enabled",
    PlanReviewInlineEditorEnabled = "chat.planReview.inlineEditor.enabled",
    DefaultPermissionLevel = "chat.permissions.default",
    PermissionsSandboxToggleEnabled = "chat.experimental.permissionsSandboxToggle.enabled",
    DefaultConfiguration = "chat.defaultConfiguration",
    DefaultModel = "chat.defaultModel",
    ImageCarouselEnabled = "imageCarousel.chat.enabled",
    ArtifactsEnabled = "chat.artifacts.enabled",
    ArtifactsRulesByMimeType = "chat.artifacts.rules.byMimeType",
    ArtifactsRulesByFilePath = "chat.artifacts.rules.byFilePath",
    ArtifactsRulesByMemoryFilePath = "chat.artifacts.rules.byMemoryFilePath",
    ToolConfirmationCarousel = "chat.tools.confirmationCarousel.enabled",
    ToolRiskAssessmentEnabled = "chat.tools.riskAssessment.enabled",
    ToolRiskAssessmentModel = "chat.tools.riskAssessment.model",
    DefaultNewSessionMode = "chat.newSession.defaultMode",
    CopilotCliHideExtensionHostAgents = "chat.agents.copilotCli.hideExtensionHost",
    EditorDefaultProvider = "chat.editor.defaultProvider",
    EditorLocalAgentEnabled = "chat.editor.localAgent.enabled",
    CopilotCliHideExtensionHostEditor = "chat.editor.copilotCli.hideExtensionHost",
    AgentsHandoffTipMode = "chat.agentsHandoffTip.mode",
    TurnStatusPills = "chat.turnStatusPills",
    IncrementalRendering = "chat.experimental.incrementalRendering.enabled",
    IncrementalRenderingStyle = "chat.experimental.incrementalRendering.animationStyle",
    IncrementalRenderingBuffering = "chat.experimental.incrementalRendering.buffering",
    CollectInstructionsInExtension = "chat.experimental.collectInstructionsInExtension",
    ImplicitContextActiveEditor = "chat.implicitContext.includeActiveEditor"
}
/**
 * The "kind" of agents for custom agents.
 */
export declare enum ChatModeKind {
    Ask = "ask",
    Edit = "edit",
    Agent = "agent"
}
/**
 * The permission level controlling tool auto-approval behavior.
 */
export declare enum ChatPermissionLevel {
    /** Use existing auto-approve settings */
    Default = "default",
    /** Auto-approve all tool calls, auto-retry on error */
    AutoApprove = "autoApprove",
    /** Everything AutoApprove does plus an internal stop hook that continues until the task is done */
    Autopilot = "autopilot"
}
export declare function isChatPermissionLevel(level: unknown | undefined): level is ChatPermissionLevel;
/**
 * Shape of the {@link ChatConfiguration.DefaultConfiguration}
 * object setting. Controls the starting `mode` and `approvals` for new agent-host
 * sessions (such as Copilot CLI). All properties are optional — a missing property
 * falls back to the per-axis default.
 */
export type AgentSessionMode = "interactive" | "plan" | "autopilot";
export interface IChatDefaultConfiguration {
    /** Starting agent mode: `interactive` / `plan` / `autopilot`. */
    readonly mode?: AgentSessionMode;
    /** Starting approval level: `default` / `autoApprove`. */
    readonly approvals?: ChatPermissionLevel.Default | ChatPermissionLevel.AutoApprove;
}
/**
 * Returns true if the permission level enables auto-approval of all tool calls.
 * Both {@link ChatPermissionLevel.AutoApprove} and {@link ChatPermissionLevel.Autopilot} enable auto-approval.
 */
export declare function isAutoApproveLevel(level: ChatPermissionLevel | undefined): boolean;
/**
 * True for {@link ChatPermissionLevel.Autopilot} only. Unlike {@link isAutoApproveLevel}, this
 * excludes {@link ChatPermissionLevel.AutoApprove}, so it can gate Autopilot-only behavior such as
 * risk-based skipping of tool calls.
 */
export declare function isAutopilotLevel(level: ChatPermissionLevel | undefined): boolean;
export declare enum ThinkingDisplayMode {
    Collapsed = "collapsed",
    CollapsedPreview = "collapsedPreview",
    FixedScrolling = "fixedScrolling"
}
export declare enum CollapsedToolsDisplayMode {
    Off = "off",
    WithThinking = "withThinking",
    Always = "always"
}
export declare enum ChatNotificationMode {
    Off = "off",
    WindowNotFocused = "windowNotFocused",
    Always = "always"
}
export type RawChatParticipantLocation = "panel" | "terminal" | "notebook" | "editing-session";
export declare enum ChatAgentLocation {
    /**
     * This is chat, whether it's in the sidebar, a chat editor, or quick chat.
     * Leaving the values alone as they are in stored data so we don't have to normalize them.
     */
    Chat = "panel",
    Terminal = "terminal",
    Notebook = "notebook",
    /**
     * EditorInline means inline chat in a text editor.
     */
    EditorInline = "editor"
}
export declare namespace ChatAgentLocation {
    function fromRaw(value: RawChatParticipantLocation | string): ChatAgentLocation;
}
export declare function isSupportedChatFileScheme(accessor: ServicesAccessor, scheme: string): boolean;
/**
 * Returns the effective default session type for a new chat in the VS Code
 * editor window, honoring the experimental
 * {@link ChatConfiguration.EditorDefaultProvider} setting:
 * - `'copilotAh'` selects the Agent Host Copilot CLI when its contribution is registered.
 * - `'copilotEh'` selects the Extension Host Copilot CLI when its contribution is
 *   registered and it is not hidden by {@link ChatConfiguration.CopilotCliHideExtensionHostEditor}.
 *
 * Falls back to {@link localChatSessionType} when local is enabled, or when no
 * visible non-local provider is available.
 */
export declare function getDefaultNewChatSessionType(configurationService: IConfigurationService, chatSessionsService: Pick<IChatSessionsService, "getChatSessionContribution" | "getAllChatSessionContributions">): string;
export declare function getDefaultNewChatSessionResource(configurationService: IConfigurationService, chatSessionsService: Pick<IChatSessionsService, "getChatSessionContribution" | "getAllChatSessionContributions">): URI;
export declare function isEditorLocalAgentEnabled(configurationService: IConfigurationService): boolean;
export declare function isVisibleEditorChatSessionType(sessionType: string, configurationService: IConfigurationService, chatSessionsService: Pick<IChatSessionsService, "getChatSessionContribution" | "getAllChatSessionContributions">): boolean;
export declare const MANAGE_CHAT_COMMAND_ID = "workbench.action.chat.manage";
export declare const OPEN_WORKSPACE_IN_AGENTS_WINDOW_COMMAND_ID = "workbench.action.openWorkspaceInAgentsWindow";
export declare const OPEN_AGENTS_WINDOW_COMMAND_ID = "workbench.action.openAgentsWindow";
export declare const OPEN_AGENTS_WINDOW_PRECONDITION: import("../../../../platform/contextkey/common/contextkey.js").ContextKeyExpression | undefined;
export declare const ChatEditorTitleMaxLength = 30;
export declare const CHAT_TERMINAL_OUTPUT_MAX_PREVIEW_LINES = 1000;
export declare const CONTEXT_MODELS_EDITOR: RawContextKey<boolean>;
export declare const CONTEXT_MODELS_SEARCH_FOCUS: RawContextKey<boolean>;
/**
 * The built-in general-purpose agent name. When the model uses this name,
 * the subagent inherits the parent's system prompt, model, and tools.
 */
export declare const GeneralPurposeAgentName = "General Purpose";
