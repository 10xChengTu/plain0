
import { localize } from '../../../../nls.js';
import { ExtensionsRegistry } from '../../extensions/common/extensionsRegistry.js';
import { languagesExtPoint } from '../../language/common/languageService.js';

const grammarsExtPoint = ExtensionsRegistry.registerExtensionPoint({
    extensionPoint: "grammars",
    deps: [languagesExtPoint],
    jsonSchema: {
        description: ( localize(17941, "Contributes textmate tokenizers.")),
        type: "array",
        defaultSnippets: [{
            body: [{
                language: "${1:id}",
                scopeName: "source.${2:id}",
                path: "./syntaxes/${3:id}.tmLanguage."
            }]
        }],
        items: {
            type: "object",
            defaultSnippets: [{
                body: {
                    language: "${1:id}",
                    scopeName: "source.${2:id}",
                    path: "./syntaxes/${3:id}.tmLanguage."
                }
            }],
            properties: {
                language: {
                    description: ( localize(17942, "Language identifier for which this syntax is contributed to.")),
                    type: "string"
                },
                scopeName: {
                    description: ( localize(17943, "Textmate scope name used by the tmLanguage file.")),
                    type: "string"
                },
                path: {
                    description: ( localize(
                        17944,
                        "Path of the tmLanguage file. The path is relative to the extension folder and typically starts with './syntaxes/'."
                    )),
                    type: "string"
                },
                embeddedLanguages: {
                    description: ( localize(
                        17945,
                        "A map of scope name to language id if this grammar contains embedded languages."
                    )),
                    type: "object"
                },
                tokenTypes: {
                    description: ( localize(17946, "A map of scope name to token types.")),
                    type: "object",
                    additionalProperties: {
                        enum: ["string", "comment", "other", "regex"]
                    }
                },
                injectTo: {
                    description: ( localize(
                        17947,
                        "List of language scope names to which this grammar is injected to."
                    )),
                    type: "array",
                    items: {
                        type: "string"
                    }
                },
                balancedBracketScopes: {
                    description: ( localize(17948, "Defines which scope names contain balanced brackets.")),
                    type: "array",
                    items: {
                        type: "string"
                    },
                    default: ["*"]
                },
                unbalancedBracketScopes: {
                    description: ( localize(17949, "Defines which scope names do not contain balanced brackets.")),
                    type: "array",
                    items: {
                        type: "string"
                    },
                    default: []
                }
            },
            required: ["scopeName", "path"]
        }
    }
});

export { grammarsExtPoint };
