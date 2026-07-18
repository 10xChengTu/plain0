import { IObservable } from "../../../../base/common/observable.js";
import { URI } from "../../../../base/common/uri.js";
import { IVoicePlaybackEntry } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/common/voicePlaybackService";
export declare const IVoicePlaybackService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IVoicePlaybackService>;
/**
* Tracks voice playback state for chat sessions: which session is currently
* speaking, and what the last played message was for each session. Used by
* the agent sessions view to highlight the speaking row and to drive the
* "Replay Last Played" action.
*
* Playback is reported by the voice agent webview through the workbench
* commands `_chat.voicePlayback.notifyStart` / `_chat.voicePlayback.notifyEnd`.
*/
export interface IVoicePlaybackService {
    readonly _serviceBrand: undefined;
    /**
    * The session resource currently being spoken aloud, or `undefined` if
    * playback is generic (no session id from the backend) or stopped.
    */
    readonly speakingSession: IObservable<URI | undefined>;
    /**
    * Increments whenever the per-session last-played map changes. Consumers
    * can subscribe via `read(reader)` to refresh state without us exposing
    * the underlying `ResourceMap`.
    */
    readonly lastPlayedVersion: IObservable<number>;
    /**
    * Records the start of a TTS playback. When `sessionResource` is undefined,
    * the audio is generic and no per-session state is updated.
    */
    notifyPlaybackStart(sessionResource: URI | undefined, transcript: string | undefined): void;
    notifyPlaybackEnd(sessionResource: URI | undefined): void;
    getLastPlayed(sessionResource: URI): IVoicePlaybackEntry | undefined;
    hasLastPlayed(sessionResource: URI): boolean;
    /**
    * Replays the last played message for `sessionResource` by re-synthesizing
    * the saved transcript through the registered speech provider. Resolves
    * once playback completes (or immediately when there is nothing to replay
    * or no speech provider is available).
    */
    replay(sessionResource: URI): Promise<void>;
    /**
    * Stops any active playback for the given session (or all playback if
    * no session is specified).
    */
    stop(sessionResource?: URI): void;
}
