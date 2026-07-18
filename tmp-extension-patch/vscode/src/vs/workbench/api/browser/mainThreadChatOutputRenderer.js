
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { VSBuffer } from '@codingame/monaco-vscode-api/vscode/vs/base/common/buffer';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { ILogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service';
import { IChatOutputRendererService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/browser/chatOutputItemRenderer.service';
import { ExtHostContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';

let MainThreadChatOutputRenderer = class MainThreadChatOutputRenderer extends Disposable {
    constructor(extHostContext, _mainThreadWebview, _rendererService, _logService) {
        super();
        this._mainThreadWebview = _mainThreadWebview;
        this._rendererService = _rendererService;
        this._logService = _logService;
        this._webviewHandlePool = 0;
        this.registeredRenderers = ( new Map());
        this._proxy = ( extHostContext.getProxy(ExtHostContext.ExtHostChatOutputRenderer));
    }
    dispose() {
        super.dispose();
        this.registeredRenderers.forEach(disposable => disposable.dispose());
        this.registeredRenderers.clear();
    }
    $registerChatOutputRenderer(viewType, extensionId, extensionLocation) {
        const existingRegistration = this.registeredRenderers.get(viewType);
        if (existingRegistration) {
            this._logService.warn(
                `Re-registering chat output renderer for view type '${viewType}' from extension '${extensionId.value}'.`
            );
            existingRegistration.dispose();
        }
        const disposable = this._rendererService.registerRenderer(viewType, {
            renderOutputPart: async (mime, data, webview, context, token) => {
                const webviewHandle = `chat-output-${++this._webviewHandlePool}`;
                this._mainThreadWebview.addWebview(webviewHandle, webview, {
                    serializeBuffersForPostMessage: true
                });
                return this._proxy.$renderChatOutput(viewType, mime, VSBuffer.wrap(data), webviewHandle, context, token);
            }
        }, {
            extension: {
                id: extensionId,
                location: URI.revive(extensionLocation)
            }
        });
        this.registeredRenderers.set(viewType, disposable);
    }
    $unregisterChatOutputRenderer(viewType) {
        this.registeredRenderers.get(viewType)?.dispose();
        this.registeredRenderers.delete(viewType);
    }
};
MainThreadChatOutputRenderer = ( __decorate([( __param(2, IChatOutputRendererService)), ( __param(3, ILogService))], MainThreadChatOutputRenderer));

export { MainThreadChatOutputRenderer };
