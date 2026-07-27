import { Codicon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/codicons";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { Registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform";
import { ViewPaneContainer } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer";
import {
	Extensions,
	ViewContainerLocation,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import { PlainGitGraphView } from "./plain-git-graph-view";
import { PlainGitHistoryView } from "./plain-git-history-view";
import { PlainScmView } from "./plain-scm-view";

/** `Plain: Refresh Source Control` reveals this view via
 * `IViewsService.openView` — see `plain-scm-commands.ts`. */
export const SCM_VIEW_CONTAINER_ID = "plain.workbench.viewContainer.scm";
export const SCM_VIEW_ID = PlainScmView.ID;
/** `F090` S1: `PlainGitHistoryView`'s registered id — kept in the same
 * Source Control view container as `PlainScmView` (see
 * `registerViews`'s own call below), matching the GitLens-style information
 * architecture convention the frozen research doc cites as an interaction
 * *reference* only ("历史归在源码管理面板下") — never any of its code. */
export const GIT_HISTORY_VIEW_ID = PlainGitHistoryView.ID;
/** `F090` S3: `PlainGitGraphView`'s registered id — same Source Control view
 * container as `PlainScmView`/`PlainGitHistoryView` (see `registerViews`'s
 * own call below), same "GitLens-style information architecture as an
 * interaction *reference* only" rationale [`GIT_HISTORY_VIEW_ID`]'s own
 * comment records. */
export const GIT_GRAPH_VIEW_ID = PlainGitGraphView.ID;

/**
 * Registers exactly one Sidebar view container and its one view pane —
 * Plain's own `PlainScmView` (see that file's own module doc comment for the
 * full excluded-surface audit trail), never any import of
 * `@codingame/monaco-vscode-scm-service-override`'s own
 * `scm.contribution.js`. This is a from-scratch, hand-reproduced *subset* of
 * what that file registers upstream (one viewlet, one view, no history
 * graph/repositories view, no AI merge-conflict action, no
 * `SCMHistoryItemContextContribution`) — the exact same "self-built
 * registration, not an import of the vendor contribution file" shape
 * `search-contribution.ts`/`terminal-contribution.ts` already established
 * for their own excluded-surface findings.
 *
 * `doNotRegisterOpenCommand: true` mirrors both of those siblings: Plain
 * registers its own `Plain: Refresh Source Control` command instead (see
 * `plain-scm-commands.ts`) rather than accepting whatever auto-generated
 * open-command `registerViewContainer` would otherwise add.
 */
const scmViewContainer = Registry.as<IViewContainersRegistry>(
	Extensions.ViewContainersRegistry,
).registerViewContainer(
	{
		id: SCM_VIEW_CONTAINER_ID,
		title: { value: "Source Control", original: "Source Control" },
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			SCM_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: true },
		]),
		hideIfEmpty: true,
		icon: Codicon.sourceControl,
		order: 3,
	},
	ViewContainerLocation.Sidebar,
	{ doNotRegisterOpenCommand: true },
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(
	[
		{
			id: SCM_VIEW_ID,
			containerIcon: Codicon.sourceControl,
			name: { value: "Source Control", original: "Source Control" },
			ctorDescriptor: new SyncDescriptor(PlainScmView),
			canToggleVisibility: false,
			canMoveView: true,
		},
		{
			id: GIT_HISTORY_VIEW_ID,
			containerIcon: Codicon.history,
			name: { value: "History", original: "History" },
			ctorDescriptor: new SyncDescriptor(PlainGitHistoryView),
			canToggleVisibility: true,
			canMoveView: true,
		},
		{
			id: GIT_GRAPH_VIEW_ID,
			containerIcon: Codicon.gitCommit,
			name: { value: "Graph", original: "Graph" },
			ctorDescriptor: new SyncDescriptor(PlainGitGraphView),
			canToggleVisibility: true,
			canMoveView: true,
		},
	],
	scmViewContainer,
);
