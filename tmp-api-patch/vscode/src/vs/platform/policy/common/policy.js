
import { Emitter, Event } from '../../../base/common/event.js';
import { Iterable } from '../../../base/common/iterator.js';
import { Disposable } from '../../../base/common/lifecycle.js';

function toSerializablePolicyDefinition(definition) {
    return {
        type: definition.type,
        managedSettings: definition.managedSettings,
        restrictedValue: definition.restrictedValue
    };
}
class AbstractPolicyService extends Disposable {
    constructor() {
        super(...arguments);
        this.policyDefinitions = {};
        this.policies = ( new Map());
        this._onDidChange = this._register(( new Emitter()));
        this.onDidChange = this._onDidChange.event;
    }
    async updatePolicyDefinitions(policyDefinitions) {
        let changed = false;
        for (const name of ( Object.keys(policyDefinitions))) {
            if (this.policyDefinitions[name] !== policyDefinitions[name]) {
                this.policyDefinitions[name] = policyDefinitions[name];
                changed = true;
            }
        }
        if (changed) {
            await this._updatePolicyDefinitions(this.policyDefinitions);
        }
        return Iterable.reduce(this.policies.entries(), (r, [name, value]) => ({
            ...r,
            [name]: value
        }), {});
    }
    getPolicyValue(name) {
        return this.policies.get(name);
    }
    serialize() {
        return Iterable.reduce(Object.entries(this.policyDefinitions), (r, [name, definition]) => ({
            ...r,
            [name]: {
                definition: toSerializablePolicyDefinition(definition),
                value: this.policies.get(name)
            }
        }), {});
    }
}
class NullPolicyService {
    constructor() {
        this.onDidChange = Event.None;
        this.policyDefinitions = {};
    }
    async updatePolicyDefinitions() {
        return {};
    }
    getPolicyValue() {
        return undefined;
    }
    serialize() {
        return undefined;
    }
}

export { AbstractPolicyService, NullPolicyService, toSerializablePolicyDefinition };
