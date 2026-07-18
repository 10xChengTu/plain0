import type { URI } from "../../../base/common/uri.js";
import type { IAgentConnection } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
/**
 * Chat-session resource scheme prefix for the window's ambient/local agent
 * host: `agent-host-<provider>`.
 *
 * Remote agent host session schemes (`remote-<authority>-<provider>`) are
 * handled by `agentHostSessionType.ts` (`isRemoteAgentHostSessionType` and
 * friends), which also owns the authority disambiguation.
 */
export declare const LOCAL_AGENT_HOST_SCHEME_PREFIX = "agent-host-";
/**
 * Reserved connection authority for the window's ambient/primary agent host.
 *
 * NOTE: "ambient" is not the same as "local". In a local window the ambient
 * host is the in-process utility agent host; in a window attached to a remote
 * authority the ambient host is itself remote (the `EditorRemoteAgentHostServiceClient`).
 * The `'local'` string is reserved/canonical for this ambient connection — it
 * is already used as the agent-host URI authority for in-window resources
 * (see `toAgentHostUri` in `agentHostUri.ts`).
 */
export declare const AMBIENT_AGENT_HOST_AUTHORITY = "local";
/**
 * A descriptor for a single agent-host connection exposed by
 * {@link IAgentHostConnectionsService}. Covers both the window's ambient host
 * and every connected remote host with one uniform shape.
 */
export interface IAgentHostConnectionInfo {
    /**
     * Sanitized connection authority. The ambient host uses
     * {@link AMBIENT_AGENT_HOST_AUTHORITY}; remotes use the authority derived
     * from their address via `agentHostAuthority`.
     */
    readonly authority: string;
    /** Raw remote address. `undefined` for the ambient host. */
    readonly address: string | undefined;
    /** Human-readable label for the connection. */
    readonly name: string;
    /**
     * `true` for the window's ambient/primary host. Remember this host may
     * itself be remote in a remote window — see {@link AMBIENT_AGENT_HOST_AUTHORITY}.
     */
    readonly isAmbient: boolean;
    /** The live connection, or `undefined` when not currently connected. */
    readonly connection: IAgentConnection | undefined;
}
/**
 * The result of resolving a chat-session resource to its backing agent host:
 * the owning {@link IAgentConnection} and the canonical backend agent-session
 * URI (`<provider>:/<rawId>`) used for protocol operations on that connection.
 */
export interface IAgentHostSessionResolution {
    readonly connection: IAgentConnection;
    readonly backendSession: URI;
}
