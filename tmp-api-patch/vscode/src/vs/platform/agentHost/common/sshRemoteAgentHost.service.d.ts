import { Event } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import { ISSHConnectProgress, ISSHAgentHostConnection, ISSHAgentHostConfig, ISSHResolvedConfig, type IRelayMessage, type ISSHConnectResult, type ISSHKeyboardInteractiveRequest } from "./sshRemoteAgentHost.js";
export declare const ISSHRemoteAgentHostService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<ISSHRemoteAgentHostService>;
/**
* Manages SSH connections that bootstrap a remote agent host process.
*
* Each connection SSHs into a remote machine, ensures the VS Code CLI
* is installed, starts `code agent-host`, and creates a WebSocket relay
* over the SSH channel. Messages are forwarded between the renderer and
* the remote agent host via IPC through the shared process.
*/
export interface ISSHRemoteAgentHostService {
    readonly _serviceBrand: undefined;
    /** Fires when the set of active SSH connections changes. */
    readonly onDidChangeConnections: Event<void>;
    /** Progress messages during connect. */
    readonly onDidReportConnectProgress: Event<ISSHConnectProgress>;
    /** Currently active SSH-bootstrapped connections. */
    readonly connections: readonly ISSHAgentHostConnection[];
    /**
    * Bootstrap a remote agent host over SSH.
    *
    * 1. Opens an SSH connection to the remote host
    * 2. Downloads and installs the VS Code CLI if needed
    * 3. Starts `code agent-host`
    * 4. Creates a WebSocket relay over the SSH channel
    * 5. Registers the connection with {@link IRemoteAgentHostService}
    *
    * Resolves with the connection handle once the agent host is reachable.
    */
    connect(config: ISSHAgentHostConfig): Promise<ISSHAgentHostConnection>;
    /**
    * Disconnect an SSH-bootstrapped connection by host address.
    * Tears down the SSH tunnel, stops the remote agent host, and
    * removes the entry from {@link IRemoteAgentHostService}.
    */
    disconnect(host: string): Promise<void>;
    /** List SSH config host aliases (excluding wildcards). */
    listSSHConfigHosts(): Promise<string[]>;
    /**
    * Ensure `~/.ssh/config` exists (creating it with the right permissions if
    * missing) and return its URI. The parent `~/.ssh` directory is created
    * with mode 0700 and the config file with mode 0600 on POSIX systems.
    */
    ensureUserSSHConfig(): Promise<URI>;
    /**
    * List the known SSH configuration file URIs in priority order — typically the
    * per-user `~/.ssh/config` (always returned, even if it does not yet exist) and
    * the system-wide `/etc/ssh/ssh_config` (only when present on disk).
    */
    listSSHConfigFiles(): Promise<URI[]>;
    /** Resolve full SSH config for a host via `ssh -G`. */
    resolveSSHConfig(host: string): Promise<ISSHResolvedConfig>;
    /**
    * Re-establish an SSH tunnel on startup for a previously connected host.
    * Returns the new local forwarded address and registers it.
    */
    reconnect(sshConfigHost: string, name: string): Promise<ISSHAgentHostConnection>;
}
/**
* Main-process service that performs the actual SSH work.
* The renderer calls this over IPC and handles registration
* with {@link IRemoteAgentHostService} locally.
*/
export declare const ISSHRemoteAgentHostMainService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<ISSHRemoteAgentHostMainService>;
export interface ISSHRemoteAgentHostMainService {
    readonly _serviceBrand: undefined;
    /** Fires when the set of active SSH connections changes. */
    readonly onDidChangeConnections: Event<void>;
    /** Fires when a connection is closed from the shared process side. */
    readonly onDidCloseConnection: Event<string>;
    /** Progress messages during connect (e.g. "Installing CLI..."). */
    readonly onDidReportConnectProgress: Event<ISSHConnectProgress>;
    /** Fires when a message is received from a remote agent host via the SSH relay. */
    readonly onDidRelayMessage: Event<IRelayMessage>;
    /** Fires when a relay connection to a remote agent host closes. */
    readonly onDidRelayClose: Event<string>;
    /**
    * Fires when the SSH server requests keyboard-interactive auth (typically
    * a password prompt). The renderer must answer via {@link respondKeyboardInteractive}
    * with the same `requestId`, otherwise the auth attempt will hang until the
    * SSH `readyTimeout` elapses.
    */
    readonly onDidRequestKeyboardInteractive: Event<ISSHKeyboardInteractiveRequest>;
    /**
    * Fires when a previously requested keyboard-interactive prompt is no
    * longer needed (e.g. the underlying SSH connect attempt failed or was
    * aborted). The renderer should dismiss any UI it opened for `requestId`.
    */
    readonly onDidCancelKeyboardInteractive: Event<string>;
    /**
    * Provide responses for a previously fired keyboard-interactive request.
    * Pass `undefined` when the user cancels the prompt; this aborts the
    * owning SSH connection attempt.
    */
    respondKeyboardInteractive(requestId: string, responses: readonly string[] | undefined): Promise<void>;
    /**
    * Bootstrap a remote agent host over SSH. Returns serializable
    * connection info for the renderer to register.
    */
    connect(config: ISSHAgentHostConfig): Promise<ISSHConnectResult>;
    /**
    * Send a message to a remote agent host through the SSH relay.
    */
    relaySend(connectionId: string, message: string): Promise<void>;
    /**
    * Disconnect an SSH-bootstrapped connection by host address.
    */
    disconnect(host: string): Promise<void>;
    /** List SSH config host aliases (excluding wildcards). */
    listSSHConfigHosts(): Promise<string[]>;
    /**
    * Ensure `~/.ssh/config` exists (creating it with the right permissions if
    * missing) and return its URI.
    */
    ensureUserSSHConfig(): Promise<URI>;
    /** List the known SSH configuration file URIs (user config always included). */
    listSSHConfigFiles(): Promise<URI[]>;
    /** Resolve full SSH config for a host via `ssh -G`. */
    resolveSSHConfig(host: string): Promise<ISSHResolvedConfig>;
    /**
    * Re-establish an SSH tunnel for a previously connected host.
    * Resolves the SSH config alias, connects, and returns fresh
    * connection info with a new local forwarded port.
    */
    reconnect(sshConfigHost: string, name: string, remoteAgentHostCommand?: string, agentForward?: boolean): Promise<ISSHConnectResult>;
}
