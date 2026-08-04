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

import type { DebugScope } from "../../platform/tauri/contracts";
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
	#tree: DebugVariablesTree | undefined;
	readonly #treeHost: VariablesTreeRenderHost = {
		register: (disposable) => this._register(disposable),
		onChange: () => this.#render(),
	};
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
		this.#tree = new DebugVariablesTree((reference, start, count) =>
			runtime.session.variables(reference, start, count, null),
		);
		this.#frameSubscription = runtime.frameSelection.onDidChange((frameId) => {
			void this.#refresh(frameId);
		});
		void this.#refresh(runtime.frameSelection.frameId);
	}

	async #refresh(frameId: number | null): Promise<void> {
		const token = (this.#refreshToken += 1);
		this.#tree?.clear();
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

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	#render(): void {
		const tree = this.#treeElement;
		if (tree === undefined || this.#tree === undefined) {
			return;
		}
		tree.textContent = "";
		for (const scope of this.#scopes) {
			renderVariablesTreeNode(
				this.#tree,
				this.#treeHost,
				tree,
				scope.variablesReference,
				scope.name,
				declaredCount(scope),
				0,
			);
		}
	}

	override dispose(): void {
		this.#frameSubscription?.dispose();
		super.dispose();
	}
}

Object.freeze(PlainDebugVariablesView.prototype);
