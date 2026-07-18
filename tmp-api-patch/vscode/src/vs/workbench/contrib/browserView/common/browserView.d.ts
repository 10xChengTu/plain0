import { Event } from "../../../../base/common/event.js";
import { Disposable, IDisposable } from "../../../../base/common/lifecycle.js";
import { VSBuffer } from "../../../../base/common/buffer.js";
import { IDialogService } from "../../../../platform/dialogs/common/dialogs.service.js";
import { IStorageService } from "../../../../platform/storage/common/storage.service.js";
import { IPlaywrightService } from "../../../../platform/browserView/common/playwrightService.service.js";
import { BrowserHistoryStore } from "../../../../platform/browserView/common/browserHistory.js";
import { BrowserPermissionStore, IPermissionCategoryState } from "../../../../platform/browserView/common/browserPermissions.js";
import type { BrowserEditorInput } from "./browserEditorInput.js";
import { IBrowserViewBounds, IBrowserViewNavigationEvent, IBrowserViewLoadingEvent, IBrowserViewLoadError, IBrowserViewFocusEvent, IBrowserViewKeyDownEvent, IBrowserViewTitleChangeEvent, IBrowserViewFaviconChangeEvent, IBrowserViewDevToolsStateEvent, IBrowserViewService, BrowserViewStorageScope, IBrowserViewCaptureScreenshotOptions, IBrowserViewFindInPageOptions, IBrowserViewFindInPageResult, IBrowserViewVisibilityEvent, IBrowserViewCertificateError, IElementData, IBrowserViewOwner, IBrowserViewOpenOptions, IBrowserViewRect, IBrowserViewState, IBrowserDeviceProfile, IBrowserViewPermissionRequestEvent } from "../../../../platform/browserView/common/browserView.js";
import { ITelemetryService } from "../../../../platform/telemetry/common/telemetry.service.js";
import { IAgentNetworkFilterService } from "../../../../platform/networkFilter/common/networkFilterService.service.js";
import { ILogService } from "../../../../platform/log/common/log.service.js";
import { IBrowserZoomService } from "./browserZoomService.service.js";
import { IBrowserViewWorkbenchService } from "./browserView.service.js";
export declare enum BrowserViewSharingState {
    /** Tools are available and the page is shared with the agent. */
    Shared = "shared",
    /** Tools are available but the page is not shared. */
    NotShared = "notShared",
    /** Browser tools are disabled — sharing is not possible. */
    Unavailable = "unavailable"
}
/**
 * To be used in telemetry. This is the  source for an address-bar-initiated navigation:
 * whether the user typed a URL or ran a web search. Defaults to `'urlInput'` when omitted.
 */
export type BrowserNavigationSource = "urlInput" | "searchInput";
/**
 * Options for a navigation initiated via {@link IBrowserViewModel.loadURL}
 * (and {@link BrowserEditorInput.navigate}).
 */
export interface INavigateOptions {
    /**
     * Source of the navigation, for telemetry purposes. Defaults to `'urlInput'` when omitted.
     */
    readonly source?: BrowserNavigationSource;
}
/**
 * View state stored in editor options when opening a browser view.
 */
export interface IBrowserEditorViewState {
    readonly url?: string;
    readonly title?: string;
    readonly favicon?: string;
    /**
     * When true, indicates that this browser tab was opened via the localhost
     * link opener while the user has not explicitly configured the setting
     * (i.e. the default value was used). This is a transient flag and is not
     * serialized.
     */
    readonly isDefaultLinkOpen?: boolean;
}
/**
 * A filter that contextually restricts the browser views returned by
 * {@link IBrowserViewWorkbenchService.getContextualBrowserViews}.
 */
export interface IBrowserViewContextualFilter {
    /**
     * Returns `true` if the given browser view should be part of the
     * contextual set.
     */
    include(input: BrowserEditorInput, context: IBrowserViewFilterContext): boolean;
    /**
     * Optional event that fires when the result of {@link include} may have
     * changed for one or more views (e.g. the active session changed).
     */
    readonly onDidChange?: Event<void>;
}
export interface IBrowserViewFilterContext {
    /**
     * The session *resource* URI string (`session.resource.toString()`) of the
     * relevant session, if any. This is the same value stored in
     * {@link IBrowserViewOwner.sessionId} — not the composite
     * `ISession.sessionId` (`providerId:resource`).
     */
    activeSessionId?: string;
}
/**
 * A handler that decides whether an editor should be opened for a newly
 * created browser view. Registered via
 * {@link IBrowserViewWorkbenchService.registerOpenHandler}.
 */
export interface IBrowserViewOpenHandler {
    /**
     * Called before an editor is opened for a newly created browser view.
     * Return `false` to prevent the editor from being opened. A view is opened
     * only when every registered handler allows it.
     */
    shouldOpenEditor(input: BrowserEditorInput, owner: IBrowserViewOwner, openOptions: IBrowserViewOpenOptions): boolean;
}
/**
 * A browser view model that represents a single browser view instance in the workbench.
 * This model proxies calls to the main process browser view service using its unique ID.
 */
export interface IBrowserViewModel extends IDisposable {
    readonly id: string;
    readonly owner: IBrowserViewOwner;
    readonly url: string;
    readonly title: string;
    readonly favicon: string | undefined;
    readonly screenshot: VSBuffer | undefined;
    readonly loading: boolean;
    readonly focused: boolean;
    readonly visible: boolean;
    readonly canGoBack: boolean;
    readonly isDevToolsOpen: boolean;
    readonly canGoForward: boolean;
    readonly error: IBrowserViewLoadError | undefined;
    readonly certificateError: IBrowserViewCertificateError | undefined;
    readonly storageScope: BrowserViewStorageScope;
    readonly history: BrowserHistoryStore;
    readonly permissions: BrowserPermissionStore;
    readonly sharingState: BrowserViewSharingState;
    readonly isRemoteSession: boolean;
    readonly zoomFactor: number;
    readonly canZoomIn: boolean;
    readonly canZoomOut: boolean;
    readonly isElementSelectionActive: boolean;
    readonly isAreaSelectionActive: boolean;
    readonly device: IBrowserDeviceProfile | undefined;
    readonly onDidChangeSharingState: Event<BrowserViewSharingState>;
    readonly onDidChangeZoom: Event<void>;
    readonly onWillNavigate: Event<string>;
    readonly onDidNavigate: Event<IBrowserViewNavigationEvent>;
    readonly onDidChangeLoadingState: Event<IBrowserViewLoadingEvent>;
    readonly onDidChangeFocus: Event<IBrowserViewFocusEvent>;
    readonly onDidChangeDevToolsState: Event<IBrowserViewDevToolsStateEvent>;
    readonly onDidKeyCommand: Event<IBrowserViewKeyDownEvent>;
    readonly onDidChangeTitle: Event<IBrowserViewTitleChangeEvent>;
    readonly onDidChangeFavicon: Event<IBrowserViewFaviconChangeEvent>;
    readonly onDidFindInPage: Event<IBrowserViewFindInPageResult>;
    readonly onDidChangeVisibility: Event<IBrowserViewVisibilityEvent>;
    readonly onDidClose: Event<void>;
    readonly onWillDispose: Event<void>;
    readonly onDidSelectElement: Event<IElementData>;
    readonly onDidChangeElementSelectionActive: Event<boolean>;
    readonly onDidPickArea: Event<IBrowserViewRect | undefined>;
    readonly onDidChangeAreaSelectionActive: Event<boolean>;
    readonly onDidChangeDevice: Event<IBrowserDeviceProfile | undefined>;
    readonly onDidChangeRemoteStatus: Event<boolean>;
    readonly onDidRequestPermission: Event<IBrowserViewPermissionRequestEvent>;
    layout(bounds: IBrowserViewBounds): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
    loadURL(url: string, options?: INavigateOptions): Promise<void>;
    goBack(): Promise<void>;
    goForward(): Promise<void>;
    reload(hard?: boolean): Promise<void>;
    toggleDevTools(): Promise<void>;
    captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer>;
    focus(force?: boolean): Promise<void>;
    findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void>;
    stopFindInPage(keepSelection?: boolean): Promise<void>;
    getSelectedText(): Promise<string>;
    clearStorage(): Promise<void>;
    setSharedWithAgent(shared: boolean): Promise<boolean>;
    trustCertificate(host: string, fingerprint: string): Promise<void>;
    untrustCertificate(host: string, fingerprint: string): Promise<void>;
    deleteHistory(entryIds?: readonly number[]): Promise<void>;
    setPermissions(origin: string, grants: readonly IPermissionCategoryState[]): Promise<void>;
    selectDevice(requestId: string, deviceId: string | null): Promise<void>;
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    resetZoom(): Promise<void>;
    getConsoleLogs(): Promise<string>;
    toggleElementSelection(enabled?: boolean): Promise<void>;
    toggleAreaSelection(enabled?: boolean): Promise<void>;
    setDevice(device: IBrowserDeviceProfile | undefined): Promise<void>;
}
export declare class BrowserViewModel extends Disposable implements IBrowserViewModel {
    readonly id: string;
    readonly owner: IBrowserViewOwner;
    private readonly browserViewService;
    private readonly browserViewWorkbenchService;
    private readonly telemetryService;
    private readonly playwrightService;
    private readonly dialogService;
    private readonly storageService;
    private readonly zoomService;
    private readonly agentNetworkFilterService;
    private readonly logService;
    private _url;
    private _title;
    private _favicon;
    private _screenshot;
    private _loading;
    private _focused;
    private _visible;
    private _isDevToolsOpen;
    private _canGoBack;
    private _canGoForward;
    private _error;
    private _certificateError;
    private _storageScope;
    private _isRemoteSession;
    private _isEphemeral;
    private _zoomHost;
    private _sharedWithAgent;
    private _browserZoomIndex;
    private _isElementSelectionActive;
    private _isAreaSelectionActive;
    private _device;
    readonly history: BrowserHistoryStore;
    readonly permissions: BrowserPermissionStore;
    private readonly _onDidChangeDevice;
    readonly onDidChangeDevice: Event<IBrowserDeviceProfile | undefined>;
    private readonly _onDidChangeSharingState;
    readonly onDidChangeSharingState: Event<BrowserViewSharingState>;
    private readonly _onDidChangeZoom;
    readonly onDidChangeZoom: Event<void>;
    private readonly _onWillDispose;
    readonly onWillDispose: Event<void>;
    private readonly _onWillNavigate;
    readonly onWillNavigate: Event<string>;
    constructor(id: string, owner: IBrowserViewOwner, initialState: IBrowserViewState, browserViewService: IBrowserViewService, browserViewWorkbenchService: IBrowserViewWorkbenchService, telemetryService: ITelemetryService, playwrightService: IPlaywrightService, dialogService: IDialogService, storageService: IStorageService, zoomService: IBrowserZoomService, agentNetworkFilterService: IAgentNetworkFilterService, logService: ILogService);
    get url(): string;
    get title(): string;
    get favicon(): string | undefined;
    get loading(): boolean;
    get focused(): boolean;
    get visible(): boolean;
    get isDevToolsOpen(): boolean;
    get canGoBack(): boolean;
    get canGoForward(): boolean;
    get screenshot(): VSBuffer | undefined;
    get error(): IBrowserViewLoadError | undefined;
    get certificateError(): IBrowserViewCertificateError | undefined;
    get storageScope(): BrowserViewStorageScope;
    get isRemoteSession(): boolean;
    get sharingState(): BrowserViewSharingState;
    get zoomFactor(): number;
    get canZoomIn(): boolean;
    get canZoomOut(): boolean;
    get isElementSelectionActive(): boolean;
    get isAreaSelectionActive(): boolean;
    get device(): IBrowserDeviceProfile | undefined;
    get onDidNavigate(): Event<IBrowserViewNavigationEvent>;
    get onDidChangeLoadingState(): Event<IBrowserViewLoadingEvent>;
    get onDidChangeFocus(): Event<IBrowserViewFocusEvent>;
    get onDidChangeDevToolsState(): Event<IBrowserViewDevToolsStateEvent>;
    get onDidKeyCommand(): Event<IBrowserViewKeyDownEvent>;
    get onDidChangeTitle(): Event<IBrowserViewTitleChangeEvent>;
    get onDidChangeFavicon(): Event<IBrowserViewFaviconChangeEvent>;
    get onDidFindInPage(): Event<IBrowserViewFindInPageResult>;
    get onDidChangeVisibility(): Event<IBrowserViewVisibilityEvent>;
    get onDidClose(): Event<void>;
    get onDidChangeRemoteStatus(): Event<boolean>;
    get onDidRequestPermission(): Event<IBrowserViewPermissionRequestEvent>;
    layout(bounds: IBrowserViewBounds): Promise<void>;
    setVisible(visible: boolean): Promise<void>;
    loadURL(url: string, options?: INavigateOptions): Promise<void>;
    goBack(): Promise<void>;
    goForward(): Promise<void>;
    reload(hard?: boolean): Promise<void>;
    toggleDevTools(): Promise<void>;
    captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer>;
    focus(force?: boolean): Promise<void>;
    findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void>;
    stopFindInPage(keepSelection?: boolean): Promise<void>;
    getSelectedText(): Promise<string>;
    clearStorage(): Promise<void>;
    trustCertificate(host: string, fingerprint: string): Promise<void>;
    untrustCertificate(host: string, fingerprint: string): Promise<void>;
    deleteHistory(entryIds?: readonly number[]): Promise<void>;
    setPermissions(origin: string, grants: readonly IPermissionCategoryState[]): Promise<void>;
    selectDevice(requestId: string, deviceId: string | null): Promise<void>;
    /**
     * @param forceApply When true, the IPC call is made even if the local cached zoom index
     * already matches the requested value. Pass true after cross-document navigation because
     * Chromium resets the zoom to its per-origin default, making the cache stale.
     */
    private setBrowserZoomIndex;
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    resetZoom(): Promise<void>;
    getConsoleLogs(): Promise<string>;
    toggleElementSelection(enabled?: boolean): Promise<void>;
    toggleAreaSelection(enabled?: boolean): Promise<void>;
    get onDidSelectElement(): Event<IElementData>;
    get onDidChangeElementSelectionActive(): Event<boolean>;
    get onDidPickArea(): Event<IBrowserViewRect | undefined>;
    get onDidChangeAreaSelectionActive(): Event<boolean>;
    setDevice(device: IBrowserDeviceProfile | undefined): Promise<void>;
    private static readonly SHARE_DONT_ASK_KEY;
    setSharedWithAgent(shared: boolean): Promise<boolean>;
    private _setSharedWithAgent;
    private _reloadHistoryEntries;
    private _reloadHistoryFavicons;
    /**
     * Log navigation telemetry event
     */
    private logNavigationTelemetry;
    dispose(): void;
}
