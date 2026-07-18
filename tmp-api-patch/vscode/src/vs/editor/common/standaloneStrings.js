
import { localize } from '../../nls.js';

var AccessibilityHelpNLS;
(function(AccessibilityHelpNLS) {
    AccessibilityHelpNLS.accessibilityHelpTitle = ( localize(895, "Accessibility Help"));
    AccessibilityHelpNLS.openingDocs = ( localize(896, "Opening the Accessibility documentation page."));
    AccessibilityHelpNLS.readonlyDiffEditor = ( localize(897, "You are in a read-only pane of a diff editor."));
    AccessibilityHelpNLS.editableDiffEditor = ( localize(898, "You are in a pane of a diff editor."));
    AccessibilityHelpNLS.readonlyEditor = ( localize(899, "You are in a read-only code editor."));
    AccessibilityHelpNLS.editableEditor = ( localize(900, "You are in a code editor."));
    AccessibilityHelpNLS.defaultWindowTitleIncludesEditorState = ( localize(
        901,
        "activeEditorState - such as modified, problems, and more, is included as a part of the window.title setting by default. Disable it with accessibility.windowTitleOptimized."
    ));
    AccessibilityHelpNLS.defaultWindowTitleExcludingEditorState = ( localize(
        902,
        "activeEditorState - such as modified, problems, and more, is currently not included as a part of the window.title setting by default. Enable it with accessibility.windowTitleOptimized."
    ));
    AccessibilityHelpNLS.toolbar = ( localize(
        903,
        "Around the workbench, when the screen reader announces you've landed in a toolbar, use narrow keys to navigate between the toolbar's actions."
    ));
    AccessibilityHelpNLS.changeConfigToOnMac = ( localize(
        904,
        "Configure the application to be optimized for usage with a Screen Reader (Command+E)."
    ));
    AccessibilityHelpNLS.changeConfigToOnWinLinux = ( localize(
        905,
        "Configure the application to be optimized for usage with a Screen Reader (Control+E)."
    ));
    AccessibilityHelpNLS.auto_on = ( localize(
        906,
        "The application is configured to be optimized for usage with a Screen Reader."
    ));
    AccessibilityHelpNLS.auto_off = ( localize(
        907,
        "The application is configured to never be optimized for usage with a Screen Reader."
    ));
    AccessibilityHelpNLS.screenReaderModeEnabled = ( localize(908, "Screen Reader Optimized Mode enabled."));
    AccessibilityHelpNLS.screenReaderModeDisabled = ( localize(909, "Screen Reader Optimized Mode disabled."));
    AccessibilityHelpNLS.tabFocusModeOnMsg = ( localize(
        910,
        "Pressing Tab in the current editor will move focus to the next focusable element. Toggle this behavior{0}.",
        "<keybinding:editor.action.toggleTabFocusMode>"
    ));
    AccessibilityHelpNLS.tabFocusModeOffMsg = ( localize(
        911,
        "Pressing Tab in the current editor will insert the tab character. Toggle this behavior{0}.",
        "<keybinding:editor.action.toggleTabFocusMode>"
    ));
    AccessibilityHelpNLS.stickScroll = ( localize(
        912,
        "Focus Sticky Scroll{0} to focus the currently nested scopes.",
        "<keybinding:editor.action.focusStickyDebugConsole>"
    ));
    AccessibilityHelpNLS.suggestActions = ( localize(
        913,
        "Trigger the suggest widget{0} to show possible inline suggestions.",
        "<keybinding:editor.action.triggerSuggest>"
    ));
    AccessibilityHelpNLS.acceptSuggestAction = ( localize(
        914,
        "Accept suggestion{0} to accept the currently selected suggestion.",
        "<keybinding:acceptSelectedSuggestion>"
    ));
    AccessibilityHelpNLS.toggleSuggestionFocus = ( localize(
        915,
        "Toggle focus between the suggest widget and the editor{0} and toggle details focus with{1} to learn more about the suggestion.",
        "<keybinding:focusSuggestion>",
        "<keybinding:toggleSuggestionFocus>"
    ));
    AccessibilityHelpNLS.codeFolding = ( localize(
        916,
        "Use code folding to collapse blocks of code and focus on the code you're interested in via the Toggle Folding Command{0}.",
        "<keybinding:editor.toggleFold>"
    ));
    AccessibilityHelpNLS.intellisense = ( localize(
        917,
        "Use Intellisense to improve coding efficiency and reduce errors. Trigger suggestions{0}.",
        "<keybinding:editor.action.triggerSuggest>"
    ));
    AccessibilityHelpNLS.showOrFocusHover = ( localize(
        918,
        "Show or focus the hover{0} to read information about the current symbol.",
        "<keybinding:editor.action.showHover>"
    ));
    AccessibilityHelpNLS.goToSymbol = ( localize(
        919,
        "Go to Symbol{0} to quickly navigate between symbols in the current file.",
        "<keybinding:workbench.action.gotoSymbol>"
    ));
    AccessibilityHelpNLS.showAccessibilityHelpAction = ( localize(920, "Show Accessibility Help"));
    AccessibilityHelpNLS.listSignalSounds = ( localize(
        921,
        "Run the command: List Signal Sounds for an overview of all sounds and their current status."
    ));
    AccessibilityHelpNLS.listAlerts = ( localize(
        922,
        "Run the command: List Signal Announcements for an overview of announcements and their current status."
    ));
    AccessibilityHelpNLS.announceCursorPosition = ( localize(
        923,
        "Run the command: Announce Cursor Position{0} to hear the current line and column.",
        "<keybinding:editor.action.announceCursorPosition>"
    ));
    AccessibilityHelpNLS.focusNotifications = ( localize(
        924,
        "Focus notification toasts{0} to navigate them with the keyboard. Accept the primary action of a focused notification{1}.",
        "<keybinding:notifications.focusToasts>",
        "<keybinding:notification.acceptPrimaryAction>"
    ));
    AccessibilityHelpNLS.quickChat = ( localize(
        925,
        "Toggle quick chat{0} to open or close a chat session.",
        "<keybinding:workbench.action.quickchat.toggle>"
    ));
    AccessibilityHelpNLS.startInlineChat = ( localize(
        926,
        "Start inline chat{0} to create an in editor chat session.",
        "<keybinding:inlineChat.start>"
    ));
    AccessibilityHelpNLS.startDebugging = ( localize(
        927,
        "The Debug: Start Debugging command{0} will start a debug session.",
        "<keybinding:workbench.action.debug.start>"
    ));
    AccessibilityHelpNLS.setBreakpoint = ( localize(
        928,
        "The Debug: Inline Breakpoint command{0} will set or unset a breakpoint at the current cursor position in the active editor.",
        "<keybinding:editor.debug.action.toggleInlineBreakpoint>"
    ));
    AccessibilityHelpNLS.addToWatch = ( localize(
        929,
        "The Debug: Add to Watch command{0} will add the selected text to the watch view.",
        "<keybinding:editor.debug.action.selectionToWatch>"
    ));
    AccessibilityHelpNLS.debugExecuteSelection = ( localize(
        930,
        "The Debug: Execute Selection command{0} will execute the selected text in the debug console.",
        "<keybinding:editor.debug.action.selectionToRepl>"
    ));
    AccessibilityHelpNLS.chatEditorModification = ( localize(
        931,
        "The editor contains pending modifications that have been made by chat."
    ));
    AccessibilityHelpNLS.chatEditorRequestInProgress = ( localize(
        932,
        "The editor is currently waiting for modifications to be made by chat."
    ));
    AccessibilityHelpNLS.chatEditActions = ( localize(
        933,
        "Navigate between edits in the editor with navigate previous{0} and next{1} and accept{2}, reject{3} or view the diff{4} for the current change. Accept edits across all files{5}.",
        "<keybinding:chatEditor.action.navigatePrevious>",
        "<keybinding:chatEditor.action.navigateNext>",
        "<keybinding:chatEditor.action.acceptHunk>",
        "<keybinding:chatEditor.action.undoHunk>",
        "<keybinding:chatEditor.action.toggleDiff>",
        "<keybinding:chatEditor.action.acceptAllEdits>"
    ));
})(AccessibilityHelpNLS || (AccessibilityHelpNLS = {}));
var InspectTokensNLS;
(function(InspectTokensNLS) {
    InspectTokensNLS.inspectTokensAction = ( localize(934, "Developer: Inspect Tokens"));
})(InspectTokensNLS || (InspectTokensNLS = {}));
var GoToLineNLS;
(function(GoToLineNLS) {
    GoToLineNLS.gotoLineActionLabel = ( localize(935, "Go to Line/Column..."));
    GoToLineNLS.gotoOffsetActionLabel = ( localize(936, "Go to Offset..."));
})(GoToLineNLS || (GoToLineNLS = {}));
var QuickHelpNLS;
(function(QuickHelpNLS) {
    QuickHelpNLS.helpQuickAccessActionLabel = ( localize(937, "Show all Quick Access Providers"));
})(QuickHelpNLS || (QuickHelpNLS = {}));
var QuickCommandNLS;
(function(QuickCommandNLS) {
    QuickCommandNLS.quickCommandActionLabel = ( localize(938, "Command Palette"));
    QuickCommandNLS.quickCommandHelp = ( localize(939, "Show And Run Commands"));
})(QuickCommandNLS || (QuickCommandNLS = {}));
var QuickOutlineNLS;
(function(QuickOutlineNLS) {
    QuickOutlineNLS.quickOutlineActionLabel = ( localize(940, "Go to Symbol..."));
    QuickOutlineNLS.quickOutlineByCategoryActionLabel = ( localize(941, "Go to Symbol by Category..."));
})(QuickOutlineNLS || (QuickOutlineNLS = {}));
var StandaloneCodeEditorNLS;
(function(StandaloneCodeEditorNLS) {
    StandaloneCodeEditorNLS.editorViewAccessibleLabel = ( localize(942, "Editor content"));
})(StandaloneCodeEditorNLS || (StandaloneCodeEditorNLS = {}));
var ToggleHighContrastNLS;
(function(ToggleHighContrastNLS) {
    ToggleHighContrastNLS.toggleHighContrast = ( localize(943, "Toggle High Contrast Theme"));
})(ToggleHighContrastNLS || (ToggleHighContrastNLS = {}));
var StandaloneServicesNLS;
(function(StandaloneServicesNLS) {
    StandaloneServicesNLS.bulkEditServiceSummary = ( localize(944, "Made {0} edits in {1} files"));
})(StandaloneServicesNLS || (StandaloneServicesNLS = {}));

export { AccessibilityHelpNLS, GoToLineNLS, InspectTokensNLS, QuickCommandNLS, QuickHelpNLS, QuickOutlineNLS, StandaloneCodeEditorNLS, StandaloneServicesNLS, ToggleHighContrastNLS };
