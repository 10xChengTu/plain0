import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { FileType } from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import { ConfirmResult } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs";
import { EditorsOrder } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor";
import type { EditorInput } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor/editorInput";
import type { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import type { ITextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textEditorService.service";
import type { IUntitledTextEditorModel } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/untitled/common/untitledTextEditorModel";
import type { IUntitledTextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/untitled/common/untitledTextEditorService.service";
import type { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";
import { describe, expect, it, vi } from "vitest";

import {
	PlainUntitledWorkflow,
	type PlainUntitledWorkspaceProvider,
} from "../../app/features/workspace/untitled-workflow";
import type { PlainWorkspaceWriteFileResult } from "../../app/features/workspace/file-system-provider";
import type { WorkspaceTopologyCoordinator } from "../../app/features/workspace/workspace-projection";
import type {
	PlainBridge,
	WorkspacePickSaveTargetResult,
} from "../../app/platform/tauri";
import { plainUntitledResourceForScratchId } from "../../app/services/plain-untitled-resource";

const SCRATCH_ID = "00000000-0000-4000-8000-000000000121";
const ROOT_ID = "00000000-0000-4000-8000-000000000122";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000123";
const VERSION = `wv1:${"a".repeat(64)}`;
const WRITTEN_VERSION = `wv1:${"b".repeat(64)}`;

function snapshot() {
	return Object.freeze({
		workspaceId: WORKSPACE_ID,
		revision: 1,
		roots: Object.freeze([
			Object.freeze({
				rootId: ROOT_ID,
				displayName: "fixture",
				uri: `plain-workspace://${ROOT_ID}/`,
			}),
		]),
	});
}

function selectedTarget(existing: boolean): WorkspacePickSaveTargetResult {
	return Object.freeze({
		status: "selected" as const,
		snapshot: snapshot(),
		target: Object.freeze({
			rootId: ROOT_ID,
			relativePath: "saved.txt",
			existingStat: existing
				? Object.freeze({
						kind: "file" as const,
						size: 3,
						mtime: 1,
						ctime: 1,
						version: VERSION,
					})
				: null,
		}),
	});
}

function cancelledTarget(): WorkspacePickSaveTargetResult {
	return Object.freeze({
		status: "cancelled" as const,
		snapshot: snapshot(),
		target: null,
	});
}

interface EditorEntry {
	readonly editor: EditorInput;
	readonly groupId: number;
}

interface Replacement {
	readonly editor: EditorInput;
	readonly replacement: { readonly resource: URI };
	readonly forceReplaceDirty?: boolean;
}

function createHarness(options: { initiallyOpen?: boolean } = {}) {
	const sourceResource = plainUntitledResourceForScratchId(SCRATCH_ID);
	let dirty = true;
	let disposed = false;
	let content = "UNTITLED BODY\n";
	let contentVersion = 1;
	let revertCalls = 0;
	let pickerResult: WorkspacePickSaveTargetResult = cancelledTarget();
	let overwriteConfirmed = true;
	let promptChoice: "save" | "discard" | "cancel" = "cancel";
	let writeResultOverride: PlainWorkspaceWriteFileResult | undefined;
	let mutateDuringWrite = false;
	let storedBytes = new Uint8Array();
	const errors: string[] = [];
	const warnings: string[] = [];
	const publishCalls: Uint8Array[] = [];
	const writeCalls: Array<{ version: string; content: Uint8Array }> = [];
	const replacementCalls: Replacement[][] = [];
	const discarded: string[] = [];
	const editorEntries: EditorEntry[] = [];
	const editorInputs: EditorInput[] = [];

	const model = {
		resource: sourceResource,
		typeId: "",
		name: "Untitled-1",
		isDirty: () => dirty,
		isModified: () => dirty,
		isResolved: () => true,
		resolve: vi.fn(async () => undefined),
		revert: vi.fn(async () => {
			revertCalls += 1;
			dirty = false;
			disposed = true;
		}),
		textEditorModel: {
			getValue: () => content,
			getAlternativeVersionId: () => contentVersion,
		},
	} as unknown as IUntitledTextEditorModel;

	const input = {
		resource: sourceResource,
		typeId: "workbench.editors.untitledEditorInput",
		isDisposed: () => disposed,
		isDirty: () => dirty,
		getName: () => "Untitled-1",
	} as unknown as EditorInput;

	if (options.initiallyOpen !== false) {
		editorEntries.push({ editor: input, groupId: 1 });
		editorInputs.push(input);
	}

	const editorService = {
		get activeEditor() {
			return editorInputs[0];
		},
		get editors() {
			return editorInputs;
		},
		onDidEditorsChange: () => ({ dispose() {} }),
		getEditors: (order: EditorsOrder) => {
			expect(order).toBe(EditorsOrder.SEQUENTIAL);
			return editorEntries;
		},
		findEditors: (resource: URI) =>
			editorEntries.filter(
				(entry) => entry.editor.resource?.toString() === resource.toString(),
			),
		replaceEditors: vi.fn(
			async (replacements: readonly Replacement[], groupId: number) => {
				replacementCalls.push([...replacements]);
				for (const replacement of replacements) {
					expect(replacement.forceReplaceDirty).toBe(true);
					const targetInput = {
						resource: replacement.replacement.resource,
						isDirty: () => false,
						isDisposed: () => false,
						getName: () => "saved.txt",
					} as unknown as EditorInput;
					const entryIndex = editorEntries.findIndex(
						(entry) =>
							entry.editor === replacement.editor && entry.groupId === groupId,
					);
					if (entryIndex >= 0) {
						editorEntries.splice(entryIndex, 1, {
							editor: targetInput,
							groupId,
						});
					}
					const inputIndex = editorInputs.indexOf(replacement.editor);
					if (inputIndex >= 0) editorInputs.splice(inputIndex, 1, targetInput);
				}
			},
		),
		openEditor: vi.fn(async (openedInput: EditorInput) => {
			if (!editorInputs.includes(openedInput)) {
				editorInputs.push(openedInput);
				editorEntries.push({ editor: openedInput, groupId: 1 });
			}
			return Object.freeze({});
		}),
	} as unknown as IEditorService;

	const untitledService = {
		get: (resource: URI) =>
			resource.toString() === sourceResource.toString() ? model : undefined,
		create: () => model,
	} as unknown as IUntitledTextEditorService;
	const textEditorService = {
		createTextEditor: () => input,
	} as unknown as ITextEditorService;
	const backupService = {
		discardBackup: vi.fn(async (identifier: { resource: URI }) => {
			discarded.push(identifier.resource.toString());
		}),
	} as unknown as IWorkingCopyBackupService;
	const dialogService = {
		confirm: vi.fn(async () => ({ confirmed: overwriteConfirmed })),
		prompt: vi.fn(async () => ({ result: promptChoice })),
	};
	const notificationService = {
		error: (message: string) => errors.push(message),
		warn: (message: string) => warnings.push(message),
	};
	const bridge = {
		scratchCreate: vi.fn(async () => Object.freeze({ scratchId: SCRATCH_ID })),
		workspacePickSaveTarget: vi.fn(async () => pickerResult),
	} as unknown as PlainBridge;
	const topologyCoordinator = {
		runMutation: vi.fn(
			async <T>(operation: () => Promise<{ result: T }>) =>
				(await operation()).result,
		),
	} as unknown as WorkspaceTopologyCoordinator;
	const writtenStat = (bytes: Uint8Array) =>
		Object.freeze({
			type: FileType.File,
			size: bytes.byteLength,
			mtime: 2,
			ctime: 1,
			plainVersion: WRITTEN_VERSION,
		});
	const provider: PlainUntitledWorkspaceProvider = {
		async plainPublishFile(_resource, bytes) {
			publishCalls.push(bytes.slice());
			storedBytes = bytes.slice();
			if (mutateDuringWrite) contentVersion += 1;
			return (
				writeResultOverride ??
				Object.freeze({ status: "written", stat: writtenStat(bytes) })
			);
		},
		async plainWriteFile(_resource, bytes, version) {
			writeCalls.push({ version, content: bytes.slice() });
			storedBytes = bytes.slice();
			if (mutateDuringWrite) contentVersion += 1;
			return (
				writeResultOverride ??
				Object.freeze({ status: "written", stat: writtenStat(bytes) })
			);
		},
		async plainReadFile() {
			return Object.freeze({
				stat: writtenStat(storedBytes),
				value: storedBytes.slice(),
			});
		},
	};

	const workflow = new PlainUntitledWorkflow(
		bridge,
		topologyCoordinator,
		provider,
		{
			editorService,
			textEditorService,
			untitledTextEditorService: untitledService,
			workingCopyBackupService: backupService,
			dialogService: dialogService as never,
			notificationService: notificationService as never,
		},
	);

	return {
		workflow,
		input,
		model,
		state: {
			get dirty() {
				return dirty;
			},
			get revertCalls() {
				return revertCalls;
			},
			errors,
			warnings,
			publishCalls,
			writeCalls,
			replacementCalls,
			discarded,
			editorInputs,
		},
		setPicker(result: WorkspacePickSaveTargetResult) {
			pickerResult = result;
		},
		setOverwriteConfirmed(value: boolean) {
			overwriteConfirmed = value;
		},
		setPromptChoice(value: "save" | "discard" | "cancel") {
			promptChoice = value;
		},
		setWriteResult(result: PlainWorkspaceWriteFileResult) {
			writeResultOverride = result;
		},
		setMutateDuringWrite(value: boolean) {
			mutateDuringWrite = value;
		},
		setContent(value: string) {
			content = value;
			contentVersion += 1;
		},
	};
}

describe("PlainUntitledWorkflow", () => {
	it("keeps the dirty Untitled editor unchanged when the native picker is cancelled", async () => {
		const harness = createHarness();
		expect(await harness.workflow.saveInput(harness.input)).toBe(false);
		expect(harness.state.publishCalls).toEqual([]);
		expect(harness.state.writeCalls).toEqual([]);
		expect(harness.state.replacementCalls).toEqual([]);
		expect(harness.state.discarded).toEqual([]);
		expect(harness.state.dirty).toBe(true);
	});

	it("publishes a new target, verifies it through the provider, then replaces and clears scratch", async () => {
		const harness = createHarness();
		harness.setPicker(selectedTarget(false));
		expect(await harness.workflow.saveInput(harness.input)).toBe(true);
		expect(harness.state.publishCalls).toEqual([
			new TextEncoder().encode("UNTITLED BODY\n"),
		]);
		expect(harness.state.writeCalls).toEqual([]);
		expect(harness.state.replacementCalls).toHaveLength(1);
		expect(harness.state.revertCalls).toBe(1);
		expect(harness.state.discarded).toEqual([
			plainUntitledResourceForScratchId(SCRATCH_ID).toString(),
		]);
		expect(harness.state.dirty).toBe(false);
	});

	it("requires explicit overwrite confirmation and the picker version receipt", async () => {
		const harness = createHarness();
		harness.setPicker(selectedTarget(true));
		harness.setOverwriteConfirmed(false);
		expect(await harness.workflow.saveInput(harness.input)).toBe(false);
		expect(harness.state.writeCalls).toEqual([]);

		harness.setOverwriteConfirmed(true);
		expect(await harness.workflow.saveInput(harness.input)).toBe(true);
		expect(harness.state.writeCalls).toEqual([
			{
				version: VERSION,
				content: new TextEncoder().encode("UNTITLED BODY\n"),
			},
		]);
	});

	it("keeps scratch and the dirty editor when publication is not fully verified", async () => {
		const harness = createHarness();
		harness.setPicker(selectedTarget(false));
		harness.setWriteResult(
			Object.freeze({
				status: "targetPublished",
				publicationEvidence: "targetObservedWritten",
				rename: "reportedSuccess",
				directorySync: "failed",
				target: "matchesWritten",
			}),
		);
		expect(await harness.workflow.saveInput(harness.input)).toBe(false);
		expect(harness.state.replacementCalls).toEqual([]);
		expect(harness.state.discarded).toEqual([]);
		expect(harness.state.dirty).toBe(true);
		expect(harness.state.errors.at(-1)).toContain("could not verify");
	});

	it("does not close a document that changes while the target write is in flight", async () => {
		const harness = createHarness();
		harness.setPicker(selectedTarget(false));
		harness.setMutateDuringWrite(true);
		expect(await harness.workflow.saveInput(harness.input)).toBe(false);
		expect(harness.state.publishCalls).toHaveLength(1);
		expect(harness.state.replacementCalls).toEqual([]);
		expect(harness.state.discarded).toEqual([]);
		expect(harness.state.dirty).toBe(true);
		expect(harness.state.warnings.at(-1)).toContain("changed while");
	});

	it("attaches a DOM close confirmation whose cancel and discard branches are side-effect exact", async () => {
		const harness = createHarness();
		harness.workflow.attachOpenEditors();
		const closeHandler = harness.input.closeHandler!;
		expect(closeHandler.showConfirm()).toBe(true);

		harness.setPromptChoice("cancel");
		expect(
			await closeHandler.confirm([{ editor: harness.input, groupId: 1 }]),
		).toBe(ConfirmResult.CANCEL);
		expect(harness.state.dirty).toBe(true);
		expect(harness.state.discarded).toEqual([]);

		harness.setPromptChoice("discard");
		expect(
			await closeHandler.confirm([{ editor: harness.input, groupId: 1 }]),
		).toBe(ConfirmResult.CANCEL);
		expect(harness.state.dirty).toBe(false);
		expect(harness.state.discarded).toHaveLength(1);
	});

	it("routes the close-confirmation save branch through the same verified Save As workflow", async () => {
		const harness = createHarness();
		harness.setPicker(selectedTarget(false));
		harness.setPromptChoice("save");
		harness.workflow.attachOpenEditors();

		expect(
			await harness.input.closeHandler!.confirm([
				{ editor: harness.input, groupId: 1 },
			]),
		).toBe(ConfirmResult.CANCEL);
		expect(harness.state.publishCalls).toHaveLength(1);
		expect(harness.state.replacementCalls).toHaveLength(1);
		expect(harness.state.discarded).toHaveLength(1);
		expect(harness.state.dirty).toBe(false);
	});

	it("creates a Rust-owned scratch id before opening a new Workbench Untitled input", async () => {
		const harness = createHarness({ initiallyOpen: false });
		await harness.workflow.openNew();
		expect(harness.state.editorInputs).toEqual([harness.input]);
		expect(harness.workflow.isPlainUntitled(harness.input)).toBe(true);
		expect(harness.input.closeHandler).toBeDefined();
	});
});
