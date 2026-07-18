
import { localize } from '../../../../../nls.js';
import { AgentSandboxSettingId, AgentSandboxEnabledValue } from '../../../../../platform/sandbox/common/settings.js';
import { TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';
import { terminalProfileBaseProperties } from '../../../../../platform/terminal/common/terminalPlatformConfiguration.js';
import { PolicyCategory } from '../../../../../base/common/policy.js';

const DEFAULT_IDLE_SILENCE_TIMEOUT_MS = 300_000;
var TerminalChatAgentToolsSettingId;
(function(TerminalChatAgentToolsSettingId) {
    TerminalChatAgentToolsSettingId["EnableAutoApprove"] = "chat.tools.terminal.enableAutoApprove";
    TerminalChatAgentToolsSettingId["AutoApprove"] = "chat.tools.terminal.autoApprove";
    TerminalChatAgentToolsSettingId["AutoApproveWorkspaceNpmScripts"] = "chat.tools.terminal.autoApproveWorkspaceNpmScripts";
    TerminalChatAgentToolsSettingId["IgnoreDefaultAutoApproveRules"] = "chat.tools.terminal.ignoreDefaultAutoApproveRules";
    TerminalChatAgentToolsSettingId["BlockDetectedFileWrites"] = "chat.tools.terminal.blockDetectedFileWrites";
    TerminalChatAgentToolsSettingId["ShellIntegrationTimeout"] = "chat.tools.terminal.shellIntegrationTimeout";
    TerminalChatAgentToolsSettingId["OutputLocation"] = "chat.tools.terminal.outputLocation";
    TerminalChatAgentToolsSettingId["AgentSandboxLinuxFileSystem"] = "chat.agent.sandbox.fileSystem.linux";
    TerminalChatAgentToolsSettingId["AgentSandboxMacFileSystem"] = "chat.agent.sandbox.fileSystem.mac";
    TerminalChatAgentToolsSettingId["AgentSandboxWindowsFileSystem"] = "chat.agent.sandbox.fileSystem.windows";
    TerminalChatAgentToolsSettingId["AgentSandboxAdvancedRuntime"] = "chat.agent.sandbox.advanced.runtime";
    TerminalChatAgentToolsSettingId["PreventShellHistory"] = "chat.tools.terminal.preventShellHistory";
    TerminalChatAgentToolsSettingId["EnforceTimeoutFromModel"] = "chat.tools.terminal.enforceTimeoutFromModel";
    TerminalChatAgentToolsSettingId["IdleSilenceTimeoutMs"] = "chat.tools.terminal.idleSilenceTimeoutMs";
    TerminalChatAgentToolsSettingId["DetachBackgroundProcesses"] = "chat.tools.terminal.detachBackgroundProcesses";
    TerminalChatAgentToolsSettingId["BackgroundNotifications"] = "chat.tools.terminal.backgroundNotifications";
    TerminalChatAgentToolsSettingId["OutputDeltas"] = "chat.tools.terminal.outputDeltas";
    TerminalChatAgentToolsSettingId["IdlePollInterval"] = "chat.tools.terminal.idlePollInterval";
    TerminalChatAgentToolsSettingId["TerminalProfileLinux"] = "chat.tools.terminal.terminalProfile.linux";
    TerminalChatAgentToolsSettingId["TerminalProfileMacOs"] = "chat.tools.terminal.terminalProfile.osx";
    TerminalChatAgentToolsSettingId["TerminalProfileWindows"] = "chat.tools.terminal.terminalProfile.windows";
    TerminalChatAgentToolsSettingId["DeprecatedAgentSandboxLinuxFileSystem"] = "chat.agent.sandboxFileSystem.linux";
    TerminalChatAgentToolsSettingId["DeprecatedAgentSandboxMacFileSystem"] = "chat.agent.sandboxFileSystem.mac";
    TerminalChatAgentToolsSettingId["DeprecatedAutoApproveCompatible"] = "chat.agent.terminal.autoApprove";
    TerminalChatAgentToolsSettingId["DeprecatedAutoApprove1"] = "chat.agent.terminal.allowList";
    TerminalChatAgentToolsSettingId["DeprecatedAutoApprove2"] = "chat.agent.terminal.denyList";
    TerminalChatAgentToolsSettingId["DeprecatedAutoApprove3"] = "github.copilot.chat.agent.terminal.allowList";
    TerminalChatAgentToolsSettingId["DeprecatedAutoApprove4"] = "github.copilot.chat.agent.terminal.denyList";
})(TerminalChatAgentToolsSettingId || (TerminalChatAgentToolsSettingId = {}));
const autoApproveBoolean = {
    type: "boolean",
    enum: [true, false],
    enumDescriptions: [( localize(15437, "Automatically approve the pattern.")), ( localize(15438, "Require explicit approval for the pattern."))],
    description: ( localize(
        15439,
        "The start of a command to match against. A regular expression can be provided by wrapping the string in `/` characters."
    ))
};
const terminalChatAgentProfileSchema = {
    type: "object",
    required: ["path"],
    properties: {
        path: {
            description: ( localize(15440, "A path to a shell executable.")),
            type: "string"
        },
        ...terminalProfileBaseProperties
    }
};
const terminalChatAgentToolsConfiguration = {
    [TerminalChatAgentToolsSettingId.EnableAutoApprove]: {
        description: ( localize(
            15441,
            "Controls whether to allow auto approval in the run in terminal tool."
        )),
        type: "boolean",
        default: true,
        policy: {
            name: "ChatToolsTerminalEnableAutoApprove",
            category: PolicyCategory.IntegratedTerminal,
            minimumVersion: "1.104",
            localization: {
                description: {
                    key: "autoApproveMode.description",
                    value: ( localize(
                        15441,
                        "Controls whether to allow auto approval in the run in terminal tool."
                    ))
                }
            }
        },
        agentsWindow: {
            default: true
        }
    },
    [TerminalChatAgentToolsSettingId.AutoApprove]: {
        markdownDescription: [( localize(
            15442,
            "A list of commands or regular expressions that control whether the run in terminal tool commands require explicit approval. These will be matched against the start of a command. A regular expression can be provided by wrapping the string in {0} characters followed by optional flags such as {1} for case-insensitivity.",
            "`/`",
            "`i`"
        )), ( localize(
            15443,
            "Set to {0} to automatically approve commands, {1} to always require explicit approval or {2} to unset the value.",
            "`true`",
            "`false`",
            "`null`"
        )), ( localize(
            15444,
            "Note that these commands and regular expressions are evaluated for every _sub-command_ within the full _command line_, so {0} for example will need both {1} and {2} to match a {3} entry and must not match a {4} entry in order to auto approve. Inline commands such as {5} (process substitution) should also be detected.",
            "`foo && bar`",
            "`foo`",
            "`bar`",
            "`true`",
            "`false`",
            "`<(foo)`"
        )), ( localize(
            15445,
            "An object can be used to match against the full command line instead of matching sub-commands and inline commands, for example {0}. In order to be auto approved _both_ the sub-command and command line must not be explicitly denied, then _either_ all sub-commands or command line needs to be approved.",
            "`{ approve: false, matchCommandLine: true }`"
        )), ( localize(
            15446,
            "Note that there's a default set of rules to allow and also deny commands. Consider setting {0} to {1} to ignore all default rules to ensure there are no conflicts with your own rules. Do this at your own risk, the default denial rules are designed to protect you against running dangerous commands.",
            `\`#${TerminalChatAgentToolsSettingId.IgnoreDefaultAutoApproveRules}#\``,
            "`true`"
        )), [( localize(15447, "Examples:")), `|${( localize(15448, "Value"))}|${( localize(15449, "Description"))}|`, "|---|---|", "| `\"mkdir\": true` | " + ( localize(15450, "Allow all commands starting with {0}", "`mkdir`")), "| `\"npm run build\": true` | " + ( localize(15451, "Allow all commands starting with {0}", "`npm run build`")), "| `\"bin/test.sh\": true` | " + ( localize(
            15452,
            "Allow all commands that match the path {0} ({1}, {2}, etc.)",
            "`bin/test.sh`",
            "`bin\\test.sh`",
            "`./bin/test.sh`"
        )), "| `\"/^git (status\\|show\\\\b.*)$/\": true` | " + ( localize(
            15453,
            "Allow {0} and all commands starting with {1}",
            "`git status`",
            "`git show`"
        )), "| `\"/^Get-ChildItem\\\\b/i\": true` | " + ( localize(15454, "will allow {0} commands regardless of casing", "`Get-ChildItem`")), "| `\"/.*/\": true` | " + ( localize(15455, "Allow all commands (denied commands still require approval)")), "| `\"rm\": false` | " + ( localize(
            15456,
            "Require explicit approval for all commands starting with {0}",
            "`rm`"
        )), "| `\"/\\\\.ps1/i\": { approve: false, matchCommandLine: true }` | " + ( localize(
            15457,
            "Require explicit approval for any _command line_ that contains {0} regardless of casing",
            "`\".ps1\"`"
        )), "| `\"rm\": null` | " + ( localize(15458, "Unset the default {0} value for {1}", "`false`", "`rm`"))].join("\n")].join("\n\n"),
        type: "object",
        additionalProperties: {
            anyOf: [autoApproveBoolean, {
                type: "object",
                properties: {
                    approve: autoApproveBoolean,
                    matchCommandLine: {
                        type: "boolean",
                        enum: [true, false],
                        enumDescriptions: [( localize(15459, "Match against the full command line, eg. `foo && bar`.")), ( localize(
                            15460,
                            "Match against sub-commands and inline commands, eg. `foo && bar` will need both `foo` and `bar` to match."
                        ))],
                        description: ( localize(
                            15461,
                            "Whether to match against the full command line, as opposed to splitting by sub-commands and inline commands."
                        ))
                    }
                },
                required: ["approve"]
            }, {
                type: "null",
                description: ( localize(
                    15462,
                    "Ignore the pattern, this is useful for unsetting the same pattern set at a higher scope."
                ))
            }]
        },
        default: {
            cd: true,
            echo: true,
            ls: true,
            dir: true,
            pwd: true,
            cat: true,
            head: true,
            tail: true,
            findstr: true,
            wc: true,
            tr: true,
            cut: true,
            cmp: true,
            which: true,
            basename: true,
            dirname: true,
            realpath: true,
            readlink: true,
            stat: true,
            file: true,
            od: true,
            du: true,
            df: true,
            sleep: true,
            nl: true,
            grep: true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+status\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+log\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+log\\b.*\\s--output(=|\\s|$)/": false,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+show\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+diff\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+ls-files\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+grep\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+branch\\b/": true,
            "/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+branch\\b.*\\s-(d|D|m|M|-delete|-force)\\b/": false,
            "/^docker\\s+(ps|images|info|version|inspect|logs|top|stats|port|diff|search|events)\\b/": true,
            "/^docker\\s+(container|image|network|volume|context|system)\\s+(ls|ps|inspect|history|show|df|info)\\b/": true,
            "/^docker\\s+compose\\s+(ps|ls|top|logs|images|config|version|port|events)\\b/": true,
            "Get-ChildItem": true,
            "Get-Content": true,
            "Get-Date": true,
            "Get-Random": true,
            "Get-Location": true,
            "Set-Location": true,
            "Write-Host": true,
            "Write-Output": true,
            "Out-String": true,
            "Split-Path": true,
            "Join-Path": true,
            "Start-Sleep": true,
            "Where-Object": true,
            "/^Select-[a-z0-9]/i": true,
            "/^Measure-[a-z0-9]/i": true,
            "/^Compare-[a-z0-9]/i": true,
            "/^Format-[a-z0-9]/i": true,
            "/^Sort-[a-z0-9]/i": true,
            "/^npm\\s+(ls|list|outdated|view|info|show|explain|why|root|prefix|bin|search|doctor|fund|repo|bugs|docs|home|help(-search)?)\\b/": true,
            "/^npm\\s+config\\s+(list|get)\\b/": true,
            "/^npm\\s+pkg\\s+get\\b/": true,
            "/^npm\\s+audit$/": true,
            "/^npm\\s+cache\\s+verify\\b/": true,
            "/^yarn\\s+(list|outdated|info|why|bin|help|versions)\\b/": true,
            "/^yarn\\s+licenses\\b/": true,
            "/^yarn\\s+audit\\b(?!.*\\bfix\\b)/": true,
            "/^yarn\\s+config\\s+(list|get)\\b/": true,
            "/^yarn\\s+cache\\s+dir\\b/": true,
            "/^pnpm\\s+(ls|list|outdated|why|root|bin|doctor)\\b/": true,
            "/^pnpm\\s+licenses\\b/": true,
            "/^pnpm\\s+audit\\b(?!.*\\bfix\\b)/": true,
            "/^pnpm\\s+config\\s+(list|get)\\b/": true,
            "npm ci": true,
            "/^yarn\\s+install\\s+--frozen-lockfile\\b/": true,
            "/^pnpm\\s+install\\s+--frozen-lockfile\\b/": true,
            column: true,
            "/^column\\b.*\\s-c\\s+[0-9]{4,}/": false,
            date: true,
            "/^date\\b.*\\s(-s|--set)\\b/": false,
            find: true,
            "/^find\\b.*\\s-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\\b/": false,
            rg: true,
            "/^rg\\b.*\\s(--pre|--hostname-bin)\\b/": false,
            sed: true,
            "/^sed\\b.*\\s(-[a-zA-Z]*(e|f)[a-zA-Z]*|--expression|--file)\\b/": false,
            "/^sed\\b.*s\\/.*\\/.*\\/[ew]/": false,
            "/^sed\\b.*;W/": false,
            sort: true,
            "/^sort\\b.*\\s-(o|S)\\b/": false,
            tree: true,
            "/^tree\\b.*\\s-o\\b/": false,
            "/^xxd$/": true,
            "/^xxd\\b(\\s+-\\S+)*\\s+[^-\\s]\\S*$/": true,
            rm: false,
            rmdir: false,
            del: false,
            "Remove-Item": false,
            ri: false,
            rd: false,
            erase: false,
            dd: false,
            kill: false,
            ps: false,
            top: false,
            "Stop-Process": false,
            spps: false,
            taskkill: false,
            "taskkill.exe": false,
            curl: false,
            wget: false,
            "Invoke-RestMethod": false,
            "Invoke-WebRequest": false,
            "irm": false,
            "iwr": false,
            chmod: false,
            chown: false,
            "Set-ItemProperty": false,
            "sp": false,
            "Set-Acl": false,
            jq: false,
            xargs: false,
            eval: false,
            "Invoke-Expression": false,
            iex: false
        }
    },
    [TerminalChatAgentToolsSettingId.IgnoreDefaultAutoApproveRules]: {
        type: "boolean",
        default: false,
        tags: ["experimental"],
        markdownDescription: ( localize(
            15463,
            "Whether to ignore the built-in default auto-approve rules used by the run in terminal tool as defined in {0}. When this setting is enabled, the run in terminal tool will ignore any rule that comes from the default set but still follow rules defined in the user, remote and workspace settings. Use this setting at your own risk; the default auto-approve rules are designed to protect you against running dangerous commands.",
            `\`#${TerminalChatAgentToolsSettingId.AutoApprove}#\``
        ))
    },
    [TerminalChatAgentToolsSettingId.AutoApproveWorkspaceNpmScripts]: {
        restricted: true,
        type: "boolean",
        default: true,
        tags: ["experimental"],
        markdownDescription: ( localize(
            15464,
            "Whether to automatically approve npm, yarn, and pnpm run commands when the script is defined in a workspace package.json file. Since the workspace is trusted, scripts defined in package.json are considered safe to run without explicit approval."
        ))
    },
    [TerminalChatAgentToolsSettingId.BlockDetectedFileWrites]: {
        type: "string",
        enum: ["never", "outsideWorkspace", "all"],
        enumDescriptions: [( localize(15465, "Allow all detected file writes.")), ( localize(
            15466,
            "Block file writes detected outside the workspace. This depends on the shell integration feature working correctly to determine the current working directory of the terminal."
        )), ( localize(15467, "Block all detected file writes."))],
        default: "outsideWorkspace",
        tags: ["experimental"],
        markdownDescription: ( localize(
            15468,
            "Controls whether detected file write operations are blocked in the run in terminal tool. When detected, this will require explicit approval regardless of whether the command would normally be auto approved. Note that this cannot detect all possible methods of writing files, this is what is currently detected:\n\n- File redirection (detected via the bash or PowerShell tree sitter grammar)\n- `sed` in-place editing (`-i`, `-I`, `--in-place`)"
        ))
    },
    [TerminalChatAgentToolsSettingId.ShellIntegrationTimeout]: {
        markdownDescription: ( localize(
            15469,
            "Configures the duration in milliseconds to wait for shell integration to be detected when the run in terminal tool launches a new terminal. Set to `0` to skip the wait entirely, the default value `-1` uses a variable wait time based on the value of {0} and whether it's a remote window. A large value can be useful if your shell starts very slowly.",
            `\`#${TerminalSettingId.ShellIntegrationEnabled}#\``
        )),
        type: "integer",
        minimum: -1,
        maximum: 60000,
        default: -1,
        markdownDeprecationMessage: ( localize(
            15470,
            "Use {0} instead",
            `\`#${TerminalSettingId.ShellIntegrationTimeout}#\``
        ))
    },
    [TerminalChatAgentToolsSettingId.IdlePollInterval]: {
        markdownDescription: ( localize(
            15471,
            "Configures the idle poll interval in milliseconds used by the run in terminal tool to detect when commands have finished executing. Lower values make command detection faster but may cause false positives on slow systems. This primarily affects terminals without shell integration where idle detection is used instead of shell integration events."
        )),
        type: "integer",
        minimum: 50,
        maximum: 10000,
        default: 1000
    },
    [TerminalChatAgentToolsSettingId.TerminalProfileLinux]: {
        restricted: true,
        markdownDescription: ( localize(
            15472,
            "The terminal profile to use on Linux for chat agent's run in terminal tool."
        )),
        type: ["object", "null"],
        default: null,
        "anyOf": [{
            type: "null"
        }, terminalChatAgentProfileSchema],
        defaultSnippets: [{
            body: {
                path: "${1}"
            }
        }]
    },
    [TerminalChatAgentToolsSettingId.TerminalProfileMacOs]: {
        restricted: true,
        markdownDescription: ( localize(
            15473,
            "The terminal profile to use on macOS for chat agent's run in terminal tool."
        )),
        type: ["object", "null"],
        default: null,
        "anyOf": [{
            type: "null"
        }, terminalChatAgentProfileSchema],
        defaultSnippets: [{
            body: {
                path: "${1}"
            }
        }]
    },
    [TerminalChatAgentToolsSettingId.TerminalProfileWindows]: {
        restricted: true,
        markdownDescription: ( localize(
            15474,
            "The terminal profile to use on Windows for chat agent's run in terminal tool."
        )),
        type: ["object", "null"],
        default: null,
        "anyOf": [{
            type: "null"
        }, terminalChatAgentProfileSchema],
        defaultSnippets: [{
            body: {
                path: "${1}"
            }
        }]
    },
    [TerminalChatAgentToolsSettingId.OutputLocation]: {
        markdownDescription: ( localize(15475, "Where to show the output from the run in terminal tool.")),
        type: "string",
        enum: ["terminal", "chat"],
        enumDescriptions: [( localize(15476, "Reveal the terminal in the panel or editor in addition to chat.")), ( localize(15477, "Reveal the terminal output within chat only."))],
        default: "chat",
        tags: ["experimental"],
        experiment: {
            mode: "auto"
        }
    },
    [AgentSandboxSettingId.AgentSandboxEnabled]: {
        markdownDescription: ( localize(
            15478,
            "Controls whether agent mode uses sandboxing to restrict what tools can do. When enabled, tools like the terminal are run in a sandboxed environment to limit access to the system. Use {0} to allow all network domains.",
            `\`#${AgentSandboxSettingId.AgentSandboxAllowNetwork}#\``
        )),
        type: "string",
        enum: [AgentSandboxEnabledValue.Off, AgentSandboxEnabledValue.On],
        enumDescriptions: [( localize(15479, "Disable sandboxing for agent mode tools.")), ( localize(15480, "Enable sandboxing for agent mode tools."))],
        default: AgentSandboxEnabledValue.Off,
        tags: ["preview"],
        restricted: true,
        experiment: {
            mode: "auto"
        },
        policy: {
            name: "ChatAgentSandboxEnabled",
            category: PolicyCategory.IntegratedTerminal,
            minimumVersion: "1.116",
            localization: {
                description: {
                    key: "agentSandbox.enabledSetting",
                    value: ( localize(
                        15478,
                        "Controls whether agent mode uses sandboxing to restrict what tools can do. When enabled, tools like the terminal are run in a sandboxed environment to limit access to the system. Use {0} to allow all network domains.",
                        `\`#${AgentSandboxSettingId.AgentSandboxAllowNetwork}#\``
                    ))
                },
                enumDescriptions: [{
                    key: "agentSandbox.enabledSetting.offDescription",
                    value: ( localize(15479, "Disable sandboxing for agent mode tools."))
                }, {
                    key: "agentSandbox.enabledSetting.onDescription",
                    value: ( localize(15480, "Enable sandboxing for agent mode tools."))
                }]
            }
        }
    },
    [AgentSandboxSettingId.AgentSandboxWindowsEnabled]: {
        markdownDescription: ( localize(
            15481,
            "Controls whether agent mode uses sandboxing on Windows. Use {0} to allow all network domains.",
            `\`#${AgentSandboxSettingId.AgentSandboxAllowNetwork}#\``
        )),
        type: "string",
        enum: [AgentSandboxEnabledValue.Off, AgentSandboxEnabledValue.On],
        enumDescriptions: [( localize(15482, "Disable sandboxing for agent mode tools on Windows.")), ( localize(15483, "Enable sandboxing for agent mode tools on Windows."))],
        default: AgentSandboxEnabledValue.Off,
        tags: ["experimental"],
        restricted: true,
        experiment: {
            mode: "auto"
        }
    },
    [AgentSandboxSettingId.AgentSandboxAllowNetwork]: {
        markdownDescription: ( localize(
            15484,
            "When {0} is enabled, controls whether to allow all network domains in the sandbox. When enabled, the sandbox preserves file system restrictions while relaxing all network restrictions.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "boolean",
        default: false,
        tags: ["preview"],
        restricted: true,
        policy: {
            name: "ChatAgentSandboxAllowNetwork",
            category: PolicyCategory.IntegratedTerminal,
            minimumVersion: "1.127",
            localization: {
                description: {
                    key: "agentSandbox.allowNetwork",
                    value: ( localize(
                        15484,
                        "When {0} is enabled, controls whether to allow all network domains in the sandbox. When enabled, the sandbox preserves file system restrictions while relaxing all network restrictions.",
                        `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
                    ))
                }
            }
        }
    },
    [AgentSandboxSettingId.AgentSandboxAllowUnsandboxedCommands]: {
        markdownDescription: ( localize(
            15485,
            "Controls whether agent mode terminal commands can run outside the sandbox after user confirmation when a sandboxed command fails or when sandbox restrictions would block the command. This applies only when {0} is enabled.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "boolean",
        default: true,
        tags: ["preview"],
        restricted: true,
        policy: {
            name: "ChatAgentSandboxAllowUnsandboxedCommands",
            category: PolicyCategory.IntegratedTerminal,
            minimumVersion: "1.116",
            localization: {
                description: {
                    key: "agentSandbox.allowUnsandboxedCommands",
                    value: ( localize(
                        15485,
                        "Controls whether agent mode terminal commands can run outside the sandbox after user confirmation when a sandboxed command fails or when sandbox restrictions would block the command. This applies only when {0} is enabled.",
                        `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
                    ))
                }
            }
        }
    },
    [AgentSandboxSettingId.AgentSandboxRetryWithAllowNetworkRequests]: {
        markdownDescription: ( localize(
            15486,
            "Controls whether agent mode terminal commands can retry in the sandbox with unrestricted network access after user confirmation. This applies only when {0} is enabled and preserves file system sandboxing while relaxing network restrictions for an approved command.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "boolean",
        default: true,
        tags: ["preview"],
        restricted: true
    },
    [AgentSandboxSettingId.AgentSandboxAllowAutoApprove]: {
        markdownDescription: ( localize(
            15487,
            "Controls whether agent mode terminal commands that run inside the sandbox are auto-approved. When disabled, the run in terminal tool uses the existing approval flow. This applies only when {0} is enabled.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "boolean",
        default: true,
        tags: ["preview"],
        restricted: true,
        policy: {
            name: "ChatAgentSandboxAllowAutoApprove",
            category: PolicyCategory.IntegratedTerminal,
            minimumVersion: "1.116",
            localization: {
                description: {
                    key: "agentSandbox.allowAutoApprove",
                    value: ( localize(
                        15487,
                        "Controls whether agent mode terminal commands that run inside the sandbox are auto-approved. When disabled, the run in terminal tool uses the existing approval flow. This applies only when {0} is enabled.",
                        `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
                    ))
                }
            }
        }
    },
    [TerminalChatAgentToolsSettingId.AgentSandboxLinuxFileSystem]: {
        markdownDescription: ( localize(
            15488,
            "Note: this setting is applicable only when {0} is enabled. Controls file system access in sandbox on Linux. Paths do not support glob patterns, only literal paths (ex: ./src/, ~/.ssh, .env). **bubblewrap** and **socat** should be installed for this setting to work.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "object",
        properties: {
            denyRead: {
                type: "array",
                description: ( localize(
                    15489,
                    "Array of paths to deny read access. Leave empty to allow reading all paths."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowRead: {
                type: "array",
                description: ( localize(
                    15490,
                    "Array of paths to re-allow read access within denied regions. Takes precedence over denyRead."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowWrite: {
                type: "array",
                description: ( localize(
                    15491,
                    "Array of additional paths to allow write access. Leave empty to disallow writes outside the workspace folders, workspace storage folder, and sandbox temp directory."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            denyWrite: {
                type: "array",
                description: ( localize(
                    15492,
                    "Array of paths to deny write access within allowed paths (takes precedence over allowWrite)."
                )),
                items: {
                    type: "string"
                },
                default: []
            }
        },
        default: {
            denyRead: [],
            allowRead: [],
            allowWrite: [],
            denyWrite: []
        },
        tags: ["preview"],
        restricted: true
    },
    [TerminalChatAgentToolsSettingId.AgentSandboxMacFileSystem]: {
        markdownDescription: ( localize(
            15493,
            "Note: this setting is applicable only when {0} is enabled. Controls file system access in sandbox on macOS. Paths also support git-style glob patterns(ex: *.ts, ./src, ./src/**/*.ts, file?.txt).",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "object",
        properties: {
            denyRead: {
                type: "array",
                description: ( localize(
                    15494,
                    "Array of paths to deny read access. Leave empty to allow reading all paths."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowRead: {
                type: "array",
                description: ( localize(
                    15495,
                    "Array of paths to re-allow read access within denied regions. Takes precedence over denyRead."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowWrite: {
                type: "array",
                description: ( localize(
                    15496,
                    "Array of additional paths to allow write access. Leave empty to disallow writes outside the workspace folders, workspace storage folder, and sandbox temp directory."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            denyWrite: {
                type: "array",
                description: ( localize(
                    15497,
                    "Array of paths to deny write access within allowed paths (takes precedence over allowWrite)."
                )),
                items: {
                    type: "string"
                },
                default: []
            }
        },
        default: {
            denyRead: [],
            allowRead: [],
            allowWrite: [],
            denyWrite: []
        },
        tags: ["preview"],
        restricted: true
    },
    [TerminalChatAgentToolsSettingId.AgentSandboxWindowsFileSystem]: {
        markdownDescription: ( localize(
            15498,
            "Note: this setting is applicable only when {0} is enabled. Controls file system access in sandbox on Windows. Paths do not support glob patterns, only literal paths (ex: C:\\src, C:\\Users\\me\\.ssh, .env).",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "object",
        properties: {
            denyRead: {
                type: "array",
                description: ( localize(
                    15499,
                    "Array of paths to deny access. Leave empty to allow reading all paths."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowRead: {
                type: "array",
                description: ( localize(
                    15500,
                    "Array of additional paths to allow read-only access. Takes precedence over denyRead."
                )),
                items: {
                    type: "string"
                },
                default: []
            },
            allowWrite: {
                type: "array",
                description: ( localize(
                    15501,
                    "Array of additional paths to allow read/write access. Leave empty to disallow writes outside the workspace folders, workspace storage folder, and sandbox temp directory."
                )),
                items: {
                    type: "string"
                },
                default: []
            }
        },
        default: {
            denyRead: [],
            allowRead: [],
            allowWrite: []
        },
        tags: ["preview"],
        restricted: true
    },
    [AgentSandboxSettingId.AgentSandboxWindowsSchemaVersion]: {
        included: false,
        restricted: true,
        type: "string"
    },
    [TerminalChatAgentToolsSettingId.AgentSandboxAdvancedRuntime]: {
        markdownDescription: ( localize(
            15502,
            "Note: this setting is applicable only when {0} is enabled. Key/value pairs are passed through to the root of the sandbox runtime configuration.",
            `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
        )),
        type: "object",
        default: {
            enableWeakerNestedSandbox: false
        },
        additionalProperties: true,
        tags: ["preview"],
        restricted: true
    },
    [TerminalChatAgentToolsSettingId.PreventShellHistory]: {
        type: "boolean",
        default: true,
        markdownDescription: [( localize(
            15503,
            "Whether to exclude commands run by the terminal tool from the shell history. See below for the supported shells and the method used for each:"
        )), `- \`bash\`: ${( localize(
            15504,
            "Sets `HISTCONTROL=ignorespace` and prepends the command with space"
        ))}`, `- \`zsh\`: ${( localize(
            15505,
            "Sets `HIST_IGNORE_SPACE` option and prepends the command with space"
        ))}`, `- \`fish\`: ${( localize(
            15506,
            "Sets `fish_private_mode` to prevent any command from entering history"
        ))}`, `- \`pwsh\`: ${( localize(
            15507,
            "Sets a custom history handler via PSReadLine's `AddToHistoryHandler` to prevent any command from entering history"
        ))}`].join("\n")
    },
    [TerminalChatAgentToolsSettingId.EnforceTimeoutFromModel]: {
        restricted: true,
        type: "boolean",
        default: true,
        tags: ["experimental"],
        experiment: {
            mode: "auto"
        },
        markdownDescription: ( localize(
            15508,
            "Whether to enforce the timeout value provided by the model in the run in terminal tool. When enabled, if the model provides a timeout parameter, the tool will stop tracking the command after that duration and return the output collected so far."
        ))
    },
    [TerminalChatAgentToolsSettingId.IdleSilenceTimeoutMs]: {
        restricted: true,
        type: "number",
        default: DEFAULT_IDLE_SILENCE_TIMEOUT_MS,
        minimum: 0,
        tags: ["experimental"],
        experiment: {
            mode: "auto"
        },
        markdownDescription: ( localize(
            15509,
            "Number of milliseconds the run in terminal tool will wait for new output from a synchronous command before moving it to a background terminal and returning what was collected so far. The process is not killed — the tool returns the terminal ID so the model can poll, send input, or kill it. Set to {0} to disable.",
            "`0`"
        ))
    },
    [TerminalChatAgentToolsSettingId.DetachBackgroundProcesses]: {
        included: false,
        restricted: true,
        type: "boolean",
        default: false,
        tags: ["experimental"],
        markdownDescription: ( localize(
            15510,
            "Whether to detach persistent terminal processes so they survive when VS Code exits. When enabled, commands started with `mode: \"async\"` (legacy: `isBackground: true`) are wrapped with `nohup` (POSIX) or `Start-Process` (Windows) so the process continues running after the terminal is disposed."
        ))
    },
    [TerminalChatAgentToolsSettingId.BackgroundNotifications]: {
        restricted: true,
        type: "boolean",
        default: true,
        tags: ["experimental"],
        deprecated: true,
        markdownDeprecationMessage: ( localize(
            15511,
            "This setting is deprecated. Terminal completion and input-needed notifications are now always enabled."
        )),
        markdownDescription: ( localize(
            15512,
            "This setting is deprecated and no longer has any effect. Terminal completion and input-needed notifications are now always enabled for any command that continues running after the tool returns."
        ))
    },
    [TerminalChatAgentToolsSettingId.OutputDeltas]: {
        restricted: true,
        type: "boolean",
        default: false,
        tags: ["experimental"],
        experiment: {
            mode: "auto"
        },
        markdownDescription: ( localize(
            15513,
            "When enabled, repeated get terminal output tool calls return only output added since the previous poll for the same terminal execution, or a short unchanged-output message when there is no new output."
        ))
    }
};
for (const id of [
    TerminalChatAgentToolsSettingId.DeprecatedAutoApprove1,
    TerminalChatAgentToolsSettingId.DeprecatedAutoApprove2,
    TerminalChatAgentToolsSettingId.DeprecatedAutoApprove3,
    TerminalChatAgentToolsSettingId.DeprecatedAutoApprove4,
    TerminalChatAgentToolsSettingId.DeprecatedAutoApproveCompatible
]) {
    terminalChatAgentToolsConfiguration[id] = {
        deprecated: true,
        markdownDeprecationMessage: ( localize(
            15514,
            "Use {0} instead",
            `\`#${TerminalChatAgentToolsSettingId.AutoApprove}#\``
        ))
    };
}
terminalChatAgentToolsConfiguration[TerminalChatAgentToolsSettingId.DeprecatedAgentSandboxLinuxFileSystem] = {
    type: "object",
    deprecated: true,
    markdownDeprecationMessage: ( localize(
        15515,
        "Use {0} instead",
        `\`#${TerminalChatAgentToolsSettingId.AgentSandboxLinuxFileSystem}#\``
    ))
};
terminalChatAgentToolsConfiguration[TerminalChatAgentToolsSettingId.DeprecatedAgentSandboxMacFileSystem] = {
    type: "object",
    deprecated: true,
    markdownDeprecationMessage: ( localize(
        15516,
        "Use {0} instead",
        `\`#${TerminalChatAgentToolsSettingId.AgentSandboxMacFileSystem}#\``
    ))
};
terminalChatAgentToolsConfiguration[AgentSandboxSettingId.DeprecatedAgentSandboxEnabled] = {
    type: "boolean",
    deprecated: true,
    included: false,
    markdownDeprecationMessage: ( localize(
        15517,
        "Use {0} instead",
        `\`#${AgentSandboxSettingId.AgentSandboxEnabled}#\``
    ))
};

export { DEFAULT_IDLE_SILENCE_TIMEOUT_MS, TerminalChatAgentToolsSettingId, terminalChatAgentToolsConfiguration };
