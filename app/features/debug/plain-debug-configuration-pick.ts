/**
 * `F210` S1 launch-configuration selection — mirrors `plain-debug-root.ts`'s
 * `selectPlainDebugRoot` exactly: same shape, same auto-select/cancel
 * semantics, applied to `.vscode/launch.json`'s `configurations` array
 * instead of workspace roots. Pure logic, no DOM/monaco dependency (this
 * module needs no `URI` type at all, unlike `plain-debug-root.ts`'s sibling
 * `plainDebugSourceForResource`, so none is imported here).
 *
 * `runStartDebugging` (`plain-debug-commands.ts`) is this module's only real
 * caller: a sole configuration is safe to use automatically (the previous,
 * now-superseded behavior of always running `configurations[0]` happened to
 * coincide with this for the single-configuration case); two or more
 * configurations must go through the injected user picker
 * (`IQuickInputService.pick`), and cancelling that picker returns no
 * configuration — zero registry reads, zero confirmation dialogs, zero
 * `debug_launch`/`debug_attach` calls follow a cancelled pick. The resolved
 * configuration's `name` is handed to the existing, unmodified
 * `prepareDebugAdapterLaunch` (`plain-debug-adapter-launch.ts`), which already
 * looks up a configuration *by name* — this module only decides which name.
 *
 * Pick items show `name`/`type` only, never an absolute path or any other
 * launch-configuration field — the same "no path disclosure" contract
 * `PlainDebugRootPickItem`'s `description` upholds for `.vscode/launch.json`
 * itself.
 */

import type { LaunchConfiguration } from "./plain-debug-adapter-config";

export interface PlainDebugConfigurationPickItem {
	readonly label: string;
	readonly description: string;
	readonly configuration: LaunchConfiguration;
}

export type PlainDebugConfigurationPicker = (
	items: readonly PlainDebugConfigurationPickItem[],
) => Promise<PlainDebugConfigurationPickItem | undefined>;

/** Resolves which `.vscode/launch.json` configuration a new debug session
 * uses. A sole configuration is safe to use automatically; multiple
 * configurations must go through the injected user picker and cancellation
 * returns no configuration. */
export async function selectPlainLaunchConfiguration(
	configurations: readonly LaunchConfiguration[],
	pick: PlainDebugConfigurationPicker,
): Promise<LaunchConfiguration | undefined> {
	if (configurations.length === 0) {
		return undefined;
	}
	if (configurations.length === 1) {
		return configurations[0];
	}
	const items = configurations.map((configuration) =>
		Object.freeze({
			label: configuration.name,
			description: configuration.type,
			configuration,
		}),
	);
	return (await pick(Object.freeze(items)))?.configuration;
}
