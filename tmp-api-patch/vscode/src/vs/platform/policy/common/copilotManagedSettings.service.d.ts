import { IStringDictionary } from "../../../base/common/collections.js";
import { Event } from "../../../base/common/event.js";
import { ManagedSettingsData } from "./copilotManagedSettings.js";
import { PolicyDefinition } from "./policy.js";
export declare const INativeManagedSettingsService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<INativeManagedSettingsService>;
export interface INativeManagedSettingsService {
    readonly _serviceBrand: undefined;
    readonly managedSettings: ManagedSettingsData;
    readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
    updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<ManagedSettingsData>;
}
export declare const IFileManagedSettingsService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IFileManagedSettingsService>;
export interface IFileManagedSettingsService {
    readonly _serviceBrand: undefined;
    readonly managedSettings: ManagedSettingsData;
    readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
}
