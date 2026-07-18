import { IOutputPartState } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatOutputPartStateCache";
export declare const IChatOutputPartStateCache: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatOutputPartStateCache>;
export interface IChatOutputPartStateCache {
    readonly _serviceBrand: undefined;
    get(key: string): IOutputPartState | undefined;
    set(key: string, state: IOutputPartState): void;
}
