import { McpServerState, type McpServerStatus } from "./state/protocol/channels-session/state.js";
/**
 * A rich view of a single MCP server exposed by an agent host session.
 * Encapsulates the dispatch plumbing so consumers can present and toggle
 * servers without depending on the low-level protocol action surface.
 */
export interface IAgentHostMcpServer {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly status: McpServerStatus;
    readonly state: McpServerState;
    readonly logOutputChannelId?: string;
    setEnabled(enabled: boolean): void;
}
