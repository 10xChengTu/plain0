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
	GitRefEntry,
	GitRemoteEntry,
	GitStatusResult,
	PlainBridge,
} from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { plainGitInvalidation } from "./plain-git-invalidation";
import {
	bindPlainGitBridge,
	gitUpstreamDisplayName,
	plainGitRootSelection,
	plainGitRootsFromWorkspaceFolders,
	type PlainGitWorkspaceRoot,
	type PlainRootedGitBridge,
} from "./plain-git-root";

export const MANAGE_BRANCHES_COMMAND_ID = "plain.git.manageBranches";
export const MANAGE_TAGS_COMMAND_ID = "plain.git.manageTags";
export const MANAGE_REMOTES_COMMAND_ID = "plain.git.manageRemotes";
export const MANAGE_UPSTREAM_COMMAND_ID = "plain.git.manageUpstream";

interface ManagementPickItem {
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
}

export interface PlainGitManagementQuickInput {
	pick<T extends ManagementPickItem>(
		items: readonly T[],
		options: Readonly<{ title: string; placeHolder?: string }>,
	): Promise<T | undefined>;
	input(options: {
		readonly title: string;
		readonly prompt?: string;
		readonly placeHolder?: string;
		readonly value?: string;
		readonly password?: boolean;
		readonly validateInput?: (
			value: string,
		) => Promise<string | null | undefined>;
	}): Promise<string | undefined>;
}

export interface PlainGitManagementDialog {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

export interface PlainGitManagementNotifications {
	info(message: string): void;
	error(message: string): void;
}

export interface PlainGitManagementServices {
	readonly quickInput: PlainGitManagementQuickInput;
	readonly dialog: PlainGitManagementDialog;
	readonly notifications: PlainGitManagementNotifications;
	readonly roots: () => readonly PlainGitWorkspaceRoot[];
}

interface ManagementSession {
	readonly root: PlainGitWorkspaceRoot;
	readonly bridge: PlainRootedGitBridge;
}

interface TargetItem extends ManagementPickItem {
	readonly sha: string;
}

function isCommitSha(value: string): boolean {
	return /^[0-9a-f]{40}$/u.test(value);
}

function shortSha(value: string): string {
	return value.slice(0, 7);
}

function hasAsciiControl(value: string, includeSpace: boolean): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		if (
			codePoint <= (includeSpace ? 0x20 : 0x1f) ||
			(codePoint >= 0x7f && codePoint <= 0x9f)
		) {
			return true;
		}
	}
	return false;
}

function inputNameProblem(
	value: string,
	kind: "branch" | "tag" | "remote",
): string | undefined {
	const max = kind === "remote" ? 255 : 1_024;
	if (value.length === 0) {
		return `Enter a ${kind} name.`;
	}
	if (value.length > max) {
		return `The ${kind} name is too long.`;
	}
	if (
		value.startsWith("-") ||
		value.startsWith("refs/") ||
		hasAsciiControl(value, true) ||
		(kind === "remote" && value.includes("/"))
	) {
		return `The ${kind} name is not valid.`;
	}
	return undefined;
}

function inputUrlProblem(value: string): string | undefined {
	if (value.length === 0) {
		return "Enter a remote URL.";
	}
	if (value.length > 4_096 || hasAsciiControl(value, false)) {
		return "The remote URL is not valid.";
	}
	return undefined;
}

/** Display-only redaction for the new URL shown in a pre-write confirmation.
 * The raw input remains a one-shot local variable and is never placed in a
 * Quick Pick item, notification, invalidation event or persisted state. */
export function redactRemoteLocationForDisplay(raw: string): string {
	if (raw.startsWith("file://")) {
		return "file://<local-path>";
	}
	if (
		raw.startsWith("/") ||
		raw.startsWith("./") ||
		raw.startsWith("../") ||
		raw.startsWith("\\\\") ||
		/^[A-Za-z]:[\\/]/u.test(raw)
	) {
		return "<local-path>";
	}
	const suffixIndex = raw.search(/[?#]/u);
	const base = suffixIndex < 0 ? raw : raw.slice(0, suffixIndex);
	let redacted = base;
	const schemeIndex = base.indexOf("://");
	if (schemeIndex >= 0) {
		const authorityStart = schemeIndex + 3;
		const slashIndex = base.indexOf("/", authorityStart);
		const authorityEnd = slashIndex < 0 ? base.length : slashIndex;
		const authority = base.slice(authorityStart, authorityEnd);
		const atIndex = authority.lastIndexOf("@");
		if (atIndex >= 0) {
			redacted = `${base.slice(0, authorityStart)}<redacted>@${authority.slice(atIndex + 1)}${base.slice(authorityEnd)}`;
		}
	} else {
		const atIndex = base.indexOf("@");
		if (atIndex >= 0 && base.slice(atIndex + 1).includes(":")) {
			redacted = `<redacted>@${base.slice(atIndex + 1)}`;
		}
	}
	return suffixIndex < 0 ? redacted : `${redacted}?<redacted>`;
}

function targetSha(entry: GitRefEntry): string {
	return entry.peeledSha ?? entry.targetSha;
}

function targetItems(
	refs: readonly GitRefEntry[],
	status: GitStatusResult,
): readonly TargetItem[] {
	const namesBySha = new Map<string, string[]>();
	if (isCommitSha(status.branch.oid)) {
		namesBySha.set(status.branch.oid, ["HEAD"]);
	}
	for (const entry of refs) {
		const sha = targetSha(entry);
		if (!isCommitSha(sha)) {
			continue;
		}
		const names = namesBySha.get(sha) ?? [];
		names.push(entry.shortName);
		namesBySha.set(sha, names);
	}
	return Object.freeze(
		[...namesBySha.entries()].map(([sha, names]) =>
			Object.freeze({
				label: names.join(", "),
				description: shortSha(sha),
				sha,
			}),
		),
	);
}

function remoteUrlSummary(remote: GitRemoteEntry): string {
	const fetch =
		remote.fetchUrls.length > 0 ? remote.fetchUrls.join(", ") : "(none)";
	const push =
		remote.pushUrls.length > 0
			? remote.pushUrls.join(", ")
			: "(uses fetch URL)";
	return `Fetch: ${fetch}\nPush: ${push}`;
}

/** Command Palette workflow over S1A snapshots and S1B special-purpose
 * mutations. All ref/remote/upstream targets are selected from freshly-read
 * DTOs; free text is limited to new names, one-shot URLs and tag messages. */
export class PlainGitManagementController {
	constructor(
		private readonly bridge: PlainBridge,
		private readonly services: PlainGitManagementServices,
	) {}

	async #session(): Promise<ManagementSession | undefined> {
		const roots = this.services.roots();
		if (roots.length === 0) {
			this.services.notifications.info(
				"Plain: open a folder to manage Git repositories.",
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
					placeHolder: "Choose the repository to manage",
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

	#didMutate(session: ManagementSession, message: string): void {
		plainGitInvalidation.invalidate(session.root.rootId);
		this.services.notifications.info(message);
	}

	async #inputName(
		kind: "branch" | "tag" | "remote",
		title: string,
		value?: string,
	): Promise<string | undefined> {
		return this.services.quickInput.input({
			title,
			value,
			prompt: `Enter the ${kind} name.`,
			validateInput: async (input) => inputNameProblem(input, kind),
		});
	}

	async #pickTarget(
		refs: readonly GitRefEntry[],
		status: GitStatusResult,
	): Promise<TargetItem | undefined> {
		const items = targetItems(refs, status);
		if (items.length === 0) {
			this.services.notifications.info(
				"Plain: this repository has no commit to target.",
			);
			return undefined;
		}
		return this.services.quickInput.pick(items, {
			title: "Select Target Commit",
			placeHolder: "Choose a branch, remote branch, tag or HEAD",
		});
	}

	async manageBranches(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const [refResult, status] = await Promise.all([
				session.bridge.gitRefsList(),
				session.bridge.gitStatus(),
			]);
			const branches = refResult.entries.filter(
				(entry) => entry.kind === "branch",
			);
			type BranchChoice = ManagementPickItem &
				(
					| Readonly<{ action: "create" }>
					| Readonly<{ action: "select"; entry: GitRefEntry }>
				);
			const picked = await this.services.quickInput.pick<BranchChoice>(
				[
					Object.freeze({ label: "Create Branch…", action: "create" as const }),
					...branches.map((entry) =>
						Object.freeze({
							label: `${entry.isHead ? "* " : ""}${entry.shortName}`,
							description: shortSha(entry.targetSha),
							action: "select" as const,
							entry,
						}),
					),
				],
				{ title: "Manage Branches" },
			);
			if (picked === undefined) {
				return;
			}
			if (picked.action === "create") {
				const target = await this.#pickTarget(refResult.entries, status);
				if (target === undefined) {
					return;
				}
				const name = await this.#inputName("branch", "Create Branch");
				if (name === undefined) {
					return;
				}
				await session.bridge.gitBranchCreate(name, target.sha);
				this.#didMutate(session, `Plain: created branch "${name}".`);
				return;
			}

			const branch = picked.entry;
			type BranchAction = ManagementPickItem &
				Readonly<{ action: "switch" | "rename" | "delete" }>;
			const actions: BranchAction[] = [];
			if (!branch.isHead) {
				actions.push({ label: "Switch to Branch", action: "switch" });
			}
			actions.push({ label: "Rename Branch…", action: "rename" });
			if (!branch.isHead) {
				actions.push({ label: "Delete Branch", action: "delete" });
			}
			const action = await this.services.quickInput.pick(actions, {
				title: `Branch: ${branch.shortName}`,
			});
			if (action === undefined) {
				return;
			}
			if (action.action === "switch") {
				await session.bridge.gitBranchSwitch(branch.shortName);
				this.#didMutate(
					session,
					`Plain: switched to branch "${branch.shortName}".`,
				);
				return;
			}
			if (action.action === "rename") {
				const newName = await this.#inputName(
					"branch",
					`Rename Branch: ${branch.shortName}`,
					branch.shortName,
				);
				if (newName === undefined || newName === branch.shortName) {
					return;
				}
				await session.bridge.gitBranchRename(branch.shortName, newName);
				this.#didMutate(session, `Plain: renamed branch to "${newName}".`);
				return;
			}

			const outcome = await session.bridge.gitBranchDelete(
				branch.shortName,
				false,
			);
			if (outcome === "deleted") {
				this.#didMutate(
					session,
					`Plain: deleted branch "${branch.shortName}".`,
				);
				return;
			}
			const confirmation = await this.services.dialog.confirm({
				message: `Force delete unmerged branch "${branch.shortName}"?`,
				detail: `Target: ${branch.targetSha}\n\nThe branch is not fully merged. Force deletion removes the ref and can make its commits harder to recover.`,
				primaryButton: "Force Delete Branch",
			});
			if (!confirmation.confirmed) {
				return;
			}
			const forced = await session.bridge.gitBranchDelete(
				branch.shortName,
				true,
			);
			if (forced !== "deleted") {
				throw new Error("Forced branch deletion did not report deletion.");
			}
			this.#didMutate(session, `Plain: deleted branch "${branch.shortName}".`);
		} catch (error) {
			this.#report(error);
		}
	}

	async manageTags(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const [refResult, status] = await Promise.all([
				session.bridge.gitRefsList(),
				session.bridge.gitStatus(),
			]);
			const tags = refResult.entries.filter((entry) => entry.kind === "tag");
			type TagChoice = ManagementPickItem &
				(
					| Readonly<{ action: "createLightweight" | "createAnnotated" }>
					| Readonly<{ action: "delete"; entry: GitRefEntry }>
				);
			const choice = await this.services.quickInput.pick<TagChoice>(
				[
					{ label: "Create Lightweight Tag…", action: "createLightweight" },
					{ label: "Create Annotated Tag…", action: "createAnnotated" },
					...tags.map((entry) => ({
						label: `Delete ${entry.shortName}`,
						description: shortSha(targetSha(entry)),
						action: "delete" as const,
						entry,
					})),
				],
				{ title: "Manage Tags" },
			);
			if (choice === undefined) {
				return;
			}
			if (choice.action === "delete") {
				const confirmation = await this.services.dialog.confirm({
					message: `Delete tag "${choice.entry.shortName}"?`,
					detail: `Target: ${targetSha(choice.entry)}\n\nThis removes the tag ref. It does not delete the target commit.`,
					primaryButton: "Delete Tag",
				});
				if (!confirmation.confirmed) {
					return;
				}
				await session.bridge.gitTagDelete(choice.entry.shortName);
				this.#didMutate(
					session,
					`Plain: deleted tag "${choice.entry.shortName}".`,
				);
				return;
			}

			const target = await this.#pickTarget(refResult.entries, status);
			if (target === undefined) {
				return;
			}
			const name = await this.#inputName("tag", "Create Tag");
			if (name === undefined) {
				return;
			}
			let message: string | null = null;
			if (choice.action === "createAnnotated") {
				const input = await this.services.quickInput.input({
					title: `Annotated Tag: ${name}`,
					prompt: "Enter the tag message.",
					validateInput: async (value) =>
						value.trim().length === 0
							? "Enter a tag message."
							: value.length > 100_000
								? "The tag message is too long."
								: undefined,
				});
				if (input === undefined) {
					return;
				}
				message = input;
			}
			await session.bridge.gitTagCreate(name, target.sha, message);
			this.#didMutate(session, `Plain: created tag "${name}".`);
		} catch (error) {
			this.#report(error);
		}
	}

	async manageRemotes(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const result = await session.bridge.gitRemotesList();
			type RemoteChoice = ManagementPickItem &
				(
					| Readonly<{ action: "add" }>
					| Readonly<{ action: "select"; remote: GitRemoteEntry }>
				);
			const choice = await this.services.quickInput.pick<RemoteChoice>(
				[
					{ label: "Add Remote…", action: "add" },
					...result.entries.map((remote) => ({
						label: remote.name,
						detail: remoteUrlSummary(remote),
						action: "select" as const,
						remote,
					})),
				],
				{ title: "Manage Remotes" },
			);
			if (choice === undefined) {
				return;
			}
			if (choice.action === "add") {
				const name = await this.#inputName("remote", "Add Remote");
				if (name === undefined) {
					return;
				}
				const url = await this.services.quickInput.input({
					title: `Remote URL: ${name}`,
					prompt: "Enter the fetch URL.",
					validateInput: async (value) => inputUrlProblem(value),
				});
				if (url === undefined) {
					return;
				}
				await session.bridge.gitRemoteAdd(name, url);
				this.#didMutate(session, `Plain: added remote "${name}".`);
				return;
			}

			const remote = choice.remote;
			type RemoteAction = ManagementPickItem &
				Readonly<{
					action: "rename" | "setFetchUrl" | "setPushUrl" | "remove";
				}>;
			const action = await this.services.quickInput.pick<RemoteAction>(
				[
					{ label: "Rename Remote…", action: "rename" },
					{ label: "Change Fetch URL…", action: "setFetchUrl" },
					{ label: "Change Push URL…", action: "setPushUrl" },
					{ label: "Remove Remote", action: "remove" },
				],
				{ title: `Remote: ${remote.name}` },
			);
			if (action === undefined) {
				return;
			}
			if (action.action === "rename") {
				const newName = await this.#inputName(
					"remote",
					`Rename Remote: ${remote.name}`,
					remote.name,
				);
				if (newName === undefined || newName === remote.name) {
					return;
				}
				await session.bridge.gitRemoteRename(remote.name, newName);
				this.#didMutate(session, `Plain: renamed remote to "${newName}".`);
				return;
			}
			if (action.action === "remove") {
				const confirmation = await this.services.dialog.confirm({
					message: `Remove remote "${remote.name}"?`,
					detail: `${remoteUrlSummary(remote)}\n\nRemoving a remote also removes its remote-tracking refs.`,
					primaryButton: "Remove Remote",
				});
				if (!confirmation.confirmed) {
					return;
				}
				await session.bridge.gitRemoteRemove(remote.name);
				this.#didMutate(session, `Plain: removed remote "${remote.name}".`);
				return;
			}

			const kind = action.action === "setFetchUrl" ? "fetch" : "push";
			const oldUrls = kind === "fetch" ? remote.fetchUrls : remote.pushUrls;
			const url = await this.services.quickInput.input({
				title: `Change ${kind === "fetch" ? "Fetch" : "Push"} URL: ${remote.name}`,
				prompt: "Enter the new URL.",
				validateInput: async (value) => inputUrlProblem(value),
			});
			if (url === undefined) {
				return;
			}
			const confirmation = await this.services.dialog.confirm({
				message: `Change ${kind} URL for remote "${remote.name}"?`,
				detail: `Old: ${oldUrls.length > 0 ? oldUrls.join(", ") : "(none)"}\nNew: ${redactRemoteLocationForDisplay(url)}`,
				primaryButton: "Change URL",
			});
			if (!confirmation.confirmed) {
				return;
			}
			await session.bridge.gitRemoteSetUrl(remote.name, kind, url);
			this.#didMutate(
				session,
				`Plain: changed ${kind} URL for "${remote.name}".`,
			);
		} catch (error) {
			this.#report(error);
		}
	}

	async manageUpstream(): Promise<void> {
		const session = await this.#session();
		if (session === undefined) {
			return;
		}
		try {
			const result = await session.bridge.gitRefsList();
			const branches = result.entries.filter(
				(entry) => entry.kind === "branch",
			);
			const branch = await this.services.quickInput.pick(
				branches.map((entry) => ({
					label: entry.shortName,
					description:
						entry.upstream === null
							? "No upstream"
							: `Tracks ${gitUpstreamDisplayName(entry.upstream)}`,
					entry,
				})),
				{ title: "Manage Upstream", placeHolder: "Choose a local branch" },
			);
			if (branch === undefined) {
				return;
			}
			type UpstreamAction = ManagementPickItem &
				Readonly<{ action: "set" | "unset" }>;
			const actions: UpstreamAction[] = [
				{
					label:
						branch.entry.upstream === null
							? "Set Upstream…"
							: "Change Upstream…",
					action: "set",
				},
			];
			if (branch.entry.upstream !== null) {
				actions.push({ label: "Unset Upstream", action: "unset" });
			}
			const action = await this.services.quickInput.pick(actions, {
				title: `Upstream: ${branch.entry.shortName}`,
			});
			if (action === undefined) {
				return;
			}
			if (action.action === "unset") {
				await session.bridge.gitUpstreamUnset(branch.entry.shortName);
				this.#didMutate(
					session,
					`Plain: unset upstream for "${branch.entry.shortName}".`,
				);
				return;
			}
			const remoteBranches = result.entries.filter(
				(entry) => entry.kind === "remoteBranch",
			);
			const upstream = await this.services.quickInput.pick(
				remoteBranches.map((entry) => ({
					label: entry.shortName,
					description: shortSha(entry.targetSha),
					entry,
				})),
				{
					title: `Set Upstream: ${branch.entry.shortName}`,
					placeHolder: "Choose a remote-tracking branch",
				},
			);
			if (upstream === undefined) {
				return;
			}
			await session.bridge.gitUpstreamSet(
				branch.entry.shortName,
				upstream.entry.shortName,
			);
			this.#didMutate(
				session,
				`Plain: set upstream for "${branch.entry.shortName}" to "${upstream.entry.shortName}".`,
			);
		} catch (error) {
			this.#report(error);
		}
	}
}

export interface PlainGitManagementRegistration {
	dispose(): void;
}

export function registerPlainGitManagementCommands(
	bridge: PlainBridge,
): PlainGitManagementRegistration {
	const command = (
		method: keyof Pick<
			PlainGitManagementController,
			"manageBranches" | "manageTags" | "manageRemotes" | "manageUpstream"
		>,
	) =>
		CommandsRegistry.registerCommand(
			{
				manageBranches: MANAGE_BRANCHES_COMMAND_ID,
				manageTags: MANAGE_TAGS_COMMAND_ID,
				manageRemotes: MANAGE_REMOTES_COMMAND_ID,
				manageUpstream: MANAGE_UPSTREAM_COMMAND_ID,
			}[method],
			async (accessor) => {
				const quickInput = accessor.get(IQuickInputService);
				const workspace = accessor.get(IWorkspaceContextService);
				const controller = new PlainGitManagementController(bridge, {
					quickInput: {
						pick: (items, options) =>
							quickInput.pick([...items], { ...options, canPickMany: false }),
						input: (options) => quickInput.input(options),
					},
					dialog: accessor.get(IDialogService),
					notifications: accessor.get(INotificationService),
					roots: () =>
						plainGitRootsFromWorkspaceFolders(workspace.getWorkspace().folders),
				});
				await controller[method]();
			},
		);

	const commands = [
		command("manageBranches"),
		command("manageTags"),
		command("manageRemotes"),
		command("manageUpstream"),
	];
	const menus = [
		[MANAGE_BRANCHES_COMMAND_ID, "Manage Branches"],
		[MANAGE_TAGS_COMMAND_ID, "Manage Tags"],
		[MANAGE_REMOTES_COMMAND_ID, "Manage Remotes"],
		[MANAGE_UPSTREAM_COMMAND_ID, "Manage Upstream"],
	].map(([id, title]) =>
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id: id!, title: title!, category: "Plain" },
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
