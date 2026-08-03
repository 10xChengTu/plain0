import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IHoverService } from "@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service";
import { IInstantiationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation";
import { IKeybindingService } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IOpenerService } from "@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service";
import { IThemeService } from "@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import {
	ViewPane,
	type IViewPaneOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane";
import { IViewDescriptorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service";

import type {
	GitWorktreeEntry,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { plainGitInvalidation } from "./plain-git-invalidation";
import {
	PlainGitWorktreeController,
	worktreeEntryLabel,
} from "./plain-git-worktree";
import {
	bindPlainGitBridge,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainRootedGitBridge,
} from "./plain-git-root";
import { resolveWorktreeConfirmation } from "./plain-scm-worktree";

let configuredBridge: PlainBridge | undefined;

/**
 * `configurePlainGitWorktreeBridge` must be called exactly once, before this
 * view is ever rendered — mirrors `plain-git-stash-view.ts`'s own
 * `configurePlainGitStashBridge`/`configuredBridge` module-level wiring,
 * needed for the same reason: `scm-contribution.ts` registers this view's
 * `ctorDescriptor` at module-import time, long before `app/main.ts` has a
 * `PlainBridge`.
 */
export function configurePlainGitWorktreeBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

/**
 * `F090` S5's worktree panel (`docs/research/2026-07-26-git-history.md`'s
 * slice 6) — Plain's own, hand-written view, registered alongside
 * `PlainScmView`/`PlainGitHistoryView`/`PlainGitGraphView`/`PlainGitStashView`
 * in the same Source Control view container (see `scm-contribution.ts`).
 * Never consumes `ISCMProvider.historyProvider` (still
 * `constObservable(undefined)`, per every earlier `F090` slice's own
 * established boundary) and never any vendor worktree/GitLens code — a
 * from-scratch UI over this domain's own `git::worktree` Rust module.
 *
 * Confirmation split (per this feature's own frozen plan and
 * `plain-scm-worktree.ts`'s own module doc comment): `addWorktree` never
 * shows a blocking dialog at all (this feature's own "低风险,不强确认" half —
 * the native folder-picker dialog `gitWorktreeAdd` always pops server-side
 * is itself this action's own explicit gesture); `removeEntry` always first
 * calls `gitWorktreeRemove(path, false)` unconfirmed (a clean worktree is
 * removed immediately) and only routes through `resolveWorktreeConfirmation`
 * for the *second*, forced retry when that first call reports back
 * `"needsForce"`.
 */
export class PlainGitWorktreeView extends ViewPane {
	static readonly ID = "plain.workbench.view.gitWorktree";

	#controller: PlainGitWorktreeController | undefined;
	#controllerRootId: string | undefined;
	#rootedBridge: PlainRootedGitBridge | undefined;
	#rootRefreshQueued = false;
	#messageElement: HTMLElement | undefined;
	#childSegmentInput: HTMLInputElement | undefined;
	#commitIshInput: HTMLInputElement | undefined;
	#detachCheckbox: HTMLInputElement | undefined;
	#entryList: HTMLElement | undefined;
	#detailElement: HTMLElement | undefined;
	#mutationInFlight = false;

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
		private readonly dialogService: IDialogService,
		private readonly notificationService: INotificationService,
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
		container.classList.add("plain-git-worktree-view-body");

		const message = document.createElement("div");
		message.className = "plain-git-worktree-view-message";
		message.setAttribute("role", "status");
		this.#messageElement = message;

		const addHeading = document.createElement("div");
		addHeading.className = "plain-git-worktree-view-group-heading";
		addHeading.textContent = "New Worktree";

		const addNotice = document.createElement("div");
		addNotice.className = "plain-git-worktree-view-add-notice";
		addNotice.textContent =
			"Choose a parent folder, then name the new worktree's own subfolder.";

		const childSegmentInput = document.createElement("input");
		childSegmentInput.type = "text";
		childSegmentInput.className = "plain-git-worktree-view-child-segment-input";
		childSegmentInput.placeholder = "Folder name";
		childSegmentInput.setAttribute("aria-label", "New Worktree Folder Name");
		this.#childSegmentInput = childSegmentInput;

		const commitIshInput = document.createElement("input");
		commitIshInput.type = "text";
		commitIshInput.className = "plain-git-worktree-view-commit-ish-input";
		commitIshInput.placeholder = "Branch, tag or commit (optional)";
		commitIshInput.setAttribute("aria-label", "Branch, Tag Or Commit");
		this.#commitIshInput = commitIshInput;

		const detachLabel = document.createElement("label");
		detachLabel.className = "plain-git-worktree-view-detach-label";
		const detachCheckbox = document.createElement("input");
		detachCheckbox.type = "checkbox";
		detachCheckbox.setAttribute("aria-label", "Detach HEAD");
		this.#detachCheckbox = detachCheckbox;
		detachLabel.append(detachCheckbox, document.createTextNode(" Detach HEAD"));

		const addButton = document.createElement("button");
		addButton.type = "button";
		addButton.className = "plain-git-worktree-view-add-button";
		addButton.textContent = "Add Worktree";
		this._register(
			addDisposableListener(addButton, "click", () => {
				void this.addWorktree();
			}),
		);

		const refreshButton = document.createElement("button");
		refreshButton.type = "button";
		refreshButton.className = "plain-git-worktree-view-action";
		refreshButton.textContent = "Refresh Worktrees";
		this._register(
			addDisposableListener(refreshButton, "click", () => {
				void this.refresh();
			}),
		);

		const entriesHeading = document.createElement("div");
		entriesHeading.className = "plain-git-worktree-view-group-heading";
		entriesHeading.textContent = "Worktrees";

		const entryList = document.createElement("ul");
		entryList.className = "plain-git-worktree-view-entry-list";
		this.#entryList = entryList;

		const detail = document.createElement("pre");
		detail.className = "plain-git-worktree-view-detail";
		this.#detailElement = detail;

		container.append(
			message,
			addHeading,
			addNotice,
			childSegmentInput,
			commitIshInput,
			detachLabel,
			addButton,
			refreshButton,
			entriesHeading,
			entryList,
			detail,
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
					this.#rootedBridge = undefined;
					void this.refresh();
				});
			}),
		);
		this._register(
			plainGitInvalidation.onDidInvalidate(({ rootId }) => {
				if (this.#controllerRootId === rootId && !this.#mutationInFlight) {
					void this.refresh();
				}
			}),
		);

		void this.refresh();
	}

	#getController(): PlainGitWorktreeController | undefined {
		if (configuredBridge === undefined) {
			return undefined;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		const root = plainGitRootSelection.resolve(roots);
		if (root === undefined) {
			this.#controller = undefined;
			this.#controllerRootId = undefined;
			this.#rootedBridge = undefined;
			return undefined;
		}
		if (
			this.#controller === undefined ||
			this.#controllerRootId !== root.rootId
		) {
			this.#rootedBridge = bindPlainGitBridge(configuredBridge, root.rootId);
			this.#controller = new PlainGitWorktreeController(this.#rootedBridge);
			this.#controllerRootId = root.rootId;
		}
		return this.#controller;
	}

	#setMessage(text: string | undefined): void {
		if (this.#messageElement !== undefined) {
			this.#messageElement.textContent = text ?? "";
		}
	}

	#setDetail(text: string): void {
		if (this.#detailElement !== undefined) {
			this.#detailElement.textContent = text;
		}
	}

	async refresh(): Promise<void> {
		const controller = this.#getController();
		if (controller === undefined) {
			this.#setMessage("Select a repository to view its worktrees.");
			this.#entryList?.replaceChildren();
			this.#setDetail("");
			return;
		}
		try {
			await controller.refresh();
			this.#setMessage(
				controller.truncated
					? "Showing the most recent worktrees only."
					: undefined,
			);
		} catch (error) {
			this.#setMessage(normalizeCommandError(error).message);
		}
		this.#renderEntries();
	}

	#renderEntries(): void {
		const controller = this.#getController();
		const list = this.#entryList;
		if (controller === undefined || list === undefined) {
			return;
		}
		list.textContent = "";
		for (const entry of controller.entries) {
			list.append(this.#renderEntryRow(entry));
		}
	}

	#renderEntryRow(entry: GitWorktreeEntry): HTMLElement {
		const item = document.createElement("li");
		item.className = "plain-git-worktree-view-entry";

		const label = document.createElement("span");
		label.className = "plain-git-worktree-view-entry-label";
		label.textContent = worktreeEntryLabel(entry);
		item.append(label);

		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.disabled = this.#mutationInFlight || entry.isMain;
		removeButton.textContent = "Remove";
		this._register(
			addDisposableListener(removeButton, "click", () => {
				void this.removeEntry(entry);
			}),
		);
		item.append(removeButton);

		return item;
	}

	/** Runs `mutation` against the current bridge, disabling every control for
	 * its duration and always ending in a `refresh()` — mirrors
	 * `PlainGitStashView.#runStashMutation`'s exact discipline, generalized
	 * over a return value since this domain's worktree writes report a real
	 * outcome (`GitWorktreeAddOutcome`/`GitWorktreeRemoveOutcome`), not
	 * `void`. Returns `undefined` (never throws) when the bridge is
	 * unavailable, a mutation is already in flight, or `mutation` itself
	 * rejects — the rejection is reported via `INotificationService` instead.
	 */
	async #runWorktreeMutation<T>(
		mutation: (bridge: PlainRootedGitBridge) => Promise<T>,
	): Promise<T | undefined> {
		this.#getController();
		const bridge = this.#rootedBridge;
		const rootId = this.#controllerRootId;
		if (
			bridge === undefined ||
			rootId === undefined ||
			this.#mutationInFlight
		) {
			return undefined;
		}
		this.#mutationInFlight = true;
		this.#renderEntries();
		try {
			const result = await mutation(bridge);
			plainGitInvalidation.invalidate(rootId);
			return result;
		} catch (error) {
			this.notificationService.error(normalizeCommandError(error).message);
			return undefined;
		} finally {
			this.#mutationInFlight = false;
			await this.refresh();
		}
	}

	/** Never confirmed by this method itself — see this class's own doc
	 * comment for why `worktree add` is this feature's own "低风险,不强确认"
	 * half: the native folder-picker dialog `gitWorktreeAdd` always pops
	 * server-side is itself this action's own explicit gesture. */
	private async addWorktree(): Promise<void> {
		const childSegment = this.#childSegmentInput?.value ?? "";
		const commitIshRaw = this.#commitIshInput?.value ?? "";
		const commitIsh = commitIshRaw.trim().length > 0 ? commitIshRaw : null;
		const detach = this.#detachCheckbox?.checked ?? false;
		const outcome = await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeAdd(childSegment, detach, commitIsh),
		);
		if (outcome?.kind === "added") {
			this.#setDetail(`Created worktree at ${outcome.path}`);
			if (this.#childSegmentInput !== undefined) {
				this.#childSegmentInput.value = "";
			}
			if (this.#commitIshInput !== undefined) {
				this.#commitIshInput.value = "";
			}
		}
		if (outcome?.kind === "pickerCancelled") {
			this.notificationService.info("No parent folder was chosen.");
		}
	}

	/** Always tries an unforced `gitWorktreeRemove` first (a clean worktree
	 * is removed immediately, nothing is lost); only when that first call
	 * reports back `"needsForce"` does this method route through
	 * `resolveWorktreeConfirmation` before ever retrying with `force: true` —
	 * mirrors `PlainScmView.discardResources`'s/`PlainGitStashView.popEntry`'s
	 * own "confirm before the irreversible call" contract, applied here to
	 * the *second* of two calls rather than the only one. */
	private async removeEntry(entry: GitWorktreeEntry): Promise<void> {
		const outcome = await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, false),
		);
		if (outcome !== "needsForce") {
			return;
		}
		const decision = await resolveWorktreeConfirmation(this.dialogService, {
			kind: "removeDirty",
			worktreeLabel: worktreeEntryLabel(entry),
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, true),
		);
	}
}

Object.freeze(PlainGitWorktreeView.prototype);

// Every constructor parameter must be redeclared here, not only the two this
// class adds beyond `ViewPane`'s own base ten — the DI decorator's own
// storage (`@codingame/monaco-vscode-api`'s `instantiation.js`) creates a
// *fresh* `$di$dependencies` array the first time any decorator is called on
// a given class, discarding whatever `ViewPane`'s own array would otherwise
// have been reachable through prototype inheritance, rather than appending to
// it — see `F090` S4's own real, costly discovery of this exact defect
// (`PlainGitStashView`'s own trailing comment tells the full story: declaring
// only the new services left indices 1-9 undeclared, which broke every
// sibling view's own construction in the same Source Control container, not
// just the new one). Mirrors `PlainGitStashView`'s/`PlainScmView`'s own
// identical, already-correct pattern of redeclaring every parameter index
// from 1 through this class's own last extra service.
IKeybindingService(PlainGitWorktreeView, undefined, 1);
IContextMenuService(PlainGitWorktreeView, undefined, 2);
IConfigurationService(PlainGitWorktreeView, undefined, 3);
IContextKeyService(PlainGitWorktreeView, undefined, 4);
IViewDescriptorService(PlainGitWorktreeView, undefined, 5);
IInstantiationService(PlainGitWorktreeView, undefined, 6);
IOpenerService(PlainGitWorktreeView, undefined, 7);
IThemeService(PlainGitWorktreeView, undefined, 8);
IHoverService(PlainGitWorktreeView, undefined, 9);
IDialogService(PlainGitWorktreeView, undefined, 10);
INotificationService(PlainGitWorktreeView, undefined, 11);
IWorkspaceContextService(PlainGitWorktreeView, undefined, 12);
