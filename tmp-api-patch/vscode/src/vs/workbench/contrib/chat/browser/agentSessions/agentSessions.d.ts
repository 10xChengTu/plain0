import { URI } from "../../../../../base/common/uri.js";
import { ThemeIcon } from "../../../../../base/common/themables.js";
import { isAgentHostTarget } from "../../common/chatSessionsService.js";
import { IChatRequestVariableEntry } from "../../common/attachments/chatVariableEntries.js";
export declare enum AgentSessionProviders {
    Local = "local",
    Background = "copilotcli",
    Cloud = "copilot-cloud-agent",
    Claude = "claude-code",
    Codex = "openai-codex",
    Growth = "copilot-growth",
    AgentHostCopilot = "agent-host-copilotcli",
    AgentHostClaude = "agent-host-claude",
    AgentHostCodex = "agent-host-codex"
}
/**
 * A session target is either a well-known {@link AgentSessionProviders} enum
 * value or a dynamic string for dynamically-registered providers (e.g. remote
 * agent hosts like `remote-{authority}-copilot`).
 * TODO@roblourens HACK
 */
export type AgentSessionTarget = AgentSessionProviders | (string & {});
export declare function isBuiltInAgentSessionProvider(provider: AgentSessionTarget): boolean;
export declare function getAgentSessionProvider(sessionResource: URI | string): AgentSessionProviders | undefined;
export declare function getAgentSessionProviderName(provider: AgentSessionTarget): string;
export declare function getAgentSessionProviderIcon(provider: AgentSessionTarget): ThemeIcon;
export declare function isFirstPartyAgentSessionProvider(provider: AgentSessionTarget): boolean;
/**
 * Re-exported from `common/chatSessionsService.ts` so existing browser-layer
 * callers keep working without changing imports.
 */
export { isAgentHostTarget };
/**
 * Generic command used to delegate ("Continue in…") an existing conversation to
 * a new agent host session. The conversation transcript travels as an
 * attachment so the target agent can pick up the work.
 *
 * Both VS Code (the main window) and the Agents window surface agent host
 * sessions, but they open sessions through different infrastructure. To avoid
 * registering a command per session type, agent host delegation is funneled
 * through this single command id. The Agents window registers a handler that
 * creates the target session via its session management service; in the main
 * window the chat action opens the session directly. The command id is
 * intentionally a plain string constant so the `vs/sessions` layer can register
 * a handler for it without importing chat browser internals.
 */
export declare const CHAT_DELEGATE_TO_AGENT_HOST_SESSION_COMMAND_ID = "workbench.action.chat.delegateToAgentHostSession";
/**
 * Arguments passed to {@link CHAT_DELEGATE_TO_AGENT_HOST_SESSION_COMMAND_ID}.
 * The values are passed by reference within a single renderer, so rich types
 * such as the attached context entries survive the command invocation.
 */
export interface IAgentHostDelegationRequest {
    /** The target agent host session type, e.g. `agent-host-copilotcli`. */
    readonly type: string;
    /** Human readable name of the target session type. */
    readonly displayName: string;
    /** The user prompt to send to the new session. */
    readonly prompt: string;
    /** Attachments to include with the first request (e.g. the prior transcript). */
    readonly attachedContext?: IChatRequestVariableEntry[];
}
export declare function getAgentCanContinueIn(provider: AgentSessionTarget): boolean;
export declare function getAgentSessionProviderDescription(provider: AgentSessionTarget): string;
export declare enum AgentSessionsViewerOrientation {
    Stacked = 1,
    SideBySide = 2
}
export declare enum AgentSessionsViewerPosition {
    Left = 1,
    Right = 2
}
export interface IAgentSessionsControl {
    readonly element: HTMLElement | undefined;
    refresh(): void;
    openFind(): void;
    reveal(sessionResource: URI): boolean;
    clearFocus(): void;
    hasFocusOrSelection(): boolean;
    resetSectionCollapseState(): void;
    collapseAllSections(): void;
}
export declare const agentSessionReadIndicatorForeground: string;
export declare const agentSessionSelectedBadgeBorder: string;
export declare const agentSessionSelectedUnfocusedBadgeBorder: string;
export declare const AGENT_SESSION_RENAME_ACTION_ID = "agentSession.rename";
export declare const AGENT_SESSION_DELETE_ACTION_ID = "agentSession.delete";
