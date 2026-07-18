
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import '../../../../base/common/observableInternal/index.js';
import { observableMemento } from '../../../../platform/observable/common/observableMemento.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IStorageService } from '../../../../platform/storage/common/storage.service.js';
import { transaction } from '../../../../base/common/observableInternal/transaction.js';

var ContributionEnablementState;
(function(ContributionEnablementState) {
    ContributionEnablementState[ContributionEnablementState["DisabledProfile"] = 0] = "DisabledProfile";
    ContributionEnablementState[ContributionEnablementState["DisabledWorkspace"] = 1] = "DisabledWorkspace";
    ContributionEnablementState[ContributionEnablementState["EnabledProfile"] = 2] = "EnabledProfile";
    ContributionEnablementState[ContributionEnablementState["EnabledWorkspace"] = 3] = "EnabledWorkspace";
})(ContributionEnablementState || (ContributionEnablementState = {}));
function isContributionEnabled(state) {
    return state === ContributionEnablementState.EnabledProfile || state === ContributionEnablementState.EnabledWorkspace;
}
function isContributionDisabled(state) {
    return !isContributionEnabled(state);
}
function mapToStorage(value) {
    return JSON.stringify([...value]);
}
function mapFromStorage(value) {
    const parsed = JSON.parse(value);
    return ( new Map(Array.isArray(parsed) ? parsed : []));
}
let EnablementModel = class EnablementModel extends Disposable {
    constructor(storageKey, storageService) {
        super();
        const mapMemento = observableMemento({
            key: storageKey,
            defaultValue: ( new Map()),
            toStorage: mapToStorage,
            fromStorage: mapFromStorage
        });
        this._profileState = this._register(mapMemento(StorageScope.PROFILE, StorageTarget.MACHINE, storageService));
        this._workspaceState = this._register(mapMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE, storageService));
    }
    readEnabled(key, reader) {
        const wsMap = this._workspaceState.read(reader);
        if (( wsMap.has(key))) {
            return wsMap.get(key) ? ContributionEnablementState.EnabledWorkspace : ContributionEnablementState.DisabledWorkspace;
        }
        const profileMap = this._profileState.read(reader);
        if (( profileMap.has(key))) {
            return profileMap.get(key) ? ContributionEnablementState.EnabledProfile : ContributionEnablementState.DisabledProfile;
        }
        return ContributionEnablementState.EnabledProfile;
    }
    setEnabled(key, state, tx) {
        switch (state) {
        case ContributionEnablementState.EnabledProfile:
            {
                this._deleteFromMap(this._profileState, key, tx);
                this._deleteFromMap(this._workspaceState, key, tx);
                break;
            }
        case ContributionEnablementState.DisabledProfile:
            {
                this._setInMap(this._profileState, key, false, tx);
                this._deleteFromMap(this._workspaceState, key, tx);
                break;
            }
        case ContributionEnablementState.EnabledWorkspace:
            {
                this._setInMap(this._workspaceState, key, true, tx);
                break;
            }
        case ContributionEnablementState.DisabledWorkspace:
            {
                this._setInMap(this._workspaceState, key, false, tx);
                break;
            }
        }
    }
    remove(key) {
        this._deleteFromMap(this._profileState, key);
        this._deleteFromMap(this._workspaceState, key);
    }
    _setInMap(memento, key, value, tx) {
        const current = memento.get();
        if (current.get(key) === value) {
            return;
        }
        const next = ( new Map(current));
        next.set(key, value);
        memento.set(next, tx);
    }
    _deleteFromMap(memento, key, tx) {
        const current = memento.get();
        if (!( current.has(key))) {
            return;
        }
        const next = ( new Map(current));
        next.delete(key);
        memento.set(next, tx);
    }
};
EnablementModel = ( __decorate([( __param(1, IStorageService))], EnablementModel));
class CollisionEnablementModel {
    constructor(_base, _collisionGroups) {
        this._base = _base;
        this._collisionGroups = _collisionGroups;
    }
    readEnabled(key, reader) {
        const baseState = this._base.readEnabled(key, reader);
        if (!isContributionEnabled(baseState)) {
            return baseState;
        }
        const group = this._collisionGroups.read(reader).get(key);
        if (!group) {
            return baseState;
        }
        for (const otherId of group) {
            if (otherId === key) {
                return baseState;
            }
            if (isContributionEnabled(this._base.readEnabled(otherId, reader))) {
                return ContributionEnablementState.DisabledProfile;
            }
        }
        return baseState;
    }
    setEnabled(key, state, tx) {
        const isEnabling = state === ContributionEnablementState.EnabledProfile || state === ContributionEnablementState.EnabledWorkspace;
        const group = isEnabling ? this._collisionGroups.get().get(key) : undefined;
        if (!group) {
            this._base.setEnabled(key, state, tx);
            return;
        }
        const updateGroup = innerTx => {
            this._base.setEnabled(key, state, innerTx);
            for (const otherId of group) {
                if (otherId !== key) {
                    this._base.setEnabled(otherId, ContributionEnablementState.DisabledWorkspace, innerTx);
                }
            }
        };
        if (tx) {
            updateGroup(tx);
        } else {
            transaction(innerTx => updateGroup(innerTx));
        }
    }
    remove(key) {
        this._base.remove(key);
    }
}

export { CollisionEnablementModel, ContributionEnablementState, EnablementModel, isContributionDisabled, isContributionEnabled };
