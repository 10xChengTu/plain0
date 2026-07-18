import { IObservable } from "../../../../../../base/common/observable.js";
import { SessionActiveClient, ClientPluginCustomization, ToolDefinition } from "../../../../../../platform/agentHost/common/state/sessionState.js";
import { IAgentRegistration } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostActiveClientService";
export declare const IAgentHostActiveClientService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostActiveClientService>;
export interface IAgentHostActiveClientService {
    readonly _serviceBrand: undefined;
    /**
    * Constructs the per-sessionType {@link AgentCustomizationSyncProvider}
    * and {@link SyncedCustomizationBundler}, builds the `customizations`
    * observable from them, wires it to {@link IPromptsService} change events,
    * and resolves the initial value. Disposing the returned handle tears all
    * of that down. The created `syncProvider` is exposed on the returned
    * object so the contribution can pass the same instance to its
    * customization harness.
    */
    registerForAgent(sessionType: string): IAgentRegistration;
    /** Returns a {@link SessionActiveClient} for `sessionType` using the caller-supplied `clientId`. Customizations are empty when `sessionType` has not been registered. */
    getActiveClient(sessionType: string, clientId: string): SessionActiveClient;
    getCustomizations(sessionType: string): IObservable<readonly ClientPluginCustomization[]>;
    /**
    * Returns the tools this client advertises to the agent host for `sessionType`.
    *
    * Chat Customizations are the source of truth: a tool is advertised only when it is an enabled
    * member of a tool set surfaced in the Agents window Tools section (`deprecated !== true`).
    * Editor-only tool sets are not created in the Agents window. Enablement is tri-state per
    * {@link IAgentHostToolSetEnablementService}.
    */
    getClientTools(sessionType: string): IObservable<readonly ToolDefinition[]>;
}
