
import { localize } from '../../../../../nls.js';

const ScreenshotVariableId = "screenshot-focused-window";
function convertBufferToScreenshotVariable(buffer) {
    return {
        id: ScreenshotVariableId,
        name: ( localize(6230, "Screenshot")),
        value: buffer.buffer,
        kind: "image"
    };
}

export { ScreenshotVariableId, convertBufferToScreenshotVariable };
