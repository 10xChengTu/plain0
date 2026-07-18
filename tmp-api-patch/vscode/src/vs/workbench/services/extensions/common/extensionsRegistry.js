
import { localize } from '../../../../nls.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import Severity$1 from '../../../../base/common/severity.js';
import { EXTENSION_IDENTIFIER_PATTERN } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { Extensions } from '../../../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ExtensionIdentifierSet, EXTENSION_CATEGORIES } from '../../../../platform/extensions/common/extensions.js';
import { productSchemaId } from '../../../../platform/product/common/productService.js';
import { ImplicitActivationEvents } from '../../../../platform/extensionManagement/common/implicitActivationEvents.js';
import { allApiProposals } from '../../../../platform/extensions/common/extensionsApiProposals.js';

const schemaRegistry = ( Registry.as(Extensions.JSONContribution));
class ExtensionMessageCollector {
    constructor(messageHandler, extension, extensionPointId) {
        this._messageHandler = messageHandler;
        this._extension = extension;
        this._extensionPointId = extensionPointId;
    }
    _msg(type, message) {
        this._messageHandler({
            type: type,
            message: message,
            extensionId: this._extension.identifier,
            extensionPointId: this._extensionPointId
        });
    }
    error(message) {
        this._msg(Severity$1.Error, message);
    }
    warn(message) {
        this._msg(Severity$1.Warning, message);
    }
    info(message) {
        this._msg(Severity$1.Info, message);
    }
}
class ExtensionPointUserDelta {
    static _toSet(arr) {
        const result = ( new ExtensionIdentifierSet());
        for (let i = 0, len = arr.length; i < len; i++) {
            result.add(arr[i].description.identifier);
        }
        return result;
    }
    static compute(previous, current) {
        if (!previous || !previous.length) {
            return ( new ExtensionPointUserDelta(current, []));
        }
        if (!current || !current.length) {
            return ( new ExtensionPointUserDelta([], previous));
        }
        const previousSet = this._toSet(previous);
        const currentSet = this._toSet(current);
        const added = current.filter(user => !( previousSet.has(user.description.identifier)));
        const removed = previous.filter(user => !( currentSet.has(user.description.identifier)));
        return ( new ExtensionPointUserDelta(added, removed));
    }
    constructor(added, removed) {
        this.added = added;
        this.removed = removed;
    }
}
class ExtensionPoint {
    constructor(name, defaultExtensionKind, canHandleResolver) {
        this.name = name;
        this.defaultExtensionKind = defaultExtensionKind;
        this.canHandleResolver = canHandleResolver;
        this._handler = null;
        this._users = null;
        this._delta = null;
    }
    setHandler(handler) {
        if (this._handler !== null) {
            throw ( new Error("Handler already set!"));
        }
        this._handler = handler;
        this._handle();
        return {
            dispose: () => {
                this._handler = null;
            }
        };
    }
    acceptUsers(users) {
        this._delta = ExtensionPointUserDelta.compute(this._users, users);
        this._users = users;
        this._handle();
    }
    _handle() {
        if (this._handler === null || this._users === null || this._delta === null) {
            return;
        }
        try {
            this._handler(this._users, this._delta);
        } catch (err) {
            onUnexpectedError(err);
        }
    }
}
const extensionKindSchema = {
    type: "string",
    enum: ["ui", "workspace"],
    enumDescriptions: [( localize(
        17656,
        "UI extension kind. In a remote window, such extensions are enabled only when available on the local machine."
    )), ( localize(
        17657,
        "Workspace extension kind. In a remote window, such extensions are enabled only when available on the remote."
    ))]
};
const schemaId = "vscode://schemas/vscode-extensions";
const schema = {
    properties: {
        engines: {
            type: "object",
            description: ( localize(17658, "Engine compatibility.")),
            properties: {
                "vscode": {
                    type: "string",
                    description: ( localize(
                        17659,
                        "For VS Code extensions, specifies the VS Code version that the extension is compatible with. Cannot be *. For example: ^1.105.0 indicates compatibility with a minimum VS Code version of 1.105.0."
                    )),
                    default: "^1.105.0"
                }
            }
        },
        publisher: {
            description: ( localize(17660, "The publisher of the VS Code extension.")),
            type: "string"
        },
        displayName: {
            description: ( localize(17661, "The display name for the extension used in the VS Code gallery.")),
            type: "string"
        },
        categories: {
            description: ( localize(
                17662,
                "The categories used by the VS Code gallery to categorize the extension."
            )),
            type: "array",
            uniqueItems: true,
            items: {
                oneOf: [{
                    type: "string",
                    enum: EXTENSION_CATEGORIES
                }, {
                    type: "string",
                    const: "Languages",
                    deprecationMessage: ( localize(17663, "Use 'Programming  Languages' instead"))
                }]
            }
        },
        galleryBanner: {
            type: "object",
            description: ( localize(17664, "Banner used in the VS Code marketplace.")),
            properties: {
                color: {
                    description: ( localize(17665, "The banner color on the VS Code marketplace page header.")),
                    type: "string"
                },
                theme: {
                    description: ( localize(17666, "The color theme for the font used in the banner.")),
                    type: "string",
                    enum: ["dark", "light"]
                }
            }
        },
        contributes: {
            description: ( localize(
                17667,
                "All contributions of the VS Code extension represented by this package."
            )),
            type: "object",
            properties: {},
            default: {}
        },
        preview: {
            type: "boolean",
            description: ( localize(17668, "Sets the extension to be flagged as a Preview in the Marketplace."))
        },
        enableProposedApi: {
            type: "boolean",
            deprecationMessage: ( localize(17669, "Use `enabledApiProposals` instead."))
        },
        enabledApiProposals: {
            markdownDescription: ( localize(
                17670,
                "Enable API proposals to try them out. Only valid **during development**. Extensions **cannot be published** with this property. For more details visit: https://code.visualstudio.com/api/advanced-topics/using-proposed-api"
            )),
            type: "array",
            uniqueItems: true,
            items: {
                type: "string",
                enum: ( ( Object.keys(allApiProposals)).map(proposalName => proposalName)),
                markdownEnumDescriptions: ( ( Object.values(allApiProposals)).map(value => value.proposal))
            }
        },
        api: {
            markdownDescription: ( localize(
                17671,
                "Describe the API provided by this extension. For more details visit: https://code.visualstudio.com/api/advanced-topics/remote-extensions#handling-dependencies-with-remote-extensions"
            )),
            type: "string",
            enum: ["none"],
            enumDescriptions: [( localize(
                17672,
                "Give up entirely the ability to export any APIs. This allows other extensions that depend on this extension to run in a separate extension host process or in a remote machine."
            ))]
        },
        activationEvents: {
            description: ( localize(17673, "Activation events for the VS Code extension.")),
            type: "array",
            items: {
                type: "string",
                defaultSnippets: [{
                    label: "onWebviewPanel",
                    description: ( localize(
                        17674,
                        "An activation event emitted when a webview is loaded of a certain viewType"
                    )),
                    body: "onWebviewPanel:viewType"
                }, {
                    label: "onLanguage",
                    description: ( localize(
                        17675,
                        "An activation event emitted whenever a file that resolves to the specified language gets opened."
                    )),
                    body: "onLanguage:${1:languageId}"
                }, {
                    label: "onCommand",
                    description: ( localize(
                        17676,
                        "An activation event emitted whenever the specified command gets invoked."
                    )),
                    body: "onCommand:${2:commandId}"
                }, {
                    label: "onDebug",
                    description: ( localize(
                        17677,
                        "An activation event emitted whenever a user is about to start debugging or about to setup debug configurations."
                    )),
                    body: "onDebug"
                }, {
                    label: "onDebugInitialConfigurations",
                    description: ( localize(
                        17678,
                        "An activation event emitted whenever a \"launch.json\" needs to be created (and all provideDebugConfigurations methods need to be called)."
                    )),
                    body: "onDebugInitialConfigurations"
                }, {
                    label: "onDebugDynamicConfigurations",
                    description: ( localize(
                        17679,
                        "An activation event emitted whenever a list of all debug configurations needs to be created (and all provideDebugConfigurations methods for the \"dynamic\" scope need to be called)."
                    )),
                    body: "onDebugDynamicConfigurations"
                }, {
                    label: "onDebugResolve",
                    description: ( localize(
                        17680,
                        "An activation event emitted whenever a debug session with the specific type is about to be launched (and a corresponding resolveDebugConfiguration method needs to be called)."
                    )),
                    body: "onDebugResolve:${6:type}"
                }, {
                    label: "onDebugAdapterProtocolTracker",
                    description: ( localize(
                        17681,
                        "An activation event emitted whenever a debug session with the specific type is about to be launched and a debug protocol tracker might be needed."
                    )),
                    body: "onDebugAdapterProtocolTracker:${6:type}"
                }, {
                    label: "workspaceContains",
                    description: ( localize(
                        17682,
                        "An activation event emitted whenever a folder is opened that contains at least a file matching the specified glob pattern."
                    )),
                    body: "workspaceContains:${4:filePattern}"
                }, {
                    label: "onStartupFinished",
                    description: ( localize(
                        17683,
                        "An activation event emitted after the start-up finished (after all `*` activated extensions have finished activating)."
                    )),
                    body: "onStartupFinished"
                }, {
                    label: "onTaskType",
                    description: ( localize(
                        17684,
                        "An activation event emitted whenever tasks of a certain type need to be listed or resolved."
                    )),
                    body: "onTaskType:${1:taskType}"
                }, {
                    label: "onFileSystem",
                    description: ( localize(
                        17685,
                        "An activation event emitted whenever a file or folder is accessed with the given scheme."
                    )),
                    body: "onFileSystem:${1:scheme}"
                }, {
                    label: "onEditSession",
                    description: ( localize(
                        17686,
                        "An activation event emitted whenever an edit session is accessed with the given scheme."
                    )),
                    body: "onEditSession:${1:scheme}"
                }, {
                    label: "onSearch",
                    description: ( localize(
                        17687,
                        "An activation event emitted whenever a search is started in the folder with the given scheme."
                    )),
                    body: "onSearch:${7:scheme}"
                }, {
                    label: "onView",
                    body: "onView:${5:viewId}",
                    description: ( localize(
                        17688,
                        "An activation event emitted whenever the specified view is expanded."
                    ))
                }, {
                    label: "onUri",
                    body: "onUri",
                    description: ( localize(
                        17689,
                        "An activation event emitted whenever a system-wide Uri directed towards this extension is open."
                    ))
                }, {
                    label: "onOpenExternalUri",
                    body: "onOpenExternalUri",
                    description: ( localize(
                        17690,
                        "An activation event emitted whenever a external uri (such as an http or https link) is being opened."
                    ))
                }, {
                    label: "onCustomEditor",
                    body: "onCustomEditor:${9:viewType}",
                    description: ( localize(
                        17691,
                        "An activation event emitted whenever the specified custom editor becomes visible."
                    ))
                }, {
                    label: "onNotebook",
                    body: "onNotebook:${1:type}",
                    description: ( localize(
                        17692,
                        "An activation event emitted whenever the specified notebook document is opened."
                    ))
                }, {
                    label: "onAuthenticationRequest",
                    body: "onAuthenticationRequest:${11:authenticationProviderId}",
                    description: ( localize(
                        17693,
                        "An activation event emitted whenever sessions are requested from the specified authentication provider."
                    ))
                }, {
                    label: "onRenderer",
                    description: ( localize(
                        17694,
                        "An activation event emitted whenever a notebook output renderer is used."
                    )),
                    body: "onRenderer:${11:rendererId}"
                }, {
                    label: "onTerminalProfile",
                    body: "onTerminalProfile:${1:terminalId}",
                    description: ( localize(
                        17695,
                        "An activation event emitted when a specific terminal profile is launched."
                    ))
                }, {
                    label: "onTerminalQuickFixRequest",
                    body: "onTerminalQuickFixRequest:${1:quickFixId}",
                    description: ( localize(
                        17696,
                        "An activation event emitted when a command matches the selector associated with this ID"
                    ))
                }, {
                    label: "onWalkthrough",
                    body: "onWalkthrough:${1:walkthroughID}",
                    description: ( localize(
                        17697,
                        "An activation event emitted when a specified walkthrough is opened."
                    ))
                }, {
                    label: "onIssueReporterOpened",
                    body: "onIssueReporterOpened",
                    description: ( localize(17698, "An activation event emitted when the issue reporter is opened."))
                }, {
                    label: "onChatParticipant",
                    body: "onChatParticipant:${1:participantId}",
                    description: ( localize(
                        17699,
                        "An activation event emitted when the specified chat participant is invoked."
                    ))
                }, {
                    label: "onChatContextProvider",
                    body: "onChatContextProvider:${1:contextProviderId}",
                    description: ( localize(
                        17700,
                        "An activation event emitted when the specified chat context provider is invoked."
                    ))
                }, {
                    label: "onLanguageModelChatProvider",
                    body: "onLanguageModelChatProvider:${1:vendor}",
                    description: ( localize(
                        17701,
                        "An activation event emitted when a chat model provider for the given vendor is requested."
                    ))
                }, {
                    label: "onLanguageModelTool",
                    body: "onLanguageModelTool:${1:toolId}",
                    description: ( localize(
                        17702,
                        "An activation event emitted when the specified language model tool is invoked."
                    ))
                }, {
                    label: "onTerminal",
                    body: "onTerminal:{1:shellType}",
                    description: ( localize(
                        17703,
                        "An activation event emitted when a terminal of the given shell type is opened."
                    ))
                }, {
                    label: "onTerminalShellIntegration",
                    body: "onTerminalShellIntegration:${1:shellType}",
                    description: ( localize(
                        17704,
                        "An activation event emitted when terminal shell integration is activated for the given shell type."
                    ))
                }, {
                    label: "onMcpCollection",
                    description: ( localize(
                        17705,
                        "An activation event emitted whenever a tool from the MCP server is requested."
                    )),
                    body: "onMcpCollection:${2:collectionId}"
                }, {
                    label: "*",
                    description: ( localize(
                        17706,
                        "An activation event emitted on VS Code startup. To ensure a great end user experience, please use this activation event in your extension only when no other activation events combination works in your use-case."
                    )),
                    body: "*"
                }]
            }
        },
        badges: {
            type: "array",
            description: ( localize(
                17707,
                "Array of badges to display in the sidebar of the Marketplace's extension page."
            )),
            items: {
                type: "object",
                required: ["url", "href", "description"],
                properties: {
                    url: {
                        type: "string",
                        description: ( localize(17708, "Badge image URL."))
                    },
                    href: {
                        type: "string",
                        description: ( localize(17709, "Badge link."))
                    },
                    description: {
                        type: "string",
                        description: ( localize(17710, "Badge description."))
                    }
                }
            }
        },
        markdown: {
            type: "string",
            description: ( localize(
                17711,
                "Controls the Markdown rendering engine used in the Marketplace. Either github (default) or standard."
            )),
            enum: ["github", "standard"],
            default: "github"
        },
        qna: {
            default: "marketplace",
            description: ( localize(
                17712,
                "Controls the Q&A link in the Marketplace. Set to marketplace to enable the default Marketplace Q & A site. Set to a string to provide the URL of a custom Q & A site. Set to false to disable Q & A altogether."
            )),
            anyOf: [{
                type: ["string", "boolean"],
                enum: ["marketplace", false]
            }, {
                type: "string"
            }]
        },
        extensionDependencies: {
            description: ( localize(
                17713,
                "Dependencies to other extensions. The identifier of an extension is always ${publisher}.${name}. For example: vscode.csharp."
            )),
            type: "array",
            uniqueItems: true,
            items: {
                type: "string",
                pattern: EXTENSION_IDENTIFIER_PATTERN
            }
        },
        extensionAffinity: {
            description: ( localize(
                17714,
                "Extensions that this extension should be colocated with in the same extension host process if possible. The identifier of an extension is always ${publisher}.${name}. For example: vscode.git."
            )),
            type: "array",
            uniqueItems: true,
            items: {
                type: "string",
                pattern: EXTENSION_IDENTIFIER_PATTERN
            }
        },
        extensionPack: {
            description: ( localize(
                17715,
                "A set of extensions that can be installed together. The identifier of an extension is always ${publisher}.${name}. For example: vscode.csharp."
            )),
            type: "array",
            uniqueItems: true,
            items: {
                type: "string",
                pattern: EXTENSION_IDENTIFIER_PATTERN
            }
        },
        extensionKind: {
            description: ( localize(
                17716,
                "Define the kind of an extension. `ui` extensions are installed and run on the local machine while `workspace` extensions run on the remote."
            )),
            type: "array",
            items: extensionKindSchema,
            default: ["workspace"],
            defaultSnippets: [{
                body: ["ui"],
                description: ( localize(
                    17717,
                    "Define an extension which can run only on the local machine when connected to remote window."
                ))
            }, {
                body: ["workspace"],
                description: ( localize(
                    17718,
                    "Define an extension which can run only on the remote machine when connected remote window."
                ))
            }, {
                body: ["ui", "workspace"],
                description: ( localize(
                    17719,
                    "Define an extension which can run on either side, with a preference towards running on the local machine."
                ))
            }, {
                body: ["workspace", "ui"],
                description: ( localize(
                    17720,
                    "Define an extension which can run on either side, with a preference towards running on the remote machine."
                ))
            }, {
                body: [],
                description: ( localize(
                    17721,
                    "Define an extension which cannot run in a remote context, neither on the local, nor on the remote machine."
                ))
            }]
        },
        capabilities: {
            description: ( localize(17722, "Declare the set of supported capabilities by the extension.")),
            type: "object",
            properties: {
                virtualWorkspaces: {
                    description: ( localize(
                        17723,
                        "Declares whether the extension should be enabled in virtual workspaces. A virtual workspace is a workspace which is not backed by any on-disk resources. When false, this extension will be automatically disabled in virtual workspaces. Default is true."
                    )),
                    type: ["boolean", "object"],
                    defaultSnippets: [{
                        label: "limited",
                        body: {
                            supported: "${1:limited}",
                            description: "${2}"
                        }
                    }, {
                        label: "false",
                        body: {
                            supported: false,
                            description: "${2}"
                        }
                    }],
                    default: true.valueOf,
                    properties: {
                        supported: {
                            markdownDescription: ( localize(
                                17724,
                                "Declares the level of support for virtual workspaces by the extension."
                            )),
                            type: ["string", "boolean"],
                            enum: ["limited", true, false],
                            enumDescriptions: [( localize(
                                17725,
                                "The extension will be enabled in virtual workspaces with some functionality disabled."
                            )), ( localize(
                                17726,
                                "The extension will be enabled in virtual workspaces with all functionality enabled."
                            )), ( localize(17727, "The extension will not be enabled in virtual workspaces."))]
                        },
                        description: {
                            type: "string",
                            markdownDescription: ( localize(
                                17728,
                                "A description of how virtual workspaces affects the extensions behavior and why it is needed. This only applies when `supported` is not `true`."
                            ))
                        }
                    }
                },
                untrustedWorkspaces: {
                    description: ( localize(
                        17729,
                        "Declares how the extension should be handled in untrusted workspaces."
                    )),
                    type: "object",
                    required: ["supported"],
                    defaultSnippets: [{
                        body: {
                            supported: "${1:limited}",
                            description: "${2}"
                        }
                    }],
                    properties: {
                        supported: {
                            markdownDescription: ( localize(
                                17730,
                                "Declares the level of support for untrusted workspaces by the extension."
                            )),
                            type: ["string", "boolean"],
                            enum: ["limited", true, false],
                            enumDescriptions: [( localize(
                                17731,
                                "The extension will be enabled in untrusted workspaces with some functionality disabled."
                            )), ( localize(
                                17732,
                                "The extension will be enabled in untrusted workspaces with all functionality enabled."
                            )), ( localize(17733, "The extension will not be enabled in untrusted workspaces."))]
                        },
                        restrictedConfigurations: {
                            description: ( localize(
                                17734,
                                "A list of configuration keys contributed by the extension that should not use workspace values in untrusted workspaces."
                            )),
                            type: "array",
                            items: {
                                type: "string"
                            }
                        },
                        description: {
                            type: "string",
                            markdownDescription: ( localize(
                                17735,
                                "A description of how workspace trust affects the extensions behavior and why it is needed. This only applies when `supported` is not `true`."
                            ))
                        }
                    }
                }
            }
        },
        sponsor: {
            description: ( localize(17736, "Specify the location from where users can sponsor your extension.")),
            type: "object",
            defaultSnippets: [{
                body: {
                    url: "${1:https:}"
                }
            }],
            properties: {
                "url": {
                    description: ( localize(
                        17737,
                        "URL from where users can sponsor your extension. It must be a valid URL with a HTTP or HTTPS protocol. Example value: https://github.com/sponsors/nvaccess"
                    )),
                    type: "string"
                }
            }
        },
        scripts: {
            type: "object",
            properties: {
                "vscode:prepublish": {
                    description: ( localize(
                        17738,
                        "Script executed before the package is published as a VS Code extension."
                    )),
                    type: "string"
                },
                "vscode:uninstall": {
                    description: ( localize(
                        17739,
                        "Uninstall hook for VS Code extension. Script that gets executed when the extension is completely uninstalled from VS Code which is when VS Code is restarted (shutdown and start) after the extension is uninstalled. Only Node scripts are supported."
                    )),
                    type: "string"
                }
            }
        },
        icon: {
            type: "string",
            description: ( localize(17740, "The path to a 128x128 pixel icon."))
        },
        l10n: {
            type: "string",
            description: ( localize(
                17741,
                "The relative path to a folder containing localization (bundle.l10n.*.json) files. Must be specified if you are using the vscode.l10n API."
            ))
        },
        pricing: {
            type: "string",
            markdownDescription: ( localize(
                17742,
                "The pricing information for the extension. Can be Free (default) or Trial. For more details visit: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#extension-pricing-label"
            )),
            enum: ["Free", "Trial"],
            default: "Free"
        }
    }
};
class ExtensionsRegistryImpl {
    constructor() {
        this._extensionPoints = ( new Map());
    }
    registerExtensionPoint(desc) {
        if (( this._extensionPoints.has(desc.extensionPoint))) {
            throw ( new Error("Duplicate extension point: " + desc.extensionPoint));
        }
        const result = ( new ExtensionPoint(desc.extensionPoint, desc.defaultExtensionKind, desc.canHandleResolver));
        this._extensionPoints.set(desc.extensionPoint, result);
        if (desc.activationEventsGenerator) {
            ImplicitActivationEvents.register(desc.extensionPoint, desc.activationEventsGenerator);
        }
        schema.properties["contributes"].properties[desc.extensionPoint] = desc.jsonSchema;
        schemaRegistry.registerSchema(schemaId, schema);
        return result;
    }
    getExtensionPoints() {
        return Array.from(( this._extensionPoints.values()));
    }
}
const PRExtensions = {
    ExtensionsRegistry: "ExtensionsRegistry"
};
Registry.add(PRExtensions.ExtensionsRegistry, ( new ExtensionsRegistryImpl()));
const ExtensionsRegistry = ( Registry.as(PRExtensions.ExtensionsRegistry));
schemaRegistry.registerSchema(schemaId, schema);
schemaRegistry.registerSchema(productSchemaId, {
    properties: {
        extensionEnabledApiProposals: {
            description: ( localize(17743, "API proposals that the respective extensions can freely use.")),
            type: "object",
            properties: {},
            additionalProperties: {
                anyOf: [{
                    type: "array",
                    uniqueItems: true,
                    items: {
                        type: "string",
                        enum: ( Object.keys(allApiProposals)),
                        markdownEnumDescriptions: ( ( Object.values(allApiProposals)).map(value => value.proposal))
                    }
                }]
            }
        }
    }
});

export { ExtensionMessageCollector, ExtensionPoint, ExtensionPointUserDelta, ExtensionsRegistry, ExtensionsRegistryImpl, schema };
