
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { createHotClass } from '../../../../base/common/hotReloadHelpers.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import '../../../../base/common/observableInternal/index.js';
import Severity$1 from '../../../../base/common/severity.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { InlineCompletionsController } from '../../../../editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.js';
import { localize } from '../../../../nls.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.service.js';
import { IEditorService } from '../../../services/editor/common/editorService.service.js';
import { ILanguageStatusService } from '../../../services/languageStatus/common/languageStatusService.service.js';
import { observableFromEvent } from '../../../../base/common/observableInternal/observables/observableFromEvent.js';
import { derived } from '../../../../base/common/observableInternal/observables/derived.js';
import { debouncedObservable } from '../../../../base/common/observableInternal/utils/utils.js';
import { autorunWithStore } from '../../../../base/common/observableInternal/reactions/autorun.js';

let InlineCompletionLanguageStatusBarContribution = class InlineCompletionLanguageStatusBarContribution extends Disposable {
    static {
        this.hot = createHotClass(this);
    }
    static {
        this.Id = "vs.contrib.inlineCompletionLanguageStatusBarContribution";
    }
    static {
        this.languageStatusBarDisposables = ( new Set());
    }
    constructor(_languageStatusService, _editorService, _chatEntitlementService) {
        super();
        this._languageStatusService = _languageStatusService;
        this._editorService = _editorService;
        this._chatEntitlementService = _chatEntitlementService;
        this._activeEditor = observableFromEvent(
            this,
            _editorService.onDidActiveEditorChange,
            () => this._editorService.activeTextEditorControl
        );
        this._sentiment = this._chatEntitlementService.sentimentObs;
        this._state = derived(this, reader => {
            const editor = this._activeEditor.read(reader);
            if (!editor || !isCodeEditor(editor)) {
                return undefined;
            }
            const c = InlineCompletionsController.get(editor);
            const model = c?.model.read(reader);
            if (!model) {
                return undefined;
            }
            return {
                model,
                status: debouncedObservable(model.status, 300)
            };
        });
        this._register(autorunWithStore((reader, store) => {
            const sentiment = this._sentiment.read(reader);
            if (sentiment.hidden) {
                return;
            }
            const state = this._state.read(reader);
            if (!state) {
                return;
            }
            const status = state.status.read(reader);
            const statusMap = {
                loading: {
                    shortLabel: "",
                    label: ( localize(11378, "Loading...")),
                    loading: true
                },
                ghostText: {
                    shortLabel: "$(lightbulb)",
                    label: "$(copilot) " + ( localize(11379, "Inline completion available")),
                    loading: false
                },
                inlineEdit: {
                    shortLabel: "$(lightbulb-sparkle)",
                    label: "$(copilot) " + ( localize(11380, "Inline edit available")),
                    loading: false
                },
                noSuggestion: {
                    shortLabel: "$(circle-slash)",
                    label: "$(copilot) " + ( localize(11381, "No inline suggestion available")),
                    loading: false
                }
            };
            store.add(this._languageStatusService.addStatus({
                accessibilityInfo: undefined,
                busy: statusMap[status].loading,
                command: undefined,
                detail: ( localize(11382, "Inline suggestions")),
                id: "inlineSuggestions",
                label: {
                    value: statusMap[status].label,
                    shortValue: statusMap[status].shortLabel
                },
                name: ( localize(11383, "Inline Suggestions")),
                selector: {
                    pattern: state.model.textModel.uri.fsPath
                },
                severity: Severity$1.Info,
                source: "inlineSuggestions"
            }));
        }));
    }
};
InlineCompletionLanguageStatusBarContribution = ( __decorate([( __param(0, ILanguageStatusService)), ( __param(1, IEditorService)), ( __param(2, IChatEntitlementService))], InlineCompletionLanguageStatusBarContribution));

export { InlineCompletionLanguageStatusBarContribution };
