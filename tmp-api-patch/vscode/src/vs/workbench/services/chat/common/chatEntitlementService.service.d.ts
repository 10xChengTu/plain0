import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Event } from "../../../../base/common/event.js";
import { IObservable } from "../../../../base/common/observable.js";
import { ChatEntitlement, IQuotas, IChatSentiment } from "./chatEntitlementService.js";
export declare const IChatEntitlementService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatEntitlementService>;
export interface IChatEntitlementService {
    _serviceBrand: undefined;
    readonly onDidChangeEntitlement: Event<void>;
    readonly entitlement: ChatEntitlement;
    readonly entitlementObs: IObservable<ChatEntitlement>;
    readonly clientByokEnabled: boolean;
    readonly hasByokModels: boolean;
    readonly organisations: string[] | undefined;
    readonly isInternal: boolean;
    readonly sku: string | undefined;
    readonly copilotTrackingId: string | undefined;
    readonly onDidChangeQuotaExceeded: Event<void>;
    readonly onDidChangeQuotaRemaining: Event<void>;
    readonly onDidChangeUsageBasedBilling: Event<void>;
    readonly quotas: IQuotas;
    readonly onDidChangeSentiment: Event<void>;
    readonly sentiment: IChatSentiment;
    readonly sentimentObs: IObservable<IChatSentiment>;
    readonly onDidChangeAnonymous: Event<void>;
    readonly anonymous: boolean;
    readonly anonymousObs: IObservable<boolean>;
    acceptQuotas(quotas: IQuotas): void;
    /**
    * Clear all quota state.
    */
    clearQuotas(): void;
    markAnonymousRateLimited(): void;
    /**
    * Mark the chat setup flow as completed.
    */
    markSetupCompleted(): void;
    /**
    * Force the hidden state on or off, overriding the normal entitlement logic.
    * Used by the account policy gate to hide all AI features when the gate is
    * active and unsatisfied.
    */
    setForceHidden(hidden: boolean): void;
    update(token: CancellationToken): Promise<void>;
}
