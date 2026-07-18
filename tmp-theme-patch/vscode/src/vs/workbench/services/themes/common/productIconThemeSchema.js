
import { localize } from '@codingame/monaco-vscode-api/vscode/vs/nls';
import { Registry } from '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform';
import { Extensions } from '@codingame/monaco-vscode-api/vscode/vs/platform/jsonschemas/common/jsonContributionRegistry';
import { iconsSchemaId, fontStyleRegex, fontWeightRegex, fontIdErrorMessage, fontIdRegex } from '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/iconRegistry';

const schemaId = "vscode://schemas/product-icon-theme";
const schema = {
    type: "object",
    allowComments: true,
    allowTrailingCommas: true,
    properties: {
        fonts: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: ( localize(18088, "The ID of the font.")),
                        pattern: fontIdRegex.source,
                        patternErrorMessage: fontIdErrorMessage
                    },
                    src: {
                        type: "array",
                        description: ( localize(18089, "The location of the font.")),
                        items: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: ( localize(18090, "The font path, relative to the current product icon theme file."))
                                },
                                format: {
                                    type: "string",
                                    description: ( localize(18091, "The format of the font.")),
                                    enum: ["woff", "woff2", "truetype", "opentype", "embedded-opentype", "svg"]
                                }
                            },
                            required: ["path", "format"]
                        }
                    },
                    weight: {
                        type: "string",
                        description: ( localize(
                            18092,
                            "The weight of the font. See https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight for valid values."
                        )),
                        anyOf: [{
                            enum: ["normal", "bold", "lighter", "bolder"]
                        }, {
                            type: "string",
                            pattern: fontWeightRegex.source
                        }]
                    },
                    style: {
                        type: "string",
                        description: ( localize(
                            18093,
                            "The style of the font. See https://developer.mozilla.org/en-US/docs/Web/CSS/font-style for valid values."
                        )),
                        anyOf: [{
                            enum: ["normal", "italic", "oblique"]
                        }, {
                            type: "string",
                            pattern: fontStyleRegex.source
                        }]
                    }
                },
                required: ["id", "src"]
            }
        },
        iconDefinitions: {
            description: ( localize(18094, "Association of icon name to a font character.")),
            $ref: iconsSchemaId
        }
    }
};
function registerProductIconThemeSchemas() {
    const schemaRegistry = ( Registry.as(Extensions.JSONContribution));
    schemaRegistry.registerSchema(schemaId, schema);
}

export { registerProductIconThemeSchemas };
