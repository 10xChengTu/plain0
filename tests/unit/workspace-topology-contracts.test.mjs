import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	validateWorkspaceTopologyContracts,
	WORKSPACE_TOPOLOGY_CONTRACT_FAILURES,
} from "../../scripts/plain/workspace-topology-contracts.mjs";

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
			if (!entry.isFile() || !/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
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

describe("workspace topology source contracts", () => {
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

	it("accepts the complete production app source authority", () => {
		expect(
			validateWorkspaceTopologyContracts(withAppSources(currentSources())),
		).toEqual([]);
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
		expectFailure(
			mutated("main", (source) =>
				replaceOnce(
					source,
					"createPlainWorkspaceConfigurationProvider();",
					"createPlainWorkspaceConfigurationProvider();\n\tvoid createPlainWorkspaceConfigurationProvider();",
				),
			),
			WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap,
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
				replaceOnce(
					source,
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
