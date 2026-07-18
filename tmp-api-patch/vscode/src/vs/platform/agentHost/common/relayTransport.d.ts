import { Event } from "../../../base/common/event.js";
import { Disposable } from "../../../base/common/lifecycle.js";
import { ILogService } from "../../log/common/log.service.js";
import { AhpJsonlLogger } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/ahpJsonlLogger";
import type { AhpServerNotification, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, ProtocolMessage } from "./state/sessionProtocol.js";
import type { IProtocolTransport } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/state/sessionTransport";
/**
 * A message relayed from a remote agent host through a tunnel managed
 * by the shared process. The shared process acts as a WebSocket proxy,
 * forwarding JSON messages bidirectionally via IPC.
 */
export interface IRelayMessage {
    readonly connectionId: string;
    readonly data: string;
}
/**
 * Minimal IPC surface needed by {@link RelayTransport} to pump frames
 * between the renderer and a shared-process-owned tunnel. Structural —
 * any main-service interface exposing these members satisfies it.
 */
export interface IRelayChannel {
    readonly onDidRelayMessage: Event<IRelayMessage>;
    readonly onDidRelayClose: Event<string>;
    relaySend(connectionId: string, message: string): Promise<void>;
}
/**
 * A protocol transport that relays messages through a shared-process
 * tunnel via IPC, instead of using a direct WebSocket connection.
 *
 * The shared process manages the actual underlying transport (WebSocket
 * over SSH, WSL stdio, etc.) and forwards messages bidirectionally
 * through this IPC channel.
 */
export declare class RelayTransport extends Disposable implements IProtocolTransport {
    private readonly _connectionId;
    private readonly _channel;
    private readonly _ahpLogger;
    private readonly _logService;
    private readonly _logPrefix;
    private readonly _onMessage;
    readonly onMessage: Event<ProtocolMessage>;
    private readonly _onClose;
    readonly onClose: Event<void>;
    constructor(_connectionId: string, _channel: IRelayChannel, _ahpLogger: AhpJsonlLogger | undefined, _logService: ILogService, _logPrefix: string);
    send(message: ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcResponse | JsonRpcRequest): void;
}
