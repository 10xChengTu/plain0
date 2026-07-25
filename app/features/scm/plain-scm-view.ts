import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { IModelService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service";
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
import type {
	ISCMRepository,
	ISCMResource,
	ISCMResourceGroup,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm";
import { ISCMService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";

import type {
	GitStatusResult,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { PlainScmProvider } from "./plain-scm-provider";

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
	"empty-workspace" | "not-trusted" | "not-a-repository" | "error";

const DISABLED_MESSAGES: Readonly<Record<PlainScmDisabledReason, string>> = {
	"empty-workspace": "Open a folder to use Source Control.",
	"not-trusted":
		"This workspace has not been granted execution trust. Grant trust (for example by starting a terminal) to use Source Control.",
	"not-a-repository": "The open folder is not a Git repository.",
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

	#messageElement: HTMLElement | undefined;
	#branchElement: HTMLElement | undefined;
	#inputElement: HTMLTextAreaElement | undefined;
	#workingTreeList: HTMLElement | undefined;
	#stagedList: HTMLElement | undefined;

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

		const branch = document.createElement("div");
		branch.className = "plain-scm-view-branch";
		this.#branchElement = branch;

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

		const workingTreeHeading = document.createElement("div");
		workingTreeHeading.className = "plain-scm-view-group-heading";
		workingTreeHeading.textContent = "Changes";
		const workingTreeList = document.createElement("ul");
		workingTreeList.className = "plain-scm-view-group plain-scm-view-changes";
		this.#workingTreeList = workingTreeList;

		const stagedHeading = document.createElement("div");
		stagedHeading.className = "plain-scm-view-group-heading";
		stagedHeading.textContent = "Staged Changes";
		const stagedList = document.createElement("ul");
		stagedList.className = "plain-scm-view-group plain-scm-view-staged";
		this.#stagedList = stagedList;

		container.append(
			branch,
			message,
			input,
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
			this.teardownRepository();
			this.#disabledReason = "empty-workspace";
			this.renderState();
			return;
		}

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
			const status = await bridge.gitStatus();
			if (generation !== this.#generation) {
				return;
			}
			if (this.#provider === undefined) {
				const provider = new PlainScmProvider(
					PLAIN_GIT_PROVIDER_ID,
					folders[0]!.uri,
					bridge,
					this.editorService,
					this.modelService,
				);
				this.#provider = provider;
				this.#repository = this.scmService.registerSCMProvider(provider);
			}
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
				normalized.code === "GIT_NO_REPOSITORY" ? "not-a-repository" : "error";
			this.renderState();
		}
	}

	private teardownRepository(): void {
		this.#repository?.dispose();
		this.#repository = undefined;
		this.#provider = undefined;
		this.#lastBranch = undefined;
	}

	private renderState(): void {
		if (
			this.#messageElement === undefined ||
			this.#branchElement === undefined ||
			this.#inputElement === undefined ||
			this.#workingTreeList === undefined ||
			this.#stagedList === undefined
		) {
			return;
		}
		if (this.#disabledReason !== undefined || this.#provider === undefined) {
			this.#messageElement.textContent =
				this.#disabledReason !== undefined
					? DISABLED_MESSAGES[this.#disabledReason]
					: DISABLED_MESSAGES.error;
			this.#branchElement.textContent = "";
			this.#inputElement.value = "";
			this.#inputElement.disabled = true;
			this.#workingTreeList.replaceChildren();
			this.#stagedList.replaceChildren();
			return;
		}

		this.#messageElement.textContent = "";
		this.#branchElement.textContent =
			this.#lastBranch !== undefined ? formatBranchLabel(this.#lastBranch) : "";
		this.#inputElement.disabled = false;
		if (this.#repository !== undefined) {
			this.#inputElement.value = this.#repository.input.value;
		}

		const [workingTreeGroup, stagedGroup] = this.#provider.groups;
		this.#workingTreeList.replaceChildren(
			...renderResourceItems(workingTreeGroup, (resource) => {
				void resource.open(false);
			}),
		);
		this.#stagedList.replaceChildren(
			...renderResourceItems(stagedGroup, (resource) => {
				void resource.open(false);
			}),
		);
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

function renderResourceItems(
	group: ISCMResourceGroup | undefined,
	onActivate: (resource: ISCMResource) => void,
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
		button.addEventListener("click", () => onActivate(resource));
		item.append(button);
		return item;
	});
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
