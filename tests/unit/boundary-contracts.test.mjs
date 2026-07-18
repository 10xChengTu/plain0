import { describe, expect, it } from "vitest";

import {
	validateCapabilityFiles,
	validateMainCapability,
	validateTauriApiBoundary,
	validateTauriConfiguration,
	validateWorkspaceRustBoundary,
} from "../../scripts/plain/boundary-contracts.mjs";

const baselineConfig = {
	app: {
		withGlobalTauri: false,
		windows: [{ label: "main" }],
		security: {
			capabilities: ["main-capability"],
			assetProtocol: { enable: false, scope: [] },
			csp: {
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
			},
			devCsp: {
				"default-src": "'self'",
				"base-uri": "'none'",
				"connect-src": "'self' ipc: http://ipc.localhost ws://127.0.0.1:1420",
				"font-src": "'self' data:",
				"img-src": "'self' data: blob:",
				"object-src": "'none'",
				"script-src": "'self' 'wasm-unsafe-eval'",
				"style-src": "'self' 'unsafe-inline'",
				"worker-src": "'self' blob:",
				"frame-src": "'none'",
				"form-action": "'none'",
			},
		},
	},
};

const baselineCapability = {
	$schema: "../gen/schemas/desktop-schema.json",
	identifier: "main-capability",
	description: "Minimum capability for the Plain main window",
	windows: ["main"],
	permissions: ["core:event:allow-listen", "core:event:allow-unlisten"],
};

describe("Plain Tauri boundary contracts", () => {
	it("rejects Tauri API imports outside the bridge for either quote style", () => {
		for (const quote of ["'", '"']) {
			const source = `import { invoke } from ${quote}@tauri-apps/api/core${quote};`;
			expect(
				validateTauriApiBoundary(source, "app/features/example.ts"),
			).toEqual([
				"app/features/example.ts bypasses the sole Tauri bridge directory",
			]);
		}
		expect(
			validateTauriApiBoundary(
				'import { invoke } from "@tauri-apps/api/core";',
				"app/platform/tauri/native.ts",
			),
		).toEqual([]);
	});

	it("accepts only the exact minimum Tauri configuration", () => {
		expect(validateTauriConfiguration(baselineConfig)).toEqual([]);

		const wildcard = structuredClone(baselineConfig);
		wildcard.app.security.csp["default-src"] = "*";
		expect(validateTauriConfiguration(wildcard)).toContain(
			"Tauri production CSP differs from the minimum contract",
		);

		const extraCapability = structuredClone(baselineConfig);
		extraCapability.app.security.capabilities.push("broad-capability");
		expect(validateTauriConfiguration(extraCapability)).toContain(
			"Tauri must enable only main-capability",
		);

		const remoteWindow = structuredClone(baselineConfig);
		remoteWindow.app.windows[0].url = "https://example.com";
		expect(validateTauriConfiguration(remoteWindow)).toContain(
			"the main window must use the bundled frontend, not a URL",
		);
	});

	it("rejects extra capability files, targets and permissions", () => {
		expect(validateCapabilityFiles(["main.json"])).toEqual([]);
		expect(validateCapabilityFiles(["main.json", "broad.json"])).not.toEqual(
			[],
		);
		expect(validateMainCapability(baselineCapability)).toEqual([]);

		const broad = structuredClone(baselineCapability);
		broad.webviews = ["*"];
		broad.permissions.push("core:default");
		expect(validateMainCapability(broad)).toEqual(
			expect.arrayContaining([
				"main capability contains fields outside the minimum contract",
				"main capability permissions differ from the minimum contract",
			]),
		);
	});
});

const workspaceCargo = `
cap-std = "4.0.2"
libc = "0.2.186"
uuid = { version = "1.24.0", features = ["v4"] }
`;

const workspaceSources = [
	{
		relativePath: "src-tauri/src/workspace/mod.rs",
		source: `
use cap_std::ambient_authority;
use cap_std::fs::Dir;

fn authorize(path: &std::path::Path) {
  let _root = Dir::open_ambient_dir(path, ambient_authority());
}

#[cfg(windows)]
fn windows_identity(path: &std::path::Path) {
  let _ = std::fs::canonicalize(path);
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/tests.rs",
		source: `use std::fs; fn fixture() { fs::write("outside", "test"); }`,
	},
];

describe("Plain workspace Rust boundary contracts", () => {
	it("accepts one capability root authorizer and ignores test fixtures", () => {
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).toEqual([]);
	});

	it("requires the reviewed capability, nonblocking-open and opaque-id versions", () => {
		expect(
			validateWorkspaceRustBoundary(
				'cap-std = "4"\nuuid = "1.24"',
				workspaceSources,
			),
		).toEqual(
			expect.arrayContaining([
				"Cargo.toml must pin cap-std to 4.0.2",
				"Cargo.toml must pin libc to 0.2.186",
				"Cargo.toml must pin uuid to 1.24.0",
			]),
		);
		expect(
			validateWorkspaceRustBoundary(
				workspaceCargo.replace('libc = "0.2.186"', 'libc = "0.2"'),
				workspaceSources,
			),
		).toContain("Cargo.toml must pin libc to 0.2.186");
	});

	it("rejects ambient I/O aliases, lossy paths and extra authorizers", () => {
		const hostileSources = [
			...workspaceSources,
			{
				relativePath: "src-tauri/src/workspace/service.rs",
				source: `
use std::fs as host_fs;
use cap_std::ambient_authority;
use cap_std::fs::Dir;
fn bypass(path: &std::path::Path) {
  host_fs::write(path, "escape");
  let _ = path.to_string_lossy();
  let _ = Dir::open_ambient_dir(path, ambient_authority());
  let _ = std::fs::remove_file(path);
}
`,
			},
		];
		const failures = validateWorkspaceRustBoundary(
			workspaceCargo,
			hostileSources,
		);
		expect(failures).toEqual(
			expect.arrayContaining([
				"src-tauri/src/workspace/service.rs must not alias ambient std::fs in workspace production code",
				"src-tauri/src/workspace/service.rs must not create an operable path with lossy conversion",
				"src-tauri/src/workspace/service.rs uses forbidden ambient std::fs operation remove_file",
				"src-tauri/src/workspace/service.rs opens ambient paths outside the sole root authorizer",
				"workspace production code must contain exactly one ambient root authorizer",
			]),
		);
	});

	it("rejects extra ambient canonicalize fallbacks", () => {
		const source = `${workspaceSources[0].source}
fn fallback_one(path: &std::path::Path) { let _ = std::fs::canonicalize(path); }
fn fallback_two(path: &std::path::Path) { let _ = std::fs::canonicalize(path); }
`;
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				{ ...workspaceSources[0], source },
			]),
		).toContain(
			"workspace root identity may use at most two platform canonicalize fallbacks",
		);
	});
});
