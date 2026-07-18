import { Disposable } from "../../../../../base/common/lifecycle.js";
import { IAgentPluginService } from "../../../chat/common/plugins/agentPluginService.service.js";
import { IMcpRegistry } from "../mcpRegistryTypes.service.js";
import { IMcpDiscovery } from "@codingame/monaco-vscode-mcp-service-override/vscode/vs/workbench/contrib/mcp/common/discovery/mcpDiscovery";
/**
 * Prefix used for the {@link McpCollectionDefinition.id | collection id} of
 * MCP collections contributed by agent plugins. The remainder of the id is
 * the plugin's URI. Consumers can use this to tell plugin-sourced MCP servers
 * apart from servers configured directly in VS Code.
 */
export declare const MCP_PLUGIN_COLLECTION_ID_PREFIX = "plugin.";
export declare class PluginMcpDiscovery extends Disposable implements IMcpDiscovery {
    private readonly _agentPluginService;
    private readonly _mcpRegistry;
    readonly fromGallery = false;
    private readonly _collections;
    constructor(_agentPluginService: IAgentPluginService, _mcpRegistry: IMcpRegistry);
    start(): void;
    private createCollectionState;
    private _toServerDefinition;
    private _toLaunch;
}
