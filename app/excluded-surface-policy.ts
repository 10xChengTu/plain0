export const EXCLUDED_SURFACE_GUARD_MARKER =
	"PLAIN_EXCLUDED_SURFACE_GUARD_V1" as const;

export interface WorkbenchSurfaceSnapshot {
	commandIds: string[];
	viewContainerIds: string[];
	viewIds: string[];
	/**
	 * Ids registered via `registerWorkbenchContribution2` (`F080` S0's
	 * excluded-surface depth hardening, `docs/research/2026-07-25-core-git.md`
	 * decision 2) — captured so a contribution like the upstream SCM
	 * override's `SCMHistoryItemContextContribution` becomes auditable in
	 * this snapshot the moment that override is ever introduced, rather
	 * than being invisible to every check below. See
	 * `app/excluded-surfaces.ts`'s `captureContributionIds` for exactly
	 * what this can and cannot observe.
	 *
	 * Unlike `commandIds`/`viewContainerIds`/`viewIds`, this dimension is
	 * checked against a **narrower** subset of the categories below — see
	 * `ExcludedIdPattern.appliesToContributions` in
	 * `excluded-surface-policy.ts` for the full evidence and reasoning. In
	 * short: this is an internal contribution-registration namespace, not
	 * the user-facing command/view surface the full six-category policy was
	 * designed for, and applying all six here broke app bootstrap outright
	 * on real, currently-registered ids (`workbench.contrib.*ExtensionPoint`,
	 * `workbench.contrib.viewsExtensionHandler`,
	 * `workbench.contrib.recentRemoteFolderPruner`) that are legitimate lazy
	 * static contribution registrars, not extensions/marketplace or remote
	 * surfaces.
	 */
	contributionIds: string[];
}

export interface ExcludedWorkbenchSurface {
	kind: keyof WorkbenchSurfaceSnapshot;
	id: string;
	category: string;
}

declare global {
	interface Window {
		__PLAIN_WORKBENCH_SURFACES__?: Readonly<WorkbenchSurfaceSnapshot>;
	}
}

interface ExcludedIdPattern {
	category: string;
	pattern: RegExp;
	/**
	 * Whether this category is checked against the `contributionIds`
	 * snapshot dimension. `commandIds`/`viewContainerIds`/`viewIds` always
	 * check every category below regardless of this flag — it only narrows
	 * `contributionIds`.
	 *
	 * `contributionIds` (`registerWorkbenchContribution2` ids) is an
	 * *internal pipeline* namespace, not the user-visible command/view
	 * surface these six categories were designed against. Real, currently
	 * registered ids in this exact dependency tree
	 * (`@codingame/monaco-vscode-api@35.0.1` + this app's actual
	 * `package.json` overrides, confirmed by reading the installed
	 * `node_modules` sources and by the `contributionIds`-dimension entries
	 * in `test-results/foundation-boots-the-allow-092cb-t-excluded-runtime-surfaces/error-context.md`,
	 * a real captured bootstrap failure, not a hypothetical) proved three of
	 * the six categories misclassify legitimate lazy static contribution
	 * registrars — exactly the mechanism `AGENTS.md` allows — as violations:
	 *
	 * - `workbench.contrib.colorExtensionPoint`,
	 *   `.iconExtensionPoint`, `.jsonValidationExtensionPoint`,
	 *   `.statusBarItemsExtensionPoint`, `.tokenClassificationExtensionPoint`,
	 *   `.viewsExtensionHandler` — every one of these is an *extension
	 *   point* registrar (`workbench/api/**`, `workbench/services/themes/**`),
	 *   i.e. the plumbing the theme system and status bar API themselves
	 *   run on. None reach the extension marketplace/gallery this app
	 *   excludes; the "extensions, gallery or marketplace" pattern's
	 *   `extension(?:Host|Gallery|Management|Bisect|s)?` alternative matches
	 *   the bare word "Extension" in `*ExtensionPoint`/`*ExtensionHandler`,
	 *   which was never the intent.
	 * - `workbench.contrib.recentRemoteFolderPruner` (from
	 *   `monaco-vscode-configuration-service-override`, a direct
	 *   dependency) prunes the *recently opened* workspaces MRU list of
	 *   stale remote-folder entries — configuration housekeeping, not the
	 *   Remote Development/tunnels feature surface "remote development or
	 *   tunnels" targets.
	 *
	 * All three were real (not synthetic) ids captured from an actual
	 * bootstrap, and all three broke app startup outright — see
	 * `docs/research/2026-07-25-core-git.md` decision 2's "收窄记录"
	 * paragraph. "notebooks, tasks or testing" is excluded here on the same
	 * reasoning (no notebook/tasks/testing override package is even a
	 * dependency of this app, but its keywords — `notebook`, `testing` —
	 * are exactly as likely to collide with an internal contribution name
	 * as `extension` or `remote` did, and this app's contributionIds
	 * namespace has zero evidence such a collision would ever be caught in
	 * time rather than break bootstrap first).
	 *
	 * `authentication or accounts` and `settings sync or edit sessions` are
	 * kept enabled for `contributionIds`: this app has **no**
	 * authentication-service-override or user-data-sync-service-override
	 * package in its dependency tree at all (checked directly against
	 * `package.json` and the installed `node_modules/.pnpm` tree), so there
	 * is no lazy-registry contribution analogous to `*ExtensionPoint` in
	 * this namespace for either category — nothing currently registered
	 * could false-positive. Keeping them active preserves this dimension's
	 * actual purpose (catching an AI-adjacent auth/sync contribution with
	 * no chat/agent/copilot spelling, e.g. a hypothetical "sign in to
	 * Copilot" pipeline) at zero currently-known cost. Re-verify this
	 * absence whenever `package.json` adds either override package.
	 */
	appliesToContributions: boolean;
}

const excludedIdPatterns: ReadonlyArray<ExcludedIdPattern> = [
	{
		category: "AI, Chat, Agent or MCP",
		// Beyond the obvious chat/agent/copilot/mcp/language-model spelling,
		// this also catches the specific "AI commit message" and "AI merge
		// conflict resolution" surfaces `docs/product-scope.md`'s "明确不做"
		// list names explicitly — real command/contribution ids that name
		// no chat/agent/copilot/mcp keyword at all (e.g. a
		// `generateCommitMessage` command), per the gap
		// `docs/research/2026-07-25-core-git.md` decision 2 recorded. Each
		// added alternative is deliberately narrow (a specific AI-tied
		// action, not a bare "ai" substring) precisely so it never
		// misclassifies an ordinary, non-AI git/SCM id — `git.commit`,
		// `git.enableSmartCommit` and `workbench.scm.*` all still pass
		// through unmatched (see `tests/unit/excluded-surfaces.test.ts`).
		// This is the one category the `contributionIds` dimension exists
		// for in the first place (see `appliesToContributions` doc above
		// and decision 2): it is what would catch the upstream SCM
		// override's `SCMHistoryItemContextContribution`-style id once it
		// carries a `chat`-spelled name, e.g. the real upstream
		// `workbench.contrib.chat.scmHistoryItemContextContribution`.
		pattern:
			/chat|agent|copilot|mcp|language.?models?|aiSettings|aiRelated|embeddings?|generate.?CommitMessage|CommitMessage.?Generat(?:e|ion|or)|resolve.?Conflict.?With.?Ai|conflict.?Resolution.?With.?Ai|Ai.?Resolve.?Conflict/i,
		appliesToContributions: true,
	},
	{
		category: "authentication or accounts",
		pattern:
			/authentication|authSession|accounts?|signIn|signOut|logIn|logOut/i,
		appliesToContributions: true,
	},
	{
		category: "settings sync or edit sessions",
		pattern: /userDataSync|settingsSync|syncAccount|editSessions?/i,
		appliesToContributions: true,
	},
	{
		category: "extensions, gallery or marketplace",
		pattern:
			/extension(?:Host|Gallery|Management|Bisect|s)?|gallery|marketplace/i,
		appliesToContributions: false,
	},
	{
		category: "remote development or tunnels",
		pattern: /remote|tunnel/i,
		appliesToContributions: false,
	},
	{
		category: "notebooks, tasks or testing",
		pattern:
			/notebook|interactiveWindow|workbench\.action\.tasks?|testExplorer|testing/i,
		appliesToContributions: false,
	},
];

/** Exact, kind-scoped semantic collisions with the deliberately broad deny
 * spellings above. `plain.git.manageRemotes` manages ordinary Git remotes in
 * the currently opened local repository; it cannot open a remote workspace,
 * start a tunnel, or reach any Remote Development service. Its command id is
 * locked independently by the F180 Git-management architecture contract.
 * Close spellings and the same id in a view/container remain denied.
 *
 * `F220` S1's own three `plain.remote.*` commands
 * (`docs/decisions/0006-ssh-remote-workspace-trust.md`/
 * `docs/decisions/0007-remote-workspace-capability.md`) are the second
 * deliberate exception, for the identical reason: this pattern exists to
 * keep upstream `@codingame/monaco-vscode-api`'s own dead Remote Development
 * extension-host machinery (SSH/WSL/Containers via a *remote* Extension
 * Host process) unreachable — see either ADR's own background section for
 * "上游…Remote Development 死代码…不是本能力的任何部分,前端继续保持其不可达".
 * `plain.remote.connect`/`plain.remote.disconnect`/`plain.remote.forgetHostKey`
 * are a wholly separate, from-scratch Rust implementation
 * (`src-tauri/src/remote/`, a pure-Rust `russh` SSH client the WebView never
 * touches directly) that never imports, activates, or routes through any of
 * that excluded machinery — confirmed by `validateRemoteSshLibraryOwnershipBoundary`
 * (`scripts/plain/boundary-contracts.mjs`), which locks `russh` itself to
 * that one Rust module tree. These three ids are locked independently by
 * `validateRemoteCommandRegistration`'s own closed Rust-side command set.
 *
 * `F220` S3 adds `plain.remote.openFolder`/`plain.remote.refreshFolder` —
 * the remote *workspace filesystem* commands (SFTP-backed, over the same
 * from-scratch `remote::` session) for the identical reason: they open a
 * `plain-workspace://` root backed by `remote::remote_fs`, never any
 * upstream Remote Development extension-host path. */
const allowedExcludedIdCollisions: Readonly<
	Partial<Record<keyof WorkbenchSurfaceSnapshot, ReadonlySet<string>>>
> = Object.freeze({
	commandIds: new Set([
		"plain.git.manageRemotes",
		"plain.remote.connect",
		"plain.remote.disconnect",
		"plain.remote.forgetHostKey",
		"plain.remote.openFolder",
		"plain.remote.refreshFolder",
	]),
});

function matchExcludedId(
	id: string,
	kind: keyof WorkbenchSurfaceSnapshot,
): string | undefined {
	if (allowedExcludedIdCollisions[kind]?.has(id) === true) {
		return undefined;
	}
	return excludedIdPatterns.find(
		({ pattern, appliesToContributions }) =>
			(kind !== "contributionIds" || appliesToContributions) &&
			pattern.test(id),
	)?.category;
}

export function findExcludedWorkbenchSurfaces(
	snapshot: WorkbenchSurfaceSnapshot,
): ExcludedWorkbenchSurface[] {
	const violations: ExcludedWorkbenchSurface[] = [];
	for (const kind of [
		"commandIds",
		"viewContainerIds",
		"viewIds",
		"contributionIds",
	] as const) {
		for (const id of snapshot[kind]) {
			const category = matchExcludedId(id, kind);
			if (category !== undefined) {
				violations.push({ kind, id, category });
			}
		}
	}
	return violations.sort((left, right) =>
		`${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
	);
}
