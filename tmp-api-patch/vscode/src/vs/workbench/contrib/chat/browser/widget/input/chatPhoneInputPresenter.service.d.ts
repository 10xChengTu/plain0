import { IDisposable } from "../../../../../../base/common/lifecycle.js";
import { IObservable } from "../../../../../../base/common/observable.js";
import { IChatPhonePresenterImpl } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/browser/widget/input/chatPhoneInputPresenter";
import { IModelPickerDelegate } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/browser/widget/input/modelPickerActionItem";
import { IModePickerDelegate } from "@codingame/monaco-vscode-katex-common/vscode/vs/workbench/contrib/chat/browser/widget/input/modePickerActionItem";
export declare const IChatPhoneInputPresenter: import("../../../../../../platform/instantiation/common/instantiation.js").ServiceIdentifier<IChatPhoneInputPresenter>;
/**
* Workbench-layer hook for phone-only chat-input picker presentation.
*
* The default singleton is a no-op (`enabled === false`, sheet calls
* resolve immediately). The agents-window layer (`vs/sessions`) registers
* a real implementation via {@link setImpl} that opens the same bottom-
* sheet picker the empty new-chat input already uses.
*
* Workbench callers should:
*   1. Read `enabled.get()` to decide whether to render the standard
*      desktop pickers or hand off to the phone presenter.
*   2. Subscribe to `enabled` (e.g. via `autorun`) so the toolbar can be
*      refreshed when the phone state changes (rotation, etc.).
*/
export interface IChatPhoneInputPresenter {
    readonly _serviceBrand: undefined;
    /** `true` when an impl is registered AND it reports phone layout. */
    readonly enabled: IObservable<boolean>;
    /**
    * Show the unified phone-layout Mode + Model sheet. No-ops when
    * {@link enabled} is `false`.
    */
    showCombinedModeAndModelSheet(target: HTMLElement, modeDelegate: IModePickerDelegate | undefined, modelDelegate: IModelPickerDelegate | undefined): Promise<void>;
    /**
    * Register the phone implementation. Returns a disposable that removes
    * the registration. Only one impl is active at a time; the most recent
    * registration wins.
    */
    setImpl(impl: IChatPhonePresenterImpl): IDisposable;
}
