import { UriComponents } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { IEditorWorkerService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/editorWorker.service";
import { IDocumentDiffResultDto, MainThreadDocumentDiffShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
export declare class MainThreadDocumentDiff implements MainThreadDocumentDiffShape {
    private readonly _editorWorkerService;
    constructor(_extHostContext: IExtHostContext, _editorWorkerService: IEditorWorkerService);
    $computeDocumentDiff(originalUri: UriComponents, modifiedUri: UriComponents, ignoreTrimWhitespace: boolean, maxComputationTimeMs: number, computeMoves: boolean): Promise<IDocumentDiffResultDto | null>;
    dispose(): void;
}
