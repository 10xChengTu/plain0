
import { URI } from '../../../../base/common/uri.js';
import { isRemoteAgentHostSessionType } from '../../../../platform/agentHost/common/agentHostSessionType.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LOCAL_AGENT_HOST_SCHEME_PREFIX } from '../../../../platform/agentHost/common/agentHostConnectionsService.js';

var ChatSessionsExtensions;
(function(ChatSessionsExtensions) {
    ChatSessionsExtensions["AsyncActivation"] = "workbench.contrib.chatSessions.asyncActivation";
})(ChatSessionsExtensions || (ChatSessionsExtensions = {}));
class AsyncChatSessionActivationRegistry {
    constructor() {
        this._contributions = ( new Set());
    }
    register(contribution) {
        this._contributions.add(contribution);
        return {
            dispose: () => this._contributions.delete(contribution)
        };
    }
    getActivators(sessionType) {
        return Array.from(this._contributions).filter(contribution => contribution.matchSessionType(sessionType));
    }
}
Registry.add(ChatSessionsExtensions.AsyncActivation, ( new AsyncChatSessionActivationRegistry()));
var ChatSessionStatus;
(function(ChatSessionStatus) {
    ChatSessionStatus[ChatSessionStatus["Failed"] = 0] = "Failed";
    ChatSessionStatus[ChatSessionStatus["Completed"] = 1] = "Completed";
    ChatSessionStatus[ChatSessionStatus["InProgress"] = 2] = "InProgress";
    ChatSessionStatus[ChatSessionStatus["NeedsInput"] = 3] = "NeedsInput";
})(ChatSessionStatus || (ChatSessionStatus = {}));
var SessionType;
(function(SessionType) {
    SessionType.CopilotCLI = "copilotcli";
    SessionType.CopilotCloud = "copilot-cloud-agent";
    SessionType.Local = "local";
    SessionType.ClaudeCode = "claude-code";
    SessionType.Codex = "openai-codex";
    SessionType.Growth = "copilot-growth";
    SessionType.AgentHostCopilot = "agent-host-copilotcli";
    SessionType.AgentHostClaude = "agent-host-claude";
    SessionType.AgentHostCodex = "agent-host-codex";
})(SessionType || (SessionType = {}));
function isLocalAgentHostTarget(target) {
    return target === SessionType.AgentHostCopilot || target.startsWith(LOCAL_AGENT_HOST_SCHEME_PREFIX);
}
function isRemoteAgentHostTarget(target) {
    return isRemoteAgentHostSessionType(target);
}
function isAgentHostTarget(target) {
    return isLocalAgentHostTarget(target) || isRemoteAgentHostTarget(target);
}
const localChatSessionType = SessionType.Local;
var ChatSessionOptionsMap;
(function(ChatSessionOptionsMap) {
    function fromRecord(obj) {
        return ( new Map(Object.entries(obj)));
    }
    ChatSessionOptionsMap.fromRecord = fromRecord;
    function toRecord(map) {
        const record = Object.create(null);
        const entries = ensureIterable(map);
        for (const [key, value] of entries) {
            record[key] = value;
        }
        return record;
    }
    ChatSessionOptionsMap.toRecord = toRecord;
    function toStrValueArray(map) {
        if (!map) {
            return undefined;
        }
        const entries = ensureIterable(map);
        return Array.from(entries, ([optionId, value]) => ({
            optionId,
            value: typeof value === "string" ? value : value.id
        }));
    }
    ChatSessionOptionsMap.toStrValueArray = toStrValueArray;
    function ensureIterable(map) {
        if (map instanceof Map) {
            return map;
        }
        return Object.entries(map);
    }
})(ChatSessionOptionsMap || (ChatSessionOptionsMap = {}));
function isSessionInProgressStatus(state) {
    return state === ChatSessionStatus.InProgress || state === ChatSessionStatus.NeedsInput;
}
function isIChatSessionFileChange2(obj) {
    const candidate = obj;
    return candidate && candidate.uri instanceof URI && typeof candidate.insertions === "number" && typeof candidate.deletions === "number";
}

export { ChatSessionOptionsMap, ChatSessionStatus, ChatSessionsExtensions, SessionType, isAgentHostTarget, isIChatSessionFileChange2, isLocalAgentHostTarget, isRemoteAgentHostTarget, isSessionInProgressStatus, localChatSessionType };
