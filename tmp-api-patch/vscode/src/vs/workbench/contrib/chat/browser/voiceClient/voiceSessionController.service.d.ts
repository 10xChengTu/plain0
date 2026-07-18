import { IObservable } from "../../../../../base/common/observable.js";
import { URI } from "../../../../../base/common/uri.js";
import { VoiceState, ITranscriptTurn, IPendingToolConfirmation } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/voiceClient/voiceSessionController";
export interface IVoiceSessionController {
    readonly _serviceBrand: undefined;
    readonly voiceState: IObservable<VoiceState>;
    readonly statusText: IObservable<string>;
    /** Rolling buffer of the last 2 transcript turns (oldest first). */
    readonly transcriptTurns: IObservable<readonly ITranscriptTurn[]>;
    readonly isConnected: IObservable<boolean>;
    readonly isConnecting: IObservable<boolean>;
    readonly isReconnecting: IObservable<boolean>;
    readonly pendingToolConfirmations: IObservable<readonly IPendingToolConfirmation[]>;
    /** The session resource that transcriptions will be sent to. undefined = active session. */
    readonly targetSession: IObservable<URI | undefined>;
    connect(window: Window & typeof globalThis): Promise<void>;
    disconnect(): void;
    pttDown(): void;
    pttUp(): void;
    /**
    * Mark a session as having been cancelled by the user from VS Code UI. The
    * next state-change detected for this session (typically the chat model
    * transitioning to `idle`) will be suppressed so the backend doesn't
    * narrate a status update the user already knows about.
    */
    markUserCancelled(sessionId: string): void;
    /**
    * Set the target session for transcription. When set, transcriptions are
    * sent to this session instead of the currently active one.
    */
    setTargetSession(resource: URI | undefined): void;
    /**
    * Create a new chat session and set it as the target for transcription.
    */
    newSessionAsTarget(): void;
    /**
    * Submit user feedback along with full diagnostic data (transcript history,
    * client state, environment info). Returns success/failure.
    */
    submitFeedback(feedbackText: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** DEV ONLY: Simulate a connected session with fake transcript for UI testing. */
    simulateConnection(): void;
}
export declare const IVoiceSessionController: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IVoiceSessionController>;
