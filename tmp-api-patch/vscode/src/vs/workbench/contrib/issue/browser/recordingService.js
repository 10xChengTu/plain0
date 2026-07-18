
import { Event } from '../../../../base/common/event.js';

var RecordingState;
(function(RecordingState) {
    RecordingState["Idle"] = "idle";
    RecordingState["Recording"] = "recording";
    RecordingState["Stopped"] = "stopped";
})(RecordingState || (RecordingState = {}));
class BrowserRecordingService {
    constructor() {
        this.isSupported = false;
        this.state = RecordingState.Idle;
        this.onDidChangeState = Event.None;
    }
    getSupportedFormats() {
        return [];
    }
    async startRecording(_mimeType) {
        throw ( new Error("Recording is not supported in web browsers."));
    }
    async stopRecording() {
        return undefined;
    }
    discardRecording() {}
    async getScreenCapturePermissionStatus() {
        return "granted";
    }
    openScreenCapturePermissionSettings() {}
}

export { BrowserRecordingService, RecordingState };
