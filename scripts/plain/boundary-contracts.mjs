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
const WORKSPACE_TEST_SOURCE_PATTERN = /(?:^|\/)tests\.rs$/;

function escapeRegularExpression(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateWorkspaceRustBoundary(cargoSource, rustSources) {
	const failures = [];
	for (const [dependency, version] of [
		["cap-std", "4.0.2"],
		["libc", "0.2.186"],
		["rustix", "=1.1.4"],
		["uuid", "1.24.0"],
	]) {
		const escapedDependency = escapeRegularExpression(dependency);
		const escapedVersion = escapeRegularExpression(version);
		const declaration = new RegExp(
			`^${escapedDependency}\\s*=\\s*(?:"${escapedVersion}"|\\{[^}\\n]*\\bversion\\s*=\\s*"${escapedVersion}"[^}\\n]*\\})\\s*$`,
			"m",
		);
		if (!declaration.test(cargoSource)) {
			failures.push(`Cargo.toml must pin ${dependency} to ${version}`);
		}
	}

	let ambientOpenCount = 0;
	let ambientAuthorityCallCount = 0;
	let ambientCanonicalizeCount = 0;
	let exclusiveRenameCount = 0;

	for (const { relativePath, source } of rustSources) {
		const normalizedPath = relativePath.replaceAll("\\", "/");
		if (
			!WORKSPACE_RUST_SOURCE_PATTERN.test(normalizedPath) ||
			WORKSPACE_TEST_SOURCE_PATTERN.test(normalizedPath)
		) {
			continue;
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

		if (/\brustix\s*::\s*fs\b/.test(source)) {
			if (normalizedPath !== "src-tauri/src/workspace/writer.rs") {
				failures.push(
					`${normalizedPath} must not use the exclusive rename syscall outside the workspace writer`,
				);
			} else {
				exclusiveRenameCount += [...source.matchAll(/\brenameat_with\s*\(/g)]
					.length;
				if (!/\bRenameFlags\s*::\s*NOREPLACE\b/.test(source)) {
					failures.push("workspace writer must use RenameFlags::NOREPLACE");
				}
			}
		}
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
	if (exclusiveRenameCount !== 1) {
		failures.push(
			"workspace writer must contain exactly one audited renameat_with call",
		);
	}

	return failures;
}
