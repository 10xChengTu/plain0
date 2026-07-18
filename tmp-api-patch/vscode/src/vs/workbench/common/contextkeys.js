
import { __decorate, __param } from '../../../../../external/tslib/tslib.es6.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { localize } from '../../nls.js';
import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.service.js';
import { isEqual, basename, dirname, extname } from '../../base/common/resources.js';
import { ILanguageService } from '../../editor/common/languages/language.service.js';
import { IFileService } from '../../platform/files/common/files.service.js';
import { IModelService } from '../../editor/common/services/model.service.js';
import { Schemas } from '../../base/common/network.js';
import { DEFAULT_EDITOR_ASSOCIATION, isDiffEditorInput } from './editor.js';

var AbstractResourceContextKey_1;
const WorkbenchStateContext = ( new RawContextKey("workbenchState", undefined, {
    type: "string",
    description: ( localize(
        4291,
        "The kind of workspace opened in the window, either 'empty' (no workspace), 'folder' (single folder) or 'workspace' (multi-root workspace)"
    ))
}));
const WorkspaceFolderCountContext = ( new RawContextKey("workspaceFolderCount", 0, ( localize(4292, "The number of root folders in the workspace"))));
const OpenFolderWorkspaceSupportContext = ( new RawContextKey("openFolderWorkspaceSupport", true, true));
const EnterMultiRootWorkspaceSupportContext = ( new RawContextKey("enterMultiRootWorkspaceSupport", true, true));
const EmptyWorkspaceSupportContext = ( new RawContextKey("emptyWorkspaceSupport", true, true));
const DirtyWorkingCopiesContext = ( new RawContextKey("dirtyWorkingCopies", false, ( localize(4293, "Whether there are any working copies with unsaved changes"))));
const RemoteNameContext = ( new RawContextKey("remoteName", "", ( localize(
    4294,
    "The name of the remote the window is connected to or an empty string if not connected to any remote"
))));
const VirtualWorkspaceContext = ( new RawContextKey("virtualWorkspace", "", ( localize(
    4295,
    "The scheme of the current workspace is from a virtual file system or an empty string."
))));
const TemporaryWorkspaceContext = ( new RawContextKey("temporaryWorkspace", false, ( localize(
    4296,
    "The scheme of the current workspace is from a temporary file system."
))));
const IsSessionsWindowContext = ( new RawContextKey("isSessionsWindow", false, ( localize(4297, "Whether the current window is a agent sessions window."))));
const HasWebFileSystemAccess = ( new RawContextKey("hasWebFileSystemAccess", false, true));
const EmbedderIdentifierContext = ( new RawContextKey("embedderIdentifier", undefined, ( localize(
    4298,
    "The identifier of the embedder according to the product service, if one is defined"
))));
const InAutomationContext = ( new RawContextKey("inAutomation", false, ( localize(4299, "Whether VS Code is running under automation/smoke test"))));
const IsSandboxWorkspaceContext = ( new RawContextKey("isSandboxWorkspace", false, true));
const IsMainWindowFullscreenContext = ( new RawContextKey("isFullscreen", false, ( localize(4300, "Whether the main window is in fullscreen mode"))));
const IsAuxiliaryWindowFocusedContext = ( new RawContextKey("isAuxiliaryWindowFocusedContext", false, ( localize(4301, "Whether an auxiliary window is focused"))));
const IsAuxiliaryWindowContext = ( new RawContextKey("isAuxiliaryWindow", false, ( localize(4302, "Window is an auxiliary window"))));
const ActiveEditorDirtyContext = ( new RawContextKey("activeEditorIsDirty", false, ( localize(4303, "Whether the active editor has unsaved changes"))));
const ActiveEditorPinnedContext = ( new RawContextKey("activeEditorIsNotPreview", false, ( localize(4304, "Whether the active editor is not in preview mode"))));
const ActiveEditorFirstInGroupContext = ( new RawContextKey("activeEditorIsFirstInGroup", false, ( localize(4305, "Whether the active editor is the first one in its group"))));
const ActiveEditorLastInGroupContext = ( new RawContextKey("activeEditorIsLastInGroup", false, ( localize(4306, "Whether the active editor is the last one in its group"))));
const ActiveEditorStickyContext = ( new RawContextKey("activeEditorIsPinned", false, ( localize(4307, "Whether the active editor is pinned"))));
const ActiveEditorReadonlyContext = ( new RawContextKey("activeEditorIsReadonly", false, ( localize(4308, "Whether the active editor is read-only"))));
const ActiveCompareEditorCanSwapContext = ( new RawContextKey("activeCompareEditorCanSwap", false, ( localize(4309, "Whether the active compare editor can swap sides"))));
const ActiveEditorCanToggleReadonlyContext = ( new RawContextKey("activeEditorCanToggleReadonly", true, ( localize(
    4310,
    "Whether the active editor can toggle between being read-only or writeable"
))));
const ActiveEditorCanRevertContext = ( new RawContextKey("activeEditorCanRevert", false, ( localize(4311, "Whether the active editor can revert"))));
const ActiveEditorCanSplitInGroupContext = ( new RawContextKey("activeEditorCanSplitInGroup", true));
const ActiveEditorContext = ( new RawContextKey("activeEditor", null, {
    type: "string",
    description: ( localize(4312, "The identifier of the active editor"))
}));
const ActiveEditorAvailableEditorIdsContext = ( new RawContextKey("activeEditorAvailableEditorIds", "", ( localize(
    4313,
    "The available editor identifiers that are usable for the active editor"
))));
const TextCompareEditorVisibleContext = ( new RawContextKey("textCompareEditorVisible", false, ( localize(4314, "Whether a text compare editor is visible"))));
const TextCompareEditorActiveContext = ( new RawContextKey("textCompareEditorActive", false, ( localize(4315, "Whether a text compare editor is active"))));
const SideBySideEditorActiveContext = ( new RawContextKey("sideBySideEditorActive", false, ( localize(4316, "Whether a side by side editor is active"))));
const ActiveCustomEditorDiffCanToggleLayoutContext = ( new RawContextKey("activeCustomEditorDiffCanToggleLayout", false, ( localize(
    4317,
    "Whether the active custom editor diff can toggle between inline and side by side layout"
))));
const ActiveCustomEditorTextDiffContext = ( new RawContextKey("activeCustomEditorTextDiff", false, ( localize(4318, "Whether the active custom editor diff is backed by text documents"))));
const EditorGroupEditorsCountContext = ( new RawContextKey("groupEditorsCount", 0, ( localize(4319, "The number of opened editor groups"))));
const IsTopRightEditorGroupContext = ( new RawContextKey("isTopRightEditorGroup", false, ( localize(
    4320,
    "Whether the editor group is the top right editor group in the editor part"
))));
const ActiveEditorGroupEmptyContext = ( new RawContextKey("activeEditorGroupEmpty", false, ( localize(4321, "Whether the active editor group is empty"))));
const ActiveEditorGroupIndexContext = ( new RawContextKey("activeEditorGroupIndex", 0, ( localize(4322, "The index of the active editor group"))));
const ActiveEditorGroupLastContext = ( new RawContextKey("activeEditorGroupLast", false, ( localize(4323, "Whether the active editor group is the last group"))));
const ActiveEditorGroupLockedContext = ( new RawContextKey("activeEditorGroupLocked", false, ( localize(4324, "Whether the active editor group is locked"))));
const MultipleEditorGroupsContext = ( new RawContextKey("multipleEditorGroups", false, ( localize(4325, "Whether there are multiple editor groups opened"))));
const MultipleEditorsSelectedInGroupContext = ( new RawContextKey("multipleEditorsSelectedInGroup", false, ( localize(4326, "Whether multiple editors have been selected in an editor group"))));
const TwoEditorsSelectedInGroupContext = ( new RawContextKey("twoEditorsSelectedInGroup", false, ( localize(4327, "Whether exactly two editors have been selected in an editor group"))));
const SelectedEditorsInGroupFileOrUntitledResourceContextKey = ( new RawContextKey(
    "SelectedEditorsInGroupFileOrUntitledResourceContextKey",
    true,
    ( localize(
    4328,
    "Whether all selected editors in a group have a file or untitled resource associated"
))
));
const EditorPartMultipleEditorGroupsContext = ( new RawContextKey("editorPartMultipleEditorGroups", false, ( localize(4329, "Whether there are multiple editor groups opened in an editor part"))));
const EditorPartMaximizedEditorGroupContext = ( new RawContextKey("editorPartMaximizedEditorGroup", false, ( localize(4330, "Editor Part has a maximized group"))));
const EditorPartModalContext = ( new RawContextKey("editorPartModal", false, ( localize(4331, "Whether focus is in a modal editor part"))));
const EditorPartModalMaximizedContext = ( new RawContextKey("editorPartModalMaximized", false, ( localize(4332, "Whether the modal editor part is maximized"))));
const EditorPartModalNavigationContext = ( new RawContextKey("editorPartModalNavigation", false, ( localize(4333, "Whether the modal editor part has navigation context"))));
const EditorPartModalSidebarContext = ( new RawContextKey("editorPartModalSidebar", false, ( localize(4334, "Whether the modal editor part has a sidebar"))));
const EditorPartModalSidebarVisibleContext = ( new RawContextKey("editorPartModalSidebarVisible", false, ( localize(4335, "Whether the modal editor part sidebar is visible"))));
const EditorsVisibleContext = ( new RawContextKey("editorIsOpen", false, ( localize(4336, "Whether an editor is open"))));
const EditorAreaFocusContext = ( new RawContextKey("editorAreaFocus", false, ( localize(4337, "Whether the editor area (any editor part) has keyboard focus"))));
const InEditorZenModeContext = ( new RawContextKey("inZenMode", false, ( localize(4338, "Whether Zen mode is enabled"))));
const IsMainEditorCenteredLayoutContext = ( new RawContextKey("isCenteredLayout", false, ( localize(4339, "Whether centered layout is enabled for the main editor"))));
const SplitEditorsVertically = ( new RawContextKey("splitEditorsVertically", false, ( localize(4340, "Whether editors split vertically"))));
const MainEditorAreaVisibleContext = ( new RawContextKey("mainEditorAreaVisible", true, ( localize(4341, "Whether the editor area in the main window is visible"))));
const EditorTabsVisibleContext = ( new RawContextKey("editorTabsVisible", true, ( localize(4342, "Whether editor tabs are visible"))));
const SideBarVisibleContext = ( new RawContextKey("sideBarVisible", false, ( localize(4343, "Whether the sidebar is visible"))));
const SidebarFocusContext = ( new RawContextKey("sideBarFocus", false, ( localize(4344, "Whether the sidebar has keyboard focus"))));
const ActiveViewletContext = ( new RawContextKey("activeViewlet", "", ( localize(4345, "The identifier of the active viewlet"))));
const StatusBarFocused = ( new RawContextKey("statusBarFocused", false, ( localize(4346, "Whether the status bar has keyboard focus"))));
const TitleBarStyleContext = ( new RawContextKey("titleBarStyle", "custom", ( localize(4347, "Style of the window title bar"))));
const TitleBarVisibleContext = ( new RawContextKey("titleBarVisible", false, ( localize(4348, "Whether the title bar is visible"))));
const IsCompactTitleBarContext = ( new RawContextKey("isCompactTitleBar", false, ( localize(4349, "Title bar is in compact mode"))));
const BannerFocused = ( new RawContextKey("bannerFocused", false, ( localize(4350, "Whether the banner has keyboard focus"))));
const NotificationFocusedContext = ( new RawContextKey("notificationFocus", true, ( localize(4351, "Whether a notification has keyboard focus"))));
const NotificationsCenterVisibleContext = ( new RawContextKey("notificationCenterVisible", false, ( localize(4352, "Whether the notifications center is visible"))));
const NotificationsToastsVisibleContext = ( new RawContextKey("notificationToastsVisible", false, ( localize(4353, "Whether a notification toast is visible"))));
const ActiveAuxiliaryContext = ( new RawContextKey("activeAuxiliary", "", ( localize(4354, "The identifier of the active auxiliary panel"))));
const AuxiliaryBarFocusContext = ( new RawContextKey("auxiliaryBarFocus", false, ( localize(4355, "Whether the auxiliary bar has keyboard focus"))));
const AuxiliaryBarVisibleContext = ( new RawContextKey("auxiliaryBarVisible", false, ( localize(4356, "Whether the auxiliary bar is visible"))));
const AuxiliaryBarMaximizedContext = ( new RawContextKey("auxiliaryBarMaximized", false, ( localize(4357, "Whether the auxiliary bar is maximized"))));
const ActivePanelContext = ( new RawContextKey("activePanel", "", ( localize(4358, "The identifier of the active panel"))));
const PanelFocusContext = ( new RawContextKey("panelFocus", false, ( localize(4359, "Whether the panel has keyboard focus"))));
const PanelPositionContext = ( new RawContextKey("panelPosition", "bottom", ( localize(4360, "The position of the panel, always 'bottom'"))));
const PanelAlignmentContext = ( new RawContextKey("panelAlignment", "center", ( localize(
    4361,
    "The alignment of the panel, either 'center', 'left', 'right' or 'justify'"
))));
const PanelVisibleContext = ( new RawContextKey("panelVisible", false, ( localize(4362, "Whether the panel is visible"))));
const PanelMaximizedContext = ( new RawContextKey("panelMaximized", false, ( localize(4363, "Whether the panel is maximized"))));
const FocusedViewContext = ( new RawContextKey("focusedView", "", ( localize(4364, "The identifier of the view that has keyboard focus"))));
function getVisbileViewContextKey(viewId) {
    return `view.${viewId}.visible`;
}
let AbstractResourceContextKey = class AbstractResourceContextKey {
    static {
        AbstractResourceContextKey_1 = this;
    }
    static {
        this.Scheme = ( new RawContextKey("resourceScheme", undefined, {
            type: "string",
            description: ( localize(4365, "The scheme of the resource"))
        }));
    }
    static {
        this.Filename = ( new RawContextKey("resourceFilename", undefined, {
            type: "string",
            description: ( localize(4366, "The file name of the resource"))
        }));
    }
    static {
        this.Dirname = ( new RawContextKey("resourceDirname", undefined, {
            type: "string",
            description: ( localize(4367, "The folder name the resource is contained in"))
        }));
    }
    static {
        this.Path = ( new RawContextKey("resourcePath", undefined, {
            type: "string",
            description: ( localize(4368, "The full path of the resource"))
        }));
    }
    static {
        this.LangId = ( new RawContextKey("resourceLangId", undefined, {
            type: "string",
            description: ( localize(4369, "The language identifier of the resource"))
        }));
    }
    static {
        this.Resource = ( new RawContextKey("resource", undefined, {
            type: "URI",
            description: ( localize(4370, "The full value of the resource including scheme and path"))
        }));
    }
    static {
        this.Extension = ( new RawContextKey("resourceExtname", undefined, {
            type: "string",
            description: ( localize(4371, "The extension name of the resource"))
        }));
    }
    static {
        this.HasResource = ( new RawContextKey("resourceSet", undefined, {
            type: "boolean",
            description: ( localize(4372, "Whether a resource is present or not"))
        }));
    }
    static {
        this.IsFileSystemResource = ( new RawContextKey("isFileSystemResource", undefined, {
            type: "boolean",
            description: ( localize(4373, "Whether the resource is backed by a file system provider"))
        }));
    }
    constructor(_contextKeyService, _fileService, _languageService, _modelService) {
        this._contextKeyService = _contextKeyService;
        this._fileService = _fileService;
        this._languageService = _languageService;
        this._modelService = _modelService;
        this._schemeKey = AbstractResourceContextKey_1.Scheme.bindTo(this._contextKeyService);
        this._filenameKey = AbstractResourceContextKey_1.Filename.bindTo(this._contextKeyService);
        this._dirnameKey = AbstractResourceContextKey_1.Dirname.bindTo(this._contextKeyService);
        this._pathKey = AbstractResourceContextKey_1.Path.bindTo(this._contextKeyService);
        this._langIdKey = AbstractResourceContextKey_1.LangId.bindTo(this._contextKeyService);
        this._resourceKey = AbstractResourceContextKey_1.Resource.bindTo(this._contextKeyService);
        this._extensionKey = AbstractResourceContextKey_1.Extension.bindTo(this._contextKeyService);
        this._hasResource = AbstractResourceContextKey_1.HasResource.bindTo(this._contextKeyService);
        this._isFileSystemResource = AbstractResourceContextKey_1.IsFileSystemResource.bindTo(this._contextKeyService);
    }
    _setLangId() {
        const value = this.get();
        if (!value) {
            this._langIdKey.set(null);
            return;
        }
        const langId = this._modelService.getModel(value)?.getLanguageId() ?? this._languageService.guessLanguageIdByFilepathOrFirstLine(value);
        this._langIdKey.set(langId);
    }
    set(value) {
        value = value ?? undefined;
        if (isEqual(this._value, value)) {
            return;
        }
        this._value = value;
        this._contextKeyService.bufferChangeEvents(() => {
            this._resourceKey.set(value ? ( value.toString()) : null);
            this._schemeKey.set(value ? value.scheme : null);
            this._filenameKey.set(value ? basename(value) : null);
            this._dirnameKey.set(value ? this.uriToPath(dirname(value)) : null);
            this._pathKey.set(value ? this.uriToPath(value) : null);
            this._setLangId();
            this._extensionKey.set(value ? extname(value) : null);
            this._hasResource.set(Boolean(value));
            this._isFileSystemResource.set(value ? this._fileService.hasProvider(value) : false);
        });
    }
    uriToPath(uri) {
        if (uri.scheme === Schemas.file) {
            return uri.fsPath;
        }
        return uri.path;
    }
    reset() {
        this._value = undefined;
        this._contextKeyService.bufferChangeEvents(() => {
            this._resourceKey.reset();
            this._schemeKey.reset();
            this._filenameKey.reset();
            this._dirnameKey.reset();
            this._pathKey.reset();
            this._langIdKey.reset();
            this._extensionKey.reset();
            this._hasResource.reset();
            this._isFileSystemResource.reset();
        });
    }
    get() {
        return this._value;
    }
};
AbstractResourceContextKey = AbstractResourceContextKey_1 = ( __decorate([( __param(0, IContextKeyService)), ( __param(1, IFileService)), ( __param(2, ILanguageService)), ( __param(3, IModelService))], AbstractResourceContextKey));
let ResourceContextKey = class ResourceContextKey extends AbstractResourceContextKey {
    constructor(contextKeyService, fileService, languageService, modelService) {
        super(contextKeyService, fileService, languageService, modelService);
        this._disposables = ( new DisposableStore());
        this._disposables.add(fileService.onDidChangeFileSystemProviderRegistrations(() => {
            const resource = this.get();
            this._isFileSystemResource.set(Boolean(resource && fileService.hasProvider(resource)));
        }));
        this._disposables.add(modelService.onModelAdded(model => {
            if (isEqual(model.uri, this.get())) {
                this._setLangId();
            }
        }));
        this._disposables.add(modelService.onModelLanguageChanged(e => {
            if (isEqual(e.model.uri, this.get())) {
                this._setLangId();
            }
        }));
    }
    dispose() {
        this._disposables.dispose();
    }
};
ResourceContextKey = ( __decorate([( __param(0, IContextKeyService)), ( __param(1, IFileService)), ( __param(2, ILanguageService)), ( __param(3, IModelService))], ResourceContextKey));
class StaticResourceContextKey extends AbstractResourceContextKey {}
function applyAvailableEditorIds(contextKey, editor, editorResolverService) {
    if (!editor) {
        contextKey.set("");
        return;
    }
    const editors = getAvailableEditorIds(editor, editorResolverService);
    contextKey.set(editors.join(","));
}
function getAvailableEditorIds(editor, editorResolverService) {
    if (editor.resource?.scheme === Schemas.untitled && editor.editorId !== DEFAULT_EDITOR_ASSOCIATION.id) {
        return [];
    }
    if (isDiffEditorInput(editor)) {
        const original = getAvailableEditorIds(editor.original, editorResolverService);
        const modified = ( new Set(getAvailableEditorIds(editor.modified, editorResolverService)));
        return original.filter(editor => ( modified.has(editor)));
    }
    if (editor.resource) {
        return ( editorResolverService.getEditors(editor.resource).map(editor => editor.id));
    }
    return [];
}

export { ActiveAuxiliaryContext, ActiveCompareEditorCanSwapContext, ActiveCustomEditorDiffCanToggleLayoutContext, ActiveCustomEditorTextDiffContext, ActiveEditorAvailableEditorIdsContext, ActiveEditorCanRevertContext, ActiveEditorCanSplitInGroupContext, ActiveEditorCanToggleReadonlyContext, ActiveEditorContext, ActiveEditorDirtyContext, ActiveEditorFirstInGroupContext, ActiveEditorGroupEmptyContext, ActiveEditorGroupIndexContext, ActiveEditorGroupLastContext, ActiveEditorGroupLockedContext, ActiveEditorLastInGroupContext, ActiveEditorPinnedContext, ActiveEditorReadonlyContext, ActiveEditorStickyContext, ActivePanelContext, ActiveViewletContext, AuxiliaryBarFocusContext, AuxiliaryBarMaximizedContext, AuxiliaryBarVisibleContext, BannerFocused, DirtyWorkingCopiesContext, EditorAreaFocusContext, EditorGroupEditorsCountContext, EditorPartMaximizedEditorGroupContext, EditorPartModalContext, EditorPartModalMaximizedContext, EditorPartModalNavigationContext, EditorPartModalSidebarContext, EditorPartModalSidebarVisibleContext, EditorPartMultipleEditorGroupsContext, EditorTabsVisibleContext, EditorsVisibleContext, EmbedderIdentifierContext, EmptyWorkspaceSupportContext, EnterMultiRootWorkspaceSupportContext, FocusedViewContext, HasWebFileSystemAccess, InAutomationContext, InEditorZenModeContext, IsAuxiliaryWindowContext, IsAuxiliaryWindowFocusedContext, IsCompactTitleBarContext, IsMainEditorCenteredLayoutContext, IsMainWindowFullscreenContext, IsSandboxWorkspaceContext, IsSessionsWindowContext, IsTopRightEditorGroupContext, MainEditorAreaVisibleContext, MultipleEditorGroupsContext, MultipleEditorsSelectedInGroupContext, NotificationFocusedContext, NotificationsCenterVisibleContext, NotificationsToastsVisibleContext, OpenFolderWorkspaceSupportContext, PanelAlignmentContext, PanelFocusContext, PanelMaximizedContext, PanelPositionContext, PanelVisibleContext, RemoteNameContext, ResourceContextKey, SelectedEditorsInGroupFileOrUntitledResourceContextKey, SideBarVisibleContext, SideBySideEditorActiveContext, SidebarFocusContext, SplitEditorsVertically, StaticResourceContextKey, StatusBarFocused, TemporaryWorkspaceContext, TextCompareEditorActiveContext, TextCompareEditorVisibleContext, TitleBarStyleContext, TitleBarVisibleContext, TwoEditorsSelectedInGroupContext, VirtualWorkspaceContext, WorkbenchStateContext, WorkspaceFolderCountContext, applyAvailableEditorIds, getVisbileViewContextKey };
