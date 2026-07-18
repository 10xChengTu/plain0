
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ctxCommentEditorFocused } from './simpleCommentEditor.js';
import { CommentContextKeys } from '../common/commentContextKeys.js';
import { localize } from '../../../../nls.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { CommentCommandId } from '../common/commentCommandIds.js';
import { ToggleTabFocusModeAction } from '../../../../editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js';
import { AccessibleViewProviderId, AccessibleViewType } from '../../../../platform/accessibility/browser/accessibleView.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

var CommentAccessibilityHelpNLS;
(function(CommentAccessibilityHelpNLS) {
    CommentAccessibilityHelpNLS.intro = ( localize(
        9251,
        "The editor contains commentable range(s). Some useful commands include:"
    ));
    CommentAccessibilityHelpNLS.tabFocus = ( localize(
        9252,
        "This widget contains a text area, for composition of new comments, and actions, that can be tabbed to once tab moves focus mode has been enabled with the command Toggle Tab Key Moves Focus{0}.",
        `<keybinding:${ToggleTabFocusModeAction.ID}>`
    ));
    CommentAccessibilityHelpNLS.commentCommands = ( localize(9253, "Some useful comment commands include:"));
    CommentAccessibilityHelpNLS.escape = ( localize(9254, "- Dismiss Comment{0}.", `<keybinding:${CommentCommandId.Hide}>`));
    CommentAccessibilityHelpNLS.nextRange = ( localize(
        9255,
        "- Go to Next Commenting Range{0}.",
        `<keybinding:${CommentCommandId.NextRange}>`
    ));
    CommentAccessibilityHelpNLS.previousRange = ( localize(
        9256,
        "- Go to Previous Commenting Range{0}.",
        `<keybinding:${CommentCommandId.PreviousRange}>`
    ));
    CommentAccessibilityHelpNLS.nextCommentThread = ( localize(
        9257,
        "- Go to Next Comment Thread{0}.",
        `<keybinding:${CommentCommandId.NextThread}>`
    ));
    CommentAccessibilityHelpNLS.previousCommentThread = ( localize(
        9258,
        "- Go to Previous Comment Thread{0}.",
        `<keybinding:${CommentCommandId.PreviousThread}>`
    ));
    CommentAccessibilityHelpNLS.nextCommentedRange = ( localize(
        9259,
        "- Go to Next Commented Range{0}.",
        `<keybinding:${CommentCommandId.NextCommentedRange}>`
    ));
    CommentAccessibilityHelpNLS.previousCommentedRange = ( localize(
        9260,
        "- Go to Previous Commented Range{0}.",
        `<keybinding:${CommentCommandId.PreviousCommentedRange}>`
    ));
    CommentAccessibilityHelpNLS.addComment = ( localize(
        9261,
        "- Add Comment on Current Selection{0}.",
        `<keybinding:${CommentCommandId.Add}>`
    ));
    CommentAccessibilityHelpNLS.submitComment = ( localize(9262, "- Submit Comment{0}.", `<keybinding:${CommentCommandId.Submit}>`));
})(CommentAccessibilityHelpNLS || (CommentAccessibilityHelpNLS = {}));
class CommentsAccessibilityHelpProvider extends Disposable {
    constructor() {
        super(...arguments);
        this.id = AccessibleViewProviderId.Comments;
        this.verbositySettingKey = AccessibilityVerbositySettingId.Comments;
        this.options = {
            type: AccessibleViewType.Help
        };
    }
    provideContent() {
        return [
            CommentAccessibilityHelpNLS.tabFocus,
            CommentAccessibilityHelpNLS.commentCommands,
            CommentAccessibilityHelpNLS.escape,
            CommentAccessibilityHelpNLS.addComment,
            CommentAccessibilityHelpNLS.submitComment,
            CommentAccessibilityHelpNLS.nextRange,
            CommentAccessibilityHelpNLS.previousRange
        ].join("\n");
    }
    onClose() {
        this._element?.focus();
    }
}
class CommentsAccessibilityHelp {
    constructor() {
        this.priority = 110;
        this.name = "comments";
        this.type = AccessibleViewType.Help;
        this.when = ( ContextKeyExpr.or(ctxCommentEditorFocused, CommentContextKeys.commentFocused));
    }
    getProvider(accessor) {
        return accessor.get(IInstantiationService).createInstance(CommentsAccessibilityHelpProvider);
    }
}

export { CommentAccessibilityHelpNLS, CommentsAccessibilityHelp, CommentsAccessibilityHelpProvider };
