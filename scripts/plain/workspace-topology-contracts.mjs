import path from "node:path";

import * as ts from "typescript";

export const WORKSPACE_TOPOLOGY_CONTRACT_FAILURES = Object.freeze({
	bootstrap:
		"workspace bootstrap must construct and register the fixed root provider before the fixed configuration provider",
	configuration:
		"workspace configuration projection must install or clear the readonly eventless provider before exposure",
	authority:
		"workspace topology providers, guarded commands, and late module loading must remain a closed app authority",
	coordinator:
		"workspace topology coordinator must serialize FIFO revision transitions and fail permanently after reinitialize dispatch",
	adoption:
		"workspace topology coordinator must verify adopted id, configPath, and ordered rootUris before commit",
	services:
		"Plain workspace service descriptors must override editing and recent-workspace defaults with fail-closed implementations",
	commands:
		"GUARDED_WORKSPACE_COMMAND_IDS must remain the exact closed set registered as stable rejections",
});

export const EXPECTED_GUARDED_WORKSPACE_COMMAND_IDS = Object.freeze([
	"workbench.action.closeFolder",
	"workbench.action.openWorkspace",
	"workbench.action.openWorkspaceConfigFile",
	"workbench.action.openWorkspaceInNewWindow",
	"workbench.action.saveWorkspaceAs",
	"workbench.action.duplicateWorkspaceInNewWindow",
	"workbench.action.files.openFile",
	"workbench.action.files.openFileFolder",
	"workbench.action.files.openFileInNewWindow",
	"workbench.action.newWindow",
	"vscode.openFolder",
	"vscode.newWindow",
	"_files.pickFolderAndOpen",
	"_files.newWindow",
	"_files.windowOpen",
]);

const EXPECTED_APP_BODY =
	'<body> <div id="app"> <div id="workbench" aria-label="Plain 编辑器"></div> <div id="plain-bootstrap-status" role="status">正在启动 Plain…</div> </div> <script type="module" src="/main.ts"></script> </body>';
const EXPECTED_APP_HTML = `<!doctype html> <html lang="zh-CN"> <head> <meta charset="UTF-8" /> <meta name="viewport" content="width=device-width, initial-scale=1.0" /> <meta name="color-scheme" content="dark light" /> <title>Plain</title> </head> ${EXPECTED_APP_BODY} </html>`;

export function validateAppHtmlAuthority(source) {
	if (typeof source !== "string") {
		return false;
	}
	const scriptStarts = source.match(/<script\b/giu) ?? [];
	const scriptEnds = source.match(/<\/script\s*>/giu) ?? [];
	const scriptTags =
		source.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu) ?? [];
	const bodyTags = source.match(/<body\b[^>]*>[\s\S]*?<\/body\s*>/giu) ?? [];
	return (
		scriptStarts.length === 1 &&
		scriptEnds.length === 1 &&
		scriptTags.length === 1 &&
		bodyTags.length === 1 &&
		scriptTags[0].replace(/\s+/gu, " ").trim() ===
			'<script type="module" src="/main.ts"></script>' &&
		bodyTags[0].replace(/\s+/gu, " ").trim() === EXPECTED_APP_BODY &&
		source.replace(/\s+/gu, " ").trim() === EXPECTED_APP_HTML
	);
}

export function validateViteResolverAuthority(
	source,
	configurationFiles = ["vite.config.ts"],
) {
	if (
		typeof source !== "string" ||
		!Array.isArray(configurationFiles) ||
		configurationFiles.length !== 1 ||
		configurationFiles[0] !== "vite.config.ts"
	) {
		return false;
	}
	const sourceFile = parse("vite.config.ts", source);
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		sourceFile.statements.length !== 2
	) {
		return false;
	}
	const [importStatement, exportStatement] = sourceFile.statements;
	const bindings = ts.isImportDeclaration(importStatement)
		? importStatement.importClause?.namedBindings
		: undefined;
	const importElements = ts.isNamedImports(bindings) ? bindings.elements : [];
	if (
		!ts.isImportDeclaration(importStatement) ||
		!ts.isStringLiteralLike(importStatement.moduleSpecifier) ||
		importStatement.moduleSpecifier.text !== "vite" ||
		importStatement.importClause?.isTypeOnly === true ||
		importStatement.importClause?.name !== undefined ||
		!ts.isNamedImports(bindings) ||
		importElements.length !== 1 ||
		importElements[0].isTypeOnly ||
		importElements[0].propertyName !== undefined ||
		importElements[0].name.text !== "defineConfig" ||
		!ts.isExportAssignment(exportStatement) ||
		exportStatement.isExportEquals
	) {
		return false;
	}
	const configCall = unwrapExpression(exportStatement.expression);
	const configCallee = ts.isCallExpression(configCall)
		? unwrapExpression(configCall.expression)
		: undefined;
	const config =
		ts.isCallExpression(configCall) && configCall.arguments.length === 1
			? unwrapExpression(configCall.arguments[0])
			: undefined;
	const stringValue = (expected) => (value) =>
		isExactStringLiteral(value, expected);
	const booleanValue = (kind) => (value) => value.kind === kind;
	const numberValue = (expected) => (value) =>
		ts.isNumericLiteral(value) && value.text === expected;
	return (
		ts.isIdentifier(configCallee) &&
		configCallee.text === "defineConfig" &&
		exactBindingReferences(
			sourceFile,
			analyzeSourceFile(sourceFile),
			"defineConfig",
			[importElements[0].name, configCallee],
		) &&
		hasExactObjectShape(config, [
			["root", stringValue("app")],
			["clearScreen", booleanValue(ts.SyntaxKind.FalseKeyword)],
			[
				"build",
				(value) =>
					hasExactObjectShape(value, [
						["outDir", stringValue("../dist")],
						["emptyOutDir", booleanValue(ts.SyntaxKind.TrueKeyword)],
						["target", stringValue("esnext")],
						["sourcemap", booleanValue(ts.SyntaxKind.TrueKeyword)],
					]),
			],
			[
				"worker",
				(value) => hasExactObjectShape(value, [["format", stringValue("es")]]),
			],
			[
				"server",
				(value) =>
					hasExactObjectShape(value, [
						["host", stringValue("127.0.0.1")],
						["port", numberValue("1420")],
						["strictPort", booleanValue(ts.SyntaxKind.TrueKeyword)],
						[
							"watch",
							(watch) =>
								hasExactObjectShape(watch, [
									[
										"ignored",
										(ignored) =>
											ts.isArrayLiteralExpression(ignored) &&
											ignored.elements.length === 1 &&
											isExactStringLiteral(
												unwrapExpression(ignored.elements[0]),
												"**/src-tauri/**",
											),
									],
								]),
						],
					]),
			],
			[
				"preview",
				(value) =>
					hasExactObjectShape(value, [
						["host", stringValue("127.0.0.1")],
						["port", numberValue("1421")],
						["strictPort", booleanValue(ts.SyntaxKind.TrueKeyword)],
					]),
			],
		])
	);
}

const pickerProductContracts = Object.freeze([
	Object.freeze(["openFolder", "workbench.action.files.openFolder", "replace"]),
	Object.freeze([
		"openFolderViaWorkspace",
		"workbench.action.files.openFolderViaWorkspace",
		"replace",
	]),
	Object.freeze(["setRootFolder", "setRootFolder", "replace"]),
	Object.freeze(["addRootFolder", "addRootFolder", "add"]),
]);
const removeProductContracts = Object.freeze([
	Object.freeze(["removeRootFolder", "removeRootFolder", "resource"]),
	Object.freeze([
		"removeRootFolderViaPicker",
		"workbench.action.removeRootFolder",
		"picker",
	]),
]);
const productContracts = Object.freeze([
	...pickerProductContracts,
	...removeProductContracts,
]);

const COMMAND_REGISTRY_MODULE =
	"@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
const COMMAND_SERVICE_MODULE =
	"@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service";
const URI_MODULE = "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
const MONACO_API_MODULE = "@codingame/monaco-vscode-api/monaco";
const FILES_PROVIDER_OVERRIDE_MODULE =
	"@codingame/monaco-vscode-files-service-override";
const ROOT_PROVIDER_MODULE = "features/workspace/file-system-provider";
const CONFIGURATION_PROVIDER_MODULE =
	"features/workspace/workspace-configuration-provider";
const DIRECT_COMMAND_REGISTRATION_MANIFEST = Object.freeze([
	Object.freeze({
		relativePath: "app/features/workspace/commands.ts",
		count: productContracts.length + 1,
	}),
	Object.freeze({
		relativePath: "app/features/themes/plain-theme-picker.ts",
		count: 3,
	}),
	Object.freeze({
		relativePath: "app/features/themes/plain-theme-commands.ts",
		count: 3,
	}),
	Object.freeze({
		relativePath: "app/features/terminal/plain-terminal-commands.ts",
		count: 4,
	}),
	Object.freeze({
		relativePath: "app/features/scm/plain-scm-commands.ts",
		count: 2,
	}),
	Object.freeze({
		relativePath: "app/features/debug/plain-debug-commands.ts",
		count: 3,
	}),
]);

// The pinned 35.0.1 packages expose deep wildcard modules, including modules
// that register commands at import time. Ownership is therefore part of the
// allowlist key: another app module cannot reuse an otherwise approved import.
const ALLOWED_MONACO_APP_IMPORTS = Object.freeze([
	"app/excluded-surfaces.ts:@codingame/monaco-vscode-api/monaco",
	"app/excluded-surfaces.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions",
	"app/excluded-surfaces.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
	"app/features/scm/git-uri.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/hunk-stage.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/diff/linesDiffComputers",
	"app/features/scm/plain-git-blame-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/plain-git-blame-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service",
	"app/features/scm/plain-git-blame-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/scm/plain-git-blame-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service",
	"app/features/scm/plain-git-blame-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/htmlContent",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/core/position",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/languages",
	"app/features/scm/plain-git-blame.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/scm/plain-git-commit-detail.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/features/scm/plain-git-commit-detail.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/plain-git-commit-detail.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/scm/plain-git-commit-detail.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService",
	"app/features/scm/plain-git-commit-detail.ts:@codingame/monaco-vscode-model-service-override/vscode/vs/editor/common/services/resolverService",
	"app/features/scm/plain-git-content-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/plain-git-content-provider.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/scm/plain-git-content-provider.ts:@codingame/monaco-vscode-model-service-override/vscode/vs/editor/common/services/resolverService",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/scm/plain-git-history-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/scm/plain-git-graph-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/scm/plain-git-stash-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/scm/plain-git-worktree-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/features/scm/plain-scm-commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/observableInternal/base",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/observableInternal/observables/constObservable",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/resourceTree",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/languages",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/artifact",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/history",
	"app/features/scm/plain-scm-provider.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm.service",
	"app/features/scm/plain-scm-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/features/scm/scm-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/codicons",
	"app/features/scm/scm-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors",
	"app/features/scm/scm-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform",
	"app/features/scm/scm-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer",
	"app/features/scm/scm-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
	"app/features/search/plain-replace-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/search/plain-replace-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/glob",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/platform/telemetry/common/telemetry.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/platform/uriIdentity/common/uriIdentity.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search",
	"app/features/search/plain-search-service.ts:@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/glob",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service",
	"app/features/search/plain-search-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textfiles.service",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configurationRegistry",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/search/browser/searchIcons",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search",
	"app/features/search/search-contribution.ts:@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/search/browser/searchQuickAccess.contribution",
	"app/features/terminal/plain-terminal-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions",
	"app/features/terminal/plain-terminal-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/terminal/plain-terminal-commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/terminal/plain-terminal-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/terminal/terminal-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/codicons",
	"app/features/terminal/terminal-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors",
	"app/features/terminal/terminal-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform",
	"app/features/terminal/terminal-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer",
	"app/features/terminal/terminal-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service",
	"app/features/themes/plain-theme-commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service",
	"app/features/themes/plain-theme-import-coordinator.ts:@codingame/monaco-vscode-api/extensions",
	"app/features/themes/plain-theme-import-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/themes/plain-theme-import-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService",
	"app/features/themes/plain-theme-import-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/quickinput/common/quickInput.service",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/fileIconThemeData",
	"app/features/themes/plain-theme-picker.ts:@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/productIconThemeData",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/extensions",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/theme",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/colorThemeData",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/fileIconThemeData",
	"app/features/themes/plain-theme-registry.ts:@codingame/monaco-vscode-theme-service-override/vscode/vs/workbench/services/themes/browser/productIconThemeData",
	"app/features/workspace/commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/workspace/commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands.service",
	"app/features/workspace/commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/workspace/commands.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/workspace/commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/contextkeys",
	"app/features/workspace/delete-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/workspace/delete-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService",
	"app/features/workspace/delete-coordinator.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
	"app/features/workspace/file-system-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/features/workspace/file-system-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/workspace/file-system-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/workspace/file-system-provider.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
	"app/features/workspace/file-system-provider.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
	"app/features/workspace/workspace-configuration-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/features/workspace/workspace-configuration-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/workspace/workspace-configuration-provider.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/workspace/workspace-configuration-provider.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
	"app/features/workspace/workspace-projection.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/workspace/workspace-projection.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace",
	"app/features/workspace/workspace-projection.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/web.api",
	"app/main.ts:@codingame/monaco-vscode-api",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/model.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/services/resolverService.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService.service",
	"app/main.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/themes/common/workbenchThemeService.service",
	"app/main.ts:@codingame/monaco-vscode-configuration-service-override",
	"app/main.ts:@codingame/monaco-vscode-files-service-override",
	"app/main.ts:@codingame/monaco-vscode-theme-defaults-default-extension",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyService.service",
	"app/services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service",
	"app/services.ts:@codingame/monaco-vscode-configuration-service-override",
	"app/services.ts:@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution",
	"app/services.ts:@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService",
	"app/services.ts:@codingame/monaco-vscode-explorer-service-override",
	"app/services.ts:@codingame/monaco-vscode-files-service-override",
	"app/services.ts:@codingame/monaco-vscode-model-service-override",
	"app/services.ts:@codingame/monaco-vscode-multi-diff-editor-service-override",
	"app/services.ts:@codingame/monaco-vscode-notifications-service-override",
	"app/services.ts:@codingame/monaco-vscode-scm-service-override/vscode/vs/workbench/contrib/scm/common/scmService",
	"app/services.ts:@codingame/monaco-vscode-textmate-service-override",
	"app/services.ts:@codingame/monaco-vscode-theme-service-override",
	"app/services.ts:@codingame/monaco-vscode-workbench-service-override",
	"app/services.ts:@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService",
	"app/services.ts:@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService",
	"app/services/empty-language-status.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/services/empty-language-status.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/buffer",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/stream",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopy",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup",
	"app/services/plain-workspace-backup-service.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/log/common/log.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/filesConfiguration/common/filesConfigurationService.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopy",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyService.service",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyBackupTracker",
	"app/services/plain-workspace-backup-tracker.ts:@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/event",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/backup/common/backup",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service",
	"app/services/plain-workspace-services.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service",
	// `F100` S3 — the debug domain's own `ViewPane`s, glyph-margin
	// contribution, view-container registration and commands.
	"app/features/debug/debug-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/codicons",
	"app/features/debug/debug-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors",
	"app/features/debug/debug-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/registry/common/platform",
	"app/features/debug/debug-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPaneContainer",
	"app/features/debug/debug-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/model",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/editor/common/standalone/standaloneEnums",
	"app/features/debug/plain-debug-breakpoints-contribution.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/debug/plain-debug-call-stack-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service",
	"app/features/debug/plain-debug-commands.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/debug/plain-debug-console-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/debug/plain-debug-session-alerts.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions",
	"app/features/debug/plain-debug-session-alerts.ts:@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service",
	"app/features/debug/plain-debug-terminal-integration.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions",
	"app/features/debug/plain-debug-terminal-integration.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/debug/plain-debug-variables-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/opener/common/opener.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/views/viewPane",
	"app/features/debug/plain-debug-watch-view.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/views.service",
	// `F110` S4 (`app/features/workbench/plain-global-composite-bar.ts`, the
	// Activity Bar's migrated "Manage" gear — see that file's own doc comment).
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/dom",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/keyboardEvent",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/mouseEvent",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/touch",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/ui/actionbar/actionbar",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/browser/ui/contextview/contextview",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/actions",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/layout",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/themables",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/base/common/types",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/browser/menuEntryActionViewItem",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/configuration/common/configuration.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/hover/browser/hover.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/instantiation",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybinding.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/platform/theme/common/themeService.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/browser/parts/compositeBarActions",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/activity",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/common/theme",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/activity/common/activity.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/userDataProfile/common/userDataProfile.service",
	"app/features/workbench/plain-global-composite-bar.ts:@codingame/monaco-vscode-api/vscode/vs/workbench/services/userDataProfile/common/userDataProfileIcons",
]);
const ALLOWED_OTHER_BARE_APP_IMPORTS = Object.freeze([
	"app/platform/tauri/native.ts:@tauri-apps/api/core",
	"app/platform/tauri/native.ts:@tauri-apps/api/event",
]);

// These public wrappers all reach CommandsRegistry in the pinned dependency
// graph. The import allowlist remains the primary defense for unknown wrappers.
const FORBIDDEN_COMMAND_WRITER_NAMES = Object.freeze([
	"registerAction2",
	"registerCommandAndKeybindingRule",
	"registerCommandAlias",
	"registerEditorAction",
	"registerEditorCommand",
	"registerInstantiatedEditorAction",
	"registerModelAndPositionCommand",
	"registerMultiEditorAction",
	"registerCustomView",
	"registerNotificationCommands",
	"addAction",
	"addCommand",
	"addEditorAction",
	"addDynamicKeybinding",
]);

const FORBIDDEN_COMMAND_WRITER_IMPORTS = Object.freeze([
	...FORBIDDEN_COMMAND_WRITER_NAMES,
	"Command",
	"EditorAction",
	"EditorAction2",
	"EditorCommand",
	"KeybindingsRegistry",
	"MultiCommand",
	"MultiEditorAction",
	"ProxyCommand",
	"StandaloneCodeEditor",
	"StandaloneDiffEditor2",
	"StandaloneEditor",
	"StandaloneKeybindingService",
]);

const WRITE_METHODS = Object.freeze([
	"writeFile",
	"mkdir",
	"readdir",
	"delete",
	"rename",
	"copy",
]);

const EDITING_REJECTION_METHODS = Object.freeze([
	"addFolders",
	"removeFolders",
	"updateFolders",
	"enterWorkspace",
	"createAndEnterWorkspace",
	"saveAndEnterWorkspace",
	"copyWorkspaceSettings",
	"pickNewWorkspacePath",
]);

const WORKSPACES_REJECTION_METHODS = Object.freeze([
	"enterWorkspace",
	"createUntitledWorkspace",
	"deleteUntitledWorkspace",
	"getWorkspaceIdentifier",
]);

function parse(relativePath, source) {
	return ts.createSourceFile(
		relativePath,
		typeof source === "string" ? source : "",
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

const sourceAnalysisCache = new WeakMap();
const EMPTY_NODES = Object.freeze([]);

function freezeNodeIndex(nodes, keyOf) {
	const mutable = Object.create(null);
	for (const node of nodes) {
		const key = keyOf(node);
		if (key !== undefined) {
			(mutable[key] ??= []).push(node);
		}
	}
	for (const key of Object.keys(mutable)) {
		Object.freeze(mutable[key]);
	}
	return Object.freeze(mutable);
}

function analyzeSourceFile(sourceFile) {
	const cached = sourceAnalysisCache.get(sourceFile);
	if (cached !== undefined) {
		return cached;
	}
	const nodes = [];
	const visit = (node) => {
		nodes.push(node);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	const calls = nodes.filter(ts.isCallExpression);
	const identifiers = nodes.filter(ts.isIdentifier);
	const stringLiterals = nodes.filter(ts.isStringLiteralLike);
	const variableDeclarations = nodes.filter(ts.isVariableDeclaration);
	const functionDeclarations = nodes.filter(ts.isFunctionDeclaration);
	const classDeclarations = nodes.filter(ts.isClassDeclaration);
	const importEqualsDeclarations = nodes.filter(ts.isImportEqualsDeclaration);
	const importMetaModuleAccesses = nodes.filter((node) => {
		if (ts.isPropertyAccessExpression(node)) {
			return (
				isImportMeta(node.expression) &&
				["glob", "globEager"].includes(node.name.text)
			);
		}
		return (
			ts.isElementAccessExpression(node) &&
			isImportMeta(node.expression) &&
			["glob", "globEager"].includes(staticStringValue(node.argumentExpression))
		);
	});
	const importsExports = sourceFile.statements
		.filter(
			(node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node),
		)
		.map((statement) =>
			Object.freeze({
				node: statement,
				moduleName:
					statement.moduleSpecifier !== undefined &&
					ts.isStringLiteralLike(statement.moduleSpecifier)
						? statement.moduleSpecifier.text
						: undefined,
				statement,
			}),
		);
	const callFacts = calls.map((call) => {
		const callee = unwrapExpression(call.expression);
		return Object.freeze({
			node: call,
			call,
			chainName: callName(call),
			directName: ts.isIdentifier(callee) ? callee.text : undefined,
			staticName: staticCallName(call),
		});
	});
	const staticComputedAccesses = nodes
		.filter(ts.isElementAccessExpression)
		.map((access) =>
			Object.freeze({
				node: access,
				access,
				staticName: staticStringValue(access.argumentExpression),
			}),
		)
		.filter(({ staticName }) => staticName !== undefined);
	const analysis = Object.freeze({
		sourceFile,
		nodes: Object.freeze(nodes),
		callFacts: Object.freeze(callFacts),
		callsByChainName: freezeNodeIndex(callFacts, ({ chainName }) => chainName),
		identifiers: Object.freeze(identifiers),
		identifiersByName: freezeNodeIndex(identifiers, ({ text }) => text),
		stringLiterals: Object.freeze(stringLiterals),
		staticComputedAccesses: Object.freeze(staticComputedAccesses),
		variableDeclarations: Object.freeze(variableDeclarations),
		variableDeclarationsByName: freezeNodeIndex(
			variableDeclarations,
			(declaration) =>
				ts.isIdentifier(declaration.name) ? declaration.name.text : undefined,
		),
		functionDeclarationsByName: freezeNodeIndex(
			functionDeclarations,
			(declaration) => declaration.name?.text,
		),
		classDeclarationsByName: freezeNodeIndex(
			classDeclarations,
			(declaration) => declaration.name?.text,
		),
		importEqualsDeclarations: Object.freeze(importEqualsDeclarations),
		importMetaModuleAccesses: Object.freeze(importMetaModuleAccesses),
		importsExports: Object.freeze(importsExports),
	});
	sourceAnalysisCache.set(sourceFile, analysis);
	return analysis;
}

function normalizeRelativePath(relativePath) {
	if (typeof relativePath !== "string" || relativePath.includes("\0")) {
		return undefined;
	}
	const slashed = relativePath.replaceAll("\\", "/");
	const normalized = path.posix.normalize(slashed);
	return !path.posix.isAbsolute(slashed) &&
		normalized.startsWith("app/") &&
		!normalized.endsWith("/")
		? normalized
		: undefined;
}

function analyzeTopologyAuthority(
	sourceEntries,
	namedSources,
	{ completeAppAuthority = false } = {},
) {
	const filesByPath = Object.create(null);
	const analyses = [];
	const modulePaths = new Set();
	let hasDuplicatePath = false;
	let hasAmbiguousModulePath = false;
	let hasInvalidPath = false;
	for (const entry of sourceEntries) {
		if (
			entry === null ||
			typeof entry !== "object" ||
			typeof entry.source !== "string"
		) {
			hasInvalidPath = true;
			continue;
		}
		const { relativePath, source } = entry;
		const normalizedPath = normalizeRelativePath(relativePath);
		if (normalizedPath === undefined) {
			hasInvalidPath = true;
			continue;
		}
		if (filesByPath[normalizedPath] !== undefined) {
			hasDuplicatePath = true;
			continue;
		}
		const modulePath = normalizedPath
			.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/u, "")
			.toLowerCase();
		if (modulePaths.has(modulePath)) {
			hasAmbiguousModulePath = true;
		} else {
			modulePaths.add(modulePath);
		}
		const analysis = analyzeSourceFile(parse(normalizedPath, source));
		filesByPath[normalizedPath] = analysis;
		analyses.push(analysis);
	}
	const normalizedNamedSources = namedSources.map(
		({ relativePath, source }) => ({
			relativePath: normalizeRelativePath(relativePath),
			source,
		}),
	);
	const hasConsistentNamedSources = normalizedNamedSources.every(
		({ relativePath, source }) =>
			filesByPath[relativePath]?.sourceFile.text === source,
	);
	const sourceFiles = analyses.map(({ sourceFile }) => sourceFile);
	const identifiers = analyses.flatMap(({ identifiers }) => identifiers);
	const staticComputedAccesses = analyses.flatMap(
		({ staticComputedAccesses }) => staticComputedAccesses,
	);
	const stringLiterals = analyses.flatMap(
		({ stringLiterals }) => stringLiterals,
	);
	const importEqualsDeclarations = analyses.flatMap(
		({ importEqualsDeclarations }) => importEqualsDeclarations,
	);
	const importMetaModuleAccesses = analyses.flatMap(
		({ importMetaModuleAccesses }) => importMetaModuleAccesses,
	);
	const importsExports = analyses.flatMap((analysis) =>
		analysis.importsExports.map((fact) =>
			Object.freeze({ ...fact, sourceFile: analysis.sourceFile }),
		),
	);
	const callFacts = analyses.flatMap((analysis) =>
		analysis.callFacts.map((fact) =>
			Object.freeze({ ...fact, sourceFile: analysis.sourceFile }),
		),
	);
	return Object.freeze({
		valid:
			!hasDuplicatePath &&
			!hasAmbiguousModulePath &&
			!hasInvalidPath &&
			hasConsistentNamedSources,
		completeAppAuthority,
		filesByPath: Object.freeze(filesByPath),
		sourceFiles: Object.freeze(sourceFiles),
		importsExports: Object.freeze(importsExports),
		callFacts: Object.freeze(callFacts),
		identifiers: Object.freeze(identifiers),
		staticComputedAccesses: Object.freeze(staticComputedAccesses),
		stringLiterals: Object.freeze(stringLiterals),
		importEqualsDeclarations: Object.freeze(importEqualsDeclarations),
		importMetaModuleAccesses: Object.freeze(importMetaModuleAccesses),
	});
}

function isNodeWithin(root, candidate) {
	let current = candidate;
	while (current !== undefined) {
		if (current === root) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

function indexedWithin(root, nodes) {
	return nodes.filter((candidate) =>
		isNodeWithin(
			root,
			typeof candidate.kind === "number" ? candidate : candidate.node,
		),
	);
}

function nearestFunctionLike(node) {
	let current = node.parent;
	while (current !== undefined) {
		if (ts.isFunctionLike(current)) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

function isOwnedByFunction(node, owner) {
	return nearestFunctionLike(node) === owner;
}

function descendants(node, predicate) {
	return indexedWithin(
		node,
		analyzeSourceFile(node.getSourceFile()).nodes,
	).filter(predicate);
}

function unwrapExpression(expression) {
	let current = expression;
	while (
		current !== undefined &&
		(ts.isParenthesizedExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current) ||
			(ts.isSatisfiesExpression?.(current) ?? false))
	) {
		current = current.expression;
	}
	return current;
}

function isImportMeta(expression) {
	const current = unwrapExpression(expression);
	return (
		current !== undefined &&
		ts.isMetaProperty(current) &&
		current.keywordToken === ts.SyntaxKind.ImportKeyword &&
		current.name.text === "meta"
	);
}

function propertyChain(expression) {
	const current = unwrapExpression(expression);
	if (current === undefined) {
		return undefined;
	}
	if (ts.isIdentifier(current)) {
		return [current.text];
	}
	if (current.kind === ts.SyntaxKind.ThisKeyword) {
		return ["this"];
	}
	if (ts.isPropertyAccessExpression(current)) {
		const parent = propertyChain(current.expression);
		return parent === undefined ? undefined : [...parent, current.name.text];
	}
	return undefined;
}

function sameChain(expression, expected) {
	const actual = propertyChain(expression);
	return (
		actual !== undefined &&
		actual.length === expected.length &&
		actual.every((part, index) => part === expected[index])
	);
}

function directMethodReceiver(call, receiverName, methodName) {
	if (call === undefined || !ts.isCallExpression(call)) {
		return undefined;
	}
	const expression = unwrapExpression(call.expression);
	if (
		!ts.isPropertyAccessExpression(expression) ||
		expression.name.text !== methodName
	) {
		return undefined;
	}
	const receiver = unwrapExpression(expression.expression);
	return ts.isIdentifier(receiver) && receiver.text === receiverName
		? receiver
		: undefined;
}

function staticStringValue(expression) {
	const current = unwrapExpression(expression);
	if (current === undefined) {
		return undefined;
	}
	if (
		ts.isStringLiteralLike(current) ||
		ts.isNoSubstitutionTemplateLiteral(current)
	) {
		return current.text;
	}
	if (
		ts.isBinaryExpression(current) &&
		current.operatorToken.kind === ts.SyntaxKind.PlusToken
	) {
		const left = staticStringValue(current.left);
		const right = staticStringValue(current.right);
		return left !== undefined && right !== undefined
			? `${left}${right}`
			: undefined;
	}
	return undefined;
}

function staticCallName(call) {
	if (!ts.isCallExpression(call)) {
		return undefined;
	}
	const expression = unwrapExpression(call.expression);
	if (ts.isIdentifier(expression)) {
		return expression.text;
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text;
	}
	if (ts.isElementAccessExpression(expression)) {
		return staticStringValue(expression.argumentExpression);
	}
	return undefined;
}

function callName(call) {
	if (!ts.isCallExpression(call)) {
		return undefined;
	}
	const chain = propertyChain(call.expression);
	return chain?.at(-1);
}

function callsNamed(node, name) {
	const facts =
		analyzeSourceFile(node.getSourceFile()).callsByChainName[name] ??
		EMPTY_NODES;
	return indexedWithin(node, facts).map(({ call }) => call);
}

function directCallsNamed(node, name, owner) {
	return indexedWithin(node, analyzeSourceFile(node.getSourceFile()).callFacts)
		.filter(
			({ call, directName }) =>
				directName === name &&
				(owner === undefined || isOwnedByFunction(call, owner)),
		)
		.map(({ call }) => call);
}

function callWithChain(node, chain) {
	return indexedWithin(node, analyzeSourceFile(node.getSourceFile()).callFacts)
		.map(({ call }) => call)
		.filter((call) => sameChain(call.expression, chain));
}

function variableDeclarations(sourceFile, name) {
	return indexedWithin(
		sourceFile,
		analyzeSourceFile(sourceFile.getSourceFile()).variableDeclarationsByName[
			name
		] ?? EMPTY_NODES,
	);
}

function callableDeclarations(sourceFile, name) {
	const declarations = [];
	const analysis = analyzeSourceFile(sourceFile.getSourceFile());
	const candidates = [
		...(analysis.functionDeclarationsByName[name] ?? EMPTY_NODES),
		...(analysis.variableDeclarationsByName[name] ?? EMPTY_NODES),
	].sort((left, right) => left.pos - right.pos);
	for (const node of indexedWithin(sourceFile, candidates)) {
		if (
			ts.isFunctionDeclaration(node) &&
			node.name?.text === name &&
			node.body !== undefined
		) {
			declarations.push(node);
		}
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name
		) {
			const initializer = unwrapExpression(node.initializer);
			if (
				initializer !== undefined &&
				(ts.isArrowFunction(initializer) ||
					ts.isFunctionExpression(initializer)) &&
				ts.isBlock(initializer.body)
			) {
				declarations.push(initializer);
			}
		}
	}
	return declarations;
}

function callableBody(sourceFile, name) {
	const declarations = callableDeclarations(sourceFile, name);
	return declarations.length === 1 ? declarations[0].body : undefined;
}

function directReturnedExpression(body) {
	if (!ts.isBlock(body)) {
		return unwrapExpression(body);
	}
	const returns = body.statements.filter(ts.isReturnStatement);
	return returns.length === 1
		? unwrapExpression(returns[0].expression)
		: undefined;
}

function unwrapFreeze(expression) {
	const current = unwrapExpression(expression);
	if (
		current !== undefined &&
		ts.isCallExpression(current) &&
		sameChain(current.expression, ["Object", "freeze"]) &&
		current.arguments.length === 1
	) {
		return unwrapExpression(current.arguments[0]);
	}
	return current;
}

function declarationInitializedByCall(sourceFile, name) {
	return indexedWithin(
		sourceFile,
		analyzeSourceFile(sourceFile.getSourceFile()).variableDeclarations,
	).filter(
		(node) =>
			ts.isIdentifier(node.name) &&
			node.initializer !== undefined &&
			ts.isCallExpression(unwrapExpression(node.initializer)) &&
			callName(unwrapExpression(node.initializer)) === name,
	);
}

function objectProperty(objectLiteral, name) {
	if (!ts.isObjectLiteralExpression(objectLiteral)) {
		return undefined;
	}
	const matches = objectLiteral.properties.filter((property) => {
		if (
			!ts.isPropertyAssignment(property) &&
			!ts.isMethodDeclaration(property)
		) {
			return false;
		}
		return propertyName(property.name) === name;
	});
	return matches.length === 1 ? matches[0] : undefined;
}

function hasExactObjectShape(expression, contracts) {
	const objectLiteral = unwrapExpression(expression);
	return (
		objectLiteral !== undefined &&
		ts.isObjectLiteralExpression(objectLiteral) &&
		objectLiteral.properties.length === contracts.length &&
		contracts.every(([name, validate]) => {
			const property = objectProperty(objectLiteral, name);
			return (
				ts.isPropertyAssignment(property) &&
				validate(unwrapExpression(property.initializer))
			);
		})
	);
}

function isExactStringLiteral(expression, expected) {
	return (
		expression !== undefined &&
		ts.isStringLiteralLike(expression) &&
		expression.text === expected
	);
}

function propertyName(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
		return name.text;
	}
	return undefined;
}

function namedImportLocalIdentifier(
	sourceFile,
	moduleName,
	importedName,
	localName = importedName,
) {
	const matches = [];
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteralLike(statement.moduleSpecifier) ||
			statement.moduleSpecifier.text !== moduleName ||
			statement.importClause?.isTypeOnly === true ||
			!ts.isNamedImports(statement.importClause?.namedBindings)
		) {
			continue;
		}
		for (const element of statement.importClause.namedBindings.elements) {
			if (
				!element.isTypeOnly &&
				(element.propertyName?.text ?? element.name.text) === importedName &&
				element.name.text === localName
			) {
				matches.push(element.name);
			}
		}
	}
	return matches.length === 1 ? matches[0] : undefined;
}

function hasExactNamedImport(sourceFile, moduleName, expectedNames) {
	const imports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteralLike(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === moduleName,
	);
	const bindings = imports[0]?.importClause?.namedBindings;
	if (
		imports.length !== 1 ||
		imports[0].importClause?.isTypeOnly === true ||
		imports[0].importClause?.name !== undefined ||
		bindings === undefined ||
		!ts.isNamedImports(bindings)
	) {
		return false;
	}
	const elements = bindings.elements;
	return (
		elements.length === expectedNames.length &&
		elements.every(
			(element, index) =>
				!element.isTypeOnly &&
				element.propertyName === undefined &&
				element.name.text === expectedNames[index],
		)
	);
}

function hasExactDefaultImport(sourceFile, moduleName, localName) {
	const imports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteralLike(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === moduleName,
	);
	return (
		imports.length === 1 &&
		imports[0].importClause?.isTypeOnly !== true &&
		imports[0].importClause?.name?.text === localName &&
		imports[0].importClause?.namedBindings === undefined
	);
}

function importsNamedValue(sourceFile, moduleName, importedName) {
	return (
		namedImportLocalIdentifier(sourceFile, moduleName, importedName) !==
		undefined
	);
}

function hasExactIdentifierReferences(sourceFile, name, allowedNodes) {
	const allowed = new Set(allowedNodes.filter((node) => node !== undefined));
	const references = indexedWithin(
		sourceFile,
		analyzeSourceFile(sourceFile.getSourceFile()).identifiersByName[name] ??
			EMPTY_NODES,
	);
	return (
		references.length === allowed.size &&
		references.every((reference) => allowed.has(reference))
	);
}

function isConstVariableDeclaration(declaration) {
	return (
		ts.isVariableDeclarationList(declaration.parent) &&
		(declaration.parent.flags & ts.NodeFlags.Const) !== 0
	);
}

function isExactTypedParameter(parameter, name, typeName) {
	return (
		parameter !== undefined &&
		ts.isIdentifier(parameter.name) &&
		parameter.name.text === name &&
		parameter.dotDotDotToken === undefined &&
		parameter.questionToken === undefined &&
		parameter.initializer === undefined &&
		parameter.type !== undefined &&
		ts.isTypeReferenceNode(parameter.type) &&
		sameChain(parameter.type.typeName, [typeName])
	);
}

function expressionBody(functionLike) {
	if (
		functionLike === undefined ||
		(!ts.isArrowFunction(functionLike) &&
			!ts.isFunctionExpression(functionLike))
	) {
		return undefined;
	}
	return directReturnedExpression(functionLike.body);
}

function syntaxTokenSignature(source) {
	if (typeof source !== "string") {
		return undefined;
	}
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		true,
		ts.LanguageVariant.Standard,
		source,
	);
	const tokens = [];
	for (
		let token = scanner.scan();
		token !== ts.SyntaxKind.EndOfFileToken;
		token = scanner.scan()
	) {
		tokens.push([token, scanner.getTokenText()]);
	}
	return JSON.stringify(tokens);
}

function syntaxAstSignature(source) {
	if (typeof source !== "string") {
		return undefined;
	}
	const sourceFile = ts.createSourceFile(
		"workspace-remove-command-contract.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length !== 0) {
		return undefined;
	}
	const signature = (node) => {
		const children = [];
		ts.forEachChild(node, (child) => {
			children.push(signature(child));
		});
		return [node.kind, children];
	};
	return JSON.stringify(signature(sourceFile));
}

function hasExactSyntaxTokens(node, expected) {
	if (node === undefined) {
		return false;
	}
	const actual = node.getText(node.getSourceFile());
	return (
		syntaxTokenSignature(actual) === syntaxTokenSignature(expected) &&
		syntaxAstSignature(actual) === syntaxAstSignature(expected)
	);
}

function sameStringArray(actual, expected) {
	return (
		actual !== undefined &&
		actual.length === expected.length &&
		actual.every((value, index) => value === expected[index])
	);
}

function arrayLiteralStrings(expression) {
	const array = unwrapFreeze(expression);
	if (!ts.isArrayLiteralExpression(array)) {
		return undefined;
	}
	const values = [];
	for (const element of array.elements) {
		const current = unwrapExpression(element);
		if (!ts.isStringLiteralLike(current)) {
			return undefined;
		}
		values.push(current.text);
	}
	return values;
}

function containsNode(container, target) {
	return target.pos >= container.pos && target.end <= container.end;
}

function hasBinary(node, left, operator, right) {
	return (
		descendants(
			node,
			(candidate) =>
				ts.isBinaryExpression(candidate) &&
				candidate.operatorToken.kind === operator &&
				sameChain(candidate.left, left) &&
				sameChain(candidate.right, right),
		).length > 0
	);
}

function assignmentPosition(node, left, right) {
	const matches = descendants(
		node,
		(candidate) =>
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			sameChain(candidate.left, left) &&
			sameChain(candidate.right, right),
	);
	return matches.length === 1 ? matches[0].pos : undefined;
}

function directThrowCall(node, call) {
	return descendants(
		node,
		(candidate) =>
			ts.isThrowStatement(candidate) &&
			ts.isCallExpression(unwrapExpression(candidate.expression)) &&
			sameChain(unwrapExpression(candidate.expression).expression, call) &&
			unwrapExpression(candidate.expression).arguments.length === 0,
	);
}

function fatalOnlyCatchAround(root, dispatchedCall) {
	const tries = descendants(root, ts.isTryStatement).filter((statement) =>
		containsNode(statement.tryBlock, dispatchedCall),
	);
	if (tries.length !== 1 || tries[0].catchClause === undefined) {
		return false;
	}
	const statements = tries[0].catchClause.block.statements;
	return (
		statements.length === 1 &&
		ts.isThrowStatement(statements[0]) &&
		ts.isCallExpression(unwrapExpression(statements[0].expression)) &&
		sameChain(unwrapExpression(statements[0].expression).expression, [
			"failPermanently",
		]) &&
		unwrapExpression(statements[0].expression).arguments.length === 0
	);
}

function isUndefinedCallback(expression) {
	const callback = unwrapExpression(expression);
	if (!ts.isArrowFunction(callback) || callback.parameters.length !== 0) {
		return false;
	}
	const returned = directReturnedExpression(callback.body);
	return sameChain(returned, ["undefined"]);
}

function isPromiseRejectNew(expression, errorName) {
	const current = unwrapExpression(expression);
	return (
		ts.isCallExpression(current) &&
		sameChain(current.expression, ["Promise", "reject"]) &&
		current.arguments.length === 1 &&
		ts.isNewExpression(unwrapExpression(current.arguments[0])) &&
		sameChain(unwrapExpression(current.arguments[0]).expression, [errorName]) &&
		(unwrapExpression(current.arguments[0]).arguments?.length ?? 0) === 0
	);
}

function isDirectVariableDeclaration(owner, declaration) {
	return (
		declaration !== undefined &&
		ts.isVariableDeclarationList(declaration.parent) &&
		ts.isVariableStatement(declaration.parent.parent) &&
		declaration.parent.parent.parent === owner.body
	);
}

function isDirectExpressionCall(owner, call) {
	const expression = outermostTransparentExpression(call);
	return (
		ts.isExpressionStatement(expression.parent) &&
		expression.parent.expression === expression &&
		expression.parent.parent === owner.body
	);
}

function directMethodReturnCall(classDeclaration, methodName, call) {
	const methods = classDeclaration.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			propertyName(member.name) === methodName,
	);
	if (methods.length !== 1 || methods[0].body?.statements.length !== 1) {
		return false;
	}
	const statement = methods[0].body.statements[0];
	return (
		ts.isReturnStatement(statement) &&
		ts.isCallExpression(unwrapExpression(statement.expression)) &&
		sameChain(unwrapExpression(statement.expression).expression, call) &&
		unwrapExpression(statement.expression).arguments.length === 0
	);
}

function directMethodReturnExpression(classDeclaration, methodName) {
	const methods = classDeclaration.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			propertyName(member.name) === methodName,
	);
	if (methods.length !== 1 || methods[0].body?.statements.length !== 1) {
		return undefined;
	}
	const statement = methods[0].body.statements[0];
	return ts.isReturnStatement(statement)
		? unwrapExpression(statement.expression)
		: undefined;
}

function promiseResolveArgument(expression) {
	return ts.isCallExpression(expression) &&
		sameChain(expression.expression, ["Promise", "resolve"]) &&
		expression.arguments.length === 1
		? unwrapExpression(expression.arguments[0])
		: undefined;
}

function isEmptyArray(expression) {
	return (
		ts.isArrayLiteralExpression(expression) && expression.elements.length === 0
	);
}

function validateBootstrap(sourceFile) {
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		!importsNamedValue(
			sourceFile,
			"@codingame/monaco-vscode-files-service-override",
			"registerCustomProvider",
		) ||
		!importsNamedValue(
			sourceFile,
			"@codingame/monaco-vscode-api",
			"initialize",
		) ||
		!importsNamedValue(
			sourceFile,
			"./features/workspace/file-system-provider",
			"createPlainWorkspaceFileSystemProvider",
		) ||
		!importsNamedValue(
			sourceFile,
			"./features/workspace/file-system-provider",
			"PLAIN_WORKSPACE_SCHEME",
		) ||
		!importsNamedValue(
			sourceFile,
			"./features/workspace/workspace-configuration-provider",
			"createPlainWorkspaceConfigurationProvider",
		) ||
		!importsNamedValue(
			sourceFile,
			"./features/workspace/workspace-configuration-provider",
			"PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
		)
	) {
		return false;
	}
	const bootstrapDeclarations = callableDeclarations(sourceFile, "bootstrap");
	const bootstrapOwner =
		bootstrapDeclarations.length === 1 ? bootstrapDeclarations[0] : undefined;
	const bootstrap = bootstrapOwner?.body;
	const sourceAnalysis = analyzeSourceFile(sourceFile);
	if (
		!ts.isFunctionDeclaration(bootstrapOwner) ||
		bootstrapOwner.parent !== sourceFile ||
		bootstrapOwner.name === undefined ||
		bootstrap === undefined
	) {
		return false;
	}
	const bootstrapCalls = directCallsNamed(sourceFile, "bootstrap");
	const bootstrapInvocation =
		bootstrapCalls.length === 1 ? bootstrapCalls[0] : undefined;
	const bootstrapCallee = ts.isCallExpression(bootstrapInvocation)
		? unwrapExpression(bootstrapInvocation.expression)
		: undefined;
	const catchAccess = bootstrapInvocation?.parent;
	const catchCall = catchAccess?.parent;
	const voidExpression = catchCall?.parent;
	const invocationStatement = voidExpression?.parent;
	if (
		!ts.isIdentifier(bootstrapCallee) ||
		bootstrapCallee.text !== "bootstrap" ||
		!ts.isPropertyAccessExpression(catchAccess) ||
		catchAccess.expression !== bootstrapInvocation ||
		catchAccess.name.text !== "catch" ||
		!ts.isCallExpression(catchCall) ||
		catchCall.expression !== catchAccess ||
		catchCall.arguments.length !== 1 ||
		!ts.isVoidExpression(voidExpression) ||
		voidExpression.expression !== catchCall ||
		!ts.isExpressionStatement(invocationStatement) ||
		invocationStatement.expression !== voidExpression ||
		invocationStatement.parent !== sourceFile ||
		!exactBindingReferences(sourceFile, sourceAnalysis, "bootstrap", [
			bootstrapOwner.name,
			bootstrapCallee,
		])
	) {
		return false;
	}
	const rootFactoryCalls = directCallsNamed(
		bootstrap,
		"createPlainWorkspaceFileSystemProvider",
		bootstrapOwner,
	);
	const configurationFactoryCalls = directCallsNamed(
		bootstrap,
		"createPlainWorkspaceConfigurationProvider",
		bootstrapOwner,
	);
	const rootDeclaration =
		rootFactoryCalls.length === 1
			? declarationInitializedByExactCall(sourceAnalysis, rootFactoryCalls[0])
			: undefined;
	const configurationDeclaration =
		configurationFactoryCalls.length === 1
			? declarationInitializedByExactCall(
					sourceAnalysis,
					configurationFactoryCalls[0],
				)
			: undefined;
	if (
		rootDeclaration === undefined ||
		configurationDeclaration === undefined ||
		!isDirectVariableDeclaration(bootstrapOwner, rootDeclaration) ||
		!isDirectVariableDeclaration(bootstrapOwner, configurationDeclaration) ||
		!isOwnedByFunction(rootDeclaration, bootstrapOwner) ||
		!isOwnedByFunction(configurationDeclaration, bootstrapOwner) ||
		!ts.isIdentifier(rootDeclaration.name) ||
		!ts.isIdentifier(configurationDeclaration.name)
	) {
		return false;
	}
	const rootName = rootDeclaration.name.text;
	const configurationName = configurationDeclaration.name.text;
	const configurationReferences = bindingReferences(
		bootstrap,
		sourceAnalysis,
		configurationName,
	).filter((reference) => isOwnedByFunction(reference, bootstrapOwner));
	if (configurationReferences.length !== 3) {
		return false;
	}
	const registrations = directCallsNamed(
		bootstrap,
		"registerCustomProvider",
		bootstrapOwner,
	);
	if (registrations.length !== 2) {
		return false;
	}
	const rootRegistration = registrations.find(
		(call) =>
			call.arguments.length === 2 &&
			sameChain(call.arguments[0], ["PLAIN_WORKSPACE_SCHEME"]) &&
			sameChain(call.arguments[1], [rootName]),
	);
	const configurationRegistration = registrations.find(
		(call) =>
			call.arguments.length === 2 &&
			sameChain(call.arguments[0], ["PLAIN_WORKSPACE_CONFIGURATION_SCHEME"]) &&
			sameChain(call.arguments[1], [configurationName]),
	);
	if (
		rootRegistration === undefined ||
		configurationRegistration === undefined ||
		!isDirectExpressionCall(bootstrapOwner, rootRegistration) ||
		!isDirectExpressionCall(bootstrapOwner, configurationRegistration) ||
		rootRegistration.pos >= configurationRegistration.pos
	) {
		return false;
	}

	const coordinatorCalls = directCallsNamed(
		bootstrap,
		"createWorkspaceTopologyCoordinator",
		bootstrapOwner,
	);
	const coordinatorDeclaration =
		coordinatorCalls.length === 1
			? declarationInitializedByExactCall(sourceAnalysis, coordinatorCalls[0])
			: undefined;
	if (
		coordinatorDeclaration === undefined ||
		!isDirectVariableDeclaration(bootstrapOwner, coordinatorDeclaration) ||
		!isOwnedByFunction(coordinatorDeclaration, bootstrapOwner) ||
		!ts.isIdentifier(coordinatorDeclaration.name)
	) {
		return false;
	}
	const coordinatorCall = coordinatorCalls[0];
	const coordinatorName = coordinatorDeclaration.name.text;
	const watcherAuthorityCallback = unwrapExpression(
		coordinatorCall.arguments[5],
	);
	const watcherAuthorityExpression = expressionBody(watcherAuthorityCallback);
	const watcherAuthorityCalls = callWithChain(bootstrap, [
		"bridge",
		"workspaceReconcileWatchRoots",
	]);
	if (
		coordinatorCall.arguments.length !== 6 ||
		!sameChain(coordinatorCall.arguments[0], [configurationName]) ||
		!sameChain(coordinatorCall.arguments[1], ["reinitializeWorkspace"]) ||
		!ts.isArrowFunction(watcherAuthorityCallback) ||
		watcherAuthorityCallback.parameters.length !== 1 ||
		!ts.isIdentifier(watcherAuthorityCallback.parameters[0].name) ||
		watcherAuthorityCallback.parameters[0].name.text !== "rootIds" ||
		!ts.isCallExpression(watcherAuthorityExpression) ||
		!sameChain(watcherAuthorityExpression.expression, [
			"bridge",
			"workspaceReconcileWatchRoots",
		]) ||
		watcherAuthorityExpression.arguments.length !== 1 ||
		!sameChain(watcherAuthorityExpression.arguments[0], ["rootIds"]) ||
		watcherAuthorityCalls.length !== 1 ||
		!containsNode(watcherAuthorityCallback, watcherAuthorityCalls[0]) ||
		coordinatorCall.pos <= configurationRegistration.pos
	) {
		return false;
	}

	const prepare = callWithChain(bootstrap, [
		coordinatorName,
		"prepareInitial",
	]).filter((call) => isOwnedByFunction(call, bootstrapOwner));
	const initialize = directCallsNamed(bootstrap, "initialize", bootstrapOwner);
	const complete = callWithChain(bootstrap, [
		coordinatorName,
		"completeInitial",
	]).filter((call) => isOwnedByFunction(call, bootstrapOwner));
	const apply = callWithChain(bootstrap, [coordinatorName, "apply"]);
	const commands = directCallsNamed(
		bootstrap,
		"registerWorkspaceCommands",
		bootstrapOwner,
	);
	const workspaceCommandCall = commands.length === 1 ? commands[0] : undefined;
	const workspaceCommandCallee = ts.isCallExpression(workspaceCommandCall)
		? unwrapExpression(workspaceCommandCall.expression)
		: undefined;
	const workspaceCommandImport = namedImportLocalIdentifier(
		sourceFile,
		"./features/workspace/commands",
		"registerWorkspaceCommands",
	);
	const workspaceCommandHolders = variableDeclarations(
		bootstrap,
		"workspaceCommands",
	).filter((declaration) => isOwnedByFunction(declaration, bootstrapOwner));
	const workspaceCommandHolder =
		workspaceCommandHolders.length === 1
			? workspaceCommandHolders[0]
			: undefined;
	const workspaceCommandTypeReferences =
		workspaceCommandHolder?.type !== undefined
			? descendants(
					workspaceCommandHolder.type,
					(node) =>
						ts.isIdentifier(node) && node.text === "registerWorkspaceCommands",
				)
			: [];
	const workspaceCommandAssignments = descendants(
		bootstrap,
		(node) =>
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			sameChain(node.left, ["workspaceCommands"]),
	).filter((assignment) => isOwnedByFunction(assignment, bootstrapOwner));
	const workspaceCommandAssignment =
		workspaceCommandAssignments.length === 1
			? workspaceCommandAssignments[0]
			: undefined;
	const workspaceCommandDisposeCalls = callWithChain(bootstrap, [
		"workspaceCommands",
		"dispose",
	]);
	const workspaceCommandDispose =
		workspaceCommandDisposeCalls.length === 1
			? workspaceCommandDisposeCalls[0]
			: undefined;
	const workspaceCommandDisposeReceiver = directMethodReceiver(
		workspaceCommandDispose,
		"workspaceCommands",
		"dispose",
	);
	const pagehideListeners = callWithChain(bootstrap, [
		"window",
		"addEventListener",
	]).filter(
		(call) =>
			isOwnedByFunction(call, bootstrapOwner) &&
			call.arguments.length >= 2 &&
			ts.isStringLiteralLike(unwrapExpression(call.arguments[0])) &&
			unwrapExpression(call.arguments[0]).text === "pagehide",
	);
	const pagehideCallback =
		pagehideListeners.length === 1
			? unwrapExpression(pagehideListeners[0].arguments[1])
			: undefined;
	const initializeCall = initialize.length === 1 ? initialize[0] : undefined;
	const initializeCallee = ts.isCallExpression(initializeCall)
		? unwrapExpression(initializeCall.expression)
		: undefined;
	const initializeImport = namedImportLocalIdentifier(
		sourceFile,
		"@codingame/monaco-vscode-api",
		"initialize",
	);
	const initializeConfiguration =
		ts.isCallExpression(initializeCall) && initializeCall.arguments.length === 3
			? unwrapExpression(initializeCall.arguments[2])
			: undefined;
	const initialWorkspaceDeclarations = declarationInitializedByCall(
		bootstrap,
		"prepareInitial",
	).filter((declaration) => isOwnedByFunction(declaration, bootstrapOwner));
	const initialWorkspaceName =
		initialWorkspaceDeclarations.length === 1 &&
		ts.isIdentifier(initialWorkspaceDeclarations[0].name)
			? initialWorkspaceDeclarations[0].name.text
			: undefined;
	const hasExactInitializeConfiguration =
		initialWorkspaceName !== undefined &&
		hasExactObjectShape(initializeConfiguration, [
			[
				"productConfiguration",
				(value) =>
					hasExactObjectShape(value, [
						["nameShort", (name) => isExactStringLiteral(name, "Plain")],
						["nameLong", (name) => isExactStringLiteral(name, "Plain")],
					]),
			],
			[
				"configurationDefaults",
				(value) =>
					hasExactObjectShape(value, [
						[
							"window.menuBarVisibility",
							(visibility) => isExactStringLiteral(visibility, "hidden"),
						],
						[
							"workbench.startupEditor",
							(editor) => isExactStringLiteral(editor, "none"),
						],
						[
							"files.autoSave",
							(autoSave) => isExactStringLiteral(autoSave, "off"),
						],
						[
							"search.followSymlinks",
							(followSymlinks) =>
								followSymlinks.kind === ts.SyntaxKind.FalseKeyword,
						],
					]),
			],
			[
				"enableWorkspaceTrust",
				(value) => value.kind === ts.SyntaxKind.FalseKeyword,
			],
			[
				"workspaceProvider",
				(value) => sameChain(value, [initialWorkspaceName, "provider"]),
			],
		]);
	if (
		prepare.length !== 1 ||
		initialize.length !== 1 ||
		complete.length !== 1 ||
		apply.length !== 0 ||
		initializeImport === undefined ||
		!ts.isIdentifier(initializeCallee) ||
		initializeCallee.text !== "initialize" ||
		!hasExactIdentifierReferences(sourceFile, "initialize", [
			initializeImport,
			initializeCallee,
		]) ||
		!ts.isCallExpression(initializeCall) ||
		initializeCall.arguments.length !== 3 ||
		!ts.isCallExpression(unwrapExpression(initializeCall.arguments[0])) ||
		!sameChain(unwrapExpression(initializeCall.arguments[0]).expression, [
			"createServiceOverrides",
		]) ||
		unwrapExpression(initializeCall.arguments[0]).arguments.length !== 0 ||
		!sameChain(initializeCall.arguments[1], ["container"]) ||
		!hasExactInitializeConfiguration ||
		commands.length !== 1 ||
		workspaceCommandImport === undefined ||
		!ts.isIdentifier(workspaceCommandCallee) ||
		workspaceCommandCallee.text !== "registerWorkspaceCommands" ||
		workspaceCommandTypeReferences.length !== 1 ||
		!hasExactIdentifierReferences(sourceFile, "registerWorkspaceCommands", [
			workspaceCommandImport,
			workspaceCommandTypeReferences[0],
			workspaceCommandCallee,
		]) ||
		workspaceCommandHolder === undefined ||
		!ts.isVariableDeclarationList(workspaceCommandHolder.parent) ||
		(workspaceCommandHolder.parent.flags & ts.NodeFlags.Let) === 0 ||
		workspaceCommandHolder.initializer !== undefined ||
		workspaceCommandAssignment === undefined ||
		unwrapExpression(workspaceCommandAssignment.right) !==
			workspaceCommandCall ||
		workspaceCommandDisposeReceiver === undefined ||
		workspaceCommandDispose.arguments.length !== 0 ||
		(!ts.isArrowFunction(pagehideCallback) &&
			!ts.isFunctionExpression(pagehideCallback)) ||
		!containsNode(pagehideCallback, workspaceCommandDispose) ||
		!hasExactIdentifierReferences(sourceFile, "workspaceCommands", [
			workspaceCommandHolder.name,
			unwrapExpression(workspaceCommandAssignment.left),
			workspaceCommandDisposeReceiver,
		]) ||
		commands[0].arguments.length !== 3 ||
		!sameChain(commands[0].arguments[2], [coordinatorName]) ||
		prepare[0].pos >= initialize[0].pos ||
		initialize[0].pos >= complete[0].pos ||
		complete[0].pos >= commands[0].pos
	) {
		return false;
	}

	const adoptionReader = unwrapExpression(coordinatorCall.arguments[3]);
	if (
		!ts.isArrowFunction(adoptionReader) ||
		!adoptionReader.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		) ||
		!ts.isBlock(adoptionReader.body)
	) {
		return false;
	}
	const returns = descendants(adoptionReader.body, ts.isReturnStatement);
	const adoptionObject =
		returns.length === 1 ? unwrapFreeze(returns[0].expression) : undefined;
	const id = objectProperty(adoptionObject, "id");
	const configPath = objectProperty(adoptionObject, "configPath");
	const rootUris = objectProperty(adoptionObject, "rootUris");
	const configExpression = ts.isPropertyAssignment(configPath)
		? unwrapExpression(configPath.initializer)
		: undefined;
	const rootExpression = ts.isPropertyAssignment(rootUris)
		? unwrapFreeze(rootUris.initializer)
		: undefined;
	const rootMap = ts.isCallExpression(rootExpression)
		? rootExpression
		: undefined;
	const rootCallback = unwrapExpression(rootMap?.arguments[0]);
	const rootCallbackBody =
		ts.isArrowFunction(rootCallback) || ts.isFunctionExpression(rootCallback)
			? expressionBody(rootCallback)
			: undefined;
	return (
		ts.isPropertyAssignment(id) &&
		sameChain(id.initializer, ["workspace", "id"]) &&
		ts.isBinaryExpression(configExpression) &&
		configExpression.operatorToken.kind ===
			ts.SyntaxKind.QuestionQuestionToken &&
		sameChain(configExpression.left, ["workspace", "configuration"]) &&
		sameChain(configExpression.right, ["undefined"]) &&
		rootMap !== undefined &&
		sameChain(rootMap.expression, ["workspace", "folders", "map"]) &&
		rootMap.arguments.length === 1 &&
		(ts.isArrowFunction(rootCallback) ||
			ts.isFunctionExpression(rootCallback)) &&
		rootCallback.parameters.length === 1 &&
		ts.isObjectBindingPattern(rootCallback.parameters[0].name) &&
		rootCallback.parameters[0].name.elements.length === 1 &&
		ts.isIdentifier(rootCallback.parameters[0].name.elements[0].name) &&
		rootCallback.parameters[0].name.elements[0].name.text === "uri" &&
		ts.isCallExpression(rootCallbackBody) &&
		sameChain(rootCallbackBody.expression, ["uri", "toString"]) &&
		rootCallbackBody.arguments.length === 0
	);
}

function validateConfigurationProvider(sourceFile, projectionFile) {
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		projectionFile.parseDiagnostics.length !== 0
	) {
		return false;
	}
	const schemeDeclarations = variableDeclarations(
		sourceFile,
		"PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
	);
	if (
		schemeDeclarations.length !== 1 ||
		!ts.isStringLiteralLike(
			unwrapExpression(schemeDeclarations[0].initializer),
		) ||
		unwrapExpression(schemeDeclarations[0].initializer).text !==
			"plain-workspace-config"
	) {
		return false;
	}
	const classes = descendants(
		sourceFile,
		(node) =>
			ts.isClassDeclaration(node) &&
			node.name?.text === "PlainWorkspaceConfigurationProviderImpl",
	);
	if (classes.length !== 1) {
		return false;
	}
	const provider = classes[0];
	for (const eventName of ["onDidChangeCapabilities", "onDidChangeFile"]) {
		const properties = provider.members.filter(
			(member) =>
				ts.isPropertyDeclaration(member) &&
				propertyName(member.name) === eventName,
		);
		if (
			properties.length !== 1 ||
			!sameChain(properties[0].initializer, ["Event", "None"])
		) {
			return false;
		}
	}
	const capabilities = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			propertyName(member.name) === "capabilities",
	);
	if (capabilities.length !== 1) {
		return false;
	}
	const capabilityTerms = [];
	function collectCapabilities(expression) {
		const current = unwrapExpression(expression);
		if (
			ts.isBinaryExpression(current) &&
			current.operatorToken.kind === ts.SyntaxKind.BarToken
		) {
			collectCapabilities(current.left);
			collectCapabilities(current.right);
			return;
		}
		capabilityTerms.push(propertyChain(current)?.join("."));
	}
	collectCapabilities(capabilities[0].initializer);
	if (
		!sameStringArray(capabilityTerms.sort(), [
			"FileSystemProviderCapabilities.FileReadWrite",
			"FileSystemProviderCapabilities.Readonly",
		])
	) {
		return false;
	}
	for (const methodName of ["install", "clear", ...WRITE_METHODS]) {
		const methods = provider.members.filter(
			(member) =>
				ts.isMethodDeclaration(member) &&
				propertyName(member.name) === methodName,
		);
		if (methods.length !== 1) {
			return false;
		}
		if (WRITE_METHODS.includes(methodName)) {
			const statements = methods[0].body?.statements ?? [];
			if (
				statements.length !== 1 ||
				!ts.isThrowStatement(statements[0]) ||
				!ts.isCallExpression(unwrapExpression(statements[0].expression)) ||
				!sameChain(unwrapExpression(statements[0].expression).expression, [
					"noPermissions",
				]) ||
				unwrapExpression(statements[0].expression).arguments.length !== 0
			) {
				return false;
			}
		}
	}
	const factory = callableBody(
		sourceFile,
		"createPlainWorkspaceConfigurationProvider",
	);
	const returned =
		factory === undefined ? undefined : directReturnedExpression(factory);
	if (
		!ts.isNewExpression(returned) ||
		!sameChain(returned.expression, [
			"PlainWorkspaceConfigurationProviderImpl",
		]) ||
		(returned.arguments?.length ?? 0) !== 0 ||
		descendants(
			sourceFile,
			(node) =>
				ts.isNewExpression(node) &&
				sameChain(node.expression, ["PlainWorkspaceConfigurationProviderImpl"]),
		).length !== 1
	) {
		return false;
	}

	const project = callableBody(projectionFile, "projectDecodedSnapshot");
	if (project === undefined) {
		return false;
	}
	const clearCalls = callWithChain(project, ["configurationStore", "clear"]);
	const installCalls = callWithChain(project, [
		"configurationStore",
		"install",
	]);
	const branch = descendants(project, ts.isIfStatement).find(
		(statement) =>
			ts.isBinaryExpression(unwrapExpression(statement.expression)) &&
			unwrapExpression(statement.expression).operatorToken.kind ===
				ts.SyntaxKind.EqualsEqualsEqualsToken &&
			sameChain(unwrapExpression(statement.expression).left, ["rootCount"]) &&
			ts.isNumericLiteral(
				unwrapExpression(unwrapExpression(statement.expression).right),
			) &&
			unwrapExpression(unwrapExpression(statement.expression).right).text ===
				"0",
	);
	const finalReturn = project.statements.filter(ts.isReturnStatement).at(-1);
	const clearBlock = branch?.thenStatement;
	const installBlock = branch?.elseStatement;
	const clearFirstStatement = ts.isBlock(clearBlock)
		? clearBlock.statements[0]
		: clearBlock;
	const installFirstStatement = ts.isBlock(installBlock)
		? installBlock.statements[0]
		: installBlock;
	const installedConfigPath =
		ts.isVariableStatement(installFirstStatement) &&
		installFirstStatement.declarationList.declarations.length === 1
			? installFirstStatement.declarationList.declarations[0]
			: undefined;
	return (
		clearCalls.length === 1 &&
		installCalls.length === 1 &&
		branch !== undefined &&
		containsNode(branch.thenStatement, clearCalls[0]) &&
		branch.elseStatement !== undefined &&
		containsNode(branch.elseStatement, installCalls[0]) &&
		ts.isExpressionStatement(clearFirstStatement) &&
		containsNode(clearFirstStatement, clearCalls[0]) &&
		installedConfigPath !== undefined &&
		ts.isObjectBindingPattern(installedConfigPath.name) &&
		installedConfigPath.name.elements.length === 1 &&
		ts.isIdentifier(installedConfigPath.name.elements[0].name) &&
		installedConfigPath.name.elements[0].name.text === "configPath" &&
		installedConfigPath.initializer !== undefined &&
		containsNode(installedConfigPath.initializer, installCalls[0]) &&
		descendants(
			branch.elseStatement,
			(node) => ts.isIdentifier(node) && node.text === "configPath",
		).length >= 3 &&
		finalReturn !== undefined &&
		clearCalls[0].pos < finalReturn.pos &&
		installCalls[0].pos < finalReturn.pos
	);
}

function validateCoordinator(sourceFile) {
	if (sourceFile.parseDiagnostics.length !== 0) {
		return false;
	}
	const declarations = callableDeclarations(
		sourceFile,
		"createWorkspaceTopologyCoordinator",
	);
	const coordinator = declarations.length === 1 ? declarations[0] : undefined;
	const body = coordinator?.body;
	if (!ts.isBlock(body) || coordinator.parameters.length !== 6) {
		return false;
	}
	const watcherAuthorityParameter = coordinator.parameters[5];
	const watcherAuthorityDeclarations = callableDeclarations(
		body,
		"acceptWatcherAuthority",
	);
	const watcherAuthorityDeclaration = watcherAuthorityDeclarations[0];
	if (
		!ts.isIdentifier(watcherAuthorityParameter.name) ||
		watcherAuthorityParameter.name.text !== "reconcileWorkspaceWatchRoots" ||
		!isUndefinedCallback(watcherAuthorityParameter.initializer) ||
		watcherAuthorityDeclarations.length !== 1 ||
		!hasExactSyntaxTokens(
			watcherAuthorityDeclaration,
			`(projected: ProjectedState): void => {
				try {
					reconcileWorkspaceWatchRoots(
						Object.freeze(projected.snapshot.roots.map(({ rootId }) => rootId)),
					);
				} catch {
					throw failPermanently();
				}
			}`,
		)
	) {
		return false;
	}
	const queueDeclarations = variableDeclarations(body, "queueTail");
	const enqueue = callableBody(body, "enqueue");
	if (
		queueDeclarations.length !== 1 ||
		!ts.isCallExpression(unwrapExpression(queueDeclarations[0].initializer)) ||
		!sameChain(unwrapExpression(queueDeclarations[0].initializer).expression, [
			"Promise",
			"resolve",
		]) ||
		enqueue === undefined
	) {
		return false;
	}
	const pending = variableDeclarations(enqueue, "pending");
	const queueAssignments = descendants(
		enqueue,
		(node) =>
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			sameChain(node.left, ["queueTail"]),
	);
	const enqueueReturns = enqueue.statements.filter(ts.isReturnStatement);
	if (
		pending.length !== 1 ||
		!ts.isCallExpression(unwrapExpression(pending[0].initializer)) ||
		!sameChain(unwrapExpression(pending[0].initializer).expression, [
			"queueTail",
			"then",
		]) ||
		unwrapExpression(pending[0].initializer).arguments.length !== 1 ||
		!sameChain(unwrapExpression(pending[0].initializer).arguments[0], [
			"task",
		]) ||
		queueAssignments.length !== 1 ||
		!ts.isCallExpression(unwrapExpression(queueAssignments[0].right)) ||
		!sameChain(unwrapExpression(queueAssignments[0].right).expression, [
			"pending",
			"then",
		]) ||
		unwrapExpression(queueAssignments[0].right).arguments.length !== 2 ||
		!isUndefinedCallback(
			unwrapExpression(queueAssignments[0].right).arguments[0],
		) ||
		!isUndefinedCallback(
			unwrapExpression(queueAssignments[0].right).arguments[1],
		) ||
		enqueueReturns.length !== 1 ||
		!sameChain(enqueueReturns[0].expression, ["pending"])
	) {
		return false;
	}

	const apply = callableBody(body, "applyInQueue");
	if (
		apply === undefined ||
		!hasBinary(
			apply,
			["decoded", "workspaceId"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["current", "snapshot", "workspaceId"],
		) ||
		!hasBinary(apply, ["decoded", "revision"], ts.SyntaxKind.LessThanToken, [
			"current",
			"snapshot",
			"revision",
		]) ||
		!hasBinary(
			apply,
			["decoded", "revision"],
			ts.SyntaxKind.EqualsEqualsEqualsToken,
			["current", "snapshot", "revision"],
		) ||
		!hasBinary(apply, ["decodedKey"], ts.SyntaxKind.EqualsEqualsEqualsToken, [
			"current",
			"topologyKey",
		]) ||
		callsNamed(apply, "loadAuthoritativeSnapshot").length !== 1
	) {
		return false;
	}
	const staleBranches = descendants(apply, ts.isIfStatement).filter((branch) =>
		hasBinary(
			branch.expression,
			["decoded", "revision"],
			ts.SyntaxKind.LessThanToken,
			["current", "snapshot", "revision"],
		),
	);
	const workspaceIdBranches = descendants(apply, ts.isIfStatement).filter(
		(branch) =>
			hasBinary(
				branch.expression,
				["decoded", "workspaceId"],
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
				["current", "snapshot", "workspaceId"],
			),
	);
	const equalRevisionBranches = descendants(apply, ts.isIfStatement).filter(
		(branch) =>
			hasBinary(
				branch.expression,
				["decoded", "revision"],
				ts.SyntaxKind.EqualsEqualsEqualsToken,
				["current", "snapshot", "revision"],
			),
	);
	const equalTopologyBranches =
		equalRevisionBranches.length === 1
			? descendants(
					equalRevisionBranches[0].thenStatement,
					ts.isIfStatement,
				).filter((branch) =>
					hasBinary(
						branch.expression,
						["decodedKey"],
						ts.SyntaxKind.EqualsEqualsEqualsToken,
						["current", "topologyKey"],
					),
				)
			: [];
	if (
		staleBranches.length !== 1 ||
		descendants(
			staleBranches[0].thenStatement,
			(node) =>
				ts.isNewExpression(node) &&
				sameChain(node.expression, ["WorkspaceProjectionConflictError"]),
		).length !== 1 ||
		workspaceIdBranches.length !== 1 ||
		directThrowCall(workspaceIdBranches[0].thenStatement, ["failPermanently"])
			.length !== 1 ||
		equalRevisionBranches.length !== 1 ||
		directThrowCall(equalRevisionBranches[0].thenStatement, ["failPermanently"])
			.length !== 1 ||
		equalTopologyBranches.length !== 1 ||
		descendants(
			equalTopologyBranches[0].thenStatement,
			(node) =>
				ts.isReturnStatement(node) &&
				sameChain(node.expression, ["current", "projection", "identifier"]),
		).length !== 1
	) {
		return false;
	}
	const compatible = callableBody(body, "assertCompatibleSnapshot");
	if (
		compatible === undefined ||
		!hasBinary(
			compatible,
			["candidate", "workspaceId"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["current", "snapshot", "workspaceId"],
		) ||
		!hasBinary(
			compatible,
			["candidate", "revision"],
			ts.SyntaxKind.LessThanToken,
			["failed", "revision"],
		) ||
		!hasBinary(
			compatible,
			["candidate", "revision"],
			ts.SyntaxKind.EqualsEqualsEqualsToken,
			["failed", "revision"],
		) ||
		!hasBinary(
			compatible,
			["candidateKey"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["failedKey"],
		) ||
		!hasBinary(
			compatible,
			["candidate", "revision"],
			ts.SyntaxKind.EqualsEqualsEqualsToken,
			["current", "snapshot", "revision"],
		) ||
		!hasBinary(
			compatible,
			["candidateKey"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["current", "topologyKey"],
		)
	) {
		return false;
	}

	const reinitialize = callableBody(body, "reinitializeProjectedState");
	if (reinitialize === undefined) {
		return false;
	}
	const dispatches = callsNamed(reinitialize, "reinitializeWorkspace");
	const watcherAuthorityDispatches = callsNamed(
		reinitialize,
		"acceptWatcherAuthority",
	);
	const fatalGuards = descendants(reinitialize, ts.isIfStatement).filter(
		(branch) =>
			hasBinary(
				branch.expression,
				["fatalError"],
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
				["undefined"],
			),
	);
	if (
		dispatches.length !== 1 ||
		watcherAuthorityDispatches.length !== 1 ||
		!fatalOnlyCatchAround(reinitialize, dispatches[0]) ||
		fatalGuards.length !== 1 ||
		descendants(
			fatalGuards[0].thenStatement,
			(node) =>
				ts.isThrowStatement(node) && sameChain(node.expression, ["fatalError"]),
		).length !== 1 ||
		fatalGuards[0].pos >= dispatches[0].pos ||
		watcherAuthorityDispatches[0].pos >= dispatches[0].pos ||
		callsNamed(body, "reinitializeProjectedState").length !== 1
	) {
		return false;
	}
	if (callsNamed(reinitialize, "loadAuthoritativeSnapshot").length !== 0) {
		return false;
	}
	const adoptionCalls = callsNamed(reinitialize, "assertWorkbenchAdoption");
	const currentAssignment = assignmentPosition(
		reinitialize,
		["current"],
		["projected"],
	);
	if (
		adoptionCalls.length !== 1 ||
		currentAssignment === undefined ||
		dispatches[0].pos >= adoptionCalls[0].pos ||
		adoptionCalls[0].pos >= currentAssignment
	) {
		return false;
	}

	const returned = body.statements
		.filter(ts.isReturnStatement)
		.map((statement) => unwrapFreeze(statement.expression))
		.find(ts.isObjectLiteralExpression);
	const complete = objectProperty(returned, "completeInitial");
	const prepareInitial = objectProperty(returned, "prepareInitial");
	const applyMethod = objectProperty(returned, "apply");
	const mutationMethod = objectProperty(returned, "runMutation");
	const mutationInQueue = callableBody(body, "runMutationInQueue");
	const rejectedMutation = callableBody(body, "reconcileRejectedMutation");
	if (
		!ts.isMethodDeclaration(prepareInitial) ||
		!ts.isMethodDeclaration(complete) ||
		!ts.isMethodDeclaration(applyMethod) ||
		!ts.isMethodDeclaration(mutationMethod) ||
		mutationInQueue === undefined ||
		rejectedMutation === undefined
	) {
		return false;
	}
	const initialProjects = callsNamed(prepareInitial, "projectDecodedSnapshot");
	const initialWatcherAuthority = callsNamed(
		prepareInitial,
		"acceptWatcherAuthority",
	);
	const preparedInitialAssignment = assignmentPosition(
		prepareInitial,
		["preparedInitial"],
		["projected"],
	);
	if (
		initialProjects.length !== 1 ||
		initialWatcherAuthority.length !== 1 ||
		preparedInitialAssignment === undefined ||
		initialProjects[0].pos >= initialWatcherAuthority[0].pos ||
		initialWatcherAuthority[0].pos >= preparedInitialAssignment ||
		callsNamed(body, "acceptWatcherAuthority").length !== 2
	) {
		return false;
	}
	const nativeMutations = callsNamed(mutationInQueue, "mutation");
	const mutationApplies = callsNamed(mutationInQueue, "applyInQueue");
	const mutationReconciliations = callsNamed(
		mutationInQueue,
		"reconcileRejectedMutation",
	);
	const mutationFatalGuards = descendants(
		mutationInQueue,
		ts.isIfStatement,
	).filter((branch) =>
		hasBinary(
			branch.expression,
			["fatalError"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["undefined"],
		),
	);
	if (
		nativeMutations.length !== 1 ||
		mutationApplies.length !== 1 ||
		mutationReconciliations.length !== 1 ||
		mutationFatalGuards.length !== 1 ||
		descendants(
			mutationFatalGuards[0].thenStatement,
			(node) =>
				ts.isThrowStatement(node) && sameChain(node.expression, ["fatalError"]),
		).length !== 1 ||
		mutationFatalGuards[0].pos >= nativeMutations[0].pos ||
		nativeMutations[0].pos >= mutationApplies[0].pos
	) {
		return false;
	}
	const mutationTries = descendants(mutationInQueue, ts.isTryStatement).filter(
		(statement) => containsNode(statement.tryBlock, nativeMutations[0]),
	);
	const mutationCatchStatements =
		mutationTries[0]?.catchClause?.block.statements;
	if (
		mutationTries.length !== 1 ||
		mutationCatchStatements?.length !== 1 ||
		!ts.isReturnStatement(mutationCatchStatements[0]) ||
		!containsNode(mutationCatchStatements[0], mutationReconciliations[0])
	) {
		return false;
	}
	const authorityLoads = callsNamed(
		rejectedMutation,
		"loadAuthoritativeSnapshot",
	);
	const authorityApplies = callsNamed(rejectedMutation, "applyInQueue");
	if (
		authorityLoads.length !== 1 ||
		authorityApplies.length !== 1 ||
		!fatalOnlyCatchAround(rejectedMutation, authorityLoads[0]) ||
		!fatalOnlyCatchAround(rejectedMutation, authorityApplies[0]) ||
		!hasBinary(
			rejectedMutation,
			["authoritative", "workspaceId"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["current", "snapshot", "workspaceId"],
		) ||
		!hasBinary(
			rejectedMutation,
			["authoritative", "revision"],
			ts.SyntaxKind.LessThanToken,
			["current", "snapshot", "revision"],
		) ||
		!hasBinary(
			rejectedMutation,
			["authoritative", "revision"],
			ts.SyntaxKind.EqualsEqualsEqualsToken,
			["current", "snapshot", "revision"],
		) ||
		!hasBinary(
			rejectedMutation,
			["authoritativeKey"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["current", "topologyKey"],
		) ||
		descendants(
			rejectedMutation,
			(node) =>
				ts.isThrowStatement(node) && sameChain(node.expression, ["error"]),
		).length !== 2
	) {
		return false;
	}
	const initialAdoption = callsNamed(complete, "assertWorkbenchAdoption");
	const initialDispatches = callsNamed(complete, "reinitializeWorkspace");
	const initialAssignment = assignmentPosition(
		complete,
		["current"],
		["initial"],
	);
	return (
		callsNamed(body, "reinitializeWorkspace").length === 2 &&
		initialDispatches.length === 1 &&
		fatalOnlyCatchAround(complete, initialDispatches[0]) &&
		callsNamed(complete, "loadAuthoritativeSnapshot").length === 0 &&
		initialAdoption.length === 1 &&
		initialAssignment !== undefined &&
		initialAdoption[0].pos < initialAssignment &&
		callWithChain(complete, ["enqueue"]).length === 1 &&
		callWithChain(applyMethod, ["enqueue"]).length === 1 &&
		callsNamed(applyMethod, "applyInQueue").length === 1 &&
		callWithChain(mutationMethod, ["enqueue"]).length === 1 &&
		callsNamed(mutationMethod, "runMutationInQueue").length === 1
	);
}

function isOrderedRootUriComparison(binary) {
	if (
		!ts.isBinaryExpression(binary) ||
		binary.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken ||
		!sameChain(binary.left, ["uri"])
	) {
		return false;
	}
	const right = unwrapExpression(binary.right);
	if (!ts.isPropertyAccessExpression(right) || right.name.text !== "uri") {
		return false;
	}
	const element = unwrapExpression(right.expression);
	return (
		ts.isElementAccessExpression(element) &&
		sameChain(element.expression, ["projected", "snapshot", "roots"]) &&
		sameChain(element.argumentExpression, ["index"])
	);
}

function validateAdoption(sourceFile) {
	if (sourceFile.parseDiagnostics.length !== 0) {
		return false;
	}
	const coordinator = callableBody(
		sourceFile,
		"createWorkspaceTopologyCoordinator",
	);
	const adoption =
		coordinator === undefined
			? undefined
			: callableBody(coordinator, "assertWorkbenchAdoption");
	if (adoption === undefined) {
		return false;
	}
	const readCalls = callsNamed(adoption, "readWorkbenchAdoption");
	const expectedDeclarations = variableDeclarations(
		adoption,
		"expectedConfigPath",
	);
	const expected =
		expectedDeclarations.length === 1
			? unwrapExpression(expectedDeclarations[0].initializer)
			: undefined;
	const adoptedAssignments = descendants(
		adoption,
		(node) =>
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			sameChain(node.left, ["adoptedConfigPath"]) &&
			ts.isCallExpression(unwrapExpression(node.right)) &&
			sameChain(unwrapExpression(node.right).expression, [
				"adoption",
				"configPath",
				"toString",
			]) &&
			unwrapExpression(node.right).arguments.length === 0,
	);
	const mismatchBranches = descendants(adoption, ts.isIfStatement).filter(
		(branch) =>
			hasBinary(
				branch.expression,
				["adoption", "id"],
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
				["projected", "snapshot", "workspaceId"],
			),
	);
	if (
		readCalls.length !== 1 ||
		!fatalOnlyCatchAround(adoption, readCalls[0]) ||
		!ts.isConditionalExpression(expected) ||
		!ts.isBinaryExpression(unwrapExpression(expected.condition)) ||
		unwrapExpression(expected.condition).operatorToken.kind !==
			ts.SyntaxKind.InKeyword ||
		!ts.isStringLiteralLike(
			unwrapExpression(unwrapExpression(expected.condition).left),
		) ||
		unwrapExpression(unwrapExpression(expected.condition).left).text !==
			"configPath" ||
		!sameChain(unwrapExpression(expected.condition).right, [
			"projected",
			"projection",
			"identifier",
		]) ||
		!ts.isCallExpression(unwrapExpression(expected.whenTrue)) ||
		!sameChain(unwrapExpression(expected.whenTrue).expression, [
			"projected",
			"projection",
			"identifier",
			"configPath",
			"toString",
		]) ||
		unwrapExpression(expected.whenTrue).arguments.length !== 0 ||
		!sameChain(expected.whenFalse, ["undefined"]) ||
		adoptedAssignments.length !== 1 ||
		!fatalOnlyCatchAround(adoption, adoptedAssignments[0]) ||
		!hasBinary(
			adoption,
			["adoption", "id"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["projected", "snapshot", "workspaceId"],
		) ||
		!hasBinary(
			adoption,
			["adoptedConfigPath"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["expectedConfigPath"],
		) ||
		!hasBinary(
			adoption,
			["adoption", "rootUris", "length"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			["projected", "snapshot", "roots", "length"],
		) ||
		mismatchBranches.length !== 1 ||
		directThrowCall(mismatchBranches[0].thenStatement, ["failPermanently"])
			.length !== 1
	) {
		return false;
	}
	const someCalls = callWithChain(adoption, ["adoption", "rootUris", "some"]);
	if (someCalls.length !== 1 || someCalls[0].arguments.length !== 1) {
		return false;
	}
	const callback = unwrapExpression(someCalls[0].arguments[0]);
	return (
		(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
		callback.parameters.length >= 2 &&
		ts.isIdentifier(callback.parameters[0].name) &&
		callback.parameters[0].name.text === "uri" &&
		ts.isIdentifier(callback.parameters[1].name) &&
		callback.parameters[1].name.text === "index" &&
		descendants(callback.body, isOrderedRootUriComparison).length === 1
	);
}

function computedDescriptorToken(name) {
	if (!ts.isComputedPropertyName(name)) {
		return undefined;
	}
	const expression = unwrapExpression(name.expression);
	if (
		!ts.isCallExpression(expression) ||
		expression.arguments.length !== 0 ||
		!ts.isPropertyAccessExpression(expression.expression) ||
		expression.expression.name.text !== "toString"
	) {
		return undefined;
	}
	const receiver = propertyChain(expression.expression.expression);
	return receiver?.length === 1 ? receiver[0] : undefined;
}

function isExactDescriptor(property, implementation) {
	if (!ts.isPropertyAssignment(property)) {
		return false;
	}
	const initializer = unwrapExpression(property.initializer);
	return (
		ts.isNewExpression(initializer) &&
		sameChain(initializer.expression, ["SyncDescriptor"]) &&
		initializer.arguments?.length === 3 &&
		sameChain(initializer.arguments[0], [implementation]) &&
		ts.isArrayLiteralExpression(unwrapExpression(initializer.arguments[1])) &&
		unwrapExpression(initializer.arguments[1]).elements.length === 0 &&
		initializer.arguments[2].kind === ts.SyntaxKind.TrueKeyword
	);
}

function validateServiceDescriptors(sourceFile) {
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		!importsNamedValue(
			sourceFile,
			"./services/plain-workspace-services",
			"PlainWorkspaceEditingService",
		) ||
		!importsNamedValue(
			sourceFile,
			"./services/plain-workspace-services",
			"PlainWorkspacesService",
		)
	) {
		return false;
	}
	const factory = callableBody(sourceFile, "createServiceOverrides");
	const returned =
		factory === undefined ? undefined : directReturnedExpression(factory);
	if (!ts.isObjectLiteralExpression(returned)) {
		return false;
	}
	const configurationIndex = returned.properties.findIndex(
		(property) =>
			ts.isSpreadAssignment(property) &&
			ts.isCallExpression(unwrapExpression(property.expression)) &&
			callName(unwrapExpression(property.expression)) ===
				"getConfigurationServiceOverride",
	);
	const configurationSpreads = returned.properties.filter(
		(property) =>
			ts.isSpreadAssignment(property) &&
			ts.isCallExpression(unwrapExpression(property.expression)) &&
			callName(unwrapExpression(property.expression)) ===
				"getConfigurationServiceOverride",
	);
	const lastSpreadIndex = returned.properties.reduce(
		(lastIndex, property, index) =>
			ts.isSpreadAssignment(property) ? index : lastIndex,
		-1,
	);
	if (configurationIndex < 0 || configurationSpreads.length !== 1) {
		return false;
	}
	for (const [token, implementation] of [
		["IWorkspaceEditingService", "PlainWorkspaceEditingService"],
		["IWorkspacesService", "PlainWorkspacesService"],
	]) {
		const descriptors = returned.properties
			.map((property, index) => ({ property, index }))
			.filter(({ property }) =>
				ts.isPropertyAssignment(property)
					? computedDescriptorToken(property.name) === token
					: false,
			);
		if (
			descriptors.length !== 1 ||
			descriptors[0].index <= lastSpreadIndex ||
			!isExactDescriptor(descriptors[0].property, implementation)
		) {
			return false;
		}
	}
	return true;
}

function validatePlainServiceImplementation(sourceFile) {
	if (sourceFile.parseDiagnostics.length !== 0) {
		return false;
	}
	const rejectBody = callableBody(
		sourceFile,
		"rejectGenericWorkspaceOperation",
	);
	const rejection =
		rejectBody === undefined ? undefined : directReturnedExpression(rejectBody);
	if (
		!isPromiseRejectNew(rejection, "PlainWorkspaceOperationUnsupportedError")
	) {
		return false;
	}
	const editing = descendants(
		sourceFile,
		(node) =>
			ts.isClassDeclaration(node) &&
			node.name?.text === "PlainWorkspaceEditingService",
	);
	const workspaces = descendants(
		sourceFile,
		(node) =>
			ts.isClassDeclaration(node) &&
			node.name?.text === "PlainWorkspacesService",
	);
	const recentExpression =
		workspaces.length === 1
			? promiseResolveArgument(
					directMethodReturnExpression(workspaces[0], "getRecentlyOpened"),
				)
			: undefined;
	const recentWorkspaces = objectProperty(recentExpression, "workspaces");
	const recentFiles = objectProperty(recentExpression, "files");
	const dirtyExpression =
		workspaces.length === 1
			? promiseResolveArgument(
					directMethodReturnExpression(workspaces[0], "getDirtyWorkspaces"),
				)
			: undefined;
	return (
		editing.length === 1 &&
		workspaces.length === 1 &&
		EDITING_REJECTION_METHODS.every((method) =>
			directMethodReturnCall(editing[0], method, [
				"rejectGenericWorkspaceOperation",
			]),
		) &&
		WORKSPACES_REJECTION_METHODS.every((method) =>
			directMethodReturnCall(workspaces[0], method, [
				"rejectGenericWorkspaceOperation",
			]),
		) &&
		["addRecentlyOpened", "removeRecentlyOpened", "clearRecentlyOpened"].every(
			(method) =>
				directMethodReturnCall(workspaces[0], method, ["Promise", "resolve"]),
		) &&
		ts.isObjectLiteralExpression(recentExpression) &&
		recentExpression.properties.length === 2 &&
		ts.isPropertyAssignment(recentWorkspaces) &&
		isEmptyArray(unwrapExpression(recentWorkspaces.initializer)) &&
		ts.isPropertyAssignment(recentFiles) &&
		isEmptyArray(unwrapExpression(recentFiles.initializer)) &&
		isEmptyArray(dirtyExpression)
	);
}

function validateWorkspaceRemoveCommandIr(sourceFile) {
	const fixedConst = (name) => {
		const declarations = variableDeclarations(sourceFile, name);
		return declarations.length === 1 &&
			isConstVariableDeclaration(declarations[0])
			? declarations[0]
			: undefined;
	};
	const pickId = fixedConst("PICK_WORKSPACE_FOLDER_COMMAND_ID");
	const scheme = fixedConst("PLAIN_WORKSPACE_SCHEME");
	const uuidPattern = fixedConst("UUID_V4_PATTERN");
	const componentKeys = fixedConst("URI_COMPONENT_KEYS");
	const invalidCode = fixedConst("PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID");
	const invalidFunctions = callableDeclarations(
		sourceFile,
		"invalidWorkspaceRootResource",
	);
	const rootIdFunctions = callableDeclarations(sourceFile, "workspaceRootId");
	const folderFunctions = callableDeclarations(
		sourceFile,
		"workspaceFolderResource",
	);
	const invalidClasses = sourceFile.statements.filter(
		(statement) =>
			ts.isClassDeclaration(statement) &&
			statement.name?.text === "PlainWorkspaceRootResourceInvalidError",
	);
	const removeRootDeclarations = variableDeclarations(sourceFile, "removeRoot");
	const uuidInitializer = unwrapExpression(uuidPattern?.initializer);
	return (
		isExactStringLiteral(
			unwrapExpression(pickId?.initializer),
			"_workbench.pickWorkspaceFolder",
		) &&
		isExactStringLiteral(
			unwrapExpression(scheme?.initializer),
			"plain-workspace",
		) &&
		uuidInitializer?.kind === ts.SyntaxKind.RegularExpressionLiteral &&
		uuidInitializer.text ===
			"/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/" &&
		sameStringArray(arrayLiteralStrings(componentKeys?.initializer), [
			"scheme",
			"authority",
			"path",
			"query",
			"fragment",
		]) &&
		isExactStringLiteral(
			unwrapExpression(invalidCode?.initializer),
			"PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID",
		) &&
		invalidClasses.length === 1 &&
		hasExactSyntaxTokens(
			invalidClasses[0],
			`class PlainWorkspaceRootResourceInvalidError extends TypeError {
				readonly code = PLAIN_WORKSPACE_ROOT_RESOURCE_INVALID;
				constructor() {
					super("The workspace root URI is invalid.");
					this.name = "PlainWorkspaceRootResourceInvalidError";
					Object.freeze(this);
				}
			}`,
		) &&
		invalidFunctions.length === 1 &&
		hasExactSyntaxTokens(
			invalidFunctions[0],
			`function invalidWorkspaceRootResource(): never {
				throw new PlainWorkspaceRootResourceInvalidError();
			}`,
		) &&
		rootIdFunctions.length === 1 &&
		hasExactSyntaxTokens(
			rootIdFunctions[0],
			`function workspaceRootId(resource: unknown): string {
				try {
					if (!(resource instanceof URI)) {
						return invalidWorkspaceRootResource();
					}
					const descriptors = Object.getOwnPropertyDescriptors(resource);
					const components: Record<string, string> = Object.create(null);
					for (const key of URI_COMPONENT_KEYS) {
						const descriptor = descriptors[key];
						if (
							descriptor === undefined ||
							!("value" in descriptor) ||
							descriptor.get !== undefined ||
							descriptor.set !== undefined ||
							typeof descriptor.value !== "string"
						) {
							return invalidWorkspaceRootResource();
						}
						components[key] = descriptor.value;
					}
					for (const key of Reflect.ownKeys(descriptors)) {
						if (typeof key !== "string") {
							return invalidWorkspaceRootResource();
						}
						const descriptor = descriptors[key];
						if (
							descriptor === undefined ||
							!("value" in descriptor) ||
							descriptor.get !== undefined ||
							descriptor.set !== undefined ||
							(typeof descriptor.value !== "string" &&
								descriptor.value !== null)
						) {
							return invalidWorkspaceRootResource();
						}
					}
					structuredClone(resource);
					if (
						components.scheme !== PLAIN_WORKSPACE_SCHEME ||
						!UUID_V4_PATTERN.test(components.authority!) ||
						components.path !== "/" ||
						components.query !== "" ||
						components.fragment !== ""
					) {
						return invalidWorkspaceRootResource();
					}
					return components.authority!;
				} catch {
					return invalidWorkspaceRootResource();
				}
			}`,
		) &&
		folderFunctions.length === 1 &&
		hasExactSyntaxTokens(
			folderFunctions[0],
			`function workspaceFolderResource(folder: unknown): unknown {
				try {
					if (typeof folder !== "object" || folder === null) {
						return invalidWorkspaceRootResource();
					}
					const descriptor = Object.getOwnPropertyDescriptor(folder, "uri");
					if (
						descriptor === undefined ||
						!("value" in descriptor) ||
						descriptor.get !== undefined ||
						descriptor.set !== undefined
					) {
						return invalidWorkspaceRootResource();
					}
					return descriptor.value;
				} catch {
					return invalidWorkspaceRootResource();
				}
			}`,
		) &&
		removeRootDeclarations.length === 1 &&
		isConstVariableDeclaration(removeRootDeclarations[0]) &&
		hasExactSyntaxTokens(
			removeRootDeclarations[0],
			`removeRoot = (commandService: ICommandService, resource: unknown) =>
				topologyCoordinator.runMutation(async () => {
					let selectedResource = resource;
					if (selectedResource === undefined) {
						const folder = await commandService.executeCommand<unknown>(
							PICK_WORKSPACE_FOLDER_COMMAND_ID,
						);
						if (folder === undefined) {
							return Object.freeze({
								result: undefined,
								snapshot: undefined,
							});
						}
						selectedResource = workspaceFolderResource(folder);
					}
					const rootId = workspaceRootId(selectedResource);
					const snapshot = await bridge.workspaceRemoveRoot(rootId);
					return Object.freeze({ result: undefined, snapshot });
				})`,
		)
	);
}

function validateGuardedCommands(sourceFile) {
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		!importsNamedValue(sourceFile, COMMAND_SERVICE_MODULE, "ICommandService") ||
		!importsNamedValue(sourceFile, URI_MODULE, "URI") ||
		!importsNamedValue(
			sourceFile,
			"../../services/plain-workspace-services",
			"PlainWorkspaceOperationUnsupportedError",
		) ||
		!validateWorkspaceRemoveCommandIr(sourceFile)
	) {
		return false;
	}
	const commandFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "registerWorkspaceCommands" &&
			statement.body !== undefined,
	);
	if (commandFunctions.length !== 1) {
		return false;
	}
	const commandFunction = commandFunctions[0];
	const [bridgeParameter, contextKeyParameter, topologyParameter] =
		commandFunction.parameters;
	if (
		commandFunction.parameters.length !== 3 ||
		!isExactTypedParameter(bridgeParameter, "bridge", "PlainBridge") ||
		!isExactTypedParameter(
			contextKeyParameter,
			"contextKeyService",
			"IContextKeyService",
		) ||
		!isExactTypedParameter(
			topologyParameter,
			"topologyCoordinator",
			"WorkspaceTopologyCoordinator",
		)
	) {
		return false;
	}
	const declarations = variableDeclarations(
		sourceFile,
		"GUARDED_WORKSPACE_COMMAND_IDS",
	);
	const guardedFreeze =
		declarations.length === 1
			? unwrapExpression(declarations[0].initializer)
			: undefined;
	const guardedFreezeReceiver = directMethodReceiver(
		guardedFreeze,
		"Object",
		"freeze",
	);
	if (
		declarations.length !== 1 ||
		guardedFreezeReceiver === undefined ||
		guardedFreeze.arguments.length !== 1 ||
		!sameStringArray(
			arrayLiteralStrings(guardedFreeze.arguments[0]),
			EXPECTED_GUARDED_WORKSPACE_COMMAND_IDS,
		)
	) {
		return false;
	}
	const maps = callWithChain(sourceFile, [
		"GUARDED_WORKSPACE_COMMAND_IDS",
		"map",
	]);
	if (maps.length !== 1 || maps[0].arguments.length !== 1) {
		return false;
	}
	const mapCallback = unwrapExpression(maps[0].arguments[0]);
	if (
		(!ts.isArrowFunction(mapCallback) &&
			!ts.isFunctionExpression(mapCallback)) ||
		mapCallback.parameters.length !== 1 ||
		!ts.isIdentifier(mapCallback.parameters[0].name)
	) {
		return false;
	}
	const idName = mapCallback.parameters[0].name.text;
	const registration = expressionBody(mapCallback);
	const registrationReceiver = directMethodReceiver(
		registration,
		"CommandsRegistry",
		"registerCommand",
	);
	if (
		!ts.isCallExpression(registration) ||
		registrationReceiver === undefined ||
		registration.arguments.length !== 2 ||
		!sameChain(registration.arguments[0], [idName])
	) {
		return false;
	}
	const handler = unwrapExpression(registration.arguments[1]);
	const rejection = expressionBody(handler);
	const promiseReceiver = directMethodReceiver(rejection, "Promise", "reject");
	const rejectionError =
		ts.isCallExpression(rejection) && rejection.arguments.length === 1
			? unwrapExpression(rejection.arguments[0])
			: undefined;
	const rejectionErrorIdentifier = ts.isNewExpression(rejectionError)
		? unwrapExpression(rejectionError.expression)
		: undefined;
	const rejectionErrorImport = namedImportLocalIdentifier(
		sourceFile,
		"../../services/plain-workspace-services",
		"PlainWorkspaceOperationUnsupportedError",
	);
	const pickDeclarations = variableDeclarations(sourceFile, "pickRoots");
	const pickDeclaration =
		pickDeclarations.length === 1 ? pickDeclarations[0] : undefined;
	const pickInitializer =
		pickDeclaration !== undefined
			? unwrapExpression(pickDeclaration.initializer)
			: undefined;
	const pickParameter = ts.isArrowFunction(pickInitializer)
		? pickInitializer.parameters[0]
		: undefined;
	const pickParameterTypes =
		pickParameter?.type !== undefined && ts.isUnionTypeNode(pickParameter.type)
			? pickParameter.type.types.map((typeNode) => {
					if (
						!ts.isLiteralTypeNode(typeNode) ||
						!ts.isStringLiteralLike(typeNode.literal)
					) {
						return undefined;
					}
					return typeNode.literal.text;
				})
			: undefined;
	const queuedMutation =
		ts.isArrowFunction(pickInitializer) && !ts.isBlock(pickInitializer.body)
			? unwrapExpression(pickInitializer.body)
			: undefined;
	const mutationCallback =
		ts.isCallExpression(queuedMutation) &&
		sameChain(queuedMutation.expression, [
			"topologyCoordinator",
			"runMutation",
		]) &&
		queuedMutation.arguments.length === 1
			? unwrapExpression(queuedMutation.arguments[0])
			: undefined;
	const topologyReceiver = directMethodReceiver(
		queuedMutation,
		"topologyCoordinator",
		"runMutation",
	);
	const mutationStatements =
		ts.isArrowFunction(mutationCallback) && ts.isBlock(mutationCallback.body)
			? mutationCallback.body.statements
			: [];
	const resultStatement = mutationStatements[0];
	const resultDeclaration =
		ts.isVariableStatement(resultStatement) &&
		resultStatement.declarationList.declarations.length === 1
			? resultStatement.declarationList.declarations[0]
			: undefined;
	const awaitedPick =
		resultDeclaration?.initializer !== undefined
			? unwrapExpression(resultDeclaration.initializer)
			: undefined;
	const nativePick = ts.isAwaitExpression(awaitedPick)
		? unwrapExpression(awaitedPick.expression)
		: undefined;
	const nativePickReceiver = directMethodReceiver(
		nativePick,
		"bridge",
		"workspacePickRoots",
	);
	const nativeModeArgument = ts.isCallExpression(nativePick)
		? unwrapExpression(nativePick.arguments[0])
		: undefined;
	const mutationReturn = mutationStatements[1];
	const mutationFreeze = ts.isReturnStatement(mutationReturn)
		? unwrapExpression(mutationReturn.expression)
		: undefined;
	const mutationFreezeReceiver = directMethodReceiver(
		mutationFreeze,
		"Object",
		"freeze",
	);
	const mutationResultObject =
		mutationFreezeReceiver !== undefined &&
		mutationFreeze.arguments.length === 1
			? unwrapExpression(mutationFreeze.arguments[0])
			: undefined;
	const mutationResultProperty = ts.isObjectLiteralExpression(
		mutationResultObject,
	)
		? mutationResultObject.properties[0]
		: undefined;
	const mutationSnapshotProperty = ts.isObjectLiteralExpression(
		mutationResultObject,
	)
		? mutationResultObject.properties[1]
		: undefined;
	const mutationSnapshot = ts.isPropertyAssignment(mutationSnapshotProperty)
		? unwrapExpression(mutationSnapshotProperty.initializer)
		: undefined;
	const commandIdDeclarations = variableDeclarations(
		sourceFile,
		"WORKSPACE_COMMAND_IDS",
	);
	const commandIdFreeze =
		commandIdDeclarations.length === 1
			? unwrapExpression(commandIdDeclarations[0].initializer)
			: undefined;
	const commandIdFreezeReceiver = directMethodReceiver(
		commandIdFreeze,
		"Object",
		"freeze",
	);
	const commandIdObject =
		commandIdFreezeReceiver !== undefined &&
		commandIdFreeze.arguments.length === 1
			? unwrapExpression(commandIdFreeze.arguments[0])
			: undefined;
	const commandRegistrations = callsNamed(sourceFile, "registerCommand");
	const productRegistrations = commandRegistrations.filter((call) => {
		const chain = propertyChain(call.arguments[0]);
		return chain?.length === 2 && chain[0] === "WORKSPACE_COMMAND_IDS";
	});
	const analyzeProduct = ([property, id]) => {
		const idProperty = objectProperty(commandIdObject, property);
		const matches = productRegistrations.filter((call) =>
			sameChain(call.arguments[0], ["WORKSPACE_COMMAND_IDS", property]),
		);
		const productRegistration = matches.length === 1 ? matches[0] : undefined;
		const registryReceiver = directMethodReceiver(
			productRegistration,
			"CommandsRegistry",
			"registerCommand",
		);
		const productHandler =
			productRegistration?.arguments.length === 2
				? unwrapExpression(productRegistration.arguments[1])
				: undefined;
		const route =
			ts.isArrowFunction(productHandler) && !ts.isBlock(productHandler.body)
				? unwrapExpression(productHandler.body)
				: undefined;
		const routeIdentifier = ts.isCallExpression(route)
			? unwrapExpression(route.expression)
			: undefined;
		return {
			property,
			id,
			idProperty,
			productRegistration,
			registryReceiver,
			productHandler,
			route,
			routeIdentifier,
			validId:
				ts.isPropertyAssignment(idProperty) &&
				ts.isStringLiteralLike(unwrapExpression(idProperty.initializer)) &&
				unwrapExpression(idProperty.initializer).text === id &&
				productRegistration !== undefined &&
				registryReceiver !== undefined,
		};
	};
	const pickerProductAnalyses = pickerProductContracts.map((contract) => {
		const analysis = analyzeProduct(contract);
		const mode = contract[2];
		return {
			...analysis,
			valid:
				analysis.validId &&
				ts.isArrowFunction(analysis.productHandler) &&
				analysis.productHandler.parameters.length === 0 &&
				ts.isCallExpression(analysis.route) &&
				ts.isIdentifier(analysis.routeIdentifier) &&
				analysis.routeIdentifier.text === "pickRoots" &&
				analysis.route.arguments.length === 1 &&
				ts.isStringLiteralLike(unwrapExpression(analysis.route.arguments[0])) &&
				unwrapExpression(analysis.route.arguments[0]).text === mode,
		};
	});
	const removeProductAnalyses = removeProductContracts.map((contract) => {
		const analysis = analyzeProduct(contract);
		const routeKind = contract[2];
		const parameters = ts.isArrowFunction(analysis.productHandler)
			? analysis.productHandler.parameters
			: [];
		const accessorParameter = parameters[0];
		const resourceParameter = parameters[1];
		const commandServiceCall = ts.isCallExpression(analysis.route)
			? unwrapExpression(analysis.route.arguments[0])
			: undefined;
		const commandServiceToken = ts.isCallExpression(commandServiceCall)
			? unwrapExpression(commandServiceCall.arguments[0])
			: undefined;
		const resourceArgument = ts.isCallExpression(analysis.route)
			? unwrapExpression(analysis.route.arguments[1])
			: undefined;
		const validParameters =
			ts.isArrowFunction(analysis.productHandler) &&
			parameters.length === (routeKind === "resource" ? 2 : 1) &&
			ts.isIdentifier(accessorParameter?.name) &&
			accessorParameter.name.text === "accessor" &&
			accessorParameter.dotDotDotToken === undefined &&
			accessorParameter.questionToken === undefined &&
			accessorParameter.initializer === undefined &&
			(routeKind !== "resource" ||
				(ts.isIdentifier(resourceParameter?.name) &&
					resourceParameter.name.text === "resource" &&
					resourceParameter.dotDotDotToken === undefined &&
					resourceParameter.questionToken === undefined &&
					resourceParameter.initializer === undefined));
		return {
			...analysis,
			accessorParameter,
			resourceParameter,
			commandServiceCall,
			commandServiceToken,
			resourceArgument,
			valid:
				analysis.validId &&
				validParameters &&
				ts.isCallExpression(analysis.route) &&
				ts.isIdentifier(analysis.routeIdentifier) &&
				analysis.routeIdentifier.text === "removeRoot" &&
				analysis.route.arguments.length === 2 &&
				ts.isCallExpression(commandServiceCall) &&
				sameChain(commandServiceCall.expression, ["accessor", "get"]) &&
				commandServiceCall.arguments.length === 1 &&
				ts.isIdentifier(commandServiceToken) &&
				commandServiceToken.text === "ICommandService" &&
				(routeKind === "resource"
					? ts.isIdentifier(resourceArgument) &&
						resourceArgument.text === "resource"
					: sameChain(resourceArgument, ["undefined"])),
		};
	});
	const productAnalyses = [...pickerProductAnalyses, ...removeProductAnalyses];
	const registrationsDeclarations = variableDeclarations(
		sourceFile,
		"registrations",
	);
	const registrationsDeclaration =
		registrationsDeclarations.length === 1
			? registrationsDeclarations[0]
			: undefined;
	const registrationsInitializer =
		registrationsDeclaration?.initializer !== undefined
			? unwrapExpression(registrationsDeclaration.initializer)
			: undefined;
	const registrationElements = ts.isArrayLiteralExpression(
		registrationsInitializer,
	)
		? registrationsInitializer.elements
		: [];
	const guardedRegistrationElement = registrationElements.at(
		productContracts.length,
	);
	const commandReturns = commandFunction.body.statements.filter(
		ts.isReturnStatement,
	);
	const commandReturn =
		commandReturns.length === 1 ? commandReturns[0] : undefined;
	const commandReturnObject = ts.isReturnStatement(commandReturn)
		? unwrapExpression(commandReturn.expression)
		: undefined;
	const disposeMethod = objectProperty(commandReturnObject, "dispose");
	const disposeLoop =
		ts.isMethodDeclaration(disposeMethod) && disposeMethod.body !== undefined
			? disposeMethod.body.statements[0]
			: undefined;
	const reverseCall = ts.isForOfStatement(disposeLoop)
		? unwrapExpression(disposeLoop.expression)
		: undefined;
	const reverseReceiver = directMethodReceiver(
		reverseCall,
		"registrations",
		"reverse",
	);
	const loopDeclaration =
		ts.isForOfStatement(disposeLoop) &&
		ts.isVariableDeclarationList(disposeLoop.initializer) &&
		disposeLoop.initializer.declarations.length === 1
			? disposeLoop.initializer.declarations[0]
			: undefined;
	const disposeBody =
		ts.isForOfStatement(disposeLoop) && ts.isBlock(disposeLoop.statement)
			? disposeLoop.statement
			: undefined;
	const disposeStatement = disposeBody?.statements[0];
	const disposeCall = ts.isExpressionStatement(disposeStatement)
		? unwrapExpression(disposeStatement.expression)
		: undefined;
	const disposeReceiver = directMethodReceiver(
		disposeCall,
		"registration",
		"dispose",
	);
	const commandRegistryImport = namedImportLocalIdentifier(
		sourceFile,
		COMMAND_REGISTRY_MODULE,
		"CommandsRegistry",
	);
	const hasClosedCommandRegistryBinding = hasExactIdentifierReferences(
		sourceFile,
		"CommandsRegistry",
		[
			commandRegistryImport,
			registrationReceiver,
			...productAnalyses.map(({ registryReceiver }) => registryReceiver),
		],
	);
	const removeRootDeclarations = variableDeclarations(sourceFile, "removeRoot");
	const removeRootDeclaration =
		removeRootDeclarations.length === 1 ? removeRootDeclarations[0] : undefined;
	const removeRootInitializer = unwrapExpression(
		removeRootDeclaration?.initializer,
	);
	const nativeRemoveCalls = callWithChain(sourceFile, [
		"bridge",
		"workspaceRemoveRoot",
	]);
	const nativeRemoveReceiver =
		nativeRemoveCalls.length === 1
			? directMethodReceiver(
					nativeRemoveCalls[0],
					"bridge",
					"workspaceRemoveRoot",
				)
			: undefined;
	const topologyCalls = callWithChain(sourceFile, [
		"topologyCoordinator",
		"runMutation",
	]);
	const removeTopologyCall = topologyCalls.find(
		(call) =>
			removeRootInitializer !== undefined &&
			containsNode(removeRootInitializer, call),
	);
	const removeTopologyReceiver = directMethodReceiver(
		removeTopologyCall,
		"topologyCoordinator",
		"runMutation",
	);
	const hasClosedPickRootsBinding = hasExactIdentifierReferences(
		sourceFile,
		"pickRoots",
		[
			pickDeclaration?.name,
			...pickerProductAnalyses.map(({ routeIdentifier }) => routeIdentifier),
		],
	);
	const hasClosedRemoveRootBinding = hasExactIdentifierReferences(
		sourceFile,
		"removeRoot",
		[
			removeRootDeclaration?.name,
			...removeProductAnalyses.map(({ routeIdentifier }) => routeIdentifier),
		],
	);
	const hasClosedBridgeBinding = hasExactIdentifierReferences(
		sourceFile,
		"bridge",
		[bridgeParameter.name, nativePickReceiver, nativeRemoveReceiver],
	);
	const hasClosedTopologyBinding = hasExactIdentifierReferences(
		sourceFile,
		"topologyCoordinator",
		[topologyParameter.name, topologyReceiver, removeTopologyReceiver],
	);
	const hasClosedModeBinding = hasExactIdentifierReferences(
		sourceFile,
		"mode",
		[pickParameter?.name, nativeModeArgument],
	);
	const objectMethodContracts = [
		["freeze", 7],
		["getOwnPropertyDescriptors", 1],
		["create", 1],
		["getOwnPropertyDescriptor", 1],
	];
	const objectCalls = objectMethodContracts.flatMap(([method]) =>
		callWithChain(sourceFile, ["Object", method]),
	);
	const objectReceivers = objectCalls.map((call) => {
		const expression = unwrapExpression(call.expression);
		return ts.isPropertyAccessExpression(expression)
			? unwrapExpression(expression.expression)
			: undefined;
	});
	const hasClosedObjectBinding =
		objectMethodContracts.every(
			([method, count]) =>
				callWithChain(sourceFile, ["Object", method]).length === count,
		) && hasExactIdentifierReferences(sourceFile, "Object", objectReceivers);
	const reflectCalls = callWithChain(sourceFile, ["Reflect", "ownKeys"]);
	const reflectReceiver =
		reflectCalls.length === 1
			? directMethodReceiver(reflectCalls[0], "Reflect", "ownKeys")
			: undefined;
	const hasClosedReflectBinding =
		reflectReceiver !== undefined &&
		hasExactIdentifierReferences(sourceFile, "Reflect", [reflectReceiver]);
	const structuredCloneCalls = directCallsNamed(sourceFile, "structuredClone");
	const structuredCloneCallees = structuredCloneCalls.map((call) =>
		unwrapExpression(call.expression),
	);
	const hasClosedStructuredCloneBinding =
		structuredCloneCalls.length === 1 &&
		structuredCloneCallees.every(ts.isIdentifier) &&
		hasExactIdentifierReferences(
			sourceFile,
			"structuredClone",
			structuredCloneCallees,
		);
	const hasClosedPromiseBinding = hasExactIdentifierReferences(
		sourceFile,
		"Promise",
		[promiseReceiver],
	);
	const hasClosedRejectionErrorBinding = hasExactIdentifierReferences(
		sourceFile,
		"PlainWorkspaceOperationUnsupportedError",
		[rejectionErrorImport, rejectionErrorIdentifier],
	);
	const commandServiceImport = namedImportLocalIdentifier(
		sourceFile,
		COMMAND_SERVICE_MODULE,
		"ICommandService",
	);
	const removeCommandServiceParameter =
		ts.isArrowFunction(removeRootInitializer) &&
		removeRootInitializer.parameters.length === 2
			? removeRootInitializer.parameters[0]
			: undefined;
	const removeCommandServiceType =
		removeCommandServiceParameter?.type !== undefined &&
		ts.isTypeReferenceNode(removeCommandServiceParameter.type)
			? unwrapExpression(removeCommandServiceParameter.type.typeName)
			: undefined;
	const hasClosedCommandServiceTokenBinding =
		commandServiceImport !== undefined &&
		ts.isIdentifier(removeCommandServiceType) &&
		removeCommandServiceType.text === "ICommandService" &&
		hasExactIdentifierReferences(sourceFile, "ICommandService", [
			commandServiceImport,
			removeCommandServiceType,
			...removeProductAnalyses.map(({ commandServiceToken }) =>
				ts.isIdentifier(commandServiceToken) ? commandServiceToken : undefined,
			),
		]);
	const uriImport = namedImportLocalIdentifier(sourceFile, URI_MODULE, "URI");
	const uriInstanceOfReferences = descendants(
		sourceFile,
		(node) =>
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
			ts.isIdentifier(unwrapExpression(node.right)) &&
			unwrapExpression(node.right).text === "URI",
	).map((expression) => unwrapExpression(expression.right));
	const hasClosedUriBinding =
		uriImport !== undefined &&
		uriInstanceOfReferences.length === 1 &&
		hasExactIdentifierReferences(sourceFile, "URI", [
			uriImport,
			uriInstanceOfReferences[0],
		]);
	const hasClosedRegistrationsBinding = hasExactIdentifierReferences(
		sourceFile,
		"registrations",
		[registrationsDeclaration?.name, reverseReceiver],
	);
	const hasClosedLoopRegistrationBinding = hasExactIdentifierReferences(
		sourceFile,
		"registration",
		[loopDeclaration?.name, disposeReceiver],
	);
	return (
		(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
		handler.parameters.length === 0 &&
		isPromiseRejectNew(rejection, "PlainWorkspaceOperationUnsupportedError") &&
		promiseReceiver !== undefined &&
		ts.isIdentifier(rejectionErrorIdentifier) &&
		rejectionErrorIdentifier.text ===
			"PlainWorkspaceOperationUnsupportedError" &&
		rejectionErrorImport !== undefined &&
		ts.isCallExpression(queuedMutation) &&
		topologyReceiver !== undefined &&
		pickDeclaration !== undefined &&
		isConstVariableDeclaration(pickDeclaration) &&
		ts.isArrowFunction(pickInitializer) &&
		pickInitializer.parameters.length === 1 &&
		pickParameter !== undefined &&
		ts.isIdentifier(pickParameter.name) &&
		pickParameter.name.text === "mode" &&
		pickParameter.dotDotDotToken === undefined &&
		pickParameter.questionToken === undefined &&
		pickParameter.initializer === undefined &&
		sameStringArray(pickParameterTypes, ["replace", "add"]) &&
		ts.isArrowFunction(mutationCallback) &&
		mutationCallback.parameters.length === 0 &&
		ts.isBlock(mutationCallback.body) &&
		mutationCallback.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		) === true &&
		mutationStatements.length === 2 &&
		resultDeclaration !== undefined &&
		isConstVariableDeclaration(resultDeclaration) &&
		ts.isIdentifier(resultDeclaration.name) &&
		resultDeclaration.name.text === "result" &&
		nativePickReceiver !== undefined &&
		ts.isCallExpression(nativePick) &&
		nativePick.arguments.length === 1 &&
		ts.isIdentifier(nativeModeArgument) &&
		nativeModeArgument.text === "mode" &&
		callWithChain(sourceFile, ["bridge", "workspacePickRoots"]).length === 1 &&
		nativeRemoveCalls.length === 1 &&
		nativeRemoveReceiver !== undefined &&
		removeRootInitializer !== undefined &&
		isDirectVariableDeclaration(commandFunction, removeRootDeclaration) &&
		containsNode(removeRootInitializer, nativeRemoveCalls[0]) &&
		topologyCalls.length === 2 &&
		removeTopologyCall !== undefined &&
		removeTopologyReceiver !== undefined &&
		ts.isObjectLiteralExpression(mutationResultObject) &&
		mutationResultObject.properties.length === 2 &&
		ts.isShorthandPropertyAssignment(mutationResultProperty) &&
		mutationResultProperty.name.text === "result" &&
		mutationResultProperty.objectAssignmentInitializer === undefined &&
		ts.isPropertyAssignment(mutationSnapshotProperty) &&
		propertyName(mutationSnapshotProperty.name) === "snapshot" &&
		ts.isConditionalExpression(mutationSnapshot) &&
		ts.isBinaryExpression(unwrapExpression(mutationSnapshot.condition)) &&
		unwrapExpression(mutationSnapshot.condition).operatorToken.kind ===
			ts.SyntaxKind.EqualsEqualsEqualsToken &&
		sameChain(unwrapExpression(mutationSnapshot.condition).left, [
			"result",
			"status",
		]) &&
		ts.isStringLiteralLike(
			unwrapExpression(unwrapExpression(mutationSnapshot.condition).right),
		) &&
		unwrapExpression(unwrapExpression(mutationSnapshot.condition).right)
			.text === "selected" &&
		sameChain(mutationSnapshot.whenTrue, ["result", "snapshot"]) &&
		sameChain(mutationSnapshot.whenFalse, ["undefined"]) &&
		commandIdFreezeReceiver !== undefined &&
		ts.isObjectLiteralExpression(commandIdObject) &&
		commandIdObject.properties.length === productContracts.length &&
		productRegistrations.length === productContracts.length &&
		commandRegistrations.length === productContracts.length + 1 &&
		productAnalyses.every(({ valid }) => valid) &&
		registrationsDeclaration !== undefined &&
		isConstVariableDeclaration(registrationsDeclaration) &&
		containsNode(commandFunction.body, registrationsDeclaration) &&
		ts.isArrayLiteralExpression(registrationsInitializer) &&
		registrationElements.length === productContracts.length + 1 &&
		productAnalyses.every(
			({ productRegistration }, index) =>
				unwrapExpression(registrationElements[index]) === productRegistration,
		) &&
		ts.isSpreadElement(guardedRegistrationElement) &&
		unwrapExpression(guardedRegistrationElement.expression) === maps[0] &&
		commandReturn !== undefined &&
		commandFunction.body.statements.at(-1) === commandReturn &&
		ts.isObjectLiteralExpression(commandReturnObject) &&
		commandReturnObject.properties.length === 1 &&
		ts.isMethodDeclaration(disposeMethod) &&
		disposeMethod.parameters.length === 0 &&
		disposeMethod.body !== undefined &&
		ts.isForOfStatement(disposeLoop) &&
		disposeMethod.body.statements[0] === disposeLoop &&
		ts.isVariableDeclarationList(disposeLoop.initializer) &&
		(disposeLoop.initializer.flags & ts.NodeFlags.Const) !== 0 &&
		loopDeclaration !== undefined &&
		ts.isIdentifier(loopDeclaration.name) &&
		loopDeclaration.name.text === "registration" &&
		reverseReceiver !== undefined &&
		ts.isCallExpression(reverseCall) &&
		reverseCall.arguments.length === 0 &&
		callWithChain(sourceFile, ["registrations", "reverse"]).length === 1 &&
		disposeBody !== undefined &&
		disposeBody.statements.length === 1 &&
		disposeReceiver !== undefined &&
		ts.isCallExpression(disposeCall) &&
		disposeCall.arguments.length === 0 &&
		hasClosedCommandRegistryBinding &&
		hasClosedPickRootsBinding &&
		hasClosedRemoveRootBinding &&
		hasClosedBridgeBinding &&
		hasClosedTopologyBinding &&
		hasClosedModeBinding &&
		hasClosedObjectBinding &&
		hasClosedReflectBinding &&
		hasClosedStructuredCloneBinding &&
		hasClosedPromiseBinding &&
		hasClosedRejectionErrorBinding &&
		hasClosedCommandServiceTokenBinding &&
		hasClosedUriBinding &&
		hasClosedRegistrationsBinding &&
		hasClosedLoopRegistrationBinding
	);
}

// `F080` S0's excluded-surface depth hardening
// (`docs/research/2026-07-25-core-git.md` decision 2) adds a *third*
// `Registry.as(...)` read to `app/excluded-surfaces.ts` — the
// `WorkbenchContributionsRegistry` singleton, keyed by a second
// "Extensions" namespace import (aliased `WorkbenchContributionExtensions`,
// mirroring the existing `ViewExtensions` alias for the view-registry
// pair) so its own `Extensions.Workbench` property never collides with
// `ViewExtensions`'s. This function's closed-shape check is extended
// alongside it: exactly three `Registry.as(...)` reads total, and every
// "Registry"/"ViewExtensions"/"WorkbenchContributionExtensions" identifier
// reference accounted for.
function validateCommandRegistryReader(sourceFile) {
	const commandRegistryImport = namedImportLocalIdentifier(
		sourceFile,
		MONACO_API_MODULE,
		"CommandsRegistry",
	);
	const registryImport = namedImportLocalIdentifier(
		sourceFile,
		MONACO_API_MODULE,
		"Registry",
	);
	const viewExtensionsImport = namedImportLocalIdentifier(
		sourceFile,
		"@codingame/monaco-vscode-api/vscode/vs/workbench/common/views",
		"Extensions",
		"ViewExtensions",
	);
	const workbenchContributionExtensionsImport = namedImportLocalIdentifier(
		sourceFile,
		"@codingame/monaco-vscode-api/vscode/vs/workbench/common/contributions",
		"Extensions",
		"WorkbenchContributionExtensions",
	);
	const reads = callWithChain(sourceFile, ["CommandsRegistry", "getCommands"]);
	const read = reads.length === 1 ? reads[0] : undefined;
	const readReceiver = directMethodReceiver(
		read,
		"CommandsRegistry",
		"getCommands",
	);
	const registryReads = callWithChain(sourceFile, ["Registry", "as"]);
	const registryReadContracts = ["ViewContainersRegistry", "ViewsRegistry"].map(
		(property) => {
			const matches = registryReads.filter(
				(call) =>
					call.arguments.length === 1 &&
					sameChain(call.arguments[0], ["ViewExtensions", property]),
			);
			const call = matches.length === 1 ? matches[0] : undefined;
			const receiver = directMethodReceiver(call, "Registry", "as");
			const argument = ts.isCallExpression(call)
				? unwrapExpression(call.arguments[0])
				: undefined;
			const viewExtensionsReceiver =
				argument !== undefined && ts.isPropertyAccessExpression(argument)
					? unwrapExpression(argument.expression)
					: undefined;
			return { receiver, viewExtensionsReceiver };
		},
	);
	const contributionRegistryMatches = registryReads.filter(
		(call) =>
			call.arguments.length === 1 &&
			sameChain(call.arguments[0], [
				"WorkbenchContributionExtensions",
				"Workbench",
			]),
	);
	const contributionRegistryCall =
		contributionRegistryMatches.length === 1
			? contributionRegistryMatches[0]
			: undefined;
	const contributionRegistryReceiver = directMethodReceiver(
		contributionRegistryCall,
		"Registry",
		"as",
	);
	const contributionRegistryArgument = ts.isCallExpression(
		contributionRegistryCall,
	)
		? unwrapExpression(contributionRegistryCall.arguments[0])
		: undefined;
	const workbenchContributionExtensionsReceiver =
		contributionRegistryArgument !== undefined &&
		ts.isPropertyAccessExpression(contributionRegistryArgument)
			? unwrapExpression(contributionRegistryArgument.expression)
			: undefined;
	return (
		commandRegistryImport !== undefined &&
		registryImport !== undefined &&
		viewExtensionsImport !== undefined &&
		workbenchContributionExtensionsImport !== undefined &&
		readReceiver !== undefined &&
		read.arguments.length === 0 &&
		registryReads.length === registryReadContracts.length + 1 &&
		registryReadContracts.every(
			({ receiver, viewExtensionsReceiver }) =>
				receiver !== undefined &&
				viewExtensionsReceiver !== undefined &&
				ts.isIdentifier(viewExtensionsReceiver) &&
				viewExtensionsReceiver.text === "ViewExtensions",
		) &&
		contributionRegistryReceiver !== undefined &&
		workbenchContributionExtensionsReceiver !== undefined &&
		ts.isIdentifier(workbenchContributionExtensionsReceiver) &&
		workbenchContributionExtensionsReceiver.text ===
			"WorkbenchContributionExtensions" &&
		hasExactIdentifierReferences(sourceFile, "CommandsRegistry", [
			commandRegistryImport,
			readReceiver,
		]) &&
		hasExactIdentifierReferences(sourceFile, "Registry", [
			registryImport,
			...registryReadContracts.map(({ receiver }) => receiver),
			contributionRegistryReceiver,
		]) &&
		hasExactIdentifierReferences(sourceFile, "ViewExtensions", [
			viewExtensionsImport,
			...registryReadContracts.map(
				({ viewExtensionsReceiver }) => viewExtensionsReceiver,
			),
		]) &&
		hasExactIdentifierReferences(
			sourceFile,
			"WorkbenchContributionExtensions",
			[
				workbenchContributionExtensionsImport,
				workbenchContributionExtensionsReceiver,
			],
		)
	);
}

function resolveRelativeAppModulePath(sourceFile, moduleName) {
	const slashed = moduleName.replaceAll("\\", "/");
	const pathname = slashed.replace(/[?#].*$/u, "");
	if (
		pathname !== "." &&
		pathname !== ".." &&
		!pathname.startsWith("./") &&
		!pathname.startsWith("../")
	) {
		return undefined;
	}
	return path.posix.normalize(
		path.posix.join(path.posix.dirname(sourceFile.fileName), pathname),
	);
}

function resolvesAppModule(sourceFile, moduleName, targetPath) {
	const resolved = resolveRelativeAppModulePath(sourceFile, moduleName);
	if (resolved === undefined) {
		return false;
	}
	return (
		resolved.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/u, "").toLowerCase() ===
		targetPath.toLowerCase()
	);
}

function providerBindingAcquisitions(
	moduleImports,
	matchesModule,
	names,
	{ defaultAcquires = false } = {},
) {
	return moduleImports.filter(({ moduleName, sourceFile, statement }) => {
		if (!matchesModule(moduleName, sourceFile)) {
			return false;
		}
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly) {
				return false;
			}
			const exports = statement.exportClause;
			return (
				exports === undefined ||
				ts.isNamespaceExport(exports) ||
				exports.elements.some(
					(element) =>
						!element.isTypeOnly &&
						((defaultAcquires &&
							(element.propertyName?.text === "default" ||
								element.name.text === "default")) ||
							names.includes(element.propertyName?.text ?? element.name.text) ||
							names.includes(element.name.text)),
				)
			);
		}
		const clause = statement.importClause;
		if (clause === undefined || clause.isTypeOnly) {
			return false;
		}
		const bindings = clause.namedBindings;
		if (clause.name !== undefined && defaultAcquires) {
			return true;
		}
		if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
			return true;
		}
		return (
			bindings !== undefined &&
			ts.isNamedImports(bindings) &&
			bindings.elements.some(
				(element) =>
					!element.isTypeOnly &&
					names.includes(element.propertyName?.text ?? element.name.text),
			)
		);
	});
}

function exactDirectBindingCalls(node, name, count, owner) {
	const directCalls = directCallsNamed(node, name, owner);
	return directCalls.length === count ? directCalls : undefined;
}

function declarationInitializedByExactCall(analysis, call) {
	const declarations = analysis.variableDeclarations.filter(
		(declaration) => unwrapExpression(declaration.initializer) === call,
	);
	return declarations.length === 1 ? declarations[0] : undefined;
}

function isNonBindingPropertyName(identifier) {
	const parent = identifier.parent;
	return (
		(ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
		(ts.isQualifiedName(parent) && parent.right === identifier) ||
		(ts.isBindingElement(parent) && parent.propertyName === identifier) ||
		(ts.isImportSpecifier(parent) && parent.propertyName === identifier) ||
		(ts.isExportSpecifier(parent) &&
			parent.propertyName !== undefined &&
			parent.name === identifier) ||
		((ts.isPropertyAssignment(parent) ||
			ts.isMethodDeclaration(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isPropertySignature(parent) ||
			ts.isMethodSignature(parent) ||
			ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent) ||
			ts.isEnumMember(parent)) &&
			parent.name === identifier)
	);
}

function isLocalValueBinding(identifier) {
	const parent = identifier.parent;
	return (
		((ts.isVariableDeclaration(parent) ||
			ts.isParameter(parent) ||
			ts.isBindingElement(parent) ||
			ts.isFunctionDeclaration(parent) ||
			ts.isFunctionExpression(parent) ||
			ts.isClassDeclaration(parent) ||
			ts.isClassExpression(parent) ||
			ts.isEnumDeclaration(parent) ||
			ts.isModuleDeclaration(parent) ||
			ts.isImportClause(parent) ||
			ts.isImportSpecifier(parent) ||
			ts.isNamespaceImport(parent) ||
			ts.isImportEqualsDeclaration(parent)) &&
			parent.name === identifier) ||
		(ts.isShorthandPropertyAssignment(parent) &&
			parent.objectAssignmentInitializer !== undefined &&
			parent.name === identifier)
	);
}

function hasNoLocalValueBinding(analysis, name) {
	return !(analysis.identifiersByName[name] ?? EMPTY_NODES).some(
		isLocalValueBinding,
	);
}

function hasExactLocalValueBindings(analysis, name, allowedNodes) {
	const allowed = new Set(allowedNodes.filter((node) => node !== undefined));
	const bindings = (analysis.identifiersByName[name] ?? EMPTY_NODES).filter(
		isLocalValueBinding,
	);
	return (
		bindings.length === allowed.size &&
		bindings.every((binding) => allowed.has(binding))
	);
}

function exactValueReferences(sourceFile, analysis, name, allowedNodes) {
	const allowed = new Set(allowedNodes.filter((node) => node !== undefined));
	const references = indexedWithin(
		sourceFile,
		analysis.identifiersByName[name] ?? EMPTY_NODES,
	).filter(
		(identifier) =>
			!ts.isPartOfTypeNode(identifier) && !isNonBindingPropertyName(identifier),
	);
	return (
		references.length === allowed.size &&
		references.every((reference) => allowed.has(reference))
	);
}

function validateImportedValueMembers(analysis, moduleName, name, members) {
	const importIdentifier = namedImportLocalIdentifier(
		analysis.sourceFile,
		moduleName,
		name,
	);
	const valueReferences = (
		analysis.identifiersByName[name] ?? EMPTY_NODES
	).filter(
		(identifier) =>
			!ts.isPartOfTypeNode(identifier) && !isNonBindingPropertyName(identifier),
	);
	const memberReceivers = valueReferences.filter(
		(identifier) =>
			identifier !== importIdentifier &&
			ts.isPropertyAccessExpression(identifier.parent) &&
			identifier.parent.expression === identifier,
	);
	const actualMembers = memberReceivers.map(
		(identifier) => identifier.parent.name.text,
	);
	return (
		importIdentifier !== undefined &&
		hasExactLocalValueBindings(analysis, name, [importIdentifier]) &&
		sameStringArray([...actualMembers].sort(), [...members].sort()) &&
		exactValueReferences(analysis.sourceFile, analysis, name, [
			importIdentifier,
			...memberReceivers,
		])
	);
}

function validateProducerIntrinsicReferences(analysis) {
	const forbiddenGlobalReferences = [
		"eval",
		"Function",
		"globalThis",
		"self",
		"window",
	].flatMap((name) =>
		(analysis.identifiersByName[name] ?? EMPTY_NODES).filter(
			(identifier) =>
				!ts.isPartOfTypeNode(identifier) &&
				!isNonBindingPropertyName(identifier),
		),
	);
	const objectReferences = (
		analysis.identifiersByName.Object ?? EMPTY_NODES
	).filter(
		(identifier) =>
			!ts.isPartOfTypeNode(identifier) && !isNonBindingPropertyName(identifier),
	);
	const directMethods = new Set([
		"create",
		"freeze",
		"getOwnPropertyDescriptor",
		"getOwnPropertyDescriptors",
		"getPrototypeOf",
	]);
	const reflectReferences = (
		analysis.identifiersByName.Reflect ?? EMPTY_NODES
	).filter(
		(identifier) =>
			!ts.isPartOfTypeNode(identifier) && !isNonBindingPropertyName(identifier),
	);
	const directReflectMethods = new Set(["apply", "get", "ownKeys"]);
	return (
		hasNoLocalValueBinding(analysis, "Object") &&
		hasNoLocalValueBinding(analysis, "Reflect") &&
		forbiddenGlobalReferences.length === 0 &&
		objectReferences.every((identifier) => {
			const access = identifier.parent;
			if (
				!ts.isPropertyAccessExpression(access) ||
				access.expression !== identifier
			) {
				return false;
			}
			if (access.name.text === "prototype") {
				const comparison = access.parent;
				return (
					ts.isBinaryExpression(comparison) &&
					comparison.right === access &&
					comparison.operatorToken.kind ===
						ts.SyntaxKind.ExclamationEqualsEqualsToken &&
					sameChain(comparison.left, ["prototype"])
				);
			}
			return (
				directMethods.has(access.name.text) &&
				ts.isCallExpression(access.parent) &&
				access.parent.expression === access
			);
		}) &&
		reflectReferences.every((identifier) => {
			const access = identifier.parent;
			return (
				ts.isPropertyAccessExpression(access) &&
				access.expression === identifier &&
				directReflectMethods.has(access.name.text) &&
				ts.isCallExpression(access.parent) &&
				access.parent.expression === access
			);
		})
	);
}

function bindingReferences(sourceFile, analysis, name) {
	return indexedWithin(
		sourceFile,
		analysis.identifiersByName[name] ?? EMPTY_NODES,
	).filter((identifier) => !isNonBindingPropertyName(identifier));
}

function exactBindingReferences(sourceFile, analysis, name, allowedNodes) {
	const allowed = new Set(allowedNodes.filter((node) => node !== undefined));
	const references = bindingReferences(sourceFile, analysis, name);
	return (
		references.length === allowed.size &&
		references.every((reference) => allowed.has(reference))
	);
}

function exactOwnedBindingReferences(owner, analysis, name, allowedNodes) {
	const allowed = new Set(allowedNodes.filter((node) => node !== undefined));
	const references = indexedWithin(
		owner,
		bindingReferences(analysis.sourceFile, analysis, name),
	);
	return (
		references.length === allowed.size &&
		references.every((reference) => allowed.has(reference))
	);
}

function hasExportModifier(node) {
	return (
		node.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) === true
	);
}

function validateProducerFactory(analysis, name) {
	const declarations = analysis.functionDeclarationsByName[name] ?? EMPTY_NODES;
	const declaration = declarations.length === 1 ? declarations[0] : undefined;
	return (
		declaration !== undefined &&
		declaration.parent === analysis.sourceFile &&
		hasExportModifier(declaration) &&
		declaration.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
		) !== true &&
		declaration.name !== undefined &&
		exactBindingReferences(analysis.sourceFile, analysis, name, [
			declaration.name,
		])
	);
}

function validateProducerImplementationClass(
	analysis,
	className,
	factoryName,
	{
		constructorParameters,
		constructorStatementCount,
		factoryReturnsClass = false,
	} = {},
) {
	const classes = analysis.classDeclarationsByName[className] ?? EMPTY_NODES;
	const classDeclaration = classes.length === 1 ? classes[0] : undefined;
	const factories =
		analysis.functionDeclarationsByName[factoryName] ?? EMPTY_NODES;
	const factory = factories.length === 1 ? factories[0] : undefined;
	if (
		classDeclaration === undefined ||
		classDeclaration.parent !== analysis.sourceFile ||
		(classDeclaration.modifiers?.length ?? 0) !== 0 ||
		classDeclaration.name === undefined ||
		factory === undefined
	) {
		return false;
	}
	const extendsClauses =
		classDeclaration.heritageClauses?.filter(
			(clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
		) ?? EMPTY_NODES;
	const constructors = classDeclaration.members.filter(
		ts.isConstructorDeclaration,
	);
	const constructor = constructors.length === 1 ? constructors[0] : undefined;
	const constructorStatements = constructor?.body?.statements ?? EMPTY_NODES;
	const constructorFreezeStatement = constructorStatements.at(-1);
	const constructorFreeze =
		constructorFreezeStatement !== undefined &&
		ts.isExpressionStatement(constructorFreezeStatement)
			? unwrapExpression(constructorFreezeStatement.expression)
			: undefined;
	if (
		extendsClauses.length !== 0 ||
		constructor === undefined ||
		constructor.body === undefined ||
		(constructor.modifiers?.length ?? 0) !== 0 ||
		constructorParameters === undefined ||
		constructor.parameters.length !== constructorParameters.length ||
		!constructor.parameters.every(
			(parameter, index) =>
				ts.isIdentifier(parameter.name) &&
				parameter.name.text === constructorParameters[index] &&
				parameter.dotDotDotToken === undefined &&
				parameter.questionToken === undefined &&
				parameter.initializer === undefined,
		) ||
		constructorStatements.length !== constructorStatementCount ||
		descendants(constructor.body, ts.isReturnStatement).length !== 0 ||
		!ts.isCallExpression(constructorFreeze) ||
		!sameChain(constructorFreeze.expression, ["Object", "freeze"]) ||
		constructorFreeze.arguments.length !== 1 ||
		constructorFreeze.arguments[0].kind !== ts.SyntaxKind.ThisKeyword
	) {
		return false;
	}
	const references = bindingReferences(
		analysis.sourceFile,
		analysis,
		className,
	);
	const factoryReturn =
		factory.body?.statements.length === 1 &&
		ts.isReturnStatement(factory.body.statements[0])
			? factory.body.statements[0]
			: undefined;
	const returnedConstruction =
		factoryReturn?.expression === undefined
			? undefined
			: unwrapExpression(factoryReturn.expression);
	const prototypeFreezes = references.filter((identifier) => {
		const access = identifier.parent;
		const call = access?.parent;
		const statement = call?.parent;
		return (
			ts.isPropertyAccessExpression(access) &&
			access.expression === identifier &&
			access.name.text === "prototype" &&
			ts.isCallExpression(call) &&
			sameChain(call.expression, ["Object", "freeze"]) &&
			call.arguments.length === 1 &&
			call.arguments[0] === access &&
			ts.isExpressionStatement(statement) &&
			statement.expression === call &&
			statement.parent === analysis.sourceFile &&
			classDeclaration.pos < statement.pos &&
			statement.pos < factory.pos
		);
	});
	const factoryConstructions = references.filter((identifier) => {
		const construction = identifier.parent;
		return (
			ts.isNewExpression(construction) &&
			construction.expression === identifier &&
			construction === returnedConstruction &&
			nearestFunctionLike(identifier) === factory
		);
	});
	const factoryReturnType =
		factoryReturnsClass &&
		factory.type !== undefined &&
		ts.isTypeReferenceNode(factory.type) &&
		ts.isIdentifier(factory.type.typeName) &&
		factory.type.typeName.text === className
			? factory.type.typeName
			: undefined;
	return (
		validateProducerIntrinsicReferences(analysis) &&
		factoryReturn !== undefined &&
		returnedConstruction !== undefined &&
		ts.isNewExpression(returnedConstruction) &&
		prototypeFreezes.length === 1 &&
		factoryConstructions.length === 1 &&
		(!factoryReturnsClass || factoryReturnType !== undefined) &&
		exactBindingReferences(analysis.sourceFile, analysis, className, [
			classDeclaration.name,
			prototypeFreezes[0],
			factoryConstructions[0],
			...(factoryReturnsClass ? [factoryReturnType] : []),
		])
	);
}

function validateProducerScheme(analysis, name, value, referenceContracts) {
	const declarations = analysis.variableDeclarationsByName[name] ?? EMPTY_NODES;
	const declaration = declarations.length === 1 ? declarations[0] : undefined;
	const statement =
		declaration !== undefined && ts.isVariableDeclaration(declaration)
			? declaration.parent.parent
			: undefined;
	if (
		declaration === undefined ||
		!ts.isVariableStatement(statement) ||
		statement.parent !== analysis.sourceFile ||
		!hasExportModifier(statement) ||
		!isConstVariableDeclaration(declaration) ||
		!ts.isIdentifier(declaration.name) ||
		!isExactStringLiteral(unwrapExpression(declaration.initializer), value)
	) {
		return false;
	}
	const references = bindingReferences(analysis.sourceFile, analysis, name);
	const contractedReferences = referenceContracts.map((contract) => {
		const matches = references.filter(contract);
		return matches.length === 1 ? matches[0] : undefined;
	});
	return (
		contractedReferences.every((reference) => reference !== undefined) &&
		exactBindingReferences(analysis.sourceFile, analysis, name, [
			declaration.name,
			...contractedReferences,
		])
	);
}

function callableOwner(name, className) {
	return (identifier) => {
		const sourceFile = identifier.getSourceFile();
		const analysis = analyzeSourceFile(sourceFile);
		let expectedOwner;
		if (className === undefined) {
			const declarations =
				analysis.functionDeclarationsByName[name] ?? EMPTY_NODES;
			expectedOwner =
				declarations.length === 1 && declarations[0].parent === sourceFile
					? declarations[0]
					: undefined;
		} else {
			const classes =
				analysis.classDeclarationsByName[className] ?? EMPTY_NODES;
			const classDeclaration =
				classes.length === 1 && classes[0].parent === sourceFile
					? classes[0]
					: undefined;
			const methods =
				classDeclaration?.members.filter(
					(member) =>
						ts.isMethodDeclaration(member) &&
						propertyName(member.name) === name,
				) ?? EMPTY_NODES;
			expectedOwner = methods.length === 1 ? methods[0] : undefined;
		}
		if (expectedOwner === undefined) {
			return false;
		}
		let current = identifier.parent;
		while (current !== undefined && current !== sourceFile) {
			if (ts.isFunctionLike(current)) {
				return current === expectedOwner;
			}
			current = current.parent;
		}
		return false;
	};
}

function outermostTransparentExpression(expression) {
	let current = expression;
	while (
		current.parent !== undefined &&
		(ts.isParenthesizedExpression(current.parent) ||
			ts.isAsExpression(current.parent) ||
			ts.isTypeAssertionExpression(current.parent) ||
			ts.isNonNullExpression(current.parent) ||
			(ts.isSatisfiesExpression?.(current.parent) ?? false)) &&
		current.parent.expression === current
	) {
		current = current.parent;
	}
	return current;
}

function nearestAncestor(node, predicate) {
	let current = node.parent;
	while (current !== undefined) {
		if (predicate(current)) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

function isBooleanChainMember(expression, member, operator) {
	let current = outermostTransparentExpression(member);
	while (current !== expression) {
		const parent = current.parent;
		if (
			parent === undefined ||
			!ts.isBinaryExpression(parent) ||
			parent.operatorToken.kind !== operator ||
			(parent.left !== current && parent.right !== current)
		) {
			return false;
		}
		current = outermostTransparentExpression(parent);
	}
	return true;
}

function binaryChainTerms(expression, operator) {
	const current = unwrapExpression(expression);
	if (
		current !== undefined &&
		ts.isBinaryExpression(current) &&
		current.operatorToken.kind === operator
	) {
		return [
			...binaryChainTerms(current.left, operator),
			...binaryChainTerms(current.right, operator),
		];
	}
	return current === undefined ? [] : [current];
}

function matchesComparison(expression, left, operator, validateRight) {
	const current = unwrapExpression(expression);
	return (
		current !== undefined &&
		ts.isBinaryExpression(current) &&
		current.operatorToken.kind === operator &&
		sameChain(current.left, left) &&
		validateRight(unwrapExpression(current.right))
	);
}

function singleConstDeclaration(statement, name) {
	if (
		!ts.isVariableStatement(statement) ||
		statement.declarationList.declarations.length !== 1
	) {
		return undefined;
	}
	const declaration = statement.declarationList.declarations[0];
	return isConstVariableDeclaration(declaration) &&
		ts.isIdentifier(declaration.name) &&
		declaration.name.text === name
		? declaration
		: undefined;
}

function throwsNoPermissions(statement) {
	const statements = ts.isBlock(statement) ? statement.statements : [statement];
	if (statements.length !== 1 || !ts.isThrowStatement(statements[0])) {
		return false;
	}
	const thrown = unwrapExpression(statements[0].expression);
	return (
		thrown !== undefined &&
		ts.isCallExpression(thrown) &&
		sameChain(thrown.expression, ["noPermissions"]) &&
		thrown.arguments.length === 0
	);
}

function rejectionGateContext(_identifier, comparison) {
	const branch = nearestAncestor(comparison, ts.isIfStatement);
	return (
		branch !== undefined &&
		branch.elseStatement === undefined &&
		isBooleanChainMember(
			branch.expression,
			comparison,
			ts.SyntaxKind.BarBarToken,
		) &&
		throwsNoPermissions(branch.thenStatement)
	);
}

function watchSchemeRootContext(identifier, comparison) {
	const analysis = analyzeSourceFile(identifier.getSourceFile());
	const owner = nearestFunctionLike(identifier);
	if (
		!ts.isMethodDeclaration(owner) ||
		owner.body === undefined ||
		owner.body.statements.length !== 4 ||
		owner.parameters.length !== 2 ||
		!ts.isIdentifier(owner.parameters[0].name) ||
		owner.parameters[0].name.text !== "resource" ||
		!ts.isIdentifier(owner.parameters[1].name) ||
		owner.parameters[1].name.text !== "_options"
	) {
		return false;
	}
	const [candidateStatement, schemeStatement, branch, returnStatement] =
		owner.body.statements;
	const candidateDeclaration = singleConstDeclaration(
		candidateStatement,
		"candidate",
	);
	const declaration = singleConstDeclaration(schemeStatement, "schemeRoot");
	const candidateCall = unwrapExpression(candidateDeclaration?.initializer);
	if (
		declaration === undefined ||
		declaration.initializer === undefined ||
		!isBooleanChainMember(
			declaration.initializer,
			comparison,
			ts.SyntaxKind.AmpersandAmpersandToken,
		) ||
		!ts.isCallExpression(candidateCall) ||
		!sameChain(candidateCall.expression, ["resourceSnapshot"]) ||
		candidateCall.arguments.length !== 1 ||
		!sameChain(candidateCall.arguments[0], ["resource"]) ||
		!ts.isIfStatement(branch) ||
		branch.elseStatement !== undefined
	) {
		return false;
	}
	const schemeTerms = binaryChainTerms(
		declaration.initializer,
		ts.SyntaxKind.AmpersandAmpersandToken,
	);
	const expectedSchemeTerms = [
		["scheme", "plain-workspace-config"],
		["authority", ""],
		["path", "/"],
		["query", ""],
		["fragment", ""],
	];
	const condition = unwrapExpression(branch.expression);
	const branchStatements = ts.isBlock(branch.thenStatement)
		? branch.thenStatement.statements
		: [branch.thenStatement];
	const boundCall =
		branchStatements.length === 1 &&
		ts.isExpressionStatement(branchStatements[0])
			? unwrapExpression(branchStatements[0].expression)
			: undefined;
	const returned = ts.isReturnStatement(returnStatement)
		? unwrapExpression(returnStatement.expression)
		: undefined;
	const disposeObject =
		ts.isCallExpression(returned) &&
		sameChain(returned.expression, ["Object", "freeze"]) &&
		returned.arguments.length === 1
			? unwrapExpression(returned.arguments[0])
			: undefined;
	const disposeMethod = ts.isObjectLiteralExpression(disposeObject)
		? objectProperty(disposeObject, "dispose")
		: undefined;
	const candidateSchemeReferences = bindingReferences(
		declaration.initializer,
		analysis,
		"candidate",
	);
	const candidateArgument = ts.isCallExpression(boundCall)
		? unwrapExpression(boundCall.arguments[0])
		: undefined;
	const schemeRootOperand =
		condition !== undefined &&
		ts.isPrefixUnaryExpression(condition) &&
		condition.operator === ts.SyntaxKind.ExclamationToken
			? unwrapExpression(condition.operand)
			: undefined;
	return (
		schemeTerms.length === expectedSchemeTerms.length &&
		expectedSchemeTerms.every(([property, value], index) =>
			matchesComparison(
				schemeTerms[index],
				["candidate", property],
				ts.SyntaxKind.EqualsEqualsEqualsToken,
				(right) =>
					property === "scheme"
						? sameChain(right, ["PLAIN_WORKSPACE_CONFIGURATION_SCHEME"])
						: isExactStringLiteral(right, value),
			),
		) &&
		sameChain(schemeRootOperand, ["schemeRoot"]) &&
		ts.isCallExpression(boundCall) &&
		sameChain(boundCall.expression, ["this", "boundFile"]) &&
		boundCall.arguments.length === 1 &&
		ts.isIdentifier(candidateArgument) &&
		candidateArgument.text === "candidate" &&
		ts.isObjectLiteralExpression(disposeObject) &&
		disposeObject.properties.length === 1 &&
		ts.isMethodDeclaration(disposeMethod) &&
		disposeMethod.parameters.length === 0 &&
		disposeMethod.body?.statements.length === 0 &&
		candidateSchemeReferences.length === 5 &&
		exactOwnedBindingReferences(owner, analysis, "candidate", [
			candidateDeclaration.name,
			...candidateSchemeReferences,
			candidateArgument,
		]) &&
		exactOwnedBindingReferences(owner, analysis, "schemeRoot", [
			declaration.name,
			schemeRootOperand,
		]) &&
		exactOwnedBindingReferences(owner, analysis, "resource", [
			owner.parameters[0].name,
			unwrapExpression(candidateCall.arguments[0]),
		])
	);
}

function configurationUriContext(identifier, property, expectedProperty) {
	const analysis = analyzeSourceFile(identifier.getSourceFile());
	const uriImport = namedImportLocalIdentifier(
		analysis.sourceFile,
		"@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
		"URI",
	);
	const owner = nearestFunctionLike(identifier);
	const object = property.parent;
	if (
		!ts.isFunctionDeclaration(owner) ||
		owner.body === undefined ||
		owner.body.statements.length !== 5 ||
		owner.parameters.length !== 1 ||
		!ts.isIdentifier(owner.parameters[0].name) ||
		owner.parameters[0].name.text !== "workspaceId" ||
		!ts.isObjectLiteralExpression(object)
	) {
		return false;
	}
	const call = object.parent;
	const uriFromAccess = ts.isCallExpression(call)
		? unwrapExpression(call.expression)
		: undefined;
	const uriReceiver = ts.isPropertyAccessExpression(uriFromAccess)
		? unwrapExpression(uriFromAccess.expression)
		: undefined;
	const [
		declarationStatement,
		toStringStatement,
		fsPathStatement,
		freezeStatement,
		returnStatement,
	] = owner.body.statements;
	const declaration = singleConstDeclaration(declarationStatement, "resource");
	if (
		!ts.isCallExpression(call) ||
		!sameChain(call.expression, ["URI", "from"]) ||
		call.arguments.length !== 2 ||
		call.arguments[0] !== object ||
		unwrapExpression(declaration?.initializer) !== call
	) {
		return false;
	}
	const toStringCall = ts.isExpressionStatement(toStringStatement)
		? unwrapExpression(toStringStatement.expression)
		: undefined;
	const toStringReceiver = directMethodReceiver(
		toStringCall,
		"resource",
		"toString",
	);
	const voidExpression = ts.isExpressionStatement(fsPathStatement)
		? unwrapExpression(fsPathStatement.expression)
		: undefined;
	const fsPathAccess =
		voidExpression !== undefined && ts.isVoidExpression(voidExpression)
			? unwrapExpression(voidExpression.expression)
			: undefined;
	const fsPathReceiver = ts.isPropertyAccessExpression(fsPathAccess)
		? unwrapExpression(fsPathAccess.expression)
		: undefined;
	const freezeCall = ts.isExpressionStatement(freezeStatement)
		? unwrapExpression(freezeStatement.expression)
		: undefined;
	const freezeArgument =
		ts.isCallExpression(freezeCall) && freezeCall.arguments.length === 1
			? unwrapExpression(freezeCall.arguments[0])
			: undefined;
	const returned = ts.isReturnStatement(returnStatement)
		? unwrapExpression(returnStatement.expression)
		: undefined;
	const authorityProperty = objectProperty(object, "authority");
	const workspaceIdValue = ts.isPropertyAssignment(authorityProperty)
		? unwrapExpression(authorityProperty.initializer)
		: undefined;
	const pathProperty = objectProperty(object, "path");
	const pathValue = ts.isPropertyAssignment(pathProperty)
		? unwrapExpression(pathProperty.initializer)
		: undefined;
	return (
		declaration !== undefined &&
		uriImport !== undefined &&
		hasExactLocalValueBindings(analysis, "URI", [uriImport]) &&
		ts.isIdentifier(uriReceiver) &&
		uriReceiver.text === "URI" &&
		exactValueReferences(analysis.sourceFile, analysis, "URI", [
			uriImport,
			uriReceiver,
		]) &&
		object.properties.length === 3 &&
		objectProperty(object, expectedProperty) === property &&
		call.arguments[1].kind === ts.SyntaxKind.TrueKeyword &&
		toStringReceiver !== undefined &&
		ts.isPropertyAccessExpression(fsPathAccess) &&
		fsPathAccess.name.text === "fsPath" &&
		ts.isIdentifier(fsPathReceiver) &&
		fsPathReceiver.text === "resource" &&
		ts.isCallExpression(freezeCall) &&
		sameChain(freezeCall.expression, ["Object", "freeze"]) &&
		ts.isIdentifier(freezeArgument) &&
		freezeArgument.text === "resource" &&
		ts.isIdentifier(returned) &&
		returned.text === "resource" &&
		ts.isIdentifier(workspaceIdValue) &&
		workspaceIdValue.text === "workspaceId" &&
		sameChain(pathValue, ["PLAIN_WORKSPACE_CONFIGURATION_PATH"]) &&
		exactOwnedBindingReferences(owner, analysis, "resource", [
			declaration.name,
			toStringReceiver,
			fsPathReceiver,
			freezeArgument,
			returned,
		]) &&
		exactOwnedBindingReferences(owner, analysis, "workspaceId", [
			owner.parameters[0].name,
			workspaceIdValue,
		])
	);
}

function configurationSchemeUriContext(identifier, property) {
	return configurationUriContext(identifier, property, "scheme");
}

function configurationPathUriContext(identifier, property) {
	return configurationUriContext(identifier, property, "path");
}

function boundFileRejectionContext(identifier, comparison) {
	const owner = nearestFunctionLike(identifier);
	if (
		!ts.isMethodDeclaration(owner) ||
		owner.body === undefined ||
		owner.body.statements.length !== 2 ||
		owner.parameters.length !== 1 ||
		!ts.isIdentifier(owner.parameters[0].name) ||
		owner.parameters[0].name.text !== "candidate"
	) {
		return false;
	}
	const [branch, returnStatement] = owner.body.statements;
	const terms = ts.isIfStatement(branch)
		? binaryChainTerms(branch.expression, ts.SyntaxKind.BarBarToken)
		: [];
	const returned = ts.isReturnStatement(returnStatement)
		? unwrapExpression(returnStatement.expression)
		: undefined;
	return (
		ts.isIfStatement(branch) &&
		nearestAncestor(comparison, ts.isIfStatement) === branch &&
		rejectionGateContext(identifier, comparison) &&
		terms.length === 6 &&
		matchesComparison(
			terms[0],
			["candidate", "scheme"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			(right) => sameChain(right, ["PLAIN_WORKSPACE_CONFIGURATION_SCHEME"]),
		) &&
		matchesComparison(
			terms[1],
			["candidate", "path"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			(right) => sameChain(right, ["PLAIN_WORKSPACE_CONFIGURATION_PATH"]),
		) &&
		matchesComparison(
			terms[2],
			["candidate", "query"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			(right) => isExactStringLiteral(right, ""),
		) &&
		matchesComparison(
			terms[3],
			["candidate", "fragment"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			(right) => isExactStringLiteral(right, ""),
		) &&
		matchesComparison(
			terms[4],
			["this", "#binding"],
			ts.SyntaxKind.EqualsEqualsEqualsToken,
			(right) => sameChain(right, ["undefined"]),
		) &&
		matchesComparison(
			terms[5],
			["candidate", "authority"],
			ts.SyntaxKind.ExclamationEqualsEqualsToken,
			(right) => sameChain(right, ["this", "#binding", "workspaceId"]),
		) &&
		sameChain(returned, ["this", "#binding", "installed"])
	);
}

function binaryRightReference(left, operator, owner, context) {
	return (identifier) => {
		const expression = outermostTransparentExpression(identifier);
		return (
			ts.isBinaryExpression(expression.parent) &&
			expression.parent.right === expression &&
			expression.parent.operatorToken.kind === operator &&
			sameChain(expression.parent.left, left) &&
			owner(identifier) &&
			context(identifier, expression.parent)
		);
	};
}

function propertyInitializerReference(name, owner, context) {
	return (identifier) => {
		const expression = outermostTransparentExpression(identifier);
		return (
			ts.isPropertyAssignment(expression.parent) &&
			expression.parent.initializer === expression &&
			propertyName(expression.parent.name) === name &&
			owner(identifier) &&
			context(identifier, expression.parent)
		);
	};
}

function validateProviderProducerBindings(authority) {
	return [
		{
			analysis: authority.filesByPath[`app/${ROOT_PROVIDER_MODULE}.ts`],
			optional: !authority.completeAppAuthority,
			factory: "createPlainWorkspaceFileSystemProvider",
			implementation: "PlainWorkspaceFileSystemProvider",
			constructorParameters: ["bridge", "allowsMutationDispatch"],
			constructorStatementCount: 4,
			factoryReturnsImplementation: true,
			valueMemberImports: [
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
					name: "FileSystemProviderCapabilities",
					members: ["FileFolderCopy", "FileReadWrite", "Readonly"],
				},
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/base/common/event",
					name: "Event",
					members: ["None"],
				},
			],
			constants: [
				{
					name: "PLAIN_WORKSPACE_SCHEME",
					value: "plain-workspace",
					references: [
						binaryRightReference(
							["scheme"],
							ts.SyntaxKind.ExclamationEqualsEqualsToken,
							callableOwner(
								"resolveMutationResource",
								"PlainWorkspaceFileSystemProvider",
							),
							rejectionGateContext,
						),
						binaryRightReference(
							["resource", "scheme"],
							ts.SyntaxKind.ExclamationEqualsEqualsToken,
							callableOwner(
								"resolveResource",
								"PlainWorkspaceFileSystemProvider",
							),
							rejectionGateContext,
						),
					],
				},
			],
		},
		{
			analysis:
				authority.filesByPath[`app/${CONFIGURATION_PROVIDER_MODULE}.ts`],
			optional: false,
			factory: "createPlainWorkspaceConfigurationProvider",
			implementation: "PlainWorkspaceConfigurationProviderImpl",
			constructorParameters: [],
			constructorStatementCount: 1,
			factoryReturnsImplementation: false,
			valueMemberImports: [
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
					name: "FileSystemProviderCapabilities",
					members: ["FileReadWrite", "Readonly"],
				},
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
					name: "FilePermission",
					members: ["Readonly"],
				},
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
					name: "FileType",
					members: ["File"],
				},
				{
					moduleName:
						"@codingame/monaco-vscode-api/vscode/vs/base/common/event",
					name: "Event",
					members: ["None", "None"],
				},
			],
			constants: [
				{
					name: "PLAIN_WORKSPACE_CONFIGURATION_SCHEME",
					value: "plain-workspace-config",
					references: [
						propertyInitializerReference(
							"scheme",
							callableOwner("configurationUri"),
							configurationSchemeUriContext,
						),
						binaryRightReference(
							["candidate", "scheme"],
							ts.SyntaxKind.EqualsEqualsEqualsToken,
							callableOwner("watch", "PlainWorkspaceConfigurationProviderImpl"),
							watchSchemeRootContext,
						),
						binaryRightReference(
							["candidate", "scheme"],
							ts.SyntaxKind.ExclamationEqualsEqualsToken,
							callableOwner(
								"boundFile",
								"PlainWorkspaceConfigurationProviderImpl",
							),
							boundFileRejectionContext,
						),
					],
				},
				{
					name: "PLAIN_WORKSPACE_CONFIGURATION_PATH",
					value: "/workspace.code-workspace",
					references: [
						propertyInitializerReference(
							"path",
							callableOwner("configurationUri"),
							configurationPathUriContext,
						),
						binaryRightReference(
							["candidate", "path"],
							ts.SyntaxKind.ExclamationEqualsEqualsToken,
							callableOwner(
								"boundFile",
								"PlainWorkspaceConfigurationProviderImpl",
							),
							boundFileRejectionContext,
						),
					],
				},
			],
		},
	].every(
		({
			analysis,
			optional,
			factory,
			implementation,
			constructorParameters,
			constructorStatementCount,
			factoryReturnsImplementation,
			valueMemberImports,
			constants,
		}) =>
			analysis === undefined
				? optional
				: validateProducerFactory(analysis, factory) &&
					validateProducerImplementationClass(
						analysis,
						implementation,
						factory,
						{
							constructorParameters,
							constructorStatementCount,
							factoryReturnsClass: factoryReturnsImplementation,
						},
					) &&
					valueMemberImports.every(({ moduleName, name, members }) =>
						validateImportedValueMembers(analysis, moduleName, name, members),
					) &&
					constants.every(({ name, value, references }) =>
						validateProducerScheme(analysis, name, value, references),
					),
	);
}

function validateProviderBindingAuthority(authority, moduleImports) {
	const mainAnalysis = authority.filesByPath["app/main.ts"];
	const mainSource = mainAnalysis?.sourceFile;
	if (mainAnalysis === undefined || mainSource === undefined) {
		return false;
	}
	const bootstrapDeclarations = callableDeclarations(mainSource, "bootstrap");
	const bootstrapOwner =
		bootstrapDeclarations.length === 1 ? bootstrapDeclarations[0] : undefined;
	if (bootstrapOwner === undefined) {
		return false;
	}
	const registrarName = "registerCustomProvider";
	const rootFactoryName = "createPlainWorkspaceFileSystemProvider";
	const configurationFactoryName = "createPlainWorkspaceConfigurationProvider";
	const rootSchemeName = "PLAIN_WORKSPACE_SCHEME";
	const configurationSchemeName = "PLAIN_WORKSPACE_CONFIGURATION_SCHEME";
	const deleteCoordinatorName = "registerWorkspaceDeleteCoordinator";
	const topologyCoordinatorName = "createWorkspaceTopologyCoordinator";
	const rootModule = `./${ROOT_PROVIDER_MODULE}`;
	const configurationModule = `./${CONFIGURATION_PROVIDER_MODULE}`;
	const importContracts = [
		[FILES_PROVIDER_OVERRIDE_MODULE, [registrarName]],
		[rootModule, [rootFactoryName, rootSchemeName]],
		[configurationModule, [configurationFactoryName, configurationSchemeName]],
		["./features/workspace/delete-coordinator", [deleteCoordinatorName]],
		["./features/workspace/workspace-projection", [topologyCoordinatorName]],
	];
	const acquisitionContracts = [
		providerBindingAcquisitions(
			moduleImports,
			(moduleName) => moduleName.startsWith(FILES_PROVIDER_OVERRIDE_MODULE),
			[registrarName],
		),
		providerBindingAcquisitions(
			moduleImports,
			(moduleName, sourceFile) =>
				resolvesAppModule(
					sourceFile,
					moduleName,
					`app/${ROOT_PROVIDER_MODULE}`,
				),
			[rootFactoryName, rootSchemeName, "PlainWorkspaceFileSystemProvider"],
			{ defaultAcquires: true },
		),
		providerBindingAcquisitions(
			moduleImports,
			(moduleName, sourceFile) =>
				resolvesAppModule(
					sourceFile,
					moduleName,
					`app/${CONFIGURATION_PROVIDER_MODULE}`,
				),
			[
				configurationFactoryName,
				configurationSchemeName,
				"PLAIN_WORKSPACE_CONFIGURATION_PATH",
				"PlainWorkspaceConfigurationProviderImpl",
			],
			{ defaultAcquires: true },
		),
	];
	if (
		!importContracts.every(([moduleName, names]) =>
			hasExactNamedImport(mainSource, moduleName, names),
		) ||
		!acquisitionContracts.every(
			(acquisitions) =>
				acquisitions.length === 1 && acquisitions[0].sourceFile === mainSource,
		)
	) {
		return false;
	}

	const directBindingContracts = [
		[registrarName, FILES_PROVIDER_OVERRIDE_MODULE, 2],
		[rootFactoryName, rootModule, 1],
		[configurationFactoryName, configurationModule, 1],
		[deleteCoordinatorName, "./features/workspace/delete-coordinator", 1],
		[topologyCoordinatorName, "./features/workspace/workspace-projection", 1],
	];
	const callsByName = Object.fromEntries(
		directBindingContracts.map(([name, , count]) => [
			name,
			exactDirectBindingCalls(mainSource, name, count, bootstrapOwner),
		]),
	);
	if (
		!directBindingContracts.every(([name, moduleName]) => {
			const calls = callsByName[name];
			return (
				calls !== undefined &&
				exactBindingReferences(mainSource, mainAnalysis, name, [
					namedImportLocalIdentifier(mainSource, moduleName, name),
					...calls.map((call) => unwrapExpression(call.expression)),
				])
			);
		})
	) {
		return false;
	}
	const registrarCalls = callsByName[registrarName];
	const rootFactoryCalls = callsByName[rootFactoryName];
	const configurationFactoryCalls = callsByName[configurationFactoryName];
	const deleteCoordinatorCalls = callsByName[deleteCoordinatorName];
	const topologyCoordinatorCalls = callsByName[topologyCoordinatorName];

	const rootDeclaration = declarationInitializedByExactCall(
		mainAnalysis,
		rootFactoryCalls[0],
	);
	const configurationDeclaration = declarationInitializedByExactCall(
		mainAnalysis,
		configurationFactoryCalls[0],
	);
	if (
		rootDeclaration === undefined ||
		configurationDeclaration === undefined ||
		!isConstVariableDeclaration(rootDeclaration) ||
		!isConstVariableDeclaration(configurationDeclaration) ||
		!ts.isIdentifier(rootDeclaration.name) ||
		!ts.isIdentifier(configurationDeclaration.name)
	) {
		return false;
	}
	const rootName = rootDeclaration.name.text;
	const configurationName = configurationDeclaration.name.text;
	const rootRegistration = registrarCalls.find(
		(call) =>
			call.arguments.length === 2 &&
			sameChain(call.arguments[0], [rootSchemeName]) &&
			sameChain(call.arguments[1], [rootName]),
	);
	const configurationRegistration = registrarCalls.find(
		(call) =>
			call.arguments.length === 2 &&
			sameChain(call.arguments[0], [configurationSchemeName]) &&
			sameChain(call.arguments[1], [configurationName]),
	);
	const deleteCoordinatorCall = deleteCoordinatorCalls[0];
	const topologyCoordinatorCall = topologyCoordinatorCalls[0];
	if (
		rootRegistration === undefined ||
		configurationRegistration === undefined ||
		rootFactoryCalls[0].arguments.length !== 2 ||
		!sameChain(rootFactoryCalls[0].arguments[0], ["bridge"]) ||
		!sameChain(rootFactoryCalls[0].arguments[1], ["workspaceCapabilities"]) ||
		configurationFactoryCalls[0].arguments.length !== 0 ||
		deleteCoordinatorCall?.arguments.length !== 2 ||
		!sameChain(deleteCoordinatorCall.arguments[0], ["bridge"]) ||
		topologyCoordinatorCall?.arguments.length === 0 ||
		!sameChain(deleteCoordinatorCall.arguments[1], [rootName]) ||
		!sameChain(topologyCoordinatorCall.arguments[0], [configurationName]) ||
		rootFactoryCalls[0].pos >= deleteCoordinatorCall.pos ||
		deleteCoordinatorCall.pos >= configurationFactoryCalls[0].pos ||
		configurationFactoryCalls[0].pos >= rootRegistration.pos
	) {
		return false;
	}
	const rootSchemeArgument = unwrapExpression(rootRegistration.arguments[0]);
	const configurationSchemeArgument = unwrapExpression(
		configurationRegistration.arguments[0],
	);
	const rootRegistrationArgument = unwrapExpression(
		rootRegistration.arguments[1],
	);
	const configurationRegistrationArgument = unwrapExpression(
		configurationRegistration.arguments[1],
	);
	const deleteCoordinatorProviderArgument = unwrapExpression(
		deleteCoordinatorCall.arguments[1],
	);
	const topologyCoordinatorProviderArgument = unwrapExpression(
		topologyCoordinatorCall.arguments[0],
	);
	return (
		exactBindingReferences(mainSource, mainAnalysis, rootSchemeName, [
			namedImportLocalIdentifier(mainSource, rootModule, rootSchemeName),
			rootSchemeArgument,
		]) &&
		exactBindingReferences(mainSource, mainAnalysis, configurationSchemeName, [
			namedImportLocalIdentifier(
				mainSource,
				configurationModule,
				configurationSchemeName,
			),
			configurationSchemeArgument,
		]) &&
		exactBindingReferences(mainSource, mainAnalysis, rootName, [
			rootDeclaration.name,
			deleteCoordinatorProviderArgument,
			rootRegistrationArgument,
		]) &&
		exactBindingReferences(mainSource, mainAnalysis, configurationName, [
			configurationDeclaration.name,
			configurationRegistrationArgument,
			topologyCoordinatorProviderArgument,
		])
	);
}

// `DIRECT_COMMAND_REGISTRATION_MANIFEST` entries are only mandatory when
// either the caller supplied the complete app authority (`appSources`,
// `authority.completeAppAuthority === true`) or the manifest's own file
// happens to be part of whatever narrower fixed-file set the caller did
// supply (some callers — e.g. the workspace-topology-only test fixtures —
// intentionally pass just the small, fixed workspace-topology entrypoint
// set, never app/features/themes/plain-theme-picker.ts). A manifest entry
// for a file that is simply absent from a narrower, non-complete authority
// is vacuously satisfied rather than failed; one that IS present is still
// held to its exact registration count and shape, in either mode.
function validateDirectCommandRegistrationManifest(authority, registrations) {
	const manifestPaths = DIRECT_COMMAND_REGISTRATION_MANIFEST.map(
		({ relativePath }) => relativePath,
	);
	const relevantManifestEntries = DIRECT_COMMAND_REGISTRATION_MANIFEST.filter(
		({ relativePath }) =>
			authority.completeAppAuthority === true ||
			authority.filesByPath[relativePath] !== undefined,
	);
	const expectedCount = relevantManifestEntries.reduce(
		(total, { count }) => total + count,
		0,
	);
	return (
		new Set(manifestPaths).size === manifestPaths.length &&
		registrations.length === expectedCount &&
		relevantManifestEntries.every(({ relativePath, count }) => {
			const sourceFile = authority.filesByPath[relativePath]?.sourceFile;
			const sourceRegistrations = registrations.filter(
				({ sourceFile }) => sourceFile.fileName === relativePath,
			);
			if (sourceFile === undefined || sourceRegistrations.length !== count) {
				return false;
			}
			const commandRegistryImport = namedImportLocalIdentifier(
				sourceFile,
				COMMAND_REGISTRY_MODULE,
				"CommandsRegistry",
			);
			const receivers = sourceRegistrations.map(({ call }) =>
				directMethodReceiver(call, "CommandsRegistry", "registerCommand"),
			);
			return (
				commandRegistryImport !== undefined &&
				receivers.every((receiver) => receiver !== undefined) &&
				hasExactIdentifierReferences(sourceFile, "CommandsRegistry", [
					commandRegistryImport,
					...receivers,
				])
			);
		})
	);
}

function validateTopologyAuthority(authority) {
	if (
		!authority.valid ||
		authority.sourceFiles.some(
			(sourceFile) => sourceFile.parseDiagnostics.length !== 0,
		)
	) {
		return false;
	}
	const dynamicImports = authority.callFacts.filter(
		({ call }) => call.expression.kind === ts.SyntaxKind.ImportKeyword,
	);
	const commonJsModuleAccesses = [
		...authority.importEqualsDeclarations,
		...authority.callFacts.filter(({ directName }) => directName === "require"),
	];
	const moduleImports = authority.importsExports.filter(
		({ moduleName }) => moduleName !== undefined,
	);
	const invalidStaticModulePaths = moduleImports.filter(
		({ moduleName, sourceFile }) => {
			const slashed = moduleName.replaceAll("\\", "/");
			if (
				path.posix.isAbsolute(slashed) ||
				/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(slashed)
			) {
				return true;
			}
			const resolved = resolveRelativeAppModulePath(sourceFile, moduleName);
			return (
				resolved !== undefined &&
				resolved !== "app" &&
				!resolved.startsWith("app/")
			);
		},
	);
	const isConstrainedPackage = (moduleName) =>
		moduleName.startsWith("@codingame/monaco-vscode-") ||
		moduleName === "monaco-editor" ||
		moduleName.startsWith("monaco-editor/");
	const constrainedPackageImports = moduleImports.filter(({ moduleName }) =>
		isConstrainedPackage(moduleName),
	);
	const constrainedPackageImportKeys = constrainedPackageImports.map(
		({ moduleName, sourceFile }) => `${sourceFile.fileName}:${moduleName}`,
	);
	const otherBareImportKeys = moduleImports
		.filter(
			({ moduleName, sourceFile }) =>
				resolveRelativeAppModulePath(sourceFile, moduleName) === undefined &&
				!isConstrainedPackage(moduleName),
		)
		.map(({ moduleName, sourceFile }) => `${sourceFile.fileName}:${moduleName}`)
		.sort();
	const forbiddenApiImportShapes = constrainedPackageImports.filter(
		({ moduleName, statement }) => {
			if (!moduleName.startsWith("@codingame/monaco-vscode-api")) {
				return false;
			}
			if (ts.isImportDeclaration(statement)) {
				const bindings = statement.importClause?.namedBindings;
				return (
					statement.importClause?.name !== undefined ||
					(bindings !== undefined && ts.isNamespaceImport(bindings))
				);
			}
			return (
				statement.exportClause === undefined ||
				ts.isNamespaceExport(statement.exportClause)
			);
		},
	);
	const forbiddenWriterImports = constrainedPackageImports.filter(
		({ statement }) =>
			descendants(statement, (node) => {
				if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
					return FORBIDDEN_COMMAND_WRITER_IMPORTS.includes(
						node.propertyName?.text ?? node.name.text,
					);
				}
				return (
					ts.isImportClause(node) &&
					node.name !== undefined &&
					FORBIDDEN_COMMAND_WRITER_IMPORTS.includes(node.name.text)
				);
			}).length > 0,
	);
	const forbiddenWriterReferences = [
		...authority.identifiers.filter(({ text }) =>
			FORBIDDEN_COMMAND_WRITER_NAMES.includes(text),
		),
		...authority.staticComputedAccesses.filter(({ staticName }) =>
			FORBIDDEN_COMMAND_WRITER_NAMES.includes(staticName),
		),
	];
	const initializeCalls = authority.callFacts.filter(
		({ directName }) => directName === "initialize",
	);
	const workspaceCommandAuthorityImports = moduleImports.filter(
		({ moduleName, statement }) => {
			const targetsWorkspaceCommandsModule =
				/(?:^|\/)features\/workspace\/commands(?:\.(?:ts|js))?$/u.test(
					moduleName,
				) || /^\.\/commands(?:\.(?:ts|js))?$/u.test(moduleName);
			if (ts.isImportDeclaration(statement)) {
				const clause = statement.importClause;
				const bindings = clause?.namedBindings;
				if (
					targetsWorkspaceCommandsModule &&
					(clause?.name !== undefined ||
						(bindings !== undefined && ts.isNamespaceImport(bindings)))
				) {
					return true;
				}
				return (
					bindings !== undefined &&
					ts.isNamedImports(bindings) &&
					bindings.elements.some(
						(element) =>
							(element.propertyName?.text ?? element.name.text) ===
							"registerWorkspaceCommands",
					)
				);
			}
			if (!targetsWorkspaceCommandsModule) {
				return false;
			}
			return (
				statement.exportClause === undefined ||
				ts.isNamespaceExport(statement.exportClause) ||
				(ts.isNamedExports(statement.exportClause) &&
					statement.exportClause.elements.some(
						(element) =>
							(element.propertyName?.text ?? element.name.text) ===
							"registerWorkspaceCommands",
					))
			);
		},
	);
	const workspaceCommandCalls = authority.callFacts.filter(
		({ staticName }) => staticName === "registerWorkspaceCommands",
	);
	const mainAnalysis = authority.filesByPath["app/main.ts"];
	const commandAnalysis =
		authority.filesByPath["app/features/workspace/commands.ts"];
	const excludedSurfaceAnalysis =
		authority.filesByPath["app/excluded-surfaces.ts"];
	const serviceAnalysis = authority.filesByPath["app/services.ts"];
	const mainSource = mainAnalysis?.sourceFile;
	const commandSource = commandAnalysis?.sourceFile;
	const excludedSurfaceSource = excludedSurfaceAnalysis?.sourceFile;
	const serviceSource = serviceAnalysis?.sourceFile;
	const workspaceCommandDeclarations =
		commandSource === undefined
			? []
			: commandSource.statements.filter(
					(statement) =>
						ts.isFunctionDeclaration(statement) &&
						statement.name?.text === "registerWorkspaceCommands",
				);
	const workspaceCommandDeclaration =
		workspaceCommandDeclarations.length === 1
			? workspaceCommandDeclarations[0]
			: undefined;
	const workspaceCommandMainImport =
		mainSource !== undefined
			? namedImportLocalIdentifier(
					mainSource,
					"./features/workspace/commands",
					"registerWorkspaceCommands",
				)
			: undefined;
	const workspaceCommandMainTypeReferences =
		mainAnalysis !== undefined
			? (
					mainAnalysis.identifiersByName.registerWorkspaceCommands ??
					EMPTY_NODES
				).filter((node) => ts.isTypeQueryNode(node.parent))
			: [];
	const workspaceCommandMainCalls = workspaceCommandCalls.filter(
		({ sourceFile }) => sourceFile.fileName === "app/main.ts",
	);
	const workspaceCommandMainCallee =
		workspaceCommandMainCalls.length === 1
			? unwrapExpression(workspaceCommandMainCalls[0].call.expression)
			: undefined;
	const workspaceCommandIdentifiers = authority.identifiers.filter(
		({ text }) => text === "registerWorkspaceCommands",
	);
	const computedWorkspaceCommandAccesses =
		authority.staticComputedAccesses.filter(
			({ staticName }) => staticName === "registerWorkspaceCommands",
		);
	const allowedWorkspaceCommandIdentifiers = new Set([
		workspaceCommandDeclaration?.name,
		workspaceCommandMainImport,
		workspaceCommandMainTypeReferences[0],
		workspaceCommandMainCallee,
	]);
	const commandAuthorityImports = moduleImports.filter(
		({ moduleName, statement }) => {
			if (!moduleName.startsWith("@codingame/monaco-vscode-api")) {
				return false;
			}
			if (ts.isImportDeclaration(statement)) {
				const bindings = statement.importClause?.namedBindings;
				if (bindings === undefined) {
					return false;
				}
				if (ts.isNamespaceImport(bindings)) {
					return true;
				}
				return (
					ts.isNamedImports(bindings) &&
					bindings.elements.some(
						(element) =>
							(element.propertyName?.text ?? element.name.text) ===
							"CommandsRegistry",
					)
				);
			}
			const exports = statement.exportClause;
			return (
				exports === undefined ||
				ts.isNamespaceExport(exports) ||
				(ts.isNamedExports(exports) &&
					exports.elements.some(
						(element) =>
							(element.propertyName?.text ?? element.name.text) ===
							"CommandsRegistry",
					))
			);
		},
	);
	// See validateDirectCommandRegistrationManifest's own doc comment: a
	// manifest entry only contributes an expected CommandsRegistry import when
	// its file is actually part of the authority being validated.
	const expectedCommandAuthorityImportKeys = [
		`app/excluded-surfaces.ts:${MONACO_API_MODULE}`,
		...DIRECT_COMMAND_REGISTRATION_MANIFEST.filter(
			({ relativePath }) =>
				authority.completeAppAuthority === true ||
				authority.filesByPath[relativePath] !== undefined,
		).map(({ relativePath }) => `${relativePath}:${COMMAND_REGISTRY_MODULE}`),
	].sort();
	const hasClosedProviderBindings = validateProviderBindingAuthority(
		authority,
		moduleImports,
	);
	const hasClosedProviderProducers =
		validateProviderProducerBindings(authority);
	const commandRegistrations = authority.callFacts.filter(
		({ chainName }) => chainName === "registerCommand",
	);
	const hasDirectCommandRegistrationManifest =
		validateDirectCommandRegistrationManifest(authority, commandRegistrations);
	const staticCommandRegistrations = authority.callFacts.filter(
		({ staticName }) => staticName === "registerCommand",
	);
	const directRegisterCommandNames = commandRegistrations.map(({ call }) => {
		const expression = unwrapExpression(call.expression);
		return ts.isPropertyAccessExpression(expression)
			? expression.name
			: undefined;
	});
	const registerCommandIdentifiers = authority.identifiers.filter(
		({ text }) => text === "registerCommand",
	);
	const computedRegisterCommandAccesses =
		authority.staticComputedAccesses.filter(
			({ staticName }) => staticName === "registerCommand",
		);
	const guardedIdLeaks = authority.stringLiterals.filter(
		(node) =>
			EXPECTED_GUARDED_WORKSPACE_COMMAND_IDS.includes(node.text) &&
			node.getSourceFile().fileName !== "app/features/workspace/commands.ts",
	);
	return (
		dynamicImports.length === 0 &&
		commonJsModuleAccesses.length === 0 &&
		authority.importMetaModuleAccesses.length === 0 &&
		invalidStaticModulePaths.length === 0 &&
		constrainedPackageImportKeys.length ===
			new Set(constrainedPackageImportKeys).size &&
		constrainedPackageImportKeys.every((key) =>
			ALLOWED_MONACO_APP_IMPORTS.includes(key),
		) &&
		otherBareImportKeys.length === new Set(otherBareImportKeys).size &&
		otherBareImportKeys.every((key) =>
			ALLOWED_OTHER_BARE_APP_IMPORTS.includes(key),
		) &&
		(!authority.completeAppAuthority ||
			sameStringArray(otherBareImportKeys, ALLOWED_OTHER_BARE_APP_IMPORTS)) &&
		forbiddenApiImportShapes.length === 0 &&
		forbiddenWriterImports.length === 0 &&
		forbiddenWriterReferences.length === 0 &&
		mainSource !== undefined &&
		commandSource !== undefined &&
		excludedSurfaceSource !== undefined &&
		serviceSource !== undefined &&
		hasExactNamedImport(mainSource, "@codingame/monaco-vscode-api", [
			"getService",
			"IContextKeyService",
			"IWorkspaceContextService",
			"initialize",
		]) &&
		hasExactNamedImport(commandSource, COMMAND_REGISTRY_MODULE, [
			"CommandsRegistry",
		]) &&
		hasExactNamedImport(commandSource, COMMAND_SERVICE_MODULE, [
			"ICommandService",
		]) &&
		hasExactNamedImport(commandSource, URI_MODULE, ["URI"]) &&
		hasExactNamedImport(excludedSurfaceSource, MONACO_API_MODULE, [
			"CommandsRegistry",
			"Registry",
		]) &&
		hasExactDefaultImport(
			serviceSource,
			"@codingame/monaco-vscode-workbench-service-override",
			"getWorkbenchServiceOverride",
		) &&
		initializeCalls.length === 1 &&
		initializeCalls[0].sourceFile.fileName === "app/main.ts" &&
		workspaceCommandAuthorityImports.length === 1 &&
		workspaceCommandAuthorityImports[0].sourceFile.fileName === "app/main.ts" &&
		workspaceCommandAuthorityImports[0].moduleName ===
			"./features/workspace/commands" &&
		ts.isImportDeclaration(workspaceCommandAuthorityImports[0].statement) &&
		workspaceCommandCalls.length === 1 &&
		workspaceCommandCalls[0].sourceFile.fileName === "app/main.ts" &&
		workspaceCommandDeclarations.length === 1 &&
		workspaceCommandMainImport !== undefined &&
		workspaceCommandMainTypeReferences.length === 1 &&
		workspaceCommandMainCallee !== undefined &&
		ts.isIdentifier(workspaceCommandMainCallee) &&
		workspaceCommandMainCallee.text === "registerWorkspaceCommands" &&
		computedWorkspaceCommandAccesses.length === 0 &&
		allowedWorkspaceCommandIdentifiers.size === 4 &&
		workspaceCommandIdentifiers.length ===
			allowedWorkspaceCommandIdentifiers.size &&
		workspaceCommandIdentifiers.every((identifier) =>
			allowedWorkspaceCommandIdentifiers.has(identifier),
		) &&
		hasClosedProviderBindings &&
		hasClosedProviderProducers &&
		commandAuthorityImports.length ===
			expectedCommandAuthorityImportKeys.length &&
		sameStringArray(
			commandAuthorityImports
				.map(
					({ moduleName, sourceFile }) =>
						`${sourceFile.fileName}:${moduleName}`,
				)
				.sort(),
			expectedCommandAuthorityImportKeys,
		) &&
		commandAuthorityImports.every(
			({ statement }) =>
				ts.isImportDeclaration(statement) &&
				statement.importClause?.isTypeOnly !== true &&
				ts.isNamedImports(statement.importClause?.namedBindings) &&
				statement.importClause.namedBindings.elements.some(
					(element) =>
						!element.isTypeOnly &&
						(element.propertyName?.text ?? element.name.text) ===
							"CommandsRegistry" &&
						element.name.text === "CommandsRegistry",
				),
		) &&
		hasDirectCommandRegistrationManifest &&
		staticCommandRegistrations.length === commandRegistrations.length &&
		staticCommandRegistrations.every(({ call }) =>
			commandRegistrations.some((registration) => registration.call === call),
		) &&
		computedRegisterCommandAccesses.length === 0 &&
		registerCommandIdentifiers.length === directRegisterCommandNames.length &&
		registerCommandIdentifiers.every((identifier) =>
			directRegisterCommandNames.includes(identifier),
		) &&
		validateCommandRegistryReader(excludedSurfaceSource) &&
		guardedIdLeaks.length === 0 &&
		authority.callFacts.every(
			({ chainName }) => chainName !== "projectWorkspaceSnapshot",
		)
	);
}

function sourceValue(sources, ...keys) {
	for (const key of keys) {
		if (typeof sources?.[key] === "string") {
			return sources[key];
		}
	}
	return "";
}

function safelyValidate(validator, ...args) {
	try {
		return validator(...args);
	} catch {
		return false;
	}
}

/**
 * Validates the multi-root Workbench topology seam from source text. The
 * optional Plain service implementation source tightens descriptor validation
 * into method-by-method fail-closed validation when the caller has it.
 */
export function validateWorkspaceTopologyContracts(sources) {
	const plainServicesSource = sourceValue(
		sources,
		"plainWorkspaceServices",
		"plainWorkspaceServicesSource",
	);
	const topologySources = [
		{
			relativePath: "app/main.ts",
			source: sourceValue(sources, "main", "mainSource"),
		},
		{
			relativePath: "app/services.ts",
			source: sourceValue(sources, "services", "servicesSource"),
		},
		{
			relativePath: "app/features/workspace/commands.ts",
			source: sourceValue(sources, "commands", "commandsSource"),
		},
		{
			relativePath: "app/features/workspace/workspace-projection.ts",
			source: sourceValue(
				sources,
				"projection",
				"workspaceProjection",
				"workspaceProjectionSource",
			),
		},
		{
			relativePath:
				"app/features/workspace/workspace-configuration-provider.ts",
			source: sourceValue(
				sources,
				"configurationProvider",
				"workspaceConfigurationProvider",
				"workspaceConfigurationProviderSource",
			),
		},
		{
			relativePath: "app/excluded-surfaces.ts",
			source: sourceValue(
				sources,
				"excludedSurfaces",
				"excludedSurfacesSource",
			),
		},
	];
	const namedSources = [
		...topologySources,
		...(plainServicesSource === ""
			? []
			: [
					{
						relativePath: "app/services/plain-workspace-services.ts",
						source: plainServicesSource,
					},
				]),
	];
	const hasAppSources = Array.isArray(sources?.appSources);
	const sourceEntries = hasAppSources ? sources.appSources : topologySources;
	const authority = analyzeTopologyAuthority(
		sourceEntries,
		hasAppSources ? namedSources : topologySources,
		{ completeAppAuthority: hasAppSources },
	);
	if (!authority.valid) {
		return [WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority];
	}
	const sourceFile = (relativePath) =>
		authority.filesByPath[relativePath]?.sourceFile;
	const main = sourceFile("app/main.ts");
	const services = sourceFile("app/services.ts");
	const commands = sourceFile("app/features/workspace/commands.ts");
	const projection = sourceFile(
		"app/features/workspace/workspace-projection.ts",
	);
	const configurationProvider = sourceFile(
		"app/features/workspace/workspace-configuration-provider.ts",
	);
	const plainServices =
		plainServicesSource === ""
			? undefined
			: hasAppSources
				? sourceFile("app/services/plain-workspace-services.ts")
				: parse(
						"app/services/plain-workspace-services.ts",
						plainServicesSource,
					);
	const failures = [];
	if (!safelyValidate(validateBootstrap, main)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.bootstrap);
	}
	if (
		!safelyValidate(
			validateConfigurationProvider,
			configurationProvider,
			projection,
		)
	) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.configuration);
	}
	if (!safelyValidate(validateTopologyAuthority, authority)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.authority);
	}
	if (!safelyValidate(validateCoordinator, projection)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.coordinator);
	}
	if (!safelyValidate(validateAdoption, projection)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.adoption);
	}
	if (
		!safelyValidate(validateServiceDescriptors, services) ||
		(plainServicesSource !== "" &&
			!safelyValidate(validatePlainServiceImplementation, plainServices))
	) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services);
	}
	if (!safelyValidate(validateGuardedCommands, commands)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands);
	}
	return failures;
}
