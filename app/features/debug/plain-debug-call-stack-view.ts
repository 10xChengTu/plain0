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

import type {
	DebugStackFrame,
	DebugThread,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { getPlainDebugRuntime } from "./plain-debug-runtime";
import type { DebugSessionState } from "./plain-debug-session";

/**
 * `F100` S3's Call Stack view — self-built (per the frozen research doc's
 * "决策 3": no `debug-service-override` `CallStackView` import, no
 * `IDebugService`/`IViewModel` object graph; this reads
 * `DebugSessionController`'s own state and `debug_threads`/`debug_stack_trace`
 * directly). A
 * `stopped` event (surfaced as `DebugSessionState.stoppedThreadId` becoming
 * non-`null`, via `onDidChangeState`) first drives a real `debugThreads`
 * snapshot, then a `debugStackTrace` fetch for only the selected thread —
 * the panel is otherwise a plain "Running…"/"Not debugging." status line.
 * Selecting a frame writes to the shared
 * `DebugFrameSelection` (`plain-debug-runtime.ts`) the Variables/Watch views
 * read from — no direct dependency between the three views.
 *
 * `F100` S4` adds the step-control toolbar here (reusing this same view's
 * existing `onDidChangeState` wiring rather than "另起炉灶" a separate
 * view/service, per this slice's own task instructions) — five buttons
 * (Continue/Pause/Step Over/Step Into/Step Out) whose enabled state is
 * derived purely from `DebugSessionState`: Continue/Step Over/Step
 * Into/Step Out require `stoppedThreadId !== null` (there must be a
 * concrete stopped thread to resume/step from — this is what the real DAP
 * protocol requires, not an invented capability gate; see this view's own
 * `#stepIn`/`#stepOut`/etc. handlers' doc comments for why `Capabilities`
 * itself defines no `supportsStepIn`/`supportsContinue`/etc. field for these
 * five baseline, protocol-mandatory requests), while Pause requires the
 * debuggee to be *running* (`stoppedThreadId === null`) and a previously
 * observed thread id to target (`lastKnownThreadId !== null`). Clicking
 * Continue/a step button does **not** itself trigger a call-stack refresh —
 * the existing `stopped` event will, once (if) the adapter emits one, via
 * the exact same `#onStateChanged` path a real `stopped` already drives
 * (see the module's own "复用 S3 的 stopped 事件联动" instruction).
 *
 * `F210` S4 adds the `stepInTargets` target picker as its own separate
 * command ("Plain: Step Into Target…", `plain-debug-commands.ts`) rather
 * than a feature of this toolbar's Step Into *button* — that button's own
 * `#stepIn` handler below is entirely unchanged by that slice and still
 * never selects a target, matching every other baseline step-control button
 * here (none of the five take a caller-chosen argument beyond the implicit
 * thread).
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
	#threads: readonly DebugThread[] = [];
	#threadsTruncated = false;
	#selectedThreadId: number | null = null;
	#frames: readonly DebugStackFrame[] = [];
	#selectedFrameId: number | null = null;
	#stateSubscription: { dispose(): void } | undefined;
	#refreshToken = 0;
	#continueButton: HTMLButtonElement | undefined;
	#pauseButton: HTMLButtonElement | undefined;
	#nextButton: HTMLButtonElement | undefined;
	#stepInButton: HTMLButtonElement | undefined;
	#stepOutButton: HTMLButtonElement | undefined;

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

		const toolbar = document.createElement("div");
		toolbar.className = "plain-debug-call-stack-view-toolbar";
		toolbar.setAttribute("role", "toolbar");
		toolbar.setAttribute("aria-label", "Debug execution control");

		const continueButton = this.#createToolbarButton(
			"Continue",
			"plain-debug-call-stack-view-continue",
			() => void this.#continue(),
		);
		const pauseButton = this.#createToolbarButton(
			"Pause",
			"plain-debug-call-stack-view-pause",
			() => void this.#pause(),
		);
		const nextButton = this.#createToolbarButton(
			"Step Over",
			"plain-debug-call-stack-view-next",
			() => void this.#next(),
		);
		const stepInButton = this.#createToolbarButton(
			"Step Into",
			"plain-debug-call-stack-view-step-in",
			() => void this.#stepIn(),
		);
		const stepOutButton = this.#createToolbarButton(
			"Step Out",
			"plain-debug-call-stack-view-step-out",
			() => void this.#stepOut(),
		);
		this.#continueButton = continueButton;
		this.#pauseButton = pauseButton;
		this.#nextButton = nextButton;
		this.#stepInButton = stepInButton;
		this.#stepOutButton = stepOutButton;
		toolbar.append(
			continueButton,
			pauseButton,
			nextButton,
			stepInButton,
			stepOutButton,
		);

		const message = document.createElement("div");
		message.className = "plain-debug-call-stack-view-message";
		message.setAttribute("role", "status");
		message.textContent = "Not debugging.";
		this.#messageElement = message;

		const list = document.createElement("ul");
		list.className = "plain-debug-call-stack-view-list";
		this.#listElement = list;

		container.append(toolbar, message, list);
		this.#updateToolbar(null);

		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#stateSubscription = runtime.session.onDidChangeState((state) => {
			void this.#onStateChanged(state);
		});
		void this.#onStateChanged(runtime.session.state);
	}

	#createToolbarButton(
		label: string,
		className: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `plain-debug-call-stack-view-toolbar-button ${className}`;
		button.textContent = label;
		button.disabled = true;
		this._register(addDisposableListener(button, "click", onClick));
		return button;
	}

	/**
	 * Derives each button's enabled state purely from `state` — see the class
	 * doc's own explanation of why Continue/Step Over/Step Into/Step Out need
	 * a concrete stopped thread (`stoppedThreadId`) while Pause needs the
	 * debuggee to be running with a previously observed thread
	 * (`lastKnownThreadId`). No `Capabilities` field gates any of these five:
	 * real DAP defines `continue`/`next`/`stepIn`/`stepOut`/`pause` as
	 * mandatory baseline requests every adapter must implement (unlike the
	 * genuinely optional `stepInTargets` target picker, gated by
	 * `supportsStepInTargetsRequest` — `F210` S4 builds that as its own
	 * separate "Plain: Step Into Target…" command, not a feature of this
	 * toolbar) — both real adapters this project captured
	 * (`lldb-dap`/`debugpy`) confirm this: neither reports any
	 * `supportsStepIn`/`supportsContinue`/etc. field at all in its
	 * `initialize` response.
	 */
	#updateToolbar(state: DebugSessionState | null): void {
		const stopped = state?.stoppedThreadId ?? null;
		const canStepFromStopped = stopped !== null;
		const canPause =
			state !== null && stopped === null && state.lastKnownThreadId !== null;
		if (this.#continueButton !== undefined) {
			this.#continueButton.disabled = !canStepFromStopped;
		}
		if (this.#nextButton !== undefined) {
			this.#nextButton.disabled = !canStepFromStopped;
		}
		if (this.#stepInButton !== undefined) {
			this.#stepInButton.disabled = !canStepFromStopped;
		}
		if (this.#stepOutButton !== undefined) {
			this.#stepOutButton.disabled = !canStepFromStopped;
		}
		if (this.#pauseButton !== undefined) {
			this.#pauseButton.disabled = !canPause;
		}
	}

	/**
	 * Every one of these five handlers must catch its own bridge call's
	 * rejection (a real, expected outcome — an adapter rejecting a step
	 * request because the debuggee is not actually stopped, e.g. — not a bug)
	 * rather than letting it become an unhandled promise rejection: F090 S0's
	 * own recorded lesson is that an uncaught rejection here would pollute
	 * this shared page and produce failures in entirely unrelated later
	 * tests. Reported via the same inline status line
	 * `#refresh`/`#onStateChanged` already use for stack-trace/adapter
	 * errors, so a real rejection is still visible to the user, not silently
	 * swallowed.
	 */
	async #runStepCommand(
		action: () => Promise<unknown> | undefined,
	): Promise<void> {
		try {
			await action();
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
	}

	async #continue(): Promise<void> {
		const state = getPlainDebugRuntime()?.session.state;
		if (
			state?.stoppedThreadId === undefined ||
			state.stoppedThreadId === null
		) {
			return;
		}
		const threadId = state.stoppedThreadId;
		await this.#runStepCommand(() =>
			getPlainDebugRuntime()?.session.continue_(threadId),
		);
	}

	async #next(): Promise<void> {
		const state = getPlainDebugRuntime()?.session.state;
		if (
			state?.stoppedThreadId === undefined ||
			state.stoppedThreadId === null
		) {
			return;
		}
		const threadId = state.stoppedThreadId;
		await this.#runStepCommand(() =>
			getPlainDebugRuntime()?.session.next(threadId),
		);
	}

	async #stepIn(): Promise<void> {
		const state = getPlainDebugRuntime()?.session.state;
		if (
			state?.stoppedThreadId === undefined ||
			state.stoppedThreadId === null
		) {
			return;
		}
		const threadId = state.stoppedThreadId;
		await this.#runStepCommand(() =>
			getPlainDebugRuntime()?.session.stepIn(threadId),
		);
	}

	async #stepOut(): Promise<void> {
		const state = getPlainDebugRuntime()?.session.state;
		if (
			state?.stoppedThreadId === undefined ||
			state.stoppedThreadId === null
		) {
			return;
		}
		const threadId = state.stoppedThreadId;
		await this.#runStepCommand(() =>
			getPlainDebugRuntime()?.session.stepOut(threadId),
		);
	}

	async #pause(): Promise<void> {
		const state = getPlainDebugRuntime()?.session.state;
		if (
			state?.lastKnownThreadId === undefined ||
			state.lastKnownThreadId === null
		) {
			return;
		}
		const threadId = state.lastKnownThreadId;
		await this.#runStepCommand(() =>
			getPlainDebugRuntime()?.session.pause(threadId),
		);
	}

	async #onStateChanged(state: DebugSessionState | null): Promise<void> {
		this.#updateToolbar(state);
		const token = (this.#refreshToken += 1);
		if (state === null) {
			this.#threads = [];
			this.#threadsTruncated = false;
			this.#selectedThreadId = null;
			this.#frames = [];
			this.#selectedFrameId = null;
			this.#setMessage("Not debugging.");
			this.#renderFrames();
			getPlainDebugRuntime()?.frameSelection.select(null);
			return;
		}
		if (state.stoppedThreadId === null) {
			this.#threads = [];
			this.#threadsTruncated = false;
			this.#selectedThreadId = null;
			this.#frames = [];
			this.#selectedFrameId = null;
			this.#setMessage("Running…");
			this.#renderFrames();
			getPlainDebugRuntime()?.frameSelection.select(null);
			return;
		}
		await this.#refreshThreadsAndStack(state.stoppedThreadId, token);
	}

	async #refreshThreadsAndStack(
		stoppedThreadId: number,
		token: number,
	): Promise<void> {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) return;
		try {
			const result = await runtime.session.threads();
			if (token !== this.#refreshToken) return;
			const threads = result?.threads ?? [];
			const includesStopped = threads.some(
				(thread) => thread.id === stoppedThreadId,
			);
			this.#threads = includesStopped
				? threads
				: [
						{ id: stoppedThreadId, name: `Thread ${stoppedThreadId}` },
						...threads.slice(0, 4_095),
					];
			this.#threadsTruncated =
				(result?.truncated ?? false) ||
				(!includesStopped && threads.length >= 4_096);
			this.#selectedThreadId = stoppedThreadId;
		} catch (error) {
			if (token !== this.#refreshToken) return;
			this.#threads = [];
			this.#threadsTruncated = false;
			this.#selectedThreadId = null;
			this.#frames = [];
			this.#setMessage(normalizeCommandError(error).message);
			this.#renderFrames();
			return;
		}
		await this.#refresh(stoppedThreadId, token);
	}

	async #selectThread(threadId: number): Promise<void> {
		if (this.#selectedThreadId === threadId) return;
		this.#selectedThreadId = threadId;
		this.#selectedFrameId = null;
		this.#frames = [];
		getPlainDebugRuntime()?.frameSelection.select(null);
		this.#setMessage("Loading call stack…");
		this.#renderFrames();
		const token = (this.#refreshToken += 1);
		await this.#refresh(threadId, token);
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
		for (const thread of this.#threads) {
			const item = document.createElement("li");
			item.className = "plain-debug-call-stack-view-thread";
			if (thread.id === this.#selectedThreadId) {
				item.classList.add("plain-debug-call-stack-view-thread-selected");
			}
			const button = document.createElement("button");
			button.type = "button";
			button.className = "plain-debug-call-stack-view-thread-button";
			button.textContent = thread.name;
			button.setAttribute("aria-label", `Thread ${thread.name}`);
			button.setAttribute(
				"aria-expanded",
				String(thread.id === this.#selectedThreadId),
			);
			button.addEventListener("click", () => {
				void this.#selectThread(thread.id);
			});
			item.append(button);
			list.append(item);
			if (thread.id === this.#selectedThreadId) {
				for (const frame of this.#frames) {
					const frameItem = document.createElement("li");
					frameItem.className = "plain-debug-call-stack-view-frame";
					if (frame.id === this.#selectedFrameId) {
						frameItem.classList.add(
							"plain-debug-call-stack-view-frame-selected",
						);
					}
					const frameButton = document.createElement("button");
					frameButton.type = "button";
					frameButton.className = "plain-debug-call-stack-view-frame-button";
					const location =
						frame.sourceName !== null
							? `${frame.sourceName}:${frame.line}`
							: `line ${frame.line}`;
					frameButton.textContent = `${frame.name} (${location})`;
					if (frame.id === this.#selectedFrameId) {
						frameButton.setAttribute("aria-current", "true");
					}
					this._register(
						addDisposableListener(frameButton, "click", () => {
							this.#selectFrame(frame.id);
						}),
					);
					frameItem.append(frameButton);
					list.append(frameItem);
				}
			}
		}
		if (this.#threadsTruncated) {
			const truncated = document.createElement("li");
			truncated.className = "plain-debug-call-stack-view-truncated";
			truncated.textContent = "Showing the first 4096 threads only.";
			list.append(truncated);
		}
	}

	override dispose(): void {
		this.#stateSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugCallStackView.prototype);
