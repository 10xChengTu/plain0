
import { __decorate, __param } from '../../../../../../../external/tslib/tslib.es6.js';
import { localize } from '../../../../nls.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { append, $, EventType, addDisposableListener, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.service.js';
import { ICommandService } from '../../../../platform/commands/common/commands.service.js';
import { State } from '../common/debug.js';
import { IDebugService } from '../common/debug.service.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { asCssVariable } from '../../../../platform/theme/common/colorUtils.js';
import '../../../../platform/theme/common/colors/baseColors.js';
import '../../../../platform/theme/common/colors/chartsColors.js';
import '../../../../platform/theme/common/colors/editorColors.js';
import { selectBorder, selectBackground } from '../../../../platform/theme/common/colors/inputColors.js';
import '../../../../platform/theme/common/colors/listColors.js';
import '../../../../platform/theme/common/colors/menuColors.js';
import '../../../../platform/theme/common/colors/minimapColors.js';
import '../../../../platform/theme/common/colors/miscColors.js';
import '../../../../platform/theme/common/colors/quickpickColors.js';
import '../../../../platform/theme/common/colors/searchColors.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.service.js';
import { WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.service.js';
import { dispose, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ADD_CONFIGURATION_ID } from './debugCommands.js';
import { BaseActionViewItem, SelectActionViewItem } from '../../../../base/browser/ui/actionbar/actionViewItems.js';
import { debugStart } from './debugIcons.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.service.js';
import { defaultSelectBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.service.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityCommandId } from '../../accessibility/common/accessibilityCommands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.service.js';
import { hasNativeContextMenu } from '../../../../platform/window/common/window.js';
import { Gesture, EventType as EventType$1 } from '../../../../base/browser/touch.js';
import { ActionWidgetDropdown } from '../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IActionWidgetService } from '../../../../platform/actionWidget/browser/actionWidget.service.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.service.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';

let StartDebugActionViewItem = class StartDebugActionViewItem extends BaseActionViewItem {
    constructor(
        context,
        action,
        options,
        debugService,
        configurationService,
        commandService,
        contextService,
        _contextViewService,
        keybindingService,
        hoverService,
        contextKeyService,
        actionWidgetService,
        telemetryService
    ) {
        super(context, action, options);
        this.context = context;
        this.debugService = debugService;
        this.configurationService = configurationService;
        this.commandService = commandService;
        this.contextService = contextService;
        this.keybindingService = keybindingService;
        this.hoverService = hoverService;
        this.contextKeyService = contextKeyService;
        this.actionWidgetService = actionWidgetService;
        this.telemetryService = telemetryService;
        this.debugOptions = [];
        this.selected = 0;
        this.providers = [];
        this.optionCategories = [];
        this.toDispose = [];
        this.registerListeners();
    }
    registerListeners() {
        this.toDispose.push(this.configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration("launch")) {
                this.updateOptions();
            }
        }));
        this.toDispose.push(
            this.debugService.getConfigurationManager().onDidSelectConfiguration(() => {
                this.updateOptions();
            })
        );
    }
    render(container) {
        this.container = container;
        container.classList.add("start-debug-action-item");
        this.start = append(container, $(ThemeIcon.asCSSSelector(debugStart)));
        const title = this.keybindingService.appendKeybinding(this.action.label, this.action.id);
        this.toDispose.push(
            this.hoverService.setupManagedHover(getDefaultHoverDelegate("mouse"), this.start, title)
        );
        this.start.setAttribute("role", "button");
        this._setAriaLabel(title);
        this._register(Gesture.addTarget(this.start));
        for (const event of [EventType.CLICK, EventType$1.Tap]) {
            this.toDispose.push(addDisposableListener(this.start, event, () => {
                this.start.blur();
                if (this.debugService.state !== State.Initializing) {
                    this.actionRunner.run(this.action, this.context);
                }
            }));
        }
        this.toDispose.push(addDisposableListener(this.start, EventType.MOUSE_DOWN, e => {
            if (this.action.enabled && e.button === 0) {
                this.start.classList.add("active");
            }
        }));
        this.toDispose.push(addDisposableListener(this.start, EventType.MOUSE_UP, () => {
            this.start.classList.remove("active");
        }));
        this.toDispose.push(addDisposableListener(this.start, EventType.MOUSE_OUT, () => {
            this.start.classList.remove("active");
        }));
        this.toDispose.push(addDisposableListener(this.start, EventType.KEY_DOWN, e => {
            const event = ( new StandardKeyboardEvent(e));
            if (event.equals(KeyCode.RightArrow)) {
                this.start.tabIndex = -1;
                this.dropdownLabel?.focus();
                event.stopPropagation();
            }
        }));
        this.configurationContainer = append(container, $(".configuration"));
        this.dropdown = ( new ActionWidgetDropdown(this.configurationContainer, {
            label: ( localize(9614, "Debug Launch Configurations")),
            labelRenderer: el => {
                this.dropdownLabel = el;
                el.classList.add("start-debug-action-item-dropdown-label");
                el.tabIndex = -1;
                el.setAttribute("role", "button");
                el.setAttribute("aria-haspopup", "true");
                el.setAttribute("aria-expanded", "false");
                this.renderDropdownLabel();
                return null;
            },
            actionProvider: {
                getActions: () => this.getDropdownActions()
            },
            listOptions: {
                showFilter: true,
                filterPlaceholder: ( localize(9615, "Search configurations")),
                focusFilterOnOpen: true
            }
        }, this.actionWidgetService, this.keybindingService, this.telemetryService));
        this.toDispose.push(this.dropdown);
        this.toDispose.push(this.dropdown.onDidChangeVisibility(visible => {
            this.dropdownLabel?.setAttribute("aria-expanded", String(visible));
        }));
        this.toDispose.push(
            addDisposableListener(this.configurationContainer, EventType.KEY_DOWN, e => {
                const event = ( new StandardKeyboardEvent(e));
                if (event.equals(KeyCode.LeftArrow)) {
                    if (this.dropdownLabel) {
                        this.dropdownLabel.tabIndex = -1;
                    }
                    this.start.tabIndex = 0;
                    this.start.focus();
                    event.stopPropagation();
                    event.preventDefault();
                }
            })
        );
        this.container.style.border = `1px solid ${asCssVariable(selectBorder)}`;
        this.configurationContainer.style.borderLeft = `1px solid ${asCssVariable(selectBorder)}`;
        this.container.style.backgroundColor = asCssVariable(selectBackground);
        const configManager = this.debugService.getConfigurationManager();
        const updateDynamicConfigs = () => configManager.getDynamicProviders().then(providers => {
            if (providers.length !== this.providers.length) {
                this.providers = providers;
                this.updateOptions();
            }
        });
        this.toDispose.push(configManager.onDidChangeConfigurationProviders(updateDynamicConfigs));
        updateDynamicConfigs();
        this.updateOptions();
    }
    setActionContext(context) {
        this.context = context;
    }
    isEnabled() {
        return true;
    }
    focus(fromRight) {
        if (fromRight) {
            if (this.dropdownLabel) {
                this.dropdownLabel.tabIndex = 0;
                this.dropdownLabel.focus();
            }
        } else {
            this.start.tabIndex = 0;
            this.start.focus();
        }
    }
    blur() {
        this.start.tabIndex = -1;
        if (this.dropdownLabel) {
            this.dropdownLabel.tabIndex = -1;
            this.dropdownLabel.blur();
        }
        this.container.blur();
    }
    setFocusable(focusable) {
        if (focusable) {
            this.start.tabIndex = 0;
        } else {
            this.start.tabIndex = -1;
            if (this.dropdownLabel) {
                this.dropdownLabel.tabIndex = -1;
            }
        }
    }
    dispose() {
        this.toDispose = dispose(this.toDispose);
        super.dispose();
    }
    renderDropdownLabel() {
        if (!this.dropdownLabel) {
            return;
        }
        const currentLabel = this.debugOptions[this.selected]?.label ?? ( localize(9616, "No Configurations"));
        const labelSpan = $("span.start-debug-action-item-label", undefined, currentLabel);
        const chevron = renderLabelWithIcons("$(chevron-down)");
        reset(this.dropdownLabel, labelSpan, ...chevron);
        this.dropdownLabel.title = currentLabel;
        this.dropdownLabel.setAttribute("aria-label", ( localize(9617, "Debug Launch Configurations: {0}", currentLabel)));
    }
    getDropdownActions() {
        const actions = [];
        for (let i = 0; i < this.debugOptions.length; i++) {
            const option = this.debugOptions[i];
            const category = this.optionCategories[i];
            actions.push({
                id: `debug.config.${i}`,
                label: option.label,
                tooltip: option.label,
                class: undefined,
                enabled: true,
                checked: i === this.selected,
                category,
                run: async () => {
                    await option.handler();
                }
            });
        }
        return actions;
    }
    updateOptions() {
        this.selected = 0;
        this.debugOptions = [];
        this.optionCategories = [];
        const manager = this.debugService.getConfigurationManager();
        const inWorkspace = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE;
        let lastGroup;
        let groupOrder = 0;
        const pushOption = (option, category) => {
            this.debugOptions.push(option);
            this.optionCategories.push(category);
        };
        manager.getAllConfigurations().forEach((
            {
                launch,
                name,
                presentation
            }
        ) => {
            if (lastGroup !== presentation?.group) {
                lastGroup = presentation?.group;
                if (this.debugOptions.length) {
                    groupOrder++;
                }
            }
            if (name === manager.selectedConfiguration.name && launch === manager.selectedConfiguration.launch) {
                this.selected = this.debugOptions.length;
            }
            const label = inWorkspace ? `${name} (${launch.name})` : name;
            pushOption({
                label,
                handler: async () => {
                    await manager.selectConfiguration(launch, name);
                    return true;
                }
            }, {
                label: `configurations-${groupOrder}`,
                order: groupOrder
            });
        });
        manager.getRecentDynamicConfigurations().slice(0, 3).forEach((
            {
                name,
                type
            }
        ) => {
            if (type === manager.selectedConfiguration.type && manager.selectedConfiguration.name === name) {
                this.selected = this.debugOptions.length;
            }
            pushOption({
                label: name,
                handler: async () => {
                    await manager.selectConfiguration(undefined, name, undefined, {
                        type
                    });
                    return true;
                }
            }, {
                label: "recent-dynamic",
                order: 100
            });
        });
        if (this.debugOptions.length === 0) {
            pushOption({
                label: ( localize(9616, "No Configurations")),
                handler: async () => false
            }, undefined);
        }
        this.providers.forEach(p => {
            pushOption({
                label: `${p.label}...`,
                handler: async () => {
                    const picked = await p.pick();
                    if (picked) {
                        await manager.selectConfiguration(picked.launch, picked.config.name, picked.config, {
                            type: p.type
                        });
                        return true;
                    }
                    return false;
                }
            }, {
                label: "actions",
                order: 200
            });
        });
        manager.getLaunches().filter(l => !l.hidden).forEach(l => {
            const label = inWorkspace ? ( localize(9618, "Add Config ({0})...", l.name)) : ( localize(9619, "Add Configuration..."));
            pushOption({
                label,
                handler: async () => {
                    await this.commandService.executeCommand(ADD_CONFIGURATION_ID, ( l.uri.toString()));
                    return false;
                }
            }, {
                label: "actions",
                order: 200
            });
        });
        this.renderDropdownLabel();
    }
    _setAriaLabel(title) {
        let ariaLabel = title;
        let keybinding;
        const verbose = this.configurationService.getValue(AccessibilityVerbositySettingId.Debug);
        if (verbose) {
            keybinding = this.keybindingService.lookupKeybinding(AccessibilityCommandId.OpenAccessibilityHelp, this.contextKeyService)?.getLabel() ?? undefined;
        }
        if (keybinding) {
            ariaLabel = ( localize(9620, "{0}, use ({1}) for accessibility help", ariaLabel, keybinding));
        } else {
            ariaLabel = ( localize(
                9621,
                "{0}, run the command Open Accessibility Help which is currently not triggerable via keybinding.",
                ariaLabel
            ));
        }
        this.start.ariaLabel = ariaLabel;
    }
};
StartDebugActionViewItem = ( __decorate([( __param(3, IDebugService)), ( __param(4, IConfigurationService)), ( __param(5, ICommandService)), ( __param(6, IWorkspaceContextService)), ( __param(7, IContextViewService)), ( __param(8, IKeybindingService)), ( __param(9, IHoverService)), ( __param(10, IContextKeyService)), ( __param(11, IActionWidgetService)), ( __param(12, ITelemetryService))], StartDebugActionViewItem));
let FocusSessionActionViewItem = class FocusSessionActionViewItem extends SelectActionViewItem {
    constructor(action, session, debugService, contextViewService, configurationService) {
        super(null, action, [], -1, contextViewService, defaultSelectBoxStyles, {
            ariaLabel: ( localize(9622, "Debug Session")),
            useCustomDrawn: !hasNativeContextMenu(configurationService)
        });
        this.debugService = debugService;
        this.configurationService = configurationService;
        this._register(this.debugService.getViewModel().onDidFocusSession(() => {
            const session = this.getSelectedSession();
            if (session) {
                const index = this.getSessions().indexOf(session);
                this.select(index);
            }
        }));
        const sessionListenersStore = this._register(( new DisposableStore()));
        const registerSessionListeners = session => {
            const sessionListeners = sessionListenersStore.add(( new DisposableStore()));
            sessionListeners.add(session.onDidChangeName(() => this.update()));
            sessionListeners.add(
                session.onDidEndAdapter(() => sessionListenersStore.delete(sessionListeners))
            );
        };
        this._register(this.debugService.onDidNewSession(session => {
            registerSessionListeners(session);
            this.update();
        }));
        this.getSessions().forEach(registerSessionListeners);
        this._register(this.debugService.onDidEndSession(() => this.update()));
        const selectedSession = session ? this.mapFocusedSessionToSelected(session) : undefined;
        this.update(selectedSession);
    }
    getActionContext(_, index) {
        return this.getSessions()[index];
    }
    update(session) {
        if (!session) {
            session = this.getSelectedSession();
        }
        const sessions = this.getSessions();
        const names = ( sessions.map(s => {
            const label = s.getLabel();
            if (s.parentSession) {
                return `\u00A0\u00A0${label}`;
            }
            return label;
        }));
        this.setOptions(( names.map(data => ({
            text: data
        }))), session ? sessions.indexOf(session) : undefined);
    }
    getSelectedSession() {
        const session = this.debugService.getViewModel().focusedSession;
        return session ? this.mapFocusedSessionToSelected(session) : undefined;
    }
    getSessions() {
        const showSubSessions = this.configurationService.getValue("debug").showSubSessionsInToolBar;
        const sessions = this.debugService.getModel().getSessions();
        return showSubSessions ? sessions : sessions.filter(s => !s.parentSession);
    }
    mapFocusedSessionToSelected(focusedSession) {
        const showSubSessions = this.configurationService.getValue("debug").showSubSessionsInToolBar;
        while (focusedSession.parentSession && !showSubSessions) {
            focusedSession = focusedSession.parentSession;
        }
        return focusedSession;
    }
};
FocusSessionActionViewItem = ( __decorate([( __param(2, IDebugService)), ( __param(3, IContextViewService)), ( __param(4, IConfigurationService))], FocusSessionActionViewItem));

export { FocusSessionActionViewItem, StartDebugActionViewItem };
