
import { dirname } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { SpecedToolAliases } from '../../tools/languageModelToolsService.js';
import { CLAUDE_AGENTS_SOURCE_FOLDER, isInClaudeRulesFolder } from '../config/promptFileLocations.js';
import { PromptHeaderAttributes } from '../promptFileParser.js';
import { Target, PromptsType } from '../promptTypes.js';

var GithubPromptHeaderAttributes;
(function(GithubPromptHeaderAttributes) {
    GithubPromptHeaderAttributes.mcpServers = "mcp-servers";
    GithubPromptHeaderAttributes.github = "github";
})(GithubPromptHeaderAttributes || (GithubPromptHeaderAttributes = {}));
var ClaudeHeaderAttributes;
(function(ClaudeHeaderAttributes) {
    ClaudeHeaderAttributes.disallowedTools = "disallowedTools";
})(ClaudeHeaderAttributes || (ClaudeHeaderAttributes = {}));
function isTarget(value) {
    return value === Target.VSCode || value === Target.GitHubCopilot || value === Target.Claude || value === Target.Undefined;
}
const booleanAttributeEnumValues = [{
    name: "true"
}, {
    name: "false"
}];
const targetAttributeEnumValues = [{
    name: "vscode"
}, {
    name: "github-copilot"
}];
const promptFileAttributes = {
    [PromptHeaderAttributes.name]: {
        type: "scalar",
        description: ( localize(
            8684,
            "The name of the prompt. This is also the name of the slash command that will run this prompt."
        ))
    },
    [PromptHeaderAttributes.description]: {
        type: "scalar",
        description: ( localize(
            8685,
            "The description of the reusable prompt, what it does and when to use it."
        ))
    },
    [PromptHeaderAttributes.argumentHint]: {
        type: "scalar",
        description: ( localize(
            8686,
            "The argument-hint describes what inputs the prompt expects or supports."
        ))
    },
    [PromptHeaderAttributes.model]: {
        type: "scalar | sequence",
        description: ( localize(
            8687,
            "The model to use in this prompt. Can also be a list of models. The first available model will be used."
        ))
    },
    [PromptHeaderAttributes.tools]: {
        type: "scalar | sequence",
        description: ( localize(8688, "The tools to use in this prompt.")),
        defaults: ["[]", "['search', 'edit', 'web']"]
    },
    [PromptHeaderAttributes.agent]: {
        type: "scalar",
        description: ( localize(8689, "The agent to use when running this prompt."))
    },
    [PromptHeaderAttributes.mode]: {
        type: "scalar",
        description: ( localize(8689, "The agent to use when running this prompt."))
    }
};
const instructionAttributes = {
    [PromptHeaderAttributes.name]: {
        type: "scalar",
        description: ( localize(
            8690,
            "The name of the instruction file as shown in the UI. If not set, the name is derived from the file name."
        ))
    },
    [PromptHeaderAttributes.description]: {
        type: "scalar",
        description: ( localize(
            8691,
            "The description of the instruction file. It can be used to provide additional context or information about the instructions and is passed to the language model as part of the prompt."
        ))
    },
    [PromptHeaderAttributes.applyTo]: {
        type: "scalar",
        description: ( localize(
            8692,
            "One or more glob pattern (separated by comma) that describe for which files the instructions apply to. Based on these patterns, the file is automatically included in the prompt, when the context contains a file that matches one or more of these patterns. Use `**` when you want this file to always be added.\nExample: `**/*.ts`, `**/*.js`, `client/**`"
        )),
        defaults: ["'**'", "'**/*.ts, **/*.js'", "'**/*.php'", "'**/*.py'"]
    },
    [PromptHeaderAttributes.excludeAgent]: {
        type: "scalar | sequence",
        description: ( localize(8693, "One or more agents to exclude from using this instruction file."))
    }
};
const customAgentAttributes = {
    [PromptHeaderAttributes.name]: {
        type: "scalar",
        description: ( localize(8694, "The name of the agent as shown in the UI."))
    },
    [PromptHeaderAttributes.description]: {
        type: "scalar",
        description: ( localize(
            8695,
            "The description of the custom agent, what it does and when to use it."
        ))
    },
    [PromptHeaderAttributes.argumentHint]: {
        type: "scalar",
        description: ( localize(
            8696,
            "The argument-hint describes what inputs the custom agent expects or supports."
        ))
    },
    [PromptHeaderAttributes.model]: {
        type: "scalar | sequence",
        description: ( localize(
            8697,
            "Specify the model that runs this custom agent. Can also be a list of models. The first available model will be used."
        ))
    },
    [PromptHeaderAttributes.tools]: {
        type: "scalar | sequence",
        description: ( localize(8698, "The set of tools that the custom agent has access to.")),
        defaults: ["[]", "[search, edit, web]"]
    },
    [PromptHeaderAttributes.handOffs]: {
        type: "sequence",
        description: ( localize(8699, "Possible handoff actions when the agent has completed its task."))
    },
    [PromptHeaderAttributes.target]: {
        type: "scalar",
        description: ( localize(
            8700,
            "The target to which the header attributes like tools apply to. Possible values are `github-copilot` and `vscode`."
        )),
        enums: targetAttributeEnumValues
    },
    [PromptHeaderAttributes.infer]: {
        type: "scalar",
        description: ( localize(8701, "Controls visibility of the agent.")),
        enums: booleanAttributeEnumValues
    },
    [PromptHeaderAttributes.agents]: {
        type: "sequence",
        description: ( localize(
            8702,
            "One or more agents that this agent can use as subagents. Use '*' to specify all available agents."
        )),
        defaults: ["[\"*\"]"]
    },
    [PromptHeaderAttributes.userInvocable]: {
        type: "scalar",
        description: ( localize(8703, "Whether the agent can be selected and invoked by users in the UI.")),
        enums: booleanAttributeEnumValues
    },
    [PromptHeaderAttributes.disableModelInvocation]: {
        type: "scalar",
        description: ( localize(8704, "If true, prevents the agent from being invoked as a subagent.")),
        enums: booleanAttributeEnumValues
    },
    [PromptHeaderAttributes.advancedOptions]: {
        type: "map",
        description: ( localize(8705, "Advanced options for custom agent behavior."))
    },
    [GithubPromptHeaderAttributes.github]: {
        type: "map",
        description: ( localize(
            8706,
            "GitHub-specific configuration for the agent, such as token permissions."
        ))
    },
    [PromptHeaderAttributes.hooks]: {
        type: "map",
        description: ( localize(
            8707,
            "Lifecycle hooks scoped to this agent. Define hooks that run only while this agent is active."
        ))
    }
};
const skillAttributes = {
    [PromptHeaderAttributes.name]: {
        type: "scalar",
        description: ( localize(8708, "The name of the skill."))
    },
    [PromptHeaderAttributes.description]: {
        type: "scalar",
        description: ( localize(
            8709,
            "The description of the skill. The description is added to every request and will be used by the agent to decide when to load the skill."
        ))
    },
    [PromptHeaderAttributes.argumentHint]: {
        type: "scalar",
        description: ( localize(
            8710,
            "Hint shown during autocomplete to indicate expected arguments. Example: [issue-number] or [filename] [format]"
        ))
    },
    [PromptHeaderAttributes.userInvocable]: {
        type: "scalar",
        description: ( localize(
            8711,
            "Set to false to hide from the / menu. Use for background knowledge users should not invoke directly. Default: true."
        )),
        enums: booleanAttributeEnumValues
    },
    [PromptHeaderAttributes.disableModelInvocation]: {
        type: "scalar",
        description: ( localize(
            8712,
            "Set to true to prevent the agent from automatically loading this skill. Use for workflows you want to trigger manually with /name. Default: false."
        )),
        enums: booleanAttributeEnumValues
    },
    [PromptHeaderAttributes.license]: {
        type: "scalar | map",
        description: ( localize(8713, "License information for the skill."))
    },
    [PromptHeaderAttributes.compatibility]: {
        type: "scalar | map",
        description: ( localize(8714, "Compatibility metadata for environments or runtimes."))
    },
    [PromptHeaderAttributes.metadata]: {
        type: "map",
        description: ( localize(8715, "Additional metadata for the skill."))
    },
    [PromptHeaderAttributes.context]: {
        type: "scalar",
        description: ( localize(
            8716,
            "Controls how the skill is loaded. Set to 'fork' to spawn a subagent with the skill instructions instead of returning them inline."
        )),
        enums: [{
            name: "fork",
            description: ( localize(
                8717,
                "Spawn a subagent with the skill instructions injected as system context."
            ))
        }]
    }
};
const allAttributeNames = {
    [PromptsType.prompt]: ( Object.keys(promptFileAttributes)),
    [PromptsType.instructions]: ( Object.keys(instructionAttributes)),
    [PromptsType.agent]: ( Object.keys(customAgentAttributes)),
    [PromptsType.skill]: ( Object.keys(skillAttributes)),
    [PromptsType.hook]: []
};
const githubCopilotAgentAttributeNames = [
    PromptHeaderAttributes.name,
    PromptHeaderAttributes.description,
    PromptHeaderAttributes.tools,
    PromptHeaderAttributes.target,
    GithubPromptHeaderAttributes.mcpServers,
    GithubPromptHeaderAttributes.github,
    PromptHeaderAttributes.infer
];
const recommendedAttributeNames = {
    [PromptsType.prompt]: allAttributeNames[PromptsType.prompt].filter(name => !isNonRecommendedAttribute(name)),
    [PromptsType.instructions]: allAttributeNames[PromptsType.instructions].filter(name => !isNonRecommendedAttribute(name)),
    [PromptsType.agent]: allAttributeNames[PromptsType.agent].filter(name => !isNonRecommendedAttribute(name)),
    [PromptsType.skill]: allAttributeNames[PromptsType.skill].filter(name => !isNonRecommendedAttribute(name)),
    [PromptsType.hook]: []
};
function getValidAttributeNames(promptType, includeNonRecommended, target) {
    if (target === Target.Claude) {
        if (promptType === PromptsType.instructions) {
            return ( Object.keys(claudeRulesAttributes));
        }
        return ( Object.keys(claudeAgentAttributes));
    } else if (target === Target.GitHubCopilot) {
        if (promptType === PromptsType.agent) {
            return githubCopilotAgentAttributeNames;
        }
    }
    return includeNonRecommended ? allAttributeNames[promptType] : recommendedAttributeNames[promptType];
}
function isNonRecommendedAttribute(attributeName) {
    return attributeName === PromptHeaderAttributes.advancedOptions || attributeName === PromptHeaderAttributes.excludeAgent || attributeName === PromptHeaderAttributes.mode || attributeName === PromptHeaderAttributes.infer;
}
function getAttributeDefinition(attributeName, promptType, target) {
    switch (promptType) {
    case PromptsType.instructions:
        if (target === Target.Claude) {
            return claudeRulesAttributes[attributeName];
        }
        return instructionAttributes[attributeName];
    case PromptsType.skill:
        return skillAttributes[attributeName];
    case PromptsType.agent:
        if (target === Target.Claude) {
            return claudeAgentAttributes[attributeName];
        }
        return customAgentAttributes[attributeName];
    case PromptsType.prompt:
        return promptFileAttributes[attributeName];
    default:
        return undefined;
    }
}
const knownGithubCopilotTools = [{
    name: SpecedToolAliases.execute,
    description: ( localize(8718, "Execute commands"))
}, {
    name: SpecedToolAliases.read,
    description: ( localize(8719, "Read files"))
}, {
    name: SpecedToolAliases.edit,
    description: ( localize(8720, "Edit files"))
}, {
    name: SpecedToolAliases.search,
    description: ( localize(8721, "Search files"))
}, {
    name: SpecedToolAliases.agent,
    description: ( localize(8722, "Use subagents"))
}];
const knownClaudeTools = [{
    name: "Bash",
    description: ( localize(8723, "Execute shell commands")),
    toolEquivalent: [SpecedToolAliases.execute]
}, {
    name: "Edit",
    description: ( localize(8724, "Make targeted file edits")),
    toolEquivalent: ["edit/editNotebook", "edit/editFiles"]
}, {
    name: "Glob",
    description: ( localize(8725, "Find files by pattern")),
    toolEquivalent: ["search/fileSearch"]
}, {
    name: "Grep",
    description: ( localize(8726, "Search file contents with regex")),
    toolEquivalent: ["search/textSearch"]
}, {
    name: "Read",
    description: ( localize(8727, "Read file contents")),
    toolEquivalent: ["read/readFile", "read/getNotebookSummary"]
}, {
    name: "Write",
    description: ( localize(8728, "Create/overwrite files")),
    toolEquivalent: ["edit/createDirectory", "edit/createFile", "edit/createJupyterNotebook"]
}, {
    name: "WebFetch",
    description: ( localize(8729, "Fetch URL content")),
    toolEquivalent: [SpecedToolAliases.web]
}, {
    name: "WebSearch",
    description: ( localize(8730, "Perform web searches")),
    toolEquivalent: [SpecedToolAliases.web]
}, {
    name: "Task",
    description: ( localize(8731, "Run subagents for complex tasks")),
    toolEquivalent: [SpecedToolAliases.agent]
}, {
    name: "Skill",
    description: ( localize(8732, "Execute skills")),
    toolEquivalent: []
}, {
    name: "LSP",
    description: ( localize(8733, "Code intelligence (requires plugin)")),
    toolEquivalent: []
}, {
    name: "NotebookEdit",
    description: ( localize(8734, "Modify Jupyter notebooks")),
    toolEquivalent: ["edit/editNotebook"]
}, {
    name: "AskUserQuestion",
    description: ( localize(8735, "Ask multiple-choice questions")),
    toolEquivalent: ["vscode/askQuestions"]
}, {
    name: "MCPSearch",
    description: ( localize(8736, "Searches for MCP tools when tool search is enabled")),
    toolEquivalent: []
}];
const knownClaudeModels = [{
    name: "sonnet",
    description: ( localize(8737, "Latest Claude Sonnet")),
    modelEquivalent: "Claude Sonnet 4.5 (copilot)"
}, {
    name: "opus",
    description: ( localize(8738, "Latest Claude Opus")),
    modelEquivalent: "Claude Opus 4.6 (copilot)"
}, {
    name: "haiku",
    description: ( localize(8739, "Latest Claude Haiku, fast for simple tasks")),
    modelEquivalent: "Claude Haiku 4.5 (copilot)"
}, {
    name: "inherit",
    description: ( localize(8740, "Inherit model from parent agent or prompt")),
    modelEquivalent: undefined
}];
function mapClaudeModels(claudeModelNames) {
    const result = [];
    for (const name of claudeModelNames) {
        const claudeModel = knownClaudeModels.find(model => model.name === name);
        if (claudeModel && claudeModel.modelEquivalent) {
            result.push(claudeModel.modelEquivalent);
        }
    }
    return result;
}
function mapClaudeTools(claudeToolNames) {
    const result = [];
    for (const name of claudeToolNames) {
        const claudeTool = knownClaudeTools.find(tool => tool.name === name);
        if (claudeTool) {
            result.push(...claudeTool.toolEquivalent);
        }
    }
    return result;
}
const claudeAgentAttributes = {
    "name": {
        type: "scalar",
        description: ( localize(8741, "Unique identifier using lowercase letters and hyphens (required)"))
    },
    "description": {
        type: "scalar",
        description: ( localize(8742, "When to delegate to this subagent (required)"))
    },
    "tools": {
        type: "sequence",
        description: ( localize(8743, "Array of tools the subagent can use. Inherits all tools if omitted")),
        defaults: ["Read, Edit, Bash"],
        items: knownClaudeTools
    },
    "disallowedTools": {
        type: "sequence",
        description: ( localize(8744, "Tools to deny, removed from inherited or specified list")),
        defaults: ["Write, Edit, Bash"],
        items: knownClaudeTools
    },
    "model": {
        type: "scalar",
        description: ( localize(
            8745,
            "Model to use: sonnet, opus, haiku, or inherit. Defaults to inherit."
        )),
        defaults: ["sonnet", "opus", "haiku", "inherit"],
        enums: knownClaudeModels
    },
    "permissionMode": {
        type: "scalar",
        description: ( localize(
            8746,
            "Permission mode: default, acceptEdits, dontAsk, bypassPermissions, or plan."
        )),
        defaults: ["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"],
        enums: [{
            name: "default",
            description: ( localize(
                8747,
                "Standard behavior: prompts for permission on first use of each tool."
            ))
        }, {
            name: "acceptEdits",
            description: ( localize(8748, "Automatically accepts file edit permissions for the session."))
        }, {
            name: "plan",
            description: ( localize(
                8749,
                "Plan Mode: Claude can analyze but not modify files or execute commands."
            ))
        }, {
            name: "delegate",
            description: ( localize(
                8750,
                "Coordination-only mode for agent team leads. Only available when an agent team is active."
            ))
        }, {
            name: "dontAsk",
            description: ( localize(
                8751,
                "Auto-denies tools unless pre-approved via /permissions or permissions.allow rules."
            ))
        }, {
            name: "bypassPermissions",
            description: ( localize(
                8752,
                "Skips all permission prompts (requires safe environment like containers)."
            ))
        }]
    },
    "skills": {
        type: "sequence",
        description: ( localize(8753, "Skills to load into the subagent's context at startup."))
    },
    "mcpServers": {
        type: "sequence",
        description: ( localize(8754, "MCP servers available to this subagent."))
    },
    "hooks": {
        type: "object",
        description: ( localize(8755, "Lifecycle hooks scoped to this subagent."))
    },
    "memory": {
        type: "scalar",
        description: ( localize(
            8756,
            "Persistent memory scope: user, project, or local. Enables cross-session learning."
        )),
        defaults: ["user", "project", "local"],
        enums: [{
            name: "user",
            description: ( localize(8757, "Remember learnings across all projects."))
        }, {
            name: "project",
            description: ( localize(
                8758,
                "The subagent's knowledge is project-specific and shareable via version control."
            ))
        }, {
            name: "local",
            description: ( localize(
                8759,
                "The subagent's knowledge is project-specific but should not be checked into version control."
            ))
        }]
    }
};
const claudeRulesAttributes = {
    "description": {
        type: "scalar",
        description: ( localize(
            8760,
            "A description of what this rule covers, used to provide context about when it applies."
        ))
    },
    "paths": {
        type: "sequence",
        description: ( localize(
            8761,
            "Array of glob patterns that describe for which files the rule applies. Based on these patterns, the file is automatically included in the prompt when the context contains a file that matches.\nExample: `['src/**/*.ts', 'test/**']`"
        ))
    }
};
function isVSCodeOrDefaultTarget(target) {
    return target === Target.VSCode || target === Target.Undefined;
}
function getTarget(promptType, header) {
    const uri = header instanceof URI ? header : header.uri;
    if (promptType === PromptsType.agent) {
        const parentDir = dirname(uri);
        if (parentDir.path.endsWith(`/${CLAUDE_AGENTS_SOURCE_FOLDER}`)) {
            return Target.Claude;
        }
        if (!(header instanceof URI)) {
            const target = header.target;
            if (target === Target.GitHubCopilot || target === Target.VSCode) {
                return target;
            }
        }
        return Target.Undefined;
    } else if (promptType === PromptsType.instructions) {
        if (isInClaudeRulesFolder(uri)) {
            return Target.Claude;
        }
    }
    return Target.Undefined;
}

export { ClaudeHeaderAttributes, GithubPromptHeaderAttributes, claudeAgentAttributes, claudeRulesAttributes, customAgentAttributes, getAttributeDefinition, getTarget, getValidAttributeNames, instructionAttributes, isNonRecommendedAttribute, isTarget, isVSCodeOrDefaultTarget, knownClaudeModels, knownClaudeTools, knownGithubCopilotTools, mapClaudeModels, mapClaudeTools, promptFileAttributes, skillAttributes };
