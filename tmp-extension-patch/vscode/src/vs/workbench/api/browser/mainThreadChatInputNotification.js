
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { IChatInputNotificationService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/chat/browser/widget/input/chatInputNotificationService.service';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';

let MainThreadChatInputNotification = class MainThreadChatInputNotification extends Disposable {
    constructor(_extHostContext, _chatInputNotificationService) {
        super();
        this._chatInputNotificationService = _chatInputNotificationService;
    }
    $setNotification(notification) {
        this._chatInputNotificationService.setNotification({
            id: notification.id,
            severity: notification.severity,
            message: notification.message,
            description: notification.description,
            actions: notification.actions,
            dismissible: notification.dismissible,
            autoDismissOnMessage: notification.autoDismissOnMessage
        });
    }
    $disposeNotification(id) {
        this._chatInputNotificationService.deleteNotification(id);
    }
};
MainThreadChatInputNotification = __decorate([
    extHostNamedCustomer(MainContext.MainThreadChatInputNotification),
    ( __param(1, IChatInputNotificationService))
], MainThreadChatInputNotification);

export { MainThreadChatInputNotification };
