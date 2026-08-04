/**
 * `F210` S4 step-into-target selection — mirrors `plain-debug-configuration-pick.ts`'s
 * `selectPlainLaunchConfiguration` exactly: same shape, same auto-select/
 * cancel semantics, applied to a `debugStepInTargets` response's `targets`
 * array instead of `.vscode/launch.json`'s `configurations` array. Pure
 * logic, no DOM/monaco dependency.
 *
 * `runStepIntoTarget` (`plain-debug-commands.ts`) is this module's only real
 * caller: a sole target is safe to use automatically; two or more targets
 * must go through the injected user picker (`IQuickInputService.pick`), and
 * cancelling that picker returns no target — zero further side effects (no
 * `debugStepIn` call) follow a cancelled pick. An empty target list also
 * returns no target without invoking the picker at all — the caller is
 * expected to show its own "no step-into targets are available" message in
 * that case, since there is nothing for a picker to show.
 *
 * `truncated` (from the same `debugStepInTargets` response — see
 * `DebugStepInTargetsResult`'s own doc comment) is forwarded to the picker
 * callback's own `context` argument rather than folded into the item list
 * itself, so the caller decides exactly how to surface it (this module's own
 * production caller uses it to adjust the picker's `placeHolder` text) — by
 * construction, `truncated` can only ever be `true` alongside two or more
 * targets (the hard cap this domain truncates at is well above one), so it
 * never interacts with the sole-target auto-select path above.
 */

import type { DebugStepInTarget } from "../../platform/tauri/contracts";

export interface PlainDebugStepInTargetPickItem {
	readonly label: string;
	readonly description: string;
	readonly target: DebugStepInTarget;
}

export interface PlainDebugStepInTargetPickContext {
	readonly truncated: boolean;
}

export type PlainDebugStepInTargetPicker = (
	items: readonly PlainDebugStepInTargetPickItem[],
	context: PlainDebugStepInTargetPickContext,
) => Promise<PlainDebugStepInTargetPickItem | undefined>;

/** Resolves which step-into target a `stepIn` call uses. A sole target is
 * used automatically; multiple targets must go through the injected user
 * picker and cancellation returns no target; an empty list returns no target
 * without invoking the picker. */
export async function selectPlainStepInTarget(
	targets: readonly DebugStepInTarget[],
	truncated: boolean,
	pick: PlainDebugStepInTargetPicker,
): Promise<DebugStepInTarget | undefined> {
	if (targets.length === 0) {
		return undefined;
	}
	if (targets.length === 1) {
		return targets[0];
	}
	const items = targets.map((target) =>
		Object.freeze({
			label: target.label,
			description: `#${target.id}`,
			target,
		}),
	);
	return (await pick(Object.freeze(items), Object.freeze({ truncated })))
		?.target;
}
