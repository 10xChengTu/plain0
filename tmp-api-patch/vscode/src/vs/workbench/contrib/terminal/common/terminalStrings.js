
import { localize2, localize } from '../../../../nls.js';

const terminalStrings = {
    terminal: ( localize(15173, "Terminal")),
    new: ( localize(15174, "New Terminal")),
    currentSessionCategory: ( localize(15175, "current session")),
    previousSessionCategory: ( localize(15176, "previous session")),
    typeTask: ( localize(15177, "Task")),
    typeLocal: ( localize(15178, "Local")),
    actionCategory: ( localize2(15179, "Terminal")),
    focus: ( localize2(15180, "Focus Terminal")),
    kill: {
        ...( localize2(15181, "Kill Terminal")),
        short: ( localize(15182, "Kill"))
    },
    moveToEditor: ( localize2(15183, "Move Terminal into Editor Area")),
    moveIntoNewWindow: ( localize2(15184, "Move Terminal into New Window")),
    newInNewWindow: ( localize2(15185, "New Terminal Window")),
    moveToTerminalPanel: ( localize2(15186, "Move Terminal into Panel")),
    changeIcon: ( localize2(15187, "Change Icon...")),
    changeColor: ( localize2(15188, "Change Color...")),
    split: {
        ...( localize2(15189, "Split Terminal")),
        short: ( localize(15190, "Split"))
    },
    unsplit: ( localize2(15191, "Unsplit Terminal")),
    rename: ( localize2(15192, "Rename...")),
    toggleSizeToContentWidth: ( localize2(15193, "Toggle Size to Content Width")),
    focusHover: ( localize2(15194, "Focus Hover")),
    newWithCwd: ( localize2(15195, "Create New Terminal Starting in a Custom Working Directory")),
    renameWithArgs: ( localize2(15196, "Rename the Currently Active Terminal")),
    scrollToPreviousCommand: ( localize2(15197, "Scroll to Previous Command")),
    scrollToNextCommand: ( localize2(15198, "Scroll to Next Command"))};

export { terminalStrings };
