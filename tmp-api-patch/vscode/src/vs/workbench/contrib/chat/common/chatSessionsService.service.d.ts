import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { URI } from "../../../../base/common/uri.js";
import { IChatSessionItemsDelta, IChatSessionCommitEvent, ResolvedChatSessionsExtensionPoint, IChatSessionsExtensionPoint, IChatSessionItemController, IChatSessionItem, IChatSessionContentProvider, IChatSession, IChatInputCompletionsParams, IChatInputCompletionsResult, ReadonlyChatSessionOptionsMap, IChatSessionProviderOptionItem, IChatSessionOptionsChangeEvent, IChatSessionRequestHistoryItem, IChatSessionProviderOptionGroup, IChatNewSessionRequest, IChatSessionCustomizationsProvider, IChatSessionCustomizationItemGroup } from "./chatSessionsService.js";
import { IChatAgentAttachmentCapabilities } from "./participants/chatAgents.js";
import { Target } from "./promptSyntax/promptTypes.js";
export declare const IChatSessionsService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatSessionsService>;
export interface IChatSessionsService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeItemsProviders: Event<{
        readonly chatSessionType: string;
    }>;
    readonly onDidChangeSessionItems: Event<IChatSessionItemsDelta>;
    /**
    * Fired when an untitled session is committed (URI swapped to a real resource)
    * after the first turn completes.
    */
    readonly onDidCommitSession: Event<IChatSessionCommitEvent>;
    readonly onDidChangeAvailability: Event<void>;
    readonly onDidChangeInProgress: Event<void>;
    getChatSessionContribution(chatSessionType: string): ResolvedChatSessionsExtensionPoint | undefined;
    getAllChatSessionContributions(): ResolvedChatSessionsExtensionPoint[];
    /**
    * Programmatically register a chat session contribution (for internal session types
    * that don't go through the extension point).
    */
    registerChatSessionContribution(contribution: IChatSessionsExtensionPoint): IDisposable;
    registerChatSessionItemController(chatSessionType: string, controller: IChatSessionItemController): IDisposable;
    getRegisteredChatSessionItemProviders(): readonly string[];
    activateChatSessionItemProvider(chatSessionType: string): Promise<void>;
    /**
    * Get the list of current chat session items grouped by session type.
    *
    * @param providerTypeFilter If specified, only returns items from the given providers. If undefined, returns items from all providers.
    *
    * @returns An async iterable that produces the list of session items for each provider. The order is not guaranteed. Some provider may take a long time to resolve.
    */
    getChatSessionItems(providerTypeFilter: readonly string[] | undefined, token: CancellationToken): AsyncIterable<{
        readonly chatSessionType: string;
        readonly items: readonly IChatSessionItem[];
    }>;
    /**
    * Forces the controllers to refresh their session items, optionally filtered by provider type.
    */
    refreshChatSessionItems(providerTypeFilter: readonly string[] | undefined, token: CancellationToken): Promise<void>;
    /** @deprecated Use `getChatSessionItems` */
    getInProgress(): {
        chatSessionType: string;
        count: number;
    }[];
    /**
    * Lazily resolves a chat session item, filling in expensive details like timing, changes, and badge.
    * Returns the resolved item, or undefined if no resolve handler is available.
    */
    resolveChatSessionItem(chatSessionType: string, resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined>;
    readonly onDidChangeContentProviderSchemes: Event<{
        readonly added: string[];
        readonly removed: string[];
    }>;
    getContentProviderSchemes(): string[];
    registerChatSessionContentProvider(scheme: string, provider: IChatSessionContentProvider): IDisposable;
    canResolveChatSession(sessionType: string): Promise<boolean>;
    getOrCreateChatSession(sessionResource: URI, token: CancellationToken): Promise<IChatSession>;
    /** Resolves a parsed response Markdown URI through its session content provider. */
    resolveChatResponseUri(sessionResource: URI, href: string, kind: "link" | "image"): string;
    /**
    * Compute completion items for an input being composed in the chat
    * session identified by `sessionResource`. Delegates to the registered
    * {@link IChatSessionContentProvider} for the session, if it implements
    * {@link IChatSessionContentProvider.provideChatInputCompletions}.
    * Returns `undefined` when no provider is available, in which case the
    * workbench's default in-process providers should be used.
    */
    provideChatInputCompletions(sessionResource: URI, params: IChatInputCompletionsParams, token: CancellationToken): Promise<IChatInputCompletionsResult | undefined>;
    /**
    * Trigger characters announced by the content provider for the given
    * session type. Used to dynamically register Monaco completion
    * providers per content-provider scheme. Returns `undefined` when the
    * scheme has no content provider, or `[]` when the provider does not
    * announce any trigger characters.
    */
    getChatInputCompletionTriggerCharacters(sessionType: string): Promise<readonly string[] | undefined>;
    getSessionOptions(sessionResource: URI): ReadonlyChatSessionOptionsMap | undefined;
    getSessionOption(sessionResource: URI, optionId: string): string | IChatSessionProviderOptionItem | undefined;
    setSessionOption(sessionResource: URI, optionId: string, value: string | IChatSessionProviderOptionItem): boolean;
    updateSessionOptions(sessionResource: URI, updates: ReadonlyChatSessionOptionsMap): boolean;
    /**
    * Fired when options for a chat session change.
    */
    readonly onDidChangeSessionOptions: Event<IChatSessionOptionsChangeEvent>;
    /**
    * Get the capabilities for a specific session type
    */
    getCapabilitiesForSessionType(chatSessionType: string): IChatAgentAttachmentCapabilities | undefined;
    /**
    * Get the customAgentTarget for a specific session type.
    * When the Target is not `Target.Undefined`, the mode picker should show filtered custom agents matching this target.
    */
    getCustomAgentTargetForSessionType(chatSessionType: string): Target;
    /**
    * Returns whether the session type requires custom models. When true, the model picker should show filtered custom models.
    */
    requiresCustomModelsForSessionType(chatSessionType: string): boolean;
    /**
    * Returns whether the session type supports the synthetic "Auto" model
    * fallback. The built-in local chat always supports it; contributed session
    * types default to `false` unless they set `supportsAutoModel`. When false
    * and no models are available, the picker shows a "No models available"
    * state instead of "Auto".
    */
    supportsAutoModelForSessionType(chatSessionType: string): boolean;
    /**
    * Whether the session type needs a Copilot account and so is unusable until the user signs in (BYOK isn't
    * supported). Defaults to false, so third-party types stay usable while signed out.
    */
    requiresCopilotSignInForSessionType(chatSessionType: string): boolean;
    /**
    * Returns whether the session type supports delegation.
    * Defaults to true when not explicitly set.
    */
    supportsDelegationForSessionType(chatSessionType: string): boolean;
    /**
    * Returns whether the loaded session supports forking conversations.
    */
    sessionSupportsFork(sessionResource: URI): boolean;
    /**
    * Forks a contributed chat session from the given request point.
    * @param sessionResource The session resource to fork.
    * @param request The request history item to fork from, or undefined to fork from the end.
    * @param token Cancellation token.
    * @returns The forked session item, or undefined if forking failed.
    */
    forkChatSession(sessionResource: URI, request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken): Promise<IChatSessionItem>;
    /**
    * Returns whether the loaded session supports renaming.
    */
    sessionSupportsRename(sessionResource: URI): boolean;
    /**
    * Renames a contributed chat session.
    * @param sessionResource The session resource to rename.
    * @param title The new title for the session.
    * @param token Cancellation token.
    */
    renameChatSession(sessionResource: URI, title: string, token: CancellationToken): Promise<void>;
    readonly onDidChangeOptionGroups: Event<string>;
    getOptionGroupsForSessionType(chatSessionType: string): IChatSessionProviderOptionGroup[] | undefined;
    setOptionGroupsForSessionType(chatSessionType: string, handle: number, optionGroups?: readonly IChatSessionProviderOptionGroup[]): void;
    /**
    * Get the default options for new sessions of this type, derived from option groups'
    * `selected` or `default` items.
    */
    getNewChatSessionInputState(chatSessionType: string, sessionResource: URI): Promise<readonly IChatSessionProviderOptionGroup[] | undefined>;
    /**
    * Creates a new chat session item using the controller's newChatSessionItemHandler.
    * Returns undefined if the controller doesn't have a handler or if no controller is registered.
    */
    createNewChatSessionItem(chatSessionType: string, request: IChatNewSessionRequest, token: CancellationToken): Promise<IChatSessionItem | undefined>;
    /**
    * Permanently deletes a chat session item by delegating to the registered controller's `deleteChatSessionItem`
    * handler. Throws if the controller does not implement `deleteChatSessionItem`.
    */
    deleteChatSessionItem(sessionResource: URI, token: CancellationToken): Promise<void>;
    /**
    * Records the inverse `real → untitled` alias so option lookups for the real
    * session resolve to the untitled session's entry (e.g. {@link updateSessionOptions}).
    *
    * Call this BEFORE the real session loads, and never remove it — the real
    * session keeps reading its options through this alias even after the untitled
    * model is disposed. (Only the forward mapping is cleared, via
    * {@link clearMaterializedSessionResource}.) Publishing the forward mapping is a
    * separate step; see {@link setMaterializedSessionResource}.
    */
    registerSessionResourceAlias(untitledResource: URI, realResource: URI): void;
    /**
    * Records the forward `untitled → real` mapping (read via
    * {@link getMaterializedSessionResource}) so a late send still addressed to the
    * untitled resource re-targets the real session. Call this only AFTER the real
    * session has loaded.
    *
    * Kept separate from {@link registerSessionResourceAlias} on purpose: the
    * inverse alias must exist BEFORE the load (for option lookups), but this
    * forward mapping must appear only AFTER the real session exists — published
    * earlier, a failed or still-loading session would be re-targeted before it
    * exists (a later send would throw "Unknown session").
    */
    setMaterializedSessionResource(untitledResource: URI, realResource: URI): void;
    /**
    * Returns the real session resource that `untitledResource` materialized
    * into (via {@link setMaterializedSessionResource}), or `undefined` if it has
    * not materialized or the mapping was already cleared.
    */
    getMaterializedSessionResource(untitledResource: URI): URI | undefined;
    /**
    * Clears the forward `untitled → real` mapping for `sessionResource` (passed
    * either the untitled key or the real value), so {@link getMaterializedSessionResource}
    * stops re-targeting once the session is disposed. Does NOT remove the inverse
    * alias, which is intentionally permanent (see {@link registerSessionResourceAlias}).
    */
    clearMaterializedSessionResource(sessionResource: URI): void;
    /**
    * Fires {@link onDidCommitSession} to notify listeners that an untitled
    * session has been committed with a real resource URI.
    */
    fireSessionCommitted(original: URI, committed: URI): void;
    readonly onDidChangeCustomizations: Event<{
        readonly chatSessionType: string;
    }>;
    registerCustomizationsProvider(chatSessionType: string, provider: IChatSessionCustomizationsProvider): IDisposable;
    hasCustomizationsProvider(chatSessionType: string): boolean;
    getCustomizations(chatSessionType: string, token: CancellationToken): Promise<IChatSessionCustomizationItemGroup[] | undefined>;
}
