export type { JsonRpcErrorResponse, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, JsonRpcSuccessResponse, } from "./protocol/messages.js";
export type { AhpClientNotification, AhpNotification, AhpRequest, AhpResponse, AhpServerNotification, AhpSuccessResponse, CommandMap, ClientNotificationMap, ProtocolMessage, ServerNotificationMap, } from "./protocol/messages.js";
export type { CreateSessionParams, DirectoryEntry, DispatchActionParams, DisposeSessionParams, FetchTurnsParams, FetchTurnsResult, InitializeParams, InitializeResult, ListSessionsParams, ListSessionsResult, ReconnectParams, ReconnectReplayResult, ReconnectResult, ReconnectSnapshotResult, ResourceCopyParams, ResourceCopyResult, ResourceDeleteParams, ResourceDeleteResult, ResourceListParams, ResourceListResult, ResourceMkdirParams, ResourceMkdirResult, ResourceMoveParams, ResourceMoveResult, ResourceReadParams, ResourceReadResult, ResourceResolveParams, ResourceResolveResult, ResourceWriteParams, ResourceWriteResult, SubscribeParams, SubscribeResult, UnsubscribeParams, } from "./protocol/commands.js";
export type { CreateResourceWatchParams, CreateResourceWatchResult, } from "./protocol/channels-resource-watch/commands.js";
export { ContentEncoding, ReconnectResultType, ResourceType, ResourceWriteMode } from "./protocol/commands.js";
export { ResourceChangeType } from "./protocol/channels-resource-watch/state.js";
export type { ResourceChange, ResourceWatchState } from "./protocol/channels-resource-watch/state.js";
export { AhpErrorCodes, JsonRpcErrorCodes } from "./protocol/errors.js";
export type { AhpErrorCode, JsonRpcErrorCode } from "./protocol/errors.js";
import type { Snapshot as ProtocolSnapshot } from "./protocol/state.js";
export type IStateSnapshot = ProtocolSnapshot;
export declare const JSON_RPC_PARSE_ERROR: -32700;
export declare const JSON_RPC_INTERNAL_ERROR: -32603;
export declare const AHP_SESSION_NOT_FOUND: -32001;
export declare const AHP_PROVIDER_NOT_FOUND: -32002;
export declare const AHP_SESSION_ALREADY_EXISTS: -32003;
export declare const AHP_TURN_IN_PROGRESS: -32004;
export declare const AHP_UNSUPPORTED_PROTOCOL_VERSION: -32005;
export declare const AHP_CONTENT_NOT_FOUND: -32006;
export declare const AHP_AUTH_REQUIRED: -32007;
import type { AhpRequest, AhpNotification, AhpSuccessResponse, ProtocolMessage, JsonRpcErrorResponse } from "./protocol/messages.js";
export declare function isJsonRpcRequest(msg: ProtocolMessage): msg is AhpRequest;
export declare function isJsonRpcNotification(msg: ProtocolMessage): msg is AhpNotification;
export declare function isJsonRpcResponse(msg: ProtocolMessage): msg is AhpSuccessResponse | JsonRpcErrorResponse;
/**
 * Error with a JSON-RPC error code for protocol-level failures.
 * Optionally carries a `data` payload for structured error details.
 */
export declare class ProtocolError extends Error {
    readonly code: number;
    readonly data?: unknown | undefined;
    constructor(code: number, message: string, data?: unknown | undefined);
}
/**
 * VS Code-specific extension: set the auth token on the server.
 * Not yet part of the official protocol.
 */
export interface ISetAuthTokenParams {
    readonly token: string;
}
import type { INotification } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/state/sessionActions";
export interface INotificationBroadcastParams {
    readonly notification: INotification;
}
