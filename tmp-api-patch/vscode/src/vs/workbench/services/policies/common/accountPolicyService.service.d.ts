import { Event } from "../../../../base/common/event.js";
import { IAccountPolicyGateInfo } from "./accountPolicyService.js";
/**
* Read-only accessor for the Account Policy gate state. Backed by the same
* `AccountPolicyService` instance that drives policy enforcement, so UX consumers
* (notifications, context keys, telemetry) cannot drift from the authoritative
* gate decision.
*/
export declare const IAccountPolicyGateService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAccountPolicyGateService>;
export interface IAccountPolicyGateService {
    readonly _serviceBrand: undefined;
    readonly gateInfo: IAccountPolicyGateInfo;
    readonly onDidChangeGateInfo: Event<IAccountPolicyGateInfo>;
}
