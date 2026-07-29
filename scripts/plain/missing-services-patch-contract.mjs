// `F110` S2 (`docs/research/2026-07-28-legacy-retirement.md`, "主导会话裁定"
// point 1): the patch this module guards deletes the `mcp` (16),
// `syncEditSessions` (8) and 9-of-10 non-`globalCompositeBar` `authAccount`
// debt-source tokens' `import`/`class`/`registerSingleton` three-part
// registration from `@codingame/monaco-vscode-api`'s `missing-services.js`,
// and the matching `export { X } from 'Y'` re-export line from that same
// package's `services.js` (a *second*, independent reachability path into the
// bundle this slice discovered empirically — deleting only the
// `missing-services.js` copy left every one of these files in the real
// `dist` output, because `services.js`'s own re-export line keeps the
// underlying vendor file reachable regardless of whether
// `missing-services.js` still registers anything against it).
//
// `scripts/plain/workbench-patch-contracts.mjs` already locks the *patch
// file's own bytes* (sha256) and its diff/hunk-header shape. That catches "a
// human or agent hand-edited the `.patch` file (or ran `pnpm patch-commit`
// with unintended changes) without updating the audited hash" — but it does
// **not** catch "a future `@codingame/monaco-vscode-api` version bump changed
// `missing-services.js`/`services.js` enough that the patch either fails to
// apply (a hard, loud pnpm-install error — already a strong existing
// safeguard) or, worse, applies with fuzz/coincidental context match and
// silently produces a *semantically* wrong result" — e.g. the patch happens
// to still apply because nearby context lines match, but the specific
// tokens this slice assumed gone have crept back in via a differently-shaped
// registration this patch's exact line-range deletions never touch.
//
// This module is the "the shape hasn't drifted out from under our
// assumptions" contract the "主导会话裁定" point 1 requires for every new
// patch hunk. It asserts against the *patched, currently-installed* file
// content (not the pristine upstream source) for two reasons: (a) the
// pristine pre-patch source isn't persisted anywhere inside the repo or
// workspace once `pnpm patch-commit` completes, only the diff is; (b) what
// actually matters for correctness is the shape of what ends up running, not
// what the patch's diff context happens to look like.
//
// What this **can** prove: none of the removed tokens are reachable through
// either of the two files this patch touches, and the one token this slice
// deliberately keeps bound (`IAuthenticationService`, required by
// `globalCompositeBar.js`'s non-optional constructor dependency — see that
// module's own audit trail) is still registered.
//
// What this **cannot** prove: that some *third*, not-yet-discovered
// reachability path (a future vendor file added by an upstream version bump,
// or a currently-dead file this slice never had reason to inspect) doesn't
// independently resurrect one of these tokens. That residual risk is exactly
// what `scripts/plain/check-bundle.mjs`'s per-category ratchet ceilings exist
// to catch at the full-bundle level — this module is a faster, more directly
// diagnostic *first* line of defense (runs against `node_modules` during
// `check:architecture`, no `vite build` required, and names the exact token
// instead of a bare category-count delta), not a replacement for the ratchet.

export const REMOVED_MISSING_SERVICES_TOKENS = Object.freeze([
	// mcp (12 registrations; the other 4 mcp debt files —
	// mcpManagement.js, mcpManagementIpc.js, mcpManagementService.js,
	// modelContextProtocol.js — were never separately registered, only
	// pulled in transitively by these tokens' registrations)
	"IMcpGalleryService",
	"IAllowedMcpServersService",
	"IMcpResourceScannerService",
	"IMcpRegistry",
	"IMcpService",
	"IMcpWorkbenchService",
	"IMcpSamplingService",
	"IMcpElicitationService",
	"IWorkbenchMcpManagementService",
	"IMcpGalleryManifestService",
	"IWorkbenchMcpGatewayService",
	"IMcpSandboxService",
	// syncEditSessions (14 registrations)
	"IIgnoredExtensionsManagementService",
	"IUserDataAutoSyncService",
	"IUserDataSyncEnablementService",
	"IUserDataSyncStoreManagementService",
	"IUserDataSyncStoreService",
	"IUserDataSyncLogService",
	"IUserDataSyncService",
	"IUserDataSyncResourceProviderService",
	"IUserDataSyncLocalStoreService",
	"IUserDataSyncUtilService",
	"IUserDataSyncAccountService",
	"IUserDataSyncMachinesService",
	"IEditSessionsLogService",
	"IEditSessionsStorageService",
	// authAccount (8 of the 9 non-globalCompositeBar registrations —
	// IAuthenticationService, the 9th, is deliberately kept; see below)
	"IAuthenticationAccessService",
	"IAuthenticationMcpAccessService",
	"IAuthenticationMcpService",
	"IAuthenticationMcpUsageService",
	"IAuthenticationUsageService",
	"IAuthenticationExtensionsService",
	"IAuthenticationQueryService",
	"IDynamicAuthenticationProviderStorageService",
]);

// services.js's own `export { X } from 'Y'` facade re-exports every token in
// REMOVED_MISSING_SERVICES_TOKENS too, plus two more names that were never
// part of missing-services.js's own registration set at all:
// - `IMcpManagementService`: the base token `IWorkbenchMcpManagementService`
//   (already in the list above) is derived from via
//   `refineServiceDecorator(IMcpManagementService)` in
//   `mcpWorkbenchManagementService.service.js` — real consumer sweep found no
//   other reachable reference to it once that refinement's own file is gone.
// - `IAuthenticationService` itself: kept *registered* in
//   missing-services.js (see below) but deliberately dropped from this one
//   facade re-export line, since nothing in `app/` ever imports it from the
//   bare `"@codingame/monaco-vscode-api"` package (only from the concrete
//   `vscode/vs/workbench/services/authentication/common/authentication.service`
//   path `globalCompositeBar.js` itself uses) — the underlying file stays
//   reachable regardless of this specific re-export.
export const REMOVED_SERVICES_REEXPORT_TOKENS = Object.freeze([
	...REMOVED_MISSING_SERVICES_TOKENS,
	"IMcpManagementService",
	"IAuthenticationService",
]);

const KEPT_AUTHENTICATION_SERVICE_REGISTRATION =
	/registerSingleton\(\s*IAuthenticationService\s*,\s*AuthenticationService\s*,\s*InstantiationType\.Delayed\s*,?\s*\)/u;

function findReintroducedTokens(source, tokens) {
	const found = [];
	for (const token of tokens) {
		if (new RegExp(`\\b${token}\\b`, "u").test(source)) {
			found.push(token);
		}
	}
	return found;
}

/**
 * Checks the patched, currently-installed `missing-services.js` source for
 * this slice's two shape assumptions: none of the 34 removed tokens have
 * reappeared, and the one deliberately-kept `IAuthenticationService`
 * registration is still present.
 */
export function checkMissingServicesShape(missingServicesSource) {
	const failures = [];
	for (const token of findReintroducedTokens(
		missingServicesSource,
		REMOVED_MISSING_SERVICES_TOKENS,
	)) {
		failures.push(
			`missing-services.js unexpectedly still references ${token} — F110 S2 removed its import/class/registerSingleton registration; either the patch failed to apply as assumed or upstream reintroduced this token through a different registration this patch's exact line ranges never touch`,
		);
	}
	if (!KEPT_AUTHENTICATION_SERVICE_REGISTRATION.test(missingServicesSource)) {
		failures.push(
			"missing-services.js no longer registers IAuthenticationService — this binding is deliberately kept because globalCompositeBar.js injects it as a non-optional constructor dependency (AccountsActivityActionViewItem/SimpleAccountActivityActionViewItem); removing it would leave the token unbound and throw at Activity Bar construction time",
		);
	}
	return failures;
}

/**
 * Checks the patched, currently-installed `services.js` source for this
 * slice's shape assumption: none of the 36 removed re-export tokens (the 34
 * missing-services.js tokens, plus IMcpManagementService and
 * IAuthenticationService) have reappeared as a facade re-export.
 */
export function checkServicesReexportShape(servicesSource) {
	const failures = [];
	for (const token of findReintroducedTokens(
		servicesSource,
		REMOVED_SERVICES_REEXPORT_TOKENS,
	)) {
		failures.push(
			`services.js unexpectedly still re-exports ${token} — F110 S2 removed this facade re-export line; either the patch failed to apply as assumed or upstream reintroduced this token under a different re-export this patch's exact line deletions never touch`,
		);
	}
	return failures;
}

/**
 * Combined entry point `scripts/plain/check-boundaries.mjs` calls against the
 * real, currently-installed (post-patch) file contents.
 */
export function validateMissingServicesPatchShape({
	missingServicesSource,
	servicesSource,
}) {
	return [
		...checkMissingServicesShape(missingServicesSource),
		...checkServicesReexportShape(servicesSource),
	];
}
