import { URI } from "../../../base/common/uri.js";
import { IWindowsMxcConfig } from "./sandboxHelperService.js";
import { IWindowsMxcConfigOptions, IWindowsMxcBuildSandboxPayload } from "@codingame/monaco-vscode-terminal-service-override/vscode/vs/platform/sandbox/common/terminalSandboxMxcRuntime";
export declare const IWindowsMxcTerminalSandboxRuntime: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IWindowsMxcTerminalSandboxRuntime>;
export interface IWindowsMxcTerminalSandboxRuntime {
    readonly _serviceBrand: undefined;
    getExecutablePath(appRoot: string, arch: string | undefined): string;
    getRuntimeReadPaths(appRoot: string | undefined, executablePath: string | undefined): string[];
    createConfig(options: IWindowsMxcConfigOptions, buildSandboxPayload: IWindowsMxcBuildSandboxPayload): Promise<IWindowsMxcConfig>;
    wrapCommand(executablePath: string, configPath: string): string;
    wrapUnsandboxedCommand(command: string): string;
    toWindowsPath(uri: URI): string;
}
