

var ChatOriginKind;
(function (ChatOriginKind) {
    ChatOriginKind["User"] = "user";
    ChatOriginKind["Fork"] = "fork";
    ChatOriginKind["Tool"] = "tool";
})(ChatOriginKind || (ChatOriginKind = {}));
var ChatInteractivity;
(function (ChatInteractivity) {
    ChatInteractivity["Full"] = "full";
    ChatInteractivity["ReadOnly"] = "read-only";
    ChatInteractivity["Hidden"] = "hidden";
})(ChatInteractivity || (ChatInteractivity = {}));
var PendingMessageKind;
(function (PendingMessageKind) {
    PendingMessageKind["Steering"] = "steering";
    PendingMessageKind["Queued"] = "queued";
})(PendingMessageKind || (PendingMessageKind = {}));
var ChatInputResponseKind;
(function (ChatInputResponseKind) {
    ChatInputResponseKind["Accept"] = "accept";
    ChatInputResponseKind["Decline"] = "decline";
    ChatInputResponseKind["Cancel"] = "cancel";
})(ChatInputResponseKind || (ChatInputResponseKind = {}));
var ChatInputQuestionKind;
(function (ChatInputQuestionKind) {
    ChatInputQuestionKind["Text"] = "text";
    ChatInputQuestionKind["Number"] = "number";
    ChatInputQuestionKind["Integer"] = "integer";
    ChatInputQuestionKind["Boolean"] = "boolean";
    ChatInputQuestionKind["SingleSelect"] = "single-select";
    ChatInputQuestionKind["MultiSelect"] = "multi-select";
})(ChatInputQuestionKind || (ChatInputQuestionKind = {}));
var ChatInputAnswerValueKind;
(function (ChatInputAnswerValueKind) {
    ChatInputAnswerValueKind["Text"] = "text";
    ChatInputAnswerValueKind["Number"] = "number";
    ChatInputAnswerValueKind["Boolean"] = "boolean";
    ChatInputAnswerValueKind["Selected"] = "selected";
    ChatInputAnswerValueKind["SelectedMany"] = "selected-many";
})(ChatInputAnswerValueKind || (ChatInputAnswerValueKind = {}));
var ChatInputAnswerState;
(function (ChatInputAnswerState) {
    ChatInputAnswerState["Draft"] = "draft";
    ChatInputAnswerState["Submitted"] = "submitted";
    ChatInputAnswerState["Skipped"] = "skipped";
})(ChatInputAnswerState || (ChatInputAnswerState = {}));
var TurnState;
(function (TurnState) {
    TurnState["Complete"] = "complete";
    TurnState["Cancelled"] = "cancelled";
    TurnState["Error"] = "error";
})(TurnState || (TurnState = {}));
var MessageAttachmentKind;
(function (MessageAttachmentKind) {
    MessageAttachmentKind["Simple"] = "simple";
    MessageAttachmentKind["EmbeddedResource"] = "embeddedResource";
    MessageAttachmentKind["Resource"] = "resource";
    MessageAttachmentKind["Annotations"] = "annotations";
})(MessageAttachmentKind || (MessageAttachmentKind = {}));
var MessageKind;
(function (MessageKind) {
    MessageKind["User"] = "user";
    MessageKind["Agent"] = "agent";
    MessageKind["Tool"] = "tool";
    MessageKind["SystemNotification"] = "systemNotification";
})(MessageKind || (MessageKind = {}));
var ResponsePartKind;
(function (ResponsePartKind) {
    ResponsePartKind["Markdown"] = "markdown";
    ResponsePartKind["ContentRef"] = "contentRef";
    ResponsePartKind["ToolCall"] = "toolCall";
    ResponsePartKind["Reasoning"] = "reasoning";
    ResponsePartKind["SystemNotification"] = "systemNotification";
})(ResponsePartKind || (ResponsePartKind = {}));
var ToolCallStatus;
(function (ToolCallStatus) {
    ToolCallStatus["Streaming"] = "streaming";
    ToolCallStatus["PendingConfirmation"] = "pending-confirmation";
    ToolCallStatus["Running"] = "running";
    ToolCallStatus["PendingResultConfirmation"] = "pending-result-confirmation";
    ToolCallStatus["Completed"] = "completed";
    ToolCallStatus["Cancelled"] = "cancelled";
})(ToolCallStatus || (ToolCallStatus = {}));
var ToolCallConfirmationReason;
(function (ToolCallConfirmationReason) {
    ToolCallConfirmationReason["NotNeeded"] = "not-needed";
    ToolCallConfirmationReason["UserAction"] = "user-action";
    ToolCallConfirmationReason["Setting"] = "setting";
})(ToolCallConfirmationReason || (ToolCallConfirmationReason = {}));
var ToolCallCancellationReason;
(function (ToolCallCancellationReason) {
    ToolCallCancellationReason["Denied"] = "denied";
    ToolCallCancellationReason["Skipped"] = "skipped";
    ToolCallCancellationReason["ResultDenied"] = "result-denied";
})(ToolCallCancellationReason || (ToolCallCancellationReason = {}));
var ConfirmationOptionKind;
(function (ConfirmationOptionKind) {
    ConfirmationOptionKind["Approve"] = "approve";
    ConfirmationOptionKind["Deny"] = "deny";
})(ConfirmationOptionKind || (ConfirmationOptionKind = {}));
var ToolCallContributorKind;
(function (ToolCallContributorKind) {
    ToolCallContributorKind["Client"] = "client";
    ToolCallContributorKind["MCP"] = "mcp";
})(ToolCallContributorKind || (ToolCallContributorKind = {}));
var ToolResultContentType;
(function (ToolResultContentType) {
    ToolResultContentType["Text"] = "text";
    ToolResultContentType["EmbeddedResource"] = "embeddedResource";
    ToolResultContentType["Resource"] = "resource";
    ToolResultContentType["FileEdit"] = "fileEdit";
    ToolResultContentType["Terminal"] = "terminal";
    ToolResultContentType["ShellExit"] = "shell_exit";
    ToolResultContentType["Subagent"] = "subagent";
})(ToolResultContentType || (ToolResultContentType = {}));

export { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, ChatInteractivity, ChatOriginKind, ConfirmationOptionKind, MessageAttachmentKind, MessageKind, PendingMessageKind, ResponsePartKind, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallContributorKind, ToolCallStatus, ToolResultContentType, TurnState };
