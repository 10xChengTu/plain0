
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import '../../../../base/common/observableInternal/index.js';
import { URI, isUriComponents } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.service.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.service.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.service.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IStorageService } from '../../../../platform/storage/common/storage.service.js';
import { IChatAgentService } from './participants/chatAgents.service.js';
import { ChatContextKeys } from './actions/chatContextKeys.js';
import { getChatSessionType, LocalChatSessionUri } from './model/chatUri.js';
import { ChatConfiguration, ChatModeKind } from './constants.js';
import { PromptsStorage, isCustomAgentVisibility, IAgentSource } from './promptSyntax/service/promptsService.js';
import { ICustomizationHarnessService } from './customizationHarnessService.service.js';
import { Target } from './promptSyntax/promptTypes.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { hash } from '../../../../base/common/hash.js';
import { isString } from '../../../../base/common/types.js';
import { isTarget } from './promptSyntax/languageProviders/promptFileAttributes.js';
import { equals as equals$1 } from '../../../../base/common/arrays.js';
import { isEqual } from '../../../../base/common/resources.js';
import { equals } from '../../../../base/common/objects.js';
import { Delayer } from '../../../../base/common/async.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { constObservable } from '../../../../base/common/observableInternal/observables/constObservable.js';
import { observableValue } from '../../../../base/common/observableInternal/observables/observableValue.js';
import { transaction } from '../../../../base/common/observableInternal/transaction.js';

var ChatModes_1;
let ChatModes = class ChatModes extends Disposable {
    static {
        ChatModes_1 = this;
    }
    static {
        this.CUSTOM_MODES_STORAGE_KEY_PREFIX = "chat.customModes.";
    }
    constructor(
        sessionResource,
        chatAgentService,
        contextKeyService,
        logService,
        storageService,
        configurationService,
        customizationHarnessService
    ) {
        super();
        this.sessionResource = sessionResource;
        this.chatAgentService = chatAgentService;
        this.logService = logService;
        this.storageService = storageService;
        this.configurationService = configurationService;
        this.customizationHarnessService = customizationHarnessService;
        this._customModeInstances = ( new Map());
        this._onDidChange = this._register(( new Emitter()));
        this.onDidChange = this._onDidChange.event;
        this._pendingRefresh = Promise.resolve();
        this._refreshThrottler = this._register(( new Delayer(100)));
        const sessionType = getChatSessionType(sessionResource);
        this._storageKey = ChatModes_1.CUSTOM_MODES_STORAGE_KEY_PREFIX + sessionType;
        this.hasCustomModes = ChatContextKeys.Modes.hasCustomChatModes.bindTo(contextKeyService);
        this.loadCachedModes();
        this._pendingRefresh = this.triggerRefresh();
        this._register(this.customizationHarnessService.onDidChangeCustomAgents(e => {
            if (e.sessionType === sessionType) {
                this._pendingRefresh = this.triggerRefresh();
            }
        }));
        this._register(this.storageService.onWillSaveState(() => this.saveCachedModes()));
        this._register(this.configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ChatConfiguration.AgentEnabled)) {
                this._onDidChange.fire();
            }
        }));
        let didHaveToolsAgent = this.chatAgentService.hasToolsAgent;
        this._register(this.chatAgentService.onDidChangeAgents(() => {
            if (didHaveToolsAgent !== this.chatAgentService.hasToolsAgent) {
                didHaveToolsAgent = this.chatAgentService.hasToolsAgent;
                this._onDidChange.fire();
            }
        }));
    }
    get builtin() {
        return this.getBuiltinModes();
    }
    get custom() {
        return this.getCustomModes();
    }
    findModeById(id) {
        return this.getBuiltinModes().find(mode => mode.id === id) ?? this._customModeInstances.get(id);
    }
    findModeByName(name) {
        return this.getBuiltinModes().find(mode => mode.name.get() === name) ?? this.getCustomModes().find(mode => mode.name.get() === name || mode.id === name);
    }
    waitForPendingUpdates() {
        return this._pendingRefresh;
    }
    loadCachedModes() {
        try {
            const cachedCustomModes = this.storageService.getObject(this._storageKey, StorageScope.WORKSPACE);
            if (cachedCustomModes) {
                this.deserializeCachedModes(cachedCustomModes);
            }
        } catch (error) {
            this.logService.error(error, "Failed to load cached custom agents");
        }
    }
    deserializeCachedModes(cachedCustomModes) {
        if (!Array.isArray(cachedCustomModes)) {
            this.logService.error("Invalid cached custom modes data: expected array");
            return;
        }
        for (const cachedMode of cachedCustomModes) {
            if (isCachedChatModeData(cachedMode) && cachedMode.uri) {
                try {
                    const visibility = cachedMode.visibility ?? {
                        userInvocable: true,
                        agentInvocable: cachedMode.infer !== false
                    };
                    if (!visibility.userInvocable) {
                        continue;
                    }
                    const uri = URI.revive(cachedMode.uri);
                    const customChatMode = {
                        id: cachedMode.id,
                        uri,
                        name: cachedMode.name,
                        description: cachedMode.description,
                        tools: cachedMode.customTools,
                        model: isString(cachedMode.model) ? [cachedMode.model] : cachedMode.model,
                        argumentHint: cachedMode.argumentHint,
                        agentInstructions: cachedMode.modeInstructions ?? {
                            content: cachedMode.body ?? "",
                            toolReferences: []
                        },
                        handOffs: cachedMode.handOffs,
                        target: cachedMode.target ?? Target.Undefined,
                        visibility,
                        agents: cachedMode.agents,
                        sessionTypes: cachedMode.sessionTypes,
                        source: reviveChatModeSource(cachedMode.source) ?? {
                            storage: PromptsStorage.local
                        },
                        enabled: true
                    };
                    const instance = ( new CustomChatMode(customChatMode));
                    this._customModeInstances.set(( uri.toString()), instance);
                } catch (error) {
                    this.logService.error(error, "Failed to revive cached custom agent");
                }
            }
        }
        this.hasCustomModes.set(this._customModeInstances.size > 0);
    }
    saveCachedModes() {
        try {
            const modesToCache = Array.from(( this._customModeInstances.values()));
            this.storageService.store(
                this._storageKey,
                modesToCache,
                StorageScope.WORKSPACE,
                StorageTarget.MACHINE
            );
        } catch (error) {
            this.logService.warn("Failed to save cached custom agents", error);
        }
    }
    triggerRefresh() {
        this._refreshCancellationSource?.cancel();
        this._refreshCancellationSource?.dispose();
        const refreshCancellationSource = this._refreshCancellationSource = ( new CancellationTokenSource());
        return this._refreshThrottler.trigger(async () => {
            try {
                await this.refreshCustomPromptModes(refreshCancellationSource.token);
            } finally {
                if (this._refreshCancellationSource === refreshCancellationSource) {
                    this._refreshCancellationSource = undefined;
                }
                refreshCancellationSource.dispose();
            }
        });
    }
    dispose() {
        this._refreshCancellationSource?.cancel();
        this._refreshCancellationSource?.dispose();
        this._refreshCancellationSource = undefined;
        super.dispose();
    }
    async refreshCustomPromptModes(token) {
        let hasChanges = false;
        try {
            if (token.isCancellationRequested) {
                return;
            }
            const customModes = await this.customizationHarnessService.getCustomAgents(this.sessionResource, token);
            if (token.isCancellationRequested) {
                return;
            }
            const seenUris = ( new Set());
            for (const customMode of customModes) {
                if (!customMode.visibility.userInvocable || !customMode.enabled) {
                    continue;
                }
                const uriString = ( customMode.uri.toString());
                seenUris.add(uriString);
                let modeInstance = this._customModeInstances.get(uriString);
                if (modeInstance) {
                    if (modeInstance.updateData(customMode)) {
                        hasChanges = true;
                    }
                } else {
                    modeInstance = ( new CustomChatMode(customMode));
                    this._customModeInstances.set(uriString, modeInstance);
                    hasChanges = true;
                }
            }
            for (const [uriString] of this._customModeInstances.entries()) {
                if (!( seenUris.has(uriString))) {
                    this._customModeInstances.delete(uriString);
                    hasChanges = true;
                }
            }
            this.hasCustomModes.set(this._customModeInstances.size > 0);
        } catch (error) {
            if (isCancellationError(error)) {
                return;
            }
            this.logService.error(error, "Failed to load custom agents");
            this._customModeInstances.clear();
            this.hasCustomModes.set(false);
            hasChanges = true;
        }
        if (hasChanges) {
            this._onDidChange.fire();
        }
    }
    getBuiltinModes() {
        const builtinModes = [ChatMode.Ask];
        if (this.chatAgentService.hasToolsAgent || this.isAgentModeDisabledByPolicy()) {
            builtinModes.unshift(ChatMode.Agent);
        }
        builtinModes.push(ChatMode.Edit);
        return builtinModes;
    }
    getCustomModes() {
        return this.chatAgentService.hasToolsAgent || this.isAgentModeDisabledByPolicy() ? Array.from(( this._customModeInstances.values())) : [];
    }
    isAgentModeDisabledByPolicy() {
        return this.configurationService.inspect(ChatConfiguration.AgentEnabled).policyValue === false;
    }
};
ChatModes = ChatModes_1 = ( __decorate([( __param(1, IChatAgentService)), ( __param(2, IContextKeyService)), ( __param(3, ILogService)), ( __param(4, IStorageService)), ( __param(5, IConfigurationService)), ( __param(6, ICustomizationHarnessService))], ChatModes));
let ChatModeService = class ChatModeService extends Disposable {
    constructor(instantiationService, contextKeyService, configurationService) {
        super();
        this.instantiationService = instantiationService;
        this.configurationService = configurationService;
        this.agentModeDisabledByPolicy = ChatContextKeys.Modes.agentModeDisabledByPolicy.bindTo(contextKeyService);
        this.updateAgentModePolicyContextKey();
        this._register(this.configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(ChatConfiguration.AgentEnabled)) {
                this.updateAgentModePolicyContextKey();
            }
        }));
    }
    createModes(sessionResource) {
        return this.instantiationService.createInstance(ChatModes, sessionResource);
    }
    async getLocalModes() {
        if (!this.localMode) {
            this.localMode = (async () => {
                const modes = this._register(this.createModes(LocalChatSessionUri.getNewSessionUri()));
                await modes.waitForPendingUpdates();
                return modes;
            })();
        }
        return this.localMode;
    }
    updateAgentModePolicyContextKey() {
        this.agentModeDisabledByPolicy.set(this.isAgentModeDisabledByPolicy());
    }
    isAgentModeDisabledByPolicy() {
        return this.configurationService.inspect(ChatConfiguration.AgentEnabled).policyValue === false;
    }
};
ChatModeService = ( __decorate([( __param(0, IInstantiationService)), ( __param(1, IContextKeyService)), ( __param(2, IConfigurationService))], ChatModeService));
var IChatModeInstructions;
(function(IChatModeInstructions) {
    function isEquals(a, b) {
        if (a === b) {
            return true;
        }
        if (!a || !b) {
            return false;
        }
        return a.content === b.content && equals(a.toolReferences, b.toolReferences) && equals(a.metadata, b.metadata);
    }
    IChatModeInstructions.isEquals = isEquals;
})(IChatModeInstructions || (IChatModeInstructions = {}));
function isCachedChatModeData(data) {
    if (typeof data !== "object" || data === null) {
        return false;
    }
    const mode = data;
    return typeof mode.id === "string" && typeof mode.name === "string" && typeof mode.kind === "string" && (mode.description === undefined || typeof mode.description === "string") && (mode.customTools === undefined || Array.isArray(mode.customTools)) && (mode.modeInstructions === undefined || (typeof mode.modeInstructions === "object" && mode.modeInstructions !== null)) && (mode.model === undefined || typeof mode.model === "string" || Array.isArray(mode.model)) && (mode.argumentHint === undefined || typeof mode.argumentHint === "string") && (mode.handOffs === undefined || Array.isArray(mode.handOffs)) && (mode.uri === undefined || (typeof mode.uri === "object" && mode.uri !== null)) && (mode.source === undefined || isChatModeSourceData(mode.source)) && (mode.target === undefined || isTarget(mode.target)) && (mode.visibility === undefined || isCustomAgentVisibility(mode.visibility)) && (mode.agents === undefined || Array.isArray(mode.agents)) && (mode.sessionTypes === undefined || Array.isArray(mode.sessionTypes));
}
class CustomChatMode {
    get name() {
        return this._nameObservable;
    }
    get description() {
        return this._descriptionObservable;
    }
    get icon() {
        return constObservable(undefined);
    }
    get isBuiltin() {
        return isBuiltinChatMode(this);
    }
    get customTools() {
        return this._customToolsObservable;
    }
    get model() {
        return this._modelObservable;
    }
    get argumentHint() {
        return this._argumentHintObservable;
    }
    get modeInstructions() {
        return this._modeInstructions;
    }
    get uri() {
        return this._uriObservable;
    }
    get label() {
        return this.name;
    }
    get handOffs() {
        return this._handoffsObservable;
    }
    get source() {
        return this._source;
    }
    get target() {
        return this._targetObservable;
    }
    get visibility() {
        return this._visibilityObservable;
    }
    get agents() {
        return this._agentsObservable;
    }
    get sessionTypes() {
        return this._sessionTypes;
    }
    constructor(customChatMode) {
        this.kind = ChatModeKind.Agent;
        this.id = ( customChatMode.uri.toString());
        this._nameObservable = observableValue("name", customChatMode.name);
        this._descriptionObservable = observableValue("description", customChatMode.description);
        this._customToolsObservable = observableValue("customTools", customChatMode.tools);
        this._modelObservable = observableValue("model", customChatMode.model);
        this._argumentHintObservable = observableValue("argumentHint", customChatMode.argumentHint);
        this._handoffsObservable = observableValue("handOffs", customChatMode.handOffs);
        this._targetObservable = observableValue("target", customChatMode.target);
        this._visibilityObservable = observableValue("visibility", customChatMode.visibility);
        this._agentsObservable = observableValue("agents", customChatMode.agents);
        this._modeInstructions = observableValue("_modeInstructions", customChatMode.agentInstructions);
        this._uriObservable = observableValue("uri", customChatMode.uri);
        this._source = customChatMode.source;
        this._sessionTypes = customChatMode.sessionTypes;
    }
    updateData(newData) {
        let hasChanges = false;
        transaction(tx => {
            const update = (observable, newValue, equals = (a, b) => a === b) => {
                if (!equals(observable.get(), newValue)) {
                    observable.set(newValue, tx);
                    hasChanges = true;
                }
            };
            update(this._nameObservable, newData.name);
            update(this._descriptionObservable, newData.description);
            update(this._customToolsObservable, newData.tools, equals$1);
            update(this._modelObservable, newData.model, equals$1);
            update(this._argumentHintObservable, newData.argumentHint);
            update(
                this._modeInstructions,
                newData.agentInstructions,
                IChatModeInstructions.isEquals
            );
            update(this._uriObservable, newData.uri, isEqual);
            update(this._handoffsObservable, newData.handOffs, equals);
            update(this._targetObservable, newData.target);
            update(this._visibilityObservable, newData.visibility, equals);
            update(this._agentsObservable, newData.agents, equals$1);
            if (!IAgentSource.isEquals(this._source, newData.source)) {
                this._source = newData.source;
                hasChanges = true;
            }
            if (!equals$1(this._sessionTypes, newData.sessionTypes)) {
                this._sessionTypes = newData.sessionTypes;
                hasChanges = true;
            }
        });
        return hasChanges;
    }
    toJSON() {
        return {
            id: this.id,
            name: this.name.get(),
            description: this.description.get(),
            kind: this.kind,
            customTools: this.customTools.get(),
            model: this.model.get(),
            argumentHint: this.argumentHint.get(),
            modeInstructions: this.modeInstructions.get(),
            uri: this.uri.get(),
            handOffs: this.handOffs.get(),
            source: serializeChatModeSource(this._source),
            target: this.target.get(),
            visibility: this.visibility.get(),
            agents: this.agents.get(),
            sessionTypes: this.sessionTypes
        };
    }
}
function isChatModeSourceData(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const data = value;
    if (data.storage === PromptsStorage.extension) {
        return typeof data.extensionId === "string";
    }
    if (data.storage === PromptsStorage.plugin) {
        return isUriComponents(data.pluginUri);
    }
    return data.storage === PromptsStorage.local || data.storage === PromptsStorage.user;
}
function serializeChatModeSource(source) {
    if (!source) {
        return undefined;
    }
    if (source.storage === PromptsStorage.extension) {
        return {
            storage: PromptsStorage.extension,
            extensionId: source.extensionId.value
        };
    }
    if (source.storage === PromptsStorage.plugin) {
        return {
            storage: PromptsStorage.plugin,
            pluginUri: source.pluginUri
        };
    }
    return {
        storage: source.storage
    };
}
function reviveChatModeSource(data) {
    if (!data) {
        return undefined;
    }
    if (data.storage === PromptsStorage.extension) {
        return {
            storage: PromptsStorage.extension,
            extensionId: ( new ExtensionIdentifier(data.extensionId))
        };
    }
    if (data.storage === PromptsStorage.plugin) {
        return {
            storage: PromptsStorage.plugin,
            pluginUri: URI.revive(data.pluginUri)
        };
    }
    return {
        storage: data.storage
    };
}
class BuiltinChatMode {
    constructor(kind, label, description, icon) {
        this.kind = kind;
        this.name = constObservable(kind);
        this.label = constObservable(label);
        this.description = observableValue("description", description);
        this.icon = constObservable(icon);
        this.target = constObservable(Target.Undefined);
    }
    get isBuiltin() {
        return isBuiltinChatMode(this);
    }
    get id() {
        return this.kind;
    }
    toJSON() {
        return {
            id: this.id,
            name: this.name.get(),
            description: this.description.get(),
            kind: this.kind
        };
    }
}
var ChatMode;
(function(ChatMode) {
    ChatMode.Ask = ( new BuiltinChatMode(ChatModeKind.Ask, "Ask", ( localize(8527, "Explore and understand your code")), Codicon.question));
    ChatMode.Edit = ( new BuiltinChatMode(ChatModeKind.Edit, "Edit", ( localize(8528, "Edit or refactor selected code")), Codicon.edit));
    ChatMode.Agent = ( new BuiltinChatMode(ChatModeKind.Agent, "Agent", ( localize(8529, "Describe what to build")), Codicon.agent));
})(ChatMode || (ChatMode = {}));
function isBuiltinChatMode(mode) {
    return mode.id === ChatMode.Ask.id || mode.id === ChatMode.Edit.id || mode.id === ChatMode.Agent.id;
}
function getModeNameForTelemetry(mode) {
    const modeStorage = mode.source?.storage;
    if (modeStorage === PromptsStorage.local || modeStorage === PromptsStorage.user) {
        return String(hash(mode.name.get()));
    }
    return mode.name.get();
}
function getHandoffId(handoff) {
    const slug = handoff.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${handoff.agent}:${slug}`;
}
function buildCustomAgentHandoffsInfo(modes) {
    return ( modes.map(mode => {
        const handoffs = mode.handOffs?.get() ?? [];
        const visibility = mode.visibility?.get();
        return {
            id: mode.id,
            name: mode.name.get(),
            isBuiltin: mode.isBuiltin,
            visibility: {
                userInvocable: visibility?.userInvocable ?? true,
                agentInvocable: visibility?.agentInvocable ?? true
            },
            handoffs: ( handoffs.map(h => ({
                id: getHandoffId(h),
                label: h.label,
                agent: h.agent,
                prompt: h.prompt,
                ...(h.send !== undefined ? {
                    send: h.send
                } : {}),
                ...(h.showContinueOn !== undefined ? {
                    showContinueOn: h.showContinueOn
                } : {}),
                ...(h.model !== undefined ? {
                    model: h.model
                } : {})
            })))
        };
    }));
}

export { BuiltinChatMode, ChatMode, ChatModeService, CustomChatMode, IChatModeInstructions, buildCustomAgentHandoffsInfo, getHandoffId, getModeNameForTelemetry, isBuiltinChatMode };
