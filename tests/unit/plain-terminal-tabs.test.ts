import { describe, expect, it } from "vitest";

import {
	MAX_PANES_PER_TAB,
	TerminalTabsModel,
} from "../../app/features/terminal/plain-terminal-tabs";

describe("TerminalTabsModel", () => {
	it("starts with no tabs and no active tab", () => {
		const model = new TerminalTabsModel();

		expect(model.tabs).toEqual([]);
		expect(model.activeTabId).toBeUndefined();
	});

	it("creates a single-pane tab, numbered from 1, and makes it active", () => {
		const model = new TerminalTabsModel();

		const created = model.createTab();

		expect(model.activeTabId).toBe(created.tabId);
		const tab = model.getTab(created.tabId);
		expect(tab?.title).toBe("Terminal 1");
		expect(tab?.paneIds).toEqual([created.paneId]);
		expect(tab?.splitOrientation).toBe("row");
	});

	it("gives every new tab a distinct, monotonically numbered title", () => {
		const model = new TerminalTabsModel();

		const first = model.createTab();
		const second = model.createTab();

		expect(model.getTab(first.tabId)?.title).toBe("Terminal 1");
		expect(model.getTab(second.tabId)?.title).toBe("Terminal 2");
	});

	it("never reuses a tab number after it is closed", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();
		model.closeTab(first.tabId);

		const third = model.createTab();

		expect(model.getTab(third.tabId)?.title).toBe("Terminal 2");
	});

	it("creating a new tab makes it active, leaving the previous tab intact", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();

		const second = model.createTab();

		expect(model.activeTabId).toBe(second.tabId);
		expect(model.getTab(first.tabId)).not.toBeUndefined();
	});

	it("switchTab activates an existing tab and returns true", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();
		model.createTab();

		const switched = model.switchTab(first.tabId);

		expect(switched).toBe(true);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("switchTab is a no-op returning false for an unknown tab id", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();

		const switched = model.switchTab("does-not-exist");

		expect(switched).toBe(false);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("closeTab returns every pane id the closed tab held, and the tab list no longer contains it", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab();
		const paneId = model.splitTab(tab.tabId, "row");

		const closed = model.closeTab(tab.tabId);

		expect(closed?.closedPaneIds).toEqual([tab.paneId, paneId]);
		expect(model.getTab(tab.tabId)).toBeUndefined();
	});

	it("closeTab is a no-op returning undefined for an unknown tab id", () => {
		const model = new TerminalTabsModel();
		model.createTab();

		expect(model.closeTab("does-not-exist")).toBeUndefined();
	});

	it("closing the active tab activates its now-previous neighbor", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();
		const second = model.createTab();
		expect(model.activeTabId).toBe(second.tabId);

		const closed = model.closeTab(second.tabId);

		expect(closed?.nextActiveTabId).toBe(first.tabId);
		expect(model.activeTabId).toBe(first.tabId);
	});

	it("closing a non-active tab leaves the active tab unchanged", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();
		const second = model.createTab();
		expect(model.activeTabId).toBe(second.tabId);

		const closed = model.closeTab(first.tabId);

		expect(closed?.nextActiveTabId).toBe(second.tabId);
		expect(model.activeTabId).toBe(second.tabId);
	});

	it("closing the last remaining tab leaves no active tab", () => {
		const model = new TerminalTabsModel();
		const only = model.createTab();

		const closed = model.closeTab(only.tabId);

		expect(closed?.nextActiveTabId).toBeUndefined();
		expect(model.activeTabId).toBeUndefined();
		expect(model.tabs).toEqual([]);
	});

	it("closing the active middle tab activates the tab that slides into its place (the next one)", () => {
		const model = new TerminalTabsModel();
		model.createTab();
		const second = model.createTab();
		const third = model.createTab();
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
		const tab = model.createTab();

		const paneId = model.splitTab(tab.tabId, "column");

		expect(paneId).not.toBeUndefined();
		const updated = model.getTab(tab.tabId);
		expect(updated?.paneIds).toEqual([tab.paneId, paneId]);
		expect(updated?.splitOrientation).toBe("column");
	});

	it(`splitTab refuses a third pane once a tab already has ${MAX_PANES_PER_TAB}`, () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab();
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
		const tab = model.createTab();
		const secondPaneId = model.splitTab(tab.tabId, "row");

		expect(model.tabIdForPane(tab.paneId)).toBe(tab.tabId);
		expect(model.tabIdForPane(secondPaneId ?? "")).toBe(tab.tabId);
		expect(model.tabIdForPane("unknown-pane")).toBeUndefined();
	});

	it("every pane id, across every tab, is unique", () => {
		const model = new TerminalTabsModel();
		const first = model.createTab();
		const second = model.createTab();
		const splitPaneId = model.splitTab(first.tabId, "row");

		const allPaneIds = [first.paneId, second.paneId, splitPaneId];
		expect(new Set(allPaneIds).size).toBe(allPaneIds.length);
	});

	it("tabs snapshots are independent from later mutation (no shared mutable arrays leak out)", () => {
		const model = new TerminalTabsModel();
		const tab = model.createTab();
		const snapshotBeforeSplit = model.getTab(tab.tabId);

		model.splitTab(tab.tabId, "row");

		expect(snapshotBeforeSplit?.paneIds).toEqual([tab.paneId]);
	});
});
