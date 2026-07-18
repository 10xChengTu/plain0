import { IContextKeyService } from "../../../../platform/contextkey/common/contextkey.service.js";
import { IStorageService } from "../../../../platform/storage/common/storage.service.js";
import { ILanguageModelChatMetadata } from "./languageModels.js";
import { ILanguageModelsService } from "./languageModels.service.js";
/**
 * Storage key prefix for persisted model selections.
 * Full key format: `chat.currentLanguageModel.{location}[.{sessionType}]`
 */
export declare const SELECTED_MODEL_STORAGE_KEY_PREFIX = "chat.currentLanguageModel.";
/**
 * Builds the storage key used to persist the selected language model for a
 * given chat location and optional session type.
 *
 * Matches the keys written by `chatInputPart.ts` so that other consumers
 * can read the persisted model selection without depending on widget internals.
 */
export declare function getSelectedModelStorageKey(location: string, sessionType?: string): string;
/**
 * Resolves the currently selected chat model identifier using a two-step
 * strategy:
 *
 * 1. Read the `chatModelId` context key (set when a chat widget is active).
 * 2. Fall back to the persisted storage value written by `chatInputPart`.
 *
 * Returns the raw model identifier string (may include a vendor prefix like
 * `"copilot/gpt-4.1"` from storage, or a short id like `"gpt-4.1"` from
 * the context key), or `undefined` if no selection is available.
 */
export declare function getSelectedModelIdentifier(contextKeyService: IContextKeyService, storageService: IStorageService): string | undefined;
/**
 * Reads the persisted, fully-qualified model identifier written by
 * `chatInputPart` (e.g. `"copilot/gpt-4.1"` or `"customendpoint/ANT/gpt-4.1"`).
 *
 * Unlike the `chatModelId` context key (which holds only the short, lower-cased
 * model id), the persisted identifier carries the vendor and therefore
 * disambiguates the same model served via BYOK vs CAPI. Returns `undefined`
 * when no selection has been persisted.
 */
export declare function getPersistedSelectedModelIdentifier(contextKeyService: IContextKeyService, storageService: IStorageService): string | undefined;
/**
 * Resolves the registered metadata of the currently selected chat model.
 *
 * The selected identifier may be a fully-qualified id (e.g. `"copilot/gpt-4.1"`
 * from persisted storage) or a short, lower-cased model id (e.g. `"gpt-4.1"`
 * from the `chatModelId` context key, which is set to `metadata.id`). The short
 * id cannot disambiguate the same model served via BYOK vs CAPI, so when a
 * direct registry lookup fails we fall back to the persisted, fully-qualified
 * identifier (which carries the vendor) rather than matching on the short id.
 *
 * Returns `undefined` when no model is selected or the selection cannot be
 * resolved to a registered model (e.g. the provider has not been activated
 * yet); callers that only need the vendor can fall back to
 * {@link getSelectedModelVendor}.
 */
export declare function getSelectedModelMetadata(contextKeyService: IContextKeyService, storageService: IStorageService, languageModelsService: ILanguageModelsService): ILanguageModelChatMetadata | undefined;
/**
 * Resolves the vendor of the currently selected chat model.
 *
 * Tries the language model registry first (authoritative when models are
 * registered), then falls back to extracting the vendor prefix from the
 * persisted model identifier (e.g. `"copilot/gpt-4.1"` → `"copilot"`).
 *
 * Returns `undefined` if no model selection is available.
 */
export declare function getSelectedModelVendor(contextKeyService: IContextKeyService, storageService: IStorageService, languageModelsService: ILanguageModelsService): string | undefined;
/**
 * Returns whether the given model is a "bring your own key" (BYOK) model.
 *
 * BYOK models are served using user-supplied credentials and are flagged as
 * such by their provider via {@link ILanguageModelChatMetadata.isBYOK}. All
 * other models (built-in Copilot, Copilot/Claude CLI, and agent-host models)
 * are served through the Copilot (CAPI) service and are therefore not BYOK.
 */
export declare function isByokModel(metadata: ILanguageModelChatMetadata): boolean;
/**
 * Returns whether the currently selected chat model is a Copilot model
 * (i.e. not BYOK).
 *
 * When the selection resolves to registered metadata this is the inverse of
 * {@link isByokModel}, so agent-host (CAPI-backed) models count as Copilot.
 * When no model is selected yet (widget not initialized) this returns `true`
 * so quota-style surfaces treat the unknown case as Copilot. As a last
 * resort, an unregistered selection is classified by its vendor prefix.
 */
export declare function isSelectedModelCopilot(contextKeyService: IContextKeyService, storageService: IStorageService, languageModelsService: ILanguageModelsService): boolean;
