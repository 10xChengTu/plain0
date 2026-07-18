import { IObservable } from "../../../../../base/common/observable.js";
import { ItemsModelSection } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/aiCustomization/aiCustomizationItemsModel";
import { IAICustomizationListItem, IAICustomizationItemSource } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/aiCustomization/aiCustomizationItemSource";
export declare const IAICustomizationItemsModel: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAICustomizationItemsModel>;
/**
* Single source of truth for the items rendered by the AI Customizations
* editor and observed by sidebar surfaces (counts/badges).
*
* The model owns the per-active-harness item source
* cache and exposes the unfiltered, normalized list of items per section.
* Both the editor and any sidebar surface read from these observables so
* there is exactly one discovery path for customizations.
*/
export interface IAICustomizationItemsModel {
    readonly _serviceBrand: undefined;
    /**
    * Returns an observable of the unfiltered, normalized list items for the
    * given prompts-based section under the currently active harness.
    */
    getItems(section: ItemsModelSection): IObservable<readonly IAICustomizationListItem[]>;
    /**
    * Returns the live item source for the active harness.
    * Editor consumers may need this to access provider-level affordances
    * (e.g. debug reporting). The returned source is reused across the
    * lifetime of the active descriptor.
    */
    getActiveItemSource(): IAICustomizationItemSource;
    /**
    * Convenience: an observable of the count for the given section.
    */
    getCount(section: ItemsModelSection): IObservable<number>;
    /**
    * Returns an observable of the Plugins section count. This combines
    * locally installed plugins with plugin rows supplied by the active
    * customization harness provider.
    */
    getPluginCount(): IObservable<number>;
    /**
    * Resolves once the most recent fetch for `section` has settled. Useful for
    * tests / fixtures that need rendered output to reflect at least one fetch.
    * Calling this also marks the section as observed (i.e. starts a fetch if
    * none has been kicked off yet).
    */
    whenSectionLoaded(section: ItemsModelSection): Promise<void>;
}
