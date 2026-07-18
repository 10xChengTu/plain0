
import { encodeBase64, VSBuffer, decodeBase64 } from '../../../base/common/buffer.js';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';

const AGENT_HOST_SCHEME = "vscode-agent-host";
const AGENT_HOST_META_PARAM = "_ah";
function toAgentHostUri(originalUri, connectionAuthority) {
    if (connectionAuthority === "local" && originalUri.scheme === Schemas.file) {
        return originalUri;
    }
    const meta = {
        scheme: originalUri.scheme,
        ...(originalUri.authority ? {
            authority: originalUri.authority
        } : {}),
        ...(originalUri.query ? {
            query: originalUri.query
        } : {})
    };
    const params = ( new URLSearchParams());
    params.set(
        AGENT_HOST_META_PARAM,
        encodeBase64(VSBuffer.fromString(JSON.stringify(meta)), false, true)
    );
    return ( URI.from({
        scheme: AGENT_HOST_SCHEME,
        authority: connectionAuthority,
        path: originalUri.path || "/",
        query: ( params.toString()),
        fragment: originalUri.fragment
    }));
}
function fromAgentHostUri(agentHostUri) {
    if (agentHostUri.scheme !== AGENT_HOST_SCHEME) {
        return agentHostUri;
    }
    let meta;
    const encoded = agentHostUri.query ? ( new URLSearchParams(agentHostUri.query)).get(AGENT_HOST_META_PARAM) : null;
    if (encoded) {
        try {
            meta = JSON.parse(( decodeBase64(encoded).toString()));
        } catch {
            meta = undefined;
        }
    }
    if (!meta || typeof meta.scheme !== "string") {
        return ( URI.from({
            scheme: Schemas.file,
            path: agentHostUri.path,
            fragment: agentHostUri.fragment
        }));
    }
    return ( URI.from({
        scheme: meta.scheme,
        authority: meta.authority || undefined,
        path: agentHostUri.path,
        query: meta.query || "",
        fragment: agentHostUri.fragment
    }));
}
function normalizeRemoteAgentHostAddress(address) {
    if (address.startsWith("ws://")) {
        return address.slice("ws://".length);
    }
    return address;
}
function agentHostAuthority(address) {
    const normalized = normalizeRemoteAgentHostAddress(address);
    if (/^[a-zA-Z0-9]+$/.test(normalized)) {
        return normalized;
    }
    if (/^[a-zA-Z0-9.:\-]+$/.test(normalized)) {
        return normalized.replaceAll(":", "__");
    }
    return `b64-${encodeBase64(VSBuffer.fromString(normalized), false, true)}`;
}
const AGENT_HOST_LABEL_FORMATTER = {
    scheme: AGENT_HOST_SCHEME,
    formatting: {
        label: "${path}",
        separator: "/"
    }
};

export { AGENT_HOST_LABEL_FORMATTER, AGENT_HOST_SCHEME, agentHostAuthority, fromAgentHostUri, normalizeRemoteAgentHostAddress, toAgentHostUri };
