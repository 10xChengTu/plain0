import { Separator } from "../../../../../base/common/actions.js";
import { VSBuffer } from "../../../../../base/common/buffer.js";
import { CancellationToken } from "../../../../../base/common/cancellation.js";
import { IMarkdownString } from "../../../../../base/common/htmlContent.js";
import { IJSONSchema } from "../../../../../base/common/jsonSchema.js";
import { IDisposable } from "../../../../../base/common/lifecycle.js";
import { IObservable, IReader, ITransaction, ObservableSet } from "../../../../../base/common/observable.js";
import { ThemeIcon } from "../../../../../base/common/themables.js";
import { URI } from "../../../../../base/common/uri.js";
import { Location } from "../../../../../editor/common/languages.js";
import { ConfirmationOption } from "../../../../../platform/agentHost/common/state/protocol/state.js";
import { ContextKeyExpression } from "../../../../../platform/contextkey/common/contextkey.js";
import { IContextKeyService } from "../../../../../platform/contextkey/common/contextkey.service.js";
import { ExtensionIdentifier } from "../../../../../platform/extensions/common/extensions.js";
import { IProgress } from "../../../../../platform/progress/common/progress.js";
import { IChatAgentFeedbackReviewConfirmationData, IChatExtensionsContent, IChatModifiedFilesConfirmationData, IChatSearchToolInvocationData, IChatSimpleToolInvocationData, IChatSubagentToolInvocationData, IChatTodoListContent, IChatToolInputInvocationData, type IChatTerminalToolInvocationData } from "../chatService/chatService.js";
import { ILanguageModelChatMetadata, LanguageModelPartAudience } from "../languageModels.js";
import { UserSelectedTools } from "../participants/chatAgents.js";
/**
 * Selector for matching language models by vendor, family, version, or id.
 * Used to filter tools to specific models or model families.
 */
export interface ILanguageModelChatSelector {
    readonly vendor?: string;
    readonly family?: string;
    readonly version?: string;
    readonly id?: string;
}
export interface IToolData {
    readonly id: string;
    readonly source: ToolDataSource;
    readonly toolReferenceName?: string;
    readonly legacyToolReferenceFullNames?: readonly string[];
    readonly icon?: {
        dark: URI;
        light?: URI;
    } | ThemeIcon;
    readonly when?: ContextKeyExpression;
    readonly tags?: readonly string[];
    readonly displayName: string;
    readonly userDescription?: string;
    readonly modelDescription: string;
    readonly inputSchema?: IJSONSchema;
    readonly canBeReferencedInPrompt?: boolean;
    /**
     * True if the tool runs in the (possibly remote) workspace, false if it runs
     * on the host, undefined if known.
     */
    readonly runsInWorkspace?: boolean;
    readonly alwaysDisplayInputOutput?: boolean;
    /** True if this tool might ask for pre-approval */
    readonly canRequestPreApproval?: boolean;
    /** True if this tool might ask for post-approval */
    readonly canRequestPostApproval?: boolean;
    /**
     * Model selectors that this tool is available for.
     * If defined, the tool is only available when the selected model matches one of the selectors.
     */
    readonly models?: readonly ILanguageModelChatSelector[];
}
/**
 * Check if a tool matches the given model metadata based on the tool's `models` selectors.
 * If the tool has no `models` defined, it matches all models.
 * If model is undefined, model-specific filtering is skipped (tool is included).
 */
export declare function toolMatchesModel(toolData: IToolData, model: ILanguageModelChatMetadata | undefined): boolean;
export interface IToolProgressStep {
    readonly message: string | IMarkdownString | undefined;
    /** 0-1 progress of the tool call */
    readonly progress?: number;
}
export type ToolProgress = IProgress<IToolProgressStep>;
export type ToolDataSource = {
    type: "extension";
    label: string;
    extensionId: ExtensionIdentifier;
} | {
    type: "mcp";
    label: string;
    serverLabel: string | undefined;
    instructions: string | undefined;
    collectionId: string;
    definitionId: string;
} | {
    type: "user";
    label: string;
    file: URI;
} | {
    type: "internal";
    label: string;
} | {
    type: "external";
    label: string;
};
export declare namespace ToolDataSource {
    const Internal: ToolDataSource;
    /** External tools may not be contributed or invoked, but may be invoked externally and described in an IChatToolInvocationSerialized */
    const External: ToolDataSource;
    function toKey(source: ToolDataSource): string;
    function equals(a: ToolDataSource, b: ToolDataSource): boolean;
    function classify(source: ToolDataSource): {
        readonly ordinal: number;
        readonly label: string;
    };
}
/**
 * Pre-tool-use hook result passed from the extension when the hook was executed externally.
 */
export interface IExternalPreToolUseHookResult {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
    updatedInput?: Record<string, any>;
}
export interface IToolInvocation {
    callId: string;
    toolId: string;
    parameters: Record<string, any>;
    tokenBudget?: number;
    context: IToolInvocationContext | undefined;
    chatRequestId?: string;
    chatInteractionId?: string;
    /**
     * Optional tool call ID from the chat stream, used to correlate with pending streaming tool calls.
     */
    chatStreamToolCallId?: string;
    /**
     * Lets us add some nicer UI to toolcalls that came from a sub-agent, but in the long run, this should probably just be rendered in a similar way to thinking text + tool call groups
     */
    subAgentInvocationId?: string;
    toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData;
    modelId?: string;
    userSelectedTools?: UserSelectedTools;
    /** The label of the custom button selected by the user during confirmation, if custom buttons were used. */
    selectedCustomButton?: string;
    /** Pre-tool-use hook result passed from the extension, if the hook was already executed externally. */
    preToolUseResult?: IExternalPreToolUseHookResult;
    /**
     * Optional W3C trace context `traceparent` value identifying the parent distributed
     * tracing span for this tool invocation. Forwarded to MCP tool implementations as
     * `_meta.traceparent` (MCP SEP-414).
     */
    traceparent?: string;
    /** Optional W3C trace context `tracestate` value paired with {@link traceparent}. */
    tracestate?: string;
}
export interface IToolInvocationContext {
    readonly sessionResource: URI;
    /**
     * The working directory URI associated with this session.
     * Only set in the agents window context where each session can
     * have its own working directory that differs from the workspace folders.
     */
    readonly workingDirectory?: URI;
}
export declare function isToolInvocationContext(obj: any): obj is IToolInvocationContext;
export interface IToolInvocationPreparationContext {
    parameters: any;
    toolCallId: string;
    chatRequestId?: string;
    chatSessionResource: URI | undefined;
    chatInteractionId?: string;
    modelId?: string;
    /** If set, tells the tool that it should include confirmation messages. */
    forceConfirmationReason?: string;
    /**
     * The working directory URI for the session, if set.
     * Used by tools to resolve relative paths and check file access.
     */
    workingDirectory?: URI;
}
export type ToolInputOutputBase = {
    /** Mimetype of the value, optional */
    mimeType?: string;
    /** URI of the resource on the MCP server. */
    uri?: URI;
    /** If true, this part came in as a resource reference rather than direct data. */
    asResource?: boolean;
    /** Audience of the data part */
    audience?: LanguageModelPartAudience[];
};
export type ToolInputOutputEmbedded = ToolInputOutputBase & {
    type: "embed";
    value: string;
    /** If true, value is text. If false or not given, value is base64 */
    isText?: boolean;
};
export type ToolInputOutputReference = ToolInputOutputBase & {
    type: "ref";
    uri: URI;
};
export interface IToolResultInputOutputDetails {
    readonly input: string;
    /** Language identifier for syntax highlighting the input. Defaults to 'json'. */
    readonly inputLanguage?: string;
    readonly output: (ToolInputOutputEmbedded | ToolInputOutputReference)[];
    readonly isError?: boolean;
    /** Raw MCP tool result for MCP App UI rendering */
    readonly mcpOutput?: unknown;
}
export interface IToolResultOutputDetails {
    readonly output: {
        type: "data";
        mimeType: string;
        value: VSBuffer;
    };
}
export declare function isToolResultInputOutputDetails(obj: any): obj is IToolResultInputOutputDetails;
export declare function isToolResultOutputDetails(obj: any): obj is IToolResultOutputDetails;
export interface IToolResult {
    content: (IToolResultPromptTsxPart | IToolResultTextPart | IToolResultDataPart)[];
    toolResultMessage?: string | IMarkdownString;
    toolResultDetails?: Array<URI | Location> | IToolResultInputOutputDetails | IToolResultOutputDetails;
    toolResultError?: string | boolean;
    toolMetadata?: unknown;
    /** Whether to ask the user to confirm these tool results. Overrides {@link IToolConfirmationMessages.confirmResults}. */
    confirmResults?: boolean;
}
export declare function toolContentToA11yString(part: IToolResult["content"]): string;
export declare function toolResultHasBuffers(result: IToolResult): boolean;
export interface IToolResultPromptTsxPart {
    kind: "promptTsx";
    value: unknown;
}
export declare function stringifyPromptTsxPart(part: IToolResultPromptTsxPart): string;
export interface IToolResultTextPart {
    kind: "text";
    value: string;
    audience?: LanguageModelPartAudience[];
    title?: string;
}
export interface IToolResultDataPart {
    kind: "data";
    value: {
        mimeType: string;
        data: VSBuffer;
    };
    audience?: LanguageModelPartAudience[];
    title?: string;
}
export interface IToolConfirmationMessages {
    /** Title for the confirmation. If set, the user will be asked to confirm execution of the tool */
    title?: string | IMarkdownString;
    /** MUST be set if `title` is also set */
    message?: string | IMarkdownString;
    disclaimer?: string | IMarkdownString;
    allowAutoConfirm?: boolean;
    terminalCustomActions?: ToolConfirmationAction[];
    /** If true, confirmation will be requested after the tool executes and before results are sent to the model */
    confirmResults?: boolean;
    /** If title is not set (no confirmation needed), this reason will be shown to explain why confirmation was not needed */
    confirmationNotNeededReason?: string | IMarkdownString;
    /** Custom options to display instead of the default Allow/Skip buttons. */
    customOptions?: ConfirmationOption[];
    /** When set, shows an additional approval option to approve this particular combination of tool and arguments */
    approveCombination?: {
        /** Human-readable label for the approval option */
        label: string | IMarkdownString;
        /** Precomputed SHA-256 key for the combination (set during tool preparation) */
        key: string;
        /** String representation of the arguments for this combination */
        arguments?: string;
    };
}
export interface IToolConfirmationAction {
    label: string;
    disabled?: boolean;
    tooltip?: string;
    data: any;
}
export type ToolConfirmationAction = IToolConfirmationAction | Separator;
export declare enum ToolInvocationPresentation {
    Hidden = "hidden",
    HiddenAfterComplete = "hiddenAfterComplete"
}
export interface IToolInvocationStreamContext {
    toolCallId: string;
    rawInput: unknown;
    chatRequestId?: string;
    chatSessionResource?: URI;
    chatInteractionId?: string;
}
export interface IStreamedToolInvocation {
    invocationMessage?: string | IMarkdownString;
}
export interface IPreparedToolInvocation {
    invocationMessage?: string | IMarkdownString;
    pastTenseMessage?: string | IMarkdownString;
    originMessage?: string | IMarkdownString;
    confirmationMessages?: IToolConfirmationMessages;
    presentation?: ToolInvocationPresentation;
    icon?: ThemeIcon;
    toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData;
}
export interface IToolImpl {
    invoke(invocation: IToolInvocation, countTokens: CountTokensCallback, progress: ToolProgress, token: CancellationToken): Promise<IToolResult>;
    prepareToolInvocation?(context: IToolInvocationPreparationContext, token: CancellationToken): Promise<IPreparedToolInvocation | undefined>;
    handleToolStream?(context: IToolInvocationStreamContext, token: CancellationToken): Promise<IStreamedToolInvocation | undefined>;
}
export interface IToolSet {
    readonly id: string;
    readonly referenceName: string;
    readonly icon: ThemeIcon;
    readonly source: ToolDataSource;
    readonly description?: string;
    /** A longer, human-readable description of what the tool set is for, shown as a subtitle in the Chat Customizations "Tools" section. */
    readonly detail?: string;
    readonly legacyFullNames?: string[];
    /** When true, this tool set is deprecated: it is hidden from the Chat Customizations "Tools" section and these groupings will be removed when the Local harness is dropped. */
    readonly deprecated?: boolean;
    /** When true, this tool set is hidden from the chat tools picker (e.g. a customizations-only grouping). */
    readonly hiddenInToolsPicker?: boolean;
    getTools(r?: IReader): Iterable<IToolData>;
}
/**
* Maps tools and tool sets to their enablement state. Use a class to control creation of the map and ensure
* that it is not mutated after creation.
*/
export declare class ToolAndToolSetEnablementMap implements Iterable<[
    IToolData | IToolSet,
    boolean
]> {
    private readonly _map;
    static fromEntries(entries: Iterable<[
        IToolData | IToolSet,
        boolean
    ]>): ToolAndToolSetEnablementMap;
    static fromMap(map: Map<IToolData | IToolSet, boolean>): ToolAndToolSetEnablementMap;
    private constructor();
    [Symbol.iterator](): IterableIterator<[
        IToolData | IToolSet,
        boolean
    ]>;
    get(toolOrToolSet: IToolData | IToolSet): boolean | undefined;
    has(toolOrToolSet: IToolData | IToolSet): boolean;
    get size(): number;
    entries(): IterableIterator<[
        IToolData | IToolSet,
        boolean
    ]>;
}
export declare function isToolSet(obj: IToolData | IToolSet | undefined): obj is IToolSet;
export declare class ToolSet implements IToolSet {
    readonly id: string;
    readonly referenceName: string;
    readonly icon: ThemeIcon;
    readonly source: ToolDataSource;
    readonly description: string | undefined;
    readonly detail: string | undefined;
    readonly legacyFullNames: string[] | undefined;
    readonly deprecated: boolean | undefined;
    readonly hiddenInToolsPicker: boolean | undefined;
    private readonly _contextKeyService;
    protected readonly _tools: ObservableSet<IToolData>;
    protected readonly _toolSets: ObservableSet<IToolSet>;
    /**
     * A homogenous tool set only contains tools from the same source as the tool set itself
     */
    readonly isHomogenous: IObservable<boolean>;
    constructor(id: string, referenceName: string, icon: ThemeIcon, source: ToolDataSource, description: string | undefined, detail: string | undefined, legacyFullNames: string[] | undefined, deprecated: boolean | undefined, hiddenInToolsPicker: boolean | undefined, _contextKeyService: IContextKeyService);
    addTool(data: IToolData, tx?: ITransaction): IDisposable;
    addToolSet(toolSet: IToolSet, tx?: ITransaction): IDisposable;
    getTools(r?: IReader): Iterable<IToolData>;
}
export declare class ToolSetForModel {
    private readonly _toolSet;
    private readonly model;
    private readonly toolFilter?;
    get id(): string;
    get referenceName(): string;
    get icon(): ThemeIcon;
    get source(): ToolDataSource;
    get description(): string | undefined;
    get detail(): string | undefined;
    get legacyFullNames(): string[] | undefined;
    get deprecated(): boolean | undefined;
    get hiddenInToolsPicker(): boolean | undefined;
    constructor(_toolSet: IToolSet, model: ILanguageModelChatMetadata | undefined, toolFilter?: ((toolData: IToolData) => boolean) | undefined);
    getTools(r?: IReader): Iterable<IToolData>;
}
export interface IBeginToolCallOptions {
    toolCallId: string;
    toolId: string;
    chatRequestId?: string;
    sessionResource?: URI;
    subagentInvocationId?: string;
    /**
     * Create the streaming invocation even when the tool does not
     * implement `handleToolStream`. Used by callers that need a
     * `ChatToolInvocation` handle to observe state transitions (e.g.
     * confirmation) before invoking the tool.
     */
    force?: boolean;
}
export interface IToolInvokedEvent {
    readonly toolId: string;
    readonly sessionResource: URI | undefined;
    readonly requestId: string | undefined;
    readonly subagentInvocationId: string | undefined;
}
export type CountTokensCallback = (input: string, token: CancellationToken) => Promise<number>;
export declare function createToolInputUri(toolCallId: string): URI;
export declare function createToolSchemaUri(toolOrId: IToolData | string): URI;
export declare namespace SpecedToolAliases {
    const execute = "execute";
    const edit = "edit";
    const search = "search";
    const agent = "agent";
    const read = "read";
    const web = "web";
    const todo = "todo";
}
export declare namespace VSCodeToolReference {
    const runSubagent = "runSubagent";
    const vscode = "vscode";
}
