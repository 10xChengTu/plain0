import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	validateCapabilityFiles,
	validateDialogOverrideImportBoundary,
	validateDialogServiceOverride,
	validateDialogSurfaceBoundary,
	validateNotificationOverrideImportBoundary,
	validateFrontendEntrypointScripts,
	validateMainCapability,
	validateTauriApiBoundary,
	validateTauriConfiguration,
	validateTauriConfigurationFiles,
	validateTauriE2EConfiguration,
	validateWorkspaceBrowserFixtureWindowAuthority,
	validateWorkspaceCapabilitiesBoundary,
	validateWorkspaceCopyCommandRegistration,
	validateWorkspaceDeleteBoundary,
	validateWorkspaceDeleteCommandRegistration,
	validateWorkspaceDeleteFailureBrowserFixture,
	validateWorkspaceDeleteTypeScriptBoundary,
	validateWorkspaceMoveBoundary,
	validateWorkspaceMoveCommandRegistration,
	validateWorkspaceMoveFailureBrowserFixture,
	validateWorkspaceProviderBootstrap,
	validateWorkspaceProviderCopyBoundary,
	validateWorkspaceRustBoundary,
	validateWorkspaceVersionedWriteBoundary,
	validateWorkingCopyOverrideImportBoundary,
} from "./boundary-contracts.mjs";
import {
	auditedWorkbenchPatchPaths,
	validateWorkbenchPatchSet,
} from "./workbench-patch-contracts.mjs";
import {
	validateAppHtmlAuthority,
	validateViteResolverAuthority,
	validateWorkspaceTopologyContracts,
} from "./workspace-topology-contracts.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const failures = [];
const fail = (message) => failures.push(message);

const allowedDependencies = new Map([
	["@codingame/monaco-vscode-api", "35.0.1"],
	["@codingame/monaco-vscode-configuration-service-override", "35.0.1"],
	["@codingame/monaco-vscode-dialogs-service-override", "35.0.1"],
	["@codingame/monaco-vscode-explorer-service-override", "35.0.1"],
	["@codingame/monaco-vscode-files-service-override", "35.0.1"],
	["@codingame/monaco-vscode-model-service-override", "35.0.1"],
	["@codingame/monaco-vscode-notifications-service-override", "35.0.1"],
	["@codingame/monaco-vscode-textmate-service-override", "35.0.1"],
	["@codingame/monaco-vscode-theme-defaults-default-extension", "35.0.1"],
	["@codingame/monaco-vscode-theme-service-override", "35.0.1"],
	["@codingame/monaco-vscode-workbench-service-override", "35.0.1"],
	["@codingame/monaco-vscode-working-copy-service-override", "35.0.1"],
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
for (const failure of validateFrontendEntrypointScripts(
	packageDocument.scripts,
)) {
	fail(failure);
}
const viteConfigurationNames = new Set([
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.ts",
	"vite.config.cjs",
	"vite.config.mts",
	"vite.config.cts",
]);
const viteConfigurationEntries = (
	await readdir(root, { withFileTypes: true })
).filter((entry) => viteConfigurationNames.has(entry.name));
if (
	viteConfigurationEntries.length !== 1 ||
	viteConfigurationEntries[0].name !== "vite.config.ts" ||
	!viteConfigurationEntries[0].isFile()
) {
	fail("vite.config.ts must be the only real Vite configuration file");
} else {
	const viteConfigurationSource = await readFile(
		path.join(root, "vite.config.ts"),
		"utf8",
	);
	if (
		!validateViteResolverAuthority(
			viteConfigurationSource,
			viteConfigurationEntries.map(({ name }) => name),
		)
	) {
		fail("vite.config.ts must preserve the fixed static resolver authority");
	}
}

const requiredPatches = new Map([
	[
		"@codingame/monaco-vscode-api@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
			marker: "Plain intentionally has no accounts surface",
		},
	],
	[
		"@codingame/monaco-vscode-base-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-base-service-override@35.0.1.patch",
			marker: "movePlainWorkspaceDeleteWorkingCopyAuthorization",
		},
	],
	[
		"@codingame/monaco-vscode-bulk-edit-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-bulk-edit-service-override@35.0.1.patch",
			marker: "validatePlainWorkspaceDeleteResourceEditBatch",
		},
	],
	[
		"@codingame/monaco-vscode-configuration-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-configuration-service-override@35.0.1.patch",
			marker: '"plain-workspace-config"',
		},
	],
	[
		"@codingame/monaco-vscode-explorer-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-explorer-service-override@35.0.1.patch",
			marker: "event.rawUpdated.some(resource =>",
		},
	],
	[
		"@codingame/monaco-vscode-extensions-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-extensions-service-override@35.0.1.patch",
			marker: "DisabledExtensionHostFactory",
		},
	],
	[
		"@codingame/monaco-vscode-files-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
			marker: "PLAIN_WORKSPACE_INVALID_READ_RECEIPT",
		},
	],
	[
		"@codingame/monaco-vscode-theme-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-theme-service-override@35.0.1.patch",
			marker: "PLAIN_MARKETPLACE_DISABLED",
		},
	],
	[
		"@codingame/monaco-vscode-view-common-service-override@35.0.1",
		{
			file: "patches/@codingame__monaco-vscode-view-common-service-override@35.0.1.patch",
			marker: "Plain keeps the contribution schema constant",
		},
	],
]);

const workspaceManifest = await readFile(
	path.join(root, "pnpm-workspace.yaml"),
	"utf8",
);
const patchSources = new Map();
for (const [dependency, patch] of requiredPatches) {
	if (!workspaceManifest.includes(`'${dependency}': ${patch.file}`)) {
		fail(`pnpm-workspace.yaml must apply the audited patch for ${dependency}`);
	}
	const patchSource = await readFile(path.join(root, patch.file), "utf8");
	patchSources.set(patch.file, patchSource);
	if (!patchSource.includes(patch.marker)) {
		fail(`${patch.file} is missing security marker ${patch.marker}`);
	}
}

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
if (
	auditedWorkbenchPatchPaths.length !== requiredPatches.size ||
	auditedWorkbenchPatchPaths.some((patchPath) => !patchSources.has(patchPath))
) {
	fail("the required and exact-audited Workbench patch sets must match");
} else {
	for (const failure of validateWorkbenchPatchSet({
		workspaceManifest,
		lockfile: lock,
		patchSources,
	})) {
		fail(failure);
	}
}

const forbiddenLockPackages = [
	"@anthropic-ai/",
	"@codingame/monaco-vscode-languages-service-override@",
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

async function walk(directory, onSymbolicLink) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(absolute, onSymbolicLink)));
		} else if (entry.isFile()) {
			files.push(absolute);
		} else if (entry.isSymbolicLink()) {
			onSymbolicLink?.(absolute);
		}
	}
	return files;
}

const appRoot = path.join(root, "app");
const appRootEntry = await lstat(appRoot);
let appFiles = [];
if (appRootEntry.isSymbolicLink() || !appRootEntry.isDirectory()) {
	fail("app must be a real directory, not a symbolic link");
} else {
	const discoveredAppFiles = await walk(appRoot, (file) => {
		fail(`${path.relative(root, file)} must not be a symbolic link`);
	});
	const allowedStaticAppFiles = new Set([
		path.join(appRoot, "index.html"),
		path.join(appRoot, "styles.css"),
	]);
	for (const file of discoveredAppFiles) {
		if (
			!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) &&
			!allowedStaticAppFiles.has(file)
		) {
			fail(`${path.relative(root, file)} is outside the closed app source set`);
		}
	}
	appFiles = discoveredAppFiles.filter((file) =>
		/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file),
	);
	const appHtmlSource = await readFile(
		path.join(appRoot, "index.html"),
		"utf8",
	);
	if (!validateAppHtmlAuthority(appHtmlSource)) {
		fail(
			"app/index.html must expose only the fixed /main.ts module entrypoint",
		);
	}
}
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
	[/\bregisterFileSystemOverlay\b/, "filesystem overlay registration"],
	[/\bregisterHTMLFileSystemProvider\b/, "HTML filesystem registration"],
	[
		/\bregisterCustomProvider\s*\(\s*["']file["']\s*,/,
		"ambient file-scheme provider registration",
	],
	[
		/monaco-vscode-(?:ai|chat|auth|sync|gallery|remote|task|testing|notebook|telemetry|speech|mcp)[^'"]*/,
		"excluded service override",
	],
	[
		/monaco-vscode-languages?-service-override[^'"]*/,
		"language service override",
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
	for (const failure of validateTauriApiBoundary(source, relative)) {
		fail(failure);
	}
	for (const failure of validateDialogOverrideImportBoundary(
		source,
		relative,
	)) {
		fail(failure);
	}
	for (const failure of validateDialogSurfaceBoundary(source, relative)) {
		fail(failure);
	}
	for (const failure of validateNotificationOverrideImportBoundary(
		source,
		relative,
	)) {
		fail(failure);
	}
	for (const failure of validateWorkingCopyOverrideImportBoundary(
		source,
		relative,
	)) {
		fail(failure);
	}
	if (
		relative.replaceAll("\\", "/") !== "app/main.ts" &&
		/\bregisterCustomProvider\s*\(/.test(source)
	) {
		fail(`${relative} registers a custom provider outside app/main.ts`);
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

const appSources = await Promise.all(
	appFiles.map(async (file) => ({
		relativePath: path.relative(root, file),
		source: await readFile(file, "utf8"),
	})),
);
for (const failure of validateWorkspaceDeleteTypeScriptBoundary(appSources)) {
	fail(failure);
}

const mainSource = await readFile(path.join(appRoot, "main.ts"), "utf8");
for (const failure of validateWorkspaceProviderBootstrap(mainSource)) {
	fail(failure);
}
const servicesSource = await readFile(
	path.join(appRoot, "services.ts"),
	"utf8",
);
for (const failure of validateDialogServiceOverride(servicesSource)) {
	fail(failure);
}
const workspaceCommandsSource = await readFile(
	path.join(appRoot, "features/workspace/commands.ts"),
	"utf8",
);
const workspaceProjectionSource = await readFile(
	path.join(appRoot, "features/workspace/workspace-projection.ts"),
	"utf8",
);
const workspaceConfigurationProviderSource = await readFile(
	path.join(appRoot, "features/workspace/workspace-configuration-provider.ts"),
	"utf8",
);
const plainWorkspaceServicesSource = await readFile(
	path.join(appRoot, "services/plain-workspace-services.ts"),
	"utf8",
);
const excludedSurfacesSource = await readFile(
	path.join(appRoot, "excluded-surfaces.ts"),
	"utf8",
);
for (const failure of validateWorkspaceTopologyContracts({
	appSources,
	main: mainSource,
	services: servicesSource,
	commands: workspaceCommandsSource,
	projection: workspaceProjectionSource,
	configurationProvider: workspaceConfigurationProviderSource,
	plainWorkspaceServices: plainWorkspaceServicesSource,
	excludedSurfaces: excludedSurfacesSource,
})) {
	fail(failure);
}
const workspaceProviderSource = await readFile(
	path.join(appRoot, "features/workspace/file-system-provider.ts"),
	"utf8",
);
for (const failure of validateWorkspaceProviderCopyBoundary(
	workspaceProviderSource,
)) {
	fail(failure);
}
const workspaceBrowserFixtureSource = await readFile(
	path.join(root, "tests/browser/workspace.spec.ts"),
	"utf8",
);
for (const failure of validateWorkspaceMoveFailureBrowserFixture(
	workspaceBrowserFixtureSource,
)) {
	fail(failure);
}
for (const failure of validateWorkspaceDeleteFailureBrowserFixture(
	workspaceBrowserFixtureSource,
)) {
	fail(failure);
}
for (const failure of validateWorkspaceBrowserFixtureWindowAuthority(
	workspaceBrowserFixtureSource,
)) {
	fail(failure);
}

const tauriRoot = path.join(root, "src-tauri");
const tauriRootEntries = await readdir(tauriRoot, { withFileTypes: true });
const tauriRootFiles = tauriRootEntries.map((entry) => entry.name);
for (const failure of validateTauriConfigurationFiles(tauriRootFiles)) {
	fail(failure);
}

const expectedTauriConfigurationNames = [
	"tauri.conf.json",
	"tauri.e2e.conf.json",
];
const hasRealTauriConfigurationFiles = expectedTauriConfigurationNames.every(
	(fileName) =>
		tauriRootEntries.some((entry) => entry.name === fileName && entry.isFile()),
);
if (!hasRealTauriConfigurationFiles) {
	for (const fileName of expectedTauriConfigurationNames) {
		if (
			!tauriRootEntries.some(
				(entry) => entry.name === fileName && entry.isFile(),
			)
		) {
			fail(`src-tauri/${fileName} must be a real configuration file`);
		}
	}
} else {
	const tauriConfig = JSON.parse(
		await readFile(path.join(tauriRoot, "tauri.conf.json"), "utf8"),
	);
	for (const failure of validateTauriConfiguration(tauriConfig)) {
		fail(failure);
	}
	const tauriE2EConfig = JSON.parse(
		await readFile(path.join(tauriRoot, "tauri.e2e.conf.json"), "utf8"),
	);
	for (const failure of validateTauriE2EConfiguration(
		tauriConfig,
		tauriE2EConfig,
		packageDocument.scripts?.["tauri:dev:e2e"],
		packageDocument.scripts?.["tauri:build:e2e"],
	)) {
		fail(failure);
	}
}

const capabilitiesRoot = path.join(root, "src-tauri/capabilities");
const capabilityFiles = (
	await readdir(capabilitiesRoot, { withFileTypes: true })
).map((entry) =>
	Object.freeze({
		name: entry.name,
		kind: entry.isFile()
			? "file"
			: entry.isDirectory()
				? "directory"
				: entry.isSymbolicLink()
					? "symlink"
					: "other",
	}),
);
for (const failure of validateCapabilityFiles(capabilityFiles)) {
	fail(failure);
}
const capability = JSON.parse(
	await readFile(path.join(capabilitiesRoot, "main.json"), "utf8"),
);
for (const failure of validateMainCapability(capability)) {
	fail(failure);
}

const cargo = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
let cargoDependencies = [];
let resolvedSha2Features = [];
try {
	const rustcHost = execFileSync("rustc", ["-vV"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).match(/^host: (\S+)$/m)?.[1];
	if (rustcHost === undefined) {
		throw new Error("rustc host metadata is missing");
	}
	const cargoMetadata = JSON.parse(
		execFileSync(
			"cargo",
			[
				"metadata",
				"--locked",
				"--format-version",
				"1",
				"--filter-platform",
				rustcHost,
				"--manifest-path",
				"src-tauri/Cargo.toml",
			],
			{
				cwd: root,
				encoding: "utf8",
				maxBuffer: 16 * 1_024 * 1_024,
				stdio: ["ignore", "pipe", "pipe"],
			},
		),
	);
	const plainPackage = cargoMetadata.packages?.find(
		(packageMetadata) => packageMetadata.name === "plain",
	);
	if (!Array.isArray(plainPackage?.dependencies)) {
		throw new Error("plain package dependency metadata is missing");
	}
	cargoDependencies = plainPackage.dependencies.map(
		({
			name,
			req,
			kind,
			rename,
			target,
			optional,
			uses_default_features,
			features,
		}) => ({
			name,
			req,
			kind,
			rename,
			target,
			optional,
			uses_default_features,
			features,
		}),
	);
	const sha2Packages = cargoMetadata.packages?.filter(
		(packageMetadata) =>
			packageMetadata.name === "sha2" && packageMetadata.version === "0.10.9",
	);
	if (
		sha2Packages?.length !== 1 ||
		!Array.isArray(cargoMetadata.resolve?.nodes)
	) {
		throw new Error("resolved sha2@0.10.9 metadata is missing");
	}
	const sha2Node = cargoMetadata.resolve.nodes.find(
		(node) => node.id === sha2Packages[0].id,
	);
	if (!Array.isArray(sha2Node?.features)) {
		throw new Error("resolved sha2@0.10.9 feature metadata is missing");
	}
	resolvedSha2Features = sha2Node.features;
} catch {
	fail("cargo metadata --locked must describe the Plain dependency graph");
}
for (const plugin of [
	"tauri-plugin-fs",
	"tauri-plugin-shell",
	"tauri-plugin-opener",
]) {
	if (cargo.includes(plugin)) {
		fail(`Cargo.toml contains forbidden broad plugin: ${plugin}`);
	}
}

const rustRoot = path.join(root, "src-tauri/src");
const rustFiles = (await walk(rustRoot)).filter((file) => file.endsWith(".rs"));
const rustSources = await Promise.all(
	rustFiles.map(async (file) => ({
		relativePath: path.relative(root, file),
		source: await readFile(file, "utf8"),
	})),
);
for (const failure of validateWorkspaceRustBoundary(
	cargo,
	rustSources,
	cargoDependencies,
	resolvedSha2Features,
)) {
	fail(failure);
}
for (const failure of validateWorkspaceVersionedWriteBoundary(
	rustSources,
	appSources,
)) {
	fail(failure);
}
for (const failure of validateWorkspaceCapabilitiesBoundary(
	rustSources,
	appSources,
)) {
	fail(failure);
}
for (const failure of validateWorkspaceCopyCommandRegistration(rustSources)) {
	fail(failure);
}
for (const failure of validateWorkspaceMoveCommandRegistration(rustSources)) {
	fail(failure);
}
for (const failure of validateWorkspaceMoveBoundary(rustSources)) {
	fail(failure);
}
for (const failure of validateWorkspaceDeleteCommandRegistration(rustSources)) {
	fail(failure);
}
for (const failure of validateWorkspaceDeleteBoundary(rustSources)) {
	fail(failure);
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
		`architecture: ${appFiles.length} app sources, ${rustSources.length} Rust sources, ${allowedDependencies.size} pinned runtime dependencies, audited DOM dialogs, bounded directory/file/symlink copy, cross-root move, confirmed-delete, PLW1 versioned-write and workspace-capability boundaries, minimum Tauri capability`,
	);
}
