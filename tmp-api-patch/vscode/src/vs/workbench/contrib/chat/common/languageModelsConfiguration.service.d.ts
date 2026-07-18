import { Event } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import { ILanguageModelsProviderGroup, ConfigureLanguageModelsOptions } from "./languageModelsConfiguration.js";
export declare const ILanguageModelsConfigurationService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<ILanguageModelsConfigurationService>;
export interface ILanguageModelsConfigurationService {
    readonly _serviceBrand: undefined;
    readonly configurationFile: URI;
    readonly onDidChangeLanguageModelGroups: Event<readonly ILanguageModelsProviderGroup[]>;
    /** Resolves after the first config-file load attempt (success or failure), so callers can distinguish empty from not-yet-loaded. Never rejects. */
    readonly whenReady: Promise<void>;
    getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[];
    addLanguageModelsProviderGroup(languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;
    updateLanguageModelsProviderGroup(from: ILanguageModelsProviderGroup, to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;
    removeLanguageModelsProviderGroup(languageModelGroup: ILanguageModelsProviderGroup): Promise<void>;
    configureLanguageModels(options?: ConfigureLanguageModelsOptions): Promise<void>;
}
