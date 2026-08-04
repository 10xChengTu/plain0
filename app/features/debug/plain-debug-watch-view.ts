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
import {
	DebugVariablesTree,
	declaredCount,
} from "./plain-debug-variables-tree";
import {
	renderVariablesTreeNode,
	type VariablesTreeRenderHost,
} from "./plain-debug-variables-tree-render";
import {
	collectExpandedPaths,
	pruneExpandedSubtree,
	restoreExpandedPaths,
} from "./plain-debug-watch-expansion";

interface WatchEntry {
	readonly expression: string;
	/** The composed `value (type)` display text (or bare value with no type
	 * suffix) — the flat text this view has always shown, also reused
	 * verbatim as this entry's own tree-root label when it is expandable. */
	result: string | undefined;
	error: string | undefined;
	/** `0` (DAP's own "no further children" sentinel) until a real evaluate
	 * result says otherwise — matches every entry's state before its first
	 * evaluate ever resolves. */
	variablesReference: number;
	namedVariables: number | null;
	indexedVariables: number | null;
}

/**
 * `F100` S3's Watch view — user-added expressions, each evaluated via
 * `debug_evaluate` under `context: "watch"` (`PlainBridge.debugEvaluate`),
 * scoped to whatever stack frame `PlainDebugCallStackView` currently has
 * selected (the shared `DebugFrameSelection`, `plain-debug-runtime.ts`).
 * Re-evaluates every watch expression whenever the selected frame changes.
 *
 * `F210` S2 closed this view's own previously-disclosed scope gap: a watch
 * result whose own `variablesReference !== 0` now expands through the exact
 * same `DebugVariablesTree`/`renderVariablesTreeNode` engine
 * `PlainDebugVariablesView` uses (`plain-debug-variables-tree.ts`) — one
 * shared tree instance for the whole view, keyed by the adapter's own
 * `variablesReference` numbers exactly like the Variables view's own tree.
 * Because a real adapter is free to mint a brand-new reference on every
 * evaluate, expand/collapse state cannot simply persist by reference number
 * across a re-evaluate; `plain-debug-watch-expansion.ts`'s
 * `collectExpandedPaths`/`restoreExpandedPaths` snapshot and replay that
 * state by variable-*name* path instead, keyed at the entry (== expression)
 * level, right around each entry's own evaluate call in
 * {@link #reevaluateAll} — see that module's own doc comment for the full
 * mechanism. Removing an expression prunes its own subtree from the shared
 * tree (`pruneExpandedSubtree`); there is no in-place "edit expression"
 * affordance, so "修改则丢弃其状态" is satisfied by removal already dropping
 * the entry (and its state) outright.
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
	#tree: DebugVariablesTree | undefined;
	readonly #treeHost: VariablesTreeRenderHost = {
		register: (disposable) => this._register(disposable),
		onChange: () => this.#render(),
	};
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
		this.#tree = new DebugVariablesTree((reference, start, count) =>
			runtime.session.variables(reference, start, count, null),
		);
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
			variablesReference: 0,
			namedVariables: null,
			indexedVariables: null,
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
			const [removed] = this.#entries.splice(index, 1);
			if (removed !== undefined && this.#tree !== undefined) {
				pruneExpandedSubtree(this.#tree, removed.variablesReference);
			}
		}
		this.#render();
	}

	async #reevaluateAll(): Promise<void> {
		const runtime = getPlainDebugRuntime();
		const tree = this.#tree;
		if (runtime === undefined || tree === undefined) {
			return;
		}
		const frameId = runtime.frameSelection.frameId;
		await Promise.all(
			this.#entries.map(async (entry) => {
				// Snapshot which nested nodes are expanded *before* this entry's
				// old reference goes stale (keyed by variable-name path, since a
				// real adapter mints a brand-new `variablesReference` on every
				// evaluate — see `plain-debug-watch-expansion.ts`'s own doc
				// comment), then prune the old subtree so the shared tree never
				// accumulates dead references no path will ever point back to.
				const expandedPaths = new Set<string>();
				collectExpandedPaths(tree, entry.variablesReference, [], expandedPaths);
				pruneExpandedSubtree(tree, entry.variablesReference);
				try {
					const result = await runtime.session.evaluate(
						entry.expression,
						frameId,
						"watch",
					);
					if (result === undefined) {
						entry.result = undefined;
						entry.error = "Not debugging.";
						entry.variablesReference = 0;
						entry.namedVariables = null;
						entry.indexedVariables = null;
					} else {
						entry.result =
							result.type !== null
								? `${result.result} (${result.type})`
								: result.result;
						entry.error = undefined;
						entry.variablesReference = result.variablesReference;
						entry.namedVariables = result.namedVariables;
						entry.indexedVariables = result.indexedVariables;
					}
				} catch (error) {
					entry.result = undefined;
					entry.error = normalizeCommandError(error).message;
					entry.variablesReference = 0;
					entry.namedVariables = null;
					entry.indexedVariables = null;
				}
				if (entry.variablesReference !== 0 && expandedPaths.size > 0) {
					await restoreExpandedPaths(
						tree,
						entry.variablesReference,
						declaredCount(entry),
						[],
						expandedPaths,
					);
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
			item.append(label);

			if (
				entry.error !== undefined ||
				entry.variablesReference === 0 ||
				this.#tree === undefined
			) {
				const value = document.createElement("span");
				value.className = "plain-debug-watch-view-value";
				value.textContent = entry.error ?? entry.result ?? "";
				if (entry.error !== undefined) {
					value.classList.add("plain-debug-watch-view-value-error");
				}
				item.append(value);
			} else {
				const valueTree = document.createElement("ul");
				valueTree.className = "plain-debug-watch-view-value-tree";
				renderVariablesTreeNode(
					this.#tree,
					this.#treeHost,
					valueTree,
					entry.variablesReference,
					entry.result ?? "",
					declaredCount(entry),
					0,
				);
				item.append(valueTree);
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

			item.append(removeButton);
			list.append(item);
		}
	}

	override dispose(): void {
		this.#frameSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugWatchView.prototype);
