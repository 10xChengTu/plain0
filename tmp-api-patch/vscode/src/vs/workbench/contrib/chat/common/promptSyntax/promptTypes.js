
import { localize } from '../../../../../nls.js';

const PROMPT_DOCUMENTATION_URL = "https://aka.ms/vscode-ghcp-prompt-snippets";
const INSTRUCTIONS_DOCUMENTATION_URL = "https://aka.ms/vscode-ghcp-custom-instructions";
const AGENT_DOCUMENTATION_URL = "https://aka.ms/vscode-ghcp-custom-chat-modes";
const SKILL_DOCUMENTATION_URL = "https://aka.ms/vscode-agent-skills";
const HOOK_DOCUMENTATION_URL = "https://aka.ms/vscode-chat-hooks";
const PROMPT_LANGUAGE_ID = "prompt";
const INSTRUCTIONS_LANGUAGE_ID = "instructions";
const AGENT_LANGUAGE_ID = "chatagent";
const SKILL_LANGUAGE_ID = "skill";
const ALL_PROMPTS_LANGUAGE_SELECTOR = [
    PROMPT_LANGUAGE_ID,
    INSTRUCTIONS_LANGUAGE_ID,
    AGENT_LANGUAGE_ID,
    SKILL_LANGUAGE_ID
];
const AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING = "github.copilot.chat.agentDebugLog.fileLogging.enabled";
const TROUBLESHOOT_COMMAND_NAME = "troubleshoot";
const COPILOT_SKILL_URI_SCHEME = "copilot-skill";
const TROUBLESHOOT_SKILL_PATH = "troubleshoot/SKILL.md";
function getLanguageIdForPromptsType(type) {
    switch (type) {
    case PromptsType.prompt:
        return PROMPT_LANGUAGE_ID;
    case PromptsType.instructions:
        return INSTRUCTIONS_LANGUAGE_ID;
    case PromptsType.agent:
        return AGENT_LANGUAGE_ID;
    case PromptsType.skill:
        return SKILL_LANGUAGE_ID;
    case PromptsType.hook:
        return "jsonc";
    default:
        throw ( new Error(`Unknown prompt type: ${type}`));
    }
}
function getPromptsTypeForLanguageId(languageId) {
    switch (languageId) {
    case PROMPT_LANGUAGE_ID:
        return PromptsType.prompt;
    case INSTRUCTIONS_LANGUAGE_ID:
        return PromptsType.instructions;
    case AGENT_LANGUAGE_ID:
        return PromptsType.agent;
    case SKILL_LANGUAGE_ID:
        return PromptsType.skill;
    default:
        return undefined;
    }
}
var PromptsType;
(function(PromptsType) {
    PromptsType["instructions"] = "instructions";
    PromptsType["prompt"] = "prompt";
    PromptsType["agent"] = "agent";
    PromptsType["skill"] = "skill";
    PromptsType["hook"] = "hook";
})(PromptsType || (PromptsType = {}));
function isValidPromptType(type) {
    return ( Object.values(PromptsType)).includes(type);
}
var Target;
(function(Target) {
    Target["VSCode"] = "vscode";
    Target["GitHubCopilot"] = "github-copilot";
    Target["Claude"] = "claude";
    Target["Undefined"] = "undefined";
})(Target || (Target = {}));
var PromptFileSource;
(function(PromptFileSource) {
    PromptFileSource["GitHubWorkspace"] = "github-workspace";
    PromptFileSource["CopilotPersonal"] = "copilot-personal";
    PromptFileSource["ClaudePersonal"] = "claude-personal";
    PromptFileSource["ClaudeWorkspace"] = "claude-workspace";
    PromptFileSource["ClaudeWorkspaceLocal"] = "claude-workspace-local";
    PromptFileSource["AgentsWorkspace"] = "agents-workspace";
    PromptFileSource["AgentsPersonal"] = "agents-personal";
    PromptFileSource["ConfigWorkspace"] = "config-workspace";
    PromptFileSource["ConfigPersonal"] = "config-personal";
    PromptFileSource["UserData"] = "user-data";
    PromptFileSource["ExtensionContribution"] = "extension-contribution";
    PromptFileSource["ExtensionAPI"] = "extension-api";
    PromptFileSource["Plugin"] = "plugin";
})(PromptFileSource || (PromptFileSource = {}));
function getSourceDescription(source) {
    switch (source) {
    case PromptFileSource.AgentsWorkspace:
        return localize(8930, "Workspace");
    case PromptFileSource.AgentsPersonal:
        return localize(8931, "Global");
    case PromptFileSource.GitHubWorkspace:
        return localize(8932, "Workspace (only used by Copilot agents)");
    case PromptFileSource.CopilotPersonal:
        return localize(8933, "Global (only used by Copilot agents)");
    case PromptFileSource.ClaudeWorkspace:
        return localize(8934, "Workspace (only used by Claude agents)");
    case PromptFileSource.ClaudeWorkspaceLocal:
        return localize(8935, "Workspace (only used by Claude agents, usually git-ignored)");
    case PromptFileSource.ClaudePersonal:
        return localize(8936, "Global (only used by Claude agents)");
    case PromptFileSource.UserData:
        return localize(8937, "Global (roams with Settings Sync, only used by VS Code)");
    case PromptFileSource.ConfigWorkspace:
        return localize(8938, "Workspace (contributed from settings)");
    case PromptFileSource.ConfigPersonal:
        return localize(8939, "Global (contributed from settings)");
    default:
        return undefined;
    }
}

export { AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING, AGENT_DOCUMENTATION_URL, AGENT_LANGUAGE_ID, ALL_PROMPTS_LANGUAGE_SELECTOR, COPILOT_SKILL_URI_SCHEME, HOOK_DOCUMENTATION_URL, INSTRUCTIONS_DOCUMENTATION_URL, INSTRUCTIONS_LANGUAGE_ID, PROMPT_DOCUMENTATION_URL, PROMPT_LANGUAGE_ID, PromptFileSource, PromptsType, SKILL_DOCUMENTATION_URL, SKILL_LANGUAGE_ID, TROUBLESHOOT_COMMAND_NAME, TROUBLESHOOT_SKILL_PATH, Target, getLanguageIdForPromptsType, getPromptsTypeForLanguageId, getSourceDescription, isValidPromptType };
