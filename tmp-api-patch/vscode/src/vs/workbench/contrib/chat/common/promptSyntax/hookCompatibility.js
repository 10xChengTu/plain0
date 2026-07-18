
import { basename, dirname } from '../../../../../base/common/path.js';
import { toHookType, extractHookCommandsFromItem } from './hookSchema.js';
import { parseClaudeHooks } from './hookClaudeCompat.js';
import { resolveCopilotCliHookType } from './hookCopilotCliCompat.js';

var HookSourceFormat;
(function(HookSourceFormat) {
    HookSourceFormat["Copilot"] = "copilot";
    HookSourceFormat["Claude"] = "claude";
})(HookSourceFormat || (HookSourceFormat = {}));
function getHookSourceFormat(fileUri) {
    const filename = basename(fileUri.path).toLowerCase();
    const dir = dirname(fileUri.path);
    if ((filename === "settings.json" || filename === "settings.local.json") && dir.endsWith(".claude")) {
        return HookSourceFormat.Claude;
    }
    return HookSourceFormat.Copilot;
}
function parseCopilotHooks(json, workspaceRootUri, userHome) {
    const result = ( new Map());
    if (!json || typeof json !== "object") {
        return result;
    }
    const root = json;
    const hooks = root.hooks;
    if (!hooks || typeof hooks !== "object") {
        return result;
    }
    const hooksObj = hooks;
    for (const originalId of ( Object.keys(hooksObj))) {
        const hookType = resolveCopilotCliHookType(originalId) ?? toHookType(originalId);
        if (!hookType) {
            continue;
        }
        const hookArray = hooksObj[originalId];
        if (!Array.isArray(hookArray)) {
            continue;
        }
        const commands = [];
        for (const item of hookArray) {
            const extracted = extractHookCommandsFromItem(item, workspaceRootUri, userHome);
            commands.push(...extracted);
        }
        if (commands.length > 0) {
            result.set(hookType, {
                hooks: commands,
                originalId
            });
        }
    }
    return result;
}
function parseHooksFromFile(fileUri, json, workspaceRootUri, userHome) {
    const format = getHookSourceFormat(fileUri);
    let hooks;
    let disabledAllHooks = false;
    switch (format) {
    case HookSourceFormat.Claude:
        {
            const result = parseClaudeHooks(json, workspaceRootUri, userHome);
            hooks = result.hooks;
            disabledAllHooks = result.disabledAllHooks;
            break;
        }
    case HookSourceFormat.Copilot:
    default:
        hooks = parseCopilotHooks(json, workspaceRootUri, userHome);
        break;
    }
    return {
        format,
        hooks,
        disabledAllHooks
    };
}
function parseHooksIgnoringDisableAll(fileUri, json, workspaceRootUri, userHome) {
    const format = getHookSourceFormat(fileUri);
    let hooks;
    switch (format) {
    case HookSourceFormat.Claude:
        {
            if (json && typeof json === "object") {
                const {
                    disableAllHooks: _,
                    ...rest
                } = json;
                const result = parseClaudeHooks(rest, workspaceRootUri, userHome);
                hooks = result.hooks;
            } else {
                hooks = ( new Map());
            }
            break;
        }
    case HookSourceFormat.Copilot:
    default:
        hooks = parseCopilotHooks(json, workspaceRootUri, userHome);
        break;
    }
    return {
        format,
        hooks,
        disabledAllHooks: true
    };
}
function buildNewHookEntry(format) {
    const commandEntry = {
        type: "command",
        command: ""
    };
    if (format === HookSourceFormat.Claude) {
        return {
            matcher: "",
            hooks: [commandEntry]
        };
    }
    return commandEntry;
}

export { HookSourceFormat, buildNewHookEntry, getHookSourceFormat, parseCopilotHooks, parseHooksFromFile, parseHooksIgnoringDisableAll };
