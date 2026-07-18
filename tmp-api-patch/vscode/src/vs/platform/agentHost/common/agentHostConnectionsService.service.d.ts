import { Event } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import { IAgentHostConnectionInfo, IAgentHostSessionResolution } from "./agentHostConnectionsService.js";
import { IAgentConnection } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
export declare const IAgentHostConnectionsService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostConnectionsService>;
/**
* A thin, read-only facade over the window's ambient agent host
* (`IAgentHostService`) and the registry of remote agent hosts
* (`IRemoteAgentHostService`), so consumers can enumerate and resolve
* {@link IAgentConnection}s without branching on local-vs-remote or
* fanning out over "1 ambient + N remote" themselves.
*
* This service deliberately does NOT expose lifecycle/management operations:
* ambient-process concerns (restart, inspect, auth-pending) stay on
* `IAgentHostService`, and remote-registry mutations (add/remove/reconnect/
* upgrade) stay on `IRemoteAgentHostService`. This facade only answers
* "which connections exist?" and "give me the connection for X".
*/
export interface IAgentHostConnectionsService {
    readonly _serviceBrand: undefined;
    /** Fires when the set of connections changes (ambient lifecycle or remotes added/removed). */
    readonly onDidChangeConnections: Event<void>;
    /**
    * All known connections as `[ambient, ...remotes]`. The ambient entry is
    * always present with a live `connection`; only remote entries may have
    * `connection: undefined` (e.g. while connecting/disconnected). Remote
    * entries reflect the current `IRemoteAgentHostService` registry.
    */
    readonly connections: readonly IAgentHostConnectionInfo[];
    /** The window's ambient/primary connection (local, or the window-remote bridge). */
    readonly ambientConnection: IAgentConnection;
    /**
    * Resolves a live connection by sanitized authority, including
    * {@link AMBIENT_AGENT_HOST_AUTHORITY} for the ambient host. Returns
    * `undefined` when no connected host matches.
    */
    getConnectionByAuthority(authority: string): IAgentConnection | undefined;
    /**
    * Resolves a live remote connection by raw address. The ambient host has no
    * address and is never returned here — use {@link ambientConnection} or
    * {@link getConnectionByAuthority} with {@link AMBIENT_AGENT_HOST_AUTHORITY}.
    */
    getConnectionByAddress(address: string): IAgentConnection | undefined;
    /**
    * Resolves an agent-host chat-session resource to its owning connection and
    * backend session URI. Handles both local schemes
    * (`agent-host-<provider>`) — backed by the ambient connection — and remote
    * schemes (`remote-<authority>-<provider>`) — resolved against the live
    * remote registry. Returns `undefined` when the resource is not an
    * agent-host session, or when the matching remote host is not connected.
    *
    * NOTE: provisional/untitled sessions are a workbench concern and are NOT
    * handled here — callers that support them should resolve those first.
    */
    resolveSessionResource(sessionResource: URI): IAgentHostSessionResolution | undefined;
}
