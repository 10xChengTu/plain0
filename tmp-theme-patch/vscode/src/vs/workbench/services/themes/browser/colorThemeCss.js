
import { getColorRegistry, asCssVariableName } from '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colorUtils';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/baseColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/chartsColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/editorColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/inputColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/listColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/menuColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/minimapColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/miscColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/quickpickColors';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/colors/searchColors';
import { getSizeRegistry, asCssVariableName as asCssVariableName$1, sizeValueToCss } from '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/sizeUtils';
import '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/sizes/baseSizes';

function generateColorThemeCSS(theme, scopeSelector, themingParticipants, environmentService) {
    const cssRules = ( new Set());
    const ruleCollector = {
        addRule: rule => {
            if (!( cssRules.has(rule))) {
                cssRules.add(rule);
            }
        }
    };
    ruleCollector.addRule(`${scopeSelector} { forced-color-adjust: none; }`);
    if (themingParticipants && environmentService) {
        for (const participant of themingParticipants) {
            participant(theme, ruleCollector, environmentService);
        }
    }
    const variables = [];
    for (const item of getColorRegistry().getColors()) {
        const color = theme.getColor(item.id, true);
        if (color) {
            variables.push(`${asCssVariableName(item.id)}: ${( color.toString())};`);
        }
    }
    for (const item of getSizeRegistry().getSizes()) {
        const sizeValue = getSizeRegistry().resolveDefaultSize(item.id, theme);
        if (sizeValue) {
            variables.push(`${asCssVariableName$1(item.id)}: ${sizeValueToCss(sizeValue)};`);
        }
    }
    ruleCollector.addRule(`${scopeSelector} { ${variables.join("\n")} }`);
    return ( new CSSValue([...cssRules].join("\n")));
}
class CSSValue {
    constructor(code) {
        this.code = code;
    }
}

export { CSSValue, generateColorThemeCSS };
