import { Event } from "../../../../../../base/common/event.js";
import { URI } from "../../../../../../base/common/uri.js";
import { ResolveSessionConfigResult } from "../../../../../../platform/agentHost/common/state/protocol/commands.js";
export declare const IAgentHostUntitledProvisionalSessionService: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostUntitledProvisionalSessionService>;
/**
* LM contract: maintain one backend provisional session per untitled chat UI
* resource, and bridge it to the real chat UI resource before the first agent
* invocation. The contract is about backend `SessionState.config.values`, not
* UI rendering state.
*/
export interface IAgentHostUntitledProvisionalSessionService {
    readonly _serviceBrand: undefined;
    /**
    * Fires for the chat UI resource whose backend provisional mapping changed.
    * Picker listeners must re-read {@link get} and attach to the returned
    * backend URI, if any.
    */
    readonly onDidChange: Event<URI>;
    /**
    * Read the backend provisional URI currently mapped from `sessionResource`.
    * Returns `undefined` for resources that have not been provisioned or were
    * already disposed/rebound away.
    */
    get(sessionResource: URI): URI | undefined;
    /**
    * Ensure a backend provisional exists for an untitled chat UI resource.
    * Multiple picker chips may call this concurrently; implementation must keep
    * one create in flight per resource and return the same backend URI.
    */
    getOrCreate(sessionResource: URI, provider: string, workingDirectory: URI | undefined): Promise<URI | undefined>;
    /**
    * Wait for a pending {@link getOrCreate} for `sessionResource`, then return
    * the current mapping. Use this before reading/discarding a resource that may
    * still be racing with picker-triggered provisional creation.
    */
    waitForPending(sessionResource: URI): Promise<URI | undefined>;
    /**
    * Apply a partial config change to the backend provisional for an untitled
    * chat UI resource. Updates the workbench-owned config cache synchronously
    * (so a subsequent {@link tryRebind} sees the latest values without a
    * server roundtrip), creates the provisional if needed, then dispatches
    * `SessionConfigChanged` on the backend so the agent and other clients
    * pick up the change. Returns the backend URI on success.
    */
    applyConfigChange(sessionResource: URI, provider: string, workingDirectory: URI | undefined, partial: Record<string, unknown>): Promise<URI | undefined>;
    /**
    * Bridge the untitled chat UI resource to the real chat UI resource created
    * for first Send. Must copy `state.config.values` from the old backend
    * provisional into the new backend provisional before the handler invokes the
    * agent. No-op when no old mapping exists; idempotent when the new mapping is
    * already present.
    */
    tryRebind(oldSessionResource: URI, newSessionResource: URI, provider: string, workingDirectory: URI | undefined): Promise<URI | undefined>;
    /**
    * Dispose and forget the backend provisional mapped from `sessionResource`.
    * Safe after a successful rebind because the old mapping is already gone.
    */
    disposeSession(sessionResource: URI): Promise<void>;
    /**
    * Latest workbench-side re-resolved config (schema + values) for a chat
    * session, if any. Populated after a value change so dependent properties
    * refresh without a protocol-level schema-update channel.
    *
    * Both the schema and the values matter: `resolveSessionConfig` runs
    * `validateOrDefault`, which can clamp now-invalid values or inject
    * derived defaults the consumer should prefer over `state.config.values`.
    */
    getResolvedConfig(sessionResource: URI): ResolveSessionConfigResult | undefined;
    /**
    * Re-resolve config for an already-created chat session and cache the
    * schema/values overlay returned by the provider.
    */
    refreshResolvedConfig(sessionResource: URI, provider: string, workingDirectory: URI | undefined, config: Record<string, unknown> | undefined): Promise<void>;
}
