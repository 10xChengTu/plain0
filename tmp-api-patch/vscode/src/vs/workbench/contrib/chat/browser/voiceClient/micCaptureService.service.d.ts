import { Event } from "../../../../../base/common/event.js";
import { IPttDiagnostic } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/voiceClient/micCaptureService";
export declare const IMicCaptureService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IMicCaptureService>;
export interface IMicCaptureService {
    readonly _serviceBrand: undefined;
    /**
    * Store a window reference for later lazy mic acquisition without actually
    * acquiring the microphone. The mic is acquired on `pttDown()` and released
    * on `pttUp()`.
    */
    prepare(window: Window & typeof globalThis): void;
    /** Start capturing audio from the microphone. */
    startCapture(window: Window & typeof globalThis): Promise<void>;
    /** Stop capturing and release mic resources. */
    stopCapture(): void;
    readonly isCapturing: boolean;
    /** Fired when a PTT segment begins (mic ready). */
    readonly onPttStart: Event<void>;
    /** Fired during PTT hold with base64-encoded raw PCM16 chunks. */
    readonly onPttAudioChunk: Event<string>;
    /** Fired when a PTT segment ends. All chunks have been sent before this fires. */
    readonly onPttEnd: Event<void>;
    /**
    * Fired after the diagnostic window closes (~1s after `pttUp`) with
    * per-press telemetry. Always fires AFTER `onPttEnd` for normal
    * presses. Used for tail-loss diagnosis; safe to ignore for normal
    * operation.
    */
    readonly onPttDiagnostic: Event<IPttDiagnostic>;
    /** The AnalyserNode for visualisation, available while capturing. */
    readonly analyserNode: AnalyserNode | undefined;
    /**
    * Begin a PTT segment. Lazily acquires the microphone if not already
    * capturing. Returns a promise that resolves once the mic is ready to
    * record (or rejects if acquisition fails).
    *
    * `turnId` is an opaque per-press identifier propagated into the
    * eventual `onPttDiagnostic` payload for correlation with backend logs.
    * Pass empty string when no correlation is needed.
    */
    pttDown(turnId: string): Promise<void>;
    /**
    * End a PTT segment. Sends any remaining audio chunks, then fires pttEnd.
    */
    pttUp(): void;
    isMuted: boolean;
    /** Suppress mic output until the given timestamp (AEC gating). */
    suppressUntil(timestamp: number): void;
}
