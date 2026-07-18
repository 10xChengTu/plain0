import { IStringDictionary } from "../../../base/common/collections.js";
import { IPolicyData } from "../../../base/common/defaultAccount.js";
import { Emitter, Event } from "../../../base/common/event.js";
import { Disposable } from "../../../base/common/lifecycle.js";
import { IManagedSettingsPolicyDefinitions, PolicyName } from "../../../base/common/policy.js";
import { IPolicyService } from "./policy.service.js";
export type PolicyValue = string | number | boolean;
export type PolicyDefinition = {
    type: "string" | "number" | "boolean";
    value?: (policyData: IPolicyData) => string | number | boolean | undefined;
    managedSettings?: IManagedSettingsPolicyDefinitions;
    restrictedValue?: PolicyValue;
};
/** Returns a structured-clone-safe copy of `definition`, dropping the non-cloneable `value` callback. */
export declare function toSerializablePolicyDefinition(definition: PolicyDefinition): PolicyDefinition;
/**
 * Returns the value to apply for `definition` when the account-policy gate is active
 * but not satisfied. Uses `definition.restrictedValue` when specified, otherwise falls
 * back to a type-driven safe default.
 */
export declare function getRestrictedPolicyValue(definition: PolicyDefinition): PolicyValue;
export declare abstract class AbstractPolicyService extends Disposable implements IPolicyService {
    readonly _serviceBrand: undefined;
    policyDefinitions: IStringDictionary<PolicyDefinition>;
    protected policies: Map<string, PolicyValue>;
    protected readonly _onDidChange: Emitter<readonly string[]>;
    readonly onDidChange: Event<readonly string[]>;
    updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<IStringDictionary<PolicyValue>>;
    getPolicyValue(name: PolicyName): PolicyValue | undefined;
    serialize(): IStringDictionary<{
        definition: PolicyDefinition;
        value: PolicyValue;
    }>;
    protected abstract _updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<void>;
}
export declare class NullPolicyService implements IPolicyService {
    readonly _serviceBrand: undefined;
    readonly onDidChange: Event<any>;
    updatePolicyDefinitions(): Promise<{}>;
    getPolicyValue(): undefined;
    serialize(): undefined;
    policyDefinitions: IStringDictionary<PolicyDefinition>;
}
