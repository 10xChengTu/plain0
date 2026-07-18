
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { ChatContextKeys } from './actions/chatContextKeys.js';
import { COPILOT_VENDOR_ID } from './languageModels.js';

const SELECTED_MODEL_STORAGE_KEY_PREFIX = 'chat.currentLanguageModel.';
function getSelectedModelStorageKey(location, sessionType) {
    if (sessionType) {
        return `${SELECTED_MODEL_STORAGE_KEY_PREFIX}${location}.${sessionType}`;
    }
    return `${SELECTED_MODEL_STORAGE_KEY_PREFIX}${location}`;
}
function getSelectedModelIdentifier(contextKeyService, storageService) {
    const contextKeyModelId = contextKeyService.getContextKeyValue(ChatContextKeys.chatModelId.key);
    if (contextKeyModelId) {
        return contextKeyModelId;
    }
    return getPersistedSelectedModelIdentifier(contextKeyService, storageService);
}
function getPersistedSelectedModelIdentifier(contextKeyService, storageService) {
    const location = contextKeyService.getContextKeyValue(ChatContextKeys.location.key) ?? 'panel';
    const sessionType = contextKeyService.getContextKeyValue(ChatContextKeys.chatSessionType.key) ?? '';
    const candidateKeys = sessionType
        ? [getSelectedModelStorageKey(location, sessionType), getSelectedModelStorageKey(location)]
        : [getSelectedModelStorageKey(location)];
    for (const key of candidateKeys) {
        const persisted = storageService.get(key, StorageScope.APPLICATION);
        if (persisted) {
            return persisted;
        }
    }
    return undefined;
}
function getSelectedModelMetadata(contextKeyService, storageService, languageModelsService) {
    const modelId = getSelectedModelIdentifier(contextKeyService, storageService);
    if (!modelId) {
        return undefined;
    }
    const direct = languageModelsService.lookupLanguageModel(modelId);
    if (direct) {
        return direct;
    }
    const persistedId = getPersistedSelectedModelIdentifier(contextKeyService, storageService);
    if (persistedId && persistedId !== modelId) {
        return languageModelsService.lookupLanguageModel(persistedId);
    }
    return undefined;
}
function getSelectedModelVendor(contextKeyService, storageService, languageModelsService) {
    const metadata = getSelectedModelMetadata(contextKeyService, storageService, languageModelsService);
    if (metadata) {
        return metadata.vendor;
    }
    const modelId = getSelectedModelIdentifier(contextKeyService, storageService);
    if (modelId?.includes('/')) {
        return modelId.split('/')[0];
    }
    return undefined;
}
function isByokModel(metadata) {
    return metadata.isBYOK === true;
}
function isSelectedModelCopilot(contextKeyService, storageService, languageModelsService) {
    const metadata = getSelectedModelMetadata(contextKeyService, storageService, languageModelsService);
    if (metadata) {
        return !isByokModel(metadata);
    }
    const vendor = getSelectedModelVendor(contextKeyService, storageService, languageModelsService);
    if (!vendor) {
        return true;
    }
    return vendor === COPILOT_VENDOR_ID;
}

export { SELECTED_MODEL_STORAGE_KEY_PREFIX, getPersistedSelectedModelIdentifier, getSelectedModelIdentifier, getSelectedModelMetadata, getSelectedModelStorageKey, getSelectedModelVendor, isByokModel, isSelectedModelCopilot };
