import { Event } from "../../../../base/common/event.js";
import { RecordingState, IRecordingData } from "./recordingService.js";
export declare const IRecordingService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IRecordingService>;
export interface IRecordingService {
    readonly _serviceBrand: undefined;
    /** Whether recording is supported on this platform. */
    readonly isSupported: boolean;
    /** Current recording state. */
    readonly state: RecordingState;
    /** Fires when recording state changes. */
    readonly onDidChangeState: Event<RecordingState>;
    /**
    * Returns the list of supported recording MIME types on this platform.
    */
    getSupportedFormats(): {
        mimeType: string;
        label: string;
        extension: string;
    }[];
    /**
    * Start recording the current window.
    * @param mimeType Optional preferred MIME type (e.g. 'video/mp4'). Falls back to default if unsupported.
    * Rejects if recording is not supported or already in progress.
    */
    startRecording(mimeType?: string): Promise<void>;
    /**
    * Stop the current recording.
    * Returns the recorded data, or undefined if no recording was in progress.
    */
    stopRecording(): Promise<IRecordingData | undefined>;
    /**
    * Discard the current recording without saving.
    */
    discardRecording(): void;
    /**
    * Returns the current OS screen-capture permission status. On platforms where this
    * concept doesn't apply (e.g. web) implementations return 'granted' so callers can
    * proceed straight to the recording flow.
    */
    getScreenCapturePermissionStatus(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
    /**
    * Opens the OS-level UI for granting screen-capture permission. No-op on platforms
    * where this isn't applicable.
    */
    openScreenCapturePermissionSettings(): void;
}
