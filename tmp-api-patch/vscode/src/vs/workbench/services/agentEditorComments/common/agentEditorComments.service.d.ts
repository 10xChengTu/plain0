import { Event } from "../../../../base/common/event.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { URI } from "../../../../base/common/uri.js";
import { IRange } from "../../../../editor/common/core/range.js";
import { IAgentEditorComment, IAgentEditorCommentsProvider } from "@codingame/monaco-vscode-comments-service-override/vscode/vs/workbench/services/agentEditorComments/common/agentEditorComments";
export declare const IAgentEditorCommentsBridge: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentEditorCommentsBridge>;
/**
* Workbench-layer seam that lets the (globally registered) main-thread
* extension host customer read and contribute session editor comments without
* depending on the sessions layer directly. When no provider is registered
* (e.g. the regular workbench window) the bridge is a no-op, so the customer
* degrades gracefully.
*/
export interface IAgentEditorCommentsBridge {
    readonly _serviceBrand: undefined;
    /** Fired when comments change, or when a provider is registered/unregistered. */
    readonly onDidChangeComments: Event<void>;
    getComments(resource: URI): readonly IAgentEditorComment[];
    addComment(resource: URI, range: IRange, body: string): void;
    /** Install the provider that backs this bridge. Only one provider is active at a time. */
    registerProvider(provider: IAgentEditorCommentsProvider): IDisposable;
}
