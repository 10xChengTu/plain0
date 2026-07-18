import { URI } from "../../../base/common/uri.js";
export declare function getRemoteAuthority(uri: URI): string | undefined;
export declare function getRemoteName(authority: string): string;
export declare function getRemoteName(authority: undefined): undefined;
export declare function getRemoteName(authority: string | undefined): string | undefined;
/**
 * Returns the suffix part of the authority after the '+' character.
 * For remote connections, this is typically the server/tunnel identifier.
 * Examples:
 * - For tunnels: `tunnel+myTunnel` returns `myTunnel`
 * - For SSH: `ssh+myserver` returns `myserver`
 * - For localhost: `localhost:8000` returns `undefined`
 * @param authority The remote authority string.
 * @returns The suffix after the '+' character, or undefined if there is no '+' character.
 */
export declare function getRemoteServerRootPath(authority: string): string | undefined;
export declare function getRemoteServerRootPath(authority: undefined): undefined;
export declare function getRemoteServerRootPath(authority: string | undefined): string | undefined;
export declare function parseAuthorityWithPort(authority: string): {
    host: string;
    port: number;
};
export declare function parseAuthorityWithOptionalPort(authority: string, defaultPort: number): {
    host: string;
    port: number;
};
/**
 * Returns whether the given host (as found in a direct `<host>:<port>` remote
 * authority) refers to the local loopback interface. The check is intentionally
 * strict: only `localhost` and the IPv4/IPv6 loopback literals are considered
 * local. Any other host (a routable IP address or a hostname) is treated as a
 * connection that leaves the local machine.
 */
export declare function isLoopbackHost(host: string): boolean;
