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
 * During the Rust/bridge slice no application feature is allowed to consume a
 * delete token. The future coordinator/provider/Workbench authorization patch
 * will replace this zero-consumer gate with its own audited route atomically.
 */
export function validateWorkspaceDeleteTypeScriptBoundary(appSources) {
	const failures = [];
	const commandOccurrences = new Map(
		WORKSPACE_DELETE_TS_COMMANDS.map(({ command }) => [command, []]),
	);
	const bridgeMethods = new Set(
		WORKSPACE_DELETE_TS_COMMANDS.map(({ bridgeMethod }) => bridgeMethod),
	);
	const declarationCounts = new Map(
		[
			"app/platform/tauri/contracts.ts",
			"app/platform/tauri/native.ts",
			"app/platform/tauri/browser-mock.ts",
		].flatMap((relativePath) =>
			[...bridgeMethods].map((bridgeMethod) => [
				`${relativePath}:${bridgeMethod}`,
				0,
			]),
		),
	);
	let exactInvokeImportCount = 0;

	for (const { relativePath, source } of appSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
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
				!ts.isStringLiteral(statement.moduleSpecifier) ||
				statement.moduleSpecifier.text !== "@tauri-apps/api/core"
			) {
				continue;
			}
			const bindings = statement.importClause?.namedBindings;
			const isExactInvokeImport =
				normalizedPath === "app/platform/tauri/native.ts" &&
				bindings !== undefined &&
				ts.isNamedImports(bindings) &&
				bindings.elements.length === 1 &&
				bindings.elements[0].propertyName === undefined &&
				bindings.elements[0].name.text === "invoke";
			if (!isExactInvokeImport) {
				failures.push(
					`${normalizedPath} must import invoke from @tauri-apps/api/core only as the direct native bridge binding`,
				);
			} else {
				exactInvokeImportCount += 1;
			}
		}
		function visit(node) {
			if (
				ts.isStringLiteral(node) ||
				ts.isNoSubstitutionTemplateLiteral(node)
			) {
				if (
					node.text === "@tauri-apps/api/core" &&
					(!ts.isImportDeclaration(node.parent) ||
						node.parent.moduleSpecifier !== node)
				) {
					failures.push(
						`${normalizedPath} must not load @tauri-apps/api/core dynamically`,
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
					failures.push(
						`${normalizedPath} must not consume ${referencedMethod} before the audited delete coordinator and provider authorization patch land`,
					);
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
