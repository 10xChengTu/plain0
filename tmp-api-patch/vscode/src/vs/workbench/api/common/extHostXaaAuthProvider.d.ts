import { DynamicAuthProvider } from "./extHostAuthentication.js";
type Ctor<T> = new (...args: any[]) => T;
/**
 * Scopes used when bootstrapping the IdP session for an XAA flow.
 *
 * `openid` is required because the ID-JAG token exchange uses the IdP-issued
 * `id_token` as `subject_token` (per draft-ietf-oauth-identity-assertion-authz-grant
 * section 3.1, the subject token MUST be of type `urn:ietf:params:oauth:token-type:id_token`).
 * `offline_access` is requested so we get a refresh token for the IdP session.
 */
export declare const IDP_SCOPES: readonly string[];
/** Cache key for resource-scoped tokens. Exported for testing. */
export declare function cacheKey(resource: string, scopes: readonly string[]): string;
/**
 * Returns true if the cached token is past (or within 60s of) its expiry. Pure
 * and exported for testing.
 *
 * Mints fresh ID-JAG assertions are usually short-lived (minutes). We treat tokens as expired
 * 60s before their nominal expiry to avoid clock skew and in-flight redemptions racing past
 * `exp`. Tokens without `expires_in` defined are treated as never-expiring (cached
 * until the process exits); `expires_in: 0` is treated as immediately expired.
 */
export declare function isExpired(entry: {
    token: {
        expires_in?: number;
    };
    created_at: number;
}, now?: number): boolean;
/**
 * (Preview) Mixin that turns a {@link DynamicAuthProvider} subclass into a
 * Cross App Access (XAA) / enterprise-managed authentication provider, per
 * `draft-ietf-oauth-identity-assertion-authz-grant`.
 *
 * The IdP login leg is identical to the base class — Auth Code + PKCE against
 * the org-configured issuer, using the pre-registered client credentials. On
 * top of that:
 *
 *   1. `createSession` ensures an IdP session exists (delegated to the base
 *      class with {@link IDP_SCOPES}).
 *   2. It POSTs to the IdP token endpoint with `grant_type=token-exchange`,
 *      `subject_token=<id_token>`, `subject_token_type=id_token`,
 *      `requested_token_type=id-jag`, `audience=<resource AS>`,
 *      `resource=<resource indicator>`, `scope=<requested scopes>` to mint an
 *      ID-JAG.
 *   3. It discovers the resource's authorization server metadata (the audience
 *      URL) and POSTs the ID-JAG to its token endpoint with
 *      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
 *      `assertion=<id-jag>`, `resource=<resource indicator>`,
 *      `scope=<requested scopes>` to obtain a resource-scoped access token.
 *   4. The resource-scoped token is cached in-memory per `(resource, scopes)`
 *      and returned as the session's access token.
 *
 * The resource indicator is read from `options.resource` (RFC 8707) and the
 * resource's authorization server URL from `options.audience` on
 * {@link vscode.AuthenticationProviderSessionOptions}.
 */
export declare function XaaifyAuthProvider<TBase extends Ctor<DynamicAuthProvider>>(Base: TBase): TBase;
export {};
