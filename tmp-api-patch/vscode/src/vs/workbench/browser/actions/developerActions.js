
import { registerCss } from '../../../../../../css.js';
import * as actions from './media/actions.css';
import { localize2, localize } from '../../../nls.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.service.js';
import { DomEmitter } from '../../../base/browser/event.js';
import { Color } from '../../../base/common/color.js';
import { Event, Emitter } from '../../../base/common/event.js';
import { DisposableStore, toDisposable, dispose, DisposableTracker, setDisposableTracker } from '../../../base/common/lifecycle.js';
import { createElement, getActiveDocument, getDomNodePagePosition, append, $, getWindows, onDidRegisterWindow } from '../../../base/browser/dom.js';
import { createStyleSheet, createCSSRule } from '../../../base/browser/domStylesheets.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.service.js';
import { RawContextKey, ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.service.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { RunOnceScheduler } from '../../../base/common/async.js';
import { ILayoutService } from '../../../platform/layout/browser/layoutService.service.js';
import { Registry } from '../../../platform/registry/common/platform.js';
import { Action2, MenuRegistry, registerAction2 } from '../../../platform/actions/common/actions.js';
import { StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IStorageService } from '../../../platform/storage/common/storage.service.js';
import { clamp } from '../../../base/common/numbers.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Extensions } from '../../../platform/configuration/common/configurationRegistry.js';
import { ILogService } from '../../../platform/log/common/log.service.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.service.js';
import { Categories } from '../../../platform/action/common/actionCommonCategories.js';
import { IWorkingCopyBackupService } from '../../services/workingCopy/common/workingCopyBackup.service.js';
import { ResultKind } from '../../../platform/keybinding/common/keybindingResolver.js';
import { IDialogService } from '../../../platform/dialogs/common/dialogs.service.js';
import { IOutputService } from '../../services/output/common/output.service.js';
import { windowLogId } from '../../services/log/common/logConstants.js';
import { ByteSize } from '../../../platform/files/common/files.js';
import { IQuickInputService } from '../../../platform/quickinput/common/quickInput.service.js';
import { IUserDataProfileService } from '../../services/userDataProfile/common/userDataProfile.service.js';
import { IEditorService } from '../../services/editor/common/editorService.service.js';
import product from '../../../platform/product/common/product.js';
import { CommandsRegistry } from '../../../platform/commands/common/commands.js';
import { IEnvironmentService } from '../../../platform/environment/common/environment.service.js';
import { IProductService } from '../../../platform/product/common/productService.service.js';
import { IDefaultAccountService } from '../../../platform/defaultAccount/common/defaultAccount.service.js';
import { IAuthenticationService } from '../../services/authentication/common/authentication.service.js';
import { IAuthenticationAccessService } from '../../services/authentication/browser/authenticationAccessService.service.js';
import { IPolicyService } from '../../../platform/policy/common/policy.service.js';
import { pickManagedSettings, projectManagedSettings, COPILOT_ENABLED_PLUGINS_KEY, COPILOT_STRICT_MARKETPLACES_KEY, COPILOT_EXTRA_MARKETPLACES_KEY, MANAGED_SETTINGS_CHANNELS } from '../../../platform/policy/common/copilotManagedSettings.js';
import { INativeManagedSettingsService, IFileManagedSettingsService } from '../../../platform/policy/common/copilotManagedSettings.service.js';
import { APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME, AccountPolicyGateState, AccountPolicyGateUnsatisfiedReason } from '../../services/policies/common/accountPolicyService.js';
import { IAccountPolicyGateService } from '../../services/policies/common/accountPolicyService.service.js';
import { adaptManagedSettings } from '../../services/accounts/browser/managedSettings.js';
import { isObject } from '../../../base/common/types.js';
import { parse } from '../../../base/common/json.js';
import { getParseErrorMessage } from '../../../base/common/jsonErrorMessages.js';

registerCss(actions);
class InspectContextKeysAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.inspectContextKeys",
            title: ( localize2(2970, "Inspect Context Keys")),
            category: Categories.Developer,
            f1: true
        });
    }
    run(accessor) {
        const contextKeyService = accessor.get(IContextKeyService);
        const disposables = ( new DisposableStore());
        const stylesheet = createStyleSheet(undefined, undefined, disposables);
        createCSSRule("*", "cursor: crosshair !important;", stylesheet);
        const hoverFeedback = createElement("div");
        const activeDocument = getActiveDocument();
        activeDocument.body.appendChild(hoverFeedback);
        disposables.add(toDisposable(() => hoverFeedback.remove()));
        hoverFeedback.style.position = "absolute";
        hoverFeedback.style.pointerEvents = "none";
        hoverFeedback.style.backgroundColor = "rgba(255, 0, 0, 0.5)";
        hoverFeedback.style.zIndex = "1000";
        const onMouseMove = disposables.add(( new DomEmitter(activeDocument, "mousemove", true)));
        disposables.add(onMouseMove.event(e => {
            const target = e.composedPath()[0];
            const position = getDomNodePagePosition(target);
            hoverFeedback.style.top = `${position.top}px`;
            hoverFeedback.style.left = `${position.left}px`;
            hoverFeedback.style.width = `${position.width}px`;
            hoverFeedback.style.height = `${position.height}px`;
        }));
        const onMouseDown = disposables.add(( new DomEmitter(activeDocument, "mousedown", true)));
        Event.once(onMouseDown.event)(e => {
            e.preventDefault();
            e.stopPropagation();
        }, null, disposables);
        const onMouseUp = disposables.add(( new DomEmitter(activeDocument, "mouseup", true)));
        Event.once(onMouseUp.event)(e => {
            e.preventDefault();
            e.stopPropagation();
            const context = contextKeyService.getContext(e.composedPath()[0]);
            console.log(context.collectAllValues());
            dispose(disposables);
        }, null, disposables);
    }
}
class ToggleScreencastModeAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.toggleScreencastMode",
            title: ( localize2(2971, "Toggle Screencast Mode")),
            category: Categories.Developer,
            f1: true
        });
    }
    run(accessor) {
        if (ToggleScreencastModeAction.disposable) {
            ToggleScreencastModeAction.disposable.dispose();
            ToggleScreencastModeAction.disposable = undefined;
            return;
        }
        const layoutService = accessor.get(ILayoutService);
        const configurationService = accessor.get(IConfigurationService);
        const keybindingService = accessor.get(IKeybindingService);
        const disposables = ( new DisposableStore());
        const container = layoutService.activeContainer;
        const mouseMarker = append(container, $(".screencast-mouse"));
        disposables.add(toDisposable(() => mouseMarker.remove()));
        const keyboardMarker = append(container, $(".screencast-keyboard"));
        disposables.add(toDisposable(() => keyboardMarker.remove()));
        const onMouseDown = disposables.add(( new Emitter()));
        const onMouseUp = disposables.add(( new Emitter()));
        const onMouseMove = disposables.add(( new Emitter()));
        function registerContainerListeners(container, windowDisposables) {
            const listeners = ( new DisposableStore());
            listeners.add(listeners.add(( new DomEmitter(container, "mousedown", true))).event(e => onMouseDown.fire(e)));
            listeners.add(listeners.add(( new DomEmitter(container, "mouseup", true))).event(e => onMouseUp.fire(e)));
            listeners.add(listeners.add(( new DomEmitter(container, "mousemove", true))).event(e => onMouseMove.fire(e)));
            windowDisposables.add(listeners);
            disposables.add(toDisposable(() => windowDisposables.delete(listeners)));
            disposables.add(listeners);
        }
        for (const {
            window,
            disposables
        } of getWindows()) {
            registerContainerListeners(layoutService.getContainer(window), disposables);
        }
        disposables.add(onDidRegisterWindow((
            {
                window,
                disposables
            }
        ) => registerContainerListeners(layoutService.getContainer(window), disposables)));
        disposables.add(layoutService.onDidChangeActiveContainer(() => {
            layoutService.activeContainer.appendChild(mouseMarker);
            layoutService.activeContainer.appendChild(keyboardMarker);
        }));
        const updateMouseIndicatorColor = () => {
            mouseMarker.style.borderColor = ( ( Color.fromHex(configurationService.getValue("screencastMode.mouseIndicatorColor"))).toString());
        };
        let mouseIndicatorSize;
        const updateMouseIndicatorSize = () => {
            mouseIndicatorSize = clamp(
                configurationService.getValue("screencastMode.mouseIndicatorSize") || 20,
                20,
                100
            );
            mouseMarker.style.height = `${mouseIndicatorSize}px`;
            mouseMarker.style.width = `${mouseIndicatorSize}px`;
        };
        updateMouseIndicatorColor();
        updateMouseIndicatorSize();
        disposables.add(onMouseDown.event(e => {
            mouseMarker.style.top = `${e.clientY - mouseIndicatorSize / 2}px`;
            mouseMarker.style.left = `${e.clientX - mouseIndicatorSize / 2}px`;
            mouseMarker.style.display = "block";
            mouseMarker.style.transform = `scale(${1})`;
            mouseMarker.style.transition = "transform 0.1s";
            const mouseMoveListener = onMouseMove.event(e => {
                mouseMarker.style.top = `${e.clientY - mouseIndicatorSize / 2}px`;
                mouseMarker.style.left = `${e.clientX - mouseIndicatorSize / 2}px`;
                mouseMarker.style.transform = `scale(${.8})`;
            });
            Event.once(onMouseUp.event)(() => {
                mouseMarker.style.display = "none";
                mouseMoveListener.dispose();
            });
        }));
        const updateKeyboardFontSize = () => {
            keyboardMarker.style.fontSize = `${clamp(configurationService.getValue("screencastMode.fontSize") || 56, 20, 100)}px`;
        };
        const updateKeyboardMarker = () => {
            keyboardMarker.style.bottom = `${clamp(configurationService.getValue("screencastMode.verticalOffset") || 0, 0, 90)}%`;
        };
        let keyboardMarkerTimeout;
        const updateKeyboardMarkerTimeout = () => {
            keyboardMarkerTimeout = clamp(
                configurationService.getValue("screencastMode.keyboardOverlayTimeout") || 800,
                500,
                5000
            );
        };
        updateKeyboardFontSize();
        updateKeyboardMarker();
        updateKeyboardMarkerTimeout();
        disposables.add(configurationService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration("screencastMode.verticalOffset")) {
                updateKeyboardMarker();
            }
            if (e.affectsConfiguration("screencastMode.fontSize")) {
                updateKeyboardFontSize();
            }
            if (e.affectsConfiguration("screencastMode.keyboardOverlayTimeout")) {
                updateKeyboardMarkerTimeout();
            }
            if (e.affectsConfiguration("screencastMode.mouseIndicatorColor")) {
                updateMouseIndicatorColor();
            }
            if (e.affectsConfiguration("screencastMode.mouseIndicatorSize")) {
                updateMouseIndicatorSize();
            }
        }));
        const onKeyDown = disposables.add(( new Emitter()));
        const onCompositionStart = disposables.add(( new Emitter()));
        const onCompositionUpdate = disposables.add(( new Emitter()));
        const onCompositionEnd = disposables.add(( new Emitter()));
        function registerWindowListeners(window, windowDisposables) {
            const listeners = ( new DisposableStore());
            listeners.add(listeners.add(( new DomEmitter(window, "keydown", true))).event(e => onKeyDown.fire(e)));
            listeners.add(listeners.add(( new DomEmitter(window, "compositionstart", true))).event(e => onCompositionStart.fire(e)));
            listeners.add(listeners.add(( new DomEmitter(window, "compositionupdate", true))).event(e => onCompositionUpdate.fire(e)));
            listeners.add(listeners.add(( new DomEmitter(window, "compositionend", true))).event(e => onCompositionEnd.fire(e)));
            windowDisposables.add(listeners);
            disposables.add(toDisposable(() => windowDisposables.delete(listeners)));
            disposables.add(listeners);
        }
        for (const {
            window,
            disposables
        } of getWindows()) {
            registerWindowListeners(window, disposables);
        }
        disposables.add(onDidRegisterWindow((
            {
                window,
                disposables
            }
        ) => registerWindowListeners(window, disposables)));
        let length = 0;
        let composing = undefined;
        let imeBackSpace = false;
        const clearKeyboardScheduler = disposables.add(( new RunOnceScheduler(() => {
            keyboardMarker.textContent = "";
            composing = undefined;
            length = 0;
        }, keyboardMarkerTimeout)));
        disposables.add(onCompositionStart.event(e => {
            imeBackSpace = true;
        }));
        disposables.add(onCompositionUpdate.event(e => {
            if (e.data && imeBackSpace) {
                if (length > 20) {
                    keyboardMarker.innerText = "";
                    length = 0;
                }
                composing = composing ?? append(keyboardMarker, $("span.key"));
                composing.textContent = e.data;
            } else if (imeBackSpace) {
                keyboardMarker.innerText = "";
                append(keyboardMarker, $("span.key", {}, `Backspace`));
            }
            clearKeyboardScheduler.schedule(keyboardMarkerTimeout);
        }));
        disposables.add(onCompositionEnd.event(e => {
            composing = undefined;
            length++;
        }));
        disposables.add(onKeyDown.event(e => {
            if (e.key === "Process" || /[\uac00-\ud787\u3131-\u314e\u314f-\u3163\u3041-\u3094\u30a1-\u30f4\u30fc\u3005\u3006\u3024\u4e00-\u9fa5]/u.test(e.key)) {
                if (e.code === "Backspace") {
                    imeBackSpace = true;
                } else if (!e.code.includes("Key")) {
                    composing = undefined;
                    imeBackSpace = false;
                } else {
                    imeBackSpace = true;
                }
                clearKeyboardScheduler.schedule(keyboardMarkerTimeout);
                return;
            }
            if (e.isComposing) {
                return;
            }
            const options = configurationService.getValue("screencastMode.keyboardOptions");
            const event = ( new StandardKeyboardEvent(e));
            const shortcut = keybindingService.softDispatch(event, event.target);
            if (shortcut.kind === ResultKind.KbFound && shortcut.commandId && !(options.showSingleEditorCursorMoves ?? true) && (["cursorLeft", "cursorRight", "cursorUp", "cursorDown"].includes(shortcut.commandId))) {
                return;
            }
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || length > 20 || event.keyCode === KeyCode.Backspace || event.keyCode === KeyCode.Escape || event.keyCode === KeyCode.UpArrow || event.keyCode === KeyCode.DownArrow || event.keyCode === KeyCode.LeftArrow || event.keyCode === KeyCode.RightArrow) {
                keyboardMarker.innerText = "";
                length = 0;
            }
            const keybinding = keybindingService.resolveKeyboardEvent(event);
            const commandDetails = (this._isKbFound(shortcut) && shortcut.commandId) ? this.getCommandDetails(shortcut.commandId) : undefined;
            let commandAndGroupLabel = commandDetails?.title;
            let keyLabel = keybinding.getLabel();
            if (commandDetails) {
                if ((options.showCommandGroups ?? false) && commandDetails.category) {
                    commandAndGroupLabel = `${commandDetails.category}: ${commandAndGroupLabel} `;
                }
                if (this._isKbFound(shortcut) && shortcut.commandId) {
                    const keybindings = keybindingService.lookupKeybindings(shortcut.commandId).filter(k => k.getLabel()?.endsWith(keyLabel ?? ""));
                    if (keybindings.length > 0) {
                        keyLabel = keybindings[keybindings.length - 1].getLabel();
                    }
                }
            }
            if ((options.showCommands ?? true) && commandAndGroupLabel) {
                append(keyboardMarker, $("span.title", {}, `${commandAndGroupLabel} `));
            }
            if ((options.showKeys ?? true) || ((options.showKeybindings ?? true) && this._isKbFound(shortcut))) {
                keyLabel = keyLabel?.replace("UpArrow", "↑")?.replace("DownArrow", "↓")?.replace("LeftArrow", "←")?.replace("RightArrow", "→");
                append(keyboardMarker, $("span.key", {}, keyLabel ?? ""));
            }
            length++;
            clearKeyboardScheduler.schedule(keyboardMarkerTimeout);
        }));
        ToggleScreencastModeAction.disposable = disposables;
    }
    _isKbFound(resolutionResult) {
        return resolutionResult.kind === ResultKind.KbFound;
    }
    getCommandDetails(commandId) {
        const fromMenuRegistry = MenuRegistry.getCommand(commandId);
        if (fromMenuRegistry) {
            return {
                title: typeof fromMenuRegistry.title === "string" ? fromMenuRegistry.title : fromMenuRegistry.title.value,
                category: fromMenuRegistry.category ? (typeof fromMenuRegistry.category === "string" ? fromMenuRegistry.category : fromMenuRegistry.category.value) : undefined
            };
        }
        const fromCommandsRegistry = CommandsRegistry.getCommand(commandId);
        if (fromCommandsRegistry?.metadata?.description) {
            return {
                title: typeof fromCommandsRegistry.metadata.description === "string" ? fromCommandsRegistry.metadata.description : fromCommandsRegistry.metadata.description.value
            };
        }
        return undefined;
    }
}
class LogStorageAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.logStorage",
            title: ( localize2(2972, "Log Storage Database Contents")),
            category: Categories.Developer,
            f1: true
        });
    }
    run(accessor) {
        const storageService = accessor.get(IStorageService);
        const dialogService = accessor.get(IDialogService);
        storageService.log();
        dialogService.info(( localize(
            2973,
            "The storage database contents have been logged to the developer tools."
        )), ( localize(2974, "Open developer tools from the menu and select the Console tab.")));
    }
}
class LogWorkingCopiesAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.logWorkingCopies",
            title: ( localize2(2975, "Log Working Copies")),
            category: Categories.Developer,
            f1: true
        });
    }
    async run(accessor) {
        const workingCopyService = accessor.get(IWorkingCopyService);
        const workingCopyBackupService = accessor.get(IWorkingCopyBackupService);
        const logService = accessor.get(ILogService);
        const outputService = accessor.get(IOutputService);
        const backups = await workingCopyBackupService.getBackups();
        const msg = [
            ``,
            `[Working Copies]`,
            ...((workingCopyService.workingCopies.length > 0) ? ( workingCopyService.workingCopies.map(workingCopy => `${workingCopy.isDirty() ? "● " : ""}${( workingCopy.resource.toString(true))} (typeId: ${workingCopy.typeId || "<no typeId>"})`)) : ["<none>"]),
            ``,
            `[Backups]`,
            ...((backups.length > 0) ? ( backups.map(backup => `${( backup.resource.toString(true))} (typeId: ${backup.typeId || "<no typeId>"})`)) : ["<none>"])
        ];
        logService.info(msg.join("\n"));
        outputService.showChannel(windowLogId, true);
    }
}
class RemoveLargeStorageEntriesAction extends Action2 {
    static {
        this.SIZE_THRESHOLD = 1024 * 16;
    }
    constructor() {
        super({
            id: "workbench.action.removeLargeStorageDatabaseEntries",
            title: ( localize2(2976, "Remove Large Storage Database Entries...")),
            category: Categories.Developer,
            f1: true
        });
    }
    async run(accessor) {
        const storageService = accessor.get(IStorageService);
        const quickInputService = accessor.get(IQuickInputService);
        const userDataProfileService = accessor.get(IUserDataProfileService);
        const dialogService = accessor.get(IDialogService);
        const environmentService = accessor.get(IEnvironmentService);
        const items = [];
        for (const scope of [StorageScope.APPLICATION, StorageScope.PROFILE, StorageScope.WORKSPACE]) {
            if (scope === StorageScope.PROFILE && userDataProfileService.currentProfile.isDefault) {
                continue;
            }
            for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
                for (const key of ( storageService.keys(scope, target))) {
                    const value = storageService.get(key, scope);
                    if (value && (!environmentService.isBuilt  || value.length > RemoveLargeStorageEntriesAction.SIZE_THRESHOLD)) {
                        items.push({
                            key,
                            scope,
                            target,
                            size: value.length,
                            label: key,
                            description: ByteSize.formatSize(value.length),
                            detail: ( localize(
                                2977,
                                "Scope: {0}, Target: {1}",
                                scope === StorageScope.APPLICATION ? ( localize(2978, "Global")) : scope === StorageScope.PROFILE ? ( localize(2979, "Profile")) : ( localize(2980, "Workspace")),
                                target === StorageTarget.MACHINE ? ( localize(2981, "Machine")) : ( localize(2982, "User"))
                            ))
                        });
                    }
                }
            }
        }
        items.sort((itemA, itemB) => itemB.size - itemA.size);
        const selectedItems = await ( new Promise(resolve => {
            const disposables = ( new DisposableStore());
            const picker = disposables.add(quickInputService.createQuickPick());
            picker.items = items;
            picker.canSelectMany = true;
            picker.ok = false;
            picker.customButton = true;
            picker.hideCheckAll = true;
            picker.customLabel = ( localize(2983, "Remove"));
            picker.placeholder = ( localize(2984, "Select large entries to remove from storage"));
            if (items.length === 0) {
                picker.description = ( localize(2985, "There are no large storage entries to remove."));
            }
            picker.show();
            disposables.add(picker.onDidCustom(() => {
                resolve(picker.selectedItems);
                picker.hide();
            }));
            disposables.add(picker.onDidHide(() => disposables.dispose()));
        }));
        if (selectedItems.length === 0) {
            return;
        }
        const {
            confirmed
        } = await dialogService.confirm({
            type: "warning",
            message: ( localize(
                2986,
                "Do you want to remove the selected storage entries from the database?"
            )),
            detail: ( localize(
                2987,
                "{0}\n\nThis action is irreversible and may result in data loss!",
                ( selectedItems.map(item => item.label)).join("\n")
            )),
            primaryButton: ( localize(2988, "&&Remove"))
        });
        if (!confirmed) {
            return;
        }
        const scopesToOptimize = ( new Set());
        for (const item of selectedItems) {
            storageService.remove(item.key, item.scope);
            scopesToOptimize.add(item.scope);
        }
        for (const scope of scopesToOptimize) {
            await storageService.optimize(scope);
        }
    }
}
let tracker = undefined;
let trackedDisposables = ( new Set());
const DisposablesSnapshotStateContext = ( new RawContextKey("dirtyWorkingCopies", "stopped"));
class StartTrackDisposables extends Action2 {
    constructor() {
        super({
            id: "workbench.action.startTrackDisposables",
            title: ( localize2(2989, "Start Tracking Disposables")),
            category: Categories.Developer,
            f1: true,
            precondition: ( ContextKeyExpr.and(( ( DisposablesSnapshotStateContext.isEqualTo("pending")).negate()), ( ( DisposablesSnapshotStateContext.isEqualTo("started")).negate())))
        });
    }
    run(accessor) {
        const disposablesSnapshotStateContext = DisposablesSnapshotStateContext.bindTo(accessor.get(IContextKeyService));
        disposablesSnapshotStateContext.set("started");
        trackedDisposables.clear();
        tracker = ( new DisposableTracker());
        setDisposableTracker(tracker);
    }
}
class SnapshotTrackedDisposables extends Action2 {
    constructor() {
        super({
            id: "workbench.action.snapshotTrackedDisposables",
            title: ( localize2(2990, "Snapshot Tracked Disposables")),
            category: Categories.Developer,
            f1: true,
            precondition: ( DisposablesSnapshotStateContext.isEqualTo("started"))
        });
    }
    run(accessor) {
        const disposablesSnapshotStateContext = DisposablesSnapshotStateContext.bindTo(accessor.get(IContextKeyService));
        disposablesSnapshotStateContext.set("pending");
        trackedDisposables = ( new Set(
            tracker?.computeLeakingDisposables(1000)?.leaks.map(disposable => disposable.value)
        ));
    }
}
class StopTrackDisposables extends Action2 {
    constructor() {
        super({
            id: "workbench.action.stopTrackDisposables",
            title: ( localize2(2991, "Stop Tracking Disposables")),
            category: Categories.Developer,
            f1: true,
            precondition: ( DisposablesSnapshotStateContext.isEqualTo("pending"))
        });
    }
    run(accessor) {
        const editorService = accessor.get(IEditorService);
        const disposablesSnapshotStateContext = DisposablesSnapshotStateContext.bindTo(accessor.get(IContextKeyService));
        disposablesSnapshotStateContext.set("stopped");
        if (tracker) {
            const disposableLeaks = ( new Set());
            for (const disposable of ( new Set(tracker.computeLeakingDisposables(1000)?.leaks)) ?? []) {
                if (( trackedDisposables.has(disposable.value))) {
                    disposableLeaks.add(disposable);
                }
            }
            const leaks = tracker.computeLeakingDisposables(1000, Array.from(disposableLeaks));
            if (leaks) {
                editorService.openEditor({
                    resource: undefined,
                    contents: leaks.details
                });
            }
        }
        setDisposableTracker(null);
        tracker = undefined;
        trackedDisposables.clear();
    }
}
function managedSettingsSourceLabel(source) {
    switch (source) {
    case "server":
        return "GitHub Server API";
    case "nativeMdm":
        return "Native MDM";
    case "file":
        return "File (managed-settings.json)";
    case "none":
        return "None (no managed settings active)";
    }
}
function managedSettingsSourceShortLabel(source) {
    switch (source) {
    case "server":
        return "Server";
    case "nativeMdm":
        return "Native MDM";
    case "file":
        return "File";
    case "none":
        return "None";
    }
}
function jsonBlock(value) {
    return "```json\n" + JSON.stringify(value ?? {}, null, 2) + "\n```\n\n";
}
function managedValueCell(value) {
    if (value === undefined) {
        return "—";
    }
    return `\`${JSON.stringify(value).replace(/\|/g, "\\|")}\``;
}
const PROPERTY_VALUE_TABLE_HEADER = "| Property | Value |\n|----------|-------|\n";
class PolicyDiagnosticsAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.showPolicyDiagnostics",
            title: ( localize2(2992, "Policy Diagnostics")),
            category: Categories.Developer,
            f1: true
        });
    }
    async run(accessor) {
        const editorService = accessor.get(IEditorService);
        const configurationService = accessor.get(IConfigurationService);
        const productService = accessor.get(IProductService);
        const defaultAccountService = accessor.get(IDefaultAccountService);
        const authenticationService = accessor.get(IAuthenticationService);
        const authenticationAccessService = accessor.get(IAuthenticationAccessService);
        const policyService = accessor.get(IPolicyService);
        const accountPolicyGateService = accessor.get(IAccountPolicyGateService);
        let nativeManagedSettingsService;
        try {
            nativeManagedSettingsService = accessor.get(INativeManagedSettingsService);
        } catch {}
        let fileManagedSettingsService;
        try {
            fileManagedSettingsService = accessor.get(IFileManagedSettingsService);
        } catch {}
        const configurationRegistry = ( Registry.as(Extensions.Configuration));
        let content = "# VS Code Policy Diagnostics\n\n";
        content += "*WARNING: This file may contain sensitive information.*\n\n";
        content += "## System Information\n\n";
        content += PROPERTY_VALUE_TABLE_HEADER;
        content += `| Generated | ${( new Date()).toISOString()} |\n`;
        content += `| Product | ${productService.nameLong} ${productService.version} |\n`;
        content += `| Commit | ${productService.commit || "n/a"} |\n\n`;
        content += "## Account Information\n\n";
        try {
            const account = await defaultAccountService.getDefaultAccount();
            const sensitiveKeys = ["sessionId", "analytics_tracking_id"];
            if (account) {
                let username = "Unknown";
                let accountLabel = "Unknown";
                try {
                    const providerIds = authenticationService.getProviderIds();
                    for (const providerId of providerIds) {
                        const sessions = await authenticationService.getSessions(providerId);
                        const matchingSession = sessions.find(session => session.id === account.sessionId);
                        if (matchingSession) {
                            username = matchingSession.account.id;
                            accountLabel = matchingSession.account.label;
                            break;
                        }
                    }
                } catch (error) {}
                content += "### Default Account Summary\n\n";
                content += `**Account ID/Username**: ${username}\n\n`;
                content += `**Account Label**: ${accountLabel}\n\n`;
                content += "### Detailed Account Properties\n\n";
                content += PROPERTY_VALUE_TABLE_HEADER;
                for (const [key, value] of Object.entries(account)) {
                    if (value !== undefined && value !== null) {
                        let displayValue;
                        if (sensitiveKeys.includes(key)) {
                            displayValue = "***";
                        } else if (typeof value === "object") {
                            displayValue = JSON.stringify(value);
                        } else {
                            displayValue = String(value);
                        }
                        content += `| ${key} | ${displayValue} |\n`;
                    }
                }
                const policyData = defaultAccountService.policyData;
                content += `| policyData | ${policyData ? JSON.stringify(policyData) : "No Policy Data"} |\n`;
                content += "\n";
            } else {
                content += "*No default account configured*\n\n";
            }
        } catch (error) {
            content += `*Error retrieving account information: ${error}*\n\n`;
        }
        content += "## Account Policy Gate\n\n";
        try {
            const gateInfo = accountPolicyGateService.gateInfo;
            const approvedOrgsRaw = policyService.getPolicyValue(APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME);
            content += PROPERTY_VALUE_TABLE_HEADER;
            content += `| State | \`${gateInfo.state}\` |\n`;
            content += `| Reason | ${gateInfo.reason ? `\`${gateInfo.reason}\`` : "*n/a*"} |\n`;
            content += `| ${APPROVED_ACCOUNT_ORGANIZATIONS_POLICY_NAME} | ${approvedOrgsRaw !== undefined ? `\`${String(approvedOrgsRaw)}\`` : "*not set*"} |\n`;
            content += "\n";
            content += "**Legend**\n\n";
            content += "- `inactive`: gate disabled (no approved orgs configured) — policies behave as account data dictates.\n";
            content += "- `satisfied`: gate active and approved — account policy values flow normally.\n";
            content += "- `restricted`: gate active and not satisfied — opted-in policies forced to their restricted value.\n";
            content += "  - `noAccount`: no default account signed in.\n";
            content += "  - `wrongProvider`: signed in with a non-GitHub provider.\n";
            content += "  - `orgNotApproved`: signed in but account is not a member of any approved organization.\n";
            content += "  - `policyNotResolved`: signed in to an approved org but account-side policy data has not yet been fetched.\n\n";
        } catch (error) {
            content += `*Error retrieving account policy gate info: ${error}*\n\n`;
        }
        content += "## Managed Settings\n\n";
        const activeManagedSettingSources = ( new Map());
        try {
            const policyData = defaultAccountService.policyData;
            const serverManagedSettings = policyData?.managedSettings;
            const nativeManagedSettings = nativeManagedSettingsService?.managedSettings;
            const fileManagedSettings = fileManagedSettingsService?.managedSettings;
            const pick = pickManagedSettings(nativeManagedSettings, serverManagedSettings, fileManagedSettings);
            content += `**Active sources** (in precedence order): ${pick.activeSources.length > 0 ? ( pick.activeSources.map(managedSettingsSourceLabel)).join(", ") : managedSettingsSourceLabel("none")}\n\n`;
            content += "*Precedence is resolved per key: native MDM wins over the server endpoint, which wins over the file on disk. A key left unset by a higher channel is still filled in by a lower one.*\n\n";
            const parseErrors = [];
            const channelContributes = channel => pick.activeSources.includes(channel);
            content += "### Native MDM\n\n";
            content += PROPERTY_VALUE_TABLE_HEADER;
            content += `| Available | ${nativeManagedSettingsService ? "yes" : "no"} |\n`;
            content += `| Contributes winning keys | ${channelContributes("nativeMdm") ? "yes" : "no"} |\n\n`;
            if (nativeManagedSettingsService) {
                content += jsonBlock(nativeManagedSettings);
            }
            content += "### GitHub Server API\n\n";
            content += PROPERTY_VALUE_TABLE_HEADER;
            content += "| Endpoint | `/copilot_internal/managed_settings` |\n";
            const fetchStatus = defaultAccountService.managedSettingsFetchStatus;
            content += `| Last fetch | ${fetchStatus === null ? "*never*" : `\`${fetchStatus}\``} |\n`;
            const fetchedAt = defaultAccountService.managedSettingsFetchedAt;
            content += `| Last successful fetch | ${fetchedAt ? ( new Date(fetchedAt)).toLocaleString() : "*n/a*"} |\n`;
            content += `| Contributes winning keys | ${channelContributes("server") ? "yes" : "no"} |\n\n`;
            const rawResponse = defaultAccountService.managedSettingsRawResponse;
            if (isObject(rawResponse)) {
                adaptManagedSettings(rawResponse, message => parseErrors.push({
                    stage: "adapt",
                    message
                }));
                content += "**Raw response** (last successful fetch)\n\n";
                content += jsonBlock(rawResponse);
            }
            content += "**Normalized bag**\n\n";
            content += jsonBlock(serverManagedSettings);
            content += "### File (managed-settings.json)\n\n";
            content += PROPERTY_VALUE_TABLE_HEADER;
            content += `| Available | ${fileManagedSettingsService ? "yes" : "no"} |\n`;
            content += `| Contributes winning keys | ${channelContributes("file") ? "yes" : "no"} |\n\n`;
            if (fileManagedSettingsService) {
                content += jsonBlock(fileManagedSettings);
            }
            content += "### Resolution (per key)\n\n";
            if (pick.resolutions.size > 0) {
                content += "| Key | Effective | Winning Source | Native MDM | Server | File |\n";
                content += "|-----|-----------|----------------|------------|--------|------|\n";
                const channelValue = (resolution, channel) => {
                    const contribution = resolution.contributions.find(c => c.channel === channel);
                    if (!contribution) {
                        return "—";
                    }
                    const cell = managedValueCell(contribution.value);
                    return channel === resolution.source ? cell : `~~${cell}~~`;
                };
                for (const key of [...( pick.resolutions.keys())].sort()) {
                    const resolution = pick.resolutions.get(key);
                    content += `| ${key} | ${managedValueCell(resolution.value)} | ${managedSettingsSourceShortLabel(resolution.source)} | ${channelValue(resolution, "nativeMdm")} | ${channelValue(resolution, "server")} | ${channelValue(resolution, "file")} |\n`;
                }
                content += "\n";
                content += "*Struck-through values were supplied by a channel but overridden by a higher-precedence channel for that key.*\n\n";
            } else {
                content += "*No managed-settings keys are supplied by any channel.*\n\n";
            }
            const declaredDefinitions = {};
            for (const property of [...( Object.values(configurationRegistry.getConfigurationProperties())), ...( Object.values(configurationRegistry.getExcludedConfigurationProperties()))]) {
                const declared = property.policy?.managedSettings;
                if (declared) {
                    Object.assign(declaredDefinitions, declared);
                }
            }
            const effective = projectManagedSettings(pick.values, declaredDefinitions, message => parseErrors.push({
                stage: "project",
                message
            }));
            for (const key of ( Object.keys(effective))) {
                const resolution = pick.resolutions.get(key);
                if (resolution) {
                    activeManagedSettingSources.set(key, resolution.source);
                }
            }
            for (const key of [
                COPILOT_ENABLED_PLUGINS_KEY,
                COPILOT_STRICT_MARKETPLACES_KEY,
                COPILOT_EXTRA_MARKETPLACES_KEY
            ]) {
                const value = effective[key];
                if (typeof value !== "string") {
                    continue;
                }
                const jsonErrors = [];
                parse(value, jsonErrors);
                for (const e of jsonErrors) {
                    parseErrors.push({
                        stage: "parse",
                        message: `${key} @ offset ${e.offset}: ${getParseErrorMessage(e.error)}`
                    });
                }
            }
            content += "### Effective\n\n";
            content += jsonBlock(effective);
            content += `### Parse Errors (${parseErrors.length})\n\n`;
            if (parseErrors.length > 0) {
                content += "| Stage | Message |\n";
                content += "|-------|---------|\n";
                for (const {
                    stage,
                    message
                } of parseErrors) {
                    content += `| ${stage} | ${message.replace(/\|/g, "\\|")} |\n`;
                }
                content += "\n";
            }
        } catch (error) {
            content += `*Error rendering managed settings diagnostics: ${error}*\n\n`;
        }
        content += "## Policy-Controlled Settings\n\n";
        const policyConfigurations = configurationRegistry.getPolicyConfigurations();
        const policyReferenceConfigurations = configurationRegistry.getPolicyReferenceConfigurations();
        const configurationProperties = configurationRegistry.getConfigurationProperties();
        const excludedProperties = configurationRegistry.getExcludedConfigurationProperties();
        if (policyConfigurations.size > 0 || policyReferenceConfigurations.size > 0) {
            const appliedPolicy = [];
            const notAppliedPolicy = [];
            const collectPolicySetting = (policyName, settingKey) => {
                const property = configurationProperties[settingKey] ?? excludedProperties[settingKey];
                if (property) {
                    const inspectValue = configurationService.inspect(settingKey);
                    const settingInfo = {
                        name: policyName,
                        key: settingKey,
                        property,
                        inspection: inspectValue
                    };
                    if (inspectValue.policyValue !== undefined) {
                        appliedPolicy.push(settingInfo);
                    } else {
                        notAppliedPolicy.push(settingInfo);
                    }
                }
            };
            for (const [policyName, settingKey] of policyConfigurations) {
                collectPolicySetting(policyName, settingKey);
            }
            for (const [policyName, settingKeys] of policyReferenceConfigurations) {
                for (const settingKey of settingKeys) {
                    collectPolicySetting(policyName, settingKey);
                }
            }
            const policySourceMemo = ( new Map());
            const getPolicySource = policyName => {
                if (( policySourceMemo.has(policyName))) {
                    return policySourceMemo.get(policyName);
                }
                try {
                    const policyServiceConstructorName = policyService.constructor.name;
                    if (policyServiceConstructorName === "MultiplexPolicyService") {
                        const multiplexService = policyService;
                        if (multiplexService.policyServices) {
                            const componentServices = multiplexService.policyServices;
                            for (const service of componentServices) {
                                if (service.getPolicyValue && service.getPolicyValue(policyName) !== undefined) {
                                    policySourceMemo.set(policyName, service.constructor.name);
                                    return service.constructor.name;
                                }
                            }
                        }
                    }
                    return "";
                } catch {
                    return "Unknown";
                }
            };
            const gateInfo = accountPolicyGateService.gateInfo;
            const gateRestricted = gateInfo.state === AccountPolicyGateState.Restricted && gateInfo.reason !== AccountPolicyGateUnsatisfiedReason.PolicyNotResolved;
            const getRefinedPolicySource = item => {
                const declaredKeys = item.property.policy?.managedSettings ? ( Object.keys(item.property.policy.managedSettings)) : [];
                if (!gateRestricted) {
                    const winningSources = ( new Set());
                    for (const key of declaredKeys) {
                        const source = activeManagedSettingSources.get(key);
                        if (source) {
                            winningSources.add(source);
                        }
                    }
                    if (winningSources.size > 0) {
                        const ordered = MANAGED_SETTINGS_CHANNELS.filter(channel => ( winningSources.has(channel)));
                        return `Managed Settings: ${( ordered.map(managedSettingsSourceShortLabel)).join(", ")}`;
                    }
                }
                return getPolicySource(item.name);
            };
            content += "### Applied Policy\n\n";
            appliedPolicy.sort(
                (a, b) => getRefinedPolicySource(a).localeCompare(getRefinedPolicySource(b)) || a.name.localeCompare(b.name)
            );
            if (appliedPolicy.length > 0) {
                content += "| Setting Key | Policy Name | Policy Source | Managed Settings | Default Value | Current Value | Policy Value |\n";
                content += "|-------------|-------------|---------------|------------------|---------------|---------------|-------------|\n";
                for (const setting of appliedPolicy) {
                    const defaultValue = JSON.stringify(setting.property.default);
                    const currentValue = JSON.stringify(setting.inspection.value);
                    const policyValue = JSON.stringify(setting.inspection.policyValue);
                    const policySource = getRefinedPolicySource(setting);
                    const managedSettingsKeys = setting.property.policy?.managedSettings ? ( Object.keys(setting.property.policy.managedSettings)).join(", ") : "";
                    content += `| ${setting.key} | ${setting.name} | ${policySource} | ${managedSettingsKeys || "*n/a*"} | \`${defaultValue}\` | \`${currentValue}\` | \`${policyValue}\` |\n`;
                }
                content += "\n";
            } else {
                content += "*No settings are currently controlled by policies*\n\n";
            }
            content += "###  Non-applied Policy\n\n";
            if (notAppliedPolicy.length > 0) {
                content += "| Setting Key | Policy Name  \n";
                content += "|-------------|-------------|\n";
                for (const setting of notAppliedPolicy) {
                    content += `| ${setting.key} | ${setting.name}|\n`;
                }
                content += "\n";
            } else {
                content += "*All policy-controllable settings are currently being enforced*\n\n";
            }
        } else {
            content += "*No policy-controlled settings found*\n\n";
        }
        content += "## Authentication Information\n\n";
        try {
            const providerIds = authenticationService.getProviderIds();
            if (providerIds.length > 0) {
                content += "### Authentication Providers\n\n";
                content += "| Provider ID | Sessions | Accounts |\n";
                content += "|-------------|----------|----------|\n";
                for (const providerId of providerIds) {
                    try {
                        const sessions = await authenticationService.getSessions(providerId);
                        const accounts = ( sessions.map(session => session.account));
                        const uniqueAccounts = Array.from(( new Set(( accounts.map(account => account.label)))));
                        content += `| ${providerId} | ${sessions.length} | ${uniqueAccounts.join(", ") || "None"} |\n`;
                    } catch (error) {
                        content += `| ${providerId} | Error | ${error} |\n`;
                    }
                }
                content += "\n";
                content += "### Detailed Session Information\n\n";
                for (const providerId of providerIds) {
                    try {
                        const sessions = await authenticationService.getSessions(providerId);
                        if (sessions.length > 0) {
                            content += `#### ${providerId}\n\n`;
                            content += "| Account | Scopes | Extensions with Access |\n";
                            content += "|---------|--------|------------------------|\n";
                            for (const session of sessions) {
                                const accountName = session.account.label;
                                const scopes = session.scopes.join(", ") || "Default";
                                try {
                                    const allowedExtensions = authenticationAccessService.readAllowedExtensions(providerId, accountName);
                                    const extensionNames = ( allowedExtensions.filter(ext => ext.allowed !== false).map(ext => `${ext.name}${ext.trusted ? " (trusted)" : ""}`)).join(", ") || "None";
                                    content += `| ${accountName} | ${scopes} | ${extensionNames} |\n`;
                                } catch (error) {
                                    content += `| ${accountName} | ${scopes} | Error: ${error} |\n`;
                                }
                            }
                            content += "\n";
                        }
                    } catch (error) {
                        content += `#### ${providerId}\n*Error retrieving sessions: ${error}*\n\n`;
                    }
                }
            } else {
                content += "*No authentication providers found*\n\n";
            }
        } catch (error) {
            content += `*Error retrieving authentication information: ${error}*\n\n`;
        }
        await editorService.openEditor({
            resource: undefined,
            contents: content,
            languageId: "markdown",
            options: {
                pinned: true
            }
        });
    }
}
class SyncAccountPolicyAction extends Action2 {
    constructor() {
        super({
            id: "workbench.action.syncAccountPolicy",
            title: ( localize2(2993, "Sync Account Policy")),
            category: Categories.Developer,
            f1: true
        });
    }
    async run(accessor) {
        const defaultAccountService = accessor.get(IDefaultAccountService);
        const dialogService = accessor.get(IDialogService);
        const logService = accessor.get(ILogService);
        try {
            logService.info("[DefaultAccount] Manually syncing account policy");
            await defaultAccountService.refresh({
                forceRefresh: true
            });
            await dialogService.info(( localize(2994, "Account policy has been synced.")));
        } catch (error) {
            logService.error("[DefaultAccount] Failed to sync account policy", error);
            await dialogService.error(( localize(2995, "Failed to sync account policy.")), error instanceof Error ? error.message : String(error));
        }
    }
}
registerAction2(InspectContextKeysAction);
registerAction2(ToggleScreencastModeAction);
registerAction2(LogStorageAction);
registerAction2(LogWorkingCopiesAction);
registerAction2(RemoveLargeStorageEntriesAction);
registerAction2(PolicyDiagnosticsAction);
registerAction2(SyncAccountPolicyAction);
if (!product.commit) {
    registerAction2(StartTrackDisposables);
    registerAction2(SnapshotTrackedDisposables);
    registerAction2(StopTrackDisposables);
}
const configurationRegistry = ( Registry.as(Extensions.Configuration));
configurationRegistry.registerConfiguration({
    id: "screencastMode",
    order: 9,
    title: ( localize(2996, "Screencast Mode")),
    type: "object",
    properties: {
        "screencastMode.verticalOffset": {
            type: "number",
            default: 20,
            minimum: 0,
            maximum: 90,
            description: ( localize(
                2997,
                "Controls the vertical offset of the screencast mode overlay from the bottom as a percentage of the workbench height."
            ))
        },
        "screencastMode.fontSize": {
            type: "number",
            default: 56,
            minimum: 20,
            maximum: 100,
            description: ( localize(
                2998,
                "Controls the font size (in pixels) of the screencast mode keyboard."
            ))
        },
        "screencastMode.keyboardOptions": {
            type: "object",
            description: ( localize(2999, "Options for customizing the keyboard overlay in screencast mode.")),
            properties: {
                "showKeys": {
                    type: "boolean",
                    default: true,
                    description: ( localize(3000, "Show raw keys."))
                },
                "showKeybindings": {
                    type: "boolean",
                    default: true,
                    description: ( localize(3001, "Show keyboard shortcuts."))
                },
                "showCommands": {
                    type: "boolean",
                    default: true,
                    description: ( localize(3002, "Show command names."))
                },
                "showCommandGroups": {
                    type: "boolean",
                    default: false,
                    description: ( localize(3003, "Show command group names, when commands are also shown."))
                },
                "showSingleEditorCursorMoves": {
                    type: "boolean",
                    default: true,
                    description: ( localize(3004, "Show single editor cursor move commands."))
                }
            },
            default: {
                "showKeys": true,
                "showKeybindings": true,
                "showCommands": true,
                "showCommandGroups": false,
                "showSingleEditorCursorMoves": true
            },
            additionalProperties: false
        },
        "screencastMode.keyboardOverlayTimeout": {
            type: "number",
            default: 800,
            minimum: 500,
            maximum: 5000,
            description: ( localize(
                3005,
                "Controls how long (in milliseconds) the keyboard overlay is shown in screencast mode."
            ))
        },
        "screencastMode.mouseIndicatorColor": {
            type: "string",
            format: "color-hex",
            default: "#FF0000",
            description: ( localize(
                3006,
                "Controls the color in hex (#RGB, #RGBA, #RRGGBB or #RRGGBBAA) of the mouse indicator in screencast mode."
            ))
        },
        "screencastMode.mouseIndicatorSize": {
            type: "number",
            default: 20,
            minimum: 20,
            maximum: 100,
            description: ( localize(
                3007,
                "Controls the size (in pixels) of the mouse indicator in screencast mode."
            ))
        }
    }
});
