
import { isWindows, isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';

const COMMONLY_USED_SETTINGS = [
    "editor.fontSize",
    "editor.formatOnSave",
    "files.autoSave",
    "GitHub.copilot-chat.manageExtension",
    "editor.defaultFormatter",
    "editor.fontFamily",
    "editor.wordWrap",
    "chat.agent.maxRequests",
    "files.exclude",
    "workbench.colorTheme",
    "editor.tabSize",
    "editor.mouseWheelZoom",
    "editor.formatOnPaste"
];
function getCommonlyUsedData(settingGroups) {
    const allSettings = ( new Map());
    for (const group of settingGroups) {
        for (const section of group.sections) {
            for (const s of section.settings) {
                allSettings.set(s.key, s);
            }
        }
    }
    const settings = [];
    for (const id of COMMONLY_USED_SETTINGS) {
        const setting = allSettings.get(id);
        if (setting) {
            settings.push(setting);
        }
    }
    return {
        id: "commonlyUsed",
        label: ( localize(13207, "Commonly Used")),
        settings
    };
}
const tocData = {
    id: "root",
    label: "root",
    children: [{
        id: "editor",
        label: ( localize(13208, "Text Editor")),
        settings: ["editor.*"],
        children: [{
            id: "editor/cursor",
            label: ( localize(13209, "Cursor")),
            settings: ["editor.cursor*"]
        }, {
            id: "editor/find",
            label: ( localize(13210, "Find")),
            settings: ["editor.find.*"]
        }, {
            id: "editor/font",
            label: ( localize(13211, "Font")),
            settings: ["editor.font*"]
        }, {
            id: "editor/format",
            label: ( localize(13212, "Formatting")),
            settings: ["editor.format*"]
        }, {
            id: "editor/diffEditor",
            label: ( localize(13213, "Diff Editor")),
            settings: ["diffEditor.*"]
        }, {
            id: "editor/multiDiffEditor",
            label: ( localize(13214, "Multi-File Diff Editor")),
            settings: ["multiDiffEditor.*"]
        }, {
            id: "editor/minimap",
            label: ( localize(13215, "Minimap")),
            settings: ["editor.minimap.*"]
        }, {
            id: "editor/suggestions",
            label: ( localize(13216, "Suggestions")),
            settings: ["editor.*suggest*"]
        }, {
            id: "editor/files",
            label: ( localize(13217, "Files")),
            settings: ["files.*"]
        }]
    }, {
        id: "workbench",
        label: ( localize(13218, "Workbench")),
        settings: ["workbench.*"],
        children: [{
            id: "workbench/appearance",
            label: ( localize(13219, "Appearance")),
            settings: [
                "workbench.activityBar.*",
                "workbench.*color*",
                "workbench.fontAliasing",
                "workbench.iconTheme",
                "workbench.sidebar.location",
                "workbench.*.visible",
                "workbench.tips.enabled",
                "workbench.tree.*",
                "workbench.view.*"
            ]
        }, {
            id: "workbench/breadcrumbs",
            label: ( localize(13220, "Breadcrumbs")),
            settings: ["breadcrumbs.*"]
        }, {
            id: "workbench/editor",
            label: ( localize(13221, "Editor Management")),
            settings: ["workbench.editor.*"]
        }, {
            id: "workbench/settings",
            label: ( localize(13222, "Settings Editor")),
            settings: ["workbench.settings.*"]
        }, {
            id: "workbench/zenmode",
            label: ( localize(13223, "Zen Mode")),
            settings: ["zenmode.*"]
        }, {
            id: "workbench/screencastmode",
            label: ( localize(13224, "Screencast Mode")),
            settings: ["screencastMode.*"]
        }, {
            id: "workbench/browser",
            label: ( localize(13225, "Browser")),
            settings: ["workbench.browser.*"]
        }]
    }, {
        id: "window",
        label: ( localize(13226, "Window")),
        settings: ["window.*"],
        children: [{
            id: "window/newWindow",
            label: ( localize(13227, "New Window")),
            settings: ["window.*newwindow*"]
        }]
    }, {
        id: "chat",
        label: ( localize(13228, "Chat")),
        children: [{
            id: "chat/agent",
            label: ( localize(13229, "Agent")),
            settings: [
                "chat.agent.*",
                "chat.checkpoints.*",
                "chat.editRequests",
                "chat.requestQueuing.*",
                "chat.undoRequests.*",
                "chat.customAgentInSubagent.*",
                "chat.editing.autoAcceptDelay",
                "chat.editing.confirmEditRequest*",
                "chat.planAgent.defaultModel"
            ]
        }, {
            id: "chat/appearance",
            label: ( localize(13230, "Appearance")),
            settings: [
                "chat.editor.*",
                "chat.fontFamily",
                "chat.fontSize",
                "chat.math.*",
                "chat.agentsControl.*",
                "chat.alternativeToolAction.*",
                "chat.codeBlock.*",
                "chat.editing.explainChanges.enabled",
                "chat.editorAssociations",
                "chat.extensionUnification.*",
                "chat.inlineReferences.*",
                "chat.notifyWindow*",
                "chat.statusWidget.*",
                "chat.tips.*",
                "chat.unifiedAgentsBar.*",
                "accessibility.signals.chatUserActionRequired",
                "accessibility.signals.chatResponseReceived"
            ]
        }, {
            id: "chat/sessions",
            label: ( localize(13231, "Sessions")),
            settings: [
                "chat.agentSessionProjection.*",
                "chat.sessions.*",
                "chat.viewProgressBadge.*",
                "chat.viewSessions.*",
                "chat.restoreLastPanelSession",
                "chat.exitAfterDelegation",
                "chat.repoInfo.*"
            ]
        }, {
            id: "chat/tools",
            label: ( localize(13232, "Tools")),
            settings: ["chat.tools.*", "chat.extensionTools.*"]
        }, {
            id: "chat/mcp",
            label: ( localize(13233, "MCP")),
            settings: ["mcp", "chat.mcp.*", "mcp.*"]
        }, {
            id: "chat/context",
            label: ( localize(13234, "Context")),
            settings: [
                "chat.detectParticipant.*",
                "chat.experimental.detectParticipant.*",
                "chat.implicitContext.*",
                "chat.promptFilesLocations",
                "chat.instructionsFilesLocations",
                "chat.modeFilesLocations",
                "chat.agentFilesLocations",
                "chat.agentSkillsLocations",
                "chat.hookFilesLocations",
                "chat.promptFilesRecommendations",
                "chat.useAgentsMdFile",
                "chat.useNestedAgentsMdFiles",
                "chat.useAgentSkills",
                "chat.experimental.useSkillAdherencePrompt",
                "chat.useHooks",
                "chat.includeApplyingInstructions",
                "chat.includeReferencedInstructions",
                "chat.useClaudeMdFile"
            ]
        }, {
            id: "chat/inlineChat",
            label: ( localize(13235, "Inline Chat")),
            settings: ["inlineChat.*"]
        }, {
            id: "chat/miscellaneous",
            label: ( localize(13236, "Miscellaneous")),
            settings: ["chat.disableAIFeatures", "chat.allowAnonymousAccess"]
        }]
    }, {
        id: "features",
        label: ( localize(13237, "Features")),
        children: [{
            id: "features/accessibilitySignals",
            label: ( localize(13238, "Accessibility Signals")),
            settings: ["accessibility.signal*"]
        }, {
            id: "features/accessibility",
            label: ( localize(13239, "Accessibility")),
            settings: ["accessibility.*"]
        }, {
            id: "features/explorer",
            label: ( localize(13240, "Explorer")),
            settings: ["explorer.*", "outline.*"]
        }, {
            id: "features/search",
            label: ( localize(13241, "Search")),
            settings: ["search.*"]
        }, {
            id: "features/debug",
            label: ( localize(13242, "Debug")),
            settings: ["debug.*", "launch"]
        }, {
            id: "features/testing",
            label: ( localize(13243, "Testing")),
            settings: ["testing.*"]
        }, {
            id: "features/scm",
            label: ( localize(13244, "Source Control")),
            settings: ["scm.*"]
        }, {
            id: "features/extensions",
            label: ( localize(13245, "Extensions")),
            settings: ["extensions.*"]
        }, {
            id: "features/terminal",
            label: ( localize(13246, "Terminal")),
            settings: ["terminal.*"]
        }, {
            id: "features/task",
            label: ( localize(13247, "Task")),
            settings: ["task.*"]
        }, {
            id: "features/problems",
            label: ( localize(13248, "Problems")),
            settings: ["problems.*"]
        }, {
            id: "features/output",
            label: ( localize(13249, "Output")),
            settings: ["output.*"]
        }, {
            id: "features/comments",
            label: ( localize(13250, "Comments")),
            settings: ["comments.*"]
        }, {
            id: "features/remote",
            label: ( localize(13251, "Remote")),
            settings: ["remote.*"]
        }, {
            id: "features/timeline",
            label: ( localize(13252, "Timeline")),
            settings: ["timeline.*"]
        }, {
            id: "features/notebook",
            label: ( localize(13253, "Notebook")),
            settings: ["notebook.*", "interactiveWindow.*"]
        }, {
            id: "features/mergeEditor",
            label: ( localize(13254, "Merge Editor")),
            settings: ["mergeEditor.*"]
        }, {
            id: "features/issueReporter",
            label: ( localize(13255, "Issue Reporter")),
            settings: ["issueReporter.*"],
            hide: !isWeb
        }]
    }, {
        id: "application",
        label: ( localize(13256, "Application")),
        children: [{
            id: "application/http",
            label: ( localize(13257, "Proxy")),
            settings: ["http.*"]
        }, {
            id: "application/keyboard",
            label: ( localize(13258, "Keyboard")),
            settings: ["keyboard.*"]
        }, {
            id: "application/update",
            label: ( localize(13259, "Update")),
            settings: ["update.*"]
        }, {
            id: "application/telemetry",
            label: ( localize(13260, "Telemetry")),
            settings: ["telemetry.*"]
        }, {
            id: "application/settingsSync",
            label: ( localize(13261, "Settings Sync")),
            settings: ["settingsSync.*"]
        }, {
            id: "application/network",
            label: ( localize(13262, "Network")),
            settings: ["network.*"]
        }, {
            id: "application/experimental",
            label: ( localize(13263, "Experimental")),
            settings: ["application.experimental.*"]
        }, {
            id: "application/other",
            label: ( localize(13264, "Other")),
            settings: ["application.*"],
            hide: isWindows
        }]
    }, {
        id: "security",
        label: ( localize(13265, "Security")),
        settings: ["security.*"],
        children: [{
            id: "security/workspace",
            label: ( localize(13266, "Workspace")),
            settings: ["security.workspace.*"]
        }]
    }]
};

export { getCommonlyUsedData, tocData };
