import { Event } from "../../../base/common/event.js";
import { IDisposable } from "../../../base/common/lifecycle.js";
import { IAgentConnection } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
import { IRemoteAgentHostConnectionInfo, IRemoteAgentHostEntry, RemoteAgentHostConnectionStatus } from "./remoteAgentHostService.js";
import { IVscodeUpgradeResult } from "./state/protocolUpgrade.js";
export declare const IRemoteAgentHostService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IRemoteAgentHostService>;
/**
* Manages connections to one or more remote agent host processes over
* WebSocket. Each connection is identified by its address string and
* exposed as an {@link IAgentConnection}, the same interface used for
* the local agent host.
*/
export interface IRemoteAgentHostService {
    readonly _serviceBrand: undefined;
    /** Fires when a remote connection is established or lost. */
    readonly onDidChangeConnections: Event<void>;
    /** Currently connected remote addresses with metadata. */
    readonly connections: readonly IRemoteAgentHostConnectionInfo[];
    /** All configured remote agent host entries, regardless of connection status. */
    readonly configuredEntries: readonly IRemoteAgentHostEntry[];
    /**
    * Get a per-connection {@link IAgentConnection} for subscribing to
    * state, dispatching actions, creating sessions, etc.
    *
    * Returns `undefined` if no active connection exists for the address.
    */
    getConnection(address: string): IAgentConnection | undefined;
    /**
    * Get a per-connection {@link IAgentConnection} by its sanitized
    * connection authority (as produced by `agentHostAuthority`), rather than
    * its raw address. Useful for callers that only have the authority
    * component of a remote session URI scheme (`remote-<authority>-<provider>`).
    *
    * Returns `undefined` if no active connection matches the authority.
    */
    getConnectionByAuthority(authority: string): IAgentConnection | undefined;
    /**
    * Adds or updates a configured remote host and resolves once a connection
    * to that host is available.
    */
    addRemoteAgentHost(entry: IRemoteAgentHostEntry): Promise<IRemoteAgentHostConnectionInfo>;
    /**
    * Removes a configured remote host entry by address.
    * Disconnects any active connection and removes the entry from settings.
    */
    removeRemoteAgentHost(address: string): Promise<void>;
    /**
    * Forcefully reconnect to a configured remote host.
    * Tears down any existing connection and starts a fresh connect attempt
    * with reset backoff.
    */
    reconnect(address: string): void;
    /**
    * Register a pre-connected agent connection.
    * Used by the SSH and tunnel services to inject relay-backed connections
    * without going through the WebSocket connect flow.
    *
    * The optional `transportDisposable` represents the underlying transport
    * (e.g. an SSH tunnel relay or tunnel-relay session) and is owned by this
    * service for the lifetime of the entry. It will be disposed when:
    *   - the entry is removed via {@link removeRemoteAgentHost}
    *   - the entry is reconciled away (config-driven removal)
    *   - this service itself is disposed
    * Callers should put any teardown that needs to happen on entry removal
    * (e.g. closing the shared-process tunnel, dropping renderer-side handles)
    * into this disposable, so a single removal path tears down the whole stack.
    *
    * `status` defaults to `connected`. Pass `incompatible` when the managed
    * transport is alive but the protocol handshake rejected the client version;
    * this keeps recovery actions (such as server upgrade) addressable without
    * exposing the connection as ready for session traffic.
    */
    addManagedConnection(entry: IRemoteAgentHostEntry, connection: IAgentConnection, transportDisposable?: IDisposable, status?: RemoteAgentHostConnectionStatus): Promise<IRemoteAgentHostConnectionInfo>;
    /**
    * Force the protocol client at `address` (if any) to treat its
    * transport as closed. Used by services that learn about a
    * connection loss out-of-band — e.g. the SSH service receiving an
    * `onDidCloseConnection` IPC event from the shared process — to
    * make sure the renderer-side client doesn't sit in `Connected`
    * waiting on its watchdog. The watchdog is a `setTimeout` and
    * Chromium aggressively throttles those in backgrounded windows,
    * so we can't rely on it as the sole death-detection path.
    *
    * No-op if no active entry exists for the address, or if the
    * existing client has already transitioned out of `Connected`.
    */
    notifyConnectionClosed(address: string): void;
    /**
    * Look up the {@link IRemoteAgentHostEntry} for a given address.
    * Checks both configured entries from settings and dynamically
    * registered entries (e.g. tunnel connections).
    */
    getEntryByAddress(address: string): IRemoteAgentHostEntry | undefined;
    /**
    * Ask the remote agent host to upgrade itself via its hosting CLI.
    *
    * Sends the host-advertised JSON-RPC method (typically
    * `_vscodeUpgrade`) on the existing transport — even when the handshake
    * has not completed (e.g. the host was just rejected for protocol
    * incompatibility). The hosting CLI receives the signal, checks for a
    * newer build, and kills+respawns the server on success. The caller
    * SHOULD then reconnect to re-attempt the handshake.
    *
    * Resolves with the host's status payload describing what happened
    * (whether an upgrade was needed, whether it was started); rejects on
    * transport failure, timeout, or a JSON-RPC error response.
    */
    triggerServerUpgrade(address: string, method: string): Promise<IVscodeUpgradeResult>;
}
