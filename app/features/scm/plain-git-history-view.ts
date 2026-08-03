import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
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
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";

import type { PlainBridge } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { encodeGitCommitSourceUri } from "./plain-git-commit-detail";
import { plainGitInvalidation } from "./plain-git-invalidation";
import {
	bindPlainGitBridge,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
} from "./plain-git-root";
import {
	historyEntrySummary,
	PlainGitHistoryController,
	shortCommitSha,
} from "./plain-git-history";
import { relativePathUnder } from "./plain-scm-provider";

let configuredBridge: PlainBridge | undefined;

/**
 * `configurePlainGitHistoryBridge` must be called exactly once, before this
 * view is ever rendered — mirrors `plain-scm-view.ts`'s own
 * `configurePlainScmBridge`/`configuredBridge` module-level wiring, needed
 * for the same reason: `scm-contribution.ts` registers this view's
 * `ctorDescriptor` at module-import time, long before `app/main.ts` has a
 * `PlainBridge`.
 */
export function configurePlainGitHistoryBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

/**
 * `F090` S1's file/line history sidebar — Plain's own, hand-written view,
 * registered alongside `PlainScmView` in the same Source Control view
 * container (see `scm-contribution.ts`), never any vendor SCM history
 * viewlet/graph. Two independent lists share this one view:
 *
 * - **File history** (`Show File History`): the active editor's whole-file
 *   commit list ([`PlainGitHistoryController.loadFileHistory`],
 *   `git log --follow`). Clicking a row toggles showing that commit's full
 *   message inline — already present in the fetched list entry, no further
 *   round trip needed.
 * - **Line history** (`Show Line History`): the active editor's file,
 *   restricted to a user-entered 1-based start/end line range
 *   ([`PlainGitHistoryController.loadLineHistory`], `git log -L<range>`).
 *   Clicking a row drills into that specific commit's actual diff hunk
 *   ([`PlainGitHistoryController.openLineHistoryDetail`]), rendered as
 *   preformatted text below the list.
 *
 * The line range is a plain two-number-input form rather than driven from
 * the active editor's live text selection — a deliberate, disclosed scope
 * cut for this slice (see this feature's own report): it needs no
 * `ICodeEditor`/`Selection`-shaped structural interface at all, and still
 * exercises the exact same `line_history_list`/`line_history_detail` Rust
 * path a selection-driven trigger would.
 */
export class PlainGitHistoryView extends ViewPane {
	static readonly ID = "plain.workbench.view.gitHistory";

	#controller: PlainGitHistoryController | undefined;
	#controllerRootId: string | undefined;
	#messageElement: HTMLElement | undefined;
	#fileHistoryList: HTMLElement | undefined;
	#lineHistoryList: HTMLElement | undefined;
	#detailElement: HTMLElement | undefined;
	#startInput: HTMLInputElement | undefined;
	#endInput: HTMLInputElement | undefined;
	#expandedFileHistoryIndex: number | undefined;

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
		private readonly editorService: IEditorService,
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
		container.classList.add("plain-git-history-view-body");

		const message = document.createElement("div");
		message.className = "plain-git-history-view-message";
		message.setAttribute("role", "status");
		this.#messageElement = message;

		const fileHistoryRow = document.createElement("div");
		fileHistoryRow.className = "plain-git-history-view-row";
		const fileHistoryButton = document.createElement("button");
		fileHistoryButton.type = "button";
		fileHistoryButton.className = "plain-git-history-view-action";
		fileHistoryButton.textContent = "Show File History";
		this._register(
			addDisposableListener(fileHistoryButton, "click", () => {
				void this.showFileHistory();
			}),
		);
		fileHistoryRow.append(fileHistoryButton);

		const fileHistoryHeading = document.createElement("div");
		fileHistoryHeading.className = "plain-git-history-view-group-heading";
		fileHistoryHeading.textContent = "File History";

		const fileHistoryList = document.createElement("ul");
		fileHistoryList.className = "plain-git-history-view-list";
		this.#fileHistoryList = fileHistoryList;

		const lineRangeRow = document.createElement("div");
		lineRangeRow.className = "plain-git-history-view-row";
		const startInput = document.createElement("input");
		startInput.type = "number";
		startInput.min = "1";
		startInput.className = "plain-git-history-view-line-input";
		startInput.setAttribute("aria-label", "Start Line");
		startInput.placeholder = "Start line";
		this.#startInput = startInput;
		const endInput = document.createElement("input");
		endInput.type = "number";
		endInput.min = "1";
		endInput.className = "plain-git-history-view-line-input";
		endInput.setAttribute("aria-label", "End Line");
		endInput.placeholder = "End line";
		this.#endInput = endInput;
		const lineHistoryButton = document.createElement("button");
		lineHistoryButton.type = "button";
		lineHistoryButton.className = "plain-git-history-view-action";
		lineHistoryButton.textContent = "Show Line History";
		this._register(
			addDisposableListener(lineHistoryButton, "click", () => {
				void this.showLineHistory();
			}),
		);
		lineRangeRow.append(startInput, endInput, lineHistoryButton);

		const lineHistoryHeading = document.createElement("div");
		lineHistoryHeading.className = "plain-git-history-view-group-heading";
		lineHistoryHeading.textContent = "Line History";

		const lineHistoryList = document.createElement("ul");
		lineHistoryList.className = "plain-git-history-view-list";
		this.#lineHistoryList = lineHistoryList;

		const detail = document.createElement("pre");
		detail.className = "plain-git-history-view-detail";
		this.#detailElement = detail;

		container.append(
			message,
			fileHistoryRow,
			fileHistoryHeading,
			fileHistoryList,
			lineRangeRow,
			lineHistoryHeading,
			lineHistoryList,
			detail,
		);
		this._register(
			plainGitInvalidation.onDidInvalidate(({ rootId }) => {
				if (this.#controllerRootId === rootId) {
					void this.#refreshInvalidatedHistory();
				}
			}),
		);
	}

	async #refreshInvalidatedHistory(): Promise<void> {
		const controller = this.#controller;
		if (controller === undefined) {
			return;
		}
		try {
			await controller.refreshLoadedHistory();
			if (this.#controller !== controller) {
				return;
			}
			this.#setMessage(undefined);
		} catch (error) {
			if (this.#controller !== controller) {
				return;
			}
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#expandedFileHistoryIndex = undefined;
		this.#detailElement?.replaceChildren();
		this.#renderFileHistory();
		this.#renderLineHistory();
	}

	#getController(): PlainGitHistoryController | undefined {
		return this.#controller;
	}

	#getControllerForRoot(rootId: string): PlainGitHistoryController | undefined {
		if (configuredBridge === undefined) {
			return undefined;
		}
		if (this.#controller === undefined || this.#controllerRootId !== rootId) {
			this.#controller = new PlainGitHistoryController(
				bindPlainGitBridge(configuredBridge, rootId),
			);
			this.#controllerRootId = rootId;
			this.#expandedFileHistoryIndex = undefined;
		}
		return this.#controller;
	}

	#activeResourceTarget():
		Readonly<{ rootId: string; path: string }> | undefined {
		const resource = this.editorService.activeEditor?.resource;
		if (resource === undefined) {
			return undefined;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		const root = roots.find(
			(candidate) =>
				candidate.uri.scheme === resource.scheme &&
				candidate.uri.authority === resource.authority,
		);
		if (root === undefined) {
			return undefined;
		}
		const path = relativePathUnder(root.uri, resource);
		return path === undefined
			? undefined
			: Object.freeze({ rootId: root.rootId, path });
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	async showFileHistory(): Promise<void> {
		const target = this.#activeResourceTarget();
		if (target === undefined) {
			this.#setMessage("Open a file inside the workspace to see its history.");
			return;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		plainGitRootSelection.select(target.rootId, roots);
		const controller = this.#getControllerForRoot(target.rootId);
		if (controller === undefined) {
			return;
		}
		try {
			await controller.loadFileHistory(target.path);
			this.#setMessage(undefined);
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#expandedFileHistoryIndex = undefined;
		this.#renderFileHistory();
	}

	async showLineHistory(): Promise<void> {
		const target = this.#activeResourceTarget();
		if (target === undefined) {
			this.#setMessage("Open a file inside the workspace to see its history.");
			return;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		plainGitRootSelection.select(target.rootId, roots);
		const controller = this.#getControllerForRoot(target.rootId);
		if (controller === undefined) {
			return;
		}
		const start = Number(this.#startInput?.value ?? "");
		const end = Number(this.#endInput?.value ?? "");
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < 1 ||
			end < start
		) {
			this.#setMessage(
				"Enter a valid start/end line range (start >= 1, end >= start).",
			);
			return;
		}
		if (this.#detailElement !== undefined) {
			this.#detailElement.textContent = "";
		}
		try {
			await controller.loadLineHistory(target.path, { start, end });
			this.#setMessage(undefined);
		} catch (error) {
			controller.clearLineHistory();
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#renderLineHistory();
	}

	#renderFileHistory(): void {
		const controller = this.#getController();
		const list = this.#fileHistoryList;
		const rootId = this.#controllerRootId;
		if (
			controller === undefined ||
			list === undefined ||
			rootId === undefined
		) {
			return;
		}
		list.textContent = "";
		controller.fileHistory.entries.forEach((entry, index) => {
			const item = document.createElement("li");
			item.className = "plain-git-history-view-item";
			const row = document.createElement("button");
			row.type = "button";
			row.className = "plain-git-history-view-item-row";
			row.textContent = `${shortCommitSha(entry.sha)}  ${historyEntrySummary(entry)}`;
			this._register(
				addDisposableListener(row, "click", () => {
					this.#expandedFileHistoryIndex =
						this.#expandedFileHistoryIndex === index ? undefined : index;
					this.#renderFileHistory();
				}),
			);
			item.append(row);
			if (this.#expandedFileHistoryIndex === index) {
				const body = document.createElement("pre");
				body.className = "plain-git-history-view-item-body";
				body.textContent = entry.message;
				item.append(body);

				// `F090` S2: opens the commit's changed-file list as a
				// multi-diff editor — `IEditorService.openEditor` with a
				// `multiDiffSource` is resolved by
				// `PlainGitCommitMultiDiffSourceResolver` (registered once,
				// globally, in `main.ts`), never a direct call into this
				// view's own rendering.
				const viewFilesButton = document.createElement("button");
				viewFilesButton.type = "button";
				viewFilesButton.className = "plain-git-history-view-item-action";
				viewFilesButton.textContent = "View Changed Files";
				this._register(
					addDisposableListener(viewFilesButton, "click", () => {
						void this.editorService.openEditor({
							multiDiffSource: encodeGitCommitSourceUri(rootId, entry.sha),
							label: `Commit ${shortCommitSha(entry.sha)}`,
						});
					}),
				);
				item.append(viewFilesButton);
			}
			list.append(item);
		});
		if (controller.fileHistory.truncated) {
			list.append(truncatedNoticeItem());
		}
	}

	#renderLineHistory(): void {
		const controller = this.#getController();
		const list = this.#lineHistoryList;
		if (controller === undefined || list === undefined) {
			return;
		}
		list.textContent = "";
		controller.lineHistory.entries.forEach((entry, index) => {
			const item = document.createElement("li");
			item.className = "plain-git-history-view-item";
			const row = document.createElement("button");
			row.type = "button";
			row.className = "plain-git-history-view-item-row";
			row.textContent = `${shortCommitSha(entry.sha)}  ${historyEntrySummary(entry)}`;
			this._register(
				addDisposableListener(row, "click", () => {
					void this.#openLineHistoryDetail(index);
				}),
			);
			item.append(row);
			list.append(item);
		});
		if (controller.lineHistory.truncated) {
			list.append(truncatedNoticeItem());
		}
	}

	async #openLineHistoryDetail(index: number): Promise<void> {
		const controller = this.#getController();
		if (controller === undefined || this.#detailElement === undefined) {
			return;
		}
		try {
			const detail = await controller.openLineHistoryDetail(index);
			this.#detailElement.textContent = detail.diffText;
			this.#setMessage(undefined);
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
	}
}

function truncatedNoticeItem(): HTMLElement {
	const item = document.createElement("li");
	item.className = "plain-git-history-view-truncated";
	item.textContent = "Showing the most recent commits only.";
	return item;
}

Object.freeze(PlainGitHistoryView.prototype);

// Every constructor parameter must be redeclared here, not only the two this
// class adds beyond `ViewPane`'s own base ten — the DI decorator's own
// storage (`@codingame/monaco-vscode-api`'s `instantiation.js`) creates a
// *fresh* `$di$dependencies` array the first time any decorator is called on
// a given class, discarding whatever `ViewPane`'s own array would otherwise
// have been reachable through prototype inheritance, rather than appending to
// it. `F090` S6's own real, costly discovery of this exact defect: this
// class had *never* had any decorator declared at all (unlike
// `PlainGitStashView`'s/`PlainGitWorktreeView`'s already-correct "declared
// some but not all" near-miss) — because `IInstantiationService.
// createInstance` looks up a class's own dependency array only after walking
// to the nearest ancestor that ever called a decorator on it, an
// *undeclared* subclass like this one had actually been inheriting
// `ViewPane`'s own correct 9-entry array unmodified, silently leaving indices
// 10/11 (`workspaceContextService`/`editorService`) as `undefined` on every
// real construction since this class was first written in `F090` S1 — a
// defect distinct from, and never caught by, S4's later "some but not all"
// discovery, and undetected until this slice's first-ever Browser E2E
// coverage of this view actually clicked "Show File History" and hit
// `this.editorService.activeEditor` on an `undefined` `editorService`.
// Mirrors `PlainGitStashView`'s/`PlainGitWorktreeView`'s/`PlainScmView`'s own
// identical, already-correct pattern of redeclaring every parameter index
// from 1 through this class's own last extra service.
IKeybindingService(PlainGitHistoryView, undefined, 1);
IContextMenuService(PlainGitHistoryView, undefined, 2);
IConfigurationService(PlainGitHistoryView, undefined, 3);
IContextKeyService(PlainGitHistoryView, undefined, 4);
IViewDescriptorService(PlainGitHistoryView, undefined, 5);
IInstantiationService(PlainGitHistoryView, undefined, 6);
IOpenerService(PlainGitHistoryView, undefined, 7);
IThemeService(PlainGitHistoryView, undefined, 8);
IHoverService(PlainGitHistoryView, undefined, 9);
IWorkspaceContextService(PlainGitHistoryView, undefined, 10);
IEditorService(PlainGitHistoryView, undefined, 11);
