
import { localize } from '@codingame/monaco-vscode-api/vscode/vs/nls';
import { Registry } from '@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform';
import { Extensions } from '@codingame/monaco-vscode-api/vscode/vs/platform/jsonschemas/common/jsonContributionRegistry';
import { fontIdErrorMessage, fontIdRegex, fontSizeRegex, fontColorRegex, fontStyleRegex, fontWeightRegex } from '@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/iconRegistry';

const schemaId = "vscode://schemas/icon-theme";
const schema = {
    type: "object",
    allowComments: true,
    allowTrailingCommas: true,
    definitions: {
        folderExpanded: {
            type: "string",
            description: ( localize(
                18038,
                "The folder icon for expanded folders. The expanded folder icon is optional. If not set, the icon defined for folder will be shown."
            ))
        },
        folder: {
            type: "string",
            description: ( localize(
                18039,
                "The folder icon for collapsed folders, and if folderExpanded is not set, also for expanded folders."
            ))
        },
        file: {
            type: "string",
            description: ( localize(
                18040,
                "The default file icon, shown for all files that don't match any extension, filename or language id."
            ))
        },
        rootFolder: {
            type: "string",
            description: ( localize(
                18041,
                "The folder icon for collapsed root folders, and if rootFolderExpanded is not set, also for expanded root folders."
            ))
        },
        rootFolderExpanded: {
            type: "string",
            description: ( localize(
                18042,
                "The folder icon for expanded root folders. The expanded root folder icon is optional. If not set, the icon defined for root folder will be shown."
            ))
        },
        rootFolderNames: {
            type: "object",
            description: ( localize(
                18043,
                "Associates root folder names to icons. The object key is the root folder name. No patterns or wildcards are allowed. Root folder name matching is case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18044, "The ID of the icon definition for the association."))
            }
        },
        rootFolderNamesExpanded: {
            type: "object",
            description: ( localize(
                18045,
                "Associates root folder names to icons for expanded root folders. The object key is the root folder name. No patterns or wildcards are allowed. Root folder name matching is case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18046, "The ID of the icon definition for the association."))
            }
        },
        folderNames: {
            type: "object",
            description: ( localize(
                18047,
                "Associates folder names to icons. The object key is the folder name, not including any path segments. No patterns or wildcards are allowed. Folder name matching is case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18044, "The ID of the icon definition for the association."))
            }
        },
        folderNamesExpanded: {
            type: "object",
            description: ( localize(
                18048,
                "Associates folder names to icons for expanded folders. The object key is the folder name, not including any path segments. No patterns or wildcards are allowed. Folder name matching is case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18049, "The ID of the icon definition for the association."))
            }
        },
        fileExtensions: {
            type: "object",
            description: ( localize(
                18050,
                "Associates file extensions to icons. The object key is the file extension name. The extension name is the last segment of a file name after the last dot (not including the dot). Extensions are compared case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18051, "The ID of the icon definition for the association."))
            }
        },
        fileNames: {
            type: "object",
            description: ( localize(
                18052,
                "Associates file names to icons. The object key is the full file name, but not including any path segments. File name can include dots and a possible file extension. No patterns or wildcards are allowed. File name matching is case insensitive."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18053, "The ID of the icon definition for the association."))
            }
        },
        languageIds: {
            type: "object",
            description: ( localize(
                18054,
                "Associates languages to icons. The object key is the language id as defined in the language contribution point."
            )),
            additionalProperties: {
                type: "string",
                description: ( localize(18055, "The ID of the icon definition for the association."))
            }
        },
        associations: {
            type: "object",
            properties: {
                folderExpanded: {
                    $ref: "#/definitions/folderExpanded"
                },
                folder: {
                    $ref: "#/definitions/folder"
                },
                file: {
                    $ref: "#/definitions/file"
                },
                folderNames: {
                    $ref: "#/definitions/folderNames"
                },
                folderNamesExpanded: {
                    $ref: "#/definitions/folderNamesExpanded"
                },
                rootFolder: {
                    $ref: "#/definitions/rootFolder"
                },
                rootFolderExpanded: {
                    $ref: "#/definitions/rootFolderExpanded"
                },
                rootFolderNames: {
                    $ref: "#/definitions/rootFolderNames"
                },
                rootFolderNamesExpanded: {
                    $ref: "#/definitions/rootFolderNamesExpanded"
                },
                fileExtensions: {
                    $ref: "#/definitions/fileExtensions"
                },
                fileNames: {
                    $ref: "#/definitions/fileNames"
                },
                languageIds: {
                    $ref: "#/definitions/languageIds"
                }
            }
        }
    },
    properties: {
        fonts: {
            type: "array",
            description: ( localize(18056, "Fonts that are used in the icon definitions.")),
            items: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: ( localize(18057, "The ID of the font.")),
                        pattern: fontIdRegex.source,
                        patternErrorMessage: fontIdErrorMessage
                    },
                    src: {
                        type: "array",
                        description: ( localize(18058, "The location of the font.")),
                        items: {
                            type: "object",
                            properties: {
                                path: {
                                    type: "string",
                                    description: ( localize(18059, "The font path, relative to the current file icon theme file."))
                                },
                                format: {
                                    type: "string",
                                    description: ( localize(18060, "The format of the font.")),
                                    enum: ["woff", "woff2", "truetype", "opentype", "embedded-opentype", "svg"]
                                }
                            },
                            required: ["path", "format"]
                        }
                    },
                    weight: {
                        type: "string",
                        description: ( localize(
                            18061,
                            "The weight of the font. See https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight for valid values."
                        )),
                        pattern: fontWeightRegex.source
                    },
                    style: {
                        type: "string",
                        description: ( localize(
                            18062,
                            "The style of the font. See https://developer.mozilla.org/en-US/docs/Web/CSS/font-style for valid values."
                        )),
                        pattern: fontStyleRegex.source
                    },
                    size: {
                        type: "string",
                        description: ( localize(
                            18063,
                            "The default size of the font. We strongly recommend using a percentage value, for example: 125%."
                        )),
                        pattern: fontSizeRegex.source
                    }
                },
                required: ["id", "src"]
            }
        },
        iconDefinitions: {
            type: "object",
            description: ( localize(
                18064,
                "Description of all icons that can be used when associating files to icons."
            )),
            additionalProperties: {
                type: "object",
                description: ( localize(18065, "An icon definition. The object key is the ID of the definition.")),
                properties: {
                    iconPath: {
                        type: "string",
                        description: ( localize(
                            18066,
                            "When using a SVG or PNG: The path to the image. The path is relative to the icon set file."
                        ))
                    },
                    fontCharacter: {
                        type: "string",
                        description: ( localize(18067, "When using a glyph font: The character in the font to use."))
                    },
                    fontColor: {
                        type: "string",
                        format: "color-hex",
                        description: ( localize(18068, "When using a glyph font: The color to use.")),
                        pattern: fontColorRegex.source
                    },
                    fontSize: {
                        type: "string",
                        description: ( localize(
                            18069,
                            "When using a font: The font size in percentage to the text font. If not set, defaults to the size in the font definition."
                        )),
                        pattern: fontSizeRegex.source
                    },
                    fontId: {
                        type: "string",
                        description: ( localize(
                            18070,
                            "When using a font: The id of the font. If not set, defaults to the first font definition."
                        )),
                        pattern: fontIdRegex.source,
                        patternErrorMessage: fontIdErrorMessage
                    }
                }
            }
        },
        folderExpanded: {
            $ref: "#/definitions/folderExpanded"
        },
        folder: {
            $ref: "#/definitions/folder"
        },
        file: {
            $ref: "#/definitions/file"
        },
        folderNames: {
            $ref: "#/definitions/folderNames"
        },
        folderNamesExpanded: {
            $ref: "#/definitions/folderNamesExpanded"
        },
        rootFolder: {
            $ref: "#/definitions/rootFolder"
        },
        rootFolderExpanded: {
            $ref: "#/definitions/rootFolderExpanded"
        },
        rootFolderNames: {
            $ref: "#/definitions/rootFolderNames"
        },
        rootFolderNamesExpanded: {
            $ref: "#/definitions/rootFolderNamesExpanded"
        },
        fileExtensions: {
            $ref: "#/definitions/fileExtensions"
        },
        fileNames: {
            $ref: "#/definitions/fileNames"
        },
        languageIds: {
            $ref: "#/definitions/languageIds"
        },
        light: {
            $ref: "#/definitions/associations",
            description: ( localize(18071, "Optional associations for file icons in light color themes."))
        },
        highContrast: {
            $ref: "#/definitions/associations",
            description: ( localize(
                18072,
                "Optional associations for file icons in high contrast color themes."
            ))
        },
        hidesExplorerArrows: {
            type: "boolean",
            description: ( localize(
                18073,
                "Configures whether the file explorer's arrows should be hidden when this theme is active."
            ))
        },
        showLanguageModeIcons: {
            type: "boolean",
            description: ( localize(
                18074,
                "Configures whether the default language icons should be used if the theme does not define an icon for a language."
            ))
        }
    }
};
function registerFileIconThemeSchemas() {
    const schemaRegistry = ( Registry.as(Extensions.JSONContribution));
    schemaRegistry.registerSchema(schemaId, schema);
}

export { registerFileIconThemeSchemas };
