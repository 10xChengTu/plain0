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

// `F110` S2 (`docs/research/2026-07-28-legacy-retirement.md`, "验收如何证明真的没有了"):
// the source-map-based `categorize by file path` check above only
// proves a *file* is absent; it does not prove the token *strings* it
// registered aren't lurking somewhere else in the final, minified `dist/**/*.js`
// output under a different reachability path a source-map classification
// pass would miss (e.g. inlined into a differently-named chunk). Every
// removed mcp/syncEditSessions/authAccount decorator token name survives
// minification verbatim as a string literal — `createDecorator("IFoo")`
// always passes its argument as a literal, the same reason
// `forbiddenCommandIds` above works for command ids. Two of the 34 tokens
// `missing-services-patch-contract.mjs` tracks are deliberately excluded
// here, not because this check can't see them but because their appearance
// is already accounted for by `docs/bundle-baseline.json`'s explicit
// `authAccount` floor list (verified by real content inspection, not
// assumed): `IAuthenticationAccessService` is the token *declaration*
// (`const IAuthenticationAccessService = createDecorator(...)`) inside
// `authenticationAccessService.service.js`, one of the 5 catalogued
// authAccount debt sources kept alive by `globalCompositeBar.js`'s own real
// import chain; `IAuthenticationExtensionsService` is a
// `createDecorator("IAuthenticationExtensionsService")` call whose result is
// never assigned to a variable or exported (confirmed by reading the real
// minified output) inside `authentication.service.js`, the file kept for
// `IAuthenticationService`'s sake — both are inert leftovers of files this
// slice's own dependency sweep already found a real reason to keep, not
// evidence any removed registration crept back.
const forbiddenDebtTokenStrings = REMOVED_MISSING_SERVICES_TOKENS.filter(
	(token) =>
		token !== "IAuthenticationAccessService" &&
		token !== "IAuthenticationExtensionsService",
);
for (const token of forbiddenDebtTokenStrings) {
	if (javascript.includes(token)) {
		fail(`final bundle content contains removed F110 S2 debt token: ${token}`);
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
