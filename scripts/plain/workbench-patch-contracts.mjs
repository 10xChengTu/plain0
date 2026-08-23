import { createHash } from "node:crypto";

const PATCH_CONTRACTS = Object.freeze([
	Object.freeze({
		packageName: "@codingame/monaco-vscode-api@35.0.1",
		patchPath: "patches/@codingame__monaco-vscode-api@35.0.1.patch",
		// `F110` S2 (`docs/research/2026-07-28-legacy-retirement.md`, decision 1):
		// added two new hunks on top of the pre-existing diff — a brand-new
		// `missing-services.js` block (this file was never patched before) and
		// an addition to the already-patched `services.js` block. Both remove
		// the `import`/`class`/`registerSingleton` (or, for `services.js`,
		// `export { X } from 'Y'` re-export) three-part registration for the
		// `mcp` (16), `syncEditSessions` (8) and 9-of-10 non-`globalCompositeBar`
		// `authAccount` debt-source tokens — see
		// `scripts/plain/missing-services-patch-contract.mjs` for the paired
		// shape assertion this sha/hunk lock does not by itself provide
		// (detecting a *semantically* drifted but still-diff-shaped upstream
		// file). `IAuthenticationService`'s own import/class/registerSingleton
		// triple in `missing-services.js` was deliberately *not* removed by S2:
		// `globalCompositeBar.js` (kept then, real Activity Bar code) injected
		// it as a non-optional constructor dependency
		// (`AccountsActivityActionViewItem`/`SimpleAccountActivityActionViewItem`),
		// so leaving it unbound would have thrown at Activity Bar construction
		// time — this was the one token S2's dependency sweep found with a
		// real, currently-bundled required consumer outside
		// `missing-services.js`.
		//
		// `F110` S4 (same research document, "主导会话裁定" point 2) adds a third
		// hunk to the `missing-services.js` block (removing the
		// `IAuthenticationService` import/class/registerSingleton triple S2 had
		// to keep) plus a brand-new `activitybarPart.js` hunk (two-line change:
		// the `GlobalCompositeBar` import and its sole
		// `instantiationService.createInstance(...)` call site are repointed at
		// `PlainGlobalCompositeBar`, this repo's own
		// `app/features/workbench/plain-global-composite-bar.ts` migration of
		// the "Manage" gear — see that file's own doc comment). The
		// already-patched `globalCompositeBar.js` hunks are untouched: the file
		// itself simply becomes unreachable now that `activitybarPart.js` no
		// longer imports it, which is why `IAuthenticationService`'s
		// registration is finally provably dead. See
		// `scripts/plain/missing-services-patch-contract.mjs`'s own S4
		// paragraph for the full token-count accounting.
		//
		// `F110` S6 (same research document, "主导会话裁定" point 4 — the six
		// categories `check-bundle.mjs` had never covered before `F110` S0
		// added them) extends the same two-file surgery to 32 more tokens
		// spanning `notebook`/`tasks`/`testing`/`remote`/`languagePacks`
		// (`languageDetection`/`treeSitter` were deliberately left untouched —
		// see below). Unlike every earlier slice, three tokens this slice's
		// dependency-graph audit found are real, non-optional, always-reached
		// consumers were deliberately *kept* registered despite being in one of
		// this slice's five target categories — the same "share a real
		// consumer, don't remove for zero benefit" judgment S2/S3/S5 already
		// established for `IAuthenticationService`/the seven chat tokens/the
		// nine `extensionRuntime` tokens: `IRemoteAgentService` (`remote`) is a
		// non-optional constructor `__param` of `@codingame/monaco-vscode-base-service-override`'s
		// `BrowserPathServiceOverride`/`LabelService` — both spread
		// unconditionally into `services.js`'s own `initialize()` via that
		// package's `getServiceOverride()` default export, so every real
		// Workbench boot needs `IPathService`/`ILabelService`, which need this;
		// `INotebookDocumentService` (`notebook`) is a non-optional `__param`
		// of `workbench/browser/labels.js`'s `ResourceLabelWidget`, constructed
		// by the universally-used `ResourceLabels`/`ResourceLabel` utility every
		// file tab and Explorer row renders through; `ILanguageDetectionService`
		// (`languageDetection`) is resolved unconditionally at the top of
		// `editorStatus.js`'s real "Change Language Mode" command
		// (`ChangeLanguageModeAction.run()`, `Ctrl+K Ctrl+M`, `f1: true`,
		// already the same file/pattern `extensionRuntime`'s
		// `IExtensionGalleryService` keep-reason cites). Removing any of these
		// three would have reproduced this project's own `F110` S5 "hoverService
		// depends on extensionService which is NOT registered" bootstrap-death
		// class of failure. `languageDetection`'s 2 debt files and
		// `treeSitter`'s 8 debt files are therefore both left at their `F110`
		// S0 starting count — not because a token removal was attempted and
		// reverted, but because this slice's dependency sweep found the
		// registration removal would have zero debt-count benefit either way
		// (both categories' vendor files are already unconditionally reachable
		// through a path that has nothing to do with `missing-services.js` —
		// `tokenizationTextModelPart.js`, part of every real `TextModel`, for
		// `treeSitter`; `driver.js`'s `localizedStrings` default-import, for the
		// one `languagePacks` file that remains). See
		// `scripts/plain/missing-services-patch-contract.mjs`'s own S6
		// paragraph and `docs/bundle-baseline.json`'s per-category
		// `categoryNotes` for the full per-file accounting.
		sha256: "7298079a565ff5737f3dae664ff98c1c6facc488262bd1745d2965a227e6b079",
		integrity:
			"sha512-pJMSRMI0m5Mvx54u6iBGh+iad9KqfICnwAcjswNJOO7Xt1OXm5xILcM32VkMe4UX0YmrGAvYc0WVKWL8I9O4ng==",
		directImporter: true,
		// 38, not 27: F240 adds eleven audited, static default-language
		// packages. Each has one exact dependency edge to this same patched API;
		// their manifests and grammar bytes are consumed as data only by Plain's
		// own declarative registry and never enable an Extension Host.
		// The earlier 27 count came from `F080` S2 installing
		// `@codingame/monaco-vscode-scm-service-override@35.0.1`, whose own
		// pnpm-lock.yaml snapshot block depends on this exact patched
		// `@codingame/monaco-vscode-api` — one more edge, same audited patch
		// hash as every other edge below. `F090` S2 installs
		// `@codingame/monaco-vscode-multi-diff-editor-service-override@35.0.1`,
		// whose own snapshot block depends on this exact same patched
		// `@codingame/monaco-vscode-api` too — one more edge again (confirmed
		// against the real pnpm-lock.yaml: its snapshot entry declares exactly
		// one dependency, `'@codingame/monaco-vscode-api':
		// 35.0.1(patch_hash=184ceed9...)`, the identical audited hash every
		// other edge here already shares — not a second, divergent patch
		// variant).
		snapshotEdgeCount: 38,
		shape: Object.freeze([
			"diff --git a/missing-services.js b/missing-services.js",
			"@@ -3,7 +3,6 @@ import { __decorate, __param } from './external/tslib/tslib.es6.js';",
			"@@ -47,37 +46,26 @@ import { ActionWidgetService } from './vscode/src/vs/platform/actionWidget/brows",
			"@@ -96,11 +84,6 @@ import { IURLService } from './vscode/src/vs/platform/url/common/url.service.js'",
			"@@ -112,89 +95,40 @@ import { StatusBarUpdateKind, IExtensionStatusBarItemService } from './vscode/sr",
			"@@ -206,17 +140,8 @@ import { IActivityService } from './vscode/src/vs/workbench/services/activity/co",
			"@@ -227,16 +152,10 @@ import { IEditorGroupsService } from './vscode/src/vs/workbench/services/editor/",
			"@@ -250,7 +169,6 @@ import { ILifecycleService } from './vscode/src/vs/workbench/services/lifecycle/",
			"@@ -258,8 +176,6 @@ import { IPaneCompositePartService } from './vscode/src/vs/workbench/services/pa",
			"@@ -272,11 +188,8 @@ import { ITitleService } from './vscode/src/vs/workbench/services/title/browser/",
			"@@ -294,101 +207,31 @@ import { IDataChannelService } from './vscode/src/vs/platform/dataChannel/common",
			"@@ -1338,7 +1181,6 @@ class LanguageDetectionService {",
			"@@ -1886,39 +1728,6 @@ __decorate([",
			"@@ -2053,95 +1862,6 @@ __decorate([",
			"@@ -2186,6 +1906,44 @@ __decorate([",
			"@@ -2455,40 +2213,6 @@ class ExtensionRecommendationsService {",
			"@@ -2528,80 +2252,6 @@ __decorate([",
			"@@ -3026,14 +2676,6 @@ __decorate([",
			"@@ -3100,28 +2742,6 @@ __decorate([",
			"@@ -3137,21 +2757,6 @@ class GlobalExtensionEnablementService {",
			"@@ -3831,81 +3436,6 @@ class TerminalQuickFixService {",
			"@@ -3944,76 +3474,6 @@ __decorate([",
			"@@ -4049,34 +3509,6 @@ __decorate([",
			"@@ -4086,26 +3518,6 @@ __decorate([",
			"@@ -4153,156 +3565,7 @@ class WorkbenchAssignmentService {",
			"@@ -4483,44 +3746,6 @@ __decorate([",
			"@@ -4716,55 +3941,6 @@ __decorate([",
			"@@ -4773,18 +3949,6 @@ class WorkspaceTrustEnablementService {",
			"@@ -4796,16 +3960,6 @@ __decorate([",
			"@@ -4852,13 +4006,6 @@ __decorate([",
			"@@ -4962,100 +4109,6 @@ __decorate([",
			"@@ -5109,47 +4162,6 @@ class ActiveLanguagePackService {",
			"@@ -5180,277 +4192,37 @@ __decorate([",
			"@@ -5542,80 +4314,6 @@ __decorate([",
			"@@ -5641,63 +4339,6 @@ __decorate([",
			"@@ -5709,139 +4350,6 @@ class UserDataInitializationService {",
			"@@ -5901,201 +4409,52 @@ class SignService {",
			"@@ -6111,22 +4470,6 @@ __decorate([",
			"@@ -6134,89 +4477,6 @@ class ChatCodeBlockContextProviderService {",
			"@@ -6229,1536 +4489,366 @@ class WalkthroughsService {",
			"@@ -7769,73 +4859,6 @@ __decorate([",
			"@@ -7847,14 +4870,6 @@ __decorate([",
			"@@ -7867,28 +4882,6 @@ __decorate([",
			"@@ -7902,45 +4895,6 @@ __decorate([",
			"@@ -7954,228 +4908,16 @@ __decorate([",
			"@@ -8225,241 +4967,6 @@ class MeteredConnectionService {",
			"@@ -8468,24 +4975,6 @@ class GitService {",
			"@@ -8506,39 +4995,6 @@ class PowerService {",
			"@@ -8551,54 +5007,6 @@ class WebBrowserViewCDPService {",
			"@@ -8678,139 +5086,6 @@ __decorate([",
			"@@ -8871,29 +5146,6 @@ __decorate([",
			"@@ -8950,178 +5202,3 @@ __decorate([",
			"diff --git a/services.js b/services.js",
			"@@ -24,7 +24,6 @@ import './vscode/src/vs/workbench/contrib/inlayHints/browser/inlayHintsAccessibi",
			"@@ -106,7 +105,6 @@ import { initialize as initialize$1 } from './workbench.js';",
			"@@ -175,11 +173,9 @@ export { IHistoryService } from './vscode/src/vs/workbench/services/history/comm",
			"@@ -192,29 +188,22 @@ export { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWo",
			"@@ -227,10 +216,6 @@ export { IURLService } from './vscode/src/vs/platform/url/common/url.service.js'",
			"@@ -239,54 +224,27 @@ export { IExtensionStatusBarItemService, StatusBarUpdateKind } from './vscode/sr",
			"@@ -294,15 +252,6 @@ export { ITerminalContributionService } from './vscode/src/vs/workbench/contrib/",
			"@@ -313,24 +262,15 @@ export { IAccessibleViewInformationService } from './vscode/src/vs/workbench/ser",
			"@@ -346,22 +286,16 @@ export { ITimerService } from './vscode/src/vs/workbench/services/timer/browser/",
			"@@ -376,87 +310,30 @@ export { IEditorCancellationTokens } from './vscode/src/vs/editor/contrib/editor",
			"@@ -496,7 +373,6 @@ async function initialize(overrides, container = document.body, configuration =",
			"diff --git a/vscode/src/vs/platform/files/common/files.d.ts b/vscode/src/vs/platform/files/common/files.d.ts",
			"@@ -775,6 +775,40 @@ export declare class FileOperationError extends Error {",
			"diff --git a/vscode/src/vs/platform/files/common/files.js b/vscode/src/vs/platform/files/common/files.js",
			"@@ -346,6 +346,95 @@ var FileOperationResult;",
			"@@ -437,4 +526,4 @@ function getLargeFileConfirmationLimit(arg) {",
			"diff --git a/vscode/src/vs/platform/files/common/plainWorkspaceDelete.d.ts b/vscode/src/vs/platform/files/common/plainWorkspaceDelete.d.ts",
			"@@ -0,0 +1,74 @@",
			"diff --git a/vscode/src/vs/platform/files/common/plainWorkspaceDelete.js b/vscode/src/vs/platform/files/common/plainWorkspaceDelete.js",
			"@@ -0,0 +1,427 @@",
			"diff --git a/vscode/src/vs/workbench/browser/actions/windowActions.js b/vscode/src/vs/workbench/browser/actions/windowActions.js",
			"@@ -407,36 +407,6 @@ class ShowAboutDialogAction extends Action2 {",
			"@@ -451,7 +421,6 @@ class BlurAction extends Action2 {",
			"diff --git a/vscode/src/vs/workbench/browser/actions/workspaceActions.js b/vscode/src/vs/workbench/browser/actions/workspaceActions.js",
			"@@ -67,12 +67,9 @@ class OpenFolderAction extends Action2 {",
			"@@ -304,24 +301,10 @@ class DuplicateWorkspaceInNewWindowAction extends Action2 {",
			"@@ -340,24 +323,6 @@ MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {",
			"@@ -385,23 +350,4 @@ MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {",
			"diff --git a/vscode/src/vs/workbench/browser/actions/workspaceCommands.js b/vscode/src/vs/workbench/browser/actions/workspaceCommands.js",
			"@@ -1,97 +1,22 @@",
			"@@ -131,76 +56,6 @@ CommandsRegistry.registerCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, async functio",
			"diff --git a/vscode/src/vs/workbench/browser/parts/activitybar/activitybarPart.js b/vscode/src/vs/workbench/browser/parts/activitybar/activitybarPart.js",
			"@@ -35,7 +35,7 @@ import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js",
			"@@ -294,7 +294,7 @@ let ActivityBarCompositeBar = class ActivityBarCompositeBar extends PaneComposit",
			"diff --git a/vscode/src/vs/workbench/browser/parts/globalCompositeBar.js b/vscode/src/vs/workbench/browser/parts/globalCompositeBar.js",
			"@@ -117,15 +117,7 @@ let GlobalCompositeBar = class GlobalCompositeBar extends Disposable {",
			"@@ -137,30 +129,16 @@ let GlobalCompositeBar = class GlobalCompositeBar extends Disposable {",
			"@@ -732,20 +710,7 @@ let SimpleGlobalActivityActionViewItem = class SimpleGlobalActivityActionViewIte",
			"@@ -756,19 +721,10 @@ function simpleActivityContextMenuActions(storageService, isAccount) {",
			"diff --git a/vscode/src/vs/workbench/contrib/accessibility/browser/editorAccessibilityHelp.js b/vscode/src/vs/workbench/contrib/accessibility/browser/editorAccessibilityHelp.js",
			"@@ -9,14 +9,12 @@ import { IContextKeyService } from '../../../../platform/contextkey/common/conte",
			"@@ -140,19 +138,17 @@ function getCommentCommandInfo(keybindingService, contextKeyService, editor) {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.js b/vscode/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.js",
			"@@ -5,7 +5,7 @@ import { toErrorMessage } from '../../../../../base/common/errorMessage.js';",
			"@@ -35,10 +35,55 @@ import Severity$1 from '../../../../../base/common/severity.js';",
			"@@ -106,7 +151,14 @@ let TextFileSaveErrorHandler = class TextFileSaveErrorHandler extends Disposable",
			"@@ -331,6 +383,27 @@ class RetrySaveModelAction extends Action {",
			"@@ -431,6 +504,9 @@ async function acceptOrRevertLocalChangesCommand(accessor, resource, accept) {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/fileActions.contribution.js b/vscode/src/vs/workbench/contrib/files/browser/fileActions.contribution.js",
			"@@ -4,7 +4,6 @@ import { GlobalCompareResourcesAction, FocusFilesExplorer, ShowActiveFileInExplo",
			"@@ -32,8 +31,6 @@ registerAction2(SetActiveEditorReadonlyInSession);",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/fileActions.js b/vscode/src/vs/workbench/contrib/files/browser/fileActions.js",
			"@@ -10,6 +10,7 @@ import { Action } from '../../../../base/common/actions.js';",
			"@@ -99,6 +100,43 @@ async function deleteFiles(",
			"@@ -1120,6 +1158,18 @@ CommandsRegistry.registerCommand({",
			"@@ -1263,11 +1313,17 @@ const pasteFileHandler = async (accessor, fileList) => {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/fileCommands.js b/vscode/src/vs/workbench/contrib/files/browser/fileCommands.js",
			"@@ -15,7 +15,7 @@ import { IContextKeyService } from '../../../../platform/contextkey/common/conte",
			"@@ -35,7 +35,7 @@ import { IConfigurationService } from '../../../../platform/configuration/common",
			"@@ -506,43 +506,6 @@ KeybindingsRegistry.registerCommandAndKeybindingRule({",
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/views/explorerView.js b/vscode/src/vs/workbench/contrib/files/browser/views/explorerView.js",
			"@@ -37,6 +37,7 @@ import { StorageScope, StorageTarget } from '../../../../../platform/storage/com",
			"@@ -541,9 +542,10 @@ let ExplorerView = class ExplorerView extends ViewPane {",
			"diff --git a/vscode/src/vs/workbench/contrib/files/common/explorerModel.js b/vscode/src/vs/workbench/contrib/files/common/explorerModel.js",
			"@@ -139,6 +139,17 @@ class ExplorerItem {",
			"diff --git a/vscode/src/vs/workbench/contrib/inlineCompletions/browser/inlineCompletionLanguageStatusBarContribution.js b/vscode/src/vs/workbench/contrib/inlineCompletions/browser/inlineCompletionLanguageStatusBarContribution.js",
			"@@ -1,20 +1,21 @@",
			"@@ -22,87 +23,9 @@ let InlineCompletionLanguageStatusBarContribution = class InlineCompletionLangua",
			"diff --git a/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.js b/vscode/src/vs/workbench/services/textfile/common/textFileEditorModel.js",
			"@@ -34,6 +34,57 @@ import { IProgressService } from '../../../../platform/progress/common/progress.",
			"@@ -112,6 +163,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -255,22 +307,30 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -283,10 +343,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -353,7 +413,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -369,7 +429,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -389,7 +449,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -513,6 +573,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -532,6 +596,10 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -648,7 +716,7 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -671,11 +739,18 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"@@ -687,9 +762,13 @@ let TextFileEditorModel = class TextFileEditorModel extends BaseTextEditorModel",
			"diff --git a/vscode/src/vs/workbench/browser/actions/layoutActions.js b/vscode/src/vs/workbench/browser/actions/layoutActions.js",
			"@@ -80,7 +80,11 @@",
			"@@ -90,12 +94,11 @@",
			"@@ -138,10 +141,9 @@",
			"@@ -161,7 +163,7 @@",
			"@@ -175,7 +177,7 @@",
			"@@ -189,7 +191,7 @@",
			"@@ -203,7 +205,7 @@",
			"@@ -216,7 +218,7 @@",
			"@@ -225,7 +227,7 @@",
			"@@ -325,7 +327,7 @@",
			"@@ -341,7 +343,7 @@",
			"@@ -1223,20 +1225,20 @@",
			"diff --git a/vscode/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.js b/vscode/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.js",
			"@@ -3,7 +3,7 @@ import { __decorate, __param } from '../../../../../../../external/tslib/tslib.e",
			"@@ -30,6 +30,101 @@ import { IProgressService } from '../../../../platform/progress/common/progress.",
			"@@ -107,6 +202,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -187,22 +283,30 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -213,10 +317,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -273,7 +377,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -289,7 +393,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -309,7 +413,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -404,6 +508,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -423,6 +531,10 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -567,7 +679,7 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -591,11 +703,18 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -606,7 +725,38 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
			"@@ -741,9 +891,13 @@ let StoredFileWorkingCopy = class StoredFileWorkingCopy extends ResourceWorkingC",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-base-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-base-service-override@35.0.1.patch",
		sha256: "98a7cd1eb7e87702fa76447fcf0ce3ba9ac56758ad33b3c641e5f82eec256b7c",
		integrity:
			"sha512-t1jG2GWrJcNJBzvSSC7H174C/7VmPDFR3FT89cmmYu1XjSs9XUDYgjLAzaQrf+KP6zlWv+uE3HvLBo0OESQ4MQ==",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/services/workingCopy/common/workingCopyFileService.js b/vscode/src/vs/workbench/services/workingCopy/common/workingCopyFileService.js",
			"@@ -13,6 +13,20 @@ import { IWorkingCopyService } from '@codingame/monaco-vscode-api/vscode/vs/work",
			"@@ -160,6 +174,51 @@ let WorkingCopyFileService = class WorkingCopyFileService extends Disposable {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-bulk-edit-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-bulk-edit-service-override@35.0.1.patch",
		sha256: "43ee12f4707635cc9568b214d729e0836de9192c13e5cb752c4e8c5293adab81",
		integrity:
			"sha512-4pLqH3KRUU0IevwRFBUPvHkiP9+wkWHIsPNXq/BVwulvEAgR69bjmpXkRHXXGOUilYdq1LCoICFGIyAtmyrTdg==",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.js b/vscode/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.js",
			"@@ -11,11 +11,13 @@ import { ILogService } from '@codingame/monaco-vscode-api/vscode/vs/platform/log",
			"@@ -209,6 +211,17 @@ class DeleteEdit {",
			"@@ -231,6 +244,16 @@ let DeleteOperation = class DeleteOperation {",
			"@@ -333,6 +356,7 @@ let BulkFileEdits = class BulkFileEdits {",
			"@@ -384,10 +408,15 @@ let BulkFileEdits = class BulkFileEdits {",
		]),
	}),
	Object.freeze({
		packageName:
			"@codingame/monaco-vscode-configuration-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-configuration-service-override@35.0.1.patch",
		sha256: "99b3c228c6f0fbab7e5fe84b2a173c569af2b99c0e969a2f24b39f6f5d39f093",
		integrity:
			"sha512-ndOt5a9jok43KSunXygHg/enZ19jHhxxsyzNg+T3ymSi3dpBNRHB30sJ7zeh+Ogz3a4y35gx8rlLSlwqB9ZoXQ==",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/index.js b/index.js",
			"@@ -68,7 +68,7 @@ function onUserConfigurationChange(callback) {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-explorer-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-explorer-service-override@35.0.1.patch",
		sha256: "1345cf49b5d4621da51a4c873d6c03f98a02c70bde9d5f747c4ef0e826ab5cc2",
		integrity:
			"sha512-hTeVVepUXl9+sM2qZP7QMvA9zEDacl4ubkVWmcqpaxvQ5YUQysFtWeZPQkKOuTfS4lCH374mfiQ02GkbrkDpmg==",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/files/browser/explorerService.js b/vscode/src/vs/workbench/contrib/files/browser/explorerService.js",
			"@@ -71,7 +71,12 @@ let ExplorerService = class ExplorerService {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-extensions-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-extensions-service-override@35.0.1.patch",
		sha256: "1e3fa68b2e618e1d8031ed3adb95f73be80654854d3607b37cab6ba3b1e0113c",
		integrity:
			"sha512-AMqRfu1UP5D8r3NR/YXJPcgJRnLJAxJDOOZTp3ydNLUyVjN10z9TFpYlL5FJPbu433ygG+vfJmI4+Bzau32e+Q==",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/index.js b/index.js",
			"@@ -2,7 +2,6 @@",
			"@@ -24,208 +23,42 @@ import { IBrowserWorkbenchEnvironmentService } from '@codingame/monaco-vscode-ap",
			"@@ -290,22 +123,14 @@ CustomBuiltinExtensionsScannerService = __decorate([",
			"diff --git a/vscode/src/vs/workbench/services/extensionManagement/browser/extensionBisect.js b/vscode/src/vs/workbench/services/extensionManagement/browser/extensionBisect.js",
			"@@ -195,6 +195,8 @@ let ExtensionBisectUi = class ExtensionBisectUi {",
			"@@ -351,5 +353,6 @@ registerAction2(class extends Action2 {",
			"diff --git a/vscode/src/vs/workbench/services/extensionManagement/browser/webExtensionsScannerService.js b/vscode/src/vs/workbench/services/extensionManagement/browser/webExtensionsScannerService.js",
			"@@ -1041,7 +1041,8 @@ let WebExtensionsScannerService = class WebExtensionsScannerService extends Disp",
			"diff --git a/vscode/src/vs/workbench/services/extensions/browser/extensionService.js b/vscode/src/vs/workbench/services/extensions/browser/extensionService.js",
			"@@ -20,16 +20,13 @@ import { IWorkspaceContextService } from '@codingame/monaco-vscode-api/vscode/vs",
			"@@ -210,90 +207,8 @@ let BrowserExtensionHostFactory = class BrowserExtensionHostFactory {",
			"diff --git a/vscode/src/vs/workbench/services/extensions/common/extensionHostManager.js b/vscode/src/vs/workbench/services/extensions/common/extensionHostManager.js",
			"@@ -481,6 +481,8 @@ function registerLatencyTestProvider(provider) {",
			"@@ -517,5 +519,6 @@ registerAction2(class MeasureExtHostLatencyAction extends Action2 {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-files-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-files-service-override@35.0.1.patch",
		sha256: "90558e0cc2df2cf979d361b1f1fa535a17460c6f2b333832e4e972f4798a96da",
		integrity:
			"sha512-tuyXQG4xajLk3uHpYRF0KCO1DV1L3U6tf+COPumRgDmJUINNOPBWpJ43uAdDnE2MNJL9eY5E4LlIxeHSZChaZw==",
		directImporter: true,
		snapshotEdgeCount: 7,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/platform/files/common/fileService.js b/vscode/src/vs/platform/files/common/fileService.js",
			"@@ -9,15 +9,17 @@ import { hash } from '@codingame/monaco-vscode-api/vscode/vs/base/common/hash';",
			"@@ -26,7 +28,771 @@ function resourceForError(resource) {",
			"@@ -81,6 +847,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -266,6 +1033,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -345,8 +1127,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -362,16 +1157,50 @@ let FileService = class FileService extends Disposable {",
			"@@ -383,10 +1212,39 @@ let FileService = class FileService extends Disposable {",
			"@@ -412,6 +1270,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -442,6 +1303,57 @@ let FileService = class FileService extends Disposable {",
			"@@ -559,6 +1471,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -600,6 +1515,57 @@ let FileService = class FileService extends Disposable {",
			"@@ -691,18 +1657,27 @@ let FileService = class FileService extends Disposable {",
			"@@ -717,6 +1692,8 @@ let FileService = class FileService extends Disposable {",
			"@@ -731,6 +1708,21 @@ let FileService = class FileService extends Disposable {",
			"@@ -780,6 +1772,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -794,6 +1787,7 @@ let FileService = class FileService extends Disposable {",
			"@@ -878,21 +1872,56 @@ let FileService = class FileService extends Disposable {",
			"@@ -901,6 +1930,9 @@ let FileService = class FileService extends Disposable {",
			"@@ -952,6 +1984,24 @@ let FileService = class FileService extends Disposable {",
			"@@ -974,6 +2024,8 @@ let FileService = class FileService extends Disposable {",
			"@@ -1154,14 +2206,54 @@ let FileService = class FileService extends Disposable {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-theme-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-theme-service-override@35.0.1.patch",
		sha256: "2f03277b14543f1e3bc2f723ca214543b1b0d2ca1c893a78287ccc34d071a9b5",
		integrity:
			"sha512-dBF71oD/yKAqPT8Sl0CLy2pzpV2Q9unICL+NroRZPA989X1d4/74UV650Tmp3S2StYLSVQKcZ0qhZ8vcf6zRYQ==",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/contrib/themes/browser/themes.contribution.js b/vscode/src/vs/workbench/contrib/themes/browser/themes.contribution.js",
			"@@ -828,6 +828,8 @@ registerAction2(class extends Action2 {",
			"@@ -871,6 +873,7 @@ registerAction2(class extends Action2 {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-view-common-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-view-common-service-override@35.0.1.patch",
		sha256: "0682d0c1a4c7d8e8eb0c975d216becdedda28245857e7aab17eccff8aeaf97d4",
		integrity:
			"sha512-qfbBJfClz18VZwZV0htcD4l7TQqotIZx3yMb8O1Ud0bNByFkj/SkN7q+XoSZtjW/eo4GVimlMV9TjDdCXIpaBQ==",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/api/browser/viewsExtensionPoint.js b/vscode/src/vs/workbench/api/browser/viewsExtensionPoint.js",
			"@@ -19,13 +19,16 @@ import { registerWorkbenchContribution2, WorkbenchPhase } from '@codingame/monac",
			"diff --git a/vscode/src/vs/workbench/services/progress/browser/progressService.js b/vscode/src/vs/workbench/services/progress/browser/progressService.js",
			"@@ -29,8 +29,20 @@ import { IUserActivityService } from '@codingame/monaco-vscode-api/vscode/vs/wor",
			"@@ -228,7 +240,7 @@ let ProgressService = class ProgressService extends Disposable {",
			"@@ -380,19 +392,13 @@ let ProgressService = class ProgressService extends Disposable {",
			"@@ -437,7 +443,7 @@ let ProgressService = class ProgressService extends Disposable {",
		]),
	}),
	Object.freeze({
		packageName:
			"@codingame/monaco-vscode-view-title-bar-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-view-title-bar-service-override@35.0.1.patch",
		// `F110` S4 (`docs/research/2026-07-28-legacy-retirement.md`, "主导会话裁定"
		// point 2): the first-ever patch of this package, a transitive-only
		// dependency (pulled in by `@codingame/monaco-vscode-workbench-service-override`,
		// which Plain does depend on directly — this package itself never
		// appears in `package.json`, see `directImporter: false` below). Its
		// `titlebarPart.js` turned out to be the real, previously-undiscovered
		// second consumer of vendor `globalCompositeBar.js` that kept
		// `authAccount` stuck at 5 after S4's `activitybarPart.js` repoint alone
		// (see `docs/bundle-baseline.json`'s `categoryNotes.authAccount` for the
		// full discovery story). This patch repoints `titlebarPart.js`'s single
		// import line from vendor `SimpleGlobalActivityActionViewItem` to this
		// repo's own `PlainSimpleGlobalActivityActionViewItem` in
		// `app/features/workbench/plain-global-composite-bar.ts`, deletes the two
		// branches that only ever served the already-dead account UI
		// (`SimpleAccountActivityActionViewItem`'s `ACCOUNTS_ACTIVITY_ID`
		// construction branch, and the `isAccountsActionVisible(...)` guard — that
		// helper is vendor code already neutered to always `return false;` by the
		// untouched `globalCompositeBar.js` hunk in
		// `patches/@codingame__monaco-vscode-api@35.0.1.patch`, so the guarded
		// `actions.primary.push(ACCOUNTS_ACTIVITY_TILE_ACTION)` call never fired
		// regardless), and inlines
		// `AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY`'s
		// literal string value (`"workbench.activity.showAccounts"`) so the last
		// remaining reference to that class's own import can drop too. With zero
		// references left anywhere to
		// `SimpleGlobalActivityActionViewItem`/`SimpleAccountActivityActionViewItem`/
		// `isAccountsActionVisible`/`AccountsActivityActionViewItem`,
		// `titlebarPart.js` no longer imports vendor `globalCompositeBar.js` at
		// all — and neither does anything else, so that file (plus the four other
		// authAccount debt sources it alone kept reachable) finally drops out of
		// the real bundle.
		sha256: "16c58f3d95604ca298b63405701bfbab9b285d7a7098a32cafc85594ead0c74d",
		integrity:
			"sha512-sS8hLpTaXFwIKSaJZXjb/tLi0CfRCbFDF+Yj1dhXqqSGyRma7FCqYaoTzt+rcrd9BKJVxyy8MPhAqEn48lHpSQ==",
		directImporter: false,
		snapshotEdgeCount: 1,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/browser/parts/titlebar/titlebarPart.js b/vscode/src/vs/workbench/browser/parts/titlebar/titlebarPart.js",
			"@@ -34,7 +34,7 @@ import { Categories } from '@codingame/monaco-vscode-api/vscode/vs/platform/acti",
			"@@ -476,12 +476,7 @@ let BrowserTitlebarPart = class BrowserTitlebarPart extends Part {",
			"@@ -586,9 +581,6 @@ let BrowserTitlebarPart = class BrowserTitlebarPart extends Part {",
			"@@ -631,7 +623,7 @@ let BrowserTitlebarPart = class BrowserTitlebarPart extends Part {",
		]),
	}),
	Object.freeze({
		packageName: "@codingame/monaco-vscode-workbench-service-override@35.0.1",
		patchPath:
			"patches/@codingame__monaco-vscode-workbench-service-override@35.0.1.patch",
		sha256: "4bd7198ed1c8c7387aa6beb6800f0ee419cd51e66bb1c94ad7c173730f7dbe69",
		integrity:
			"sha512-9KnyoG1L1vE/H1WpxD0n6BSro7Vw+BHRXfabmUNp2OQxyj2ihTcnoblGS50gX1aLfSIfz111llD2d8zMtocaBQ==",
		directImporter: true,
		snapshotEdgeCount: 0,
		shape: Object.freeze([
			"diff --git a/vscode/src/vs/workbench/browser/layout.js b/vscode/src/vs/workbench/browser/layout.js",
			"@@ -2362,11 +2362,6 @@",
			"@@ -2381,8 +2376,6 @@",
			"@@ -2401,9 +2394,6 @@",
			"@@ -2538,12 +2528,6 @@",
		]),
	}),
]);

function patchShape(source) {
	return source
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("diff --git ") || line.startsWith("@@ "));
}

function stripSingleQuotedScalars(line) {
	let inQuote = false;
	let stripped = "";
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === "'") {
			if (inQuote && line[index + 1] === "'") {
				stripped += "  ";
				index += 1;
				continue;
			}
			inQuote = !inQuote;
			stripped += " ";
			continue;
		}
		stripped += inQuote ? " " : character;
	}
	return inQuote ? undefined : stripped;
}

function validateTopLevelYamlEnvelope(
	source,
	label,
	requiredHeaders,
	failures,
) {
	const lines = source.split(/\r?\n/u);
	let invalid = false;
	for (const line of lines) {
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
			continue;
		}
		const stripped = stripSingleQuotedScalars(line);
		const trimmed = line.trimStart();
		const isTopLevel = trimmed.length === line.length;
		if (
			stripped === undefined ||
			line.includes("\t") ||
			line.includes('"') ||
			line.includes("\\") ||
			/[&*!]/u.test(stripped) ||
			stripped.includes("<<:") ||
			stripped.trimStart().startsWith("?") ||
			/^(?:---|\.\.\.)(?:\s|$)/u.test(stripped.trimStart()) ||
			stripped.trimStart().startsWith("%") ||
			(isTopLevel && /^(?:'|"|\{|\[)/u.test(line))
		) {
			invalid = true;
			break;
		}
	}
	for (const header of requiredHeaders) {
		const canonical = `${header}:`;
		const canonicalCount = lines.filter((line) => line === canonical).length;
		const encodedPattern = new RegExp(
			`^(?:${header}\\s*:|'${header}'\\s*:|"${header}"\\s*:)`,
			"u",
		);
		const headerForms = lines.filter((line) =>
			encodedPattern.test(line),
		).length;
		if (canonicalCount !== 1 || headerForms !== 1) {
			invalid = true;
		}
	}
	if (invalid) {
		failures.push(
			`${label} differs from the canonical top-level YAML envelope`,
		);
	}
}

function topLevelSection(source, header, label, failures) {
	const lines = source.split(/\r?\n/u);
	const headerPattern = new RegExp(`^${header}\\s*:`, "u");
	const headerIndexes = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (headerPattern.test(lines[index])) {
			headerIndexes.push(index);
		}
	}
	if (headerIndexes.length !== 1 || lines[headerIndexes[0]] !== `${header}:`) {
		failures.push(`${label} must contain exactly one exact ${header}: header`);
		return [];
	}

	const start = headerIndexes[0] + 1;
	let end = lines.length;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.length > 0 && !/^\s/u.test(line) && !line.startsWith("#")) {
			end = index;
			break;
		}
	}
	return lines.slice(start, end);
}

function semanticLines(lines) {
	return lines.filter(
		(line) => line.trim().length > 0 && !line.trimStart().startsWith("#"),
	);
}

const CANONICAL_KEY_PATTERN =
	/^(?:'[A-Za-z0-9@._/+\-(),=]+'|[A-Za-z0-9@._/+\-(),=]+):(?: (.*))?$/u;
const CANONICAL_VALUE_PATTERN =
	/^(?:'[A-Za-z0-9@._/+\-(),=:]+'|[A-Za-z0-9@._/+\-(),=:]+)$/u;
const CANONICAL_LIST_VALUE_PATTERN = /^[A-Za-z0-9@._/+\-(),=]+$/u;

function validateCanonicalSection(
	lines,
	label,
	allowedIndents,
	allowEmptyMapping,
	failures,
) {
	for (const line of lines) {
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
			continue;
		}
		if (
			line.includes("\t") ||
			/(?:["\\&*!?|><]|\[|\])/u.test(line) ||
			line.includes("<<:") ||
			line.includes("#") ||
			line.trimStart().startsWith("---") ||
			line.trimStart().startsWith("...")
		) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const indent = line.length - line.trimStart().length;
		if (!allowedIndents.has(indent) || !line.startsWith(" ".repeat(indent))) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const body = line.slice(indent);
		if (body.startsWith("?")) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		if (body.startsWith("- ")) {
			if (indent !== 6 || !CANONICAL_LIST_VALUE_PATTERN.test(body.slice(2))) {
				failures.push(`${label} differs from pnpm's canonical YAML grammar`);
				return;
			}
			continue;
		}
		const mapping = CANONICAL_KEY_PATTERN.exec(body);
		if (!mapping) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
		const value = mapping[1];
		if (value === undefined) {
			continue;
		}
		if (value === "{}" && allowEmptyMapping) {
			continue;
		}
		if (/[{}]/u.test(value) || !CANONICAL_VALUE_PATTERN.test(value)) {
			failures.push(`${label} differs from pnpm's canonical YAML grammar`);
			return;
		}
	}
}

function exactMappingLines(source, expected, label, failures) {
	const actual = topLevelSection(
		source,
		"patchedDependencies",
		label,
		failures,
	).filter((line) => line.trim().length > 0);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(
			`${label} top-level patchedDependencies must be the exact audited ${PATCH_CONTRACTS.length}-entry closed set`,
		);
	}
	return actual;
}

function packageIdentity(contract) {
	const suffix = "@35.0.1";
	if (!contract.packageName.endsWith(suffix)) {
		throw new Error(
			`unsupported patched package identity: ${contract.packageName}`,
		);
	}
	return {
		alias: contract.packageName.slice(0, -suffix.length),
		version: suffix.slice(1),
		patchedVersion: `35.0.1(patch_hash=${contract.sha256})`,
	};
}

function validateImporterGraph(lines, failures) {
	const importerLines = semanticLines(lines);
	for (const contract of PATCH_CONTRACTS) {
		const { alias, version, patchedVersion } = packageIdentity(contract);
		const keyLine = `      '${alias}':`;
		const relevant = importerLines.filter((line) => line.includes(alias));
		if (!contract.directImporter) {
			if (relevant.length !== 0) {
				failures.push(
					`pnpm-lock.yaml importers must not directly consume ${alias}`,
				);
			}
			continue;
		}

		const index = importerLines.indexOf(keyLine);
		if (
			relevant.length !== 1 ||
			index < 0 ||
			importerLines[index + 1] !== `        specifier: ${version}` ||
			importerLines[index + 2] !== `        version: ${patchedVersion}`
		) {
			failures.push(
				`pnpm-lock.yaml importer edge for ${alias} must resolve only to ${patchedVersion}`,
			);
		}
	}
}

function validateSnapshotGraph(lines, failures) {
	const snapshotLines = semanticLines(lines);
	for (const contract of PATCH_CONTRACTS) {
		const { alias, patchedVersion } = packageIdentity(contract);
		const expectedHeader = `  '${alias}@${patchedVersion}':`;
		const expectedEdge = `      '${alias}': ${patchedVersion}`;
		const relevant = snapshotLines.filter((line) => line.includes(alias));
		const headers = relevant.filter((line) => line.startsWith(`  '${alias}@`));
		const edges = relevant.filter((line) =>
			line.startsWith(`      '${alias}':`),
		);
		if (
			headers.length !== 1 ||
			headers[0] !== expectedHeader ||
			edges.length !== contract.snapshotEdgeCount ||
			edges.some((line) => line !== expectedEdge) ||
			relevant.length !== headers.length + edges.length
		) {
			failures.push(
				`pnpm-lock.yaml snapshot graph for ${alias} must use only ${patchedVersion}`,
			);
		}
	}
}

function validatePackageIntegrities(lines, failures) {
	const packageLines = semanticLines(lines);
	for (const contract of PATCH_CONTRACTS) {
		const { alias, version } = packageIdentity(contract);
		const expectedHeader = `  '${alias}@${version}':`;
		const expectedResolution = `    resolution: {integrity: ${contract.integrity}}`;
		const matchingHeaders = packageLines.filter((line) =>
			line.startsWith(`  '${alias}@`),
		);
		const headerIndex = packageLines.indexOf(expectedHeader);
		const nextPackageIndex = packageLines.findIndex(
			(line, index) => index > headerIndex && /^  \S/u.test(line),
		);
		const blockEnd =
			nextPackageIndex === -1 ? packageLines.length : nextPackageIndex;
		const block =
			headerIndex === -1 ? [] : packageLines.slice(headerIndex, blockEnd);
		if (
			matchingHeaders.length !== 1 ||
			matchingHeaders[0] !== expectedHeader ||
			block.length !== 2 ||
			block[0] !== expectedHeader ||
			block[1] !== expectedResolution
		) {
			failures.push(
				`pnpm-lock.yaml package integrity for ${alias}@${version} must remain the exact audited tarball`,
			);
		}
	}
}

export function validateWorkbenchPatchSet({
	workspaceManifest,
	lockfile,
	patchSources,
}) {
	const failures = [];
	validateTopLevelYamlEnvelope(
		workspaceManifest,
		"pnpm-workspace.yaml",
		["patchedDependencies"],
		failures,
	);
	validateTopLevelYamlEnvelope(
		lockfile,
		"pnpm-lock.yaml",
		["patchedDependencies", "importers", "packages", "snapshots"],
		failures,
	);
	const manifestExpected = PATCH_CONTRACTS.map(
		(contract) => `  '${contract.packageName}': ${contract.patchPath}`,
	);
	const lockExpected = PATCH_CONTRACTS.map(
		(contract) => `  '${contract.packageName}': ${contract.sha256}`,
	);
	const manifestMapping = exactMappingLines(
		workspaceManifest,
		manifestExpected,
		"pnpm-workspace.yaml",
		failures,
	);
	const lockMapping = exactMappingLines(
		lockfile,
		lockExpected,
		"pnpm-lock.yaml",
		failures,
	);
	if (
		patchSources.size !== PATCH_CONTRACTS.length ||
		PATCH_CONTRACTS.some(({ patchPath }) => !patchSources.has(patchPath))
	) {
		failures.push(
			"the supplied patch sources must be the exact audited closed set",
		);
	}

	for (const contract of PATCH_CONTRACTS) {
		const source = patchSources.get(contract.patchPath);
		if (typeof source !== "string") {
			failures.push(
				`${contract.patchPath} is missing from the audited patch set`,
			);
			continue;
		}

		const manifestLine = `  '${contract.packageName}': ${contract.patchPath}`;
		if (manifestMapping.filter((line) => line === manifestLine).length !== 1) {
			failures.push(
				`pnpm-workspace.yaml must map ${contract.packageName} to its exact audited patch once`,
			);
		}

		const digest = createHash("sha256").update(source).digest("hex");
		if (digest !== contract.sha256) {
			failures.push(
				`${contract.patchPath} differs from its exact audited SHA-256`,
			);
		}
		if (JSON.stringify(patchShape(source)) !== JSON.stringify(contract.shape)) {
			failures.push(
				`${contract.patchPath} differs from its exact package/file/hunk manifest`,
			);
		}

		const lockLine = `  '${contract.packageName}': ${contract.sha256}`;
		if (lockMapping.filter((line) => line === lockLine).length !== 1) {
			failures.push(
				`pnpm-lock.yaml must pin ${contract.packageName} to its audited patch hash`,
			);
		}
	}

	const importerSection = topLevelSection(
		lockfile,
		"importers",
		"pnpm-lock.yaml",
		failures,
	);
	const snapshotSection = topLevelSection(
		lockfile,
		"snapshots",
		"pnpm-lock.yaml",
		failures,
	);
	const packagesSection = topLevelSection(
		lockfile,
		"packages",
		"pnpm-lock.yaml",
		failures,
	);
	validateCanonicalSection(
		importerSection,
		"pnpm-lock.yaml importers",
		new Set([2, 4, 6, 8]),
		false,
		failures,
	);
	validateCanonicalSection(
		snapshotSection,
		"pnpm-lock.yaml snapshots",
		new Set([2, 4, 6]),
		true,
		failures,
	);
	validateImporterGraph(importerSection, failures);
	validatePackageIntegrities(packagesSection, failures);
	validateSnapshotGraph(snapshotSection, failures);

	return failures;
}

export const auditedWorkbenchPatchPaths = Object.freeze(
	PATCH_CONTRACTS.map(({ patchPath }) => patchPath),
);
