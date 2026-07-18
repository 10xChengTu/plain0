import { StandardMouseEvent } from "../../../base/browser/mouseEvent.js";
import { IAnchor } from "../../../base/browser/ui/contextview/contextview.js";
import { IListAccessibilityProvider } from "../../../base/browser/ui/list/listWidget.js";
import { IAction } from "../../../base/common/actions.js";
import { CancellationToken } from "../../../base/common/cancellation.js";
import { IMarkdownString } from "../../../base/common/htmlContent.js";
import { ResolvedKeybinding } from "../../../base/common/keybindings.js";
import { AnchorPosition } from "../../../base/common/layout.js";
import { Disposable, IDisposable } from "../../../base/common/lifecycle.js";
import { ThemeIcon } from "../../../base/common/themables.js";
import { URI } from "../../../base/common/uri.js";
import { IContextViewService } from "../../contextview/browser/contextView.service.js";
import { IKeybindingService } from "../../keybinding/common/keybinding.service.js";
import { IOpenerService } from "../../opener/common/opener.service.js";
import { ILayoutService } from "../../layout/browser/layoutService.service.js";
import { IInstantiationService } from "../../instantiation/common/instantiation.js";
export declare const acceptSelectedActionCommand = "acceptSelectedCodeAction";
export declare const previewSelectedActionCommand = "previewSelectedCodeAction";
export interface IActionListDelegate<T> {
    onHide(didCancel?: boolean): void;
    onSelect(action: T, preview?: boolean): void;
    onFilter?(filter: string, cancellationToken: CancellationToken): Promise<readonly IActionListItem<T>[]>;
    onHover?(action: T, cancellationToken: CancellationToken): Promise<{
        canPreview: boolean;
    } | void>;
    onFocus?(action: T | undefined): void;
}
/**
 * Optional hover configuration shown when focusing/hovering over an action list item.
 */
export interface IActionListItemHover {
    /**
     * Content to display in the hover. Can be a markdown string or an HTMLElement for full DOM control.
     */
    readonly content?: string | IMarkdownString | HTMLElement;
    /**
     * Optional disposable associated with the hover content (e.g. from rendered markdown).
     */
    readonly disposable?: IDisposable;
}
/**
 * Optional inline toggle switch rendered inside an action list item, shown on its
 * own row below the label/detail. Useful for an always-visible boolean sub-control
 * (e.g. a sandbox toggle) that is independent from selecting the item itself.
 */
export interface IActionListItemInlineToggle {
    /** Label shown to the left of the switch. */
    readonly label: string;
    /** Current checked state of the switch. */
    readonly checked: boolean;
    /** Invoked when the user flips the switch. */
    readonly onChange: (checked: boolean) => void;
    /** Optional accessible/hover title for the switch. Defaults to {@link label}. */
    readonly title?: string;
}
export interface IActionListItem<T> {
    readonly item?: T;
    readonly kind: ActionListItemKind;
    readonly group?: {
        kind?: unknown;
        icon?: ThemeIcon;
        title: string;
    };
    readonly disabled?: boolean;
    readonly label?: string;
    /**
     * Optional detail text displayed as a second line below the label.
     */
    readonly detail?: string;
    /**
     * Optional inline toggle switch rendered on its own row inside the item.
     */
    readonly inlineToggle?: IActionListItemInlineToggle;
    readonly description?: string | IMarkdownString;
    /**
     * Optional accessible description used in place of {@link description} for
     * screen reader labels. Useful when the visual description contains icons
     * or other non-textual content.
     */
    readonly ariaDescription?: string;
    /**
     * Optional hover configuration shown when focusing/hovering over the item.
     */
    readonly hover?: IActionListItemHover;
    /**
     * Optional actions shown in a nested submenu panel, triggered by a chevron
     * indicator on the right side of the item. When set, hovering or clicking
     * the chevron opens an inline submenu with these actions.
     */
    readonly submenuActions?: IAction[];
    readonly keybinding?: ResolvedKeybinding;
    canPreview?: boolean | undefined;
    readonly hideIcon?: boolean;
    readonly tooltip?: string;
    /**
     * Optional toolbar actions shown when the item is focused or hovered.
     */
    readonly toolbarActions?: IAction[];
    /**
     * Optional section identifier. Items with the same section belong to the same
     * collapsible group. Only meaningful when the ActionList is created with
     * collapsible sections.
     */
    readonly section?: string;
    /**
     * When true, clicking this item toggles the section's collapsed state
     * instead of selecting it.
     */
    readonly isSectionToggle?: boolean;
    /**
     * Optional CSS class name to add to the row container.
     */
    readonly className?: string;
    /**
     * Optional badge text to display after the label (e.g., "New").
     */
    readonly badge?: string;
    /**
     * When true, this item is always shown when filtering produces no other results.
     */
    readonly showAlways?: boolean;
    /**
     * Optional callback invoked when the item is removed via the built-in remove button.
     * When set, a close button is automatically added to the item toolbar.
     */
    readonly onRemove?: () => void | Promise<void>;
}
export declare enum ActionListItemKind {
    Action = "action",
    Header = "header",
    Separator = "separator"
}
/**
 * A "Learn more" style link rendered inline in the action list header banner.
 */
export interface IActionListHeaderLink {
    /** Visible link text (e.g. "Learn more"). Should be localized. */
    readonly label: string;
    /** Target opened via the opener service when the link is activated. */
    readonly uri: URI;
}
/**
 * Options for configuring the action list.
 */
export interface IActionListOptions {
    /**
     * When true, shows a filter input.
     */
    readonly showFilter?: boolean;
    /**
     * Placeholder text for the filter input.
     */
    readonly filterPlaceholder?: string;
    /**
     * Optional actions shown in the filter row, to the right of the input.
     */
    readonly filterActions?: readonly IAction[];
    /**
     * Section IDs that should be collapsed by default.
     */
    readonly collapsedByDefault?: ReadonlySet<string>;
    /**
     * Minimum width for the action list.
     */
    readonly minWidth?: number;
    /**
     * Maximum width for the action list. When set, items wider than this are
     * truncated rather than expanding the popup.
     */
    readonly maxWidth?: number;
    /**
     * Optional handler for markdown links activated in item descriptions or hovers.
     * When unset, links open via the opener service with command links allowed.
     */
    readonly linkHandler?: (uri: URI, item: IActionListItem<unknown>) => void;
    /**
     * Optional callback fired when a section's collapsed state changes.
     */
    readonly onDidToggleSection?: (section: string, collapsed: boolean) => void;
    /**
     * When true, descriptions are rendered inline right after the label
     * instead of aligned to the right.
     */
    readonly inlineDescription?: boolean;
    /**
     * Height (in px) used for action items that have a `detail` line.
     * Defaults to 48.
     */
    readonly detailItemHeight?: number;
    /**
     * Height (in px) used for action items that have an `inlineToggle`.
     * Defaults to 70.
     */
    readonly inlineToggleItemHeight?: number;
    /**
     * When true, the group title is shown on the first item of each group
     * in the description area (aligned to the right).
     */
    readonly showGroupTitleOnFirstItem?: boolean;
    /**
     * When true and filtering is enabled, focuses the filter input when the list opens.
     */
    readonly focusFilterOnOpen?: boolean;
    /**
     * When false, non-submenu items do not reserve space for the submenu chevron.
     * Defaults to true for alignment consistency.
     */
    readonly reserveSubmenuSpace?: boolean;
    /**
     * When true, items without an explicit `tooltip` or `hover` do not get a
     * default "{keybinding} to Apply" tooltip. Useful for non-code-action lists
     * where this hint is misleading.
     */
    readonly hideDefaultKeybindingTooltip?: boolean;
    /**
     * Optional label shown on the right side of the filter row.
     */
    readonly secondaryHeading?: string;
    /**
     * Optional text shown below the action list as a footer.
     */
    readonly footerText?: string;
    /**
     * Optional text shown above the action list as a header banner. When set, it is
     * rendered at the top of the widget, optionally prefixed by {@link headerIcon}.
     */
    readonly headerText?: string;
    /**
     * Optional icon shown to the left of {@link headerText} in the header banner.
     */
    readonly headerIcon?: ThemeIcon;
    /** Optional "Learn more" link rendered inline after {@link headerText}, opened via the opener service. */
    readonly headerLink?: IActionListHeaderLink;
    /** Optional dismiss ("x") button on the header banner; invoked on click, and the banner is removed. */
    readonly headerDismiss?: () => void;
    /**
     * Optional CSS class name added to the action list container, for scoped styling.
     */
    readonly className?: string;
}
/**
 * A standalone action list widget that handles core list rendering, filtering,
 * hover, submenu, and section management without depending on IContextViewService
 * or anchor-based positioning. Suitable for embedding directly in any container.
 */
export declare class ActionListWidget<T> extends Disposable {
    protected readonly _supportsPreview: boolean;
    protected readonly _delegate: IActionListDelegate<T>;
    protected readonly _options: IActionListOptions | undefined;
    private readonly _keybindingService;
    private readonly _openerService;
    private readonly _instantiationService;
    readonly domNode: HTMLElement;
    private readonly _list;
    protected readonly _actionLineHeight: number;
    protected readonly _headerLineHeight = 24;
    protected readonly _separatorLineHeight = 8;
    protected _allMenuItems: IActionListItem<T>[];
    private readonly cts;
    private readonly _submenuDisposables;
    private readonly _submenuContainer;
    private _submenuHideTimeout;
    private _submenuShowTimeout;
    private _currentSubmenuWidget;
    private _currentSubmenuElement;
    private readonly _collapsedSections;
    private _filterText;
    private _suppressHover;
    private _hasLaidOut;
    private readonly _filterInput;
    private readonly _filterContainer;
    private readonly _footerContainer;
    private _headerContainer;
    private readonly _filterCts;
    private readonly _groupTitleByIndex;
    private readonly _onDidRequestLayout;
    /**
     * Fired when the widget's visible item set changes and the parent should
     * re-layout (e.g. after filtering or collapsing a section).
     */
    readonly onDidRequestLayout: import("../../../base/common/event.js").Event<void>;
    constructor(user: string, _supportsPreview: boolean, items: readonly IActionListItem<T>[], _delegate: IActionListDelegate<T>, accessibilityProvider: Partial<IListAccessibilityProvider<IActionListItem<T>>> | undefined, _options: IActionListOptions | undefined, _keybindingService: IKeybindingService, _openerService: IOpenerService, _instantiationService: IInstantiationService);
    private _toggleSection;
    private _applyOrUpdateFilter;
    private _applyFilter;
    /**
     * Returns the filter container element, if filter is enabled.
     * The caller is responsible for appending it to the widget DOM.
     */
    get filterContainer(): HTMLElement | undefined;
    get footerContainer(): HTMLElement | undefined;
    get headerContainer(): HTMLElement | undefined;
    get filterInput(): HTMLInputElement | undefined;
    private focusCondition;
    focus(): void;
    clearFocus(): void;
    getFocusedElement(): IActionListItem<T> | undefined;
    /**
     * Replaces the items in the list in place, preserving the current filter,
     * without closing or repositioning the widget. When {@link focusItemId} is
     * provided, that item ({@link IActionListItem.item}'s `id`) is focused;
     * otherwise the previously focused item is preserved (matched by id).
     */
    updateItems(items: readonly IActionListItem<T>[], focusItemId?: string): void;
    /**
     * Focuses the item whose {@link IActionListItem.item}'s `id` matches
     * {@link itemId}, without rebuilding the list. Re-applies the focus after the
     * current event so a mouse click's own pointer handling cannot reset it.
     */
    focusItemById(itemId: string): void;
    private _focusCheckedOrFirst;
    hide(didCancel?: boolean): void;
    clearFilter(): boolean;
    /**
     * Whether this widget uses dynamic height (has filter or collapsible sections).
     */
    get hasDynamicHeight(): boolean;
    /**
     * The height of a single action row in pixels.
     */
    get lineHeight(): number;
    /**
     * Returns the height for an action item, using a taller line height
     * for items with a detail (second line).
     */
    protected _getItemHeight(item: IActionListItem<T>): number;
    /**
     * Computes the total height of all items (including collapsed/filtered items).
     */
    computeFullHeight(): number;
    /**
     * Computes the total height of visible items in the list.
     */
    computeListHeight(): number;
    /**
     * Lays out the list widget with the given explicit dimensions.
     */
    layout(height: number, width?: number): void;
    computeMaxWidth(minWidth: number): number;
    focusPrevious(): void;
    focusNext(): void;
    collapseFocusedSection(): void;
    expandFocusedSection(): void;
    toggleFocusedSection(): boolean;
    private _getFocusedSection;
    acceptSelected(preview?: boolean): void;
    private onListSelection;
    private onFocus;
    private _removeItem;
    private _recomputeGroupTitles;
    private _computeToolbarWidth;
    private _getRowElement;
    private _showHoverForElement;
    private _showSubmenuForItem;
    private _showSubmenuForElement;
    private _hideSubmenu;
    /**
     * Clears the submenu/hover panel. If focus currently lives inside the panel
     * (e.g. the user clicked a button in the hover content), focus is first moved
     * back to the list. Otherwise clearing the panel would drop focus to <body>,
     * which blurs the action widget and dismisses it.
     */
    private _clearSubmenuContainer;
    private _scheduleSubmenuHide;
    private _cancelSubmenuHide;
    private _scheduleSubmenuShow;
    private _cancelSubmenuShow;
    private onListHover;
    private onListClick;
}
/**
 * An action list that wraps {@link ActionListWidget} with context-view positioning
 * and anchor-based height computation.
 */
export declare class ActionList<T> extends Disposable {
    private readonly _contextViewService;
    private readonly _layoutService;
    private readonly _widget;
    private readonly _anchor;
    private _lastMinWidth;
    private _cachedMaxWidth;
    private _hasLaidOut;
    private _showAbove;
    get domNode(): HTMLElement;
    get filterContainer(): HTMLElement | undefined;
    get footerContainer(): HTMLElement | undefined;
    get headerContainer(): HTMLElement | undefined;
    get filterInput(): HTMLInputElement | undefined;
    /**
     * Returns the resolved anchor position after the first layout.
     * Used by the context view delegate to lock the dropdown direction.
     */
    get anchorPosition(): AnchorPosition | undefined;
    constructor(user: string, preview: boolean, items: readonly IActionListItem<T>[], _delegate: IActionListDelegate<T>, accessibilityProvider: Partial<IListAccessibilityProvider<IActionListItem<T>>> | undefined, options: IActionListOptions | undefined, anchor: HTMLElement | StandardMouseEvent | IAnchor, _contextViewService: IContextViewService, _layoutService: ILayoutService, instantiationService: IInstantiationService);
    focus(): void;
    hide(didCancel?: boolean): void;
    clearFilter(): boolean;
    focusPrevious(): void;
    focusNext(): void;
    collapseFocusedSection(): void;
    expandFocusedSection(): void;
    toggleFocusedSection(): boolean;
    acceptSelected(preview?: boolean): void;
    updateItems(items: readonly IActionListItem<T>[], focusItemId?: string): void;
    focusItemById(itemId: string): void;
    private hasDynamicHeight;
    private computeActionWidgetVerticalChromeHeight;
    private computeHeight;
    layout(minWidth: number): number;
}
