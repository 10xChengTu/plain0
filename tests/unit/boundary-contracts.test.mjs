import { describe, expect, it } from "vitest";

import {
	validateCapabilityFiles,
	validateMainCapability,
	validateTauriApiBoundary,
	validateTauriConfiguration,
	validateWorkspaceCopyCommandRegistration,
	validateWorkspaceProviderBootstrap,
	validateWorkspaceProviderCopyBoundary,
	validateWorkspaceRustBoundary as validateWorkspaceRustBoundaryContract,
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
[dependencies]
cap-std = "4.0.2"
libc = "0.2.186"
rustix = { version = "=1.1.4", features = ["fs"] }
uuid = { version = "1.24.0", features = ["v4"] }
`;

const exactRustixDependency = Object.freeze({
	name: "rustix",
	req: "=1.1.4",
	kind: null,
	rename: null,
	target: 'cfg(any(target_os = "linux", target_os = "macos"))',
});

function validateWorkspaceRustBoundary(
	cargoSource,
	rustSources,
	cargoDependencies = [],
) {
	return validateWorkspaceRustBoundaryContract(cargoSource, rustSources, [
		exactRustixDependency,
		...cargoDependencies,
	]);
}

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
	{
		relativePath: "src-tauri/src/workspace/writer.rs",
		source: `
use rustix::fs::{renameat_with, RenameFlags};
const MAX_COPY_SYMLINK_BYTES: usize = 4 * 1_024;
fn read_symlink(parent: &cap_std::fs::Dir) {
  let mut buffer = [0_u8; MAX_COPY_SYMLINK_BYTES + 1];
  let _ = rustix::fs::readlinkat_raw(parent, "source", &mut buffer);
}
fn stage_symlink(parent: &cap_std::fs::Dir) {
  let _ = rustix::fs::symlinkat(b"payload", parent, "staging");
}
fn rename_exclusive(source: &cap_std::fs::Dir, target: &cap_std::fs::Dir) {
  let _ = renameat_with(source, "old", target, "new", RenameFlags::NOREPLACE);
}
fn publish_exclusive(parent: &cap_std::fs::Dir) {
  let _ = renameat_with(parent, "staging", parent, "target", RenameFlags::NOREPLACE);
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/commands.rs",
		source: `
#[tauri::command]
pub(crate) async fn workspace_copy(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspaceCopyRequest,
) -> Result<(), CommandError> {
  let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
  WorkspaceService::copy_entry(
    service.inner(),
    window.label(),
    source_root_id,
    source_path,
    target_root_id,
    target_path,
  ).await
}
`,
	},
	{
		relativePath: "src-tauri/src/lib.rs",
		source: `
fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      workspace::commands::workspace_copy,
    ]);
}
`,
	},
];

describe("Plain workspace Rust boundary contracts", () => {
	it("accepts one capability root authorizer and ignores test fixtures", () => {
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).toEqual([]);
	});

	it("requires the reviewed capability, exclusive-rename and opaque-id versions", () => {
		expect(
			validateWorkspaceRustBoundary(
				'cap-std = "4"\nuuid = "1.24"',
				workspaceSources,
			),
		).toEqual(
			expect.arrayContaining([
				"Cargo.toml must pin cap-std to 4.0.2",
				"Cargo.toml must pin libc to 0.2.186",
				"Cargo.toml must pin rustix to =1.1.4",
				"Cargo.toml must pin uuid to 1.24.0",
			]),
		);
		expect(
			validateWorkspaceRustBoundary(
				workspaceCargo.replace('libc = "0.2.186"', 'libc = "0.2"'),
				workspaceSources,
			),
		).toContain("Cargo.toml must pin libc to 0.2.186");
		expect(
			validateWorkspaceRustBoundary(
				workspaceCargo.replace('version = "=1.1.4"', 'version = "1"'),
				workspaceSources,
			),
		).toContain("Cargo.toml must pin rustix to =1.1.4");
	});

	it("requires one exact unrenamed runtime rustix dependency on the audited targets", () => {
		const failure =
			"Cargo metadata must contain exactly one unrenamed runtime rustix =1.1.4 dependency for the audited Linux/macOS target";
		expect(
			validateWorkspaceRustBoundaryContract(workspaceCargo, workspaceSources, [
				exactRustixDependency,
			]),
		).not.toContain(failure);

		for (const dependencies of [
			[],
			[{ ...exactRustixDependency, req: "^1.1.4" }],
			[{ ...exactRustixDependency, rename: "syscalls" }],
			[{ ...exactRustixDependency, kind: "dev" }],
			[{ ...exactRustixDependency, kind: "build" }],
			[{ ...exactRustixDependency, target: "cfg(unix)" }],
			[exactRustixDependency, { ...exactRustixDependency, rename: "syscalls" }],
		]) {
			expect(
				validateWorkspaceRustBoundaryContract(
					workspaceCargo,
					workspaceSources,
					dependencies,
				),
			).toContain(failure);
		}
	});

	it("requires an exact cap-fs-ext pin only when the copy implementation introduces it", () => {
		const failure =
			"Cargo metadata must contain exactly one unrenamed runtime cap-fs-ext =4.0.2 dependency";
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).not.toContain(failure);

		const capFsSource = {
			relativePath: "src-tauri/src/workspace/copier.rs",
			source: "use cap_fs_ext::OpenOptionsFollowExt;",
		};
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				capFsSource,
			]),
		).toContain(failure);
		expect(
			validateWorkspaceRustBoundary(
				workspaceCargo,
				[...workspaceSources, capFsSource],
				[
					{
						name: "cap-fs-ext",
						req: "=4.0.2",
						kind: null,
						rename: null,
					},
				],
			),
		).not.toContain(failure);
	});

	it("rejects renamed, non-exact, dev, build and duplicate metadata bait", () => {
		const capFsSource = {
			relativePath: "src-tauri/src/workspace/copier.rs",
			source: "use cap_fs_ext::OpenOptionsFollowExt;",
		};
		const exact = {
			name: "cap-fs-ext",
			req: "=4.0.2",
			kind: null,
			rename: null,
		};
		for (const dependencies of [
			[{ ...exact, req: "^4.0.2" }],
			[{ ...exact, rename: "capability-fs" }],
			[{ ...exact, kind: "dev" }],
			[{ ...exact, kind: "build" }],
			[exact, { ...exact, kind: "dev" }],
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo,
					[...workspaceSources, capFsSource],
					dependencies,
				),
			).toContain(
				"Cargo metadata must contain exactly one unrenamed runtime cap-fs-ext =4.0.2 dependency",
			);
		}
	});

	it("rejects broad and alternate symlink helpers across production Rust", () => {
		const hostileSources = [
			...workspaceSources,
			{
				relativePath: "src-tauri/src/workspace/copier.rs",
				source: `
use std::os::unix::fs::symlink;
fn bypass(directory: &cap_std::fs::Dir) {
  let _ = std::fs::read_link("source");
  let _ = directory.read_link("source");
  let _ = directory.read_link_contents("source");
  let _ = symlink("payload", "target");
  let _ = directory.symlink("payload", "target");
}
`,
			},
			{
				relativePath: "src-tauri/src/syscalls.rs",
				source: `
pub(crate) use libc::{readlink, readlinkat};
pub(crate) use rustix::fs::readlinkat;
pub(crate) use std::os::unix::fs::symlink;
`,
			},
		];
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, hostileSources),
		).toEqual(
			expect.arrayContaining([
				"src-tauri/src/workspace/copier.rs must not use broad or alternate symlink read helpers in production Rust",
				"src-tauri/src/workspace/copier.rs must not use broad symlink creation helpers in production Rust",
				"src-tauri/src/syscalls.rs must not use broad or alternate symlink read helpers in production Rust",
				"src-tauri/src/syscalls.rs must not use broad symlink creation helpers in production Rust",
			]),
		);
	});

	it("keeps symlink syscalls direct, writer-local and bounded by a +1 probe", () => {
		const writer = workspaceSources.find(
			({ relativePath }) =>
				relativePath === "src-tauri/src/workspace/writer.rs",
		);
		const viaReexport = [
			...workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? {
							...entry,
							source: `use crate::syscalls::{readlinkat_raw, symlinkat};\n${entry.source
								.replace("rustix::fs::readlinkat_raw", "readlinkat_raw")
								.replace("rustix::fs::symlinkat", "symlinkat")}`,
						}
					: entry,
			),
			{
				relativePath: "src-tauri/src/syscalls.rs",
				source: "pub(crate) use rustix::fs::{readlinkat_raw, symlinkat};",
			},
		];
		expect(validateWorkspaceRustBoundary(workspaceCargo, viaReexport)).toEqual(
			expect.arrayContaining([
				"src-tauri/src/syscalls.rs must not alias or re-export rustix::fs::readlinkat_raw",
				"src-tauri/src/syscalls.rs must not use rustix::fs::readlinkat_raw outside the workspace writer",
				"src-tauri/src/workspace/writer.rs must not alias or re-export rustix::fs::symlinkat",
			]),
		);

		for (const [source, failure] of [
			[
				writer.source.replace("4 * 1_024", "8 * 1_024"),
				"workspace writer must cap raw symlink payloads at MAX_COPY_SYMLINK_BYTES = 4096",
			],
			[
				writer.source.replace(
					"MAX_COPY_SYMLINK_BYTES + 1",
					"MAX_COPY_SYMLINK_BYTES",
				),
				"workspace writer must probe symlink payloads with a MAX_COPY_SYMLINK_BYTES + 1 buffer",
			],
			[
				writer.source.replace(
					"let mut buffer = [0_u8; MAX_COPY_SYMLINK_BYTES + 1];",
					`let mut dead_probe = [0_u8; MAX_COPY_SYMLINK_BYTES + 1];
  let _ = &mut dead_probe;
  let mut buffer = [0_u8; MAX_COPY_SYMLINK_BYTES];`,
				),
				"workspace writer must probe symlink payloads with a MAX_COPY_SYMLINK_BYTES + 1 buffer",
			],
		]) {
			const sources = workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? { ...entry, source }
					: entry,
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toContain(
				failure,
			);
		}

		for (const expression of [
			"4096",
			"4_096",
			"1 << 12",
			"2 * 2 * 1_024",
			"0x1000",
		]) {
			const source = writer.source.replace("4 * 1_024", expression);
			const sources = workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? { ...entry, source }
					: entry,
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, sources),
			).not.toContain(
				"workspace writer must cap raw symlink payloads at MAX_COPY_SYMLINK_BYTES = 4096",
			);
		}
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

	it("rejects copy primitives and overwrite paths across aliases and UFCS", () => {
		const hostileCopySources = [
			'fn bypass() { let _ = std::fs::copy("a", "b"); }',
			"use std::io::{copy as transfer}; fn bypass() { transfer(); }",
			"use std::io as stream; fn bypass() { stream::copy(); }",
			"use cap_std::fs::Dir as CapabilityDir; fn bypass() { CapabilityDir::copy(); }",
			"fn bypass() { <cap_std::fs::Dir>::copy(); }",
			"fn bypass(directory: &cap_std::fs::Dir) { directory.copy(); }",
		];
		for (const source of hostileCopySources) {
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, [
					...workspaceSources,
					{
						relativePath: "src-tauri/src/workspace/copier.rs",
						source,
					},
				]),
			).toContain(
				"src-tauri/src/workspace/copier.rs must not use an unaudited copy primitive; use workspace_copy/copy_entry helpers",
			);
		}

		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				{
					relativePath: "src-tauri/src/workspace/copier.rs",
					source: "fn overwrite() {}",
				},
			]),
		).toContain(
			"src-tauri/src/workspace/copier.rs must not add an overwrite path to workspace mutations",
		);
	});

	it("ignores forbidden copy words in Rust comments and literals", () => {
		const harmlessSource = {
			relativePath: "src-tauri/src/workspace/copier.rs",
			source: `
// std::io::copy and overwrite are forbidden examples.
const MESSAGE: &str = "cap_std::fs::Dir::copy overwrite";
const RAW: &str = r#"std::fs::copy overwrite"#;
fn copy_entry() {}
`,
		};
		const failures = validateWorkspaceRustBoundary(workspaceCargo, [
			...workspaceSources,
			harmlessSource,
		]);
		expect(failures).not.toContain(
			"src-tauri/src/workspace/copier.rs must not use an unaudited copy primitive; use workspace_copy/copy_entry helpers",
		);
		expect(failures).not.toContain(
			"src-tauri/src/workspace/copier.rs must not add an overwrite path to workspace mutations",
		);
	});

	it("rejects overwrite-capable rename fallbacks and rustix use outside the writer", () => {
		const hostileSources = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/workspace/writer.rs"
				? {
						relativePath: entry.relativePath,
						source: `
use rustix::fs::{renameat as clobber, renameat_with, RenameFlags};
fn unsafe_rename(source: &cap_std::fs::Dir, target: &cap_std::fs::Dir) {
  let _ = renameat_with(source, "safe-old", target, "safe-new", RenameFlags::NOREPLACE);
  let _ = clobber(source, "old", target, "new");
  let _ = cap_std::fs::Dir::rename(source, "old", target, "new");
}
`,
					}
				: entry,
		);
		hostileSources.push({
			relativePath: "src-tauri/src/workspace/service.rs",
			source: `
use rustix::fs::renameat_with;
fn bypass(source: &cap_std::fs::Dir, target: &cap_std::fs::Dir) {
  let _ = source.rename("old", target, "new");
}
`,
		});
		hostileSources.push({
			relativePath: "src-tauri/src/workspace/reader.rs",
			source: `
use cap_std::fs::Dir as WorkspaceService;
fn disguised(source: &WorkspaceService, target: &WorkspaceService) {
  let _ = WorkspaceService::rename(source, "old", target, "new");
}
`,
		});
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, hostileSources),
		).toEqual(
			expect.arrayContaining([
				"src-tauri/src/workspace/writer.rs must not use an overwrite-capable rename",
				"src-tauri/src/workspace/service.rs must not use an overwrite-capable rename",
				"src-tauri/src/workspace/reader.rs must not use an overwrite-capable rename",
				"src-tauri/src/workspace/service.rs must not use the exclusive rename syscall outside the workspace writer",
			]),
		);
	});

	it("binds NOREPLACE to each audited renameat_with call", () => {
		const mismatchedFlags = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/workspace/writer.rs"
				? {
						...entry,
						source: `
use rustix::fs::{renameat_with, RenameFlags};
fn rename_exclusive(source: &cap_std::fs::Dir, target: &cap_std::fs::Dir) {
  let _ = renameat_with(source, "old", target, "new", RenameFlags::empty());
}
fn publish_exclusive(parent: &cap_std::fs::Dir) {
  let _ = renameat_with(
    parent,
    "staging",
    parent,
    "target",
    RenameFlags::NOREPLACE | RenameFlags::NOREPLACE,
  );
}
`,
					}
				: entry,
		);

		expect(
			validateWorkspaceRustBoundary(workspaceCargo, mismatchedFlags),
		).toContain(
			"every workspace writer renameat_with call must pass exactly one direct RenameFlags::NOREPLACE flag",
		);
	});

	it("rejects renameat_with aliases, re-exports and rustix namespace aliases", () => {
		const writer = workspaceSources.find(
			({ relativePath }) =>
				relativePath === "src-tauri/src/workspace/writer.rs",
		);
		for (const source of [
			writer.source.replace(
				"use rustix::fs::{renameat_with, RenameFlags};",
				"use rustix::fs::{renameat_with as atomic_rename, RenameFlags};",
			),
			`pub(crate) use rustix::fs::renameat_with;\n${writer.source}`,
			`use rustix as syscalls;\n${writer.source}`,
			`use rustix::fs as syscall_fs;\n${writer.source}`,
			`use rustix::{fs};\n${writer.source}`,
			`${writer.source}\nconst ATOMIC_RENAME: usize = renameat_with as usize;`,
		]) {
			const hostileSources = workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? { ...entry, source }
					: entry,
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, hostileSources),
			).toContain(
				"src-tauri/src/workspace/writer.rs must not alias or re-export rustix or renameat_with",
			);
		}

		const outsideAlias = [
			...workspaceSources,
			{
				relativePath: "src-tauri/src/workspace/service.rs",
				source: `
use rustix as syscalls;
fn hidden(source: &cap_std::fs::Dir, target: &cap_std::fs::Dir) {
  let _ = syscalls::fs::renameat_with(
    source,
    "old",
    target,
    "new",
    syscalls::fs::RenameFlags::NOREPLACE,
  );
}
`,
			},
		];
		expect(validateWorkspaceRustBoundary(workspaceCargo, outsideAlias)).toEqual(
			expect.arrayContaining([
				"src-tauri/src/workspace/service.rs must not alias or re-export rustix or renameat_with",
				"src-tauri/src/workspace/service.rs must not use the exclusive rename syscall outside the workspace writer",
			]),
		);

		const reexportedSyscall = [
			...workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? {
							...entry,
							source: entry.source.replace(
								"use rustix::fs::{renameat_with, RenameFlags};",
								"use crate::syscalls::{renameat_with, RenameFlags};",
							),
						}
					: entry,
			),
			{
				relativePath: "src-tauri/src/syscalls.rs",
				source: "pub(crate) use rustix::fs::{renameat_with, RenameFlags};",
			},
		];
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, reexportedSyscall),
		).toEqual(
			expect.arrayContaining([
				"src-tauri/src/syscalls.rs must not alias or re-export rustix or renameat_with",
				"src-tauri/src/syscalls.rs must not use the exclusive rename syscall outside the workspace writer",
				"src-tauri/src/workspace/writer.rs must not alias or re-export rustix or renameat_with",
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

	it("requires the workspace_copy command and its exact Tauri registration", () => {
		expect(validateWorkspaceCopyCommandRegistration(workspaceSources)).toEqual(
			[],
		);

		const withoutCommand = workspaceSources.filter(
			({ relativePath }) =>
				relativePath !== "src-tauri/src/workspace/commands.rs",
		);
		expect(validateWorkspaceCopyCommandRegistration(withoutCommand)).toContain(
			"workspace copy boundary requires workspace/commands.rs",
		);

		const missingAttribute = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/workspace/commands.rs"
				? { ...entry, source: entry.source.replace("#[tauri::command]\n", "") }
				: entry,
		);
		expect(
			validateWorkspaceCopyCommandRegistration(missingAttribute),
		).toContain(
			"workspace/commands.rs must define exactly one audited workspace_copy Tauri command",
		);

		const aliasRegistration = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"workspace::commands::workspace_copy,",
							"registered_copy,",
						),
					}
				: entry,
		);
		expect(
			validateWorkspaceCopyCommandRegistration(aliasRegistration),
		).toContain(
			"src-tauri/src/lib.rs must register workspace::commands::workspace_copy exactly once in generate_handler",
		);

		const commentOnlyRegistration = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"workspace::commands::workspace_copy,",
							"// workspace::commands::workspace_copy,",
						),
					}
				: entry,
		);
		expect(
			validateWorkspaceCopyCommandRegistration(commentOnlyRegistration),
		).toContain(
			"src-tauri/src/lib.rs must register workspace::commands::workspace_copy exactly once in generate_handler",
		);

		const noOpCommand = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/workspace/commands.rs"
				? {
						...entry,
						source: `
#[tauri::command]
pub(crate) async fn workspace_copy() {}
`,
					}
				: entry,
		);
		expect(validateWorkspaceCopyCommandRegistration(noOpCommand)).toEqual(
			expect.arrayContaining([
				"workspace_copy must accept request: WorkspaceCopyRequest and return Result<(), CommandError>",
				"workspace_copy must route exactly once through WorkspaceService::copy_entry",
			]),
		);

		for (const invalidCommand of [
			workspaceSources.map((entry) =>
				entry.relativePath === "src-tauri/src/workspace/commands.rs"
					? {
							...entry,
							source: entry.source.replace(
								"request: WorkspaceCopyRequest",
								"request: WorkspaceRenameRequest",
							),
						}
					: entry,
			),
			workspaceSources.map((entry) =>
				entry.relativePath === "src-tauri/src/workspace/commands.rs"
					? {
							...entry,
							source: entry.source.replace(
								"Result<(), CommandError>",
								"Result<bool, CommandError>",
							),
						}
					: entry,
			),
		]) {
			expect(
				validateWorkspaceCopyCommandRegistration(invalidCommand),
			).toContain(
				"workspace_copy must accept request: WorkspaceCopyRequest and return Result<(), CommandError>",
			);
		}

		const bypassedRoute = workspaceSources.map((entry) =>
			entry.relativePath === "src-tauri/src/workspace/commands.rs"
				? {
						...entry,
						source: entry.source.replace(
							"WorkspaceService::copy_entry(",
							"writer::copy_regular_file(",
						),
					}
				: entry,
		);
		expect(validateWorkspaceCopyCommandRegistration(bypassedRoute)).toContain(
			"workspace_copy must route exactly once through WorkspaceService::copy_entry",
		);
	});
});

const readonlyWorkspaceProvider = `
export class PlainWorkspaceFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.Readonly;

  async readFile() {
    return file.copy();
  }
}

export function createPlainWorkspaceFileSystemProvider(
  bridge: PlainBridge,
): PlainWorkspaceFileSystemProvider {
  return new PlainWorkspaceFileSystemProvider(bridge);
}
`;

describe("Plain workspace provider copy boundary", () => {
	it("keeps the provider exactly readonly while allowing immutable file payload copies", () => {
		expect(
			validateWorkspaceProviderCopyBoundary(readonlyWorkspaceProvider),
		).toEqual([]);
	});

	it("rejects early FileFolderCopy capability or removal of Readonly", () => {
		const nativeCopy = readonlyWorkspaceProvider.replace(
			"FileSystemProviderCapabilities.Readonly;",
			"FileSystemProviderCapabilities.Readonly |\n    FileSystemProviderCapabilities.FileFolderCopy;",
		);
		expect(validateWorkspaceProviderCopyBoundary(nativeCopy)).toEqual(
			expect.arrayContaining([
				"Plain workspace provider capabilities must remain exactly FileReadWrite | Readonly",
				"Plain workspace provider must not advertise FileFolderCopy before activation",
			]),
		);

		const writable = readonlyWorkspaceProvider.replace(
			" |\n    FileSystemProviderCapabilities.Readonly",
			"",
		);
		expect(validateWorkspaceProviderCopyBoundary(writable)).toContain(
			"Plain workspace provider capabilities must remain exactly FileReadWrite | Readonly",
		);
	});

	it("rejects direct, computed or inherited provider copy surfaces", () => {
		const directCopy = readonlyWorkspaceProvider.replace(
			"\n}",
			"\n  async copy() {}\n}",
		);
		expect(validateWorkspaceProviderCopyBoundary(directCopy)).toContain(
			"Plain workspace provider must not expose copy before write activation",
		);

		const computedCopy = readonlyWorkspaceProvider.replace(
			"\n}",
			'\n  ["copy"] = async () => {};\n}',
		);
		expect(validateWorkspaceProviderCopyBoundary(computedCopy)).toContain(
			"Plain workspace provider must not hide members behind computed names",
		);

		const inheritedCopy = readonlyWorkspaceProvider.replace(
			"implements IFileSystemProviderWithFileReadWriteCapability",
			"extends WritableProvider implements IFileSystemProviderWithFileReadWriteCapability",
		);
		expect(validateWorkspaceProviderCopyBoundary(inheritedCopy)).toContain(
			"Plain workspace provider must not inherit hidden write capabilities",
		);
	});

	it("fixes the provider factory to one direct audited construction", () => {
		for (const hostileFactory of [
			readonlyWorkspaceProvider.replace(
				"return new PlainWorkspaceFileSystemProvider(bridge);",
				"return new Proxy(new PlainWorkspaceFileSystemProvider(bridge), {});",
			),
			readonlyWorkspaceProvider.replace(
				"return new PlainWorkspaceFileSystemProvider(bridge);",
				"const provider = new PlainWorkspaceFileSystemProvider(bridge);\n  return provider;",
			),
			readonlyWorkspaceProvider.replace(
				"new PlainWorkspaceFileSystemProvider(bridge)",
				"new PlainWorkspaceFileSystemProvider(otherBridge)",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostileFactory)).toContain(
				"Plain workspace provider factory must directly return new PlainWorkspaceFileSystemProvider(bridge)",
			);
		}
	});

	it("rejects extra provider identifiers and dynamic mutation surfaces", () => {
		for (const [addition, expected] of [
			[
				"const ProviderAlias = PlainWorkspaceFileSystemProvider;",
				"PlainWorkspaceFileSystemProvider may be referenced only by its declaration and audited factory",
			],
			[
				"void PlainWorkspaceFileSystemProvider.prototype;",
				"Plain workspace provider must not expose prototype mutation references",
			],
			[
				'Object.defineProperty({}, "copy", { value() {} });',
				"Plain workspace provider must not use defineProperty or Proxy mutation surfaces",
			],
			[
				"const wrapped = new Proxy({}, {});",
				"Plain workspace provider must not use defineProperty or Proxy mutation surfaces",
			],
			[
				"provider.capabilities = FileSystemProviderCapabilities.FileFolderCopy;",
				"Plain workspace provider capabilities must not be referenced outside their readonly declaration",
			],
		]) {
			expect(
				validateWorkspaceProviderCopyBoundary(
					`${readonlyWorkspaceProvider}\n${addition}`,
				),
			).toContain(expected);
		}
	});
});

describe("Plain workspace provider bootstrap contract", () => {
	const bootstrap = `
const bridge = createBridge();
const provider = createPlainWorkspaceFileSystemProvider(bridge);
registerCustomProvider(PLAIN_WORKSPACE_SCHEME, provider);
await initialize(createServiceOverrides(), container, { enableWorkspaceTrust: false });
`;

	it("requires one plain-workspace registration before service initialization", () => {
		expect(validateWorkspaceProviderBootstrap(bootstrap)).toEqual([]);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, provider);\n",
					"",
				),
			),
		).toEqual(
			expect.arrayContaining([
				"app/main.ts must register exactly one custom workspace provider",
				"app/main.ts must register only the plain-workspace provider scheme",
				"the plain-workspace provider must be registered before initialize",
			]),
		);
	});

	it("rejects a different scheme, duplicate registration or late registration", () => {
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace("PLAIN_WORKSPACE_SCHEME", '"file"'),
			),
		).toContain(
			"app/main.ts must register only the plain-workspace provider scheme",
		);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"await initialize",
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, provider);\nawait initialize",
				),
			),
		).toContain(
			"app/main.ts must register exactly one custom workspace provider",
		);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, provider);\nawait initialize",
					"await initialize(createServiceOverrides(), container, {});\nregisterCustomProvider(PLAIN_WORKSPACE_SCHEME, provider);\nvoid",
				),
			),
		).toContain(
			"the plain-workspace provider must be registered before initialize",
		);
	});

	it("rejects delegating Plain process trust to the VS Code trust service", () => {
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace("enableWorkspaceTrust: false", ""),
			),
		).toContain(
			"Plain must keep VS Code workspace trust disabled in favor of Rust process trust",
		);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"enableWorkspaceTrust: false",
					"enableWorkspaceTrust: true",
				),
			),
		).toContain(
			"Plain must keep VS Code workspace trust disabled in favor of Rust process trust",
		);
	});
});
