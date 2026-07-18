
import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

const ctxIsMergeEditor = ( new RawContextKey("isMergeEditor", false, {
    type: "boolean",
    description: ( localize(12323, "The editor is a merge editor"))
}));
const ctxIsMergeResultEditor = ( new RawContextKey("isMergeResultEditor", false, {
    type: "boolean",
    description: ( localize(12324, "The editor is a the result editor of a merge editor."))
}));
const ctxMergeEditorLayout = ( new RawContextKey("mergeEditorLayout", "mixed", {
    type: "string",
    description: ( localize(12325, "The layout mode of a merge editor"))
}));
const ctxMergeEditorShowBase = ( new RawContextKey("mergeEditorShowBase", false, {
    type: "boolean",
    description: ( localize(12326, "If the merge editor shows the base version"))
}));
const ctxMergeEditorShowBaseAtTop = ( new RawContextKey("mergeEditorShowBaseAtTop", false, {
    type: "boolean",
    description: ( localize(12327, "If base should be shown at the top"))
}));
const ctxMergeEditorShowNonConflictingChanges = ( new RawContextKey("mergeEditorShowNonConflictingChanges", false, {
    type: "boolean",
    description: ( localize(12328, "If the merge editor shows non-conflicting changes"))
}));
const ctxMergeBaseUri = ( new RawContextKey("mergeEditorBaseUri", "", {
    type: "string",
    description: ( localize(12329, "The uri of the baser of a merge editor"))
}));
const ctxMergeResultUri = ( new RawContextKey("mergeEditorResultUri", "", {
    type: "string",
    description: ( localize(12330, "The uri of the result of a merge editor"))
}));
const StorageCloseWithConflicts = "mergeEditorCloseWithConflicts";

export { StorageCloseWithConflicts, ctxIsMergeEditor, ctxIsMergeResultEditor, ctxMergeBaseUri, ctxMergeEditorLayout, ctxMergeEditorShowBase, ctxMergeEditorShowBaseAtTop, ctxMergeEditorShowNonConflictingChanges, ctxMergeResultUri };
