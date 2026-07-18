

var ReconnectResultType;
(function (ReconnectResultType) {
    ReconnectResultType["Replay"] = "replay";
    ReconnectResultType["Snapshot"] = "snapshot";
})(ReconnectResultType || (ReconnectResultType = {}));
var ContentEncoding;
(function (ContentEncoding) {
    ContentEncoding["Base64"] = "base64";
    ContentEncoding["Utf8"] = "utf-8";
})(ContentEncoding || (ContentEncoding = {}));
var ResourceWriteMode;
(function (ResourceWriteMode) {
    ResourceWriteMode["Truncate"] = "truncate";
    ResourceWriteMode["Append"] = "append";
    ResourceWriteMode["Insert"] = "insert";
})(ResourceWriteMode || (ResourceWriteMode = {}));
var ResourceType;
(function (ResourceType) {
    ResourceType["File"] = "file";
    ResourceType["Directory"] = "directory";
    ResourceType["Symlink"] = "symlink";
})(ResourceType || (ResourceType = {}));

export { ContentEncoding, ReconnectResultType, ResourceType, ResourceWriteMode };
