
import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { alert } from '../../../../base/browser/ui/aria/aria.js';
import { AuxiliaryBarVisibleContext, IsAuxiliaryWindowContext, AuxiliaryBarMaximizedContext } from '../../../common/contextkeys.js';
import { ViewContainerLocation, ViewContainerLocationToString } from '../../../common/views.js';
import { Parts, LayoutSettings, ActivityBarPosition } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.service.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.service.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyMod as KeyMod$1, KeyCode } from '../../../../base/common/keyCodes.js';
import { SwitchCompositeViewAction } from '../compositeBarActions.js';

const maximizeIcon = registerIcon("auxiliarybar-maximize", Codicon.screenFull, ( localize(3258, "Icon to maximize the secondary side bar.")));
const closeIcon = registerIcon("auxiliarybar-close", Codicon.close, ( localize(3259, "Icon to close the secondary side bar.")));
const auxiliaryBarRightIcon = registerIcon(
    "auxiliarybar-right-layout-icon",
    Codicon.layoutSidebarRight,
    ( localize(3260, "Icon to toggle the secondary side bar off in its right position."))
);
const auxiliaryBarRightOffIcon = registerIcon(
    "auxiliarybar-right-off-layout-icon",
    Codicon.layoutSidebarRightOff,
    ( localize(3261, "Icon to toggle the secondary side bar on in its right position."))
);
const auxiliaryBarLeftIcon = registerIcon("auxiliarybar-left-layout-icon", Codicon.layoutSidebarLeft, ( localize(3262, "Icon to toggle the secondary side bar in its left position.")));
const auxiliaryBarLeftOffIcon = registerIcon(
    "auxiliarybar-left-off-layout-icon",
    Codicon.layoutSidebarLeftOff,
    ( localize(3263, "Icon to toggle the secondary side bar on in its left position."))
);
class ToggleAuxiliaryBarAction extends Action2 {
    static {
        this.ID = "workbench.action.toggleAuxiliaryBar";
    }
    static {
        this.LABEL = ( localize2(3264, "Toggle Secondary Side Bar Visibility"));
    }
    constructor() {
        super({
            id: ToggleAuxiliaryBarAction.ID,
            title: ToggleAuxiliaryBarAction.LABEL,
            toggled: {
                condition: AuxiliaryBarVisibleContext,
                title: ( localize(3265, "Hide Secondary Side Bar")),
                icon: closeIcon,
                mnemonicTitle: ( localize(3266, "&&Secondary Side Bar"))
            },
            icon: closeIcon,
            category: Categories.View,
            metadata: {
                description: ( localize(3267, "Open/Show and Close/Hide Secondary Side Bar"))
            },
            f1: true,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod$1.CtrlCmd | KeyMod$1.Alt | KeyCode.KeyB
            },
            menu: [{
                id: MenuId.LayoutControlMenuSubmenu,
                group: "0_workbench_layout",
                order: 1
            }, {
                id: MenuId.MenubarAppearanceMenu,
                group: "2_workbench_layout",
                order: 2
            }]
        });
    }
    async run(accessor) {
        const layoutService = accessor.get(IWorkbenchLayoutService);
        const isCurrentlyVisible = layoutService.isVisible(Parts.AUXILIARYBAR_PART);
        layoutService.setPartHidden(isCurrentlyVisible, Parts.AUXILIARYBAR_PART);
        const alertMessage = isCurrentlyVisible ? ( localize(3268, "Secondary Side Bar hidden")) : ( localize(3269, "Secondary Side Bar shown"));
        alert(alertMessage);
    }
}
registerAction2(ToggleAuxiliaryBarAction);
MenuRegistry.appendMenuItem(MenuId.AuxiliaryBarTitle, {
    command: {
        id: ToggleAuxiliaryBarAction.ID,
        title: ( localize(3265, "Hide Secondary Side Bar")),
        icon: closeIcon
    },
    group: "navigation",
    order: 2,
    when: ( ContextKeyExpr.equals(
        `config.${LayoutSettings.ACTIVITY_BAR_LOCATION}`,
        ActivityBarPosition.DEFAULT
    ))
});
registerAction2(class extends Action2 {
    constructor() {
        super({
            id: "workbench.action.closeAuxiliaryBar",
            title: ( localize2(3265, "Hide Secondary Side Bar")),
            category: Categories.View,
            precondition: AuxiliaryBarVisibleContext,
            f1: true
        });
    }
    run(accessor) {
        accessor.get(IWorkbenchLayoutService).setPartHidden(true, Parts.AUXILIARYBAR_PART);
    }
});
registerAction2(class FocusAuxiliaryBarAction extends Action2 {
    static {
        this.ID = "workbench.action.focusAuxiliaryBar";
    }
    static {
        this.LABEL = ( localize2(3270, "Focus into Secondary Side Bar"));
    }
    constructor() {
        super({
            id: FocusAuxiliaryBarAction.ID,
            title: FocusAuxiliaryBarAction.LABEL,
            category: Categories.View,
            f1: true
        });
    }
    async run(accessor) {
        const paneCompositeService = accessor.get(IPaneCompositePartService);
        const layoutService = accessor.get(IWorkbenchLayoutService);
        if (!layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
            layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
        }
        const composite = paneCompositeService.getActivePaneComposite(ViewContainerLocation.AuxiliaryBar);
        composite?.focus();
    }
});
MenuRegistry.appendMenuItems([{
    id: MenuId.LayoutControlMenu,
    item: {
        group: "navigation",
        command: {
            id: ToggleAuxiliaryBarAction.ID,
            title: ( localize(3271, "Toggle Secondary Side Bar")),
            toggled: {
                condition: AuxiliaryBarVisibleContext,
                icon: auxiliaryBarLeftIcon
            },
            icon: auxiliaryBarLeftOffIcon
        },
        when: ( ContextKeyExpr.and(( IsAuxiliaryWindowContext.negate()), ( ContextKeyExpr.or(( ContextKeyExpr.equals("config.workbench.layoutControl.type", "toggles")), ( ContextKeyExpr.equals("config.workbench.layoutControl.type", "both")))), ( ContextKeyExpr.equals("config.workbench.sideBar.location", "right")))),
        order: 0
    }
}, {
    id: MenuId.LayoutControlMenu,
    item: {
        group: "navigation",
        command: {
            id: ToggleAuxiliaryBarAction.ID,
            title: ( localize(3271, "Toggle Secondary Side Bar")),
            toggled: {
                condition: AuxiliaryBarVisibleContext,
                icon: auxiliaryBarRightIcon
            },
            icon: auxiliaryBarRightOffIcon
        },
        when: ( ContextKeyExpr.and(( IsAuxiliaryWindowContext.negate()), ( ContextKeyExpr.or(( ContextKeyExpr.equals("config.workbench.layoutControl.type", "toggles")), ( ContextKeyExpr.equals("config.workbench.layoutControl.type", "both")))), ( ContextKeyExpr.equals("config.workbench.sideBar.location", "left")))),
        order: 2
    }
}, {
    id: MenuId.ViewContainerTitleContext,
    item: {
        group: "3_workbench_layout_move",
        command: {
            id: ToggleAuxiliaryBarAction.ID,
            title: ( localize2(3272, "Hide Secondary Side Bar"))
        },
        when: ( ContextKeyExpr.and(AuxiliaryBarVisibleContext, ( ContextKeyExpr.equals(
            "viewContainerLocation",
            ViewContainerLocationToString(ViewContainerLocation.AuxiliaryBar)
        )))),
        order: 2
    }
}]);
registerAction2(class extends SwitchCompositeViewAction {
    constructor() {
        super({
            id: "workbench.action.previousAuxiliaryBarView",
            title: ( localize2(3273, "Previous Secondary Side Bar View")),
            category: Categories.View,
            f1: true
        }, ViewContainerLocation.AuxiliaryBar, -1);
    }
});
registerAction2(class extends SwitchCompositeViewAction {
    constructor() {
        super({
            id: "workbench.action.nextAuxiliaryBarView",
            title: ( localize2(3274, "Next Secondary Side Bar View")),
            category: Categories.View,
            f1: true
        }, ViewContainerLocation.AuxiliaryBar, 1);
    }
});
class MaximizeAuxiliaryBar extends Action2 {
    static {
        this.ID = "workbench.action.maximizeAuxiliaryBar";
    }
    constructor() {
        super({
            id: MaximizeAuxiliaryBar.ID,
            title: ( localize2(3275, "Maximize Secondary Side Bar")),
            tooltip: ( localize(3276, "Maximize Secondary Side Bar")),
            category: Categories.View,
            f1: true,
            precondition: ( AuxiliaryBarMaximizedContext.negate())
        });
    }
    run(accessor) {
        const layoutService = accessor.get(IWorkbenchLayoutService);
        layoutService.setAuxiliaryBarMaximized(true);
    }
}
registerAction2(MaximizeAuxiliaryBar);
class RestoreAuxiliaryBar extends Action2 {
    static {
        this.ID = "workbench.action.restoreAuxiliaryBar";
    }
    constructor() {
        super({
            id: RestoreAuxiliaryBar.ID,
            title: ( localize2(3277, "Restore Secondary Side Bar")),
            tooltip: ( localize(3277, "Restore Secondary Side Bar")),
            category: Categories.View,
            f1: true,
            precondition: AuxiliaryBarMaximizedContext,
            keybinding: {
                weight: KeybindingWeight.WorkbenchContrib,
                primary: KeyMod$1.CtrlCmd | KeyCode.KeyW,
                win: {
                    primary: KeyMod$1.CtrlCmd | KeyCode.F4,
                    secondary: [KeyMod$1.CtrlCmd | KeyCode.KeyW]
                }
            }
        });
    }
    run(accessor) {
        const layoutService = accessor.get(IWorkbenchLayoutService);
        layoutService.setAuxiliaryBarMaximized(false);
    }
}
registerAction2(RestoreAuxiliaryBar);
class ToggleMaximizedAuxiliaryBar extends Action2 {
    static {
        this.ID = "workbench.action.toggleMaximizedAuxiliaryBar";
    }
    constructor() {
        super({
            id: ToggleMaximizedAuxiliaryBar.ID,
            title: ( localize2(3278, "Toggle Maximized Secondary Side Bar")),
            tooltip: ( localize(3279, "Maximize Secondary Side Bar")),
            f1: true,
            category: Categories.View,
            icon: maximizeIcon,
            toggled: {
                condition: AuxiliaryBarMaximizedContext,
                tooltip: ( localize(3277, "Restore Secondary Side Bar"))
            },
            menu: {
                id: MenuId.AuxiliaryBarTitle,
                group: "navigation",
                order: 1
            }
        });
    }
    run(accessor) {
        const layoutService = accessor.get(IWorkbenchLayoutService);
        layoutService.toggleMaximizedAuxiliaryBar();
    }
}
registerAction2(ToggleMaximizedAuxiliaryBar);

export { ToggleAuxiliaryBarAction };
