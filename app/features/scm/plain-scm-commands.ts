import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import { normalizeCommandError } from "../../platform/tauri/errors";
import { computeContentAfterApplyingHunk } from "./hunk-stage";
import { relativePathUnder } from "./plain-scm-provider";
import { getConfiguredPlainScmBridge, PlainScmView } from "./plain-scm-view";
import { SCM_VIEW_ID } from "./scm-contribution";

/** Plain's own command — never a vendor `workbench.scm.*`/`git.*` id
 * takeover (there is no such id registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-scm-service-override`'s own `scm.contribution.js`
 * is never imported — see `plain-scm-view.ts`'s module doc comment). */
export const REFRESH_SCM_COMMAND_ID = "plain.scm.refresh";

/**
 * `F080` S3's one testable hunk-level stage path (see
 * `docs/research/2026-07-25-core-git.md`'s hunk-stage architecture note and
 * this slice's own report for the recorded scope decision): a real gutter/
 * diff-editor "Stage Selected Ranges" action is real Workbench UI
 * (`IQuickDiffService` + editor gutter decorations) this slice does not
 * build. What *is* real here is the full upstream-mirrored pipeline —
 * Monaco's own diff engine (`hunk-stage.ts`'s
 * `computeContentAfterApplyingHunk`) computes "the active file's content
 * after applying its first changed hunk", and that computed content is sent
 * to `PlainBridge.gitStageBlob`, which Rust turns into a real
 * `hash-object`+`update-index` pair (`src-tauri/src/git/stage.rs`) — exactly
 * the same write path a full hunk UI would eventually call, just triggered
 * from the Command Palette against the currently active editor instead of a
 * clicked gutter range.
 *
 * Diffs the **index** version (`gitShowBlob("index", …)`) against the
 * **working-tree** (on-disk, via `workspaceReadFile`) version — matching
 * real `git add -p`'s own quick-diff semantics: staging is always relative
 * to what is currently in the index, never `HEAD`. Always targets hunk index
 * `0` (the first changed range) — selecting an arbitrary hunk is exactly the
 * gutter-UI scope this command does not build.
 */
export const STAGE_ACTIVE_FILE_FIRST_HUNK_COMMAND_ID =
	"plain.scm.stageActiveFileFirstHunk";

const utf8Decoder = new TextDecoder();

async function runStageActiveFileFirstHunk(
	editorService: IEditorService,
	workspaceContextService: IWorkspaceContextService,
	notificationService: INotificationService,
	viewsService: IViewsService,
): Promise<void> {
	const bridge = getConfiguredPlainScmBridge();
	if (bridge === undefined) {
		return;
	}
	const resource = editorService.activeEditor?.resource;
	if (resource === undefined) {
		notificationService.info("Plain: open a file to stage a change.");
		return;
	}
	const rootUri = workspaceContextService.getWorkspace().folders[0]?.uri;
	if (rootUri === undefined) {
		notificationService.info("Plain: open a folder to use Source Control.");
		return;
	}
	const relativePath = relativePathUnder(rootUri, resource);
	if (relativePath === undefined) {
		notificationService.info(
			"Plain: the active file is outside the open workspace.",
		);
		return;
	}
	// `resource`'s own URI authority *is* its root id — the same identity
	// `file-system-provider.ts`'s `frozenWorkspaceEntryRequest(resource.
	// authority, …)` already relies on for every other read/write against
	// this scheme. Since `resource` is already confirmed (via
	// `relativePathUnder` above) to share `rootUri`'s scheme and authority,
	// reading it directly here avoids a second `workspaceSnapshot()` round
	// trip just to look the same id back up.
	const rootId = resource.authority;

	try {
		const [originalResult, modifiedFile] = await Promise.all([
			bridge.gitShowBlob("index", relativePath),
			bridge.workspaceReadFile(rootId, relativePath),
		]);
		const originalText =
			originalResult.content === null
				? ""
				: utf8Decoder.decode(originalResult.content);
		const modifiedText = utf8Decoder.decode(modifiedFile.value.copy());
		const hunkContent = computeContentAfterApplyingHunk(
			originalText,
			modifiedText,
			0,
		);
		if (hunkContent === undefined) {
			notificationService.info(
				`Plain: no changes to stage in "${relativePath}".`,
			);
			return;
		}
		await bridge.gitStageBlob(
			relativePath,
			new TextEncoder().encode(hunkContent),
		);
		notificationService.info(
			`Plain: staged the first change in "${relativePath}".`,
		);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
		return;
	}

	const view = await viewsService.openView<PlainScmView>(SCM_VIEW_ID, false);
	await view?.refresh();
}

export interface PlainScmCommandsRegistration {
	dispose(): void;
}

/**
 * `Plain: Refresh Source Control` opens (revealing the Sidebar if hidden)
 * `PlainScmView` and re-runs its own discovery/refresh — the "手动刷新"
 * half of `F080` S2's refresh story (see `plain-scm-view.ts`'s own doc
 * comment for the other half: a best-effort re-refresh on workspace
 * file-change notifications, wired from `app/main.ts`). Useful right after
 * granting workspace trust from the terminal panel (this view never prompts
 * for trust itself) or after a `.git` operation performed outside Plain
 * entirely (a separate terminal, another app).
 */
export function registerPlainScmCommands(): PlainScmCommandsRegistration {
	const disposables = [
		CommandsRegistry.registerCommand(
			REFRESH_SCM_COMMAND_ID,
			async (accessor) => {
				const viewsService = accessor.get(IViewsService);
				const view = await viewsService.openView<PlainScmView>(
					SCM_VIEW_ID,
					true,
				);
				await view?.refresh();
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: REFRESH_SCM_COMMAND_ID,
				title: "Refresh Source Control",
				category: "Plain",
			},
		}),
		CommandsRegistry.registerCommand(
			STAGE_ACTIVE_FILE_FIRST_HUNK_COMMAND_ID,
			async (accessor) => {
				await runStageActiveFileFirstHunk(
					accessor.get(IEditorService),
					accessor.get(IWorkspaceContextService),
					accessor.get(INotificationService),
					accessor.get(IViewsService),
				);
			},
		),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: STAGE_ACTIVE_FILE_FIRST_HUNK_COMMAND_ID,
				title: "Stage First Change in Active File (Hunk)",
				category: "Plain",
			},
		}),
	];
	return {
		dispose() {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}
