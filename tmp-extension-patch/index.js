
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { IFileService } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service';
import { ILifecycleService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle.service';
import { IExtensionService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service';
import { ILogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service';
import '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import { IWorkspaceContextService } from '@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service';
import { IInstantiationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation';
import { INotificationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service';
import { DeltaExtensionsQueueItem } from './vscode/src/vs/workbench/services/extensions/common/abstractExtensionService.js';
import { ITelemetryService } from '@codingame/monaco-vscode-api/vscode/vs/platform/telemetry/common/telemetry.service';
import { IDialogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service';
import { IRemoteAuthorityResolverService } from '@codingame/monaco-vscode-api/vscode/vs/platform/remote/common/remoteAuthorityResolver.service';
import { IRemoteExtensionsScannerService } from '@codingame/monaco-vscode-api/vscode/vs/platform/remote/common/remoteExtensionsScanner.service';
import { IRemoteAgentService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/remote/common/remoteAgentService.service';
import { IWorkbenchExtensionEnablementService, IWorkbenchExtensionManagementService, IWebExtensionsScannerService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensionManagement/common/extensionManagement.service';
import { ExtensionManifestPropertiesService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensionManifestPropertiesService';
import { IExtensionManifestPropertiesService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensionManifestPropertiesService.service';
import { IConfigurationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service';
import { IProductService } from '@codingame/monaco-vscode-api/vscode/vs/platform/product/common/productService.service';
import { IBrowserWorkbenchEnvironmentService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/environment/browser/environmentService.service';
import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors';
import { IUserDataInitializationService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/userData/browser/userDataInit.service';
import { ExtensionsProposedApi } from './vscode/src/vs/workbench/services/extensions/common/extensionsProposedApi.js';
import { ExtensionService } from './vscode/src/vs/workbench/services/extensions/browser/extensionService.js';
import './vscode/src/vs/workbench/services/extensions/common/extensionRunningLocationTracker.js';
import '@codingame/monaco-vscode-api/vscode/vs/base/common/charCode';
import '@codingame/monaco-vscode-api/vscode/vs/base/common/marshallingIds';
import '@codingame/monaco-vscode-api/vscode/vs/base/common/path';
import { language } from '@codingame/monaco-vscode-api/vscode/vs/base/common/platform';
import { IUserDataProfileService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/userDataProfile/common/userDataProfile.service';
import { IWorkspaceTrustManagementService } from '@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspaceTrust.service';
import { IRemoteExplorerService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/remote/common/remoteExplorerService.service';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { ExtensionResourceLoaderService } from './vscode/src/vs/platform/extensionResourceLoader/browser/extensionResourceLoaderService.js';
import { IExtensionResourceLoaderService } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service';
import { CustomSchemas } from '@codingame/monaco-vscode-files-service-override';
import { getBuiltinExtensions } from '@codingame/monaco-vscode-api/extensions';
import { WebExtensionsScannerService } from './vscode/src/vs/workbench/services/extensionManagement/browser/webExtensionsScannerService.js';
import { IBuiltinExtensionsScannerService } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions.service';
import { ExtensionManifestTranslator } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionsScannerService';
import { getBuiltInExtensionTranslationsUris } from '@codingame/monaco-vscode-api/l10n';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/colorExtensionPoint';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/iconExtensionPoint';
import '@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/tokenClassificationExtensionPoint';
class DisabledExtensionHostFactory {
    createExtensionHost() {
        return null;
    }
}

class DisabledExtensionHostKindPicker {
    pickExtensionHostKind() {
        return null;
    }
}
let ExtensionServiceOverride = class ExtensionServiceOverride extends ExtensionService {
    constructor(_enableWorkerExtensionHost, instantiationService, notificationService, browserEnvironmentService, telemetryService, extensionEnablementService, fileService, productService, extensionManagementService, contextService, configurationService, extensionManifestPropertiesService, webExtensionsScannerService, logService, remoteAgentService, remoteExtensionsScannerService, lifecycleService, remoteAuthorityResolverService, userDataInitializationService, userDataProfileService, workspaceTrustManagementService, remoteExplorerService, dialogService) {
        const extensionsProposedApi = instantiationService.createInstance(ExtensionsProposedApi);
        super({ hasLocalProcess: false, allowRemoteExtensionsInLocalWebWorker: false }, extensionsProposedApi, new DisabledExtensionHostFactory(), new DisabledExtensionHostKindPicker(), instantiationService, notificationService, browserEnvironmentService, telemetryService, extensionEnablementService, fileService, productService, extensionManagementService, contextService, configurationService, extensionManifestPropertiesService, webExtensionsScannerService, logService, remoteAgentService, remoteExtensionsScannerService, lifecycleService, remoteAuthorityResolverService, userDataInitializationService, userDataProfileService, workspaceTrustManagementService, remoteExplorerService, dialogService);
    }
    async deltaExtensions(toAdd, toRemove) {
        await this._handleDeltaExtensions(new DeltaExtensionsQueueItem(toAdd, toRemove));
    }
};
ExtensionServiceOverride = __decorate([
    __param(1, IInstantiationService),
    __param(2, INotificationService),
    __param(3, IBrowserWorkbenchEnvironmentService),
    __param(4, ITelemetryService),
    __param(5, IWorkbenchExtensionEnablementService),
    __param(6, IFileService),
    __param(7, IProductService),
    __param(8, IWorkbenchExtensionManagementService),
    __param(9, IWorkspaceContextService),
    __param(10, IConfigurationService),
    __param(11, IExtensionManifestPropertiesService),
    __param(12, IWebExtensionsScannerService),
    __param(13, ILogService),
    __param(14, IRemoteAgentService),
    __param(15, IRemoteExtensionsScannerService),
    __param(16, ILifecycleService),
    __param(17, IRemoteAuthorityResolverService),
    __param(18, IUserDataInitializationService),
    __param(19, IUserDataProfileService),
    __param(20, IWorkspaceTrustManagementService),
    __param(21, IRemoteExplorerService),
    __param(22, IDialogService)
], ExtensionServiceOverride);
class ExtensionResourceLoaderServiceOverride extends ExtensionResourceLoaderService {
    async readExtensionResource(uri) {
        if (uri.scheme === CustomSchemas.extensionFile) {
            const result = await this._fileService.readFile(uri);
            return result.value.toString();
        }
        return await super.readExtensionResource(uri);
    }
}
let CustomBuiltinExtensionsScannerService = class CustomBuiltinExtensionsScannerService extends ExtensionManifestTranslator {
    constructor(fileService, extensionResourceLoaderService, logService) {
        super(extensionResourceLoaderService, fileService, logService);
        this.builtinExtensionsPromises = [];
        const nlsConfiguration = {
            devMode: false,
            language: language,
            pseudo: language === 'pseudo',
            translations: getBuiltInExtensionTranslationsUris(language) ?? {}
        };
        this.builtinExtensionsPromises = getBuiltinExtensions().map(async (e) => {
            return {
                ...e,
                manifest: await this.translateManifest(e.location, e.manifest, nlsConfiguration)
            };
        });
    }
    async scanBuiltinExtensions() {
        return [...(await Promise.all(this.builtinExtensionsPromises))];
    }
};
CustomBuiltinExtensionsScannerService = __decorate([
    __param(0, IFileService),
    __param(1, IExtensionResourceLoaderService),
    __param(2, ILogService)
], CustomBuiltinExtensionsScannerService);
function getServiceOverride() {
    return {
        [IExtensionService.toString()]: new SyncDescriptor(ExtensionServiceOverride, [false], false),
        [IExtensionManifestPropertiesService.toString()]: new SyncDescriptor(ExtensionManifestPropertiesService, [], true),
        [IExtensionResourceLoaderService.toString()]: new SyncDescriptor(ExtensionResourceLoaderServiceOverride, [], true),
        [IWebExtensionsScannerService.toString()]: new SyncDescriptor(WebExtensionsScannerService, [], true),
        [IBuiltinExtensionsScannerService.toString()]: new SyncDescriptor(CustomBuiltinExtensionsScannerService, [], true)
    };
}

export { CustomBuiltinExtensionsScannerService, ExtensionServiceOverride, getServiceOverride as default };
