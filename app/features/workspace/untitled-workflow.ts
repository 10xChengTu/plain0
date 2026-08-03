import {
	KeyCode,
	KeyMod,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/keyCodes";
import { onUnexpectedError } from "@codingame/monaco-vscode-api/vscode/vs/base/common/errors";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { CommandsRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands";
import { ConfirmResult } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs";
import type { IDialogService } from "@codingame/monaco-vscode-api/vscode/vs/platform/dialogs/common/dialogs.service";
import {
	KeybindingWeight,
	KeybindingsRegistry,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/keybinding/common/keybindingsRegistry";
import type { INotificationService } from "@codingame/monaco-vscode-api/vscode/vs/platform/notification/common/notification.service";
import {
	EditorsOrder,
	type IEditorIdentifier,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor";
import type {
	EditorInput,
	IEditorCloseHandler,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor/editorInput";
import type { IEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/editor/common/editorService.service";
import type { ITextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/textfile/common/textEditorService.service";
import type { IUntitledTextEditorModel } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/untitled/common/untitledTextEditorModel";
import type { IUntitledTextEditorService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/untitled/common/untitledTextEditorService.service";
import type { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";

import { normalizeCommandError, type PlainBridge } from "../../platform/tauri";
import {
	plainUntitledResourceForScratchId,
	scratchIdFromPlainUntitledResource,
} from "../../services/plain-untitled-resource";
import type {
	PlainWorkspaceProviderStat,
	PlainWorkspaceReadFileResult,
	PlainWorkspaceWriteFileResult,
} from "./file-system-provider";
import type { WorkspaceTopologyCoordinator } from "./workspace-projection";

export const PLAIN_UNTITLED_COMMAND_IDS = Object.freeze({
	newTextFile: "workbench.action.files.newUntitledFile",
	save: "workbench.action.files.save",
	saveAs: "workbench.action.files.saveAs",
});

const PLAIN_WORKSPACE_SCHEME = "plain-workspace";

export interface PlainUntitledWorkspaceProvider {
	plainReadFile(resource: URI): Promise<PlainWorkspaceReadFileResult>;
	plainWriteFile(
		resource: URI,
		content: Uint8Array,
		expectedVersion: string,
	): Promise<PlainWorkspaceWriteFileResult>;
	plainPublishFile(
		resource: URI,
		content: Uint8Array,
	): Promise<PlainWorkspaceWriteFileResult>;
}

export interface PlainUntitledWorkflowServices {
	readonly editorService: IEditorService;
	readonly textEditorService: ITextEditorService;
	readonly untitledTextEditorService: IUntitledTextEditorService;
	readonly workingCopyBackupService: IWorkingCopyBackupService;
	readonly dialogService: IDialogService;
	readonly notificationService: INotificationService;
}

export interface PlainUntitledWorkflowRegistration {
	dispose(): void;
}

interface PlainUntitledLanguageDetectionModel {
	autoDetectLanguage(): Promise<void>;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function targetResource(rootId: string, relativePath: string): URI {
	return URI.from({
		scheme: PLAIN_WORKSPACE_SCHEME,
		authority: rootId,
		path: `/${relativePath}`,
	});
}

function targetFileName(relativePath: string): string {
	return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

function suggestedFileName(resource: URI): string {
	const label = resource.path.startsWith("/")
		? resource.path.slice(1)
		: resource.path;
	return /^Untitled-[0-9]+$/u.test(label) ? `${label}.txt` : "Untitled.txt";
}

function verifiedWrittenStat(
	result: PlainWorkspaceWriteFileResult,
): PlainWorkspaceProviderStat | undefined {
	return result.status === "written" && result.stat.plainVersion !== null
		? result.stat
		: undefined;
}

export class PlainUntitledWorkflow {
	private readonly attachedInputs = new WeakSet<EditorInput>();
	private readonly saveOperations = new WeakMap<
		EditorInput,
		Promise<boolean>
	>();

	constructor(
		private readonly bridge: PlainBridge,
		private readonly topologyCoordinator: WorkspaceTopologyCoordinator,
		private readonly workspaceProvider: PlainUntitledWorkspaceProvider,
		private readonly services: PlainUntitledWorkflowServices,
	) {}

	attachOpenEditors(): void {
		for (const input of this.services.editorService.editors) {
			this.attachInput(input);
		}
	}

	isPlainUntitled(input: EditorInput | undefined): input is EditorInput {
		return this.modelForInput(input) !== undefined;
	}

	async openNew(): Promise<void> {
		let resource: URI | undefined;
		let model: IUntitledTextEditorModel | undefined;
		try {
			const created = await this.bridge.scratchCreate();
			resource = plainUntitledResourceForScratchId(created.scratchId);
			model = this.services.untitledTextEditorService.create({
				untitledResource: resource,
			});
			const input = this.services.textEditorService.createTextEditor({
				resource,
				forceUntitled: true,
			});
			if (!this.attachInput(input)) {
				throw new Error("Plain could not attach the Untitled editor.");
			}
			const pane = await this.services.editorService.openEditor(input, {
				pinned: true,
			});
			if (pane === undefined) {
				throw new Error("Plain could not open the Untitled editor.");
			}
		} catch (error) {
			if (model !== undefined) {
				await this.discardModel(model);
			} else if (resource !== undefined) {
				try {
					await this.services.workingCopyBackupService.discardBackup({
						resource,
						typeId: "",
					});
				} catch {
					// Preserve the original creation/open failure.
				}
			}
			this.reportError(error);
		}
	}

	async saveActive(): Promise<boolean> {
		const input = this.services.editorService.activeEditor;
		return this.isPlainUntitled(input) ? this.saveInput(input) : false;
	}

	async saveInput(input: EditorInput): Promise<boolean> {
		const current = this.saveOperations.get(input);
		if (current !== undefined) return current;
		const operation = this.doSaveInput(input).finally(() => {
			this.saveOperations.delete(input);
		});
		this.saveOperations.set(input, operation);
		return operation;
	}

	private async doSaveInput(input: EditorInput): Promise<boolean> {
		const model = this.modelForInput(input);
		if (model === undefined) return false;
		try {
			const picked = await this.topologyCoordinator.runMutation(async () => {
				const result = await this.bridge.workspacePickSaveTarget(
					suggestedFileName(model.resource),
				);
				return Object.freeze({
					result,
					snapshot: result.status === "selected" ? result.snapshot : undefined,
				});
			});
			if (picked.status === "cancelled" || picked.target === null) return false;

			const target = targetResource(
				picked.target.rootId,
				picked.target.relativePath,
			);
			if (this.services.editorService.findEditors(target).length > 0) {
				this.services.notificationService.warn(
					"Close the existing target editor before replacing it.",
				);
				return false;
			}

			await model.resolve();
			if (!model.isResolved()) {
				throw new Error("Plain could not resolve the Untitled content.");
			}
			const contentVersion = model.textEditorModel.getAlternativeVersionId();
			const content = new TextEncoder().encode(
				model.textEditorModel.getValue(),
			);

			let result: PlainWorkspaceWriteFileResult;
			const existing = picked.target.existingStat;
			if (existing === null) {
				result = await this.workspaceProvider.plainPublishFile(target, content);
			} else {
				if (existing.kind !== "file" || existing.version === null) {
					this.services.notificationService.error(
						"The selected target is not a writable regular file.",
					);
					return false;
				}
				const confirmation = await this.services.dialogService.confirm({
					type: "warning",
					message: `Replace '${targetFileName(picked.target.relativePath)}'?`,
					detail:
						"The existing file will be replaced with this Untitled document.",
					primaryButton: "Replace",
				});
				if (!confirmation.confirmed) return false;
				result = await this.workspaceProvider.plainWriteFile(
					target,
					content,
					existing.version,
				);
			}

			const writtenStat = verifiedWrittenStat(result);
			if (writtenStat === undefined) {
				throw new Error(
					"Plain could not verify that the Save As target was published.",
				);
			}
			const accepted = await this.workspaceProvider.plainReadFile(target);
			if (
				accepted.stat.plainVersion !== writtenStat.plainVersion ||
				!bytesEqual(accepted.value, content)
			) {
				throw new Error(
					"Plain could not verify the saved bytes through the workspace provider.",
				);
			}
			if (
				!model.isResolved() ||
				model.textEditorModel.getAlternativeVersionId() !== contentVersion
			) {
				this.services.notificationService.warn(
					"The Untitled document changed while it was being saved. It remains open and unsaved.",
				);
				return false;
			}

			const groups = this.services.editorService
				.getEditors(EditorsOrder.SEQUENTIAL)
				.filter((entry) => entry.editor === input)
				.map((entry) => entry.groupId);
			if (groups.length === 0) return false;
			for (const groupId of groups) {
				await this.services.editorService.replaceEditors(
					[
						{
							editor: input,
							replacement: {
								resource: target,
								options: { pinned: true },
							},
							forceReplaceDirty: true,
						},
					],
					groupId,
				);
			}
			if (
				this.services.editorService.editors.includes(input) ||
				this.services.editorService.findEditors(target).length === 0
			) {
				throw new Error(
					"Plain could not replace the Untitled editor with its saved target.",
				);
			}

			await model.revert();
			try {
				await this.services.workingCopyBackupService.discardBackup(model);
			} catch (error) {
				this.services.notificationService.warn(
					`The file was saved, but Plain could not clear its recovery copy: ${normalizeCommandError(error).message}`,
				);
			}
			return true;
		} catch (error) {
			this.reportError(error);
			return false;
		}
	}

	private attachInput(input: EditorInput): boolean {
		if (this.attachedInputs.has(input)) return true;
		const model = this.modelForInput(input);
		if (model === undefined) return false;
		const languageDetectionModel =
			model as unknown as PlainUntitledLanguageDetectionModel;
		model.onDidChangeContent(() => {
			// Upstream fires this public event immediately before it starts the same
			// throttled detection. Joining the shared promise here gives its dispose-
			// time CancellationError an owner when a fast Save As or close destroys
			// the model inside the 600 ms throttle window.
			void languageDetectionModel.autoDetectLanguage().catch(onUnexpectedError);
		});
		const closeHandler: IEditorCloseHandler = Object.freeze({
			showConfirm: () => !input.isDisposed(),
			confirm: async (editors: readonly IEditorIdentifier[]) => {
				const groupId =
					editors.find((candidate) => candidate.editor === input)?.groupId ??
					editors[0]?.groupId;
				if (groupId === undefined) return ConfirmResult.CANCEL;
				if (!input.isDirty()) {
					await this.discardInput(input);
					return ConfirmResult.CANCEL;
				}
				const choice = await this.services.dialogService.prompt<
					"save" | "discard" | "cancel"
				>({
					type: "warning",
					message: `Do you want to save the changes to '${input.getName()}'?`,
					detail: "Your changes will be lost if you don't save them.",
					buttons: [
						{ label: "Save", run: () => "save" },
						{ label: "Don't Save", run: () => "discard" },
					],
					cancelButton: { label: "Cancel", run: () => "cancel" },
				});
				if (choice.result === "save") {
					await this.saveInput(input);
				} else if (choice.result === "discard") {
					await this.discardInput(input);
				}
				// Save/discard disposes or replaces this input itself. Veto the
				// original close request so EditorGroup never runs its generic
				// file-dialog path or closes the already-replaced input twice.
				return ConfirmResult.CANCEL;
			},
		});
		try {
			Object.defineProperty(input, "closeHandler", {
				value: closeHandler,
				configurable: true,
			});
		} catch {
			return false;
		}
		this.attachedInputs.add(input);
		return true;
	}

	private async discardInput(input: EditorInput): Promise<boolean> {
		const currentSave = this.saveOperations.get(input);
		if (currentSave !== undefined && (await currentSave)) return true;
		const model = this.modelForInput(input);
		if (model === undefined) return false;
		return this.discardModel(model);
	}

	private async discardModel(
		model: IUntitledTextEditorModel,
	): Promise<boolean> {
		try {
			await model.revert();
			await this.services.workingCopyBackupService.discardBackup(model);
			return true;
		} catch (error) {
			this.reportError(error);
			return false;
		}
	}

	private modelForInput(
		input: EditorInput | undefined,
	): IUntitledTextEditorModel | undefined {
		const resource = input?.resource;
		if (
			resource === undefined ||
			scratchIdFromPlainUntitledResource(resource) === undefined
		) {
			return undefined;
		}
		return this.services.untitledTextEditorService.get(resource);
	}

	private reportError(error: unknown): void {
		this.services.notificationService.error(
			normalizeCommandError(error).message,
		);
	}
}

export function registerPlainUntitledWorkflow(
	bridge: PlainBridge,
	topologyCoordinator: WorkspaceTopologyCoordinator,
	workspaceProvider: PlainUntitledWorkspaceProvider,
	services: PlainUntitledWorkflowServices,
): PlainUntitledWorkflowRegistration {
	const workflow = new PlainUntitledWorkflow(
		bridge,
		topologyCoordinator,
		workspaceProvider,
		services,
	);
	const previousSave = CommandsRegistry.getCommand(
		PLAIN_UNTITLED_COMMAND_IDS.save,
	);
	const previousSaveAs = CommandsRegistry.getCommand(
		PLAIN_UNTITLED_COMMAND_IDS.saveAs,
	);
	const registrations = [
		services.editorService.onDidEditorsChange(() =>
			workflow.attachOpenEditors(),
		),
		CommandsRegistry.registerCommand(
			PLAIN_UNTITLED_COMMAND_IDS.newTextFile,
			() => workflow.openNew(),
		),
		KeybindingsRegistry.registerKeybindingRule({
			id: PLAIN_UNTITLED_COMMAND_IDS.newTextFile,
			weight: KeybindingWeight.WorkbenchContrib + 1,
			when: undefined,
			primary: KeyMod.CtrlCmd | KeyCode.KeyN,
		}),
		CommandsRegistry.registerCommand(
			PLAIN_UNTITLED_COMMAND_IDS.save,
			(accessor, ...args) =>
				workflow.isPlainUntitled(services.editorService.activeEditor)
					? workflow.saveActive()
					: previousSave?.handler(accessor, ...args),
		),
		CommandsRegistry.registerCommand(
			PLAIN_UNTITLED_COMMAND_IDS.saveAs,
			(accessor, ...args) =>
				workflow.isPlainUntitled(services.editorService.activeEditor)
					? workflow.saveActive()
					: previousSaveAs?.handler(accessor, ...args),
		),
	];
	workflow.attachOpenEditors();
	return {
		dispose() {
			for (const registration of registrations.reverse()) {
				registration.dispose();
			}
		},
	};
}
