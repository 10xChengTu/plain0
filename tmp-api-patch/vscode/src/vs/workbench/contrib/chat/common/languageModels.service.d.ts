import { IAction } from "../../../../base/common/actions.js";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { IStringDictionary } from "../../../../base/common/collections.js";
import { Event } from "../../../../base/common/event.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../base/common/observable.js";
import { ExtensionIdentifier } from "../../../../platform/extensions/common/extensions.js";
import { ILanguageModelProviderDescriptor, ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelsGroup, ILanguageModelChatSelector, ILanguageModelChatProvider, IUserFriendlyLanguageModel, IChatMessage, ILanguageModelChatRequestOptions, ILanguageModelChatResponse, IModelsControlManifest } from "./languageModels.js";
import { ILanguageModelsProviderGroup } from "./languageModelsConfiguration.js";
export declare const ILanguageModelsService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<ILanguageModelsService>;
export interface ILanguageModelsService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeLanguageModelVendors: Event<readonly string[]>;
    readonly onDidChangeLanguageModels: Event<string>;
    getLanguageModelIds(): string[];
    getVendors(): ILanguageModelProviderDescriptor[];
    lookupLanguageModel(modelId: string): ILanguageModelChatMetadata | undefined;
    /**
    * Find a model by its qualified name. The qualified name is what is used in prompt and agent files and is in the format "Model Name (Vendor)".
    */
    lookupLanguageModelByQualifiedName(qualifiedName: string): ILanguageModelChatMetadataAndIdentifier | undefined;
    getLanguageModelGroups(vendor: string): ILanguageModelsGroup[];
    /**
    * Returns true if the given vendor's provider has completed at least one
    * model resolution since registration. A `false` result indicates the
    * vendor is still in a startup/reload race where its model list isn't yet
    * authoritative — callers can fall back to a cached list in that case.
    */
    hasResolvedVendor(vendor: string): boolean;
    /**
    * Given a selector, returns a list of model identifiers
    * @param selector The selector to lookup for language models. If the selector is empty, all language models are returned.
    */
    selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]>;
    registerLanguageModelProvider(vendor: string, provider: ILanguageModelChatProvider): IDisposable;
    deltaLanguageModelChatProviderDescriptors(added: IUserFriendlyLanguageModel[], removed: IUserFriendlyLanguageModel[]): void;
    sendChatRequest(modelId: string, from: ExtensionIdentifier | undefined, messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
    computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
    /**
    * Returns the resolved per-model configuration for the given model identifier.
    * Includes schema defaults with user overrides applied on top.
    * Returns undefined if the model has no configuration schema and no user config.
    */
    getModelConfiguration(modelId: string): IStringDictionary<unknown> | undefined;
    /**
    * Updates the per-model configuration for the given model.
    * Merges the provided values into the existing configuration.
    */
    setModelConfiguration(modelId: string, values: IStringDictionary<unknown>): Promise<void>;
    /**
    * Returns actions for configuring the given model based on its configuration schema.
    * For enum properties, returns submenu actions with checkable values.
    * Returns an empty array if the model has no configuration schema.
    */
    getModelConfigurationActions(modelId: string): IAction[];
    addLanguageModelsProviderGroup(name: string, vendorId: string, configuration: IStringDictionary<unknown> | undefined): Promise<void>;
    removeLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void>;
    configureLanguageModelsProviderGroup(vendorId: string, name?: string): Promise<void>;
    renameLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void>;
    updateLanguageModelsProviderGroupApiKey(vendorId: string, providerGroupName: string): Promise<void>;
    addLanguageModelsProviderGroupModel(vendorId: string, providerGroupName: string): Promise<void>;
    openLanguageModelsProviderGroupSettings(vendorId: string, providerGroupName: string): Promise<void>;
    /**
    * Opens the language models configuration file and navigates to
    * or creates the per-model configuration for the given model.
    */
    configureModel(modelId: string): Promise<void>;
    migrateLanguageModelsProviderGroup(languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<void>;
    /**
    * Returns the most recently used model identifiers, ordered by most-recent-first.
    * @param maxCount Maximum number of entries to return (default 7).
    */
    getRecentlyUsedModelIds(): string[];
    /**
    * Records that a model was used, updating the recently used list.
    */
    addToRecentlyUsedList(modelIdentifier: string): void;
    /**
    * Clears the recently used model list.
    */
    clearRecentlyUsedList(): void;
    /**
    * Returns the pinned model identifiers, in the order they were pinned.
    */
    getPinnedModelIds(): string[];
    /**
    * Pins a model so it appears in the pinned section of the model picker.
    */
    pinModel(modelIdentifier: string): void;
    /**
    * Unpins a model, removing it from the pinned section.
    */
    unpinModel(modelIdentifier: string): void;
    /**
    * Returns whether the given model is pinned.
    */
    isModelPinned(modelIdentifier: string): boolean;
    /**
    * Fires when the pinned models list changes.
    */
    readonly onDidChangePinnedModels: Event<void>;
    /**
    * Returns whether the given model is hidden from the chat model picker.
    */
    isModelHidden(modelIdentifier: string): boolean;
    /**
    * Returns whether every resolved model in the given (vendor, groupName)
    * bucket is hidden from the chat model picker.
    */
    isGroupHidden(vendor: string, groupName: string): boolean;
    /**
    * Hide or show a single model in the chat model picker.
    */
    setModelHidden(modelIdentifier: string, hidden: boolean): void;
    /**
    * Hide or show every model in a (vendor, groupName) bucket.
    */
    setGroupHidden(vendor: string, groupName: string, hidden: boolean): void;
    /**
    * Returns the persisted per-model hidden identifiers.
    */
    getHiddenModelIds(): string[];
    /**
    * Fires when any model or group visibility state changes.
    */
    readonly onDidChangeModelVisibility: Event<void>;
    /**
    * Returns the models from the control manifest,
    * separated into free and paid tiers.
    */
    getModelsControlManifest(): IModelsControlManifest;
    /**
    * Fires when models control manifest changes.
    */
    readonly onDidChangeModelsControlManifest: Event<IModelsControlManifest>;
    /**
    * Observable map of restricted chat participant names to allowed extension publisher/IDs.
    * Fetched from the chat control manifest.
    */
    readonly restrictedChatParticipants: IObservable<{
        [name: string]: string[];
    }>;
}
