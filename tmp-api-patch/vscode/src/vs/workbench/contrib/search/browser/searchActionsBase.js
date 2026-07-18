
import { isAncestorOfActiveElement } from '../../../../base/browser/dom.js';
import { localize2 } from '../../../../nls.js';
import { OpenEditorCommandId } from '../../searchEditor/browser/constants.js';
import { IViewsService } from '../../../services/views/common/viewsService.service.js';
import { VIEW_ID } from '../../../services/search/common/search.js';
import { isSearchTreeFileMatch, isSearchTreeMatch, isSearchTreeFolderMatch } from './searchTreeModel/searchTreeCommon.js';
import { searchComparer } from './searchCompare.js';
import { ICommandService } from '../../../../platform/commands/common/commands.service.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.service.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.service.js';
import { IConfigurationResolverService } from '../../../services/configurationResolver/common/configurationResolver.service.js';
import { IHistoryService } from '../../../services/history/common/history.service.js';
import { Schemas } from '../../../../base/common/network.js';

const category = ( localize2(13982, "Search"));
function isSearchViewFocused(viewsService) {
    const searchView = getSearchView(viewsService);
    return !!(searchView && isAncestorOfActiveElement(searchView.getContainer()));
}
function getSearchView(viewsService) {
    return viewsService.getActiveViewWithId(VIEW_ID);
}
function getElementsToOperateOn(viewer, currElement, sortConfig) {
    let elements = viewer.getSelection().filter(x => x !== null).sort((a, b) => searchComparer(a, b, sortConfig?.sortOrder));
    if (currElement && !(elements.length > 1 && elements.includes(currElement))) {
        elements = [currElement];
    }
    return elements;
}
function shouldRefocus(elements, focusElement) {
    if (!focusElement) {
        return false;
    }
    return !focusElement || elements.includes(focusElement) || hasDownstreamMatch(elements, focusElement);
}
function hasDownstreamMatch(elements, focusElement) {
    for (const elem of elements) {
        if ((isSearchTreeFileMatch(elem) && isSearchTreeMatch(focusElement) && elem.matches().includes(focusElement)) || (isSearchTreeFolderMatch(elem) && ((isSearchTreeFileMatch(focusElement) && elem.getDownstreamFileMatch(focusElement.resource)) || (isSearchTreeMatch(focusElement) && elem.getDownstreamFileMatch(focusElement.parent().resource))))) {
            return true;
        }
    }
    return false;
}
function openSearchView(viewsService, focus) {
    return viewsService.openView(VIEW_ID, focus).then(view => (view ?? undefined));
}
async function findInFilesCommand(accessor, _args = {}) {
    const searchConfig = accessor.get(IConfigurationService).getValue().search;
    const viewsService = accessor.get(IViewsService);
    const commandService = accessor.get(ICommandService);
    const args = {};
    if (( Object.keys(_args)).length !== 0) {
        const configurationResolverService = accessor.get(IConfigurationResolverService);
        const historyService = accessor.get(IHistoryService);
        const workspaceContextService = accessor.get(IWorkspaceContextService);
        const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot();
        const filteredActiveWorkspaceRootUri = activeWorkspaceRootUri?.scheme === Schemas.file || activeWorkspaceRootUri?.scheme === Schemas.vscodeRemote ? activeWorkspaceRootUri : undefined;
        const lastActiveWorkspaceRoot = filteredActiveWorkspaceRootUri ? workspaceContextService.getWorkspaceFolder(filteredActiveWorkspaceRootUri) ?? undefined : undefined;
        for (const entry of Object.entries(_args)) {
            const name = entry[0];
            const value = entry[1];
            if (value !== undefined) {
                args[name] = (typeof value === "string") ? await configurationResolverService.resolveAsync(lastActiveWorkspaceRoot, value) : value;
            }
        }
    }
    const mode = searchConfig?.mode;
    if (mode === "view") {
        openSearchView(viewsService, false).then(openedView => {
            if (openedView) {
                const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
                searchAndReplaceWidget.toggleReplace(typeof args.replace === "string");
                let updatedText = false;
                if (typeof args.query !== "string") {
                    updatedText = openedView.updateTextFromFindWidgetOrSelection({
                        allowUnselectedWord: typeof args.replace !== "string"
                    });
                }
                openedView.setSearchParameters(args);
                if (typeof args.showIncludesExcludes === "boolean") {
                    openedView.toggleQueryDetails(false, args.showIncludesExcludes);
                }
                openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
            }
        });
    } else {
        const convertArgs = args => ({
            location: mode === "newEditor" ? "new" : "reuse",
            query: args.query,
            filesToInclude: args.filesToInclude,
            filesToExclude: args.filesToExclude,
            matchWholeWord: args.matchWholeWord,
            isCaseSensitive: args.isCaseSensitive,
            isRegexp: args.isRegex,
            useExcludeSettingsAndIgnoreFiles: args.useExcludeSettingsAndIgnoreFiles,
            onlyOpenEditors: args.onlyOpenEditors,
            showIncludesExcludes: !!(args.filesToExclude || args.filesToExclude || !args.useExcludeSettingsAndIgnoreFiles)
        });
        commandService.executeCommand(OpenEditorCommandId, convertArgs(args));
    }
}

export { category, findInFilesCommand, getElementsToOperateOn, getSearchView, isSearchViewFocused, openSearchView, shouldRefocus };
