
import { isStandalone } from '../../base/browser/browser.js';
import { isWeb, isMacintosh, isNative, isWindows, isLinux } from '../../base/common/platform.js';
import { localize } from '../../nls.js';
import { Extensions, ConfigurationScope } from '../../platform/configuration/common/configurationRegistry.js';
import product from '../../platform/product/common/product.js';
import { Registry } from '../../platform/registry/common/platform.js';
import { ConfigurationMigrationWorkbenchContribution, DynamicWorkbenchSecurityConfiguration, workbenchConfigurationNodeBase, windowConfigurationNodeBase, DynamicWindowConfiguration, problemsConfigurationNodeBase, Extensions as Extensions$1 } from '../common/configuration.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../common/contributions.js';
import { NotificationsSettings, NotificationsPosition } from '../common/notifications.js';
import { CustomEditorLabelService } from '../services/editor/common/customEditorLabelService.js';
import { LayoutSettings, EditorActionsLocation, EditorTabsMode, ActivityBarPosition } from '../services/layout/browser/layoutService.js';
import { defaultWindowTitleSeparator, defaultWindowTitle } from './parts/titlebar/windowTitle.js';

const registry = ( Registry.as(Extensions.Configuration));
(function registerConfiguration() {
    registerWorkbenchContribution2(
        ConfigurationMigrationWorkbenchContribution.ID,
        ConfigurationMigrationWorkbenchContribution,
        WorkbenchPhase.Eventually
    );
    registerWorkbenchContribution2(
        DynamicWorkbenchSecurityConfiguration.ID,
        DynamicWorkbenchSecurityConfiguration,
        WorkbenchPhase.AfterRestored
    );
    registry.registerConfiguration({
        ...workbenchConfigurationNodeBase,
        "properties": {
            "workbench.externalBrowser": {
                type: "string",
                markdownDescription: ( localize(
                    4020,
                    "Configure the browser to use for opening http or https links externally. This can either be the name of the browser (`edge`, `chrome`, `firefox`) or an absolute path to the browser's executable. Will use the system default if not set."
                )),
                included: isNative,
                restricted: true
            },
            "workbench.editor.titleScrollbarSizing": {
                type: "string",
                enum: ["default", "large"],
                enumDescriptions: [( localize(4021, "The default size.")), ( localize(
                    4022,
                    "Increases the size, so it can be grabbed more easily with the mouse."
                ))],
                description: ( localize(
                    4023,
                    "Controls the height of the scrollbars used for tabs and breadcrumbs in the editor title area."
                )),
                default: "default"
            },
            "workbench.editor.titleScrollbarVisibility": {
                type: "string",
                enum: ["auto", "visible", "hidden"],
                enumDescriptions: [( localize(4024, "The horizontal scrollbar will be visible only when necessary.")), ( localize(4025, "The horizontal scrollbar will always be visible.")), ( localize(4026, "The horizontal scrollbar will always be hidden."))],
                description: ( localize(
                    4027,
                    "Controls the visibility of the scrollbars used for tabs and breadcrumbs in the editor title area."
                )),
                default: "auto"
            },
            [LayoutSettings.EDITOR_TABS_MODE]: {
                "type": "string",
                "enum": [EditorTabsMode.MULTIPLE, EditorTabsMode.SINGLE, EditorTabsMode.NONE],
                "enumDescriptions": [( localize(4028, "Each editor is displayed as a tab in the editor title area.")), ( localize(
                    4029,
                    "The active editor is displayed as a single large tab in the editor title area."
                )), ( localize(4030, "The editor title area is not displayed."))],
                "description": ( localize(
                    4031,
                    "Controls whether opened editors should show as individual tabs, one single large tab or if the title area should not be shown."
                )),
                "default": "multiple"
            },
            [LayoutSettings.EDITOR_ACTIONS_LOCATION]: {
                "type": "string",
                "enum": [
                    EditorActionsLocation.DEFAULT,
                    EditorActionsLocation.TITLEBAR,
                    EditorActionsLocation.HIDDEN
                ],
                "markdownEnumDescriptions": [( localize(
                    4032,
                    "Show editor actions in the window title bar when {0} is set to {1}. Otherwise, editor actions are shown in the editor tab bar.",
                    "`#workbench.editor.showTabs#`",
                    "`none`"
                )), ( localize(
                    4033,
                    "Show editor actions in the window title bar. If {0} is set to {1}, editor actions are hidden.",
                    "`#window.customTitleBarVisibility#`",
                    "`never`"
                )), ( localize(4034, "Editor actions are not shown."))],
                "markdownDescription": ( localize(4035, "Controls where the editor actions are shown.")),
                "default": "default",
                agentsWindow: {
                    default: "default",
                    readOnly: true
                }
            },
            "workbench.editor.alwaysShowEditorActions": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4036,
                    "Controls whether to always show the editor actions, even when the editor group is not active."
                )),
                "default": false
            },
            "workbench.editor.wrapTabs": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4037,
                    "Controls whether tabs should be wrapped over multiple lines when exceeding available space or whether a scrollbar should appear instead. This value is ignored when {0} is not set to '{1}'.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                )),
                "default": false
            },
            "workbench.editor.scrollToSwitchTabs": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4038,
                    "Controls whether scrolling over tabs will open them or not. By default tabs will only reveal upon scrolling, but not open. You can press and hold the Shift-key while scrolling to change this behavior for that duration. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                )),
                "default": false
            },
            "workbench.editor.highlightModifiedTabs": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4039,
                    "Controls whether a top border is drawn on tabs for editors that have unsaved changes. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    `multiple`
                )),
                "default": false
            },
            "workbench.editor.decorations.badges": {
                "type": "boolean",
                "markdownDescription": ( localize(4040, "Controls whether editor file decorations should use badges.")),
                "default": true
            },
            "workbench.editor.decorations.colors": {
                "type": "boolean",
                "markdownDescription": ( localize(4041, "Controls whether editor file decorations should use colors.")),
                "default": true
            },
            [CustomEditorLabelService.SETTING_ID_ENABLED]: {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4042,
                    "Controls whether the custom workbench editor labels should be applied."
                )),
                "default": true
            },
            [CustomEditorLabelService.SETTING_ID_PATTERNS]: {
                "type": "object",
                "markdownDescription": (() => {
                    let customEditorLabelDescription = ( localize(
                        4043,
                        "Controls the rendering of the editor label. Each __Item__ is a pattern that matches a file path. Both relative and absolute file paths are supported. The relative path must include the WORKSPACE_FOLDER (e.g `WORKSPACE_FOLDER/src/**.tsx` or `*/src/**.tsx`). Absolute patterns must start with a `/`. In case multiple patterns match, the longest matching path will be picked. Each __Value__ is the template for the rendered editor when the __Item__ matches. Variables are substituted based on the context:"
                    ));
                    customEditorLabelDescription += "\n- " + [( localize(
                        4044,
                        "`${dirname}`: name of the folder in which the file is located (e.g. `WORKSPACE_FOLDER/folder/file.txt -> folder`)."
                    )), ( localize(
                        4045,
                        "`${dirname(N)}`: name of the nth parent folder in which the file is located (e.g. `N=2: WORKSPACE_FOLDER/static/folder/file.txt -> WORKSPACE_FOLDER`). Folders can be picked from the start of the path by using negative numbers (e.g. `N=-1: WORKSPACE_FOLDER/folder/file.txt -> WORKSPACE_FOLDER`). If the __Item__ is an absolute pattern path, the first folder (`N=-1`) refers to the first folder in the absolute path, otherwise it corresponds to the workspace folder."
                    )), ( localize(
                        4046,
                        "`${filename}`: name of the file without the file extension (e.g. `WORKSPACE_FOLDER/folder/file.txt -> file`)."
                    )), ( localize(
                        4047,
                        "`${extname}`: the file extension (e.g. `WORKSPACE_FOLDER/folder/file.txt -> txt`)."
                    )), ( localize(
                        4048,
                        "`${extname(N)}`: the nth extension of the file separated by '.' (e.g. `N=2: WORKSPACE_FOLDER/folder/file.ext1.ext2.ext3 -> ext1`). Extension can be picked from the start of the extension by using negative numbers (e.g. `N=-1: WORKSPACE_FOLDER/folder/file.ext1.ext2.ext3 -> ext2`)."
                    ))].join("\n- ");
                    customEditorLabelDescription += "\n\n" + ( localize(
                        4049,
                        "Example: `\"**/static/**/*.html\": \"${filename} - ${dirname} (${extname})\"` will render a file `WORKSPACE_FOLDER/static/folder/file.html` as `file - folder (html)`."
                    ));
                    return customEditorLabelDescription;
                })(),
                additionalProperties: {
                    type: ["string", "null"],
                    markdownDescription: ( localize(
                        4050,
                        "The template which should be rendered when the pattern matches. May include the variables ${dirname}, ${filename} and ${extname}."
                    )),
                    minLength: 1,
                    pattern: ".*[a-zA-Z0-9].*"
                },
                "default": {}
            },
            "workbench.editor.labelFormat": {
                "type": "string",
                "enum": ["default", "short", "medium", "long"],
                "enumDescriptions": [( localize(
                    4051,
                    "Show the name of the file. When tabs are enabled and two files have the same name in one group the distinguishing sections of each file's path are added. When tabs are disabled, the path relative to the workspace folder is shown if the editor is active."
                )), ( localize(4052, "Show the name of the file followed by its directory name.")), ( localize(
                    4053,
                    "Show the name of the file followed by its path relative to the workspace folder."
                )), ( localize(4054, "Show the name of the file followed by its absolute path."))],
                "default": "default",
                "description": ( localize(4055, "Controls the format of the label for an editor."))
            },
            "workbench.editor.untitled.labelFormat": {
                "type": "string",
                "enum": ["content", "name"],
                "enumDescriptions": [( localize(
                    4056,
                    "The name of the untitled file is derived from the contents of its first line unless it has an associated file path. It will fallback to the name in case the line is empty or contains no word characters."
                )), ( localize(
                    4057,
                    "The name of the untitled file is not derived from the contents of the file."
                ))],
                "default": "content",
                "description": ( localize(4058, "Controls the format of the label for an untitled editor."))
            },
            "workbench.editor.empty.hint": {
                "type": "string",
                "enum": ["text", "hidden"],
                "default": "text",
                "markdownDescription": ( localize(
                    4059,
                    "Controls if the empty editor text hint should be visible in the editor."
                ))
            },
            "workbench.editor.languageDetection": {
                type: "boolean",
                default: true,
                description: ( localize(
                    4060,
                    "Controls whether the language in a text editor is automatically detected unless the language has been explicitly set by the language picker. This can also be scoped by language so you can specify which languages you do not want to be switched off of. This is useful for languages like Markdown that often contain other languages that might trick language detection into thinking it's the embedded language and not Markdown."
                )),
                scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
            },
            "workbench.editor.historyBasedLanguageDetection": {
                type: "boolean",
                default: true,
                description: ( localize(
                    4061,
                    "Enables use of editor history in language detection. This causes automatic language detection to favor languages that have been recently opened and allows for automatic language detection to operate with smaller inputs."
                ))
            },
            "workbench.editor.preferHistoryBasedLanguageDetection": {
                type: "boolean",
                default: false,
                description: ( localize(
                    4062,
                    "When enabled, a language detection model that takes into account editor history will be given higher precedence."
                ))
            },
            "workbench.editor.languageDetectionHints": {
                type: "object",
                default: {
                    "untitledEditors": true,
                    "notebookEditors": true
                },
                description: ( localize(
                    4063,
                    "When enabled, shows a status bar Quick Fix when the editor language doesn't match detected content language."
                )),
                additionalProperties: false,
                properties: {
                    untitledEditors: {
                        type: "boolean",
                        description: ( localize(4064, "Show in untitled text editors"))
                    },
                    notebookEditors: {
                        type: "boolean",
                        description: ( localize(4065, "Show in notebook editors"))
                    }
                }
            },
            "workbench.editor.tabActionLocation": {
                type: "string",
                enum: ["left", "right"],
                default: "right",
                markdownDescription: ( localize(
                    4066,
                    "Controls the position of the editor's tabs action buttons (close, unpin). This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.tabActionCloseVisibility": {
                type: "boolean",
                default: true,
                description: ( localize(4067, "Controls the visibility of the tab close action button."))
            },
            "workbench.editor.tabActionUnpinVisibility": {
                type: "boolean",
                default: true,
                description: ( localize(4068, "Controls the visibility of the tab unpin action button."))
            },
            "workbench.editor.showTabIndex": {
                "type": "boolean",
                "default": false,
                "markdownDescription": ( localize(
                    4069,
                    "When enabled, will show the tab index. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.tabSizing": {
                "type": "string",
                "enum": ["fit", "shrink", "fixed"],
                "default": "fit",
                "enumDescriptions": [( localize(4070, "Always keep tabs large enough to show the full editor label.")), ( localize(
                    4071,
                    "Allow tabs to get smaller when the available space is not enough to show all tabs at once."
                )), ( localize(
                    4072,
                    "Make all tabs the same size, while allowing them to get smaller when the available space is not enough to show all tabs at once."
                ))],
                "markdownDescription": ( localize(
                    4073,
                    "Controls the size of editor tabs. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.tabSizingFixedMinWidth": {
                "type": "number",
                "default": 50,
                "minimum": 38,
                "markdownDescription": ( localize(
                    4074,
                    "Controls the minimum width of tabs when {0} size is set to {1}.",
                    "`#workbench.editor.tabSizing#`",
                    "`fixed`"
                ))
            },
            "workbench.editor.tabSizingFixedMaxWidth": {
                "type": "number",
                "default": 160,
                "minimum": 38,
                "markdownDescription": ( localize(
                    4075,
                    "Controls the maximum width of tabs when {0} size is set to {1}.",
                    "`#workbench.editor.tabSizing#`",
                    "`fixed`"
                ))
            },
            "window.density.editorTabHeight": {
                "type": "string",
                "enum": ["default", "compact"],
                "default": "default",
                "markdownDescription": ( localize(
                    4076,
                    "Controls the height of editor tabs. Also applies to the title control bar when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.pinnedTabSizing": {
                "type": "string",
                "enum": ["normal", "compact", "shrink"],
                "default": "normal",
                "enumDescriptions": [( localize(4077, "A pinned tab inherits the look of non pinned tabs.")), ( localize(
                    4078,
                    "A pinned tab will show in a compact form with only icon or first letter of the editor name."
                )), ( localize(
                    4079,
                    "A pinned tab shrinks to a compact fixed size showing parts of the editor name."
                ))],
                "markdownDescription": ( localize(
                    4080,
                    "Controls the size of pinned editor tabs. Pinned tabs are sorted to the beginning of all opened tabs and typically do not close until unpinned. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.pinnedTabsOnSeparateRow": {
                "type": "boolean",
                "default": false,
                "markdownDescription": ( localize(
                    4081,
                    "When enabled, displays pinned tabs in a separate row above all other tabs. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                ))
            },
            "workbench.editor.preventPinnedEditorClose": {
                "type": "string",
                "enum": ["keyboardAndMouse", "keyboard", "mouse", "never"],
                "default": "keyboardAndMouse",
                "enumDescriptions": [( localize(
                    4082,
                    "Always prevent closing the pinned editor when using mouse middle click or keyboard."
                )), ( localize(4083, "Prevent closing the pinned editor when using the keyboard.")), ( localize(4084, "Prevent closing the pinned editor when using mouse middle click.")), ( localize(4085, "Never prevent closing a pinned editor."))],
                description: ( localize(
                    4086,
                    "Controls whether pinned editors should close when keyboard or middle mouse click is used for closing."
                ))
            },
            "workbench.editor.splitSizing": {
                "type": "string",
                "enum": ["auto", "distribute", "split"],
                "default": "auto",
                "enumDescriptions": [( localize(
                    4087,
                    "Splits the active editor group to equal parts, unless all editor groups are already in equal parts. In that case, splits all the editor groups to equal parts."
                )), ( localize(4088, "Splits all the editor groups to equal parts.")), ( localize(4089, "Splits the active editor group to equal parts."))],
                "description": ( localize(4090, "Controls the size of editor groups when splitting them.")),
                "keywords": ["pane"]
            },
            "workbench.editor.splitOnDragAndDrop": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4091,
                    "Controls if editor groups can be split from drag and drop operations by dropping an editor or file on the edges of the editor area."
                )),
                "keywords": ["pane"]
            },
            "workbench.editor.dragToOpenWindow": {
                "type": "boolean",
                "default": true,
                "markdownDescription": ( localize(
                    4092,
                    "Controls if editors can be dragged out of the window to open them in a new window. Press and hold the `Alt` key while dragging to toggle this dynamically."
                ))
            },
            "workbench.editor.focusRecentEditorAfterClose": {
                "type": "boolean",
                "description": ( localize(
                    4093,
                    "Controls whether editors are closed in most recently used order or from left to right."
                )),
                "default": true
            },
            "workbench.editor.showIcons": {
                "type": "boolean",
                "description": ( localize(
                    4094,
                    "Controls whether opened editors should show with an icon or not. This requires a file icon theme to be enabled as well."
                )),
                "default": true
            },
            "workbench.editor.enablePreview": {
                "type": "boolean",
                "description": ( localize(
                    4095,
                    "Controls whether preview mode is used when editors open. There is a maximum of one preview mode editor per editor group. This editor displays its filename in italics on its tab or title label and in the Open Editors view. Its contents will be replaced by the next editor opened in preview mode. Making a change in a preview mode editor will persist it, as will a double-click on its label, or the 'Keep Open' option in its label context menu. Opening a file from Explorer with a double-click persists its editor immediately."
                )),
                "default": true
            },
            "workbench.editor.enablePreviewFromQuickOpen": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4096,
                    "Controls whether editors opened from Quick Open show as preview editors. Preview editors do not stay open, and are reused until explicitly set to be kept open (via double-click or editing). When enabled, hold Ctrl before selection to open an editor as a non-preview. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                )),
                "default": false
            },
            "workbench.editor.enablePreviewFromCodeNavigation": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4097,
                    "Controls whether editors remain in preview when a code navigation is started from them. Preview editors do not stay open, and are reused until explicitly set to be kept open (via double-click or editing). This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                )),
                "default": false
            },
            "workbench.editor.closeOnFileDelete": {
                "type": "boolean",
                "description": ( localize(
                    4098,
                    "Controls whether editors showing a file that was opened during the session should close automatically when getting deleted or renamed by some other process. Disabling this will keep the editor open  on such an event. Note that deleting from within the application will always close the editor and that editors with unsaved changes will never close to preserve your data."
                )),
                "default": false
            },
            "workbench.editor.openPositioning": {
                "type": "string",
                "enum": ["left", "right", "first", "last"],
                "default": "right",
                "markdownDescription": ( localize(
                    4099,
                    "Controls where editors open. Select {0} or {1} to open editors to the left or right of the currently active one. Select {2} or {3} to open editors independently from the currently active one.",
                    "`left`",
                    "`right`",
                    "`first`",
                    "`last`"
                ))
            },
            "workbench.editor.openSideBySideDirection": {
                "type": "string",
                "enum": ["right", "down"],
                "default": "right",
                "markdownDescription": ( localize(
                    4100,
                    "Controls the default direction of editors that are opened side by side (for example, from the Explorer). By default, editors will open on the right hand side of the currently active one. If changed to `down`, the editors will open below the currently active one. This also impacts the split editor action in the editor toolbar."
                ))
            },
            "workbench.editor.closeEmptyGroups": {
                "type": "boolean",
                "description": ( localize(
                    4101,
                    "Controls the behavior of empty editor groups when the last tab in the group is closed. When enabled, empty groups will automatically close. When disabled, empty groups will remain part of the grid."
                )),
                "default": true,
                "keywords": ["pane"]
            },
            "workbench.editor.revealIfOpen": {
                "type": "boolean",
                "description": ( localize(
                    4102,
                    "Controls whether an editor is revealed in any of the visible groups if opened. If disabled, an editor will prefer to open in the currently active editor group. If enabled, an already opened editor will be revealed instead of opened again in the currently active editor group. Note that there are some cases where this setting is ignored, such as when forcing an editor to open in a specific group or to the side of the currently active group."
                )),
                "default": false
            },
            "workbench.editor.useModal": {
                "type": "string",
                "enum": ["off", "some", "all"],
                "enumDescriptions": [( localize(4103, "Editors never open in a modal overlay.")), ( localize(
                    4104,
                    "Certain editors such as Settings and Keyboard Shortcuts may open in a centered modal overlay."
                )), ( localize(4105, "All editors open in a centered modal overlay."))],
                "description": ( localize(4106, "Controls whether editors open in a modal overlay.")),
                "default": "some",
                agentsWindow: {
                    default: "all"
                }
            },
            "workbench.editor.swipeToNavigate": {
                "type": "boolean",
                "description": ( localize(
                    4107,
                    "Navigate between open files using three-finger swipe horizontally. Note that System Preferences > Trackpad > More Gestures > 'Swipe between pages' must be set to 'Swipe with two or three fingers'."
                )),
                "default": false,
                "included": isMacintosh && !isWeb
            },
            "workbench.editor.mouseBackForwardToNavigate": {
                "type": "boolean",
                "description": ( localize(
                    4108,
                    "Enables the use of mouse buttons four and five for commands 'Go Back' and 'Go Forward'."
                )),
                "default": true
            },
            "workbench.editor.navigationScope": {
                "type": "string",
                "enum": ["default", "editorGroup", "editor"],
                "default": "default",
                "markdownDescription": ( localize(
                    4109,
                    "Controls the scope of history navigation in editors for commands such as 'Go Back' and 'Go Forward'."
                )),
                "enumDescriptions": [( localize(4110, "Navigate across all opened editors and editor groups.")), ( localize(4111, "Navigate only in editors of the active editor group.")), ( localize(4112, "Navigate only in the active editor."))]
            },
            "workbench.editor.restoreViewState": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4113,
                    "Restores the last editor view state (such as scroll position) when re-opening editors after they have been closed. Editor view state is stored per editor group and discarded when a group closes. Use the {0} setting to use the last known view state across all editor groups in case no previous view state was found for a editor group.",
                    "`#workbench.editor.sharedViewState#`"
                )),
                "default": true,
                "scope": ConfigurationScope.LANGUAGE_OVERRIDABLE
            },
            "workbench.editor.sharedViewState": {
                "type": "boolean",
                "description": ( localize(
                    4114,
                    "Preserves the most recent editor view state (such as scroll position) across all editor groups and restores that if no specific editor view state is found for the editor group."
                )),
                "default": false
            },
            "workbench.editor.restoreEditors": {
                "type": "boolean",
                "description": ( localize(
                    4115,
                    "Controls whether editors are restored on startup. When disabled, only dirty editors will be restored from the previous session."
                )),
                "default": true,
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            "workbench.editor.splitInGroupLayout": {
                "type": "string",
                "enum": ["vertical", "horizontal"],
                "default": "horizontal",
                "markdownDescription": ( localize(
                    4116,
                    "Controls the layout for when an editor is split in an editor group to be either vertical or horizontal."
                )),
                "enumDescriptions": [( localize(4117, "Editors are positioned from top to bottom.")), ( localize(4118, "Editors are positioned from left to right."))]
            },
            "workbench.editor.centeredLayoutAutoResize": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4119,
                    "Controls if the centered layout should automatically resize to maximum width when more than one group is open. Once only one group is open it will resize back to the original centered width."
                ))
            },
            "workbench.editor.centeredLayoutFixedWidth": {
                "type": "boolean",
                "default": false,
                "description": ( localize(
                    4120,
                    "Controls whether the centered layout tries to maintain constant width when the window is resized."
                ))
            },
            "workbench.editor.doubleClickTabToToggleEditorGroupSizes": {
                "type": "string",
                "enum": ["maximize", "expand", "off"],
                "default": "expand",
                "markdownDescription": ( localize(
                    4121,
                    "Controls how the editor group is resized when double clicking on a tab. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.editor.showTabs#`",
                    "`multiple`"
                )),
                "enumDescriptions": [( localize(
                    4122,
                    "All other editor groups are hidden and the current editor group is maximized to take up the entire editor area."
                )), ( localize(
                    4123,
                    "The editor group takes as much space as possible by making all other editor groups as small as possible."
                )), ( localize(4124, "No editor group is resized when double clicking on a tab."))],
                agentsWindow: {
                    default: "maximize",
                    readOnly: true
                }
            },
            "workbench.editor.limit.enabled": {
                "type": "boolean",
                "default": false,
                "description": ( localize(
                    4125,
                    "Controls if the number of opened editors should be limited or not. When enabled, less recently used editors will close to make space for newly opening editors."
                ))
            },
            "workbench.editor.limit.value": {
                "type": "number",
                "default": 10,
                "exclusiveMinimum": 0,
                "markdownDescription": ( localize(
                    4126,
                    "Controls the maximum number of opened editors. Use the {0} setting to control this limit per editor group or across all groups.",
                    "`#workbench.editor.limit.perEditorGroup#`"
                ))
            },
            "workbench.editor.limit.excludeDirty": {
                "type": "boolean",
                "default": false,
                "description": ( localize(
                    4127,
                    "Controls if the maximum number of opened editors should exclude dirty editors for counting towards the configured limit."
                ))
            },
            "workbench.editor.limit.perEditorGroup": {
                "type": "boolean",
                "default": false,
                "description": ( localize(
                    4128,
                    "Controls if the limit of maximum opened editors should apply per editor group or across all editor groups."
                ))
            },
            "workbench.localHistory.enabled": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4129,
                    "Controls whether local file history is enabled. When enabled, the file contents of an editor that is saved will be stored to a backup location to be able to restore or review the contents later. Changing this setting has no effect on existing local file history entries."
                )),
                "scope": ConfigurationScope.RESOURCE
            },
            "workbench.localHistory.maxFileSize": {
                "type": "number",
                "default": 256,
                "minimum": 1,
                "description": ( localize(
                    4130,
                    "Controls the maximum size of a file (in KB) to be considered for local file history. Files that are larger will not be added to the local file history. Changing this setting has no effect on existing local file history entries."
                )),
                "scope": ConfigurationScope.RESOURCE
            },
            "workbench.localHistory.maxFileEntries": {
                "type": "number",
                "default": 50,
                "minimum": 0,
                "description": ( localize(
                    4131,
                    "Controls the maximum number of local file history entries per file. When the number of local file history entries exceeds this number for a file, the oldest entries will be discarded."
                )),
                "scope": ConfigurationScope.RESOURCE
            },
            "workbench.localHistory.exclude": {
                "type": "object",
                "patternProperties": {
                    ".*": {
                        "type": "boolean"
                    }
                },
                "markdownDescription": ( localize(
                    4132,
                    "Configure paths or [glob patterns](https://aka.ms/vscode-glob-patterns) for excluding files from the local file history. Glob patterns are always evaluated relative to the path of the workspace folder unless they are absolute paths. Changing this setting has no effect on existing local file history entries."
                )),
                "scope": ConfigurationScope.RESOURCE
            },
            "workbench.localHistory.mergeWindow": {
                "type": "number",
                "default": 10,
                "minimum": 1,
                "markdownDescription": ( localize(
                    4133,
                    "Configure an interval in seconds during which the last entry in local file history is replaced with the entry that is being added. This helps reduce the overall number of entries that are added, for example when auto save is enabled. This setting is only applied to entries that have the same source of origin. Changing this setting has no effect on existing local file history entries."
                )),
                "scope": ConfigurationScope.RESOURCE
            },
            "workbench.commandPalette.history": {
                "type": "number",
                "description": ( localize(
                    4134,
                    "Controls the number of recently used commands to keep in history for the command palette. Set to 0 to disable command history."
                )),
                "default": 50,
                "minimum": 0
            },
            "workbench.commandPalette.preserveInput": {
                "type": "boolean",
                "description": ( localize(
                    4135,
                    "Controls whether the last typed input to the command palette should be restored when opening it the next time."
                )),
                "default": false
            },
            "workbench.commandPalette.experimental.suggestCommands": {
                "type": "boolean",
                tags: ["experimental"],
                "description": ( localize(
                    4136,
                    "Controls whether the command palette should have a list of commonly used commands."
                )),
                "default": false
            },
            "workbench.commandPalette.experimental.askChatLocation": {
                "type": "string",
                tags: ["experimental"],
                "description": ( localize(4137, "Controls where the command palette should ask chat questions.")),
                "default": "chatView",
                enum: ["chatView", "quickChat"],
                enumDescriptions: [( localize(4138, "Ask chat questions in the Chat view.")), ( localize(4139, "Ask chat questions in Quick Chat."))]
            },
            "workbench.commandPalette.showAskInChat": {
                "type": "boolean",
                tags: ["experimental"],
                "description": ( localize(
                    4140,
                    "Controls whether the command palette shows 'Ask in Chat' option at the bottom."
                )),
                "default": true
            },
            "workbench.commandPalette.experimental.enableNaturalLanguageSearch": {
                "type": "boolean",
                tags: ["experimental"],
                "description": ( localize(
                    4141,
                    "Controls whether the command palette should include similar commands. You must have an extension installed that provides Natural Language support."
                )),
                "default": true
            },
            "workbench.quickOpen.closeOnFocusLost": {
                "type": "boolean",
                "description": ( localize(
                    4142,
                    "Controls whether Quick Open should close automatically once it loses focus."
                )),
                "default": true
            },
            "workbench.quickOpen.preserveInput": {
                "type": "boolean",
                "description": ( localize(
                    4143,
                    "Controls whether the last typed input to Quick Open should be restored when opening it the next time."
                )),
                "default": false
            },
            "workbench.settings.openDefaultSettings": {
                "type": "boolean",
                "description": ( localize(
                    4144,
                    "Controls whether opening settings also opens an editor showing all default settings."
                )),
                "default": false
            },
            "workbench.settings.useSplitJSON": {
                "type": "boolean",
                "markdownDescription": ( localize(
                    4145,
                    "Controls whether to use the split JSON editor when editing settings as JSON."
                )),
                "default": false
            },
            "workbench.settings.openDefaultKeybindings": {
                "type": "boolean",
                "description": ( localize(
                    4146,
                    "Controls whether opening keybinding settings also opens an editor showing all default keybindings."
                )),
                "default": false
            },
            "workbench.settings.alwaysShowAdvancedSettings": {
                "type": "boolean",
                "description": ( localize(
                    4147,
                    "Controls whether advanced settings are always shown in the settings editor without requiring the `@tag:advanced` filter."
                )),
                "default": product.quality !== "stable"
            },
            "workbench.sideBar.location": {
                "type": "string",
                "enum": ["left", "right"],
                "default": "left",
                "description": ( localize(
                    4148,
                    "Controls the location of the primary side bar and activity bar. They can either show on the left or right of the workbench. The secondary side bar will show on the opposite side of the workbench."
                )),
                agentsWindow: {
                    default: "left",
                    readOnly: true
                }
            },
            "workbench.panel.showLabels": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4149,
                    "Controls whether activity items in the panel title are shown as label or icon."
                ))
            },
            "workbench.panel.defaultLocation": {
                "type": "string",
                "enum": ["left", "bottom", "top", "right"],
                "default": "bottom",
                "description": ( localize(
                    4150,
                    "Controls the default location of the panel (Terminal, Debug Console, Output, Problems) in a new workspace. It can either show at the bottom, top, right, or left of the editor area."
                )),
                agentsWindow: {
                    default: "bottom",
                    readOnly: true
                }
            },
            "workbench.panel.opensMaximized": {
                "type": "string",
                "enum": ["always", "never", "preserve"],
                "default": "preserve",
                "description": ( localize(
                    4151,
                    "Controls whether the panel opens maximized. It can either always open maximized, never open maximized, or open to the last state it was in before being closed."
                )),
                "enumDescriptions": [( localize(4152, "Always maximize the panel when opening it.")), ( localize(4153, "Never maximize the panel when opening it.")), ( localize(4154, "Open the panel to the state that it was in, before it was closed."))],
                agentsWindow: {
                    default: "never",
                    readOnly: true
                }
            },
            "workbench.secondarySideBar.defaultVisibility": {
                "type": "string",
                "enum": [
                    "hidden",
                    "visibleInWorkspace",
                    "visible",
                    "maximizedInWorkspace",
                    "maximized"
                ],
                "default": "visibleInWorkspace",
                "description": ( localize(
                    4155,
                    "Controls the default visibility of the secondary side bar in workspaces or empty windows that are opened for the first time. Can be overridden by the agent sessions startup editor setting."
                )),
                "enumDescriptions": [( localize(4156, "The secondary side bar is hidden by default.")), ( localize(
                    4157,
                    "The secondary side bar is visible by default if a workspace is opened."
                )), ( localize(4158, "The secondary side bar is visible by default.")), ( localize(
                    4159,
                    "The secondary side bar is visible and maximized by default if a workspace is opened."
                )), ( localize(4160, "The secondary side bar is visible and maximized by default."))],
                agentsWindow: {
                    default: "visibleInWorkspace",
                    readOnly: true
                }
            },
            "workbench.secondarySideBar.forceMaximized": {
                "type": "boolean",
                "default": false,
                tags: ["experimental"],
                "description": ( localize(
                    4161,
                    "Controls whether the secondary side bar is enforced to always show maximized on startup and when there are no open editors, in layouts that support a maximized secondary side bar."
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            "workbench.secondarySideBar.showLabels": {
                "type": "boolean",
                "default": true,
                "markdownDescription": ( localize(
                    4162,
                    "Controls whether activity items in the secondary side bar title are shown as label or icon. This setting only has an effect when {0} is not set to {1}.",
                    "`#workbench.activityBar.location#`",
                    "`top`"
                )),
                agentsWindow: {
                    default: true,
                    readOnly: true
                }
            },
            "workbench.statusBar.visible": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4163,
                    "Controls the visibility of the status bar at the bottom of the workbench."
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            [NotificationsSettings.NOTIFICATIONS_POSITION]: {
                "type": "string",
                "enum": [
                    NotificationsPosition.BOTTOM_RIGHT,
                    NotificationsPosition.BOTTOM_LEFT,
                    NotificationsPosition.TOP_RIGHT
                ],
                "default": NotificationsPosition.BOTTOM_RIGHT,
                "description": ( localize(
                    4164,
                    "Controls the position of the notification toasts and notification center."
                )),
                "enumDescriptions": [( localize(4165, "Show notifications in the bottom right corner.")), ( localize(4166, "Show notifications in the bottom left corner.")), ( localize(
                    4167,
                    "Show notifications in the top right corner, similar to OS-level notifications."
                ))],
                "tags": ["experimental"],
                "experiment": {
                    "mode": "auto"
                }
            },
            [NotificationsSettings.NOTIFICATIONS_BUTTON]: {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4168,
                    "Controls the visibility of the Notifications button in the title bar. Only applies when notifications are positioned at the top right."
                ))
            },
            [LayoutSettings.ACTIVITY_BAR_LOCATION]: {
                "type": "string",
                "enum": ["default", "top", "bottom", "hidden"],
                "default": "default",
                "markdownDescription": ( localize(
                    4169,
                    "Controls the location of the Activity Bar relative to the Primary and Secondary Side Bars."
                )),
                "enumDescriptions": [( localize(
                    4170,
                    "Show the Activity Bar on the side of the Primary Side Bar and on top of the Secondary Side Bar."
                )), ( localize(
                    4171,
                    "Show the Activity Bar on top of the Primary and Secondary Side Bars."
                )), ( localize(
                    4172,
                    "Show the Activity Bar at the bottom of the Primary and Secondary Side Bars."
                )), ( localize(4173, "Hide the Activity Bar in the Primary and Secondary Side Bars."))],
                agentsWindow: {
                    default: "default",
                    readOnly: true
                }
            },
            [LayoutSettings.ACTIVITY_BAR_AUTO_HIDE]: {
                "type": "boolean",
                "default": false,
                "markdownDescription": ( localize(
                    4174,
                    "Controls whether the Activity Bar is automatically hidden when there is only one view container to show. This applies to the Primary and Secondary Side Bars when {0} is set to {1} or {2}.",
                    "`#workbench.activityBar.location#`",
                    "`top`",
                    "`bottom`"
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            [LayoutSettings.ACTIVITY_BAR_COMPACT]: {
                "type": "boolean",
                "default": false,
                "markdownDescription": ( localize(
                    4175,
                    "Controls whether the Activity Bar uses a compact layout with smaller icons and reduced width. This setting only applies when {0} is set to {1}.",
                    "`#workbench.activityBar.location#`",
                    "`default`"
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            "workbench.activityBar.iconClickBehavior": {
                "type": "string",
                "enum": ["toggle", "focus"],
                "default": "toggle",
                "markdownDescription": ( localize(
                    4176,
                    "Controls the behavior of clicking an Activity Bar icon in the workbench. This value is ignored when {0} is not set to {1}.",
                    "`#workbench.activityBar.location#`",
                    "`default`"
                )),
                "enumDescriptions": [( localize(4177, "Hide the Primary Side Bar if the clicked item is already visible.")), ( localize(4178, "Focus the Primary Side Bar if the clicked item is already visible."))],
                agentsWindow: {
                    default: "toggle",
                    readOnly: true
                }
            },
            "workbench.view.alwaysShowHeaderActions": {
                "type": "boolean",
                "default": false,
                "description": ( localize(
                    4179,
                    "Controls the visibility of view header actions. View header actions may either be always visible, or only visible when that view is focused or hovered over."
                ))
            },
            "workbench.view.showQuietly": {
                "type": "object",
                "description": ( localize(
                    4180,
                    "If an extension requests a hidden view to be shown, display a clickable status bar indicator instead."
                )),
                "scope": ConfigurationScope.WINDOW,
                "properties": {
                    "workbench.panel.output": {
                        "type": "boolean",
                        "description": ( localize(4181, "Output view"))
                    }
                },
                "additionalProperties": false
            },
            "workbench.fontAliasing": {
                "type": "string",
                "enum": ["default", "antialiased", "none", "auto"],
                "default": "default",
                "description": ( localize(4182, "Controls font aliasing method in the workbench.")),
                "enumDescriptions": [( localize(
                    4183,
                    "Sub-pixel font smoothing. On most non-retina displays this will give the sharpest text."
                )), ( localize(
                    4184,
                    "Smooth the font on the level of the pixel, as opposed to the subpixel. Can make the font appear lighter overall."
                )), ( localize(4185, "Disables font smoothing. Text will show with jagged sharp edges.")), ( localize(
                    4186,
                    "Applies `default` or `antialiased` automatically based on the DPI of displays."
                ))],
                "included": isMacintosh
            },
            "workbench.settings.editor": {
                "type": "string",
                "enum": ["ui", "json"],
                "enumDescriptions": [( localize(4187, "Use the settings UI editor.")), ( localize(4188, "Use the JSON file editor."))],
                "description": ( localize(4189, "Determines which Settings editor to use by default.")),
                "default": "ui",
                "scope": ConfigurationScope.WINDOW
            },
            "workbench.settings.showAISearchToggle": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4190,
                    "Controls whether the AI search results toggle is shown in the search bar in the Settings editor after doing a search and once AI search results are available."
                ))
            },
            "workbench.hover.delay": {
                "type": "number",
                "description": ( localize(
                    4191,
                    "Controls the delay in milliseconds after which the hover is shown for workbench items (ex. some extension provided tree view items). Already visible items may require a refresh before reflecting this setting change."
                )),
                "default": isMacintosh ? 1500 : 500,
                "minimum": 0
            },
            "workbench.hover.reducedDelay": {
                "type": "number",
                "description": ( localize(
                    4192,
                    "Controls the reduced delay in milliseconds used for showing hovers in specific contexts where faster feedback is beneficial."
                )),
                "default": 500,
                "minimum": 0
            },
            "workbench.reduceMotion": {
                type: "string",
                description: ( localize(
                    4193,
                    "Controls whether the workbench should render with fewer animations."
                )),
                "enumDescriptions": [( localize(4194, "Always render with reduced motion.")), ( localize(4195, "Do not render with reduced motion")), ( localize(4196, "Render with reduced motion based on OS configuration."))],
                default: "auto",
                tags: ["accessibility"],
                enum: ["on", "off", "auto"]
            },
            "workbench.reduceTransparency": {
                type: "string",
                description: ( localize(
                    4197,
                    "Controls whether the workbench should render with fewer transparency and blur effects for improved performance."
                )),
                "enumDescriptions": [( localize(4198, "Always render without transparency and blur effects.")), ( localize(4199, "Do not reduce transparency and blur effects.")), ( localize(4200, "Reduce transparency and blur effects based on OS configuration."))],
                default: "off",
                tags: ["accessibility"],
                enum: ["on", "off", "auto"]
            },
            "workbench.navigationControl.enabled": {
                "type": "boolean",
                "default": true,
                "markdownDescription": isWeb ? ( localize(4201, "Controls whether the navigation control in the title bar is shown.")) : ( localize(
                    4202,
                    "Controls whether the navigation control is shown in the custom title bar. This setting only has an effect when {0} is not set to {1}.",
                    "`#window.customTitleBarVisibility#`",
                    "`never`"
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            [LayoutSettings.LAYOUT_ACTIONS]: {
                "type": "boolean",
                "default": true,
                "markdownDescription": isWeb ? ( localize(4203, "Controls whether the layout control in the title bar is shown.")) : ( localize(
                    4204,
                    "Controls whether the layout control is shown in the custom title bar. This setting only has an effect when {0} is not set to {1}.",
                    "`#window.customTitleBarVisibility#`",
                    "`never`"
                )),
                agentsWindow: {
                    default: true,
                    readOnly: true
                }
            },
            "workbench.layoutControl.type": {
                "type": "string",
                "enum": ["menu", "toggles", "both"],
                "enumDescriptions": [( localize(4205, "Shows a single button with a dropdown of layout options.")), ( localize(
                    4206,
                    "Shows several buttons for toggling the visibility of the panels and side bar."
                )), ( localize(4207, "Shows both the dropdown and toggle buttons."))],
                "default": "both",
                "description": ( localize(
                    4208,
                    "Controls whether the layout control in the custom title bar is displayed as a single menu button or with multiple UI toggles."
                )),
                agentsWindow: {
                    default: "both",
                    readOnly: true
                }
            },
            "workbench.tips.enabled": {
                "type": "boolean",
                "default": true,
                "description": ( localize(4209, "When enabled, will show the watermark tips when no editor is open.")),
                agentsWindow: {
                    default: false
                }
            },
            [LayoutSettings.SHADOWS]: {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4210,
                    "Controls whether shadow effects are shown around the side panels and other workbench elements."
                ))
            },
            [LayoutSettings.MODERN_UI]: {
                "type": "boolean",
                "default": false,
                "tags": ["experimental"],
                "description": ( localize(
                    4211,
                    "Controls whether the experimental Modern UI Update is enabled. When on, the side bars and bottom panel are shown as floating cards with rounded corners and gaps, and a set of refreshed workbench styles is applied, matching the Agents window design."
                ))
            }
        }
    });
    let windowTitleDescription = ( localize(
        4212,
        "Controls the window title based on the current context such as the opened workspace or active editor. Variables are substituted based on the context:"
    ));
    windowTitleDescription += "\n- " + [( localize(4213, "`${activeEditorShort}`: the file name (e.g. myFile.txt).")), ( localize(
        4214,
        "`${activeEditorMedium}`: the path of the file relative to the workspace folder (e.g. myFolder/myFileFolder/myFile.txt)."
    )), ( localize(
        4215,
        "`${activeEditorLong}`: the full path of the file (e.g. /Users/Development/myFolder/myFileFolder/myFile.txt)."
    )), ( localize(
        4216,
        "`${activeEditorLanguageId}`: the language identifier of the active editor (e.g. typescript)."
    )), ( localize(
        4217,
        "`${activeFolderShort}`: the name of the folder the file is contained in (e.g. myFileFolder)."
    )), ( localize(
        4218,
        "`${activeFolderMedium}`: the path of the folder the file is contained in, relative to the workspace folder (e.g. myFolder/myFileFolder)."
    )), ( localize(
        4219,
        "`${activeFolderLong}`: the full path of the folder the file is contained in (e.g. /Users/Development/myFolder/myFileFolder)."
    )), ( localize(
        4220,
        "`${folderName}`: name of the workspace folder the file is contained in (e.g. myFolder)."
    )), ( localize(
        4221,
        "`${folderPath}`: file path of the workspace folder the file is contained in (e.g. /Users/Development/myFolder)."
    )), ( localize(
        4222,
        "`${rootName}`: name of the workspace with optional remote name and workspace indicator if applicable (e.g. myFolder, myRemoteFolder [SSH] or myWorkspace (Workspace))."
    )), ( localize(
        4223,
        "`${rootNameShort}`: shortened name of the workspace without suffixes (e.g. myFolder, myRemoteFolder or myWorkspace)."
    )), ( localize(
        4224,
        "`${rootPath}`: file path of the opened workspace or folder (e.g. /Users/Development/myWorkspace)."
    )), ( localize(
        4225,
        "`${profileName}`: name of the profile in which the workspace is opened (e.g. Data Science (Profile)). Ignored if default profile is used."
    )), ( localize(4226, "`${appName}`: e.g. VS Code.")), ( localize(4227, "`${remoteName}`: e.g. SSH")), ( localize(
        4228,
        "`${dirty}`: an indicator for when the active editor has unsaved changes."
    )), ( localize(4229, "`${focusedView}`: the name of the view that is currently focused.")), ( localize(
        4230,
        "`${activeRepositoryName}`: the name of the active repository (e.g. vscode)."
    )), ( localize(
        4231,
        "`${activeRepositoryBranchName}`: the name of the active branch in the active repository (e.g. main)."
    )), ( localize(
        4232,
        "`${activeEditorState}`: provides information about the state of the active editor (e.g. modified). This will be appended by default when in screen reader mode with {0} enabled.",
        "`accessibility.windowTitleOptimized`"
    )), ( localize(
        4233,
        "`${separator}`: a conditional separator (\" - \") that only shows when surrounded by variables with values or static text."
    ))].join("\n- ");
    registry.registerConfiguration({
        ...windowConfigurationNodeBase,
        "properties": {
            "window.title": {
                "type": "string",
                "default": defaultWindowTitle,
                "markdownDescription": windowTitleDescription,
                agentsWindow: {
                    default: "${appName}",
                    readOnly: true
                }
            },
            "window.titleSeparator": {
                "type": "string",
                "default": defaultWindowTitleSeparator,
                "markdownDescription": ( localize(4234, "Separator used by {0}.", "`#window.title#`"))
            },
            [LayoutSettings.COMMAND_CENTER]: {
                type: "boolean",
                default: true,
                markdownDescription: isWeb ? ( localize(4235, "Show command launcher together with the window title.")) : ( localize(
                    4236,
                    "Show command launcher together with the window title. This setting only has an effect when {0} is not set to {1}.",
                    "`#window.customTitleBarVisibility#`",
                    "`never`"
                )),
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            "window.menuBarVisibility": {
                "type": "string",
                "enum": ["classic", "visible", "toggle", "hidden", "compact"],
                "markdownEnumDescriptions": [( localize(
                    4237,
                    "Menu is displayed at the top of the window and only hidden in full screen mode."
                )), ( localize(
                    4238,
                    "Menu is always visible at the top of the window even in full screen mode."
                )), isMacintosh ? ( localize(
                    4239,
                    "Menu is hidden but can be displayed at the top of the window by executing the `Focus Application Menu` command."
                )) : ( localize(
                    4240,
                    "Menu is hidden but can be displayed at the top of the window via the Alt key."
                )), ( localize(4241, "Menu is always hidden.")), isWeb ? ( localize(4242, "Menu is displayed as a compact button in the side bar.")) : ( localize(
                    4243,
                    "Menu is displayed as a compact button in the side bar. This value is ignored when {0} is {1} and {2} is either {3} or {4}.",
                    "`#window.titleBarStyle#`",
                    "`native`",
                    "`#window.menuStyle#`",
                    "`native`",
                    "`inherit`"
                ))],
                "default": isWeb ? "compact" : "classic",
                "scope": ConfigurationScope.APPLICATION,
                "markdownDescription": isMacintosh ? ( localize(
                    4244,
                    "Control the visibility of the menu bar. A setting of 'toggle' means that the menu bar is hidden and executing `Focus Application Menu` will show it. A setting of 'compact' will move the menu into the side bar."
                )) : ( localize(
                    4245,
                    "Control the visibility of the menu bar. A setting of 'toggle' means that the menu bar is hidden and a single press of the Alt key will show it. A setting of 'compact' will move the menu into the side bar."
                )),
                "included": isWindows || isLinux || isWeb
            },
            "window.enableMenuBarMnemonics": {
                "type": "boolean",
                "default": true,
                "scope": ConfigurationScope.APPLICATION,
                "description": ( localize(
                    4246,
                    "Controls whether the main menus can be opened via Alt-key shortcuts. Disabling mnemonics allows to bind these Alt-key shortcuts to editor commands instead."
                )),
                "included": isWindows || isLinux
            },
            "window.customMenuBarAltFocus": {
                "type": "boolean",
                "default": true,
                "scope": ConfigurationScope.APPLICATION,
                "markdownDescription": ( localize(
                    4247,
                    "Controls whether the menu bar will be focused by pressing the Alt-key. This setting has no effect on toggling the menu bar with the Alt-key."
                )),
                "included": isWindows || isLinux,
                agentsWindow: {
                    default: false,
                    readOnly: true
                }
            },
            "window.openFilesInNewWindow": {
                "type": "string",
                "enum": ["on", "off", "default"],
                "enumDescriptions": [( localize(4248, "Files will open in a new window.")), ( localize(
                    4249,
                    "Files will open in the window with the files' folder open or the last active window."
                )), isMacintosh ? ( localize(
                    4250,
                    "Files will open in the window with the files' folder open or the last active window unless opened via the Dock or from Finder."
                )) : ( localize(
                    4251,
                    "Files will open in a new window unless picked from within the application (e.g. via the File menu)."
                ))],
                "default": "off",
                "scope": ConfigurationScope.APPLICATION,
                "markdownDescription": isMacintosh ? ( localize(
                    4252,
                    "Controls whether files should open in a new window when using a command line or file dialog.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option)."
                )) : ( localize(
                    4253,
                    "Controls whether files should open in a new window when using a command line or file dialog.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option)."
                ))
            },
            "window.openFoldersInNewWindow": {
                "type": "string",
                "enum": ["on", "off", "default"],
                "enumDescriptions": [( localize(4254, "Folders will open in a new window.")), ( localize(4255, "Folders will replace the last active window.")), ( localize(
                    4256,
                    "Folders will open in a new window unless a folder is picked from within the application (e.g. via the File menu)."
                ))],
                "default": "default",
                "scope": ConfigurationScope.APPLICATION,
                "markdownDescription": ( localize(
                    4257,
                    "Controls whether folders should open in a new window or replace the last active window.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option)."
                ))
            },
            "window.confirmBeforeClose": {
                "type": "string",
                "enum": ["always", "keyboardOnly", "never"],
                "enumDescriptions": [isWeb ? ( localize(
                    4258,
                    "Always try to ask for confirmation. Note that browsers may still decide to close a tab or window without confirmation."
                )) : ( localize(4259, "Always ask for confirmation.")), isWeb ? ( localize(
                    4260,
                    "Only ask for confirmation if a keybinding was used to close the window. Note that detection may not be possible in some cases."
                )) : ( localize(4261, "Only ask for confirmation if a keybinding was used.")), isWeb ? ( localize(
                    4262,
                    "Never explicitly ask for confirmation unless data loss is imminent."
                )) : ( localize(4263, "Never explicitly ask for confirmation."))],
                "default": (isWeb && !isStandalone()) ? "keyboardOnly" : "never",
                "markdownDescription": isWeb ? ( localize(
                    4264,
                    "Controls whether to show a confirmation dialog before closing the browser tab or window. Note that even if enabled, browsers may still decide to close a tab or window without confirmation and that this setting is only a hint that may not work in all cases."
                )) : ( localize(
                    4265,
                    "Controls whether to show a confirmation dialog before closing a window or quitting the application."
                )),
                "scope": ConfigurationScope.APPLICATION
            }
        }
    });
    registerWorkbenchContribution2(
        DynamicWindowConfiguration.ID,
        DynamicWindowConfiguration,
        WorkbenchPhase.Eventually
    );
    registry.registerConfiguration({
        ...problemsConfigurationNodeBase,
        "properties": {
            "problems.visibility": {
                "type": "boolean",
                "default": true,
                "description": ( localize(
                    4266,
                    "Controls whether the problems are visible throughout the editor and workbench."
                ))
            }
        }
    });
})();
( Registry.as(Extensions$1.ConfigurationMigration)).registerConfigurationMigrations([{
    key: "workbench.activityBar.visible",
    migrateFn: value => {
        const result = [];
        if (value !== undefined) {
            result.push(["workbench.activityBar.visible", {
                value: undefined
            }]);
        }
        if (value === false) {
            result.push([LayoutSettings.ACTIVITY_BAR_LOCATION, {
                value: ActivityBarPosition.HIDDEN
            }]);
        }
        return result;
    }
}]);
( Registry.as(Extensions$1.ConfigurationMigration)).registerConfigurationMigrations([{
    key: LayoutSettings.ACTIVITY_BAR_LOCATION,
    migrateFn: value => {
        const results = [];
        if (value === "side") {
            results.push([LayoutSettings.ACTIVITY_BAR_LOCATION, {
                value: ActivityBarPosition.DEFAULT
            }]);
        }
        return results;
    }
}]);
( Registry.as(Extensions$1.ConfigurationMigration)).registerConfigurationMigrations([{
    key: "workbench.editor.doubleClickTabToToggleEditorGroupSizes",
    migrateFn: value => {
        const results = [];
        if (typeof value === "boolean") {
            value = value ? "expand" : "off";
            results.push(["workbench.editor.doubleClickTabToToggleEditorGroupSizes", {
                value
            }]);
        }
        return results;
    }
}, {
    key: LayoutSettings.EDITOR_TABS_MODE,
    migrateFn: value => {
        const results = [];
        if (typeof value === "boolean") {
            value = value ? EditorTabsMode.MULTIPLE : EditorTabsMode.SINGLE;
            results.push([LayoutSettings.EDITOR_TABS_MODE, {
                value
            }]);
        }
        return results;
    }
}, {
    key: "workbench.editor.tabCloseButton",
    migrateFn: value => {
        const result = [];
        if (value === "left" || value === "right") {
            result.push(["workbench.editor.tabActionLocation", {
                value
            }]);
        } else if (value === "off") {
            result.push(["workbench.editor.tabActionCloseVisibility", {
                value: false
            }]);
        }
        return result;
    }
}, {
    key: "zenMode.hideTabs",
    migrateFn: value => {
        const result = [["zenMode.hideTabs", {
            value: undefined
        }]];
        if (value === true) {
            result.push(["zenMode.showTabs", {
                value: "single"
            }]);
        }
        return result;
    }
}]);
( Registry.as(Extensions$1.ConfigurationMigration)).registerConfigurationMigrations([{
    key: "workbench.experimental.floatingPanels",
    migrateFn: (value, valueAccessor) => {
        const result = [["workbench.experimental.floatingPanels", {
            value: undefined
        }]];
        if (value === true && valueAccessor(LayoutSettings.MODERN_UI) === undefined) {
            result.push([LayoutSettings.MODERN_UI, {
                value: true
            }]);
        }
        return result;
    }
}, {
    key: "workbench.experimental.styleOverrides",
    migrateFn: (value, valueAccessor) => {
        const result = [["workbench.experimental.styleOverrides", {
            value: undefined
        }]];
        if (Array.isArray(value) && value.length > 0 && valueAccessor(LayoutSettings.MODERN_UI) === undefined) {
            result.push([LayoutSettings.MODERN_UI, {
                value: true
            }]);
        }
        return result;
    }
}]);
