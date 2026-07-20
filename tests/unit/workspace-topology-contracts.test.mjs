import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	validateAppHtmlAuthority,
	validateViteResolverAuthority,
	validateWorkspaceTopologyContracts,
	WORKSPACE_TOPOLOGY_CONTRACT_FAILURES,
} from "../../scripts/plain/workspace-topology-contracts.mjs";

const productionHtml = readFileSync(
	new URL("../../app/index.html", import.meta.url),
	"utf8",
);
const productionViteConfiguration = readFileSync(
	new URL("../../vite.config.ts", import.meta.url),
	"utf8",
);

const paths = Object.freeze({
	main: "app/main.ts",
	excludedSurfaces: "app/excluded-surfaces.ts",
	services: "app/services.ts",
	commands: "app/features/workspace/commands.ts",
	projection: "app/features/workspace/workspace-projection.ts",
	configurationProvider:
		"app/features/workspace/workspace-configuration-provider.ts",
	plainWorkspaceServices: "app/services/plain-workspace-services.ts",
});

function readProductionAppSources(
	directory = new URL("../../app/", import.meta.url),
	relativeDirectory = "app",
) {
	return readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const relativePath = `${relativeDirectory}/${entry.name}`;
			if (entry.isDirectory()) {
				return readProductionAppSources(
					new URL(`${entry.name}/`, directory),
					relativePath,
				);
			}
			if (!entry.isFile() || !/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(entry.name)) {
				return [];
			}
			return [
				{
					relativePath,
					source: readFileSync(new URL(entry.name, directory), "utf8"),
				},
			];
		});
}

const productionAppSources = Object.freeze(readProductionAppSources());
const productionAppSourceByPath = new Map(
	productionAppSources.map(({ relativePath, source }) => [
		relativePath,
		source,
	]),
);

function currentSources() {
	return Object.fromEntries(
		Object.entries(paths).map(([key, relativePath]) => {
			const source = productionAppSourceByPath.get(relativePath);
			if (source === undefined) {
				throw new Error(`missing production app source: ${relativePath}`);
			}
			return [key, source];
		}),
	);
}

function withAppSources(sources, extraEntries = []) {
	const overrides = new Map(
		Object.entries(paths).map(([key, relativePath]) => [
			relativePath,
			sources[key],
		]),
	);
	return {
		...sources,
		appSources: [
			...productionAppSources.map(({ relativePath, source }) => ({
				relativePath,
				source: overrides.get(relativePath) ?? source,
			})),
			...extraEntries,
		],
	};
}

function mutatedProductionAppSource(relativePath, mutate) {
	const sources = withAppSources(currentSources());
	const current = productionAppSourceByPath.get(relativePath);
	if (current === undefined) {
		throw new Error(`missing production app source: ${relativePath}`);
	}
	const mutatedSource = mutate(current);
	const namedKey = Object.entries(paths).find(
		([, candidate]) => candidate === relativePath,
	)?.[0];
	return {
		...sources,
		...(namedKey === undefined ? {} : { [namedKey]: mutatedSource }),
		appSources: sources.appSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutatedSource }
				: entry,
		),
	};
}

function replaceOnce(source, needle, replacement) {
	const first = source.indexOf(needle);
	expect(
		first,
		`missing hostile-mutation anchor: ${needle}`,
	).toBeGreaterThanOrEqual(0);
	expect(source.indexOf(needle, first + needle.length)).toBe(-1);
	return `${source.slice(0, first)}${replacement}${source.slice(
		first + needle.length,
	)}`;
}

function replaceAfter(source, anchor, needle, replacement) {
	const anchorIndex = source.indexOf(anchor);
	expect(
		anchorIndex,
		`missing hostile-mutation scope: ${anchor}`,
	).toBeGreaterThanOrEqual(0);
	const mutationIndex = source.indexOf(needle, anchorIndex + anchor.length);
	expect(
		mutationIndex,
		`missing hostile-mutation anchor after scope: ${needle}`,
	).toBeGreaterThanOrEqual(0);
	return `${source.slice(0, mutationIndex)}${replacement}${source.slice(
		mutationIndex + needle.length,
	)}`;
}

function moveBefore(source, block, anchor) {
	const withoutBlock = replaceOnce(source, block, "");
	return replaceOnce(withoutBlock, anchor, `${block}${anchor}`);
}

function mutated(key, mutate) {
	const sources = currentSources();
	return { ...sources, [key]: mutate(sources[key]) };
}

function insertBeforePickRoots(source, block) {
	return replaceOnce(
		source,
		"\n\tconst pickRoots =",
		`\n${block}\n\n\tconst pickRoots =`,
	);
}

function expectFailure(sources, failure) {
	expect(validateWorkspaceTopologyContracts(sources)).toContain(failure);
}

function expectMainAuthorityFailure(mutate) {
	expectFailure(
		withAppSources(mutated("main", mutate)),
		WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
	);
}

describe("workspace topology source contracts", () => {
	it("keeps the HTML and Vite module entry authority closed", () => {
		expect(validateAppHtmlAuthority(productionHtml)).toBe(true);
		expect(validateViteResolverAuthority(productionViteConfiguration)).toBe(
			true,
		);
		expect(
			validateViteResolverAuthority(productionViteConfiguration, [
				"vite.config.js",
				"vite.config.ts",
			]),
		).toBe(false);

		for (const html of [
			`${productionHtml}\n<script type="module">void import("./rogue.mts")</script>`,
			replaceOnce(productionHtml, 'src="/main.ts"', 'src="/rogue.jsx"'),
			replaceOnce(
				productionHtml,
				'<script type="module" src="/main.ts"></script>',
				'<!-- <script type="module" src="/main.ts"></script> -->',
			),
			replaceOnce(
				productionHtml,
				'<script type="module" src="/main.ts"></script>',
				'<template><script type="module" src="/main.ts"></script></template>',
			),
			replaceOnce(
				productionHtml,
				'<script type="module" src="/main.ts"></script>',
				'<style><script type="module" src="/main.ts"></script></style>',
			),
			replaceOnce(
				productionHtml,
				'<script type="module" src="/main.ts"></script>',
				'<title><script type="module" src="/main.ts"></script></title>',
			),
			replaceOnce(
				productionHtml,
				"<body>",
				"<body onload=\"void import('./rogue.js')\">",
			),
		]) {
			expect(validateAppHtmlAuthority(html)).toBe(false);
		}

		for (const configuration of [
			replaceOnce(
				productionViteConfiguration,
				"\tclearScreen: false,",
				'\tresolve: { alias: { "@tauri-apps/api/core": "/rogue.mts" } },\n\tclearScreen: false,',
			),
			replaceOnce(
				productionViteConfiguration,
				"\tclearScreen: false,",
				"\tplugins: [],\n\tclearScreen: false,",
			),
		]) {
			expect(validateViteResolverAuthority(configuration)).toBe(false);
		}
	});

	it("accepts the current five topology entrypoints", () => {
		const { plainWorkspaceServices: _implementation, ...sources } =
			currentSources();
		expect(validateWorkspaceTopologyContracts(sources)).toEqual([]);
	});

	it("accepts the current topology together with its fail-closed services", () => {
		expect(validateWorkspaceTopologyContracts(currentSources())).toEqual([]);
	});

	it("keeps the optional service implementation outside fallback app authority", () => {
		const sources = currentSources();
		expect(
			validateWorkspaceTopologyContracts({
				...sources,
				plainWorkspaceServices: `${sources.plainWorkspaceServices}\nconst serviceMetadata = { registerCommand: 1 };`,
			}),
		).toEqual([]);
	});

	it("rejects new bare module authority in fallback validation", () => {
		for (const moduleName of ["@tauri-apps/api/core", "#workspace-provider"]) {
			expectFailure(
				mutated(
					"main",
					(source) => `import ${JSON.stringify(moduleName)};\n${source}`,
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}
	});

	it("accepts the complete production app source authority", () => {
		expect(
			validateWorkspaceTopologyContracts(withAppSources(currentSources())),
		).toEqual([]);
	});

	it("requires the root provider producer in complete app authority", () => {
		const sources = withAppSources(currentSources());
		expect(
			validateWorkspaceTopologyContracts({
				...sources,
				appSources: sources.appSources.filter(
					({ relativePath }) =>
						relativePath !== "app/features/workspace/file-system-provider.ts",
				),
			}),
		).toEqual([WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority]);
	});

	it("normalizes Windows separators in the complete app authority", () => {
		const sources = withAppSources(currentSources());
		expect(
			validateWorkspaceTopologyContracts({
				...sources,
				appSources: sources.appSources.map(({ relativePath, source }) => ({
					relativePath: relativePath.replaceAll("/", "\\"),
					source,
				})),
			}),
		).toEqual([]);
	});

	it("rejects normalized duplicate app authority paths", () => {
		for (const relativePath of ["app\\main.ts", "app/./main.ts"]) {
			const sources = withAppSources(currentSources());
			expect(
				validateWorkspaceTopologyContracts({
					...sources,
					appSources: [
						...sources.appSources,
						{ relativePath, source: sources.main },
					],
				}),
			).toEqual([WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority]);
		}
	});

	it("rejects invalid or outside-app authority paths", () => {
		for (const relativePath of [
			"/app/rogue.ts",
			"../app/rogue.ts",
			"app/../../rogue.ts",
		]) {
			const sources = withAppSources(currentSources());
			expect(
				validateWorkspaceTopologyContracts({
					...sources,
					appSources: [
						...sources.appSources,
						{ relativePath, source: "export {};" },
					],
				}),
			).toEqual([WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority]);
		}
	});

	it("rejects named source text that differs from appSources", () => {
		const sources = withAppSources(currentSources());
		expect(
			validateWorkspaceTopologyContracts({
				...sources,
				main: `/* named source mismatch */\n${sources.main}`,
			}),
		).toEqual([WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority]);
	});

	it("allows unrelated object initialize methods in the full app authority", () => {
		expect(
			validateWorkspaceTopologyContracts(
				withAppSources(currentSources(), [
					{
						relativePath: "app/features/terminal/session.ts",
						source: `const terminal = { initialize: () => "ready" };
terminal.initialize();`,
					},
				]),
			),
		).toEqual([]);
	});

	it("allows unrelated provider names without protected value acquisition", () => {
		expect(
			validateWorkspaceTopologyContracts(
				withAppSources(currentSources(), [
					{
						relativePath: "app/features/terminal/provider-names.ts",
						source: `import type { PlainWorkspaceDeleteProvider } from "../workspace/file-system-provider";
const local = {
	registerCustomProvider: () => undefined,
	createPlainWorkspaceFileSystemProvider: () => undefined,
	createPlainWorkspaceConfigurationProvider: () => undefined,
};
function registerCustomProvider(): void {}
local.registerCustomProvider();
local.createPlainWorkspaceConfigurationProvider();
local["createPlainWorkspaceFileSystemProvider"]();
registerCustomProvider();
						void (undefined as PlainWorkspaceDeleteProvider | undefined);`,
					},
					{
						relativePath: "app/features/terminal/file-system-provider.ts",
						source:
							"export function createPlainWorkspaceFileSystemProvider(): void {}",
					},
					{
						relativePath: "app/features/terminal/use-provider.ts",
						source: `import { createPlainWorkspaceFileSystemProvider } from "./file-system-provider";
createPlainWorkspaceFileSystemProvider();`,
					},
				]),
			),
		).toEqual([]);
	});

	it("allows unrelated provider methods inside bootstrap", () => {
		const sources = mutated("main", (source) =>
			replaceOnce(
				source,
				"createPlainWorkspaceConfigurationProvider();",
				`createPlainWorkspaceConfigurationProvider();
	const unrelatedProviders = {
		registerCustomProvider: () => undefined,
		createPlainWorkspaceFileSystemProvider: () => undefined,
		createPlainWorkspaceConfigurationProvider: () => undefined,
	};
	unrelatedProviders.registerCustomProvider();
	unrelatedProviders.createPlainWorkspaceFileSystemProvider();
	unrelatedProviders["createPlainWorkspaceConfigurationProvider"]();`,
			),
		);
		expect(validateWorkspaceTopologyContracts(withAppSources(sources))).toEqual(
			[],
		);
	});

	it("allows transparent wrappers around producer scheme references", () => {
		expect(
			validateWorkspaceTopologyContracts(
				mutatedProductionAppSource(
					"app/features/workspace/file-system-provider.ts",
					(source) =>
						replaceAfter(
							source,
							"private resolveMutationResource(",
							"scheme !== PLAIN_WORKSPACE_SCHEME",
							"scheme !== (PLAIN_WORKSPACE_SCHEME)",
						),
				),
			),
		).toEqual([]);
		expect(
			validateWorkspaceTopologyContracts(
				mutatedProductionAppSource(
					"app/features/workspace/workspace-configuration-provider.ts",
					(source) =>
						replaceOnce(
							source,
							"scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,",
							"scheme: (PLAIN_WORKSPACE_CONFIGURATION_SCHEME),",
						),
				),
			),
		).toEqual([]);
	});

	it("uses AST structure instead of source formatting", () => {
		const sources = currentSources();
		expect(
			validateWorkspaceTopologyContracts({
				...sources,
				main: `/* harmless topology comment */\n${sources.main.replaceAll("\t", "  ")}`,
				projection: sources.projection.replaceAll("\t", "    "),
			}),
		).toEqual([]);
	});

	it("rejects duplicate providers and reversed fixed-scheme registration", () => {
		const duplicateConfigurationFactory = mutated("main", (source) =>
			replaceOnce(
				source,
				"createPlainWorkspaceConfigurationProvider();",
				"createPlainWorkspaceConfigurationProvider();\n\tvoid createPlainWorkspaceConfigurationProvider();",
			),
		);
		expectFailure(
			duplicateConfigurationFactory,
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
		expectFailure(
			withAppSources(duplicateConfigurationFactory),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
					"workspaceConfigurationProvider.clear();\n\tconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
		expectFailure(
			mutated("configurationProvider", (source) =>
				replaceOnce(
					source,
					'"plain-workspace-config" as const',
					'"file" as const',
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.configuration,
		);
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
					"registerCustomProvider(PLAIN_WORKSPACE_CONFIGURATION_SCHEME, workspaceFileSystemProvider);",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
	});

	it("rejects provider binding aliases, bind, shorthand, and parameter escapes", () => {
		for (const escape of [
			"const registerProvider = registerCustomProvider.bind(undefined);\n\tvoid registerProvider;",
			"const makeProvider = createPlainWorkspaceConfigurationProvider;\n\tvoid makeProvider;",
			"void ({ registerCustomProvider });",
			"void Promise.resolve(createPlainWorkspaceFileSystemProvider);",
		]) {
			expectMainAuthorityFailure((source) =>
				replaceOnce(
					source,
					"createPlainWorkspaceConfigurationProvider();",
					`createPlainWorkspaceConfigurationProvider();\n\t${escape}`,
				),
			);
		}
	});

	it("rejects computed provider calls and local shadows of fixed consumers", () => {
		expectMainAuthorityFailure((source) =>
			replaceOnce(
				source,
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				'({ registerCustomProvider })["registerCustomProvider"](PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);',
			),
		);
		for (const [anchor, shadow] of [
			[
				"\tconst workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(",
				"\tconst registerWorkspaceDeleteCoordinator = () => ({ dispose: () => undefined });\n",
			],
			[
				"\tconst workspaceConfigurationProvider =",
				"\tconst createPlainWorkspaceConfigurationProvider = () => ({}) as never;\n",
			],
			[
				"\tconst workspaceTopologyCoordinator = createWorkspaceTopologyCoordinator(",
				"\tconst createWorkspaceTopologyCoordinator = () => ({}) as never;\n",
			],
			[
				"\tregisterCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				'\tconst PLAIN_WORKSPACE_SCHEME = "rogue";\n',
			],
		]) {
			expectMainAuthorityFailure((source) =>
				replaceOnce(source, anchor, `${shadow}${anchor}`),
			);
		}
	});

	it("rejects a bootstrap seam hidden inside an uncalled nested function", () => {
		const sources = mutated("main", (source) =>
			replaceOnce(
				replaceOnce(
					source,
					"async function bootstrap(): Promise<void> {\n",
					"async function bootstrap(): Promise<void> {\n\tasync function neverRun(): Promise<void> {\n",
				),
				"\n}\n\nvoid bootstrap().catch",
				"\n\t}\n\tvoid neverRun;\n}\n\nvoid bootstrap().catch",
			),
		);
		const failures = validateWorkspaceTopologyContracts(
			withAppSources(sources),
		);
		expect(failures).toContain(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap);
		expect(failures).toContain(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority);
	});

	it("invokes the bootstrap binding exactly once", () => {
		expectFailure(
			mutated("main", (source) => `${source}\nvoid bootstrap();\n`),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
	});

	it("rejects namespace, default, alias, and re-export provider acquisition", () => {
		for (const source of [
			`import * as providerModule from "./features/workspace/file-system-provider";
void providerModule;`,
			`import providerModule from "./features/workspace/workspace-configuration-provider";
void providerModule;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "./features/workspace/file-system-provider";
void make;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "./features/workspace/file-system-provider.ts?plain";
void make;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "./features/workspace/file-system-provider.ts#plain";
void make;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "./features/workspace/File-System-Provider";
void make;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "#workspace-provider";
void make;`,
			`import { createPlainWorkspaceFileSystemProvider as make } from "plain-editor/workspace-provider";
void make;`,
			`export { createPlainWorkspaceConfigurationProvider as make } from "./features/workspace/workspace-configuration-provider";`,
			`export { default } from "./features/workspace/workspace-configuration-provider";`,
			`import { PLAIN_WORKSPACE_CONFIGURATION_PATH as configPath } from "./features/workspace/workspace-configuration-provider";
void configPath;`,
			`export { PLAIN_WORKSPACE_CONFIGURATION_PATH as configPath } from "./features/workspace/workspace-configuration-provider";`,
			`export { registerCustomProvider as register } from "@codingame/monaco-vscode-files-service-override";`,
		]) {
			expectFailure(
				withAppSources(currentSources(), [
					{ relativePath: "app/rogue-provider-binding.ts", source },
				]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}
		expectFailure(
			withAppSources(currentSources(), [
				{
					relativePath: "app/rogue-provider-binding.jsx",
					source: `import { createPlainWorkspaceFileSystemProvider as make } from "./features/workspace/file-system-provider";\nvoid make;`,
				},
			]),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects extension and case variants that can preempt audited modules", () => {
		for (const relativePath of [
			"app/features/workspace/file-system-provider",
			"app/features/workspace/file-system-provider.mjs",
			"app/features/workspace/file-system-provider.js",
			"app/features/workspace/file-system-provider.mts",
			"app/features/workspace/File-System-Provider.js",
		]) {
			expectFailure(
				withAppSources(currentSources(), [
					{
						relativePath,
						source: `export const PLAIN_WORKSPACE_SCHEME = "other";\nexport const createPlainWorkspaceFileSystemProvider = () => ({});`,
					},
				]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}
	});

	it("rejects producer-local factory and scheme binding escapes", () => {
		for (const [relativePath, factoryName, schemeName] of [
			[
				"app/features/workspace/file-system-provider.ts",
				"createPlainWorkspaceFileSystemProvider",
				"PLAIN_WORKSPACE_SCHEME",
			],
			[
				"app/features/workspace/workspace-configuration-provider.ts",
				"createPlainWorkspaceConfigurationProvider",
				"PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
			],
		]) {
			for (const append of [
				`\nconst makeAgain = ${factoryName};\nvoid makeAgain;\n`,
				`\nexport { ${factoryName} as createAgain };\n`,
				`\nexport const copiedScheme = ${schemeName};\n`,
			]) {
				expectFailure(
					mutatedProductionAppSource(
						relativePath,
						(source) => `${source}${append}`,
					),
					WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
				);
			}
		}
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					`${replaceOnce(
						source,
						"candidate.scheme === PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
						'candidate.scheme === "plain-workspace-config"',
					)}
function rogueSchemeComparison(candidate: { readonly scheme: string }): boolean {
	return candidate.scheme === PLAIN_WORKSPACE_CONFIGURATION_SCHEME;
}
`,
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) => {
					const extended = replaceOnce(
						source,
						"class PlainWorkspaceConfigurationProviderImpl implements PlainWorkspaceConfigurationProvider",
						`class RogueConfigurationBase {
	constructor() {
		return Object.create(null) as never;
	}
}
class PlainWorkspaceConfigurationProviderImpl extends RogueConfigurationBase implements PlainWorkspaceConfigurationProvider`,
					);
					return replaceAfter(
						extended,
						"class PlainWorkspaceConfigurationProviderImpl",
						"constructor() {",
						"constructor() {\n\t\tsuper();",
					);
				},
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					replaceAfter(
						source,
						"class PlainWorkspaceConfigurationProviderImpl",
						"Object.freeze(this);",
						"Object.freeze(this);\n\t\treturn Object.create(null) as never;",
					),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					replaceOnce(
						replaceOnce(
							source,
							"candidate.scheme === PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
							'candidate.scheme === "plain-workspace-config"',
						),
						"if (!schemeRoot) {",
						"void (candidate.scheme === PLAIN_WORKSPACE_CONFIGURATION_SCHEME);\n\t\tif (!schemeRoot) {",
					),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/file-system-provider.ts",
				(source) => `${replaceAfter(
					replaceAfter(
						source,
						"private resolveMutationResource(",
						"scheme !== PLAIN_WORKSPACE_SCHEME",
						'scheme !== "plain-workspace"',
					),
					"private resolveResource(",
					"resource.scheme !== PLAIN_WORKSPACE_SCHEME",
					'resource.scheme !== "plain-workspace"',
				)}
function decoySchemeOwners(): void {
	class PlainWorkspaceFileSystemProvider {
		resolveMutationResource(scheme: string): boolean {
			return scheme !== PLAIN_WORKSPACE_SCHEME;
		}
		resolveResource(resource: { readonly scheme: string }): boolean {
			return resource.scheme !== PLAIN_WORKSPACE_SCHEME;
		}
	}
	void PlainWorkspaceFileSystemProvider;
}
`,
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					replaceOnce(
						source,
						"Object.freeze(PlainWorkspaceConfigurationProviderImpl.prototype);",
						`function neverFreeze(): void {
	Object.freeze(PlainWorkspaceConfigurationProviderImpl.prototype);
}`,
					),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("locks configuration URI, watch, and bound-file data flow", () => {
		const relativePath =
			"app/features/workspace/workspace-configuration-provider.ts";
		for (const mutate of [
			(source) =>
				replaceOnce(
					source,
					'"/workspace.code-workspace" as const',
					'"/rogue" as const',
				),
			(source) =>
				replaceAfter(
					source,
					"function configurationUri(",
					"return resource;",
					'return URI.from({ scheme: "file", authority: "", path: "/" }, true);',
				),
			(source) =>
				replaceOnce(
					source,
					"const candidate = resourceSnapshot(resource);",
					`const candidate = {
			scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
			authority: "",
			path: "/",
			query: "",
			fragment: "",
		};`,
				),
			(source) =>
				replaceOnce(
					source,
					"\t\tif (!schemeRoot) {",
					`\t\tif (candidate.authority === candidate.authority) {
			return Object.freeze({ dispose(): void {} });
		}
		if (!schemeRoot) {`,
				),
			(source) =>
				replaceOnce(
					source,
					'candidate.path === "/"',
					"candidate.path === candidate.path",
				),
			(source) =>
				replaceOnce(
					source,
					"): InstalledWorkspaceConfiguration | undefined {\n\t\tif (",
					`): InstalledWorkspaceConfiguration | undefined {
		if (candidate.path === candidate.path) {
			return this.#binding?.installed;
		}
		if (`,
				),
			(source) =>
				replaceOnce(
					source,
					"candidate.path !== PLAIN_WORKSPACE_CONFIGURATION_PATH",
					"candidate.path !== candidate.path",
				),
			(source) =>
				replaceOnce(
					source,
					'import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";',
					`import { URI as RealURI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
const URI = {
	from: RealURI.from.bind(RealURI),
};`,
				),
			(source) =>
				`${source}
Reflect.set(URI, "from", () => {
	throw new Error("changed URI factory");
});
`,
			(source) =>
				`${source}
Object.freeze = ((value: unknown) => value) as typeof Object.freeze;
`,
			(source) =>
				`${source}
Reflect.set(FileSystemProviderCapabilities, "FileReadWrite", 0);
`,
		]) {
			expectFailure(
				mutatedProductionAppSource(relativePath, mutate),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}
	});

	it("keeps provider implementation classes module-private and factory-owned", () => {
		for (const [relativePath, moduleName, className] of [
			[
				"app/features/workspace/file-system-provider.ts",
				"file-system-provider",
				"PlainWorkspaceFileSystemProvider",
			],
			[
				"app/features/workspace/workspace-configuration-provider.ts",
				"workspace-configuration-provider",
				"PlainWorkspaceConfigurationProviderImpl",
			],
		]) {
			expectFailure(
				mutatedProductionAppSource(relativePath, (source) =>
					replaceOnce(
						source,
						`class ${className}`,
						`export class ${className}`,
					),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
			expectFailure(
				withAppSources(currentSources(), [
					{
						relativePath: "app/rogue-provider-construction.ts",
						source: `import { ${className} } from "./features/workspace/${moduleName}";\nvoid new ${className}({} as never, {} as never);`,
					},
				]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}

		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					replaceOnce(
						source,
						"return new PlainWorkspaceConfigurationProviderImpl();",
						"new PlainWorkspaceConfigurationProviderImpl();\n\treturn {} as never;",
					),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) => `${source}\nconst Object = globalThis.Object;\n`,
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			mutatedProductionAppSource(
				"app/features/workspace/workspace-configuration-provider.ts",
				(source) =>
					replaceOnce(
						source,
						"return new PlainWorkspaceConfigurationProviderImpl();",
						`if ("always".length > 0) {
		return {} as never;
	}
	return new PlainWorkspaceConfigurationProviderImpl();`,
					),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects provider factory argument drift and lifecycle reordering", () => {
		for (const mutate of [
			(source) =>
				replaceOnce(
					source,
					"createPlainWorkspaceFileSystemProvider(\n\t\tbridge,\n\t\tworkspaceCapabilities,\n\t);",
					"createPlainWorkspaceFileSystemProvider(bridge);",
				),
			(source) =>
				replaceOnce(
					source,
					"createPlainWorkspaceConfigurationProvider();",
					"createPlainWorkspaceConfigurationProvider(bridge);",
				),
			(source) =>
				moveBefore(
					source,
					"\tconst workspaceConfigurationProvider =\n\t\tcreatePlainWorkspaceConfigurationProvider();\n",
					"\tconst workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(",
				),
		]) {
			expectMainAuthorityFailure(mutate);
		}
	});

	it("rejects extra provider calls, reassignment, and instance references", () => {
		for (const [anchor, replacement] of [
			[
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);\n\tregisterCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
			],
			[
				"createPlainWorkspaceConfigurationProvider();",
				"createPlainWorkspaceConfigurationProvider();\n\tregisterCustomProvider = registerCustomProvider;",
			],
			[
				"createPlainWorkspaceConfigurationProvider();",
				"createPlainWorkspaceConfigurationProvider();\n\tvoid PLAIN_WORKSPACE_SCHEME;",
			],
			[
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);\n\tvoid workspaceFileSystemProvider;",
			],
			[
				"registerCustomProvider(\n\t\tPLAIN_WORKSPACE_CONFIGURATION_SCHEME,\n\t\tworkspaceConfigurationProvider,\n\t);",
				"registerCustomProvider(\n\t\tPLAIN_WORKSPACE_CONFIGURATION_SCHEME,\n\t\tworkspaceConfigurationProvider,\n\t);\n\tworkspaceConfigurationProvider = workspaceConfigurationProvider;",
			],
		]) {
			expectMainAuthorityFailure((source) =>
				replaceOnce(source, anchor, replacement),
			);
		}
		expectMainAuthorityFailure((source) =>
			replaceOnce(
				source,
				"const workspaceFileSystemProvider =",
				"let workspaceFileSystemProvider =",
			),
		);
	});

	it("rejects exporting a protected main binding without throwing", () => {
		expectMainAuthorityFailure(
			(source) => `${source}\nexport { registerCustomProvider };\n`,
		);
	});

	it("rejects command injection through initialize or the command holder", () => {
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"await initialize(createServiceOverrides(), container, {\n\t\tproductConfiguration:",
					`await initialize(createServiceOverrides(), container, {
		commands: [{ id: "plain.extra", handler: () => undefined }],
		productConfiguration:`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"await workspaceTopologyCoordinator.completeInitial();\n\tworkspaceCommands =",
					"await workspaceTopologyCoordinator.completeInitial();\n\tworkspaceCommands?.dispose();\n\tworkspaceCommands =",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
	});

	it("rejects mutable configuration events, write surfaces, and late binding", () => {
		expectFailure(
			mutated("configurationProvider", (source) =>
				replaceOnce(
					source,
					"readonly onDidChangeFile: Event<readonly IFileChange[]> = Event.None;",
					"readonly onDidChangeFile: Event<readonly IFileChange[]> = (() => undefined) as never;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.configuration,
		);
		expectFailure(
			mutated("configurationProvider", (source) =>
				replaceAfter(
					source,
					"async copy(",
					"throw noPermissions();",
					"return;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.configuration,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"configurationStore.clear();",
					"configurationStore.install(snapshot);",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.configuration,
		);
	});

	it("rejects alias-acquired provider, command, and dynamic module authority", () => {
		const providerRogue = withAppSources(currentSources(), [
			{
				relativePath: "app/rogue-provider.ts",
				source: `import { registerCustomProvider as register } from "@codingame/monaco-vscode-files-service-override";
import { createPlainWorkspaceConfigurationProvider as make } from "./features/workspace/workspace-configuration-provider";
register("plain-workspace-config", make());`,
			},
		]);
		expectFailure(
			providerRogue,
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);

		const commandRogue = withAppSources(currentSources(), [
			{
				relativePath: "app/rogue-command.ts",
				source: `import { CommandsRegistry as registry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
registry.registerCommand("vscode.newWindow", () => Promise.resolve());`,
			},
		]);
		expectFailure(commandRogue, WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority);

		const namespaceRogues = withAppSources(currentSources(), [
			{
				relativePath: "app/rogue-provider-namespace.ts",
				source: `import * as files from "@codingame/monaco-vscode-files-service-override";
import { createPlainWorkspaceConfigurationProvider as make } from "./features/workspace/workspace-configuration-provider.js";
files.registerCustomProvider("plain-workspace-config", make());`,
			},
			{
				relativePath: "app/rogue-command-namespace.ts",
				source: `import * as commands from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.js";
commands.CommandsRegistry.registerCommand("vscode.newWindow", () => Promise.resolve());`,
			},
		]);
		expectFailure(
			namespaceRogues,
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);

		const lateModule = mutated("main", (source) =>
			replaceOnce(
				source,
				"const surfaceSnapshot = enforceExcludedWorkbenchSurfaces();",
				'await import("./rogue-command");\n\tconst surfaceSnapshot = enforceExcludedWorkbenchSurfaces();',
			),
		);
		expectFailure(
			withAppSources(lateModule),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects CommonJS and outside-app static module acquisition", () => {
		for (const source of [
			`declare const require: (specifier: string) => unknown;
const provider = require("./features/workspace/file-system-provider");
void provider;`,
			`import provider = require("./features/workspace/file-system-provider");
void provider;`,
		]) {
			expectFailure(
				withAppSources(currentSources(), [
					{ relativePath: "app/rogue-commonjs-provider.ts", source },
				]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}

		const reachableRogue = mutated("main", (source) =>
			replaceOnce(
				source,
				'import "@codingame/monaco-vscode-theme-defaults-default-extension";',
				'import "./rogue-relative-provider";\nimport "@codingame/monaco-vscode-theme-defaults-default-extension";',
			),
		);
		expectFailure(
			withAppSources(reachableRogue, [
				{
					relativePath: "app/rogue-relative-provider.ts",
					source: `import { registerCustomProvider as register } from "../node_modules/@codingame/monaco-vscode-files-service-override";
register("plain-workspace", {} as never);`,
				},
			]),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			withAppSources(currentSources(), [
				{
					relativePath: "app/rogue-file-url-provider.ts",
					source: `import { createPlainWorkspaceFileSystemProvider as make } from "file:///workspace/app/features/workspace/file-system-provider.ts";
void make;`,
				},
			]),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("allows import.meta metadata but rejects Vite module glob acquisition", () => {
		expect(
			validateWorkspaceTopologyContracts(
				withAppSources(currentSources(), [
					{
						relativePath: "app/features/terminal/import-meta-env.ts",
						source:
							'import rawFixture from "./fixture.svg?raw";\nvoid rawFixture;\nvoid import.meta.env;',
					},
				]),
			),
		).toEqual([]);

		for (const expression of [
			'import.meta.glob("./features/workspace/file-system-provider.ts", { eager: true })',
			'import.meta.globEager("./features/workspace/file-system-provider.ts")',
			'import.meta["glob"]("./features/workspace/file-system-provider.ts", { eager: true })',
		]) {
			expectFailure(
				withAppSources(currentSources(), [
					{
						relativePath: "app/rogue-import-meta-provider.ts",
						source: `const providerModules = ${expression};\nvoid providerModules;`,
					},
				]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}
	});

	it("rejects every researched upstream command-writer surface", () => {
		for (const entry of [
			{
				relativePath: "app/rogue-action.ts",
				source: `import { registerAction2 } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
registerAction2(class {});`,
			},
			{
				relativePath: "app/rogue-keybinding.ts",
				source: `import { KeybindingsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry";
KeybindingsRegistry.registerCommandAndKeybindingRule({ id: "plain.extra", handler: () => undefined });`,
			},
			{
				relativePath: "app/rogue-alias.ts",
				source: `import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
CommandsRegistry.registerCommandAlias("plain.extra", "noop");`,
			},
			{
				relativePath: "app/rogue-monaco-editor.ts",
				source: `import { editor } from "monaco-editor";
editor.addCommand({ id: "plain.extra", run: () => undefined });`,
			},
			{
				relativePath: "app/rogue-side-effect.ts",
				source: `import "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/actions/workspaceActions";`,
			},
			{
				relativePath: "app/rogue-reused-api.ts",
				source: `import { getService } from "@codingame/monaco-vscode-api";
void getService;`,
			},
			{
				relativePath: "app/rogue-command-service.ts",
				source: `import { ICommandService } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service";
void ICommandService;`,
			},
		]) {
			expectFailure(
				withAppSources(currentSources(), [entry]),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
			);
		}

		const customView = mutated("services", (source) =>
			replaceOnce(
				source,
				'import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";',
				`import getWorkbenchServiceOverride, { registerCustomView } from "@codingame/monaco-vscode-workbench-service-override";
registerCustomView({ id: "plain.extra", name: "Extra", actions: [] });`,
			),
		);
		expectFailure(
			withAppSources(customView),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects a second local workspace-command registrar", () => {
		expectFailure(
			withAppSources(currentSources(), [
				{
					relativePath: "app/rogue-workspace-commands.ts",
					source: `import { registerWorkspaceCommands } from "./features/workspace/commands";
registerWorkspaceCommands({} as never, {} as never, {} as never);`,
				},
			]),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
		expectFailure(
			withAppSources(currentSources(), [
				{
					relativePath: "app/rogue-workspace-namespace.ts",
					source: `import * as workspaceCommands from "./features/workspace/commands.js";
const register = workspaceCommands["registerWorkspace" + "Commands"];
register({} as never, {} as never, {} as never);`,
				},
			]),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects command binding escapes and remapped product commands", () => {
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					"\t];\n\n\treturn {",
					`\t];
\tconst registerAlias = CommandsRegistry.registerCommand.bind(CommandsRegistry);
\tregistrations.push(
\t\tregisterAlias(WORKSPACE_COMMAND_IDS.addRootFolder, () => Promise.resolve()),
\t);

\treturn {`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					"\t];\n\n\treturn {",
					`\t];
	registrations.push(
		CommandsRegistry.registerCommandAlias("plain.extra", "noop"),
	);

	return {`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					"\t];\n\n\treturn {",
					`\t];
\tregistrations.push(
\t\tCommandsRegistry["register" + "Command"](
\t\t\tWORKSPACE_COMMAND_IDS.addRootFolder,
\t\t\t() => Promise.resolve(),
\t\t),
\t);

\treturn {`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					'setRootFolder: "setRootFolder",',
					'setRootFolder: "addRootFolder",',
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
	});

	it("rejects wrapped native command dependencies and shadowed globals", () => {
		expectFailure(
			mutated("commands", (source) =>
				insertBeforePickRoots(
					replaceOnce(
						source,
						"bridge: PlainBridge,",
						"nativeBridge: PlainBridge,",
					),
					`	const bridge = {
		workspacePickRoots: (_mode: "replace" | "add") =>
			nativeBridge.workspacePickRoots("replace"),
	};`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				insertBeforePickRoots(
					replaceOnce(
						source,
						"topologyCoordinator: WorkspaceTopologyCoordinator,",
						"nativeTopologyCoordinator: WorkspaceTopologyCoordinator,",
					),
					`	const topologyCoordinator = {
		runMutation: <T>(task: () => Promise<T>) => task(),
	};
	void nativeTopologyCoordinator;`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				insertBeforePickRoots(
					source,
					`	const Object = {
		freeze: ({ result }: { result: unknown }) => result,
	};`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				insertBeforePickRoots(
					source,
					`	const Promise = {
		reject: () => globalThis.Promise.resolve(),
	};`,
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
	});

	it("rejects early disposal or any extra registrations use", () => {
		for (const statement of [
			"\tregistrations[0]?.dispose();",
			"\tvoid registrations.length;",
		]) {
			expectFailure(
				mutated("commands", (source) =>
					replaceOnce(
						source,
						"\t];\n\n\treturn {",
						`\t];\n${statement}\n\n\treturn {`,
					),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
			);
		}
	});

	it("rejects writes through the excluded-surface command reader", () => {
		const sources = mutated("excludedSurfaces", (source) =>
			replaceOnce(
				source,
				"export function captureWorkbenchSurfaces",
				`const registerAlias = CommandsRegistry.registerCommand.bind(CommandsRegistry);
registerAlias("plain.extra", () => Promise.resolve());

export function captureWorkbenchSurfaces`,
			),
		);
		expectFailure(
			withAppSources(sources),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);

		const indirectSources = mutated("excludedSurfaces", (source) =>
			replaceOnce(
				source,
				"export function captureWorkbenchSurfaces",
				`const keybindings = Registry.as<any>("platform.keybindingsRegistry");
const writerName = ["registerCommand", "AndKeybindingRule"].join("");
keybindings[writerName]({ id: "plain.extra", handler: () => undefined });

export function captureWorkbenchSurfaces`,
			),
		);
		expectFailure(
			withAppSources(indirectSources),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority,
		);
	});

	it("rejects shadowing or reassigning the pick-roots mode closure", () => {
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					"topologyCoordinator.runMutation(async () => {\n\t\t\tconst result",
					'topologyCoordinator.runMutation(async () => {\n\t\t\tconst mode = "replace";\n\t\t\tconst result',
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					replaceOnce(source, "const pickRoots =", "let pickRoots ="),
					"\tconst registrations = [",
					"\tpickRoots = pickRoots;\n\tconst registrations = [",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
	});

	it("rejects weakened remove-root URI authentication", () => {
		for (const [anchor, needle, replacement] of [
			[
				"const PICK_WORKSPACE_FOLDER_COMMAND_ID =",
				'"_workbench.pickWorkspaceFolder"',
				'"_workbench.pickWorkspaceFile"',
			],
			["const UUID_V4_PATTERN =", "-4[0-9a-f]{3}-", "-[0-9a-f]{4}-"],
			[
				"function workspaceRootId",
				"components.scheme !== PLAIN_WORKSPACE_SCHEME",
				'components.scheme !== "file"',
			],
			["function workspaceRootId", 'components.path !== "/"', "false"],
			[
				"function workspaceRootId",
				"structuredClone(resource);",
				"void resource;",
			],
			[
				"function workspaceRootId",
				"descriptor.get !== undefined ||",
				"false ||",
			],
		]) {
			expectFailure(
				mutated("commands", (source) =>
					replaceAfter(source, anchor, needle, replacement),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
			);
		}
	});

	it("rejects unsafe workspace-folder URI extraction", () => {
		for (const [needle, replacement] of [
			[
				'const descriptor = Object.getOwnPropertyDescriptor(folder, "uri");',
				"const descriptor = { value: (folder as { uri?: unknown }).uri };",
			],
			['"uri"', '"u ri"'],
			["return descriptor.value;", "return\n descriptor.value;"],
		]) {
			expectFailure(
				mutated("commands", (source) =>
					replaceAfter(
						source,
						"function workspaceFolderResource",
						needle,
						replacement,
					),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
			);
		}
	});

	it("rejects remapped remove-root handlers", () => {
		for (const [needle, replacement] of [
			[
				"removeRoot(accessor.get(ICommandService), resource)",
				"removeRoot(accessor.get(ICommandService), undefined)",
			],
			[
				"removeRoot(accessor.get(ICommandService), undefined)",
				"removeRoot(accessor.get(ICommandService), accessor)",
			],
		]) {
			expectFailure(
				mutated("commands", (source) =>
					replaceOnce(source, needle, replacement),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
			);
		}
	});

	it("rejects remove-root FIFO, native dispatch, or snapshot weakening", () => {
		for (const [needle, replacement] of [
			[
				"topologyCoordinator.runMutation(async () => {",
				"Promise.resolve().then(async () => {",
			],
			[
				"const snapshot = await bridge.workspaceRemoveRoot(rootId);",
				"const snapshot = await bridge.workspaceSnapshot();",
			],
			[
				"return Object.freeze({ result: undefined, snapshot });",
				"return Object.freeze({ result: undefined, snapshot: undefined });",
			],
		]) {
			expectFailure(
				mutated("commands", (source) =>
					replaceAfter(source, "const removeRoot =", needle, replacement),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
			);
		}
	});

	it("rejects non-FIFO queues and weakened revision conflicts", () => {
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"const pending = queueTail.then(task);",
					"const pending = Promise.resolve().then(task);",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"if (decoded.revision < current.snapshot.revision) {",
					"if (decoded.revision > current.snapshot.revision) {",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
	});

	it("keeps watcher authority owned by accepted topology transitions", () => {
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"(rootIds) => bridge.workspaceReconcileWatchRoots(rootIds),",
					"(rootIds) => void rootIds,",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
		);
		for (const [anchor, needle, replacement] of [
			[
				"prepareInitial(snapshot: WorkspaceSnapshot)",
				"acceptWatcherAuthority(projected);",
				"void projected;",
			],
			[
				"const reinitializeProjectedState = async",
				"acceptWatcherAuthority(projected);",
				"void projected;",
			],
			[
				"if (decoded.revision < current.snapshot.revision)",
				"throw new WorkspaceProjectionConflictError();",
				"acceptWatcherAuthority(current);\n\t\t\tthrow new WorkspaceProjectionConflictError();",
			],
		]) {
			expectFailure(
				mutated("projection", (source) =>
					replaceAfter(source, anchor, needle, replacement),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
			);
		}
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"projected.snapshot.roots.map(({ rootId }) => rootId)",
					"[]",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"acceptWatcherAuthority(projected);\n\t\ttry {\n\t\t\tawait reinitializeWorkspace(projected.projection.identifier);",
					"try {\n\t\t\tawait reinitializeWorkspace(projected.projection.identifier);\n\t\t\tacceptWatcherAuthority(projected);",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
	});

	it("rejects retry or recoverable handling after reinitialize dispatch", () => {
		const scope = "const reinitializeProjectedState = async";
		expectFailure(
			mutated("projection", (source) =>
				replaceAfter(
					source,
					scope,
					"throw failPermanently();",
					"throw new WorkspaceProjectionConflictError();",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceAfter(
					source,
					scope,
					"throw failPermanently();",
					"await loadAuthoritativeSnapshot();\n\t\t\tthrow failPermanently();",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceAfter(
					source,
					"\n\t\tcompleteInitial() {",
					"throw failPermanently();",
					"throw new WorkspaceProjectionConflictError();",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"return reinitializeProjectedState(projected);",
					"try { return await reinitializeProjectedState(projected); } catch { return reinitializeProjectedState(projected); }",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
	});

	it("rejects mutation-response failures that bypass authoritative reconciliation", () => {
		expectFailure(
			mutated("projection", (source) =>
				replaceOnce(
					source,
					"return reconcileRejectedMutation(error);",
					"throw error;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
		expectFailure(
			mutated("projection", (source) =>
				replaceAfter(
					source,
					"const reconcileRejectedMutation = async",
					"await applyInQueue(authoritative);",
					"void authoritative;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
	});

	it("rejects treating an equal-revision topology conflict as recoverable", () => {
		expectFailure(
			mutated("projection", (source) =>
				replaceAfter(
					source,
					"if (decoded.revision === current.snapshot.revision)",
					"throw failPermanently();",
					"return current.projection.identifier;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator,
		);
	});

	it("rejects skipping any adopted topology dimension", () => {
		for (const [needle, replacement] of [
			["adoption.id !== projected.snapshot.workspaceId ||", "false ||"],
			["adoptedConfigPath !== expectedConfigPath ||", "false ||"],
			["adoption.rootUris.some(", "adoption.rootUris.every("],
		]) {
			expectFailure(
				mutated("projection", (source) =>
					replaceOnce(source, needle, replacement),
				),
				WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.adoption,
			);
		}
	});

	it("rejects default or misordered workspace service descriptors", () => {
		expectFailure(
			mutated("services", (source) =>
				replaceOnce(
					source,
					"PlainWorkspaceEditingService,\n\t\t\t[],",
					"PlainWorkspacesService,\n\t\t\t[],",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services,
		);
		expectFailure(
			mutated("services", (source) =>
				moveBefore(
					source,
					"\t\t[IWorkspaceEditingService.toString()]: new SyncDescriptor(\n\t\t\tPlainWorkspaceEditingService,\n\t\t\t[],\n\t\t\ttrue,\n\t\t),\n",
					"\t\t...getWorkbenchServiceOverride(),",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services,
		);
	});

	it("rejects a generic workspace method that no longer fails closed", () => {
		expectFailure(
			mutated("plainWorkspaceServices", (source) =>
				replaceAfter(
					source,
					"addFolders(",
					"return rejectGenericWorkspaceOperation();",
					"return Promise.resolve() as never;",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services,
		);
		expectFailure(
			mutated("plainWorkspaceServices", (source) =>
				replaceAfter(
					source,
					"addRecentlyOpened(",
					"return Promise.resolve();",
					'localStorage.setItem("recent", "persisted");\n\t\treturn Promise.resolve();',
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services,
		);
	});

	it("rejects an expanded command set or a non-rejecting registration", () => {
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					'\t"_files.windowOpen",',
					'\t"_files.windowOpen",\n\t"workbench.action.unsafeGenericWorkspace",',
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(source, 'pickRoots("add"),', 'pickRoots("replace"),'),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceAfter(
					source,
					"...GUARDED_WORKSPACE_COMMAND_IDS.map",
					"Promise.reject(new PlainWorkspaceOperationUnsupportedError())",
					"Promise.resolve()",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceAfter(
					source,
					"const pickRoots =",
					"topologyCoordinator.runMutation(async () => {",
					"Promise.resolve().then(async () => {",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
		expectFailure(
			mutated("commands", (source) =>
				replaceOnce(
					source,
					'result.status === "selected" ? result.snapshot : undefined',
					"undefined",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands,
		);
	});
});
