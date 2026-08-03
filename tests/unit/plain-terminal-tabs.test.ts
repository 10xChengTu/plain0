import { describe, expect, it } from "vitest";

import {
	DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
	type TerminalFutureTabDefaults,
} from "../../app/features/terminal/plain-terminal-defaults";
import {
	MAX_PANES_PER_TAB,
	TerminalTabsModel,
} from "../../app/features/terminal/plain-terminal-tabs";

const ROOT = Object.freeze({
	rootId: "11111111-1111-4111-8111-111111111111",
	label: "alpha",
});

const CUSTOM_DEFAULTS: TerminalFutureTabDefaults = Object.freeze({
	kind: "ok",
	profileId: "zsh",
	cwd: "nested/project",
});

describe("TerminalTabsModel", () => {
	it("starts with no tabs and no active tab", () => {
		const model = new TerminalTabsModel();

		expect(model.tabs).toEqual([]);
		expect(model.activeTabId).toBeUndefined();
	});

	it("creates a single-pane tab, numbered from 1, and makes it active", () => {
		const model = new TerminalTabsModel();

		const created = model.createTab(ROOT);

		expect(model.activeTabId).toBe(created.tabId);
		const tab = model.getTab(created.tabId);
		expect(tab?.title).toBe("Terminal 1 · alpha");
		expect(tab?.rootId).toBe(ROOT.rootId);
		expect(tab?.rootLabel).toBe(ROOT.label);
		expect(tab?.paneIds).toEqual([created.paneId]);
		expect(tab?.activePaneId).toBe(created.paneId);
		expect(tab?.tree).toEqual({ kind: "leaf", paneId: created.paneId });
	});

	// `F190` S2 "future-tab defaults UI": every tab freezes the
	// profile/cwd defaults it was created with — see
	// `plain-terminal-defaults.ts`'s own doc comment.
	it("defaults to systemDefault/root-itself when a caller passes no explicit defaults", () => {
		const model = new TerminalTabsModel();

		const created = model.createTab(ROOT);

		expect(model.getTab(created.tabId)?.defaults).toEqual(
			DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
		);
	});

	it("freezes whatever explicit defaults a caller passes onto the new tab", () => {
		const model = new TerminalTabsModel();

		const created = model.createTab(ROOT, CUSTOM_DEFAULTS);

		expect(model.getTab(created.tabId)?.defaults).toEqual(CUSTOM_DEFAULTS);
	});

	it("keeps two tabs' defaults independent — changing one does not affect the other", () => {
		const model = new TerminalTabsModel();

		const first = model.createTab(ROOT, CUSTOM_DEFAULTS);
		const second = model.createTab(ROOT);

		expect(model.getTab(first.tabId)?.defaults).toEqual(CUSTOM_DEFAULTS);
		expect(model.getTab(second.tabId)?.defaults).toEqual(
			DEFAULT_TERMINAL_FUTURE_TAB_DEFAULTS,
		);
	});

	it("gives every new tab a distinct, monotonically numbered title", () => {
		const model = new TerminalTabsModel();

		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);

		expect(model.getTab(first.tabId)?.title).toBe("Terminal 1 · alpha");
		expect(model.getTab(second.tabId)?.title).toBe("Terminal 2 · alpha");
	});

	it("keeps an adopted external session rootless instead of inventing a workspace owner", () => {
		const model = new TerminalTabsModel();
		const created = model.createExternalTab("Debuggee");
		const tab = model.getTab(created.tabId);

		expect(tab?.title).toBe("Debuggee");
		expect(tab?.rootId).toBeUndefined();
		expect(tab?.rootLabel).toBeUndefined();
	});

	it("gives an adopted external session no future-tab defaults of its own", () => {
		const model = new TerminalTabsModel();
		const created = model.createExternalTab("Debuggee");

		expect(model.getTab(created.tabId)?.defaults).toBeUndefined();
	});

	it("never reuses a tab number after it is closed", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		model.closeTab(first.tabId);

		const third = model.createTab(ROOT);

		expect(model.getTab(third.tabId)?.title).toBe("Terminal 2 · alpha");
	});

	it("creating a new tab makes it active, leaving the previous tab intact", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);

		const second = model.createTab(ROOT);

		expect(model.activeTabId).toBe(second.tabId);
		expect(model.getTab(first.tabId)).not.toBeUndefined();
	});

	it("switchTab activates an existing tab and returns true", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		model.createTab(ROOT);

		const switched = model.switchTab(first.tabId);

		expect(switched).toBe(true);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("switchTab is a no-op returning false for an unknown tab id", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);

		const switched = model.switchTab("does-not-exist");

		expect(switched).toBe(false);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("closeTab returns every pane id the closed tab held, and the tab list no longer contains it", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const split = model.splitActivePane(tab.tabId, "row");
		const paneId = split?.kind === "created" ? split.paneId : undefined;

		const closed = model.closeTab(tab.tabId);

		expect(closed?.closedPaneIds).toEqual([tab.paneId, paneId]);
		expect(model.getTab(tab.tabId)).toBeUndefined();
	});

	it("closeTab is a no-op returning undefined for an unknown tab id", () => {
		const model = new TerminalTabsModel();
		model.createTab(ROOT);

		expect(model.closeTab("does-not-exist")).toBeUndefined();
	});

	it("closing the active tab activates its now-previous neighbor", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);
		expect(model.activeTabId).toBe(second.tabId);

		const closed = model.closeTab(second.tabId);

		expect(closed?.nextActiveTabId).toBe(first.tabId);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("closing a non-active tab leaves the active tab unchanged", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);
		expect(model.activeTabId).toBe(second.tabId);

		const closed = model.closeTab(first.tabId);

		expect(closed?.nextActiveTabId).toBe(second.tabId);
		expect(model.activeTabId).toBe(second.tabId);
	});

	it("closing the last remaining tab leaves no active tab", () => {
		const model = new TerminalTabsModel();
		const only = model.createTab(ROOT);

		const closed = model.closeTab(only.tabId);

		expect(closed?.nextActiveTabId).toBeUndefined();
		expect(model.activeTabId).toBeUndefined();
		expect(model.tabs).toEqual([]);
	});

	it("closing the active middle tab activates the tab that slides into its place (the next one)", () => {
		const model = new TerminalTabsModel();
		model.createTab(ROOT);
		const second = model.createTab(ROOT);
		const third = model.createTab(ROOT);
		model.switchTab(second.tabId);

		const closed = model.closeTab(second.tabId);

		expect(closed?.nextActiveTabId).toBe(third.tabId);
		expect(model.tabs.map((tab) => tab.id)).toEqual([
			model.tabs[0]?.id,
			third.tabId,
		]);
	});

	// --- `F190` S3: recursive split tree / active pane -----------------------

	it("splitActivePane adds a second pane along the given orientation, makes it active, and returns its id", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);

		const result = model.splitActivePane(tab.tabId, "column");

		expect(result?.kind).toBe("created");
		const paneId = result?.kind === "created" ? result.paneId : undefined;
		expect(paneId).not.toBeUndefined();
		const updated = model.getTab(tab.tabId);
		expect(updated?.paneIds).toEqual([tab.paneId, paneId]);
		expect(updated?.activePaneId).toBe(paneId);
		expect(updated?.tree).toEqual({
			kind: "split",
			orientation: "column",
			first: { kind: "leaf", paneId: tab.paneId },
			second: { kind: "leaf", paneId },
		});
	});

	it("splitActivePane always splits whichever pane is currently active, not always the tab's original pane", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const firstSplit = model.splitActivePane(tab.tabId, "row");
		const secondPaneId =
			firstSplit?.kind === "created" ? firstSplit.paneId : undefined;
		expect(secondPaneId).not.toBeUndefined();
		// The just-created pane is now active — splitting again must target it,
		// not the tab's original pane.
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(secondPaneId);

		const secondSplit = model.splitActivePane(tab.tabId, "column");
		const thirdPaneId =
			secondSplit?.kind === "created" ? secondSplit.paneId : undefined;

		expect(model.getTab(tab.tabId)?.tree).toEqual({
			kind: "split",
			orientation: "row",
			first: { kind: "leaf", paneId: tab.paneId },
			second: {
				kind: "split",
				orientation: "column",
				first: { kind: "leaf", paneId: secondPaneId },
				second: { kind: "leaf", paneId: thirdPaneId },
			},
		});
	});

	it("switching the active pane redirects a later split to that pane", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const firstSplit = model.splitActivePane(tab.tabId, "row");
		const secondPaneId =
			firstSplit?.kind === "created" ? firstSplit.paneId : undefined;
		expect(secondPaneId).not.toBeUndefined();

		// Reactivate the tab's original pane before splitting again.
		expect(model.activatePane(tab.paneId)).toBe(true);
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(tab.paneId);

		const secondSplit = model.splitActivePane(tab.tabId, "column");
		const thirdPaneId =
			secondSplit?.kind === "created" ? secondSplit.paneId : undefined;

		// pane-1's own subtree gained the new sibling; pane-2 (the other
		// branch of the original row split) is completely untouched.
		expect(model.getTab(tab.tabId)?.tree).toEqual({
			kind: "split",
			orientation: "row",
			first: {
				kind: "split",
				orientation: "column",
				first: { kind: "leaf", paneId: tab.paneId },
				second: { kind: "leaf", paneId: thirdPaneId },
			},
			second: { kind: "leaf", paneId: secondPaneId },
		});
	});

	it("splitActivePane never changes the tab's own frozen defaults — a split reads them back unchanged, it does not recompute them", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT, CUSTOM_DEFAULTS);

		model.splitActivePane(tab.tabId, "row");

		expect(model.getTab(tab.tabId)?.defaults).toEqual(CUSTOM_DEFAULTS);
	});

	it(`splitActivePane refuses a pane beyond ${MAX_PANES_PER_TAB} and reports the limit instead of a silent no-op`, () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		for (let i = 1; i < MAX_PANES_PER_TAB; i += 1) {
			const result = model.splitActivePane(tab.tabId, "row");
			expect(result?.kind).toBe("created");
		}
		expect(model.getTab(tab.tabId)?.paneIds).toHaveLength(MAX_PANES_PER_TAB);

		const overLimit = model.splitActivePane(tab.tabId, "row");

		expect(overLimit).toEqual({ kind: "limit" });
		expect(model.getTab(tab.tabId)?.paneIds).toHaveLength(MAX_PANES_PER_TAB);
	});

	it("splitActivePane is a no-op returning undefined for an unknown tab id", () => {
		const model = new TerminalTabsModel();

		expect(model.splitActivePane("does-not-exist", "row")).toBeUndefined();
	});

	it("activatePane makes an existing pane active and returns true", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const split = model.splitActivePane(tab.tabId, "row");
		const secondPaneId = split?.kind === "created" ? split.paneId : undefined;
		expect(secondPaneId).not.toBeUndefined();

		expect(model.activatePane(tab.paneId)).toBe(true);
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(tab.paneId);

		expect(model.activatePane(secondPaneId ?? "")).toBe(true);
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(secondPaneId);
	});

	it("activatePane is a no-op returning false for an unknown pane id", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);

		expect(model.activatePane("does-not-exist")).toBe(false);
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(tab.paneId);
	});

	it("closePane on a middle pane promotes its sibling and keeps the rest of the tree/active pane untouched", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		// Build: split(row){ pane-1, split(column){ pane-2, pane-3 } }
		const firstSplit = model.splitActivePane(tab.tabId, "row");
		const secondPaneId =
			firstSplit?.kind === "created" ? firstSplit.paneId : undefined;
		const secondSplit = model.splitActivePane(tab.tabId, "column");
		const thirdPaneId =
			secondSplit?.kind === "created" ? secondSplit.paneId : undefined;
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(thirdPaneId);

		// Reactivate pane-3 explicitly to make the close target unambiguous,
		// then close pane-2 (the middle pane) instead of the active one.
		const result = model.closePane(tab.tabId, secondPaneId ?? "");

		expect(result?.tabClosed).toBe(false);
		expect(result?.closedPaneId).toBe(secondPaneId);
		const updated = model.getTab(tab.tabId);
		expect(updated?.tree).toEqual({
			kind: "split",
			orientation: "row",
			first: { kind: "leaf", paneId: tab.paneId },
			second: { kind: "leaf", paneId: thirdPaneId },
		});
		// pane-3 was active and was not the one closed — it stays active.
		expect(updated?.activePaneId).toBe(thirdPaneId);
	});

	it("closePane on the currently active pane falls back to the tree's leftmost remaining pane", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const split = model.splitActivePane(tab.tabId, "row");
		const secondPaneId = split?.kind === "created" ? split.paneId : undefined;
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(secondPaneId);

		const result = model.closePane(tab.tabId, secondPaneId ?? "");

		expect(result?.tabClosed).toBe(false);
		expect(result?.nextActivePaneId).toBe(tab.paneId);
		expect(model.getTab(tab.tabId)?.activePaneId).toBe(tab.paneId);
	});

	it("closePane on a tab's only pane closes the whole tab instead, matching closeTab", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);
		model.switchTab(first.tabId);

		const result = model.closePane(first.tabId, first.paneId);

		expect(result).toEqual({
			closedPaneId: first.paneId,
			tabClosed: true,
			nextActiveTabId: second.tabId,
			nextActivePaneId: undefined,
		});
		expect(model.getTab(first.tabId)).toBeUndefined();
		expect(model.activeTabId).toBe(second.tabId);
	});

	it("closePane is a no-op returning undefined for an unknown tab id", () => {
		const model = new TerminalTabsModel();

		expect(model.closePane("does-not-exist", "some-pane")).toBeUndefined();
	});

	it("closePane is a no-op returning undefined for a pane id not in the given tab", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);

		expect(model.closePane(tab.tabId, "not-a-real-pane")).toBeUndefined();
	});

	it("tabIdForPane finds the owning tab for any of its panes, at any depth", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const firstSplit = model.splitActivePane(tab.tabId, "row");
		const secondPaneId =
			firstSplit?.kind === "created" ? firstSplit.paneId : undefined;
		const secondSplit = model.splitActivePane(tab.tabId, "column");
		const thirdPaneId =
			secondSplit?.kind === "created" ? secondSplit.paneId : undefined;

		expect(model.tabIdForPane(tab.paneId)).toBe(tab.tabId);
		expect(model.tabIdForPane(secondPaneId ?? "")).toBe(tab.tabId);
		expect(model.tabIdForPane(thirdPaneId ?? "")).toBe(tab.tabId);
		expect(model.tabIdForPane("unknown-pane")).toBeUndefined();
	});

	it("every pane id, across every tab, is unique", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);
		const split = model.splitActivePane(first.tabId, "row");
		const splitPaneId = split?.kind === "created" ? split.paneId : undefined;

		const allPaneIds = [first.paneId, second.paneId, splitPaneId];
		expect(new Set(allPaneIds).size).toBe(allPaneIds.length);
	});

	it("tabs snapshots are independent from later mutation (no shared mutable state leaks out)", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const snapshotBeforeSplit = model.getTab(tab.tabId);

		model.splitActivePane(tab.tabId, "row");

		expect(snapshotBeforeSplit?.paneIds).toEqual([tab.paneId]);
		expect(snapshotBeforeSplit?.tree).toEqual({
			kind: "leaf",
			paneId: tab.paneId,
		});
	});
});
