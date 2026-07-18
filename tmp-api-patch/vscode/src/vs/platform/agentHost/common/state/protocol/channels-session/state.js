

var SessionLifecycle;
(function (SessionLifecycle) {
    SessionLifecycle["Creating"] = "creating";
    SessionLifecycle["Ready"] = "ready";
    SessionLifecycle["CreationFailed"] = "creationFailed";
})(SessionLifecycle || (SessionLifecycle = {}));
var SessionStatus;
(function (SessionStatus) {
    SessionStatus[SessionStatus["Idle"] = 1] = "Idle";
    SessionStatus[SessionStatus["Error"] = 2] = "Error";
    SessionStatus[SessionStatus["InProgress"] = 8] = "InProgress";
    SessionStatus[SessionStatus["InputNeeded"] = 24] = "InputNeeded";
    SessionStatus[SessionStatus["IsRead"] = 32] = "IsRead";
    SessionStatus[SessionStatus["IsArchived"] = 64] = "IsArchived";
})(SessionStatus || (SessionStatus = {}));
var SessionInputRequestKind;
(function (SessionInputRequestKind) {
    SessionInputRequestKind["ChatInput"] = "chatInput";
    SessionInputRequestKind["ToolConfirmation"] = "toolConfirmation";
    SessionInputRequestKind["ToolClientExecution"] = "toolClientExecution";
})(SessionInputRequestKind || (SessionInputRequestKind = {}));
var CustomizationType;
(function (CustomizationType) {
    CustomizationType["Plugin"] = "plugin";
    CustomizationType["Directory"] = "directory";
    CustomizationType["Agent"] = "agent";
    CustomizationType["Skill"] = "skill";
    CustomizationType["Prompt"] = "prompt";
    CustomizationType["Rule"] = "rule";
    CustomizationType["Hook"] = "hook";
    CustomizationType["McpServer"] = "mcpServer";
})(CustomizationType || (CustomizationType = {}));
var CustomizationLoadStatus;
(function (CustomizationLoadStatus) {
    CustomizationLoadStatus["Loading"] = "loading";
    CustomizationLoadStatus["Loaded"] = "loaded";
    CustomizationLoadStatus["Degraded"] = "degraded";
    CustomizationLoadStatus["Error"] = "error";
})(CustomizationLoadStatus || (CustomizationLoadStatus = {}));
var McpServerStatus;
(function (McpServerStatus) {
    McpServerStatus["Starting"] = "starting";
    McpServerStatus["Ready"] = "ready";
    McpServerStatus["AuthRequired"] = "authRequired";
    McpServerStatus["Error"] = "error";
    McpServerStatus["Stopped"] = "stopped";
})(McpServerStatus || (McpServerStatus = {}));
var McpAuthRequiredReason;
(function (McpAuthRequiredReason) {
    McpAuthRequiredReason["Required"] = "required";
    McpAuthRequiredReason["Expired"] = "expired";
    McpAuthRequiredReason["InsufficientScope"] = "insufficientScope";
})(McpAuthRequiredReason || (McpAuthRequiredReason = {}));

export { CustomizationLoadStatus, CustomizationType, McpAuthRequiredReason, McpServerStatus, SessionInputRequestKind, SessionLifecycle, SessionStatus };
