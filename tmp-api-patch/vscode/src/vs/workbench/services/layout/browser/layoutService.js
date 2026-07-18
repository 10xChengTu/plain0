
import { isWeb, isMacintosh, isNative } from '../../../../base/common/platform.js';
import { mainWindow, isAuxiliaryWindow } from '../../../../base/browser/window.js';
import { hasNativeTitlebar, TitleBarSetting, CustomTitleBarVisibility, hasNativeMenu, getMenuBarVisibility } from '../../../../platform/window/common/window.js';
import { isFullscreen, isWCOEnabled } from '../../../../base/browser/browser.js';

var Parts;
(function (Parts) {
    Parts["TITLEBAR_PART"] = "workbench.parts.titlebar";
    Parts["BANNER_PART"] = "workbench.parts.banner";
    Parts["ACTIVITYBAR_PART"] = "workbench.parts.activitybar";
    Parts["SIDEBAR_PART"] = "workbench.parts.sidebar";
    Parts["PANEL_PART"] = "workbench.parts.panel";
    Parts["AUXILIARYBAR_PART"] = "workbench.parts.auxiliarybar";
    Parts["SESSIONS_PART"] = "workbench.parts.sessions";
    Parts["EDITOR_PART"] = "workbench.parts.editor";
    Parts["STATUSBAR_PART"] = "workbench.parts.statusbar";
})(Parts || (Parts = {}));
var ZenModeSettings;
(function (ZenModeSettings) {
    ZenModeSettings["SHOW_TABS"] = "zenMode.showTabs";
    ZenModeSettings["HIDE_LINENUMBERS"] = "zenMode.hideLineNumbers";
    ZenModeSettings["HIDE_STATUSBAR"] = "zenMode.hideStatusBar";
    ZenModeSettings["HIDE_ACTIVITYBAR"] = "zenMode.hideActivityBar";
    ZenModeSettings["CENTER_LAYOUT"] = "zenMode.centerLayout";
    ZenModeSettings["FULLSCREEN"] = "zenMode.fullScreen";
    ZenModeSettings["RESTORE"] = "zenMode.restore";
    ZenModeSettings["SILENT_NOTIFICATIONS"] = "zenMode.silentNotifications";
})(ZenModeSettings || (ZenModeSettings = {}));
var LayoutSettings;
(function (LayoutSettings) {
    LayoutSettings["ACTIVITY_BAR_LOCATION"] = "workbench.activityBar.location";
    LayoutSettings["ACTIVITY_BAR_AUTO_HIDE"] = "workbench.activityBar.autoHide";
    LayoutSettings["ACTIVITY_BAR_COMPACT"] = "workbench.activityBar.compact";
    LayoutSettings["EDITOR_TABS_MODE"] = "workbench.editor.showTabs";
    LayoutSettings["EDITOR_ACTIONS_LOCATION"] = "workbench.editor.editorActionsLocation";
    LayoutSettings["COMMAND_CENTER"] = "window.commandCenter";
    LayoutSettings["LAYOUT_ACTIONS"] = "workbench.layoutControl.enabled";
    LayoutSettings["SHADOWS"] = "workbench.shadows";
    LayoutSettings["MODERN_UI"] = "workbench.experimental.modernUI";
})(LayoutSettings || (LayoutSettings = {}));
const FLOATING_PANEL_MARGIN = 4;
var ActivityBarPosition;
(function (ActivityBarPosition) {
    ActivityBarPosition["DEFAULT"] = "default";
    ActivityBarPosition["TOP"] = "top";
    ActivityBarPosition["BOTTOM"] = "bottom";
    ActivityBarPosition["HIDDEN"] = "hidden";
})(ActivityBarPosition || (ActivityBarPosition = {}));
var EditorTabsMode;
(function (EditorTabsMode) {
    EditorTabsMode["MULTIPLE"] = "multiple";
    EditorTabsMode["SINGLE"] = "single";
    EditorTabsMode["NONE"] = "none";
})(EditorTabsMode || (EditorTabsMode = {}));
var EditorActionsLocation;
(function (EditorActionsLocation) {
    EditorActionsLocation["DEFAULT"] = "default";
    EditorActionsLocation["TITLEBAR"] = "titleBar";
    EditorActionsLocation["HIDDEN"] = "hidden";
})(EditorActionsLocation || (EditorActionsLocation = {}));
var Position;
(function (Position) {
    Position[Position["LEFT"] = 0] = "LEFT";
    Position[Position["RIGHT"] = 1] = "RIGHT";
    Position[Position["BOTTOM"] = 2] = "BOTTOM";
    Position[Position["TOP"] = 3] = "TOP";
})(Position || (Position = {}));
function isHorizontal(position) {
    return position === Position.BOTTOM || position === Position.TOP;
}
var PartOpensMaximizedOptions;
(function (PartOpensMaximizedOptions) {
    PartOpensMaximizedOptions[PartOpensMaximizedOptions["ALWAYS"] = 0] = "ALWAYS";
    PartOpensMaximizedOptions[PartOpensMaximizedOptions["NEVER"] = 1] = "NEVER";
    PartOpensMaximizedOptions[PartOpensMaximizedOptions["REMEMBER_LAST"] = 2] = "REMEMBER_LAST";
})(PartOpensMaximizedOptions || (PartOpensMaximizedOptions = {}));
function positionToString(position) {
    switch (position) {
        case Position.LEFT: return 'left';
        case Position.RIGHT: return 'right';
        case Position.BOTTOM: return 'bottom';
        case Position.TOP: return 'top';
        default: return 'bottom';
    }
}
function getFloatingOuterEdgeOwners(layoutService) {
    if (!layoutService.isFloatingPanelsEnabled()) {
        return { left: undefined, right: undefined };
    }
    const sideBarLeft = layoutService.getSideBarPosition() === Position.LEFT;
    const panelPosition = layoutService.getPanelPosition();
    const verticalPanelVisible = !isHorizontal(panelPosition) && layoutService.isVisible(Parts.PANEL_PART);
    const panelInLeftSequence = verticalPanelVisible && panelPosition === Position.LEFT;
    const panelInRightSequence = verticalPanelVisible && panelPosition === Position.RIGHT;
    const sideBarGroup = [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART];
    const panelGroup = [Parts.PANEL_PART];
    const fullOrder = sideBarLeft
        ? [
            ...sideBarGroup,
            ...(panelInLeftSequence ? panelGroup : []),
            Parts.EDITOR_PART,
            ...(panelInRightSequence ? panelGroup : []),
            Parts.AUXILIARYBAR_PART
        ]
        : [
            Parts.AUXILIARYBAR_PART,
            ...(panelInLeftSequence ? panelGroup : []),
            Parts.EDITOR_PART,
            ...(panelInRightSequence ? panelGroup : []),
            ...[...sideBarGroup].reverse()
        ];
    return {
        left: resolveFloatingOuterOwner(layoutService, fullOrder),
        right: resolveFloatingOuterOwner(layoutService, [...fullOrder].reverse())
    };
}
function resolveFloatingOuterOwner(layoutService, orderedParts) {
    for (const part of orderedParts) {
        const visible = part === Parts.EDITOR_PART
            ? layoutService.isVisible(Parts.EDITOR_PART, mainWindow)
            : layoutService.isVisible(part);
        if (!visible) {
            continue;
        }
        return part === Parts.ACTIVITYBAR_PART ? undefined : part;
    }
    return undefined;
}
function getFloatingOuterGutterEdges(layoutService, partId) {
    if (!layoutService.isFloatingPanelsEnabled()) {
        return { left: false, right: false };
    }
    if (partId === Parts.PANEL_PART && isHorizontal(layoutService.getPanelPosition())) {
        return getFloatingHorizontalPanelOuterEdges(layoutService);
    }
    const owners = getFloatingOuterEdgeOwners(layoutService);
    return { left: owners.left === partId, right: owners.right === partId };
}
function getFloatingSidebarSiblingToEditorStatus(layoutService) {
    const alignment = layoutService.getPanelAlignment();
    const sideBarOnLeft = layoutService.getSideBarPosition() === Position.LEFT;
    return {
        sideBar: !(alignment === 'center' || (sideBarOnLeft && alignment === 'right') || (!sideBarOnLeft && alignment === 'left')),
        auxBar: !(alignment === 'center' || (!sideBarOnLeft && alignment === 'right') || (sideBarOnLeft && alignment === 'left')),
    };
}
function getFloatingHorizontalPanelOuterEdges(layoutService) {
    if (!layoutService.isVisible(Parts.PANEL_PART)) {
        return { left: false, right: false };
    }
    const sideBarLeft = layoutService.getSideBarPosition() === Position.LEFT;
    const { sideBar: sideBarSiblingToEditor, auxBar: auxSiblingToEditor } = getFloatingSidebarSiblingToEditorStatus(layoutService);
    const sideBarSideReached = !layoutService.isVisible(Parts.ACTIVITYBAR_PART) && (!layoutService.isVisible(Parts.SIDEBAR_PART) || sideBarSiblingToEditor);
    const auxSideReached = !layoutService.isVisible(Parts.AUXILIARYBAR_PART) || auxSiblingToEditor;
    return sideBarLeft
        ? { left: sideBarSideReached, right: auxSideReached }
        : { left: auxSideReached, right: sideBarSideReached };
}
const positionsByString = {
    [positionToString(Position.LEFT)]: Position.LEFT,
    [positionToString(Position.RIGHT)]: Position.RIGHT,
    [positionToString(Position.BOTTOM)]: Position.BOTTOM,
    [positionToString(Position.TOP)]: Position.TOP
};
function positionFromString(str) {
    return positionsByString[str];
}
function partOpensMaximizedSettingToString(setting) {
    switch (setting) {
        case PartOpensMaximizedOptions.ALWAYS: return 'always';
        case PartOpensMaximizedOptions.NEVER: return 'never';
        case PartOpensMaximizedOptions.REMEMBER_LAST: return 'preserve';
        default: return 'preserve';
    }
}
const partOpensMaximizedByString = {
    [partOpensMaximizedSettingToString(PartOpensMaximizedOptions.ALWAYS)]: PartOpensMaximizedOptions.ALWAYS,
    [partOpensMaximizedSettingToString(PartOpensMaximizedOptions.NEVER)]: PartOpensMaximizedOptions.NEVER,
    [partOpensMaximizedSettingToString(PartOpensMaximizedOptions.REMEMBER_LAST)]: PartOpensMaximizedOptions.REMEMBER_LAST
};
function partOpensMaximizedFromString(str) {
    return partOpensMaximizedByString[str];
}
function isMultiWindowPart(part) {
    return part === Parts.EDITOR_PART ||
        part === Parts.STATUSBAR_PART ||
        part === Parts.TITLEBAR_PART;
}
function shouldShowCustomTitleBar(configurationService, window, menuBarToggled) {
    const inFullscreen = isFullscreen(window);
    const nativeTitleBarEnabled = hasNativeTitlebar(configurationService);
    if (!isWeb) {
        const showCustomTitleBar = configurationService.getValue(TitleBarSetting.CUSTOM_TITLE_BAR_VISIBILITY);
        if (showCustomTitleBar === CustomTitleBarVisibility.NEVER && nativeTitleBarEnabled || showCustomTitleBar === CustomTitleBarVisibility.WINDOWED && inFullscreen) {
            return false;
        }
    }
    if (!isTitleBarEmpty(configurationService)) {
        return true;
    }
    if (nativeTitleBarEnabled && hasNativeMenu(configurationService)) {
        return false;
    }
    if (isMacintosh && isNative) {
        return !inFullscreen;
    }
    if (isNative && !inFullscreen) {
        return true;
    }
    if (isWCOEnabled() && !inFullscreen) {
        return true;
    }
    const menuBarVisibility = !isAuxiliaryWindow(window) ? getMenuBarVisibility(configurationService) : 'hidden';
    switch (menuBarVisibility) {
        case 'classic':
            return !inFullscreen || !!menuBarToggled;
        case 'compact':
        case 'hidden':
            return false;
        case 'toggle':
            return !!menuBarToggled;
        case 'visible':
            return true;
        default:
            return isWeb ? false : !inFullscreen || !!menuBarToggled;
    }
}
function isTitleBarEmpty(configurationService) {
    if (configurationService.getValue(LayoutSettings.COMMAND_CENTER)) {
        return false;
    }
    const activityBarPosition = configurationService.getValue(LayoutSettings.ACTIVITY_BAR_LOCATION);
    if (activityBarPosition === ActivityBarPosition.TOP || activityBarPosition === ActivityBarPosition.BOTTOM) {
        return false;
    }
    const editorActionsLocation = configurationService.getValue(LayoutSettings.EDITOR_ACTIONS_LOCATION);
    const editorTabsMode = configurationService.getValue(LayoutSettings.EDITOR_TABS_MODE);
    if (editorActionsLocation === EditorActionsLocation.TITLEBAR || editorActionsLocation === EditorActionsLocation.DEFAULT && editorTabsMode === EditorTabsMode.NONE) {
        return false;
    }
    if (configurationService.getValue(LayoutSettings.LAYOUT_ACTIONS)) {
        return false;
    }
    return true;
}

export { ActivityBarPosition, EditorActionsLocation, EditorTabsMode, FLOATING_PANEL_MARGIN, LayoutSettings, PartOpensMaximizedOptions, Parts, Position, ZenModeSettings, getFloatingOuterEdgeOwners, getFloatingOuterGutterEdges, getFloatingSidebarSiblingToEditorStatus, isHorizontal, isMultiWindowPart, partOpensMaximizedFromString, positionFromString, positionToString, shouldShowCustomTitleBar };
