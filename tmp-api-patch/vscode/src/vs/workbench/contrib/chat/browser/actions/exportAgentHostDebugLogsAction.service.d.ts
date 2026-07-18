export declare const IAgentHostDebugLogsExportService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostDebugLogsExportService>;
export interface IAgentHostDebugLogsExportService {
    readonly _serviceBrand: undefined;
    save(exportName: string, files: readonly {
        path: string;
        contents: string;
    }[]): Promise<boolean>;
}
