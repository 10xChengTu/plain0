import { type AgentProvider } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentService";
/**
 * Builds the unique per-connection identifier for a remote agent host.
 *
 * This string is used as the resource URI scheme registered via
 * `registerChatSessionContentProvider` and as the language model vendor /
 * `targetChatSessionType` published by `AgentHostLanguageModelProvider`.
 */
export declare function remoteAgentHostSessionTypeId(connectionAuthority: string, agentProvider: AgentProvider): string;
/**
 * Builds the authority-specific prefix for remote agent host session types.
 */
export declare function remoteAgentHostSessionTypeAuthorityPrefix(connectionAuthority: string): string;
/**
 * Returns whether the given session type uses the remote agent host scheme.
 */
export declare function isRemoteAgentHostSessionType(sessionType: string): boolean;
/**
 * Finds the best matching remote agent host authority from a known candidate set.
 *
 * Remote session types are formatted as `remote-{authority}-{provider}` and
 * authorities may contain `-`, so callers should match against the full set of
 * known authorities instead of splitting the session type.
 */
export declare function findRemoteAgentHostSessionTypeAuthority(sessionType: string, connectionAuthorities: Iterable<string>): string | undefined;
/**
 * Extracts the harness/provider suffix from a remote agent host session type.
 *
 * Remote session types are formatted as `remote-{authority}-{provider}`. The
 * authority may contain `-`, but provider names do not, so the harness is the
 * final `-`-delimited segment. Returns `undefined` for non-remote session types.
 */
export declare function parseRemoteAgentHostHarness(sessionType: string): string | undefined;
/**
 * Extracts the connection authority from a remote agent host session type when the provider is known.
 */
export declare function parseRemoteAgentHostSessionTypeAuthority(sessionType: string, agentProvider: AgentProvider): string | undefined;
