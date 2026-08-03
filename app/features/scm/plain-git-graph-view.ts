import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import { IOpenerService } from "@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import {
	ViewPane,
	type IViewPaneOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane";
import { IViewDescriptorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service";

import type { GitRefEntry, PlainBridge } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { PlainGitGraphController } from "./plain-git-graph";
import { plainGitInvalidation } from "./plain-git-invalidation";
import {
	bindPlainGitBridge,
	gitUpstreamDisplayName,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
} from "./plain-git-root";
import { graphLaneColor } from "./plain-git-graph-layout";
import { refBadgeText } from "./plain-git-refs";

let configuredBridge: PlainBridge | undefined;

/**
 * `configurePlainGitGraphBridge` must be called exactly once, before this
 * view is ever rendered — mirrors `plain-git-history-view.ts`'s own
 * `configurePlainGitHistoryBridge`/`configuredBridge` module-level wiring,
 * needed for the same reason: `scm-contribution.ts` registers this view's
 * `ctorDescriptor` at module-import time, long before `app/main.ts` has a
 * `PlainBridge`.
 */
export function configurePlainGitGraphBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LANE_WIDTH = 16;
const ROW_HEIGHT = 20;
const NODE_RADIUS = 4;
const GRAPH_LEFT_PADDING = 8;
const GRAPH_TOP_PADDING = 10;
const GRAPH_LABEL_GAP = 10;

function svgElement<K extends keyof SVGElementTagNameMap>(
	tagName: K,
): SVGElementTagNameMap[K] {
	return document.createElementNS(SVG_NAMESPACE, tagName);
}

/**
 * `F090` S3's graph + refs sidebar (`docs/research/2026-07-26-git-history.md`'s
 * slice 4) — Plain's own, hand-written view, registered alongside
 * `PlainScmView`/`PlainGitHistoryView` in the same Source Control view
 * container (see `scm-contribution.ts`). Renders two things from a single
 * `refresh()`:
 *
 * - **Refs sidebar**: branches/remote-tracking branches/tags, each grouped
 *   and sorted by [`PlainGitGraphController.groupedRefs`].
 * - **Graph**: a hand-drawn SVG swimlane diagram, laid out entirely by
 *   [`PlainGitGraphController.layout`] (`plain-git-graph-layout.ts`'s own
 *   from-scratch algorithm — see that module's own doc comment for why it
 *   is never derived from `git log --graph`'s ASCII output, or from any
 *   third-party product's own graph-rendering code). Each node is badged
 *   with whatever refs point at it, joined client-side via
 *   [`PlainGitGraphController.refBadgesBySha`] — this view never asks git
 *   for `%d`/`%D` decoration itself.
 *
 * A parent edge whose target commit falls outside the currently-fetched
 * window (a real possibility once `truncated` is `true`) is simply not
 * drawn — a disclosed simplification, not a bug: the node itself is still
 * shown, only the connecting line to an off-screen ancestor is omitted.
 */
export class PlainGitGraphView extends ViewPane {
	static readonly ID = "plain.workbench.view.gitGraph";

	#controller: PlainGitGraphController | undefined;
	#controllerRootId: string | undefined;
	#rootRefreshQueued = false;
	#messageElement: HTMLElement | undefined;
	#branchesList: HTMLElement | undefined;
	#remoteBranchesList: HTMLElement | undefined;
	#tagsList: HTMLElement | undefined;
	#svg: SVGSVGElement | undefined;

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
		container.classList.add("plain-git-graph-view-body");

		const message = document.createElement("div");
		message.className = "plain-git-graph-view-message";
		message.setAttribute("role", "status");
		this.#messageElement = message;

		const refreshButton = document.createElement("button");
		refreshButton.type = "button";
		refreshButton.className = "plain-git-graph-view-action";
		refreshButton.textContent = "Refresh Graph";
		this._register(
			addDisposableListener(refreshButton, "click", () => {
				void this.refresh();
			}),
		);

		const branchesHeading = document.createElement("div");
		branchesHeading.className = "plain-git-graph-view-group-heading";
		branchesHeading.textContent = "Branches";
		const branchesList = document.createElement("ul");
		branchesList.className = "plain-git-graph-view-ref-list";
		this.#branchesList = branchesList;

		const remoteBranchesHeading = document.createElement("div");
		remoteBranchesHeading.className = "plain-git-graph-view-group-heading";
		remoteBranchesHeading.textContent = "Remote Branches";
		const remoteBranchesList = document.createElement("ul");
		remoteBranchesList.className = "plain-git-graph-view-ref-list";
		this.#remoteBranchesList = remoteBranchesList;

		const tagsHeading = document.createElement("div");
		tagsHeading.className = "plain-git-graph-view-group-heading";
		tagsHeading.textContent = "Tags";
		const tagsList = document.createElement("ul");
		tagsList.className = "plain-git-graph-view-ref-list";
		this.#tagsList = tagsList;

		const graphHeading = document.createElement("div");
		graphHeading.className = "plain-git-graph-view-group-heading";
		graphHeading.textContent = "Graph";
		const graphScroll = document.createElement("div");
		graphScroll.className = "plain-git-graph-view-graph-scroll";
		const svg = svgElement("svg");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", "Commit graph");
		this.#svg = svg;
		graphScroll.append(svg);

		container.append(
			message,
			refreshButton,
			branchesHeading,
			branchesList,
			remoteBranchesHeading,
			remoteBranchesList,
			tagsHeading,
			tagsList,
			graphHeading,
			graphScroll,
		);
		this._register(
			plainGitRootSelection.onDidChange(() => {
				if (this.#rootRefreshQueued) {
					return;
				}
				this.#rootRefreshQueued = true;
				queueMicrotask(() => {
					this.#rootRefreshQueued = false;
					this.#controller = undefined;
					this.#controllerRootId = undefined;
					void this.refresh();
				});
			}),
		);
		this._register(
			plainGitInvalidation.onDidInvalidate(({ rootId }) => {
				if (this.#controllerRootId === rootId) {
					void this.refresh();
				}
			}),
		);
	}

	#getController(): PlainGitGraphController | undefined {
		if (configuredBridge === undefined) {
			return undefined;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		const root = plainGitRootSelection.resolve(roots);
		if (root === undefined) {
			return undefined;
		}
		if (
			this.#controller === undefined ||
			this.#controllerRootId !== root.rootId
		) {
			this.#controller = new PlainGitGraphController(
				bindPlainGitBridge(configuredBridge, root.rootId),
			);
			this.#controllerRootId = root.rootId;
		}
		return this.#controller;
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	async refresh(): Promise<void> {
		const controller = this.#getController();
		if (controller === undefined) {
			this.#setMessage("Select a repository to view its graph.");
			this.#branchesList?.replaceChildren();
			this.#remoteBranchesList?.replaceChildren();
			this.#tagsList?.replaceChildren();
			this.#svg?.replaceChildren();
			return;
		}
		// This slice's own real benchmark (see this feature's report) found
		// `git log --topo-order`'s own upfront full-graph walk can genuinely
		// take multi-second wall time on a very large/heavily-branched
		// repository, regardless of `maxCount` — worth a visible loading
		// state rather than an unexplained multi-second freeze.
		this.#setMessage("Loading…");
		try {
			await controller.refresh();
			this.#setMessage(
				controller.graph.truncated
					? "Showing the most recent commits only."
					: undefined,
			);
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#renderRefs();
		this.#renderGraph();
	}

	#renderRefList(
		list: HTMLElement | undefined,
		entries: readonly GitRefEntry[],
	): void {
		if (list === undefined) {
			return;
		}
		list.textContent = "";
		for (const entry of entries) {
			const item = document.createElement("li");
			item.className = "plain-git-graph-view-ref-item";
			const headMarker = entry.isHead ? "* " : "";
			const upstreamSuffix =
				entry.upstream !== null
					? ` -> ${gitUpstreamDisplayName(entry.upstream)}`
					: "";
			item.textContent = `${headMarker}${entry.shortName}${upstreamSuffix}`;
			list.append(item);
		}
	}

	#renderRefs(): void {
		const controller = this.#getController();
		if (controller === undefined) {
			return;
		}
		const grouped = controller.groupedRefs;
		this.#renderRefList(this.#branchesList, grouped.branches);
		this.#renderRefList(this.#remoteBranchesList, grouped.remoteBranches);
		this.#renderRefList(this.#tagsList, grouped.tags);
	}

	#renderGraph(): void {
		const controller = this.#getController();
		const svg = this.#svg;
		if (controller === undefined || svg === undefined) {
			return;
		}
		svg.textContent = "";
		const layout = controller.layout;
		const badgesBySha = controller.refBadgesBySha;
		const rowBySha = new Map(
			layout.nodes.map((node, index) => [node.sha, index]),
		);

		const nodeX = (lane: number): number =>
			GRAPH_LEFT_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
		const nodeY = (row: number): number =>
			GRAPH_TOP_PADDING + row * ROW_HEIGHT + ROW_HEIGHT / 2;
		const labelX =
			GRAPH_LEFT_PADDING + layout.laneCount * LANE_WIDTH + GRAPH_LABEL_GAP;
		const width = labelX + 480;
		const height =
			GRAPH_TOP_PADDING * 2 + Math.max(layout.nodes.length, 1) * ROW_HEIGHT;
		svg.setAttribute("width", String(width));
		svg.setAttribute("height", String(height));
		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

		// Edges first, so every node's own circle/label renders on top of them.
		layout.nodes.forEach((node, row) => {
			const x = nodeX(node.lane);
			const y = nodeY(row);
			node.parents.forEach((parentSha, parentIndex) => {
				const parentRow = rowBySha.get(parentSha);
				if (parentRow === undefined) {
					// The parent falls outside the currently-fetched window — see
					// this class's own doc comment's disclosed truncation-boundary
					// behavior.
					return;
				}
				const parentLane = node.parentLanes[parentIndex] ?? node.lane;
				const x2 = nodeX(parentLane);
				const y2 = nodeY(parentRow);
				const midY = (y + y2) / 2;
				const path = svgElement("path");
				path.setAttribute(
					"d",
					`M ${x} ${y} C ${x} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
				);
				path.setAttribute("fill", "none");
				path.setAttribute("stroke", graphLaneColor(node.color));
				path.setAttribute("stroke-width", "1.5");
				svg.append(path);
			});
		});

		layout.nodes.forEach((node, row) => {
			const x = nodeX(node.lane);
			const y = nodeY(row);
			const circle = svgElement("circle");
			circle.setAttribute("cx", String(x));
			circle.setAttribute("cy", String(y));
			circle.setAttribute("r", String(NODE_RADIUS));
			circle.setAttribute("fill", graphLaneColor(node.color));
			svg.append(circle);

			const badges = badgesBySha.get(node.sha) ?? [];
			const badgeText =
				badges.length > 0
					? `[${badges.map((badge) => refBadgeText(badge)).join(", ")}] `
					: "";
			const text = svgElement("text");
			text.setAttribute("x", String(labelX));
			text.setAttribute("y", String(y + 4));
			text.setAttribute("font-size", "11");
			text.textContent = `${badgeText}${node.sha.slice(0, 7)} ${node.subject}`;
			svg.append(text);
		});
	}
}

Object.freeze(PlainGitGraphView.prototype);

IKeybindingService(PlainGitGraphView, undefined, 1);
IContextMenuService(PlainGitGraphView, undefined, 2);
IConfigurationService(PlainGitGraphView, undefined, 3);
IContextKeyService(PlainGitGraphView, undefined, 4);
IViewDescriptorService(PlainGitGraphView, undefined, 5);
IInstantiationService(PlainGitGraphView, undefined, 6);
IOpenerService(PlainGitGraphView, undefined, 7);
IThemeService(PlainGitGraphView, undefined, 8);
IHoverService(PlainGitGraphView, undefined, 9);
IWorkspaceContextService(PlainGitGraphView, undefined, 10);
