
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { Disposable, toDisposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import '../../../../base/common/observableInternal/index.js';
import { rejectIfNotCanceled, timeout } from '../../../../base/common/async.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../common/services/model.service.js';
import { DiffEditorOptions } from '../diffEditor/diffEditorOptions.js';
import { DiffEditorViewModel } from '../diffEditor/diffEditorViewModel.js';
import { RefCounted } from '../diffEditor/utils.js';
import { cancelOnDispose } from '../../../../base/common/cancellation.js';
import { waitForState } from '../../../../base/common/observableInternal/utils/utilsCancellation.js';
import { transaction } from '../../../../base/common/observableInternal/transaction.js';
import { derived } from '../../../../base/common/observableInternal/observables/derived.js';
import { derivedObservableWithWritableCache, mapObservableArrayCached } from '../../../../base/common/observableInternal/utils/utils.js';
import { observableFromValueWithChangeEvent } from '../../../../base/common/observableInternal/utils/valueWithChangeEvent.js';
import { ObservablePromise, ObservableResolvedPromise } from '../../../../base/common/observableInternal/utils/promise.js';
import { observableValue } from '../../../../base/common/observableInternal/observables/observableValue.js';
import { constObservable } from '../../../../base/common/observableInternal/observables/constObservable.js';

class MultiDiffEditorViewModel extends Disposable {
    async waitForDiffOr1s() {
        if (this._documents.get() === "loading") {
            await waitForState(this._documents, documents => documents !== "loading");
        }
        await this._waitForNewDiffs.get().promise;
    }
    collapseAll() {
        transaction(tx => {
            for (const d of this.items.get()) {
                d.collapsed.set(true, tx);
            }
        });
    }
    expandAll() {
        transaction(tx => {
            for (const d of this.items.get()) {
                d.collapsed.set(false, tx);
            }
        });
    }
    collapse(item) {
        transaction(tx => {
            item.collapsed.set(true, tx);
        });
    }
    expand(item) {
        transaction(tx => {
            item.collapsed.set(false, tx);
        });
    }
    get contextKeys() {
        return this.model.contextKeys;
    }
    constructor(model, _instantiationService) {
        super();
        this.model = model;
        this._instantiationService = _instantiationService;
        this._documentsArr = derived(this, reader => {
            const result = this._documents.read(reader);
            if (result === "loading") {
                return [];
            }
            return result;
        });
        this.focusedDiffItem = derived(
            this,
            reader => this.items.read(reader).find(i => i.isFocused.read(reader))
        );
        this.activeDiffItem = derivedObservableWithWritableCache(
            this,
            (reader, lastValue) => this.focusedDiffItem.read(reader) ?? (lastValue && this.items.read(reader).indexOf(lastValue) !== -1) ? lastValue : undefined
        );
        this._documents = observableFromValueWithChangeEvent(this.model, this.model.documents);
        const allItems = mapObservableArrayCached(this, this._documentsArr, (d, store) => store.add(RefCounted.create(
            this._instantiationService.createInstance(DocumentDiffItemViewModel, d, this)
        ))).recomputeInitiallyAndOnChange(this._store);
        this._waitForNewDiffs = derived(this, reader => {
            const next = allItems.read(reader);
            const unresolved = next.filter(i => !i.object.waitForInitialDiffOr1s.promiseResult.read(undefined));
            if (unresolved.length === 0) {
                return ObservablePromise.resolved(next);
            }
            return ( new ObservablePromise(Promise.all(( unresolved.map(i => i.object.waitForInitialDiffOr1s.promise))).then(() => next)));
        });
        const resolved = ( new ObservableResolvedPromise(this._waitForNewDiffs, [], this._store));
        this.items = derived(this, reader => {
            const resolvedItems = resolved.lastResolved.read(reader);
            return ( resolvedItems.map(i => {
                const ref = reader.store.add(i.createNewRef(i));
                return ref.object;
            }));
        });
        this.isLoading = derived(
            this,
            reader => this._documents.read(reader) === "loading" || resolved.isResolving.read(reader)
        );
    }
}
let DocumentDiffItemViewModel = class DocumentDiffItemViewModel extends Disposable {
    get diffEditorViewModel() {
        return this.diffEditorViewModelRef.object;
    }
    get originalUri() {
        return this.documentDiffItem.original?.uri;
    }
    get modifiedUri() {
        return this.documentDiffItem.modified?.uri;
    }
    setIsFocused(source, tx) {
        this._isFocusedSource.set(source, tx);
    }
    get documentDiffItem() {
        return this._documentDiffItemRef.object;
    }
    constructor(documentDiffItem, _editorViewModel, _instantiationService, _modelService) {
        super();
        this._editorViewModel = _editorViewModel;
        this._instantiationService = _instantiationService;
        this._modelService = _modelService;
        this.collapsed = observableValue(this, false);
        this.lastTemplateData = observableValue(this, {
            contentHeight: 500,
            selections: undefined
        });
        this.isActive = derived(this, reader => this._editorViewModel.activeDiffItem.read(reader) === this);
        this._isFocusedSource = observableValue(this, constObservable(false));
        this.isFocused = derived(this, reader => this._isFocusedSource.read(reader).read(reader));
        this.isAlive = observableValue(this, true);
        this._register(toDisposable(() => {
            this.isAlive.set(false, undefined);
        }));
        this._documentDiffItemRef = this._register(documentDiffItem.createNewRef(this));
        function updateOptions(options) {
            return {
                ...options,
                hideUnchangedRegions: {
                    enabled: true
                }
            };
        }
        const options = this._instantiationService.createInstance(DiffEditorOptions, updateOptions(this.documentDiffItem.options || {}));
        if (this.documentDiffItem.onOptionsDidChange) {
            this._register(this.documentDiffItem.onOptionsDidChange(() => {
                options.updateOptions(updateOptions(this.documentDiffItem.options || {}));
            }));
        }
        const diffEditorViewModelStore = ( new DisposableStore());
        const originalTextModel = this.documentDiffItem.original ?? diffEditorViewModelStore.add(this._modelService.createModel("", null));
        const modifiedTextModel = this.documentDiffItem.modified ?? diffEditorViewModelStore.add(this._modelService.createModel("", null));
        diffEditorViewModelStore.add(this._documentDiffItemRef.createNewRef(this));
        this.diffEditorViewModelRef = this._register(
            RefCounted.createWithDisposable(this._instantiationService.createInstance(DiffEditorViewModel, {
                original: originalTextModel,
                modified: modifiedTextModel
            }, options), diffEditorViewModelStore, this)
        );
        this.waitForInitialDiffOr1s = ( new ObservablePromise(Promise.race([
            this.diffEditorViewModel.waitForDiff().catch(rejectIfNotCanceled),
            timeout(1000, cancelOnDispose(this._store)).catch(rejectIfNotCanceled)
        ])));
    }
    getKey() {
        return JSON.stringify([this.originalUri?.toString(), this.modifiedUri?.toString()]);
    }
};
DocumentDiffItemViewModel = ( __decorate([( __param(2, IInstantiationService)), ( __param(3, IModelService))], DocumentDiffItemViewModel));

export { DocumentDiffItemViewModel, MultiDiffEditorViewModel };
