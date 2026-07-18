import { URI as ResourceURI } from "../../../../base/common/uri.js";
import { IProductService } from "../../../product/common/productService.service.js";
import { TerminalState, ToolResultFileEditContent, type ActiveTurn, type ChangesetState, type ChatState, type ChatSummary, type ChatInputRequest, type PendingMessage, type Turn, type AnnotationsState, type URI as ProtocolURI, type RootState, type SessionState, type SessionSummary, type TextRange, type ToolCallCancelledState, type ToolCallCompletedState, type ToolCallResult, type ToolCallState, type ToolResultContent, type ToolResultSubagentContent, type UsageInfo, type Message } from "./protocol/state.js";
export { ChangesetOperationScope, ChangesetOperationStatus, ChangesetStatus, CustomizationLoadStatus, CustomizationType, MessageAttachmentKind, MessageKind, PendingMessageKind, PolicyState, ResponsePartKind, ChatInputAnswerState as SessionInputAnswerState, ChatInputAnswerValueKind as SessionInputAnswerValueKind, ChatInputQuestionKind as SessionInputQuestionKind, ChatInputResponseKind as SessionInputResponseKind, ChatOriginKind, SessionLifecycle, SessionStatus, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallContributorKind, ToolCallStatus, ToolResultContentType, TurnState, type ActiveTurn, type AgentCustomization, type AgentCapabilities, type AgentInfo, type AgentSelection, type Annotation, type AnnotationEntry, type AnnotationsState, type AnnotationsSummary, type Changeset, type ChangesetFile, type ChangesetOperation, type ChangesetState, type ChatState, type ChatSummary, type ChatInteractivity, type ChatOrigin, type ChildCustomization, type ClientPluginCustomization, type ConfigPropertySchema, type ConfigSchema, type ContentRef, type Customization, type CustomizationDegradedState, type CustomizationErrorState, type CustomizationLoadedState, type CustomizationLoadingState, type CustomizationLoadState, type DirectoryCustomization, type ErrorInfo, type HookCustomization, type FileEdit as ISessionFileDiff, type ToolResultEmbeddedResourceContent as IToolResultBinaryContent, type MarkdownResponsePart, type McpServerCustomization, type MessageAttachment, type MessageResourceAttachment, type MessageEmbeddedResourceAttachment, type MessageAnnotationsAttachment, type ModelSelection, type PendingMessage, type PluginCustomization, type ProjectInfo, type PromptCustomization, type ReasoningResponsePart, type ResponsePart, type RootState, type RuleCustomization, type SessionActiveClient, type SessionConfigState, type ChatInputAnswer as SessionInputAnswer, type ChatInputOption as SessionInputOption, type ChatInputQuestion as SessionInputQuestion, type ChatInputRequest as SessionInputRequest, type SessionModelInfo, type SessionState, type SessionSummary, type SkillCustomization, type Snapshot, type StringOrMarkdown, type TerminalState, type TextRange, type ToolAnnotations, type ToolCallCancelledState, type ToolCallCompletedState, type ToolCallPendingConfirmationState, type ToolCallPendingResultConfirmationState, type ToolCallResponsePart, type ToolCallResult, type ToolCallRunningState, type ToolCallState, type ToolCallStreamingState, type ToolCallContributor, type ToolDefinition, type ToolResultContent, type ToolResultFileEditContent, type ToolResultShellExitContent, type ToolResultSubagentContent, type ToolResultTextContent, type Turn, type URI, type UsageInfo, type Message } from "./protocol/state.js";
/**
 * Well-known keys that may appear on {@link UsageInfo._meta}.
 * Clients MAY read these to provide enhanced UI (e.g. credit cost display).
 */
export interface UsageInfoMeta {
    /** Per-turn credit cost reported by the backend. */
    cost?: number;
    /** Copilot-specific usage breakdown, including nano-AIU totals. */
    copilotUsage?: {
        totalNanoAiu?: number;
        [key: string]: unknown;
    };
    /**
     * Per-category account quota snapshots reported by the backend on the
     * model-call usage event, keyed by quota type (e.g. `chat`,
     * `premium_interactions`). Clients MAY use these to keep the account quota
     * UI current without a separate quota fetch.
     */
    quotaSnapshots?: {
        [quotaType: string]: {
            readonly isUnlimitedEntitlement?: boolean;
            readonly entitlementRequests?: number;
            readonly usedRequests?: number;
            readonly remainingPercentage?: number;
            readonly overage?: number;
            readonly overageAllowedWithExhaustedQuota?: boolean;
            /** ISO 8601 date when the quota resets, if applicable. */
            readonly resetDate?: string;
        } | undefined;
    };
    [key: string]: unknown;
}
/**
 * Reads the well-known {@link UsageInfoMeta} keys from a usage report's open
 * `_meta` bag, ignoring unrelated provider-specific keys and validating each
 * field's type. Always read {@link UsageInfo._meta} through this helper rather
 * than casting the bag to {@link UsageInfoMeta}, so a malformed or partial bag
 * degrades to absent fields instead of producing values of the wrong runtime
 * type. Returns an empty object when the bag is absent.
 */
export declare function readUsageInfoMeta(usage: UsageInfo | undefined): UsageInfoMeta;
export { ChangesetOperationTargetKind, type ChangesetOperationFollowUp, type ChangesetOperationTarget } from "./protocol/commands.js";
export { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, type ChatInputAnswer, type ChatInputOption, type ChatInputQuestion, type ChatInputRequest, } from "./protocol/state.js";
/**
 * The kind of file edit operation. Derived from the presence/absence of
 * `before`/`after` in {@link ToolResultFileEditContent}.
 */
export declare enum FileEditKind {
    /** Content edit (same file URI, different content). */
    Edit = "edit",
    /** File creation (no before state). */
    Create = "create",
    /** File deletion (no after state). */
    Delete = "delete",
    /** File rename/move (different before and after URIs). */
    Rename = "rename"
}
/** URI for the root state subscription. */
export declare const ROOT_STATE_URI = "ahp-root://";
/** Scheme used by {@link ROOT_STATE_URI}. */
export declare const AHP_ROOT_SCHEME = "ahp-root";
/** Scheme used by resource-watch channel URIs (`ahp-resource-watch:/<encoded>`). */
export declare const AHP_RESOURCE_WATCH_SCHEME = "ahp-resource-watch";
/**
 * Encode a resource-watch descriptor into its canonical channel URI. The
 * descriptor is serialised into the URI path so the receiver can recover
 * the watch parameters without any server-side bookkeeping — subscribe is
 * the only point where state is materialised (an `IFileService` watcher
 * is attached on the first subscriber and held through a grace window
 * after the last drops).
 */
export declare function buildResourceWatchChannelUri(descriptor: {
    readonly root: string;
    readonly recursive?: boolean;
    readonly excludes?: {
        items: readonly string[];
    };
    readonly includes?: {
        items: readonly string[];
    };
}): string;
/**
 * Inverse of {@link buildResourceWatchChannelUri}. Returns `undefined` if
 * `uri` is not a well-formed `ahp-resource-watch:` URI — callers should
 * surface that as a not-found error to the client.
 */
export declare function parseResourceWatchChannelUri(uri: string): {
    root: string;
    recursive: boolean;
    excludes?: {
        items: string[];
    };
    includes?: {
        items: string[];
    };
} | undefined;
/** Returns `true` when `uri` identifies a resource-watch channel. */
export declare function isAhpResourceWatchChannel(uri: string): boolean;
/**
 * Returns `true` when `uri` identifies the root channel, regardless of
 * whether the caller passes the canonical wire form (`'ahp-root://'`) or a
 * variant that has been round-tripped through the workbench {@link URI} class
 * (which normalizes the authority-less form to `'ahp-root:'`). Always prefer
 * this helper over a direct `=== ROOT_STATE_URI` comparison so the two
 * spellings stay interchangeable.
 */
export declare function isAhpRootChannel(uri: string): boolean;
/**
 * Mints a session-unique opaque id for a customization, derived from its
 * source URI and (when present) its `range` within the source. Plugins MAY
 * declare multiple children (e.g. MCP servers, hooks) inside the same
 * manifest file; including the range disambiguates them without an extra
 * mapping table.
 *
 * The range is appended as a reserved `#range=` query-style suffix; any
 * existing `#` in the URI is percent-encoded first so a source URI that
 * already contains a fragment cannot collide with a ranged id.
 */
export declare function customizationId(uri: string, range?: TextRange): string;
/**
 * A tool call in a terminal state, stored in completed turns.
 */
export type ICompletedToolCall = ToolCallCompletedState | ToolCallCancelledState;
/**
 * Derived status type for the tool call lifecycle.
 */
export type ToolCallStatusString = ToolCallState["status"];
/**
 * Extracts a plain-text tool output string from a tool call result's `content`
 * array. Joins all text-type content parts into a single string.
 *
 * Returns `undefined` if there are no text content parts.
 */
export declare function getToolOutputText(result: ToolCallResult): string | undefined;
/**
 * Extracts file edit content entries from a tool call result's `content` array.
 * Returns an empty array if there are no file edit content parts.
 */
export declare function getToolFileEdits(result: ToolCallResult): ToolResultFileEditContent[];
/**
 * Extracts the first subagent content entry from a tool call's `content` array.
 * Works with both completed tool call results and running tool call states.
 * Returns `undefined` if there are no subagent content parts.
 */
export declare function getToolSubagentContent(result: {
    content?: readonly ToolResultContent[];
}): ToolResultSubagentContent | undefined;
/**
 * Builds a subagent session URI from a parent session URI and tool call ID.
 * Convention: `{parentSessionUri}/subagent/{toolCallId}`
 */
export declare function buildSubagentSessionUri(parentSession: ProtocolURI | ResourceURI, toolCallId: string): string;
/**
 * Parses a subagent session URI into its parent session URI and tool call ID.
 * Returns `undefined` if the URI does not follow the subagent convention.
 */
export declare function parseSubagentSessionUri(uri: ProtocolURI | ResourceURI): {
    parentSession: ResourceURI;
    toolCallId: string;
} | undefined;
/**
 * Returns whether a session URI represents a subagent session.
 */
export declare function isSubagentSession(uri: ProtocolURI | ResourceURI): boolean;
/**
 * Builds the string prefix used by the state manager for cached subagent sessions.
 */
export declare function buildSubagentSessionUriPrefix(parentSession: ProtocolURI | ResourceURI): string;
export declare function createRootState(): RootState;
/**
 * Creates the initial flat {@link SessionState} for a session from its
 * root-channel {@link SessionSummary} catalog entry. Session metadata
 * ({@link SessionMetadata}) — and the shared `_meta` bag — are inlined directly
 * onto the state.
 */
export declare function createSessionState(summary: SessionSummary): SessionState;
/**
 * Creates an empty {@link ChatState} for a chat. The summary fields are
 * denormalized onto the chat state per the protocol contract; callers pass
 * the chat's catalog summary and this seeds an empty conversation.
 */
export declare function createChatState(summary: ChatSummary): ChatState;
/**
 * Derives the default-chat {@link ChatSummary} for a session from its
 * {@link SessionSummary}. The default chat inherits the session's title,
 * status, activity and working directory, and is marked as a
 * {@link ChatOriginKind.User | user-originated} chat. Both the session and
 * chat `modifiedAt` are ISO-8601 strings, so it is carried over directly.
 */
export declare function createDefaultChatSummary(session: SessionSummary, chatUri: ProtocolURI): ChatSummary;
/**
 * Derives a {@link ChatSummary} from a fully-populated {@link ChatState} by
 * projecting out the denormalized summary fields. Used to keep the parent
 * session's `chats` catalog in sync with a chat's denormalized state.
 */
export declare function chatSummaryFromState(state: ChatState): ChatSummary;
export declare function createActiveTurn(id: string, message: Message): ActiveTurn;
export declare enum StateComponents {
    Root = 0,
    Session = 1,
    Chat = 2,
    Terminal = 3,
    Changeset = 4,
    Annotations = 5
}
export type ComponentToState = {
    [StateComponents.Root]: RootState;
    [StateComponents.Session]: SessionState;
    [StateComponents.Chat]: ChatState;
    [StateComponents.Terminal]: TerminalState;
    [StateComponents.Changeset]: ChangesetState;
    [StateComponents.Annotations]: AnnotationsState;
};
/** Scheme used by chat channel URIs (`ahp-chat://...`). */
export declare const AHP_CHAT_SCHEME = "ahp-chat";
/** Chat id of the default chat that every session owns. */
export declare const DEFAULT_CHAT_ID = "default";
/**
 * Derives the deterministic channel URI for a chat within a session. Every chat
 * — the default chat and any additional peer chats — encodes its owning session
 * URI into the path so producers and consumers can recover the session without a
 * lookup table (see {@link parseChatUri}). The chat id is carried in the URI
 * authority.
 *
 * `ahp-chat://<chatId>/<base64(sessionUri)>`
 */
export declare function buildChatUri(sessionUri: ProtocolURI | ResourceURI, chatId: string): string;
/**
 * Derives the deterministic default-chat channel URI for a session. While the
 * protocol allows a session to contain many chats, every session always owns a
 * default chat whose URI is derived from the owning session URI so producers and
 * consumers can compute it without a lookup table.
 *
 * The session URI is encoded into the path so {@link parseChatUri} can recover
 * it.
 */
export declare function buildDefaultChatUri(sessionUri: ProtocolURI | ResourceURI): string;
export declare function isSubagentChatUri(uri: ProtocolURI | ResourceURI): boolean;
export declare function buildSubagentChatUri(sessionUri: ProtocolURI | ResourceURI, toolCallId: string): string;
/**
 * Inverse of {@link buildChatUri}: recovers the owning session URI and chat id
 * from any chat channel URI. Returns `undefined` when `uri` is not a well-formed
 * chat URI.
 */
export declare function parseChatUri(uri: ProtocolURI | ResourceURI): {
    session: string;
    chatId: string;
} | undefined;
/**
 * Inverse of {@link buildDefaultChatUri}: recovers the owning session URI from a
 * chat channel URI. Returns `undefined` when `uri` is not a well-formed chat URI.
 * Accepts any chat URI (default or additional) so callers that only need the
 * parent session can use it uniformly.
 */
export declare function parseDefaultChatUri(uri: ProtocolURI | ResourceURI): string | undefined;
export declare function parseRequiredSessionUriFromChatUri(uri: ProtocolURI | ResourceURI): string;
/** Returns `true` when `uri` is the default chat of its session. */
export declare function isDefaultChatUri(uri: ProtocolURI | ResourceURI): boolean;
/**
 * Resolves a feature-level `(session, chat)` pair to the single chat URI used by
 * the agent session/chat surface. A session always owns a DEFAULT chat addressed
 * by the session URI itself; additional (peer) chats are addressed by their own
 * chat channel URIs. This is the one place default-chat resolution lives so
 * agents never re-derive "is this the default chat?".
 */
export declare function resolveChatUri(session: ResourceURI, chat: ResourceURI): ResourceURI;
/** Returns `true` when `uri` identifies a chat channel. */
export declare function isAhpChatChannel(uri: string): boolean;
/**
 * A single chat's effective session context: the shared {@link SessionState}
 * (working directory, active clients, config, customizations/MCP scope, …)
 * resolved for one chat and merged with that chat's conversation contents.
 *
 * The protocol moved turns and pending/input state off the session and onto a
 * per-chat channel, and lets a chat override session defaults (e.g.
 * {@link ChatState.workingDirectory}). This composite recombines the session
 * with one of its chats — default or peer — so consumers read the chat's
 * effective context and conversation through one object without walking back to
 * the session to re-derive shared state. The inherited
 * {@link SessionState.workingDirectory} carries the chat's *effective* working
 * directory (its own override when present, else the session default).
 */
export interface ISessionWithDefaultChat extends SessionState {
    /** Completed turns of this chat. */
    turns: Turn[];
    /** Currently in-progress turn of this chat. */
    activeTurn?: ActiveTurn;
    /** Steering message pending on this chat. */
    steeringMessage?: PendingMessage;
    /** Queued messages pending on this chat. */
    queuedMessages?: PendingMessage[];
    /** Input requests outstanding on this chat. */
    inputRequests?: ChatInputRequest[];
    /** Draft input of this chat. */
    draft?: Message;
}
/**
 * Projects a {@link SessionState} and one of its {@link ChatState | chats}
 * (default or peer) into that chat's {@link ISessionWithDefaultChat | effective
 * session context}. Per-chat overrides (currently the working directory) are
 * layered over the session defaults, and the conversation fields are taken from
 * the chat. When the chat state is absent (e.g. not yet hydrated) the
 * conversation fields default to empty and the session defaults apply.
 */
export declare function mergeSessionWithDefaultChat(session: SessionState, chat: ChatState | undefined): ISessionWithDefaultChat;
/**
 * Resolves the active turn of a session's default chat, if any.
 */
export declare function getActiveTurn(chat: ChatState | undefined): ActiveTurn | undefined;
/**
 * Resolves the default chat's catalog summary from a session, if present.
 */
export declare function getDefaultChat(session: SessionState): ChatSummary | undefined;
/**
 * VS Code-side alias for the protocol's open `_meta` property bag on
 * {@link SessionState}. Keys SHOULD be namespaced (e.g. `git`, `vscode.foo`)
 * to avoid collisions; values MUST be JSON-serializable.
 */
export type SessionMeta = Record<string, unknown>;
/**
 * VS Code-side alias for the protocol's open `_meta` property bag on
 * {@link SessionSummary}. Keys SHOULD be namespaced (e.g. `git`, `vscode.foo`)
 * to avoid collisions; values MUST be JSON-serializable.
 */
export type SessionSummaryMeta = Record<string, unknown>;
/**
 * Reserved key under {@link SessionMeta} for the well-known git-state
 * payload. Value at this key, when present, MUST be shaped like
 * {@link ISessionGitState}. This is a VS Code-specific convention layered
 * on top of the protocol's generic `_meta` bag — the protocol itself does
 * not know about git state.
 */
export declare const SESSION_META_GIT_KEY = "git";
/**
 * Reserved key under {@link SessionMeta} for the well-known GitHub-state
 * payload. Value at this key, when present, MUST be shaped like
 * {@link ISessionGitHubState}. This is a VS Code-specific convention layered
 * on top of the protocol's generic `_meta` bag — the protocol itself does
 * not know about GitHub state.
 */
export declare const SESSION_META_GITHUB_KEY = "github";
/**
 * Git state of a session's working directory, carried under
 * {@link SessionMeta} at {@link SESSION_META_GIT_KEY}. Used by clients to
 * drive source-control affordances (e.g. PR/merge buttons in the Agents
 * app).
 *
 * All fields are optional — agents that do not track a particular field
 * should omit it rather than send a placeholder, so clients can distinguish
 * "unknown" from "known to be zero".
 */
export interface ISessionGitState {
    /** Whether the working directory has a `github.com` git remote. */
    readonly hasGitHubRemote?: boolean;
    /** Current branch name. */
    readonly branchName?: string;
    /** Base branch the work targets (e.g. `main`). */
    readonly baseBranchName?: string;
    /** Upstream tracking branch (e.g. `origin/feature`). */
    readonly upstreamBranchName?: string;
    /** Number of commits the upstream branch has ahead of the local branch. */
    readonly incomingChanges?: number;
    /** Number of commits the local branch has ahead of the upstream branch. */
    readonly outgoingChanges?: number;
    /** Number of files with uncommitted changes. */
    readonly uncommittedChanges?: number;
    /** GitHub repository owner parsed from the working copy's GitHub remote (preferring `origin`, falling back to the first GitHub remote). */
    readonly githubOwner?: string;
    /** GitHub repository name parsed from the working copy's GitHub remote (preferring `origin`, falling back to the first GitHub remote). */
    readonly githubRepo?: string;
}
/**
 * GitHub state of a session, carried under {@link SessionMeta} at
 * {@link SESSION_META_GITHUB_KEY}. Used by clients to drive GitHub-specific
 * affordances (e.g. PR/merge buttons in the Agents app).
 *
 * All fields are optional — agents that do not track a particular field
 * should omit it rather than send a placeholder, so clients can distinguish
 * "unknown" from "known to be zero".
 */
export interface ISessionGitHubState {
    /** The owner of the GitHub repository. */
    readonly owner?: string;
    /** The name of the GitHub repository. */
    readonly repo?: string;
    /** The URL of the GitHub pull request. */
    readonly pullRequestUrl?: string;
}
/**
 * Reads the well-known git-state payload from {@link SessionMeta}, if
 * present. Returns `undefined` when the meta bag is absent or the value at
 * the git key is not a plain object (e.g. an array or a primitive).
 * Individual fields with wrong types are silently dropped so partial state
 * still propagates.
 *
 * Unlike the other typed readers, this takes the raw {@link SessionMeta} value
 * rather than its parent {@link SessionState}: the sessions provider stores and
 * reads a detached meta snapshot without retaining the owning state.
 */
export declare function readSessionGitState(meta: SessionMeta | undefined): ISessionGitState | undefined;
/**
 * Returns a new {@link SessionMeta} with the git-state payload set to
 * `gitState`, or with the git slot removed if `gitState` is `undefined`.
 * Returns `undefined` if the result would be empty.
 */
export declare function withSessionGitState(meta: SessionMeta | undefined, gitState: ISessionGitState | undefined): SessionMeta | undefined;
/**
 * Reads the well-known GitHub state payload from {@link SessionSummaryMeta}, if
 * present. Returns `undefined` when the meta bag is absent or the value at the
 * GitHub key is not a plain object (e.g. an array or a primitive).
 * Individual fields with wrong types are silently dropped so partial state
 * still propagates.
 *
 * Unlike the other typed readers, this takes the raw {@link SessionSummaryMeta}
 * value rather than its parent {@link SessionState}: the sessions provider stores and
 * reads a detached meta snapshot without retaining the owning state.
 */
export declare function readSessionGitHubState(meta: SessionSummaryMeta | undefined): ISessionGitHubState | undefined;
/**
 * Returns a new {@link SessionSummaryMeta} with the GitHub-state payload set to
 * `gitHubState`, or with the GitHub slot removed if `gitHubState` is `undefined`.
 * Returns `undefined` if the result would be empty.
 */
export declare function withSessionGitHubState(meta: SessionSummaryMeta | undefined, gitHubState: ISessionGitHubState | undefined): SessionSummaryMeta | undefined;
/**
 * Reserved key under {@link SessionSummaryMeta} marking a session as
 * workspace-less: a session with no workspace/folder binding (surfaced in the
 * UI as a "Quick Chat"). Carried on the summary bag (not the full state) so
 * clients can group/style such sessions in session lists without subscribing to
 * full session state. VS Code-specific convention layered on the protocol's
 * generic `_meta` bag.
 */
export declare const SESSION_META_WORKSPACELESS_KEY = "workspaceless";
/**
 * Session-database metadata key recording whether a session is workspace-less (a
 * workspace-less chat). Owned by the AH service: `AgentService` writes it centrally at
 * create/materialize and overlays it onto every agent's summary `_meta` in
 * `listSessions`; agents only read it (e.g. to pick the workspace-less system prompt
 * on resume) and never persist it themselves.
 */
export declare const AH_META_WORKSPACELESS_DB_KEY = "agentHost.workspaceless";
/**
 * Reads the workspace-less marker from {@link SessionSummaryMeta}. Returns
 * `true` only when the well-known key is present and set to boolean `true`.
 */
export declare function readSessionWorkspaceless(meta: SessionSummaryMeta | undefined): boolean;
/**
 * Returns a new {@link SessionSummaryMeta} with the workspace-less marker set,
 * or with the slot removed when `workspaceless` is `false`. Returns `undefined`
 * if the result would be empty.
 */
export declare function withSessionWorkspaceless(meta: SessionSummaryMeta | undefined, workspaceless: boolean): SessionSummaryMeta | undefined;
/**
 * VS Code-side alias for the protocol's open `_meta` property bag on
 * {@link RootState}. Keys SHOULD be namespaced to avoid collisions; values MUST
 * be JSON-serializable.
 */
export type RootMeta = Record<string, unknown>;
/**
 * Reserved key under {@link RootMeta} for the well-known host-build payload.
 * Value at this key, when present, MUST be shaped like {@link IHostBuildInfo}.
 * This is a VS Code-specific convention layered on top of the protocol's
 * generic `_meta` bag — the protocol itself does not know about build info.
 */
export declare const ROOT_META_HOST_BUILD_KEY = "hostBuild";
/**
 * Build information about the program hosting the agent host (the VS Code CLI),
 * carried under {@link RootMeta} at {@link ROOT_META_HOST_BUILD_KEY}. Lets a
 * client see which build is hosting it — useful when inspecting the output of a
 * remote agent host.
 *
 * All fields except {@link version} are optional — a build that does not track
 * a particular field should omit it.
 */
export interface IHostBuildInfo {
    /** Product version (e.g. `1.96.0`). */
    readonly version: string;
    /** Commit SHA of the build, if known. */
    readonly commit?: string;
    /** Build date (ISO 8601), if known. */
    readonly date?: string;
    /** Release quality (e.g. `stable`, `insider`), if known. */
    readonly quality?: string;
}
/**
 * Derives {@link IHostBuildInfo} from the host's {@link IProductService}.
 */
export declare function hostBuildInfoFromProduct(productService: IProductService): IHostBuildInfo;
/**
 * Reads the well-known host-build payload from {@link RootMeta}, if present.
 * Returns `undefined` when the meta bag is absent or the value at the host-build
 * key is not a plain object with a string `version`. Optional fields with wrong
 * types are silently dropped.
 */
export declare function readHostBuildInfo(state: RootState | undefined): IHostBuildInfo | undefined;
/**
 * Returns a new {@link RootMeta} with the host-build payload set to
 * `buildInfo`, or with the slot removed if `buildInfo` is `undefined`. Returns
 * `undefined` if the result would be empty.
 */
export declare function withHostBuildInfo(meta: RootMeta | undefined, buildInfo: IHostBuildInfo | undefined): RootMeta | undefined;
/**
 * Formats {@link IHostBuildInfo} as a short single-line human-readable string,
 * e.g. `1.96.0 (commit abc1234, 2024-01-02T03:04:05Z, insider)`.
 */
export declare function formatHostBuildInfo(info: IHostBuildInfo): string;
