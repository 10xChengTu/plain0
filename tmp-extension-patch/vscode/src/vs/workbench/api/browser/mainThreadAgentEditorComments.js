
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { DisposableMap, DisposableStore } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { IAgentEditorCommentsBridge } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/agentEditorComments/common/agentEditorComments.service';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';

let MainThreadAgentEditorComments = class MainThreadAgentEditorComments {
    constructor(extHostContext, _bridge) {
        this._bridge = _bridge;
        this._resources = ( new Map());
        this._disposables = ( new DisposableMap());
        this._proxy = ( extHostContext.getProxy(ExtHostContext.ExtHostAgentEditorComments));
    }
    async $createAgentEditorComments(handle, uri) {
        const resource = URI.revive(uri);
        this._resources.set(handle, resource);
        const store = ( new DisposableStore());
        store.add(this._bridge.onDidChangeComments(() => this._sendComments(handle)));
        this._disposables.set(handle, store);
        this._sendComments(handle);
    }
    async $addComment(handle, range, body) {
        const resource = this._resources.get(handle);
        if (!resource) {
            return;
        }
        this._bridge.addComment(resource, range, body);
    }
    async $disposeAgentEditorComments(handle) {
        this._resources.delete(handle);
        this._disposables.deleteAndDispose(handle);
    }
    _sendComments(handle) {
        const resource = this._resources.get(handle);
        if (!resource) {
            return;
        }
        const comments = ( this._bridge.getComments(resource).map(comment => ({
            id: comment.id,
            range: comment.range,
            body: comment.body
        })));
        this._proxy.$acceptAgentEditorComments(handle, comments);
    }
    dispose() {
        this._disposables.dispose();
        this._resources.clear();
    }
};
MainThreadAgentEditorComments = __decorate([
    extHostNamedCustomer(MainContext.MainThreadAgentEditorComments),
    ( __param(1, IAgentEditorCommentsBridge))
], MainThreadAgentEditorComments);

export { MainThreadAgentEditorComments };
