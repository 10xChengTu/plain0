
import { __decorate, __param } from '../../../../../../../../../external/tslib/tslib.es6.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { MutableDisposable, Disposable } from '../../../../../../base/common/lifecycle.js';
import { revive } from '../../../../../../base/common/marshalling.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { truncate } from '../../../../../../base/common/strings.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { ConfirmResult } from '../../../../../../platform/dialogs/common/dialogs.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.service.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.service.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { registerIcon } from '../../../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, Verbosity } from '../../../../../common/editor.js';
import { EditorInput } from '../../../../../common/editor/editorInput.js';
import { IChatService } from '../../../common/chatService/chatService.service.js';
import { localChatSessionType } from '../../../common/chatSessionsService.js';
import { IChatSessionsService } from '../../../common/chatSessionsService.service.js';
import { ChatEditorTitleMaxLength, ChatAgentLocation, getDefaultNewChatSessionResource, getDefaultNewChatSessionType } from '../../../common/constants.js';
import { ModifiedFileEntryState } from '../../../common/editing/chatEditingService.js';
import { LocalChatSessionUri, getChatSessionType } from '../../../common/model/chatUri.js';

var ChatEditorInput_1;
const ChatEditorIcon = registerIcon("chat-editor-label-icon", Codicon.chatSparkle, ( localize(8386, "Icon of the chat editor label.")));
let ChatEditorInput = class ChatEditorInput extends EditorInput {
    static {
        ChatEditorInput_1 = this;
    }
    static {
        this.TypeID = "workbench.input.chatSession";
    }
    static {
        this.EditorID = "workbench.editor.chatSession";
    }
    get sessionResource() {
        return this._sessionResource;
    }
    get model() {
        return this.modelRef.value?.object;
    }
    static getNewEditorUri() {
        return ChatEditorUri.getNewEditorUri();
    }
    constructor(
        resource,
        options,
        chatService,
        dialogService,
        configurationService,
        chatSessionsService,
        instantiationService
    ) {
        super();
        this.resource = resource;
        this.options = options;
        this.chatService = chatService;
        this.dialogService = dialogService;
        this.configurationService = configurationService;
        this.chatSessionsService = chatSessionsService;
        this.instantiationService = instantiationService;
        this.didTransferOutEditingSession = false;
        this.modelRef = this._register(( new MutableDisposable()));
        this._modelChangeListener = this._register(( new MutableDisposable()));
        this.closeHandler = this;
        if (resource.scheme === Schemas.vscodeChatEditor) {
            const parsed = ChatEditorUri.parse(resource);
            if (!parsed || typeof parsed !== "number") {
                throw ( new Error("Invalid chat URI"));
            }
        } else if (resource.scheme === Schemas.vscodeLocalChatSession) {
            const localSessionId = LocalChatSessionUri.parseLocalSessionId(resource);
            if (!localSessionId) {
                throw ( new Error("Invalid local chat session URI"));
            }
            this._sessionResource = resource;
        } else {
            this._sessionResource = resource;
        }
    }
    showConfirm() {
        return !!(this.model && shouldShowClearEditingSessionConfirmation(this.model));
    }
    transferOutEditingSession() {
        this.didTransferOutEditingSession = true;
        return this.model?.editingSession;
    }
    async confirm(editors) {
        if (!this.model?.editingSession || this.didTransferOutEditingSession || this.getSessionType() !== localChatSessionType) {
            return ConfirmResult.SAVE;
        }
        const titleOverride = ( localize(8387, "Close Chat Editor"));
        const messageOverride = ( localize(8388, "Closing the chat editor will end your current edit session."));
        const result = await showClearEditingSessionConfirmation(this.model, this.dialogService, {
            titleOverride,
            messageOverride
        });
        return result ? ConfirmResult.SAVE : ConfirmResult.CANCEL;
    }
    get editorId() {
        return ChatEditorInput_1.EditorID;
    }
    get capabilities() {
        return super.capabilities | EditorInputCapabilities.ForceReveal | EditorInputCapabilities.CanDropIntoEditor;
    }
    copy() {
        return this.instantiationService.createInstance(ChatEditorInput_1, ChatEditorInput_1.getNewEditorUri(), {});
    }
    matches(otherInput) {
        if (!(otherInput instanceof ChatEditorInput_1)) {
            return false;
        }
        return isEqual(this.sessionResource, otherInput.sessionResource);
    }
    get typeId() {
        return ChatEditorInput_1.TypeID;
    }
    getName() {
        if (this.model?.title) {
            return this.model.hasCustomTitle ? this.model.title : truncate(this.model.title, ChatEditorTitleMaxLength);
        }
        if (this._sessionResource) {
            const existingSession = this.chatService.getSession(this._sessionResource);
            if (existingSession?.title) {
                return existingSession.title;
            }
            const persistedTitle = this.chatService.getSessionTitle(this._sessionResource);
            if (persistedTitle && persistedTitle.trim()) {
                return persistedTitle;
            }
        }
        if (this.options.title?.preferred) {
            return this.options.title.preferred;
        }
        return this.options.title?.fallback ?? ( localize(8389, "Chat"));
    }
    getTitle(verbosity) {
        const name = this.getName();
        if (verbosity === Verbosity.LONG) {
            const sessionTypeDisplayName = this.getSessionTypeDisplayName();
            if (sessionTypeDisplayName) {
                return `${name} | ${sessionTypeDisplayName}`;
            }
        }
        return name;
    }
    getSessionTypeDisplayName() {
        const sessionType = this.getSessionType();
        if (sessionType === localChatSessionType) {
            return;
        }
        const contributions = this.chatSessionsService.getAllChatSessionContributions();
        const contribution = contributions.find(c => c.type === sessionType);
        return contribution?.displayName;
    }
    getIcon() {
        const resolvedIcon = this.resolveIcon();
        if (resolvedIcon) {
            this.cachedIcon = resolvedIcon;
            return resolvedIcon;
        }
        return ChatEditorIcon;
    }
    resolveIcon() {
        const sessionType = this.getSessionType();
        if (sessionType !== localChatSessionType) {
            return this.chatSessionsService.getChatSessionContribution(sessionType)?.icon;
        }
        return undefined;
    }
    getSessionType() {
        return getChatSessionType(this._sessionResource ?? this.resource);
    }
    async resolve() {
        const searchParams = ( new URLSearchParams(this.resource.query));
        const chatSessionType = searchParams.get("chatSessionType");
        const inputType = chatSessionType ?? this.resource.authority;
        if (this._sessionResource) {
            this.modelRef.value = await this.chatService.acquireOrLoadSession(
                this._sessionResource,
                ChatAgentLocation.Chat,
                CancellationToken.None,
                "ChatEditorInput#resolve"
            );
            if (this.shouldReplaceEmptyLocalSession(this._sessionResource)) {
                const defaultResource = getDefaultNewChatSessionResource(this.configurationService, this.chatSessionsService);
                if (getChatSessionType(defaultResource) !== localChatSessionType) {
                    this._sessionResource = defaultResource;
                    this.modelRef.value = await this.chatService.acquireOrLoadSession(
                        defaultResource,
                        ChatAgentLocation.Chat,
                        CancellationToken.None,
                        "ChatEditorInput#resolveDefaultSession"
                    );
                }
            }
            if (!this.model && LocalChatSessionUri.parseLocalSessionId(this._sessionResource)) {
                this.modelRef.value = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, {
                    canUseTools: true,
                    debugOwner: "ChatEditorInput#resolveNewLocalSession"
                });
            }
        } else if (!this.options.target) {
            if (this.options.explicitSessionType === localChatSessionType) {
                this.modelRef.value = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, {
                    canUseTools: !inputType,
                    debugOwner: "ChatEditorInput#resolveExplicitLocal"
                });
            } else {
                const defaultResource = getDefaultNewChatSessionResource(this.configurationService, this.chatSessionsService);
                if (getChatSessionType(defaultResource) === localChatSessionType) {
                    this.modelRef.value = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, {
                        canUseTools: !inputType,
                        debugOwner: "ChatEditorInput#resolveUntitled"
                    });
                } else {
                    this._sessionResource = defaultResource;
                    this.modelRef.value = await this.chatService.acquireOrLoadSession(
                        defaultResource,
                        ChatAgentLocation.Chat,
                        CancellationToken.None,
                        "ChatEditorInput#resolveDefaultUntitled"
                    );
                }
            }
        } else if (this.options.target.data) {
            this.modelRef.value = this.chatService.loadSessionFromData(this.options.target.data, "ChatEditorInput#resolveImportedData");
        }
        if (!this.model || this.isDisposed()) {
            return null;
        }
        this._sessionResource = this.model.sessionResource;
        this._trackModelChanges();
        const newIcon = this.resolveIcon();
        if (newIcon && (!this.cachedIcon || !this.iconsEqual(this.cachedIcon, newIcon))) {
            this.cachedIcon = newIcon;
        }
        this._onDidChangeLabel.fire();
        return this._register(( new ChatEditorModel(this.model)));
    }
    shouldReplaceEmptyLocalSession(sessionResource) {
        return LocalChatSessionUri.isLocalSession(sessionResource) && this.options.explicitSessionType !== localChatSessionType && !!this.model && !this.model.hasRequests && getDefaultNewChatSessionType(this.configurationService, this.chatSessionsService) !== localChatSessionType;
    }
    updateModel(model) {
        this._sessionResource = model.sessionResource;
        this.modelRef.value = this.chatService.acquireExistingSession(model.sessionResource, "ChatEditorInput#updateModel");
        this._trackModelChanges();
        this.cachedIcon = undefined;
        this._onDidChangeLabel.fire();
    }
    _trackModelChanges() {
        if (!this.model) {
            return;
        }
        this._modelChangeListener.value = this.model.onDidChange(() => {
            this.cachedIcon = undefined;
            this._onDidChangeLabel.fire();
        });
    }
    iconsEqual(a, b) {
        if (ThemeIcon.isThemeIcon(a) && ThemeIcon.isThemeIcon(b)) {
            return a.id === b.id;
        }
        if (a instanceof URI && b instanceof URI) {
            return ( a.toString()) === ( b.toString());
        }
        return false;
    }
};
ChatEditorInput = ChatEditorInput_1 = ( __decorate([( __param(2, IChatService)), ( __param(3, IDialogService)), ( __param(4, IConfigurationService)), ( __param(5, IChatSessionsService)), ( __param(6, IInstantiationService))], ChatEditorInput));
class ChatEditorModel extends Disposable {
    constructor(model) {
        super();
        this.model = model;
        this._isResolved = false;
    }
    async resolve() {
        this._isResolved = true;
    }
    isResolved() {
        return this._isResolved;
    }
    isDisposed() {
        return this._store.isDisposed;
    }
}
var ChatEditorUri;
(function(ChatEditorUri) {
    const scheme = Schemas.vscodeChatEditor;
    function getNewEditorUri() {
        const handle = Math.floor(Math.random() * 1e9);
        return ( URI.from({
            scheme,
            path: `chat-${handle}`
        }));
    }
    ChatEditorUri.getNewEditorUri = getNewEditorUri;
    function parse(resource) {
        if (resource.scheme !== scheme) {
            return undefined;
        }
        const match = resource.path.match(/chat-(\d+)/);
        const handleStr = match?.[1];
        if (typeof handleStr !== "string") {
            return undefined;
        }
        const handle = parseInt(handleStr);
        if (isNaN(handle)) {
            return undefined;
        }
        return handle;
    }
    ChatEditorUri.parse = parse;
})(ChatEditorUri || (ChatEditorUri = {}));
class ChatEditorInputSerializer {
    canSerialize(input) {
        return input instanceof ChatEditorInput && !!input.sessionResource;
    }
    serialize(input) {
        if (!this.canSerialize(input)) {
            return undefined;
        }
        const obj = {
            options: input.options,
            sessionResource: input.sessionResource,
            resource: input.resource
        };
        return JSON.stringify(obj);
    }
    deserialize(instantiationService, serializedEditor) {
        try {
            const parsed = revive(JSON.parse(serializedEditor));
            if (parsed.sessionResource) {
                const sessionResource = URI.revive(parsed.sessionResource);
                return instantiationService.createInstance(ChatEditorInput, sessionResource, parsed.options);
            }
            let resource = URI.revive(parsed.resource);
            if (resource.scheme === Schemas.vscodeChatEditor && parsed.sessionId) {
                resource = LocalChatSessionUri.forSession(parsed.sessionId);
            }
            return instantiationService.createInstance(ChatEditorInput, resource, parsed.options);
        } catch (err) {
            return undefined;
        }
    }
}
async function showClearEditingSessionConfirmation(model, dialogService, options) {
    const undecidedEdits = shouldShowClearEditingSessionConfirmation(model, options);
    if (!undecidedEdits) {
        return true;
    }
    const defaultPhrase = ( localize(8390, "Starting a new chat will end your current edit session."));
    const defaultTitle = ( localize(8391, "Start new chat?"));
    const phrase = options?.messageOverride ?? defaultPhrase;
    const title = options?.titleOverride ?? defaultTitle;
    const {
        result
    } = await dialogService.prompt({
        title,
        message: phrase + " " + ( localize(8392, "Do you want to keep pending edits to {0} files?", undecidedEdits)),
        type: "info",
        cancelButton: true,
        buttons: [{
            label: ( localize(8393, "Keep & Continue")),
            run: async () => {
                await model.editingSession.accept();
                return true;
            }
        }, {
            label: ( localize(8394, "Undo & Continue")),
            run: async () => {
                await model.editingSession.reject();
                return true;
            }
        }]
    });
    return Boolean(result);
}
function shouldShowClearEditingSessionConfirmation(model, options) {
    if (!model.editingSession || (model.willKeepAlive && !options?.isArchiveAction)) {
        return 0;
    }
    const currentEdits = model.editingSession.entries.get();
    const undecidedEdits = currentEdits.filter(edit => edit.state.get() === ModifiedFileEntryState.Modified);
    return undecidedEdits.length;
}

export { ChatEditorInput, ChatEditorInputSerializer, ChatEditorModel, shouldShowClearEditingSessionConfirmation, showClearEditingSessionConfirmation };
