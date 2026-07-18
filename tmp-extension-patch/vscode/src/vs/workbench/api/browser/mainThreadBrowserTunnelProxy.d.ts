import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { ITunnelProxyInfo } from "@codingame/monaco-vscode-api/vscode/vs/platform/tunnel/common/tunnelProxy";
import { IBrowserViewWorkbenchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/browserView/common/browserView.service";
import { IWorkbenchEnvironmentService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/environment/common/environmentService.service";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
import { MainThreadBrowserTunnelProxyShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
/**
 * Renderer-side bridge for the local extension host tunnel proxy. Gates the
 * ext host proxy by the remote-proxy setting (and the presence of a remote
 * authority) and forwards the resolved proxy info to the main process so it
 * can be applied to the window's remote browser view Electron sessions.
 */
export declare class MainThreadBrowserTunnelProxy extends Disposable implements MainThreadBrowserTunnelProxyShape {
    private readonly _configurationService;
    private readonly _environmentService;
    private readonly _browserViewWorkbenchService;
    private readonly _proxy;
    constructor(extHostContext: IExtHostContext, _configurationService: IConfigurationService, _environmentService: IWorkbenchEnvironmentService, _browserViewWorkbenchService: IBrowserViewWorkbenchService);
    private _isEnabled;
    private _updateEnabled;
    $updateProxyInfo(info: ITunnelProxyInfo | undefined): void;
}
