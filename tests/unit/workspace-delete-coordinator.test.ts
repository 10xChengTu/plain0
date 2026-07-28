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
	registerWorkspaceDeleteCoordinator,
	WorkspaceDeleteIncompleteError,
} from "../../app/features/workspace/delete-coordinator";
import type { PlainWorkspaceDeleteProvider } from "../../app/features/workspace/file-system-provider";
import type {
	PlainBridge,
	RuntimeInfo,
	WorkspaceDeleteBatchPlan,
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

function testBridge(
	deletePlan: WorkspaceDeleteBatchPlan,
	overrides: Partial<PlainBridge> = {},
): PlainBridge {
	return {
		async runtimeInfo() {
			return runtimeInfo;
		},
		async onRuntimeReady() {
			return () => {};
		},
		async workspaceCapabilities() {
			return {
				create: true,
				renameNoReplace: true,
				copyMove: true,
				delete: true,
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
		async workspaceRemoveRoot() {
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
		async debugStepOut() {
			throw new Error("unused");
		},
		async debugPause() {
			throw new Error("unused");
		},
		debugWatchEvent() {
			throw new Error("unused");
		},
		...overrides,
	};
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
	terminal: "deleted" | "ordinaryFailure" | "outcomeUnknown" | "entryRetained",
): void {
	const resource = edit.oldResource!;
	const operation = { resource, recursive: true, useTrash: false };
	expect(
		movePlainWorkspaceDeleteResourceEditAuthorization(
			edit.options,
			resource,
			operation,
		),
	).toBe(true);
	const fileOptions = { recursive: true, useTrash: false, atomic: false };
	expect(
		movePlainWorkspaceDeleteWorkingCopyAuthorization(
			operation,
			resource,
			fileOptions,
		),
	).toBe(true);
	const providerOptions = { recursive: true, useTrash: false, atomic: false };
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
	if (terminal === "deleted") {
		completePlainWorkspaceDeleteProviderResult(authorization!, {
			status: "deleted",
		});
	} else if (terminal === "entryRetained") {
		completePlainWorkspaceDeleteProviderResult(authorization!, {
			status: "entryRetained",
			reason: "entryChanged",
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
		disposables.push(registerWorkspaceDeleteCoordinator(bridge, provider));
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
			registerWorkspaceDeleteCoordinator(bridge, testProvider()),
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

	it("brands retained and response-unknown terminals, refreshes every selected root, and never retries", async () => {
		for (const terminal of ["entryRetained", "outcomeUnknown"] as const) {
			const cancel = vi.fn();
			const provider = testProvider();
			const bridge = testBridge(plan([{ kind: "file" }]), {
				workspaceCancelDelete: cancel,
			});
			const registration = registerWorkspaceDeleteCoordinator(bridge, provider);
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
	});

	it("preserves a zero-side-effect ordinary provider failure while cancelling and refreshing", async () => {
		const provider = testProvider();
		const cancel = vi.fn();
		const bridge = testBridge(plan([{ kind: "file" }]), {
			workspaceCancelDelete: cancel,
		});
		disposables.push(registerWorkspaceDeleteCoordinator(bridge, provider));
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
			registerWorkspaceDeleteCoordinator(bridge, testProvider()),
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
