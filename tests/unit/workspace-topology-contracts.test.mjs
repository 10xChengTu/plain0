import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	validateWorkspaceTopologyContracts,
	WORKSPACE_TOPOLOGY_CONTRACT_FAILURES,
} from "../../scripts/plain/workspace-topology-contracts.mjs";

const paths = Object.freeze({
	main: "../../app/main.ts",
	excludedSurfaces: "../../app/excluded-surfaces.ts",
	services: "../../app/services.ts",
	commands: "../../app/features/workspace/commands.ts",
	projection: "../../app/features/workspace/workspace-projection.ts",
	configurationProvider:
		"../../app/features/workspace/workspace-configuration-provider.ts",
	plainWorkspaceServices: "../../app/services/plain-workspace-services.ts",
});

function currentSources() {
	return Object.fromEntries(
		Object.entries(paths).map(([key, path]) => [
			key,
			readFileSync(new URL(path, import.meta.url), "utf8"),
		]),
	);
}

function withAppSources(sources, extraEntries = []) {
	return {
		...sources,
		appSources: [
			...Object.entries(paths).map(([key, path]) => ({
				relativePath: path.replace(/^\.\.\/\.\.\//u, ""),
				source: sources[key],
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
