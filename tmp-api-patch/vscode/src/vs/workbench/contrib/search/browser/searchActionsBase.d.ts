import * as nls from "../../../../nls.js";
import { WorkbenchCompressibleAsyncDataTree } from "../../../../platform/list/browser/listService.js";
import { IViewsService } from "../../../services/views/common/viewsService.service.js";
import { SearchView } from "./searchView.js";
import { ISearchConfigurationProperties } from "../../../services/search/common/search.js";
import { RenderableMatch, ISearchResult } from "./searchTreeModel/searchTreeCommon.js";
import { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
export declare const category: nls.ILocalizedString;
export declare function isSearchViewFocused(viewsService: IViewsService): boolean;
export declare function getSearchView(viewsService: IViewsService): SearchView | undefined;
export declare function getElementsToOperateOn(viewer: WorkbenchCompressibleAsyncDataTree<ISearchResult, RenderableMatch, void>, currElement: RenderableMatch | undefined, sortConfig: ISearchConfigurationProperties | undefined): RenderableMatch[];
/**
 * @param elements elements that are going to be removed
 * @param focusElement element that is focused
 * @returns whether we need to re-focus on a remove
 */
export declare function shouldRefocus(elements: RenderableMatch[], focusElement: RenderableMatch | undefined): boolean;
export interface IFindInFilesArgs {
    query?: string;
    replace?: string;
    preserveCase?: boolean;
    triggerSearch?: boolean;
    filesToInclude?: string;
    filesToExclude?: string;
    isRegex?: boolean;
    isCaseSensitive?: boolean;
    matchWholeWord?: boolean;
    useExcludeSettingsAndIgnoreFiles?: boolean;
    onlyOpenEditors?: boolean;
    showIncludesExcludes?: boolean;
}
export declare function openSearchView(viewsService: IViewsService, focus?: boolean): Promise<SearchView | undefined>;
export declare function findInFilesCommand(accessor: ServicesAccessor, _args?: IFindInFilesArgs): Promise<void>;
