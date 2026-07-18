
export { ContentEncoding, ReconnectResultType, ResourceType, ResourceWriteMode } from './protocol/common/commands.js';
import './protocol/channels-session/commands.js';
import './protocol/channels-changeset/commands.js';
export { ResourceChangeType } from './protocol/channels-resource-watch/state.js';

const AHP_UNSUPPORTED_PROTOCOL_VERSION = -32005;
function isJsonRpcRequest(msg) {
    return 'method' in msg && 'id' in msg;
}
function isJsonRpcNotification(msg) {
    return 'method' in msg && !('id' in msg);
}
function isJsonRpcResponse(msg) {
    return 'id' in msg && !('method' in msg);
}
class ProtocolError extends Error {
    constructor(code, message, data) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

export { AHP_UNSUPPORTED_PROTOCOL_VERSION, ProtocolError, isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse };
