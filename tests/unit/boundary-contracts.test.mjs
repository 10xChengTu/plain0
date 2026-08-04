import { readFileSync } from "node:fs";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
	validateCapabilityFiles,
	validateDialogOverrideImportBoundary,
	validateDialogServiceOverride,
	validateDialogSurfaceBoundary,
	validateEntitlementsBoundary,
	validateNotificationOverrideImportBoundary,
	validateFrontendEntrypointScripts,
	validateMainCapability,
	validateSearchOverrideImportBoundary,
	validateTauriApiBoundary,
	validateTauriConfiguration,
	validateTauriConfigurationFiles,
	validateTauriE2EConfiguration,
	validateWorkspaceBrowserFixtureWindowAuthority,
	validateWorkspaceCapabilitiesBoundary,
	validateWorkspaceCopyCommandRegistration,
	validateWorkspaceDeleteBoundary,
	validateWorkspaceDeleteCommandRegistration,
	validateWorkspaceTrashBoundary,
	validateWorkspaceTrashCommandRegistration,
	validateWorkspaceTrashTypeScriptBoundary,
	validateWorkspaceDeleteFailureBrowserFixture,
	validateWorkspaceDeleteTypeScriptBoundary,
	validateWorkspaceMoveBoundary,
	validateWorkspaceMoveCommandRegistration,
	validateWorkspaceMoveFailureBrowserFixture,
	validateProductConfigurationBoundary,
	validateWorkspaceProviderBootstrap,
	validateWorkspaceProviderCopyBoundary,
	validateWorkspaceRustBoundary as validateWorkspaceRustBoundaryContract,
	validateWorkspaceSavePickerAuthority,
	validateWorkspaceVersionedWriteBoundary,
	validateWorkspaceWatcherBoundary,
	validateWorkingCopyOverrideImportBoundary,
	validateTerminalIpcBridgeBoundary,
	validateTerminalRustBoundary,
	validateTrustTerminalCommandRegistration,
	validateGitBlameHardeningArgs,
	validateGitCommandRegistration,
	validateGitDiscardConfirmationBoundary,
	validateGitIpcBridgeBoundary,
	validateGitLogGraphFormatStringBoundary,
	validateGitHistoryActionsUiBoundary,
	validateGitHunkStageUiBoundary,
	validateGitManagementUiBoundary,
	validateGitNetworkConfirmationBoundary,
	validateGitRefsFieldSafetyBoundary,
	validateGitRustBoundary,
	validateGitShowCommitFirstParentBoundary,
	validateGitStashConfirmationBoundary,
	validateGitStashMessageFieldSafetyBoundary,
	validateGitWorktreeConfirmationBoundary,
	validateLifecycleCommandRegistration,
	validateMultiDiffEditorOverrideImportBoundary,
	validateViewPaneDependencyDecoratorBoundary,
	validateWindowWorkflowBoundary,
	validateDebugAdapterConfirmationBoundary,
	validateDebugAdapterConnectBoundary,
	validateDebugAdapterSpawnBoundary,
	validateDebugTcpCompanionSpawnBoundary,
	validateDebugCommandRegistration,
	validateDebugRunInTerminalBoundary,
	validateDebugRootIpcBoundary,
	validateDebugSpawnConstructionShape,
	validateDebugFramingBounds,
	validateRootBackendOwnershipBoundary,
} from "../../scripts/plain/boundary-contracts.mjs";

const baselineWindow = {
	label: "main",
	title: "Plain",
	width: 1280,
	height: 800,
	minWidth: 800,
	minHeight: 600,
	center: true,
	resizable: true,
	fullscreen: false,
};

const baselineBundle = {
	active: true,
	targets: ["app", "dmg"],
	category: "DeveloperTool",
	copyright: "Copyright (c) 2026 Plain Contributors",
	icon: [
		"icons/32x32.png",
		"icons/128x128.png",
		"icons/128x128@2x.png",
		"icons/icon.icns",
		"icons/icon.ico",
	],
	macOS: {
		minimumSystemVersion: "10.15",
		entitlements: "Entitlements.plist",
	},
};

const baselineConfig = {
	$schema: "https://schema.tauri.app/config/2",
	identifier: "com.plain.editor",
	build: {
		beforeDevCommand: "pnpm dev",
		devUrl: "http://127.0.0.1:1420",
		beforeBuildCommand: "pnpm build",
		frontendDist: "../dist",
	},
	bundle: baselineBundle,
	app: {
		withGlobalTauri: false,
		windows: [baselineWindow],
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

const baselineFrontendEntrypointScripts = {
	dev: "vite",
	build: "pnpm typecheck && pnpm build:frontend",
	"build:frontend": "vite build",
	typecheck:
		"tsc --project tsconfig.json --noEmit && tsc --project tsconfig.tools.json --noEmit",
	preview: "vite preview",
	tauri: "tauri",
	"tauri:dev": "tauri dev",
	"tauri:dev:e2e": "tauri dev --config src-tauri/tauri.e2e.conf.json",
	"tauri:build": "tauri build",
	"tauri:build:e2e":
		"tauri build --debug --bundles app --config src-tauri/tauri.e2e.conf.json",
};

const baselineTauriE2EConfig = {
	$schema: baselineConfig.$schema,
	app: {
		windows: [{ ...baselineWindow, incognito: true }],
	},
};
const baselineTauriE2ELaunchScript =
	"tauri dev --config src-tauri/tauri.e2e.conf.json";
const baselineTauriE2EBuildScript =
	"tauri build --debug --bundles app --config src-tauri/tauri.e2e.conf.json";

const baselineCapability = {
	$schema: "../gen/schemas/desktop-schema.json",
	identifier: "main-capability",
	description: "Minimum capability for Plain-owned windows",
	windows: ["main", "plain-window-*"],
	permissions: ["core:event:allow-listen", "core:event:allow-unlisten"],
};

const baselineServiceOverrides = `
import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getMultiDiffEditorServiceOverride from "@codingame/monaco-vscode-multi-diff-editor-service-override";
import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";
import { EmptyLanguageStatusService } from "./services/empty-language-status";

export function createServiceOverrides() {
  return {
    ...getConfigurationServiceOverride(),
    ...getFilesServiceOverride(),
    ...getModelServiceOverride(),
    ...getWorkbenchServiceOverride(),
    ...getNotificationServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getThemeServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getMultiDiffEditorServiceOverride(),
    [IDialogService.toString()]: new SyncDescriptor(
      DialogService,
      undefined,
      true,
    ),
    [ILanguageStatusService.toString()]: new SyncDescriptor(
      EmptyLanguageStatusService,
      [],
      true,
    ),
  };
}
`;

// Mirrors the real app/services.ts shape: the two Plain workspace
// SyncDescriptors, the two hand-selected working-copy SyncDescriptors, the
// Rust-backed backup SyncDescriptor, native lifecycle SyncDescriptor, and
// the Plain search SyncDescriptor must all be present together as the exact
// closed middle-descriptor set.
const workingCopyServiceOverridesFixture = `
import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getMultiDiffEditorServiceOverride from "@codingame/monaco-vscode-multi-diff-editor-service-override";
import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { SCMService } from "@codingame/monaco-vscode-scm-service-override/vscode/vs/workbench/contrib/scm/common/scmService";
import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";
import { WorkingCopyService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IExtensionResourceLoaderService } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { IWorkspacesService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service";
import { ISCMService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm.service";
import { IExtensionService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service";
import { ILifecycleService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/lifecycle/common/lifecycle.service";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";
import { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";
import { IWorkingCopyEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service";
import { IWorkingCopyService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyService.service";
import { IWorkspaceEditingService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service";
import { PlainSearchService } from "./features/search/plain-search-service";
import { PlainExtensionResourceLoaderService } from "./features/themes/plain-theme-registry";
import { EmptyLanguageStatusService } from "./services/empty-language-status";
import { PlainNullExtensionService } from "./services/plain-null-extension-service";
import { PlainLifecycleService } from "./services/plain-lifecycle-service";
import { PlainWorkingCopyBackupService } from "./services/plain-workspace-backup-service";
import { PlainWorkspaceEditingService, PlainWorkspacesService } from "./services/plain-workspace-services";

export function createServiceOverrides() {
  return {
    ...getConfigurationServiceOverride(),
    ...getFilesServiceOverride(),
    ...getModelServiceOverride(),
    ...getWorkbenchServiceOverride(),
    ...getNotificationServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getThemeServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getMultiDiffEditorServiceOverride(),
    [IWorkspaceEditingService.toString()]: new SyncDescriptor(
      PlainWorkspaceEditingService,
      [],
      true,
    ),
    [IWorkspacesService.toString()]: new SyncDescriptor(
      PlainWorkspacesService,
      [],
      true,
    ),
    [IWorkingCopyService.toString()]: new SyncDescriptor(
      WorkingCopyService,
      [],
      false,
    ),
    [IWorkingCopyEditorService.toString()]: new SyncDescriptor(
      WorkingCopyEditorService,
      [],
      false,
    ),
    [IWorkingCopyBackupService.toString()]: new SyncDescriptor(
      PlainWorkingCopyBackupService,
      [],
      false,
    ),
    [ILifecycleService.toString()]: new SyncDescriptor(
      PlainLifecycleService,
      [],
      true,
    ),
    [ISearchService.toString()]: new SyncDescriptor(
      PlainSearchService,
      [],
      true,
    ),
    [IExtensionResourceLoaderService.toString()]: new SyncDescriptor(
      PlainExtensionResourceLoaderService,
      [],
      false,
    ),
    [ISCMService.toString()]: new SyncDescriptor(SCMService, [], true),
    [IExtensionService.toString()]: new SyncDescriptor(
      PlainNullExtensionService,
      [],
      true,
    ),
    [IDialogService.toString()]: new SyncDescriptor(
      DialogService,
      undefined,
      true,
    ),
    [ILanguageStatusService.toString()]: new SyncDescriptor(
      EmptyLanguageStatusService,
      [],
      true,
    ),
  };
}
`;

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
  trash: bool,
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
      trash: ::core::cfg!(target_os = "macos"),
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
  readonly trash: boolean;
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
    if (!hasExactKeys(snapshot, ["create", "renameNoReplace", "copyMove", "delete", "trash", "versionedWrite",]) ||
      typeof snapshot.create !== "boolean" ||
      typeof snapshot.renameNoReplace !== "boolean" ||
      typeof snapshot.copyMove !== "boolean" ||
      typeof snapshot.delete !== "boolean" ||
      typeof snapshot.trash !== "boolean" ||
      typeof snapshot.versionedWrite !== "boolean") {
      return violation();
    }
    rejectProxyObject(value as object);
    return Object.freeze({
      create: snapshot.create,
      renameNoReplace: snapshot.renameNoReplace,
      copyMove: snapshot.copyMove,
      delete: snapshot.delete,
      trash: snapshot.trash,
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
  trash: true,
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
		expect(
			validateFrontendEntrypointScripts(baselineFrontendEntrypointScripts),
		).toEqual([]);

		for (const [field, value] of [
			["beforeDevCommand", "node rogue.mjs"],
			["devUrl", "https://example.com"],
			["beforeBuildCommand", "node rogue.mjs"],
			["frontendDist", "../rogue-dist"],
		]) {
			const changedBuild = structuredClone(baselineConfig);
			changedBuild.build[field] = value;
			expect(validateTauriConfiguration(changedBuild)).toContain(
				"Tauri build must preserve the fixed local Vite entrypoint",
			);
		}

		for (const changedScripts of [
			{
				...baselineFrontendEntrypointScripts,
				"build:frontend": "node rogue.mjs",
			},
			{
				...baselineFrontendEntrypointScripts,
				typecheck: "node rogue.mjs",
			},
			{
				...baselineFrontendEntrypointScripts,
				prebuild: "node rogue.mjs",
			},
		]) {
			expect(validateFrontendEntrypointScripts(changedScripts)).toEqual([
				"package scripts must preserve the audited frontend entrypoint chain",
			]);
		}

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

		const ephemeralProductionWindow = structuredClone(baselineConfig);
		ephemeralProductionWindow.app.windows[0].incognito = false;
		expect(validateTauriConfiguration(ephemeralProductionWindow)).toContain(
			"the production main window must use its persistent WebView data store",
		);

		const migratedProductionWindow = structuredClone(baselineConfig);
		migratedProductionWindow.app.windows[0].dataStoreIdentifier =
			Array(16).fill(0);
		expect(validateTauriConfiguration(migratedProductionWindow)).toContain(
			"the production main window must not migrate to a custom WebView data store",
		);
	});

	// `F120` S7 ("需要新增的 AST 契约" item 2): `config.identifier` and
	// `config.bundle` used to be a complete blind spot -- these reverse tests
	// exercise every field the research document's "结论 6" named
	// (identifier/icon/copyright/category/targets/macOS fields) plus the new
	// `macOS.entitlements` path this same feature's S5 slice wired in.
	it("locks the bundle identifier, icon, copyright and packaging shape", () => {
		expect(validateTauriConfiguration(baselineConfig)).toEqual([]);

		const revertedIdentifier = structuredClone(baselineConfig);
		revertedIdentifier.identifier = "com.visualstudio.code.oss";
		expect(validateTauriConfiguration(revertedIdentifier)).toContain(
			'Tauri bundle identifier must remain "com.plain.editor"',
		);

		const missingBundle = structuredClone(baselineConfig);
		delete missingBundle.bundle;
		expect(validateTauriConfiguration(missingBundle)).toContain(
			"Tauri bundle configuration differs from the audited branding/packaging contract",
		);

		for (const [path_, value] of [
			[["active"], false],
			[["targets"], ["app", "dmg", "msi"]],
			[["category"], "Utility"],
			[["copyright"], ""],
			[["copyright"], "Copyright (c) 2015 - present Microsoft Corporation"],
			[["icon"], []],
			[["macOS", "minimumSystemVersion"], "10.13"],
			[["macOS", "entitlements"], undefined],
			[["macOS", "entitlements"], "Other.plist"],
		]) {
			const mutated = structuredClone(baselineConfig);
			let target = mutated.bundle;
			for (let i = 0; i < path_.length - 1; i++) {
				target = target[path_[i]];
			}
			const lastKey = path_[path_.length - 1];
			if (value === undefined) {
				delete target[lastKey];
			} else {
				target[lastKey] = value;
			}
			expect(validateTauriConfiguration(mutated)).toContain(
				"Tauri bundle configuration differs from the audited branding/packaging contract",
			);
		}

		const extraBundleField = structuredClone(baselineConfig);
		extraBundleField.bundle.resources = ["some/path"];
		expect(validateTauriConfiguration(extraBundleField)).toContain(
			"Tauri bundle configuration differs from the audited branding/packaging contract",
		);

		const extraMacOSField = structuredClone(baselineConfig);
		extraMacOSField.bundle.macOS.hardenedRuntime = false;
		expect(validateTauriConfiguration(extraMacOSField)).toContain(
			"Tauri bundle configuration differs from the audited branding/packaging contract",
		);
	});

	// `F120` S5 ("需要新增的 AST 契约" item 3): `validateEntitlementsBoundary`
	// parses `src-tauri/Entitlements.plist`'s real, hand-authored shape (a
	// flat dict of boolean-valued keys) and locks it to the closed, audited
	// set -- these reverse tests cover every failure mode a future silent
	// entitlement change could take.
	const cleanEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
</dict>
</plist>
`;

	it("accepts only the exact audited entitlement set", () => {
		expect(validateEntitlementsBoundary(cleanEntitlements)).toEqual([]);
	});

	it("validates the real, currently-committed src-tauri/Entitlements.plist with zero violations", () => {
		const realEntitlements = readFileSync(
			new URL("../../src-tauri/Entitlements.plist", import.meta.url),
			"utf8",
		);
		expect(validateEntitlementsBoundary(realEntitlements)).toEqual([]);
	});

	it("rejects a missing required entitlement", () => {
		// A dict with some *other* boolean entry (so it parses as a real,
		// non-empty plist dict rather than tripping the separate
		// "could not be parsed at all" failure below) but without the one
		// audited, required key.
		const withoutJit = cleanEntitlements.replace(
			"<key>com.apple.security.cs.allow-jit</key>",
			"<key>com.apple.security.cs.allow-unsigned-executable-memory</key>",
		);
		expect(validateEntitlementsBoundary(withoutJit)).toContain(
			"Entitlements.plist is missing the required entitlement com.apple.security.cs.allow-jit",
		);
	});

	it("rejects the required entitlement set to false", () => {
		const disabledJit = cleanEntitlements.replace("<true/>", "<false/>");
		expect(validateEntitlementsBoundary(disabledJit)).toContain(
			"Entitlements.plist's com.apple.security.cs.allow-jit must be true",
		);
	});

	it("rejects an unaudited additional entitlement, such as a speculatively-added debugger entitlement", () => {
		const withDebugger = cleanEntitlements.replace(
			"</dict>",
			"\t<key>com.apple.security.cs.debugger</key>\n\t<true/>\n</dict>",
		);
		expect(validateEntitlementsBoundary(withDebugger)).toContain(
			"Entitlements.plist declares an unaudited entitlement com.apple.security.cs.debugger -- new entitlements need a threat justification and test before being added (AGENTS.md), not a silent addition",
		);
	});

	it("rejects a duplicated entitlement key", () => {
		const duplicated = cleanEntitlements.replace(
			"</dict>",
			"\t<key>com.apple.security.cs.allow-jit</key>\n\t<true/>\n</dict>",
		);
		expect(validateEntitlementsBoundary(duplicated)).toContain(
			"Entitlements.plist must not declare com.apple.security.cs.allow-jit more than once",
		);
	});

	it("rejects a file that cannot be parsed as a boolean-keyed plist dict", () => {
		expect(validateEntitlementsBoundary("not a plist at all")).toEqual([
			"Entitlements.plist could not be parsed as a boolean-keyed plist dict -- it must declare at least the audited required entitlement set",
		]);
	});

	it("isolates real Tauri acceptance without changing production state", () => {
		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				baselineTauriE2EConfig,
				baselineTauriE2ELaunchScript,
				baselineTauriE2EBuildScript,
			),
		).toEqual([]);

		const persistentE2EWindow = structuredClone(baselineTauriE2EConfig);
		persistentE2EWindow.app.windows[0].incognito = false;
		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				persistentE2EWindow,
				baselineTauriE2ELaunchScript,
				baselineTauriE2EBuildScript,
			),
		).toContain(
			"the Tauri E2E window must equal the production window plus incognito true",
		);

		const incompleteE2EWindow = structuredClone(baselineTauriE2EConfig);
		delete incompleteE2EWindow.app.windows[0].title;
		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				incompleteE2EWindow,
				baselineTauriE2ELaunchScript,
				baselineTauriE2EBuildScript,
			),
		).toContain(
			"the Tauri E2E window must equal the production window plus incognito true",
		);

		const broadE2EOverlay = structuredClone(baselineTauriE2EConfig);
		broadE2EOverlay.app.security = { csp: null };
		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				broadE2EOverlay,
				baselineTauriE2ELaunchScript,
				baselineTauriE2EBuildScript,
			),
		).toContain("the Tauri E2E app overlay must replace only windows");

		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				baselineTauriE2EConfig,
				"tauri dev",
				baselineTauriE2EBuildScript,
			),
		).toContain(
			"tauri:dev:e2e must launch only the audited Tauri E2E configuration",
		);

		expect(
			validateTauriE2EConfiguration(
				baselineConfig,
				baselineTauriE2EConfig,
				baselineTauriE2ELaunchScript,
				"tauri build",
			),
		).toContain(
			"tauri:build:e2e must build only the audited isolated debug app bundle",
		);

		expect(
			validateTauriConfigurationFiles([
				"Cargo.toml",
				"tauri.conf.json",
				"tauri.e2e.conf.json",
			]),
		).toEqual([]);
		expect(
			validateTauriConfigurationFiles([
				"tauri.conf.json",
				"tauri.e2e.conf.json",
				"tauri.macos.conf.json",
			]),
		).toContain(
			"src-tauri must keep only the audited base and E2E Tauri configuration files",
		);
	});

	it("rejects extra capability files, targets and permissions", () => {
		expect(
			validateCapabilityFiles([{ name: "main.json", kind: "file" }]),
		).toEqual([]);
		expect(
			validateCapabilityFiles([
				{ name: "main.json", kind: "file" },
				{ name: "broad.json", kind: "file" },
			]),
		).not.toEqual([]);
		expect(
			validateCapabilityFiles([
				{ name: "main.json", kind: "file" },
				{ name: "nested", kind: "directory" },
			]),
		).not.toEqual([]);
		expect(
			validateCapabilityFiles([{ name: "main.json", kind: "symlink" }]),
		).not.toEqual([]);
		expect(validateMainCapability(baselineCapability)).toEqual([]);

		for (const windows of [
			["main"],
			["main", "*"],
			["main", "plain-window-*", "foreign-*"],
		]) {
			const changedTargets = structuredClone(baselineCapability);
			changedTargets.windows = windows;
			expect(validateMainCapability(changedTargets)).toContain(
				"main capability must target only main and Plain-generated windows",
			);
		}

		const broad = structuredClone(baselineCapability);
		broad.webviews = ["*"];
		broad.permissions.push(
			"core:default",
			"dialog:default",
			"fs:allow-read-file",
			"shell:allow-execute",
		);
		expect(validateMainCapability(broad)).toEqual(
			expect.arrayContaining([
				"main capability contains fields outside the minimum contract",
				"main capability permissions differ from the minimum contract",
			]),
		);
		for (const permission of [
			"dialog:default",
			"dialog:allow-ask",
			"dialog:allow-confirm",
			"dialog:allow-message",
			"dialog:allow-open",
			"dialog:allow-save",
		]) {
			const dialogCapability = structuredClone(baselineCapability);
			dialogCapability.permissions.push(permission);
			expect(validateMainCapability(dialogCapability)).toContain(
				"main capability permissions differ from the minimum contract",
			);
		}
	});
});

describe("Plain F170 window workflow boundary", () => {
	const rustPaths = [
		"src-tauri/src/window/mod.rs",
		"src-tauri/src/window/dto.rs",
		"src-tauri/src/window/commands.rs",
		"src-tauri/src/workspace/dto.rs",
		"src-tauri/src/workspace/commands.rs",
		"src-tauri/src/workspace/service.rs",
		"src-tauri/src/workspace/mod.rs",
		"src-tauri/src/lib.rs",
	];
	const appPaths = [
		"app/platform/tauri/contracts.ts",
		"app/platform/tauri/native.ts",
		"app/platform/tauri/browser-mock.ts",
	];
	const loadSources = (paths) =>
		paths.map((relativePath) => ({
			relativePath,
			source: readFileSync(
				new URL(`../../${relativePath}`, import.meta.url),
				"utf8",
			),
		}));
	const productionRust = loadSources(rustPaths);
	const productionApp = loadSources(appPaths);
	const mutate = (sources, relativePath, transform) =>
		sources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: transform(entry.source) }
				: entry,
		);

	it("accepts the fixed Rust-owned new-window and atomic close-folder routes", () => {
		expect(
			validateWindowWorkflowBoundary(productionRust, productionApp),
		).toEqual([]);
	});

	it("rejects caller-selected window construction, secondary restore, and incomplete root revocation", () => {
		const callerWindow = mutate(
			productionRust,
			"src-tauri/src/window/commands.rs",
			(source) =>
				source.replace(
					"WebviewWindowBuilder::from_config(app, &config)",
					'WebviewWindowBuilder::new(app, "caller", tauri::WebviewUrl::External("https://example.com".parse().unwrap()))',
				),
		);
		expect(validateWindowWorkflowBoundary(callerWindow, productionApp)).toEqual(
			expect.arrayContaining([
				"window_create must clone the merged main template with one Rust-generated label",
				"window_create must not accept or construct another URL",
			]),
		);

		const allWindowsRestore = mutate(
			productionRust,
			"src-tauri/src/window/mod.rs",
			(source) => source.replace("window_label == MAIN_WINDOW_LABEL", "true"),
		);
		expect(
			validateWindowWorkflowBoundary(allWindowsRestore, productionApp),
		).toContain("only the static main window may restore recent roots");

		const retainedWatchers = mutate(
			productionRust,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"let revoked = std::mem::take(&mut state.watch_registrations);",
					"let revoked = std::collections::BTreeMap::new();",
				),
		);
		expect(
			validateWindowWorkflowBoundary(retainedWatchers, productionApp),
		).toContain(
			"Close Folder must atomically revoke roots, watchers, deletes, and searches",
		);
	});

	it("rejects widened DTOs, missing registrations, and injected bridge options", () => {
		const widenedDto = mutate(
			productionRust,
			"src-tauri/src/window/dto.rs",
			(source) =>
				source.replace(
					"pub(crate) struct WindowCreateRequest {}",
					"pub(crate) struct WindowCreateRequest { url: String }",
				),
		);
		expect(validateWindowWorkflowBoundary(widenedDto, productionApp)).toContain(
			"WindowCreateRequest must remain an empty deny-unknown-fields DTO",
		);

		const missingRegistration = mutate(
			productionRust,
			"src-tauri/src/lib.rs",
			(source) => source.replace("window::commands::window_create,", ""),
		);
		expect(
			validateWindowWorkflowBoundary(missingRegistration, productionApp),
		).toContain(
			"both window workflow commands must be registered exactly once",
		);

		const injectedRequest = mutate(
			productionApp,
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					'await invoke<unknown>("window_create", {\n\t\t\t\t\trequest: Object.freeze({}),',
					'await invoke<unknown>("window_create", {\n\t\t\t\t\trequest: Object.freeze({ url: "https://example.com" }),',
				),
		);
		expect(
			validateWindowWorkflowBoundary(productionRust, injectedRequest),
		).toContain("native bridge must dispatch only the two empty window DTOs");

		const browserExternal = mutate(
			productionApp,
			"app/platform/tauri/browser-mock.ts",
			(source) =>
				source.replace(
					'window.open(window.location.href, "_blank", "noopener,noreferrer");',
					'window.open("https://example.com", "_blank", "noopener,noreferrer");',
				),
		);
		expect(
			validateWindowWorkflowBoundary(productionRust, browserExternal),
		).toContain(
			"browser mock must preserve the fixed new/close window semantics",
		);
	});
});

describe("Plain Workbench service override Harness", () => {
	it("locks notifications to one static root import and one ordered zero-argument spread", () => {
		expect(validateDialogServiceOverride(baselineServiceOverrides)).toEqual([]);
		expect(
			validateNotificationOverrideImportBoundary(
				baselineServiceOverrides,
				"app/services.ts",
			),
		).toEqual([]);

		const importFailure =
			"app/services.ts must import the exact notifications override as getNotificationServiceOverride";
		const spreadFailure =
			"createServiceOverrides must keep the exact direct service spread order";
		const bindingFailure =
			"getNotificationServiceOverride may appear only in its exact import and audited service spread";
		const notificationImport =
			'import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";\n';
		const notificationSpread = "    ...getNotificationServiceOverride(),\n";

		const withoutImport = baselineServiceOverrides.replace(
			notificationImport,
			"",
		);
		expect(validateDialogServiceOverride(withoutImport)).toEqual(
			expect.arrayContaining([importFailure, bindingFailure]),
		);

		const withoutSpread = baselineServiceOverrides.replace(
			notificationSpread,
			"",
		);
		expect(validateDialogServiceOverride(withoutSpread)).toEqual(
			expect.arrayContaining([spreadFailure, bindingFailure]),
		);

		const duplicateImport = baselineServiceOverrides.replace(
			notificationImport,
			`${notificationImport}import duplicateNotificationOverride from "@codingame/monaco-vscode-notifications-service-override";\n`,
		);
		expect(validateDialogServiceOverride(duplicateImport)).toContain(
			importFailure,
		);

		const aliasedImport = baselineServiceOverrides.replace(
			notificationImport,
			'import unsafeNotificationOverride from "@codingame/monaco-vscode-notifications-service-override";\n',
		);
		expect(validateDialogServiceOverride(aliasedImport)).toEqual(
			expect.arrayContaining([importFailure, bindingFailure]),
		);

		const namespaceImport = baselineServiceOverrides
			.replace(
				notificationImport,
				'import * as notificationOverrides from "@codingame/monaco-vscode-notifications-service-override";\n',
			)
			.replace(notificationSpread, "    ...notificationOverrides.default(),\n");
		expect(validateDialogServiceOverride(namespaceImport)).toEqual(
			expect.arrayContaining([importFailure, spreadFailure, bindingFailure]),
		);

		const dynamicImport = baselineServiceOverrides.replace(
			notificationImport,
			'const getNotificationServiceOverride = (await import("@codingame/monaco-vscode-notifications-service-override")).default;\n',
		);
		expect(validateDialogServiceOverride(dynamicImport)).toContain(
			importFailure,
		);

		const hiddenDynamicImport = baselineServiceOverrides.replace(
			"export function createServiceOverrides()",
			'void import("@codingame/monaco-vscode-notifications-" + "service-override");\n\nexport function createServiceOverrides()',
		);
		expect(validateDialogServiceOverride(hiddenDynamicImport)).toContain(
			importFailure,
		);

		const wrongModule = baselineServiceOverrides.replace(
			notificationImport,
			'import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override/internal";\n',
		);
		expect(validateDialogServiceOverride(wrongModule)).toContain(importFailure);

		const duplicateSpread = baselineServiceOverrides.replace(
			notificationSpread,
			`${notificationSpread}${notificationSpread}`,
		);
		expect(validateDialogServiceOverride(duplicateSpread)).toContain(
			spreadFailure,
		);

		const wrongOrder = baselineServiceOverrides
			.replace(notificationSpread, "")
			.replace(
				"    ...getExplorerServiceOverride(),\n",
				`    ...getExplorerServiceOverride(),\n${notificationSpread}`,
			);
		expect(validateDialogServiceOverride(wrongOrder)).toContain(spreadFailure);

		const withArguments = baselineServiceOverrides.replace(
			"...getNotificationServiceOverride()",
			"...getNotificationServiceOverride({ unsafe: true })",
		);
		expect(validateDialogServiceOverride(withArguments)).toContain(
			spreadFailure,
		);
	});

	it("locks IWorkingCopyService/IWorkingCopyEditorService to their exact class subpaths, never the aggregating package entry point", () => {
		expect(
			validateDialogServiceOverride(workingCopyServiceOverridesFixture),
		).toEqual([]);
		expect(
			validateWorkingCopyOverrideImportBoundary(
				workingCopyServiceOverridesFixture,
				"app/services.ts",
			),
		).toEqual([]);

		const importFailure =
			"app/services.ts must import only the exact WorkingCopyService and WorkingCopyEditorService class subpaths";
		const referenceFailure =
			"WorkingCopyService and WorkingCopyEditorService may appear only in their exact imports and audited descriptors";
		const middleDescriptorFailure =
			"createServiceOverrides must keep the exact hand-selected working-copy and workspace service descriptors";
		const orderFailure =
			"createServiceOverrides must keep IDialogService as the final Workbench override before language status";
		const aggregatingEntryPointFailure =
			"app/services.ts must not import the working-copy-service-override aggregating entry point";

		// Swapping the exact submodule import for the package's aggregating
		// default export must be rejected: that entry point unconditionally
		// registers BrowserWorkingCopyBackupTracker and
		// WorkingCopyHistoryTracker as real contributions, and the latter
		// breaks every save with an unhandled cloneFile rejection.
		const aggregatingImport = workingCopyServiceOverridesFixture
			.replace(
				'import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";\nimport { WorkingCopyService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService";\n',
				'import getWorkingCopyServiceOverride from "@codingame/monaco-vscode-working-copy-service-override";\n',
			)
			.replace(
				"    [IWorkingCopyService.toString()]: new SyncDescriptor(\n      WorkingCopyService,\n      [],\n      false,\n    ),\n    [IWorkingCopyEditorService.toString()]: new SyncDescriptor(\n      WorkingCopyEditorService,\n      [],\n      false,\n    ),\n",
				"    ...getWorkingCopyServiceOverride({ storage: null }),\n",
			);
		expect(
			validateWorkingCopyOverrideImportBoundary(
				aggregatingImport,
				"app/services.ts",
			),
		).toContain(aggregatingEntryPointFailure);

		const outsideServices = validateWorkingCopyOverrideImportBoundary(
			workingCopyServiceOverridesFixture,
			"app/features/unsafe-working-copy.ts",
		);
		expect(outsideServices).toContain(
			"app/features/unsafe-working-copy.ts imports the working-copy override outside its audited files",
		);

		const wrongModule = workingCopyServiceOverridesFixture.replace(
			"@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService",
			"@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyServiceOther",
		);
		expect(validateDialogServiceOverride(wrongModule)).toContain(importFailure);

		const aliasedClass = workingCopyServiceOverridesFixture.replace(
			"import { WorkingCopyService } from",
			"import { WorkingCopyService as UnsafeWorkingCopyService } from",
		);
		expect(validateDialogServiceOverride(aliasedClass)).toContain(
			importFailure,
		);

		const thirdArgumentFlipped = workingCopyServiceOverridesFixture.replace(
			"      WorkingCopyService,\n      [],\n      false,\n",
			"      WorkingCopyService,\n      [],\n      true,\n",
		);
		expect(validateDialogServiceOverride(thirdArgumentFlipped)).toContain(
			middleDescriptorFailure,
		);

		const missingWorkingCopyEditor = workingCopyServiceOverridesFixture
			.replace(
				'import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";\n',
				"",
			)
			.replace(
				'import { IWorkingCopyEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service";\n',
				"",
			)
			.replace(
				"    [IWorkingCopyEditorService.toString()]: new SyncDescriptor(\n      WorkingCopyEditorService,\n      [],\n      false,\n    ),\n",
				"",
			);
		expect(validateDialogServiceOverride(missingWorkingCopyEditor)).toEqual(
			expect.arrayContaining([
				importFailure,
				referenceFailure,
				middleDescriptorFailure,
			]),
		);

		const reordered = workingCopyServiceOverridesFixture
			.replace(
				"    [IWorkingCopyService.toString()]: new SyncDescriptor(\n      WorkingCopyService,\n      [],\n      false,\n    ),\n    [IWorkingCopyEditorService.toString()]: new SyncDescriptor(\n      WorkingCopyEditorService,\n      [],\n      false,\n    ),\n",
				"",
			)
			.replace(
				"    [IDialogService.toString()]:",
				"    [IWorkingCopyEditorService.toString()]: new SyncDescriptor(\n      WorkingCopyEditorService,\n      [],\n      false,\n    ),\n    [IWorkingCopyService.toString()]: new SyncDescriptor(\n      WorkingCopyService,\n      [],\n      false,\n    ),\n    [IDialogService.toString()]:",
			);
		expect(validateDialogServiceOverride(reordered)).toEqual(
			expect.arrayContaining([middleDescriptorFailure, orderFailure]),
		);
	});

	it("locks the search override to its two audited files and hard-rejects the aggregating entry point and search.contribution", () => {
		const plainSearchServiceSource =
			'import { SearchService } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";\nexport class PlainSearchService extends SearchService {}\n';
		const searchContributionSource =
			'import "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/search/browser/searchQuickAccess.contribution";\n';

		// Both audited files, using only their exact narrow subpaths, pass.
		expect(
			validateSearchOverrideImportBoundary(
				plainSearchServiceSource,
				"app/features/search/plain-search-service.ts",
			),
		).toEqual([]);
		expect(
			validateSearchOverrideImportBoundary(
				searchContributionSource,
				"app/features/search/search-contribution.ts",
			),
		).toEqual([]);

		const outsideAuditFailure =
			"app/features/unsafe-search.ts imports the search override outside its audited files";
		for (const source of [
			plainSearchServiceSource,
			searchContributionSource,
			'import getServiceOverride from "@codingame/monaco-vscode-search-service-override";',
			'void import("@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService");',
		]) {
			expect(
				validateSearchOverrideImportBoundary(
					source,
					"app/features/unsafe-search.ts",
				),
			).toContain(outsideAuditFailure);
		}

		// The aggregating default export must never be imported, in any file,
		// static or dynamic, even one already on the audited allowlist: its
		// CustomSearchService constructor throws a TypeError against Plain's
		// file:-less FileService, and its two fallbacks are front-end file
		// searchers hard-coded to the file: scheme.
		const auditedPath = "app/features/search/plain-search-service.ts";
		const aggregatingEntryPointFailure = `${auditedPath} must not import the search-service-override aggregating entry point`;
		for (const source of [
			'import getServiceOverride from "@codingame/monaco-vscode-search-service-override";',
			'import * as searchOverride from "@codingame/monaco-vscode-search-service-override";',
			'void import("@codingame/monaco-vscode-search-service-override");',
			'void import("@codingame/monaco-vscode-search-service-" + "override");',
		]) {
			expect(
				validateSearchOverrideImportBoundary(source, auditedPath),
			).toContain(aggregatingEntryPointFailure);
		}

		// search.contribution.js (and searchEditor.contribution.js, which it
		// unconditionally imports) is rejected even inside the two audited
		// files: it eagerly registers SearchChatContextContribution as a real
		// WorkbenchPhase.AfterRestored contribution wiring Search results into
		// IChatContextPickService, a Chat/AI context-attachment surface the
		// runtime excluded-surface guard cannot see (it only audits
		// commandIds/viewContainerIds/viewIds, not
		// registerWorkbenchContribution2 ids).
		for (const [relativePath, moduleSpecifier] of [
			[
				"app/features/search/search-contribution.ts",
				"@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/search/browser/search.contribution",
			],
			[
				"app/features/search/search-contribution.ts",
				"@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/searchEditor/browser/searchEditor.contribution",
			],
			[
				"app/features/search/plain-search-service.ts",
				"@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/contrib/search/browser/search.contribution",
			],
		]) {
			expect(
				validateSearchOverrideImportBoundary(
					`import "${moduleSpecifier}";\n`,
					relativePath,
				),
			).toContain(
				`${relativePath} must not import the search.contribution/searchEditor.contribution modules`,
			);
		}

		// plain-search-service.ts must import only the exact, unaliased
		// SearchService named export from its exact class subpath — never a
		// default/namespace import, a renamed binding, or the wrong subpath.
		const exactImportFailure =
			"app/features/search/plain-search-service.ts must import only the exact SearchService class subpath";
		for (const mutatedSource of [
			'import SearchService from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";\n',
			'import * as searchServiceModule from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";\n',
			'import { SearchService as UnsafeSearchService } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";\n',
			'import { SearchService } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchServiceOther";\n',
			'import type { SearchService } from "@codingame/monaco-vscode-search-service-override/vscode/vs/workbench/services/search/common/searchService";\n',
		]) {
			expect(
				validateSearchOverrideImportBoundary(
					mutatedSource,
					"app/features/search/plain-search-service.ts",
				),
			).toContain(exactImportFailure);
		}
		expect(
			validateSearchOverrideImportBoundary(
				plainSearchServiceSource,
				"app/features/search/plain-search-service.ts",
			),
		).not.toContain(exactImportFailure);
	});

	it("rejects notification override references outside app/services.ts", () => {
		for (const source of [
			'import notifications from "@codingame/monaco-vscode-notifications-service-override";',
			'import * as notifications from "@codingame/monaco-vscode-notifications-service-override";',
			'void import("@codingame/monaco-vscode-notifications-service-override");',
			'void import("@codingame/monaco-vscode-notifications-" + "service-override");',
			'export * from "@codingame/monaco-vscode-notifications-service-override/internal";',
			'const moduleName = "@codingame/monaco-vscode-notifications-service-override";',
		]) {
			expect(
				validateNotificationOverrideImportBoundary(
					source,
					"app/features/unsafe-notification.ts",
				),
			).toEqual([
				"app/features/unsafe-notification.ts imports the notifications override outside app/services.ts",
			]);
		}
	});

	it("rejects global confirm and file-dialog tokens across every app source", () => {
		for (const source of [
			'window.confirm("unsafe")',
			'globalThis["confirm"]("unsafe")',
			'self.confirm("unsafe")',
			'mainWindow.confirm.call(null, "unsafe")',
			'confirm("unsafe")',
			"const { confirm: unsafeConfirm } = window; unsafeConfirm();",
		]) {
			expect(
				validateDialogSurfaceBoundary(source, "app/features/unsafe-dialog.ts"),
			).toContain(
				"app/features/unsafe-dialog.ts uses a forbidden global confirm path",
			);
		}
		expect(
			validateDialogSurfaceBoundary(
				'import { IFileDialogService as FileDialogs } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";',
				"app/features/unsafe-file-dialog.ts",
			),
		).toContain(
			"app/features/unsafe-file-dialog.ts references IFileDialogService outside Plain's Rust picker boundary",
		);
		expect(
			validateDialogSurfaceBoundary(
				"await context.dialogService.confirm(confirmation);",
				"app/features/workspace/delete-coordinator.ts",
			),
		).toEqual([]);
	});

	it("locks the official same-version DOM implementation into the exact service order", () => {
		expect(validateDialogServiceOverride(baselineServiceOverrides)).toEqual([]);
		expect(
			validateDialogOverrideImportBoundary(
				baselineServiceOverrides,
				"app/services.ts",
			),
		).toEqual([]);
		for (const source of [
			'import dialogs from "@codingame/monaco-vscode-dialogs-service-override";',
			'void import("@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService");',
			'export * from "@codingame/monaco-vscode-dialogs-service-override";',
			'const unsafeModule = "@codingame/monaco-vscode-dialogs-service-override";',
		]) {
			expect(
				validateDialogOverrideImportBoundary(
					source,
					"app/features/unsafe-dialog.ts",
				),
			).toEqual([
				"app/features/unsafe-dialog.ts imports the dialogs override outside app/services.ts",
			]);
		}

		const withoutImport = baselineServiceOverrides.replace(
			'import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";\n',
			"",
		);
		expect(validateDialogServiceOverride(withoutImport)).toContain(
			"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
		);
		const withoutContribution = baselineServiceOverrides.replace(
			'import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";\n',
			"",
		);
		expect(validateDialogServiceOverride(withoutContribution)).toContain(
			"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
		);
		const hiddenRootReference = baselineServiceOverrides.replace(
			"export function createServiceOverrides()",
			'const unsafeModule = "@codingame/monaco-vscode-dialogs-service-override";\n\nexport function createServiceOverrides()',
		);
		expect(validateDialogServiceOverride(hiddenRootReference)).toContain(
			"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
		);

		const aliasedImport = baselineServiceOverrides.replace(
			"import { DialogService } from",
			"import { DialogService as UnsafeDialogService } from",
		);
		expect(validateDialogServiceOverride(aliasedImport)).toEqual(
			expect.arrayContaining([
				"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
			]),
		);

		const fullFactorySpread = baselineServiceOverrides
			.replace(
				"import getConfigurationServiceOverride from",
				'import getDialogsServiceOverride from "@codingame/monaco-vscode-dialogs-service-override";\nimport getConfigurationServiceOverride from',
			)
			.replace(
				"    ...getExplorerServiceOverride(),",
				"    ...getDialogsServiceOverride(),\n    ...getExplorerServiceOverride(),",
			);
		expect(validateDialogServiceOverride(fullFactorySpread)).toEqual(
			expect.arrayContaining([
				"app/services.ts must import only the exact official DialogService and DOM contribution subpaths",
				"createServiceOverrides must keep the exact direct service spread order",
			]),
		);

		const dialogSelection = `    [IDialogService.toString()]: new SyncDescriptor(
      DialogService,
      undefined,
      true,
    ),
`;
		expect(baselineServiceOverrides).toContain(dialogSelection);
		const movedSelection = baselineServiceOverrides
			.replace(dialogSelection, "")
			.replace(
				"    ...getWorkbenchServiceOverride(),\n",
				`    ...getWorkbenchServiceOverride(),\n${dialogSelection}`,
			);
		expect(validateDialogServiceOverride(movedSelection)).toContain(
			"createServiceOverrides must keep IDialogService as the final Workbench override before language status",
		);
	});

	it("locks the multi-diff-editor override import to app/services.ts only (F090 S2)", () => {
		expect(validateDialogServiceOverride(baselineServiceOverrides)).toEqual([]);
		expect(
			validateMultiDiffEditorOverrideImportBoundary(
				baselineServiceOverrides,
				"app/services.ts",
			),
		).toEqual([]);
		for (const source of [
			'import multiDiff from "@codingame/monaco-vscode-multi-diff-editor-service-override";',
			'void import("@codingame/monaco-vscode-multi-diff-editor-service-override/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffEditor.contribution");',
			'export * from "@codingame/monaco-vscode-multi-diff-editor-service-override";',
			'const unsafeModule = "@codingame/monaco-vscode-multi-diff-editor-service-override";',
		]) {
			expect(
				validateMultiDiffEditorOverrideImportBoundary(
					source,
					"app/features/scm/unsafe-multi-diff.ts",
				),
			).toEqual([
				"app/features/scm/unsafe-multi-diff.ts imports the multi-diff-editor override outside app/services.ts",
			]);
		}
		// The resolver/content-provider file only imports base-package types
		// (never the override package itself) — confirms this boundary does
		// not misfire against the file that is its main reason for existing.
		expect(
			validateMultiDiffEditorOverrideImportBoundary(
				'import { MultiDiffEditorItem } from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/multiDiffEditor/browser/multiDiffSourceResolverService";',
				"app/features/scm/plain-git-commit-detail.ts",
			),
		).toEqual([]);
	});

	it("rejects indirect construction, file services and global confirm fallbacks", () => {
		const indirect = baselineServiceOverrides.replace(
			"new SyncDescriptor(\n      DialogService,\n      undefined,\n      true,\n    )",
			"Reflect.construct(SyncDescriptor, [DialogService, undefined, true])",
		);
		expect(validateDialogServiceOverride(indirect)).toContain(
			"createServiceOverrides must end with the audited delayed IDialogService and empty language-status descriptors",
		);

		const fileDialogOverride = baselineServiceOverrides.replace(
			"    [IDialogService.toString()]:",
			"    [IFileDialogService.toString()]: unsafeFileDialogs,\n    [IDialogService.toString()]:",
		);
		expect(validateDialogServiceOverride(fileDialogOverride)).toEqual(
			expect.arrayContaining([
				"createServiceOverrides must end with the audited delayed IDialogService and empty language-status descriptors",
				"app/services.ts must not enable IFileDialogService or fall back to global confirm",
			]),
		);

		const globalConfirm = baselineServiceOverrides.replace(
			"new SyncDescriptor(\n      DialogService,\n      undefined,\n      true,\n    )",
			'window.confirm("unsafe")',
		);
		expect(validateDialogServiceOverride(globalConfirm)).toContain(
			"app/services.ts must not enable IFileDialogService or fall back to global confirm",
		);

		const extraFactoryStatement = baselineServiceOverrides.replace(
			"export function createServiceOverrides() {\n",
			"export function createServiceOverrides() {\n  void 0;\n",
		);
		expect(validateDialogServiceOverride(extraFactoryStatement)).toContain(
			"createServiceOverrides must directly return one audited object literal",
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
			"workspace capability Rust DTO must be an empty deny-unknown request and the exact six-boolean response",
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
			"workspace capabilities must keep create cross-platform, derive handle-relative mutations from the Linux/macOS gate, and expose system Trash only on macOS",
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
        trash: ::core::cfg!(target_os = "macos"),
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
			"workspace capabilities must keep create cross-platform, derive handle-relative mutations from the Linux/macOS gate, and expose system Trash only on macOS",
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
			"workspace capabilities must keep create cross-platform, derive handle-relative mutations from the Linux/macOS gate, and expose system Trash only on macOS",
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

describe("workspace Save As picker authority", () => {
	const relativePath = "src-tauri/src/workspace/picker.rs";
	const production = readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	);
	const validate = (source) =>
		validateWorkspaceSavePickerAuthority([{ relativePath, source }]);

	it("requires the macOS file-name picker to be followed by explicit folder authority", () => {
		expect(validate(production)).toEqual([]);
		for (const [from, to] of [
			[
				'"Authorize Plain to Save in This Folder"',
				'"Save Plain Untitled File"',
			],
			[".blocking_pick_folder();", ".blocking_save_file();"],
			["selected_parent.join(file_name)", "requested_path.to_path_buf()"],
			[
				"let parent = path",
				"let _ambient = std::fs::canonicalize(&path);\n    let parent = path",
			],
		]) {
			const mutated = production.replace(from, to);
			expect(mutated).not.toBe(production);
			expect(validate(mutated)).not.toEqual([]);
		}
	});
});

const workspaceWatcherRustPaths = [
	"src-tauri/src/workspace/watcher.rs",
	"src-tauri/src/workspace/mod.rs",
	"src-tauri/src/workspace/dto.rs",
	"src-tauri/src/workspace/commands.rs",
	"src-tauri/src/workspace/service.rs",
	"src-tauri/src/lib.rs",
];
const workspaceWatcherAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/workspace-codec.ts",
	"app/platform/tauri/workspace-watcher.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/workspace/file-system-provider.ts",
];

function workspaceWatcherBoundarySources() {
	const readSources = (paths) =>
		paths.map((relativePath) => ({
			relativePath,
			source: readFileSync(
				new URL(`../../${relativePath}`, import.meta.url),
				"utf8",
			),
		}));
	return {
		rust: readSources(workspaceWatcherRustPaths),
		app: readSources(workspaceWatcherAppPaths),
	};
}

function replaceWatcherSource(sources, relativePath, from, to) {
	let replaced = false;
	const result = sources.map((entry) => {
		if (entry.relativePath !== relativePath) {
			return entry;
		}
		if (!entry.source.includes(from)) {
			throw new Error(
				`${relativePath} is missing watcher fixture anchor ${from}`,
			);
		}
		replaced = true;
		return { ...entry, source: entry.source.replace(from, to) };
	});
	if (!replaced) {
		throw new Error(`watcher fixture is missing ${relativePath}`);
	}
	return result;
}

describe("workspace watcher Harness", () => {
	it("accepts the current bounded watcher vertical slice", () => {
		const baseline = workspaceWatcherBoundarySources();
		expect(
			validateWorkspaceWatcherBoundary(baseline.rust, baseline.app),
		).toEqual([]);
	});

	it("keeps notify callback state path-free, conservative and bounded", () => {
		const baseline = workspaceWatcherBoundarySources();
		const watcherPath = "src-tauri/src/workspace/watcher.rs";
		const cases = [
			[
				".with_follow_symlinks(false)",
				".with_follow_symlinks(true)",
				"workspace watcher must keep one capacity-one queue and notify symlink following disabled",
			],
			[
				"if event.kind.is_access() {",
				"if false {",
				"notify callback must discard paths and raw errors, ignore access events and conservatively request rescans",
			],
			[
				"if event.kind.is_access() {",
				"let leaked_paths = event.paths.clone();\n    drop(leaked_paths);\n    if event.kind.is_access() {",
				"notify callback must discard paths and raw errors, ignore access events and conservatively request rescans",
			],
			[
				"event.need_rescan() || conservative_namespace_rescan",
				"conservative_namespace_rescan",
				"notify callback must discard paths and raw errors, ignore access events and conservatively request rescans",
			],
			[
				"self.rescan_required.store(true, Ordering::Release);",
				"self.rescan_required.store(false, Ordering::Release);",
				"a full watcher wake queue must preserve dirty rescan state",
			],
			[
				"pending.generation == acknowledgement.generation",
				"pending.generation <= acknowledgement.generation",
				"watcher pending generations must stay sticky until one exact bounded acknowledgement",
			],
		];
		for (const [from, to, failure] of cases) {
			const hostile = replaceWatcherSource(
				baseline.rust,
				watcherPath,
				from,
				to,
			);
			expect(validateWorkspaceWatcherBoundary(hostile, baseline.app)).toContain(
				failure,
			);
		}
	});

	it("keeps wake and sync IPC opaque, window-targeted and resume-safe", () => {
		const baseline = workspaceWatcherBoundarySources();
		const responseFailure =
			"watcher IPC responses must expose only opaque ids, generations and rescan state";
		const hostileDto = replaceWatcherSource(
			baseline.rust,
			"src-tauri/src/workspace/dto.rs",
			"pub(crate) struct WorkspaceWatchWakeEvent {\n    workspace_id: WorkspaceId,\n}",
			"pub(crate) struct WorkspaceWatchWakeEvent {\n    workspace_id: WorkspaceId,\n    raw_path: String,\n}",
		);
		expect(
			validateWorkspaceWatcherBoundary(hostileDto, baseline.app),
		).toContain(responseFailure);

		for (const [from, to] of [
			["let _ = app.emit_to(", "let _ = app.emit("],
			[
				"EventTarget::webview_window(window_label.clone()),",
				"EventTarget::Any,",
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.rust,
				"src-tauri/src/workspace/commands.rs",
				from,
				to,
			);
			expect(validateWorkspaceWatcherBoundary(hostile, baseline.app)).toContain(
				"workspace watcher wake must be one window-targeted opaque workspaceId hint",
			);
		}

		const noResume = replaceWatcherSource(
			baseline.rust,
			"src-tauri/src/lib.rs",
			"app.state::<WorkspaceService>().mark_all_watchers_rescan();",
			"let _ = app;",
		);
		expect(validateWorkspaceWatcherBoundary(noResume, baseline.app)).toContain(
			"Tauri resume must conservatively mark every window watcher for rescan",
		);
	});

	it("keeps watcher ids v4 and all blocking sync or scan work off the invoke thread", () => {
		const baseline = workspaceWatcherBoundarySources();
		const weakRootId = replaceWatcherSource(
			baseline.rust,
			"src-tauri/src/workspace/mod.rs",
			"Self::parse_v4_wire(&wire)",
			"Ok(Self(Uuid::nil()))",
		);
		expect(
			validateWorkspaceWatcherBoundary(weakRootId, baseline.app),
		).toContain(
			"workspace watcher root ids must use canonical RFC4122 UUID v4 decoding",
		);

		const syncCommand = replaceWatcherSource(
			baseline.rust,
			"src-tauri/src/workspace/commands.rs",
			"pub(crate) async fn workspace_watch_sync(",
			"pub(crate) fn workspace_watch_sync(",
		);
		expect(
			validateWorkspaceWatcherBoundary(syncCommand, baseline.app),
		).toContain(
			"workspace_watch_sync must asynchronously route the decoded bounded request through the window service",
		);

		for (const [from, to] of [
			[
				"tauri::async_runtime::spawn_blocking(move || workspace.watch_sync(&roots))",
				"workspace.watch_sync(&roots)",
			],
			[
				"Err(_) => return WatchScanOutcome::Failed,",
				"Err(_) => return WatchScanOutcome::Stale,",
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.rust,
				"src-tauri/src/workspace/service.rs",
				from,
				to,
			);
			expect(validateWorkspaceWatcherBoundary(hostile, baseline.app)).toContain(
				"watch sync and capability scans must stay off the invoke thread and preserve lease failures as rescans",
			);
		}
	});

	it("keeps root topology changes connected to exact OS watcher revocation", () => {
		const baseline = workspaceWatcherBoundarySources();
		const failure =
			"root topology changes must revoke only their exact watcher epochs after releasing workspace locks";
		const removeRootTail =
			"let watcher = lock(&self.watcher)?.clone();\n        drop(state);\n        drop(mutation);\n        if let (Some(watcher), Some(registration)) = (watcher, removed_registration) {\n            watcher.revoke(registration);\n        }\n        Ok(snapshot)";
		const finishPickerTail =
			"if let Some(watcher) = watcher {\n            for registration in revoked_registrations {\n                watcher.revoke(registration);\n            }\n        }\n        Ok(result)";
		const replaceRootsTail =
			"let snapshot = state.scope.snapshot();\n        drop(state);\n        drop(mutation);\n        for registration in revoked {\n            watcher.revoke(registration);\n        }\n        Ok(snapshot)";
		const initialSnapshotTail =
			"let snapshot = state.scope.snapshot();\n        drop(state);\n        drop(mutation);\n        if let Some((watcher, revoked)) = activated {\n            for registration in revoked {\n                watcher.revoke(registration);\n            }\n        }\n        Ok(snapshot)";
		for (const [from, to] of [
			[
				removeRootTail,
				removeRootTail.replace(
					"watcher.revoke(registration);",
					"let _ = registration;",
				),
			],
			[removeRootTail, removeRootTail.replace("        drop(mutation);\n", "")],
			[
				removeRootTail,
				removeRootTail.replace(
					"let watcher = lock(&self.watcher)?.clone();",
					"if snapshot.roots().is_empty() { return Ok(snapshot); }\n        let watcher = lock(&self.watcher)?.clone();",
				),
			],
			[
				finishPickerTail,
				finishPickerTail.replace(
					"watcher.revoke(registration);",
					"let _ = registration;",
				),
			],
			[
				replaceRootsTail,
				replaceRootsTail.replace(
					"watcher.revoke(registration);",
					"let _ = registration;",
				),
			],
			[
				replaceRootsTail,
				replaceRootsTail.replace("        drop(mutation);\n", ""),
			],
			[
				initialSnapshotTail,
				initialSnapshotTail.replace(
					"watcher.revoke(registration);",
					"let _ = registration;",
				),
			],
			[
				initialSnapshotTail,
				initialSnapshotTail.replace("        drop(mutation);\n", ""),
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.rust,
				"src-tauri/src/workspace/service.rs",
				from,
				to,
			);
			expect(validateWorkspaceWatcherBoundary(hostile, baseline.app)).toContain(
				failure,
			);
		}
		const testOnlyRevoke = replaceWatcherSource(
			baseline.rust,
			"src-tauri/src/workspace/watcher.rs",
			"    pub(crate) fn revoke(&self, registration: WatchRegistration) -> bool {",
			"    #[cfg(test)]\n    pub(crate) fn revoke(&self, registration: WatchRegistration) -> bool {",
		);
		expect(
			validateWorkspaceWatcherBoundary(testOnlyRevoke, baseline.app),
		).toContain(failure);
	});

	it("fails closed when codec bounds or manager serialization drift", () => {
		const baseline = workspaceWatcherBoundarySources();
		const codecPath = "app/platform/tauri/workspace-codec.ts";
		for (const [from, to, failure] of [
			[
				"const MAX_WORKSPACE_ROOTS = 256;",
				"const MAX_WORKSPACE_ROOTS = 4_096;",
				"watch sync codec must freeze and bound one exact unique root acknowledgement request",
			],
			[
				"if (unique.has(snapshot.rootId)) {",
				"// if (unique.has(snapshot.rootId)) {}\n\t\tif (false) {",
				"watch sync codec must freeze and bound one exact unique root acknowledgement request",
			],
			[
				'hasExactKeys(snapshot, ["workspaceId"])',
				'hasExactKeys(snapshot, ["workspaceId", "rawPath"])',
				"watch wake decoder must accept only one opaque workspaceId",
			],
			[
				"!saturatedReplay) ||",
				"false) ||",
				"watch sync decoder must reject unsolicited, duplicate, stale or oversized pending roots",
			],
		]) {
			const hostile = replaceWatcherSource(baseline.app, codecPath, from, to);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(failure);
		}

		const managerPath = "app/platform/tauri/workspace-watcher.ts";
		for (const [from, to] of [
			[
				"const DEFAULT_POLL_INTERVAL_MS = 2_000;",
				"const DEFAULT_POLL_INTERVAL_MS = 0;",
			],
			[
				"this.#syncInFlight = true;",
				"// this.#syncInFlight = true;\n\t\tthis.#syncInFlight = false;",
			],
			[
				"state.acknowledgedGeneration = pending.generation;",
				"state.acknowledgedGeneration = 0;",
			],
			[
				'return saturatedReplay ? "retry-later" : "acknowledged";',
				'return "acknowledged";',
			],
		]) {
			const hostile = replaceWatcherSource(baseline.app, managerPath, from, to);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(
				"watch manager must serialize wake/timer pulls and acknowledge only after listener delivery",
			);
		}
	});

	it("keeps frontend watcher authority local, fail-closed, and side-effect free until accepted", () => {
		const baseline = workspaceWatcherBoundarySources();
		const managerPath = "app/platform/tauri/workspace-watcher.ts";
		const managerFailure =
			"watch manager must serialize wake/timer pulls and acknowledge only after listener delivery";
		for (const [from, to] of [
			[
				"#authorizedRoots: ReadonlySet<string> = new Set();",
				"#authorizedRoots: ReadonlySet<string> | undefined;",
			],
			["if (!this.#authorizedRoots.has(rootId)) {", "if (false) {"],
			["this.#roots.delete(rootId);", "void rootId;"],
			["subscription.cancel();", "void subscription;"],
			["this.#clearScheduledPull();", "void this.#scheduledPull;"],
			["void this.#detachWakeListener();", "void this.#wakeUnlisten;"],
		]) {
			const hostile = replaceWatcherSource(baseline.app, managerPath, from, to);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(managerFailure);
		}

		const contractFailure =
			"PlainBridge must expose exact local watcher authority and root-only watch contracts";
		const weakContract = replaceWatcherSource(
			baseline.app,
			"app/platform/tauri/contracts.ts",
			"workspaceReconcileWatchRoots(rootIds: readonly string[]): void;",
			"workspaceReconcileWatchRoots(rootIds: string[]): Promise<void>;",
		);
		expect(
			validateWorkspaceWatcherBoundary(baseline.rust, weakContract),
		).toContain(contractFailure);

		const nativeFailure =
			"native bridge must keep topology decoding side-effect free and route local watcher authority through one manager";
		for (const [from, to] of [
			[
				"workspaceReconcileWatchRoots: workspaceWatcher.reconcileRoots,",
				"workspaceReconcileWatchRoots: () => undefined,",
			],
			[
				'workspaceSnapshot: async () =>\n\t\t\tdecodeWorkspaceSnapshot(\n\t\t\t\tawait invoke<unknown>("workspace_snapshot", { request: {} }),\n\t\t\t),',
				'workspaceSnapshot: async () => {\n\t\t\tworkspaceWatcher.reconcileRoots([]);\n\t\t\treturn decodeWorkspaceSnapshot(\n\t\t\t\tawait invoke<unknown>("workspace_snapshot", { request: {} }),\n\t\t\t);\n\t\t},',
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.app,
				"app/platform/tauri/native.ts",
				from,
				to,
			);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(nativeFailure);
		}

		const browserFailure =
			"browser mock must use one side-effect-free local authority route and the same bounded watcher manager";
		for (const [from, to] of [
			[
				"workspaceReconcileWatchRoots: workspaceWatcher.reconcileRoots,",
				"workspaceReconcileWatchRoots: () => undefined,",
			],
			[
				"async workspaceSnapshot() {\n\t\t\treturn snapshot();",
				"async workspaceSnapshot() {\n\t\t\tworkspaceWatcher.reconcileRoots([]);\n\t\t\treturn snapshot();",
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.app,
				"app/platform/tauri/browser-mock.ts",
				from,
				to,
			);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(browserFailure);
		}
	});

	it("allows provider watch only through the narrow bridge and rejects excluded services", () => {
		const baseline = workspaceWatcherBoundarySources();
		const providerPath = "app/features/workspace/file-system-provider.ts";
		for (const [from, to] of [
			["this.#bridge.workspaceWatch(", "this.#bridge.workspaceStat("],
			[
				"const unlisten = this.#bridge.workspaceWatch(",
				"const watch = this.#bridge.workspaceWatch;\n\t\tconst unlisten = watch(",
			],
			[
				"const unlisten = this.#bridge.workspaceWatch(resolved.rootId, () => {\n\t\t\tthis.fireRootUpdated(resource);\n\t\t\tvoid this.reconcileWatchedPaths(resolved.rootId);\n\t\t});",
				"const unlisten = this.#bridge.workspaceWatch(resolved.rootId, () => {\n\t\t\tvoid this.reconcileWatchedPaths(resolved.rootId);\n\t\t});\n\t\tthis.fireRootUpdated(resource);",
			],
		]) {
			const hostile = replaceWatcherSource(
				baseline.app,
				providerPath,
				from,
				to,
			);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile),
			).toContain(
				"Plain provider watch must route one root-only subscription through bridge.workspaceWatch",
			);
		}

		for (const injection of [
			'import "@codingame/monaco-vscode-auth-service-override";',
			"const hostKind = ExtensionHostKind.LocalProcess;",
			'import "@tauri-apps/plugin-shell";',
		]) {
			const hostile = baseline.app.map((entry) =>
				entry.relativePath === "app/platform/tauri/workspace-watcher.ts"
					? { ...entry, source: `${injection}\n${entry.source}` }
					: entry,
			);
			expect(
				validateWorkspaceWatcherBoundary(baseline.rust, hostile).some(
					(failure) => failure.includes("restores an excluded"),
				),
			).toBe(true);
		}
	});
});

const workspaceCargo = `
[dependencies]
cap-std = "4.0.2"
globset = "=0.4.19"
grep-matcher = "=0.1.9"
grep-regex = "=0.1.14"
grep-searcher = "=0.1.17"
ignore = "=0.4.31"
jsonc-parser = { version = "=0.33.0", default-features = false, features = [] }
libc = "0.2.186"
notify = "=8.2.0"
rustix = { version = "=1.1.4", features = ["fs"] }
sha2 = { version = "=0.10.9", default-features = false, features = [] }
uuid = { version = "1.24.0", features = ["v4"] }
zip = { version = "=8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs"] }
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

const exactNotifyDependency = Object.freeze({
	name: "notify",
	req: "=8.2.0",
	kind: null,
	rename: null,
	target: null,
	optional: false,
	uses_default_features: true,
	features: [],
});

const exactGlobsetDependency = Object.freeze({
	name: "globset",
	req: "=0.4.19",
	kind: null,
	rename: null,
	target: null,
	optional: false,
});

const exactIgnoreDependency = Object.freeze({
	name: "ignore",
	req: "=0.4.31",
	kind: null,
	rename: null,
	target: null,
	optional: false,
});

const exactGrepMatcherDependency = Object.freeze({
	name: "grep-matcher",
	req: "=0.1.9",
	kind: null,
	rename: null,
	target: null,
	optional: false,
});

const exactGrepRegexDependency = Object.freeze({
	name: "grep-regex",
	req: "=0.1.14",
	kind: null,
	rename: null,
	target: null,
	optional: false,
});

const exactGrepSearcherDependency = Object.freeze({
	name: "grep-searcher",
	req: "=0.1.17",
	kind: null,
	rename: null,
	target: null,
	optional: false,
});

const exactZipDependency = Object.freeze({
	name: "zip",
	req: "=8.6.0",
	kind: null,
	rename: null,
	target: null,
	optional: false,
	uses_default_features: false,
	features: ["deflate-flate2-zlib-rs"],
});

const exactJsoncParserDependency = Object.freeze({
	name: "jsonc-parser",
	req: "=0.33.0",
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
		[
			exactRustixDependency,
			exactSha2Dependency,
			exactNotifyDependency,
			exactGlobsetDependency,
			exactIgnoreDependency,
			exactGrepMatcherDependency,
			exactGrepRegexDependency,
			exactGrepSearcherDependency,
			exactZipDependency,
			exactJsoncParserDependency,
			...cargoDependencies,
		],
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
  remote: State<'_, RemoteSessionService>,
  request: WorkspacePrepareDeleteRequest,
) -> Result<WorkspaceDeleteBatchPlan, CommandError> {
  service.prepare_delete(window.label(), request.into_parts()?, remote.inner()).await
}
#[tauri::command]
pub(crate) async fn workspace_cancel_delete(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  remote: State<'_, RemoteSessionService>,
  request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
  service.cancel_delete(window.label(), request.confirmation_id(), remote.inner()).await
}
#[tauri::command]
pub(crate) async fn workspace_begin_delete(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  remote: State<'_, RemoteSessionService>,
  request: WorkspaceDeleteBatchRequest,
) -> Result<(), CommandError> {
  service.begin_delete(window.label(), request.confirmation_id(), remote.inner()).await
}
#[tauri::command]
pub(crate) async fn workspace_commit_delete_entry(
  window: WebviewWindow,
  service: State<'_, WorkspaceService>,
  remote: State<'_, RemoteSessionService>,
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
    remote.inner(),
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

	it("pins the watcher backend exactly and rejects broad native authority plugins", () => {
		const pinFailure = "Cargo.toml must pin notify to =8.2.0";
		const edgeFailure =
			"notify must remain one direct unrenamed non-optional runtime dependency pinned exactly to =8.2.0";
		for (const [hostile, notifyDependencies, expected] of [
			[
				workspaceCargo.replace('notify = "=8.2.0"', 'notify = "8.2"'),
				[{ ...exactNotifyDependency, req: "^8.2" }],
				[pinFailure, edgeFailure],
			],
			[
				workspaceCargo.replace(
					'notify = "=8.2.0"',
					'notify = "=8.2.0"\nnotify-copy = { package = "notify", version = "=8.2.0" }',
				),
				[
					exactNotifyDependency,
					{ ...exactNotifyDependency, rename: "notify-copy" },
				],
				[edgeFailure],
			],
		]) {
			const failures = validateWorkspaceRustBoundaryContract(
				hostile,
				workspaceSources,
				[exactRustixDependency, exactSha2Dependency, ...notifyDependencies],
			);
			expect(failures).toEqual(expect.arrayContaining(expected));
		}

		for (const plugin of [
			'tauri-plugin-fs = "2"',
			'native-shell = { package = "tauri-plugin-shell", version = "2" }',
		]) {
			expect(
				validateWorkspaceRustBoundary(
					`${workspaceCargo}\n${plugin}`,
					workspaceSources,
				),
			).toContain(
				"Cargo.toml must not grant broad Tauri filesystem or shell authority",
			);
		}
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
		const dependencies = [
			exactRustixDependency,
			exactSha2Dependency,
			exactNotifyDependency,
			exactGlobsetDependency,
			exactIgnoreDependency,
			exactGrepMatcherDependency,
			exactGrepRegexDependency,
			exactGrepSearcherDependency,
			exactZipDependency,
			exactJsoncParserDependency,
		];
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

	it("locks the sole direct zip edge, its minimal feature set and every Cargo metadata field", () => {
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).toEqual([]);

		const cases = [
			[
				[exactRustixDependency],
				"Cargo metadata must contain exactly one direct zip dependency",
			],
			[
				[exactRustixDependency, exactZipDependency, exactZipDependency],
				"Cargo metadata must contain exactly one direct zip dependency",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, req: "^8.6.0" }],
				"the direct zip dependency must require exactly =8.6.0",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, rename: "vsix-zip" }],
				"the direct zip dependency must remain unrenamed",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, kind: "dev" }],
				"the direct zip dependency must be a normal runtime edge",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, kind: "build" }],
				"the direct zip dependency must be a normal runtime edge",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, target: "cfg(unix)" }],
				"the direct zip dependency must not be target-specific",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, optional: true }],
				"the direct zip dependency must not be optional",
			],
			[
				[
					exactRustixDependency,
					{ ...exactZipDependency, uses_default_features: true },
				],
				"the direct zip dependency must disable default features",
			],
			[
				[exactRustixDependency, { ...exactZipDependency, features: [] }],
				"the direct zip dependency must enable exactly the deflate-flate2-zlib-rs feature",
			],
			[
				[
					exactRustixDependency,
					{
						...exactZipDependency,
						features: ["deflate-flate2-zlib-rs", "aes-crypto"],
					},
				],
				"the direct zip dependency must enable exactly the deflate-flate2-zlib-rs feature",
			],
			[
				[
					exactRustixDependency,
					{ ...exactZipDependency, features: ["deflate"] },
				],
				"the direct zip dependency must enable exactly the deflate-flate2-zlib-rs feature",
			],
		];
		for (const [hostileDependencies, failure] of cases) {
			expect(
				validateWorkspaceRustBoundaryContract(
					workspaceCargo,
					workspaceSources,
					hostileDependencies,
				),
			).toContain(failure);
		}
	});

	it("locks the exact zip manifest declaration to the minimal deflate-only feature set", () => {
		const declarationFailure =
			'Cargo.toml must declare exactly one zip = { version = "=8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs"] } dependency';
		for (const hostileDeclaration of [
			'zip = "8.6.0"',
			'zip = { version = "8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs"] }',
			'zip = { version = "=8.6.0", default-features = true, features = ["deflate-flate2-zlib-rs"] }',
			'zip = { version = "=8.6.0", default-features = false }',
			'zip = { version = "=8.6.0", default-features = false, features = [] }',
			'zip = { version = "=8.6.0", default-features = false, features = ["deflate"] }',
			'zip = { version = "=8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs", "time"] }',
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo.replace(
						'zip = { version = "=8.6.0", default-features = false, features = ["deflate-flate2-zlib-rs"] }',
						hostileDeclaration,
					),
					workspaceSources,
				),
			).toContain(declarationFailure);
		}
	});

	it("locks the sole direct jsonc-parser edge, its zero-feature footprint and every Cargo metadata field", () => {
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, workspaceSources),
		).toEqual([]);

		const cases = [
			[
				[exactRustixDependency],
				"Cargo metadata must contain exactly one direct jsonc-parser dependency",
			],
			[
				[
					exactRustixDependency,
					exactJsoncParserDependency,
					exactJsoncParserDependency,
				],
				"Cargo metadata must contain exactly one direct jsonc-parser dependency",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, req: "^0.33.0" },
				],
				"the direct jsonc-parser dependency must require exactly =0.33.0",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, rename: "jsonc" },
				],
				"the direct jsonc-parser dependency must remain unrenamed",
			],
			[
				[exactRustixDependency, { ...exactJsoncParserDependency, kind: "dev" }],
				"the direct jsonc-parser dependency must be a normal runtime edge",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, kind: "build" },
				],
				"the direct jsonc-parser dependency must be a normal runtime edge",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, target: "cfg(unix)" },
				],
				"the direct jsonc-parser dependency must not be target-specific",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, optional: true },
				],
				"the direct jsonc-parser dependency must not be optional",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, uses_default_features: true },
				],
				"the direct jsonc-parser dependency must disable default features",
			],
			[
				[
					exactRustixDependency,
					{ ...exactJsoncParserDependency, features: ["cst"] },
				],
				"the direct jsonc-parser dependency must enable no explicit features",
			],
		];
		for (const [hostileDependencies, failure] of cases) {
			expect(
				validateWorkspaceRustBoundaryContract(
					workspaceCargo,
					workspaceSources,
					hostileDependencies,
				),
			).toContain(failure);
		}
	});

	it("locks the exact jsonc-parser manifest declaration to zero explicit features", () => {
		const declarationFailure =
			'Cargo.toml must declare exactly one jsonc-parser = { version = "=0.33.0", default-features = false, features = [] } dependency';
		for (const hostileDeclaration of [
			'jsonc-parser = "0.33.0"',
			'jsonc-parser = { version = "0.33.0", default-features = false, features = [] }',
			'jsonc-parser = { version = "=0.33.0", default-features = true, features = [] }',
			'jsonc-parser = { version = "=0.33.0", default-features = false }',
			'jsonc-parser = { version = "=0.33.0", default-features = false, features = ["cst"] }',
		]) {
			expect(
				validateWorkspaceRustBoundary(
					workspaceCargo.replace(
						'jsonc-parser = { version = "=0.33.0", default-features = false, features = [] }',
						hostileDeclaration,
					),
					workspaceSources,
				),
			).toContain(declarationFailure);
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
			// Bypasses the local wrapper's always-prepended exact `ignore`
			// dependency (matching the notify-edge-case precedent above): this
			// scenario tests a *renamed* `ignore` dependency in isolation, and
			// a second, default-shaped `ignore` entry would spuriously trip the
			// new exactly-one-`ignore`-dependency check unrelated to what this
			// test exercises.
			expect(
				validateWorkspaceRustBoundaryContract(
					workspaceCargo,
					[
						...workspaceSources,
						{ relativePath: "src-tauri/src/search.rs", source },
					],
					[
						exactRustixDependency,
						exactSha2Dependency,
						exactNotifyDependency,
						exactGlobsetDependency,
						exactIgnoreDependency,
						exactGrepMatcherDependency,
						exactGrepRegexDependency,
						exactGrepSearcherDependency,
						exactZipDependency,
						exactJsoncParserDependency,
						ignoreDependency,
					],
					["default", "std"],
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

	it("allows one audited new-file publisher rename and rejects weakened flags", () => {
		const publisher = {
			relativePath: "src-tauri/src/workspace/new_file_publisher.rs",
			source: `
use rustix::fs::{renameat_with, RenameFlags};
fn publish_no_replace(parent: &Dir, stage: &Path, target: &Path) {
  let _ = renameat_with(parent, stage, parent, target, RenameFlags::NOREPLACE);
}
`,
		};
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				publisher,
			]),
		).toEqual([]);

		const weakened = {
			...publisher,
			source: publisher.source.replace(
				"RenameFlags::NOREPLACE",
				"RenameFlags::empty()",
			),
		};
		expect(
			validateWorkspaceRustBoundary(workspaceCargo, [
				...workspaceSources,
				weakened,
			]),
		).toContain(
			"workspace new-file publisher renameat_with must pass exactly one direct RenameFlags::NOREPLACE flag",
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
					"  service.begin_delete(window.label(), request.confirmation_id(), remote.inner()).await",
					"  service.cancel_delete(window.label(), request.confirmation_id(), remote.inner()).await?;\n  service.begin_delete(window.label(), request.confirmation_id(), remote.inner()).await",
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

const workspaceTrashRustPaths = [
	"src-tauri/src/workspace/trash/mod.rs",
	"src-tauri/src/workspace/trash/macos.rs",
	"src-tauri/src/workspace/delete.rs",
	"src-tauri/src/workspace/service.rs",
	"src-tauri/src/workspace/dto.rs",
	"src-tauri/src/workspace/mod.rs",
	"src-tauri/src/workspace/commands.rs",
	"src-tauri/src/lib.rs",
];
const workspaceTrashRustSources = workspaceTrashRustPaths.map(
	(relativePath) => ({
		relativePath,
		source: readFileSync(
			new URL(`../../${relativePath}`, import.meta.url),
			"utf8",
		),
	}),
);

function replaceWorkspaceTrashRustSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		workspaceTrashRustSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} Trash mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain F170 Rust-owned system Trash boundary", () => {
	it("accepts the independent four-command receipt and macOS Foundation route", () => {
		expect(
			validateWorkspaceTrashCommandRegistration(workspaceTrashRustSources),
		).toEqual([]);
		expect(validateWorkspaceTrashBoundary(workspaceTrashRustSources)).toEqual(
			[],
		);
	});

	it("rejects missing command attributes and permanent-delete DTO substitution", () => {
		for (const command of [
			"workspace_prepare_trash",
			"workspace_cancel_trash",
			"workspace_begin_trash",
			"workspace_commit_trash_entry",
		]) {
			const hostile = replaceWorkspaceTrashRustSource(
				"src-tauri/src/workspace/commands.rs",
				`#[tauri::command]\npub(crate) async fn ${command}`,
				`pub(crate) async fn ${command}`,
			);
			expect(validateWorkspaceTrashCommandRegistration(hostile)).toContain(
				`workspace/commands.rs must define exactly one audited ${command} Tauri command`,
			);
		}
		const mixed = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/commands.rs",
			"request: WorkspacePrepareTrashRequest",
			"request: WorkspacePrepareDeleteRequest",
		);
		expect(validateWorkspaceTrashCommandRegistration(mixed)).toContain(
			"workspace_prepare_trash must accept request: WorkspacePrepareTrashRequest and return Result<WorkspaceTrashBatchPlan, CommandError>",
		);
	});

	it("rejects serializable receipts, permanent removal, shell fallback and extra Foundation calls", () => {
		const serializable = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/trash/mod.rs",
			"pub(super) struct TrashBatchReceipt {",
			"#[derive(Clone, Serialize)]\npub(super) struct TrashBatchReceipt {",
		);
		expect(validateWorkspaceTrashBoundary(serializable)).toContain(
			"TrashBatchReceipt must have one non-Serde non-Clone Rust-only definition in workspace/trash/mod.rs",
		);

		for (const injection of [
			'fn fallback() { std::fs::remove_file("entry"); }',
			'fn fallback(parent: &Dir) { parent.remove_dir("entry"); }',
		]) {
			const hostile = replaceWorkspaceTrashRustSource(
				"src-tauri/src/workspace/trash/mod.rs",
				"#[cfg(test)]\nmod tests;",
				`${injection}\n#[cfg(test)]\nmod tests;`,
			);
			expect(validateWorkspaceTrashBoundary(hostile)).toContain(
				"system Trash receipt and adapter must not call or embed any permanent-delete surface",
			);
		}

		const shell = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/trash/macos.rs",
			"pub(in crate::workspace) struct MacOsSystemTrash;",
			"use std::process::Command;\npub(in crate::workspace) struct MacOsSystemTrash;",
		);
		expect(validateWorkspaceTrashBoundary(shell)).toContain(
			"macOS Trash adapter must use one direct Foundation trashItemAtURL call and no shell or delete fallback",
		);

		const duplicateFoundation = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/trash/macos.rs",
			"let manager = NSFileManager::defaultManager();",
			"let manager = NSFileManager::defaultManager();\nlet _second = NSFileManager::defaultManager();",
		);
		expect(validateWorkspaceTrashBoundary(duplicateFoundation)).toContain(
			"macOS Trash adapter must use one direct Foundation trashItemAtURL call and no shell or delete fallback",
		);
	});

	it("rejects missing ambient identity preflight and collapsed uncertain outcomes", () => {
		const missingTargetIdentity = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/trash/macos.rs",
			"std::fs::symlink_metadata(&request.target_path)",
			"std::fs::metadata(&request.target_path)",
		);
		expect(validateWorkspaceTrashBoundary(missingTargetIdentity)).toContain(
			"macOS Trash must recheck private canonical root and final pathname identities immediately before Foundation",
		);

		const collapsedUnknown = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/trash/mod.rs",
			"Ok(_) | Err(_) => WorkspaceTrashResult::OutcomeUnknown",
			"Ok(_) | Err(_) => retained(TrashFailure::TrashFailed)",
		);
		expect(validateWorkspaceTrashBoundary(collapsedUnknown)).toContain(
			"Trash commit must distinguish pre-attempt retention from post-attempt retained or outcomeUnknown",
		);
	});

	it("rejects skipped begin revalidation, permanent fallback and native paths in wire DTOs", () => {
		const noRevalidation = mutateWorkspaceSource(
			workspaceTrashRustSources,
			"src-tauri/src/workspace/service.rs",
			(source) => {
				const marker = "receipt.revalidate_all(&leases)?;";
				const index = source.lastIndexOf(marker);
				if (index < 0) {
					throw new Error(
						"Trash revalidation mutation no longer matches production",
					);
				}
				return source.slice(0, index) + source.slice(index + marker.length);
			},
		);
		expect(validateWorkspaceTrashBoundary(noRevalidation)).toContain(
			"WorkspaceService Trash phases must share the mutation gate, revalidate before begin, advance only trashed entries, rescan, and never fall back",
		);

		const fallback = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/service.rs",
			"let result = receipt.commit_next_with_platform(&lease, platform);",
			"let result = receipt.commit_next_with_platform(&lease, platform);\nlet _ = self.commit_delete_entry;",
		);
		expect(validateWorkspaceTrashBoundary(fallback)).toContain(
			"WorkspaceService Trash phases must share the mutation gate, revalidate before begin, advance only trashed entries, rescan, and never fall back",
		);

		const nativePath = replaceWorkspaceTrashRustSource(
			"src-tauri/src/workspace/dto.rs",
			"pub struct WorkspacePrepareTrashEntryRequest {\n    root_id: RootId,",
			"pub struct WorkspacePrepareTrashEntryRequest {\n    native_path: PathBuf,\n    root_id: RootId,",
		);
		expect(validateWorkspaceTrashBoundary(nativePath)).toContain(
			"Trash DTOs must be a strict path-free protocol distinct from permanent delete",
		);
	});

	it("keeps permanent delete commit isolated from the system Trash result", () => {
		const hostile = mutateWorkspaceSource(
			workspaceTrashRustSources,
			"src-tauri/src/workspace/service.rs",
			(source) =>
				source.replace(
					"let result = receipt.commit_next(&lease);",
					"let result = receipt.commit_next(&lease);\nlet _fallback: WorkspaceTrashResult = WorkspaceTrashResult::OutcomeUnknown;",
				),
		);
		expect(validateWorkspaceDeleteBoundary(hostile)).toContain(
			"permanent delete commit must remain isolated from every system Trash adapter and result",
		);
	});
});

const workspaceTrashAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/workspace-codec.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/workspace/delete-coordinator.ts",
	"app/features/workspace/file-system-provider.ts",
];
const workspaceTrashAppSources = workspaceTrashAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceWorkspaceTrashAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		workspaceTrashAppSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} TypeScript Trash mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain F170 TypeScript system Trash boundary", () => {
	it("accepts the strict bridge, native route and independent browser receipt", () => {
		expect(
			validateWorkspaceTrashTypeScriptBoundary(workspaceTrashAppSources),
		).toEqual([]);
	});

	it("rejects a recursive or native-path field in the wire contract", () => {
		for (const insertion of [
			"\treadonly recursive: boolean;\n",
			"\treadonly nativePath: string;\n",
		]) {
			const hostile = replaceWorkspaceTrashAppSource(
				"app/platform/tauri/contracts.ts",
				"export interface WorkspaceTrashEntryRequest {\n",
				`export interface WorkspaceTrashEntryRequest {\n${insertion}`,
			);
			expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
				"PlainBridge system Trash contract must keep its exact path-free request, plan and three-state result types",
			);
		}
	});

	it("rejects collapsing outcomeUnknown into retained", () => {
		const hostile = replaceWorkspaceTrashAppSource(
			"app/platform/tauri/workspace-codec.ts",
			'if (snapshot.status === "outcomeUnknown") {',
			'if (snapshot.status === "entryRetained") {',
		);
		expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
			"workspace Trash codec must keep a strict 1..64 path-free protocol with unique ids and only trashed, retained or unknown results",
		);
	});

	it("rejects routing a Trash commit through permanent delete", () => {
		const hostile = replaceWorkspaceTrashAppSource(
			"app/platform/tauri/native.ts",
			'await invoke<unknown>("workspace_commit_trash_entry", { request })',
			'await invoke<unknown>("workspace_commit_delete_entry", { request })',
		);
		expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
			"native bridge must route each system Trash phase once through its dedicated strict codec and command",
		);
		expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
			"workspace_commit_trash_entry must have exactly one production TypeScript invoke route",
		);
	});

	it("rejects aliasing the browser Trash receipt to permanent delete state", () => {
		const hostile = replaceWorkspaceTrashAppSource(
			"app/platform/tauri/browser-mock.ts",
			"let activeTrashBatch: MockTrashBatch | undefined;",
			"let activeTrashBatch = activeDeleteBatch;",
		);
		expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
			"browser mock must model a distinct mutually-exclusive Trash receipt with begin revalidation and ordered terminal results",
		);
	});

	it("locks non-permanent Trash authorization and strict coordinator ordering", () => {
		const coordinator = "app/features/workspace/delete-coordinator.ts";
		for (const [from, to, failure] of [
			[
				"skipTrashBin: false",
				"skipTrashBin: true",
				"Trash coordinator must bind one non-permanent recursive authorization to each ResourceFileEdit",
			],
			[
				"permanent: false",
				"permanent: true",
				"Trash coordinator must bind one non-permanent recursive authorization to each ResourceFileEdit",
			],
			[
				"beginAttempted = true;\n\t\tawait bridge.workspaceBeginTrash(plan.confirmationId);",
				"await bridge.workspaceBeginTrash(plan.confirmationId);\n\t\tbeginAttempted = true;",
				"runTrash must retain strict Trash intent, confirmation, begin and terminal-success sequencing",
			],
			[
				"await bridge.workspaceCancelTrash(plan.confirmationId);",
				"await bridge.workspaceCancelDelete(plan.confirmationId);",
				"runTrash must rescan after begun failures and cancel every uncompleted Trash confirmation in finally",
			],
			[
				'} else if (result.status === "trashed") {\n\t\t\ttrashedEntries += 1;',
				'} else if (result.status === "deleted") {\n\t\t\ttrashedEntries += 1;',
				"Trash coordinator must classify every authorization terminal typestate without guessing success",
			],
			[
				'Reflect.get(error, "code") === "WORKSPACE_TRASH_BATCH_CHANGED"',
				'Reflect.get(error, "code") !== "WORKSPACE_TRASH_BATCH_CHANGED"',
				"Trash coordinator must map only the exact changed-batch code to one path-free retained result",
			],
		]) {
			const hostile = replaceWorkspaceTrashAppSource(coordinator, from, to);
			expect(validateWorkspaceTrashTypeScriptBoundary(hostile)).toContain(
				failure,
			);
		}
	});

	it("rejects Trash dispatch without the immutable capability gate or through permanent commit", () => {
		const provider = "app/features/workspace/file-system-provider.ts";
		for (const [from, to] of [
			[
				"this.requireTrashDispatchAllowed();",
				"this.requireMutationDispatchAllowed();",
			],
			[
				"this.#bridge.workspaceCommitTrashEntry(",
				"this.#bridge.workspaceCommitDeleteEntry(",
			],
			[
				"allowsTrashDispatch: allowsMutationDispatch && snapshot.trash",
				"allowsTrashDispatch: allowsMutationDispatch",
			],
		]) {
			const hostile = replaceWorkspaceTrashAppSource(provider, from, to);
			const failures = validateWorkspaceTrashTypeScriptBoundary(hostile);
			expect(
				failures.some((message) =>
					/provider delete|mode-matched commit|capability contract|mutation policy/.test(
						message,
					),
				),
				`Trash provider mutation was not rejected: ${from}`,
			).toBe(true);
		}
	});
});

const workspaceDeleteAppPaths = [
	"app/main.ts",
	"app/platform/tauri/index.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/workspace/delete-coordinator.ts",
	"app/features/workspace/file-system-provider.ts",
];
const workspaceDeleteAppSources = workspaceDeleteAppPaths.map(
	(relativePath) => ({
		relativePath,
		source: readFileSync(
			new URL(`../../${relativePath}`, import.meta.url),
			"utf8",
		),
	}),
);

function replaceWorkspaceDeleteAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		workspaceDeleteAppSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} delete mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain confirmed-delete TypeScript invocation boundary", () => {
	it("accepts the production prepare/confirm/begin -> authorized provider commit route", () => {
		expect(
			validateWorkspaceDeleteTypeScriptBoundary(workspaceDeleteAppSources),
		).toEqual([]);
	});

	it("rejects missing, duplicated, indirect or wrongly-owned command literals", () => {
		const failure =
			"workspace_begin_delete must appear only as the direct invoke command of native workspaceBeginDelete";
		for (const hostile of [
			replaceWorkspaceDeleteAppSource(
				"app/platform/tauri/native.ts",
				'invoke<unknown>("workspace_begin_delete", { request })',
				"noop()",
			),
			replaceWorkspaceDeleteAppSource(
				"app/platform/tauri/native.ts",
				'"workspace_begin_delete"',
				"`workspace_begin_delete`",
			),
			replaceWorkspaceDeleteAppSource(
				"app/platform/tauri/native.ts",
				'"workspace_begin_delete"',
				'"workspace_" + "begin_delete"',
			),
			replaceWorkspaceDeleteAppSource(
				"app/platform/tauri/native.ts",
				'"workspace_begin_delete"',
				'["workspace", "begin", "delete"].join("_")',
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				"app/platform/tauri/native.ts",
				(source) => `${source}\nconst duplicate = "workspace_begin_delete";`,
			),
			replaceWorkspaceDeleteAppSource(
				"app/platform/tauri/native.ts",
				"workspaceBeginDelete: async (confirmationId) =>",
				"beginWithoutAuthorization: async (confirmationId) =>",
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
						message.includes("single audited coordinator/provider route"),
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
			"app/platform/tauri/delete-bypass.ts must not consume workspaceBeginDelete outside its single audited coordinator/provider route",
		);
	});

	it("locks the unique internal authorization-helper import and consumer map", () => {
		const coordinator = "app/features/workspace/delete-coordinator.ts";
		const provider = "app/features/workspace/file-system-provider.ts";
		for (const hostile of [
			replaceWorkspaceDeleteAppSource(
				coordinator,
				"authorizePlainWorkspaceDeleteResourceEdit,",
				"authorizePlainWorkspaceDeleteResourceEdit as authorizeDelete,",
			),
			replaceWorkspaceDeleteAppSource(
				provider,
				"beginPlainWorkspaceDeleteProviderDispatch,",
				"beginPlainWorkspaceDeleteProviderDispatch as beginDelete,",
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				coordinator,
				(source) =>
					`${source}\nconst leakedDeleteState = getPlainWorkspaceDeleteState;`,
			),
			mutateWorkspaceSource(
				workspaceDeleteAppSources,
				provider,
				(source) =>
					`${source}\nconst deleteDispatch = completePlainWorkspaceDeleteProviderResult;`,
			),
			[
				...workspaceDeleteAppSources,
				{
					relativePath: "app/features/workspace/delete-helper-bypass.ts",
					source:
						'import { getPlainWorkspaceDeleteState } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";',
				},
			],
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary(hostile);
			expect(
				failures.some((message) =>
					/plainWorkspaceDelete|fixed confirmed-delete function|module-private coordinator surface|top-level surface/.test(
						message,
					),
				),
			).toBe(true);
		}
	});

	it("rejects every app-wide IFileService or getProvider recovery path", () => {
		for (const [relativePath, source] of [
			[
				"app/features/provider-direct-bypass.ts",
				`import { getService, IFileService } from "@codingame/monaco-vscode-api";
async function recoverProvider() {
  const fileService = await getService(IFileService);
  return fileService.getProvider(PLAIN_WORKSPACE_SCHEME);
}`,
			],
			[
				"app/features/provider-computed-bypass.ts",
				`import { getService, IFileService as FileServiceToken } from "@codingame/monaco-vscode-api";
const fileService = await getService(FileServiceToken);
void fileService["get" + "Provider"];`,
			],
			[
				"app/features/provider-alias-bypass.ts",
				`import * as services from "@codingame/monaco-vscode-api";
const token = services["IFile" + "Service"];
const resolve = services.getService;
const fileService = await resolve(token);
const recover = fileService.getProvider;
void recover;`,
			],
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary([
				...workspaceDeleteAppSources,
				{ relativePath, source },
			]);
			expect(failures).toContain(
				`${relativePath} must not recover the registered workspace provider through getProvider`,
			);
			if (source.includes("IFileService")) {
				expect(failures).toContain(
					`${relativePath} must not import or reference IFileService in the Plain application`,
				);
			}
		}
	});

	it("allows unrelated getProvider APIs without IFileService authority", () => {
		const harmless = [
			...workspaceDeleteAppSources,
			{
				relativePath: "app/features/catalog.ts",
				source: [
					"declare const catalog: { getProvider(): unknown };",
					'const getterPrefix = "get";',
					"const getterKey = `${getterPrefix}Provider`;",
					"void catalog.getProvider();",
					"void catalog[getterKey]();",
					"void Reflect.get(catalog, getterKey);",
					"const { [getterKey]: recover } = catalog;",
					"void recover;",
				].join("\n"),
			},
		];
		expect(validateWorkspaceDeleteTypeScriptBoundary(harmless)).toEqual([]);
	});

	it("rejects constructed Reflect.get IFileService and provider authority", () => {
		for (const [relativePath, source, expected] of [
			[
				"app/features/reflect-token-bypass.ts",
				`declare const services: unknown;
void Reflect.get(services, "IFile" + "Service");`,
				"IFileService",
			],
			[
				"app/features/reflect-provider-bypass.ts",
				`import { getService, IFileService } from "@codingame/monaco-vscode-api";
const fileService = await getService(IFileService);
void Reflect["g" + "et"](fileService, "get" + "Provider");`,
				"getProvider",
			],
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary([
				...workspaceDeleteAppSources,
				{ relativePath, source },
			]);
			expect(
				failures.some((message) => message.includes(expected)),
				`${relativePath} must reject ${expected} authority`,
			).toBe(true);
		}
	});

	it("propagates multi-level const keys through Reflect authority reads", () => {
		const relativePath = "app/features/reflect-const-key-bypass.ts";
		const source = [
			'import { getService } from "@codingame/monaco-vscode-api";',
			"declare const services: unknown;",
			'const reflectGet = "g" + "et";',
			'const tokenPrefix = "IFile";',
			'const tokenSuffix = `${"Serv"}ice`;',
			"const tokenKey = `${tokenPrefix}${tokenSuffix}`;",
			'const getterPrefix = "get";',
			'const getterSuffix = "Pro" + "vider";',
			"const getterKey = `${getterPrefix}${getterSuffix}`;",
			"const token = Reflect[reflectGet](services, tokenKey);",
			"const fileService = await getService(token);",
			"const recover = Reflect.get(fileService, getterKey);",
			"void recover();",
		].join("\n");
		const failures = validateWorkspaceDeleteTypeScriptBoundary([
			...workspaceDeleteAppSources,
			{ relativePath, source },
		]);
		expect(failures).toContain(
			`${relativePath} must not import or reference IFileService in the Plain application`,
		);
		expect(failures).toContain(
			`${relativePath} must not recover the registered workspace provider through getProvider`,
		);
	});

	it("propagates const keys through computed authority destructuring", () => {
		const relativePath = "app/features/destructured-const-key-bypass.ts";
		const source = [
			'import { getService } from "@codingame/monaco-vscode-api";',
			"declare const services: unknown;",
			'const tokenStart = "I";',
			"const tokenMiddle = `${tokenStart}File`;",
			'const tokenKey = tokenMiddle + "Service";',
			'const getterStart = "get";',
			'const getterKey = `${getterStart}${"Provider"}`;',
			"const { [tokenKey]: token } = services;",
			"const fileService = await getService(token);",
			"const { [getterKey]: recover } = fileService;",
			"void recover();",
		].join("\n");
		const failures = validateWorkspaceDeleteTypeScriptBoundary([
			...workspaceDeleteAppSources,
			{ relativePath, source },
		]);
		expect(failures).toContain(
			`${relativePath} must not import or reference IFileService in the Plain application`,
		);
		expect(failures).toContain(
			`${relativePath} must not recover the registered workspace provider through getProvider`,
		);
	});

	it("still rejects getProvider recovery from the two IFileService-exempt theme paths", () => {
		// app/features/themes/plain-theme-registry.ts and app/main.ts are the
		// only two files permitted to import/reference IFileService at all (see
		// IFILE_SERVICE_TOKEN_EXEMPT_PATHS's own doc comment); that exemption is
		// narrowly about reading extension-file: resources, never about
		// recovering the registered plain-workspace: provider. Both exempt
		// paths must still fail exactly like any other file the moment they
		// derive `.getProvider(...)` from an IFileService-typed expression.
		for (const relativePath of [
			"app/features/themes/plain-theme-registry.ts",
			"app/main.ts",
		]) {
			const hostileSource = `import { getService, IFileService } from "@codingame/monaco-vscode-api";
async function recoverProvider() {
  const fileService = await getService(IFileService);
  return fileService.getProvider(PLAIN_WORKSPACE_SCHEME);
}`;
			const alreadyPresent = workspaceDeleteAppSources.some(
				(entry) => entry.relativePath === relativePath,
			);
			const sources = alreadyPresent
				? workspaceDeleteAppSources.map((entry) =>
						entry.relativePath === relativePath
							? { relativePath, source: hostileSource }
							: entry,
					)
				: [
						...workspaceDeleteAppSources,
						{ relativePath, source: hostileSource },
					];
			const failures = validateWorkspaceDeleteTypeScriptBoundary(sources);
			expect(
				failures,
				`${relativePath} must still reject getProvider recovery`,
			).toContain(
				`${relativePath} must not recover the registered workspace provider through getProvider`,
			);
		}
	});

	it("accepts real IFileService references from the two audited exempt theme paths without a getProvider call", () => {
		// The production app/features/themes/plain-theme-registry.ts is not
		// part of workspaceDeleteAppSources (only the fixed confirmed-delete
		// entrypoint set is); read it fresh here purely to prove the exemption
		// itself — not the getProvider ban — accepts a real IFileService
		// consumer that never derives getProvider from it.
		const registrySource = readFileSync(
			new URL(
				"../../app/features/themes/plain-theme-registry.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(registrySource).toContain("IFileService");
		expect(registrySource).not.toContain("getProvider");
		const failures = validateWorkspaceDeleteTypeScriptBoundary([
			...workspaceDeleteAppSources,
			{
				relativePath: "app/features/themes/plain-theme-registry.ts",
				source: registrySource,
			},
		]);
		expect(
			failures.some((message) =>
				message.includes(
					"app/features/themes/plain-theme-registry.ts must not import or reference IFileService",
				),
			),
		).toBe(false);
	});

	it("locks provider and bridge factories to their audited authority routes", () => {
		for (const [relativePath, source, expectedNames] of [
			[
				"app/features/second-writable-provider.ts",
				`import { createPlainWorkspaceFileSystemProvider } from "./workspace/file-system-provider";
import { createBridge } from "../platform/tauri";
const bridge = createBridge();
void createPlainWorkspaceFileSystemProvider(bridge, {
  create: true,
  renameNoReplace: true,
  copyMove: true,
  delete: true,
  versionedWrite: true,
});`,
				["createPlainWorkspaceFileSystemProvider", "createBridge"],
			],
			[
				"app/features/aliased-native-bridge.ts",
				`import { createNativeBridge as makeBridge } from "../platform/tauri/native";
void makeBridge();`,
				["createNativeBridge"],
			],
			[
				"app/features/namespace-bridge.ts",
				`import * as tauri from "../platform/tauri";
void tauri.createBridge();`,
				["createBridge"],
			],
			[
				"app/features/computed-bridge.ts",
				`declare const tauri: any;
void tauri["create" + "BrowserMockBridge"]();`,
				["createBrowserMockBridge"],
			],
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary([
				...workspaceDeleteAppSources,
				{ relativePath, source },
			]);
			for (const expectedName of expectedNames) {
				expect(
					failures.some(
						(message) =>
							message.includes(relativePath) && message.includes(expectedName),
					),
					`${relativePath} must reject ${expectedName}`,
				).toBe(true);
			}
		}
	});

	it("keeps Tauri's private global inside the bridge directory", () => {
		for (const [relativePath, source] of [
			[
				"app/features/direct-tauri-internals.ts",
				"void (window as any).__TAURI_INTERNALS__.invoke;",
			],
			[
				"app/features/computed-tauri-internals.ts",
				'void (globalThis as any)["__TAURI_INTERNALS__"];',
			],
			[
				"app/features/concatenated-tauri-internals.ts",
				'void (window as any)["__TAURI_" + "INTERNALS__"].invoke("workspace_create_file");',
			],
		]) {
			const failures = validateWorkspaceDeleteTypeScriptBoundary([
				...workspaceDeleteAppSources,
				{ relativePath, source },
			]);
			expect(failures).toContain(
				`${relativePath} must not access __TAURI_INTERNALS__ outside app/platform/tauri/`,
			);
		}
	});

	it("locks one confirmation and strict prepare -> begin -> authorization -> bulk sequencing", () => {
		const coordinator = "app/features/workspace/delete-coordinator.ts";
		const cases = [
			[
				"if (confirmed !== true)",
				"if (confirmed === true)",
				"runDelete must retain strict confirmation, begin and terminal-success sequencing",
			],
			[
				"beginAttempted = true;\n\t\tawait bridge.workspaceBeginDelete(plan.confirmationId);",
				"await bridge.workspaceBeginDelete(plan.confirmationId);\n\t\tbeginAttempted = true;",
				"runDelete must retain strict confirmation, begin and terminal-success sequencing",
			],
			[
				"skipTrashBin: true",
				"skipTrashBin: false",
				"delete coordinator must bind one permanent recursive authorization to each ResourceFileEdit",
			],
			[
				"permanent: true",
				"permanent: false",
				"delete coordinator must bind one permanent recursive authorization to each ResourceFileEdit",
			],
			[
				"recursive: true,\n\t\t\t\tkind: entry.kind",
				"recursive: false,\n\t\t\t\tkind: entry.kind",
				"delete coordinator must bind one permanent recursive authorization to each ResourceFileEdit",
			],
			[
				"if (!completed) {",
				"if (completed) {",
				"runDelete must rescan after begun failures and cancel every uncompleted confirmation in finally",
			],
			[
				"if (beginAttempted) {",
				"if (!beginAttempted) {",
				"runDelete must rescan after begun failures and cancel every uncompleted confirmation in finally",
			],
			[
				'result.status === "pending" || result.status === "inFlight"',
				'result.status === "pending" || result.status === "deleted"',
				"delete coordinator must classify every authorization terminal typestate without guessing success",
			],
		];
		for (const [from, to, failure] of cases) {
			const hostile = replaceWorkspaceDeleteAppSource(coordinator, from, to);
			expect(validateWorkspaceDeleteTypeScriptBoundary(hostile)).toContain(
				failure,
			);
		}

		const doubleConfirm = replaceWorkspaceDeleteAppSource(
			coordinator,
			"const selection = snapshotSelection(context, provider);",
			"await context.dialogService.confirm({});\n\tconst selection = snapshotSelection(context, provider);",
		);
		expect(validateWorkspaceDeleteTypeScriptBoundary(doubleConfirm)).toContain(
			"runDelete must call context.dialogService.confirm exactly 1 times in the audited route",
		);
	});

	it("locks provider authorization typestate, mode-matched commit and closed event outcomes", () => {
		const provider = "app/features/workspace/file-system-provider.ts";
		const cases = [
			[
				'typeof authorizationSnapshot.permanent !== "boolean"',
				"authorizationSnapshot.permanent !== true",
			],
			[
				"beginPlainWorkspaceDeleteProviderDispatch(authorization);",
				"void authorization;",
			],
			["decodeWorkspaceDeleteResult(", "await Promise.resolve("],
			[
				"completePlainWorkspaceDeleteProviderResult(authorization, result);",
				"void result;",
			],
			[': result.status === "trashed";', ': result.status === "deleted";'],
			[
				"this.fireDeleted(resolved.resource);",
				"this.fireRootUpdated(resolved.resource);",
			],
			[
				'rescan: true,\n\t\t\t\toutcome: "outcomeUnknown"',
				'rescan: false,\n\t\t\t\toutcome: "outcomeUnknown"',
			],
			[
				"this.#bridge.workspaceCommitDeleteEntry(",
				'this.#bridge["workspaceCommitDeleteEntry"](',
			],
		];
		for (const [from, to] of cases) {
			const hostile = replaceWorkspaceDeleteAppSource(provider, from, to);
			const failures = validateWorkspaceDeleteTypeScriptBoundary(hostile);
			expect(
				failures.some((message) =>
					/provider delete|typestate|mapDeleteError|workspaceCommitDeleteEntry|computed access|direct consumers/.test(
						message,
					),
				),
				`mutation was not rejected: ${from}`,
			).toBe(true);
		}
	});

	it("keeps confirmed delete inside the final all-five capability contract with mode-gated Trash and permanent events", () => {
		const provider = "app/features/workspace/file-system-provider.ts";
		for (const [from, to, expected] of [
			[
				`(policy.allowsMutationDispatch
				? FileSystemProviderCapabilities.FileFolderCopy |
					(policy.allowsTrashDispatch
						? FileSystemProviderCapabilities.Trash
						: FileSystemProviderCapabilities.None)
				: FileSystemProviderCapabilities.Readonly);`,
				"FileSystemProviderCapabilities.FileFolderCopy;",
				"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
			],
			[
				"? FileSystemProviderCapabilities.Trash",
				"? FileSystemProviderCapabilities.Readonly",
				"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
			],
			[
				"type: FileChangeType.DELETED,\n\t\t\t\t\tresource,",
				"type: FileChangeType.UPDATED,\n\t\t\t\t\tresource,",
				"fireDeleted must retain its exact snapshotted root/event delete role",
			],
		]) {
			const hostile = replaceWorkspaceDeleteAppSource(provider, from, to);
			expect(validateWorkspaceDeleteTypeScriptBoundary(hostile)).toContain(
				expected,
			);
		}

		const detachedPolicy = mutateWorkspaceSource(
			workspaceDeleteAppSources,
			provider,
			(source) =>
				`const allowsMutationDispatch = true;\n${source.replace(
					"constructor(bridge: PlainBridge, policy: PlainWorkspaceMutationPolicy)",
					"constructor(bridge: PlainBridge)",
				)}`,
		);
		expect(validateWorkspaceDeleteTypeScriptBoundary(detachedPolicy)).toContain(
			"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
		);
	});

	it("swallows a branded incomplete error into exactly one notifier call and rethrows only on notifier failure", () => {
		for (const hostile of [
			replaceWorkspaceDeleteAppSource(
				"app/features/workspace/delete-coordinator.ts",
				"notificationService.error(brandedError.message);\n\t\t\t\treturn;",
				"notificationService.error(brandedError.message);\n\t\t\t\tthrow brandedError;",
			),
			replaceWorkspaceDeleteAppSource(
				"app/features/workspace/delete-coordinator.ts",
				`\t\tif (brandedError !== undefined) {
			try {
				const notificationService = await getNotificationService();
				notificationService.error(brandedError.message);
				return;
			} catch {
				throw brandedError;
			}
		}
		throw error;`,
				`\t\tconst notificationService = await getNotificationService();
		if (brandedError !== undefined) {
			try {
				notificationService.error(brandedError.message);
				return;
			} catch {
				throw brandedError;
			}
		}
		notificationService.error(String(error));
		throw error;`,
			),
			replaceWorkspaceDeleteAppSource(
				"app/features/workspace/delete-coordinator.ts",
				"notificationService.error(brandedError.message);",
				'notificationService.error("The permanent delete batch stopped after a native delete became incomplete.");',
			),
			replaceWorkspaceDeleteAppSource(
				"app/features/workspace/delete-coordinator.ts",
				"notificationService.error(brandedError.message);\n\t\t\t\treturn;",
				"notificationService.error(brandedError.message);\n\t\t\t\tnotificationService.error(brandedError.message);\n\t\t\t\treturn;",
			),
			replaceWorkspaceDeleteAppSource(
				"app/features/workspace/delete-coordinator.ts",
				"} catch {\n\t\t\t\tthrow brandedError;\n\t\t\t}",
				"} catch {}",
			),
		]) {
			expect(validateWorkspaceDeleteTypeScriptBoundary(hostile)).toContain(
				"runDelete must rescan after begun failures and cancel every uncompleted confirmation in finally",
			);
		}
	});

	it("locks the minimal notification seam type, the four-parameter runDelete route and its registration forwarding", () => {
		expect(
			validateWorkspaceDeleteTypeScriptBoundary(
				replaceWorkspaceDeleteAppSource(
					"app/features/workspace/delete-coordinator.ts",
					"export type PlainDeleteErrorNotificationService = Readonly<{\n\terror(message: string): unknown;\n}>;",
					"export type PlainDeleteErrorNotificationService = Readonly<{\n\terror(message: string): unknown;\n\twarn(message: string): unknown;\n}>;",
				),
			),
		).toContain(
			"delete coordinator notification seam type must remain the exact minimal error(message) surface",
		);

		expect(
			validateWorkspaceDeleteTypeScriptBoundary(
				replaceWorkspaceDeleteAppSource(
					"app/features/workspace/delete-coordinator.ts",
					"export type PlainDeleteErrorNotificationService",
					"type PlainDeleteErrorNotificationService",
				),
			),
		).toContain(
			"delete-coordinator.ts must retain its exact module-private coordinator surface",
		);

		expect(
			validateWorkspaceDeleteTypeScriptBoundary(
				replaceWorkspaceDeleteAppSource(
					"app/features/workspace/delete-coordinator.ts",
					"\tgetNotificationService: () => Promise<PlainDeleteErrorNotificationService>,\n\tcontext: PlainWorkspaceDeleteCoordinatorContext,\n): Promise<void> {",
					"\tnotifierGetter: () => Promise<PlainDeleteErrorNotificationService>,\n\tcontext: PlainWorkspaceDeleteCoordinatorContext,\n): Promise<void> {",
				),
			),
		).toContain(
			"delete coordinator must define exactly one audited async runDelete route",
		);

		expect(
			validateWorkspaceDeleteTypeScriptBoundary(
				replaceWorkspaceDeleteAppSource(
					"app/features/workspace/delete-coordinator.ts",
					"runDelete(bridge, provider, getNotificationService, context)",
					"runDelete(bridge, provider, context)",
				),
			),
		).toContain(
			"delete coordinator registration must directly close over one bridge, provider and notification getter",
		);
	});
});

const readonlyWorkspaceProvider = readFileSync(
	new URL(
		"../../app/features/workspace/file-system-provider.ts",
		import.meta.url,
	),
	"utf8",
);
const workspaceBrowserFixture = readFileSync(
	new URL("../../tests/browser/workspace.spec.ts", import.meta.url),
	"utf8",
);

describe("Plain workspace provider copy boundary", () => {
	const capabilityAssignment = `this.capabilities =
			FileSystemProviderCapabilities.FileReadWrite |
			(policy.allowsMutationDispatch
				? FileSystemProviderCapabilities.FileFolderCopy |
					(policy.allowsTrashDispatch
						? FileSystemProviderCapabilities.Trash
						: FileSystemProviderCapabilities.None)
				: FileSystemProviderCapabilities.Readonly);`;
	const capabilityContractFailure =
		"Plain workspace provider capabilities must be constructed once from all-five mutation and explicit Trash policy bits";

	function mutateProvider(from, to) {
		if (!readonlyWorkspaceProvider.includes(from)) {
			throw new Error("provider mutation fixture no longer matches production");
		}
		return readonlyWorkspaceProvider.replace(from, to);
	}

	function mutateLastProvider(from, to) {
		const index = readonlyWorkspaceProvider.lastIndexOf(from);
		if (index < 0) {
			throw new Error("provider mutation fixture no longer matches production");
		}
		return (
			readonlyWorkspaceProvider.slice(0, index) +
			to +
			readonlyWorkspaceProvider.slice(index + from.length)
		);
	}

	function removeProviderMethodMutationGate(methodName) {
		const sourceFile = ts.createSourceFile(
			"app/features/workspace/file-system-provider.ts",
			readonlyWorkspaceProvider,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const providers = sourceFile.statements.filter(
			(statement) =>
				ts.isClassDeclaration(statement) &&
				statement.name?.text === "PlainWorkspaceFileSystemProvider",
		);
		const methods =
			providers.length === 1
				? providers[0].members.filter(
						(member) =>
							ts.isMethodDeclaration(member) &&
							ts.isIdentifier(member.name) &&
							member.name.text === methodName,
					)
				: [];
		const [firstStatement] = methods[0]?.body?.statements ?? [];
		if (
			methods.length !== 1 ||
			firstStatement === undefined ||
			firstStatement.getText(sourceFile).replaceAll(/\s+/g, "") !==
				"this.requireMutationDispatchAllowed();"
		) {
			throw new Error(`provider ${methodName} gate fixture no longer matches`);
		}
		return (
			readonlyWorkspaceProvider.slice(0, firstStatement.getStart(sourceFile)) +
			readonlyWorkspaceProvider.slice(firstStatement.end)
		);
	}

	it("accepts only the immutable all-five writable, Trash and readonly capability assignment", () => {
		expect(
			validateWorkspaceProviderCopyBoundary(readonlyWorkspaceProvider),
		).toEqual([]);

		for (const hostile of [
			mutateProvider(
				capabilityAssignment,
				"this.capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.FileFolderCopy;",
			),
			mutateProvider(
				capabilityAssignment,
				"this.capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly;",
			),
			mutateProvider(
				"(policy.allowsMutationDispatch\n\t\t\t\t? FileSystemProviderCapabilities.FileFolderCopy |",
				"(policy.allowsMutationDispatch\n\t\t\t\t? FileSystemProviderCapabilities.Readonly |",
			),
			mutateProvider(
				"(policy.allowsMutationDispatch\n",
				"(!policy.allowsMutationDispatch\n",
			),
			mutateProvider(
				"? FileSystemProviderCapabilities.Trash",
				"? FileSystemProviderCapabilities.Readonly",
			),
			mutateProvider(
				": FileSystemProviderCapabilities.None",
				": FileSystemProviderCapabilities.Trash",
			),
			mutateProvider(
				"readonly capabilities: FileSystemProviderCapabilities;",
				"readonly capabilities = this.#allowsTrashDispatch ? FileSystemProviderCapabilities.Trash : FileSystemProviderCapabilities.Readonly;",
			),
			...["static readonly", "declare readonly", "public readonly"].map(
				(modifiers) =>
					mutateProvider(
						"readonly capabilities: FileSystemProviderCapabilities;",
						`${modifiers} capabilities: FileSystemProviderCapabilities;`,
					),
			),
			mutateProvider(
				"readonly capabilities: FileSystemProviderCapabilities;",
				"readonly capabilities?: FileSystemProviderCapabilities;",
			),
			mutateProvider(
				"readonly capabilities: FileSystemProviderCapabilities;",
				"readonly capabilities!: FileSystemProviderCapabilities;",
			),
			mutateProvider("FileSystemProviderCapabilities.FileReadWrite |", "1 |"),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				capabilityContractFailure,
			);
		}
	});

	it("locks the exact ECMAScript-private authority fields and runtime freeze order", () => {
		const privateAssignments = `this.#bridge = bridge;
		this.#allowsMutationDispatch = policy.allowsMutationDispatch;
		this.#allowsTrashDispatch = policy.allowsTrashDispatch;`;
		const prototypeFreeze =
			"Object.freeze(PlainWorkspaceFileSystemProvider.prototype);";
		const earlyPrototypeFreeze = readonlyWorkspaceProvider
			.replace(`${prototypeFreeze}\n\n`, "")
			.replace(
				"class PlainWorkspaceFileSystemProvider",
				`${prototypeFreeze}\nclass PlainWorkspaceFileSystemProvider`,
			);
		for (const hostile of [
			mutateProvider(
				"readonly #bridge: PlainBridge;",
				"readonly bridge: PlainBridge;",
			),
			mutateProvider(
				"readonly #allowsMutationDispatch: boolean;",
				"readonly allowsMutationDispatch: boolean;",
			),
			mutateProvider(
				"readonly #allowsTrashDispatch: boolean;",
				"readonly allowsTrashDispatch: boolean;",
			),
			mutateProvider(
				privateAssignments,
				`this.#allowsTrashDispatch = policy.allowsTrashDispatch;
		this.#allowsMutationDispatch = policy.allowsMutationDispatch;
		this.#bridge = bridge;`,
			),
			mutateProvider(
				`${capabilityAssignment}
		Object.freeze(this);`,
				capabilityAssignment,
			),
			mutateProvider(
				`${capabilityAssignment}
		Object.freeze(this);`,
				`Object.freeze(this);
		${capabilityAssignment}`,
			),
			mutateProvider(
				prototypeFreeze,
				"Object.seal(PlainWorkspaceFileSystemProvider.prototype);",
			),
			mutateProvider(prototypeFreeze, `${prototypeFreeze}\n${prototypeFreeze}`),
			earlyPrototypeFreeze,
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				capabilityContractFailure,
			);
		}
	});

	it("rejects every capability outside the audited writable, Trash and readonly sets plus computed, duplicate and inherited surfaces", () => {
		for (const flag of [
			"PathCaseSensitive",
			"FileAtomicRead",
			"FileAtomicWrite",
			"FileAtomicDelete",
			"FileClone",
			"FileRealpath",
			"FileAppend",
			"FileOpenReadWriteClose",
			"FileReadStream",
			"FileWriteUnlock",
		]) {
			const hostile = mutateProvider(
				"FileSystemProviderCapabilities.None)",
				"FileSystemProviderCapabilities.None |\n\t\t\t\t\t\tFileSystemProviderCapabilities." +
					flag +
					")",
			);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				`Plain workspace provider must not advertise ${flag} outside the audited capability expression`,
			);
		}

		const computed = mutateProvider(
			"\tasync copy(\n",
			'\t["copy"] = async () => {};\n\n\tasync copy(\n',
		);
		expect(validateWorkspaceProviderCopyBoundary(computed)).toContain(
			"Plain workspace provider must not hide members behind computed names",
		);

		const duplicate = mutateProvider(
			"\tasync copy(\n",
			"\tasync copy(): Promise<void> {}\n\n\tasync copy(\n",
		);
		expect(validateWorkspaceProviderCopyBoundary(duplicate)).toContain(
			"Plain workspace provider member surface must remain the exact audited readonly/provider seam set",
		);

		const inherited = mutateProvider(
			"implements\n\t\tIFileSystemProviderWithFileReadWriteCapability",
			"extends WritableProvider implements\n\t\tIFileSystemProviderWithFileReadWriteCapability",
		);
		expect(validateWorkspaceProviderCopyBoundary(inherited)).toContain(
			"Plain workspace provider must not inherit hidden write capabilities",
		);
	});

	it("locks the strict overwrite-false own-data authenticator", () => {
		for (const hostile of [
			mutateProvider(
				"Object.getOwnPropertyDescriptors(options)",
				"Object.getOwnPropertyDescriptors({ overwrite: false })",
			),
			mutateProvider("keys.length !== 1", "keys.length < 1"),
			mutateProvider("overwrite.value !== false", "overwrite.value !== true"),
			mutateProvider("structuredClone(options);", "void options;"),
			mutateProvider(
				"Object.prototype && prototype !== null",
				"prototype !== null",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"requireNoOverwriteOptions must accept only one own-data enumerable overwrite false field",
			);
		}
	});

	it("locks authenticated copy/move errors and their rescan classification", () => {
		for (const [hostile, expected] of [
			[
				mutateProvider("keys.length !== 2", "keys.length !== 1"),
				"copyMoveCommandErrorCode must authenticate one exact own-data code/message command error",
			],
			[
				mutateProvider(
					"structuredClone(error);\n\t\treturn code.value;",
					"return code.value;",
				),
				"copyMoveCommandErrorCode must authenticate one exact own-data code/message command error",
			],
			[
				mutateProvider(
					"const code = copyMoveCommandErrorCode(error);",
					"const code = commandErrorCode(error);",
				),
				"mapCopyMoveError must own the exact authenticated copy/move error and rescan policy",
			],
			[
				mutateLastProvider(
					'case "WORKSPACE_CONFLICT":\n\t\tcase "WORKSPACE_WINDOW_CLOSED":',
					'case "WORKSPACE_CONFLICT":',
				),
				"mapCopyMoveError must own the exact authenticated copy/move error and rescan policy",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("locks copy to two URI snapshots, one bridge call, void re-authentication and its event closure", () => {
		for (const hostile of [
			mutateProvider(
				"const target = this.resolveMutationResource(to);",
				"const target = this.resolveMutationResource(from);",
			),
			mutateProvider(
				"this.#bridge.workspaceCopy(",
				"this.#bridge.workspaceMove(",
			),
			mutateProvider("requireVoidMutationReceipt(receipt);", "void receipt;"),
			mutateProvider(
				"this.fireRootUpdated(target.resource);",
				"this.fireRootUpdated(source.resource);",
			),
			mutateProvider(
				"this.fireCreated(target.resource);",
				"this.fireCreated(source.resource);",
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"copy must gate first, authenticate strict options, snapshot two URIs, route one copy, verify void and close its event set",
			);
		}
	});

	it("locks rename/move to two URI snapshots, unique routes, void verification and moved-only decoding", () => {
		for (const hostile of [
			mutateLastProvider(
				"const target = this.resolveMutationResource(to);",
				"const target = this.resolveMutationResource(from);",
			),
			mutateProvider(
				"this.#bridge.workspaceRename(",
				"this.#bridge.workspaceCopy(",
			),
			mutateProvider(
				"this.#bridge.workspaceMove(",
				"this.#bridge.workspaceCopy(",
			),
			mutateLastProvider(
				"requireVoidMutationReceipt(receipt);",
				"void receipt;",
			),
			mutateProvider("result = decodeWorkspaceMoveResult(", "result = ("),
			mutateProvider(
				'if (result.status !== "moved")',
				'if (result.status === "moved")',
			),
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				"rename must gate first, authenticate strict options, snapshot two URIs, split one rename or move route and accept only moved",
			);
		}
	});

	it("locks frozen success, single-root and double-root event sets", () => {
		const moved = mutateProvider(
			"type: FileChangeType.DELETED,\n\t\t\t\t\tresource: source,",
			"type: FileChangeType.UPDATED,\n\t\t\t\t\tresource: source,",
		);
		expect(validateWorkspaceProviderCopyBoundary(moved)).toContain(
			"fireMoved must emit one frozen source DELETED plus target ADDED event and nothing else",
		);

		const singleRoot = mutateProvider(
			"resource: root,\n\t\t\t\t}),",
			"resource,\n\t\t\t\t}),",
		);
		expect(validateWorkspaceProviderCopyBoundary(singleRoot)).toContain(
			"fireRootUpdated must emit one frozen root UPDATED event and nothing else",
		);

		const doubleRoot = mutateProvider(
			"resource: targetRoot,\n\t\t\t\t}),",
			"resource: sourceRoot,\n\t\t\t\t}),",
		);
		expect(validateWorkspaceProviderCopyBoundary(doubleRoot)).toContain(
			"fireRootsUpdated must emit one frozen source-root plus target-root UPDATED event and nothing else",
		);
	});

	it("locks distinct frozen incomplete and outcome-unknown move errors and factories", () => {
		const incompleteDeclarations = `class WorkspaceMoveIncompleteError extends FileOperationError {
	readonly code = "WORKSPACE_MOVE_INCOMPLETE" as const;

	constructor() {
		super(
			SANITIZED_MESSAGES.moveIncomplete,
			FileOperationResult.FILE_OTHER_ERROR,
		);
		this.name = this.code;
		Object.freeze(this);
	}
}

function workspaceMoveIncomplete(): WorkspaceMoveIncompleteError {
	return new WorkspaceMoveIncompleteError();
}`;
		const outcomeUnknownDeclarations = `class WorkspaceMoveOutcomeUnknownError extends FileOperationError {
	readonly code = "WORKSPACE_MOVE_OUTCOME_UNKNOWN" as const;

	constructor() {
		super(
			SANITIZED_MESSAGES.moveOutcomeUnknown,
			FileOperationResult.FILE_OTHER_ERROR,
		);
		this.name = this.code;
		Object.freeze(this);
	}
}

function workspaceMoveOutcomeUnknown(): WorkspaceMoveOutcomeUnknownError {
	return new WorkspaceMoveOutcomeUnknownError();
}`;
		const swappedTerminalBranches = mutateProvider(
			"throw workspaceMoveOutcomeUnknown();",
			"throw workspaceMoveSwapSentinel();",
		)
			.replace(
				"throw workspaceMoveIncomplete();",
				"throw workspaceMoveOutcomeUnknown();",
			)
			.replace(
				"throw workspaceMoveSwapSentinel();",
				"throw workspaceMoveIncomplete();",
			);
		for (const [hostile, expected] of [
			[
				mutateProvider(
					'readonly code = "WORKSPACE_MOVE_INCOMPLETE" as const;',
					'readonly code = "WORKSPACE_MOVE_PARTIAL" as const;',
				),
				"WorkspaceMoveIncompleteError must remain the frozen WORKSPACE_MOVE_INCOMPLETE FileOperationError",
			],
			[
				mutateProvider(
					'readonly code = "WORKSPACE_MOVE_OUTCOME_UNKNOWN" as const;',
					'readonly code = "WORKSPACE_MOVE_INCOMPLETE" as const;',
				),
				"WorkspaceMoveOutcomeUnknownError must remain the frozen WORKSPACE_MOVE_OUTCOME_UNKNOWN FileOperationError",
			],
			[
				mutateProvider(
					"FileOperationResult.FILE_OTHER_ERROR",
					"FileOperationResult.FILE_MOVE_CONFLICT",
				),
				"WorkspaceMoveIncompleteError must remain the frozen WORKSPACE_MOVE_INCOMPLETE FileOperationError",
			],
			[
				mutateProvider(
					'moveOutcomeUnknown:\n\t\t"The workspace move outcome is unknown. The source and target locations were refreshed; check both locations before continuing.",',
					'moveOutcomeUnknown:\n\t\t"The workspace move published its target but could not remove all of its source.",',
				),
				"SANITIZED_MESSAGES must retain its exact module-private sanitized error contract",
			],
			[
				mutateProvider(
					`${outcomeUnknownDeclarations}\n\nfunction kindToFileType`,
					`${outcomeUnknownDeclarations.replace("\n\t\tObject.freeze(this);", "")}\n\nfunction kindToFileType`,
				),
				"WorkspaceMoveOutcomeUnknownError must remain the frozen WORKSPACE_MOVE_OUTCOME_UNKNOWN FileOperationError",
			],
			[
				mutateProvider(
					"return new WorkspaceMoveIncompleteError();",
					"return unavailable();",
				),
				"workspaceMoveIncomplete must construct only the audited incomplete-move error",
			],
			[
				mutateProvider(
					"return new WorkspaceMoveOutcomeUnknownError();",
					"return new WorkspaceMoveIncompleteError();",
				),
				"workspaceMoveOutcomeUnknown must construct only the audited unknown-outcome error",
			],
			[
				mutateProvider(
					`${incompleteDeclarations}\n\n${outcomeUnknownDeclarations}`,
					`${outcomeUnknownDeclarations}\n\n${incompleteDeclarations}`,
				),
				"workspace move terminal errors and factories must retain their audited declaration order",
			],
			[
				swappedTerminalBranches,
				"rename must gate first, authenticate strict options, snapshot two URIs, split one rename or move route and accept only moved",
			],
			[
				mutateProvider(
					"throw workspaceMoveOutcomeUnknown();",
					"throw unavailable();",
				),
				"rename must gate first, authenticate strict options, snapshot two URIs, split one rename or move route and accept only moved",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("keeps write and mkdir public entry points fail-closed", () => {
		for (const [method, expected] of [
			[
				"writeFile",
				"Plain workspace provider must keep exactly one fail-closed public writeFile method",
			],
			[
				"mkdir",
				"Plain workspace provider must keep exactly one fail-closed public mkdir method",
			],
		]) {
			const hostile = mutateProvider(
				"\tasync " + method + "(",
				"\tasync " + method + "Bypass(",
			);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("forbids read paths and extra provider members from consuming mutation seams or publishing events", () => {
		const readMutation = mutateProvider(
			"\tasync stat(resource: URI): Promise<PlainWorkspaceProviderStat> {",
			"\tasync stat(resource: URI): Promise<PlainWorkspaceProviderStat> {\n\t\tawait this.rename(resource, resource, { overwrite: false });",
		);
		expect(validateWorkspaceProviderCopyBoundary(readMutation)).toContain(
			"Plain workspace provider methods must not internally consume dormant mutation seams",
		);

		const readEvent = mutateProvider(
			"\tasync stat(resource: URI): Promise<PlainWorkspaceProviderStat> {",
			"\tasync stat(resource: URI): Promise<PlainWorkspaceProviderStat> {\n\t\tthis.changeEmitter.fire(Object.freeze([]));",
		);
		expect(validateWorkspaceProviderCopyBoundary(readEvent)).toContain(
			"provider change events must remain confined to the audited create, publish, copy, rename, move and rescan closure",
		);

		const bridgeAlias = mutateProvider(
			"\tasync copy(\n",
			"\tprivate mutationBridge(): PlainBridge { return this.#bridge; }\n\n\tasync copy(\n",
		);
		expect(validateWorkspaceProviderCopyBoundary(bridgeAlias)).toEqual(
			expect.arrayContaining([
				"Plain workspace provider member surface must remain the exact audited readonly/provider seam set",
				"every this.#bridge reference must be the receiver of one fixed direct provider call",
			]),
		);
	});

	it("audits the exact watch-state reconciliation closure introduced for external delete detection", () => {
		const extraStat = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			'\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tvoid this.#bridge.workspaceStat("extra-root", "extra-path");',
		);
		expect(validateWorkspaceProviderCopyBoundary(extraStat)).toContain(
			"workspaceStat must have exactly 2 fixed direct this.#bridge call site(s)",
		);

		const droppedReconcileStat = mutateProvider(
			"\t\t\t\t\tawait this.#bridge.workspaceStat(rootId, relativePath);\n\t\t\t\t\tmissing = false;",
			"\t\t\t\t\tmissing = false;",
		);
		expect(
			validateWorkspaceProviderCopyBoundary(droppedReconcileStat),
		).toContain(
			"workspaceStat must have exactly 2 fixed direct this.#bridge call site(s)",
		);

		const extraFireDeleted = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tthis.fireDeleted(resource);",
		);
		expect(validateWorkspaceProviderCopyBoundary(extraFireDeleted)).toContain(
			"provider change events must remain confined to the audited create, publish, copy, rename, move and rescan closure",
		);

		const extraFireCreated = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tthis.fireCreated(resource);",
		);
		expect(validateWorkspaceProviderCopyBoundary(extraFireCreated)).toContain(
			"provider change events must remain confined to the audited create, publish, copy, rename, move and rescan closure",
		);

		const extraWatchStateReference = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tvoid this.#watchState.size;",
		);
		expect(
			validateWorkspaceProviderCopyBoundary(extraWatchStateReference),
		).toContain(
			"Plain workspace native authority must remain sealed in the exact bridge, mutation, Trash and watch-state private-field consumers",
		);
	});

	it("locks create receipts, create errors and the frozen mutation URI helper", () => {
		for (const [hostile, expected] of [
			[
				mutateProvider("stat.version !== null", "false"),
				"createdProviderStat must strictly decode exact zero/null file or directory receipts",
			],
			[
				mutateProvider(
					"let code: string | undefined;",
					"return Object.freeze({ error: unavailable(), rescan: false });\n\tlet code: string | undefined;",
				),
				"mapCreateError must own one exact sanitized code-to-provider-error mapping",
			],
			[
				mutateProvider('\t\t\t\ttypeof path !== "string" ||\n', ""),
				"mutation URI helper must read each primitive once and return one frozen request/event snapshot",
			],
			[
				mutateProvider(
					"return Object.freeze({ ...request, resource: eventResource });",
					"return Object.freeze({ ...request, resource });",
				),
				"mutation URI helper must read each primitive once and return one frozen request/event snapshot",
			],
			[
				mutateProvider(
					`"file",
			);
			this.fireCreated(resolved.resource);`,
					`"file",
			);
			this.fireCreated(resource);`,
				),
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
		]) {
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				expected,
			);
		}
	});

	it("locks exact decoder imports, intrinsic bindings and module-private declarations", () => {
		const aliasedMoveDecoder = mutateProvider(
			"\tdecodeWorkspaceMoveResult,\n",
			"\tdecodeWorkspaceMoveResult as decodeMove,\n",
		);
		expect(validateWorkspaceProviderCopyBoundary(aliasedMoveDecoder)).toContain(
			"file-system-provider.ts must import the strict workspace move decoder exactly by name",
		);

		const objectShadow =
			readonlyWorkspaceProvider +
			"\nconst Object = { freeze(value: unknown) { return value; } };";
		expect(validateWorkspaceProviderCopyBoundary(objectShadow)).toContain(
			"Object must remain the unshadowed global intrinsic in the Plain workspace provider",
		);

		const exportedHelper = mutateProvider(
			"function requireNoOverwriteOptions(",
			"export function requireNoOverwriteOptions(",
		);
		expect(validateWorkspaceProviderCopyBoundary(exportedHelper)).toContain(
			"file-system-provider.ts must match the exact declared, exported and non-executable top-level surface",
		);
	});

	it("locks the all-five capability policy and direct provider factory", () => {
		const policy = mutateProvider(
			"snapshot.copyMove &&",
			"snapshot.copyMove ||",
		);
		expect(validateWorkspaceProviderCopyBoundary(policy)).toContain(
			"mutation policy must decode one own-data DTO into immutable all-five and Trash booleans",
		);

		const factory = mutateProvider(
			"\t\tbridge,\n\t\tcreatePlainWorkspaceMutationPolicy(platformCapabilities),",
			"\t\totherBridge,\n\t\tcreatePlainWorkspaceMutationPolicy(platformCapabilities),",
		);
		expect(validateWorkspaceProviderCopyBoundary(factory)).toContain(
			"Plain workspace provider factory must directly bind bridge and decoded platform capabilities",
		);

		const exportedProvider = mutateProvider(
			"class PlainWorkspaceFileSystemProvider",
			"export class PlainWorkspaceFileSystemProvider",
		);
		expect(validateWorkspaceProviderCopyBoundary(exportedProvider)).toContain(
			"Plain workspace provider class must remain undecorated and module-private behind its audited factory",
		);
	});

	it("requires every advertised mutation consumer to retain the all-five gate as its first statement", () => {
		for (const [methodName, validator, expectedFailure] of [
			[
				"plainPublishFile",
				"provider",
				"plainPublishFile must gate first, publish once, validate metadata and emit only audited target events",
			],
			[
				"plainWriteFile",
				"provider",
				"plainWriteFile must gate first, dispatch one versioned bridge write and retain one root-rescan branch",
			],
			[
				"plainCreateFile",
				"provider",
				"plainCreateFile must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				"plainCreateDirectory",
				"provider",
				"plainCreateDirectory must gate first, snapshot once, validate one native receipt and emit one target addition",
			],
			[
				"copy",
				"provider",
				"copy must gate first, authenticate strict options, snapshot two URIs, route one copy, verify void and close its event set",
			],
			[
				"rename",
				"provider",
				"rename must gate first, authenticate strict options, snapshot two URIs, split one rename or move route and accept only moved",
			],
			[
				"delete",
				"delete",
				"provider delete must consume one authorization through prepared/inFlight/terminal typestate and dispatch exactly one mode-matched commit",
			],
			[
				"plainSnapshotDeleteResource",
				"delete",
				"plainSnapshotDeleteResource must retain its exact snapshotted root/event delete role",
			],
			[
				"plainRefreshDeleteRoots",
				"delete",
				"plainRefreshDeleteRoots must retain its exact snapshotted root/event delete role",
			],
		]) {
			const hostileProvider = removeProviderMethodMutationGate(methodName);
			const failures =
				validator === "provider"
					? validateWorkspaceProviderCopyBoundary(hostileProvider)
					: validateWorkspaceDeleteTypeScriptBoundary(
							workspaceDeleteAppSources.map((entry) =>
								entry.relativePath ===
								"app/features/workspace/file-system-provider.ts"
									? { ...entry, source: hostileProvider }
									: entry,
							),
						);
			expect(failures, `${methodName} lost its exact gate failure`).toContain(
				expectedFailure,
			);
		}
	});

	it("rejects dynamic globals, runtime binding mutation and computed bridge access", () => {
		for (const hostile of [
			readonlyWorkspaceProvider + '\nvoid globalThis["Object"]["freeze"];',
			readonlyWorkspaceProvider +
				"\n(FileChangeType as any).ADDED = FileChangeType.DELETED;",
			mutateProvider(
				"requireNoOverwriteOptions(options);\n\t\tconst source",
				'requireNoOverwriteOptions(options);\n\t\tconst method = "workspaceCopy";\n\t\tvoid this.#bridge[method];\n\t\tconst source',
			),
		]) {
			const failures = validateWorkspaceProviderCopyBoundary(hostile);
			expect(
				failures.some((message) =>
					/dynamic global|critical runtime bindings|alias or dynamically access/.test(
						message,
					),
				),
			).toBe(true);
		}
	});

	it("rejects decorators, constructor policy upgrades and live function aliases", () => {
		const decorated = mutateProvider(
			"\tasync copy(\n",
			"\t@wrapMutation\n\tasync copy(\n",
		);
		expect(validateWorkspaceProviderCopyBoundary(decorated)).toContain(
			"Plain workspace provider source must not contain decorators that can wrap audited construction or mutation seams",
		);

		const constructorUpgrade = mutateProvider(
			capabilityAssignment,
			`${capabilityAssignment}
		this.capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.FileFolderCopy;`,
		);
		expect(validateWorkspaceProviderCopyBoundary(constructorUpgrade)).toContain(
			"Plain workspace provider constructor must retain only the bridge, immutable mutation and Trash booleans and exact capability assignment",
		);

		const liveAlias =
			readonlyWorkspaceProvider +
			"\nconst originalMoveIncomplete = workspaceMoveIncomplete;";
		expect(validateWorkspaceProviderCopyBoundary(liveAlias)).toContain(
			"workspaceMoveIncomplete must not be reassigned, aliased or consumed outside its audited direct calls",
		);
	});

	it("rejects side-effect imports, provider aliases and dynamic mutation surfaces", () => {
		const sideEffectImport =
			'import "./mutation-bypass";\n' + readonlyWorkspaceProvider;
		expect(validateWorkspaceProviderCopyBoundary(sideEffectImport)).toContain(
			"file-system-provider.ts imports must match the exact audited module, name and type-only surface",
		);

		const providerAlias =
			readonlyWorkspaceProvider +
			"\nconst ProviderAlias = PlainWorkspaceFileSystemProvider;";
		expect(validateWorkspaceProviderCopyBoundary(providerAlias)).toContain(
			"PlainWorkspaceFileSystemProvider may be referenced only by its declaration, prototype freeze and audited factory",
		);

		for (const addition of [
			'Object.defineProperty({}, "copy", { value() {} });',
			"const wrapped = new Proxy({}, {});",
		]) {
			expect(
				validateWorkspaceProviderCopyBoundary(
					readonlyWorkspaceProvider + "\n" + addition,
				),
			).toContain(
				"Plain workspace provider must not use defineProperty or Proxy mutation surfaces",
			);
		}
	});
});

describe("Plain browser move-failure fixture boundary", () => {
	function mutateBrowserFixture(from, to) {
		if (!workspaceBrowserFixture.includes(from)) {
			throw new Error(
				"browser move-failure fixture no longer matches production",
			);
		}
		return workspaceBrowserFixture.replace(from, to);
	}

	it("accepts the local retained/partial multi-root fixture", () => {
		expect(
			validateWorkspaceMoveFailureBrowserFixture(workspaceBrowserFixture),
		).toEqual([]);
	});

	it("rejects open scenario sets and raw receipt parameters", () => {
		for (const hostile of [
			mutateBrowserFixture(
				'type TestMultiRootMoveIncompleteScenario = "moveRetained" | "movePartial";',
				'type TestMultiRootMoveIncompleteScenario = "moveRetained" | "movePartial" | "moveUnknown";',
			),
			mutateBrowserFixture(
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void>',
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tstatus: string = "targetPublishedSourceRetained",\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void>',
			),
			mutateBrowserFixture(
				"moveIncompleteScenarios: readonly TestMultiRootMoveIncompleteScenario[] = []",
				"moveIncompleteScenarios: readonly string[] = []",
			),
		]) {
			expect(validateWorkspaceMoveFailureBrowserFixture(hostile)).toContain(
				"browser move-failure fixture third argument must remain the closed moveRetained/movePartial scenario set",
			);
		}
	});

	it("keeps scenario state inside the one local addInitScript closure", () => {
		for (const hostile of [
			mutateBrowserFixture(
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void> {\n\tawait page.addInitScript(',
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void> {\n\tvoid moveIncompleteScenarios;\n\tawait page.addInitScript(',
			),
			mutateBrowserFixture(
				"\t\t\tmoveIncompleteScenarios,\n\t\t\tdeleteIncompleteScenarios,\n\t\t\tworkspaceId: nativeWorkspaceId,",
				"\t\t\tdeleteIncompleteScenarios,\n\t\t\tworkspaceId: nativeWorkspaceId,",
			),
			mutateBrowserFixture(
				"const moveIncompletePlan = [...moveIncompleteScenarios];",
				`const moveIncompletePlan = [...moveIncompleteScenarios];
			const testMoveWindow = window as unknown as Record<string, unknown>;
			testMoveWindow.__PLAIN_TEST_MOVE_FAILURE__ = () =>
				moveIncompletePlan.shift();`,
			),
		]) {
			const failures = validateWorkspaceMoveFailureBrowserFixture(hostile);
			expect(
				failures.some((failure) =>
					/local to one audited multi-root addInitScript fixture|must not accept raw receipt fields or expose a window mutation control/.test(
						failure,
					),
				),
			).toBe(true);
		}
	});

	it("locks fixed cross-root requests and target-first ordering", () => {
		const wrongRequest = mutateBrowserFixture(
			'request.targetPath !== "src/move-source.txt"',
			'request.targetPath !== "src/other.txt"',
		);
		expect(validateWorkspaceMoveFailureBrowserFixture(wrongRequest)).toContain(
			"browser move-failure fixture must retain exact cross-root request validation",
		);

		const delayedPublication = mutateBrowserFixture(
			"\t\t\t\t\t\t\ttarget.parent.entries.set(target.name, reboundNode);",
			"",
		).replace(
			'if (plannedIncomplete === "moveRetained") {',
			'if (plannedIncomplete === "moveRetained") {\n\t\t\t\t\t\t\t\ttarget.parent.entries.set(target.name, reboundNode);',
		);
		expect(
			validateWorkspaceMoveFailureBrowserFixture(delayedPublication),
		).toContain(
			"browser move-failure fixture must publish the target before its ordered terminal scenario branches",
		);
	});

	it("locks retained source preservation and boolean-derived partial deletion count", () => {
		const retainedDelete = mutateBrowserFixture(
			'if (plannedIncomplete === "moveRetained") {\n\t\t\t\t\t\t\t\tmoveIncompletePlan.shift();',
			'if (plannedIncomplete === "moveRetained") {\n\t\t\t\t\t\t\t\tsource.parent.entries.delete(source.name);\n\t\t\t\t\t\t\t\tmoveIncompletePlan.shift();',
		);
		expect(
			validateWorkspaceMoveFailureBrowserFixture(retainedDelete),
		).toContain(
			"browser retained-move fixture must leave the source untouched and return only its fixed receipt",
		);

		const forgedCount = mutateBrowserFixture(
			`const removedEntries = node.entries.delete("removed.txt")
									? 1
									: 0;`,
			"const removedEntries = 1;",
		);
		expect(validateWorkspaceMoveFailureBrowserFixture(forgedCount)).toContain(
			"browser partial-move fixture must delete removed.txt and derive removedEntries from that boolean result",
		);
	});
});

describe("Plain browser delete-failure fixture boundary", () => {
	function mutateBrowserFixture(from, to) {
		if (!workspaceBrowserFixture.includes(from)) {
			throw new Error(
				"browser delete-failure fixture no longer matches production",
			);
		}
		return workspaceBrowserFixture.replace(from, to);
	}

	it("accepts the local retained/partial multi-root fixture", () => {
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(workspaceBrowserFixture),
		).toEqual([]);
	});

	it("rejects open scenario sets and raw receipt parameters", () => {
		for (const hostile of [
			mutateBrowserFixture(
				'type TestMultiRootDeleteIncompleteScenario = "deleteRetained" | "deletePartial";',
				'type TestMultiRootDeleteIncompleteScenario = "deleteRetained" | "deletePartial" | "deleteUnknown";',
			),
			mutateBrowserFixture(
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void>',
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tstatus: string = "entryRetained",\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void>',
			),
			mutateBrowserFixture(
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = []",
				"deleteIncompleteScenarios: readonly string[] = []",
			),
		]) {
			expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
				"browser delete-failure fixture fourth argument must remain the closed deleteRetained/deletePartial scenario set",
			);
		}
	});

	it("keeps scenario state inside the one local addInitScript closure", () => {
		for (const hostile of [
			mutateBrowserFixture(
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void> {\n\tawait page.addInitScript(',
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tpersistBackupsForTest: boolean = false,\n\tworkspaceFilePicks: readonly ("selected" | "cancelled")[] = [],\n): Promise<void> {\n\tvoid deleteIncompleteScenarios;\n\tawait page.addInitScript(',
			),
			mutateBrowserFixture(
				"\t\t\tdeleteIncompleteScenarios,\n\t\t\tworkspaceId: nativeWorkspaceId,",
				"\t\t\tworkspaceId: nativeWorkspaceId,",
			),
			mutateBrowserFixture(
				"const deleteIncompletePlan = [...deleteIncompleteScenarios];",
				`const deleteIncompletePlan = [...deleteIncompleteScenarios];
				const testDeleteWindow = window as unknown as Record<string, unknown>;
				testDeleteWindow.__PLAIN_TEST_DELETE_FAILURE__ = () =>
					deleteIncompletePlan.shift();`,
			),
		]) {
			const failures = validateWorkspaceDeleteFailureBrowserFixture(hostile);
			expect(
				failures.some((failure) =>
					/local to one audited multi-root addInitScript fixture|must not accept raw receipt fields or expose a window mutation control/.test(
						failure,
					),
				),
			).toBe(true);
		}
	});

	it("locks fixed per-entry requests and ordered terminal branches", () => {
		const wrongRequest = mutateBrowserFixture(
			'activeDelete.relativePath !== "delete-retained.txt"',
			'activeDelete.relativePath !== "other.txt"',
		);
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(wrongRequest),
		).toContain(
			"browser delete-failure fixture must retain exact per-entry request validation",
		);

		const reorderedNormalDelete = mutateBrowserFixture(
			"\t\t\t\t\t\t\tif (!target.parent.entries.delete(target.name)) {\n\t\t\t\t\t\t\t\tthrow entryNotFound();\n\t\t\t\t\t\t\t}\n",
			"",
		).replace(
			'if (plannedDeleteIncomplete === "deleteRetained") {',
			'if (!target.parent.entries.delete(target.name)) {\n\t\t\t\t\t\t\t\tthrow entryNotFound();\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\tif (plannedDeleteIncomplete === "deleteRetained") {',
		);
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(reorderedNormalDelete),
		).toContain(
			"browser delete-failure fixture must invalidate the active batch before its ordered terminal scenario branches",
		);
	});

	it("locks retained tree preservation and boolean-derived partial deletion count", () => {
		const retainedDelete = mutateBrowserFixture(
			'if (plannedDeleteIncomplete === "deleteRetained") {\n\t\t\t\t\t\t\t\tdeleteIncompletePlan.shift();',
			'if (plannedDeleteIncomplete === "deleteRetained") {\n\t\t\t\t\t\t\t\ttarget.parent.entries.delete(target.name);\n\t\t\t\t\t\t\t\tdeleteIncompletePlan.shift();',
		);
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(retainedDelete),
		).toContain(
			"browser retained-delete fixture must leave the tree untouched and return only its fixed receipt",
		);

		const forgedCount = mutateBrowserFixture(
			`const node = target.parent.entries.get(target.name);
								if (node?.kind !== "directory") {
									throw entryTypeMismatch();
								}
								const removedEntries = node.entries.delete("removed.txt")
									? 1
									: 0;`,
			`const node = target.parent.entries.get(target.name);
								if (node?.kind !== "directory") {
									throw entryTypeMismatch();
								}
								const removedEntries = 1;`,
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(forgedCount)).toContain(
			"browser partial-delete fixture must delete removed.txt and derive removedEntries from that boolean result",
		);
	});
});

describe("Plain browser workspace fixture window authority boundary", () => {
	function mutateBrowserFixture(from, to) {
		if (!workspaceBrowserFixture.includes(from)) {
			throw new Error("browser workspace fixture no longer matches production");
		}
		return workspaceBrowserFixture.replace(from, to);
	}

	const windowAuthorityFailure =
		"browser workspace fixture must reach the page window only through the audited testWindow surface";

	it("accepts the local retained/partial multi-root fixture", () => {
		expect(
			validateWorkspaceBrowserFixtureWindowAuthority(workspaceBrowserFixture),
		).toEqual([]);
		expect(
			validateWorkspaceMoveFailureBrowserFixture(workspaceBrowserFixture),
		).toEqual([]);
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(workspaceBrowserFixture),
		).toEqual([]);
	});

	it("rejects a plan alias combined with a window-alias mutation hook", () => {
		// The confirmed P1 bypass: reading the plan through an alias defeats the
		// exact peek-statement text lock, and reaching the page window through
		// a freshly declared alias (instead of the audited testWindow receiver)
		// defeats the old receiver-name-based forbiddenWindowControls check.
		// `const testWindow = window as unknown as Window & {` also opens many
		// unrelated single-purpose addInitScript callbacks elsewhere in this
		// file, so the anchor below pins the line that follows it
		// (`__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__`, unique to the
		// shared multi-root fixture) to make sure the mutation lands inside
		// `installMultiRootNativeIpcMock` and not some other fixture.
		const hostile = mutateBrowserFixture(
			"\t\t\t\t\t\t\tconst plannedDeleteIncomplete = deleteIncompletePlan[0];",
			"\t\t\t\t\t\t\tconst planAlias = deleteIncompletePlan;\n\t\t\t\t\t\t\tconst plannedDeleteIncomplete = planAlias[0];",
		).replace(
			"\t\t\tconst testWindow = window as unknown as Window & {\n\t\t\t\t__PLAIN_TEST_TAURI_CALLS__: typeof calls;\n\t\t\t\t__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;",
			"\t\t\tconst winAlias = window as unknown as Record<string, unknown>;\n\t\t\twinAlias.__PLAIN_TEST_DELETE_FAILURE__ = (next: string) => {\n\t\t\t\tplanAlias.length = 0;\n\t\t\t\tplanAlias.push(next);\n\t\t\t};\n\t\t\tconst testWindow = window as unknown as Window & {\n\t\t\t\t__PLAIN_TEST_TAURI_CALLS__: typeof calls;\n\t\t\t\t__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;",
		);
		expect(validateWorkspaceBrowserFixtureWindowAuthority(hostile)).toContain(
			windowAuthorityFailure,
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must peek deleteIncompletePlan[0] through one audited statement",
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must keep deleteIncompletePlan references inside its audited plan, peek and terminal branch statements",
		);
	});

	it("rejects a globalThis alias hook even without touching moveIncompletePlan/deleteIncompletePlan", () => {
		const hostile = mutateBrowserFixture(
			"\t\t\tconst testWindow = window as unknown as Window & {\n\t\t\t\t__PLAIN_TEST_TAURI_CALLS__: typeof calls;\n\t\t\t\t__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;",
			"\t\t\tconst g = globalThis as unknown as Record<string, unknown>;\n\t\t\tg.__PLAIN_TEST_HOOK__ = () => {};\n\t\t\tconst testWindow = window as unknown as Window & {\n\t\t\t\t__PLAIN_TEST_TAURI_CALLS__: typeof calls;\n\t\t\t\t__PLAIN_TEST_MULTI_ROOT_VERSION_TRANSITIONS__: typeof versionTransitions;",
		);
		expect(validateWorkspaceBrowserFixtureWindowAuthority(hostile)).toContain(
			windowAuthorityFailure,
		);
	});

	it("rejects a bare plan alias even when the page window is untouched", () => {
		const hostile = mutateBrowserFixture(
			"\t\t\t\t\t\t\tconst plannedDeleteIncomplete = deleteIncompletePlan[0];",
			"\t\t\t\t\t\t\tconst planAlias = deleteIncompletePlan;\n\t\t\t\t\t\t\tconst plannedDeleteIncomplete = planAlias[0];",
		);
		expect(validateWorkspaceBrowserFixtureWindowAuthority(hostile)).toEqual([]);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must peek deleteIncompletePlan[0] through one audited statement",
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must keep deleteIncompletePlan references inside its audited plan, peek and terminal branch statements",
		);
	});

	it("rejects peek index tampering on both failure plans", () => {
		const hostileDelete = mutateBrowserFixture(
			"\t\t\t\t\t\t\tconst plannedDeleteIncomplete = deleteIncompletePlan[0];",
			"\t\t\t\t\t\t\tconst plannedDeleteIncomplete = deleteIncompletePlan[1];",
		);
		expect(
			validateWorkspaceDeleteFailureBrowserFixture(hostileDelete),
		).toContain(
			"browser delete-failure fixture must peek deleteIncompletePlan[0] through one audited statement",
		);

		const hostileMove = mutateBrowserFixture(
			"\t\t\t\t\t\t\tconst plannedIncomplete = moveIncompletePlan[0];",
			"\t\t\t\t\t\t\tconst plannedIncomplete = moveIncompletePlan[1];",
		);
		expect(validateWorkspaceMoveFailureBrowserFixture(hostileMove)).toContain(
			"browser move-failure fixture must peek moveIncompletePlan[0] through one audited statement",
		);
	});

	it("rejects an unconditional delete inserted before the retained commit branch", () => {
		const hostile = mutateBrowserFixture(
			'\t\t\t\t\t\t\tif (plannedDeleteIncomplete === "deleteRetained") {',
			'\t\t\t\t\t\t\ttarget.parent.entries.delete(target.name);\n\t\t\t\t\t\t\tif (plannedDeleteIncomplete === "deleteRetained") {',
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must keep commit-case target references inside its audited declaration and terminal branch statements",
		);
	});

	it("rejects an unconditional primaryEntries.push inserted at tree-construction time", () => {
		const hostile = mutateBrowserFixture(
			"\t\t\tconst trees = new Map<string, MockDirectory>([",
			'\t\t\tprimaryEntries.push(["extra-secret.txt", file("x\\n")]);\n\t\t\tconst trees = new Map<string, MockDirectory>([',
		);
		expect(validateWorkspaceDeleteFailureBrowserFixture(hostile)).toContain(
			"browser delete-failure fixture must keep primaryEntries and secondaryEntries references inside their audited seed and tree-construction statements",
		);
	});
});

describe("Plain workspace provider bootstrap contract", () => {
	const bootstrap = `
import { getService, initialize, INotificationService } from "@codingame/monaco-vscode-api";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { createPlainUserDataFileSystemProvider, PLAIN_USER_DATA_SCHEME } from "./features/preferences/user-data-file-system-provider";
import { createPlainWorkspaceFileSystemProvider, PLAIN_WORKSPACE_SCHEME } from "./features/workspace/file-system-provider";
import { createPlainWorkspaceConfigurationProvider, PLAIN_WORKSPACE_CONFIGURATION_SCHEME } from "./features/workspace/workspace-configuration-provider";
import { registerWorkspaceDeleteCoordinator } from "./features/workspace/delete-coordinator";
import { createBridge } from "./platform/tauri";
import { configurePlainSearchBridge } from "./features/search/plain-search-service";
import { configurePlainLifecycleBridge } from "./services/plain-lifecycle-service";
import { configurePlainWorkingCopyBackupBridge } from "./services/plain-workspace-backup-service";

async function bootstrap() {
const bridge = createBridge();
const userDataFileSystemProvider = createPlainUserDataFileSystemProvider(bridge);
registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);
const workspaceCapabilities = await bridge.workspaceCapabilities();
const workspaceFileSystemProvider = createPlainWorkspaceFileSystemProvider(
  bridge,
  workspaceCapabilities,
);
const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  () => getService(INotificationService),
);
const workspaceConfigurationProvider = createPlainWorkspaceConfigurationProvider();
registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
registerCustomProvider(PLAIN_WORKSPACE_CONFIGURATION_SCHEME, workspaceConfigurationProvider);
const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
window.addEventListener("pagehide", () => {
  workspaceDeleteCoordinator.dispose();
}, { once: true });
configurePlainWorkingCopyBackupBridge(bridge);
configurePlainLifecycleBridge(bridge);
configurePlainSearchBridge(bridge);
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
				"app/main.ts must register exactly three audited custom providers",
				"app/main.ts must unconditionally register only the audited plain-workspace provider",
				"bootstrap order must remain createBridge -> user data -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
			]),
		);
	});

	it("locks the local user-data provider to one direct bridge-bound registration", () => {
		for (const [hostile, expected] of [
			[
				bootstrap.replace(
					"createPlainUserDataFileSystemProvider(bridge)",
					"createPlainUserDataFileSystemProvider(otherBridge)",
				),
				"app/main.ts must construct exactly one bridge-bound local user-data provider",
			],
			[
				bootstrap.replace(
					"registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);",
					'registerCustomProvider("file", userDataFileSystemProvider);',
				),
				"app/main.ts must unconditionally register only the audited vscode-userdata provider",
			],
			[
				bootstrap.replace(
					"registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);",
					"registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);\nvoid userDataFileSystemProvider;",
				),
				"app/main.ts may use the audited user-data provider only for its declaration and custom-provider registration",
			],
			[
				bootstrap.replace(
					"registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);",
					"registerCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);\nregisterCustomProvider(PLAIN_USER_DATA_SCHEME, userDataFileSystemProvider);",
				),
				"app/main.ts must register exactly three audited custom providers",
			],
		]) {
			expect(validateWorkspaceProviderBootstrap(hostile)).toContain(expected);
		}
	});

	it("forbids inspecting, mutating, aliasing or forwarding the registered workspace provider", () => {
		const registration =
			"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);";
		for (const addition of [
			"(workspaceFileSystemProvider as any).allowsMutationDispatch = true;",
			'(workspaceFileSystemProvider as any)["capabilities"] = 10;',
			"Object.assign(workspaceFileSystemProvider, { capabilities: 10 });",
			"const providerAlias = workspaceFileSystemProvider;",
			"consumeProvider(workspaceFileSystemProvider);",
		]) {
			const hostile = bootstrap.replace(
				registration,
				`${registration}\n${addition}`,
			);
			expect(validateWorkspaceProviderBootstrap(hostile)).toContain(
				"app/main.ts may use the audited workspace provider only for its declaration, delete coordinator and custom-provider registration",
			);
		}
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
			"app/main.ts must unconditionally register only the audited plain-workspace provider",
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
			"bootstrap order must remain createBridge -> user data -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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
		const aliasedCoordinatorImport = bootstrap.replace(
			'import { registerWorkspaceDeleteCoordinator } from "./features/workspace/delete-coordinator";',
			'import { registerWorkspaceDeleteCoordinator as registerDelete } from "./features/workspace/delete-coordinator";',
		);
		expect(
			validateWorkspaceProviderBootstrap(aliasedCoordinatorImport),
		).toContain(
			"app/main.ts must import registerWorkspaceDeleteCoordinator exactly by name from ./features/workspace/delete-coordinator",
		);

		const shadowedFactory = bootstrap.replace(
			"const bridge = createBridge();",
			"function createPlainWorkspaceFileSystemProvider() { return fakeProvider; }\nconst bridge = createBridge();",
		);
		expect(validateWorkspaceProviderBootstrap(shadowedFactory)).toContain(
			"bootstrap must not shadow any audited provider-registration binding",
		);
	});

	it("requires one direct delete coordinator registration and pagehide disposal", () => {
		const missingRegistration = bootstrap.replace(
			`const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  () => getService(INotificationService),
);
`,
			"",
		);
		expect(validateWorkspaceProviderBootstrap(missingRegistration)).toEqual(
			expect.arrayContaining([
				"app/main.ts must register exactly one audited workspace delete coordinator",
				"bootstrap order must remain createBridge -> user data -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
				"app/main.ts must dispose the sole workspace delete coordinator exactly once on pagehide",
			]),
		);

		for (const hostile of [
			bootstrap.replace("  workspaceDeleteCoordinator.dispose();\n", ""),
			bootstrap.replace(
				"  workspaceDeleteCoordinator.dispose();",
				"  workspaceDeleteCoordinator.dispose();\n  workspaceDeleteCoordinator.dispose();",
			),
			bootstrap.replace('"pagehide"', '"beforeunload"'),
			bootstrap.replace(
				"  workspaceDeleteCoordinator.dispose();",
				"  coordinatorAlias.dispose();",
			),
		]) {
			expect(validateWorkspaceProviderBootstrap(hostile)).toContain(
				"app/main.ts must dispose the sole workspace delete coordinator exactly once on pagehide",
			);
		}

		const lateCoordinator = bootstrap
			.replace(
				`const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  () => getService(INotificationService),
);
`,
				"",
			)
			.replace(
				"registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);",
				`registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  () => getService(INotificationService),
);`,
			);
		expect(validateWorkspaceProviderBootstrap(lateCoordinator)).toContain(
			"bootstrap order must remain createBridge -> user data -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
		);
	});

	it("requires the exact deferred notification-service getter as the coordinator's third argument", () => {
		for (const hostile of [
			bootstrap.replace(
				"() => getService(INotificationService)",
				"() => getService(IWorkspaceContextService)",
			),
			bootstrap.replace(
				"() => getService(INotificationService)",
				"await getService(INotificationService)",
			),
			bootstrap.replace(
				"() => getService(INotificationService)",
				"() => Promise.resolve(getService(INotificationService))",
			),
			bootstrap.replace(
				`const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  () => getService(INotificationService),
);`,
				`const notificationServiceGetter = () => getService(INotificationService);
const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
  notificationServiceGetter,
);`,
			),
		]) {
			expect(validateWorkspaceProviderBootstrap(hostile)).toContain(
				"app/main.ts must register exactly one audited workspace delete coordinator",
			);
		}
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
			"bootstrap order must remain createBridge -> user data -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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

// `F120` S0 (`docs/research/2026-07-29-branding-packaging.md`, "5.1 品牌统一"):
// reverse tests for the closed brand-field set `app/main.ts`'s
// `productConfiguration` must expose. `EXPECTED_PRODUCT_CONFIGURATION_FIXTURE`
// mirrors `scripts/plain/boundary-contracts.mjs`'s own (unexported)
// `EXPECTED_PRODUCT_CONFIGURATION` byte-for-byte -- kept as a second,
// independently-typed literal (not an import) so a typo in one file can't
// silently cancel out a matching typo in the other and still pass.
describe("Plain product configuration boundary contract", () => {
	const EXPECTED_PRODUCT_CONFIGURATION_FIXTURE = Object.freeze({
		nameShort: "Plain",
		nameLong: "Plain",
		applicationName: "plain",
		dataFolderName: ".plain",
		sharedDataFolderName: ".plain-shared",
		urlProtocol: "plain",
		reportIssueUrl: "https://github.com/10xChengTu/plain0/issues/new",
		licenseUrl: "https://github.com/10xChengTu/plain0/blob/main/LICENSE.txt",
		serverApplicationName: "plain-server",
	});

	function bootstrapWithProductConfiguration(entries) {
		const body = entries
			.map(([key, value]) => `\t\t\t${key}: ${value},`)
			.join("\n");
		return `
async function bootstrap() {
	await initialize(createServiceOverrides(), container, {
		productConfiguration: {
${body}
		},
		enableWorkspaceTrust: false,
	});
}
`;
	}

	const cleanSource = bootstrapWithProductConfiguration(
		Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
			([key, value]) => [key, JSON.stringify(value)],
		),
	);

	it("reports no violations against the exact audited closed field set", () => {
		expect(validateProductConfigurationBoundary(cleanSource)).toEqual([]);
	});

	it("matches the real, currently-committed app/main.ts with zero violations", () => {
		const mainSource = readFileSync(
			new URL("../../app/main.ts", import.meta.url),
			"utf8",
		);
		expect(validateProductConfigurationBoundary(mainSource)).toEqual([]);
	});

	it("reports a violation when a field is missing entirely", () => {
		const withoutDataFolderName = bootstrapWithProductConfiguration(
			Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE)
				.filter(([key]) => key !== "dataFolderName")
				.map(([key, value]) => [key, JSON.stringify(value)]),
		);
		expect(
			validateProductConfigurationBoundary(withoutDataFolderName),
		).toContain(
			"app/main.ts's productConfiguration is missing the required brand field dataFolderName",
		);
	});

	// The two security-relevant fields (see the module's own
	// EXPECTED_PRODUCT_CONFIGURATION doc comment) get their own explicit
	// reverted-to-Code-OSS reverse tests: this is exactly the regression this
	// contract exists to prevent, not merely a generic "wrong string" case.
	it("reports a violation when dataFolderName is reverted to the Code OSS default", () => {
		const reverted = bootstrapWithProductConfiguration(
			Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
				([key, value]) => [
					key,
					JSON.stringify(key === "dataFolderName" ? ".vscode-oss" : value),
				],
			),
		);
		expect(validateProductConfigurationBoundary(reverted)).toContain(
			'app/main.ts\'s productConfiguration.dataFolderName must be the exact audited literal ".plain"',
		);
	});

	it("reports a violation when urlProtocol is reverted to the Code OSS default", () => {
		const reverted = bootstrapWithProductConfiguration(
			Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
				([key, value]) => [
					key,
					JSON.stringify(key === "urlProtocol" ? "code-oss" : value),
				],
			),
		);
		expect(validateProductConfigurationBoundary(reverted)).toContain(
			'app/main.ts\'s productConfiguration.urlProtocol must be the exact audited literal "plain"',
		);
	});

	it("reports a violation for every field independently reverted to its Code OSS value", () => {
		const codeOssValues = Object.freeze({
			nameShort: "Code - OSS",
			nameLong: "Code - OSS",
			applicationName: "code-oss",
			dataFolderName: ".vscode-oss",
			sharedDataFolderName: ".vscode-oss-shared",
			urlProtocol: "code-oss",
			reportIssueUrl: "https://github.com/microsoft/vscode/issues/new",
			licenseUrl: "https://github.com/microsoft/vscode/blob/main/LICENSE.txt",
			serverApplicationName: "code-server-oss",
		});
		for (const key of Object.keys(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE)) {
			const reverted = bootstrapWithProductConfiguration(
				Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
					([entryKey, value]) => [
						entryKey,
						JSON.stringify(entryKey === key ? codeOssValues[key] : value),
					],
				),
			);
			const failures = validateProductConfigurationBoundary(reverted);
			expect(
				failures,
				`expected a failure when ${key} is reverted to its Code OSS value`,
			).toContain(
				`app/main.ts's productConfiguration.${key} must be the exact audited literal ${JSON.stringify(
					EXPECTED_PRODUCT_CONFIGURATION_FIXTURE[key],
				)}`,
			);
		}
	});

	it("reports a violation when an unaudited field is added", () => {
		const withExtraField = bootstrapWithProductConfiguration([
			...Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
				([key, value]) => [key, JSON.stringify(value)],
			),
			["darwinBundleIdentifier", '"com.visualstudio.code.oss"'],
		]);
		expect(validateProductConfigurationBoundary(withExtraField)).toContain(
			"app/main.ts's productConfiguration must not set an unaudited field (darwinBundleIdentifier) -- F120 S0 fixed the closed brand-field set",
		);
	});

	it("reports a violation when a field is duplicated", () => {
		const duplicated = bootstrapWithProductConfiguration([
			...Object.entries(EXPECTED_PRODUCT_CONFIGURATION_FIXTURE).map(
				([key, value]) => [key, JSON.stringify(value)],
			),
			["nameShort", '"Plain"'],
		]);
		expect(validateProductConfigurationBoundary(duplicated)).toContain(
			"app/main.ts's productConfiguration must not set nameShort more than once",
		);
	});

	it("reports a violation when productConfiguration is missing from the initialize(...) configuration", () => {
		const source = `
async function bootstrap() {
	await initialize(createServiceOverrides(), container, {
		enableWorkspaceTrust: false,
	});
}
`;
		expect(validateProductConfigurationBoundary(source)).toEqual([
			"app/main.ts's initialize(...) configuration must set productConfiguration exactly once",
		]);
	});

	it("reports a violation when initialize(...) is not called with exactly three arguments", () => {
		const source = `
async function bootstrap() {
	await initialize(createServiceOverrides(), container);
}
`;
		expect(validateProductConfigurationBoundary(source)).toEqual([
			"app/main.ts must call the audited three-argument initialize(...) exactly once to configure productConfiguration",
		]);
	});

	it("reports a violation when productConfiguration is not a plain object literal", () => {
		const source = `
async function bootstrap() {
	await initialize(createServiceOverrides(), container, {
		productConfiguration: getProductConfiguration(),
		enableWorkspaceTrust: false,
	});
}
`;
		expect(validateProductConfigurationBoundary(source)).toEqual([
			"app/main.ts's productConfiguration must be a plain object literal",
		]);
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
  remote: State<'_, RemoteSessionService>,
  request: tauri::ipc::Request<'_>,
) -> Result<WorkspaceWriteResult, CommandError> {
  let frame = WorkspaceWriteFileFrame::parse_invoke_body(request.body())?;
  let (root_id, relative_path, expected_version, content) = frame.into_parts();
  service.write_file(window.label(), root_id, relative_path, expected_version, content, remote.inner()).await
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

describe("Plain F070 S1 trust/terminal Rust boundary contracts", () => {
	const terminalCargo = `
[dependencies]
portable-pty = "=0.9.0"
libghostty-vt = "=0.2.1"
`;

	const exactPortablePtyDependency = Object.freeze({
		name: "portable-pty",
		req: "=0.9.0",
		kind: null,
		rename: null,
		target: null,
		optional: false,
	});

	const exactLibghosttyVtDependency = Object.freeze({
		name: "libghostty-vt",
		req: "=0.2.1",
		kind: null,
		rename: null,
		target: null,
		optional: false,
	});

	const terminalModSource = `
pub(crate) const MAX_TERMINAL_SESSIONS_PER_WINDOW: usize = 16;
`;
	const terminalFlowSource = `
pub(crate) const TERMINAL_FLOW_HIGH_WATER_MARK: usize = 100_000;
pub(crate) const TERMINAL_FLOW_LOW_WATER_MARK: usize = 5_000;
`;
	const terminalServiceConstsSource = `
const TERMINAL_CHUNK_QUEUE_CAPACITY: usize = 256;
const TERMINAL_READ_BUFFER_BYTES: usize = 8192;

fn spawn_via_command_builder() {
    let mut command = portable_pty::CommandBuilder::new("test-fixture-program");
    command.args(["--flag", "value"]);
}

fn resolve_cwd(workspace: &WorkspaceService, window_label: &str, root_id: RootId, cwd: Option<String>) -> Result<PathBuf, CommandError> {
    let selected_root = workspace.root_canonical_path(window_label, root_id)?;
    match cwd {
        None => Ok(selected_root),
        Some(candidate) => {
            let candidate = PathBuf::from(candidate);
            if candidate.is_absolute() {
                return Err(terminal_cwd_invalid());
            }
            let canonical = std::fs::canonicalize(selected_root.join(candidate)).map_err(|_| terminal_cwd_invalid())?;
            if canonical == selected_root || canonical.starts_with(&selected_root) {
                Ok(canonical)
            } else {
                Err(terminal_cwd_invalid())
            }
        }
    }
}
`;
	const terminalShellSource = `
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "SSH_AUTH_SOCK"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM: (&str, &str) = ("TERM_PROGRAM", "Plain");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM_VERSION: (&str, &str) = ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
`;
	const terminalVtSource = `
pub(crate) const TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 10_000;
`;

	const baselineTerminalRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/terminal/mod.rs",
			source: terminalModSource,
		},
		{
			relativePath: "src-tauri/src/terminal/flow.rs",
			source: terminalFlowSource,
		},
		{
			relativePath: "src-tauri/src/terminal/service.rs",
			source: terminalServiceConstsSource,
		},
		{
			relativePath: "src-tauri/src/terminal/shell.rs",
			source: terminalShellSource,
		},
		{
			relativePath: "src-tauri/src/terminal/vt.rs",
			source: terminalVtSource,
		},
	]);

	function withHostileTerminalFile(relativePath, source) {
		return [...baselineTerminalRustSources, { relativePath, source }];
	}

	it("passes for a clean terminal domain with the exact pinned dependency", () => {
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toEqual([]);
	});

	it("rejects restoring the implicit first-root terminal cwd fallback", () => {
		const hostile = baselineTerminalRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/terminal/service.rs"
				? {
						...entry,
						source: entry.source.replace(
							"None => Ok(selected_root)",
							"None => Ok(workspace.root_canonical_paths(window_label)?.first().unwrap().1.clone())",
						),
					}
				: entry,
		);
		expect(
			validateTerminalRustBoundary(hostile, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			"terminal/service.rs resolve_cwd must resolve one explicit rootId, default to that root, and reject absolute or escaping cwd values without roots[0] fallback",
		);
	});

	it("requires the exact portable-pty =0.9.0 pin in Cargo.toml and metadata", () => {
		expect(
			validateTerminalRustBoundary(
				baselineTerminalRustSources,
				"[dependencies]\n",
				[exactPortablePtyDependency, exactLibghosttyVtDependency],
			),
		).toContain("Cargo.toml must pin portable-pty to =0.9.0");
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				{ ...exactPortablePtyDependency, req: "0.9" },
			]),
		).toContain(
			"Cargo metadata must contain exactly one unrenamed runtime portable-pty =0.9.0 dependency",
		);
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				{ ...exactPortablePtyDependency, rename: "pty" },
			]),
		).toContain(
			"Cargo metadata must contain exactly one unrenamed runtime portable-pty =0.9.0 dependency",
		);
	});

	it("requires the exact libghostty-vt =0.2.1 pin in Cargo.toml and metadata (F070 VT 集成)", () => {
		expect(
			validateTerminalRustBoundary(
				baselineTerminalRustSources,
				'[dependencies]\nportable-pty = "=0.9.0"\n',
				[exactPortablePtyDependency, exactLibghosttyVtDependency],
			),
		).toContain("Cargo.toml must pin libghostty-vt to =0.2.1");
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				exactPortablePtyDependency,
				{ ...exactLibghosttyVtDependency, req: "0.2" },
			]),
		).toContain(
			"Cargo metadata must contain exactly one unrenamed runtime libghostty-vt =0.2.1 dependency",
		);
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				exactPortablePtyDependency,
				{ ...exactLibghosttyVtDependency, rename: "ghostty_vt" },
			]),
		).toContain(
			"Cargo metadata must contain exactly one unrenamed runtime libghostty-vt =0.2.1 dependency",
		);
	});

	it("rejects a direct spawn-bypass dependency even if portable-pty is also present", () => {
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				exactPortablePtyDependency,
				{ name: "duct", req: "0.13", kind: null, rename: null },
			]),
		).toContain(
			"Cargo metadata must not contain direct spawn-bypass dependency duct, including renamed dependencies",
		);
	});

	it("rejects std::process::Command in a production terminal source file", () => {
		const failures = validateTerminalRustBoundary(
			withHostileTerminalFile(
				"src-tauri/src/terminal/hostile.rs",
				'fn run() {\n    let _ = std::process::Command::new("ls");\n}\n',
			),
			terminalCargo,
			[exactPortablePtyDependency, exactLibghosttyVtDependency],
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					"src-tauri/src/terminal/hostile.rs must not spawn subprocesses via std::process::Command",
				),
			),
		).toBe(true);
	});

	it('rejects a shell "-c" argument in a production terminal source file', () => {
		const failures = validateTerminalRustBoundary(
			withHostileTerminalFile(
				"src-tauri/src/terminal/hostile.rs",
				'fn run(mut command: portable_pty::CommandBuilder) {\n    command.arg("-c");\n}\n',
			),
			terminalCargo,
			[exactPortablePtyDependency, exactLibghosttyVtDependency],
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					'src-tauri/src/terminal/hostile.rs must not pass a shell "-c" argument',
				),
			),
		).toBe(true);
	});

	it('does not flag std::process::Command or "-c" mentioned only in a doc comment', () => {
		const failures = validateTerminalRustBoundary(
			withHostileTerminalFile(
				"src-tauri/src/terminal/documented.rs",
				'//! Never use std::process::Command or .arg("-c") in this domain.\nfn run() {}\n',
			),
			terminalCargo,
			[exactPortablePtyDependency, exactLibghosttyVtDependency],
		);
		expect(failures).toEqual([]);
	});

	it("exempts a tests.rs-suffixed fixture file from the spawn guard", () => {
		const failures = validateTerminalRustBoundary(
			withHostileTerminalFile(
				"src-tauri/src/terminal/service/tests.rs",
				'fn spawn_fixture() {\n    let mut c = portable_pty::CommandBuilder::new("sh");\n    c.args(["-c", "echo hi"]);\n}\n',
			),
			terminalCargo,
			[exactPortablePtyDependency, exactLibghosttyVtDependency],
		);
		expect(failures).toEqual([]);
	});

	it("locks the flow-control/session-limit/queue/buffer budget constants exactly", () => {
		const wrongHighWaterMark = withHostileTerminalFile(
			"src-tauri/src/terminal/flow.rs",
			"pub(crate) const TERMINAL_FLOW_HIGH_WATER_MARK: usize = 50_000;\npub(crate) const TERMINAL_FLOW_LOW_WATER_MARK: usize = 5_000;\n",
		).filter(
			(entry) => entry.relativePath !== "src-tauri/src/terminal/flow.rs",
		);
		wrongHighWaterMark.push({
			relativePath: "src-tauri/src/terminal/flow.rs",
			source:
				"pub(crate) const TERMINAL_FLOW_HIGH_WATER_MARK: usize = 50_000;\npub(crate) const TERMINAL_FLOW_LOW_WATER_MARK: usize = 5_000;\n",
		});
		expect(
			validateTerminalRustBoundary(wrongHighWaterMark, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			"src-tauri/src/terminal/flow.rs must define exactly one TERMINAL_FLOW_HIGH_WATER_MARK: usize = 100000",
		);

		const missingSessionLimit = baselineTerminalRustSources.filter(
			(entry) => entry.relativePath !== "src-tauri/src/terminal/mod.rs",
		);
		expect(
			validateTerminalRustBoundary(missingSessionLimit, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			"terminal budget boundary requires src-tauri/src/terminal/mod.rs",
		);

		// F070 "VT 集成" slice: the scrollback cap is a budget constant of the
		// same kind, locked the same way.
		const wrongScrollbackCap = withHostileTerminalFile(
			"src-tauri/src/terminal/vt.rs",
			"pub(crate) const TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 5_000;\n",
		).filter((entry) => entry.relativePath !== "src-tauri/src/terminal/vt.rs");
		wrongScrollbackCap.push({
			relativePath: "src-tauri/src/terminal/vt.rs",
			source:
				"pub(crate) const TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 5_000;\n",
		});
		expect(
			validateTerminalRustBoundary(wrongScrollbackCap, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			"src-tauri/src/terminal/vt.rs must define exactly one TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 10000",
		);
	});

	it("locks the environment allowlist and fixed terminal identity overrides exactly", () => {
		const widenedAllowlist = baselineTerminalRustSources
			.filter(
				(entry) => entry.relativePath !== "src-tauri/src/terminal/shell.rs",
			)
			.concat({
				relativePath: "src-tauri/src/terminal/shell.rs",
				source: `
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "SSH_AUTH_SOCK", "SECRET_TOKEN"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM: (&str, &str) = ("TERM_PROGRAM", "Plain");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM_VERSION: (&str, &str) = ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
`,
			});
		expect(
			validateTerminalRustBoundary(widenedAllowlist, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			"terminal/shell.rs must define TERMINAL_ENV_PASSTHROUGH_NAMES as exactly the audited name list",
		);

		const wrongTerm = baselineTerminalRustSources
			.filter(
				(entry) => entry.relativePath !== "src-tauri/src/terminal/shell.rs",
			)
			.concat({
				relativePath: "src-tauri/src/terminal/shell.rs",
				source: `
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "SSH_AUTH_SOCK"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "dumb");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM: (&str, &str) = ("TERM_PROGRAM", "Plain");
pub(crate) const TERMINAL_ENV_TERM_PROGRAM_VERSION: (&str, &str) = ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
`,
			});
		expect(
			validateTerminalRustBoundary(wrongTerm, terminalCargo, [
				exactPortablePtyDependency,
				exactLibghosttyVtDependency,
			]),
		).toContain(
			'terminal/shell.rs must define TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color")',
		);
	});

	const trustCommandsSource = readFileSync(
		new URL("../../src-tauri/src/trust/commands.rs", import.meta.url),
		"utf8",
	);
	const terminalCommandsSource = readFileSync(
		new URL("../../src-tauri/src/terminal/commands.rs", import.meta.url),
		"utf8",
	);
	const libSource = readFileSync(
		new URL("../../src-tauri/src/lib.rs", import.meta.url),
		"utf8",
	);

	const baselineCommandRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/trust/commands.rs",
			source: trustCommandsSource,
		},
		{
			relativePath: "src-tauri/src/terminal/commands.rs",
			source: terminalCommandsSource,
		},
		{ relativePath: "src-tauri/src/lib.rs", source: libSource },
	]);

	it("passes for the real, unmodified trust and terminal command files", () => {
		expect(
			validateTrustTerminalCommandRegistration(baselineCommandRustSources),
		).toEqual([]);
	});

	it("fails if a trust command's body is rewired to a different service call", () => {
		const rewired = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/trust/commands.rs"
				? {
						...entry,
						source: entry.source.replace(
							".is_trusted(workspace.inner(), window.label())",
							'.is_trusted(workspace.inner(), "main")',
						),
					}
				: entry,
		);
		expect(validateTrustTerminalCommandRegistration(rewired)).toContain(
			"workspace_trust_state must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if a terminal command is missing from lib.rs's generate_handler", () => {
		const missingRegistration = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"            terminal::commands::terminal_kill,\n",
							"",
						),
					}
				: entry,
		);
		expect(
			validateTrustTerminalCommandRegistration(missingRegistration),
		).toContain(
			"src-tauri/src/lib.rs must register terminal::commands::terminal_kill exactly once in generate_handler",
		);
	});

	it("fails if a command is registered a second time (duplicate registration)", () => {
		const duplicated = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"            terminal::commands::terminal_kill,\n",
							"            terminal::commands::terminal_kill,\n            terminal::commands::terminal_kill,\n",
						),
					}
				: entry,
		);
		expect(validateTrustTerminalCommandRegistration(duplicated)).toContain(
			"src-tauri/src/lib.rs must register terminal::commands::terminal_kill exactly once in generate_handler",
		);
	});
});

describe("Plain native lifecycle command Harness", () => {
	const commands = readFileSync(
		new URL("../../src-tauri/src/lifecycle/commands.rs", import.meta.url),
		"utf8",
	);
	const lib = readFileSync(
		new URL("../../src-tauri/src/lib.rs", import.meta.url),
		"utf8",
	);
	const baseline = Object.freeze([
		{ relativePath: "src-tauri/src/lifecycle/commands.rs", source: commands },
		{ relativePath: "src-tauri/src/lib.rs", source: lib },
	]);

	it("accepts the real close/quit command and event wiring", () => {
		expect(validateLifecycleCommandRegistration(baseline)).toEqual([]);
	});

	it("rejects a close command that bypasses the native window close", () => {
		const bypassed = baseline.map((entry) =>
			entry.relativePath === "src-tauri/src/lifecycle/commands.rs"
				? {
						...entry,
						source: entry.source.replace(
							"request.validate();\n    window.close().map_err(|_| close_failed())",
							"request.validate();\n    Ok(())",
						),
					}
				: entry,
		);
		expect(validateLifecycleCommandRegistration(bypassed)).toContain(
			"lifecycle_request_close must retain its audited one-shot close coordinator route",
		);
	});

	it("rejects missing command registration or an orphaned quit entry point", () => {
		const missing = baseline.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source
							.replace(
								"            lifecycle::commands::lifecycle_request_close,\n",
								"",
							)
							.replace(
								"lifecycle.begin_exit(labels, code.unwrap_or(0), std::time::Instant::now())",
								"ExitDecision::Allow",
							),
					}
				: entry,
		);
		const failures = validateLifecycleCommandRegistration(missing);
		expect(failures).toContain(
			"src-tauri/src/lib.rs must register lifecycle::commands::lifecycle_request_close exactly once in generate_handler",
		);
		expect(failures).toContain(
			"RunEvent::ExitRequested must route through CloseCoordinator::begin_exit",
		);
	});
});

describe("Plain F080 S0 git spawn guard and git2/gix ban Harness", () => {
	const gitCargo = `
[dependencies]
portable-pty = "=0.9.0"
libghostty-vt = "=0.2.1"
`;

	const exactPortablePtyDependency = Object.freeze({
		name: "portable-pty",
		req: "=0.9.0",
		kind: null,
		rename: null,
		target: null,
		optional: false,
	});

	const exactLibghosttyVtDependency = Object.freeze({
		name: "libghostty-vt",
		req: "=0.2.1",
		kind: null,
		rename: null,
		target: null,
		optional: false,
	});

	const baselineDependencies = Object.freeze([
		exactPortablePtyDependency,
		exactLibghosttyVtDependency,
	]);

	// A minimal but complete terminal-domain baseline (identical in spirit
	// to the F070 S1 block's own `baselineTerminalRustSources`, duplicated
	// here rather than shared across `describe` blocks — see
	// `text_search.rs`'s own "small helper duplication over cross-module
	// coupling" precedent for why that trade-off is deliberate elsewhere in
	// this codebase) — every one of `validateTerminalRustBoundary`'s
	// terminal-specific checks (budget constants, env allowlist) must also
	// pass unrelated to the git-domain assertions this block cares about.
	const terminalBaseline = Object.freeze([
		{
			relativePath: "src-tauri/src/terminal/mod.rs",
			source:
				"pub(crate) const MAX_TERMINAL_SESSIONS_PER_WINDOW: usize = 16;\n",
		},
		{
			relativePath: "src-tauri/src/terminal/flow.rs",
			source:
				"pub(crate) const TERMINAL_FLOW_HIGH_WATER_MARK: usize = 100_000;\npub(crate) const TERMINAL_FLOW_LOW_WATER_MARK: usize = 5_000;\n",
		},
		{
			relativePath: "src-tauri/src/terminal/service.rs",
			source:
				'const TERMINAL_CHUNK_QUEUE_CAPACITY: usize = 256;\nconst TERMINAL_READ_BUFFER_BYTES: usize = 8192;\n\nfn spawn_via_command_builder() {\n    let mut command = portable_pty::CommandBuilder::new("test-fixture-program");\n    command.args(["--flag", "value"]);\n}\n\nfn resolve_cwd(workspace: &WorkspaceService, window_label: &str, root_id: RootId, cwd: Option<String>) -> Result<PathBuf, CommandError> {\n    let selected_root = workspace.root_canonical_path(window_label, root_id)?;\n    match cwd {\n        None => Ok(selected_root),\n        Some(candidate) => {\n            let candidate = PathBuf::from(candidate);\n            if candidate.is_absolute() {\n                return Err(terminal_cwd_invalid());\n            }\n            let canonical = std::fs::canonicalize(selected_root.join(candidate)).map_err(|_| terminal_cwd_invalid())?;\n            if canonical == selected_root || canonical.starts_with(&selected_root) {\n                Ok(canonical)\n            } else {\n                Err(terminal_cwd_invalid())\n            }\n        }\n    }\n}\n',
		},
		{
			relativePath: "src-tauri/src/terminal/shell.rs",
			source:
				'pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =\n    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "SSH_AUTH_SOCK"];\npub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";\npub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");\npub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");\npub(crate) const TERMINAL_ENV_TERM_PROGRAM: (&str, &str) = ("TERM_PROGRAM", "Plain");\npub(crate) const TERMINAL_ENV_TERM_PROGRAM_VERSION: (&str, &str) = ("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));\n',
		},
		{
			relativePath: "src-tauri/src/terminal/vt.rs",
			source:
				"pub(crate) const TERMINAL_VT_MAX_SCROLLBACK_LINES: usize = 10_000;\n",
		},
	]);

	// A minimal but "compliant and reasonable" stand-in for the real
	// `src-tauri/src/git/exec.rs`: spawns only `Command::new("git")`, never
	// a shell interpreter.
	const validGitExecSource = `
use std::process::Command;

pub(crate) fn run_git(args: &[String]) {
    let mut command = Command::new("git");
    let mut hardening_args: Vec<String> = Vec::new();
    hardening_args.push("-c".to_owned());
    hardening_args.push("core.fsmonitor=".to_owned());
    command.args(&hardening_args);
    command.args(args);
}
`;

	function baselineGitRustSources(extraGitFiles = []) {
		return [
			...terminalBaseline,
			{ relativePath: "src-tauri/src/git/exec.rs", source: validGitExecSource },
			...extraGitFiles,
		];
	}

	it("passes for a clean git exec wrapper alongside the terminal domain", () => {
		expect(
			validateTerminalRustBoundary(
				baselineGitRustSources(),
				gitCargo,
				baselineDependencies,
			),
		).toEqual([]);
	});

	it("allows exactly src-tauri/src/git/exec.rs to spawn std::process::Command", () => {
		const failures = validateTerminalRustBoundary(
			baselineGitRustSources(),
			gitCargo,
			baselineDependencies,
		);
		expect(
			failures.some((failure) => failure.includes("src-tauri/src/git/exec.rs")),
		).toBe(false);
	});

	it("rejects std::process::Command in any other git domain file, pointing at exec.rs", () => {
		const failures = validateTerminalRustBoundary(
			baselineGitRustSources([
				{
					relativePath: "src-tauri/src/git/discovery.rs",
					source:
						'fn bypass() {\n    let _ = std::process::Command::new("git");\n}\n',
				},
			]),
			gitCargo,
			baselineDependencies,
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					"src-tauri/src/git/discovery.rs must not spawn subprocesses via std::process::Command; use the sole audited src-tauri/src/git/exec.rs wrapper",
				),
			),
		).toBe(true);
	});

	it("still rejects std::process::Command in the terminal domain with the portable_pty message (no regression)", () => {
		const failures = validateTerminalRustBoundary(
			[
				...baselineGitRustSources(),
				{
					relativePath: "src-tauri/src/terminal/hostile.rs",
					source:
						'fn run() {\n    let _ = std::process::Command::new("ls");\n}\n',
				},
			],
			gitCargo,
			baselineDependencies,
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					"src-tauri/src/terminal/hostile.rs must not spawn subprocesses via std::process::Command; use portable_pty::CommandBuilder",
				),
			),
		).toBe(true);
	});

	it('rejects exec.rs if it does not literally invoke Command::new("git")', () => {
		const failures = validateTerminalRustBoundary(
			[
				...terminalBaseline,
				{
					relativePath: "src-tauri/src/git/exec.rs",
					source:
						'use std::process::Command;\n\nfn run_git(program: &str) {\n    let mut command = Command::new(program);\n    command.arg("status");\n}\n',
				},
			],
			gitCargo,
			baselineDependencies,
		);
		expect(failures).toContain(
			'src-tauri/src/git/exec.rs must invoke Command::new("git") literally',
		);
	});

	it("rejects exec.rs if it spawns a shell interpreter", () => {
		const failures = validateTerminalRustBoundary(
			[
				...terminalBaseline,
				{
					relativePath: "src-tauri/src/git/exec.rs",
					source:
						'use std::process::Command;\n\nfn run_git() {\n    let mut command = Command::new("git");\n    let _ = command;\n    let mut shell = Command::new("sh");\n    shell.arg("-c");\n}\n',
				},
			],
			gitCargo,
			baselineDependencies,
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					"src-tauri/src/git/exec.rs must not spawn a shell interpreter",
				),
			),
		).toBe(true);
	});

	it("hostile mutation: a second git file smuggling std::process::Command alongside a compliant exec.rs is still caught", () => {
		const failures = validateTerminalRustBoundary(
			baselineGitRustSources([
				{
					relativePath: "src-tauri/src/git/service.rs",
					source:
						'fn hostile_bypass() {\n    let _ = std::process::Command::new("curl");\n}\n',
				},
			]),
			gitCargo,
			baselineDependencies,
		);
		expect(
			failures.some((failure) =>
				failure.includes(
					"src-tauri/src/git/service.rs must not spawn subprocesses",
				),
			),
		).toBe(true);
		// The compliant exec.rs itself must still be unaffected — no
		// failure whose *subject* (leading path) is exec.rs, though the
		// service.rs failure's own guidance text legitimately mentions
		// exec.rs by name (as the wrapper callers should use instead).
		expect(
			failures.some((failure) =>
				failure.startsWith("src-tauri/src/git/exec.rs "),
			),
		).toBe(false);
	});

	it("a tests.rs-suffixed git fixture is exempt from the spawn guard, exactly like the terminal domain's carve-out", () => {
		const failures = validateTerminalRustBoundary(
			baselineGitRustSources([
				{
					relativePath: "src-tauri/src/git/exec/tests.rs",
					source:
						'fn spawn_fixture() {\n    let _ = std::process::Command::new("git").arg("-c").status();\n}\n',
				},
			]),
			gitCargo,
			baselineDependencies,
		);
		expect(failures).toEqual([]);
	});

	it.each(["git2", "gix", "libgit2-sys"])(
		"rejects the forbidden git library dependency %s, including renamed",
		(dependency) => {
			const failures = validateTerminalRustBoundary(
				baselineGitRustSources(),
				gitCargo,
				[
					...baselineDependencies,
					{ name: dependency, req: "1.0", kind: null, rename: null },
				],
			);
			expect(
				failures.some((failure) =>
					failure.includes(
						`Cargo metadata must not contain forbidden git library dependency ${dependency}, including renamed dependencies`,
					),
				),
			).toBe(true);

			const renamed = validateTerminalRustBoundary(
				baselineGitRustSources(),
				gitCargo,
				[
					...baselineDependencies,
					{ name: dependency, req: "1.0", kind: null, rename: "renamed_away" },
				],
			);
			expect(
				renamed.some((failure) =>
					failure.includes(
						`Cargo metadata must not contain forbidden git library dependency ${dependency}`,
					),
				),
			).toBe(true);
		},
	);

	it("passes when no forbidden git library dependency is present", () => {
		expect(
			validateTerminalRustBoundary(
				baselineGitRustSources(),
				gitCargo,
				baselineDependencies,
			),
		).toEqual([]);
	});

	// `validateWorkspaceMoveBoundary` independently sweeps *every*
	// production Rust file for raw process/shell deletion bypasses (a
	// check that predates the git domain and is unrelated to the spawn
	// guard above) — its regex for `Command::new(`/`std::process` would,
	// without a matching exemption there, also flag the audited git exec
	// wrapper. Locking both sides of that interaction here so a future
	// edit to either check cannot silently reopen it.
	it("does not trip the workspace move/delete boundary's process-bypass check for the audited git exec wrapper", () => {
		const withExecWrapper = [
			...workspaceMoveSources,
			{ relativePath: "src-tauri/src/git/exec.rs", source: validGitExecSource },
		];
		expect(validateWorkspaceMoveBoundary(withExecWrapper)).toEqual([]);
	});

	it("still flags an unaudited git file's raw process/shell spawn via the move/delete boundary check", () => {
		const hostile = [
			...workspaceMoveSources,
			{
				relativePath: "src-tauri/src/git/discovery.rs",
				source:
					'fn bypass() {\n    let _ = std::process::Command::new("rm");\n}\n',
			},
		];
		expect(validateWorkspaceMoveBoundary(hostile)).toContain(
			"src-tauri/src/git/discovery.rs must not use process or shell deletion bypasses",
		);
	});
});

describe("Plain F070 S2 terminal IPC bridge Harness", () => {
	const terminalDtoSource = readFileSync(
		new URL("../../src-tauri/src/terminal/dto.rs", import.meta.url),
		"utf8",
	);
	const terminalCommandsSource = readFileSync(
		new URL("../../src-tauri/src/terminal/commands.rs", import.meta.url),
		"utf8",
	);
	const contractsSource = readFileSync(
		new URL("../../app/platform/tauri/contracts.ts", import.meta.url),
		"utf8",
	);
	const terminalCodecSource = readFileSync(
		new URL("../../app/platform/tauri/terminal-codec.ts", import.meta.url),
		"utf8",
	);
	const nativeSource = readFileSync(
		new URL("../../app/platform/tauri/native.ts", import.meta.url),
		"utf8",
	);

	const baselineBridgeRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/terminal/dto.rs",
			source: terminalDtoSource,
		},
		{
			relativePath: "src-tauri/src/terminal/commands.rs",
			source: terminalCommandsSource,
		},
	]);
	const baselineBridgeAppSources = Object.freeze([
		{
			relativePath: "app/platform/tauri/contracts.ts",
			source: contractsSource,
		},
		{
			relativePath: "app/platform/tauri/terminal-codec.ts",
			source: terminalCodecSource,
		},
		{ relativePath: "app/platform/tauri/native.ts", source: nativeSource },
	]);

	function withMutatedRust(relativePath, mutate) {
		return baselineBridgeRustSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	function withMutatedApp(relativePath, mutate) {
		return baselineBridgeAppSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	it("passes for the real, unmodified terminal IPC bridge files", () => {
		expect(
			validateTerminalIpcBridgeBoundary(
				baselineBridgeRustSources,
				baselineBridgeAppSources,
			),
		).toEqual([]);
	});

	it("fails if terminal_start no longer requires an explicit root identity", () => {
		const widened = withMutatedRust("src-tauri/src/terminal/dto.rs", (source) =>
			source.replace("    root_id: RootId,\n", ""),
		);
		expect(
			validateTerminalIpcBridgeBoundary(widened, baselineBridgeAppSources),
		).toContain(
			"TerminalStartRequest/TerminalStartQuery must require the exact audited rootId/profileId/cwd/geometry fields",
		);
	});

	it("fails if the TypeScript start request stops validating rootId", () => {
		const widened = withMutatedApp(
			"app/platform/tauri/terminal-codec.ts",
			(source) =>
				source.replace(
					"rootId: frozenRootId(rootId),",
					"rootId: rootId as string,",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, widened),
		).toContain(
			"terminal-codec.ts frozenTerminalStartRequest must preserve the exact rootId/profileId/cwd/geometry request shape",
		);
	});

	it("fails if native terminalStart omits rootId from the frozen request", () => {
		const widened = withMutatedApp("app/platform/tauri/native.ts", (source) =>
			source.replace(
				"frozenTerminalStartRequest(\n\t\t\t\trootId,\n\t\t\t\tprofileId,",
				"frozenTerminalStartRequest(\n\t\t\t\tprofileId,",
			),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, widened),
		).toContain(
			"native.ts terminalStart must forward the explicit rootId and profileId through frozenTerminalStartRequest",
		);
	});

	it("fails if TerminalDataEvent gains an extra field", () => {
		const widened = withMutatedRust("src-tauri/src/terminal/dto.rs", (source) =>
			source.replace(
				"pub struct TerminalDataEvent {\n    session_id: TerminalSessionId,\n    sequence: u64,\n    frame: TerminalFrame,\n}",
				"pub struct TerminalDataEvent {\n    session_id: TerminalSessionId,\n    sequence: u64,\n    frame: TerminalFrame,\n    extra: bool,\n}",
			),
		);
		expect(
			validateTerminalIpcBridgeBoundary(widened, baselineBridgeAppSources),
		).toContain(
			"TerminalDataEvent/TerminalExitEvent must expose only their exact audited fields",
		);
	});

	/** `F190` S6: `signal` became an audited, *required* field (real
	 * `portable_pty` signal-termination outcomes are not observable through
	 * `exitCode` alone — see `TerminalExitEvent`'s own doc comment), so the
	 * hostile direction flips relative to the pre-`F190`-S6 shape: this now
	 * proves the check still catches the field being *dropped* (silently
	 * regressing back to the old, signal-blind payload) as well as an
	 * unaudited *extra* field being added. */
	it("fails if TerminalExitEvent's signal field is dropped or an unaudited extra field is added", () => {
		const droppedSignal = withMutatedRust(
			"src-tauri/src/terminal/dto.rs",
			(source) =>
				source.replace(
					"pub struct TerminalExitEvent {\n    session_id: TerminalSessionId,\n    exit_code: u32,\n    signal: Option<String>,\n}",
					"pub struct TerminalExitEvent {\n    session_id: TerminalSessionId,\n    exit_code: u32,\n}",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(
				droppedSignal,
				baselineBridgeAppSources,
			),
		).toContain(
			"TerminalDataEvent/TerminalExitEvent must expose only their exact audited fields",
		);

		const extraField = withMutatedRust(
			"src-tauri/src/terminal/dto.rs",
			(source) =>
				source.replace(
					"pub struct TerminalExitEvent {\n    session_id: TerminalSessionId,\n    exit_code: u32,\n    signal: Option<String>,\n}",
					"pub struct TerminalExitEvent {\n    session_id: TerminalSessionId,\n    exit_code: u32,\n    signal: Option<String>,\n    core_dumped: bool,\n}",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(extraField, baselineBridgeAppSources),
		).toContain(
			"TerminalDataEvent/TerminalExitEvent must expose only their exact audited fields",
		);
	});

	it("fails if either event name const is renamed or its wire string changes", () => {
		const renamed = withMutatedRust(
			"src-tauri/src/terminal/commands.rs",
			(source) =>
				source.replace(
					'pub(crate) const TERMINAL_DATA_EVENT: &str = "plain://terminal-data";',
					'pub(crate) const TERMINAL_DATA_EVENT: &str = "plain://terminal-output";',
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(renamed, baselineBridgeAppSources),
		).toContain(
			'terminal/commands.rs must define TERMINAL_DATA_EVENT = "plain://terminal-data" and TERMINAL_EXIT_EVENT = "plain://terminal-exit"',
		);
	});

	it("fails if WindowEmitSink::emit_frame stops targeting the session's own window or double-emits", () => {
		const wrongTarget = withMutatedRust(
			"src-tauri/src/terminal/commands.rs",
			(source) =>
				source.replace(
					"EventTarget::webview_window(self.window_label.clone()),\n            TERMINAL_DATA_EVENT,",
					"EventTarget::any(),\n            TERMINAL_DATA_EVENT,",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(wrongTarget, baselineBridgeAppSources),
		).toContain(
			"WindowEmitSink::emit_frame must emit_to exactly one window-targeted TerminalDataEvent built from the frame it was given",
		);

		const doubleEmit = withMutatedRust(
			"src-tauri/src/terminal/commands.rs",
			(source) =>
				source.replace(
					"TerminalDataEvent::new(session_id, sequence, frame),\n        );\n    }",
					"TerminalDataEvent::new(session_id, sequence, frame),\n        );\n        let _ = self.app.emit_to(\n            EventTarget::webview_window(self.window_label.clone()),\n            TERMINAL_DATA_EVENT,\n            TerminalDataEvent::new(session_id, sequence, frame),\n        );\n    }",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(doubleEmit, baselineBridgeAppSources),
		).toContain(
			"WindowEmitSink::emit_frame must emit_to exactly one window-targeted TerminalDataEvent built from the frame it was given",
		);
	});

	it("fails if WindowEmitSink::emit_exit is rewired to a bare .emit() or drops the status it was given", () => {
		const bareEmit = withMutatedRust(
			"src-tauri/src/terminal/commands.rs",
			(source) =>
				source.replace(
					"let _ = self.app.emit_to(\n            EventTarget::webview_window(self.window_label.clone()),\n            TERMINAL_EXIT_EVENT,\n            TerminalExitEvent::new(session_id, status),\n        );",
					'let _ = self.app.emit("terminal-exit-fallback", ());\n        let _ = self.app.emit_to(\n            EventTarget::webview_window(self.window_label.clone()),\n            TERMINAL_EXIT_EVENT,\n            TerminalExitEvent::new(session_id, status),\n        );',
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(bareEmit, baselineBridgeAppSources),
		).toContain(
			"WindowEmitSink::emit_exit must emit_to exactly one window-targeted TerminalExitEvent built from the status it was given",
		);

		const droppedStatus = withMutatedRust(
			"src-tauri/src/terminal/commands.rs",
			(source) =>
				source.replace(
					"TerminalExitEvent::new(session_id, status),",
					"TerminalExitEvent::new(session_id, TerminalExitStatus { exit_code: 0, signal: None }),",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(
				droppedStatus,
				baselineBridgeAppSources,
			),
		).toContain(
			"WindowEmitSink::emit_exit must emit_to exactly one window-targeted TerminalExitEvent built from the status it was given",
		);
	});

	it("fails if contracts.ts's event consts are missing or the wire string drifts", () => {
		const mutated = withMutatedApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					'export const TERMINAL_EXIT_EVENT = "plain://terminal-exit" as const;',
					'export const TERMINAL_EXIT_EVENT = "plain://terminal-quit" as const;',
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, mutated),
		).toContain(
			"contracts.ts must declare the exact TERMINAL_DATA_EVENT/TERMINAL_EXIT_EVENT wire strings",
		);
	});

	it("fails if PlainBridge loses a terminal/trust method", () => {
		const mutated = withMutatedApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tterminalKill(sessionId: string, immediate: boolean): Promise<void>;\n",
					"",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, mutated),
		).toContain(
			"PlainBridge must expose exactly the sixteen audited terminal/trust methods, no more and no fewer",
		);
	});

	it("fails if PlainBridge gains an extra terminal-shaped method beyond the audited sixteen", () => {
		const mutated = withMutatedApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tterminalKill(sessionId: string, immediate: boolean): Promise<void>;\n",
					"\tterminalKill(sessionId: string, immediate: boolean): Promise<void>;\n\tterminalDestroy(sessionId: string): Promise<void>;\n",
				),
		);
		// `terminalDestroy` is outside the audited name list, so the filtered
		// member count still equals sixteen — this mutation is only observable
		// because it does not change any *audited* name's presence, proving
		// the check keys on the fixed name list rather than merely counting
		// terminal-prefixed members. Assert the passing baseline is
		// unaffected by an unrelated addition, then assert a genuine surface
		// change (a rename) is caught.
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, mutated),
		).toEqual([]);

		const renamed = withMutatedApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tterminalKill(sessionId: string, immediate: boolean): Promise<void>;\n",
					"\tterminalTerminate(sessionId: string, immediate: boolean): Promise<void>;\n",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, renamed),
		).toContain(
			"PlainBridge must expose exactly the sixteen audited terminal/trust methods, no more and no fewer",
		);
	});

	it("fails if a terminal event decoder drops its own-data/Proxy/freeze checks", () => {
		const noFreeze = withMutatedApp(
			"app/platform/tauri/terminal-codec.ts",
			(source) =>
				source.replace(
					"\treturn Object.freeze({\n\t\tsessionId: value.sessionId,\n\t\tsequence: value.sequence,\n\t\tframe,\n\t});",
					"\treturn {\n\t\tsessionId: value.sessionId,\n\t\tsequence: value.sequence,\n\t\tframe,\n\t};",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(baselineBridgeRustSources, noFreeze),
		).toContain(
			"terminal-codec.ts's decodeTerminalDataEvent must validate exact own-data keys, reject Proxy wrapping, and freeze its result",
		);
	});

	it("fails if native.ts stops listening for one of the terminal events, or decodes through the wrong function", () => {
		const missingListener = withMutatedApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					/terminalWatchExit: \(listener\) => \{[\s\S]*?\n\t\t\},\n/,
					"",
				),
		);
		expect(
			validateTerminalIpcBridgeBoundary(
				baselineBridgeRustSources,
				missingListener,
			),
		).toContain(
			"native.ts must listen for TERMINAL_DATA_EVENT/TERMINAL_EXIT_EVENT exactly once each, decoded through the audited decoders",
		);
	});
});

describe("Plain F080 S1 git command registration Harness", () => {
	const gitCommandsSource = readFileSync(
		new URL("../../src-tauri/src/git/commands.rs", import.meta.url),
		"utf8",
	);
	const libSourceForGit = readFileSync(
		new URL("../../src-tauri/src/lib.rs", import.meta.url),
		"utf8",
	);

	const baselineGitCommandRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/commands.rs",
			source: gitCommandsSource,
		},
		{ relativePath: "src-tauri/src/lib.rs", source: libSourceForGit },
	]);

	function withMutatedGitCommandSource(relativePath, mutate) {
		return baselineGitCommandRustSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	it("passes for the real, unmodified git command files", () => {
		expect(
			validateGitCommandRegistration(baselineGitCommandRustSources),
		).toEqual([]);
	});

	it("fails if git_status's body is rewired to a different service call", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"status::git_status(trust.inner(), &scope, window.label())",
					'status::git_status(trust.inner(), &scope, "main")',
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_status must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if a Git command drops its explicit root identity", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) => source.replace("    root_id: RootId,\n", ""),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_status must accept its audited parameters and return the audited Result type",
		);
	});

	it("fails if a Git command bypasses SelectedGitRoot", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"    let scope = SelectedGitRoot::new(workspace.inner(), root_id);\n    let result = status::git_status(trust.inner(), &scope, window.label()).await?;",
					"    let result = status::git_status(trust.inner(), workspace.inner(), window.label()).await?;",
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_status must construct exactly one immutable SelectedGitRoot from its audited workspace/root_id pair",
		);
	});

	it("fails if git_diff_files loses its request.into_parts() cached wiring", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"let cached = request.into_parts();",
					"let cached = true;",
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_diff_files must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if git_show_blob is missing from lib.rs's generate_handler", () => {
		const missingRegistration = withMutatedGitCommandSource(
			"src-tauri/src/lib.rs",
			(source) =>
				source.replace("            git::commands::git_show_blob,\n", ""),
		);
		expect(validateGitCommandRegistration(missingRegistration)).toContain(
			"generate_handler! must register git::commands::git_show_blob exactly once",
		);
	});

	it("fails if the history cancel command is missing from generate_handler", () => {
		const missingRegistration = withMutatedGitCommandSource(
			"src-tauri/src/lib.rs",
			(source) =>
				source.replace("            git::commands::git_history_cancel,\n", ""),
		);
		expect(validateGitCommandRegistration(missingRegistration)).toContain(
			"generate_handler! must register git::commands::git_history_cancel exactly once",
		);
	});

	it("fails if git_reset ignores the DTO-selected reset mode", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"        window.label(),\n        operation,\n        &target_sha,\n        &preview_token,",
					"        window.label(),\n        HistoryOperation::ResetHard,\n        &target_sha,\n        &preview_token,",
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_reset must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if a git command file is missing entirely", () => {
		const missingFile = baselineGitCommandRustSources.filter(
			(entry) => entry.relativePath !== "src-tauri/src/git/commands.rs",
		);
		expect(validateGitCommandRegistration(missingFile)).toContain(
			"command registration boundary requires src-tauri/src/git/commands.rs",
		);
	});

	it("fails if git_commit's body is rewired to skip amend", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"let (message, amend) = request.into_parts()?;",
					"let (message, _amend) = request.into_parts()?;\n    let amend = false;",
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_commit must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if git_stage_blob is missing from lib.rs's generate_handler", () => {
		const missingRegistration = withMutatedGitCommandSource(
			"src-tauri/src/lib.rs",
			(source) =>
				source.replace("            git::commands::git_stage_blob,\n", ""),
		);
		expect(validateGitCommandRegistration(missingRegistration)).toContain(
			"generate_handler! must register git::commands::git_stage_blob exactly once",
		);
	});

	it("fails if git_discard_paths is missing from lib.rs's generate_handler", () => {
		const missingRegistration = withMutatedGitCommandSource(
			"src-tauri/src/lib.rs",
			(source) =>
				source.replace("            git::commands::git_discard_paths,\n", ""),
		);
		expect(validateGitCommandRegistration(missingRegistration)).toContain(
			"generate_handler! must register git::commands::git_discard_paths exactly once",
		);
	});

	it("fails if git_log_graph's body is rewired to skip the max_count validation", () => {
		const rewired = withMutatedGitCommandSource(
			"src-tauri/src/git/commands.rs",
			(source) =>
				source.replace(
					"let max_count = request.into_parts()?;",
					"let max_count = 100;",
				),
		);
		expect(validateGitCommandRegistration(rewired)).toContain(
			"git_log_graph must contain only its audited DTO decode and single service route",
		);
	});

	it("fails if git_refs_list is missing from lib.rs's generate_handler", () => {
		const missingRegistration = withMutatedGitCommandSource(
			"src-tauri/src/lib.rs",
			(source) =>
				source.replace("            git::commands::git_refs_list,\n", ""),
		);
		expect(validateGitCommandRegistration(missingRegistration)).toContain(
			"generate_handler! must register git::commands::git_refs_list exactly once",
		);
	});
});

describe("Plain F080 S1+S3 git Rust args/DTO boundary Harness", () => {
	const gitStatusSource = readFileSync(
		new URL("../../src-tauri/src/git/status.rs", import.meta.url),
		"utf8",
	);
	const gitDiffSource = readFileSync(
		new URL("../../src-tauri/src/git/diff.rs", import.meta.url),
		"utf8",
	);
	const gitDtoSource = readFileSync(
		new URL("../../src-tauri/src/git/dto.rs", import.meta.url),
		"utf8",
	);
	const gitCommitSource = readFileSync(
		new URL("../../src-tauri/src/git/commit.rs", import.meta.url),
		"utf8",
	);
	const gitDiscardSource = readFileSync(
		new URL("../../src-tauri/src/git/discard.rs", import.meta.url),
		"utf8",
	);
	const gitNetworkSource = readFileSync(
		new URL("../../src-tauri/src/git/network.rs", import.meta.url),
		"utf8",
	);
	const gitExecSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/exec.rs", import.meta.url),
		"utf8",
	);
	const gitLogSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/log.rs", import.meta.url),
		"utf8",
	);
	const gitShowCommitSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/show_commit.rs", import.meta.url),
		"utf8",
	);
	const gitStashSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/stash.rs", import.meta.url),
		"utf8",
	);
	const gitWorktreeSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/worktree.rs", import.meta.url),
		"utf8",
	);
	const gitRemoteSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/remote.rs", import.meta.url),
		"utf8",
	);
	const gitReflogSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/reflog.rs", import.meta.url),
		"utf8",
	);
	const gitContributorsSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/contributors.rs", import.meta.url),
		"utf8",
	);
	const gitManagementSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/management.rs", import.meta.url),
		"utf8",
	);
	const gitHistoryOperationSourceForRustBoundary = readFileSync(
		new URL("../../src-tauri/src/git/history_operation.rs", import.meta.url),
		"utf8",
	);

	const baselineGitRustSources = Object.freeze([
		{ relativePath: "src-tauri/src/git/status.rs", source: gitStatusSource },
		{ relativePath: "src-tauri/src/git/diff.rs", source: gitDiffSource },
		{ relativePath: "src-tauri/src/git/dto.rs", source: gitDtoSource },
		{ relativePath: "src-tauri/src/git/commit.rs", source: gitCommitSource },
		{ relativePath: "src-tauri/src/git/discard.rs", source: gitDiscardSource },
		{ relativePath: "src-tauri/src/git/network.rs", source: gitNetworkSource },
		{
			relativePath: "src-tauri/src/git/exec.rs",
			source: gitExecSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/log.rs",
			source: gitLogSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/show_commit.rs",
			source: gitShowCommitSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/stash.rs",
			source: gitStashSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/worktree.rs",
			source: gitWorktreeSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/remote.rs",
			source: gitRemoteSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/reflog.rs",
			source: gitReflogSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/contributors.rs",
			source: gitContributorsSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/management.rs",
			source: gitManagementSourceForRustBoundary,
		},
		{
			relativePath: "src-tauri/src/git/history_operation.rs",
			source: gitHistoryOperationSourceForRustBoundary,
		},
	]);

	function withMutatedGitRustSource(relativePath, mutate) {
		return baselineGitRustSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	it("passes for the real, unmodified git status/diff/dto files", () => {
		expect(validateGitRustBoundary(baselineGitRustSources)).toEqual([]);
	});

	it("fails if GIT_STATUS_ARGS drops --ignored", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/status.rs",
			(source) => source.replace('"--ignored"', '"--ignored-typo"'),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"status.rs must define GIT_STATUS_ARGS as exactly the audited status argument list",
		);
	});

	it("fails if GIT_DIFF_BASE_ARGS drops the -M rename-detection flag", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/diff.rs",
			(source) => source.replace('"-M",', ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"diff.rs must define GIT_DIFF_BASE_ARGS as exactly the audited diff argument list",
		);
	});

	it("fails if GIT_SHOW_BASE_ARGS drops --no-textconv", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/diff.rs",
			(source) => source.replace('"--no-textconv", ', ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"diff.rs must define GIT_SHOW_BASE_ARGS as exactly the audited show argument list",
		);
	});

	it("fails if GitSubmoduleStateWire gains an extra field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"untracked_changed: bool,\n}",
					"untracked_changed: bool,\n    extra_flag: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitSubmoduleStateWire must expose only its exact audited four boolean fields",
		);
	});

	it("fails if GitStatusEntryWire loses the Ignored variant", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) => source.replace(/,\s*Ignored\s*\{\s*path:\s*String,\s*\}/, ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitStatusEntryWire must expose exactly its five audited variants with their exact fields",
		);
	});

	it("fails if GitDiffFileEntryWire's binary field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) => source.replace("binary: bool,\n}", "is_binary: bool,\n}"),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitDiffFileEntryWire must expose only its exact audited fields",
		);
	});

	it("fails if dto.rs is missing entirely", () => {
		const missingDto = baselineGitRustSources.filter(
			(entry) => entry.relativePath !== "src-tauri/src/git/dto.rs",
		);
		expect(validateGitRustBoundary(missingDto)).toContain(
			"git boundary requires dto.rs",
		);
	});

	it("fails if GIT_COMMIT_ARGS drops user.useConfigOnly=true", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/commit.rs",
			(source) => source.replace('"user.useConfigOnly=true",', ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"commit.rs must define GIT_COMMIT_ARGS as exactly the audited commit argument list",
		);
	});

	it("fails if GIT_DISCARD_ARGS drops -q", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/discard.rs",
			(source) => source.replace('"checkout", "-q"', '"checkout"'),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"discard.rs must define GIT_DISCARD_ARGS as exactly the audited discard argument list",
		);
	});

	it("fails if GitStagePathsRequest gains an extra field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitStagePathsRequest {\n    paths: Vec<String>,\n}",
					"pub struct GitStagePathsRequest {\n    paths: Vec<String>,\n    extra: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitStagePathsRequest/GitUnstagePathsRequest/GitDiscardPathsRequest must expose only their exact audited paths field",
		);
	});

	it("fails if GitStageBlobRequest's content field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitStageBlobRequest {\n    path: String,\n    content: Vec<u8>,\n}",
					"pub struct GitStageBlobRequest {\n    path: String,\n    bytes: Vec<u8>,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitStageBlobRequest must expose only its exact audited path/content fields",
		);
	});

	it("fails if GitCommitRequest's amend field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitCommitRequest {\n    message: String,\n    amend: bool,\n}",
					"pub struct GitCommitRequest {\n    message: String,\n    is_amend: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitCommitRequest must expose only its exact audited message/amend fields",
		);
	});

	it("fails if commit.rs is missing entirely", () => {
		const missingCommit = baselineGitRustSources.filter(
			(entry) => entry.relativePath !== "src-tauri/src/git/commit.rs",
		);
		expect(validateGitRustBoundary(missingCommit)).toContain(
			"git boundary requires commit.rs and discard.rs",
		);
	});

	it("fails if GitNetworkPreviewRequest gains an extra field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitNetworkPreviewRequest {\n    operation: GitNetworkOperationWire,\n}",
					"pub struct GitNetworkPreviewRequest {\n    operation: GitNetworkOperationWire,\n    extra: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitNetworkPreviewRequest must expose only its exact audited operation field",
		);
	});

	it("fails if GitNetworkPreviewResult's behind field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitNetworkPreviewResult {\n    upstream: Option<String>,\n    ahead: Option<u64>,\n    behind: Option<u64>,\n}",
					"pub struct GitNetworkPreviewResult {\n    upstream: Option<String>,\n    ahead: Option<u64>,\n    remaining: Option<u64>,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitNetworkPreviewResult must expose only its exact audited upstream/ahead/behind fields",
		);
	});

	it("fails if GitNetworkOperationWire loses the Push variant", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub enum GitNetworkOperationWire {\n    Fetch,\n    Pull,\n    Push,\n}",
					"pub enum GitNetworkOperationWire {\n    Fetch,\n    Pull,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitNetworkOperationWire must expose exactly its three audited Fetch/Pull/Push variants",
		);
	});

	it("fails if GitFetchRequest gains a field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitFetchRequest {}",
					"pub struct GitFetchRequest {\n    remote: String,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitFetchRequest/GitPullRequest must remain empty structs",
		);
	});

	it("fails if GitPushRequest's force field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitPushRequest {\n    force: bool,\n}",
					"pub struct GitPushRequest {\n    isForce: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitPushRequest must expose only its exact audited force field",
		);
	});

	it("fails if GitNetworkCancelRequest gains a field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitNetworkCancelRequest {}",
					"pub struct GitNetworkCancelRequest {\n    force: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitNetworkCancelRequest must remain an empty struct",
		);
	});

	it("fails if GIT_FETCH_ARGS drops --quiet", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/network.rs",
			(source) =>
				source.replace(
					'pub(crate) const GIT_FETCH_ARGS: &[&str] = &["fetch", "--quiet"];',
					'pub(crate) const GIT_FETCH_ARGS: &[&str] = &["fetch"];',
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"network.rs must define GIT_FETCH_ARGS as exactly the audited fetch argument list",
		);
	});

	it("fails if GIT_PULL_ARGS gains an unaudited reconcile-strategy flag", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/network.rs",
			(source) =>
				source.replace(
					'pub(crate) const GIT_PULL_ARGS: &[&str] = &["pull", "--quiet"];',
					'pub(crate) const GIT_PULL_ARGS: &[&str] = &["pull", "--quiet", "--no-rebase"];',
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"network.rs must define GIT_PULL_ARGS as exactly the audited pull argument list",
		);
	});

	it("fails if GIT_PUSH_ARGS gains an unaudited flag", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/network.rs",
			(source) =>
				source.replace(
					'pub(crate) const GIT_PUSH_ARGS: &[&str] = &["push", "--quiet"];',
					'pub(crate) const GIT_PUSH_ARGS: &[&str] = &["push", "--quiet", "--force"];',
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"network.rs must define GIT_PUSH_ARGS as exactly the audited push argument list",
		);
	});

	it("fails if GIT_PUSH_FORCE_ARGS uses bare --force instead of --force-with-lease", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/network.rs",
			(source) => source.replace('"--force-with-lease"', '"--force"'),
		);
		const failures = validateGitRustBoundary(mutated);
		expect(failures).toContain(
			"network.rs must define GIT_PUSH_FORCE_ARGS as exactly the audited force-with-lease argument list (never bare --force)",
		);
		expect(failures).toContain(
			"src-tauri/src/git/network.rs must never pass a bare --force argument to git push — only --force-with-lease",
		);
	});

	it("fails if a second, bare --force literal is smuggled in anywhere in network.rs", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/network.rs",
			(source) =>
				`${source}\npub(crate) const GIT_HOSTILE_FORCE_ARGS: &[&str] = &["push", "--force"];\n`,
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"src-tauri/src/git/network.rs must never pass a bare --force argument to git push — only --force-with-lease",
		);
	});

	// Post-review fix: the bare-`--force` scan was previously scoped only to
	// `network.rs`'s own source (`executableNetwork`), not the whole git
	// Rust domain, despite the evidence text this Harness backs originally
	// claiming domain-wide coverage. Broadened to scan every git-domain
	// source file (confirmed empirically zero false positives: no other
	// file under `src-tauri/src/git/` contains the literal quoted string
	// `"--force"` at all) — this test proves a bare `--force` literal
	// smuggled into a *different* git-domain file (not `network.rs`) is now
	// also caught, which the pre-fix, network.rs-only scan could not do.
	it("fails if a bare --force literal is smuggled into a different git-domain file entirely", () => {
		const mutated = [
			...baselineGitRustSources,
			{
				relativePath: "src-tauri/src/git/stage.rs",
				source:
					'pub(crate) const GIT_HOSTILE_FORCE_ARGS: &[&str] = &["push", "--force"];',
			},
		];
		expect(validateGitRustBoundary(mutated)).toContain(
			"src-tauri/src/git/stage.rs must never pass a bare --force argument to git push — only --force-with-lease",
		);
	});

	it("fails if GIT_NETWORK_ENV_PASSTHROUGH_NAMES gains an unaudited variable", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/exec.rs",
			(source) =>
				source.replace(
					'pub(crate) const GIT_NETWORK_ENV_PASSTHROUGH_NAMES: &[&str] = &["PATH", "HOME", "SSH_AUTH_SOCK"];',
					'pub(crate) const GIT_NETWORK_ENV_PASSTHROUGH_NAMES: &[&str] = &["PATH", "HOME", "SSH_AUTH_SOCK", "SSH_AGENT_PID"];',
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"exec.rs must define GIT_NETWORK_ENV_PASSTHROUGH_NAMES as exactly PATH/HOME/SSH_AUTH_SOCK",
		);
	});

	it("fails if network.rs or exec.rs is missing entirely", () => {
		const missingNetwork = baselineGitRustSources.filter(
			(entry) =>
				entry.relativePath !== "src-tauri/src/git/network.rs" &&
				entry.relativePath !== "src-tauri/src/git/exec.rs",
		);
		expect(validateGitRustBoundary(missingNetwork)).toContain(
			"git boundary requires network.rs and exec.rs",
		);
	});

	// Post-review fix: GIT_LITERAL_PATHSPECS=1 must live exactly once,
	// unconditionally, inside apply_universal_hardening — never removed,
	// duplicated, or narrowed into a single GitExecMode's own harden_*
	// function. Each mutation below targets a different way that guarantee
	// could silently erode.
	describe("GIT_LITERAL_PATHSPECS universal-hardening lock", () => {
		it("fails if GIT_LITERAL_PATHSPECS is removed entirely", () => {
			const mutated = withMutatedGitRustSource(
				"src-tauri/src/git/exec.rs",
				(source) =>
					source.replace(
						'    command.env("GIT_LITERAL_PATHSPECS", "1");\n',
						"",
					),
			);
			expect(validateGitRustBoundary(mutated)).toContain(
				"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
					"apply_universal_hardening, and build_git_command must call it before " +
					"dispatching on GitExecMode — never duplicated or narrowed into a single " +
					"GitExecMode's own harden_* function",
			);
		});

		it("fails if GIT_LITERAL_PATHSPECS is narrowed into only harden_write, removed from apply_universal_hardening", () => {
			const mutated = withMutatedGitRustSource(
				"src-tauri/src/git/exec.rs",
				(source) =>
					source
						.replace(
							'fn apply_universal_hardening(command: &mut Command) {\n    command.env("GIT_LITERAL_PATHSPECS", "1");\n}',
							"fn apply_universal_hardening(command: &mut Command) {}",
						)
						.replace(
							"fn harden_write(command: &mut Command) {",
							'fn harden_write(command: &mut Command) {\n    command.env("GIT_LITERAL_PATHSPECS", "1");',
						),
			);
			expect(validateGitRustBoundary(mutated)).toContain(
				"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
					"apply_universal_hardening, and build_git_command must call it before " +
					"dispatching on GitExecMode — never duplicated or narrowed into a single " +
					"GitExecMode's own harden_* function",
			);
		});

		it("fails if GIT_LITERAL_PATHSPECS is duplicated into harden_write alongside apply_universal_hardening", () => {
			const mutated = withMutatedGitRustSource(
				"src-tauri/src/git/exec.rs",
				(source) =>
					source.replace(
						"fn harden_write(command: &mut Command) {",
						'fn harden_write(command: &mut Command) {\n    command.env("GIT_LITERAL_PATHSPECS", "1");',
					),
			);
			expect(validateGitRustBoundary(mutated)).toContain(
				"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
					"apply_universal_hardening, and build_git_command must call it before " +
					"dispatching on GitExecMode — never duplicated or narrowed into a single " +
					"GitExecMode's own harden_* function",
			);
		});

		it("fails if build_git_command's call to apply_universal_hardening is removed", () => {
			const mutated = withMutatedGitRustSource(
				"src-tauri/src/git/exec.rs",
				(source) =>
					source.replace(
						"    apply_universal_hardening(&mut command);\n\n    match mode {",
						"    match mode {",
					),
			);
			expect(validateGitRustBoundary(mutated)).toContain(
				"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
					"apply_universal_hardening, and build_git_command must call it before " +
					"dispatching on GitExecMode — never duplicated or narrowed into a single " +
					"GitExecMode's own harden_* function",
			);
		});

		it("fails if build_git_command calls apply_universal_hardening only after the match dispatch", () => {
			const mutated = withMutatedGitRustSource(
				"src-tauri/src/git/exec.rs",
				(source) =>
					source
						.replace(
							"    apply_universal_hardening(&mut command);\n\n    match mode {",
							"    match mode {",
						)
						.replace(
							"    command.args(args);\n    Ok(command)\n}",
							"    apply_universal_hardening(&mut command);\n    command.args(args);\n    Ok(command)\n}",
						),
			);
			expect(validateGitRustBoundary(mutated)).toContain(
				"exec.rs must set GIT_LITERAL_PATHSPECS=1 exactly once, unconditionally, inside " +
					"apply_universal_hardening, and build_git_command must call it before " +
					"dispatching on GitExecMode — never duplicated or narrowed into a single " +
					"GitExecMode's own harden_* function",
			);
		});
	});

	// --- F090 S3: graph (`git::log::log_graph`) + refs (`git::refs`) DTOs ---

	it("fails if GitLogGraphRequest gains an extra field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitLogGraphRequest {\n    max_count: u32,\n}",
					"pub struct GitLogGraphRequest {\n    max_count: u32,\n    extra_flag: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitLogGraphRequest/GitGraphNodeWire/GitLogGraphResultWire must expose only their exact audited fields",
		);
	});

	it("fails if GitGraphNodeWire loses its parents field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"    sha: String,\n    parents: Vec<String>,\n    subject: String,\n}",
					"    sha: String,\n    subject: String,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitLogGraphRequest/GitGraphNodeWire/GitLogGraphResultWire must expose only their exact audited fields",
		);
	});

	it("fails if GitRefsListRequest gains a field, no longer remaining an empty struct", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitRefsListRequest {}",
					"pub struct GitRefsListRequest {\n    max_count: u32,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitRefsListRequest must remain an empty struct",
		);
	});

	it("fails if GitRefKindWire loses the RemoteBranch variant", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) => source.replace("    RemoteBranch,\n", ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitRefKindWire must expose exactly its three audited Branch/RemoteBranch/Tag variants",
		);
	});

	it("fails if GitRefEntryWire's upstream field is renamed", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"    upstream: Option<String>,\n    is_head: bool,\n}",
					"    tracking_ref: Option<String>,\n    is_head: bool,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"GitRefEntryWire/GitRefsListResultWire must expose only their exact audited fields",
		);
	});

	it("fails if the remote inventory loses its NUL config mode", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/remote.rs",
			(source) => source.replace('    "-z",\n', ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"remote.rs must use only the audited remote-name and NUL config inventory commands",
		);
	});

	it("fails if reflog parsing widens the final absorbing field split", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/reflog.rs",
			(source) =>
				source.replace(
					"record.splitn(4, |byte| *byte == 0x1f)",
					"record.split(|byte| *byte == 0x1f)",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"parse_reflog must use bounded splitn(4) so the final free-text summary absorbs embedded separators",
		);
	});

	it("fails if contributor output stops using NUL-paired name/email fields", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/contributors.rs",
			(source) => source.replace("%aN%x00%aE", "%aN%x1f%aE"),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"contributors.rs must use the audited NUL-paired mailmap-aware author format",
		);
	});

	it("fails if a Git management write loses its option terminator", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/management.rs",
			(source) =>
				source.replace(
					'&["branch", "--no-track", "--"]',
					'&["branch", "--no-track"]',
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"management.rs must retain the audited option-terminated branch/tag/remote argv constants and inline upstream option",
		);
	});

	it("fails if an annotated tag message moves from stdin into argv", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/management.rs",
			(source) => source.replace("run_git_with_stdin(", "run_git("),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"management.rs must revalidate namespace refs/exact commits, send annotated messages over stdin, and bound control-free remote URLs",
		);
	});

	it("fails if Git management stops rejecting control characters", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/management.rs",
			(source) =>
				source.replace("        || value.chars().any(char::is_control)\n", ""),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"management.rs must revalidate namespace refs/exact commits, send annotated messages over stdin, and bound control-free remote URLs",
		);
	});

	it("fails if a Git management request DTO gains a generic argv field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitRemoteAddRequest {\n    name: String,\n    url: String,\n}",
					"pub struct GitRemoteAddRequest {\n    name: String,\n    url: String,\n    args: Vec<String>,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"F180 management request/outcome DTOs must expose only their exact audited fields and variants",
		);
	});

	it("fails if history preview stops hashing the tracked worktree diff", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/history_operation.rs",
			(source) =>
				source.replace(
					"    digest.update(worktree_diff);\n",
					"    let _ = worktree_diff;\n",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"history operations must consume a full-diff preview token, serialize per root/window, bind cancellation, reread outcome state, and verify Continue/Abort kind",
		);
	});

	it("fails if history mutation no longer consumes the recomputed preview token", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/history_operation.rs",
			(source) =>
				source.replace(
					"        if current.preview_token != expected_preview_token {",
					"        if false {",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"history operations must consume a full-diff preview token, serialize per root/window, bind cancellation, reread outcome state, and verify Continue/Abort kind",
		);
	});

	it("fails if history Continue stops verifying the current sequencer kind", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/history_operation.rs",
			(source) =>
				source.replace(
					"        if actual != expected_kind {",
					"        if false {",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"history operations must consume a full-diff preview token, serialize per root/window, bind cancellation, reread outcome state, and verify Continue/Abort kind",
		);
	});

	it("fails if a history request DTO gains a generic argv field", () => {
		const mutated = withMutatedGitRustSource(
			"src-tauri/src/git/dto.rs",
			(source) =>
				source.replace(
					"pub struct GitResetRequest {\n    target_sha: String,\n    mode: GitResetModeRequest,\n    preview_token: String,\n}",
					"pub struct GitResetRequest {\n    target_sha: String,\n    mode: GitResetModeRequest,\n    preview_token: String,\n    args: Vec<String>,\n}",
				),
		);
		expect(validateGitRustBoundary(mutated)).toContain(
			"F180 history operation request/state/preview/outcome DTOs must expose only their exact audited fields and variants",
		);
	});
});

describe("Plain F090 S0 git blame hardening args Harness", () => {
	const gitBlameSource = readFileSync(
		new URL("../../src-tauri/src/git/blame.rs", import.meta.url),
		"utf8",
	);
	const baselineGitBlameRustSources = Object.freeze([
		{ relativePath: "src-tauri/src/git/blame.rs", source: gitBlameSource },
	]);

	function withMutatedGitBlameSource(mutate) {
		return baselineGitBlameRustSources.map((entry) => ({
			...entry,
			source: mutate(entry.source),
		}));
	}

	it("passes for the real, unmodified blame.rs file", () => {
		expect(validateGitBlameHardeningArgs(baselineGitBlameRustSources)).toEqual(
			[],
		);
	});

	it("fails if blame.rs is missing entirely", () => {
		expect(validateGitBlameHardeningArgs([])).toContain(
			"git boundary requires blame.rs",
		);
	});

	it("fails if -c core.quotePath=false is dropped from GIT_BLAME_BASE_ARGS", () => {
		const mutated = withMutatedGitBlameSource((source) =>
			source.replace(
				'"-c",\n    "core.quotePath=false",\n    "blame",',
				'"blame",',
			),
		);
		expect(validateGitBlameHardeningArgs(mutated)).toContain(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	});

	it("fails if -c core.quotePath=false is moved after the blame subcommand token (the exact regression this contract exists to catch)", () => {
		const mutated = withMutatedGitBlameSource((source) =>
			source.replace(
				'"-c",\n    "core.quotePath=false",\n    "blame",\n    "--line-porcelain",\n    "--root",',
				'"blame",\n    "--line-porcelain",\n    "--root",\n    "-c",\n    "core.quotePath=false",',
			),
		);
		expect(validateGitBlameHardeningArgs(mutated)).toContain(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	});

	it("fails if --root is dropped from GIT_BLAME_BASE_ARGS", () => {
		const mutated = withMutatedGitBlameSource((source) =>
			source.replace('"--root",\n', ""),
		);
		expect(validateGitBlameHardeningArgs(mutated)).toContain(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	});

	it("fails if --line-porcelain is weakened to --porcelain", () => {
		const mutated = withMutatedGitBlameSource((source) =>
			source.replace(
				'"blame",\n    "--line-porcelain",\n    "--root",',
				'"blame",\n    "--porcelain",\n    "--root",',
			),
		);
		expect(validateGitBlameHardeningArgs(mutated)).toContain(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	});

	it("fails if GIT_BLAME_BASE_ARGS is renamed away entirely", () => {
		const mutated = withMutatedGitBlameSource((source) =>
			source.replace(/GIT_BLAME_BASE_ARGS/g, "GIT_BLAME_RENAMED_ARGS"),
		);
		expect(validateGitBlameHardeningArgs(mutated)).toContain(
			"blame.rs must define GIT_BLAME_BASE_ARGS as exactly the audited blame argument list, " +
				"with -c core.quotePath=false positioned as a global option before the blame subcommand " +
				"token (not after it, where -c means something else entirely to git blame)",
		);
	});
});

describe("Plain F090 S2 git show-commit first-parent boundary Harness", () => {
	const gitShowCommitSource = readFileSync(
		new URL("../../src-tauri/src/git/show_commit.rs", import.meta.url),
		"utf8",
	);
	const baselineGitShowCommitRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/show_commit.rs",
			source: gitShowCommitSource,
		},
	]);

	function withMutatedGitShowCommitSource(mutate) {
		return baselineGitShowCommitRustSources.map((entry) => ({
			...entry,
			source: mutate(entry.source),
		}));
	}

	it("passes for the real, unmodified show_commit.rs file", () => {
		expect(
			validateGitShowCommitFirstParentBoundary(
				baselineGitShowCommitRustSources,
			),
		).toEqual([]);
	});

	it("fails if show_commit.rs is missing entirely", () => {
		expect(validateGitShowCommitFirstParentBoundary([])).toContain(
			"git boundary requires show_commit.rs",
		);
	});

	it('fails if a literal "show" subcommand string is smuggled in anywhere in the file', () => {
		const mutated = withMutatedGitShowCommitSource(
			(source) => `${source}\nconst UNUSED_SHOW_MARKER: &str = "show";\n`,
		);
		expect(validateGitShowCommitFirstParentBoundary(mutated)).toContain(
			'show_commit.rs must never spawn `git show` (the literal string "show" must not ' +
				"appear anywhere in its executable source) — see this file's own module doc " +
				"comment for why a plain two-explicit-revision `git diff` replaces it entirely",
		);
	});

	it("fails if verify_commit_exists is called after resolve_first_parent instead of before (the exact regression this contract exists to catch)", () => {
		const mutated = withMutatedGitShowCommitSource((source) =>
			source.replace(
				"    verify_commit_exists(&repo_dir, sha).await?;\n    let parent_sha = resolve_first_parent(&repo_dir, sha).await?;\n",
				"    let parent_sha = resolve_first_parent(&repo_dir, sha).await?;\n    verify_commit_exists(&repo_dir, sha).await?;\n",
			),
		);
		expect(validateGitShowCommitFirstParentBoundary(mutated)).toContain(
			"show_commit's own function body must call verify_commit_exists strictly before " +
				"resolve_first_parent — neither %P nor --parents output alone can distinguish a " +
				"non-existent/non-commit object from a genuine root commit",
		);
	});

	it("fails if verify_commit_exists is removed from show_commit entirely", () => {
		const mutated = withMutatedGitShowCommitSource((source) =>
			source.replace("    verify_commit_exists(&repo_dir, sha).await?;\n", ""),
		);
		expect(validateGitShowCommitFirstParentBoundary(mutated)).toContain(
			"show_commit's own function body must call verify_commit_exists strictly before " +
				"resolve_first_parent — neither %P nor --parents output alone can distinguish a " +
				"non-existent/non-commit object from a genuine root commit",
		);
	});

	it("fails if base_revision is built from a bare sha instead of parent_sha.as_deref().unwrap_or(EMPTY_TREE_SHA)", () => {
		const mutated = withMutatedGitShowCommitSource((source) =>
			source.replace(
				"let base_revision: &str = parent_sha.as_deref().unwrap_or(EMPTY_TREE_SHA);",
				"let base_revision: &str = sha;",
			),
		);
		expect(validateGitShowCommitFirstParentBoundary(mutated)).toContain(
			"show_commit's own base_revision must be built from parent_sha.as_deref().unwrap_or(EMPTY_TREE_SHA) " +
				"— never a bare sha positional or a sha^-style revspec suffix",
		);
	});

	it("fails if show_commit is renamed away, losing the function this contract inspects", () => {
		const mutated = withMutatedGitShowCommitSource((source) =>
			source.replace(
				"pub(crate) async fn show_commit(",
				"pub(crate) async fn show_commit_renamed(",
			),
		);
		expect(validateGitShowCommitFirstParentBoundary(mutated)).toContain(
			"show_commit.rs must define a show_commit function",
		);
	});
});

describe("Plain F090 S3 git log-graph format-string boundary Harness", () => {
	const gitLogSourceForGraphBoundary = readFileSync(
		new URL("../../src-tauri/src/git/log.rs", import.meta.url),
		"utf8",
	);
	const baselineGitLogGraphRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/log.rs",
			source: gitLogSourceForGraphBoundary,
		},
	]);

	function withMutatedGitLogGraphSource(mutate) {
		return baselineGitLogGraphRustSources.map((entry) => ({
			...entry,
			source: mutate(entry.source),
		}));
	}

	it("passes for the real, unmodified log.rs file", () => {
		expect(
			validateGitLogGraphFormatStringBoundary(baselineGitLogGraphRustSources),
		).toEqual([]);
	});

	it("fails if log.rs is missing entirely", () => {
		expect(validateGitLogGraphFormatStringBoundary([])).toContain(
			"git boundary requires log.rs",
		);
	});

	it("fails if GIT_LOG_GRAPH_ARGS drops --topo-order", () => {
		const mutated = withMutatedGitLogGraphSource((source) =>
			source.replace('"--topo-order",\n    "--branches"', '"--branches"'),
		);
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"log.rs must define GIT_LOG_GRAPH_ARGS as exactly the audited graph format string — " +
				"%s (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the two fixed-shape, git-computed %H/%P fields, and the ref-namespace scope " +
				"must remain --branches --tags --remotes (never --all, which also walks refs/stash)",
		);
	});

	it("fails if GIT_LOG_GRAPH_ARGS's format string moves %s before %P (the exact field-shift regression this contract exists to catch)", () => {
		const mutated = withMutatedGitLogGraphSource((source) =>
			source.replace('"--format=%H%x1f%P%x1f%s"', '"--format=%H%x1f%s%x1f%P"'),
		);
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"log.rs must define GIT_LOG_GRAPH_ARGS as exactly the audited graph format string — " +
				"%s (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the two fixed-shape, git-computed %H/%P fields, and the ref-namespace scope " +
				"must remain --branches --tags --remotes (never --all, which also walks refs/stash)",
		);
	});

	it("fails if GIT_LOG_GRAPH_ARGS switches from --branches --tags --remotes to --all", () => {
		const mutated = withMutatedGitLogGraphSource((source) =>
			source.replace(
				'"--branches",\n    "--tags",\n    "--remotes",',
				'"--all",',
			),
		);
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"log.rs must define GIT_LOG_GRAPH_ARGS as exactly the audited graph format string — " +
				"%s (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the two fixed-shape, git-computed %H/%P fields, and the ref-namespace scope " +
				"must remain --branches --tags --remotes (never --all, which also walks refs/stash)",
		);
	});

	it("fails if parse_graph_entries's bounded splitn(3, ...) is widened to an unbounded split (the exact regression this contract exists to catch)", () => {
		const mutated = withMutatedGitLogGraphSource((source) =>
			source.replace(
				"let mut parts = record.splitn(3, |&byte| byte == 0x1f);",
				"let mut parts = record.split(|&byte| byte == 0x1f);",
			),
		);
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"parse_graph_entries must split each record with a bounded splitn(3, ...) — leaving " +
				"the subject field's own further bytes (including an attacker-embedded 0x1f) " +
				"untouched — never an unbounded split",
		);
		// Control: this same mutated source now also trips the *second* guard
		// (the exact naive-full-split shape this contract independently bans),
		// proving both checks are real and not merely mutually redundant phrasing.
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"parse_graph_entries must never fall back to an unbounded split on 0x1f anywhere in " +
				"its own body — this is exactly the field-shift vulnerability this command's format " +
				"string is designed to avoid",
		);
	});

	it("fails if parse_graph_entries is renamed away, losing the function this contract inspects", () => {
		const mutated = withMutatedGitLogGraphSource((source) =>
			source.replace(
				"fn parse_graph_entries(",
				"fn parse_graph_entries_renamed(",
			),
		);
		expect(validateGitLogGraphFormatStringBoundary(mutated)).toContain(
			"log.rs must define a parse_graph_entries function",
		);
	});
});

describe("Plain F090 S3 git refs field-safety boundary Harness", () => {
	const gitRefsSourceForFieldSafetyBoundary = readFileSync(
		new URL("../../src-tauri/src/git/refs.rs", import.meta.url),
		"utf8",
	);
	const baselineGitRefsRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/refs.rs",
			source: gitRefsSourceForFieldSafetyBoundary,
		},
	]);

	function withMutatedGitRefsSource(mutate) {
		return baselineGitRefsRustSources.map((entry) => ({
			...entry,
			source: mutate(entry.source),
		}));
	}

	it("passes for the real, unmodified refs.rs file", () => {
		expect(
			validateGitRefsFieldSafetyBoundary(baselineGitRefsRustSources),
		).toEqual([]);
	});

	it("fails if refs.rs is missing entirely", () => {
		expect(validateGitRefsFieldSafetyBoundary([])).toContain(
			"git boundary requires refs.rs",
		);
	});

	it("fails if GIT_FOR_EACH_REF_ARGS drops refs/remotes from its scope", () => {
		const mutated = withMutatedGitRefsSource((source) =>
			source.replace('\n    "refs/remotes",', ""),
		);
		expect(validateGitRefsFieldSafetyBoundary(mutated)).toContain(
			"refs.rs must define GIT_FOR_EACH_REF_ARGS as exactly the audited six-field " +
				"for-each-ref format string, scoped to refs/heads, refs/tags and refs/remotes only " +
				"(never --all, which also walks refs/stash)",
		);
	});

	it("fails if parse_refs's plain NUL split is narrowed to a bounded splitn (the exact regression this contract exists to catch, mirror image of the log_graph one)", () => {
		const mutated = withMutatedGitRefsSource((source) =>
			source.replace(
				"let fields: Vec<&[u8]> = line.split(|&byte| byte == 0u8).collect();",
				"let fields: Vec<&[u8]> = line.splitn(6, |&byte| byte == 0u8).collect();",
			),
		);
		expect(validateGitRefsFieldSafetyBoundary(mutated)).toContain(
			"parse_refs must never use a bounded splitn anywhere in its own body — doing so would " +
				"misleadingly suggest this command's fields carry the same attacker-controlled-" +
				"content risk log/blame's own format strings do, which this module's own doc " +
				"comment establishes they structurally do not",
		);
	});

	it("fails if parse_refs stops splitting on a plain NUL byte entirely", () => {
		const mutated = withMutatedGitRefsSource((source) =>
			source.replace(
				"let fields: Vec<&[u8]> = line.split(|&byte| byte == 0u8).collect();",
				"let fields: Vec<&[u8]> = line.split(|&byte| byte == b' ').collect();",
			),
		);
		expect(validateGitRefsFieldSafetyBoundary(mutated)).toContain(
			"parse_refs must split each record's fields on a plain, unbounded NUL split — every " +
				"field here is structurally NUL-free by git's own ref-name grammar (see refs.rs's " +
				"own module doc comment), so no single-absorbing-field workaround is needed",
		);
	});

	it("fails if parse_refs is renamed away, losing the function this contract inspects", () => {
		const mutated = withMutatedGitRefsSource((source) =>
			source.replace("fn parse_refs(", "fn parse_refs_renamed("),
		);
		expect(validateGitRefsFieldSafetyBoundary(mutated)).toContain(
			"refs.rs must define a parse_refs function",
		);
	});
});

describe("Plain F080 S1 git IPC bridge Harness", () => {
	const gitCommandsSourceForBridge = readFileSync(
		new URL("../../src-tauri/src/git/commands.rs", import.meta.url),
		"utf8",
	);
	const gitDtoSourceForBridge = readFileSync(
		new URL("../../src-tauri/src/git/dto.rs", import.meta.url),
		"utf8",
	);
	const contractsSourceForGit = readFileSync(
		new URL("../../app/platform/tauri/contracts.ts", import.meta.url),
		"utf8",
	);
	const gitCodecSource = readFileSync(
		new URL("../../app/platform/tauri/git-codec.ts", import.meta.url),
		"utf8",
	);
	const nativeSourceForGit = readFileSync(
		new URL("../../app/platform/tauri/native.ts", import.meta.url),
		"utf8",
	);

	const baselineGitBridgeRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/commands.rs",
			source: gitCommandsSourceForBridge,
		},
		{ relativePath: "src-tauri/src/git/dto.rs", source: gitDtoSourceForBridge },
	]);
	const baselineGitBridgeAppSources = Object.freeze([
		{
			relativePath: "app/platform/tauri/contracts.ts",
			source: contractsSourceForGit,
		},
		{ relativePath: "app/platform/tauri/git-codec.ts", source: gitCodecSource },
		{
			relativePath: "app/platform/tauri/native.ts",
			source: nativeSourceForGit,
		},
	]);

	function withMutatedGitApp(relativePath, mutate) {
		return baselineGitBridgeAppSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	it("passes for the real, unmodified git bridge files", () => {
		expect(
			validateGitIpcBridgeBoundary(
				baselineGitBridgeRustSources,
				baselineGitBridgeAppSources,
			),
		).toEqual([]);
	});

	it("fails if PlainBridge loses gitShowBlob", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					/\tgitShowBlob\(\n\t\trev: GitBlobRev,\n\t\tpath: string,\n\t\trootId\?: string,\n\t\): Promise<GitShowBlobResult>;\n/,
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if a PlainBridge Git method stops accepting the selected root identity", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tgitStatus(rootId?: string): Promise<GitStatusResult>;",
					"\tgitStatus(): Promise<GitStatusResult>;",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if a native Git invoke drops the validated root identity", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"\t\t\t\t\trootId: await resolveNativeGitRootId(rootId),\n\t\t\t\t\trequest: {},",
					"\t\t\t\t\trequest: {},",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must attach one validated explicit rootId to every audited Git invoke",
		);
	});

	it("fails if the Git root identity codec stops validating UUID-v4", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/git-codec.ts",
			(source) =>
				source.replace(
					'typeof rootId !== "string" || !UUID_V4_PATTERN.test(rootId)',
					'typeof rootId !== "string"',
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"git-codec.ts's frozenGitRootId must reject every non-canonical UUID-v4 root identity before IPC",
		);
	});

	it("fails if git-codec.ts's decodeGitStatusResult stops rejecting Proxy wrapping", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/git-codec.ts",
			(source) =>
				source.replace(
					/export function decodeGitStatusResult\(value: unknown\): GitStatusResult \{\n\treturn sanitizedDecode\(\(\) => \{[\s\S]*?\n\t\}\);\n\}/,
					"export function decodeGitStatusResult(value) { return value; }",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"git-codec.ts's decodeGitStatusResult must validate exact own-data keys, reject Proxy wrapping, and freeze its result",
		);
	});

	it("fails if native.ts stops decoding git_diff_files through the audited decoder", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"decodeGitDiffFilesResult(",
					"JSON.parse(JSON.stringify(",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_status/git_diff_files/git_show_blob exactly once each, decoded through the audited decoders",
		);
	});

	it("fails if native.ts invokes git_status a second time", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) => `${source}\ninvoke<unknown>("git_status");`,
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_status/git_diff_files/git_show_blob exactly once each, decoded through the audited decoders",
		);
	});

	it("fails if PlainBridge loses gitCommit", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tgitCommit(message: string, amend: boolean, rootId?: string): Promise<void>;\n",
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if native.ts invokes git_discard_paths a second time", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) => `${source}\ninvoke<unknown>("git_discard_paths");`,
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_discard_paths exactly once, routed through frozenGitDiscardPathsRequest",
		);
	});

	it("fails if native.ts stops routing git_stage_blob through frozenGitStageBlobRequest", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"const request = frozenGitStageBlobRequest(path, content);",
					"const request = { path, content: Array.from(content) };",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_stage_blob exactly once, routed through frozenGitStageBlobRequest",
		);
	});

	it("fails if native.ts stops decoding a git write command's response through decodeGitVoid", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replaceAll("decodeGitVoid(", "JSON.parse(JSON.stringify("),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must decode every F080 S3/S4 git void-returning command's response through decodeGitVoid",
		);
	});

	it("fails if PlainBridge loses gitNetworkPreview", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					/\tgitNetworkPreview\(\n\t\toperation: GitNetworkOperation,\n\t\trootId\?: string,\n\t\): Promise<GitNetworkPreviewResult>;\n/,
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if PlainBridge loses gitPush", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tgitPush(force: boolean, rootId?: string): Promise<void>;\n",
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if git-codec.ts's decodeGitNetworkPreviewResult stops freezing its result", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/git-codec.ts",
			(source) =>
				source.replace(
					/export function decodeGitNetworkPreviewResult\(\n\tvalue: unknown,\n\): GitNetworkPreviewResult \{\n\treturn sanitizedDecode\(\(\) => \{[\s\S]*?\n\t\}\);\n\}/,
					"export function decodeGitNetworkPreviewResult(value) { return value; }",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"git-codec.ts's decodeGitNetworkPreviewResult must validate exact own-data keys, reject Proxy wrapping, and freeze its result",
		);
	});

	it("fails if native.ts stops routing git_network_preview through its audited builder/decoder", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"const request = frozenGitNetworkPreviewRequest(operation);",
					"const request = { operation };",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_network_preview exactly once, routed through frozenGitNetworkPreviewRequest and decoded through decodeGitNetworkPreviewResult",
		);
	});

	it("fails if PlainBridge loses the F180 history preview method", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					/\tgitHistoryPreview\([\s\S]*?\n\t\): Promise<GitHistoryPreview>;\n/,
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if native history reset bypasses its frozen request", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"const request = frozenGitResetRequest(targetSha, mode, previewToken);",
					"const request = { targetSha, mode, previewToken };",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_reset exactly once through its audited request and decodeGitHistoryMutationOutcome",
		);
	});

	it("fails if history outcomes stop passing through their strict decoder", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/git-codec.ts",
			(source) =>
				source.replace(
					/export function decodeGitHistoryMutationOutcome\([\s\S]*?\n\}\n\n\/\/ --- F090 S4:/,
					"export function decodeGitHistoryMutationOutcome(value) { return value; }\n\n// --- F090 S4:",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"git-codec.ts's decodeGitHistoryMutationOutcome must validate exact own-data keys, reject Proxy wrapping, and freeze its result",
		);
	});

	it("fails if native.ts invokes git_fetch a second time", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) => `${source}\ninvoke<unknown>("git_fetch");`,
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain("native.ts must invoke git_fetch exactly once");
	});

	it("fails if native.ts stops routing git_push through frozenGitPushRequest", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"const request = frozenGitPushRequest(force);",
					"const request = { force };",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_push exactly once, routed through frozenGitPushRequest",
		);
	});

	it("fails if PlainBridge loses gitLogGraph", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tgitLogGraph(maxCount: number, rootId?: string): Promise<GitLogGraphResult>;\n",
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if PlainBridge loses gitRefsList", () => {
		const widened = withMutatedGitApp(
			"app/platform/tauri/contracts.ts",
			(source) =>
				source.replace(
					"\tgitRefsList(rootId?: string): Promise<GitRefsListResult>;\n",
					"",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, widened),
		).toContain(
			"PlainBridge must expose exactly the fifty-six audited git methods, no more and no fewer",
		);
	});

	it("fails if native.ts stops routing git_log_graph through its audited builder/decoder", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"const request = frozenGitLogGraphRequest(maxCount);",
					"const request = { maxCount };",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_log_graph exactly once, routed through frozenGitLogGraphRequest and decoded through decodeGitLogGraphResult",
		);
	});

	it("fails if native.ts invokes git_refs_list a second time", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/native.ts",
			(source) => `${source}\ninvoke<unknown>("git_refs_list");`,
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"native.ts must invoke git_refs_list exactly once, decoded through decodeGitRefsListResult",
		);
	});

	it("fails if git-codec.ts's decodeGitRefsListResult stops rejecting Proxy wrapping", () => {
		const mutated = withMutatedGitApp(
			"app/platform/tauri/git-codec.ts",
			(source) =>
				source.replace(
					/export function decodeGitRefsListResult\(value: unknown\): GitRefsListResult \{\n\treturn sanitizedDecode\(\(\) => \{[\s\S]*?\n\t\}\);\n\}/,
					"export function decodeGitRefsListResult(value) { return value; }",
				),
		);
		expect(
			validateGitIpcBridgeBoundary(baselineGitBridgeRustSources, mutated),
		).toContain(
			"git-codec.ts's decodeGitRefsListResult must validate exact own-data keys, reject Proxy wrapping, and freeze its result",
		);
	});
});

const gitDiscardAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/scm/plain-git-root.ts",
	"app/features/scm/plain-scm-view.ts",
	"app/features/scm/plain-scm-discard.ts",
];
const gitDiscardAppSources = gitDiscardAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceGitDiscardAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(gitDiscardAppSources, relativePath, (source) => {
		if (!source.includes(from)) {
			throw new Error(
				`${relativePath} git discard mutation fixture no longer matches production`,
			);
		}
		return source.replace(from, to);
	});
}

describe("Plain F080 S3 git discard confirmation boundary Harness", () => {
	it("accepts the production single confirmed discardResources route", () => {
		expect(
			validateGitDiscardConfirmationBoundary(gitDiscardAppSources),
		).toEqual([]);
	});

	it("rejects a discard facade that drops its immutable repository authority", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-git-root.ts",
			"bridge.gitDiscardPaths(paths, rootId)",
			"bridge.gitDiscardPaths(paths)",
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"plain-git-root.ts must expose exactly one gitDiscardPaths facade property that only forwards paths plus its immutable rootId",
		);
	});

	it("requires every audited file to be present", () => {
		expect(validateGitDiscardConfirmationBoundary([])).toContain(
			"git discard confirmation boundary requires app/features/scm/plain-scm-view.ts",
		);
	});

	it("rejects a second gitDiscardPaths call site anywhere else in app/", () => {
		const relativePath = "app/features/scm/plain-scm-discard-bypass.ts";
		const hostile = [
			...gitDiscardAppSources,
			{
				relativePath,
				source: `import type { PlainBridge } from "../../platform/tauri/contracts";
export async function bypassDiscard(bridge: PlainBridge): Promise<void> {
	await bridge.gitDiscardPaths(["README.md"]);
}`,
			},
		];
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			`${relativePath} must not consume gitDiscardPaths outside PlainScmView.discardResources's single audited call site`,
		);
	});

	it("rejects a second call site inside plain-scm-view.ts outside discardResources", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-scm-view.ts",
			"private async discardAllWorkingTree(): Promise<void> {\n\t\tawait this.discardResources(this.#discardableWorkingTreePaths(false));\n\t}",
			`private async discardAllWorkingTree(): Promise<void> {
		await this.discardResources(this.#discardableWorkingTreePaths(false));
	}

	private async bypassDiscard(bridge: PlainBridge, relativePaths: readonly string[]): Promise<void> {
		await bridge.gitDiscardPaths(relativePaths);
	}`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-scm-view.ts must not consume gitDiscardPaths outside PlainScmView.discardResources's single audited call site",
		);
	});

	it("rejects a duplicated gitDiscardPaths call inside discardResources itself", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-scm-view.ts",
			`await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);`,
			`await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);
		await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"gitDiscardPaths must have exactly one production call site, inside PlainScmView.discardResources",
		);
	});

	it("rejects computed/bracket access to gitDiscardPaths", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-scm-view.ts",
			"bridge.gitDiscardPaths(relativePaths)",
			'bridge["gitDiscardPaths"](relativePaths)',
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-scm-view.ts must not consume gitDiscardPaths outside PlainScmView.discardResources's single audited call site",
		);
	});

	it("rejects a missing or renamed gitDiscardPaths bridge declaration", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/platform/tauri/native.ts",
			"gitDiscardPaths: async (paths, rootId) => {",
			"gitDiscardPathsRenamed: async (paths, rootId) => {",
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/native.ts must declare gitDiscardPaths exactly once in its audited bridge surface",
		);
	});

	it("rejects a duplicated gitDiscardPaths bridge declaration", () => {
		const hostile = mutateWorkspaceSource(
			gitDiscardAppSources,
			"app/platform/tauri/browser-mock.ts",
			(source) =>
				`${source}\nconst duplicateGitDiscardMock = { async gitDiscardPaths(paths) { return; } };`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/browser-mock.ts must declare gitDiscardPaths exactly once in its audited bridge surface",
		);
	});

	it("rejects any shape of discardResources that does not await, check, then call in that exact order", () => {
		const cases = [
			[
				'if (decision.kind !== "confirmed") {',
				'if (decision.kind === "confirmed") {',
			],
			[
				`const decision = await resolveDiscardConfirmation(
			this.dialogService,
			relativePaths,
		);
		if (decision.kind !== "confirmed") {
			return;
		}
		await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);`,
				`await this.runGitMutation((bridge) =>
			bridge.gitDiscardPaths(relativePaths),
		);
		const decision = await resolveDiscardConfirmation(
			this.dialogService,
			relativePaths,
		);
		if (decision.kind !== "confirmed") {
			return;
		}`,
			],
		];
		const failure =
			'PlainScmView.discardResources must await resolveDiscardConfirmation, return unless its result is exactly "confirmed", and only then call bridge.gitDiscardPaths — no other shape may reach the discard bridge call';
		for (const [from, to] of cases) {
			const hostile = replaceGitDiscardAppSource(
				"app/features/scm/plain-scm-view.ts",
				from,
				to,
			);
			expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
				failure,
			);
		}
	});

	it("rejects plain-scm-discard.ts importing anything at all", () => {
		const hostile = mutateWorkspaceSource(
			gitDiscardAppSources,
			"app/features/scm/plain-scm-discard.ts",
			(source) => `import { invoke } from "@tauri-apps/api/core";\n${source}`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"plain-scm-discard.ts must not import anything — it only ever decides whether the caller may discard, and an import is the only way it could ever reach a bridge or service to perform the discard itself",
		);
	});

	it("rejects a new top-level declaration added to plain-scm-discard.ts", () => {
		const hostile = mutateWorkspaceSource(
			gitDiscardAppSources,
			"app/features/scm/plain-scm-discard.ts",
			(source) => `${source}\nexport function leakedHelper(): void {}`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"plain-scm-discard.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	});

	it("rejects resolveDiscardConfirmation skipping the dialog for a non-empty path list", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-scm-discard.ts",
			"if (relativePaths.length === 0) {",
			"if (relativePaths.length === 0 || relativePaths.length < 5) {",
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"resolveDiscardConfirmation must, for a non-empty path list, unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited no-op/confirm/decline shape",
		);
	});

	it("rejects resolveDiscardConfirmation calling a bridge method itself", () => {
		const hostile = replaceGitDiscardAppSource(
			"app/features/scm/plain-scm-discard.ts",
			`export async function resolveDiscardConfirmation(
	dialogService: DiscardConfirmDialogService,
	relativePaths: readonly string[],
): Promise<DiscardDecision> {
	if (relativePaths.length === 0) {`,
			`export async function resolveDiscardConfirmation(
	dialogService: DiscardConfirmDialogService,
	relativePaths: readonly string[],
	bridge: { gitDiscardPaths(paths: readonly string[]): Promise<void> },
): Promise<DiscardDecision> {
	await bridge.gitDiscardPaths(relativePaths);
	if (relativePaths.length === 0) {`,
		);
		expect(validateGitDiscardConfirmationBoundary(hostile)).toContain(
			"resolveDiscardConfirmation must, for a non-empty path list, unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited no-op/confirm/decline shape",
		);
	});
});

const gitNetworkAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/scm/plain-git-root.ts",
	"app/features/scm/plain-scm-view.ts",
	"app/features/scm/plain-scm-network.ts",
];
const gitNetworkAppSources = gitNetworkAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceGitNetworkAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(gitNetworkAppSources, relativePath, (source) => {
		if (!source.includes(from)) {
			throw new Error(
				`${relativePath} git network mutation fixture no longer matches production`,
			);
		}
		return source.replace(from, to);
	});
}

describe("Plain F080 S4 git network confirmation boundary Harness", () => {
	it("accepts the production single confirmed fetch/pull/push routes", () => {
		expect(
			validateGitNetworkConfirmationBoundary(gitNetworkAppSources),
		).toEqual([]);
	});

	it("rejects a network facade that drops its immutable repository authority", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-git-root.ts",
			"bridge.gitPush(force, rootId)",
			"bridge.gitPush(force)",
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"plain-git-root.ts must expose exactly one gitPush facade property that only appends its immutable rootId",
		);
	});

	it("requires every audited file to be present", () => {
		expect(validateGitNetworkConfirmationBoundary([])).toContain(
			"git network confirmation boundary requires app/features/scm/plain-scm-network.ts",
		);
	});

	it("rejects a second gitFetch call site anywhere else in app/", () => {
		const relativePath = "app/features/scm/plain-scm-network-bypass.ts";
		const hostile = [
			...gitNetworkAppSources,
			{
				relativePath,
				source: `import type { PlainBridge } from "../../platform/tauri/contracts";
export async function bypassFetch(bridge: PlainBridge): Promise<void> {
	await bridge.gitFetch();
}`,
			},
		];
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			`${relativePath} must not consume gitFetch outside PlainScmView.fetchFromRemote's single audited call site`,
		);
	});

	it("rejects a second gitPush call site inside plain-scm-view.ts outside pushToRemote", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-view.ts",
			"private async commitChanges(): Promise<void> {",
			`private async bypassPush(bridge: PlainBridge): Promise<void> {
		await bridge.gitPush(false);
	}

	private async commitChanges(): Promise<void> {`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-scm-view.ts must not consume gitPush outside PlainScmView.pushToRemote's single audited call site",
		);
	});

	it("rejects a duplicated gitPull call inside pullFromRemote itself", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-view.ts",
			"await this.runNetworkMutation((bridge) => bridge.gitPull());",
			`await this.runNetworkMutation((bridge) => bridge.gitPull());
		await this.runNetworkMutation((bridge) => bridge.gitPull());`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"gitPull must have exactly one production call site, inside PlainScmView.pullFromRemote",
		);
	});

	it("rejects computed/bracket access to gitFetch", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-view.ts",
			"bridge.gitFetch()",
			'bridge["gitFetch"]()',
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-scm-view.ts must not consume gitFetch outside PlainScmView.fetchFromRemote's single audited call site",
		);
	});

	it("rejects a missing or renamed gitPush bridge declaration", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/platform/tauri/native.ts",
			"gitPush: async (force, rootId) => {",
			"gitPushRenamed: async (force, rootId) => {",
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/native.ts must declare gitPush exactly once in its audited bridge surface",
		);
	});

	it("rejects a duplicated gitFetch bridge declaration", () => {
		const hostile = mutateWorkspaceSource(
			gitNetworkAppSources,
			"app/platform/tauri/browser-mock.ts",
			(source) =>
				`${source}\nconst duplicateGitFetchMock = { async gitFetch() { return; } };`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/browser-mock.ts must declare gitFetch exactly once in its audited bridge surface",
		);
	});

	it("rejects any shape of fetchFromRemote that does not preview, check, confirm, check, then call in that exact order", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-view.ts",
			'if (decision.kind !== "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.runNetworkMutation((bridge) => bridge.gitFetch());',
			'if (decision.kind === "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.runNetworkMutation((bridge) => bridge.gitFetch());',
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"PlainScmView.fetchFromRemote must match its exact audited preview-then-confirm-then-call shape — no other shape may reach the network bridge call",
		);
	});

	it("rejects pushToRemote skipping the force-checkbox read", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-view.ts",
			"const force = this.#forcePushCheckbox?.checked ?? false;",
			"const force = false;",
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"PlainScmView.pushToRemote must match its exact audited preview-then-confirm-then-call shape — no other shape may reach the network bridge call",
		);
	});

	it("rejects plain-scm-network.ts importing anything at all", () => {
		const hostile = mutateWorkspaceSource(
			gitNetworkAppSources,
			"app/features/scm/plain-scm-network.ts",
			(source) => `import { invoke } from "@tauri-apps/api/core";\n${source}`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"plain-scm-network.ts must not import anything — it only ever decides whether the caller may fetch/pull/push, and an import is the only way it could ever reach a bridge or service to perform the network write itself",
		);
	});

	it("rejects a new top-level declaration added to plain-scm-network.ts", () => {
		const hostile = mutateWorkspaceSource(
			gitNetworkAppSources,
			"app/features/scm/plain-scm-network.ts",
			(source) => `${source}\nexport function leakedHelper(): void {}`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"plain-scm-network.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	});

	it("rejects resolveNetworkConfirmation calling a bridge method itself", () => {
		const hostile = replaceGitNetworkAppSource(
			"app/features/scm/plain-scm-network.ts",
			`export async function resolveNetworkConfirmation(
	dialogService: NetworkConfirmDialogService,
	request: NetworkConfirmationRequest,
): Promise<NetworkConfirmDecision> {
	const confirmation = await dialogService.confirm({`,
			`export async function resolveNetworkConfirmation(
	dialogService: NetworkConfirmDialogService,
	request: NetworkConfirmationRequest,
	bridge: { gitFetch(): Promise<void> },
): Promise<NetworkConfirmDecision> {
	await bridge.gitFetch();
	const confirmation = await dialogService.confirm({`,
		);
		expect(validateGitNetworkConfirmationBoundary(hostile)).toContain(
			"resolveNetworkConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	});
});

const gitManagementUiAppPaths = [
	"app/main.ts",
	"app/excluded-surface-policy.ts",
	"app/features/scm/plain-git-management.ts",
	"app/features/scm/plain-git-history-actions.ts",
	"app/features/scm/plain-git-invalidation.ts",
	"app/features/scm/plain-scm-commands.ts",
	"app/features/scm/plain-git-root.ts",
	"app/features/scm/plain-scm-view.ts",
	"app/features/scm/plain-git-graph-view.ts",
	"app/features/scm/plain-git-history-view.ts",
	"app/features/scm/plain-git-history.ts",
	"app/features/scm/plain-git-stash-view.ts",
	"app/features/scm/plain-git-worktree-view.ts",
];
const gitManagementUiAppSources = gitManagementUiAppPaths.map(
	(relativePath) => ({
		relativePath,
		source: readFileSync(
			new URL(`../../${relativePath}`, import.meta.url),
			"utf8",
		),
	}),
);

function replaceGitManagementUiSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		gitManagementUiAppSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} git management UI mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain F180 S2 git management UI boundary Harness", () => {
	it("accepts the production command, confirmation and invalidation routes", () => {
		expect(validateGitManagementUiBoundary(gitManagementUiAppSources)).toEqual(
			[],
		);
	});

	it("requires every audited management and refresh file", () => {
		expect(validateGitManagementUiBoundary([])).toContain(
			"git management UI boundary requires app/features/scm/plain-git-management.ts",
		);
	});

	it("rejects a second business caller for a management write", () => {
		const hostile = [
			...gitManagementUiAppSources,
			{
				relativePath: "app/features/scm/plain-git-management-bypass.ts",
				source: `export async function bypass(bridge) {
	await bridge.gitRemoteRemove("origin");
}`,
			},
		];
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Git management mutation gitRemoteRemove must remain confined to its audited controller route and immutable root facade",
		);
	});

	it("rejects force branch deletion before a positive DOM confirmation", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-management.ts",
			"if (!confirmation.confirmed) {",
			"if (confirmation.confirmed) {",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Unmerged branch force deletion must remain safe-delete then DOM-confirm then force-delete",
		);
	});

	it("rejects displaying a raw replacement remote URL", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-management.ts",
			"New: ${redactRemoteLocationForDisplay(url)}",
			"New: ${url}",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Remote removal and URL replacement must remain DOM-confirmed, with the new URL redacted before display",
		);
	});

	it("rejects replacing snapshot-only upstream selection with free text", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-management.ts",
			"const upstream = await this.services.quickInput.pick(",
			'const upstreamText = await this.services.quickInput.input({ title: "Upstream" });\n\t\t\tconst upstream = await this.services.quickInput.pick(',
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Upstream choices must remain local and remote-tracking refs from one authoritative refs snapshot",
		);
	});

	it("rejects widening the invalidation event beyond rootId", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-invalidation.ts",
			"readonly rootId: string;",
			"readonly rootId: string;\n\treadonly path: string;",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Git invalidation must remain an exact rootId-only frozen event singleton",
		);
	});

	it("rejects a view refresh that ignores the invalidated repository", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-graph-view.ts",
			"if (this.#controllerRootId === rootId) {",
			"if (this.#controllerRootId !== rootId) {",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Source Control, Graph, History, Stash and Worktree must each subscribe once to root-scoped Git invalidation",
		);
	});

	it("rejects publishing a mutable current root after an awaited write", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-stash-view.ts",
			"plainGitInvalidation.invalidate(rootId);",
			"plainGitInvalidation.invalidate(this.#controllerRootId!);",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Git mutation runners must retain the bridge-matched root id and History must re-read its loaded queries",
		);
	});

	it("rejects dropping one of the four Command Palette entries", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-management.ts",
			'command("manageUpstream"),',
			"",
		);
		expect(validateGitManagementUiBoundary(hostile)).toContain(
			"Git management must expose exactly the four audited Command Palette commands and titles",
		);
	});
});

describe("Plain F180 S4 git history actions UI boundary Harness", () => {
	it("accepts the production target, preview, confirmation and recovery routes", () => {
		expect(
			validateGitHistoryActionsUiBoundary(gitManagementUiAppSources),
		).toEqual([]);
	});

	it("requires the dedicated history action controller", () => {
		expect(validateGitHistoryActionsUiBoundary([])).toContain(
			"git history actions UI boundary requires app/features/scm/plain-git-history-actions.ts",
		);
	});

	it("rejects a second business caller for a history mutation", () => {
		const hostile = [
			...gitManagementUiAppSources,
			{
				relativePath: "app/features/scm/plain-git-history-bypass.ts",
				source: `export async function bypass(bridge) {
	await bridge.gitReset("a".repeat(40), "hard", "b".repeat(64));
}`,
			},
		];
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Git history mutation gitReset must remain confined to its preview/state-gated controller and immutable root facade",
		);
	});

	it("rejects free-text revision input replacing strict target snapshots", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			"const [state, refs, graph, reflog] = await Promise.all([",
			'await this.services.quickInput.input({ title: "Revision" });\n\t\tconst [state, refs, graph, reflog] = await Promise.all([',
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Git history targets must come only from one strict HEAD, refs, graph and reflog snapshot set with no free-text revision input",
		);
	});

	it("rejects turning confirmation cancellation into mutation authorization", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			"if (!confirmation.confirmed) {",
			"if (confirmation.confirmed) {",
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Every targeted Git history mutation must consume its strict target preview only after a positive DOM confirmation, with a distinct hard-reset danger contract",
		);
	});

	it("rejects removing the distinct hard-reset danger button", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			'"Hard Reset and Discard Tracked Changes"',
			'"Reset"',
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Every targeted Git history mutation must consume its strict target preview only after a positive DOM confirmation, with a distinct hard-reset danger contract",
		);
	});

	it("rejects aborting a caller-chosen kind instead of the fresh sequencer kind", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			"session.bridge.gitHistoryAbort(sequencer.kind)",
			'session.bridge.gitHistoryAbort("merge")',
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toEqual(
			expect.arrayContaining([
				"Continue and Abort must bind the freshly-read sequencer kind, with Abort gated by a positive DOM confirmation",
				"Git history mutation gitHistoryAbort must remain confined to its preview/state-gated controller and immutable root facade",
			]),
		);
	});

	it("rejects a cancel request that skips authoritative refresh", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			"await session.bridge.gitHistoryCancel();\n\t\t\tplainGitInvalidation.invalidate(session.root.rootId);\n\t\t\tthis.services.notifications.info(",
			"await session.bridge.gitHistoryCancel();\n\t\t\tthis.services.notifications.info(",
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Every structured history outcome and cancel request must invalidate the immutable root without claiming cancellation rolled Git back",
		);
	});

	it("rejects dropping one of the ten Command Palette entries", () => {
		const hostile = replaceGitManagementUiSource(
			"app/features/scm/plain-git-history-actions.ts",
			`Object.freeze({
		id: CANCEL_OPERATION_COMMAND_ID,
		title: "Cancel Git Operation",
		method: "cancelOperation",
	}),`,
			"",
		);
		expect(validateGitHistoryActionsUiBoundary(hostile)).toContain(
			"Git history actions must expose exactly the ten audited Command Palette commands and titles",
		);
	});
});

const gitHunkStageUiPaths = [
	"app/features/scm/hunk-stage.ts",
	"app/features/scm/plain-scm-commands.ts",
];
const gitHunkStageUiSources = gitHunkStageUiPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceGitHunkStageUiSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		gitHunkStageUiSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} explicit hunk mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain F180 S5 explicit hunk staging UI boundary Harness", () => {
	it("accepts the production bounded selection, stale check and stage route", () => {
		expect(validateGitHunkStageUiBoundary(gitHunkStageUiSources)).toEqual([]);
	});

	it("requires both the command adapter and pure hunk controller", () => {
		expect(validateGitHunkStageUiBoundary([])).toContain(
			"explicit hunk staging boundary requires plain-scm-commands.ts and hunk-stage.ts",
		);
	});

	it("rejects resurrecting the legacy fixed-index-0 command", () => {
		const hostile = [
			...gitHunkStageUiSources,
			{
				relativePath: "app/features/scm/legacy-hunk-bypass.ts",
				source: 'export const id = "plain.scm.stageActiveFileFirstHunk";',
			},
		];
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"the fixed-index-0 hunk command and helper must remain absent from every app source",
		);
	});

	it("rejects changing the hunk picker from explicit multi-select", () => {
		const hostile = replaceGitHunkStageUiSource(
			"app/features/scm/hunk-stage.ts",
			"canPickMany: true,",
			"canPickMany: false,",
		);
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"explicit hunk staging must require a non-empty multi-selection and a matching second byte snapshot before its only write",
		);
	});

	it("rejects removing the fresh snapshot read before staging", () => {
		const hostile = replaceGitHunkStageUiSource(
			"app/features/scm/hunk-stage.ts",
			"const current = await services.readSnapshot();",
			"const current = initial;",
		);
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"explicit hunk staging must require a non-empty multi-selection and a matching second byte snapshot before its only write",
		);
	});

	it("rejects bypassing the byte-for-byte stale snapshot comparison", () => {
		const hostile = replaceGitHunkStageUiSource(
			"app/features/scm/hunk-stage.ts",
			"if (!sameSnapshot(initial, current)) {",
			"if (false) {",
		);
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"explicit hunk staging must require a non-empty multi-selection and a matching second byte snapshot before its only write",
		);
	});

	it("rejects accepting NUL-bearing binary content", () => {
		const hostile = replaceGitHunkStageUiSource(
			"app/features/scm/hunk-stage.ts",
			"bytes.includes(0)",
			"false",
		);
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"hunk summaries and decoding must retain their 256-item/5-second bounds and reject BOM binary and invalid UTF-8 content",
		);
	});

	it("rejects invalidating Git views before a successful stage outcome", () => {
		const hostile = replaceGitHunkStageUiSource(
			"app/features/scm/plain-scm-commands.ts",
			'if (outcome !== "staged") {',
			"if (false) {",
		);
		expect(validateGitHunkStageUiBoundary(hostile)).toContain(
			"the active-file hunk command must route one index/worktree snapshot controller result to one root-bound stage call, then invalidate only after success",
		);
	});
});

describe("Plain F090 S4 git stash message field-safety boundary Harness", () => {
	const gitStashSourceForFieldSafety = readFileSync(
		new URL("../../src-tauri/src/git/stash.rs", import.meta.url),
		"utf8",
	);
	const baselineGitStashFieldSafetyRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/git/stash.rs",
			source: gitStashSourceForFieldSafety,
		},
	]);

	function withMutatedGitStashSource(mutate) {
		return baselineGitStashFieldSafetyRustSources.map((entry) => ({
			...entry,
			source: mutate(entry.source),
		}));
	}

	it("passes for the real, unmodified stash.rs file", () => {
		expect(
			validateGitStashMessageFieldSafetyBoundary(
				baselineGitStashFieldSafetyRustSources,
			),
		).toEqual([]);
	});

	it("fails if stash.rs is missing entirely", () => {
		expect(validateGitStashMessageFieldSafetyBoundary([])).toContain(
			"git boundary requires stash.rs",
		);
	});

	it("fails if GIT_STASH_LIST_ARGS drops -z", () => {
		const mutated = withMutatedGitStashSource((source) =>
			source.replace(
				'&["stash", "list", "-z", "--format=%gd%x1f%H%x1f%ct%x1f%B"]',
				'&["stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%B"]',
			),
		);
		expect(validateGitStashMessageFieldSafetyBoundary(mutated)).toContain(
			"stash.rs must define GIT_STASH_LIST_ARGS as exactly the audited format string — " +
				"%B (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the three fixed-shape, git-computed %gd/%H/%ct fields",
		);
	});

	it("fails if GIT_STASH_LIST_ARGS's format string moves %B before %ct (the exact field-shift regression this contract exists to catch)", () => {
		const mutated = withMutatedGitStashSource((source) =>
			source.replace(
				'"--format=%gd%x1f%H%x1f%ct%x1f%B"',
				'"--format=%gd%x1f%H%x1f%B%x1f%ct"',
			),
		);
		expect(validateGitStashMessageFieldSafetyBoundary(mutated)).toContain(
			"stash.rs must define GIT_STASH_LIST_ARGS as exactly the audited format string — " +
				"%B (the one attacker-controlled free-text field) must be positioned strictly last, " +
				"after the three fixed-shape, git-computed %gd/%H/%ct fields",
		);
	});

	it("fails if parse_stash_list's bounded splitn(4, ...) is widened to an unbounded split (the exact regression this contract exists to catch)", () => {
		const mutated = withMutatedGitStashSource((source) =>
			source.replace(
				"let mut parts = record.splitn(4, |&byte| byte == 0x1f);",
				"let mut parts = record.split(|&byte| byte == 0x1f);",
			),
		);
		expect(validateGitStashMessageFieldSafetyBoundary(mutated)).toContain(
			"parse_stash_list must split each record with a bounded splitn(4, ...) — leaving " +
				"the message field's own further bytes (including an attacker-embedded 0x1f) " +
				"untouched — never an unbounded split",
		);
		// Control: this same mutated source now also trips the *second* guard
		// (the exact naive-full-split shape this contract independently bans),
		// proving both checks are real and not merely mutually redundant phrasing.
		expect(validateGitStashMessageFieldSafetyBoundary(mutated)).toContain(
			"parse_stash_list must never fall back to an unbounded split on 0x1f anywhere in " +
				"its own body — this is exactly the field-shift vulnerability this command's format " +
				"string is designed to avoid",
		);
	});

	it("fails if parse_stash_list is renamed away, losing the function this contract inspects", () => {
		const mutated = withMutatedGitStashSource((source) =>
			source.replace("fn parse_stash_list(", "fn parse_stash_list_renamed("),
		);
		expect(validateGitStashMessageFieldSafetyBoundary(mutated)).toContain(
			"stash.rs must define a parse_stash_list function",
		);
	});
});

const gitStashAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/scm/plain-git-root.ts",
	"app/features/scm/plain-git-stash-view.ts",
	"app/features/scm/plain-scm-stash.ts",
];
const gitStashAppSources = gitStashAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceGitStashAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(gitStashAppSources, relativePath, (source) => {
		if (!source.includes(from)) {
			throw new Error(
				`${relativePath} git stash mutation fixture no longer matches production`,
			);
		}
		return source.replace(from, to);
	});
}

describe("Plain F090 S4 git stash confirmation boundary Harness", () => {
	it("accepts the production single confirmed pop/drop routes", () => {
		expect(validateGitStashConfirmationBoundary(gitStashAppSources)).toEqual(
			[],
		);
	});

	it("rejects a stash facade that drops its immutable repository authority", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-root.ts",
			"bridge.gitStashDrop(sha, rootId)",
			"bridge.gitStashDrop(sha)",
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"plain-git-root.ts must expose exactly one gitStashDrop facade property that only appends its immutable rootId",
		);
	});

	it("requires every audited file to be present", () => {
		expect(validateGitStashConfirmationBoundary([])).toContain(
			"git stash confirmation boundary requires app/features/scm/plain-scm-stash.ts",
		);
	});

	it("rejects a second gitStashPop call site anywhere else in app/", () => {
		const relativePath = "app/features/scm/plain-git-stash-bypass.ts";
		const hostile = [
			...gitStashAppSources,
			{
				relativePath,
				source: `import type { PlainBridge } from "../../platform/tauri/contracts";
export async function bypassPop(bridge: PlainBridge): Promise<void> {
	await bridge.gitStashPop("a".repeat(40), false);
}`,
			},
		];
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			`${relativePath} must not consume gitStashPop outside PlainGitStashView.popEntry's single audited call site`,
		);
	});

	it("rejects a second gitStashDrop call site inside plain-git-stash-view.ts outside dropEntry", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			"private async showEntry(entry: GitStashEntry): Promise<void> {",
			`private async bypassDrop(bridge: PlainBridge): Promise<void> {
		await bridge.gitStashDrop("a".repeat(40));
	}

	private async showEntry(entry: GitStashEntry): Promise<void> {`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-git-stash-view.ts must not consume gitStashDrop outside PlainGitStashView.dropEntry's single audited call site",
		);
	});

	it("rejects a duplicated gitStashPop call inside popEntry itself", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			`const outcome = await this.#runStashMutation((bridge) =>
			bridge.gitStashPop(entry.sha, false),
		);`,
			`const outcome = await this.#runStashMutation((bridge) =>
			bridge.gitStashPop(entry.sha, false),
		);
		await this.#runStashMutation((bridge) => bridge.gitStashPop(entry.sha, false));`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"gitStashPop must have exactly one production call site, inside PlainGitStashView.popEntry",
		);
	});

	it("rejects computed/bracket access to gitStashDrop", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			"await this.#runStashMutation((bridge) => bridge.gitStashDrop(entry.sha));",
			'await this.#runStashMutation((bridge) => bridge["gitStashDrop"](entry.sha));',
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"app/features/scm/plain-git-stash-view.ts must not consume gitStashDrop outside PlainGitStashView.dropEntry's single audited call site",
		);
	});

	it("rejects a missing or renamed gitStashPop bridge declaration", () => {
		const hostile = replaceGitStashAppSource(
			"app/platform/tauri/native.ts",
			"gitStashPop: async (sha, useIndex, rootId) => {",
			"gitStashPopRenamed: async (sha, useIndex, rootId) => {",
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/native.ts must declare gitStashPop exactly once in its audited bridge surface",
		);
	});

	it("rejects a duplicated gitStashDrop bridge declaration", () => {
		const hostile = mutateWorkspaceSource(
			gitStashAppSources,
			"app/platform/tauri/browser-mock.ts",
			(source) =>
				`${source}\nconst duplicateGitStashDropMock = { async gitStashDrop() { return; } };`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/browser-mock.ts must declare gitStashDrop exactly once in its audited bridge surface",
		);
	});

	it("rejects popEntry skipping the confirmation gate", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			'if (decision.kind !== "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tconst outcome = await this.#runStashMutation((bridge) =>\n\t\t\tbridge.gitStashPop(entry.sha, false),\n\t\t);',
			'if (decision.kind === "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tconst outcome = await this.#runStashMutation((bridge) =>\n\t\t\tbridge.gitStashPop(entry.sha, false),\n\t\t);',
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"PlainGitStashView.popEntry must match its exact audited confirm-then-call shape — no other shape may reach the stash bridge call",
		);
	});

	it("rejects dropEntry skipping the confirmation gate", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			'if (decision.kind !== "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.#runStashMutation((bridge) => bridge.gitStashDrop(entry.sha));',
			'if (decision.kind === "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.#runStashMutation((bridge) => bridge.gitStashDrop(entry.sha));',
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"PlainGitStashView.dropEntry must match its exact audited confirm-then-call shape — no other shape may reach the stash bridge call",
		);
	});

	it("rejects plain-scm-stash.ts importing anything at all", () => {
		const hostile = mutateWorkspaceSource(
			gitStashAppSources,
			"app/features/scm/plain-scm-stash.ts",
			(source) => `import { invoke } from "@tauri-apps/api/core";\n${source}`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"plain-scm-stash.ts must not import anything — it only ever decides whether the caller may pop/drop a stash entry, and an import is the only way it could ever reach a bridge or service to perform the write itself",
		);
	});

	it("rejects a new top-level declaration added to plain-scm-stash.ts", () => {
		const hostile = mutateWorkspaceSource(
			gitStashAppSources,
			"app/features/scm/plain-scm-stash.ts",
			(source) => `${source}\nexport function leakedHelper(): void {}`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"plain-scm-stash.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	});

	it("rejects resolveStashConfirmation calling a bridge method itself", () => {
		const hostile = replaceGitStashAppSource(
			"app/features/scm/plain-scm-stash.ts",
			`export async function resolveStashConfirmation(
	dialogService: StashConfirmDialogService,
	request: StashConfirmationRequest,
): Promise<StashConfirmDecision> {
	const confirmation = await dialogService.confirm({`,
			`export async function resolveStashConfirmation(
	dialogService: StashConfirmDialogService,
	request: StashConfirmationRequest,
	bridge: { gitStashDrop(sha: string): Promise<void> },
): Promise<StashConfirmDecision> {
	await bridge.gitStashDrop("a".repeat(40));
	const confirmation = await dialogService.confirm({`,
		);
		expect(validateGitStashConfirmationBoundary(hostile)).toContain(
			"resolveStashConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	});
});

const gitWorktreeAppPaths = [
	"app/platform/tauri/contracts.ts",
	"app/platform/tauri/native.ts",
	"app/platform/tauri/browser-mock.ts",
	"app/features/scm/plain-git-root.ts",
	"app/features/scm/plain-git-worktree-view.ts",
	"app/features/scm/plain-scm-worktree.ts",
];
const gitWorktreeAppSources = gitWorktreeAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceGitWorktreeAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(
		gitWorktreeAppSources,
		relativePath,
		(source) => {
			if (!source.includes(from)) {
				throw new Error(
					`${relativePath} git worktree mutation fixture no longer matches production`,
				);
			}
			return source.replace(from, to);
		},
	);
}

describe("Plain F090 S5 git worktree confirmation boundary Harness", () => {
	it("accepts the production two-call removeEntry route", () => {
		expect(
			validateGitWorktreeConfirmationBoundary(gitWorktreeAppSources),
		).toEqual([]);
	});

	it("rejects a worktree facade that drops its immutable repository authority", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-git-root.ts",
			"bridge.gitWorktreeRemove(path, force, rootId)",
			"bridge.gitWorktreeRemove(path, force)",
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"plain-git-root.ts must expose exactly one gitWorktreeRemove facade property that only forwards path and force plus its immutable rootId",
		);
	});

	it("requires every audited file to be present", () => {
		expect(validateGitWorktreeConfirmationBoundary([])).toContain(
			"git worktree confirmation boundary requires app/features/scm/plain-scm-worktree.ts",
		);
	});

	it("rejects a second gitWorktreeRemove call site anywhere else in app/", () => {
		const relativePath = "app/features/scm/plain-git-worktree-bypass.ts";
		const hostile = [
			...gitWorktreeAppSources,
			{
				relativePath,
				source: `import type { PlainBridge } from "../../platform/tauri/contracts";
export async function bypassRemove(bridge: PlainBridge): Promise<void> {
	await bridge.gitWorktreeRemove("/some/path", true);
}`,
			},
		];
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			`${relativePath} must not consume gitWorktreeRemove outside PlainGitWorktreeView.removeEntry's two audited call sites`,
		);
	});

	it("rejects a third gitWorktreeRemove call inside removeEntry itself", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			`await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, true),
		);
	}`,
			`await this.#runWorktreeMutation((bridge) =>
			bridge.gitWorktreeRemove(entry.path, true),
		);
		await this.#runWorktreeMutation((bridge) => bridge.gitWorktreeRemove(entry.path, true));
	}`,
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"gitWorktreeRemove must have exactly two production call sites, both inside PlainGitWorktreeView.removeEntry (the unforced probe and the confirmed forced retry)",
		);
	});

	it("rejects computed/bracket access to gitWorktreeRemove", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			"bridge.gitWorktreeRemove(entry.path, true),",
			'bridge["gitWorktreeRemove"](entry.path, true),',
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"gitWorktreeRemove must have exactly two production call sites, both inside PlainGitWorktreeView.removeEntry (the unforced probe and the confirmed forced retry)",
		);
	});

	it("rejects a missing or renamed gitWorktreeRemove bridge declaration", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/platform/tauri/native.ts",
			"gitWorktreeRemove: async (path, force, rootId) => {",
			"gitWorktreeRemoveRenamed: async (path, force, rootId) => {",
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/native.ts must declare gitWorktreeRemove exactly once in its audited bridge surface",
		);
	});

	it("rejects a duplicated gitWorktreeRemove bridge declaration", () => {
		const hostile = mutateWorkspaceSource(
			gitWorktreeAppSources,
			"app/platform/tauri/browser-mock.ts",
			(source) =>
				`${source}\nconst duplicateGitWorktreeRemoveMock = { async gitWorktreeRemove() { return "removed"; } };`,
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"app/platform/tauri/browser-mock.ts must declare gitWorktreeRemove exactly once in its audited bridge surface",
		);
	});

	it("rejects removeEntry skipping the confirmation gate", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			'if (decision.kind !== "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.#runWorktreeMutation((bridge) =>\n\t\t\tbridge.gitWorktreeRemove(entry.path, true),\n\t\t);',
			'if (decision.kind === "confirmed") {\n\t\t\treturn;\n\t\t}\n\t\tawait this.#runWorktreeMutation((bridge) =>\n\t\t\tbridge.gitWorktreeRemove(entry.path, true),\n\t\t);',
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"PlainGitWorktreeView.removeEntry must match its exact audited unforced-probe-then-confirm-then-forced-retry shape — no other shape may reach the gitWorktreeRemove bridge call",
		);
	});

	it("rejects removeEntry skipping the needsForce check", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			'if (outcome !== "needsForce") {\n\t\t\treturn;\n\t\t}',
			'if (outcome === "needsForce") {\n\t\t\treturn;\n\t\t}',
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"PlainGitWorktreeView.removeEntry must match its exact audited unforced-probe-then-confirm-then-forced-retry shape — no other shape may reach the gitWorktreeRemove bridge call",
		);
	});

	it("rejects plain-scm-worktree.ts importing anything at all", () => {
		const hostile = mutateWorkspaceSource(
			gitWorktreeAppSources,
			"app/features/scm/plain-scm-worktree.ts",
			(source) => `import { invoke } from "@tauri-apps/api/core";\n${source}`,
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"plain-scm-worktree.ts must not import anything — it only ever decides whether the caller may retry a forced worktree removal, and an import is the only way it could ever reach a bridge or service to perform the write itself",
		);
	});

	it("rejects a new top-level declaration added to plain-scm-worktree.ts", () => {
		const hostile = mutateWorkspaceSource(
			gitWorktreeAppSources,
			"app/features/scm/plain-scm-worktree.ts",
			(source) => `${source}\nexport function leakedHelper(): void {}`,
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"plain-scm-worktree.ts must retain its exact audited top-level surface — no new declaration can quietly add a way for this decide-only module to reach a bridge",
		);
	});

	it("rejects resolveWorktreeConfirmation calling a bridge method itself", () => {
		const hostile = replaceGitWorktreeAppSource(
			"app/features/scm/plain-scm-worktree.ts",
			`export async function resolveWorktreeConfirmation(
	dialogService: WorktreeConfirmDialogService,
	request: WorktreeConfirmationRequest,
): Promise<WorktreeConfirmDecision> {
	const confirmation = await dialogService.confirm({`,
			`export async function resolveWorktreeConfirmation(
	dialogService: WorktreeConfirmDialogService,
	request: WorktreeConfirmationRequest,
	bridge: { gitWorktreeRemove(path: string, force: boolean): Promise<string> },
): Promise<WorktreeConfirmDecision> {
	await bridge.gitWorktreeRemove("/some/path", true);
	const confirmation = await dialogService.confirm({`,
		);
		expect(validateGitWorktreeConfirmationBoundary(hostile)).toContain(
			"resolveWorktreeConfirmation must unconditionally show the confirm dialog and never call a bridge method itself — its body must match the exact audited shape",
		);
	});
});

const viewPaneAppPaths = [
	"app/features/scm/plain-scm-view.ts",
	"app/features/search/plain-search-view.ts",
	"app/features/scm/plain-git-graph-view.ts",
	"app/features/scm/plain-git-stash-view.ts",
	"app/features/scm/plain-git-worktree-view.ts",
	"app/features/scm/plain-git-history-view.ts",
	"app/features/terminal/plain-terminal-view.ts",
];
const viewPaneAppSources = viewPaneAppPaths.map((relativePath) => ({
	relativePath,
	source: readFileSync(
		new URL(`../../${relativePath}`, import.meta.url),
		"utf8",
	),
}));

function replaceViewPaneAppSource(relativePath, from, to) {
	return mutateWorkspaceSource(viewPaneAppSources, relativePath, (source) => {
		if (!source.includes(from)) {
			throw new Error(
				`${relativePath} ViewPane decorator mutation fixture no longer matches production`,
			);
		}
		return source.replace(from, to);
	});
}

describe("Plain ViewPane DI decorator boundary Harness", () => {
	it("accepts every real app/ ViewPane subclass exactly as it stands today", () => {
		expect(
			validateViewPaneDependencyDecoratorBoundary(viewPaneAppSources),
		).toEqual([]);
	});

	it("rejects a subclass declaring zero of its own decorators once it adds services beyond the base nine (reproduces F090 S6's plain-git-history-view.ts, which never declared any decorator since F090 S1)", () => {
		const hostile = replaceViewPaneAppSource(
			"app/features/scm/plain-git-history-view.ts",
			`IKeybindingService(PlainGitHistoryView, undefined, 1);
IContextMenuService(PlainGitHistoryView, undefined, 2);
IConfigurationService(PlainGitHistoryView, undefined, 3);
IContextKeyService(PlainGitHistoryView, undefined, 4);
IViewDescriptorService(PlainGitHistoryView, undefined, 5);
IInstantiationService(PlainGitHistoryView, undefined, 6);
IOpenerService(PlainGitHistoryView, undefined, 7);
IThemeService(PlainGitHistoryView, undefined, 8);
IHoverService(PlainGitHistoryView, undefined, 9);
IWorkspaceContextService(PlainGitHistoryView, undefined, 10);
IEditorService(PlainGitHistoryView, undefined, 11);`,
			"",
		);
		const failures = validateViewPaneDependencyDecoratorBoundary(hostile);
		expect(
			failures.some(
				(failure) =>
					failure.includes("PlainGitHistoryView") &&
					failure.includes("declares 0 of its own DI decorator(s)") &&
					failure.includes("12 parameter(s)") &&
					failure.includes("F090 S6's PlainGitHistoryView"),
			),
		).toBe(true);
	});

	it("rejects a subclass declaring only the services it adds beyond the base nine, leaving indices 1-9 undeclared (reproduces F090 S4's plain-git-stash-view.ts, which broke every sibling view in the same container)", () => {
		const hostile = replaceViewPaneAppSource(
			"app/features/scm/plain-git-stash-view.ts",
			`IKeybindingService(PlainGitStashView, undefined, 1);
IContextMenuService(PlainGitStashView, undefined, 2);
IConfigurationService(PlainGitStashView, undefined, 3);
IContextKeyService(PlainGitStashView, undefined, 4);
IViewDescriptorService(PlainGitStashView, undefined, 5);
IInstantiationService(PlainGitStashView, undefined, 6);
IOpenerService(PlainGitStashView, undefined, 7);
IThemeService(PlainGitStashView, undefined, 8);
IHoverService(PlainGitStashView, undefined, 9);
IDialogService(PlainGitStashView, undefined, 10);
INotificationService(PlainGitStashView, undefined, 11);
IWorkspaceContextService(PlainGitStashView, undefined, 12);`,
			`IDialogService(PlainGitStashView, undefined, 10);
INotificationService(PlainGitStashView, undefined, 11);
IWorkspaceContextService(PlainGitStashView, undefined, 12);`,
		);
		const failures = validateViewPaneDependencyDecoratorBoundary(hostile);
		expect(
			failures.some(
				(failure) =>
					failure.includes("PlainGitStashView") &&
					failure.includes("declares 3 of its own DI decorator(s)") &&
					failure.includes("13 parameter(s)") &&
					failure.includes("F090 S4's PlainGitStashView"),
			),
		).toBe(true);
	});

	it("rejects a subclass declaring more decorators than its constructor has parameters", () => {
		const hostile = replaceViewPaneAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			"IWorkspaceContextService(PlainGitWorktreeView, undefined, 12);",
			`IWorkspaceContextService(PlainGitWorktreeView, undefined, 12);
IDialogService(PlainGitWorktreeView, undefined, 13);`,
		);
		const failures = validateViewPaneDependencyDecoratorBoundary(hostile);
		expect(
			failures.some(
				(failure) =>
					failure.includes("PlainGitWorktreeView") &&
					failure.includes("declares 13 of its own DI decorator(s)") &&
					failure.includes("13 parameter(s)"),
			),
		).toBe(true);
	});

	it("rejects a subclass that redeclares an existing index instead of the missing one (same-looking 12 call sites, but index 10 is never declared and index 9 is declared twice)", () => {
		const hostile = replaceViewPaneAppSource(
			"app/features/scm/plain-git-worktree-view.ts",
			"IDialogService(PlainGitWorktreeView, undefined, 10);\nINotificationService(PlainGitWorktreeView, undefined, 11);",
			"IDialogService(PlainGitWorktreeView, undefined, 9);\nINotificationService(PlainGitWorktreeView, undefined, 11);",
		);
		const failures = validateViewPaneDependencyDecoratorBoundary(hostile);
		expect(
			failures.some(
				(failure) =>
					failure.includes("PlainGitWorktreeView") &&
					// The distinct declared indices collapse to {1..9, 11, 12} —
					// eleven unique values, not twelve — because index 9 is declared twice
					// (deduplicated by the underlying Set) and index 10 is never
					// declared at all. A raw call-count check alone would have missed
					// this; checking the exact declared index *set* catches it.
					failure.includes("declares 11 of its own DI decorator(s)"),
			),
		).toBe(true);
	});

	const graphDecoratorBlock = `IKeybindingService(PlainGitGraphView, undefined, 1);
IContextMenuService(PlainGitGraphView, undefined, 2);
IConfigurationService(PlainGitGraphView, undefined, 3);
IContextKeyService(PlainGitGraphView, undefined, 4);
IViewDescriptorService(PlainGitGraphView, undefined, 5);
IInstantiationService(PlainGitGraphView, undefined, 6);
IOpenerService(PlainGitGraphView, undefined, 7);
IThemeService(PlainGitGraphView, undefined, 8);
IHoverService(PlainGitGraphView, undefined, 9);
IWorkspaceContextService(PlainGitGraphView, undefined, 10);`;

	it("accepts a subclass that adds nothing beyond ViewPane's own base signature and declares zero decorators of its own", () => {
		const baseSignatureOnly = mutateWorkspaceSource(
			viewPaneAppSources,
			"app/features/scm/plain-git-graph-view.ts",
			(source) =>
				source
					.replace(
						"\t\tprivate readonly workspaceContextService: IWorkspaceContextService,\n",
						"",
					)
					.replace(graphDecoratorBlock, ""),
		).filter(
			({ relativePath }) =>
				relativePath === "app/features/scm/plain-git-graph-view.ts",
		);
		const failures =
			validateViewPaneDependencyDecoratorBoundary(baseSignatureOnly);
		expect(
			failures.some((failure) => failure.includes("PlainGitGraphView")),
		).toBe(false);
	});

	it("rejects a zero-decorator class the moment it adds one more parameter without declaring anything", () => {
		const hostile = replaceViewPaneAppSource(
			"app/features/scm/plain-git-graph-view.ts",
			graphDecoratorBlock,
			"",
		);
		const failures = validateViewPaneDependencyDecoratorBoundary(hostile);
		expect(
			failures.some(
				(failure) =>
					failure.includes("PlainGitGraphView") &&
					failure.includes("declares 0 of its own DI decorator(s)") &&
					failure.includes("11 parameter(s)"),
			),
		).toBe(true);
	});
});

describe("Plain F100 S0/S1/S5 debug adapter spawn/connect/framing boundary Harness", () => {
	const debugExecSource = readFileSync(
		new URL("../../src-tauri/src/debug/exec.rs", import.meta.url),
		"utf8",
	);
	const debugFramingSource = readFileSync(
		new URL("../../src-tauri/src/debug/framing.rs", import.meta.url),
		"utf8",
	);
	const debugTcpSource = readFileSync(
		new URL("../../src-tauri/src/debug/tcp.rs", import.meta.url),
		"utf8",
	);

	const baselineDebugRustSources = Object.freeze([
		{ relativePath: "src-tauri/src/debug/exec.rs", source: debugExecSource },
		{
			relativePath: "src-tauri/src/debug/framing.rs",
			source: debugFramingSource,
		},
		{ relativePath: "src-tauri/src/debug/tcp.rs", source: debugTcpSource },
	]);

	function withMutatedDebugSource(relativePath, mutate) {
		return baselineDebugRustSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	const trustCheckAnchor =
		"    trust.require_trusted(workspace, window_label).await?;\n" +
		"    let selected_root = workspace.root_canonical_path(window_label, root_id)?;\n" +
		"    let subject = descriptor.confirmation_subject(AdapterTransportKind::Stdio);\n" +
		"    confirmation\n" +
		"        .require_confirmed(workspace, window_label, &subject)\n" +
		"        .await?;\n" +
		"    let descriptor = descriptor.clone();";
	const constructionAnchor =
		"    let mut command = Command::new(&descriptor.command);\n    command.args(&descriptor.args);";
	const connectTrustCheckAnchor =
		"    trust.require_trusted(workspace, window_label).await?;\n" +
		"    let _selected_root = workspace.root_canonical_path(window_label, root_id)?;\n" +
		"    let subject = descriptor.confirmation_subject(AdapterTransportKind::Tcp);\n" +
		"    confirmation\n" +
		"        .require_confirmed(workspace, window_label, &subject)\n" +
		"        .await?;\n" +
		"    let tcp = tcp.clone();";

	describe("validateDebugAdapterSpawnBoundary", () => {
		it("passes for the real, unmodified debug/exec.rs", () => {
			expect(
				validateDebugAdapterSpawnBoundary(baselineDebugRustSources),
			).toEqual([]);
		});

		it("requires debug/exec.rs to be present", () => {
			expect(validateDebugAdapterSpawnBoundary([])).toEqual([
				"debug adapter spawn boundary requires debug/exec.rs",
			]);
		});

		it("requires a spawn_adapter function to exist", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) =>
					source.replace(
						"pub(crate) async fn spawn_adapter(",
						"pub(crate) async fn spawn_adapter_renamed(",
					),
			);
			expect(validateDebugAdapterSpawnBoundary(mutated)).toEqual([
				"debug/exec.rs must define spawn_adapter",
			]);
		});

		it("rejects a spawn_adapter body that spawns before checking trust", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(trustCheckAnchor)).toBe(true);
					return source.replace(
						trustCheckAnchor,
						"    let descriptor = descriptor.clone();\n    trust.require_trusted(workspace, window_label).await?;",
					);
				},
			);
			const failures = validateDebugAdapterSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"spawn_adapter must call trust.require_trusted(workspace, window_label).await? as its literal first statement",
					),
				),
			).toBe(true);
		});

		it("rejects spawn_adapter when the trust check is missing entirely", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(trustCheckAnchor)).toBe(true);
					return source.replace(
						trustCheckAnchor,
						"    let descriptor = descriptor.clone();",
					);
				},
			);
			const failures = validateDebugAdapterSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"spawn_adapter must call trust.require_trusted(workspace, window_label).await? as its literal first statement",
					),
				),
			).toBe(true);
		});

		it("rejects spawn_adapter when the confirmation check is missing entirely (trust alone is not enough)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(trustCheckAnchor)).toBe(true);
					return source.replace(
						trustCheckAnchor,
						"    trust.require_trusted(workspace, window_label).await?;\n    let descriptor = descriptor.clone();",
					);
				},
			);
			const failures = validateDebugAdapterSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must validate root_id with workspace.root_canonical_path",
					),
				),
			).toBe(true);
		});

		it("rejects spawn_adapter when selected-root validation is removed", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) =>
					source.replace(
						"    let selected_root = workspace.root_canonical_path(window_label, root_id)?;\n",
						"",
					),
			);
			expect(validateDebugAdapterSpawnBoundary(mutated)).toContain(
				"debug/exec.rs spawn_adapter must validate root_id with workspace.root_canonical_path immediately after trust, then call confirmation.require_confirmed for AdapterTransportKind::Stdio, before spawning or connecting",
			);
		});

		it("rejects spawn_adapter when the confirmation check runs before the trust check", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(trustCheckAnchor)).toBe(true);
					return source.replace(
						trustCheckAnchor,
						"    let subject = descriptor.confirmation_subject(AdapterTransportKind::Stdio);\n" +
							"    confirmation\n" +
							"        .require_confirmed(workspace, window_label, &subject)\n" +
							"        .await?;\n" +
							"    trust.require_trusted(workspace, window_label).await?;\n" +
							"    let descriptor = descriptor.clone();",
					);
				},
			);
			const failures = validateDebugAdapterSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"spawn_adapter must call trust.require_trusted(workspace, window_label).await? as its literal first statement",
					),
				),
			).toBe(true);
		});
	});

	describe("validateDebugAdapterConnectBoundary", () => {
		it("passes for the real, unmodified debug/tcp.rs", () => {
			expect(
				validateDebugAdapterConnectBoundary(baselineDebugRustSources),
			).toEqual([]);
		});

		it("requires debug/tcp.rs to be present", () => {
			expect(validateDebugAdapterConnectBoundary([])).toEqual([
				"debug adapter connect boundary requires debug/tcp.rs",
			]);
		});

		it("requires a connect_adapter function to exist", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/tcp.rs",
				(source) =>
					source.replace(
						"pub(crate) async fn connect_adapter(",
						"pub(crate) async fn connect_adapter_renamed(",
					),
			);
			expect(validateDebugAdapterConnectBoundary(mutated)).toEqual([
				"debug/tcp.rs must define connect_adapter",
			]);
		});

		it("rejects connect_adapter when the trust check is missing entirely", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/tcp.rs",
				(source) => {
					expect(source.includes(connectTrustCheckAnchor)).toBe(true);
					return source.replace(
						connectTrustCheckAnchor,
						"    let tcp = tcp.clone();",
					);
				},
			);
			const failures = validateDebugAdapterConnectBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"connect_adapter must call trust.require_trusted(workspace, window_label).await? as its literal first statement",
					),
				),
			).toBe(true);
		});

		it("rejects connect_adapter when the confirmation check is missing entirely (trust alone is not enough)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/tcp.rs",
				(source) => {
					expect(source.includes(connectTrustCheckAnchor)).toBe(true);
					return source.replace(
						connectTrustCheckAnchor,
						"    trust.require_trusted(workspace, window_label).await?;\n    let tcp = tcp.clone();",
					);
				},
			);
			const failures = validateDebugAdapterConnectBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must validate root_id with workspace.root_canonical_path",
					),
				),
			).toBe(true);
		});
	});

	describe("validateDebugTcpCompanionSpawnBoundary", () => {
		const companionTrustCheckAnchor =
			"    trust.require_trusted(workspace, window_label).await?;\n" +
			"    let selected_root = workspace.root_canonical_path(window_label, root_id)?;\n" +
			"    let subject = descriptor.confirmation_subject(AdapterTransportKind::Tcp);\n" +
			"    confirmation\n" +
			"        .require_confirmed(workspace, window_label, &subject)\n" +
			"        .await?;\n" +
			"    let descriptor = descriptor.clone();";

		it("passes for the real, unmodified debug/exec.rs", () => {
			expect(
				validateDebugTcpCompanionSpawnBoundary(baselineDebugRustSources),
			).toEqual([]);
		});

		it("requires debug/exec.rs to be present", () => {
			expect(validateDebugTcpCompanionSpawnBoundary([])).toEqual([
				"debug tcp companion spawn boundary requires debug/exec.rs",
			]);
		});

		it("requires a spawn_adapter_as_tcp_companion function to exist", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) =>
					source.replace(
						"pub(crate) async fn spawn_adapter_as_tcp_companion(",
						"pub(crate) async fn spawn_adapter_as_tcp_companion_renamed(",
					),
			);
			expect(validateDebugTcpCompanionSpawnBoundary(mutated)).toEqual([
				"debug/exec.rs must define spawn_adapter_as_tcp_companion",
			]);
		});

		it("rejects a spawn_adapter_as_tcp_companion body that spawns before checking trust", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(companionTrustCheckAnchor)).toBe(true);
					return source.replace(
						companionTrustCheckAnchor,
						"    let descriptor = descriptor.clone();\n    trust.require_trusted(workspace, window_label).await?;",
					);
				},
			);
			const failures = validateDebugTcpCompanionSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"spawn_adapter_as_tcp_companion must call trust.require_trusted(workspace, window_label).await? as its literal first statement",
					),
				),
			).toBe(true);
		});

		it("rejects spawn_adapter_as_tcp_companion when the confirmation check is missing entirely (trust alone is not enough)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(companionTrustCheckAnchor)).toBe(true);
					return source.replace(
						companionTrustCheckAnchor,
						"    trust.require_trusted(workspace, window_label).await?;\n    let descriptor = descriptor.clone();",
					);
				},
			);
			const failures = validateDebugTcpCompanionSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must validate root_id with workspace.root_canonical_path",
					),
				),
			).toBe(true);
		});

		it("rejects spawn_adapter_as_tcp_companion when it is confirmed via the Stdio variant instead of Tcp (the exact confusion this primitive exists to prevent)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(companionTrustCheckAnchor)).toBe(true);
					return source.replace(
						companionTrustCheckAnchor,
						companionTrustCheckAnchor.replace(
							"AdapterTransportKind::Tcp",
							"AdapterTransportKind::Stdio",
						),
					);
				},
			);
			const failures = validateDebugTcpCompanionSpawnBoundary(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must validate root_id with workspace.root_canonical_path",
					),
				),
			).toBe(true);
		});
	});

	describe("validateDebugSpawnConstructionShape", () => {
		it("passes for the real, unmodified debug/exec.rs", () => {
			expect(
				validateDebugSpawnConstructionShape(baselineDebugRustSources),
			).toEqual([]);
		});

		it("requires debug/exec.rs to be present", () => {
			expect(validateDebugSpawnConstructionShape([])).toEqual([
				"debug spawn construction boundary requires debug/exec.rs",
			]);
		});

		it("requires a spawn_adapter_sync function to exist", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) =>
					source.replace(
						"fn spawn_adapter_sync(",
						"fn spawn_adapter_sync_renamed(",
					),
			);
			expect(validateDebugSpawnConstructionShape(mutated)).toEqual([
				"debug/exec.rs must define spawn_adapter_sync",
			]);
		});

		it("rejects a shell interpreter passed to Command::new", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(constructionAnchor)).toBe(true);
					return source.replace(
						constructionAnchor,
						`${constructionAnchor}\n    let _sh = Command::new("sh");`,
					);
				},
			);
			const failures = validateDebugSpawnConstructionShape(mutated);
			expect(
				failures.some((failure) =>
					failure.includes("must not spawn a shell interpreter"),
				),
			).toBe(true);
		});

		it("rejects format! feeding into the spawned command", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(constructionAnchor)).toBe(true);
					return source.replace(
						constructionAnchor,
						`${constructionAnchor}\n    let _joined = format!("{} extra", descriptor.command);`,
					);
				},
			);
			const failures = validateDebugSpawnConstructionShape(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must not build the spawned program or its arguments via format!",
					),
				),
			).toBe(true);
		});

		it('rejects a shell "-c" literal argument', () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(constructionAnchor)).toBe(true);
					return source.replace(
						constructionAnchor,
						`${constructionAnchor}\n    command.arg("-c");`,
					);
				},
			);
			const failures = validateDebugSpawnConstructionShape(mutated);
			expect(
				failures.some((failure) =>
					failure.includes('must not pass a shell "-c" argument'),
				),
			).toBe(true);
		});

		it("rejects a program name that is not Command::new(&descriptor.command)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(constructionAnchor)).toBe(true);
					return source.replace(
						constructionAnchor,
						'    let mut command = Command::new("hardcoded-adapter");\n    command.args(&descriptor.args);',
					);
				},
			);
			const failures = validateDebugSpawnConstructionShape(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must construct the child process via Command::new(&descriptor.command)",
					),
				),
			).toBe(true);
		});

		it("rejects an argv source that is not .args(&descriptor.args)", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => {
					expect(source.includes(constructionAnchor)).toBe(true);
					return source.replace(
						constructionAnchor,
						'    let mut command = Command::new(&descriptor.command);\n    command.args(["--flag"]);',
					);
				},
			);
			const failures = validateDebugSpawnConstructionShape(mutated);
			expect(
				failures.some((failure) =>
					failure.includes("must pass argv via .args(&descriptor.args)"),
				),
			).toBe(true);
		});

		it("rejects removing the selected-root cwd from the spawned adapter", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/exec.rs",
				(source) => source.replace("    command.current_dir(cwd);\n", ""),
			);
			expect(validateDebugSpawnConstructionShape(mutated)).toContain(
				"debug/exec.rs spawn_adapter_sync must set current_dir(cwd) to the selected authorized root",
			);
		});
	});

	describe("validateDebugFramingBounds", () => {
		it("passes for the real, unmodified debug/framing.rs", () => {
			expect(validateDebugFramingBounds(baselineDebugRustSources)).toEqual([]);
		});

		it("requires debug/framing.rs to be present", () => {
			expect(validateDebugFramingBounds([])).toEqual([
				"debug framing boundary requires debug/framing.rs",
			]);
		});

		it("rejects a widened MAX_DAP_MESSAGE_BYTES", () => {
			const anchor =
				"pub(crate) const MAX_DAP_MESSAGE_BYTES: usize = 67_108_864; // 64 MiB";
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/framing.rs",
				(source) => {
					expect(source.includes(anchor)).toBe(true);
					return source.replace(
						anchor,
						"pub(crate) const MAX_DAP_MESSAGE_BYTES: usize = 134_217_728; // 128 MiB",
					);
				},
			);
			expect(validateDebugFramingBounds(mutated)).toContain(
				"debug/framing.rs must define exactly one MAX_DAP_MESSAGE_BYTES: usize = 67108864",
			);
		});

		it("rejects a narrowed MAX_DAP_HEADER_BYTES", () => {
			const anchor =
				"pub(crate) const MAX_DAP_HEADER_BYTES: usize = 8_192; // 8 KiB";
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/framing.rs",
				(source) => {
					expect(source.includes(anchor)).toBe(true);
					return source.replace(
						anchor,
						"pub(crate) const MAX_DAP_HEADER_BYTES: usize = 4_096; // 4 KiB",
					);
				},
			);
			expect(validateDebugFramingBounds(mutated)).toContain(
				"debug/framing.rs must define exactly one MAX_DAP_HEADER_BYTES: usize = 8192",
			);
		});

		it("rejects MAX_DAP_MESSAGE_BYTES being declared but never referenced by the decoder", () => {
			const anchor = "if content_length > MAX_DAP_MESSAGE_BYTES {";
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/framing.rs",
				(source) => {
					expect(source.includes(anchor)).toBe(true);
					return source.replace(anchor, "if content_length > 67_108_864 {");
				},
			);
			const failures = validateDebugFramingBounds(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must reference MAX_DAP_MESSAGE_BYTES in its decoder logic, not just declare it",
					),
				),
			).toBe(true);
		});

		it("rejects MAX_DAP_HEADER_BYTES being declared but never referenced by the decoder", () => {
			const mutated = withMutatedDebugSource(
				"src-tauri/src/debug/framing.rs",
				(source) => {
					const withoutFirstUse = source.replace(
						"if self.buffer.len() > MAX_DAP_HEADER_BYTES {",
						"if self.buffer.len() > 8_192 {",
					);
					expect(withoutFirstUse).not.toEqual(source);
					const withoutSecondUse = withoutFirstUse.replace(
						"if header_block_len > MAX_DAP_HEADER_BYTES {",
						"if header_block_len > 8_192 {",
					);
					expect(withoutSecondUse).not.toEqual(withoutFirstUse);
					return withoutSecondUse;
				},
			);
			const failures = validateDebugFramingBounds(mutated);
			expect(
				failures.some((failure) =>
					failure.includes(
						"must reference MAX_DAP_HEADER_BYTES in its decoder logic, not just declare it",
					),
				),
			).toBe(true);
		});
	});
});

describe("Plain F150 Debug rootId IPC boundary Harness", () => {
	const baselineRust = Object.freeze([
		{
			relativePath: "src-tauri/src/debug/dto.rs",
			source: readFileSync(
				new URL("../../src-tauri/src/debug/dto.rs", import.meta.url),
				"utf8",
			),
		},
	]);
	const baselineApp = Object.freeze(
		[
			"app/platform/tauri/contracts.ts",
			"app/platform/tauri/debug-codec.ts",
			"app/platform/tauri/native.ts",
		].map((relativePath) => ({
			relativePath,
			source: readFileSync(
				new URL(`../../${relativePath}`, import.meta.url),
				"utf8",
			),
		})),
	);
	const mutateRust = (mutate) =>
		baselineRust.map((entry) => ({ ...entry, source: mutate(entry.source) }));
	const mutateApp = (relativePath, mutate) =>
		baselineApp.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);

	it("passes for the real root-scoped Debug DTO, codec, bridge, and native route", () => {
		expect(validateDebugRootIpcBoundary(baselineRust, baselineApp)).toEqual([]);
	});

	it("rejects removing root_id from either Rust request surface", () => {
		const widened = mutateRust((source) =>
			source.replace("    pub root_id: RootId,\n", ""),
		);
		expect(validateDebugRootIpcBoundary(widened, baselineApp)).toContain(
			"Debug session-start and set-breakpoints DTOs must retain their exact audited rootId-bearing fields",
		);
	});

	it("rejects bypassing frozen rootId validation in the TypeScript codec", () => {
		const widened = mutateApp("app/platform/tauri/debug-codec.ts", (source) =>
			source.replace(
				"rootId: frozenRootId(rootId),",
				"rootId: rootId as string,",
			),
		);
		expect(validateDebugRootIpcBoundary(baselineRust, widened)).toContain(
			"debug-codec.ts must validate and serialize rootId for session-start and set-breakpoints requests",
		);
	});

	it("rejects dropping rootId from native launch forwarding", () => {
		const widened = mutateApp("app/platform/tauri/native.ts", (source) =>
			source.replace(
				"frozenDebugSessionStartRequest(\n\t\t\t\trootId,",
				"frozenDebugSessionStartRequest(",
			),
		);
		expect(validateDebugRootIpcBoundary(baselineRust, widened)).toContain(
			"native.ts must forward the explicit debug rootId through launch, attach, and setBreakpoints",
		);
	});
});

describe("Plain F100 S1 debug adapter confirmation command registration Harness", () => {
	const debugCommandsSource = readFileSync(
		new URL("../../src-tauri/src/debug/commands.rs", import.meta.url),
		"utf8",
	);
	const libSource = readFileSync(
		new URL("../../src-tauri/src/lib.rs", import.meta.url),
		"utf8",
	);

	const baselineCommandRustSources = Object.freeze([
		{
			relativePath: "src-tauri/src/debug/commands.rs",
			source: debugCommandsSource,
		},
		{ relativePath: "src-tauri/src/lib.rs", source: libSource },
	]);

	it("passes for the real, unmodified debug command files", () => {
		expect(
			validateDebugCommandRegistration(baselineCommandRustSources),
		).toEqual([]);
	});

	it("requires debug/commands.rs to be present", () => {
		const missingFile = baselineCommandRustSources.filter(
			(entry) => entry.relativePath !== "src-tauri/src/debug/commands.rs",
		);
		expect(validateDebugCommandRegistration(missingFile)).toContain(
			"command registration boundary requires src-tauri/src/debug/commands.rs",
		);
	});

	it("fails if debug_adapter_confirmation_state's body is rewired to a different service call", () => {
		const rewired = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/debug/commands.rs"
				? {
						...entry,
						source: entry.source.replace(
							".is_confirmed(workspace.inner(), window.label(), &request)",
							'.is_confirmed(workspace.inner(), "main", &request)',
						),
					}
				: entry,
		);
		expect(validateDebugCommandRegistration(rewired)).toContain(
			"debug_adapter_confirmation_state must contain only its audited confirmation-service route",
		);
	});

	it("fails if a debug command is missing from lib.rs's generate_handler", () => {
		const missingRegistration = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"            debug::commands::debug_adapter_confirmation_revoke,\n",
							"",
						),
					}
				: entry,
		);
		expect(validateDebugCommandRegistration(missingRegistration)).toContain(
			"src-tauri/src/lib.rs must register debug::commands::debug_adapter_confirmation_revoke exactly once in generate_handler",
		);
	});

	it("fails if a debug command is registered a second time (duplicate registration)", () => {
		const duplicated = baselineCommandRustSources.map((entry) =>
			entry.relativePath === "src-tauri/src/lib.rs"
				? {
						...entry,
						source: entry.source.replace(
							"            debug::commands::debug_adapter_confirmation_revoke,\n",
							"            debug::commands::debug_adapter_confirmation_revoke,\n            debug::commands::debug_adapter_confirmation_revoke,\n",
						),
					}
				: entry,
		);
		expect(validateDebugCommandRegistration(duplicated)).toContain(
			"src-tauri/src/lib.rs must register debug::commands::debug_adapter_confirmation_revoke exactly once in generate_handler",
		);
	});
});

describe("Plain F100 S4 runInTerminal boundary Harness", () => {
	const debugCommandsSource = readFileSync(
		new URL("../../src-tauri/src/debug/commands.rs", import.meta.url),
		"utf8",
	);
	const debugCommandsSourceOnly = Object.freeze([
		{
			relativePath: "src-tauri/src/debug/commands.rs",
			source: debugCommandsSource,
		},
	]);

	it("passes for the real, unmodified debug/commands.rs", () => {
		expect(validateDebugRunInTerminalBoundary(debugCommandsSourceOnly)).toEqual(
			[],
		);
	});

	it("requires debug/commands.rs to be present", () => {
		expect(validateDebugRunInTerminalBoundary([])).toEqual([
			"debug runInTerminal boundary requires debug/commands.rs",
		]);
	});

	it("requires handle_run_in_terminal_reverse_request to be defined", () => {
		const mutated = [
			{
				relativePath: "src-tauri/src/debug/commands.rs",
				source: debugCommandsSource.replace(
					"pub(crate) fn handle_run_in_terminal_reverse_request(",
					"pub(crate) fn renamed_handler(",
				),
			},
		];
		const failures = validateDebugRunInTerminalBoundary(mutated);
		expect(failures).toContain(
			"debug/commands.rs must define handle_run_in_terminal_reverse_request",
		);
		// Renaming only the function's own signature line leaves its body
		// (and the `terminal.start_program(...)` call inside it) completely
		// intact, so the crate-wide call-site count is unaffected by this
		// particular mutation — this is a deliberately narrow test of the
		// "is it defined at all" check in isolation, not a combined scenario.
		expect(failures).toHaveLength(1);
	});

	it("fails if the handler stops calling terminal.start_program", () => {
		const mutated = [
			{
				relativePath: "src-tauri/src/debug/commands.rs",
				source: debugCommandsSource.replace(
					"tauri::async_runtime::block_on(terminal.start_program(",
					"tauri::async_runtime::block_on(terminal.start_something_else(",
				),
			},
		];
		expect(validateDebugRunInTerminalBoundary(mutated)).toContain(
			"handle_run_in_terminal_reverse_request must call terminal.start_program(...) — the only sanctioned way to spawn a runInTerminal-launched process",
		);
	});

	it("does not flag an unrelated Command::new elsewhere in the file as a runInTerminal bypass", () => {
		const mutated = [
			{
				relativePath: "src-tauri/src/debug/commands.rs",
				source: debugCommandsSource.replace(
					"pub(crate) fn handle_run_in_terminal_reverse_request(",
					'pub(crate) fn handle_run_in_terminal_reverse_request_marker() { let _ = std::process::Command::new("sh"); }\npub(crate) fn handle_run_in_terminal_reverse_request(',
				),
			},
		];
		// The injected marker function is a distinct, separate function (not
		// inside the real handler's own body), so this proves the "no direct
		// Command::new" check only inspects the handler's own isolated body
		// (via `rustFunctionBody`), not the whole file — an unrelated
		// `Command::new` elsewhere must not be mistaken for a runInTerminal
		// bypass by this contract.
		expect(validateDebugRunInTerminalBoundary(mutated)).toEqual([]);
	});

	it("fails if the handler's own body is rewritten to spawn a Command directly", () => {
		const mutated = [
			{
				relativePath: "src-tauri/src/debug/commands.rs",
				source: debugCommandsSource.replace(
					"let result = tauri::async_runtime::block_on(terminal.start_program(",
					'let _bypass = std::process::Command::new("sh");\n    let result = tauri::async_runtime::block_on(terminal.start_program(',
				),
			},
		];
		expect(validateDebugRunInTerminalBoundary(mutated)).toContain(
			"handle_run_in_terminal_reverse_request must not construct a subprocess directly — it must delegate to TerminalService::start_program",
		);
	});

	it("requires exactly one non-test start_program call site across the crate", () => {
		const duplicated = [
			...debugCommandsSourceOnly,
			{
				relativePath: "src-tauri/src/debug/duplicate.rs",
				source: "fn other() { let _ = terminal.start_program(1); }",
			},
		];
		const failures = validateDebugRunInTerminalBoundary(duplicated);
		expect(
			failures.some((failure) =>
				failure.includes(
					"TerminalService::start_program must have exactly one non-test production call site in src-tauri/src (found 2)",
				),
			),
		).toBe(true);
	});

	it("excludes call sites inside *tests.rs files from the crate-wide count", () => {
		const withTestCallSite = [
			...debugCommandsSourceOnly,
			{
				relativePath: "src-tauri/src/debug/service/tests.rs",
				source: "fn other() { let _ = terminal.start_program(1); }",
			},
		];
		expect(validateDebugRunInTerminalBoundary(withTestCallSite)).toEqual([]);
	});
});

describe("Plain F100 S1 debug adapter confirmation TypeScript boundary Harness", () => {
	const requiredPaths = Object.freeze([
		"app/platform/tauri/contracts.ts",
		"app/platform/tauri/native.ts",
		"app/platform/tauri/browser-mock.ts",
		"app/features/debug/plain-debug-adapter-confirmation.ts",
		"app/features/debug/plain-debug-adapter-launch.ts",
	]);
	const baselineAppSources = Object.freeze(
		requiredPaths.map((relativePath) => ({
			relativePath,
			source: readFileSync(
				new URL(`../../${relativePath}`, import.meta.url),
				"utf8",
			),
		})),
	);

	function withMutatedSource(relativePath, mutate) {
		return baselineAppSources.map((entry) =>
			entry.relativePath === relativePath
				? { ...entry, source: mutate(entry.source) }
				: entry,
		);
	}

	it("passes for the real, unmodified files", () => {
		expect(
			validateDebugAdapterConfirmationBoundary(baselineAppSources),
		).toEqual([]);
	});

	it("requires every audited file to be present", () => {
		for (const relativePath of requiredPaths) {
			const missing = baselineAppSources.filter(
				(entry) => entry.relativePath !== relativePath,
			);
			expect(validateDebugAdapterConfirmationBoundary(missing)).toContain(
				`debug adapter confirmation boundary requires ${relativePath}`,
			);
		}
	});

	it("rejects a second call site for debugAdapterConfirmationState outside resolveDebugAdapterConfirmation", () => {
		const mutated = withMutatedSource(
			"app/features/debug/plain-debug-adapter-launch.ts",
			(source) =>
				source.replace(
					"export async function prepareDebugAdapterLaunch(",
					"function sneakyBridgeCall(bridge) { void bridge.debugAdapterConfirmationState({ command: '', args: [], transport: 'stdio' }); }\nexport async function prepareDebugAdapterLaunch(",
				),
		);
		const failures = validateDebugAdapterConfirmationBoundary(mutated);
		expect(
			failures.some((failure) =>
				failure.includes(
					"must not consume debugAdapterConfirmationState outside resolveDebugAdapterConfirmation's single audited call site",
				),
			),
		).toBe(true);
	});

	it("rejects a second call site for resolveDebugAdapterConfirmation outside prepareDebugAdapterLaunch", () => {
		const mutated = withMutatedSource(
			"app/features/debug/plain-debug-adapter-launch.ts",
			(source) =>
				`${source}\nasync function anotherCaller(bridge, dialogService) {\n\tawait resolveDebugAdapterConfirmation(bridge, dialogService, { subject: { command: "", args: [], transport: "stdio" }, configSource: "" });\n}\n`,
		);
		const failures = validateDebugAdapterConfirmationBoundary(mutated);
		expect(
			failures.some((failure) =>
				failure.includes(
					"must not call resolveDebugAdapterConfirmation outside plain-debug-adapter-launch.ts's prepareDebugAdapterLaunch",
				),
			),
		).toBe(true);
	});

	it("rejects plain-debug-adapter-confirmation.ts gaining an import", () => {
		const mutated = withMutatedSource(
			"app/features/debug/plain-debug-adapter-confirmation.ts",
			(source) => `import { readFileSync } from "node:fs";\n${source}`,
		);
		const failures = validateDebugAdapterConfirmationBoundary(mutated);
		expect(
			failures.some((failure) => failure.includes("must not import anything")),
		).toBe(true);
	});

	it("rejects resolveDebugAdapterConfirmation skipping the dialog for an unconfirmed subject", () => {
		const mutated = withMutatedSource(
			"app/features/debug/plain-debug-adapter-confirmation.ts",
			(source) =>
				source.replace(
					'if (state.confirmed) {\n\t\treturn Object.freeze({ kind: "already-confirmed" });\n\t}',
					'if (state.confirmed || true) {\n\t\treturn Object.freeze({ kind: "already-confirmed" });\n\t}',
				),
		);
		const failures = validateDebugAdapterConfirmationBoundary(mutated);
		expect(
			failures.some((failure) =>
				failure.includes(
					"must query the persisted decision first, always show the dialog for an unconfirmed subject",
				),
			),
		).toBe(true);
	});

	it("rejects a declaration count other than exactly one per platform file", () => {
		const mutated = withMutatedSource(
			"app/platform/tauri/native.ts",
			(source) =>
				source.replace(
					"debugAdapterConfirmationState: async (descriptor) => {",
					"debugAdapterConfirmationStateUnused: async (descriptor) => {",
				),
		);
		const failures = validateDebugAdapterConfirmationBoundary(mutated);
		expect(
			failures.some((failure) =>
				failure.includes(
					"app/platform/tauri/native.ts must declare debugAdapterConfirmationState exactly once in its audited bridge surface",
				),
			),
		).toBe(true);
	});
});

describe("Plain F220 S2 RootBackend ownership boundary", () => {
	const rootBackendSources = [
		{
			relativePath: "src-tauri/src/workspace/mod.rs",
			source: `
enum RootBackend {
  Local { directory: cap_std::fs::Dir, canonical_path: std::path::PathBuf },
  RemoteSsh { session_id: crate::remote::dto::RemoteSessionId, base_path: String, host_key_fingerprint: String },
}
impl RootBackend {
  fn local_dir(&self) -> Result<&cap_std::fs::Dir, CommandError> {
    match self {
      Self::Local { directory, .. } => Ok(directory),
      Self::RemoteSsh { .. } => Err(root_backend_unsupported()),
    }
  }
}
`,
		},
		{
			relativePath: "src-tauri/src/search/file_search.rs",
			source: `
use crate::workspace::WorkspaceRootLease;
fn open(lease: &WorkspaceRootLease) -> cap_std::fs::Dir {
  lease.directory().try_clone().unwrap()
}
`,
		},
	];

	it("accepts RootBackend confined to workspace/mod.rs", () => {
		expect(validateRootBackendOwnershipBoundary(rootBackendSources)).toEqual(
			[],
		);
	});

	it("rejects a consumption point that matches RootBackend directly instead of going through WorkspaceScope::lease/resolve", () => {
		const hostile = mutateWorkspaceSource(
			rootBackendSources,
			"src-tauri/src/search/file_search.rs",
			(source) =>
				`${source}
fn bypass(root: &super::workspace::RootBackend) -> Option<&cap_std::fs::Dir> {
  match root {
    super::workspace::RootBackend::Local { directory, .. } => Some(directory),
    super::workspace::RootBackend::RemoteSsh { .. } => None,
  }
}
`,
		);
		expect(validateRootBackendOwnershipBoundary(hostile)).toContain(
			"src-tauri/src/search/file_search.rs must not reference RootBackend — every consumption point must reach a local root through WorkspaceScope::lease/resolve/root_canonical_path, owned exclusively by src-tauri/src/workspace/mod.rs",
		);
	});

	it("ignores RootBackend spelled out inside comments or string literals", () => {
		const commented = mutateWorkspaceSource(
			rootBackendSources,
			"src-tauri/src/search/file_search.rs",
			(source) =>
				`${source}\n// Do not ever match on RootBackend here.\nconst NOTE: &str = "RootBackend";\n`,
		);
		expect(validateRootBackendOwnershipBoundary(commented)).toEqual([]);
	});
});
