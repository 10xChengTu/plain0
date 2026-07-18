import { Event } from "../../../../base/common/event.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { CDPRequest, CDPResponse, CDPEvent } from "../../../../platform/browserView/common/cdp/types.js";
import { ITunnelProxyInfo } from "../../../../platform/tunnel/common/tunnelProxy.js";
import { PreferredGroup } from "../../../services/editor/common/editorService.js";
import { BrowserEditorInput } from "./browserEditorInput.js";
import { IBrowserViewContextualFilter, IBrowserViewFilterContext, IBrowserViewOpenHandler, IBrowserEditorViewState } from "./browserView.js";
export declare const IBrowserViewWorkbenchService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IBrowserViewWorkbenchService>;
/**
* Workbench-level service for browser views that provides model-based access to browser views.
* This service manages browser view models that proxy to the main process browser view service.
*/
export interface IBrowserViewWorkbenchService {
    readonly _serviceBrand: undefined;
    /** Returns true if the remote proxy is enabled; i.e. we are in a remote workspace and the setting is enabled. */
    willUseRemoteProxy(): boolean;
    /**
    * Set the tunnel-proxy credentials resolved by the window's local node
    * extension host (which hosts the HTTPS tunnel proxy), or `undefined` to
    * clear them. Folded into the window configuration sent to the main
    * process so this window's remote browser views (re)apply the proxy.
    */
    setRemoteProxyInfo(info: ITunnelProxyInfo | undefined): void;
    /**
    * Fires when the set of known browser views changes, or a model is created for an existing input.
    */
    readonly onDidChangeBrowserViews: Event<void>;
    /**
    * Whether sharing browser pages with the agent is currently available
    * (chat enabled, agent mode enabled, browser tools setting enabled, etc.).
    */
    readonly isSharingAvailable: boolean;
    /**
    * Fires when {@link isSharingAvailable} changes.
    */
    readonly onDidChangeSharingAvailable: Event<boolean>;
    /**
    * Get all known browser views.
    */
    getKnownBrowserViews(): Map<string, BrowserEditorInput>;
    /**
    * Register a contextual filter that restricts which browser views are
    * returned by {@link getContextualBrowserViews}. A view is part of the
    * contextual set only when every registered filter includes it.
    */
    registerContextualFilter(filter: IBrowserViewContextualFilter): IDisposable;
    /**
    * Get the browser views that pass all registered contextual filters. When
    * no filters are registered this is equivalent to {@link getKnownBrowserViews}.
    *
    * @param context The filter context to use (or inferred if not provided)
    */
    getContextualBrowserViews(context?: IBrowserViewFilterContext): Map<string, BrowserEditorInput>;
    /**
    * Resolve the preferred editor group for opening an integrated browser
    * editor. Honors the `workbench.browser.newTabPlacement` setting, routing new
    * tabs into a dedicated (locked) side group or auxiliary window when
    * configured. When the workbench forces editors into a modal part
    * (`workbench.editor.useModal: 'all'`, the default in the Agents window),
    * browser opens that target the active group (or leave it unspecified) are
    * redirected to the main editor area so the browser docks instead of opening
    * as a modal overlay. Explicit placements (side group, auxiliary window, a
    * specific group) are left untouched.
    */
    getPreferredGroup(preferredGroup?: PreferredGroup): Promise<PreferredGroup | undefined>;
    /**
    * Register a handler that decides whether an editor should be opened for a
    * newly created browser view. The editor is opened only when every
    * registered handler allows it.
    */
    registerOpenHandler(handler: IBrowserViewOpenHandler): IDisposable;
    /**
    * Get an existing browser view for the given ID, or create a new one if it doesn't exist.
    * The underlying browser view is not created until the editor is opened or the model is resolved.
    */
    getOrCreateLazy(id: string, initialState?: IBrowserEditorViewState): BrowserEditorInput;
    /**
    * Clear all storage data for the global browser session
    */
    clearGlobalStorage(): Promise<void>;
    /**
    * Clear all storage data for the current workspace browser session
    */
    clearWorkspaceStorage(): Promise<void>;
}
export declare const IBrowserViewCDPService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IBrowserViewCDPService>;
/**
* Workbench-level service for managing CDP (Chrome DevTools Protocol) sessions
* against browser views. Handles group lifecycle and window ID resolution.
*/
export interface IBrowserViewCDPService {
    readonly _serviceBrand: undefined;
    /**
    * Create a new CDP group for a browser view.
    * The window ID is resolved from the editor group containing the browser.
    * @param browserId The browser view identifier.
    * @returns The ID of the newly created group.
    */
    createSessionGroup(browserId: string): Promise<string>;
    /** Destroy a CDP group. */
    destroySessionGroup(groupId: string): Promise<void>;
    /** Send a CDP message to a group. */
    sendCDPMessage(groupId: string, message: CDPRequest): Promise<void>;
    /** Fires when a CDP message is received. */
    onCDPMessage(groupId: string): Event<CDPResponse | CDPEvent>;
    /** Fires when a CDP group is destroyed. */
    onDidDestroy(groupId: string): Event<void>;
}
