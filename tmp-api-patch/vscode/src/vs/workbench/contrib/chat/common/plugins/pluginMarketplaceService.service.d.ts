import { CancellationToken } from "../../../../../base/common/cancellation.js";
import { Event } from "../../../../../base/common/event.js";
import { IObservable } from "../../../../../base/common/observable.js";
import { URI } from "../../../../../base/common/uri.js";
import { IMarketplaceReference } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/plugins/marketplaceReference";
import { IMarketplaceInstalledPlugin, IMarketplacePlugin } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/plugins/pluginMarketplaceService";
export declare const IPluginMarketplaceService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IPluginMarketplaceService>;
export interface IPluginMarketplaceService {
    readonly _serviceBrand: undefined;
    readonly onDidChangeMarketplaces: Event<void>;
    /** Installed marketplace plugins, backed by storage. */
    readonly installedPlugins: IObservable<readonly IMarketplaceInstalledPlugin[]>;
    /**
    * Observable that is `true` when at least one cloned marketplace
    * repository has upstream changes available. Checked periodically
    * (approximately once per day) when `extensions.autoUpdate` is enabled.
    */
    readonly hasUpdatesAvailable: IObservable<boolean>;
    /**
    * Observable snapshot of the last {@link fetchMarketplacePlugins} result.
    * Empty until the first fetch completes. Views should use this for
    * synchronous outdated-detection instead of calling fetchMarketplacePlugins.
    */
    readonly lastFetchedPlugins: IObservable<readonly IMarketplacePlugin[]>;
    /**
    * Set of recommended plugin keys (`"pluginName@marketplaceName"`) aggregated
    * from workspace-defined settings (e.g. `.claude/settings.json`). Providers
    * may be added over time; consumers should not assume a specific source.
    */
    readonly recommendedPlugins: IObservable<ReadonlySet<string>>;
    /** Resets {@link hasUpdatesAvailable} to `false`. */
    clearUpdatesAvailable(): void;
    fetchMarketplacePlugins(token: CancellationToken): Promise<IMarketplacePlugin[]>;
    getMarketplacePluginMetadata(pluginUri: URI): IMarketplacePlugin | undefined;
    addInstalledPlugin(pluginUri: URI, plugin: IMarketplacePlugin): void;
    removeInstalledPlugin(pluginUri: URI): void;
    /** Returns whether the given marketplace is trusted — either explicitly trusted by the user, or allowed by the enterprise allowlist when strict mode is active. */
    isMarketplaceTrusted(ref: IMarketplaceReference): boolean;
    /**
    * Returns whether the strict-marketplace enterprise policy
    * (`chat.plugins.strictMarketplaces`) is active — i.e. an allowlist is
    * configured. When active, blocked marketplaces cannot be trusted by the user.
    */
    isStrictMarketplacePolicyActive(): boolean;
    /** Records that the user trusts the given marketplace, persisted permanently. */
    trustMarketplace(ref: IMarketplaceReference): void;
    /**
    * Reads marketplace definition files from an already-cloned repository
    * directory and returns the declared plugins. Used by direct-install flows
    * that clone a repo first, then need to discover its plugins.
    */
    readPluginsFromDirectory(repoDir: URI, reference: IMarketplaceReference): Promise<IMarketplacePlugin[]>;
    /**
    * Reads a single-plugin manifest (e.g. `.claude-plugin/plugin.json`) at the
    * root of an already-cloned repository directory and returns a synthesised
    * {@link IMarketplacePlugin} describing the repository as a single plugin.
    * Used by direct-install flows when {@link readPluginsFromDirectory} finds
    * no marketplace index.
    *
    * Returns `undefined` when no recognised manifest is present at the repo
    * root.
    */
    readSinglePluginManifest(repoDir: URI, reference: IMarketplaceReference): Promise<IMarketplacePlugin | undefined>;
    /**
    * Returns whether the given directory is a standalone plugin — i.e. it
    * contains a single-plugin manifest (e.g. `.plugin/plugin.json`,
    * `.claude-plugin/plugin.json`, or `plugin.json`) at its root but is not a
    * marketplace. Used by direct-install flows to route a local folder to the
    * appropriate configuration.
    */
    isPluginDirectory(repoDir: URI): Promise<boolean>;
}
