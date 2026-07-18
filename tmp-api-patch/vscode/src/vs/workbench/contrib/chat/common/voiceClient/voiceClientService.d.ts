/**
 * Session context sent to the voice server for grounding.
 */
export interface IVoiceSessionContext {
    sessions: {
        id: string;
        is_active: boolean;
        agent_state: string;
        agent_state_detail?: string;
        last_response_summary?: string;
    }[];
    active_session?: {
        id: string;
        last_message: string | null;
    };
    display_locale?: string;
}
/**
 * Inbound message types emitted by the voice client service.
 */
export interface IVoiceTranscription {
    readonly text: string;
    readonly status?: "partial" | "final";
    readonly committed?: string;
}
export interface IVoiceAudioResponse {
    readonly audio: string;
    readonly isFirstChunk: boolean;
    readonly isFinal: boolean;
    readonly codingSessionId?: string;
    readonly transcript?: string;
}
export interface IVoiceToolCall {
    readonly callId: string;
    readonly name: string;
    readonly args: Record<string, unknown>;
}
export interface IVoiceSpeechStarted {
}
export interface IVoiceSessionInit {
    readonly sessionId: string;
}
/**
 * One entry in the cross-session timeline the FE replays to the BE on
 * ``start_session``. The BE's coding_agent renders these into a
 * ``[PRIOR_CONTEXT]`` block on the *first* command after reconnect so the
 * model can answer "what were we doing?" / "remember xyz?" without any
 * server-side persistence.
 *
 * Kinds:
 *   user_voice         — what the user said
 *   agent_voice        — what the voice agent spoke back
 *   agent_tool_call    — a tool the voice agent dispatched (send_to_chat, etc.)
 *   coding_event       — a coding-session status transition
 *                        (e.g. ``thinking → waiting_for_confirmation``)
 *   coding_agent_reply — first ~2 sentences of the latest Copilot Chat
 *                        response per active session (synthesized
 *                        FE-side at connect time, never persisted to disk)
 */
export type IVoicePriorTimelineKind = "user_voice" | "agent_voice" | "agent_tool_call" | "coding_event" | "coding_agent_reply";
export interface IVoicePriorTimelineEntry {
    readonly kind: IVoicePriorTimelineKind;
    /** ISO 8601 wall-clock time of the entry. Used for chronological ordering. */
    readonly timestamp: string;
    /**
     * Human/LLM-readable one-line summary. The BE renders this directly
     * into the prompt without further parsing.
     */
    readonly text: string;
    /** Tool name for ``agent_tool_call`` entries (also encoded inside ``text``). */
    readonly toolName?: string;
    /** Originating coding-session id for ``coding_event`` / ``coding_agent_reply``. */
    readonly codingSessionId?: string;
    /** Status string for ``coding_event`` (e.g. ``thinking``, ``idle``). */
    readonly codingStatus?: string;
}
/**
 * Payload sent to the backend for a user-initiated feedback submission.
 */
export interface IVoiceFeedbackPayload {
    readonly feedbackText: string;
    readonly machineId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly submissionId: string;
    readonly transcriptHistory: readonly IVoiceFeedbackTranscriptTurn[];
    readonly clientSessionState: Record<string, unknown>;
    readonly clientEnvironment: Record<string, unknown>;
    readonly timestamp: string;
}
export interface IVoiceFeedbackTranscriptTurn {
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly timestamp: string;
}
