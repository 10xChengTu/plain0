
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { IConfigurationService } from '@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service';
import { IBrowserViewWorkbenchService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/browserView/common/browserView.service';
import { IWorkbenchEnvironmentService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/environment/common/environmentService.service';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';

const browserRemoteProxyEnabledSettingId = "workbench.browser.enableRemoteProxy";
let MainThreadBrowserTunnelProxy = class MainThreadBrowserTunnelProxy extends Disposable {
    constructor(
        extHostContext,
        _configurationService,
        _environmentService,
        _browserViewWorkbenchService
    ) {
        super();
        this._configurationService = _configurationService;
        this._environmentService = _environmentService;
        this._browserViewWorkbenchService = _browserViewWorkbenchService;
        this._proxy = ( extHostContext.getProxy(ExtHostContext.ExtHostBrowserTunnelProxy));
        this._updateEnabled();
        this._register(this._configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(browserRemoteProxyEnabledSettingId)) {
                this._updateEnabled();
            }
        }));
    }
    _isEnabled() {
        return !!this._environmentService.remoteAuthority && this._configurationService.getValue(browserRemoteProxyEnabledSettingId) === true;
    }
    _updateEnabled() {
        this._proxy.$setEnabled(this._isEnabled());
    }
    $updateProxyInfo(info) {
        this._browserViewWorkbenchService.setRemoteProxyInfo(info);
    }
};
MainThreadBrowserTunnelProxy = __decorate([
    extHostNamedCustomer(MainContext.MainThreadBrowserTunnelProxy),
    ( __param(1, IConfigurationService)),
    ( __param(2, IWorkbenchEnvironmentService)),
    ( __param(3, IBrowserViewWorkbenchService))
], MainThreadBrowserTunnelProxy);

export { MainThreadBrowserTunnelProxy };
