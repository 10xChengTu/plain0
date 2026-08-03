/**
 * Pure tab/split bookkeeping for `PlainTerminalView` (F070 "多 tab/split +
 * 生命周期 + scrollback" slice, extended by `F190` S3 "recursive split tree").
 * Deliberately DOM/IPC-free at the type level, like `plain-terminal-scroll.ts`
 * — this class only tracks *which* tabs and panes currently exist, how they
 * are arranged (`plain-terminal-split-tree.ts`'s binary tree) and which one
 * is active; it never touches a session, a stream or the DOM itself.
 * `PlainTerminalView` is the only real caller: it reacts to this model's
 * return values (which pane ids were just created, which must be torn down,
 * which tab/pane is now active) by creating/disposing the matching
 * `TerminalPaneController`s and DOM elements.
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
 * # `F190` S3: recursive split tree, active pane, 8-pane cap
 *
 * Every tab's layout is now a `TerminalSplitNode` binary tree (see
 * `plain-terminal-split-tree.ts`'s own module doc) instead of the prior flat
 * two-pane cap with one tab-level orientation. Every tab also remembers
 * exactly one `activePaneId` — the leaf that clicking/focusing a pane last
 * made current — and [`splitActivePane`] always splits *that* leaf, never an
 * arbitrary one: "split 操作替换当前活动叶子" from the architecture doc.
 * [`splitActivePane`] returns a discriminated result (`"limit"` vs. an
 * actual new pane id) rather than `undefined`, specifically so
 * `PlainTerminalView` can tell "this tab is already at the
 * [`MAX_PANES_PER_TAB`] cap" apart from any other no-op and show accurate,
 * visible feedback instead of failing silently.
 *
 * # `F190` S2: frozen per-tab profile/cwd defaults
 *
 * Every tab also stores the `TerminalFutureTabDefaults` it was created with
 * — computed once by `PlainTerminalView` from its two future-tab-default
 * controls and never re-read afterward, so a later change to those
 * controls cannot redirect an already-running tab/pane. `splitActivePane`
 * intentionally does not take a defaults parameter: a split adds a pane
 * alongside an *existing* one, and `PlainTerminalView` reads that tab's own
 * already-frozen `defaults` back out via `getTab` to construct the new
 * pane — the same "inherit the active pane's frozen identity" rule this
 * slice sharpens from tab-level (`F150`/`F190` S2) to pane-level: every pane
 * in a tab is reachable, transitively, only by splitting some ancestor pane
 * that itself already carried this exact frozen value, so pane-level and
 * tab-level inheritance coincide for every pane this slice can create (a
 * later slice's shell-integration cwd candidate — see
 * `docs/research/2026-08-03-complete-terminal.md`'s "架构裁定 §3" — is what
 * would first let one pane's own effective cwd diverge from its ancestor's).
 */

import {
	countSplitPanes,
	createSplitLeaf,
	firstSplitPaneId,
	removeTreeLeaf,
	splitPaneIdsInOrder,
	splitTreeLeaf,
	type TerminalSplitNode,
	type TerminalSplitOrientation,
} from "./plain-terminal-split-tree";
export type { TerminalSplitOrientation } from "./plain-terminal-split-tree";

import {
	DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
	type TerminalFutureTabDefaults,
} from "./plain-terminal-defaults";

/** Maximum panes one tab may hold at once — see the module doc's "recursive
 * split tree" section. Reaching this cap never fails silently: see
 * [`splitActivePane`]'s `"limit"` result. */
export const MAX_PANES_PER_TAB = 8;

export interface TerminalRootTarget {
	readonly rootId: string;
	readonly label: string;
}

export interface TerminalTabSnapshot {
	readonly id: string;
	readonly title: string;
	readonly rootId: string | undefined;
	readonly rootLabel: string | undefined;
	/** This tab's frozen profile/cwd identity — `undefined` only for an
	 * externally-adopted (`F100` S4 `runInTerminal`) tab, which owns no such
	 * concept of its own. See the module doc's "frozen per-tab profile/cwd
	 * defaults" section. */
	readonly defaults: TerminalFutureTabDefaults | undefined;
	/** Every pane id in this tab's tree, in document order — see
	 * `splitPaneIdsInOrder`'s own doc comment. */
	readonly paneIds: readonly string[];
	/** The pane a click/focus most recently made current. `splitActivePane`
	 * and pane-scoped commands (`Plain: Kill Terminal`) always act on this
	 * one. Always one of `paneIds` — a tab is never left with no active
	 * pane while it still holds at least one. */
	readonly activePaneId: string;
	/** This tab's full split layout — `PlainTerminalView` walks this
	 * recursively to (re)build the matching nested DOM. */
	readonly tree: TerminalSplitNode;
}

interface MutableTab {
	readonly id: string;
	readonly title: string;
	readonly rootId: string | undefined;
	readonly rootLabel: string | undefined;
	readonly defaults: TerminalFutureTabDefaults | undefined;
	tree: TerminalSplitNode;
	activePaneId: string;
}

export interface TerminalTabCreated {
	readonly tabId: string;
	readonly paneId: string;
}

export interface TerminalTabClosed {
	/** Every pane id that belonged to the closed tab — the caller must
	 * dispose all of them (kill the session, tear down the renderer/stream),
	 * not just the active one. */
	readonly closedPaneIds: readonly string[];
	/** The tab that is active after this close, or `undefined` if no tabs
	 * remain. */
	readonly nextActiveTabId: string | undefined;
}

/** Result of {@link TerminalTabsModel.splitActivePane} — see that method's
 * own doc comment for why this is a discriminated result rather than a bare
 * `undefined` no-op. */
export type TerminalPaneSplitResult =
	| { readonly kind: "created"; readonly paneId: string }
	| { readonly kind: "limit" };

/** Result of {@link TerminalTabsModel.closePane}. */
export interface TerminalPaneClosed {
	readonly closedPaneId: string;
	/** `true` when the closed pane was the tab's only remaining pane, so the
	 * whole tab was removed too — identical bookkeeping to
	 * {@link TerminalTabsModel.closeTab}. */
	readonly tabClosed: boolean;
	/** Only meaningful when `tabClosed` is `true` — same meaning as
	 * {@link TerminalTabClosed.nextActiveTabId}. */
	readonly nextActiveTabId: string | undefined;
	/** The tab's new active pane after this close. `undefined` only when
	 * `tabClosed` is `true` (nothing left in that tab to activate). */
	readonly nextActivePaneId: string | undefined;
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
		return this.#tabs.find((tab) =>
			splitPaneIdsInOrder(tab.tree).includes(paneId),
		)?.id;
	}

	/** Creates a new single-pane tab, makes it active, and returns its new
	 * tab/pane ids. Tab numbering (`"Terminal N"`) is a monotonic counter,
	 * never reused after a close — two tabs never show the same title within
	 * one view's lifetime, even after earlier ones were closed.
	 *
	 * `defaults` is this tab's frozen `F190` S2 profile/cwd identity —
	 * defaulted to `DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS`
	 * (`systemDefault`/root itself) purely so every pre-`F190`-S2 caller of
	 * this method (every existing test in `plain-terminal-tabs.test.ts`)
	 * keeps compiling unchanged; `PlainTerminalView` — the only production
	 * caller — always passes an explicit, freshly-resolved value. */
	createTab(
		root: TerminalRootTarget,
		defaults: TerminalFutureTabDefaults = DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
	): TerminalTabCreated {
		return this.#createTabWithTitle(
			`Terminal ${this.#nextTabNumber} · ${root.label}`,
			root,
			defaults,
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
	 * so a later ordinary tab can never collide with this one's id. Has no
	 * frozen `defaults` of its own — an externally-adopted session already
	 * owns its native cwd/profile, so there is nothing for this tab to
	 * freeze (see `TerminalTabSnapshot.defaults`'s own doc comment).
	 */
	createExternalTab(title: string): TerminalTabCreated {
		return this.#createTabWithTitle(title, undefined, undefined);
	}

	#createTabWithTitle(
		title: string,
		root: TerminalRootTarget | undefined,
		defaults: TerminalFutureTabDefaults | undefined,
	): TerminalTabCreated {
		const tabId = `plain-terminal-tab-${this.#nextTabNumber}`;
		const paneId = this.#nextPaneId();
		this.#nextTabNumber += 1;
		this.#tabs.push({
			id: tabId,
			title,
			rootId: root?.rootId,
			rootLabel: root?.label,
			defaults,
			tree: createSplitLeaf(paneId),
			activePaneId: paneId,
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
			closedPaneIds: Object.freeze(splitPaneIdsInOrder(closed.tree)),
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

	/** Makes `paneId` the active pane of whichever tab currently holds it.
	 * Returns `false` (a no-op) if no tab holds `paneId`. Called whenever the
	 * user clicks/focuses a pane — see the module doc's "active pane"
	 * section. */
	activatePane(paneId: string): boolean {
		const tab = this.#tabs.find((candidate) =>
			splitPaneIdsInOrder(candidate.tree).includes(paneId),
		);
		if (tab === undefined) {
			return false;
		}
		tab.activePaneId = paneId;
		return true;
	}

	/**
	 * Splits `tabId`'s currently **active** pane along `orientation`,
	 * arranging the existing pane and a brand new one — see the module doc's
	 * "recursive split tree" section. Returns `{kind: "limit"}` (never a bare
	 * no-op) once the tab already holds [`MAX_PANES_PER_TAB`] panes, so the
	 * caller can show accurate, visible feedback instead of failing
	 * silently. Returns `undefined` only if `tabId` does not exist.
	 */
	splitActivePane(
		tabId: string,
		orientation: TerminalSplitOrientation,
	): TerminalPaneSplitResult | undefined {
		const tab = this.#find(tabId);
		if (tab === undefined) {
			return undefined;
		}
		if (countSplitPanes(tab.tree) >= MAX_PANES_PER_TAB) {
			return Object.freeze({ kind: "limit" });
		}
		const paneId = this.#nextPaneId();
		const nextTree = splitTreeLeaf(
			tab.tree,
			tab.activePaneId,
			orientation,
			paneId,
		);
		if (nextTree === undefined) {
			// Defensive: `activePaneId` is always a real leaf of `tab.tree` by
			// construction (every mutator that changes either keeps this
			// invariant), so this should be unreachable.
			return undefined;
		}
		tab.tree = nextTree;
		// A split's new pane becomes the active one — the same "creating
		// something new makes it current" rule `createTab` already applies to
		// a brand new tab, now extended to a brand new pane within one.
		tab.activePaneId = paneId;
		return Object.freeze({ kind: "created", paneId });
	}

	/**
	 * Closes exactly `paneId` within `tabId` — the sibling subtree it split
	 * off from is promoted into its place (see
	 * `plain-terminal-split-tree.ts`'s `removeTreeLeaf`). If `paneId` was the
	 * tab's only remaining pane, the whole tab is removed instead (identical
	 * bookkeeping to {@link closeTab}) — a tab can never be left with zero
	 * panes. Returns `undefined` if `tabId` does not exist or does not hold
	 * `paneId`.
	 */
	closePane(tabId: string, paneId: string): TerminalPaneClosed | undefined {
		const tab = this.#find(tabId);
		if (tab === undefined) {
			return undefined;
		}
		const removal = removeTreeLeaf(tab.tree, paneId);
		if (removal === undefined) {
			return undefined;
		}
		if (removal.kind === "empty") {
			const closed = this.closeTab(tabId);
			return Object.freeze({
				closedPaneId: paneId,
				tabClosed: true,
				nextActiveTabId: closed?.nextActiveTabId,
				nextActivePaneId: undefined,
			});
		}
		tab.tree = removal.tree;
		if (tab.activePaneId === paneId) {
			tab.activePaneId = firstSplitPaneId(tab.tree);
		}
		return Object.freeze({
			closedPaneId: paneId,
			tabClosed: false,
			nextActiveTabId: undefined,
			nextActivePaneId: tab.activePaneId,
		});
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
			defaults: tab.defaults,
			paneIds: Object.freeze(splitPaneIdsInOrder(tab.tree)),
			activePaneId: tab.activePaneId,
			tree: tab.tree,
		});
	}
}
