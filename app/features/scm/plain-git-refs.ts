import type {
	GitRefEntry,
	GitRefKind,
	GitRefsListResult,
} from "../../platform/tauri/contracts";

/**
 * `F090` S3 — refs sidebar pure logic (`docs/research/2026-07-26-git-history.md`'s
 * slice 4). Self-built, never consuming any vendor SCM refs/branches
 * machinery — the same "自建视图" decision `plain-git-blame.ts`'s/
 * `plain-git-history.ts`'s own doc comments record for earlier `F090`
 * slices. Every piece of logic here is a pure function over the exact
 * [`GitRefsListResult`] shape `gitRefsList` returns, so it is fully
 * unit-testable without a DOM/Workbench dependency — only
 * `plain-git-graph-view.ts` touches a live view/DOM.
 */

/** One badge a graph node can carry — built entirely client-side by
 * [`buildRefBadgesBySha`], never by parsing `git log`'s own `%d`/`%D`
 * decoration (see `src-tauri/src/git/log.rs`'s own module doc comment,
 * "This module deliberately never asks git for ref/branch/tag
 * decoration"). */
export interface GitRefBadge {
	readonly label: string;
	readonly kind: GitRefKind;
	readonly isHead: boolean;
}

export interface GroupedRefs {
	readonly branches: readonly GitRefEntry[];
	readonly remoteBranches: readonly GitRefEntry[];
	readonly tags: readonly GitRefEntry[];
}

function byShortName(a: GitRefEntry, b: GitRefEntry): number {
	return a.shortName.localeCompare(b.shortName);
}

/** Splits and sorts (by `shortName`, locale-aware) a flat [`GitRefsListResult`]
 * into the three groups a refs sidebar displays as separate sections —
 * mirrors `RefGroupKind`'s own three-way split server-side, computed here
 * rather than requested as three separate calls. */
export function groupRefsByKind(result: GitRefsListResult): GroupedRefs {
	const branches: GitRefEntry[] = [];
	const remoteBranches: GitRefEntry[] = [];
	const tags: GitRefEntry[] = [];
	for (const entry of result.entries) {
		if (entry.kind === "branch") {
			branches.push(entry);
		} else if (entry.kind === "remoteBranch") {
			remoteBranches.push(entry);
		} else {
			tags.push(entry);
		}
	}
	branches.sort(byShortName);
	remoteBranches.sort(byShortName);
	tags.sort(byShortName);
	return {
		branches: Object.freeze(branches),
		remoteBranches: Object.freeze(remoteBranches),
		tags: Object.freeze(tags),
	};
}

/**
 * Builds a `sha -> badge[]` join map for the graph view's own per-node ref
 * badges — the entire join is this one client-side map lookup by plain sha
 * equality, comparing a ref's own commit-pointing sha against a
 * [`GitGraphNode.sha`](../../platform/tauri/contracts). A lightweight tag or
 * branch/remote-tracking ref joins on its own `targetSha` (already a commit
 * id); an annotated tag joins on its `peeledSha` instead (its own
 * `targetSha` is the *tag object*, not a commit — see [`GitRefEntry`]'s own
 * doc comment) — an annotated tag missing a `peeledSha` cannot happen for a
 * well-formed response (the Rust side only ever omits it for a non-annotated
 * entry) but is skipped defensively rather than assumed.
 */
export function buildRefBadgesBySha(
	result: GitRefsListResult,
): ReadonlyMap<string, readonly GitRefBadge[]> {
	const map = new Map<string, GitRefBadge[]>();
	for (const entry of result.entries) {
		const sha = entry.isAnnotatedTag ? entry.peeledSha : entry.targetSha;
		if (sha === null) {
			continue;
		}
		const badge: GitRefBadge = {
			label: entry.shortName,
			kind: entry.kind,
			isHead: entry.isHead,
		};
		const existing = map.get(sha);
		if (existing === undefined) {
			map.set(sha, [badge]);
		} else {
			existing.push(badge);
		}
	}
	return map;
}

/** A badge's compact display text — `*` prefix for the current branch,
 * `tag:` prefix for a tag (loosely mirroring the shape git's own `%D`
 * decoration uses for human display, but computed independently from
 * structured fields, never by parsing that free-text output — see this
 * module's own doc comment). */
export function refBadgeText(badge: GitRefBadge): string {
	const prefix = badge.isHead ? "* " : "";
	if (badge.kind === "tag") {
		return `${prefix}tag: ${badge.label}`;
	}
	return `${prefix}${badge.label}`;
}
