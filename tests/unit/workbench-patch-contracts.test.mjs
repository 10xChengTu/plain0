import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	auditedWorkbenchPatchPaths,
	validateWorkbenchPatchSet,
} from "../../scripts/plain/workbench-patch-contracts.mjs";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

async function baseline() {
	const patchSources = new Map(
		await Promise.all(
			auditedWorkbenchPatchPaths.map(async (patchPath) => [
				patchPath,
				await readFile(path.join(root, patchPath), "utf8"),
			]),
		),
	);
	return {
		workspaceManifest: await readFile(
			path.join(root, "pnpm-workspace.yaml"),
			"utf8",
		),
		lockfile: await readFile(path.join(root, "pnpm-lock.yaml"), "utf8"),
		patchSources,
	};
}

describe("exact Workbench patch contracts", () => {
	it("accepts only the checked-in nine-package patch and lock graph", async () => {
		expect(validateWorkbenchPatchSet(await baseline())).toEqual([]);
	});

	it("pins both Plain no-cache schemes and removes direct file/workspace open surfaces", async () => {
		const input = await baseline();
		const configurationPatch = input.patchSources.get(
			"patches/@codingame__monaco-vscode-configuration-service-override@35.0.1.patch",
		);
		expect(configurationPatch).toContain(
			'[Schemas.file, Schemas.vscodeUserData, Schemas.tmp, "plain-workspace", "plain-workspace-config"]',
		);

		const apiPatch = input.patchSources.get(
			"patches/@codingame__monaco-vscode-api@35.0.1.patch",
		);
		for (const removedSurface of [
			"-registerAction2(OpenFileAction);",
			"-registerAction2(OpenFileFolderAction);",
			"-registerAction2(OpenWorkspaceAction);",
			"-registerAction2(OpenWorkspaceConfigFileAction);",
			"-registerAction2(CloseWorkspaceAction);",
			"-        id: OpenFileAction.ID,",
			"-        id: OpenFileFolderAction.ID,",
			'-    id: "workbench.action.files.openFileFolderInNewWindow",',
			'-    id: "workbench.action.files.openFileInNewWindow",',
			'-    id: "workbench.action.files.openFolderInNewWindow",',
			'-    id: "workbench.action.openWorkspaceInNewWindow",',
			'-            id: "workbench.action.newWindow",',
			"-registerAction2(NewWindowAction);",
			"-    id: ADD_ROOT_FOLDER_COMMAND_ID,",
			"-    id: SET_ROOT_FOLDER_COMMAND_ID,",
			'-    id: "vscode.openFolder",',
			'-    id: "vscode.newWindow",',
			'-    id: "_files.pickFolderAndOpen",',
			'-CommandsRegistry.registerCommand("_files.newWindow", newWindowCommand);',
			'-CommandsRegistry.registerCommand("_files.windowOpen", openWindowCommand);',
			"-async function selectWorkspaceFolders(accessor) {",
			"-import { IWorkspaceEditingService } from '../../services/workspaces/common/workspaceEditing.service.js';",
			"-import { mnemonicButtonLabel } from '../../../base/common/labels.js';",
			"-import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.service.js';",
			"-import { IPathService } from '../../services/path/common/pathService.service.js';",
		]) {
			expect(apiPatch).toContain(removedSurface);
		}
		expect(apiPatch).toContain(
			[
				"+    run(accessor) {",
				"+        const commandService = accessor.get(ICommandService);",
				"+        return commandService.executeCommand(SET_ROOT_FOLDER_COMMAND_ID);",
			].join("\n"),
		);
		expect(apiPatch).toContain(" registerAction2(AddRootFolderAction);");
		expect(apiPatch).toContain(" registerAction2(OpenFolderAction);");
		expect(apiPatch).toContain(
			" registerAction2(OpenFolderViaWorkspaceAction);",
		);
	});

	it("rejects Plain root UPDATED refresh scope broadening and rerouting", async () => {
		const patchPath =
			"patches/@codingame__monaco-vscode-explorer-service-override@35.0.1.patch";
		const mutations = [
			{
				from: "event.rawUpdated.some(resource =>",
				to: "event.rawDeleted.some(resource =>",
			},
			{
				from: 'resource.scheme === "plain-workspace"',
				to: 'resource.scheme !== "plain-workspace"',
			},
			{
				from: 'resource.path === "/"',
				to: 'resource.path.startsWith("/")',
			},
			{
				from: 'resource.query === ""',
				to: "true",
			},
			{
				from: 'resource.fragment === ""',
				to: "true",
			},
		];

		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("keeps handled progress failures on the original promise only", async () => {
		const patchPath =
			"patches/@codingame__monaco-vscode-view-common-service-override@35.0.1.patch";
		const baselineInput = await baseline();
		const baselineSource = baselineInput.patchSources.get(patchPath);
		expect(baselineSource.match(/observeProgressSettlement/gu)).toHaveLength(4);
		expect(baselineSource).toContain(
			"void promise.then(safeCleanup, safeCleanup);",
		);

		for (const mutation of [
			{
				from: "void promise.then(safeCleanup, safeCleanup);",
				to: "void promise.finally(safeCleanup);",
			},
			{
				from: "observeProgressSettlement(this.promise, () => {",
				to: "this.promise.finally(() => {",
			},
			{
				from: "observeProgressSettlement(notificationCleanupPromise, () => {",
				to: "notificationCleanupPromise.finally(() => {",
			},
			{
				from: "observeProgressSettlement(promise, () => {",
				to: "promise.finally(() => {",
			},
		]) {
			const input = await baseline();
			const source = input.patchSources.get(patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("locks incomplete move Paste presentation to two frozen safe errors", async () => {
		const patchPath = "patches/@codingame__monaco-vscode-api@35.0.1.patch";
		const baselineInput = await baseline();
		const baselineSource = baselineInput.patchSources.get(patchPath);
		const pasteStart = baselineSource.indexOf(
			"+function plainMoveFailureMessage(error) {",
		);
		const pasteEnd = baselineSource.indexOf(
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/views/explorerView.js",
			pasteStart,
		);
		expect(pasteStart).toBeGreaterThanOrEqual(0);
		expect(pasteEnd).toBeGreaterThan(pasteStart);
		const pastePatch = baselineSource.slice(pasteStart, pasteEnd);
		expect(pastePatch).toContain(
			"+    if (!(error instanceof Error) || !Object.isFrozen(error)) {",
		);
		expect(pastePatch).toContain(
			'+    if (error.name === "WORKSPACE_MOVE_INCOMPLETE" && error.message === "The workspace move published its target but could not remove all of its source.") {',
		);
		expect(pastePatch).toContain(
			'+    if (error.name === "WORKSPACE_MOVE_OUTCOME_UNKNOWN" && error.message === "The workspace move outcome is unknown. The source and target locations were refreshed; check both locations before continuing.") {',
		);
		expect(pastePatch).toContain(
			"+            notificationService.error(plainMoveMessage);",
		);
		expect(pastePatch).toContain(
			'+                "The file(s) to paste have been deleted or moved since you copied them. {0}",',
		);
		expect(pastePatch).toContain(
			"             await explorerService.setToCopy([], false);",
		);
		expect(pastePatch).not.toContain("Retry");

		for (const mutation of [
			{
				from: "+    if (!(error instanceof Error) || !Object.isFrozen(error)) {",
				to: "+    if (!error) {",
			},
			{
				from: 'error.name === "WORKSPACE_MOVE_INCOMPLETE" && error.message === "The workspace move published its target but could not remove all of its source."',
				to: 'error.message === "The workspace move published its target but could not remove all of its source."',
			},
			{
				from: 'error.name === "WORKSPACE_MOVE_OUTCOME_UNKNOWN" && error.message === "The workspace move outcome is unknown. The source and target locations were refreshed; check both locations before continuing."',
				to: 'error.name === "WORKSPACE_MOVE_OUTCOME_UNKNOWN"',
			},
			{
				from: "+            notificationService.error(plainMoveMessage);",
				to: "+            notificationService.error(getErrorMessage(e));",
			},
			{
				from: '+                "The file(s) to paste have been deleted or moved since you copied them. {0}",',
				to: '+                "Move failed: {0}",',
			},
			{
				from: "             await explorerService.setToCopy([], false);",
				to: "             void pasteShouldMove;",
			},
			{
				from: "+            notificationService.error(plainMoveMessage);",
				to: '+            notificationService.prompt(Severity.Error, plainMoveMessage, [{ label: "Retry", run: () => pasteFileHandler(accessor, fileList) }]);',
			},
		]) {
			const input = await baseline();
			const source = input.patchSources.get(patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("requires both private confirmed-delete transport patches", async () => {
		for (const patchPath of [
			"patches/@codingame__monaco-vscode-base-service-override@35.0.1.patch",
			"patches/@codingame__monaco-vscode-bulk-edit-service-override@35.0.1.patch",
		]) {
			const input = await baseline();
			input.patchSources.delete(patchPath);
			expect(validateWorkbenchPatchSet(input)).toContain(
				"the supplied patch sources must be the exact audited closed set",
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} is missing from the audited patch set`,
			);
		}
	});

	it("rejects confirmed-delete authorization, ordering and no-undo downgrades", async () => {
		const mutations = [
			{
				patchPath: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
				from: "const authorizationHandles = ( new WeakMap());",
				to: "const authorizationHandles = ( new Map());",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-base-service-override@35.0.1.patch",
				from: "await this.fileService.del(operation.resource, plainOptions[index].options);",
				to: "void operation;",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-bulk-edit-service-override@35.0.1.patch",
				from: "const plainDeleteBatch = validatePlainWorkspaceDeleteResourceEditBatch(this._edits);",
				to: "const plainDeleteBatch = false;",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "const isAuthorizedPlainDelete = movePlainWorkspaceDeleteFileServiceAuthorization(options, resource, plainProviderOptions);",
				to: "const isAuthorizedPlainDelete = true;",
			},
		];

		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(mutation.patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				mutation.patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${mutation.patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("rejects a marker-preserving API baseline source downgrade", async () => {
		const input = await baseline();
		const patchPath = "patches/@codingame__monaco-vscode-api@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			input.patchSources
				.get(patchPath)
				.replace('Symbol("plainReadReceipt")', '"plainReadReceipt"'),
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact audited SHA-256`,
		);
	});

	it("rejects an intrinsic-brand bypass even when the receipt marker remains", async () => {
		const input = await baseline();
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			input.patchSources
				.get(patchPath)
				.replace(
					"Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, [])",
					"value.byteLength",
				),
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact audited SHA-256`,
		);
	});

	it("rejects added package files or hunks instead of trusting markers", async () => {
		const input = await baseline();
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		input.patchSources.set(
			patchPath,
			`${input.patchSources.get(patchPath)}diff --git a/extra.js b/extra.js\n@@ -1 +1 @@\n-old\n+new\n`,
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			`${patchPath} differs from its exact package/file/hunk manifest`,
		);
	});

	it("rejects manifest rerouting and stale lock patch hashes", async () => {
		const rerouted = await baseline();
		rerouted.workspaceManifest = rerouted.workspaceManifest.replace(
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
			"patches/@codingame__monaco-vscode-api@35.0.1.patch",
		);
		expect(validateWorkbenchPatchSet(rerouted)).toContain(
			"pnpm-workspace.yaml must map @codingame/monaco-vscode-files-service-override@35.0.1 to its exact audited patch once",
		);

		const stale = await baseline();
		stale.lockfile = stale.lockfile.replace(
			"4639136edb34a2de20a9f24c8d7bfc892c7080e444c997a8290772ce37ac0159",
			"0".repeat(64),
		);
		expect(validateWorkbenchPatchSet(stale)).toContain(
			"pnpm-lock.yaml must pin @codingame/monaco-vscode-files-service-override@35.0.1 to its audited patch hash",
		);
	});

	it("pins the exact unpatched tarball integrity for every patched package", async () => {
		const input = await baseline();
		input.lockfile = input.lockfile.replace(
			"sha512-pJMSRMI0m5Mvx54u6iBGh+iad9KqfICnwAcjswNJOO7Xt1OXm5xILcM32VkMe4UX0YmrGAvYc0WVKWL8I9O4ng==",
			"sha512-AJMSRMI0m5Mvx54u6iBGh+iad9KqfICnwAcjswNJOO7Xt1OXm5xILcM32VkMe4UX0YmrGAvYc0WVKWL8I9O4ng==",
		);
		expect(validateWorkbenchPatchSet(input)).toContain(
			"pnpm-lock.yaml package integrity for @codingame/monaco-vscode-api@35.0.1 must remain the exact audited tarball",
		);
	});

	it("rejects extra patchedDependencies entries in either top-level mapping", async () => {
		const manifestExtra = await baseline();
		manifestExtra.workspaceManifest = manifestExtra.workspaceManifest.replace(
			"patchedDependencies:\n",
			"patchedDependencies:\n  '@example/extra@1.0.0': patches/extra.patch\n",
		);
		expect(validateWorkbenchPatchSet(manifestExtra)).toContain(
			"pnpm-workspace.yaml top-level patchedDependencies must be the exact audited nine-entry closed set",
		);

		const lockExtra = await baseline();
		lockExtra.lockfile = lockExtra.lockfile.replace(
			"patchedDependencies:\n",
			`patchedDependencies:\n  '@example/extra@1.0.0': ${"f".repeat(64)}\n`,
		);
		expect(validateWorkbenchPatchSet(lockExtra)).toContain(
			"pnpm-lock.yaml top-level patchedDependencies must be the exact audited nine-entry closed set",
		);
	});

	it("rejects duplicate patchedDependencies headers", async () => {
		const manifestDuplicate = await baseline();
		manifestDuplicate.workspaceManifest += "\npatchedDependencies:\n";
		expect(validateWorkbenchPatchSet(manifestDuplicate)).toContain(
			"pnpm-workspace.yaml must contain exactly one exact patchedDependencies: header",
		);

		const lockDuplicate = await baseline();
		lockDuplicate.lockfile += "\npatchedDependencies:\n";
		expect(validateWorkbenchPatchSet(lockDuplicate)).toContain(
			"pnpm-lock.yaml must contain exactly one exact patchedDependencies: header",
		);
	});

	it("rejects bare importer and snapshot edges even when comments repeat the hash", async () => {
		const apiHash =
			"14a239c3494de87cc6c9810ab37ce17434b726c20483a4c2d26617f807b37696";
		const importerBare = await baseline();
		importerBare.lockfile = `${importerBare.lockfile.replace(
			`        version: 35.0.1(patch_hash=${apiHash})`,
			"        version: 35.0.1",
		)}\n# patch_hash=${apiHash}\n`;
		expect(validateWorkbenchPatchSet(importerBare)).toContain(
			`pnpm-lock.yaml importer edge for @codingame/monaco-vscode-api must resolve only to 35.0.1(patch_hash=${apiHash})`,
		);

		const snapshotBare = await baseline();
		snapshotBare.lockfile = `${snapshotBare.lockfile.replace(
			`      '@codingame/monaco-vscode-api': 35.0.1(patch_hash=${apiHash})`,
			"      '@codingame/monaco-vscode-api': 35.0.1",
		)}\n# patch_hash=${apiHash}\n`;
		expect(validateWorkbenchPatchSet(snapshotBare)).toContain(
			`pnpm-lock.yaml snapshot graph for @codingame/monaco-vscode-api must use only 35.0.1(patch_hash=${apiHash})`,
		);

		const dialogsBare = await baseline();
		const dialogsSnapshot = `  '@codingame/monaco-vscode-dialogs-service-override@35.0.1':
    dependencies:
      '@codingame/monaco-vscode-api': 35.0.1(patch_hash=${apiHash})`;
		expect(dialogsBare.lockfile).toContain(dialogsSnapshot);
		dialogsBare.lockfile = dialogsBare.lockfile.replace(
			dialogsSnapshot,
			dialogsSnapshot.replace(`35.0.1(patch_hash=${apiHash})`, "35.0.1"),
		);
		expect(validateWorkbenchPatchSet(dialogsBare)).toContain(
			`pnpm-lock.yaml snapshot graph for @codingame/monaco-vscode-api must use only 35.0.1(patch_hash=${apiHash})`,
		);

		const notificationsBare = await baseline();
		const notificationsSnapshot = `  '@codingame/monaco-vscode-notifications-service-override@35.0.1':
    dependencies:
      '@codingame/monaco-vscode-api': 35.0.1(patch_hash=${apiHash})`;
		expect(notificationsBare.lockfile).toContain(notificationsSnapshot);
		notificationsBare.lockfile = notificationsBare.lockfile.replace(
			notificationsSnapshot,
			notificationsSnapshot.replace(`35.0.1(patch_hash=${apiHash})`, "35.0.1"),
		);
		expect(validateWorkbenchPatchSet(notificationsBare)).toContain(
			`pnpm-lock.yaml snapshot graph for @codingame/monaco-vscode-api must use only 35.0.1(patch_hash=${apiHash})`,
		);
	});

	it("rejects escaped double-quoted package keys before semantic graph matching", async () => {
		const escaped = await baseline();
		escaped.lockfile = escaped.lockfile.replace(
			"snapshots:\n",
			'snapshots:\n  "\\x40codingame/monaco-vscode-api@35.0.1": {}\n    dependencies:\n      "\\x40codingame/monaco-vscode-api": 35.0.1\n',
		);
		expect(validateWorkbenchPatchSet(escaped)).toContain(
			"pnpm-lock.yaml snapshots differs from pnpm's canonical YAML grammar",
		);
	});

	it("rejects YAML anchors, aliases, and merge keys in lock graph sections", async () => {
		const anchored = await baseline();
		anchored.lockfile = anchored.lockfile.replace(
			"snapshots:\n",
			"snapshots:\n  hidden: &patched\n    <<: *patched\n",
		);
		expect(validateWorkbenchPatchSet(anchored)).toContain(
			"pnpm-lock.yaml snapshots differs from pnpm's canonical YAML grammar",
		);
	});

	it("rejects single-quoted duplicate top-level protected sections", async () => {
		const lockDuplicate = await baseline();
		lockDuplicate.lockfile +=
			"\n'snapshots':\n  @codingame/monaco-vscode-api@35.0.1: {}\n";
		expect(validateWorkbenchPatchSet(lockDuplicate)).toContain(
			"pnpm-lock.yaml differs from the canonical top-level YAML envelope",
		);

		const manifestDuplicate = await baseline();
		manifestDuplicate.workspaceManifest +=
			"\n'patchedDependencies':\n  '@example/extra@1.0.0': patches/extra.patch\n";
		expect(validateWorkbenchPatchSet(manifestDuplicate)).toContain(
			"pnpm-workspace.yaml differs from the canonical top-level YAML envelope",
		);
	});

	it("rejects double-quoted escaped top-level section names", async () => {
		const escaped = await baseline();
		escaped.lockfile +=
			'\n"\\x73napshots":\n  "\\x40codingame/monaco-vscode-api@35.0.1": {}\n';
		expect(validateWorkbenchPatchSet(escaped)).toContain(
			"pnpm-lock.yaml differs from the canonical top-level YAML envelope",
		);
	});

	it("pins the three Plain baseline sources and the unresolved-save latch", async () => {
		const input = await baseline();
		const apiPatch = input.patchSources.get(
			"patches/@codingame__monaco-vscode-api@35.0.1.patch",
		);
		expect(apiPatch.match(/Symbol\("plainReadReceipt"\)/gu)).toHaveLength(2);
		expect(apiPatch.match(/Symbol\("plainBufferNoBaseline"\)/gu)).toHaveLength(
			2,
		);
		expect(apiPatch.match(/Symbol\("plainWriteReceipt"\)/gu)).toHaveLength(2);
		expect(apiPatch.match(/plainWriteReceipt/gu)).toHaveLength(4);
		expect(apiPatch.match(/plainSaveRequiresReload/gu)).toHaveLength(10);
	});

	it("rejects save-latch, branded-error and bounded-collector downgrades", async () => {
		const mutations = [
			{
				patchPath: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
				from: "this.plainSaveRequiresReload = true;",
				to: "this.plainSaveRequiresReload = false;",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "throw createPlainWorkspaceWriteOutcomeError(result, options);",
				to: "throw new Error(String(result));",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "this.plainWorkspaceWriteFailures.set(plainWorkspaceWriteKey, Object.freeze({",
				to: "void plainWorkspaceWriteKey; Object.freeze({",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "failureAtReadStart?.resourceIdentity === resourceIdentity ? failureAtReadStart : undefined",
				to: "failureAtReadStart",
			},
			{
				patchPath:
					"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
				from: "const buffer = await collectPlainWorkspaceWriteBuffer(bufferOrReadableOrStream, resource, writeFileOptions);",
				to: "const buffer = await streamToBuffer(bufferOrReadableOrStream);",
			},
		];
		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(mutation.patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				mutation.patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${mutation.patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("rejects Plain copy, move and clone routing guard downgrades", async () => {
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		const baselineInput = await baseline();
		const baselineSource = baselineInput.patchSources.get(patchPath);
		expect(
			baselineSource.match(
				/\(\{ source, target \} = snapshotWorkspaceMutationResources\(source, target\)\);/gu,
			),
		).toHaveLength(5);
		const mutations = [
			{
				from: "({ source, target } = snapshotWorkspaceMutationResources(source, target));\n+            const isPlainWorkspaceMutation = classifyPlainWorkspaceMutation(source, target, mode, overwrite);",
				to: "const isPlainWorkspaceMutation = classifyPlainWorkspaceMutation(source, target, mode, overwrite);\n+            ({ source, target } = snapshotWorkspaceMutationResources(source, target));",
			},
			{
				from: "const isPlainWorkspaceMutation = classifyPlainWorkspaceMutation(source, target, mode, overwrite);",
				to: "const isPlainWorkspaceMutation = false;",
			},
			{
				from: 'classifyPlainWorkspaceMutation(source, target, "copy", overwrite);',
				to: "void overwrite;",
			},
			{
				from: 'classifyPlainWorkspaceMutation(source, target, "move", overwrite);',
				to: "void overwrite;",
			},
			{
				from: "const isPlainWorkspaceMutation = classifyPlainWorkspaceMutation(source, target, mode, overwrite);\n+        if (isPlainWorkspaceMutation)",
				to: "const isPlainWorkspaceMutation = false;\n+        if (isPlainWorkspaceMutation)",
			},
			{
				from: "if (!sourceIsPlain || !targetIsPlain) {",
				to: "if (!sourceIsPlain && !targetIsPlain) {",
			},
			{
				from: "if (sourceProvider !== targetProvider) {",
				to: "if (false) {",
			},
			{
				from: 'source.query !== "" || source.fragment !== ""',
				to: "false",
			},
			{
				from: "source.scheme === target.scheme && source.authority === target.authority && source.path === target.path",
				to: "false",
			},
			{
				from: "if (overwrite !== undefined && overwrite !== false) {",
				to: "if (overwrite) {",
			},
			{
				from: "return Object.freeze(snapshot);",
				to: "return snapshot;",
			},
			{
				from: 'validatePlainWorkspaceMutationProviders(sourceProvider, targetProvider, mode);\n+            if (mode === "copy") {',
				to: 'validatePlainWorkspaceMutationProviders(sourceProvider, targetProvider, mode);\n+            await this.exists(target);\n+            if (mode === "copy") {',
			},
			{
				from: "rejectPlainWorkspaceGenericCopy(source, target);",
				to: "void source; void target;",
			},
			{
				from: "rejectPlainWorkspaceGenericCopy(sourceFolder.resource, targetFolder);",
				to: "void sourceFolder; void targetFolder;",
			},
			{
				from: 'classifyPlainWorkspaceMutation(source, target, "clone", undefined);',
				to: "void source; void target;",
			},
			{
				from: "!hasFileFolderCopyCapability(sourceProvider)",
				to: "false",
			},
			{
				from: ' || typeof sourceProvider.copy !== "function"',
				to: "",
			},
			{
				from: 'typeof sourceProvider.rename !== "function"',
				to: "false",
			},
			{
				from: "overwrite: false",
				to: "overwrite",
			},
		];
		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} differs from its exact audited SHA-256`,
			);
		}
	});

	it("rejects Plain create receipt and fallback guard downgrades", async () => {
		const patchPath =
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch";
		const mutations = [
			{
				from: "+            createResource = snapshotPlainWorkspaceCreateResource(resource);",
				to: "+            createResource = resource;",
			},
			{
				from: "+            const createOptions = { overwrite: snapshotPlainWorkspaceCreateOptions(options) };",
				to: "+            const createOptions = options;",
			},
			{
				from: "+            await validatePlainWorkspaceCreateContent(bufferOrReadableOrStream, createResource, createOptions);",
				to: "+            void bufferOrReadableOrStream;",
			},
			{
				from: "+                    await Reflect.apply(create, provider, [createResource]),",
				to: "+                    await provider.writeFile(createResource, bufferOrReadableOrStream, createOptions),",
			},
			{
				from: "+            const fileStat = await this.toFileStat(",
				to: "+            const fileStat = await this.resolve(createResource, { resolveMetadata: true }); void this.toFileStat(",
			},
			{
				from: "+        directory = rejectPlainWorkspaceMkdirp(directory);",
				to: "+        void directory;",
			},
			{
				from: "+    directory = rejectPlainWorkspaceMkdirp(directory);",
				to: "+    void directory;",
			},
			{
				from: "+            const create = plainWorkspaceCreateMethod(provider, true, createOptions);",
				to: "+            const create = provider.mkdir;",
			},
			{
				from: "+            this._onDidRunOperation.fire(( new FileOperationEvent(createResource, FileOperation.CREATE, fileStat)));",
				to: "+            this._onDidRunOperation.fire(( new FileOperationEvent(resource, FileOperation.CREATE)));",
			},
		];

		for (const mutation of mutations) {
			const input = await baseline();
			const source = input.patchSources.get(patchPath);
			expect(source).toContain(mutation.from);
			input.patchSources.set(
				patchPath,
				source.replace(mutation.from, mutation.to),
			);
			expect(validateWorkbenchPatchSet(input)).toContain(
				`${patchPath} differs from its exact audited SHA-256`,
			);
		}
	});
});
