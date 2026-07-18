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
	const registrations = [...source.matchAll(/\bregisterCustomProvider\s*\(/g)];
	if (registrations.length !== 1) {
		failures.push(
			"app/main.ts must register exactly one custom workspace provider",
		);
	}
	if (
		!/\bregisterCustomProvider\s*\(\s*PLAIN_WORKSPACE_SCHEME\s*,/.test(source)
	) {
		failures.push(
			"app/main.ts must register only the plain-workspace provider scheme",
		);
	}

	const registrationOffset = source.search(/\bregisterCustomProvider\s*\(/);
	const initializeOffset = source.search(/\bawait\s+initialize\s*\(/);
	if (
		initializeOffset < 0 ||
		registrationOffset < 0 ||
		registrationOffset > initializeOffset
	) {
		failures.push(
			"the plain-workspace provider must be registered before initialize",
		);
	}
	if (!/\benableWorkspaceTrust\s*:\s*false\b/.test(source)) {
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
const RUSTIX_TARGET = 'cfg(any(target_os = "linux", target_os = "macos"))';
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
			parameters: source.slice(parameterOpen + 1, parameterClose),
			returnType: source.slice(parameterClose + 1, bodyOpen),
			body: source.slice(bodyOpen + 1, bodyClose),
		});
	}
	return functions;
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
	const functions = extractRustFunctions(source, "copy_directory");
	if (functions.length !== 1) {
		return false;
	}
	const calls = extractCallArguments(
		functions[0].body,
		"copy_directory_with_limits_and_hooks",
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
			/\brenameat\b/.test(source) ||
			/\.rename\s*\(/.test(source) ||
			forbiddenQualifiedRenames.length > 0
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

export function validateWorkspaceProviderCopyBoundary(source) {
	const failures = [];
	const sourceFile = ts.createSourceFile(
		"file-system-provider.ts",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
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
		const [parameter] = factory.parameters;
		const [statement] = factory.body?.statements ?? [];
		const returned =
			statement !== undefined && ts.isReturnStatement(statement)
				? statement.expression
				: undefined;
		const isExactParameter =
			factory.parameters.length === 1 &&
			ts.isIdentifier(parameter.name) &&
			parameter.name.text === "bridge";
		const isExactConstruction =
			factory.body?.statements.length === 1 &&
			returned !== undefined &&
			ts.isNewExpression(returned) &&
			ts.isIdentifier(returned.expression) &&
			returned.expression.text === "PlainWorkspaceFileSystemProvider" &&
			returned.arguments?.length === 1 &&
			ts.isIdentifier(returned.arguments[0]) &&
			returned.arguments[0].text === "bridge";
		if (!isExported || !isExactParameter || !isExactConstruction) {
			failures.push(
				"Plain workspace provider factory must directly return new PlainWorkspaceFileSystemProvider(bridge)",
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
			continue;
		}
		if (typeScriptMemberName(member) === "copy") {
			failures.push(
				"Plain workspace provider must not expose copy before write activation",
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
	let hasDynamicMutationSurface = false;
	let hasCapabilitiesReference = false;
	function visit(node) {
		if (ts.isIdentifier(node) && node.text === "FileFolderCopy") {
			failures.push(
				"Plain workspace provider must not advertise FileFolderCopy before activation",
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
			hasPrototypeMutationSurface = true;
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

	return [...new Set(failures)];
}
