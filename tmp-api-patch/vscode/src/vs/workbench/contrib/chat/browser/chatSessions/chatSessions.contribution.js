
import { __decorate, __param } from '../../../../../../../../external/tslib/tslib.es6.js';
import { sep } from '../../../../../base/common/path.js';
import { AsyncIterableProducer, raceCancellationError } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, combinedDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap, ResourceSet } from '../../../../../base/common/map.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, isEqual } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { MenuId, MenuItemAction, MenuRegistry, registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { IMenuService } from '../../../../../platform/actions/common/actions.service.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.service.js';
import '../../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.service.js';
import { ILogService } from '../../../../../platform/log/common/log.service.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.service.js';
import { IEditorService } from '../../../../services/editor/common/editorService.service.js';
import { isProposedApiEnabled } from '../../../../services/extensions/common/extensions.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.service.js';
import { ExtensionsRegistry } from '../../../../services/extensions/common/extensionsRegistry.js';
import { ChatEditorInput } from '../widgetHosts/editor/chatEditorInput.js';
import { IChatAgentService } from '../../common/participants/chatAgents.service.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatSessionsExtensions, isSessionInProgressStatus, localChatSessionType, ChatSessionOptionsMap, ChatSessionStatus } from '../../common/chatSessionsService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.service.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { CHAT_CATEGORY } from '../actions/chatActions.js';
import { ResponseModelState } from '../../common/chatService/chatService.js';
import { IChatService } from '../../common/chatService/chatService.service.js';
import '../../../../../base/common/observableInternal/index.js';
import { toPromptFileVariableEntry, PromptFileVariableKind } from '../../common/attachments/chatVariableEntries.js';
import { IViewsService } from '../../../../services/views/common/viewsService.service.js';
import { ChatViewId } from '../chat.js';
import { AgentSessionProviders, getAgentSessionProviderName, getAgentSessionProvider } from '../agentSessions/agentSessions.js';
import { isCancellationError, BugIndicatingError } from '../../../../../base/common/errors.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.service.js';
import { getChatSessionType, isUntitledChatSession, LocalChatSessionUri } from '../../common/model/chatUri.js';
import { assertNever } from '../../../../../base/common/assert.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.service.js';
import { Target } from '../../common/promptSyntax/promptTypes.js';
import { slashReg } from '../../common/requestParser/chatRequestParser.js';
import { OffsetRange } from '../../../../../editor/common/core/ranges/offsetRange.js';
import { ILanguageModelToolsService } from '../../common/tools/languageModelToolsService.service.js';
import { ICustomizationHarnessService } from '../../common/customizationHarnessService.service.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { observableFromEvent } from '../../../../../base/common/observableInternal/observables/observableFromEvent.js';
import { autorun } from '../../../../../base/common/observableInternal/reactions/autorun.js';

const extensionPoint = ExtensionsRegistry.registerExtensionPoint({
    extensionPoint: "chatSessions",
    jsonSchema: {
        description: ( localize(7180, "Contributes chat session integrations to the chat widget.")),
        type: "array",
        items: {
            type: "object",
            additionalProperties: false,
            properties: {
                type: {
                    description: ( localize(7181, "Unique identifier for the type of chat session.")),
                    type: "string"
                },
                name: {
                    description: ( localize(
                        7182,
                        "Name of the dynamically registered chat participant (eg: @agent). Must not contain whitespace."
                    )),
                    type: "string",
                    pattern: "^[\\w-]+$"
                },
                displayName: {
                    description: ( localize(7183, "A longer name for this item which is used for display in menus.")),
                    type: "string"
                },
                description: {
                    description: ( localize(7184, "Description of the chat session for use in menus and tooltips.")),
                    type: "string"
                },
                when: {
                    description: ( localize(7185, "Condition which must be true to show this item.")),
                    type: "string"
                },
                icon: {
                    description: ( localize(
                        7186,
                        "Icon identifier (codicon ID) for the chat session editor tab. For example, \"{0}\" or \"{1}\".",
                        "$(github)",
                        "$(cloud)"
                    )),
                    anyOf: [{
                        type: "string"
                    }, {
                        type: "object",
                        properties: {
                            light: {
                                description: ( localize(7187, "Icon path when a light theme is used")),
                                type: "string"
                            },
                            dark: {
                                description: ( localize(7188, "Icon path when a dark theme is used")),
                                type: "string"
                            }
                        }
                    }]
                },
                order: {
                    description: ( localize(7189, "Order in which this item should be displayed.")),
                    type: "integer"
                },
                alternativeIds: {
                    description: ( localize(7190, "Alternative identifiers for backward compatibility.")),
                    type: "array",
                    items: {
                        type: "string"
                    }
                },
                welcomeTitle: {
                    description: ( localize(
                        7191,
                        "Title text to display in the chat welcome view for this session type."
                    )),
                    type: "string"
                },
                welcomeMessage: {
                    description: ( localize(
                        7192,
                        "Message text (supports markdown) to display in the chat welcome view for this session type."
                    )),
                    type: "string"
                },
                welcomeTips: {
                    description: ( localize(
                        7193,
                        "Tips text (supports markdown and theme icons) to display in the chat welcome view for this session type."
                    )),
                    type: "string"
                },
                inputPlaceholder: {
                    description: ( localize(
                        7194,
                        "Placeholder text to display in the chat input box for this session type."
                    )),
                    type: "string"
                },
                capabilities: {
                    description: ( localize(7195, "Optional capabilities for this chat session.")),
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        supportsFileAttachments: {
                            description: ( localize(
                                7196,
                                "Whether this chat session supports attaching files or file references."
                            )),
                            type: "boolean"
                        },
                        supportsToolAttachments: {
                            description: ( localize(
                                7197,
                                "Whether this chat session supports attaching tools or tool references."
                            )),
                            type: "boolean"
                        },
                        supportsMCPAttachments: {
                            description: ( localize(7198, "Whether this chat session supports attaching MCP resources.")),
                            type: "boolean"
                        },
                        supportsImageAttachments: {
                            description: ( localize(7199, "Whether this chat session supports attaching images.")),
                            type: "boolean"
                        },
                        supportsSearchResultAttachments: {
                            description: ( localize(7200, "Whether this chat session supports attaching search results.")),
                            type: "boolean"
                        },
                        supportsInstructionAttachments: {
                            description: ( localize(7201, "Whether this chat session supports attaching instructions.")),
                            type: "boolean"
                        },
                        supportsSourceControlAttachments: {
                            description: ( localize(
                                7202,
                                "Whether this chat session supports attaching source control changes."
                            )),
                            type: "boolean"
                        },
                        supportsProblemAttachments: {
                            description: ( localize(7203, "Whether this chat session supports attaching problems.")),
                            type: "boolean"
                        },
                        supportsSymbolAttachments: {
                            description: ( localize(7204, "Whether this chat session supports attaching symbols.")),
                            type: "boolean"
                        },
                        supportsPromptAttachments: {
                            description: ( localize(7205, "Whether this chat session supports attaching prompts.")),
                            type: "boolean"
                        },
                        supportsHandOffs: {
                            description: ( localize(7206, "Whether this chat session supports hand-off prompts.")),
                            type: "boolean"
                        }
                    }
                },
                commands: {
                    markdownDescription: ( localize(
                        7207,
                        "Commands available for this chat session, which the user can invoke with a `/`."
                    )),
                    type: "array",
                    items: {
                        additionalProperties: false,
                        type: "object",
                        defaultSnippets: [{
                            body: {
                                name: "",
                                description: ""
                            }
                        }],
                        required: ["name"],
                        properties: {
                            name: {
                                description: ( localize(
                                    7208,
                                    "A short name by which this command is referred to in the UI, e.g. `fix` or `explain` for commands that fix an issue or explain code. The name should be unique among the commands provided by this participant."
                                )),
                                type: "string"
                            },
                            description: {
                                description: ( localize(7209, "A description of this command.")),
                                type: "string"
                            },
                            when: {
                                description: ( localize(7210, "A condition which must be true to enable this command.")),
                                type: "string"
                            }
                        }
                    }
                },
                canDelegate: {
                    description: ( localize(
                        7211,
                        "Whether delegation is supported. Default is false. Note that enabling this is experimental and may not be respected at all times."
                    )),
                    type: "boolean",
                    default: false
                },
                customAgentTarget: {
                    description: ( localize(
                        7212,
                        "When set, the chat session will show a filtered mode picker that prefers custom agents whose target property matches this value. Custom agents without a target property are still shown in all session types. This enables the use of standard agent/mode with contributed sessions."
                    )),
                    type: "string"
                },
                requiresCustomModels: {
                    description: ( localize(
                        7213,
                        "When set, the chat session will show a filtered model picker that prefers custom models. This enables the use of standard model picker with contributed sessions."
                    )),
                    type: "boolean",
                    default: false
                },
                supportsAutoModel: {
                    description: ( localize(
                        7214,
                        "Whether the chat session supports the synthetic \"Auto\" model fallback. Defaults to false. When true and no models are available, the picker shows \"Auto\" instead of a \"No models available\" state."
                    )),
                    type: "boolean",
                    default: false
                },
                requiresCopilotSignIn: {
                    description: ( localize(
                        7215,
                        "Whether the chat session relies on a GitHub Copilot account and so cannot be used until the user signs in. Defaults to false."
                    )),
                    type: "boolean",
                    default: false
                },
                autoAttachReferences: {
                    description: ( localize(
                        7216,
                        "Whether to automatically attach instruction files to chat requests for this session type."
                    )),
                    type: "boolean",
                    default: false
                },
                useRequestToPopulateBuiltInPickers: {
                    description: ( localize(
                        7217,
                        "Whether to use ChatRequestTurn2 to populate built-in pickers such as the Agent and Model pickers."
                    )),
                    type: "boolean",
                    default: false
                }
            },
            required: ["type", "name", "displayName", "description"]
        }
    },
    activationEventsGenerator: function*(contribs) {
        for (const contrib of contribs) {
            yield `onChatSession:${contrib.type}`;
        }
    }
});
class ContributedChatSessionData extends Disposable {
    getOption(optionId) {
        return this._optionsCache.get(optionId);
    }
    getAllOptions() {
        return this._optionsCache.entries();
    }
    setOption(optionId, value) {
        this._optionsCache.set(optionId, value);
    }
    constructor(session, chatSessionType, resource, options, onWillDispose) {
        super();
        this.session = session;
        this.chatSessionType = chatSessionType;
        this.resource = resource;
        this.options = options;
        this.onWillDispose = onWillDispose;
        this._optionsCache = ( new Map(options));
        this._register(this.session.onWillDispose(() => {
            this.onWillDispose(this.resource);
        }));
    }
}
let ChatSessionsService = class ChatSessionsService extends Disposable {
    get onDidChangeInProgress() {
        return this._onDidChangeInProgress.event;
    }
    get onDidChangeContentProviderSchemes() {
        return this._onDidChangeContentProviderSchemes.event;
    }
    get onDidChangeSessionOptions() {
        return this._onDidChangeSessionOptions.event;
    }
    get onDidChangeOptionGroups() {
        return this._onDidChangeOptionGroups.event;
    }
    constructor(
        _logService,
        _chatAgentService,
        _extensionService,
        _contextKeyService,
        _menuService,
        _themeService,
        _labelService,
        _instantiationService
    ) {
        super();
        this._logService = _logService;
        this._chatAgentService = _chatAgentService;
        this._extensionService = _extensionService;
        this._contextKeyService = _contextKeyService;
        this._menuService = _menuService;
        this._themeService = _themeService;
        this._labelService = _labelService;
        this._instantiationService = _instantiationService;
        this._itemControllers = ( new Map());
        this._asyncActivationRegistry = ( Registry.as(ChatSessionsExtensions.AsyncActivation));
        this._contributions = ( new Map());
        this._contributionDisposables = this._register(( new DisposableMap()));
        this._contentProviders = ( new Map());
        this._alternativeIdMap = ( new Map());
        this._contextKeys = ( new Set());
        this._onDidChangeItemsProviders = this._register(( new Emitter()));
        this.onDidChangeItemsProviders = this._onDidChangeItemsProviders.event;
        this._onDidChangeSessionItems = this._register(( new Emitter()));
        this.onDidChangeSessionItems = this._onDidChangeSessionItems.event;
        this._onDidCommitSession = this._register(( new Emitter()));
        this.onDidCommitSession = this._onDidCommitSession.event;
        this._onDidChangeAvailability = this._register(( new Emitter()));
        this.onDidChangeAvailability = this._onDidChangeAvailability.event;
        this._onDidChangeInProgress = this._register(( new Emitter()));
        this._onDidChangeContentProviderSchemes = this._register(( new Emitter()));
        this._onDidChangeSessionOptions = this._register(( new Emitter()));
        this._onDidChangeOptionGroups = this._register(( new Emitter()));
        this.inProgressMap = ( new Map());
        this._sessionTypeOptions = ( new Map());
        this._sessions = ( new ResourceMap());
        this._resourceAliases = ( new ResourceMap());
        this._realResources = ( new ResourceMap());
        this._customizationsProviders = ( new Map());
        this._onDidChangeCustomizations = this._register(( new Emitter()));
        this.onDidChangeCustomizations = this._onDidChangeCustomizations.event;
        this._hasCanDelegateProvidersKey = ChatContextKeys.hasCanDelegateProviders.bindTo(this._contextKeyService);
        this._register(extensionPoint.setHandler(extensions => {
            for (const ext of extensions) {
                if (!isProposedApiEnabled(ext.description)) {
                    continue;
                }
                if (!Array.isArray(ext.value)) {
                    continue;
                }
                for (const contribution of ext.value) {
                    this._register(this.registerContribution(contribution, ext.description));
                }
            }
        }));
        this._register(Event.filter(
            this._contextKeyService.onDidChangeContext,
            e => e.affectsSome(this._contextKeys)
        )(() => {
            this._evaluateAvailability();
        }));
        const builtinSessionProviders = [AgentSessionProviders.Local];
        const contributedSessionProviders = observableFromEvent(this.onDidChangeAvailability, () => Array.from(( this._contributions.keys())).filter(key => ( this._contributionDisposables.has(key)))).recomputeInitiallyAndOnChange(this._store);
        this._register(autorun(reader => {
            const activatedProviders = contributedSessionProviders.read(reader);
            for (const provider of builtinSessionProviders) {
                reader.store.add(
                    registerNewSessionInPlaceAction(provider, getAgentSessionProviderName(provider))
                );
            }
            for (const type of activatedProviders) {
                const knownProvider = getAgentSessionProvider(type);
                if (knownProvider) {
                    const label = getAgentSessionProviderName(knownProvider);
                    reader.store.add(registerNewSessionInPlaceAction(type, label));
                } else {
                    const contrib = this._contributions.get(type);
                    if (contrib) {
                        reader.store.add(registerNewSessionInPlaceAction(
                            type,
                            contrib.contribution.displayName ?? contrib.contribution.name ?? type
                        ));
                    }
                }
            }
        }));
        this._register(this._labelService.registerFormatter({
            scheme: Schemas.copilotPr,
            formatting: {
                label: "${authority}${path}",
                separator: sep,
                stripPathStartingSeparator: true
            }
        }));
    }
    reportInProgress(chatSessionType, count) {
        if (!( this._itemControllers.has(chatSessionType))) {
            this._logService.warn(
                `Attempted to report in-progress status for unknown chat session type '${chatSessionType}'`
            );
        }
        this.inProgressMap.set(chatSessionType, count);
        this._onDidChangeInProgress.fire();
    }
    getInProgress() {
        return ( Array.from(this.inProgressMap.entries()).map(([chatSessionType, count]) => ({
            chatSessionType,
            count
        })));
    }
    async resolveChatSessionItem(chatSessionType, resource, token) {
        const entry = this._itemControllers.get(chatSessionType);
        if (!entry?.controller.resolveChatSessionItem) {
            return undefined;
        }
        return entry.controller.resolveChatSessionItem(resource, token);
    }
    async updateInProgressStatus(chatSessionType) {
        try {
            const items = [];
            for await (const result of this.getChatSessionItems([chatSessionType], CancellationToken.None)) {
                items.push(...result.items);
            }
            const inProgress = items.filter(
                item => !item.archived && item.status && isSessionInProgressStatus(item.status)
            );
            this.reportInProgress(chatSessionType, inProgress.length);
        } catch (error) {
            this._logService.warn(
                `Failed to update in-progress status for chat session type '${chatSessionType}':`,
                error
            );
        }
    }
    registerContribution(contribution, ext) {
        this._logService.trace(
            `[ChatSessionsService] registerContribution called for type='${contribution.type}', canDelegate=${contribution.canDelegate}, when='${contribution.when}', extension='${ext.identifier.value}'`
        );
        if (( this._contributions.has(contribution.type))) {
            this._logService.trace(
                `[ChatSessionsService] registerContribution: type='${contribution.type}' already registered, skipping`
            );
            return Disposable.None;
        }
        if (contribution.when) {
            const whenExpr = ContextKeyExpr.deserialize(contribution.when);
            if (whenExpr) {
                for (const key of ( whenExpr.keys())) {
                    this._contextKeys.add(key);
                }
            }
        }
        this._contributions.set(contribution.type, {
            contribution,
            extension: ext
        });
        if (contribution.alternativeIds) {
            for (const altId of contribution.alternativeIds) {
                if (( this._alternativeIdMap.has(altId))) {
                    this._logService.warn(
                        `Alternative ID '${altId}' is already mapped to '${this._alternativeIdMap.get(altId)}'. Remapping to '${contribution.type}'.`
                    );
                }
                this._alternativeIdMap.set(altId, contribution.type);
            }
        }
        this._evaluateAvailability();
        return {
            dispose: () => {
                this._contributions.delete(contribution.type);
                if (contribution.alternativeIds) {
                    for (const altId of contribution.alternativeIds) {
                        if (this._alternativeIdMap.get(altId) === contribution.type) {
                            this._alternativeIdMap.delete(altId);
                        }
                    }
                }
                this._contributionDisposables.deleteAndDispose(contribution.type);
                this._updateHasCanDelegateProvidersContextKey();
            }
        };
    }
    _isContributionAvailable(contribution) {
        if (!contribution.when) {
            return true;
        }
        const whenExpr = ContextKeyExpr.deserialize(contribution.when);
        return !whenExpr || this._contextKeyService.contextMatchesRules(whenExpr);
    }
    _isContributionAvailableForType(sessionType) {
        const primaryType = ( this._contributions.has(sessionType)) ? sessionType : this._alternativeIdMap.get(sessionType);
        const contribution = primaryType ? this._contributions.get(primaryType)?.contribution : undefined;
        return !contribution || this._isContributionAvailable(contribution);
    }
    _resolveToPrimaryType(sessionType) {
        const contribution = this._contributions.get(sessionType)?.contribution;
        if (contribution) {
            if (this._isContributionAvailable(contribution)) {
                return sessionType;
            }
        }
        const primaryType = this._alternativeIdMap.get(sessionType);
        if (primaryType) {
            const altContribution = this._contributions.get(primaryType)?.contribution;
            if (altContribution && this._isContributionAvailable(altContribution)) {
                return primaryType;
            }
        }
        return undefined;
    }
    _registerMenuItems(contribution, extensionDescription) {
        const disposables = ( new DisposableStore());
        if (!contribution.canDelegate) {
            disposables.add(registerNewSessionExternalAction(
                contribution.type,
                contribution.displayName,
                () => this._resolveCreateSubMenuCommandId(contribution.type)
            ));
        }
        const contextKeyService = this._contextKeyService.createOverlay([["chatSessionType", contribution.type]]);
        const rawMenuActions = this._menuService.getMenuActions(MenuId.AgentSessionsCreateSubMenu, contextKeyService);
        const menuActions = ( rawMenuActions.map(value => value[1])).flat();
        const menuItemActions = menuActions.filter(action => action instanceof MenuItemAction);
        const actionsToMirror = contribution.canDelegate ? menuItemActions : menuItemActions.slice(1);
        for (const action of actionsToMirror) {
            disposables.add(MenuRegistry.appendMenuItem(MenuId.ChatNewMenu, {
                command: action.item,
                group: "4_externally_contributed"
            }));
        }
        return {
            dispose: () => disposables.dispose()
        };
    }
    _resolveCreateSubMenuCommandId(type) {
        const contextKeyService = this._contextKeyService.createOverlay([["chatSessionType", type]]);
        const rawMenuActions = this._menuService.getMenuActions(MenuId.AgentSessionsCreateSubMenu, contextKeyService);
        const menuActions = ( rawMenuActions.map(value => value[1])).flat();
        for (const action of menuActions) {
            if (action instanceof MenuItemAction) {
                return action.item.id;
            }
        }
        return undefined;
    }
    _registerCommands(contribution) {
        const isAvailableInSessionTypePicker = isAgentSessionProviderType(contribution.type);
        return combinedDisposable(registerAction2(class OpenChatSessionAction extends Action2 {
            constructor() {
                super({
                    id: `workbench.action.chat.openSessionWithPrompt.${contribution.type}`,
                    title: ( localize2(7218, "New {0} with Prompt", contribution.displayName)),
                    category: CHAT_CATEGORY,
                    icon: Codicon.plus,
                    f1: false,
                    precondition: ChatContextKeys.enabled
                });
            }
            async run(accessor, chatOptions) {
                const chatService = accessor.get(IChatService);
                const customizationHarnessService = accessor.get(ICustomizationHarnessService);
                const toolsService = accessor.get(ILanguageModelToolsService);
                const {
                    type
                } = contribution;
                if (chatOptions) {
                    let attachedContext = chatOptions.attachedContext;
                    const sessionResource = URI.revive(chatOptions.resource);
                    const ref = await chatService.acquireOrLoadSession(
                        sessionResource,
                        ChatAgentLocation.Chat,
                        CancellationToken.None,
                        "ChatSessionsContribution#sendPrompt"
                    );
                    try {
                        const promptFile = await resolvePromptSlashCommand(
                            chatOptions.prompt,
                            sessionResource,
                            customizationHarnessService,
                            toolsService
                        );
                        if (promptFile) {
                            attachedContext = [promptFile, ...(attachedContext ?? [])];
                        }
                        const result = await chatService.sendRequest(sessionResource, chatOptions.prompt, {
                            agentIdSilent: type,
                            attachedContext
                        });
                        if (result.kind === "queued") {
                            await result.deferred;
                        } else if (result.kind === "sent") {
                            await result.data.responseCompletePromise;
                        }
                    } finally {
                        ref?.dispose();
                    }
                }
            }
        }),
        registerAction2(class OpenNewChatSessionEditorAction extends Action2 {
            constructor() {
                super({
                    id: `workbench.action.chat.openNewSessionEditor.${contribution.type}`,
                    title: ( localize2(7219, "New {0} Session", contribution.displayName)),
                    category: CHAT_CATEGORY,
                    icon: Codicon.plus,
                    f1: true,
                    precondition: ChatContextKeys.enabled
                });
            }
            async run(accessor, chatOptions) {
                const {
                    type,
                    displayName
                } = contribution;
                await openChatSession(accessor, {
                    type,
                    displayName,
                    position: ChatSessionPosition.Editor
                }, chatOptions);
            }
        }),
        registerAction2(class OpenNewChatSessionSidebarAction extends Action2 {
            constructor() {
                super({
                    id: `workbench.action.chat.openNewSessionSidebar.${contribution.type}`,
                    title: ( localize2(7220, "New {0} Session", contribution.displayName)),
                    category: CHAT_CATEGORY,
                    icon: Codicon.plus,
                    f1: false,
                    precondition: ChatContextKeys.enabled,
                    menu: !isAvailableInSessionTypePicker ? {
                        id: MenuId.ChatNewMenu,
                        group: "3_new_special"
                    } : undefined
                });
            }
            async run(accessor, chatOptions) {
                const {
                    type,
                    displayName
                } = contribution;
                await openChatSession(accessor, {
                    type,
                    displayName,
                    position: ChatSessionPosition.Sidebar
                }, chatOptions);
            }
        }));
    }
    _evaluateAvailability() {
        const newlyEnabledChatSessionTypes = ( new Set());
        const newlyDisabledChatSessionTypes = ( new Set());
        const disposedChatSessions = ( new ResourceSet());
        for (const {
            contribution,
            extension
        } of ( this._contributions.values())) {
            const isCurrentlyRegistered = ( this._contributionDisposables.has(contribution.type));
            const shouldBeRegistered = this._isContributionAvailable(contribution);
            this._logService.trace(
                `[ChatSessionsService] _evaluateAvailability: type='${contribution.type}', isCurrentlyRegistered=${isCurrentlyRegistered}, shouldBeRegistered=${shouldBeRegistered}, when='${contribution.when}'`
            );
            if (isCurrentlyRegistered && !shouldBeRegistered) {
                this._contributionDisposables.deleteAndDispose(contribution.type);
                for (const sessionResource of this._disposeSessionsForContribution(contribution.type)) {
                    disposedChatSessions.add(sessionResource);
                }
                newlyDisabledChatSessionTypes.add(contribution.type);
            } else if (!isCurrentlyRegistered && shouldBeRegistered) {
                if (extension) {
                    this._enableContribution(contribution, extension);
                }
                newlyEnabledChatSessionTypes.add(contribution.type);
            }
        }
        if (newlyEnabledChatSessionTypes.size > 0 || newlyDisabledChatSessionTypes.size > 0) {
            this._onDidChangeAvailability.fire();
            for (const chatSessionType of [...newlyEnabledChatSessionTypes, ...newlyDisabledChatSessionTypes]) {
                this._onDidChangeItemsProviders.fire({
                    chatSessionType
                });
            }
            if (disposedChatSessions.size > 0) {
                this._onDidChangeSessionItems.fire({
                    removed: Array.from(disposedChatSessions)
                });
            }
        }
        this._updateHasCanDelegateProvidersContextKey();
    }
    _enableContribution(contribution, ext) {
        this._logService.trace(
            `[ChatSessionsService] _enableContribution: type='${contribution.type}', canDelegate=${contribution.canDelegate}`
        );
        const disposableStore = ( new DisposableStore());
        this._contributionDisposables.set(contribution.type, disposableStore);
        if (contribution.canDelegate) {
            disposableStore.add(this._registerAgent(contribution, ext));
            disposableStore.add(this._registerCommands(contribution));
        }
        disposableStore.add(this._registerMenuItems(contribution, ext));
    }
    _disposeSessionsForContribution(contributionId) {
        const sessionsToDispose = [];
        for (const [sessionResource, sessionData] of this._sessions) {
            if (sessionData.chatSessionType === contributionId) {
                sessionsToDispose.push(sessionResource);
            }
        }
        if (sessionsToDispose.length > 0) {
            this._logService.info(
                `Disposing ${sessionsToDispose.length} cached sessions for contribution '${contributionId}' due to when clause change`
            );
        }
        for (const sessionKey of sessionsToDispose) {
            const sessionData = this._sessions.get(sessionKey);
            if (sessionData) {
                sessionData.dispose();
            }
        }
        return sessionsToDispose;
    }
    _registerAgent(contribution, ext) {
        const storedIcon = this.getContributionIcon(ext, contribution);
        const icons = ThemeIcon.isThemeIcon(storedIcon) ? {
            themeIcon: storedIcon,
            icon: undefined,
            iconDark: undefined
        } : storedIcon ? {
            icon: storedIcon.light,
            iconDark: storedIcon.dark
        } : {
            themeIcon: Codicon.sendToRemoteAgent
        };
        const id = contribution.type;
        const agentData = {
            id,
            name: contribution.name,
            fullName: contribution.displayName,
            description: contribution.description,
            isDefault: false,
            isCore: false,
            isDynamic: true,
            slashCommands: contribution.commands ?? [],
            locations: [ChatAgentLocation.Chat],
            modes: [ChatModeKind.Agent, ChatModeKind.Ask],
            disambiguation: [],
            metadata: {
                ...icons
            },
            capabilities: contribution.capabilities,
            canAccessPreviousChatHistory: true,
            extensionId: ext.identifier,
            extensionVersion: ext.version,
            extensionDisplayName: ext.displayName || ext.name,
            extensionPublisherId: ext.publisher
        };
        return this._chatAgentService.registerAgent(id, agentData);
    }
    getAllChatSessionContributions() {
        return ( Array.from(( this._contributions.values())).filter(entry => this._isContributionAvailable(entry.contribution)).map(
            entry => this.resolveChatSessionContribution(entry.extension, entry.contribution)
        ));
    }
    _updateHasCanDelegateProvidersContextKey() {
        const hasCanDelegate = this.getAllChatSessionContributions().filter(c => c.canDelegate);
        const canDelegateEnabled = hasCanDelegate.length > 0;
        this._logService.trace(
            `[ChatSessionsService] hasCanDelegateProvidersAvailable=${canDelegateEnabled} (${( hasCanDelegate.map(c => c.type)).join(", ")})`
        );
        this._hasCanDelegateProvidersKey.set(canDelegateEnabled);
    }
    getChatSessionContribution(chatSessionType) {
        const entry = this._contributions.get(chatSessionType);
        if (!entry) {
            return undefined;
        }
        if (!this._isContributionAvailable(entry.contribution)) {
            return undefined;
        }
        return this.resolveChatSessionContribution(entry.extension, entry.contribution);
    }
    resolveChatSessionContribution(ext, contribution) {
        return {
            ...contribution,
            icon: this.resolveIconForCurrentColorTheme(this.getContributionIcon(ext, contribution))
        };
    }
    getContributionIcon(ext, contribution) {
        if (!contribution.icon) {
            return undefined;
        }
        if (typeof contribution.icon === "string") {
            return contribution.icon.startsWith("$(") && contribution.icon.endsWith(")") ? ThemeIcon.fromString(contribution.icon) : ThemeIcon.fromId(contribution.icon);
        }
        return {
            dark: ext ? joinPath(ext.extensionLocation, contribution.icon.dark) : ( URI.parse(contribution.icon.dark)),
            light: ext ? joinPath(ext.extensionLocation, contribution.icon.light) : ( URI.parse(contribution.icon.light))
        };
    }
    resolveIconForCurrentColorTheme(rawIcon) {
        if (!rawIcon) {
            return undefined;
        }
        if (ThemeIcon.isThemeIcon(rawIcon)) {
            return rawIcon;
        } else if (isDark(this._themeService.getColorTheme().type)) {
            return rawIcon.dark;
        } else {
            return rawIcon.light;
        }
    }
    registerChatSessionContribution(contribution) {
        if (( this._contributions.has(contribution.type))) {
            return {
                dispose: () => {}
            };
        }
        this._contributions.set(contribution.type, {
            contribution,
            extension: undefined
        });
        this._contributionDisposables.set(contribution.type, ( new DisposableStore()));
        this._updateHasCanDelegateProvidersContextKey();
        this._onDidChangeAvailability.fire();
        return toDisposable(() => {
            this._contributions.delete(contribution.type);
            this._contributionDisposables.deleteAndDispose(contribution.type);
            this._updateHasCanDelegateProvidersContextKey();
            this._onDidChangeAvailability.fire();
        });
    }
    async activateChatSessionItemProvider(chatViewType) {
        await this.doActivateChatSessionItemController(chatViewType);
    }
    async doActivateChatSessionItemController(chatViewType) {
        await this._extensionService.whenInstalledExtensionsRegistered();
        const resolvedType = this._resolveToPrimaryType(chatViewType);
        if (resolvedType) {
            chatViewType = resolvedType;
        }
        if (!this._isContributionAvailableForType(chatViewType)) {
            return false;
        }
        if (( this._itemControllers.has(chatViewType))) {
            return true;
        }
        await this._extensionService.activateByEvent(`onChatSession:${chatViewType}`);
        const controller = this._itemControllers.get(chatViewType);
        return !!controller;
    }
    async canResolveChatSession(sessionType) {
        await this._extensionService.whenInstalledExtensionsRegistered();
        if (!this._isContributionAvailableForType(sessionType)) {
            return false;
        }
        if (( this._contentProviders.has(sessionType))) {
            return true;
        }
        const asyncActivators = this._asyncActivationRegistry.getActivators(sessionType);
        if (asyncActivators.length) {
            for (const activator of asyncActivators) {
                if (await this._instantiationService.invokeFunction(accessor => activator.waitForActivation(accessor, sessionType))) {
                    await this.waitForContentProvider(sessionType);
                    if (( this._contentProviders.has(sessionType))) {
                        return true;
                    }
                }
            }
            return false;
        }
        await this._extensionService.activateByEvent(`onChatSession:${sessionType}`);
        return ( this._contentProviders.has(sessionType));
    }
    async waitForContentProvider(sessionType) {
        if (( this._contentProviders.has(sessionType))) {
            return;
        }
        await Event.toPromise(
            Event.filter(this.onDidChangeContentProviderSchemes, e => e.added.includes(sessionType))
        );
    }
    async provideChatInputCompletions(sessionResource, params, token) {
        const sessionType = getChatSessionType(sessionResource);
        const resolvedType = this._resolveToPrimaryType(sessionType) || sessionType;
        const provider = this._contentProviders.get(resolvedType);
        if (!provider?.provideChatInputCompletions) {
            return undefined;
        }
        return provider.provideChatInputCompletions(sessionResource, params, token);
    }
    resolveChatResponseUri(sessionResource, href, kind) {
        const sessionType = getChatSessionType(sessionResource);
        const resolvedType = this._resolveToPrimaryType(sessionType) || sessionType;
        return this._contentProviders.get(resolvedType)?.resolveChatResponseUri?.(sessionResource, href, kind) ?? href;
    }
    async getChatInputCompletionTriggerCharacters(sessionType) {
        const resolvedType = this._resolveToPrimaryType(sessionType) || sessionType;
        const provider = this._contentProviders.get(resolvedType);
        if (!provider) {
            return undefined;
        }
        if (!provider.provideChatInputCompletionTriggerCharacters) {
            return [];
        }
        return provider.provideChatInputCompletionTriggerCharacters();
    }
    async tryActivateControllers(providersToResolve) {
        await Promise.all(( this.getAllChatSessionContributions().map(async contrib => {
            if (providersToResolve && !providersToResolve.includes(contrib.type)) {
                return;
            }
            if (!(await this.doActivateChatSessionItemController(contrib.type))) {
                if (providersToResolve?.includes(contrib.type)) {
                    this._logService.trace(
                        `[ChatSessionsService] No enabled provider found for chat session type ${contrib.type}`
                    );
                }
            }
        })));
    }
    getChatSessionItems(providersToResolve, token) {
        return new AsyncIterableProducer(async writer => {
            await raceCancellationError(this.tryActivateControllers(providersToResolve), token);
            await Promise.all(
                Array.from(this._itemControllers, async ([chatSessionType, controllerEntry]) => {
                    const resolvedType = this._resolveToPrimaryType(chatSessionType) ?? chatSessionType;
                    if (providersToResolve && !providersToResolve.includes(resolvedType)) {
                        return;
                    }
                    if (!this._isContributionAvailableForType(chatSessionType)) {
                        return;
                    }
                    try {
                        await raceCancellationError(controllerEntry.initialRefresh, token);
                        const providerSessions = controllerEntry.controller.items;
                        this._logService.trace(
                            `[ChatSessionsService] Resolved ${providerSessions.length} sessions for provider ${resolvedType}`
                        );
                        writer.emitOne({
                            chatSessionType: resolvedType,
                            items: providerSessions
                        });
                    } catch (err) {
                        if (!isCancellationError(err)) {
                            this._logService.error(
                                `[ChatSessionsService] Failed to resolve sessions for provider ${resolvedType}`,
                                err
                            );
                        }
                    }
                })
            );
        });
    }
    async refreshChatSessionItems(providersToResolve, token) {
        await this.tryActivateControllers(providersToResolve);
        await Promise.all(( Array.from(this._itemControllers).map(async ([chatSessionType, controllerEntry]) => {
            const resolvedType = this._resolveToPrimaryType(chatSessionType) ?? chatSessionType;
            if (providersToResolve && !providersToResolve.includes(resolvedType)) {
                return;
            }
            try {
                await controllerEntry.controller.refresh(token);
            } catch (err) {
                if (!isCancellationError(err)) {
                    this._logService.error(
                        `[ChatSessionsService] Failed to resolve sessions for provider ${resolvedType}`,
                        err
                    );
                }
            }
        })));
    }
    getRegisteredChatSessionItemProviders() {
        return [...( new Set(( Array.from(( this._itemControllers.keys())).map(key => this._resolveToPrimaryType(key) ?? key))))];
    }
    registerChatSessionItemController(chatSessionType, controller) {
        const disposables = ( new DisposableStore());
        const initialRefreshCts = disposables.add(( new CancellationTokenSource()));
        this._itemControllers.set(chatSessionType, {
            controller,
            initialRefresh: controller.refresh(initialRefreshCts.token)
        });
        this._onDidChangeItemsProviders.fire({
            chatSessionType
        });
        disposables.add(controller.onDidChangeChatSessionItems(e => {
            this._onDidChangeSessionItems.fire(e);
            this.updateInProgressStatus(chatSessionType);
        }));
        return {
            dispose: () => {
                initialRefreshCts.cancel();
                disposables.dispose();
                const controller = this._itemControllers.get(chatSessionType);
                if (controller) {
                    this._itemControllers.delete(chatSessionType);
                    this._onDidChangeItemsProviders.fire({
                        chatSessionType
                    });
                }
                this.updateInProgressStatus(chatSessionType);
            }
        };
    }
    registerChatSessionContentProvider(chatSessionType, provider) {
        if (( this._contentProviders.has(chatSessionType))) {
            throw ( new Error(`Content provider for ${chatSessionType} is already registered.`));
        }
        this._contentProviders.set(chatSessionType, provider);
        this._onDidChangeContentProviderSchemes.fire({
            added: [chatSessionType],
            removed: []
        });
        return {
            dispose: () => {
                this._contentProviders.delete(chatSessionType);
                this._onDidChangeContentProviderSchemes.fire({
                    added: [],
                    removed: [chatSessionType]
                });
                for (const [key, session] of this._sessions) {
                    if (session.chatSessionType === chatSessionType) {
                        session.dispose();
                        this._sessions.delete(key);
                    }
                }
            }
        };
    }
    registerCustomizationsProvider(chatSessionType, provider) {
        this._customizationsProviders.set(chatSessionType, provider);
        const onChangeDisposable = provider.onDidChangeCustomizations(() => {
            this._onDidChangeCustomizations.fire({
                chatSessionType
            });
        });
        return toDisposable(() => {
            onChangeDisposable.dispose();
            if (this._customizationsProviders.get(chatSessionType) === provider) {
                this._customizationsProviders.delete(chatSessionType);
            }
        });
    }
    hasCustomizationsProvider(chatSessionType) {
        return ( this._customizationsProviders.has(chatSessionType));
    }
    async getCustomizations(chatSessionType, token) {
        const provider = this._customizationsProviders.get(chatSessionType);
        if (!provider) {
            return undefined;
        }
        return provider.provideCustomizations(token);
    }
    async createNewChatSessionItem(chatSessionType, request, token) {
        const controllerData = this._itemControllers.get(chatSessionType);
        if (!controllerData) {
            return undefined;
        }
        await controllerData.initialRefresh;
        return controllerData.controller.newChatSessionItem?.(request, token);
    }
    async deleteChatSessionItem(sessionResource, token) {
        const sessionType = getChatSessionType(sessionResource);
        const resolvedType = this._resolveToPrimaryType(sessionType) ?? sessionType;
        const controllerData = this._itemControllers.get(resolvedType);
        if (!controllerData?.controller.deleteChatSessionItem) {
            throw ( new Error(`Session ${( sessionResource.toString())} does not support deletion`));
        }
        await controllerData.initialRefresh;
        return controllerData.controller.deleteChatSessionItem(sessionResource, token);
    }
    async getOrCreateChatSession(sessionResource, token) {
        {
            const existingSessionData = this._sessions.get(sessionResource);
            if (existingSessionData) {
                return existingSessionData.session;
            }
        }
        const sessionType = getChatSessionType(sessionResource);
        if (!(await raceCancellationError(this.canResolveChatSession(sessionType), token))) {
            throw Error(`Cannot find provider '${sessionType}'`);
        }
        {
            const existingSessionData = this._sessions.get(sessionResource);
            if (existingSessionData) {
                return existingSessionData.session;
            }
        }
        const resolvedType = this._resolveToPrimaryType(sessionType) || sessionType;
        const provider = this._contentProviders.get(resolvedType);
        if (!provider) {
            throw Error(`Cannot find provider '${resolvedType}'`);
        }
        let session;
        const newSessionOptionGroups = isUntitledChatSession(sessionResource) ? await this.getNewChatSessionInputState(resolvedType, sessionResource) : undefined;
        if (isUntitledChatSession(sessionResource) && (newSessionOptionGroups || resolvedType.startsWith("agent-host-"))) {
            const options = ( new Map());
            for (const group of newSessionOptionGroups ?? []) {
                const selected = group.selected ?? group.items.find(item => item.default) ?? group.items[0];
                if (selected) {
                    options.set(group.id, selected);
                }
            }
            session = {
                sessionResource: sessionResource,
                onWillDispose: Event.None,
                history: [],
                options: options.size > 0 ? options : undefined,
                dispose: () => {}
            };
        } else {
            session = await raceCancellationError(provider.provideChatSessionContent(sessionResource, token), token);
        }
        if (session.options) {
            for (const [optionId, value] of session.options) {
                this.setSessionOption(sessionResource, optionId, value);
            }
        }
        {
            const existingSessionData = this._sessions.get(sessionResource);
            if (existingSessionData) {
                return existingSessionData.session;
            }
        }
        const sessionData = ( new ContributedChatSessionData(session, sessionType, sessionResource, session.options, resource => {
            sessionData.dispose();
            this._sessions.delete(resource);
        }));
        this._sessions.set(sessionResource, sessionData);
        if (session.options) {
            this._onDidChangeSessionOptions.fire({
                sessionResource,
                updates: session.options
            });
        }
        return session;
    }
    hasAnySessionOptions(sessionResource) {
        const session = this._sessions.get(this._resolveResource(sessionResource));
        return !!session && !!session.options && session.options.size > 0;
    }
    getSessionOptions(sessionResource) {
        const session = this._sessions.get(this._resolveResource(sessionResource));
        if (!session) {
            return undefined;
        }
        const result = ( new Map());
        for (const [key, value] of session.getAllOptions()) {
            result.set(key, typeof value === "string" ? value : value.id);
        }
        return result.size > 0 ? result : undefined;
    }
    getSessionOption(sessionResource, optionId) {
        const session = this._sessions.get(this._resolveResource(sessionResource));
        return session?.getOption(optionId);
    }
    setSessionOption(sessionResource, optionId, value) {
        return this.updateSessionOptions(sessionResource, ( new Map([[optionId, value]])));
    }
    updateSessionOptions(sessionResource, updates) {
        const session = this._sessions.get(this._resolveResource(sessionResource));
        if (!session) {
            return false;
        }
        let didChange = false;
        for (const [optionId, value] of updates) {
            const existingValue = session.getOption(optionId);
            if (existingValue !== value) {
                session.setOption(optionId, value);
                didChange = true;
            }
        }
        if (didChange) {
            this._onDidChangeSessionOptions.fire({
                sessionResource,
                updates: updates
            });
        }
        return didChange;
    }
    _resolveResource(resource) {
        return this._resourceAliases.get(resource) ?? resource;
    }
    registerSessionResourceAlias(untitledResource, realResource) {
        this._resourceAliases.set(realResource, untitledResource);
    }
    setMaterializedSessionResource(untitledResource, realResource) {
        this._realResources.set(untitledResource, realResource);
    }
    getMaterializedSessionResource(untitledResource) {
        return this._realResources.get(untitledResource);
    }
    clearMaterializedSessionResource(sessionResource) {
        this._realResources.delete(sessionResource);
        const untitled = this._resourceAliases.get(sessionResource);
        if (untitled) {
            this._realResources.delete(untitled);
        }
    }
    fireSessionCommitted(original, committed) {
        this._onDidCommitSession.fire({
            original,
            committed
        });
    }
    setOptionGroupsForSessionType(chatSessionType, handle, optionGroups) {
        if (optionGroups) {
            this._sessionTypeOptions.set(chatSessionType, optionGroups);
        } else {
            this._sessionTypeOptions.delete(chatSessionType);
        }
        this._onDidChangeOptionGroups.fire(chatSessionType);
    }
    getOptionGroupsForSessionType(chatSessionType) {
        return this._sessionTypeOptions.get(chatSessionType);
    }
    async getNewChatSessionInputState(chatSessionType, sessionResource) {
        const controllerData = this._itemControllers.get(chatSessionType);
        if (controllerData?.controller.getNewChatSessionInputState) {
            const groups = await controllerData.controller.getNewChatSessionInputState(sessionResource, CancellationToken.None);
            if (groups?.length) {
                this._sessionTypeOptions.set(chatSessionType, [...groups]);
                this._onDidChangeOptionGroups.fire(chatSessionType);
            }
            return groups;
        }
        const groups = this._sessionTypeOptions.get(chatSessionType);
        if (!groups?.length) {
            return undefined;
        }
        return groups;
    }
    getCapabilitiesForSessionType(chatSessionType) {
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return contribution?.capabilities;
    }
    getCustomAgentTargetForSessionType(chatSessionType) {
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return contribution?.customAgentTarget ?? Target.Undefined;
    }
    requiresCustomModelsForSessionType(chatSessionType) {
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return !!contribution?.requiresCustomModels;
    }
    supportsAutoModelForSessionType(chatSessionType) {
        if (chatSessionType === localChatSessionType) {
            return true;
        }
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return !!contribution?.supportsAutoModel;
    }
    supportsDelegationForSessionType(chatSessionType) {
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return contribution?.supportsDelegation !== false;
    }
    requiresCopilotSignInForSessionType(chatSessionType) {
        const contribution = this._contributions.get(chatSessionType)?.contribution;
        return !!contribution?.requiresCopilotSignIn;
    }
    sessionSupportsFork(sessionResource) {
        const session =
        this._sessions.get(sessionResource) ?? this._sessions.get(this._resolveResource(sessionResource));
        return !!session?.session.forkSession;
    }
    async forkChatSession(sessionResource, request, token) {
        const session =
        this._sessions.get(sessionResource) ?? this._sessions.get(this._resolveResource(sessionResource));
        if (!session?.session.forkSession) {
            throw ( new Error(`Session ${( sessionResource.toString())} does not support forking`));
        }
        return session.session.forkSession(request, token);
    }
    sessionSupportsRename(sessionResource) {
        const session =
        this._sessions.get(sessionResource) ?? this._sessions.get(this._resolveResource(sessionResource));
        return !!session?.session.renameSession;
    }
    async renameChatSession(sessionResource, title, token) {
        const session = await this.getOrCreateChatSession(sessionResource, token);
        if (!session.renameSession) {
            throw ( new Error(`Session ${( sessionResource.toString())} does not support renaming`));
        }
        return session.renameSession(title, token);
    }
    getContentProviderSchemes() {
        return Array.from(( this._contentProviders.keys()));
    }
};
ChatSessionsService = ( __decorate([( __param(0, ILogService)), ( __param(1, IChatAgentService)), ( __param(2, IExtensionService)), ( __param(3, IContextKeyService)), ( __param(4, IMenuService)), ( __param(5, IThemeService)), ( __param(6, ILabelService)), ( __param(7, IInstantiationService))], ChatSessionsService));
function registerNewSessionInPlaceAction(type, displayName) {
    return registerAction2(class NewChatSessionInPlaceAction extends Action2 {
        constructor() {
            super({
                id: `workbench.action.chat.openNewChatSessionInPlace.${type}`,
                title: ( localize2(7221, "New {0} Session", displayName)),
                category: CHAT_CATEGORY,
                f1: false,
                precondition: ChatContextKeys.enabled
            });
        }
        async run(accessor, ...args) {
            if (args.length === 0) {
                throw ( new BugIndicatingError("Expected chat session position argument"));
            }
            const chatSessionPosition = args[0];
            if (chatSessionPosition !== ChatSessionPosition.Sidebar && chatSessionPosition !== ChatSessionPosition.Editor) {
                throw ( new BugIndicatingError(`Invalid chat session position argument: ${chatSessionPosition}`));
            }
            await openChatSession(accessor, {
                type: type,
                displayName: ( localize(7222, "Chat")),
                position: chatSessionPosition,
                replaceEditor: true
            });
        }
    });
}
function registerNewSessionExternalAction(type, displayName, resolveCommandId) {
    return registerAction2(class NewChatSessionExternalAction extends Action2 {
        constructor() {
            super({
                id: `workbench.action.chat.openNewChatSessionExternal.${type}`,
                title: ( localize2(7223, "New {0} Session", displayName)),
                category: CHAT_CATEGORY,
                f1: false,
                precondition: ChatContextKeys.enabled
            });
        }
        async run(accessor) {
            const commandService = accessor.get(ICommandService);
            const logService = accessor.get(ILogService);
            const commandId = resolveCommandId();
            if (!commandId) {
                logService.warn(
                    `[ChatSessionsService] No create command contributed to '${MenuId.AgentSessionsCreateSubMenu.id}' for chat session type '${type}'; cannot open a new session.`
                );
                return;
            }
            await commandService.executeCommand(commandId);
        }
    });
}
var ChatSessionPosition;
(function(ChatSessionPosition) {
    ChatSessionPosition["Editor"] = "editor";
    ChatSessionPosition["Sidebar"] = "sidebar";
})(ChatSessionPosition || (ChatSessionPosition = {}));
async function openChatSession(accessor, openOptions, chatSendOptions) {
    const viewsService = accessor.get(IViewsService);
    const chatService = accessor.get(IChatService);
    const chatSessionService = accessor.get(IChatSessionsService);
    const logService = accessor.get(ILogService);
    const editorGroupService = accessor.get(IEditorGroupsService);
    const editorService = accessor.get(IEditorService);
    const customizationHarnessService = accessor.get(ICustomizationHarnessService);
    const toolsService = accessor.get(ILanguageModelToolsService);
    const sessionResource = getResourceForNewChatSession(openOptions);
    try {
        switch (openOptions.position) {
        case ChatSessionPosition.Sidebar:
            {
                const view = await viewsService.openView(ChatViewId);
                if (openOptions.type === AgentSessionProviders.Local) {
                    await view.startNewLocalSession();
                } else {
                    await view.loadSession(sessionResource);
                }
                view.focus();
                break;
            }
        case ChatSessionPosition.Editor:
            {
                const options = {
                    override: ChatEditorInput.EditorID,
                    pinned: true,
                    ...(openOptions.type === AgentSessionProviders.Local ? {
                        explicitSessionType: localChatSessionType
                    } : {}),
                    title: {
                        fallback: ( localize(7224, "{0}", openOptions.displayName))
                    }
                };
                if (openOptions.replaceEditor) {
                    const activeEditor = editorGroupService.activeGroup.activeEditor;
                    if (!activeEditor || !(activeEditor instanceof ChatEditorInput)) {
                        throw ( new Error("No active chat editor to replace"));
                    }
                    await editorService.replaceEditors([{
                        editor: activeEditor,
                        replacement: {
                            resource: sessionResource,
                            options
                        }
                    }], editorGroupService.activeGroup);
                } else {
                    await editorService.openEditor({
                        resource: sessionResource,
                        options
                    });
                }
                break;
            }
        default:
            assertNever(
                openOptions.position,
                `Unknown chat session position: ${openOptions.position}`
            );
        }
    } catch (e) {
        logService.error(
            `Failed to open '${openOptions.type}' chat session with openOptions: ${JSON.stringify(openOptions)}`,
            e
        );
        return;
    }
    if (chatSendOptions) {
        try {
            if (chatSendOptions.initialSessionOptions) {
                chatSessionService.updateSessionOptions(
                    sessionResource,
                    normalizeSessionOptions(chatSendOptions.initialSessionOptions)
                );
            }
            let attachedContext = chatSendOptions.attachedContext;
            const promptFile = await resolvePromptSlashCommand(
                chatSendOptions.prompt,
                sessionResource,
                customizationHarnessService,
                toolsService
            );
            if (promptFile) {
                attachedContext = [promptFile, ...(attachedContext ?? [])];
            }
            const result = await chatService.sendRequest(sessionResource, chatSendOptions.prompt, {
                agentIdSilent: openOptions.type,
                attachedContext
            });
            if (result.kind === "sent" && result.newSessionResource && !isEqual(result.newSessionResource, sessionResource)) {
                switch (openOptions.position) {
                case ChatSessionPosition.Sidebar:
                    {
                        const view = await viewsService.openView(ChatViewId);
                        await view.loadSession(result.newSessionResource);
                        break;
                    }
                case ChatSessionPosition.Editor:
                    {
                        const activeEditor = editorGroupService.activeGroup.activeEditor;
                        if (activeEditor instanceof ChatEditorInput && isEqual(activeEditor.sessionResource, sessionResource)) {
                            await editorService.replaceEditors([{
                                editor: activeEditor,
                                replacement: {
                                    resource: result.newSessionResource,
                                    options: {
                                        override: ChatEditorInput.EditorID,
                                        pinned: true
                                    }
                                }
                            }], editorGroupService.activeGroup);
                        }
                        break;
                    }
                default:
                    assertNever(
                        openOptions.position,
                        `Unknown chat session position: ${openOptions.position}`
                    );
                }
            }
        } catch (e) {
            logService.error(
                `Failed to send initial request to '${openOptions.type}' chat session with contextOptions: ${JSON.stringify(chatSendOptions)}`,
                e
            );
        }
    }
}
function normalizeSessionOptions(options) {
    if (options instanceof Map) {
        return options;
    }
    if (Array.isArray(options)) {
        return ( new Map(( options.map(o => [o.optionId, o.value]))));
    }
    return ChatSessionOptionsMap.fromRecord(options);
}
async function resolvePromptSlashCommand(prompt, sessionResource, customizationHarnessService, toolsService) {
    const slashMatch = prompt.match(slashReg);
    if (slashMatch) {
        const slashCommand = await customizationHarnessService.resolvePromptSlashCommand(slashMatch[1], sessionResource, CancellationToken.None);
        if (slashCommand) {
            const parseResult = slashCommand.parsedPromptFile;
            const refs = parseResult.body?.variableReferences.map((
                {
                    name,
                    offset,
                    fullLength
                }
            ) => ({
                name,
                range: ( new OffsetRange(offset, offset + fullLength))
            })) ?? [];
            const toolReferences = toolsService.toToolReferences(refs);
            return toPromptFileVariableEntry(
                parseResult.uri,
                PromptFileVariableKind.PromptFile,
                undefined,
                true,
                toolReferences
            );
        }
    }
    return undefined;
}
function getResourceForNewChatSession(options) {
    const isRemoteSession = options.type !== AgentSessionProviders.Local;
    if (isRemoteSession) {
        return ( URI.from({
            scheme: options.type,
            path: `/untitled-${generateUuid()}`
        }));
    }
    const isEditorPosition = options.position === ChatSessionPosition.Editor;
    if (isEditorPosition) {
        return ChatEditorInput.getNewEditorUri();
    }
    return LocalChatSessionUri.getNewSessionUri();
}
function isAgentSessionProviderType(type) {
    return ( Object.values(AgentSessionProviders)).includes(type);
}
function getSessionStatusForModel(model) {
    if (model.requestInProgress.get()) {
        return ChatSessionStatus.InProgress;
    }
    const lastRequest = model.getRequests().at(-1);
    if (lastRequest?.response) {
        if (lastRequest.response.state === ResponseModelState.NeedsInput) {
            return ChatSessionStatus.NeedsInput;
        } else if (lastRequest.response.isCanceled || lastRequest.response.result?.errorDetails?.code === "canceled") {
            return ChatSessionStatus.Completed;
        } else if (lastRequest.response.result?.errorDetails) {
            return ChatSessionStatus.Failed;
        } else if (lastRequest.response.isComplete) {
            return ChatSessionStatus.Completed;
        } else {
            return ChatSessionStatus.InProgress;
        }
    }
    return undefined;
}
function chatResponseStateToSessionStatus(state) {
    switch (state) {
    case ResponseModelState.Cancelled:
    case ResponseModelState.Complete:
        return ChatSessionStatus.Completed;
    case ResponseModelState.Failed:
        return ChatSessionStatus.Failed;
    case ResponseModelState.Pending:
        return ChatSessionStatus.InProgress;
    case ResponseModelState.NeedsInput:
        return ChatSessionStatus.NeedsInput;
    }
}

export { ChatSessionPosition, ChatSessionsService, chatResponseStateToSessionStatus, getResourceForNewChatSession, getSessionStatusForModel, openChatSession };
