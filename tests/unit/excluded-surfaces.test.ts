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
		contributionIds: [],
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
		"git.generateCommitMessage",
	])("rejects excluded command %s", (commandId) => {
		expect(
			findExcludedWorkbenchSurfaces(snapshot({ commandIds: [commandId] })),
		).toHaveLength(1);
	});

	it("captures contributionIds as a fourth auditable snapshot dimension, rejecting AI-semantic contributions", () => {
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					contributionIds: [
						"git.generateCommitMessageContribution",
						"scm.resolveConflictWithAiContribution",
						// The real upstream id (confirmed present in the pinned
						// `@codingame/monaco-vscode-api@35.0.1` sources) that
						// `docs/research/2026-07-25-core-git.md` decision 2 names
						// as the reason contributionIds needs to be auditable at
						// all. Unlike the bare `SCMHistoryItemContextContribution`
						// name (see the "does not flag ordinary git/SCM..." test
						// below), the real registered id carries a `chat`-spelled
						// namespace prefix and so must be caught.
						"workbench.contrib.chat.scmHistoryItemContextContribution",
					],
				}),
			),
		).toEqual([
			{
				kind: "contributionIds",
				id: "git.generateCommitMessageContribution",
				category: "AI, Chat, Agent or MCP",
			},
			{
				kind: "contributionIds",
				id: "scm.resolveConflictWithAiContribution",
				category: "AI, Chat, Agent or MCP",
			},
			{
				kind: "contributionIds",
				id: "workbench.contrib.chat.scmHistoryItemContextContribution",
				category: "AI, Chat, Agent or MCP",
			},
		]);
	});

	it("does not apply the extensions/gallery/marketplace, remote development or notebooks/tasks/testing categories to contributionIds — these are real, currently-registered internal contribution ids, not the user-visible extensions/remote/notebook surfaces those categories target", () => {
		// Every id below is a real `registerWorkbenchContribution2` id from
		// this app's actual pinned dependency tree
		// (`@codingame/monaco-vscode-api@35.0.1` plus the direct
		// `monaco-vscode-configuration-service-override` dependency),
		// captured verbatim from a real bootstrap failure recorded at
		// `test-results/foundation-boots-the-allow-092cb-t-excluded-runtime-surfaces/error-context.md`
		// before this narrowing existed — applying all six categories to
		// contributionIds broke app startup on exactly these seven ids.
		// They are lazy static contribution/extension-point registrars
		// (the mechanism `AGENTS.md` explicitly allows), not the extension
		// marketplace, Remote Development, or notebooks/tasks/testing
		// feature surfaces this app excludes.
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					contributionIds: [
						"workbench.contrib.colorExtensionPoint",
						"workbench.contrib.iconExtensionPoint",
						"workbench.contrib.jsonValidationExtensionPoint",
						"workbench.contrib.statusBarItemsExtensionPoint",
						"workbench.contrib.tokenClassificationExtensionPoint",
						"workbench.contrib.viewsExtensionHandler",
						"workbench.contrib.recentRemoteFolderPruner",
						// Synthetic but representative: no notebook/tasks/testing
						// override package is a dependency of this app at all, so
						// there is no real registered id to cite here — this
						// locks in that the category stays inert for
						// contributionIds regardless.
						"workbench.contrib.notebookRendererMessagingContribution",
					],
				}),
			),
		).toEqual([]);
	});

	it("keeps the authentication/accounts and settings-sync/edit-sessions categories active for contributionIds (no evidence of a legitimate contribution pipe in either namespace in this app's dependency tree)", () => {
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					contributionIds: [
						"workbench.contrib.authenticationExtensionPointHandlerContribution",
						"workbench.contrib.userDataSyncResourceContribution",
					],
				}),
			),
		).toEqual([
			{
				kind: "contributionIds",
				id: "workbench.contrib.authenticationExtensionPointHandlerContribution",
				category: "authentication or accounts",
			},
			{
				kind: "contributionIds",
				id: "workbench.contrib.userDataSyncResourceContribution",
				category: "settings sync or edit sessions",
			},
		]);
	});

	it("does not flag ordinary git/SCM commands or contributions as AI surfaces", () => {
		// `git.enableSmartCommit` and `SCMHistoryItemContextContribution`
		// are real, non-AI upstream names this pattern must never catch —
		// the latter is the specific contribution
		// `docs/research/2026-07-25-core-git.md` decision 2 names as the
		// reason this snapshot needs a contributionIds dimension at all
		// (so it becomes *auditable*, e.g. diffable in a future SCM-override
		// slice's own test); its id carries no AI-semantic keyword itself,
		// so — accurately, not by omission — this regex-based guard does
		// not auto-flag it. Removing it (or confirming it never
		// instantiates) is `F080` S2's job via the dedicated AI-stripping
		// patch (decision 1), not this runtime guard's.
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					commandIds: [
						"git.commit",
						"git.commitStaged",
						"git.enableSmartCommit",
						"workbench.scm.acceptInput",
					],
					viewContainerIds: ["workbench.view.scm"],
					contributionIds: [
						"SCMHistoryItemContextContribution",
						"workbench.contrib.scmViewPane",
					],
				}),
			),
		).toEqual([]);
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

	it("still enforces extensions/gallery/marketplace, remote development and notebooks/tasks/testing on commandIds, viewContainerIds and viewIds — narrowing contributionIds must not weaken the user-visible dimensions", () => {
		expect(
			findExcludedWorkbenchSurfaces(
				snapshot({
					commandIds: [
						"workbench.extensions.action.installExtensions",
						"workbench.action.openRemote",
						"workbench.action.openNotebook",
					],
					viewContainerIds: [
						"workbench.view.extensions",
						"workbench.view.remote",
					],
					viewIds: ["workbench.views.notebook.testExplorer"],
				}),
			),
		).toEqual([
			{
				kind: "commandIds",
				id: "workbench.action.openNotebook",
				category: "notebooks, tasks or testing",
			},
			{
				kind: "commandIds",
				id: "workbench.action.openRemote",
				category: "remote development or tunnels",
			},
			{
				kind: "commandIds",
				id: "workbench.extensions.action.installExtensions",
				category: "extensions, gallery or marketplace",
			},
			{
				kind: "viewContainerIds",
				id: "workbench.view.extensions",
				category: "extensions, gallery or marketplace",
			},
			{
				kind: "viewContainerIds",
				id: "workbench.view.remote",
				category: "remote development or tunnels",
			},
			{
				kind: "viewIds",
				id: "workbench.views.notebook.testExplorer",
				category: "notebooks, tasks or testing",
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
					contributionIds: ["workbench.contrib.scmViewPane"],
				}),
			),
		).toEqual([]);
	});
});
