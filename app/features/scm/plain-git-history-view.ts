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
	}

	#getController(): PlainGitHistoryController | undefined {
		if (configuredBridge === undefined) {
			return undefined;
		}
		this.#controller ??= new PlainGitHistoryController(configuredBridge);
		return this.#controller;
	}

	#activeRelativePath(): string | undefined {
		const resource = this.editorService.activeEditor?.resource;
		if (resource === undefined) {
			return undefined;
		}
		const rootUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (rootUri === undefined) {
			return undefined;
		}
		return relativePathUnder(rootUri, resource);
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	async showFileHistory(): Promise<void> {
		const controller = this.#getController();
		if (controller === undefined) {
			return;
		}
		const path = this.#activeRelativePath();
		if (path === undefined) {
			this.#setMessage("Open a file inside the workspace to see its history.");
			return;
		}
		try {
			await controller.loadFileHistory(path);
			this.#setMessage(undefined);
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#expandedFileHistoryIndex = undefined;
		this.#renderFileHistory();
	}

	async showLineHistory(): Promise<void> {
		const controller = this.#getController();
		if (controller === undefined) {
			return;
		}
		const path = this.#activeRelativePath();
		if (path === undefined) {
			this.#setMessage("Open a file inside the workspace to see its history.");
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
			await controller.loadLineHistory(path, { start, end });
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
		if (controller === undefined || list === undefined) {
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
