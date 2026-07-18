
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { isEqual } from '../../../../../../base/common/resources.js';

function newInstructionsCollectionEvent() {
    return { applyingInstructionsCount: 0, referencedInstructionsCount: 0, agentInstructionsCount: 0, listedInstructionsCount: 0, totalInstructionsCount: 0, claudeRulesCount: 0, claudeMdCount: 0, claudeAgentsCount: 0 };
}
function newInstructionsCollectionDebugInfo() {
    return { debugDetails: [], durationInMillis: 0 };
}
const CUSTOM_AGENT_PROVIDER_ACTIVATION_EVENT = 'onCustomAgentProvider';
const INSTRUCTIONS_PROVIDER_ACTIVATION_EVENT = 'onInstructionsProvider';
const PROMPT_FILE_PROVIDER_ACTIVATION_EVENT = 'onPromptFileProvider';
const SKILL_PROVIDER_ACTIVATION_EVENT = 'onSkillProvider';
function matchesSessionType(sessionTypes, currentSessionType) {
    return sessionTypes === undefined || currentSessionType === undefined || sessionTypes.includes(currentSessionType);
}
var PromptsStorage;
(function (PromptsStorage) {
    PromptsStorage["local"] = "local";
    PromptsStorage["user"] = "user";
    PromptsStorage["extension"] = "extension";
    PromptsStorage["plugin"] = "plugin";
})(PromptsStorage || (PromptsStorage = {}));
var IAgentSource;
(function (IAgentSource) {
    function fromPromptPath(promptPath) {
        if (promptPath.storage === PromptsStorage.extension) {
            return { storage: PromptsStorage.extension, extensionId: promptPath.extension.identifier };
        }
        else if (promptPath.storage === PromptsStorage.plugin) {
            return { storage: PromptsStorage.plugin, pluginUri: promptPath.pluginUri };
        }
        else {
            return { storage: promptPath.storage };
        }
    }
    IAgentSource.fromPromptPath = fromPromptPath;
    function isEquals(a, b) {
        if (a === b) {
            return true;
        }
        if (!a || !b) {
            return false;
        }
        if (a.storage !== b.storage) {
            return false;
        }
        if (a.storage === PromptsStorage.extension && b.storage === PromptsStorage.extension) {
            return ExtensionIdentifier.equals(a.extensionId, b.extensionId);
        }
        else if (a.storage === PromptsStorage.plugin && b.storage === PromptsStorage.plugin) {
            return isEqual(a.pluginUri, b.pluginUri);
        }
        return true;
    }
    IAgentSource.isEquals = isEquals;
})(IAgentSource || (IAgentSource = {}));
function isCustomAgentVisibility(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const v = obj;
    return typeof v.userInvocable === 'boolean' && typeof v.agentInvocable === 'boolean';
}
var AgentInstructionFileType;
(function (AgentInstructionFileType) {
    AgentInstructionFileType["agentsMd"] = "agentsMd";
    AgentInstructionFileType["claudeMd"] = "claudeMd";
    AgentInstructionFileType["copilotInstructionsMd"] = "copilotInstructionsMd";
})(AgentInstructionFileType || (AgentInstructionFileType = {}));

export { AgentInstructionFileType, CUSTOM_AGENT_PROVIDER_ACTIVATION_EVENT, IAgentSource, INSTRUCTIONS_PROVIDER_ACTIVATION_EVENT, PROMPT_FILE_PROVIDER_ACTIVATION_EVENT, PromptsStorage, SKILL_PROVIDER_ACTIVATION_EVENT, isCustomAgentVisibility, matchesSessionType, newInstructionsCollectionDebugInfo, newInstructionsCollectionEvent };
