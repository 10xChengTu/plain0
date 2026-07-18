import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IChatInputNotificationService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/browser/widget/input/chatInputNotificationService.service";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
import { ChatInputNotificationDto, MainThreadChatInputNotificationShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
export declare class MainThreadChatInputNotification extends Disposable implements MainThreadChatInputNotificationShape {
    private readonly _chatInputNotificationService;
    constructor(_extHostContext: IExtHostContext, _chatInputNotificationService: IChatInputNotificationService);
    $setNotification(notification: ChatInputNotificationDto): void;
    $disposeNotification(id: string): void;
}
