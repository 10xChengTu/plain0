
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const terminalViewIcon = registerIcon("terminal-view-icon", Codicon.terminal, ( localize(14819, "View icon of the terminal view.")));
const renameTerminalIcon = registerIcon("terminal-rename", Codicon.edit, ( localize(14820, "Icon for rename in the terminal quick menu.")));
const killTerminalIcon = registerIcon("terminal-kill", Codicon.trash, ( localize(14821, "Icon for killing a terminal instance.")));
const newTerminalIcon = registerIcon("terminal-new", Codicon.add, ( localize(14822, "Icon for creating a new terminal instance.")));
const configureTerminalProfileIcon = registerIcon("terminal-configure-profile", Codicon.gear, ( localize(14823, "Icon for creating a new terminal profile.")));
const terminalDecorationMark = registerIcon("terminal-decoration-mark", Codicon.circleSmallFilled, ( localize(14824, "Icon for a terminal decoration mark.")));
const terminalDecorationIncomplete = registerIcon("terminal-decoration-incomplete", Codicon.circle, ( localize(14825, "Icon for a terminal decoration of a command that was incomplete.")));
const terminalDecorationError = registerIcon("terminal-decoration-error", Codicon.errorSmall, ( localize(14826, "Icon for a terminal decoration of a command that errored.")));
const terminalDecorationSuccess = registerIcon("terminal-decoration-success", Codicon.circleFilled, ( localize(14827, "Icon for a terminal decoration of a command that was successful.")));
const commandHistoryRemoveIcon = registerIcon("terminal-command-history-remove", Codicon.close, ( localize(14828, "Icon for removing a terminal command from command history.")));
const commandHistoryOutputIcon = registerIcon("terminal-command-history-output", Codicon.output, ( localize(14829, "Icon for viewing output of a terminal command.")));
const commandHistoryFuzzySearchIcon = registerIcon(
    "terminal-command-history-fuzzy-search",
    Codicon.searchFuzzy,
    ( localize(14830, "Icon for toggling fuzzy search of command history."))
);
const commandHistoryOpenFileIcon = registerIcon(
    "terminal-command-history-open-file",
    Codicon.symbolReference,
    ( localize(14831, "Icon for opening a shell history file."))
);

export { commandHistoryFuzzySearchIcon, commandHistoryOpenFileIcon, commandHistoryOutputIcon, commandHistoryRemoveIcon, configureTerminalProfileIcon, killTerminalIcon, newTerminalIcon, renameTerminalIcon, terminalDecorationError, terminalDecorationIncomplete, terminalDecorationMark, terminalDecorationSuccess, terminalViewIcon };
