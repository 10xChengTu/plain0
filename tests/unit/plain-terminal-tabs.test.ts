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
		expect(tab?.splitOrientation).toBe("row");
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
		const paneId = model.splitTab(tab.tabId, "row");

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

	it("splitTab adds a second pane along the given orientation and returns its id", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);

		const paneId = model.splitTab(tab.tabId, "column");

		expect(paneId).not.toBeUndefined();
		const updated = model.getTab(tab.tabId);
		expect(updated?.paneIds).toEqual([tab.paneId, paneId]);
		expect(updated?.splitOrientation).toBe("column");
	});

	it("splitTab never changes the tab's own frozen defaults — a split reads them back unchanged, it does not recompute them", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT, CUSTOM_DEFAULTS);

		model.splitTab(tab.tabId, "row");

		expect(model.getTab(tab.tabId)?.defaults).toEqual(CUSTOM_DEFAULTS);
	});

	it(`splitTab refuses a third pane once a tab already has ${MAX_PANES_PER_TAB}`, () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		model.splitTab(tab.tabId, "row");

		const third = model.splitTab(tab.tabId, "row");

		expect(third).toBeUndefined();
		expect(model.getTab(tab.tabId)?.paneIds).toHaveLength(MAX_PANES_PER_TAB);
	});

	it("splitTab is a no-op returning undefined for an unknown tab id", () => {
		const model = new TerminalTabsModel();

		expect(model.splitTab("does-not-exist", "row")).toBeUndefined();
	});

	it("tabIdForPane finds the owning tab for any of its panes", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const secondPaneId = model.splitTab(tab.tabId, "row");

		expect(model.tabIdForPane(tab.paneId)).toBe(tab.tabId);
		expect(model.tabIdForPane(secondPaneId ?? "")).toBe(tab.tabId);
		expect(model.tabIdForPane("unknown-pane")).toBeUndefined();
	});

	it("every pane id, across every tab, is unique", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab(ROOT);
		const second = model.createTab(ROOT);
		const splitPaneId = model.splitTab(first.tabId, "row");

		const allPaneIds = [first.paneId, second.paneId, splitPaneId];
		expect(new Set(allPaneIds).size).toBe(allPaneIds.length);
	});

	it("tabs snapshots are independent from later mutation (no shared mutable arrays leak out)", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab(ROOT);
		const snapshotBeforeSplit = model.getTab(tab.tabId);

		model.splitTab(tab.tabId, "row");

		expect(snapshotBeforeSplit?.paneIds).toEqual([tab.paneId]);
	});
});
