import { URI } from "../../../base/common/uri.js";
import { IFileService } from "../../files/common/files.service.js";
import { IMcpServerConfiguration } from "../../mcp/common/mcpPlatformTypes.js";
import { type AgentCustomization, type HookCustomization, type McpServerCustomization, type RuleCustomization, type SkillCustomization } from "../../agentHost/common/state/protocol/state.js";
/** A single hook command to execute. Platform resolution happens at conversion time. */
export interface IParsedHookCommand {
    /** Cross-platform default command. */
    readonly command?: string;
    /** Windows-specific command. */
    readonly windows?: string;
    /** Linux-specific command. */
    readonly linux?: string;
    /** macOS-specific command. */
    readonly osx?: string;
    /** Working directory. */
    readonly cwd?: URI;
    /** Environment variables. */
    readonly env?: Record<string, string>;
    /** Timeout in seconds. */
    readonly timeout?: number;
    /** URI of the file this hook was defined in. */
    readonly sourceUri?: URI;
}
export declare namespace IParsedHookCommand {
    function isEquals(a: IParsedHookCommand | undefined, b: IParsedHookCommand | undefined): boolean;
}
/** A group of hooks for a single lifecycle event. */
export interface IParsedHookGroup {
    /** Canonical hook type identifier (e.g. `'SessionStart'`, `'PreToolUse'`). */
    readonly type: string;
    /** The commands to execute for this hook type. */
    readonly commands: readonly IParsedHookCommand[];
    /** URI where this hook is defined. */
    readonly uri: URI;
    /** Original key as it appears in the hook file. */
    readonly originalId: string;
    /**
     * Protocol-level projection of this hook group as a child customization.
     * Multiple groups parsed from the same file share the same `customization.id`
     * so consumers can dedupe by id when collecting customizations.
     */
    readonly customization: HookCustomization;
}
export interface IMcpServerDefinition {
    readonly name: string;
    readonly configuration: IMcpServerConfiguration;
    readonly uri: URI;
    /** Protocol-level projection of this MCP server as a child customization. */
    readonly customization: McpServerCustomization;
}
/** A named resource (skill, agent, command, or instruction) within a plugin. */
export interface INamedPluginResource {
    readonly uri: URI;
    readonly name: string;
    /**
     * Optional short description, populated for resources whose readers
     * parse it from the file's YAML frontmatter (e.g. agents).
     */
    readonly description?: string;
}
/** A parsed agent paired with its protocol-level child customization. */
export interface IParsedAgent extends INamedPluginResource {
    readonly customization: AgentCustomization;
}
/** A parsed skill paired with its protocol-level child customization. */
export interface IParsedSkill extends INamedPluginResource {
    readonly customization: SkillCustomization;
}
/** A parsed rule (instruction) paired with its protocol-level child customization. */
export interface IParsedRule extends INamedPluginResource {
    readonly customization: RuleCustomization;
}
/** The result of parsing a single plugin directory. */
export interface IParsedPlugin {
    readonly hooks: readonly IParsedHookGroup[];
    readonly mcpServers: readonly IMcpServerDefinition[];
    readonly skills: readonly IParsedSkill[];
    readonly agents: readonly IParsedAgent[];
    readonly instructions: readonly IParsedRule[];
}
export declare enum PluginFormat {
    Copilot = 0,
    Claude = 1,
    OpenPlugin = 2
}
export interface IPluginFormatConfig {
    readonly format: PluginFormat;
    readonly manifestPath: string;
    readonly hookConfigPath: string;
    readonly pluginRootToken: string | undefined;
    readonly pluginRootEnvVar: string | undefined;
    /** Parses hooks from a JSON object using the format's conventions. */
    parseHooks(hookUri: URI, json: unknown, pluginUri: URI, workspaceRoot: URI | undefined, userHome: URI): IParsedHookGroup[];
}
export declare function detectPluginFormat(pluginUri: URI, fileService: IFileService): Promise<IPluginFormatConfig>;
/**
 * Builds the protocol {@link McpServerCustomization} for an MCP server
 * declared at `definitionUri` (the manifest / settings / `.mcp.json` file
 * the server is defined in). The id is disambiguated by server `name` so
 * multiple servers declared in one file get distinct ids, and the entry
 * carries {@link DEFAULT_MCP_APP} so MCP App support is advertised
 * consistently with every other MCP customization.
 */
export declare function makeMcpServerCustomization(definitionUri: URI, name: string): McpServerCustomization;
export interface IComponentPathConfig {
    readonly paths: readonly string[];
    readonly exclusive: boolean;
}
/**
 * Parses a manifest component path field into a normalized config.
 * Supports `undefined`, `string`, `string[]`, and `{ paths: string[], exclusive?: boolean }`.
 */
export declare function parseComponentPathConfig(raw: unknown): IComponentPathConfig;
/**
 * Resolves the directories to scan for a given component type, combining
 * the default directory with any custom paths from the manifest config.
 * Paths that resolve outside the boundary are silently ignored.
 * @param boundaryUri The outermost directory that resolved paths must stay within. Defaults to {@link pluginUri}.
 */
export declare function resolveComponentDirs(pluginUri: URI, defaultDir: string, config: IComponentPathConfig, boundaryUri?: URI): readonly URI[];
/**
 * Extracts the MCP server map from a raw JSON value. Accepts both the
 * wrapped format `{ mcpServers: { … } }` and the flat format.
 */
export declare function resolveMcpServersMap(raw: unknown): Record<string, unknown> | undefined;
/**
 * Normalizes a raw JSON value into a typed MCP server configuration.
 */
export declare function normalizeMcpServerConfiguration(rawConfig: unknown): IMcpServerConfiguration | undefined;
/**
 * Replaces a plugin-root token in a shell command string with the
 * given fsPath, shell-quoting if the path contains special characters.
 */
export declare function shellQuotePluginRootInCommand(command: string, fsPath: string, token: string): string;
/**
 * Replaces plugin-root token references in MCP server definition string fields
 * with the plugin root filesystem path.
 */
export declare function interpolateMcpPluginRoot(def: IMcpServerDefinition, fsPath: string, token: string, envVar: string): IMcpServerDefinition;
/**
 * Converts bare `${VAR}` environment-variable references to VS Code `${env:VAR}` syntax.
 */
export declare function convertBareEnvVarsToVsCodeSyntax(def: IMcpServerDefinition): IMcpServerDefinition;
/**
 * Parses hooks from a JSON object (any supported format).
 *
 * Handles Claude's `disableAllHooks` short-circuit, the `HOOK_TYPE_MAP`
 * canonicalization, and the nested `{ matcher, hooks: [...] }` command
 * form. Returns one {@link IParsedHookGroup} per recognized lifecycle
 * event; all groups parsed from the same file share a single
 * {@link IParsedHookGroup.customization} (keyed on `hookUri`), so callers
 * that only need the file-level customization can read it off any group.
 */
export declare function parseHooksJson(hookUri: URI, json: unknown, workspaceRoot: URI | undefined, userHome: URI): IParsedHookGroup[];
/**
 * Applies plugin-root token interpolation to hook commands for
 * Claude and OpenPlugin formats.
 */
export declare function interpolateHookPluginRoot(hookUri: URI, json: unknown, pluginUri: URI, workspaceRoot: URI | undefined, userHome: URI, token: string, envVar: string): IParsedHookGroup[];
export declare function readJsonFile(uri: URI, fileService: IFileService): Promise<unknown | undefined>;
export declare function pathExists(resource: URI, fileService: IFileService): Promise<boolean>;
export declare function readSkills(pluginRoot: URI, dirs: readonly URI[], fileService: IFileService): Promise<readonly INamedPluginResource[]>;
export declare function readMarkdownComponents(dirs: readonly URI[], fileService: IFileService): Promise<readonly INamedPluginResource[]>;
/**
 * Reads rule/instruction files from plugin `rules` component directories.
 *
 * Open Plugins rules are conventionally `.mdc` files. We also accept
 * `.instructions.md` for compatibility with VS Code-discovered instructions
 * bundled as synthetic plugins.
 */
export declare function readInstructionComponents(dirs: readonly URI[], fileService: IFileService): Promise<readonly INamedPluginResource[]>;
/**
 * Reads `.md` files in agent directories and enriches each entry with
 * the optional `name` / `description` from YAML frontmatter. Falls back
 * to the file-derived name when frontmatter is missing or unreadable.
 */
export declare function readAgentComponents(dirs: readonly URI[], fileService: IFileService): Promise<readonly INamedPluginResource[]>;
export declare function parseAgentFile(uri: URI, fileService: IFileService): Promise<{
    name: string;
    description?: string;
    userInvocable?: boolean;
}>;
export declare function parseSkillFile(uri: URI, fileService: IFileService): Promise<{
    name: string;
    description?: string;
    userInvokable?: boolean;
}>;
export declare function parseRuleFile(uri: URI, fileService: IFileService): Promise<{
    name: string;
    description?: string;
    globs?: string[];
    alwaysApply?: boolean;
}>;
export declare function parseMcpServerDefinitionMap(definitionURI: URI, raw: unknown, pluginFsPath: string, formatConfig: IPluginFormatConfig): IMcpServerDefinition[];
/**
 * Parses a plugin directory to extract hooks, MCP servers, skills, agents,
 * and instructions.
 * This is the main entry point for the agent host to discover plugin contents.
 */
export declare function parsePlugin(pluginUri: URI, fileService: IFileService, workspaceRoot: URI | undefined, userHome: URI, boundaryUri?: URI): Promise<IParsedPlugin>;
/** Pairs an agent {@link INamedPluginResource} with its protocol-level {@link AgentCustomization}. */
export declare function toParsedAgent(resource: INamedPluginResource): IParsedAgent;
/** Pairs a skill {@link INamedPluginResource} with its protocol-level {@link SkillCustomization}. */
export declare function toParsedSkill(resource: INamedPluginResource): IParsedSkill;
