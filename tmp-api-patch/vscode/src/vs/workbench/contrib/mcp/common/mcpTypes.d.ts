import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { Disposable, IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable, ObservableMap } from "../../../../base/common/observable.js";
import Severity from "../../../../base/common/severity.js";
import { URI, UriComponents } from "../../../../base/common/uri.js";
import { Location } from "../../../../editor/common/languages.js";
import { ConfigurationTarget } from "../../../../platform/configuration/common/configuration.js";
import { RawContextKey } from "../../../../platform/contextkey/common/contextkey.js";
import { IEditorOptions } from "../../../../platform/editor/common/editor.js";
import { ExtensionIdentifier } from "../../../../platform/extensions/common/extensions.js";
import { IGalleryMcpServer, IGalleryMcpServerConfiguration, IInstallableMcpServer } from "../../../../platform/mcp/common/mcpManagement.js";
import { IMcpDevModeConfig, IMcpSandboxConfiguration, IMcpServerConfiguration } from "../../../../platform/mcp/common/mcpPlatformTypes.js";
import { StorageScope } from "../../../../platform/storage/common/storage.js";
import { IWorkspaceFolder, IWorkspaceFolderData } from "../../../../platform/workspace/common/workspace.js";
import { IWorkbenchLocalMcpServer } from "../../../services/mcp/common/mcpWorkbenchManagementService.js";
import { ContributionEnablementState } from "../../chat/common/enablement.js";
import { ToolProgress } from "../../chat/common/tools/languageModelToolsService.js";
import { McpServerRequestHandler } from "@codingame/monaco-vscode-mcp-service-override/vscode/vs/workbench/contrib/mcp/common/mcpServerRequestHandler";
import { MCP } from "./modelContextProtocol.js";
import { UriTemplate } from "../../../../base/common/uriTemplate.js";
import { IMcpWorkbenchService } from "./mcpTypes.service.js";
export declare const extensionMcpCollectionPrefix = "ext.";
/**
 * Prefix of the collection id used for MCP servers configured via the various
 * `mcp.json`-style config files (user, remote user, workspace, and
 * `.vscode/mcp.json` workspace-folder configs). The suffix is the
 * {@link IMcpConfigPath.id} of the originating config path.
 */
export declare const MCP_CONFIGURATION_COLLECTION_ID_PREFIX = "mcp.config.";
export declare function extensionPrefixedIdentifier(identifier: ExtensionIdentifier, id: string): string;
/**
 * An McpCollection contains McpServers. There may be multiple collections for
 * different locations servers are discovered.
 */
export interface McpCollectionDefinition {
    /** Origin authority from which this collection was discovered. */
    readonly remoteAuthority: string | null;
    /** Globally-unique, stable ID for this definition */
    readonly id: string;
    /** Human-readable label for the definition */
    readonly label: string;
    /** Definitions this collection contains. */
    readonly serverDefinitions: IObservable<readonly McpServerDefinition[]>;
    /**
     * Trust behavior of the servers. `Trusted` means it will run without a prompt, always.
     * `TrustedOnNonce` means it will run without a prompt as long as the nonce matches.
     */
    readonly trustBehavior: McpServerTrust.Kind.Trusted | McpServerTrust.Kind.TrustedOnNonce;
    /** Scope where associated collection info should be stored. */
    readonly scope: StorageScope;
    /** Configuration target where configuration related to this server should be stored. */
    readonly configTarget: ConfigurationTarget;
    /** Root-level sandbox settings from the mcp config file. */
    readonly sandbox?: IMcpSandboxConfiguration;
    /** Resolves a server definition. If present, always called before a server starts. */
    resolveServerLanch?(definition: McpServerDefinition): Promise<McpServerLaunch | undefined>;
    /** For lazy-loaded collections only: */
    readonly lazy?: {
        /** True if `serverDefinitions` were loaded from the cache */
        isCached: boolean;
        /** Triggers a load of the real server definition, which should be pushed to the IMcpRegistry. If not this definition will be removed. */
        load(): Promise<void>;
        /** Called after `load()` if the extension is not found. */
        removed?(): void;
    };
    readonly source?: IWorkbenchMcpServer | ExtensionIdentifier;
    /** Sort order of the collection. Lower values have higher priority. */
    readonly order: number;
    readonly presentation?: {
        /** Place where this collection is configured, used in workspace trust prompts and "show config" */
        readonly origin?: URI;
    };
}
export declare enum McpCollectionSortOrder {
    WorkspaceFolder = 0,
    Workspace = 100,
    User = 200,
    Extension = 300,
    Plugin = 350,
    Filesystem = 400,
    RemoteBoost = -50
}
export declare namespace McpCollectionDefinition {
    interface FromExtHost {
        readonly id: string;
        readonly label: string;
        readonly isTrustedByDefault: boolean;
        readonly scope: StorageScope;
        readonly canResolveLaunch: boolean;
        readonly extensionId: string;
        readonly configTarget: ConfigurationTarget;
    }
    function equals(a: McpCollectionDefinition, b: McpCollectionDefinition): boolean;
    /**
     * Returns `true` when the collection was discovered from the workspace (its
     * config target is the workspace or a workspace folder). This is
     * intentionally based on the config target and not the storage scope:
     * extension-contributed collections use a workspace storage scope but are
     * configured at the user level, so they are not workspace-discovered.
     */
    function isWorkspaceDiscovered(collection: McpCollectionDefinition): boolean;
    /**
     * Returns `true` when the collection originates from a `.vscode/mcp.json`
     * workspace-folder config, identified by its collection id prefix (the
     * shared `mcp.config.` prefix plus the workspace-folder config id).
     */
    function isVscodeMcpJson(collection: McpCollectionDefinition): boolean;
}
export interface McpServerDefinition {
    /** Globally-unique, stable ID for this definition */
    readonly id: string;
    /** Human-readable label for the definition */
    readonly label: string;
    /** Descriptor defining how the configuration should be launched. */
    readonly launch: McpServerLaunch;
    /** Explicit roots. If undefined, all workspace folders. */
    readonly roots?: URI[] | undefined;
    /** If set, allows configuration variables to be resolved in the {@link launch} with the given context */
    readonly variableReplacement?: McpServerDefinitionVariableReplacement;
    /** Nonce used for caching the server. Changing the nonce will indicate that tools need to be refreshed. */
    readonly cacheNonce: string;
    /** Dev mode configuration for the server */
    readonly devMode?: IMcpDevModeConfig;
    /** Static description of server tools/data, used to hydrate the cache. */
    readonly staticMetadata?: McpServerStaticMetadata;
    /** Indicates if the sandbox is enabled for this server. */
    readonly sandboxEnabled?: boolean;
    readonly presentation?: {
        /** Sort order of the definition. */
        readonly order?: number;
        /** Place where this server is configured, used in workspace trust prompts and "show config" */
        readonly origin?: Location;
    };
}
export declare enum McpServerStaticToolAvailability {
    /** Tool is expected to be present as soon as the server is started. */
    Initial = 0,
    /** Tool may be present later. */
    Dynamic = 1
}
export interface McpServerStaticMetadata {
    tools?: {
        availability: McpServerStaticToolAvailability;
        definition: MCP.Tool;
    }[];
    instructions?: string;
    capabilities?: MCP.ServerCapabilities;
    serverInfo?: MCP.Implementation;
}
export declare namespace McpServerDefinition {
    interface Serialized {
        readonly id: string;
        readonly label: string;
        readonly cacheNonce: string;
        readonly launch: McpServerLaunch.Serialized;
        readonly variableReplacement?: McpServerDefinitionVariableReplacement.Serialized;
        readonly staticMetadata?: McpServerStaticMetadata;
        readonly sandboxEnabled?: boolean;
    }
    function toSerialized(def: McpServerDefinition): McpServerDefinition.Serialized;
    function fromSerialized(def: McpServerDefinition.Serialized): McpServerDefinition;
    function equals(a: McpServerDefinition, b: McpServerDefinition): boolean;
}
export interface McpServerDefinitionVariableReplacement {
    section?: string;
    folder?: IWorkspaceFolderData;
    target: ConfigurationTarget;
}
export declare namespace McpServerDefinitionVariableReplacement {
    interface Serialized {
        target: ConfigurationTarget;
        section?: string;
        folder?: {
            name: string;
            index: number;
            uri: UriComponents;
        };
    }
    function toSerialized(def: McpServerDefinitionVariableReplacement): McpServerDefinitionVariableReplacement.Serialized;
    function fromSerialized(def: McpServerDefinitionVariableReplacement.Serialized): McpServerDefinitionVariableReplacement;
}
/** An observable of the auto-starting servers. When 'starting' is empty, the operation is complete. */
export interface IAutostartResult {
    working: boolean;
    starting: McpDefinitionReference[];
    serversRequiringInteraction: Array<McpDefinitionReference & {
        errorMessage?: string;
    }>;
}
export declare namespace IAutostartResult {
    const Empty: IAutostartResult;
}
export declare enum LazyCollectionState {
    HasUnknown = 0,
    LoadingUnknown = 1,
    AllKnown = 2
}
export interface McpCollectionReference {
    id: string;
    label: string;
    order: number;
    presentation?: McpCollectionDefinition["presentation"];
}
export interface McpDefinitionReference {
    id: string;
    label: string;
}
export declare class McpStartServerInteraction {
    /** @internal */
    readonly participants: ObservableMap<string, {
        s: "unknown" | "resolved";
    } | {
        s: "waiting";
        definition: McpServerDefinition;
        collection: McpCollectionDefinition;
    }>;
    choice?: Promise<string[] | undefined>;
}
export interface IMcpServerStartOpts {
    /**
     * Automatically trust if changed. This should ONLY be set for afforances that
     * ensure the user sees the config before it gets started (e.g. code lenses)
     */
    autoTrustChanges?: boolean;
    /**
     * When to trigger the trust prompt.
     * - only-new: only prompt for servers that are not previously explicitly untrusted (default)
     * - all-untrusted: prompt for all servers that are not trusted
     * - never: don't prompt, fail silently when trying to start an untrusted server
     */
    promptType?: "only-new" | "all-untrusted" | "never";
    /** True if th servre should be launched with debugging. */
    debug?: boolean;
    /** Correlate multiple interactions such that any trust prompts are presented in combination. */
    interaction?: McpStartServerInteraction;
    /**
     * If true, throw an error if any user interaction would be required during startup.
     * This includes variable resolution, trust prompts, and authentication prompts.
     */
    errorOnUserInteraction?: boolean;
}
export declare namespace McpServerTrust {
    enum Kind {
        /** The server is trusted */
        Trusted = 0,
        /** The server is trusted as long as its nonce matches */
        TrustedOnNonce = 1,
        /** The server trust was denied. */
        Untrusted = 2,
        /** The server is not yet trusted or untrusted. */
        Unknown = 3
    }
}
export interface IMcpServer extends IDisposable {
    readonly collection: McpCollectionReference;
    readonly definition: McpDefinitionReference;
    readonly enablement: IObservable<ContributionEnablementState>;
    readonly connection: IObservable<IMcpServerConnection | undefined>;
    readonly connectionState: IObservable<McpConnectionState>;
    readonly serverMetadata: IObservable<{
        serverName?: string;
        serverInstructions?: string;
        icons: IMcpIcons;
    } | undefined>;
    /**
     * Full definition as it exists in the MCP registry. Unlike the references
     * in `collection` and `definition`, this may change over time.
     */
    readDefinitions(): IObservable<{
        server: McpServerDefinition | undefined;
        collection: McpCollectionDefinition | undefined;
    }>;
    showOutput(preserveFocus?: boolean): Promise<void>;
    /**
     * Starts the server and returns its resulting state. One of:
     * - Running, if all good
     * - Error, if the server failed to start
     * - Stopped, if the server was disposed or the user cancelled the launch
     */
    start(opts?: IMcpServerStartOpts): Promise<McpConnectionState>;
    stop(): Promise<void>;
    readonly cacheState: IObservable<McpServerCacheState>;
    readonly tools: IObservable<readonly IMcpTool[]>;
    readonly prompts: IObservable<readonly IMcpPrompt[]>;
    readonly capabilities: IObservable<McpCapability | undefined>;
    /**
     * Lists all resources on the server.
     */
    resources(token?: CancellationToken): AsyncIterable<IMcpResource[]>;
    /**
     * List resource templates on the server.
     */
    resourceTemplates(token?: CancellationToken): Promise<IMcpResourceTemplate[]>;
}
/**
 * A representation of an MCP resource. The `uri` is namespaced to VS Code and
 * can be used in filesystem APIs.
 */
export interface IMcpResource {
    /** Identifier for the file in VS Code and operable with filesystem API */
    readonly uri: URI;
    /** Identifier of the file as given from the MCP server. */
    readonly mcpUri: string;
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly mimeType?: string;
    readonly sizeInBytes?: number;
    readonly icons: IMcpIcons;
}
export interface IMcpResourceTemplate {
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly mimeType?: string;
    readonly template: UriTemplate;
    readonly icons: IMcpIcons;
    /** Gets string completions for the given template part. */
    complete(templatePart: string, prefix: string, alreadyResolved: Record<string, string | string[]>, token: CancellationToken): Promise<string[]>;
    /** Gets the resolved URI from template parts. */
    resolveURI(vars: Record<string, unknown>): URI;
}
export declare const isMcpResourceTemplate: (obj: IMcpResource | IMcpResourceTemplate) => obj is IMcpResourceTemplate;
export declare const isMcpResource: (obj: IMcpResource | IMcpResourceTemplate) => obj is IMcpResource;
export declare enum McpServerCacheState {
    /** Tools have not been read before */
    Unknown = 0,
    /** Tools were read from the cache */
    Cached = 1,
    /** Tools were read from the cache or live, but they may be outdated. */
    Outdated = 2,
    /** Tools are refreshing for the first time */
    RefreshingFromUnknown = 3,
    /** Tools are refreshing and the current tools are cached */
    RefreshingFromCached = 4,
    /** Tool state is live, server is connected */
    Live = 5
}
export interface IMcpPrompt {
    readonly id: string;
    readonly name: string;
    readonly title?: string;
    readonly description?: string;
    readonly arguments: readonly MCP.PromptArgument[];
    /** Gets string completions for the given prompt part. */
    complete(argument: string, prefix: string, alreadyResolved: Record<string, string>, token: CancellationToken): Promise<string[]>;
    resolve(args: Record<string, string | undefined>, token?: CancellationToken): Promise<IMcpPromptMessage[]>;
}
export declare const mcpPromptReplaceSpecialChars: (s: string) => string;
export declare const mcpPromptPrefix: (definition: McpDefinitionReference) => string;
export interface IMcpPromptMessage extends MCP.PromptMessage {
}
export interface IMcpToolCallContext {
    chatSessionResource: URI | undefined;
    chatRequestId?: string;
    /**
     * Optional W3C trace context `traceparent` value to forward to the MCP server
     * via `_meta.traceparent` on the JSON-RPC `tools/call` request (MCP SEP-414).
     */
    traceparent?: string;
    /** Optional W3C trace context `tracestate` value paired with {@link traceparent}. */
    tracestate?: string;
}
/**
 * Visibility of an MCP tool, based on the MCP Apps `_meta.ui.visibility` field.
 * @see https://github.com/anthropics/mcp/blob/main/apps.md
 */
export declare enum McpToolVisibility {
    /** Tool is visible to and callable by the language model */
    Model = 1,
    /** Tool is callable by the MCP App UI */
    App = 2
}
/**
 * Serializable data for MCP App UI rendering.
 * This contains all the information needed to render an MCP App webview.
 *
 * The transport for the App's sub-RPCs (`tools/call`, `resources/read`,
 * `sampling/createMessage`, …) is determined by the discriminator:
 *
 * - `local`: resolves the MCP server via {@link IMcpService} from
 *   `serverDefinitionId` + `collectionId`. Used for locally-configured
 *   MCP servers.
 * - `agentHost`: routes through {@link IAgentHostService.handleMcpRequest}
 *   on the AHP `mcp://` side `channel`. Used for MCP servers owned by
 *   an agent host.
 */
export type IMcpToolCallUIData = {
    readonly kind: "local";
    /** URI of the UI resource for rendering (e.g., "ui://weather-server/dashboard") */
    readonly resourceUri: string;
    /** Reference to the server definition for reconnection */
    readonly serverDefinitionId: string;
    /** Reference to the collection containing the server */
    readonly collectionId: string;
} | {
    readonly kind: "agentHost";
    /** URI of the UI resource for rendering (e.g., "ui://weather-server/dashboard") */
    readonly resourceUri: string;
    /** AHP `mcp://` channel URI for the originating server. */
    readonly channel: string;
    /** Stable identifier for the originating server (used as webview origin key). */
    readonly serverId: string;
};
export interface IMcpTool {
    readonly id: string;
    /** Name for #referencing in chat */
    readonly referenceName: string;
    readonly icons: IMcpIcons;
    readonly definition: MCP.Tool;
    /** Visibility of the tool (Model, App, or both). Defaults to Model | App. */
    readonly visibility: McpToolVisibility;
    /** Optional UI resource URI for MCP App rendering */
    readonly uiResourceUri?: string;
    /**
     * Calls a tool
     * @throws {@link MpcResponseError} if the tool fails to execute
     * @throws {@link McpConnectionFailedError} if the connection to the server fails
     */
    call(params: Record<string, unknown>, context?: IMcpToolCallContext, token?: CancellationToken): Promise<MCP.CallToolResult>;
    /**
     * Identical to {@link call}, but reports progress.
     */
    callWithProgress(params: Record<string, unknown>, progress: ToolProgress, context?: IMcpToolCallContext, token?: CancellationToken): Promise<MCP.CallToolResult>;
}
export declare enum McpServerTransportType {
    /** A command-line MCP server communicating over standard in/out */
    Stdio = 1,
    /** An MCP server that uses Server-Sent Events */
    HTTP = 2
}
/**
 * MCP server launched on the command line which communicated over stdio.
 * https://spec.modelcontextprotocol.io/specification/2024-11-05/basic/transports/#stdio
 */
export interface McpServerTransportStdio {
    readonly type: McpServerTransportType.Stdio;
    readonly cwd: string | undefined;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Record<string, string | number | null>;
    readonly envFile: string | undefined;
    readonly sandbox: IMcpSandboxConfiguration | undefined;
}
export interface McpServerTransportHTTPAuthentication {
    /**
     * Authentication provider ID to use to get a session for the initial MCP server connection.
     */
    readonly providerId: string;
    /**
     * Scopes to use to get a session for the initial MCP server connection.
     */
    readonly scopes: string[];
}
export interface McpServerTransportHTTPOAuth {
    readonly clientId?: string;
    /**
     * (Preview) When true, the MCP server uses enterprise-managed authentication via the configured
     * SSO issuer (see `mcp.enterpriseManagedAuth.idp`). Tokens are obtained through OAuth Identity
     * Assertion Authorization Grant (ID-JAG) so that, after a one-time sign-in, subsequent enterprise-managed
     * servers connect silently.
     */
    readonly enterpriseManaged?: boolean;
}
/**
 * Returns the secret-storage key under which an MCP server OAuth client secret is stored.
 * Scoped by the MCP server URL AND the OAuth client_id so that two servers sharing the same
 * client_id string (e.g. against different authorization servers) cannot clobber each other's
 * secret, and so the key is stable across mcp.json configurations that happen to share a label
 * (e.g. user mcp.json vs. workspace mcp.json). Set by the "Set Client Secret" code lens in
 * mcp.json and read at authentication time so that client secrets are never stored in
 * plain-text config files.
 */
export declare function mcpOAuthClientSecretStorageKey(mcpServerUrl: string, clientId: string): string;
/**
 * MCP server launched on the command line which communicated over SSE or Streamable HTTP.
 * https://spec.modelcontextprotocol.io/specification/2024-11-05/basic/transports/#http-with-sse
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 */
export interface McpServerTransportHTTP {
    readonly type: McpServerTransportType.HTTP;
    readonly uri: URI;
    readonly headers: [
        string,
        string
    ][];
    readonly oauth?: McpServerTransportHTTPOAuth;
    /**
     * @deprecated this was originally used for step-auth auth but a different approach was used instead
     * so it's effectively dead code.
     */
    readonly authentication?: McpServerTransportHTTPAuthentication;
}
export type McpServerLaunch = McpServerTransportStdio | McpServerTransportHTTP;
export declare namespace McpServerLaunch {
    type Serialized = {
        type: McpServerTransportType.HTTP;
        uri: UriComponents;
        headers: [
            string,
            string
        ][];
        oauth?: McpServerTransportHTTPOAuth;
        authentication?: McpServerTransportHTTPAuthentication;
    } | {
        type: McpServerTransportType.Stdio;
        cwd: string | undefined;
        command: string;
        args: readonly string[];
        env: Record<string, string | number | null>;
        envFile: string | undefined;
        sandbox: IMcpSandboxConfiguration | undefined;
    };
    function toSerialized(launch: McpServerLaunch): McpServerLaunch.Serialized;
    function fromSerialized(launch: McpServerLaunch.Serialized): McpServerLaunch;
    function hash(launch: McpServerLaunch): Promise<string>;
}
/**
 * An instance that manages a connection to an MCP server. It can be started,
 * stopped, and restarted. Once started and in a running state, it will
 * eventually build a {@link IMcpServerConnection.handler}.
 */
export interface IMcpPotentialSandboxBlock {
    readonly kind: "network" | "filesystem";
    readonly message: string;
    readonly host?: string;
    readonly path?: string;
}
export interface IMcpServerConnection extends IDisposable {
    readonly definition: McpServerDefinition;
    readonly state: IObservable<McpConnectionState>;
    readonly handler: IObservable<McpServerRequestHandler | undefined>;
    readonly onPotentialSandboxBlock: Event<IMcpPotentialSandboxBlock>;
    /**
     * Resolved launch definition. Might not match the `definition.launch` due to
     * resolution logic in extension-provided MCPs.
     */
    readonly launchDefinition: McpServerLaunch;
    /**
     * Starts the server if it's stopped. Returns a promise that resolves once
     * server exits a 'starting' state.
     */
    start(methods: IMcpClientMethods): Promise<McpConnectionState>;
    /**
     * Stops the server.
     */
    stop(): Promise<void>;
}
/** Client methods whose implementations are passed through the server connection. */
export interface IMcpClientMethods {
    /** Handler for `sampling/createMessage` */
    createMessageRequestHandler?(req: MCP.CreateMessageRequest["params"], token?: CancellationToken): Promise<MCP.CreateMessageResult>;
    /** Handler for `elicitation/create` */
    elicitationRequestHandler?(req: MCP.ElicitRequest["params"], token?: CancellationToken): Promise<MCP.ElicitResult>;
}
/**
 * McpConnectionState is the state of the underlying connection and is
 * communicated e.g. from the extension host to the renderer.
 */
export declare namespace McpConnectionState {
    enum Kind {
        Stopped = 0,
        Starting = 1,
        Running = 2,
        Error = 3
    }
    const toString: (s: McpConnectionState) => string;
    const toKindString: (s: McpConnectionState.Kind) => string;
    /** Returns if the MCP state is one where starting a new server is valid */
    const canBeStarted: (s: Kind) => s is Kind.Stopped | Kind.Error;
    /** Gets whether the state is a running state. */
    const isRunning: (s: McpConnectionState) => boolean;
    interface Stopped {
        readonly state: Kind.Stopped;
        readonly reason?: "needs-user-interaction";
    }
    interface Starting {
        readonly state: Kind.Starting;
    }
    interface Running {
        readonly state: Kind.Running;
    }
    interface Error {
        readonly state: Kind.Error;
        readonly code?: string;
        readonly shouldRetry?: boolean;
        readonly message: string;
    }
}
export type McpConnectionState = McpConnectionState.Stopped | McpConnectionState.Starting | McpConnectionState.Running | McpConnectionState.Error;
export declare class MpcResponseError extends Error {
    readonly code: number;
    readonly data: unknown;
    constructor(message: string, code: number, data: unknown);
}
export declare class McpConnectionFailedError extends Error {
}
export declare class UserInteractionRequiredError extends Error {
    readonly reason: string;
    private static readonly prefix;
    static is(error: Error): boolean;
    constructor(reason: string);
}
export interface IMcpConfigPath {
    id: string;
    key: "userLocalValue" | "userRemoteValue" | "workspaceValue" | "workspaceFolderValue";
    label: string;
    scope: StorageScope;
    target: ConfigurationTarget;
    order: number;
    remoteAuthority?: string;
    uri: URI | undefined;
    section?: string[];
    workspaceFolder?: IWorkspaceFolder;
}
export interface IMcpServerContainer extends IDisposable {
    mcpServer: IWorkbenchMcpServer | null;
    update(): void;
}
export interface IMcpServerEditorOptions extends IEditorOptions {
    tab?: McpServerEditorTab;
    sideByside?: boolean;
}
export declare enum McpServerEnablementState {
    Disabled = 0,
    DisabledByAccess = 1,
    DisabledProfile = 2,
    DisabledWorkspace = 3,
    Enabled = 4
}
export declare enum McpServerInstallState {
    Installing = 0,
    Installed = 1,
    Uninstalling = 2,
    Uninstalled = 3
}
export declare enum McpServerEditorTab {
    Readme = "readme",
    Manifest = "manifest",
    Configuration = "configuration"
}
export type McpServerEnablementStatus = {
    readonly state: McpServerEnablementState;
    readonly message?: {
        readonly severity: Severity;
        readonly text: IMarkdownString;
    };
};
export interface IWorkbenchMcpServer {
    readonly gallery: IGalleryMcpServer | undefined;
    readonly local: IWorkbenchLocalMcpServer | undefined;
    readonly installable: IInstallableMcpServer | undefined;
    readonly installState: McpServerInstallState;
    readonly runtimeStatus: McpServerEnablementStatus | undefined;
    readonly id: string;
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly icon?: {
        readonly dark: string;
        readonly light: string;
    };
    readonly codicon?: string;
    readonly publisherUrl?: string;
    readonly publisherDisplayName?: string;
    readonly starsCount?: number;
    readonly license?: string;
    readonly repository?: string;
    readonly config?: IMcpServerConfiguration | undefined;
    readonly readmeUrl?: URI;
    getReadme(token: CancellationToken): Promise<string>;
    getManifest(token: CancellationToken): Promise<IGalleryMcpServerConfiguration>;
}
export declare class McpServerContainers extends Disposable {
    private readonly containers;
    constructor(containers: IMcpServerContainer[], mcpWorkbenchService: IMcpWorkbenchService);
    set mcpServer(extension: IWorkbenchMcpServer | null);
    update(server: IWorkbenchMcpServer | undefined): void;
}
export declare const McpServersGalleryStatusContext: RawContextKey<string>;
export declare const HasInstalledMcpServersContext: RawContextKey<boolean>;
export declare const InstalledMcpServersViewId = "workbench.views.mcp.installed";
export declare namespace McpResourceURI {
    const scheme = "mcp-resource";
    function fromServer(def: McpDefinitionReference, resourceURI: URI | string): URI;
    function toServer(uri: URI | string): {
        definitionId: string;
        resourceURL: URL;
    };
}
/** Warning: this enum is cached in `mcpServer.ts` and all changes MUST only be additive. */
export declare enum McpCapability {
    Logging = 1,
    Completions = 2,
    Prompts = 4,
    PromptsListChanged = 8,
    Resources = 16,
    ResourcesSubscribe = 32,
    ResourcesListChanged = 64,
    Tools = 128,
    ToolsListChanged = 256
}
export interface ISamplingOptions {
    server: IMcpServer;
    isDuringToolCall: boolean;
    params: MCP.CreateMessageRequest["params"];
}
export interface ISamplingResult {
    sample: MCP.CreateMessageResult;
}
export declare class McpError extends Error {
    readonly code: number;
    readonly data?: unknown | undefined;
    static methodNotFound(method: string): McpError;
    static notAllowed(): McpError;
    static unknown(e: Error): McpError;
    constructor(code: number, message: string, data?: unknown | undefined);
}
export declare enum McpToolName {
    Prefix = "mcp_",
    MaxPrefixLen = 18,
    MaxLength = 64
}
export declare enum ElicitationKind {
    Form = 0,
    URL = 1
}
export interface IUrlModeElicitResult extends IDisposable {
    kind: ElicitationKind.URL;
    value: MCP.ElicitResult;
    /**
     * Waits until the server tells us the elicitation is completed before resolving.
     * Rejects with a CancellationError if the server stops before elicitation is
     * complete, or if the token is cancelled.
     */
    wait: Promise<void>;
}
export interface IFormModeElicitResult extends IDisposable {
    kind: ElicitationKind.Form;
    value: MCP.ElicitResult;
}
export type ElicitResult = IUrlModeElicitResult | IFormModeElicitResult;
export declare const McpToolResourceLinkMimeType = "application/vnd.code.resource-link";
export interface IMcpToolResourceLinkContents {
    uri: UriComponents;
    underlyingMimeType?: string;
}
export interface IMcpIcons {
    /** Gets the image URI appropriate to the approximate display size */
    getUrl(size: number): {
        dark: URI;
        light?: URI;
    } | undefined;
}
