import * as ts from "typescript";

const EXPECTED_PRODUCTION_CSP = Object.freeze({
	"default-src": "'self'",
	"base-uri": "'none'",
	"connect-src": "'self' ipc: http://ipc.localhost",
	"font-src": "'self' data:",
	"img-src": "'self' data: blob:",
	"object-src": "'none'",
	"script-src": "'self' 'wasm-unsafe-eval'",
	"style-src": "'self' 'unsafe-inline'",
	"worker-src": "'self' blob:",
	"frame-src": "'none'",
	"form-action": "'none'",
});

const EXPECTED_DEVELOPMENT_CSP = Object.freeze({
	...EXPECTED_PRODUCTION_CSP,
	"connect-src": "'self' ipc: http://ipc.localhost ws://127.0.0.1:1420",
});

const EXPECTED_TAURI_BUILD = Object.freeze({
	beforeDevCommand: "pnpm dev",
	devUrl: "http://127.0.0.1:1420",
	beforeBuildCommand: "pnpm build",
	frontendDist: "../dist",
});

const EXPECTED_TAURI_E2E_SCRIPT =
	"tauri dev --config src-tauri/tauri.e2e.conf.json";
const EXPECTED_TAURI_E2E_BUILD_SCRIPT =
	"tauri build --debug --bundles app --config src-tauri/tauri.e2e.conf.json";

const EXPECTED_FRONTEND_ENTRYPOINT_SCRIPTS = Object.freeze({
	dev: "vite",
	build: "pnpm typecheck && pnpm build:frontend",
	"build:frontend": "vite build",
	typecheck:
		"tsc --project tsconfig.json --noEmit && tsc --project tsconfig.tools.json --noEmit",
	preview: "vite preview",
	tauri: "tauri",
	"tauri:dev": "tauri dev",
	"tauri:dev:e2e": EXPECTED_TAURI_E2E_SCRIPT,
	"tauri:build": "tauri build",
	"tauri:build:e2e": EXPECTED_TAURI_E2E_BUILD_SCRIPT,
});

const EXPECTED_CAPABILITY_KEYS = Object.freeze([
	"$schema",
	"description",
	"identifier",
	"permissions",
	"windows",
]);

const EXPECTED_TAURI_CONFIG_FILES = Object.freeze([
	"tauri.conf.json",
	"tauri.e2e.conf.json",
]);
const TAURI_CONFIG_FILE_PATTERN =
	/^(?:tauri(?:\.[^.]+)*\.conf\.(?:json|json5)|Tauri(?:\.[^.]+)?\.toml)$/;

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameArray(actual, expected) {
	return (
		Array.isArray(actual) &&
		actual.length === expected.length &&
		actual.every((value, index) => sameValue(value, expected[index]))
	);
}

function sameObject(actual, expected) {
	if (!isRecord(actual)) {
		return false;
	}
	const actualKeys = Object.keys(actual).sort();
	const expectedKeys = Object.keys(expected).sort();
	return (
		sameArray(actualKeys, expectedKeys) &&
		expectedKeys.every((key) => sameValue(actual[key], expected[key]))
	);
}

function sameValue(actual, expected) {
	if (Array.isArray(expected)) {
		return sameArray(actual, expected);
	}
	if (isRecord(expected)) {
		return sameObject(actual, expected);
	}
	return actual === expected;
}

export function validateTauriApiBoundary(source, relativePath) {
	if (!/@tauri-apps\/api(?:\/[^"'`\s;]+)?/.test(source)) {
		return [];
	}
	const normalizedPath = relativePath.replaceAll("\\", "/");
	return normalizedPath.startsWith("app/platform/tauri/")
		? []
		: [`${normalizedPath} bypasses the sole Tauri bridge directory`];
}

const DIALOGS_OVERRIDE_ROOT_MODULE =
	"@codingame/monaco-vscode-dialogs-service-override";
const DIALOG_SERVICE_IMPLEMENTATION_MODULE = `${DIALOGS_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/services/dialogs/common/dialogService`;
const DIALOG_HANDLER_CONTRIBUTION_MODULE = `${DIALOGS_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution`;
const DIALOG_SERVICE_TOKEN_MODULE =
	"@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
const NOTIFICATIONS_OVERRIDE_ROOT_MODULE =
	"@codingame/monaco-vscode-notifications-service-override";
const EXPECTED_SERVICE_OVERRIDE_CALLS = Object.freeze([
	"getConfigurationServiceOverride",
	"getFilesServiceOverride",
	"getModelServiceOverride",
	"getWorkbenchServiceOverride",
	"getNotificationServiceOverride",
	"getExplorerServiceOverride",
	"getThemeServiceOverride",
	"getTextmateServiceOverride",
	// `F090` S2: the multi-diff-editor override's own zero-argument factory
	// — see `validateMultiDiffEditorOverrideImportBoundary`'s own doc
	// comment for the chat/AI-cleanliness audit that justifies calling it
	// directly here, exactly like every sibling override above.
	"getMultiDiffEditorServiceOverride",
]);
// Working-copy-service-override's default export unconditionally imports
// browser/workingCopyBackupService.js and common/workingCopyHistoryService.js,
// which register BrowserWorkingCopyBackupTracker and WorkingCopyHistoryTracker
// as real Workbench contributions purely as an import-time side effect (the
// history tracker calls IFileService.cloneFile() on every save, which Plain's
// files-service patch always rejects for plain-workspace resources). Plain
// therefore never calls that package's factory; it imports WorkingCopyService
// and WorkingCopyEditorService directly from their exact class submodules,
// the same pattern already used for DialogService below.
const WORKING_COPY_OVERRIDE_ROOT_MODULE =
	"@codingame/monaco-vscode-working-copy-service-override";
const WORKING_COPY_SERVICE_IMPLEMENTATION_MODULE = `${WORKING_COPY_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/services/workingCopy/common/workingCopyService`;
const WORKING_COPY_EDITOR_SERVICE_IMPLEMENTATION_MODULE = `${WORKING_COPY_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService`;
// app/services/plain-workspace-backup-tracker.ts extends the package's
// exact, side-effect-free common/workingCopyBackupTracker submodule (see
// that file's own doc comment for the side-effect audit); it is the only
// other file permitted to reference the working-copy override.
const ALLOWED_WORKING_COPY_OVERRIDE_IMPORT_PATHS = new Set([
	"app/services.ts",
	"app/services/plain-workspace-backup-tracker.ts",
]);
// search-service-override's default export (CustomSearchService) unconditionally
// does `isHTMLFileSystemProvider(fileService.getProvider(Schemas.file))`, which
// throws a TypeError once Plain's FileService (registering no `file:` provider)
// returns undefined for that lookup; both of that factory's fallbacks are also
// front-end file searchers hard-coded to the `file:` scheme. Plain therefore
// never calls that package's factory; app/features/search/plain-search-service.ts
// extends the exact, unpatched SearchService submodule instead. That same file's
// own doc comment records the audit of searchService.js's own import graph
// (no top-level registrations beyond defining the class).
const SEARCH_OVERRIDE_ROOT_MODULE =
	"@codingame/monaco-vscode-search-service-override";
const SEARCH_SERVICE_IMPLEMENTATION_MODULE = `${SEARCH_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/services/search/common/searchService`;
// app/features/search/search-contribution.ts imports exactly one other
// submodule of this package for its side effects
// (.../browser/searchQuickAccess.contribution, which registers only the
// Cmd+P AnythingQuickAccessProvider, the `#` SymbolsQuickAccessProvider, and
// the workbench.action.showAllSymbols command). It deliberately does not
// import the package's own search.contribution.js: that file unconditionally
// imports searchChatContext.js and registers SearchChatContextContribution as
// a real WorkbenchPhase.AfterRestored contribution wiring Search results into
// IChatContextPickService, a Chat/AI context-attachment surface forbidden by
// AGENTS.md — see search-contribution.ts's own doc comment for the full audit.
const ALLOWED_SEARCH_OVERRIDE_IMPORT_PATHS = new Set([
	"app/features/search/plain-search-service.ts",
	"app/features/search/search-contribution.ts",
]);

function staticStringValue(node) {
	if (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isTypeAssertionExpression(node) ||
		ts.isSatisfiesExpression(node)
	) {
		return staticStringValue(node.expression);
	}
	if (ts.isStringLiteralLike(node)) {
		return node.text;
	}
	if (
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.PlusToken
	) {
		const left = staticStringValue(node.left);
		const right = staticStringValue(node.right);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	return undefined;
}

function isNotificationsOverrideModule(moduleName) {
	return (
		moduleName === NOTIFICATIONS_OVERRIDE_ROOT_MODULE ||
		moduleName.startsWith(`${NOTIFICATIONS_OVERRIDE_ROOT_MODULE}/`)
	);
}

export function validateDialogOverrideImportBoundary(source, relativePath) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let importsDialogsOverride = false;
	function visit(node) {
		if (
			ts.isStringLiteralLike(node) &&
			(node.text === DIALOGS_OVERRIDE_ROOT_MODULE ||
				node.text.startsWith(`${DIALOGS_OVERRIDE_ROOT_MODULE}/`))
		) {
			importsDialogsOverride = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	return importsDialogsOverride && normalizedPath !== "app/services.ts"
		? [`${normalizedPath} imports the dialogs override outside app/services.ts`]
		: [];
}

export function validateNotificationOverrideImportBoundary(
	source,
	relativePath,
) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let referencesNotificationsOverride = false;
	function visit(node) {
		if (
			ts.isStringLiteralLike(node) &&
			isNotificationsOverrideModule(node.text)
		) {
			referencesNotificationsOverride = true;
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			isNotificationsOverrideModule(staticStringValue(node.arguments[0]) ?? "")
		) {
			referencesNotificationsOverride = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	return referencesNotificationsOverride && normalizedPath !== "app/services.ts"
		? [
				`${normalizedPath} imports the notifications override outside app/services.ts`,
			]
		: [];
}

const SEARCH_CONTRIBUTION_MODULE = `${SEARCH_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/contrib/search/browser/search.contribution`;
const SEARCH_EDITOR_CONTRIBUTION_MODULE = `${SEARCH_OVERRIDE_ROOT_MODULE}/vscode/vs/workbench/contrib/searchEditor/browser/searchEditor.contribution`;

function isSearchOverrideModule(moduleName) {
	return (
		moduleName === SEARCH_OVERRIDE_ROOT_MODULE ||
		moduleName.startsWith(`${SEARCH_OVERRIDE_ROOT_MODULE}/`)
	);
}

export function validateSearchOverrideImportBoundary(source, relativePath) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let referencesSearchOverride = false;
	let referencesAggregatingEntryPoint = false;
	let referencesSearchContributionModule = false;
	function record(moduleName) {
		if (!isSearchOverrideModule(moduleName)) {
			return;
		}
		referencesSearchOverride = true;
		if (moduleName === SEARCH_OVERRIDE_ROOT_MODULE) {
			referencesAggregatingEntryPoint = true;
		}
		if (
			moduleName === SEARCH_CONTRIBUTION_MODULE ||
			moduleName === SEARCH_EDITOR_CONTRIBUTION_MODULE
		) {
			referencesSearchContributionModule = true;
		}
	}
	function visit(node) {
		if (ts.isStringLiteralLike(node)) {
			record(node.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0
		) {
			record(staticStringValue(node.arguments[0]) ?? "");
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	const failures = [];
	if (
		referencesSearchOverride &&
		!ALLOWED_SEARCH_OVERRIDE_IMPORT_PATHS.has(normalizedPath)
	) {
		failures.push(
			`${normalizedPath} imports the search override outside its audited files`,
		);
	}
	if (referencesAggregatingEntryPoint) {
		failures.push(
			`${normalizedPath} must not import the search-service-override aggregating entry point`,
		);
	}
	if (referencesSearchContributionModule) {
		// search.contribution.js (and searchEditor.contribution.js, which it
		// also imports) unconditionally registers SearchChatContextContribution
		// as a real WorkbenchPhase.AfterRestored contribution wiring Search
		// results/files/symbols into IChatContextPickService — a Chat/AI
		// context-attachment surface. AGENTS.md forbids adding AI/Chat/Agent/MCP
		// surfaces, and the runtime excluded-surface guard cannot catch this
		// because it only audits commandIds/viewContainerIds/viewIds, not
		// registerWorkbenchContribution2 ids. Only the narrower
		// searchQuickAccess.contribution submodule (imported by
		// app/features/search/search-contribution.ts) and Plain's own
		// hand-reproduced view-container/view registration are permitted.
		failures.push(
			`${normalizedPath} must not import the search.contribution/searchEditor.contribution modules`,
		);
	}
	if (normalizedPath === "app/features/search/plain-search-service.ts") {
		const searchServiceImports = sourceFile.statements.filter(
			(statement) =>
				ts.isImportDeclaration(statement) &&
				ts.isStringLiteral(statement.moduleSpecifier) &&
				statement.moduleSpecifier.text === SEARCH_SERVICE_IMPLEMENTATION_MODULE,
		);
		const isExactSearchServiceImport =
			searchServiceImports.length === 1 &&
			searchServiceImports[0].importClause?.isTypeOnly !== true &&
			searchServiceImports[0].importClause?.name === undefined &&
			ts.isNamedImports(searchServiceImports[0].importClause?.namedBindings) &&
			searchServiceImports[0].importClause.namedBindings.elements.length ===
				1 &&
			!searchServiceImports[0].importClause.namedBindings.elements[0]
				.isTypeOnly &&
			(searchServiceImports[0].importClause.namedBindings.elements[0]
				.propertyName?.text ??
				searchServiceImports[0].importClause.namedBindings.elements[0].name
					.text) === "SearchService" &&
			searchServiceImports[0].importClause.namedBindings.elements[0].name
				.text === "SearchService";
		if (!isExactSearchServiceImport) {
			failures.push(
				`${normalizedPath} must import only the exact SearchService class subpath`,
			);
		}
	}
	return failures;
}

function isWorkingCopyOverrideModule(moduleName) {
	return (
		moduleName === WORKING_COPY_OVERRIDE_ROOT_MODULE ||
		moduleName.startsWith(`${WORKING_COPY_OVERRIDE_ROOT_MODULE}/`)
	);
}

export function validateWorkingCopyOverrideImportBoundary(
	source,
	relativePath,
) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let referencesWorkingCopyOverride = false;
	let referencesAggregatingEntryPoint = false;
	function visit(node) {
		if (
			ts.isStringLiteralLike(node) &&
			isWorkingCopyOverrideModule(node.text)
		) {
			referencesWorkingCopyOverride = true;
			if (node.text === WORKING_COPY_OVERRIDE_ROOT_MODULE) {
				referencesAggregatingEntryPoint = true;
			}
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0
		) {
			const moduleName = staticStringValue(node.arguments[0]) ?? "";
			if (isWorkingCopyOverrideModule(moduleName)) {
				referencesWorkingCopyOverride = true;
				if (moduleName === WORKING_COPY_OVERRIDE_ROOT_MODULE) {
					referencesAggregatingEntryPoint = true;
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	const failures = [];
	if (
		referencesWorkingCopyOverride &&
		!ALLOWED_WORKING_COPY_OVERRIDE_IMPORT_PATHS.has(normalizedPath)
	) {
		failures.push(
			`${normalizedPath} imports the working-copy override outside its audited files`,
		);
	}
	if (referencesAggregatingEntryPoint) {
		// The package's default export unconditionally imports
		// browser/workingCopyBackupService.js and
		// common/workingCopyHistoryService.js, which register
		// BrowserWorkingCopyBackupTracker and WorkingCopyHistoryTracker as real
		// Workbench contributions as an import-time side effect: the history
		// tracker calls IFileService.cloneFile() on every save, which Plain's
		// files-service patch always rejects for plain-workspace resources.
		failures.push(
			`${normalizedPath} must not import the working-copy-service-override aggregating entry point`,
		);
	}
	return failures;
}

/**
 * `F090` S2 installs `@codingame/monaco-vscode-multi-diff-editor-service-
 * override@35.0.1` — the first new vendor override this feature adds (see
 * `docs/research/2026-07-26-git-history.md`'s own chat/AI-coupling audit).
 * Confirmed clean by reading the real, installed tarball (not merely the
 * research doc's own summary): its only file (`index.js`) does
 * `getServiceOverride() { return { [IMultiDiffSourceResolverService...]:
 * new SyncDescriptor(MultiDiffSourceResolverService, [], true) }; }` and a
 * side-effect import of `multiDiffEditor.contribution.js` (which itself only
 * registers the multi-diff editor pane, its actions, and the base package's
 * own `ScmMultiDiffSourceResolverContribution`/`OpenScmGroupAction` — audited
 * zero chat/copilot references, only `ISCMService`/`IEditorService`/
 * `IActivityService` dependencies) — this override package is therefore
 * called directly, exactly like every sibling override in
 * `app/services.ts`'s `createServiceOverrides` (never an aggregating-entry-
 * point exception the way `working-copy-service-override`'s own factory
 * needs). Plain's own resolver (`plain-git-commit-detail.ts`) and view code
 * never import this override package at all — they only import
 * `IMultiDiffSourceResolverService`/`IMultiDiffSourceResolver`/
 * `MultiDiffEditorItem` from the *base* `@codingame/monaco-vscode-api`
 * package (already unrestricted by this boundary; those types live there,
 * not in the override package itself) — so `app/services.ts` is this
 * package's *only* legitimate reference anywhere in `app/`.
 */
const MULTI_DIFF_EDITOR_OVERRIDE_ROOT_MODULE =
	"@codingame/monaco-vscode-multi-diff-editor-service-override";

function isMultiDiffEditorOverrideModule(moduleName) {
	return (
		moduleName === MULTI_DIFF_EDITOR_OVERRIDE_ROOT_MODULE ||
		moduleName.startsWith(`${MULTI_DIFF_EDITOR_OVERRIDE_ROOT_MODULE}/`)
	);
}

export function validateMultiDiffEditorOverrideImportBoundary(
	source,
	relativePath,
) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let referencesMultiDiffEditorOverride = false;
	function visit(node) {
		if (
			ts.isStringLiteralLike(node) &&
			isMultiDiffEditorOverrideModule(node.text)
		) {
			referencesMultiDiffEditorOverride = true;
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			isMultiDiffEditorOverrideModule(
				staticStringValue(node.arguments[0]) ?? "",
			)
		) {
			referencesMultiDiffEditorOverride = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	return referencesMultiDiffEditorOverride &&
		normalizedPath !== "app/services.ts"
		? [
				`${normalizedPath} imports the multi-diff-editor override outside app/services.ts`,
			]
		: [];
}

export function validateDialogSurfaceBoundary(source, relativePath) {
	const sourceFile = ts.createSourceFile(
		relativePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const globalObjects = new Set(["globalThis", "mainWindow", "self", "window"]);
	let referencesFileDialogService = false;
	let usesGlobalConfirm = false;
	const isGlobalObject = (node) =>
		ts.isIdentifier(node) && globalObjects.has(node.text);
	function visit(node) {
		if (ts.isIdentifier(node) && node.text === "IFileDialogService") {
			referencesFileDialogService = true;
		}
		if (
			(ts.isPropertyAccessExpression(node) &&
				isGlobalObject(node.expression) &&
				node.name.text === "confirm") ||
			(ts.isElementAccessExpression(node) &&
				isGlobalObject(node.expression) &&
				ts.isStringLiteralLike(node.argumentExpression) &&
				node.argumentExpression.text === "confirm") ||
			(ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "confirm")
		) {
			usesGlobalConfirm = true;
		}
		if (
			ts.isVariableDeclaration(node) &&
			ts.isObjectBindingPattern(node.name) &&
			node.initializer !== undefined &&
			isGlobalObject(node.initializer) &&
			node.name.elements.some((element) => {
				const importedName = element.propertyName ?? element.name;
				return ts.isIdentifier(importedName) && importedName.text === "confirm";
			})
		) {
			usesGlobalConfirm = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const normalizedPath = relativePath.replaceAll("\\", "/");
	const failures = [];
	if (referencesFileDialogService) {
		failures.push(
			`${normalizedPath} references IFileDialogService outside Plain's Rust picker boundary`,
		);
	}
	if (usesGlobalConfirm) {
		failures.push(`${normalizedPath} uses a forbidden global confirm path`);
	}
	return failures;
}

export function validateDialogServiceOverride(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"services.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const dialogModuleReferences = [];
	function collectDialogModuleReferences(node) {
		if (
			ts.isStringLiteralLike(node) &&
			(node.text === DIALOGS_OVERRIDE_ROOT_MODULE ||
				node.text.startsWith(`${DIALOGS_OVERRIDE_ROOT_MODULE}/`))
		) {
			dialogModuleReferences.push(node.text);
		}
		ts.forEachChild(node, collectDialogModuleReferences);
	}
	collectDialogModuleReferences(sourceFile);
	const allDialogImports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			(statement.moduleSpecifier.text === DIALOGS_OVERRIDE_ROOT_MODULE ||
				statement.moduleSpecifier.text.startsWith(
					`${DIALOGS_OVERRIDE_ROOT_MODULE}/`,
				)),
	);
	const implementationImports = allDialogImports.filter(
		(statement) =>
			statement.moduleSpecifier.text === DIALOG_SERVICE_IMPLEMENTATION_MODULE,
	);
	const implementationElements =
		implementationImports.length === 1 &&
		implementationImports[0].importClause?.isTypeOnly !== true &&
		implementationImports[0].importClause?.name === undefined &&
		ts.isNamedImports(implementationImports[0].importClause?.namedBindings)
			? implementationImports[0].importClause.namedBindings.elements
			: undefined;
	const contributionImports = allDialogImports.filter(
		(statement) =>
			statement.moduleSpecifier.text === DIALOG_HANDLER_CONTRIBUTION_MODULE,
	);
	if (
		dialogModuleReferences.length !== 2 ||
		allDialogImports.length !== 2 ||
		implementationElements?.length !== 1 ||
		implementationElements[0].isTypeOnly ||
		(implementationElements[0].propertyName?.text ??
			implementationElements[0].name.text) !== "DialogService" ||
		implementationElements[0].name.text !== "DialogService" ||
		contributionImports.length !== 1 ||
		contributionImports[0].importClause !== undefined
	) {
		failures.push(
			"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
		);
	}
	const dialogTokenImports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === DIALOG_SERVICE_TOKEN_MODULE,
	);
	const dialogTokenElements =
		dialogTokenImports.length === 1 &&
		dialogTokenImports[0].importClause?.isTypeOnly !== true &&
		dialogTokenImports[0].importClause?.name === undefined &&
		ts.isNamedImports(dialogTokenImports[0].importClause?.namedBindings)
			? dialogTokenImports[0].importClause.namedBindings.elements
			: undefined;
	if (
		dialogTokenElements?.length !== 1 ||
		dialogTokenElements[0].isTypeOnly ||
		(dialogTokenElements[0].propertyName?.text ??
			dialogTokenElements[0].name.text) !== "IDialogService" ||
		dialogTokenElements[0].name.text !== "IDialogService"
	) {
		failures.push(
			"app/services.ts must import only the direct IDialogService token from its fixed API module",
		);
	}

	const notificationModuleReferences = [];
	let hasDynamicNotificationImport = false;
	function collectNotificationModuleReferences(node) {
		if (
			ts.isStringLiteralLike(node) &&
			isNotificationsOverrideModule(node.text)
		) {
			notificationModuleReferences.push(node.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			isNotificationsOverrideModule(staticStringValue(node.arguments[0]) ?? "")
		) {
			hasDynamicNotificationImport = true;
		}
		ts.forEachChild(node, collectNotificationModuleReferences);
	}
	collectNotificationModuleReferences(sourceFile);
	const notificationImports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			(statement.moduleSpecifier.text === NOTIFICATIONS_OVERRIDE_ROOT_MODULE ||
				statement.moduleSpecifier.text.startsWith(
					`${NOTIFICATIONS_OVERRIDE_ROOT_MODULE}/`,
				)),
	);
	const notificationImport = notificationImports.filter(
		(statement) =>
			statement.moduleSpecifier.text === NOTIFICATIONS_OVERRIDE_ROOT_MODULE,
	);
	if (
		notificationModuleReferences.length !== 1 ||
		hasDynamicNotificationImport ||
		notificationImports.length !== 1 ||
		notificationImport.length !== 1 ||
		notificationImport[0].importClause?.isTypeOnly === true ||
		notificationImport[0].importClause?.name?.text !==
			"getNotificationServiceOverride" ||
		notificationImport[0].importClause?.namedBindings !== undefined
	) {
		failures.push(
			"app/services.ts must import the exact notifications override as getNotificationServiceOverride",
		);
	}

	const workingCopyModuleReferences = [];
	let hasDynamicWorkingCopyImport = false;
	function collectWorkingCopyModuleReferences(node) {
		if (
			ts.isStringLiteralLike(node) &&
			isWorkingCopyOverrideModule(node.text)
		) {
			workingCopyModuleReferences.push(node.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length > 0 &&
			isWorkingCopyOverrideModule(staticStringValue(node.arguments[0]) ?? "")
		) {
			hasDynamicWorkingCopyImport = true;
		}
		ts.forEachChild(node, collectWorkingCopyModuleReferences);
	}
	collectWorkingCopyModuleReferences(sourceFile);
	const workingCopyImports = sourceFile.statements.filter(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			isWorkingCopyOverrideModule(statement.moduleSpecifier.text),
	);
	function isExactWorkingCopyClassImport(
		statement,
		expectedModule,
		expectedName,
	) {
		return (
			statement !== undefined &&
			statement.moduleSpecifier.text === expectedModule &&
			statement.importClause?.isTypeOnly !== true &&
			statement.importClause?.name === undefined &&
			ts.isNamedImports(statement.importClause?.namedBindings) &&
			statement.importClause.namedBindings.elements.length === 1 &&
			!statement.importClause.namedBindings.elements[0].isTypeOnly &&
			(statement.importClause.namedBindings.elements[0].propertyName?.text ??
				statement.importClause.namedBindings.elements[0].name.text) ===
				expectedName &&
			statement.importClause.namedBindings.elements[0].name.text ===
				expectedName
		);
	}
	const workingCopyServiceImport = workingCopyImports.find(
		(statement) =>
			statement.moduleSpecifier.text ===
			WORKING_COPY_SERVICE_IMPLEMENTATION_MODULE,
	);
	const workingCopyEditorServiceImport = workingCopyImports.find(
		(statement) =>
			statement.moduleSpecifier.text ===
			WORKING_COPY_EDITOR_SERVICE_IMPLEMENTATION_MODULE,
	);
	// Isolated fixtures exercising unrelated Dialog/Notification checks may
	// omit working-copy wiring entirely (mirrors how IWorkspaceEditingService/
	// IWorkspacesService are optional here too); but once any working-copy
	// override reference appears, it must be exactly this closed shape.
	if (workingCopyModuleReferences.length > 0 || hasDynamicWorkingCopyImport) {
		if (
			workingCopyModuleReferences.length !== 2 ||
			hasDynamicWorkingCopyImport ||
			workingCopyImports.length !== 2 ||
			!isExactWorkingCopyClassImport(
				workingCopyServiceImport,
				WORKING_COPY_SERVICE_IMPLEMENTATION_MODULE,
				"WorkingCopyService",
			) ||
			!isExactWorkingCopyClassImport(
				workingCopyEditorServiceImport,
				WORKING_COPY_EDITOR_SERVICE_IMPLEMENTATION_MODULE,
				"WorkingCopyEditorService",
			)
		) {
			failures.push(
				"app/services.ts must import only the exact WorkingCopyService and WorkingCopyEditorService class subpaths",
			);
		}
	}

	const factories = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "createServiceOverrides" &&
			statement.body !== undefined,
	);
	if (factories.length !== 1) {
		return [
			...failures,
			"app/services.ts must define exactly one audited service override factory",
		];
	}
	const returns = factories[0].body.statements.filter(ts.isReturnStatement);
	const overrideObject =
		factories[0].body.statements.length === 1 &&
		returns.length === 1 &&
		returns[0].expression !== undefined &&
		ts.isObjectLiteralExpression(returns[0].expression)
			? returns[0].expression
			: undefined;
	if (overrideObject === undefined) {
		return [
			...failures,
			"createServiceOverrides must directly return one audited object literal",
		];
	}

	const spreadCalls = [];
	let malformedSpread = false;
	for (const property of overrideObject.properties) {
		if (!ts.isSpreadAssignment(property)) {
			continue;
		}
		if (
			!ts.isCallExpression(property.expression) ||
			!ts.isIdentifier(property.expression.expression) ||
			property.expression.arguments.length !== 0
		) {
			malformedSpread = true;
			continue;
		}
		spreadCalls.push(property.expression.expression.text);
	}
	if (
		malformedSpread ||
		!sameArray(spreadCalls, EXPECTED_SERVICE_OVERRIDE_CALLS)
	) {
		failures.push(
			"createServiceOverrides must keep the exact direct service spread order",
		);
	}

	const nonSpreadProperties = overrideObject.properties.filter(
		(property) => !ts.isSpreadAssignment(property),
	);
	// Between the zero-argument override spreads and the trailing audited
	// IDialogService/ILanguageStatusService pair, only this exact closed set
	// of hand-selected SyncDescriptor bindings is permitted, in this order.
	const MIDDLE_SERVICE_DESCRIPTORS = Object.freeze([
		{
			tokenName: "IWorkspaceEditingService",
			className: "PlainWorkspaceEditingService",
			thirdArgIsTrue: true,
		},
		{
			tokenName: "IWorkspacesService",
			className: "PlainWorkspacesService",
			thirdArgIsTrue: true,
		},
		{
			tokenName: "IWorkingCopyService",
			className: "WorkingCopyService",
			thirdArgIsTrue: false,
		},
		{
			tokenName: "IWorkingCopyEditorService",
			className: "WorkingCopyEditorService",
			thirdArgIsTrue: false,
		},
		{
			tokenName: "IWorkingCopyBackupService",
			className: "PlainWorkingCopyBackupService",
			thirdArgIsTrue: false,
		},
		{
			tokenName: "ISearchService",
			className: "PlainSearchService",
			thirdArgIsTrue: true,
		},
		{
			tokenName: "IExtensionResourceLoaderService",
			className: "PlainExtensionResourceLoaderService",
			thirdArgIsTrue: false,
		},
		{
			tokenName: "ISCMService",
			className: "SCMService",
			thirdArgIsTrue: true,
		},
		{
			tokenName: "IExtensionService",
			className: "PlainNullExtensionService",
			thirdArgIsTrue: true,
		},
	]);
	function matchesMiddleServiceDescriptor(property, spec) {
		if (
			!ts.isPropertyAssignment(property) ||
			!ts.isComputedPropertyName(property.name) ||
			!ts.isCallExpression(property.name.expression) ||
			!ts.isPropertyAccessExpression(property.name.expression.expression) ||
			!ts.isIdentifier(property.name.expression.expression.expression) ||
			property.name.expression.expression.expression.text !== spec.tokenName ||
			property.name.expression.expression.name.text !== "toString" ||
			property.name.expression.arguments.length !== 0
		) {
			return false;
		}
		const initializer = property.initializer;
		return (
			ts.isNewExpression(initializer) &&
			ts.isIdentifier(initializer.expression) &&
			initializer.expression.text === "SyncDescriptor" &&
			initializer.arguments?.length === 3 &&
			ts.isIdentifier(initializer.arguments[0]) &&
			initializer.arguments[0].text === spec.className &&
			ts.isArrayLiteralExpression(initializer.arguments[1]) &&
			initializer.arguments[1].elements.length === 0 &&
			initializer.arguments[2].kind ===
				(spec.thirdArgIsTrue
					? ts.SyntaxKind.TrueKeyword
					: ts.SyntaxKind.FalseKeyword)
		);
	}
	const middleProperties = nonSpreadProperties.slice(0, -2);
	const hasMiddleServiceDescriptors =
		middleProperties.length === MIDDLE_SERVICE_DESCRIPTORS.length &&
		middleProperties.every((property, index) =>
			matchesMiddleServiceDescriptor(
				property,
				MIDDLE_SERVICE_DESCRIPTORS[index],
			),
		);
	if (middleProperties.length !== 0 && !hasMiddleServiceDescriptors) {
		failures.push(
			"createServiceOverrides must keep the exact hand-selected working-copy and workspace service descriptors",
		);
	}
	function isDialogServiceKeyCall(expression) {
		return (
			ts.isCallExpression(expression) &&
			ts.isPropertyAccessExpression(expression.expression) &&
			ts.isIdentifier(expression.expression.expression) &&
			expression.expression.expression.text === "IDialogService" &&
			expression.expression.name.text === "toString" &&
			expression.arguments.length === 0
		);
	}
	const dialogService = nonSpreadProperties.at(-2);
	const dialogServiceName =
		dialogService !== undefined &&
		ts.isPropertyAssignment(dialogService) &&
		ts.isComputedPropertyName(dialogService.name) &&
		isDialogServiceKeyCall(dialogService.name.expression);
	const dialogServiceInitializer =
		dialogService !== undefined && ts.isPropertyAssignment(dialogService)
			? dialogService.initializer
			: undefined;
	const dialogServiceInitializerIsExact =
		dialogServiceInitializer !== undefined &&
		ts.isNewExpression(dialogServiceInitializer) &&
		ts.isIdentifier(dialogServiceInitializer.expression) &&
		dialogServiceInitializer.expression.text === "SyncDescriptor" &&
		dialogServiceInitializer.arguments?.length === 3 &&
		ts.isIdentifier(dialogServiceInitializer.arguments[0]) &&
		dialogServiceInitializer.arguments[0].text === "DialogService" &&
		ts.isIdentifier(dialogServiceInitializer.arguments[1]) &&
		dialogServiceInitializer.arguments[1].text === "undefined" &&
		dialogServiceInitializer.arguments[2].kind === ts.SyntaxKind.TrueKeyword;
	const languageStatus = nonSpreadProperties.at(-1);
	const languageStatusName =
		languageStatus !== undefined &&
		ts.isPropertyAssignment(languageStatus) &&
		ts.isComputedPropertyName(languageStatus.name) &&
		ts.isCallExpression(languageStatus.name.expression) &&
		ts.isPropertyAccessExpression(languageStatus.name.expression.expression) &&
		ts.isIdentifier(languageStatus.name.expression.expression.expression) &&
		languageStatus.name.expression.expression.expression.text ===
			"ILanguageStatusService" &&
		languageStatus.name.expression.expression.name.text === "toString" &&
		languageStatus.name.expression.arguments.length === 0;
	const descriptor =
		languageStatus !== undefined && ts.isPropertyAssignment(languageStatus)
			? languageStatus.initializer
			: undefined;
	const descriptorIsExact =
		descriptor !== undefined &&
		ts.isNewExpression(descriptor) &&
		ts.isIdentifier(descriptor.expression) &&
		descriptor.expression.text === "SyncDescriptor" &&
		descriptor.arguments?.length === 3 &&
		ts.isIdentifier(descriptor.arguments[0]) &&
		descriptor.arguments[0].text === "EmptyLanguageStatusService" &&
		ts.isArrayLiteralExpression(descriptor.arguments[1]) &&
		descriptor.arguments[1].elements.length === 0 &&
		descriptor.arguments[2].kind === ts.SyntaxKind.TrueKeyword;
	if (
		![2, 2 + MIDDLE_SERVICE_DESCRIPTORS.length].includes(
			nonSpreadProperties.length,
		) ||
		overrideObject.properties.length !==
			EXPECTED_SERVICE_OVERRIDE_CALLS.length + nonSpreadProperties.length ||
		!dialogServiceName ||
		!dialogServiceInitializerIsExact ||
		!languageStatusName ||
		!descriptorIsExact
	) {
		failures.push(
			"createServiceOverrides must end with the audited delayed IDialogService and empty language-status descriptors",
		);
	}
	function computedServiceTokenName(property) {
		if (
			!ts.isPropertyAssignment(property) ||
			!ts.isComputedPropertyName(property.name) ||
			!ts.isCallExpression(property.name.expression) ||
			!ts.isPropertyAccessExpression(property.name.expression.expression) ||
			!ts.isIdentifier(property.name.expression.expression.expression) ||
			property.name.expression.expression.name.text !== "toString" ||
			property.name.expression.arguments.length !== 0
		) {
			return undefined;
		}
		return property.name.expression.expression.expression.text;
	}
	const propertyOrder = overrideObject.properties.map((property) => {
		if (
			ts.isSpreadAssignment(property) &&
			ts.isCallExpression(property.expression) &&
			ts.isIdentifier(property.expression.expression) &&
			property.expression.arguments.length === 0
		) {
			return property.expression.expression.text;
		}
		if (property === dialogService) {
			return "IDialogService";
		}
		if (property === languageStatus) {
			return "ILanguageStatusService";
		}
		return computedServiceTokenName(property) ?? "invalid";
	});
	if (
		!sameArray(propertyOrder, [
			...EXPECTED_SERVICE_OVERRIDE_CALLS,
			...(hasMiddleServiceDescriptors
				? MIDDLE_SERVICE_DESCRIPTORS.map((spec) => spec.tokenName)
				: []),
			"IDialogService",
			"ILanguageStatusService",
		])
	) {
		failures.push(
			"createServiceOverrides must keep IDialogService as the final Workbench override before language status",
		);
	}

	let dialogBindingReferences = 0;
	let dialogServiceTokenReferences = 0;
	let notificationOverrideBindingReferences = 0;
	let fileDialogServiceReference = false;
	let globalConfirmReference = false;
	let workingCopyServiceBindingReferences = 0;
	let workingCopyEditorServiceBindingReferences = 0;
	let workingCopyServiceTokenReferences = 0;
	let workingCopyEditorServiceTokenReferences = 0;
	function visit(node) {
		if (ts.isIdentifier(node)) {
			if (node.text === "DialogService") {
				dialogBindingReferences += 1;
			}
			if (node.text === "IDialogService") {
				dialogServiceTokenReferences += 1;
			}
			if (node.text === "getNotificationServiceOverride") {
				notificationOverrideBindingReferences += 1;
			}
			if (node.text === "IFileDialogService") {
				fileDialogServiceReference = true;
			}
			if (node.text === "WorkingCopyService") {
				workingCopyServiceBindingReferences += 1;
			}
			if (node.text === "WorkingCopyEditorService") {
				workingCopyEditorServiceBindingReferences += 1;
			}
			if (node.text === "IWorkingCopyService") {
				workingCopyServiceTokenReferences += 1;
			}
			if (node.text === "IWorkingCopyEditorService") {
				workingCopyEditorServiceTokenReferences += 1;
			}
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			node.name.text === "confirm" &&
			ts.isIdentifier(node.expression) &&
			["globalThis", "mainWindow", "window"].includes(node.expression.text)
		) {
			globalConfirmReference = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (dialogBindingReferences !== 2) {
		failures.push(
			"DialogService may appear only in its exact import and audited IDialogService descriptor",
		);
	}
	if (dialogServiceTokenReferences !== 2) {
		failures.push(
			"IDialogService may appear only in its import and output key",
		);
	}
	if (notificationOverrideBindingReferences !== 2) {
		failures.push(
			"getNotificationServiceOverride may appear only in its exact import and audited service spread",
		);
	}
	const workingCopyReferenceCounts = [
		workingCopyServiceBindingReferences,
		workingCopyEditorServiceBindingReferences,
		workingCopyServiceTokenReferences,
		workingCopyEditorServiceTokenReferences,
	];
	if (
		workingCopyReferenceCounts.some((count) => count !== 0) &&
		workingCopyReferenceCounts.some((count) => count !== 2)
	) {
		failures.push(
			"WorkingCopyService and WorkingCopyEditorService may appear only in their exact imports and audited descriptors",
		);
	}
	if (fileDialogServiceReference || globalConfirmReference) {
		failures.push(
			"app/services.ts must not enable IFileDialogService or fall back to global confirm",
		);
	}

	return failures;
}

export function validateWorkspaceProviderBootstrap(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"main.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	function countExactNamedImport(moduleName, importedName) {
		let count = 0;
		for (const statement of sourceFile.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				statement.moduleSpecifier.text !== moduleName ||
				statement.importClause?.isTypeOnly === true ||
				!ts.isNamedImports(statement.importClause?.namedBindings)
			) {
				continue;
			}
			for (const specifier of statement.importClause.namedBindings.elements) {
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						importedName &&
					specifier.name.text === importedName
				) {
					count += 1;
				}
			}
		}
		return count;
	}
	for (const [moduleName, importedName] of [
		["@codingame/monaco-vscode-api", "initialize"],
		[
			"@codingame/monaco-vscode-files-service-override",
			"registerCustomProvider",
		],
		[
			"./features/workspace/file-system-provider",
			"createPlainWorkspaceFileSystemProvider",
		],
		["./features/workspace/file-system-provider", "PLAIN_WORKSPACE_SCHEME"],
		[
			"./features/workspace/delete-coordinator",
			"registerWorkspaceDeleteCoordinator",
		],
		["./platform/tauri", "createBridge"],
		[
			"./services/plain-workspace-backup-service",
			"configurePlainWorkingCopyBackupBridge",
		],
		["./features/search/plain-search-service", "configurePlainSearchBridge"],
	]) {
		if (countExactNamedImport(moduleName, importedName) !== 1) {
			failures.push(
				`app/main.ts must import ${importedName} exactly by name from ${moduleName}`,
			);
		}
	}
	const bootstraps = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "bootstrap" &&
			statement.body !== undefined,
	);
	if (bootstraps.length !== 1) {
		return ["app/main.ts must define exactly one audited bootstrap function"];
	}
	const bootstrap = bootstraps[0];
	const statements = bootstrap.body.statements;
	const criticalBootstrapBindings = new Set([
		"createBridge",
		"createPlainWorkspaceFileSystemProvider",
		"registerWorkspaceDeleteCoordinator",
		"registerCustomProvider",
		"initialize",
		"PLAIN_WORKSPACE_SCHEME",
		"configurePlainWorkingCopyBackupBridge",
		"configurePlainSearchBridge",
	]);
	let hasCriticalBootstrapShadow = false;
	function bindingContainsCriticalName(name) {
		if (ts.isIdentifier(name)) {
			return criticalBootstrapBindings.has(name.text);
		}
		return name.elements.some(
			(element) =>
				!ts.isOmittedExpression(element) &&
				bindingContainsCriticalName(element.name),
		);
	}
	function visitBootstrapBindings(node) {
		if (
			((ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
				bindingContainsCriticalName(node.name)) ||
			((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
				node.name !== undefined &&
				criticalBootstrapBindings.has(node.name.text)) ||
			(ts.isCatchClause(node) &&
				node.variableDeclaration !== undefined &&
				bindingContainsCriticalName(node.variableDeclaration.name))
		) {
			hasCriticalBootstrapShadow = true;
		}
		ts.forEachChild(node, visitBootstrapBindings);
	}
	visitBootstrapBindings(bootstrap.body);
	if (hasCriticalBootstrapShadow) {
		failures.push(
			"bootstrap must not shadow any audited provider-registration binding",
		);
	}

	function exactConstDeclaration(statement, bindingName) {
		if (
			!ts.isVariableStatement(statement) ||
			(statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
			statement.declarationList.declarations.length !== 1
		) {
			return undefined;
		}
		const [declaration] = statement.declarationList.declarations;
		return ts.isIdentifier(declaration.name) &&
			declaration.name.text === bindingName
			? declaration
			: undefined;
	}

	function identifierCall(expression, name, argumentCount) {
		return (
			ts.isCallExpression(expression) &&
			ts.isIdentifier(expression.expression) &&
			expression.expression.text === name &&
			expression.arguments.length === argumentCount
		);
	}

	function bridgeMethodCall(expression, methodName) {
		return (
			ts.isCallExpression(expression) &&
			expression.arguments.length === 0 &&
			ts.isPropertyAccessExpression(expression.expression) &&
			ts.isIdentifier(expression.expression.expression) &&
			expression.expression.expression.text === "bridge" &&
			expression.expression.name.text === methodName
		);
	}

	function matchingStatementIndexes(predicate) {
		const indexes = [];
		for (let index = 0; index < statements.length; index += 1) {
			if (predicate(statements[index])) {
				indexes.push(index);
			}
		}
		return indexes;
	}

	const bridgeIndexes = matchingStatementIndexes((statement) => {
		const declaration = exactConstDeclaration(statement, "bridge");
		return (
			declaration?.initializer !== undefined &&
			identifierCall(declaration.initializer, "createBridge", 0)
		);
	});
	const capabilityIndexes = matchingStatementIndexes((statement) => {
		const declaration = exactConstDeclaration(
			statement,
			"workspaceCapabilities",
		);
		return (
			declaration?.initializer !== undefined &&
			ts.isAwaitExpression(declaration.initializer) &&
			bridgeMethodCall(
				declaration.initializer.expression,
				"workspaceCapabilities",
			)
		);
	});
	const providerIndexes = matchingStatementIndexes((statement) => {
		const declaration = exactConstDeclaration(
			statement,
			"workspaceFileSystemProvider",
		);
		const initializer = declaration?.initializer;
		return (
			initializer !== undefined &&
			identifierCall(
				initializer,
				"createPlainWorkspaceFileSystemProvider",
				2,
			) &&
			ts.isIdentifier(initializer.arguments[0]) &&
			initializer.arguments[0].text === "bridge" &&
			ts.isIdentifier(initializer.arguments[1]) &&
			initializer.arguments[1].text === "workspaceCapabilities"
		);
	});
	const coordinatorIndexes = matchingStatementIndexes((statement) => {
		const declaration = exactConstDeclaration(
			statement,
			"workspaceDeleteCoordinator",
		);
		const initializer = declaration?.initializer;
		return (
			initializer !== undefined &&
			identifierCall(initializer, "registerWorkspaceDeleteCoordinator", 2) &&
			ts.isIdentifier(initializer.arguments[0]) &&
			initializer.arguments[0].text === "bridge" &&
			ts.isIdentifier(initializer.arguments[1]) &&
			initializer.arguments[1].text === "workspaceFileSystemProvider"
		);
	});
	const registrationIndexes = matchingStatementIndexes((statement) => {
		if (!ts.isExpressionStatement(statement)) {
			return false;
		}
		const expression = statement.expression;
		return (
			identifierCall(expression, "registerCustomProvider", 2) &&
			ts.isIdentifier(expression.arguments[0]) &&
			expression.arguments[0].text === "PLAIN_WORKSPACE_SCHEME" &&
			ts.isIdentifier(expression.arguments[1]) &&
			expression.arguments[1].text === "workspaceFileSystemProvider"
		);
	});
	const snapshotIndexes = matchingStatementIndexes((statement) => {
		const declaration = exactConstDeclaration(
			statement,
			"initialWorkspaceSnapshot",
		);
		return (
			declaration?.initializer !== undefined &&
			ts.isAwaitExpression(declaration.initializer) &&
			bridgeMethodCall(declaration.initializer.expression, "workspaceSnapshot")
		);
	});
	const initializeIndexes = matchingStatementIndexes((statement) => {
		return (
			ts.isExpressionStatement(statement) &&
			ts.isAwaitExpression(statement.expression) &&
			identifierCall(statement.expression.expression, "initialize", 3)
		);
	});

	const calls = {
		createBridge: 0,
		workspaceCapabilities: 0,
		providerFactory: 0,
		deleteCoordinatorRegistration: 0,
		registerCustomProvider: 0,
		workspaceSnapshot: 0,
		initialize: 0,
	};
	let capabilityMemberReferences = 0;
	let hasUnexpectedBridgeReference = false;
	let hasUnexpectedWorkspaceProviderReference = false;
	function isAllowedBridgeIdentifier(node) {
		const parent = node.parent;
		if (
			ts.isVariableDeclaration(parent) &&
			parent.name === node &&
			parent.initializer !== undefined &&
			identifierCall(parent.initializer, "createBridge", 0)
		) {
			return true;
		}
		if (
			ts.isPropertyAccessExpression(parent) &&
			parent.expression === node &&
			parent.name.text === "workspaceReconcileWatchRoots" &&
			ts.isCallExpression(parent.parent) &&
			parent.parent.expression === parent &&
			parent.parent.arguments.length === 1 &&
			ts.isIdentifier(parent.parent.arguments[0]) &&
			parent.parent.arguments[0].text === "rootIds" &&
			ts.isArrowFunction(parent.parent.parent) &&
			parent.parent.parent.body === parent.parent &&
			parent.parent.parent.parameters.length === 1 &&
			ts.isIdentifier(parent.parent.parent.parameters[0].name) &&
			parent.parent.parent.parameters[0].name.text === "rootIds" &&
			ts.isCallExpression(parent.parent.parent.parent) &&
			ts.isIdentifier(parent.parent.parent.parent.expression) &&
			parent.parent.parent.parent.expression.text ===
				"createWorkspaceTopologyCoordinator" &&
			parent.parent.parent.parent.arguments[5] === parent.parent.parent
		) {
			return true;
		}
		if (
			ts.isPropertyAccessExpression(parent) &&
			parent.expression === node &&
			[
				"workspaceCapabilities",
				"workspaceSnapshot",
				"onRuntimeReady",
				"runtimeInfo",
			].includes(parent.name.text) &&
			ts.isCallExpression(parent.parent) &&
			parent.parent.expression === parent
		) {
			return true;
		}
		return (
			ts.isCallExpression(parent) &&
			parent.arguments[0] === node &&
			ts.isIdentifier(parent.expression) &&
			(parent.expression.text === "createPlainWorkspaceFileSystemProvider" ||
				parent.expression.text === "registerWorkspaceDeleteCoordinator" ||
				parent.expression.text === "registerWorkspaceCommands" ||
				parent.expression.text === "configurePlainWorkingCopyBackupBridge" ||
				parent.expression.text === "configurePlainSearchBridge" ||
				parent.expression.text === "configurePlainTerminalBridge" ||
				parent.expression.text === "configurePlainScmBridge" ||
				parent.expression.text === "configurePlainGitHistoryBridge" ||
				parent.expression.text === "configurePlainGitGraphBridge" ||
				parent.expression.text === "configurePlainGitStashBridge" ||
				parent.expression.text === "configurePlainGitWorktreeBridge" ||
				parent.expression.text === "createPlainGitTextModelContentProvider" ||
				parent.expression.text === "createPlainGitBlameContribution" ||
				parent.expression.text === "createPlainGitCommitBlobContentProvider" ||
				parent.expression.text ===
					"createPlainGitCommitMultiDiffSourceResolver" ||
				parent.expression.text === "consumeImportedThemePackages" ||
				parent.expression.text === "registerPlainThemeCommands" ||
				parent.expression.text === "registerPlainThemePicker" ||
				parent.expression.text === "registerPlainFileIconThemePicker" ||
				parent.expression.text === "registerPlainProductIconThemePicker" ||
				parent.expression.text === "applyPersistedThemeSelection" ||
				parent.expression.text === "applyPersistedFileIconThemeSelection" ||
				parent.expression.text === "applyPersistedProductIconThemeSelection" ||
				parent.expression.text === "createAndConfigurePlainDebugRuntime")
		);
	}
	function isAllowedWorkspaceProviderIdentifier(node) {
		const parent = node.parent;
		if (
			ts.isVariableDeclaration(parent) &&
			parent.name === node &&
			parent.initializer !== undefined &&
			identifierCall(
				parent.initializer,
				"createPlainWorkspaceFileSystemProvider",
				2,
			)
		) {
			return true;
		}
		return (
			ts.isCallExpression(parent) &&
			parent.arguments[1] === node &&
			ts.isIdentifier(parent.expression) &&
			(parent.expression.text === "registerWorkspaceDeleteCoordinator" ||
				parent.expression.text === "registerCustomProvider")
		);
	}
	function visit(node) {
		if (ts.isCallExpression(node)) {
			if (ts.isIdentifier(node.expression)) {
				switch (node.expression.text) {
					case "createBridge":
						calls.createBridge += 1;
						break;
					case "createPlainWorkspaceFileSystemProvider":
						calls.providerFactory += 1;
						break;
					case "registerWorkspaceDeleteCoordinator":
						calls.deleteCoordinatorRegistration += 1;
						break;
					case "registerCustomProvider":
						calls.registerCustomProvider += 1;
						break;
					case "initialize":
						calls.initialize += 1;
						break;
				}
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "workspaceCapabilities"
			) {
				calls.workspaceCapabilities += 1;
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "workspaceSnapshot"
			) {
				calls.workspaceSnapshot += 1;
			}
		}
		if (
			(ts.isPropertyAccessExpression(node) &&
				node.name.text === "workspaceCapabilities") ||
			(ts.isElementAccessExpression(node) &&
				ts.isStringLiteral(node.argumentExpression) &&
				node.argumentExpression.text === "workspaceCapabilities") ||
			(ts.isBindingElement(node) &&
				node.propertyName !== undefined &&
				typeScriptStaticName(node.propertyName) === "workspaceCapabilities")
		) {
			capabilityMemberReferences += 1;
		}
		if (
			ts.isIdentifier(node) &&
			node.text === "bridge" &&
			!isAllowedBridgeIdentifier(node)
		) {
			hasUnexpectedBridgeReference = true;
		}
		if (
			ts.isIdentifier(node) &&
			node.text === "workspaceFileSystemProvider" &&
			!isAllowedWorkspaceProviderIdentifier(node)
		) {
			hasUnexpectedWorkspaceProviderReference = true;
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);

	if (calls.createBridge !== 1 || bridgeIndexes.length !== 1) {
		failures.push("app/main.ts must create exactly one bootstrap bridge");
	}
	if (
		calls.workspaceCapabilities !== 1 ||
		capabilityMemberReferences !== 1 ||
		capabilityIndexes.length !== 1
	) {
		failures.push(
			"app/main.ts must await bridge.workspaceCapabilities exactly once in bootstrap",
		);
	}
	if (hasUnexpectedBridgeReference) {
		failures.push(
			"app/main.ts must not alias or dynamically access the audited bootstrap bridge",
		);
	}
	if (hasUnexpectedWorkspaceProviderReference) {
		failures.push(
			"app/main.ts may use the audited workspace provider only for its declaration, delete coordinator and custom-provider registration",
		);
	}
	if (calls.providerFactory !== 1 || providerIndexes.length !== 1) {
		failures.push(
			"app/main.ts must pass the sole capability snapshot directly to the Plain provider factory",
		);
	}
	if (
		calls.deleteCoordinatorRegistration !== 1 ||
		coordinatorIndexes.length !== 1
	) {
		failures.push(
			"app/main.ts must register exactly one audited workspace delete coordinator",
		);
	}
	if (calls.registerCustomProvider < 1 || calls.registerCustomProvider > 2) {
		failures.push(
			"app/main.ts must register one legacy or two audited custom workspace providers",
		);
	}
	if (registrationIndexes.length !== 1) {
		failures.push(
			"app/main.ts must unconditionally register only the audited plain-workspace provider",
		);
	}
	if (
		calls.workspaceSnapshot < 1 ||
		snapshotIndexes.length !== 1 ||
		calls.initialize !== 1 ||
		initializeIndexes.length !== 1
	) {
		failures.push(
			"app/main.ts must keep one direct workspace snapshot and initialize sequence",
		);
	}
	const orderedIndexes = [
		bridgeIndexes[0],
		capabilityIndexes[0],
		providerIndexes[0],
		coordinatorIndexes[0],
		registrationIndexes[0],
		snapshotIndexes[0],
		initializeIndexes[0],
	];
	if (
		orderedIndexes.some((index) => index === undefined) ||
		orderedIndexes.some(
			(index, position) =>
				position > 0 && index <= orderedIndexes[position - 1],
		) ||
		(bridgeIndexes[0] !== undefined &&
			capabilityIndexes[0] !== bridgeIndexes[0] + 1) ||
		(capabilityIndexes[0] !== undefined &&
			providerIndexes[0] !== capabilityIndexes[0] + 1) ||
		(providerIndexes[0] !== undefined &&
			coordinatorIndexes[0] !== providerIndexes[0] + 1)
	) {
		failures.push(
			"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
		);
	}

	let coordinatorReferences = 0;
	let coordinatorDisposeCalls = 0;
	let pagehideDisposeStatements = 0;
	function countCoordinatorUsage(node) {
		if (ts.isIdentifier(node) && node.text === "workspaceDeleteCoordinator") {
			coordinatorReferences += 1;
		}
		if (
			ts.isCallExpression(node) &&
			node.arguments.length === 0 &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === "workspaceDeleteCoordinator" &&
			node.expression.name.text === "dispose"
		) {
			coordinatorDisposeCalls += 1;
		}
		ts.forEachChild(node, countCoordinatorUsage);
	}
	countCoordinatorUsage(bootstrap.body);
	for (const statement of statements) {
		if (!ts.isExpressionStatement(statement)) {
			continue;
		}
		const call = statement.expression;
		if (
			!ts.isCallExpression(call) ||
			call.arguments.length !== 3 ||
			!ts.isPropertyAccessExpression(call.expression) ||
			!ts.isIdentifier(call.expression.expression) ||
			call.expression.expression.text !== "window" ||
			call.expression.name.text !== "addEventListener" ||
			!ts.isStringLiteral(call.arguments[0]) ||
			call.arguments[0].text !== "pagehide"
		) {
			continue;
		}
		const listener = call.arguments[1];
		if (
			!(ts.isArrowFunction(listener) || ts.isFunctionExpression(listener)) ||
			listener.parameters.length !== 0 ||
			!ts.isBlock(listener.body)
		) {
			continue;
		}
		pagehideDisposeStatements += listener.body.statements.filter(
			(candidate) =>
				ts.isExpressionStatement(candidate) &&
				ts.isCallExpression(candidate.expression) &&
				candidate.expression.arguments.length === 0 &&
				ts.isPropertyAccessExpression(candidate.expression.expression) &&
				ts.isIdentifier(candidate.expression.expression.expression) &&
				candidate.expression.expression.expression.text ===
					"workspaceDeleteCoordinator" &&
				candidate.expression.expression.name.text === "dispose",
		).length;
	}
	if (
		coordinatorReferences !== 2 ||
		coordinatorDisposeCalls !== 1 ||
		pagehideDisposeStatements !== 1
	) {
		failures.push(
			"app/main.ts must dispose the sole workspace delete coordinator exactly once on pagehide",
		);
	}
	function containsBootstrapTerminator(node, isRoot = true) {
		if (
			!isRoot &&
			(ts.isFunctionDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isArrowFunction(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isGetAccessorDeclaration(node) ||
				ts.isSetAccessorDeclaration(node) ||
				ts.isConstructorDeclaration(node))
		) {
			return false;
		}
		if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
			return true;
		}
		let found = false;
		ts.forEachChild(node, (child) => {
			if (!found && containsBootstrapTerminator(child, false)) {
				found = true;
			}
		});
		return found;
	}
	const bridgeIndex = bridgeIndexes[0];
	const initializeIndex = initializeIndexes[0];
	if (
		bridgeIndex !== undefined &&
		initializeIndex !== undefined &&
		statements
			.slice(bridgeIndex + 1, initializeIndex)
			.some((statement) => containsBootstrapTerminator(statement))
	) {
		failures.push(
			"bootstrap must not explicitly terminate between bridge creation and capability-bound initialization",
		);
	}
	const initializeStatement = statements[initializeIndexes[0]];
	const initializeCall =
		initializeStatement !== undefined &&
		ts.isExpressionStatement(initializeStatement) &&
		ts.isAwaitExpression(initializeStatement.expression) &&
		ts.isCallExpression(initializeStatement.expression.expression)
			? initializeStatement.expression.expression
			: undefined;
	const initializeOptions = initializeCall?.arguments[2];
	const trustProperties =
		initializeOptions !== undefined &&
		ts.isObjectLiteralExpression(initializeOptions)
			? initializeOptions.properties.filter(
					(property) =>
						ts.isPropertyAssignment(property) &&
						typeScriptStaticName(property.name) === "enableWorkspaceTrust" &&
						property.initializer.kind === ts.SyntaxKind.FalseKeyword,
				)
			: [];
	if (trustProperties.length !== 1) {
		failures.push(
			"Plain must keep VS Code workspace trust disabled in favor of Rust process trust",
		);
	}

	return failures;
}

export function validateTauriConfiguration(config) {
	const failures = [];
	const app = config?.app;
	const security = app?.security;

	if (!sameObject(config?.build, EXPECTED_TAURI_BUILD)) {
		failures.push("Tauri build must preserve the fixed local Vite entrypoint");
	}

	if (app?.withGlobalTauri !== false) {
		failures.push("withGlobalTauri must remain false");
	}

	if (!Array.isArray(app?.windows) || app.windows.length !== 1) {
		failures.push("Tauri must define exactly one application window");
	} else {
		const [window] = app.windows;
		if (window?.label !== "main") {
			failures.push("the sole Tauri window must be labelled main");
		}
		if (isRecord(window) && Object.hasOwn(window, "url")) {
			failures.push("the main window must use the bundled frontend, not a URL");
		}
		if (isRecord(window) && Object.hasOwn(window, "incognito")) {
			failures.push(
				"the production main window must use its persistent WebView data store",
			);
		}
		if (isRecord(window) && Object.hasOwn(window, "dataStoreIdentifier")) {
			failures.push(
				"the production main window must not migrate to a custom WebView data store",
			);
		}
	}

	if (!sameArray(security?.capabilities, ["main-capability"])) {
		failures.push("Tauri must enable only main-capability");
	}
	if (
		!sameObject(security?.assetProtocol, {
			enable: false,
			scope: [],
		})
	) {
		failures.push("Tauri asset protocol must remain exactly disabled");
	}
	if (!sameObject(security?.csp, EXPECTED_PRODUCTION_CSP)) {
		failures.push("Tauri production CSP differs from the minimum contract");
	}
	if (!sameObject(security?.devCsp, EXPECTED_DEVELOPMENT_CSP)) {
		failures.push("Tauri development CSP differs from the minimum contract");
	}

	if (isRecord(security)) {
		const securityKeys = Object.keys(security).sort();
		const expectedKeys = ["assetProtocol", "capabilities", "csp", "devCsp"];
		if (!sameArray(securityKeys, expectedKeys)) {
			failures.push(
				"Tauri security contains fields outside the minimum contract",
			);
		}
	}

	return failures;
}

export function validateFrontendEntrypointScripts(scripts) {
	if (!isRecord(scripts)) {
		return [
			"package scripts must preserve the audited frontend entrypoint chain",
		];
	}
	const entrypointNames = Object.keys(EXPECTED_FRONTEND_ENTRYPOINT_SCRIPTS);
	return Object.entries(EXPECTED_FRONTEND_ENTRYPOINT_SCRIPTS).every(
		([name, command]) => scripts[name] === command,
	) &&
		entrypointNames.every(
			(name) =>
				scripts[`pre${name}`] === undefined &&
				scripts[`post${name}`] === undefined,
		)
		? []
		: ["package scripts must preserve the audited frontend entrypoint chain"];
}

export function validateTauriConfigurationFiles(fileNames) {
	const configurationFiles = fileNames
		.filter((fileName) => TAURI_CONFIG_FILE_PATTERN.test(fileName))
		.sort();
	return sameArray(configurationFiles, EXPECTED_TAURI_CONFIG_FILES)
		? []
		: [
				"src-tauri must keep only the audited base and E2E Tauri configuration files",
			];
}

export function validateTauriE2EConfiguration(
	productionConfig,
	e2eConfig,
	launchScript,
	buildScript,
) {
	const failures = [];
	if (launchScript !== EXPECTED_TAURI_E2E_SCRIPT) {
		failures.push(
			"tauri:dev:e2e must launch only the audited Tauri E2E configuration",
		);
	}
	if (buildScript !== EXPECTED_TAURI_E2E_BUILD_SCRIPT) {
		failures.push(
			"tauri:build:e2e must build only the audited isolated debug app bundle",
		);
	}
	if (
		!isRecord(e2eConfig) ||
		!sameArray(Object.keys(e2eConfig).sort(), ["$schema", "app"])
	) {
		failures.push("the Tauri E2E overlay must contain only $schema and app");
		return failures;
	}
	if (e2eConfig.$schema !== productionConfig?.$schema) {
		failures.push("the Tauri E2E overlay must use the production schema");
	}
	if (
		!isRecord(e2eConfig.app) ||
		!sameArray(Object.keys(e2eConfig.app).sort(), ["windows"])
	) {
		failures.push("the Tauri E2E app overlay must replace only windows");
		return failures;
	}
	const productionWindows = productionConfig?.app?.windows;
	const e2eWindows = e2eConfig.app.windows;
	if (
		!Array.isArray(productionWindows) ||
		productionWindows.length !== 1 ||
		!isRecord(productionWindows[0]) ||
		!Array.isArray(e2eWindows) ||
		e2eWindows.length !== 1 ||
		!isRecord(e2eWindows[0])
	) {
		failures.push(
			"production and Tauri E2E configurations must each define one window",
		);
		return failures;
	}
	const expectedWindow = {
		...productionWindows[0],
		incognito: true,
	};
	if (!sameObject(e2eWindows[0], expectedWindow)) {
		failures.push(
			"the Tauri E2E window must equal the production window plus incognito true",
		);
	}

	return failures;
}

export function validateCapabilityFiles(entries) {
	return sameArray(entries, [{ name: "main.json", kind: "file" }])
		? []
		: ["src-tauri/capabilities must contain only main.json"];
}

export function validateMainCapability(capability) {
	const failures = [];
	if (!isRecord(capability)) {
		return ["main capability must be an object"];
	}

	if (!sameArray(Object.keys(capability).sort(), EXPECTED_CAPABILITY_KEYS)) {
		failures.push(
			"main capability contains fields outside the minimum contract",
		);
	}
	if (capability.identifier !== "main-capability") {
		failures.push("main capability identifier must remain main-capability");
	}
	if (!sameArray(capability.windows, ["main"])) {
		failures.push("main capability must target only the main window");
	}
	if (
		!sameArray(capability.permissions, [
			"core:event:allow-listen",
			"core:event:allow-unlisten",
		])
	) {
		failures.push(
			"main capability permissions differ from the minimum contract",
		);
	}

	return failures;
}

const WORKSPACE_RUST_SOURCE_PATTERN =
	/^src-tauri\/src\/(?:path_policy\.rs|workspace\/.*\.rs|search\/.*\.rs)$/;
const RUST_PRODUCTION_SOURCE_PATTERN = /^src-tauri\/src\/.*\.rs$/;
const WORKSPACE_TEST_SOURCE_PATTERN = /(?:^|\/)tests\.rs$/;
const WORKSPACE_VERSIONED_WRITER_PATH =
	"src-tauri/src/workspace/versioned_writer.rs";
const BACKUP_STORE_PATH = "src-tauri/src/backup/store.rs";
const RUSTIX_TARGET = 'cfg(any(target_os = "linux", target_os = "macos"))';
const SHA2_VERSION = "0.10.9";
const SHA2_REQUIREMENT = `=${SHA2_VERSION}`;
const SHA2_RESOLVED_FEATURES = Object.freeze(["default", "std"]);
const ZIP_VERSION = "8.6.0";
const ZIP_REQUIREMENT = `=${ZIP_VERSION}`;
const ZIP_FEATURES = Object.freeze(["deflate-flate2-zlib-rs"]);
const JSONC_PARSER_VERSION = "0.33.0";
const JSONC_PARSER_REQUIREMENT = `=${JSONC_PARSER_VERSION}`;
const JSONC_PARSER_FEATURES = Object.freeze([]);
const FOLLOW_SYMLINKS_YES_PATTERN =
	/\bFollowSymlinks\s*::\s*(?:Yes\b|\{[^}]*\bYes\b)/;
const FORBIDDEN_DIRECTORY_DEPENDENCIES = Object.freeze([
	"copy_dir",
	"dircpy",
	"fs_extra",
	"globwalk",
	"jwalk",
	"walkdir",
]);
const FORBIDDEN_DELETE_BYPASS_DEPENDENCIES = Object.freeze([
	"async-process",
	"duct",
	"subprocess",
	"trash",
	"xshell",
]);
const WORKSPACE_COPY_LIMITS = Object.freeze([
	["MAX_COPY_FILE_BYTES", 8 * 1_024 * 1_024, "usize"],
	["MAX_COPY_SYMLINK_BYTES", 4 * 1_024, "usize"],
	["MAX_COPY_TREE_ENTRIES", 10_000, "usize"],
	["MAX_COPY_ENTRY_NAME_BYTES", 1_024, "usize"],
	["MAX_COPY_TREE_NAME_BYTES", 2 * 1_024 * 1_024, "usize"],
	["MAX_COPY_TREE_DEPTH", 256, "usize"],
	["MAX_COPY_TREE_SYMLINK_BYTES", 2 * 1_024 * 1_024, "u64"],
	["MAX_COPY_TREE_BYTES", 256 * 1_024 * 1_024, "u64"],
]);
const WORKSPACE_DELETE_LIMITS = Object.freeze([
	["MAX_DELETE_BATCH_ENTRIES", 64, "usize"],
	["MAX_DELETE_DESCENDANTS", 10_000, "usize"],
	["MAX_DELETE_TREE_DEPTH", 256, "usize"],
	["MAX_DELETE_ENTRY_NAME_BYTES", 1_024, "usize"],
	["MAX_DELETE_TREE_NAME_BYTES", 2 * 1_024 * 1_024, "usize"],
	["MAX_DELETE_SYMLINK_BYTES", 4 * 1_024, "usize"],
	["MAX_DELETE_TREE_SYMLINK_BYTES", 2 * 1_024 * 1_024, "usize"],
]);
const SEARCH_FILE_LIMITS = Object.freeze([
	["MAX_SEARCH_TREE_ENTRIES", 50_000, "usize"],
	["MAX_SEARCH_TREE_DEPTH", 256, "usize"],
]);

function escapeRegularExpression(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cargoDependencyDeclaration(dependency, version) {
	const escapedDependency = escapeRegularExpression(dependency);
	const escapedVersion = escapeRegularExpression(version);
	return new RegExp(
		`^${escapedDependency}\\s*=\\s*(?:"${escapedVersion}"|\\{[^}\\n]*\\bversion\\s*=\\s*"${escapedVersion}"[^}\\n]*\\})\\s*$`,
		"m",
	);
}

function stripRustCommentsAndLiterals(source) {
	const output = source.split("");
	const mask = (start, end) => {
		for (let index = start; index < end; index += 1) {
			if (output[index] !== "\n" && output[index] !== "\r") {
				output[index] = " ";
			}
		}
	};

	let index = 0;
	while (index < source.length) {
		if (source.startsWith("//", index)) {
			const end = source.indexOf("\n", index + 2);
			const boundary = end < 0 ? source.length : end;
			mask(index, boundary);
			index = boundary;
			continue;
		}

		if (source.startsWith("/*", index)) {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < source.length && depth > 0) {
				if (source.startsWith("/*", cursor)) {
					depth += 1;
					cursor += 2;
				} else if (source.startsWith("*/", cursor)) {
					depth -= 1;
					cursor += 2;
				} else {
					cursor += 1;
				}
			}
			mask(index, cursor);
			index = cursor;
			continue;
		}

		const rawString = /^(?:b|c)?r(#{0,255})"/.exec(source.slice(index));
		if (rawString) {
			const terminator = `"${rawString[1]}`;
			const contentStart = index + rawString[0].length;
			const close = source.indexOf(terminator, contentStart);
			const boundary = close < 0 ? source.length : close + terminator.length;
			mask(index, boundary);
			index = boundary;
			continue;
		}

		const string = /^(?:b|c)?"/.exec(source.slice(index));
		if (string) {
			let cursor = index + string[0].length;
			while (cursor < source.length) {
				if (source[cursor] === "\\") {
					cursor += 2;
				} else if (source[cursor] === '"') {
					cursor += 1;
					break;
				} else {
					cursor += 1;
				}
			}
			mask(index, cursor);
			index = cursor;
			continue;
		}

		const character = /^(?:b)?'(?:\\.|[^\\'\n])'/.exec(source.slice(index));
		if (character) {
			mask(index, index + character[0].length);
			index += character[0].length;
			continue;
		}

		index += 1;
	}

	return output.join("");
}

function extractCallArguments(source, functionName) {
	const calls = [];
	const pattern = new RegExp(
		`\\b${escapeRegularExpression(functionName)}\\s*\\(`,
		"g",
	);
	let match;
	while ((match = pattern.exec(source)) !== null) {
		const openParenthesis = match.index + match[0].lastIndexOf("(");
		let depth = 1;
		let cursor = openParenthesis + 1;
		while (cursor < source.length && depth > 0) {
			if (source[cursor] === "(") {
				depth += 1;
			} else if (source[cursor] === ")") {
				depth -= 1;
			}
			cursor += 1;
		}
		calls.push({
			index: match.index,
			end: cursor,
			arguments: source.slice(
				openParenthesis + 1,
				depth === 0 ? cursor - 1 : source.length,
			),
			closed: depth === 0,
		});
		pattern.lastIndex = cursor;
	}
	return calls;
}

function auditExclusiveRenameBindings(source) {
	const references = [...source.matchAll(/\brenameat_with\b/g)];
	const calls = extractCallArguments(source, "renameat_with").filter(
		(call) => !/\bfn\s*$/.test(source.slice(0, call.index)),
	);
	let directBindingCount = 0;
	let hasForbiddenBinding = false;

	for (const match of source.matchAll(
		/\b((?:pub(?:\s*\([^)]*\))?\s+)?)use\s+([^;]+);/g,
	)) {
		const visibility = match[1].trim();
		const clause = match[2];
		const mentionsRustix = /(?:^|[^A-Za-z0-9_])(?:::)?rustix\b/.test(clause);
		const mentionsRename = /\brenameat_with\b/.test(clause);
		if (
			(mentionsRustix && /\bas\s+[A-Za-z_]\w*/.test(clause)) ||
			(mentionsRename && visibility.startsWith("pub")) ||
			/^(?:::)?rustix\s*(?:::\s*(?:fs|io)\s*)?$/.test(clause.trim()) ||
			/^(?:::)?rustix\s*::\s*\{/.test(clause.trim()) ||
			(mentionsRustix && /(?:\*|\bself\b)/.test(clause)) ||
			(mentionsRename && /\bas\s+[A-Za-z_]\w*/.test(clause))
		) {
			hasForbiddenBinding = true;
		}

		if (
			visibility.length === 0 &&
			/^(?:::)?rustix\s*::\s*fs\s*::/.test(clause.trim()) &&
			mentionsRename &&
			!/(?:\bas\b|\*|\bself\b)/.test(clause)
		) {
			directBindingCount += [...clause.matchAll(/\brenameat_with\b/g)].length;
		}
	}

	if (
		/\bextern\s+crate\s+rustix\b/.test(source) ||
		/\b(?:let|const|static)\b[^;=]*=\s*(?:(?:::)?rustix\s*::\s*fs\s*::\s*)?renameat_with\b(?!\s*\()/.test(
			source,
		) ||
		/\b(?:fn|macro_rules\s*!)\s+renameat_with\b/.test(source)
	) {
		hasForbiddenBinding = true;
	}

	if (references.length !== calls.length + directBindingCount) {
		hasForbiddenBinding = true;
	}

	return { calls, hasForbiddenBinding, referenceCount: references.length };
}

function auditDirectRustixFsFunction(source, functionName) {
	const identifier = new RegExp(
		`\\b${escapeRegularExpression(functionName)}\\b`,
		"g",
	);
	const references = [...source.matchAll(identifier)];
	const calls = extractCallArguments(source, functionName).filter(
		(call) => !/\bfn\s*$/.test(source.slice(0, call.index)),
	);
	let directBindingCount = 0;
	let hasForbiddenBinding = false;
	for (const match of source.matchAll(
		/\b((?:pub(?:\s*\([^)]*\))?\s+)?)use\s+([^;]+);/g,
	)) {
		const visibility = match[1].trim();
		const clause = match[2];
		const mentionsFunction = new RegExp(
			`\\b${escapeRegularExpression(functionName)}\\b`,
		).test(clause);
		if (!mentionsFunction) {
			continue;
		}
		const isDirectRustixBinding =
			visibility.length === 0 &&
			/^(?:::)?rustix\s*::\s*fs\s*::/.test(clause.trim()) &&
			!/(?:\bas\b|\*|\bself\b)/.test(clause);
		if (!isDirectRustixBinding) {
			hasForbiddenBinding = true;
		} else {
			directBindingCount += [...clause.matchAll(identifier)].length;
		}
	}
	if (directBindingCount > 1) {
		hasForbiddenBinding = true;
	}
	for (const call of calls) {
		const prefix = source.slice(0, call.index);
		const isQualifiedRustixCall = /(?:::)?rustix\s*::\s*fs\s*::\s*$/.test(
			prefix,
		);
		const isUnqualifiedCall = !/::\s*$/.test(prefix);
		if (
			!isQualifiedRustixCall &&
			!(isUnqualifiedCall && directBindingCount === 1)
		) {
			hasForbiddenBinding = true;
		}
	}
	if (references.length !== calls.length + directBindingCount) {
		hasForbiddenBinding = true;
	}
	return { calls, hasForbiddenBinding, referenceCount: references.length };
}

function evaluateSmallRustIntegerExpression(expression) {
	const normalized = expression.replaceAll("_", "").replaceAll(/\s+/g, "");
	const tokens = normalized.match(
		/(?:0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|[0-9]+)(?:u(?:8|16|32|64|128)|usize)?|<<|[+*()]/g,
	);
	if (tokens === null || tokens.join("") !== normalized) {
		return undefined;
	}

	let cursor = 0;
	const checked = (value) =>
		Number.isSafeInteger(value) && value >= 0 ? value : undefined;
	const parsePrimary = () => {
		const token = tokens[cursor];
		if (token === "(") {
			cursor += 1;
			const value = parseShift();
			if (value === undefined || tokens[cursor] !== ")") {
				return undefined;
			}
			cursor += 1;
			return value;
		}
		if (
			token === undefined ||
			!/^(?:0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|[0-9]+)(?:u(?:8|16|32|64|128)|usize)?$/.test(
				token,
			)
		) {
			return undefined;
		}
		cursor += 1;
		return checked(Number(token.replace(/(?:u(?:8|16|32|64|128)|usize)$/, "")));
	};
	const parseProduct = () => {
		let value = parsePrimary();
		while (value !== undefined && tokens[cursor] === "*") {
			cursor += 1;
			const right = parsePrimary();
			value = right === undefined ? undefined : checked(value * right);
		}
		return value;
	};
	const parseSum = () => {
		let value = parseProduct();
		while (value !== undefined && tokens[cursor] === "+") {
			cursor += 1;
			const right = parseProduct();
			value = right === undefined ? undefined : checked(value + right);
		}
		return value;
	};
	function parseShift() {
		let value = parseSum();
		while (value !== undefined && tokens[cursor] === "<<") {
			cursor += 1;
			const right = parseSum();
			value =
				right === undefined || right > 52
					? undefined
					: checked(value * 2 ** right);
		}
		return value;
	}

	const value = parseShift();
	return cursor === tokens.length ? value : undefined;
}

function workspaceCopyLimitFailure(name, value, integerType) {
	return `workspace copy limits must define exactly one ${name}: ${integerType} = ${value}`;
}

function findWorkspaceCopyLimitDeclarations(
	executableSource,
	name,
	integerType,
) {
	const pattern = new RegExp(
		`^\\s*(?:pub(?:\\s*\\([^)]*\\))?\\s+)?const\\s+${escapeRegularExpression(name)}\\s*:\\s*${escapeRegularExpression(integerType)}\\s*=\\s*([^;]+);`,
		"gm",
	);
	return [...executableSource.matchAll(pattern)].map((match) => match[1]);
}

function forbiddenDirectoryCrates(executableSource) {
	const crates = new Set();
	for (const dependency of FORBIDDEN_DIRECTORY_DEPENDENCIES) {
		const escapedDependency = escapeRegularExpression(dependency);
		const directUse = new RegExp(`^(?:::)?${escapedDependency}\\b`);
		const rootGroupUse = new RegExp(
			`(?:^|,)\\s*(?:::)?${escapedDependency}\\b`,
		);
		let hasReference = new RegExp(
			`\\bextern\\s+crate\\s+${escapedDependency}\\b`,
		).test(executableSource);
		for (const match of executableSource.matchAll(
			/\b(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g,
		)) {
			const clause = match[1].trim();
			if (
				directUse.test(clause) ||
				(clause.startsWith("{") && rootGroupUse.test(clause.slice(1)))
			) {
				hasReference = true;
			}
		}
		const qualified = new RegExp(`\\b${escapedDependency}\\s*::`, "g");
		for (const match of executableSource.matchAll(qualified)) {
			const prefix = executableSource.slice(0, match.index);
			if (!/\b(?:crate|self|super|[A-Za-z_]\w*)\s*::\s*$/.test(prefix)) {
				hasReference = true;
			}
		}
		if (hasReference) {
			crates.add(dependency);
		}
	}
	return crates;
}

function usesIgnoreWalker(executableSource, crateNames) {
	for (const crateName of new Set(crateNames)) {
		const escapedCrate = escapeRegularExpression(crateName);
		const directWalker = new RegExp(
			`\\b${escapedCrate}\\s*::\\s*(?:\\{[^}]*\\b(?:WalkBuilder|Walk)\\b|(?:WalkBuilder|Walk)\\b)`,
			"g",
		);
		for (const match of executableSource.matchAll(directWalker)) {
			const prefix = executableSource.slice(0, match.index);
			if (!/\b(?:crate|self|super|[A-Za-z_]\w*)\s*::\s*$/.test(prefix)) {
				return true;
			}
		}

		const aliases = [];
		const externPattern = new RegExp(
			`\\b(pub(?:\\s*\\([^)]*\\))?\\s+)?extern\\s+crate\\s+${escapedCrate}(?:\\s+as\\s+([A-Za-z_]\\w*))?\\s*;`,
			"g",
		);
		for (const match of executableSource.matchAll(externPattern)) {
			if (match[1] !== undefined) {
				return true;
			}
			aliases.push(match[2] ?? crateName);
		}

		for (const match of executableSource.matchAll(
			/\b(pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g,
		)) {
			const clause = match[2].trim();
			const foundAliases = [];
			const directAlias = new RegExp(
				`^(?:::)?${escapedCrate}\\s+as\\s+([A-Za-z_]\\w*)\\b`,
			).exec(clause);
			if (directAlias !== null) {
				foundAliases.push(directAlias[1]);
			}
			const selfAlias = new RegExp(
				`^(?:::)?${escapedCrate}\\s*::\\s*\\{[^}]*\\bself\\s+as\\s+([A-Za-z_]\\w*)\\b`,
			).exec(clause);
			if (selfAlias !== null) {
				foundAliases.push(selfAlias[1]);
			}
			if (clause.startsWith("{")) {
				const groupedAlias = new RegExp(
					`(?:^|,)\\s*(?:::)?${escapedCrate}\\s+as\\s+([A-Za-z_]\\w*)\\b`,
					"g",
				);
				for (const alias of clause.slice(1).matchAll(groupedAlias)) {
					foundAliases.push(alias[1]);
				}
				const groupedSelfAlias = new RegExp(
					`(?:^|,)\\s*(?:::)?${escapedCrate}\\s*::\\s*\\{[^}]*\\bself\\s+as\\s+([A-Za-z_]\\w*)\\b`,
					"g",
				);
				for (const alias of clause.slice(1).matchAll(groupedSelfAlias)) {
					foundAliases.push(alias[1]);
				}
			}
			if (foundAliases.length > 0 && match[1] !== undefined) {
				return true;
			}
			aliases.push(...foundAliases);
		}

		for (const alias of aliases) {
			if (
				new RegExp(
					`\\b${escapeRegularExpression(alias)}\\s*::\\s*(?:WalkBuilder|Walk)\\b`,
				).test(executableSource)
			) {
				return true;
			}
		}
	}
	return false;
}

function extractRustFunctions(source, functionName) {
	const functions = [];
	const pattern = new RegExp(
		`\\bfn\\s+${escapeRegularExpression(functionName)}\\b`,
		"g",
	);
	for (const match of source.matchAll(pattern)) {
		const parameterOpen = source.indexOf("(", match.index + match[0].length);
		const firstBoundary = source.slice(match.index).search(/[;{]/);
		if (
			parameterOpen < 0 ||
			(firstBoundary >= 0 && match.index + firstBoundary < parameterOpen)
		) {
			continue;
		}
		const parameterClose = findMatchingDelimiter(
			source,
			parameterOpen,
			"(",
			")",
		);
		if (parameterClose === undefined) {
			continue;
		}
		const bodyOpen = source.indexOf("{", parameterClose + 1);
		const declarationEnd = source.indexOf(";", parameterClose + 1);
		if (bodyOpen < 0 || (declarationEnd >= 0 && declarationEnd < bodyOpen)) {
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		if (bodyClose === undefined) {
			continue;
		}
		functions.push({
			name: functionName,
			start: match.index,
			bodyStart: bodyOpen + 1,
			bodyEnd: bodyClose,
			parameters: source.slice(parameterOpen + 1, parameterClose),
			returnType: source.slice(parameterClose + 1, bodyOpen),
			body: source.slice(bodyOpen + 1, bodyClose),
		});
	}
	return functions;
}

function extractAllRustFunctions(source) {
	const names = new Set(
		[...source.matchAll(/\bfn\s+([A-Za-z_]\w*)\b/g)].map((match) => match[1]),
	);
	return [...names].flatMap((name) => extractRustFunctions(source, name));
}

function splitTopLevelComma(source) {
	const parts = [];
	let start = 0;
	const depths = { "(": 0, "[": 0, "{": 0 };
	const matchingOpen = { ")": "(", "]": "[", "}": "{" };
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (Object.hasOwn(depths, character)) {
			depths[character] += 1;
		} else if (Object.hasOwn(matchingOpen, character)) {
			depths[matchingOpen[character]] -= 1;
		} else if (
			character === "," &&
			Object.values(depths).every((depth) => depth === 0)
		) {
			parts.push(source.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(source.slice(start));
	return parts.filter((part) => part.trim().length > 0);
}

function directoryCopyLimitsAreExact(source) {
	const declarations = [
		...source.matchAll(
			/\bconst\s+DIRECTORY_COPY_LIMITS\s*:\s*DirectoryCopyLimits\s*=\s*DirectoryCopyLimits\s*\{/g,
		),
	];
	if (declarations.length !== 1) {
		return false;
	}
	const open = declarations[0].index + declarations[0][0].lastIndexOf("{");
	const close = findMatchingDelimiter(source, open, "{", "}");
	if (close === undefined) {
		return false;
	}
	const fields = new Map();
	for (const part of splitTopLevelComma(source.slice(open + 1, close))) {
		const field = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]+?)\s*$/.exec(part);
		if (field === null || fields.has(field[1])) {
			return false;
		}
		fields.set(field[1], field[2].replaceAll(/\s+/g, ""));
	}
	const expected = new Map([
		["descendants", "MAX_COPY_TREE_ENTRIES"],
		["name_bytes", "MAX_COPY_ENTRY_NAME_BYTES"],
		["name_aggregate_bytes", "MAX_COPY_TREE_NAME_BYTES"],
		["depth", "MAX_COPY_TREE_DEPTH"],
		["link_bytes", "MAX_COPY_SYMLINK_BYTES"],
		["link_aggregate_bytes", "MAX_COPY_TREE_SYMLINK_BYTES"],
		["file_bytes", "MAX_COPY_FILE_BYTESasu64"],
		["file_aggregate_bytes", "MAX_COPY_TREE_BYTES"],
	]);
	return (
		fields.size === expected.size &&
		[...expected].every(
			([field, expression]) => fields.get(field) === expression,
		)
	);
}

function productionDirectoryCopyUsesAuditedLimits(source) {
	const copyFunctions = extractRustFunctions(source, "copy_directory");
	const receiptFunctions = extractRustFunctions(
		source,
		"copy_directory_with_receipt",
	);
	if (copyFunctions.length !== 1 || receiptFunctions.length !== 1) {
		return false;
	}
	const copyCalls = extractCallArguments(
		copyFunctions[0].body,
		"copy_directory_with_receipt",
	);
	if (copyCalls.length !== 1 || !copyCalls[0].closed) {
		return false;
	}
	const copyArguments = splitTopLevelComma(copyCalls[0].arguments).map(
		(argument) => argument.replaceAll(/\s+/g, ""),
	);
	if (
		!sameArray(copyArguments, [
			"source_lease",
			"source_path",
			"target_lease",
			"target_path",
		])
	) {
		return false;
	}
	const calls = extractCallArguments(
		receiptFunctions[0].body,
		"copy_directory_with_limits_and_hooks_receipt",
	);
	if (calls.length !== 1 || !calls[0].closed) {
		return false;
	}
	const argumentsList = splitTopLevelComma(calls[0].arguments);
	return (
		argumentsList.length === 6 &&
		argumentsList[4].replaceAll(/\s+/g, "") === "DIRECTORY_COPY_LIMITS"
	);
}

function directoryTraversalHelpersUseNofollow(source) {
	for (const functionName of [
		"open_source_root",
		"scan_directory",
		"open_source_parent",
		"open_receipted_directory",
	]) {
		const functions = extractRustFunctions(source, functionName);
		if (functions.length !== 1) {
			return false;
		}
		const calls = extractCallArguments(functions[0].body, "open_dir_nofollow");
		if (
			calls.length === 0 ||
			calls.some(
				(call) => !/\.\s*$/.test(functions[0].body.slice(0, call.index)),
			)
		) {
			return false;
		}
	}
	return true;
}

function directoryOpenOperationsAreNarrow(source) {
	if (
		/\bopen_dir\s*\(/.test(source) ||
		/(?:\.|::)\s*open\s*\(/.test(source) ||
		/\b(?:from_std_file|from_raw_fd|from_raw_handle|from_raw_socket)\s*\(/.test(
			source,
		) ||
		/\bfn\s+open_dir_nofollow\b/.test(source)
	) {
		return false;
	}

	const allOpenWithCalls = extractCallArguments(source, "open_with").filter(
		(call) => !/\bfn\s*$/.test(source.slice(0, call.index)),
	);
	if (allOpenWithCalls.length === 0) {
		return true;
	}
	const buildFunctions = extractRustFunctions(source, "build");
	if (allOpenWithCalls.length !== 1 || buildFunctions.length !== 1) {
		return false;
	}
	const build = buildFunctions[0].body;
	const buildCalls = extractCallArguments(build, "open_with");
	if (buildCalls.length !== 1) {
		return false;
	}
	const [call] = buildCalls;
	return (
		/\bstage_parent\s*\.\s*$/.test(build.slice(0, call.index)) &&
		call.arguments.replaceAll(/\s+/g, "") === "name,&options" &&
		/\boptions\s*\.\s*read\s*\(\s*true\s*\)\s*\.\s*write\s*\(\s*true\s*\)\s*\.\s*create_new\s*\(\s*true\s*\)/.test(
			build,
		) &&
		/\boptions\s*\.\s*mode\s*\(\s*0o600\s*\)/.test(build)
	);
}

function publishNoReplaceIsExact(source) {
	const functions = extractRustFunctions(source, "publish_no_replace");
	if (functions.length !== 1) {
		return false;
	}
	const [publish] = functions;
	const parameters = publish.parameters
		.replaceAll(/\s+/g, "")
		.replace(/,$/, "");
	const returnType = publish.returnType.replaceAll(/\s+/g, "");
	const renameCalls = extractCallArguments(publish.body, "renameat_with");
	if (
		parameters !== "parent:&Dir,staging_name:&Path,target_name:&Path" ||
		returnType !== "->Result<(),CommandError>" ||
		renameCalls.length !== 1
	) {
		return false;
	}
	const renameArguments = renameCalls[0].arguments
		.replaceAll(/\s+/g, "")
		.replace(/,$/, "");
	const countIdentifier = (identifier) =>
		[
			...publish.body.matchAll(
				new RegExp(`\\b${escapeRegularExpression(identifier)}\\b`, "g"),
			),
		].length;
	return (
		renameArguments ===
			"parent,staging_name,parent,target_name,RenameFlags::NOREPLACE" &&
		countIdentifier("parent") === 2 &&
		countIdentifier("staging_name") === 1 &&
		countIdentifier("target_name") === 1 &&
		!/\b(?:remove_file|remove_dir|remove_dir_all|unlink|unlinkat)\b/.test(
			publish.body,
		) &&
		[
			...publish.body.matchAll(
				/\.\s*map_err\s*\(\s*map_copy_publish_error\s*\)/g,
			),
		].length === 1
	);
}

function readlinkCallUsesBoundedProbe(source) {
	const [call] = extractCallArguments(source, "readlinkat_raw").filter(
		(candidate) => !/\bfn\s*$/.test(source.slice(0, candidate.index)),
	);
	if (call === undefined) {
		return false;
	}
	const argument = /,\s*&\s*mut\s+([A-Za-z_]\w*)\s*$/.exec(call.arguments);
	if (argument === null) {
		return false;
	}
	const declarations = [
		...source.matchAll(
			/\blet\s+mut\s+([A-Za-z_]\w*)\s*=\s*\[\s*0_u8\s*;\s*([^\]]+)\]\s*;/g,
		),
	].filter((match) => match[1] === argument[1] && match.index < call.index);
	const declaration = declarations.at(-1);
	if (
		declaration === undefined ||
		declaration[2].replaceAll(/\s+/g, "") !== "MAX_COPY_SYMLINK_BYTES+1"
	) {
		return false;
	}
	const between = source.slice(
		declaration.index + declaration[0].length,
		call.index,
	);
	return !new RegExp(`\\b${escapeRegularExpression(argument[1])}\\s*=`).test(
		between,
	);
}

export function validateWorkspaceRustBoundary(
	cargoSource,
	rustSources,
	cargoDependencies = [],
	resolvedSha2Features = [],
) {
	const failures = [];
	for (const [dependency, version] of [
		["cap-std", "4.0.2"],
		["libc", "0.2.186"],
		["notify", "=8.2.0"],
		["rustix", "=1.1.4"],
		["uuid", "1.24.0"],
	]) {
		if (!cargoDependencyDeclaration(dependency, version).test(cargoSource)) {
			failures.push(`Cargo.toml must pin ${dependency} to ${version}`);
		}
	}
	const sha2Declarations = [
		...cargoSource.matchAll(
			/^sha2 = \{ version = "=0\.10\.9", default-features = false, features = \[\] \}$/gm,
		),
	];
	if (sha2Declarations.length !== 1) {
		failures.push(
			'Cargo.toml must declare exactly one sha2 = { version = "=0.10.9", default-features = false, features = [] } dependency',
		);
	}

	const sha2Dependencies = cargoDependencies.filter(
		({ name }) => name === "sha2",
	);
	if (sha2Dependencies.length !== 1) {
		failures.push(
			"Cargo metadata must contain exactly one direct sha2 dependency",
		);
	} else {
		const [sha2Dependency] = sha2Dependencies;
		if (sha2Dependency.req !== SHA2_REQUIREMENT) {
			failures.push("the direct sha2 dependency must require exactly =0.10.9");
		}
		if (sha2Dependency.rename !== null) {
			failures.push("the direct sha2 dependency must remain unrenamed");
		}
		if (sha2Dependency.kind !== null) {
			failures.push("the direct sha2 dependency must be a normal runtime edge");
		}
		if (sha2Dependency.target !== null) {
			failures.push("the direct sha2 dependency must not be target-specific");
		}
		if (sha2Dependency.optional !== false) {
			failures.push("the direct sha2 dependency must not be optional");
		}
		if (sha2Dependency.uses_default_features !== false) {
			failures.push("the direct sha2 dependency must disable default features");
		}
		if (!sameArray(sha2Dependency.features, [])) {
			failures.push(
				"the direct sha2 dependency must enable no explicit features",
			);
		}
	}
	const normalizedSha2Features = Array.isArray(resolvedSha2Features)
		? [...new Set(resolvedSha2Features)].sort()
		: [];
	if (!sameArray(normalizedSha2Features, SHA2_RESOLVED_FEATURES)) {
		failures.push(
			"resolved sha2@0.10.9 features must remain exactly default and std",
		);
	}
	const zipDeclarations = [
		...cargoSource.matchAll(
			/^zip = \{ version = "=8\.6\.0", default-features = false, features = \["deflate-flate2-zlib-rs"\] \}$/gm,
		),
	];
	if (zipDeclarations.length !== 1) {
		failures.push(
			'Cargo.toml must declare exactly one zip = { version = "=8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs"] } dependency',
		);
	}
	const zipDependencies = cargoDependencies.filter(
		({ name }) => name === "zip",
	);
	if (zipDependencies.length !== 1) {
		failures.push(
			"Cargo metadata must contain exactly one direct zip dependency",
		);
	} else {
		const [zipDependency] = zipDependencies;
		if (zipDependency.req !== ZIP_REQUIREMENT) {
			failures.push("the direct zip dependency must require exactly =8.6.0");
		}
		if (zipDependency.rename !== null) {
			failures.push("the direct zip dependency must remain unrenamed");
		}
		if (zipDependency.kind !== null) {
			failures.push("the direct zip dependency must be a normal runtime edge");
		}
		if (zipDependency.target !== null) {
			failures.push("the direct zip dependency must not be target-specific");
		}
		if (zipDependency.optional !== false) {
			failures.push("the direct zip dependency must not be optional");
		}
		if (zipDependency.uses_default_features !== false) {
			failures.push("the direct zip dependency must disable default features");
		}
		if (!sameArray(zipDependency.features, ZIP_FEATURES)) {
			failures.push(
				"the direct zip dependency must enable exactly the deflate-flate2-zlib-rs feature",
			);
		}
	}

	const jsoncParserDeclarations = [
		...cargoSource.matchAll(
			/^jsonc-parser = \{ version = "=0\.33\.0", default-features = false, features = \[\] \}$/gm,
		),
	];
	if (jsoncParserDeclarations.length !== 1) {
		failures.push(
			'Cargo.toml must declare exactly one jsonc-parser = { version = "=0.33.0", default-features = false, features = [] } dependency',
		);
	}
	const jsoncParserDependencies = cargoDependencies.filter(
		({ name }) => name === "jsonc-parser",
	);
	if (jsoncParserDependencies.length !== 1) {
		failures.push(
			"Cargo metadata must contain exactly one direct jsonc-parser dependency",
		);
	} else {
		const [jsoncParserDependency] = jsoncParserDependencies;
		if (jsoncParserDependency.req !== JSONC_PARSER_REQUIREMENT) {
			failures.push(
				"the direct jsonc-parser dependency must require exactly =0.33.0",
			);
		}
		if (jsoncParserDependency.rename !== null) {
			failures.push("the direct jsonc-parser dependency must remain unrenamed");
		}
		if (jsoncParserDependency.kind !== null) {
			failures.push(
				"the direct jsonc-parser dependency must be a normal runtime edge",
			);
		}
		if (jsoncParserDependency.target !== null) {
			failures.push(
				"the direct jsonc-parser dependency must not be target-specific",
			);
		}
		if (jsoncParserDependency.optional !== false) {
			failures.push("the direct jsonc-parser dependency must not be optional");
		}
		if (jsoncParserDependency.uses_default_features !== false) {
			failures.push(
				"the direct jsonc-parser dependency must disable default features",
			);
		}
		if (!sameArray(jsoncParserDependency.features, JSONC_PARSER_FEATURES)) {
			failures.push(
				"the direct jsonc-parser dependency must enable no explicit features",
			);
		}
	}

	const notifyDeclarations = [...cargoSource.matchAll(/^notify\s*=/gm)];
	const notifyDependencies = cargoDependencies.filter(
		({ name }) => name === "notify",
	);
	if (
		notifyDeclarations.length !== 1 ||
		notifyDependencies.length !== 1 ||
		notifyDependencies[0].req !== "=8.2.0" ||
		notifyDependencies[0].rename !== null ||
		notifyDependencies[0].kind !== null ||
		notifyDependencies[0].target !== null ||
		notifyDependencies[0].optional !== false
	) {
		failures.push(
			"notify must remain one direct unrenamed non-optional runtime dependency pinned exactly to =8.2.0",
		);
	}
	if (
		/^(?!\s*#)[^\n]*(?:tauri-plugin-fs|tauri_plugin_fs|tauri-plugin-shell|tauri_plugin_shell)[^\n]*$/m.test(
			cargoSource,
		)
	) {
		failures.push(
			"Cargo.toml must not grant broad Tauri filesystem or shell authority",
		);
	}
	for (const [dependency, requirement] of [
		["globset", "=0.4.19"],
		["ignore", "=0.4.31"],
		["grep-matcher", "=0.1.9"],
		["grep-regex", "=0.1.14"],
		["grep-searcher", "=0.1.17"],
	]) {
		if (
			!cargoDependencyDeclaration(dependency, requirement).test(cargoSource)
		) {
			failures.push(`Cargo.toml must pin ${dependency} to ${requirement}`);
		}
		const dependencies = cargoDependencies.filter(
			({ name }) => name === dependency,
		);
		const hasExactDependency = dependencies.some(
			(candidate) =>
				candidate.req === requirement &&
				candidate.kind === null &&
				candidate.rename === null &&
				candidate.optional === false,
		);
		if (!hasExactDependency) {
			failures.push(
				`Cargo metadata must contain exactly one unrenamed runtime ${dependency} ${requirement} dependency`,
			);
		}
	}

	const usesCapFsExt = rustSources.some(({ relativePath, source }) => {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		return (
			WORKSPACE_RUST_SOURCE_PATTERN.test(normalizedPath) &&
			!WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath) &&
			/\bcap_fs_ext\b/.test(stripRustCommentsAndLiterals(source))
		);
	});
	const capFsExtDependencies = cargoDependencies.filter(
		({ name }) => name === "cap-fs-ext",
	);
	if (
		(usesCapFsExt || capFsExtDependencies.length > 0) &&
		(capFsExtDependencies.length !== 1 ||
			capFsExtDependencies[0].req !== "=4.0.2" ||
			capFsExtDependencies[0].kind !== null ||
			capFsExtDependencies[0].rename !== null)
	) {
		failures.push(
			"Cargo metadata must contain exactly one unrenamed runtime cap-fs-ext =4.0.2 dependency",
		);
	}
	const rustixDependencies = cargoDependencies.filter(
		({ name }) => name === "rustix",
	);
	if (
		rustixDependencies.length !== 1 ||
		rustixDependencies[0].req !== "=1.1.4" ||
		rustixDependencies[0].kind !== null ||
		rustixDependencies[0].rename !== null ||
		rustixDependencies[0].target !== RUSTIX_TARGET
	) {
		failures.push(
			"Cargo metadata must contain exactly one unrenamed runtime rustix =1.1.4 dependency for the audited Linux/macOS target",
		);
	}
	for (const dependency of FORBIDDEN_DIRECTORY_DEPENDENCIES) {
		if (cargoDependencies.some(({ name }) => name === dependency)) {
			failures.push(
				`Cargo metadata must not contain direct recursive-directory dependency ${dependency}, including renamed dependencies`,
			);
		}
	}
	for (const dependency of FORBIDDEN_DELETE_BYPASS_DEPENDENCIES) {
		if (cargoDependencies.some(({ name }) => name === dependency)) {
			failures.push(
				`Cargo metadata must not contain direct delete-bypass dependency ${dependency}, including renamed dependencies`,
			);
		}
	}
	const ignoreCrateNames = [
		"ignore",
		...cargoDependencies
			.filter(({ name }) => name === "ignore")
			.map(({ name, rename }) => rename ?? name),
	];

	let ambientOpenCount = 0;
	let ambientAuthorityCallCount = 0;
	let ambientCanonicalizeCount = 0;
	let exclusiveRenameCount = 0;
	let invalidExclusiveRenameCount = 0;
	const symlinkSyscallCounts = new Map([
		["readlinkat_raw", 0],
		["symlinkat", 0],
	]);
	const copyLimitDeclarations = new Map(
		WORKSPACE_COPY_LIMITS.map(([name]) => [name, []]),
	);
	let writerExecutableSource;
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		for (const dependency of forbiddenDirectoryCrates(executableSource)) {
			failures.push(
				`${normalizedPath} must not bind, alias or re-export recursive-directory crate ${dependency}`,
			);
		}
		for (const match of executableSource.matchAll(
			/\b(pub(?:\s*\([^)]*\))?\s+)use\s+([^;]+);/g,
		)) {
			if (
				/\b(?:create_dir_all|remove_dir_all)\b/.test(match[2]) ||
				FOLLOW_SYMLINKS_YES_PATTERN.test(match[2])
			) {
				failures.push(
					`${normalizedPath} must not re-export a forbidden recursive-directory operation`,
				);
			}
		}
		if (
			/\b(?:read_link|read_link_contents|readlink|readlinkat)\b/.test(
				executableSource,
			)
		) {
			failures.push(
				`${normalizedPath} must not use broad or alternate symlink read helpers in production Rust`,
			);
		}
		if (
			/\b(?:symlink|symlink_file|symlink_dir|symlink_contents)\b/.test(
				executableSource,
			)
		) {
			failures.push(
				`${normalizedPath} must not use broad symlink creation helpers in production Rust`,
			);
		}
		const exclusiveRenameAudit = auditExclusiveRenameBindings(executableSource);
		if (normalizedPath === "src-tauri/src/workspace/writer.rs") {
			writerExecutableSource = executableSource;
		}
		if (exclusiveRenameAudit.hasForbiddenBinding) {
			failures.push(
				`${normalizedPath} must not alias or re-export rustix or renameat_with`,
			);
		}
		if (exclusiveRenameAudit.referenceCount > 0) {
			if (normalizedPath !== "src-tauri/src/workspace/writer.rs") {
				failures.push(
					`${normalizedPath} must not use the exclusive rename syscall outside the workspace writer`,
				);
			} else {
				exclusiveRenameCount += exclusiveRenameAudit.calls.length;
				invalidExclusiveRenameCount += exclusiveRenameAudit.calls.filter(
					(call) => {
						const flagCount = [
							...call.arguments.matchAll(/\bRenameFlags\s*::\s*NOREPLACE\b/g),
						].length;
						return (
							!call.closed ||
							flagCount !== 1 ||
							!/,\s*RenameFlags\s*::\s*NOREPLACE\s*,?\s*$/.test(call.arguments)
						);
					},
				).length;
			}
		}

		for (const functionName of symlinkSyscallCounts.keys()) {
			const audit = auditDirectRustixFsFunction(executableSource, functionName);
			if (audit.hasForbiddenBinding) {
				failures.push(
					`${normalizedPath} must not alias or re-export rustix::fs::${functionName}`,
				);
			}
			if (audit.referenceCount === 0) {
				continue;
			}
			if (normalizedPath !== "src-tauri/src/workspace/writer.rs") {
				failures.push(
					`${normalizedPath} must not use rustix::fs::${functionName} outside the workspace writer`,
				);
				continue;
			}
			symlinkSyscallCounts.set(functionName, audit.calls.length);
		}
	}

	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!WORKSPACE_RUST_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		for (const [name, , integerType] of WORKSPACE_COPY_LIMITS) {
			copyLimitDeclarations
				.get(name)
				.push(
					...findWorkspaceCopyLimitDeclarations(
						executableSource,
						name,
						integerType,
					),
				);
		}
		if (usesIgnoreWalker(executableSource, ignoreCrateNames)) {
			failures.push(
				`${normalizedPath} must not use or re-export ignore::Walk or ignore::WalkBuilder for workspace traversal`,
			);
		}
		if (/\b(?:create_dir_all|remove_dir_all)\b/.test(executableSource)) {
			failures.push(
				`${normalizedPath} must not use unbounded recursive directory create/remove helpers`,
			);
		}
		if (/\bfollow_links\s*\(\s*\(*\s*true\s*\)*\s*\)/.test(executableSource)) {
			failures.push(
				`${normalizedPath} must not enable link-following directory traversal`,
			);
		}
		if (FOLLOW_SYMLINKS_YES_PATTERN.test(executableSource)) {
			failures.push(
				`${normalizedPath} must keep capability directory opens nofollow`,
			);
		}
		if (normalizedPath === "src-tauri/src/workspace/directory_copy.rs") {
			if (!directoryCopyLimitsAreExact(executableSource)) {
				failures.push(
					"workspace/directory_copy.rs must map every DirectoryCopyLimits field to its audited MAX_COPY constant",
				);
			}
			if (!productionDirectoryCopyUsesAuditedLimits(executableSource)) {
				failures.push(
					"workspace/directory_copy.rs production copy_directory must pass DIRECTORY_COPY_LIMITS directly",
				);
			}
			if (!directoryOpenOperationsAreNarrow(executableSource)) {
				failures.push(
					"workspace/directory_copy.rs must not use follow-capable directory open/conversion APIs outside its one staged-file open_with",
				);
			}
			if (!directoryTraversalHelpersUseNofollow(executableSource)) {
				failures.push(
					"workspace/directory_copy.rs source and stage traversal helpers must call open_dir_nofollow directly",
				);
			}
		}
		if (/\bcopy\b/.test(executableSource)) {
			failures.push(
				`${normalizedPath} must not use an unaudited copy primitive; use workspace_copy/copy_entry helpers`,
			);
		}
		if (/\boverwrite\b/.test(executableSource)) {
			failures.push(
				`${normalizedPath} must not add an overwrite path to workspace mutations`,
			);
		}

		if (/\bto_string_lossy\s*\(/.test(source)) {
			failures.push(
				`${normalizedPath} must not create an operable path with lossy conversion`,
			);
		}
		if (
			/\b(?:use\s+std\s*::\s*fs\b|use\s+std\s*::\s*\{[^;]*\bfs\b|use\s+std\s+as\b|extern\s+crate\s+std\b)/s.test(
				source,
			)
		) {
			failures.push(
				`${normalizedPath} must not alias ambient std::fs in workspace production code`,
			);
		}

		for (const match of source.matchAll(
			/\bstd\s*::\s*fs\s*::\s*([A-Za-z_]\w*)/g,
		)) {
			const operation = match[1];
			if (
				operation !== "canonicalize" ||
				normalizedPath !== "src-tauri/src/workspace/mod.rs"
			) {
				failures.push(
					`${normalizedPath} uses forbidden ambient std::fs operation ${operation}`,
				);
			} else {
				ambientCanonicalizeCount += 1;
			}
		}

		const openCount = [...source.matchAll(/\bopen_ambient_dir\b/g)].length;
		const authorityCallCount = [...source.matchAll(/\bambient_authority\s*\(/g)]
			.length;
		if (
			(openCount > 0 || authorityCallCount > 0) &&
			normalizedPath !== "src-tauri/src/workspace/mod.rs"
		) {
			failures.push(
				`${normalizedPath} opens ambient paths outside the sole root authorizer`,
			);
		}
		ambientOpenCount += openCount;
		ambientAuthorityCallCount += authorityCallCount;

		const forbiddenQualifiedRenames = [
			...source.matchAll(/\b([A-Za-z_]\w*)\s*::\s*rename\b/g),
		].filter((match) => {
			const allowedCall =
				(normalizedPath === "src-tauri/src/workspace/commands.rs" &&
					match[1] === "WorkspaceService") ||
				(normalizedPath === "src-tauri/src/workspace/service.rs" &&
					match[1] === "writer");
			return !allowedCall;
		});
		if (
			normalizedPath !== WORKSPACE_VERSIONED_WRITER_PATH &&
			(/\brenameat\b/.test(source) ||
				/\.rename\s*\(/.test(source) ||
				forbiddenQualifiedRenames.length > 0)
		) {
			failures.push(
				`${normalizedPath} must not use an overwrite-capable rename`,
			);
		}
	}

	if (ambientOpenCount !== 1 || ambientAuthorityCallCount !== 1) {
		failures.push(
			"workspace production code must contain exactly one ambient root authorizer",
		);
	}
	if (ambientCanonicalizeCount > 2) {
		failures.push(
			"workspace root identity may use at most two platform canonicalize fallbacks",
		);
	}
	if (exclusiveRenameCount !== 2) {
		failures.push(
			"workspace writer must contain exactly two audited renameat_with calls",
		);
	}
	if (invalidExclusiveRenameCount > 0) {
		failures.push(
			"every workspace writer renameat_with call must pass exactly one direct RenameFlags::NOREPLACE flag",
		);
	}
	for (const [functionName, count] of symlinkSyscallCounts) {
		if (count !== 1) {
			failures.push(
				`workspace writer must contain exactly one audited rustix::fs::${functionName} call`,
			);
		}
	}
	for (const [name, value, integerType] of WORKSPACE_COPY_LIMITS) {
		const declarations = copyLimitDeclarations.get(name);
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value
		) {
			failures.push(workspaceCopyLimitFailure(name, value, integerType));
		}
	}
	if (
		writerExecutableSource === undefined ||
		!readlinkCallUsesBoundedProbe(writerExecutableSource)
	) {
		failures.push(
			"workspace writer must probe symlink payloads with a MAX_COPY_SYMLINK_BYTES + 1 buffer",
		);
	}
	if (
		writerExecutableSource === undefined ||
		!publishNoReplaceIsExact(writerExecutableSource)
	) {
		failures.push(
			"workspace writer publish_no_replace must publish staging_name to target_name with one direct NOREPLACE call and no pre-delete",
		);
	}

	return failures;
}

function findRustSource(rustSources, expectedPath) {
	return rustSources.find(
		({ relativePath }) => relativePath.replaceAll("\\", "/") === expectedPath,
	)?.source;
}

export function validateWorkspaceCapabilitiesBoundary(rustSources, appSources) {
	const failures = [];
	const dto = findRustSource(rustSources, "src-tauri/src/workspace/dto.rs");
	const commands = findRustSource(
		rustSources,
		"src-tauri/src/workspace/commands.rs",
	);
	const lib = findRustSource(rustSources, "src-tauri/src/lib.rs");
	const appSource = (expectedPath) =>
		appSources.find(
			({ relativePath }) => relativePath.replaceAll("\\", "/") === expectedPath,
		)?.source;
	const contracts = appSource("app/platform/tauri/contracts.ts");
	const codec = appSource("app/platform/tauri/workspace-codec.ts");
	const native = appSource("app/platform/tauri/native.ts");
	const browserMock = appSource("app/platform/tauri/browser-mock.ts");
	const normalized = (value) => value.replaceAll(/\s+/g, "");
	const rustStructs = (source, name) => {
		const structs = [];
		const pattern = new RegExp(`\\bpub\\s+struct\\s+${name}\\b`, "g");
		for (const match of source.matchAll(pattern)) {
			const bodyOpen = source.indexOf("{", match.index + match[0].length);
			if (bodyOpen < 0) {
				continue;
			}
			const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
			if (bodyClose !== undefined) {
				structs.push({
					start: match.index,
					body: source.slice(bodyOpen + 1, bodyClose),
				});
			}
		}
		return structs;
	};

	const executableDto = dto && stripRustCommentsAndLiterals(dto);
	const requestStructs = executableDto
		? rustStructs(executableDto, "WorkspaceCapabilitiesRequest")
		: [];
	const capabilityStructs = executableDto
		? rustStructs(executableDto, "WorkspaceCapabilities")
		: [];
	const requestHasDenyUnknown =
		requestStructs.length === 1 &&
		/#\s*\[\s*serde\s*\(\s*deny_unknown_fields\s*\)\s*\]\s*$/.test(
			executableDto.slice(
				Math.max(0, requestStructs[0].start - 160),
				requestStructs[0].start,
			),
		);
	if (
		requestStructs.length !== 1 ||
		normalized(requestStructs[0]?.body ?? "") !== "" ||
		!requestHasDenyUnknown ||
		capabilityStructs.length !== 1 ||
		normalized(capabilityStructs[0]?.body ?? "") !==
			"create:bool,rename_no_replace:bool,copy_move:bool,delete:bool,versioned_write:bool,"
	) {
		failures.push(
			"workspace capability Rust DTO must be an empty deny-unknown request and the exact five-boolean response",
		);
	}
	const currentPlatformFunctions = executableDto
		? extractRustFunctions(executableDto, "current_platform")
		: [];
	const currentPlatform = currentPlatformFunctions[0];
	const expectedCurrentPlatformBody =
		"constHAS_EXCLUSIVE_NAMESPACE_MUTATIONS:bool=::core::cfg!(any(target_os=,target_os=));" +
		"Self{create:true,rename_no_replace:HAS_EXCLUSIVE_NAMESPACE_MUTATIONS," +
		"copy_move:HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,delete:HAS_EXCLUSIVE_NAMESPACE_MUTATIONS," +
		"versioned_write:HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,}";
	const originalCurrentPlatformBody =
		dto !== undefined && currentPlatform !== undefined
			? dto.slice(currentPlatform.bodyStart, currentPlatform.bodyEnd)
			: "";
	if (
		currentPlatformFunctions.length !== 1 ||
		normalized(currentPlatform?.returnType ?? "") !== "->Self" ||
		normalized(currentPlatform?.body ?? "") !== expectedCurrentPlatformBody ||
		!/^\s*const\s+HAS_EXCLUSIVE_NAMESPACE_MUTATIONS\s*:\s*bool\s*=\s*::\s*core\s*::\s*cfg!\(\s*any\(\s*target_os\s*=\s*"linux"\s*,\s*target_os\s*=\s*"macos"\s*\)\s*\)\s*;/u.test(
			originalCurrentPlatformBody,
		)
	) {
		failures.push(
			"workspace capabilities must keep create cross-platform and derive every unsafe mutation from the one Linux/macOS build gate",
		);
	}
	const executableCommands = commands && stripRustCommentsAndLiterals(commands);
	const capabilityCommands = executableCommands
		? extractRustFunctions(executableCommands, "workspace_capabilities")
		: [];
	const capabilityCommand = capabilityCommands[0];
	const commandPrefix =
		executableCommands !== undefined && capabilityCommand !== undefined
			? executableCommands.slice(
					Math.max(0, capabilityCommand.start - 120),
					capabilityCommand.start,
				)
			: "";
	if (
		capabilityCommands.length !== 1 ||
		!/#\s*\[\s*tauri\s*::\s*command\s*\]\s*pub\s*\(\s*crate\s*\)\s*$/u.test(
			commandPrefix,
		) ||
		normalized(capabilityCommand?.parameters ?? "") !==
			"_window:WebviewWindow,request:WorkspaceCapabilitiesRequest," ||
		normalized(capabilityCommand?.returnType ?? "") !==
			"->WorkspaceCapabilities" ||
		normalized(capabilityCommand?.body ?? "") !==
			"request.validate();WorkspaceCapabilities::current_platform()"
	) {
		failures.push(
			"workspace_capabilities must be one exact Tauri command returning only the frozen platform contract",
		);
	}
	const executableLib = lib && stripRustCommentsAndLiterals(lib);
	const capabilityRegistrations = executableLib
		? [
				...executableLib.matchAll(
					/\bworkspace\s*::\s*commands\s*::\s*workspace_capabilities\b/g,
				),
			]
		: [];
	const handlerBodies = executableLib
		? [
				...executableLib.matchAll(
					/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
				),
			]
		: [];
	if (
		capabilityRegistrations.length !== 1 ||
		handlerBodies.length !== 1 ||
		!/(?:^|[\s,])workspace\s*::\s*commands\s*::\s*workspace_capabilities\s*(?:,|$)/u.test(
			handlerBodies[0]?.[1] ?? "",
		)
	) {
		failures.push(
			"src-tauri/src/lib.rs must register workspace_capabilities exactly once",
		);
	}

	const contractsFile =
		contracts === undefined
			? undefined
			: ts.createSourceFile(
					"contracts.ts",
					contracts,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	const capabilityInterfaces =
		contractsFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === "WorkspaceCapabilities",
		) ?? [];
	const capabilityInterface = capabilityInterfaces[0];
	const capabilityMembers =
		capabilityInterface?.members.map((member) => ({
			name: typeScriptStaticName(member.name),
			readonly:
				member.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
				) ?? false,
			boolean: member.type?.kind === ts.SyntaxKind.BooleanKeyword,
			property: ts.isPropertySignature(member),
		})) ?? [];
	const plainBridgeInterfaces =
		contractsFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === "PlainBridge",
		) ?? [];
	const bridgeCapabilityMembers =
		plainBridgeInterfaces[0]?.members.filter(
			(member) =>
				ts.isMethodSignature(member) &&
				typeScriptStaticName(member.name) === "workspaceCapabilities",
		) ?? [];
	if (
		capabilityInterfaces.length !== 1 ||
		JSON.stringify(capabilityMembers) !==
			JSON.stringify(
				[
					"create",
					"renameNoReplace",
					"copyMove",
					"delete",
					"versionedWrite",
				].map((name) => ({
					name,
					readonly: true,
					boolean: true,
					property: true,
				})),
			) ||
		plainBridgeInterfaces.length !== 1 ||
		bridgeCapabilityMembers.length !== 1 ||
		bridgeCapabilityMembers[0].parameters.length !== 0 ||
		normalized(
			bridgeCapabilityMembers[0].type?.getText(contractsFile) ?? "",
		) !== "Promise<WorkspaceCapabilities>"
	) {
		failures.push(
			"PlainBridge must own the exact five-boolean workspace capability contract",
		);
	}
	const codecFile =
		codec === undefined
			? undefined
			: ts.createSourceFile(
					"workspace-codec.ts",
					codec,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	const capabilityDecoders =
		codecFile?.statements.filter(
			(statement) =>
				ts.isFunctionDeclaration(statement) &&
				statement.name?.text === "decodeWorkspaceCapabilities",
		) ?? [];
	const capabilityDecoder = capabilityDecoders[0];
	const expectedDecoderBody =
		"{returnsanitizedDecode(()=>{constsnapshot=ownPlainDataSnapshot(value);" +
		'if(!hasExactKeys(snapshot,["create","renameNoReplace","copyMove","delete","versionedWrite",])||' +
		'typeofsnapshot.create!=="boolean"||typeofsnapshot.renameNoReplace!=="boolean"||' +
		'typeofsnapshot.copyMove!=="boolean"||typeofsnapshot.delete!=="boolean"||' +
		'typeofsnapshot.versionedWrite!=="boolean"){returnviolation();}' +
		"rejectProxyObject(valueasobject);returnObject.freeze({create:snapshot.create," +
		"renameNoReplace:snapshot.renameNoReplace,copyMove:snapshot.copyMove," +
		"delete:snapshot.delete,versionedWrite:snapshot.versionedWrite,});});}";
	if (
		capabilityDecoders.length !== 1 ||
		capabilityDecoder.parameters.length !== 1 ||
		!ts.isIdentifier(capabilityDecoder.parameters[0]?.name) ||
		capabilityDecoder.parameters[0].name.text !== "value" ||
		normalized(capabilityDecoder.type?.getText(codecFile) ?? "") !==
			"WorkspaceCapabilities" ||
		!capabilityDecoder.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) ||
		normalized(capabilityDecoder.body?.getText(codecFile) ?? "") !==
			expectedDecoderBody
	) {
		failures.push(
			"workspace capability decoder must snapshot exact own booleans, reject Proxy payloads and freeze the result",
		);
	}
	const nativeFile =
		native === undefined
			? undefined
			: ts.createSourceFile(
					"native.ts",
					native,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	const nativeBridgeFactories =
		nativeFile?.statements.filter(
			(statement) =>
				ts.isFunctionDeclaration(statement) &&
				statement.name?.text === "createNativeBridge",
		) ?? [];
	const nativeBridgeFactory = nativeBridgeFactories[0];
	const nativeBridgeBodyStatements =
		nativeBridgeFactory?.body?.statements ?? [];
	const nativeBridgeReturns = nativeBridgeBodyStatements.filter(
		ts.isReturnStatement,
	);
	const nativeWatcherSetupStatements = nativeBridgeBodyStatements.filter(
		(statement) => {
			if (
				!ts.isVariableStatement(statement) ||
				(statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
				statement.declarationList.declarations.length !== 1
			) {
				return false;
			}
			const [declaration] = statement.declarationList.declarations;
			return (
				ts.isIdentifier(declaration.name) &&
				declaration.name.text === "workspaceWatcher" &&
				declaration.initializer !== undefined &&
				ts.isCallExpression(declaration.initializer) &&
				ts.isIdentifier(declaration.initializer.expression) &&
				declaration.initializer.expression.text ===
					"createWorkspaceWatcherManager" &&
				declaration.initializer.arguments.length === 1
			);
		},
	);
	const nativeWatcherManagerIsPresent =
		appSource("app/platform/tauri/workspace-watcher.ts") !== undefined;
	const nativeBridgeStatementsAreExact = nativeWatcherManagerIsPresent
		? nativeBridgeBodyStatements.length === 2 &&
			nativeWatcherSetupStatements.length === 1 &&
			nativeBridgeBodyStatements[0] === nativeWatcherSetupStatements[0] &&
			nativeBridgeBodyStatements[1] === nativeBridgeReturns[0]
		: nativeBridgeBodyStatements.length === 1 &&
			nativeWatcherSetupStatements.length === 0 &&
			nativeBridgeBodyStatements[0] === nativeBridgeReturns[0];
	const nativeBridgeReturnExpression = nativeBridgeReturns[0]?.expression;
	const nativeBridgeObject =
		nativeBridgeReturnExpression !== undefined &&
		ts.isObjectLiteralExpression(nativeBridgeReturnExpression)
			? nativeBridgeReturns[0].expression
			: undefined;
	const nativeCapabilityRoutes =
		nativeBridgeObject?.properties.filter(
			(property) =>
				typeScriptStaticName(property.name) === "workspaceCapabilities",
		) ?? [];
	const nativeCapabilityRoute = nativeCapabilityRoutes[0];
	const nativeObjectHasDynamicOverrides =
		nativeBridgeObject?.properties.some(
			(property) =>
				ts.isSpreadAssignment(property) ||
				typeScriptStaticName(property.name) === undefined,
		) ?? true;
	const nativeImportBindingCount = (moduleName, importedName, localName) =>
		nativeFile?.statements
			.filter(ts.isImportDeclaration)
			.filter(
				(declaration) =>
					ts.isStringLiteral(declaration.moduleSpecifier) &&
					declaration.moduleSpecifier.text === moduleName &&
					declaration.importClause !== undefined &&
					!declaration.importClause.isTypeOnly &&
					declaration.importClause.namedBindings !== undefined &&
					ts.isNamedImports(declaration.importClause.namedBindings),
			)
			.flatMap((declaration) =>
				declaration.importClause.namedBindings.elements.filter(
					(specifier) =>
						!specifier.isTypeOnly &&
						(specifier.propertyName?.text ?? specifier.name.text) ===
							importedName &&
						specifier.name.text === localName,
				),
			).length ?? 0;
	if (
		nativeImportBindingCount("@tauri-apps/api/core", "invoke", "invoke") !==
			1 ||
		nativeImportBindingCount(
			"./workspace-codec",
			"decodeWorkspaceCapabilities",
			"decodeWorkspaceCapabilities",
		) !== 1 ||
		nativeBridgeFactories.length !== 1 ||
		nativeBridgeFactory.parameters.length !== 0 ||
		normalized(nativeBridgeFactory.type?.getText(nativeFile) ?? "") !==
			"PlainBridge" ||
		!nativeBridgeFactory.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) ||
		!nativeBridgeStatementsAreExact ||
		nativeBridgeReturns.length !== 1 ||
		nativeBridgeObject === undefined ||
		nativeObjectHasDynamicOverrides ||
		nativeCapabilityRoutes.length !== 1 ||
		!ts.isPropertyAssignment(nativeCapabilityRoute) ||
		normalized(nativeCapabilityRoute.initializer.getText(nativeFile)) !==
			'async()=>decodeWorkspaceCapabilities(awaitinvoke<unknown>("workspace_capabilities",{request:{}}),)'
	) {
		failures.push(
			"native bridge must invoke workspace_capabilities once with an empty request and strictly decode it",
		);
	}
	const browserFile =
		browserMock === undefined
			? undefined
			: ts.createSourceFile(
					"browser-mock.ts",
					browserMock,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	const browserCapabilityMethods = [];
	const browserCapabilitySnapshots = [];
	if (browserFile !== undefined) {
		function visitBrowserCapability(node) {
			if (
				ts.isMethodDeclaration(node) &&
				typeScriptStaticName(node.name) === "workspaceCapabilities"
			) {
				browserCapabilityMethods.push(node);
			}
			if (
				ts.isVariableDeclaration(node) &&
				node.name.getText(browserFile) === "workspaceCapabilities"
			) {
				browserCapabilitySnapshots.push(node.initializer);
			}
			ts.forEachChild(node, visitBrowserCapability);
		}
		visitBrowserCapability(browserFile);
	}
	if (
		browserCapabilityMethods.length !== 1 ||
		browserCapabilityMethods[0].parameters.length !== 0 ||
		normalized(browserCapabilityMethods[0].body?.getText(browserFile) ?? "") !==
			"{returnworkspaceCapabilities;}" ||
		browserCapabilitySnapshots.length !== 1 ||
		normalized(browserCapabilitySnapshots[0]?.getText(browserFile) ?? "") !==
			"Object.freeze({create:true,renameNoReplace:true,copyMove:true,delete:true,versionedWrite:true,})"
	) {
		failures.push(
			"browser mock must expose one immutable workspace capability snapshot",
		);
	}

	failures.push(...validateWorkspaceWatcherBoundary(rustSources, appSources));
	return [...new Set(failures)];
}

function watcherRustStructBodies(source, name) {
	if (source === undefined) {
		return [];
	}
	const bodies = [];
	const pattern = new RegExp(
		`\\b(?:pub(?:\\s*\\([^)]*\\))?\\s+)?struct\\s+${escapeRegularExpression(name)}\\b`,
		"g",
	);
	for (const match of source.matchAll(pattern)) {
		const bodyOpen = source.indexOf("{", match.index + match[0].length);
		if (bodyOpen < 0) {
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		if (bodyClose !== undefined) {
			bodies.push({
				start: match.index,
				body: source.slice(bodyOpen + 1, bodyClose),
			});
		}
	}
	return bodies;
}

function watcherTypeScriptSource(source, fileName) {
	return source === undefined
		? undefined
		: ts.createSourceFile(
				fileName,
				source,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS,
			);
}

function watcherTypeScriptExecutableText(source) {
	if (source === undefined) {
		return "";
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
		tokens.push(scanner.getTokenText());
	}
	return tokens.join("");
}

function watcherInterfaceShape(sourceFile, name) {
	const declarations =
		sourceFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) && statement.name.text === name,
		) ?? [];
	if (declarations.length !== 1) {
		return undefined;
	}
	return declarations[0].members.map((member) => ({
		kind: ts.isPropertySignature(member) ? "property" : "other",
		name: typeScriptStaticName(member.name),
		optional: member.questionToken !== undefined,
		readonly:
			member.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
			) ?? false,
		type: member.type?.getText(sourceFile).replaceAll(/\s+/g, "") ?? "",
	}));
}

function watcherClassMethod(sourceFile, className, methodName) {
	const classes =
		sourceFile?.statements.filter(
			(statement) =>
				ts.isClassDeclaration(statement) && statement.name?.text === className,
		) ?? [];
	if (classes.length !== 1) {
		return undefined;
	}
	const methods = classes[0].members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			member.name.getText(sourceFile) === methodName,
	);
	return methods.length === 1 ? methods[0] : undefined;
}

function watcherClassArrowFunction(sourceFile, className, propertyName) {
	const classes =
		sourceFile?.statements.filter(
			(statement) =>
				ts.isClassDeclaration(statement) && statement.name?.text === className,
		) ?? [];
	if (classes.length !== 1) {
		return undefined;
	}
	const properties = classes[0].members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptStaticName(member.name) === propertyName &&
			ts.isArrowFunction(member.initializer),
	);
	return properties.length === 1 ? properties[0].initializer : undefined;
}

function validateWatcherProviderRoute(providerSource) {
	const failure =
		"Plain provider watch must route one root-only subscription through bridge.workspaceWatch";
	const sourceFile = watcherTypeScriptSource(
		providerSource,
		"file-system-provider.ts",
	);
	const watch = watcherClassMethod(
		sourceFile,
		"PlainWorkspaceFileSystemProvider",
		"watch",
	);
	if (sourceFile === undefined || watch?.body === undefined) {
		return [failure];
	}

	const bridgeReferences = [];
	const bridgeCalls = [];
	const resolveCalls = [];
	const refreshCalls = [];
	const forbiddenCalls = [];
	function visit(node) {
		if (
			ts.isPropertyAccessExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ThisKeyword &&
			node.name.getText(sourceFile) === "#bridge"
		) {
			bridgeReferences.push(node);
		}
		if (ts.isCallExpression(node)) {
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isPropertyAccessExpression(node.expression.expression) &&
				node.expression.expression.expression.kind ===
					ts.SyntaxKind.ThisKeyword &&
				node.expression.expression.name.getText(sourceFile) === "#bridge"
			) {
				bridgeCalls.push(node);
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
				node.expression.name.text === "resolveResource"
			) {
				resolveCalls.push(node);
			}
			if (
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
				node.expression.name.text === "fireRootUpdated"
			) {
				refreshCalls.push(node);
			}
			if (
				ts.isIdentifier(node.expression) &&
				["invoke", "listen", "readFile", "watch"].includes(node.expression.text)
			) {
				forbiddenCalls.push(node);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(watch.body);

	const [bridgeCall] = bridgeCalls;
	const bridgeCallName =
		bridgeCall !== undefined &&
		ts.isPropertyAccessExpression(bridgeCall.expression)
			? bridgeCall.expression.name.text
			: undefined;
	const rootArgument = bridgeCall?.arguments[0];
	const listenerArgument = bridgeCall?.arguments[1];
	const rootIsResolvedId =
		rootArgument !== undefined &&
		ts.isPropertyAccessExpression(rootArgument) &&
		ts.isIdentifier(rootArgument.expression) &&
		rootArgument.expression.text === "resolved" &&
		rootArgument.name.text === "rootId";
	const listenerIsNarrow =
		listenerArgument !== undefined &&
		(ts.isArrowFunction(listenerArgument) ||
			ts.isFunctionExpression(listenerArgument)) &&
		listenerArgument.parameters.length === 0;
	const refreshIsInsideListener =
		listenerArgument !== undefined &&
		refreshCalls.length === 1 &&
		(() => {
			let current = refreshCalls[0];
			while (current !== undefined) {
				if (current === listenerArgument) {
					return true;
				}
				current = current.parent;
			}
			return false;
		})();
	if (
		watch.parameters.length !== 2 ||
		bridgeReferences.length !== 1 ||
		bridgeCalls.length !== 1 ||
		bridgeCallName !== "workspaceWatch" ||
		bridgeCall.arguments.length !== 2 ||
		!rootIsResolvedId ||
		!listenerIsNarrow ||
		!refreshIsInsideListener ||
		resolveCalls.length !== 1 ||
		refreshCalls.length !== 1 ||
		forbiddenCalls.length !== 0
	) {
		return [failure];
	}
	return [];
}

function watcherForbiddenAppSurface(appSources) {
	const forbiddenModules =
		/(?:^|\/)(?:vscode\/localExtensionHost|extensionHost\.worker)|monaco-vscode-(?:ai|chat|auth|sync|gallery|remote|task|testing|notebook|telemetry|speech|mcp)(?:[-/@]|$)|@(?:openai|github\/copilot)|@tauri-apps\/(?:plugin-fs|plugin-shell)/i;
	const forbiddenIdentifiers = new Set([
		"ExtensionHostKind",
		"setLocalExtensionHost",
		"extensionHostWorkerMain",
	]);
	for (const { source, relativePath } of appSources) {
		const sourceFile = watcherTypeScriptSource(source, relativePath);
		let forbidden = false;
		function visit(node) {
			if (
				(ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
				forbiddenModules.test(node.text)
			) {
				forbidden = true;
			}
			if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
				forbidden = true;
			}
			if (
				ts.isPropertyAssignment(node) &&
				typeScriptStaticName(node.name) === "enableWorkerExtensionHost" &&
				node.initializer.kind === ts.SyntaxKind.TrueKeyword
			) {
				forbidden = true;
			}
			ts.forEachChild(node, visit);
		}
		if (sourceFile !== undefined) {
			visit(sourceFile);
		}
		if (forbidden) {
			return `${relativePath.replaceAll("\\", "/")} restores an excluded Extension Host, AI, account, sync or broad native surface`;
		}
	}
	return undefined;
}

export function validateWorkspaceWatcherBoundary(rustSources, appSources) {
	const normalizedPath = (value) => value.replaceAll("\\", "/");
	const hasWatcherSurface =
		rustSources.some(
			({ relativePath }) =>
				normalizedPath(relativePath) === "src-tauri/src/workspace/watcher.rs",
		) ||
		appSources.some(({ relativePath }) =>
			[
				"app/platform/tauri/workspace-watcher.ts",
				"app/features/workspace/file-system-provider.ts",
			].includes(normalizedPath(relativePath)),
		);
	if (!hasWatcherSurface) {
		return [];
	}

	const failures = [];
	const rustSource = (expectedPath) =>
		findRustSource(rustSources, expectedPath);
	const appSource = (expectedPath) =>
		appSources.find(
			({ relativePath }) => normalizedPath(relativePath) === expectedPath,
		)?.source;
	const watcher = rustSource("src-tauri/src/workspace/watcher.rs");
	const workspaceRoot = rustSource("src-tauri/src/workspace/mod.rs");
	const dto = rustSource("src-tauri/src/workspace/dto.rs");
	const commands = rustSource("src-tauri/src/workspace/commands.rs");
	const lib = rustSource("src-tauri/src/lib.rs");
	const service = rustSource("src-tauri/src/workspace/service.rs");
	const contracts = appSource("app/platform/tauri/contracts.ts");
	const codec = appSource("app/platform/tauri/workspace-codec.ts");
	const manager = appSource("app/platform/tauri/workspace-watcher.ts");
	const native = appSource("app/platform/tauri/native.ts");
	const browserMock = appSource("app/platform/tauri/browser-mock.ts");
	const provider = appSource("app/features/workspace/file-system-provider.ts");
	const compact = (value) => value?.replaceAll(/\s+/g, "") ?? "";

	const executableWatcher =
		watcher === undefined ? undefined : stripRustCommentsAndLiterals(watcher);
	const classifier =
		executableWatcher === undefined
			? undefined
			: extractRustFunctions(executableWatcher, "classify_notify_event")[0];
	const classifierBody = compact(classifier?.body);
	const watcherPrepare =
		executableWatcher === undefined
			? undefined
			: extractRustFunctions(executableWatcher, "prepare")[0];
	const watcherPrepareBody = compact(watcherPrepare?.body);
	if (
		watcher === undefined ||
		!/\bconst\s+WATCH_WAKE_QUEUE_CAPACITY\s*:\s*usize\s*=\s*1\s*;/.test(
			executableWatcher,
		) ||
		[
			...executableWatcher.matchAll(
				/\bmpsc\s*::\s*sync_channel\s*\(\s*WATCH_WAKE_QUEUE_CAPACITY\s*\)/g,
			),
		].length !== 1 ||
		!/Config\s*::\s*default\s*\(\s*\)\s*\.\s*with_follow_symlinks\s*\(\s*false\s*\)/.test(
			executableWatcher,
		)
	) {
		failures.push(
			"workspace watcher must keep one capacity-one queue and notify symlink following disabled",
		);
	}
	if (
		classifier === undefined ||
		!classifierBody.includes("event.kind.is_access()") ||
		!classifierBody.includes("WatchObservation::Ignore") ||
		!classifierBody.includes("event.need_rescan()") ||
		!classifierBody.includes("rescan_required:true") ||
		/(?:\.paths\b|\bpaths\s*\(|to_string\s*\(|format\s*!|Debug\b)/.test(
			classifier?.body ?? "",
		) ||
		watcherPrepare === undefined ||
		!watcherPrepareBody.includes(
			"move|result:notify::Result<Event>|callback(classify_notify_event(result))",
		) ||
		[...watcherPrepareBody.matchAll(/callback\(/g)].length !== 1 ||
		[...watcherPrepareBody.matchAll(/classify_notify_event\(result\)/g)]
			.length !== 1
	) {
		failures.push(
			"notify callback must discard paths and raw errors, ignore access events and conservatively request rescans",
		);
	}
	const markFunctions =
		executableWatcher === undefined
			? []
			: extractRustFunctions(executableWatcher, "mark");
	const markBody = compact(markFunctions[0]?.body);
	const fullIndex = markBody.indexOf("Err(TrySendError::Full(()))");
	if (
		markFunctions.length !== 1 ||
		fullIndex < 0 ||
		markBody.indexOf(
			"self.rescan_required.store(true,Ordering::Release)",
			fullIndex,
		) < fullIndex ||
		markBody.indexOf("self.dirty.store(true,Ordering::Release)", fullIndex) <
			fullIndex
	) {
		failures.push("a full watcher wake queue must preserve dirty rescan state");
	}
	const syncFunctions =
		executableWatcher === undefined
			? []
			: extractRustFunctions(executableWatcher, "sync");
	const syncBody = compact(syncFunctions[0]?.body);
	if (
		syncFunctions.length !== 1 ||
		!syncBody.includes("acknowledgements.len()>MAX_WATCH_ACKNOWLEDGEMENTS") ||
		!syncBody.includes("pending.generation==acknowledgement.generation") ||
		!syncBody.includes("acknowledgement.generation==u32::MAX") ||
		!syncBody.includes("record.pending=None") ||
		!syncBody.includes("record.pending.map") ||
		[...executableWatcher.matchAll(/\brecord\s*\.\s*pending\s*=\s*None\b/g)]
			.length !== 1
	) {
		failures.push(
			"watcher pending generations must stay sticky until one exact bounded acknowledgement",
		);
	}

	const dtoExecutable =
		dto === undefined ? undefined : stripRustCommentsAndLiterals(dto);
	const structRecord = (name) => {
		const bodies = watcherRustStructBodies(dtoExecutable, name);
		return bodies.length === 1 ? bodies[0] : undefined;
	};
	const structBody = (name) =>
		compact(structRecord(name)?.body?.replaceAll(/#\s*\[[^\]]+\]/g, ""));
	const hasDenyUnknownFields = (name) => {
		const record = structRecord(name);
		return (
			record !== undefined &&
			/#\s*\[\s*serde\s*\([^\]]*\bdeny_unknown_fields\b[^\]]*\)\s*\]\s*$/.test(
				dtoExecutable.slice(Math.max(0, record.start - 200), record.start),
			)
		);
	};
	if (
		dtoExecutable === undefined ||
		!/\bconst\s+MAX_WORKSPACE_WATCH_ROOTS\s*:\s*usize\s*=\s*256\s*;/.test(
			dtoExecutable,
		) ||
		structBody("WorkspaceWatchSyncRootRequest") !==
			"root_id:RootId,acknowledged_generation:WorkspaceWatchAcknowledgedGeneration," ||
		structBody("WorkspaceWatchSyncRequest") !==
			"roots:Vec<WorkspaceWatchSyncRootRequest>," ||
		structBody("WorkspaceWatchSyncRootRequestWire") !==
			"root_id:RootId,acknowledged_generation:WorkspaceWatchAcknowledgedGeneration," ||
		!hasDenyUnknownFields("WorkspaceWatchSyncRootRequestWire") ||
		!hasDenyUnknownFields("WorkspaceWatchSyncRequest") ||
		!compact(
			extractRustFunctions(dtoExecutable, "deserialize").find((candidate) =>
				candidate.body.includes("WorkspaceWatchSyncRootRequestWire"),
			)?.body,
		).includes(
			"wire.acknowledged_generation==WorkspaceWatchAcknowledgedGeneration::Missing{returnErr(D::Error::missing_field());",
		) ||
		!compact(
			extractRustFunctions(dtoExecutable, "into_parts").find((candidate) =>
				candidate.returnType.includes("Vec<(RootId, Option<u32>)>"),
			)?.body,
		).includes(
			"self.roots.is_empty()||self.roots.len()>MAX_WORKSPACE_WATCH_ROOTS",
		) ||
		!compact(
			extractRustFunctions(dtoExecutable, "into_parts").find((candidate) =>
				candidate.returnType.includes("Vec<(RootId, Option<u32>)>"),
			)?.body,
		).includes("!unique.insert(root.root_id)")
	) {
		failures.push(
			"workspace watch Rust request must deny unbounded, empty and duplicate root pulls",
		);
	}
	const executableWorkspaceRoot =
		workspaceRoot === undefined
			? undefined
			: stripRustCommentsAndLiterals(workspaceRoot);
	const rootIdDeserialize =
		executableWorkspaceRoot === undefined
			? undefined
			: extractRustFunctions(executableWorkspaceRoot, "deserialize")[0];
	if (
		rootIdDeserialize === undefined ||
		!compact(rootIdDeserialize.body).includes("Self::parse_v4_wire(&wire)")
	) {
		failures.push(
			"workspace watcher root ids must use canonical RFC4122 UUID v4 decoding",
		);
	}
	if (
		structBody("WorkspaceWatchPendingRoot") !==
			"root_id:RootId,generation:u32,rescan_required:bool," ||
		structBody("WorkspaceWatchSyncResult") !==
			"workspace_id:WorkspaceId,roots:Vec<WorkspaceWatchPendingRoot>," ||
		structBody("WorkspaceWatchWakeEvent") !== "workspace_id:WorkspaceId,"
	) {
		failures.push(
			"watcher IPC responses must expose only opaque ids, generations and rescan state",
		);
	}

	const executableCommands =
		commands === undefined ? undefined : stripRustCommentsAndLiterals(commands);
	const picker =
		executableCommands === undefined
			? undefined
			: extractRustFunctions(executableCommands, "workspace_pick_roots")[0];
	const watchSync =
		executableCommands === undefined
			? undefined
			: extractRustFunctions(executableCommands, "workspace_watch_sync")[0];
	const pickerBody = compact(picker?.body);
	const watchSyncBody = compact(watchSync?.body);
	if (
		commands === undefined ||
		!/\bWORKSPACE_WATCH_WAKE_EVENT\s*:\s*&str\s*=\s*"plain:\/\/workspace-watch-wake"\s*;/.test(
			commands,
		) ||
		picker === undefined ||
		[...pickerBody.matchAll(/\.emit_to\(/g)].length !== 1 ||
		!pickerBody.includes("EventTarget::webview_window(window_label.clone())") ||
		!pickerBody.includes("WorkspaceWatchWakeEvent::new(workspace_id)") ||
		/\.emit\(/.test(pickerBody)
	) {
		failures.push(
			"workspace watcher wake must be one window-targeted opaque workspaceId hint",
		);
	}
	if (
		watchSync === undefined ||
		!/\bpub\s*\(\s*crate\s*\)\s+async\s+fn\s+workspace_watch_sync\b/.test(
			executableCommands,
		) ||
		!watchSyncBody.includes(
			"service.watch_sync(window.label(),request.into_parts()?)",
		) ||
		!watchSyncBody.includes(".await")
	) {
		failures.push(
			"workspace_watch_sync must asynchronously route the decoded bounded request through the window service",
		);
	}
	const executableService =
		service === undefined ? undefined : stripRustCommentsAndLiterals(service);
	const serviceWatchSync =
		executableService === undefined
			? undefined
			: extractRustFunctions(executableService, "watch_sync").find(
					(candidate) =>
						compact(candidate.body).includes(
							"spawn_blocking(move||workspace.watch_sync(&roots))",
						),
				);
	const scanWatchRoot =
		executableService === undefined
			? undefined
			: extractRustFunctions(executableService, "scan_watch_root")[0];
	const removeRootWithWatcherCandidates =
		executableService === undefined
			? []
			: extractRustFunctions(executableService, "remove_root").filter(
					(candidate) =>
						compact(candidate.parameters) === "&self,root_id:RootId" &&
						compact(candidate.returnType) ===
							"->Result<WorkspaceSnapshot,CommandError>",
				);
	const removeRootWithWatcher =
		removeRootWithWatcherCandidates.length === 1
			? removeRootWithWatcherCandidates[0]
			: undefined;
	const removeRootWithWatcherBody = compact(removeRootWithWatcher?.body);
	let removeRootWatcherCursor = -1;
	const removeRootWatcherFragments = [
		"letmutation=lock(&self.mutation_gate)?",
		"letmutstate=lock(&self.state)?",
		"ensure_open(&state)?",
		"state.scope.remove(root_id)?",
		"letremoved_registration=state.watch_registrations.remove(&root_id)",
		"letsnapshot=state.scope.snapshot()",
		"letwatcher=lock(&self.watcher)?.clone()",
		"drop(state)",
		"drop(mutation)",
		"iflet(Some(watcher),Some(registration))=(watcher,removed_registration){watcher.revoke(registration);}",
		"Ok(snapshot)",
	];
	const removeRootWatcherLifecycle = removeRootWatcherFragments.every(
		(fragment) => {
			const index = removeRootWithWatcherBody.indexOf(
				fragment,
				removeRootWatcherCursor + 1,
			);
			if (index < 0 || removeRootWithWatcherBody.split(fragment).length !== 2) {
				return false;
			}
			removeRootWatcherCursor = index;
			return true;
		},
	);
	const finishPickerCandidates =
		executableService === undefined
			? []
			: extractRustFunctions(executableService, "finish_picker").filter(
					(candidate) =>
						compact(candidate.parameters) ===
							"self:&Arc<Self>,token:u64,mode:WorkspacePickRootsMode,selection:DirectoryPickerResult,watch_wake_sink:WorkspaceWatchWakeSink," &&
						compact(candidate.returnType) ===
							"->Result<WorkspacePickRootsResult,CommandError>",
				);
	const finishPicker =
		finishPickerCandidates.length === 1 ? finishPickerCandidates[0] : undefined;
	const finishPickerBody = compact(finishPicker?.body);
	const finishPickerRevokesDeltas =
		finishPicker !== undefined &&
		finishPickerBody.includes(
			"letmutrevoked_registrations=Vec::new();state.watch_registrations.retain(|root_id,registration|{letretained=active_root_ids.contains(root_id);if!retained{revoked_registrations.push(*registration);}retained});",
		) &&
		finishPickerBody.includes(
			"drop(state);drop(mutation);ifletSome(watcher)=watcher{forregistrationinrevoked_registrations{watcher.revoke(registration);}}Ok(result)",
		) &&
		!finishPickerBody.includes("watcher.retain(&active_registrations)");
	const watcherRevokeCandidates =
		executableWatcher === undefined
			? []
			: extractRustFunctions(executableWatcher, "revoke").filter(
					(candidate) =>
						compact(candidate.parameters) ===
							"&self,registration:WatchRegistration" &&
						compact(candidate.returnType) === "->bool",
				);
	const watcherRevoke =
		watcherRevokeCandidates.length === 1
			? watcherRevokeCandidates[0]
			: undefined;
	const watcherRevokeIsProduction =
		watcherRevoke !== undefined &&
		!/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(
			executableWatcher.slice(
				Math.max(0, watcherRevoke.start - 64),
				watcherRevoke.start,
			),
		);
	if (
		serviceWatchSync === undefined ||
		!compact(
			executableService.slice(
				Math.max(0, serviceWatchSync.start - 48),
				serviceWatchSync.start,
			),
		).includes("pubasync") ||
		!compact(scanWatchRoot?.body).includes(
			"Err(_)=>returnWatchScanOutcome::Failed",
		)
	) {
		failures.push(
			"watch sync and capability scans must stay off the invoke thread and preserve lease failures as rescans",
		);
	}
	if (
		removeRootWithWatcher === undefined ||
		!removeRootWatcherLifecycle ||
		[...removeRootWithWatcherBody.matchAll(/watcher\.revoke\(/g)].length !==
			1 ||
		!finishPickerRevokesDeltas ||
		!watcherRevokeIsProduction ||
		/watcher\.retain\s*\(\s*&active_registrations\s*\)/.test(executableService)
	) {
		failures.push(
			"root topology changes must revoke only their exact watcher epochs after releasing workspace locks",
		);
	}
	const executableLib =
		lib === undefined ? undefined : stripRustCommentsAndLiterals(lib);
	const runBody = compact(
		executableLib === undefined
			? undefined
			: extractRustFunctions(executableLib, "run")[0]?.body,
	);
	if (
		executableLib === undefined ||
		[
			...executableLib.matchAll(
				/\bworkspace\s*::\s*commands\s*::\s*workspace_watch_sync\b/g,
			),
		].length !== 1
	) {
		failures.push(
			"src-tauri/src/lib.rs must register workspace_watch_sync exactly once",
		);
	}
	if (
		!runBody.includes(".build(tauri::generate_context!())") ||
		!runBody.includes(".run(|app,event|") ||
		!runBody.includes(
			"ifmatches!(event,tauri::RunEvent::Resumed){app.state::<WorkspaceService>().mark_all_watchers_rescan();}",
		)
	) {
		failures.push(
			"Tauri resume must conservatively mark every window watcher for rescan",
		);
	}

	const contractsFile = watcherTypeScriptSource(contracts, "contracts.ts");
	const expectedInterfaces = new Map([
		[
			"WorkspaceWatchWakeEvent",
			[
				{
					kind: "property",
					name: "workspaceId",
					optional: false,
					readonly: true,
					type: "string",
				},
			],
		],
		[
			"WorkspaceWatchSyncRootRequest",
			[
				{
					kind: "property",
					name: "rootId",
					optional: false,
					readonly: true,
					type: "string",
				},
				{
					kind: "property",
					name: "acknowledgedGeneration",
					optional: false,
					readonly: true,
					type: "number|null",
				},
			],
		],
		[
			"WorkspaceWatchPendingRoot",
			[
				{
					kind: "property",
					name: "rootId",
					optional: false,
					readonly: true,
					type: "string",
				},
				{
					kind: "property",
					name: "generation",
					optional: false,
					readonly: true,
					type: "number",
				},
				{
					kind: "property",
					name: "rescanRequired",
					optional: false,
					readonly: true,
					type: "boolean",
				},
			],
		],
	]);
	if (
		[...expectedInterfaces].some(
			([name, expected]) =>
				JSON.stringify(watcherInterfaceShape(contractsFile, name)) !==
				JSON.stringify(expected),
		)
	) {
		failures.push(
			"TypeScript watcher wire contracts must remain path-free exact readonly shapes",
		);
	}
	const bridgeInterfaces =
		contractsFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === "PlainBridge",
		) ?? [];
	const workspaceWatchMembers =
		bridgeInterfaces[0]?.members.filter(
			(member) =>
				ts.isMethodSignature(member) &&
				typeScriptStaticName(member.name) === "workspaceWatch",
		) ?? [];
	const bridgeWatch = workspaceWatchMembers[0];
	const workspaceReconcileMembers =
		bridgeInterfaces[0]?.members.filter(
			(member) =>
				ts.isMethodSignature(member) &&
				typeScriptStaticName(member.name) === "workspaceReconcileWatchRoots",
		) ?? [];
	const bridgeReconcile = workspaceReconcileMembers[0];
	if (
		bridgeInterfaces.length !== 1 ||
		workspaceWatchMembers.length !== 1 ||
		workspaceReconcileMembers.length !== 1 ||
		bridgeWatch.parameters.length !== 2 ||
		compact(bridgeWatch.parameters[0].type?.getText(contractsFile)) !==
			"string" ||
		compact(bridgeWatch.parameters[1].type?.getText(contractsFile)) !==
			"()=>void" ||
		compact(bridgeWatch.type?.getText(contractsFile)) !== "Unlisten" ||
		bridgeReconcile.parameters.length !== 1 ||
		compact(bridgeReconcile.parameters[0].type?.getText(contractsFile)) !==
			"readonlystring[]" ||
		compact(bridgeReconcile.type?.getText(contractsFile)) !== "void"
	) {
		failures.push(
			"PlainBridge must expose exact local watcher authority and root-only watch contracts",
		);
	}

	const codecFile = watcherTypeScriptSource(codec, "workspace-codec.ts");
	const codecFunctions = (name) =>
		codecFile?.statements.filter(
			(statement) =>
				ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		) ?? [];
	const frozenRequest = codecFunctions("frozenWorkspaceWatchSyncRequest");
	const wakeDecoder = codecFunctions("decodeWorkspaceWatchWakeEvent");
	const syncDecoder = codecFunctions("decodeWorkspaceWatchSyncResult");
	const requestBody = watcherTypeScriptExecutableText(
		frozenRequest[0]?.body?.getText(codecFile),
	);
	const wakeBody = watcherTypeScriptExecutableText(
		wakeDecoder[0]?.body?.getText(codecFile),
	);
	const responseBody = watcherTypeScriptExecutableText(
		syncDecoder[0]?.body?.getText(codecFile),
	);
	if (
		codec === undefined ||
		!/\bconst\s+MAX_WORKSPACE_ROOTS\s*=\s*256\s*;/.test(codec) ||
		!/\bconst\s+MAX_WORKSPACE_WATCH_GENERATION\s*=\s*0xffff_ffff\s*;/.test(
			codec,
		) ||
		frozenRequest.length !== 1 ||
		!requestBody.includes(
			"ownArrayDataSnapshot(roots,1,MAX_WORKSPACE_ROOTS)",
		) ||
		!requestBody.includes(
			'hasExactKeys(snapshot,["rootId","acknowledgedGeneration"])',
		) ||
		!requestBody.includes("unique.has(snapshot.rootId)") ||
		!requestBody.includes("unique.add(snapshot.rootId)") ||
		!requestBody.includes("rejectProxyObject(arraySnapshot.value)")
	) {
		failures.push(
			"watch sync codec must freeze and bound one exact unique root acknowledgement request",
		);
	}
	if (
		wakeDecoder.length !== 1 ||
		!wakeBody.includes('hasExactKeys(snapshot,["workspaceId"])') ||
		!wakeBody.includes("rejectProxyObject(valueasobject)") ||
		!wakeBody.includes("Object.freeze({workspaceId:snapshot.workspaceId})")
	) {
		failures.push("watch wake decoder must accept only one opaque workspaceId");
	}
	if (
		syncDecoder.length !== 1 ||
		!/ownArrayDataSnapshot\(snapshot\.roots,0,request\.roots\.length,?\)/.test(
			responseBody,
		) ||
		!responseBody.includes(
			'hasExactKeys(root,["rootId","generation","rescanRequired"])',
		) ||
		!responseBody.includes("unique.has(requestedRoot.rootId)") ||
		!responseBody.includes(
			"root.generation<=requestedRoot.acknowledgedGeneration",
		) ||
		!responseBody.includes(
			"root.generation===MAX_WORKSPACE_WATCH_GENERATION",
		) ||
		!responseBody.includes("!saturatedReplay") ||
		!responseBody.includes("rejectProxyObject(valueasobject)")
	) {
		failures.push(
			"watch sync decoder must reject unsolicited, duplicate, stale or oversized pending roots",
		);
	}

	const managerFile = watcherTypeScriptSource(manager, "workspace-watcher.ts");
	const schedulePull = watcherClassMethod(
		managerFile,
		"PerBridgeWorkspaceWatcherManager",
		"#schedulePull",
	);
	const pull = watcherClassMethod(
		managerFile,
		"PerBridgeWorkspaceWatcherManager",
		"#pull",
	);
	const deliver = watcherClassMethod(
		managerFile,
		"PerBridgeWorkspaceWatcherManager",
		"#deliver",
	);
	const reconcileRoots = watcherClassArrowFunction(
		managerFile,
		"PerBridgeWorkspaceWatcherManager",
		"reconcileRoots",
	);
	const workspaceWatch = watcherClassArrowFunction(
		managerFile,
		"PerBridgeWorkspaceWatcherManager",
		"workspaceWatch",
	);
	const managerExecutable = watcherTypeScriptExecutableText(manager);
	const scheduleBody = watcherTypeScriptExecutableText(
		schedulePull?.body?.getText(managerFile),
	);
	const pullBody = watcherTypeScriptExecutableText(
		pull?.body?.getText(managerFile),
	);
	const deliverBody = watcherTypeScriptExecutableText(
		deliver?.body?.getText(managerFile),
	);
	const reconcileBody = watcherTypeScriptExecutableText(
		reconcileRoots?.body.getText(managerFile),
	);
	const workspaceWatchBody = watcherTypeScriptExecutableText(
		workspaceWatch?.body.getText(managerFile),
	);
	const revokeDelete = reconcileBody.indexOf("this.#roots.delete(rootId)");
	const revokeCancel = reconcileBody.indexOf("subscription.cancel()");
	const acknowledgementGuard = deliverBody.indexOf(
		"Array.from(state.subscriptions).every",
	);
	const acknowledgementWrite = deliverBody.indexOf(
		"state.acknowledgedGeneration=pending.generation",
	);
	if (
		manager === undefined ||
		!/\bconst\s+DEFAULT_POLL_INTERVAL_MS\s*=\s*2_000\s*;/.test(manager) ||
		!/\bconst\s+MAX_WORKSPACE_WATCH_GENERATION\s*=\s*0xffff_ffff\s*;/.test(
			manager,
		) ||
		/@tauri-apps\//.test(manager) ||
		!managerExecutable.includes(
			"readonly#onWake=(wake:WorkspaceWatchWakeEvent):void=>",
		) ||
		!managerExecutable.includes(
			"#authorizedRoots:ReadonlySet<string>=newSet()",
		) ||
		reconcileRoots === undefined ||
		!reconcileBody.includes("constauthorizedRoots=newSet<string>()") ||
		!reconcileBody.includes(
			'if(typeofrootId!=="string"||authorizedRoots.has(rootId)){thrownewTypeError("The workspace watcher root set is invalid.");}',
		) ||
		!reconcileBody.includes("this.#authorizedRoots=authorizedRoots") ||
		revokeDelete < 0 ||
		revokeCancel <= revokeDelete ||
		!reconcileBody.includes(
			"if(this.#roots.size===0){this.#pullRequested=false;this.#clearScheduledPull();voidthis.#detachWakeListener();}",
		) ||
		!reconcileBody.includes(
			"elseif(revokedStates.length>0){this.#schedulePull(true);}",
		) ||
		workspaceWatch === undefined ||
		!workspaceWatchBody.includes(
			"if(!this.#authorizedRoots.has(rootId)){return()=>{};}",
		) ||
		!managerExecutable.includes("this.#schedulePull(true)") ||
		[...managerExecutable.matchAll(/this\.#transport\.sync\(/g)].length !== 1 ||
		schedulePull === undefined ||
		!scheduleBody.includes(
			"if(this.#syncInFlight){this.#pullRequested||=urgent;return;}",
		) ||
		!scheduleBody.includes("urgent?0:this.#pollIntervalMs") ||
		pull === undefined ||
		!pullBody.includes("this.#syncInFlight=true") ||
		!pullBody.includes("awaitthis.#transport.sync(request)") ||
		!pullBody.includes("finally{this.#syncInFlight=false") ||
		!pullBody.includes("this.#schedulePull(") ||
		deliver === undefined ||
		!deliverBody.includes("constsaturatedReplay=") ||
		!deliverBody.includes(
			'returnsaturatedReplay?"retry-later":"acknowledged"',
		) ||
		acknowledgementGuard < 0 ||
		acknowledgementWrite <= acknowledgementGuard
	) {
		failures.push(
			"watch manager must serialize wake/timer pulls and acknowledge only after listener delivery",
		);
	}

	const compactNative = watcherTypeScriptExecutableText(native);
	if (
		native === undefined ||
		!compactNative.includes(
			"listen<unknown>(WORKSPACE_WATCH_WAKE_EVENT,(event)=>listener(decodeWorkspaceWatchWakeEvent(event.payload)),)",
		) ||
		!compactNative.includes(
			'awaitinvoke<unknown>("workspace_watch_sync",{request})',
		) ||
		!compactNative.includes("workspaceWatch:workspaceWatcher.workspaceWatch") ||
		!compactNative.includes(
			"workspaceReconcileWatchRoots:workspaceWatcher.reconcileRoots",
		) ||
		[...compactNative.matchAll(/workspaceWatcher\.reconcileRoots/g)].length !==
			1 ||
		compactNative.includes("workspace_reconcile_watch_roots")
	) {
		failures.push(
			"native bridge must keep topology decoding side-effect free and route local watcher authority through one manager",
		);
	}
	const browserFile = watcherTypeScriptSource(browserMock, "browser-mock.ts");
	let browserManagerCreations = 0;
	let browserWatchRoutes = 0;
	let browserReconcileRoutes = 0;
	let browserReconcileCalls = 0;
	if (browserFile !== undefined) {
		function visitBrowserWatcher(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "createWorkspaceWatcherManager" &&
				node.arguments.length === 1 &&
				ts.isIdentifier(node.arguments[0]) &&
				node.arguments[0].text === "workspaceWatchTransport"
			) {
				browserManagerCreations += 1;
			}
			if (
				ts.isPropertyAssignment(node) &&
				typeScriptStaticName(node.name) === "workspaceWatch" &&
				ts.isPropertyAccessExpression(node.initializer) &&
				ts.isIdentifier(node.initializer.expression) &&
				node.initializer.expression.text === "workspaceWatcher" &&
				node.initializer.name.text === "workspaceWatch"
			) {
				browserWatchRoutes += 1;
			}
			if (
				ts.isPropertyAssignment(node) &&
				typeScriptStaticName(node.name) === "workspaceReconcileWatchRoots" &&
				ts.isPropertyAccessExpression(node.initializer) &&
				ts.isIdentifier(node.initializer.expression) &&
				node.initializer.expression.text === "workspaceWatcher" &&
				node.initializer.name.text === "reconcileRoots"
			) {
				browserReconcileRoutes += 1;
			}
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isIdentifier(node.expression.expression) &&
				node.expression.expression.text === "workspaceWatcher" &&
				node.expression.name.text === "reconcileRoots"
			) {
				browserReconcileCalls += 1;
			}
			ts.forEachChild(node, visitBrowserWatcher);
		}
		visitBrowserWatcher(browserFile);
	}
	if (
		browserManagerCreations !== 1 ||
		browserWatchRoutes !== 1 ||
		browserReconcileRoutes !== 1 ||
		browserReconcileCalls !== 0 ||
		browserMock?.includes("workspace_reconcile_watch_roots")
	) {
		failures.push(
			"browser mock must use one side-effect-free local authority route and the same bounded watcher manager",
		);
	}
	failures.push(...validateWatcherProviderRoute(provider));

	const excludedSurface = watcherForbiddenAppSurface(appSources);
	if (excludedSurface !== undefined) {
		failures.push(excludedSurface);
	}
	return [...new Set(failures)];
}

function findMatchingDelimiter(source, openIndex, open, close) {
	let depth = 1;
	for (let index = openIndex + 1; index < source.length; index += 1) {
		if (source[index] === open) {
			depth += 1;
		} else if (source[index] === close) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return undefined;
}

function extractWorkspaceCopyCommands(source) {
	const commands = [];
	const definitionPattern =
		/#\s*\[\s*tauri\s*::\s*command\s*\]\s*pub\s*\(\s*crate\s*\)\s+async\s+fn\s+workspace_copy\s*\(/g;
	for (const match of source.matchAll(definitionPattern)) {
		const parameterOpen = match.index + match[0].lastIndexOf("(");
		const parameterClose = findMatchingDelimiter(
			source,
			parameterOpen,
			"(",
			")",
		);
		if (parameterClose === undefined) {
			commands.push({ parameters: "", returnType: "", body: "" });
			continue;
		}
		const bodyOpen = source.indexOf("{", parameterClose + 1);
		if (bodyOpen < 0) {
			commands.push({
				parameters: source.slice(parameterOpen + 1, parameterClose),
				returnType: source.slice(parameterClose + 1),
				body: "",
			});
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		commands.push({
			parameters: source.slice(parameterOpen + 1, parameterClose),
			returnType: source.slice(parameterClose + 1, bodyOpen),
			body: source.slice(
				bodyOpen + 1,
				bodyClose === undefined ? source.length : bodyClose,
			),
		});
	}
	return commands;
}

export function validateWorkspaceCopyCommandRegistration(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	if (commandsSource === undefined) {
		failures.push("workspace copy boundary requires workspace/commands.rs");
	} else {
		const executableCommands = stripRustCommentsAndLiterals(commandsSource);
		const commands = extractWorkspaceCopyCommands(executableCommands);
		if (commands.length !== 1) {
			failures.push(
				"workspace/commands.rs must define exactly one audited workspace_copy Tauri command",
			);
		} else {
			const [command] = commands;
			const requestParameters = [
				...command.parameters.matchAll(
					/(?:^|,)\s*request\s*:\s*WorkspaceCopyRequest\s*(?=,|$)/g,
				),
			];
			if (
				requestParameters.length !== 1 ||
				!/^\s*->\s*Result\s*<\s*\(\s*\)\s*,\s*CommandError\s*>\s*$/.test(
					command.returnType,
				)
			) {
				failures.push(
					"workspace_copy must accept request: WorkspaceCopyRequest and return Result<(), CommandError>",
				);
			}
			const routedCalls = [
				...command.body.matchAll(
					/(?<![:A-Za-z0-9_])WorkspaceService\s*::\s*copy_entry\s*\(/g,
				),
			];
			if (routedCalls.length !== 1) {
				failures.push(
					"workspace_copy must route exactly once through WorkspaceService::copy_entry",
				);
			}
		}
	}

	if (libSource === undefined) {
		failures.push("workspace copy boundary requires src-tauri/src/lib.rs");
	} else {
		const executableLib = stripRustCommentsAndLiterals(libSource);
		const commandPath = /\bworkspace\s*::\s*commands\s*::\s*workspace_copy\b/g;
		const registrations = [...executableLib.matchAll(commandPath)];
		const handlerBodies = [
			...executableLib.matchAll(
				/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
			),
		];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			/\bworkspace\s*::\s*commands\s*::\s*workspace_copy\b/.test(
				handlerBodies[0][1],
			);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				"src-tauri/src/lib.rs must register workspace::commands::workspace_copy exactly once in generate_handler",
			);
		}
	}

	return failures;
}

function extractWorkspaceMoveCommands(source) {
	const commands = [];
	const definitionPattern =
		/#\s*\[\s*tauri\s*::\s*command\s*\]\s*pub\s*\(\s*crate\s*\)\s+async\s+fn\s+workspace_move\s*\(/g;
	for (const match of source.matchAll(definitionPattern)) {
		const parameterOpen = match.index + match[0].lastIndexOf("(");
		const parameterClose = findMatchingDelimiter(
			source,
			parameterOpen,
			"(",
			")",
		);
		if (parameterClose === undefined) {
			commands.push({ parameters: "", returnType: "", body: "" });
			continue;
		}
		const bodyOpen = source.indexOf("{", parameterClose + 1);
		if (bodyOpen < 0) {
			commands.push({
				parameters: source.slice(parameterOpen + 1, parameterClose),
				returnType: source.slice(parameterClose + 1),
				body: "",
			});
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		commands.push({
			parameters: source.slice(parameterOpen + 1, parameterClose),
			returnType: source.slice(parameterClose + 1, bodyOpen),
			body: source.slice(
				bodyOpen + 1,
				bodyClose === undefined ? source.length : bodyClose,
			),
		});
	}
	return commands;
}

export function validateWorkspaceMoveCommandRegistration(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	if (commandsSource === undefined) {
		failures.push("workspace move boundary requires workspace/commands.rs");
	} else {
		const executableCommands = stripRustCommentsAndLiterals(commandsSource);
		const commands = extractWorkspaceMoveCommands(executableCommands);
		if (commands.length !== 1) {
			failures.push(
				"workspace/commands.rs must define exactly one audited workspace_move Tauri command",
			);
		} else {
			const [command] = commands;
			const requestParameters = [
				...command.parameters.matchAll(
					/(?:^|,)\s*request\s*:\s*WorkspaceMoveRequest\s*(?=,|$)/g,
				),
			];
			if (
				requestParameters.length !== 1 ||
				!/^\s*->\s*Result\s*<\s*WorkspaceMoveResult\s*,\s*CommandError\s*>\s*$/.test(
					command.returnType,
				)
			) {
				failures.push(
					"workspace_move must accept request: WorkspaceMoveRequest and return Result<WorkspaceMoveResult, CommandError>",
				);
			}
			const routedCalls = [
				...command.body.matchAll(
					/(?<![:A-Za-z0-9_])WorkspaceService\s*::\s*move_entry\s*\(/g,
				),
			];
			if (routedCalls.length !== 1) {
				failures.push(
					"workspace_move must route exactly once through WorkspaceService::move_entry",
				);
			}
		}
	}

	if (libSource === undefined) {
		failures.push("workspace move boundary requires src-tauri/src/lib.rs");
	} else {
		const executableLib = stripRustCommentsAndLiterals(libSource);
		const commandPath = /\bworkspace\s*::\s*commands\s*::\s*workspace_move\b/g;
		const registrations = [...executableLib.matchAll(commandPath)];
		const handlerBodies = [
			...executableLib.matchAll(
				/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
			),
		];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			/\bworkspace\s*::\s*commands\s*::\s*workspace_move\b/.test(
				handlerBodies[0][1],
			);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				"src-tauri/src/lib.rs must register workspace::commands::workspace_move exactly once in generate_handler",
			);
		}
	}

	return failures;
}

const WORKSPACE_DELETE_COMMAND_CONTRACTS = Object.freeze([
	Object.freeze({
		command: "workspace_prepare_delete",
		request: "WorkspacePrepareDeleteRequest",
		result: "WorkspaceDeleteBatchPlan",
		service: "prepare_delete",
		adapter: "prepare",
	}),
	Object.freeze({
		command: "workspace_cancel_delete",
		request: "WorkspaceDeleteBatchRequest",
		result: "()",
		service: "cancel_delete",
		adapter: "token",
	}),
	Object.freeze({
		command: "workspace_begin_delete",
		request: "WorkspaceDeleteBatchRequest",
		result: "()",
		service: "begin_delete",
		adapter: "token",
	}),
	Object.freeze({
		command: "workspace_commit_delete_entry",
		request: "WorkspaceCommitDeleteEntryRequest",
		result: "WorkspaceDeleteResult",
		service: "commit_delete_entry",
		adapter: "commit",
	}),
]);

function extractAuditedTauriCommands(source, commandName) {
	const commands = [];
	const definitionPattern = new RegExp(
		`#\\s*\\[\\s*tauri\\s*::\\s*command\\s*\\]\\s*pub\\s*\\(\\s*crate\\s*\\)\\s+async\\s+fn\\s+${escapeRegularExpression(commandName)}\\s*\\(`,
		"g",
	);
	for (const match of source.matchAll(definitionPattern)) {
		const parameterOpen = match.index + match[0].lastIndexOf("(");
		const parameterClose = findMatchingDelimiter(
			source,
			parameterOpen,
			"(",
			")",
		);
		if (parameterClose === undefined) {
			commands.push({ parameters: "", returnType: "", body: "" });
			continue;
		}
		const bodyOpen = source.indexOf("{", parameterClose + 1);
		const bodyClose =
			bodyOpen < 0
				? undefined
				: findMatchingDelimiter(source, bodyOpen, "{", "}");
		commands.push({
			parameters: source.slice(parameterOpen + 1, parameterClose),
			returnType:
				bodyOpen < 0
					? source.slice(parameterClose + 1)
					: source.slice(parameterClose + 1, bodyOpen),
			body:
				bodyOpen < 0
					? ""
					: source.slice(
							bodyOpen + 1,
							bodyClose === undefined ? source.length : bodyClose,
						),
		});
	}
	return commands;
}

function workspaceDeleteCommandBodyIsExact(body, contract) {
	const normalized = body.replaceAll(/\s+/g, "").replace(/;$/, "");
	if (contract.adapter === "prepare") {
		return (
			normalized ===
			`service.${contract.service}(window.label(),request.into_parts()?).await`
		);
	}
	if (contract.adapter === "token") {
		return (
			normalized ===
			`service.${contract.service}(window.label(),request.confirmation_id()).await`
		);
	}
	return (
		normalized ===
		`let(confirmation_id,entry_id,root_id,relative_path,recursive)=request.into_parts()?;service.${contract.service}(window.label(),confirmation_id,entry_id,root_id,relative_path,recursive,).await`
	);
}

/**
 * Freezes the four-step delete protocol at the Tauri adapter. The receipt is
 * deliberately not represented here: commands can route only owned wire DTOs
 * into one WorkspaceService method each.
 */
export function validateWorkspaceDeleteCommandRegistration(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	if (commandsSource === undefined) {
		return ["workspace delete boundary requires workspace/commands.rs"];
	}
	const executableCommands = stripRustCommentsAndLiterals(commandsSource);
	for (const contract of WORKSPACE_DELETE_COMMAND_CONTRACTS) {
		const commands = extractAuditedTauriCommands(
			executableCommands,
			contract.command,
		);
		if (commands.length !== 1) {
			failures.push(
				`workspace/commands.rs must define exactly one audited ${contract.command} Tauri command`,
			);
			continue;
		}
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		const expectedParameters = `window:WebviewWindow,service:State<'_,WorkspaceService>,request:${contract.request}`;
		const expectedReturn = `->Result<${contract.result},CommandError>`;
		if (
			normalizedParameters !== expectedParameters ||
			command.returnType.replaceAll(/\s+/g, "") !== expectedReturn
		) {
			failures.push(
				`${contract.command} must accept request: ${contract.request} and return Result<${contract.result}, CommandError>`,
			);
		}

		const routePattern = new RegExp(
			`(?<![:A-Za-z0-9_])(?:WorkspaceService\\s*::\\s*|service\\s*\\.\\s*)${escapeRegularExpression(contract.service)}\\s*\\(`,
			"g",
		);
		if ([...command.body.matchAll(routePattern)].length !== 1) {
			failures.push(
				`${contract.command} must route exactly once through WorkspaceService::${contract.service}`,
			);
		}
		if (!workspaceDeleteCommandBodyIsExact(command.body, contract)) {
			failures.push(
				`${contract.command} must contain only its audited DTO decode and WorkspaceService::${contract.service} route`,
			);
		}
	}

	if (libSource === undefined) {
		failures.push("workspace delete boundary requires src-tauri/src/lib.rs");
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	for (const contract of WORKSPACE_DELETE_COMMAND_CONTRACTS) {
		const commandPath = new RegExp(
			`\\bworkspace\\s*::\\s*commands\\s*::\\s*${escapeRegularExpression(contract.command)}\\b`,
			"g",
		);
		const registrations = [...executableLib.matchAll(commandPath)];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			new RegExp(
				`\\bworkspace\\s*::\\s*commands\\s*::\\s*${escapeRegularExpression(contract.command)}\\b`,
			).test(handlerBodies[0][1]);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				`src-tauri/src/lib.rs must register workspace::commands::${contract.command} exactly once in generate_handler`,
			);
		}
	}

	return failures;
}

/**
 * Mirrors the workspace copy/move/delete command-registration validators for
 * the search domain's single command: `search/commands.rs` must define
 * exactly one audited `workspace_search_files` Tauri command whose body does
 * nothing but decode its request and route once through
 * `WorkspaceService::search_files`, and `lib.rs` must register it exactly
 * once. There is no closed-set-of-many check here because this slice
 * registers exactly one search command.
 */
export function validateSearchCommandRegistration(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/search/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	if (commandsSource === undefined) {
		return ["search command boundary requires search/commands.rs"];
	}
	const executableCommands = stripRustCommentsAndLiterals(commandsSource);
	const commands = extractAuditedTauriCommands(
		executableCommands,
		"workspace_search_files",
	);
	if (commands.length !== 1) {
		failures.push(
			"search/commands.rs must define exactly one audited workspace_search_files Tauri command",
		);
	} else {
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		const expectedParameters =
			"window:WebviewWindow,service:State<'_,WorkspaceService>,request:WorkspaceSearchFilesRequest";
		const expectedReturn = "->Result<WorkspaceSearchFilesResult,CommandError>";
		if (
			normalizedParameters !== expectedParameters ||
			command.returnType.replaceAll(/\s+/g, "") !== expectedReturn
		) {
			failures.push(
				"workspace_search_files must accept request: WorkspaceSearchFilesRequest and return Result<WorkspaceSearchFilesResult, CommandError>",
			);
		}
		const normalizedBody = command.body
			.replaceAll(/\s+/g, "")
			.replace(/;$/, "");
		if (
			normalizedBody !==
			"letquery=request.into_parts()?;WorkspaceService::search_files(service.inner(),window.label(),query).await"
		) {
			failures.push(
				"workspace_search_files must contain only its DTO decode and a single WorkspaceService::search_files route",
			);
		}
	}

	if (libSource === undefined) {
		failures.push("search command boundary requires src-tauri/src/lib.rs");
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	const commandPath =
		/\bsearch\s*::\s*commands\s*::\s*workspace_search_files\b/g;
	const registrations = [...executableLib.matchAll(commandPath)];
	const registeredInHandler =
		handlerBodies.length === 1 &&
		/\bsearch\s*::\s*commands\s*::\s*workspace_search_files\b/.test(
			handlerBodies[0][1],
		);
	if (registrations.length !== 1 || !registeredInHandler) {
		failures.push(
			"src-tauri/src/lib.rs must register search::commands::workspace_search_files exactly once in generate_handler",
		);
	}

	return failures;
}

/**
 * Locks the three F040 S3 streaming text search commands
 * (`workspace_search_text_start/poll/cancel`) to their audited exact
 * signatures, bodies and single `generate_handler!` registration — the same
 * exact-body-pinning technique `validateSearchCommandRegistration` already
 * uses for `workspace_search_files`, so a silent edit that bypasses the DTO
 * decode or routes to something other than the one audited
 * `WorkspaceService` method fails this check rather than only being caught
 * by chance in review.
 */
export function validateSearchTextCommandRegistration(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/search/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	if (commandsSource === undefined) {
		return ["search text command boundary requires search/commands.rs"];
	}
	const executableCommands = stripRustCommentsAndLiterals(commandsSource);

	const expected = [
		{
			name: "workspace_search_text_start",
			parameters:
				"window:WebviewWindow,service:State<'_,WorkspaceService>,request:WorkspaceSearchTextStartRequest",
			returnType: "->Result<WorkspaceSearchTextStartResult,CommandError>",
			body: "letquery=request.into_parts()?;letapp=window.app_handle().clone();letwindow_label=window.label().to_owned();letwake_sink:Arc<dynFn(SearchId)+Send+Sync>=Arc::new(move|search_id:SearchId|{let_=app.emit_to(EventTarget::webview_window(window_label.clone()),WORKSPACE_SEARCH_TEXT_WAKE_EVENT,WorkspaceSearchTextWakeEvent::new(search_id),);});service.inner().search_text_start(window.label(),query,wake_sink)",
		},
		{
			name: "workspace_search_text_poll",
			parameters:
				"window:WebviewWindow,service:State<'_,WorkspaceService>,request:WorkspaceSearchTextPollRequest",
			returnType: "->Result<WorkspaceSearchTextPollResult,CommandError>",
			body: "let(search_id,cursor)=request.into_parts()?;service.inner().search_text_poll(window.label(),search_id,cursor)",
		},
		{
			name: "workspace_search_text_cancel",
			parameters:
				"window:WebviewWindow,service:State<'_,WorkspaceService>,request:WorkspaceSearchTextCancelRequest",
			returnType: "->Result<(),CommandError>",
			body: "service.inner().search_text_cancel(window.label(),request.search_id())",
		},
	];

	for (const { name, parameters, returnType, body } of expected) {
		const commands = extractAuditedTauriCommands(executableCommands, name);
		if (commands.length !== 1) {
			failures.push(
				`search/commands.rs must define exactly one audited ${name} Tauri command`,
			);
			continue;
		}
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		if (
			normalizedParameters !== parameters ||
			command.returnType.replaceAll(/\s+/g, "") !== returnType
		) {
			failures.push(
				`${name} must accept request: its own DTO and return the audited Result type`,
			);
		}
		const normalizedBody = command.body
			.replaceAll(/\s+/g, "")
			.replace(/;$/, "");
		if (normalizedBody !== body) {
			failures.push(
				`${name} must contain only its audited DTO decode and single WorkspaceService route`,
			);
		}
	}

	if (libSource === undefined) {
		failures.push("search text command boundary requires src-tauri/src/lib.rs");
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	for (const { name } of expected) {
		const commandPath = new RegExp(
			`\\bsearch\\s*::\\s*commands\\s*::\\s*${name}\\b`,
			"g",
		);
		const registrations = [...executableLib.matchAll(commandPath)];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			new RegExp(`\\bsearch\\s*::\\s*commands\\s*::\\s*${name}\\b`).test(
				handlerBodies[0][1],
			);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				`src-tauri/src/lib.rs must register search::commands::${name} exactly once in generate_handler`,
			);
		}
	}

	return failures;
}

/**
 * Locks `search/file_search.rs`'s traversal budget constants to their
 * audited exact values, mirroring `WORKSPACE_COPY_LIMITS`/
 * `WORKSPACE_DELETE_LIMITS`: a silent widening of either constant must fail
 * this check rather than quietly changing the search domain's resource
 * ceiling.
 */
export function validateSearchFileBudgetConstants(rustSources) {
	const fileSearchSource = findRustSource(
		rustSources,
		"src-tauri/src/search/file_search.rs",
	);
	if (fileSearchSource === undefined) {
		return ["search budget boundary requires search/file_search.rs"];
	}
	const executableSource = stripRustCommentsAndLiterals(fileSearchSource);
	const failures = [];
	for (const [name, value, integerType] of SEARCH_FILE_LIMITS) {
		const declarations = findWorkspaceCopyLimitDeclarations(
			executableSource,
			name,
			integerType,
		);
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value
		) {
			failures.push(
				`search/file_search.rs must define exactly one ${name}: ${integerType} = ${value}`,
			);
		}
	}
	return failures;
}

const SEARCH_TEXT_LIMITS = Object.freeze([
	[
		"SEARCH_BATCH_QUEUE_CAPACITY",
		512,
		"usize",
		"src-tauri/src/search/text_search.rs",
	],
	[
		"MAX_TEXT_SEARCH_RESULTS_HARD_CAP",
		20_000,
		"u32",
		"src-tauri/src/search/dto.rs",
	],
]);

/**
 * Locks the F040 S3 streaming text search budget constants (the batch
 * backpressure queue capacity and the results hard cap) to their audited
 * exact values, plus the window-scoped idle-search TTL in
 * `workspace/service.rs` — mirroring `validateSearchFileBudgetConstants`'s
 * rationale but also covering `SEARCH_TASK_IDLE_TTL`, which is a
 * `Duration::from_secs(...)` call rather than a plain integer literal and so
 * cannot go through `evaluateSmallRustIntegerExpression`.
 */
export function validateSearchTextBudgetConstants(rustSources) {
	const failures = [];
	for (const [name, value, integerType, path] of SEARCH_TEXT_LIMITS) {
		const fileSource = findRustSource(rustSources, path);
		if (fileSource === undefined) {
			failures.push(`search text budget boundary requires ${path}`);
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(fileSource);
		const declarations = findWorkspaceCopyLimitDeclarations(
			executableSource,
			name,
			integerType,
		);
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value
		) {
			failures.push(
				`${path} must define exactly one ${name}: ${integerType} = ${value}`,
			);
		}
	}

	const serviceSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/service.rs",
	);
	if (serviceSource === undefined) {
		failures.push("search text budget boundary requires workspace/service.rs");
		return failures;
	}
	const executableService = stripRustCommentsAndLiterals(serviceSource);
	const ttlPattern =
		/^const\s+SEARCH_TASK_IDLE_TTL\s*:\s*Duration\s*=\s*Duration::from_secs\(\s*120\s*\)\s*;/m;
	if (!ttlPattern.test(executableService)) {
		failures.push(
			"workspace/service.rs must define exactly one SEARCH_TASK_IDLE_TTL: Duration = Duration::from_secs(120)",
		);
	}

	return failures;
}

const FORBIDDEN_SPAWN_BYPASS_DEPENDENCIES = Object.freeze([
	"async-process",
	"duct",
	"execute",
	"run_script",
	"shell-words",
	"subprocess",
	"xshell",
]);

/**
 * ADR `docs/decisions/0003-native-git-and-generic-dap.md`'s "系统 Git CLI
 * 为唯一写操作权威" / "不混用 git2/gix" decision, upgraded from a doc-only
 * convention to a machine guard (`F080` S0): none of these libgit2/gix
 * bindings may appear as a Cargo dependency, under any rename, full stop —
 * not even as a read-only cache, which the ADR explicitly gates behind a
 * future benchmark-proven need, never an ambient dependency.
 */
const FORBIDDEN_GIT_LIBRARY_DEPENDENCIES = Object.freeze([
	"git2",
	"gix",
	"libgit2-sys",
]);

/**
 * The Git domain's sole audited `std::process::Command` wrapper (`F080` S0
 * of `docs/research/2026-07-25-core-git.md`) — every other file under
 * `src-tauri/src/git/` remains mechanically forbidden from naming
 * `std::process::Command` at all, exactly like every file under
 * `src-tauri/src/terminal/` always has been. Chosen as a single fixed path
 * (rather than e.g. any file matching `exec*.rs`) so the allowlist is one
 * unambiguous, greppable line, not a pattern someone could widen by
 * dropping in a second file that happens to match.
 */
const GIT_EXEC_WRAPPER_PATH = "src-tauri/src/git/exec.rs";

/**
 * The `debug` domain's own sole audited `std::process::Command` wrapper
 * (`F100` S0 of `docs/research/2026-07-28-generic-dap.md`) — the second (and,
 * as of this slice, only other) legitimate process-spawning file in this
 * codebase besides [`GIT_EXEC_WRAPPER_PATH`]. Separately and more precisely
 * locked down by [`validateDebugAdapterSpawnBoundary`] (trust gate first) and
 * [`validateDebugSpawnConstructionShape`] (fixed `Command::new(&descriptor.command)
 * .args(&descriptor.args)` shape, no shell interpreter, no `format!`) —
 * this constant only feeds the broad cross-domain "no capability-based
 * deletion bypass via a raw process/shell spawn" sweep inside
 * `validateWorkspaceMoveBoundary`, exactly like `GIT_EXEC_WRAPPER_PATH`
 * already does for the git domain.
 */
const DEBUG_EXEC_WRAPPER_PATH = "src-tauri/src/debug/exec.rs";

/**
 * `F100` S1's own staged-atomic-write persistence file for the first-run
 * confirmation gate (`src-tauri/src/debug/confirm_store.rs`) — added to
 * [`stageCleanupCallsAreExact`]'s per-file allowlist alongside
 * `backup/store.rs`/`trust/store.rs`, whose identical `Stage`-drop-cleanup
 * shape this file deliberately mirrors (see that file's own module doc for
 * why the duplication is intentional, not an oversight).
 */
const DEBUG_CONFIRM_STORE_PATH = "src-tauri/src/debug/confirm_store.rs";

const GIT_DOMAIN_SOURCE_PATTERN = /^src-tauri\/src\/git\/.*\.rs$/;

/**
 * Program names [`GIT_EXEC_WRAPPER_PATH`] must never pass to
 * `Command::new`, even though it is otherwise exempt from the
 * `std::process::Command` ban below: the one-file allowlist only closes
 * half the bypass a hostile edit could exploit — nothing else would stop
 * that same file from quietly becoming `Command::new("sh").arg("-c", ...)`
 * instead. Deliberately a small, explicit denylist of common shell
 * interpreters (not a "must equal exactly `git`" allowlist coupled to a
 * single literal-match regex) because the wrapper legitimately needs
 * `-c key=value` git-config-override arguments — a shell "-c" would be the
 * actual bypass to catch, not the token "-c" itself.
 */
const GIT_EXEC_SHELL_INTERPRETER_PATTERN =
	/Command::new\s*\(\s*"(?:sh|bash|zsh|dash|ksh|csh|tcsh|cmd|cmd\.exe|powershell|powershell\.exe|pwsh)"\s*\)/;

const TERMINAL_BUDGET_LIMITS = Object.freeze([
	[
		"MAX_TERMINAL_SESSIONS_PER_WINDOW",
		16,
		"usize",
		"src-tauri/src/terminal/mod.rs",
	],
	[
		"TERMINAL_FLOW_HIGH_WATER_MARK",
		100_000,
		"usize",
		"src-tauri/src/terminal/flow.rs",
	],
	[
		"TERMINAL_FLOW_LOW_WATER_MARK",
		5_000,
		"usize",
		"src-tauri/src/terminal/flow.rs",
	],
	[
		"TERMINAL_READ_BUFFER_BYTES",
		8192,
		"usize",
		"src-tauri/src/terminal/service.rs",
	],
	[
		"TERMINAL_VT_MAX_SCROLLBACK_LINES",
		10_000,
		"usize",
		"src-tauri/src/terminal/vt.rs",
	],
]);

const TERMINAL_ENV_PASSTHROUGH_NAMES_LOCK = Object.freeze([
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"TMPDIR",
]);

const SPAWN_GUARDED_DOMAIN_PATTERN =
	/^src-tauri\/src\/(?:terminal|git)\/.*\.rs$/;

/**
 * Comments-only variant of `stripRustCommentsAndLiterals`: masks `//`/`/* *​/`
 * comments but leaves string/char literal *contents* intact. Used only by
 * the spawn-guard's `.arg("-c")` detection below, which — unlike every other
 * check in this file that calls `stripRustCommentsAndLiterals` — genuinely
 * needs to see the literal text inside a string, not just avoid false
 * positives from an identifier that happens to appear inside a comment or
 * doc string. Reusing the full comment-and-literal stripper here would
 * blank out the very `"-c"` text this check exists to find.
 */
function stripRustCommentsOnly(source) {
	const output = source.split("");
	const mask = (start, end) => {
		for (let index = start; index < end; index += 1) {
			if (output[index] !== "\n" && output[index] !== "\r") {
				output[index] = " ";
			}
		}
	};
	let index = 0;
	while (index < source.length) {
		if (source.startsWith("//", index)) {
			const end = source.indexOf("\n", index + 2);
			const boundary = end < 0 ? source.length : end;
			mask(index, boundary);
			index = boundary;
			continue;
		}
		if (source.startsWith("/*", index)) {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < source.length && depth > 0) {
				if (source.startsWith("/*", cursor)) {
					depth += 1;
					cursor += 2;
				} else if (source.startsWith("*/", cursor)) {
					depth -= 1;
					cursor += 2;
				} else {
					cursor += 1;
				}
			}
			mask(index, cursor);
			index = cursor;
			continue;
		}
		index += 1;
	}
	return output.join("");
}

/**
 * Locks the terminal *and* `git::` domains' subprocess-spawning contracts —
 * `docs/research/2026-07-24-pty-terminal.md` for the former,
 * `docs/research/2026-07-25-core-git.md`/ADR 0003 for the latter. Kept as
 * one function (not split into a `validateGitRustBoundary` sibling) because
 * the two domains share the exact same `SPAWN_GUARDED_DOMAIN_PATTERN`
 * sweep and the same two mechanical red flags below; splitting it would
 * duplicate that sweep for a cosmetic naming win. `portable-pty` is pinned
 * to an exact version for the terminal domain; every non-test source file
 * under both guarded domains is forbidden from using `std::process::Command`
 * directly — except [`GIT_EXEC_WRAPPER_PATH`], the git domain's own single
 * audited wrapper (see that constant's doc) — or invoking a shell with a
 * `-c`/string-interpreter argument, the same two mechanical red flags the
 * delete domain's own `FORBIDDEN_DELETE_BYPASS_DEPENDENCIES` precedent
 * guards against for a different bypass shape. Also locks
 * [`FORBIDDEN_GIT_LIBRARY_DEPENDENCIES`] (git2/gix/libgit2-sys) and the
 * terminal domain's flow-control/session-limit/env-allowlist constants
 * exactly, mirroring `validateSearchTextBudgetConstants`'s own precedent
 * for a different domain's streaming protocol.
 */
export function validateTerminalRustBoundary(
	rustSources,
	cargoSource,
	cargoDependencies = [],
) {
	const failures = [];

	if (!cargoDependencyDeclaration("portable-pty", "=0.9.0").test(cargoSource)) {
		failures.push("Cargo.toml must pin portable-pty to =0.9.0");
	}
	const portablePtyDependencies = cargoDependencies.filter(
		({ name }) => name === "portable-pty",
	);
	const hasExactPortablePty = portablePtyDependencies.some(
		(candidate) =>
			candidate.req === "=0.9.0" &&
			candidate.kind === null &&
			candidate.rename === null &&
			candidate.target === null &&
			candidate.optional === false,
	);
	if (!hasExactPortablePty) {
		failures.push(
			"Cargo metadata must contain exactly one unrenamed runtime portable-pty =0.9.0 dependency",
		);
	}

	// F070 "VT 集成" slice (docs/research/2026-07-24-libghostty-terminal.md):
	// `libghostty-vt` is a pre-1.0 FFI crate pinned to an exact version for
	// the same reason `portable-pty` is above — an unpinned range could pull
	// in a breaking API change (or a different pinned Ghostty commit inside
	// `libghostty-vt-sys`'s build.rs) silently.
	if (
		!cargoDependencyDeclaration("libghostty-vt", "=0.2.1").test(cargoSource)
	) {
		failures.push("Cargo.toml must pin libghostty-vt to =0.2.1");
	}
	const libghosttyVtDependencies = cargoDependencies.filter(
		({ name }) => name === "libghostty-vt",
	);
	const hasExactLibghosttyVt = libghosttyVtDependencies.some(
		(candidate) =>
			candidate.req === "=0.2.1" &&
			candidate.kind === null &&
			candidate.rename === null &&
			candidate.target === null &&
			candidate.optional === false,
	);
	if (!hasExactLibghosttyVt) {
		failures.push(
			"Cargo metadata must contain exactly one unrenamed runtime libghostty-vt =0.2.1 dependency",
		);
	}
	for (const dependency of FORBIDDEN_SPAWN_BYPASS_DEPENDENCIES) {
		if (cargoDependencies.some(({ name }) => name === dependency)) {
			failures.push(
				`Cargo metadata must not contain direct spawn-bypass dependency ${dependency}, including renamed dependencies`,
			);
		}
	}
	for (const dependency of FORBIDDEN_GIT_LIBRARY_DEPENDENCIES) {
		if (cargoDependencies.some(({ name }) => name === dependency)) {
			failures.push(
				`Cargo metadata must not contain forbidden git library dependency ${dependency}, including renamed dependencies (ADR 0003: the system Git CLI is the sole write authority, never git2/gix)`,
			);
		}
	}

	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!SPAWN_GUARDED_DOMAIN_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const isGitDomain = GIT_DOMAIN_SOURCE_PATTERN.test(normalizedPath);
		const isAuditedGitExecWrapper = normalizedPath === GIT_EXEC_WRAPPER_PATH;
		const executableSource = stripRustCommentsAndLiterals(source);
		if (
			!isAuditedGitExecWrapper &&
			/\bprocess\s*::\s*Command\b/.test(executableSource)
		) {
			const guidance = isGitDomain
				? `use the sole audited ${GIT_EXEC_WRAPPER_PATH} wrapper`
				: "use portable_pty::CommandBuilder";
			failures.push(
				`${normalizedPath} must not spawn subprocesses via std::process::Command; ${guidance}`,
			);
		}
		// Comments-only (not `stripRustCommentsAndLiterals`) from here on:
		// both the `Command::new("git")` and shell-interpreter checks below,
		// like the pre-existing "-c" check, need to see actual string
		// literal *contents* — `stripRustCommentsAndLiterals` blanks those
		// out too (it only leaves code structure intact), which would make
		// `"git"`/`"sh"` invisible to a naive check against its output.
		const commentsOnlySource = stripRustCommentsOnly(source);
		if (isAuditedGitExecWrapper) {
			if (GIT_EXEC_SHELL_INTERPRETER_PATTERN.test(commentsOnlySource)) {
				failures.push(
					`${GIT_EXEC_WRAPPER_PATH} must not spawn a shell interpreter — it may only invoke the git binary directly`,
				);
			}
			if (!/Command::new\s*\(\s*"git"\s*\)/.test(commentsOnlySource)) {
				failures.push(
					`${GIT_EXEC_WRAPPER_PATH} must invoke Command::new("git") literally`,
				);
			}
		}
		if (/\.args?\s*\(\s*\[?\s*"-c"/.test(commentsOnlySource)) {
			failures.push(`${normalizedPath} must not pass a shell "-c" argument`);
		}
	}

	for (const [name, value, integerType, path] of TERMINAL_BUDGET_LIMITS) {
		const fileSource = findRustSource(rustSources, path);
		if (fileSource === undefined) {
			failures.push(`terminal budget boundary requires ${path}`);
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(fileSource);
		const declarations = findWorkspaceCopyLimitDeclarations(
			executableSource,
			name,
			integerType,
		);
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value
		) {
			failures.push(
				`${path} must define exactly one ${name}: ${integerType} = ${value}`,
			);
		}
	}

	const shellSource = findRustSource(
		rustSources,
		"src-tauri/src/terminal/shell.rs",
	);
	if (shellSource === undefined) {
		failures.push("terminal env allowlist boundary requires terminal/shell.rs");
		return failures;
	}
	const namesMatch =
		/pub\(crate\)\s+const\s+TERMINAL_ENV_PASSTHROUGH_NAMES\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/.exec(
			shellSource,
		);
	const names = namesMatch?.[1]
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		namesMatch === null ||
		!sameArray(names, TERMINAL_ENV_PASSTHROUGH_NAMES_LOCK)
	) {
		failures.push(
			"terminal/shell.rs must define TERMINAL_ENV_PASSTHROUGH_NAMES as exactly the audited name list",
		);
	}
	if (
		!/pub\(crate\)\s+const\s+TERMINAL_ENV_LC_PREFIX\s*:\s*&str\s*=\s*"LC_"\s*;/.test(
			shellSource,
		)
	) {
		failures.push(
			'terminal/shell.rs must define TERMINAL_ENV_LC_PREFIX: &str = "LC_"',
		);
	}
	if (
		!/pub\(crate\)\s+const\s+TERMINAL_ENV_TERM\s*:\s*\(&str,\s*&str\)\s*=\s*\(\s*"TERM"\s*,\s*"xterm-256color"\s*\)\s*;/.test(
			shellSource,
		)
	) {
		failures.push(
			'terminal/shell.rs must define TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color")',
		);
	}
	if (
		!/pub\(crate\)\s+const\s+TERMINAL_ENV_COLORTERM\s*:\s*\(&str,\s*&str\)\s*=\s*\(\s*"COLORTERM"\s*,\s*"truecolor"\s*\)\s*;/.test(
			shellSource,
		)
	) {
		failures.push(
			'terminal/shell.rs must define TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor")',
		);
	}

	return failures;
}

const TRUST_COMMAND_CONTRACTS = Object.freeze([
	{
		file: "src-tauri/src/trust/commands.rs",
		name: "workspace_trust_state",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:WorkspaceTrustStateRequest",
		returnType: "->Result<WorkspaceTrustState,CommandError>",
		body: "request.validate();lettrusted=trust.inner().is_trusted(workspace.inner(),window.label()).await?;Ok(WorkspaceTrustState::new(trusted))",
	},
	{
		file: "src-tauri/src/trust/commands.rs",
		name: "workspace_trust_grant",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:WorkspaceTrustGrantRequest",
		returnType: "->Result<WorkspaceTrustState,CommandError>",
		body: "request.validate();trust.inner().grant(workspace.inner(),window.label()).await?;Ok(WorkspaceTrustState::new(true))",
	},
	{
		file: "src-tauri/src/trust/commands.rs",
		name: "workspace_trust_revoke",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:WorkspaceTrustRevokeRequest",
		returnType: "->Result<(),CommandError>",
		body: "request.validate();trust.inner().revoke(workspace.inner(),window.label()).await",
	},
]);

const TERMINAL_COMMAND_CONTRACTS = Object.freeze([
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_start",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:TerminalStartRequest",
		returnType: "->Result<TerminalStartResult,CommandError>",
		body: "letquery=request.into_parts()?;letsink:Arc<dynTerminalOutputSink>=Arc::new(WindowEmitSink{app:window.app_handle().clone(),window_label:window.label().to_owned(),});letsession_id=terminal.inner().start(trust.inner(),workspace.inner(),window.label(),query.cwd,query.cols,query.rows,sink,).await?;Ok(TerminalStartResult::new(session_id))",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_input_text",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalInputTextRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,text)=request.into_parts()?;terminal.inner().input_text(window.label(),session_id,text).await",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_input_key",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalInputKeyRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,input)=request.into_parts()?;terminal.inner().input_key(window.label(),session_id,input).await",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_focus",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalFocusRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,focused)=request.into_parts();terminal.inner().focus(window.label(),session_id,focused).await",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_resize",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalResizeRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,cols,rows)=request.into_parts()?;terminal.inner().resize(window.label(),session_id,cols,rows).await",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_ack",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalAckRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,sequence)=request.into_parts();terminal.inner().ack(window.label(),session_id,sequence)",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_scrollback",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalScrollbackRequest",
		returnType: "->Result<TerminalScrollbackResult,CommandError>",
		body: "let(session_id,start,count)=request.into_parts()?;letrows=terminal.inner().scrollback(window.label(),session_id,start,count).await?;Ok(TerminalScrollbackResult::new(rows))",
	},
	{
		file: "src-tauri/src/terminal/commands.rs",
		name: "terminal_kill",
		parameters:
			"window:WebviewWindow,terminal:State<'_,TerminalService>,request:TerminalKillRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,immediate)=request.into_parts();terminal.inner().kill(window.label(),session_id,immediate).await",
	},
]);

/**
 * Locks the trust (3) and terminal (6, since F070's "IPC 改造" slice split
 * `terminal_input` into `terminal_input_text`/`terminal_input_key` and added
 * `terminal_focus`/`terminal_scrollback`) commands to their audited exact
 * signatures, bodies and single `generate_handler!` registration —
 * the same exact-body-pinning technique `validateSearchCommandRegistration`/
 * `validateSearchTextCommandRegistration` already use, extended to a closed
 * set spanning two command files at once so a command silently added,
 * removed, duplicated or rewired to a different service method fails this
 * check rather than only being caught by chance in review.
 */
export function validateTrustTerminalCommandRegistration(rustSources) {
	const failures = [];
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");
	const contracts = [...TRUST_COMMAND_CONTRACTS, ...TERMINAL_COMMAND_CONTRACTS];
	const sourceCache = new Map();

	for (const contract of contracts) {
		if (!sourceCache.has(contract.file)) {
			sourceCache.set(
				contract.file,
				findRustSource(rustSources, contract.file),
			);
		}
		const fileSource = sourceCache.get(contract.file);
		if (fileSource === undefined) {
			failures.push(`command registration boundary requires ${contract.file}`);
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(fileSource);
		const commands = extractAuditedTauriCommands(
			executableSource,
			contract.name,
		);
		if (commands.length !== 1) {
			failures.push(
				`${contract.file} must define exactly one audited ${contract.name} Tauri command`,
			);
			continue;
		}
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		if (
			normalizedParameters !== contract.parameters ||
			command.returnType.replaceAll(/\s+/g, "") !== contract.returnType
		) {
			failures.push(
				`${contract.name} must accept its audited parameters and return the audited Result type`,
			);
		}
		const normalizedBody = command.body
			.replaceAll(/\s+/g, "")
			.replace(/;$/, "");
		if (normalizedBody !== contract.body) {
			failures.push(
				`${contract.name} must contain only its audited DTO decode and single service route`,
			);
		}
	}

	if (libSource === undefined) {
		failures.push(
			"command registration boundary requires src-tauri/src/lib.rs",
		);
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	for (const contract of contracts) {
		const modulePrefix = contract.file.includes("/trust/")
			? "trust"
			: "terminal";
		const commandPath = new RegExp(
			`\\b${modulePrefix}\\s*::\\s*commands\\s*::\\s*${contract.name}\\b`,
			"g",
		);
		const registrations = [...executableLib.matchAll(commandPath)];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			new RegExp(
				`\\b${modulePrefix}\\s*::\\s*commands\\s*::\\s*${contract.name}\\b`,
			).test(handlerBodies[0][1]);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				`src-tauri/src/lib.rs must register ${modulePrefix}::commands::${contract.name} exactly once in generate_handler`,
			);
		}
	}

	return failures;
}

/**
 * Locks the terminal IPC bridge (F070's "IPC 改造" slice, superseding S2's
 * raw-byte shapes): the `TerminalDataEvent`/`TerminalExitEvent` Rust struct
 * bodies and the two `plain://terminal-*` event name consts (mirroring
 * `WorkspaceWatchWakeEvent`'s own `structBody(...)`/wake-event-const
 * precedent in `validateWorkspaceWatcherBoundary`), `WindowEmitSink`'s two
 * methods each emitting exactly once through the audited event/constructor,
 * the frozen `PlainBridge` terminal/trust method surface (a fixed 13-method
 * count so a silently added/removed/renamed bridge method fails this
 * check), and the TypeScript event/result decoders' own-data/Proxy-
 * rejection/freeze shape plus native's exactly-once `listen` wiring for
 * each event.
 */
export function validateTerminalIpcBridgeBoundary(rustSources, appSources) {
	const failures = [];
	const dto = findRustSource(rustSources, "src-tauri/src/terminal/dto.rs");
	const commands = findRustSource(
		rustSources,
		"src-tauri/src/terminal/commands.rs",
	);
	const appSource = (expectedPath) =>
		appSources.find(
			({ relativePath }) => relativePath.replaceAll("\\", "/") === expectedPath,
		)?.source;
	const compact = (value) => value?.replaceAll(/\s+/g, "") ?? "";

	const executableDto =
		dto === undefined ? undefined : stripRustCommentsAndLiterals(dto);
	const structBody = (name) => {
		if (executableDto === undefined) {
			return undefined;
		}
		const bodies = watcherRustStructBodies(executableDto, name);
		return bodies.length === 1 ? compact(bodies[0].body) : undefined;
	};
	if (
		structBody("TerminalDataEvent") !==
			"session_id:TerminalSessionId,sequence:u64,frame:TerminalFrame," ||
		structBody("TerminalExitEvent") !==
			"session_id:TerminalSessionId,exit_code:u32,"
	) {
		failures.push(
			"TerminalDataEvent/TerminalExitEvent must expose only their exact audited fields",
		);
	}

	if (
		commands === undefined ||
		!/\bpub\s*\(\s*crate\s*\)\s+const\s+TERMINAL_DATA_EVENT\s*:\s*&str\s*=\s*"plain:\/\/terminal-data"\s*;/.test(
			commands,
		) ||
		!/\bpub\s*\(\s*crate\s*\)\s+const\s+TERMINAL_EXIT_EVENT\s*:\s*&str\s*=\s*"plain:\/\/terminal-exit"\s*;/.test(
			commands,
		)
	) {
		failures.push(
			'terminal/commands.rs must define TERMINAL_DATA_EVENT = "plain://terminal-data" and TERMINAL_EXIT_EVENT = "plain://terminal-exit"',
		);
	}

	const executableCommands =
		commands === undefined ? undefined : stripRustCommentsAndLiterals(commands);

	const emitFrame =
		executableCommands === undefined
			? undefined
			: extractRustFunctions(executableCommands, "emit_frame")[0];
	const emitExit =
		executableCommands === undefined
			? undefined
			: extractRustFunctions(executableCommands, "emit_exit")[0];
	const emitFrameBody = compact(emitFrame?.body);
	const emitExitBody = compact(emitExit?.body);
	if (
		emitFrame === undefined ||
		[...emitFrameBody.matchAll(/\.emit_to\(/g)].length !== 1 ||
		!emitFrameBody.includes(
			"EventTarget::webview_window(self.window_label.clone())",
		) ||
		!emitFrameBody.includes("TERMINAL_DATA_EVENT") ||
		!emitFrameBody.includes(
			"TerminalDataEvent::new(session_id,sequence,frame)",
		) ||
		/[^_]\.emit\(/.test(emitFrameBody)
	) {
		failures.push(
			"WindowEmitSink::emit_frame must emit_to exactly one window-targeted TerminalDataEvent built from the frame it was given",
		);
	}
	if (
		emitExit === undefined ||
		[...emitExitBody.matchAll(/\.emit_to\(/g)].length !== 1 ||
		!emitExitBody.includes(
			"EventTarget::webview_window(self.window_label.clone())",
		) ||
		!emitExitBody.includes("TERMINAL_EXIT_EVENT") ||
		!emitExitBody.includes(
			"TerminalExitEvent::new(session_id,status.exit_code)",
		) ||
		/[^_]\.emit\(/.test(emitExitBody)
	) {
		failures.push(
			"WindowEmitSink::emit_exit must emit_to exactly one window-targeted TerminalExitEvent built from the status it was given",
		);
	}

	const contracts = appSource("app/platform/tauri/contracts.ts");
	const contractsFile =
		contracts === undefined
			? undefined
			: ts.createSourceFile(
					"contracts.ts",
					contracts,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	if (
		contracts === undefined ||
		!/export\s+const\s+TERMINAL_DATA_EVENT\s*=\s*"plain:\/\/terminal-data"\s+as\s+const\s*;/.test(
			contracts,
		) ||
		!/export\s+const\s+TERMINAL_EXIT_EVENT\s*=\s*"plain:\/\/terminal-exit"\s+as\s+const\s*;/.test(
			contracts,
		)
	) {
		failures.push(
			"contracts.ts must declare the exact TERMINAL_DATA_EVENT/TERMINAL_EXIT_EVENT wire strings",
		);
	}
	const plainBridgeInterfaces =
		contractsFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === "PlainBridge",
		) ?? [];
	const TERMINAL_BRIDGE_METHOD_NAMES = [
		"terminalStart",
		"terminalInputText",
		"terminalInputKey",
		"terminalFocus",
		"terminalResize",
		"terminalAck",
		"terminalScrollback",
		"terminalKill",
		"terminalWatchData",
		"terminalWatchExit",
		"workspaceTrustState",
		"workspaceTrustGrant",
		"workspaceTrustRevoke",
	];
	const bridgeMembers =
		plainBridgeInterfaces[0]?.members.filter((member) =>
			TERMINAL_BRIDGE_METHOD_NAMES.includes(typeScriptStaticName(member.name)),
		) ?? [];
	const bridgeMemberNames = bridgeMembers
		.map((member) => typeScriptStaticName(member.name))
		.sort();
	if (
		plainBridgeInterfaces.length !== 1 ||
		bridgeMembers.length !== TERMINAL_BRIDGE_METHOD_NAMES.length ||
		!bridgeMembers.every((member) => ts.isMethodSignature(member)) ||
		JSON.stringify(bridgeMemberNames) !==
			JSON.stringify([...TERMINAL_BRIDGE_METHOD_NAMES].sort())
	) {
		failures.push(
			"PlainBridge must expose exactly the thirteen audited terminal/trust methods, no more and no fewer",
		);
	}

	const terminalCodec = appSource("app/platform/tauri/terminal-codec.ts");
	const decoderBody = (name) => {
		if (terminalCodec === undefined) {
			return undefined;
		}
		const functions = extractRustLikeTypeScriptFunctionBodies(
			terminalCodec,
			name,
		);
		return functions.length === 1 ? functions[0] : undefined;
	};
	for (const name of [
		"decodeTerminalDataEvent",
		"decodeTerminalExitEvent",
		"decodeTerminalScrollbackResult",
		"decodeWorkspaceTrustState",
	]) {
		const body = decoderBody(name);
		if (
			body === undefined ||
			!body.includes("hasExactKeys(") ||
			!body.includes("rejectProxyObject(") ||
			!body.includes("Object.freeze(")
		) {
			failures.push(
				`terminal-codec.ts's ${name} must validate exact own-data keys, reject Proxy wrapping, and freeze its result`,
			);
		}
	}

	const native = appSource("app/platform/tauri/native.ts");
	if (
		native === undefined ||
		[...native.matchAll(/\blisten<unknown>\(\s*TERMINAL_DATA_EVENT\b/g)]
			.length !== 1 ||
		[...native.matchAll(/\blisten<unknown>\(\s*TERMINAL_EXIT_EVENT\b/g)]
			.length !== 1 ||
		!native.includes("decodeTerminalDataEvent(event.payload)") ||
		!native.includes("decodeTerminalExitEvent(event.payload)")
	) {
		failures.push(
			"native.ts must listen for TERMINAL_DATA_EVENT/TERMINAL_EXIT_EVENT exactly once each, decoded through the audited decoders",
		);
	}

	return failures;
}

/**
 * `F080` S1's three git IPC commands (`docs/research/2026-07-25-core-git.md`)
 * — same exact-body-pinning technique as [`TRUST_COMMAND_CONTRACTS`]/
 * [`TERMINAL_COMMAND_CONTRACTS`], kept as its own const/function pair (not
 * folded into [`validateTrustTerminalCommandRegistration`]) because this
 * domain's commands live in a third file (`src-tauri/src/git/commands.rs`)
 * and register through a still-open `generate_handler!` call already
 * validated once per contract set below.
 */
const GIT_COMMAND_CONTRACTS = Object.freeze([
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_status",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStatusRequest",
		returnType: "->Result<GitStatusResult,CommandError>",
		body: "request.validate();letresult=status::git_status(trust.inner(),workspace.inner(),window.label()).await?;Ok(GitStatusResult::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_diff_files",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitDiffFilesRequest",
		returnType: "->Result<GitDiffFilesResult,CommandError>",
		body: "letcached=request.into_parts();letentries=diff::diff_files(trust.inner(),workspace.inner(),window.label(),cached).await?;Ok(GitDiffFilesResult::new(entries))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_show_blob",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitShowBlobRequest",
		returnType: "->Result<GitShowBlobResult,CommandError>",
		body: "let(rev,path)=request.into_parts()?;letcontent=diff::show_blob(trust.inner(),workspace.inner(),window.label(),rev,&path).await?;Ok(GitShowBlobResult::new(content))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stage_paths",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStagePathsRequest",
		returnType: "->Result<(),CommandError>",
		body: "letpaths=request.into_parts()?;stage::stage_paths(trust.inner(),workspace.inner(),window.label(),&paths).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_unstage_paths",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitUnstagePathsRequest",
		returnType: "->Result<(),CommandError>",
		body: "letpaths=request.into_parts()?;stage::unstage_paths(trust.inner(),workspace.inner(),window.label(),&paths).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stage_blob",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStageBlobRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(path,content)=request.into_parts()?;stage::stage_blob(trust.inner(),workspace.inner(),window.label(),&path,content,).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_commit",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitCommitRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(message,amend)=request.into_parts()?;commit::commit(trust.inner(),workspace.inner(),window.label(),&message,amend,).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_discard_paths",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitDiscardPathsRequest",
		returnType: "->Result<(),CommandError>",
		body: "letpaths=request.into_parts()?;discard::discard_paths(trust.inner(),workspace.inner(),window.label(),&paths).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_network_preview",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitNetworkPreviewRequest",
		returnType: "->Result<GitNetworkPreviewResult,CommandError>",
		body: "letoperation=request.into_parts();letresult=network::preview(trust.inner(),workspace.inner(),window.label(),operation).await?;Ok(GitNetworkPreviewResult::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_fetch",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,network_service:State<'_,GitNetworkService>,request:GitFetchRequest",
		returnType: "->Result<(),CommandError>",
		body: "request.validate();network::fetch(trust.inner(),workspace.inner(),network_service.inner(),window.label(),).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_pull",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,network_service:State<'_,GitNetworkService>,request:GitPullRequest",
		returnType: "->Result<(),CommandError>",
		body: "request.validate();network::pull(trust.inner(),workspace.inner(),network_service.inner(),window.label(),).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_push",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,network_service:State<'_,GitNetworkService>,request:GitPushRequest",
		returnType: "->Result<(),CommandError>",
		body: "letforce=request.into_parts();network::push(trust.inner(),workspace.inner(),network_service.inner(),window.label(),force,).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_network_cancel",
		parameters:
			"window:WebviewWindow,network_service:State<'_,GitNetworkService>,request:GitNetworkCancelRequest",
		returnType: "->Result<(),CommandError>",
		body: "request.validate();network_service.inner().request_cancel(window.label());Ok(())",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_blame_file",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitBlameFileRequest",
		returnType: "->Result<GitBlameFileResult,CommandError>",
		body: "let(path,range)=request.into_parts()?;letresult=blame::blame_file(trust.inner(),workspace.inner(),window.label(),&path,range,).await?;Ok(GitBlameFileResult::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_blame_commit_messages",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitBlameCommitMessagesRequest",
		returnType: "->Result<GitBlameCommitMessagesResult,CommandError>",
		body: "letshas=request.into_parts()?;letmessages=blame::blame_commit_messages(trust.inner(),workspace.inner(),window.label(),&shas).await?;Ok(GitBlameCommitMessagesResult::new(messages))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_file_history",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitFileHistoryRequest",
		returnType: "->Result<GitHistoryListResultWire,CommandError>",
		body: "letpath=request.into_parts()?;letresult=log::file_history(trust.inner(),workspace.inner(),window.label(),&path).await?;Ok(GitHistoryListResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_line_history_list",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitLineHistoryListRequest",
		returnType: "->Result<GitHistoryListResultWire,CommandError>",
		body: "let(path,range)=request.into_parts()?;letresult=log::line_history_list(trust.inner(),workspace.inner(),window.label(),&path,range,).await?;Ok(GitHistoryListResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_line_history_detail",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitLineHistoryDetailRequest",
		returnType: "->Result<GitLineHistoryDetailResultWire,CommandError>",
		body: "let(path,range,skip,expected_sha)=request.into_parts()?;letresult=log::line_history_detail(trust.inner(),workspace.inner(),window.label(),&path,range,skip,&expected_sha,).await?;Ok(GitLineHistoryDetailResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_show_commit",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitShowCommitRequest",
		returnType: "->Result<GitShowCommitResult,CommandError>",
		body: "letsha=request.into_parts()?;letresult=show_commit::show_commit(trust.inner(),workspace.inner(),window.label(),&sha).await?;Ok(GitShowCommitResult::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_show_commit_blob",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitShowCommitBlobRequest",
		returnType: "->Result<GitShowBlobResult,CommandError>",
		body: "let(sha,path)=request.into_parts()?;letcontent=show_commit::show_commit_blob(trust.inner(),workspace.inner(),window.label(),&sha,&path,).await?;Ok(GitShowBlobResult::new(content))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_log_graph",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitLogGraphRequest",
		returnType: "->Result<GitLogGraphResultWire,CommandError>",
		body: "letmax_count=request.into_parts()?;letresult=log::log_graph(trust.inner(),workspace.inner(),window.label(),max_count).await?;Ok(GitLogGraphResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_refs_list",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitRefsListRequest",
		returnType: "->Result<GitRefsListResultWire,CommandError>",
		body: "request.validate();letresult=refs::list_refs(trust.inner(),workspace.inner(),window.label()).await?;Ok(GitRefsListResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_list",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashListRequest",
		returnType: "->Result<GitStashListResultWire,CommandError>",
		body: "request.validate();letresult=stash::list_stashes(trust.inner(),workspace.inner(),window.label()).await?;Ok(GitStashListResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_show",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashShowRequest",
		returnType: "->Result<GitStashShowResultWire,CommandError>",
		body: "letsha=request.into_parts()?;letresult=stash::show_stash(trust.inner(),workspace.inner(),window.label(),&sha).await?;Ok(GitStashShowResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_push",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashPushRequest",
		returnType: "->Result<GitStashPushOutcomeWire,CommandError>",
		body: "let(message,include_untracked)=request.into_parts()?;letoutcome=stash::push_stash(trust.inner(),workspace.inner(),window.label(),&message,include_untracked,).await?;Ok(GitStashPushOutcomeWire::from(outcome))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_apply",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashApplyRequest",
		returnType: "->Result<GitStashApplyOutcomeWire,CommandError>",
		body: "let(sha,use_index)=request.into_parts()?;letoutcome=stash::apply_stash(trust.inner(),workspace.inner(),window.label(),&sha,use_index,).await?;Ok(GitStashApplyOutcomeWire::from(outcome))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_pop",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashPopRequest",
		returnType: "->Result<GitStashApplyOutcomeWire,CommandError>",
		body: "let(expected_sha,use_index)=request.into_parts()?;letoutcome=stash::pop_stash(trust.inner(),workspace.inner(),window.label(),&expected_sha,use_index,).await?;Ok(GitStashApplyOutcomeWire::from(outcome))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_stash_drop",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitStashDropRequest",
		returnType: "->Result<(),CommandError>",
		body: "letexpected_sha=request.into_parts()?;stash::drop_stash(trust.inner(),workspace.inner(),window.label(),&expected_sha,).await",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_worktree_list",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitWorktreeListRequest",
		returnType: "->Result<GitWorktreeListResultWire,CommandError>",
		body: "request.validate();letresult=worktree::list_worktrees(trust.inner(),workspace.inner(),window.label()).await?;Ok(GitWorktreeListResultWire::from(result))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_worktree_add",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitWorktreeAddRequest",
		returnType: "->Result<GitWorktreeAddOutcomeWire,CommandError>",
		body: "let(child_segment,detach,commit_ish)=request.into_parts()?;letpicker=TauriDirectoryPicker::new(window.clone());letoutcome=worktree::add_worktree(trust.inner(),workspace.inner(),window.label(),&picker,&child_segment,detach,commit_ish.as_deref(),).await?;Ok(GitWorktreeAddOutcomeWire::from(outcome))",
	},
	{
		file: "src-tauri/src/git/commands.rs",
		name: "git_worktree_remove",
		parameters:
			"window:WebviewWindow,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,request:GitWorktreeRemoveRequest",
		returnType: "->Result<GitWorktreeRemoveOutcomeWire,CommandError>",
		body: "let(path,force)=request.into_parts()?;letoutcome=worktree::remove_worktree(trust.inner(),workspace.inner(),window.label(),&path,force,).await?;Ok(GitWorktreeRemoveOutcomeWire::from(outcome))",
	},
]);

/**
 * Locks all thirty-one git commands (`F080` S1's three reads, S3's five
 * writes, S4's five network commands, `F090` S0's two read-only blame
 * commands — `git_blame_file`/`git_blame_commit_messages` —, `F090` S1's
 * three read-only file/line-history commands —
 * `git_file_history`/`git_line_history_list`/`git_line_history_detail` —,
 * `F090` S2's two read-only commit-detail commands —
 * `git_show_commit`/`git_show_commit_blob` —, `F090` S3's two read-only
 * graph/refs commands — `git_log_graph`/`git_refs_list` —, `F090` S4's six
 * stash commands (two read-only — `git_stash_list`/`git_stash_show` — and
 * four writes — `git_stash_push`/`git_stash_apply`/`git_stash_pop`/
 * `git_stash_drop`) — and `F090` S5's three worktree commands (one read-only
 * — `git_worktree_list` — and two writes — `git_worktree_add`/
 * `git_worktree_remove`), added to this same closed array rather than a
 * parallel `GIT_HISTORY_COMMAND_CONTRACTS`, per the existing "`PlainBridge`'s
 * git surface is one audited whole, not
 * several independently-sized ones" rationale documented below at
 * `GIT_BRIDGE_METHOD_NAMES`) to their audited exact signatures, bodies and
 * single `generate_handler!` registration — mirrors
 * `validateTrustTerminalCommandRegistration`'s exact technique.
 */
export function validateGitCommandRegistration(rustSources) {
	const failures = [];
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");

	for (const contract of GIT_COMMAND_CONTRACTS) {
		const fileSource = findRustSource(rustSources, contract.file);
		if (fileSource === undefined) {
			failures.push(`command registration boundary requires ${contract.file}`);
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(fileSource);
		const commands = extractAuditedTauriCommands(
			executableSource,
			contract.name,
		);
		if (commands.length !== 1) {
			failures.push(
				`${contract.file} must define exactly one audited ${contract.name} Tauri command`,
			);
			continue;
		}
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		if (
			normalizedParameters !== contract.parameters ||
			command.returnType.replaceAll(/\s+/g, "") !== contract.returnType
		) {
			failures.push(
				`${contract.name} must accept its audited parameters and return the audited Result type`,
			);
		}
		const normalizedBody = command.body
			.replaceAll(/\s+/g, "")
			.replace(/;$/, "");
		if (normalizedBody !== contract.body) {
			failures.push(
				`${contract.name} must contain only its audited DTO decode and single service route`,
			);
		}
	}

	if (libSource === undefined) {
		failures.push(
			"command registration boundary requires src-tauri/src/lib.rs",
		);
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	if (handlerBodies.length !== 1) {
		failures.push(
			"lib.rs must register commands through exactly one generate_handler! call",
		);
		return failures;
	}
	const [handlerBody] = handlerBodies;
	for (const contract of GIT_COMMAND_CONTRACTS) {
		const commandPath = new RegExp(
			`\\bgit\\s*::\\s*commands\\s*::\\s*${escapeRegularExpression(contract.name)}\\b`,
		);
		if (!commandPath.test(handlerBody[1])) {
			failures.push(
				`generate_handler! must register git::commands::${contract.name} exactly once`,
			);
		}
	}
	return failures;
}

/**
 * Comments-only variant of [`watcherRustStructBodies`] for a Rust `enum`
 * declaration's whole variant-list text (between its outermost `{`/`}`) —
 * used to lock [`GitStatusEntryWire`]'s five-variant discriminated union
 * exactly, the same "brace-match then compare whitespace-stripped text"
 * technique `watcherRustStructBodies` already establishes for a struct.
 */
function watcherRustEnumBodies(source, name) {
	if (source === undefined) {
		return [];
	}
	const bodies = [];
	const pattern = new RegExp(
		`\\b(?:pub(?:\\s*\\([^)]*\\))?\\s+)?enum\\s+${escapeRegularExpression(name)}\\b`,
		"g",
	);
	for (const match of source.matchAll(pattern)) {
		const bodyOpen = source.indexOf("{", match.index + match[0].length);
		if (bodyOpen < 0) {
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		if (bodyClose !== undefined) {
			bodies.push({
				start: match.index,
				body: source.slice(bodyOpen + 1, bodyClose),
			});
		}
	}
	return bodies;
}

/**
 * Extracts a Rust `fn NAME(...) { ... }` function's body text (comments-only
 * stripped source expected as input, so string-literal content stays visible
 * exactly like [`watcherRustEnumBodies`] needs) by locating the parameter
 * list via [`findMatchingDelimiter`] first (so a return-type arrow or nested
 * generic in the signature can't confuse the search for the body's opening
 * `{`), then matching that opening brace to its close the same way. Returns
 * `undefined` if `name` is not found or the file's braces do not balance —
 * callers should already have a "the whole file exists" failure path for
 * that.
 */
function rustFunctionBody(source, name) {
	const pattern = new RegExp(
		`\\bfn\\s+${escapeRegularExpression(name)}\\s*\\(`,
	);
	const match = pattern.exec(source);
	if (match === null) {
		return undefined;
	}
	const parameterOpen = match.index + match[0].length - 1;
	const parameterClose = findMatchingDelimiter(source, parameterOpen, "(", ")");
	if (parameterClose === undefined) {
		return undefined;
	}
	const bodyOpen = source.indexOf("{", parameterClose + 1);
	if (bodyOpen < 0) {
		return undefined;
	}
	const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
	if (bodyClose === undefined) {
		return undefined;
	}
	return {
		start: bodyOpen,
		end: bodyClose,
		body: source.slice(bodyOpen, bodyClose + 1),
	};
}

/**
 * Locks `F080` S1's git domain: the three hardened, audited argument-list
 * constants (`status.rs`'s `GIT_STATUS_ARGS`, `diff.rs`'s
 * `GIT_DIFF_BASE_ARGS`/`GIT_SHOW_BASE_ARGS`) and the wire DTO struct/enum
 * shapes (`dto.rs`'s `GitBranchWire`/`GitSubmoduleStateWire`/
 * `GitStatusEntryWire`/`GitDiffFileEntryWire`/`GitShowBlobResult`) exactly —
 * a command silently gaining/losing a hardening flag, or a DTO silently
 * gaining/losing/renaming a field, fails this check rather than only being
 * caught by chance in review.
 */
export function validateGitRustBoundary(rustSources) {
	const failures = [];
	const statusSource = findRustSource(
		rustSources,
		"src-tauri/src/git/status.rs",
	);
	const diffSource = findRustSource(rustSources, "src-tauri/src/git/diff.rs");
	const dtoSource = findRustSource(rustSources, "src-tauri/src/git/dto.rs");

	if (statusSource === undefined || diffSource === undefined) {
		failures.push("git boundary requires status.rs and diff.rs");
		return failures;
	}
	// Comments-only (not `stripRustCommentsAndLiterals`, which blanks string
	// literal *contents* too — see that function's own doc comment): this
	// check must see the actual `"status"`/`"--porcelain=v2"`/etc. argument
	// text, exactly like the pre-existing spawn-guard's `"-c"` check in
	// `validateTerminalRustBoundary` needs `stripRustCommentsOnly` for the
	// same reason.
	const executableStatus = stripRustCommentsOnly(statusSource);
	const executableDiff = stripRustCommentsOnly(diffSource);

	const argsConstant = (source, name) => {
		const constantPattern = new RegExp(
			`pub\\s*\\(\\s*crate\\s*\\)\\s+const\\s+${escapeRegularExpression(name)}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([^\\]]*)\\]\\s*;`,
		);
		const match = constantPattern.exec(source);
		if (match === null) {
			return undefined;
		}
		return match[1]
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0)
			.map((entry) => entry.replace(/^"|"$/g, ""));
	};

	const statusArgs = argsConstant(executableStatus, "GIT_STATUS_ARGS");
	if (
		!sameArray(statusArgs, [
			"status",
			"--porcelain=v2",
			"-z",
			"--branch",
			"--ignored",
		])
	) {
		failures.push(
			"status.rs must define GIT_STATUS_ARGS as exactly the audited status argument list",
		);
	}
	const diffBaseArgs = argsConstant(executableDiff, "GIT_DIFF_BASE_ARGS");
	if (
		!sameArray(diffBaseArgs, [
			"diff",
			"--no-color",
			"-z",
			"-M",
			"--no-textconv",
			"--no-ext-diff",
		])
	) {
		failures.push(
			"diff.rs must define GIT_DIFF_BASE_ARGS as exactly the audited diff argument list",
		);
	}
	const showBaseArgs = argsConstant(executableDiff, "GIT_SHOW_BASE_ARGS");
	if (
		!sameArray(showBaseArgs, [
			"show",
			"--no-color",
			"--no-textconv",
			"--no-ext-diff",
		])
	) {
		failures.push(
			"diff.rs must define GIT_SHOW_BASE_ARGS as exactly the audited show argument list",
		);
	}

	if (dtoSource === undefined) {
		failures.push("git boundary requires dto.rs");
		return failures;
	}
	const executableDto = stripRustCommentsAndLiterals(dtoSource);
	const compact = (value) => value?.replaceAll(/\s+/g, "") ?? "";
	const structBody = (name) => {
		const bodies = watcherRustStructBodies(executableDto, name);
		return bodies.length === 1 ? compact(bodies[0].body) : undefined;
	};
	const enumBody = (name) => {
		const bodies = watcherRustEnumBodies(executableDto, name);
		return bodies.length === 1 ? compact(bodies[0].body) : undefined;
	};

	if (
		structBody("GitSubmoduleStateWire") !==
		"is_submodule:bool,commit_changed:bool,tracked_changed:bool,untracked_changed:bool,"
	) {
		failures.push(
			"GitSubmoduleStateWire must expose only its exact audited four boolean fields",
		);
	}
	if (
		structBody("GitBranchWire") !==
		"oid:String,head:String,upstream:Option<GitBranchUpstreamWire>,"
	) {
		failures.push("GitBranchWire must expose only its exact audited fields");
	}
	if (
		structBody("GitDiffFileEntryWire") !==
		"kind:GitDiffStatusKindWire,similarity:Option<u16>,path:String,orig_path:Option<String>,added:Option<u64>,deleted:Option<u64>,binary:bool,"
	) {
		failures.push(
			"GitDiffFileEntryWire must expose only its exact audited fields",
		);
	}
	if (structBody("GitShowBlobResult") !== "content:Option<Vec<u8>>,") {
		failures.push(
			"GitShowBlobResult must expose only its exact audited content field",
		);
	}
	const expectedStatusEntryWire =
		"Ordinary{index_status:char,worktree_status:char,submodule:GitSubmoduleStateWire,mode_head:String,mode_index:String,mode_worktree:String,hash_head:String,hash_index:String,path:String,},RenameOrCopy{index_status:char,worktree_status:char,submodule:GitSubmoduleStateWire,mode_head:String,mode_index:String,mode_worktree:String,hash_head:String,hash_index:String,rename_or_copy_kind:GitRenameOrCopyKindWire,similarity:u16,path:String,orig_path:String,},Unmerged{index_status:char,worktree_status:char,submodule:GitSubmoduleStateWire,mode_stage1:String,mode_stage2:String,mode_stage3:String,mode_worktree:String,hash_stage1:String,hash_stage2:String,hash_stage3:String,path:String,},Untracked{path:String,},Ignored{path:String,},";
	if (enumBody("GitStatusEntryWire") !== expectedStatusEntryWire) {
		failures.push(
			"GitStatusEntryWire must expose exactly its five audited variants with their exact fields",
		);
	}

	// --- F080 S3 write commands --------------------------------------------
	if (
		structBody("GitStagePathsRequest") !== "paths:Vec<String>," ||
		structBody("GitUnstagePathsRequest") !== "paths:Vec<String>," ||
		structBody("GitDiscardPathsRequest") !== "paths:Vec<String>,"
	) {
		failures.push(
			"GitStagePathsRequest/GitUnstagePathsRequest/GitDiscardPathsRequest must expose only their exact audited paths field",
		);
	}
	if (structBody("GitStageBlobRequest") !== "path:String,content:Vec<u8>,") {
		failures.push(
			"GitStageBlobRequest must expose only its exact audited path/content fields",
		);
	}
	if (structBody("GitCommitRequest") !== "message:String,amend:bool,") {
		failures.push(
			"GitCommitRequest must expose only its exact audited message/amend fields",
		);
	}

	const commitSource = findRustSource(
		rustSources,
		"src-tauri/src/git/commit.rs",
	);
	const discardSource = findRustSource(
		rustSources,
		"src-tauri/src/git/discard.rs",
	);
	if (commitSource === undefined || discardSource === undefined) {
		failures.push("git boundary requires commit.rs and discard.rs");
		return failures;
	}
	const executableCommit = stripRustCommentsOnly(commitSource);
	const executableDiscard = stripRustCommentsOnly(discardSource);
	const commitArgs = argsConstant(executableCommit, "GIT_COMMIT_ARGS");
	if (
		!sameArray(commitArgs, [
			"-c",
			"user.useConfigOnly=true",
			"commit",
			"--quiet",
			"--file",
			"-",
		])
	) {
		failures.push(
			"commit.rs must define GIT_COMMIT_ARGS as exactly the audited commit argument list",
		);
	}
	const discardArgs = argsConstant(executableDiscard, "GIT_DISCARD_ARGS");
	if (!sameArray(discardArgs, ["checkout", "-q"])) {
		failures.push(
			"discard.rs must define GIT_DISCARD_ARGS as exactly the audited discard argument list",
		);
	}

	// --- F080 S4 network commands -------------------------------------------
	if (
		structBody("GitNetworkPreviewRequest") !==
		"operation:GitNetworkOperationWire,"
	) {
		failures.push(
			"GitNetworkPreviewRequest must expose only its exact audited operation field",
		);
	}
	if (
		structBody("GitNetworkPreviewResult") !==
		"upstream:Option<String>,ahead:Option<u64>,behind:Option<u64>,"
	) {
		failures.push(
			"GitNetworkPreviewResult must expose only its exact audited upstream/ahead/behind fields",
		);
	}
	const networkOperationWireBody = enumBody("GitNetworkOperationWire");
	if (
		networkOperationWireBody !== "Fetch,Pull,Push," &&
		networkOperationWireBody !== "Fetch,Pull,Push"
	) {
		failures.push(
			"GitNetworkOperationWire must expose exactly its three audited Fetch/Pull/Push variants",
		);
	}
	if (
		structBody("GitFetchRequest") !== "" ||
		structBody("GitPullRequest") !== ""
	) {
		failures.push("GitFetchRequest/GitPullRequest must remain empty structs");
	}
	if (structBody("GitPushRequest") !== "force:bool,") {
		failures.push(
			"GitPushRequest must expose only its exact audited force field",
		);
	}
	if (structBody("GitNetworkCancelRequest") !== "") {
		failures.push("GitNetworkCancelRequest must remain an empty struct");
	}

	const networkSource = findRustSource(
		rustSources,
		"src-tauri/src/git/network.rs",
	);
	const execSourceForNetwork = findRustSource(
		rustSources,
		"src-tauri/src/git/exec.rs",
	);
	if (networkSource === undefined || execSourceForNetwork === undefined) {
		failures.push("git boundary requires network.rs and exec.rs");
		return failures;
	}
	const executableNetwork = stripRustCommentsOnly(networkSource);
	const fetchArgs = argsConstant(executableNetwork, "GIT_FETCH_ARGS");
	if (!sameArray(fetchArgs, ["fetch", "--quiet"])) {
		failures.push(
			"network.rs must define GIT_FETCH_ARGS as exactly the audited fetch argument list",
		);
	}
	const pullArgs = argsConstant(executableNetwork, "GIT_PULL_ARGS");
	if (!sameArray(pullArgs, ["pull", "--quiet"])) {
		failures.push(
			"network.rs must define GIT_PULL_ARGS as exactly the audited pull argument list",
		);
	}
	const pushArgs = argsConstant(executableNetwork, "GIT_PUSH_ARGS");
	if (!sameArray(pushArgs, ["push", "--quiet"])) {
		failures.push(
			"network.rs must define GIT_PUSH_ARGS as exactly the audited push argument list",
		);
	}
	const pushForceArgs = argsConstant(executableNetwork, "GIT_PUSH_FORCE_ARGS");
	if (!sameArray(pushForceArgs, ["push", "--quiet", "--force-with-lease"])) {
		failures.push(
			"network.rs must define GIT_PUSH_FORCE_ARGS as exactly the audited force-with-lease argument list (never bare --force)",
		);
	}
	// Belt-and-suspenders textual scan: the two `argsConstant` locks above
	// already fully pin every element of both push-argument constants, so
	// this only catches a *third*, differently-named constant (or an inline
	// `.args([...])` literal) smuggling in a bare `--force` token anywhere in
	// the git Rust domain — not just `network.rs` (broadened post-review;
	// confirmed empirically zero false positives at the time: no other file
	// under `src-tauri/src/git/` contained the literal quoted string
	// `"--force"` at all, so widening this scan cost nothing). `--force-with-
	// lease` itself contains the substring `--force`, so the negative
	// lookahead is required to avoid a false positive against the audited
	// constant's own literal.
	//
	// `F090` S5 found the one genuine exception this scan's own "zero false
	// positives" premise did not anticipate: `worktree.rs`'s `remove_worktree`
	// legitimately passes a bare `--force` to `git worktree remove` — a
	// completely different subcommand from `push`, with no `--force-with-
	// lease`-style safer equivalent at all (confirmed empirically,
	// `worktree.rs`'s own module doc comment: a locked worktree requires it
	// *twice*, a merely-dirty one once; `worktree remove` has no remote/lease
	// concept for this flag to protect against in the first place — unlike
	// `push`, which can silently clobber someone else's remote history, a
	// local worktree removal's own two-phase probe-then-confirm flow is this
	// feature's own, differently-shaped safeguard, see `plain-scm-worktree.ts`).
	// `worktree.rs` is therefore excluded from this specific scan by name —
	// not a weakening of the underlying push-only invariant this scan exists
	// to protect (still enforced for every other file in the domain), and not
	// a license for any *other* file to follow suit without the same
	// disclosure and review.
	const gitDomainSourcesForForceScan = rustSources.filter(
		(entry) =>
			GIT_DOMAIN_SOURCE_PATTERN.test(
				entry.relativePath.replaceAll("\\", "/"),
			) &&
			!entry.relativePath.replaceAll("\\", "/").endsWith("/git/worktree.rs"),
	);
	const bareForceLiteralFoundIn = gitDomainSourcesForForceScan.find((entry) =>
		/"--force"(?!-with-lease)/.test(stripRustCommentsOnly(entry.source)),
	);
	if (bareForceLiteralFoundIn !== undefined) {
		failures.push(
			`${bareForceLiteralFoundIn.relativePath} must never pass a bare --force argument to git push — only --force-with-lease`,
		);
	}

	// Raw source (not `stripRustCommentsAndLiterals`, which blanks string
	// literal *contents* too) — mirrors `validateTerminalRustBoundary`'s own
	// `TERMINAL_ENV_PASSTHROUGH_NAMES_LOCK` check against `shell.rs`, which
	// needs to see the actual `"PATH"`/`"HOME"`/etc. literal text.
	const networkEnvNamesMatch =
		/pub\(crate\)\s+const\s+GIT_NETWORK_ENV_PASSTHROUGH_NAMES\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/.exec(
			execSourceForNetwork,
		);
	const networkEnvNames = networkEnvNamesMatch?.[1]
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		networkEnvNamesMatch === null ||
		!sameArray(networkEnvNames, ["PATH", "HOME", "SSH_AUTH_SOCK"])
	) {
		failures.push(
			"exec.rs must define GIT_NETWORK_ENV_PASSTHROUGH_NAMES as exactly PATH/HOME/SSH_AUTH_SOCK",
		);
	}

	// Post-review fix: `GIT_LITERAL_PATHSPECS=1` (defeats the pathspec-glob-
	// expansion data-loss defect a `--` separator alone does not stop) must
	// be set exactly once, unconditionally, in the one shared pre-dispatch
	// function (`apply_universal_hardening`) — never duplicated into, or
	// narrowed to live only inside, one of `harden_background_read`/
	// `harden_write`/`harden_network`. Comments-only (not
	// `stripRustCommentsAndLiterals`) because this needs to see the actual
	// `"GIT_LITERAL_PATHSPECS"`/`"1"` string-literal text, exactly like the
	// `GIT_NETWORK_ENV_PASSTHROUGH_NAMES` check just above.
	const execCommentsOnlyForPathspecs =
		stripRustCommentsOnly(execSourceForNetwork);
	const literalPathspecsOccurrences = (
		execCommentsOnlyForPathspecs.match(/GIT_LITERAL_PATHSPECS/g) ?? []
	).length;
	const universalHardeningBody = rustFunctionBody(
		execCommentsOnlyForPathspecs,
		"apply_universal_hardening",
	);
	const universalHardeningSetsLiteralPathspecs =
		universalHardeningBody !== undefined &&
		/\.env\s*\(\s*"GIT_LITERAL_PATHSPECS"\s*,\s*"1"\s*\)/.test(
			universalHardeningBody.body,
		);
	const literalPathspecsLeaksIntoAModeHardener = [
		"harden_background_read",
		"harden_write",
		"harden_network",
	].some((name) => {
		const body = rustFunctionBody(execCommentsOnlyForPathspecs, name);
		return body !== undefined && body.body.includes("GIT_LITERAL_PATHSPECS");
	});
	// `apply_universal_hardening` defining the env var correctly is not
	// enough on its own — `build_git_command` must actually call it, and
	// before the `match mode { ... }` dispatch (so it truly applies to
	// every `GitExecMode`, not just whichever arm happens to run after it).
	const buildGitCommandBody = rustFunctionBody(
		execCommentsOnlyForPathspecs,
		"build_git_command",
	);
	const buildGitCommandCallsUniversalHardeningBeforeDispatch = (() => {
		if (buildGitCommandBody === undefined) {
			return false;
		}
		const callIndex = buildGitCommandBody.body.indexOf(
			"apply_universal_hardening(",
		);
		const matchIndex = buildGitCommandBody.body.indexOf("match mode");
		return callIndex >= 0 && matchIndex >= 0 && callIndex < matchIndex;
	})();
	if (
		literalPathspecsOccurrences !== 1 ||
		!universalHardeningSetsLiteralPathspecs ||
		literalPathspecsLeaksIntoAModeHardener ||
		!buildGitCommandCallsUniversalHardeningBeforeDispatch
	) {
		failures.push(
			"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
				"apply_universal_hardening, and build_git_command must call it before dispatching " +
				"on GitExecMode — never duplicated or narrowed into a single GitExecMode's own " +
				"harden_* function",
		);
	}

	// --- F090 S1: file/line history (`git::log`) ---------------------------
	const logSource = findRustSource(rustSources, "src-tauri/src/git/log.rs");
	if (logSource === undefined) {
		failures.push("git boundary requires log.rs");
		return failures;
	}
	const executableLog = stripRustCommentsOnly(logSource);
	const logCommitMetaArgs = argsConstant(
		executableLog,
		"GIT_LOG_COMMIT_META_ARGS",
	);
	if (
		!sameArray(logCommitMetaArgs, [
			"log",
			"-z",
			"--format=%H%x1f%B",
			"--no-patch",
		])
	) {
		failures.push(
			"log.rs must define GIT_LOG_COMMIT_META_ARGS as exactly the audited " +
				"sha+full-message-body format — a second free-text field (e.g. author " +
				"name) positioned before the body would reintroduce the exact field-shift " +
				"vulnerability F090 S0 found and fixed for blame's own hover-metadata fetch",
		);
	}

	if (
		structBody("GitFileHistoryRequest") !== "path:String," ||
		structBody("GitLogLineRangeWire") !== "start:u32,end:u32," ||
		structBody("GitLineHistoryListRequest") !==
			"path:String,range:GitLogLineRangeWire," ||
		structBody("GitLineHistoryDetailRequest") !==
			"path:String,range:GitLogLineRangeWire,skip:u32,expected_sha:String," ||
		structBody("GitHistoryEntryWire") !== "sha:String,message:String," ||
		structBody("GitHistoryListResultWire") !==
			"entries:Vec<GitHistoryEntryWire>,truncated:bool," ||
		structBody("GitLineHistoryDetailResultWire") !==
			"sha:String,diff_text:String,"
	) {
		failures.push(
			"GitFileHistoryRequest/GitLogLineRangeWire/GitLineHistoryListRequest/" +
				"GitLineHistoryDetailRequest/GitHistoryEntryWire/GitHistoryListResultWire/" +
				"GitLineHistoryDetailResultWire must expose only their exact audited fields",
		);
	}

	// --- F090 S2: commit-detail file list (`git::show_commit`) -------------
	const showCommitSource = findRustSource(
		rustSources,
		"src-tauri/src/git/show_commit.rs",
	);
	if (showCommitSource === undefined) {
		failures.push("git boundary requires show_commit.rs");
		return failures;
	}
	const executableShowCommit = stripRustCommentsOnly(showCommitSource);
	const showCommitDiffBaseArgs = argsConstant(
		executableShowCommit,
		"GIT_SHOW_COMMIT_DIFF_BASE_ARGS",
	);
	if (
		!sameArray(showCommitDiffBaseArgs, [
			"diff",
			"--no-color",
			"-z",
			"-M",
			"-C",
			"--find-copies-harder",
			"--no-textconv",
			"--no-ext-diff",
		])
	) {
		failures.push(
			"show_commit.rs must define GIT_SHOW_COMMIT_DIFF_BASE_ARGS as exactly the audited " +
				"two-explicit-revision git diff argument list — never the literal show " +
				"subcommand (see validateGitShowCommitFirstParentBoundary for the dedicated, " +
				"stronger lock on that specific invariant)",
		);
	}
	const emptyTreeShaMatch =
		/pub\s*\(\s*crate\s*\)\s+const\s+EMPTY_TREE_SHA\s*:\s*&\s*str\s*=\s*"([^"]*)"\s*;/.exec(
			executableShowCommit,
		);
	if (
		emptyTreeShaMatch === null ||
		emptyTreeShaMatch[1] !== "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
	) {
		failures.push(
			"show_commit.rs must define EMPTY_TREE_SHA as exactly git's own well-known empty-tree object id",
		);
	}

	if (
		structBody("GitShowCommitRequest") !== "sha:String," ||
		structBody("GitShowCommitResult") !==
			"sha:String,parent_sha:Option<String>,files:Vec<GitDiffFileEntryWire>," ||
		structBody("GitShowCommitBlobRequest") !== "sha:String,path:String,"
	) {
		failures.push(
			"GitShowCommitRequest/GitShowCommitResult/GitShowCommitBlobRequest must expose only their exact audited fields",
		);
	}

	// --- F090 S3: graph (`git::log::log_graph`) + refs (`git::refs`) -------
	//
	// `GIT_LOG_GRAPH_ARGS`/`GIT_FOR_EACH_REF_ARGS` themselves get their own
	// *dedicated* lock (`validateGitLogGraphFormatStringBoundary`/
	// `validateGitRefsFieldSafetyBoundary` below) — the same "exported on its
	// own, not folded in here" treatment `validateGitBlameHardeningArgs`/
	// `validateGitShowCommitFirstParentBoundary` already get, because each
	// has its own easy-to-miss field-safety footgun beyond plain array
	// equality. This section only locks the wire DTO shapes.
	if (
		structBody("GitLogGraphRequest") !== "max_count:u32," ||
		structBody("GitGraphNodeWire") !==
			"sha:String,parents:Vec<String>,subject:String," ||
		structBody("GitLogGraphResultWire") !==
			"nodes:Vec<GitGraphNodeWire>,truncated:bool,"
	) {
		failures.push(
			"GitLogGraphRequest/GitGraphNodeWire/GitLogGraphResultWire must expose only their exact audited fields",
		);
	}
	if (structBody("GitRefsListRequest") !== "") {
		failures.push("GitRefsListRequest must remain an empty struct");
	}
	const refKindWireBody = enumBody("GitRefKindWire");
	if (
		refKindWireBody !== "Branch,RemoteBranch,Tag," &&
		refKindWireBody !== "Branch,RemoteBranch,Tag"
	) {
		failures.push(
			"GitRefKindWire must expose exactly its three audited Branch/RemoteBranch/Tag variants",
		);
	}
	if (
		structBody("GitRefEntryWire") !==
			"kind:GitRefKindWire,full_name:String,short_name:String,target_sha:String," +
				"is_annotated_tag:bool,peeled_sha:Option<String>,upstream:Option<String>,is_head:bool," ||
		structBody("GitRefsListResultWire") !==
			"entries:Vec<GitRefEntryWire>,truncated:bool,"
	) {
		failures.push(
			"GitRefEntryWire/GitRefsListResultWire must expose only their exact audited fields",
		);
	}

	// --- F090 S4: stash (`git::stash`) --------------------------------------
	//
	// `GIT_STASH_LIST_ARGS` itself gets its own *dedicated* lock
	// (`validateGitStashMessageFieldSafetyBoundary` below) — the same
	// "exported on its own, not folded in here" treatment
	// `validateGitBlameHardeningArgs`/`validateGitLogGraphFormatStringBoundary`
	// already get, because it has its own easy-to-miss field-safety footgun
	// (a stash message is entirely user-supplied, unlike `refs`' grammar-
	// constrained fields) beyond plain array equality. This section locks
	// every other `GIT_STASH_*_ARGS` constant (plain array equality is
	// sufficient for each: none of them has a free-text field to absorb) and
	// the wire DTO shapes.
	const stashSource = findRustSource(rustSources, "src-tauri/src/git/stash.rs");
	if (stashSource === undefined) {
		failures.push("git boundary requires stash.rs");
		return failures;
	}
	const executableStash = stripRustCommentsOnly(stashSource);
	const stashArgsChecks = [
		[
			"GIT_STASH_SHOW_NAME_STATUS_ARGS",
			[
				"stash",
				"show",
				"--no-color",
				"-z",
				"-u",
				"-M",
				"-C",
				"--find-copies-harder",
				"--no-textconv",
				"--no-ext-diff",
				"--name-status",
			],
		],
		[
			"GIT_STASH_SHOW_NUMSTAT_ARGS",
			[
				"stash",
				"show",
				"--no-color",
				"-z",
				"-u",
				"-M",
				"-C",
				"--find-copies-harder",
				"--no-textconv",
				"--no-ext-diff",
				"--numstat",
			],
		],
		["GIT_STASH_PUSH_ARGS", ["stash", "push"]],
		[
			"GIT_STASH_PUSH_INCLUDE_UNTRACKED_ARGS",
			["stash", "push", "--include-untracked"],
		],
		["GIT_STASH_APPLY_ARGS", ["stash", "apply"]],
		["GIT_STASH_APPLY_INDEX_ARGS", ["stash", "apply", "--index"]],
		["GIT_STASH_POP_ARGS", ["stash", "pop"]],
		["GIT_STASH_POP_INDEX_ARGS", ["stash", "pop", "--index"]],
		["GIT_STASH_DROP_ARGS", ["stash", "drop"]],
	];
	for (const [constantName, expected] of stashArgsChecks) {
		if (!sameArray(argsConstant(executableStash, constantName), expected)) {
			failures.push(
				`stash.rs must define ${constantName} as exactly the audited argument list`,
			);
		}
	}

	if (
		structBody("GitStashListRequest") !== "" ||
		structBody("GitStashEntryWire") !==
			"index:u32,sha:String,committer_time:i64,message:String," ||
		structBody("GitStashListResultWire") !==
			"entries:Vec<GitStashEntryWire>,truncated:bool,"
	) {
		failures.push(
			"GitStashListRequest/GitStashEntryWire/GitStashListResultWire must expose only their exact audited fields",
		);
	}
	if (
		structBody("GitStashShowRequest") !== "sha:String," ||
		structBody("GitStashShowResultWire") !==
			"sha:String,parent_sha:Option<String>,files:Vec<GitDiffFileEntryWire>,"
	) {
		failures.push(
			"GitStashShowRequest/GitStashShowResultWire must expose only their exact audited fields",
		);
	}
	if (
		structBody("GitStashPushRequest") !==
		"message:String,include_untracked:bool,"
	) {
		failures.push(
			"GitStashPushRequest must expose only its exact audited fields",
		);
	}
	const stashPushOutcomeBody = enumBody("GitStashPushOutcomeWire");
	if (
		stashPushOutcomeBody !== "Created,NoLocalChanges," &&
		stashPushOutcomeBody !== "Created,NoLocalChanges"
	) {
		failures.push(
			"GitStashPushOutcomeWire must expose exactly its two audited Created/NoLocalChanges variants",
		);
	}
	if (
		structBody("GitStashApplyRequest") !== "sha:String,use_index:bool," ||
		structBody("GitStashPopRequest") !==
			"expected_sha:String,use_index:bool," ||
		structBody("GitStashDropRequest") !== "expected_sha:String,"
	) {
		failures.push(
			"GitStashApplyRequest/GitStashPopRequest/GitStashDropRequest must expose only their exact audited fields",
		);
	}
	const stashApplyOutcomeBody = enumBody("GitStashApplyOutcomeWire");
	if (
		stashApplyOutcomeBody !==
			"Applied,Conflict{conflicted_paths:Vec<String>}," &&
		stashApplyOutcomeBody !== "Applied,Conflict{conflicted_paths:Vec<String>}"
	) {
		failures.push(
			"GitStashApplyOutcomeWire must expose exactly its two audited Applied/Conflict variants",
		);
	}

	// --- F090 S5: worktree (`git::worktree`) --------------------------------
	//
	// None of `worktree.rs`'s three argument constants has a free-text field
	// to absorb (`worktree list`'s porcelain format has no user-supplied
	// content at all; `worktree add`/`worktree remove`'s own literal `--`
	// separator is enforced by `GIT_WORKTREE_ADD_BASE_ARGS`'s own fixed shape,
	// not a format string), so plain array equality is sufficient for all
	// three — no dedicated field-safety function is needed here, unlike
	// `validateGitBlameHardeningArgs`/`validateGitLogGraphFormatStringBoundary`/
	// `validateGitStashMessageFieldSafetyBoundary`.
	const worktreeSource = findRustSource(
		rustSources,
		"src-tauri/src/git/worktree.rs",
	);
	if (worktreeSource === undefined) {
		failures.push("git boundary requires worktree.rs");
		return failures;
	}
	const executableWorktree = stripRustCommentsOnly(worktreeSource);
	const worktreeArgsChecks = [
		["GIT_WORKTREE_LIST_ARGS", ["worktree", "list", "--porcelain", "-z"]],
		["GIT_WORKTREE_ADD_BASE_ARGS", ["worktree", "add"]],
		["GIT_WORKTREE_REMOVE_ARGS", ["worktree", "remove"]],
	];
	for (const [constantName, expected] of worktreeArgsChecks) {
		if (!sameArray(argsConstant(executableWorktree, constantName), expected)) {
			failures.push(
				`worktree.rs must define ${constantName} as exactly the audited argument list`,
			);
		}
	}

	if (
		structBody("GitWorktreeListRequest") !== "" ||
		enumBody("GitWorktreeHeadStateWire") !==
			"Branch{ref_name:String},Detached,Bare," ||
		structBody("GitWorktreeEntryWire") !==
			"path:String,head_sha:Option<String>,head_state:GitWorktreeHeadStateWire,lock_reason:Option<String>,prunable_reason:Option<String>,is_main:bool," ||
		structBody("GitWorktreeListResultWire") !==
			"entries:Vec<GitWorktreeEntryWire>,truncated:bool,"
	) {
		failures.push(
			"GitWorktreeListRequest/GitWorktreeHeadStateWire/GitWorktreeEntryWire/GitWorktreeListResultWire must expose only their exact audited fields",
		);
	}
	if (
		structBody("GitWorktreeAddRequest") !==
		"child_segment:String,detach:bool,commit_ish:Option<String>,"
	) {
		failures.push(
			"GitWorktreeAddRequest must expose only its exact audited fields",
		);
	}
	const worktreeAddOutcomeBody = enumBody("GitWorktreeAddOutcomeWire");
	if (
		worktreeAddOutcomeBody !== "Added{path:String},PickerCancelled," &&
		worktreeAddOutcomeBody !== "Added{path:String},PickerCancelled"
	) {
		failures.push(
			"GitWorktreeAddOutcomeWire must expose exactly its two audited Added/PickerCancelled variants",
		);
	}
	if (structBody("GitWorktreeRemoveRequest") !== "path:String,force:bool,") {
		failures.push(
			"GitWorktreeRemoveRequest must expose only its exact audited fields",
		);
	}
	const worktreeRemoveOutcomeBody = enumBody("GitWorktreeRemoveOutcomeWire");
	if (
		worktreeRemoveOutcomeBody !== "Removed,NeedsForce," &&
		worktreeRemoveOutcomeBody !== "Removed,NeedsForce"
	) {
		failures.push(
			"GitWorktreeRemoveOutcomeWire must expose exactly its two audited Removed/NeedsForce variants",
		);
	}

	return failures;
}

/**
 * `F090` S0's dedicated hardening lock for `git blame` — kept as its own
 * exported function (not folded into `validateGitRustBoundary`'s generic
 * `argsConstant` checks) precisely because the research doc's own warning
 * is that this is easy to conflate with an already-covered case: `status`/
 * `diff` get their NUL-safe, unquoted path output from `-z` alone, so it
 * would be a natural (but wrong) assumption that blame's own `-z` does the
 * same. It does not — verified empirically (`blame.rs`'s own module doc
 * comment, `blame/tests.rs`'s `blame_hardened_call_recovers_the_real_filename_
 * while_an_unhardened_control_is_octal_escaped` control-group test): git
 * blame's `filename`/`previous` path fields are only unescaped when `-c
 * core.quotePath=false` is explicitly set, and that override must be a
 * *global* option positioned before the `blame` subcommand token (`-c`
 * placed after `blame` is a *different*, blame-specific flag — annotate-
 * compatibility mode — not the config-override flag; confirmed empirically
 * against real git 2.50.1, which is why `GIT_BLAME_BASE_ARGS` itself is
 * ordered `-c`, `core.quotePath=false` *first*, `blame` second, unlike the
 * research doc's original un-verified sketch).
 */
export function validateGitBlameHardeningArgs(rustSources) {
	const failures = [];
	const blameSource = findRustSource(rustSources, "src-tauri/src/git/blame.rs");
	if (blameSource === undefined) {
		failures.push("git boundary requires blame.rs");
		return failures;
	}
	const executableBlame = stripRustCommentsOnly(blameSource);
	const constantPattern =
		/pub\s*\(\s*crate\s*\)\s+const\s+GIT_BLAME_BASE_ARGS\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/;
	const match = constantPattern.exec(executableBlame);
	const args = match?.[1]
		?.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		match === null ||
		!sameArray(args, [
			"-c",
			"core.quotePath=false",
			"blame",
			"--line-porcelain",
			"--root",
		])
	) {
		failures.push(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	}
	return failures;
}

/**
 * `F090` S2's dedicated lock for `show_commit.rs`'s own empirically-
 * discovered deviation from the frozen plan — kept as its own exported
 * function (not folded into `validateGitRustBoundary`'s generic
 * `argsConstant`/`structBody` checks) for exactly the same reason
 * `validateGitBlameHardeningArgs` is: the frozen plan's own sketch
 * (`git show <sha> --first-parent --name-status`) is the *natural*,
 * easy-to-reach-for shape, and nothing about `GIT_SHOW_COMMIT_DIFF_BASE_ARGS`
 * containing `"diff"` instead of `"show"` alone proves a future edit could
 * not add a second, parallel invocation elsewhere in the same file that goes
 * back to spawning `git show`. This function re-scans the *entire* file for
 * the literal subcommand token `"show"` (comments-only stripped, so an actual
 * quoted string literal — not prose in a doc comment — would be required to
 * trip it; confirmed zero legitimate occurrences in the audited file, every
 * real use of the word "show" in `show_commit.rs` today lives in a doc
 * comment or an identifier like `GIT_SHOW_COMMIT_INVALID_SHA`, neither of
 * which this pattern can match) and additionally locks the call-order
 * invariant that makes the two-explicit-revision `git diff` approach actually
 * correct: `show_commit` must call `verify_commit_exists` before
 * `resolve_first_parent` (see `show_commit.rs`'s own module doc comment for
 * why neither `%P` nor `--parents` output alone can tell a non-existent/
 * non-commit object apart from a genuine root commit), and the diff
 * invocations' own base revision must be built from `parent_sha`/
 * `EMPTY_TREE_SHA` — never a bare `sha` positional or a `sha^`-style revspec
 * suffix (the frozen plan's original, empirically-falsified drill-down
 * shape for a *different* command, `log::line_history_detail`, which this
 * lock also guards `show_commit.rs` against silently reintroducing here).
 */
export function validateGitShowCommitFirstParentBoundary(rustSources) {
	const failures = [];
	const showCommitSource = findRustSource(
		rustSources,
		"src-tauri/src/git/show_commit.rs",
	);
	if (showCommitSource === undefined) {
		failures.push("git boundary requires show_commit.rs");
		return failures;
	}
	const executableShowCommit = stripRustCommentsOnly(showCommitSource);
	if (/"show"/.test(executableShowCommit)) {
		failures.push(
			'show_commit.rs must never spawn `git show` (the literal string "show" must not ' +
				"appear anywhere in its executable source) — see this file's own module doc " +
				"comment for why a plain two-explicit-revision `git diff` replaces it entirely",
		);
	}

	const showCommitBody = rustFunctionBody(executableShowCommit, "show_commit");
	if (showCommitBody === undefined) {
		failures.push("show_commit.rs must define a show_commit function");
		return failures;
	}
	const verifyCallIndex = showCommitBody.body.indexOf("verify_commit_exists(");
	const resolveParentCallIndex = showCommitBody.body.indexOf(
		"resolve_first_parent(",
	);
	if (
		verifyCallIndex < 0 ||
		resolveParentCallIndex < 0 ||
		verifyCallIndex >= resolveParentCallIndex
	) {
		failures.push(
			"show_commit's own function body must call verify_commit_exists strictly before " +
				"resolve_first_parent — neither %P nor --parents output alone can distinguish a " +
				"non-existent/non-commit object from a genuine root commit",
		);
	}
	const baseRevisionMatch =
		/base_revision\s*:\s*&\s*str\s*=\s*parent_sha\s*\.\s*as_deref\s*\(\s*\)\s*\.\s*unwrap_or\s*\(\s*EMPTY_TREE_SHA\s*\)\s*;/.exec(
			showCommitBody.body,
		);
	if (baseRevisionMatch === null) {
		failures.push(
			"show_commit's own base_revision must be built from parent_sha.as_deref().unwrap_or(EMPTY_TREE_SHA) " +
				"— never a bare sha positional or a sha^-style revspec suffix",
		);
	}

	return failures;
}

/**
 * `F090` S3's dedicated lock for `log.rs`'s graph command — kept as its own
 * exported function (not folded into `validateGitRustBoundary`'s generic
 * `argsConstant` checks) for the same reason `validateGitBlameHardeningArgs`
 * is: `GIT_LOG_GRAPH_ARGS`'s own format string
 * (`%H%x1f%P%x1f%s`) has an easy-to-miss footgun a plain array-equality
 * check does not fully guard — a future edit could insert a second
 * free-text field (e.g. `%an`) *before* `%s`, which would still leave the
 * array "looking similar" in a diff but reintroduce exactly the
 * delimiter-shift vulnerability `GIT_LOG_COMMIT_META_ARGS` itself was
 * fixed to avoid (see `log.rs`'s own module doc comment, "F090 S3: the
 * graph command's own format-string safety design"). This function
 * therefore locks two things together: the exact argument list itself, and
 * that `parse_graph_entries` actually parses it the safe way — a bounded
 * `splitn(3, ...)` (so the one attacker-controlled field, `%s`, safely
 * absorbs everything after the second delimiter, embedded `0x1f` bytes
 * included) rather than an unbounded split that would misparse a hostile
 * subject line into extra fields (proven reachable via entirely normal git
 * usage by `tests.rs`'s own
 * `log_graph_is_immune_to_a_hostile_subject_line_containing_a_unit_separator_byte`
 * fixture and its pure-function naive-split control group).
 */
export function validateGitLogGraphFormatStringBoundary(rustSources) {
	const failures = [];
	const logSource = findRustSource(rustSources, "src-tauri/src/git/log.rs");
	if (logSource === undefined) {
		failures.push("git boundary requires log.rs");
		return failures;
	}
	const executableLog = stripRustCommentsOnly(logSource);
	const constantPattern =
		/pub\s*\(\s*crate\s*\)\s+const\s+GIT_LOG_GRAPH_ARGS\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/;
	const match = constantPattern.exec(executableLog);
	const args = match?.[1]
		?.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		match === null ||
		!sameArray(args, [
			"log",
			"-z",
			"--format=%H%x1f%P%x1f%s",
			"--no-patch",
			"--topo-order",
			"--branches",
			"--tags",
			"--remotes",
		])
	) {
		failures.push(
			"log.rs must define GIT_LOG_GRAPH_ARGS as exactly the audited graph format string — " +
				"%s (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the two fixed-shape, git-computed %H/%P fields, and the ref-namespace scope " +
				"must remain --branches --tags --remotes (never --all, which also walks refs/stash)",
		);
	}

	const parseGraphEntriesBody = rustFunctionBody(
		executableLog,
		"parse_graph_entries",
	);
	if (parseGraphEntriesBody === undefined) {
		failures.push("log.rs must define a parse_graph_entries function");
		return failures;
	}
	if (!parseGraphEntriesBody.body.includes("splitn(3")) {
		failures.push(
			"parse_graph_entries must split each record with a bounded splitn(3, ...) — leaving " +
				"the subject field's own further bytes (including an attacker-embedded 0x1f) " +
				"untouched — never an unbounded split",
		);
	}
	if (parseGraphEntriesBody.body.includes(".split(|&byte| byte == 0x1f)")) {
		failures.push(
			"parse_graph_entries must never fall back to an unbounded split on 0x1f anywhere in " +
				"its own body — this is exactly the field-shift vulnerability this command's format " +
				"string is designed to avoid",
		);
	}

	return failures;
}

/**
 * `F090` S3's dedicated lock for `refs.rs` — kept as its own exported
 * function for the mirror-image reason `validateGitLogGraphFormatStringBoundary`
 * is: where `log`/`blame`'s own format strings need a single absorbing
 * free-text field because their content is genuinely attacker-controlled,
 * `for-each-ref`'s six fields are (per `refs.rs`'s own module doc comment)
 * structurally NUL-free *by git's own ref-name grammar* — no field ever
 * needs (or should) absorb an embedded separator. This function locks the
 * exact `GIT_FOR_EACH_REF_ARGS` format string/scope, and that `parse_refs`
 * actually takes advantage of that structural guarantee (a plain,
 * unbounded NUL split) rather than defensively (and misleadingly) using a
 * bounded `splitn` as if this command's fields carried the same risk
 * `log`/`blame`'s do.
 */
export function validateGitRefsFieldSafetyBoundary(rustSources) {
	const failures = [];
	const refsSource = findRustSource(rustSources, "src-tauri/src/git/refs.rs");
	if (refsSource === undefined) {
		failures.push("git boundary requires refs.rs");
		return failures;
	}
	const executableRefs = stripRustCommentsOnly(refsSource);
	const constantPattern =
		/pub\s*\(\s*crate\s*\)\s+const\s+GIT_FOR_EACH_REF_ARGS\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/;
	const match = constantPattern.exec(executableRefs);
	const args = match?.[1]
		?.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		match === null ||
		!sameArray(args, [
			"for-each-ref",
			"--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(upstream)%00%(HEAD)",
			"refs/heads",
			"refs/tags",
			"refs/remotes",
		])
	) {
		failures.push(
			"refs.rs must define GIT_FOR_EACH_REF_ARGS as exactly the audited six-field " +
				"for-each-ref format string, scoped to refs/heads, refs/tags and refs/remotes only " +
				"(never --all, which also walks refs/stash)",
		);
	}

	const parseRefsBody = rustFunctionBody(executableRefs, "parse_refs");
	if (parseRefsBody === undefined) {
		failures.push("refs.rs must define a parse_refs function");
		return failures;
	}
	if (!parseRefsBody.body.includes(".split(|&byte| byte == 0u8)")) {
		failures.push(
			"parse_refs must split each record's fields on a plain, unbounded NUL split — every " +
				"field here is structurally NUL-free by git's own ref-name grammar (see refs.rs's " +
				"own module doc comment), so no single-absorbing-field workaround is needed",
		);
	}
	if (parseRefsBody.body.includes("splitn(")) {
		failures.push(
			"parse_refs must never use a bounded splitn anywhere in its own body — doing so would " +
				"misleadingly suggest this command's fields carry the same attacker-controlled-" +
				"content risk log/blame's own format strings do, which this module's own doc " +
				"comment establishes they structurally do not",
		);
	}

	return failures;
}

/**
 * `F090` S4's dedicated lock for `stash.rs`'s own list command — kept as its
 * own exported function (not folded into `validateGitRustBoundary`'s generic
 * `argsConstant` checks) for the same reason
 * `validateGitLogGraphFormatStringBoundary` is: a stash entry's own message
 * is entirely user-supplied (`git stash push -m <message>` accepts arbitrary
 * bytes, including this format string's own `0x1f` separator — confirmed
 * empirically, this slice's own report), so `GIT_STASH_LIST_ARGS` needs the
 * same "one absorbing free-text field, positioned last" discipline
 * `GIT_LOG_COMMIT_META_ARGS`/`GIT_LOG_GRAPH_ARGS` already established for
 * this domain, and a plain array-equality check alone would not catch a
 * future edit that silently reordered the fields or added a second free-text
 * one before `%B`. This function locks two things together: the exact
 * argument list itself, and that `parse_stash_list` actually parses it the
 * safe way — a bounded `splitn(4, ...)` (so the one attacker-controlled
 * field, `%B`, safely absorbs everything after the third delimiter, embedded
 * `0x1f` bytes included) rather than an unbounded split that would misparse
 * a hostile message into extra fields (proven reachable via entirely normal
 * git usage by `tests.rs`'s own
 * `list_stashes_is_immune_to_a_hostile_message_containing_a_unit_separator_byte`
 * fixture and its pure-function naive-split control group,
 * `parse_stash_list_splitn_is_not_confused_by_a_message_containing_an_embedded_separator_byte`).
 */
export function validateGitStashMessageFieldSafetyBoundary(rustSources) {
	const failures = [];
	const stashSource = findRustSource(rustSources, "src-tauri/src/git/stash.rs");
	if (stashSource === undefined) {
		failures.push("git boundary requires stash.rs");
		return failures;
	}
	const executableStash = stripRustCommentsOnly(stashSource);
	const constantPattern =
		/pub\s*\(\s*crate\s*\)\s+const\s+GIT_STASH_LIST_ARGS\s*:\s*&\[&str\]\s*=\s*&\[([^\]]*)\]\s*;/;
	const match = constantPattern.exec(executableStash);
	const args = match?.[1]
		?.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.replace(/^"|"$/g, ""));
	if (
		match === null ||
		!sameArray(args, ["stash", "list", "-z", "--format=%gd%x1f%H%x1f%ct%x1f%B"])
	) {
		failures.push(
			"stash.rs must define GIT_STASH_LIST_ARGS as exactly the audited format string — " +
				"%B (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the three fixed-shape, git-computed %gd/%H/%ct fields",
		);
	}

	const parseStashListBody = rustFunctionBody(
		executableStash,
		"parse_stash_list",
	);
	if (parseStashListBody === undefined) {
		failures.push("stash.rs must define a parse_stash_list function");
		return failures;
	}
	if (!parseStashListBody.body.includes("splitn(4")) {
		failures.push(
			"parse_stash_list must split each record with a bounded splitn(4, ...) — leaving " +
				"the message field's own further bytes (including an attacker-embedded 0x1f) " +
				"untouched — never an unbounded split",
		);
	}
	if (parseStashListBody.body.includes(".split(|&byte| byte == 0x1f)")) {
		failures.push(
			"parse_stash_list must never fall back to an unbounded split on 0x1f anywhere in " +
				"its own body — this is exactly the field-shift vulnerability this command's format " +
				"string is designed to avoid",
		);
	}

	return failures;
}

/**
 * `F080` S1's three read methods, `F080` S3's five write methods
 * (`git_stage_paths`/`git_unstage_paths`/`git_stage_blob`/`git_commit`/
 * `git_discard_paths`), `F080` S4's five network methods
 * (`git_network_preview`/`git_fetch`/`git_pull`/`git_push`/
 * `git_network_cancel`), `F090` S0's two read-only blame methods
 * (`gitBlameFile`/`gitBlameCommitMessages`), `F090` S1's three
 * read-only file/line-history methods (`gitFileHistory`/
 * `gitLineHistoryList`/`gitLineHistoryDetail`), `F090` S2's two
 * read-only commit-detail methods (`gitShowCommit`/`gitShowCommitBlob`),
 * `F090` S3's two read-only graph/refs methods (`gitLogGraph`/
 * `gitRefsList`), `F090` S4's six stash methods (`gitStashList`/
 * `gitStashShow`/`gitStashPush`/`gitStashApply`/`gitStashPop`/
 * `gitStashDrop`), and `F090` S5's three worktree methods (`gitWorktreeList`/
 * `gitWorktreeAdd`/`gitWorktreeRemove`) — every slice deliberately shares
 * this same closed-list lock rather than getting its own parallel
 * "S_ bridge methods" const, for the same reason `GIT_COMMAND_CONTRACTS`
 * above holds all thirty-one Rust commands in one array: `PlainBridge`'s git
 * surface is one audited whole, not several independently-sized ones.
 */
const GIT_BRIDGE_METHOD_NAMES = [
	"gitStatus",
	"gitDiffFiles",
	"gitShowBlob",
	"gitStagePaths",
	"gitUnstagePaths",
	"gitStageBlob",
	"gitCommit",
	"gitDiscardPaths",
	"gitNetworkPreview",
	"gitFetch",
	"gitPull",
	"gitPush",
	"gitNetworkCancel",
	"gitBlameFile",
	"gitBlameCommitMessages",
	"gitFileHistory",
	"gitLineHistoryList",
	"gitLineHistoryDetail",
	"gitShowCommit",
	"gitShowCommitBlob",
	"gitLogGraph",
	"gitRefsList",
	"gitStashList",
	"gitStashShow",
	"gitStashPush",
	"gitStashApply",
	"gitStashPop",
	"gitStashDrop",
	"gitWorktreeList",
	"gitWorktreeAdd",
	"gitWorktreeRemove",
];

/**
 * The five `F080` S3 write commands, plus `F080` S4's `git_push` (the one
 * S4 command that carries a payload — `force`), mapped to their exact
 * command-name string and the audited frontend `frozen*Request` builder
 * `native.ts` must route the call's arguments through before invoking —
 * mirrors `frozenGitDiffFilesRequest`/`frozenGitShowBlobRequest`'s existing
 * S1 precedent for validating a request's shape at the TypeScript boundary
 * before it ever reaches `invoke`. `git_fetch`/`git_pull`/
 * `git_network_cancel` take no payload at all (an empty `{}` request, same
 * shape as `git_status`) and so have no builder to route through — see
 * [`GIT_NO_ARG_COMMAND_CONTRACTS`] for those three instead.
 */
const GIT_WRITE_COMMAND_CONTRACTS = Object.freeze([
	Object.freeze({
		command: "git_stage_paths",
		requestBuilder: "frozenGitStagePathsRequest",
	}),
	Object.freeze({
		command: "git_unstage_paths",
		requestBuilder: "frozenGitUnstagePathsRequest",
	}),
	Object.freeze({
		command: "git_stage_blob",
		requestBuilder: "frozenGitStageBlobRequest",
	}),
	Object.freeze({
		command: "git_commit",
		requestBuilder: "frozenGitCommitRequest",
	}),
	Object.freeze({
		command: "git_discard_paths",
		requestBuilder: "frozenGitDiscardPathsRequest",
	}),
	Object.freeze({
		command: "git_push",
		requestBuilder: "frozenGitPushRequest",
	}),
	Object.freeze({
		command: "git_stash_drop",
		requestBuilder: "frozenGitStashDropRequest",
	}),
]);

/**
 * `F080` S4's three no-payload network commands (`git_fetch`/`git_pull`/
 * `git_network_cancel`) — same "invoked exactly once" rigor
 * [`GIT_WRITE_COMMAND_CONTRACTS`] applies, but with no request builder to
 * check (mirrors how `git_status` itself, S1's own no-payload read, is
 * checked below: invocation count only).
 */
const GIT_NO_ARG_COMMAND_CONTRACTS = Object.freeze([
	"git_fetch",
	"git_pull",
	"git_network_cancel",
]);

/**
 * Locks `F080` S1+S3+S4 and `F090` S0+S1+S2+S3+S4+S5's TypeScript surface:
 * `PlainBridge` exposes exactly the thirty-one audited git methods,
 * `git-codec.ts`'s read-result decoders validate exact own-data keys/reject
 * Proxy wrapping/freeze their result (same rigor
 * `validateTerminalIpcBridgeBoundary` already locks for the terminal
 * domain), and `native.ts` routes each read/write through `invoke` with its
 * audited command name — the reads through their audited decoders, the
 * seven mutating writes (`GIT_WRITE_COMMAND_CONTRACTS`, including `F090`
 * S4's own void-returning `git_stash_drop`) through their audited
 * `frozen*Request` builders and `decodeGitVoid`, and the three no-payload
 * network commands (`GIT_NO_ARG_COMMAND_CONTRACTS`) invoked exactly once
 * each. `git_refs_list` (`F090` S3) is a fourth no-payload read, but unlike
 * those three it returns a real decoded result rather than void, so it gets
 * its own dedicated check just below rather than joining
 * `GIT_NO_ARG_COMMAND_CONTRACTS`.
 */
export function validateGitIpcBridgeBoundary(rustSources, appSources) {
	const failures = [];
	const appSource = (expectedPath) =>
		appSources.find(
			({ relativePath }) => relativePath.replaceAll("\\", "/") === expectedPath,
		)?.source;

	const contracts = appSource("app/platform/tauri/contracts.ts");
	const contractsFile =
		contracts === undefined
			? undefined
			: ts.createSourceFile(
					"contracts.ts",
					contracts,
					ts.ScriptTarget.Latest,
					true,
					ts.ScriptKind.TS,
				);
	const plainBridgeInterfaces =
		contractsFile?.statements.filter(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === "PlainBridge",
		) ?? [];
	const bridgeMembers =
		plainBridgeInterfaces[0]?.members.filter((member) =>
			GIT_BRIDGE_METHOD_NAMES.includes(typeScriptStaticName(member.name)),
		) ?? [];
	const bridgeMemberNames = bridgeMembers
		.map((member) => typeScriptStaticName(member.name))
		.sort();
	if (
		plainBridgeInterfaces.length !== 1 ||
		bridgeMembers.length !== GIT_BRIDGE_METHOD_NAMES.length ||
		!bridgeMembers.every((member) => ts.isMethodSignature(member)) ||
		JSON.stringify(bridgeMemberNames) !==
			JSON.stringify([...GIT_BRIDGE_METHOD_NAMES].sort())
	) {
		failures.push(
			"PlainBridge must expose exactly the thirty-one audited git methods, no more and no fewer",
		);
	}

	const gitCodec = appSource("app/platform/tauri/git-codec.ts");
	const decoderBody = (name) => {
		if (gitCodec === undefined) {
			return undefined;
		}
		const functions = extractRustLikeTypeScriptFunctionBodies(gitCodec, name);
		return functions.length === 1 ? functions[0] : undefined;
	};
	for (const name of [
		"decodeGitStatusResult",
		"decodeGitDiffFilesResult",
		"decodeGitShowBlobResult",
		"decodeGitNetworkPreviewResult",
		"decodeGitBlameFileResult",
		"decodeGitBlameCommitMessagesResult",
		"decodeGitHistoryListResult",
		"decodeGitLineHistoryDetailResult",
		"decodeGitShowCommitResult",
		"decodeGitLogGraphResult",
		"decodeGitRefsListResult",
		"decodeGitStashListResult",
		"decodeGitStashShowResult",
		"decodeGitStashApplyOutcome",
		"decodeGitWorktreeListResult",
		"decodeGitWorktreeAddOutcome",
	]) {
		const body = decoderBody(name);
		if (
			body === undefined ||
			!body.includes("hasExactKeys(") ||
			!body.includes("rejectProxyObject(") ||
			!body.includes("Object.freeze(")
		) {
			failures.push(
				`git-codec.ts's ${name} must validate exact own-data keys, reject Proxy wrapping, and freeze its result`,
			);
		}
	}
	// `decodeGitStashPushOutcome` decodes a bare own-data string (one of the
	// two audited outcomes), not a `{ ... }` object — `hasExactKeys`/
	// `rejectProxyObject`/`Object.freeze` do not apply to it, so it gets its
	// own, differently-shaped check rather than joining the loop above.
	{
		const body = decoderBody("decodeGitStashPushOutcome");
		if (
			body === undefined ||
			!body.includes('typeof value !== "string"') ||
			!body.includes("GIT_STASH_PUSH_OUTCOMES.has(")
		) {
			failures.push(
				"git-codec.ts's decodeGitStashPushOutcome must validate value is one of the exact two audited outcome strings",
			);
		}
	}
	// `decodeGitWorktreeRemoveOutcome` decodes a bare own-data string (one of
	// the two audited outcomes) — same differently-shaped check as
	// `decodeGitStashPushOutcome` above, for the same reason.
	{
		const body = decoderBody("decodeGitWorktreeRemoveOutcome");
		if (
			body === undefined ||
			!body.includes('typeof value !== "string"') ||
			!body.includes("GIT_WORKTREE_REMOVE_OUTCOMES.has(")
		) {
			failures.push(
				"git-codec.ts's decodeGitWorktreeRemoveOutcome must validate value is one of the exact two audited outcome strings",
			);
		}
	}

	const native = appSource("app/platform/tauri/native.ts");
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_status"/g)].length !== 1 ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_diff_files"/g)].length !==
			1 ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_show_blob"/g)].length !==
			1 ||
		!native.includes("decodeGitStatusResult(") ||
		!native.includes("decodeGitDiffFilesResult(") ||
		!native.includes("decodeGitShowBlobResult(")
	) {
		failures.push(
			"native.ts must invoke git_status/git_diff_files/git_show_blob exactly once each, decoded through the audited decoders",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_network_preview"/g)]
			.length !== 1 ||
		!native.includes("frozenGitNetworkPreviewRequest(") ||
		!native.includes("decodeGitNetworkPreviewResult(")
	) {
		failures.push(
			"native.ts must invoke git_network_preview exactly once, routed through frozenGitNetworkPreviewRequest and decoded through decodeGitNetworkPreviewResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_blame_file"/g)].length !==
			1 ||
		!native.includes("frozenGitBlameFileRequest(") ||
		!native.includes("decodeGitBlameFileResult(")
	) {
		failures.push(
			"native.ts must invoke git_blame_file exactly once, routed through frozenGitBlameFileRequest and decoded through decodeGitBlameFileResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_blame_commit_messages"/g)]
			.length !== 1 ||
		!native.includes("frozenGitBlameCommitMessagesRequest(") ||
		!native.includes("decodeGitBlameCommitMessagesResult(")
	) {
		failures.push(
			"native.ts must invoke git_blame_commit_messages exactly once, routed through frozenGitBlameCommitMessagesRequest and decoded through decodeGitBlameCommitMessagesResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_file_history"/g)].length !==
			1 ||
		!native.includes("frozenGitFileHistoryRequest(") ||
		!native.includes("decodeGitHistoryListResult(")
	) {
		failures.push(
			"native.ts must invoke git_file_history exactly once, routed through frozenGitFileHistoryRequest and decoded through decodeGitHistoryListResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_line_history_list"/g)]
			.length !== 1 ||
		!native.includes("frozenGitLineHistoryListRequest(") ||
		!native.includes("decodeGitHistoryListResult(")
	) {
		failures.push(
			"native.ts must invoke git_line_history_list exactly once, routed through frozenGitLineHistoryListRequest and decoded through decodeGitHistoryListResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_line_history_detail"/g)]
			.length !== 1 ||
		!native.includes("frozenGitLineHistoryDetailRequest(") ||
		!native.includes("decodeGitLineHistoryDetailResult(")
	) {
		failures.push(
			"native.ts must invoke git_line_history_detail exactly once, routed through frozenGitLineHistoryDetailRequest and decoded through decodeGitLineHistoryDetailResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_show_commit"/g)].length !==
			1 ||
		!native.includes("frozenGitShowCommitRequest(") ||
		!native.includes("decodeGitShowCommitResult(")
	) {
		failures.push(
			"native.ts must invoke git_show_commit exactly once, routed through frozenGitShowCommitRequest and decoded through decodeGitShowCommitResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_show_commit_blob"/g)]
			.length !== 1 ||
		!native.includes("frozenGitShowCommitBlobRequest(") ||
		// Reuses `decodeGitShowBlobResult` verbatim — `git_show_commit_blob`
		// returns the exact same `{ content }` wire shape `git_show_blob`
		// does (see `dto.rs`'s `GitShowCommitBlobRequest`'s own module
		// comment), so this is deliberately not a third, near-duplicate
		// decoder.
		!native.includes("decodeGitShowBlobResult(")
	) {
		failures.push(
			"native.ts must invoke git_show_commit_blob exactly once, routed through frozenGitShowCommitBlobRequest and decoded through decodeGitShowBlobResult",
		);
	}

	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_log_graph"/g)].length !==
			1 ||
		!native.includes("frozenGitLogGraphRequest(") ||
		!native.includes("decodeGitLogGraphResult(")
	) {
		failures.push(
			"native.ts must invoke git_log_graph exactly once, routed through frozenGitLogGraphRequest and decoded through decodeGitLogGraphResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_refs_list"/g)].length !==
			1 ||
		// `git_refs_list` takes no payload at all (the same `{ request: {} }`
		// shape `git_fetch`/`git_pull`/`git_network_cancel` use) — there is no
		// `frozenGitRefsListRequest` builder to route through, only its result
		// decoder.
		!native.includes("decodeGitRefsListResult(")
	) {
		failures.push(
			"native.ts must invoke git_refs_list exactly once, decoded through decodeGitRefsListResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_stash_list"/g)].length !==
			1 ||
		// `git_stash_list` takes no payload at all — same shape as
		// `git_refs_list` above, no `frozenGitStashListRequest` builder exists.
		!native.includes("decodeGitStashListResult(")
	) {
		failures.push(
			"native.ts must invoke git_stash_list exactly once, decoded through decodeGitStashListResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_stash_show"/g)].length !==
			1 ||
		!native.includes("frozenGitStashShowRequest(") ||
		!native.includes("decodeGitStashShowResult(")
	) {
		failures.push(
			"native.ts must invoke git_stash_show exactly once, routed through frozenGitStashShowRequest and decoded through decodeGitStashShowResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_stash_push"/g)].length !==
			1 ||
		!native.includes("frozenGitStashPushRequest(") ||
		!native.includes("decodeGitStashPushOutcome(")
	) {
		failures.push(
			"native.ts must invoke git_stash_push exactly once, routed through frozenGitStashPushRequest and decoded through decodeGitStashPushOutcome",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_stash_apply"/g)].length !==
			1 ||
		!native.includes("frozenGitStashApplyRequest(") ||
		// `decodeGitStashApplyOutcome` is shared verbatim with `git_stash_pop`
		// below — see `GitStashApplyOutcome`'s own doc comment for why the two
		// bridge methods' response shape is identical.
		!native.includes("decodeGitStashApplyOutcome(")
	) {
		failures.push(
			"native.ts must invoke git_stash_apply exactly once, routed through frozenGitStashApplyRequest and decoded through decodeGitStashApplyOutcome",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_stash_pop"/g)].length !==
			1 ||
		!native.includes("frozenGitStashPopRequest(") ||
		!native.includes("decodeGitStashApplyOutcome(")
	) {
		failures.push(
			"native.ts must invoke git_stash_pop exactly once, routed through frozenGitStashPopRequest and decoded through decodeGitStashApplyOutcome",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_worktree_list"/g)]
			.length !== 1 ||
		// `git_worktree_list` takes no payload at all — same shape as
		// `git_refs_list`/`git_stash_list` above, no
		// `frozenGitWorktreeListRequest` builder exists.
		!native.includes("decodeGitWorktreeListResult(")
	) {
		failures.push(
			"native.ts must invoke git_worktree_list exactly once, decoded through decodeGitWorktreeListResult",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_worktree_add"/g)].length !==
			1 ||
		!native.includes("frozenGitWorktreeAddRequest(") ||
		!native.includes("decodeGitWorktreeAddOutcome(")
	) {
		failures.push(
			"native.ts must invoke git_worktree_add exactly once, routed through frozenGitWorktreeAddRequest and decoded through decodeGitWorktreeAddOutcome",
		);
	}
	if (
		native === undefined ||
		[...native.matchAll(/\binvoke<unknown>\(\s*"git_worktree_remove"/g)]
			.length !== 1 ||
		!native.includes("frozenGitWorktreeRemoveRequest(") ||
		!native.includes("decodeGitWorktreeRemoveOutcome(")
	) {
		failures.push(
			"native.ts must invoke git_worktree_remove exactly once, routed through frozenGitWorktreeRemoveRequest and decoded through decodeGitWorktreeRemoveOutcome",
		);
	}

	for (const { command, requestBuilder } of GIT_WRITE_COMMAND_CONTRACTS) {
		const invokePattern = new RegExp(
			`\\binvoke<unknown>\\(\\s*"${command}"`,
			"g",
		);
		if (
			native === undefined ||
			[...native.matchAll(invokePattern)].length !== 1 ||
			!native.includes(`${requestBuilder}(`)
		) {
			failures.push(
				`native.ts must invoke ${command} exactly once, routed through ${requestBuilder}`,
			);
		}
	}
	for (const command of GIT_NO_ARG_COMMAND_CONTRACTS) {
		const invokePattern = new RegExp(
			`\\binvoke<unknown>\\(\\s*"${command}"`,
			"g",
		);
		if (
			native === undefined ||
			[...native.matchAll(invokePattern)].length !== 1
		) {
			failures.push(`native.ts must invoke ${command} exactly once`);
		}
	}
	if (native === undefined || !native.includes("decodeGitVoid(")) {
		failures.push(
			"native.ts must decode every F080 S3/S4 git void-returning command's response through decodeGitVoid",
		);
	}

	return failures;
}

const GIT_DISCARD_VIEW_PATH = "app/features/scm/plain-scm-view.ts";
const GIT_DISCARD_MODULE_PATH = "app/features/scm/plain-scm-discard.ts";

/**
 * The three files that may reference the `gitDiscardPaths` identifier at all
 * without it being a business call: `contracts.ts` declares the `PlainBridge`
 * method signature, `native.ts` defines the real bridge's forwarding
 * implementation (routing to the `git_discard_paths` Tauri command), and
 * `browser-mock.ts` defines the in-browser mock's implementation. None of
 * these three is a *call* to `gitDiscardPaths` — mirrors how
 * `validateWorkspaceDeleteTypeScriptBoundary`'s `declarationPaths` separates
 * "defines/forwards" from "invokes" for the confirmed-delete bridge methods.
 */
const GIT_DISCARD_DECLARATION_PATHS = Object.freeze([
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
]);

/**
 * `F080` S3's `gitDiscardPaths` is an irreversible working-tree write (see
 * `PlainBridge.gitDiscardPaths`'s own doc comment: "This call performs the
 * discard unconditionally; the caller must have already confirmed with the
 * user"). Nothing at the Rust command or bridge-interface layer enforces
 * that — today it holds only because `PlainScmView.discardResources` is the
 * sole caller and it always awaits `resolveDiscardConfirmation` first. A
 * later slice (F090's planned blame/history/graph SCM views) could easily
 * grow a second call site that skips the gate, and `pnpm check` would stay
 * green. This mirrors `validateWorkspaceDeleteTypeScriptBoundary`'s
 * confirmed-delete precedent for this codebase's *other* irreversible write,
 * at the same rigor: lock the bridge method to its one production call site
 * (`PlainScmView.discardResources`), lock that call site's exact
 * confirm-then-call body shape, and lock `plain-scm-discard.ts`'s own
 * audited module face so it can never grow a bridge call or a
 * dialog-skipping branch of its own.
 */
export function validateGitDiscardConfirmationBoundary(appSources) {
	const failures = [];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		...GIT_DISCARD_DECLARATION_PATHS,
		GIT_DISCARD_VIEW_PATH,
		GIT_DISCARD_MODULE_PATH,
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(
				`git discard confirmation boundary requires ${relativePath}`,
			);
		}
	}

	function containingMethodName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isMethodDeclaration(current) ||
				ts.isFunctionDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	const declarationCounts = new Map(
		GIT_DISCARD_DECLARATION_PATHS.map((relativePath) => [relativePath, 0]),
	);
	let auditedCallCount = 0;

	for (const [normalizedPath, source] of normalizedSources) {
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);

		function visit(node) {
			const referencesMethod =
				(ts.isIdentifier(node) && node.text === "gitDiscardPaths") ||
				((ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
					node.text === "gitDiscardPaths");
			if (referencesMethod) {
				const parent = node.parent;
				const isAllowedDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				if (isAllowedDeclaration) {
					declarationCounts.set(
						normalizedPath,
						declarationCounts.get(normalizedPath) + 1,
					);
				} else {
					const propertyAccess = ts.isIdentifier(node) ? parent : undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const isAuditedCall =
						directCall !== undefined &&
						normalizedPath === GIT_DISCARD_VIEW_PATH &&
						containingMethodName(node) === "discardResources" &&
						directCall.arguments.length === 1 &&
						directCall.arguments[0]
							.getText(sourceFile)
							.replaceAll(/\s+/g, "") === "relativePaths";
					if (isAuditedCall) {
						auditedCallCount += 1;
					} else {
						failures.push(
							`${normalizedPath} must not consume gitDiscardPaths outside PlainScmView.discardResources's single audited call site`,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const [relativePath, count] of declarationCounts) {
		if (count !== 1) {
			failures.push(
				`${relativePath} must declare gitDiscardPaths exactly once in its audited bridge surface`,
			);
		}
	}
	if (auditedCallCount !== 1) {
		failures.push(
			"gitDiscardPaths must have exactly one production call site, inside PlainScmView.discardResources",
		);
	}

	const viewSource = normalizedSources.get(GIT_DISCARD_VIEW_PATH);
	if (viewSource !== undefined) {
		failures.push(...validateDiscardResourcesGuardedCall(viewSource));
	}
	const discardModuleSource = normalizedSources.get(GIT_DISCARD_MODULE_PATH);
	if (discardModuleSource !== undefined) {
		failures.push(
			...validateDiscardConfirmationModuleFace(discardModuleSource),
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks `PlainScmView.discardResources` to the exact "await the
 * confirmation, return unless it is exactly `\"confirmed\"`, only then call
 * the discard bridge" shape — mirrors
 * `workspaceDeleteCommandBodyIsExact`/`exactFunctionBody`'s own "precise
 * method body" technique for this codebase's other irreversible write.
 * There is deliberately no looser structural check (e.g. "confirm is called
 * somewhere before the discard call"): a fixed body is the only way to rule
 * out a second, differently-shaped bridge call slipping in unnoticed.
 */
function validateDiscardResourcesGuardedCall(source) {
	const sourceFile = ts.createSourceFile(
		GIT_DISCARD_VIEW_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-view.ts must remain valid TypeScript"];
	}
	const methods = [];
	function visit(node) {
		if (
			ts.isMethodDeclaration(node) &&
			typeScriptStaticName(node.name) === "discardResources"
		) {
			methods.push(node);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const expectedBody = `{
		const decision = await resolveDiscardConfirmation(
			this.dialogService,
			relativePaths,
		);
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);
	}`.replaceAll(/\s+/g, "");
	if (
		methods.length !== 1 ||
		methods[0].body === undefined ||
		methods[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !== expectedBody
	) {
		return [
			'PlainScmView.discardResources must await resolveDiscardConfirmation, return unless its result is exactly "confirmed", and only then call bridge.gitDiscardPaths — no other shape may reach the discard bridge call',
		];
	}
	return [];
}

/**
 * Locks `plain-scm-discard.ts`'s own audited module face: it must import
 * nothing at all (the module doc comment's "DOM/service-free" claim,
 * enforced structurally — an import is the only way this module could ever
 * reach a bridge, `invoke`, or a real Workbench service to perform the
 * discard itself rather than merely deciding whether the caller may), its
 * top-level declarations must match the exact audited set (so a future edit
 * cannot quietly add a helper that reaches a bridge), and
 * `resolveDiscardConfirmation` itself must match the exact audited
 * no-op/confirm/decline body — which simultaneously proves it never calls a
 * bridge method and never has a branch that skips the dialog for a
 * non-empty path list. Mirrors
 * `validateWorkspaceDeleteCoordinatorRoute`'s own import/top-level/exact-body
 * locks for `delete-coordinator.ts`.
 */
function validateDiscardConfirmationModuleFace(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		GIT_DISCARD_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-discard.ts must remain valid TypeScript"];
	}

	if (
		sourceFile.statements.some((statement) => ts.isImportDeclaration(statement))
	) {
		failures.push(
			"plain-scm-discard.ts must not import anything — it only ever decides whether the caller may discard, and an import is the only way it could ever reach a bridge or service to perform the discard itself",
		);
	}

	const expectedTopLevel = new Map([
		["DiscardConfirmDialogService", { kind: "interface", exported: true }],
		["MAX_NAMED_PATHS_IN_DETAIL", { kind: "variable", exported: false }],
		["discardConfirmationMessage", { kind: "function", exported: true }],
		["discardConfirmationDetail", { kind: "function", exported: true }],
		["DISCARD_CONFIRM_PRIMARY_BUTTON", { kind: "variable", exported: true }],
		["DiscardDecision", { kind: "type", exported: true }],
		[
			"resolveDiscardConfirmation",
			{ kind: "function", exported: true, async: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isTypeAliasDeclaration(statement)) {
			name = statement.name;
			kind = "type";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"plain-scm-discard.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	}

	const resolveFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "resolveDiscardConfirmation",
	);
	const expectedResolveBody = `{
		if (relativePaths.length === 0) {
			return Object.freeze({ kind: "no-op" });
		}
		const confirmation = await dialogService.confirm({
			message: discardConfirmationMessage(relativePaths),
			detail: discardConfirmationDetail(relativePaths),
			primaryButton: DISCARD_CONFIRM_PRIMARY_BUTTON,
		});
		return Object.freeze({
			kind: confirmation.confirmed ? "confirmed" : "declined",
		});
	}`.replaceAll(/\s+/g, "");
	if (
		resolveFunctions.length !== 1 ||
		resolveFunctions[0].body === undefined ||
		resolveFunctions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedResolveBody
	) {
		failures.push(
			"resolveDiscardConfirmation must, for a non-empty path list, unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited no-op/confirm/decline shape",
		);
	}
	return failures;
}

const GIT_NETWORK_MODULE_PATH = "app/features/scm/plain-scm-network.ts";

/**
 * `F080` S4's three confirm-gated network bridge methods, each mapped to the
 * one `PlainScmView` method allowed to call it and the exact argument list
 * that call must pass — mirrors `GIT_DISCARD_DECLARATION_PATHS`'s "declares
 * vs. calls" split, generalized from discard's single bridge method to
 * three (`gitFetch`/`gitPull`/`gitPush`), one audit entry each.
 */
const GIT_NETWORK_BRIDGE_METHOD_AUDITS = Object.freeze([
	Object.freeze({
		bridgeMethod: "gitFetch",
		containingMethod: "fetchFromRemote",
		argumentTexts: Object.freeze([]),
	}),
	Object.freeze({
		bridgeMethod: "gitPull",
		containingMethod: "pullFromRemote",
		argumentTexts: Object.freeze([]),
	}),
	Object.freeze({
		bridgeMethod: "gitPush",
		containingMethod: "pushToRemote",
		argumentTexts: Object.freeze(["force"]),
	}),
]);

/**
 * `F080` S4's `gitFetch`/`gitPull`/`gitPush` are each a network write ADR
 * 0003 requires a preview + confirmation for before ever running (acceptance
 * criterion 5) — the same "nothing at the Rust/bridge-interface layer
 * enforces this, only one audited call site per method does" situation
 * `validateGitDiscardConfirmationBoundary` already locks for `F080` S3's
 * `gitDiscardPaths`, generalized here from one bridge method to three. Locks:
 * each method's bridge declaration to its audited three files
 * (`GIT_DISCARD_DECLARATION_PATHS`, reused — same contracts.ts/native.ts/
 * browser-mock.ts split as discard), each method's single production call
 * site to its own audited `PlainScmView` method with the exact argument list
 * `GIT_NETWORK_BRIDGE_METHOD_AUDITS` names, that call site's exact
 * preview-then-confirm-then-call body shape, and `plain-scm-network.ts`'s
 * own audited module face (mirrors `validateDiscardConfirmationModuleFace`).
 */
export function validateGitNetworkConfirmationBoundary(appSources) {
	const failures = [];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		...GIT_DISCARD_DECLARATION_PATHS,
		GIT_DISCARD_VIEW_PATH,
		GIT_NETWORK_MODULE_PATH,
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(
				`git network confirmation boundary requires ${relativePath}`,
			);
		}
	}

	function containingMethodName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isMethodDeclaration(current) ||
				ts.isFunctionDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	const bridgeMethodNames = GIT_NETWORK_BRIDGE_METHOD_AUDITS.map(
		(audit) => audit.bridgeMethod,
	);
	const declarationCounts = new Map(
		GIT_DISCARD_DECLARATION_PATHS.flatMap((relativePath) =>
			bridgeMethodNames.map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	const auditedCallCounts = new Map(
		bridgeMethodNames.map((bridgeMethod) => [bridgeMethod, 0]),
	);

	for (const [normalizedPath, source] of normalizedSources) {
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);

		function visit(node) {
			const isNameLike =
				ts.isIdentifier(node) ||
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node);
			const audit = isNameLike
				? GIT_NETWORK_BRIDGE_METHOD_AUDITS.find(
						(candidate) => candidate.bridgeMethod === node.text,
					)
				: undefined;
			if (audit !== undefined) {
				const bridgeMethod = audit.bridgeMethod;
				const parent = node.parent;
				const isAllowedDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				if (isAllowedDeclaration) {
					const key = `${normalizedPath}:${bridgeMethod}`;
					declarationCounts.set(key, declarationCounts.get(key) + 1);
				} else {
					const propertyAccess = ts.isIdentifier(node) ? parent : undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const argumentTexts =
						directCall?.arguments.map((argument) =>
							argument.getText(sourceFile).replaceAll(/\s+/g, ""),
						) ?? [];
					const isAuditedCall =
						directCall !== undefined &&
						normalizedPath === GIT_DISCARD_VIEW_PATH &&
						containingMethodName(node) === audit.containingMethod &&
						sameArray(argumentTexts, audit.argumentTexts);
					if (isAuditedCall) {
						auditedCallCounts.set(
							bridgeMethod,
							auditedCallCounts.get(bridgeMethod) + 1,
						);
					} else {
						failures.push(
							`${normalizedPath} must not consume ${bridgeMethod} outside PlainScmView.${audit.containingMethod}'s single audited call site`,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const [key, count] of declarationCounts) {
		if (count !== 1) {
			const [relativePath, bridgeMethod] = key.split(":");
			failures.push(
				`${relativePath} must declare ${bridgeMethod} exactly once in its audited bridge surface`,
			);
		}
	}
	for (const audit of GIT_NETWORK_BRIDGE_METHOD_AUDITS) {
		if (auditedCallCounts.get(audit.bridgeMethod) !== 1) {
			failures.push(
				`${audit.bridgeMethod} must have exactly one production call site, inside PlainScmView.${audit.containingMethod}`,
			);
		}
	}

	const viewSource = normalizedSources.get(GIT_DISCARD_VIEW_PATH);
	if (viewSource !== undefined) {
		failures.push(...validateNetworkMutationGuardedCalls(viewSource));
	}
	const networkModuleSource = normalizedSources.get(GIT_NETWORK_MODULE_PATH);
	if (networkModuleSource !== undefined) {
		failures.push(
			...validateNetworkConfirmationModuleFace(networkModuleSource),
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks `PlainScmView.fetchFromRemote`/`pullFromRemote`/`pushToRemote` to
 * their exact "compute the preview, bail if unavailable, await the
 * confirmation, bail unless exactly `\"confirmed\"`, only then call the
 * network bridge" shapes — the `F080` S4 analogue of
 * `validateDiscardResourcesGuardedCall`, one audited body per method instead
 * of one overall (`pushToRemote`'s differs by reading the force checkbox and
 * passing `force` through both the preview kind and the bridge call).
 */
function validateNetworkMutationGuardedCalls(source) {
	const sourceFile = ts.createSourceFile(
		GIT_DISCARD_VIEW_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-view.ts must remain valid TypeScript"];
	}

	function methodBody(name) {
		const methods = [];
		function visit(node) {
			if (
				ts.isMethodDeclaration(node) &&
				typeScriptStaticName(node.name) === name
			) {
				methods.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
		return methods.length === 1 ? methods[0].body : undefined;
	}

	const expectedBodies = {
		fetchFromRemote: `{
			const preview = await this.previewNetworkOperation("fetch");
			if (preview === undefined) {
				return;
			}
			const decision = await resolveNetworkConfirmation(this.dialogService, {
				kind: "fetch",
				preview,
			});
			if (decision.kind !== "confirmed") {
				return;
			}
			await this.runNetworkMutation((bridge) => bridge.gitFetch());
		}`,
		pullFromRemote: `{
			const preview = await this.previewNetworkOperation("pull");
			if (preview === undefined) {
				return;
			}
			const decision = await resolveNetworkConfirmation(this.dialogService, {
				kind: "pull",
				preview,
			});
			if (decision.kind !== "confirmed") {
				return;
			}
			await this.runNetworkMutation((bridge) => bridge.gitPull());
		}`,
		pushToRemote: `{
			const force = this.#forcePushCheckbox?.checked ?? false;
			const kind = force ? "forcePush" : "push";
			const preview = await this.previewNetworkOperation(kind);
			if (preview === undefined) {
				return;
			}
			const decision = await resolveNetworkConfirmation(this.dialogService, {
				kind,
				preview,
			});
			if (decision.kind !== "confirmed") {
				return;
			}
			await this.runNetworkMutation((bridge) => bridge.gitPush(force));
		}`,
	};

	const failures = [];
	for (const [name, expectedBody] of Object.entries(expectedBodies)) {
		const body = methodBody(name);
		const normalizedExpected = expectedBody.replaceAll(/\s+/g, "");
		if (
			body === undefined ||
			body.getText(sourceFile).replaceAll(/\s+/g, "") !== normalizedExpected
		) {
			failures.push(
				`PlainScmView.${name} must match its exact audited preview-then-confirm-then-call shape — no other shape may reach the network bridge call`,
			);
		}
	}
	return failures;
}

/**
 * Locks `plain-scm-network.ts`'s own audited module face: it must import
 * nothing at all (an import is the only way this module could ever reach a
 * bridge or a real Workbench service to perform a network write itself), its
 * top-level declarations must match the exact audited set, and
 * `resolveNetworkConfirmation` itself must match the exact audited body —
 * which simultaneously proves it never calls a bridge method and never has a
 * branch that skips the dialog. Mirrors
 * `validateDiscardConfirmationModuleFace`'s exact technique.
 */
function validateNetworkConfirmationModuleFace(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		GIT_NETWORK_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-network.ts must remain valid TypeScript"];
	}

	if (
		sourceFile.statements.some((statement) => ts.isImportDeclaration(statement))
	) {
		failures.push(
			"plain-scm-network.ts must not import anything — it only ever decides whether the caller may fetch/pull/push, and an import is the only way it could ever reach a bridge or service to perform the network write itself",
		);
	}

	const expectedTopLevel = new Map([
		["NetworkConfirmDialogService", { kind: "interface", exported: true }],
		["NetworkConfirmationKind", { kind: "type", exported: true }],
		["NetworkConfirmationPreview", { kind: "interface", exported: true }],
		["NetworkConfirmationRequest", { kind: "interface", exported: true }],
		["describeUpstream", { kind: "function", exported: false }],
		["networkConfirmationMessage", { kind: "function", exported: true }],
		["networkConfirmationDetail", { kind: "function", exported: true }],
		["NETWORK_CONFIRM_PRIMARY_BUTTON", { kind: "variable", exported: true }],
		["NetworkConfirmDecision", { kind: "type", exported: true }],
		[
			"resolveNetworkConfirmation",
			{ kind: "function", exported: true, async: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isTypeAliasDeclaration(statement)) {
			name = statement.name;
			kind = "type";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"plain-scm-network.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	}

	const resolveFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "resolveNetworkConfirmation",
	);
	const expectedResolveBody = `{
		const confirmation = await dialogService.confirm({
			message: networkConfirmationMessage(request),
			detail: networkConfirmationDetail(request),
			primaryButton: NETWORK_CONFIRM_PRIMARY_BUTTON[request.kind],
		});
		return Object.freeze({
			kind: confirmation.confirmed ? "confirmed" : "declined",
		});
	}`.replaceAll(/\s+/g, "");
	if (
		resolveFunctions.length !== 1 ||
		resolveFunctions[0].body === undefined ||
		resolveFunctions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedResolveBody
	) {
		failures.push(
			"resolveNetworkConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	}
	return failures;
}

const GIT_STASH_VIEW_PATH = "app/features/scm/plain-git-stash-view.ts";
const GIT_STASH_MODULE_PATH = "app/features/scm/plain-scm-stash.ts";

/**
 * `F090` S4's two confirm-gated stash bridge methods, each mapped to the one
 * `PlainGitStashView` method allowed to call it and the exact argument list
 * that call must pass — mirrors `GIT_NETWORK_BRIDGE_METHOD_AUDITS`'s exact
 * shape, generalized from `PlainScmView`'s three network methods to
 * `PlainGitStashView`'s two stash ones. Only `gitStashPop`/`gitStashDrop` are
 * here — `gitStashPush`/`gitStashApply` are this feature's own "提示,不强确认"
 * half (see `plain-scm-stash.ts`'s own module doc comment) and so have no
 * confirmation gate to lock.
 */
const GIT_STASH_BRIDGE_METHOD_AUDITS = Object.freeze([
	Object.freeze({
		bridgeMethod: "gitStashPop",
		containingMethod: "popEntry",
		argumentTexts: Object.freeze(["entry.sha", "false"]),
	}),
	Object.freeze({
		bridgeMethod: "gitStashDrop",
		containingMethod: "dropEntry",
		argumentTexts: Object.freeze(["entry.sha"]),
	}),
]);

/**
 * `F090` S4's `gitStashPop`/`gitStashDrop` are each an irreversible-or-
 * effectively-irreversible write this feature's own frozen plan requires a
 * confirmation dialog before ever running — the same "nothing at the Rust/
 * bridge-interface layer enforces this, only one audited call site per
 * method does" situation `validateGitDiscardConfirmationBoundary`/
 * `validateGitNetworkConfirmationBoundary` already lock for this codebase's
 * other two irreversible writes, generalized here to a *third* view file
 * (`PlainGitStashView`, not `PlainScmView`) and confirmation module
 * (`plain-scm-stash.ts`, not `plain-scm-discard.ts`/`plain-scm-network.ts`).
 * Locks: each method's bridge declaration to its audited three files
 * (`GIT_DISCARD_DECLARATION_PATHS`, reused — same contracts.ts/native.ts/
 * browser-mock.ts split as discard/network), each method's single
 * production call site to its own audited `PlainGitStashView` method with
 * the exact argument list `GIT_STASH_BRIDGE_METHOD_AUDITS` names, that call
 * site's exact confirm-then-call body shape, and `plain-scm-stash.ts`'s own
 * audited module face (mirrors `validateNetworkConfirmationModuleFace`).
 */
export function validateGitStashConfirmationBoundary(appSources) {
	const failures = [];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		...GIT_DISCARD_DECLARATION_PATHS,
		GIT_STASH_VIEW_PATH,
		GIT_STASH_MODULE_PATH,
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(`git stash confirmation boundary requires ${relativePath}`);
		}
	}

	function containingMethodName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isMethodDeclaration(current) ||
				ts.isFunctionDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	const bridgeMethodNames = GIT_STASH_BRIDGE_METHOD_AUDITS.map(
		(audit) => audit.bridgeMethod,
	);
	const declarationCounts = new Map(
		GIT_DISCARD_DECLARATION_PATHS.flatMap((relativePath) =>
			bridgeMethodNames.map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	const auditedCallCounts = new Map(
		bridgeMethodNames.map((bridgeMethod) => [bridgeMethod, 0]),
	);

	for (const [normalizedPath, source] of normalizedSources) {
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);

		function visit(node) {
			const isNameLike =
				ts.isIdentifier(node) ||
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node);
			const audit = isNameLike
				? GIT_STASH_BRIDGE_METHOD_AUDITS.find(
						(candidate) => candidate.bridgeMethod === node.text,
					)
				: undefined;
			if (audit !== undefined) {
				const bridgeMethod = audit.bridgeMethod;
				const parent = node.parent;
				const isAllowedDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				if (isAllowedDeclaration) {
					const key = `${normalizedPath}:${bridgeMethod}`;
					declarationCounts.set(key, declarationCounts.get(key) + 1);
				} else {
					const propertyAccess = ts.isIdentifier(node) ? parent : undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const argumentTexts =
						directCall?.arguments.map((argument) =>
							argument.getText(sourceFile).replaceAll(/\s+/g, ""),
						) ?? [];
					const isAuditedCall =
						directCall !== undefined &&
						normalizedPath === GIT_STASH_VIEW_PATH &&
						containingMethodName(node) === audit.containingMethod &&
						sameArray(argumentTexts, audit.argumentTexts);
					if (isAuditedCall) {
						auditedCallCounts.set(
							bridgeMethod,
							auditedCallCounts.get(bridgeMethod) + 1,
						);
					} else {
						failures.push(
							`${normalizedPath} must not consume ${bridgeMethod} outside PlainGitStashView.${audit.containingMethod}'s single audited call site`,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const [key, count] of declarationCounts) {
		if (count !== 1) {
			const [relativePath, bridgeMethod] = key.split(":");
			failures.push(
				`${relativePath} must declare ${bridgeMethod} exactly once in its audited bridge surface`,
			);
		}
	}
	for (const audit of GIT_STASH_BRIDGE_METHOD_AUDITS) {
		if (auditedCallCounts.get(audit.bridgeMethod) !== 1) {
			failures.push(
				`${audit.bridgeMethod} must have exactly one production call site, inside PlainGitStashView.${audit.containingMethod}`,
			);
		}
	}

	const viewSource = normalizedSources.get(GIT_STASH_VIEW_PATH);
	if (viewSource !== undefined) {
		failures.push(...validateStashMutationGuardedCalls(viewSource));
	}
	const stashModuleSource = normalizedSources.get(GIT_STASH_MODULE_PATH);
	if (stashModuleSource !== undefined) {
		failures.push(...validateStashConfirmationModuleFace(stashModuleSource));
	}

	return [...new Set(failures)];
}

/**
 * Locks `PlainGitStashView.popEntry`/`dropEntry` to their exact "await the
 * confirmation, return unless it is exactly `\"confirmed\"`, only then call
 * the stash bridge (and, for `popEntry`, render a conflict outcome
 * afterward)" shapes — mirrors `validateNetworkMutationGuardedCalls`'s own
 * "one audited body per method" technique.
 */
function validateStashMutationGuardedCalls(source) {
	const sourceFile = ts.createSourceFile(
		GIT_STASH_VIEW_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-git-stash-view.ts must remain valid TypeScript"];
	}

	function methodBody(name) {
		const methods = [];
		function visit(node) {
			if (
				ts.isMethodDeclaration(node) &&
				typeScriptStaticName(node.name) === name
			) {
				methods.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
		return methods.length === 1 ? methods[0].body : undefined;
	}

	const expectedBodies = {
		popEntry: `{
			const decision = await resolveStashConfirmation(this.dialogService, {
				kind: "pop",
				entryLabel: stashEntryLabel(entry),
			});
			if (decision.kind !== "confirmed") {
				return;
			}
			const outcome = await this.#runStashMutation((bridge) =>
				bridge.gitStashPop(entry.sha, false),
			);
			if (outcome?.kind === "conflict") {
				this.#setDetail(
					\`Conflict popping \${stashEntryLabel(entry)} (kept in the stash list):\\n\${outcome.conflictedPaths.join("\\n")}\`,
				);
			}
		}`,
		dropEntry: `{
			const decision = await resolveStashConfirmation(this.dialogService, {
				kind: "drop",
				entryLabel: stashEntryLabel(entry),
			});
			if (decision.kind !== "confirmed") {
				return;
			}
			await this.#runStashMutation((bridge) => bridge.gitStashDrop(entry.sha));
		}`,
	};

	const failures = [];
	for (const [name, expectedBody] of Object.entries(expectedBodies)) {
		const body = methodBody(name);
		const normalizedExpected = expectedBody.replaceAll(/\s+/g, "");
		if (
			body === undefined ||
			body.getText(sourceFile).replaceAll(/\s+/g, "") !== normalizedExpected
		) {
			failures.push(
				`PlainGitStashView.${name} must match its exact audited confirm-then-call shape — no other shape may reach the stash bridge call`,
			);
		}
	}
	return failures;
}

/**
 * Locks `plain-scm-stash.ts`'s own audited module face: it must import
 * nothing at all (an import is the only way this module could ever reach a
 * bridge or a real Workbench service to perform the stash write itself), its
 * top-level declarations must match the exact audited set, and
 * `resolveStashConfirmation` itself must match the exact audited body —
 * which simultaneously proves it never calls a bridge method and never has a
 * branch that skips the dialog for either `kind`. Mirrors
 * `validateNetworkConfirmationModuleFace`'s exact technique.
 */
function validateStashConfirmationModuleFace(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		GIT_STASH_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-stash.ts must remain valid TypeScript"];
	}

	if (
		sourceFile.statements.some((statement) => ts.isImportDeclaration(statement))
	) {
		failures.push(
			"plain-scm-stash.ts must not import anything — it only ever decides whether the caller may pop/drop a stash entry, and an import is the only way it could ever reach a bridge or service to perform the write itself",
		);
	}

	const expectedTopLevel = new Map([
		["StashConfirmDialogService", { kind: "interface", exported: true }],
		["StashConfirmationKind", { kind: "type", exported: true }],
		["StashConfirmationRequest", { kind: "interface", exported: true }],
		["stashConfirmationMessage", { kind: "function", exported: true }],
		["stashConfirmationDetail", { kind: "function", exported: true }],
		["STASH_CONFIRM_PRIMARY_BUTTON", { kind: "variable", exported: true }],
		["StashConfirmDecision", { kind: "type", exported: true }],
		[
			"resolveStashConfirmation",
			{ kind: "function", exported: true, async: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isTypeAliasDeclaration(statement)) {
			name = statement.name;
			kind = "type";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"plain-scm-stash.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	}

	const resolveFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "resolveStashConfirmation",
	);
	const expectedResolveBody = `{
		const confirmation = await dialogService.confirm({
			message: stashConfirmationMessage(request),
			detail: stashConfirmationDetail(request),
			primaryButton: STASH_CONFIRM_PRIMARY_BUTTON[request.kind],
		});
		return Object.freeze({
			kind: confirmation.confirmed ? "confirmed" : "declined",
		});
	}`.replaceAll(/\s+/g, "");
	if (
		resolveFunctions.length !== 1 ||
		resolveFunctions[0].body === undefined ||
		resolveFunctions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedResolveBody
	) {
		failures.push(
			"resolveStashConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	}
	return failures;
}

const GIT_WORKTREE_VIEW_PATH = "app/features/scm/plain-git-worktree-view.ts";
const GIT_WORKTREE_MODULE_PATH = "app/features/scm/plain-scm-worktree.ts";

/**
 * `F090` S5's `gitWorktreeRemove` is an irreversible write (when its second,
 * forced call actually discards uncommitted content) this feature's own
 * frozen plan requires a confirmation dialog before ever running with
 * `force: true` — the same "nothing at the Rust/bridge-interface layer
 * enforces this, only the audited call site does" situation
 * `validateGitStashConfirmationBoundary` already locks, generalized here to a
 * *fourth* view file (`PlainGitWorktreeView`) and confirmation module
 * (`plain-scm-worktree.ts`). Unlike `validateGitStashConfirmationBoundary`'s
 * `GIT_STASH_BRIDGE_METHOD_AUDITS` (one call site per audited bridge
 * method), `gitWorktreeRemove` itself is called **twice** inside the same
 * audited method (`PlainGitWorktreeView.removeEntry`'s own unforced probe,
 * then its confirmed forced retry — see that method's own doc comment), so
 * this contract counts exactly two valid occurrences there rather than one,
 * and additionally pins `removeEntry`'s own exact body text (via
 * [`validateWorktreeRemoveEntryGuardedCall`]) to prove the confirm-then-retry
 * control flow is real, not merely "two calls somewhere in the method".
 * Locks: `gitWorktreeRemove`'s bridge declaration to its audited three files
 * (`GIT_DISCARD_DECLARATION_PATHS`, reused — same contracts.ts/native.ts/
 * browser-mock.ts split as discard/network/stash), its two production call
 * sites to `PlainGitWorktreeView.removeEntry` and nowhere else, that
 * method's exact body shape, and `plain-scm-worktree.ts`'s own audited
 * module face (mirrors `validateStashConfirmationModuleFace`).
 */
export function validateGitWorktreeConfirmationBoundary(appSources) {
	const failures = [];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		...GIT_DISCARD_DECLARATION_PATHS,
		GIT_WORKTREE_VIEW_PATH,
		GIT_WORKTREE_MODULE_PATH,
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(
				`git worktree confirmation boundary requires ${relativePath}`,
			);
		}
	}

	function containingMethodName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isMethodDeclaration(current) ||
				ts.isFunctionDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	const declarationCounts = new Map(
		GIT_DISCARD_DECLARATION_PATHS.map((relativePath) => [relativePath, 0]),
	);
	// `gitWorktreeRemove` is legitimately called twice inside the same
	// audited method (see this function's own doc comment) — unlike every
	// other confirm-gated bridge method this codebase locks, which expects
	// exactly one production call site.
	let auditedCallCount = 0;

	for (const [normalizedPath, source] of normalizedSources) {
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);

		function visit(node) {
			const referencesMethod =
				(ts.isIdentifier(node) && node.text === "gitWorktreeRemove") ||
				((ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
					node.text === "gitWorktreeRemove");
			if (referencesMethod) {
				const parent = node.parent;
				const isAllowedDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				if (isAllowedDeclaration) {
					declarationCounts.set(
						normalizedPath,
						declarationCounts.get(normalizedPath) + 1,
					);
				} else {
					const propertyAccess = ts.isIdentifier(node) ? parent : undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const isAuditedCall =
						directCall !== undefined &&
						normalizedPath === GIT_WORKTREE_VIEW_PATH &&
						containingMethodName(node) === "removeEntry";
					if (isAuditedCall) {
						auditedCallCount += 1;
					} else {
						failures.push(
							`${normalizedPath} must not consume gitWorktreeRemove outside PlainGitWorktreeView.removeEntry's two audited call sites`,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const [relativePath, count] of declarationCounts) {
		if (count !== 1) {
			failures.push(
				`${relativePath} must declare gitWorktreeRemove exactly once in its audited bridge surface`,
			);
		}
	}
	if (auditedCallCount !== 2) {
		failures.push(
			"gitWorktreeRemove must have exactly two production call sites, both inside PlainGitWorktreeView.removeEntry (the unforced probe and the confirmed forced retry)",
		);
	}

	const viewSource = normalizedSources.get(GIT_WORKTREE_VIEW_PATH);
	if (viewSource !== undefined) {
		failures.push(...validateWorktreeRemoveEntryGuardedCall(viewSource));
	}
	const worktreeModuleSource = normalizedSources.get(GIT_WORKTREE_MODULE_PATH);
	if (worktreeModuleSource !== undefined) {
		failures.push(
			...validateWorktreeConfirmationModuleFace(worktreeModuleSource),
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks `PlainGitWorktreeView.removeEntry` to its exact "try unforced, return
 * unless the outcome is exactly `\"needsForce\"`, await the confirmation,
 * return unless it is exactly `\"confirmed\"`, only then retry forced" shape
 * — mirrors `validateStashMutationGuardedCalls`'s own "one audited body per
 * method" technique, applied here to a single method containing two calls to
 * the same bridge method rather than one call each across two methods.
 */
function validateWorktreeRemoveEntryGuardedCall(source) {
	const sourceFile = ts.createSourceFile(
		GIT_WORKTREE_VIEW_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-git-worktree-view.ts must remain valid TypeScript"];
	}

	const methods = [];
	function visit(node) {
		if (
			ts.isMethodDeclaration(node) &&
			typeScriptStaticName(node.name) === "removeEntry"
		) {
			methods.push(node);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);

	const expectedBody = `{
		const outcome = await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, false),
		);
		if (outcome !== "needsForce") {
			return;
		}
		const decision = await resolveWorktreeConfirmation(this.dialogService, {
			kind: "removeDirty",
			worktreeLabel: worktreeEntryLabel(entry),
		});
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, true),
		);
	}`.replaceAll(/\s+/g, "");
	if (
		methods.length !== 1 ||
		methods[0].body === undefined ||
		methods[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !== expectedBody
	) {
		return [
			"PlainGitWorktreeView.removeEntry must match its exact audited unforced-probe-then-confirm-then-forced-retry shape — no other shape may reach the gitWorktreeRemove bridge call",
		];
	}
	return [];
}

/**
 * Locks `plain-scm-worktree.ts`'s own audited module face: it must import
 * nothing at all (an import is the only way this module could ever reach a
 * bridge or a real Workbench service to perform the worktree removal
 * itself), its top-level declarations must match the exact audited set, and
 * `resolveWorktreeConfirmation` itself must match the exact audited body —
 * which simultaneously proves it never calls a bridge method and never has a
 * branch that skips the dialog. Mirrors
 * `validateStashConfirmationModuleFace`'s exact technique.
 */
function validateWorktreeConfirmationModuleFace(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		GIT_WORKTREE_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-scm-worktree.ts must remain valid TypeScript"];
	}

	if (
		sourceFile.statements.some((statement) => ts.isImportDeclaration(statement))
	) {
		failures.push(
			"plain-scm-worktree.ts must not import anything — it only ever decides whether the caller may retry a forced worktree removal, and an import is the only way it could ever reach a bridge or service to perform the write itself",
		);
	}

	const expectedTopLevel = new Map([
		["WorktreeConfirmDialogService", { kind: "interface", exported: true }],
		["WorktreeConfirmationKind", { kind: "type", exported: true }],
		["WorktreeConfirmationRequest", { kind: "interface", exported: true }],
		["worktreeConfirmationMessage", { kind: "function", exported: true }],
		["worktreeConfirmationDetail", { kind: "function", exported: true }],
		["WORKTREE_CONFIRM_PRIMARY_BUTTON", { kind: "variable", exported: true }],
		["WorktreeConfirmDecision", { kind: "type", exported: true }],
		[
			"resolveWorktreeConfirmation",
			{ kind: "function", exported: true, async: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isTypeAliasDeclaration(statement)) {
			name = statement.name;
			kind = "type";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"plain-scm-worktree.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	}

	const resolveFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "resolveWorktreeConfirmation",
	);
	const expectedResolveBody = `{
		const confirmation = await dialogService.confirm({
			message: worktreeConfirmationMessage(request),
			detail: worktreeConfirmationDetail(request),
			primaryButton: WORKTREE_CONFIRM_PRIMARY_BUTTON[request.kind],
		});
		return Object.freeze({
			kind: confirmation.confirmed ? "confirmed" : "declined",
		});
	}`.replaceAll(/\s+/g, "");
	if (
		resolveFunctions.length !== 1 ||
		resolveFunctions[0].body === undefined ||
		resolveFunctions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedResolveBody
	) {
		failures.push(
			"resolveWorktreeConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	}
	return failures;
}

/**
 * Finds every top-level `function <name>(...) { ... }` declaration's body
 * text in a TypeScript source string — a lightweight, brace-matching
 * sibling of [`extractRustFunctions`] for this file's occasional
 * string-level (rather than full AST) TypeScript checks.
 */
function extractRustLikeTypeScriptFunctionBodies(source, functionName) {
	const bodies = [];
	const pattern = new RegExp(
		`\\bfunction\\s+${escapeRegularExpression(functionName)}\\s*\\(`,
		"g",
	);
	for (const match of source.matchAll(pattern)) {
		const parameterOpen = match.index + match[0].length - 1;
		const parameterClose = findMatchingDelimiter(
			source,
			parameterOpen,
			"(",
			")",
		);
		if (parameterClose === undefined) {
			continue;
		}
		const bodyOpen = source.indexOf("{", parameterClose + 1);
		if (bodyOpen < 0) {
			continue;
		}
		const bodyClose = findMatchingDelimiter(source, bodyOpen, "{", "}");
		if (bodyClose === undefined) {
			continue;
		}
		bodies.push(source.slice(bodyOpen + 1, bodyClose));
	}
	return bodies;
}

function extractNamedImplBodies(source, typeName) {
	const bodies = [];
	const pattern = new RegExp(
		`\\bimpl(?:\\s*<[^>{}]*>)?\\s+${escapeRegularExpression(typeName)}\\b[^{}]*\\{`,
		"g",
	);
	for (const match of source.matchAll(pattern)) {
		const open = match.index + match[0].lastIndexOf("{");
		const close = findMatchingDelimiter(source, open, "{", "}");
		if (close !== undefined) {
			bodies.push(source.slice(open + 1, close));
		}
	}
	return bodies;
}

function hasDirectDifferentRootRejection(body) {
	const comparisonPatterns = [
		/\bsource_root_id\s*==\s*target_root_id\b/g,
		/\btarget_root_id\s*==\s*source_root_id\b/g,
		/\bself\s*\.\s*source_root_id\s*==\s*self\s*\.\s*target_root_id\b/g,
		/\bself\s*\.\s*target_root_id\s*==\s*self\s*\.\s*source_root_id\b/g,
	];
	for (const pattern of comparisonPatterns) {
		for (const comparison of body.matchAll(pattern)) {
			const prefix = body.slice(0, comparison.index);
			const ifMatch = /\bif\s*$/.exec(prefix);
			if (ifMatch === null) {
				continue;
			}
			const open = body.indexOf("{", comparison.index + comparison[0].length);
			if (open < 0) {
				continue;
			}
			const close = findMatchingDelimiter(body, open, "{", "}");
			if (
				close !== undefined &&
				/\breturn\s+Err\s*\(/.test(body.slice(open + 1, close))
			) {
				return true;
			}
		}
	}
	return false;
}

function methodCalls(source, methodName) {
	return extractCallArguments(source, methodName).filter((call) =>
		/\.\s*$/.test(source.slice(0, call.index)),
	);
}

function exactMethodCall(source, call, receiverPattern, argument) {
	return (
		call.closed &&
		receiverPattern.test(source.slice(0, call.index)) &&
		call.arguments.replaceAll(/\s+/g, "") === argument
	);
}

function stageCleanupCallsAreExact(relativePath, source) {
	const removeFileCalls = methodCalls(source, "remove_file");
	const removeDirectoryCalls = methodCalls(source, "remove_dir");
	if (relativePath === "src-tauri/src/workspace/writer.rs") {
		return (
			removeFileCalls.length === 2 &&
			removeFileCalls.every((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*parent\s*\.\s*$/,
					"&self.name",
				),
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	if (relativePath === "src-tauri/src/workspace/directory_copy.rs") {
		return (
			removeFileCalls.length === 1 &&
			exactMethodCall(
				source,
				removeFileCalls[0],
				/\bparent\s*\.\s*$/,
				"name",
			) &&
			removeDirectoryCalls.length === 2 &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(source, call, /\bparent\s*\.\s*$/, "name"),
			) &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*parent\s*\.\s*$/,
					"&self.name",
				),
			)
		);
	}
	if (relativePath === WORKSPACE_VERSIONED_WRITER_PATH) {
		return (
			removeFileCalls.length === 1 &&
			exactMethodCall(
				source,
				removeFileCalls[0],
				/\bparent\s*\.\s*$/,
				"stage",
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	if (relativePath === "src-tauri/src/theme/unpack.rs") {
		return (
			removeFileCalls.length === 1 &&
			exactMethodCall(
				source,
				removeFileCalls[0],
				/\bparent\s*\.\s*$/,
				"&entry.name",
			) &&
			removeDirectoryCalls.length === 2 &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(source, call, /\bparent\s*\.\s*$/, "&entry.name"),
			) &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*root\s*\.\s*$/,
					"&self.stage_name",
				),
			)
		);
	}
	if (relativePath === "src-tauri/src/theme/library.rs") {
		return (
			removeFileCalls.length === 1 &&
			exactMethodCall(
				source,
				removeFileCalls[0],
				/\bdir\s*\.\s*$/,
				"child_path",
			) &&
			removeDirectoryCalls.length === 2 &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(source, call, /\bdir\s*\.\s*$/, "child_path"),
			) &&
			removeDirectoryCalls.some((call) =>
				exactMethodCall(source, call, /\broot\s*\.\s*$/, "&name"),
			)
		);
	}
	if (relativePath === "src-tauri/src/theme/selection.rs") {
		return (
			removeFileCalls.length === 2 &&
			removeFileCalls.some((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*dir\s*\.\s*$/,
					"&self.name",
				),
			) &&
			removeFileCalls.some((call) =>
				exactMethodCall(source, call, /\broot\s*\.\s*$/, "SELECTION_FILE_NAME"),
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	if (relativePath === "src-tauri/src/trust/store.rs") {
		return (
			removeFileCalls.length === 1 &&
			exactMethodCall(
				source,
				removeFileCalls[0],
				/\bself\s*\.\s*dir\s*\.\s*$/,
				"&self.name",
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	if (relativePath === DEBUG_CONFIRM_STORE_PATH) {
		return (
			removeFileCalls.length === 2 &&
			removeFileCalls.some((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*dir\s*\.\s*$/,
					"&self.name",
				),
			) &&
			removeFileCalls.some((call) =>
				exactMethodCall(source, call, /\bdir\s*\.\s*$/, "&key"),
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	if (relativePath === BACKUP_STORE_PATH) {
		return (
			removeFileCalls.length === 3 &&
			removeFileCalls.some((call) =>
				exactMethodCall(
					source,
					call,
					/\bself\s*\.\s*dir\s*\.\s*$/,
					"&self.name",
				),
			) &&
			removeFileCalls.some((call) =>
				exactMethodCall(source, call, /\bdir\s*\.\s*$/, "key.as_str()"),
			) &&
			removeFileCalls.some((call) =>
				exactMethodCall(source, call, /\bdir\s*\.\s*$/, "name"),
			) &&
			removeDirectoryCalls.length === 0
		);
	}
	return removeFileCalls.length === 0 && removeDirectoryCalls.length === 0;
}

function verifiedSourceDeleteHelperIsExact(source, functionName, methodName) {
	const functions = extractRustFunctions(source, functionName);
	if (functions.length !== 1) {
		return false;
	}
	const [helper] = functions;
	const parameters = helper.parameters.replaceAll(/\s+/g, "").replace(/,$/, "");
	const calls = methodCalls(helper.body, methodName);
	return (
		parameters === "parent:&Dir,basename:&Path" &&
		calls.length === 1 &&
		exactMethodCall(helper.body, calls[0], /\bparent\s*\.\s*$/, "basename") &&
		methodCalls(
			helper.body,
			methodName === "remove_file" ? "remove_dir" : "remove_file",
		).length === 0
	);
}

function publishedReceiptPreparedBeforePublish(
	source,
	functionName,
	receiptConstructor,
) {
	const functions = extractRustFunctions(source, functionName);
	if (functions.length !== 1) {
		return false;
	}
	const [operation] = functions;
	const publishCalls = methodCalls(operation.body, "publish");
	if (publishCalls.length !== 1) {
		return false;
	}
	const [publish] = publishCalls;
	const before = operation.body.slice(0, publish.index);
	const after = operation.body.slice(publish.end);
	const constructor = new RegExp(
		`\\b${escapeRegularExpression(receiptConstructor)}\\s*\\{`,
	);
	return (
		constructor.test(before) &&
		/\blet\s+prepared\b/.test(before) &&
		/\bif\s+let\s+Err\s*\(\s*error\s*\)\s*=\s*staged\s*\.\s*$/.test(before) &&
		publish.arguments.replaceAll(/\s+/g, "") === "&target_name" &&
		/^\s*\{\s*return\b[\s\S]*?\}\s*Ok\s*\(\s*prepared\s*\)\s*$/.test(after)
	);
}

function stagedPublishSuccessPathsAreInfallible(rustSources) {
	const expected = new Map([
		["src-tauri/src/workspace/writer.rs", 2],
		["src-tauri/src/workspace/directory_copy.rs", 1],
	]);
	for (const [relativePath, expectedCount] of expected) {
		const source = findRustSource(rustSources, relativePath);
		if (source === undefined) {
			return false;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		const publishFunctions = extractRustFunctions(
			executableSource,
			"publish",
		).filter((fn) => /\bpublish_no_replace\s*\(/.test(fn.body));
		if (publishFunctions.length !== expectedCount) {
			return false;
		}
		for (const publishFunction of publishFunctions) {
			const calls = extractCallArguments(
				publishFunction.body,
				"publish_no_replace",
			).filter(
				(call) => !/\bfn\s*$/.test(publishFunction.body.slice(0, call.index)),
			);
			if (calls.length !== 1) {
				return false;
			}
			const successTail = publishFunction.body
				.slice(calls[0].end)
				.replaceAll(/\s+/g, "");
			if (successTail !== "?;self.active=false;Ok(())") {
				return false;
			}
		}
	}
	return true;
}

function auditedSourceDeleteCallsitesAreExact(rustSources) {
	const expected = new Map([
		[
			"src-tauri/src/workspace/move_entry.rs",
			new Map([
				[
					"remove_verified_source_file",
					new Map([
						["consume_file_receipt", 1],
						["consume_symlink_receipt", 1],
					]),
				],
				["remove_verified_source_directory", new Map()],
			]),
		],
		[
			"src-tauri/src/workspace/directory_copy.rs",
			new Map([
				[
					"remove_verified_source_file",
					new Map([["delete_manifest_entry", 2]]),
				],
				[
					"remove_verified_source_directory",
					new Map([
						["consume_directory_move_receipt", 1],
						["delete_manifest_entry", 1],
					]),
				],
			]),
		],
	]);
	for (const [relativePath, expectedHelpers] of expected) {
		const source = findRustSource(rustSources, relativePath);
		if (source === undefined) {
			return false;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		const functions = extractAllRustFunctions(executableSource);
		for (const [helperName, expectedFunctions] of expectedHelpers) {
			const observedFunctions = new Map();
			const calls = extractCallArguments(executableSource, helperName).filter(
				(call) => !/\bfn\s*$/.test(executableSource.slice(0, call.index)),
			);
			for (const call of calls) {
				const containingFunction = functions
					.filter((fn) => fn.bodyStart <= call.index && call.index < fn.bodyEnd)
					.sort((left, right) => right.bodyStart - left.bodyStart)[0];
				if (containingFunction === undefined) {
					return false;
				}
				const argumentsList = splitTopLevelComma(call.arguments).map(
					(argument) => argument.replaceAll(/\s+/g, ""),
				);
				if (
					argumentsList.length !== 2 ||
					argumentsList[0] !== "&source_parent" ||
					!/^(?:&receipt\.source(?:_name|\.name)|source_basename|name)$/.test(
						argumentsList[1],
					) ||
					/target/.test(call.arguments)
				) {
					return false;
				}
				observedFunctions.set(
					containingFunction.name,
					(observedFunctions.get(containingFunction.name) ?? 0) + 1,
				);
			}
			if (
				observedFunctions.size !== expectedFunctions.size ||
				[...expectedFunctions].some(
					([name, count]) => observedFunctions.get(name) !== count,
				)
			) {
				return false;
			}
		}
	}
	return true;
}

function extractNamedStructBody(source, typeName) {
	const pattern = new RegExp(
		`\\bstruct\\s+${escapeRegularExpression(typeName)}\\b[^{}]*\\{`,
		"g",
	);
	const bodies = [];
	for (const match of source.matchAll(pattern)) {
		const open = match.index + match[0].lastIndexOf("{");
		const close = findMatchingDelimiter(source, open, "{", "}");
		if (close !== undefined) {
			bodies.push(source.slice(open + 1, close));
		}
	}
	return bodies;
}

function directoryReceiptCollectionsArePreparedBeforePublication(source) {
	const receiptBodies = extractNamedStructBody(
		source,
		"PublishedDirectoryReceipt",
	);
	if (receiptBodies.length !== 1) {
		return false;
	}
	const fields = receiptBodies[0].replaceAll(/\s+/g, "");
	if (
		!fields.includes(
			"source_directories:BTreeMap<PathBuf,DirectorySnapshot>",
		) ||
		!fields.includes("member_sets:BTreeMap<PathBuf,BTreeSet<OsString>>") ||
		!fields.includes("removed_aliases:BTreeMap<FileIdentity,u64>")
	) {
		return false;
	}
	const functions = extractRustFunctions(
		source,
		"copy_directory_with_limits_and_hooks_receipt",
	);
	if (functions.length !== 1) {
		return false;
	}
	const [operation] = functions;
	const publishCalls = methodCalls(operation.body, "publish");
	if (publishCalls.length !== 1) {
		return false;
	}
	const beforePublish = operation.body.slice(0, publishCalls[0].index);
	return [
		/\bmanifest\s*\.\s*owned_directory_map\s*\(\s*\)/,
		/\bprepare_member_sets\s*\(\s*&\s*manifest\s*\)/,
		/\bprepare_alias_groups\s*\(\s*&\s*manifest\s*\)/,
		/\bsource_directories\s*,/,
		/\bmember_sets\s*,/,
		/\bremoved_aliases\s*,/,
	].every((pattern) => pattern.test(beforePublish));
}

function directoryPostPublicationUsesOnlyPreparedCollections(source) {
	const postPublicationFunctions = [
		"consume_directory_move_receipt",
		"verify_directory_preflight",
		"verify_source_tree",
		"verify_target_tree",
		"verify_source_member_sets",
		"delete_manifest_entry",
		"source_root_for_delete",
		"target_root_current",
		"verify_target_entry",
		"open_source_parent_prepared",
		"open_source_directory_prepared",
		"open_published_parent",
		"verify_published_member_sets",
		"verify_published_directory_members",
		"verify_exact_members",
		"ensure_directory_empty",
	];
	const bodies = [];
	for (const functionName of postPublicationFunctions) {
		const functions = extractRustFunctions(source, functionName);
		if (functions.length !== 1) {
			return false;
		}
		bodies.push(functions[0].body);
	}
	const executable = bodies.join("\n");
	return !(
		/\bbuild_manifest\s*\(/.test(executable) ||
		/\.\s*directory_map\s*\(/.test(executable) ||
		/\bprepare_(?:member_sets|alias_groups)\s*\(/.test(executable) ||
		/\b(?:BTreeMap|BTreeSet)\s*(?:::\s*<[^;=]*>)?\s*::\s*new\s*\(/.test(
			executable,
		) ||
		/\.\s*(?:clone|insert|collect|to_owned)\s*\(/.test(executable)
	);
}

function innermostBraceBodyAt(source, index) {
	const stack = [];
	for (let cursor = 0; cursor < index; cursor += 1) {
		if (source[cursor] === "{") {
			stack.push(cursor);
		} else if (source[cursor] === "}") {
			stack.pop();
		}
	}
	const open = stack.at(-1);
	if (open === undefined) {
		return undefined;
	}
	const close = findMatchingDelimiter(source, open, "{", "}");
	return close === undefined
		? undefined
		: {
				before: source.slice(open + 1, index),
				afterClose: close,
			};
}

function directoryDeleteAccountingIsInfallibleAfterRemoval(source) {
	const deleteFunctions = extractRustFunctions(source, "delete_manifest_entry");
	const consumerFunctions = extractRustFunctions(
		source,
		"consume_directory_move_receipt",
	);
	if (deleteFunctions.length !== 1 || consumerFunctions.length !== 1) {
		return false;
	}
	const deleteBody = deleteFunctions[0].body;
	const fileCalls = extractCallArguments(
		deleteBody,
		"remove_verified_source_file",
	);
	const directoryCalls = extractCallArguments(
		deleteBody,
		"remove_verified_source_directory",
	);
	if (fileCalls.length !== 2 || directoryCalls.length !== 1) {
		return false;
	}
	for (const call of fileCalls) {
		const arm = innermostBraceBodyAt(deleteBody, call.index);
		if (arm === undefined) {
			return false;
		}
		const before = arm.before;
		const checked = before.lastIndexOf(".checked_add(");
		const lookup = before.lastIndexOf(".get_mut(");
		const recorded = before.lastIndexOf("*alias_count = next;");
		const after = deleteBody.slice(call.end, arm.afterClose);
		if (
			checked < 0 ||
			lookup < checked ||
			recorded < lookup ||
			!/^\s*\.\s*is_err\s*\(\s*\)\s*\{\s*\*\s*alias_count\s*=\s*removed\s*;\s*return\s+Err\s*\(\s*WorkspaceMoveIncompleteReason\s*::\s*DeleteFailed\s*\)\s*;\s*\}\s*$/.test(
				after,
			)
		) {
			return false;
		}
	}
	const directoryArm = innermostBraceBodyAt(
		deleteBody,
		directoryCalls[0].index,
	);
	if (directoryArm === undefined) {
		return false;
	}
	const directoryAfter = deleteBody.slice(
		directoryCalls[0].end,
		directoryArm.afterClose,
	);
	if (
		!/^\s*\.\s*map_err\s*\(\s*\|_\|\s*WorkspaceMoveIncompleteReason\s*::\s*DeleteFailed\s*\)\s*\?\s*;\s*$/.test(
			directoryAfter,
		)
	) {
		return false;
	}

	const consumerBody = consumerFunctions[0].body;
	const deleteCalls = extractCallArguments(
		consumerBody,
		"delete_manifest_entry",
	);
	if (deleteCalls.length !== 1) {
		return false;
	}
	const deleteOffset = deleteCalls[0].index;
	const checkedOffset = consumerBody.lastIndexOf(
		"removed_entries.checked_add(1)",
		deleteOffset,
	);
	const recordedOffset = consumerBody.indexOf(
		"removed_entries = next_removed_entries;",
		deleteCalls[0].end,
	);
	const nextDeleteOffset = consumerBody.indexOf(
		"remove_verified_source_directory",
		deleteCalls[0].end,
	);
	return (
		checkedOffset >= 0 &&
		checkedOffset < deleteOffset &&
		recordedOffset > deleteCalls[0].end &&
		(nextDeleteOffset < 0 || recordedOffset < nextDeleteOffset) &&
		!/[?]|\.\s*(?:checked_add|insert|push|reserve)\s*\(/.test(
			consumerBody.slice(deleteCalls[0].end, recordedOffset),
		)
	);
}

export function validateWorkspaceMoveBoundary(rustSources) {
	const failures = [];
	const movePath = "src-tauri/src/workspace/move_entry.rs";
	const moveSource = findRustSource(rustSources, movePath);
	const dtoSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/dto.rs",
	);
	const serviceSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/service.rs",
	);
	const writerSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/writer.rs",
	);
	const directoryCopySource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/directory_copy.rs",
	);

	if (moveSource === undefined) {
		failures.push("workspace move boundary requires workspace/move_entry.rs");
		return failures;
	}
	const executableMove = stripRustCommentsAndLiterals(moveSource);
	if (
		/\.\s*open_dir\s*\(/.test(executableMove) ||
		/\bDir\s*::\s*(?:open|from_std_file|from_raw_fd|from_raw_handle)\s*\(/.test(
			executableMove,
		)
	) {
		failures.push(
			"workspace/move_entry.rs must reopen directory chains only with capability-relative nofollow operations",
		);
	}
	const executableWriter =
		writerSource === undefined
			? ""
			: stripRustCommentsAndLiterals(writerSource);
	const executableDirectoryCopy =
		directoryCopySource === undefined
			? ""
			: stripRustCommentsAndLiterals(directoryCopySource);
	if (
		!publishedReceiptPreparedBeforePublish(
			executableWriter,
			"transfer_regular_file",
			"PublishedFileReceipt",
		) ||
		!publishedReceiptPreparedBeforePublish(
			executableWriter,
			"transfer_symlink",
			"PublishedSymlinkReceipt",
		) ||
		!publishedReceiptPreparedBeforePublish(
			executableDirectoryCopy,
			"copy_directory_with_limits_and_hooks_receipt",
			"PublishedDirectoryReceipt",
		)
	) {
		failures.push(
			"file, symlink and directory receipts must be fully prepared before their sole publication call",
		);
	}
	if (!stagedPublishSuccessPathsAreInfallible(rustSources)) {
		failures.push(
			"staging publish methods must have no fallible operation after NOREPLACE succeeds",
		);
	}
	if (
		!directoryReceiptCollectionsArePreparedBeforePublication(
			executableDirectoryCopy,
		)
	) {
		failures.push(
			"PublishedDirectoryReceipt must prepare directory maps, member sets and alias groups before publication",
		);
	}
	if (
		!directoryPostPublicationUsesOnlyPreparedCollections(
			executableDirectoryCopy,
		)
	) {
		failures.push(
			"directory move must not build, clone or grow receipt collections after publication",
		);
	}
	if (
		!directoryDeleteAccountingIsInfallibleAfterRemoval(executableDirectoryCopy)
	) {
		failures.push(
			"directory move must prepare counters before removal and perform only infallible bookkeeping after a successful source delete",
		);
	}

	const receiptDefinitions = [];
	let receiptSerdeImplementation = false;
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		if (
			/\bimpl(?:\s*<[^>]*>)?\s+(?:(?:serde\s*::\s*)?(?:Serialize|Deserialize))\s+for\s+PublishedCopyReceipt\b/.test(
				executableSource,
			)
		) {
			receiptSerdeImplementation = true;
		}
		for (const match of executableSource.matchAll(
			/\b(?:struct|enum)\s+PublishedCopyReceipt\b/g,
		)) {
			receiptDefinitions.push({
				relativePath: normalizedPath,
				index: match.index,
			});
		}
	}
	if (
		receiptDefinitions.length !== 1 ||
		receiptDefinitions[0]?.relativePath !== movePath
	) {
		failures.push(
			"PublishedCopyReceipt must have exactly one production definition in workspace/move_entry.rs",
		);
	}
	if (
		/#\s*\[\s*derive\s*\([^\]]*\b(?:Serialize|Deserialize)\b[^\]]*\)\s*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum)\s+PublishedCopyReceipt\b/s.test(
			executableMove,
		) ||
		receiptSerdeImplementation ||
		/#\s*\[\s*serde\b[^\]]*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum)\s+PublishedCopyReceipt\b/s.test(
			executableMove,
		)
	) {
		failures.push("PublishedCopyReceipt must not implement Serde");
	}
	for (const relativePath of [
		"src-tauri/src/workspace/dto.rs",
		"src-tauri/src/workspace/commands.rs",
		"src-tauri/src/lib.rs",
	]) {
		const source = findRustSource(rustSources, relativePath);
		if (
			source !== undefined &&
			/\bPublishedCopyReceipt\b/.test(stripRustCommentsAndLiterals(source))
		) {
			failures.push(
				`${relativePath} must not expose PublishedCopyReceipt across DTO or IPC boundaries`,
			);
		}
	}

	const consumers = extractRustFunctions(
		executableMove,
		"consume_published_copy_receipt",
	);
	if (consumers.length !== 1) {
		failures.push(
			"workspace/move_entry.rs must define exactly one consume_published_copy_receipt typestate consumer",
		);
	} else {
		const [consumer] = consumers;
		if (
			!/(?:^|,)\s*receipt\s*:\s*PublishedCopyReceipt\s*(?=,|$)/.test(
				consumer.parameters,
			) ||
			consumer.returnType.replaceAll(/\s+/g, "") !== "->WorkspaceMoveResult"
		) {
			failures.push(
				"consume_published_copy_receipt must consume PublishedCopyReceipt by value and return WorkspaceMoveResult directly",
			);
		}
		if (
			/\?|\b(?:Err|CommandError|panic|unreachable)\b|\.\s*(?:unwrap|expect|map_err)\s*\(/.test(
				consumer.body,
			)
		) {
			failures.push(
				"consume_published_copy_receipt must not surface an ordinary error or panic after publication",
			);
		}
	}

	const consumerCalls = extractCallArguments(
		executableMove,
		"consume_published_copy_receipt",
	).filter((call) => !/\bfn\s*$/.test(executableMove.slice(0, call.index)));
	if (consumerCalls.length !== 1) {
		failures.push(
			"PublishedCopyReceipt must enter its post-publication consumer exactly once",
		);
	} else {
		const [call] = consumerCalls;
		const containingFunctions = extractAllRustFunctions(executableMove).filter(
			(fn) => fn.bodyStart <= call.index && call.index < fn.bodyEnd,
		);
		const containingFunction = containingFunctions.sort(
			(left, right) => right.bodyStart - left.bodyStart,
		)[0];
		const before =
			containingFunction === undefined
				? ""
				: executableMove.slice(containingFunction.bodyStart, call.index);
		const after =
			containingFunction === undefined
				? ""
				: executableMove.slice(call.end, containingFunction.bodyEnd);
		if (!/\bOk\s*\(\s*$/.test(before) || !/^\s*\)\s*;?\s*$/.test(after)) {
			failures.push(
				"the published receipt consumer must be the final successful expression with no fallible post-publication gap",
			);
		}
	}

	if (
		!verifiedSourceDeleteHelperIsExact(
			executableMove,
			"remove_verified_source_file",
			"remove_file",
		) ||
		!verifiedSourceDeleteHelperIsExact(
			executableMove,
			"remove_verified_source_directory",
			"remove_dir",
		)
	) {
		failures.push(
			"source deletion must use the two audited move_entry parent-handle plus basename helpers",
		);
	}
	if (!auditedSourceDeleteCallsitesAreExact(rustSources)) {
		failures.push(
			"verified source deletion helpers must be called only from the audited source receipt consumers",
		);
	}

	if (dtoSource === undefined) {
		failures.push("workspace move boundary requires workspace/dto.rs");
	} else {
		const executableDto = stripRustCommentsAndLiterals(dtoSource);
		const moveRequestImpls = extractNamedImplBodies(
			executableDto,
			"WorkspaceMoveRequest",
		);
		const intoParts = moveRequestImpls.flatMap((body) =>
			extractRustFunctions(body, "into_parts"),
		);
		if (
			intoParts.length !== 1 ||
			!hasDirectDifferentRootRejection(intoParts[0].body)
		) {
			failures.push(
				"WorkspaceMoveRequest::into_parts must directly reject equal source and target roots",
			);
		}
	}
	if (serviceSource === undefined) {
		failures.push("workspace move boundary requires workspace/service.rs");
	} else {
		const executableService = stripRustCommentsAndLiterals(serviceSource);
		const moveEntries = extractRustFunctions(executableService, "move_entry");
		if (moveEntries.length !== 1) {
			failures.push(
				"WorkspaceService must define exactly one move_entry route",
			);
		} else {
			const [moveEntry] = moveEntries;
			const equalityOffset = moveEntry.body.search(
				/\b(?:source_root_id\s*==\s*target_root_id|target_root_id\s*==\s*source_root_id)\b/,
			);
			const mutationOffset = moveEntry.body.search(
				/\b(?:run_dual_root_mutation|copy_entry_with_receipt|move_entry_with_receipt)\b/,
			);
			if (
				!hasDirectDifferentRootRejection(moveEntry.body) ||
				equalityOffset < 0 ||
				(mutationOffset >= 0 && equalityOffset > mutationOffset)
			) {
				failures.push(
					"WorkspaceService::move_entry must reject equal roots before entering the mutation/copy route",
				);
			}
		}
	}

	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		const removeFileCalls = methodCalls(executableSource, "remove_file");
		const removeDirectoryCalls = methodCalls(executableSource, "remove_dir");
		const removeFileReferences = [
			...executableSource.matchAll(/\bremove_file\b/g),
		].length;
		const removeDirectoryReferences = [
			...executableSource.matchAll(/\bremove_dir\b/g),
		].length;
		if (
			removeFileReferences !== removeFileCalls.length ||
			removeDirectoryReferences !== removeDirectoryCalls.length
		) {
			failures.push(
				`${normalizedPath} must not alias, re-export or call source deletion through UFCS`,
			);
		}
		if (
			/\b(?:remove_open_dir|remove_open_dir_all|remove_dir_all|unlink|unlinkat)\b/.test(
				executableSource,
			)
		) {
			failures.push(
				`${normalizedPath} must not use broad, open-directory or direct unlink deletion`,
			);
		}
		// `src-tauri/src/git/exec.rs` and `src-tauri/src/debug/exec.rs` are
		// exempt from this specific check only: they are the git and `debug`
		// domains' own sole audited `std::process::Command` wrappers
		// (`F080` S0 / `F100` S0 respectively), separately and more precisely
		// locked down by `validateTerminalRustBoundary` (git: literal
		// `Command::new("git")` only, no other program, no shell interpreter
		// — see `GIT_EXEC_WRAPPER_PATH`'s doc) and
		// `validateDebugAdapterSpawnBoundary`/`validateDebugSpawnConstructionShape`
		// (debug: trust gate first, fixed `Command::new(&descriptor.command)
		// .args(&descriptor.args)` shape — see `DEBUG_EXEC_WRAPPER_PATH`'s
		// doc). This check's actual purpose — preventing the
		// *workspace/theme/backup* domains' capability-based deletion from
		// being bypassed via a raw process/shell spawn — does not apply to
		// either file: neither spawns anything but its own domain's audited
		// program, and neither calls `remove_file`/`remove_dir` at all
		// (confirmed immediately below by this same loop's UFCS/broad-
		// deletion checks, which still run for both unexempted).
		if (
			normalizedPath !== GIT_EXEC_WRAPPER_PATH &&
			normalizedPath !== DEBUG_EXEC_WRAPPER_PATH &&
			(/\b(?:std|tokio|async_process)\s*::\s*(?:\{[^;}]*\bprocess\b|process\b)|\btauri_plugin_shell\b|\b(?:Command|Shell)\s*::\s*new\s*\(/s.test(
				executableSource,
			) ||
				/\b(?:async_process|duct|subprocess|xshell)\b/.test(executableSource) ||
				/\b(?:libc|nix)\s*::(?:\s*[A-Za-z_]\w*\s*::)*\s*(?:remove|rmdir|system|posix_spawn|execv|execve|fork)\b/.test(
					executableSource,
				) ||
				/\bextern\s+"C"\s*\{[^}]*\bfn\s+(?:remove|rmdir|system|posix_spawn|execv|execve|fork)\b/s.test(
					executableSource,
				) ||
				/\b(?:use\s+std\s+as\b|extern\s+crate\s+std\b)/.test(executableSource))
		) {
			failures.push(
				`${normalizedPath} must not use process or shell deletion bypasses`,
			);
		}
		if (normalizedPath === movePath) {
			if (removeFileCalls.length !== 1 || removeDirectoryCalls.length !== 1) {
				failures.push(
					"workspace/move_entry.rs may contain only the two audited source removal calls",
				);
			}
		} else if (
			normalizedPath !== "src-tauri/src/workspace/delete.rs" &&
			!stageCleanupCallsAreExact(normalizedPath, executableSource)
		) {
			failures.push(
				`${normalizedPath} contains source deletion outside the exact staging cleanup allowlist`,
			);
		}
	}

	return failures;
}

function rustLockOffsets(body, fieldName) {
	const escapedField = escapeRegularExpression(fieldName);
	const patterns = [
		new RegExp(
			`\\block\\s*\\(\\s*&\\s*self\\s*\\.\\s*${escapedField}\\s*\\)`,
			"g",
		),
		new RegExp(`\\bself\\s*\\.\\s*${escapedField}\\s*\\.\\s*lock\\s*\\(`, "g"),
	];
	return patterns
		.flatMap((pattern) =>
			[...body.matchAll(pattern)].map((match) => match.index),
		)
		.sort((left, right) => left - right);
}

function deleteServiceLockOrderIsExact(serviceSource) {
	const windowImpls = extractNamedImplBodies(serviceSource, "WindowWorkspace");
	if (windowImpls.length !== 1) {
		return false;
	}
	for (const { service } of WORKSPACE_DELETE_COMMAND_CONTRACTS) {
		const functions = extractRustFunctions(windowImpls[0], service);
		if (functions.length !== 1) {
			return false;
		}
		const mutationLocks = rustLockOffsets(functions[0].body, "mutation_gate");
		const stateLocks = rustLockOffsets(functions[0].body, "state");
		if (
			mutationLocks.length !== 1 ||
			stateLocks.length < 1 ||
			stateLocks.some((offset) => offset < mutationLocks[0])
		) {
			return false;
		}
	}
	return true;
}

function deleteServiceRoutesAreUnique(serviceSource) {
	const serviceImpls = extractNamedImplBodies(
		serviceSource,
		"WorkspaceService",
	);
	if (serviceImpls.length !== 1) {
		return false;
	}
	for (const { service } of WORKSPACE_DELETE_COMMAND_CONTRACTS) {
		const functions = extractRustFunctions(serviceImpls[0], service);
		if (functions.length !== 1) {
			return false;
		}
		const route = new RegExp(
			`\\bworkspace\\s*\\.\\s*${escapeRegularExpression(service)}\\s*\\(`,
			"g",
		);
		if ([...functions[0].body.matchAll(route)].length !== 1) {
			return false;
		}
	}
	return true;
}

function deleteRemovalHelperIsExact(deleteSource) {
	const helpers = extractRustFunctions(deleteSource, "remove_verified_entry");
	if (helpers.length !== 1) {
		return false;
	}
	const [helper] = helpers;
	const parameters = helper.parameters.replaceAll(/\s+/g, "");
	if (
		!/(?:^|,)parent:&Dir(?=,|$)/.test(parameters) ||
		!/(?:^|,)basename:&Path(?=,|$)/.test(parameters)
	) {
		return false;
	}
	const removeFileCalls = methodCalls(deleteSource, "remove_file");
	const removeDirectoryCalls = methodCalls(deleteSource, "remove_dir");
	const references = [
		...deleteSource.matchAll(/\b(?:remove_file|remove_dir)\b/g),
	].length;
	const helperCalls = extractCallArguments(
		deleteSource,
		"remove_verified_entry",
	).filter((call) => !/\bfn\s*$/.test(deleteSource.slice(0, call.index)));
	const allowedCallers = new Map([
		["delete_top_leaf", 1],
		["delete_directory", 1],
		["delete_manifest_entry", 3],
	]);
	const observedCallers = new Map(
		[...allowedCallers.keys()].map((name) => [name, 0]),
	);
	const functions = extractAllRustFunctions(deleteSource);
	for (const call of helperCalls) {
		const containing = functions
			.filter((fn) => fn.bodyStart <= call.index && call.index < fn.bodyEnd)
			.sort((left, right) => right.bodyStart - left.bodyStart)[0];
		if (containing === undefined || !allowedCallers.has(containing.name)) {
			return false;
		}
		observedCallers.set(
			containing.name,
			observedCallers.get(containing.name) + 1,
		);
	}
	return (
		removeFileCalls.length === 1 &&
		removeDirectoryCalls.length === 1 &&
		exactMethodCall(
			deleteSource,
			removeFileCalls[0],
			/\bparent\s*\.\s*$/,
			"basename",
		) &&
		exactMethodCall(
			deleteSource,
			removeDirectoryCalls[0],
			/\bparent\s*\.\s*$/,
			"basename",
		) &&
		references === 2 &&
		[...allowedCallers].every(
			([name, count]) => observedCallers.get(name) === count,
		)
	);
}

function deleteLimitsAreExact(deleteSource) {
	for (const [name, value, integerType] of WORKSPACE_DELETE_LIMITS) {
		const declarations = findWorkspaceCopyLimitDeclarations(
			deleteSource,
			name,
			integerType,
		);
		const references = [
			...deleteSource.matchAll(
				new RegExp(`\\b${escapeRegularExpression(name)}\\b`, "g"),
			),
		];
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value ||
			references.length < 2
		) {
			return false;
		}
	}
	return true;
}

function deleteTtlIsExact(serviceSource) {
	const declarations = [
		...serviceSource.matchAll(
			/^\s*(?:pub(?:\s*\([^)]*\))?\s+)?const\s+DELETE_BATCH_IDLE_TTL\s*:\s*Duration\s*=\s*Duration\s*::\s*from_secs\s*\(\s*([^)]*)\s*\)\s*;/gm,
		),
	];
	const references = [...serviceSource.matchAll(/\bDELETE_BATCH_IDLE_TTL\b/g)];
	return (
		declarations.length === 1 &&
		evaluateSmallRustIntegerExpression(declarations[0][1]) === 120 &&
		references.length >= 2
	);
}

function deleteContentReadBypass(executableDelete) {
	const readCalls = methodCalls(executableDelete, "read");
	if (
		readCalls.some(
			(call) =>
				!exactMethodCall(executableDelete, call, /\boptions\s*\.\s*$/, "true"),
		)
	) {
		return true;
	}
	for (const methodName of [
		"bytes",
		"fill_buf",
		"read_buf",
		"read_buf_exact",
		"read_exact",
		"read_line",
		"read_to_end",
		"read_to_string",
		"read_vectored",
	]) {
		if (methodCalls(executableDelete, methodName).length > 0) {
			return true;
		}
	}
	for (const match of executableDelete.matchAll(
		/\b(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/g,
	)) {
		const clause = match[1];
		if (
			(/\bstd\s*::[\s\S]*\bio\b/.test(clause) &&
				(/\b(?:Read|BufRead|AsyncRead|AsyncReadExt|prelude)\b/.test(clause) ||
					/\*/.test(clause))) ||
			(/\bstd\s*::[\s\S]*\bio\b/.test(clause) &&
				/\b(?:io|self)\s+as\s+[A-Za-z_]\w*/.test(clause)) ||
			/\bstd\s+as\s+[A-Za-z_]\w*/.test(clause)
		) {
			return true;
		}
	}
	return (
		/\bextern\s+crate\s+std\b/.test(executableDelete) ||
		/\b(?:std\s*::\s*)?io\s*::\s*(?:Read|BufRead|AsyncRead|AsyncReadExt)\b/.test(
			executableDelete,
		) ||
		/\b(?:Read|BufRead|AsyncRead|AsyncReadExt)\s*::\s*(?:read|bytes|fill_buf|read_buf|read_exact|read_line|read_to_end|read_to_string|read_vectored)\b/.test(
			executableDelete,
		) ||
		/\b(?:std\s*::\s*)?io\s*::\s*copy\b/.test(executableDelete)
	);
}

function rustStructFieldsAreExact(source, typeName, expectedFields) {
	const bodies = extractNamedStructBody(source, typeName);
	if (bodies.length !== 1) {
		return false;
	}
	const fields = splitTopLevelComma(bodies[0]).map((field) =>
		field.replaceAll(/\s+/g, ""),
	);
	return sameArray(fields, expectedFields);
}

function rustTypeIsNonClone(source, typeName) {
	const definitionPattern = new RegExp(
		`\\b(?:struct|enum)\\s+${escapeRegularExpression(typeName)}\\b`,
		"g",
	);
	const definitions = [...source.matchAll(definitionPattern)];
	if (definitions.length !== 1) {
		return false;
	}
	const prefix = source.slice(0, definitions[0].index);
	const attributes = /(?:#\s*\[[^\]]*\]\s*)+$/.exec(prefix)?.[0] ?? "";
	if (/\bClone\b/.test(attributes)) {
		return false;
	}
	const cloneImplementation = new RegExp(
		`\\bimpl(?:\\s*<[^>]*>)?\\s+(?:(?:[A-Za-z_]\\w*)\\s*::\\s*)*Clone\\s+for\\s+(?:(?:crate|self|super)\\s*::\\s*(?:[A-Za-z_]\\w*\\s*::\\s*)*)?${escapeRegularExpression(typeName)}\\b`,
	);
	return !cloneImplementation.test(source);
}

function compactDeleteStructuresAreExact(source) {
	return (
		rustStructFieldsAreExact(source, "DeleteEntryReceipt", [
			"parent_chain:Vec<FileIdentity>",
			"kind:DeleteReceiptKind",
		]) &&
		rustStructFieldsAreExact(source, "ManifestEntry", [
			"name:String",
			"parent:DirectoryIndex",
			"kind:ManifestEntryKind",
		]) &&
		["DirectoryReceipt", "ManifestEntry", "AliasJournal"].every((typeName) =>
			rustTypeIsNonClone(source, typeName),
		)
	);
}

function deleteAliasJournalAvoidsWholeSetClones(source) {
	if (
		/\bremaining_indices\b[^;\n]*\.\s*(?:clone|to_owned)\s*\(|\bremaining_indices\b[^;\n]*\.\s*iter\s*\(\s*\)[^;\n]*\.\s*cloned\s*\(/.test(
			source,
		)
	) {
		return false;
	}
	const functions = [
		...extractRustFunctions(source, "rebaseline_aliases"),
		...extractRustFunctions(source, "remove_alias_index"),
	];
	if (functions.length !== 2) {
		return false;
	}
	return functions.every(
		({ body }) =>
			!/\.\s*cloned\s*\(|\.\s*clone\s*\(|\.\s*to_owned\s*\(|\bremaining_indices\s*\.\s*(?:clone|to_owned)\s*\(/.test(
				body,
			),
	);
}

function deleteMemberVerificationIsStreaming(source) {
	const exactFunctions = extractRustFunctions(source, "verify_exact_members");
	const streamFunctions = extractRustFunctions(source, "verify_member_stream");
	if (exactFunctions.length !== 1 || streamFunctions.length !== 1) {
		return false;
	}
	const exact = exactFunctions[0].body;
	const stream = streamFunctions[0].body;
	const exactParameters = exactFunctions[0].parameters
		.replaceAll(/\s+/g, "")
		.replace(/,$/, "");
	const streamParameters = streamFunctions[0].parameters
		.replaceAll(/\s+/g, "")
		.replace(/,$/, "");
	if (
		exactParameters !== "directory:&Dir,expected:&BTreeSet<OsString>" ||
		exactFunctions[0].returnType.replaceAll(/\s+/g, "") !==
			"->Result<(),DeleteFailure>" ||
		streamParameters !==
			"expected:&BTreeSet<OsString>,observed:implIterator<Item=Result<OsString,DeleteFailure>>" ||
		streamFunctions[0].returnType.replaceAll(/\s+/g, "") !==
			"->Result<(),DeleteFailure>"
	) {
		return false;
	}
	if (
		/\.\s*collect\s*(?:::|\()|\b(?:BTreeSet|Vec)\s*(?:::|<)/.test(exact) ||
		/\.\s*collect\s*(?:::|\()|\b(?:BTreeSet|Vec)\s*(?:::|<)/.test(stream)
	) {
		return false;
	}
	const entriesCalls = methodCalls(exact, "entries");
	const streamCalls = extractCallArguments(
		exact,
		"verify_member_stream",
	).filter((call) => !/\bfn\s*$/.test(exact.slice(0, call.index)));
	return (
		entriesCalls.length === 1 &&
		streamCalls.length === 1 &&
		streamCalls[0].arguments.replaceAll(/\s+/g, "") === "expected,entries" &&
		/\bfor\s+name\s+in\s+observed\s*\{/.test(stream) &&
		/\bif\s*!\s*expected\s*\.\s*contains\s*\(\s*&\s*name\s*\)\s*\{[^}]*\breturn\s+Err\s*\(\s*DeleteFailure\s*::\s*Changed\s*\)\s*;/s.test(
			stream,
		) &&
		/\bobserved_count\s*\.\s*checked_add\s*\(\s*1\s*\)/.test(stream) &&
		/\bif\s+observed_count\s*>\s*expected\s*\.\s*len\s*\(\s*\)/.test(stream) &&
		/\bobserved_count\s*==\s*expected\s*\.\s*len\s*\(\s*\)/.test(stream)
	);
}

function deleteObservedReceiptDropsBeforeJournal(source) {
	const functions = extractRustFunctions(source, "delete_verified_entry");
	if (functions.length !== 1) {
		return false;
	}
	const body = functions[0].body;
	const binding =
		/\blet\s+([A-Za-z_]\w*)\s*=\s*match\s+build_entry_receipt\b/.exec(body);
	if (binding === null) {
		return false;
	}
	const observedName = binding[1];
	const build = binding.index;
	const comparison = body.search(
		new RegExp(
			`&\\s*${escapeRegularExpression(observedName)}\\s*!=\\s*expected`,
		),
	);
	const drops = extractCallArguments(body, "drop").filter(
		(call) => call.arguments.trim() === observedName,
	);
	const journalOffsets = [
		body.indexOf("delete_directory", Math.max(build, 0)),
		body.indexOf("directory_journal", Math.max(build, 0)),
		body.indexOf("alias_journal", Math.max(build, 0)),
	].filter((offset) => offset >= 0);
	if (
		build < 0 ||
		comparison < build ||
		drops.length !== 1 ||
		drops[0].index < comparison ||
		journalOffsets.length === 0 ||
		journalOffsets.some((offset) => offset < drops[0].end)
	) {
		return false;
	}
	return !new RegExp(`\\b${escapeRegularExpression(observedName)}\\b`).test(
		body.slice(drops[0].end),
	);
}

/**
 * Audits the source-only, permanent-delete implementation. This deliberately
 * complements (rather than weakens) the move/staging deletion allowlists.
 */
export function validateWorkspaceDeleteBoundary(rustSources) {
	const failures = [];
	const deletePath = "src-tauri/src/workspace/delete.rs";
	const deleteSource = findRustSource(rustSources, deletePath);
	const serviceSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/service.rs",
	);

	if (deleteSource === undefined) {
		return ["workspace delete boundary requires workspace/delete.rs"];
	}
	const executableDelete = stripRustCommentsAndLiterals(deleteSource);
	const duplicateDeleteLimit = rustSources.some(({ relativePath, source }) => {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			normalizedPath === deletePath ||
			!WORKSPACE_RUST_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			return false;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		return WORKSPACE_DELETE_LIMITS.some(
			([name, , integerType]) =>
				findWorkspaceCopyLimitDeclarations(executableSource, name, integerType)
					.length > 0,
		);
	});
	if (!deleteLimitsAreExact(executableDelete) || duplicateDeleteLimit) {
		failures.push(
			"workspace/delete.rs must define and consume the exact audited delete namespace limits",
		);
	}
	if (
		/\b(?:MAX_DELETE_(?:FILE|TREE|TOTAL|CONTENT)_BYTES|MAX_COPY_FILE_BYTES|MAX_COPY_TREE_BYTES)\b/.test(
			executableDelete,
		) ||
		/\b(?:sha2|Sha256|Digest|blake3|md5)\b|\bring\s*::\s*digest\b/.test(
			executableDelete,
		) ||
		deleteContentReadBypass(executableDelete)
	) {
		failures.push(
			"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
		);
	}
	if (!compactDeleteStructuresAreExact(executableDelete)) {
		failures.push(
			"workspace/delete.rs must keep compact index-based receipt structures and non-Clone directory journals",
		);
	}
	if (/\bPathBuf\b|\bto_path_buf\s*\(|\biter_mut\s*\(/.test(executableDelete)) {
		failures.push(
			"workspace/delete.rs must not retain full manifest paths or linearly search mutable manifests",
		);
	}
	if (!deleteAliasJournalAvoidsWholeSetClones(executableDelete)) {
		failures.push(
			"workspace/delete.rs alias rebaseline must select one remaining index without cloning whole journal sets",
		);
	}
	if (!deleteMemberVerificationIsStreaming(executableDelete)) {
		failures.push(
			"workspace/delete.rs must verify observed directory members as a fail-fast stream without collecting a second set",
		);
	}
	if (!deleteObservedReceiptDropsBeforeJournal(executableDelete)) {
		failures.push(
			"workspace/delete.rs must explicitly drop the full observed receipt before building delete journals",
		);
	}

	const receiptDefinitions = [];
	let receiptTraitImplementation = false;
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		for (const match of executableSource.matchAll(
			/\b(?:struct|enum)\s+DeleteBatchReceipt\b/g,
		)) {
			receiptDefinitions.push({
				relativePath: normalizedPath,
				index: match.index,
			});
		}
		if (
			/\bimpl(?:\s*<[^>]*>)?\s+(?:(?:serde\s*::\s*)?(?:Serialize|Deserialize)|Clone)\s+for\s+DeleteBatchReceipt\b/.test(
				executableSource,
			)
		) {
			receiptTraitImplementation = true;
		}
		if (
			normalizedPath !== deletePath &&
			normalizedPath !== "src-tauri/src/workspace/service.rs" &&
			/\bDeleteBatchReceipt\b/.test(executableSource)
		) {
			failures.push(
				`${normalizedPath} must not expose DeleteBatchReceipt across DTO or IPC boundaries`,
			);
		}
		if (
			/\b(?:trash(?:_rs)?|RecycleBin|FileAtomicDelete)\b|\btrash(?:_rs)?\s*::/.test(
				executableSource,
			)
		) {
			failures.push(
				`${normalizedPath} must not route workspace deletion through Trash or atomic-delete surfaces`,
			);
		}
	}
	if (
		receiptDefinitions.length !== 1 ||
		receiptDefinitions[0]?.relativePath !== deletePath
	) {
		failures.push(
			"DeleteBatchReceipt must have exactly one production definition in workspace/delete.rs",
		);
	}
	if (
		/#\s*\[\s*derive\s*\([^\]]*\b(?:Serialize|Deserialize|Clone)\b[^\]]*\)\s*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum)\s+DeleteBatchReceipt\b/s.test(
			executableDelete,
		) ||
		/#\s*\[\s*serde\b[^\]]*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum)\s+DeleteBatchReceipt\b/s.test(
			executableDelete,
		) ||
		receiptTraitImplementation
	) {
		failures.push(
			"DeleteBatchReceipt must remain non-Serde and non-Clone Rust-only typestate",
		);
	}
	for (const relativePath of [
		"src-tauri/src/workspace/dto.rs",
		"src-tauri/src/workspace/commands.rs",
		"src-tauri/src/lib.rs",
	]) {
		const source = findRustSource(rustSources, relativePath);
		if (
			source !== undefined &&
			/\bDeleteBatchReceipt\b/.test(stripRustCommentsAndLiterals(source))
		) {
			failures.push(
				`${relativePath} must not expose DeleteBatchReceipt across DTO or IPC boundaries`,
			);
		}
	}

	if (!deleteRemovalHelperIsExact(executableDelete)) {
		failures.push(
			"workspace/delete.rs must delete only through one audited parent-handle remove_verified_entry helper",
		);
	}
	if (
		/\.\s*open_dir\s*\(/.test(executableDelete) ||
		/\bDir\s*::\s*(?:open|from_std_file|from_raw_fd|from_raw_handle|open_ambient_dir)\s*\(/.test(
			executableDelete,
		) ||
		/\bambient_authority\b/.test(executableDelete)
	) {
		failures.push(
			"workspace/delete.rs must reopen directory chains only with capability-relative nofollow operations",
		);
	}
	if (
		/\b(?:remove_open_dir|remove_open_dir_all|remove_dir_all|unlink|unlinkat)\b/.test(
			executableDelete,
		) ||
		/\bstd\s*::\s*fs\s*::/.test(executableDelete)
	) {
		failures.push(
			"workspace/delete.rs must not use recursive, open-directory, direct-unlink or ambient-fs deletion",
		);
	}
	if (
		/\b(?:std|tokio|async_process)\s*::\s*(?:\{[^;}]*\bprocess\b|process\b)|\btauri_plugin_shell\b|\b(?:Command|Shell)\s*::\s*new\s*\(/s.test(
			executableDelete,
		) ||
		/\b(?:async_process|duct|subprocess|xshell|walkdir|jwalk|globwalk)\b/.test(
			executableDelete,
		) ||
		/\b(?:libc|nix)\s*::(?:\s*[A-Za-z_]\w*\s*::)*\s*(?:remove|rmdir|system|posix_spawn|execv|execve|fork)\b/.test(
			executableDelete,
		) ||
		/\bignore\s*::\s*(?:Walk|WalkBuilder)\b/.test(executableDelete)
	) {
		failures.push(
			"workspace/delete.rs must not use process, shell or recursive-walker deletion bypasses",
		);
	}

	if (serviceSource === undefined) {
		failures.push("workspace delete boundary requires workspace/service.rs");
		return failures;
	}
	const executableService = stripRustCommentsAndLiterals(serviceSource);
	if (!deleteTtlIsExact(executableService)) {
		failures.push(
			"workspace/service.rs must define and consume a 120-second DELETE_BATCH_IDLE_TTL",
		);
	}
	const activeReceiptFields = [
		...executableService.matchAll(
			/\b([A-Za-z_]\w*)\s*:\s*Option\s*<\s*DeleteBatchReceipt\s*>/g,
		),
	];
	if (
		activeReceiptFields.length !== 1 ||
		activeReceiptFields[0][1] !== "active_delete_batch"
	) {
		failures.push(
			"WindowWorkspace state must hold exactly one optional active DeleteBatchReceipt",
		);
	}
	if (!deleteServiceRoutesAreUnique(executableService)) {
		failures.push(
			"WorkspaceService must define one route for each delete phase and delegate once to WindowWorkspace",
		);
	}
	if (!deleteServiceLockOrderIsExact(executableService)) {
		failures.push(
			"every WindowWorkspace delete phase must lock mutation_gate before delete state",
		);
	}

	return [...new Set(failures)];
}

function typeScriptMemberName(member) {
	if (member.name === undefined) {
		return undefined;
	}
	if (
		ts.isIdentifier(member.name) ||
		ts.isPrivateIdentifier(member.name) ||
		ts.isStringLiteral(member.name) ||
		ts.isNumericLiteral(member.name)
	) {
		return member.name.text;
	}
	return undefined;
}

function isFinalWorkspaceProviderPrototypeFreeze(statement, sourceFile) {
	return (
		ts.isExpressionStatement(statement) &&
		statement.getText(sourceFile).replaceAll(/\s+/g, "") ===
			"Object.freeze(PlainWorkspaceFileSystemProvider.prototype);"
	);
}

function hasFinalWorkspaceProviderCapabilityContract(provider, sourceFile) {
	const capabilityMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "capabilities",
	);
	const constructors = provider.members.filter((member) =>
		ts.isConstructorDeclaration(member),
	);
	if (capabilityMembers.length !== 1 || constructors.length !== 1) {
		return false;
	}
	const capabilityMember = capabilityMembers[0];
	const capabilityType = capabilityMember.type;
	const constructor = constructors[0];
	const providerStatementIndex = sourceFile.statements.indexOf(provider);
	const prototypeFreezeIndexes = sourceFile.statements.flatMap(
		(statement, index) =>
			isFinalWorkspaceProviderPrototypeFreeze(statement, sourceFile)
				? [index]
				: [],
	);
	const privateBridgeMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "#bridge",
	);
	const privatePolicyMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "#allowsMutationDispatch",
	);
	const [bridgeParameter, policyParameter] = constructor.parameters;
	const constructorStatements = constructor.body?.statements ?? [];
	function isExactPrivateField(member, name, typeName) {
		return (
			member !== undefined &&
			ts.isPrivateIdentifier(member.name) &&
			member.name.text === name &&
			member.modifiers?.length === 1 &&
			member.modifiers[0].kind === ts.SyntaxKind.ReadonlyKeyword &&
			member.questionToken === undefined &&
			member.exclamationToken === undefined &&
			member.initializer === undefined &&
			member.type !== undefined &&
			(typeName === "boolean"
				? member.type.kind === ts.SyntaxKind.BooleanKeyword
				: ts.isTypeReferenceNode(member.type) &&
					ts.isIdentifier(member.type.typeName) &&
					member.type.typeName.text === typeName)
		);
	}
	function isExactPlainParameter(parameter, name, typeName) {
		return (
			parameter !== undefined &&
			ts.isIdentifier(parameter.name) &&
			parameter.name.text === name &&
			(parameter.modifiers?.length ?? 0) === 0 &&
			parameter.questionToken === undefined &&
			parameter.dotDotDotToken === undefined &&
			parameter.initializer === undefined &&
			parameter.type !== undefined &&
			(typeName === "boolean"
				? parameter.type.kind === ts.SyntaxKind.BooleanKeyword
				: ts.isTypeReferenceNode(parameter.type) &&
					ts.isIdentifier(parameter.type.typeName) &&
					parameter.type.typeName.text === typeName)
		);
	}
	return (
		privateBridgeMembers.length === 1 &&
		isExactPrivateField(privateBridgeMembers[0], "#bridge", "PlainBridge") &&
		privatePolicyMembers.length === 1 &&
		isExactPrivateField(
			privatePolicyMembers[0],
			"#allowsMutationDispatch",
			"boolean",
		) &&
		ts.isIdentifier(capabilityMember.name) &&
		capabilityMember.name.text === "capabilities" &&
		capabilityMember.initializer === undefined &&
		capabilityMember.modifiers?.length === 1 &&
		capabilityMember.modifiers[0].kind === ts.SyntaxKind.ReadonlyKeyword &&
		capabilityMember.questionToken === undefined &&
		capabilityMember.exclamationToken === undefined &&
		capabilityType !== undefined &&
		ts.isTypeReferenceNode(capabilityType) &&
		ts.isIdentifier(capabilityType.typeName) &&
		capabilityType.typeName.text === "FileSystemProviderCapabilities" &&
		(constructor.modifiers?.length ?? 0) === 0 &&
		constructor.parameters.length === 2 &&
		isExactPlainParameter(bridgeParameter, "bridge", "PlainBridge") &&
		isExactPlainParameter(
			policyParameter,
			"allowsMutationDispatch",
			"boolean",
		) &&
		constructorStatements.length === 4 &&
		sameArray(
			constructorStatements.map((statement) =>
				statement.getText(sourceFile).replaceAll(/\s+/g, ""),
			),
			[
				"this.#bridge=bridge;",
				"this.#allowsMutationDispatch=allowsMutationDispatch;",
				"this.capabilities=FileSystemProviderCapabilities.FileReadWrite|(allowsMutationDispatch?FileSystemProviderCapabilities.FileFolderCopy:FileSystemProviderCapabilities.Readonly);",
				"Object.freeze(this);",
			],
		) &&
		prototypeFreezeIndexes.length === 1 &&
		prototypeFreezeIndexes[0] === providerStatementIndex + 1
	);
}

const WORKSPACE_DELETE_TS_COMMANDS = Object.freeze([
	Object.freeze({
		command: "workspace_prepare_delete",
		bridgeMethod: "workspacePrepareDelete",
	}),
	Object.freeze({
		command: "workspace_cancel_delete",
		bridgeMethod: "workspaceCancelDelete",
	}),
	Object.freeze({
		command: "workspace_begin_delete",
		bridgeMethod: "workspaceBeginDelete",
	}),
	Object.freeze({
		command: "workspace_commit_delete_entry",
		bridgeMethod: "workspaceCommitDeleteEntry",
	}),
]);

function typeScriptStaticName(node) {
	if (node === undefined) {
		return undefined;
	}
	if (
		ts.isIdentifier(node) ||
		ts.isStringLiteral(node) ||
		ts.isNoSubstitutionTemplateLiteral(node)
	) {
		return node.text;
	}
	return undefined;
}

function containingPropertyName(node) {
	let current = node.parent;
	while (current !== undefined) {
		if (
			ts.isPropertyAssignment(current) ||
			ts.isMethodDeclaration(current) ||
			ts.isMethodSignature(current)
		) {
			return typeScriptStaticName(current.name);
		}
		if (ts.isSourceFile(current)) {
			break;
		}
		current = current.parent;
	}
	return undefined;
}

function unwrapTypeScriptExpression(node) {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function evaluateStaticTypeScriptString(node) {
	const current = unwrapTypeScriptExpression(node);
	if (
		ts.isStringLiteral(current) ||
		ts.isNoSubstitutionTemplateLiteral(current)
	) {
		return current.text;
	}
	if (
		ts.isBinaryExpression(current) &&
		current.operatorToken.kind === ts.SyntaxKind.PlusToken
	) {
		const left = evaluateStaticTypeScriptString(current.left);
		const right = evaluateStaticTypeScriptString(current.right);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	if (ts.isTemplateExpression(current)) {
		let value = current.head.text;
		for (const span of current.templateSpans) {
			const expression = evaluateStaticTypeScriptString(span.expression);
			if (expression === undefined) {
				return undefined;
			}
			value += expression + span.literal.text;
		}
		return value;
	}
	return undefined;
}

function collectTypeScriptBridgeAliases(sourceFile) {
	const aliases = new Set();
	const candidates = [];
	function collect(node) {
		if (
			ts.isParameter(node) &&
			ts.isIdentifier(node.name) &&
			(/bridge/i.test(node.name.text) ||
				(node.type !== undefined &&
					/\bPlainBridge\b/.test(node.type.getText(sourceFile))))
		) {
			aliases.add(node.name.text);
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			if (
				/bridge/i.test(node.name.text) ||
				(node.type !== undefined &&
					/\bPlainBridge\b/.test(node.type.getText(sourceFile))) ||
				(node.initializer !== undefined &&
					(ts.isAsExpression(node.initializer) ||
						ts.isTypeAssertionExpression(node.initializer)) &&
					/\bPlainBridge\b/.test(node.initializer.type.getText(sourceFile)))
			) {
				aliases.add(node.name.text);
			}
			if (node.initializer !== undefined) {
				candidates.push({ name: node.name.text, value: node.initializer });
			}
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		) {
			candidates.push({ name: node.left.text, value: node.right });
		}
		ts.forEachChild(node, collect);
	}
	collect(sourceFile);

	const isKnownBridge = (node) => {
		const current = unwrapTypeScriptExpression(node);
		if (ts.isIdentifier(current)) {
			return aliases.has(current.text) || /bridge/i.test(current.text);
		}
		if (ts.isPropertyAccessExpression(current)) {
			return /bridge/i.test(current.name.text);
		}
		return (
			ts.isCallExpression(current) &&
			ts.isIdentifier(current.expression) &&
			/^create(?:Native|BrowserMock)?Bridge$/.test(current.expression.text)
		);
	};
	let changed = true;
	while (changed) {
		changed = false;
		for (const candidate of candidates) {
			if (!aliases.has(candidate.name) && isKnownBridge(candidate.value)) {
				aliases.add(candidate.name);
				changed = true;
			}
		}
	}
	return isKnownBridge;
}

/**
 * The registered workspace provider and the native bridge are one-way
 * bootstrap values. Keep their factories on the fixed definition -> import ->
 * direct-call routes, keep Tauri's private global inside the bridge directory,
 * and reject only getProvider reads derived from the IFileService authority
 * token. The last condition deliberately permits unrelated catalog APIs that
 * happen to use the same method name.
 */
// app/features/search/plain-search-service.ts extends the unpatched
// SearchService base class from @codingame/monaco-vscode-search-service-override
// (see that file's own doc comment). That base class's own constructor takes
// IFileService as its 6th parameter and stores it as `this.fileService`,
// purely to call `this.fileService.exists(folder)` when pre-filtering folder
// queries (verified: searchService.js contains zero `getProvider` calls of
// any kind — grep confirms it). Extending that base class, and wiring it
// through Plain's own DI SyncDescriptor, is therefore structurally
// impossible without some app file importing the literal `IFileService`
// value (both for the constructor parameter type and for the manual
// ServiceIdentifier-decorator call each DI-constructed class must redeclare
// for its own exact constructor — see that file's doc comment on why
// PlainSearchService cannot inherit SearchService's dependency list).
// app/features/themes/plain-theme-registry.ts and app/main.ts are the second
// audited exemption. Built-in (and, in a later slice, imported) color theme
// resources live in the read-only, static `extension-file:` virtual tree
// (registered by `registerFileUrl`/`registerExtensionFile`, a scheme wholly
// distinct from `file:` or `plain-workspace:` — see the module doc comment
// on PlainExtensionResourceLoaderService in plain-theme-registry.ts). Both
// upstream's own `ColorThemeData#ensureLoaded`/`_loadColorTheme` (via
// `IExtensionResourceLoaderService.readExtensionResource`) and Plain's own
// NLS-bundle read (`readNlsBundle`, resolving `%placeholder%` labels) need a
// real IFileService to read those already-registered bytes; no override
// package provides one (see plain-theme-registry.ts's own doc comment), so
// Plain's PlainExtensionResourceLoaderService wraps IFileService directly,
// and app/main.ts resolves it once via `getService(IFileService)` to hand to
// `createPlainThemeRegistry`. Neither file ever calls `.getProvider(...)` on
// an IFileService-derived expression — the getProvider-derivation check
// below is NOT exempted anywhere, including in these two files.
//
// This is the narrow, audited exemption set from the blanket "no app file
// may reference IFileService" rule below; the getProvider-derivation check
// three lines down is NOT exempted anywhere, including in these files — if
// any exempted file (or anything it delegates to) ever called
// `.getProvider(...)` on a fileService-derived expression, this function
// would still fail it.
const IFILE_SERVICE_TOKEN_EXEMPT_PATHS = new Set([
	"app/features/search/plain-search-service.ts",
	"app/features/themes/plain-theme-registry.ts",
	"app/main.ts",
]);

export function validateWorkspaceProviderRetrievalBoundary(appSources) {
	const failures = [];
	const factoryContracts = new Map([
		[
			"createPlainWorkspaceFileSystemProvider",
			{
				definitionPath: "app/features/workspace/file-system-provider.ts",
				consumerPath: "app/main.ts",
				moduleName: "./features/workspace/file-system-provider",
			},
		],
		[
			"createBridge",
			{
				definitionPath: "app/platform/tauri/index.ts",
				consumerPath: "app/main.ts",
				moduleName: "./platform/tauri",
			},
		],
		[
			"createNativeBridge",
			{
				definitionPath: "app/platform/tauri/native.ts",
				consumerPath: "app/platform/tauri/index.ts",
				moduleName: "./native",
			},
		],
		[
			"createBrowserMockBridge",
			{
				definitionPath: "app/platform/tauri/browser-mock.ts",
				consumerPath: "app/platform/tauri/index.ts",
				moduleName: "./browser-mock",
			},
		],
	]);
	const factoryOccurrences = new Map(
		[...factoryContracts.keys()].map((name) => [
			name,
			{ definitions: 0, imports: 0, calls: 0 },
		]),
	);
	const hasExportModifier = (node) =>
		node.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		) === true;
	const importDeclarationFor = (specifier) => {
		const namedImports = specifier.parent;
		const importClause = namedImports.parent;
		const declaration = importClause.parent;
		return ts.isImportDeclaration(declaration) ? declaration : undefined;
	};
	const isExactFactoryDefinition = (node, normalizedPath, contract) =>
		ts.isFunctionDeclaration(node.parent) &&
		node.parent.name === node &&
		normalizedPath === contract.definitionPath &&
		hasExportModifier(node.parent);
	const isExactFactoryImport = (node, normalizedPath, contract) => {
		if (
			!ts.isImportSpecifier(node.parent) ||
			node.parent.name !== node ||
			node.parent.propertyName !== undefined ||
			node.parent.isTypeOnly ||
			normalizedPath !== contract.consumerPath
		) {
			return false;
		}
		const declaration = importDeclarationFor(node.parent);
		return (
			declaration !== undefined &&
			declaration.importClause?.isTypeOnly !== true &&
			ts.isStringLiteral(declaration.moduleSpecifier) &&
			declaration.moduleSpecifier.text === contract.moduleName
		);
	};
	const isExactFactoryCall = (node, normalizedPath, contract) =>
		ts.isCallExpression(node.parent) &&
		node.parent.expression === node &&
		normalizedPath === contract.consumerPath;
	const isReflectGetCall = (
		node,
		evaluateString = evaluateStaticTypeScriptString,
	) => {
		if (!ts.isCallExpression(node)) {
			return false;
		}
		const target = unwrapTypeScriptExpression(node.expression);
		if (ts.isPropertyAccessExpression(target)) {
			return (
				ts.isIdentifier(unwrapTypeScriptExpression(target.expression)) &&
				unwrapTypeScriptExpression(target.expression).text === "Reflect" &&
				target.name.text === "get"
			);
		}
		return (
			ts.isElementAccessExpression(target) &&
			ts.isIdentifier(unwrapTypeScriptExpression(target.expression)) &&
			unwrapTypeScriptExpression(target.expression).text === "Reflect" &&
			evaluateString(target.argumentExpression) === "get"
		);
	};
	for (const { relativePath, source } of appSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		let referencesFileServiceToken = false;
		let referencesProviderGetter = false;
		const tokenAliases = new Set(["IFileService"]);
		const getServiceAliases = new Set(["getService"]);
		const fileServiceAliases = new Set();
		const aliasCandidates = [];
		const unwrapAuthorityExpression = (node) => {
			let current = unwrapTypeScriptExpression(node);
			while (ts.isAwaitExpression(current)) {
				current = unwrapTypeScriptExpression(current.expression);
			}
			return current;
		};
		const staticStringAliases = new Map();
		const staticStringCandidates = [];
		function evaluateAuthorityStaticString(node) {
			const current = unwrapTypeScriptExpression(node);
			if (ts.isIdentifier(current)) {
				return staticStringAliases.get(current.text);
			}
			if (
				ts.isStringLiteral(current) ||
				ts.isNoSubstitutionTemplateLiteral(current)
			) {
				return current.text;
			}
			if (
				ts.isBinaryExpression(current) &&
				current.operatorToken.kind === ts.SyntaxKind.PlusToken
			) {
				const left = evaluateAuthorityStaticString(current.left);
				const right = evaluateAuthorityStaticString(current.right);
				return left === undefined || right === undefined
					? undefined
					: left + right;
			}
			if (ts.isTemplateExpression(current)) {
				let value = current.head.text;
				for (const span of current.templateSpans) {
					const expression = evaluateAuthorityStaticString(span.expression);
					if (expression === undefined) {
						return undefined;
					}
					value += expression + span.literal.text;
				}
				return value;
			}
			return undefined;
		}
		function collectStaticStringCandidates(node) {
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer !== undefined &&
				ts.isVariableDeclarationList(node.parent) &&
				(node.parent.flags & ts.NodeFlags.Const) !== 0
			) {
				staticStringCandidates.push({
					name: node.name.text,
					value: node.initializer,
				});
			}
			ts.forEachChild(node, collectStaticStringCandidates);
		}
		collectStaticStringCandidates(sourceFile);
		let staticStringsChanged = true;
		while (staticStringsChanged) {
			staticStringsChanged = false;
			for (const candidate of staticStringCandidates) {
				if (staticStringAliases.has(candidate.name)) {
					continue;
				}
				const value = evaluateAuthorityStaticString(candidate.value);
				if (value !== undefined) {
					staticStringAliases.set(candidate.name, value);
					staticStringsChanged = true;
				}
			}
		}
		const bindingElementStaticName = (node) => {
			const propertyName = node.propertyName ?? node.name;
			if (ts.isComputedPropertyName(propertyName)) {
				return evaluateAuthorityStaticString(propertyName.expression);
			}
			return ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)
				? propertyName.text
				: undefined;
		};
		const bindingElementInitializer = (node) => {
			const bindingPattern = node.parent;
			const declaration = bindingPattern.parent;
			return ts.isObjectBindingPattern(bindingPattern) &&
				ts.isVariableDeclaration(declaration)
				? declaration.initializer
				: undefined;
		};
		const isStaticMember = (node, memberName) => {
			const current = unwrapAuthorityExpression(node);
			return (
				(ts.isPropertyAccessExpression(current) &&
					current.name.text === memberName) ||
				(ts.isElementAccessExpression(current) &&
					evaluateAuthorityStaticString(current.argumentExpression) ===
						memberName) ||
				(isReflectGetCall(current, evaluateAuthorityStaticString) &&
					current.arguments.length >= 2 &&
					evaluateAuthorityStaticString(current.arguments[1]) === memberName)
			);
		};
		const isTokenExpression = (node) => {
			const current = unwrapAuthorityExpression(node);
			return (
				(ts.isIdentifier(current) && tokenAliases.has(current.text)) ||
				isStaticMember(current, "IFileService")
			);
		};
		const isGetServiceExpression = (node) => {
			const current = unwrapAuthorityExpression(node);
			return (
				(ts.isIdentifier(current) && getServiceAliases.has(current.text)) ||
				isStaticMember(current, "getService")
			);
		};
		const isFileServiceExpression = (node) => {
			const current = unwrapAuthorityExpression(node);
			return (
				(ts.isIdentifier(current) && fileServiceAliases.has(current.text)) ||
				(ts.isCallExpression(current) &&
					isGetServiceExpression(current.expression) &&
					current.arguments.some(isTokenExpression))
			);
		};
		for (const statement of sourceFile.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				statement.importClause === undefined ||
				statement.importClause.namedBindings === undefined ||
				!ts.isNamedImports(statement.importClause.namedBindings)
			) {
				continue;
			}
			for (const specifier of statement.importClause.namedBindings.elements) {
				const importedName =
					specifier.propertyName?.text ?? specifier.name.text;
				if (importedName === "IFileService") {
					referencesFileServiceToken = true;
					tokenAliases.add(specifier.name.text);
				}
				if (importedName === "getService") {
					getServiceAliases.add(specifier.name.text);
				}
			}
		}
		function collectAliases(node) {
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer !== undefined
			) {
				aliasCandidates.push({ name: node.name.text, value: node.initializer });
			}
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left)
			) {
				aliasCandidates.push({ name: node.left.text, value: node.right });
			}
			if (
				ts.isBindingElement(node) &&
				ts.isIdentifier(node.name) &&
				bindingElementStaticName(node) === "IFileService"
			) {
				referencesFileServiceToken = true;
				tokenAliases.add(node.name.text);
			}
			ts.forEachChild(node, collectAliases);
		}
		collectAliases(sourceFile);
		let aliasesChanged = true;
		while (aliasesChanged) {
			aliasesChanged = false;
			for (const candidate of aliasCandidates) {
				if (
					!tokenAliases.has(candidate.name) &&
					isTokenExpression(candidate.value)
				) {
					tokenAliases.add(candidate.name);
					aliasesChanged = true;
				}
				if (
					!getServiceAliases.has(candidate.name) &&
					isGetServiceExpression(candidate.value)
				) {
					getServiceAliases.add(candidate.name);
					aliasesChanged = true;
				}
				if (
					!fileServiceAliases.has(candidate.name) &&
					isFileServiceExpression(candidate.value)
				) {
					fileServiceAliases.add(candidate.name);
					aliasesChanged = true;
				}
			}
		}
		function visit(node) {
			if (
				(ts.isIdentifier(node) && node.text === "IFileService") ||
				isStaticMember(node, "IFileService")
			) {
				referencesFileServiceToken = true;
			}
			if (
				ts.isPropertyAccessExpression(node) &&
				node.name.text === "getProvider" &&
				isFileServiceExpression(node.expression)
			) {
				referencesProviderGetter = true;
			}
			if (
				ts.isElementAccessExpression(node) &&
				evaluateAuthorityStaticString(node.argumentExpression) ===
					"getProvider" &&
				isFileServiceExpression(node.expression)
			) {
				referencesProviderGetter = true;
			}
			if (
				isReflectGetCall(node, evaluateAuthorityStaticString) &&
				node.arguments.length >= 2 &&
				evaluateAuthorityStaticString(node.arguments[1]) === "getProvider" &&
				isFileServiceExpression(node.arguments[0])
			) {
				referencesProviderGetter = true;
			}
			if (
				ts.isBindingElement(node) &&
				bindingElementStaticName(node) === "getProvider"
			) {
				const initializer = bindingElementInitializer(node);
				if (initializer !== undefined && isFileServiceExpression(initializer)) {
					referencesProviderGetter = true;
				}
			}

			if (ts.isIdentifier(node)) {
				const contract = factoryContracts.get(node.text);
				if (contract !== undefined) {
					const occurrences = factoryOccurrences.get(node.text);
					if (isExactFactoryDefinition(node, normalizedPath, contract)) {
						occurrences.definitions += 1;
					} else if (isExactFactoryImport(node, normalizedPath, contract)) {
						occurrences.imports += 1;
					} else if (isExactFactoryCall(node, normalizedPath, contract)) {
						occurrences.calls += 1;
					} else {
						failures.push(
							`${normalizedPath} must not reference ${node.text} outside its audited authority route`,
						);
					}
				} else if (
					/^create[A-Za-z0-9_$]*Bridge$/.test(node.text) &&
					!normalizedPath.startsWith("app/platform/tauri/")
				) {
					failures.push(
						`${normalizedPath} must not define or reference local bridge factory ${node.text} outside app/platform/tauri/`,
					);
				}
			}
			if (
				ts.isStringLiteralLike(node) ||
				ts.isIdentifier(node) ||
				ts.isBinaryExpression(node) ||
				ts.isTemplateExpression(node)
			) {
				const staticName = evaluateAuthorityStaticString(node);
				if (factoryContracts.has(staticName)) {
					failures.push(
						`${normalizedPath} must not reference ${staticName} outside its audited authority route`,
					);
				} else if (
					/^create[A-Za-z0-9_$]*Bridge$/.test(staticName ?? "") &&
					!normalizedPath.startsWith("app/platform/tauri/")
				) {
					failures.push(
						`${normalizedPath} must not define or reference local bridge factory ${staticName} outside app/platform/tauri/`,
					);
				}
				if (
					staticName === "__TAURI_INTERNALS__" &&
					!normalizedPath.startsWith("app/platform/tauri/")
				) {
					failures.push(
						`${normalizedPath} must not access __TAURI_INTERNALS__ outside app/platform/tauri/`,
					);
				}
			}
			if (
				ts.isIdentifier(node) &&
				node.text === "__TAURI_INTERNALS__" &&
				!normalizedPath.startsWith("app/platform/tauri/")
			) {
				failures.push(
					`${normalizedPath} must not access __TAURI_INTERNALS__ outside app/platform/tauri/`,
				);
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
		if (
			referencesFileServiceToken &&
			!IFILE_SERVICE_TOKEN_EXEMPT_PATHS.has(normalizedPath)
		) {
			failures.push(
				`${normalizedPath} must not import or reference IFileService in the Plain application`,
			);
		}
		if (referencesProviderGetter) {
			failures.push(
				`${normalizedPath} must not recover the registered workspace provider through getProvider`,
			);
		}
	}
	for (const [factoryName, contract] of factoryContracts) {
		const occurrences = factoryOccurrences.get(factoryName);
		if (occurrences.definitions !== 1) {
			failures.push(
				`${factoryName} must have exactly one exported definition in ${contract.definitionPath}`,
			);
		}
		if (occurrences.imports !== 1) {
			failures.push(
				`${factoryName} must have exactly one unaliased named import from ${contract.moduleName} in ${contract.consumerPath}`,
			);
		}
		if (occurrences.calls !== 1) {
			failures.push(
				`${factoryName} must have exactly one direct call in ${contract.consumerPath}`,
			);
		}
	}
	return [...new Set(failures)];
}

/**
 * Locks the only confirmed-delete application route. The coordinator may own
 * prepare/cancel/begin, the provider may own commit, and the private Workbench
 * authorization helpers may be consumed only at their fixed typestate sites.
 */
export function validateWorkspaceDeleteTypeScriptBoundary(appSources) {
	const failures = [...validateWorkspaceProviderRetrievalBoundary(appSources)];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		"app/platform/tauri/contracts.ts",
		"app/platform/tauri/native.ts",
		"app/platform/tauri/browser-mock.ts",
		"app/features/workspace/delete-coordinator.ts",
		"app/features/workspace/file-system-provider.ts",
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(
				`confirmed-delete TypeScript boundary requires ${relativePath}`,
			);
		}
	}

	const commandOccurrences = new Map(
		WORKSPACE_DELETE_TS_COMMANDS.map(({ command }) => [command, []]),
	);
	const bridgeMethods = new Set(
		WORKSPACE_DELETE_TS_COMMANDS.map(({ bridgeMethod }) => bridgeMethod),
	);
	const declarationPaths = Object.freeze([
		"app/platform/tauri/contracts.ts",
		"app/platform/tauri/native.ts",
		"app/platform/tauri/browser-mock.ts",
	]);
	const declarationCounts = new Map(
		declarationPaths.flatMap((relativePath) =>
			[...bridgeMethods].map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	const coordinatorPath = "app/features/workspace/delete-coordinator.ts";
	const providerPath = "app/features/workspace/file-system-provider.ts";
	const bridgeRouteCounts = new Map(
		[coordinatorPath, providerPath].flatMap((relativePath) =>
			[...bridgeMethods].map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	const expectedBridgeRoutes = new Map([
		[`${coordinatorPath}:workspacePrepareDelete`, 1],
		[`${coordinatorPath}:workspaceCancelDelete`, 1],
		[`${coordinatorPath}:workspaceBeginDelete`, 1],
		[`${coordinatorPath}:workspaceCommitDeleteEntry`, 0],
		[`${providerPath}:workspacePrepareDelete`, 0],
		[`${providerPath}:workspaceCancelDelete`, 0],
		[`${providerPath}:workspaceBeginDelete`, 0],
		[`${providerPath}:workspaceCommitDeleteEntry`, 1],
	]);
	const expectedBridgeArguments = new Map([
		[`${coordinatorPath}:workspacePrepareDelete`, ["requests"]],
		[`${coordinatorPath}:workspaceCancelDelete`, ["plan.confirmationId"]],
		[`${coordinatorPath}:workspaceBeginDelete`, ["plan.confirmationId"]],
		[
			`${providerPath}:workspaceCommitDeleteEntry`,
			[
				"authorizationSnapshot.confirmationId",
				"authorizationSnapshot.entryId",
				"authorizationSnapshot.rootId",
				"authorizationSnapshot.relativePath",
				"authorizationSnapshot.recursive",
			],
		],
	]);

	const internalModule =
		"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";
	const expectedInternalImports = new Map([
		[
			coordinatorPath,
			new Set([
				"value:authorizePlainWorkspaceDeleteResourceEdit",
				"value:getPlainWorkspaceDeleteState",
				"value:registerPlainWorkspaceDeleteCoordinator",
				"type:PlainWorkspaceDeleteAuthorization",
				"type:PlainWorkspaceDeleteCoordinatorContext",
			]),
		],
		[
			providerPath,
			new Set([
				"value:beginPlainWorkspaceDeleteProviderDispatch",
				"value:completePlainWorkspaceDeleteProviderFailure",
				"value:completePlainWorkspaceDeleteProviderResult",
				"value:getPlainWorkspaceDeleteAuthorizationSnapshot",
				"value:takePlainWorkspaceDeleteProviderAuthorization",
			]),
		],
	]);
	const internalValueConsumers = new Map([
		[
			"authorizePlainWorkspaceDeleteResourceEdit",
			{
				path: coordinatorPath,
				functionName: "createAuthorizedEdits",
				count: 1,
			},
		],
		[
			"getPlainWorkspaceDeleteState",
			{
				path: coordinatorPath,
				functionName: "classifyAuthorizationResults",
				count: 1,
			},
		],
		[
			"registerPlainWorkspaceDeleteCoordinator",
			{
				path: coordinatorPath,
				functionName: "registerWorkspaceDeleteCoordinator",
				count: 1,
			},
		],
		[
			"beginPlainWorkspaceDeleteProviderDispatch",
			{ path: providerPath, functionName: "delete", count: 1 },
		],
		[
			"completePlainWorkspaceDeleteProviderFailure",
			{ path: providerPath, functionName: "delete", count: 2 },
		],
		[
			"completePlainWorkspaceDeleteProviderResult",
			{ path: providerPath, functionName: "delete", count: 1 },
		],
		[
			"getPlainWorkspaceDeleteAuthorizationSnapshot",
			{ path: providerPath, functionName: "delete", count: 1 },
		],
		[
			"takePlainWorkspaceDeleteProviderAuthorization",
			{ path: providerPath, functionName: "delete", count: 1 },
		],
	]);
	const internalConsumerCounts = new Map(
		[...internalValueConsumers].map(([name]) => [name, 0]),
	);
	const seenInternalImports = new Map(
		[...expectedInternalImports].map(([relativePath]) => [relativePath, 0]),
	);
	let exactInvokeImportCount = 0;

	function containingFunctionName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isFunctionDeclaration(current) ||
				ts.isMethodDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	for (const [normalizedPath, source] of normalizedSources) {
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);
		for (const statement of sourceFile.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier)
			) {
				continue;
			}
			const moduleName = statement.moduleSpecifier.text;
			if (moduleName === "@tauri-apps/api/core") {
				const bindings = statement.importClause?.namedBindings;
				const isExactInvokeImport =
					normalizedPath === "app/platform/tauri/native.ts" &&
					statement.importClause?.isTypeOnly !== true &&
					statement.importClause?.name === undefined &&
					bindings !== undefined &&
					ts.isNamedImports(bindings) &&
					bindings.elements.length === 1 &&
					bindings.elements[0].propertyName === undefined &&
					bindings.elements[0].isTypeOnly !== true &&
					bindings.elements[0].name.text === "invoke";
				if (!isExactInvokeImport) {
					failures.push(
						`${normalizedPath} must import invoke from @tauri-apps/api/core only as the direct native bridge binding`,
					);
				} else {
					exactInvokeImportCount += 1;
				}
			}
			if (moduleName === internalModule) {
				const expected = expectedInternalImports.get(normalizedPath);
				const bindings = statement.importClause?.namedBindings;
				const actual = new Set();
				let exact =
					expected !== undefined &&
					statement.importClause?.name === undefined &&
					bindings !== undefined &&
					ts.isNamedImports(bindings);
				if (exact && bindings !== undefined && ts.isNamedImports(bindings)) {
					for (const specifier of bindings.elements) {
						const imported =
							specifier.propertyName?.text ?? specifier.name.text;
						if (imported !== specifier.name.text) {
							exact = false;
						}
						const typeOnly =
							statement.importClause?.isTypeOnly === true ||
							specifier.isTypeOnly;
						actual.add(`${typeOnly ? "type" : "value"}:${imported}`);
					}
				}
				if (
					!exact ||
					expected === undefined ||
					!sameArray([...actual].sort(), [...expected].sort())
				) {
					failures.push(
						`${normalizedPath} must import exactly its audited plainWorkspaceDelete helper surface`,
					);
				} else {
					seenInternalImports.set(
						normalizedPath,
						(seenInternalImports.get(normalizedPath) ?? 0) + 1,
					);
				}
			}
		}

		function visit(node) {
			if (
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node)
			) {
				if (
					(node.text === "@tauri-apps/api/core" ||
						node.text === internalModule) &&
					(!ts.isImportDeclaration(node.parent) ||
						node.parent.moduleSpecifier !== node)
				) {
					failures.push(
						`${normalizedPath} must not load the native bridge or delete authorization module dynamically`,
					);
				}
				const contract = WORKSPACE_DELETE_TS_COMMANDS.find(
					({ command }) => command === node.text,
				);
				if (contract !== undefined) {
					if (ts.isStringLiteral(node)) {
						commandOccurrences.get(contract.command).push(normalizedPath);
					}
					const call = node.parent;
					const isInvokeArgument =
						normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isCallExpression(call) &&
						call.arguments[0] === node &&
						ts.isIdentifier(call.expression) &&
						call.expression.text === "invoke" &&
						containingPropertyName(node) === contract.bridgeMethod;
					if (!isInvokeArgument) {
						failures.push(
							`${contract.command} must appear only as the direct invoke command of native ${contract.bridgeMethod}`,
						);
					}
				}
			}

			if (ts.isCallExpression(node)) {
				const callee = unwrapTypeScriptExpression(node.expression);
				if (ts.isIdentifier(callee) && callee.text === "invoke") {
					if (
						normalizedPath !== "app/platform/tauri/native.ts" ||
						node.arguments.length < 1 ||
						!ts.isStringLiteral(node.arguments[0])
					) {
						failures.push(
							`${normalizedPath} must call invoke only with a direct StringLiteral command in the native bridge`,
						);
					}
				} else if (
					(ts.isPropertyAccessExpression(callee) &&
						callee.name.text === "invoke") ||
					(ts.isElementAccessExpression(callee) &&
						evaluateStaticTypeScriptString(callee.argumentExpression) ===
							"invoke")
				) {
					failures.push(
						`${normalizedPath} must not access invoke through a namespace or computed property`,
					);
				}
				if (
					ts.isPropertyAccessExpression(callee) &&
					callee.expression.getText(sourceFile) === "Reflect" &&
					(callee.name.text === "get" || callee.name.text === "apply") &&
					node.arguments[0] !== undefined &&
					isKnownBridge(node.arguments[0])
				) {
					failures.push(
						`${normalizedPath} must not consume delete bridge methods through Reflect`,
					);
				}
			}

			if (ts.isIdentifier(node) && node.text === "invoke") {
				const parent = node.parent;
				const isDirectImport =
					normalizedPath === "app/platform/tauri/native.ts" &&
					ts.isImportSpecifier(parent) &&
					parent.name === node &&
					parent.propertyName === undefined;
				const isDirectCall =
					normalizedPath === "app/platform/tauri/native.ts" &&
					ts.isCallExpression(parent) &&
					parent.expression === node &&
					parent.arguments[0] !== undefined &&
					ts.isStringLiteral(parent.arguments[0]);
				if (!isDirectImport && !isDirectCall) {
					failures.push(
						`${normalizedPath} must not alias, re-export or indirectly reference invoke`,
					);
				}
			}

			if (ts.isElementAccessExpression(node)) {
				const property = evaluateStaticTypeScriptString(
					node.argumentExpression,
				);
				if (bridgeMethods.has(property) || isKnownBridge(node.expression)) {
					failures.push(
						`${normalizedPath} must not consume delete bridge methods through computed access`,
					);
				}
			}

			let referencedMethod;
			if (ts.isIdentifier(node) && bridgeMethods.has(node.text)) {
				referencedMethod = node.text;
			} else if (
				(ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
				bridgeMethods.has(node.text)
			) {
				referencedMethod = node.text;
			}
			if (referencedMethod !== undefined) {
				const parent = node.parent;
				const isAllowedDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				if (isAllowedDeclaration) {
					const key = `${normalizedPath}:${referencedMethod}`;
					declarationCounts.set(key, declarationCounts.get(key) + 1);
				} else {
					const propertyAccess = ts.isIdentifier(node)
						? node.parent
						: undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const routeKey = `${normalizedPath}:${referencedMethod}`;
					if (directCall === undefined || !expectedBridgeRoutes.has(routeKey)) {
						failures.push(
							`${normalizedPath} must not consume ${referencedMethod} outside its single audited coordinator/provider route`,
						);
					} else {
						bridgeRouteCounts.set(
							routeKey,
							(bridgeRouteCounts.get(routeKey) ?? 0) + 1,
						);
						const actualArguments = directCall.arguments.map((argument) =>
							argument.getText(sourceFile).replaceAll(/\s+/g, ""),
						);
						const expectedArguments = expectedBridgeArguments.get(routeKey);
						if (
							expectedArguments === undefined ||
							!sameArray(actualArguments, expectedArguments)
						) {
							failures.push(
								`${routeKey} must use its exact snapshotted delete arguments`,
							);
						}
					}
				}
			}

			if (ts.isIdentifier(node) && internalValueConsumers.has(node.text)) {
				const isImportBinding =
					ts.isImportSpecifier(node.parent) && node.parent.name === node;
				if (!isImportBinding) {
					const consumer = internalValueConsumers.get(node.text);
					const isDirectCall =
						ts.isCallExpression(node.parent) && node.parent.expression === node;
					if (
						!isDirectCall ||
						normalizedPath !== consumer.path ||
						containingFunctionName(node) !== consumer.functionName
					) {
						failures.push(
							`${node.text} must be consumed only by its fixed confirmed-delete function`,
						);
					} else {
						internalConsumerCounts.set(
							node.text,
							internalConsumerCounts.get(node.text) + 1,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const { command } of WORKSPACE_DELETE_TS_COMMANDS) {
		if (commandOccurrences.get(command).length !== 1) {
			failures.push(
				`${command} must have exactly one production TypeScript invoke route`,
			);
		}
	}
	if (exactInvokeImportCount !== 1) {
		failures.push(
			"app/platform/tauri/native.ts must contain exactly one direct invoke import",
		);
	}
	for (const [declaration, count] of declarationCounts) {
		if (count !== 1) {
			failures.push(
				`${declaration} must have exactly one audited delete bridge declaration`,
			);
		}
	}
	for (const [route, count] of expectedBridgeRoutes) {
		if (bridgeRouteCounts.get(route) !== count) {
			failures.push(
				`${route} must have exactly ${count} audited direct delete bridge call sites`,
			);
		}
	}
	for (const [relativePath, count] of seenInternalImports) {
		if (count !== 1) {
			failures.push(
				`${relativePath} must have exactly one audited plainWorkspaceDelete import`,
			);
		}
	}
	for (const [name, consumer] of internalValueConsumers) {
		if (internalConsumerCounts.get(name) !== consumer.count) {
			failures.push(
				`${name} must have exactly ${consumer.count} audited direct consumers`,
			);
		}
	}

	const coordinatorSource = normalizedSources.get(coordinatorPath);
	if (coordinatorSource !== undefined) {
		failures.push(
			...validateWorkspaceDeleteCoordinatorRoute(coordinatorSource),
		);
	}
	const providerSource = normalizedSources.get(providerPath);
	if (providerSource !== undefined) {
		failures.push(...validateWorkspaceDeleteProviderRoute(providerSource));
	}
	return [...new Set(failures)];
}

function validateWorkspaceDeleteCoordinatorRoute(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"app/features/workspace/delete-coordinator.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["delete-coordinator.ts must remain valid TypeScript"];
	}
	const normalized = (node) => node?.getText(sourceFile).replaceAll(/\s+/g, "");
	const expectedImports = new Map([
		[
			"@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService",
			new Set(["value:ResourceFileEdit"]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
			new Set(["type:IDisposable"]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			new Set([
				"value:authorizePlainWorkspaceDeleteResourceEdit",
				"value:getPlainWorkspaceDeleteState",
				"value:registerPlainWorkspaceDeleteCoordinator",
				"type:PlainWorkspaceDeleteAuthorization",
				"type:PlainWorkspaceDeleteCoordinatorContext",
			]),
		],
		[
			"../../platform/tauri",
			new Set([
				"type:PlainBridge",
				"type:WorkspaceDeleteBatchPlan",
				"type:WorkspaceDeleteResult",
			]),
		],
		[
			"./file-system-provider",
			new Set([
				"type:PlainWorkspaceDeleteProvider",
				"type:PlainWorkspaceDeleteResource",
			]),
		],
	]);
	const seenImports = new Set();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) {
			continue;
		}
		const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
			? statement.moduleSpecifier.text
			: undefined;
		const expected =
			moduleName === undefined ? undefined : expectedImports.get(moduleName);
		const bindings = statement.importClause?.namedBindings;
		const actual = new Set();
		let exact =
			expected !== undefined &&
			moduleName !== undefined &&
			!seenImports.has(moduleName) &&
			statement.importClause?.name === undefined &&
			bindings !== undefined &&
			ts.isNamedImports(bindings);
		if (exact && bindings !== undefined && ts.isNamedImports(bindings)) {
			for (const specifier of bindings.elements) {
				const imported = specifier.propertyName?.text ?? specifier.name.text;
				if (imported !== specifier.name.text) {
					exact = false;
				}
				const typeOnly =
					statement.importClause?.isTypeOnly === true || specifier.isTypeOnly;
				actual.add(`${typeOnly ? "type" : "value"}:${imported}`);
			}
		}
		if (
			!exact ||
			expected === undefined ||
			!sameArray([...actual].sort(), [...expected].sort())
		) {
			failures.push(
				"delete-coordinator.ts imports must match the exact audited type/value surface",
			);
		}
		if (moduleName !== undefined) {
			seenImports.add(moduleName);
		}
	}
	if (seenImports.size !== expectedImports.size) {
		failures.push(
			"delete-coordinator.ts imports must match the exact audited type/value surface",
		);
	}

	const expectedTopLevel = new Map([
		["MAX_DELETE_ENTRIES", { kind: "variable", exported: false }],
		["deleteFailureDetails", { kind: "variable", exported: false }],
		["WorkspaceDeleteIncompleteError", { kind: "class", exported: true }],
		[
			"getWorkspaceDeleteIncompleteDetails",
			{ kind: "function", exported: true },
		],
		["DeleteSelectionEntry", { kind: "interface", exported: false }],
		["snapshotSelection", { kind: "function", exported: false }],
		["confirmationDetail", { kind: "function", exported: false }],
		["createAuthorizedEdits", { kind: "function", exported: false }],
		["classifyAuthorizationResults", { kind: "function", exported: false }],
		["runDelete", { kind: "function", exported: false, async: true }],
		[
			"registerWorkspaceDeleteCoordinator",
			{ kind: "function", exported: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isClassDeclaration(statement)) {
			name = statement.name;
			kind = "class";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"delete-coordinator.ts must retain its exact module-private coordinator surface",
		);
	}

	function exactFunctionBody(name, expectedBody, failure) {
		const functions = sourceFile.statements.filter(
			(statement) =>
				ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		);
		if (
			functions.length !== 1 ||
			normalized(functions[0].body) !== expectedBody.replaceAll(/\s+/g, "")
		) {
			failures.push(failure);
		}
		return functions.length === 1 ? functions[0] : undefined;
	}

	exactFunctionBody(
		"snapshotSelection",
		`{
			try {
				if (
					!Array.isArray(context.elements) ||
					context.elements.length < 1 ||
					context.elements.length > MAX_DELETE_ENTRIES
				) {
					throw new Error("Invalid Plain delete selection.");
				}
				const entries = context.elements.map((element) => {
					const resource = element.resource;
					const name = element.name;
					if (typeof name !== "string" || name.length < 1 || name.length > 1024) {
						throw new Error("Invalid Plain delete selection.");
					}
					return Object.freeze({
						resource: provider.plainSnapshotDeleteResource(resource),
						name,
					});
				});
				return Object.freeze(entries);
			} catch {
				throw new Error("The permanent delete selection is invalid.");
			}
		}`,
		"delete coordinator must synchronously snapshot one bounded distinct selection",
	);
	exactFunctionBody(
		"createAuthorizedEdits",
		`{
			if (plan.entries.length !== selection.length) {
				throw new Error("The permanent delete plan is invalid.");
			}
			const authorizations: PlainWorkspaceDeleteAuthorization[] = [];
			const edits = plan.entries.map((entry, index) => {
				const selected = selection[index];
				if (selected === undefined) {
					throw new Error("The permanent delete plan is invalid.");
				}
				const options = {
					recursive: true,
					folder: entry.kind === "directory",
					ignoreIfNotExists: false,
					skipTrashBin: true,
				};
				const authorization = authorizePlainWorkspaceDeleteResourceEdit(
					options,
					selected.resource.resource,
					{
						confirmationId: plan.confirmationId,
						entryId: entry.entryId,
						rootId: selected.resource.rootId,
						relativePath: selected.resource.relativePath,
						recursive: true,
						kind: entry.kind,
						permanent: true,
					},
				);
				authorizations.push(authorization);
				return new ResourceFileEdit(selected.resource.resource, undefined, options);
			});
			return Object.freeze({
				edits: Object.freeze(edits),
				authorizations: Object.freeze(authorizations),
			});
		}`,
		"delete coordinator must bind one permanent recursive authorization to each ResourceFileEdit",
	);
	exactFunctionBody(
		"classifyAuthorizationResults",
		`{
			let deletedEntries = 0;
			let pendingEntries = 0;
			let ordinaryFailures = 0;
			let outcomeUnknown = false;
			let incompleteResult: WorkspaceDeleteResult | undefined;
			for (const authorization of authorizations) {
				const result = getPlainWorkspaceDeleteState(authorization);
				if (result.status === "pending" || result.status === "inFlight") {
					pendingEntries += 1;
				} else if (result.status === "deleted") {
					deletedEntries += 1;
				} else if (result.status === "ordinaryFailure") {
					ordinaryFailures += 1;
				} else if (result.status === "outcomeUnknown") {
					outcomeUnknown = true;
				} else if (incompleteResult === undefined) {
					incompleteResult = result;
				}
			}
			return Object.freeze({
				deletedEntries,
				pendingEntries,
				ordinaryFailures,
				outcomeUnknown,
				...(incompleteResult === undefined ? {} : { incompleteResult }),
			});
		}`,
		"delete coordinator must classify every authorization terminal typestate without guessing success",
	);
	exactFunctionBody(
		"registerWorkspaceDeleteCoordinator",
		`{
			return registerPlainWorkspaceDeleteCoordinator((context) =>
				runDelete(bridge, provider, context),
			);
		}`,
		"delete coordinator registration must directly close over one bridge and provider",
	);

	const runFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "runDelete",
	);
	if (runFunctions.length !== 1 || runFunctions[0].body === undefined) {
		failures.push(
			"delete coordinator must define exactly one audited async runDelete route",
		);
		return [...new Set(failures)];
	}
	const runDelete = runFunctions[0];
	const runBody = normalized(runDelete.body) ?? "";
	const callPositions = new Map();
	function recordCall(name, node) {
		const positions = callPositions.get(name) ?? [];
		positions.push(node.getStart(sourceFile));
		callPositions.set(name, positions);
	}
	function visitRun(node) {
		if (ts.isCallExpression(node)) {
			const callee = node.expression.getText(sourceFile).replaceAll(/\s+/g, "");
			for (const name of [
				"snapshotSelection",
				"bridge.workspacePrepareDelete",
				"context.dialogService.confirm",
				"bridge.workspaceBeginDelete",
				"createAuthorizedEdits",
				"context.explorerService.applyBulkEdit",
				"classifyAuthorizationResults",
				"provider.plainRefreshDeleteRoots",
				"bridge.workspaceCancelDelete",
			]) {
				if (callee === name) {
					recordCall(name, node);
				}
			}
		}
		ts.forEachChild(node, visitRun);
	}
	visitRun(runDelete.body);
	const expectedCallCounts = new Map([
		["snapshotSelection", 1],
		["bridge.workspacePrepareDelete", 1],
		["context.dialogService.confirm", 1],
		["bridge.workspaceBeginDelete", 1],
		["createAuthorizedEdits", 1],
		["context.explorerService.applyBulkEdit", 1],
		["classifyAuthorizationResults", 2],
		["provider.plainRefreshDeleteRoots", 1],
		["bridge.workspaceCancelDelete", 1],
	]);
	for (const [name, count] of expectedCallCounts) {
		if ((callPositions.get(name)?.length ?? 0) !== count) {
			failures.push(
				`runDelete must call ${name} exactly ${count} times in the audited route`,
			);
		}
	}
	const orderedNames = [
		"snapshotSelection",
		"bridge.workspacePrepareDelete",
		"context.dialogService.confirm",
		"bridge.workspaceBeginDelete",
		"createAuthorizedEdits",
		"context.explorerService.applyBulkEdit",
	];
	const orderedPositions = orderedNames.map(
		(name) => callPositions.get(name)?.[0],
	);
	if (
		orderedPositions.some((position) => position === undefined) ||
		orderedPositions.some(
			(position, index) => index > 0 && position <= orderedPositions[index - 1],
		)
	) {
		failures.push(
			"runDelete must prepare, confirm once, begin, authorize and apply in that strict order",
		);
	}
	const topLevelTry = runDelete.body.statements.filter((statement) =>
		ts.isTryStatement(statement),
	);
	const tryStatement = topLevelTry.length === 1 ? topLevelTry[0] : undefined;
	const expectedCatch = `{
		if (beginAttempted) {
			provider.plainRefreshDeleteRoots(
				selection.map(({ resource }) => resource.resource),
			);
		}
		const results = classifyAuthorizationResults(authorizations);
		if (
			!(error instanceof WorkspaceDeleteIncompleteError) &&
			(results.incompleteResult !== undefined ||
				results.outcomeUnknown ||
				results.deletedEntries > 0)
		) {
			throw new WorkspaceDeleteIncompleteError(
				results.deletedEntries,
				results.incompleteResult,
			);
		}
		throw error;
	}`.replaceAll(/\s+/g, "");
	const expectedFinally = `{
		if (!completed) {
			try {
				await bridge.workspaceCancelDelete(plan.confirmationId);
			} catch {}
		}
	}`.replaceAll(/\s+/g, "");
	if (
		tryStatement === undefined ||
		tryStatement.catchClause?.variableDeclaration === undefined ||
		!ts.isIdentifier(tryStatement.catchClause.variableDeclaration.name) ||
		tryStatement.catchClause.variableDeclaration.name.text !== "error" ||
		normalized(tryStatement.catchClause.block) !== expectedCatch ||
		normalized(tryStatement.finallyBlock) !== expectedFinally
	) {
		failures.push(
			"runDelete must rescan after begun failures and cancel every uncompleted confirmation in finally",
		);
	}
	for (const required of [
		"constplan=awaitbridge.workspacePrepareDelete(requests);letbeginAttempted=false;letcompleted=false;letauthorizations:readonlyPlainWorkspaceDeleteAuthorization[]= [];".replace(
			"= [];",
			"=[];",
		),
		"constconfirmed=response.confirmed;if(confirmed!==true){return;}beginAttempted=true;awaitbridge.workspaceBeginDelete(plan.confirmationId);",
		"constauthorized=createAuthorizedEdits(selection,plan);authorizations=authorized.authorizations;awaitcontext.explorerService.applyBulkEdit(authorized.edits,",
		"results.incompleteResult!==undefined||results.outcomeUnknown||results.ordinaryFailures!==0||results.pendingEntries!==0||results.deletedEntries!==selection.length",
		"completed=true;",
	]) {
		if (!runBody.includes(required)) {
			failures.push(
				"runDelete must retain strict confirmation, begin and terminal-success sequencing",
			);
			break;
		}
	}
	if (
		runDelete.modifiers?.length !== 1 ||
		runDelete.modifiers[0].kind !== ts.SyntaxKind.AsyncKeyword ||
		runDelete.parameters.length !== 3 ||
		!sameArray(
			runDelete.parameters.map((parameter) =>
				ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
			),
			["bridge", "provider", "context"],
		) ||
		runDelete.type === undefined ||
		!ts.isTypeReferenceNode(runDelete.type) ||
		!ts.isIdentifier(runDelete.type.typeName) ||
		runDelete.type.typeName.text !== "Promise" ||
		runDelete.type.typeArguments?.[0]?.kind !== ts.SyntaxKind.VoidKeyword
	) {
		failures.push(
			"delete coordinator must define exactly one audited async runDelete route",
		);
	}
	return [...new Set(failures)];
}

function validateWorkspaceDeleteProviderRoute(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"app/features/workspace/file-system-provider.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["file-system-provider.ts must remain valid TypeScript"];
	}
	const normalized = (node) => node?.getText(sourceFile).replaceAll(/\s+/g, "");
	const providers = sourceFile.statements.filter(
		(statement) =>
			ts.isClassDeclaration(statement) &&
			statement.name?.text === "PlainWorkspaceFileSystemProvider",
	);
	if (providers.length !== 1) {
		return [
			"confirmed delete requires exactly one PlainWorkspaceFileSystemProvider",
		];
	}
	const provider = providers[0];
	const methodsByName = (name) =>
		provider.members.filter(
			(member) =>
				ts.isMethodDeclaration(member) && typeScriptMemberName(member) === name,
		);
	if (!hasFinalWorkspaceProviderCapabilityContract(provider, sourceFile)) {
		failures.push(
			"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
		);
	}

	const deleteMethods = methodsByName("delete");
	const expectedDeleteBody = `{
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(_resource);
		let authorization;
		try {
			authorization = takePlainWorkspaceDeleteProviderAuthorization(
				_options,
				resolved.resource,
			);
		} catch {
			throw noPermissions();
		}
		if (authorization === undefined) {
			throw noPermissions();
		}
		const authorizationSnapshot =
			getPlainWorkspaceDeleteAuthorizationSnapshot(authorization);
		if (
			authorizationSnapshot.rootId !== resolved.rootId ||
			authorizationSnapshot.relativePath !== resolved.relativePath ||
			authorizationSnapshot.recursive !== true ||
			authorizationSnapshot.permanent !== true
		) {
			throw noPermissions();
		}
		beginPlainWorkspaceDeleteProviderDispatch(authorization);

		let result: WorkspaceDeleteResult;
		try {
			result = decodeWorkspaceDeleteResult(
				await this.#bridge.workspaceCommitDeleteEntry(
					authorizationSnapshot.confirmationId,
					authorizationSnapshot.entryId,
					authorizationSnapshot.rootId,
					authorizationSnapshot.relativePath,
					authorizationSnapshot.recursive,
				),
			);
		} catch (error) {
			const failure = mapDeleteError(error);
			completePlainWorkspaceDeleteProviderFailure(
				authorization,
				failure.outcome,
			);
			if (failure.rescan) {
				this.fireRootUpdated(resolved.resource);
			}
			throw failure.error;
		}
		try {
			completePlainWorkspaceDeleteProviderResult(authorization, result);
		} catch {
			completePlainWorkspaceDeleteProviderFailure(
				authorization,
				"outcomeUnknown",
			);
			this.fireRootUpdated(resolved.resource);
			throw unavailable();
		}
		if (result.status !== "deleted") {
			this.fireRootUpdated(resolved.resource);
			throw unavailable();
		}
		this.fireDeleted(resolved.resource);
	}`.replaceAll(/\s+/g, "");
	if (deleteMethods.length !== 1) {
		failures.push(
			"provider must expose exactly one call-authorized permanent delete adapter",
		);
	} else {
		const method = deleteMethods[0];
		const [resource, options] = method.parameters;
		const hasType = (parameter, name) =>
			parameter?.type !== undefined &&
			ts.isTypeReferenceNode(parameter.type) &&
			ts.isIdentifier(parameter.type.typeName) &&
			parameter.type.typeName.text === name;
		if (
			method.modifiers?.length !== 1 ||
			method.modifiers[0].kind !== ts.SyntaxKind.AsyncKeyword ||
			method.parameters.length !== 2 ||
			!ts.isIdentifier(resource?.name) ||
			resource.name.text !== "_resource" ||
			!hasType(resource, "URI") ||
			!ts.isIdentifier(options?.name) ||
			options.name.text !== "_options" ||
			!hasType(options, "IFileDeleteOptions") ||
			method.type === undefined ||
			!ts.isTypeReferenceNode(method.type) ||
			!ts.isIdentifier(method.type.typeName) ||
			method.type.typeName.text !== "Promise" ||
			method.type.typeArguments?.[0]?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalized(method.body) !== expectedDeleteBody
		) {
			failures.push(
				"provider delete must consume one authorization through prepared/inFlight/terminal typestate and dispatch exactly one permanent commit",
			);
		}
	}

	const mapDeleteFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "mapDeleteError",
	);
	const expectedMapDeleteBody = `{
		const code = copyMoveCommandErrorCode(error);
		switch (code) {
			case "ROOT_NOT_AUTHORIZED":
				return Object.freeze({
					error: noPermissions(),
					rescan: false,
					outcome: "ordinaryFailure",
				});
			case "WORKSPACE_DELETE_PLAN_INVALID":
			case "ROOT_UNAVAILABLE":
			case "WORKSPACE_WINDOW_CLOSED":
			case "ENTRY_TYPE_MISMATCH":
			case "INVALID_RELATIVE_PATH":
			case "WORKSPACE_CONFLICT":
				return Object.freeze({
					error: unavailable(),
					rescan: false,
					outcome: "ordinaryFailure",
				});
			default:
				return Object.freeze({
					error: unavailable(),
					rescan: true,
					outcome: "outcomeUnknown",
				});
		}
	}`.replaceAll(/\s+/g, "");
	if (
		mapDeleteFunctions.length !== 1 ||
		normalized(mapDeleteFunctions[0].body) !== expectedMapDeleteBody
	) {
		failures.push(
			"mapDeleteError must distinguish authenticated ordinary failure from rescan-required unknown outcome",
		);
	}

	const exactMethodBodies = new Map([
		[
			"plainSnapshotDeleteResource",
			`{
				this.requireMutationDispatchAllowed();
				return this.resolveMutationResource(resource);
			}`,
		],
		[
			"plainRefreshDeleteRoots",
			`{
				this.requireMutationDispatchAllowed();
				const roots = new Map<string, URI>();
				for (const resource of resources) {
					const resolved = this.resolveMutationResource(resource);
					if (!roots.has(resolved.rootId)) {
						roots.set(
							resolved.rootId,
							resolved.resource.with({
								path: "/",
								query: null,
								fragment: null,
							}),
						);
					}
				}
				const changes = [...roots.values()].map((resource) => {
					resource.toString();
					void resource.fsPath;
					Object.freeze(resource);
					return Object.freeze({ type: FileChangeType.UPDATED, resource });
				});
				if (changes.length > 0) {
					this.changeEmitter.fire(Object.freeze(changes));
				}
			}`,
		],
		[
			"fireDeleted",
			`{
				this.changeEmitter.fire(
					Object.freeze([
						Object.freeze({
							type: FileChangeType.DELETED,
							resource,
						}),
					]),
				);
			}`,
		],
	]);
	for (const [name, body] of exactMethodBodies) {
		const methods = methodsByName(name);
		if (
			methods.length !== 1 ||
			normalized(methods[0].body) !== body.replaceAll(/\s+/g, "")
		) {
			failures.push(
				`${name} must retain its exact snapshotted root/event delete role`,
			);
		}
	}
	return [...new Set(failures)];
}

export function validateWorkspaceProviderCopyBoundary(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"file-system-provider.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const expectedProviderImports = new Map([
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			new Set([
				"value:FileChangeType",
				"value:FileOperationError",
				"value:FileOperationResult",
				"value:FilePermission",
				"value:FileSystemProviderCapabilities",
				"value:FileSystemProviderError",
				"value:FileSystemProviderErrorCode",
				"value:FileType",
				"type:IFileChange",
				"type:IFileDeleteOptions",
				"type:IFileOverwriteOptions",
				"type:IFileSystemProviderWithFileReadWriteCapability",
				"type:IFileWriteOptions",
				"type:IStat",
				"type:IWatchOptions",
			]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/base/common/event",
			new Set(["value:Emitter", "value:Event"]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle",
			new Set(["type:IDisposable"]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/base/common/uri",
			new Set(["value:URI"]),
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			new Set([
				"value:beginPlainWorkspaceDeleteProviderDispatch",
				"value:completePlainWorkspaceDeleteProviderFailure",
				"value:completePlainWorkspaceDeleteProviderResult",
				"value:getPlainWorkspaceDeleteAuthorizationSnapshot",
				"value:takePlainWorkspaceDeleteProviderAuthorization",
			]),
		],
		[
			"../../platform/tauri",
			new Set([
				"type:PlainBridge",
				"type:WorkspaceCapabilities",
				"type:WorkspaceDeleteResult",
				"type:WorkspaceEntryKind",
				"type:WorkspaceEntryStat",
				"type:WorkspaceWriteResult",
			]),
		],
		[
			"../../platform/tauri/workspace-codec",
			new Set([
				"value:decodeWorkspaceCapabilities",
				"value:decodeWorkspaceDeleteResult",
				"value:decodeWorkspaceEntryStat",
				"value:decodeWorkspaceMoveResult",
				"value:frozenWorkspaceEntryRequest",
			]),
		],
	]);
	const seenProviderImports = new Set();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement)) {
			continue;
		}
		const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
			? statement.moduleSpecifier.text
			: undefined;
		const expected =
			moduleName === undefined
				? undefined
				: expectedProviderImports.get(moduleName);
		const clause = statement.importClause;
		const actual = new Set();
		let importShapeIsExact =
			expected !== undefined &&
			moduleName !== undefined &&
			!seenProviderImports.has(moduleName) &&
			clause !== undefined &&
			clause.name === undefined &&
			clause.namedBindings !== undefined &&
			ts.isNamedImports(clause.namedBindings);
		if (
			importShapeIsExact &&
			clause !== undefined &&
			clause.namedBindings !== undefined &&
			ts.isNamedImports(clause.namedBindings)
		) {
			for (const specifier of clause.namedBindings.elements) {
				const importedName =
					specifier.propertyName?.text ?? specifier.name.text;
				if (importedName !== specifier.name.text) {
					importShapeIsExact = false;
				}
				const effectiveTypeOnly = clause.isTypeOnly || specifier.isTypeOnly;
				actual.add(`${effectiveTypeOnly ? "type" : "value"}:${importedName}`);
			}
		}
		if (
			!importShapeIsExact ||
			expected === undefined ||
			!sameArray([...actual].sort(), [...expected].sort())
		) {
			failures.push(
				"file-system-provider.ts imports must match the exact audited module, name and type-only surface",
			);
		}
		if (moduleName !== undefined) {
			seenProviderImports.add(moduleName);
		}
	}
	if (seenProviderImports.size !== expectedProviderImports.size) {
		failures.push(
			"file-system-provider.ts imports must match the exact audited module, name and type-only surface",
		);
	}
	const allowedTopLevelDeclarations = new Map([
		["PLAIN_WORKSPACE_SCHEME", { kind: "variable", exported: true }],
		[
			"MAX_TRACKED_OPEN_RESOURCES_PER_ROOT",
			{ kind: "variable", exported: false },
		],
		["ResolvedResource", { kind: "interface", exported: false }],
		["ResolvedMutationResource", { kind: "interface", exported: false }],
		["PlainWorkspaceDeleteResource", { kind: "interface", exported: true }],
		["PlainWorkspaceDeleteProvider", { kind: "interface", exported: true }],
		["PlainWorkspaceProviderStat", { kind: "interface", exported: true }],
		["PlainWorkspaceReadFileResult", { kind: "interface", exported: true }],
		["PlainWorkspaceWriteFileResult", { kind: "type", exported: true }],
		["SANITIZED_MESSAGES", { kind: "variable", exported: false }],
		["fileSystemError", { kind: "function", exported: false }],
		["noPermissions", { kind: "function", exported: false }],
		[
			"createPlainWorkspaceMutationPolicy",
			{ kind: "function", exported: false },
		],
		["unavailable", { kind: "function", exported: false }],
		["commandErrorCode", { kind: "function", exported: false }],
		["mapReadError", { kind: "function", exported: false }],
		["mapWriteError", { kind: "function", exported: false }],
		["mapCreateError", { kind: "function", exported: false }],
		["requireNoOverwriteOptions", { kind: "function", exported: false }],
		["copyMoveCommandErrorCode", { kind: "function", exported: false }],
		["mapCopyMoveError", { kind: "function", exported: false }],
		["mapDeleteError", { kind: "function", exported: false }],
		["requireVoidMutationReceipt", { kind: "function", exported: false }],
		["WorkspaceMoveIncompleteError", { kind: "class", exported: false }],
		["workspaceMoveIncomplete", { kind: "function", exported: false }],
		["WorkspaceMoveOutcomeUnknownError", { kind: "class", exported: false }],
		["workspaceMoveOutcomeUnknown", { kind: "function", exported: false }],
		["kindToFileType", { kind: "function", exported: false }],
		["providerStat", { kind: "function", exported: false }],
		["createdProviderStat", { kind: "function", exported: false }],
		["PlainWorkspaceFileSystemProvider", { kind: "class", exported: false }],
		[
			"createPlainWorkspaceFileSystemProvider",
			{ kind: "function", exported: true },
		],
	]);
	const topLevelDeclarationCounts = new Map(
		[...allowedTopLevelDeclarations].map(([name]) => [name, 0]),
	);
	let topLevelSurfaceIsExact = true;
	function recordTopLevelDeclaration(name, kind, statement) {
		const expected = ts.isIdentifier(name)
			? allowedTopLevelDeclarations.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifierKinds = expected?.exported
			? [ts.SyntaxKind.ExportKeyword]
			: [];
		if (
			!ts.isIdentifier(name) ||
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifierKinds)
		) {
			topLevelSurfaceIsExact = false;
			return;
		}
		topLevelDeclarationCounts.set(
			name.text,
			(topLevelDeclarationCounts.get(name.text) ?? 0) + 1,
		);
	}
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				recordTopLevelDeclaration(declaration.name, "variable", statement);
			}
		} else if (ts.isFunctionDeclaration(statement)) {
			recordTopLevelDeclaration(statement.name, "function", statement);
		} else if (ts.isInterfaceDeclaration(statement)) {
			recordTopLevelDeclaration(statement.name, "interface", statement);
		} else if (ts.isTypeAliasDeclaration(statement)) {
			recordTopLevelDeclaration(statement.name, "type", statement);
		} else if (ts.isClassDeclaration(statement)) {
			recordTopLevelDeclaration(statement.name, "class", statement);
		} else if (isFinalWorkspaceProviderPrototypeFreeze(statement, sourceFile)) {
			continue;
		} else {
			topLevelSurfaceIsExact = false;
		}
	}
	if (
		!topLevelSurfaceIsExact ||
		[...topLevelDeclarationCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
		);
	}
	let decoderImportCount = 0;
	let deleteDecoderImportCount = 0;
	let entryStatDecoderImportCount = 0;
	let moveDecoderImportCount = 0;
	let frozenRequestImportCount = 0;
	for (const statement of sourceFile.statements) {
		if (
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text ===
				"../../platform/tauri/workspace-codec" &&
			statement.importClause?.isTypeOnly !== true &&
			ts.isNamedImports(statement.importClause?.namedBindings)
		) {
			for (const specifier of statement.importClause.namedBindings.elements) {
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						"decodeWorkspaceDeleteResult" &&
					specifier.name.text === "decodeWorkspaceDeleteResult"
				) {
					deleteDecoderImportCount += 1;
				}
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						"decodeWorkspaceMoveResult" &&
					specifier.name.text === "decodeWorkspaceMoveResult"
				) {
					moveDecoderImportCount += 1;
				}
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						"decodeWorkspaceCapabilities" &&
					specifier.name.text === "decodeWorkspaceCapabilities"
				) {
					decoderImportCount += 1;
				}
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						"decodeWorkspaceEntryStat" &&
					specifier.name.text === "decodeWorkspaceEntryStat"
				) {
					entryStatDecoderImportCount += 1;
				}
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						"frozenWorkspaceEntryRequest" &&
					specifier.name.text === "frozenWorkspaceEntryRequest"
				) {
					frozenRequestImportCount += 1;
				}
			}
		}
	}
	if (decoderImportCount !== 1) {
		failures.push(
			"file-system-provider.ts must import the strict workspace capability decoder exactly by name",
		);
	}
	if (deleteDecoderImportCount !== 1) {
		failures.push(
			"file-system-provider.ts must import the strict workspace delete decoder exactly by name",
		);
	}
	if (entryStatDecoderImportCount !== 1) {
		failures.push(
			"file-system-provider.ts must import the strict workspace entry stat decoder exactly by name",
		);
	}
	if (moveDecoderImportCount !== 1) {
		failures.push(
			"file-system-provider.ts must import the strict workspace move decoder exactly by name",
		);
	}
	if (frozenRequestImportCount !== 1) {
		failures.push(
			"file-system-provider.ts must import the frozen workspace request codec exactly by name",
		);
	}
	const exactProviderErrorDeclarations = new Map([
		[
			"SANITIZED_MESSAGES",
			`const SANITIZED_MESSAGES = Object.freeze({
				entryNotFound: "The workspace entry does not exist.",
				moveIncomplete:
					"The workspace move published its target but could not remove all of its source.",
				moveOutcomeUnknown:
					"The workspace move outcome is unknown. The source and target locations were refreshed; check both locations before continuing.",
				notDirectory: "The workspace entry is not a directory.",
				noPermissions: "The workspace entry cannot be accessed.",
				unavailable: "The workspace is unavailable.",
			});`,
		],
		[
			"fileSystemError",
			`function fileSystemError(
				code: FileSystemProviderErrorCode,
				message: string,
			): FileSystemProviderError {
				return FileSystemProviderError.create(message, code);
			}`,
		],
		[
			"noPermissions",
			`function noPermissions(): FileSystemProviderError {
				return fileSystemError(
					FileSystemProviderErrorCode.NoPermissions,
					SANITIZED_MESSAGES.noPermissions,
				);
			}`,
		],
		[
			"unavailable",
			`function unavailable(): FileSystemProviderError {
				return fileSystemError(
					FileSystemProviderErrorCode.Unavailable,
					SANITIZED_MESSAGES.unavailable,
				);
			}`,
		],
		[
			"commandErrorCode",
			`function commandErrorCode(error: unknown): string | undefined {
				try {
					if (typeof error !== "object" || error === null) {
						return undefined;
					}
					const code = Reflect.get(error, "code");
					return typeof code === "string" ? code : undefined;
				} catch {
					return undefined;
				}
			}`,
		],
		[
			"mapReadError",
			`function mapReadError(error: unknown): FileSystemProviderError {
				const code = commandErrorCode(error);
				switch (code) {
					case "ENTRY_NOT_FOUND":
						return fileSystemError(
							FileSystemProviderErrorCode.FileNotFound,
							SANITIZED_MESSAGES.entryNotFound,
						);
					case "ENTRY_TYPE_MISMATCH":
						return fileSystemError(
							FileSystemProviderErrorCode.FileNotADirectory,
							SANITIZED_MESSAGES.notDirectory,
						);
					case "ROOT_NOT_AUTHORIZED":
					case "INVALID_RELATIVE_PATH":
					case "PATH_OUTSIDE_ROOT":
					case "PERMISSION_DENIED":
						return noPermissions();
					case "ROOT_UNAVAILABLE":
					case "PATH_ENCODING_UNSUPPORTED":
					case "WORKSPACE_CONFLICT":
					case "WORKSPACE_FILE_CHANGED":
					case "WORKSPACE_WINDOW_CLOSED":
					case "DIRECTORY_TOO_LARGE":
					case "FILE_TOO_LARGE":
					case "IO_FAILED":
						return unavailable();
					default:
						return unavailable();
				}
			}`,
		],
		[
			"mapWriteError",
			`function mapWriteError(error: unknown): Error {
				const code = commandErrorCode(error);
				switch (code) {
					case "WORKSPACE_FILE_MODIFIED":
						return new FileOperationError(
							"The workspace file changed before it could be written.",
							FileOperationResult.FILE_MODIFIED_SINCE,
						);
					case "ROOT_NOT_AUTHORIZED":
					case "PERMISSION_DENIED":
						return noPermissions();
					case "FILE_TOO_LARGE":
						return fileSystemError(
							FileSystemProviderErrorCode.FileTooLarge,
							"The workspace file exceeds the supported write limit.",
						);
					default:
						return unavailable();
				}
			}`,
		],
	]);
	for (const [name, expectedSource] of exactProviderErrorDeclarations) {
		const statements = sourceFile.statements.filter((statement) => {
			if (ts.isFunctionDeclaration(statement)) {
				return statement.name?.text === name;
			}
			return (
				ts.isVariableStatement(statement) &&
				statement.declarationList.declarations.some(
					(declaration) =>
						ts.isIdentifier(declaration.name) && declaration.name.text === name,
				)
			);
		});
		if (
			statements.length !== 1 ||
			statements[0].getText(sourceFile).replaceAll(/\s+/g, "") !==
				expectedSource.replaceAll(/\s+/g, "")
		) {
			failures.push(
				`${name} must retain its exact module-private sanitized error contract`,
			);
		}
	}
	const createdStatFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "createdProviderStat",
	);
	if (createdStatFunctions.length !== 1) {
		failures.push(
			"file-system-provider.ts must define exactly one strict createdProviderStat decoder",
		);
	} else {
		const [createdStat] = createdStatFunctions;
		const normalizedBody = createdStat.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			const stat = decodeWorkspaceEntryStat(value);
			if (
				stat.kind !== expectedKind ||
				stat.size !== 0 ||
				stat.mtime !== 0 ||
				stat.ctime !== 0 ||
				stat.version !== null
			) {
				throw unavailable();
			}
			return Object.freeze({
				type: expectedKind === "file" ? FileType.File : FileType.Directory,
				size: 0,
				mtime: 0,
				ctime: 0,
				...(expectedKind === "file"
					? { permissions: FilePermission.Readonly }
					: {}),
				plainVersion: null,
			});
		}`.replaceAll(/\s+/g, "");
		const [valueParameter, kindParameter] = createdStat.parameters;
		if (
			createdStat.parameters.length !== 2 ||
			!ts.isIdentifier(valueParameter?.name) ||
			valueParameter.name.text !== "value" ||
			valueParameter.type?.kind !== ts.SyntaxKind.UnknownKeyword ||
			!ts.isIdentifier(kindParameter?.name) ||
			kindParameter.name.text !== "expectedKind" ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"createdProviderStat must strictly decode exact zero/null file or directory receipts",
			);
		}
	}
	const mapCreateFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "mapCreateError",
	);
	if (mapCreateFunctions.length !== 1) {
		failures.push(
			"file-system-provider.ts must define exactly one sanitized mapCreateError helper",
		);
	} else {
		const [mapCreate] = mapCreateFunctions;
		const normalizedBody = mapCreate.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			let code: string | undefined;
			try {
				if (typeof error === "object" && error !== null) {
					const value = Reflect.get(error, "code");
					code = typeof value === "string" ? value : undefined;
				}
			} catch {
				code = undefined;
			}
			switch (code) {
				case "ENTRY_ALREADY_EXISTS":
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace entry already exists.",
							FileSystemProviderErrorCode.FileExists,
						),
						rescan: false,
					});
				case "ENTRY_NOT_FOUND":
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace entry does not exist.",
							FileSystemProviderErrorCode.FileNotFound,
						),
						rescan: false,
					});
				case "ENTRY_TYPE_MISMATCH":
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace entry is not a directory.",
							FileSystemProviderErrorCode.FileNotADirectory,
						),
						rescan: false,
					});
				case "ROOT_NOT_AUTHORIZED":
				case "INVALID_RELATIVE_PATH":
				case "PATH_OUTSIDE_ROOT":
				case "PERMISSION_DENIED":
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace entry cannot be accessed.",
							FileSystemProviderErrorCode.NoPermissions,
						),
						rescan: false,
					});
				case "ROOT_UNAVAILABLE":
				case "PATH_ENCODING_UNSUPPORTED":
				case "WORKSPACE_CONFLICT":
				case "WORKSPACE_WINDOW_CLOSED":
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace is unavailable.",
							FileSystemProviderErrorCode.Unavailable,
						),
						rescan: false,
					});
				default:
					return Object.freeze({
						error: FileSystemProviderError.create(
							"The workspace is unavailable.",
							FileSystemProviderErrorCode.Unavailable,
						),
						rescan: true,
					});
			}
		}`.replaceAll(/\s+/g, "");
		const [errorParameter] = mapCreate.parameters;
		const resultType =
			mapCreate.type !== undefined &&
			ts.isTypeReferenceNode(mapCreate.type) &&
			ts.isIdentifier(mapCreate.type.typeName) &&
			mapCreate.type.typeName.text === "Readonly" &&
			mapCreate.type.typeArguments?.length === 1 &&
			ts.isTypeLiteralNode(mapCreate.type.typeArguments[0])
				? mapCreate.type.typeArguments[0]
				: undefined;
		const resultMembers = resultType?.members ?? [];
		if (
			mapCreate.modifiers?.length ||
			mapCreate.parameters.length !== 1 ||
			!ts.isIdentifier(errorParameter?.name) ||
			errorParameter.name.text !== "error" ||
			errorParameter.type?.kind !== ts.SyntaxKind.UnknownKeyword ||
			resultMembers.length !== 2 ||
			!resultMembers.every((member) => ts.isPropertySignature(member)) ||
			!sameArray(
				resultMembers.map((member) => typeScriptMemberName(member)),
				["error", "rescan"],
			) ||
			!ts.isTypeReferenceNode(resultMembers[0].type) ||
			!ts.isIdentifier(resultMembers[0].type.typeName) ||
			resultMembers[0].type.typeName.text !== "FileSystemProviderError" ||
			resultMembers[1].type?.kind !== ts.SyntaxKind.BooleanKeyword ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"mapCreateError must own one exact sanitized code-to-provider-error mapping",
			);
		}
	}
	const exactCopyMoveDeclarations = new Map([
		[
			"requireNoOverwriteOptions",
			{
				kind: "function",
				failure:
					"requireNoOverwriteOptions must accept only one own-data enumerable overwrite false field",
				source: `function requireNoOverwriteOptions(options: IFileOverwriteOptions): void {
					try {
						if (typeof options !== "object" || options === null) {
							throw noPermissions();
						}
						const prototype = Object.getPrototypeOf(options);
						if (prototype !== Object.prototype && prototype !== null) {
							throw noPermissions();
						}
						const descriptors = Object.getOwnPropertyDescriptors(options);
						const keys = Reflect.ownKeys(descriptors);
						const overwrite = descriptors.overwrite;
						if (
							keys.length !== 1 ||
							keys[0] !== "overwrite" ||
							overwrite === undefined ||
							!("value" in overwrite) ||
							overwrite.enumerable !== true ||
							overwrite.value !== false
						) {
							throw noPermissions();
						}
						structuredClone(options);
					} catch {
						throw noPermissions();
					}
				}`,
			},
		],
		[
			"copyMoveCommandErrorCode",
			{
				kind: "function",
				failure:
					"copyMoveCommandErrorCode must authenticate one exact own-data code/message command error",
				source: `function copyMoveCommandErrorCode(error: unknown): string | undefined {
					try {
						if (typeof error !== "object" || error === null) {
							return undefined;
						}
						const prototype = Object.getPrototypeOf(error);
						if (prototype !== Object.prototype && prototype !== null) {
							return undefined;
						}
						const descriptors = Object.getOwnPropertyDescriptors(error);
						const keys = Reflect.ownKeys(descriptors);
						const code = descriptors.code;
						const message = descriptors.message;
						if (
							keys.length !== 2 ||
							!keys.includes("code") ||
							!keys.includes("message") ||
							code === undefined ||
							message === undefined ||
							!("value" in code) ||
							!("value" in message) ||
							code.enumerable !== true ||
							message.enumerable !== true ||
							typeof code.value !== "string" ||
							typeof message.value !== "string" ||
							message.value.length < 1 ||
							message.value.length > 512
						) {
							return undefined;
						}
						structuredClone(error);
						return code.value;
					} catch {
						return undefined;
					}
				}`,
			},
		],
		[
			"mapCopyMoveError",
			{
				kind: "function",
				failure:
					"mapCopyMoveError must own the exact authenticated copy/move error and rescan policy",
				source: `function mapCopyMoveError(error: unknown): Readonly<{
					error: FileSystemProviderError;
					rescan: boolean;
				}> {
					const code = copyMoveCommandErrorCode(error);
					switch (code) {
						case "ENTRY_ALREADY_EXISTS":
							return Object.freeze({
								error: fileSystemError(
									FileSystemProviderErrorCode.FileExists,
									"The workspace entry already exists.",
								),
								rescan: false,
							});
						case "ENTRY_NOT_FOUND":
							return Object.freeze({
								error: fileSystemError(
									FileSystemProviderErrorCode.FileNotFound,
									SANITIZED_MESSAGES.entryNotFound,
								),
								rescan: false,
							});
						case "ENTRY_TYPE_MISMATCH":
							return Object.freeze({
								error: fileSystemError(
									FileSystemProviderErrorCode.FileNotADirectory,
									SANITIZED_MESSAGES.notDirectory,
								),
								rescan: false,
							});
						case "ROOT_NOT_AUTHORIZED":
						case "INVALID_RELATIVE_PATH":
						case "PATH_OUTSIDE_ROOT":
						case "PERMISSION_DENIED":
							return Object.freeze({ error: noPermissions(), rescan: false });
						case "ROOT_UNAVAILABLE":
						case "PATH_ENCODING_UNSUPPORTED":
						case "WORKSPACE_CONFLICT":
						case "WORKSPACE_WINDOW_CLOSED":
							return Object.freeze({ error: unavailable(), rescan: false });
						case "DIRECTORY_TOO_LARGE":
						case "FILE_TOO_LARGE":
							return Object.freeze({
								error: fileSystemError(
									FileSystemProviderErrorCode.FileTooLarge,
									"The workspace entry exceeds the supported copy limits.",
								),
								rescan: false,
							});
						default:
							return Object.freeze({ error: unavailable(), rescan: true });
					}
				}`,
			},
		],
		[
			"requireVoidMutationReceipt",
			{
				kind: "function",
				failure:
					"requireVoidMutationReceipt must reject every non-undefined copy or rename receipt",
				source: `function requireVoidMutationReceipt(value: unknown): void {
					if (value !== undefined) {
						throw unavailable();
					}
				}`,
			},
		],
		[
			"WorkspaceMoveIncompleteError",
			{
				kind: "class",
				failure:
					"WorkspaceMoveIncompleteError must remain the frozen WORKSPACE_MOVE_INCOMPLETE FileOperationError",
				source: `class WorkspaceMoveIncompleteError extends FileOperationError {
					readonly code = "WORKSPACE_MOVE_INCOMPLETE" as const;

					constructor() {
						super(
							SANITIZED_MESSAGES.moveIncomplete,
							FileOperationResult.FILE_OTHER_ERROR,
						);
						this.name = this.code;
						Object.freeze(this);
					}
				}`,
			},
		],
		[
			"workspaceMoveIncomplete",
			{
				kind: "function",
				failure:
					"workspaceMoveIncomplete must construct only the audited incomplete-move error",
				source: `function workspaceMoveIncomplete(): WorkspaceMoveIncompleteError {
					return new WorkspaceMoveIncompleteError();
				}`,
			},
		],
		[
			"WorkspaceMoveOutcomeUnknownError",
			{
				kind: "class",
				failure:
					"WorkspaceMoveOutcomeUnknownError must remain the frozen WORKSPACE_MOVE_OUTCOME_UNKNOWN FileOperationError",
				source: `class WorkspaceMoveOutcomeUnknownError extends FileOperationError {
					readonly code = "WORKSPACE_MOVE_OUTCOME_UNKNOWN" as const;

					constructor() {
						super(
							SANITIZED_MESSAGES.moveOutcomeUnknown,
							FileOperationResult.FILE_OTHER_ERROR,
						);
						this.name = this.code;
						Object.freeze(this);
					}
				}`,
			},
		],
		[
			"workspaceMoveOutcomeUnknown",
			{
				kind: "function",
				failure:
					"workspaceMoveOutcomeUnknown must construct only the audited unknown-outcome error",
				source: `function workspaceMoveOutcomeUnknown(): WorkspaceMoveOutcomeUnknownError {
					return new WorkspaceMoveOutcomeUnknownError();
				}`,
			},
		],
	]);
	for (const [name, contract] of exactCopyMoveDeclarations) {
		const statements = sourceFile.statements.filter((statement) =>
			contract.kind === "class"
				? ts.isClassDeclaration(statement) && statement.name?.text === name
				: ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		);
		if (
			statements.length !== 1 ||
			statements[0].getText(sourceFile).replaceAll(/\s+/g, "") !==
				contract.source.replaceAll(/\s+/g, "")
		) {
			failures.push(contract.failure);
		}
	}
	const moveErrorDeclarationOrder = sourceFile.statements
		.map((statement) =>
			ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)
				? statement.name?.text
				: undefined,
		)
		.filter((name) =>
			[
				"WorkspaceMoveIncompleteError",
				"workspaceMoveIncomplete",
				"WorkspaceMoveOutcomeUnknownError",
				"workspaceMoveOutcomeUnknown",
			].includes(name),
		);
	if (
		!sameArray(moveErrorDeclarationOrder, [
			"WorkspaceMoveIncompleteError",
			"workspaceMoveIncomplete",
			"WorkspaceMoveOutcomeUnknownError",
			"workspaceMoveOutcomeUnknown",
		])
	) {
		failures.push(
			"workspace move terminal errors and factories must retain their audited declaration order",
		);
	}
	function countExactProviderImport(moduleName, importedName) {
		let count = 0;
		for (const statement of sourceFile.statements) {
			if (
				!ts.isImportDeclaration(statement) ||
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				statement.moduleSpecifier.text !== moduleName ||
				statement.importClause?.isTypeOnly === true ||
				!ts.isNamedImports(statement.importClause?.namedBindings)
			) {
				continue;
			}
			for (const specifier of statement.importClause.namedBindings.elements) {
				if (
					!specifier.isTypeOnly &&
					(specifier.propertyName?.text ?? specifier.name.text) ===
						importedName &&
					specifier.name.text === importedName
				) {
					count += 1;
				}
			}
		}
		return count;
	}
	const criticalProviderImports = [
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FileChangeType",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FilePermission",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FileSystemProviderCapabilities",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FileSystemProviderError",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FileSystemProviderErrorCode",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files",
			"FileType",
		],
		["@codingame/monaco-vscode-api/vscode/vs/base/common/event", "Emitter"],
		["@codingame/monaco-vscode-api/vscode/vs/base/common/event", "Event"],
		["@codingame/monaco-vscode-api/vscode/vs/base/common/uri", "URI"],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			"beginPlainWorkspaceDeleteProviderDispatch",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			"completePlainWorkspaceDeleteProviderFailure",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			"completePlainWorkspaceDeleteProviderResult",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			"getPlainWorkspaceDeleteAuthorizationSnapshot",
		],
		[
			"@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete",
			"takePlainWorkspaceDeleteProviderAuthorization",
		],
		["../../platform/tauri/workspace-codec", "decodeWorkspaceCapabilities"],
		["../../platform/tauri/workspace-codec", "decodeWorkspaceDeleteResult"],
		["../../platform/tauri/workspace-codec", "decodeWorkspaceEntryStat"],
		["../../platform/tauri/workspace-codec", "decodeWorkspaceMoveResult"],
		["../../platform/tauri/workspace-codec", "frozenWorkspaceEntryRequest"],
	];
	for (const [moduleName, importedName] of criticalProviderImports) {
		if (countExactProviderImport(moduleName, importedName) !== 1) {
			failures.push(
				`file-system-provider.ts must import ${importedName} exactly by name from its fixed Workbench module`,
			);
		}
	}
	const criticalBindingNames = new Set(
		criticalProviderImports.map(([, importedName]) => importedName),
	);
	const bindingIdentifiers = new Map();
	function recordBindingName(name) {
		if (ts.isIdentifier(name)) {
			const nodes = bindingIdentifiers.get(name.text) ?? [];
			nodes.push(name);
			bindingIdentifiers.set(name.text, nodes);
			return;
		}
		if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
			for (const element of name.elements) {
				if (ts.isBindingElement(element)) {
					recordBindingName(element.name);
				}
			}
		}
	}
	function collectBindingIdentifiers(node) {
		if (
			ts.isVariableDeclaration(node) ||
			ts.isParameter(node) ||
			ts.isBindingElement(node)
		) {
			recordBindingName(node.name);
		} else if (
			ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isClassDeclaration(node) ||
			ts.isClassExpression(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isEnumDeclaration(node) ||
			ts.isModuleDeclaration(node) ||
			ts.isTypeParameterDeclaration(node) ||
			ts.isImportEqualsDeclaration(node)
		) {
			if (node.name !== undefined) {
				recordBindingName(node.name);
			}
		} else if (ts.isImportClause(node) && node.name !== undefined) {
			recordBindingName(node.name);
		} else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
			recordBindingName(node.name);
		}
		ts.forEachChild(node, collectBindingIdentifiers);
	}
	collectBindingIdentifiers(sourceFile);
	for (const name of criticalBindingNames) {
		if ((bindingIdentifiers.get(name)?.length ?? 0) !== 1) {
			failures.push(
				`${name} must have exactly one fixed import binding and no local shadow`,
			);
		}
	}
	for (const name of ["Object", "Reflect", "structuredClone"]) {
		if ((bindingIdentifiers.get(name)?.length ?? 0) !== 0) {
			failures.push(
				`${name} must remain the unshadowed global intrinsic in the Plain workspace provider`,
			);
		}
	}
	const schemeStatements = sourceFile.statements.filter(
		(statement) =>
			ts.isVariableStatement(statement) &&
			statement.declarationList.declarations.some(
				(declaration) =>
					ts.isIdentifier(declaration.name) &&
					declaration.name.text === "PLAIN_WORKSPACE_SCHEME",
			),
	);
	if (
		schemeStatements.length !== 1 ||
		schemeStatements[0].getText(sourceFile).replaceAll(/\s+/g, "") !==
			'exportconstPLAIN_WORKSPACE_SCHEME="plain-workspace"asconst;'
	) {
		failures.push(
			'PLAIN_WORKSPACE_SCHEME must remain the exact exported "plain-workspace" literal',
		);
	}
	const providerClasses = sourceFile.statements.filter(
		(statement) =>
			ts.isClassDeclaration(statement) &&
			statement.name?.text === "PlainWorkspaceFileSystemProvider",
	);
	if (providerClasses.length !== 1) {
		return [
			"file-system-provider.ts must define exactly one PlainWorkspaceFileSystemProvider",
		];
	}

	const provider = providerClasses[0];
	if ((provider.modifiers?.length ?? 0) !== 0) {
		failures.push(
			"Plain workspace provider class must remain undecorated and module-private behind its audited factory",
		);
	}
	const expectedProviderMembers = new Set([
		"#bridge",
		"#allowsMutationDispatch",
		"#watchState",
		"capabilities",
		"onDidChangeCapabilities",
		"changeEmitter",
		"onDidChangeFile",
		"watch",
		"stat",
		"readdir",
		"readFile",
		"plainReadFile",
		"plainWriteFile",
		"plainCreateFile",
		"plainCreateDirectory",
		"writeFile",
		"mkdir",
		"delete",
		"plainSnapshotDeleteResource",
		"plainRefreshDeleteRoots",
		"copy",
		"rename",
		"requireMutationDispatchAllowed",
		"fireCreated",
		"fireDeleted",
		"fireMoved",
		"fireRootUpdated",
		"fireRootsUpdated",
		"reconcileWatchedPaths",
		"trackOpenResource",
		"resolveMutationResource",
		"resolveResource",
	]);
	const providerMemberCounts = new Map(
		[...expectedProviderMembers].map((name) => [name, 0]),
	);
	let providerSurfaceIsExact = true;
	for (const member of provider.members) {
		if (ts.isConstructorDeclaration(member)) {
			continue;
		}
		const name = typeScriptMemberName(member);
		if (name === undefined || !expectedProviderMembers.has(name)) {
			providerSurfaceIsExact = false;
			continue;
		}
		providerMemberCounts.set(name, providerMemberCounts.get(name) + 1);
	}
	if (
		!providerSurfaceIsExact ||
		[...providerMemberCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"Plain workspace provider member surface must remain the exact audited readonly/provider seam set",
		);
	}
	const policyFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "createPlainWorkspaceMutationPolicy",
	);
	if (policyFunctions.length !== 1) {
		failures.push(
			"file-system-provider.ts must define exactly one audited mutation policy builder",
		);
	} else {
		const [policyFunction] = policyFunctions;
		const [parameter] = policyFunction.parameters;
		const [snapshotStatement, returnStatement] =
			policyFunction.body?.statements ?? [];
		const snapshotDeclaration =
			snapshotStatement !== undefined &&
			ts.isVariableStatement(snapshotStatement) &&
			(snapshotStatement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
			snapshotStatement.declarationList.declarations.length === 1
				? snapshotStatement.declarationList.declarations[0]
				: undefined;
		const snapshotInitializer = snapshotDeclaration?.initializer;
		const returned =
			returnStatement !== undefined && ts.isReturnStatement(returnStatement)
				? returnStatement.expression
				: undefined;
		const capabilityFields = [];
		function collectCapabilityFields(expression) {
			if (ts.isParenthesizedExpression(expression)) {
				return collectCapabilityFields(expression.expression);
			}
			if (
				ts.isBinaryExpression(expression) &&
				expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
			) {
				return (
					collectCapabilityFields(expression.left) &&
					collectCapabilityFields(expression.right)
				);
			}
			if (
				ts.isPropertyAccessExpression(expression) &&
				ts.isIdentifier(expression.expression) &&
				expression.expression.text === "snapshot"
			) {
				capabilityFields.push(expression.name.text);
				return true;
			}
			return false;
		}
		const exactPolicyShape =
			policyFunction.body?.statements.length === 2 &&
			!policyFunction.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
			) &&
			policyFunction.parameters.length === 1 &&
			parameter !== undefined &&
			ts.isIdentifier(parameter.name) &&
			parameter.name.text === "platformCapabilities" &&
			parameter.type !== undefined &&
			ts.isTypeReferenceNode(parameter.type) &&
			ts.isIdentifier(parameter.type.typeName) &&
			parameter.type.typeName.text === "WorkspaceCapabilities" &&
			policyFunction.type?.kind === ts.SyntaxKind.BooleanKeyword &&
			snapshotDeclaration !== undefined &&
			ts.isIdentifier(snapshotDeclaration.name) &&
			snapshotDeclaration.name.text === "snapshot" &&
			snapshotInitializer !== undefined &&
			ts.isCallExpression(snapshotInitializer) &&
			ts.isIdentifier(snapshotInitializer.expression) &&
			snapshotInitializer.expression.text === "decodeWorkspaceCapabilities" &&
			snapshotInitializer.arguments.length === 1 &&
			ts.isIdentifier(snapshotInitializer.arguments[0]) &&
			snapshotInitializer.arguments[0].text === "platformCapabilities" &&
			returned !== undefined &&
			collectCapabilityFields(returned) &&
			sameArray(capabilityFields, [
				"create",
				"renameNoReplace",
				"copyMove",
				"delete",
				"versionedWrite",
			]);
		if (!exactPolicyShape) {
			failures.push(
				"mutation policy must decode one own-data DTO into an immutable all-five boolean",
			);
		}
	}

	const constructors = provider.members.filter((member) =>
		ts.isConstructorDeclaration(member),
	);
	if (constructors.length !== 1) {
		failures.push(
			"Plain workspace provider must have one module-private audited constructor",
		);
	} else {
		if (!hasFinalWorkspaceProviderCapabilityContract(provider, sourceFile)) {
			failures.push(
				"Plain workspace provider constructor must retain only the bridge, immutable mutation boolean and exact capability assignment",
			);
		}
	}

	const providerFactories = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "createPlainWorkspaceFileSystemProvider",
	);
	let factoryNewExpression;
	let factoryReturnTypeIdentifier;
	if (providerFactories.length !== 1) {
		failures.push(
			"file-system-provider.ts must define exactly one audited Plain workspace provider factory",
		);
	} else {
		const [factory] = providerFactories;
		const isExported = factory.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
		);
		const [bridgeParameter, capabilitiesParameter] = factory.parameters;
		const [statement] = factory.body?.statements ?? [];
		const returned =
			statement !== undefined && ts.isReturnStatement(statement)
				? statement.expression
				: undefined;
		const isExactParameter =
			factory.parameters.length === 2 &&
			bridgeParameter !== undefined &&
			capabilitiesParameter !== undefined &&
			ts.isIdentifier(bridgeParameter.name) &&
			bridgeParameter.name.text === "bridge" &&
			bridgeParameter.type !== undefined &&
			ts.isTypeReferenceNode(bridgeParameter.type) &&
			ts.isIdentifier(bridgeParameter.type.typeName) &&
			bridgeParameter.type.typeName.text === "PlainBridge" &&
			ts.isIdentifier(capabilitiesParameter.name) &&
			capabilitiesParameter.name.text === "platformCapabilities" &&
			capabilitiesParameter.type !== undefined &&
			ts.isTypeReferenceNode(capabilitiesParameter.type) &&
			ts.isIdentifier(capabilitiesParameter.type.typeName) &&
			capabilitiesParameter.type.typeName.text === "WorkspaceCapabilities";
		const policyArgument =
			returned !== undefined &&
			ts.isNewExpression(returned) &&
			returned.arguments?.length === 2
				? returned.arguments[1]
				: undefined;
		const isExactConstruction =
			factory.body?.statements.length === 1 &&
			returned !== undefined &&
			ts.isNewExpression(returned) &&
			ts.isIdentifier(returned.expression) &&
			returned.expression.text === "PlainWorkspaceFileSystemProvider" &&
			returned.arguments?.length === 2 &&
			ts.isIdentifier(returned.arguments[0]) &&
			returned.arguments[0].text === "bridge" &&
			policyArgument !== undefined &&
			ts.isCallExpression(policyArgument) &&
			ts.isIdentifier(policyArgument.expression) &&
			policyArgument.expression.text === "createPlainWorkspaceMutationPolicy" &&
			policyArgument.arguments.length === 1 &&
			ts.isIdentifier(policyArgument.arguments[0]) &&
			policyArgument.arguments[0].text === "platformCapabilities";
		if (!isExported || !isExactParameter || !isExactConstruction) {
			failures.push(
				"Plain workspace provider factory must directly bind bridge and decoded platform capabilities",
			);
		} else {
			factoryNewExpression = returned.expression;
		}
		if (
			factory.type !== undefined &&
			ts.isTypeReferenceNode(factory.type) &&
			ts.isIdentifier(factory.type.typeName) &&
			factory.type.typeName.text === "PlainWorkspaceFileSystemProvider"
		) {
			factoryReturnTypeIdentifier = factory.type.typeName;
		}
	}
	if (
		provider.heritageClauses?.some(
			(clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
		)
	) {
		failures.push(
			"Plain workspace provider must not inherit hidden write capabilities",
		);
	}

	for (const member of provider.members) {
		if (member.name !== undefined && ts.isComputedPropertyName(member.name)) {
			failures.push(
				"Plain workspace provider must not hide members behind computed names",
			);
		}
	}

	const plainWriteMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "plainWriteFile",
	);
	const plainCreateFileMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "plainCreateFile",
	);
	const plainCreateDirectoryMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "plainCreateDirectory",
	);
	const publicWriteMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "writeFile",
	);
	const publicMkdirMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "mkdir",
	);
	const copyMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) && typeScriptMemberName(member) === "copy",
	);
	const renameMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "rename",
	);
	const mutationGateMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "requireMutationDispatchAllowed",
	);
	const fireCreatedMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "fireCreated",
	);
	const fireMovedMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "fireMoved",
	);
	const fireRootUpdatedMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "fireRootUpdated",
	);
	const fireRootsUpdatedMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "fireRootsUpdated",
	);
	const resolveMutationMethods = provider.members.filter(
		(member) =>
			ts.isMethodDeclaration(member) &&
			typeScriptMemberName(member) === "resolveMutationResource",
	);
	const changeEventMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "onDidChangeFile",
	);
	const capabilityChangeEventMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "onDidChangeCapabilities",
	);
	function providerMethodCallCount(method, receiverName, methodName) {
		let count = 0;
		function visitMethod(node) {
			const receiver =
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isPropertyAccessExpression(node.expression.expression)
					? node.expression.expression
					: undefined;
			const hasExpectedReceiver =
				receiver !== undefined &&
				receiver.expression.kind === ts.SyntaxKind.ThisKeyword &&
				(receiverName === "bridge"
					? ts.isPrivateIdentifier(receiver.name) &&
						receiver.name.text === "#bridge"
					: receiver.name.text === receiverName);
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === methodName &&
				hasExpectedReceiver
			) {
				count += 1;
			}
			ts.forEachChild(node, visitMethod);
		}
		if (method.body !== undefined) {
			visitMethod(method.body);
		}
		return count;
	}
	function directThisMethodCallCount(method, methodName) {
		let count = 0;
		function visitMethod(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
				node.expression.name.text === methodName
			) {
				count += 1;
			}
			ts.forEachChild(node, visitMethod);
		}
		if (method.body !== undefined) {
			visitMethod(method.body);
		}
		return count;
	}
	function identifierCallCount(method, functionName) {
		let count = 0;
		function visitMethod(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === functionName
			) {
				count += 1;
			}
			ts.forEachChild(node, visitMethod);
		}
		if (method.body !== undefined) {
			visitMethod(method.body);
		}
		return count;
	}
	function startsWithMutationGate(method) {
		const [firstStatement] = method.body?.statements ?? [];
		const firstExpression =
			firstStatement !== undefined && ts.isExpressionStatement(firstStatement)
				? firstStatement.expression
				: undefined;
		return (
			firstExpression !== undefined &&
			ts.isCallExpression(firstExpression) &&
			firstExpression.arguments.length === 0 &&
			ts.isPropertyAccessExpression(firstExpression.expression) &&
			firstExpression.expression.expression.kind ===
				ts.SyntaxKind.ThisKeyword &&
			firstExpression.expression.name.text === "requireMutationDispatchAllowed"
		);
	}
	if (mutationGateMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define one primitive mutation dispatch gate",
		);
	} else {
		const [mutationGate] = mutationGateMethods;
		const normalizedBody = mutationGate.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		if (
			mutationGate.parameters.length !== 0 ||
			!mutationGate.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			mutationGate.type?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalizedBody !==
				"{if(!this.#allowsMutationDispatch){thrownoPermissions();}}"
		) {
			failures.push(
				"mutation dispatch gate must fail closed from the immutable primitive policy",
			);
		}
	}
	if (fireCreatedMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define exactly one audited fireCreated helper",
		);
	} else {
		const [fireCreated] = fireCreatedMethods;
		const normalizedBody = fireCreated.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			this.changeEmitter.fire(
				Object.freeze([
					Object.freeze({
						type: FileChangeType.ADDED,
						resource,
					}),
				]),
			);
		}`.replaceAll(/\s+/g, "");
		if (
			!fireCreated.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			fireCreated.parameters.length !== 1 ||
			!ts.isIdentifier(fireCreated.parameters[0]?.name) ||
			fireCreated.parameters[0].name.text !== "resource" ||
			fireCreated.type?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"fireCreated must emit one frozen target ADDED event and nothing else",
			);
		}
	}
	if (fireMovedMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define exactly one audited fireMoved helper",
		);
	} else {
		const [fireMoved] = fireMovedMethods;
		const normalizedBody = fireMoved.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			this.changeEmitter.fire(
				Object.freeze([
					Object.freeze({
						type: FileChangeType.DELETED,
						resource: source,
					}),
					Object.freeze({
						type: FileChangeType.ADDED,
						resource: target,
					}),
				]),
			);
		}`.replaceAll(/\s+/g, "");
		if (
			!fireMoved.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			fireMoved.parameters.length !== 2 ||
			!sameArray(
				fireMoved.parameters.map((parameter) =>
					ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
				),
				["source", "target"],
			) ||
			!fireMoved.parameters.every(
				(parameter) =>
					parameter.type !== undefined &&
					ts.isTypeReferenceNode(parameter.type) &&
					ts.isIdentifier(parameter.type.typeName) &&
					parameter.type.typeName.text === "URI",
			) ||
			fireMoved.type?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"fireMoved must emit one frozen source DELETED plus target ADDED event and nothing else",
			);
		}
	}
	if (fireRootUpdatedMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define exactly one audited fireRootUpdated helper",
		);
	} else {
		const [fireRootUpdated] = fireRootUpdatedMethods;
		const normalizedBody = fireRootUpdated.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			const root = resource.with({ path: "/", query: null, fragment: null });
			root.toString();
			void root.fsPath;
			Object.freeze(root);
			this.changeEmitter.fire(
				Object.freeze([
					Object.freeze({
						type: FileChangeType.UPDATED,
						resource: root,
					}),
				]),
			);
		}`.replaceAll(/\s+/g, "");
		if (
			!fireRootUpdated.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			fireRootUpdated.parameters.length !== 1 ||
			!ts.isIdentifier(fireRootUpdated.parameters[0]?.name) ||
			fireRootUpdated.parameters[0].name.text !== "resource" ||
			fireRootUpdated.type?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"fireRootUpdated must emit one frozen root UPDATED event and nothing else",
			);
		}
	}
	if (fireRootsUpdatedMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define exactly one audited fireRootsUpdated helper",
		);
	} else {
		const [fireRootsUpdated] = fireRootsUpdatedMethods;
		const normalizedBody = fireRootsUpdated.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			const sourceRoot = source.with({ path: "/", query: null, fragment: null });
			const targetRoot = target.with({ path: "/", query: null, fragment: null });
			sourceRoot.toString();
			void sourceRoot.fsPath;
			targetRoot.toString();
			void targetRoot.fsPath;
			Object.freeze(sourceRoot);
			Object.freeze(targetRoot);
			this.changeEmitter.fire(
				Object.freeze([
					Object.freeze({
						type: FileChangeType.UPDATED,
						resource: sourceRoot,
					}),
					Object.freeze({
						type: FileChangeType.UPDATED,
						resource: targetRoot,
					}),
				]),
			);
		}`.replaceAll(/\s+/g, "");
		if (
			!fireRootsUpdated.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			fireRootsUpdated.parameters.length !== 2 ||
			!sameArray(
				fireRootsUpdated.parameters.map((parameter) =>
					ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
				),
				["source", "target"],
			) ||
			!fireRootsUpdated.parameters.every(
				(parameter) =>
					parameter.type !== undefined &&
					ts.isTypeReferenceNode(parameter.type) &&
					ts.isIdentifier(parameter.type.typeName) &&
					parameter.type.typeName.text === "URI",
			) ||
			fireRootsUpdated.type?.kind !== ts.SyntaxKind.VoidKeyword ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"fireRootsUpdated must emit one frozen source-root plus target-root UPDATED event and nothing else",
			);
		}
	}
	if (resolveMutationMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must define exactly one audited mutation URI snapshot helper",
		);
	} else {
		const [resolveMutation] = resolveMutationMethods;
		const normalizedBody = resolveMutation.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			try {
				const scheme = resource.scheme;
				const authority = resource.authority;
				const path = resource.path;
				const query = resource.query;
				const fragment = resource.fragment;
				if (
					typeof scheme !== "string" ||
					typeof authority !== "string" ||
					typeof path !== "string" ||
					typeof query !== "string" ||
					typeof fragment !== "string" ||
					scheme !== PLAIN_WORKSPACE_SCHEME ||
					query !== "" ||
					fragment !== "" ||
					path.length <= 1 ||
					!path.startsWith("/")
				) {
					throw noPermissions();
				}
				const relativePath = path === "/" ? "" : path.slice(1);
				const request = frozenWorkspaceEntryRequest(authority, relativePath);
				const eventResource = URI.from(
					{ scheme, authority, path, query, fragment },
					true,
				);
				eventResource.toString();
				void eventResource.fsPath;
				Object.freeze(eventResource);
				return Object.freeze({ ...request, resource: eventResource });
			} catch {
				throw noPermissions();
			}
		}`.replaceAll(/\s+/g, "");
		if (
			!resolveMutation.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
			) ||
			resolveMutation.parameters.length !== 1 ||
			!ts.isIdentifier(resolveMutation.parameters[0]?.name) ||
			resolveMutation.parameters[0].name.text !== "resource" ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"mutation URI helper must read each primitive once and return one frozen request/event snapshot",
			);
		}
	}
	if (plainWriteMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must expose exactly one audited private plainWriteFile seam",
		);
	} else {
		const [plainWrite] = plainWriteMethods;
		const parameterNames = plainWrite.parameters.map((parameter) =>
			ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
		);
		if (
			!plainWrite.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
			) ||
			!sameArray(parameterNames, ["resource", "content", "expectedVersion"]) ||
			!startsWithMutationGate(plainWrite) ||
			providerMethodCallCount(plainWrite, "bridge", "workspaceWriteFile") !==
				1 ||
			providerMethodCallCount(plainWrite, "changeEmitter", "fire") !== 1
		) {
			failures.push(
				"plainWriteFile must gate first, dispatch one versioned bridge write and retain one root-rescan branch",
			);
		}
	}
	function validatePlainCreateMethod(
		methods,
		methodName,
		bridgeMethod,
		expectedKind,
	) {
		if (methods.length !== 1) {
			failures.push(
				`Plain workspace provider must expose exactly one audited ${methodName} seam`,
			);
			return;
		}
		const [method] = methods;
		const parameterNames = method.parameters.map((parameter) =>
			ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
		);
		const normalizedBody = method.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			this.requireMutationDispatchAllowed();
			const resolved = this.resolveMutationResource(resource);
			try {
				const stat = createdProviderStat(
					await this.#bridge.${bridgeMethod}(
						resolved.rootId,
						resolved.relativePath,
					),
					"${expectedKind}",
				);
				this.fireCreated(resolved.resource);
				return stat;
			} catch (error) {
				const failure = mapCreateError(error);
				if (failure.rescan) {
					this.fireRootUpdated(resolved.resource);
				}
				throw failure.error;
			}
		}`.replaceAll(/\s+/g, "");
		if (
			method.modifiers?.length !== 1 ||
			method.modifiers[0].kind !== ts.SyntaxKind.AsyncKeyword ||
			!sameArray(parameterNames, ["resource"]) ||
			method.parameters[0].initializer !== undefined ||
			method.parameters[0].questionToken !== undefined ||
			method.parameters[0].dotDotDotToken !== undefined ||
			(method.parameters[0].modifiers?.length ?? 0) !== 0 ||
			method.parameters[0].type === undefined ||
			!ts.isTypeReferenceNode(method.parameters[0].type) ||
			!ts.isIdentifier(method.parameters[0].type.typeName) ||
			method.parameters[0].type.typeName.text !== "URI" ||
			!startsWithMutationGate(method) ||
			providerMethodCallCount(method, "bridge", bridgeMethod) !== 1 ||
			directThisMethodCallCount(method, "resolveMutationResource") !== 1 ||
			directThisMethodCallCount(method, "fireCreated") !== 1 ||
			directThisMethodCallCount(method, "fireRootUpdated") !== 1 ||
			identifierCallCount(method, "createdProviderStat") !== 1 ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				`${methodName} must gate first, snapshot once, validate one native receipt and emit one target addition`,
			);
		}
	}
	validatePlainCreateMethod(
		plainCreateFileMethods,
		"plainCreateFile",
		"workspaceCreateFile",
		"file",
	);
	validatePlainCreateMethod(
		plainCreateDirectoryMethods,
		"plainCreateDirectory",
		"workspaceCreateDirectory",
		"directory",
	);
	if (publicWriteMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must keep exactly one fail-closed public writeFile method",
		);
	} else {
		const [publicWrite] = publicWriteMethods;
		const [statement] = publicWrite.body?.statements ?? [];
		const expression = ts.isThrowStatement(statement)
			? statement.expression
			: undefined;
		if (
			publicWrite.body?.statements.length !== 1 ||
			expression === undefined ||
			!ts.isCallExpression(expression) ||
			!ts.isIdentifier(expression.expression) ||
			expression.expression.text !== "noPermissions" ||
			expression.arguments.length !== 0 ||
			providerMethodCallCount(publicWrite, "bridge", "workspaceWriteFile") !== 0
		) {
			failures.push(
				"public writeFile must remain a direct noPermissions failure without native dispatch",
			);
		}
	}
	if (publicMkdirMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must keep exactly one fail-closed public mkdir method",
		);
	} else {
		const [publicMkdir] = publicMkdirMethods;
		const [statement] = publicMkdir.body?.statements ?? [];
		const expression = ts.isThrowStatement(statement)
			? statement.expression
			: undefined;
		if (
			publicMkdir.body?.statements.length !== 1 ||
			expression === undefined ||
			!ts.isCallExpression(expression) ||
			!ts.isIdentifier(expression.expression) ||
			expression.expression.text !== "noPermissions" ||
			expression.arguments.length !== 0 ||
			providerMethodCallCount(
				publicMkdir,
				"bridge",
				"workspaceCreateDirectory",
			) !== 0
		) {
			failures.push(
				"public mkdir must remain a direct noPermissions failure without native dispatch",
			);
		}
	}
	function exactCopyMoveMethodSignature(method) {
		if (
			method.modifiers?.length !== 1 ||
			method.modifiers[0].kind !== ts.SyntaxKind.AsyncKeyword ||
			method.parameters.length !== 3 ||
			!sameArray(
				method.parameters.map((parameter) =>
					ts.isIdentifier(parameter.name) ? parameter.name.text : undefined,
				),
				["from", "to", "options"],
			) ||
			method.parameters.some(
				(parameter) =>
					parameter.initializer !== undefined ||
					parameter.questionToken !== undefined ||
					parameter.dotDotDotToken !== undefined ||
					(parameter.modifiers?.length ?? 0) !== 0,
			)
		) {
			return false;
		}
		const [from, to, options] = method.parameters;
		const hasTypeName = (parameter, name) =>
			parameter.type !== undefined &&
			ts.isTypeReferenceNode(parameter.type) &&
			ts.isIdentifier(parameter.type.typeName) &&
			parameter.type.typeName.text === name;
		return (
			hasTypeName(from, "URI") &&
			hasTypeName(to, "URI") &&
			hasTypeName(options, "IFileOverwriteOptions") &&
			method.type !== undefined &&
			ts.isTypeReferenceNode(method.type) &&
			ts.isIdentifier(method.type.typeName) &&
			method.type.typeName.text === "Promise" &&
			method.type.typeArguments?.length === 1 &&
			method.type.typeArguments[0].kind === ts.SyntaxKind.VoidKeyword
		);
	}
	if (copyMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must expose exactly one audited copy adapter",
		);
	} else {
		const [copyMethod] = copyMethods;
		const normalizedBody = copyMethod.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			this.requireMutationDispatchAllowed();
			requireNoOverwriteOptions(options);
			const source = this.resolveMutationResource(from);
			const target = this.resolveMutationResource(to);
			if (
				source.rootId === target.rootId &&
				source.relativePath === target.relativePath
			) {
				throw fileSystemError(
					FileSystemProviderErrorCode.FileExists,
					"The workspace entry already exists.",
				);
			}
			try {
				const receipt = (await this.#bridge.workspaceCopy(
					source.rootId,
					source.relativePath,
					target.rootId,
					target.relativePath,
				)) as unknown;
				requireVoidMutationReceipt(receipt);
			} catch (error) {
				const failure = mapCopyMoveError(error);
				if (failure.rescan) {
					this.fireRootUpdated(target.resource);
				}
				throw failure.error;
			}
			this.fireCreated(target.resource);
		}`.replaceAll(/\s+/g, "");
		if (
			!exactCopyMoveMethodSignature(copyMethod) ||
			!startsWithMutationGate(copyMethod) ||
			directThisMethodCallCount(copyMethod, "resolveMutationResource") !== 2 ||
			providerMethodCallCount(copyMethod, "bridge", "workspaceCopy") !== 1 ||
			identifierCallCount(copyMethod, "requireNoOverwriteOptions") !== 1 ||
			identifierCallCount(copyMethod, "requireVoidMutationReceipt") !== 1 ||
			directThisMethodCallCount(copyMethod, "fireCreated") !== 1 ||
			directThisMethodCallCount(copyMethod, "fireRootUpdated") !== 1 ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"copy must gate first, authenticate strict options, snapshot two URIs, route one copy, verify void and close its event set",
			);
		}
	}
	if (renameMethods.length !== 1) {
		failures.push(
			"Plain workspace provider must expose exactly one audited rename/move adapter",
		);
	} else {
		const [renameMethod] = renameMethods;
		const normalizedBody = renameMethod.body
			?.getText(sourceFile)
			.replaceAll(/\s+/g, "");
		const expectedBody = `{
			this.requireMutationDispatchAllowed();
			requireNoOverwriteOptions(options);
			const source = this.resolveMutationResource(from);
			const target = this.resolveMutationResource(to);
			if (
				source.rootId === target.rootId &&
				source.relativePath === target.relativePath
			) {
				throw fileSystemError(
					FileSystemProviderErrorCode.FileExists,
					"The workspace entry already exists.",
				);
			}

			if (source.rootId === target.rootId) {
				try {
					const receipt = (await this.#bridge.workspaceRename(
						source.rootId,
						source.relativePath,
						target.relativePath,
					)) as unknown;
					requireVoidMutationReceipt(receipt);
				} catch (error) {
					const failure = mapCopyMoveError(error);
					if (failure.rescan) {
						this.fireRootUpdated(source.resource);
					}
					throw failure.error;
				}
				this.fireMoved(source.resource, target.resource);
				return;
			}

			let result;
			try {
				result = decodeWorkspaceMoveResult(
						await this.#bridge.workspaceMove(
						source.rootId,
						source.relativePath,
						target.rootId,
						target.relativePath,
					),
				);
			} catch (error) {
				const failure = mapCopyMoveError(error);
				if (failure.rescan) {
					this.fireRootsUpdated(source.resource, target.resource);
					throw workspaceMoveOutcomeUnknown();
				}
				throw failure.error;
			}
			if (result.status !== "moved") {
				this.fireRootsUpdated(source.resource, target.resource);
				throw workspaceMoveIncomplete();
			}
			this.fireMoved(source.resource, target.resource);
		}`.replaceAll(/\s+/g, "");
		if (
			!exactCopyMoveMethodSignature(renameMethod) ||
			!startsWithMutationGate(renameMethod) ||
			directThisMethodCallCount(renameMethod, "resolveMutationResource") !==
				2 ||
			providerMethodCallCount(renameMethod, "bridge", "workspaceRename") !==
				1 ||
			providerMethodCallCount(renameMethod, "bridge", "workspaceMove") !== 1 ||
			identifierCallCount(renameMethod, "requireNoOverwriteOptions") !== 1 ||
			identifierCallCount(renameMethod, "requireVoidMutationReceipt") !== 1 ||
			identifierCallCount(renameMethod, "decodeWorkspaceMoveResult") !== 1 ||
			directThisMethodCallCount(renameMethod, "fireMoved") !== 2 ||
			directThisMethodCallCount(renameMethod, "fireRootUpdated") !== 1 ||
			directThisMethodCallCount(renameMethod, "fireRootsUpdated") !== 2 ||
			identifierCallCount(renameMethod, "workspaceMoveIncomplete") !== 1 ||
			identifierCallCount(renameMethod, "workspaceMoveOutcomeUnknown") !== 1 ||
			normalizedBody !== expectedBody
		) {
			failures.push(
				"rename must gate first, authenticate strict options, snapshot two URIs, split one rename or move route and accept only moved",
			);
		}
	}
	if (changeEventMembers.length !== 1) {
		failures.push(
			"Plain workspace provider must expose exactly one audited file-change event",
		);
	} else {
		const [changeEvent] = changeEventMembers;
		const initializer = changeEvent.initializer;
		if (
			initializer === undefined ||
			!ts.isPropertyAccessExpression(initializer) ||
			initializer.name.text !== "event" ||
			!ts.isPropertyAccessExpression(initializer.expression) ||
			initializer.expression.name.text !== "changeEmitter" ||
			initializer.expression.expression.kind !== ts.SyntaxKind.ThisKeyword
		) {
			failures.push(
				"Plain workspace provider file-change event must be sourced only from its private emitter",
			);
		}
	}
	if (capabilityChangeEventMembers.length !== 1) {
		failures.push(
			"Plain workspace provider must expose one immutable capability event",
		);
	} else {
		const [capabilityChangeEvent] = capabilityChangeEventMembers;
		const initializer = capabilityChangeEvent.initializer;
		if (
			!capabilityChangeEvent.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
			) ||
			initializer === undefined ||
			!ts.isPropertyAccessExpression(initializer) ||
			!ts.isIdentifier(initializer.expression) ||
			initializer.expression.text !== "Event" ||
			initializer.name.text !== "None"
		) {
			failures.push(
				"Plain workspace provider capability event must remain exactly Event.None",
			);
		}
	}

	const capabilityMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "capabilities",
	);
	if (capabilityMembers.length !== 1) {
		failures.push(
			"Plain workspace provider must declare one explicit capabilities property",
		);
	} else if (
		!hasFinalWorkspaceProviderCapabilityContract(provider, sourceFile)
	) {
		failures.push(
			"Plain workspace provider capabilities must be constructed once as all-five FileReadWrite | FileFolderCopy or FileReadWrite | Readonly",
		);
	}

	const allowedProviderIdentifiers = new Set([
		provider.name,
		factoryNewExpression,
		factoryReturnTypeIdentifier,
	]);
	let hasExtraProviderReference = false;
	let hasPrototypeMutationSurface = false;
	let objectPrototypeReferences = 0;
	let localPrototypeReferences = 0;
	let hasDynamicMutationSurface = false;
	let hasCapabilitiesReference = false;
	let mutationDispatchReferences = 0;
	let hasUnexpectedPrivateIdentifier = false;
	const capabilityFlagReferences = new Map([
		["FileReadWrite", 0],
		["FileFolderCopy", 0],
		["Readonly", 0],
	]);
	let createFileBridgeReferences = 0;
	let createDirectoryBridgeReferences = 0;
	let copyBridgeReferences = 0;
	let renameBridgeReferences = 0;
	let moveBridgeReferences = 0;
	let deleteBridgeReferences = 0;
	const auditedMutationBridgeNames = new Set([
		"workspaceCreateFile",
		"workspaceCreateDirectory",
		"workspaceCopy",
		"workspaceRename",
		"workspaceMove",
		"workspaceCommitDeleteEntry",
	]);
	const expectedBridgeMethods = new Map([
		["workspaceWatch", 1],
		["workspaceStat", 2],
		["workspaceReadDirectory", 1],
		["workspaceReadFile", 1],
		["workspaceWriteFile", 1],
		["workspaceCreateFile", 1],
		["workspaceCreateDirectory", 1],
		["workspaceCopy", 1],
		["workspaceRename", 1],
		["workspaceMove", 1],
		["workspaceCommitDeleteEntry", 1],
	]);
	const bridgeMethodCounts = new Map(
		[...expectedBridgeMethods].map(([name]) => [name, 0]),
	);
	const bindingIdentifierNodes = new Set(
		[...bindingIdentifiers.values()].flat(),
	);
	const criticalPropertyBindings = new Set([
		"FileChangeType",
		"FilePermission",
		"FileSystemProviderCapabilities",
		"FileSystemProviderError",
		"FileSystemProviderErrorCode",
		"FileType",
		"Event",
		"URI",
	]);
	const criticalCallBindings = new Set([
		"beginPlainWorkspaceDeleteProviderDispatch",
		"completePlainWorkspaceDeleteProviderFailure",
		"completePlainWorkspaceDeleteProviderResult",
		"getPlainWorkspaceDeleteAuthorizationSnapshot",
		"takePlainWorkspaceDeleteProviderAuthorization",
		"decodeWorkspaceCapabilities",
		"decodeWorkspaceDeleteResult",
		"decodeWorkspaceEntryStat",
		"decodeWorkspaceMoveResult",
		"frozenWorkspaceEntryRequest",
	]);
	const criticalNewBindings = new Set([
		"Emitter",
		"WorkspaceMoveIncompleteError",
		"WorkspaceMoveOutcomeUnknownError",
	]);
	const immutableRuntimeRoots = new Set([
		...criticalBindingNames,
		"Object",
		"Reflect",
		"PLAIN_WORKSPACE_SCHEME",
		"SANITIZED_MESSAGES",
		"fileSystemError",
		"noPermissions",
		"createPlainWorkspaceMutationPolicy",
		"unavailable",
		"commandErrorCode",
		"mapReadError",
		"mapWriteError",
		"mapCreateError",
		"requireNoOverwriteOptions",
		"copyMoveCommandErrorCode",
		"mapCopyMoveError",
		"mapDeleteError",
		"requireVoidMutationReceipt",
		"WorkspaceMoveIncompleteError",
		"workspaceMoveIncomplete",
		"WorkspaceMoveOutcomeUnknownError",
		"workspaceMoveOutcomeUnknown",
		"structuredClone",
		"kindToFileType",
		"providerStat",
		"createdProviderStat",
		"PlainWorkspaceFileSystemProvider",
		"createPlainWorkspaceFileSystemProvider",
	]);
	const protectedFunctionReferences = new Map([
		["createdProviderStat", 2],
		["mapCreateError", 2],
		["requireNoOverwriteOptions", 2],
		["copyMoveCommandErrorCode", 2],
		["mapCopyMoveError", 3],
		["mapDeleteError", 1],
		["requireVoidMutationReceipt", 2],
		["workspaceMoveIncomplete", 1],
		["workspaceMoveOutcomeUnknown", 1],
		["decodeWorkspaceMoveResult", 1],
		["decodeWorkspaceDeleteResult", 1],
		["beginPlainWorkspaceDeleteProviderDispatch", 1],
		["completePlainWorkspaceDeleteProviderFailure", 2],
		["completePlainWorkspaceDeleteProviderResult", 1],
		["getPlainWorkspaceDeleteAuthorizationSnapshot", 1],
		["takePlainWorkspaceDeleteProviderAuthorization", 1],
		["structuredClone", 2],
		["mapReadError", 3],
		["mapWriteError", 1],
		["createPlainWorkspaceMutationPolicy", 1],
		["createPlainWorkspaceFileSystemProvider", 0],
	]);
	const protectedFunctionCallCounts = new Map(
		[...protectedFunctionReferences].map(([name]) => [name, 0]),
	);
	const forbiddenDynamicGlobalNames = new Set([
		"globalThis",
		"global",
		"window",
		"self",
		"document",
		"Function",
		"eval",
		"require",
	]);
	const forbiddenInternalMutationSeams = new Set([
		"plainCreateFile",
		"plainCreateDirectory",
		"plainWriteFile",
		"delete",
		"copy",
		"rename",
	]);
	let fireCreatedCallCount = 0;
	let fireDeletedCallCount = 0;
	let fireMovedCallCount = 0;
	let fireRootUpdatedCallCount = 0;
	let fireRootsUpdatedCallCount = 0;
	let changeEmitterFireCallCount = 0;
	let moveIncompleteConstructionCount = 0;
	let moveOutcomeUnknownConstructionCount = 0;
	let privateBridgeReferences = 0;
	let privatePolicyReferences = 0;
	let privateWatchStateReferences = 0;
	function isThisBridge(node) {
		return (
			ts.isPropertyAccessExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ThisKeyword &&
			ts.isPrivateIdentifier(node.name) &&
			node.name.text === "#bridge"
		);
	}
	function unwrapRuntimeExpression(node) {
		let current = node;
		while (
			ts.isParenthesizedExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current) ||
			ts.isSatisfiesExpression(current)
		) {
			current = current.expression;
		}
		return current;
	}
	function runtimeRootName(node) {
		const current = unwrapRuntimeExpression(node);
		if (ts.isIdentifier(current)) {
			return current.text;
		}
		if (
			ts.isPropertyAccessExpression(current) ||
			ts.isElementAccessExpression(current)
		) {
			return runtimeRootName(current.expression);
		}
		return undefined;
	}
	function isProviderDescendant(node) {
		let current = node;
		while (current !== undefined) {
			if (current === provider) {
				return true;
			}
			if (ts.isClassDeclaration(current) && current !== provider) {
				return false;
			}
			current = current.parent;
		}
		return false;
	}
	function isAuditedProviderInstanceFreezeThis(node) {
		const call = node.parent;
		return (
			ts.isCallExpression(call) &&
			call.arguments.length === 1 &&
			call.arguments[0] === node &&
			ts.isPropertyAccessExpression(call.expression) &&
			ts.isIdentifier(call.expression.expression) &&
			call.expression.expression.text === "Object" &&
			call.expression.name.text === "freeze" &&
			call.parent === constructors[0]?.body?.statements[3]
		);
	}
	function isAuditedProviderPrototypeNode(node) {
		const access = ts.isIdentifier(node)
			? node.parent
			: ts.isPropertyAccessExpression(node)
				? node
				: undefined;
		const call = access?.parent;
		const statement = call?.parent;
		return (
			access !== undefined &&
			ts.isPropertyAccessExpression(access) &&
			ts.isIdentifier(access.expression) &&
			access.expression.text === "PlainWorkspaceFileSystemProvider" &&
			ts.isIdentifier(access.name) &&
			access.name.text === "prototype" &&
			ts.isCallExpression(call) &&
			call.arguments.length === 1 &&
			call.arguments[0] === access &&
			ts.isPropertyAccessExpression(call.expression) &&
			ts.isIdentifier(call.expression.expression) &&
			call.expression.expression.text === "Object" &&
			call.expression.name.text === "freeze" &&
			statement !== undefined &&
			isFinalWorkspaceProviderPrototypeFreeze(statement, sourceFile)
		);
	}
	function isCriticalTypeReference(node) {
		return (
			ts.isTypeReferenceNode(node.parent) ||
			ts.isExpressionWithTypeArguments(node.parent) ||
			ts.isTypeQueryNode(node.parent)
		);
	}
	function isAssignmentOperator(kind) {
		return (
			kind >= ts.SyntaxKind.FirstAssignment &&
			kind <= ts.SyntaxKind.LastAssignment
		);
	}
	function visit(node) {
		if (ts.isPrivateIdentifier(node)) {
			if (node.text === "#bridge") {
				privateBridgeReferences += 1;
			} else if (node.text === "#allowsMutationDispatch") {
				privatePolicyReferences += 1;
			} else if (node.text === "#watchState") {
				privateWatchStateReferences += 1;
			} else {
				hasUnexpectedPrivateIdentifier = true;
			}
		}
		if (node.kind === ts.SyntaxKind.Decorator) {
			failures.push(
				"Plain workspace provider source must not contain decorators that can wrap audited construction or mutation seams",
			);
		}
		if (ts.isIdentifier(node) && forbiddenDynamicGlobalNames.has(node.text)) {
			failures.push(
				"Plain workspace provider must not reach dynamic global or code-loading surfaces",
			);
		}
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			(node.text === "constructor" || node.text === "__proto__")
		) {
			failures.push(
				"Plain workspace provider must not reach constructor or prototype escape surfaces",
			);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			failures.push(
				"Plain workspace provider must not reach dynamic global or code-loading surfaces",
			);
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "FileSystemProviderCapabilities"
		) {
			const flag = node.name.text;
			if (!capabilityFlagReferences.has(flag)) {
				failures.push(
					`Plain workspace provider must not advertise ${flag} outside the final two capability sets`,
				);
			} else {
				capabilityFlagReferences.set(
					flag,
					capabilityFlagReferences.get(flag) + 1,
				);
			}
		}
		if (
			ts.isIdentifier(node) &&
			node.text === "PlainWorkspaceFileSystemProvider" &&
			!allowedProviderIdentifiers.has(node) &&
			!isAuditedProviderPrototypeNode(node)
		) {
			hasExtraProviderReference = true;
		}
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.text === "prototype"
		) {
			const isAuditedObjectPrototype =
				ts.isIdentifier(node) &&
				ts.isPropertyAccessExpression(node.parent) &&
				node.parent.name === node &&
				ts.isIdentifier(node.parent.expression) &&
				node.parent.expression.text === "Object";
			if (isAuditedObjectPrototype) {
				objectPrototypeReferences += 1;
			} else if (isAuditedProviderPrototypeNode(node)) {
				// The one frozen provider prototype is part of the runtime authority seal.
			} else if (ts.isIdentifier(node)) {
				localPrototypeReferences += 1;
			} else {
				hasPrototypeMutationSurface = true;
			}
		}
		if (
			ts.isIdentifier(node) &&
			(node.text === "defineProperty" || node.text === "Proxy")
		) {
			hasDynamicMutationSurface = true;
		}
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.text === "capabilities" &&
			node !== capabilityMembers[0]?.name
		) {
			const propertyAccess = node.parent;
			const assignment = propertyAccess?.parent;
			const isAuditedConstructorAssignment =
				ts.isIdentifier(node) &&
				ts.isPropertyAccessExpression(propertyAccess) &&
				propertyAccess.name === node &&
				propertyAccess.expression.kind === ts.SyntaxKind.ThisKeyword &&
				ts.isBinaryExpression(assignment) &&
				assignment.left === propertyAccess &&
				assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				assignment.parent === constructors[0]?.body?.statements[2];
			if (!isAuditedConstructorAssignment) {
				hasCapabilitiesReference = true;
			}
		}
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.text === "allowsMutationDispatch"
		) {
			mutationDispatchReferences += 1;
		}
		if (isThisBridge(node)) {
			const constructorAssignment = constructors[0]?.body?.statements[0];
			const isConstructorAssignment =
				ts.isExpressionStatement(constructorAssignment) &&
				ts.isBinaryExpression(constructorAssignment.expression) &&
				constructorAssignment.expression.left === node;
			if (isConstructorAssignment) {
				ts.forEachChild(node, visit);
				return;
			}
			const methodAccess = node.parent;
			const directCall =
				ts.isPropertyAccessExpression(methodAccess) &&
				methodAccess.expression === node &&
				ts.isCallExpression(methodAccess.parent) &&
				methodAccess.parent.expression === methodAccess
					? methodAccess.parent
					: undefined;
			const methodName =
				directCall === undefined ? undefined : methodAccess.name.text;
			if (methodName === undefined || !expectedBridgeMethods.has(methodName)) {
				failures.push(
					"every this.#bridge reference must be the receiver of one fixed direct provider call",
				);
			} else {
				bridgeMethodCounts.set(
					methodName,
					bridgeMethodCounts.get(methodName) + 1,
				);
			}
		}
		if (
			isProviderDescendant(node) &&
			ts.isPropertyAccessExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ThisKeyword &&
			forbiddenInternalMutationSeams.has(node.name.text)
		) {
			failures.push(
				"Plain workspace provider methods must not internally consume dormant mutation seams",
			);
		}
		if (
			isProviderDescendant(node) &&
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
		) {
			if (node.expression.name.text === "fireCreated") {
				fireCreatedCallCount += 1;
			}
			if (node.expression.name.text === "fireDeleted") {
				fireDeletedCallCount += 1;
			}
			if (node.expression.name.text === "fireMoved") {
				fireMovedCallCount += 1;
			}
			if (node.expression.name.text === "fireRootUpdated") {
				fireRootUpdatedCallCount += 1;
			}
			if (node.expression.name.text === "fireRootsUpdated") {
				fireRootsUpdatedCallCount += 1;
			}
		}
		if (
			isProviderDescendant(node) &&
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "fire" &&
			ts.isPropertyAccessExpression(node.expression.expression) &&
			node.expression.expression.expression.kind ===
				ts.SyntaxKind.ThisKeyword &&
			node.expression.expression.name.text === "changeEmitter"
		) {
			changeEmitterFireCallCount += 1;
		}
		if (
			ts.isIdentifier(node) &&
			protectedFunctionReferences.has(node.text) &&
			!bindingIdentifierNodes.has(node)
		) {
			const isDirectCall =
				ts.isCallExpression(node.parent) && node.parent.expression === node;
			if (!isDirectCall) {
				failures.push(
					`${node.text} must not be reassigned, aliased or consumed outside its audited direct calls`,
				);
			} else {
				protectedFunctionCallCounts.set(
					node.text,
					protectedFunctionCallCounts.get(node.text) + 1,
				);
			}
		}
		if (
			ts.isIdentifier(node) &&
			(node.text === "WorkspaceMoveIncompleteError" ||
				node.text === "WorkspaceMoveOutcomeUnknownError") &&
			!bindingIdentifierNodes.has(node)
		) {
			const isTypeReference = isCriticalTypeReference(node);
			const isDirectConstruction =
				ts.isNewExpression(node.parent) && node.parent.expression === node;
			if (isDirectConstruction) {
				if (node.text === "WorkspaceMoveIncompleteError") {
					moveIncompleteConstructionCount += 1;
				} else {
					moveOutcomeUnknownConstructionCount += 1;
				}
			} else if (!isTypeReference) {
				failures.push(
					`${node.text} must not be aliased or consumed outside its audited constructor`,
				);
			}
		}
		if (isProviderDescendant(node) && node.kind === ts.SyntaxKind.ThisKeyword) {
			const parent = node.parent;
			if (
				!isAuditedProviderInstanceFreezeThis(node) &&
				(!ts.isPropertyAccessExpression(parent) ||
					parent.expression !== node ||
					!expectedProviderMembers.has(parent.name.text))
			) {
				failures.push(
					"Plain workspace provider must not alias this or access inherited/computed mutation surfaces",
				);
			}
		}
		if (
			isProviderDescendant(node) &&
			ts.isIdentifier(node) &&
			node.text === "bridge"
		) {
			const isConstructorParameter =
				constructors[0]?.parameters[0]?.name === node;
			const constructorAssignment = constructors[0]?.body?.statements[0];
			const isConstructorAssignmentValue =
				ts.isExpressionStatement(constructorAssignment) &&
				ts.isBinaryExpression(constructorAssignment.expression) &&
				constructorAssignment.expression.right === node;
			if (!isConstructorParameter && !isConstructorAssignmentValue) {
				failures.push(
					"Plain workspace provider must not alias, destructure or synthesize its native bridge",
				);
			}
		}
		if (
			isProviderDescendant(node) &&
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			node.text === "bridge"
		) {
			failures.push(
				"Plain workspace provider must not alias, destructure or synthesize its native bridge",
			);
		}
		if (
			ts.isIdentifier(node) &&
			criticalBindingNames.has(node.text) &&
			!bindingIdentifierNodes.has(node) &&
			!(
				ts.isImportSpecifier(node.parent) && node.parent.propertyName === node
			) &&
			!isCriticalTypeReference(node)
		) {
			const isAllowedPropertyReceiver =
				criticalPropertyBindings.has(node.text) &&
				ts.isPropertyAccessExpression(node.parent) &&
				node.parent.expression === node;
			const isAllowedDirectCall =
				criticalCallBindings.has(node.text) &&
				ts.isCallExpression(node.parent) &&
				node.parent.expression === node;
			const isAllowedDirectConstruction =
				criticalNewBindings.has(node.text) &&
				ts.isNewExpression(node.parent) &&
				node.parent.expression === node;
			if (
				!isAllowedPropertyReceiver &&
				!isAllowedDirectCall &&
				!isAllowedDirectConstruction
			) {
				failures.push(
					`${node.text} must not be aliased or consumed outside its fixed provider role`,
				);
			}
		}
		if (
			ts.isIdentifier(node) &&
			(node.text === "Object" || node.text === "Reflect")
		) {
			const access = node.parent;
			const allowedMethods =
				node.text === "Object"
					? new Set(["freeze", "getPrototypeOf", "getOwnPropertyDescriptors"])
					: new Set(["get", "ownKeys"]);
			const isAuditedObjectPrototype =
				node.text === "Object" &&
				ts.isPropertyAccessExpression(access) &&
				access.expression === node &&
				access.name.text === "prototype";
			if (
				!isAuditedObjectPrototype &&
				(!ts.isPropertyAccessExpression(access) ||
					access.expression !== node ||
					!allowedMethods.has(access.name.text) ||
					!ts.isCallExpression(access.parent) ||
					access.parent.expression !== access)
			) {
				failures.push(
					`${node.text} may be used only through its audited direct intrinsic calls`,
				);
			}
		}
		if (
			ts.isBinaryExpression(node) &&
			isAssignmentOperator(node.operatorToken.kind) &&
			immutableRuntimeRoots.has(runtimeRootName(node.left))
		) {
			failures.push(
				"Plain workspace provider must not mutate critical runtime bindings",
			);
		}
		if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
			(node.operator === ts.SyntaxKind.PlusPlusToken ||
				node.operator === ts.SyntaxKind.MinusMinusToken) &&
			immutableRuntimeRoots.has(runtimeRootName(node.operand))
		) {
			failures.push(
				"Plain workspace provider must not mutate critical runtime bindings",
			);
		}
		if (
			ts.isDeleteExpression(node) &&
			immutableRuntimeRoots.has(runtimeRootName(node.expression))
		) {
			failures.push(
				"Plain workspace provider must not mutate critical runtime bindings",
			);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const receiver = node.expression.expression;
			const method = node.expression.name.text;
			const mutatesFirstArgument =
				(ts.isIdentifier(receiver) &&
					receiver.text === "Object" &&
					["assign", "defineProperty", "setPrototypeOf"].includes(method)) ||
				(ts.isIdentifier(receiver) &&
					receiver.text === "Reflect" &&
					["set", "defineProperty", "setPrototypeOf"].includes(method));
			if (
				mutatesFirstArgument &&
				node.arguments[0] !== undefined &&
				immutableRuntimeRoots.has(runtimeRootName(node.arguments[0]))
			) {
				failures.push(
					"Plain workspace provider must not mutate critical runtime bindings",
				);
			}
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			auditedMutationBridgeNames.has(node.name.text)
		) {
			const isDirectBridgeCall =
				ts.isCallExpression(node.parent) &&
				node.parent.expression === node &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
				ts.isPrivateIdentifier(node.expression.name) &&
				node.expression.name.text === "#bridge";
			if (!isDirectBridgeCall) {
				failures.push(
					`${node.name.text} may appear only as a direct this.#bridge call in its audited mutation seam`,
				);
			}
			switch (node.name.text) {
				case "workspaceCreateFile":
					createFileBridgeReferences += 1;
					break;
				case "workspaceCreateDirectory":
					createDirectoryBridgeReferences += 1;
					break;
				case "workspaceCopy":
					copyBridgeReferences += 1;
					break;
				case "workspaceRename":
					renameBridgeReferences += 1;
					break;
				case "workspaceMove":
					moveBridgeReferences += 1;
					break;
				case "workspaceCommitDeleteEntry":
					deleteBridgeReferences += 1;
					break;
			}
		}
		if (
			ts.isIdentifier(node) &&
			auditedMutationBridgeNames.has(node.text) &&
			!(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
		) {
			failures.push(
				`${node.text} must not be aliased, destructured or referenced outside its direct provider call`,
			);
		}
		if (
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			auditedMutationBridgeNames.has(node.text)
		) {
			failures.push(
				`${node.text} must not be accessed through computed provider syntax`,
			);
		}
		if (
			(ts.isElementAccessExpression(node) && isThisBridge(node.expression)) ||
			(ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isIdentifier(node.expression.expression) &&
				node.expression.expression.text === "Reflect" &&
				node.expression.name.text === "get" &&
				node.arguments[0] !== undefined &&
				isThisBridge(node.arguments[0])) ||
			(ts.isVariableDeclaration(node) &&
				node.initializer !== undefined &&
				isThisBridge(node.initializer))
		) {
			failures.push(
				"Plain workspace provider must not alias or dynamically access its native bridge",
			);
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	if (hasExtraProviderReference) {
		failures.push(
			"PlainWorkspaceFileSystemProvider may be referenced only by its declaration, prototype freeze and audited factory",
		);
	}
	if (hasUnexpectedPrivateIdentifier) {
		failures.push(
			"Plain workspace provider may declare and consume only its audited #bridge and #allowsMutationDispatch private fields",
		);
	}
	if (hasPrototypeMutationSurface) {
		failures.push(
			"Plain workspace provider must not expose prototype mutation references",
		);
	}
	if (objectPrototypeReferences !== 2) {
		failures.push(
			"Plain workspace provider may read Object.prototype only in the two audited own-data authenticators",
		);
	}
	if (localPrototypeReferences !== 6) {
		failures.push(
			"prototype identifiers may appear only in the two audited own-data authenticators",
		);
	}
	if (hasDynamicMutationSurface) {
		failures.push(
			"Plain workspace provider must not use defineProperty or Proxy mutation surfaces",
		);
	}
	if (hasCapabilitiesReference) {
		failures.push(
			"Plain workspace provider capabilities may appear only in their readonly declaration and constructor assignment",
		);
	}
	if ([...capabilityFlagReferences.values()].some((count) => count !== 1)) {
		failures.push(
			"Plain workspace provider must reference FileReadWrite, FileFolderCopy and Readonly exactly once in the final capability assignment",
		);
	}
	if (mutationDispatchReferences !== 3) {
		failures.push(
			"Plain workspace mutation boolean parameter may appear only in its declaration, private-field assignment and capability condition",
		);
	}
	if (
		privateBridgeReferences !== 14 ||
		privatePolicyReferences !== 3 ||
		privateWatchStateReferences !== 7
	) {
		failures.push(
			"Plain workspace native authority must remain sealed in the exact #bridge, #allowsMutationDispatch and #watchState private-field consumers",
		);
	}
	if (
		createFileBridgeReferences !== 1 ||
		createDirectoryBridgeReferences !== 1 ||
		copyBridgeReferences !== 1 ||
		renameBridgeReferences !== 1 ||
		moveBridgeReferences !== 1 ||
		deleteBridgeReferences !== 1
	) {
		failures.push(
			"Plain workspace mutation bridges must each have exactly one direct provider call site",
		);
	}
	for (const [methodName, expectedCount] of expectedBridgeMethods) {
		if (bridgeMethodCounts.get(methodName) !== expectedCount) {
			failures.push(
				`${methodName} must have exactly ${expectedCount} fixed direct this.#bridge call site(s)`,
			);
		}
	}
	for (const [functionName, expectedCount] of protectedFunctionReferences) {
		if (protectedFunctionCallCounts.get(functionName) !== expectedCount) {
			failures.push(
				`${functionName} must have exactly ${expectedCount} audited direct call sites`,
			);
		}
	}
	if (moveIncompleteConstructionCount !== 1) {
		failures.push(
			"WorkspaceMoveIncompleteError must have exactly one audited direct construction",
		);
	}
	if (moveOutcomeUnknownConstructionCount !== 1) {
		failures.push(
			"WorkspaceMoveOutcomeUnknownError must have exactly one audited direct construction",
		);
	}
	if (
		fireCreatedCallCount !== 4 ||
		fireDeletedCallCount !== 2 ||
		fireMovedCallCount !== 2 ||
		fireRootUpdatedCallCount !== 8 ||
		fireRootsUpdatedCallCount !== 2 ||
		changeEmitterFireCallCount !== 7
	) {
		failures.push(
			"provider change events must remain confined to the audited create, copy, rename, move and rescan closure",
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks the browser-only retained/partial move fixture to two local scenarios.
 * The fixture may shape only the addInitScript closure; production code and the
 * page window never receive a mutable failure-plan control surface.
 */
export function validateWorkspaceMoveFailureBrowserFixture(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"tests/browser/workspace.spec.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const normalizedText = (node) => {
		if (node === undefined) {
			return undefined;
		}
		const scanner = ts.createScanner(
			ts.ScriptTarget.Latest,
			true,
			ts.LanguageVariant.Standard,
			node.getText(sourceFile),
		);
		let compact = "";
		for (
			let token = scanner.scan();
			token !== ts.SyntaxKind.EndOfFileToken;
			token = scanner.scan()
		) {
			compact += scanner.getTokenText();
		}
		return compact;
	};
	const collect = (root, predicate) => {
		const matches = [];
		function visit(node) {
			if (predicate(node)) {
				matches.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(root);
		return matches;
	};
	const countIdentifier = (root, name) =>
		collect(root, (node) => ts.isIdentifier(node) && node.text === name).length;

	const scenarioAliases = sourceFile.statements.filter(
		(statement) =>
			ts.isTypeAliasDeclaration(statement) &&
			statement.name.text === "TestMultiRootMoveIncompleteScenario",
	);
	let scenarioAliasIsClosed = false;
	if (scenarioAliases.length === 1) {
		const [alias] = scenarioAliases;
		const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [];
		const values = members.map((member) =>
			ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
				? member.literal.text
				: undefined,
		);
		scenarioAliasIsClosed =
			(alias.modifiers?.length ?? 0) === 0 &&
			members.length === 2 &&
			sameArray([...values].sort(), ["movePartial", "moveRetained"]);
	}
	if (!scenarioAliasIsClosed) {
		failures.push(
			"browser move-failure fixture third argument must remain the closed moveRetained/movePartial scenario set",
		);
	}

	const installers = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "installMultiRootNativeIpcMock",
	);
	if (installers.length !== 1) {
		return [
			...failures,
			"browser move-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		];
	}
	const [installer] = installers;
	const [
		pageParameter,
		modeParameter,
		scenarioParameter,
		deleteScenarioParameter,
	] = installer.parameters;
	const scenarioArrayType =
		scenarioParameter?.type !== undefined &&
		ts.isTypeOperatorNode(scenarioParameter.type) &&
		scenarioParameter.type.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isArrayTypeNode(scenarioParameter.type.type)
			? scenarioParameter.type.type
			: undefined;
	const scenarioElementType = scenarioArrayType?.elementType;
	const deleteScenarioArrayType =
		deleteScenarioParameter?.type !== undefined &&
		ts.isTypeOperatorNode(deleteScenarioParameter.type) &&
		deleteScenarioParameter.type.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isArrayTypeNode(deleteScenarioParameter.type.type)
			? deleteScenarioParameter.type.type
			: undefined;
	const deleteScenarioElementType = deleteScenarioArrayType?.elementType;
	const returnType = installer.type;
	const signatureIsExact =
		installer.modifiers?.length === 1 &&
		installer.modifiers[0].kind === ts.SyntaxKind.AsyncKeyword &&
		installer.parameters.length === 4 &&
		pageParameter !== undefined &&
		ts.isIdentifier(pageParameter.name) &&
		pageParameter.name.text === "page" &&
		normalizedText(pageParameter.type) === "Page" &&
		pageParameter.initializer === undefined &&
		modeParameter !== undefined &&
		ts.isIdentifier(modeParameter.name) &&
		modeParameter.name.text === "mode" &&
		normalizedText(modeParameter.type) === "NativeIpcMockMode" &&
		normalizedText(modeParameter.initializer) === '"readonly"' &&
		scenarioParameter !== undefined &&
		ts.isIdentifier(scenarioParameter.name) &&
		scenarioParameter.name.text === "moveIncompleteScenarios" &&
		scenarioElementType !== undefined &&
		ts.isTypeReferenceNode(scenarioElementType) &&
		ts.isIdentifier(scenarioElementType.typeName) &&
		scenarioElementType.typeName.text ===
			"TestMultiRootMoveIncompleteScenario" &&
		scenarioElementType.typeArguments === undefined &&
		scenarioParameter.initializer !== undefined &&
		ts.isArrayLiteralExpression(scenarioParameter.initializer) &&
		scenarioParameter.initializer.elements.length === 0 &&
		deleteScenarioParameter !== undefined &&
		ts.isIdentifier(deleteScenarioParameter.name) &&
		deleteScenarioParameter.name.text === "deleteIncompleteScenarios" &&
		deleteScenarioElementType !== undefined &&
		ts.isTypeReferenceNode(deleteScenarioElementType) &&
		ts.isIdentifier(deleteScenarioElementType.typeName) &&
		deleteScenarioElementType.typeName.text ===
			"TestMultiRootDeleteIncompleteScenario" &&
		deleteScenarioElementType.typeArguments === undefined &&
		deleteScenarioParameter.initializer !== undefined &&
		ts.isArrayLiteralExpression(deleteScenarioParameter.initializer) &&
		deleteScenarioParameter.initializer.elements.length === 0 &&
		returnType !== undefined &&
		ts.isTypeReferenceNode(returnType) &&
		ts.isIdentifier(returnType.typeName) &&
		returnType.typeName.text === "Promise" &&
		returnType.typeArguments?.length === 1 &&
		returnType.typeArguments[0].kind === ts.SyntaxKind.VoidKeyword;
	if (!signatureIsExact) {
		failures.push(
			"browser move-failure fixture third argument must remain the closed moveRetained/movePartial scenario set",
		);
	}

	const [onlyStatement] = installer.body?.statements ?? [];
	const awaited =
		installer.body?.statements.length === 1 &&
		onlyStatement !== undefined &&
		ts.isExpressionStatement(onlyStatement) &&
		ts.isAwaitExpression(onlyStatement.expression)
			? onlyStatement.expression.expression
			: undefined;
	const addInitScriptCall =
		awaited !== undefined &&
		ts.isCallExpression(awaited) &&
		ts.isPropertyAccessExpression(awaited.expression) &&
		ts.isIdentifier(awaited.expression.expression) &&
		awaited.expression.expression.text === "page" &&
		awaited.expression.name.text === "addInitScript" &&
		awaited.arguments.length === 2
			? awaited
			: undefined;
	const callback =
		addInitScriptCall !== undefined &&
		ts.isArrowFunction(addInitScriptCall.arguments[0])
			? addInitScriptCall.arguments[0]
			: undefined;
	const callbackParameter = callback?.parameters[0];
	const callbackBindings =
		callback?.parameters.length === 1 &&
		callbackParameter !== undefined &&
		ts.isObjectBindingPattern(callbackParameter.name)
			? callbackParameter.name.elements.map((element) => ({
					name: typeScriptStaticName(element.name),
					property: typeScriptStaticName(element.propertyName ?? element.name),
				}))
			: [];
	const callbackBindingsAreExact = sameArray(callbackBindings, [
		{ name: "mode", property: "mode" },
		{
			name: "moveIncompleteScenarios",
			property: "moveIncompleteScenarios",
		},
		{
			name: "deleteIncompleteScenarios",
			property: "deleteIncompleteScenarios",
		},
		{ name: "workspaceId", property: "workspaceId" },
		{ name: "primaryRootId", property: "primaryRootId" },
		{ name: "secondaryRootId", property: "secondaryRootId" },
	]);
	const initData = addInitScriptCall?.arguments[1];
	const initDataIsExact =
		initData !== undefined &&
		ts.isObjectLiteralExpression(initData) &&
		normalizedText(initData) ===
			"{mode,moveIncompleteScenarios,deleteIncompleteScenarios,workspaceId:nativeWorkspaceId,primaryRootId:nativeRootId,secondaryRootId:nativeSecondaryRootId,}";
	const scenarioReferenceCount = countIdentifier(
		installer,
		"moveIncompleteScenarios",
	);
	if (
		callback === undefined ||
		!ts.isBlock(callback.body) ||
		!callbackBindingsAreExact ||
		!initDataIsExact ||
		scenarioReferenceCount !== 5
	) {
		failures.push(
			"browser move-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		);
	}
	if (callback === undefined || !ts.isBlock(callback.body)) {
		return [...new Set(failures)];
	}

	const planDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "moveIncompletePlan",
	);
	const partialTreeInitializers = collect(
		callback.body,
		(node) =>
			ts.isIfStatement(node) &&
			normalizedText(node) ===
				'if(moveIncompleteScenarios.includes("movePartial")){secondaryEntries.push(["move-partial",directory([["removed.txt",file("Remove this source child.\\n")],["kept.txt",file("Keep this source child.\\n")],]),]);}',
	);
	if (
		planDeclarations.length !== 1 ||
		normalizedText(planDeclarations[0]) !==
			"moveIncompletePlan=[...moveIncompleteScenarios]" ||
		partialTreeInitializers.length !== 1
	) {
		failures.push(
			"browser move-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		);
	}

	const moveCases = collect(
		callback.body,
		(node) =>
			ts.isCaseClause(node) &&
			ts.isStringLiteral(node.expression) &&
			node.expression.text === "workspace_move",
	);
	if (moveCases.length !== 1) {
		return [
			...new Set([
				...failures,
				"browser move-failure fixture must retain exact cross-root request validation",
			]),
		];
	}
	const [moveCase] = moveCases;
	const ifStatements = collect(moveCase, (node) => ts.isIfStatement(node));
	const retainedRequest = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedIncomplete==="moveRetained"&&(request.sourceRootId!==secondaryRootId||request.sourcePath!=="move-source.txt"||request.targetRootId!==primaryRootId||request.targetPath!=="src/move-source.txt")){thrownewError("Unexpected retained move browser test request.",);}',
	);
	const partialRequest = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedIncomplete==="movePartial"&&(request.sourceRootId!==secondaryRootId||request.sourcePath!=="move-partial"||request.targetRootId!==primaryRootId||request.targetPath!=="src/move-partial")){thrownewError("Unexpected partial move browser test request.",);}',
	);
	if (retainedRequest.length !== 1 || partialRequest.length !== 1) {
		failures.push(
			"browser move-failure fixture must retain exact cross-root request validation",
		);
	}

	const publicationStatements = collect(
		moveCase,
		(node) =>
			ts.isExpressionStatement(node) &&
			normalizedText(node) ===
				"target.parent.entries.set(target.name,reboundNode);",
	);
	const retainedBranches = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedIncomplete==="moveRetained"){moveIncompletePlan.shift();return{status:"targetPublishedSourceRetained",reason:"deleteFailed",};}',
	);
	const partialBranches = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedIncomplete==="movePartial"){if(node.kind!=="directory"){throwentryTypeMismatch();}constremovedEntries=node.entries.delete("removed.txt")?1:0;if(removedEntries!==1||!node.entries.has("kept.txt")){thrownewError("Invalid partial move browser test source tree.",);}moveIncompletePlan.shift();return{status:"targetPublishedSourcePartiallyDeleted",reason:"deleteFailed",removedEntries,};}',
	);
	if (
		publicationStatements.length !== 1 ||
		retainedBranches.length !== 1 ||
		partialBranches.length !== 1 ||
		publicationStatements[0].getStart(sourceFile) >=
			retainedBranches[0].getStart(sourceFile) ||
		retainedBranches[0].getStart(sourceFile) >=
			partialBranches[0].getStart(sourceFile)
	) {
		failures.push(
			"browser move-failure fixture must publish the target before its ordered terminal scenario branches",
		);
	}
	if (retainedBranches.length !== 1) {
		failures.push(
			"browser retained-move fixture must leave the source untouched and return only its fixed receipt",
		);
	}
	if (partialBranches.length !== 1) {
		failures.push(
			"browser partial-move fixture must delete removed.txt and derive removedEntries from that boolean result",
		);
	}

	const movePlanReferences = countIdentifier(
		callback.body,
		"moveIncompletePlan",
	);
	const callbackScenarioReferences = countIdentifier(
		callback.body,
		"moveIncompleteScenarios",
	);
	// `forbiddenWindowControls` only catches receivers that are literally
	// `window`/`testWindow` after unwrapping property chains; it is kept as
	// defense in depth, but `validateWorkspaceBrowserFixtureWindowAuthority`
	// is what actually closes the window-alias gap (see that function's
	// JSDoc) by locking down every way the callback can reach the page
	// window at all.
	const forbiddenWindowControls = collect(callback.body, (node) => {
		if (
			!ts.isPropertyAccessExpression(node) &&
			!ts.isElementAccessExpression(node)
		) {
			return false;
		}
		const name = ts.isPropertyAccessExpression(node)
			? node.name.text
			: typeScriptStaticName(node.argumentExpression);
		if (
			name === undefined ||
			!/(?:move.*(?:failure|incomplete|scenario|status|reason|count)|(?:failure|incomplete|scenario).*move)/iu.test(
				name,
			)
		) {
			return false;
		}
		let receiver = node.expression;
		while (
			ts.isPropertyAccessExpression(receiver) ||
			ts.isElementAccessExpression(receiver)
		) {
			receiver = receiver.expression;
		}
		return (
			ts.isIdentifier(receiver) &&
			(receiver.text === "window" || receiver.text === "testWindow")
		);
	});
	if (
		movePlanReferences !== 4 ||
		callbackScenarioReferences !== 2 ||
		forbiddenWindowControls.length !== 0
	) {
		failures.push(
			"browser move-failure fixture must not accept raw receipt fields or expose a window mutation control",
		);
	}

	const peekDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "plannedIncomplete",
	);
	const peekStatementIsExact =
		peekDeclarations.length === 1 &&
		normalizedText(peekDeclarations[0].parent.parent) ===
			"constplannedIncomplete=moveIncompletePlan[0];";
	if (!peekStatementIsExact) {
		failures.push(
			"browser move-failure fixture must peek moveIncompletePlan[0] through one audited statement",
		);
	}

	const movePlanAuditedRanges = [
		planDeclarations[0]?.parent?.parent,
		peekDeclarations[0]?.parent?.parent,
		retainedBranches[0],
		partialBranches[0],
	]
		.filter((node) => node !== undefined)
		.map((node) => [node.getStart(sourceFile), node.getEnd()]);
	const movePlanReferenceNodes = collect(
		callback.body,
		(node) => ts.isIdentifier(node) && node.text === "moveIncompletePlan",
	);
	const movePlanReferencesOutOfRange = movePlanReferenceNodes.some(
		(node) =>
			!movePlanAuditedRanges.some(
				([start, end]) =>
					node.getStart(sourceFile) >= start && node.getEnd() <= end,
			),
	);
	if (movePlanAuditedRanges.length !== 4 || movePlanReferencesOutOfRange) {
		failures.push(
			"browser move-failure fixture must keep moveIncompletePlan references inside its audited plan, peek and terminal branch statements",
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks the browser-only retained/partial permanent delete fixture to two
 * local scenarios. The fixture may shape only the addInitScript closure that
 * `validateWorkspaceMoveFailureBrowserFixture` also audits; production code
 * and the page window never receive a mutable failure-plan control surface.
 */
export function validateWorkspaceDeleteFailureBrowserFixture(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"tests/browser/workspace.spec.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const normalizedText = (node) => {
		if (node === undefined) {
			return undefined;
		}
		const scanner = ts.createScanner(
			ts.ScriptTarget.Latest,
			true,
			ts.LanguageVariant.Standard,
			node.getText(sourceFile),
		);
		let compact = "";
		for (
			let token = scanner.scan();
			token !== ts.SyntaxKind.EndOfFileToken;
			token = scanner.scan()
		) {
			compact += scanner.getTokenText();
		}
		return compact;
	};
	const collect = (root, predicate) => {
		const matches = [];
		function visit(node) {
			if (predicate(node)) {
				matches.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(root);
		return matches;
	};
	const countIdentifier = (root, name) =>
		collect(root, (node) => ts.isIdentifier(node) && node.text === name).length;

	const scenarioAliases = sourceFile.statements.filter(
		(statement) =>
			ts.isTypeAliasDeclaration(statement) &&
			statement.name.text === "TestMultiRootDeleteIncompleteScenario",
	);
	let scenarioAliasIsClosed = false;
	if (scenarioAliases.length === 1) {
		const [alias] = scenarioAliases;
		const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [];
		const values = members.map((member) =>
			ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)
				? member.literal.text
				: undefined,
		);
		scenarioAliasIsClosed =
			(alias.modifiers?.length ?? 0) === 0 &&
			members.length === 2 &&
			sameArray([...values].sort(), ["deletePartial", "deleteRetained"]);
	}
	if (!scenarioAliasIsClosed) {
		failures.push(
			"browser delete-failure fixture fourth argument must remain the closed deleteRetained/deletePartial scenario set",
		);
	}

	const installers = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "installMultiRootNativeIpcMock",
	);
	if (installers.length !== 1) {
		return [
			...failures,
			"browser delete-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		];
	}
	const [installer] = installers;
	const [, , , deleteScenarioParameter] = installer.parameters;
	const deleteScenarioArrayType =
		deleteScenarioParameter?.type !== undefined &&
		ts.isTypeOperatorNode(deleteScenarioParameter.type) &&
		deleteScenarioParameter.type.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isArrayTypeNode(deleteScenarioParameter.type.type)
			? deleteScenarioParameter.type.type
			: undefined;
	const deleteScenarioElementType = deleteScenarioArrayType?.elementType;
	const signatureIsExact =
		installer.parameters.length === 4 &&
		deleteScenarioParameter !== undefined &&
		ts.isIdentifier(deleteScenarioParameter.name) &&
		deleteScenarioParameter.name.text === "deleteIncompleteScenarios" &&
		deleteScenarioElementType !== undefined &&
		ts.isTypeReferenceNode(deleteScenarioElementType) &&
		ts.isIdentifier(deleteScenarioElementType.typeName) &&
		deleteScenarioElementType.typeName.text ===
			"TestMultiRootDeleteIncompleteScenario" &&
		deleteScenarioElementType.typeArguments === undefined &&
		deleteScenarioParameter.initializer !== undefined &&
		ts.isArrayLiteralExpression(deleteScenarioParameter.initializer) &&
		deleteScenarioParameter.initializer.elements.length === 0;
	if (!signatureIsExact) {
		failures.push(
			"browser delete-failure fixture fourth argument must remain the closed deleteRetained/deletePartial scenario set",
		);
	}

	const [onlyStatement] = installer.body?.statements ?? [];
	const awaited =
		installer.body?.statements.length === 1 &&
		onlyStatement !== undefined &&
		ts.isExpressionStatement(onlyStatement) &&
		ts.isAwaitExpression(onlyStatement.expression)
			? onlyStatement.expression.expression
			: undefined;
	const addInitScriptCall =
		awaited !== undefined &&
		ts.isCallExpression(awaited) &&
		ts.isPropertyAccessExpression(awaited.expression) &&
		ts.isIdentifier(awaited.expression.expression) &&
		awaited.expression.expression.text === "page" &&
		awaited.expression.name.text === "addInitScript" &&
		awaited.arguments.length === 2
			? awaited
			: undefined;
	const callback =
		addInitScriptCall !== undefined &&
		ts.isArrowFunction(addInitScriptCall.arguments[0])
			? addInitScriptCall.arguments[0]
			: undefined;
	const callbackParameter = callback?.parameters[0];
	const callbackBindings =
		callback?.parameters.length === 1 &&
		callbackParameter !== undefined &&
		ts.isObjectBindingPattern(callbackParameter.name)
			? callbackParameter.name.elements.map((element) => ({
					name: typeScriptStaticName(element.name),
					property: typeScriptStaticName(element.propertyName ?? element.name),
				}))
			: [];
	const callbackBindingsAreExact = sameArray(callbackBindings, [
		{ name: "mode", property: "mode" },
		{
			name: "moveIncompleteScenarios",
			property: "moveIncompleteScenarios",
		},
		{
			name: "deleteIncompleteScenarios",
			property: "deleteIncompleteScenarios",
		},
		{ name: "workspaceId", property: "workspaceId" },
		{ name: "primaryRootId", property: "primaryRootId" },
		{ name: "secondaryRootId", property: "secondaryRootId" },
	]);
	const initData = addInitScriptCall?.arguments[1];
	const initDataIsExact =
		initData !== undefined &&
		ts.isObjectLiteralExpression(initData) &&
		normalizedText(initData) ===
			"{mode,moveIncompleteScenarios,deleteIncompleteScenarios,workspaceId:nativeWorkspaceId,primaryRootId:nativeRootId,secondaryRootId:nativeSecondaryRootId,}";
	const scenarioReferenceCount = countIdentifier(
		installer,
		"deleteIncompleteScenarios",
	);
	if (
		callback === undefined ||
		!ts.isBlock(callback.body) ||
		!callbackBindingsAreExact ||
		!initDataIsExact ||
		scenarioReferenceCount !== 6
	) {
		failures.push(
			"browser delete-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		);
	}
	if (callback === undefined || !ts.isBlock(callback.body)) {
		return [...new Set(failures)];
	}

	const planDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "deleteIncompletePlan",
	);
	const retainedTreeInitializers = collect(
		callback.body,
		(node) =>
			ts.isIfStatement(node) &&
			normalizedText(node) ===
				'if(deleteIncompleteScenarios.includes("deleteRetained")){primaryEntries.push(["delete-retained.txt",file("Retain this delete target.\\n"),]);}',
	);
	const partialTreeInitializers = collect(
		callback.body,
		(node) =>
			ts.isIfStatement(node) &&
			normalizedText(node) ===
				'if(deleteIncompleteScenarios.includes("deletePartial")){secondaryEntries.push(["delete-partial",directory([["removed.txt",file("Remove this delete child.\\n")],["kept.txt",file("Keep this delete child.\\n")],]),]);}',
	);
	// The shared fixture also seeds a movePartial secondaryEntries branch for
	// validateWorkspaceMoveFailureBrowserFixture; this validator locks it too
	// because the tree-seed reference range lock below audits every
	// primaryEntries/secondaryEntries reference in the whole shared callback,
	// not only the delete-related ones.
	const movePartialTreeInitializers = collect(
		callback.body,
		(node) =>
			ts.isIfStatement(node) &&
			normalizedText(node) ===
				'if(moveIncompleteScenarios.includes("movePartial")){secondaryEntries.push(["move-partial",directory([["removed.txt",file("Remove this source child.\\n")],["kept.txt",file("Keep this source child.\\n")],]),]);}',
	);
	const primaryEntriesDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "primaryEntries",
	);
	const secondaryEntriesDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "secondaryEntries",
	);
	const treesDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "trees",
	);
	if (
		planDeclarations.length !== 1 ||
		normalizedText(planDeclarations[0]) !==
			"deleteIncompletePlan=[...deleteIncompleteScenarios]" ||
		retainedTreeInitializers.length !== 1 ||
		partialTreeInitializers.length !== 1 ||
		movePartialTreeInitializers.length !== 1 ||
		primaryEntriesDeclarations.length !== 1 ||
		secondaryEntriesDeclarations.length !== 1 ||
		treesDeclarations.length !== 1 ||
		normalizedText(primaryEntriesDeclarations[0].parent.parent) !==
			'constprimaryEntries:Array<readonly[string,MockNode]>=[["README.md",file("# Primary workspace\\n")],["copy-source.txt",file("Copy across roots.\\n")],["src",directory([])],];' ||
		normalizedText(secondaryEntriesDeclarations[0].parent.parent) !==
			'constsecondaryEntries:Array<readonly[string,MockNode]>=[["move-source.txt",file("Move across roots.\\n")],["notes.txt",file("Secondary workspace\\n")],["packages",directory([])],];' ||
		normalizedText(treesDeclarations[0].parent.parent) !==
			"consttrees=newMap<string,MockDirectory>([[primaryRootId,directory(primaryEntries)],[secondaryRootId,directory(secondaryEntries)],]);"
	) {
		failures.push(
			"browser delete-failure scenarios must remain local to one audited multi-root addInitScript fixture",
		);
	}

	const treeSeedAuditedRanges = [
		primaryEntriesDeclarations[0]?.parent?.parent,
		secondaryEntriesDeclarations[0]?.parent?.parent,
		movePartialTreeInitializers[0],
		retainedTreeInitializers[0],
		partialTreeInitializers[0],
		treesDeclarations[0]?.parent?.parent,
	]
		.filter((node) => node !== undefined)
		.map((node) => [node.getStart(sourceFile), node.getEnd()]);
	const treeSeedReferenceNodes = collect(
		callback.body,
		(node) =>
			ts.isIdentifier(node) &&
			(node.text === "primaryEntries" || node.text === "secondaryEntries"),
	);
	const treeSeedReferencesOutOfRange = treeSeedReferenceNodes.some(
		(node) =>
			!treeSeedAuditedRanges.some(
				([start, end]) =>
					node.getStart(sourceFile) >= start && node.getEnd() <= end,
			),
	);
	if (treeSeedAuditedRanges.length !== 6 || treeSeedReferencesOutOfRange) {
		failures.push(
			"browser delete-failure fixture must keep primaryEntries and secondaryEntries references inside their audited seed and tree-construction statements",
		);
	}

	const commitCases = collect(
		callback.body,
		(node) =>
			ts.isCaseClause(node) &&
			ts.isStringLiteral(node.expression) &&
			node.expression.text === "workspace_commit_delete_entry",
	);
	if (commitCases.length !== 1) {
		return [
			...new Set([
				...failures,
				"browser delete-failure fixture must retain exact per-entry request validation",
			]),
		];
	}
	const [commitCase] = commitCases;
	const targetDeclarations = collect(
		commitCase,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "target",
	);
	const ifStatements = collect(commitCase, (node) => ts.isIfStatement(node));
	const retainedRequest = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedDeleteIncomplete==="deleteRetained"&&(activeDelete.rootId!==primaryRootId||activeDelete.relativePath!=="delete-retained.txt")){thrownewError("Unexpected retained delete browser test request.",);}',
	);
	const partialRequest = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedDeleteIncomplete==="deletePartial"&&(activeDelete.rootId!==secondaryRootId||activeDelete.relativePath!=="delete-partial")){thrownewError("Unexpected partial delete browser test request.",);}',
	);
	if (retainedRequest.length !== 1 || partialRequest.length !== 1) {
		failures.push(
			"browser delete-failure fixture must retain exact per-entry request validation",
		);
	}

	const retainedBranches = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedDeleteIncomplete==="deleteRetained"){deleteIncompletePlan.shift();activeDelete=undefined;return{status:"entryRetained",reason:"deleteFailed"};}',
	);
	const partialBranches = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			'if(plannedDeleteIncomplete==="deletePartial"){constnode=target.parent.entries.get(target.name);if(node?.kind!=="directory"){throwentryTypeMismatch();}constremovedEntries=node.entries.delete("removed.txt")?1:0;if(removedEntries!==1||!node.entries.has("kept.txt")){thrownewError("Invalid partial delete browser test target tree.",);}deleteIncompletePlan.shift();activeDelete=undefined;return{status:"entryPartiallyDeleted",reason:"deleteFailed",removedEntries,};}',
	);
	const normalDeleteStatements = ifStatements.filter(
		(node) =>
			normalizedText(node) ===
			"if(!target.parent.entries.delete(target.name)){throwentryNotFound();}",
	);
	if (retainedBranches.length !== 1) {
		failures.push(
			"browser retained-delete fixture must leave the tree untouched and return only its fixed receipt",
		);
	}
	if (partialBranches.length !== 1) {
		failures.push(
			"browser partial-delete fixture must delete removed.txt and derive removedEntries from that boolean result",
		);
	}
	if (
		retainedRequest.length !== 1 ||
		partialRequest.length !== 1 ||
		retainedBranches.length !== 1 ||
		partialBranches.length !== 1 ||
		normalDeleteStatements.length !== 1 ||
		retainedRequest[0].getStart(sourceFile) >=
			partialRequest[0].getStart(sourceFile) ||
		partialRequest[0].getStart(sourceFile) >=
			retainedBranches[0].getStart(sourceFile) ||
		retainedBranches[0].getStart(sourceFile) >=
			partialBranches[0].getStart(sourceFile) ||
		partialBranches[0].getStart(sourceFile) >=
			normalDeleteStatements[0].getStart(sourceFile)
	) {
		failures.push(
			"browser delete-failure fixture must invalidate the active batch before its ordered terminal scenario branches",
		);
	}

	const targetAuditedRanges = [
		targetDeclarations[0]?.parent?.parent,
		partialBranches[0],
		normalDeleteStatements[0],
	]
		.filter((node) => node !== undefined)
		.map((node) => [node.getStart(sourceFile), node.getEnd()]);
	const targetReferenceNodes = collect(
		commitCase,
		(node) => ts.isIdentifier(node) && node.text === "target",
	);
	const targetReferencesOutOfRange = targetReferenceNodes.some(
		(node) =>
			!targetAuditedRanges.some(
				([start, end]) =>
					node.getStart(sourceFile) >= start && node.getEnd() <= end,
			),
	);
	if (
		targetDeclarations.length !== 1 ||
		normalizedText(targetDeclarations[0].parent.parent) !==
			"consttarget=resolveParent(activeDelete.rootId,activeDelete.relativePath,);" ||
		targetAuditedRanges.length !== 3 ||
		targetReferencesOutOfRange
	) {
		failures.push(
			"browser delete-failure fixture must keep commit-case target references inside its audited declaration and terminal branch statements",
		);
	}

	const peekDeclarations = collect(
		callback.body,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "plannedDeleteIncomplete",
	);
	const peekStatementIsExact =
		peekDeclarations.length === 1 &&
		normalizedText(peekDeclarations[0].parent.parent) ===
			"constplannedDeleteIncomplete=deleteIncompletePlan[0];";
	if (!peekStatementIsExact) {
		failures.push(
			"browser delete-failure fixture must peek deleteIncompletePlan[0] through one audited statement",
		);
	}

	const deletePlanAuditedRanges = [
		planDeclarations[0]?.parent?.parent,
		peekDeclarations[0]?.parent?.parent,
		retainedBranches[0],
		partialBranches[0],
	]
		.filter((node) => node !== undefined)
		.map((node) => [node.getStart(sourceFile), node.getEnd()]);
	const deletePlanReferenceNodes = collect(
		callback.body,
		(node) => ts.isIdentifier(node) && node.text === "deleteIncompletePlan",
	);
	const deletePlanReferencesOutOfRange = deletePlanReferenceNodes.some(
		(node) =>
			!deletePlanAuditedRanges.some(
				([start, end]) =>
					node.getStart(sourceFile) >= start && node.getEnd() <= end,
			),
	);
	if (deletePlanAuditedRanges.length !== 4 || deletePlanReferencesOutOfRange) {
		failures.push(
			"browser delete-failure fixture must keep deleteIncompletePlan references inside its audited plan, peek and terminal branch statements",
		);
	}

	const deletePlanReferences = countIdentifier(
		callback.body,
		"deleteIncompletePlan",
	);
	const callbackScenarioReferences = countIdentifier(
		callback.body,
		"deleteIncompleteScenarios",
	);
	// Kept as defense in depth; see the matching comment in
	// validateWorkspaceMoveFailureBrowserFixture and the JSDoc on
	// validateWorkspaceBrowserFixtureWindowAuthority, which is what actually
	// closes the window-alias gap this check alone cannot catch.
	const forbiddenWindowControls = collect(callback.body, (node) => {
		if (
			!ts.isPropertyAccessExpression(node) &&
			!ts.isElementAccessExpression(node)
		) {
			return false;
		}
		const name = ts.isPropertyAccessExpression(node)
			? node.name.text
			: typeScriptStaticName(node.argumentExpression);
		if (
			name === undefined ||
			!/(?:delete.*(?:failure|incomplete|scenario|status|reason|count)|(?:failure|incomplete|scenario).*delete)/iu.test(
				name,
			)
		) {
			return false;
		}
		let receiver = node.expression;
		while (
			ts.isPropertyAccessExpression(receiver) ||
			ts.isElementAccessExpression(receiver)
		) {
			receiver = receiver.expression;
		}
		return (
			ts.isIdentifier(receiver) &&
			(receiver.text === "window" || receiver.text === "testWindow")
		);
	});
	if (
		deletePlanReferences !== 4 ||
		callbackScenarioReferences !== 3 ||
		forbiddenWindowControls.length !== 0
	) {
		failures.push(
			"browser delete-failure fixture must not accept raw receipt fields or expose a window mutation control",
		);
	}

	return [...new Set(failures)];
}

/**
 * Locks the browser-only retained/partial move/delete fixture so the page
 * window can only be reached through the single audited `testWindow`
 * declaration inside `installMultiRootNativeIpcMock`'s addInitScript
 * callback.
 *
 * `validateWorkspaceMoveFailureBrowserFixture` and
 * `validateWorkspaceDeleteFailureBrowserFixture` already lock the
 * failure-plan shapes inside that same callback, but their
 * `forbiddenWindowControls` check only rejects property accesses whose
 * receiver is literally `window` or `testWindow` after unwrapping property
 * chains. An alias such as `const winAlias = window as unknown as
 * Record<string, unknown>;` followed by
 * `winAlias.__PLAIN_TEST_DELETE_FAILURE__ = (next) => { ... };` never
 * mentions `window`/`testWindow` as a receiver, so it slips through
 * untouched. This validator closes that gap directly: every value-position
 * reference to a well-known way of reaching the global object (`window`,
 * `globalThis`, `self`, `top`, `frames`, `document`, `eval`, `Function`)
 * must be the single audited `const testWindow = window as unknown as
 * Window & {...};` declaration, and every subsequent `testWindow` reference
 * must live in one of the fixed statements that install its exposed test
 * surface (no new alias, no new property).
 *
 * `parent` is deliberately left out of the forbidden-name set: the fixture
 * legitimately shadows it with `const parent = resolveNode(...)` inside the
 * local `resolveParent` helper, and every other occurrence of `parent` in
 * the callback is the `.parent` property name (a non-value position this
 * validator already ignores). This validator does no scope analysis, so a
 * name with a legitimate local shadow cannot be added to a closed-world
 * list without false positives; `window.parent`/`self.parent`-style access
 * is still caught because `window` (and every other listed name) may only
 * appear once, in the audited declaration.
 *
 * The `testWindow.__TAURI_INTERNALS__ = {...}` statement is recognised
 * structurally (assignment target only) rather than by exact source text:
 * its right-hand object literal is the entire IPC command switch, which
 * contains a template literal with a `${command}` substitution, and the
 * plain `ts.createScanner` token loop used for `normalizedText` elsewhere in
 * this file does not call `reScanTemplateToken`, so it mis-tokenizes
 * anything after that substitution as one runaway token. Pinning that
 * mis-tokenized text would lock in a scanner artifact instead of the actual
 * source, and would break on any unrelated reformatting inside the switch.
 * The switch's own contents (case shapes, ordering, terminal branches) are
 * independently locked by `validateWorkspaceMoveFailureBrowserFixture` and
 * `validateWorkspaceDeleteFailureBrowserFixture`, so recognising this one
 * statement by its assignment shape does not weaken coverage of this
 * validator's actual concern: window/testWindow reachability.
 */
export function validateWorkspaceBrowserFixtureWindowAuthority(source) {
	const FAILURE_MESSAGE =
		"browser workspace fixture must reach the page window only through the audited testWindow surface";
	const sourceFile = ts.createSourceFile(
		"tests/browser/workspace.spec.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const normalizedText = (node) => {
		if (node === undefined) {
			return undefined;
		}
		const scanner = ts.createScanner(
			ts.ScriptTarget.Latest,
			true,
			ts.LanguageVariant.Standard,
			node.getText(sourceFile),
		);
		let compact = "";
		for (
			let token = scanner.scan();
			token !== ts.SyntaxKind.EndOfFileToken;
			token = scanner.scan()
		) {
			compact += scanner.getTokenText();
		}
		return compact;
	};
	const collect = (root, predicate) => {
		const matches = [];
		function visit(node) {
			if (predicate(node)) {
				matches.push(node);
			}
			ts.forEachChild(node, visit);
		}
		visit(root);
		return matches;
	};

	const installers = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "installMultiRootNativeIpcMock",
	);
	if (installers.length !== 1) {
		return [FAILURE_MESSAGE];
	}
	const [installer] = installers;
	const [onlyStatement] = installer.body?.statements ?? [];
	const awaited =
		installer.body?.statements.length === 1 &&
		onlyStatement !== undefined &&
		ts.isExpressionStatement(onlyStatement) &&
		ts.isAwaitExpression(onlyStatement.expression)
			? onlyStatement.expression.expression
			: undefined;
	const addInitScriptCall =
		awaited !== undefined &&
		ts.isCallExpression(awaited) &&
		ts.isPropertyAccessExpression(awaited.expression) &&
		ts.isIdentifier(awaited.expression.expression) &&
		awaited.expression.expression.text === "page" &&
		awaited.expression.name.text === "addInitScript" &&
		awaited.arguments.length === 2
			? awaited
			: undefined;
	const callback =
		addInitScriptCall !== undefined &&
		ts.isArrowFunction(addInitScriptCall.arguments[0])
			? addInitScriptCall.arguments[0]
			: undefined;
	if (callback === undefined || !ts.isBlock(callback.body)) {
		return [FAILURE_MESSAGE];
	}
	const body = callback.body;
	const failures = [];

	const isValuePositionIdentifier = (node) => {
		const parent = node.parent;
		if (parent === undefined) {
			return true;
		}
		if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
			return false;
		}
		if (
			(ts.isPropertySignature(parent) ||
				ts.isPropertyAssignment(parent) ||
				ts.isMethodSignature(parent) ||
				ts.isMethodDeclaration(parent) ||
				ts.isPropertyDeclaration(parent)) &&
			parent.name === node
		) {
			return false;
		}
		if (
			(ts.isBindingElement(parent) ||
				ts.isParameter(parent) ||
				ts.isVariableDeclaration(parent)) &&
			parent.name === node
		) {
			return false;
		}
		if (ts.isBindingElement(parent) && parent.propertyName === node) {
			return false;
		}
		if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
			return false;
		}
		if (ts.isQualifiedName(parent) && parent.right === node) {
			return false;
		}
		if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) {
			return false;
		}
		if (
			ts.isLabeledStatement(parent) ||
			ts.isBreakOrContinueStatement(parent)
		) {
			return false;
		}
		return true;
	};

	const FORBIDDEN_GLOBAL_NAMES = new Set([
		"window",
		"globalThis",
		"self",
		"top",
		"frames",
		"document",
		"eval",
		"Function",
	]);
	const globalReferences = collect(
		body,
		(node) =>
			ts.isIdentifier(node) &&
			FORBIDDEN_GLOBAL_NAMES.has(node.text) &&
			isValuePositionIdentifier(node),
	);
	const windowReferences = globalReferences.filter(
		(node) => node.text === "window",
	);
	const otherGlobalReferences = globalReferences.filter(
		(node) => node.text !== "window",
	);
	if (otherGlobalReferences.length !== 0) {
		failures.push(FAILURE_MESSAGE);
	}

	const unwrapAsExpressions = (node) => {
		let current = node;
		while (
			ts.isAsExpression(current.parent) &&
			current.parent.expression === current
		) {
			current = current.parent;
		}
		return current;
	};
	let windowDeclarationIsAudited = false;
	if (windowReferences.length === 1) {
		const [windowReference] = windowReferences;
		const outer = unwrapAsExpressions(windowReference);
		windowDeclarationIsAudited =
			outer !== windowReference &&
			ts.isVariableDeclaration(outer.parent) &&
			outer.parent.initializer === outer &&
			ts.isIdentifier(outer.parent.name) &&
			outer.parent.name.text === "testWindow";
	}
	if (windowReferences.length !== 1 || !windowDeclarationIsAudited) {
		failures.push(FAILURE_MESSAGE);
	}

	const ALLOWED_TEST_WINDOW_STATEMENTS = new Set([
		"consttestWindow=windowasunknownasWindow&{__PLAIN_TEST_TAURI_CALLS__:typeofcalls;__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__:typeofversionTransitions;__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__:typeofwatchExchanges;__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__:typeofwatchExchangeTimings;__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__:typeofexternalCreateTimings;__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__():number;__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__():number;__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__(rootId:string,name:string,emitWake:boolean,):number;__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__(rootId:string,name:string,emitWake:boolean,):Promise<number>;__TAURI_EVENT_PLUGIN_INTERNALS__:{unregisterListener():void;};__TAURI_INTERNALS__:{invoke(command:string,args?:Record<string,unknown>|Uint8Array,):Promise<unknown>;transformCallback(callback?:(payload:unknown)=>void,once?:boolean,):number;unregisterCallback(callbackId:number):void;};};",
		"testWindow.__PLAIN_TEST_TAURI_CALLS__=calls;",
		"testWindow.__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__=versionTransitions;",
		"testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGES__=watchExchanges;",
		"testWindow.__PLAIN_TEST_WORKSPACE_WATCH_EXCHANGE_TIMINGS__=watchExchangeTimings;",
		"testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_TIMINGS__=externalCreateTimings;",
		"testWindow.__PLAIN_TEST_MULTI_ROOT_EMIT_WAKE__=emitWorkspaceWatchWake;",
		'testWindow.__PLAIN_TEST_MULTI_ROOT_WATCH_LISTENER_COUNT__=()=>[...eventHandlers.values()].filter(({event})=>event==="plain://workspace-watch-wake",).length;',
		"testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE__=externalCreate;",
		'testWindow.__PLAIN_TEST_MULTI_ROOT_EXTERNAL_CREATE_AFTER_NEXT_SYNC__=(rootId,name,emitWake,)=>{if(deferredExternalCreate!==undefined){thrownewError("A multi-root browser test change is already queued.",);}if(!/^[A-Za-z0-9._-]+$/u.test(name)){thrownewTypeError("Invalid multi-root browser test entry.");}if(typeofemitWake!=="boolean"){thrownewTypeError("Invalid multi-root browser test wake mode.");}returnnewPromise<number>((resolve,reject)=>{deferredExternalCreate=Object.freeze({rootId,name,emitWake,resolve,reject,});});};',
		"testWindow.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){},};",
	]);
	const isTauriInternalsAssignmentStatement = (statement) =>
		ts.isExpressionStatement(statement) &&
		ts.isBinaryExpression(statement.expression) &&
		statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
		ts.isPropertyAccessExpression(statement.expression.left) &&
		ts.isIdentifier(statement.expression.left.expression) &&
		statement.expression.left.expression.text === "testWindow" &&
		statement.expression.left.name.text === "__TAURI_INTERNALS__" &&
		ts.isObjectLiteralExpression(statement.expression.right);

	const testWindowReferences = collect(
		body,
		(node) => ts.isIdentifier(node) && node.text === "testWindow",
	);
	let tauriInternalsAssignmentReferences = 0;
	for (const reference of testWindowReferences) {
		let statement = reference;
		while (statement.parent !== body) {
			statement = statement.parent;
		}
		if (isTauriInternalsAssignmentStatement(statement)) {
			tauriInternalsAssignmentReferences += 1;
			continue;
		}
		if (!ALLOWED_TEST_WINDOW_STATEMENTS.has(normalizedText(statement))) {
			failures.push(FAILURE_MESSAGE);
		}
	}
	if (tauriInternalsAssignmentReferences !== 1) {
		failures.push(FAILURE_MESSAGE);
	}

	return [...new Set(failures)];
}

function normalizedRustFunction(functionRecord) {
	return {
		parameters: functionRecord.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, ""),
		returnType: functionRecord.returnType.replaceAll(/\s+/g, ""),
		body: functionRecord.body.replaceAll(/\s+/g, ""),
	};
}

function validateVersionedWriteRustBoundary(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/commands.rs",
	);
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");
	const frameSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/write_frame.rs",
	);
	const dtoSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/dto.rs",
	);
	const writerSource = findRustSource(
		rustSources,
		WORKSPACE_VERSIONED_WRITER_PATH,
	);
	const serviceSource = findRustSource(
		rustSources,
		"src-tauri/src/workspace/service.rs",
	);

	if (commandsSource === undefined) {
		failures.push("versioned write boundary requires workspace/commands.rs");
	} else {
		const executable = stripRustCommentsAndLiterals(commandsSource);
		const commands = extractAuditedTauriCommands(
			executable,
			"workspace_write_file",
		);
		if (commands.length !== 1) {
			failures.push(
				"workspace/commands.rs must define exactly one audited workspace_write_file Tauri command",
			);
		} else {
			const command = normalizedRustFunction(commands[0]);
			if (
				command.parameters !==
					"window:WebviewWindow,service:State<'_,WorkspaceService>,request:tauri::ipc::Request<'_>" ||
				command.returnType !== "->Result<WorkspaceWriteResult,CommandError>"
			) {
				failures.push(
					"workspace_write_file must accept only the raw tauri::ipc::Request body and return WorkspaceWriteResult",
				);
			}
			if (
				!/WorkspaceWriteFileFrame::parse_invoke_body\(request\.body\(\)\)\?/.test(
					command.body,
				) ||
				!/(?:service\.|WorkspaceService::)write_file\(/.test(command.body) ||
				/WorkspaceWriteFileRequest|serde_json|InvokeBody::Json/.test(
					command.body,
				)
			) {
				failures.push(
					"workspace_write_file must decode one PLW1 raw frame and route it directly to WorkspaceService::write_file",
				);
			}
		}
	}

	if (libSource === undefined) {
		failures.push("versioned write boundary requires src-tauri/src/lib.rs");
	} else {
		const executable = stripRustCommentsAndLiterals(libSource);
		const registrations = [
			...executable.matchAll(
				/\bworkspace\s*::\s*commands\s*::\s*workspace_write_file\b/g,
			),
		];
		const handlers = [
			...executable.matchAll(
				/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
			),
		];
		if (
			registrations.length !== 1 ||
			handlers.length !== 1 ||
			!/\bworkspace\s*::\s*commands\s*::\s*workspace_write_file\b/.test(
				handlers[0][1],
			)
		) {
			failures.push(
				"src-tauri/src/lib.rs must register workspace_write_file exactly once in generate_handler",
			);
		}
	}

	if (frameSource === undefined) {
		failures.push("versioned write boundary requires workspace/write_frame.rs");
	} else {
		const executable = stripRustCommentsAndLiterals(frameSource);
		const parsers = extractRustFunctions(executable, "parse_invoke_body");
		if (parsers.length !== 1) {
			failures.push("PLW1 must have exactly one raw InvokeBody parser");
		} else {
			const parser = normalizedRustFunction(parsers[0]);
			if (
				parser.parameters !== "body:&InvokeBody" ||
				parser.returnType !== "->Result<Self,CommandError>" ||
				parser.body !==
					"matchbody{InvokeBody::Raw(bytes)=>Self::parse(bytes),InvokeBody::Json(_)=>Err(invalid_write_request()),}"
			) {
				failures.push(
					"PLW1 parser must accept InvokeBody::Raw and reject InvokeBody::Json exactly",
				);
			}
		}
		for (const pattern of [
			/\bconst\s+PLW1_MAGIC\s*:\s*&\s*\[u8\s*;\s*4\s*\]\s*=\s*b\s*"PLW1"\s*;/,
			/\bconst\s+PLW1_HEADER_BYTES\s*:\s*usize\s*=\s*14\s*;/,
			/\bconst\s+ROOT_ID_BYTES\s*:\s*usize\s*=\s*36\s*;/,
		]) {
			if (!pattern.test(frameSource)) {
				failures.push(
					"PLW1 wire constants must remain magic PLW1, header 14 and root UUID 36 bytes",
				);
				break;
			}
		}
		const parseFunctions = extractRustFunctions(executable, "parse");
		if (
			parseFunctions.length !== 1 ||
			!/[.]checked_add\(/.test(parseFunctions[0].body) ||
			!/frame_end\s*!=\s*frame[.]len\(\)/.test(parseFunctions[0].body) ||
			!/content_length\s*>\s*MAX_VERSIONED_FILE_BYTES/.test(
				parseFunctions[0].body,
			)
		) {
			failures.push(
				"PLW1 parser must use checked offsets, the 8 MiB limit and an exact frame tail",
			);
		}
	}

	let renameatCall;
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executable = stripRustCommentsAndLiterals(source);
		const audit = auditDirectRustixFsFunction(executable, "renameat");
		if (audit.hasForbiddenBinding) {
			failures.push(
				`${normalizedPath} must not alias, re-export or indirectly reference rustix::fs::renameat`,
			);
		}
		if (audit.referenceCount > 0) {
			if (normalizedPath !== WORKSPACE_VERSIONED_WRITER_PATH) {
				failures.push(
					`${normalizedPath} must not use overwrite renameat outside the versioned writer`,
				);
			} else if (audit.calls.length === 1 && audit.referenceCount === 1) {
				renameatCall = audit.calls[0];
			}
		}
	}

	if (writerSource === undefined) {
		failures.push(
			"versioned write boundary requires workspace/versioned_writer.rs",
		);
	} else {
		const executable = stripRustCommentsAndLiterals(writerSource);
		const renameIdentifierCount = [...executable.matchAll(/\brename\b/g)]
			.length;
		if (
			renameIdentifierCount !== 2 ||
			/\b(?:renameat2|renameat_with|RENAME_EXCHANGE|RENAME_SWAP)\b/.test(
				executable,
			) ||
			/\b(?:SYS_rename|SYS_renameat|SYS_renameat2|SYS_unlink|SYS_unlinkat)\b/.test(
				executable,
			) ||
			/\b(?:libc|nix)\s*::(?:\s*[A-Za-z_]\w*\s*::)*\s*(?:rename|renameat|renameat2|unlink|unlinkat|syscall)\b/.test(
				executable,
			) ||
			/\bextern\s+"C"\s*\{[^}]*\bfn\s+(?:rename|renameat|renameat2|unlink|unlinkat)\b/s.test(
				executable,
			)
		) {
			failures.push(
				"versioned writer must not add an alternate, aliased or exchange rename path",
			);
		}
		if (
			renameatCall === undefined ||
			!renameatCall.closed ||
			renameatCall.arguments.replaceAll(/\s+/g, "") !==
				"parent,stage,parent,target"
		) {
			failures.push(
				"versioned writer must contain one direct parent+stage to parent+target rustix::fs::renameat call",
			);
		}

		const renameFunctions = extractRustFunctions(executable, "rename");
		const renameCalls = methodCalls(executable, "rename");
		if (
			renameFunctions.length !== 1 ||
			renameCalls.length !== 1 ||
			!/\bhooks\s*\.\s*$/.test(executable.slice(0, renameCalls[0]?.index)) ||
			renameCalls[0]?.arguments.replaceAll(/\s+/g, "").replace(/,$/, "") !==
				"&publication_parent.parent,&stage.name,&publication_parent.name"
		) {
			failures.push(
				"versioned writer must dispatch overwrite publication through one audited hooks.rename call",
			);
		}

		const publishers = extractRustFunctions(executable, "publish_and_classify");
		if (publishers.length !== 1) {
			failures.push(
				"versioned writer must define exactly one publish_and_classify typestate consumer",
			);
		} else {
			const publisher = publishers[0];
			const calls = methodCalls(publisher.body, "rename");
			const disables = methodCalls(publisher.body, "disable_cleanup");
			const renameCall = calls[0];
			if (
				calls.length !== 1 ||
				disables.length !== 1 ||
				renameCall === undefined ||
				disables[0].index >= renameCall.index
			) {
				failures.push(
					"publish_and_classify must disable automatic cleanup before its sole rename dispatch",
				);
			} else {
				const afterRename = publisher.body.slice(renameCall.end);
				if (
					/\?|[.]\s*(?:map_err|unwrap|expect)\s*\(|\b(?:panic|unreachable)\s*!/.test(
						afterRename,
					) ||
					/\b(?:renameat|renameat_with|remove_file|remove_dir|unlink|unlinkat)\b/.test(
						afterRename,
					) ||
					methodCalls(afterRename, "rename").length > 0
				) {
					failures.push(
						"publish_and_classify must not propagate, panic, rename again or directly delete after publication dispatch",
					);
				}
				const normalizedAfterRename = afterRename.replaceAll(/\s+/g, "");
				const notPublishedStart = normalizedAfterRename.indexOf(
					"RenameFailureCheck::NotPublishedProof=>{",
				);
				const observedWrittenStart = normalizedAfterRename.indexOf(
					"RenameFailureCheck::ObservedWritten=>",
				);
				const ordinaryErrors = [
					...normalizedAfterRename.matchAll(/\bErr\(/g),
				].map((match) => match.index);
				if (
					/\breturn\b/.test(afterRename) ||
					notPublishedStart < 0 ||
					observedWrittenStart <= notPublishedStart ||
					ordinaryErrors.length !== 2 ||
					ordinaryErrors[0] >= notPublishedStart ||
					ordinaryErrors
						.slice(1)
						.some(
							(index) =>
								index <= notPublishedStart || index >= observedWrittenStart,
						)
				) {
					failures.push(
						"post-rename ordinary errors must be confined to the proven NotPublished cleanup branch",
					);
				}
			}
			const normalized = publisher.body
				.replaceAll(/\s+/g, "")
				.replaceAll(/,(?=\))/g, "");
			const proofHook = normalized.indexOf(
				"hooks.after_not_published_proof(&publication_parent.parent,&stage.name,&publication_parent.name)",
			);
			const strictRemoval = normalized.indexOf(
				"letremoval=strict_remove_stage_after_rename(&initial_parent,initial_target,&mutstage,hooks)",
			);
			const finalObservation = normalized.indexOf(
				"matchobserve_rename_failure_target(lease,relative_path,&initial_parent,initial_target,&stage)",
			);
			if (
				proofHook < 0 ||
				strictRemoval <= proofHook ||
				finalObservation <= strictRemoval ||
				!/RenameFailureTarget::OldTargetifremoval==StrictStageRemoval::Removed=>\{Err\(map_rename_failure\(rename_error\)\)\}/.test(
					normalized,
				) ||
				!/RenameFailureCheck::ObservedWritten=>/.test(normalized) ||
				!/RenameFailureCheck::Unknown=>Ok\(WorkspaceWriteResult::native_unknown\(\)\)/.test(
					normalized,
				)
			) {
				failures.push(
					"rename failure must classify proven not-published, observed-written and ambiguous outcomes separately",
				);
			}
		}

		const failureChecks = extractRustFunctions(
			executable,
			"check_reported_rename_failure",
		);
		if (
			failureChecks.length !== 1 ||
			![
				"open_parent_chain",
				"parent_chain_matches",
				"observe_rename_failure_target_at_parent",
				"stage_receipt_matches_at",
			].every((name) =>
				new RegExp(`\\b${name}\\s*\\(`).test(failureChecks[0].body),
			) ||
			!/RenameFailureCheck\s*::\s*NotPublishedProof/.test(failureChecks[0].body)
		) {
			failures.push(
				"reported rename failure may return an ordinary error only after current-root old-target and owned-stage proof",
			);
		}
		const strictRemovals = extractRustFunctions(
			executable,
			"strict_remove_stage_after_rename",
		);
		const strictRemovalBody = (strictRemovals[0]?.body ?? "").replaceAll(
			/\s+/g,
			"",
		);
		const expectedStrictRemovalBody =
			"if!stage_receipt_matches_at(initial_parent,initial_target,stage){returnStrictStageRemoval::NotRemoved;}" +
			"matchhooks.remove_stage(&stage.parent,&stage.name){" +
			"Ok(())ifstage.opened_handle_is_unlinked()==Ok(true)=>StrictStageRemoval::Removed," +
			"Ok(())=>StrictStageRemoval::NotRemoved," +
			"Err(_)=>StrictStageRemoval::NotRemoved," +
			"}";
		const targetObservations = extractRustFunctions(
			executable,
			"observe_rename_failure_target",
		);
		const unlinkHelpers = extractRustFunctions(
			executable,
			"remove_owned_stage",
		);
		const removeStageHooks = extractRustFunctions(executable, "remove_stage");
		if (
			strictRemovals.length !== 1 ||
			strictRemovalBody !== expectedStrictRemovalBody ||
			targetObservations.length !== 1 ||
			![
				"open_parent_chain",
				"parent_chain_matches",
				"observe_rename_failure_target_at_parent",
			].every((name) =>
				new RegExp(`\\b${name}\\s*\\(`).test(targetObservations[0]?.body ?? ""),
			) ||
			unlinkHelpers.length !== 1 ||
			unlinkHelpers[0].parameters.replaceAll(/\s+/g, "").replace(/,$/, "") !==
				"parent:&Dir,stage:&Path" ||
			unlinkHelpers[0].body.replaceAll(/\s+/g, "") !==
				"parent.remove_file(stage)" ||
			removeStageHooks.length !== 1 ||
			removeStageHooks[0].parameters
				.replaceAll(/\s+/g, "")
				.replace(/,$/, "") !== "&mutself,parent:&Dir,stage:&Path" ||
			removeStageHooks[0].body.replaceAll(/\s+/g, "") !==
				"remove_owned_stage(parent,stage)"
		) {
			failures.push(
				"reported rename failure must reverify and unlink only the owned stage, then reobserve the current-root target",
			);
		}
	}

	if (dtoSource === undefined) {
		failures.push("versioned write boundary requires workspace/dto.rs");
	} else {
		const executable = stripRustCommentsAndLiterals(dtoSource);
		const requiredConstructors = [
			"written",
			"rename_succeeded_sync_failed_with_written_target",
			"rename_succeeded_with_changed_target",
			"rename_succeeded_with_unverifiable_target",
			"rename_failed_with_observed_target",
			"native_unknown",
		];
		const constructorBodies = new Map([
			["written", "Self(WorkspaceWriteResultWire::Written{stat})"],
			[
				"rename_succeeded_sync_failed_with_written_target",
				"Self(WorkspaceWriteResultWire::TargetPublished{publication_evidence:WorkspaceWritePublicationEvidence::TargetObservedWritten,rename:WorkspaceWriteRenameObservation::ReportedSuccess,directory_sync:WorkspaceWriteDirectorySyncObservation::Failed,target:WorkspaceWriteTargetObservation::MatchesWritten,})",
			],
			[
				"rename_succeeded_with_changed_target",
				"Self(WorkspaceWriteResultWire::TargetPublished{publication_evidence:WorkspaceWritePublicationEvidence::RenameReportedSuccess,rename:WorkspaceWriteRenameObservation::ReportedSuccess,directory_sync,target:WorkspaceWriteTargetObservation::Changed,})",
			],
			[
				"rename_succeeded_with_unverifiable_target",
				"Self(WorkspaceWriteResultWire::TargetPublished{publication_evidence:WorkspaceWritePublicationEvidence::RenameReportedSuccess,rename:WorkspaceWriteRenameObservation::ReportedSuccess,directory_sync,target:WorkspaceWriteTargetObservation::Unverifiable,})",
			],
			[
				"rename_failed_with_observed_target",
				"Self(WorkspaceWriteResultWire::TargetPublished{publication_evidence:WorkspaceWritePublicationEvidence::TargetObservedWritten,rename:WorkspaceWriteRenameObservation::ReportedFailure,directory_sync,target,})",
			],
			[
				"native_unknown",
				"Self(WorkspaceWriteResultWire::OutcomeUnknown{observation:WorkspaceWriteNativeObservation::Native,rename:WorkspaceWriteFailedRenameObservation::ReportedFailure,directory_sync:WorkspaceWriteUnknownDirectorySyncObservation::NotAttempted,target:WorkspaceWriteAmbiguousTargetObservation::Ambiguous,})",
			],
		]);
		const canonicalConstructorsAreExact = requiredConstructors.every((name) => {
			const functions = extractRustFunctions(executable, name);
			return (
				functions.length === 1 &&
				functions[0].body.replaceAll(/\s+/g, "") === constructorBodies.get(name)
			);
		});
		const wireReferences = [
			...executable.matchAll(/\bWorkspaceWriteResultWire\b/g),
		].length;
		if (
			!/\benum\s+WorkspaceWriteResultWire\s*\{/.test(executable) ||
			/\bpub(?:\s*\([^)]*\))?\s+enum\s+WorkspaceWriteResultWire\b/.test(
				executable,
			) ||
			!/#\s*\[\s*serde\s*\(\s*transparent\s*\)\s*\]\s*pub\s+struct\s+WorkspaceWriteResult\s*\(\s*WorkspaceWriteResultWire\s*\)\s*;/s.test(
				dtoSource,
			) ||
			/\bpub(?:\s*\([^)]*\))?\s+enum\s+WorkspaceWriteResult\b/.test(
				executable,
			) ||
			/\bfn\s+target_published\b/.test(executable) ||
			!canonicalConstructorsAreExact ||
			wireReferences !== 11 ||
			[...executable.matchAll(/\bSelf\s*\(\s*WorkspaceWriteResultWire\s*::/g)]
				.length !== 6 ||
			/\bWorkspaceWriteResult\s*\(\s*WorkspaceWriteResultWire\s*::/.test(
				executable,
			)
		) {
			failures.push(
				"WorkspaceWriteResult must be a transparent wrapper over one private wire enum with only canonical constructors",
			);
		}
	}
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			normalizedPath !== "src-tauri/src/workspace/dto.rs" &&
			RUST_PRODUCTION_SOURCE_PATTERN.test(normalizedPath) &&
			!WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath) &&
			/\bWorkspaceWriteResultWire\b/.test(stripRustCommentsAndLiterals(source))
		) {
			failures.push(
				`${normalizedPath} must not access the private WorkspaceWriteResult wire enum`,
			);
		}
	}

	if (serviceSource === undefined) {
		failures.push("versioned write boundary requires workspace/service.rs");
	} else {
		const executable = stripRustCommentsAndLiterals(serviceSource);
		const runners = extractRustFunctions(executable, "run_versioned_write");
		if (runners.length !== 1) {
			failures.push(
				"WorkspaceService must define one versioned-write mutation runner",
			);
		} else {
			const body = runners[0].body.replaceAll(/\s+/g, "");
			const unavailableBranches = [
				...body.matchAll(
					/Err\(_\)=>Err\(workspace_write_response_unavailable\(\)\)/g,
				),
			];
			if (
				!/spawn_blocking\(/.test(body) ||
				!/lock\(&workspace\.mutation_gate\)\?/.test(body) ||
				!/workspace\.validate_lease\(leased_root_id\)\?/.test(body) ||
				!/matchstd::panic::catch_unwind\(std::panic::AssertUnwindSafe\(\|\|operation\(lease\)\)\)\{Ok\(result\)=>result,Err\(_\)=>Err\(workspace_write_response_unavailable\(\)\),\}/.test(
					body,
				) ||
				unavailableBranches.length !== 1 ||
				[...body.matchAll(/letjoined=/g)].length !== 1 ||
				body.split("joined").length - 1 !== 2 ||
				!body.includes(
					"letjoined=tauri::async_runtime::spawn_blocking(move||{",
				) ||
				!body.endsWith("}).await;classify_versioned_write_join(joined)")
			) {
				failures.push(
					"versioned-write runner must hold the mutation gate, revalidate the lease and conservatively classify join failure",
				);
			}
		}
		const unavailableHelpers = extractRustFunctions(
			executable,
			"workspace_write_response_unavailable",
		);
		if (
			unavailableHelpers.length !== 1 ||
			!/CommandError\s*::\s*new\s*\(\s*"WORKSPACE_WRITE_RESPONSE_UNAVAILABLE"\s*,/.test(
				serviceSource,
			)
		) {
			failures.push(
				"versioned-write panic and join failure must use one non-whitelisted response-unavailable error",
			);
		}
		const joinClassifiers = extractRustFunctions(
			executable,
			"classify_versioned_write_join",
		);
		if (
			joinClassifiers.length !== 1 ||
			joinClassifiers[0].body.replaceAll(/\s+/g, "") !==
				"matchresult{Ok(result)=>result,Err(_)=>Err(workspace_write_response_unavailable()),}"
		) {
			failures.push(
				"versioned-write JoinError must be classified only by the exact response-unavailable helper",
			);
		}
	}

	return failures;
}

function findTypeScriptFunction(sourceFile, name) {
	return sourceFile.statements.find(
		(statement) =>
			ts.isFunctionDeclaration(statement) && statement.name?.text === name,
	);
}

function validateVersionedWriteTypeScriptBoundary(appSources) {
	const failures = [];
	const byPath = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const nativeSource = byPath.get("app/platform/tauri/native.ts");
	const codecSource = byPath.get("app/platform/tauri/workspace-codec.ts");
	if (nativeSource === undefined || codecSource === undefined) {
		return [
			"versioned write TypeScript boundary requires native.ts and workspace-codec.ts",
		];
	}
	if (/['"]WORKSPACE_WRITE_RESPONSE_UNAVAILABLE['"]/.test(codecSource)) {
		failures.push(
			"WORKSPACE_WRITE_RESPONSE_UNAVAILABLE must remain outside the ordinary pre-publication error whitelist",
		);
	}

	let commandLiteralCount = 0;
	for (const [relativePath, source] of byPath) {
		const sourceFile = ts.createSourceFile(
			relativePath,
			source,
			ts.ScriptTarget.Latest,
			true,
			relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		function visit(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "invoke"
			) {
				if (
					node.arguments.length < 1 ||
					!ts.isStringLiteral(node.arguments[0])
				) {
					failures.push(
						`${relativePath} must invoke only direct StringLiteral commands`,
					);
				}
				if (
					containingPropertyName(node) === "workspaceWriteFile" &&
					(node.arguments.length !== 2 ||
						!ts.isStringLiteral(node.arguments[0]) ||
						node.arguments[0].text !== "workspace_write_file" ||
						!ts.isIdentifier(node.arguments[1]) ||
						node.arguments[1].text !== "frame")
				) {
					failures.push(
						"native workspaceWriteFile must contain only its one exact invoke(command, frame) dispatch",
					);
				}
			}
			if (
				(ts.isStringLiteral(node) ||
					ts.isNoSubstitutionTemplateLiteral(node)) &&
				node.text === "workspace_write_file"
			) {
				commandLiteralCount += 1;
				const call = node.parent;
				const exact =
					relativePath === "app/platform/tauri/native.ts" &&
					ts.isStringLiteral(node) &&
					ts.isCallExpression(call) &&
					call.arguments.length === 2 &&
					call.arguments[0] === node &&
					ts.isIdentifier(call.expression) &&
					call.expression.text === "invoke" &&
					ts.isIdentifier(call.arguments[1]) &&
					call.arguments[1].text === "frame" &&
					containingPropertyName(node) === "workspaceWriteFile";
				if (!exact) {
					failures.push(
						"workspace_write_file must appear only as invoke(command, frame) in native workspaceWriteFile",
					);
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	if (commandLiteralCount !== 1) {
		failures.push(
			"application sources must contain exactly one workspace_write_file command literal",
		);
	}

	const codecFile = ts.createSourceFile(
		"app/platform/tauri/workspace-codec.ts",
		codecSource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const expectedPrepublicationCodes = [
		"ROOT_NOT_AUTHORIZED",
		"ROOT_UNAVAILABLE",
		"PERMISSION_DENIED",
		"FILE_TOO_LARGE",
		"INVALID_WORKSPACE_WRITE_REQUEST",
		"WORKSPACE_CONFLICT",
		"WORKSPACE_FILE_MODIFIED",
		"WORKSPACE_WRITE_UNSUPPORTED",
		"WORKSPACE_WINDOW_CLOSED",
		"IO_FAILED",
	];
	const whitelistDeclarations = [];
	const whitelistSetDeclarations = [];
	let whitelistSetMutation = false;
	function auditWriteWhitelist(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			if (node.name.text === "WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES") {
				whitelistDeclarations.push(node);
			}
			if (node.name.text === "WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET") {
				whitelistSetDeclarations.push(node);
			}
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text ===
				"WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET" &&
			["add", "delete", "clear"].includes(node.expression.name.text)
		) {
			whitelistSetMutation = true;
		}
		ts.forEachChild(node, auditWriteWhitelist);
	}
	auditWriteWhitelist(codecFile);
	const whitelistInitializerNode = whitelistDeclarations[0]?.initializer;
	const whitelistInitializer =
		whitelistInitializerNode === undefined
			? undefined
			: unwrapTypeScriptExpression(whitelistInitializerNode);
	const whitelistArray =
		whitelistInitializer !== undefined &&
		ts.isCallExpression(whitelistInitializer) &&
		ts.isPropertyAccessExpression(whitelistInitializer.expression) &&
		ts.isIdentifier(whitelistInitializer.expression.expression) &&
		whitelistInitializer.expression.expression.text === "Object" &&
		whitelistInitializer.expression.name.text === "freeze" &&
		whitelistInitializer.arguments.length === 1
			? unwrapTypeScriptExpression(whitelistInitializer.arguments[0])
			: undefined;
	const whitelistCodes =
		whitelistArray !== undefined && ts.isArrayLiteralExpression(whitelistArray)
			? whitelistArray.elements.map((element) =>
					ts.isStringLiteral(element) ? element.text : undefined,
				)
			: [];
	const whitelistSetInitializerNode = whitelistSetDeclarations[0]?.initializer;
	const whitelistSetInitializer =
		whitelistSetInitializerNode === undefined
			? undefined
			: unwrapTypeScriptExpression(whitelistSetInitializerNode);
	const whitelistSetIsExact =
		whitelistSetInitializer !== undefined &&
		ts.isNewExpression(whitelistSetInitializer) &&
		ts.isIdentifier(whitelistSetInitializer.expression) &&
		whitelistSetInitializer.expression.text === "Set" &&
		whitelistSetInitializer.arguments?.length === 1 &&
		ts.isIdentifier(whitelistSetInitializer.arguments[0]) &&
		whitelistSetInitializer.arguments[0].text ===
			"WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES";
	if (
		whitelistDeclarations.length !== 1 ||
		whitelistSetDeclarations.length !== 1 ||
		whitelistCodes.length !== expectedPrepublicationCodes.length ||
		whitelistCodes.some(
			(code, index) => code !== expectedPrepublicationCodes[index],
		) ||
		!whitelistSetIsExact ||
		whitelistSetMutation
	) {
		failures.push(
			"workspace write ordinary rejection whitelist must equal the Rust pre-publication code set",
		);
	}
	const prepublicationDecoder = findTypeScriptFunction(
		codecFile,
		"decodeWorkspaceWritePrepublicationError",
	);
	const prepublicationDecoderBody = prepublicationDecoder?.body
		?.getText(codecFile)
		.replaceAll(/\s+/g, "");
	const expectedPrepublicationDecoderBody =
		'{try{constsnapshot=ownPlainDataSnapshot(value);if(!hasExactKeys(snapshot,["code","message"])||typeofsnapshot.code!=="string"||!WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET.has(snapshot.code)||typeofsnapshot.message!=="string"||snapshot.message.length<1||snapshot.message.length>MAX_COMMAND_ERROR_MESSAGE_LENGTH||!isWellFormedUtf16(snapshot.message)){returnundefined;}rejectProxyObject(valueasobject);returnObject.freeze({code:snapshot.code,message:snapshot.message,});}catch{returnundefined;}}';
	if (prepublicationDecoderBody !== expectedPrepublicationDecoderBody) {
		failures.push(
			"workspace write ordinary rejection decoder must use only the exact closed whitelist",
		);
	}

	const writeResultDecoder = findTypeScriptFunction(
		codecFile,
		"decodeWorkspaceWriteResult",
	);
	const decoderBody = writeResultDecoder?.body
		?.getText(codecFile)
		.replaceAll(/\s+/g, "")
		.replaceAll(/,(?=\])/g, "");
	const targetPublishedStart = decoderBody?.indexOf(
		'if(snapshot.status==="targetPublished"){',
	);
	const unknownStart = decoderBody?.indexOf(
		'if(snapshot.status!=="outcomeUnknown"',
		targetPublishedStart,
	);
	const targetPublishedBody =
		decoderBody !== undefined &&
		targetPublishedStart !== undefined &&
		targetPublishedStart >= 0 &&
		unknownStart !== undefined &&
		unknownStart > targetPublishedStart
			? decoderBody.slice(targetPublishedStart, unknownStart)
			: "";
	const expectedTargetPublishedGuard =
		'if(snapshot.status==="targetPublished"){if(!hasExactKeys(snapshot,["status","publicationEvidence","rename","directorySync","target"])||' +
		'(snapshot.publicationEvidence!=="renameReportedSuccess"&&snapshot.publicationEvidence!=="targetObservedWritten")||' +
		'(snapshot.rename!=="reportedSuccess"&&snapshot.rename!=="reportedFailure")||' +
		'(snapshot.directorySync!=="synced"&&snapshot.directorySync!=="failed")||' +
		'(snapshot.target!=="matchesWritten"&&snapshot.target!=="changed"&&snapshot.target!=="unverifiable")||' +
		'(snapshot.rename==="reportedSuccess"&&snapshot.publicationEvidence==="targetObservedWritten"&&(snapshot.directorySync!=="failed"||snapshot.target!=="matchesWritten"))||' +
		'(snapshot.rename==="reportedSuccess"&&snapshot.publicationEvidence==="renameReportedSuccess"&&snapshot.target==="matchesWritten")||' +
		'(snapshot.rename==="reportedFailure"&&snapshot.publicationEvidence!=="targetObservedWritten")){returnviolation();}';
	if (
		!targetPublishedBody.startsWith(expectedTargetPublishedGuard) ||
		[...decoderBody.matchAll(/"targetPublished"/g)].length !== 1
	) {
		failures.push(
			"WorkspaceWriteResult decoder must accept only Rust-representable targetPublished cross-fields",
		);
	}
	const nativeUnknownStart = decoderBody?.indexOf(
		'if(snapshot.observation==="native"){',
		unknownStart,
	);
	const responseUnavailableStart = decoderBody?.indexOf(
		'if(snapshot.observation!=="responseUnavailable"',
		nativeUnknownStart,
	);
	const nativeUnknownBody =
		decoderBody !== undefined &&
		nativeUnknownStart !== undefined &&
		nativeUnknownStart >= 0 &&
		responseUnavailableStart !== undefined &&
		responseUnavailableStart > nativeUnknownStart
			? decoderBody.slice(nativeUnknownStart, responseUnavailableStart)
			: "";
	const expectedNativeUnknownGuard =
		'if(snapshot.observation==="native"){if(snapshot.rename!=="reportedFailure"||snapshot.directorySync!=="notAttempted"){returnviolation();}';
	if (
		!nativeUnknownBody.startsWith(expectedNativeUnknownGuard) ||
		[...decoderBody.matchAll(/"native"/g)].length !== 1 ||
		nativeUnknownBody.includes('"synced"') ||
		nativeUnknownBody.includes('"failed"')
	) {
		failures.push(
			"WorkspaceWriteResult decoder must accept only native reportedFailure/notAttempted unknown",
		);
	}
	const encoder = findTypeScriptFunction(
		codecFile,
		"encodeWorkspaceWriteFileRequest",
	);
	const snapshot = findTypeScriptFunction(
		codecFile,
		"workspaceWriteContentSnapshot",
	);
	if (encoder?.body === undefined || snapshot?.body === undefined) {
		failures.push(
			"PLW1 codec must define its encoder and private content snapshot",
		);
	} else {
		let forbiddenEnumeration = false;
		for (const root of [encoder.body, snapshot.body]) {
			function visit(node) {
				if (ts.isForInStatement(node)) {
					forbiddenEnumeration = true;
				}
				if (ts.isCallExpression(node)) {
					const callee = node.expression
						.getText(codecFile)
						.replaceAll(/\s+/g, "");
					if (
						callee === "Reflect.ownKeys" ||
						callee === "Object.keys" ||
						callee === "Object.getOwnPropertyNames" ||
						callee === "Object.getOwnPropertyDescriptors"
					) {
						forbiddenEnumeration = true;
					}
				}
				ts.forEachChild(node, visit);
			}
			visit(root);
		}
		if (forbiddenEnumeration) {
			failures.push(
				"PLW1 encoder must not enumerate TypedArray integer-index own keys",
			);
		}
		const allowedSnapshotCalls = new Set([
			"Number.isSafeInteger",
			"Object.getPrototypeOf",
			"Reflect.apply",
			"requestViolation",
			"violation",
		]);
		let snapshotHasUnknownCollector = false;
		function auditSnapshot(node) {
			if (
				ts.isForOfStatement(node) ||
				ts.isSpreadElement(node) ||
				(ts.isCallExpression(node) &&
					!allowedSnapshotCalls.has(
						node.expression.getText(codecFile).replaceAll(/\s+/g, ""),
					))
			) {
				snapshotHasUnknownCollector = true;
			}
			ts.forEachChild(node, auditSnapshot);
		}
		auditSnapshot(snapshot.body);
		if (snapshotHasUnknownCollector) {
			failures.push(
				"PLW1 private content snapshot may use only captured constant-space intrinsic operations",
			);
		}
		let encoderContentReferences = 0;
		let encoderContentRouteIsExact = true;
		function auditEncoderContent(node) {
			if (ts.isIdentifier(node) && node.text === "content") {
				encoderContentReferences += 1;
				const call = node.parent;
				if (
					!ts.isCallExpression(call) ||
					call.arguments.length !== 1 ||
					call.arguments[0] !== node ||
					!ts.isIdentifier(call.expression) ||
					call.expression.text !== "workspaceWriteContentSnapshot"
				) {
					encoderContentRouteIsExact = false;
				}
			}
			ts.forEachChild(node, auditEncoderContent);
		}
		auditEncoderContent(encoder.body);
		if (encoderContentReferences !== 1 || !encoderContentRouteIsExact) {
			failures.push(
				"PLW1 encoder must pass caller content exactly once into the private snapshot collector",
			);
		}
		const encoderText = encoder.body.getText(codecFile);
		if (
			!/workspaceWriteContentSnapshot\s*\(\s*content\s*\)/.test(encoderText) ||
			!/new\s+Uint8Array\s*\(/.test(encoderText) ||
			!/return\s+frame\s*;/.test(encoderText)
		) {
			failures.push(
				"PLW1 encoder must synchronously snapshot content into and return one exact Uint8Array frame",
			);
		}
	}

	const nativeFile = ts.createSourceFile(
		"app/platform/tauri/native.ts",
		nativeSource,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	let writeProperties = 0;
	function visitNative(node) {
		if (
			ts.isPropertyAssignment(node) &&
			typeScriptStaticName(node.name) === "workspaceWriteFile"
		) {
			writeProperties += 1;
			const text = node.initializer.getText(nativeFile);
			if (
				!/encodeWorkspaceWriteFileRequest\s*\(/.test(text) ||
				!/decodeWorkspaceWriteResult\s*\(/.test(text) ||
				!/decodeWorkspaceWritePrepublicationError\s*\(/.test(text) ||
				!/workspaceWriteResponseUnavailable\s*\(/.test(text)
			) {
				failures.push(
					"native workspaceWriteFile must encode PLW1, strictly decode success/error and conservatively close unknown responses",
				);
			}
		}
		ts.forEachChild(node, visitNative);
	}
	visitNative(nativeFile);
	if (writeProperties !== 1) {
		failures.push(
			"native bridge must define exactly one workspaceWriteFile route",
		);
	}

	return [...new Set(failures)];
}

/**
 * Freezes the raw PLW1 request, the only overwrite-capable syscall and the
 * post-rename typestate. This guard deliberately lands before the Workbench
 * write consumer; the provider remains read-only in this slice.
 */
export function validateWorkspaceVersionedWriteBoundary(
	rustSources,
	appSources,
) {
	return [
		...validateVersionedWriteRustBoundary(rustSources),
		...validateVersionedWriteTypeScriptBoundary(appSources),
	];
}

/**
 * `ViewPane`'s own base constructor signature (`options: IViewPaneOptions`
 * followed by these nine injected services, in this exact order), as it
 * appears — byte-for-byte identical — at the head of every hand-written
 * `app/` subclass audited for this contract
 * (`plain-scm-view.ts`/`plain-search-view.ts`/`plain-git-graph-view.ts`/
 * `plain-git-stash-view.ts`/`plain-git-worktree-view.ts`/
 * `plain-git-history-view.ts`/`plain-terminal-view.ts`). It is hardcoded
 * here, rather than parsed out of `@codingame/monaco-vscode-api` itself,
 * because that package is vendor code outside this repo's own `app/`
 * source set — the same reason every other args/DTO-shape contract in this
 * file freezes an exact expected constant instead of deriving it from a
 * dependency. If a future upgrade of the package ever changes `ViewPane`'s
 * own constructor, every subclass's `super(...)` call already fails to
 * compile before this contract would ever need to notice.
 */
const VIEW_PANE_BASE_INJECTED_SERVICE_TYPES = Object.freeze([
	"IKeybindingService",
	"IContextMenuService",
	"IConfigurationService",
	"IContextKeyService",
	"IViewDescriptorService",
	"IInstantiationService",
	"IOpenerService",
	"IThemeService",
	"IHoverService",
]);

/**
 * Locks the invariant that `F090` S4 and S6 each independently paid for in
 * real, hard-to-diagnose production failures: every `app/` class that
 * extends `ViewPane` must, in its own file, redeclare a DI decorator for
 * *every* one of its own constructor parameters beyond the leading
 * `options: IViewPaneOptions` — not only the parameters it adds beyond
 * `ViewPane`'s own base nine.
 *
 * The reason a *partial* declaration is exactly as dangerous as *no*
 * declaration at all: `@codingame/monaco-vscode-api`'s decorator storage
 * (`instantiation.js`) creates a **fresh** `$di$dependencies` array the
 * first time any decorator is ever called on a given class, rather than
 * appending to whatever array `ViewPane`'s own prototype chain would
 * otherwise make reachable. So the instant a subclass calls a decorator on
 * itself even once, every one of its *other* injected parameters that
 * weren't also redeclared silently reverts to `undefined` at real
 * construction time — no compile error, no thrown exception at
 * registration time, nothing a Rust fixture or a DOM-free unit test could
 * ever observe.
 *
 * Two real incidents, both discovered only once a first real Playwright
 * click finally exercised the broken view (`F090` S6's own retrospective):
 *
 * - **`F090` S4** — `PlainGitStashView` declared decorators only for the
 *   two services it adds beyond the base nine (indices 10/11), leaving
 *   indices 1-9 completely undeclared for this class. Because the base
 *   nine were then missing, `IInstantiationService.createInstance` failed
 *   to construct not just this view but *every sibling pane in the same
 *   Source Control view container* — a single Playwright run fanned out
 *   into 16 failing cases with none of their failure messages mentioning
 *   stash at all, making the true root cause nearly unreadable from the
 *   symptoms alone.
 * - **`F090` S6** — `plain-git-history-view.ts` had never declared *any*
 *   decorator at all since the view was first written in `F090` S1. This
 *   one happened not to break sibling views (an entirely undeclared
 *   subclass still inherits `ViewPane`'s own correct nine-entry array
 *   unmodified), but this class's own two extra parameters
 *   (`workspaceContextService`/`editorService`) were `undefined` on every
 *   real construction from day one — and the "Show File History" /
 *   "Show Line History" buttons this view exposes are also the *only*
 *   entry point into `F090` S2's commit-detail multi-diff feature, which
 *   therefore had never been reachable in a real Workbench either, for an
 *   entire feature slice, until this defect was finally found.
 *
 * Both failures were invisible to every gate that ran at the time (Rust
 * command fixtures, DOM-free frontend unit tests) because both only
 * exercise pure logic, never a real `IInstantiationService.createInstance`
 * call through a real Workbench. `F100` is about to add four or more new
 * `ViewPane` subclasses (call stack/variables/watch/REPL); this contract
 * exists so each of those starts out structurally incapable of repeating
 * either failure mode, from the very first line, rather than depending on
 * someone remembering to write a Playwright click for it eventually.
 *
 * Detection, per subclass:
 *
 * 1. Identify "extends `ViewPane`" by resolving, per file, the *local*
 *    name the vendor `ViewPane` export is imported under (handles a
 *    renaming import alias, `import { ViewPane as VP } from ...` — no
 *    file in this repo currently renames it, but nothing here assumes
 *    otherwise) from the same `.../views/viewPane` module every real
 *    subclass imports it from, then matching class heritage clauses
 *    against that local name.
 * 2. A subclass with no constructor of its own adds no parameters and
 *    therefore has nothing that could be under-declared; it is skipped.
 * 3. Otherwise, walk the same source file (decorator declarations always
 *    live in the same file as the class, immediately after
 *    `Object.freeze(ClassName.prototype)` in every audited view) for
 *    expressions of the shape `SomeService(ClassName, undefined, N)` —
 *    this repo's actual, real declaration syntax (a plain function call
 *    using the legacy parameter-decorator signature, *not* `@SomeService`
 *    applied to a constructor parameter — confirmed by reading every
 *    `extends ViewPane` file in `app/features/` before writing this
 *    contract).  The count of such calls naming this class, and the set
 *    of indices they declare, must be exactly `{1, 2, ..., N}` where `N`
 *    is the constructor's own parameter count minus one (`options` itself
 *    is never decorated in any audited file — it is supplied positionally
 *    by the instantiation caller, not resolved by DI).
 * 4. The sole exception: a subclass with **zero** of its own declarations
 *    is still accepted, but *only* if its own injected parameter list
 *    (everything after `options`) is structurally identical, name for
 *    name, in order, to `VIEW_PANE_BASE_INJECTED_SERVICE_TYPES` — i.e. it
 *    adds nothing beyond `ViewPane`'s own base signature, so the array it
 *    silently inherits is already exactly correct for its own needs. This
 *    is `PlainGitGraphView`'s real, currently-passing shape today: it is
 *    the one audited view that adds no services beyond the base nine, and
 *    is therefore the one place in this codebase where relying on
 *    inheritance is actually sound rather than a repeat of the S6 defect.
 *    The moment such a class ever adds even one more parameter without
 *    also fully redeclaring, this exception stops applying and the
 *    contract fails it — exactly the transition that silently broke
 *    `plain-git-history-view.ts` in `F090` S1.
 *
 * Known scope limit: this only follows a heritage clause naming `ViewPane`
 * directly. If a future change introduces an intermediate hand-written
 * base class between `ViewPane` and a leaf view (e.g. a shared
 * `PlainDebugViewBase`), this contract will not automatically walk that
 * indirection to classify the leaf as a `ViewPane` descendant — no file in
 * this repo does this today, so it is not a gap in current coverage, but
 * it is one to close if `F100` (or later work) ever introduces such a
 * base class.
 */
export function validateViewPaneDependencyDecoratorBoundary(appSources) {
	const failures = [];
	for (const { relativePath, source } of appSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);

		let viewPaneLocalName;
		for (const statement of sourceFile.statements) {
			if (
				ts.isImportDeclaration(statement) &&
				ts.isStringLiteral(statement.moduleSpecifier) &&
				statement.moduleSpecifier.text.endsWith("/viewPane") &&
				statement.importClause?.namedBindings !== undefined &&
				ts.isNamedImports(statement.importClause.namedBindings)
			) {
				for (const element of statement.importClause.namedBindings.elements) {
					if ((element.propertyName ?? element.name).text === "ViewPane") {
						viewPaneLocalName = element.name.text;
					}
				}
			}
		}
		if (viewPaneLocalName === undefined) {
			continue;
		}

		function visit(node) {
			if (
				ts.isClassDeclaration(node) &&
				node.name !== undefined &&
				node.heritageClauses?.some(
					(clause) =>
						clause.token === ts.SyntaxKind.ExtendsKeyword &&
						clause.types.some(
							(type) =>
								ts.isIdentifier(type.expression) &&
								type.expression.text === viewPaneLocalName,
						),
				)
			) {
				failures.push(
					...viewPaneSubclassDecoratorFailures(
						node,
						sourceFile,
						normalizedPath,
					),
				);
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return [...new Set(failures)];
}

function viewPaneSubclassDecoratorFailures(
	classNode,
	sourceFile,
	normalizedPath,
) {
	const className = classNode.name.text;
	const constructor = classNode.members.find(
		(member) =>
			ts.isConstructorDeclaration(member) && member.body !== undefined,
	);
	if (constructor === undefined) {
		return [];
	}
	const ctorParamCount = constructor.parameters.length;
	if (ctorParamCount === 0) {
		return [
			`${className} (${normalizedPath}) extends ViewPane but declares a constructor with no parameters — it must still accept ViewPane's own options/base-service parameters`,
		];
	}
	const requiredDecoratorCount = ctorParamCount - 1;

	const declaredIndexes = new Set();
	function visitForDecorators(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.arguments.length === 3 &&
			ts.isIdentifier(node.arguments[0]) &&
			node.arguments[0].text === className &&
			ts.isIdentifier(node.arguments[1]) &&
			node.arguments[1].text === "undefined" &&
			ts.isNumericLiteral(node.arguments[2])
		) {
			declaredIndexes.add(node.arguments[2].text);
		}
		ts.forEachChild(node, visitForDecorators);
	}
	visitForDecorators(sourceFile);

	const expectedIndexes = Array.from(
		{ length: requiredDecoratorCount },
		(_, index) => String(index + 1),
	);
	const declaredIndexesMatchExactly =
		declaredIndexes.size === expectedIndexes.length &&
		expectedIndexes.every((index) => declaredIndexes.has(index));

	if (declaredIndexesMatchExactly) {
		return [];
	}

	if (declaredIndexes.size === 0) {
		const injectedParamTypeNames = constructor.parameters
			.slice(1)
			.map((param) =>
				param.type !== undefined &&
				ts.isTypeReferenceNode(param.type) &&
				ts.isIdentifier(param.type.typeName)
					? param.type.typeName.text
					: undefined,
			);
		const matchesViewPaneBaseExactly =
			injectedParamTypeNames.length ===
				VIEW_PANE_BASE_INJECTED_SERVICE_TYPES.length &&
			injectedParamTypeNames.every(
				(typeName, index) =>
					typeName === VIEW_PANE_BASE_INJECTED_SERVICE_TYPES[index],
			);
		if (matchesViewPaneBaseExactly) {
			return [];
		}
	}

	return [
		`${className} (${normalizedPath}) declares ${declaredIndexes.size} of its own DI decorator(s) but its constructor has ${ctorParamCount} parameter(s) (${requiredDecoratorCount} injectable beyond the leading options argument) — every parameter this class's own constructor accepts beyond \`options\` must be redeclared as this class's own decorator (\`SomeService(${className}, undefined, <index>)\`, indices 1 through ${requiredDecoratorCount}), because \`@codingame/monaco-vscode-api\`'s decorator storage replaces — rather than appends to — the inherited dependency array the first time any decorator is ever called on a class. A partial or missing declaration silently leaves the undeclared parameters \`undefined\` at real construction time: this is exactly how F090 S4's PlainGitStashView (declared only its own two new services, wiping the nine base ViewPane parameters and breaking every sibling view in the same Source Control container) and F090 S6's PlainGitHistoryView (declared none at all, silently leaving its own two extra parameters undefined and disabling the commit-detail multi-diff feature since its introduction) both went undetected until a real end-to-end click finally exercised the broken view.`,
	];
}

// ---------------------------------------------------------------------
// F100 S0 (docs/research/2026-07-28-generic-dap.md): the `debug` domain's
// framing state machine + hardened adapter-spawn primitive. Three new AST
// contracts, per that document's "需要新增的 AST 契约清单" items 2/3/5 (items
// 1/4/6 are later-slice work — S1's confirmation gate and command registry,
// and the separately-landed harness-wide ViewPane decorator contract above).
// ---------------------------------------------------------------------

/**
 * Shared prefix check for `F100` S1's trust-*then*-confirmation double gate:
 * builds a whitespace-insensitive regex matching the exact three-statement
 * prefix `trust.require_trusted(workspace, window_label).await?;` → `let
 * subject = descriptor.confirmation_subject(AdapterTransportKind::<variant>);`
 * → `confirmation.require_confirmed(workspace, window_label,
 * &subject).await?;`, and reports which of the two gates (or their ordering)
 * is missing. Shared by [`validateDebugAdapterSpawnBoundary`] (`exec.rs`'s
 * `spawn_adapter`, `variant: "Stdio"`) and
 * [`validateDebugAdapterConnectBoundary`] (`tcp.rs`'s `connect_adapter`,
 * `variant: "Tcp"`) rather than duplicated, since both functions share this
 * exact shape by design (see either module's own doc comment for why
 * connecting out is gated identically to spawning).
 */
function validateTrustThenConfirmationGatePrefix(body, transportVariant) {
	const trustCheckFirst =
		/^trust\s*\.\s*require_trusted\s*\(\s*workspace\s*,\s*window_label\s*\)\s*\.\s*await\s*\?\s*;/.test(
			body,
		);
	if (!trustCheckFirst) {
		return "must call trust.require_trusted(workspace, window_label).await? as its literal first statement, before any spawn/connect-related identifier appears in the function body";
	}
	const confirmationCheckSecond = new RegExp(
		`^trust\\s*\\.\\s*require_trusted\\s*\\(\\s*workspace\\s*,\\s*window_label\\s*\\)\\s*\\.\\s*await\\s*\\?\\s*;` +
			`\\s*let\\s+subject\\s*=\\s*descriptor\\s*\\.\\s*confirmation_subject\\s*\\(\\s*AdapterTransportKind\\s*::\\s*${transportVariant}\\s*\\)\\s*;` +
			`\\s*confirmation\\s*\\.\\s*require_confirmed\\s*\\(\\s*workspace\\s*,\\s*window_label\\s*,\\s*&subject\\s*\\)\\s*\\.\\s*await\\s*\\?\\s*;`,
	).test(body);
	if (!confirmationCheckSecond) {
		return `must call confirmation.require_confirmed(workspace, window_label, &subject).await? (subject built via descriptor.confirmation_subject(AdapterTransportKind::${transportVariant})) as its literal second statement, immediately after the trust check`;
	}
	return undefined;
}

/**
 * Locks `debug/exec.rs`'s `spawn_adapter` function body's first two
 * statements (after argument binding) to be, in order,
 * `trust.require_trusted(workspace, window_label).await?;` then
 * `confirmation.require_confirmed(...)` — the `F100` S1 trust-then-
 * confirmation double gate ADR 0003 requires (workspace trust alone is not
 * enough; a trusted workspace still requires first-run confirmation of the
 * exact `(command, args, transport)` triple before this function may touch
 * `Command`). `F100` S0 originally locked only the trust check; this is the
 * S1 extension, generalized via [`validateTrustThenConfirmationGatePrefix`]
 * so [`validateDebugAdapterConnectBoundary`] can lock the identical shape for
 * `tcp.rs`'s `connect_adapter`. Isolates the function body first via
 * `rustFunctionBody` (comments-only source, so string literal content —
 * irrelevant here — stays visible, matching this helper's existing contract)
 * rather than regexing the whole file, so either check appearing anywhere
 * else (e.g. a doc comment, or a different function) can never produce a
 * false pass.
 */
export function validateDebugAdapterSpawnBoundary(rustSources) {
	const execSource = findRustSource(rustSources, "src-tauri/src/debug/exec.rs");
	if (execSource === undefined) {
		return ["debug adapter spawn boundary requires debug/exec.rs"];
	}
	const commentsOnly = stripRustCommentsOnly(execSource);
	const spawnAdapter = rustFunctionBody(commentsOnly, "spawn_adapter");
	if (spawnAdapter === undefined) {
		return ["debug/exec.rs must define spawn_adapter"];
	}
	const body = spawnAdapter.body
		.replace(/^\{/, "")
		.replace(/\}$/, "")
		.trimStart();
	const failure = validateTrustThenConfirmationGatePrefix(body, "Stdio");
	if (failure !== undefined) {
		return [`debug/exec.rs spawn_adapter ${failure}`];
	}
	return [];
}

/**
 * The connect-side sibling of [`validateDebugAdapterSpawnBoundary`]: locks
 * `debug/tcp.rs`'s `connect_adapter` function body to the identical
 * trust-then-confirmation double-gate prefix (`AdapterTransportKind::Tcp`
 * rather than `::Stdio`) — "对任意 host:port 说 DAP" 和 "spawn 任意程序" 是同
 * 等级的信任委托 (`docs/research/2026-07-28-generic-dap.md`'s "主导会话裁定"
 * item 3), so this function must be gated exactly as strictly as
 * `spawn_adapter`, not merely by trust alone.
 */
export function validateDebugAdapterConnectBoundary(rustSources) {
	const tcpSource = findRustSource(rustSources, "src-tauri/src/debug/tcp.rs");
	if (tcpSource === undefined) {
		return ["debug adapter connect boundary requires debug/tcp.rs"];
	}
	const commentsOnly = stripRustCommentsOnly(tcpSource);
	const connectAdapter = rustFunctionBody(commentsOnly, "connect_adapter");
	if (connectAdapter === undefined) {
		return ["debug/tcp.rs must define connect_adapter"];
	}
	const body = connectAdapter.body
		.replace(/^\{/, "")
		.replace(/\}$/, "")
		.trimStart();
	const failure = validateTrustThenConfirmationGatePrefix(body, "Tcp");
	if (failure !== undefined) {
		return [`debug/tcp.rs connect_adapter ${failure}`];
	}
	return [];
}

/**
 * `F100` S5 — the third sibling of [`validateDebugAdapterSpawnBoundary`]/
 * [`validateDebugAdapterConnectBoundary`]: locks `debug/exec.rs`'s
 * `spawn_adapter_as_tcp_companion` (the `Tcp`-confirmed companion-spawn
 * primitive `debug::mod`'s own module doc names as S2's open recommendation,
 * now built) to the identical trust-then-confirmation double-gate prefix —
 * except keyed on `AdapterTransportKind::Tcp`, never `::Stdio`. This is the
 * mechanical lock proving the one line that actually matters (which
 * transport variant the confirmation subject is built with) can never
 * silently regress back to `Stdio` — which would reintroduce exactly the
 * confirmation-identity-confusion trap this whole primitive exists to avoid.
 */
export function validateDebugTcpCompanionSpawnBoundary(rustSources) {
	const execSource = findRustSource(rustSources, "src-tauri/src/debug/exec.rs");
	if (execSource === undefined) {
		return ["debug tcp companion spawn boundary requires debug/exec.rs"];
	}
	const commentsOnly = stripRustCommentsOnly(execSource);
	const spawnCompanion = rustFunctionBody(
		commentsOnly,
		"spawn_adapter_as_tcp_companion",
	);
	if (spawnCompanion === undefined) {
		return ["debug/exec.rs must define spawn_adapter_as_tcp_companion"];
	}
	const body = spawnCompanion.body
		.replace(/^\{/, "")
		.replace(/\}$/, "")
		.trimStart();
	const failure = validateTrustThenConfirmationGatePrefix(body, "Tcp");
	if (failure !== undefined) {
		return [`debug/exec.rs spawn_adapter_as_tcp_companion ${failure}`];
	}
	return [];
}

/**
 * Locks `debug/exec.rs`'s `spawn_adapter_sync` function body — the function
 * that actually builds and spawns the child process — to the fixed
 * `Command::new(&descriptor.command)` / `.args(&descriptor.args)`
 * construction shape (both the program and the args must come from field
 * access, never a literal or a formatted string), and forbids the same two
 * mechanical red flags `validateTerminalRustBoundary` already polices for
 * `git`/`terminal` (a shell-interpreter `Command::new` literal, an
 * `.arg("-c")`/`.args([...,"-c",...])` literal), plus a `debug`-domain-
 * specific one: no `format!`/string-concatenation may feed into the spawned
 * command at all, even though (unlike every `GIT_*_ARGS` constant) the
 * *content* of `descriptor.command`/`descriptor.args` here comes from
 * caller-supplied configuration, not a fixed list this codebase writes —
 * only the *construction mechanism* is fixed and audited here, matching
 * `docs/research/2026-07-28-generic-dap.md`'s own "决策 1" reasoning for why
 * that distinction is intentional, not a gap.
 */
export function validateDebugSpawnConstructionShape(rustSources) {
	const failures = [];
	const execSource = findRustSource(rustSources, "src-tauri/src/debug/exec.rs");
	if (execSource === undefined) {
		return ["debug spawn construction boundary requires debug/exec.rs"];
	}
	const commentsOnly = stripRustCommentsOnly(execSource);
	const spawnAdapterSync = rustFunctionBody(commentsOnly, "spawn_adapter_sync");
	if (spawnAdapterSync === undefined) {
		return ["debug/exec.rs must define spawn_adapter_sync"];
	}
	const body = spawnAdapterSync.body;
	if (GIT_EXEC_SHELL_INTERPRETER_PATTERN.test(body)) {
		failures.push(
			"debug/exec.rs spawn_adapter_sync must not spawn a shell interpreter — it may only invoke the caller-configured adapter executable directly",
		);
	}
	if (/\bformat!\s*\(/.test(body)) {
		failures.push(
			"debug/exec.rs spawn_adapter_sync must not build the spawned program or its arguments via format!/string concatenation",
		);
	}
	if (/\.args?\s*\(\s*\[?\s*"-c"/.test(body)) {
		failures.push(
			'debug/exec.rs spawn_adapter_sync must not pass a shell "-c" argument',
		);
	}
	if (!/Command::new\s*\(\s*&descriptor\.command\s*\)/.test(body)) {
		failures.push(
			"debug/exec.rs spawn_adapter_sync must construct the child process via Command::new(&descriptor.command), never a literal or formatted program name",
		);
	}
	if (!/\.args\s*\(\s*&descriptor\.args\s*\)/.test(body)) {
		failures.push(
			"debug/exec.rs spawn_adapter_sync must pass argv via .args(&descriptor.args), never a literal or formatted argument list",
		);
	}
	return failures;
}

const DEBUG_FRAMING_BOUNDS_LIMITS = Object.freeze([
	["MAX_DAP_MESSAGE_BYTES", 67_108_864, "usize"],
	["MAX_DAP_HEADER_BYTES", 8_192, "usize"],
]);

/**
 * Locks `debug/framing.rs`'s two message/header size ceilings to their
 * audited exact values — mirroring `validateSearchFileBudgetConstants`'s
 * `findWorkspaceCopyLimitDeclarations`/`evaluateSmallRustIntegerExpression`
 * pattern exactly — and additionally cross-checks that each constant is
 * actually *referenced* somewhere in the file beyond its own declaration
 * line (a plain occurrence count greater than one), matching this file's
 * existing lightweight-but-real style for "the constant is actually wired
 * up, not merely declared and forgotten" (the same spirit as
 * `validateTerminalRustBoundary`'s `TERMINAL_ENV_PASSTHROUGH_NAMES` lock,
 * which likewise fails the whole file rather than just checking the
 * constant exists in isolation).
 */
export function validateDebugFramingBounds(rustSources) {
	const failures = [];
	const framingSource = findRustSource(
		rustSources,
		"src-tauri/src/debug/framing.rs",
	);
	if (framingSource === undefined) {
		return ["debug framing boundary requires debug/framing.rs"];
	}
	const executableSource = stripRustCommentsAndLiterals(framingSource);
	for (const [name, value, integerType] of DEBUG_FRAMING_BOUNDS_LIMITS) {
		const declarations = findWorkspaceCopyLimitDeclarations(
			executableSource,
			name,
			integerType,
		);
		if (
			declarations.length !== 1 ||
			evaluateSmallRustIntegerExpression(declarations[0]) !== value
		) {
			failures.push(
				`debug/framing.rs must define exactly one ${name}: ${integerType} = ${value}`,
			);
			continue;
		}
		const occurrences = executableSource.split(name).length - 1;
		if (occurrences < 2) {
			failures.push(
				`debug/framing.rs must reference ${name} in its decoder logic, not just declare it`,
			);
		}
	}
	return failures;
}

// ---------------------------------------------------------------------
// F100 S1 — first-run confirmation gate's Tauri command surface, mirroring
// TRUST_COMMAND_CONTRACTS/TERMINAL_COMMAND_CONTRACTS's exact-signature-and-
// body pinning technique.
// ---------------------------------------------------------------------

const DEBUG_COMMAND_CONTRACTS = Object.freeze([
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_adapter_confirmation_state",
		parameters:
			"window:WebviewWindow,confirmation:State<'_,ConfirmationService>,workspace:State<'_,WorkspaceService>,request:AdapterConfirmationSubject",
		returnType: "->Result<DebugAdapterConfirmationState,CommandError>",
		body: "letconfirmed=confirmation.inner().is_confirmed(workspace.inner(),window.label(),&request).await?;Ok(DebugAdapterConfirmationState::new(confirmed))",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_adapter_confirmation_grant",
		parameters:
			"window:WebviewWindow,confirmation:State<'_,ConfirmationService>,workspace:State<'_,WorkspaceService>,request:AdapterConfirmationSubject",
		returnType: "->Result<(),CommandError>",
		body: "confirmation.inner().grant(workspace.inner(),window.label(),&request).await",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_adapter_confirmation_revoke",
		parameters:
			"window:WebviewWindow,confirmation:State<'_,ConfirmationService>,workspace:State<'_,WorkspaceService>,request:AdapterConfirmationSubject",
		returnType: "->Result<(),CommandError>",
		body: "confirmation.inner().revoke(workspace.inner(),window.label(),&request).await",
	},
	// `F100` S2 — the real session-lifecycle surface (`debug/mod.rs`'s own
	// module doc), completing the command set S1's `commands.rs` module doc
	// already named as what S2 would add.
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_launch",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,confirmation:State<'_,ConfirmationService>,request:DebugSessionStartRequest",
		returnType: "->Result<DebugSessionStartResult,CommandError>",
		body: "start_debug_session(window,debug_sessions,trust,workspace,confirmation,request,LaunchRequestKind::Launch,).await",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_attach",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,trust:State<'_,TrustService>,workspace:State<'_,WorkspaceService>,confirmation:State<'_,ConfirmationService>,request:DebugSessionStartRequest",
		returnType: "->Result<DebugSessionStartResult,CommandError>",
		body: "start_debug_session(window,debug_sessions,trust,workspace,confirmation,request,LaunchRequestKind::Attach,).await",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_disconnect",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugSessionIdRequest",
		returnType: "->Result<(),CommandError>",
		body: "debug_sessions.inner().disconnect(window.label(),request.into_parts()).await",
	},
	// `F100` S3 — the interactive debugging surface (`debug/mod.rs`'s own
	// module doc). These five were registered in `generate_handler!` and
	// shipped as part of S3's own delivery, but were never actually added to
	// this contract array at the time — a real gap this slice (`F100` S4)
	// discovered while extending this same array for its own five new
	// commands, and backfills here rather than leaving it open, per this
	// project's "如实核实,不能只凭自述结论" discipline.
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_set_breakpoints",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugSetBreakpointsRequest",
		returnType: "->Result<DebugSetBreakpointsResult,CommandError>",
		body: "letquery=request.into_parts()?;letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments,).await?;dto::parse_set_breakpoints_response(&body)",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_stack_trace",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugStackTraceRequest",
		returnType: "->Result<DebugStackTraceResult,CommandError>",
		body: "letquery=request.into_parts();letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments,).await?;dto::parse_stack_trace_response(&body)",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_scopes",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugScopesRequest",
		returnType: "->Result<DebugScopesResult,CommandError>",
		body: "letquery=request.into_parts();letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments).await?;dto::parse_scopes_response(&body)",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_variables",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugVariablesRequest",
		returnType: "->Result<DebugVariablesResult,CommandError>",
		body: "letquery=request.into_parts();letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments,).await?;dto::parse_variables_response(&body)",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_evaluate",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugEvaluateRequest",
		returnType: "->Result<DebugEvaluateResult,CommandError>",
		body: "letquery=request.into_parts()?;letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments,).await?;dto::parse_evaluate_response(&body)",
	},
	// `F100` S4 — execution/step control (`debug/commands.rs`'s own module
	// doc, "`F100` S4's five step-control commands" section).
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_continue",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugThreadRequest",
		returnType: "->Result<DebugContinueResult,CommandError>",
		body: "letquery=request.into_parts();letbody=debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments,).await?;dto::parse_continue_response(&body)",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_next",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugThreadRequest",
		returnType: "->Result<(),CommandError>",
		body: "letquery=request.into_parts();debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments).await?;Ok(())",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_step_in",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugThreadRequest",
		returnType: "->Result<(),CommandError>",
		body: "letquery=request.into_parts();debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments).await?;Ok(())",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_step_out",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugThreadRequest",
		returnType: "->Result<(),CommandError>",
		body: "letquery=request.into_parts();debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments).await?;Ok(())",
	},
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_pause",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugThreadRequest",
		returnType: "->Result<(),CommandError>",
		body: "letquery=request.into_parts();debug_sessions.inner().send_request(window.label(),query.session_id,,query.arguments).await?;Ok(())",
	},
	// `F100` S5 — the `output`-event backpressure ack (`debug/commands.rs`'s
	// own module doc, "`F100` S5" section).
	{
		file: "src-tauri/src/debug/commands.rs",
		name: "debug_output_ack",
		parameters:
			"window:WebviewWindow,debug_sessions:State<'_,DebugSessionService>,request:DebugOutputAckRequest",
		returnType: "->Result<(),CommandError>",
		body: "let(session_id,sequence)=request.into_parts();debug_sessions.inner().ack_output(window.label(),session_id,sequence).await;Ok(())",
	},
]);

/**
 * `F100` S1's `DEBUG_COMMAND_CONTRACTS` registration lock — structurally
 * identical to `validateTrustTerminalCommandRegistration` (exact
 * parameters/returnType/body pinning per command, plus a single audited
 * `generate_handler!` registration each), scoped to the three
 * `debug_adapter_confirmation_*` commands this slice adds. A fourth
 * `debug_*` command (`debug_launch`, etc.) silently added, removed, renamed
 * or rewired to a different service method fails this check the moment it is
 * added to `DEBUG_COMMAND_CONTRACTS` without a matching, audited definition —
 * mirroring the exact discipline `commands.rs`'s own module doc requires
 * ("read this comment before adding a fourth").
 */
export function validateDebugCommandRegistration(rustSources) {
	const failures = [];
	const libSource = findRustSource(rustSources, "src-tauri/src/lib.rs");
	const sourceCache = new Map();

	for (const contract of DEBUG_COMMAND_CONTRACTS) {
		if (!sourceCache.has(contract.file)) {
			sourceCache.set(
				contract.file,
				findRustSource(rustSources, contract.file),
			);
		}
		const fileSource = sourceCache.get(contract.file);
		if (fileSource === undefined) {
			failures.push(`command registration boundary requires ${contract.file}`);
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(fileSource);
		const commands = extractAuditedTauriCommands(
			executableSource,
			contract.name,
		);
		if (commands.length !== 1) {
			failures.push(
				`${contract.file} must define exactly one audited ${contract.name} Tauri command`,
			);
			continue;
		}
		const [command] = commands;
		const normalizedParameters = command.parameters
			.replaceAll(/\s+/g, "")
			.replace(/,$/, "");
		if (
			normalizedParameters !== contract.parameters ||
			command.returnType.replaceAll(/\s+/g, "") !== contract.returnType
		) {
			failures.push(
				`${contract.name} must accept its audited parameters and return the audited Result type`,
			);
		}
		const normalizedBody = command.body
			.replaceAll(/\s+/g, "")
			.replace(/;$/, "");
		if (normalizedBody !== contract.body) {
			failures.push(
				`${contract.name} must contain only its audited confirmation-service route`,
			);
		}
	}

	if (libSource === undefined) {
		failures.push(
			"command registration boundary requires src-tauri/src/lib.rs",
		);
		return failures;
	}
	const executableLib = stripRustCommentsAndLiterals(libSource);
	const handlerBodies = [
		...executableLib.matchAll(
			/\.invoke_handler\s*\(\s*tauri\s*::\s*generate_handler\s*!\s*\[([\s\S]*?)\]\s*\)/g,
		),
	];
	for (const contract of DEBUG_COMMAND_CONTRACTS) {
		const commandPath = new RegExp(
			`\\bdebug\\s*::\\s*commands\\s*::\\s*${contract.name}\\b`,
			"g",
		);
		const registrations = [...executableLib.matchAll(commandPath)];
		const registeredInHandler =
			handlerBodies.length === 1 &&
			new RegExp(
				`\\bdebug\\s*::\\s*commands\\s*::\\s*${contract.name}\\b`,
			).test(handlerBodies[0][1]);
		if (registrations.length !== 1 || !registeredInHandler) {
			failures.push(
				`src-tauri/src/lib.rs must register debug::commands::${contract.name} exactly once in generate_handler`,
			);
		}
	}

	return failures;
}

/**
 * `F100` S4's real `runInTerminal` reverse-request handling boundary: locks
 * `debug/commands.rs`'s `handle_run_in_terminal_reverse_request` to actually
 * delegate to `TerminalService::start_program` (rather than constructing a
 * subprocess itself — the "no hidden second spawn path" requirement the
 * frozen research doc's "主导会话裁定" item 4 calls for), and cross-checks
 * that `TerminalService::start_program` has *exactly one* non-test
 * production call site anywhere in the crate — a second call site appearing
 * anywhere (an accidental duplicate, or a genuinely new bypass) fails this
 * immediately, the same "count the real call sites, don't just trust one
 * audited-looking one" discipline `validateDebugCommandRegistration`'s own
 * `generate_handler!` cross-check already applies.
 */
export function validateDebugRunInTerminalBoundary(rustSources) {
	const failures = [];
	const commandsSource = findRustSource(
		rustSources,
		"src-tauri/src/debug/commands.rs",
	);
	if (commandsSource === undefined) {
		return ["debug runInTerminal boundary requires debug/commands.rs"];
	}
	const commentsOnly = stripRustCommentsOnly(commandsSource);
	const handler = rustFunctionBody(
		commentsOnly,
		"handle_run_in_terminal_reverse_request",
	);
	if (handler === undefined) {
		failures.push(
			"debug/commands.rs must define handle_run_in_terminal_reverse_request",
		);
	} else {
		const body = handler.body;
		if (!/\bterminal\s*\.\s*start_program\s*\(/.test(body)) {
			failures.push(
				"handle_run_in_terminal_reverse_request must call terminal.start_program(...) — the only sanctioned way to spawn a runInTerminal-launched process",
			);
		}
		if (
			/\bCommand(Builder)?\s*::\s*new\s*\(/.test(body) ||
			/std\s*::\s*process\s*::\s*Command/.test(body)
		) {
			failures.push(
				"handle_run_in_terminal_reverse_request must not construct a subprocess directly — it must delegate to TerminalService::start_program",
			);
		}
	}

	let productionCallSites = 0;
	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!normalizedPath.startsWith("src-tauri/src/") ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
		}
		const executableSource = stripRustCommentsAndLiterals(source);
		const matches = executableSource.match(/\.start_program\s*\(/g);
		if (matches !== null) {
			productionCallSites += matches.length;
		}
	}
	if (productionCallSites !== 1) {
		failures.push(
			`TerminalService::start_program must have exactly one non-test production call site in src-tauri/src (found ${productionCallSites})`,
		);
	}

	return failures;
}

// ---------------------------------------------------------------------
// F100 S1 — first-run confirmation gate's TypeScript boundary, mirroring
// validateGitDiscardConfirmationBoundary/validateGitNetworkConfirmationBoundary's
// exact rigor for this codebase's newest confirm-before-native-execution flow.
// ---------------------------------------------------------------------

const DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH =
	"app/features/debug/plain-debug-adapter-confirmation.ts";
const DEBUG_ADAPTER_LAUNCH_MODULE_PATH =
	"app/features/debug/plain-debug-adapter-launch.ts";

/**
 * `F100` S1's two confirm-gated bridge methods, both audited to the *same*
 * single containing function (`resolveDebugAdapterConfirmation`) — unlike
 * `GIT_NETWORK_BRIDGE_METHOD_AUDITS`'s one-method-per-view-method shape, both
 * calls here belong to the same state-machine step (query the persisted
 * decision, then — only on the unconfirmed path, only after a real user
 * answer — grant).
 */
const DEBUG_ADAPTER_CONFIRMATION_BRIDGE_METHOD_AUDITS = Object.freeze([
	Object.freeze({
		bridgeMethod: "debugAdapterConfirmationState",
		containingMethod: "resolveDebugAdapterConfirmation",
		argumentTexts: Object.freeze(["request.subject"]),
	}),
	Object.freeze({
		bridgeMethod: "debugAdapterConfirmationGrant",
		containingMethod: "resolveDebugAdapterConfirmation",
		argumentTexts: Object.freeze(["request.subject"]),
	}),
]);

/**
 * Locks three independent facts, any one of whose violation would let an
 * unconfirmed `(command, args, transport)` triple slip through silently:
 *
 * 1. `debugAdapterConfirmationState`/`debugAdapterConfirmationGrant` each
 *    have exactly one production call site, both inside
 *    `resolveDebugAdapterConfirmation`'s own body — never called directly
 *    from `plain-debug-adapter-launch.ts` or anywhere else (the same
 *    `declarationCounts`/`auditedCallCounts` technique
 *    `validateGitNetworkConfirmationBoundary` uses, generalized to a single
 *    shared containing function for both methods).
 * 2. `plain-debug-adapter-confirmation.ts`'s own audited module face: no
 *    imports at all (mirrors `validateNetworkConfirmationModuleFace` — an
 *    import is the only way this decide-only module could ever reach a
 *    bridge/dialog service itself), an exact top-level declaration set, and
 *    `resolveDebugAdapterConfirmation`'s own body matching the exact audited
 *    shape (query state; return early *without* showing the dialog only when
 *    already confirmed; otherwise *always* show it; grant only after a real
 *    `confirmed: true` answer).
 * 3. `resolveDebugAdapterConfirmation` itself has exactly one production call
 *    site — `plain-debug-adapter-launch.ts`'s `prepareDebugAdapterLaunch` —
 *    and that function's own body matches its exact audited
 *    resolve-then-gate shape (the "唯一生产调用点 + 调用点的精确方法体" the
 *    frozen research doc's AST contract item 4 calls for).
 */
export function validateDebugAdapterConfirmationBoundary(appSources) {
	const failures = [];
	const normalizedSources = new Map(
		appSources.map(({ relativePath, source }) => [
			relativePath.replaceAll("\\", "/"),
			source,
		]),
	);
	const requiredPaths = Object.freeze([
		...GIT_DISCARD_DECLARATION_PATHS,
		DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH,
		DEBUG_ADAPTER_LAUNCH_MODULE_PATH,
	]);
	for (const relativePath of requiredPaths) {
		if (!normalizedSources.has(relativePath)) {
			failures.push(
				`debug adapter confirmation boundary requires ${relativePath}`,
			);
		}
	}

	function containingFunctionName(node) {
		let current = node.parent;
		while (current !== undefined) {
			if (
				ts.isMethodDeclaration(current) ||
				ts.isFunctionDeclaration(current)
			) {
				return typeScriptStaticName(current.name);
			}
			current = current.parent;
		}
		return undefined;
	}

	const bridgeMethodNames = DEBUG_ADAPTER_CONFIRMATION_BRIDGE_METHOD_AUDITS.map(
		(audit) => audit.bridgeMethod,
	);
	const declarationCounts = new Map(
		GIT_DISCARD_DECLARATION_PATHS.flatMap((relativePath) =>
			bridgeMethodNames.map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	const auditedCallCounts = new Map(
		bridgeMethodNames.map((bridgeMethod) => [bridgeMethod, 0]),
	);
	let resolveConfirmationCallCount = 0;

	for (const [normalizedPath, source] of normalizedSources) {
		if (!normalizedPath.endsWith(".ts") && !normalizedPath.endsWith(".tsx")) {
			continue;
		}
		const sourceFile = ts.createSourceFile(
			normalizedPath,
			source,
			ts.ScriptTarget.Latest,
			true,
			normalizedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const isKnownBridge = collectTypeScriptBridgeAliases(sourceFile);

		function visit(node) {
			const isNameLike =
				ts.isIdentifier(node) ||
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node);
			const audit = isNameLike
				? DEBUG_ADAPTER_CONFIRMATION_BRIDGE_METHOD_AUDITS.find(
						(candidate) => candidate.bridgeMethod === node.text,
					)
				: undefined;
			if (audit !== undefined) {
				const bridgeMethod = audit.bridgeMethod;
				const parent = node.parent;
				const isPlatformBridgeDeclaration =
					(normalizedPath === "app/platform/tauri/contracts.ts" &&
						ts.isMethodSignature(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/native.ts" &&
						ts.isPropertyAssignment(parent) &&
						parent.name === node) ||
					(normalizedPath === "app/platform/tauri/browser-mock.ts" &&
						(ts.isMethodDeclaration(parent) ||
							ts.isPropertyAssignment(parent)) &&
						parent.name === node);
				// `plain-debug-adapter-confirmation.ts`'s own
				// `DebugAdapterConfirmBridge` structural interface re-declares these
				// two method names as method signatures (the narrow bridge shape
				// this module needs) — a fourth, in-file declaration site
				// `validateGitNetworkConfirmationBoundary`'s own
				// `NetworkConfirmDialogService` sibling never needed (that
				// interface only ever declares `confirm`, never the audited bridge
				// method names themselves, because git's confirmation module never
				// calls a bridge method at all — this one does, by design, so it
				// must declare the shape it calls). Deliberately not counted in
				// `declarationCounts` (that map only tracks the three platform
				// files' exactly-once-each requirement) — this is a fourth,
				// separately-legitimate reference that needs only to be excluded
				// from the "must be an audited call" branch below, not counted
				// anywhere.
				const isOwnInterfaceDeclaration =
					normalizedPath === DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH &&
					ts.isMethodSignature(parent) &&
					parent.name === node;
				if (isPlatformBridgeDeclaration) {
					const key = `${normalizedPath}:${bridgeMethod}`;
					declarationCounts.set(key, declarationCounts.get(key) + 1);
				} else if (isOwnInterfaceDeclaration) {
					// No-op: a legitimate structural-interface declaration, not a call.
				} else {
					const propertyAccess = ts.isIdentifier(node) ? parent : undefined;
					const directCall =
						propertyAccess !== undefined &&
						ts.isPropertyAccessExpression(propertyAccess) &&
						propertyAccess.name === node &&
						ts.isCallExpression(propertyAccess.parent) &&
						propertyAccess.parent.expression === propertyAccess &&
						isKnownBridge(propertyAccess.expression)
							? propertyAccess.parent
							: undefined;
					const argumentTexts =
						directCall?.arguments.map((argument) =>
							argument.getText(sourceFile).replaceAll(/\s+/g, ""),
						) ?? [];
					const isAuditedCall =
						directCall !== undefined &&
						normalizedPath === DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH &&
						containingFunctionName(node) === audit.containingMethod &&
						sameArray(argumentTexts, audit.argumentTexts);
					if (isAuditedCall) {
						auditedCallCounts.set(
							bridgeMethod,
							auditedCallCounts.get(bridgeMethod) + 1,
						);
					} else {
						failures.push(
							`${normalizedPath} must not consume ${bridgeMethod} outside resolveDebugAdapterConfirmation's single audited call site`,
						);
					}
				}
			}
			if (
				ts.isIdentifier(node) &&
				node.text === "resolveDebugAdapterConfirmation" &&
				ts.isCallExpression(node.parent) &&
				node.parent.expression === node
			) {
				if (
					normalizedPath === DEBUG_ADAPTER_LAUNCH_MODULE_PATH &&
					containingFunctionName(node) === "prepareDebugAdapterLaunch"
				) {
					resolveConfirmationCallCount += 1;
				} else if (normalizedPath !== DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH) {
					failures.push(
						`${normalizedPath} must not call resolveDebugAdapterConfirmation outside plain-debug-adapter-launch.ts's prepareDebugAdapterLaunch`,
					);
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	for (const [key, count] of declarationCounts) {
		if (count !== 1) {
			const [relativePath, bridgeMethod] = key.split(":");
			failures.push(
				`${relativePath} must declare ${bridgeMethod} exactly once in its audited bridge surface`,
			);
		}
	}
	for (const audit of DEBUG_ADAPTER_CONFIRMATION_BRIDGE_METHOD_AUDITS) {
		if (auditedCallCounts.get(audit.bridgeMethod) !== 1) {
			failures.push(
				`${audit.bridgeMethod} must have exactly one production call site, inside resolveDebugAdapterConfirmation`,
			);
		}
	}
	if (resolveConfirmationCallCount !== 1) {
		failures.push(
			"resolveDebugAdapterConfirmation must have exactly one production call site, inside plain-debug-adapter-launch.ts's prepareDebugAdapterLaunch",
		);
	}

	const confirmationModuleSource = normalizedSources.get(
		DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH,
	);
	if (confirmationModuleSource !== undefined) {
		failures.push(
			...validateDebugAdapterConfirmationModuleFace(confirmationModuleSource),
		);
	}
	const launchModuleSource = normalizedSources.get(
		DEBUG_ADAPTER_LAUNCH_MODULE_PATH,
	);
	if (launchModuleSource !== undefined) {
		failures.push(...validateDebugAdapterLaunchGuardedCall(launchModuleSource));
	}

	return [...new Set(failures)];
}

/**
 * Locks `plain-debug-adapter-confirmation.ts`'s own audited module face —
 * mirrors `validateNetworkConfirmationModuleFace`'s exact technique: it must
 * import nothing at all, its top-level declarations must match the exact
 * audited set, and `resolveDebugAdapterConfirmation` itself must match the
 * exact audited body — which simultaneously proves it never calls a bridge
 * method itself outside the audited pattern and never has a branch that
 * skips the dialog for an unconfirmed subject.
 */
function validateDebugAdapterConfirmationModuleFace(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		DEBUG_ADAPTER_CONFIRMATION_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-debug-adapter-confirmation.ts must remain valid TypeScript"];
	}

	if (
		sourceFile.statements.some((statement) => ts.isImportDeclaration(statement))
	) {
		failures.push(
			"plain-debug-adapter-confirmation.ts must not import anything — it only ever decides whether the caller may proceed, and an import is the only way it could ever reach a bridge/dialog service itself",
		);
	}

	const expectedTopLevel = new Map([
		["DebugAdapterConfirmBridge", { kind: "interface", exported: true }],
		["DebugAdapterConfirmDialogService", { kind: "interface", exported: true }],
		["DebugAdapterConfirmationSubject", { kind: "interface", exported: true }],
		["DebugAdapterConfirmationRequest", { kind: "interface", exported: true }],
		["quoteArgIfNeeded", { kind: "function", exported: false }],
		["debugAdapterCommandLine", { kind: "function", exported: true }],
		["debugAdapterConfirmationMessage", { kind: "function", exported: true }],
		["debugAdapterConfirmationDetail", { kind: "function", exported: true }],
		[
			"DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON",
			{ kind: "variable", exported: true },
		],
		["DebugAdapterConfirmDecision", { kind: "type", exported: true }],
		[
			"resolveDebugAdapterConfirmation",
			{ kind: "function", exported: true, async: true },
		],
	]);
	const topLevelCounts = new Map(
		[...expectedTopLevel].map(([name]) => [name, 0]),
	);
	let topLevelIsExact = true;
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			continue;
		}
		let name;
		let kind;
		if (ts.isVariableStatement(statement)) {
			if (statement.declarationList.declarations.length !== 1) {
				topLevelIsExact = false;
				continue;
			}
			name = statement.declarationList.declarations[0].name;
			kind = "variable";
		} else if (ts.isFunctionDeclaration(statement)) {
			name = statement.name;
			kind = "function";
		} else if (ts.isInterfaceDeclaration(statement)) {
			name = statement.name;
			kind = "interface";
		} else if (ts.isTypeAliasDeclaration(statement)) {
			name = statement.name;
			kind = "type";
		} else {
			topLevelIsExact = false;
			continue;
		}
		const expected = ts.isIdentifier(name)
			? expectedTopLevel.get(name.text)
			: undefined;
		const modifierKinds = (statement.modifiers ?? []).map(
			(modifier) => modifier.kind,
		);
		const expectedModifiers = [
			...(expected?.exported ? [ts.SyntaxKind.ExportKeyword] : []),
			...(expected?.async ? [ts.SyntaxKind.AsyncKeyword] : []),
		];
		if (
			expected === undefined ||
			expected.kind !== kind ||
			!sameArray(modifierKinds, expectedModifiers)
		) {
			topLevelIsExact = false;
		} else {
			topLevelCounts.set(name.text, topLevelCounts.get(name.text) + 1);
		}
	}
	if (
		!topLevelIsExact ||
		[...topLevelCounts.values()].some((count) => count !== 1)
	) {
		failures.push(
			"plain-debug-adapter-confirmation.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	}

	const resolveFunctions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "resolveDebugAdapterConfirmation",
	);
	const expectedResolveBody = `{
		const state = await bridge.debugAdapterConfirmationState(request.subject);
		if (state.confirmed) {
			return Object.freeze({ kind: "already-confirmed" });
		}
		const confirmation = await dialogService.confirm({
			message: debugAdapterConfirmationMessage(request),
			detail: debugAdapterConfirmationDetail(request),
			primaryButton: DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON,
		});
		if (!confirmation.confirmed) {
			return Object.freeze({ kind: "declined" });
		}
		await bridge.debugAdapterConfirmationGrant(request.subject);
		return Object.freeze({ kind: "confirmed" });
	}`.replaceAll(/\s+/g, "");
	if (
		resolveFunctions.length !== 1 ||
		resolveFunctions[0].body === undefined ||
		resolveFunctions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedResolveBody
	) {
		failures.push(
			"resolveDebugAdapterConfirmation must query the persisted decision first, always show the dialog for an unconfirmed subject, and never call a bridge method itself outside the exact audited shape",
		);
	}
	return failures;
}

/**
 * Locks `plain-debug-adapter-launch.ts`'s `prepareDebugAdapterLaunch` to its
 * exact "parse, resolve, gate-then-return" body shape — the "调用点的精确方法
 * 体" half of the frozen research doc's AST contract item 4, mirroring
 * `validateNetworkMutationGuardedCalls`'s per-function exact-body technique
 * (applied here to a standalone exported function rather than a class
 * method, since there is no `PlainDebugView` class yet in this slice).
 */
function validateDebugAdapterLaunchGuardedCall(source) {
	const sourceFile = ts.createSourceFile(
		DEBUG_ADAPTER_LAUNCH_MODULE_PATH,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (sourceFile.parseDiagnostics.length > 0) {
		return ["plain-debug-adapter-launch.ts must remain valid TypeScript"];
	}

	const functions = sourceFile.statements.filter(
		(statement) =>
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === "prepareDebugAdapterLaunch",
	);
	const expectedBody = `{
		const registryResult =
			registryBytes === null
				? Object.freeze({ kind: "ok" as const, value: Object.freeze([]) })
				: parseDebugAdapterRegistry(registryBytes);
		if (registryResult.kind === "error") {
			return Object.freeze({
				kind: "invalid-registry",
				reason: registryResult.reason,
			});
		}
		const launchResult = parseLaunchConfigurations(launchConfigurationBytes);
		if (launchResult.kind === "error") {
			return Object.freeze({
				kind: "invalid-launch-configuration",
				reason: launchResult.reason,
			});
		}
		const configuration = launchResult.value.find(
			(candidate) => candidate.name === configurationName,
		);
		if (configuration === undefined) {
			return Object.freeze({
				kind: "configuration-not-found",
				name: configurationName,
			});
		}
		const resolved = resolveAdapterDescriptor(
			configuration,
			registryResult.value,
		);
		if (resolved.kind === "adapter-not-found") {
			return Object.freeze({ kind: "adapter-not-found", type: resolved.type });
		}
		const decision = await resolveDebugAdapterConfirmation(
			bridge,
			dialogService,
			{
				subject: {
					command: resolved.descriptor.command,
					args: resolved.descriptor.args,
					transport: resolved.descriptor.transport,
				},
				configSource: resolved.configSource,
			},
		);
		if (decision.kind === "declined") {
			return Object.freeze({ kind: "declined" });
		}
		return Object.freeze({
			kind: "ready",
			descriptor: resolved.descriptor,
			configSource: resolved.configSource,
			warnings: resolved.warnings,
			launchArguments: configuration.launchArguments,
		});
	}`.replaceAll(/\s+/g, "");
	if (
		functions.length !== 1 ||
		functions[0].body === undefined ||
		functions[0].body.getText(sourceFile).replaceAll(/\s+/g, "") !==
			expectedBody
	) {
		return [
			"prepareDebugAdapterLaunch must match its exact audited parse-resolve-then-gate shape — no other shape may reach resolveDebugAdapterConfirmation",
		];
	}
	return [];
}
