import { URI } from "../../../../../base/common/uri.js";
import { ToolAndToolSetEnablementMap } from "../tools/languageModelToolsService.js";
import { IDynamicVariable } from "./chatVariables.js";
export declare const IChatVariablesService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatVariablesService>;
export interface IChatVariablesService {
    _serviceBrand: undefined;
    getDynamicVariables(sessionResource: URI): ReadonlyArray<IDynamicVariable>;
    getSelectedToolAndToolSets(sessionResource: URI): ToolAndToolSetEnablementMap;
}
