

function extraKnownMarketplacesToConfigDict(entries) {
    if (!entries?.length) {
        return undefined;
    }
    const obj = {};
    for (const entry of entries) {
        if (typeof entry === 'string') {
            if (isUnsafeMarketplaceKey(entry)) {
                continue;
            }
            obj[entry] = entry;
        }
        else {
            if (isUnsafeMarketplaceKey(entry.name)) {
                continue;
            }
            const s = entry.source;
            const base = s.source === 'github' ? s.repo : s.url;
            obj[entry.name] = s.ref ? `${base}#${s.ref}` : base;
        }
    }
    return obj;
}
function isUnsafeMarketplaceKey(key) {
    return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export { extraKnownMarketplacesToConfigDict };
