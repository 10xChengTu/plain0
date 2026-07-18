import type * as vscode from "vscode";
import * as extHostProtocol from "./extHost.protocol.js";
import { IExtensionDescription } from "../../../platform/extensions/common/extensions.js";
export declare class ExtHostChatInputNotification {
    private readonly _proxy;
    private readonly _items;
    constructor(mainContext: extHostProtocol.IMainContext);
    createInputNotification(extension: IExtensionDescription, id: string): vscode.ChatInputNotification;
}
