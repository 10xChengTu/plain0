
import '../../../nls.js';

var BrowserViewCommandId;
(function(BrowserViewCommandId) {
    BrowserViewCommandId["Open"] = "workbench.action.browser.open";
    BrowserViewCommandId["OpenFile"] = "workbench.action.browser.openFile";
    BrowserViewCommandId["NewTab"] = "workbench.action.browser.newTab";
    BrowserViewCommandId["QuickOpen"] = "workbench.action.browser.quickOpen";
    BrowserViewCommandId["OpenOrList"] = "workbench.action.browser.openOrList";
    BrowserViewCommandId["CloseAll"] = "workbench.action.browser.closeAll";
    BrowserViewCommandId["CloseAllInGroup"] = "workbench.action.browser.closeAllInGroup";
    BrowserViewCommandId["GoBack"] = "workbench.action.browser.goBack";
    BrowserViewCommandId["GoForward"] = "workbench.action.browser.goForward";
    BrowserViewCommandId["Reload"] = "workbench.action.browser.reload";
    BrowserViewCommandId["HardReload"] = "workbench.action.browser.hardReload";
    BrowserViewCommandId["FocusUrlInput"] = "workbench.action.browser.focusUrlInput";
    BrowserViewCommandId["OpenExternal"] = "workbench.action.browser.openExternal";
    BrowserViewCommandId["OpenSettings"] = "workbench.action.browser.openSettings";
    BrowserViewCommandId["ToggleFavorite"] = "workbench.action.browser.toggleFavorite";
    BrowserViewCommandId["ShowHistory"] = "workbench.action.browser.showHistory";
    BrowserViewCommandId["ManagePermissions"] = "workbench.action.browser.managePermissions";
    BrowserViewCommandId["AddElementToChat"] = "workbench.action.browser.addElementToChat";
    BrowserViewCommandId["AddConsoleLogsToChat"] = "workbench.action.browser.addConsoleLogsToChat";
    BrowserViewCommandId["AddScreenshotToChat"] = "workbench.action.browser.addScreenshotToChat";
    BrowserViewCommandId["AddAreaScreenshotToChat"] = "workbench.action.browser.addAreaScreenshotToChat";
    BrowserViewCommandId["AddFullPageScreenshotToChat"] = "workbench.action.browser.addFullPageScreenshotToChat";
    BrowserViewCommandId["ToggleDevTools"] = "workbench.action.browser.toggleDevTools";
    BrowserViewCommandId["ClearGlobalStorage"] = "workbench.action.browser.clearGlobalStorage";
    BrowserViewCommandId["ClearWorkspaceStorage"] = "workbench.action.browser.clearWorkspaceStorage";
    BrowserViewCommandId["ClearEphemeralStorage"] = "workbench.action.browser.clearEphemeralStorage";
    BrowserViewCommandId["ShowFind"] = "workbench.action.browser.showFind";
    BrowserViewCommandId["HideFind"] = "workbench.action.browser.hideFind";
    BrowserViewCommandId["FindNext"] = "workbench.action.browser.findNext";
    BrowserViewCommandId["FindPrevious"] = "workbench.action.browser.findPrevious";
})(BrowserViewCommandId || (BrowserViewCommandId = {}));
var BrowserViewStorageScope;
(function(BrowserViewStorageScope) {
    BrowserViewStorageScope["Global"] = "global";
    BrowserViewStorageScope["Workspace"] = "workspace";
    BrowserViewStorageScope["Ephemeral"] = "ephemeral";
})(BrowserViewStorageScope || (BrowserViewStorageScope = {}));
const browserZoomFactors = [
    0.25,
    1 / 3,
    0.5,
    2 / 3,
    0.75,
    0.8,
    0.9,
    1,
    1.1,
    1.25,
    1.5,
    1.75,
    2,
    2.5,
    3,
    4,
    5
];
const browserZoomDefaultIndex = browserZoomFactors.indexOf(1);

export { BrowserViewCommandId, BrowserViewStorageScope, browserZoomDefaultIndex, browserZoomFactors };
