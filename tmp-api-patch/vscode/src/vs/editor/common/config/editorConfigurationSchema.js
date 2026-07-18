
import { diffEditorDefaultOptions } from './diffEditor.js';
import { editorOptionsRegistry } from './editorOptions.js';
import { EDITOR_MODEL_DEFAULTS } from '../core/misc/textModelDefaults.js';
import { localize } from '../../../nls.js';
import { ConfigurationScope, Extensions } from '../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../platform/registry/common/platform.js';

const editorConfigurationBaseNode = ( Object.freeze({
    id: "editor",
    order: 5,
    type: "object",
    title: ( localize(240, "Editor")),
    scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
}));
const editorConfiguration = {
    ...editorConfigurationBaseNode,
    properties: {
        "editor.tabSize": {
            type: "number",
            default: EDITOR_MODEL_DEFAULTS.tabSize,
            minimum: 1,
            maximum: 100,
            markdownDescription: ( localize(
                241,
                "The number of spaces a tab is equal to. This setting is overridden based on the file contents when {0} is on.",
                "`#editor.detectIndentation#`"
            ))
        },
        "editor.indentSize": {
            "anyOf": [{
                type: "string",
                enum: ["tabSize"]
            }, {
                type: "number",
                minimum: 1
            }],
            default: "tabSize",
            markdownDescription: ( localize(
                242,
                "The number of spaces used for indentation or `\"tabSize\"` to use the value from `#editor.tabSize#`. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on."
            ))
        },
        "editor.insertSpaces": {
            type: "boolean",
            default: EDITOR_MODEL_DEFAULTS.insertSpaces,
            markdownDescription: ( localize(
                243,
                "Insert spaces when pressing `Tab`. This setting is overridden based on the file contents when {0} is on.",
                "`#editor.detectIndentation#`"
            ))
        },
        "editor.detectIndentation": {
            type: "boolean",
            default: EDITOR_MODEL_DEFAULTS.detectIndentation,
            markdownDescription: ( localize(
                244,
                "Controls whether {0} and {1} will be automatically detected when a file is opened based on the file contents.",
                "`#editor.tabSize#`",
                "`#editor.insertSpaces#`"
            ))
        },
        "editor.trimAutoWhitespace": {
            type: "boolean",
            default: EDITOR_MODEL_DEFAULTS.trimAutoWhitespace,
            description: ( localize(245, "Remove trailing auto inserted whitespace."))
        },
        "editor.largeFileOptimizations": {
            type: "boolean",
            default: EDITOR_MODEL_DEFAULTS.largeFileOptimizations,
            description: ( localize(
                246,
                "Special handling for large files to disable certain memory intensive features."
            ))
        },
        "editor.wordBasedSuggestions": {
            enum: [
                "off",
                "offWithInlineSuggestions",
                "currentDocument",
                "matchingDocuments",
                "allDocuments"
            ],
            default: "offWithInlineSuggestions",
            enumDescriptions: [( localize(247, "Turn off Word Based Suggestions.")), ( localize(
                248,
                "Turn off Word Based Suggestions when Inline Suggestions are present."
            )), ( localize(249, "Only suggest words from the active document.")), ( localize(250, "Suggest words from all open documents of the same language.")), ( localize(251, "Suggest words from all open documents."))],
            description: ( localize(
                252,
                "Controls whether completions should be computed based on words in the document and from which documents they are computed."
            )),
            experiment: {
                mode: "auto"
            }
        },
        "editor.semanticHighlighting.enabled": {
            enum: [true, false, "configuredByTheme"],
            enumDescriptions: [( localize(253, "Semantic highlighting enabled for all color themes.")), ( localize(254, "Semantic highlighting disabled for all color themes.")), ( localize(
                255,
                "Semantic highlighting is configured by the current color theme's `semanticHighlighting` setting."
            ))],
            default: "configuredByTheme",
            description: ( localize(
                256,
                "Controls whether the semanticHighlighting is shown for the languages that support it."
            ))
        },
        "editor.stablePeek": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                257,
                "Keep peek editors open even when double-clicking their content or when hitting `Escape`."
            ))
        },
        "editor.maxTokenizationLineLength": {
            type: "integer",
            default: 20_000,
            description: ( localize(
                258,
                "Lines above this length will not be tokenized for performance reasons"
            ))
        },
        "editor.experimental.asyncTokenization": {
            type: "boolean",
            default: true,
            description: ( localize(
                259,
                "Controls whether the tokenization should happen asynchronously on a web worker."
            )),
            tags: ["experimental"]
        },
        "editor.experimental.asyncTokenizationLogging": {
            type: "boolean",
            default: false,
            description: ( localize(
                260,
                "Controls whether async tokenization should be logged. For debugging only."
            ))
        },
        "editor.experimental.asyncTokenizationVerification": {
            type: "boolean",
            default: false,
            description: ( localize(
                261,
                "Controls whether async tokenization should be verified against legacy background tokenization. Might slow down tokenization. For debugging only."
            )),
            tags: ["experimental"]
        },
        "editor.experimental.treeSitterTelemetry": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                262,
                "Controls whether tree sitter parsing should be turned on and telemetry collected. Setting `#editor.experimental.preferTreeSitter#` for specific languages will take precedence."
            )),
            tags: ["experimental"],
            experiment: {
                mode: "auto"
            }
        },
        "editor.experimental.preferTreeSitter.css": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                263,
                "Controls whether tree sitter parsing should be turned on for css. This will take precedence over `#editor.experimental.treeSitterTelemetry#` for css."
            )),
            tags: ["experimental"],
            experiment: {
                mode: "auto"
            }
        },
        "editor.experimental.preferTreeSitter.typescript": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                264,
                "Controls whether tree sitter parsing should be turned on for typescript. This will take precedence over `#editor.experimental.treeSitterTelemetry#` for typescript."
            )),
            tags: ["experimental"],
            experiment: {
                mode: "auto"
            }
        },
        "editor.experimental.preferTreeSitter.ini": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                265,
                "Controls whether tree sitter parsing should be turned on for ini. This will take precedence over `#editor.experimental.treeSitterTelemetry#` for ini."
            )),
            tags: ["experimental"],
            experiment: {
                mode: "auto"
            }
        },
        "editor.experimental.preferTreeSitter.regex": {
            type: "boolean",
            default: false,
            markdownDescription: ( localize(
                266,
                "Controls whether tree sitter parsing should be turned on for regex. This will take precedence over `#editor.experimental.treeSitterTelemetry#` for regex."
            )),
            tags: ["experimental"],
            experiment: {
                mode: "auto"
            }
        },
        "editor.language.brackets": {
            type: ["array", "null"],
            default: null,
            description: ( localize(
                267,
                "Defines the bracket symbols that increase or decrease the indentation."
            )),
            items: {
                type: "array",
                items: [{
                    type: "string",
                    description: ( localize(268, "The opening bracket character or string sequence."))
                }, {
                    type: "string",
                    description: ( localize(269, "The closing bracket character or string sequence."))
                }]
            }
        },
        "editor.language.colorizedBracketPairs": {
            type: ["array", "null"],
            default: null,
            description: ( localize(
                270,
                "Defines the bracket pairs that are colorized by their nesting level if bracket pair colorization is enabled."
            )),
            items: {
                type: "array",
                items: [{
                    type: "string",
                    description: ( localize(268, "The opening bracket character or string sequence."))
                }, {
                    type: "string",
                    description: ( localize(269, "The closing bracket character or string sequence."))
                }]
            }
        },
        "diffEditor.maxComputationTime": {
            type: "number",
            default: diffEditorDefaultOptions.maxComputationTime,
            description: ( localize(
                271,
                "Timeout in milliseconds after which diff computation is cancelled. Use 0 for no timeout."
            ))
        },
        "diffEditor.maxFileSize": {
            type: "number",
            default: diffEditorDefaultOptions.maxFileSize,
            description: ( localize(
                272,
                "Maximum file size in MB for which to compute diffs. Use 0 for no limit."
            ))
        },
        "diffEditor.renderSideBySide": {
            type: "boolean",
            default: diffEditorDefaultOptions.renderSideBySide,
            description: ( localize(
                273,
                "Controls whether the diff editor shows the diff side by side or inline."
            )),
            agentsWindow: {
                default: true
            }
        },
        "diffEditor.renderSideBySideInlineBreakpoint": {
            type: "number",
            default: diffEditorDefaultOptions.renderSideBySideInlineBreakpoint,
            description: ( localize(
                274,
                "If the diff editor width is smaller than this value, the inline view is used."
            ))
        },
        "diffEditor.useInlineViewWhenSpaceIsLimited": {
            type: "boolean",
            default: diffEditorDefaultOptions.useInlineViewWhenSpaceIsLimited,
            description: ( localize(
                275,
                "If enabled and the editor width is too small, the inline view is used."
            )),
            agentsWindow: {
                default: true
            }
        },
        "diffEditor.renderMarginRevertIcon": {
            type: "boolean",
            default: diffEditorDefaultOptions.renderMarginRevertIcon,
            description: ( localize(
                276,
                "When enabled, the diff editor shows arrows in its glyph margin to revert changes."
            )),
            agentsWindow: {
                default: false
            }
        },
        "diffEditor.renderGutterMenu": {
            type: "boolean",
            default: diffEditorDefaultOptions.renderGutterMenu,
            description: ( localize(
                277,
                "When enabled, the diff editor shows a special gutter for revert and stage actions."
            )),
            agentsWindow: {
                default: false
            }
        },
        "diffEditor.ignoreTrimWhitespace": {
            type: "boolean",
            default: diffEditorDefaultOptions.ignoreTrimWhitespace,
            description: ( localize(
                278,
                "When enabled, the diff editor ignores changes in leading or trailing whitespace."
            ))
        },
        "diffEditor.renderIndicators": {
            type: "boolean",
            default: diffEditorDefaultOptions.renderIndicators,
            description: ( localize(
                279,
                "Controls whether the diff editor shows +/- indicators for added/removed changes."
            )),
            agentsWindow: {
                default: false
            }
        },
        "diffEditor.codeLens": {
            type: "boolean",
            default: diffEditorDefaultOptions.diffCodeLens,
            description: ( localize(280, "Controls whether the editor shows CodeLens."))
        },
        "diffEditor.wordWrap": {
            type: "string",
            enum: ["off", "on", "inherit"],
            default: diffEditorDefaultOptions.diffWordWrap,
            markdownEnumDescriptions: [( localize(281, "Lines will never wrap.")), ( localize(282, "Lines will wrap at the viewport width.")), ( localize(
                283,
                "Lines will wrap according to the {0} setting.",
                "`#editor.wordWrap#`"
            ))]
        },
        "diffEditor.diffAlgorithm": {
            type: "string",
            enum: ["legacy", "advanced", "advanced-external", "advanced-wasm"],
            default: diffEditorDefaultOptions.diffAlgorithm,
            markdownEnumDescriptions: [( localize(284, "Uses the legacy diffing algorithm.")), ( localize(285, "Uses the advanced diffing algorithm.")), ( localize(
                286,
                "Uses the advanced diffing algorithm from the external `@vscode/diff` package (pure JavaScript)."
            )), ( localize(
                287,
                "Uses the advanced diffing algorithm from the external `@vscode/diff` package (WebAssembly)."
            ))]
        },
        "diffEditor.hideUnchangedRegions.enabled": {
            type: "boolean",
            default: diffEditorDefaultOptions.hideUnchangedRegions.enabled,
            markdownDescription: ( localize(288, "Controls whether the diff editor shows unchanged regions.")),
            agentsWindow: {
                default: true
            }
        },
        "diffEditor.hideUnchangedRegions.revealLineCount": {
            type: "integer",
            default: diffEditorDefaultOptions.hideUnchangedRegions.revealLineCount,
            markdownDescription: ( localize(289, "Controls how many lines are used for unchanged regions.")),
            minimum: 1
        },
        "diffEditor.hideUnchangedRegions.minimumLineCount": {
            type: "integer",
            default: diffEditorDefaultOptions.hideUnchangedRegions.minimumLineCount,
            markdownDescription: ( localize(
                290,
                "Controls how many lines are used as a minimum for unchanged regions."
            )),
            minimum: 1
        },
        "diffEditor.hideUnchangedRegions.contextLineCount": {
            type: "integer",
            default: diffEditorDefaultOptions.hideUnchangedRegions.contextLineCount,
            markdownDescription: ( localize(
                291,
                "Controls how many lines are used as context when comparing unchanged regions."
            )),
            minimum: 1
        },
        "diffEditor.experimental.showMoves": {
            type: "boolean",
            default: diffEditorDefaultOptions.experimental.showMoves,
            markdownDescription: ( localize(292, "Controls whether the diff editor should show detected code moves."))
        },
        "diffEditor.experimental.showEmptyDecorations": {
            type: "boolean",
            default: diffEditorDefaultOptions.experimental.showEmptyDecorations,
            description: ( localize(
                293,
                "Controls whether the diff editor shows empty decorations to see where characters got inserted or deleted."
            ))
        },
        "diffEditor.experimental.useTrueInlineView": {
            type: "boolean",
            default: diffEditorDefaultOptions.experimental.useTrueInlineView,
            description: ( localize(
                294,
                "If enabled and the editor uses the inline view, word changes are rendered inline."
            ))
        }
    }
};
function isConfigurationPropertySchema(x) {
    return (typeof x.type !== "undefined" || typeof x.anyOf !== "undefined");
}
for (const editorOption of editorOptionsRegistry) {
    const schema = editorOption.schema;
    if (typeof schema !== "undefined") {
        if (isConfigurationPropertySchema(schema)) {
            editorConfiguration.properties[`editor.${editorOption.name}`] = schema;
        } else {
            for (const key in schema) {
                if (Object.hasOwnProperty.call(schema, key)) {
                    editorConfiguration.properties[key] = schema[key];
                }
            }
        }
    }
}
let cachedEditorConfigurationKeys = null;
function getEditorConfigurationKeys() {
    if (cachedEditorConfigurationKeys === null) {
        cachedEditorConfigurationKeys = Object.create(null);
        ( Object.keys(editorConfiguration.properties)).forEach(prop => {
            cachedEditorConfigurationKeys[prop] = true;
        });
    }
    return cachedEditorConfigurationKeys;
}
function isEditorConfigurationKey(key) {
    const editorConfigurationKeys = getEditorConfigurationKeys();
    return (editorConfigurationKeys[`editor.${key}`] || false);
}
function isDiffEditorConfigurationKey(key) {
    const editorConfigurationKeys = getEditorConfigurationKeys();
    return (editorConfigurationKeys[`diffEditor.${key}`] || false);
}
const configurationRegistry = ( Registry.as(Extensions.Configuration));
configurationRegistry.registerConfiguration(editorConfiguration);
async function registerEditorFontConfigurations(getFontSnippets) {
    const editorKeysWithFont = ["editor.fontFamily"];
    const fontSnippets = await getFontSnippets();
    for (const key of editorKeysWithFont) {
        if (editorConfiguration.properties && editorConfiguration.properties[key]) {
            editorConfiguration.properties[key].defaultSnippets = fontSnippets;
        }
    }
}

export { editorConfigurationBaseNode, isDiffEditorConfigurationKey, isEditorConfigurationKey, registerEditorFontConfigurations };
