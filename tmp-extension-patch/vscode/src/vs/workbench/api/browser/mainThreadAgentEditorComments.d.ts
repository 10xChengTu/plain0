import { UriComponents } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { IRange } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/core/range";
import { IAgentEditorCommentsBridge } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/agentEditorComments/common/agentEditorComments.service";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
import { MainThreadAgentEditorCommentsShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
/**
 * Bridges the {@link IAgentEditorCommentsBridge} (backed, in the Agents window,
 * by the same store the code editor renders its session comments from) to the
 * extension host, so custom editors (e.g. the Markdown editor) can render and
 * contribute the same comments. Registered in every extension host; when no
 * provider is installed (e.g. the regular workbench window) the bridge is a
 * no-op and this customer simply reports no comments.
 */
export declare class MainThreadAgentEditorComments implements MainThreadAgentEditorCommentsShape {
    private readonly _bridge;
    private readonly _proxy;
    private readonly _resources;
    private readonly _disposables;
    constructor(extHostContext: IExtHostContext, _bridge: IAgentEditorCommentsBridge);
    $createAgentEditorComments(handle: number, uri: UriComponents): Promise<void>;
    $addComment(handle: number, range: IRange, body: string): Promise<void>;
    $disposeAgentEditorComments(handle: number): Promise<void>;
    private _sendComments;
    dispose(): void;
}
