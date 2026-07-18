
import { Schemas } from '../../../../base/common/network.js';
import { SessionType, localChatSessionType } from './chatSessionsService.js';
import { IChatSessionsService } from './chatSessionsService.service.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { IsSessionsWindowContext, IsAuxiliaryWindowContext } from '../../../common/contextkeys.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { LocalChatSessionUri } from './model/chatUri.js';

var BYOKUtilityModelDefault;
(function(BYOKUtilityModelDefault) {
    BYOKUtilityModelDefault["None"] = "none";
    BYOKUtilityModelDefault["MainAgent"] = "mainAgent";
    BYOKUtilityModelDefault["Copilot"] = "copilot";
})(BYOKUtilityModelDefault || (BYOKUtilityModelDefault = {}));
var ChatConfiguration;
(function(ChatConfiguration) {
    ChatConfiguration["AIDisabled"] = "chat.disableAIFeatures";
    ChatConfiguration["PluginsEnabled"] = "chat.plugins.enabled";
    ChatConfiguration["PluginLocations"] = "chat.pluginLocations";
    ChatConfiguration["PluginMarketplaces"] = "chat.plugins.marketplaces";
    ChatConfiguration["ExtraMarketplaces"] = "chat.plugins.extraMarketplaces";
    ChatConfiguration["StrictMarketplaces"] = "chat.plugins.strictMarketplaces";
    ChatConfiguration["EnabledPlugins"] = "chat.plugins.enabledPlugins";
    ChatConfiguration["AgentEnabled"] = "chat.agent.enabled";
    ChatConfiguration["PlanAgentDefaultModel"] = "chat.planAgent.defaultModel";
    ChatConfiguration["ExploreAgentDefaultModel"] = "chat.exploreAgent.defaultModel";
    ChatConfiguration["UtilityModel"] = "chat.utilityModel";
    ChatConfiguration["UtilitySmallModel"] = "chat.utilitySmallModel";
    ChatConfiguration["BYOKUtilityModelDefault"] = "chat.byokUtilityModelDefault";
    ChatConfiguration["RequestQueueingDefaultAction"] = "chat.requestQueuing.defaultAction";
    ChatConfiguration["AgentStatusEnabled"] = "chat.agentsControl.enabled";
    ChatConfiguration["EditorAssociations"] = "chat.editorAssociations";
    ChatConfiguration["UnifiedAgentsBar"] = "chat.unifiedAgentsBar.enabled";
    ChatConfiguration["AgentSessionProjectionEnabled"] = "chat.agentSessionProjection.enabled";
    ChatConfiguration["ExtensionToolsEnabled"] = "chat.extensionTools.enabled";
    ChatConfiguration["RepoInfoEnabled"] = "chat.repoInfo.enabled";
    ChatConfiguration["EditRequests"] = "chat.editRequests";
    ChatConfiguration["InlineReferencesStyle"] = "chat.inlineReferences.style";
    ChatConfiguration["AutoReply"] = "chat.autoReply";
    ChatConfiguration["GlobalAutoApprove"] = "chat.tools.global.autoApprove";
    ChatConfiguration["AutoApproveEdits"] = "chat.tools.edits.autoApprove";
    ChatConfiguration["AutoApprovedUrls"] = "chat.tools.urls.autoApprove";
    ChatConfiguration["EligibleForAutoApproval"] = "chat.tools.eligibleForAutoApproval";
    ChatConfiguration["EnableMath"] = "chat.math.enabled";
    ChatConfiguration["CheckpointsEnabled"] = "chat.checkpoints.enabled";
    ChatConfiguration["ThinkingStyle"] = "chat.agent.thinkingStyle";
    ChatConfiguration["ThinkingGenerateTitles"] = "chat.agent.thinking.generateTitles";
    ChatConfiguration["TerminalToolsInThinking"] = "chat.agent.thinking.terminalTools";
    ChatConfiguration["SimpleTerminalCollapsible"] = "chat.tools.terminal.simpleCollapsible";
    ChatConfiguration["CompressOutputEnabled"] = "chat.tools.compressOutput.enabled";
    ChatConfiguration["ThinkingPhrases"] = "chat.agent.thinking.phrases";
    ChatConfiguration["AutoExpandToolFailures"] = "chat.tools.autoExpandFailures";
    ChatConfiguration["TodosShowWidget"] = "chat.tools.todos.showWidget";
    ChatConfiguration["NotifyWindowOnConfirmation"] = "chat.notifyWindowOnConfirmation";
    ChatConfiguration["NotifyWindowOnResponseReceived"] = "chat.notifyWindowOnResponseReceived";
    ChatConfiguration["ChatViewSessionsEnabled"] = "chat.viewSessions.enabled";
    ChatConfiguration["SessionSyncEnabled"] = "chat.sessionSync.enabled";
    ChatConfiguration["SessionSyncExcludeRepositories"] = "chat.sessionSync.excludeRepositories";
    ChatConfiguration["ChatViewSessionsGrouping"] = "chat.viewSessions.grouping";
    ChatConfiguration["ChatViewSessionsOrientation"] = "chat.viewSessions.orientation";
    ChatConfiguration["ChatViewProgressBadgeEnabled"] = "chat.viewProgressBadge.enabled";
    ChatConfiguration["ChatContextUsageEnabled"] = "chat.contextUsage.enabled";
    ChatConfiguration["ChatPersistentProgressEnabled"] = "chat.persistentProgress.enabled";
    ChatConfiguration["ProgressBorder"] = "chat.progressBorder.enabled";
    ChatConfiguration["SubagentToolCustomAgents"] = "chat.customAgentInSubagent.enabled";
    ChatConfiguration["GeneralPurposeAgentEnabled"] = "chat.generalPurposeAgent.enabled";
    ChatConfiguration["SubagentsAllowInvocationsFromSubagents"] = "chat.subagents.allowInvocationsFromSubagents";
    ChatConfiguration["ShowCodeBlockProgressAnimation"] = "chat.agent.codeBlockProgress";
    ChatConfiguration["RestoreLastPanelSession"] = "chat.restoreLastPanelSession";
    ChatConfiguration["ExitAfterDelegation"] = "chat.exitAfterDelegation";
    ChatConfiguration["ExplainChangesEnabled"] = "chat.editing.explainChanges.enabled";
    ChatConfiguration["RevealNextChangeOnResolve"] = "chat.editing.revealNextChangeOnResolve";
    ChatConfiguration["OpenChangedFileInDiffEditor"] = "chat.editing.openChangedFileInDiffEditor";
    ChatConfiguration["GrowthNotificationEnabled"] = "chat.growthNotification.enabled";
    ChatConfiguration["TitleBarSignInEnabled"] = "chat.titleBar.signIn.enabled";
    ChatConfiguration["TitleBarOpenInAgentsWindowEnabled"] = "chat.titleBar.openInAgentsWindow.enabled";
    ChatConfiguration["ChatCustomizationsStructuredPreviewEnabled"] = "chat.customizations.structuredPreview.enabled";
    ChatConfiguration["AutopilotAdvancedEnabled"] = "chat.autopilot.advanced.enabled";
    ChatConfiguration["PlanReviewInlineEditorEnabled"] = "chat.planReview.inlineEditor.enabled";
    ChatConfiguration["DefaultPermissionLevel"] = "chat.permissions.default";
    ChatConfiguration["PermissionsSandboxToggleEnabled"] = "chat.experimental.permissionsSandboxToggle.enabled";
    ChatConfiguration["DefaultConfiguration"] = "chat.defaultConfiguration";
    ChatConfiguration["DefaultModel"] = "chat.defaultModel";
    ChatConfiguration["ImageCarouselEnabled"] = "imageCarousel.chat.enabled";
    ChatConfiguration["ArtifactsEnabled"] = "chat.artifacts.enabled";
    ChatConfiguration["ArtifactsRulesByMimeType"] = "chat.artifacts.rules.byMimeType";
    ChatConfiguration["ArtifactsRulesByFilePath"] = "chat.artifacts.rules.byFilePath";
    ChatConfiguration["ArtifactsRulesByMemoryFilePath"] = "chat.artifacts.rules.byMemoryFilePath";
    ChatConfiguration["ToolConfirmationCarousel"] = "chat.tools.confirmationCarousel.enabled";
    ChatConfiguration["ToolRiskAssessmentEnabled"] = "chat.tools.riskAssessment.enabled";
    ChatConfiguration["ToolRiskAssessmentModel"] = "chat.tools.riskAssessment.model";
    ChatConfiguration["DefaultNewSessionMode"] = "chat.newSession.defaultMode";
    ChatConfiguration["CopilotCliHideExtensionHostAgents"] = "chat.agents.copilotCli.hideExtensionHost";
    ChatConfiguration["EditorDefaultProvider"] = "chat.editor.defaultProvider";
    ChatConfiguration["EditorLocalAgentEnabled"] = "chat.editor.localAgent.enabled";
    ChatConfiguration["CopilotCliHideExtensionHostEditor"] = "chat.editor.copilotCli.hideExtensionHost";
    ChatConfiguration["AgentsHandoffTipMode"] = "chat.agentsHandoffTip.mode";
    ChatConfiguration["TurnStatusPills"] = "chat.turnStatusPills";
    ChatConfiguration["IncrementalRendering"] = "chat.experimental.incrementalRendering.enabled";
    ChatConfiguration["IncrementalRenderingStyle"] = "chat.experimental.incrementalRendering.animationStyle";
    ChatConfiguration["IncrementalRenderingBuffering"] = "chat.experimental.incrementalRendering.buffering";
    ChatConfiguration["CollectInstructionsInExtension"] = "chat.experimental.collectInstructionsInExtension";
    ChatConfiguration["ImplicitContextActiveEditor"] = "chat.implicitContext.includeActiveEditor";
})(ChatConfiguration || (ChatConfiguration = {}));
var ChatModeKind;
(function(ChatModeKind) {
    ChatModeKind["Ask"] = "ask";
    ChatModeKind["Edit"] = "edit";
    ChatModeKind["Agent"] = "agent";
})(ChatModeKind || (ChatModeKind = {}));
var ChatPermissionLevel;
(function(ChatPermissionLevel) {
    ChatPermissionLevel["Default"] = "default";
    ChatPermissionLevel["AutoApprove"] = "autoApprove";
    ChatPermissionLevel["Autopilot"] = "autopilot";
})(ChatPermissionLevel || (ChatPermissionLevel = {}));
const chatPermissionLevels = ( new Set(( Object.values(ChatPermissionLevel))));
function isChatPermissionLevel(level) {
    return ( chatPermissionLevels.has(level));
}
function isAutoApproveLevel(level) {
    return level === ChatPermissionLevel.AutoApprove || level === ChatPermissionLevel.Autopilot;
}
function isAutopilotLevel(level) {
    return level === ChatPermissionLevel.Autopilot;
}
var ThinkingDisplayMode;
(function(ThinkingDisplayMode) {
    ThinkingDisplayMode["Collapsed"] = "collapsed";
    ThinkingDisplayMode["CollapsedPreview"] = "collapsedPreview";
    ThinkingDisplayMode["FixedScrolling"] = "fixedScrolling";
})(ThinkingDisplayMode || (ThinkingDisplayMode = {}));
var CollapsedToolsDisplayMode;
(function(CollapsedToolsDisplayMode) {
    CollapsedToolsDisplayMode["Off"] = "off";
    CollapsedToolsDisplayMode["WithThinking"] = "withThinking";
    CollapsedToolsDisplayMode["Always"] = "always";
})(CollapsedToolsDisplayMode || (CollapsedToolsDisplayMode = {}));
var ChatNotificationMode;
(function(ChatNotificationMode) {
    ChatNotificationMode["Off"] = "off";
    ChatNotificationMode["WindowNotFocused"] = "windowNotFocused";
    ChatNotificationMode["Always"] = "always";
})(ChatNotificationMode || (ChatNotificationMode = {}));
var ChatAgentLocation;
(function(ChatAgentLocation) {
    ChatAgentLocation["Chat"] = "panel";
    ChatAgentLocation["Terminal"] = "terminal";
    ChatAgentLocation["Notebook"] = "notebook";
    ChatAgentLocation["EditorInline"] = "editor";
})(ChatAgentLocation || (ChatAgentLocation = {}));
(function(ChatAgentLocation) {
    function fromRaw(value) {
        switch (value) {
        case "panel":
            return ChatAgentLocation.Chat;
        case "terminal":
            return ChatAgentLocation.Terminal;
        case "notebook":
            return ChatAgentLocation.Notebook;
        case "editor":
            return ChatAgentLocation.EditorInline;
        }
        return ChatAgentLocation.Chat;
    }
    ChatAgentLocation.fromRaw = fromRaw;
})(ChatAgentLocation || (ChatAgentLocation = {}));
const chatAlwaysUnsupportedFileSchemes = ( new Set([
    Schemas.vscodeChatEditor,
    Schemas.walkThrough,
    Schemas.vscodeLocalChatSession,
    Schemas.vscodeSettings,
    Schemas.webviewPanel,
    Schemas.vscodeUserData,
    Schemas.extension,
    "ccreq",
    "openai-codex"
]));
function isSupportedChatFileScheme(accessor, scheme) {
    const chatService = accessor.get(IChatSessionsService);
    if (( chatAlwaysUnsupportedFileSchemes.has(scheme))) {
        return false;
    }
    if (chatService.getContentProviderSchemes().includes(scheme)) {
        return false;
    }
    return true;
}
function getDefaultNewChatSessionType(configurationService, chatSessionsService) {
    const defaultProvider = configurationService.getValue(ChatConfiguration.EditorDefaultProvider);
    const defaultType = getConfiguredEditorDefaultSessionType(defaultProvider);
    if (defaultType === SessionType.AgentHostCopilot && !isEditorLocalAgentEnabled(configurationService)) {
        return defaultType;
    }
    if (defaultType && isVisibleEditorChatSessionType(defaultType, configurationService, chatSessionsService)) {
        return defaultType;
    }
    if (isEditorLocalAgentEnabled(configurationService)) {
        return localChatSessionType;
    }
    return getVisibleNonLocalEditorChatSessionTypes(configurationService, chatSessionsService)[0] ?? localChatSessionType;
}
function getDefaultNewChatSessionResource(configurationService, chatSessionsService) {
    const defaultType = getDefaultNewChatSessionType(configurationService, chatSessionsService);
    return defaultType === localChatSessionType ? LocalChatSessionUri.getNewSessionUri() : ( URI.from({
        scheme: defaultType,
        path: `/untitled-${generateUuid()}`
    }));
}
function isEditorLocalAgentEnabled(configurationService) {
    return configurationService.getValue(ChatConfiguration.EditorLocalAgentEnabled) ?? true;
}
function isVisibleEditorChatSessionType(sessionType, configurationService, chatSessionsService) {
    if (sessionType === localChatSessionType) {
        if (!isEditorLocalAgentEnabled(configurationService) && configurationService.getValue(ChatConfiguration.EditorDefaultProvider) === "copilotAh") {
            return false;
        }
        return isEditorLocalAgentEnabled(configurationService) || getVisibleNonLocalEditorChatSessionTypes(configurationService, chatSessionsService).length === 0;
    }
    if (sessionType === SessionType.CopilotCLI && configurationService.getValue(ChatConfiguration.CopilotCliHideExtensionHostEditor)) {
        return false;
    }
    return !!chatSessionsService.getChatSessionContribution(sessionType);
}
function getConfiguredEditorDefaultSessionType(defaultProvider) {
    switch (defaultProvider) {
    case "local":
        return localChatSessionType;
    case "copilotAh":
        return SessionType.AgentHostCopilot;
    case "copilotEh":
        return SessionType.CopilotCLI;
    default:
        return undefined;
    }
}
function getVisibleNonLocalEditorChatSessionTypes(configurationService, chatSessionsService) {
    const sessionTypes = ( new Set());
    for (const contribution of chatSessionsService.getAllChatSessionContributions()) {
        if (contribution.type !== localChatSessionType && isVisibleEditorChatSessionType(contribution.type, configurationService, chatSessionsService)) {
            sessionTypes.add(contribution.type);
        }
    }
    return Array.from(sessionTypes);
}
const MANAGE_CHAT_COMMAND_ID = "workbench.action.chat.manage";
const OPEN_WORKSPACE_IN_AGENTS_WINDOW_COMMAND_ID = "workbench.action.openWorkspaceInAgentsWindow";
const OPEN_AGENTS_WINDOW_COMMAND_ID = "workbench.action.openAgentsWindow";
const OPEN_AGENTS_WINDOW_PRECONDITION = ( ContextKeyExpr.and(( ChatEntitlementContextKeys.Setup.hidden.negate()), ( ChatEntitlementContextKeys.Setup.disabledInWorkspace.negate()), ( IsSessionsWindowContext.negate()), ( ContextKeyExpr.has(`config.${ChatConfiguration.AgentEnabled}`)), ( IsAuxiliaryWindowContext.negate())));
const ChatEditorTitleMaxLength = 30;
const CONTEXT_MODELS_EDITOR = ( new RawContextKey("inModelsEditor", false));
const CONTEXT_MODELS_SEARCH_FOCUS = ( new RawContextKey("inModelsSearch", false));
const GeneralPurposeAgentName = "General Purpose";

export { BYOKUtilityModelDefault, CONTEXT_MODELS_EDITOR, CONTEXT_MODELS_SEARCH_FOCUS, ChatAgentLocation, ChatConfiguration, ChatEditorTitleMaxLength, ChatModeKind, ChatNotificationMode, ChatPermissionLevel, CollapsedToolsDisplayMode, GeneralPurposeAgentName, MANAGE_CHAT_COMMAND_ID, OPEN_AGENTS_WINDOW_COMMAND_ID, OPEN_AGENTS_WINDOW_PRECONDITION, OPEN_WORKSPACE_IN_AGENTS_WINDOW_COMMAND_ID, ThinkingDisplayMode, getDefaultNewChatSessionResource, getDefaultNewChatSessionType, isAutoApproveLevel, isAutopilotLevel, isChatPermissionLevel, isEditorLocalAgentEnabled, isSupportedChatFileScheme, isVisibleEditorChatSessionType };
