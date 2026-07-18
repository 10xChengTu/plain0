import { ILocalizedString } from "../../../../nls.js";
import { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { Action2 } from "../../../../platform/actions/common/actions.js";
import { ContextKeyExpression } from "../../../../platform/contextkey/common/contextkey.js";
import { IAction } from "../../../../base/common/actions.js";
/**
 * Menu group for actions contributed to {@link MenuId.TitleBar} that should render
 * **before** the layout controls (instead of trailing them like the default group).
 * Use this group to surface a leading affordance that should remain visible even
 * when layout controls are toggled off.
 */
export declare const TitleBarLeadingActionsGroup = "0_leading";
export declare class ToggleTitleBarConfigAction extends Action2 {
    private readonly section;
    constructor(section: string, title: string, description: string | ILocalizedString | undefined, order: number, when?: ContextKeyExpression);
    run(accessor: ServicesAccessor, ...args: unknown[]): void;
}
export declare const ACCOUNTS_ACTIVITY_TILE_ACTION: IAction;
export declare const GLOBAL_ACTIVITY_TITLE_ACTION: IAction;
