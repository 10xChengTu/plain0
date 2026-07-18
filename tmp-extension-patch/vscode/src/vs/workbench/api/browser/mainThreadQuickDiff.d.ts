import { UriComponents } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { IDocumentFilterDto, MainThreadQuickDiffShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
import { IQuickDiffService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/quickDiff.service";
import { IQuickDiffModelService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/browser/quickDiffModel.service";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
export declare class MainThreadQuickDiff implements MainThreadQuickDiffShape {
    private readonly quickDiffService;
    private readonly quickDiffModelService;
    private readonly proxy;
    private providerDisposables;
    private informationDisposables;
    constructor(extHostContext: IExtHostContext, quickDiffService: IQuickDiffService, quickDiffModelService: IQuickDiffModelService);
    $registerQuickDiffProvider(handle: number, selector: IDocumentFilterDto[], id: string, label: string, rootUri: UriComponents | undefined): Promise<void>;
    $unregisterQuickDiffProvider(handle: number): Promise<void>;
    $createSourceControlDiffInformation(handle: number, uri: UriComponents): Promise<void>;
    $disposeSourceControlDiffInformation(handle: number): Promise<void>;
    private sendSourceControlDiffInformation;
    dispose(): void;
}
