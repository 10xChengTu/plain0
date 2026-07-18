
import { match } from '../../../../base/common/glob.js';
import { Schemas } from '../../../../base/common/network.js';
import { posix } from '../../../../base/common/path.js';
import { basename } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { workbenchConfigurationNodeBase } from '../../../common/configuration.js';
import { Extensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

const editorsAssociationsSettingId = "workbench.editorAssociations";
const diffEditorsAssociationsSettingId = "workbench.diffEditorAssociations";
const markdownDefaultEditorAgentsWindowSettingId = "workbench.editor.markdownDefaultEditorInAgentsWindow";
function editorsAssociationsAgentsWindowDefault(options) {
    return {
        "*.md": options?.markdownDefaultEditor === true ? "vscode.markdown.editor" : "vscode.markdown.preview.editor"
    };
}
const configurationRegistry = ( Registry.as(Extensions.Configuration));
const editorAssociationsConfigurationNode = {
    ...workbenchConfigurationNodeBase,
    properties: {
        [markdownDefaultEditorAgentsWindowSettingId]: {
            type: "boolean",
            default: false,
            tags: ["experimental"],
            experiment: {
                mode: "startup"
            },
            markdownDescription: ( localize(
                17537,
                "Controls whether the Markdown editor is used as the default editor for Markdown files in the Agents window."
            ))
        },
        [editorsAssociationsSettingId]: {
            type: "object",
            markdownDescription: ( localize(
                17538,
                "Configure [glob patterns](https://aka.ms/vscode-glob-patterns) to editors (for example `\"*.hex\": \"hexEditor.hexedit\"`). These have precedence over the default behavior."
            )),
            additionalProperties: {
                type: "string"
            },
            agentsWindow: {
                default: editorsAssociationsAgentsWindowDefault()
            }
        },
        [diffEditorsAssociationsSettingId]: {
            type: "object",
            markdownDescription: ( localize(
                17539,
                "Configure [glob patterns](https://aka.ms/vscode-glob-patterns) to editors for diff views (for example `\"*.md\": \"vscode.markdown.preview.editor\"`). These override `workbench.editorAssociations` for diffs."
            )),
            additionalProperties: {
                type: "string"
            }
        }
    }
};
configurationRegistry.registerConfiguration(editorAssociationsConfigurationNode);
var RegisteredEditorPriority;
(function(RegisteredEditorPriority) {
    RegisteredEditorPriority["builtin"] = "builtin";
    RegisteredEditorPriority["option"] = "option";
    RegisteredEditorPriority["exclusive"] = "exclusive";
    RegisteredEditorPriority["default"] = "default";
})(RegisteredEditorPriority || (RegisteredEditorPriority = {}));
var ResolvedStatus;
(function(ResolvedStatus) {
    ResolvedStatus[ResolvedStatus["ABORT"] = 1] = "ABORT";
    ResolvedStatus[ResolvedStatus["NONE"] = 2] = "NONE";
})(ResolvedStatus || (ResolvedStatus = {}));
function toRegisteredEditorPriorityInfo(priority) {
    if (typeof priority !== "string") {
        return priority;
    }
    return {
        editor: priority,
        diff: priority,
        merge: priority
    };
}
function priorityToRank(priority) {
    switch (priority) {
    case RegisteredEditorPriority.exclusive:
        return 5;
    case RegisteredEditorPriority.default:
        return 4;
    case RegisteredEditorPriority.builtin:
        return 3;
    case RegisteredEditorPriority.option:
    default:
        return 1;
    }
}
function globMatchesResource(globPattern, resource) {
    const excludedSchemes = ( new Set([
        Schemas.extension,
        Schemas.webviewPanel,
        Schemas.vscodeWorkspaceTrust,
        Schemas.vscodeSettings
    ]));
    if (( excludedSchemes.has(resource.scheme))) {
        return false;
    }
    const matchOnPath = typeof globPattern === "string" && globPattern.indexOf(posix.sep) >= 0;
    const target = matchOnPath ? `${resource.scheme}:${resource.path}` : basename(resource);
    return match(globPattern, target, {
        ignoreCase: true
    });
}

export { RegisteredEditorPriority, ResolvedStatus, diffEditorsAssociationsSettingId, editorsAssociationsAgentsWindowDefault, editorsAssociationsSettingId, globMatchesResource, markdownDefaultEditorAgentsWindowSettingId, priorityToRank, toRegisteredEditorPriorityInfo };
