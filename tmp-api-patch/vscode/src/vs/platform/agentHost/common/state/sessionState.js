
import { encodeBase64, VSBuffer, decodeBase64 } from '../../../../base/common/buffer.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
export { PolicyState } from './protocol/channels-root/state.js';
export { CustomizationLoadStatus, CustomizationType, SessionLifecycle, SessionStatus } from './protocol/channels-session/state.js';
import { ToolResultContentType } from './protocol/channels-chat/state.js';
export { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, ChatOriginKind, MessageAttachmentKind, MessageKind, PendingMessageKind, ResponsePartKind, ChatInputAnswerState as SessionInputAnswerState, ChatInputAnswerValueKind as SessionInputAnswerValueKind, ChatInputQuestionKind as SessionInputQuestionKind, ChatInputResponseKind as SessionInputResponseKind, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallContributorKind, ToolCallStatus, TurnState } from './protocol/channels-chat/state.js';
import './protocol/channels-terminal/state.js';
export { ChangesetOperationScope, ChangesetOperationStatus, ChangesetStatus } from './protocol/channels-changeset/state.js';
import './protocol/channels-resource-watch/state.js';
import './protocol/common/commands.js';
import './protocol/channels-session/commands.js';
export { ChangesetOperationTargetKind } from './protocol/channels-changeset/commands.js';

var FileEditKind;
(function(FileEditKind) {
    FileEditKind["Edit"] = "edit";
    FileEditKind["Create"] = "create";
    FileEditKind["Delete"] = "delete";
    FileEditKind["Rename"] = "rename";
})(FileEditKind || (FileEditKind = {}));
const ROOT_STATE_URI = "ahp-root://";
const AHP_ROOT_SCHEME = "ahp-root";
function isAhpRootChannel(uri) {
    if (uri === ROOT_STATE_URI) {
        return true;
    }
    try {
        return URI.parse(uri).scheme === AHP_ROOT_SCHEME;
    } catch {
        return false;
    }
}
function customizationId(uri, range) {
    {
        return uri;
    }
}
function getToolFileEdits(result) {
    if (!result.content || result.content.length === 0) {
        return [];
    }
    const edits = [];
    for (const c of result.content) {
        if (hasKey(c, {
            type: true
        }) && c.type === ToolResultContentType.FileEdit) {
            edits.push(c);
        }
    }
    return edits;
}
var StateComponents;
(function(StateComponents) {
    StateComponents[StateComponents["Root"] = 0] = "Root";
    StateComponents[StateComponents["Session"] = 1] = "Session";
    StateComponents[StateComponents["Chat"] = 2] = "Chat";
    StateComponents[StateComponents["Terminal"] = 3] = "Terminal";
    StateComponents[StateComponents["Changeset"] = 4] = "Changeset";
    StateComponents[StateComponents["Annotations"] = 5] = "Annotations";
})(StateComponents || (StateComponents = {}));
const AHP_CHAT_SCHEME = "ahp-chat";
const DEFAULT_CHAT_ID = "default";
function buildChatUri(sessionUri, chatId) {
    const session = typeof sessionUri === "string" ? sessionUri : ( sessionUri.toString());
    const encoded = encodeBase64(VSBuffer.fromString(session), false, true);
    return `${AHP_CHAT_SCHEME}://${chatId}/${encoded}`;
}
function buildDefaultChatUri(sessionUri) {
    return buildChatUri(sessionUri, DEFAULT_CHAT_ID);
}
const SUBAGENT_CHAT_ID = "subagent";
function buildSubagentChatUri(sessionUri, toolCallId) {
    const session = typeof sessionUri === "string" ? sessionUri : ( sessionUri.toString());
    const encoded = encodeBase64(VSBuffer.fromString(session), false, true);
    return `${AHP_CHAT_SCHEME}://${SUBAGENT_CHAT_ID}/${encoded}/${encodeURIComponent(toolCallId)}`;
}
function parseChatUri(uri) {
    let parsed;
    try {
        parsed = typeof uri === "string" ? URI.parse(uri) : uri;
    } catch {
        return undefined;
    }
    if (parsed.scheme !== AHP_CHAT_SCHEME || !parsed.authority) {
        return undefined;
    }
    const encoded = parsed.path.replace(/^\//, "");
    if (!encoded) {
        return undefined;
    }
    try {
        if (parsed.authority === SUBAGENT_CHAT_ID) {
            const [sessionPart, ...toolCallIdParts] = encoded.split("/");
            const toolCallId = toolCallIdParts.join("/");
            if (!sessionPart || !toolCallId) {
                return undefined;
            }
            return {
                session: ( decodeBase64(sessionPart).toString()),
                chatId: `${SUBAGENT_CHAT_ID}/${decodeURIComponent(toolCallId)}`
            };
        }
        return {
            session: ( decodeBase64(encoded).toString()),
            chatId: parsed.authority
        };
    } catch {
        return undefined;
    }
}
function parseDefaultChatUri(uri) {
    return parseChatUri(uri)?.session;
}
function parseRequiredSessionUriFromChatUri(uri) {
    const session = parseDefaultChatUri(uri);
    if (session === undefined) {
        throw ( new Error(`Malformed AHP chat URI: ${typeof uri === "string" ? uri : ( uri.toString())}`));
    }
    return session;
}

export { AHP_CHAT_SCHEME, AHP_ROOT_SCHEME, DEFAULT_CHAT_ID, FileEditKind, ROOT_STATE_URI, StateComponents, ToolResultContentType, buildChatUri, buildDefaultChatUri, buildSubagentChatUri, customizationId, getToolFileEdits, isAhpRootChannel, parseChatUri, parseDefaultChatUri, parseRequiredSessionUriFromChatUri };
