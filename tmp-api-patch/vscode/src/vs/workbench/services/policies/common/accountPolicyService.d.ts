import { IStringDictionary } from "../../../../base/common/collections.js";
import { RawContextKey } from "../../../../platform/contextkey/common/contextkey.js";
import { ILogService } from "../../../../platform/log/common/log.service.js";
import { IFileManagedSettingsService } from "../../../../platform/policy/common/copilotManagedSettings.service.js";
import { INativeManagedSettingsService } from "../../../../platform/policy/common/copilotManagedSettings.service.js";
import { AbstractPolicyService, PolicyDefinition } from "../../../../platform/policy/common/policy.js";
import { IPolicyService } from "../../../../platform/policy/common/policy.service.js";
import { IDefaultAccountService } from "../../../../platform/defaultAccount/common/defaultAccount.service.js";
import { IAccountPolicyGateService } from "./accountPolicyService.service.js";
/**
 * Policy name (declared by `chat.approvedAccountOrganizations`) holding the list of
 * GitHub organization logins that satisfy the gate. The token `*` is a wildcard.
 */
export declare const APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME = "ChatApprovedAccountOrganizations";
export declare enum AccountPolicyGateState {
    Inactive = "inactive",
    Satisfied = "satisfied",
    /** Gate active and NOT satisfied — restricted values are applied to all gated policies. */
    Restricted = "restricted"
}
export declare enum AccountPolicyGateUnsatisfiedReason {
    NoAccount = "noAccount",
    WrongProvider = "wrongProvider",
    OrgNotApproved = "orgNotApproved",
    PolicyNotResolved = "policyNotResolved"
}
export interface IAccountPolicyGateInfo {
    readonly state: AccountPolicyGateState;
    readonly reason?: AccountPolicyGateUnsatisfiedReason;
    readonly approvedOrganizations?: readonly string[];
}
export declare const ChatAccountPolicyGateActiveContext: RawContextKey<boolean>;
export declare class AccountPolicyService extends AbstractPolicyService implements IPolicyService, IAccountPolicyGateService {
    private readonly logService;
    private readonly defaultAccountService;
    readonly _serviceBrand: undefined;
    private _gateInfo;
    get gateInfo(): IAccountPolicyGateInfo;
    private readonly _onDidChangeGateInfo;
    readonly onDidChangeGateInfo: import("../../../../base/common/event.js").Event<IAccountPolicyGateInfo>;
    private readonly managedPolicyReader?;
    private readonly nativeManagedSettingsService?;
    private readonly fileManagedSettingsService?;
    constructor(logService: ILogService, defaultAccountService: IDefaultAccountService, managedPolicyService?: IPolicyService, nativeManagedSettingsService?: INativeManagedSettingsService, fileManagedSettingsService?: IFileManagedSettingsService);
    protected _updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<void>;
    private updateCopilotManagedSettingDefinitions;
    private getPolicyData;
    private computeGateInfo;
}
