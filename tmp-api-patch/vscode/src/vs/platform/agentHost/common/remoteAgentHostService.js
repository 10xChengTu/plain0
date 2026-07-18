
import { Event } from '../../../base/common/event.js';
import '../../../base/common/network.js';
import { ProtocolError, AHP_UNSUPPORTED_PROTOCOL_VERSION } from './state/sessionProtocol.js';
import { readUnsupportedProtocolVersionErrorMeta } from './state/protocolUpgrade.js';
import { TUNNEL_ADDRESS_PREFIX } from './tunnelAgentHost.js';

var RemoteAgentHostConnectionStatus;
(function(RemoteAgentHostConnectionStatus) {
    RemoteAgentHostConnectionStatus.connected = ( Object.freeze({
        kind: "connected"
    }));
    RemoteAgentHostConnectionStatus.connecting = ( Object.freeze({
        kind: "connecting"
    }));
    RemoteAgentHostConnectionStatus.disconnected = ( Object.freeze({
        kind: "disconnected"
    }));
    function incompatible(message, supportedByClient, offeredByServer, vscodeUpgradeMethod) {
        return ( Object.freeze({
            kind: "incompatible",
            message,
            supportedByClient,
            offeredByServer,
            vscodeUpgradeMethod
        }));
    }
    RemoteAgentHostConnectionStatus.incompatible = incompatible;
    function isConnected(status) {
        return status?.kind === "connected";
    }
    RemoteAgentHostConnectionStatus.isConnected = isConnected;
    function isConnecting(status) {
        return status?.kind === "connecting";
    }
    RemoteAgentHostConnectionStatus.isConnecting = isConnecting;
    function isDisconnected(status) {
        return status?.kind === "disconnected";
    }
    RemoteAgentHostConnectionStatus.isDisconnected = isDisconnected;
    function isIncompatible(status) {
        return status?.kind === "incompatible";
    }
    RemoteAgentHostConnectionStatus.isIncompatible = isIncompatible;
    function isUnavailable(status) {
        return status?.kind !== "connected";
    }
    RemoteAgentHostConnectionStatus.isUnavailable = isUnavailable;
    function fromConnectError(err, supportedByClient) {
        if (err instanceof ProtocolError && err.code === AHP_UNSUPPORTED_PROTOCOL_VERSION) {
            const data = err.data;
            const offeredByServer = Array.isArray(data?.supportedVersions) ? data.supportedVersions : undefined;
            const vscodeUpgradeMethod = readUnsupportedProtocolVersionErrorMeta(err.data)?.vscodeUpgradeMethod;
            return incompatible(err.message, supportedByClient, offeredByServer, vscodeUpgradeMethod);
        }
        return undefined;
    }
    RemoteAgentHostConnectionStatus.fromConnectError = fromConnectError;
})(RemoteAgentHostConnectionStatus || (RemoteAgentHostConnectionStatus = {}));
const RemoteAgentHostsSettingId = "chat.remoteAgentHosts";
const RemoteAgentHostsEnabledSettingId = "chat.remoteAgentHostsEnabled";
var RemoteAgentHostEntryType;
(function(RemoteAgentHostEntryType) {
    RemoteAgentHostEntryType["WebSocket"] = "websocket";
    RemoteAgentHostEntryType["SSH"] = "ssh";
    RemoteAgentHostEntryType["WSL"] = "wsl";
    RemoteAgentHostEntryType["Tunnel"] = "tunnel";
})(RemoteAgentHostEntryType || (RemoteAgentHostEntryType = {}));
function getEntryAddress(entry) {
    switch (entry.connection.type) {
    case RemoteAgentHostEntryType.WebSocket:
    case RemoteAgentHostEntryType.SSH:
    case RemoteAgentHostEntryType.WSL:
        return entry.connection.address;
    case RemoteAgentHostEntryType.Tunnel:
        return `${TUNNEL_ADDRESS_PREFIX}${entry.connection.tunnelId}`;
    }
}
function remoteAgentHostLogOutputChannelId(address) {
    return `agentHost.otlp.${address}`;
}
const AGENT_HOST_LOG_OUTPUT_CHANNEL_ID = "agenthost";
var RemoteAgentHostInputValidationError;
(function(RemoteAgentHostInputValidationError) {
    RemoteAgentHostInputValidationError["Empty"] = "empty";
    RemoteAgentHostInputValidationError["Invalid"] = "invalid";
})(
    RemoteAgentHostInputValidationError || (RemoteAgentHostInputValidationError = {})
);
class NullRemoteAgentHostService {
    constructor() {
        this.onDidChangeConnections = Event.None;
        this.connections = [];
        this.configuredEntries = [];
    }
    getConnection() {
        return undefined;
    }
    getConnectionByAuthority() {
        return undefined;
    }
    async addRemoteAgentHost() {
        throw ( new Error("Remote agent host connections are not supported in this environment."));
    }
    async removeRemoteAgentHost(_address) {}
    reconnect(_address) {}
    notifyConnectionClosed(_address) {}
    async addManagedConnection() {
        throw ( new Error("Remote agent host connections are not supported in this environment."));
    }
    getEntryByAddress() {
        return undefined;
    }
    async triggerServerUpgrade() {
        throw ( new Error("Remote agent host connections are not supported in this environment."));
    }
}
function rawEntryToEntry(raw) {
    if (raw.sshConfigHost || raw.sshHostName || raw.sshUser || raw.sshPort) {
        return {
            name: raw.name,
            connectionToken: raw.connectionToken,
            connection: {
                type: RemoteAgentHostEntryType.SSH,
                address: raw.address,
                sshConfigHost: raw.sshConfigHost,
                hostName: raw.sshHostName ?? raw.address,
                user: raw.sshUser,
                port: raw.sshPort
            }
        };
    }
    return {
        name: raw.name,
        connectionToken: raw.connectionToken,
        connection: {
            type: RemoteAgentHostEntryType.WebSocket,
            address: raw.address
        }
    };
}
function entryToRawEntry(entry) {
    switch (entry.connection.type) {
    case RemoteAgentHostEntryType.SSH:
        return {
            address: entry.connection.address,
            name: entry.name,
            connectionToken: entry.connectionToken,
            sshConfigHost: entry.connection.sshConfigHost,
            sshHostName: entry.connection.hostName,
            sshUser: entry.connection.user,
            sshPort: entry.connection.port
        };
    case RemoteAgentHostEntryType.WebSocket:
        return {
            address: entry.connection.address,
            name: entry.name,
            connectionToken: entry.connectionToken
        };
    case RemoteAgentHostEntryType.WSL:
    case RemoteAgentHostEntryType.Tunnel:
        return undefined;
    }
}

export { AGENT_HOST_LOG_OUTPUT_CHANNEL_ID, NullRemoteAgentHostService, RemoteAgentHostConnectionStatus, RemoteAgentHostEntryType, RemoteAgentHostInputValidationError, RemoteAgentHostsEnabledSettingId, RemoteAgentHostsSettingId, entryToRawEntry, getEntryAddress, rawEntryToEntry, remoteAgentHostLogOutputChannelId };
