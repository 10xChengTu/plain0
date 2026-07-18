import { Event } from "../../../../../../base/common/event.js";
import { IChatInputNotification } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/browser/widget/input/chatInputNotificationService";
export declare const IChatInputNotificationService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatInputNotificationService>;
export interface IChatInputNotificationService {
    readonly _serviceBrand: undefined;
    readonly onDidChange: Event<void>;
    /** Fires when a notification is dismissed by the user (via the X button). */
    readonly onDidDismiss: Event<string>;
    /**
    * Set or update a notification. If a notification with the same ID already
    * exists, its content is replaced and any previous user dismissal is cleared.
    */
    setNotification(notification: IChatInputNotification): void;
    /**
    * Remove a notification entirely (e.g., when the extension disposes it).
    */
    deleteNotification(id: string): void;
    /**
    * Mark a notification as dismissed by the user. It will no longer be returned
    * by {@link getActiveNotification} until it is re-pushed with new content.
    */
    dismissNotification(id: string): void;
    /**
    * Get the single active notification to display. Returns the highest-severity
    * notification that has not been dismissed. Ties are broken by most-recent insertion.
    * An optional `filter` can be provided to restrict the set of notifications considered,
    * so a non-matching higher-priority notification doesn't mask other eligible ones.
    */
    getActiveNotification(filter?: (notification: IChatInputNotification) => boolean): IChatInputNotification | undefined;
    /**
    * Called when the user sends a chat message. Auto-dismisses all notifications
    * that have {@link IChatInputNotification.autoDismissOnMessage} set.
    */
    handleMessageSent(): void;
}
