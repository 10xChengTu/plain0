
import { localize } from '../../../../../nls.js';
import { RawContextKey, ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IsWebContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { RemoteNameContext } from '../../../../common/contextkeys.js';
import { ChatEntitlementContextKeys } from '../../../../services/chat/common/chatEntitlementService.js';
import { ChatAccountPolicyGateActiveContext } from '../../../../services/policies/common/accountPolicyService.js';
import { ChatModeKind, ChatPermissionLevel } from '../constants.js';

var ChatContextKeys;
(function(ChatContextKeys) {
    ChatContextKeys.responseVote = ( new RawContextKey("chatSessionResponseVote", "", {
        type: "string",
        description: ( localize(
            8416,
            "When the response has been voted up, is set to 'up'. When voted down, is set to 'down'. Otherwise an empty string."
        ))
    }));
    ChatContextKeys.responseDetectedAgentCommand = ( new RawContextKey("chatSessionResponseDetectedAgentOrCommand", false, {
        type: "boolean",
        description: ( localize(8417, "When the agent or command was automatically detected"))
    }));
    ChatContextKeys.responseSupportsIssueReporting = ( new RawContextKey("chatResponseSupportsIssueReporting", false, {
        type: "boolean",
        description: ( localize(8418, "True when the current chat response supports issue reporting."))
    }));
    ChatContextKeys.responseIsFiltered = ( new RawContextKey("chatSessionResponseFiltered", false, {
        type: "boolean",
        description: ( localize(8419, "True when the chat response was filtered out by the server."))
    }));
    ChatContextKeys.responseHasError = ( new RawContextKey("chatSessionResponseError", false, {
        type: "boolean",
        description: ( localize(8420, "True when the chat response resulted in an error."))
    }));
    ChatContextKeys.requestInProgress = ( new RawContextKey("chatSessionRequestInProgress", false, {
        type: "boolean",
        description: ( localize(8421, "True when the current request is still in progress."))
    }));
    ChatContextKeys.hasActiveRequest = ( new RawContextKey("chatSessionHasActiveRequest", false, {
        type: "boolean",
        description: ( localize(
            8422,
            "True when the current chat response has not completed, regardless of intermediate states like tool calls or elicitations."
        ))
    }));
    ChatContextKeys.currentlyEditing = ( new RawContextKey("chatSessionCurrentlyEditing", false, {
        type: "boolean",
        description: ( localize(8423, "True when the current request is being edited."))
    }));
    ChatContextKeys.currentlyEditingInput = ( new RawContextKey("chatSessionCurrentlyEditingInput", false, {
        type: "boolean",
        description: ( localize(8424, "True when the current request input at the bottom is being edited."))
    }));
    (function(EditingRequestType) {
        EditingRequestType["Sent"] = "s";
        EditingRequestType["Queue"] = "q";
        EditingRequestType["Steer"] = "st";
    })(
        ChatContextKeys.EditingRequestType || (ChatContextKeys.EditingRequestType = {})
    );
    ChatContextKeys.editingRequestType = ( new RawContextKey("chatEditingSentRequest", undefined, {
        type: "string",
        description: ( localize(8425, "The type of the current editing request."))
    }));
    ChatContextKeys.isResponse = ( new RawContextKey("chatResponse", false, {
        type: "boolean",
        description: ( localize(8426, "The chat item is a response."))
    }));
    ChatContextKeys.isRequest = ( new RawContextKey("chatRequest", false, {
        type: "boolean",
        description: ( localize(8427, "The chat item is a request"))
    }));
    ChatContextKeys.isFirstRequest = ( new RawContextKey("chatFirstRequest", false, {
        type: "boolean",
        description: ( localize(8428, "The chat item is the first request in the session."))
    }));
    ChatContextKeys.isPendingRequest = ( new RawContextKey("chatRequestIsPending", false, {
        type: "boolean",
        description: ( localize(8429, "True when the chat request item is pending in the queue."))
    }));
    ChatContextKeys.itemId = ( new RawContextKey("chatItemId", "", {
        type: "string",
        description: ( localize(8430, "The id of the chat item."))
    }));
    ChatContextKeys.lastItemId = ( new RawContextKey("chatLastItemId", [], {
        type: "string",
        description: ( localize(8431, "The id of the last chat item."))
    }));
    ChatContextKeys.editApplied = ( new RawContextKey("chatEditApplied", false, {
        type: "boolean",
        description: ( localize(8432, "True when the chat text edits have been applied."))
    }));
    ChatContextKeys.inputHasText = ( new RawContextKey("chatInputHasText", false, {
        type: "boolean",
        description: ( localize(8433, "True when the chat input has text."))
    }));
    ChatContextKeys.inputHasSendableContent = ( new RawContextKey("chatInputHasSendableContent", false, {
        type: "boolean",
        description: ( localize(
            8434,
            "True when the chat input has text or file attachments that can be sent."
        ))
    }));
    ChatContextKeys.inputHasFocus = ( new RawContextKey("chatInputHasFocus", false, {
        type: "boolean",
        description: ( localize(8435, "True when the chat input has focus."))
    }));
    ChatContextKeys.inChatInput = ( new RawContextKey("inChatInput", false, {
        type: "boolean",
        description: ( localize(8436, "True when focus is in the chat input, false otherwise."))
    }));
    ChatContextKeys.inChatSession = ( new RawContextKey("inChat", false, {
        type: "boolean",
        description: ( localize(8437, "True when focus is in the chat widget, false otherwise."))
    }));
    ChatContextKeys.inChatQuestionCarousel = ( new RawContextKey("inChatQuestionCarousel", false, {
        type: "boolean",
        description: ( localize(8438, "True when focus is in the chat question carousel."))
    }));
    ChatContextKeys.chatQuestionCarouselHasTerminal = ( new RawContextKey("chatQuestionCarouselHasTerminal", false, {
        type: "boolean",
        description: ( localize(
            8439,
            "True when the chat question carousel was triggered by a terminal and has a terminal to focus."
        ))
    }));
    ChatContextKeys.inChatEditor = ( new RawContextKey("inChatEditor", false, {
        type: "boolean",
        description: ( localize(8440, "Whether focus is in a chat editor."))
    }));
    ChatContextKeys.inChatTodoList = ( new RawContextKey("inChatTodoList", false, {
        type: "boolean",
        description: ( localize(8441, "True when focus is in the chat todo list."))
    }));
    ChatContextKeys.inChatTip = ( new RawContextKey("inChatTip", false, {
        type: "boolean",
        description: ( localize(8442, "True when focus is in a chat tip."))
    }));
    ChatContextKeys.multipleChatTips = ( new RawContextKey("multipleChatTips", false, {
        type: "boolean",
        description: ( localize(8443, "True when there are multiple chat tips available."))
    }));
    ChatContextKeys.inChatTerminalToolOutput = ( new RawContextKey("inChatTerminalToolOutput", false, {
        type: "boolean",
        description: ( localize(8444, "True when focus is in the chat terminal output region."))
    }));
    ChatContextKeys.chatModeKind = ( new RawContextKey("chatAgentKind", ChatModeKind.Ask, {
        type: "string",
        description: ( localize(8445, "The 'kind' of the current agent."))
    }));
    ChatContextKeys.chatPermissionLevel = ( new RawContextKey("chatPermissionLevel", ChatPermissionLevel.Default, {
        type: "string",
        description: ( localize(8446, "The current permission level for tool auto-approval."))
    }));
    ChatContextKeys.chatModeName = ( new RawContextKey("chatModeName", "", {
        type: "string",
        description: ( localize(8447, "The name of the current chat mode (e.g. 'Plan' for custom modes)."))
    }));
    ChatContextKeys.chatModelId = ( new RawContextKey("chatModelId", "", {
        type: "string",
        description: ( localize(
            8448,
            "The short id of the currently selected chat model (for example 'gpt-4.1')."
        ))
    }));
    ChatContextKeys.supported = ( ContextKeyExpr.or(( IsWebContext.negate()), ( RemoteNameContext.notEqualsTo("")), ( ContextKeyExpr.has("config.chat.experimental.serverlessWebEnabled"))));
    ChatContextKeys.enabled = ( new RawContextKey("chatIsEnabled", false, {
        type: "boolean",
        description: ( localize(
            8449,
            "True when chat is enabled because a default chat participant is activated with an implementation."
        ))
    }));
    ChatContextKeys.accountPolicyGateActive = ChatAccountPolicyGateActiveContext;
    ChatContextKeys.lockedToCodingAgent = ( new RawContextKey("lockedToCodingAgent", false, {
        type: "boolean",
        description: ( localize(8450, "True when the chat widget is locked to the coding agent session."))
    }));
    ChatContextKeys.lockedCodingAgentId = ( new RawContextKey("lockedCodingAgentId", "", {
        type: "string",
        description: ( localize(
            8451,
            "The agent ID when the chat widget is locked to a coding agent session."
        ))
    }));
    ChatContextKeys.readOnly = ( new RawContextKey("chatIsReadonly", false, {
        type: "boolean",
        description: ( localize(
            8452,
            "True when the chat shown in the widget is read-only (non-interactive)."
        ))
    }));
    ChatContextKeys.chatIsAgentHostSession = ( new RawContextKey("chatIsAgentHostSession", false, {
        type: "boolean",
        description: ( localize(8453, "True when the chat widget is locked to an Agent Host session."))
    }));
    ChatContextKeys.chatAgentHostProviderId = ( new RawContextKey("chatAgentHostProviderId", "", {
        type: "string",
        description: ( localize(
            8454,
            "The Agent Host provider ID when the chat widget is locked to an Agent Host session."
        ))
    }));
    ChatContextKeys.chatSessionHasCustomAgentTarget = ( new RawContextKey("chatSessionHasCustomAgentTarget", false, {
        type: "boolean",
        description: ( localize(
            8455,
            "True when the chat session has a customAgentTarget defined to filter modes."
        ))
    }));
    ChatContextKeys.chatSessionHasTargetedModels = ( new RawContextKey("chatSessionHasTargetedModels", false, {
        type: "boolean",
        description: ( localize(
            8456,
            "True when the chat session has language models that target it via targetChatSessionType."
        ))
    }));
    ChatContextKeys.agentSupportsAttachments = ( new RawContextKey("agentSupportsAttachments", false, {
        type: "boolean",
        description: ( localize(8457, "True when the chat agent supports attachments."))
    }));
    ChatContextKeys.withinEditSessionDiff = ( new RawContextKey("withinEditSessionDiff", false, {
        type: "boolean",
        description: ( localize(8458, "True when the chat widget dispatches to the edit session chat."))
    }));
    ChatContextKeys.filePartOfEditSession = ( new RawContextKey("filePartOfEditSession", false, {
        type: "boolean",
        description: ( localize(8459, "True when the chat widget is within a file with an edit session."))
    }));
    ChatContextKeys.extensionParticipantRegistered = ( new RawContextKey("chatPanelExtensionParticipantRegistered", false, {
        type: "boolean",
        description: ( localize(
            8460,
            "True when a default chat participant is registered for the panel from an extension."
        ))
    }));
    ChatContextKeys.panelParticipantRegistered = ( new RawContextKey("chatPanelParticipantRegistered", false, {
        type: "boolean",
        description: ( localize(8461, "True when a default chat participant is registered for the panel."))
    }));
    ChatContextKeys.chatEditingCanUndo = ( new RawContextKey("chatEditingCanUndo", false, {
        type: "boolean",
        description: ( localize(
            8462,
            "True when it is possible to undo an interaction in the editing panel."
        ))
    }));
    ChatContextKeys.chatEditingCanRedo = ( new RawContextKey("chatEditingCanRedo", false, {
        type: "boolean",
        description: ( localize(
            8463,
            "True when it is possible to redo an interaction in the editing panel."
        ))
    }));
    ChatContextKeys.languageModelsAreUserSelectable = ( new RawContextKey("chatModelsAreUserSelectable", false, {
        type: "boolean",
        description: ( localize(8464, "True when the chat model can be selected manually by the user."))
    }));
    ChatContextKeys.nonCopilotLanguageModelsAreUserSelectable = ( new RawContextKey("chatNonCopilotModelsAreUserSelectable", false, {
        type: "boolean",
        description: ( localize(
            8465,
            "True when a user-selectable chat model from a non-Copilot vendor is available."
        ))
    }));
    ChatContextKeys.chatSessionHasModels = ( new RawContextKey("chatSessionHasModels", false, {
        type: "boolean",
        description: ( localize(
            8466,
            "True when the chat is in a contributed chat session that has available 'models' to display."
        ))
    }));
    ChatContextKeys.chatSessionOptionsValid = ( new RawContextKey("chatSessionOptionsValid", true, {
        type: "boolean",
        description: ( localize(
            8467,
            "True when all selected session options exist in their respective option group items."
        ))
    }));
    ChatContextKeys.extensionInvalid = ( new RawContextKey("chatExtensionInvalid", false, {
        type: "boolean",
        description: ( localize(
            8468,
            "True when the installed chat extension is invalid and needs to be updated."
        ))
    }));
    ChatContextKeys.inputCursorAtTop = ( new RawContextKey("chatCursorAtTop", false));
    ChatContextKeys.inputHasAgent = ( new RawContextKey("chatInputHasAgent", false));
    ChatContextKeys.location = ( new RawContextKey("chatLocation", undefined));
    ChatContextKeys.inQuickChat = ( new RawContextKey("quickChatHasFocus", false, {
        type: "boolean",
        description: ( localize(8469, "True when the quick chat UI has focus, false otherwise."))
    }));
    ChatContextKeys.inAgentSessionsWelcome = ( new RawContextKey("inAgentSessionsWelcome", false, {
        type: "boolean",
        description: ( localize(
            8470,
            "True when the chat input is within the agent sessions welcome page."
        ))
    }));
    ChatContextKeys.inAutomationsDialog = ( new RawContextKey("inAutomationsDialog", false, {
        type: "boolean",
        description: ( localize(8471, "True when the chat input is within the automations dialog."))
    }));
    ChatContextKeys.chatSessionType = ( new RawContextKey("chatSessionType", "", {
        type: "string",
        description: ( localize(8472, "The type of the current chat session."))
    }));
    ChatContextKeys.hasFileAttachments = ( new RawContextKey("chatHasFileAttachments", false, {
        type: "boolean",
        description: ( localize(8473, "True when the chat has file attachments."))
    }));
    ChatContextKeys.chatSessionIsEmpty = ( new RawContextKey("chatSessionIsEmpty", true, {
        type: "boolean",
        description: ( localize(8474, "True when the current chat session has no requests."))
    }));
    ChatContextKeys.hasPendingRequests = ( new RawContextKey("chatHasPendingRequests", false, {
        type: "boolean",
        description: ( localize(8475, "True when there are pending requests in the queue."))
    }));
    ChatContextKeys.chatSessionHasDebugData = ( new RawContextKey("chatSessionHasDebugData", false, {
        type: "boolean",
        description: ( localize(8476, "True when the current chat session has debug log data."))
    }));
    ChatContextKeys.chatSessionHasDebugTools = ( new RawContextKey("chatSessionHasDebugTools", false, {
        type: "boolean",
        description: ( localize(8477, "True when debug tools are enabled in the current chat session."))
    }));
    ChatContextKeys.remoteJobCreating = ( new RawContextKey("chatRemoteJobCreating", false, {
        type: "boolean",
        description: ( localize(8478, "True when a remote coding agent job is being created."))
    }));
    ChatContextKeys.hasRemoteCodingAgent = ( new RawContextKey("hasRemoteCodingAgent", false, ( localize(8479, "Whether any remote coding agent is available"))));
    ChatContextKeys.hasCanDelegateProviders = ( new RawContextKey("chatHasCanDelegateProviders", false, {
        type: "boolean",
        description: ( localize(
            8480,
            "True when there are chat session providers with delegation support available."
        ))
    }));
    ChatContextKeys.enableRemoteCodingAgentPromptFileOverlay = ( new RawContextKey("enableRemoteCodingAgentPromptFileOverlay", false, ( localize(
        8481,
        "Whether the remote coding agent prompt file overlay feature is enabled"
    ))));
    ChatContextKeys.skipChatRequestInProgressMessage = ( new RawContextKey("chatSkipRequestInProgressMessage", false, {
        type: "boolean",
        description: ( localize(8482, "True when the chat request in progress message should be skipped."))
    }));
    ChatContextKeys.Setup = ChatEntitlementContextKeys.Setup;
    ChatContextKeys.Entitlement = ChatEntitlementContextKeys.Entitlement;
    ChatContextKeys.chatQuotaExceeded = ChatEntitlementContextKeys.chatQuotaExceeded;
    ChatContextKeys.completionsQuotaExceeded = ChatEntitlementContextKeys.completionsQuotaExceeded;
    ChatContextKeys.Editing = {
        hasToolConfirmation: ( new RawContextKey("chatHasToolConfirmation", false, {
            type: "boolean",
            description: ( localize(8483, "True when a tool confirmation is present."))
        })),
        hasElicitationRequest: ( new RawContextKey("chatHasElicitationRequest", false, {
            type: "boolean",
            description: ( localize(8484, "True when a chat elicitation request is pending."))
        })),
        hasQuestionCarousel: ( new RawContextKey("chatHasQuestionCarousel", false, {
            type: "boolean",
            description: ( localize(8485, "True when a question carousel is rendered in the chat input."))
        }))
    };
    ChatContextKeys.Tools = {
        toolsCount: ( new RawContextKey("toolsCount", 0, {
            type: "number",
            description: ( localize(8486, "The count of tools available in the chat."))
        }))
    };
    ChatContextKeys.foregroundSessionCount = ( new RawContextKey("chatForegroundSessionCount", 0, {
        type: "number",
        description: ( localize(
            8487,
            "The number of foreground chat sessions visible across chat surfaces."
        ))
    }));
    ChatContextKeys.Modes = {
        hasCustomChatModes: ( new RawContextKey("chatHasCustomAgents", false, {
            type: "boolean",
            description: ( localize(8488, "True when the chat has custom agents available."))
        })),
        agentModeDisabledByPolicy: ( new RawContextKey("chatAgentModeDisabledByPolicy", false, {
            type: "boolean",
            description: ( localize(8489, "True when agent mode is disabled by organization policy."))
        }))
    };
    ChatContextKeys.panelLocation = ( new RawContextKey("chatPanelLocation", undefined, {
        type: "number",
        description: ( localize(8490, "The location of the chat panel."))
    }));
    ChatContextKeys.agentSessionsViewerFocused = ( new RawContextKey("agentSessionsViewerFocused", true, {
        type: "boolean",
        description: ( localize(8491, "If the agent sessions view in the chat view is focused."))
    }));
    ChatContextKeys.agentSessionsViewerOrientation = ( new RawContextKey("agentSessionsViewerOrientation", undefined, {
        type: "number",
        description: ( localize(8492, "Orientation of the agent sessions view in the chat view."))
    }));
    ChatContextKeys.agentSessionsViewerPosition = ( new RawContextKey("agentSessionsViewerPosition", undefined, {
        type: "number",
        description: ( localize(8493, "Position of the agent sessions view in the chat view."))
    }));
    ChatContextKeys.agentSessionsViewerVisible = ( new RawContextKey("agentSessionsViewerVisible", undefined, {
        type: "boolean",
        description: ( localize(8494, "Visibility of the agent sessions view in the chat view."))
    }));
    ChatContextKeys.agentSessionType = ( new RawContextKey("chatSessionType", "", {
        type: "string",
        description: ( localize(8495, "The type of the current agent session item."))
    }));
    ChatContextKeys.chatSessionSupportsDelegation = ( new RawContextKey("chatSessionSupportsDelegation", true, {
        type: "boolean",
        description: ( localize(8496, "True when the current session type supports delegation."))
    }));
    ChatContextKeys.hasPendingDelegationTarget = ( new RawContextKey("chatHasPendingDelegationTarget", false, {
        type: "boolean",
        description: ( localize(
            8497,
            "True when a delegation (continue in) target is selected but the request has not been submitted yet."
        ))
    }));
    ChatContextKeys.chatSessionSupportsFork = ( new RawContextKey("chatSessionSupportsFork", false, {
        type: "boolean",
        description: ( localize(
            8498,
            "True when the current chat session provider supports forking conversations."
        ))
    }));
    ChatContextKeys.agentSessionSection = ( new RawContextKey("agentSessionSection", "", {
        type: "string",
        description: ( localize(8499, "The section of the current agent session section item."))
    }));
    ChatContextKeys.isArchivedAgentSession = ( new RawContextKey("agentSessionIsArchived", false, {
        type: "boolean",
        description: ( localize(8500, "True when the agent session item is archived."))
    }));
    ChatContextKeys.isPinnedAgentSession = ( new RawContextKey("agentSessionIsPinned", false, {
        type: "boolean",
        description: ( localize(8501, "True when the agent session item is pinned."))
    }));
    ChatContextKeys.isReadAgentSession = ( new RawContextKey("agentSessionIsRead", false, {
        type: "boolean",
        description: ( localize(8502, "True when the agent session item is read."))
    }));
    ChatContextKeys.hasMultipleAgentSessionsSelected = ( new RawContextKey("agentSessionHasMultipleSelected", false, {
        type: "boolean",
        description: ( localize(8503, "True when multiple agent sessions are selected."))
    }));
    ChatContextKeys.hasAgentSessionChanges = ( new RawContextKey("agentSessionHasChanges", false, {
        type: "boolean",
        description: ( localize(8504, "True when the current agent session item has changes."))
    }));
    ChatContextKeys.isKatexMathElement = ( new RawContextKey("chatIsKatexMathElement", false, {
        type: "boolean",
        description: ( localize(8505, "True when focusing a KaTeX math element."))
    }));
    ChatContextKeys.hasUsedCreateSlashCommands = ( new RawContextKey("chatHasUsedCreateSlashCommands", false, {
        type: "boolean",
        description: ( localize(8506, "True when the user has used any of the /create-* slash commands."))
    }));
    ChatContextKeys.contextUsageHasBeenOpened = ( new RawContextKey("chatContextUsageHasBeenOpened", false, {
        type: "boolean",
        description: ( localize(8507, "True when the user has opened the context window usage details."))
    }));
    ChatContextKeys.newChatButtonExperimentIcon = ( new RawContextKey("chatNewChatButtonExperimentIcon", "", {
        type: "string",
        description: ( localize(
            8508,
            "The icon variant for the new chat button, controlled by experiment. Values: 'copilot', 'new-session', 'comment', or empty for default."
        ))
    }));
})(ChatContextKeys || (ChatContextKeys = {}));
var ChatContextKeyExprs;
(function(ChatContextKeyExprs) {
    ChatContextKeyExprs.inEditingMode = ( ContextKeyExpr.or(( ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Edit)), ( ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent))));
    ChatContextKeyExprs.isAgentHostSession = ( ChatContextKeys.chatIsAgentHostSession.isEqualTo(true));
    ChatContextKeyExprs.isAgentHostSessionItem = ( ContextKeyExpr.or(( ContextKeyExpr.regex(ChatContextKeys.agentSessionType.key, /^agent-host-/)), ( ContextKeyExpr.regex(ChatContextKeys.agentSessionType.key, /^remote-/))));
})(ChatContextKeyExprs || (ChatContextKeyExprs = {}));

export { ChatContextKeyExprs, ChatContextKeys };
