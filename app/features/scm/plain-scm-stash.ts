/**
 * `F090` S4 stash pop/drop confirmation state machine — deliberately
 * extracted into its own DOM/service-free module, mirroring
 * `plain-scm-discard.ts`'s/`plain-scm-network.ts`'s own "small structural
 * interfaces, no DOM, no real Workbench service instance" testability
 * discipline (see those files' own module doc comments) for this codebase's
 * *third* confirm-before-write flow. `PlainGitStashView`'s `popEntry`/
 * `dropEntry` methods are the only real callers: neither ever invokes
 * `PlainBridge.gitStashPop`/`gitStashDrop` without first routing through
 * `resolveStashConfirmation` below, which never performs the bridge call
 * itself — it only ever decides *whether* the caller may.
 *
 * Only `pop`/`drop` need this gate — per this feature's own frozen plan
 * (`docs/research/2026-07-26-git-history.md`'s slice 5 command table),
 * `push`/`apply` are lower-severity (a push never loses data; a conflicting
 * apply never removes the stash entry either) and get a plain inline notice
 * in `PlainGitStashView`'s own static UI copy instead of a blocking
 * confirmation dialog — there is deliberately no `"push"`/`"apply"` variant
 * of `StashConfirmationKind` here. `"pop"` and `"drop"` are each still a
 * real, always-meaningful action on one specific, already-identified stash
 * entry (never a "maybe zero entries" batch the way `plain-scm-discard.ts`'s
 * path list can be) — closer to `plain-scm-network.ts`'s own "no no-op case,
 * always show the dialog" shape than to `plain-scm-discard.ts`'s three-way
 * split.
 */

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance. */
export interface StashConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** Which stash write is being confirmed. */
export type StashConfirmationKind = "pop" | "drop";

export interface StashConfirmationRequest {
	readonly kind: StashConfirmationKind;
	/** A short, already-formatted display label for the specific entry being
	 * acted on (e.g. `"#0 — On main: fix login bug"`) — computed by the
	 * caller from its own `GitStashEntry`, kept as an opaque string here so
	 * this module never needs to know that shape itself. */
	readonly entryLabel: string;
}

export function stashConfirmationMessage(
	request: StashConfirmationRequest,
): string {
	switch (request.kind) {
		case "pop": {
			return `Pop stash ${request.entryLabel}?`;
		}
		case "drop": {
			return `Drop stash ${request.entryLabel}?`;
		}
	}
}

/** Acceptance criterion 5's "预览影响" half: `pop`'s detail names the
 * conflict-retains-the-entry escape hatch (mirroring `git stash pop`'s own
 * documented behavior); `drop`'s states plainly that the action is
 * irreversible, at the same rigor `discardConfirmationDetail`/
 * `networkConfirmationDetail` already use for this codebase's other two
 * irreversible-write confirmations. */
export function stashConfirmationDetail(
	request: StashConfirmationRequest,
): string {
	switch (request.kind) {
		case "pop": {
			return "Applying this stash will remove it from the list. If a conflict occurs, the stash entry is kept so you can resolve it manually.";
		}
		case "drop": {
			return "This permanently discards the stash entry and the changes it holds. This cannot be undone.";
		}
	}
}

export const STASH_CONFIRM_PRIMARY_BUTTON: Readonly<
	Record<StashConfirmationKind, string>
> = Object.freeze({
	pop: "Pop Stash",
	drop: "Drop Stash",
});

/** The two outcomes `resolveStashConfirmation` can reach — no `"no-op"` case
 * (mirrors `NetworkConfirmDecision`'s identical two-way split, not
 * `DiscardDecision`'s three-way one): a pop/drop always targets one specific,
 * already-identified entry, never an empty-list shortcut. Callers must only
 * proceed to `PlainBridge.gitStashPop`/`gitStashDrop` on `"confirmed"`. */
export type StashConfirmDecision =
	Readonly<{ kind: "confirmed" }> | Readonly<{ kind: "declined" }>;

/** Never calls `gitStashPop`/`gitStashDrop` itself — this function's entire
 * job is deciding whether the caller may. Always shows the dialog (there is
 * no "skip the dialog" branch here, for either `kind`). */
export async function resolveStashConfirmation(
	dialogService: StashConfirmDialogService,
	request: StashConfirmationRequest,
): Promise<StashConfirmDecision> {
	const confirmation = await dialogService.confirm({
		message: stashConfirmationMessage(request),
		detail: stashConfirmationDetail(request),
		primaryButton: STASH_CONFIRM_PRIMARY_BUTTON[request.kind],
	});
	return Object.freeze({
		kind: confirmation.confirmed ? "confirmed" : "declined",
	});
}
