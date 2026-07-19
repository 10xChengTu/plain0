import { createHash } from "node:crypto";

const PATCH_CONTRACTS = Object.freeze([
	Object.freeze({
		packageName: "@codingame/monaco-vscode-api@35.0.1",
		patchPath: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
		sha256: "b416c3f7a73dc3c72fae55455515b805a180ac154aa4044d698b8a00cd68be62",
		directImporter: true,
		snapshotEdgeCount: 21,
		shape: Object.freeze([
			"diff --git a/services.js b/services.js",
			"@@ -24,7 +24,6 @@ import './vscode/src/vs/workbench/contrib/inlayHints/browser/inlayHintsAccessibi",
			"diff --git a/vscode/src/vs/platform/files/common/files.d.ts b/vscode/src/vs/platform/files/common/files.d.ts",
			"@@ -775,6 +775,40 @@ export declare class FileOperationError extends Error {",
			"diff --git a/vscode/src/vs/platform/files/common/files.js b/vscode/src/vs/platform/files/common/files.js",
			"@@ -346,6 +346,95 @@ var FileOperationResult;",
			"@@ -437,4 +526,4 @@ function getLargeFileConfirmationLimit(arg) {",
			"diff --git a/vscode/src/vs/platform/files/common/plainWorkspaceDelete.d.ts b/vscode/src/vs/platform/files/common/plainWorkspaceDelete.d.ts",
			"@@ -0,0 +1,70 @@",
			"diff --git a/vscode/src/vs/platform/files/common/plainWorkspaceDelete.js b/vscode/src/vs/platform/files/common/plainWorkspaceDelete.js",
			"@@ -0,0 +1,414 @@",
			"diff --git a/vscode/src/vs/workbench/browser/parts/globalCompositeBar.js b/vscode/src/vs/workbench/browser/parts/globalCompositeBar.js",
			"@@ -117,15 +117,7 @@ let GlobalCompositeBar = class GlobalCompositeBar extends Disposable {",
			"@@ -137,30 +129,16 @@ let GlobalCompositeBar = class GlobalCompositeBar extends Disposable {",
			"@@ -732,20 +710,7 @@ let SimpleGlobalActivityActionViewItem = class SimpleGlobalActivityActionViewIte",
			"@@ -756,19 +721,10 @@ function simpleActivityContextMenuActions(storageService, isAccount) {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.js b/vscode/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.js",
			"@@ -5,7 +5,7 @@ import { toErrorMessage } from '../../../../../base/common/errorMessage.js';",
			"@@ -35,10 +35,55 @@ import Severity$1 from '../../../../../base/common/severity.js';",
			"@@ -106,7 +151,14 @@ let TextFileSaveErrorHandler = class TextFileSaveErrorHandler extends Disposable",
			"@@ -331,6 +383,27 @@ class RetrySaveModelAction extends Action {",
			"@@ -431,6 +504,9 @@ async function acceptOrRevertLocalChangesCommand(accessor, resource, accept) {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/fileActions.js b/vscode/src/vs/workbench/contrib/files/browser/fileActions.js",
			"@@ -10,6 +10,7 @@ import { Action } from '../../../../base/common/actions.js';",
			"@@ -99,6 +100,42 @@ async function deleteFiles(",
			"diff --git a/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.js b/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.js",
			"@@ -34,6 +34,57 @@ import { IProgressService } from '../../../../platform/progress/common/progress.",
			"@@ -112,6 +163,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -255,22 +307,30 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -283,10 +343,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -353,7 +413,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -369,7 +429,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -389,7 +449,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -513,6 +573,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -532,6 +596,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -648,7 +716,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -671,11 +739,18 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -687,9 +762,13 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"diff --git a/vscode/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.js b/vscode/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.js",
			"@@ -3,7 +3,7 @@ import { __decorate, __param } from '../../../../../../../external/tslib/tslib.e",
			"@@ -30,6 +30,101 @@ import { IProgressService } from '../../../../platform/progress/common/progress.",
			"@@ -107,6 +202,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -187,22 +283,30 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -213,10 +317,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -273,7 +377,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -289,7 +393,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -309,7 +413,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -404,6 +508,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -423,6 +531,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -567,7 +679,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -591,11 +703,18 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -606,7 +725,38 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -741,9 +891,13 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-base-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-base-service-override@35.0.1.patch",
		sha256: "db541d394346ba2985b5550e2f0faf665a056ac701df25119354bd0b1e3baf4e",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/services/workingCopy/common/workingCopyFileService.js b/vscode/src/vs/workbench/services/workingCopy/common/workingCopyFileService.js",
			"@@ -13,6 +13,20 @@ import { IWorkingCopyService } from '@codingame/monaco-vscode-api/vscode/vs/work",
			"@@ -160,6 +174,51 @@ let WorkingCopyFileService = class WorkingCopyFileService extends Disposable {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-bulk-edit-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-bulk-edit-service-override@35.0.1.patch",
		sha256: "4437c5e441146d5d2f2262cbe8748932a1353ebf48424356fa648d33abf44245",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.js b/vscode/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.js",
			"@@ -11,11 +11,13 @@ import { ILogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/log",
			"@@ -209,6 +211,17 @@ class DeleteEdit {",
			"@@ -231,6 +244,16 @@ let DeleteOperation = class DeleteOperation {",
			"@@ -333,6 +356,7 @@ let BulkFileEdits = class BulkFileEdits {",
			"@@ -384,10 +408,15 @@ let BulkFileEdits = class BulkFileEdits {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-explorer-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-explorer-service-override@35.0.1.patch",
		sha256: "1345cf49b5d4621da51a4c873d6c03f98a02c70bde9d5f747c4ef0e826ab5cc2",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/explorerService.js b/vscode/src/vs/workbench/contrib/files/browser/explorerService.js",
			"@@ -71,7 +71,12 @@ let ExplorerService = class ExplorerService {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-extensions-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-extensions-service-override@35.0.1.patch",
		sha256: "1e3fa68b2e618e1d8031ed3adb95f73be80654854d3607b37cab6ba3b1e0113c",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/index.js b/index.js",
			"@@ -2,7 +2,6 @@",
			"@@ -24,208 +23,42 @@ import { IBrowserWorkbenchEnvironmentService } from '@codingame/monaco-vscode-ap",
			"@@ -290,22 +123,14 @@ CustomBuiltinExtensionsScannerService = __decorate([",
			"diff --git a/vscode/src/vs/workbench/services/extensionManagement/browser/extensionBisect.js b/vscode/src/vs/workbench/services/extensionManagement/browser/extensionBisect.js",
			"@@ -195,6 +195,8 @@ let ExtensionBisectUi = class ExtensionBisectUi {",
			"@@ -351,5 +353,6 @@ registerAction2(class extends Action2 {",
			"diff --git a/vscode/src/vs/workbench/services/extensionManagement/browser/webExtensionsScannerService.js b/vscode/src/vs/workbench/services/extensionManagement/browser/webExtensionsScannerService.js",
			"@@ -1041,7 +1041,8 @@ let WebExtensionsScannerService = class WebExtensionsScannerService extends Disp",
			"diff --git a/vscode/src/vs/workbench/services/extensions/browser/extensionService.js b/vscode/src/vs/workbench/services/extensions/browser/extensionService.js",
			"@@ -20,16 +20,13 @@ import { IWorkspaceContextService } from '@codingame/monaco-vscode-api/vscode/vs",
			"@@ -210,90 +207,8 @@ let BrowserExtensionHostFactory = class BrowserExtensionHostFactory {",
			"diff --git a/vscode/src/vs/workbench/services/extensions/common/extensionHostManager.js b/vscode/src/vs/workbench/services/extensions/common/extensionHostManager.js",
			"@@ -481,6 +481,8 @@ function registerLatencyTestProvider(provider) {",
			"@@ -517,5 +519,6 @@ registerAction2(class MeasureExtHostLatencyAction extends Action2 {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-files-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
		sha256: "4639136edb34a2de20a9f24c8d7bfc892c7080e444c997a8290772ce37ac0159",
		directImporter: true,
		snapshotEdgeCount: 6,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/platform/files/common/fileService.js b/vscode/src/vs/platform/files/common/fileService.js",
			"@@ -9,15 +9,17 @@ import { hash } from '@codingame/monaco-vscode-api/vscode/vs/base/common/hash';",
			"@@ -26,7 +28,771 @@ function resourceForError(resource) {",
			"@@ -81,6 +847,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -266,6 +1033,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -345,8 +1127,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -362,16 +1157,50 @@ let FileService = class FileService extends Disposable {",
			"@@ -383,10 +1212,39 @@ let FileService = class FileService extends Disposable {",
			"@@ -412,6 +1270,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -442,6 +1303,57 @@ let FileService = class FileService extends Disposable {",
			"@@ -559,6 +1471,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -600,6 +1515,57 @@ let FileService = class FileService extends Disposable {",
			"@@ -691,18 +1657,27 @@ let FileService = class FileService extends Disposable {",
			"@@ -717,6 +1692,8 @@ let FileService = class FileService extends Disposable {",
			"@@ -731,6 +1708,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -780,6 +1772,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -794,6 +1787,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -878,21 +1872,56 @@ let FileService = class FileService extends Disposable {",
			"@@ -901,6 +1930,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -952,6 +1984,24 @@ let FileService = class FileService extends Disposable {",
			"@@ -974,6 +2024,8 @@ let FileService = class FileService extends Disposable {",
			"@@ -1154,14 +2206,54 @@ let FileService = class FileService extends Disposable {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-theme-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-theme-service-override@35.0.1.patch",
		sha256: "2f03277b14543f1e3bc2f723ca214543b1b0d2ca1c893a78287ccc34d071a9b5",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/themes/browser/themes.contribution.js b/vscode/src/vs/workbench/contrib/themes/browser/themes.contribution.js",
			"@@ -828,6 +828,8 @@ registerAction2(class extends Action2 {",
			"@@ -871,6 +873,7 @@ registerAction2(class extends Action2 {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-view-common-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-view-common-service-override@35.0.1.patch",
		sha256: "9d6591b1439109dba9a065546df06b69d90c8ae81d4c7cbd5566032f4322fe39",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/api/browser/viewsExtensionPoint.js b/vscode/src/vs/workbench/api/browser/viewsExtensionPoint.js",
			"@@ -19,13 +19,16 @@ import { registerWorkbenchContribution2, WorkbenchPhase } from '@codingame/monac",
		]),
	}),
]);

function patchShape(source) {
	return source
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("diff --git ") || line.startsWith("@@ "));
}

function stripSingleQuotedScalars(line) {
	let inQuote = false;
	let stripped = "";
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === "'") {
			if (inQuote && line[index + 1] === "'") {
				stripped += "  ";
				index += 1;
				continue;
			}
			inQuote = !inQuote;
			stripped += " ";
			continue;
		}
		stripped += inQuote ? " " : character;
	}
	return inQuote ? undefined : stripped;
}

function validateTopLevelYamlEnvelope(
	source,
	label,
	requiredHeaders,
	failures,
) {
	const lines = source.split(/\r?\n/u);
	let invalid = false;
	for (const line of lines) {
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
			continue;
		}
		const stripped = stripSingleQuotedScalars(line);
		const trimmed = line.trimStart();
		const isTopLevel = trimmed.length === line.length;
		if (
			stripped === undefined ||
			line.includes("\t") ||
			line.includes('"') ||
			line.includes("\\") ||
			/[&*!]/u.test(stripped) ||
			stripped.includes("<<:") ||
			stripped.trimStart().startsWith("?") ||
			/^(?:---|\.\.\.)(?:\s|$)/u.test(stripped.trimStart()) ||
			stripped.trimStart().startsWith("%") ||
			(isTopLevel && /^(?:'|"|\{|\[)/u.test(line))
		) {
			invalid = true;
			break;
		}
	}
	for (const header of requiredHeaders) {
		const canonical = `${header}:`;
		const canonicalCount = lines.filter((line) => line === canonical).length;
		const encodedPattern = new RegExp(
			`^(?:${header}\\s*:|'${header}'\\s*:|"${header}"\\s*:)`,
			"u",
		);
		const headerForms = lines.filter((line) =>
			encodedPattern.test(line),
		).length;
		if (canonicalCount !== 1 || headerForms !== 1) {
			invalid = true;
		}
	}
	if (invalid) {
		failures.push(
			`${label} differs from the canonical top-level YAML envelope`,
		);
	}
}

function topLevelSection(source, header, label, failures) {
	const lines = source.split(/\r?\n/u);
	const headerPattern = new RegExp(`^${header}\\s*:`, "u");
	const headerIndexes = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (headerPattern.test(lines[index])) {
			headerIndexes.push(index);
		}
	}
	if (headerIndexes.length !== 1 || lines[headerIndexes[0]] !== `${header}:`) {
		failures.push(`${label} must contain exactly one exact ${header}: header`);
		return [];
	}

	const start = headerIndexes[0] + 1;
	let end = lines.length;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.length > 0 && !/^\s/u.test(line) && !line.startsWith("#")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end);
}

function semanticLines(lines) {
	return lines.filter(
		(line) => line.trim().length > 0 && !line.trimStart().startsWith("#"),
	);
}

const CANONICAL_KEY_PATTERN =
	/^(?:'[A-Za-z0-9@._/+\-(),=]+'|[A-Za-z0-9@._/+\-(),=]+):(?: (.*))?$/u;
const CANONICAL_VALUE_PATTERN =
	/^(?:'[A-Za-z0-9@._/+\-(),=:]+'|[A-Za-z0-9@._/+\-(),=:]+)$/u;
const CANONICAL_LIST_VALUE_PATTERN = /^[A-Za-z0-9@._/+\-(),=]+$/u;

function validateCanonicalSection(
	lines,
	label,
	allowedIndents,
	allowEmptyMapping,
	failures,
) {
	for (const line of lines) {
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
			continue;
		}
		if (
			line.includes("\t") ||
			/(?:["\\&*!?|><]|\[|\])/u.test(line) ||
			line.includes("<<:") ||
			line.includes("#") ||
			line.trimStart().startsWith("---") ||
			line.trimStart().startsWith("...")
		) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const indent = line.length - line.trimStart().length;
		if (!allowedIndents.has(indent) || !line.startsWith(" ".repeat(indent))) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const body = line.slice(indent);
		if (body.startsWith("?")) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		if (body.startsWith("- ")) {
			if (indent !== 6 || !CANONICAL_LIST_VALUE_PATTERN.test(body.slice(2))) {
				failures.push(`${label} differs from pnpm's canonical YAML grammar`);
				return;
			}
			continue;
		}
		const mapping = CANONICAL_KEY_PATTERN.exec(body);
		if (!mapping) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const value = mapping[1];
		if (value === undefined) {
			continue;
		}
		if (value === "{}" && allowEmptyMapping) {
			continue;
		}
		if (/[{}]/u.test(value) || !CANONICAL_VALUE_PATTERN.test(value)) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
	}
}

function exactMappingLines(source, expected, label, failures) {
	const actual = topLevelSection(
		source,
		"patchedDependencies",
		label,
		failures,
	).filter((line) => line.trim().length > 0);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(
			`${label} top-level patchedDependencies must be the exact audited eight-entry closed set`,
		);
	}
	return actual;
}

function packageIdentity(contract) {
	const suffix = "@35.0.1";
	if (!contract.packageName.endsWith(suffix)) {
		throw new Error(
			`unsupported patched package identity: ${contract.packageName}`,
		);
	}
	return {
		alias: contract.packageName.slice(0, -suffix.length),
		version: suffix.slice(1),
		patchedVersion: `35.0.1(patch_hash=${contract.sha256})`,
	};
}

function validateImporterGraph(lines, failures) {
	const importerLines = semanticLines(lines);
	for (const contract of PATCH_CONTRACTS) {
		const { alias, version, patchedVersion } = packageIdentity(contract);
		const keyLine = `      '${alias}':`;
		const relevant = importerLines.filter((line) => line.includes(alias));
		if (!contract.directImporter) {
			if (relevant.length !== 0) {
				failures.push(
					`pnpm-lock.yaml importers must not directly consume ${alias}`,
				);
			}
			continue;
		}

		const index = importerLines.indexOf(keyLine);
		if (
			relevant.length !== 1 ||
			index < 0 ||
			importerLines[index + 1] !== `        specifier: ${version}` ||
			importerLines[index + 2] !== `        version: ${patchedVersion}`
		) {
			failures.push(
				`pnpm-lock.yaml importer edge for ${alias} must resolve only to ${patchedVersion}`,
			);
		}
	}
}

function validateSnapshotGraph(lines, failures) {
	const snapshotLines = semanticLines(lines);
	for (const contract of PATCH_CONTRACTS) {
		const { alias, patchedVersion } = packageIdentity(contract);
		const expectedHeader = `  '${alias}@${patchedVersion}':`;
		const expectedEdge = `      '${alias}': ${patchedVersion}`;
		const relevant = snapshotLines.filter((line) => line.includes(alias));
		const headers = relevant.filter((line) => line.startsWith(`  '${alias}@`));
		const edges = relevant.filter((line) =>
			line.startsWith(`      '${alias}':`),
		);
		if (
			headers.length !== 1 ||
			headers[0] !== expectedHeader ||
			edges.length !== contract.snapshotEdgeCount ||
			edges.some((line) => line !== expectedEdge) ||
			relevant.length !== headers.length + edges.length
		) {
			failures.push(
				`pnpm-lock.yaml snapshot graph for ${alias} must use only ${patchedVersion}`,
			);
		}
	}
}

export function validateWorkbenchPatchSet({
	workspaceManifest,
	lockfile,
	patchSources,
}) {
	const failures = [];
	validateTopLevelYamlEnvelope(
		workspaceManifest,
		"pnpm-workspace.yaml",
		["patchedDependencies"],
		failures,
	);
	validateTopLevelYamlEnvelope(
		lockfile,
		"pnpm-lock.yaml",
		["patchedDependencies", "importers", "snapshots"],
		failures,
	);
	const manifestExpected = PATCH_CONTRACTS.map(
		(contract) => `  '${contract.packageName}': ${contract.patchPath}`,
	);
	const lockExpected = PATCH_CONTRACTS.map(
		(contract) => `  '${contract.packageName}': ${contract.sha256}`,
	);
	const manifestMapping = exactMappingLines(
		workspaceManifest,
		manifestExpected,
		"pnpm-workspace.yaml",
		failures,
	);
	const lockMapping = exactMappingLines(
		lockfile,
		lockExpected,
		"pnpm-lock.yaml",
		failures,
	);
	if (
		patchSources.size !== PATCH_CONTRACTS.length ||
		PATCH_CONTRACTS.some(({ patchPath }) => !patchSources.has(patchPath))
	) {
		failures.push(
			"the supplied patch sources must be the exact audited closed set",
		);
	}

	for (const contract of PATCH_CONTRACTS) {
		const source = patchSources.get(contract.patchPath);
		if (typeof source !== "string") {
			failures.push(
				`${contract.patchPath} is missing from the audited patch set`,
			);
			continue;
		}

		const manifestLine = `  '${contract.packageName}': ${contract.patchPath}`;
		if (manifestMapping.filter((line) => line === manifestLine).length !== 1) {
			failures.push(
				`pnpm-workspace.yaml must map ${contract.packageName} to its exact audited patch once`,
			);
		}

		const digest = createHash("sha256").update(source).digest("hex");
		if (digest !== contract.sha256) {
			failures.push(
				`${contract.patchPath} differs from its exact audited SHA-256`,
			);
		}
		if (JSON.stringify(patchShape(source)) !== JSON.stringify(contract.shape)) {
			failures.push(
				`${contract.patchPath} differs from its exact package/file/hunk manifest`,
			);
		}

		const lockLine = `  '${contract.packageName}': ${contract.sha256}`;
		if (lockMapping.filter((line) => line === lockLine).length !== 1) {
			failures.push(
				`pnpm-lock.yaml must pin ${contract.packageName} to its audited patch hash`,
			);
		}
	}

	const importerSection = topLevelSection(
		lockfile,
		"importers",
		"pnpm-lock.yaml",
		failures,
	);
	const snapshotSection = topLevelSection(
		lockfile,
		"snapshots",
		"pnpm-lock.yaml",
		failures,
	);
	validateCanonicalSection(
		importerSection,
		"pnpm-lock.yaml importers",
		new Set([2, 4, 6, 8]),
		false,
		failures,
	);
	validateCanonicalSection(
		snapshotSection,
		"pnpm-lock.yaml snapshots",
		new Set([2, 4, 6]),
		true,
		failures,
	);
	validateImporterGraph(importerSection, failures);
	validateSnapshotGraph(snapshotSection, failures);

	return failures;
}

export const auditedWorkbenchPatchPaths = Object.freeze(
	PATCH_CONTRACTS.map(({ patchPath }) => patchPath),
);
