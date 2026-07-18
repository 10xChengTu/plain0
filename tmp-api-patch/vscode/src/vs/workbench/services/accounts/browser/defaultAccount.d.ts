import { ICopilotTokenInfo, IDefaultAccount, IDefaultAccountAuthenticationProvider, IPolicyData } from "../../../../base/common/defaultAccount.js";
import { Event } from "../../../../base/common/event.js";
import { Disposable } from "../../../../base/common/lifecycle.js";
import { RawContextKey } from "../../../../platform/contextkey/common/contextkey.js";
import { IDefaultAccountProvider, ManagedSettingsFetchStatus } from "../../../../platform/defaultAccount/common/defaultAccount.js";
import { IDefaultAccountService } from "../../../../platform/defaultAccount/common/defaultAccount.service.js";
import { IProductService } from "../../../../platform/product/common/productService.service.js";
export declare const DEFAULT_ACCOUNT_SIGN_IN_COMMAND = "workbench.actions.accounts.signIn";
export declare enum DefaultAccountStatus {
    Uninitialized = "uninitialized",
    Unavailable = "unavailable",
    Available = "available"
}
export declare const CONTEXT_DEFAULT_ACCOUNT_STATE: RawContextKey<string>;
export declare class DefaultAccountService extends Disposable implements IDefaultAccountService {
    _serviceBrand: undefined;
    private defaultAccount;
    get currentDefaultAccount(): IDefaultAccount | null;
    get policyData(): IPolicyData | null;
    get copilotTokenInfo(): ICopilotTokenInfo | null;
    get managedSettingsFetchStatus(): ManagedSettingsFetchStatus;
    get managedSettingsFetchedAt(): number | null;
    get managedSettingsRawResponse(): unknown;
    private readonly initBarrier;
    private readonly _onDidChangeDefaultAccount;
    readonly onDidChangeDefaultAccount: Event<IDefaultAccount | null>;
    private readonly _onDidChangePolicyData;
    readonly onDidChangePolicyData: Event<IPolicyData | null>;
    private readonly _onDidChangeCopilotTokenInfo;
    readonly onDidChangeCopilotTokenInfo: Event<ICopilotTokenInfo | null>;
    private readonly defaultAccountConfig?;
    private defaultAccountProvider;
    constructor(productService: IProductService);
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
    resolveGitHubUrl(path: string): string;
    private setDefaultAccount;
}
