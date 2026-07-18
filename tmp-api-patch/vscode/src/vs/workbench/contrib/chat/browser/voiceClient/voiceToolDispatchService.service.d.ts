import { IVoiceToolCall } from "../../common/voiceClient/voiceClientService.js";
import { IVoiceToolDispatchDelegate } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/voiceClient/voiceToolDispatchService";
export interface IVoiceToolDispatchService {
    readonly _serviceBrand: undefined;
    /**
    * Set the delegate that bridges widget/UI concerns.
    * Must be called before dispatching tool calls.
    */
    setDelegate(delegate: IVoiceToolDispatchDelegate): void;
    /**
    * Dispatch a tool call and return the result string.
    */
    dispatchToolCall(toolCall: IVoiceToolCall): Promise<string>;
}
export declare const IVoiceToolDispatchService: import("../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IVoiceToolDispatchService>;
