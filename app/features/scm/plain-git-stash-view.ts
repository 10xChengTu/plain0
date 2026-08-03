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
	GitStashEntry,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { plainGitInvalidation } from "./plain-git-invalidation";
import { PlainGitStashController, stashEntryLabel } from "./plain-git-stash";
import {
	bindPlainGitBridge,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainRootedGitBridge,
} from "./plain-git-root";
import { resolveStashConfirmation } from "./plain-scm-stash";

let configuredBridge: PlainBridge | undefined;

/**
 * `configurePlainGitStashBridge` must be called exactly once, before this
 * view is ever rendered — mirrors `plain-git-graph-view.ts`'s own
 * `configurePlainGitGraphBridge`/`configuredBridge` module-level wiring,
 * needed for the same reason: `scm-contribution.ts` registers this view's
 * `ctorDescriptor` at module-import time, long before `app/main.ts` has a
 * `PlainBridge`.
 */
export function configurePlainGitStashBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

/**
 * `F090` S4's stash panel (`docs/research/2026-07-26-git-history.md`'s
 * slice 5) — Plain's own, hand-written view, registered alongside
 * `PlainScmView`/`PlainGitHistoryView`/`PlainGitGraphView` in the same
 * Source Control view container (see `scm-contribution.ts`). Never consumes
 * `ISCMProvider.historyProvider` (still `constObservable(undefined)`, per
 * every earlier `F090` slice's own established boundary) and never any
 * vendor stash/GitLens code — a from-scratch UI over this domain's own
 * `git::stash` Rust module.
 *
 * Confirmation split (per this feature's own frozen plan and
 * `plain-scm-stash.ts`'s own module doc comment): `popEntry`/`dropEntry`
 * always route through `resolveStashConfirmation` first (mirrors
 * `PlainScmView.discardResources`'s "confirm first, the bridge call itself
 * never re-confirms" contract); `pushChanges`/`applyEntry` never show a
 * blocking dialog at all — `renderBody`'s own static UI copy is this
 * feature's "提示,不强确认" half for those two instead.
 *
 * Scope note (disclosed, not an oversight): `showEntry`'s own file list is
 * rendered as a plain inline list (path + change kind + added/deleted
 * counts) rather than wired into the `multi-diff-editor` machinery `F090`
 * S2's `plain-git-commit-detail.ts` already established for commit details
 * — this slice's own emphasis is the Rust-side safety design and the
 * confirmation-boundary contract, not a second multi-diff integration; the
 * underlying `git_stash_show`/`git_show_commit_blob` (the latter already
 * generic over any commit sha, including a stash's own) are both real and
 * already wired for a future slice to reuse.
 */
export class PlainGitStashView extends ViewPane {
	static readonly ID = "plain.workbench.view.gitStash";

	#controller: PlainGitStashController | undefined;
	#controllerRootId: string | undefined;
	#rootedBridge: PlainRootedGitBridge | undefined;
	#rootRefreshQueued = false;
	#messageElement: HTMLElement | undefined;
	#pushMessageInput: HTMLTextAreaElement | undefined;
	#includeUntrackedCheckbox: HTMLInputElement | undefined;
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
		container.classList.add("plain-git-stash-view-body");

		const message = document.createElement("div");
		message.className = "plain-git-stash-view-message";
		message.setAttribute("role", "status");
		this.#messageElement = message;

		const pushHeading = document.createElement("div");
		pushHeading.className = "plain-git-stash-view-group-heading";
		pushHeading.textContent = "New Stash";

		const pushNotice = document.createElement("div");
		pushNotice.className = "plain-git-stash-view-push-notice";
		pushNotice.textContent =
			"Moves all uncommitted changes into a new stash entry.";

		const pushMessageInput = document.createElement("textarea");
		pushMessageInput.className = "plain-git-stash-view-push-input";
		pushMessageInput.placeholder = "Stash message";
		pushMessageInput.setAttribute("aria-label", "Stash Message");
		this.#pushMessageInput = pushMessageInput;

		const includeUntrackedLabel = document.createElement("label");
		includeUntrackedLabel.className =
			"plain-git-stash-view-include-untracked-label";
		const includeUntrackedCheckbox = document.createElement("input");
		includeUntrackedCheckbox.type = "checkbox";
		includeUntrackedCheckbox.setAttribute(
			"aria-label",
			"Include Untracked Files",
		);
		this.#includeUntrackedCheckbox = includeUntrackedCheckbox;
		includeUntrackedLabel.append(
			includeUntrackedCheckbox,
			document.createTextNode(" Include Untracked Files"),
		);

		const pushButton = document.createElement("button");
		pushButton.type = "button";
		pushButton.className = "plain-git-stash-view-push-button";
		pushButton.textContent = "Stash Changes";
		this._register(
			addDisposableListener(pushButton, "click", () => {
				void this.pushChanges();
			}),
		);

		const refreshButton = document.createElement("button");
		refreshButton.type = "button";
		refreshButton.className = "plain-git-stash-view-action";
		refreshButton.textContent = "Refresh Stashes";
		this._register(
			addDisposableListener(refreshButton, "click", () => {
				void this.refresh();
			}),
		);

		const entriesHeading = document.createElement("div");
		entriesHeading.className = "plain-git-stash-view-group-heading";
		entriesHeading.textContent = "Stashes";

		const entryList = document.createElement("ul");
		entryList.className = "plain-git-stash-view-entry-list";
		this.#entryList = entryList;

		const detail = document.createElement("pre");
		detail.className = "plain-git-stash-view-detail";
		this.#detailElement = detail;

		container.append(
			message,
			pushHeading,
			pushNotice,
			pushMessageInput,
			includeUntrackedLabel,
			pushButton,
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

	#getController(): PlainGitStashController | undefined {
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
			this.#controller = new PlainGitStashController(this.#rootedBridge);
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
			this.#setMessage("Select a repository to view its stashes.");
			this.#entryList?.replaceChildren();
			this.#setDetail("");
			return;
		}
		try {
			await controller.refresh();
			this.#setMessage(
				controller.truncated
					? "Showing the most recent stashes only."
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

	#renderEntryRow(entry: GitStashEntry): HTMLElement {
		const item = document.createElement("li");
		item.className = "plain-git-stash-view-entry";

		const label = document.createElement("span");
		label.className = "plain-git-stash-view-entry-label";
		label.textContent = stashEntryLabel(entry);
		item.append(label);

		const controlsDisabled = this.#mutationInFlight;

		const showButton = document.createElement("button");
		showButton.type = "button";
		showButton.disabled = controlsDisabled;
		showButton.textContent = "Show";
		this._register(
			addDisposableListener(showButton, "click", () => {
				void this.showEntry(entry);
			}),
		);

		const applyButton = document.createElement("button");
		applyButton.type = "button";
		applyButton.disabled = controlsDisabled;
		applyButton.textContent = "Apply";
		this._register(
			addDisposableListener(applyButton, "click", () => {
				void this.applyEntry(entry);
			}),
		);

		const popButton = document.createElement("button");
		popButton.type = "button";
		popButton.disabled = controlsDisabled;
		popButton.textContent = "Pop";
		this._register(
			addDisposableListener(popButton, "click", () => {
				void this.popEntry(entry);
			}),
		);

		const dropButton = document.createElement("button");
		dropButton.type = "button";
		dropButton.disabled = controlsDisabled;
		dropButton.textContent = "Drop";
		this._register(
			addDisposableListener(dropButton, "click", () => {
				void this.dropEntry(entry);
			}),
		);

		item.append(showButton, applyButton, popButton, dropButton);
		return item;
	}

	/** Runs `mutation` against the current bridge, disabling every control for
	 * its duration and always ending in a `refresh()` — mirrors
	 * `PlainScmView.runGitMutation`'s exact discipline, generalized over a
	 * return value since this domain's stash writes report a real outcome
	 * (`GitStashPushOutcome`/`GitStashApplyOutcome`), not `void`. Returns
	 * `undefined` (never throws) when the bridge is unavailable, a mutation is
	 * already in flight, or `mutation` itself rejects — the rejection is
	 * reported via `INotificationService` instead. */
	async #runStashMutation<T>(
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
	 * comment for why `push`/`apply` are the "提示,不强确认" half of this
	 * feature's confirmation split. */
	private async pushChanges(): Promise<void> {
		const message = this.#pushMessageInput?.value ?? "";
		const includeUntracked = this.#includeUntrackedCheckbox?.checked ?? false;
		const outcome = await this.#runStashMutation((bridge) =>
			bridge.gitStashPush(message, includeUntracked),
		);
		if (outcome === "noLocalChanges") {
			this.notificationService.info("There were no local changes to stash.");
		}
		if (outcome === "created" && this.#pushMessageInput !== undefined) {
			this.#pushMessageInput.value = "";
		}
	}

	/** Never confirmed by this method itself — a conflicting apply never
	 * removes the stash entry (see `GitStashApplyOutcome`'s own doc comment),
	 * so at worst the entry can be re-applied or explicitly dropped
	 * afterward. */
	private async applyEntry(entry: GitStashEntry): Promise<void> {
		const outcome = await this.#runStashMutation((bridge) =>
			bridge.gitStashApply(entry.sha, false),
		);
		if (outcome?.kind === "conflict") {
			this.#setDetail(
				`Conflict applying ${stashEntryLabel(entry)}:\n${outcome.conflictedPaths.join("\n")}`,
			);
		}
	}

	/** Requires explicit confirmation before ever calling `gitStashPop` —
	 * mirrors `PlainScmView.discardResources`'s "confirm first, the bridge
	 * call itself never re-confirms" contract. A conflicting pop retains the
	 * stash entry (see `GitStashApplyOutcome`'s own doc comment) — this
	 * method's own detail rendering makes that outcome visible rather than
	 * silently discarding it. */
	private async popEntry(entry: GitStashEntry): Promise<void> {
		const decision = await resolveStashConfirmation(this.dialogService, {
			kind: "pop",
			entryLabel: stashEntryLabel(entry),
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		const outcome = await this.#runStashMutation((bridge) =>
			bridge.gitStashPop(entry.sha, false),
		);
		if (outcome?.kind === "conflict") {
			this.#setDetail(
				`Conflict popping ${stashEntryLabel(entry)} (kept in the stash list):\n${outcome.conflictedPaths.join("\n")}`,
			);
		}
	}

	/** Requires explicit confirmation before ever calling `gitStashDrop` —
	 * the same "confirm first" contract `popEntry`/`discardResources` already
	 * establish, for this feature's own irreversible write. */
	private async dropEntry(entry: GitStashEntry): Promise<void> {
		const decision = await resolveStashConfirmation(this.dialogService, {
			kind: "drop",
			entryLabel: stashEntryLabel(entry),
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.#runStashMutation((bridge) => bridge.gitStashDrop(entry.sha));
	}

	private async showEntry(entry: GitStashEntry): Promise<void> {
		this.#getController();
		const bridge = this.#rootedBridge;
		if (bridge === undefined) {
			return;
		}
		try {
			const result = await bridge.gitStashShow(entry.sha);
			const lines = result.files.map((file) => {
				const counts =
					file.binary || file.added === null || file.deleted === null
						? "binary"
						: `+${file.added} -${file.deleted}`;
				return `${file.kind}\t${counts}\t${file.path}`;
			});
			this.#setDetail(
				lines.length > 0
					? `${stashEntryLabel(entry)}:\n${lines.join("\n")}`
					: `${stashEntryLabel(entry)}: no changed files.`,
			);
		} catch (error) {
			this.#setDetail(normalizeCommandError(error).message);
		}
	}
}

Object.freeze(PlainGitStashView.prototype);

// Every constructor parameter must be redeclared here, not only the two this
// class adds beyond `ViewPane`'s own base ten — the DI decorator's own
// storage (`@codingame/monaco-vscode-api`'s `instantiation.js`) creates a
// *fresh* `$di$dependencies` array the first time any decorator is called on
// a given class, discarding whatever `ViewPane`'s own array would otherwise
// have been reachable through prototype inheritance, rather than appending to
// it. Declaring only `IDialogService`/`INotificationService` (this class's
// own two extra services) left indices 1-9 entirely undeclared for this
// class, which meant `IInstantiationService.createInstance` invoked the
// constructor with the base nine services missing — the exact regression
// a real Playwright run against this feature caught (every `PlainScmView`-
// container test failing at `.plain-scm-view-body` not appearing at all,
// because the whole view container's pane-construction pass threw and
// aborted before rendering *any* of its panes, not just this one). Mirrors
// `PlainScmView`'s own identical, already-correct pattern of redeclaring
// every parameter index from 1 through its own last extra service.
IKeybindingService(PlainGitStashView, undefined, 1);
IContextMenuService(PlainGitStashView, undefined, 2);
IConfigurationService(PlainGitStashView, undefined, 3);
IContextKeyService(PlainGitStashView, undefined, 4);
IViewDescriptorService(PlainGitStashView, undefined, 5);
IInstantiationService(PlainGitStashView, undefined, 6);
IOpenerService(PlainGitStashView, undefined, 7);
IThemeService(PlainGitStashView, undefined, 8);
IHoverService(PlainGitStashView, undefined, 9);
IDialogService(PlainGitStashView, undefined, 10);
INotificationService(PlainGitStashView, undefined, 11);
IWorkspaceContextService(PlainGitStashView, undefined, 12);
