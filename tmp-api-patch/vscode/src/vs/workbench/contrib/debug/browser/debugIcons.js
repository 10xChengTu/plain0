
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

const debugConsoleViewIcon = registerIcon("debug-console-view-icon", Codicon.debugConsole, ( localize(9732, "View icon of the debug console view.")));
const runViewIcon = registerIcon("run-view-icon", Codicon.debugAlt, ( localize(9733, "View icon of the run view.")));
const variablesViewIcon = registerIcon("variables-view-icon", Codicon.debugAlt, ( localize(9734, "View icon of the variables view.")));
const watchViewIcon = registerIcon("watch-view-icon", Codicon.debugAlt, ( localize(9735, "View icon of the watch view.")));
const callStackViewIcon = registerIcon("callstack-view-icon", Codicon.debugAlt, ( localize(9736, "View icon of the call stack view.")));
const breakpointsViewIcon = registerIcon("breakpoints-view-icon", Codicon.debugAlt, ( localize(9737, "View icon of the breakpoints view.")));
const loadedScriptsViewIcon = registerIcon("loaded-scripts-view-icon", Codicon.debugAlt, ( localize(9738, "View icon of the loaded scripts view.")));
const breakpoint = {
    regular: registerIcon("debug-breakpoint", Codicon.debugBreakpoint, ( localize(9739, "Icon for breakpoints."))),
    disabled: registerIcon(
        "debug-breakpoint-disabled",
        Codicon.debugBreakpointDisabled,
        ( localize(9740, "Icon for disabled breakpoints."))
    ),
    unverified: registerIcon(
        "debug-breakpoint-unverified",
        Codicon.debugBreakpointUnverified,
        ( localize(9741, "Icon for unverified breakpoints."))
    ),
    pending: registerIcon("debug-breakpoint-pending", Codicon.debugBreakpointPending, ( localize(9742, "Icon for breakpoints waiting on another breakpoint.")))
};
const functionBreakpoint = {
    regular: registerIcon(
        "debug-breakpoint-function",
        Codicon.debugBreakpointFunction,
        ( localize(9743, "Icon for function breakpoints."))
    ),
    disabled: registerIcon(
        "debug-breakpoint-function-disabled",
        Codicon.debugBreakpointFunctionDisabled,
        ( localize(9744, "Icon for disabled function breakpoints."))
    ),
    unverified: registerIcon(
        "debug-breakpoint-function-unverified",
        Codicon.debugBreakpointFunctionUnverified,
        ( localize(9745, "Icon for unverified function breakpoints."))
    )
};
const conditionalBreakpoint = {
    regular: registerIcon(
        "debug-breakpoint-conditional",
        Codicon.debugBreakpointConditional,
        ( localize(9746, "Icon for conditional breakpoints."))
    ),
    disabled: registerIcon(
        "debug-breakpoint-conditional-disabled",
        Codicon.debugBreakpointConditionalDisabled,
        ( localize(9747, "Icon for disabled conditional breakpoints."))
    ),
    unverified: registerIcon(
        "debug-breakpoint-conditional-unverified",
        Codicon.debugBreakpointConditionalUnverified,
        ( localize(9748, "Icon for unverified conditional breakpoints."))
    )
};
const dataBreakpoint = {
    regular: registerIcon("debug-breakpoint-data", Codicon.debugBreakpointData, ( localize(9749, "Icon for data breakpoints."))),
    disabled: registerIcon(
        "debug-breakpoint-data-disabled",
        Codicon.debugBreakpointDataDisabled,
        ( localize(9750, "Icon for disabled data breakpoints."))
    ),
    unverified: registerIcon(
        "debug-breakpoint-data-unverified",
        Codicon.debugBreakpointDataUnverified,
        ( localize(9751, "Icon for unverified data breakpoints."))
    )
};
const logBreakpoint = {
    regular: registerIcon("debug-breakpoint-log", Codicon.debugBreakpointLog, ( localize(9752, "Icon for log breakpoints."))),
    disabled: registerIcon(
        "debug-breakpoint-log-disabled",
        Codicon.debugBreakpointLogDisabled,
        ( localize(9753, "Icon for disabled log breakpoint."))
    ),
    unverified: registerIcon(
        "debug-breakpoint-log-unverified",
        Codicon.debugBreakpointLogUnverified,
        ( localize(9754, "Icon for unverified log breakpoints."))
    )
};
const debugBreakpointHint = registerIcon("debug-hint", Codicon.debugHint, ( localize(9755, "Icon for breakpoint hints shown on hover in editor glyph margin.")));
const debugBreakpointUnsupported = registerIcon(
    "debug-breakpoint-unsupported",
    Codicon.debugBreakpointUnsupported,
    ( localize(9756, "Icon for unsupported breakpoints."))
);
const allBreakpoints = [
    breakpoint,
    functionBreakpoint,
    conditionalBreakpoint,
    dataBreakpoint,
    logBreakpoint
];
const debugStackframe = registerIcon("debug-stackframe", Codicon.debugStackframe, ( localize(9757, "Icon for a stackframe shown in the editor glyph margin.")));
const debugStackframeFocused = registerIcon("debug-stackframe-focused", Codicon.debugStackframeFocused, ( localize(9758, "Icon for a focused stackframe  shown in the editor glyph margin.")));
const debugGripper = registerIcon("debug-gripper", Codicon.gripper, ( localize(9759, "Icon for the debug bar gripper.")));
const debugRestartFrame = registerIcon("debug-restart-frame", Codicon.debugRestartFrame, ( localize(9760, "Icon for the debug restart frame action.")));
const debugStop = registerIcon("debug-stop", Codicon.debugStop, ( localize(9761, "Icon for the debug stop action.")));
const debugDisconnect = registerIcon("debug-disconnect", Codicon.debugDisconnect, ( localize(9762, "Icon for the debug disconnect action.")));
const debugRestart = registerIcon("debug-restart", Codicon.debugRestart, ( localize(9763, "Icon for the debug restart action.")));
const debugStepOver = registerIcon("debug-step-over", Codicon.debugStepOver, ( localize(9764, "Icon for the debug step over action.")));
const debugStepInto = registerIcon("debug-step-into", Codicon.debugStepInto, ( localize(9765, "Icon for the debug step into action.")));
const debugStepOut = registerIcon("debug-step-out", Codicon.debugStepOut, ( localize(9766, "Icon for the debug step out action.")));
const debugStepBack = registerIcon("debug-step-back", Codicon.debugStepBack, ( localize(9767, "Icon for the debug step back action.")));
const debugPause = registerIcon("debug-pause", Codicon.debugPause, ( localize(9768, "Icon for the debug pause action.")));
const debugContinue = registerIcon("debug-continue", Codicon.debugContinue, ( localize(9769, "Icon for the debug continue action.")));
const debugReverseContinue = registerIcon("debug-reverse-continue", Codicon.debugReverseContinue, ( localize(9770, "Icon for the debug reverse continue action.")));
const debugRun = registerIcon("debug-run", Codicon.run, ( localize(9771, "Icon for the run or debug action.")));
const debugStart = registerIcon("debug-start", Codicon.debugStart, ( localize(9772, "Icon for the debug start action.")));
const debugConfigure = registerIcon("debug-configure", Codicon.gear, ( localize(9773, "Icon for the debug configure action.")));
registerIcon("debug-console", Codicon.gear, ( localize(9774, "Icon for the debug console open action.")));
const debugRemoveConfig = registerIcon("debug-remove-config", Codicon.trash, ( localize(9775, "Icon for removing debug configurations.")));
registerIcon("debug-collapse-all", Codicon.collapseAll, ( localize(9776, "Icon for the collapse all action in the debug views.")));
const callstackViewSession = registerIcon("callstack-view-session", Codicon.bug, ( localize(9777, "Icon for the session icon in the call stack view.")));
const debugConsoleClearAll = registerIcon("debug-console-clear-all", Codicon.clearAll, ( localize(9778, "Icon for the clear all action in the debug console.")));
const watchExpressionsRemoveAll = registerIcon("watch-expressions-remove-all", Codicon.closeAll, ( localize(9779, "Icon for the Remove All action in the watch view.")));
const watchExpressionRemove = registerIcon("watch-expression-remove", Codicon.removeClose, ( localize(9780, "Icon for the Remove action in the watch view.")));
const watchExpressionsAdd = registerIcon("watch-expressions-add", Codicon.add, ( localize(9781, "Icon for the add action in the watch view.")));
const watchExpressionsAddFuncBreakpoint = registerIcon("watch-expressions-add-function-breakpoint", Codicon.add, ( localize(9782, "Icon for the add function breakpoint action in the watch view.")));
const watchExpressionsAddDataBreakpoint = registerIcon(
    "watch-expressions-add-data-breakpoint",
    Codicon.variableGroup,
    ( localize(9783, "Icon for the add data breakpoint action in the breakpoints view."))
);
const breakpointsRemoveAll = registerIcon("breakpoints-remove-all", Codicon.closeAll, ( localize(9784, "Icon for the Remove All action in the breakpoints view.")));
const breakpointsActivate = registerIcon("breakpoints-activate", Codicon.activateBreakpoints, ( localize(9785, "Icon for the activate action in the breakpoints view.")));
const debugConsoleEvaluationInput = registerIcon("debug-console-evaluation-input", Codicon.arrowSmallRight, ( localize(9786, "Icon for the debug evaluation input marker.")));
const debugConsoleEvaluationPrompt = registerIcon("debug-console-evaluation-prompt", Codicon.chevronRight, ( localize(9787, "Icon for the debug evaluation prompt.")));
const debugInspectMemory = registerIcon("debug-inspect-memory", Codicon.fileBinary, ( localize(9788, "Icon for the inspect memory action.")));

export { allBreakpoints, breakpoint, breakpointsActivate, breakpointsRemoveAll, breakpointsViewIcon, callStackViewIcon, callstackViewSession, conditionalBreakpoint, dataBreakpoint, debugBreakpointHint, debugBreakpointUnsupported, debugConfigure, debugConsoleClearAll, debugConsoleEvaluationInput, debugConsoleEvaluationPrompt, debugConsoleViewIcon, debugContinue, debugDisconnect, debugGripper, debugInspectMemory, debugPause, debugRemoveConfig, debugRestart, debugRestartFrame, debugReverseContinue, debugRun, debugStackframe, debugStackframeFocused, debugStart, debugStepBack, debugStepInto, debugStepOut, debugStepOver, debugStop, functionBreakpoint, loadedScriptsViewIcon, logBreakpoint, runViewIcon, variablesViewIcon, watchExpressionRemove, watchExpressionsAdd, watchExpressionsAddDataBreakpoint, watchExpressionsAddFuncBreakpoint, watchExpressionsRemoveAll, watchViewIcon };
