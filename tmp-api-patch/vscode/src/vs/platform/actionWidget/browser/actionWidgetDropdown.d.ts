import { BaseDropdown, IActionProvider, IBaseDropdownOptions } from "../../../base/browser/ui/dropdown/dropdown.js";
import { IAction } from "../../../base/common/actions.js";
import { IMarkdownString } from "../../../base/common/htmlContent.js";
import { ResolvedKeybinding } from "../../../base/common/keybindings.js";
import { ThemeIcon } from "../../../base/common/themables.js";
import { IKeybindingService } from "../../keybinding/common/keybinding.service.js";
import { ITelemetryService } from "../../telemetry/common/telemetry.service.js";
import { IActionListItemHover, IActionListItemInlineToggle, IActionListOptions } from "./actionList.js";
import { IActionWidgetService } from "./actionWidget.service.js";
export interface IActionWidgetDropdownAction extends IAction {
    category?: {
        label: string;
        order: number;
        showHeader?: boolean;
    };
    icon?: ThemeIcon;
    description?: string | IMarkdownString;
    /**
     * Optional detail text displayed as a second line below the label.
     */
    detail?: string;
    /**
     * Optional flyout hover configuration shown when focusing/hovering over the action.
     */
    hover?: IActionListItemHover;
    /**
     * Optional toolbar actions shown when the item is focused or hovered.
     */
    toolbarActions?: IAction[];
    /**
     * Optional CSS class name applied to the action list row container.
     */
    className?: string;
    /**
     * Optional inline toggle switch rendered on its own row inside the item.
     */
    inlineToggle?: IActionListItemInlineToggle;
    /**
     * Optional keybinding to display next to the action. When provided, this overrides the
     * keybinding that would otherwise be looked up via {@link IKeybindingService.lookupKeybinding}.
     * Useful when the active keybinding depends on a scoped context (e.g. focus state) that the
     * dropdown cannot evaluate at display time.
     */
    keybinding?: ResolvedKeybinding;
}
export interface IActionWidgetDropdownActionProvider {
    getActions(): IActionWidgetDropdownAction[];
}
export interface IActionWidgetDropdownOptions extends IBaseDropdownOptions {
    readonly actions?: IActionWidgetDropdownAction[];
    readonly actionProvider?: IActionWidgetDropdownActionProvider;
    readonly actionBarActions?: IAction[];
    readonly actionBarActionProvider?: IActionProvider;
    readonly showItemKeybindings?: boolean;
    getAnchor?: () => HTMLElement;
    /**
     * Telemetry reporter configuration used when the dropdown closes. The `id` field is required
     * and is used as the telemetry identifier; `name` is optional additional context. If not
     * provided, no telemetry will be sent.
     */
    readonly reporter?: {
        id: string;
        name?: string;
        includeOptions?: boolean;
    };
    /**
     * Options for the underlying ActionList (filter, collapsible sections).
     */
    readonly listOptions?: IActionListOptions;
}
/**
 * Action widget dropdown is a dropdown that uses the action widget under the hood to simulate a native dropdown menu
 * The benefits of this include non native features such as headers, descriptions, icons, and button bar
 */
export declare class ActionWidgetDropdown extends BaseDropdown {
    private readonly _options;
    private readonly actionWidgetService;
    private readonly keybindingService;
    private readonly telemetryService;
    private _enabled;
    constructor(container: HTMLElement, _options: IActionWidgetDropdownOptions, actionWidgetService: IActionWidgetService, keybindingService: IKeybindingService, telemetryService: ITelemetryService);
    show(): void;
    setEnabled(enabled: boolean): void;
    private _emitCloseEvent;
}
