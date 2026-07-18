
import { Emitter } from '../../../../base/common/event.js';
import { localize } from '../../../../nls.js';
import { Extensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import '../../../../platform/instantiation/common/instantiation.js';

class BreadcrumbsService {
    constructor() {
        this._map = ( new Map());
    }
    register(group, widget) {
        if (( this._map.has(group))) {
            throw ( new Error(`group (${group}) has already a widget`));
        }
        this._map.set(group, widget);
        return {
            dispose: () => this._map.delete(group)
        };
    }
    getWidget(group) {
        return this._map.get(group);
    }
}
class BreadcrumbsConfig {
    constructor() {}
    static {
        this.IsEnabled = BreadcrumbsConfig._stub("breadcrumbs.enabled");
    }
    static {
        this.UseQuickPick = BreadcrumbsConfig._stub("breadcrumbs.useQuickPick");
    }
    static {
        this.FilePath = BreadcrumbsConfig._stub("breadcrumbs.filePath");
    }
    static {
        this.SymbolPath = BreadcrumbsConfig._stub("breadcrumbs.symbolPath");
    }
    static {
        this.SymbolSortOrder = BreadcrumbsConfig._stub("breadcrumbs.symbolSortOrder");
    }
    static {
        this.SymbolPathSeparator = BreadcrumbsConfig._stub("breadcrumbs.symbolPathSeparator");
    }
    static {
        this.Icons = BreadcrumbsConfig._stub("breadcrumbs.icons");
    }
    static {
        this.TitleScrollbarSizing = BreadcrumbsConfig._stub("workbench.editor.titleScrollbarSizing");
    }
    static {
        this.TitleScrollbarVisibility = BreadcrumbsConfig._stub("workbench.editor.titleScrollbarVisibility");
    }
    static {
        this.FileExcludes = BreadcrumbsConfig._stub("files.exclude");
    }
    static _stub(name) {
        return {
            bindTo(service) {
                const onDidChange = ( new Emitter());
                const listener = service.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration(name)) {
                        onDidChange.fire(undefined);
                    }
                });
                return new (class {
                    constructor() {
                        this.name = name;
                        this.onDidChange = onDidChange.event;
                    }
                    getValue(overrides) {
                        if (overrides) {
                            return service.getValue(name, overrides);
                        } else {
                            return service.getValue(name);
                        }
                    }
                    updateValue(newValue, overrides) {
                        if (overrides) {
                            return service.updateValue(name, newValue, overrides);
                        } else {
                            return service.updateValue(name, newValue);
                        }
                    }
                    dispose() {
                        listener.dispose();
                        onDidChange.dispose();
                    }
                })();
            }
        };
    }
}
( Registry.as(Extensions.Configuration)).registerConfiguration({
    id: "breadcrumbs",
    title: ( localize(3311, "Breadcrumb Navigation")),
    order: 101,
    type: "object",
    properties: {
        "breadcrumbs.enabled": {
            description: ( localize(3312, "Enable/disable navigation breadcrumbs.")),
            type: "boolean",
            default: true,
            agentsWindow: {
                default: false
            }
        },
        "breadcrumbs.filePath": {
            description: ( localize(
                3313,
                "Controls whether and how file paths are shown in the breadcrumbs view."
            )),
            type: "string",
            default: "on",
            enum: ["on", "off", "last"],
            enumDescriptions: [( localize(3314, "Show the file path in the breadcrumbs view.")), ( localize(3315, "Do not show the file path in the breadcrumbs view.")), ( localize(
                3316,
                "Only show the last element of the file path in the breadcrumbs view."
            ))]
        },
        "breadcrumbs.symbolPath": {
            description: ( localize(
                3317,
                "Controls whether and how symbols are shown in the breadcrumbs view."
            )),
            type: "string",
            default: "on",
            enum: ["on", "off", "last"],
            enumDescriptions: [( localize(3318, "Show all symbols in the breadcrumbs view.")), ( localize(3319, "Do not show symbols in the breadcrumbs view.")), ( localize(3320, "Only show the current symbol in the breadcrumbs view."))]
        },
        "breadcrumbs.symbolSortOrder": {
            description: ( localize(3321, "Controls how symbols are sorted in the breadcrumbs outline view.")),
            type: "string",
            default: "position",
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            enum: ["position", "name", "type"],
            enumDescriptions: [( localize(3322, "Show symbol outline in file position order.")), ( localize(3323, "Show symbol outline in alphabetical order.")), ( localize(3324, "Show symbol outline in symbol type order."))]
        },
        "breadcrumbs.icons": {
            description: ( localize(3325, "Render breadcrumb items with icons.")),
            type: "boolean",
            default: true
        },
        "breadcrumbs.symbolPathSeparator": {
            description: ( localize(3326, "The separator used when copying the breadcrumb symbol path.")),
            type: "string",
            default: ".",
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
        },
        "breadcrumbs.showFiles": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3327, "When enabled breadcrumbs show `file`-symbols."))
        },
        "breadcrumbs.showModules": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3328, "When enabled breadcrumbs show `module`-symbols."))
        },
        "breadcrumbs.showNamespaces": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3329, "When enabled breadcrumbs show `namespace`-symbols."))
        },
        "breadcrumbs.showPackages": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3330, "When enabled breadcrumbs show `package`-symbols."))
        },
        "breadcrumbs.showClasses": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3331, "When enabled breadcrumbs show `class`-symbols."))
        },
        "breadcrumbs.showMethods": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3332, "When enabled breadcrumbs show `method`-symbols."))
        },
        "breadcrumbs.showProperties": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3333, "When enabled breadcrumbs show `property`-symbols."))
        },
        "breadcrumbs.showFields": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3334, "When enabled breadcrumbs show `field`-symbols."))
        },
        "breadcrumbs.showConstructors": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3335, "When enabled breadcrumbs show `constructor`-symbols."))
        },
        "breadcrumbs.showEnums": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3336, "When enabled breadcrumbs show `enum`-symbols."))
        },
        "breadcrumbs.showInterfaces": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3337, "When enabled breadcrumbs show `interface`-symbols."))
        },
        "breadcrumbs.showFunctions": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3338, "When enabled breadcrumbs show `function`-symbols."))
        },
        "breadcrumbs.showVariables": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3339, "When enabled breadcrumbs show `variable`-symbols."))
        },
        "breadcrumbs.showConstants": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3340, "When enabled breadcrumbs show `constant`-symbols."))
        },
        "breadcrumbs.showStrings": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3341, "When enabled breadcrumbs show `string`-symbols."))
        },
        "breadcrumbs.showNumbers": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3342, "When enabled breadcrumbs show `number`-symbols."))
        },
        "breadcrumbs.showBooleans": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3343, "When enabled breadcrumbs show `boolean`-symbols."))
        },
        "breadcrumbs.showArrays": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3344, "When enabled breadcrumbs show `array`-symbols."))
        },
        "breadcrumbs.showObjects": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3345, "When enabled breadcrumbs show `object`-symbols."))
        },
        "breadcrumbs.showKeys": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3346, "When enabled breadcrumbs show `key`-symbols."))
        },
        "breadcrumbs.showNull": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3347, "When enabled breadcrumbs show `null`-symbols."))
        },
        "breadcrumbs.showEnumMembers": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3348, "When enabled breadcrumbs show `enumMember`-symbols."))
        },
        "breadcrumbs.showStructs": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3349, "When enabled breadcrumbs show `struct`-symbols."))
        },
        "breadcrumbs.showEvents": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3350, "When enabled breadcrumbs show `event`-symbols."))
        },
        "breadcrumbs.showOperators": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3351, "When enabled breadcrumbs show `operator`-symbols."))
        },
        "breadcrumbs.showTypeParameters": {
            type: "boolean",
            default: true,
            scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
            markdownDescription: ( localize(3352, "When enabled breadcrumbs show `typeParameter`-symbols."))
        }
    }
});

export { BreadcrumbsConfig, BreadcrumbsService };
