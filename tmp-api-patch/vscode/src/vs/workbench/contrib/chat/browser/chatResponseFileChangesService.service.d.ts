import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../base/common/observable.js";
import { URI } from "../../../../base/common/uri.js";
import { IEditSessionEntryDiff } from "../common/editing/chatEditingService.js";
import { IChatResponseFileChangesProvider } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/chatResponseFileChangesService";
export declare const IChatResponseFileChangesService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatResponseFileChangesService>;
export interface IChatResponseFileChangesService {
    readonly _serviceBrand: undefined;
    /**
    * Registers a provider for a chat session type (as returned by
    * {@link getChatSessionType}). At most one provider may be registered per
    * session type.
    */
    registerProvider(chatSessionType: string, provider: IChatResponseFileChangesProvider): IDisposable;
    /**
    * Returns the per-request change diffs for `sessionResource` from the
    * provider registered for its session type, or `undefined` when there is
    * no provider or the provider cannot supply changes for this request.
    */
    getChangesForRequest(sessionResource: URI, requestId: string): IObservable<readonly IEditSessionEntryDiff[]> | undefined;
}
