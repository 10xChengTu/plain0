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

import type { DebugScope, DebugVariable } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { getPlainDebugRuntime } from "./plain-debug-runtime";

/** How many entries one `debugVariables` page requests — an arbitrary but
 * reasonable UI page size (not a protocol constant); the adapter itself
 * still decides how it actually slices its own children by `start`/`count`
 * (see `PlainBridge.debugVariables`'s own doc comment). */
const VARIABLES_PAGE_SIZE = 100;

interface ExpandedVariablesNode {
	variables: DebugVariable[];
	/** The declared child count from the *parent* (`indexedVariables`/
	 * `namedVariables`), or `null` when the adapter never reported one — in
	 * which case this view treats the first page as the complete result
	 * (no "Load more" affordance), rather than guessing. */
	total: number | null;
}

function declaredCount(
	entity: Pick<
		DebugScope | DebugVariable,
		"indexedVariables" | "namedVariables"
	>,
): number | null {
	return entity.indexedVariables ?? entity.namedVariables ?? null;
}

/**
 * `F100` S3's Variables view — the **lazy expansion and pagination**
 * surface this feature's acceptance criteria require: every node (a scope,
 * or any variable whose `variablesReference !== 0`) starts collapsed;
 * expanding one issues exactly one `debugVariables` call for that reference,
 * and a further "Load N more" affordance appears whenever the parent's own
 * declared `indexedVariables`/`namedVariables` count exceeds what has been
 * fetched so far — real pagination against the live adapter, not a
 * client-side slice of an already-fully-fetched array. Refreshes whenever
 * the shared `DebugFrameSelection` (`plain-debug-runtime.ts`) changes, which
 * `PlainDebugCallStackView` writes to on every stack-frame selection.
 *
 * No constructor parameter beyond `ViewPane`'s own base nine — same
 * zero-own-declarations exemption `PlainDebugCallStackView`'s own doc
 * comment explains.
 */
export class PlainDebugVariablesView extends ViewPane {
	static readonly ID = "plain.workbench.view.debugVariables";

	#messageElement: HTMLElement | undefined;
	#treeElement: HTMLElement | undefined;
	#scopes: readonly DebugScope[] = [];
	readonly #expanded = new Map<number, ExpandedVariablesNode>();
	#frameSubscription: { dispose(): void } | undefined;
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
		container.classList.add("plain-debug-variables-view-body");

		const message = document.createElement("div");
		message.className = "plain-debug-variables-view-message";
		message.setAttribute("role", "status");
		message.textContent = "No frame selected.";
		this.#messageElement = message;

		const tree = document.createElement("ul");
		tree.className = "plain-debug-variables-view-tree";
		this.#treeElement = tree;

		container.append(message, tree);

		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		this.#frameSubscription = runtime.frameSelection.onDidChange((frameId) => {
			void this.#refresh(frameId);
		});
		void this.#refresh(runtime.frameSelection.frameId);
	}

	async #refresh(frameId: number | null): Promise<void> {
		const token = (this.#refreshToken += 1);
		this.#expanded.clear();
		if (frameId === null) {
			this.#scopes = [];
			this.#setMessage("No frame selected.");
			this.#render();
			return;
		}
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		try {
			const result = await runtime.session.scopes(frameId);
			if (token !== this.#refreshToken) {
				return;
			}
			this.#scopes = result?.scopes ?? [];
			this.#setMessage(this.#scopes.length === 0 ? "No variables." : undefined);
		} catch (error) {
			if (token !== this.#refreshToken) {
				return;
			}
			this.#scopes = [];
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#render();
	}

	async #toggle(reference: number, countHint: number | null): Promise<void> {
		if (this.#expanded.has(reference)) {
			this.#expanded.delete(reference);
			this.#render();
			return;
		}
		const runtime = getPlainDebugRuntime();
		if (runtime === undefined) {
			return;
		}
		try {
			const result = await runtime.session.variables(
				reference,
				0,
				VARIABLES_PAGE_SIZE,
				null,
			);
			this.#expanded.set(reference, {
				variables: [...(result?.variables ?? [])],
				total: countHint,
			});
		} catch {
			return;
		}
		this.#render();
	}

	async #loadMore(reference: number): Promise<void> {
		const node = this.#expanded.get(reference);
		const runtime = getPlainDebugRuntime();
		if (node === undefined || runtime === undefined) {
			return;
		}
		try {
			const result = await runtime.session.variables(
				reference,
				node.variables.length,
				VARIABLES_PAGE_SIZE,
				null,
			);
			node.variables = [...node.variables, ...(result?.variables ?? [])];
		} catch {
			return;
		}
		this.#render();
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	#render(): void {
		const tree = this.#treeElement;
		if (tree === undefined) {
			return;
		}
		tree.textContent = "";
		for (const scope of this.#scopes) {
			this.#renderNode(
				tree,
				scope.variablesReference,
				scope.name,
				declaredCount(scope),
				0,
			);
		}
	}

	#renderNode(
		container: HTMLElement,
		reference: number,
		label: string,
		countHint: number | null,
		depth: number,
	): void {
		const item = document.createElement("li");
		item.className = "plain-debug-variables-node";
		item.style.paddingLeft = `${depth * 12}px`;

		const row = document.createElement("div");
		row.className = "plain-debug-variables-row";
		const isLeaf = reference === 0;
		const isExpanded = this.#expanded.has(reference);
		if (!isLeaf) {
			const toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "plain-debug-variables-toggle";
			toggle.textContent = isExpanded ? "▾" : "▸";
			toggle.setAttribute("aria-label", `Toggle ${label}`);
			toggle.setAttribute("aria-expanded", String(isExpanded));
			this._register(
				addDisposableListener(toggle, "click", () => {
					void this.#toggle(reference, countHint);
				}),
			);
			row.append(toggle);
		}
		const text = document.createElement("span");
		text.className = "plain-debug-variables-label";
		text.textContent = label;
		row.append(text);
		item.append(row);

		if (!isLeaf && isExpanded) {
			const node = this.#expanded.get(reference)!;
			const childList = document.createElement("ul");
			childList.className = "plain-debug-variables-children";
			for (const variable of node.variables) {
				const typeSuffix = variable.type !== null ? ` (${variable.type})` : "";
				this.#renderNode(
					childList,
					variable.variablesReference,
					`${variable.name}: ${variable.value}${typeSuffix}`,
					declaredCount(variable),
					depth + 1,
				);
			}
			if (node.total !== null && node.variables.length < node.total) {
				const loadMoreItem = document.createElement("li");
				loadMoreItem.style.paddingLeft = `${(depth + 1) * 12}px`;
				const loadMoreButton = document.createElement("button");
				loadMoreButton.type = "button";
				loadMoreButton.className = "plain-debug-variables-load-more";
				const remaining = node.total - node.variables.length;
				loadMoreButton.textContent = `Load ${Math.min(VARIABLES_PAGE_SIZE, remaining)} more…`;
				this._register(
					addDisposableListener(loadMoreButton, "click", () => {
						void this.#loadMore(reference);
					}),
				);
				loadMoreItem.append(loadMoreButton);
				childList.append(loadMoreItem);
			}
			item.append(childList);
		}
		container.append(item);
	}

	override dispose(): void {
		this.#frameSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugVariablesView.prototype);
