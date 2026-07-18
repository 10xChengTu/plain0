

function readUnsupportedProtocolVersionErrorMeta(data) {
    if (!data || typeof data !== "object") {
        return undefined;
    }
    const meta = data["_meta"];
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        return undefined;
    }
    const raw = meta;
    const result = {};
    if (typeof raw["vscodeUpgradeMethod"] === "string") {
        result.vscodeUpgradeMethod = raw["vscodeUpgradeMethod"];
    }
    return ( Object.keys(result)).length > 0 ? result : undefined;
}

export { readUnsupportedProtocolVersionErrorMeta };
