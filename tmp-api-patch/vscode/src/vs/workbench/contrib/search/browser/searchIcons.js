
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const searchDetailsIcon = registerIcon("search-details", Codicon.ellipsis, ( localize(14037, "Icon to make search details visible.")));
const searchActivityBarIcon = registerIcon("search-see-more", Codicon.goToSearch, ( localize(14038, "Icon to view more context in the search view.")));
const searchShowContextIcon = registerIcon("search-show-context", Codicon.listSelection, ( localize(14039, "Icon for toggle the context in the search editor.")));
const searchHideReplaceIcon = registerIcon("search-hide-replace", Codicon.chevronRight, ( localize(14040, "Icon to collapse the replace section in the search view.")));
const searchShowReplaceIcon = registerIcon("search-show-replace", Codicon.chevronDown, ( localize(14041, "Icon to expand the replace section in the search view.")));
const searchReplaceAllIcon = registerIcon("search-replace-all", Codicon.replaceAll, ( localize(14042, "Icon for replace all in the search view.")));
const searchReplaceIcon = registerIcon("search-replace", Codicon.replace, ( localize(14043, "Icon for replace in the search view.")));
const searchRemoveIcon = registerIcon("search-remove", Codicon.close, ( localize(14044, "Icon to remove a search result.")));
const searchRefreshIcon = registerIcon("search-refresh", Codicon.refresh, ( localize(14045, "Icon for refresh in the search view.")));
const searchCollapseAllIcon = registerIcon("search-collapse-results", Codicon.collapseAll, ( localize(14046, "Icon for collapse results in the search view.")));
const searchExpandAllIcon = registerIcon("search-expand-results", Codicon.expandAll, ( localize(14047, "Icon for expand results in the search view.")));
const searchShowAsTree = registerIcon("search-tree", Codicon.listTree, ( localize(14048, "Icon for viewing results as a tree in the search view.")));
const searchShowAsList = registerIcon("search-list", Codicon.listFlat, ( localize(14049, "Icon for viewing results as a list in the search view.")));
const searchClearIcon = registerIcon("search-clear-results", Codicon.clearAll, ( localize(14050, "Icon for clear results in the search view.")));
const searchStopIcon = registerIcon("search-stop", Codicon.searchStop, ( localize(14051, "Icon for stop in the search view.")));
const searchViewIcon = registerIcon("search-view-icon", Codicon.searchLarge, ( localize(14052, "View icon of the search view.")));
const searchNewEditorIcon = registerIcon("search-new-editor", Codicon.newFile, ( localize(14053, "Icon for the action to open a new search editor.")));
const searchOpenInFileIcon = registerIcon("search-open-in-file", Codicon.goToFile, ( localize(
    14054,
    "Icon for the action to go to the file of the current search result."
)));
registerIcon("search-sparkle-filled", Codicon.sparkleFilled, ( localize(14055, "Icon to show AI results in search.")));
registerIcon("search-sparkle-empty", Codicon.sparkle, ( localize(14056, "Icon to hide AI results in search.")));

export { searchActivityBarIcon, searchClearIcon, searchCollapseAllIcon, searchDetailsIcon, searchExpandAllIcon, searchHideReplaceIcon, searchNewEditorIcon, searchOpenInFileIcon, searchRefreshIcon, searchRemoveIcon, searchReplaceAllIcon, searchReplaceIcon, searchShowAsList, searchShowAsTree, searchShowContextIcon, searchShowReplaceIcon, searchStopIcon, searchViewIcon };
