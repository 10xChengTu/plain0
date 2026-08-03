import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";

import type {
	GitHistoryMutationOutcome,
	GitHistoryOperation,
	GitHistoryPreview,
	GitRefEntry,
	GitResetMode,
	GitSequencerKind,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { plainGitInvalidation } from "./plain-git-invalidation";
import {
	bindPlainGitBridge,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainGitWorkspaceRoot,
	type PlainRootedGitBridge,
} from "./plain-git-root";

export const MERGE_COMMAND_ID = "plain.git.merge";
export const REBASE_COMMAND_ID = "plain.git.rebase";
export const CHERRY_PICK_COMMAND_ID = "plain.git.cherryPick";
export const REVERT_COMMAND_ID = "plain.git.revert";
export const RESET_COMMAND_ID = "plain.git.reset";
export const SHOW_REFLOG_COMMAND_ID = "plain.git.showReflog";
export const SHOW_CONTRIBUTORS_COMMAND_ID = "plain.git.showContributors";
export const CONTINUE_OPERATION_COMMAND_ID = "plain.git.continueOperation";
export const ABORT_OPERATION_COMMAND_ID = "plain.git.abortOperation";
export const CANCEL_OPERATION_COMMAND_ID = "plain.git.cancelOperation";

interface HistoryPickItem {
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
}

export interface PlainGitHistoryActionsQuickInput {
	pick<T extends HistoryPickItem>(
		items: readonly T[],
		options: Readonly<{ title: string; placeHolder?: string }>,
	): Promise<T | undefined>;
}

export interface PlainGitHistoryActionsDialog {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

export interface PlainGitHistoryActionsNotifications {
	info(message: string): void;
	error(message: string): void;
}

export interface PlainGitHistoryActionsServices {
	readonly quickInput: PlainGitHistoryActionsQuickInput;
	readonly dialog: PlainGitHistoryActionsDialog;
	readonly notifications: PlainGitHistoryActionsNotifications;
	readonly roots: () => readonly PlainGitWorkspaceRoot[];
}

interface HistorySession {
	readonly root: PlainGitWorkspaceRoot;
	readonly bridge: PlainRootedGitBridge;
}

interface HistoryTargetItem extends HistoryPickItem {
	readonly sha: string;
}

function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

function refTargetSha(entry: GitRefEntry): string {
	return entry.peeledSha ?? entry.targetSha;
}

function operationLabel(operation: GitHistoryOperation): string {
	switch (operation) {
		case "merge":
			return "Merge";
		case "rebase":
			return "Rebase";
		case "cherryPick":
			return "Cherry-Pick";
		case "revert":
			return "Revert";
		case "resetSoft":
			return "Soft Reset";
		case "resetMixed":
			return "Mixed Reset";
		case "resetHard":
			return "Hard Reset";
	}
}

function resetModeForOperation(
	operation: "resetSoft" | "resetMixed" | "resetHard",
): GitResetMode {
	switch (operation) {
		case "resetSoft":
			return "soft";
		case "resetMixed":
			return "mixed";
		case "resetHard":
			return "hard";
	}
}

function sequencerLabel(kind: GitSequencerKind): string {
	switch (kind) {
		case "merge":
			return "merge";
		case "rebase":
			return "rebase";
		case "cherryPick":
			return "cherry-pick";
		case "revert":
			return "revert";
	}
}

function boundedUniquePaths(preview: GitHistoryPreview): readonly string[] {
	const paths: string[] = [];
	for (const path of [
		...preview.workingTreePaths,
		...preview.stagedPaths,
		...preview.conflictedPaths,
	]) {
		if (!paths.includes(path) && paths.length < 256) {
			paths.push(path);
		}
	}
	return Object.freeze(paths);
}

function pathSection(title: string, paths: readonly string[]): string {
	return paths.length === 0
		? `${title}: none`
		: `${title} (${paths.length}):\n${paths.map((path) => `  ${path}`).join("\n")}`;
}

/** Builds only display text from the already-bounded Rust preview. The hard
 * reset branch deliberately names every tracked local path the authority says
 * will be discarded; untracked paths are neither returned nor implied. */
export function historyPreviewDetail(preview: GitHistoryPreview): string {
	const lines = [
		`Target: ${preview.targetSha}`,
		`Current HEAD: ${preview.headSha}`,
		`Target ahead/behind HEAD: ${preview.ahead}/${preview.behind}`,
	];
	if (preview.operation === "resetHard") {
		lines.push(
			"Hard reset moves HEAD and the index and discards the tracked local changes listed below. Untracked files are not deleted.",
			pathSection(
				"Tracked local paths that will be discarded",
				boundedUniquePaths(preview),
			),
		);
	} else {
		lines.push(
			pathSection("Working tree paths", preview.workingTreePaths),
			pathSection("Staged paths", preview.stagedPaths),
			pathSection("Conflicted paths", preview.conflictedPaths),
		);
	}
	if (preview.pathsTruncated) {
		lines.push("The path list is truncated at the safety limit.");
	}
	return lines.join("\n\n");
}

function sequencerDetail(
	headSha: string,
	kind: GitSequencerKind,
	conflictedPaths: readonly string[],
	pathsTruncated: boolean,
): string {
	const lines = [
		`Current HEAD: ${headSha}`,
		`Operation: ${sequencerLabel(kind)}`,
		pathSection("Conflicted paths", conflictedPaths),
	];
	if (pathsTruncated) {
		lines.push("The conflicted path list is truncated at the safety limit.");
	}
	return lines.join("\n\n");
}

/** Command-Palette workflows over the S1A/S3 strict read models and S3's
 * special-purpose history mutations. No user-entered revision or argv can
 * reach Git: every target is selected from HEAD, refs, graph or reflog DTOs. */
export class PlainGitHistoryActionsController {
	constructor(
		private readonly bridge: PlainBridge,
		private readonly services: PlainGitHistoryActionsServices,
	) {}

	async #session(): Promise<HistorySession | undefined> {
		const roots = this.services.roots();
		if (roots.length === 0) {
			this.services.notifications.info(
				"Plain: open a folder to use Git history operations.",
			);
			return undefined;
		}
		let root = plainGitRootSelection.resolve(roots);
		if (root === undefined) {
			const picked = await this.services.quickInput.pick(
				roots.map((candidate) =>
					Object.freeze({ label: candidate.label, root: candidate }),
				),
				{
					title: "Select Git Repository",
					placeHolder: "Choose the repository to operate on",
				},
			);
			if (picked === undefined) {
				return undefined;
			}
			plainGitRootSelection.select(picked.root.rootId, roots);
			root = picked.root;
		}
		return Object.freeze({
			root,
			bridge: bindPlainGitBridge(this.bridge, root.rootId),
		});
	}

	#report(error: unknown): void {
		this.services.notifications.error(normalizeCommandError(error).message);
	}

	async #pickTarget(
		session: HistorySession,
		title: string,
	): Promise<HistoryTargetItem | undefined> {
		const [state, refs, graph, reflog] = await Promise.all([
			session.bridge.gitHistoryState(),
			session.bridge.gitRefsList(),
			session.bridge.gitLogGraph(500),
			session.bridge.gitReflogList(),
		]);
		const aliasesBySha = new Map<string, string[]>();
		const subjectsBySha = new Map<string, string>();
		const order: string[] = [];
		const add = (sha: string): void => {
			if (!aliasesBySha.has(sha)) {
				aliasesBySha.set(sha, []);
				order.push(sha);
			}
		};
		add(state.headSha);
		aliasesBySha.get(state.headSha)!.push("HEAD");
		for (const ref of refs.entries) {
			const sha = refTargetSha(ref);
			add(sha);
			aliasesBySha.get(sha)!.push(ref.shortName);
		}
		for (const node of graph.nodes) {
			add(node.sha);
			subjectsBySha.set(node.sha, node.subject);
		}
		for (const entry of reflog.entries) {
			add(entry.sha);
			aliasesBySha.get(entry.sha)!.push(entry.selector);
			if (!subjectsBySha.has(entry.sha)) {
				subjectsBySha.set(entry.sha, entry.summary);
			}
		}
		const items = order.map((sha) => {
			const aliases = [...new Set(aliasesBySha.get(sha))];
			const subject = subjectsBySha.get(sha);
			return Object.freeze({
				label: aliases.length > 0 ? aliases.join(", ") : shortSha(sha),
				description: shortSha(sha),
				detail: subject,
				sha,
			});
		});
		if (items.length === 0) {
			this.services.notifications.info(
				"Plain: this repository has no commit to target.",
			);
			return undefined;
		}
		return this.services.quickInput.pick(items, {
			title,
			placeHolder: "Choose a commit from HEAD, refs, graph or reflog",
		});
	}

	#publishOutcome(
		session: HistorySession,
		label: string,
		outcome: GitHistoryMutationOutcome,
	): void {
		plainGitInvalidation.invalidate(session.root.rootId);
		if (outcome.kind === "completed") {
			this.services.notifications.info(`Plain: ${label} completed.`);
			return;
		}
		if (outcome.kind === "cancelled") {
			this.services.notifications.info(
				`Plain: ${label} was cancelled. The repository was refreshed from its actual Git state; cancellation did not imply rollback.`,
			);
			return;
		}
		const sequencer = outcome.state.sequencer;
		const conflictSuffix =
			sequencer !== null && sequencer.conflictedPaths.length > 0
				? ` Resolve: ${sequencer.conflictedPaths.join(", ")}.`
				: "";
		this.services.notifications.error(
			`Plain: ${label} ${outcome.kind === "conflicts" ? "stopped with conflicts" : "stopped before completion"}.${conflictSuffix} Use Continue or Abort Git Operation after reviewing the repository.`,
		);
	}

	async #runTargeted(operation: GitHistoryOperation): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const label = operationLabel(operation);
			const target = await this.#pickTarget(session, `${label}: Select Target`);
			if (target === undefined) {
				return;
			}
			const preview = await session.bridge.gitHistoryPreview(
				operation,
				target.sha,
			);
			if (preview.sequencer !== null) {
				this.services.notifications.info(
					`Plain: finish or abort the current ${sequencerLabel(preview.sequencer.kind)} before starting ${label.toLowerCase()}.`,
				);
				return;
			}
			const confirmation = await this.services.dialog.confirm({
				message: `${label} to ${target.label}?`,
				detail: historyPreviewDetail(preview),
				primaryButton:
					operation === "resetHard"
						? "Hard Reset and Discard Tracked Changes"
						: label,
			});
			if (!confirmation.confirmed) {
				return;
			}
			let outcome: GitHistoryMutationOutcome;
			switch (operation) {
				case "merge":
					outcome = await session.bridge.gitMerge(
						target.sha,
						preview.previewToken,
					);
					break;
				case "rebase":
					outcome = await session.bridge.gitRebase(
						target.sha,
						preview.previewToken,
					);
					break;
				case "cherryPick":
					outcome = await session.bridge.gitCherryPick(
						target.sha,
						preview.previewToken,
					);
					break;
				case "revert":
					outcome = await session.bridge.gitRevert(
						target.sha,
						preview.previewToken,
					);
					break;
				case "resetSoft":
				case "resetMixed":
				case "resetHard":
					outcome = await session.bridge.gitReset(
						target.sha,
						resetModeForOperation(operation),
						preview.previewToken,
					);
					break;
			}
			this.#publishOutcome(session, label, outcome);
		} catch (error) {
			this.#report(error);
		}
	}

	async merge(): Promise<void> {
		await this.#runTargeted("merge");
	}

	async rebase(): Promise<void> {
		await this.#runTargeted("rebase");
	}

	async cherryPick(): Promise<void> {
		await this.#runTargeted("cherryPick");
	}

	async revert(): Promise<void> {
		await this.#runTargeted("revert");
	}

	async reset(): Promise<void> {
		type ResetItem = HistoryPickItem & Readonly<{ mode: GitResetMode }>;
		const choice = await this.services.quickInput.pick<ResetItem>(
			[
				{
					label: "Soft Reset",
					detail: "Move HEAD only; keep index and working tree unchanged.",
					mode: "soft",
				},
				{
					label: "Mixed Reset",
					detail: "Move HEAD and reset the index; keep working tree bytes.",
					mode: "mixed",
				},
				{
					label: "Hard Reset",
					detail:
						"Move HEAD and discard tracked index and working tree changes.",
					mode: "hard",
				},
			],
			{ title: "Reset: Select Mode" },
		);
		if (choice !== undefined) {
			const suffix =
				choice.mode === "soft"
					? "Soft"
					: choice.mode === "mixed"
						? "Mixed"
						: "Hard";
			await this.#runTargeted(`reset${suffix}`);
		}
	}

	async showReflog(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const result = await session.bridge.gitReflogList();
			if (result.entries.length === 0) {
				this.services.notifications.info("Plain: the HEAD reflog is empty.");
				return;
			}
			await this.services.quickInput.pick(
				result.entries.map((entry) =>
					Object.freeze({
						label: `${entry.selector} ${entry.summary}`,
						description: shortSha(entry.sha),
						detail: `Commit ${entry.sha} · Unix time ${entry.committerTime}`,
					}),
				),
				{
					title: "HEAD Reflog",
					placeHolder: result.truncated
						? "Showing the newest entries up to the safety limit"
						: "Select an entry to inspect it",
				},
			);
		} catch (error) {
			this.#report(error);
		}
	}

	async showContributors(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const result = await session.bridge.gitContributorsList();
			if (result.entries.length === 0) {
				this.services.notifications.info(
					"Plain: this repository has no contributors to show.",
				);
				return;
			}
			await this.services.quickInput.pick(
				result.entries.map((entry) =>
					Object.freeze({
						label: entry.name || entry.email || "(unknown contributor)",
						description:
							entry.name.length > 0 && entry.email.length > 0
								? entry.email
								: undefined,
						detail: `${entry.commits} commit${entry.commits === 1 ? "" : "s"}`,
					}),
				),
				{
					title: "Contributors",
					placeHolder: result.truncated
						? "Showing contributors up to the safety limit"
						: "Contributors are sorted by commit count",
				},
			);
		} catch (error) {
			this.#report(error);
		}
	}

	async #runSequencer(action: "continue" | "abort"): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const state = await session.bridge.gitHistoryState();
			const sequencer = state.sequencer;
			if (sequencer === null) {
				this.services.notifications.info(
					"Plain: there is no Git history operation to continue or abort.",
				);
				return;
			}
			if (action === "abort") {
				const confirmation = await this.services.dialog.confirm({
					message: `Abort the current ${sequencerLabel(sequencer.kind)}?`,
					detail: `${sequencerDetail(state.headSha, sequencer.kind, sequencer.conflictedPaths, sequencer.pathsTruncated)}\n\nAbort asks Git to restore the operation's pre-start state.`,
					primaryButton: "Abort Git Operation",
				});
				if (!confirmation.confirmed) {
					return;
				}
			}
			const outcome =
				action === "continue"
					? await session.bridge.gitHistoryContinue(sequencer.kind)
					: await session.bridge.gitHistoryAbort(sequencer.kind);
			this.#publishOutcome(
				session,
				`${action === "continue" ? "Continue" : "Abort"} ${sequencerLabel(sequencer.kind)}`,
				outcome,
			);
		} catch (error) {
			this.#report(error);
		}
	}

	async continueOperation(): Promise<void> {
		await this.#runSequencer("continue");
	}

	async abortOperation(): Promise<void> {
		await this.#runSequencer("abort");
	}

	async cancelOperation(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			await session.bridge.gitHistoryCancel();
			plainGitInvalidation.invalidate(session.root.rootId);
			this.services.notifications.info(
				"Plain: Git operation cancellation requested. The repository will be refreshed from its actual state when Git stops; cancellation does not imply rollback.",
			);
		} catch (error) {
			this.#report(error);
		}
	}
}

export interface PlainGitHistoryActionsRegistration {
	dispose(): void;
}

const HISTORY_ACTION_COMMANDS = Object.freeze([
	Object.freeze({ id: MERGE_COMMAND_ID, title: "Merge", method: "merge" }),
	Object.freeze({ id: REBASE_COMMAND_ID, title: "Rebase", method: "rebase" }),
	Object.freeze({
		id: CHERRY_PICK_COMMAND_ID,
		title: "Cherry-Pick",
		method: "cherryPick",
	}),
	Object.freeze({ id: REVERT_COMMAND_ID, title: "Revert", method: "revert" }),
	Object.freeze({ id: RESET_COMMAND_ID, title: "Reset", method: "reset" }),
	Object.freeze({
		id: SHOW_REFLOG_COMMAND_ID,
		title: "Show Reflog",
		method: "showReflog",
	}),
	Object.freeze({
		id: SHOW_CONTRIBUTORS_COMMAND_ID,
		title: "Show Contributors",
		method: "showContributors",
	}),
	Object.freeze({
		id: CONTINUE_OPERATION_COMMAND_ID,
		title: "Continue Git Operation",
		method: "continueOperation",
	}),
	Object.freeze({
		id: ABORT_OPERATION_COMMAND_ID,
		title: "Abort Git Operation",
		method: "abortOperation",
	}),
	Object.freeze({
		id: CANCEL_OPERATION_COMMAND_ID,
		title: "Cancel Git Operation",
		method: "cancelOperation",
	}),
] as const);

type HistoryActionMethod = (typeof HISTORY_ACTION_COMMANDS)[number]["method"];

export function registerPlainGitHistoryActionCommands(
	bridge: PlainBridge,
): PlainGitHistoryActionsRegistration {
	const commands = HISTORY_ACTION_COMMANDS.map(({ id, method }) =>
		CommandsRegistry.registerCommand(id, async (accessor) => {
			const quickInput = accessor.get(IQuickInputService);
			const workspace = accessor.get(IWorkspaceContextService);
			const controller = new PlainGitHistoryActionsController(bridge, {
				quickInput: {
					pick: (items, options) =>
						quickInput.pick([...items], { ...options, canPickMany: false }),
				},
				dialog: accessor.get(IDialogService),
				notifications: accessor.get(INotificationService),
				roots: () =>
					plainGitRootsFromWorkspaceFolders(workspace.getWorkspace().folders),
			});
			await controller[method as HistoryActionMethod]();
		}),
	);
	const menus = HISTORY_ACTION_COMMANDS.map(({ id, title }) =>
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id, title, category: "Plain" },
		}),
	);
	return {
		dispose() {
			for (const disposable of [...commands, ...menus]) {
				disposable.dispose();
			}
		},
	};
}
