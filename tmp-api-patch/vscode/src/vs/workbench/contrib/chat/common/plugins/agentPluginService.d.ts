import { IDisposable } from "../../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../../base/common/observable.js";
import { URI } from "../../../../../base/common/uri.js";
import { SyncDescriptor0 } from "../../../../../platform/instantiation/common/descriptors.js";
import { type INamedPluginResource, type IMcpServerDefinition, type IParsedHookCommand } from "../../../../../platform/agentPlugins/common/pluginParsers.js";
import { ContributionEnablementState, IEnablementModel } from "../enablement.js";
import { HookType } from "../promptSyntax/hookTypes.js";
import { IMarketplacePlugin } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/plugins/pluginMarketplaceService";
export interface IAgentPluginHook {
    readonly type: HookType;
    readonly hooks: readonly IParsedHookCommand[];
    /** URI where this hook is defined -- not unique, multiple hooks may be in a manifest */
    readonly uri: URI;
    readonly originalId: string;
}
export type IAgentPluginCommand = INamedPluginResource;
export type IAgentPluginSkill = INamedPluginResource;
export type IAgentPluginAgent = INamedPluginResource;
export type IAgentPluginInstruction = INamedPluginResource;
export type IAgentPluginMcpServerDefinition = IMcpServerDefinition;
export interface IAgentPlugin {
    readonly uri: URI;
    /** Human-readable display name for the plugin. */
    readonly label: string;
    readonly enablement: IObservable<ContributionEnablementState>;
    /**
     * When `true`, the plugin is blocked by enterprise policy. It remains
     * visible (shown as disabled) but its contributions are inactive and the
     * user cannot re-enable it. Folded into {@link enablement} so all gating
     * consumers honor it automatically.
     */
    readonly policyBlocked?: IObservable<boolean>;
    /** Removes this plugin from its discovery source (config or installed storage). Undefined for policy-managed plugins that cannot be removed by the user. */
    remove?(): void;
    readonly hooks: IObservable<readonly IAgentPluginHook[]>;
    readonly commands: IObservable<readonly IAgentPluginCommand[]>;
    readonly skills: IObservable<readonly IAgentPluginSkill[]>;
    readonly agents: IObservable<readonly IAgentPluginAgent[]>;
    readonly instructions: IObservable<readonly IAgentPluginInstruction[]>;
    readonly mcpServerDefinitions: IObservable<readonly IAgentPluginMcpServerDefinition[]>;
    /** Set when the plugin was installed from a marketplace repository. */
    readonly fromMarketplace?: IMarketplacePlugin;
}
export interface IAgentPluginDiscovery extends IDisposable {
    readonly plugins: IObservable<readonly IAgentPlugin[] | undefined>;
    start(enablementModel: IEnablementModel): void;
}
export declare enum AgentPluginDiscoveryPriority {
    Configured = 10,
    Marketplace = 20,
    Extension = 30,
    CopilotCli = 40
}
export declare function getCanonicalPluginCommandId(plugin: {
    readonly uri: URI;
    readonly label?: string;
}, commandName: string): string;
declare class AgentPluginDiscoveryRegistry {
    private readonly _discovery;
    private _order;
    register(descriptor: SyncDescriptor0<IAgentPluginDiscovery>, priority: AgentPluginDiscoveryPriority): IDisposable;
    getAll(): readonly {
        readonly descriptor: SyncDescriptor0<IAgentPluginDiscovery>;
        readonly priority: AgentPluginDiscoveryPriority;
        readonly order: number;
    }[];
}
export declare const agentPluginDiscoveryRegistry: AgentPluginDiscoveryRegistry;
export {};
