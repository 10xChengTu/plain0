import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distRoot = path.join(root, "dist");
const failures = [];
const fail = message => failures.push(message);

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

function normalizeSource(source) {
	return source
		.replaceAll("\\", "/")
		.replace(/^.*?node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/")
		.replace(/^(?:\.\.\/)+/, "");
}

const categories = {
	chatAgent: source => /\/(?:chat|inlineChat|agentHost|agentEditorComments)\//i.test(source),
	mcp: source => /\/mcp\//i.test(source),
	authAccount: source =>
		/\/(?:authentication|accounts?)\//i.test(source) || /\/(?:defaultAccount|globalCompositeBar)\.js$/i.test(source),
	syncEditSessions: source => /\/(?:userDataSync|editSessions)\//i.test(source),
	extensionRuntime: source =>
		/\/(?:extensions|extensionManagement|extensionGallery|extensionHost)(?:\/|[A-Z])/i.test(source),
};

const forbiddenHostSources = [
	"webWorkerExtensionHost.js",
	"remoteExtensionHost.js",
	"extensionHostWorkerMain.js",
	"localExtensionHost",
	"webWorkerExtensionHostIframe.html",
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
for (const mapFile of distFiles.filter(file => file.endsWith(".js.map"))) {
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
}

const javascript = (
	await Promise.all(
		distFiles
			.filter(file => file.endsWith(".js") && !file.endsWith(".js.map"))
			.map(file => readFile(file, "utf8")),
	)
).join("\n");
for (const command of forbiddenCommandIds) {
	if (javascript.includes(command)) {
		fail(`final bundle registers excluded command: ${command}`);
	}
}

const sortedSources = [...sources].sort();
const debtSources = sortedSources.filter(source =>
	Object.values(categories).some(matches => matches(source)),
);
const actual = {
	sourceCount: sortedSources.length,
	debtSourceCount: debtSources.length,
	categoryCounts: Object.fromEntries(
		Object.entries(categories).map(([name, matches]) => [
			name,
			sortedSources.filter(matches).length,
		]),
	),
	debtSourceSha256: createHash("sha256").update(debtSources.join("\n")).digest("hex"),
};

if (process.argv.includes("--print")) {
	console.log(JSON.stringify(actual, null, 2));
} else {
	const baseline = JSON.parse(
		await readFile(path.join(root, "docs/bundle-baseline.json"), "utf8"),
	);
	for (const key of ["sourceCount", "debtSourceCount", "debtSourceSha256"]) {
		if (baseline[key] !== actual[key]) {
			fail(`bundle baseline ${key} changed: expected ${baseline[key]}, got ${actual[key]}`);
		}
	}
	for (const [category, count] of Object.entries(actual.categoryCounts)) {
		if (baseline.categoryCounts?.[category] !== count) {
			fail(
				`bundle baseline ${category} changed: expected ${baseline.categoryCounts?.[category]}, got ${count}`,
			);
		}
	}

	const featureDocument = JSON.parse(await readFile(path.join(root, "features.json"), "utf8"));
	if (featureDocument.features.find(feature => feature.id === "F110")?.status === "complete") {
		if (sortedSources.some(source => source.endsWith("/missing-services.js"))) {
			fail("F110 is complete but the transitional missing-services bundle remains");
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
