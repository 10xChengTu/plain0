/**
 * `F090` S5 worktree-remove confirmation state machine — deliberately
 * extracted into its own DOM/service-free module, mirroring
 * `plain-scm-discard.ts`'s/`plain-scm-network.ts`'s/`plain-scm-stash.ts`'s own
 * "small structural interfaces, no DOM, no real Workbench service instance"
 * testability discipline (see those files' own module doc comments) for this
 * codebase's *fourth* confirm-before-write flow. `PlainGitWorktreeView.removeEntry`
 * is the only real caller: it never invokes `PlainBridge.gitWorktreeRemove`
 * with `force: true` without first routing through
 * `resolveWorktreeConfirmation` below, which never performs the bridge call
 * itself — it only ever decides *whether* the caller may.
 *
 * Unlike `plain-scm-stash.ts`'s two kinds (`"pop"`/`"drop"`, each gating a
 * bridge call the caller decides to make *before* ever calling the bridge),
 * this module gates only the *second*, forced retry of a two-phase flow —
 * per this feature's own frozen plan (`docs/research/2026-07-26-git-history.md`'s
 * slice 6 command table): `PlainGitWorktreeView.removeEntry` always calls
 * `gitWorktreeRemove(path, false)` first, entirely unconfirmed (a clean
 * worktree is removed immediately, nothing is lost); only when that first,
 * unforced call reports back `"needsForce"` (the worktree has
 * modified/untracked content) does this module's own
 * `resolveWorktreeConfirmation` ever get consulted, gating the *second*
 * `gitWorktreeRemove(path, true)` call. There is deliberately only one
 * `WorktreeConfirmationKind` (`"removeDirty"`) — `worktree add` is this
 * feature's own "低风险,不强确认" half (see `plain-git-worktree-view.ts`'s own
 * module doc comment) and never routes through this module at all.
 */

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance. */
export interface WorktreeConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** Which worktree write is being confirmed — see this module's own module
 * doc comment for why there is only ever one kind. */
export type WorktreeConfirmationKind = "removeDirty";

export interface WorktreeConfirmationRequest {
	readonly kind: WorktreeConfirmationKind;
	/** A short, already-formatted display label for the specific worktree
	 * being acted on (e.g. its own filesystem path) — computed by the caller
	 * from its own `GitWorktreeEntry`, kept as an opaque string here so this
	 * module never needs to know that shape itself. */
	readonly worktreeLabel: string;
}

export function worktreeConfirmationMessage(
	request: WorktreeConfirmationRequest,
): string {
	switch (request.kind) {
		case "removeDirty": {
			return `Force remove worktree at "${request.worktreeLabel}"?`;
		}
	}
}

/** Acceptance criterion 5's "预览影响" half: the first, unforced
 * `gitWorktreeRemove` call is itself the "preview" (a clean worktree is
 * already gone by the time this dialog could ever show) — this detail states
 * plainly what a *forced* removal specifically discards. */
export function worktreeConfirmationDetail(
	request: WorktreeConfirmationRequest,
): string {
	switch (request.kind) {
		case "removeDirty": {
			return "This worktree has modified or untracked files. Force-removing it permanently discards those changes. This cannot be undone.";
		}
	}
}

export const WORKTREE_CONFIRM_PRIMARY_BUTTON: Readonly<
	Record<WorktreeConfirmationKind, string>
> = Object.freeze({
	removeDirty: "Force Remove",
});

/** The two outcomes `resolveWorktreeConfirmation` can reach — mirrors
 * `StashConfirmDecision`'s/`NetworkConfirmDecision`'s identical two-way split:
 * this module is only ever consulted once the caller already knows a real,
 * meaningful forced retry is on the table (the `"needsForce"` outcome), never
 * for an empty-list or already-resolved shortcut. Callers must only proceed
 * to `PlainBridge.gitWorktreeRemove(path, true)` on `"confirmed"`. */
export type WorktreeConfirmDecision =
	Readonly<{ kind: "confirmed" }> | Readonly<{ kind: "declined" }>;

/** Never calls `gitWorktreeRemove` itself — this function's entire job is
 * deciding whether the caller may. Always shows the dialog (there is no
 * "skip the dialog" branch here). */
export async function resolveWorktreeConfirmation(
	dialogService: WorktreeConfirmDialogService,
	request: WorktreeConfirmationRequest,
): Promise<WorktreeConfirmDecision> {
	const confirmation = await dialogService.confirm({
		message: worktreeConfirmationMessage(request),
		detail: worktreeConfirmationDetail(request),
		primaryButton: WORKTREE_CONFIRM_PRIMARY_BUTTON[request.kind],
	});
	return Object.freeze({
		kind: confirmation.confirmed ? "confirmed" : "declined",
	});
}
