
import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

var CommentContextKeys;
(function(CommentContextKeys) {
    CommentContextKeys.activeCursorHasCommentingRange = ( new RawContextKey("activeCursorHasCommentingRange", false, {
        description: ( localize(9328, "Whether the position at the active cursor has a commenting range")),
        type: "boolean"
    }));
    CommentContextKeys.activeCursorHasComment = ( new RawContextKey("activeCursorHasComment", false, {
        description: ( localize(9329, "Whether the position at the active cursor has a comment")),
        type: "boolean"
    }));
    CommentContextKeys.activeEditorHasCommentingRange = ( new RawContextKey("activeEditorHasCommentingRange", false, {
        description: ( localize(9330, "Whether the active editor has a commenting range")),
        type: "boolean"
    }));
    CommentContextKeys.WorkspaceHasCommenting = ( new RawContextKey("workspaceHasCommenting", false, {
        description: ( localize(
            9331,
            "Whether the open workspace has either comments or commenting ranges."
        )),
        type: "boolean"
    }));
    CommentContextKeys.commentThreadIsEmpty = ( new RawContextKey("commentThreadIsEmpty", false, {
        type: "boolean",
        description: ( localize(9332, "Set when the comment thread has no comments"))
    }));
    CommentContextKeys.commentIsEmpty = ( new RawContextKey("commentIsEmpty", false, {
        type: "boolean",
        description: ( localize(9333, "Set when the comment has no input"))
    }));
    CommentContextKeys.commentContext = ( new RawContextKey("comment", undefined, {
        type: "string",
        description: ( localize(9334, "The context value of the comment"))
    }));
    CommentContextKeys.commentThreadContext = ( new RawContextKey("commentThread", undefined, {
        type: "string",
        description: ( localize(9335, "The context value of the comment thread"))
    }));
    CommentContextKeys.commentControllerContext = ( new RawContextKey("commentController", undefined, {
        type: "string",
        description: ( localize(9336, "The comment controller id associated with a comment thread"))
    }));
    CommentContextKeys.commentFocused = ( new RawContextKey("commentFocused", false, {
        type: "boolean",
        description: ( localize(9337, "Set when the comment is focused"))
    }));
    CommentContextKeys.commentWidgetVisible = ( new RawContextKey("commentWidgetVisible", false, {
        type: "boolean",
        description: ( localize(9338, "Set when a comment widget is visible in the editor"))
    }));
    CommentContextKeys.commentingEnabled = ( new RawContextKey("commentingEnabled", true, {
        description: ( localize(9339, "Whether commenting functionality is enabled")),
        type: "boolean"
    }));
})(CommentContextKeys || (CommentContextKeys = {}));

export { CommentContextKeys };
