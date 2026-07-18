

var AgentSandboxSettingId;
(function (AgentSandboxSettingId) {
    AgentSandboxSettingId["AgentSandboxEnabled"] = "chat.agent.sandbox.enabled";
    AgentSandboxSettingId["AgentSandboxWindowsEnabled"] = "chat.agent.sandbox.enabledWindows";
    AgentSandboxSettingId["AgentSandboxAllowNetwork"] = "chat.agent.sandbox.allowNetwork";
    AgentSandboxSettingId["AgentSandboxAllowUnsandboxedCommands"] = "chat.agent.sandbox.allowUnsandboxedCommands";
    AgentSandboxSettingId["AgentSandboxRetryWithAllowNetworkRequests"] = "chat.agent.sandbox.retryWithAllowNetworkRequests";
    AgentSandboxSettingId["AgentSandboxAllowAutoApprove"] = "chat.agent.sandbox.allowAutoApprove";
    AgentSandboxSettingId["AgentSandboxLinuxFileSystem"] = "chat.agent.sandbox.fileSystem.linux";
    AgentSandboxSettingId["AgentSandboxMacFileSystem"] = "chat.agent.sandbox.fileSystem.mac";
    AgentSandboxSettingId["AgentSandboxWindowsFileSystem"] = "chat.agent.sandbox.fileSystem.windows";
    AgentSandboxSettingId["AgentSandboxWindowsSchemaVersion"] = "chat.agent.sandbox.advanced.windows.schemaVersion";
    AgentSandboxSettingId["AgentSandboxAdvancedRuntime"] = "chat.agent.sandbox.advanced.runtime";
    AgentSandboxSettingId["DeprecatedAgentSandboxEnabled"] = "chat.agent.sandbox";
    AgentSandboxSettingId["DeprecatedAgentSandboxLinuxFileSystem"] = "chat.agent.sandboxFileSystem.linux";
    AgentSandboxSettingId["DeprecatedAgentSandboxMacFileSystem"] = "chat.agent.sandboxFileSystem.mac";
})(AgentSandboxSettingId || (AgentSandboxSettingId = {}));
var AgentSandboxEnabledValue;
(function (AgentSandboxEnabledValue) {
    AgentSandboxEnabledValue["Off"] = "off";
    AgentSandboxEnabledValue["On"] = "on";
    AgentSandboxEnabledValue["AllowNetwork"] = "allowNetwork";
})(AgentSandboxEnabledValue || (AgentSandboxEnabledValue = {}));
function normalizeAgentSandboxEnabledValue(value) {
    if (value === true) {
        return AgentSandboxEnabledValue.On;
    }
    if (value === false) {
        return AgentSandboxEnabledValue.Off;
    }
    return value;
}
function isAgentSandboxEnabledValue(value) {
    return value !== undefined && normalizeAgentSandboxEnabledValue(value) !== AgentSandboxEnabledValue.Off;
}

export { AgentSandboxEnabledValue, AgentSandboxSettingId, isAgentSandboxEnabledValue, normalizeAgentSandboxEnabledValue };
