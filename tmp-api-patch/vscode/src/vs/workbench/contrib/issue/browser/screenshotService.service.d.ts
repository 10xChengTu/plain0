import { IRectangle } from "../../../../platform/window/common/window.js";
export declare const IScreenshotService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IScreenshotService>;
export interface IScreenshotService {
    readonly _serviceBrand: undefined;
    /**
    * Captures a screenshot of the current window, optionally within a specified rectangle.
    * Returns a JPEG data URL, or undefined if capture is not supported.
    */
    captureScreenshot(rect?: IRectangle): Promise<string | undefined>;
}
