/**
 * Pure tab/split bookkeeping for `PlainTerminalView` (F070 "多 tab/split +
 * 生命周期 + scrollback" slice). Deliberately DOM/IPC-free at the type level,
 * like `plain-terminal-scroll.ts` — this class only tracks *which* tabs and
 * panes currently exist, their order and which one is active; it never
 * touches a session, a stream or the DOM itself. `PlainTerminalView` is the
 * only real caller: it reacts to this model's return values (which pane ids
 * were just created, which must be torn down, which tab is now active) by
 * creating/disposing the matching `TerminalPaneController`s and DOM
 * elements.
 *
 * # Why one view self-manages tabs instead of registering N view panes
 *
 * `docs/research/2026-07-24-libghostty-terminal.md`'s slice list asks this
 * slice to evaluate "是在一个 view 内自管 tab 列表, 还是注册多个
 * view/或用 view 的 tab 支持". Registering a fresh `IViewsRegistry` view
 * (and view-container entry) per open terminal was rejected: views are a
 * *static*, extension-manifest-shaped concept upstream (registered once,
 * long before any terminal is ever opened) — there is no supported "register
 * one more view instance right now" API, and ad-hoc-registering N of them at
 * runtime would mean each tab gets its own Panel tab-bar entry *and* its own
 * `ViewPane` lifecycle to coordinate, none of which this slice's actual goal
 * (organize several terminal sessions within the one Panel slot Plain's
 * terminal already owns) needs. Self-managing a small tab strip inside the
 * single existing `PlainTerminalView` — the same "from scratch, no vendor
 * terminal UI" choice this domain has made throughout F070 — is both the
 * option that avoids inventing a fake multi-view registration protocol and
 * the one that keeps `terminal-contribution.ts`'s view/view-container
 * registration exactly as small as it already is.
 *
 * # Split cap
 *
 * This slice caps each tab at exactly two panes (matching the research
 * doc's own scrollback/split test wording, "split 一个终端 → 两 pane"):
 * [`splitTab`] returns `undefined` (a deliberate no-op, not an error) once a
 * tab already has two. Recursive/nested splitting is out of scope for this
 * slice; extending the cap later is a self-contained change confined to
 * this file's `MAX_PANES_PER_TAB` constant and `splitTab`'s own check.
 */

/** Maximum panes one tab may hold at once — see the module doc's "Split
 * cap" section. */
export const MAX_PANES_PER_TAB = 2;

export type TerminalSplitOrientation = "row" | "column";

export interface TerminalRootTarget {
	readonly rootId: string;
	readonly label: string;
}

export interface TerminalTabSnapshot {
	readonly id: string;
	readonly title: string;
	readonly rootId: string | undefined;
	readonly rootLabel: string | undefined;
	readonly paneIds: readonly string[];
	readonly splitOrientation: TerminalSplitOrientation;
}

interface MutableTab {
	readonly id: string;
	readonly title: string;
	readonly rootId: string | undefined;
	readonly rootLabel: string | undefined;
	paneIds: string[];
	splitOrientation: TerminalSplitOrientation;
}

export interface TerminalTabCreated {
	readonly tabId: string;
	readonly paneId: string;
}

export interface TerminalTabClosed {
	/** Every pane id that belonged to the closed tab — the caller must
	 * dispose all of them (kill the session, tear down the renderer/stream),
	 * not just the one that happened to be active. */
	readonly closedPaneIds: readonly string[];
	/** The tab that is active after this close, or `undefined` if no tabs
	 * remain. */
	readonly nextActiveTabId: string | undefined;
}

/**
 * One `PlainTerminalView`'s worth of tab/split state. Every mutating method
 * returns a plain value describing what changed (never a delta object the
 * caller must diff itself) — mirroring `TerminalGridModel::applyFrame`'s own
 * "tell the caller exactly what to do next" shape.
 */
export class TerminalTabsModel {
	#tabs: MutableTab[] = [];
	#activeTabId: string | undefined;
	#nextTabNumber = 1;
	#nextPaneSerial = 1;

	get tabs(): readonly TerminalTabSnapshot[] {
		return this.#tabs.map((tab) => this.#snapshot(tab));
	}

	get activeTabId(): string | undefined {
		return this.#activeTabId;
	}

	getTab(tabId: string): TerminalTabSnapshot | undefined {
		const tab = this.#find(tabId);
		return tab === undefined ? undefined : this.#snapshot(tab);
	}

	/** Which tab (if any) currently holds `paneId`. */
	tabIdForPane(paneId: string): string | undefined {
		return this.#tabs.find((tab) => tab.paneIds.includes(paneId))?.id;
	}

	/** Creates a new single-pane tab, makes it active, and returns its new
	 * tab/pane ids. Tab numbering (`"Terminal N"`) is a monotonic counter,
	 * never reused after a close — two tabs never show the same title within
	 * one view's lifetime, even after earlier ones were closed. */
	createTab(root: TerminalRootTarget): TerminalTabCreated {
		return this.#createTabWithTitle(
			`Terminal ${this.#nextTabNumber} · ${root.label}`,
			root,
		);
	}

	/**
	 * `F100` S4: identical to {@link createTab} except the title is caller-
	 * supplied rather than the auto-generated `"Terminal N"` — used only for
	 * a tab created by `PlainTerminalView.adoptExternalSession` (a
	 * `runInTerminal`-launched session Rust already created; see that
	 * method's own doc comment), so the tab strip visibly identifies it as
	 * debug-launched rather than looking like an ordinary manually-created
	 * terminal. Still consumes the same monotonic tab-number counter as
	 * {@link createTab} (for a unique internal `tabId`, never for display),
	 * so a later ordinary tab can never collide with this one's id.
	 */
	createExternalTab(title: string): TerminalTabCreated {
		return this.#createTabWithTitle(title, undefined);
	}

	#createTabWithTitle(
		title: string,
		root: TerminalRootTarget | undefined,
	): TerminalTabCreated {
		const tabId = `plain-terminal-tab-${this.#nextTabNumber}`;
		const paneId = this.#nextPaneId();
		this.#nextTabNumber += 1;
		this.#tabs.push({
			id: tabId,
			title,
			rootId: root?.rootId,
			rootLabel: root?.label,
			paneIds: [paneId],
			splitOrientation: "row",
		});
		this.#activeTabId = tabId;
		return Object.freeze({ tabId, paneId });
	}

	/** Removes `tabId` entirely. Returns `undefined` (a no-op) if `tabId`
	 * does not exist. If the closed tab was active, whichever tab slides
	 * into its old position becomes active instead (the tab immediately
	 * after it, since removing an element shifts every later one back by
	 * one index) — falling back to the new last tab if the closed tab was
	 * itself last, or `undefined` if none remain. This is the same "activate
	 * the neighbor that takes its place" rule most browsers' own tab strips
	 * use when you close a tab that is not the last one. */
	closeTab(tabId: string): TerminalTabClosed | undefined {
		const index = this.#tabs.findIndex((tab) => tab.id === tabId);
		if (index === -1) {
			return undefined;
		}
		const [closed] = this.#tabs.splice(index, 1);
		if (closed === undefined) {
			return undefined;
		}
		if (this.#activeTabId === tabId) {
			const fallbackIndex = Math.min(index, this.#tabs.length - 1);
			this.#activeTabId = this.#tabs[fallbackIndex]?.id;
		}
		return Object.freeze({
			closedPaneIds: Object.freeze([...closed.paneIds]),
			nextActiveTabId: this.#activeTabId,
		});
	}

	/** Makes `tabId` active. Returns `false` (a no-op) if it does not
	 * exist. */
	switchTab(tabId: string): boolean {
		if (this.#find(tabId) === undefined) {
			return false;
		}
		this.#activeTabId = tabId;
		return true;
	}

	/**
	 * Adds a second pane to `tabId`, arranged along `orientation`. Returns
	 * the new pane id, or `undefined` (a deliberate no-op — see the module
	 * doc's "Split cap" section) when `tabId` does not exist or already has
	 * `MAX_PANES_PER_TAB` panes.
	 */
	splitTab(
		tabId: string,
		orientation: TerminalSplitOrientation,
	): string | undefined {
		const tab = this.#find(tabId);
		if (tab === undefined || tab.paneIds.length >= MAX_PANES_PER_TAB) {
			return undefined;
		}
		const paneId = this.#nextPaneId();
		tab.paneIds = [...tab.paneIds, paneId];
		tab.splitOrientation = orientation;
		return paneId;
	}

	#nextPaneId(): string {
		const paneId = `plain-terminal-pane-${this.#nextPaneSerial}`;
		this.#nextPaneSerial += 1;
		return paneId;
	}

	#find(tabId: string): MutableTab | undefined {
		return this.#tabs.find((tab) => tab.id === tabId);
	}

	#snapshot(tab: MutableTab): TerminalTabSnapshot {
		return Object.freeze({
			id: tab.id,
			title: tab.title,
			rootId: tab.rootId,
			rootLabel: tab.rootLabel,
			paneIds: Object.freeze([...tab.paneIds]),
			splitOrientation: tab.splitOrientation,
		});
	}
}
