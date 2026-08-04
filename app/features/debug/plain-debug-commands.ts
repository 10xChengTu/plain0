import {
	MenuId,
	MenuRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import { IQuickInputService } from "@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";
import { IViewsService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service";

import type { DebugAdapterTarget } from "../../platform/tauri/contracts";
import { normalizeCommandError } from "../../platform/tauri/errors";
import { plainWorkspaceRootsFromFolders } from "../workspace/plain-workspace-roots";
import {
	parseLaunchConfigurations,
	type AdapterDescriptor,
} from "./plain-debug-adapter-config";
import { prepareDebugAdapterLaunch } from "./plain-debug-adapter-launch";
import { selectPlainLaunchConfiguration } from "./plain-debug-configuration-pick";
import { DEBUG_CONSOLE_VIEW_ID } from "./debug-contribution";
import { getPlainDebugRuntime } from "./plain-debug-runtime";
import { selectPlainDebugRoot } from "./plain-debug-root";
import { selectPlainStepInTarget } from "./plain-debug-step-in-target-pick";
import { resolveDebugTrust } from "./plain-debug-trust";

/** Plain's own commands — never a vendor `workbench.action.debug.*` id
 * takeover (there is no such id registered anywhere in this bundle, since
 * `@codingame/monaco-vscode-debug-service-override` is never imported — see
 * `debug-contribution.ts`'s own module doc comment). */
export const START_DEBUGGING_COMMAND_ID = "plain.debug.start";
export const STOP_DEBUGGING_COMMAND_ID = "plain.debug.stop";
/** `F100` S4: `DEBUG_CONSOLE_VIEW_CONTAINER_ID`'s own doc comment
 * (`debug-contribution.ts`) already explains why the Debug Console is its
 * own Panel container with `doNotRegisterOpenCommand: true` — this is the
 * one real command that actually reveals it (mirroring `Plain: Create
 * Terminal`'s identical `IViewsService.openView` shape); without this, the
 * Debug Console view would exist in the registry but have no way for a user
 * to ever actually open it. */
export const OPEN_DEBUG_CONSOLE_COMMAND_ID = "plain.debug.openConsole";
/** `F210` S4: the `stepInTargets` target picker's own command — see
 * `runStepIntoTarget`'s own doc comment for the full availability/failure
 * contract. */
export const STEP_INTO_TARGET_COMMAND_ID = "plain.debug.stepIntoTarget";

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
 * `F210` S1: when `launch.json` has more than one configuration, this
 * command hands the parsed array to `selectPlainLaunchConfiguration`
 * (`plain-debug-configuration-pick.ts`), which shows a real
 * `IQuickInputService.pick` picker — cancelling it returns from this
 * function with zero further side effects (no registry read, no
 * confirmation dialog, no `debug_launch`). A sole configuration is used
 * automatically, with no picker shown at all. Either way, the resolved
 * configuration's `name` is handed to `prepareDebugAdapterLaunch`, which
 * already looks up a configuration *by name* — this command only decides
 * which name.
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
	quickInputService: IQuickInputService,
	workspaceContextService: IWorkspaceContextService,
): Promise<void> {
	const runtime = getPlainDebugRuntime();
	if (runtime === undefined) {
		return;
	}
	const bridge = runtime.bridge;
	const roots = plainWorkspaceRootsFromFolders(
		workspaceContextService.getWorkspace().folders,
	);
	if (roots.length === 0) {
		await resolveDebugTrust(bridge, dialogService, true);
		return;
	}
	const root = await selectPlainDebugRoot(roots, (items) =>
		quickInputService.pick([...items], {
			placeHolder: "Select a workspace folder to debug",
			canPickMany: false,
		}),
	);
	if (root === undefined) {
		return;
	}
	const trustDecision = await resolveDebugTrust(bridge, dialogService, false);
	if (
		trustDecision.kind === "empty-workspace" ||
		trustDecision.kind === "declined"
	) {
		return;
	}
	const rootId = root.rootId;

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
	if (parsedLaunch.value.length === 0) {
		notificationService.error(
			`Plain: ${LAUNCH_CONFIG_PATH} has no configurations.`,
		);
		return;
	}
	const configuration = await selectPlainLaunchConfiguration(
		parsedLaunch.value,
		(items) =>
			quickInputService.pick([...items], {
				placeHolder: "Select a launch configuration",
				canPickMany: false,
			}),
	);
	if (configuration === undefined) {
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
			rootId,
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

/**
 * `F210` S4's "Plain: Step Into Target…" command — the `stepInTargets`
 * target picker's only entry point. Visible in the command palette
 * unconditionally (mirroring every other command this file registers), but
 * only actually executes while stopped and while the live session's own
 * `Capabilities.supportsStepInTargetsRequest` is `true`; every other case
 * (no live session, running rather than stopped, capability not reported, an
 * empty target list) reports an accurate `notificationService.error` instead
 * of attempting a doomed `stepIn` call — the same "report why, do not
 * silently no-op" pattern `runStartDebugging`/`runStopDebugging` above
 * already use for a failed bridge call. The existing Step Into *button*
 * (`plain-debug-call-stack-view.ts`) is entirely unchanged by this command:
 * it still never selects a target.
 *
 * Frame selection: uses whichever frame `DebugFrameSelection` currently
 * names — the call-stack view already selects the top stopped frame the
 * instant the call stack refreshes (see that view's own `#refresh`), so this
 * is "the selected frame, defaulting to the top one" without this command
 * needing its own frame-resolution logic. `undefined` (no frame selected at
 * all — only reachable if the call stack came back empty) is its own
 * reported error rather than a silent no-op.
 *
 * Cancelling the picker (`selectPlainStepInTarget` returning `undefined`)
 * returns from this function with zero further side effects — no `stepIn`
 * call follows a cancelled pick, exactly like `runStartDebugging`'s own
 * launch-configuration picker.
 */
async function runStepIntoTarget(
	notificationService: INotificationService,
	quickInputService: IQuickInputService,
): Promise<void> {
	const runtime = getPlainDebugRuntime();
	if (runtime === undefined) {
		return;
	}
	const state = runtime.session.state;
	if (state === null || state.stoppedThreadId === null) {
		notificationService.error(
			"Plain: Step Into Target… requires the debuggee to be stopped.",
		);
		return;
	}
	if (state.capabilities.supportsStepInTargetsRequest !== true) {
		notificationService.error(
			"Plain: the current debug adapter does not support step-into targets.",
		);
		return;
	}
	const frameId = runtime.frameSelection.frameId;
	if (frameId === null) {
		notificationService.error("Plain: no stack frame is selected.");
		return;
	}
	const threadId = state.stoppedThreadId;
	let result;
	try {
		result = await runtime.session.stepInTargets(frameId);
	} catch (error) {
		notificationService.error(normalizeCommandError(error).message);
		return;
	}
	if (result === undefined || result.targets.length === 0) {
		notificationService.error("Plain: no step-into targets are available.");
		return;
	}
	const target = await selectPlainStepInTarget(
		result.targets,
		result.truncated,
		(items, context) =>
			quickInputService.pick([...items], {
				placeHolder: context.truncated
					? "Select a step-into target (showing the first 256; more were available)"
					: "Select a step-into target",
				canPickMany: false,
			}),
	);
	if (target === undefined) {
		return;
	}
	try {
		await runtime.session.stepIn(threadId, target.id);
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
				accessor.get(IQuickInputService),
				accessor.get(IWorkspaceContextService),
			);
		}),
		CommandsRegistry.registerCommand(STOP_DEBUGGING_COMMAND_ID, (accessor) => {
			void runStopDebugging(accessor.get(INotificationService));
		}),
		CommandsRegistry.registerCommand(
			OPEN_DEBUG_CONSOLE_COMMAND_ID,
			(accessor) => {
				void accessor.get(IViewsService).openView(DEBUG_CONSOLE_VIEW_ID, true);
			},
		),
		CommandsRegistry.registerCommand(
			STEP_INTO_TARGET_COMMAND_ID,
			(accessor) => {
				void runStepIntoTarget(
					accessor.get(INotificationService),
					accessor.get(IQuickInputService),
				);
			},
		),
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
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: OPEN_DEBUG_CONSOLE_COMMAND_ID,
				title: "Debug Console",
				category: "Plain",
			},
		}),
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: STEP_INTO_TARGET_COMMAND_ID,
				title: "Step Into Target…",
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
