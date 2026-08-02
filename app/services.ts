import getConfigurationServiceOverride from "@codingame/monaco-vscode-configuration-service-override";
import "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/browser/parts/dialogs/dialog.web.contribution";
import { DialogService } from "@codingame/monaco-vscode-dialogs-service-override/vscode/vs/workbench/services/dialogs/common/dialogService";
import getExplorerServiceOverride from "@codingame/monaco-vscode-explorer-service-override";
import getFilesServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getModelServiceOverride from "@codingame/monaco-vscode-model-service-override";
import getMultiDiffEditorServiceOverride from "@codingame/monaco-vscode-multi-diff-editor-service-override";
import getNotificationServiceOverride from "@codingame/monaco-vscode-notifications-service-override";
import { SCMService } from "@codingame/monaco-vscode-scm-service-override/vscode/vs/workbench/contrib/scm/common/scmService";
import getTextmateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getWorkbenchServiceOverride from "@codingame/monaco-vscode-workbench-service-override";
import { WorkingCopyEditorService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyEditorService";
import { WorkingCopyService } from "@codingame/monaco-vscode-working-copy-service-override/vscode/vs/workbench/services/workingCopy/common/workingCopyService";
import { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import { IExtensionResourceLoaderService } from "@codingame/monaco-vscode-api/vscode/vs/platform/extensionResourceLoader/common/extensionResourceLoader.service";
import { SyncDescriptor } from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors";
import {
	InstantiationType,
	registerSingleton,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/extensions";
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
import "./services/plain-workspace-backup-tracker";
import {
	PlainWorkspaceEditingService,
	PlainWorkspacesService,
} from "./services/plain-workspace-services";

/**
 * The only Workbench services directly selected by Plain. Core services pulled
 * in by initialize() remain inert; in particular no Extension Host is enabled.
 *
 * IWorkingCopyService/IWorkingCopyEditorService are wired from their exact
 * class submodules rather than the working-copy-service-override package's
 * aggregating default export. That default export unconditionally imports
 * browser/workingCopyBackupService.js and common/workingCopyHistoryService.js,
 * which register BrowserWorkingCopyBackupTracker and WorkingCopyHistoryTracker
 * as real Workbench contributions purely as an import-time side effect,
 * regardless of the factory's `storage` option. The history tracker calls
 * IFileService.cloneFile() on every save to snapshot local history, which
 * Plain's own files-service patch always rejects for plain-workspace
 * resources (clone is unsupported), producing an unhandled rejection on every
 * save.
 *
 * IWorkingCopyBackupService is now Plain's own Rust-backed
 * PlainWorkingCopyBackupService (./services/plain-workspace-backup-service)
 * rather than the missing-services.js no-op stub. Its restoration tracker
 * (PlainWorkingCopyBackupTracker, registered as an import-time side effect of
 * ./services/plain-workspace-backup-tracker below) extends the working-copy
 * override's exact, side-effect-free WorkingCopyBackupTracker submodule —
 * never the packaged BrowserWorkingCopyBackupTracker, whose beforeunload-only
 * shutdown veto does not fit Tauri's native window close.
 *
 * ISearchService is Plain's own PlainSearchService
 * (./features/search/plain-search-service), which extends the
 * search-service-override package's exact, unpatched SearchService submodule
 * rather than that package's aggregating default export/root factory — see
 * that file's own doc comment for why the root factory crashes with no
 * `file:` provider. The package is never spread here.
 *
 * IExtensionResourceLoaderService is Plain's own
 * PlainExtensionResourceLoaderService (./features/themes/plain-theme-
 * registry), a thin IFileService-backed reader — neither
 * getThemeServiceOverride() nor getFilesServiceOverride() registers a real
 * implementation for this token, leaving the missing-services.js stub
 * (every method throws) in place, which would make every color theme
 * (built-in or, in a later slice, imported) fail to load. See that file's
 * own doc comment for why this is safe (it adds no new filesystem access).
 *
 * ISCMService is bound directly to
 * `@codingame/monaco-vscode-scm-service-override`'s exact
 * `common/scmService.js` submodule (`SCMService` — audited clean of any
 * Chat/AI import, unlike that package's `browser/scm.contribution.js` and
 * `browser/scmInput.js`/`browser/quickDiffModel.js` siblings), never that
 * package's own aggregating `index.js` default export — the same
 * "extends/binds the exact clean submodule, never the package root" shape
 * `ISearchService`'s own binding above already established. See
 * `app/features/scm/plain-scm-view.ts`'s module doc comment for the full
 * audit trail of why the package root is never imported at all.
 *
 * `getMultiDiffEditorServiceOverride` (`F090` S2) is called directly, exactly
 * like every other override above — its own default export is audited clean
 * of any Chat/AI reference (see
 * `scripts/plain/boundary-contracts.mjs`'s
 * `validateMultiDiffEditorOverrideImportBoundary` for the full audit trail);
 * unlike `ISCMService`'s own binding, there is no "extends the exact clean
 * submodule instead" exception needed here at all.
 *
 * `IExtensionService` (`F110` S5,
 * `docs/research/2026-07-28-legacy-retirement.md`) is Plain's own
 * PlainNullExtensionService (./services/plain-null-extension-service) rather
 * than the real, instantiated `ExtensionServiceOverride` the vendor's own
 * extensions-service-override package used to provide — that whole package
 * (11 bundle sources) is no longer imported anywhere once `services.js`'s
 * own `initialize()` stops spreading its `getServiceOverride()` output
 * (patched out; see `patches/@codingame__monaco-vscode-api@35.0.1.patch`).
 * `IExtensionService` itself cannot be dropped — dozens of always-constructed
 * Workbench parts and this package's own top-level `extensions` subpath
 * module (which Plain's theme-import feature uses) inject it as a
 * non-optional dependency — see that class's own doc comment for the full
 * audit trail and behavioral-parity argument.
 *
 * The `registerSingleton(IExtensionService, PlainNullExtensionService,
 * InstantiationType.Eager)` call directly below this comment (not inside
 * `createServiceOverrides()` itself) is not redundant with the
 * `[IExtensionService.toString()]: new SyncDescriptor(PlainNullExtensionService,
 * …)` entry inside the object literal further down. Vendor's own
 * `StandaloneServices.initialize()`
 * (`@codingame/monaco-vscode-api/vscode/src/vs/editor/standalone/browser/
 * standaloneServices.js`) only ever *applies* an entry from the `overrides`
 * object passed to it when its internal `serviceCollection` already holds
 * some `SyncDescriptor` for that token (`if (r instanceof SyncDescriptor) {
 * serviceCollection.set(...) }`); otherwise the override is silently
 * dropped on the floor. That baseline `SyncDescriptor` is only ever
 * populated from the global singleton registry
 * (`getSingletonServiceDescriptors()`, written to exclusively by
 * `registerSingleton()`) — both in `initialize()`'s own backfill loop and in
 * the very first `serviceCollection` snapshot taken when
 * `standaloneServices.js` itself first evaluates. Before this line existed,
 * *nothing* ever called `registerSingleton(IExtensionService, …)` (F110 S5's
 * patch deleted the vendor's own `registerSingleton(IExtensionService,
 * NullExtensionService, InstantiationType.Eager)` line from
 * `missing-services.js` without replacing it), so `IExtensionService` never
 * got a baseline descriptor, the object-literal override below was silently
 * dropped, and any consumer resolved through the global registry rather than
 * through this file's own override map failed outright — concretely,
 * `HoverService` (registered via `missing-services.js`'s own
 * `registerSingleton(IHoverService, HoverService, InstantiationType.Delayed)`)
 * lists `IExtensionService` as a required constructor dependency, so the very
 * first hover anywhere crashed instantiation with "[createInstance]
 * hoverService depends on extensionService which is NOT registered" — which
 * failed Plain's bootstrap outright, since bootstrap itself synchronously
 * resolves services that end up constructing `HoverService`. This statement
 * must run before `initialize()` is ever called; as a top-level statement in
 * this module, ordinary ES module evaluation order already guarantees that —
 * `app/main.ts` imports `createServiceOverrides` from this file (a static
 * import, so this whole module evaluates immediately) and only calls
 * `initialize()` later, inside its own `async` bootstrap function, long after
 * every statically imported module (this one included) has finished
 * evaluating.
 */
registerSingleton(
	IExtensionService,
	PlainNullExtensionService,
	InstantiationType.Eager,
);

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
