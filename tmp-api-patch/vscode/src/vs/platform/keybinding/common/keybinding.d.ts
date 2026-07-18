import { Event } from "../../../base/common/event.js";
import { IJSONSchema } from "../../../base/common/jsonSchema.js";
import { KeyCode } from "../../../base/common/keyCodes.js";
export interface IUserFriendlyKeybinding {
    key: string;
    command: string;
    args?: any;
    when?: string;
    /**
     * When `true`, the keybinding is registered as a system-wide (OS global) shortcut that fires
     * even when VS Code does not have focus. Desktop only; ignored on web/server. Only honored for
     * user `keybindings.json` entries (not extension-contributed keybindings).
     */
    systemWide?: boolean;
}
export interface IKeyboardEvent {
    readonly _standardKeyboardEventBrand: true;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    readonly altGraphKey: boolean;
    readonly keyCode: KeyCode;
    readonly code: string;
}
export interface KeybindingsSchemaContribution {
    readonly onDidChange?: Event<void>;
    getSchemaAdditions(): IJSONSchema[];
}
