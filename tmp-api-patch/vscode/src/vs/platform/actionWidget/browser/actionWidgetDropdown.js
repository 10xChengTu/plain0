
import { __decorate, __param } from '../../../../../../external/tslib/tslib.es6.js';
import { getActiveElement, isHTMLElement } from '../../../base/browser/dom.js';
import { BaseDropdown } from '../../../base/browser/ui/dropdown/dropdown.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.service.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.service.js';
import { ActionListItemKind } from './actionList.js';
import { IActionWidgetService } from './actionWidget.service.js';

let ActionWidgetDropdown = class ActionWidgetDropdown extends BaseDropdown {
    constructor(
        container,
        _options,
        actionWidgetService,
        keybindingService,
        telemetryService
    ) {
        super(container, _options);
        this._options = _options;
        this.actionWidgetService = actionWidgetService;
        this.keybindingService = keybindingService;
        this.telemetryService = telemetryService;
        this._enabled = true;
    }
    show() {
        if (!this._enabled) {
            return;
        }
        const actionBarActions = this._options.actionBarActions ?? this._options.actionBarActionProvider?.getActions() ?? [];
        const actions = this._options.actions ?? this._options.actionProvider?.getActions() ?? [];
        const optionBeforeOpen = actions.find(a => a.checked);
        let selectedOption = optionBeforeOpen;
        const actionWidgetItems = [];
        const actionsByCategory = ( new Map());
        for (const action of actions) {
            let category = action.category;
            if (!category) {
                category = {
                    label: "",
                    order: Number.MIN_SAFE_INTEGER
                };
            }
            if (!( actionsByCategory.has(category.label))) {
                actionsByCategory.set(category.label, []);
            }
            actionsByCategory.get(category.label).push(action);
        }
        const sortedCategories = Array.from(actionsByCategory.entries()).sort((a, b) => {
            const aOrder = a[1][0]?.category?.order ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b[1][0]?.category?.order ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
        });
        for (let i = 0; i < sortedCategories.length; i++) {
            const [categoryLabel, categoryActions] = sortedCategories[i];
            const showHeader = categoryActions[0]?.category?.showHeader ?? false;
            if (showHeader && categoryLabel) {
                actionWidgetItems.push({
                    kind: ActionListItemKind.Header,
                    label: categoryLabel,
                    canPreview: false,
                    disabled: false,
                    hideIcon: false
                });
            }
            for (const action of categoryActions) {
                actionWidgetItems.push({
                    item: action,
                    tooltip: action.tooltip,
                    description: action.description,
                    detail: action.detail,
                    hover: action.hover,
                    toolbarActions: action.toolbarActions,
                    className: action.className,
                    inlineToggle: action.inlineToggle,
                    kind: ActionListItemKind.Action,
                    canPreview: false,
                    group: {
                        title: "",
                        icon: action.icon ?? ThemeIcon.fromId(action.checked ? Codicon.check.id : Codicon.blank.id)
                    },
                    disabled: !action.enabled,
                    hideIcon: false,
                    label: action.label,
                    keybinding: this._options.showItemKeybindings ? (action.keybinding ?? this.keybindingService.lookupKeybinding(action.id)) : undefined
                });
            }
            if (i < sortedCategories.length - 1) {
                actionWidgetItems.push({
                    label: "",
                    kind: ActionListItemKind.Separator,
                    canPreview: false,
                    disabled: false,
                    hideIcon: false
                });
            }
        }
        const previouslyFocusedElement = getActiveElement();
        const auxiliaryActionIds = ( new Set(( actionBarActions.map(action => action.id))));
        const actionWidgetDelegate = {
            onSelect: (action, preview) => {
                if (!( auxiliaryActionIds.has(action.id))) {
                    selectedOption = action;
                }
                this.actionWidgetService.hide();
                action.run();
            },
            onHide: () => {
                this.hide();
                if (isHTMLElement(previouslyFocusedElement)) {
                    previouslyFocusedElement.focus();
                }
                this._emitCloseEvent(optionBeforeOpen, selectedOption);
            }
        };
        if (actionBarActions.length) {
            if (actionWidgetItems.length) {
                actionWidgetItems.push({
                    label: "",
                    kind: ActionListItemKind.Separator,
                    canPreview: false,
                    disabled: false,
                    hideIcon: false
                });
            }
            for (const action of actionBarActions) {
                actionWidgetItems.push({
                    item: action,
                    tooltip: action.tooltip,
                    kind: ActionListItemKind.Action,
                    canPreview: false,
                    group: {
                        title: "",
                        icon: ThemeIcon.fromId(Codicon.blank.id)
                    },
                    disabled: !action.enabled,
                    hideIcon: false,
                    label: action.label
                });
            }
        }
        const nonSeparatorItems = actionWidgetItems.filter(i => i.kind === ActionListItemKind.Action);
        const accessibilityProvider = {
            isChecked(element) {
                return element.kind === ActionListItemKind.Action && !!element?.item?.checked;
            },
            getSetSize: () => nonSeparatorItems.length,
            getPosInSet: (_element, index) => {
                let pos = 0;
                for (let i = 0; i <= index && i < actionWidgetItems.length; i++) {
                    if (actionWidgetItems[i].kind === ActionListItemKind.Action) {
                        pos++;
                    }
                }
                return Math.max(pos, 1);
            },
            getRole: e => {
                switch (e.kind) {
                case ActionListItemKind.Action:
                    return e.item && ( auxiliaryActionIds.has(e.item.id)) ? "menuitem" : "menuitemcheckbox";
                case ActionListItemKind.Separator:
                    return "separator";
                default:
                    return "separator";
                }
            },
            getWidgetRole: () => "menu"
        };
        super.show();
        this.actionWidgetService.show(
            this._options.label ?? "",
            false,
            actionWidgetItems,
            actionWidgetDelegate,
            this._options.getAnchor?.() ?? this.element,
            undefined,
            [],
            accessibilityProvider,
            this._options.listOptions
        );
    }
    setEnabled(enabled) {
        this._enabled = enabled;
    }
    _emitCloseEvent(optionBeforeOpen, selectedOption) {
        const optionBefore = optionBeforeOpen;
        const optionAfter = selectedOption;
        if (this._options.reporter) {
            this.telemetryService.publicLog2("actionWidgetDropdownClosed", {
                id: this._options.reporter.id,
                name: this._options.reporter.name,
                selectionChanged: optionBefore?.id !== optionAfter?.id,
                optionIdBefore: this._options.reporter.includeOptions ? optionBefore?.id : undefined,
                optionIdAfter: this._options.reporter.includeOptions ? optionAfter?.id : undefined,
                optionLabelBefore: this._options.reporter.includeOptions ? optionBefore?.label : undefined,
                optionLabelAfter: this._options.reporter.includeOptions ? optionAfter?.label : undefined
            });
        }
    }
};
ActionWidgetDropdown = ( __decorate([( __param(2, IActionWidgetService)), ( __param(3, IKeybindingService)), ( __param(4, ITelemetryService))], ActionWidgetDropdown));

export { ActionWidgetDropdown };
