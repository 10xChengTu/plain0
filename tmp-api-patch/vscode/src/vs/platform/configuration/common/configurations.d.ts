import { IStringDictionary } from "../../../base/common/collections.js";
import { Event } from "../../../base/common/event.js";
import { Disposable } from "../../../base/common/lifecycle.js";
import { ConfigurationModel } from "./configurationModels.js";
import { IRegisteredConfigurationPropertySchema } from "./configurationRegistry.js";
import { ILogService } from "../../log/common/log.service.js";
import { IPolicyService } from "../../policy/common/policy.service.js";
export declare class DefaultConfiguration extends Disposable {
    private readonly logService;
    private readonly _onDidChangeConfiguration;
    readonly onDidChangeConfiguration: Event<{
        defaults: ConfigurationModel;
        properties: string[];
    }>;
    private _configurationModel;
    get configurationModel(): ConfigurationModel;
    constructor(logService: ILogService);
    initialize(): Promise<ConfigurationModel>;
    reload(): ConfigurationModel;
    protected onDidUpdateConfiguration(properties: string[], defaultsOverrides?: boolean): void;
    protected getConfigurationDefaultOverrides(): IStringDictionary<unknown>;
    private resetConfigurationModel;
    private updateConfigurationModel;
    protected getDefaultValue(_key: string, propertySchema: IRegisteredConfigurationPropertySchema): unknown;
}
export interface IPolicyConfiguration {
    readonly onDidChangeConfiguration: Event<ConfigurationModel>;
    readonly configurationModel: ConfigurationModel;
    initialize(): Promise<ConfigurationModel>;
}
export declare class NullPolicyConfiguration implements IPolicyConfiguration {
    readonly onDidChangeConfiguration: Event<any>;
    readonly configurationModel: ConfigurationModel;
    initialize(): Promise<ConfigurationModel>;
}
export declare class PolicyConfiguration extends Disposable implements IPolicyConfiguration {
    private readonly defaultConfiguration;
    private readonly policyService;
    private readonly logService;
    private readonly _onDidChangeConfiguration;
    readonly onDidChangeConfiguration: Event<ConfigurationModel>;
    private readonly configurationRegistry;
    private _configurationModel;
    get configurationModel(): ConfigurationModel;
    /** Last definition submitted per policy name; avoids redundant re-registration. */
    private readonly _submittedPolicyDefinitions;
    /** Maps each policy-controlled setting key to its policy name, so removed keys can be re-resolved. */
    private readonly _policyNameByKey;
    constructor(defaultConfiguration: DefaultConfiguration, policyService: IPolicyService, logService: ILogService);
    initialize(): Promise<ConfigurationModel>;
    private toPolicyDefinitionType;
    private updatePolicyDefinitions;
    private isSamePolicyDefinition;
    /** Resolve the authoritative definition: owner wins; references provide a bare type fallback. */
    private resolvePolicyDefinition;
    private onDidChangePolicies;
    private update;
    private parse;
}
