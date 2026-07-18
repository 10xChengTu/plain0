import { IGitHubUploadResult } from "@codingame/monaco-vscode-issue-service-override/vscode/vs/workbench/contrib/issue/browser/githubUploadService";
export declare const IGitHubUploadService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IGitHubUploadService>;
export interface IGitHubUploadService {
    readonly _serviceBrand: undefined;
    resolveRepositoryId(owner: string, repo: string, token?: string): Promise<string>;
    uploadViaMobileApi(token: string, repoId: string, files: {
        name: string;
        bytes: Uint8Array;
        contentType: string;
    }[]): Promise<IGitHubUploadResult[]>;
}
