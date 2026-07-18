
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { withoutDuplicates } from '../../../../base/common/arrays.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import '../../../../base/common/observableInternal/index.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.service.js';
import { providerIdSchemaUri, inlineCompletionProviderGetMatcher } from '../../../../editor/contrib/inlineCompletions/browser/controller/commands.js';
import { Extensions } from '../../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { wrapInHotClass1 } from '../../../../platform/observable/common/wrapInHotClass.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { InlineCompletionLanguageStatusBarContribution } from './inlineCompletionLanguageStatusBarContribution.js';
import { observableFromEvent } from '../../../../base/common/observableInternal/observables/observableFromEvent.js';
import { autorun } from '../../../../base/common/observableInternal/reactions/autorun.js';

registerWorkbenchContribution2(
    InlineCompletionLanguageStatusBarContribution.Id,
    wrapInHotClass1(InlineCompletionLanguageStatusBarContribution.hot),
    WorkbenchPhase.Eventually
);
let InlineCompletionSchemaContribution = class InlineCompletionSchemaContribution extends Disposable {
    static {
        this.Id = "vs.contrib.InlineCompletionSchemaContribution";
    }
    constructor(_languageFeaturesService) {
        super();
        this._languageFeaturesService = _languageFeaturesService;
        const registry = ( Registry.as(Extensions.JSONContribution));
        const inlineCompletionsProvider = observableFromEvent(
            this,
            this._languageFeaturesService.inlineCompletionsProvider.onDidChange,
            () => this._languageFeaturesService.inlineCompletionsProvider.allNoModel()
        );
        this._register(autorun(reader => {
            const provider = inlineCompletionsProvider.read(reader);
            registry.registerSchema(providerIdSchemaUri, {
                enum: withoutDuplicates(provider.flatMap(p => inlineCompletionProviderGetMatcher(p)))
            }, reader.store);
        }));
    }
};
InlineCompletionSchemaContribution = ( __decorate([( __param(0, ILanguageFeaturesService))], InlineCompletionSchemaContribution));
registerWorkbenchContribution2(
    InlineCompletionSchemaContribution.Id,
    InlineCompletionSchemaContribution,
    WorkbenchPhase.Eventually
);

export { InlineCompletionSchemaContribution };
