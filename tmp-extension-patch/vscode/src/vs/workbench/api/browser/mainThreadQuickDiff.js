
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { CancellationToken } from '@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation';
import { DisposableMap, DisposableStore } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { ExtHostContext, MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';
import { IQuickDiffService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/quickDiff.service';
import { IQuickDiffModelService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/browser/quickDiffModel.service';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';

let MainThreadQuickDiff = class MainThreadQuickDiff {
    constructor(extHostContext, quickDiffService, quickDiffModelService) {
        this.quickDiffService = quickDiffService;
        this.quickDiffModelService = quickDiffModelService;
        this.providerDisposables = ( new DisposableMap());
        this.informationDisposables = ( new DisposableMap());
        this.proxy = ( extHostContext.getProxy(ExtHostContext.ExtHostQuickDiff));
    }
    async $registerQuickDiffProvider(handle, selector, id, label, rootUri) {
        const provider = {
            id,
            label,
            rootUri: URI.revive(rootUri),
            selector,
            kind: "contributed",
            getOriginalResource: async uri => {
                return URI.revive(
                    await this.proxy.$provideOriginalResource(handle, uri, CancellationToken.None)
                );
            }
        };
        const disposable = this.quickDiffService.addQuickDiffProvider(provider);
        this.providerDisposables.set(handle, disposable);
    }
    async $unregisterQuickDiffProvider(handle) {
        if (( this.providerDisposables.has(handle))) {
            this.providerDisposables.deleteAndDispose(handle);
        }
    }
    async $createSourceControlDiffInformation(handle, uri) {
        const reference = this.quickDiffModelService.createQuickDiffModelReference(URI.revive(uri));
        if (!reference) {
            return;
        }
        const store = ( new DisposableStore());
        store.add(reference);
        store.add(
            reference.object.onDidChange(() => this.sendSourceControlDiffInformation(handle, reference))
        );
        this.informationDisposables.set(handle, store);
        this.sendSourceControlDiffInformation(handle, reference);
    }
    async $disposeSourceControlDiffInformation(handle) {
        if (( this.informationDisposables.has(handle))) {
            this.informationDisposables.deleteAndDispose(handle);
        }
    }
    sendSourceControlDiffInformation(handle, reference) {
        const model = reference.object;
        const primaryResult = model.getQuickDiffResults().find(result => result.providerKind === "primary");
        if (!primaryResult) {
            this.proxy.$acceptSourceControlDiffInformation(handle, undefined);
            return;
        }
        const changes = ( primaryResult.changes2.map(change => [
            change.original.startLineNumber,
            change.original.endLineNumberExclusive,
            change.modified.startLineNumber,
            change.modified.endLineNumberExclusive
        ]));
        const diffInformation = {
            documentVersion: model.changesVersionId,
            original: primaryResult.original,
            modified: primaryResult.modified,
            changes
        };
        this.proxy.$acceptSourceControlDiffInformation(handle, diffInformation);
    }
    dispose() {
        this.providerDisposables.dispose();
        this.informationDisposables.dispose();
    }
};
MainThreadQuickDiff = __decorate([extHostNamedCustomer(MainContext.MainThreadQuickDiff), ( __param(1, IQuickDiffService)), ( __param(2, IQuickDiffModelService))], MainThreadQuickDiff);

export { MainThreadQuickDiff };
