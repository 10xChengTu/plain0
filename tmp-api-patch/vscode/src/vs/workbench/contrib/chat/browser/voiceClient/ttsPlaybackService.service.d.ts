import { Event } from "../../../../../base/common/event.js";
export declare const ITtsPlaybackService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<ITtsPlaybackService>;
export interface ITtsPlaybackService {
    readonly _serviceBrand: undefined;
    /** Append a base64-encoded audio chunk for streaming playback. */
    playAudioChunk(audio: string, isFinal: boolean, window: Window & typeof globalThis): void;
    /** Stop any current playback immediately. */
    stopPlayback(): void;
    readonly isPlaying: boolean;
    readonly onPlaybackStarted: Event<void>;
    readonly onPlaybackStopped: Event<void>;
    /** Returns the PCM samples from the last completed playback turn, or null. */
    getLastPlayedSamples(): Float32Array | null;
    /** The playback AnalyserNode for visualisation, available during playback. */
    readonly analyserNode: AnalyserNode | undefined;
    /**
    * Ensure the playback AudioContext exists and is resumed.
    * Returns the AudioContext for callers that need it (e.g. pre-warming).
    */
    ensureContext(window: Window & typeof globalThis): AudioContext;
    /** Close the AudioContext entirely (for full teardown). */
    closeContext(): void;
}
