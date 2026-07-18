
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { IEditorWorkerService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/editorWorker.service';
import { MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';

let MainThreadDocumentDiff = class MainThreadDocumentDiff {
    constructor(_extHostContext, _editorWorkerService) {
        this._editorWorkerService = _editorWorkerService;
    }
    async $computeDocumentDiff(
        originalUri,
        modifiedUri,
        ignoreTrimWhitespace,
        maxComputationTimeMs,
        computeMoves
    ) {
        const original = URI.revive(originalUri);
        const modified = URI.revive(modifiedUri);
        const result = await this._editorWorkerService.computeDiff(original, modified, {
            ignoreTrimWhitespace,
            maxComputationTimeMs,
            computeMoves
        }, "advanced");
        if (!result) {
            return null;
        }
        const toLineRange = r => ({
            startLineNumber: r.startLineNumber,
            startColumn: 1,
            endLineNumber: r.endLineNumberExclusive,
            endColumn: 1
        });
        const mapChange = c => ({
            originalRange: toLineRange(c.original),
            modifiedRange: toLineRange(c.modified),
            innerChanges: c.innerChanges?.map(ic => ({
                originalRange: ic.originalRange,
                modifiedRange: ic.modifiedRange
            }))
        });
        return {
            identical: result.identical,
            quitEarly: result.quitEarly,
            changes: ( result.changes.map(mapChange)),
            moves: ( result.moves.map(m => ({
                originalRange: toLineRange(m.lineRangeMapping.original),
                modifiedRange: toLineRange(m.lineRangeMapping.modified),
                changes: ( m.changes.map(mapChange))
            })))
        };
    }
    dispose() {}
};
MainThreadDocumentDiff = __decorate([extHostNamedCustomer(MainContext.MainThreadDocumentDiff), ( __param(1, IEditorWorkerService))], MainThreadDocumentDiff);

export { MainThreadDocumentDiff };
