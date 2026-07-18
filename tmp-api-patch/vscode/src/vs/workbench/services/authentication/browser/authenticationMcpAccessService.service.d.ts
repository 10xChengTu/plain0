import { Event } from "../../../../base/common/event.js";
import { AllowedMcpServer } from "@codingame/monaco-vscode-mcp-service-override/vscode/vs/workbench/services/authentication/browser/authenticationMcpAccessService";
export declare const IAuthenticationMcpAccessService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAuthenticationMcpAccessService>;
export interface IAuthenticationMcpAccessService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeMcpSessionAccess: Event<{
        providerId: string;
        accountName: string;
    }>;
    /**
    * Inspect the stored access decision for an MCP server, keyed by id alone. Used by management and
    * inspection surfaces (e.g. the "Manage Trusted MCP Servers" UI) that operate on a server id without
    * a live URL. For the security-critical token-release gate use {@link isAccessAllowedForUrl} instead.
    * @param providerId The id of the authentication provider
    * @param accountName The account name that access is checked for
    * @param mcpServerId The id of the MCP server requesting access
    * @returns Returns true or false if the user has opted to permanently grant or disallow access, and undefined
    * if they haven't made a choice yet
    */
    isAccessAllowed(providerId: string, accountName: string, mcpServerId: string): boolean | undefined;
    /**
    * Gate for releasing a token to an HTTP MCP server. Access is only allowed if {@link mcpServerUrl}
    * matches the URL stored when access was granted, so re-pointing a server at a new endpoint (while
    * keeping the same id) requires the user to re-consent. `product.json`-trusted servers bypass the
    * URL check. Only HTTP servers authenticate, so the URL is always known and therefore required.
    * @param providerId The id of the authentication provider
    * @param accountName The account name that access is checked for
    * @param mcpServerId The id of the MCP server requesting access
    * @param mcpServerUrl The MCP server's current URL
    * @returns Returns true or false if the user has opted to permanently grant or disallow access, and undefined
    * if they haven't made a choice yet (or the URL no longer matches the granted one)
    */
    isAccessAllowedForUrl(providerId: string, accountName: string, mcpServerId: string, mcpServerUrl: string): boolean | undefined;
    readAllowedMcpServers(providerId: string, accountName: string): AllowedMcpServer[];
    updateAllowedMcpServers(providerId: string, accountName: string, mcpServers: AllowedMcpServer[]): void;
    removeAllowedMcpServers(providerId: string, accountName: string): void;
}
