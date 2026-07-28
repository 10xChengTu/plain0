import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	classifyDebtSources,
	evaluateBundleBaseline,
	normalizeSource,
} from "./bundle-baseline-contracts.mjs";

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
