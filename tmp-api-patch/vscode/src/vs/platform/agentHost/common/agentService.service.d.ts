import { Event } from "../../../base/common/event.js";
import { IObservable } from "../../../base/common/observable.js";
import { URI } from "../../../base/common/uri.js";
import { AuthenticateParams, AuthenticateResult, IAgentHostAuthTokenRequest, IAgentSessionMetadata, IAgentCreateSessionConfig, IAgentCreateChatOptions, IAgentResolveSessionConfigParams, IAgentSessionConfigCompletionsParams, IMcpNotification, type IAgentConnection, type IAgentHostInspectInfo, type IAgentHostSocketInfo } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
import { ResolveSessionConfigResult, SessionConfigCompletionsResult, CompletionsParams, CompletionsResult, CreateTerminalParams, InvokeChangesetOperationParams, InvokeChangesetOperationResult } from "./state/protocol/commands.js";
import { ActionEnvelope, INotification, SessionAction, ChatAction, TerminalAction, ClientAnnotationsAction, IRootConfigChangedAction } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/state/sessionActions";
import { IStateSnapshot, ResourceListResult, ResourceReadResult, ResourceWriteParams, ResourceWriteResult, ResourceCopyParams, ResourceCopyResult, ResourceDeleteParams, ResourceDeleteResult, ResourceMoveParams, ResourceMoveResult, ResourceResolveParams, ResourceResolveResult, ResourceMkdirParams, ResourceMkdirResult, CreateResourceWatchParams, CreateResourceWatchResult, ResourceWatchState } from "./state/sessionProtocol.js";
export declare const IAgentService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IAgentService>;
/**
* Service contract for communicating with the agent host process. Methods here
* are proxied across MessagePort via `ProxyChannel`.
*
* State is synchronized via the subscribe/unsubscribe/dispatchAction protocol.
* Clients observe root state (agents, models) and session state via subscriptions,
* and mutate state by dispatching actions (e.g. session/turnStarted, session/turnCancelled).
*/
export interface IAgentService {
    readonly _serviceBrand: undefined;
    /**
    * Authenticate for a protected resource on the server.
    * The {@link AuthenticateParams.resource} must match a resource from
    * the agent's protectedResources in root state. Analogous to RFC 6750
    * bearer token delivery.
    */
    authenticate(params: AuthenticateParams): Promise<AuthenticateResult>;
    /** Return a bearer token previously supplied via {@link authenticate}. */
    getAuthToken(request: IAgentHostAuthTokenRequest): string | undefined;
    /** List all available sessions from the Copilot CLI. */
    listSessions(): Promise<IAgentSessionMetadata[]>;
    /** Create a new session. Returns the session URI. */
    createSession(config?: IAgentCreateSessionConfig): Promise<URI>;
    /**
    * Create an additional chat within an existing session. Spins up the
    * backing chat in the harness (sharing the session's session) and
    * registers the chat in the session's catalog so subscribers observe a
    * `session/chatAdded` action. The `chat` URI is the client-chosen channel.
    */
    createChat(session: URI, chat: URI, options?: IAgentCreateChatOptions): Promise<void>;
    /** Dispose an additional chat created via {@link createChat}. */
    disposeChat(session: URI, chat: URI): Promise<void>;
    /** Resolve the dynamic configuration schema for creating a session. */
    resolveSessionConfig(params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult>;
    /** Return dynamic completions for a session configuration property. */
    sessionConfigCompletions(params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult>;
    /**
    * Return completion items for a partially-typed input (e.g. an `@`-mention
    * inside a user message the user is composing). Delegates to a pluggable
    * set of {@link IAgentHostCompletionItemProvider}s registered with the
    * agent host.
    *
    * Note: this method does not accept a {@link CancellationToken} because
    * `CancellationToken`s do not round-trip through the IPC boundary today
    * (the deserialised value lacks the prototype methods used by
    * subscribers). Callers that need cancellation should race the returned
    * promise on their own side.
    */
    completions(params: CompletionsParams): Promise<CompletionsResult>;
    /**
    * Returns the set of characters that, when typed in a {@link UserMessage}
    * input, SHOULD cause the client to issue a `completions` request.
    * Aggregated from every registered {@link IAgentHostCompletionItemProvider}.
    */
    getCompletionTriggerCharacters(): Promise<readonly string[]>;
    /** Dispose a session in the agent host, freeing SDK resources. */
    disposeSession(session: URI): Promise<void>;
    /** Create a new terminal on the agent host. */
    createTerminal(params: CreateTerminalParams): Promise<void>;
    /** Dispose a terminal and kill its process if still running. */
    disposeTerminal(terminal: URI): Promise<void>;
    /** Invoke a server-defined changeset operation. */
    invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult>;
    /**
    * Routes a request received on an `mcp://` AHP side channel to the
    * MCP server implementation owned by the appropriate agent. The
    * channel URI shape is `mcp://<providerId>/<sessionId>/<serverName>`
    * (the latter two segments URL-encoded), matching the
    * {@link McpServerCustomization.channel | channel} the agent host
    * advertises while the server is in
    * {@link McpServerStatus.Ready | `Ready`}.
    *
    * `method` is the raw MCP JSON-RPC method (e.g. `tools/list`,
    * `tools/call`, `resources/read`); `params` are the JSON-RPC params
    * (still carrying the routing envelope's `channel` field, which the
    * agent may ignore). Rejects with an `Error` whose message begins
    * with `Method not found` when the channel is unknown or the agent
    * doesn't recognise the method — the protocol server translates that
    * into a JSON-RPC `-32601`.
    */
    handleMcpRequest(channel: string, method: string, params: Record<string, unknown> | undefined): Promise<unknown>;
    /**
    * Aggregated stream of MCP notifications across every agent. The
    * protocol server subscribes once and broadcasts each notification as
    * a JSON-RPC notification to all connected clients (the routing
    * envelope's `channel` field is sufficient for client-side dispatch,
    * so no per-subscription fanout is required).
    */
    readonly onMcpNotification: Event<IMcpNotification>;
    /** Gracefully shut down all sessions and the underlying client. */
    shutdown(): Promise<void>;
    /**
    * Subscribe to state at the given URI. Returns a snapshot of the current
    * state and the serverSeq at snapshot time. Subsequent actions for this
    * resource arrive via {@link onDidAction}. Registers `clientId` against
    * the resource so the server-side refcount knows who is watching, so the
    * caller does not need to invoke {@link addSubscriber} separately. Pair
    * with {@link unsubscribe} when the subscription is released.
    */
    subscribe(resource: URI, clientId: string): Promise<IStateSnapshot>;
    /**
    * Counterpart to {@link subscribe}. Drops `clientId` from the refcount
    * for `resource`; when the last subscriber is removed, idle session state
    * for `resource` may be evicted from the server.
    */
    unsubscribe(resource: URI, clientId: string): void;
    /**
    * Register `clientId` against `resource` without going through
    * {@link subscribe}. Only needed by callers that hand out snapshots
    * synchronously (e.g. the JSON-RPC handshake serving `initialSubscriptions`
    * out of the in-memory state cache); regular subscribers should call
    * {@link subscribe} instead. Counterpart cleanup is {@link unsubscribe}.
    */
    addSubscriber(resource: URI, clientId: string): void;
    /**
    * Fires when the server applies an action to subscribable state.
    * Clients use this alongside {@link subscribe} to keep their local
    * state in sync.
    */
    readonly onDidAction: Event<ActionEnvelope>;
    /**
    * Fires when the server broadcasts an ephemeral notification
    * (e.g. sessionAdded, sessionRemoved).
    */
    readonly onDidNotification: Event<INotification>;
    /**
    * Dispatch a client-originated action to the server. The server applies
    * it to state, triggers side effects, and echoes it back via
    * {@link onDidAction} with the client's origin for reconciliation.
    *
    * `channel` is the protocol URI string identifying the channel the action
    * targets (a session URI for session actions, terminal URI for terminal
    * actions, or {@link ROOT_STATE_URI} for root actions). Strings are used
    * rather than {@link URI} objects so that authority-less scheme URIs
    * like `ahp-root://` survive the wire format without normalization.
    */
    dispatchAction(channel: string, action: SessionAction | ChatAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction, clientId: string, clientSeq: number): void;
    /**
    * List the contents of a directory on the agent host's filesystem.
    * Used by the client to drive a remote folder picker before session creation.
    */
    resourceList(uri: URI): Promise<ResourceListResult>;
    /**
    * Read stored content by URI from the agent host (e.g. file edit snapshots,
    * or reading files from the remote filesystem).
    */
    resourceRead(uri: URI): Promise<ResourceReadResult>;
    /**
    * Write content to a file on the agent host's filesystem.
    * Used for undo/redo operations on file edits.
    */
    resourceWrite(params: ResourceWriteParams): Promise<ResourceWriteResult>;
    /**
    * Copy a resource from one URI to another on the agent host's filesystem.
    */
    resourceCopy(params: ResourceCopyParams): Promise<ResourceCopyResult>;
    /**
    * Delete a resource at a URI on the agent host's filesystem.
    */
    resourceDelete(params: ResourceDeleteParams): Promise<ResourceDeleteResult>;
    /**
    * Move (rename) a resource from one URI to another on the agent host's filesystem.
    */
    resourceMove(params: ResourceMoveParams): Promise<ResourceMoveResult>;
    /**
    * Resolve a resource (stat + realpath) on the agent host's filesystem.
    */
    resourceResolve(params: ResourceResolveParams): Promise<ResourceResolveResult>;
    /**
    * Create a directory (mkdir -p semantics) on the agent host's filesystem.
    */
    resourceMkdir(params: ResourceMkdirParams): Promise<ResourceMkdirResult>;
    /**
    * Create a resource watcher on the agent host's filesystem. Returns the
    * `ahp-resource-watch:/<id>` channel URI the caller subscribes to in
    * order to receive `resourceWatch/changed` events. The watcher is
    * tied to the subscriber refcount on that channel — the implementation
    * MUST hold the underlying file-system watcher for a short grace
    * period after the last unsubscribe so reconnects don't drop events.
    */
    createResourceWatch(params: CreateResourceWatchParams): Promise<CreateResourceWatchResult>;
    /**
    * Notify the agent service that a client subscribed to the given
    * `ahp-resource-watch:` channel so the per-watch refcount is bumped
    * (and the underlying {@link IFileService} watcher attached on the
    * first subscriber). Returns the decoded watch descriptor when the
    * channel parses successfully and the watcher is live; returns
    * `undefined` for unknown channels so the caller can surface a
    * not-found error.
    */
    onResourceWatchSubscribed(channel: string): ResourceWatchState | undefined;
    /**
    * Counterpart to {@link onResourceWatchSubscribed}. Decrements the
    * per-watch refcount; on the last drop the watcher is held for a
    * short grace period before disposal.
    */
    onResourceWatchUnsubscribed(channel: string): boolean;
}
export declare const IAgentHostService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostService>;
/**
* The local wrapper around the agent host process (manages lifecycle, restart,
* exposes the proxied service). Consumed by the main process and workbench.
*/
export interface IAgentHostService extends IAgentConnection {
    readonly _serviceBrand: undefined;
    readonly onAgentHostExit: Event<number>;
    readonly onAgentHostStart: Event<void>;
    /**
    * `true` while we are in the middle of authenticating against the local
    * agent host (resolving tokens for any advertised `protectedResources` and
    * pushing them via {@link authenticate}). Defaults to `true` at startup so
    * that the period before the first auth pass is also covered.
    *
    * Producers (the workbench `AgentHostContribution`) flip this around their
    * auth pass; consumers (e.g. the local sessions provider) read it to mark
    * sessions as still loading.
    */
    readonly authenticationPending: IObservable<boolean>;
    /** Update {@link authenticationPending}. Internal — only the auth driver should call this. */
    setAuthenticationPending(pending: boolean): void;
    restartAgentHost(): Promise<void>;
    startWebSocketServer(): Promise<IAgentHostSocketInfo>;
    /**
    * Get inspector listener info for the agent host process. If the inspector
    * is not currently active and `tryEnable` is true, opens the inspector on
    * a random local port. Returns `undefined` if the inspector cannot be
    * enabled.
    */
    getInspectInfo(tryEnable: boolean): Promise<IAgentHostInspectInfo | undefined>;
}
