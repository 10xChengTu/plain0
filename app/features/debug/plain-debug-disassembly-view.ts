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

import type { DebugDisassembledInstruction } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import {
	DISASSEMBLY_NO_INSTRUCTION_POINTER_MESSAGE,
	DISASSEMBLY_WINDOW_SIZE,
	disassemblySessionAvailability,
	isCurrentInstructionRow,
	nextDisassemblyOffset,
	type DisassemblyPageDirection,
} from "./plain-debug-disassembly-model";
import { getPlainDebugRuntime } from "./plain-debug-runtime";
import type { DebugSessionState } from "./plain-debug-session";

/**
 * `F210` S5's read-only Disassembly view — self-built exactly like
 * `PlainDebugCallStackView`/`PlainDebugVariablesView` (per the frozen
 * research doc's "决策 3": no vendor `debug-service-override` import, this
 * reads `DebugSessionController`'s own state and `debug_disassemble`
 * directly). Only ever populates while the debuggee is genuinely stopped and
 * the live session's own `Capabilities.supportsDisassembleRequest` is
 * `true`; every other case (no session, running, capability missing, or the
 * current stopped top frame reporting no `instructionPointerReference` at
 * all) shows an accurate placeholder line instead, with **zero** IPC beyond
 * the one bounded `debugStackTrace(threadId, 0, 1)` lookup needed to learn
 * whether that frame even has an instruction pointer in the first place (see
 * `#refreshAnchor`'s own doc comment for why that one lookup is
 * unavoidable, and is not counted against this view's own "zero
 * `debugDisassemble` calls while unavailable" contract).
 *
 * Deliberately anchors on the **top** stopped frame (`startFrame: 0`) via
 * its own independent `stackTrace` call, not on whichever frame
 * `PlainDebugCallStackView` currently has selected via the shared
 * `DebugFrameSelection` — this view must populate correctly even if the Call
 * Stack view has never been rendered at all (e.g. the user opened "Run and
 * Debug" on a different view, or navigated away from it, before running
 * "Plain: Open Disassembly"), so it cannot depend on a sibling `ViewPane`'s
 * own render lifecycle having already populated shared state. This is a
 * disclosed, deliberate design choice, not an oversight: it costs one extra
 * bounded `stackTrace` request `PlainDebugCallStackView` may already have
 * made for its own purposes, in exchange for this view never silently
 * failing to populate depending on sibling-view render order.
 *
 * Read-only throughout: no instruction-breakpoint affordance, no inline
 * source/location rendering (DAP's own `location`/`line`/`column` fields on
 * each instruction are never even decoded — see
 * `DebugDisassembledInstruction`'s own doc comment), and no
 * execution/write capability of any kind — see
 * `docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §5".
 *
 * No constructor parameter beyond `ViewPane`'s own base nine — same
 * "zero own DI declarations" exemption `PlainDebugCallStackView`'s own
 * class doc comment explains.
 */
export class PlainDebugDisassemblyView extends ViewPane {
	static readonly ID = "plain.workbench.view.debugDisassembly";

	#messageElement: HTMLElement | undefined;
	#listElement: HTMLElement | undefined;
	#upButton: HTMLButtonElement | undefined;
	#downButton: HTMLButtonElement | undefined;
	#instructions: readonly DebugDisassembledInstruction[] = [];
	#baseOffset = 0;
	#anchorMemoryReference: string | null = null;
	#loading = false;
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
		container.classList.add("plain-debug-disassembly-view-body");

		const toolbar = document.createElement("div");
		toolbar.className = "plain-debug-disassembly-view-toolbar";
		toolbar.setAttribute("role", "toolbar");
		toolbar.setAttribute("aria-label", "Disassembly paging");

		const upButton = this.#createToolbarButton(
			"Up",
			"plain-debug-disassembly-view-up",
			() => void this.#page("up"),
		);
		const downButton = this.#createToolbarButton(
			"Down",
			"plain-debug-disassembly-view-down",
			() => void this.#page("down"),
		);
		this.#upButton = upButton;
		this.#downButton = downButton;
		toolbar.append(upButton, downButton);

		const message = document.createElement("div");
		message.className = "plain-debug-disassembly-view-message";
		message.setAttribute("role", "status");
		message.textContent = "Not debugging.";
		this.#messageElement = message;

		const list = document.createElement("ul");
		list.className = "plain-debug-disassembly-view-list";
		this.#listElement = list;

		container.append(toolbar, message, list);
		this.#updateToolbar();

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
		button.className = `plain-debug-disassembly-view-toolbar-button ${className}`;
		button.textContent = label;
		button.disabled = true;
		this._register(addDisposableListener(button, "click", onClick));
		return button;
	}

	/** Up/Down are enabled only once a real disassembly window has actually
	 * loaded (a real anchor address is known) and no request is currently
	 * in flight — the single-in-flight half of this contract; the guard
	 * clause at the top of `#page` below is the other, defense-in-depth
	 * half (a disabled button should never be clickable, but a test or a
	 * stale event handler reference must not be able to bypass it either). */
	#updateToolbar(): void {
		const canPage = this.#anchorMemoryReference !== null && !this.#loading;
		if (this.#upButton !== undefined) {
			this.#upButton.disabled = !canPage;
		}
		if (this.#downButton !== undefined) {
			this.#downButton.disabled = !canPage;
		}
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	/** Resets to the "nothing loaded" placeholder state — every one of the
	 * S5 contract's placeholder cases (not debugging, running, capability
	 * missing, no instruction pointer) and every "stopped ended"
	 * transition (continue/step/session termination) routes through this
	 * single function. */
	#clear(message: string): void {
		this.#anchorMemoryReference = null;
		this.#instructions = [];
		this.#baseOffset = 0;
		this.#setMessage(message);
		this.#renderInstructions();
		this.#updateToolbar();
	}

	async #onStateChanged(state: DebugSessionState | null): Promise<void> {
		const token = (this.#refreshToken += 1);
		const availability = disassemblySessionAvailability(state);
		if (availability.reason !== undefined) {
			this.#clear(availability.reason);
			return;
		}
		await this.#refreshAnchor(availability.threadId, token);
	}

	/**
	 * Learns whether the current stopped top frame reports an
	 * `instructionPointerReference` at all — the S5 contract's fourth
	 * placeholder case, which (unlike the first three, checked by
	 * `disassemblySessionAvailability` with zero IPC) can only be answered
	 * by a real `debugStackTrace(threadId, 0, 1)` call: this domain has no
	 * other source for a frame's instruction pointer. This one bounded
	 * lookup is not counted against this view's own "zero IPC while
	 * unavailable" contract — it exists purely to *determine* whether this
	 * is the unavailable case, exactly as `PlainDebugCallStackView`'s own
	 * `#refresh` already needs an equivalent `stackTrace` call just to
	 * learn whether there is a call stack to show at all.
	 */
	async #refreshAnchor(threadId: number, token: number): Promise<void> {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		let instructionPointerReference: string | null;
		try {
			const result = await runtime.session.stackTrace(threadId, 0, 1);
			if (token !== this.#refreshToken) {
				return;
			}
			instructionPointerReference =
				result?.stackFrames[0]?.instructionPointerReference ?? null;
		} catch (error) {
			if (token !== this.#refreshToken) {
				return;
			}
			this.#clear(normalizeCommandError(error).message);
			return;
		}
		if (instructionPointerReference === null) {
			this.#clear(DISASSEMBLY_NO_INSTRUCTION_POINTER_MESSAGE);
			return;
		}
		if (instructionPointerReference === this.#anchorMemoryReference) {
			// Already anchored here (e.g. a harmless duplicate state
			// notification) — no need to redo the initial window load.
			return;
		}
		this.#anchorMemoryReference = instructionPointerReference;
		this.#baseOffset = 0;
		await this.#load(token);
	}

	async #page(direction: DisassemblyPageDirection): Promise<void> {
		if (this.#loading || this.#anchorMemoryReference === null) {
			return;
		}
		const token = (this.#refreshToken += 1);
		this.#baseOffset = nextDisassemblyOffset(this.#baseOffset, direction);
		await this.#load(token);
	}

	/** The one and only path that ever calls `debugDisassemble` — always a
	 * single bounded `DISASSEMBLY_WINDOW_SIZE`-instruction request anchored
	 * at `#anchorMemoryReference`. `#loading` disables both paging buttons
	 * for the request's whole duration (single in-flight). */
	async #load(token: number): Promise<void> {
		const runtime = getPlainDebugRuntime();
		const memoryReference = this.#anchorMemoryReference;
		if (runtime === undefined || memoryReference === null) {
			return;
		}
		this.#loading = true;
		this.#updateToolbar();
		try {
			const result = await runtime.session.disassemble(
				memoryReference,
				this.#baseOffset,
				DISASSEMBLY_WINDOW_SIZE,
			);
			if (token !== this.#refreshToken) {
				return;
			}
			this.#instructions = result?.instructions ?? [];
			this.#setMessage(
				this.#instructions.length === 0
					? "No instructions available."
					: undefined,
			);
		} catch (error) {
			if (token !== this.#refreshToken) {
				return;
			}
			this.#instructions = [];
			this.#setMessage(normalizeCommandError(error).message);
		} finally {
			if (token === this.#refreshToken) {
				this.#loading = false;
				this.#updateToolbar();
			}
		}
		this.#renderInstructions();
	}

	#renderInstructions(): void {
		const list = this.#listElement;
		if (list === undefined) {
			return;
		}
		list.textContent = "";
		this.#instructions.forEach((instruction, index) => {
			const item = document.createElement("li");
			item.className = "plain-debug-disassembly-view-instruction";
			if (isCurrentInstructionRow(this.#baseOffset, index)) {
				item.classList.add("plain-debug-disassembly-view-instruction-current");
			}
			const address = document.createElement("span");
			address.className = "plain-debug-disassembly-view-address";
			address.textContent = instruction.address;
			const bytes = document.createElement("span");
			bytes.className = "plain-debug-disassembly-view-bytes";
			bytes.textContent = instruction.instructionBytes ?? "";
			const text = document.createElement("span");
			text.className = "plain-debug-disassembly-view-instruction-text";
			text.textContent =
				instruction.symbol !== null
					? `${instruction.instruction} (${instruction.symbol})`
					: instruction.instruction;
			item.append(address, bytes, text);
			list.append(item);
		});
	}

	override dispose(): void {
		this.#stateSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugDisassemblyView.prototype);
