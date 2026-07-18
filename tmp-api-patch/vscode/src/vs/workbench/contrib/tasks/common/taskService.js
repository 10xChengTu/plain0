
import { localize } from '../../../../nls.js';
import { RawContextKey, ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

const CustomExecutionSupportedContext = ( new RawContextKey("customExecutionSupported", false, ( localize(
    14725,
    "Whether CustomExecution tasks are supported. Consider using in the when clause of a 'taskDefinition' contribution."
))));
const ShellExecutionSupportedContext = ( new RawContextKey("shellExecutionSupported", false, ( localize(
    14726,
    "Whether ShellExecution tasks are supported. Consider using in the when clause of a 'taskDefinition' contribution."
))));
const TaskCommandsRegistered = ( new RawContextKey("taskCommandsRegistered", false, ( localize(14727, "Whether the task commands have been registered yet"))));
const ProcessExecutionSupportedContext = ( new RawContextKey("processExecutionSupported", false, ( localize(
    14728,
    "Whether ProcessExecution tasks are supported. Consider using in the when clause of a 'taskDefinition' contribution."
))));
const ServerlessWebContext = ( new RawContextKey("serverlessWebContext", false, ( localize(14729, "True when in the web with no remote authority."))));
const TasksAvailableContext = ( new RawContextKey("tasksAvailable", false, ( localize(14730, "Whether any tasks are available in the workspace."))));
const TaskExecutionSupportedContext = ( ContextKeyExpr.or(( ContextKeyExpr.and(ShellExecutionSupportedContext, ProcessExecutionSupportedContext)), CustomExecutionSupportedContext));

export { CustomExecutionSupportedContext, ProcessExecutionSupportedContext, ServerlessWebContext, ShellExecutionSupportedContext, TaskCommandsRegistered, TaskExecutionSupportedContext, TasksAvailableContext };
