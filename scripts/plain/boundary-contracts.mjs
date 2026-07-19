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

const EXPECTED_CAPABILITY_KEYS = Object.freeze([
	"$schema",
	"description",
	"identifier",
	"permissions",
	"windows",
]);

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
				parent.expression.text === "registerWorkspaceCommands")
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
	if (calls.registerCustomProvider !== 1) {
		failures.push(
			"app/main.ts must register exactly one custom workspace provider",
		);
	}
	if (registrationIndexes.length !== 1) {
		failures.push(
			"app/main.ts must unconditionally register only the audited plain-workspace provider",
		);
	}
	if (
		calls.workspaceSnapshot !== 1 ||
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
			coordinatorIndexes[0] !== providerIndexes[0] + 1) ||
		(coordinatorIndexes[0] !== undefined &&
			registrationIndexes[0] !== coordinatorIndexes[0] + 1)
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

export function validateCapabilityFiles(fileNames) {
	return sameArray([...fileNames].sort(), ["main.json"])
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
	/^src-tauri\/src\/(?:path_policy\.rs|workspace\/.*\.rs)$/;
const RUST_PRODUCTION_SOURCE_PATTERN = /^src-tauri\/src\/.*\.rs$/;
const WORKSPACE_TEST_SOURCE_PATTERN = /(?:^|\/)tests\.rs$/;
const WORKSPACE_VERSIONED_WRITER_PATH =
	"src-tauri/src/workspace/versioned_writer.rs";
const RUSTIX_TARGET = 'cfg(any(target_os = "linux", target_os = "macos"))';
const SHA2_VERSION = "0.10.9";
const SHA2_REQUIREMENT = `=${SHA2_VERSION}`;
const SHA2_RESOLVED_FEATURES = Object.freeze(["default", "std"]);
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
		nativeBridgeBodyStatements.length !== 1 ||
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
		if (
			/\b(?:std|tokio|async_process)\s*::\s*(?:\{[^;}]*\bprocess\b|process\b)|\btauri_plugin_shell\b|\b(?:Command|Shell)\s*::\s*new\s*\(/s.test(
				executableSource,
			) ||
			/\b(?:async_process|duct|subprocess|xshell)\b/.test(executableSource) ||
			/\b(?:libc|nix)\s*::(?:\s*[A-Za-z_]\w*\s*::)*\s*(?:remove|rmdir|system|posix_spawn|execv|execve|fork)\b/.test(
				executableSource,
			) ||
			/\bextern\s+"C"\s*\{[^}]*\bfn\s+(?:remove|rmdir|system|posix_spawn|execv|execve|fork)\b/s.test(
				executableSource,
			) ||
			/\b(?:use\s+std\s+as\b|extern\s+crate\s+std\b)/.test(executableSource)
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
		ts.isStringLiteral(member.name) ||
		ts.isNumericLiteral(member.name)
	) {
		return member.name.text;
	}
	return undefined;
}

function collectProviderCapabilityFlags(expression, flags) {
	if (ts.isParenthesizedExpression(expression)) {
		return collectProviderCapabilityFlags(expression.expression, flags);
	}
	if (
		ts.isBinaryExpression(expression) &&
		expression.operatorToken.kind === ts.SyntaxKind.BarToken
	) {
		return (
			collectProviderCapabilityFlags(expression.left, flags) &&
			collectProviderCapabilityFlags(expression.right, flags)
		);
	}
	if (
		ts.isPropertyAccessExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === "FileSystemProviderCapabilities"
	) {
		flags.push(expression.name.text);
		return true;
	}
	return false;
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
 * Locks the only confirmed-delete application route. The coordinator may own
 * prepare/cancel/begin, the provider may own commit, and the private Workbench
 * authorization helpers may be consumed only at their fixed typestate sites.
 */
export function validateWorkspaceDeleteTypeScriptBoundary(appSources) {
	const failures = [];
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
	const capabilityMembers = provider.members.filter(
		(member) =>
			ts.isPropertyDeclaration(member) &&
			typeScriptMemberName(member) === "capabilities",
	);
	const flags = [];
	if (
		capabilityMembers.length !== 1 ||
		capabilityMembers[0].initializer === undefined ||
		!capabilityMembers[0].modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
		) ||
		!collectProviderCapabilityFlags(capabilityMembers[0].initializer, flags) ||
		!sameArray(flags.sort(), ["FileReadWrite", "Readonly"])
	) {
		failures.push(
			"confirmed delete must not remove Readonly or advertise Trash/atomic provider capabilities",
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
				await this.bridge.workspaceCommitDeleteEntry(
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
			new Set(["value:Disposable", "type:IDisposable"]),
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
		const [constructor] = constructors;
		const [bridgeParameter, policyParameter] = constructor.parameters;
		function exactPrivateReadonlyParameter(parameter, name, typeName) {
			return (
				parameter !== undefined &&
				ts.isIdentifier(parameter.name) &&
				parameter.name.text === name &&
				parameter.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
				) &&
				parameter.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
				) &&
				parameter.type !== undefined &&
				ts.isTypeReferenceNode(parameter.type) &&
				ts.isIdentifier(parameter.type.typeName) &&
				parameter.type.typeName.text === typeName
			);
		}
		function exactPrivateReadonlyBoolean(parameter, name) {
			return (
				parameter !== undefined &&
				ts.isIdentifier(parameter.name) &&
				parameter.name.text === name &&
				parameter.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
				) &&
				parameter.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
				) &&
				parameter.type?.kind === ts.SyntaxKind.BooleanKeyword
			);
		}
		if (
			constructor.parameters.length !== 2 ||
			constructor.body?.statements.length !== 0 ||
			constructor.modifiers?.some(
				(modifier) =>
					modifier.kind === ts.SyntaxKind.PublicKeyword ||
					modifier.kind === ts.SyntaxKind.ProtectedKeyword,
			) ||
			!exactPrivateReadonlyParameter(
				bridgeParameter,
				"bridge",
				"PlainBridge",
			) ||
			!exactPrivateReadonlyBoolean(policyParameter, "allowsMutationDispatch")
		) {
			failures.push(
				"Plain workspace provider constructor must retain only the bridge and immutable mutation boolean",
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
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === methodName &&
				ts.isPropertyAccessExpression(node.expression.expression) &&
				node.expression.expression.name.text === receiverName &&
				node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
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
				"{if(!this.allowsMutationDispatch){thrownoPermissions();}}"
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
					await this.bridge.${bridgeMethod}(
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
				const receipt = (await this.bridge.workspaceCopy(
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
					const receipt = (await this.bridge.workspaceRename(
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
					await this.bridge.workspaceMove(
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
					throw workspaceMoveIncomplete();
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
			identifierCallCount(renameMethod, "workspaceMoveIncomplete") !== 2 ||
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
	} else {
		const capabilityMember = capabilityMembers[0];
		const flags = [];
		const isReadonlyDeclaration = capabilityMember.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
		);
		const isExactCapabilityExpression =
			capabilityMember.initializer !== undefined &&
			collectProviderCapabilityFlags(capabilityMember.initializer, flags) &&
			sameArray(flags.sort(), ["FileReadWrite", "Readonly"]);
		if (!isReadonlyDeclaration || !isExactCapabilityExpression) {
			failures.push(
				"Plain workspace provider capabilities must remain exactly FileReadWrite | Readonly",
			);
		}
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
		["workspaceStat", 1],
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
		["workspaceMoveIncomplete", 2],
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
	function isThisBridge(node) {
		return (
			ts.isPropertyAccessExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ThisKeyword &&
			node.name.text === "bridge"
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
		if (ts.isIdentifier(node) && node.text === "FileFolderCopy") {
			failures.push(
				"Plain workspace provider must not advertise FileFolderCopy before activation",
			);
			return;
		}
		if (
			ts.isIdentifier(node) &&
			(node.text === "Trash" || node.text === "FileAtomicDelete")
		) {
			failures.push(
				`Plain workspace provider must not advertise ${node.text} before activation`,
			);
			return;
		}
		if (
			ts.isIdentifier(node) &&
			node.text === "PlainWorkspaceFileSystemProvider" &&
			!allowedProviderIdentifiers.has(node)
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
			hasCapabilitiesReference = true;
		}
		if (
			(ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
			node.text === "allowsMutationDispatch"
		) {
			mutationDispatchReferences += 1;
		}
		if (isThisBridge(node)) {
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
					"every this.bridge reference must be the receiver of one fixed direct provider call",
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
			node.text === "WorkspaceMoveIncompleteError" &&
			!bindingIdentifierNodes.has(node)
		) {
			const isTypeReference = isCriticalTypeReference(node);
			const isDirectConstruction =
				ts.isNewExpression(node.parent) && node.parent.expression === node;
			if (isDirectConstruction) {
				moveIncompleteConstructionCount += 1;
			} else if (!isTypeReference) {
				failures.push(
					"WorkspaceMoveIncompleteError must not be aliased or consumed outside its audited constructor",
				);
			}
		}
		if (isProviderDescendant(node) && node.kind === ts.SyntaxKind.ThisKeyword) {
			const parent = node.parent;
			if (
				!ts.isPropertyAccessExpression(parent) ||
				parent.expression !== node ||
				(!expectedProviderMembers.has(parent.name.text) &&
					parent.name.text !== "bridge" &&
					parent.name.text !== "allowsMutationDispatch")
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
			const isDirectThisProperty =
				ts.isPropertyAccessExpression(node.parent) &&
				node.parent.name === node &&
				node.parent.expression.kind === ts.SyntaxKind.ThisKeyword;
			if (!isConstructorParameter && !isDirectThisProperty) {
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
				node.expression.name.text === "bridge";
			if (!isDirectBridgeCall) {
				failures.push(
					`${node.name.text} may appear only as a direct this.bridge call in its audited mutation seam`,
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
			"PlainWorkspaceFileSystemProvider may be referenced only by its declaration and audited factory",
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
			"Plain workspace provider capabilities must not be referenced outside their readonly declaration",
		);
	}
	if (mutationDispatchReferences !== 2) {
		failures.push(
			"Plain workspace mutation boolean may appear only in its constructor parameter and dispatch gate",
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
				`${methodName} must have exactly one fixed direct this.bridge call site`,
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
	if (
		fireCreatedCallCount !== 3 ||
		fireDeletedCallCount !== 1 ||
		fireMovedCallCount !== 2 ||
		fireRootUpdatedCallCount !== 7 ||
		fireRootsUpdatedCallCount !== 2 ||
		changeEmitterFireCallCount !== 7
	) {
		failures.push(
			"provider change events must remain confined to the audited create, copy, rename, move and rescan closure",
		);
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
