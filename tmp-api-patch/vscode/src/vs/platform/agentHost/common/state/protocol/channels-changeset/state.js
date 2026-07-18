

var ChangesetStatus;
(function (ChangesetStatus) {
    ChangesetStatus["Computing"] = "computing";
    ChangesetStatus["Ready"] = "ready";
    ChangesetStatus["Error"] = "error";
})(ChangesetStatus || (ChangesetStatus = {}));
var ChangesetOperationStatus;
(function (ChangesetOperationStatus) {
    ChangesetOperationStatus["Idle"] = "idle";
    ChangesetOperationStatus["Running"] = "running";
    ChangesetOperationStatus["Error"] = "error";
    ChangesetOperationStatus["Disabled"] = "disabled";
})(ChangesetOperationStatus || (ChangesetOperationStatus = {}));
var ChangesetOperationScope;
(function (ChangesetOperationScope) {
    ChangesetOperationScope["Changeset"] = "changeset";
    ChangesetOperationScope["Resource"] = "resource";
    ChangesetOperationScope["Range"] = "range";
})(ChangesetOperationScope || (ChangesetOperationScope = {}));

export { ChangesetOperationScope, ChangesetOperationStatus, ChangesetStatus };
