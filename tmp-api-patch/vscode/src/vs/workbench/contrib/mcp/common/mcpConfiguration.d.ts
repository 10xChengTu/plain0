import { IJSONSchema } from "../../../../base/common/jsonSchema.js";
import { IMcpCollectionContribution } from "../../../../platform/extensions/common/extensions.js";
import { IExtensionPointDescriptor } from "../../../services/extensions/common/extensionsRegistry.js";
/**
 * note: `contributedCollectionId` is _not_ the collection ID. The collection
 * ID is formed by passing the contributed ID through `extensionPrefixedIdentifier`
 */
export declare const mcpActivationEvent: (contributedCollectionId: string) => string;
export declare enum DiscoverySource {
    ClaudeDesktop = "claude-desktop",
    Windsurf = "windsurf",
    CursorGlobal = "cursor-global",
    CursorWorkspace = "cursor-workspace"
}
export declare const allDiscoverySources: DiscoverySource[];
export declare const discoverySourceLabel: Record<DiscoverySource, string>;
export declare const discoverySourceSettingsLabel: Record<DiscoverySource, string>;
export declare const mcpConfigurationSection = "mcp";
export declare const mcpDiscoverySection = "chat.mcp.discovery.enabled";
export declare const mcpServerSamplingSection = "chat.mcp.serverSampling";
export declare const mcpServerCollisionBehaviorSection = "chat.mcp.collisionBehavior";
/**
 * Configuration key for the enterprise-managed MCP IdP bag. The setting is
 * registered with `included: false` so it is hidden from the Settings UI and
 * settings.json IntelliSense; it is intended to be delivered through enterprise
 * policy (Windows Group Policy / macOS managed preferences / Linux
 * `/etc/vscode/policy.json`), with hand-editing of `settings.json` as a
 * developer escape hatch.
 */
export declare const mcpEnterpriseManagedAuthIdpSection = "mcp.enterpriseManagedAuth.idp";
/**
 * Shape of the {@link mcpEnterpriseManagedAuthIdpSection} setting. All fields
 * are optional so partial configurations (e.g. just the issuer) remain valid.
 */
export interface IMcpEnterpriseManagedAuthIdpConfig {
    readonly issuer?: string;
    readonly clientId?: string;
    readonly clientSecret?: string;
}
export declare enum McpCollisionBehavior {
    Disable = "disable",
    Suffix = "suffix"
}
export interface IMcpServerSamplingConfiguration {
    allowedDuringChat?: boolean;
    allowedOutsideChat?: boolean;
    allowedModels?: string[];
}
export declare const mcpSchemaExampleServers: {
    "mcp-server-time": {
        command: string;
        args: string[];
        env: {};
    };
};
export declare const mcpStdioServerSchema: IJSONSchema;
export declare const mcpServerSchema: IJSONSchema;
export declare const mcpContributionPoint: IExtensionPointDescriptor<IMcpCollectionContribution[]>;
