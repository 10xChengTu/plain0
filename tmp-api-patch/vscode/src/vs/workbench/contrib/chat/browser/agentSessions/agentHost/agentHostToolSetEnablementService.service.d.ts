import { IObservable } from "../../../../../../base/common/observable.js";
import { IToolEnablementState } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostToolSetEnablementService";
export declare const IAgentHostToolSetEnablementService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostToolSetEnablementService>;
/**
* Per-session-type tool / tool-set enablement for the Chat Customizations → Tools section,
* persisted profile-wide. Settings are consumed by the agent host (the only target for Tools
* customizations today).
*/
export interface IAgentHostToolSetEnablementService {
    readonly _serviceBrand: undefined;
    /** Observable enablement state for `sessionType`. Missing keys default to enabled. */
    observe(sessionType: string): IObservable<IToolEnablementState>;
    /** Current enablement state for `sessionType`. */
    getState(sessionType: string): IToolEnablementState;
    /** Enable/disable a whole tool set; clears any per-tool overrides for its members. */
    setToolSetEnabled(sessionType: string, toolSetId: string, toolIds: readonly string[], enabled: boolean): void;
    /** Enable/disable a single tool within `toolSetId`. */
    setToolEnabled(sessionType: string, toolSetId: string, toolId: string, enabled: boolean): void;
}
