import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import { IOpenerService } from "@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import {
	ViewPane,
	type IViewPaneOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane";
import { IViewDescriptorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service";

import type { DebugStackFrame } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { getPlainDebugRuntime } from "./plain-debug-runtime";
import type { DebugSessionState } from "./plain-debug-session";

/**
 * `F100` S3's Call Stack view — self-built (per the frozen research doc's
 * "决策 3": no `debug-service-override` `CallStackView` import, no
 * `IDebugService`/`IViewModel` object graph; this reads
 * `DebugSessionController`'s own state and `debug_stack_trace` directly). A
 * `stopped` event (surfaced as `DebugSessionState.stoppedThreadId` becoming
 * non-`null`, via `onDidChangeState`) drives a real `debugStackTrace` fetch
 * and re-render — the panel is otherwise a plain "Running…"/"Not
 * debugging." status line. Selecting a frame writes to the shared
 * `DebugFrameSelection` (`plain-debug-runtime.ts`) the Variables/Watch views
 * read from — no direct dependency between the three views.
 *
 * No constructor parameter beyond `ViewPane`'s own base nine — this view
 * reports every error as inline status text (no `INotificationService`/
 * `IDialogService` needed), so it takes the same "zero own DI declarations,
 * constructor signature matches the base exactly" exemption
 * `validateViewPaneDependencyDecoratorBoundary` already recognizes for
 * `PlainGitGraphView`.
 */
export class PlainDebugCallStackView extends ViewPane {
	static readonly ID = "plain.workbench.view.debugCallStack";

	#messageElement: HTMLElement | undefined;
	#listElement: HTMLElement | undefined;
	#frames: readonly DebugStackFrame[] = [];
	#selectedFrameId: number | null = null;
	#stateSubscription: { dispose(): void } | undefined;
	#refreshToken = 0;

	constructor(
		options: IViewPaneOptions,
		keybindingService: IKeybindingService,
		contextMenuService: IContextMenuService,
		configurationService: IConfigurationService,
		contextKeyService: IContextKeyService,
		viewDescriptorService: IViewDescriptorService,
		instantiationService: IInstantiationService,
		openerService: IOpenerService,
		themeService: IThemeService,
		hoverService: IHoverService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add("plain-debug-call-stack-view-body");

		const message = document.createElement("div");
		message.className = "plain-debug-call-stack-view-message";
		message.setAttribute("role", "status");
		message.textContent = "Not debugging.";
		this.#messageElement = message;

		const list = document.createElement("ul");
		list.className = "plain-debug-call-stack-view-list";
		this.#listElement = list;

		container.append(message, list);

		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#stateSubscription = runtime.session.onDidChangeState((state) => {
			void this.#onStateChanged(state);
		});
		void this.#onStateChanged(runtime.session.state);
	}

	async #onStateChanged(state: DebugSessionState | null): Promise<void> {
		const token = (this.#refreshToken += 1);
		if (state === null) {
			this.#frames = [];
			this.#selectedFrameId = null;
			this.#setMessage("Not debugging.");
			this.#renderFrames();
			getPlainDebugRuntime()?.frameSelection.select(null);
			return;
		}
		if (state.stoppedThreadId === null) {
			this.#frames = [];
			this.#selectedFrameId = null;
			this.#setMessage("Running…");
			this.#renderFrames();
			getPlainDebugRuntime()?.frameSelection.select(null);
			return;
		}
		await this.#refresh(state.stoppedThreadId, token);
	}

	async #refresh(threadId: number, token: number): Promise<void> {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		try {
			const result = await runtime.session.stackTrace(threadId, null, null);
			if (token !== this.#refreshToken) {
				return;
			}
			this.#frames = result?.stackFrames ?? [];
			this.#setMessage(
				this.#frames.length === 0 ? "No call stack available." : undefined,
			);
		} catch (error) {
			if (token !== this.#refreshToken) {
				return;
			}
			this.#frames = [];
			this.#setMessage(normalizeCommandError(error).message);
		}
		const firstFrame = this.#frames[0];
		if (firstFrame !== undefined) {
			this.#selectFrame(firstFrame.id);
		} else {
			this.#selectedFrameId = null;
			runtime.frameSelection.select(null);
		}
		this.#renderFrames();
	}

	#selectFrame(frameId: number): void {
		this.#selectedFrameId = frameId;
		getPlainDebugRuntime()?.frameSelection.select(frameId);
		this.#renderFrames();
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	#renderFrames(): void {
		const list = this.#listElement;
		if (list === undefined) {
			return;
		}
		list.textContent = "";
		for (const frame of this.#frames) {
			const item = document.createElement("li");
			item.className = "plain-debug-call-stack-view-frame";
			if (frame.id === this.#selectedFrameId) {
				item.classList.add("plain-debug-call-stack-view-frame-selected");
			}
			const button = document.createElement("button");
			button.type = "button";
			button.className = "plain-debug-call-stack-view-frame-button";
			const location =
				frame.sourceName !== null
					? `${frame.sourceName}:${frame.line}`
					: `line ${frame.line}`;
			button.textContent = `${frame.name} (${location})`;
			this._register(
				addDisposableListener(button, "click", () => {
					this.#selectFrame(frame.id);
				}),
			);
			item.append(button);
			list.append(item);
		}
	}

	override dispose(): void {
		this.#stateSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugCallStackView.prototype);
