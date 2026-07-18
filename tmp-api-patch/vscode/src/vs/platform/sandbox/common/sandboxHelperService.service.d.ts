import { ISandboxDependencyStatus, IWindowsMxcFilesystemPolicy, IWindowsMxcSandboxPolicy, IWindowsMxcPolicyContainment, IWindowsMxcConfig } from "./sandboxHelperService.js";
export declare const ISandboxHelperService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<ISandboxHelperService>;
export interface ISandboxHelperService {
    readonly _serviceBrand: undefined;
    checkSandboxDependencies(): Promise<ISandboxDependencyStatus | undefined>;
    getWindowsMxcFilesystemPolicy(): Promise<IWindowsMxcFilesystemPolicy | undefined>;
    getWindowsMxcEnvironment(): Promise<string[] | undefined>;
    buildWindowsMxcSandboxPayload(commandLine: string, policy: IWindowsMxcSandboxPolicy, workingDirectory?: string, containerName?: string, containment?: IWindowsMxcPolicyContainment): Promise<IWindowsMxcConfig | undefined>;
}
