import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const failures = [];
const fail = (message) => failures.push(message);

const allowedDependencies = new Map([
	["@codingame/monaco-vscode-api", "35.0.1"],
	["@codingame/monaco-vscode-textmate-service-override", "35.0.1"],
	["@codingame/monaco-vscode-theme-defaults-default-extension", "35.0.1"],
	["@codingame/monaco-vscode-theme-service-override", "35.0.1"],
	["@codingame/monaco-vscode-workbench-service-override", "35.0.1"],
	["@tauri-apps/api", "2.11.1"],
	["monaco-editor", "npm:@codingame/monaco-vscode-editor-api@35.0.1"],
]);

const allowedDevDependencies = new Set([
	"@playwright/test",
	"@tauri-apps/cli",
	"@types/node",
	"oxlint",
	"prettier",
	"typescript",
	"vite",
	"vitest",
]);

const packageDocument = JSON.parse(
	await readFile(path.join(root, "package.json"), "utf8"),
);

for (const [dependency, version] of Object.entries(
	packageDocument.dependencies ?? {},
)) {
	if (!allowedDependencies.has(dependency)) {
		fail(
			`package.json has a non-allowlisted runtime dependency: ${dependency}`,
		);
	} else if (allowedDependencies.get(dependency) !== version) {
		fail(
			`package.json must pin ${dependency} to ${allowedDependencies.get(dependency)}`,
		);
	}
}

for (const dependency of allowedDependencies.keys()) {
	if (packageDocument.dependencies?.[dependency] === undefined) {
		fail(`package.json is missing required runtime dependency: ${dependency}`);
	}
}

for (const dependency of Object.keys(packageDocument.devDependencies ?? {})) {
	if (!allowedDevDependencies.has(dependency)) {
		fail(
			`package.json has a non-allowlisted development dependency: ${dependency}`,
		);
	}
}

for (const lifecycleScript of [
	"preinstall",
	"install",
	"postinstall",
	"prepare",
]) {
	if (packageDocument.scripts?.[lifecycleScript] !== undefined) {
		fail(`package.json must not define ${lifecycleScript}`);
	}
}

const lockPath = path.join(root, "pnpm-lock.yaml");
let lock = "";
try {
	lock = await readFile(lockPath, "utf8");
} catch {
	fail("pnpm-lock.yaml is required");
}

const forbiddenLockPackages = [
	"@anthropic-ai/",
	"@github/copilot",
	"@huggingface/transformers",
	"@openai/",
	"@vscode/copilot-api",
	"node-pty@",
	"onnxruntime-node@",
];
for (const forbidden of forbiddenLockPackages) {
	if (lock.includes(forbidden)) {
		fail(`pnpm-lock.yaml contains forbidden package marker: ${forbidden}`);
	}
}
if (/^\s{2}electron@[^:]*:/m.test(lock)) {
	fail("pnpm-lock.yaml contains the Electron runtime");
}

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

const appRoot = path.join(root, "app");
const appFiles = (await walk(appRoot)).filter((file) =>
	/\.(?:ts|tsx|js|mjs)$/.test(file),
);
const forbiddenSourcePatterns = [
	[
		/['"](?:vscode|@codingame\/monaco-vscode-extension-api)['"]/,
		"VS Code extension API",
	],
	[/vscode\/localExtensionHost/, "local Extension Host"],
	[/extensionHost\.worker|extensionHostWorkerMain/, "Extension Host worker"],
	[/ExtensionHostKind/, "ExtensionHostKind"],
	[/enableWorkerExtensionHost\s*:\s*true/, "enabled worker Extension Host"],
	[/setLocalExtensionHost/, "local Extension Host registration"],
	[
		/monaco-vscode-(?:ai|chat|auth|sync|gallery|remote|task|testing|notebook|telemetry|speech|mcp)[^'"]*/,
		"excluded service override",
	],
];

for (const file of appFiles) {
	const relative = path.relative(root, file);
	const source = await readFile(file, "utf8");
	for (const [pattern, label] of forbiddenSourcePatterns) {
		if (pattern.test(source)) {
			fail(`${relative} contains ${label}`);
		}
	}
	if (
		(source.includes("'@tauri-apps/api/core'") ||
			source.includes("'@tauri-apps/api/event'")) &&
		!relative.startsWith(`app${path.sep}platform${path.sep}tauri${path.sep}`)
	) {
		fail(`${relative} bypasses the sole Tauri bridge directory`);
	}
	if (
		source.includes("@codingame/monaco-vscode-api/extensions") &&
		!relative.startsWith(`app${path.sep}features${path.sep}themes${path.sep}`)
	) {
		fail(
			`${relative} registers extension contributions outside the theme importer`,
		);
	}
}

const tauriConfig = JSON.parse(
	await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const security = tauriConfig.app?.security;
if (security?.csp === null || security?.csp === undefined) {
	fail("Tauri production CSP must be explicit and non-null");
}
if (security?.devCsp === null || security?.devCsp === undefined) {
	fail("Tauri development CSP must be explicit and non-null");
}
if (tauriConfig.app?.withGlobalTauri !== false) {
	fail("withGlobalTauri must remain false");
}
if (
	security?.assetProtocol?.enable !== false ||
	security?.assetProtocol?.scope?.length !== 0
) {
	fail("Tauri asset protocol must remain disabled with an empty scope");
}

const capability = JSON.parse(
	await readFile(path.join(root, "src-tauri/capabilities/main.json"), "utf8"),
);
const allowedPermissions = new Set([
	"core:event:allow-listen",
	"core:event:allow-unlisten",
]);
for (const permission of capability.permissions ?? []) {
	if (!allowedPermissions.has(permission)) {
		fail(`main capability has a non-allowlisted permission: ${permission}`);
	}
}

const cargo = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
for (const plugin of [
	"tauri-plugin-fs",
	"tauri-plugin-shell",
	"tauri-plugin-opener",
]) {
	if (cargo.includes(plugin)) {
		fail(`Cargo.toml contains forbidden broad plugin: ${plugin}`);
	}
}

const distRoot = path.join(root, "dist");
try {
	const distFiles = await walk(distRoot);
	for (const file of distFiles) {
		const relative = path.relative(root, file);
		if (/extension.?host/i.test(path.basename(file))) {
			fail(`${relative} is an Extension Host build artifact`);
		}
	}
} catch {
	// A source-only boundary check is useful before the first frontend build.
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`architecture: ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.log(
		`architecture: ${appFiles.length} app sources, ${allowedDependencies.size} pinned runtime dependencies, minimum Tauri capability`,
	);
}
