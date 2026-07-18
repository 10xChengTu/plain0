import { IAction } from "../../../../../base/common/actions.js";
import { DeferredPromise } from "../../../../../base/common/async.js";
import { CancellationToken } from "../../../../../base/common/cancellation.js";
import { IStringDictionary } from "../../../../../base/common/collections.js";
import { Event } from "../../../../../base/common/event.js";
import { IMarkdownString } from "../../../../../base/common/htmlContent.js";
import { IReference } from "../../../../../base/common/lifecycle.js";
import { IObservable, IReader } from "../../../../../base/common/observable.js";
import { ThemeIcon } from "../../../../../base/common/themables.js";
import { URI, UriComponents } from "../../../../../base/common/uri.js";
import { IRange } from "../../../../../editor/common/core/range.js";
import { ISelection } from "../../../../../editor/common/core/selection.js";
import { Command, Location, TextEdit } from "../../../../../editor/common/languages.js";
import { FileType } from "../../../../../platform/files/common/files.js";
import { IAutostartResult } from "../../../mcp/common/mcpTypes.js";
import { ICellEditOperation } from "../../../notebook/common/notebookCommon.js";
import { IWorkspaceSymbol } from "../../../search/common/search.js";
import { IChatRequestVariableEntry } from "../attachments/chatVariableEntries.js";
import { IChatRequestVariableValue } from "../attachments/chatVariables.js";
import { ReadonlyChatSessionOptionsMap } from "../chatSessionsService.js";
import { ChatAgentLocation, ChatModeKind } from "../constants.js";
import { IChatModel, IChatRequestModeInfo, IChatResponseModel } from "../model/chatModel.js";
import { IChatAgentCommand, IChatAgentData, IChatAgentResult, UserSelectedTools } from "../participants/chatAgents.js";
import { HookTypeValue } from "../promptSyntax/hookTypes.js";
import { IChatParserContext } from "../requestParser/chatRequestParser.js";
import { IPreparedToolInvocation, IToolConfirmationMessages, IToolResult, IToolResultInputOutputDetails, ToolDataSource } from "../tools/languageModelToolsService.js";
import { ConfirmationOptionKind } from "../../../../../platform/agentHost/common/state/protocol/state.js";
export interface IChatRequest {
    message: string;
    variables: Record<string, IChatRequestVariableValue[]>;
}
export declare enum ChatErrorLevel {
    Info = 0,
    Warning = 1,
    Error = 2
}
export interface IChatResponseErrorDetailsConfirmationButton {
    data: any;
    label: string;
    isSecondary?: boolean;
}
export interface IChatResponseErrorDetails {
    message: string;
    responseIsIncomplete?: boolean;
    responseIsFiltered?: boolean;
    responseIsRedacted?: boolean;
    isQuotaExceeded?: boolean;
    isRateLimited?: boolean;
    /**
     * If true, the error is an expected operational condition (e.g. user-actionable
     * configuration, network connectivity, missing dependency) and should not be
     * logged as a `chatAgentError` telemetry event.
     */
    isExpectedError?: boolean;
    level?: ChatErrorLevel;
    confirmationButtons?: IChatResponseErrorDetailsConfirmationButton[];
    code?: string;
}
export interface IChatResponseProgressFileTreeData {
    label: string;
    uri: URI;
    type?: FileType;
    children?: IChatResponseProgressFileTreeData[];
}
export type IDocumentContext = {
    uri: URI;
    version: number;
    ranges: IRange[];
};
export declare function isIDocumentContext(obj: unknown): obj is IDocumentContext;
export interface IChatUsedContext {
    documents: IDocumentContext[];
    kind: "usedContext";
}
export declare function isIUsedContext(obj: unknown): obj is IChatUsedContext;
export interface IChatContentVariableReference {
    variableName: string;
    value?: URI | Location;
}
export declare function isChatContentVariableReference(obj: unknown): obj is IChatContentVariableReference;
export declare enum ChatResponseReferencePartStatusKind {
    Complete = 1,
    Partial = 2,
    Omitted = 3
}
export declare enum ChatResponseClearToPreviousToolInvocationReason {
    NoReason = 0,
    FilteredContentRetry = 1,
    CopyrightContentRetry = 2
}
export interface IChatContentReference {
    reference: URI | Location | IChatContentVariableReference | string;
    iconPath?: ThemeIcon | {
        light: URI;
        dark?: URI;
    };
    options?: {
        status?: {
            description: string;
            kind: ChatResponseReferencePartStatusKind;
        };
        diffMeta?: {
            added: number;
            removed: number;
        };
        originalUri?: URI;
        /** Overrides the reference URI when opening the modified side of a diff. */
        modifiedUri?: URI;
        isDeletion?: boolean;
    };
    kind: "reference";
}
export interface IChatCodeCitation {
    value: URI;
    license: string;
    snippet: string;
    kind: "codeCitation";
}
export interface IChatUsagePromptTokenDetail {
    category: string;
    label: string;
    percentageOfPrompt: number;
}
export interface IChatUsage {
    promptTokens: number;
    completionTokens: number;
    outputBuffer?: number;
    promptTokenDetails?: readonly IChatUsagePromptTokenDetail[];
    copilotCredits?: number;
    /**
     * The language-model ID that actually served the request. Set when a
     * meta-model (e.g. "auto") routes to a concrete model so consumers
     * can look up the real model's metadata (context window size, etc.).
     */
    actualModelId?: string;
    kind: "usage";
}
/**
 * Formats a copilot credit value for display.
 */
export declare function formatCopilotCredits(credits: number): string;
export interface IChatContentInlineReference {
    resolveId?: string;
    inlineReference: URI | Location | IWorkspaceSymbol;
    name?: string;
    kind: "inlineReference";
}
export interface IChatMarkdownContent {
    kind: "markdownContent";
    content: IMarkdownString;
    inlineReferences?: Record<string, IChatContentInlineReference>;
}
export interface IChatTreeData {
    treeData: IChatResponseProgressFileTreeData;
    kind: "treeData";
}
export interface IMultiDiffResource {
    originalUri?: URI;
    modifiedUri?: URI;
    goToFileUri?: URI;
    added?: number;
    removed?: number;
}
export interface IChatMultiDiffInnerData {
    title: string;
    resources: IMultiDiffResource[];
}
export interface IChatMultiDiffData {
    multiDiffData: IChatMultiDiffInnerData | IObservable<IChatMultiDiffInnerData>;
    kind: "multiDiffData";
    collapsed?: boolean;
    readOnly?: boolean;
    toJSON(): IChatMultiDiffDataSerialized;
}
export interface IChatMultiDiffDataSerialized {
    multiDiffData: IChatMultiDiffInnerData;
    kind: "multiDiffData";
    collapsed?: boolean;
    readOnly?: boolean;
}
export declare class ChatMultiDiffData implements IChatMultiDiffData {
    readonly kind = "multiDiffData";
    readonly collapsed?: boolean | undefined;
    readonly readOnly?: boolean | undefined;
    readonly multiDiffData: IChatMultiDiffData["multiDiffData"];
    constructor(opts: {
        multiDiffData: IChatMultiDiffInnerData | IObservable<IChatMultiDiffInnerData>;
        collapsed?: boolean;
        readOnly?: boolean;
    });
    toJSON(): IChatMultiDiffDataSerialized;
}
export interface IChatProgressMessage {
    content: IMarkdownString;
    kind: "progressMessage";
    shimmer?: boolean;
}
export interface IChatSystemNotificationPart {
    content: IMarkdownString;
    kind: "systemNotification";
}
export interface IChatTask extends IChatTaskDto {
    deferred: DeferredPromise<string | void>;
    progress: (IChatWarningMessage | IChatContentReference)[];
    readonly onDidAddProgress: Event<IChatWarningMessage | IChatContentReference>;
    add(progress: IChatWarningMessage | IChatContentReference): void;
    complete: (result: string | void) => void;
    task: () => Promise<string | void>;
    isSettled: () => boolean;
    toJSON(): IChatTaskSerialized;
}
export interface IChatUndoStop {
    kind: "undoStop";
    id: string;
}
export interface IChatExternalEditsDto {
    kind: "externalEdits";
    undoStopId: string;
    start: boolean; /** true=start, false=stop */
    resources: UriComponents[];
    /**
     * When present, these URIs are read instead of the `resources` URIs
     * (by-index) when capturing file snapshots. Used by the agent host
     * to provide before/after content from the remote filesystem
     * or from stored snapshots.
     */
    contentFor?: UriComponents[];
}
export interface IChatTaskDto {
    content: IMarkdownString;
    kind: "progressTask";
}
export interface IChatTaskSerialized {
    content: IMarkdownString;
    progress: (IChatWarningMessage | IChatContentReference)[];
    kind: "progressTaskSerialized";
}
export interface IChatTaskResult {
    content: IMarkdownString | void;
    kind: "progressTaskResult";
}
export interface IChatWarningMessage {
    content: IMarkdownString;
    kind: "warning";
}
export interface IChatInfoMessage {
    content: IMarkdownString;
    kind: "info";
}
export interface IChatAgentVulnerabilityDetails {
    title: string;
    description: string;
}
export interface IChatResponseCodeblockUriPart {
    kind: "codeblockUri";
    uri: URI;
    isEdit?: boolean;
    undoStopId?: string;
    subAgentInvocationId?: string;
}
export interface IChatAgentMarkdownContentWithVulnerability {
    content: IMarkdownString;
    vulnerabilities: IChatAgentVulnerabilityDetails[];
    kind: "markdownVuln";
}
export interface IChatCommandButton {
    command: Command;
    kind: "command";
    additionalCommands?: Command[];
}
export interface IChatMoveMessage {
    uri: URI;
    range: IRange;
    kind: "move";
}
export interface IChatTextEdit {
    uri: URI;
    edits: TextEdit[];
    kind: "textEdit";
    done?: boolean;
    isExternalEdit?: boolean;
}
export interface IChatClearToPreviousToolInvocation {
    kind: "clearToPreviousToolInvocation";
    reason: ChatResponseClearToPreviousToolInvocationReason;
}
export interface IChatNotebookEdit {
    uri: URI;
    edits: ICellEditOperation[];
    kind: "notebookEdit";
    done?: boolean;
    isExternalEdit?: boolean;
}
export interface IChatWorkspaceFileEdit {
    oldResource?: URI;
    newResource?: URI;
}
export interface IChatWorkspaceEdit {
    kind: "workspaceEdit";
    edits: IChatWorkspaceFileEdit[];
}
/**
 * The kind of file operation an {@link IChatExternalEdit} represents.
 */
export type ChatExternalEditKind = "create" | "delete" | "rename" | "edit";
/**
 * A summary of a file edit that has been performed externally (i.e. by an
 * agent or tool outside of chat's own editing pipeline). Carries everything
 * needed to render a static "edit pill" without round-tripping through
 * {@link IChatEditingSession} for diff computation: the producer already
 * knows the URIs and diff stats up-front.
 */
export interface IChatExternalEdit {
    kind: "externalEdit";
    /** The resulting file URI (after-URI for create/edit/rename, before-URI for delete). */
    uri: URI;
    /** The kind of file operation. */
    editKind: ChatExternalEditKind;
    /** For renames, the file URI before the operation. */
    originalUri?: URI;
    /** URI from which the "before" content can be read (for diff viewing). Absent for creates. */
    beforeContentUri?: URI;
    /** URI from which the "after" content can be read (for diff viewing). Absent for deletes. */
    afterContentUri?: URI;
    /** Pre-computed diff display metadata. */
    diff?: {
        added: number;
        removed: number;
    };
    /** Optional undo-stop id (typically the tool call id) for grouping. */
    undoStopId?: string;
}
export interface IChatConfirmation {
    title: string;
    message: string | IMarkdownString;
    data: any;
    buttons?: string[];
    isUsed?: boolean;
    kind: "confirmation";
}
/**
 * Validation rules for a question in a question carousel.
 */
export interface IChatQuestionValidation {
    minLength?: number;
    maxLength?: number;
    format?: "email" | "uri" | "date" | "date-time";
    minimum?: number;
    maximum?: number;
    isInteger?: boolean;
}
/**
 * Represents an individual question in a question carousel.
 */
export interface IChatQuestion {
    id: string;
    type: "text" | "singleSelect" | "multiSelect";
    title: string;
    message?: string | IMarkdownString;
    description?: string;
    options?: {
        id: string;
        label: string;
        value: string;
    }[];
    defaultValue?: string | string[];
    allowFreeformInput?: boolean;
    required?: boolean;
    validation?: IChatQuestionValidation;
    detailedMessage?: string | IMarkdownString;
}
/** Answer shape for a single-select question. */
export interface IChatSingleSelectAnswer {
    selectedValue?: string;
    freeformValue?: string;
}
/** Answer shape for a multi-select question. */
export interface IChatMultiSelectAnswer {
    selectedValues: string[];
    freeformValue?: string;
}
/** Union of all possible answer values in a question carousel. */
export type IChatQuestionAnswerValue = string | IChatSingleSelectAnswer | IChatMultiSelectAnswer;
/** Record mapping question IDs to their typed answer values. */
export type IChatQuestionAnswers = Record<string, IChatQuestionAnswerValue>;
/**
 * A carousel for presenting multiple questions inline in the chat response.
 * Users can navigate between questions and submit their answers.
 */
export interface IChatQuestionCarousel {
    questions: IChatQuestion[];
    allowSkip: boolean;
    /** Unique identifier for resolving the carousel answers back to the extension */
    resolveId?: string;
    /** Storage for collected answers when user submits */
    data?: IChatQuestionAnswers;
    /** Whether the carousel has been submitted/skipped */
    isUsed?: boolean;
    /** Top-level message shown above the questions (e.g. from MCP elicitation message) */
    message?: string | IMarkdownString;
    /** Source attribution (e.g. MCP server) */
    source?: ToolDataSource;
    /** Terminal ID when the carousel was triggered by a terminal needing input */
    terminalId?: string;
    kind: "questionCarousel";
}
export declare enum ElicitationState {
    Pending = "pending",
    Accepted = "accepted",
    Rejected = "rejected"
}
export interface IChatElicitationRequest {
    kind: "elicitation2";
    title: string | IMarkdownString;
    message: string | IMarkdownString;
    acceptButtonLabel: string;
    rejectButtonLabel: string | undefined;
    subtitle?: string | IMarkdownString;
    source?: ToolDataSource;
    state: IObservable<ElicitationState>;
    acceptedResult?: Record<string, unknown>;
    moreActions?: IAction[];
    riskAssessment?: {
        toolId: string;
        parameters: unknown;
    };
    accept(value: IAction | true): Promise<void>;
    reject?: () => Promise<void>;
    isHidden?: IObservable<boolean>;
    hide?(): void;
    toJSON(): IChatElicitationRequestSerialized;
}
export interface IChatElicitationRequestSerialized {
    kind: "elicitationSerialized";
    title: string | IMarkdownString;
    message: string | IMarkdownString;
    subtitle: string | IMarkdownString | undefined;
    source: ToolDataSource | undefined;
    state: ElicitationState.Accepted | ElicitationState.Rejected;
    isHidden: boolean;
    acceptedResult?: Record<string, unknown>;
}
export interface IChatThinkingPart {
    kind: "thinking";
    value?: string | string[];
    id?: string;
    metadata?: {
        readonly [key: string]: any;
    };
    generatedTitle?: string;
}
/**
 * A progress part representing an auto-mode model routing resolution.
 * Shown as a collapsible widget in the chat stream: collapsed displays
 * "Routed to <model>", expanded shows routing details and confidence.
 */
export interface IChatAutoModeResolutionPart {
    kind: "autoModeResolution";
    /** The model ID that was selected by the router */
    resolvedModel: string;
    /** The user-facing display name of the resolved model */
    resolvedModelName: string;
    /** The router's classification label */
    predictedLabel: "needs_reasoning" | "no_reasoning" | "fallback";
    /** Confidence score (0-1) from the router */
    confidence: number;
}
/**
 * A progress part representing the execution result of a hook.
 * Aligned with the hook output JSON structure: { stopReason, systemMessage, hookSpecificOutput }.
 * If {@link stopReason} is set, the hook blocked/denied the operation.
 */
export interface IChatHookPart {
    kind: "hook";
    /** The type of hook that was executed */
    hookType: HookTypeValue;
    /** If set, the hook blocked processing. This message is shown to the user. */
    stopReason?: string;
    /** Warning/system message from the hook, shown to the user */
    systemMessage?: string;
    /** Display name of the tool that was affected by the hook */
    toolDisplayName?: string;
    metadata?: {
        readonly [key: string]: unknown;
    };
    /** If set, this hook was executed within a subagent invocation and should be grouped with it. */
    subAgentInvocationId?: string;
}
export interface IChatTerminalToolInvocationData {
    kind: "terminal";
    commandLine: {
        original: string;
        userEdited?: string;
        toolEdited?: string;
        forDisplay?: string;
        isSandboxWrapped?: boolean;
    };
    /**
     * LM-generated intention describing why the command is being run, shown
     * above the command in the terminal tool card. Set by the Agent Host; the
     * built-in terminal tool leaves this unset.
     */
    intention?: string;
    /** The working directory URI for the terminal */
    cwd?: UriComponents;
    /**
     * Pre-computed confirmation display data (localization must happen at source).
     * Contains the command line to show in confirmation (potentially without cd prefix)
     * and the formatted cwd label if a cd prefix was extracted.
     */
    confirmation?: {
        /** The command line to display in the confirmation editor */
        commandLine: string;
        /** The formatted cwd label to show in title (if cd was extracted) */
        cwdLabel?: string;
        /** The cd prefix to prepend back when user edits */
        cdPrefix?: string;
    };
    /**
     * Overrides to apply to the presentation of the tool call only, but not actually change the
     * command that gets run. For example, python -c "print('hello')" can be presented as just
     * the Python code with Python syntax highlighting.
     */
    presentationOverrides?: {
        /** The command line to display in the UI */
        commandLine: string;
        /** The language for syntax highlighting */
        language?: string;
    };
    /** Message for model recommending the use of an alternative tool */
    alternativeRecommendation?: string;
    language: string;
    terminalToolSessionId?: string;
    /** The predefined command ID that will be used for this terminal command */
    terminalCommandId?: string;
    /** Whether the terminal command was started as a background execution */
    isBackground?: boolean;
    /** Whether the command was explicitly approved to run outside the sandbox */
    requestUnsandboxedExecution?: boolean;
    /** The model-provided reason for requesting sandbox bypass */
    requestUnsandboxedExecutionReason?: string;
    /** Whether the terminal command was approved to run sandboxed with unrestricted network access */
    requestAllowNetwork?: boolean;
    /** The model-provided reason for requesting unrestricted network access within the sandbox */
    requestAllowNetworkReason?: string;
    /** Serialized URI for the command that was executed in the terminal */
    terminalCommandUri?: UriComponents;
    /** Serialized output of the executed command */
    terminalCommandOutput?: {
        text: string;
        truncated?: boolean;
        lineCount?: number;
    };
    /** Stored theme colors at execution time to style detached output */
    terminalTheme?: {
        background?: string;
        foreground?: string;
    };
    /** Stored command state to restore decorations after reload */
    terminalCommandState?: {
        exitCode?: number;
        timestamp?: number;
        duration?: number;
    };
    /** Whether the user chose to continue in background for this tool invocation */
    didContinueInBackground?: boolean;
    autoApproveInfo?: IMarkdownString;
    /** Names of missing sandbox dependencies that the user may choose to install */
    missingSandboxDependencies?: string[];
    /** Approved repair actions that may make an installed but unusable sandbox dependency work. */
    sandboxRemediations?: string[];
    /** User-visible reason a sandbox prerequisite cannot be repaired automatically. */
    sandboxPrerequisiteFailure?: string;
}
/**
 * @deprecated This is the old API shape, we should support this for a while before removing it so
 * we don't break existing chats
 */
export interface ILegacyChatTerminalToolInvocationData {
    kind: "terminal";
    command: string;
    language: string;
}
export declare function isLegacyChatTerminalToolInvocationData(data: unknown): data is ILegacyChatTerminalToolInvocationData;
/**
 * Routing information for an MCP App's webview sub-RPCs. The kind
 * determines where `tools/call`, `resources/read`,
 * `sampling/createMessage`, etc. are sent:
 *
 * - `local`: resolves the MCP server via {@link IMcpService} from a
 *   `serverDefinitionId` + `collectionId`. Used for locally-configured
 *   MCP servers whose state lives in the workbench.
 * - `agentHost`: routes through {@link IAgentHostService.handleMcpRequest}
 *   on an AHP `mcp://` side channel. Used for MCP servers owned by an
 *   agent host (e.g. Copilot CLI).
 */
export type ChatMcpAppData = {
    kind: "local";
    /** URI of the UI resource for rendering (e.g., "ui://weather-server/dashboard") */
    resourceUri: string;
    /** Reference to the server definition for reconnection */
    serverDefinitionId: string;
    /** Reference to the collection containing the server */
    collectionId: string;
} | {
    kind: "agentHost";
    /** URI of the UI resource for rendering (e.g., "ui://weather-server/dashboard") */
    resourceUri: string;
    /** AHP `mcp://` channel URI for the originating server. */
    channel: string;
    /**
     * Stable identifier for the originating server, used as the
     * additional key when computing the webview origin. Typically the
     * AHP customization id. For top-level (bare) MCP servers this id
     * is currently session-scoped, so see {@link ChatMcpAppModel} for
     * how it avoids growing persistent application storage on every
     * new session.
     */
    serverId: string;
};
export interface IChatToolInputInvocationData {
    kind: "input";
    rawInput: any;
    /** Optional MCP App UI metadata for rendering during and after tool execution */
    mcpAppData?: ChatMcpAppData;
}
export declare enum ToolConfirmKind {
    Denied = 0,
    ConfirmationNotNeeded = 1,
    Setting = 2,
    LmServicePerTool = 3,
    UserAction = 4,
    Skipped = 5
}
export type ConfirmedReason = {
    type: ToolConfirmKind.Denied;
} | {
    type: ToolConfirmKind.ConfirmationNotNeeded;
    reason?: string | IMarkdownString;
} | {
    type: ToolConfirmKind.Setting;
    id: string;
} | {
    type: ToolConfirmKind.LmServicePerTool;
    scope: "session" | "workspace" | "profile";
} | {
    type: ToolConfirmKind.UserAction;
    selectedButton?: string;
    selectedButtonKind?: ConfirmationOptionKind;
} | {
    type: ToolConfirmKind.Skipped;
};
export interface IChatToolInvocation {
    readonly presentation: IPreparedToolInvocation["presentation"];
    readonly toolSpecificData?: IChatTerminalToolInvocationData | ILegacyChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatPullRequestContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatToolResourcesInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData;
    /**
     * Observable that tracks the `kind` of `toolSpecificData`. Used by the
     * tool invocation part to re-render when the kind changes (e.g. from
     * `'input'` to `'terminal'` when terminal content arrives).
     */
    readonly toolSpecificDataKind: IObservable<string | undefined>;
    readonly originMessage: string | IMarkdownString | undefined;
    readonly invocationMessage: string | IMarkdownString;
    readonly pastTenseMessage: string | IMarkdownString | undefined;
    readonly source: ToolDataSource;
    readonly toolId: string;
    readonly toolCallId: string;
    readonly subAgentInvocationId?: string;
    readonly icon?: ThemeIcon;
    readonly state: IObservable<IChatToolInvocation.State>;
    generatedTitle?: string;
    isAttachedToThinking: boolean;
    kind: "toolInvocation";
    toJSON(): IChatToolInvocationSerialized;
}
export declare namespace IChatToolInvocation {
    export enum StateKind {
        /** Tool call is streaming partial input from the LM */
        Streaming = 0,
        WaitingForConfirmation = 1,
        Executing = 2,
        WaitingForPostApproval = 3,
        Completed = 4,
        Cancelled = 5
    }
    interface IChatToolInvocationStateBase {
        type: StateKind;
    }
    export interface IChatToolInvocationStreamingState extends IChatToolInvocationStateBase {
        type: StateKind.Streaming;
        /** Observable partial input from the LM stream */
        readonly partialInput: IObservable<unknown>;
        /** Custom invocation message from handleToolStream */
        readonly streamingMessage: IObservable<string | IMarkdownString | undefined>;
    }
    /** Properties available after streaming is complete */
    interface IChatToolInvocationPostStreamState {
        readonly parameters: unknown;
        readonly confirmationMessages?: IToolConfirmationMessages;
    }
    interface IChatToolInvocationWaitingForConfirmationState extends IChatToolInvocationStateBase, IChatToolInvocationPostStreamState {
        type: StateKind.WaitingForConfirmation;
        confirm(reason: ConfirmedReason): void;
    }
    interface IChatToolInvocationPostConfirmState extends IChatToolInvocationPostStreamState {
        confirmed: ConfirmedReason;
    }
    interface IChatToolInvocationExecutingState extends IChatToolInvocationStateBase, IChatToolInvocationPostConfirmState {
        type: StateKind.Executing;
        progress: IObservable<{
            message?: string | IMarkdownString;
            progress: number | undefined;
        }>;
    }
    interface IChatToolInvocationPostExecuteState extends IChatToolInvocationPostConfirmState {
        resultDetails: IToolResult["toolResultDetails"];
    }
    interface IChatToolWaitingForPostApprovalState extends IChatToolInvocationStateBase, IChatToolInvocationPostExecuteState {
        type: StateKind.WaitingForPostApproval;
        confirm(reason: ConfirmedReason): void;
        contentForModel: IToolResult["content"];
    }
    interface IChatToolInvocationCompleteState extends IChatToolInvocationStateBase, IChatToolInvocationPostExecuteState {
        type: StateKind.Completed;
        postConfirmed: ConfirmedReason | undefined;
        contentForModel: IToolResult["content"];
    }
    interface IChatToolInvocationCancelledState extends IChatToolInvocationStateBase, IChatToolInvocationPostStreamState {
        type: StateKind.Cancelled;
        reason: ToolConfirmKind.Denied | ToolConfirmKind.Skipped;
        /** Optional message explaining why the tool was cancelled (e.g., from hook denial) */
        reasonMessage?: string | IMarkdownString;
    }
    export type State = IChatToolInvocationStreamingState | IChatToolInvocationWaitingForConfirmationState | IChatToolInvocationExecutingState | IChatToolWaitingForPostApprovalState | IChatToolInvocationCompleteState | IChatToolInvocationCancelledState;
    export function executionConfirmedOrDenied(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): ConfirmedReason | undefined;
    export function awaitConfirmation(invocation: IChatToolInvocation, token?: CancellationToken): Promise<ConfirmedReason>;
    export function confirmWith(invocation: IChatToolInvocation | undefined, reason: ConfirmedReason): boolean;
    export function awaitPostConfirmation(invocation: IChatToolInvocation, token?: CancellationToken): Promise<ConfirmedReason>;
    export function resultDetails(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): IToolResultInputOutputDetails | import("../tools/languageModelToolsService.js").IToolResultOutputDetails | (URI | Location)[] | IToolResultOutputDetailsSerialized | undefined;
    export function isComplete(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean;
    export function isEffectivelyHidden(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean;
    export function isStreaming(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean;
    /**
     * Get parameters from invocation. Returns undefined during streaming state.
     */
    export function getParameters(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): unknown | undefined;
    /**
     * Get confirmation messages from invocation. Returns undefined during streaming state.
     */
    export function getConfirmationMessages(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): IToolConfirmationMessages | undefined;
    export {};
}
export interface IToolResultOutputDetailsSerialized {
    output: {
        type: "data";
        mimeType: string;
        base64Data: string;
    };
}
/**
 * This is a IChatToolInvocation that has been serialized, like after window reload, so it is no longer an active tool invocation.
 */
export interface IChatToolInvocationSerialized {
    presentation: IPreparedToolInvocation["presentation"];
    toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatPullRequestContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatToolResourcesInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData;
    invocationMessage: string | IMarkdownString;
    originMessage: string | IMarkdownString | undefined;
    pastTenseMessage: string | IMarkdownString | undefined;
    resultDetails?: Array<URI | Location> | IToolResultInputOutputDetails | IToolResultOutputDetailsSerialized;
    /** boolean used by pre-1.104 versions */
    isConfirmed: ConfirmedReason | boolean | undefined;
    isComplete: boolean;
    toolCallId: string;
    toolId: string;
    readonly icon?: undefined;
    source: ToolDataSource | undefined;
    readonly subAgentInvocationId?: string;
    generatedTitle?: string;
    isAttachedToThinking?: boolean;
    kind: "toolInvocationSerialized";
}
export interface IChatExtensionsContent {
    extensions: string[];
    kind: "extensions";
}
export interface IChatPullRequestContent {
    /**
     * @deprecated use `command` instead
     */
    uri?: URI;
    command: Command;
    title: string;
    description: string;
    author: string;
    linkTag: string;
    kind: "pullRequest";
}
export interface IChatSubagentToolInvocationData {
    kind: "subagent";
    isActive?: boolean;
    description?: string;
    agentName?: string;
    prompt?: string;
    result?: string;
    modelName?: string;
    credits?: number;
    /**
     * Resource (URI string) of the subagent's own chat, when the subagent runs as
     * a distinct chat (e.g. an agent host worker chat). Used to offer an "Open
     * chat" link that reveals the subagent's read-only chat. Undefined when the
     * subagent has no separately-openable chat. A string (not a `URI`) so it stays
     * serializable across the extension host protocol.
     */
    chatResource?: string;
}
/**
 * Progress type for external tool invocation updates from extensions.
 * When isComplete is false, creates or updates a tool invocation.
 * When isComplete is true, completes an existing tool invocation.
 */
export interface IChatExternalToolInvocationUpdate {
    kind: "externalToolInvocationUpdate";
    toolCallId: string;
    toolName: string;
    isComplete: boolean;
    errorMessage?: string;
    invocationMessage?: string | IMarkdownString;
    pastTenseMessage?: string | IMarkdownString;
    toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatModifiedFilesConfirmationData;
    subagentInvocationId?: string;
    resultDetails?: IToolResultInputOutputDetails;
}
export interface IChatTodoListContent {
    kind: "todoList";
    todoList: Array<{
        id: string;
        title: string;
        status: "not-started" | "in-progress" | "completed";
    }>;
}
export interface IChatSimpleToolInvocationData {
    kind: "simpleToolInvocation";
    input: string;
    output: string;
}
export interface IChatSearchToolInvocationData {
    readonly kind: "search";
}
export interface IChatToolResourcesInvocationData {
    readonly kind: "resources";
    readonly values: Array<URI | Location>;
}
export interface IChatModifiedFilesConfirmationData {
    readonly kind: "modifiedFilesConfirmation";
    readonly options: readonly string[];
    readonly modifiedFiles: readonly {
        readonly uri: UriComponents;
        readonly originalUri?: UriComponents;
        /**
         * Optional URI to read the modified (after) content from for the diff
         * view. When absent, {@link uri} is used as the modified side.
         */
        readonly modifiedContentUri?: UriComponents;
        /**
         * Optional URI to read the original (before) content from for the diff
         * view. When absent, {@link originalUri} is used as the original side.
         */
        readonly originalContentUri?: UriComponents;
        readonly insertions?: number;
        readonly deletions?: number;
        readonly title?: string;
        readonly description?: string;
    }[];
}
/**
 * Confirmation data for the agent host `viewUnreviewedComments` tool. The
 * comments themselves are not carried here: the renderer fetches them (and
 * performs reveal/delete/accept actions) through commands registered by the
 * agent feedback feature, so this workbench/chat layer stays decoupled from the
 * `vs/sessions` feedback model. The renderer resolves the owning session from
 * its render context. Only the confirmation button labels are needed up front.
 */
export interface IChatAgentFeedbackReviewConfirmationData {
    readonly kind: "agentFeedbackReviewConfirmation";
    /** Confirmation button labels (first is the primary/approve action). */
    readonly options: readonly string[];
}
/**
 * A single unreviewed comment shown in the {@link IChatAgentFeedbackReviewConfirmationData}
 * confirmation. Produced by {@link AgentFeedbackReviewCommandId.GetComments}.
 */
export interface IChatAgentFeedbackReviewComment {
    readonly id: string;
    /** Localized origin label, e.g. "PR Review" or "Agent Review"; absent for user-authored comments. */
    readonly kindLabel?: string;
    /** The comment body. */
    readonly text: string;
    /** The file the comment is anchored to. */
    readonly fileUri: UriComponents;
}
/**
 * Command ids the agent feedback review confirmation renderer (workbench/chat)
 * uses to fetch unreviewed comments and apply the user's selection. They are
 * implemented by the agent feedback feature in `vs/sessions`, keeping the chat
 * layer decoupled from the feedback model. Most take the owning session resource
 * (`UriComponents`) as their first argument; {@link AgentFeedbackReviewCommandId.RevealAt}
 * instead resolves the session from the file resource so a rendered tool call
 * can link to a comment without knowing the session URI.
 */
export declare enum AgentFeedbackReviewCommandId {
    /** `(sessionResource)` -> `IChatAgentFeedbackReviewComment[]` (the `created` reviewable comments). */
    GetComments = "_agentFeedbackReview.getComments",
    /** `(sessionResource, commentId)` -> opens the file and reveals the comment. */
    Reveal = "_agentFeedbackReview.reveal",
    /** `(resourceUri, range)` -> resolves the owning session and reveals the comment at that file range. */
    RevealAt = "_agentFeedbackReview.revealAt",
    /** `(sessionResource, commentId)` -> deletes the comment entirely. */
    Delete = "_agentFeedbackReview.delete",
    /** `(sessionResource, commentIds)` -> accepts (reveals) the given comments. */
    Accept = "_agentFeedbackReview.accept"
}
export interface IChatMcpServersStarting {
    readonly kind: "mcpServersStarting";
    readonly state?: IObservable<IAutostartResult>;
    didStartServerIds?: string[];
    toJSON(): IChatMcpServersStartingSerialized;
}
export interface IChatMcpServersStartingSerialized {
    readonly kind: "mcpServersStarting";
    readonly state?: undefined;
    didStartServerIds?: string[];
}
export interface IChatMcpAuthenticationRequired {
    readonly kind: "mcpAuthenticationRequired";
    readonly sessionResource: UriComponents;
    readonly servers: IObservable<readonly IChatMcpAuthenticationRequiredServer[]>;
    isUsed: boolean;
}
export interface IChatMcpAuthenticationRequiredServer {
    readonly id: string;
    readonly name: string;
    readonly resource: string;
    readonly authorizationServers?: readonly string[];
    readonly requiredScopes?: readonly string[];
    readonly reason?: string;
}
/**
 * Surfaced by agent-host sessions when one or more MCP servers are still in the
 * {@link McpServerStatus.Starting starting} state a noticeable time after a
 * turn began without any content arriving from the host. The part lists the
 * servers still starting and updates dynamically via {@link servers}: it hides
 * itself (by emptying the observable) once every server has started, content
 * starts being received, or the turn ends — whichever happens first.
 *
 * Unlike {@link IChatMcpServersStarting} (used by the in-process MCP autostart
 * flow), this is a lightweight progress hint with no interactive affordance
 * (there is no "Skip" button).
 */
export interface IChatMcpServersStartingSlow {
    readonly kind: "mcpServersStartingSlow";
    readonly sessionResource: UriComponents;
    readonly servers: IObservable<readonly IChatMcpStartingServer[]>;
}
export interface IChatMcpStartingServer {
    readonly id: string;
    readonly name: string;
}
export interface IChatDisabledClaudeHooksPart {
    readonly kind: "disabledClaudeHooks";
}
/** A single approval option shown in the plan review dropdown button. */
export interface IChatPlanApprovalAction {
    /**
     * Stable identifier for matching the chosen action programmatically.
     * Unlike `label` this is not localized, so callers should compare
     * against `IChatPlanReviewResult.actionId` rather than `action`.
     * Optional for backwards-compatibility; omit for one-off actions
     * where the localized label is the only intended identifier.
     */
    id?: string;
    label: string;
    description?: string;
    default?: boolean;
    /** When set to 'autopilot', a confirmation dialog is shown before proceeding. */
    permissionLevel?: "autopilot";
}
/** The result of reviewing a plan. */
export interface IChatPlanReviewResult {
    /** The chosen action's localized `label`. */
    action?: string;
    /** The chosen action's stable `id`, if it had one. Prefer this over
     * `action` for programmatic comparisons. */
    actionId?: string;
    rejected: boolean;
    /** Combined feedback string sent to the agent (overall comment + inline
     * comments, joined and formatted as markdown). */
    feedback?: string;
    /** Display-only: the overall textarea comment, kept separate from
     * `feedbackInlineMarkdown` so the chat transcript can render the two
     * parts differently. Falls back to `feedback` when unset. */
    feedbackOverall?: string;
    /** Display-only: pre-formatted markdown listing the inline comments
     * (heading + bullets). See `feedbackOverall`. */
    feedbackInlineMarkdown?: string;
}
/**
 * A plan review widget. Presents a title, markdown plan content, an optional
 * link to edit the backing plan file, a dropdown of approval actions, a reject
 * button and an optional feedback textarea.
 */
export interface IChatPlanReview {
    kind: "planReview";
    /** Title to display in the widget header. */
    title: string;
    /** Markdown content rendered in the body (plan summary or contents). */
    content: string;
    /** Selectable approval actions. Displayed as a dropdown primary button. */
    actions: IChatPlanApprovalAction[];
    /** Whether to show the additional feedback textarea. */
    canProvideFeedback: boolean;
    /** Optional URI to the underlying plan file. An Edit button opens it. */
    planUri?: UriComponents;
    /** Unique identifier for resolving the review back to the extension. */
    resolveId?: string;
    /** Stored result once the user has responded. */
    data?: IChatPlanReviewResult;
    /** Whether the widget has been responded to. */
    isUsed?: boolean;
    /** Source attribution. */
    source?: ToolDataSource;
}
export declare class ChatMcpServersStarting implements IChatMcpServersStarting {
    readonly state: IObservable<IAutostartResult>;
    readonly kind = "mcpServersStarting";
    didStartServerIds?: string[];
    get isEmpty(): boolean;
    constructor(state: IObservable<IAutostartResult>);
    wait(): Promise<IAutostartResult>;
    toJSON(): IChatMcpServersStartingSerialized;
}
export type IChatProgress = IChatMarkdownContent | IChatAgentMarkdownContentWithVulnerability | IChatUsage | IChatTreeData | IChatMultiDiffData | IChatMultiDiffDataSerialized | IChatUsedContext | IChatContentReference | IChatContentInlineReference | IChatCodeCitation | IChatProgressMessage | IChatSystemNotificationPart | IChatTask | IChatTaskResult | IChatCommandButton | IChatWarningMessage | IChatInfoMessage | IChatTextEdit | IChatNotebookEdit | IChatWorkspaceEdit | IChatExternalEdit | IChatMoveMessage | IChatResponseCodeblockUriPart | IChatConfirmation | IChatQuestionCarousel | IChatPlanReview | IChatClearToPreviousToolInvocation | IChatToolInvocation | IChatToolInvocationSerialized | IChatExtensionsContent | IChatPullRequestContent | IChatUndoStop | IChatThinkingPart | IChatTaskSerialized | IChatElicitationRequest | IChatElicitationRequestSerialized | IChatMcpServersStarting | IChatMcpServersStartingSerialized | IChatMcpAuthenticationRequired | IChatMcpServersStartingSlow | IChatHookPart | IChatExternalToolInvocationUpdate | IChatDisabledClaudeHooksPart | IChatAutoModeResolutionPart;
export interface IChatFollowup {
    kind: "reply";
    message: string;
    agentId: string;
    subCommand?: string;
    title?: string;
    tooltip?: string;
}
export declare function isChatFollowup(obj: unknown): obj is IChatFollowup;
export declare enum ChatAgentVoteDirection {
    Down = 0,
    Up = 1
}
export interface IChatVoteAction {
    kind: "vote";
    direction: ChatAgentVoteDirection;
}
export declare enum ChatCopyKind {
    Action = 1,
    Toolbar = 2
}
export interface IChatCopyAction {
    kind: "copy";
    codeBlockIndex: number;
    copyKind: ChatCopyKind;
    copiedCharacters: number;
    totalCharacters: number;
    copiedText: string;
    totalLines: number;
    copiedLines: number;
    modelId: string;
    languageId?: string;
}
export interface IChatInsertAction {
    kind: "insert";
    codeBlockIndex: number;
    totalCharacters: number;
    totalLines: number;
    languageId?: string;
    modelId: string;
    newFile?: boolean;
}
export interface IChatApplyAction {
    kind: "apply";
    codeBlockIndex: number;
    totalCharacters: number;
    totalLines: number;
    languageId?: string;
    modelId: string;
    newFile?: boolean;
    codeMapper?: string;
    editsProposed: boolean;
}
export interface IChatTerminalAction {
    kind: "runInTerminal";
    codeBlockIndex: number;
    languageId?: string;
}
export interface IChatCommandAction {
    kind: "command";
    commandButton: IChatCommandButton;
}
export interface IChatFollowupAction {
    kind: "followUp";
    followup: IChatFollowup;
}
export interface IChatBugReportAction {
    kind: "bug";
}
export interface IChatInlineChatCodeAction {
    kind: "inlineChat";
    action: "accepted" | "discarded";
}
export interface IChatEditingSessionAction {
    kind: "chatEditingSessionAction";
    uri: URI;
    hasRemainingEdits: boolean;
    outcome: "accepted" | "rejected" | "userModified";
}
export interface IChatEditingHunkAction {
    kind: "chatEditingHunkAction";
    uri: URI;
    lineCount: number;
    linesAdded: number;
    linesRemoved: number;
    outcome: "accepted" | "rejected";
    hasRemainingEdits: boolean;
    modeId?: string;
    modelId?: string;
    languageId?: string;
}
export type ChatUserAction = IChatVoteAction | IChatCopyAction | IChatInsertAction | IChatApplyAction | IChatTerminalAction | IChatCommandAction | IChatFollowupAction | IChatBugReportAction | IChatInlineChatCodeAction | IChatEditingSessionAction | IChatEditingHunkAction;
export interface IChatUserActionEvent {
    action: ChatUserAction;
    agentId: string | undefined;
    command: string | undefined;
    sessionResource: URI;
    requestId: string;
    result: IChatAgentResult | undefined;
    modelId?: string | undefined;
    modeId?: string | undefined;
}
export interface IChatDynamicRequest {
    /**
     * The message that will be displayed in the UI
     */
    message: string;
    /**
     * Any extra metadata/context that will go to the provider.
     */
    metadata?: any;
}
export interface IChatCompleteResponse {
    message: string | ReadonlyArray<IChatProgress>;
    result?: IChatAgentResult;
    followups?: IChatFollowup[];
}
export interface IChatSessionStats {
    readonly fileCount: number;
    readonly added: number;
    readonly removed: number;
}
export type IChatSessionTiming = {
    /**
     * Timestamp when the session was created in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
     */
    readonly created: number;
    /**
     * Timestamp when the most recent request started in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
     *
     * Should be undefined if no requests have been made yet.
     */
    readonly lastRequestStarted: number | undefined;
    /**
     * Timestamp when the most recent request completed in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
     *
     * Should be undefined if the most recent request is still in progress or if no requests have been made yet.
     */
    readonly lastRequestEnded: number | undefined;
};
interface ILegacyChatSessionTiming {
    readonly startTime: number;
    readonly endTime?: number;
}
export declare function convertLegacyChatSessionTiming(timing: IChatSessionTiming | ILegacyChatSessionTiming): IChatSessionTiming;
export declare enum ResponseModelState {
    Pending = 0,
    Complete = 1,
    Cancelled = 2,
    Failed = 3,
    NeedsInput = 4
}
export interface IChatDetail {
    sessionResource: URI;
    title: string;
    lastMessageDate: number;
    timing: IChatSessionTiming | ILegacyChatSessionTiming;
    isActive: boolean;
    stats?: IChatSessionStats;
    lastResponseState: ResponseModelState;
    /**
     * The working directory URI associated with this session.
     * Only populated in the sessions/agents window context.
     */
    workingDirectory?: URI;
}
export interface IChatProviderInfo {
    id: string;
}
export interface IChatSendRequestResponseState {
    responseCreatedPromise: Promise<IChatResponseModel>;
    responseCompletePromise: Promise<void>;
}
export interface IChatSendRequestData extends IChatSendRequestResponseState {
    agent: IChatAgentData;
    slashCommand?: IChatAgentCommand;
}
/**
 * Result of a sendRequest call - a discriminated union of possible outcomes.
 */
export type ChatSendResult = ChatSendResultRejected | ChatSendResultSent | ChatSendResultQueued;
export interface ChatSendResultRejected {
    readonly kind: "rejected";
    readonly reason: string;
}
export interface ChatSendResultSent {
    readonly kind: "sent";
    readonly data: IChatSendRequestData;
    /** Set when the session was replaced by a new one (e.g. untitled -> real contributed session). */
    readonly newSessionResource?: URI;
}
export interface ChatSendResultQueued {
    readonly kind: "queued";
    /**
     * Promise that resolves when the queued message is actually processed.
     * Will resolve to a 'sent' or 'rejected' result.
     */
    readonly deferred: Promise<ChatSendResult>;
}
export declare namespace ChatSendResult {
    function isSent(result: ChatSendResult): result is ChatSendResultSent;
    function isRejected(result: ChatSendResult): result is ChatSendResultRejected;
    function isQueued(result: ChatSendResult): result is ChatSendResultQueued;
    /** Assertion function for tests - asserts that the result is a sent result */
    function assertSent(result: ChatSendResult): asserts result is ChatSendResultSent;
}
export interface IChatEditorLocationData {
    type: ChatAgentLocation.EditorInline;
    id: string;
    document: URI;
    selection: ISelection;
    wholeRange: IRange;
}
export interface IChatNotebookLocationData {
    type: ChatAgentLocation.Notebook;
    sessionInputUri: URI;
}
export interface IChatTerminalLocationData {
    type: ChatAgentLocation.Terminal;
}
export type IChatLocationData = IChatEditorLocationData | IChatNotebookLocationData | IChatTerminalLocationData;
/**
 * The kind of queue request.
 */
export declare enum ChatRequestQueueKind {
    /** Request is queued to be sent after current request completes */
    Queued = "queued",
    /** Request is queued and signals the active request to yield */
    Steering = "steering"
}
export interface IChatSendRequestOptions {
    modeInfo?: IChatRequestModeInfo;
    userSelectedModelId?: string;
    /**
     * The configuration (e.g. context size, thinking effort) for the selected
     * model as scoped to the requesting editor. When set, it takes precedence
     * over the global per-model configuration so the value sent matches what the
     * editor displays. See issue #320393.
     */
    userSelectedModelConfiguration?: IStringDictionary<unknown>;
    userSelectedTools?: IObservable<UserSelectedTools>;
    location?: ChatAgentLocation;
    locationData?: IChatLocationData;
    parserContext?: IChatParserContext;
    attempt?: number;
    noCommandDetection?: boolean;
    acceptedConfirmationData?: any[];
    rejectedConfirmationData?: any[];
    attachedContext?: IChatRequestVariableEntry[];
    resolvedVariables?: IChatRequestVariableEntry[];
    agentHostSessionConfig?: Record<string, unknown>;
    /** The target agent ID can be specified with this property instead of using @ in 'message' */
    agentId?: string;
    /** agentId, but will not add a @ name to the request */
    agentIdSilent?: string;
    slashCommand?: string;
    /**
     * The label of the confirmation action that was selected.
     */
    confirmation?: string;
    /**
     * When set, queues this message to be sent after the current request completes.
     * If Steering, also sets yieldRequested on any active request to signal it should wrap up.
     */
    queue?: ChatRequestQueueKind;
    /**
     * When true, the queued request will not be processed immediately even if no request is active.
     * The request stays in the queue until `processPendingRequests` is called explicitly.
     */
    pauseQueue?: boolean;
    /**
     * When true, the request is rendered as a compact tool-progress-style line
     * instead of a full user message bubble. Used for system-initiated notifications
     * such as terminal command completion.
     */
    isSystemInitiated?: boolean;
    /**
     * Display label for system-initiated requests. When set, the request row renders
     * this label as a compact progress-style message instead of the full request text.
     */
    systemInitiatedLabel?: string;
    /**
     * Structured terminal execution ID for system-initiated terminal notifications.
     * This avoids parsing IDs from request text when tools need to correlate
     * terminal prompts with follow-up actions.
     */
    terminalExecutionId?: string;
    /**
     * When set, the chat service will collect automatic instructions
     * (for example `.instructions.md` files and skills) asynchronously after showing
     * the request in the UI, rather than blocking the UI on collection.
     */
    instructionContext?: {
        modeKind: ChatModeKind;
        enabledTools?: UserSelectedTools;
        enabledSubAgents?: readonly string[];
    };
}
export type IChatModelReference = IReference<IChatModel>;
export interface IChatSessionContext {
    readonly initialSessionOptions?: ReadonlyChatSessionOptionsMap;
}
export declare const KEYWORD_ACTIVIATION_SETTING_ID = "accessibility.voice.keywordActivation";
export interface IChatSessionStartOptions {
    canUseTools?: boolean;
    disableBackgroundKeepAlive?: boolean;
    debugOwner?: string;
}
export declare const ChatStopCancellationNoopEventName = "chat.stopCancellationNoop";
export type ChatStopCancellationNoopEvent = {
    source: string;
    reason: "noWidget" | "noViewModel" | "noPendingRequest" | "requestAlreadyCanceled" | "requestIdUnavailable";
    requestInProgress: "true" | "false" | "unknown";
    pendingRequests: number;
    sessionScheme?: string;
    lastRequestId?: string;
    chatSessionId?: string;
};
export type ChatStopCancellationNoopClassification = {
    source: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The layer where stop cancellation no-op occurred.";
    };
    reason: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The no-op reason when stop cancellation did not dispatch fully.";
    };
    requestInProgress: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "Whether request-in-progress was true, false, or unknown at no-op time.";
    };
    pendingRequests: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The number of queued pending requests at no-op time when known.";
        isMeasurement: true;
    };
    sessionScheme?: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The URI scheme of the session resource (e.g. vscodeLocalChatSession vs remote).";
    };
    lastRequestId?: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The ID of the last request in the session, for correlating with tool invocations.";
    };
    chatSessionId?: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The chat session ID.";
    };
    owner: "roblourens";
    comment: "Tracks possible no-op stop cancellation paths.";
};
export declare const ChatPendingRequestChangeEventName = "chat.pendingRequestChange";
export type ChatPendingRequestChangeEvent = {
    action: "add" | "remove" | "notCancelable";
    source: string;
    requestId?: string;
    chatSessionId?: string;
};
export type ChatPendingRequestChangeClassification = {
    action: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "Whether a pending request was added or removed.";
    };
    source: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The method that triggered the pending request change.";
    };
    requestId?: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The request ID associated with the pending request change.";
    };
    chatSessionId?: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The chat session ID.";
    };
    owner: "roblourens";
    comment: "Tracks pending request lifecycle changes in the chat service.";
};
export {};
