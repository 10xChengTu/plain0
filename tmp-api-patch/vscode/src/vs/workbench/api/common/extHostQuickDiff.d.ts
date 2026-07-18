import type * as vscode from "vscode";
import { CancellationToken } from "../../../base/common/cancellation.js";
import { UriComponents } from "../../../base/common/uri.js";
import { ExtHostQuickDiffShape, IMainContext, ITextEditorDiffInformation } from "./extHost.protocol.js";
import { ExtHostDocuments } from "./extHostDocuments.js";
import { IURITransformer } from "../../../base/common/uriIpc.js";
import { IExtensionDescription } from "../../../platform/extensions/common/extensions.js";
export declare class ExtHostQuickDiff implements ExtHostQuickDiffShape {
    private readonly documents;
    private readonly uriTransformer;
    private static handlePool;
    private proxy;
    private providers;
    private informations;
    constructor(mainContext: IMainContext, documents: ExtHostDocuments, uriTransformer: IURITransformer | undefined);
    $provideOriginalResource(handle: number, uriComponents: UriComponents, token: CancellationToken): Promise<UriComponents | null>;
    $acceptSourceControlDiffInformation(handle: number, diffInformation: ITextEditorDiffInformation | undefined): void;
    registerQuickDiffProvider(extension: IExtensionDescription, selector: vscode.DocumentSelector, quickDiffProvider: vscode.QuickDiffProvider, id: string, label: string, rootUri?: vscode.Uri): vscode.Disposable;
    createSourceControlDiffInformation(uri: vscode.Uri): vscode.SourceControlDiffInformationProvider;
}
