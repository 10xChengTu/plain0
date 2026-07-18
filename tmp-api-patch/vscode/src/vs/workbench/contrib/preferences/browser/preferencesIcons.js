
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const settingsScopeDropDownIcon = registerIcon("settings-folder-dropdown", Codicon.chevronDown, ( localize(
    13114,
    "Icon for the folder dropdown button in the split JSON Settings editor."
)));
const settingsMoreActionIcon = registerIcon("settings-more-action", Codicon.gear, ( localize(13115, "Icon for the 'more actions' action in the Settings UI.")));
const keybindingsRecordKeysIcon = registerIcon("keybindings-record-keys", Codicon.recordKeys, ( localize(13116, "Icon for the 'record keys' action in the keybinding UI.")));
const keybindingsSortIcon = registerIcon("keybindings-sort", Codicon.sortPrecedence, ( localize(13117, "Icon for the 'sort by precedence' toggle in the keybinding UI.")));
const keybindingsEditIcon = registerIcon("keybindings-edit", Codicon.edit, ( localize(13118, "Icon for the edit action in the keybinding UI.")));
const keybindingsAddIcon = registerIcon("keybindings-add", Codicon.add, ( localize(13119, "Icon for the add action in the keybinding UI.")));
const settingsEditIcon = registerIcon("settings-edit", Codicon.edit, ( localize(13120, "Icon for the edit action in the Settings UI.")));
const settingsRemoveIcon = registerIcon("settings-remove", Codicon.close, ( localize(13121, "Icon for the remove action in the Settings UI.")));
const settingsDiscardIcon = registerIcon("settings-discard", Codicon.discard, ( localize(13122, "Icon for the discard action in the Settings UI.")));
const preferencesClearInputIcon = registerIcon("preferences-clear-input", Codicon.clearAll, ( localize(13123, "Icon for clear input in the Settings and keybinding UI.")));
const preferencesAiResultsIcon = registerIcon("preferences-ai-results", Codicon.sparkle, ( localize(13124, "Icon for showing AI results in the Settings UI.")));
const preferencesFilterIcon = registerIcon("preferences-filter", Codicon.filter, ( localize(13125, "Icon for the button that suggests filters for the Settings UI.")));
const preferencesOpenSettingsIcon = registerIcon("preferences-open-settings", Codicon.goToFile, ( localize(13126, "Icon for open settings commands.")));

export { keybindingsAddIcon, keybindingsEditIcon, keybindingsRecordKeysIcon, keybindingsSortIcon, preferencesAiResultsIcon, preferencesClearInputIcon, preferencesFilterIcon, preferencesOpenSettingsIcon, settingsDiscardIcon, settingsEditIcon, settingsMoreActionIcon, settingsRemoveIcon, settingsScopeDropDownIcon };
