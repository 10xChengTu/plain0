import { VSBuffer } from "../../../../base/common/buffer.js";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { IStringDictionary } from "../../../../base/common/collections.js";
import { Event } from "../../../../base/common/event.js";
import { IJSONSchema, TypeFromJsonSchema } from "../../../../base/common/jsonSchema.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../base/common/observable.js";
import Severity from "../../../../base/common/severity.js";
import { ThemeIcon } from "../../../../base/common/themables.js";
import { IAction } from "../../../../base/common/actions.js";
import { URI } from "../../../../base/common/uri.js";
import { IContextKeyService } from "../../../../platform/contextkey/common/contextkey.service.js";
import { ExtensionIdentifier } from "../../../../platform/extensions/common/extensions.js";
import { ILogService } from "../../../../platform/log/common/log.service.js";
import { INotificationService } from "../../../../platform/notification/common/notification.service.js";
import { IOpenerService } from "../../../../platform/opener/common/opener.service.js";
import { IProductService } from "../../../../platform/product/common/productService.service.js";
import { IRequestService } from "../../../../platform/request/common/request.service.js";
import { IQuickInputService } from "../../../../platform/quickinput/common/quickInput.service.js";
import { ISecretStorageService } from "../../../../platform/secrets/common/secrets.service.js";
import { IStorageService } from "../../../../platform/storage/common/storage.service.js";
import { ITelemetryService } from "../../../../platform/telemetry/common/telemetry.service.js";
import { IExtensionService } from "../../../services/extensions/common/extensions.service.js";
import { ChatAgentLocation } from "./constants.js";
import { ILanguageModelsProviderGroup } from "./languageModelsConfiguration.js";
import { ILanguageModelsConfigurationService } from "./languageModelsConfiguration.service.js";
import { ILanguageModelsService } from "./languageModels.service.js";
/**
 * Vendor id used for the built-in GitHub Copilot language model provider. Treated as the default
 * vendor across the chat stack (see `ILanguageModelProviderDescriptor.isDefault`).
 */
export declare const COPILOT_VENDOR_ID = "copilot";
/**
 * Bucket reported for any non-Copilot provider that is not an in-built BYOK provider, i.e. a model
 * contributed by a third-party extension. We never report the third-party vendor id directly to avoid
 * logging potentially identifying values.
 */
export declare const THIRD_PARTY_PROVIDER_TELEMETRY_NAME = "3p-extension";
/**
 * Normalizes a non-Copilot model vendor into a non-identifying provider name suitable for telemetry:
 * the in-built BYOK vendor id (e.g. `openai`, `ollama`) when contributed by the built-in Copilot
 * extensions, or {@link THIRD_PARTY_PROVIDER_TELEMETRY_NAME} otherwise. Returns `undefined` for the
 * first-party Copilot vendor (or no vendor) so callers skip logging first-party usage.
 */
export declare function getByokProviderTelemetryName(vendor: string | undefined, extension: ExtensionIdentifier | undefined): string | undefined;
export declare enum ChatMessageRole {
    System = 0,
    User = 1,
    Assistant = 2
}
export declare enum LanguageModelPartAudience {
    Assistant = 0,
    User = 1,
    Extension = 2
}
export interface IChatMessageTextPart {
    type: "text";
    value: string;
    audience?: LanguageModelPartAudience[];
}
export interface IChatMessageImagePart {
    type: "image_url";
    value: IChatImageURLPart;
}
export interface IChatMessageThinkingPart {
    type: "thinking";
    value: string | string[];
    id?: string;
    metadata?: {
        readonly [key: string]: any;
    };
}
export interface IChatMessageDataPart {
    type: "data";
    mimeType: string;
    data: VSBuffer;
    audience?: LanguageModelPartAudience[];
}
export interface IChatImageURLPart {
    /**
     * The image's MIME type (e.g., "image/png", "image/jpeg").
     */
    mimeType: ChatImageMimeType;
    /**
     * The raw binary data of the image, encoded as a Uint8Array. Note: do not use base64 encoding. Maximum image size is 5MB.
     */
    data: VSBuffer;
}
/**
 * Enum for supported image MIME types.
 */
export declare enum ChatImageMimeType {
    PNG = "image/png",
    JPEG = "image/jpeg",
    GIF = "image/gif",
    WEBP = "image/webp",
    BMP = "image/bmp"
}
/**
 * Specifies the detail level of the image.
 */
export declare enum ImageDetailLevel {
    Low = "low",
    High = "high"
}
export interface IChatMessageToolResultPart {
    type: "tool_result";
    toolCallId: string;
    value: (IChatResponseTextPart | IChatResponsePromptTsxPart | IChatResponseDataPart)[];
    isError?: boolean;
}
export type IChatMessagePart = IChatMessageTextPart | IChatMessageToolResultPart | IChatResponseToolUsePart | IChatMessageImagePart | IChatMessageDataPart | IChatMessageThinkingPart;
export interface IChatMessage {
    readonly name?: string | undefined;
    readonly role: ChatMessageRole;
    readonly content: IChatMessagePart[];
}
export interface IChatResponseTextPart {
    type: "text";
    value: string;
    audience?: LanguageModelPartAudience[];
}
export interface IChatResponsePromptTsxPart {
    type: "prompt_tsx";
    value: unknown;
}
export interface IChatResponseDataPart {
    type: "data";
    mimeType: string;
    data: VSBuffer;
    audience?: LanguageModelPartAudience[];
}
export interface IChatResponseToolUsePart {
    type: "tool_use";
    name: string;
    toolCallId: string;
    parameters: any;
}
export interface IChatResponseThinkingPart {
    type: "thinking";
    value: string | string[];
    id?: string;
    metadata?: {
        readonly [key: string]: any;
    };
}
export interface IChatResponsePullRequestPart {
    type: "pullRequest";
    uri: URI;
    title: string;
    description: string;
    author: string;
    linkTag: string;
}
export type IChatResponsePart = IChatResponseTextPart | IChatResponseToolUsePart | IChatResponseDataPart | IChatResponseThinkingPart;
export type IExtendedChatResponsePart = IChatResponsePullRequestPart;
export interface ILanguageModelConfigurationSchema extends IJSONSchema {
    properties?: {
        [key: string]: IJSONSchema & {
            /** When set to `'navigation'`, the property is shown as a primary action in the model picker. */
            group?: string;
            /** Labels for enum values. If provided, these are shown instead of the raw enum values. */
            enumItemLabels?: string[];
        };
    };
}
export interface ILanguageModelChatMetadata {
    readonly extension: ExtensionIdentifier;
    readonly name: string;
    readonly id: string;
    readonly vendor: string;
    readonly version: string;
    readonly tooltip?: string;
    readonly detail?: string;
    readonly multiplierNumeric?: number;
    readonly isBYOK?: boolean;
    readonly pricing?: string;
    readonly inputCost?: number;
    readonly cacheCost?: number;
    readonly cacheWriteCost?: number;
    readonly outputCost?: number;
    readonly longContextInputCost?: number;
    readonly longContextCacheCost?: number;
    readonly longContextCacheWriteCost?: number;
    readonly longContextOutputCost?: number;
    readonly priceCategory?: string;
    readonly category?: string;
    readonly family: string;
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly isDefaultForLocation: {
        [K in ChatAgentLocation]?: boolean;
    };
    readonly isUserSelectable?: boolean;
    readonly statusIcon?: ThemeIcon;
    readonly auth?: {
        readonly providerLabel: string;
        readonly accountLabel?: string;
    };
    readonly capabilities?: {
        readonly vision?: boolean;
        readonly toolCalling?: boolean;
        readonly agentMode?: boolean;
        readonly editTools?: ReadonlyArray<string>;
    };
    /**
     * When set, this model is only shown in the model picker for the specified chat session type.
     * Models with this property are excluded from the general model picker and only appear
     * when the user is in a session matching this type.
     */
    readonly targetChatSessionType?: string;
    /**
     * Optional grouping hint for the model picker. When set, the picker buckets this model
     * under a sub-group within its vendor, identified by this vendor id — e.g. agent-host models,
     * which all share one vendor, grouped by their upstream provider — instead of a single
     * vendor-wide bucket. The display name is resolved from the vendor registry
     * ({@link ILanguageModelsService.getVendors}), the same source used for every other vendor.
     * Presentation-only; it does not affect model selection or routing.
     */
    readonly modelGroup?: {
        readonly id: string;
    };
    /**
     * An optional JSON schema describing the per-model configuration options.
     * Used to validate user-provided per-model configuration in `chatLanguageModels.json`.
     */
    readonly configurationSchema?: ILanguageModelConfigurationSchema;
    /**
     * Optional warning text to display in the model picker hover as a warning banner.
     * The keys are warning categories (e.g. "data_retention") and the values are markdown strings.
     */
    readonly warningText?: IStringDictionary<string>;
}
export declare namespace ILanguageModelChatMetadata {
    function suitableForAgentMode(metadata: ILanguageModelChatMetadata): boolean;
    function asQualifiedName(metadata: ILanguageModelChatMetadata): string;
    function matchesQualifiedName(name: string, metadata: ILanguageModelChatMetadata): boolean;
    /**
     * Documentation link explaining how Auto model selection works.
     * NOTE: Also defined in extensions/copilot/src/extension/conversation/common/languageModelAccess.ts — keep in sync.
     */
    const autoModelSelectionDocsUrl = "https://docs.github.com/en/copilot/concepts/models/auto-model-selection";
    /**
     * Builds the shared description shown for the Auto model, rendered as Markdown
     * (it contains a "Learn More" link). The discount sentence is only included
     * when a positive discount is provided.
     *
     * @param discountPercent Whole-number percentage (e.g. `10` for 10%). When
     * omitted or not positive, the discount sentence is left out entirely.
     */
    function getAutoModelDescription(discountPercent?: number): string;
}
export interface ILanguageModelChatResponse {
    stream: AsyncIterable<IChatResponsePart | IChatResponsePart[]>;
    result: Promise<any>;
}
export declare function getTextResponseFromStream(response: ILanguageModelChatResponse): Promise<string>;
export interface ILanguageModelChatProvider {
    readonly onDidChange: Event<void>;
    provideLanguageModelChatInfo(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<ILanguageModelChatMetadataAndIdentifier[]>;
    sendChatRequest(modelId: string, messages: IChatMessage[], from: ExtensionIdentifier | undefined, options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
    provideTokenCount(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
}
export interface ILanguageModelChat {
    metadata: ILanguageModelChatMetadata;
    sendChatRequest(messages: IChatMessage[], from: ExtensionIdentifier | undefined, options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
    provideTokenCount(message: string | IChatMessage, token: CancellationToken): Promise<number>;
}
export interface ILanguageModelChatSelector {
    readonly name?: string;
    readonly id?: string;
    readonly vendor?: string;
    readonly version?: string;
    readonly family?: string;
    readonly tokens?: number;
    readonly extension?: ExtensionIdentifier;
}
export declare function isILanguageModelChatSelector(value: unknown): value is ILanguageModelChatSelector;
export interface ILanguageModelChatMetadataAndIdentifier {
    metadata: ILanguageModelChatMetadata;
    identifier: string;
}
export interface ILanguageModelChatInfoOptions {
    readonly group?: string;
    readonly silent: boolean;
    readonly configuration?: IStringDictionary<unknown>;
}
export interface ILanguageModelChatRequestOptions {
    readonly modelOptions?: IStringDictionary<unknown>;
    readonly configuration?: IStringDictionary<unknown>;
    readonly [name: string]: any;
}
export interface ILanguageModelsGroup {
    readonly group?: ILanguageModelsProviderGroup;
    readonly modelIdentifiers: string[];
    readonly status?: {
        readonly message: string;
        readonly severity: Severity;
    };
}
export interface IModelControlEntry {
    readonly label: string;
    readonly featured?: boolean;
    readonly minVSCodeVersion?: string;
    readonly exists: boolean;
}
export interface IModelsControlManifest {
    readonly free: IStringDictionary<IModelControlEntry>;
    readonly paid: IStringDictionary<IModelControlEntry>;
}
declare const languageModelChatProviderType: {
    readonly type: "object";
    readonly required: [
        "vendor",
        "displayName"
    ];
    readonly properties: {
        readonly vendor: {
            readonly type: "string";
            readonly description: string;
        };
        readonly displayName: {
            readonly type: "string";
            readonly description: string;
        };
        readonly configuration: {
            readonly type: "object";
            readonly description: string;
            readonly anyOf: [
                {
                    readonly $ref: "http://json-schema.org/draft-07/schema#";
                },
                {
                    readonly properties: {
                        readonly properties: {
                            readonly type: "object";
                            readonly additionalProperties: {
                                readonly $ref: "http://json-schema.org/draft-07/schema#";
                                readonly properties: {
                                    readonly secret: {
                                        readonly type: "boolean";
                                        readonly description: string;
                                    };
                                };
                            };
                        };
                        readonly additionalProperties: {
                            readonly $ref: "http://json-schema.org/draft-07/schema#";
                            readonly properties: {
                                readonly secret: {
                                    readonly type: "boolean";
                                    readonly description: string;
                                };
                            };
                        };
                    };
                }
            ];
        };
        readonly managementCommand: {
            readonly type: "string";
            readonly description: string;
            readonly deprecated: true;
            readonly deprecationMessage: string;
        };
        readonly deprecation: {
            readonly type: "object";
            readonly description: string;
            readonly properties: {
                readonly link: {
                    readonly type: "string";
                    readonly description: string;
                };
            };
        };
        readonly when: {
            readonly type: "string";
            readonly description: string;
        };
    };
};
export type IUserFriendlyLanguageModel = Omit<TypeFromJsonSchema<typeof languageModelChatProviderType>, "deprecation"> & {
    /**
     * Marks a provider as deprecated. The Manage Models view renders a link
     * (pointing to a replacement, e.g. a `vscode:extension/<publisher>.<name>` URI)
     * next to the provider name. Optional so existing provider descriptors are unaffected.
     */
    readonly deprecation?: {
        readonly link?: string;
    };
};
export interface ILanguageModelProviderDescriptor extends IUserFriendlyLanguageModel {
    readonly isDefault: boolean;
}
/**
 * Resolves a provider `deprecation.link` for opening inside the current build. Contributions point
 * at the replacement extension with a stable `vscode:extension/<id>` URI, but the URL service only
 * routes URIs whose scheme matches this build's `urlProtocol` (e.g. `code-oss`, `vscode-insiders`).
 * The `vscode:` scheme is therefore rewritten to the current protocol so the extensions URL handler
 * opens the extension; without this the opener falls back to treating the URI as a (non-existent)
 * file resource and fails. Other schemes (http(s), command) are returned unchanged.
 */
export declare function resolveProviderDeprecationLink(link: string, urlProtocol: string | undefined): URI;
export declare const languageModelChatProviderExtensionPoint: import("../../../services/extensions/common/extensionsRegistry.js").IExtensionPoint<IUserFriendlyLanguageModel | IUserFriendlyLanguageModel[]>;
export declare function isAutoLanguageModel(model: ILanguageModelChatMetadataAndIdentifier | undefined): boolean;
/**
 * Builds the per-model configuration submenu actions from a model's
 * {@link ILanguageModelConfigurationSchema}. The current value is read from
 * `currentConfig` and selections are routed through `setValue`, allowing the
 * caller to decide whether changes apply globally or to a per-editor override.
 */
export declare function createModelConfigurationActions(schema: ILanguageModelConfigurationSchema | undefined, currentConfig: IStringDictionary<unknown>, setValue: (key: string, value: unknown) => void): IAction[];
export declare class LanguageModelsService implements ILanguageModelsService {
    private readonly _extensionService;
    private readonly _logService;
    private readonly _storageService;
    private readonly _contextKeyService;
    private readonly _languageModelsConfigurationService;
    private readonly _quickInputService;
    private readonly _secretStorageService;
    private readonly _productService;
    private readonly _requestService;
    private readonly _notificationService;
    private readonly _openerService;
    private readonly _telemetryService;
    private static SECRET_KEY_PREFIX;
    private static SECRET_INPUT;
    readonly _serviceBrand: undefined;
    private readonly _store;
    private readonly _providers;
    private readonly _vendors;
    /** Vendors for which a deprecation notice has already been shown this session. */
    private readonly _deprecationNoticeShownVendors;
    private readonly _onDidChangeLanguageModelVendors;
    readonly onDidChangeLanguageModelVendors: Event<string[]>;
    private readonly _modelsGroups;
    private readonly _modelCache;
    private readonly _resolveLMSequencer;
    private readonly _modelConfigurations;
    private readonly _hasUserSelectableModels;
    private readonly _hasNonCopilotUserSelectableModels;
    private readonly _onLanguageModelChange;
    readonly onDidChangeLanguageModels: Event<string>;
    private _recentlyUsedModelIds;
    private _pinnedModelIds;
    private _hiddenModelIds;
    private readonly _onDidChangeModelsControlManifest;
    readonly onDidChangeModelsControlManifest: Event<IModelsControlManifest>;
    private readonly _onDidChangePinnedModels;
    readonly onDidChangePinnedModels: Event<void>;
    private readonly _onDidChangeModelVisibility;
    readonly onDidChangeModelVisibility: Event<void>;
    private _modelsControlManifest;
    private _modelsControlRawResponse;
    private _chatControlUrl;
    private _chatControlDisposed;
    private readonly _restrictedChatParticipants;
    readonly restrictedChatParticipants: IObservable<{
        [name: string]: string[];
    }>;
    constructor(_extensionService: IExtensionService, _logService: ILogService, _storageService: IStorageService, _contextKeyService: IContextKeyService, _languageModelsConfigurationService: ILanguageModelsConfigurationService, _quickInputService: IQuickInputService, _secretStorageService: ISecretStorageService, _productService: IProductService, _requestService: IRequestService, _notificationService: INotificationService, _openerService: IOpenerService, _telemetryService: ITelemetryService);
    deltaLanguageModelChatProviderDescriptors(added: IUserFriendlyLanguageModel[], removed: IUserFriendlyLanguageModel[]): void;
    private _onDidChangeLanguageModelGroups;
    getVendors(): ILanguageModelProviderDescriptor[];
    getLanguageModelIds(): string[];
    lookupLanguageModel(modelIdentifier: string): ILanguageModelChatMetadata | undefined;
    lookupLanguageModelByQualifiedName(referenceName: string): ILanguageModelChatMetadataAndIdentifier | undefined;
    private _resolveAllLanguageModels;
    private _hasGroupStructureChanged;
    getLanguageModelGroups(vendor: string): ILanguageModelsGroup[];
    hasResolvedVendor(vendor: string): boolean;
    selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]>;
    registerLanguageModelProvider(vendor: string, provider: ILanguageModelChatProvider): IDisposable;
    sendChatRequest(modelId: string, from: ExtensionIdentifier | undefined, messages: IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
    /**
     * When a chat request is made against a deprecated provider (one that contributes a
     * `deprecation.link`), prompt the user once per session to install the replacement
     * extension. The notification can be dismissed, and offers a "Don't Show Again" choice that
     * is persisted across sessions via the notification service's `neverShowAgain` support.
     */
    private _maybeShowProviderDeprecationNotice;
    /**
     * Reports which in-built BYOK provider (or third-party extension) backs a model request. First-party
     * Copilot models are intentionally not reported here (see {@link getByokProviderTelemetryName}).
     */
    private _logProviderUsageTelemetry;
    private _resolveModelConfigurationWithDefaults;
    computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
    getModelConfiguration(modelId: string): IStringDictionary<unknown> | undefined;
    setModelConfiguration(modelId: string, values: IStringDictionary<unknown>): Promise<void>;
    getModelConfigurationActions(modelId: string): IAction[];
    configureLanguageModelsProviderGroup(vendorId: string, providerGroupName?: string): Promise<void>;
    renameLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void>;
    updateLanguageModelsProviderGroupApiKey(vendorId: string, providerGroupName: string): Promise<void>;
    addLanguageModelsProviderGroupModel(vendorId: string, providerGroupName: string): Promise<void>;
    openLanguageModelsProviderGroupSettings(vendorId: string, providerGroupName: string): Promise<void>;
    configureModel(modelId: string): Promise<void>;
    private _getModelConfigurationSnippet;
    addLanguageModelsProviderGroup(name: string, vendorId: string, configuration: IStringDictionary<unknown> | undefined): Promise<void>;
    removeLanguageModelsProviderGroup(vendorId: string, providerGroupName: string): Promise<void>;
    private requireConfiguring;
    private getSnippetForFirstUnconfiguredProperty;
    private getSnippetForProperty;
    private getSnippetForArrayItem;
    private getDefaultSnippetBodyText;
    private promptForName;
    private promptForConfiguration;
    private promptForValue;
    private canPromptForProperty;
    private getDescriptionPlaintext;
    private promptForArray;
    private promptForEnum;
    private promptForInput;
    private encodeSecretKey;
    private decodeSecretKey;
    private _clearModelCache;
    private _clearModelConfigurations;
    private _resolveConfiguration;
    private _resolveLanguageModelProviderGroup;
    private _deleteSecretsInConfiguration;
    migrateLanguageModelsProviderGroup(languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<void>;
    private _readRecentlyUsedModels;
    private _saveRecentlyUsedModels;
    getRecentlyUsedModelIds(): string[];
    addToRecentlyUsedList(modelIdentifier: string): void;
    clearRecentlyUsedList(): void;
    private _readPinnedModels;
    private _savePinnedModels;
    getPinnedModelIds(): string[];
    pinModel(modelIdentifier: string): void;
    unpinModel(modelIdentifier: string): void;
    isModelPinned(modelIdentifier: string): boolean;
    private _getGroupNameForVendor;
    private _getModelIdsInGroup;
    private _readVisibility;
    private _saveVisibility;
    isGroupHidden(vendor: string, groupName: string): boolean;
    isModelHidden(modelIdentifier: string): boolean;
    setGroupHidden(vendor: string, groupName: string, hidden: boolean): void;
    setModelHidden(modelIdentifier: string, hidden: boolean): void;
    getHiddenModelIds(): string[];
    getModelsControlManifest(): IModelsControlManifest;
    private _setModelsControlManifest;
    private _refreshModelsControlManifest;
    private _initChatControlData;
    private _refreshChatControlData;
    private _fetchChatControlData;
    dispose(): void;
}
export {};
