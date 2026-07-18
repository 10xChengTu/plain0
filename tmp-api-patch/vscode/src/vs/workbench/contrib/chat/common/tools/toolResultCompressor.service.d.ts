import { IToolResult } from "./languageModelToolsService.js";
import { IToolResultFilter, IToolResultCache } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/tools/toolResultCompressor";
export declare const IToolResultCompressor: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IToolResultCompressor>;
export interface IToolResultCompressor {
    readonly _serviceBrand: undefined;
    registerFilter(filter: IToolResultFilter): void;
    registerCache(cache: IToolResultCache): void;
    /**
    * Returns a possibly-compressed copy of `result`, or `undefined` if no
    * compression was applied (caller should pass through the original).
    */
    maybeCompress(toolId: string, input: unknown, result: IToolResult): IToolResult | undefined;
}
