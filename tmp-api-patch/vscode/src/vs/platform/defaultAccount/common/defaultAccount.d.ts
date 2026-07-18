import { ICopilotTokenInfo, IDefaultAccount, IDefaultAccountAuthenticationProvider, IPolicyData } from "../../../base/common/defaultAccount.js";
import { Event } from "../../../base/common/event.js";
/**
 * Well-known GitHub URL paths used with {@link IDefaultAccountService.resolveGitHubUrl}.
 */
export declare const GitHubPaths: {
    readonly copilotSettings: "settings/copilot/features";
    readonly billingBudgets: "settings/copilot/features?utm_source=vscode";
    readonly copilotUpgrade: "github-copilot/upgrade?utm_source=vscode";
};
/**
 * Outcome of the last `/copilot_internal/managed_settings` fetch.
 * - A numeric HTTP status code indicates the server responded with that code.
 * - `'ok'`: response parsed and adapted successfully (including an empty `{}` body).
 * - `'no-url'`: no `managedSettingsUrl` configured in product.json.
 * - `'no-response'`: network error, all sessions rejected, or active rate-limit backoff.
 * - `'parse-error'`: response received but JSON parsing failed.
 * - `null`: never fetched.
 */
export type ManagedSettingsFetchStatus = number | "ok" | "no-url" | "no-response" | "parse-error" | null;
export interface IDefaultAccountProvider {
    readonly defaultAccount: IDefaultAccount | null;
    readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
    readonly policyData: IPolicyData | null;
    readonly onDidChangePolicyData: Event<IPolicyData | null>;
    readonly copilotTokenInfo: ICopilotTokenInfo | null;
    readonly onDidChangeCopilotTokenInfo: Event<ICopilotTokenInfo | null>;
    readonly managedSettingsFetchStatus: ManagedSettingsFetchStatus;
    /** Timestamp (ms) of the last managed-settings fetch, or `null` if never fetched. */
    readonly managedSettingsFetchedAt: number | null;
    /** The raw JSON response from the managed-settings endpoint, for diagnostics. */
    readonly managedSettingsRawResponse: unknown;
    getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;
    /**
     * Resolves a GitHub URL path to a full URL, using the GitHub Enterprise
     * base URL when the user is authenticated via a GHE provider, or
     * `https://github.com` otherwise.
     *
     * @param path The path portion of the URL (e.g. `settings/copilot/features`).
     */
    resolveGitHubUrl(path: string): string;
    refresh(options?: {
        forceRefresh?: boolean;
    }): Promise<IDefaultAccount | null>;
    signIn(options?: {
        additionalScopes?: readonly string[];
        [key: string]: unknown;
    }): Promise<IDefaultAccount | null>;
    signOut(): Promise<void>;
}
