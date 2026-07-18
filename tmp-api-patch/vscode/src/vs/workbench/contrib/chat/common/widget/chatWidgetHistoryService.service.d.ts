import { Event } from "../../../../../base/common/event.js";
import { ChatAgentLocation } from "../constants.js";
import { IChatModelInputState } from "../model/chatModel.js";
import { ChatHistoryChange } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/common/widget/chatWidgetHistoryService";
export declare const IChatWidgetHistoryService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatWidgetHistoryService>;
export interface IChatWidgetHistoryService {
    _serviceBrand: undefined;
    readonly onDidChangeHistory: Event<ChatHistoryChange>;
    clearHistory(): void;
    getHistory(location: ChatAgentLocation, historyKey?: string): readonly IChatModelInputState[];
    append(location: ChatAgentLocation, history: IChatModelInputState, historyKey?: string): void;
    moveHistory(location: ChatAgentLocation, fromHistoryKey: string, toHistoryKey: string): void;
}
