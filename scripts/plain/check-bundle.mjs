import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	classifyDebtSources,
	evaluateBundleBaseline,
	normalizeSource,
} from "./bundle-baseline-contracts.mjs";
import { REMOVED_MISSING_SERVICES_TOKENS } from "./missing-services-patch-contract.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const distRoot = path.join(root, "dist");
const failures = [];
const fail = (message) => failures.push(message);
const requiredRuntimeGuard = "PLAIN_EXCLUDED_SURFACE_GUARD_V1";

async function walk(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(absolute)));
		} else if (entry.isFile()) {
			files.push(absolute);
		}
	}
	return files;
}

const forbiddenHostSources = [
	"webWorkerExtensionHost.js",
	"remoteExtensionHost.js",
	"extensionHostWorkerMain.js",
	"localExtensionHost",
	"webWorkerExtensionHostIframe.html",
];

const forbiddenDialogFileSources = [
	"@codingame/monaco-vscode-dialogs-service-override/index.js",
	"/dialogs/browser/abstractFileDialogService.js",
	"/dialogs/browser/fileDialogService.js",
	"/dialogs/browser/simpleFileDialog.js",
];

const forbiddenCommandIds = [
	"extension.bisect.start",
	"extension.bisect.next",
	"extension.bisect.stop",
	"editor.action.measureExtHostLatency",
	"workbench.extensions.action.openInstalledWebExtensionsResource",
	"workbench.action.syncAccountPolicy",
	"workbench.action.showPolicyDiagnostics",
	"workbench.action.browseColorThemesInMarketplace",
];

let distFiles = [];
try {
	distFiles = await walk(distRoot);
} catch {
	fail("dist is missing; run pnpm build:frontend first");
}

for (const file of distFiles) {
	if (/extension.?host/i.test(path.basename(file))) {
		fail(`${path.relative(root, file)} is an Extension Host artifact`);
	}
}

const sources = new Set();
for (const mapFile of distFiles.filter((file) => file.endsWith(".js.map"))) {
	const map = JSON.parse(await readFile(mapFile, "utf8"));
	for (const source of map.sources ?? []) {
		sources.add(normalizeSource(source));
	}
}

for (const source of sources) {
	for (const forbidden of forbiddenHostSources) {
		if (source.includes(forbidden)) {
			fail(`source map contains forbidden host implementation: ${source}`);
		}
	}
	for (const forbidden of forbiddenDialogFileSources) {
		if (source.includes(forbidden)) {
			fail(
				`source map contains unused Web file-dialog implementation: ${source}`,
			);
		}
	}
}

const javascript = (
	await Promise.all(
		distFiles
			.filter((file) => file.endsWith(".js") && !file.endsWith(".js.map"))
			.map((file) => readFile(file, "utf8")),
	)
).join("\n");
if (!javascript.includes(requiredRuntimeGuard)) {
	fail(
		`final bundle is missing runtime surface guard: ${requiredRuntimeGuard}`,
	);
}
for (const command of forbiddenCommandIds) {
	if (javascript.includes(command)) {
		fail(`final bundle registers excluded command: ${command}`);
	}
}

// `F110` S2/S3/S4 (`docs/research/2026-07-28-legacy-retirement.md`, "验收如何
// 证明真的没有了"): the source-map-based `categorize by file path` check
// above only proves a *file* is absent; it does not prove the token
// *strings* it registered aren't lurking somewhere else in the final,
// minified `dist/**/*.js` output under a different reachability path a
// source-map classification pass would miss (e.g. inlined into a
// differently-named chunk). Every removed mcp/syncEditSessions/authAccount/
// chatAgent decorator token name survives minification verbatim as a string
// literal — `createDecorator("IFoo")` always passes its argument as a
// literal, the same reason `forbiddenCommandIds` above works for command
// ids. A handful of tokens `missing-services-patch-contract.mjs` tracks are
// deliberately excluded here, not because this check can't see them but
// because their appearance is already accounted for by
// `docs/bundle-baseline.json`'s explicit per-category floor lists (verified
// by real content inspection, not assumed) as inert leftovers of files this
// slice's own dependency sweep already found a real, independent reason to
// keep — not evidence any removed registration crept back:
//
// - `IAuthenticationService` (F110 S4) is `missing-services.js`'s own removed
//   registration token name, but it never actually disappears from the real
//   bundle. F110 S4's second pass (the `@codingame/monaco-vscode-view-title-bar-service-override`
//   patch) finally made `globalCompositeBar.js` itself fully unreachable —
//   confirmed by a controlled before/after rebuild diff, that file really is
//   gone from the real dist output now — but a *third*, independent real
//   consumer keeps the token's declaring file, `authentication.service.js`,
//   reachable anyway: `@codingame/monaco-vscode-api`'s own
//   `workbench/services/chat/common/chatEntitlementService.js` (already one
//   of the 9 catalogued chatAgent debt sources) statically imports
//   `IAuthenticationService` from `authentication.service.js` and injects it
//   as a non-optional `__param` on its own `ChatEntitlementRequests` class
//   (confirmed by reading the real installed file). This is inert for the
//   same reason `AccountsActivityActionViewItem` was before this slice:
//   `IChatEntitlementService`'s own `registerSingleton` registration was
//   already removed from `missing-services.js` back in F110 S3, so nothing
//   in the running app ever asks the DI container to construct
//   `ChatEntitlementService` — the only class whose constructor could reach
//   `ChatEntitlementRequests` (itself only built lazily off a `this.requests`
//   `Lazy` wrapper that is never forced) — so the token is declared and
//   real-`__param`-referenced, but never actually resolved against a live DI
//   container. See `docs/bundle-baseline.json`'s `categoryNotes.authAccount`
//   for the full discovery story and why this one remaining file was left
//   alone rather than patched further (out of this slice's authorized
//   scope).
// - `IAuthenticationExtensionsService` (S2) is a
//   `createDecorator("IAuthenticationExtensionsService")` call whose result
//   is never assigned to a variable or exported (confirmed by reading the
//   real minified output) inside `authentication.service.js` — the very same
//   file `IAuthenticationService` above keeps reachable, so this co-declared,
//   otherwise-unimported token comes along for the ride regardless.
//
// `IAuthenticationAccessService` (S2) was excluded here until F110 S4's
// second pass: it was the token *declaration* inside
// `authenticationAccessService.service.js`, one of the 5 originally-catalogued
// authAccount debt sources kept alive by `globalCompositeBar.js`'s own real
// import chain. Now that `globalCompositeBar.js` (and, transitively,
// `authenticationAccessService.service.js`) is confirmed fully unreachable —
// real `dist/**/*.js` grep below finds zero matches — this entry was removed
// from the set entirely rather than kept with a stale justification.
// - `SessionType` (S3) has no real occurrence of the removed enum itself —
//   the only substring hits are `chatSessionType`/`matchSessionType`
//   property names (confirmed by reading the real minified output) inside
//   `chatSessionsService.js`, one of the 9 catalogued chatAgent debt sources
//   kept alive by `commandsQuickAccess.js`'s (the Command Palette's) real
//   import chain through `chat/common/constants.js`.
// - `ChatEntitlement` (S3) similarly has no real occurrence of the removed
//   enum — the only substring hits are `quotaChatEntitlement`/
//   `quotaPremiumChatEntitlement` property names inside
//   `chatEntitlementService.js`, kept alive by that same Command Palette
//   chain (`constants.js` imports `ChatEntitlementContextKeys` from it).
// - `Target` (S3) is excluded because it is too generic a bare word to be a
//   reliable content-scan token in the first place: its real hits in the
//   final bundle are an unrelated `ConfigurationTarget`-style enum member
//   (`e.Target=\`Target\``) and the plain English error string "Configuration
//   Target is required..." — neither is the removed `chat/common/promptSyntax/promptTypes.js`
//   `Target` enum, which real content inspection confirmed is genuinely gone.
// - `ToolSet` (S3) is excluded for the same reason: its only real hit is as
//   a substring of `contribLanguageModelToolSets`, an unrelated extension-API
//   proposal-name string, not the removed `languageModelToolsService.js`
//   `ToolSet` class.
// - `IExtensionsProfileScannerService` (F110 S5) is the token *declaration*
//   itself (`createDecorator("IExtensionsProfileScannerService")` inside
//   `platform/extensionManagement/common/extensionsProfileScannerService.service.js`),
//   confirmed by real content inspection (`grep -c` against the built
//   `dist/**/*.js` finds exactly 1 occurrence, matching this one
//   `createDecorator(...)` call site, no other hit). That file is one of the
//   19 catalogued `extensionRuntime` debt sources kept alive by
//   `platform/extensionManagement/common/extensionsScannerService.js`'s own
//   real import chain (see `docs/bundle-baseline.json`'s
//   `categoryNotes.extensionRuntime`) — whole-ES-module semantics mean
//   importing that file's real, reachable `ExtensionManifestTranslator`
//   export also executes its `import { IExtensionsProfileScannerService }`
//   line and every other top-level declaration in the file, even though
//   nothing anywhere in the real bundle ever resolves this specific token
//   against a live DI container (`AbstractExtensionsScannerService`/
//   `ExtensionsScanner`/`CachedExtensionsScanner`, the only three classes
//   that take it as a constructor `__param`, are never `registerSingleton`'d
//   or `createInstance`'d anywhere in the real, currently-bundled corpus).
const KNOWN_INERT_DEBT_TOKEN_STRINGS = new Set([
	"IAuthenticationExtensionsService",
	"IAuthenticationService",
	"SessionType",
	"ChatEntitlement",
	"Target",
	"ToolSet",
	"IExtensionsProfileScannerService",
]);
const forbiddenDebtTokenStrings = REMOVED_MISSING_SERVICES_TOKENS.filter(
	(token) => !KNOWN_INERT_DEBT_TOKEN_STRINGS.has(token),
);
for (const token of forbiddenDebtTokenStrings) {
	if (javascript.includes(token)) {
		fail(`final bundle content contains removed F110 debt token: ${token}`);
	}
}

const sortedSources = [...sources].sort();
const { byCategory, debtSources } = classifyDebtSources(sortedSources);
const actual = {
	sourceCount: sortedSources.length,
	debtSourceCount: debtSources.length,
	categoryCounts: Object.fromEntries(
		Object.entries(byCategory).map(([name, list]) => [name, list.length]),
	),
};

if (process.argv.includes("--print")) {
	console.log(JSON.stringify(actual, null, 2));
} else {
	const baseline = JSON.parse(
		await readFile(path.join(root, "docs/bundle-baseline.json"), "utf8"),
	);
	const { failures: ratchetFailures } = evaluateBundleBaseline(
		sortedSources,
		baseline,
	);
	for (const failure of ratchetFailures) {
		fail(failure);
	}

	const featureDocument = JSON.parse(
		await readFile(path.join(root, "features.json"), "utf8"),
	);
	if (
		featureDocument.features.find((feature) => feature.id === "F110")
			?.status === "complete"
	) {
		if (
			sortedSources.some((source) => source.endsWith("/missing-services.js"))
		) {
			fail(
				"F110 is complete but the transitional missing-services bundle remains",
			);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`bundle: ${failure}`);
	}
	process.exitCode = 1;
} else if (!process.argv.includes("--print")) {
	console.log(
		`bundle: ${actual.sourceCount} sources, ${actual.debtSourceCount} tracked transitional debt sources, no excluded entrypoint`,
	);
}
