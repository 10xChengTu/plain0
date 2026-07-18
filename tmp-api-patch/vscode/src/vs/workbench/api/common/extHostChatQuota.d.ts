import { Disposable } from "../../../base/common/lifecycle.js";
import { ExtHostChatQuotaShape, IMainContext, IQuotaSnapshotsDto } from "./extHost.protocol.js";
export declare class ExtHostChatQuota extends Disposable implements ExtHostChatQuotaShape {
    private readonly _proxy;
    constructor(mainContext: IMainContext);
    updateQuotas(quotas: IQuotaSnapshotsDto): void;
}
