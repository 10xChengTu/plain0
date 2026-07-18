
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { URI } from '../../../../../base/common/uri.js';
import { registerColor, transparent } from '../../../../../platform/theme/common/colorUtils.js';
import { foreground } from '../../../../../platform/theme/common/colors/baseColors.js';
import '../../../../../platform/theme/common/colors/chartsColors.js';
import '../../../../../platform/theme/common/colors/editorColors.js';
import '../../../../../platform/theme/common/colors/inputColors.js';
import { listActiveSelectionForeground } from '../../../../../platform/theme/common/colors/listColors.js';
import '../../../../../platform/theme/common/colors/menuColors.js';
import '../../../../../platform/theme/common/colors/minimapColors.js';
import '../../../../../platform/theme/common/colors/miscColors.js';
import '../../../../../platform/theme/common/colors/quickpickColors.js';
import '../../../../../platform/theme/common/colors/searchColors.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { isAgentHostTarget } from '../../common/chatSessionsService.js';

var AgentSessionProviders;
(function(AgentSessionProviders) {
    AgentSessionProviders["Local"] = "local";
    AgentSessionProviders["Background"] = "copilotcli";
    AgentSessionProviders["Cloud"] = "copilot-cloud-agent";
    AgentSessionProviders["Claude"] = "claude-code";
    AgentSessionProviders["Codex"] = "openai-codex";
    AgentSessionProviders["Growth"] = "copilot-growth";
    AgentSessionProviders["AgentHostCopilot"] = "agent-host-copilotcli";
    AgentSessionProviders["AgentHostClaude"] = "agent-host-claude";
    AgentSessionProviders["AgentHostCodex"] = "agent-host-codex";
})(AgentSessionProviders || (AgentSessionProviders = {}));
function isBuiltInAgentSessionProvider(provider) {
    return provider === AgentSessionProviders.Local || provider === AgentSessionProviders.Background || provider === AgentSessionProviders.Cloud || provider === AgentSessionProviders.Claude;
}
function getAgentSessionProvider(sessionResource) {
    const type = URI.isUri(sessionResource) ? getChatSessionType(sessionResource) : sessionResource;
    switch (type) {
    case AgentSessionProviders.Local:
    case AgentSessionProviders.Background:
    case AgentSessionProviders.Cloud:
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.Codex:
    case AgentSessionProviders.AgentHostCopilot:
    case AgentSessionProviders.AgentHostClaude:
    case AgentSessionProviders.AgentHostCodex:
        return type;
    default:
        return undefined;
    }
}
function getAgentSessionProviderName(provider) {
    switch (provider) {
    case AgentSessionProviders.Local:
        return localize(5524, "Local");
    case AgentSessionProviders.Background:
        return localize(5525, "Copilot CLI");
    case AgentSessionProviders.Cloud:
        return localize(5526, "Cloud");
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.AgentHostClaude:
        return "Claude";
    case AgentSessionProviders.Codex:
    case AgentSessionProviders.AgentHostCodex:
        return "Codex";
    case AgentSessionProviders.Growth:
        return "Growth";
    case AgentSessionProviders.AgentHostCopilot:
        return localize(5527, "Copilot");
    default:
        return provider;
    }
}
function getAgentSessionProviderIcon(provider) {
    switch (provider) {
    case AgentSessionProviders.Local:
        return Codicon.vm;
    case AgentSessionProviders.Background:
        return Codicon.copilot;
    case AgentSessionProviders.Cloud:
        return Codicon.cloud;
    case AgentSessionProviders.Codex:
    case AgentSessionProviders.AgentHostCodex:
        return Codicon.openai;
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.AgentHostClaude:
        return Codicon.claude;
    case AgentSessionProviders.Growth:
        return Codicon.lightbulb;
    case AgentSessionProviders.AgentHostCopilot:
        return Codicon.vm;
    default:
        return Codicon.extensions;
    }
}
function isFirstPartyAgentSessionProvider(provider) {
    switch (provider) {
    case AgentSessionProviders.Local:
    case AgentSessionProviders.Background:
    case AgentSessionProviders.Cloud:
    case AgentSessionProviders.AgentHostCopilot:
        return true;
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.AgentHostClaude:
    case AgentSessionProviders.Codex:
    case AgentSessionProviders.AgentHostCodex:
    case AgentSessionProviders.Growth:
        return false;
    default:
        return false;
    }
}
const CHAT_DELEGATE_TO_AGENT_HOST_SESSION_COMMAND_ID = "workbench.action.chat.delegateToAgentHostSession";
function getAgentCanContinueIn(provider) {
    switch (provider) {
    case AgentSessionProviders.Local:
    case AgentSessionProviders.Background:
    case AgentSessionProviders.Cloud:
    case AgentSessionProviders.AgentHostCopilot:
        return true;
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.Codex:
    case AgentSessionProviders.Growth:
        return false;
    default:
        return isAgentHostTarget(provider);
    }
}
function getAgentSessionProviderDescription(provider) {
    switch (provider) {
    case AgentSessionProviders.Local:
        return localize(
            5528,
            "Run tasks within VS Code chat. The agent iterates via chat and works interactively to implement changes on your main workspace."
        );
    case AgentSessionProviders.Background:
        return localize(
            5529,
            "Delegate tasks to a background agent running locally on your machine. The agent iterates via chat and works asynchronously in a Git worktree to implement changes isolated from your main workspace using the GitHub Copilot CLI."
        );
    case AgentSessionProviders.Cloud:
        return localize(
            5530,
            "Delegate tasks to the GitHub Copilot coding agent. The agent iterates via chat and works asynchronously in the cloud to implement changes and pull requests as needed."
        );
    case AgentSessionProviders.Claude:
    case AgentSessionProviders.AgentHostClaude:
        return localize(
            5531,
            "Delegate tasks to the Claude Agent SDK using the Claude models included in your GitHub Copilot subscription. The agent iterates via chat and works interactively to implement changes on your main workspace."
        );
    case AgentSessionProviders.Codex:
        return localize(
            5532,
            "Opens a new Codex session in the editor. Codex sessions can be managed from the chat sessions view."
        );
    case AgentSessionProviders.Growth:
        return localize(5533, "Learn about Copilot features.");
    case AgentSessionProviders.AgentHostCopilot:
        return localize(5534, "Run a Copilot SDK agent in the local agent host process.");
    default:
        return "";
    }
}
var AgentSessionsViewerOrientation;
(function(AgentSessionsViewerOrientation) {
    AgentSessionsViewerOrientation[AgentSessionsViewerOrientation["Stacked"] = 1] = "Stacked";
    AgentSessionsViewerOrientation[AgentSessionsViewerOrientation["SideBySide"] = 2] = "SideBySide";
})(AgentSessionsViewerOrientation || (AgentSessionsViewerOrientation = {}));
var AgentSessionsViewerPosition;
(function(AgentSessionsViewerPosition) {
    AgentSessionsViewerPosition[AgentSessionsViewerPosition["Left"] = 1] = "Left";
    AgentSessionsViewerPosition[AgentSessionsViewerPosition["Right"] = 2] = "Right";
})(AgentSessionsViewerPosition || (AgentSessionsViewerPosition = {}));
registerColor("agentSessionReadIndicator.foreground", {
    dark: ( transparent(foreground, 0.2)),
    light: ( transparent(foreground, 0.2)),
    hcDark: null,
    hcLight: null
}, ( localize(5535, "Foreground color for the read indicator in an agent session.")));
registerColor("agentSessionSelectedBadge.border", {
    dark: ( transparent(listActiveSelectionForeground, 0.3)),
    light: ( transparent(listActiveSelectionForeground, 0.3)),
    hcDark: foreground,
    hcLight: foreground
}, ( localize(5536, "Border color for the badges in selected agent session items.")));
registerColor("agentSessionSelectedUnfocusedBadge.border", {
    dark: ( transparent(foreground, 0.3)),
    light: ( transparent(foreground, 0.3)),
    hcDark: foreground,
    hcLight: foreground
}, ( localize(
    5537,
    "Border color for the badges in selected agent session items when the view is unfocused."
)));
const AGENT_SESSION_RENAME_ACTION_ID = "agentSession.rename";
const AGENT_SESSION_DELETE_ACTION_ID = "agentSession.delete";

export { AGENT_SESSION_DELETE_ACTION_ID, AGENT_SESSION_RENAME_ACTION_ID, AgentSessionProviders, AgentSessionsViewerOrientation, AgentSessionsViewerPosition, CHAT_DELEGATE_TO_AGENT_HOST_SESSION_COMMAND_ID, getAgentCanContinueIn, getAgentSessionProvider, getAgentSessionProviderDescription, getAgentSessionProviderIcon, getAgentSessionProviderName, isAgentHostTarget, isBuiltInAgentSessionProvider, isFirstPartyAgentSessionProvider };
