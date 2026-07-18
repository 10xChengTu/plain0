import { Event } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import { IActiveCodeEditor, ICodeEditor } from "../../../../editor/browser/editorBrowser.js";
import { IInlineChatSession } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/inlineChat/browser/inlineChatSessionService";
export declare const IInlineChatSessionService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IInlineChatSessionService>;
export interface IInlineChatSessionService {
    _serviceBrand: undefined;
    readonly onWillStartSession: Event<IActiveCodeEditor>;
    readonly onDidChangeSessions: Event<this>;
    createSession(editor: ICodeEditor): IInlineChatSession;
    getSessionByTextModel(uri: URI): IInlineChatSession | undefined;
    getSessionBySessionUri(uri: URI): IInlineChatSession | undefined;
}
