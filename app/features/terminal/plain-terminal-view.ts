import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import { toDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { ConfigurationTarget } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration";
import { IConfigurationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service";
import { IContextKeyService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
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
	PlainBridge,
	TerminalProfile,
} from "../../platform/tauri/contracts";
import {
	PlainWorkspaceRootSelection,
	plainWorkspaceRootsFromFolders,
	type PlainWorkspaceRoot,
} from "../workspace/plain-workspace-roots";
import {
	TERMINAL_DEFAULT_CWD_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
	TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
	type TerminalCwdInputState,
	type TerminalFutureTabDefaults,
	validateFutureTabCwdInput,
} from "./plain-terminal-defaults";
import { TerminalPaneController } from "./plain-terminal-pane";
import {
	type TerminalSplitOrientation,
	TerminalTabsModel,
} from "./plain-terminal-tabs";
import {
	TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL,
	TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE,
	TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE,
} from "./plain-terminal-trust";

/**
 * Plain's own, hand-written terminal view pane. Originally (F070 "WebView
 * DOM 渲染 + trust UX") this managed exactly one PTY session inline; this
 * slice (F070 "多 tab/split/scrollback + 生命周期") turns it into a small
 * tab strip self-managed by [`TerminalTabsModel`], each tab holding one or
 * two [`TerminalPaneController`]s (a split) — see that model's own module
 * doc for why this is one self-managing view rather than N registered
 * `IViewsRegistry` views. Built from scratch on the bare `ViewPane` base
 * class, the same precedent `PlainSearchView` established: Plain never
 * imports `@codingame/monaco-vscode-terminal-service-override` or xterm.js
 * at all (see `docs/research/2026-07-24-libghostty-terminal.md`'s background
 * section).
 *
 * # Bridge wiring
 *
 * Like `plain-search-service.ts`'s `configurePlainSearchBridge`, the
 * `PlainBridge` this view needs cannot be a normal constructor parameter —
 * `configurePlainTerminalBridge` must be called exactly once, before this
 * view is ever rendered.
 *
 * # Sizing: measure, don't duplicate CSS's own flex math
 *
 * `layoutBody` (not a `ResizeObserver` on this view's own container) is
 * still the top-level resize signal this view acts on — unchanged reasoning
 * from the prior slice (`ViewPane`/`Pane` already receives a
 * `layoutBody(height, width)` call from the Workbench's own layout
 * pipeline). Below that top level, though, a split tab's two panes are laid
 * out purely by CSS flexbox (`.plain-terminal-panecontainer`'s
 * `flex-direction`, each `.plain-terminal-pane`'s `flex: 1 1 0`) — there is
 * no Workbench-provided layout signal at that finer, self-managed
 * granularity for this view to reuse. Rather than reimplementing that
 * arithmetic (and risking it drifting from whatever the CSS actually
 * renders), [`#layoutActivePanes`] simply reads each visible pane wrapper's
 * own `getBoundingClientRect()` — a synchronous, same-tick measurement taken
 * only at the handful of points this view itself already knows a layout
 * pass is needed (a `layoutBody` call, or right after this view's own
 * tab/split DOM mutation), never a second independent async signal racing
 * `layoutBody` the way an actual `ResizeObserver` would.
 *
 * # Lifecycle: hidden retains, closed releases
 *
 * Switching away from a tab (or the whole Panel becoming not-visible while
 * this view is simply not rendered, never disposed) never kills that tab's
 * session — only an explicit close (a tab's own close button, `Plain: Kill
 * Terminal`, this view being disposed, or the whole window closing via
 * Rust's `TerminalService::close_window`) does. This falls out of the
 * existing architecture with no extra code: a `ViewPane` that becomes
 * invisible is not disposed by the Workbench (only genuinely destroying the
 * view, e.g. the window closing, calls `dispose()`), so simply not tearing
 * anything down on a mere visibility change already gives "hidden retains" —
 * this view additionally applies the same rule to switching between its own
 * self-managed tabs (an inactive tab's pane(s) keep running, just
 * `display: none`), for the same reason a real browser tab or VS Code's own
 * terminal tabs do not kill a shell just because it is not the foreground
 * one right now.
 */
export class PlainTerminalView extends ViewPane {
	static readonly ID = "plain.workbench.view.terminal";

	readonly #tabsModel = new TerminalTabsModel();
	readonly #rootSelection = new PlainWorkspaceRootSelection();
	readonly #panes = new Map<string, TerminalPaneController>();
	readonly #paneElements = new Map<string, HTMLElement>();
	readonly #tabRecords = new Map<
		string,
		{ readonly tabButton: HTMLElement; readonly paneContainer: HTMLElement }
	>();

	#tabListElement: HTMLElement | undefined;
	#rootSelectorElement: HTMLSelectElement | undefined;
	#paneAreaElement: HTMLElement | undefined;
	#emptyStateElement: HTMLElement | undefined;
	#pendingNewTab = false;

	/** `F190` S2: the two future-tab-default controls plus the bounded
	 * profile snapshot they draw their options from — see this class's own
	 * `#resolveFutureTabDefaults`/`#renderProfileSelector` doc comments. */
	#profileSelectElement: HTMLSelectElement | undefined;
	#cwdInputElement: HTMLInputElement | undefined;
	#cwdHintElement: HTMLElement | undefined;
	#availableProfiles: readonly TerminalProfile[] = [];

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
		container.classList.add("plain-terminal-view-body");

		const tabStrip = document.createElement("div");
		tabStrip.className = "plain-terminal-tabstrip";
		tabStrip.setAttribute("role", "tablist");

		const tabList = document.createElement("div");
		tabList.className = "plain-terminal-tablist";
		tabStrip.append(tabList);

		const rootSelector = document.createElement("select");
		rootSelector.className = "plain-terminal-root-select";
		rootSelector.setAttribute("aria-label", "New Terminal Working Folder");
		this.#rootSelectorElement = rootSelector;
		this._register(
			addDisposableListener(rootSelector, "change", () => {
				const roots = this.#workspaceRoots();
				if (
					!this.#rootSelection.select(rootSelector.value || undefined, roots)
				) {
					return;
				}
				this.#renderRootSelector();
				if (this.#pendingNewTab) {
					this.openNewTab();
				}
			}),
		);
		tabStrip.append(rootSelector);

		// `F190` S2: the two future-tab-default controls — see
		// `#resolveFutureTabDefaults`'s doc comment for what they mean and
		// `plain-terminal-defaults.ts`'s module doc for why cwd validation here
		// is feedback only, never authority.
		const profileSelect = document.createElement("select");
		profileSelect.className = "plain-terminal-profile-select";
		profileSelect.setAttribute("aria-label", "Default Terminal Profile");
		this.#profileSelectElement = profileSelect;
		this._register(
			addDisposableListener(profileSelect, "change", () => {
				if (profileSelect.value.length === 0) {
					return;
				}
				void this.configurationService.updateValue(
					TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
					profileSelect.value,
					ConfigurationTarget.USER,
				);
			}),
		);
		tabStrip.append(profileSelect);

		const cwdInput = document.createElement("input");
		cwdInput.type = "text";
		cwdInput.className = "plain-terminal-cwd-input";
		cwdInput.setAttribute("aria-label", "Default Terminal Working Directory");
		cwdInput.placeholder = "cwd (optional)";
		this.#cwdInputElement = cwdInput;
		this._register(
			addDisposableListener(cwdInput, "input", () => {
				this.#renderCwdValidation(validateFutureTabCwdInput(cwdInput.value));
			}),
		);
		this._register(
			addDisposableListener(cwdInput, "change", () => {
				const validation = validateFutureTabCwdInput(cwdInput.value);
				this.#renderCwdValidation(validation);
				if (validation.kind === "valid") {
					void this.configurationService.updateValue(
						TERMINAL_DEFAULT_CWD_CONFIG_KEY,
						validation.cwd ?? "",
						ConfigurationTarget.USER,
					);
				}
			}),
		);
		tabStrip.append(cwdInput);

		const cwdHint = document.createElement("span");
		cwdHint.className = "plain-terminal-cwd-hint";
		cwdHint.setAttribute("aria-live", "polite");
		this.#cwdHintElement = cwdHint;
		tabStrip.append(cwdHint);

		const newTabButton = document.createElement("button");
		newTabButton.type = "button";
		newTabButton.className = "plain-terminal-tab-new";
		newTabButton.setAttribute("aria-label", "New Terminal");
		newTabButton.textContent = "+";
		this._register(
			addDisposableListener(newTabButton, "click", () => {
				this.openNewTab();
			}),
		);
		tabStrip.append(newTabButton);

		const splitRightButton = document.createElement("button");
		splitRightButton.type = "button";
		splitRightButton.className = "plain-terminal-split-button";
		splitRightButton.setAttribute("aria-label", "Split Terminal Right");
		splitRightButton.textContent = "⬓";
		this._register(
			addDisposableListener(splitRightButton, "click", () => {
				this.splitActiveTab("row");
			}),
		);
		tabStrip.append(splitRightButton);

		const splitDownButton = document.createElement("button");
		splitDownButton.type = "button";
		splitDownButton.className = "plain-terminal-split-button";
		splitDownButton.setAttribute("aria-label", "Split Terminal Down");
		splitDownButton.textContent = "⬒";
		this._register(
			addDisposableListener(splitDownButton, "click", () => {
				this.splitActiveTab("column");
			}),
		);
		tabStrip.append(splitDownButton);

		const paneArea = document.createElement("div");
		paneArea.className = "plain-terminal-panearea";

		const emptyState = document.createElement("div");
		emptyState.className = "plain-terminal-empty-state";
		emptyState.textContent = "No terminals open.";
		paneArea.append(emptyState);

		container.append(tabStrip, paneArea);
		this.#tabListElement = tabList;
		this.#paneAreaElement = paneArea;
		this.#emptyStateElement = emptyState;

		this._register(
			toDisposable(() => {
				for (const pane of this.#panes.values()) {
					pane.dispose();
				}
				this.#panes.clear();
				this.#paneElements.clear();
				this.#tabRecords.clear();
			}),
		);

		this.#renderRootSelector();
		this.#syncTabVisibility();
		this.#initFutureTabDefaultsControls();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		const paneArea = this.#paneAreaElement;
		if (paneArea === undefined) {
			return;
		}
		paneArea.style.width = `${width}px`;
		paneArea.style.height = `${height}px`;
		this.#layoutActivePanes();
	}

	override focus(): void {
		super.focus();
		const activeTabId = this.#tabsModel.activeTabId;
		if (activeTabId === undefined) {
			return;
		}
		const paneId = this.#tabsModel.getTab(activeTabId)?.paneIds[0];
		if (paneId !== undefined) {
			this.#panes.get(paneId)?.focus();
		}
	}

	/** Creates a new tab (one pane), makes it active, and lays it out
	 * immediately if this view already has a real size. `Plain: Create
	 * Terminal` calls this every time it runs (after revealing/opening this
	 * view) — see `plain-terminal-commands.ts`. */
	openNewTab(): void {
		const roots = this.#workspaceRoots();
		const root = this.#rootSelection.resolve(roots);
		this.#renderRootSelector();
		if (root === undefined) {
			this.#pendingNewTab = roots.length > 1;
			if (this.#emptyStateElement !== undefined) {
				this.#emptyStateElement.textContent =
					roots.length === 0
						? TERMINAL_TRUST_EMPTY_WORKSPACE_STATUS_MESSAGE
						: "Select a working folder to create a terminal.";
			}
			if (roots.length === 0) {
				void this.dialogService.info(
					TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE,
					TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL,
				);
				return;
			}
			this.#rootSelectorElement?.focus();
			return;
		}
		this.#pendingNewTab = false;
		// `F190` S2: computed exactly once, here, and frozen onto the new
		// tab/pane — a later change to the profile/cwd controls must never
		// redirect this tab (see `#resolveFutureTabDefaults`'s own doc
		// comment).
		const defaults = this.#resolveFutureTabDefaults();
		const { tabId, paneId } = this.#tabsModel.createTab(root, defaults);
		this.#createTabRecord(tabId);
		this.#createPane(paneId, tabId, undefined, root.rootId, defaults);
		this.#activateTab(tabId);
	}

	/**
	 * `F100` S4: creates a tab **attached** to `sessionId` — a
	 * `TerminalService` session Rust's own `runInTerminal` reverse-request
	 * handling already created (never a second, hidden spawn triggered by
	 * this call) — titled `title` so the tab strip visibly identifies it as
	 * debug-launched, per this feature's own "可见性兜底" requirement (see
	 * `plain-debug-terminal-integration.ts`, this method's sole caller, for
	 * the full flow from a real DAP `runInTerminal` reverse request to here).
	 * Otherwise identical to {@link openNewTab}: makes the new tab active
	 * and lays it out immediately — the user sees it appear and can
	 * interact with (or close/kill) it exactly like any manually-created
	 * terminal tab.
	 */
	adoptExternalSession(sessionId: string, title: string): void {
		const { tabId, paneId } = this.#tabsModel.createExternalTab(title);
		this.#createTabRecord(tabId);
		this.#createPane(paneId, tabId, sessionId);
		this.#activateTab(tabId);
	}

	/** Closes the currently active tab (killing every one of its panes'
	 * sessions) and activates whatever tab the model says is next, or shows
	 * the empty state if none remain. A no-op if there is no active tab. */
	closeActiveTab(): void {
		const activeTabId = this.#tabsModel.activeTabId;
		if (activeTabId === undefined) {
			return;
		}
		this.#closeTab(activeTabId);
	}

	/** Splits the active tab along `orientation`, adding one more pane (this
	 * slice caps a tab at two panes — see `TerminalTabsModel`'s own doc). A
	 * no-op if there is no active tab, or it is already split. */
	splitActiveTab(orientation: TerminalSplitOrientation): void {
		const activeTabId = this.#tabsModel.activeTabId;
		if (activeTabId === undefined) {
			return;
		}
		const tab = this.#tabsModel.getTab(activeTabId);
		const rootId =
			tab?.rootId ??
			this.#rootSelection.resolve(this.#workspaceRoots())?.rootId;
		if (rootId === undefined) {
			this.#rootSelectorElement?.focus();
			return;
		}
		const paneId = this.#tabsModel.splitTab(activeTabId, orientation);
		if (paneId === undefined) {
			return;
		}
		// `F190` S2: a split inherits the *active tab's own frozen* defaults
		// (never a fresh read of the current selector state) — the same
		// "inherit, don't redirect" rule `rootId` above already followed
		// since `F150`. `tab?.defaults` is only ever `undefined` for an
		// externally-adopted (`F100` S4) tab, which owns no defaults of its
		// own to inherit; falling back to a fresh resolve there mirrors what
		// this method already did for `rootId` in that same edge case.
		const defaults = tab?.defaults ?? this.#resolveFutureTabDefaults();
		this.#createPane(paneId, activeTabId, undefined, rootId, defaults);
		const record = this.#tabRecords.get(activeTabId);
		if (record !== undefined) {
			record.paneContainer.dataset.split = orientation;
		}
		this.#layoutActivePanes();
	}

	#createTabRecord(tabId: string): void {
		const paneArea = this.#paneAreaElement;
		if (paneArea === undefined) {
			return;
		}
		const tabButton = document.createElement("div");
		tabButton.className = "plain-terminal-tab";
		tabButton.setAttribute("role", "tab");
		tabButton.dataset.terminalTabId = tabId;
		tabButton.dataset.active = "false";

		const label = document.createElement("span");
		label.className = "plain-terminal-tab-label";
		label.textContent = this.#tabsModel.getTab(tabId)?.title ?? "Terminal";
		tabButton.append(label);

		const closeButton = document.createElement("button");
		closeButton.type = "button";
		closeButton.className = "plain-terminal-tab-close";
		closeButton.setAttribute("aria-label", `Close ${label.textContent}`);
		closeButton.textContent = "×";
		this._register(
			addDisposableListener(closeButton, "click", (event) => {
				event.stopPropagation();
				this.#closeTab(tabId);
			}),
		);
		tabButton.append(closeButton);

		this._register(
			addDisposableListener(tabButton, "click", () => {
				this.#activateTab(tabId);
			}),
		);

		this.#tabListElement?.append(tabButton);

		const paneContainer = document.createElement("div");
		paneContainer.className = "plain-terminal-panecontainer";
		paneContainer.dataset.terminalTabId = tabId;
		paneContainer.dataset.active = "false";
		paneContainer.dataset.split = "single";
		paneArea.append(paneContainer);

		this.#tabRecords.set(tabId, { tabButton, paneContainer });
	}

	#createPane(
		paneId: string,
		tabId: string,
		existingSessionId?: string,
		rootId?: string,
		defaults?: TerminalFutureTabDefaults,
	): void {
		const record = this.#tabRecords.get(tabId);
		if (record === undefined) {
			return;
		}
		const paneElement = document.createElement("div");
		paneElement.dataset.terminalPaneId = paneId;
		record.paneContainer.append(paneElement);
		this.#paneElements.set(paneId, paneElement);

		const bridge = requireTerminalBridge();
		const options = {
			container: paneElement,
			bridge,
			dialogService: this.dialogService,
			isEmptyWorkspace: () =>
				this.workspaceContextService.getWorkspace().folders.length === 0,
		};
		let controller: TerminalPaneController;
		if (existingSessionId === undefined) {
			if (rootId === undefined || defaults === undefined) {
				throw new Error("A new terminal pane requires an authorized root.");
			}
			controller = new TerminalPaneController({ ...options, rootId, defaults });
		} else {
			controller = new TerminalPaneController({
				...options,
				existingSessionId,
			});
		}
		this.#panes.set(paneId, controller);
	}

	#workspaceRoots(): readonly PlainWorkspaceRoot[] {
		return plainWorkspaceRootsFromFolders(
			this.workspaceContextService.getWorkspace().folders,
		);
	}

	#renderRootSelector(): void {
		const selector = this.#rootSelectorElement;
		if (selector === undefined) {
			return;
		}
		const roots = this.#workspaceRoots();
		const selected = this.#rootSelection.resolve(roots);
		const options: HTMLOptionElement[] = [];
		if (roots.length !== 1) {
			const placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.textContent = "New terminal in…";
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
		selector.disabled = roots.length < 2;
	}

	/** Populates the two future-tab-default controls' initial values from
	 * configuration and kicks off the (async, best-effort) profile snapshot
	 * fetch. Called exactly once, from `renderBody` — never re-run on a
	 * later configuration change (see `plain-terminal-defaults.ts`'s module
	 * doc for why this slice deliberately does not subscribe to
	 * `onDidChangeConfiguration`: a live-refresh listener risks fighting the
	 * user's own in-progress edit, and is out of this minimal slice's
	 * scope). */
	#initFutureTabDefaultsControls(): void {
		const cwdInput = this.#cwdInputElement;
		if (cwdInput !== undefined) {
			const configuredCwd = this.configurationService.getValue<string>(
				TERMINAL_DEFAULT_CWD_CONFIG_KEY,
			);
			cwdInput.value = typeof configuredCwd === "string" ? configuredCwd : "";
			this.#renderCwdValidation(validateFutureTabCwdInput(cwdInput.value));
		}
		this.#renderProfileSelector();
		requireTerminalBridge()
			.terminalProfiles()
			.then((result) => {
				this.#availableProfiles = result.profiles;
				this.#renderProfileSelector();
			})
			.catch(() => {
				// The profile dropdown's own System-Default-only fallback (see
				// `#renderProfileSelector`) stays in place — this fetch is a
				// best-effort UI convenience, never an authority a new tab's
				// startup depends on (`#resolveFutureTabDefaults` always falls
				// back to `TERMINAL_DEFAULT_PROFILE_FALLBACK_ID` regardless of
				// whether this snapshot ever arrives).
			});
	}

	/** Rebuilds the profile `<select>`'s options from whatever bounded,
	 * native-issued snapshot {@link TerminalProfile} list this view has so
	 * far (empty until `terminalProfiles` first resolves, in which case a
	 * single `TERMINAL_DEFAULT_PROFILE_FALLBACK_ID` placeholder option is
	 * shown instead — the WebView never invents a profile id of its own),
	 * then selects whichever option matches the currently configured
	 * default (falling back to the fallback id if the configured value does
	 * not match any known profile — e.g. a profile no longer installed). */
	#renderProfileSelector(): void {
		const select = this.#profileSelectElement;
		if (select === undefined) {
			return;
		}
		const profiles: readonly TerminalProfile[] =
			this.#availableProfiles.length > 0
				? this.#availableProfiles
				: [
						Object.freeze({
							id: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID,
							label: "System Default",
						}),
					];
		const options = profiles.map((profile) => {
			const option = document.createElement("option");
			option.value = profile.id;
			option.textContent = profile.label;
			return option;
		});
		select.replaceChildren(...options);
		const configuredProfileId = this.configurationService.getValue<string>(
			TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
		);
		const knownIds = new Set(profiles.map((profile) => profile.id));
		select.value =
			typeof configuredProfileId === "string" &&
			knownIds.has(configuredProfileId)
				? configuredProfileId
				: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID;
	}

	/** Updates the cwd input's `data-invalid`/`aria-invalid` styling hook and
	 * its sibling hint text to match `validation` — pure DOM feedback, called
	 * on every keystroke (`input`) and again on commit (`change`); never
	 * itself decides whether to persist anything (see the `change` listener
	 * in `renderBody`, the only caller that also writes to configuration). */
	#renderCwdValidation(validation: TerminalCwdInputState): void {
		const input = this.#cwdInputElement;
		const hint = this.#cwdHintElement;
		if (input === undefined || hint === undefined) {
			return;
		}
		if (validation.kind === "invalid") {
			input.dataset.invalid = "true";
			input.setAttribute("aria-invalid", "true");
			hint.textContent = validation.reason;
		} else {
			input.dataset.invalid = "false";
			input.removeAttribute("aria-invalid");
			hint.textContent = "";
		}
	}

	/**
	 * Computes one frozen {@link TerminalFutureTabDefaults} snapshot from
	 * whatever `plain.terminal.defaultProfile`/`plain.terminal.cwd` currently
	 * hold in configuration — called exactly once per new tab or split (by
	 * `openNewTab`/`splitActiveTab`), never re-read afterward by the
	 * resulting tab/pane, which is what keeps an already-running tab frozen
	 * against a later selector change (see `plain-terminal-defaults.ts`'s
	 * module doc). Re-validates the persisted cwd string (not just trusts
	 * it) because the settings UI is not the only way `settings.json` can
	 * change — a hand-edited file can hold an absolute path the settings UI
	 * itself would never have written; see `TerminalFutureTabDefaults`'s own
	 * `invalidCwd` doc comment for what happens then. */
	#resolveFutureTabDefaults(): TerminalFutureTabDefaults {
		const configuredProfileId = this.configurationService.getValue<string>(
			TERMINAL_DEFAULT_PROFILE_CONFIG_KEY,
		);
		const profileId =
			typeof configuredProfileId === "string" && configuredProfileId.length > 0
				? configuredProfileId
				: TERMINAL_DEFAULT_PROFILE_FALLBACK_ID;
		const configuredCwd = this.configurationService.getValue<string>(
			TERMINAL_DEFAULT_CWD_CONFIG_KEY,
		);
		const validation = validateFutureTabCwdInput(
			typeof configuredCwd === "string" ? configuredCwd : "",
		);
		if (validation.kind === "invalid") {
			return Object.freeze({
				kind: "invalidCwd",
				profileId,
				reason: validation.reason,
			});
		}
		return Object.freeze({ kind: "ok", profileId, cwd: validation.cwd });
	}

	#activateTab(tabId: string): void {
		if (!this.#tabsModel.switchTab(tabId)) {
			return;
		}
		this.#syncTabVisibility();
		this.#layoutActivePanes();
		const paneId = this.#tabsModel.getTab(tabId)?.paneIds[0];
		if (paneId !== undefined) {
			this.#panes.get(paneId)?.focus();
		}
	}

	#closeTab(tabId: string): void {
		const closed = this.#tabsModel.closeTab(tabId);
		if (closed === undefined) {
			return;
		}
		for (const paneId of closed.closedPaneIds) {
			this.#panes.get(paneId)?.dispose();
			this.#panes.delete(paneId);
			this.#paneElements.delete(paneId);
		}
		const record = this.#tabRecords.get(tabId);
		record?.tabButton.remove();
		record?.paneContainer.remove();
		this.#tabRecords.delete(tabId);

		this.#syncTabVisibility();
		if (closed.nextActiveTabId !== undefined) {
			this.#layoutActivePanes();
			const nextPaneId = this.#tabsModel.getTab(closed.nextActiveTabId)
				?.paneIds[0];
			if (nextPaneId !== undefined) {
				this.#panes.get(nextPaneId)?.focus();
			}
		}
	}

	/** Toggles every tab button's/pane container's `data-active` attribute
	 * (the CSS hook that shows exactly one pane container and highlights
	 * exactly one tab button) and the empty-state placeholder to match the
	 * model's current `activeTabId`/tab count. */
	#syncTabVisibility(): void {
		const activeTabId = this.#tabsModel.activeTabId;
		for (const [tabId, record] of this.#tabRecords) {
			const active = tabId === activeTabId;
			record.tabButton.dataset.active = active ? "true" : "false";
			record.paneContainer.dataset.active = active ? "true" : "false";
		}
		const emptyState = this.#emptyStateElement;
		if (emptyState !== undefined) {
			emptyState.style.display =
				this.#tabsModel.tabs.length === 0 ? "flex" : "none";
		}
	}

	#layoutActivePanes(): void {
		const activeTabId = this.#tabsModel.activeTabId;
		if (activeTabId === undefined) {
			return;
		}
		const tab = this.#tabsModel.getTab(activeTabId);
		if (tab === undefined) {
			return;
		}
		for (const paneId of tab.paneIds) {
			const paneElement = this.#paneElements.get(paneId);
			const controller = this.#panes.get(paneId);
			if (paneElement === undefined || controller === undefined) {
				continue;
			}
			const rect = paneElement.getBoundingClientRect();
			controller.layout(rect.width, rect.height);
		}
	}
}

let configuredBridge: PlainBridge | undefined;

/**
 * Wires the Tauri/browser-mock bridge into `PlainTerminalView` without
 * adding a non-service constructor parameter the DI container cannot
 * supply automatically — the same pattern as
 * `plain-search-service.ts`'s `configurePlainSearchBridge`. Must be called
 * exactly once, before this view is ever rendered.
 */
export function configurePlainTerminalBridge(bridge: PlainBridge): void {
	configuredBridge = bridge;
}

function requireTerminalBridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"PlainTerminalView was used before configurePlainTerminalBridge",
		);
	}
	return configuredBridge;
}

Object.freeze(PlainTerminalView.prototype);

IKeybindingService(PlainTerminalView, undefined, 1);
IContextMenuService(PlainTerminalView, undefined, 2);
IConfigurationService(PlainTerminalView, undefined, 3);
IContextKeyService(PlainTerminalView, undefined, 4);
IViewDescriptorService(PlainTerminalView, undefined, 5);
IInstantiationService(PlainTerminalView, undefined, 6);
IOpenerService(PlainTerminalView, undefined, 7);
IThemeService(PlainTerminalView, undefined, 8);
IHoverService(PlainTerminalView, undefined, 9);
IDialogService(PlainTerminalView, undefined, 10);
IWorkspaceContextService(PlainTerminalView, undefined, 11);
