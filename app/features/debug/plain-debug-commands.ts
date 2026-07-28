import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";

import type { DebugAdapterTarget } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import {
	parseLaunchConfigurations,
	type AdapterDescriptor,
} from "./plain-debug-adapter-config";
import { prepareDebugAdapterLaunch } from "./plain-debug-adapter-launch";
import { getPlainDebugRuntime } from "./plain-debug-runtime";
import { resolveDebugTrust } from "./plain-debug-trust";

/** Plain's own commands — never a vendor `workbench.action.debug.*` id
 * takeover (there is no such id registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-debug-service-override` is never imported — see
 * `debug-contribution.ts`'s own module doc comment). */
export const START_DEBUGGING_COMMAND_ID = "plain.debug.start";
export const STOP_DEBUGGING_COMMAND_ID = "plain.debug.stop";

const LAUNCH_CONFIG_PATH = ".vscode/launch.json";
const ADAPTER_REGISTRY_PATH = ".plain/debug-adapters.json";

function toDebugAdapterTarget(
	descriptor: AdapterDescriptor,
): DebugAdapterTarget | undefined {
	if (descriptor.transport === "tcp") {
		if (descriptor.host === undefined || descriptor.port === undefined) {
			// Never actually reachable — `plain-debug-adapter-config.ts`'s own
			// parser guarantees `host`/`port` are present exactly when
			// `transport === "tcp"` (see `AdapterDescriptor`'s own doc
			// comment) — kept as a defensive `undefined` return, not a thrown
			// exception, so a future change to that invariant fails this
			// command visibly (a notification) rather than crashing the
			// Workbench.
			return undefined;
		}
		return {
			transport: "tcp",
			command: descriptor.command,
			args: descriptor.args,
			host: descriptor.host,
			port: descriptor.port,
		};
	}
	return {
		transport: "stdio",
		command: descriptor.command,
		args: descriptor.args,
	};
}

/**
 * `F100` S3's "Plain: Start Debugging" command — the first real UI entry
 * point into `prepareDebugAdapterLaunch` (`F100` S1) and
 * `DebugSessionController.start` (this slice). Reads `.vscode/launch.json`
 * (required) and `.plain/debug-adapters.json` (optional — a missing file is
 * `ENTRY_NOT_FOUND`, treated identically to `prepareDebugAdapterLaunch`'s own
 * "no registry" `null` case), then hands both off to the same confirmation-
 * gated preparation pipeline S1 already built and this slice finally gives a
 * real caller.
 *
 * Scope note (disclosed, not an oversight): always runs the *first*
 * configuration in `launch.json`'s `configurations` array — a real
 * `IQuickPickService` picker for "which configuration" when there is more
 * than one is not built in this slice. This feature's own acceptance
 * criteria are about breakpoints/call-stack/variables/watch, not the launch-
 * configuration-selection UX; `prepareDebugAdapterLaunch` itself already
 * looks up *by name*, so adding a picker later is a small, additive change
 * to this one function, not a redesign.
 *
 * Resolves workspace execution trust (`resolveDebugTrust`) before ever
 * reading a configuration file or resolving an adapter — without this, a
 * `debug_launch`/`debug_attach` call against an untrusted workspace would
 * simply throw `WORKSPACE_NOT_TRUSTED` with no way for the user to grant
 * trust from this flow at all (the same gate `resolveTerminalTrust` already
 * gives `PlainTerminalView.startSession`, mirrored here with debug-flavored
 * dialog copy — see `plain-debug-trust.ts`'s own module doc comment).
 */
async function runStartDebugging(
	dialogService: IDialogService,
	notificationService: INotificationService,
	workspaceContextService: IWorkspaceContextService,
): Promise<void> {
	const runtime = getPlainDebugRuntime();
	if (runtime === undefined) {
		return;
	}
	const bridge = runtime.bridge;
	const rootUri = workspaceContextService.getWorkspace().folders[0]?.uri;
	const trustDecision = await resolveDebugTrust(
		bridge,
		dialogService,
		rootUri === undefined,
	);
	if (
		trustDecision.kind === "empty-workspace" ||
		trustDecision.kind === "declined" ||
		rootUri === undefined
	) {
		return;
	}
	const rootId = rootUri.authority;

	let launchBytes: Uint8Array;
	try {
		const launchFile = await bridge.workspaceReadFile(
			rootId,
			LAUNCH_CONFIG_PATH,
		);
		launchBytes = launchFile.value.copy();
	} catch {
		notificationService.error(
			`Plain: no ${LAUNCH_CONFIG_PATH} found in this workspace.`,
		);
		return;
	}
	const parsedLaunch = parseLaunchConfigurations(launchBytes);
	if (parsedLaunch.kind === "error") {
		notificationService.error(
			`Plain: ${LAUNCH_CONFIG_PATH} is invalid: ${parsedLaunch.reason}`,
		);
		return;
	}
	const configuration = parsedLaunch.value[0];
	if (configuration === undefined) {
		notificationService.error(
			`Plain: ${LAUNCH_CONFIG_PATH} has no configurations.`,
		);
		return;
	}

	let registryBytes: Uint8Array | null;
	try {
		const registryFile = await bridge.workspaceReadFile(
			rootId,
			ADAPTER_REGISTRY_PATH,
		);
		registryBytes = registryFile.value.copy();
	} catch (error) {
		if (normalizeCommandError(error).code === "ENTRY_NOT_FOUND") {
			registryBytes = null;
		} else {
			notificationService.error(normalizeCommandError(error).message);
			return;
		}
	}

	const preparation = await prepareDebugAdapterLaunch(
		bridge,
		dialogService,
		registryBytes,
		launchBytes,
		configuration.name,
	);
	if (preparation.kind === "declined") {
		return;
	}
	if (preparation.kind === "adapter-not-found") {
		notificationService.error(
			`Plain: no adapter registered for type "${preparation.type}".`,
		);
		return;
	}
	if (preparation.kind === "configuration-not-found") {
		notificationService.error(
			`Plain: launch configuration "${preparation.name}" not found.`,
		);
		return;
	}
	if (
		preparation.kind === "invalid-registry" ||
		preparation.kind === "invalid-launch-configuration"
	) {
		notificationService.error(`Plain: ${preparation.reason}`);
		return;
	}

	const target = toDebugAdapterTarget(preparation.descriptor);
	if (target === undefined) {
		notificationService.error(
			"Plain: the resolved adapter descriptor is malformed.",
		);
		return;
	}
	const kind: "launch" | "attach" =
		configuration.request === "attach" ? "attach" : "launch";
	try {
		await runtime.session.start(
			kind,
			target,
			configuration.type,
			preparation.launchArguments,
		);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

async function runStopDebugging(
	notificationService: INotificationService,
): Promise<void> {
	const runtime = getPlainDebugRuntime();
	if (runtime === undefined || runtime.session.state === null) {
		return;
	}
	try {
		await runtime.session.disconnect();
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
	}
}

export function registerPlainDebugCommands(): { dispose(): void } {
	const disposables = [
		CommandsRegistry.registerCommand(START_DEBUGGING_COMMAND_ID, (accessor) => {
			void runStartDebugging(
				accessor.get(IDialogService),
				accessor.get(INotificationService),
				accessor.get(IWorkspaceContextService),
			);
		}),
		CommandsRegistry.registerCommand(STOP_DEBUGGING_COMMAND_ID, (accessor) => {
			void runStopDebugging(accessor.get(INotificationService));
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: START_DEBUGGING_COMMAND_ID,
				title: "Start Debugging",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: STOP_DEBUGGING_COMMAND_ID,
				title: "Stop Debugging",
				category: "Plain",
			},
		}),
	];
	return {
		dispose() {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		},
	};
}
