import { IssueReporterData, IIssueSubmissionHost } from "@codingame/monaco-vscode-issue-service-override/vscode/vs/workbench/contrib/issue/common/issue";
export declare const IIssueFormService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IIssueFormService>;
export interface IIssueFormService {
    readonly _serviceBrand: undefined;
    openReporter(data: IssueReporterData): Promise<void>;
    reloadWithExtensionsDisabled(): Promise<void>;
    showConfirmCloseDialog(): Promise<void>;
    showClipboardDialog(): Promise<boolean>;
    sendReporterMenu(extensionId: string): Promise<IssueReporterData | undefined>;
    closeReporter(): Promise<void>;
    submitIssue(host: IIssueSubmissionHost, data: IssueReporterData, title: string, body: string): Promise<boolean>;
}
export declare const IWorkbenchIssueService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IWorkbenchIssueService>;
export interface IWorkbenchIssueService {
    readonly _serviceBrand: undefined;
    openReporter(dataOverrides?: Partial<IssueReporterData>): Promise<void>;
}
