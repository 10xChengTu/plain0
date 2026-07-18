import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../base/common/observable.js";
import { ThemeIcon } from "../../../../base/common/themables.js";
import { URI } from "../../../../base/common/uri.js";
import { IPosition } from "../../../../editor/common/core/position.js";
import { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { IChatAgentAttachmentCapabilities, IChatAgentRequest } from "./participants/chatAgents.js";
import { IChatEditingSession } from "./editing/chatEditingService.js";
import { IChatRequestModeInstructions, IChatRequestVariableData, ISerializableChatModelInputState } from "./model/chatModel.js";
import { IChatProgress, IChatResponseErrorDetails, IChatSessionTiming } from "./chatService/chatService.js";
import { Target } from "./promptSyntax/promptTypes.js";
export declare enum ChatSessionsExtensions {
    AsyncActivation = "workbench.contrib.chatSessions.asyncActivation"
}
export interface IAsyncChatSessionActivationContribution {
    matchSessionType(sessionType: string): boolean;
    waitForActivation(accessor: ServicesAccessor, sessionType: string): Promise<boolean>;
}
export interface IAsyncChatSessionActivationRegistry {
    register(contribution: IAsyncChatSessionActivationContribution): IDisposable;
    getActivators(sessionType: string): readonly IAsyncChatSessionActivationContribution[];
}
export declare enum ChatSessionStatus {
    Failed = 0,
    Completed = 1,
    InProgress = 2,
    NeedsInput = 3
}
export interface IChatSessionCommandContribution {
    readonly name: string;
    readonly description: string;
    readonly when?: string;
}
export interface IChatSessionProviderOptionModelMetadata {
    readonly name: string;
    readonly id: string;
    readonly vendor?: string;
    readonly version?: string;
    readonly family?: string;
    readonly tooltip?: string;
    readonly pricing?: string;
    readonly multiplierNumeric?: number;
    readonly inputCost?: number;
    readonly outputCost?: number;
    readonly cacheCost?: number;
    readonly cacheWriteCost?: number;
    readonly longContextInputCost?: number;
    readonly longContextOutputCost?: number;
    readonly longContextCacheCost?: number;
    readonly longContextCacheWriteCost?: number;
    readonly priceCategory?: string;
    readonly maxInputTokens?: number;
    readonly maxOutputTokens?: number;
    readonly capabilities?: {
        readonly vision?: boolean;
        readonly toolCalling?: boolean;
    };
}
export interface IChatSessionProviderOptionItem {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly detail?: string;
    readonly locked?: boolean;
    readonly icon?: ThemeIcon;
    readonly default?: boolean;
    readonly slashCommand?: string;
    readonly tooltip?: string;
    readonly modelMetadata?: IChatSessionProviderOptionModelMetadata;
}
export interface IChatSessionProviderOptionGroupCommand {
    readonly command: string;
    readonly title: string;
    readonly tooltip?: string;
    readonly arguments?: readonly unknown[];
}
export interface IChatSessionProviderOptionGroup {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly detail?: string;
    readonly selected?: IChatSessionProviderOptionItem;
    readonly items: readonly IChatSessionProviderOptionItem[];
    /**
     * A context key expression that controls visibility of this option group picker.
     * When specified, the picker is only visible when the expression evaluates to true.
     * The expression can reference other option group values via `chatSessionOption.<groupId>`.
     * Example: `"chatSessionOption.models == 'gpt-4'"`
     */
    readonly when?: string;
    readonly icon?: ThemeIcon;
    /**
     * Custom commands to show in the option group's picker UI.
     * These will be shown in a separate section at the end of the picker.
     */
    readonly commands?: readonly IChatSessionProviderOptionGroupCommand[];
    /**
     * Optional kind hint that controls how the group is presented.
     * - `'permissions'`: the group's items are surfaced inside the chat permission picker
     *   instead of being rendered as a standalone picker. At most one group per provider
     *   may use this kind; if multiple are declared, the first one (in declaration order)
     *   wins. The group has no UI of its own — it is invisible when the permission
     *   picker is hidden by its own `when` clauses.
     */
    readonly kind?: "permissions";
}
export interface IChatSessionsExtensionPoint {
    readonly type: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly when?: string;
    readonly icon?: string | {
        light: string;
        dark: string;
    };
    readonly order?: number;
    readonly alternativeIds?: string[];
    readonly welcomeTitle?: string;
    readonly welcomeMessage?: string;
    readonly welcomeTips?: string;
    readonly inputPlaceholder?: string;
    readonly capabilities?: IChatAgentAttachmentCapabilities;
    readonly commands?: IChatSessionCommandContribution[];
    readonly canDelegate?: boolean;
    readonly isReadOnly?: boolean;
    /**
     * When set, the chat session will show a filtered mode picker with custom agents
     * that have a matching `target` property. This enables contributed chat sessions
     * to reuse the standard agent/mode dropdown with filtered custom agents.
     * Custom agents without a `target` property are also shown in all filtered lists
     */
    readonly customAgentTarget?: Target;
    readonly requiresCustomModels?: boolean;
    /**
     * Whether this session type supports the synthetic "Auto" model fallback.
     * Defaults to true. When false and no models are available, the picker
     * shows a "No models available" state instead of "Auto".
     *
     * This is distinct from {@link requiresCustomModels}, which only controls
     * whether the picker is filtered to the session's own model pool — a
     * session can own a custom pool yet still support Auto (e.g. the Copilot
     * CLI agent host).
     */
    readonly supportsAutoModel?: boolean;
    /**
     * Logical Agent Host provider ID for Agent Host-backed chat sessions.
     * For example, both local `agent-host-copilotcli` and remote
     * `remote-{authority}-copilotcli` sessions use `copilotcli`.
     */
    readonly agentHostProviderId?: string;
    /**
     * Whether this type needs a GitHub Copilot account and so is unusable until the user signs in. Set by
     * Copilot-backed types (Copilot CLI / agent host, cloud agent) where BYOK isn't supported. Defaults to false, so
     * third-party types that don't depend on Copilot stay usable while signed out.
     */
    readonly requiresCopilotSignIn?: boolean;
    /**
     * When false, the delegation picker is hidden for this session type.
     * Defaults to true.
     */
    readonly supportsDelegation?: boolean;
    /**
     * Decides whether to automatically attach instruction files to chat requests
     * for this session type. Defaults to false when not specified.
     */
    readonly autoAttachReferences?: boolean;
}
export interface IChatSessionItem {
    readonly resource: URI;
    readonly label: string;
    readonly iconPath?: ThemeIcon;
    readonly badge?: string | IMarkdownString;
    readonly description?: string | IMarkdownString;
    readonly status?: ChatSessionStatus;
    readonly tooltip?: string | IMarkdownString;
    readonly timing: IChatSessionTiming;
    readonly changes?: {
        readonly files: number;
        readonly insertions: number;
        readonly deletions: number;
    } | readonly IChatSessionFileChange[] | readonly IChatSessionFileChange2[];
    readonly archived?: boolean;
    readonly metadata?: IChatSessionItemMetadata;
    /**
     * Resource identifier the item was previously known by. When set, host-stored
     * per-resource state (archive, pin, read) recorded under that URI is adopted
     * forward onto {@link resource} on first state read, and the legacy entry is
     * removed. Scheme must match {@link resource}'s scheme; otherwise ignored.
     */
    readonly legacyResource?: URI;
}
export interface IChatSessionItemMetadata {
    readonly repositoryPath?: string;
    readonly workingDirectoryPath?: string;
    readonly firstCheckpointRef?: string;
    readonly lastCheckpointRef?: string;
    readonly worktreePath?: string;
    readonly uncommittedChanges?: number;
    readonly baseRefOid?: string;
    readonly headRefOid?: string;
    readonly branchName?: string;
    readonly branch?: string;
    readonly baseBranchName?: string;
    readonly baseBranch?: string;
    readonly baseBranchProtected?: boolean;
    readonly hasGitHubRemote?: boolean;
    readonly upstreamBranchName?: string;
    readonly incomingChanges?: number;
    readonly outgoingChanges?: number;
    readonly [key: string]: unknown;
}
export interface IChatSessionFileChange {
    readonly modifiedUri: URI;
    readonly originalUri?: URI;
    readonly insertions: number;
    readonly deletions: number;
    readonly reviewed?: boolean;
}
export interface IChatSessionFileChange2 {
    readonly uri: URI;
    readonly originalUri?: URI;
    readonly modifiedUri?: URI;
    readonly insertions: number;
    readonly deletions: number;
    readonly reviewed?: boolean;
}
export type IChatSessionHistoryItem = {
    id?: string;
    type: "request";
    prompt: string;
    participant: string;
    command?: string;
    variableData?: IChatRequestVariableData;
    modelId?: string;
    modeInstructions?: IChatRequestModeInstructions;
    isSystemInitiated?: boolean;
    systemInitiatedLabel?: string;
} | {
    type: "response";
    parts: IChatProgress[];
    participant: string;
    details?: string;
    /**
     * Error details for a failed response. Rendered as a proper chat error
     * (including the quota-exceeded upgrade affordance), mirroring the live
     * agent result's `errorDetails`.
     */
    errorDetails?: IChatResponseErrorDetails;
};
export type IChatSessionRequestHistoryItem = Extract<IChatSessionHistoryItem, {
    type: "request";
}>;
export interface IChatSessionServerRequest {
    readonly prompt: string;
    readonly variableData?: IChatRequestVariableData;
    readonly isSystemInitiated?: boolean;
    readonly systemInitiatedLabel?: string;
}
/**
 * A set of well-known session types
 */
export declare namespace SessionType {
    const CopilotCLI = "copilotcli";
    const CopilotCloud = "copilot-cloud-agent";
    const Local = "local";
    const ClaudeCode = "claude-code";
    const Codex = "openai-codex";
    const Growth = "copilot-growth";
    const AgentHostCopilot = "agent-host-copilotcli";
    const AgentHostClaude = "agent-host-claude";
    const AgentHostCodex = "agent-host-codex";
}
/**
 * Returns whether the given session type is a local agent host target.
 */
export declare function isLocalAgentHostTarget(target: string): boolean;
/**
 * Returns whether the given session type is a remote agent host target.
 *
 * Note: The `remote-` prefix convention is established by
 * `RemoteAgentHostContribution` which generates session types as
 * `remote-{sanitizedAddress}-{provider}`. If future remote providers that
 * are NOT agent hosts need a different prefix, this function must be updated.
 */
export declare function isRemoteAgentHostTarget(target: string): boolean;
/**
 * Returns whether the given session type is an agent host target.
 * Matches the local agent host (`agent-host-*`) and remote agent hosts (`remote-*`).
 */
export declare function isAgentHostTarget(target: string): boolean;
/**
 * The session type used for local agent chat sessions.
 */
export declare const localChatSessionType = "local";
export interface IChatSession extends IDisposable {
    readonly onWillDispose: Event<void>;
    readonly sessionResource: URI;
    readonly title?: string;
    readonly history: readonly IChatSessionHistoryItem[];
    readonly options?: ReadonlyChatSessionOptionsMap;
    readonly progressObs?: IObservable<IChatProgress[]>;
    readonly isCompleteObs?: IObservable<boolean>;
    readonly interruptActiveResponseCallback?: () => Promise<boolean>;
    /**
     * Event fired when the server initiates a new request (e.g. from a consumed
     * queued message). The consumer should create a new request+response pair in
     * the model and prepare to receive progress via {@link progressObs}.
     */
    readonly onDidStartServerRequest?: Event<IChatSessionServerRequest>;
    /**
     * Editing session transferred from a previously-untitled chat session in `onDidCommitChatSessionItem`.
     */
    transferredState?: {
        readonly editingSession: IChatEditingSession | undefined;
        readonly inputState: ISerializableChatModelInputState | undefined;
    };
    requestHandler?: (request: IChatAgentRequest, progress: (progress: IChatProgress[]) => void, history: any[], // TODO: Nail down types
    token: CancellationToken) => Promise<void>;
    /**
     * Forks the session from the given request point.
     * @param request The request history item to fork from, or undefined to fork from the end.
     * @param token Cancellation token.
     * @returns The forked session item. The promise is rejected if forking fails.
     */
    forkSession?: (request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken) => Promise<IChatSessionItem>;
    /**
     * Renames the session.
     * @param title The new title for the session.
     * @param token Cancellation token.
     * @returns A promise that resolves once the rename has been dispatched. The promise is rejected if renaming fails.
     */
    renameSession?: (title: string, token: CancellationToken) => Promise<void>;
}
export interface IChatSessionContentProvider {
    provideChatSessionContent(sessionResource: URI, token: CancellationToken): Promise<IChatSession>;
    /** Resolves a parsed response Markdown URI before it is sanitized and rendered. */
    resolveChatResponseUri?(sessionResource: URI, href: string, kind: "link" | "image"): string;
    /**
     * Optional. Compute completion items for an input being composed in this
     * session. Returning `undefined` lets the workbench fall back to its
     * default in-process completion providers.
     */
    provideChatInputCompletions?(sessionResource: URI, params: IChatInputCompletionsParams, token: CancellationToken): Promise<IChatInputCompletionsResult | undefined>;
    /**
     * Optional. Trigger characters that, when typed in the chat input,
     * SHOULD cause the workbench to issue a `provideChatInputCompletions`
     * request. Used to register a Monaco completion provider scoped to
     * sessions handled by this content provider.
     */
    provideChatInputCompletionTriggerCharacters?(): Promise<readonly string[]>;
}
/**
 * Inputs for {@link IChatSessionContentProvider.provideChatInputCompletions}
 * and {@link IChatSessionsService.provideChatInputCompletions}.
 */
export interface IChatInputCompletionsParams {
    /**
     * The complete text of the input being completed (e.g. the user message
     * the user is currently composing).
     */
    readonly text: string;
    /**
     * The character offset within {@link text} at which the completion is
     * requested, measured in UTF-16 code units. MUST satisfy
     * `0 <= offset <= text.length`.
     */
    readonly offset: number;
}
/**
 * A neutral completion-item shape returned by
 * {@link IChatSessionContentProvider.provideChatInputCompletions}. The
 * workbench-side completion glue maps these into Monaco completion items
 * and the corresponding chat-input attachment.
 */
export interface IChatInputCompletionItem {
    /** Text inserted into the input when this item is accepted. */
    readonly insertText: string;
    /**
     * Half-open range `[start, end)` in the *current* input text that
     * {@link insertText} replaces. Positions use 1-based `lineNumber` and
     * `column` to match Monaco. When omitted, the workbench replaces the
     * word at the cursor.
     */
    readonly start?: IPosition;
    readonly end?: IPosition;
    /** Attachment associated with the item. */
    readonly attachment: IChatInputCompletionResourceAttachment | IChatInputCompletionCommandAttachment | IChatInputCompletionSkillAttachment;
}
/**
 * Resource attachment associated with a completion item. The workbench
 * adds it to the input's variable model when the item is accepted.
 */
export interface IChatInputCompletionResourceAttachment {
    readonly kind: "resource";
    readonly uri: URI;
    readonly displayName?: string;
    readonly isDirectory?: boolean;
    /**
     * Implementation-defined metadata that MUST be preserved by the
     * workbench when the accepted completion is sent back as part of a
     * user message attachment.
     */
    readonly _meta?: Record<string, unknown>;
}
/**
 * Command attachment associated with a completion item.
 */
export interface IChatInputCompletionCommandAttachment {
    readonly kind: "command";
    readonly command: string;
    readonly description: string;
    /**
     * Implementation-defined metadata that MUST be preserved by the
     * workbench when the accepted completion is sent back as part of a
     * user message attachment.
     */
    readonly _meta?: Record<string, unknown>;
}
/**
 * Skill attachment associated with a completion item. The workbench
 * adds it to the input's variable model when the item is accepted.
 */
export interface IChatInputCompletionSkillAttachment {
    readonly kind: "skill";
    readonly uri: URI;
    readonly displayName?: string;
    readonly description?: string;
    /**
     * Implementation-defined metadata that MUST be preserved by the
     * workbench when the accepted completion is sent back as part of a
     * user message attachment.
     */
    readonly _meta?: Record<string, unknown>;
}
/**
 * Result of {@link IChatSessionContentProvider.provideChatInputCompletions}.
 */
export interface IChatInputCompletionsResult {
    readonly items: readonly IChatInputCompletionItem[];
}
export interface IChatNewSessionRequest {
    readonly prompt: string;
    readonly command?: string;
    readonly initialSessionOptions?: ReadonlyChatSessionOptionsMap;
    /**
     * The chat-input session resource the user was typing into when this
     * request was issued. Set when the chat infrastructure is rewriting an
     * untitled session URI to a real one on first send. Controllers can use
     * this to bridge any pre-creation state they tracked under the old URI
     * (e.g. provisional agent-host sessions) to the new resource that the
     * controller returns.
     */
    readonly untitledResource?: URI;
}
export interface IChatSessionItemsDelta {
    readonly addedOrUpdated?: readonly IChatSessionItem[];
    readonly removed?: readonly URI[];
}
export interface IChatSessionItemController {
    readonly onDidChangeChatSessionItems: Event<IChatSessionItemsDelta>;
    get items(): readonly IChatSessionItem[];
    refresh(token: CancellationToken): Promise<void>;
    newChatSessionItem?(request: IChatNewSessionRequest, token: CancellationToken): Promise<IChatSessionItem | undefined>;
    getNewChatSessionInputState?(sessionResource: URI, token: CancellationToken): Promise<readonly IChatSessionProviderOptionGroup[] | undefined>;
    resolveChatSessionItem?(resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined>;
    /**
     * Permanently delete the session identified by `resource`. Implementations should tear down any backend state for
     * the session. The controller is expected to fire an `onDidChangeChatSessionItems` event with the removed resource
     * as a result of the deletion.
     */
    deleteChatSessionItem?(resource: URI, token: CancellationToken): Promise<void>;
}
export interface IChatSessionOptionsChangeEvent {
    readonly sessionResource: URI;
    readonly updates: ReadonlyMap<string, string | IChatSessionProviderOptionItem | undefined>;
}
export type ResolvedChatSessionsExtensionPoint = Omit<IChatSessionsExtensionPoint, "icon"> & {
    readonly icon: ThemeIcon | URI | undefined;
};
/**
 * Session options as key-value pairs.
 *
 * Keys correspond to option group IDs (e.g., 'models', 'subagents') and values are either the selected option item IDs (string) or full option items (for locked state).
 */
export type ChatSessionOptionsMap = Map<string, string | IChatSessionProviderOptionItem>;
export declare namespace ChatSessionOptionsMap {
    function fromRecord(obj: {
        [key: string]: string | IChatSessionProviderOptionItem;
    }): ChatSessionOptionsMap;
    function toRecord(map: ReadonlyChatSessionOptionsMap): Record<string, string | IChatSessionProviderOptionItem>;
    function toStrValueArray(map: ReadonlyChatSessionOptionsMap | undefined): Array<{
        optionId: string;
        value: string;
    }> | undefined;
}
/**
 * Readonly version of {@link ChatSessionOptionsMap}
 */
export type ReadonlyChatSessionOptionsMap = ReadonlyMap<string, string | IChatSessionProviderOptionItem>;
export interface IChatSessionCustomizationItem {
    readonly label: string;
    readonly description?: string;
    readonly uri: URI;
    readonly storageLocation: number;
    readonly icon?: ThemeIcon;
}
export interface IChatSessionCustomizationItemGroup {
    readonly id: string;
    readonly items: IChatSessionCustomizationItem[];
    readonly commands?: readonly {
        readonly id: string;
        readonly title: string;
        readonly arguments?: readonly unknown[];
    }[];
    readonly itemCommands?: readonly {
        readonly id: string;
        readonly title: string;
        readonly arguments?: readonly unknown[];
    }[];
}
export interface IChatSessionCustomizationsProvider {
    readonly onDidChangeCustomizations: Event<void>;
    provideCustomizations(token: CancellationToken): Promise<IChatSessionCustomizationItemGroup[] | undefined>;
}
export interface IChatSessionCommitEvent {
    /** The original (untitled) session resource. */
    readonly original: URI;
    /** The committed (real) session resource. */
    readonly committed: URI;
}
export declare function isSessionInProgressStatus(state: ChatSessionStatus): boolean;
export declare function isIChatSessionFileChange2(obj: unknown): obj is IChatSessionFileChange2;
