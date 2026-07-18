import { Event } from "../../../../../base/common/event.js";
import { IVoiceSessionContext, IVoicePriorTimelineEntry, IVoiceFeedbackPayload, IVoiceTranscription, IVoiceAudioResponse, IVoiceToolCall, IVoiceSpeechStarted, IVoiceSessionInit } from "./voiceClientService.js";
export interface IVoiceClientService {
    readonly _serviceBrand: undefined;
    connect(window: Window & typeof globalThis, authToken?: string): Promise<void>;
    disconnect(): void;
    sendPttStart(turnId: string): void;
    sendPttAudioChunk(audio: string): void;
    sendPttEnd(): void;
    /**
    * Send a per-press post-mortem diagnostic payload for tail-loss
    * investigation. Fired ~500ms after `pttUp` by the mic service.
    * `metrics` is an opaque object echoed straight into a structured
    * backend log keyed by `turnId`.
    */
    sendPttDiagnostic(turnId: string, metrics: Record<string, unknown>): void;
    sendSessionContext(context: IVoiceSessionContext): void;
    /**
    * Synchronously flush any pending debounced ``session_context`` delta on the
    * wire. Use this before sending a ``session_state_change`` so the backend
    * has the latest per-session ``last_response_summary`` / ``agent_state``
    * before it reacts to the state transition (e.g. to run summarisation).
    * Safe to call when no flush is pending — it just no-ops.
    */
    flushSessionContext(): void;
    /**
    * Clear the cached last-sent fields for a session so the next
    * ``_sendDelta`` treats it as a brand-new session (full field send).
    * Use when the confirmation detail changes within the same
    * ``agent_state`` — the normal merge-patch would strip the detail
    * because the state field itself didn't change.
    */
    invalidateSessionCache(sessionId: string): void;
    sendToolResult(callId: string, result: string): void;
    /**
    * Notify the backend of a session state transition.
    *
    * ``detail`` carries the human-readable description of the transition
    * (e.g. the confirmation prompt content for ``waiting_for_confirmation``)
    * and ``lastResponseSummary`` carries the agent's last response text for
    * ``idle`` transitions. Including them inline ensures the BE has the data
    * it needs to react/summarise without depending on the separate (debounced)
    * ``session_context`` delta arriving first or being current.
    */
    sendSessionStateChange(sessionId: string, newState: string, label: string, detail?: string, lastResponseSummary?: string): void;
    stopSpeaking(): void;
    sendStartSession(context: IVoiceSessionContext, machineId: string, priorTimeline?: readonly IVoicePriorTimelineEntry[]): void;
    sendResumeSession(context: IVoiceSessionContext, machineId: string): void;
    submitFeedback(payload: IVoiceFeedbackPayload): Promise<{
        ok: boolean;
        error?: string;
    }>;
    readonly onTranscription: Event<IVoiceTranscription>;
    readonly onAudioResponse: Event<IVoiceAudioResponse>;
    readonly onToolCall: Event<IVoiceToolCall>;
    readonly onSpeechStarted: Event<IVoiceSpeechStarted>;
    readonly onSessionInit: Event<IVoiceSessionInit>;
    readonly onError: Event<string>;
    readonly onDidChangeConnectionState: Event<boolean>;
    readonly isConnected: boolean;
    readonly isResuming: boolean;
    /** Backend session id assigned by the realtime server, or ``undefined`` when not yet established. */
    readonly currentSessionId: string | undefined;
}
export declare const IVoiceClientService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IVoiceClientService>;
