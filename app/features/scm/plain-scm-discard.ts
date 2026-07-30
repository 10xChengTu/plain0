/**
 * `F080` S3 discard confirmation state machine — deliberately extracted from
 * `plain-scm-view.ts` into its own DOM/service-free module, mirroring
 * `plain-terminal-trust.ts`'s own "small structural interfaces, no DOM, no
 * real Workbench service instance" testability discipline (see that file's
 * module doc comment) for this codebase's *other* confirm-before-destructive-
 * write flow. `PlainScmView.discardResources`/`discardAllWorkingTree` are the
 * only real callers: they never invoke `PlainBridge.gitDiscardPaths` without
 * first routing through `resolveDiscardConfirmation` below, which never
 * performs the bridge call itself — it only ever decides *whether* the
 * caller may.
 */

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance. */
export interface DiscardConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** How many affected paths `discardConfirmationDetail` names explicitly
 * before collapsing the rest into a "…and N more" summary line — mirrors
 * `app/features/workspace/delete-coordinator.ts`'s own `confirmationDetail`
 * precedent for the *other* irreversible-write confirmation dialog in this
 * codebase (permanent delete), which uses the same cutoff. */
const MAX_NAMED_PATHS_IN_DETAIL = 10;

export function discardConfirmationMessage(
	relativePaths: readonly string[],
): string {
	return relativePaths.length === 1
		? `Discard changes in "${relativePaths[0]}"?`
		: `Discard changes in ${relativePaths.length} files?`;
}

/** Acceptance criterion 5's "预览影响" half: names every affected path (up to
 * the cutoff) and states plainly that the action is irreversible. */
export function discardConfirmationDetail(
	relativePaths: readonly string[],
): string {
	const names = relativePaths
		.slice(0, MAX_NAMED_PATHS_IN_DETAIL)
		.map((path) => `• ${path}`)
		.join("\n");
	const remaining =
		relativePaths.length > MAX_NAMED_PATHS_IN_DETAIL
			? `\n…and ${relativePaths.length - MAX_NAMED_PATHS_IN_DETAIL} more`
			: "";
	return `${names}${remaining}\n\nThis cannot be undone. Each file's working-tree changes will be replaced with its last staged (or committed) content.`;
}

export const DISCARD_CONFIRM_PRIMARY_BUTTON = "Discard Changes";

/** The three outcomes `resolveDiscardConfirmation` can reach: `"no-op"` for
 * an empty path list (nothing to confirm, the dialog is never shown at all —
 * distinct from `"declined"`, which means a dialog *was* shown and the user
 * dismissed it), `"confirmed"`, and `"declined"`. Callers must only proceed
 * to `PlainBridge.gitDiscardPaths` on `"confirmed"`. */
export type DiscardDecision =
	| Readonly<{ kind: "no-op" }>
	| Readonly<{ kind: "confirmed" }>
	| Readonly<{ kind: "declined" }>;

/** Never calls `gitDiscardPaths` itself — this function's entire job is
 * deciding whether the caller may. For a non-empty `relativePaths`, always
 * shows the dialog (acceptance criterion 5: a destructive action must always
 * preview its impact and require confirmation — there is no "skip the
 * dialog" branch here). */
export async function resolveDiscardConfirmation(
	dialogService: DiscardConfirmDialogService,
	relativePaths: readonly string[],
): Promise<DiscardDecision> {
	if (relativePaths.length === 0) {
		return Object.freeze({ kind: "no-op" });
	}
	const confirmation = await dialogService.confirm({
		message: discardConfirmationMessage(relativePaths),
		detail: discardConfirmationDetail(relativePaths),
		primaryButton: DISCARD_CONFIRM_PRIMARY_BUTTON,
	});
	return Object.freeze({
		kind: confirmation.confirmed ? "confirmed" : "declined",
	});
}
