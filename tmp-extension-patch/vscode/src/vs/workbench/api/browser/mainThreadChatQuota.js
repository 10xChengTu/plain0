
import { __decorate, __param } from '@codingame/monaco-vscode-api/external/tslib/tslib.es6';
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import { IChatEntitlementService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/chat/common/chatEntitlementService.service';
import { extHostNamedCustomer } from '../../services/extensions/common/extHostCustomers.js';
import { MainContext } from '@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol';

let MainThreadChatQuota = class MainThreadChatQuota extends Disposable {
    constructor(extHostContext, _chatEntitlementService) {
        super();
        this._chatEntitlementService = _chatEntitlementService;
    }
    $updateQuotas(quotas) {
        this._chatEntitlementService.acceptQuotas({
            ...this._chatEntitlementService.quotas,
            ...quotas
        });
    }
};
MainThreadChatQuota = __decorate([extHostNamedCustomer(MainContext.MainThreadChatQuota), ( __param(1, IChatEntitlementService))], MainThreadChatQuota);

export { MainThreadChatQuota };
