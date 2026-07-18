
import '../../../base/common/json.js';
import { equals, cloneAndChange } from '../../../base/common/objects.js';
import { isAbsolute } from '../../../base/common/path.js';
import { isEqual, joinPath, basename, isEqualOrParent, normalizePath, extname, dirname } from '../../../base/common/resources.js';
import { escapeRegExpCharacters } from '../../../base/common/strings.js';
import '../../../base/common/errors.js';
import { URI } from '../../../base/common/uri.js';
import { parseFrontMatter } from '../../../base/common/yaml.js';
import { McpServerType } from '../../mcp/common/mcpPlatformTypes.js';
import '../../agentHost/common/state/protocol/channels-root/state.js';
import { CustomizationType, McpServerStatus } from '../../agentHost/common/state/protocol/channels-session/state.js';
import '../../agentHost/common/state/protocol/channels-chat/state.js';
import '../../agentHost/common/state/protocol/channels-terminal/state.js';
import '../../agentHost/common/state/protocol/channels-changeset/state.js';
import '../../agentHost/common/state/protocol/channels-resource-watch/state.js';
import { DEFAULT_MCP_APP } from '../../agentHost/common/state/protocol/mcpAppDefaults.js';
import { customizationId } from '../../agentHost/common/state/sessionState.js';

var IParsedHookCommand;
(function(IParsedHookCommand) {
    function isEquals(a, b) {
        if (a === b) {
            return true;
        }
        if (!a || !b) {
            return false;
        }
        return a.command === b.command && a.windows === b.windows && a.linux === b.linux && a.osx === b.osx && isEqual(a.cwd, b.cwd) && equals(a.env, b.env) && a.timeout === b.timeout && isEqual(a.sourceUri, b.sourceUri);
    }
    IParsedHookCommand.isEquals = isEquals;
})(IParsedHookCommand || (IParsedHookCommand = {}));
var PluginFormat;
(function(PluginFormat) {
    PluginFormat[PluginFormat["Copilot"] = 0] = "Copilot";
    PluginFormat[PluginFormat["Claude"] = 1] = "Claude";
    PluginFormat[PluginFormat["OpenPlugin"] = 2] = "OpenPlugin";
})(PluginFormat || (PluginFormat = {}));
const COPILOT_FORMAT = {
    format: PluginFormat.Copilot,
    manifestPath: "plugin.json",
    hookConfigPath: "hooks.json",
    pluginRootToken: undefined,
    pluginRootEnvVar: undefined,
    parseHooks(hookUri, json, _pluginUri, workspaceRoot, userHome) {
        return parseHooksJson(hookUri, json, workspaceRoot, userHome);
    }
};
const CLAUDE_FORMAT = {
    format: PluginFormat.Claude,
    manifestPath: ".claude-plugin/plugin.json",
    hookConfigPath: "hooks/hooks.json",
    pluginRootToken: "${CLAUDE_PLUGIN_ROOT}",
    pluginRootEnvVar: "CLAUDE_PLUGIN_ROOT",
    parseHooks(hookUri, json, pluginUri, workspaceRoot, userHome) {
        return interpolateHookPluginRoot(
            hookUri,
            json,
            pluginUri,
            workspaceRoot,
            userHome,
            "${CLAUDE_PLUGIN_ROOT}",
            "CLAUDE_PLUGIN_ROOT"
        );
    }
};
const OPEN_PLUGIN_FORMAT = {
    format: PluginFormat.OpenPlugin,
    manifestPath: ".plugin/plugin.json",
    hookConfigPath: "hooks/hooks.json",
    pluginRootToken: "${PLUGIN_ROOT}",
    pluginRootEnvVar: "PLUGIN_ROOT",
    parseHooks(hookUri, json, pluginUri, workspaceRoot, userHome) {
        return interpolateHookPluginRoot(
            hookUri,
            json,
            pluginUri,
            workspaceRoot,
            userHome,
            "${PLUGIN_ROOT}",
            "PLUGIN_ROOT"
        );
    }
};
async function detectPluginFormat(pluginUri, fileService) {
    if (await pathExists(joinPath(pluginUri, ".plugin", "plugin.json"), fileService)) {
        return OPEN_PLUGIN_FORMAT;
    }
    const isInClaudeDirectory = pluginUri.path.split("/").includes(".claude");
    if (isInClaudeDirectory || (await pathExists(joinPath(pluginUri, ".claude-plugin", "plugin.json"), fileService))) {
        return CLAUDE_FORMAT;
    }
    return COPILOT_FORMAT;
}
function buildChildId(uri, disambiguator) {
    const base = customizationId(( uri.toString()));
    if (!disambiguator) {
        return base;
    }
    return `${base.replace(/#/g, "%23")}#${disambiguator}`;
}
function makeHookCustomization(hookUri) {
    return {
        type: CustomizationType.Hook,
        id: buildChildId(hookUri),
        uri: ( hookUri.toString()),
        name: basename(hookUri)
    };
}
function makeMcpServerCustomization(definitionUri, name) {
    return {
        type: CustomizationType.McpServer,
        id: buildChildId(definitionUri, `mcp=${encodeURIComponent(name)}`),
        uri: ( definitionUri.toString()),
        name,
        enabled: true,
        state: {
            kind: McpServerStatus.Starting
        },
        mcpApp: DEFAULT_MCP_APP
    };
}
const emptyComponentPathConfig = {
    paths: [],
    exclusive: false
};
function parseComponentPathConfig(raw) {
    if (raw === undefined || raw === null) {
        return emptyComponentPathConfig;
    }
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        return trimmed ? {
            paths: [trimmed],
            exclusive: false
        } : emptyComponentPathConfig;
    }
    if (Array.isArray(raw)) {
        const paths = ( raw.filter(v => typeof v === "string").map(v => v.trim())).filter(v => v.length > 0);
        return {
            paths,
            exclusive: false
        };
    }
    if (typeof raw === "object") {
        const obj = raw;
        if (Array.isArray(obj["paths"])) {
            const paths = ( obj["paths"].filter(v => typeof v === "string").map(v => v.trim())).filter(v => v.length > 0);
            const exclusive = obj["exclusive"] === true;
            return {
                paths,
                exclusive
            };
        }
    }
    return emptyComponentPathConfig;
}
function resolveComponentDirs(pluginUri, defaultDir, config, boundaryUri) {
    const boundary = (boundaryUri && isEqualOrParent(pluginUri, boundaryUri)) ? boundaryUri : pluginUri;
    const dirs = [];
    if (!config.exclusive) {
        dirs.push(joinPath(pluginUri, defaultDir));
    }
    for (const p of config.paths) {
        const resolved = normalizePath(joinPath(pluginUri, p));
        if (isEqualOrParent(resolved, boundary)) {
            dirs.push(resolved);
        }
    }
    return dirs;
}
function resolveMcpServersMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const obj = raw;
    return Object.hasOwn(obj, "mcpServers") ? obj.mcpServers : obj;
}
function normalizeMcpServerConfiguration(rawConfig) {
    if (!rawConfig || typeof rawConfig !== "object") {
        return undefined;
    }
    const candidate = rawConfig;
    const type = typeof candidate["type"] === "string" ? candidate["type"] : undefined;
    const command = typeof candidate["command"] === "string" ? candidate["command"] : undefined;
    const url = typeof candidate["url"] === "string" ? candidate["url"] : undefined;
    const args = Array.isArray(candidate["args"]) ? candidate["args"].filter(value => typeof value === "string") : undefined;
    const env = candidate["env"] && typeof candidate["env"] === "object" ? Object.fromEntries(( Object.entries(candidate["env"]).filter(
        ([, value]) => typeof value === "string" || typeof value === "number" || value === null
    ).map(([key, value]) => [key, value]))) : undefined;
    const envFile = typeof candidate["envFile"] === "string" ? candidate["envFile"] : undefined;
    const cwd = typeof candidate["cwd"] === "string" ? candidate["cwd"] : undefined;
    const headers = candidate["headers"] && typeof candidate["headers"] === "object" ? Object.fromEntries(( Object.entries(candidate["headers"]).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, value]))) : undefined;
    const dev = candidate["dev"] && typeof candidate["dev"] === "object" ? candidate["dev"] : undefined;
    if (type === "ws") {
        return undefined;
    }
    if (type === McpServerType.LOCAL || (!type && command)) {
        if (!command) {
            return undefined;
        }
        return {
            type: McpServerType.LOCAL,
            command,
            args,
            env,
            envFile,
            cwd,
            dev
        };
    }
    if (type === McpServerType.REMOTE || type === "sse" || (!type && url)) {
        if (!url) {
            return undefined;
        }
        return {
            type: McpServerType.REMOTE,
            url,
            headers,
            dev
        };
    }
    return undefined;
}
const shellUnsafeChars = /[\s&|<>()^;!`"']/;
function shellQuotePluginRootInCommand(command, fsPath, token) {
    if (!command.includes(token)) {
        return command;
    }
    if (!shellUnsafeChars.test(fsPath)) {
        return command.replaceAll(token, fsPath);
    }
    const escapedToken = escapeRegExpCharacters(token);
    const pattern = ( new RegExp(`(["']?)` + escapedToken + `([\\w./\\\\~:-]*)`, "g"));
    return command.replace(pattern, (_match, leadingQuote, suffix) => {
        const fullPath = fsPath + suffix;
        if (leadingQuote) {
            return leadingQuote + fullPath;
        }
        return "\"" + fullPath.replace(/"/g, "\\\"") + "\"";
    });
}
function interpolateMcpPluginRoot(def, fsPath, token, envVar) {
    const replace = s => s.replaceAll(token, fsPath);
    const config = def.configuration;
    let interpolated;
    if (config.type === McpServerType.LOCAL) {
        const local = {
            ...config
        };
        local.command = replace(local.command);
        if (local.args) {
            local.args = ( local.args.map(replace));
        }
        if (local.cwd) {
            local.cwd = replace(local.cwd);
        }
        local.env = {
            ...local.env
        };
        for (const [k, v] of Object.entries(local.env)) {
            if (typeof v === "string") {
                local.env[k] = replace(v);
            }
        }
        local.env[envVar] = fsPath;
        if (local.envFile) {
            local.envFile = replace(local.envFile);
        }
        interpolated = local;
    } else {
        const remote = {
            ...config
        };
        remote.url = replace(remote.url);
        if (remote.headers) {
            remote.headers = Object.fromEntries(( Object.entries(remote.headers).map(([k, v]) => [k, replace(v)])));
        }
        interpolated = remote;
    }
    return {
        name: def.name,
        configuration: interpolated,
        uri: def.uri,
        customization: def.customization
    };
}
const BARE_ENV_VAR_RE = /\$\{(?![A-Za-z]+:)([A-Z_][A-Z0-9_]*)\}/g;
function convertBareEnvVarsToVsCodeSyntax(def) {
    return cloneAndChange(def, value => {
        if (URI.isUri(value)) {
            return value;
        }
        if (typeof value === "string") {
            const replaced = value.replace(BARE_ENV_VAR_RE, "${env:$1}");
            return replaced !== value ? replaced : undefined;
        }
        return undefined;
    });
}
const HOOK_TYPE_MAP = {
    "SessionStart": "SessionStart",
    "SessionEnd": "SessionEnd",
    "UserPromptSubmit": "UserPromptSubmit",
    "PreToolUse": "PreToolUse",
    "PostToolUse": "PostToolUse",
    "PreCompact": "PreCompact",
    "SubagentStart": "SubagentStart",
    "SubagentStop": "SubagentStop",
    "Stop": "Stop",
    "ErrorOccurred": "ErrorOccurred",
    "sessionStart": "SessionStart",
    "sessionEnd": "SessionEnd",
    "userPromptSubmitted": "UserPromptSubmit",
    "preToolUse": "PreToolUse",
    "postToolUse": "PostToolUse",
    "agentStop": "Stop",
    "subagentStop": "SubagentStop",
    "errorOccurred": "ErrorOccurred"
};
function normalizeHookCommand(raw) {
    if (raw.type !== undefined && raw.type !== "command") {
        return undefined;
    }
    const hasCommand = typeof raw.command === "string" && raw.command.length > 0;
    const hasBash = typeof raw.bash === "string" && raw.bash.length > 0;
    const hasPowerShell = typeof raw.powershell === "string" && raw.powershell.length > 0;
    const hasWindows = typeof raw.windows === "string" && raw.windows.length > 0;
    const hasLinux = typeof raw.linux === "string" && raw.linux.length > 0;
    const hasOsx = typeof raw.osx === "string" && raw.osx.length > 0;
    if (!hasCommand && !hasBash && !hasPowerShell && !hasWindows && !hasLinux && !hasOsx) {
        return undefined;
    }
    const windows = hasWindows ? raw.windows : (hasPowerShell ? raw.powershell : undefined);
    const linux = hasLinux ? raw.linux : (hasBash ? raw.bash : undefined);
    const osx = hasOsx ? raw.osx : (hasBash ? raw.bash : undefined);
    const timeout = typeof raw.timeout === "number" ? raw.timeout : (typeof raw.timeoutSec === "number" ? raw.timeoutSec : undefined);
    return {
        ...(hasCommand && {
            command: raw.command
        }),
        ...(windows && {
            windows
        }),
        ...(linux && {
            linux
        }),
        ...(osx && {
            osx
        }),
        ...(typeof raw.env === "object" && raw.env !== null && {
            env: raw.env
        }),
        ...(timeout !== undefined && {
            timeout
        })
    };
}
function resolveHookCommand(raw, workspaceRoot, userHome) {
    const normalized = normalizeHookCommand(raw);
    if (!normalized) {
        return undefined;
    }
    let cwdUri;
    const rawCwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
    if (rawCwd) {
        if (rawCwd.startsWith("~/")) {
            cwdUri = URI.joinPath(userHome, rawCwd.substring(2));
        } else if (isAbsolute(rawCwd)) {
            cwdUri = URI.file(rawCwd);
        } else if (workspaceRoot) {
            cwdUri = joinPath(workspaceRoot, rawCwd);
        }
    } else {
        cwdUri = workspaceRoot;
    }
    return {
        ...normalized,
        cwd: cwdUri
    };
}
function extractHookCommands(item, workspaceRoot, userHome) {
    if (!item || typeof item !== "object") {
        return [];
    }
    const itemObj = item;
    const commands = [];
    const nestedHooks = itemObj.hooks;
    if (nestedHooks !== undefined && Array.isArray(nestedHooks)) {
        for (const nested of nestedHooks) {
            if (!nested || typeof nested !== "object") {
                continue;
            }
            const resolved = resolveHookCommand(nested, workspaceRoot, userHome);
            if (resolved) {
                commands.push(resolved);
            }
        }
    } else {
        const resolved = resolveHookCommand(itemObj, workspaceRoot, userHome);
        if (resolved) {
            commands.push(resolved);
        }
    }
    return commands;
}
function parseHooksJson(hookUri, json, workspaceRoot, userHome) {
    if (!json || typeof json !== "object") {
        return [];
    }
    const root = json;
    if (root.disableAllHooks === true) {
        return [];
    }
    const hooks = root.hooks;
    if (!hooks || typeof hooks !== "object") {
        return [];
    }
    const hooksObj = hooks;
    const result = [];
    const customization = makeHookCustomization(hookUri);
    for (const originalId of ( Object.keys(hooksObj))) {
        const canonicalType = HOOK_TYPE_MAP[originalId];
        if (!canonicalType) {
            continue;
        }
        const hookArray = hooksObj[originalId];
        if (!Array.isArray(hookArray)) {
            continue;
        }
        const commands = [];
        for (const item of hookArray) {
            commands.push(...extractHookCommands(item, workspaceRoot, userHome));
        }
        if (commands.length > 0) {
            result.push({
                type: canonicalType,
                commands,
                uri: hookUri,
                originalId,
                customization
            });
        }
    }
    return result;
}
function interpolateHookPluginRoot(hookUri, json, pluginUri, workspaceRoot, userHome, token, envVar) {
    const fsPath = pluginUri.fsPath;
    const typedJson = json;
    const mutateHookCommand = hook => {
        for (const field of ["command", "windows", "linux", "osx"]) {
            if (typeof hook[field] === "string") {
                hook[field] = shellQuotePluginRootInCommand(hook[field], fsPath, token);
            }
        }
        if (!hook.env || typeof hook.env !== "object") {
            hook.env = {};
        }
        hook.env[envVar] = fsPath;
    };
    for (const lifecycle of ( Object.values(typedJson.hooks ?? {}))) {
        if (!Array.isArray(lifecycle)) {
            continue;
        }
        for (const lifecycleEntry of lifecycle) {
            if (!lifecycleEntry || typeof lifecycleEntry !== "object") {
                continue;
            }
            const entry = lifecycleEntry;
            if (Array.isArray(entry.hooks)) {
                for (const hook of entry.hooks) {
                    mutateHookCommand(hook);
                }
            } else {
                mutateHookCommand(entry);
            }
        }
    }
    const replacer = v => {
        return typeof v === "string" ? v.replaceAll(token, pluginUri.fsPath) : undefined;
    };
    return parseHooksJson(hookUri, cloneAndChange(json, replacer), workspaceRoot, userHome);
}
async function pathExists(resource, fileService) {
    try {
        await fileService.resolve(resource);
        return true;
    } catch {
        return false;
    }
}
const COMMAND_FILE_SUFFIX = ".md";
async function readSkills(pluginRoot, dirs, fileService) {
    const seen = ( new Set());
    const skills = [];
    const addSkill = async (name, skillMd) => {
        let description;
        try {
            const parsedInfo = await parseSkillFile(skillMd, fileService);
            description = parsedInfo.description;
            name = parsedInfo.name || name;
        } catch {}
        if (( seen.has(name))) {
            return;
        }
        seen.add(name);
        skills.push({
            uri: skillMd,
            name,
            ...(description ? {
                description
            } : {})
        });
    };
    await Promise.all(( dirs.map(async dir => {
        const skillMd = URI.joinPath(dir, "SKILL.md");
        if (await pathExists(skillMd, fileService)) {
            await addSkill(basename(dir), skillMd);
            return;
        }
        let stat;
        try {
            stat = await fileService.resolve(dir);
        } catch {
            return;
        }
        if (!stat.isDirectory || !stat.children) {
            return;
        }
        await Promise.all(( stat.children.map(async child => {
            const childSkillMd = URI.joinPath(child.resource, "SKILL.md");
            if (await pathExists(childSkillMd, fileService)) {
                await addSkill(basename(child.resource), childSkillMd);
            }
        })));
    })));
    if (skills.length === 0) {
        const rootSkillMd = URI.joinPath(pluginRoot, "SKILL.md");
        if (await pathExists(rootSkillMd, fileService)) {
            await addSkill(basename(pluginRoot), rootSkillMd);
        }
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
}
async function readMarkdownComponents(dirs, fileService) {
    const seen = ( new Set());
    const items = [];
    const addItem = (name, uri) => {
        if (!( seen.has(name))) {
            seen.add(name);
            items.push({
                uri,
                name
            });
        }
    };
    for (const dir of dirs) {
        let stat;
        try {
            stat = await fileService.resolve(dir);
        } catch {
            continue;
        }
        if (stat.isFile && extname(dir).toLowerCase() === COMMAND_FILE_SUFFIX) {
            addItem(basename(dir).slice(0, -COMMAND_FILE_SUFFIX.length), dir);
            continue;
        }
        if (!stat.isDirectory || !stat.children) {
            continue;
        }
        for (const child of stat.children) {
            if (!child.isFile || extname(child.resource).toLowerCase() !== COMMAND_FILE_SUFFIX) {
                continue;
            }
            addItem(
                basename(child.resource).slice(0, -COMMAND_FILE_SUFFIX.length),
                child.resource
            );
        }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
}
async function parseSkillFile(uri, fileService) {
    try {
        const content = await fileService.readFile(uri);
        const frontmatter = parseFrontMatter(( content.value.toString()));
        const name = frontmatter?.getStringValue("name")?.trim() || basename(dirname(uri));
        const description = frontmatter?.getStringValue("description")?.trim();
        const userInvokable = frontmatter?.getBooleanValue("user-invocable");
        return {
            name,
            description,
            userInvokable
        };
    } catch {
        return {
            name: basename(dirname(uri))
        };
    }
}
function parseMcpServerDefinitionMap(definitionURI, raw, pluginFsPath, formatConfig) {
    const mcpServers = resolveMcpServersMap(raw);
    if (!mcpServers) {
        return [];
    }
    const definitions = [];
    for (const [name, configValue] of Object.entries(mcpServers)) {
        const configuration = normalizeMcpServerConfiguration(configValue);
        if (!configuration) {
            continue;
        }
        let def = {
            name,
            configuration,
            uri: definitionURI,
            customization: makeMcpServerCustomization(definitionURI, name)
        };
        if (formatConfig.pluginRootToken && formatConfig.pluginRootEnvVar) {
            def = interpolateMcpPluginRoot(
                def,
                pluginFsPath,
                formatConfig.pluginRootToken,
                formatConfig.pluginRootEnvVar
            );
        }
        def = convertBareEnvVarsToVsCodeSyntax(def);
        definitions.push(def);
    }
    return definitions;
}

export { IParsedHookCommand, PluginFormat, convertBareEnvVarsToVsCodeSyntax, detectPluginFormat, interpolateHookPluginRoot, interpolateMcpPluginRoot, makeMcpServerCustomization, normalizeMcpServerConfiguration, parseComponentPathConfig, parseHooksJson, parseMcpServerDefinitionMap, parseSkillFile, pathExists, readMarkdownComponents, readSkills, resolveComponentDirs, resolveMcpServersMap, shellQuotePluginRootInCommand };
