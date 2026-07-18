import { IDefaultAccount, IPolicyData, ICopilotTokenInfo, IDefaultAccountAuthenticationProvider } from "../../../base/common/defaultAccount.js";
import { Event } from "../../../base/common/event.js";
import { ManagedSettingsFetchStatus, IDefaultAccountProvider } from "./defaultAccount.js";
export declare const IDefaultAccountService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IDefaultAccountService>;
export interface IDefaultAccountService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
    readonly onDidChangePolicyData: Event<IPolicyData | null>;
    readonly policyData: IPolicyData | null;
    readonly currentDefaultAccount: IDefaultAccount | null;
    readonly copilotTokenInfo: ICopilotTokenInfo | null;
    readonly onDidChangeCopilotTokenInfo: Event<ICopilotTokenInfo | null>;
    readonly managedSettingsFetchStatus: ManagedSettingsFetchStatus;
    /** Timestamp (ms) of the last managed-settings fetch, or `null` if never fetched. */
    readonly managedSettingsFetchedAt: number | null;
    /** The raw JSON response from the managed-settings endpoint, for diagnostics. */
    readonly managedSettingsRawResponse: unknown;
    getDefaultAccount(): Promise<IDefaultAccount | null>;
    getDefaultAccountAuthenticationProvider(): IDefaultAccountAuthenticationProvider;
    setDefaultAccountProvider(provider: IDefaultAccountProvider): void;
    refresh(options?: {
        forceRefresh?: boolean;
    }): Promise<IDefaultAccount | null>;
    signIn(options?: {
        additionalScopes?: readonly string[];
        [key: string]: unknown;
    }): Promise<IDefaultAccount | null>;
    signOut(): Promise<void>;
    /**
    * Resolves a GitHub URL path to a full URL, using the GitHub Enterprise
    * base URL when the user is authenticated via a GHE provider, or
    * `https://github.com` otherwise.
    *
    * @param path The path portion of the URL (e.g. `settings/copilot/features`).
    */
    resolveGitHubUrl(path: string): string;
}
