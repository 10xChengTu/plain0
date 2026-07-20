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
	"setRootFolder",
	"removeRootFolder",
	"workbench.action.addRootFolder",
	"workbench.action.removeRootFolder",
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

function descendants(node, predicate) {
	const matches = [];
	function visit(candidate) {
		if (predicate(candidate)) {
			matches.push(candidate);
		}
		ts.forEachChild(candidate, visit);
	}
	visit(node);
	return matches;
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

function callName(call) {
	if (!ts.isCallExpression(call)) {
		return undefined;
	}
	const chain = propertyChain(call.expression);
	return chain?.at(-1);
}

function callsNamed(node, name) {
	return descendants(
		node,
		(candidate) =>
			ts.isCallExpression(candidate) && callName(candidate) === name,
	);
}

function callWithChain(node, chain) {
	return descendants(
		node,
		(candidate) =>
			ts.isCallExpression(candidate) && sameChain(candidate.expression, chain),
	);
}

function variableDeclarations(sourceFile, name) {
	return descendants(
		sourceFile,
		(node) =>
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name,
	);
}

function callableDeclarations(sourceFile, name) {
	const declarations = [];
	for (const node of descendants(sourceFile, () => true)) {
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
	return descendants(
		sourceFile,
		(node) =>
			ts.isVariableDeclaration(node) &&
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

function propertyName(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
		return name.text;
	}
	return undefined;
}

function importsNamedValue(sourceFile, moduleName, importedName) {
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
				element.name.text === importedName
			) {
				matches.push(element);
			}
		}
	}
	return matches.length === 1;
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
	const bootstrap = callableBody(sourceFile, "bootstrap");
	if (bootstrap === undefined) {
		return false;
	}
	const rootDeclarations = declarationInitializedByCall(
		bootstrap,
		"createPlainWorkspaceFileSystemProvider",
	);
	const configurationDeclarations = declarationInitializedByCall(
		bootstrap,
		"createPlainWorkspaceConfigurationProvider",
	);
	if (
		rootDeclarations.length !== 1 ||
		configurationDeclarations.length !== 1 ||
		!ts.isIdentifier(rootDeclarations[0].name) ||
		!ts.isIdentifier(configurationDeclarations[0].name) ||
		callsNamed(bootstrap, "createPlainWorkspaceFileSystemProvider").length !==
			1 ||
		callsNamed(bootstrap, "createPlainWorkspaceConfigurationProvider")
			.length !== 1
	) {
		return false;
	}
	const rootName = rootDeclarations[0].name.text;
	const configurationName = configurationDeclarations[0].name.text;
	const configurationReferences = descendants(
		bootstrap,
		(node) => ts.isIdentifier(node) && node.text === configurationName,
	);
	if (configurationReferences.length !== 3) {
		return false;
	}
	const registrations = callsNamed(bootstrap, "registerCustomProvider");
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
		rootRegistration.pos >= configurationRegistration.pos
	) {
		return false;
	}

	const coordinators = declarationInitializedByCall(
		bootstrap,
		"createWorkspaceTopologyCoordinator",
	);
	if (
		coordinators.length !== 1 ||
		callsNamed(bootstrap, "createWorkspaceTopologyCoordinator").length !== 1 ||
		!ts.isIdentifier(coordinators[0].name)
	) {
		return false;
	}
	const coordinatorCall = unwrapExpression(coordinators[0].initializer);
	const coordinatorName = coordinators[0].name.text;
	if (
		coordinatorCall.arguments.length !== 5 ||
		!sameChain(coordinatorCall.arguments[0], [configurationName]) ||
		!sameChain(coordinatorCall.arguments[1], ["reinitializeWorkspace"]) ||
		coordinatorCall.pos <= configurationRegistration.pos
	) {
		return false;
	}

	const prepare = callWithChain(bootstrap, [coordinatorName, "prepareInitial"]);
	const initialize = callsNamed(bootstrap, "initialize");
	const complete = callWithChain(bootstrap, [
		coordinatorName,
		"completeInitial",
	]);
	const apply = callWithChain(bootstrap, [coordinatorName, "apply"]);
	const commands = callsNamed(bootstrap, "registerWorkspaceCommands");
	if (
		prepare.length !== 1 ||
		initialize.length !== 1 ||
		complete.length !== 1 ||
		apply.length !== 0 ||
		commands.length !== 1 ||
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
	if (!ts.isBlock(body) || coordinator.parameters.length !== 5) {
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
		!fatalOnlyCatchAround(reinitialize, dispatches[0]) ||
		fatalGuards.length !== 1 ||
		descendants(
			fatalGuards[0].thenStatement,
			(node) =>
				ts.isThrowStatement(node) && sameChain(node.expression, ["fatalError"]),
		).length !== 1 ||
		fatalGuards[0].pos >= dispatches[0].pos ||
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
	const applyMethod = objectProperty(returned, "apply");
	const mutationMethod = objectProperty(returned, "runMutation");
	const mutationInQueue = callableBody(body, "runMutationInQueue");
	const rejectedMutation = callableBody(body, "reconcileRejectedMutation");
	if (
		!ts.isMethodDeclaration(complete) ||
		!ts.isMethodDeclaration(applyMethod) ||
		!ts.isMethodDeclaration(mutationMethod) ||
		mutationInQueue === undefined ||
		rejectedMutation === undefined
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

function validateGuardedCommands(sourceFile) {
	if (
		sourceFile.parseDiagnostics.length !== 0 ||
		!importsNamedValue(
			sourceFile,
			"../../services/plain-workspace-services",
			"PlainWorkspaceOperationUnsupportedError",
		)
	) {
		return false;
	}
	const declarations = variableDeclarations(
		sourceFile,
		"GUARDED_WORKSPACE_COMMAND_IDS",
	);
	if (
		declarations.length !== 1 ||
		!sameStringArray(
			arrayLiteralStrings(declarations[0].initializer),
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
	if (
		!ts.isCallExpression(registration) ||
		!sameChain(registration.expression, [
			"CommandsRegistry",
			"registerCommand",
		]) ||
		registration.arguments.length !== 2 ||
		!sameChain(registration.arguments[0], [idName])
	) {
		return false;
	}
	const handler = unwrapExpression(registration.arguments[1]);
	const pickDeclarations = variableDeclarations(sourceFile, "pickRoots");
	const pickInitializer =
		pickDeclarations.length === 1
			? unwrapExpression(pickDeclarations[0].initializer)
			: undefined;
	const queuedMutation =
		ts.isArrowFunction(pickInitializer) ||
		ts.isFunctionExpression(pickInitializer)
			? directReturnedExpression(pickInitializer.body)
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
	const nativePicks =
		ts.isArrowFunction(mutationCallback) ||
		ts.isFunctionExpression(mutationCallback)
			? callWithChain(mutationCallback, ["bridge", "workspacePickRoots"])
			: [];
	const mutationResultObject =
		ts.isArrowFunction(mutationCallback) ||
		ts.isFunctionExpression(mutationCallback)
			? unwrapFreeze(directReturnedExpression(mutationCallback.body))
			: undefined;
	const mutationSnapshotProperty = objectProperty(
		mutationResultObject,
		"snapshot",
	);
	const mutationSnapshot = ts.isPropertyAssignment(mutationSnapshotProperty)
		? unwrapExpression(mutationSnapshotProperty.initializer)
		: undefined;
	return (
		(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
		handler.parameters.length === 0 &&
		isPromiseRejectNew(
			expressionBody(handler),
			"PlainWorkspaceOperationUnsupportedError",
		) &&
		ts.isCallExpression(queuedMutation) &&
		(ts.isArrowFunction(mutationCallback) ||
			ts.isFunctionExpression(mutationCallback)) &&
		mutationCallback.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		) === true &&
		nativePicks.length === 1 &&
		nativePicks[0].arguments.length === 1 &&
		sameChain(nativePicks[0].arguments[0], ["mode"]) &&
		callWithChain(sourceFile, ["bridge", "workspacePickRoots"]).length === 1 &&
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
		sameChain(mutationSnapshot.whenFalse, ["undefined"])
	);
}

function validateTopologyAuthority(sourceEntries) {
	const parsed = sourceEntries.map(({ relativePath, source }) =>
		parse(relativePath, source),
	);
	if (parsed.some((sourceFile) => sourceFile.parseDiagnostics.length !== 0)) {
		return false;
	}
	const dynamicImports = parsed.flatMap((sourceFile) =>
		descendants(
			sourceFile,
			(node) =>
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword,
		),
	);
	const moduleImports = parsed.flatMap((sourceFile) =>
		sourceFile.statements
			.filter(
				(statement) =>
					(ts.isImportDeclaration(statement) ||
						ts.isExportDeclaration(statement)) &&
					ts.isStringLiteralLike(statement.moduleSpecifier),
			)
			.map((statement) => ({
				moduleName: statement.moduleSpecifier.text,
				sourceFile,
				statement,
			})),
	);
	const providerAuthorityImports = moduleImports.filter(
		({ moduleName, statement }) => {
			if (
				!moduleName.startsWith(
					"@codingame/monaco-vscode-files-service-override",
				)
			) {
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
							"registerCustomProvider",
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
							"registerCustomProvider",
					))
			);
		},
	);
	const configurationAuthorityImports = moduleImports.filter(({ moduleName }) =>
		/(?:^|\/)workspace-configuration-provider(?:\.(?:ts|js))?$/u.test(
			moduleName,
		),
	);
	const commandRegistryModule =
		"@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
	const monacoApiModule = "@codingame/monaco-vscode-api/monaco";
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
	const providerFactories = parsed.flatMap((sourceFile) =>
		callsNamed(sourceFile, "createPlainWorkspaceConfigurationProvider").map(
			(call) => ({ call, sourceFile }),
		),
	);
	const providerRegistrations = parsed.flatMap((sourceFile) =>
		callsNamed(sourceFile, "registerCustomProvider").map((call) => ({
			call,
			sourceFile,
		})),
	);
	const commandRegistrations = parsed.flatMap((sourceFile) =>
		callsNamed(sourceFile, "registerCommand").map((call) => ({
			call,
			sourceFile,
		})),
	);
	const guardedIdLeaks = parsed.flatMap((sourceFile) =>
		descendants(
			sourceFile,
			(node) =>
				ts.isStringLiteralLike(node) &&
				EXPECTED_GUARDED_WORKSPACE_COMMAND_IDS.includes(node.text) &&
				sourceFile.fileName !== "app/features/workspace/commands.ts",
		),
	);
	return (
		dynamicImports.length === 0 &&
		providerAuthorityImports.length === 1 &&
		providerAuthorityImports[0].sourceFile.fileName === "app/main.ts" &&
		providerAuthorityImports[0].moduleName ===
			"@codingame/monaco-vscode-files-service-override" &&
		ts.isImportDeclaration(providerAuthorityImports[0].statement) &&
		configurationAuthorityImports.length === 1 &&
		configurationAuthorityImports[0].sourceFile.fileName === "app/main.ts" &&
		ts.isImportDeclaration(configurationAuthorityImports[0].statement) &&
		commandAuthorityImports.length === 2 &&
		sameStringArray(
			commandAuthorityImports
				.map(
					({ moduleName, sourceFile }) =>
						`${sourceFile.fileName}:${moduleName}`,
				)
				.sort(),
			[
				`app/excluded-surfaces.ts:${monacoApiModule}`,
				`app/features/workspace/commands.ts:${commandRegistryModule}`,
			],
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
		providerFactories.length === 1 &&
		providerFactories[0].sourceFile.fileName === "app/main.ts" &&
		providerRegistrations.length === 2 &&
		providerRegistrations.every(
			({ sourceFile }) => sourceFile.fileName === "app/main.ts",
		) &&
		commandRegistrations.length === 4 &&
		commandRegistrations.every(
			({ sourceFile }) =>
				sourceFile.fileName === "app/features/workspace/commands.ts",
		) &&
		guardedIdLeaks.length === 0 &&
		parsed.flatMap((sourceFile) =>
			callsNamed(sourceFile, "projectWorkspaceSnapshot"),
		).length === 0
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
	const main = parse("app/main.ts", sourceValue(sources, "main", "mainSource"));
	const services = parse(
		"app/services.ts",
		sourceValue(sources, "services", "servicesSource"),
	);
	const commands = parse(
		"app/features/workspace/commands.ts",
		sourceValue(sources, "commands", "commandsSource"),
	);
	const projection = parse(
		"app/features/workspace/workspace-projection.ts",
		sourceValue(
			sources,
			"projection",
			"workspaceProjection",
			"workspaceProjectionSource",
		),
	);
	const configurationProvider = parse(
		"app/features/workspace/workspace-configuration-provider.ts",
		sourceValue(
			sources,
			"configurationProvider",
			"workspaceConfigurationProvider",
			"workspaceConfigurationProviderSource",
		),
	);
	const plainServicesSource = sourceValue(
		sources,
		"plainWorkspaceServices",
		"plainWorkspaceServicesSource",
	);
	const excludedSurfacesSource = sourceValue(
		sources,
		"excludedSurfaces",
		"excludedSurfacesSource",
	);
	const sourceEntries = Array.isArray(sources?.appSources)
		? sources.appSources
		: [
				{ relativePath: "app/main.ts", source: main.text },
				{ relativePath: "app/services.ts", source: services.text },
				{
					relativePath: "app/features/workspace/commands.ts",
					source: commands.text,
				},
				{
					relativePath: "app/features/workspace/workspace-projection.ts",
					source: projection.text,
				},
				{
					relativePath:
						"app/features/workspace/workspace-configuration-provider.ts",
					source: configurationProvider.text,
				},
				{
					relativePath: "app/excluded-surfaces.ts",
					source: excludedSurfacesSource,
				},
			];
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
	if (!safelyValidate(validateTopologyAuthority, sourceEntries)) {
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
			!safelyValidate(
				validatePlainServiceImplementation,
				parse("app/services/plain-workspace-services.ts", plainServicesSource),
			))
	) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.services);
	}
	if (!safelyValidate(validateGuardedCommands, commands)) {
		failures.push(WORKSPACE_TOPOLOGY_CONTRACT_FAILURES.commands);
	}
	return failures;
}
