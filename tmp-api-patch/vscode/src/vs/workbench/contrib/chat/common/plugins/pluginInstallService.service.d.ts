import { CancellationToken } from "../../../../../base/common/cancellation.js";
import { URI } from "../../../../../base/common/uri.js";
import { IInstallPluginFromSourceOptions, IInstallPluginFromSourceResult, IUpdateAllPluginsOptions, IUpdateAllPluginsResult } from "./pluginInstallService.js";
import { IMarketplacePlugin } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/plugins/pluginMarketplaceService";
export declare const IPluginInstallService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IPluginInstallService>;
export interface IPluginInstallService {
    readonly _serviceBrand: undefined;
    /**
    * Clones the marketplace repository (if not already cached) and registers
    * the plugin in the marketplace service's installed plugins storage.
    */
    installPlugin(plugin: IMarketplacePlugin): Promise<void>;
    /**
    * Installs a plugin directly from a source location string. Accepts
    * GitHub shorthand (`owner/repo`), a full git clone URL, or a local
    * folder path (`file://` URI, absolute path, or `~`-prefixed path).
    * For git sources, clones the repository, reads marketplace metadata to
    * discover plugins, and registers the selected plugin. For local folders,
    * detects whether the folder is a marketplace or a standalone plugin and
    * registers it under the appropriate configuration.
    *
    * Returns a result with an optional error message (e.g. invalid source or
    * no plugins found); callers are responsible for surfacing it. When
    * {@link IInstallPluginFromSourceOptions.plugin} is set, targets a specific
    * plugin, installs it, and returns it in
    * {@link IInstallPluginFromSourceResult.matchedPlugin}.
    */
    installPluginFromSource(source: string, options?: IInstallPluginFromSourceOptions): Promise<IInstallPluginFromSourceResult>;
    /**
    * Synchronously validates the format of a plugin source string.
    * Returns an error message if the format is invalid, or undefined if valid.
    */
    validatePluginSource(source: string): string | undefined;
    /**
    * Pulls the latest changes for an already-cloned marketplace repository.
    */
    updatePlugin(plugin: IMarketplacePlugin): Promise<boolean>;
    /**
    * Updates all installed plugins. First pulls each unique marketplace
    * repository, then updates non-relative-path plugins individually
    * (git pull, npm install, pip install, etc.).
    */
    updateAllPlugins(options: IUpdateAllPluginsOptions, token: CancellationToken): Promise<IUpdateAllPluginsResult>;
    /**
    * Returns the URI where a marketplace plugin would be installed on disk.
    * Used to determine whether a marketplace plugin is already installed.
    */
    getPluginInstallUri(plugin: IMarketplacePlugin): URI;
}
