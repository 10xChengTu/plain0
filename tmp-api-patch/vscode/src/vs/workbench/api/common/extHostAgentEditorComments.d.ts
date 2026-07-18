import type * as vscode from "vscode";
import { ExtHostAgentEditorCommentsShape, IAgentEditorCommentDto, IMainContext } from "./extHost.protocol.js";
export declare class ExtHostAgentEditorComments implements ExtHostAgentEditorCommentsShape {
    private static handlePool;
    private readonly proxy;
    private readonly providers;
    constructor(mainContext: IMainContext);
    createAgentEditorComments(uri: vscode.Uri): vscode.AgentEditorCommentsProvider;
    $acceptAgentEditorComments(handle: number, comments: IAgentEditorCommentDto[]): void;
}
