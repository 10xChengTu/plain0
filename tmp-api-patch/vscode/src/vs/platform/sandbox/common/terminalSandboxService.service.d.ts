import { CancellationToken } from "../../../base/common/cancellation.js";
import { OperatingSystem } from "../../../base/common/platform.js";
import { URI } from "../../../base/common/uri.js";
import { ITerminalSandboxPrecheckInputs, ITerminalSandboxPrerequisiteCheckResult, ITerminalSandboxCommand, ITerminalSandboxWrapResult, TerminalSandboxFileAccessPermission, ITerminalSandboxFileAccessCheckResult, ITerminalSandboxResolvedNetworkDomains, ISandboxDependencyInstallOptions, ISandboxDependencyInstallResult, TerminalSandboxPreCheckRemediation } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/sandbox/common/terminalSandboxService";
export declare const ITerminalSandboxService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<ITerminalSandboxService>;
export interface ITerminalSandboxService {
    readonly _serviceBrand: undefined;
    isEnabled(precheckInputs?: ITerminalSandboxPrecheckInputs): Promise<boolean>;
    isSandboxAllowNetworkEnabled(precheckInputs?: ITerminalSandboxPrecheckInputs): Promise<boolean>;
    getOS(): Promise<OperatingSystem>;
    checkForSandboxingPrereqs(forceRefresh?: boolean, precheckInputs?: ITerminalSandboxPrecheckInputs): Promise<ITerminalSandboxPrerequisiteCheckResult>;
    /**
    * Wraps a command line for sandbox execution. Command details are optional,
    * but when provided they are used to derive command-specific read/write
    * allow-list entries. When explicitly requested, `requestAllowNetwork`
    * retains sandbox execution while using a network-unrestricted config.
    */
    wrapCommand(command: string, requestUnsandboxedExecution?: boolean, shell?: string, cwd?: URI, commandDetails?: readonly ITerminalSandboxCommand[], requestAllowNetwork?: boolean): Promise<ITerminalSandboxWrapResult>;
    checkFileAccess(permission: TerminalSandboxFileAccessPermission, paths: readonly string[], precheckInputs?: ITerminalSandboxPrecheckInputs): Promise<ITerminalSandboxFileAccessCheckResult>;
    getSandboxConfigPath(forceRefresh?: boolean, precheckInputs?: ITerminalSandboxPrecheckInputs): Promise<string | undefined>;
    getTempDir(): URI | undefined;
    setNeedsForceUpdateConfigFile(): void;
    getResolvedNetworkDomains(): ITerminalSandboxResolvedNetworkDomains;
    getMissingSandboxDependencies(): Promise<string[]>;
    installMissingSandboxDependencies(missingDependencies: string[], sessionResource: URI | undefined, token: CancellationToken, options: ISandboxDependencyInstallOptions): Promise<ISandboxDependencyInstallResult>;
    runSandboxRemediation(remediation: TerminalSandboxPreCheckRemediation, sessionResource: URI | undefined, token: CancellationToken, options: ISandboxDependencyInstallOptions): Promise<ISandboxDependencyInstallResult>;
}
