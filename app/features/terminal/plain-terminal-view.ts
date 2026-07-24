import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import { IOpenerService } from "@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import {
	ViewPane,
	type IViewPaneOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane";
import { IViewDescriptorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service";

import type { PlainBridge } from "../../platform/tauri/contracts";
import {
	openTerminalStream,
	type TerminalStream,
} from "../../platform/tauri/terminal-stream";
import {
	encodeTerminalKeyEvent,
	TerminalImeController,
} from "./plain-terminal-input";
import { PlainTerminalRenderer } from "./plain-terminal-renderer";
import {
	resolveTerminalTrust,
	TERMINAL_TRUST_DECLINED_STATUS_MESSAGE,
	TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE,
} from "./plain-terminal-trust";

/**
 * Plain's own, hand-written terminal view pane (F070 "WebView DOM 渲染 +
 * trust UX") — built from scratch on the bare `ViewPane` base class, the
 * same precedent `PlainSearchView` established (see that file's own module
 * doc comment): Plain never imports
 * `@codingame/monaco-vscode-terminal-service-override` or xterm.js at all
 * (see `docs/research/2026-07-24-libghostty-terminal.md`'s background
 * section for why — that package's own import graph unconditionally
 * registers Chat/Copilot-CLI/Extensions/SCM-chat commands, independently
 * confirmed by a real Playwright bootstrap run against
 * `enforceExcludedWorkbenchSurfaces()`).
 *
 * # Bridge wiring
 *
 * Like `plain-search-service.ts`'s `configurePlainSearchBridge`, the
 * `PlainBridge` this view needs cannot be a normal constructor parameter
 * (the DI container has no way to supply it) — `configurePlainTerminalBridge`
 * must be called exactly once, before this view is ever rendered, mirroring
 * that same established pattern.
 *
 * # Session lifecycle (this slice: exactly one session per view instance)
 *
 * `layoutBody` (not a `ResizeObserver` on this view's own container) is the
 * resize signal this view acts on: `ViewPane`/`Pane` already receives a
 * `layoutBody(height, width)` call from the Workbench's own SplitView/Panel
 * layout pipeline whenever this view's allotted space changes (initial
 * layout, a sash drag, a window resize, …) — adding a second, independent
 * `ResizeObserver` alongside that would just be a redundant, potentially
 * racing signal for the same underlying event. The very first `layoutBody`
 * call (which is also the first time this view's body has a real,
 * non-zero size) is what actually starts the session — not `renderBody`,
 * whose container may still be zero-sized at that point.
 *
 * No reconnect/persistence story exists yet (deliberately out of scope —
 * see the research doc's "不做" list): disposing this view kills its
 * session outright.
 */
export class PlainTerminalView extends ViewPane {
	static readonly ID = "plain.workbench.view.terminal";

	/** Guards async continuations (trust resolution, `terminalStart`) from
	 * touching state after this view has been disposed — the same pattern
	 * `PlainSearchView` uses for its own in-flight search. */
	#generation = 0;
	#started = false;

	#renderer: PlainTerminalRenderer | undefined;
	#stream: TerminalStream | undefined;
	#statusElement: HTMLElement | undefined;
	#surfaceElement: HTMLElement | undefined;
	#inputElement: HTMLTextAreaElement | undefined;
	readonly #ime = new TerminalImeController();
	#lastRequestedCols = 0;
	#lastRequestedRows = 0;

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
		private readonly dialogService: IDialogService,
		private readonly workspaceContextService: IWorkspaceContextService,
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
		container.classList.add("plain-terminal-view-body");

		const status = document.createElement("div");
		status.className = "plain-terminal-status";
		status.setAttribute("role", "status");

		const surface = document.createElement("div");
		surface.className = "plain-terminal-surface-wrapper";

		// The single always-focused, visually hidden input surface: real
		// `keydown`/`keyup`/`compositionstart`/`compositionupdate`/
		// `compositionend`/`paste` events all need an editable element to
		// fire reliably (a plain non-editable `<div>` does not reliably
		// trigger IME composition in every browser) — the same "hidden
		// textarea" technique most from-scratch terminal front-ends use.
		const input = document.createElement("textarea");
		input.className = "plain-terminal-input";
		input.setAttribute("aria-label", "Terminal input");
		input.setAttribute("autocomplete", "off");
		input.setAttribute("autocorrect", "off");
		input.setAttribute("autocapitalize", "off");
		input.setAttribute("spellcheck", "false");
		input.setAttribute("wrap", "off");
		input.rows = 1;

		container.append(status, surface, input);
		this.#statusElement = status;
		this.#surfaceElement = surface;
		this.#inputElement = input;

		this.#renderer = new PlainTerminalRenderer({
			container: surface,
			onFramePainted: (sequence) => {
				void this.#stream?.ack(sequence);
			},
		});

		this.#registerInputListeners(input);

		this._register(
			toDisposable(() => {
				this.#generation += 1;
				const stream = this.#stream;
				this.#stream = undefined;
				if (stream !== undefined) {
					stream.dispose();
					stream.kill(false).catch(() => {});
				}
				this.#renderer?.dispose();
			}),
		);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		const surface = this.#surfaceElement;
		if (surface === undefined || this.#renderer === undefined) {
			return;
		}
		surface.style.width = `${width}px`;
		surface.style.height = `${height}px`;

		const cellSize = this.#renderer.measureCellSizePx();
		// A pane can be asked to lay out at a transient zero size — most
		// commonly the very first `layoutBody` call, fired while the Panel
		// reveal/expand animation has not yet settled to its real size (VS
		// Code's own layout pipeline lays out every part, including ones
		// still mid-reveal). Dividing by a zero-width probe measurement
		// would otherwise produce `NaN`/`Infinity` cols/rows, which
		// `frozenTerminalStartRequest`/`frozenTerminalResizeRequest` rightly
		// reject as an invalid request — skip entirely and wait for the
		// next, real `layoutBody` call instead of ever sending one.
		if (
			width <= 0 ||
			height <= 0 ||
			!Number.isFinite(cellSize.width) ||
			!Number.isFinite(cellSize.height) ||
			cellSize.width <= 0 ||
			cellSize.height <= 0
		) {
			return;
		}
		const cols = Math.max(1, Math.floor(width / cellSize.width));
		const rows = Math.max(1, Math.floor(height / cellSize.height));

		if (!this.#started) {
			this.#started = true;
			this.#lastRequestedCols = cols;
			this.#lastRequestedRows = rows;
			void this.startSession(cols, rows);
			return;
		}
		if (cols !== this.#lastRequestedCols || rows !== this.#lastRequestedRows) {
			this.#lastRequestedCols = cols;
			this.#lastRequestedRows = rows;
			void this.#stream?.resize(cols, rows);
		}
	}

	override focus(): void {
		super.focus();
		this.#inputElement?.focus();
	}

	private async startSession(cols: number, rows: number): Promise<void> {
		const generation = this.#generation;
		const bridge = requireTerminalBridge();
		const isEmptyWorkspace =
			this.workspaceContextService.getWorkspace().folders.length === 0;

		const decision = await resolveTerminalTrust(
			bridge,
			this.dialogService,
			isEmptyWorkspace,
		);
		if (generation !== this.#generation) {
			return;
		}
		if (decision.kind === "empty-workspace") {
			this.#showStatus(TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE);
			return;
		}
		if (decision.kind === "declined") {
			this.#showStatus(TERMINAL_TRUST_DECLINED_STATUS_MESSAGE);
			return;
		}
		this.#showStatus(undefined);

		const stream = await openTerminalStream(
			bridge,
			{ cwd: null, cols, rows },
			{
				onFrame: (frame, sequence) => {
					if (generation !== this.#generation) {
						return;
					}
					this.#renderer?.applyFrame(frame, sequence);
				},
				onExit: () => {
					// This slice renders no explicit "process exited" banner yet
					// (see the class doc comment's "out of scope" note) — the
					// last painted frame simply stays on screen. `onFrame` may
					// still fire after this — see `terminal-stream.ts`'s own doc
					// comment — so nothing is torn down here.
				},
			},
		);
		if (generation !== this.#generation) {
			stream.dispose();
			stream.kill(false).catch(() => {});
			return;
		}
		this.#stream = stream;
		void stream.focus(true);
		this.#inputElement?.focus();
	}

	#showStatus(message: string | undefined): void {
		const status = this.#statusElement;
		if (status === undefined) {
			return;
		}
		status.textContent = message ?? "";
	}

	#registerInputListeners(input: HTMLTextAreaElement): void {
		const forwardKey = (
			event: KeyboardEvent,
			direction: "down" | "up",
		): void => {
			if (this.#ime.active) {
				return;
			}
			const encoded = encodeTerminalKeyEvent(event, direction);
			if (encoded === null) {
				return;
			}
			event.preventDefault();
			void this.#stream?.writeKey(
				encoded.action,
				encoded.key,
				encoded.mods,
				encoded.utf8,
			);
		};

		this._register(
			addDisposableListener(input, "keydown", (event) => {
				forwardKey(event, "down");
			}),
		);
		this._register(
			addDisposableListener(input, "keyup", (event) => {
				forwardKey(event, "up");
			}),
		);
		this._register(
			addDisposableListener(input, "compositionstart", () => {
				this.#ime.start();
			}),
		);
		this._register(
			addDisposableListener(input, "compositionupdate", (event) => {
				// `event.data` is typed as a non-nullable `string` by the DOM
				// lib, but defensively coerced here anyway — a synthetic
				// composition event (browser automation, or a future
				// non-conforming platform) is not guaranteed to actually carry
				// one.
				this.#ime.update({ data: event.data ?? "" });
			}),
		);
		this._register(
			addDisposableListener(input, "compositionend", (event) => {
				const text = this.#ime.end({ data: event.data ?? "" });
				input.value = "";
				if (text.length > 0) {
					void this.#stream?.writeText(text);
				}
			}),
		);
		this._register(
			addDisposableListener(input, "paste", (event) => {
				event.preventDefault();
				const text = event.clipboardData?.getData("text/plain") ?? "";
				if (text.length > 0) {
					void this.#stream?.writeText(text);
				}
			}),
		);
		// Fallback catch-all: normal typing is always prevented at `keydown`
		// (so it never reaches the textarea's own value) and paste is
		// handled above, so this should only ever fire for an edge case
		// (e.g. a platform committing IME text without a `compositionend`,
		// or a drag-and-drop text drop) — see the module doc's IME section.
		this._register(
			addDisposableListener(input, "input", () => {
				if (this.#ime.active) {
					return;
				}
				const { value } = input;
				if (value.length > 0) {
					input.value = "";
					void this.#stream?.writeText(value);
				}
			}),
		);
		this._register(
			addDisposableListener(input, "focus", () => {
				void this.#stream?.focus(true);
			}),
		);
		this._register(
			addDisposableListener(input, "blur", () => {
				void this.#stream?.focus(false);
			}),
		);
	}
}

let configuredBridge: PlainBridge | undefined;

/**
 * Wires the Tauri/browser-mock bridge into `PlainTerminalView` without
 * adding a non-service constructor parameter the DI container cannot
 * supply automatically — the same pattern as
 * `plain-search-service.ts`'s `configurePlainSearchBridge`. Must be called
 * exactly once, before this view is ever rendered.
 */
export function configurePlainTerminalBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

function requireTerminalBridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"PlainTerminalView was used before configurePlainTerminalBridge",
		);
	}
	return configuredBridge;
}

Object.freeze(PlainTerminalView.prototype);

IKeybindingService(PlainTerminalView, undefined, 1);
IContextMenuService(PlainTerminalView, undefined, 2);
IConfigurationService(PlainTerminalView, undefined, 3);
IContextKeyService(PlainTerminalView, undefined, 4);
IViewDescriptorService(PlainTerminalView, undefined, 5);
IInstantiationService(PlainTerminalView, undefined, 6);
IOpenerService(PlainTerminalView, undefined, 7);
IThemeService(PlainTerminalView, undefined, 8);
IHoverService(PlainTerminalView, undefined, 9);
IDialogService(PlainTerminalView, undefined, 10);
IWorkspaceContextService(PlainTerminalView, undefined, 11);
