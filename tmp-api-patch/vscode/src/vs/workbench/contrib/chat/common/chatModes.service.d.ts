import { IDisposable } from "../../../../base/common/lifecycle.js";
import { URI } from "../../../../base/common/uri.js";
import { IChatModes } from "./chatModes.js";
export declare const IChatModeService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatModeService>;
export interface IChatModeService {
    readonly _serviceBrand: undefined;
    /**
    * Returns the chat modes available for the given session resource.
    *
    * Instances need to be disposed by the caller when no longer needed
    */
    createModes(sessionResource: URI): IChatModes & IDisposable;
    /**
    * Returns the local chat modes after awaiting any in-flight refresh.
    */
    getLocalModes(): Promise<IChatModes>;
}
