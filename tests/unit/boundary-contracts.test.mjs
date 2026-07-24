import { readFileSync } from "node:fs";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import {
	validateCapabilityFiles,
	validateDialogOverrideImportBoundary,
	validateDialogServiceOverride,
	validateDialogSurfaceBoundary,
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
	validateWorkspaceDeleteFailureBrowserFixture,
	validateWorkspaceDeleteTypeScriptBoundary,
	validateWorkspaceMoveBoundary,
	validateWorkspaceMoveCommandRegistration,
	validateWorkspaceMoveFailureBrowserFixture,
	validateWorkspaceProviderBootstrap,
	validateWorkspaceProviderCopyBoundary,
	validateWorkspaceRustBoundary as validateWorkspaceRustBoundaryContract,
	validateWorkspaceVersionedWriteBoundary,
	validateWorkspaceWatcherBoundary,
	validateWorkingCopyOverrideImportBoundary,
	validateTerminalRustBoundary,
	validateTrustTerminalCommandRegistration,
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

const baselineConfig = {
	$schema: "https://schema.tauri.app/config/2",
	build: {
		beforeDevCommand: "pnpm dev",
		devUrl: "http://127.0.0.1:1420",
		beforeBuildCommand: "pnpm build",
		frontendDist: "../dist",
	},
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
	description: "Minimum capability for the Plain main window",
	windows: ["main"],
	permissions: ["core:event:allow-listen", "core:event:allow-unlisten"],
};

const baselineServiceOverrides = `
import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
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
// Rust-backed backup SyncDescriptor, and the Plain search SyncDescriptor
// must all be present together as the exact closed middle-descriptor set.
const workingCopyServiceOverridesFixture = `
import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";
import { WorkingCopyService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IExtensionResourceLoaderService } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import { IWorkspacesService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service";
import { ISearchService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/search/common/search.service";
import { ILanguageStatusService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/languageStatus/common/languageStatusService.service";
import { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";
import { IWorkingCopyEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService.service";
import { IWorkingCopyService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyService.service";
import { IWorkspaceEditingService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service";
import { PlainSearchService } from "./features/search/plain-search-service";
import { PlainExtensionResourceLoaderService } from "./features/themes/plain-theme-registry";
import { EmptyLanguageStatusService } from "./services/empty-language-status";
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
				"let snapshot = state.scope.snapshot();",
				"let snapshot = state.scope.snapshot();\n        if snapshot.roots().is_empty() {\n            return Ok(snapshot);\n        }",
			],
			[
				finishPickerTail,
				finishPickerTail.replace(
					"watcher.revoke(registration);",
					"let _ = registration;",
				),
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

	it("locks provider authorization typestate, permanent commit and closed event outcomes", () => {
		const provider = "app/features/workspace/file-system-provider.ts";
		const cases = [
			[
				"authorizationSnapshot.permanent !== true",
				"authorizationSnapshot.permanent !== false",
			],
			[
				"beginPlainWorkspaceDeleteProviderDispatch(authorization);",
				"void authorization;",
			],
			[
				"result = decodeWorkspaceDeleteResult(",
				"result = await Promise.resolve(",
			],
			[
				"completePlainWorkspaceDeleteProviderResult(authorization, result);",
				"void result;",
			],
			['if (result.status !== "deleted")', 'if (result.status === "deleted")'],
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

	it("keeps confirmed delete inside the final all-five capability contract with permanent non-Trash events", () => {
		const provider = "app/features/workspace/file-system-provider.ts";
		for (const [from, to, expected] of [
			[
				`(allowsMutationDispatch
				? FileSystemProviderCapabilities.FileFolderCopy
				: FileSystemProviderCapabilities.Readonly);`,
				"FileSystemProviderCapabilities.FileFolderCopy;",
				"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
			],
			[
				"? FileSystemProviderCapabilities.FileFolderCopy",
				"? FileSystemProviderCapabilities.Trash",
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
					"constructor(bridge: PlainBridge, allowsMutationDispatch: boolean)",
					"constructor(bridge: PlainBridge)",
				)}`,
		);
		expect(validateWorkspaceDeleteTypeScriptBoundary(detachedPolicy)).toContain(
			"confirmed delete requires the final all-five writable-or-readonly provider capability contract",
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
			(allowsMutationDispatch
				? FileSystemProviderCapabilities.FileFolderCopy
				: FileSystemProviderCapabilities.Readonly);`;
	const capabilityContractFailure =
		"Plain workspace provider capabilities must be constructed once as all-five FileReadWrite | FileFolderCopy or FileReadWrite | Readonly";

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

	it("accepts only the immutable all-five writable-or-readonly capability assignment", () => {
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
				"(allowsMutationDispatch\n\t\t\t\t? FileSystemProviderCapabilities.FileFolderCopy\n\t\t\t\t: FileSystemProviderCapabilities.Readonly)",
				"(allowsMutationDispatch\n\t\t\t\t? FileSystemProviderCapabilities.Readonly\n\t\t\t\t: FileSystemProviderCapabilities.FileFolderCopy)",
			),
			mutateProvider("(allowsMutationDispatch\n", "(!allowsMutationDispatch\n"),
			mutateProvider(
				"? FileSystemProviderCapabilities.FileFolderCopy",
				"? FileSystemProviderCapabilities.FileFolderCopy | FileSystemProviderCapabilities.Readonly",
			),
			mutateProvider(
				"readonly capabilities: FileSystemProviderCapabilities;",
				"readonly capabilities = this.#allowsMutationDispatch ? FileSystemProviderCapabilities.FileFolderCopy : FileSystemProviderCapabilities.Readonly;",
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
		this.#allowsMutationDispatch = allowsMutationDispatch;`;
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
				privateAssignments,
				`this.#allowsMutationDispatch = allowsMutationDispatch;
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

	it("rejects every capability outside the final two sets plus computed, duplicate and inherited surfaces", () => {
		for (const flag of [
			"PathCaseSensitive",
			"Trash",
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
				"FileSystemProviderCapabilities.Readonly);",
				"FileSystemProviderCapabilities.Readonly |\n\t\t\t\tFileSystemProviderCapabilities." +
					flag +
					");",
			);
			expect(validateWorkspaceProviderCopyBoundary(hostile)).toContain(
				`Plain workspace provider must not advertise ${flag} outside the final two capability sets`,
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
			"implements IFileSystemProviderWithFileReadWriteCapability",
			"extends WritableProvider implements IFileSystemProviderWithFileReadWriteCapability",
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
			"provider change events must remain confined to the audited create, copy, rename, move and rescan closure",
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
			"provider change events must remain confined to the audited create, copy, rename, move and rescan closure",
		);

		const extraFireCreated = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tthis.fireCreated(resource);",
		);
		expect(validateWorkspaceProviderCopyBoundary(extraFireCreated)).toContain(
			"provider change events must remain confined to the audited create, copy, rename, move and rescan closure",
		);

		const extraWatchStateReference = mutateProvider(
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {",
			"\tasync readdir(resource: URI): Promise<[string, FileType][]> {\n\t\tvoid this.#watchState.size;",
		);
		expect(
			validateWorkspaceProviderCopyBoundary(extraWatchStateReference),
		).toContain(
			"Plain workspace native authority must remain sealed in the exact #bridge, #allowsMutationDispatch and #watchState private-field consumers",
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
					"this.fireCreated(resolved.resource);",
					"this.fireCreated(resource);",
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
			"mutation policy must decode one own-data DTO into an immutable all-five boolean",
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
				"provider delete must consume one authorization through prepared/inFlight/terminal typestate and dispatch exactly one permanent commit",
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
			"Plain workspace provider constructor must retain only the bridge, immutable mutation boolean and exact capability assignment",
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
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void>",
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tstatus: string = "targetPublishedSourceRetained",\n): Promise<void>',
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
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void> {\n\tawait page.addInitScript(",
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void> {\n\tvoid moveIncompleteScenarios;\n\tawait page.addInitScript(",
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
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void>",
				'deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n\tstatus: string = "entryRetained",\n): Promise<void>',
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
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void> {\n\tawait page.addInitScript(",
				"deleteIncompleteScenarios: readonly TestMultiRootDeleteIncompleteScenario[] = [],\n): Promise<void> {\n\tvoid deleteIncompleteScenarios;\n\tawait page.addInitScript(",
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
import { initialize } from "@codingame/monaco-vscode-api";
import { registerCustomProvider } from "@codingame/monaco-vscode-files-service-override";
import { createPlainWorkspaceFileSystemProvider, PLAIN_WORKSPACE_SCHEME } from "./features/workspace/file-system-provider";
import { registerWorkspaceDeleteCoordinator } from "./features/workspace/delete-coordinator";
import { createBridge } from "./platform/tauri";
import { configurePlainSearchBridge } from "./features/search/plain-search-service";
import { configurePlainWorkingCopyBackupBridge } from "./services/plain-workspace-backup-service";

async function bootstrap() {
const bridge = createBridge();
const workspaceCapabilities = await bridge.workspaceCapabilities();
const workspaceFileSystemProvider = createPlainWorkspaceFileSystemProvider(
  bridge,
  workspaceCapabilities,
);
const workspaceDeleteCoordinator = registerWorkspaceDeleteCoordinator(
  bridge,
  workspaceFileSystemProvider,
);
registerCustomProvider(PLAIN_WORKSPACE_SCHEME, workspaceFileSystemProvider);
const initialWorkspaceSnapshot = await bridge.workspaceSnapshot();
window.addEventListener("pagehide", () => {
  workspaceDeleteCoordinator.dispose();
}, { once: true });
configurePlainWorkingCopyBackupBridge(bridge);
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
				"app/main.ts must register one legacy or two audited custom workspace providers",
				"app/main.ts must unconditionally register only the audited plain-workspace provider",
				"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
			]),
		);
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
			"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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
);
`,
			"",
		);
		expect(validateWorkspaceProviderBootstrap(missingRegistration)).toEqual(
			expect.arrayContaining([
				"app/main.ts must register exactly one audited workspace delete coordinator",
				"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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
);`,
			);
		expect(validateWorkspaceProviderBootstrap(lateCoordinator)).toContain(
			"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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
			"bootstrap order must remain createBridge -> capabilities -> provider -> delete coordinator -> register -> snapshot -> initialize",
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

describe("Plain F070 S1 trust/terminal Rust boundary contracts", () => {
	const terminalCargo = `
[dependencies]
portable-pty = "=0.9.0"
`;

	const exactPortablePtyDependency = Object.freeze({
		name: "portable-pty",
		req: "=0.9.0",
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
`;
	const terminalShellSource = `
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
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
	]);

	function withHostileTerminalFile(relativePath, source) {
		return [...baselineTerminalRustSources, { relativePath, source }];
	}

	it("passes for a clean terminal domain with the exact pinned dependency", () => {
		expect(
			validateTerminalRustBoundary(baselineTerminalRustSources, terminalCargo, [
				exactPortablePtyDependency,
			]),
		).toEqual([]);
	});

	it("requires the exact portable-pty =0.9.0 pin in Cargo.toml and metadata", () => {
		expect(
			validateTerminalRustBoundary(
				baselineTerminalRustSources,
				"[dependencies]\n",
				[exactPortablePtyDependency],
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
			[exactPortablePtyDependency],
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
			[exactPortablePtyDependency],
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
			[exactPortablePtyDependency],
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
			[exactPortablePtyDependency],
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
			]),
		).toContain(
			"terminal budget boundary requires src-tauri/src/terminal/mod.rs",
		);
	});

	it("locks the environment allowlist name list and the two fixed overrides exactly", () => {
		const widenedAllowlist = baselineTerminalRustSources
			.filter(
				(entry) => entry.relativePath !== "src-tauri/src/terminal/shell.rs",
			)
			.concat({
				relativePath: "src-tauri/src/terminal/shell.rs",
				source: `
pub(crate) const TERMINAL_ENV_PASSTHROUGH_NAMES: &[&str] =
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "SECRET_TOKEN"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "xterm-256color");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
`,
			});
		expect(
			validateTerminalRustBoundary(widenedAllowlist, terminalCargo, [
				exactPortablePtyDependency,
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
    &["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR"];
pub(crate) const TERMINAL_ENV_LC_PREFIX: &str = "LC_";
pub(crate) const TERMINAL_ENV_TERM: (&str, &str) = ("TERM", "dumb");
pub(crate) const TERMINAL_ENV_COLORTERM: (&str, &str) = ("COLORTERM", "truecolor");
`,
			});
		expect(
			validateTerminalRustBoundary(wrongTerm, terminalCargo, [
				exactPortablePtyDependency,
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
