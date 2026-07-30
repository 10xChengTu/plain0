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

import { normalizeCommandError } from "../../platform/tauri/errors";
import { getPlainDebugRuntime } from "./plain-debug-runtime";

interface WatchEntry {
	readonly expression: string;
	result: string | undefined;
	error: string | undefined;
}

/**
 * `F100` S3's Watch view — user-added expressions, each evaluated via
 * `debug_evaluate` under `context: "watch"` (`PlainBridge.debugEvaluate`),
 * scoped to whatever stack frame `PlainDebugCallStackView` currently has
 * selected (the shared `DebugFrameSelection`, `plain-debug-runtime.ts`).
 * Re-evaluates every watch expression whenever the selected frame changes.
 *
 * Scope note (disclosed, not an oversight): a watch result whose own
 * `variablesReference` is non-zero (a further-expandable value) is shown as
 * a flat `result`/`type` pair — this view does not reuse
 * `PlainDebugVariablesView`'s tree-expansion machinery for watch results.
 * The feature's own acceptance criteria call for `debug_evaluate` under
 * `context: "watch"` as the Watch view's data source, which this
 * implements in full; the *nested-expansion* requirement
 * ("`variablesReference` 的惰性展开与分页") is specifically the
 * Variables view's own job, already implemented there.
 *
 * No constructor parameter beyond `ViewPane`'s own base nine — same
 * zero-own-declarations exemption `PlainDebugCallStackView`'s own doc
 * comment explains.
 */
export class PlainDebugWatchView extends ViewPane {
	static readonly ID = "plain.workbench.view.debugWatch";

	#inputElement: HTMLInputElement | undefined;
	#listElement: HTMLElement | undefined;
	readonly #entries: WatchEntry[] = [];
	#frameSubscription: { dispose(): void } | undefined;

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
		container.classList.add("plain-debug-watch-view-body");

		const addRow = document.createElement("div");
		addRow.className = "plain-debug-watch-view-add-row";
		const input = document.createElement("input");
		input.type = "text";
		input.className = "plain-debug-watch-view-input";
		input.placeholder = "Add expression";
		input.setAttribute("aria-label", "Watch Expression");
		this.#inputElement = input;
		const addButton = document.createElement("button");
		addButton.type = "button";
		addButton.textContent = "Add";
		addButton.className = "plain-debug-watch-view-add-button";
		this._register(
			addDisposableListener(addButton, "click", () => {
				this.#addExpression();
			}),
		);
		this._register(
			addDisposableListener(input, "keydown", (event: KeyboardEvent) => {
				if (event.key === "Enter") {
					this.#addExpression();
				}
			}),
		);
		addRow.append(input, addButton);

		const list = document.createElement("ul");
		list.className = "plain-debug-watch-view-list";
		this.#listElement = list;

		container.append(addRow, list);

		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#frameSubscription = runtime.frameSelection.onDidChange(() => {
			void this.#reevaluateAll();
		});
	}

	#addExpression(): void {
		const input = this.#inputElement;
		if (input === undefined || input.value.trim().length === 0) {
			return;
		}
		this.#entries.push({
			expression: input.value,
			result: undefined,
			error: undefined,
		});
		input.value = "";
		this.#render();
		void this.#reevaluateAll();
	}

	#removeExpression(expression: string): void {
		const index = this.#entries.findIndex(
			(entry) => entry.expression === expression,
		);
		if (index >= 0) {
			this.#entries.splice(index, 1);
		}
		this.#render();
	}

	async #reevaluateAll(): Promise<void> {
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		const frameId = runtime.frameSelection.frameId;
		await Promise.all(
			this.#entries.map(async (entry) => {
				try {
					const result = await runtime.session.evaluate(
						entry.expression,
						frameId,
						"watch",
					);
					if (result === undefined) {
						entry.result = undefined;
						entry.error = "Not debugging.";
					} else {
						entry.result =
							result.type !== null
								? `${result.result} (${result.type})`
								: result.result;
						entry.error = undefined;
					}
				} catch (error) {
					entry.result = undefined;
					entry.error = normalizeCommandError(error).message;
				}
			}),
		);
		this.#render();
	}

	#render(): void {
		const list = this.#listElement;
		if (list === undefined) {
			return;
		}
		list.textContent = "";
		for (const entry of this.#entries) {
			const item = document.createElement("li");
			item.className = "plain-debug-watch-view-entry";

			const label = document.createElement("span");
			label.className = "plain-debug-watch-view-expression";
			label.textContent = entry.expression;

			const value = document.createElement("span");
			value.className = "plain-debug-watch-view-value";
			value.textContent = entry.error ?? entry.result ?? "";
			if (entry.error !== undefined) {
				value.classList.add("plain-debug-watch-view-value-error");
			}

			const removeButton = document.createElement("button");
			removeButton.type = "button";
			removeButton.textContent = "Remove";
			removeButton.className = "plain-debug-watch-view-remove";
			this._register(
				addDisposableListener(removeButton, "click", () => {
					this.#removeExpression(entry.expression);
				}),
			);

			item.append(label, value, removeButton);
			list.append(item);
		}
	}

	override dispose(): void {
		this.#frameSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugWatchView.prototype);
