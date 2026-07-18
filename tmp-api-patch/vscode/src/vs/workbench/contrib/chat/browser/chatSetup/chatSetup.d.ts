import { ICommandService } from "../../../../../platform/commands/common/commands.service.js";
import { ILogService } from "../../../../../platform/log/common/log.service.js";
import { IExtensionsWorkbenchService } from "../../../extensions/common/extensions.service.js";
export type InstallChatClassification = {
    owner: "bpasero";
    comment: "Provides insight into chat installation.";
    installResult: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "Whether the extension was installed successfully, cancelled or failed to install.";
    };
    installDuration: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The duration it took to install the extension.";
    };
    signUpErrorCode: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The error code in case of an error signing up.";
    };
    provider: {
        classification: "SystemMetaData";
        purpose: "FeatureInsight";
        comment: "The provider used for the chat installation.";
    };
};
export type InstallChatEvent = {
    installResult: "installed" | "alreadyInstalled" | "cancelled" | "failedInstall" | "failedNotSignedIn" | "failedSignUp" | "failedNotTrusted" | "failedNoSession" | "failedMaybeLater" | "failedEnterpriseSetup";
    installDuration: number;
    signUpErrorCode: number | undefined;
    provider: string | undefined;
};
export declare enum ChatSetupAnonymous {
    Disabled = 0,
    EnabledWithDialog = 1,
    EnabledWithoutDialog = 2
}
export declare enum ChatSetupStep {
    Initial = 1,
    SigningIn = 2,
    Installing = 3
}
export declare enum ChatSetupStrategy {
    Canceled = 0,
    DefaultSetup = 1,
    SetupWithoutEnterpriseProvider = 2,
    SetupWithEnterpriseProvider = 3,
    SetupWithGoogleProvider = 4,
    SetupWithAppleProvider = 5
}
export type ChatSetupResultValue = boolean | undefined;
export interface IChatSetupResult {
    readonly success: ChatSetupResultValue;
    readonly dialogSkipped: boolean;
}
export declare function refreshTokens(commandService: ICommandService): void;
/**
 * Builds a redirect URL that GitHub will use to return the user to VS Code
 * after completing a plan upgrade. The redirect goes through `vscode.dev/redirect`
 * which triggers the native protocol handler back into the desktop app.
 *
 * @param baseUpgradeUrl The direct GitHub upgrade URL (from `resolveGitHubUrl`).
 * @param urlProtocol The VS Code URL protocol scheme (e.g. `vscode`, `vscode-insiders`, `code-oss`).
 * @param quality The product quality (`stable`, `insider`, or `undefined` for OSS).
 * @returns The upgrade URL with a `return_to` query parameter appended.
 */
export declare function buildUpgradeUrlWithRedirect(baseUpgradeUrl: string, urlProtocol: string, quality: string | undefined): string;
/**
 * Ensures the authentication provider extension is enabled.
 * If the extension is found locally but disabled, it will be
 * re-enabled and running extensions will be updated.
 *
 * @returns `true` if the extension was re-enabled, `false` otherwise.
 */
export declare function maybeEnableAuthExtension(extensionsWorkbenchService: IExtensionsWorkbenchService, logService: ILogService): Promise<boolean>;
