
import { localize } from '../../../../../nls.js';
import { Target } from './promptTypes.js';

var HookType;
(function(HookType) {
    HookType["SessionStart"] = "SessionStart";
    HookType["SessionEnd"] = "SessionEnd";
    HookType["UserPromptSubmit"] = "UserPromptSubmit";
    HookType["PreToolUse"] = "PreToolUse";
    HookType["PostToolUse"] = "PostToolUse";
    HookType["PreCompact"] = "PreCompact";
    HookType["SubagentStart"] = "SubagentStart";
    HookType["SubagentStop"] = "SubagentStop";
    HookType["Stop"] = "Stop";
    HookType["ErrorOccurred"] = "ErrorOccurred";
})(HookType || (HookType = {}));
const HOOKS_BY_TARGET = {
    [Target.VSCode]: {
        "SessionStart": HookType.SessionStart,
        "UserPromptSubmit": HookType.UserPromptSubmit,
        "PreToolUse": HookType.PreToolUse,
        "PostToolUse": HookType.PostToolUse,
        "PreCompact": HookType.PreCompact,
        "SubagentStart": HookType.SubagentStart,
        "SubagentStop": HookType.SubagentStop,
        "Stop": HookType.Stop
    },
    [Target.GitHubCopilot]: {
        "sessionStart": HookType.SessionStart,
        "sessionEnd": HookType.SessionEnd,
        "userPromptSubmitted": HookType.UserPromptSubmit,
        "preToolUse": HookType.PreToolUse,
        "postToolUse": HookType.PostToolUse,
        "agentStop": HookType.Stop,
        "subagentStop": HookType.SubagentStop,
        "errorOccurred": HookType.ErrorOccurred
    },
    [Target.Claude]: {
        "SessionStart": HookType.SessionStart,
        "UserPromptSubmit": HookType.UserPromptSubmit,
        "PreToolUse": HookType.PreToolUse,
        "PostToolUse": HookType.PostToolUse,
        "PreCompact": HookType.PreCompact,
        "SubagentStart": HookType.SubagentStart,
        "SubagentStop": HookType.SubagentStop,
        "Stop": HookType.Stop
    },
    [Target.Undefined]: Object.fromEntries(( ( Object.values(HookType)).map(h => [h, h])))
};
const HOOK_METADATA = {
    [HookType.SessionStart]: {
        label: ( localize(8652, "Session Start")),
        description: ( localize(8653, "Executed when a new agent session begins."))
    },
    [HookType.UserPromptSubmit]: {
        label: ( localize(8654, "User Prompt Submit")),
        description: ( localize(8655, "Executed when the user submits a prompt to the agent."))
    },
    [HookType.PreToolUse]: {
        label: ( localize(8656, "Pre-Tool Use")),
        description: ( localize(8657, "Executed before the agent uses any tool."))
    },
    [HookType.PostToolUse]: {
        label: ( localize(8658, "Post-Tool Use")),
        description: ( localize(8659, "Executed after a tool completes execution successfully."))
    },
    [HookType.PreCompact]: {
        label: ( localize(8660, "Pre-Compact")),
        description: ( localize(8661, "Executed before the agent compacts the conversation context."))
    },
    [HookType.SubagentStart]: {
        label: ( localize(8662, "Subagent Start")),
        description: ( localize(8663, "Executed when a subagent is started."))
    },
    [HookType.SubagentStop]: {
        label: ( localize(8664, "Subagent Stop")),
        description: ( localize(8665, "Executed when a subagent stops."))
    },
    [HookType.Stop]: {
        label: ( localize(8666, "Stop")),
        description: ( localize(8667, "Executed when the agent stops."))
    },
    [HookType.SessionEnd]: {
        label: ( localize(8668, "Session End")),
        description: ( localize(8669, "Executed when an agent session ends."))
    },
    [HookType.ErrorOccurred]: {
        label: ( localize(8670, "Error Occurred")),
        description: ( localize(8671, "Executed when an error occurs during the agent session."))
    }
};

export { HOOKS_BY_TARGET, HOOK_METADATA, HookType };
