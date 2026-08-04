import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";

import {
	declaredCount,
	VARIABLES_PAGE_SIZE,
	type DebugVariablesTree,
} from "./plain-debug-variables-tree";

/** What {@link renderVariablesTreeNode} needs from its owning `ViewPane` —
 * disposable registration (so a toggle/load-more click listener is cleaned
 * up when the view disposes, exactly like every other listener the view
 * registers via its own `_register`) and a way to ask for a re-render once a
 * toggle/load-more actually changed the tree. */
export interface VariablesTreeRenderHost {
	register(disposable: { dispose(): void }): void;
	onChange(): void;
}

/**
 * Renders one tree node (and, if expanded, its children) into `container` —
 * the extracted, verbatim body of `PlainDebugVariablesView`'s own former
 * `#renderNode`. Reused as-is by `PlainDebugVariablesView` for each scope and
 * by `PlainDebugWatchView` for each expandable watch result's own root node,
 * so both views render identical DOM (`plain-debug-variables-node`/`-row`/
 * `-toggle`/`-label`/`-children`/`-load-more`) for what is, structurally, the
 * same kind of node either way. Kept in its own module (not
 * `plain-debug-variables-tree.ts`, which owns the pure `DebugVariablesTree`
 * engine this renders) specifically because this function needs
 * `addDisposableListener` — see that module's own doc comment for why.
 */
export function renderVariablesTreeNode(
	tree: DebugVariablesTree,
	host: VariablesTreeRenderHost,
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
	const isExpanded = tree.isExpanded(reference);
	if (!isLeaf) {
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "plain-debug-variables-toggle";
		toggle.textContent = isExpanded ? "▾" : "▸";
		toggle.setAttribute("aria-label", `Toggle ${label}`);
		toggle.setAttribute("aria-expanded", String(isExpanded));
		host.register(
			addDisposableListener(toggle, "click", () => {
				void (async () => {
					if (await tree.toggle(reference, countHint)) {
						host.onChange();
					}
				})();
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
		const node = tree.node(reference)!;
		const childList = document.createElement("ul");
		childList.className = "plain-debug-variables-children";
		for (const variable of node.variables) {
			const typeSuffix = variable.type !== null ? ` (${variable.type})` : "";
			renderVariablesTreeNode(
				tree,
				host,
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
			host.register(
				addDisposableListener(loadMoreButton, "click", () => {
					void (async () => {
						if (await tree.loadMore(reference)) {
							host.onChange();
						}
					})();
				}),
			);
			loadMoreItem.append(loadMoreButton);
			childList.append(loadMoreItem);
		}
		item.append(childList);
	}
	container.append(item);
}
