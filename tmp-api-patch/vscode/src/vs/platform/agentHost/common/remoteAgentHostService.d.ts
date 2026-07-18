import { Event } from "../../../base/common/event.js";
import type { IAgentConnection } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
import { type IVscodeUpgradeResult } from "./state/protocolUpgrade.js";
import { IRemoteAgentHostService } from "./remoteAgentHostService.service.js";
/**
 * Connection status for a remote agent host.
 *
 * Discriminated by `kind`. The `incompatible` variant carries the rejection
 * message returned by the host (typically when its protocol version is not
 * compatible with anything the client offered) so the UI can surface it.
 */
export type RemoteAgentHostConnectionStatus = {
    readonly kind: "connected";
} | {
    readonly kind: "connecting";
} | {
    readonly kind: "disconnected";
} | {
    readonly kind: "incompatible";
    /** Human-readable reason from the host (or a synthesised one when the host did not send one). */
    readonly message: string;
    /** Protocol versions the client offered. */
    readonly supportedByClient: readonly string[];
    /** Protocol versions the server reported it can speak, if available. */
    readonly offeredByServer?: readonly string[];
    /**
     * JSON-RPC method the server has advertised via `_meta` that the
     * client may invoke to ask the hosting CLI to upgrade the server.
     * Set only when the server was spawned by a VS Code CLI willing
     * to receive upgrade signals.
     */
    readonly vscodeUpgradeMethod?: string;
};
export declare namespace RemoteAgentHostConnectionStatus {
    /** Singleton "connected" status. */
    const connected: RemoteAgentHostConnectionStatus;
    /** Singleton "connecting" status. */
    const connecting: RemoteAgentHostConnectionStatus;
    /** Singleton "disconnected" status. */
    const disconnected: RemoteAgentHostConnectionStatus;
    /** Build an "incompatible" status from a host-supplied message and the versions involved. */
    function incompatible(message: string, supportedByClient: readonly string[], offeredByServer?: readonly string[], vscodeUpgradeMethod?: string): RemoteAgentHostConnectionStatus;
    /** Whether the connection is fully established and ready for traffic. */
    function isConnected(status: RemoteAgentHostConnectionStatus | undefined): boolean;
    /** Whether the connection is mid-handshake. */
    function isConnecting(status: RemoteAgentHostConnectionStatus | undefined): boolean;
    /** Whether the connection is in the plain disconnected state. */
    function isDisconnected(status: RemoteAgentHostConnectionStatus | undefined): boolean;
    /** Whether the connection rejected our protocol version. */
    function isIncompatible(status: RemoteAgentHostConnectionStatus | undefined): status is RemoteAgentHostConnectionStatus & {
        kind: "incompatible";
    };
    /** Whether the connection is anything except `connected`. */
    function isUnavailable(status: RemoteAgentHostConnectionStatus | undefined): boolean;
    /**
     * If `err` is a protocol-version mismatch reported by an agent host
     * during the `initialize` handshake, returns an `incompatible` status
     * carrying the host's message. Returns `undefined` otherwise so callers
     * can fall back to their existing failure handling.
     */
    function fromConnectError(err: unknown, supportedByClient: readonly string[]): RemoteAgentHostConnectionStatus | undefined;
}
/** Configuration key for the list of WebSocket remote agent host addresses. */
export declare const RemoteAgentHostsSettingId = "chat.remoteAgentHosts";
/** Configuration key to enable remote agent host connections. */
export declare const RemoteAgentHostsEnabledSettingId = "chat.remoteAgentHostsEnabled";
/**
 * Configuration key that controls whether online dev tunnels and
 * configured SSH remote agent hosts are auto-connected at startup.
 */
export declare const RemoteAgentHostAutoConnectSettingId = "chat.remoteAgentHostsAutoConnect";
export declare enum RemoteAgentHostEntryType {
    WebSocket = "websocket",
    SSH = "ssh",
    WSL = "wsl",
    Tunnel = "tunnel"
}
export interface IRemoteAgentHostWebSocketConnection {
    readonly type: RemoteAgentHostEntryType.WebSocket;
    readonly address: string;
}
export interface IRemoteAgentHostSSHConnection {
    readonly type: RemoteAgentHostEntryType.SSH;
    /**
     * The WebSocket address used by the agent host protocol client to
     * communicate with the remote agent host process. This is typically a
     * forwarded local port (e.g. `localhost:4321`) established by the SSH
     * tunnel — it is NOT the SSH hostname itself.
     */
    readonly address: string;
    /**
     * SSH config host alias (e.g. `myserver`). When set, the SSH tunnel is
     * automatically re-established on startup using the user's SSH config.
     * This takes precedence over {@link hostName} when constructing the
     * VS Code Remote SSH authority.
     */
    readonly sshConfigHost?: string;
    /**
     * The actual SSH hostname or IP address of the remote machine
     * (e.g. `myserver.example.com`). This is the host that the SSH
     * client connects to, and is used to construct the VS Code Remote
     * SSH authority when {@link sshConfigHost} is not available.
     */
    readonly hostName: string;
    /** SSH username for the remote machine. */
    readonly user?: string;
    /** SSH port on the remote machine (default 22). */
    readonly port?: number;
}
export interface IRemoteAgentHostTunnelConnection {
    readonly type: RemoteAgentHostEntryType.Tunnel;
    /** Dev tunnel ID. */
    readonly tunnelId: string;
    /** Dev tunnel cluster region. */
    readonly clusterId: string;
    /**
     * User-defined display name for this tunnel (derived from tunnel tags).
     * Used as the tunnel name in the VS Code Remote Tunnels authority
     * (e.g. `tunnel+<label>`). Falls back to {@link tunnelId} if not set.
     */
    readonly label?: string;
    /** Auth provider used to connect to this tunnel. */
    readonly authProvider?: "github" | "microsoft";
}
export interface IRemoteAgentHostWSLConnection {
    readonly type: RemoteAgentHostEntryType.WSL;
    /** Display address: `wsl:<distro>`. */
    readonly address: string;
    /** WSL distro name (e.g. `Ubuntu-22.04`). */
    readonly distro: string;
}
export type RemoteAgentHostConnection = IRemoteAgentHostWebSocketConnection | IRemoteAgentHostSSHConnection | IRemoteAgentHostWSLConnection | IRemoteAgentHostTunnelConnection;
/** A configured remote agent host entry. WebSocket entries are persisted in {@link RemoteAgentHostsSettingId}; SSH entries are persisted in storage. */
export interface IRemoteAgentHostEntry {
    readonly name: string;
    readonly connectionToken?: string;
    readonly connection: RemoteAgentHostConnection;
}
export declare function getEntryAddress(entry: IRemoteAgentHostEntry): string;
export declare function remoteAgentHostLogOutputChannelId(address: string): string;
/**
 * Output channel id for the local agent host process logger (forwarded
 * from the utility process via `RemoteLoggerChannelClient`). Matches the
 * logger id registered in `agentHostMain.ts`.
 */
export declare const AGENT_HOST_LOG_OUTPUT_CHANNEL_ID = "agenthost";
export declare enum RemoteAgentHostInputValidationError {
    Empty = "empty",
    Invalid = "invalid"
}
export interface IParsedRemoteAgentHostInput {
    readonly address: string;
    readonly connectionToken?: string;
    readonly suggestedName: string;
}
export type RemoteAgentHostInputParseResult = {
    readonly parsed: IParsedRemoteAgentHostInput;
    readonly error?: undefined;
} | {
    readonly parsed?: undefined;
    readonly error: RemoteAgentHostInputValidationError;
};
/** Metadata about a single remote connection. */
export interface IRemoteAgentHostConnectionInfo {
    readonly address: string;
    readonly name: string;
    readonly clientId: string;
    readonly defaultDirectory?: string;
    readonly status: RemoteAgentHostConnectionStatus;
}
export declare class NullRemoteAgentHostService implements IRemoteAgentHostService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeConnections: Event<any>;
    readonly connections: readonly IRemoteAgentHostConnectionInfo[];
    readonly configuredEntries: readonly IRemoteAgentHostEntry[];
    getConnection(): IAgentConnection | undefined;
    getConnectionByAuthority(): IAgentConnection | undefined;
    addRemoteAgentHost(): Promise<IRemoteAgentHostConnectionInfo>;
    removeRemoteAgentHost(_address: string): Promise<void>;
    reconnect(_address: string): void;
    notifyConnectionClosed(_address: string): void;
    addManagedConnection(): Promise<IRemoteAgentHostConnectionInfo>;
    getEntryByAddress(): IRemoteAgentHostEntry | undefined;
    triggerServerUpgrade(): Promise<IVscodeUpgradeResult>;
}
export declare function parseRemoteAgentHostInput(input: string): RemoteAgentHostInputParseResult;
/** Raw shape of persisted remote agent host entries. */
export interface IRawRemoteAgentHostEntry {
    readonly address: string;
    readonly name: string;
    readonly connectionToken?: string;
    readonly sshConfigHost?: string;
    readonly sshHostName?: string;
    readonly sshUser?: string;
    readonly sshPort?: number;
}
export declare function rawEntryToEntry(raw: IRawRemoteAgentHostEntry): IRemoteAgentHostEntry | undefined;
export declare function entryToRawEntry(entry: IRemoteAgentHostEntry): IRawRemoteAgentHostEntry | undefined;
