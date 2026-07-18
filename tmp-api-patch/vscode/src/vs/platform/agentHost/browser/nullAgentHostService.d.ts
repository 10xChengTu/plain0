import { Event } from "../../../base/common/event.js";
import { IReference } from "../../../base/common/lifecycle.js";
import { IObservable } from "../../../base/common/observable.js";
import { URI } from "../../../base/common/uri.js";
import type { IAgentCreateSessionConfig, IAgentHostInspectInfo, IAgentHostSocketInfo, IAgentResolveSessionConfigParams, IAgentSessionConfigCompletionsParams, IAgentSessionMetadata, AuthenticateParams, AuthenticateResult } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
import { IAgentHostService } from "../common/agentService.service.js";
import type { IActiveSubscriptionInfo, IAgentSubscription } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/state/agentSubscription";
import type { CompletionsParams, CompletionsResult, CreateTerminalParams, ResolveSessionConfigResult, SessionConfigCompletionsResult } from "../common/state/protocol/commands.js";
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from "../common/state/protocol/channels-changeset/commands.js";
import type { ActionEnvelope, INotification, IRootConfigChangedAction, SessionAction, TerminalAction, ClientAnnotationsAction } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/state/sessionActions";
import type { IRemoteWatchHandle } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentHostFileSystemProvider";
import type { CreateResourceWatchParams, CreateResourceWatchResult, ResourceCopyParams, ResourceCopyResult, ResourceDeleteParams, ResourceDeleteResult, ResourceListResult, ResourceMkdirParams, ResourceMkdirResult, ResourceMoveParams, ResourceMoveResult, ResourceReadResult, ResourceResolveParams, ResourceResolveResult, ResourceWriteParams, ResourceWriteResult } from "../common/state/sessionProtocol.js";
import type { ComponentToState, RootState, StateComponents } from "../common/state/sessionState.js";
/**
 * Null implementation of {@link IAgentHostService} for browser contexts
 * where a local agent host process is not available.
 */
export declare class NullAgentHostService implements IAgentHostService {
    readonly _serviceBrand: undefined;
    readonly clientId = "";
    readonly onAgentHostExit: Event<any>;
    readonly onAgentHostStart: Event<any>;
    readonly onDidNotification: Event<INotification>;
    readonly onDidAction: Event<ActionEnvelope>;
    readonly onMcpNotification: Event<any>;
    readonly authenticationPending: IObservable<boolean>;
    setAuthenticationPending(_pending: boolean): void;
    get rootState(): IAgentSubscription<RootState>;
    getSubscription<T extends StateComponents>(_kind: T, _resource: URI, _owner: string): IReference<IAgentSubscription<ComponentToState[T]>>;
    getSubscriptionUnmanaged<T extends StateComponents>(_kind: T, _resource: URI): IAgentSubscription<ComponentToState[T]> | undefined;
    getInflightSessionCreate(_resource: URI): Promise<unknown> | undefined;
    getActiveSubscriptions(): readonly IActiveSubscriptionInfo[];
    dispatch(_channel: string, _action: SessionAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction): void;
    restartAgentHost(): Promise<void>;
    authenticate(_params: AuthenticateParams): Promise<AuthenticateResult>;
    listSessions(): Promise<IAgentSessionMetadata[]>;
    createSession(_config?: IAgentCreateSessionConfig): Promise<URI>;
    resolveSessionConfig(_params: IAgentResolveSessionConfigParams): Promise<ResolveSessionConfigResult>;
    sessionConfigCompletions(_params: IAgentSessionConfigCompletionsParams): Promise<SessionConfigCompletionsResult>;
    completions(_params: CompletionsParams): Promise<CompletionsResult>;
    getCompletionTriggerCharacters(): Promise<readonly string[]>;
    startWebSocketServer(): Promise<IAgentHostSocketInfo>;
    getInspectInfo(_tryEnable: boolean): Promise<IAgentHostInspectInfo | undefined>;
    disposeSession(_session: URI): Promise<void>;
    createChat(_session: URI, _chat: URI): Promise<void>;
    disposeChat(_chat: URI): Promise<void>;
    createTerminal(_params: CreateTerminalParams): Promise<void>;
    disposeTerminal(_terminal: URI): Promise<void>;
    invokeChangesetOperation(_params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult>;
    handleMcpRequest(_channel: string, _method: string, _params: Record<string, unknown> | undefined): Promise<unknown>;
    resourceList(_uri: URI): Promise<ResourceListResult>;
    resourceRead(_uri: URI): Promise<ResourceReadResult>;
    resourceWrite(_params: ResourceWriteParams): Promise<ResourceWriteResult>;
    resourceCopy(_params: ResourceCopyParams): Promise<ResourceCopyResult>;
    resourceDelete(_params: ResourceDeleteParams): Promise<ResourceDeleteResult>;
    resourceMove(_params: ResourceMoveParams): Promise<ResourceMoveResult>;
    resourceResolve(_params: ResourceResolveParams): Promise<ResourceResolveResult>;
    resourceMkdir(_params: ResourceMkdirParams): Promise<ResourceMkdirResult>;
    createResourceWatch(_params: CreateResourceWatchParams): Promise<CreateResourceWatchResult>;
    watchResource(_params: CreateResourceWatchParams): Promise<IRemoteWatchHandle>;
}
