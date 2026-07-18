
import { Codicon } from '../../../base/common/codicons.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';

var PermissionCategory;
(function(PermissionCategory) {
    PermissionCategory["Location"] = "location";
    PermissionCategory["Camera"] = "camera";
    PermissionCategory["Microphone"] = "microphone";
    PermissionCategory["Notifications"] = "notifications";
    PermissionCategory["Sensors"] = "sensors";
    PermissionCategory["Clipboard"] = "clipboard";
    PermissionCategory["Devices"] = "devices";
})(PermissionCategory || (PermissionCategory = {}));
const PERMISSION_CATEGORY_DESCRIPTORS = {
    [PermissionCategory.Location]: {
        category: PermissionCategory.Location,
        label: ( localize(1933, "Location")),
        description: ( localize(1934, "Access this device's geographic location")),
        icon: Codicon.location,
        permissions: ["geolocation", "geolocation-approximate"],
        defaultState: "ask"
    },
    [PermissionCategory.Camera]: {
        category: PermissionCategory.Camera,
        label: ( localize(1935, "Camera")),
        description: ( localize(1936, "Capture video from cameras")),
        icon: Codicon.deviceCamera,
        permissions: ["media"],
        defaultState: "ask"
    },
    [PermissionCategory.Microphone]: {
        category: PermissionCategory.Microphone,
        label: ( localize(1937, "Microphone")),
        description: ( localize(1938, "Capture audio from microphones")),
        icon: Codicon.mic,
        permissions: ["media"],
        defaultState: "ask"
    },
    [PermissionCategory.Sensors]: {
        category: PermissionCategory.Sensors,
        label: ( localize(1939, "Sensors")),
        description: ( localize(1940, "Read motion and environmental sensors")),
        icon: Codicon.pulse,
        permissions: ["sensors"],
        defaultState: "allow"
    },
    [PermissionCategory.Clipboard]: {
        category: PermissionCategory.Clipboard,
        label: ( localize(1941, "Clipboard")),
        description: ( localize(1942, "Read from and write to the system clipboard")),
        icon: Codicon.clippy,
        permissions: ["clipboard-read"],
        defaultState: "ask"
    },
    [PermissionCategory.Notifications]: {
        category: PermissionCategory.Notifications,
        label: ( localize(1943, "Notifications")),
        description: ( localize(1944, "Display desktop notifications")),
        icon: Codicon.bell,
        permissions: ["notifications"],
        defaultState: "ask"
    },
    [PermissionCategory.Devices]: {
        category: PermissionCategory.Devices,
        label: ( localize(1945, "Devices")),
        description: ( localize(1946, "Request access to USB, serial, HID, and Bluetooth devices")),
        icon: Codicon.plug,
        permissions: ["usb", "serial", "hid"],
        defaultState: "allow"
    }
};
const ALL_PERMISSION_CATEGORIES = ( Object.keys(PERMISSION_CATEGORY_DESCRIPTORS));
const DEFAULT_PERMISSION_STATES = ( Object.freeze(Object.fromEntries(( ALL_PERMISSION_CATEGORIES.map(
    category => [category, PERMISSION_CATEGORY_DESCRIPTORS[category].defaultState]
)))));
(() => {
    const map = ( new Map());
    for (const category of ALL_PERMISSION_CATEGORIES) {
        for (const permission of PERMISSION_CATEGORY_DESCRIPTORS[category].permissions) {
            if (permission === "media") {
                continue;
            }
            const existing = map.get(permission);
            if (existing) {
                existing.push(category);
            } else {
                map.set(permission, [category]);
            }
        }
    }
    return map;
})();
function toOriginKey(url) {
    const trimmed = url?.trim();
    if (!trimmed || trimmed === "null") {
        return "";
    }
    try {
        const parsed = ( new URL(trimmed));
        if (!parsed.host) {
            return `${parsed.protocol}//${parsed.pathname}`;
        }
        return parsed.origin;
    } catch {
        return trimmed;
    }
}
const VALID_CATEGORIES = ( new Set(ALL_PERMISSION_CATEGORIES));
class BrowserPermissionStore extends Disposable {
    constructor() {
        super(...arguments);
        this._data = ( new Map());
        this._onDidChange = this._register(( new Emitter()));
        this.onDidChange = this._onDidChange.event;
    }
    defaultStateFor(category) {
        return PERMISSION_CATEGORY_DESCRIPTORS[category].defaultState;
    }
    getDecision(origin, category) {
        return this._data.get(toOriginKey(origin))?.get(category);
    }
    isAllowed(origin, category) {
        return (this.getDecision(origin, category) ?? this.defaultStateFor(category)) === "allow";
    }
    set(origin, category, decision) {
        const key = toOriginKey(origin);
        if (!key) {
            return;
        }
        if (decision === null) {
            const categories = this._data.get(key);
            if (!categories?.delete(category)) {
                return;
            }
            if (categories.size === 0) {
                this._data.delete(key);
            }
        } else {
            let categories = this._data.get(key);
            if (categories?.get(category) === decision) {
                return;
            }
            if (!categories) {
                categories = ( new Map());
                this._data.set(key, categories);
            }
            categories.set(category, decision);
        }
        this._onDidChange.fire();
    }
    setMany(origin, grants) {
        for (const {
            category,
            state
        } of grants) {
            this.set(origin, category, state);
        }
    }
    clearOrigin(origin) {
        const key = toOriginKey(origin);
        if (this._data.delete(key)) {
            this._onDidChange.fire();
        }
    }
    clear() {
        if (this._data.size === 0) {
            return;
        }
        this._data.clear();
        this._onDidChange.fire();
    }
    getOrigin(origin) {
        const result = {
            ...DEFAULT_PERMISSION_STATES
        };
        const recorded = this._data.get(toOriginKey(origin));
        if (recorded) {
            for (const [category, state] of recorded) {
                result[category] = state;
            }
        }
        return result;
    }
    origins() {
        return [...( this._data.keys())];
    }
    list() {
        const grants = [];
        for (const [origin, categories] of this._data) {
            for (const [category, state] of categories) {
                grants.push({
                    origin,
                    category,
                    state
                });
            }
        }
        return grants;
    }
    serialize() {
        const origins = {};
        for (const [origin, categories] of this._data) {
            const entry = {};
            for (const [category, state] of categories) {
                entry[category] = state;
            }
            origins[origin] = entry;
        }
        return {
            origins
        };
    }
    hydrate(snapshot) {
        this._data.clear();
        if (snapshot?.origins && typeof snapshot.origins === "object") {
            for (const [origin, categories] of Object.entries(snapshot.origins)) {
                if (!categories || typeof categories !== "object") {
                    continue;
                }
                const key = toOriginKey(origin);
                if (!key) {
                    continue;
                }
                let target;
                for (const [category, state] of Object.entries(categories)) {
                    if (!( VALID_CATEGORIES.has(category)) || (state !== "allow" && state !== "deny")) {
                        continue;
                    }
                    if (!target) {
                        target = ( new Map());
                        this._data.set(key, target);
                    }
                    target.set(category, state);
                }
            }
        }
        this._onDidChange.fire();
    }
}

export { ALL_PERMISSION_CATEGORIES, BrowserPermissionStore, PERMISSION_CATEGORY_DESCRIPTORS, PermissionCategory, toOriginKey };
