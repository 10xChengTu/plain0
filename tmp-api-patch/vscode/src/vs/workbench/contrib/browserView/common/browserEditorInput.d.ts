import { ThemeIcon } from "../../../../base/common/themables.js";
import { URI } from "../../../../base/common/uri.js";
import { INavigateOptions, IBrowserEditorViewState, IBrowserViewModel } from "./browserView.js";
import { IBrowserViewWorkbenchService } from "./browserView.service.js";
import { EditorInputCapabilities, IEditorSerializer, IUntypedEditorInput, Verbosity } from "../../../common/editor.js";
import { EditorInput } from "../../../common/editor/editorInput.js";
import { IThemeService } from "../../../../platform/theme/common/themeService.service.js";
import { IInstantiationService } from "../../../../platform/instantiation/common/instantiation.js";
import { ITelemetryService } from "../../../../platform/telemetry/common/telemetry.service.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { Event } from "../../../../base/common/event.js";
/**
 * JSON-serializable type used during browser state serialization/deserialization
 */
export interface IBrowserEditorInputData extends IBrowserEditorViewState {
    readonly id: string;
}
/**
 * Fired before a {@link BrowserEditorInput} is disposed. Listeners may call
 * {@link veto} to prevent disposal and keep the input and its model alive.
 */
export interface IBeforeDisposeBrowserEditorEvent {
    veto(): void;
}
export declare class BrowserEditorInput extends EditorInput {
    private _resolveModel;
    private readonly themeService;
    private readonly instantiationService;
    private readonly telemetryService;
    private readonly browserViewWorkbenchService;
    static readonly ID = "workbench.editorinputs.browser";
    static readonly EDITOR_ID = "workbench.editor.browser";
    static readonly DEFAULT_LABEL: string;
    private readonly _id;
    private _initialData;
    private _model;
    private _modelPromise;
    private _modelStore;
    private readonly _onBeforeDispose;
    readonly onBeforeDispose: Event<IBeforeDisposeBrowserEditorEvent>;
    private readonly _onDidResolveModel;
    readonly onDidResolveModel: Event<IBrowserViewModel>;
    constructor(options: IBrowserEditorInputData, _resolveModel: () => Promise<IBrowserViewModel>, themeService: IThemeService, instantiationService: IInstantiationService, telemetryService: ITelemetryService, browserViewWorkbenchService: IBrowserViewWorkbenchService);
    get model(): IBrowserViewModel | undefined;
    set model(model: IBrowserViewModel);
    onceModelResolves(cb: (model: IBrowserViewModel) => void): IDisposable;
    get id(): string;
    get url(): string | undefined;
    get title(): string | undefined;
    get favicon(): string | undefined;
    /**
     * Whether this editor was opened via a default localhost link open (setting
     * not explicitly configured by the user). Transient — not serialized.
     */
    get isDefaultLinkOpen(): boolean;
    get isSharingAvailable(): boolean;
    navigate(url: string, options?: INavigateOptions): void;
    resolve(): Promise<IBrowserViewModel>;
    get typeId(): string;
    get editorId(): string;
    get capabilities(): EditorInputCapabilities;
    get resource(): URI;
    getIcon(): ThemeIcon | URI | undefined;
    getName(): string;
    getTitle(verbosity?: Verbosity): string;
    getDescription(verbosity?: Verbosity): string | undefined;
    private readonly getURLTitles;
    canReopen(): boolean;
    matches(otherInput: EditorInput | IUntypedEditorInput): boolean;
    /**
     * Creates a copy of this browser editor input with a new unique ID, creating an independent browser view with no linked state.
     * This is used during Copy into New Window.
     */
    copy(): EditorInput;
    toUntyped(): IUntypedEditorInput;
    dispose(force?: boolean): void;
    serialize(): IBrowserEditorInputData;
}
export declare class BrowserEditorSerializer implements IEditorSerializer {
    canSerialize(editorInput: EditorInput): editorInput is BrowserEditorInput;
    serialize(editorInput: EditorInput): string | undefined;
    deserialize(instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined;
}
