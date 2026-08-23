import { afterEach, describe, expect, it, vi } from "vitest";

import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	beginPlainWorkspaceDeleteProviderDispatch,
	completePlainWorkspaceDeleteProviderFailure,
	completePlainWorkspaceDeleteProviderResult,
	movePlainWorkspaceDeleteFileServiceAuthorization,
	movePlainWorkspaceDeleteResourceEditAuthorization,
	movePlainWorkspaceDeleteWorkingCopyAuthorization,
	runPlainWorkspaceDeleteCoordinator,
	takePlainWorkspaceDeleteProviderAuthorization,
	type PlainWorkspaceDeleteCoordinatorContext,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";

import {
	getWorkspaceDeleteIncompleteDetails,
	getWorkspaceTrashIncompleteDetails,
	registerWorkspaceDeleteCoordinator,
	WorkspaceDeleteIncompleteError,
	WorkspaceTrashIncompleteError,
	type PlainDeleteErrorNotificationService,
} from "../../app/features/workspace/delete-coordinator";
import type { PlainWorkspaceDeleteProvider } from "../../app/features/workspace/file-system-provider";
import type {
	PlainBridge,
	RuntimeInfo,
	WorkspaceDeleteBatchPlan,
	WorkspaceTrashBatchPlan,
} from "../../app/platform/tauri/contracts";

const rootId = "00000000-0000-4000-8000-000000000101";
const secondRootId = "00000000-0000-4000-8000-000000000202";
const confirmationId = "00000000-0000-4000-8000-000000000301";
const runtimeInfo: RuntimeInfo = Object.freeze({
	application: "Plain",
	ipcVersion: 1,
	runtime: "browser-mock",
});

const disposables: { dispose(): void }[] = [];

afterEach(() => {
	while (disposables.length > 0) {
		disposables.pop()!.dispose();
	}
});

function uuid(index: number): string {
	return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function plan(
	entries: readonly Readonly<{
		kind: "file" | "directory" | "symlink";
		descendantEntries?: number;
	}>[],
): WorkspaceDeleteBatchPlan {
	return Object.freeze({
		confirmationId,
		entries: Object.freeze(
			entries.map((entry, index) =>
				Object.freeze({
					entryId: uuid(400 + index),
					kind: entry.kind,
					descendantEntries: entry.descendantEntries ?? 0,
				}),
			),
		),
	});
}

function trashPlan(
	entries: readonly Readonly<{
		kind: "file" | "directory" | "symlink";
	}>[],
): WorkspaceTrashBatchPlan {
	return Object.freeze({
		confirmationId,
		entries: Object.freeze(
			entries.map((entry, index) =>
				Object.freeze({
					entryId: uuid(500 + index),
					kind: entry.kind,
				}),
			),
		),
	});
}

function testBridge(
	deletePlan: WorkspaceDeleteBatchPlan,
	overrides: Partial<PlainBridge> = {},
): PlainBridge {
	return {
		async runtimeInfo() {
			return runtimeInfo;
		},
		async windowCreate() {
			throw new Error("unused");
		},
		async onRuntimeReady() {
			return () => {};
		},
		async onNativeCloseRequested() {
			return () => {};
		},
		async lifecycleCompleteClose() {},
		async lifecycleRequestClose() {},
		async userDataRead() {
			throw new Error("not implemented in fake bridge for this test");
		},
		async userDataWrite() {
			throw new Error("not implemented in fake bridge for this test");
		},
		async onUserDataChanged() {
			return () => {};
		},
		async layoutRead() {
			throw new Error("not implemented in fake bridge for this test");
		},
		async layoutWrite() {
			throw new Error("not implemented in fake bridge for this test");
		},
		async workspaceCapabilities() {
			return {
				create: true,
				renameNoReplace: true,
				copyMove: true,
				delete: true,
				trash: true,
				versionedWrite: true,
			};
		},
		async workspaceSnapshot() {
			throw new Error("unused");
		},
		workspaceReconcileWatchRoots() {},
		workspaceWatch() {
			return () => {};
		},
		async workspacePickRoots() {
			throw new Error("unused");
		},
		async workspaceOpenFiles() {
			throw new Error("unused");
		},
		async workspacePickSaveTarget() {
			throw new Error("unused");
		},
		async workspaceRecentList() {
			throw new Error("unused");
		},
		async workspaceOpenRecent() {
			throw new Error("unused");
		},
		async workspaceRemoveRecent() {
			throw new Error("unused");
		},
		async workspaceClearRecent() {
			throw new Error("unused");
		},
		async workspaceRemoveRoot() {
			throw new Error("unused");
		},
		async workspaceCloseFolder() {
			throw new Error("unused");
		},
		async workspaceCreateFile() {
			throw new Error("unused");
		},
		async workspaceCreateDirectory() {
			throw new Error("unused");
		},
		async workspaceRename() {
			throw new Error("unused");
		},
		async workspaceCopy() {
			throw new Error("unused");
		},
		async workspaceMove() {
			throw new Error("unused");
		},
		async workspacePrepareDelete() {
			return deletePlan;
		},
		async workspaceCancelDelete() {},
		async workspaceBeginDelete() {},
		async workspaceCommitDeleteEntry() {
			throw new Error("unused");
		},
		async workspacePrepareTrash() {
			throw new Error("unused");
		},
		async workspaceCancelTrash() {},
		async workspaceBeginTrash() {},
		async workspaceCommitTrashEntry() {
			throw new Error("unused");
		},
		async workspaceStat() {
			throw new Error("unused");
		},
		async workspaceReadDirectory() {
			throw new Error("unused");
		},
		async workspaceReadFile() {
			throw new Error("unused");
		},
		async workspaceWriteFile() {
			throw new Error("unused");
		},
		async workspacePublishFile() {
			throw new Error("unused");
		},
		async workspaceSearchFiles() {
			throw new Error("unused");
		},
		async workspaceSearchTextStart() {
			throw new Error("unused");
		},
		async workspaceSearchTextPoll() {
			throw new Error("unused");
		},
		async workspaceSearchTextCancel() {
			throw new Error("unused");
		},
		workspaceSearchTextWatch() {
			return () => {};
		},
		async workspaceSearchExpandReplacements() {
			throw new Error("unused");
		},
		async backupWrite() {
			throw new Error("unused");
		},
		async backupReadAll() {
			throw new Error("unused");
		},
		async backupDiscard() {
			throw new Error("unused");
		},
		async backupDiscardAll() {
			throw new Error("unused");
		},
		async scratchCreate() {
			throw new Error("unused");
		},
		async scratchWrite() {
			throw new Error("unused");
		},
		async scratchReadAll() {
			throw new Error("unused");
		},
		async scratchDiscard() {
			throw new Error("unused");
		},
		async scratchDiscardAll() {
			throw new Error("unused");
		},
		async themeImportVsix() {
			throw new Error("unused");
		},
		async themeImportDirectory() {
			throw new Error("unused");
		},
		async themeList() {
			throw new Error("unused");
		},
		async themeReadResource() {
			throw new Error("unused");
		},
		async themeRemove() {
			throw new Error("unused");
		},
		async themeGetSelection() {
			throw new Error("unused");
		},
		async themeSetSelection() {
			throw new Error("unused");
		},
		async themeSetFileIconThemeSelection() {
			throw new Error("unused");
		},
		async themeSetProductIconThemeSelection() {
			throw new Error("unused");
		},
		async terminalProfiles() {
			throw new Error("unused");
		},
		async terminalStart() {
			throw new Error("unused");
		},
		async terminalInputText() {
			throw new Error("unused");
		},
		async terminalInputKey() {
			throw new Error("unused");
		},
		async terminalFocus() {
			throw new Error("unused");
		},
		async terminalResize() {
			throw new Error("unused");
		},
		async terminalAck() {
			throw new Error("unused");
		},
		async terminalScrollback() {
			throw new Error("unused");
		},
		async terminalKill() {
			throw new Error("unused");
		},
		async terminalOpenExternalLink() {
			throw new Error("unused");
		},
		async terminalLifecycleMarker() {
			throw new Error("unused");
		},
		terminalWatchData() {
			throw new Error("unused");
		},
		terminalWatchExit() {
			throw new Error("unused");
		},
		async workspaceTrustState() {
			throw new Error("unused");
		},
		async workspaceTrustGrant() {
			throw new Error("unused");
		},
		async workspaceTrustRevoke() {
			throw new Error("unused");
		},
		async gitStatus() {
			throw new Error("unused");
		},
		async gitDiffFiles() {
			throw new Error("unused");
		},
		async gitShowBlob() {
			throw new Error("unused");
		},
		async gitStagePaths() {
			throw new Error("unused");
		},
		async gitUnstagePaths() {
			throw new Error("unused");
		},
		async gitStageBlob() {
			throw new Error("unused");
		},
		async gitCommit() {
			throw new Error("unused");
		},
		async gitDiscardPaths() {
			throw new Error("unused");
		},
		async gitNetworkPreview() {
			throw new Error("unused");
		},
		async gitFetch() {
			throw new Error("unused");
		},
		async gitPull() {
			throw new Error("unused");
		},
		async gitPush() {
			throw new Error("unused");
		},
		async gitNetworkCancel() {
			throw new Error("unused");
		},
		async gitBlameFile() {
			throw new Error("unused");
		},
		async gitBlameCommitMessages() {
			throw new Error("unused");
		},
		async gitFileHistory() {
			throw new Error("unused");
		},
		async gitHistorySearch() {
			throw new Error("unused");
		},
		async gitLineHistoryList() {
			throw new Error("unused");
		},
		async gitLineHistoryDetail() {
			throw new Error("unused");
		},
		async gitShowCommit() {
			throw new Error("unused");
		},
		async gitShowCommitBlob() {
			throw new Error("unused");
		},
		async gitLogGraph() {
			throw new Error("unused");
		},
		async gitRefsList() {
			throw new Error("unused");
		},
		async gitRemotesList() {
			throw new Error("unused");
		},
		async gitReflogList() {
			throw new Error("unused");
		},
		async gitContributorsList() {
			throw new Error("unused");
		},
		async gitBranchCreate() {
			throw new Error("unused");
		},
		async gitBranchSwitch() {
			throw new Error("unused");
		},
		async gitBranchRename() {
			throw new Error("unused");
		},
		async gitBranchDelete() {
			throw new Error("unused");
		},
		async gitTagCreate() {
			throw new Error("unused");
		},
		async gitTagDelete() {
			throw new Error("unused");
		},
		async gitRemoteAdd() {
			throw new Error("unused");
		},
		async gitRemoteRename() {
			throw new Error("unused");
		},
		async gitRemoteSetUrl() {
			throw new Error("unused");
		},
		async gitRemoteRemove() {
			throw new Error("unused");
		},
		async gitUpstreamSet() {
			throw new Error("unused");
		},
		async gitUpstreamUnset() {
			throw new Error("unused");
		},
		async gitHistoryState() {
			throw new Error("unused");
		},
		async gitHistoryPreview() {
			throw new Error("unused");
		},
		async gitMerge() {
			throw new Error("unused");
		},
		async gitRebase() {
			throw new Error("unused");
		},
		async gitCherryPick() {
			throw new Error("unused");
		},
		async gitRevert() {
			throw new Error("unused");
		},
		async gitReset() {
			throw new Error("unused");
		},
		async gitHistoryContinue() {
			throw new Error("unused");
		},
		async gitHistoryAbort() {
			throw new Error("unused");
		},
		async gitHistoryCancel() {
			throw new Error("unused");
		},
		async gitStashList() {
			throw new Error("unused");
		},
		async gitStashShow() {
			throw new Error("unused");
		},
		async gitStashPush() {
			throw new Error("unused");
		},
		async gitStashApply() {
			throw new Error("unused");
		},
		async gitStashPop() {
			throw new Error("unused");
		},
		async gitStashDrop() {
			throw new Error("unused");
		},
		async gitWorktreeList() {
			throw new Error("unused");
		},
		async gitWorktreeAdd() {
			throw new Error("unused");
		},
		async gitWorktreeRemove() {
			throw new Error("unused");
		},
		async debugAdapterConfirmationState() {
			throw new Error("unused");
		},
		async debugAdapterConfirmationGrant() {
			throw new Error("unused");
		},
		async debugAdapterConfirmationRevoke() {
			throw new Error("unused");
		},
		async debugLaunch() {
			throw new Error("unused");
		},
		async debugAttach() {
			throw new Error("unused");
		},
		async debugDisconnect() {
			throw new Error("unused");
		},
		async debugSetBreakpoints() {
			throw new Error("unused");
		},
		async debugStackTrace() {
			throw new Error("unused");
		},
		async debugThreads() {
			throw new Error("unused");
		},
		async debugScopes() {
			throw new Error("unused");
		},
		async debugVariables() {
			throw new Error("unused");
		},
		async debugEvaluate() {
			throw new Error("unused");
		},
		async debugContinue() {
			throw new Error("unused");
		},
		async debugNext() {
			throw new Error("unused");
		},
		async debugStepIn() {
			throw new Error("unused");
		},
		async debugStepInTargets() {
			throw new Error("unused");
		},
		async debugStepOut() {
			throw new Error("unused");
		},
		async debugPause() {
			throw new Error("unused");
		},
		async debugDisassemble() {
			throw new Error("unused");
		},
		async debugOutputAck() {
			throw new Error("unused");
		},
		debugWatchEvent() {
			throw new Error("unused");
		},
		async remoteSessionConnect() {
			throw new Error("unused");
		},
		async remoteHostKeyConfirm() {
			throw new Error("unused");
		},
		async remoteSessionConnectCancel() {
			throw new Error("unused");
		},
		async remoteSessionDisconnect() {
			throw new Error("unused");
		},
		async remoteSessionState() {
			throw new Error("unused");
		},
		async remoteHostKeyForget() {
			throw new Error("unused");
		},
		async remoteHostKeyList() {
			throw new Error("unused");
		},
		remoteSessionWatchEvent() {
			throw new Error("unused");
		},
		async remoteWorkspacePickDirectory() {
			throw new Error("unused");
		},
		async remoteWorkspaceAddRoot() {
			throw new Error("unused");
		},
		async remoteWorkspaceReconnectRoot() {
			throw new Error("unused");
		},
		...overrides,
	};
}

function testNotifier(): PlainDeleteErrorNotificationService & {
	readonly error: ReturnType<typeof vi.fn<(message: string) => unknown>>;
} {
	return { error: vi.fn<(message: string) => unknown>() };
}

async function getTestNotificationService(): Promise<PlainDeleteErrorNotificationService> {
	return testNotifier();
}

function testProvider(): PlainWorkspaceDeleteProvider & {
	readonly refresh: ReturnType<typeof vi.fn>;
} {
	const refresh = vi.fn();
	return {
		refresh,
		plainSnapshotDeleteResource(resource) {
			if (
				resource.scheme !== "plain-workspace" ||
				resource.query !== "" ||
				resource.fragment !== "" ||
				resource.path.length <= 1
			) {
				throw new Error("invalid resource");
			}
			return Object.freeze({
				rootId: resource.authority,
				relativePath: resource.path.slice(1),
				resource,
			});
		},
		plainRefreshDeleteRoots: refresh,
	};
}

function element(
	relativePath: string,
	options: Readonly<{
		workspaceRootId?: string;
		isDirectory?: boolean;
	}> = {},
) {
	return Object.freeze({
		resource: URI.parse(
			`plain-workspace://${options.workspaceRootId ?? rootId}/${relativePath}`,
		),
		name: relativePath.split("/").at(-1)!,
		isDirectory: options.isDirectory ?? false,
		isSymbolicLink: false,
	});
}

function context(
	elements: PlainWorkspaceDeleteCoordinatorContext["elements"],
	overrides: Partial<PlainWorkspaceDeleteCoordinatorContext> = {},
): PlainWorkspaceDeleteCoordinatorContext {
	return {
		useTrash: false,
		elements,
		explorerService: {
			async applyBulkEdit() {},
		},
		dialogService: {
			async confirm() {
				return { confirmed: true };
			},
		},
		workingCopyFileService: {
			getDirty() {
				return [];
			},
		},
		filesConfigurationService: {
			isReadonly() {
				return false;
			},
		},
		...overrides,
	};
}

function terminalizeAuthorizedEdit(
	edit: {
		readonly oldResource?: URI;
		readonly options: object;
	},
	terminal:
		| "deleted"
		| "trashed"
		| "ordinaryFailure"
		| "outcomeUnknown"
		| "entryRetained",
	useTrash = false,
): void {
	const resource = edit.oldResource!;
	const operation = { resource, recursive: true, useTrash };
	expect(
		movePlainWorkspaceDeleteResourceEditAuthorization(
			edit.options,
			resource,
			operation,
		),
	).toBe(true);
	const fileOptions = { recursive: true, useTrash, atomic: false };
	expect(
		movePlainWorkspaceDeleteWorkingCopyAuthorization(
			operation,
			resource,
			fileOptions,
		),
	).toBe(true);
	const providerOptions = { recursive: true, useTrash, atomic: false };
	expect(
		movePlainWorkspaceDeleteFileServiceAuthorization(
			fileOptions,
			resource,
			providerOptions,
		),
	).toBe(true);
	const authorization = takePlainWorkspaceDeleteProviderAuthorization(
		providerOptions,
		resource,
	);
	expect(authorization).toBeDefined();
	beginPlainWorkspaceDeleteProviderDispatch(authorization!);
	if (terminal === "deleted" || terminal === "trashed") {
		completePlainWorkspaceDeleteProviderResult(authorization!, {
			status: terminal,
		});
	} else if (terminal === "entryRetained") {
		completePlainWorkspaceDeleteProviderResult(authorization!, {
			status: "entryRetained",
			reason: useTrash ? "trashFailed" : "entryChanged",
		});
	} else if (terminal === "outcomeUnknown" && useTrash) {
		completePlainWorkspaceDeleteProviderResult(authorization!, {
			status: "outcomeUnknown",
		});
	} else {
		completePlainWorkspaceDeleteProviderFailure(authorization!, terminal);
	}
}

describe("Plain confirmed-delete coordinator", () => {
	it("prepares, shows exactly one permanent warning, begins, then consumes entries in order without public authorization fields", async () => {
		const order: string[] = [];
		const prepare = vi.fn(async () => {
			order.push("prepare");
			return plan([
				{ kind: "directory", descendantEntries: 3 },
				{ kind: "file" },
			]);
		});
		const begin = vi.fn(async () => {
			order.push("begin");
		});
		const cancel = vi.fn();
		const bridge = testBridge(plan([]), {
			workspacePrepareDelete: prepare,
			workspaceBeginDelete: begin,
			workspaceCancelDelete: cancel,
		});
		const provider = testProvider();
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				getTestNotificationService,
			),
		);
		const dirty = Object.freeze({ id: "dirty" });
		const confirm = vi.fn(async (options) => {
			order.push("confirm");
			expect(options.message).toContain("永久删除");
			expect(options.detail).toContain("永久且不可撤销");
			expect(options.detail).toContain("3 个后代条目");
			expect(options.detail).toContain("1 个未保存");
			expect(options.detail).toContain("1 个所选条目被配置为只读");
			return { confirmed: true };
		});
		const applyBulkEdit = vi.fn(async (edits) => {
			order.push("apply");
			expect(edits).toHaveLength(2);
			for (const edit of edits) {
				expect(Reflect.ownKeys(edit.options)).toEqual([
					"recursive",
					"folder",
					"ignoreIfNotExists",
					"skipTrashBin",
				]);
				expect(JSON.stringify(edit.options)).not.toContain(confirmationId);
				terminalizeAuthorizedEdit(edit, "deleted");
			}
		});

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context(
					[
						element("src", { isDirectory: true }),
						element("README.md", { workspaceRootId: secondRootId }),
					],
					{
						dialogService: { confirm },
						explorerService: { applyBulkEdit },
						workingCopyFileService: {
							getDirty(resource) {
								order.push(`dirty:${resource.path}`);
								return resource.path === "/src" ? [dirty] : [dirty];
							},
						},
						filesConfigurationService: {
							isReadonly(resource) {
								order.push(`readonly:${resource.path}`);
								return resource.path === "/src";
							},
						},
					},
				),
			),
		).resolves.toBeUndefined();

		expect(order.indexOf("prepare")).toBeLessThan(order.indexOf("confirm"));
		expect(order.indexOf("confirm")).toBeLessThan(order.indexOf("begin"));
		expect(order.indexOf("begin")).toBeLessThan(order.indexOf("apply"));
		expect(prepare).toHaveBeenCalledWith([
			{ rootId, relativePath: "src", recursive: true },
			{ rootId: secondRootId, relativePath: "README.md", recursive: true },
		]);
		expect(begin).toHaveBeenCalledWith(confirmationId);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(cancel).not.toHaveBeenCalled();
		expect(provider.refresh).not.toHaveBeenCalled();
	});

	it("cancels a prepared batch when the only dialog is declined", async () => {
		const cancel = vi.fn(async () => {
			throw new Error("best-effort cancellation already expired");
		});
		const begin = vi.fn();
		const applyBulkEdit = vi.fn();
		const bridge = testBridge(plan([{ kind: "file" }]), {
			workspaceCancelDelete: cancel,
			workspaceBeginDelete: begin,
		});
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				testProvider(),
				getTestNotificationService,
			),
		);

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context([element("cancel.txt")], {
					dialogService: {
						async confirm() {
							return { confirmed: false };
						},
					},
					explorerService: { applyBulkEdit },
				}),
			),
		).resolves.toBeUndefined();

		expect(cancel).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledWith(confirmationId);
		expect(begin).not.toHaveBeenCalled();
		expect(applyBulkEdit).not.toHaveBeenCalled();
	});

	it("brands retained and response-unknown terminals, notifies once with the exact branded message, refreshes every selected root, and never retries", async () => {
		const expectedMessage = Object.freeze({
			entryRetained:
				"The permanent delete batch stopped after a native delete became incomplete.",
			outcomeUnknown: "The permanent delete batch did not complete.",
		});
		for (const terminal of ["entryRetained", "outcomeUnknown"] as const) {
			const cancel = vi.fn();
			const provider = testProvider();
			const bridge = testBridge(plan([{ kind: "file" }]), {
				workspaceCancelDelete: cancel,
			});
			const notifier = testNotifier();
			const registration = registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				async () => notifier,
			);
			disposables.push(registration);
			const original = new Error("provider unavailable");

			await expect(
				runPlainWorkspaceDeleteCoordinator(
					context([element("unknown.txt")], {
						explorerService: {
							async applyBulkEdit(edits) {
								terminalizeAuthorizedEdit(edits[0]!, terminal);
								throw original;
							},
						},
					}),
				),
			).resolves.toBeUndefined();

			expect(notifier.error).toHaveBeenCalledTimes(1);
			expect(notifier.error).toHaveBeenCalledWith(expectedMessage[terminal]);
			expect(provider.refresh).toHaveBeenCalledTimes(1);
			expect(cancel).toHaveBeenCalledTimes(1);
			registration.dispose();
			disposables.pop();
		}
	});

	it("rethrows the original branded error when the notification service getter or error() itself fails", async () => {
		for (const terminal of ["entryRetained", "outcomeUnknown"] as const) {
			for (const failingNotificationService of [
				async () => {
					throw new Error("notification service unavailable");
				},
				async () => ({
					error: vi.fn(() => {
						throw new Error("notification rendering failed");
					}),
				}),
			]) {
				const cancel = vi.fn();
				const provider = testProvider();
				const bridge = testBridge(plan([{ kind: "file" }]), {
					workspaceCancelDelete: cancel,
				});
				const registration = registerWorkspaceDeleteCoordinator(
					bridge,
					provider,
					failingNotificationService,
				);
				disposables.push(registration);
				const original = new Error("provider unavailable");
				let caught: unknown;
				try {
					await runPlainWorkspaceDeleteCoordinator(
						context([element("unknown.txt")], {
							explorerService: {
								async applyBulkEdit(edits) {
									terminalizeAuthorizedEdit(edits[0]!, terminal);
									throw original;
								},
							},
						}),
					);
				} catch (error) {
					caught = error;
				}
				expect(caught).toBeInstanceOf(WorkspaceDeleteIncompleteError);
				expect((caught as WorkspaceDeleteIncompleteError).message).toBe(
					terminal === "entryRetained"
						? "The permanent delete batch stopped after a native delete became incomplete."
						: "The permanent delete batch did not complete.",
				);
				const details = getWorkspaceDeleteIncompleteDetails(caught);
				expect(details?.deletedEntries).toBe(0);
				if (terminal === "entryRetained") {
					expect(details?.incompleteResult).toEqual({
						status: "entryRetained",
						reason: "entryChanged",
					});
				} else {
					expect(details?.incompleteResult).toBeUndefined();
				}
				expect(provider.refresh).toHaveBeenCalledTimes(1);
				expect(cancel).toHaveBeenCalledTimes(1);
				registration.dispose();
				disposables.pop();
			}
		}
	});

	it("preserves a zero-side-effect ordinary provider failure while cancelling and refreshing, without notifying", async () => {
		const provider = testProvider();
		const cancel = vi.fn();
		const bridge = testBridge(plan([{ kind: "file" }]), {
			workspaceCancelDelete: cancel,
		});
		const notifier = testNotifier();
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				async () => notifier,
			),
		);
		const ordinary = new Error("ordinary failure");

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context([element("ordinary.txt")], {
					explorerService: {
						async applyBulkEdit(edits) {
							terminalizeAuthorizedEdit(edits[0]!, "ordinaryFailure");
							throw ordinary;
						},
					},
				}),
			),
		).rejects.toBe(ordinary);
		expect(provider.refresh).toHaveBeenCalledTimes(1);
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(notifier.error).not.toHaveBeenCalled();
	});

	it("prepares, confirms and begins system Trash before mode-matched edits consume entries in order", async () => {
		const order: string[] = [];
		const prepareTrash = vi.fn(async () => {
			order.push("prepare-trash");
			return trashPlan([{ kind: "directory" }, { kind: "symlink" }]);
		});
		const beginTrash = vi.fn(async () => {
			order.push("begin-trash");
		});
		const cancelTrash = vi.fn();
		const prepareDelete = vi.fn();
		const bridge = testBridge(plan([]), {
			workspacePrepareDelete: prepareDelete,
			workspacePrepareTrash: prepareTrash,
			workspaceBeginTrash: beginTrash,
			workspaceCancelTrash: cancelTrash,
		});
		const provider = testProvider();
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				getTestNotificationService,
			),
		);
		const dirty = Object.freeze({ id: "trash-dirty" });
		const confirm = vi.fn(async (options) => {
			order.push("confirm-trash");
			expect(options.message).toBe("将所选 2 项移到废纸篓？");
			expect(options.detail).toContain("系统废纸篓");
			expect(options.detail).toContain("可在废纸篓中恢复");
			expect(options.detail).toContain("1 个未保存");
			expect(options.detail).toContain("1 个所选条目被配置为只读");
			expect(options.detail).not.toContain("永久且不可撤销");
			expect(options.primaryButton).toBe("移到废纸篓");
			return { confirmed: true };
		});
		const applyBulkEdit = vi.fn(async (edits, options) => {
			order.push("apply-trash");
			expect(options).toEqual({
				undoLabel: "移到废纸篓",
				progressLabel: "正在将 2 项移到废纸篓",
			});
			expect(edits).toHaveLength(2);
			for (const edit of edits) {
				expect(edit.options).toMatchObject({
					recursive: true,
					ignoreIfNotExists: false,
					skipTrashBin: false,
				});
				expect(JSON.stringify(edit.options)).not.toContain(confirmationId);
				terminalizeAuthorizedEdit(edit, "trashed", true);
			}
		});

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context(
					[
						element("trash-dir", { isDirectory: true }),
						element("trash-link", { workspaceRootId: secondRootId }),
					],
					{
						useTrash: true,
						dialogService: { confirm },
						explorerService: { applyBulkEdit },
						workingCopyFileService: {
							getDirty(resource) {
								return resource.path === "/trash-dir" ? [dirty] : [];
							},
						},
						filesConfigurationService: {
							isReadonly(resource) {
								return resource.path === "/trash-link";
							},
						},
					},
				),
			),
		).resolves.toBeUndefined();

		expect(order).toEqual([
			"prepare-trash",
			"confirm-trash",
			"begin-trash",
			"apply-trash",
		]);
		expect(prepareTrash).toHaveBeenCalledWith([
			{ rootId, relativePath: "trash-dir" },
			{ rootId: secondRootId, relativePath: "trash-link" },
		]);
		expect(beginTrash).toHaveBeenCalledWith(confirmationId);
		expect(cancelTrash).not.toHaveBeenCalled();
		expect(prepareDelete).not.toHaveBeenCalled();
		expect(provider.refresh).not.toHaveBeenCalled();
	});

	it("cancels a prepared system Trash batch when its only DOM dialog is declined", async () => {
		const cancelTrash = vi.fn();
		const beginTrash = vi.fn();
		const applyBulkEdit = vi.fn();
		const bridge = testBridge(plan([]), {
			workspacePrepareTrash: vi.fn(async () => trashPlan([{ kind: "file" }])),
			workspaceCancelTrash: cancelTrash,
			workspaceBeginTrash: beginTrash,
		});
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				testProvider(),
				getTestNotificationService,
			),
		);

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context([element("cancel-trash.txt")], {
					useTrash: true,
					dialogService: {
						async confirm() {
							return { confirmed: false };
						},
					},
					explorerService: { applyBulkEdit },
				}),
			),
		).resolves.toBeUndefined();

		expect(cancelTrash).toHaveBeenCalledOnce();
		expect(cancelTrash).toHaveBeenCalledWith(confirmationId);
		expect(beginTrash).not.toHaveBeenCalled();
		expect(applyBulkEdit).not.toHaveBeenCalled();
	});

	it("reports a path-free retained result when begin detects an entry changed during DOM confirmation", async () => {
		const cancelTrash = vi.fn();
		const applyBulkEdit = vi.fn();
		const provider = testProvider();
		const notifier = testNotifier();
		const bridge = testBridge(plan([]), {
			workspacePrepareTrash: vi.fn(async () => trashPlan([{ kind: "file" }])),
			workspaceBeginTrash: vi.fn(async () => {
				throw Object.freeze({
					code: "WORKSPACE_TRASH_BATCH_CHANGED",
					message: "private /Users/owner/workspace path",
				});
			}),
			workspaceCancelTrash: cancelTrash,
		});
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				async () => notifier,
			),
		);

		await expect(
			runPlainWorkspaceDeleteCoordinator(
				context([element("changed-during-confirm.txt")], {
					useTrash: true,
					explorerService: { applyBulkEdit },
				}),
			),
		).resolves.toBeUndefined();

		expect(notifier.error).toHaveBeenCalledOnce();
		const [message] = vi.mocked(notifier.error).mock.calls[0]!;
		expect(message).toBe(
			"A selected workspace entry changed before it could be moved to the system Trash.",
		);
		expect(message).not.toContain("WORKSPACE_TRASH_BATCH_CHANGED");
		expect(message).not.toContain("/Users/");
		expect(provider.refresh).toHaveBeenCalledOnce();
		expect(cancelTrash).toHaveBeenCalledOnce();
		expect(applyBulkEdit).not.toHaveBeenCalled();
	});

	it("stops on retained or unknown Trash terminals, refreshes roots and never falls back to permanent delete", async () => {
		const expectedMessages = Object.freeze({
			entryRetained:
				"The system Trash batch stopped before an entry could be moved.",
			outcomeUnknown:
				"The system Trash batch did not complete. Check the Trash before retrying.",
		});
		for (const terminal of ["entryRetained", "outcomeUnknown"] as const) {
			const cancelTrash = vi.fn();
			const commitDelete = vi.fn();
			const provider = testProvider();
			const notifier = testNotifier();
			const bridge = testBridge(plan([]), {
				workspacePrepareTrash: vi.fn(async () =>
					trashPlan([{ kind: "file" }, { kind: "file" }]),
				),
				workspaceBeginTrash: vi.fn(),
				workspaceCancelTrash: cancelTrash,
				workspaceCommitDeleteEntry: commitDelete,
			});
			const registration = registerWorkspaceDeleteCoordinator(
				bridge,
				provider,
				async () => notifier,
			);
			disposables.push(registration);

			await expect(
				runPlainWorkspaceDeleteCoordinator(
					context([element("first-trash.txt"), element("second-trash.txt")], {
						useTrash: true,
						explorerService: {
							async applyBulkEdit(edits) {
								terminalizeAuthorizedEdit(edits[0]!, terminal, true);
								throw new Error("provider stopped the batch");
							},
						},
					}),
				),
			).resolves.toBeUndefined();

			expect(notifier.error).toHaveBeenCalledWith(expectedMessages[terminal]);
			expect(provider.refresh).toHaveBeenCalledOnce();
			expect(cancelTrash).toHaveBeenCalledOnce();
			expect(commitDelete).not.toHaveBeenCalled();
			registration.dispose();
			disposables.pop();
		}
	});

	it("preserves branded Trash details if notification delivery fails", async () => {
		const provider = testProvider();
		const bridge = testBridge(plan([]), {
			workspacePrepareTrash: vi.fn(async () => trashPlan([{ kind: "file" }])),
			workspaceBeginTrash: vi.fn(),
		});
		disposables.push(
			registerWorkspaceDeleteCoordinator(bridge, provider, async () => {
				throw new Error("notification unavailable");
			}),
		);

		let caught: unknown;
		try {
			await runPlainWorkspaceDeleteCoordinator(
				context([element("retained-trash.txt")], {
					useTrash: true,
					explorerService: {
						async applyBulkEdit(edits) {
							terminalizeAuthorizedEdit(edits[0]!, "entryRetained", true);
							throw new Error("provider retained entry");
						},
					},
				}),
			);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(WorkspaceTrashIncompleteError);
		expect(getWorkspaceTrashIncompleteDetails(caught)).toEqual({
			trashedEntries: 0,
			incompleteResult: {
				status: "entryRetained",
				reason: "trashFailed",
			},
		});
		expect(provider.refresh).toHaveBeenCalledOnce();
	});

	it("accepts an exact 64-entry selection and cancels it without creating edits", async () => {
		const entries = Array.from({ length: 64 }, (_, index) =>
			element(`file-${index}.txt`),
		);
		const prepare = vi.fn(async (_entries: readonly unknown[]) =>
			plan(entries.map(() => ({ kind: "file" as const }))),
		);
		const cancel = vi.fn();
		const bridge = testBridge(plan([]), {
			workspacePrepareDelete: prepare,
			workspaceCancelDelete: cancel,
		});
		disposables.push(
			registerWorkspaceDeleteCoordinator(
				bridge,
				testProvider(),
				getTestNotificationService,
			),
		);

		await runPlainWorkspaceDeleteCoordinator(
			context(entries, {
				dialogService: {
					async confirm() {
						return { confirmed: false };
					},
				},
			}),
		);

		expect(prepare.mock.calls[0]?.[0]).toHaveLength(64);
		expect(cancel).toHaveBeenCalledOnce();
	});
});
