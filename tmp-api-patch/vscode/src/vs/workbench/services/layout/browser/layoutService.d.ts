import { IConfigurationService } from "../../../../platform/configuration/common/configuration.service.js";
import { IWorkbenchLayoutService } from "./layoutService.service.js";
export declare enum Parts {
    TITLEBAR_PART = "workbench.parts.titlebar",
    BANNER_PART = "workbench.parts.banner",
    ACTIVITYBAR_PART = "workbench.parts.activitybar",
    SIDEBAR_PART = "workbench.parts.sidebar",
    PANEL_PART = "workbench.parts.panel",
    AUXILIARYBAR_PART = "workbench.parts.auxiliarybar",
    SESSIONS_PART = "workbench.parts.sessions",
    EDITOR_PART = "workbench.parts.editor",
    STATUSBAR_PART = "workbench.parts.statusbar"
}
export declare enum ZenModeSettings {
    SHOW_TABS = "zenMode.showTabs",
    HIDE_LINENUMBERS = "zenMode.hideLineNumbers",
    HIDE_STATUSBAR = "zenMode.hideStatusBar",
    HIDE_ACTIVITYBAR = "zenMode.hideActivityBar",
    CENTER_LAYOUT = "zenMode.centerLayout",
    FULLSCREEN = "zenMode.fullScreen",
    RESTORE = "zenMode.restore",
    SILENT_NOTIFICATIONS = "zenMode.silentNotifications"
}
export declare enum LayoutSettings {
    ACTIVITY_BAR_LOCATION = "workbench.activityBar.location",
    ACTIVITY_BAR_AUTO_HIDE = "workbench.activityBar.autoHide",
    ACTIVITY_BAR_COMPACT = "workbench.activityBar.compact",
    EDITOR_TABS_MODE = "workbench.editor.showTabs",
    EDITOR_ACTIONS_LOCATION = "workbench.editor.editorActionsLocation",
    COMMAND_CENTER = "window.commandCenter",
    LAYOUT_ACTIONS = "workbench.layoutControl.enabled",
    SHADOWS = "workbench.shadows",
    MODERN_UI = "workbench.experimental.modernUI"
}
/**
 * The margin (in pixels) reserved on each side of a part when the Modern UI Update
 * experiment (`LayoutSettings.MODERN_UI`) is enabled. Parts grow or shrink their
 * content by this amount to leave room for the margin/border applied in CSS
 * (`src/vs/workbench/browser/media/floatingPanels.css`, `.floating-panels`).
 * Keep in sync with the `--vscode-spacing-size40` (4px) token used there.
 */
export declare const FLOATING_PANEL_MARGIN = 4;
export declare enum ActivityBarPosition {
    DEFAULT = "default",
    TOP = "top",
    BOTTOM = "bottom",
    HIDDEN = "hidden"
}
export declare enum EditorTabsMode {
    MULTIPLE = "multiple",
    SINGLE = "single",
    NONE = "none"
}
export declare enum EditorActionsLocation {
    DEFAULT = "default",
    TITLEBAR = "titleBar",
    HIDDEN = "hidden"
}
export declare enum Position {
    LEFT = 0,
    RIGHT = 1,
    BOTTOM = 2,
    TOP = 3
}
export declare function isHorizontal(position: Position): boolean;
export declare enum PartOpensMaximizedOptions {
    ALWAYS = 0,
    NEVER = 1,
    REMEMBER_LAST = 2
}
export type PanelAlignment = "left" | "center" | "right" | "justify";
export declare function positionToString(position: Position): string;
/**
 * Determines which window edge (left/right) is owned by the outermost floating card
 * when the Modern UI Update experiment is enabled, and which {@link Parts} owns it.
 * The owning part receives a doubled outer gutter so its contents do not hug the
 * window edge. Returns `undefined` for an edge when no floating card owns it (for
 * example the activity bar sits flush against that edge) or when the experiment is
 * disabled.
 *
 * The horizontal order of the parts is reconstructed from the same inputs the grid
 * layout uses (mirrors `Layout.adjustPartPositions` in `src/vs/workbench/browser/layout.ts`): the activity bar and primary side bar sit
 * on `getSideBarPosition()`, the secondary side bar on the opposite side, the editor in
 * the middle, and a vertical (left/right) panel immediately next to the editor on its
 * placement side. The outermost *visible* part on each edge wins; the activity bar is not
 * a floating card, so it yields no owner. A hidden editor is skipped, so a maximized side
 * bar (which spans the full content width) is correctly detected as the owner on both edges.
 *
 * Consumed by `AbstractPaneCompositePart` (side bars and panel) and `EditorPart`
 * (main editor) so the doubled-gutter decision stays in sync between them.
 */
export declare function getFloatingOuterEdgeOwners(layoutService: IWorkbenchLayoutService): {
    left: Parts | undefined;
    right: Parts | undefined;
};
/**
 * The window edges on which the given part is the outermost floating card and should
 * therefore receive a doubled outer gutter. A part can own both edges at once (notably
 * a horizontal bottom/top panel that spans the full width when the bars beside it are
 * hidden or not full-height). Convenience wrapper around {@link getFloatingOuterEdgeOwners}.
 */
export declare function getFloatingOuterGutterEdges(layoutService: IWorkbenchLayoutService, partId: Parts): {
    left: boolean;
    right: boolean;
};
/**
 * Whether the primary sidebar and auxiliary bar are each in the same grid row as the
 * editor (sibling to the editor) for a horizontal panel. A bar that is a sibling is not
 * full-height; it sits above or below the panel row rather than spanning the full height.
 * Mirrors the sideBarSiblingToEditor / auxiliaryBarSiblingToEditor formula used in
 * adjustPartPositions() in layout.ts.
 */
export declare function getFloatingSidebarSiblingToEditorStatus(layoutService: IWorkbenchLayoutService): {
    sideBar: boolean;
    auxBar: boolean;
};
export declare function positionFromString(str: string): Position;
export declare function partOpensMaximizedFromString(str: string): PartOpensMaximizedOptions;
export type MULTI_WINDOW_PARTS = Parts.EDITOR_PART | Parts.STATUSBAR_PART | Parts.TITLEBAR_PART;
export type SINGLE_WINDOW_PARTS = Exclude<Parts, MULTI_WINDOW_PARTS>;
export declare function isMultiWindowPart(part: Parts): part is MULTI_WINDOW_PARTS;
export interface IPartVisibilityChangeEvent {
    readonly partId: string;
    readonly visible: boolean;
}
export declare function shouldShowCustomTitleBar(configurationService: IConfigurationService, window: Window, menuBarToggled?: boolean): boolean;
