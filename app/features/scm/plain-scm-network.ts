/**
 * `F080` S4 fetch/pull/push confirmation state machine — deliberately
 * extracted into its own DOM/service-free module, mirroring
 * `plain-scm-discard.ts`'s own "small structural interfaces, no DOM, no real
 * Workbench service instance" testability discipline (see that file's module
 * doc comment) for this codebase's *other* confirm-before-network-write flow.
 * `PlainScmView`'s fetch/pull/push methods are the only real callers: none of
 * them ever invoke `PlainBridge.gitFetch`/`gitPull`/`gitPush` without first
 * calling `PlainBridge.gitNetworkPreview` and then routing its result through
 * `resolveNetworkConfirmation` below, which never performs a bridge call
 * itself — it only ever decides *whether* the caller may (ADR 0003 /
 * acceptance criterion 5: "fetch/pull/push 和所有破坏性动作在显示目标/影响后
 * 确认。不得提供通用命令或 fail-open 回退。").
 *
 * `"forcePush"` is a distinct `NetworkConfirmationKind`, not a boolean flag
 * on `"push"` — it gets its own message/detail/button wording (a plain push
 * never says "cannot be undone"; a force push always does), satisfying the
 * "force push 必须单独、显式确认" requirement structurally: there is no shared
 * code path where a force push could accidentally reuse the plain push
 * dialog's milder copy.
 */

/** Structural subset of `IDialogService` this module needs — narrow enough
 * that a plain fake object satisfies it in a unit test without a DOM or a
 * real Workbench service instance. */
export interface NetworkConfirmDialogService {
	confirm(options: {
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}): Promise<{ readonly confirmed: boolean }>;
}

/** Which network operation a confirmation is being shown for. */
export type NetworkConfirmationKind = "fetch" | "pull" | "push" | "forcePush";

/** Structural subset of `GitNetworkPreviewResult` this module needs. */
export interface NetworkConfirmationPreview {
	readonly upstream: string | null;
	readonly ahead: number | null;
	readonly behind: number | null;
}

export interface NetworkConfirmationRequest {
	readonly kind: NetworkConfirmationKind;
	readonly preview: NetworkConfirmationPreview;
}

function describeUpstream(upstream: string | null): string {
	return upstream ?? "the configured remote";
}

export function networkConfirmationMessage(
	request: NetworkConfirmationRequest,
): string {
	const upstream = describeUpstream(request.preview.upstream);
	switch (request.kind) {
		case "fetch": {
			return `Fetch from ${upstream}?`;
		}
		case "pull": {
			return `Pull from ${upstream}?`;
		}
		case "push": {
			return `Push to ${upstream}?`;
		}
		case "forcePush": {
			return `Force push to ${upstream}?`;
		}
	}
}

/** Acceptance criterion 5's "预览影响" half: states the ahead/behind counts
 * (or that none are available yet) and, for a force push, spells out plainly
 * that the action rewrites the remote branch and cannot be undone. */
export function networkConfirmationDetail(
	request: NetworkConfirmationRequest,
): string {
	const { ahead, behind } = request.preview;
	const counts =
		ahead === null || behind === null
			? "No upstream tracking information is available yet."
			: `${ahead} commit(s) ahead, ${behind} commit(s) behind.`;
	if (request.kind !== "forcePush") {
		return counts;
	}
	return `${counts}\n\nThis force-pushes with --force-with-lease, overwriting the remote branch with your local history. This can discard commits other people pushed and cannot be undone.`;
}

export const NETWORK_CONFIRM_PRIMARY_BUTTON: Readonly<
	Record<NetworkConfirmationKind, string>
> = Object.freeze({
	fetch: "Fetch",
	pull: "Pull",
	push: "Push",
	forcePush: "Force Push",
});

/** The two outcomes `resolveNetworkConfirmation` can reach — unlike
 * `resolveDiscardConfirmation`'s three-way split, there is no `"no-op"` case
 * here: a fetch/pull/push/force-push is always a real, meaningful action to
 * confirm (never an empty-list shortcut the way discarding zero paths is),
 * so the dialog is always shown. Callers must only proceed to
 * `PlainBridge.gitFetch`/`gitPull`/`gitPush` on `"confirmed"`. */
export type NetworkConfirmDecision =
	Readonly<{ kind: "confirmed" }> | Readonly<{ kind: "declined" }>;

/** Never calls `gitFetch`/`gitPull`/`gitPush` itself — this function's
 * entire job is deciding whether the caller may. Always shows the dialog
 * (acceptance criterion 5: a destructive/network action must always preview
 * its impact and require confirmation — there is no "skip the dialog"
 * branch here, for any `kind`). */
export async function resolveNetworkConfirmation(
	dialogService: NetworkConfirmDialogService,
	request: NetworkConfirmationRequest,
): Promise<NetworkConfirmDecision> {
	const confirmation = await dialogService.confirm({
		message: networkConfirmationMessage(request),
		detail: networkConfirmationDetail(request),
		primaryButton: NETWORK_CONFIRM_PRIMARY_BUTTON[request.kind],
	});
	return Object.freeze({
		kind: confirmation.confirmed ? "confirmed" : "declined",
	});
}
