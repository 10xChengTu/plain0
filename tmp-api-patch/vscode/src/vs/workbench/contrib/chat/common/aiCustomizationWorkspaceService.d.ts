import { URI } from "../../../../base/common/uri.js";
import { PromptsStorage } from "./promptSyntax/service/promptsService.js";
/**
 * Extended storage type for AI Customization that includes built-in prompts
 * shipped with the application, alongside the core `PromptsStorage` values.
 */
export type AICustomizationSource = "local" | "user" | "extension" | "plugin" | "builtin";
export declare namespace AICustomizationSources {
    const local: AICustomizationSource;
    const user: AICustomizationSource;
    const extension: AICustomizationSource;
    const plugin: AICustomizationSource;
    const builtin: AICustomizationSource;
    const all: AICustomizationSource[];
}
/**
 * Storage type discriminator for built-in customizations shipped with the application.
 */
export declare const BUILTIN_STORAGE: AICustomizationSource;
/**
 * Possible section IDs for the AI Customization Management Editor sidebar.
 */
export declare const AICustomizationManagementSection: {
    readonly Agents: "agents";
    readonly Skills: "skills";
    readonly Instructions: "instructions";
    readonly Prompts: "prompts";
    readonly Hooks: "hooks";
    readonly Automations: "automations";
    readonly McpServers: "mcpServers";
    readonly Plugins: "plugins";
    readonly Models: "models";
    readonly Tools: "tools";
};
export type AICustomizationManagementSection = typeof AICustomizationManagementSection[keyof typeof AICustomizationManagementSection];
/**
 * Per-type filter policy controlling which storage sources are visible
 * for a given customization type.
 */
export interface IStorageSourceFilter {
    /**
     * Which storage groups to display (e.g. workspace, user, extension, builtin).
     */
    readonly sources: readonly AICustomizationSource[];
}
/**
 * Controls which features are shown on the welcome page of the
 * AI Customization Management Editor.
 */
export interface IWelcomePageFeatures {
    /** Show the "Configure Your AI" getting-started banner. */
    readonly showGettingStartedBanner: boolean;
}
/**
 * Applies a source filter to an array of items that have uri and source.
 * Removes items whose source is not in the filter's source list.
 */
export declare function applySourceFilter<T extends {
    readonly uri: URI;
    readonly source: AICustomizationSource;
}>(items: readonly T[], filter: IStorageSourceFilter): readonly T[];
/**
 * Applies a storage filter to an array of items that have uri and storage.
 * Removes items whose storage is not in the filter's source list.
 */
export declare function applyStorageSourceFilter<T extends {
    readonly uri: URI;
    readonly storage: PromptsStorage;
}>(items: readonly T[], filter: IStorageSourceFilter): readonly T[];
