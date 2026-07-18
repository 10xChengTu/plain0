

const REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX = 'remote-';
function remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority) {
    return `${REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX}${connectionAuthority}-`;
}
function isRemoteAgentHostSessionType(sessionType) {
    return sessionType.startsWith(REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX);
}
function findRemoteAgentHostSessionTypeAuthority(sessionType, connectionAuthorities) {
    if (!isRemoteAgentHostSessionType(sessionType)) {
        return undefined;
    }
    let bestMatch;
    for (const authority of connectionAuthorities) {
        if (isRemoteAgentHostSessionTypeForAuthority(sessionType, authority) && (!bestMatch || authority.length > bestMatch.length)) {
            bestMatch = authority;
        }
    }
    return bestMatch;
}
function isRemoteAgentHostSessionTypeForAuthority(sessionType, connectionAuthority) {
    return !!connectionAuthority && sessionType.startsWith(remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority));
}
function parseRemoteAgentHostHarness(sessionType) {
    if (!isRemoteAgentHostSessionType(sessionType)) {
        return undefined;
    }
    const lastDash = sessionType.lastIndexOf('-');
    const harness = sessionType.slice(lastDash + 1);
    return harness || undefined;
}
function parseRemoteAgentHostSessionTypeAuthority(sessionType, agentProvider) {
    if (!isRemoteAgentHostSessionType(sessionType)) {
        return undefined;
    }
    const providerSuffix = `-${agentProvider}`;
    if (!sessionType.endsWith(providerSuffix)) {
        return undefined;
    }
    const authority = sessionType.slice(REMOTE_AGENT_HOST_SESSION_TYPE_PREFIX.length, sessionType.length - providerSuffix.length);
    return authority || undefined;
}

export { findRemoteAgentHostSessionTypeAuthority, isRemoteAgentHostSessionType, parseRemoteAgentHostHarness, parseRemoteAgentHostSessionTypeAuthority, remoteAgentHostSessionTypeAuthorityPrefix };
