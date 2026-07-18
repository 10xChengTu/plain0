import { describe, expect, it } from "vitest";

import {
	findExcludedWorkbenchSurfaces,
	type WorkbenchSurfaceSnapshot,
} from "../../app/excluded-surface-policy";

function snapshot(
	overrides: Partial<WorkbenchSurfaceSnapshot> = {},
): WorkbenchSurfaceSnapshot {
	return {
		commandIds: [],
		viewContainerIds: [],
		viewIds: [],
		...overrides,
	};
}

describe("excluded Workbench surfaces", () => {
	it.each([
		"workbench.action.chat.open",
		"workbench.action.agentSessions.open",
		"workbench.mcp.listServers",
		"workbench.action.authentication.manageTrustedExtensions",
		"workbench.action.accounts.manage",
		"workbench.userDataSync.actions.turnOn",
		"workbench.editSessions.actions.resumeLatest",
		"workbench.extensions.action.installExtensions",
		"workbench.action.openRemote",
		"workbench.action.tasks.runTask",
		"workbench.action.openNotebook",
		"testing.runAll",
	])("rejects excluded command %s", (commandId) => {
		expect(
			findExcludedWorkbenchSurfaces(snapshot({ commandIds: [commandId] })),
		).toHaveLength(1);
	});

	it("rejects excluded view containers and views", () => {
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					viewContainerIds: ["workbench.view.extensions"],
					viewIds: ["workbench.panel.chat"],
				}),
			),
		).toEqual([
			{
				kind: "viewContainerIds",
				id: "workbench.view.extensions",
				category: "extensions, gallery or marketplace",
			},
			{
				kind: "viewIds",
				id: "workbench.panel.chat",
				category: "AI, Chat, Agent or MCP",
			},
		]);
	});

	it("allows the editor, files, search, SCM, terminal and debug surfaces", () => {
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					commandIds: [
						"workbench.action.files.openFile",
						"workbench.action.findInFiles",
						"workbench.action.terminal.toggleTerminal",
						"workbench.action.debug.start",
					],
					viewContainerIds: ["workbench.view.explorer", "workbench.view.scm"],
					viewIds: ["workbench.views.search"],
				}),
			),
		).toEqual([]);
	});
});
