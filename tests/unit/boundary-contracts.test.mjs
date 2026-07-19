import { describe, expect, it } from "vitest";

import {
	validateCapabilityFiles,
	validateMainCapability,
	validateTauriApiBoundary,
	validateTauriConfiguration,
	validateWorkspaceCapabilitiesBoundary,
	validateWorkspaceCopyCommandRegistration,
	validateWorkspaceDeleteBoundary,
	validateWorkspaceDeleteCommandRegistration,
	validateWorkspaceDeleteTypeScriptBoundary,
	validateWorkspaceMoveBoundary,
	validateWorkspaceMoveCommandRegistration,
	validateWorkspaceProviderBootstrap,
	validateWorkspaceProviderCopyBoundary,
	validateWorkspaceRustBoundary as validateWorkspaceRustBoundaryContract,
	validateWorkspaceVersionedWriteBoundary,
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

function workspaceCapabilitiesBoundarySources() {
	return {
		rust: [
			{
				relativePath: "src-tauri/src/workspace/dto.rs",
				source: `
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceCapabilitiesRequest {}

#[derive(Serialize)]
pub struct WorkspaceCapabilities {
  create: bool,
  rename_no_replace: bool,
  copy_move: bool,
  delete: bool,
  versioned_write: bool,
}

impl WorkspaceCapabilities {
  pub const fn current_platform() -> Self {
    const HAS_EXCLUSIVE_NAMESPACE_MUTATIONS: bool =
      ::core::cfg!(any(target_os = "linux", target_os = "macos"));
    Self {
      create: true,
      rename_no_replace: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
      copy_move: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
      delete: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
      versioned_write: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
    }
  }
}
`,
			},
			{
				relativePath: "src-tauri/src/workspace/commands.rs",
				source: `
#[tauri::command]
pub(crate) fn workspace_capabilities(
  _window: WebviewWindow,
  request: WorkspaceCapabilitiesRequest,
) -> WorkspaceCapabilities {
  request.validate();
  WorkspaceCapabilities::current_platform()
}
`,
			},
			{
				relativePath: "src-tauri/src/lib.rs",
				source:
					"builder.invoke_handler(tauri::generate_handler![workspace::commands::workspace_capabilities])",
			},
		],
		app: [
			{
				relativePath: "app/platform/tauri/contracts.ts",
				source: `
export interface WorkspaceCapabilities {
  readonly create: boolean;
  readonly renameNoReplace: boolean;
  readonly copyMove: boolean;
  readonly delete: boolean;
  readonly versionedWrite: boolean;
}
export interface PlainBridge {
  workspaceCapabilities(): Promise<WorkspaceCapabilities>;
}
`,
			},
			{
				relativePath: "app/platform/tauri/workspace-codec.ts",
				source: `
export function decodeWorkspaceCapabilities(value: unknown): WorkspaceCapabilities {
  return sanitizedDecode(() => {
    const snapshot = ownPlainDataSnapshot(value);
    if (!hasExactKeys(snapshot, ["create", "renameNoReplace", "copyMove", "delete", "versionedWrite",]) ||
      typeof snapshot.create !== "boolean" ||
      typeof snapshot.renameNoReplace !== "boolean" ||
      typeof snapshot.copyMove !== "boolean" ||
      typeof snapshot.delete !== "boolean" ||
      typeof snapshot.versionedWrite !== "boolean") {
      return violation();
    }
    rejectProxyObject(value as object);
    return Object.freeze({
      create: snapshot.create,
      renameNoReplace: snapshot.renameNoReplace,
      copyMove: snapshot.copyMove,
      delete: snapshot.delete,
      versionedWrite: snapshot.versionedWrite,
    });
  });
}
`,
			},
			{
				relativePath: "app/platform/tauri/native.ts",
				source: `
import { invoke } from "@tauri-apps/api/core";
import { decodeWorkspaceCapabilities } from "./workspace-codec";

export function createNativeBridge(): PlainBridge {
  return {
    workspaceCapabilities: async () =>
      decodeWorkspaceCapabilities(
        await invoke<unknown>("workspace_capabilities", { request: {} }),
      ),
  };
}
`,
			},
			{
				relativePath: "app/platform/tauri/browser-mock.ts",
				source: `
const workspaceCapabilities: WorkspaceCapabilities = Object.freeze({
  create: true,
  renameNoReplace: true,
  copyMove: true,
  delete: true,
  versionedWrite: true,
});
const bridge = {
  async workspaceCapabilities() {
    return workspaceCapabilities;
  },
};
`,
			},
		],
	};
}

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

describe("workspace capability Harness", () => {
	it("locks the exact Rust/TypeScript capability route and hostile fail-closed decoder", () => {
		const baseline = workspaceCapabilitiesBoundarySources();
		expect(
			validateWorkspaceCapabilitiesBoundary(baseline.rust, baseline.app),
		).toEqual([]);

		const mutate = (sources, path, transform) =>
			sources.map((entry) =>
				entry.relativePath === path
					? { ...entry, source: transform(entry.source) }
					: entry,
			);
		const extraRustField = mutate(
			baseline.rust,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				source.replace(
					"  versioned_write: bool,",
					"  versioned_write: bool,\n  shell: bool,",
				),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(extraRustField, baseline.app),
		).toContain(
			"workspace capability Rust DTO must be an empty deny-unknown request and the exact five-boolean response",
		);

		const splitPlatformGate = mutate(
			baseline.rust,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				source.replace(
					"delete: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,",
					"delete: true,",
				),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(splitPlatformGate, baseline.app),
		).toContain(
			"workspace capabilities must keep create cross-platform and derive every unsafe mutation from the one Linux/macOS build gate",
		);

		const missingRegistration = mutate(
			baseline.rust,
			"src-tauri/src/lib.rs",
			() => "builder.invoke_handler(tauri::generate_handler![])",
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(missingRegistration, baseline.app),
		).toContain(
			"src-tauri/src/lib.rs must register workspace_capabilities exactly once",
		);

		const commentedRegistrationDecoy = mutate(
			baseline.rust,
			"src-tauri/src/lib.rs",
			() =>
				"// builder.invoke_handler(tauri::generate_handler![workspace::commands::workspace_capabilities])\nbuilder.invoke_handler(tauri::generate_handler![])",
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(
				commentedRegistrationDecoy,
				baseline.app,
			),
		).toContain(
			"src-tauri/src/lib.rs must register workspace_capabilities exactly once",
		);

		const unreachablePlatformDecoy = mutate(
			baseline.rust,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				source.replace(
					'    const HAS_EXCLUSIVE_NAMESPACE_MUTATIONS: bool =\n      ::core::cfg!(any(target_os = "linux", target_os = "macos"));',
					`    if false {
      const HAS_EXCLUSIVE_NAMESPACE_MUTATIONS: bool =
        ::core::cfg!(any(target_os = "linux", target_os = "macos"));
      return Self {
        create: true,
        rename_no_replace: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
        copy_move: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
        delete: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
        versioned_write: HAS_EXCLUSIVE_NAMESPACE_MUTATIONS,
      };
    }
    const HAS_EXCLUSIVE_NAMESPACE_MUTATIONS: bool = true;`,
				),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(
				unreachablePlatformDecoy,
				baseline.app,
			),
		).toContain(
			"workspace capabilities must keep create cross-platform and derive every unsafe mutation from the one Linux/macOS build gate",
		);

		const shadowedPlatformMacro = mutate(
			baseline.rust,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				`macro_rules! cfg { ($($token:tt)*) => { true }; }\n${source.replace("::core::cfg!", "cfg!")}`,
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(
				shadowedPlatformMacro,
				baseline.app,
			),
		).toContain(
			"workspace capabilities must keep create cross-platform and derive every unsafe mutation from the one Linux/macOS build gate",
		);

		for (const hostileCodec of [
			mutate(baseline.app, "app/platform/tauri/workspace-codec.ts", (source) =>
				source.replace(
					'typeof snapshot.copyMove !== "boolean"',
					"!Boolean(snapshot.copyMove)",
				),
			),
			mutate(baseline.app, "app/platform/tauri/workspace-codec.ts", (source) =>
				source.replace("    rejectProxyObject(value as object);\n", ""),
			),
			mutate(baseline.app, "app/platform/tauri/workspace-codec.ts", (source) =>
				source.replace(
					"export function decodeWorkspaceCapabilities(value: unknown): WorkspaceCapabilities {",
					"export function decodeWorkspaceCapabilities(value: unknown): WorkspaceCapabilities {\n  return value as WorkspaceCapabilities;",
				),
			),
		]) {
			expect(
				validateWorkspaceCapabilitiesBoundary(baseline.rust, hostileCodec),
			).toContain(
				"workspace capability decoder must snapshot exact own booleans, reject Proxy payloads and freeze the result",
			);
		}

		const wrongNativeRoute = mutate(
			baseline.app,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace('"workspace_capabilities"', '"workspace_snapshot"'),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(baseline.rust, wrongNativeRoute),
		).toContain(
			"native bridge must invoke workspace_capabilities once with an empty request and strictly decode it",
		);

		const spreadNativeOverride = mutate(
			baseline.app,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"  };\n}",
					`    ...{
      workspaceCapabilities: async () => ({
        create: true,
        renameNoReplace: true,
        copyMove: true,
        delete: true,
        versionedWrite: true,
      }),
    },
  };
}`,
				),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(
				baseline.rust,
				spreadNativeOverride,
			),
		).toContain(
			"native bridge must invoke workspace_capabilities once with an empty request and strictly decode it",
		);

		const shadowedNativeInvoke = mutate(
			baseline.app,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					'import { invoke } from "@tauri-apps/api/core";',
					`import { invoke as tauriInvoke } from "@tauri-apps/api/core";
const invoke = async () => ({
  create: true,
  renameNoReplace: true,
  copyMove: true,
  delete: true,
  versionedWrite: true,
});
void tauriInvoke;`,
				),
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(
				baseline.rust,
				shadowedNativeInvoke,
			),
		).toContain(
			"native bridge must invoke workspace_capabilities once with an empty request and strictly decode it",
		);

		const detachedNativeRoute = mutate(
			baseline.app,
			"app/platform/tauri/native.ts",
			(source) =>
				`${source.replace(
					`workspaceCapabilities: async () =>
      decodeWorkspaceCapabilities(
        await invoke<unknown>("workspace_capabilities", { request: {} }),
      ),`,
					`workspaceCapabilities() {
      return { create: true, renameNoReplace: true, copyMove: true, delete: true, versionedWrite: true };
    },`,
				)}
const unused = {
  workspaceCapabilities: async () =>
    decodeWorkspaceCapabilities(
      await invoke<unknown>("workspace_capabilities", { request: {} }),
    ),
};`,
		);
		expect(
			validateWorkspaceCapabilitiesBoundary(baseline.rust, detachedNativeRoute),
		).toContain(
			"native bridge must invoke workspace_capabilities once with an empty request and strictly decode it",
		);
	});
});

const workspaceCargo = `
[dependencies]
cap-std = "4.0.2"
libc = "0.2.186"
rustix = { version = "=1.1.4", features = ["fs"] }
sha2 = { version = "=0.10.9", default-features = false, features = [] }
uuid = { version = "1.24.0", features = ["v4"] }
`;

const exactRustixDependency = Object.freeze({
	name: "rustix",
	req: "=1.1.4",
	kind: null,
	rename: null,
	target: 'cfg(any(target_os = "linux", target_os = "macos"))',
});

const exactSha2Dependency = Object.freeze({
	name: "sha2",
	req: "=0.10.9",
	kind: null,
	rename: null,
	target: null,
	optional: false,
	uses_default_features: false,
	features: [],
});

function validateWorkspaceRustBoundary(
	cargoSource,
	rustSources,
	cargoDependencies = [],
	resolvedSha2Features = ["default", "std"],
) {
	return validateWorkspaceRustBoundaryContract(
		cargoSource,
		rustSources,
		[exactRustixDependency, exactSha2Dependency, ...cargoDependencies],
		resolvedSha2Features,
	);
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
const MAX_COPY_FILE_BYTES: usize = 8 * 1_024 * 1_024;
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
fn publish_no_replace(
  parent: &Dir,
  staging_name: &Path,
  target_name: &Path,
) -> Result<(), CommandError> {
  renameat_with(
    parent,
    staging_name,
    parent,
    target_name,
    RenameFlags::NOREPLACE,
  )
  .map_err(map_copy_publish_error)
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/directory_copy.rs",
		source: `
const MAX_COPY_TREE_ENTRIES: usize = 10_000;
const MAX_COPY_ENTRY_NAME_BYTES: usize = 1_024;
const MAX_COPY_TREE_NAME_BYTES: usize = 2 * 1_024 * 1_024;
const MAX_COPY_TREE_DEPTH: usize = 256;
const MAX_COPY_TREE_SYMLINK_BYTES: u64 = 2 * 1_024 * 1_024;
const MAX_COPY_TREE_BYTES: u64 = 256 * 1_024 * 1_024;
const DIRECTORY_COPY_LIMITS: DirectoryCopyLimits = DirectoryCopyLimits {
  descendants: MAX_COPY_TREE_ENTRIES,
  name_bytes: MAX_COPY_ENTRY_NAME_BYTES,
  name_aggregate_bytes: MAX_COPY_TREE_NAME_BYTES,
  depth: MAX_COPY_TREE_DEPTH,
  link_bytes: MAX_COPY_SYMLINK_BYTES,
  link_aggregate_bytes: MAX_COPY_TREE_SYMLINK_BYTES,
  file_bytes: MAX_COPY_FILE_BYTES as u64,
  file_aggregate_bytes: MAX_COPY_TREE_BYTES,
};
struct PublishedDirectoryReceipt {
  source_directories: BTreeMap<PathBuf, DirectorySnapshot>,
  member_sets: BTreeMap<PathBuf, BTreeSet<OsString>>,
  removed_aliases: BTreeMap<FileIdentity, u64>,
}
fn copy_directory(
  source_lease: &Lease,
  source_path: &Path,
  target_lease: &Lease,
  target_path: &Path,
) {
	copy_directory_with_receipt(
		source_lease,
		source_path,
		target_lease,
		target_path,
	);
}
fn copy_directory_with_receipt(
	source_lease: &Lease,
	source_path: &Path,
	target_lease: &Lease,
	target_path: &Path,
) {
  let mut hooks = NoopHooks;
  copy_directory_with_limits_and_hooks_receipt(
    source_lease,
    source_path,
    target_lease,
    target_path,
    DIRECTORY_COPY_LIMITS,
    &mut hooks,
  );
}
fn copy_directory_with_limits_and_hooks_receipt(
  source_lease: &Lease,
  source_path: &Path,
  target_lease: &Lease,
  target_path: &Path,
  limits: DirectoryCopyLimits,
  hooks: &mut Hooks,
) -> Result<PublishedDirectoryReceipt, CommandError> {
  let source_directories = manifest.owned_directory_map()?;
  let member_sets = prepare_member_sets(&manifest)?;
  let removed_aliases = prepare_alias_groups(&manifest);
  let prepared = PublishedDirectoryReceipt {
    source_directories,
    member_sets,
    removed_aliases,
  };
  if let Err(error) = staged.publish(&target_name) {
    return staged.fail_with_cleanup(error);
  }
  Ok(prepared)
}
fn open_source_root(parent: &Dir) {
  let _ = parent.open_dir_nofollow("source");
}
fn scan_directory(parent: &Dir) {
  let _ = parent.open_dir_nofollow("child");
}
fn open_source_parent(parent: &Dir) {
  let _ = parent.open_dir_nofollow("parent");
}
fn build(stage_parent: &Dir, name: &Path) {
  let mut options = OpenOptions::new();
  options.read(true).write(true).create_new(true);
  options.mode(0o600);
  let _staged_file = stage_parent.open_with(name, &options);
}
impl StagedTree {
  fn open_receipted_directory(&self, relative: &Path) {
    let _ = self.root.open_dir_nofollow(relative);
  }
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

function mutateWorkspaceSource(sources, relativePath, transform) {
	return sources.map((entry) =>
		entry.relativePath === relativePath
			? { ...entry, source: transform(entry.source) }
			: entry,
	);
}

const workspaceMoveSources = [
	...mutateWorkspaceSource(
		mutateWorkspaceSource(
			mutateWorkspaceSource(
				mutateWorkspaceSource(
					workspaceSources,
					"src-tauri/src/workspace/writer.rs",
					(source) => `${source}
impl StagedFile {
  fn cleanup(&mut self) { let _ = self.parent.remove_file(&self.name); }
  fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
    publish_no_replace(self.parent, &self.name, target_name)?;
    self.active = false;
    Ok(())
  }
}
impl StagedSymlink {
  fn cleanup(&mut self) { let _ = self.parent.remove_file(&self.name); }
  fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
    publish_no_replace(self.parent, &self.name, target_name)?;
    self.active = false;
    Ok(())
  }
}
fn transfer_regular_file() -> Result<PublishedFileReceipt, CommandError> {
  let digest = [0_u8; 32];
  let prepared = PublishedFileReceipt { digest };
  if let Err(error) = staged.publish(&target_name) {
    return fail_with_stage_cleanup(&mut staged, error);
  }
  Ok(prepared)
}
fn transfer_symlink() -> Result<PublishedSymlinkReceipt, CommandError> {
  let prepared = PublishedSymlinkReceipt { payload };
  if let Err(error) = staged.publish(&target_name) {
    return fail_with_symlink_stage_cleanup(&mut staged, error);
  }
  Ok(prepared)
}`,
				),
				"src-tauri/src/workspace/directory_copy.rs",
				(source) => `${source}
impl StagedTree {
  fn cleanup(&mut self, parent: &Dir, name: &Path) {
    let _ = parent.remove_file(name);
    let _ = parent.remove_dir(name);
    let _ = self.parent.remove_dir(&self.name);
  }
  fn publish(&mut self, target_name: &Path) -> Result<(), CommandError> {
    publish_no_replace(self.parent, &self.name, target_name)?;
    self.active = false;
    Ok(())
  }
}
fn consume_directory_move_receipt() {
  let mut removed_entries = 0_u32;
  for index in indexes {
    let next_removed_entries = match removed_entries.checked_add(1) {
      Some(count) => count,
      None => return incomplete(),
    };
    let result = delete_manifest_entry(index);
    if let Err(reason) = result { return incomplete(reason); }
    removed_entries = next_removed_entries;
  }
  let next_removed_entries = removed_entries.checked_add(1).unwrap_or(removed_entries);
  let _ = next_removed_entries;
  let _ = remove_verified_source_directory(&source_parent, source_basename);
}
fn delete_manifest_entry() {
  match kind {
    File => {
      let next = removed.checked_add(1).ok_or(WorkspaceMoveIncompleteReason::SourceUnverifiable)?;
      let alias_count = removed_aliases.get_mut(&identity).ok_or(WorkspaceMoveIncompleteReason::SourceUnverifiable)?;
      *alias_count = next;
      if remove_verified_source_file(&source_parent, source_basename).is_err() {
        *alias_count = removed;
        return Err(WorkspaceMoveIncompleteReason::DeleteFailed);
      }
    }
    Symlink => {
      let next = removed.checked_add(1).ok_or(WorkspaceMoveIncompleteReason::SourceUnverifiable)?;
      let alias_count = removed_aliases.get_mut(&identity).ok_or(WorkspaceMoveIncompleteReason::SourceUnverifiable)?;
      *alias_count = next;
      if remove_verified_source_file(&source_parent, source_basename).is_err() {
        *alias_count = removed;
        return Err(WorkspaceMoveIncompleteReason::DeleteFailed);
      }
    }
    Directory => {
      remove_verified_source_directory(&source_parent, source_basename)
        .map_err(|_| WorkspaceMoveIncompleteReason::DeleteFailed)?;
    }
  }
  Ok(())
}
fn verify_directory_preflight() {}
fn verify_source_tree() {}
fn verify_target_tree() {}
fn verify_source_member_sets() {}
fn source_root_for_delete() {}
fn target_root_current() {}
fn verify_target_entry() {}
fn open_source_parent_prepared() {}
fn open_source_directory_prepared() {}
fn open_published_parent() {}
fn verify_published_member_sets() {}
fn verify_published_directory_members() {}
fn verify_exact_members() {}
fn ensure_directory_empty() {}`,
			),
			"src-tauri/src/workspace/commands.rs",
			(source) => `${source}
#[tauri::command]
pub(crate) async fn workspace_move(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspaceMoveRequest,
) -> Result<WorkspaceMoveResult, CommandError> {
  let (source_root_id, source_path, target_root_id, target_path) = request.into_parts()?;
  WorkspaceService::move_entry(
    service.inner(),
    window.label(),
    source_root_id,
    source_path,
    target_root_id,
    target_path,
  ).await
}`,
		),
		"src-tauri/src/lib.rs",
		(source) =>
			source.replace(
				"workspace::commands::workspace_copy,",
				"workspace::commands::workspace_copy,\n      workspace::commands::workspace_move,",
			),
	),
	{
		relativePath: "src-tauri/src/workspace/dto.rs",
		source: `
struct WorkspaceMoveRequest {
  source_root_id: String,
  source_path: String,
  target_root_id: String,
  target_path: String,
}
impl WorkspaceMoveRequest {
  fn into_parts(self) -> Result<Parts, CommandError> {
    if self.source_root_id == self.target_root_id { return Err(invalid_request()); }
    Ok(parse_parts(self))
  }
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/service.rs",
		source: `
impl WorkspaceService {
  async fn move_entry(
    &self,
    source_root_id: String,
    target_root_id: String,
  ) -> Result<WorkspaceMoveResult, CommandError> {
    if source_root_id == target_root_id { return Err(invalid_request()); }
    self.run_dual_root_mutation(source_root_id, target_root_id).await
  }
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/move_entry.rs",
		source: `
pub(super) enum PublishedCopyReceipt { File, Directory }

fn remove_verified_source_file(
  parent: &Dir,
  basename: &Path,
) -> std::io::Result<()> {
  parent.remove_file(basename)
}

fn remove_verified_source_directory(
  parent: &Dir,
  basename: &Path,
) -> std::io::Result<()> {
  parent.remove_dir(basename)
}

fn consume_published_copy_receipt(
  receipt: PublishedCopyReceipt,
) -> WorkspaceMoveResult {
  match receipt {
    PublishedCopyReceipt::File => WorkspaceMoveResult::Moved,
    PublishedCopyReceipt::Directory => WorkspaceMoveResult::Moved,
  }
}

fn consume_file_receipt() {
  let _ = remove_verified_source_file(&source_parent, &receipt.source_name);
}

fn consume_symlink_receipt() {
  let _ = remove_verified_source_file(&source_parent, &receipt.source_name);
}

fn finish_move(
  receipt: PublishedCopyReceipt,
) -> Result<WorkspaceMoveResult, CommandError> {
  Ok(consume_published_copy_receipt(receipt))
}
`,
	},
];

const workspaceDeleteSources = [
	...mutateWorkspaceSource(
		mutateWorkspaceSource(
			workspaceMoveSources,
			"src-tauri/src/workspace/commands.rs",
			(source) => `${source}
#[tauri::command]
pub(crate) async fn workspace_prepare_delete(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspacePrepareDeleteRequest,
) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
  service.prepare_delete(window.label(), request.into_parts()?).await
}
#[tauri::command]
pub(crate) async fn workspace_cancel_delete(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
  service.cancel_delete(window.label(), request.confirmation_id()).await
}
#[tauri::command]
pub(crate) async fn workspace_begin_delete(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
  service.begin_delete(window.label(), request.confirmation_id()).await
}
#[tauri::command]
pub(crate) async fn workspace_commit_delete_entry(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: WorkspaceCommitDeleteEntryRequest,
) -> Result<WorkspaceDeleteResult, CommandError> {
  let (confirmation_id, entry_id, root_id, relative_path, recursive) = request.into_parts()?;
  service.commit_delete_entry(
    window.label(),
    confirmation_id,
    entry_id,
    root_id,
    relative_path,
    recursive,
  ).await
}`,
		),
		"src-tauri/src/lib.rs",
		(source) =>
			source.replace(
				"workspace::commands::workspace_move,",
				`workspace::commands::workspace_move,
      workspace::commands::workspace_prepare_delete,
      workspace::commands::workspace_cancel_delete,
      workspace::commands::workspace_begin_delete,
      workspace::commands::workspace_commit_delete_entry,`,
			),
	).filter(
		({ relativePath }) =>
			relativePath !== "src-tauri/src/workspace/service.rs" &&
			relativePath !== "src-tauri/src/workspace/dto.rs",
	),
	{
		relativePath: "src-tauri/src/workspace/delete.rs",
		source: `
const MAX_DELETE_BATCH_ENTRIES: usize = 64;
const MAX_DELETE_DESCENDANTS: usize = 10_000;
const MAX_DELETE_TREE_DEPTH: usize = 256;
const MAX_DELETE_ENTRY_NAME_BYTES: usize = 1_024;
const MAX_DELETE_TREE_NAME_BYTES: usize = 2 * 1_024 * 1_024;
const MAX_DELETE_SYMLINK_BYTES: usize = 4 * 1_024;
const MAX_DELETE_TREE_SYMLINK_BYTES: usize = 2 * 1_024 * 1_024;

struct DeleteLimits {
  batch_entries: usize,
  descendants: usize,
  depth: usize,
  entry_name_bytes: usize,
  name_bytes: usize,
  symlink_bytes: usize,
  tree_symlink_bytes: usize,
}

const DELETE_LIMITS: DeleteLimits = DeleteLimits {
  batch_entries: MAX_DELETE_BATCH_ENTRIES,
  descendants: MAX_DELETE_DESCENDANTS,
  depth: MAX_DELETE_TREE_DEPTH,
  entry_name_bytes: MAX_DELETE_ENTRY_NAME_BYTES,
  name_bytes: MAX_DELETE_TREE_NAME_BYTES,
  symlink_bytes: MAX_DELETE_SYMLINK_BYTES,
  tree_symlink_bytes: MAX_DELETE_TREE_SYMLINK_BYTES,
};

pub(super) struct DeleteBatchReceipt {
  limits: DeleteLimits,
}

struct DeleteEntryReceipt {
  parent_chain: Vec<FileIdentity>,
  kind: DeleteReceiptKind,
}

enum DeleteReceiptKind {
  File,
  Directory(DirectoryReceipt),
}

struct DirectoryReceipt {
  root: NodeSnapshot,
  entries: Vec<ManifestEntry>,
}

struct ManifestEntry {
  name: String,
  parent: DirectoryIndex,
  kind: ManifestEntryKind,
}

enum DirectoryIndex {
  Root,
  Entry(usize),
}

enum ManifestEntryKind {
  File,
  Directory,
}

struct AliasJournal {
  remaining_indices: BTreeSet<usize>,
}

fn remove_verified_entry(
  parent: &Dir,
  basename: &Path,
  kind: DeleteKind,
) -> std::io::Result<()> {
  match kind {
    DeleteKind::File | DeleteKind::Symlink => parent.remove_file(basename),
    DeleteKind::Directory => parent.remove_dir(basename),
  }
}

fn open_metadata_only(options: &mut OpenOptions) {
  options.read(true);
}

fn delete_verified_entry() {
  let observed = match build_entry_receipt() {
    Ok(observed) => observed,
    Err(error) => return incomplete(error),
  };
  if &observed != expected {
    return incomplete(changed);
  }
  drop(observed);
  match &expected.kind {
    DeleteReceiptKind::Directory(receipt) => delete_directory(receipt),
    DeleteReceiptKind::File => delete_top_leaf(),
  }
}

fn delete_top_leaf() {
  let _ = DELETE_LIMITS;
  let _ = remove_verified_entry(parent, basename, kind);
}
fn delete_directory() {
  let _ = remove_verified_entry(parent, basename, kind);
}
fn delete_manifest_entry() {
  let _ = remove_verified_entry(parent, basename, kind);
  let _ = remove_verified_entry(parent, basename, kind);
  let _ = remove_verified_entry(parent, basename, kind);
}

fn rebaseline_aliases() {
  let current = aliases.get_mut(&identity).ok_or(failure)?;
  let remaining_index = remove_alias_index(current, removed_index)?;
  let _ = remaining_index;
}

fn remove_alias_index(journal: &mut AliasJournal, removed_index: usize) {
  if !journal.remaining_indices.remove(&removed_index) {
    return Err(failure);
  }
  Ok(journal.remaining_indices.iter().next_back().copied())
}

fn verify_exact_members(directory: &Dir, expected: &BTreeSet<OsString>) -> Result<(), DeleteFailure> {
  let entries = directory.entries()?.map(|entry| entry.map(|entry| entry.file_name()));
  verify_member_stream(expected, entries)
}

fn verify_member_stream(expected: &BTreeSet<OsString>, observed: impl Iterator<Item = Result<OsString, DeleteFailure>>) -> Result<(), DeleteFailure> {
  let mut observed_count = 0_usize;
  for name in observed {
    let name = name?;
    if !expected.contains(&name) {
      return Err(DeleteFailure::Changed);
    }
    observed_count = observed_count.checked_add(1).ok_or(DeleteFailure::Unverifiable)?;
    if observed_count > expected.len() {
      return Err(DeleteFailure::Changed);
    }
  }
  if observed_count == expected.len() { Ok(()) } else { Err(DeleteFailure::Changed) }
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/service.rs",
		source: `
use std::time::Duration;
const DELETE_BATCH_IDLE_TTL: Duration = Duration::from_secs(120);

impl WorkspaceService {
  async fn prepare_delete(&self, workspace: &WindowWorkspace) {
    workspace.prepare_delete();
  }
  async fn cancel_delete(&self, workspace: &WindowWorkspace) {
    workspace.cancel_delete();
  }
  async fn begin_delete(&self, workspace: &WindowWorkspace) {
    workspace.begin_delete();
  }
  async fn commit_delete_entry(&self, workspace: &WindowWorkspace) {
    workspace.commit_delete_entry();
  }
}

impl WindowWorkspace {
  fn prepare_delete(&self) {
    let _mutation = lock(&self.mutation_gate);
    let _state = lock(&self.state);
  }
  fn cancel_delete(&self) {
    let _mutation = lock(&self.mutation_gate);
    let _state = lock(&self.state);
  }
  fn begin_delete(&self) {
    let _mutation = lock(&self.mutation_gate);
    let _state = lock(&self.state);
  }
  fn commit_delete_entry(&self) {
    let _mutation = lock(&self.mutation_gate);
    let _state = lock(&self.state);
  }
}

struct WindowWorkspaceState {
  active_delete_batch: Option<DeleteBatchReceipt>,
}

fn delete_deadline() -> Duration {
  DELETE_BATCH_IDLE_TTL
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/dto.rs",
		source: `
struct WorkspacePrepareDeleteRequest;
struct WorkspaceDeleteBatchPlan;
struct WorkspaceDeleteBatchRequest;
struct WorkspaceCommitDeleteEntryRequest;
struct WorkspaceDeleteResult;
`,
	},
];

const workspaceCopyLimits = Object.freeze([
	{
		path: "src-tauri/src/workspace/writer.rs",
		name: "MAX_COPY_FILE_BYTES",
		integerType: "usize",
		expression: "8 * 1_024 * 1_024",
		value: 8_388_608,
		equivalent: "(1 << 23)",
	},
	{
		path: "src-tauri/src/workspace/writer.rs",
		name: "MAX_COPY_SYMLINK_BYTES",
		integerType: "usize",
		expression: "4 * 1_024",
		value: 4_096,
		equivalent: "0x1000usize",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_TREE_ENTRIES",
		integerType: "usize",
		expression: "10_000",
		value: 10_000,
		equivalent: "5 * (1_000 + 1_000)",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_ENTRY_NAME_BYTES",
		integerType: "usize",
		expression: "1_024",
		value: 1_024,
		equivalent: "1 << 10",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_TREE_NAME_BYTES",
		integerType: "usize",
		expression: "2 * 1_024 * 1_024",
		value: 2_097_152,
		equivalent: "2_097_152usize",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_TREE_DEPTH",
		integerType: "usize",
		expression: "256",
		value: 256,
		equivalent: "0x100",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_TREE_SYMLINK_BYTES",
		integerType: "u64",
		expression: "2 * 1_024 * 1_024",
		value: 2_097_152,
		equivalent: "1 << 21",
	},
	{
		path: "src-tauri/src/workspace/directory_copy.rs",
		name: "MAX_COPY_TREE_BYTES",
		integerType: "u64",
		expression: "256 * 1_024 * 1_024",
		value: 268_435_456,
		equivalent: "1 << (8 + 20)",
	},
]);

function workspaceCopyLimitFailure(name, value, integerType) {
	return `workspace copy limits must define exactly one ${name}: ${integerType} = ${value}`;
}

describe("Plain workspace Rust boundary contracts", () => {
	it("accepts one capability root authorizer and ignores test fixtures", () => {
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).toEqual([]);
	});

	it("locks every file, symlink and tree budget to one typed semantic declaration", () => {
		for (const {
			path,
			name,
			integerType,
			expression,
			value,
		} of workspaceCopyLimits) {
			const failure = workspaceCopyLimitFailure(name, value, integerType);
			const declaration = `const ${name}: ${integerType} = ${expression};`;

			const missing = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(declaration, ""),
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, missing)).toContain(
				failure,
			);

			const wrong = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(
					declaration,
					`const ${name}: ${integerType} = (${expression}) + 1;`,
				),
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, wrong)).toContain(
				failure,
			);

			const wrongType = mutateWorkspaceSource(
				workspaceSources,
				path,
				(source) =>
					source.replace(
						declaration,
						`const ${name}: ${integerType === "usize" ? "u64" : "usize"} = ${expression};`,
					),
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, wrongType),
			).toContain(failure);

			const renamed = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(name, `${name}_ALIAS`),
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, renamed)).toContain(
				failure,
			);

			const deadDuplicate = mutateWorkspaceSource(
				workspaceSources,
				path,
				(source) =>
					`${source}\n#[cfg(any())]\nconst ${name}: ${integerType} = ${expression};`,
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, deadDuplicate),
			).toContain(failure);
		}
	});

	it("accepts safe equivalent integer expressions for every copy budget", () => {
		for (const {
			path,
			name,
			integerType,
			expression,
			value,
			equivalent,
		} of workspaceCopyLimits) {
			const sources = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(
					`const ${name}: ${integerType} = ${expression};`,
					`const ${name}: ${integerType} = ${equivalent};`,
				),
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, sources),
			).not.toContain(workspaceCopyLimitFailure(name, value, integerType));
		}
	});

	it("binds every DirectoryCopyLimits field to its audited MAX_COPY constant", () => {
		const path = "src-tauri/src/workspace/directory_copy.rs";
		const failure =
			"workspace/directory_copy.rs must map every DirectoryCopyLimits field to its audited MAX_COPY constant";
		for (const [field, expression] of [
			["descendants", "MAX_COPY_TREE_ENTRIES"],
			["name_bytes", "MAX_COPY_ENTRY_NAME_BYTES"],
			["name_aggregate_bytes", "MAX_COPY_TREE_NAME_BYTES"],
			["depth", "MAX_COPY_TREE_DEPTH"],
			["link_bytes", "MAX_COPY_SYMLINK_BYTES"],
			["link_aggregate_bytes", "MAX_COPY_TREE_SYMLINK_BYTES"],
			["file_bytes", "MAX_COPY_FILE_BYTES as u64"],
			["file_aggregate_bytes", "MAX_COPY_TREE_BYTES"],
		]) {
			const sources = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(`${field}: ${expression},`, `${field}: u64::MAX,`),
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toContain(
				failure,
			);
		}
	});

	it("routes production directory copy through DIRECTORY_COPY_LIMITS directly", () => {
		const path = "src-tauri/src/workspace/directory_copy.rs";
		const failure =
			"workspace/directory_copy.rs production copy_directory must pass DIRECTORY_COPY_LIMITS directly";
		for (const replacement of [
			"UNBOUNDED_LIMITS",
			`DirectoryCopyLimits {
      descendants: usize::MAX,
      name_bytes: usize::MAX,
      name_aggregate_bytes: usize::MAX,
      depth: usize::MAX,
      link_bytes: usize::MAX,
      link_aggregate_bytes: u64::MAX,
      file_bytes: u64::MAX,
      file_aggregate_bytes: u64::MAX,
    }`,
		]) {
			const sources = mutateWorkspaceSource(workspaceSources, path, (source) =>
				source.replace(
					"    DIRECTORY_COPY_LIMITS,\n    &mut hooks,",
					`    ${replacement},\n    &mut hooks,`,
				),
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toContain(
				failure,
			);
		}

		const injectedTestLimits = mutateWorkspaceSource(
			workspaceSources,
			path,
			(source) => `${source}
fn copy_directory_for_test(limits: DirectoryCopyLimits, hooks: &mut Hooks) {
  copy_directory_with_limits_and_hooks(a, b, c, d, limits, hooks);
}`,
		);
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, injectedTestLimits),
		).not.toContain(failure);
	});

	it("ignores budget bait in comments, literals and longer identifiers", () => {
		const bait = workspaceCopyLimits
			.map(
				({ name, integerType }) =>
					`// const ${name}: ${integerType} = 1;\nconst ${name}_NOTE: &str = "const ${name}: ${integerType} = 1;";`,
			)
			.join("\n");
		const sources = mutateWorkspaceSource(
			workspaceSources,
			"src-tauri/src/workspace/directory_copy.rs",
			(source) => `${source}\n${bait}`,
		);
		expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toEqual([]);
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

	it("locks the sole direct sha2 edge and every Cargo metadata field", () => {
		const dependencies = [exactRustixDependency, exactSha2Dependency];
		expect(
			validateWorkspaceRustBoundaryContract(
				workspaceCargo,
				workspaceSources,
				dependencies,
				["default", "std"],
			),
		).toEqual([]);

		const cases = [
			[
				[exactRustixDependency],
				"Cargo metadata must contain exactly one direct sha2 dependency",
			],
			[
				[exactRustixDependency, exactSha2Dependency, exactSha2Dependency],
				"Cargo metadata must contain exactly one direct sha2 dependency",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, req: "^0.10.9" }],
				"the direct sha2 dependency must require exactly =0.10.9",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, rename: "digest" }],
				"the direct sha2 dependency must remain unrenamed",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, kind: "dev" }],
				"the direct sha2 dependency must be a normal runtime edge",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, kind: "build" }],
				"the direct sha2 dependency must be a normal runtime edge",
			],
			[
				[
					exactRustixDependency,
					{ ...exactSha2Dependency, target: "cfg(unix)" },
				],
				"the direct sha2 dependency must not be target-specific",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, optional: true }],
				"the direct sha2 dependency must not be optional",
			],
			[
				[
					exactRustixDependency,
					{ ...exactSha2Dependency, uses_default_features: true },
				],
				"the direct sha2 dependency must disable default features",
			],
			[
				[exactRustixDependency, { ...exactSha2Dependency, features: ["asm"] }],
				"the direct sha2 dependency must enable no explicit features",
			],
		];
		for (const [hostileDependencies, failure] of cases) {
			expect(
				validateWorkspaceRustBoundaryContract(
					workspaceCargo,
					workspaceSources,
					hostileDependencies,
					["default", "std"],
				),
			).toContain(failure);
		}
	});

	it("locks the exact sha2 manifest declaration and resolved feature set", () => {
		const declarationFailure =
			'Cargo.toml must declare exactly one sha2 = { version = "=0.10.9", default-features = false, features = [] } dependency';
		for (const hostileDeclaration of [
			'sha2 = "0.10.9"',
			'sha2 = { version = "0.10.9", default-features = false, features = [] }',
			'sha2 = { version = "=0.10.9", default-features = true, features = [] }',
			'sha2 = { version = "=0.10.9", default-features = false }',
			'sha2 = { version = "=0.10.9", default-features = false, features = ["std"] }',
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo.replace(
						'sha2 = { version = "=0.10.9", default-features = false, features = [] }',
						hostileDeclaration,
					),
					workspaceSources,
				),
			).toContain(declarationFailure);
		}

		for (const features of [
			[],
			["std"],
			["default"],
			["asm", "default", "std"],
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo,
					workspaceSources,
					[],
					features,
				),
			).toContain(
				"resolved sha2@0.10.9 features must remain exactly default and std",
			);
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

	it("rejects every forbidden recursive-directory dependency even when renamed", () => {
		for (const dependency of [
			"walkdir",
			"jwalk",
			"globwalk",
			"fs_extra",
			"dircpy",
			"copy_dir",
		]) {
			const failure = `Cargo metadata must not contain direct recursive-directory dependency ${dependency}, including renamed dependencies`;
			for (const kind of [null, "dev", "build"]) {
				expect(
					validateWorkspaceRustBoundary(workspaceCargo, workspaceSources, [
						{
							name: dependency,
							req: "^99",
							kind,
							rename: `bounded_${dependency}`,
						},
					]),
				).toContain(failure);
			}
		}
	});

	it("rejects direct Trash and process delete-bypass dependencies", () => {
		for (const dependency of [
			"async-process",
			"duct",
			"subprocess",
			"trash",
			"xshell",
		]) {
			const failure = `Cargo metadata must not contain direct delete-bypass dependency ${dependency}, including renamed dependencies`;
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, workspaceSources, [
					{
						name: dependency,
						req: "^99",
						kind: null,
						rename: `safe_${dependency}`,
					},
				]),
			).toContain(failure);
		}
	});

	it("rejects recursive-directory crate aliases and re-exports across production", () => {
		for (const [dependency, binding] of [
			["walkdir", "pub(crate) use walkdir::WalkDir as BoundedWalk;"],
			["jwalk", "use jwalk as bounded_walk;"],
			["globwalk", "pub use {globwalk as bounded_walk};"],
			["fs_extra", "pub(super) use fs_extra::dir as bounded_dir;"],
			["dircpy", "extern crate dircpy;"],
			["copy_dir", "pub(crate) use copy_dir::copy_dir as bounded_copy;"],
		]) {
			const relativePath = "src-tauri/src/directory_reexports.rs";
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, [
					...workspaceSources,
					{ relativePath, source: binding },
				]),
			).toContain(
				`${relativePath} must not bind, alias or re-export recursive-directory crate ${dependency}`,
			);
		}
	});

	it("allows ignore as a direct search dependency but rejects its walkers in workspace", () => {
		const ignoreDependency = {
			name: "ignore",
			req: "^99",
			kind: null,
			rename: "search_ignore",
		};
		for (const source of [
			"use ignore::WalkBuilder; fn search() {}",
			'extern crate ignore as ig; fn search() { ig::WalkBuilder::new("."); }',
			'use ignore::{self as ig}; fn search() { ig::Walk::new("."); }',
			"use search_ignore::WalkBuilder; fn search() {}",
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo,
					[
						...workspaceSources,
						{ relativePath: "src-tauri/src/search.rs", source },
					],
					[ignoreDependency],
				),
			).toEqual([]);
		}

		const relativePath = "src-tauri/src/workspace/directory_helpers.rs";
		const failure = `${relativePath} must not use or re-export ignore::Walk or ignore::WalkBuilder for workspace traversal`;
		for (const source of [
			"use ignore::Walk; fn walk() {}",
			"pub(crate) use ignore::{WalkBuilder as BoundedWalk};",
			'use ignore as walker; fn walk() { walker::WalkBuilder::new("."); }',
			"pub(super) use {ignore as walker};",
			'extern crate ignore as ig; fn walk() { ig::WalkBuilder::new("."); }',
			'use ignore::{self as ig}; fn walk() { ig::Walk::new("."); }',
			'use search_ignore::{self as ig}; fn walk() { ig::WalkBuilder::new("."); }',
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo,
					[...workspaceSources, { relativePath, source }],
					[ignoreDependency],
				),
			).toContain(failure);
		}

		const pathPolicy = "src-tauri/src/path_policy.rs";
		expect(
			validateWorkspaceRustBoundary(
				workspaceCargo,
				[
					...workspaceSources,
					{
						relativePath: pathPolicy,
						source:
							'use ignore::{self as ig}; fn policy() { ig::WalkBuilder::new("."); }',
					},
				],
				[ignoreDependency],
			),
		).toContain(
			`${pathPolicy} must not use or re-export ignore::Walk or ignore::WalkBuilder for workspace traversal`,
		);
	});

	it("does not mistake comments, literals or internal modules for walker crates", () => {
		const harmless = {
			relativePath: "src-tauri/src/workspace/names.rs",
			source: `
// use walkdir::WalkDir;
const NOTE: &str = "ignore::WalkBuilder fs_extra copy_dir";
use crate::walkdir as internal_walkdir;
use self::jwalk::State;
fn names() {
  let walkdir = "label";
  let copy_dir_name = walkdir;
  let _ = copy_dir_name;
}
`,
		};
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				harmless,
			]),
		).toEqual([]);
	});

	it("rejects unbounded recursive helpers and link-following traversal", () => {
		const cases = [
			[
				'fn wide(directory: &cap_std::fs::Dir) { directory.create_dir_all("nested"); }',
				"must not use unbounded recursive directory create/remove helpers",
			],
			[
				'fn wide(directory: &cap_std::fs::Dir) { directory.remove_dir_all("nested"); }',
				"must not use unbounded recursive directory create/remove helpers",
			],
			[
				"fn follow(builder: Walker) { builder.follow_links(((true))); }",
				"must not enable link-following directory traversal",
			],
			[
				"use cap_fs_ext::FollowSymlinks::{Yes as Follow};",
				"must keep capability directory opens nofollow",
			],
		];
		for (const [source, suffix] of cases) {
			const relativePath = "src-tauri/src/workspace/directory_helpers.rs";
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, [
					...workspaceSources,
					{ relativePath, source },
				]),
			).toContain(`${relativePath} ${suffix}`);
		}

		for (const source of [
			"pub(crate) use std::fs::create_dir_all as create_tree;",
			"pub(super) use cap_fs_ext::FollowSymlinks::{Yes as Follow};",
		]) {
			const relativePath = "src-tauri/src/directory_reexports.rs";
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, [
					...workspaceSources,
					{ relativePath, source },
				]),
			).toContain(
				`${relativePath} must not re-export a forbidden recursive-directory operation`,
			);
		}
	});

	it("ignores forbidden recursive words in inert text and allows nofollow choices", () => {
		const harmless = {
			relativePath: "src-tauri/src/workspace/directory_helpers.rs",
			source: `
// create_dir_all remove_dir_all follow_links(true) FollowSymlinks::Yes
const NOTE: &str = "walkdir::WalkDir ignore::WalkBuilder";
fn safe(builder: Walker, options: Options) {
  builder.follow_links(false);
  options.follow(FollowSymlinks::No);
}
`,
		};
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				harmless,
			]),
		).toEqual([]);
	});

	it("requires dedicated directory copy traversal to use open_dir_nofollow", () => {
		const path = "src-tauri/src/workspace/directory_copy.rs";
		const narrowFailure =
			"workspace/directory_copy.rs must not use follow-capable directory open/conversion APIs outside its one staged-file open_with";
		const traversalFailure =
			"workspace/directory_copy.rs source and stage traversal helpers must call open_dir_nofollow directly";
		const linkFollowing = mutateWorkspaceSource(
			workspaceSources,
			path,
			(source) =>
				source.replace(
					'parent.open_dir_nofollow("child")',
					'parent.open_dir("child")',
				),
		);
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, linkFollowing),
		).toEqual(expect.arrayContaining([narrowFailure, traversalFailure]));

		for (const call of [
			'parent.open_dir_nofollow("source")',
			'parent.open_dir_nofollow("child")',
			'parent.open_dir_nofollow("parent")',
			"self.root.open_dir_nofollow(relative)",
		]) {
			const commentOnly = mutateWorkspaceSource(
				workspaceSources,
				path,
				(source) => source.replace(`let _ = ${call};`, `// let _ = ${call};`),
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, commentOnly),
			).toContain(traversalFailure);
		}

		for (const bypass of [
			'fn bypass(parent: &Dir) { let _ = parent.open("child"); }',
			'fn bypass(parent: &Dir, options: &OpenOptions) { let _ = Dir::open_with(parent, "child", options); }',
			"fn bypass(file: File) { let _ = Dir::from_std_file(file); }",
			"fn bypass(fd: i32) { let _ = Dir::from_raw_fd(fd); }",
		]) {
			const sources = mutateWorkspaceSource(
				workspaceSources,
				path,
				(source) => `${source}\n${bypass}`,
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toContain(
				narrowFailure,
			);
		}

		const ordinaryFileHelper = mutateWorkspaceSource(
			workspaceSources,
			path,
			(source) =>
				`${source}\nfn open_expected_file(parent: &Dir, name: &Path) { let _ = open_copy_source(parent, name); }`,
		);
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, ordinaryFileHelper),
		).not.toContain(narrowFailure);
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
				writer.source.replace(
					"const MAX_COPY_SYMLINK_BYTES: usize = 4 * 1_024;",
					"const MAX_COPY_SYMLINK_BYTES: usize = 8 * 1_024;",
				),
				"workspace copy limits must define exactly one MAX_COPY_SYMLINK_BYTES: usize = 4096",
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
			const source = writer.source.replace(
				"const MAX_COPY_SYMLINK_BYTES: usize = 4 * 1_024;",
				`const MAX_COPY_SYMLINK_BYTES: usize = ${expression};`,
			);
			const sources = workspaceSources.map((entry) =>
				entry.relativePath === writer.relativePath
					? { ...entry, source }
					: entry,
			);
			expect(
				validateWorkspaceRustBoundary(workspaceCargo, sources),
			).not.toContain(
				"workspace copy limits must define exactly one MAX_COPY_SYMLINK_BYTES: usize = 4096",
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

	it("binds publish_no_replace arguments and forbids every target pre-delete", () => {
		const writerPath = "src-tauri/src/workspace/writer.rs";
		const writer = workspaceSources.find(
			({ relativePath }) => relativePath === writerPath,
		).source;
		const failure =
			"workspace writer publish_no_replace must publish staging_name to target_name with one direct NOREPLACE call and no pre-delete";
		for (const source of [
			writer.replace(
				"  renameat_with(\n    parent,\n    staging_name,",
				"  parent.remove_file(target_name)?;\n  renameat_with(\n    parent,\n    staging_name,",
			),
			writer.replace(
				"    parent,\n    target_name,\n    RenameFlags::NOREPLACE,",
				"    parent,\n    staging_name,\n    RenameFlags::NOREPLACE,",
			),
			writer.replaceAll("target_name", "destination_name"),
		]) {
			const sources = mutateWorkspaceSource(
				workspaceSources,
				writerPath,
				() => source,
			);
			expect(validateWorkspaceRustBoundary(workspaceCargo, sources)).toContain(
				failure,
			);
		}

		const inertDeleteWords = mutateWorkspaceSource(
			workspaceSources,
			writerPath,
			(source) =>
				source.replace(
					"  renameat_with(\n    parent,\n    staging_name,",
					'  // parent.remove_file(target_name);\n  const NOTE: &str = "remove_dir(target_name)";\n  renameat_with(\n    parent,\n    staging_name,',
				),
		);
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, inertDeleteWords),
		).not.toContain(failure);
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

	it("requires the unique workspace_move command, result and service route", () => {
		expect(
			validateWorkspaceMoveCommandRegistration(workspaceMoveSources),
		).toEqual([]);

		const mutations = [
			[
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						"#[tauri::command]\npub(crate) async fn workspace_move",
						"pub(crate) async fn workspace_move",
					),
				"workspace/commands.rs must define exactly one audited workspace_move Tauri command",
			],
			[
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						"request: WorkspaceMoveRequest",
						"request: WorkspaceCopyRequest",
					),
				"workspace_move must accept request: WorkspaceMoveRequest and return Result<WorkspaceMoveResult, CommandError>",
			],
			[
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						"Result<WorkspaceMoveResult, CommandError>",
						"Result<(), CommandError>",
					),
				"workspace_move must accept request: WorkspaceMoveRequest and return Result<WorkspaceMoveResult, CommandError>",
			],
			[
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						"WorkspaceService::move_entry(",
						"writer::move_entry(",
					),
				"workspace_move must route exactly once through WorkspaceService::move_entry",
			],
			[
				"src-tauri/src/lib.rs",
				(source) =>
					source.replace(
						"workspace::commands::workspace_move,",
						"registered_move,",
					),
				"src-tauri/src/lib.rs must register workspace::commands::workspace_move exactly once in generate_handler",
			],
		];
		for (const [relativePath, transform, failure] of mutations) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				transform,
			);
			expect(validateWorkspaceMoveCommandRegistration(hostile)).toContain(
				failure,
			);
		}
	});

	it("keeps PublishedCopyReceipt Rust-only and consumes publication as a structured terminal state", () => {
		expect(validateWorkspaceMoveBoundary(workspaceMoveSources)).toEqual([]);

		const receiptCases = [
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						"pub(super) enum PublishedCopyReceipt",
						"#[derive(serde::Serialize)]\npub(super) enum PublishedCopyReceipt",
					),
				"PublishedCopyReceipt must not implement Serde",
			],
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					`${source}\nimpl serde::Deserialize for PublishedCopyReceipt {}`,
				"PublishedCopyReceipt must not implement Serde",
			],
			[
				"src-tauri/src/workspace/writer.rs",
				(source) =>
					`${source}\nimpl serde::Serialize for PublishedCopyReceipt {}`,
				"PublishedCopyReceipt must not implement Serde",
			],
			[
				"src-tauri/src/workspace/dto.rs",
				(source) => `${source}\nstruct WireReceipt(PublishedCopyReceipt);`,
				"src-tauri/src/workspace/dto.rs must not expose PublishedCopyReceipt across DTO or IPC boundaries",
			],
			[
				"src-tauri/src/workspace/commands.rs",
				(source) => `${source}\nfn leak(receipt: PublishedCopyReceipt) {}`,
				"src-tauri/src/workspace/commands.rs must not expose PublishedCopyReceipt across DTO or IPC boundaries",
			],
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						"receipt: PublishedCopyReceipt,",
						"receipt: &PublishedCopyReceipt,",
					),
				"consume_published_copy_receipt must consume PublishedCopyReceipt by value and return WorkspaceMoveResult directly",
			],
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						") -> WorkspaceMoveResult {\n  match receipt",
						") -> Result<WorkspaceMoveResult, CommandError> {\n  match receipt",
					),
				"consume_published_copy_receipt must consume PublishedCopyReceipt by value and return WorkspaceMoveResult directly",
			],
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						"  match receipt {",
						"  verify_target()?;\n  match receipt {",
					),
				"consume_published_copy_receipt must not surface an ordinary error or panic after publication",
			],
			[
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						"  Ok(consume_published_copy_receipt(receipt))",
						"  let result = consume_published_copy_receipt(receipt);\n  verify_target()?;\n  Ok(result)",
					),
				"the published receipt consumer must be the final successful expression with no fallible post-publication gap",
			],
		];
		for (const [relativePath, transform, failure] of receiptCases) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				transform,
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(failure);
		}
	});

	it("prepares every receipt before publication and leaves no fallible success tail", () => {
		const preparationFailure =
			"file, symlink and directory receipts must be fully prepared before their sole publication call";
		for (const [relativePath, transform] of [
			[
				"src-tauri/src/workspace/writer.rs",
				(source) =>
					source.replace(
						"  let prepared = PublishedFileReceipt { digest };\n  if let Err(error) = staged.publish(&target_name) {",
						"  if let Err(error) = staged.publish(&target_name) {",
					),
			],
			[
				"src-tauri/src/workspace/writer.rs",
				(source) =>
					source.replace(
						"  }\n  Ok(prepared)\n}\nfn transfer_symlink",
						"  }\n  verify_target()?;\n  Ok(prepared)\n}\nfn transfer_symlink",
					),
			],
			[
				"src-tauri/src/workspace/directory_copy.rs",
				(source) =>
					source.replace(
						"  let prepared = PublishedDirectoryReceipt {",
						"  let prepared = UnpublishedDirectoryReceipt {",
					),
			],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				transform,
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				preparationFailure,
			);
		}

		const fallibleTail = mutateWorkspaceSource(
			workspaceMoveSources,
			"src-tauri/src/workspace/writer.rs",
			(source) =>
				source.replace(
					"publish_no_replace(self.parent, &self.name, target_name)?;\n    self.active = false;",
					"publish_no_replace(self.parent, &self.name, target_name)?;\n    self.sync_all()?;\n    self.active = false;",
				),
		);
		expect(validateWorkspaceMoveBoundary(fallibleTail)).toContain(
			"staging publish methods must have no fallible operation after NOREPLACE succeeds",
		);
	});

	it("prepares directory move collections and makes post-delete accounting infallible", () => {
		const preparedFailure =
			"PublishedDirectoryReceipt must prepare directory maps, member sets and alias groups before publication";
		for (const transform of [
			(source) =>
				source.replace(
					"  source_directories: BTreeMap<PathBuf, DirectorySnapshot>,",
					"  directories_after_publish: BTreeMap<PathBuf, DirectorySnapshot>,",
				),
			(source) =>
				source.replace(
					"  let member_sets = prepare_member_sets(&manifest)?;",
					"  let member_sets = late_member_sets(&manifest)?;",
				),
			(source) =>
				source.replace(
					"  let removed_aliases = prepare_alias_groups(&manifest);",
					"  let removed_aliases = late_alias_groups(&manifest);",
				),
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				"src-tauri/src/workspace/directory_copy.rs",
				transform,
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(preparedFailure);
		}

		for (const allocation of [
			"let _ = build_manifest(source);",
			"let _ = receipt.manifest.directory_map();",
			"let _ = BTreeSet::new();",
			"receipt.member_sets.insert(path, set);",
			"let _ = entry.clone();",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				"src-tauri/src/workspace/directory_copy.rs",
				(source) =>
					source.replace(
						"fn verify_target_tree() {}",
						`fn verify_target_tree() { ${allocation} }`,
					),
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				"directory move must not build, clone or grow receipt collections after publication",
			);
		}

		const accountingFailure =
			"directory move must prepare counters before removal and perform only infallible bookkeeping after a successful source delete";
		for (const transform of [
			(source) =>
				source.replace(
					"    removed_entries = next_removed_entries;",
					"    verify_receipt()?;\n    removed_entries = next_removed_entries;",
				),
			(source) =>
				source.replace(
					"      *alias_count = next;\n      if remove_verified_source_file(&source_parent, source_basename).is_err() {",
					"      if remove_verified_source_file(&source_parent, source_basename).is_err() {",
				),
			(source) =>
				source.replace(
					"        return Err(WorkspaceMoveIncompleteReason::DeleteFailed);\n      }",
					"        return Err(WorkspaceMoveIncompleteReason::DeleteFailed);\n      }\n      alias_count.checked_add(1)?;",
				),
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				"src-tauri/src/workspace/directory_copy.rs",
				transform,
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				accountingFailure,
			);
		}
	});

	it("rejects same-root move paths before mutation at both DTO and service layers", () => {
		for (const relativePath of [
			"src-tauri/src/workspace/dto.rs",
			"src-tauri/src/workspace/service.rs",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				(source) =>
					source
						.replace(
							"source_root_id == target_root_id",
							"source_root_id != target_root_id",
						)
						.replace(
							"self.source_root_id == self.target_root_id",
							"self.source_root_id != self.target_root_id",
						),
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				relativePath.endsWith("dto.rs")
					? "WorkspaceMoveRequest::into_parts must directly reject equal source and target roots"
					: "WorkspaceService::move_entry must reject equal roots before entering the mutation/copy route",
			);
		}
		for (const relativePath of [
			"src-tauri/src/workspace/dto.rs",
			"src-tauri/src/workspace/service.rs",
		]) {
			const noRejection = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				(source) =>
					source.replace(
						"return Err(invalid_request());",
						"let _same_root_was_observed = true;",
					),
			);
			expect(validateWorkspaceMoveBoundary(noRejection)).toContain(
				relativePath.endsWith("dto.rs")
					? "WorkspaceMoveRequest::into_parts must directly reject equal source and target roots"
					: "WorkspaceService::move_entry must reject equal roots before entering the mutation/copy route",
			);
		}

		const tooLate = mutateWorkspaceSource(
			workspaceMoveSources,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"if source_root_id == target_root_id { return Err(invalid_request()); }\n    self.run_dual_root_mutation(source_root_id, target_root_id).await",
					"let result = self.run_dual_root_mutation(source_root_id, target_root_id).await;\n    if source_root_id == target_root_id { return Err(invalid_request()); }\n    result",
				),
		);
		expect(validateWorkspaceMoveBoundary(tooLate)).toContain(
			"WorkspaceService::move_entry must reject equal roots before entering the mutation/copy route",
		);
	});

	it("allows only audited staging cleanup and move parent-handle basename deletion", () => {
		const helperFailure =
			"source deletion must use the two audited move_entry parent-handle plus basename helpers";
		for (const hostileCall of [
			'parent.remove_file(Path::new("nested/source"))',
			"target_parent.remove_file(basename)",
			'parent.remove_dir(Path::new("nested/source"))',
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				"src-tauri/src/workspace/move_entry.rs",
				(source) =>
					source.replace(
						hostileCall.includes("remove_dir")
							? "parent.remove_dir(basename)"
							: "parent.remove_file(basename)",
						hostileCall,
					),
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(helperFailure);
		}

		for (const [relativePath, original, replacement] of [
			[
				"src-tauri/src/workspace/writer.rs",
				"self.parent.remove_file(&self.name)",
				"self.parent.remove_file(target_name)",
			],
			[
				"src-tauri/src/workspace/directory_copy.rs",
				"parent.remove_file(name)",
				"parent.remove_file(other_name)",
			],
			[
				"src-tauri/src/workspace/directory_copy.rs",
				"self.parent.remove_dir(&self.name)",
				"self.parent.remove_dir(target_name)",
			],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				(source) => source.replace(original, replacement),
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				`${relativePath} contains source deletion outside the exact staging cleanup allowlist`,
			);
		}

		const ufcs = mutateWorkspaceSource(
			workspaceMoveSources,
			"src-tauri/src/workspace/move_entry.rs",
			(source) =>
				`${source}\nfn bypass(parent: &Dir, basename: &Path) { let _ = Dir::remove_file(parent, basename); }`,
		);
		expect(validateWorkspaceMoveBoundary(ufcs)).toContain(
			"src-tauri/src/workspace/move_entry.rs must not alias, re-export or call source deletion through UFCS",
		);

		const targetRollback = mutateWorkspaceSource(
			workspaceMoveSources,
			"src-tauri/src/workspace/move_entry.rs",
			(source) =>
				source.replace(
					"remove_verified_source_file(&source_parent, &receipt.source_name)",
					"remove_verified_source_file(&target_parent, &receipt.target_name)",
				),
		);
		expect(validateWorkspaceMoveBoundary(targetRollback)).toContain(
			"verified source deletion helpers must be called only from the audited source receipt consumers",
		);
	});

	it("rejects recursive, open-dir, unlink, process, shell, walker and ambient-fs deletion bypasses", () => {
		const relativePath = "src-tauri/src/workspace/move_entry.rs";
		const cases = [
			[
				'fn bypass(parent: &Dir) { parent.remove_dir_all("source"); }',
				"must not use broad, open-directory or direct unlink deletion",
			],
			[
				"fn bypass(parent: &Dir) { parent.remove_open_dir_all(opened); }",
				"must not use broad, open-directory or direct unlink deletion",
			],
			[
				'fn bypass(parent: &Dir) { rustix::fs::unlinkat(parent, "source", AtFlags::empty()); }',
				"must not use broad, open-directory or direct unlink deletion",
			],
			[
				'use std::process::Command; fn bypass() { Command::new("rm"); }',
				"must not use process or shell deletion bypasses",
			],
			[
				"use tauri_plugin_shell::ShellExt; fn bypass() { Shell::new(); }",
				"must not use process or shell deletion bypasses",
			],
			[
				'use async_process as runner; fn bypass() { runner::Command::new("rm"); }',
				"must not use process or shell deletion bypasses",
			],
			[
				"fn bypass(command: *const i8) { libc::system(command); }",
				"must not use process or shell deletion bypasses",
			],
		];
		for (const [injection, suffix] of cases) {
			const hostile = mutateWorkspaceSource(
				workspaceMoveSources,
				relativePath,
				(source) => `${source}\n${injection}`,
			);
			expect(validateWorkspaceMoveBoundary(hostile)).toContain(
				`${relativePath} ${suffix}`,
			);
		}

		const followingOpen = mutateWorkspaceSource(
			workspaceMoveSources,
			relativePath,
			(source) =>
				`${source}\nfn bypass(root: &Dir, parent: &Path) { let _ = root.open_dir(parent); }`,
		);
		expect(validateWorkspaceMoveBoundary(followingOpen)).toContain(
			"workspace/move_entry.rs must reopen directory chains only with capability-relative nofollow operations",
		);

		const walker = mutateWorkspaceSource(
			workspaceMoveSources,
			relativePath,
			(source) => `${source}\nuse walkdir::WalkDir;`,
		);
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, walker, [
				{ name: "walkdir", req: "^2", kind: null, rename: null },
			]),
		).toEqual(
			expect.arrayContaining([
				"Cargo metadata must not contain direct recursive-directory dependency walkdir, including renamed dependencies",
				`${relativePath} must not bind, alias or re-export recursive-directory crate walkdir`,
			]),
		);

		const ambient = mutateWorkspaceSource(
			workspaceMoveSources,
			relativePath,
			(source) => `${source}\nfn bypass() { std::fs::remove_file("source"); }`,
		);
		expect(validateWorkspaceRustBoundary(workspaceCargo, ambient)).toContain(
			`${relativePath} uses forbidden ambient std::fs operation remove_file`,
		);
	});
});

describe("Plain confirmed-delete Harness contracts", () => {
	it("requires four unique Tauri commands with exact DTO, result and service routes", () => {
		expect(
			validateWorkspaceDeleteCommandRegistration(workspaceDeleteSources),
		).toEqual([]);

		const commandCases = [
			[
				"workspace_prepare_delete",
				"WorkspacePrepareDeleteRequest",
				"WorkspaceDeleteBatchPlan",
				"prepare_delete",
			],
			[
				"workspace_cancel_delete",
				"WorkspaceDeleteBatchRequest",
				"()",
				"cancel_delete",
			],
			[
				"workspace_begin_delete",
				"WorkspaceDeleteBatchRequest",
				"()",
				"begin_delete",
			],
			[
				"workspace_commit_delete_entry",
				"WorkspaceCommitDeleteEntryRequest",
				"WorkspaceDeleteResult",
				"commit_delete_entry",
			],
		];
		for (const [command, request, result, service] of commandCases) {
			const missingAttribute = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						`#[tauri::command]\npub(crate) async fn ${command}`,
						`pub(crate) async fn ${command}`,
					),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(missingAttribute),
			).toContain(
				`workspace/commands.rs must define exactly one audited ${command} Tauri command`,
			);

			const wrongRequest = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						new RegExp(`(fn ${command}\\([\\s\\S]*?request:\\s*)${request}`),
						"$1WorkspaceCopyRequest",
					),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(wrongRequest),
			).toContain(
				`${command} must accept request: ${request} and return Result<${result}, CommandError>`,
			);

			const extraConfirmationParameter = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						new RegExp(`(fn ${command}\\([\\s\\S]*?request:\\s*${request},)`),
						"$1\n  confirmed: bool,",
					),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(extraConfirmationParameter),
			).toContain(
				`${command} must accept request: ${request} and return Result<${result}, CommandError>`,
			);

			const extraBodyStatement = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(
						new RegExp(`(fn ${command}\\([\\s\\S]*?\\)\\s*->[^{]+\\{)`),
						"$1\n  let confirmed = true;",
					),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(extraBodyStatement),
			).toContain(
				`${command} must contain only its audited DTO decode and WorkspaceService::${service} route`,
			);

			const bypassedRoute = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/commands.rs",
				(source) =>
					source.replace(`service.${service}(`, `delete::${service}(`),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(bypassedRoute),
			).toContain(
				`${command} must route exactly once through WorkspaceService::${service}`,
			);

			const aliasedRegistration = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/lib.rs",
				(source) =>
					source.replace(
						`workspace::commands::${command},`,
						`registered_${command},`,
					),
			);
			expect(
				validateWorkspaceDeleteCommandRegistration(aliasedRegistration),
			).toContain(
				`src-tauri/src/lib.rs must register workspace::commands::${command} exactly once in generate_handler`,
			);
		}

		const extraDeleteServiceCall = mutateWorkspaceSource(
			workspaceDeleteSources,
			"src-tauri/src/workspace/commands.rs",
			(source) =>
				source.replace(
					"  service.begin_delete(window.label(), request.confirmation_id()).await",
					"  service.cancel_delete(window.label(), request.confirmation_id()).await?;\n  service.begin_delete(window.label(), request.confirmation_id()).await",
				),
		);
		expect(
			validateWorkspaceDeleteCommandRegistration(extraDeleteServiceCall),
		).toContain(
			"workspace_begin_delete must contain only its audited DTO decode and WorkspaceService::begin_delete route",
		);
	});

	it("keeps DeleteBatchReceipt unique, non-Serde, non-Clone and outside IPC DTOs", () => {
		expect(validateWorkspaceDeleteBoundary(workspaceDeleteSources)).toEqual([]);
		for (const [relativePath, transform, failure] of [
			[
				"src-tauri/src/workspace/delete.rs",
				(source) =>
					source.replace(
						"pub(super) struct DeleteBatchReceipt",
						"#[derive(serde::Serialize)]\npub(super) struct DeleteBatchReceipt",
					),
				"DeleteBatchReceipt must remain non-Serde and non-Clone Rust-only typestate",
			],
			[
				"src-tauri/src/workspace/delete.rs",
				(source) =>
					`${source}\nimpl Clone for DeleteBatchReceipt { fn clone(&self) -> Self { unreachable!() } }`,
				"DeleteBatchReceipt must remain non-Serde and non-Clone Rust-only typestate",
			],
			[
				"src-tauri/src/workspace/dto.rs",
				(source) => `${source}\nstruct LeakedReceipt(DeleteBatchReceipt);`,
				"src-tauri/src/workspace/dto.rs must not expose DeleteBatchReceipt across DTO or IPC boundaries",
			],
			[
				"src-tauri/src/workspace/service.rs",
				(source) => `${source}\nstruct DeleteBatchReceipt;`,
				"DeleteBatchReceipt must have exactly one production definition in workspace/delete.rs",
			],
			[
				"src-tauri/src/lib.rs",
				(source) => `${source}\nfn leak(receipt: DeleteBatchReceipt) {}`,
				"src-tauri/src/lib.rs must not expose DeleteBatchReceipt across DTO or IPC boundaries",
			],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				relativePath,
				transform,
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});

	it("keeps delete receipts compact and index-based", () => {
		const failure =
			"workspace/delete.rs must keep compact index-based receipt structures and non-Clone directory journals";
		for (const [original, replacement] of [
			["parent_chain: Vec<FileIdentity>", "parent_chain: Vec<PathBuf>"],
			["name: String,", "name: PathBuf,"],
			["parent: DirectoryIndex,", "parent: PathBuf,"],
			[
				"kind: ManifestEntryKind,",
				"relative: String,\n  kind: ManifestEntryKind,",
			],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => source.replace(original, replacement),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});

	it("keeps directory receipts, manifest entries and alias journals non-Clone", () => {
		const failure =
			"workspace/delete.rs must keep compact index-based receipt structures and non-Clone directory journals";
		for (const typeName of [
			"DirectoryReceipt",
			"ManifestEntry",
			"AliasJournal",
		]) {
			for (const transform of [
				(source) =>
					source.replace(
						`struct ${typeName}`,
						`#[derive(Clone)]\nstruct ${typeName}`,
					),
				(source) =>
					`${source}\nimpl Clone for ${typeName} { fn clone(&self) -> Self { unreachable!() } }`,
				(source) =>
					`${source}\nimpl Clone for self::${typeName} { fn clone(&self) -> Self { unreachable!() } }`,
			]) {
				const hostile = mutateWorkspaceSource(
					workspaceDeleteSources,
					"src-tauri/src/workspace/delete.rs",
					transform,
				);
				expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
			}
		}
	});

	it("rejects full manifest paths and mutable linear manifest searches", () => {
		const failure =
			"workspace/delete.rs must not retain full manifest paths or linearly search mutable manifests";
		for (const injection of [
			"fn bypass() { let _: BTreeMap<PathBuf, NodeSnapshot> = BTreeMap::new(); }",
			"fn bypass(relative: &Path) { let _ = relative.to_path_buf(); }",
			"fn bypass(relative: &Path) { let _ = Path::to_path_buf(relative); }",
			"fn bypass(receipt: &mut DirectoryReceipt) { let _ = receipt.entries.iter_mut().find(|entry| entry.name == target); }",
			"fn bypass(receipt: &mut DirectoryReceipt) { let _ = Iterator::find(receipt.entries.iter_mut(), |entry| entry.name == target); }",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => `${source}\n${injection}`,
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});

	it("rebaselines one remaining alias without cloning whole sets", () => {
		const failure =
			"workspace/delete.rs alias rebaseline must select one remaining index without cloning whole journal sets";
		for (const replacement of [
			"let cloned = aliases.get(&identity).cloned();\n  let current = aliases.get_mut(&identity).ok_or(failure)?;",
			"let cloned = current.remaining_indices.clone();\n  let current = aliases.get_mut(&identity).ok_or(failure)?;",
			"let cloned = current.remaining_indices.to_owned();\n  let current = aliases.get_mut(&identity).ok_or(failure)?;",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) =>
					source.replace(
						"let current = aliases.get_mut(&identity).ok_or(failure)?;",
						replacement,
					),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});

	it("streams observed members and drops the full observed receipt before journals", () => {
		const streamFailure =
			"workspace/delete.rs must verify observed directory members as a fail-fast stream without collecting a second set";
		for (const [original, replacement] of [
			[
				"observed: impl Iterator<Item = Result<OsString, DeleteFailure>>",
				"observed: BTreeSet<OsString>",
			],
			[
				"let entries = directory.entries()?.map(|entry| entry.map(|entry| entry.file_name()));",
				"let entries: BTreeSet<_> = directory.entries()?.collect();",
			],
			[
				"verify_member_stream(expected, entries)",
				"let observed = entries.collect::<Vec<_>>(); verify_member_stream(expected, observed.into_iter())",
			],
			["return Err(DeleteFailure::Changed);", "continue;"],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => source.replace(original, replacement),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(streamFailure);
		}

		const dropFailure =
			"workspace/delete.rs must explicitly drop the full observed receipt before building delete journals";
		for (const replacement of [
			"",
			"drop(&observed);",
			"drop(observed); let _late_use = &observed;",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => source.replace("drop(observed);", replacement),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(dropFailure);
		}
	});

	it("locks every delete namespace limit and the idle TTL to production use", () => {
		const limits = [
			["MAX_DELETE_BATCH_ENTRIES", "64"],
			["MAX_DELETE_DESCENDANTS", "10_000"],
			["MAX_DELETE_TREE_DEPTH", "256"],
			["MAX_DELETE_ENTRY_NAME_BYTES", "1_024"],
			["MAX_DELETE_TREE_NAME_BYTES", "2 * 1_024 * 1_024"],
			["MAX_DELETE_SYMLINK_BYTES", "4 * 1_024"],
			["MAX_DELETE_TREE_SYMLINK_BYTES", "2 * 1_024 * 1_024"],
		];
		for (const [name, expression] of limits) {
			for (const transform of [
				(source) =>
					source.replace(
						`const ${name}: usize = ${expression};`,
						`const ${name}: usize = (${expression}) + 1;`,
					),
				(source) =>
					source.replace(new RegExp(`([a-z_]+: )${name},`), `$1${expression},`),
			]) {
				const hostile = mutateWorkspaceSource(
					workspaceDeleteSources,
					"src-tauri/src/workspace/delete.rs",
					transform,
				);
				expect(validateWorkspaceDeleteBoundary(hostile)).toContain(
					"workspace/delete.rs must define and consume the exact audited delete namespace limits",
				);
			}
		}

		for (const replacement of [
			"Duration::from_secs(121)",
			"Duration::from_secs(120)",
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/service.rs",
				(source) =>
					replacement.endsWith("121)")
						? source.replace("Duration::from_secs(120)", replacement)
						: source.replace(
								"  DELETE_BATCH_IDLE_TTL",
								"  Duration::from_secs(120)",
							),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(
				"workspace/service.rs must define and consume a 120-second DELETE_BATCH_IDLE_TTL",
			);
		}

		const duplicateLimit = mutateWorkspaceSource(
			workspaceDeleteSources,
			"src-tauri/src/workspace/service.rs",
			(source) => `${source}\nconst MAX_DELETE_BATCH_ENTRIES: usize = 64;`,
		);
		expect(validateWorkspaceDeleteBoundary(duplicateLimit)).toContain(
			"workspace/delete.rs must define and consume the exact audited delete namespace limits",
		);
	});

	it("requires one service route and mutation_gate before state for every phase", () => {
		const serviceFailure =
			"WorkspaceService must define one route for each delete phase and delegate once to WindowWorkspace";
		const lockFailure =
			"every WindowWorkspace delete phase must lock mutation_gate before delete state";
		for (const method of [
			"prepare_delete",
			"cancel_delete",
			"begin_delete",
			"commit_delete_entry",
		]) {
			const bypassed = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/service.rs",
				(source) =>
					source.replace(`workspace.${method}();`, `delete::${method}();`),
			);
			expect(validateWorkspaceDeleteBoundary(bypassed)).toContain(
				serviceFailure,
			);

			const reversed = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/service.rs",
				(source) => {
					const marker = `fn ${method}(&self) {\n    let _mutation = lock(&self.mutation_gate);\n    let _state = lock(&self.state);`;
					return source.replace(
						marker,
						`fn ${method}(&self) {\n    let _state = lock(&self.state);\n    let _mutation = lock(&self.mutation_gate);`,
					);
				},
			);
			expect(validateWorkspaceDeleteBoundary(reversed)).toContain(lockFailure);
		}

		const secondReceipt = mutateWorkspaceSource(
			workspaceDeleteSources,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"active_delete_batch: Option<DeleteBatchReceipt>,",
					"active_delete_batch: Option<DeleteBatchReceipt>,\n  shadow_delete_batch: Option<DeleteBatchReceipt>,",
				),
		);
		expect(validateWorkspaceDeleteBoundary(secondReceipt)).toContain(
			"WindowWorkspace state must hold exactly one optional active DeleteBatchReceipt",
		);
	});

	it("allows only the audited parent-handle removal helper", () => {
		const failure =
			"workspace/delete.rs must delete only through one audited parent-handle remove_verified_entry helper";
		for (const [original, replacement] of [
			["parent.remove_file(basename)", "target.remove_file(basename)"],
			["parent.remove_dir(basename)", 'parent.remove_dir(Path::new("nested"))'],
			[
				"fn delete_top_leaf() {",
				'fn extra(parent: &Dir) { let _ = parent.remove_file("extra"); }\nfn delete_top_leaf() {',
			],
			[
				"fn delete_top_leaf() {",
				"fn extra(parent: &Dir, basename: &Path) { let _ = Dir::remove_file(parent, basename); }\nfn delete_top_leaf() {",
			],
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => source.replace(original, replacement),
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});

	it("rejects content hashing and recursive, ambient, Trash, process or walker bypasses", () => {
		const cases = [
			[
				"fn bypass() { let _ = Sha256::digest(bytes); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::io::Read; fn bypass(mut file: File) { let _ = file.read(&mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"fn bypass(mut file: File) { let _ = std::io::Read::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::io::Read as ContentRead; fn bypass(mut file: File) { let _ = ContentRead::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::io as hidden; fn bypass(mut file: File) { let _ = hidden::Read::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::{io as hidden}; fn bypass(mut file: File) { let _ = hidden::Read::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::io::{self as hidden}; fn bypass(mut file: File) { let _ = hidden::Read::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::{io::Read as HiddenRead}; fn bypass(mut file: File) { let _ = HiddenRead::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"use std::io::prelude::*; fn bypass(mut file: File) { let _ = file.read(&mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"fn bypass(mut file: File) { let reader = &mut file; let _ = reader.read(&mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"fn bypass(mut file: File) { let _ = <File as std::io::Read>::read(&mut file, &mut buffer); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"fn bypass(mut file: File) { let _ = std::io::copy(&mut file, &mut sink); }",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				"const MAX_DELETE_FILE_BYTES: usize = 8 * 1_024 * 1_024;",
				"workspace/delete.rs must not read or hash ordinary file contents or impose copy byte budgets",
			],
			[
				'fn bypass(parent: &Dir) { parent.remove_dir_all("entry"); }',
				"workspace/delete.rs must not use recursive, open-directory, direct-unlink or ambient-fs deletion",
			],
			[
				'fn bypass(parent: &Dir) { rustix::fs::unlinkat(parent, "entry", AtFlags::empty()); }',
				"workspace/delete.rs must not use recursive, open-directory, direct-unlink or ambient-fs deletion",
			],
			[
				'fn bypass() { std::fs::remove_file("entry"); }',
				"workspace/delete.rs must not use recursive, open-directory, direct-unlink or ambient-fs deletion",
			],
			[
				'fn bypass(root: &Dir) { let _ = root.open_dir("entry"); }',
				"workspace/delete.rs must reopen directory chains only with capability-relative nofollow operations",
			],
			[
				'use std::process::Command; fn bypass() { Command::new("rm"); }',
				"workspace/delete.rs must not use process, shell or recursive-walker deletion bypasses",
			],
			[
				"use walkdir::WalkDir;",
				"workspace/delete.rs must not use process, shell or recursive-walker deletion bypasses",
			],
			[
				"fn bypass() { trash::delete(path); }",
				"src-tauri/src/workspace/delete.rs must not route workspace deletion through Trash or atomic-delete surfaces",
			],
			[
				"fn bypass() { trash_rs::delete(path); }",
				"src-tauri/src/workspace/delete.rs must not route workspace deletion through Trash or atomic-delete surfaces",
			],
		];
		for (const [injection, failure] of cases) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteSources,
				"src-tauri/src/workspace/delete.rs",
				(source) => `${source}\n${injection}`,
			);
			expect(validateWorkspaceDeleteBoundary(hostile)).toContain(failure);
		}
	});
});

const workspaceDeleteAppSources = [
	{
		relativePath: "app/platform/tauri/native.ts",
		source: `
import { invoke } from "@tauri-apps/api/core";
export function createNativeBridge() {
  return {
    workspacePrepareDelete: async () => invoke("workspace_prepare_delete"),
    workspaceCancelDelete: async () => invoke("workspace_cancel_delete"),
    workspaceBeginDelete: async () => invoke("workspace_begin_delete"),
    workspaceCommitDeleteEntry: async () => invoke("workspace_commit_delete_entry"),
  };
}
`,
	},
	{
		relativePath: "app/platform/tauri/contracts.ts",
		source: `
interface PlainBridge {
  workspacePrepareDelete(): Promise<void>;
  workspaceCancelDelete(): Promise<void>;
  workspaceBeginDelete(): Promise<void>;
  workspaceCommitDeleteEntry(): Promise<void>;
}
`,
	},
	{
		relativePath: "app/platform/tauri/browser-mock.ts",
		source: `
export function createBrowserMockBridge() {
  return {
    async workspacePrepareDelete() {},
    async workspaceCancelDelete() {},
    async workspaceBeginDelete() {},
    async workspaceCommitDeleteEntry() {},
  };
}
`,
	},
	{
		relativePath: "app/features/workspace/file-system-provider.ts",
		source: "export const providerIsReadonly = true;",
	},
];

describe("Plain confirmed-delete TypeScript invocation boundary", () => {
	it("keeps one native invoke per command and no feature consumer before activation", () => {
		expect(
			validateWorkspaceDeleteTypeScriptBoundary(workspaceDeleteAppSources),
		).toEqual([]);
	});

	it("rejects missing, duplicated, indirect or wrongly-owned command literals", () => {
		const failure =
			"workspace_begin_delete must appear only as the direct invoke command of native workspaceBeginDelete";
		for (const hostile of [
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) =>
					source.replace('invoke("workspace_begin_delete")', "noop()"),
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) =>
					source.replace(
						'invoke("workspace_begin_delete")',
						"invoke(`workspace_begin_delete`)",
					),
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) =>
					source.replace(
						'invoke("workspace_begin_delete")',
						'invoke("workspace_" + "begin_delete")',
					),
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) =>
					source.replace(
						'invoke("workspace_begin_delete")',
						'invoke(["workspace", "begin", "delete"].join("_"))',
					),
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) => `${source}\nconst duplicate = "workspace_begin_delete";`,
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) =>
					source.replace(
						"workspaceBeginDelete: async () =>",
						"beginWithoutAuthorization: async () =>",
					),
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/browser-mock.ts",
				(source) => `${source}\nconst command = "workspace_begin_delete";`,
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) => `${source}\nconst indirectInvoke = invoke;`,
			),
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary(hostile);
			expect(
				failures.some(
					(message) =>
						message === failure ||
						message.includes("workspace_begin_delete") ||
						message.includes("invoke"),
				),
			).toBe(true);
		}
	});

	it("rejects aliased, namespace and duplicate invoke bindings", () => {
		for (const transform of [
			(source) =>
				source.replace(
					'import { invoke } from "@tauri-apps/api/core";',
					'import { invoke as call } from "@tauri-apps/api/core";',
				),
			(source) =>
				source.replace(
					'import { invoke } from "@tauri-apps/api/core";',
					'import * as core from "@tauri-apps/api/core";',
				),
			(source) => `${source}\nimport { invoke } from "@tauri-apps/api/core";`,
			(source) =>
				`${source}\nconst core = await import("@tauri-apps/api/core");`,
		]) {
			const hostile = mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				transform,
			);
			const failures = validateWorkspaceDeleteTypeScriptBoundary(hostile);
			expect(
				failures.some(
					(message) =>
						message.includes("direct native bridge binding") ||
						message.includes("exactly one direct invoke import") ||
						message.includes("indirectly reference invoke") ||
						message.includes("dynamically"),
				),
			).toBe(true);
		}
	});

	it("rejects direct, computed and destructured feature consumption", () => {
		for (const source of [
			"void bridge.workspaceBeginDelete();",
			'void bridge["workspaceCommitDeleteEntry"]();',
			"void bridge[`workspaceBeginDelete`]();",
			'void bridge["workspace" + "BeginDelete"]();',
			'const method = "workspace" + "BeginDelete"; void bridge[method]();',
			'const b = bridge; const method = "workspace" + "BeginDelete"; void b[method]();',
			"const b: PlainBridge = getBridge(); const method = getMethod(); void b[method]();",
			'const method = "workspace" + "BeginDelete"; void Reflect.get(bridge, method)();',
			"const { workspacePrepareDelete } = bridge;",
		]) {
			const hostile = [
				...workspaceDeleteAppSources,
				{
					relativePath: "app/features/workspace/delete-bypass.ts",
					source,
				},
			];
			const failures = validateWorkspaceDeleteTypeScriptBoundary(hostile);
			expect(
				failures.some(
					(message) =>
						message.includes("delete bridge") ||
						message.includes(
							"before the audited delete coordinator and provider authorization patch land",
						),
				),
			).toBe(true);
		}

		const platformBypass = [
			...workspaceDeleteAppSources,
			{
				relativePath: "app/platform/tauri/delete-bypass.ts",
				source: "void bridge.workspaceBeginDelete();",
			},
		];
		expect(validateWorkspaceDeleteTypeScriptBoundary(platformBypass)).toContain(
			"app/platform/tauri/delete-bypass.ts must not consume workspaceBeginDelete before the audited delete coordinator and provider authorization patch land",
		);
	});
});

const readonlyWorkspaceProvider = `
import { FileChangeType, FileOperationError, FileOperationResult, FilePermission, FileSystemProviderCapabilities, FileSystemProviderError, FileSystemProviderErrorCode, FileType, type IFileChange, type IFileDeleteOptions, type IFileOverwriteOptions, type IFileSystemProviderWithFileReadWriteCapability, type IFileWriteOptions, type IStat, type IWatchOptions } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { Emitter, Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { Disposable, type IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { PlainBridge, WorkspaceCapabilities, WorkspaceEntryKind, WorkspaceEntryStat, WorkspaceWriteResult } from "../../platform/tauri";
import { decodeWorkspaceCapabilities, decodeWorkspaceEntryStat, frozenWorkspaceEntryRequest } from "../../platform/tauri/workspace-codec";

export const PLAIN_WORKSPACE_SCHEME = "plain-workspace" as const;

interface ResolvedResource {}
interface ResolvedMutationResource extends ResolvedResource {}
export interface PlainWorkspaceProviderStat {}
export interface PlainWorkspaceReadFileResult {}
export type PlainWorkspaceWriteFileResult = {};

const SANITIZED_MESSAGES = Object.freeze({
  entryNotFound: "The workspace entry does not exist.",
  notDirectory: "The workspace entry is not a directory.",
  noPermissions: "The workspace entry cannot be accessed.",
  unavailable: "The workspace is unavailable.",
});

function fileSystemError(
  code: FileSystemProviderErrorCode,
  message: string,
): FileSystemProviderError {
  return FileSystemProviderError.create(message, code);
}

function noPermissions(): FileSystemProviderError {
  return fileSystemError(
    FileSystemProviderErrorCode.NoPermissions,
    SANITIZED_MESSAGES.noPermissions,
  );
}

function unavailable(): FileSystemProviderError {
  return fileSystemError(
    FileSystemProviderErrorCode.Unavailable,
    SANITIZED_MESSAGES.unavailable,
  );
}

function commandErrorCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }
    const code = Reflect.get(error, "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function mapReadError(error: unknown): FileSystemProviderError {
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
}

function mapWriteError(error: unknown): Error {
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
}

function kindToFileType(kind: WorkspaceEntryKind): FileType {
  switch (kind) {
    case "file":
      return FileType.File;
    case "directory":
      return FileType.Directory;
    case "symlink":
      return FileType.SymbolicLink;
    case "symlinkFile":
      return FileType.SymbolicLink | FileType.File;
    case "symlinkDirectory":
      return FileType.SymbolicLink | FileType.Directory;
    case "other":
      return FileType.Unknown;
  }
}

function providerStat(stat: WorkspaceEntryStat): PlainWorkspaceProviderStat {
  const readonlyFile =
    (stat.kind === "file" || stat.kind === "symlinkFile") &&
    stat.version === null;
  return Object.freeze({
    type: kindToFileType(stat.kind),
    size: stat.size,
    mtime: stat.mtime,
    ctime: stat.ctime,
    ...(readonlyFile ? { permissions: FilePermission.Readonly } : {}),
    plainVersion: stat.version,
  });
}

function createdProviderStat(value: unknown, expectedKind) {
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
}

function mapCreateError(error: unknown): Readonly<{
  error: FileSystemProviderError;
  rescan: boolean;
}> {
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
}

function createPlainWorkspaceMutationPolicy(
  platformCapabilities: WorkspaceCapabilities,
): boolean {
  const snapshot = decodeWorkspaceCapabilities(platformCapabilities);
  return (
    snapshot.create &&
    snapshot.renameNoReplace &&
    snapshot.copyMove &&
    snapshot.delete &&
    snapshot.versionedWrite
  );
}

class PlainWorkspaceFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.Readonly;
  readonly onDidChangeCapabilities = Event.None;
  private readonly changeEmitter = new Emitter();
  readonly onDidChangeFile = this.changeEmitter.event;

  constructor(
    private readonly bridge: PlainBridge,
    private readonly allowsMutationDispatch: boolean,
  ) {}

  watch(resource) {
    this.resolveResource(resource);
    return disposable;
  }

  async stat(resource) {
    const resolved = this.resolveResource(resource);
    try {
      return providerStat(
        await this.bridge.workspaceStat(resolved.rootId, resolved.relativePath),
      );
    } catch (error) {
      throw mapReadError(error);
    }
  }

  async readdir(resource) {
    const resolved = this.resolveResource(resource);
    try {
      return await this.bridge.workspaceReadDirectory(
        resolved.rootId,
        resolved.relativePath,
      );
    } catch (error) {
      throw mapReadError(error);
    }
  }

  async readFile() {
    return file.copy();
  }

  async plainReadFile(resource) {
    const resolved = this.resolveResource(resource);
    try {
      return await this.bridge.workspaceReadFile(
        resolved.rootId,
        resolved.relativePath,
      );
    } catch (error) {
      throw mapReadError(error);
    }
  }

  async plainWriteFile(resource, content, expectedVersion) {
    this.requireMutationDispatchAllowed();
    try {
      const result = await this.bridge.workspaceWriteFile(
        rootId,
        relativePath,
        expectedVersion,
        content,
      );
      if (result.status !== "written") {
        this.changeEmitter.fire(rootRescan);
      }
      return result;
    } catch (error) {
      throw mapWriteError(error);
    }
  }

  async plainCreateFile(resource: URI) {
    this.requireMutationDispatchAllowed();
    const resolved = this.resolveMutationResource(resource);
    try {
      const stat = createdProviderStat(
        await this.bridge.workspaceCreateFile(
          resolved.rootId,
          resolved.relativePath,
        ),
        "file",
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
  }

  async plainCreateDirectory(resource: URI) {
    this.requireMutationDispatchAllowed();
    const resolved = this.resolveMutationResource(resource);
    try {
      const stat = createdProviderStat(
        await this.bridge.workspaceCreateDirectory(
          resolved.rootId,
          resolved.relativePath,
        ),
        "directory",
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
  }

  async writeFile() {
    throw noPermissions();
  }

  async mkdir() {
    throw noPermissions();
  }

  async delete() {
    throw noPermissions();
  }

  async rename() {
    throw noPermissions();
  }

  private fireCreated(resource): void {
    this.changeEmitter.fire(
      Object.freeze([
        Object.freeze({
          type: FileChangeType.ADDED,
          resource,
        }),
      ]),
    );
  }

  private fireRootUpdated(resource): void {
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
  }

  private resolveMutationResource(resource) {
    try {
      const scheme = resource.scheme;
      const authority = resource.authority;
      const path = resource.path;
      const query = resource.query;
      const fragment = resource.fragment;
      if (
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
  }

  private resolveResource(resource) {
    return frozenWorkspaceEntryRequest(resource.authority, resource.path.slice(1));
  }

  private requireMutationDispatchAllowed(): void {
    if (!this.allowsMutationDispatch) {
      throw noPermissions();
    }
  }
}

export function createPlainWorkspaceFileSystemProvider(
  bridge: PlainBridge,
  platformCapabilities: WorkspaceCapabilities,
): PlainWorkspaceFileSystemProvider {
  return new PlainWorkspaceFileSystemProvider(
    bridge,
    createPlainWorkspaceMutationPolicy(platformCapabilities),
  );
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

	it("rejects Trash and FileAtomicDelete capability advertising", () => {
		for (const flag of ["Trash", "FileAtomicDelete"]) {
			const hostile = readonlyWorkspaceProvider.replace(
				"FileSystemProviderCapabilities.Readonly;",
				`FileSystemProviderCapabilities.Readonly |\n    FileSystemProviderCapabilities.${flag};`,
			);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				`Plain workspace provider must not advertise ${flag} before activation`,
			);
		}
	});

	it("rejects direct, computed or inherited provider copy surfaces", () => {
		const directCopy = readonlyWorkspaceProvider.replace(
			"  async writeFile() {",
			"  async copy() {}\n\n  async writeFile() {",
		);
		expect(validateWorkspaceProviderCopyBoundary(directCopy)).toContain(
			"Plain workspace provider must not expose copy before write activation",
		);

		const computedCopy = readonlyWorkspaceProvider.replace(
			"  async writeFile() {",
			'  ["copy"] = async () => {};\n\n  async writeFile() {',
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

	it("locks the policy gate, private versioned write seam, root rescan and public readonly failure", () => {
		for (const [hostile, expected] of [
			[
				readonlyWorkspaceProvider.replace("plainWriteFile", "plainWriteBypass"),
				"Plain workspace provider must expose exactly one audited private plainWriteFile seam",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.bridge.workspaceWriteFile(",
					"this.bridge.workspaceWriteFile(await this.bridge.workspaceWriteFile(",
				),
				"plainWriteFile must gate first, dispatch one versioned bridge write and retain one root-rescan branch",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.changeEmitter.fire(rootRescan);",
					"void rootRescan;",
				),
				"plainWriteFile must gate first, dispatch one versioned bridge write and retain one root-rescan branch",
			],
			[
				readonlyWorkspaceProvider.replace(
					"    this.requireMutationDispatchAllowed();\n",
					"",
				),
				"plainWriteFile must gate first, dispatch one versioned bridge write and retain one root-rescan branch",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  async writeFile() {\n    throw noPermissions();\n  }",
					"  async writeFile() {\n    return this.bridge.workspaceWriteFile();\n  }",
				),
				"public writeFile must remain a direct noPermissions failure without native dispatch",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.changeEmitter.event",
					"Event.None",
				),
				"Plain workspace provider file-change event must be sourced only from its private emitter",
			],
			[
				readonlyWorkspaceProvider.replace(
					"readonly onDidChangeCapabilities = Event.None;",
					"readonly onDidChangeCapabilities = this.changeEmitter.event;",
				),
				"Plain workspace provider capability event must remain exactly Event.None",
			],
			[
				readonlyWorkspaceProvider.replace(
					"if (!this.allowsMutationDispatch)",
					"if (false)",
				),
				"mutation dispatch gate must fail closed from the immutable primitive policy",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  private requireMutationDispatchAllowed(): void {",
					"  private leakMutationPolicy() { return this.allowsMutationDispatch; }\n\n  private requireMutationDispatchAllowed(): void {",
				),
				"Plain workspace mutation boolean may appear only in its constructor parameter and dispatch gate",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("locks both private create receipts while public mkdir remains readonly", () => {
		for (const [index, [hostile, expected]] of [
			[
				readonlyWorkspaceProvider.replace(
					"async plainCreateFile(resource: URI)",
					"async createFileBypass(resource: URI)",
				),
				"Plain workspace provider must expose exactly one audited plainCreateFile seam",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  async plainCreateFile(resource: URI) {\n    this.requireMutationDispatchAllowed();",
					"  async plainCreateFile(resource: URI) {",
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"const stat = createdProviderStat(",
					"const stat = providerStat(",
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.fireCreated(resolved.resource);",
					"void resolved.resource;",
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.fireCreated(resolved.resource);",
					"this.fireCreated(resource);",
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"await this.bridge.workspaceCreateFile(\n          resolved.rootId,\n          resolved.relativePath,\n        )",
					"await this.bridge.workspaceCreateFile(\n          resource.authority,\n          resource.path,\n        )",
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"this.fireCreated(resolved.resource);",
					'await this.bridge["workspace" + "CreateFile"](resolved.rootId, resolved.relativePath);\n    this.fireCreated(resolved.resource);',
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"await this.bridge.workspaceCreateDirectory(\n          resolved.rootId,\n          resolved.relativePath,\n        )",
					"await this.bridge.workspaceCreateDirectory(\n          resolved.rootId,\n          resolved.relativePath,\n        ) || await this.bridge.workspaceCreateDirectory(\n          resolved.rootId,\n          resolved.relativePath,\n        )",
				),
				"plainCreateDirectory must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  async mkdir() {\n    throw noPermissions();\n  }",
					"  async mkdir(resource) {\n    return this.bridge.workspaceCreateDirectory(rootId, resource.path);\n  }",
				),
				"public mkdir must remain a direct noPermissions failure without native dispatch",
			],
		].entries()) {
			expect(hostile, `mutation ${index} must change the fixture`).not.toBe(
				readonlyWorkspaceProvider,
			);
			expect(
				validateWorkspaceProviderCopyBoundary(hostile),
				`mutation ${index}`,
			).toContain(expected);
		}
	});

	it("forbids read paths from consuming dormant mutations or publishing events", () => {
		for (const [hostile, expected] of [
			[
				readonlyWorkspaceProvider.replace(
					"  async stat(resource) {",
					"  async stat(resource) {\n    await this.plainCreateFile(resource);",
				),
				"Plain workspace provider methods must not internally consume dormant mutation seams",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  async stat(resource) {",
					"  async stat(resource) {\n    this.fireCreated(resource);",
				),
				"provider change events must remain confined to two create additions, two ambiguous root rescans and one write-outcome site",
			],
			[
				readonlyWorkspaceProvider.replace(
					"  async stat(resource) {",
					"  async stat(resource) {\n    this.changeEmitter.fire(rootRescan);",
				),
				"provider change events must remain confined to two create additions, two ambiguous root rescans and one write-outcome site",
			],
		]) {
			expect(hostile).not.toBe(readonlyWorkspaceProvider);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("locks create receipt, event and URI helper semantics", () => {
		for (const [hostile, expected] of [
			[
				readonlyWorkspaceProvider.replace("if (failure.rescan)", "if (false)"),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				readonlyWorkspaceProvider.replace("resource: root", "resource"),
				"fireRootUpdated must emit one frozen root UPDATED event and nothing else",
			],
			[
				readonlyWorkspaceProvider.replace("stat.version !== null", "false"),
				"createdProviderStat must strictly decode exact zero/null file or directory receipts",
			],
			[
				readonlyWorkspaceProvider.replace(
					"return Object.freeze({\n    type: expectedKind",
					"return providerStat(stat) || Object.freeze({\n    type: expectedKind",
				),
				"createdProviderStat must strictly decode exact zero/null file or directory receipts",
			],
			[
				readonlyWorkspaceProvider.replace(
					"type: FileChangeType.ADDED",
					"type: FileChangeType.DELETED",
				),
				"fireCreated must emit one frozen target ADDED event and nothing else",
			],
			[
				readonlyWorkspaceProvider.replace(
					"return Object.freeze({ ...request, resource: eventResource });",
					"return Object.freeze({ ...request, resource });",
				),
				"mutation URI helper must read each primitive once and return one frozen request/event snapshot",
			],
			[
				readonlyWorkspaceProvider.replace(
					"const request = frozenWorkspaceEntryRequest(authority, relativePath);",
					"const request = Object.freeze({ rootId: authority, relativePath });",
				),
				"mutation URI helper must read each primitive once and return one frozen request/event snapshot",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("locks one self-contained sanitized create error mapping", () => {
		const passthrough = readonlyWorkspaceProvider.replace(
			"  let code: string | undefined;",
			"  return Object.freeze({ error: error as FileSystemProviderError, rescan: false });\n  let code: string | undefined;",
		);
		const wrongConflict = readonlyWorkspaceProvider.replace(
			'case "ENTRY_ALREADY_EXISTS":',
			'case "ENTRY_NOT_FOUND":',
		);
		const messageProbe = readonlyWorkspaceProvider.replace(
			"  } catch {\n    code = undefined;\n  }\n  switch (code) {",
			'  } catch {\n    code = undefined;\n  }\n  void Reflect.get(error, "message");\n  switch (code) {',
		);
		for (const hostile of [passthrough, wrongConflict, messageProbe]) {
			expect(hostile).not.toBe(readonlyWorkspaceProvider);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"mapCreateError must own one exact sanitized code-to-provider-error mapping",
			);
		}
	});

	it("requires every private error mapper and its audited call sites", () => {
		const missingReadMapper = readonlyWorkspaceProvider
			.replace("function mapReadError(", "function removedMapReadError(")
			.replaceAll("throw mapReadError(error);", "throw error;");
		const missingWriteMapper = readonlyWorkspaceProvider
			.replace("function mapWriteError(", "function removedMapWriteError(")
			.replace("throw mapWriteError(error);", "throw error;");

		expect(validateWorkspaceProviderCopyBoundary(missingReadMapper)).toEqual(
			expect.arrayContaining([
				"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
				"mapReadError must have exactly 3 audited direct call sites",
			]),
		);
		expect(validateWorkspaceProviderCopyBoundary(missingWriteMapper)).toEqual(
			expect.arrayContaining([
				"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
				"mapWriteError must have exactly 1 audited direct call sites",
			]),
		);
	});

	it("keeps non-API provider declarations module-private", () => {
		for (const hostile of [
			readonlyWorkspaceProvider.replace(
				"function createdProviderStat(",
				"export function createdProviderStat(",
			),
			readonlyWorkspaceProvider.replace(
				"const SANITIZED_MESSAGES",
				"export const SANITIZED_MESSAGES",
			),
			readonlyWorkspaceProvider.replace(
				"interface ResolvedResource",
				"export interface ResolvedResource",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
			);
		}
	});

	it("fixes the provider factory to one direct audited policy construction", () => {
		for (const hostileFactory of [
			readonlyWorkspaceProvider.replace(
				"return new PlainWorkspaceFileSystemProvider(\n    bridge,\n    createPlainWorkspaceMutationPolicy(platformCapabilities),\n  );",
				"return new Proxy(new PlainWorkspaceFileSystemProvider(bridge, createPlainWorkspaceMutationPolicy(platformCapabilities)), {});",
			),
			readonlyWorkspaceProvider.replace(
				"return new PlainWorkspaceFileSystemProvider(\n    bridge,\n    createPlainWorkspaceMutationPolicy(platformCapabilities),\n  );",
				"const provider = new PlainWorkspaceFileSystemProvider(bridge, createPlainWorkspaceMutationPolicy(platformCapabilities));\n  return provider;",
			),
			readonlyWorkspaceProvider.replace(
				"    bridge,\n    createPlainWorkspaceMutationPolicy(platformCapabilities),",
				"    otherBridge,\n    createPlainWorkspaceMutationPolicy(platformCapabilities),",
			),
			readonlyWorkspaceProvider.replace(
				"createPlainWorkspaceMutationPolicy(platformCapabilities)",
				"createPlainWorkspaceMutationPolicy(otherCapabilities)",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostileFactory)).toContain(
				"Plain workspace provider factory must directly bind bridge and decoded platform capabilities",
			);
		}
	});

	it("locks one own-data all-five primitive policy", () => {
		for (const hostilePolicy of [
			readonlyWorkspaceProvider.replace(
				"decodeWorkspaceCapabilities(platformCapabilities)",
				"platformCapabilities",
			),
			readonlyWorkspaceProvider.replace(
				"    snapshot.versionedWrite",
				"    true",
			),
			readonlyWorkspaceProvider.replace(
				"    snapshot.copyMove &&",
				"    snapshot.copyMove ||",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostilePolicy)).toContain(
				"mutation policy must decode one own-data DTO into an immutable all-five boolean",
			);
		}
	});

	it("locks the strict decoder import", () => {
		for (const [from, to, expected] of [
			[
				"decodeWorkspaceCapabilities, decodeWorkspaceEntryStat",
				"decodeWorkspaceCapabilities as decodeCapabilities, decodeWorkspaceEntryStat",
				"file-system-provider.ts must import the strict workspace capability decoder exactly by name",
			],
			[
				"decodeWorkspaceCapabilities, decodeWorkspaceEntryStat",
				"decodeWorkspaceCapabilities, decodeWorkspaceEntryStat as decodeStat",
				"file-system-provider.ts must import the strict workspace entry stat decoder exactly by name",
			],
		]) {
			expect(
				validateWorkspaceProviderCopyBoundary(
					readonlyWorkspaceProvider.replace(from, to),
				),
			).toContain(expected);
		}
	});

	it("locks critical imports and rejects intrinsic or codec shadowing", () => {
		const objectShadow = `${readonlyWorkspaceProvider}\nconst Object = { freeze(value) { return value; } };`;
		const uriShadow = readonlyWorkspaceProvider.replace(
			'import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";',
			'import { URI as RealURI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";\ntype URI = RealURI;\nconst URI = { from(value) { return value as RealURI; } };',
		);
		const codecShadow = readonlyWorkspaceProvider
			.replace(
				"frozenWorkspaceEntryRequest }",
				"frozenWorkspaceEntryRequest as strictFrozenRequest }",
			)
			.concat(
				"\nfunction frozenWorkspaceEntryRequest(rootId, relativePath) { return Object.freeze({ rootId, relativePath }); }",
			);

		expect(validateWorkspaceProviderCopyBoundary(objectShadow)).toContain(
			"Object must remain the unshadowed global intrinsic in the Plain workspace provider",
		);
		expect(validateWorkspaceProviderCopyBoundary(uriShadow)).toEqual(
			expect.arrayContaining([
				"file-system-provider.ts must import URI exactly by name from its fixed Workbench module",
				"URI must have exactly one fixed import binding and no local shadow",
			]),
		);
		expect(validateWorkspaceProviderCopyBoundary(codecShadow)).toEqual(
			expect.arrayContaining([
				"file-system-provider.ts must import the frozen workspace request codec exactly by name",
				"file-system-provider.ts must import frozenWorkspaceEntryRequest exactly by name from its fixed Workbench module",
			]),
		);
	});

	it("rejects mutation or aliasing of critical runtime objects", () => {
		for (const hostile of [
			`${readonlyWorkspaceProvider}\n(FileChangeType as any).ADDED = FileChangeType.DELETED;`,
			`${readonlyWorkspaceProvider}\n(FilePermission as any).Readonly = 0;`,
			`${readonlyWorkspaceProvider}\nReflect.set(FileType, "File", FileType.Directory);`,
			`${readonlyWorkspaceProvider}\nfunction leak() { return FileChangeType; }`,
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toEqual(
				expect.arrayContaining([
					expect.stringMatching(
						/critical runtime bindings|must not be aliased or consumed/,
					),
				]),
			);
		}
	});

	it("rejects dynamic global, constructor and side-effect import escape routes", () => {
		for (const hostile of [
			`${readonlyWorkspaceProvider}\nconst intrinsics = globalThis as unknown as { [key: string]: { [key: string]: unknown } }; intrinsics["Object"]!["freeze"] = (value: unknown) => value;`,
			`${readonlyWorkspaceProvider}\nconst constructor = ({}).constructor;`,
			`${readonlyWorkspaceProvider}\nvoid import("./mutation-bypass");`,
			`import "./mutation-bypass";\n${readonlyWorkspaceProvider}`,
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toEqual(
				expect.arrayContaining([
					expect.stringMatching(
						/dynamic global|constructor or prototype|exact audited module/,
					),
				]),
			);
		}
	});

	it("rejects extra bridge-factory imports and top-level execution", () => {
		const hostile = `${readonlyWorkspaceProvider}
import { createBridge as createEscapeBridge } from "../../platform/tauri";
const escapedBridge = createEscapeBridge();
const escapedCreateName = ["workspace", "Create", "File"].join("");
void (escapedBridge as unknown as Record<string, (...args: string[]) => Promise<unknown>>)[escapedCreateName]?.("00000000-0000-4000-8000-000000000000", "escape.txt");`;
		expect(validateWorkspaceProviderCopyBoundary(hostile)).toEqual(
			expect.arrayContaining([
				"file-system-provider.ts imports must match the exact audited module, name and type-only surface",
				"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
			]),
		);
	});

	it("rejects live reassignment or aliasing of audited function bindings", () => {
		for (const [hostile, binding] of [
			[
				`${readonlyWorkspaceProvider}\nconst originalProviderFactory = createPlainWorkspaceFileSystemProvider; createPlainWorkspaceFileSystemProvider = (bridge, platformCapabilities) => originalProviderFactory(bridge, platformCapabilities);`,
				"createPlainWorkspaceFileSystemProvider",
			],
			[
				`${readonlyWorkspaceProvider}\nmapCreateError = (error: unknown): FileSystemProviderError => error as FileSystemProviderError;`,
				"mapCreateError",
			],
			[
				`${readonlyWorkspaceProvider}\ncreatedProviderStat = (_value: unknown, expectedKind: "file" | "directory") => Object.freeze({ type: expectedKind === "file" ? FileType.File : FileType.Directory, size: 0, mtime: 0, ctime: 0, plainVersion: null });`,
				"createdProviderStat",
			],
			[
				`${readonlyWorkspaceProvider}\ncreatePlainWorkspaceMutationPolicy = (_platformCapabilities: WorkspaceCapabilities): boolean => true;`,
				"createPlainWorkspaceMutationPolicy",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toEqual(
				expect.arrayContaining([
					expect.stringContaining(
						`${binding} must not be reassigned, aliased or consumed`,
					),
				]),
			);
		}
	});

	it("rejects constructor-time policy upgrades", () => {
		const hostile = readonlyWorkspaceProvider.replace(
			"  ) {}",
			"  ) { this.allowsMutationDispatch = true; }",
		);
		expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
			"Plain workspace provider constructor must retain only the bridge and immutable mutation boolean",
		);
	});

	it("keeps the provider class and policy builder module-private", () => {
		expect(
			validateWorkspaceProviderCopyBoundary(
				readonlyWorkspaceProvider.replace(
					"class PlainWorkspaceFileSystemProvider",
					"export class PlainWorkspaceFileSystemProvider",
				),
			),
		).toContain(
			"Plain workspace provider class must remain undecorated and module-private behind its audited factory",
		);
		expect(
			validateWorkspaceProviderCopyBoundary(
				readonlyWorkspaceProvider.replace(
					"function createPlainWorkspaceMutationPolicy(",
					"export function createPlainWorkspaceMutationPolicy(",
				),
			),
		).toContain(
			"mutation policy must decode one own-data DTO into an immutable all-five boolean",
		);
	});

	it("rejects method and class decorators before capability-gated mutation", () => {
		for (const hostile of [
			readonlyWorkspaceProvider.replace(
				"  async plainCreateFile(resource: URI)",
				"  @wrapCreate\n  async plainCreateFile(resource: URI)",
			),
			readonlyWorkspaceProvider.replace(
				"class PlainWorkspaceFileSystemProvider",
				"@wrapProvider\nclass PlainWorkspaceFileSystemProvider",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"Plain workspace provider source must not contain decorators that can wrap audited construction or mutation seams",
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

	it("rejects extra provider members and transitive bridge aliases", () => {
		const hostile = readonlyWorkspaceProvider.replace(
			"  async writeFile() {",
			`  private mutationBridge() { return this.bridge; }

  async transitiveCreate(resource) {
    const bridge = this.mutationBridge() as any;
    const method = "workspace" + "CreateFile";
    return bridge[method](resource.authority, resource.path);
  }

  async writeFile() {`,
		);
		expect(hostile).not.toBe(readonlyWorkspaceProvider);
		expect(validateWorkspaceProviderCopyBoundary(hostile)).toEqual(
			expect.arrayContaining([
				"Plain workspace provider member surface must remain the exact audited readonly/provider seam set",
				"every this.bridge reference must be the receiver of one fixed direct provider call",
			]),
		);
	});
});

describe("Plain workspace provider bootstrap contract", () => {
	const bootstrap = `
import { initialize } from "@codingame/monaco-vscode-api";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { createPlainWorkspaceFileSystemProvider, PLAIN_WORKSPACE_SCHEME } from "./features/workspace/file-system-provider";
import { createBridge } from "./platform/tauri";

async function bootstrap() {
const bridge = createBridge();
const workspaceCapabilities = await bridge.workspaceCapabilities();
const workspaceFileSystemProvider = createPlainWorkspaceFileSystemProvider(
  bridge,
  workspaceCapabilities,
);
registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
await initialize(createServiceOverrides(), container, { enableWorkspaceTrust: false });
}
`;

	it("requires one direct capability-bound registration before service initialization", () => {
		expect(validateWorkspaceProviderBootstrap(bootstrap)).toEqual([]);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);\n",
					"",
				),
			),
		).toEqual(
			expect.arrayContaining([
				"app/main.ts must register exactly one custom workspace provider",
				"app/main.ts must unconditionally register only the audited plain-workspace provider",
				"bootstrap order must remain createBridge -> capabilities -> provider -> register -> snapshot -> initialize",
			]),
		);
	});

	it("rejects a different scheme, duplicate registration or dead-code registration", () => {
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME",
					'registerCustomProvider("file"',
				),
			),
		).toContain(
			"app/main.ts must unconditionally register only the audited plain-workspace provider",
		);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"await initialize",
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);\nawait initialize",
				),
			),
		).toContain(
			"app/main.ts must register exactly one custom workspace provider",
		);
		expect(
			validateWorkspaceProviderBootstrap(
				bootstrap.replace(
					"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
					"if (false) { registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider); }",
				),
			),
		).toContain(
			"app/main.ts must unconditionally register only the audited plain-workspace provider",
		);
	});

	it("rejects missing, repeated, late or aliased capability reads", () => {
		const missing = bootstrap.replace(
			"const workspaceCapabilities = await bridge.workspaceCapabilities();\n",
			"",
		);
		expect(validateWorkspaceProviderBootstrap(missing)).toContain(
			"app/main.ts must await bridge.workspaceCapabilities exactly once in bootstrap",
		);

		const repeated = bootstrap.replace(
			"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			"void bridge.workspaceCapabilities();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
		);
		expect(validateWorkspaceProviderBootstrap(repeated)).toContain(
			"app/main.ts must await bridge.workspaceCapabilities exactly once in bootstrap",
		);
		const destructuredReread = bootstrap.replace(
			"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			"const { workspaceCapabilities: reread } = bridge;\nvoid reread();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
		);
		expect(validateWorkspaceProviderBootstrap(destructuredReread)).toContain(
			"app/main.ts must await bridge.workspaceCapabilities exactly once in bootstrap",
		);

		const late = bootstrap
			.replace(
				"const workspaceCapabilities = await bridge.workspaceCapabilities();\n",
				"",
			)
			.replace(
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				"const workspaceCapabilities = await bridge.workspaceCapabilities();\nregisterCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
			);
		expect(validateWorkspaceProviderBootstrap(late)).toContain(
			"bootstrap order must remain createBridge -> capabilities -> provider -> register -> snapshot -> initialize",
		);

		const aliased = bootstrap.replace(
			"  workspaceCapabilities,",
			"  otherCapabilities,",
		);
		expect(validateWorkspaceProviderBootstrap(aliased)).toContain(
			"app/main.ts must pass the sole capability snapshot directly to the Plain provider factory",
		);

		for (const indirect of [
			bootstrap.replace(
				"await bridge.workspaceCapabilities()",
				"bridge.workspaceCapabilities()",
			),
			bootstrap.replace(
				"bridge.workspaceCapabilities()",
				'bridge["workspaceCapabilities"]()',
			),
		]) {
			expect(validateWorkspaceProviderBootstrap(indirect)).toContain(
				"app/main.ts must await bridge.workspaceCapabilities exactly once in bootstrap",
			);
		}

		for (const dynamicReread of [
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				"void bridge[`workspaceCapabilities`]();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			),
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				'void Reflect.get(bridge, "workspaceCapabilities")();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();',
			),
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				"const bridgeAlias = bridge;\nvoid bridgeAlias.workspaceCapabilities();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			),
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				"let reread;\n({ workspaceCapabilities: reread } = bridge);\nvoid reread();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			),
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				"let reread;\n({ workspaceCapabilities: reread } = (void 0, bridge));\nvoid reread();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			),
			bootstrap.replace(
				"const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
				"let reread;\n({ workspaceCapabilities: reread } = (true ? bridge : bridge));\nvoid reread();\nconst initialWorkspaceSnapshot = await bridge.workspaceSnapshot();",
			),
		]) {
			expect(validateWorkspaceProviderBootstrap(dynamicReread)).toContain(
				"app/main.ts must not alias or dynamically access the audited bootstrap bridge",
			);
		}
	});

	it("locks audited imports and rejects local factory shadowing", () => {
		const aliasedImport = bootstrap.replace(
			'import { createBridge } from "./platform/tauri";',
			'import { createBridge as createRealBridge } from "./platform/tauri";',
		);
		expect(validateWorkspaceProviderBootstrap(aliasedImport)).toContain(
			"app/main.ts must import createBridge exactly by name from ./platform/tauri",
		);

		const shadowedFactory = bootstrap.replace(
			"const bridge = createBridge();",
			"function createPlainWorkspaceFileSystemProvider() { return fakeProvider; }\nconst bridge = createBridge();",
		);
		expect(validateWorkspaceProviderBootstrap(shadowedFactory)).toContain(
			"bootstrap must not shadow any audited provider-registration binding",
		);
	});

	it("rejects explicit early termination after bridge creation", () => {
		for (const terminator of [
			"return;",
			"if (true) { return; }",
			'throw new Error("stop");',
		]) {
			const hostile = bootstrap.replace(
				"const bridge = createBridge();",
				`const bridge = createBridge();\n${terminator}`,
			);
			expect(validateWorkspaceProviderBootstrap(hostile)).toContain(
				"bootstrap must not explicitly terminate between bridge creation and capability-bound initialization",
			);
		}
	});

	it("keeps capability read, provider construction and registration contiguous", () => {
		const interrupted = bootstrap.replace(
			"const workspaceCapabilities = await bridge.workspaceCapabilities();",
			"await bridge.runtimeInfo();\nconst workspaceCapabilities = await bridge.workspaceCapabilities();",
		);
		expect(validateWorkspaceProviderBootstrap(interrupted)).toContain(
			"bootstrap order must remain createBridge -> capabilities -> provider -> register -> snapshot -> initialize",
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

const versionedWriteRustSources = [
	{
		relativePath: "src-tauri/src/workspace/commands.rs",
		source: `
#[tauri::command]
pub(crate) async fn workspace_write_file(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
  let frame = WorkspaceWriteFileFrame::parse_invoke_body(request.body())?;
  let (root_id, relative_path, expected_version, content) = frame.into_parts();
  service.write_file(window.label(), root_id, relative_path, expected_version, content).await
}
`,
	},
	{
		relativePath: "src-tauri/src/lib.rs",
		source: `
fn run() {
  tauri::Builder::default().invoke_handler(tauri::generate_handler![
    workspace::commands::workspace_write_file,
  ]);
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/write_frame.rs",
		source: `
const PLW1_MAGIC: &[u8; 4] = b"PLW1";
const PLW1_HEADER_BYTES: usize = 14;
const ROOT_ID_BYTES: usize = 36;
impl WorkspaceWriteFileFrame {
  fn parse_invoke_body(body: &InvokeBody) -> Result<Self, CommandError> {
    match body {
      InvokeBody::Raw(bytes) => Self::parse(bytes),
      InvokeBody::Json(_) => Err(invalid_write_request()),
    }
  }
  fn parse(frame: &[u8]) -> Result<Self, CommandError> {
    let frame_end = PLW1_HEADER_BYTES.checked_add(frame.len()).unwrap();
    if content_length > MAX_VERSIONED_FILE_BYTES { return Err(file_too_large()); }
    if frame_end != frame.len() { return Err(invalid_write_request()); }
    todo!()
  }
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/versioned_writer.rs",
		source: `
trait WriteHooks {
  fn rename(&mut self, parent: &Dir, stage: &Path, target: &Path) -> rustix::io::Result<()> {
    rustix::fs::renameat(parent, stage, parent, target)
  }
  fn after_not_published_proof(&mut self, parent: &Dir, stage: &Path, target: &Path) {}
  fn remove_stage(&mut self, parent: &Dir, stage: &Path) -> io::Result<()> {
    remove_owned_stage(parent, stage)
  }
}
fn publish_and_classify(
  stage: StagedWrite,
  hooks: &mut impl WriteHooks,
  publication_parent: ParentChain,
) -> Result<WorkspaceWriteResult, CommandError> {
  let mut stage = stage;
  stage.disable_cleanup();
  let rename_result = hooks.rename(
    &publication_parent.parent,
    &stage.name,
    &publication_parent.name,
  );
  match rename_result {
    Ok(()) => Ok(WorkspaceWriteResult::written(stat)),
	    Err(rename_error) => match check_reported_rename_failure() {
	      RenameFailureCheck::NotPublishedProof => {
	        hooks.after_not_published_proof(
	          &publication_parent.parent,
	          &stage.name,
	          &publication_parent.name,
	        );
	        let removal = strict_remove_stage_after_rename(
	          &initial_parent,
	          initial_target,
	          &mut stage,
	          hooks,
	        );
	        match observe_rename_failure_target(
	          lease,
	          relative_path,
	          &initial_parent,
	          initial_target,
	          &stage,
	        ) {
          RenameFailureTarget::OldTarget if removal == StrictStageRemoval::Removed => {
            Err(map_rename_failure(rename_error))
          }
          RenameFailureTarget::ObservedWritten => Ok(WorkspaceWriteResult::rename_failed_with_observed_target()),
          RenameFailureTarget::OldTarget | RenameFailureTarget::Unknown => Ok(WorkspaceWriteResult::native_unknown()),
        }
      }
      RenameFailureCheck::ObservedWritten => Ok(WorkspaceWriteResult::rename_failed_with_observed_target()),
      RenameFailureCheck::Unknown => Ok(WorkspaceWriteResult::native_unknown()),
    },
  }
}
fn check_reported_rename_failure() -> RenameFailureCheck {
  let current_parent = open_parent_chain();
  parent_chain_matches();
  observe_rename_failure_target_at_parent();
  if stage_receipt_matches_at() {
    RenameFailureCheck::NotPublishedProof
  } else {
    RenameFailureCheck::Unknown
  }
}
fn strict_remove_stage_after_rename(
  initial_parent: &ParentChain,
  initial_target: TargetReceipt,
  stage: &mut StagedWrite,
  hooks: &mut impl WriteHooks,
) -> StrictStageRemoval {
  if !stage_receipt_matches_at(initial_parent, initial_target, stage) {
    return StrictStageRemoval::NotRemoved;
  }
  match hooks.remove_stage(&stage.parent, &stage.name) {
    Ok(()) if stage.opened_handle_is_unlinked() == Ok(true) => StrictStageRemoval::Removed,
    Ok(()) => StrictStageRemoval::NotRemoved,
    Err(_) => StrictStageRemoval::NotRemoved,
  }
}
fn observe_rename_failure_target() -> RenameFailureTarget {
  let current_parent = open_parent_chain();
  parent_chain_matches();
  observe_rename_failure_target_at_parent();
  RenameFailureTarget::OldTarget
}
fn remove_owned_stage(parent: &Dir, stage: &Path) -> io::Result<()> {
  parent.remove_file(stage)
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/dto.rs",
		source: `
#[derive(Serialize)]
enum WorkspaceWriteResultWire { Written, TargetPublished, OutcomeUnknown }
enum WorkspaceWritePublicationEvidence { RenameReportedSuccess, TargetObservedWritten }
enum WorkspaceWriteRenameObservation { ReportedSuccess, ReportedFailure }
enum WorkspaceWriteDirectorySyncObservation { Synced, Failed }
enum WorkspaceWriteTargetObservation { MatchesWritten, Changed, Unverifiable }
enum WorkspaceWriteNativeObservation { Native }
enum WorkspaceWriteFailedRenameObservation { ReportedFailure }
enum WorkspaceWriteUnknownDirectorySyncObservation { NotAttempted }
enum WorkspaceWriteAmbiguousTargetObservation { Ambiguous }
#[derive(Serialize)]
#[serde(transparent)]
pub struct WorkspaceWriteResult(WorkspaceWriteResultWire);
impl WorkspaceWriteResult {
  fn written(stat: WorkspaceEntryStat) -> Self {
    Self(WorkspaceWriteResultWire::Written { stat })
  }
  fn rename_succeeded_sync_failed_with_written_target() -> Self {
    Self(WorkspaceWriteResultWire::TargetPublished {
      publication_evidence: WorkspaceWritePublicationEvidence::TargetObservedWritten,
      rename: WorkspaceWriteRenameObservation::ReportedSuccess,
      directory_sync: WorkspaceWriteDirectorySyncObservation::Failed,
      target: WorkspaceWriteTargetObservation::MatchesWritten,
    })
  }
  fn rename_succeeded_with_changed_target(
    directory_sync: WorkspaceWriteDirectorySyncObservation,
  ) -> Self {
    Self(WorkspaceWriteResultWire::TargetPublished {
      publication_evidence: WorkspaceWritePublicationEvidence::RenameReportedSuccess,
      rename: WorkspaceWriteRenameObservation::ReportedSuccess,
      directory_sync,
      target: WorkspaceWriteTargetObservation::Changed,
    })
  }
  fn rename_succeeded_with_unverifiable_target(
    directory_sync: WorkspaceWriteDirectorySyncObservation,
  ) -> Self {
    Self(WorkspaceWriteResultWire::TargetPublished {
      publication_evidence: WorkspaceWritePublicationEvidence::RenameReportedSuccess,
      rename: WorkspaceWriteRenameObservation::ReportedSuccess,
      directory_sync,
      target: WorkspaceWriteTargetObservation::Unverifiable,
    })
  }
  fn rename_failed_with_observed_target(
    directory_sync: WorkspaceWriteDirectorySyncObservation,
    target: WorkspaceWriteTargetObservation,
  ) -> Self {
    Self(WorkspaceWriteResultWire::TargetPublished {
      publication_evidence: WorkspaceWritePublicationEvidence::TargetObservedWritten,
      rename: WorkspaceWriteRenameObservation::ReportedFailure,
      directory_sync,
      target,
    })
  }
  fn native_unknown() -> Self {
    Self(WorkspaceWriteResultWire::OutcomeUnknown {
      observation: WorkspaceWriteNativeObservation::Native,
      rename: WorkspaceWriteFailedRenameObservation::ReportedFailure,
      directory_sync: WorkspaceWriteUnknownDirectorySyncObservation::NotAttempted,
      target: WorkspaceWriteAmbiguousTargetObservation::Ambiguous,
    })
  }
  fn written_stat(&self) {
    match &self.0 {
      WorkspaceWriteResultWire::Written { stat } => stat,
      WorkspaceWriteResultWire::TargetPublished { .. } => todo!(),
      WorkspaceWriteResultWire::OutcomeUnknown { .. } => todo!(),
    }
  }
}
`,
	},
	{
		relativePath: "src-tauri/src/workspace/service.rs",
		source: `
async fn run_versioned_write() -> Result<WorkspaceWriteResult, CommandError> {
  let joined = tauri::async_runtime::spawn_blocking(move || {
    let _mutation = lock(&workspace.mutation_gate)?;
    workspace.validate_lease(leased_root_id)?;
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| operation(lease))) {
      Ok(result) => result,
      Err(_) => Err(workspace_write_response_unavailable()),
    }
  }).await;
  classify_versioned_write_join(joined)
}
fn classify_versioned_write_join(result: Result<Result<WorkspaceWriteResult, CommandError>, JoinError>) -> Result<WorkspaceWriteResult, CommandError> {
  match result {
    Ok(result) => result,
    Err(_) => Err(workspace_write_response_unavailable()),
  }
}
fn workspace_write_response_unavailable() -> CommandError {
  CommandError::new("WORKSPACE_WRITE_RESPONSE_UNAVAILABLE", "unavailable")
}
`,
	},
];

const versionedWriteAppSources = [
	{
		relativePath: "app/platform/tauri/native.ts",
		source: `
const bridge = {
  workspaceWriteFile: async (rootId, relativePath, expectedVersion, content) => {
    const frame = encodeWorkspaceWriteFileRequest(rootId, relativePath, expectedVersion, content);
    try {
      return decodeWorkspaceWriteResult(
        await invoke("workspace_write_file", frame),
        expectedVersion,
        frame[13],
      );
    } catch (error) {
      const commandError = decodeWorkspaceWritePrepublicationError(error);
      if (commandError !== undefined) throw commandError;
      return workspaceWriteResponseUnavailable();
    }
  },
};
`,
	},
	{
		relativePath: "app/platform/tauri/workspace-codec.ts",
		source: `
export const WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES = Object.freeze([
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
] as const);
const WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET = new Set<string>(
  WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODES,
);
function workspaceWriteContentSnapshot(content: unknown): Uint8Array {
  const snapshot = new Uint8Array(content.byteLength);
  Reflect.apply(typedArraySet, snapshot, [content, 0]);
  return snapshot;
}
export function encodeWorkspaceWriteFileRequest(rootId, relativePath, expectedVersion, content) {
  const contentSnapshot = workspaceWriteContentSnapshot(content);
  const frame = new Uint8Array(14 + contentSnapshot.byteLength);
  frame.set(contentSnapshot, 14);
  return frame;
}
export function decodeWorkspaceWriteResult(snapshot) {
  if (snapshot.status === "targetPublished") {
    if (
      !hasExactKeys(snapshot, [
        "status",
        "publicationEvidence",
        "rename",
        "directorySync",
        "target",
      ]) ||
      (snapshot.publicationEvidence !== "renameReportedSuccess" &&
        snapshot.publicationEvidence !== "targetObservedWritten") ||
      (snapshot.rename !== "reportedSuccess" &&
        snapshot.rename !== "reportedFailure") ||
      (snapshot.directorySync !== "synced" &&
        snapshot.directorySync !== "failed") ||
      (snapshot.target !== "matchesWritten" &&
        snapshot.target !== "changed" &&
        snapshot.target !== "unverifiable") ||
      (snapshot.rename === "reportedSuccess" &&
        snapshot.publicationEvidence === "targetObservedWritten" &&
        (snapshot.directorySync !== "failed" ||
          snapshot.target !== "matchesWritten")) ||
      (snapshot.rename === "reportedSuccess" &&
        snapshot.publicationEvidence === "renameReportedSuccess" &&
        snapshot.target === "matchesWritten") ||
      (snapshot.rename === "reportedFailure" &&
        snapshot.publicationEvidence !== "targetObservedWritten")
    ) {
      return violation();
    }
  }
  if (snapshot.status !== "outcomeUnknown") return violation();
  if (snapshot.observation === "native") {
    if (
      snapshot.rename !== "reportedFailure" ||
      snapshot.directorySync !== "notAttempted"
    ) {
      return violation();
    }
    return snapshot;
  }
  if (snapshot.observation !== "responseUnavailable") return violation();
  return snapshot;
}
export function decodeWorkspaceWritePrepublicationError(value: unknown) {
  try {
    const snapshot = ownPlainDataSnapshot(value);
    if (
      !hasExactKeys(snapshot, ["code", "message"]) ||
      typeof snapshot.code !== "string" ||
      !WORKSPACE_WRITE_PREPUBLICATION_ERROR_CODE_SET.has(snapshot.code) ||
      typeof snapshot.message !== "string" ||
      snapshot.message.length < 1 ||
      snapshot.message.length > MAX_COMMAND_ERROR_MESSAGE_LENGTH ||
      !isWellFormedUtf16(snapshot.message)
    ) {
      return undefined;
    }
    rejectProxyObject(value as object);
    return Object.freeze({
      code: snapshot.code,
      message: snapshot.message,
    });
  } catch {
    return undefined;
  }
}
`,
	},
];

function mutateVersionedWriteSource(sources, relativePath, mutation) {
	return sources.map((entry) =>
		entry.relativePath === relativePath
			? { ...entry, source: mutation(entry.source) }
			: entry,
	);
}

describe("Plain PLW1 versioned-write harness", () => {
	it("accepts only the raw command, single overwrite syscall and closed typestate", () => {
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				versionedWriteAppSources,
			),
		).toEqual([]);
	});

	it("rejects raw wrappers, alternate rename arguments and post-dispatch propagation", () => {
		const wrapped = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					'invoke("workspace_write_file", frame)',
					'invoke("workspace_write_file", { request: frame })',
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				wrapped,
			),
		).toContain(
			"workspace_write_file must appear only as invoke(command, frame) in native workspaceWriteFile",
		);

		const swapped = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/versioned_writer.rs",
			(source) =>
				source.replace(
					"rustix::fs::renameat(parent, stage, parent, target)",
					"rustix::fs::renameat(parent, target, parent, stage)",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				swapped,
				versionedWriteAppSources,
			),
		).toContain(
			"versioned writer must contain one direct parent+stage to parent+target rustix::fs::renameat call",
		);

		for (const injected of [
			"  Dir::rename(parent, stage, parent, target);\n",
			"  unsafe { libc::syscall(libc::SYS_renameat, parent, stage, parent, target); }\n",
		]) {
			const alternateRename = mutateVersionedWriteSource(
				versionedWriteRustSources,
				"src-tauri/src/workspace/versioned_writer.rs",
				(source) =>
					source.replace(
						"  match rename_result {",
						`${injected}  match rename_result {`,
					),
			);
			expect(
				validateWorkspaceVersionedWriteBoundary(
					alternateRename,
					versionedWriteAppSources,
				),
			).toContain(
				"versioned writer must not add an alternate, aliased or exchange rename path",
			);
		}

		const propagated = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/versioned_writer.rs",
			(source) =>
				source.replace(
					"  match rename_result {",
					"  observe_after_rename()?;\n  match rename_result {",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				propagated,
				versionedWriteAppSources,
			),
		).toContain(
			"publish_and_classify must not propagate, panic, rename again or directly delete after publication dispatch",
		);
		const returned = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/versioned_writer.rs",
			(source) =>
				source.replace(
					"  match rename_result {",
					"  return Err(stage_cleanup_failed());\n  match rename_result {",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				returned,
				versionedWriteAppSources,
			),
		).toContain(
			"post-rename ordinary errors must be confined to the proven NotPublished cleanup branch",
		);
	});

	it("rejects wrong-stage unlink, discarded unlink proof and forged wire constructors", () => {
		for (const mutation of [
			(source) =>
				source.replace(
					"hooks.remove_stage(&stage.parent, &stage.name)",
					"hooks.remove_stage(&initial_parent.parent, &initial_parent.name)",
				),
			(source) =>
				source.replace(
					"Ok(()) if stage.opened_handle_is_unlinked() == Ok(true) => StrictStageRemoval::Removed,",
					"Ok(()) => { let _ = stage.opened_handle_is_unlinked(); StrictStageRemoval::Removed },",
				),
		]) {
			const unsafeRemoval = mutateVersionedWriteSource(
				versionedWriteRustSources,
				"src-tauri/src/workspace/versioned_writer.rs",
				mutation,
			);
			expect(
				validateWorkspaceVersionedWriteBoundary(
					unsafeRemoval,
					versionedWriteAppSources,
				),
			).toContain(
				"reported rename failure must reverify and unlink only the owned stage, then reobserve the current-root target",
			);
		}

		const targetObservedBeforeRemoval = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/versioned_writer.rs",
			(source) =>
				source.replace(
					"let removal = strict_remove_stage_after_rename(",
					`match observe_rename_failure_target(
          lease,
          relative_path,
          &initial_parent,
          initial_target,
          &stage,
		) {
			_ => {}
		}
		let removal = strict_remove_stage_after_rename(`,
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				targetObservedBeforeRemoval,
				versionedWriteAppSources,
			),
		).toContain(
			"rename failure must classify proven not-published, observed-written and ambiguous outcomes separately",
		);

		const forgedWire = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				source.replace(
					"  fn written_stat(&self) {",
					`  fn forged_full_success_incomplete() -> Self {
    Self(WorkspaceWriteResultWire::TargetPublished {
      publication_evidence: WorkspaceWritePublicationEvidence::TargetObservedWritten,
      rename: WorkspaceWriteRenameObservation::ReportedSuccess,
      directory_sync: WorkspaceWriteDirectorySyncObservation::Synced,
      target: WorkspaceWriteTargetObservation::MatchesWritten,
    })
  }
  fn written_stat(&self) {`,
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				forgedWire,
				versionedWriteAppSources,
			),
		).toContain(
			"WorkspaceWriteResult must be a transparent wrapper over one private wire enum with only canonical constructors",
		);
	});

	it("rejects TypedArray enumeration, JSON acceptance and join-error downgrades", () => {
		const enumerating = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					"  const snapshot = new Uint8Array(content.byteLength);",
					"  Reflect.ownKeys(content);\n  const snapshot = new Uint8Array(content.byteLength);",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				enumerating,
			),
		).toContain(
			"PLW1 encoder must not enumerate TypedArray integer-index own keys",
		);
		for (const collector of [
			"const ownKeys = Reflect.ownKeys; ownKeys(content);",
			"Object.entries(content);",
			"const copied = [...content];",
		]) {
			const indirectEnumeration = mutateVersionedWriteSource(
				versionedWriteAppSources,
				"app/platform/tauri/workspace-codec.ts",
				(source) =>
					source.replace(
						"  const snapshot = new Uint8Array(content.byteLength);",
						`  ${collector}\n  const snapshot = new Uint8Array(content.byteLength);`,
					),
			);
			expect(
				validateWorkspaceVersionedWriteBoundary(
					versionedWriteRustSources,
					indirectEnumeration,
				),
			).toContain(
				"PLW1 private content snapshot may use only captured constant-space intrinsic operations",
			);
		}

		const dynamicDispatch = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"    try {",
					"    await invoke(['workspace', 'write', 'file'].join('_'), { request: frame });\n    try {",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				dynamicDispatch,
			),
		).toContain(
			"app/platform/tauri/native.ts must invoke only direct StringLiteral commands",
		);

		const jsonAccepted = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/write_frame.rs",
			(source) =>
				source.replace(
					"InvokeBody::Json(_) => Err(invalid_write_request()),",
					"InvokeBody::Json(value) => Self::parse_json(value),",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				jsonAccepted,
				versionedWriteAppSources,
			),
		).toContain(
			"PLW1 parser must accept InvokeBody::Raw and reject InvokeBody::Json exactly",
		);

		const downgradedJoin = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"Err(_) => Err(workspace_write_response_unavailable()),",
					"Err(_) => Err(workspace_mutation_failed()),",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				downgradedJoin,
				versionedWriteAppSources,
			),
		).toContain(
			"versioned-write runner must hold the mutation gate, revalidate the lease and conservatively classify join failure",
		);

		const downgradedOuterJoin = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/service.rs",
			(source) => {
				const start = source.indexOf("fn classify_versioned_write_join");
				const prefix = source.slice(0, start);
				const classifier = source
					.slice(start)
					.replace(
						"Err(_) => Err(workspace_write_response_unavailable()),",
						"Err(_) => Ok(WorkspaceWriteResult::native_unknown()),",
					);
				return prefix + classifier;
			},
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				downgradedOuterJoin,
				versionedWriteAppSources,
			),
		).toContain(
			"versioned-write JoinError must be classified only by the exact response-unavailable helper",
		);
		const shadowedOuterJoin = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"  classify_versioned_write_join(joined)",
					"  let joined = Ok(Ok(WorkspaceWriteResult::native_unknown()));\n  classify_versioned_write_join(joined)",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				shadowedOuterJoin,
				versionedWriteAppSources,
			),
		).toContain(
			"versioned-write runner must hold the mutation gate, revalidate the lease and conservatively classify join failure",
		);

		const whitelistedUnavailable = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				`const FORBIDDEN = "WORKSPACE_WRITE_RESPONSE_UNAVAILABLE";\n${source}`,
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				whitelistedUnavailable,
			),
		).toContain(
			"WORKSPACE_WRITE_RESPONSE_UNAVAILABLE must remain outside the ordinary pre-publication error whitelist",
		);

		const publicWire = mutateVersionedWriteSource(
			versionedWriteRustSources,
			"src-tauri/src/workspace/dto.rs",
			(source) =>
				source.replace(
					"enum WorkspaceWriteResultWire",
					"pub enum WorkspaceWriteResultWire",
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				publicWire,
				versionedWriteAppSources,
			),
		).toContain(
			"WorkspaceWriteResult must be a transparent wrapper over one private wire enum with only canonical constructors",
		);
	});

	it("rejects extra ordinary errors and Rust-unrepresentable terminal cross-fields", () => {
		const expandedWhitelist = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					'  "ROOT_UNAVAILABLE",',
					'  "ROOT_UNAVAILABLE",\n  "ENTRY_NOT_FOUND",',
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				expandedWhitelist,
			),
		).toContain(
			"workspace write ordinary rejection whitelist must equal the Rust pre-publication code set",
		);
		const bypassedWhitelistUse = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					"    const snapshot = ownPlainDataSnapshot(value);",
					`    const snapshot = ownPlainDataSnapshot(value);
    if (snapshot.code === "ENTRY_NOT_FOUND") {
      return Object.freeze({ code: snapshot.code, message: snapshot.message });
    }`,
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				bypassedWhitelistUse,
			),
		).toContain(
			"workspace write ordinary rejection decoder must use only the exact closed whitelist",
		);

		const relaxedNativeUnknown = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					'snapshot.directorySync !== "notAttempted"',
					'(snapshot.directorySync !== "notAttempted" && snapshot.directorySync !== "synced")',
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				relaxedNativeUnknown,
			),
		).toContain(
			"WorkspaceWriteResult decoder must accept only native reportedFailure/notAttempted unknown",
		);
		const earlyNativeUnknown = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					'  if (snapshot.observation === "native") {',
					`  if (snapshot.observation === "native" && snapshot.directorySync === "synced") {
    return snapshot;
  }
  if (snapshot.observation === "native") {`,
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				earlyNativeUnknown,
			),
		).toContain(
			"WorkspaceWriteResult decoder must accept only native reportedFailure/notAttempted unknown",
		);

		const relaxedTargetPublished = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					'snapshot.target !== "matchesWritten"',
					'snapshot.target !== "matchesWritten" && false',
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				relaxedTargetPublished,
			),
		).toContain(
			"WorkspaceWriteResult decoder must accept only Rust-representable targetPublished cross-fields",
		);
		const earlyTargetPublished = mutateVersionedWriteSource(
			versionedWriteAppSources,
			"app/platform/tauri/workspace-codec.ts",
			(source) =>
				source.replace(
					'  if (snapshot.status === "targetPublished") {',
					`  if (snapshot.status === "targetPublished" && snapshot.target === "changed") {
    return snapshot;
  }
  if (snapshot.status === "targetPublished") {`,
				),
		);
		expect(
			validateWorkspaceVersionedWriteBoundary(
				versionedWriteRustSources,
				earlyTargetPublished,
			),
		).toContain(
			"WorkspaceWriteResult decoder must accept only Rust-representable targetPublished cross-fields",
		);
	});
});
