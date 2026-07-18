import { StandardMouseEvent } from "../../../base/browser/mouseEvent.js";
import { IAnchor } from "../../../base/browser/ui/contextview/contextview.js";
import { IListAccessibilityProvider } from "../../../base/browser/ui/list/listWidget.js";
import { IAction } from "../../../base/common/actions.js";
import { IActionListItem, IActionListDelegate, IActionListOptions } from "./actionList.js";
export declare const IActionWidgetService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IActionWidgetService>;
export interface IActionWidgetService {
    readonly _serviceBrand: undefined;
    show<T>(user: string, supportsPreview: boolean, items: readonly IActionListItem<T>[], delegate: IActionListDelegate<T>, anchor: HTMLElement | StandardMouseEvent | IAnchor, container: HTMLElement | undefined, actionBarActions?: readonly IAction[], accessibilityProvider?: Partial<IListAccessibilityProvider<IActionListItem<T>>>, listOptions?: IActionListOptions): void;
    /**
    * Replaces the items of the currently shown widget in place, without closing
    * or repositioning it. Preserves the current filter. When `focusItemId` is
    * provided, focuses that item; otherwise preserves the focused item.
    */
    updateItems<T>(items: readonly IActionListItem<T>[], focusItemId?: string): void;
    /**
    * Focuses the item with the given id in the currently shown widget, without
    * rebuilding the list.
    */
    focusItemById(itemId: string): void;
    hide(didCancel?: boolean): void;
    readonly isVisible: boolean;
}
