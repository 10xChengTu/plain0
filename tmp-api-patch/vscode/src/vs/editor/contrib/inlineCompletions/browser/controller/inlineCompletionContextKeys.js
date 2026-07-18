
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../../nls.js';

class InlineCompletionContextKeys {
    static {
        this.inlineSuggestionVisible = ( new RawContextKey("inlineSuggestionVisible", false, ( localize(1339, "Whether an inline suggestion is visible"))));
    }
    static {
        this.inlineSuggestionAlternativeActionVisible = ( new RawContextKey("inlineSuggestionAlternativeActionVisible", false, ( localize(
            1340,
            "Whether an alternative action for the inline suggestion is visible."
        ))));
    }
    static {
        this.inlineSuggestionHasIndentation = ( new RawContextKey("inlineSuggestionHasIndentation", false, ( localize(1341, "Whether the inline suggestion starts with whitespace"))));
    }
    static {
        this.inlineSuggestionHasIndentationLessThanTabSize = ( new RawContextKey("inlineSuggestionHasIndentationLessThanTabSize", true, ( localize(
            1342,
            "Whether the inline suggestion starts with whitespace that is less than what would be inserted by tab"
        ))));
    }
    static {
        this.suppressSuggestions = ( new RawContextKey("inlineSuggestionSuppressSuggestions", undefined, ( localize(
            1343,
            "Whether suggestions should be suppressed for the current suggestion"
        ))));
    }
    static {
        this.cursorBeforeGhostText = ( new RawContextKey("cursorBeforeGhostText", false, ( localize(1344, "Whether the cursor is at ghost text"))));
    }
    static {
        this.cursorInIndentation = ( new RawContextKey("cursorInIndentation", false, ( localize(1345, "Whether the cursor is in indentation"))));
    }
    static {
        this.hasSelection = ( new RawContextKey("editor.hasSelection", false, ( localize(1346, "Whether the editor has a selection"))));
    }
    static {
        this.cursorAtInlineEdit = ( new RawContextKey("cursorAtInlineEdit", false, ( localize(1347, "Whether the cursor is at an inline edit"))));
    }
    static {
        this.inlineEditVisible = ( new RawContextKey("inlineEditIsVisible", false, ( localize(1348, "Whether an inline edit is visible"))));
    }
    static {
        this.tabShouldJumpToInlineEdit = ( new RawContextKey("tabShouldJumpToInlineEdit", false, ( localize(1349, "Whether tab should jump to an inline edit."))));
    }
    static {
        this.tabShouldAcceptInlineEdit = ( new RawContextKey("tabShouldAcceptInlineEdit", false, ( localize(1350, "Whether tab should accept the inline edit."))));
    }
    static {
        this.inInlineEditsPreviewEditor = ( new RawContextKey("inInlineEditsPreviewEditor", true, ( localize(1351, "Whether the current code editor is showing an inline edits preview"))));
    }
}

export { InlineCompletionContextKeys };
