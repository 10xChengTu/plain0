import { CancellationToken } from "../../../../base/common/cancellation.js";
import { IDisposable } from "../../../../base/common/lifecycle.js";
import { IChatOutputItemRenderer, RegisterOptions, RenderOutputPartWebviewOptions, RenderedOutputPart, RenderCodeBlockWebviewOptions } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/workbench/contrib/chat/browser/chatOutputItemRenderer";
export declare const IChatOutputRendererService: import("../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatOutputRendererService>;
export interface IChatOutputRendererService {
    readonly _serviceBrand: undefined;
    registerRenderer(viewType: string, renderer: IChatOutputItemRenderer, options: RegisterOptions): IDisposable;
    hasCodeBlockRenderer(languageIdentifier: string): boolean;
    renderOutputPart(mime: string, data: Uint8Array, parent: HTMLElement, webviewOptions: RenderOutputPartWebviewOptions, token: CancellationToken): Promise<RenderedOutputPart>;
    renderCodeBlock(languageIdentifier: string, data: Uint8Array, parent: HTMLElement, webviewOptions: RenderCodeBlockWebviewOptions, token: CancellationToken): Promise<RenderedOutputPart>;
}
