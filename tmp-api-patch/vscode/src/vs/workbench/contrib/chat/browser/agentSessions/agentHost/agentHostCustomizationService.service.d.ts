import { Event } from "../../../../../../base/common/event.js";
import { URI } from "../../../../../../base/common/uri.js";
import { IAgentHostMcpServer } from "../../../../../../platform/agentHost/common/agentHostMcpServer.js";
import { AgentCustomization, Customization } from "../../../../../../platform/agentHost/common/state/sessionState.js";
import { IMcpServerConfiguration } from "../../../../../../platform/mcp/common/mcpPlatformTypes.js";
export declare const IAgentHostCustomizationService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostCustomizationService>;
export interface IAgentHostCustomizationService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeCustomAgents: Event<void>;
    readonly onDidChangeCustomizations: Event<void>;
    getCustomAgents(sessionResource: URI): readonly AgentCustomization[];
    getCustomizations(sessionResource: URI): readonly Customization[];
    getWorkingDirectory(sessionResource: URI): string | undefined;
    /**
    * Returns the MCP servers exposed by an agent-host session. Each entry
    * carries the current status, a {@link IAgentHostMcpServer.setEnabled}
    * method that dispatches the protocol-level toggle on behalf of the
    * caller, and the {@link IAgentHostMcpServer.logOutputChannelId} of the
    * host backing the session. Returns an empty array for sessions not
    * backed by an agent host, or that don't expose any MCP servers.
    */
    getMcpServers(sessionResource: URI): readonly IAgentHostMcpServer[];
    /**
    * Adds (or replaces) an agent-host-level MCP server in the root config of
    * the agent host backing `sessionResource`. The write is routed to the
    * correct connection (local or remote) for that session. No-op for
    * sessions not backed by an agent host.
    */
    addMcpServer(sessionResource: URI, name: string, config: IMcpServerConfiguration): void;
    /**
    * Runs interactive authentication for an auth-required MCP server in an
    * agent-host session. Returns false when the session/server cannot be
    * resolved or authentication did not complete.
    */
    authenticateMcpServer(sessionResource: URI, serverId: string): Promise<boolean>;
}
