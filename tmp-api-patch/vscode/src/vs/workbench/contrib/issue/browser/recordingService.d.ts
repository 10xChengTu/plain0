import { Event } from "../../../../base/common/event.js";
import { IRecordingService } from "./recordingService.service.js";
export interface IRecordingData {
    /** The raw video data as a Blob. */
    readonly blob: Blob;
    /** MIME type of the recording, e.g. 'video/webm'. */
    readonly mimeType: string;
    /** Duration in milliseconds. */
    readonly durationMs: number;
    /** File size in bytes. */
    readonly sizeBytes: number;
    /** True if the recording was automatically stopped because it hit the file size limit. */
    readonly stoppedBySize?: boolean;
}
export declare enum RecordingState {
    Idle = "idle",
    Recording = "recording",
    Stopped = "stopped"
}
/**
 * Browser fallback — recording not available in web.
 */
export declare class BrowserRecordingService implements IRecordingService {
    readonly _serviceBrand: undefined;
    readonly isSupported = false;
    readonly state = RecordingState.Idle;
    readonly onDidChangeState: Event<any>;
    getSupportedFormats(): {
        mimeType: string;
        label: string;
        extension: string;
    }[];
    startRecording(_mimeType?: string): Promise<void>;
    stopRecording(): Promise<IRecordingData | undefined>;
    discardRecording(): void;
    getScreenCapturePermissionStatus(): Promise<"granted">;
    openScreenCapturePermissionSettings(): void;
}
