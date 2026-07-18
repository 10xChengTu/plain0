
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { ILanguageService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages/language.service';
import { IModelService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service';
import { ExtHostContext, MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { Range } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/core/range';
import { FontStyle, TokenMetadata } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/encodedTokenAttributes';
import { TokenizationRegistry } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/languages';
import { Color } from '@codingame/monaco-vscode-api/vscode/vs/base/common/color';
import { ITextModelService } from '@codingame/monaco-vscode-api/vscode/vs/editor/common/services/resolverService.service';
import { ILanguageStatusService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service';
import { Disposable, DisposableMap } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { ITextMateTokenizationService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/textMate/browser/textMateTokenizationFeature.service';
import { IThemeService } from '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service';

let MainThreadLanguages = class MainThreadLanguages extends Disposable {
    constructor(
        _extHostContext,
        _languageService,
        _modelService,
        _resolverService,
        _languageStatusService,
        _textMateService,
        themeService
    ) {
        super();
        this._languageService = _languageService;
        this._modelService = _modelService;
        this._resolverService = _resolverService;
        this._languageStatusService = _languageStatusService;
        this._textMateService = _textMateService;
        this._status = this._register(( new DisposableMap()));
        this._proxy = ( _extHostContext.getProxy(ExtHostContext.ExtHostLanguages));
        this._proxy.$acceptLanguageIds(_languageService.getRegisteredLanguageIds());
        this._register(_languageService.onDidChange(_ => {
            this._proxy.$acceptLanguageIds(_languageService.getRegisteredLanguageIds());
        }));
        this._register(themeService.onDidColorThemeChange(() => {
            this._proxy.$acceptSyntaxHighlightingThemeChanged();
        }));
    }
    async $changeLanguage(resource, languageId) {
        if (!this._languageService.isRegisteredLanguageId(languageId)) {
            return Promise.reject(( new Error(`Unknown language id: ${languageId}`)));
        }
        const uri = URI.revive(resource);
        const ref = await this._resolverService.createModelReference(uri);
        try {
            ref.object.textEditorModel.setLanguage(this._languageService.createById(languageId));
        } finally {
            ref.dispose();
        }
    }
    async $tokensAtPosition(resource, position) {
        const uri = URI.revive(resource);
        const model = this._modelService.getModel(uri);
        if (!model) {
            return undefined;
        }
        model.tokenization.tokenizeIfCheap(position.lineNumber);
        const tokens = model.tokenization.getLineTokens(position.lineNumber);
        const idx = tokens.findTokenIndexAtOffset(position.column - 1);
        return {
            type: tokens.getStandardTokenType(idx),
            range: ( new Range(
                position.lineNumber,
                1 + tokens.getStartOffset(idx),
                position.lineNumber,
                1 + tokens.getEndOffset(idx)
            ))
        };
    }
    async $computeFullSyntaxHighlighting(source, languageId) {
        const colorMap = ( (TokenizationRegistry.getColorMap() ?? []).map(c => c ? Color.Format.CSS.formatHexA(c) : ""));
        const resolvedLanguageId = this._languageService.isRegisteredLanguageId(languageId) ? languageId : this._languageService.getLanguageIdByLanguageName(languageId);
        const grammar = resolvedLanguageId ? await this._textMateService.createTokenizer(resolvedLanguageId) : null;
        if (!grammar) {
            const tokens = source.length === 0 ? [] : [{
                length: source.length,
                foreground: 0,
                fontStyle: FontStyle.None
            }];
            return {
                tokens,
                colorMap
            };
        }
        const tokens = [];
        const lines = source.split("\n");
        let state = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const result = grammar.tokenizeLine2(line, state, 500);
            state = result.ruleStack;
            const binary = result.tokens;
            for (let j = 0; j < binary.length; j += 2) {
                const startOffset = binary[j];
                const metadata = binary[j + 1];
                const endOffset = j + 2 < binary.length ? binary[j + 2] : line.length;
                if (endOffset > startOffset) {
                    tokens.push({
                        length: endOffset - startOffset,
                        foreground: TokenMetadata.getForeground(metadata),
                        fontStyle: TokenMetadata.getFontStyle(metadata)
                    });
                }
            }
            if (i < lines.length - 1) {
                tokens.push({
                    length: 1,
                    foreground: 0,
                    fontStyle: FontStyle.None
                });
            }
        }
        return {
            tokens,
            colorMap
        };
    }
    $setLanguageStatus(handle, status) {
        this._status.set(handle, this._languageStatusService.addStatus(status));
    }
    $removeLanguageStatus(handle) {
        this._status.deleteAndDispose(handle);
    }
};
MainThreadLanguages = __decorate([extHostNamedCustomer(MainContext.MainThreadLanguages), ( __param(1, ILanguageService)), ( __param(2, IModelService)), ( __param(3, ITextModelService)), ( __param(4, ILanguageStatusService)), ( __param(5, ITextMateTokenizationService)), ( __param(6, IThemeService))], MainThreadLanguages);

export { MainThreadLanguages };
