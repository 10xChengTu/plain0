import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IChatEntitlementService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/chat/common/chatEntitlementService.service";
import { IExtHostContext } from "../../services/extensions/common/extHostCustomers.js";
import { IQuotaSnapshotsDto, MainThreadChatQuotaShape } from "@codingame/monaco-vscode-api/vscode/vs/workbench/api/common/extHost.protocol";
export declare class MainThreadChatQuota extends Disposable implements MainThreadChatQuotaShape {
    private readonly _chatEntitlementService;
    constructor(extHostContext: IExtHostContext, _chatEntitlementService: IChatEntitlementService);
    $updateQuotas(quotas: IQuotaSnapshotsDto): void;
}
