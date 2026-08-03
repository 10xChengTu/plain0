import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service";
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
	ISCMRepository,
	ISCMResource,
	ISCMResourceGroup,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm";
import { ISCMService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";

import type {
	GitNetworkOperation,
	GitNetworkPreviewResult,
	GitStatusResult,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { resolveDiscardConfirmation } from "./plain-scm-discard";
import {
	resolveNetworkConfirmation,
	type NetworkConfirmationKind,
} from "./plain-scm-network";
import { PlainScmProvider, PlainScmResource } from "./plain-scm-provider";
import {
	bindPlainGitBridge,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainRootedGitBridge,
} from "./plain-git-root";
import { plainGitInvalidation } from "./plain-git-invalidation";

const PLAIN_GIT_PROVIDER_ID = "plain-git";

/**
 * The reasons `PlainScmView` can be showing its "not available" message
 * instead of a registered repository's resource groups — deliberately
 * distinguished (unlike `TerminalTrustBridge`'s own three-way split for the
 * same underlying reason) because each has a different, actionable copy:
 * an empty workspace needs a folder opened, an untrusted one needs trust
 * granted (via the terminal panel's own trust prompt — this view never
 * prompts for trust itself, see this module's own doc comment), and a
 * trusted non-repository root needs nothing from the user at all.
 */
type PlainScmDisabledReason =
	| "empty-workspace"
	| "root-required"
	| "not-trusted"
	| "not-a-repository"
	| "repository-outside-root"
	| "error";

const DISABLED_MESSAGES: Readonly<Record<PlainScmDisabledReason, string>> = {
	"empty-workspace": "Open a folder to use Source Control.",
	"root-required": "Select a repository to use Source Control.",
	"not-trusted":
		"This workspace has not been granted execution trust. Grant trust (for example by starting a terminal) to use Source Control.",
	"not-a-repository": "The open folder is not a Git repository.",
	"repository-outside-root":
		"The Git repository extends outside the selected workspace root. Open the repository root to use Source Control.",
	error: "Source Control is unavailable right now.",
};

let configuredBridge: PlainBridge | undefined;

/**
 * `configurePlainScmBridge` must be called exactly once, before this view is
 * ever rendered — mirrors `plain-terminal-view.ts`'s own
 * `configurePlainTerminalBridge`/`configuredBridge` module-level wiring,
 * needed for the same reason: `scm-contribution.ts` registers this view's
 * `ctorDescriptor` at module-import time, long before `app/main.ts` has a
 * `PlainBridge` (it is only constructed inside `bootstrap()`, after
 * `initialize()` has already consumed the view registration).
 */
export function configurePlainScmBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

/** `F080` S3/F180 S5: lets `plain-scm-commands.ts`'s
 * `plain.scm.stageActiveFileHunks` command reach the same configured
 * bridge this view uses, without a second module-level bridge slot. Returns
 * `undefined` before `configurePlainScmBridge` has ever been called, exactly
 * like `configuredBridge` itself. */
export function getConfiguredPlainScmBridge(): PlainBridge | undefined {
	return configuredBridge;
}

/**
 * `F080` S2's Source Control view pane — Plain's own, hand-written
 * replacement for the vendor `SCMViewPane`
 * (`@codingame/monaco-vscode-scm-service-override`'s `scm.contribution.js`),
 * never that file. See `docs/research/2026-07-25-core-git.md` decision 1 and
 * this module's sibling `plain-scm-provider.ts` for the full audit trail:
 * `scm.contribution.js` unconditionally registers
 * `SCMHistoryItemContextContribution` (a real `IChatContextPickService`
 * dependency) and an AI "Resolve Conflicts with AI" action, and its
 * `scmInput.js`/`quickDiffModel.js` siblings each separately hard-wire an
 * `IChatEditingService`/AI-commit-message dependency this app never
 * installs (`chat-service-override` is an explicitly banned direction) —
 * the same category of "vendor contribution file is too tightly coupled to
 * an excluded domain to import at all" finding `plain-search-view.ts`'s own
 * doc comment already recorded for `SearchView`/`NotebookEditor`.
 *
 * Consumes only the clean, AI-free service seam:
 * `ISCMService.registerSCMProvider` (real implementation:
 * `@codingame/monaco-vscode-scm-service-override`'s `common/scmService.js`,
 * imported by `app/services.ts` — never that package's own aggregating
 * `index.js`, which is exactly what pulls in `scm.contribution.js`). This
 * view owns the one `PlainScmProvider` this app ever registers: discovery
 * (workspace folder → trust → `git_status`) happens in `refresh()`, called
 * once when this view mounts and again on `Plain: Refresh Source Control`
 * (`plain-scm-commands.ts`). A `.git`-adjacent-change-triggered automatic
 * refresh (decision 4's "workspace watcher 触发时刷新" half) is deliberately
 * *not* wired this slice: the only generic change signal available
 * (`PlainWorkspaceFileSystemProvider.onDidChangeFile`, `app/main.ts`) is
 * validated by `scripts/plain/boundary-contracts.mjs`'s
 * `validateWorkspaceProviderBootstrap` as a closed-use-list surface (only its
 * declaration, the delete coordinator, and custom-provider registration are
 * permitted call sites), and whether it even observes `.git`-internal
 * changes (`index`, `HEAD`, refs) in the first place — as opposed to being
 * filtered the way many file watchers filter dotfiles — is unverified.
 * Deferred to a later slice per the research doc's own "若成本高可留 S3/S4
 * 并如实标注" allowance; `Plain: Refresh Source Control` is the only refresh
 * path this slice ships.
 *
 * Deliberately never prompts for workspace trust itself (unlike
 * `plain-terminal-trust.ts`'s active, user-initiated flow): fetching git
 * status is a passive background read a view merely appearing on screen
 * triggers, and popping an unsolicited "trust this workspace?" dialog for
 * that would be a surprising side effect of just opening a sidebar panel.
 * An untrusted workspace instead renders `DISABLED_MESSAGES["not-trusted"]`
 * and does nothing further until trust is granted through another surface
 * (today, only the terminal's own prompt) and `refresh()` is called again.
 */
export class PlainScmView extends ViewPane {
	static readonly ID = "plain.workbench.view.scm";

	#provider: PlainScmProvider | undefined;
	#repository: ISCMRepository | undefined;
	#disabledReason: PlainScmDisabledReason | undefined = "empty-workspace";
	#generation = 0;
	#lastBranch: GitStatusResult["branch"] | undefined;
	#rootedBridge: PlainRootedGitBridge | undefined;
	#rootId: string | undefined;

	#rootSelectorElement: HTMLSelectElement | undefined;
	#messageElement: HTMLElement | undefined;
	#branchElement: HTMLElement | undefined;
	#inputElement: HTMLTextAreaElement | undefined;
	#amendCheckbox: HTMLInputElement | undefined;
	#commitButton: HTMLButtonElement | undefined;
	#stageAllButton: HTMLButtonElement | undefined;
	#discardAllButton: HTMLButtonElement | undefined;
	#unstageAllButton: HTMLButtonElement | undefined;
	#workingTreeList: HTMLElement | undefined;
	#stagedList: HTMLElement | undefined;
	#fetchButton: HTMLButtonElement | undefined;
	#pullButton: HTMLButtonElement | undefined;
	#pushButton: HTMLButtonElement | undefined;
	#forcePushCheckbox: HTMLInputElement | undefined;
	#cancelNetworkButton: HTMLButtonElement | undefined;
	/** Set while a commit/stage/unstage/discard call is in flight, so a
	 * second click cannot race the first — cleared (and followed by a
	 * `refresh()`) once the call settles either way. */
	#mutationInFlight = false;
	/** Set only while a `fetch`/`pull`/`push` call specifically is in flight
	 * (a subset of `#mutationInFlight`) — controls whether
	 * `#cancelNetworkButton` is enabled. `F080` S4's own user-reachable half
	 * of `GitExecMode::Network`'s cooperative cancellation: this mode's
	 * timeout is much longer than any local write's, so a stuck fetch/pull/
	 * push needs a real way to abort early (see
	 * `PlainBridge.gitNetworkCancel`'s own doc comment). */
	#networkMutationInFlight = false;
	#rootRefreshQueued = false;

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
		private readonly scmService: ISCMService,
		private readonly modelService: IModelService,
		private readonly editorService: IEditorService,
		private readonly dialogService: IDialogService,
		private readonly notificationService: INotificationService,
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
		container.classList.add("plain-scm-view-body");

		const rootRow = document.createElement("label");
		rootRow.className = "plain-scm-view-root-row";
		rootRow.append(document.createTextNode("Repository"));
		const rootSelector = document.createElement("select");
		rootSelector.className = "plain-scm-view-root-select";
		rootSelector.setAttribute("aria-label", "Source Control Repository");
		this.#rootSelectorElement = rootSelector;
		rootRow.append(rootSelector);
		this._register(
			addDisposableListener(rootSelector, "change", () => {
				const roots = plainGitRootsFromWorkspaceFolders(
					this.workspaceContextService.getWorkspace().folders,
				);
				const rootId = rootSelector.value || undefined;
				if (!plainGitRootSelection.select(rootId, roots)) {
					return;
				}
			}),
		);
		this._register(
			plainGitRootSelection.onDidChange(() => {
				if (this.#rootRefreshQueued) {
					return;
				}
				this.#rootRefreshQueued = true;
				queueMicrotask(() => {
					this.#rootRefreshQueued = false;
					this.#generation += 1;
					this.teardownRepository();
					void this.refresh();
				});
			}),
		);
		this._register(
			plainGitInvalidation.onDidInvalidate(({ rootId }) => {
				if (this.#rootId === rootId && !this.#mutationInFlight) {
					void this.refresh();
				}
			}),
		);

		const branch = document.createElement("div");
		branch.className = "plain-scm-view-branch";
		this.#branchElement = branch;

		const networkRow = document.createElement("div");
		networkRow.className = "plain-scm-view-network-row";

		const fetchButton = document.createElement("button");
		fetchButton.type = "button";
		fetchButton.className = "plain-scm-view-network-action";
		fetchButton.textContent = "Fetch";
		this.#fetchButton = fetchButton;
		this._register(
			addDisposableListener(fetchButton, "click", () => {
				void this.fetchFromRemote();
			}),
		);

		const pullButton = document.createElement("button");
		pullButton.type = "button";
		pullButton.className = "plain-scm-view-network-action";
		pullButton.textContent = "Pull";
		this.#pullButton = pullButton;
		this._register(
			addDisposableListener(pullButton, "click", () => {
				void this.pullFromRemote();
			}),
		);

		const pushButton = document.createElement("button");
		pushButton.type = "button";
		pushButton.className = "plain-scm-view-network-action";
		pushButton.textContent = "Push";
		this.#pushButton = pushButton;
		this._register(
			addDisposableListener(pushButton, "click", () => {
				void this.pushToRemote();
			}),
		);

		const forcePushLabel = document.createElement("label");
		forcePushLabel.className = "plain-scm-view-force-push-label";
		const forcePushCheckbox = document.createElement("input");
		forcePushCheckbox.type = "checkbox";
		forcePushCheckbox.setAttribute("aria-label", "Force Push (with lease)");
		this.#forcePushCheckbox = forcePushCheckbox;
		forcePushLabel.append(forcePushCheckbox, document.createTextNode(" Force"));

		const cancelNetworkButton = document.createElement("button");
		cancelNetworkButton.type = "button";
		cancelNetworkButton.className = "plain-scm-view-network-cancel";
		cancelNetworkButton.textContent = "Cancel";
		this.#cancelNetworkButton = cancelNetworkButton;
		this._register(
			addDisposableListener(cancelNetworkButton, "click", () => {
				this.cancelNetworkOperation();
			}),
		);

		networkRow.append(
			fetchButton,
			pullButton,
			forcePushLabel,
			pushButton,
			cancelNetworkButton,
		);

		const message = document.createElement("div");
		message.className = "plain-scm-view-message";
		message.setAttribute("role", "status");
		this.#messageElement = message;

		const input = document.createElement("textarea");
		input.className = "plain-scm-view-input";
		input.placeholder = "Message";
		input.setAttribute("aria-label", "Commit Message");
		this.#inputElement = input;
		this._register(
			addDisposableListener(input, "input", () => {
				this.#repository?.input.setValue(input.value, true);
			}),
		);

		const commitRow = document.createElement("div");
		commitRow.className = "plain-scm-view-commit-row";

		const amendLabel = document.createElement("label");
		amendLabel.className = "plain-scm-view-amend-label";
		const amendCheckbox = document.createElement("input");
		amendCheckbox.type = "checkbox";
		amendCheckbox.setAttribute("aria-label", "Amend");
		this.#amendCheckbox = amendCheckbox;
		amendLabel.append(amendCheckbox, document.createTextNode(" Amend"));

		const commitButton = document.createElement("button");
		commitButton.type = "button";
		commitButton.className = "plain-scm-view-commit-button";
		commitButton.textContent = "Commit";
		this.#commitButton = commitButton;
		this._register(
			addDisposableListener(commitButton, "click", () => {
				void this.commitChanges();
			}),
		);
		commitRow.append(amendLabel, commitButton);

		const workingTreeHeading = document.createElement("div");
		workingTreeHeading.className = "plain-scm-view-group-heading";
		const workingTreeLabel = document.createElement("span");
		workingTreeLabel.textContent = "Changes";
		const stageAllButton = document.createElement("button");
		stageAllButton.type = "button";
		stageAllButton.className = "plain-scm-view-group-action";
		stageAllButton.textContent = "Stage All";
		this.#stageAllButton = stageAllButton;
		this._register(
			addDisposableListener(stageAllButton, "click", (event) => {
				event.stopPropagation();
				void this.stageAllWorkingTree();
			}),
		);
		const discardAllButton = document.createElement("button");
		discardAllButton.type = "button";
		discardAllButton.className = "plain-scm-view-group-action";
		discardAllButton.textContent = "Discard All";
		this.#discardAllButton = discardAllButton;
		this._register(
			addDisposableListener(discardAllButton, "click", (event) => {
				event.stopPropagation();
				void this.discardAllWorkingTree();
			}),
		);
		workingTreeHeading.append(
			workingTreeLabel,
			stageAllButton,
			discardAllButton,
		);
		const workingTreeList = document.createElement("ul");
		workingTreeList.className = "plain-scm-view-group plain-scm-view-changes";
		this.#workingTreeList = workingTreeList;

		const stagedHeading = document.createElement("div");
		stagedHeading.className = "plain-scm-view-group-heading";
		const stagedLabel = document.createElement("span");
		stagedLabel.textContent = "Staged Changes";
		const unstageAllButton = document.createElement("button");
		unstageAllButton.type = "button";
		unstageAllButton.className = "plain-scm-view-group-action";
		unstageAllButton.textContent = "Unstage All";
		this.#unstageAllButton = unstageAllButton;
		this._register(
			addDisposableListener(unstageAllButton, "click", (event) => {
				event.stopPropagation();
				void this.unstageAllStaged();
			}),
		);
		stagedHeading.append(stagedLabel, unstageAllButton);
		const stagedList = document.createElement("ul");
		stagedList.className = "plain-scm-view-group plain-scm-view-staged";
		this.#stagedList = stagedList;

		container.append(
			rootRow,
			branch,
			networkRow,
			message,
			input,
			commitRow,
			workingTreeHeading,
			workingTreeList,
			stagedHeading,
			stagedList,
		);

		this._register(
			toDisposable(() => {
				this.#generation += 1;
				this.teardownRepository();
			}),
		);

		void this.refresh();
	}

	/** Re-runs discovery (empty-workspace → trust → `git_status`) and either
	 * (re)registers/refreshes this view's one `PlainScmProvider`, or tears it
	 * down and renders `DISABLED_MESSAGES[reason]`. Public so both the
	 * `Plain: Refresh Source Control` command and `app/main.ts`'s
	 * best-effort workspace-file-change hook can call it. */
	async refresh(): Promise<void> {
		if (configuredBridge === undefined) {
			throw new Error("PlainScmView was used before configurePlainScmBridge");
		}
		const generation = this.#generation;
		const bridge = configuredBridge;

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			plainGitRootSelection.synchronize([]);
			this.teardownRepository();
			this.#disabledReason = "empty-workspace";
			this.renderState();
			return;
		}
		const roots = plainGitRootsFromWorkspaceFolders(folders);
		if (roots.length !== folders.length) {
			this.teardownRepository();
			this.#disabledReason = "error";
			this.renderState();
			return;
		}
		const selectedRoot = plainGitRootSelection.resolve(roots);
		if (selectedRoot === undefined) {
			this.teardownRepository();
			this.#disabledReason = "root-required";
			this.renderState();
			return;
		}
		const rootedBridge = bindPlainGitBridge(bridge, selectedRoot.rootId);

		let trusted: boolean;
		try {
			trusted = (await bridge.workspaceTrustState()).trusted;
		} catch {
			if (generation !== this.#generation) {
				return;
			}
			this.teardownRepository();
			this.#disabledReason = "error";
			this.renderState();
			return;
		}
		if (generation !== this.#generation) {
			return;
		}
		if (!trusted) {
			this.teardownRepository();
			this.#disabledReason = "not-trusted";
			this.renderState();
			return;
		}

		try {
			const status = await rootedBridge.gitStatus();
			if (generation !== this.#generation) {
				return;
			}
			if (
				this.#provider === undefined ||
				this.#provider.rootUri.authority !== selectedRoot.rootId
			) {
				this.teardownRepository();
				const provider = new PlainScmProvider(
					PLAIN_GIT_PROVIDER_ID,
					selectedRoot.uri,
					rootedBridge,
					this.editorService,
					this.modelService,
				);
				this.#provider = provider;
				this.#repository = this.scmService.registerSCMProvider(provider);
			}
			this.#rootedBridge = rootedBridge;
			this.#rootId = selectedRoot.rootId;
			this.#provider.applyStatus(status);
			this.#lastBranch = status.branch;
			this.#disabledReason = undefined;
			this.renderState();
		} catch (error) {
			if (generation !== this.#generation) {
				return;
			}
			this.teardownRepository();
			const normalized = normalizeCommandError(error);
			this.#disabledReason =
				normalized.code === "GIT_NO_REPOSITORY"
					? "not-a-repository"
					: normalized.code === "GIT_REPOSITORY_OUTSIDE_ROOT"
						? "repository-outside-root"
						: "error";
			this.renderState();
		}
	}

	private teardownRepository(): void {
		this.#repository?.dispose();
		this.#repository = undefined;
		this.#provider = undefined;
		this.#lastBranch = undefined;
		this.#rootedBridge = undefined;
		this.#rootId = undefined;
	}

	private renderRootSelector(): void {
		const selector = this.#rootSelectorElement;
		if (selector === undefined) {
			return;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
		const selected = plainGitRootSelection.resolve(roots);
		const options: HTMLOptionElement[] = [];
		if (roots.length !== 1) {
			const placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.textContent = "Select a repository…";
			options.push(placeholder);
		}
		for (const root of roots) {
			const option = document.createElement("option");
			option.value = root.rootId;
			option.textContent = root.label;
			options.push(option);
		}
		selector.replaceChildren(...options);
		selector.value = selected?.rootId ?? "";
		selector.disabled = roots.length < 2 || this.#mutationInFlight;
	}

	private renderState(): void {
		this.renderRootSelector();
		if (
			this.#rootSelectorElement === undefined ||
			this.#messageElement === undefined ||
			this.#branchElement === undefined ||
			this.#inputElement === undefined ||
			this.#amendCheckbox === undefined ||
			this.#commitButton === undefined ||
			this.#stageAllButton === undefined ||
			this.#discardAllButton === undefined ||
			this.#unstageAllButton === undefined ||
			this.#workingTreeList === undefined ||
			this.#stagedList === undefined ||
			this.#fetchButton === undefined ||
			this.#pullButton === undefined ||
			this.#pushButton === undefined ||
			this.#forcePushCheckbox === undefined ||
			this.#cancelNetworkButton === undefined
		) {
			return;
		}
		const provider = this.#provider;
		if (this.#disabledReason !== undefined || provider === undefined) {
			this.#messageElement.textContent =
				this.#disabledReason !== undefined
					? DISABLED_MESSAGES[this.#disabledReason]
					: DISABLED_MESSAGES.error;
			this.#branchElement.textContent = "";
			this.#inputElement.value = "";
			this.#inputElement.disabled = true;
			this.#amendCheckbox.disabled = true;
			this.#commitButton.disabled = true;
			this.#stageAllButton.disabled = true;
			this.#discardAllButton.disabled = true;
			this.#unstageAllButton.disabled = true;
			this.#fetchButton.disabled = true;
			this.#pullButton.disabled = true;
			this.#pushButton.disabled = true;
			this.#forcePushCheckbox.disabled = true;
			this.#cancelNetworkButton.disabled = true;
			this.#workingTreeList.replaceChildren();
			this.#stagedList.replaceChildren();
			return;
		}

		this.#messageElement.textContent = "";
		this.#branchElement.textContent =
			this.#lastBranch !== undefined ? formatBranchLabel(this.#lastBranch) : "";
		const controlsDisabled = this.#mutationInFlight;
		this.#inputElement.disabled = controlsDisabled;
		this.#amendCheckbox.disabled = controlsDisabled;
		this.#commitButton.disabled = controlsDisabled;
		this.#stageAllButton.disabled = controlsDisabled;
		this.#discardAllButton.disabled = controlsDisabled;
		this.#unstageAllButton.disabled = controlsDisabled;
		this.#fetchButton.disabled = controlsDisabled;
		this.#pullButton.disabled = controlsDisabled;
		this.#pushButton.disabled = controlsDisabled;
		this.#forcePushCheckbox.disabled = controlsDisabled;
		this.#cancelNetworkButton.disabled = !this.#networkMutationInFlight;
		if (this.#repository !== undefined) {
			this.#inputElement.value = this.#repository.input.value;
		}

		const [workingTreeGroup, stagedGroup] = provider.groups;
		this.#workingTreeList.replaceChildren(
			...renderResourceItems(workingTreeGroup, controlsDisabled, {
				onActivate: (resource) => {
					void resource.open(false);
				},
				onStage: (resource) => {
					void this.stageResource(resource.relativePath);
				},
				onDiscard: (resource) => {
					void this.discardResources([resource.relativePath]);
				},
			}),
		);
		this.#stagedList.replaceChildren(
			...renderResourceItems(stagedGroup, controlsDisabled, {
				onActivate: (resource) => {
					void resource.open(false);
				},
				onUnstage: (resource) => {
					void this.unstageResource(resource.relativePath);
				},
			}),
		);
	}

	/** Runs `mutation`, disabling every control for its duration (see
	 * `#mutationInFlight`) and always ending in a `refresh()` — success or
	 * failure — so the view never shows a stale status after a write. Errors
	 * are reported via `INotificationService`, never left as an unhandled
	 * rejection or a silently stale UI. */
	private async runGitMutation(
		mutation: (bridge: PlainRootedGitBridge) => Promise<void>,
	): Promise<void> {
		const bridge = this.#rootedBridge;
		const rootId = this.#rootId;
		if (
			bridge === undefined ||
			rootId === undefined ||
			this.#mutationInFlight
		) {
			return;
		}
		this.#mutationInFlight = true;
		this.renderState();
		try {
			await mutation(bridge);
			plainGitInvalidation.invalidate(rootId);
		} catch (error) {
			this.notificationService.error(normalizeCommandError(error).message);
		} finally {
			this.#mutationInFlight = false;
			await this.refresh();
		}
	}

	private async stageResource(relativePath: string): Promise<void> {
		await this.runGitMutation((bridge) => bridge.gitStagePaths([relativePath]));
	}

	private async unstageResource(relativePath: string): Promise<void> {
		await this.runGitMutation((bridge) =>
			bridge.gitUnstagePaths([relativePath]),
		);
	}

	private async stageAllWorkingTree(): Promise<void> {
		const paths = this.#discardableWorkingTreePaths(true);
		if (paths.length === 0) {
			return;
		}
		await this.runGitMutation((bridge) => bridge.gitStagePaths(paths));
	}

	private async unstageAllStaged(): Promise<void> {
		const group = this.#provider?.groups[1];
		const paths = (group?.resources ?? [])
			.filter(
				(resource): resource is PlainScmResource =>
					resource instanceof PlainScmResource,
			)
			.map((resource) => resource.relativePath);
		if (paths.length === 0) {
			return;
		}
		await this.runGitMutation((bridge) => bridge.gitUnstagePaths(paths));
	}

	/** Every Working Tree resource's relative path — `includeUndiscardable`
	 * controls whether untracked/conflicted entries (which `gitStagePaths`
	 * can stage but `gitDiscardPaths` cannot discard — see
	 * `PlainScmResource.statusChar`'s own doc comment) are included. */
	#discardableWorkingTreePaths(includeUndiscardable: boolean): string[] {
		const group = this.#provider?.groups[0];
		return (group?.resources ?? [])
			.filter(
				(resource): resource is PlainScmResource =>
					resource instanceof PlainScmResource,
			)
			.filter(
				(resource) =>
					includeUndiscardable ||
					(!resource.isConflict && resource.statusChar !== "?"),
			)
			.map((resource) => resource.relativePath);
	}

	/** Requires explicit confirmation before ever calling `gitDiscardPaths` —
	 * acceptance criterion 5's "破坏性动作预览影响 + 要求确认". The actual
	 * confirm/decline decision (message/detail construction and the
	 * no-op/confirmed/declined state machine) lives in the DOM/service-free
	 * `plain-scm-discard.ts` — see that module's own doc comment for why it
	 * is unit-tested there directly rather than only through this view. */
	private async discardResources(
		relativePaths: readonly string[],
	): Promise<void> {
		const decision = await resolveDiscardConfirmation(
			this.dialogService,
			relativePaths,
		);
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);
	}

	private async discardAllWorkingTree(): Promise<void> {
		await this.discardResources(this.#discardableWorkingTreePaths(false));
	}

	/** Runs a network `mutation` (`gitFetch`/`gitPull`/`gitPush`), tracking
	 * `#networkMutationInFlight` (so `#cancelNetworkButton` becomes enabled)
	 * in addition to everything `runGitMutation` already does. */
	private async runNetworkMutation(
		mutation: (bridge: PlainRootedGitBridge) => Promise<void>,
	): Promise<void> {
		const bridge = this.#rootedBridge;
		const rootId = this.#rootId;
		if (
			bridge === undefined ||
			rootId === undefined ||
			this.#mutationInFlight
		) {
			return;
		}
		this.#mutationInFlight = true;
		this.#networkMutationInFlight = true;
		this.renderState();
		try {
			await mutation(bridge);
			plainGitInvalidation.invalidate(rootId);
		} catch (error) {
			this.notificationService.error(normalizeCommandError(error).message);
		} finally {
			this.#mutationInFlight = false;
			this.#networkMutationInFlight = false;
			await this.refresh();
		}
	}

	/** Computes the ahead/behind preview for `kind` — never calls
	 * `gitFetch`/`gitPull`/`gitPush` itself. Returns `undefined` (reporting
	 * the error, never falling back to executing anyway) whenever the
	 * preview cannot be computed, satisfying acceptance criterion 5's "不得
	 * fail-open": a caller that gets `undefined` back must not proceed. */
	private async previewNetworkOperation(
		kind: NetworkConfirmationKind,
	): Promise<GitNetworkPreviewResult | undefined> {
		const bridge = this.#rootedBridge;
		if (bridge === undefined) {
			return undefined;
		}
		const operation: GitNetworkOperation = kind === "forcePush" ? "push" : kind;
		try {
			return await bridge.gitNetworkPreview(operation);
		} catch (error) {
			this.notificationService.error(normalizeCommandError(error).message);
			return undefined;
		}
	}

	/** Best-effort: requests cancellation of whatever `fetch`/`pull`/`push`
	 * call is currently in flight (a no-op if none is). Never itself resolves
	 * the in-flight call — that call's own `await` (inside
	 * `runNetworkMutation`) settles on its own once the cancelled subprocess
	 * actually exits. */
	private cancelNetworkOperation(): void {
		void this.#rootedBridge?.gitNetworkCancel();
	}

	private async fetchFromRemote(): Promise<void> {
		const preview = await this.previewNetworkOperation("fetch");
		if (preview === undefined) {
			return;
		}
		const decision = await resolveNetworkConfirmation(this.dialogService, {
			kind: "fetch",
			preview,
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runNetworkMutation((bridge) => bridge.gitFetch());
	}

	private async pullFromRemote(): Promise<void> {
		const preview = await this.previewNetworkOperation("pull");
		if (preview === undefined) {
			return;
		}
		const decision = await resolveNetworkConfirmation(this.dialogService, {
			kind: "pull",
			preview,
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runNetworkMutation((bridge) => bridge.gitPull());
	}

	private async pushToRemote(): Promise<void> {
		const force = this.#forcePushCheckbox?.checked ?? false;
		const kind = force ? "forcePush" : "push";
		const preview = await this.previewNetworkOperation(kind);
		if (preview === undefined) {
			return;
		}
		const decision = await resolveNetworkConfirmation(this.dialogService, {
			kind,
			preview,
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runNetworkMutation((bridge) => bridge.gitPush(force));
	}

	/** Reads the live `ISCMInput` value (kept in sync with `#inputElement` by
	 * the `renderBody`-registered `input` listener) rather than
	 * `#inputElement.value` directly — the two are equivalent today, but
	 * routing through the repository's own input is the same seam a future
	 * "commit via Command Palette while the view is not focused" path would
	 * need anyway. */
	private async commitChanges(): Promise<void> {
		const message = this.#repository?.input.value ?? this.#inputElement?.value;
		if (message === undefined) {
			return;
		}
		const amend = this.#amendCheckbox?.checked ?? false;
		await this.runGitMutation(async (bridge) => {
			await bridge.gitCommit(message, amend);
			this.#repository?.input.setValue("", true);
		});
	}
}

/** `"main"`, `"main ↓2↑1"` (behind/ahead an upstream), or `"(detached)"`/
 * `"(initial)"` verbatim for the two literal tokens `GitBranch.head`/`.oid`
 * use for those states — see `src-tauri/src/git/dto.rs`'s `GitBranchWire`
 * doc comment for why those are safe, unambiguous literals rather than a
 * separate flag. */
function formatBranchLabel(branch: GitStatusResult["branch"]): string {
	const upstream = branch.upstream;
	if (upstream === null) {
		return branch.head;
	}
	const parts: string[] = [branch.head];
	if (upstream.behind > 0) {
		parts.push(`↓${upstream.behind}`);
	}
	if (upstream.ahead > 0) {
		parts.push(`↑${upstream.ahead}`);
	}
	return parts.join(" ");
}

interface ResourceItemActions {
	readonly onActivate: (resource: ISCMResource) => void;
	/** Present only for Working Tree resources. */
	readonly onStage?: (resource: PlainScmResource) => void;
	/** Present only for Working Tree resources whose `statusChar` is not
	 * `"?"` and are not conflicted — see `PlainScmView.
	 * #discardableWorkingTreePaths`'s own doc comment for why. */
	readonly onDiscard?: (resource: PlainScmResource) => void;
	/** Present only for Staged resources. */
	readonly onUnstage?: (resource: PlainScmResource) => void;
}

function renderResourceItems(
	group: ISCMResourceGroup | undefined,
	controlsDisabled: boolean,
	actions: ResourceItemActions,
): HTMLLIElement[] {
	if (group === undefined) {
		return [];
	}
	return group.resources.map((resource) => {
		const item = document.createElement("li");
		item.className = "plain-scm-view-resource";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "plain-scm-view-resource-button";
		button.title = resource.decorations.tooltip ?? "";
		button.textContent = resource.sourceUri.path.replace(/^\//, "");
		button.addEventListener("click", () => actions.onActivate(resource));
		item.append(button);

		if (resource instanceof PlainScmResource) {
			if (actions.onStage !== undefined) {
				item.append(
					createResourceActionButton("Stage", controlsDisabled, () =>
						actions.onStage?.(resource),
					),
				);
			}
			if (
				actions.onDiscard !== undefined &&
				!resource.isConflict &&
				resource.statusChar !== "?"
			) {
				item.append(
					createResourceActionButton("Discard", controlsDisabled, () =>
						actions.onDiscard?.(resource),
					),
				);
			}
			if (actions.onUnstage !== undefined) {
				item.append(
					createResourceActionButton("Unstage", controlsDisabled, () =>
						actions.onUnstage?.(resource),
					),
				);
			}
		}
		return item;
	});
}

function createResourceActionButton(
	label: string,
	disabled: boolean,
	onClick: () => void,
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "plain-scm-view-resource-action";
	button.textContent = label;
	button.disabled = disabled;
	button.addEventListener("click", (event) => {
		event.stopPropagation();
		onClick();
	});
	return button;
}

Object.freeze(PlainScmView.prototype);

IKeybindingService(PlainScmView, undefined, 1);
IContextMenuService(PlainScmView, undefined, 2);
IConfigurationService(PlainScmView, undefined, 3);
IContextKeyService(PlainScmView, undefined, 4);
IViewDescriptorService(PlainScmView, undefined, 5);
IInstantiationService(PlainScmView, undefined, 6);
IOpenerService(PlainScmView, undefined, 7);
IThemeService(PlainScmView, undefined, 8);
IHoverService(PlainScmView, undefined, 9);
IWorkspaceContextService(PlainScmView, undefined, 10);
ISCMService(PlainScmView, undefined, 11);
IModelService(PlainScmView, undefined, 12);
IEditorService(PlainScmView, undefined, 13);
IDialogService(PlainScmView, undefined, 14);
INotificationService(PlainScmView, undefined, 15);
