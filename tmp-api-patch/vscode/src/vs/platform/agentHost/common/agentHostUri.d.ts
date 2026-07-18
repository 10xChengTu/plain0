import { URI } from "../../../base/common/uri.js";
import type { ResourceLabelFormatter } from "../../label/common/label.js";
/**
 * The URI scheme for accessing files on a remote agent host.
 *
 * The original file path is kept verbatim as the URI path so resource
 * labels, language detection, and path comparisons see a real path. The
 * original scheme, authority, and query are carried in a single
 * url-safe-base64 `_ah` query parameter so any remote resource can be
 * represented without assuming `file://`:
 *
 * ```
 * vscode-agent-host://[connectionAuthority][originalPath]?_ah=[meta]#[originalFragment]
 * ```
 *
 * where `meta` is {@link IAgentHostUriMeta} as url-safe-base64-encoded
 * JSON. Encoding the metadata as a single opaque parameter (rather than
 * raw JSON) keeps the query a well-formed parameter list, so unrelated
 * query parameters such as `vscodeLinkType` can coexist on the wrapped
 * URI without corrupting the metadata. For example,
 * `file:///home/user/foo.ts` on remote `my-server` becomes:
 * ```
 * vscode-agent-host://my-server/home/user/foo.ts?_ah=eyJzY2hlbWUiOiJmaWxlIn0
 * ```
 */
export declare const AGENT_HOST_SCHEME = "vscode-agent-host";
/**
 * Wraps a remote URI into a {@link AGENT_HOST_SCHEME} URI that can be
 * resolved through the agent host filesystem provider.
 *
 * @param originalUri The URI on the remote (e.g. `file:///path` or
 *   `agenthost-content:///sessionId/...`)
 * @param connectionAuthority The sanitized connection identifier used as
 *   the URI authority (from {@link agentHostAuthority}).
 */
export declare function toAgentHostUri(originalUri: URI, connectionAuthority: string): URI;
/**
 * Extracts the original URI from a {@link AGENT_HOST_SCHEME} URI.
 *
 * The inverse of {@link toAgentHostUri}.
 */
export declare function fromAgentHostUri(agentHostUri: URI): URI;
/**
 * Strips the redundant `ws://` scheme from an address. The transport layer
 * already defaults to `ws://`, so only `wss://` needs to be preserved.
 */
export declare function normalizeRemoteAgentHostAddress(address: string): string;
/**
 * Encode a remote address into an identifier that is safe for use in
 * both URI schemes and URI authorities, and is collision-free.
 *
 * Three tiers:
 * 1. Purely alphanumeric addresses are returned as-is.
 * 2. "Normal" addresses containing only `[a-zA-Z0-9.:-]` get colons
 *    replaced with `__` (double underscore) for human readability.
 *    Addresses containing `_` skip this tier to keep the encoding
 *    collision-free (`__` can only appear from colon replacement).
 * 3. Everything else is url-safe base64-encoded with a `b64-` prefix.
 */
export declare function agentHostAuthority(address: string): string;
/**
 * Label formatter for {@link AGENT_HOST_SCHEME} URIs. The URI path is
 * already the original resource path, so the label is the path verbatim.
 */
export declare const AGENT_HOST_LABEL_FORMATTER: ResourceLabelFormatter;
