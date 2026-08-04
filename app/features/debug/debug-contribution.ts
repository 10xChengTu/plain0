import { Codicon } from "@codingame/monaco-vscode-api/vscode/vs/base/common/codicons";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { Registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform";
import { ViewPaneContainer } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer";
import {
	Extensions,
	ViewContainerLocation,
	type IViewContainersRegistry,
	type IViewsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import { PlainDebugCallStackView } from "./plain-debug-call-stack-view";
import { PlainDebugConsoleView } from "./plain-debug-console-view";
import { PlainDebugDisassemblyView } from "./plain-debug-disassembly-view";
import { PlainDebugVariablesView } from "./plain-debug-variables-view";
import { PlainDebugWatchView } from "./plain-debug-watch-view";

export const DEBUG_VIEW_CONTAINER_ID = "plain.workbench.viewContainer.debug";
export const DEBUG_CALL_STACK_VIEW_ID = PlainDebugCallStackView.ID;
export const DEBUG_VARIABLES_VIEW_ID = PlainDebugVariablesView.ID;
export const DEBUG_WATCH_VIEW_ID = PlainDebugWatchView.ID;
/** `F210` S5: the read-only Disassembly view — lives in the same Sidebar
 * "Run and Debug" container as the three views above (unlike the Debug
 * Console below, it is frame/call-stack-adjacent, not output-console-like),
 * revealed on demand by its own "Plain: Open Disassembly" command
 * (`plain-debug-commands.ts`) rather than shown expanded by default — see
 * `PlainDebugDisassemblyView`'s own class doc comment for its
 * only-populates-while-stopped-and-supported contract. */
export const DEBUG_DISASSEMBLY_VIEW_ID = PlainDebugDisassemblyView.ID;
/** `F100` S4: the Debug Console lives in its own Panel-location container
 * (mirroring `TERMINAL_VIEW_CONTAINER_ID`'s own Panel placement) rather than
 * inside `DEBUG_VIEW_CONTAINER_ID`'s Sidebar container — this matches the
 * conventional "Debug Console sits alongside Terminal/Output/Problems at the
 * bottom" information architecture, not the "Run and Debug" sidebar. */
export const DEBUG_CONSOLE_VIEW_CONTAINER_ID =
	"plain.workbench.viewContainer.debugConsole";
export const DEBUG_CONSOLE_VIEW_ID = PlainDebugConsoleView.ID;

/**
 * Registers exactly one Sidebar view container and its three self-built view
 * panes (`F100` S3) — never any import of
 * `@codingame/monaco-vscode-debug-service-override`'s own
 * `debug.contribution.js` (the frozen research doc's "上游 debug 子系统
 * Chat/AI 耦合排查" found four independent, each individually disqualifying
 * reasons not to: a hardcoded `IChatContextPickService` dependency, an
 * unconditional Notebook contrib import, a hardcoded `ITaskService`
 * dependency, and a `contributes.debuggers`/`contributes.breakpoints`
 * extension-point-driven type resolution that is structurally dead in a
 * product with no extension host). This is a from-scratch registration
 * mirroring `scm-contribution.ts`/`terminal-contribution.ts`'s own
 * established "self-built registration, not an import of the vendor
 * contribution file" shape.
 *
 * `doNotRegisterOpenCommand: true` mirrors every sibling contribution:
 * `plain-debug-commands.ts` registers its own `Plain: Start Debugging`/
 * `Plain: Stop Debugging` commands instead.
 */
const debugViewContainer = Registry.as<IViewContainersRegistry>(
	Extensions.ViewContainersRegistry,
).registerViewContainer(
	{
		id: DEBUG_VIEW_CONTAINER_ID,
		title: { value: "Run and Debug", original: "Run and Debug" },
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			DEBUG_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: false },
		]),
		hideIfEmpty: true,
		icon: Codicon.debugAlt,
		order: 4,
	},
	ViewContainerLocation.Sidebar,
	{ doNotRegisterOpenCommand: true },
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(
	[
		{
			id: DEBUG_CALL_STACK_VIEW_ID,
			containerIcon: Codicon.debugAlt,
			name: { value: "Call Stack", original: "Call Stack" },
			ctorDescriptor: new SyncDescriptor(PlainDebugCallStackView),
			canToggleVisibility: true,
			canMoveView: true,
		},
		{
			id: DEBUG_VARIABLES_VIEW_ID,
			containerIcon: Codicon.symbolVariable,
			name: { value: "Variables", original: "Variables" },
			ctorDescriptor: new SyncDescriptor(PlainDebugVariablesView),
			canToggleVisibility: true,
			canMoveView: true,
		},
		{
			id: DEBUG_WATCH_VIEW_ID,
			containerIcon: Codicon.eye,
			name: { value: "Watch", original: "Watch" },
			ctorDescriptor: new SyncDescriptor(PlainDebugWatchView),
			canToggleVisibility: true,
			canMoveView: true,
		},
		{
			id: DEBUG_DISASSEMBLY_VIEW_ID,
			containerIcon: Codicon.chip,
			name: { value: "Disassembly", original: "Disassembly" },
			ctorDescriptor: new SyncDescriptor(PlainDebugDisassemblyView),
			canToggleVisibility: true,
			canMoveView: true,
		},
	],
	debugViewContainer,
);

/**
 * `F100` S4's Debug Console — a second, Panel-location container (see
 * `DEBUG_CONSOLE_VIEW_CONTAINER_ID`'s own doc comment for why it is not
 * folded into `debugViewContainer` above). `doNotRegisterOpenCommand: true`
 * for the same reason every sibling container sets it — this domain reveals
 * the view itself via `IViewsService.openView` from its own command/
 * contribution wiring, never the auto-generated open command.
 */
const debugConsoleViewContainer = Registry.as<IViewContainersRegistry>(
	Extensions.ViewContainersRegistry,
).registerViewContainer(
	{
		id: DEBUG_CONSOLE_VIEW_CONTAINER_ID,
		title: { value: "Debug Console", original: "Debug Console" },
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [
			DEBUG_CONSOLE_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: true },
		]),
		hideIfEmpty: true,
		icon: Codicon.debugConsole,
		order: 3,
	},
	ViewContainerLocation.Panel,
	{ doNotRegisterOpenCommand: true },
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(
	[
		{
			id: DEBUG_CONSOLE_VIEW_ID,
			containerIcon: Codicon.debugConsole,
			name: { value: "Debug Console", original: "Debug Console" },
			ctorDescriptor: new SyncDescriptor(PlainDebugConsoleView),
			canToggleVisibility: false,
			canMoveView: true,
		},
	],
	debugConsoleViewContainer,
);
