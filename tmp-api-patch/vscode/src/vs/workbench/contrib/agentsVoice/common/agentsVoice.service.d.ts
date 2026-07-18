import { Event } from "../../../../base/common/event.js";
export declare const IAgentsVoiceWindowService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentsVoiceWindowService>;
export interface IAgentsVoiceWindowService {
    readonly _serviceBrand: undefined;
    /**
    * Whether the floating voice window is currently open.
    */
    readonly isOpen: boolean;
    /**
    * Fires when the window opens or closes.
    */
    readonly onDidChangeOpen: Event<boolean>;
    /**
    * Opens the floating voice window. No-op if already open.
    */
    openWindow(): Promise<void>;
    /**
    * Closes the floating voice window. No-op if already closed.
    */
    closeWindow(): void;
    /**
    * Toggles the floating voice window open/closed.
    */
    toggleWindow(): Promise<void>;
}
