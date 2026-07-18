import { IDisposable } from "../../../base/common/lifecycle.js";
import { IObservable } from "../../../base/common/observable.js";
import { URI } from "../../../base/common/uri.js";
import { IResourceListResult, IResourceReadResult, AgentHostPermissionMode, IPendingResourceRequest } from "@codingame/monaco-vscode-chat-service-override/vscode/vs/platform/agentHost/common/agentHostResourceService";
import { ResourceRequestParams } from "./state/protocol/commands.js";
import { ResourceWriteParams, ResourceDeleteParams, ResourceMoveParams, ResourceCopyParams, ResourceResolveParams, ResourceResolveResult, ResourceMkdirParams } from "./state/sessionProtocol.js";
export declare const IAgentHostResourceService: import("../../instantiation/common/instantiation.js").ServiceIdentifier<IAgentHostResourceService>;
/**
* Single owner of agent-host-facing filesystem operations and the
* permission policy that gates them. Combines what were previously two
* services (`IAgentHostPermissionService` + `IAgentHostVirtualResourceProvider`)
* into one consistent interface used by both the in-process local channel
* and the remote protocol client.
*
* Each FS method is gated by a permission check keyed on `address`: a
* normalized network host for remote agent hosts, or
* {@link LOCAL_AGENT_HOST_ADDRESS} for the local utility-process host.
* Denied operations throw {@link AgentHostResourcePermissionError} carrying
* the {@link ResourceRequestParams} that, if granted, would unlock the
* operation.
*
* Read operations transparently fall back to virtual content (untitled
* documents, notebook cells, ...) when the local file service cannot
* resolve the URI.
*/
export interface IAgentHostResourceService {
    readonly _serviceBrand: undefined;
    list(address: string, uri: URI): Promise<IResourceListResult>;
    read(address: string, uri: URI): Promise<IResourceReadResult>;
    write(address: string, params: ResourceWriteParams): Promise<void>;
    del(address: string, params: ResourceDeleteParams): Promise<void>;
    move(address: string, params: ResourceMoveParams): Promise<void>;
    copy(address: string, params: ResourceCopyParams): Promise<void>;
    resolve(address: string, params: ResourceResolveParams): Promise<ResourceResolveResult>;
    mkdir(address: string, params: ResourceMkdirParams): Promise<void>;
    /**
    * Returns whether {@link uri} is already granted for {@link mode} on
    * {@link address}. Useful as a pre-check before sending data to a host
    * that will read it back. The same gating runs implicitly inside every
    * FS method on this service.
    */
    check(address: string, uri: URI, mode: AgentHostPermissionMode): Promise<boolean>;
    /**
    * Handle an inbound `resourceRequest` from a host. Resolves once access
    * is granted (immediately, if already covered); rejects with a
    * `CancellationError` if the user denies or the connection closes.
    */
    request(address: string, params: ResourceRequestParams): Promise<void>;
    /** Per-address observable of pending requests for UI surfaces. */
    pendingFor(address: string): IObservable<readonly IPendingResourceRequest[]>;
    /** Observable of all pending requests across every address. */
    readonly allPending: IObservable<readonly IPendingResourceRequest[]>;
    /**
    * Find a pending request by id, across all addresses. Returns
    * `undefined` once the request has been resolved or rejected.
    */
    findPending(id: string): IPendingResourceRequest | undefined;
    /**
    * Register an implicit read grant for {@link uri} (and descendants) on
    * {@link address}. Used by call sites that are about to send a URI to a
    * host and therefore expect that host to read it back. The returned
    * disposable revokes the grant.
    */
    grantImplicitRead(address: string, uri: URI): IDisposable;
    /**
    * Notify that the connection at {@link address} has closed. Drops all
    * implicit grants and rejects any outstanding pending requests.
    */
    connectionClosed(address: string): void;
}
