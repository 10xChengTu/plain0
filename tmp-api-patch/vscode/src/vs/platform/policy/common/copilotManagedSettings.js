
import '../../../base/common/event.js';
import { extraKnownMarketplacesToConfigDict } from '../../../base/common/managedSettings.js';
import { isObject, isString } from '../../../base/common/types.js';

const COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY = "permissions.disableBypassPermissionsMode";
const COPILOT_ENABLED_PLUGINS_KEY = "enabledPlugins";
const COPILOT_EXTRA_MARKETPLACES_KEY = "extraKnownMarketplaces";
const COPILOT_STRICT_MARKETPLACES_KEY = "strictKnownMarketplaces";
const COPILOT_MODEL_KEY = "model";
const COPILOT_OTEL_ENABLED_KEY = "telemetry.enabled";
const COPILOT_OTEL_ENDPOINT_KEY = "telemetry.endpoint";
const COPILOT_OTEL_PROTOCOL_KEY = "telemetry.protocol";
const COPILOT_OTEL_CAPTURE_CONTENT_KEY = "telemetry.captureContent";
const COPILOT_OTEL_LOCK_CAPTURE_CONTENT_KEY = "telemetry.lockCaptureContent";
const COPILOT_OTEL_SERVICE_NAME_KEY = "telemetry.serviceName";
const COPILOT_OTEL_RESOURCE_ATTRIBUTES_KEY = "telemetry.resourceAttributes";
const COPILOT_OTEL_HEADERS_KEY = "telemetry.headers";
const managedSettingValueCallbacks = ( new Map());
function managedSettingValue(key) {
    let callback = managedSettingValueCallbacks.get(key);
    if (!callback) {
        callback = policyData => policyData.managedSettings?.[key];
        managedSettingValueCallbacks.set(key, callback);
    }
    return callback;
}
let managedModelValueCallback;
function managedModelValue() {
    if (!managedModelValueCallback) {
        managedModelValueCallback = policyData => {
            const model = policyData.managedSettings?.[COPILOT_MODEL_KEY];
            const trimmed = typeof model === "string" ? model.trim() : undefined;
            return trimmed ? trimmed : undefined;
        };
    }
    return managedModelValueCallback;
}
function flattenManagedSettings(object) {
    const result = {};
    flattenManagedSettingsValue(object, undefined, result);
    return result;
}
function flattenManagedSettingsValue(value, prefix, result) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        if (prefix !== undefined) {
            result[prefix] = value;
        }
        return;
    }
    if (!isManagedSettingsObject(value)) {
        return;
    }
    for (const key in value) {
        flattenManagedSettingsValue(value[key], prefix ? `${prefix}.${key}` : key, result);
    }
}
function isManagedSettingsObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function projectManagedSettings(values, definitions, onWarn) {
    const projected = {};
    for (const key in definitions) {
        const value = values[key];
        if (value === undefined) {
            continue;
        }
        if (typeof value === definitions[key].type) {
            projected[key] = value;
        } else {
            onWarn?.(
                `Ignoring managed setting "${key}": expected ${definitions[key].type}, got ${typeof value}`
            );
        }
    }
    return projected;
}
const MANAGED_SETTINGS_CHANNELS = ["nativeMdm", "server", "file"];
function pickManagedSettings(nativeMdm, server, file) {
    const bags = {
        nativeMdm,
        server,
        file
    };
    const resolutions = ( new Map());
    for (const channel of MANAGED_SETTINGS_CHANNELS) {
        const bag = bags[channel];
        if (!bag) {
            continue;
        }
        for (const key of ( Object.keys(bag))) {
            const value = bag[key];
            if (value === undefined) {
                continue;
            }
            const existing = resolutions.get(key);
            if (existing) {
                existing.contributions.push({
                    channel,
                    value
                });
            } else {
                resolutions.set(key, {
                    value,
                    source: channel,
                    contributions: [{
                        channel,
                        value
                    }]
                });
            }
        }
    }
    const activeSources = ( new Set());
    const entries = [];
    for (const [key, resolution] of resolutions) {
        entries.push([key, resolution.value]);
        activeSources.add(resolution.source);
    }
    return {
        values: Object.fromEntries(entries),
        resolutions,
        activeSources: MANAGED_SETTINGS_CHANNELS.filter(channel => ( activeSources.has(channel)))
    };
}
function encodeStringMap(value) {
    if (!isObject(value)) {
        return undefined;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") {
            continue;
        }
        if (isString(v)) {
            out[k] = v;
        } else if (typeof v === "number" || typeof v === "boolean") {
            out[k] = String(v);
        }
    }
    return out;
}
function encodeObject(value) {
    return isObject(value) ? value : undefined;
}
function encodeArray(value) {
    return Array.isArray(value) ? value : undefined;
}
function encodeExtraMarketplaces(value, onWarn) {
    return extraKnownMarketplacesToConfigDict(normalizeExtraKnownMarketplaces(value, onWarn));
}
const STRUCTURED_MANAGED_SETTINGS = [{
    key: COPILOT_ENABLED_PLUGINS_KEY,
    encode: encodeObject
}, {
    key: COPILOT_STRICT_MARKETPLACES_KEY,
    encode: encodeArray
}, {
    key: COPILOT_EXTRA_MARKETPLACES_KEY,
    encode: encodeExtraMarketplaces
}, {
    key: COPILOT_OTEL_RESOURCE_ATTRIBUTES_KEY,
    encode: encodeStringMap
}, {
    key: COPILOT_OTEL_HEADERS_KEY,
    encode: encodeStringMap
}];
function readNestedManagedKey(obj, dottedKey) {
    let current = obj;
    for (const segment of dottedKey.split(".")) {
        if (!isObject(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function withNestedManagedKeyDeleted(obj, dottedKey) {
    const dot = dottedKey.indexOf(".");
    if (dot === -1) {
        const clone = {
            ...obj
        };
        delete clone[dottedKey];
        return clone;
    }
    const head = dottedKey.slice(0, dot);
    const child = obj[head];
    if (!isObject(child)) {
        return obj;
    }
    return {
        ...obj,
        [head]: withNestedManagedKeyDeleted(child, dottedKey.slice(dot + 1))
    };
}
function normalizeManagedSettings(parsed, onWarn) {
    let scalarRest = {
        ...parsed
    };
    for (const setting of STRUCTURED_MANAGED_SETTINGS) {
        scalarRest = withNestedManagedKeyDeleted(scalarRest, setting.key);
    }
    const result = {
        ...flattenManagedSettings(scalarRest)
    };
    for (const setting of STRUCTURED_MANAGED_SETTINGS) {
        const encoded = setting.encode(readNestedManagedKey(parsed, setting.key), onWarn);
        if (encoded !== undefined) {
            result[setting.key] = JSON.stringify(encoded);
        }
    }
    return result;
}
function normalizeExtraKnownMarketplaces(value, onWarn) {
    if (!isObject(value)) {
        return undefined;
    }
    const seen = ( new Set());
    const entries = [];
    for (const [name, entry] of Object.entries(value)) {
        if (!isObject(entry) || !isObject(entry.source)) {
            onWarn?.(
                `Skipping malformed extraKnownMarketplaces entry "${name}": expected { source: { source, repo|url } }`
            );
            continue;
        }
        const src = entry.source;
        let normalized;
        if (src.source === "github" && isString(src.repo)) {
            normalized = {
                name,
                source: {
                    source: "github",
                    repo: src.repo,
                    ...(src.ref ? {
                        ref: src.ref
                    } : {})
                }
            };
        } else if (src.source === "git" && isString(src.url)) {
            normalized = {
                name,
                source: {
                    source: "git",
                    url: src.url,
                    ...(src.ref ? {
                        ref: src.ref
                    } : {})
                }
            };
        } else if (src.source === "github" || src.source === "git") {
            onWarn?.(
                `Skipping extraKnownMarketplaces entry "${name}": source "${src.source}" requires ${src.source === "github" ? "\"repo\"" : "\"url\""}`
            );
        } else {
            onWarn?.(
                `Skipping extraKnownMarketplaces entry "${name}": unknown source type "${src.source}"`
            );
        }
        if (normalized && !( seen.has(name))) {
            seen.add(name);
            entries.push(normalized);
        }
    }
    return entries;
}

export { COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY, COPILOT_ENABLED_PLUGINS_KEY, COPILOT_EXTRA_MARKETPLACES_KEY, COPILOT_MODEL_KEY, COPILOT_OTEL_CAPTURE_CONTENT_KEY, COPILOT_OTEL_ENABLED_KEY, COPILOT_OTEL_ENDPOINT_KEY, COPILOT_OTEL_HEADERS_KEY, COPILOT_OTEL_LOCK_CAPTURE_CONTENT_KEY, COPILOT_OTEL_PROTOCOL_KEY, COPILOT_OTEL_RESOURCE_ATTRIBUTES_KEY, COPILOT_OTEL_SERVICE_NAME_KEY, COPILOT_STRICT_MARKETPLACES_KEY, MANAGED_SETTINGS_CHANNELS, managedModelValue, managedSettingValue, normalizeManagedSettings, pickManagedSettings, projectManagedSettings };
