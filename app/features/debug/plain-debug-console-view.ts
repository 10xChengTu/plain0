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

import type { DebugEventPayload } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { getPlainDebugRuntime } from "./plain-debug-runtime";

/** DAP's own `OutputEvent.body.category` enum (spec-documented values), plus
 * the "absent" case, which the spec defines as defaulting to `"console"`.
 * `"telemetry"` is deliberately not a rendered category at all — see
 * `#appendOutputEvent`'s own doc comment. */
type OutputCategory =
	"console" | "important" | "stdout" | "stderr" | "telemetry";

function outputCategoryFromBody(body: unknown): OutputCategory | undefined {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return undefined;
	}
	const category = (body as Record<string, unknown>).category;
	if (category === undefined) {
		// Per spec: "the client should show this message." with no
		// `category` at all is equivalent to `"console"`.
		return "console";
	}
	if (
		category === "console" ||
		category === "important" ||
		category === "stdout" ||
		category === "stderr" ||
		category === "telemetry"
	) {
		return category;
	}
	return undefined;
}

function outputTextFromBody(body: unknown): string | undefined {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return undefined;
	}
	const output = (body as Record<string, unknown>).output;
	return typeof output === "string" ? output : undefined;
}

interface ConsoleLine {
	readonly kind: "input" | "result" | "error" | OutputCategory;
	readonly text: string;
}

/**
 * `F100` S4's Debug Console / REPL view — self-built (per the frozen
 * research doc's "决策 3": "自建,用 Monaco standalone editor 做输入框 + 简单
 * 输出列表"). **Deliberate simplification, disclosed rather than silent**:
 * the input line here is a plain `<input>`, matching every other text-entry
 * surface this feature has already built (`plain-debug-watch-view.ts`'s
 * expression box, `plain-debug-breakpoints-contribution.ts`'s condition/log-
 * message popup) rather than a Monaco standalone editor instance — the
 * frozen doc's own suggestion was a technical option for syntax highlighting,
 * not a locked requirement, and this domain has zero other precedent for
 * mounting a standalone Monaco editor outside the main editor grid; a plain
 * input keeps this view's own dependency surface and testing story identical
 * to its three siblings.
 *
 * Two independent data flows populate this view's output list, both wired
 * through `DebugSessionController`'s already-existing plumbing (no new event
 * channel):
 *
 * 1. **User-submitted expressions** — Enter in the input calls
 *    `runtime.session.evaluate(expression, frameSelection.frameId, "repl")`
 *    (the first real `"repl"` caller in this codebase; `"watch"` was the
 *    only context ever exercised before this slice) and appends the
 *    submitted expression plus its result (or thrown error) as two lines.
 * 2. **`output` DAP events** — `runtime.session.onEvent` (already built by
 *    S3, previously with zero consumers) is filtered to `event === "output"`
 *    and rendered by `category`: `stdout`/`stderr`/`console`/`important` all
 *    appear (each with its own CSS class so a caller can tell them apart
 *    visually), but `telemetry` is **never rendered at all** — per this
 *    slice's own task instructions, telemetry categories are adapter-
 *    internal usage/analytics data, not something a user asked to see.
 *
 * No constructor parameter beyond `ViewPane`'s own base nine — same
 * zero-own-declarations exemption `PlainDebugCallStackView`'s own doc
 * comment explains.
 */
export class PlainDebugConsoleView extends ViewPane {
	static readonly ID = "plain.workbench.view.debugConsole";

	#outputElement: HTMLElement | undefined;
	#inputElement: HTMLInputElement | undefined;
	readonly #lines: ConsoleLine[] = [];
	#eventSubscription: { dispose(): void } | undefined;

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
		container.classList.add("plain-debug-console-view-body");

		const output = document.createElement("ul");
		output.className = "plain-debug-console-view-output";
		output.setAttribute("role", "log");
		this.#outputElement = output;

		const inputRow = document.createElement("div");
		inputRow.className = "plain-debug-console-view-input-row";
		const input = document.createElement("input");
		input.type = "text";
		input.className = "plain-debug-console-view-input";
		input.placeholder = "Evaluate an expression…";
		input.setAttribute("aria-label", "Debug Console input");
		this.#inputElement = input;
		this._register(
			addDisposableListener(input, "keydown", (event: KeyboardEvent) => {
				if (event.key === "Enter") {
					void this.#submit();
				}
			}),
		);
		inputRow.append(input);

		container.append(output, inputRow);

		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#eventSubscription = runtime.session.onEvent((event) => {
			this.#handleEvent(event);
		});
	}

	async #submit(): Promise<void> {
		const input = this.#inputElement;
		if (input === undefined) {
			return;
		}
		const expression = input.value.trim();
		if (expression.length === 0) {
			return;
		}
		input.value = "";
		this.#pushLine({ kind: "input", text: expression });
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		try {
			const result = await runtime.session.evaluate(
				expression,
				runtime.frameSelection.frameId,
				"repl",
			);
			if (result === undefined) {
				this.#pushLine({ kind: "error", text: "Not debugging." });
				return;
			}
			const text =
				result.type !== null
					? `${result.result} (${result.type})`
					: result.result;
			this.#pushLine({ kind: "result", text });
		} catch (error) {
			this.#pushLine({
				kind: "error",
				text: normalizeCommandError(error).message,
			});
		}
	}

	/**
	 * `telemetry` is intentionally excluded from `#pushLine` entirely — it
	 * never becomes a `ConsoleLine`, never touches `#outputElement`, and
	 * cannot be recovered by any later state change; this is the "本应不展示
	 * 给用户" requirement enforced structurally, not just visually hidden via
	 * CSS.
	 */
	#handleEvent(event: DebugEventPayload): void {
		if (event.event !== "output") {
			return;
		}
		const category = outputCategoryFromBody(event.body);
		if (category === undefined || category === "telemetry") {
			return;
		}
		const text = outputTextFromBody(event.body);
		if (text === undefined) {
			return;
		}
		this.#pushLine({ kind: category, text });
	}

	#pushLine(line: ConsoleLine): void {
		this.#lines.push(line);
		this.#renderLine(line);
	}

	#renderLine(line: ConsoleLine): void {
		const output = this.#outputElement;
		if (output === undefined) {
			return;
		}
		const item = document.createElement("li");
		item.className = `plain-debug-console-view-line plain-debug-console-view-line-${line.kind}`;
		item.textContent = line.kind === "input" ? `> ${line.text}` : line.text;
		output.append(item);
		output.scrollTop = output.scrollHeight;
	}

	override dispose(): void {
		this.#eventSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugConsoleView.prototype);
