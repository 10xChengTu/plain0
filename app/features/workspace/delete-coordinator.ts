import { ResourceFileEdit } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/bulkEditService";
import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import {
	authorizePlainWorkspaceDeleteResourceEdit,
	getPlainWorkspaceDeleteState,
	registerPlainWorkspaceDeleteCoordinator,
	type PlainWorkspaceDeleteAuthorization,
	type PlainWorkspaceDeleteCoordinatorContext,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";

import type {
	PlainBridge,
	WorkspaceDeleteBatchPlan,
	WorkspaceDeleteResult,
	WorkspaceTrashBatchPlan,
	WorkspaceTrashResult,
} from "../../platform/tauri";
import type {
	PlainWorkspaceDeleteProvider,
	PlainWorkspaceDeleteResource,
} from "./file-system-provider";

const MAX_DELETE_ENTRIES = 64;

const deleteFailureDetails = new WeakMap<
	WorkspaceDeleteIncompleteError,
	Readonly<{ deletedEntries: number; incompleteResult?: WorkspaceDeleteResult }>
>();
const trashFailureDetails = new WeakMap<
	WorkspaceTrashIncompleteError,
	Readonly<{ trashedEntries: number; incompleteResult?: WorkspaceTrashResult }>
>();

export class WorkspaceDeleteIncompleteError extends Error {
	readonly code = "WORKSPACE_DELETE_INCOMPLETE" as const;

	constructor(
		deletedEntries: number,
		incompleteResult?: WorkspaceDeleteResult,
	) {
		super(
			incompleteResult === undefined
				? "The permanent delete batch did not complete."
				: "The permanent delete batch stopped after a native delete became incomplete.",
		);
		this.name = this.code;
		deleteFailureDetails.set(
			this,
			Object.freeze({
				deletedEntries,
				...(incompleteResult === undefined ? {} : { incompleteResult }),
			}),
		);
		Object.freeze(this);
	}
}

export class WorkspaceTrashIncompleteError extends Error {
	readonly code = "WORKSPACE_TRASH_INCOMPLETE" as const;

	constructor(trashedEntries: number, incompleteResult?: WorkspaceTrashResult) {
		super(
			incompleteResult?.status === "entryRetained"
				? incompleteResult.reason === "entryChanged"
					? "A selected workspace entry changed before it could be moved to the system Trash."
					: incompleteResult.reason === "entryUnverifiable"
						? "A selected workspace entry could not be reverified before it could be moved to the system Trash."
						: "The system Trash batch stopped before an entry could be moved."
				: "The system Trash batch did not complete. Check the Trash before retrying.",
		);
		this.name = this.code;
		trashFailureDetails.set(
			this,
			Object.freeze({
				trashedEntries,
				...(incompleteResult === undefined ? {} : { incompleteResult }),
			}),
		);
		Object.freeze(this);
	}
}

export function getWorkspaceDeleteIncompleteDetails(error: unknown):
	| Readonly<{
			deletedEntries: number;
			incompleteResult?: WorkspaceDeleteResult;
	  }>
	| undefined {
	return error instanceof WorkspaceDeleteIncompleteError
		? deleteFailureDetails.get(error)
		: undefined;
}

export function getWorkspaceTrashIncompleteDetails(error: unknown):
	| Readonly<{
			trashedEntries: number;
			incompleteResult?: WorkspaceTrashResult;
	  }>
	| undefined {
	return error instanceof WorkspaceTrashIncompleteError
		? trashFailureDetails.get(error)
		: undefined;
}

export type PlainDeleteErrorNotificationService = Readonly<{
	error(message: string): unknown;
}>;

function trashCoordinatorFailureResult(
	error: unknown,
): WorkspaceTrashResult | undefined {
	try {
		if (typeof error !== "object" || error === null) {
			return undefined;
		}
		return Reflect.get(error, "code") === "WORKSPACE_TRASH_BATCH_CHANGED"
			? Object.freeze({
					status: "entryRetained" as const,
					reason: "entryChanged" as const,
				})
			: undefined;
	} catch {
		return undefined;
	}
}

interface DeleteSelectionEntry {
	readonly resource: PlainWorkspaceDeleteResource;
	readonly name: string;
}

function snapshotSelection(
	context: PlainWorkspaceDeleteCoordinatorContext,
	provider: PlainWorkspaceDeleteProvider,
): readonly DeleteSelectionEntry[] {
	try {
		if (
			!Array.isArray(context.elements) ||
			context.elements.length < 1 ||
			context.elements.length > MAX_DELETE_ENTRIES
		) {
			throw new Error("Invalid Plain delete selection.");
		}
		const entries = context.elements.map((element) => {
			const resource = element.resource;
			const name = element.name;
			if (typeof name !== "string" || name.length < 1 || name.length > 1024) {
				throw new Error("Invalid Plain delete selection.");
			}
			return Object.freeze({
				resource: provider.plainSnapshotDeleteResource(resource),
				name,
			});
		});
		return Object.freeze(entries);
	} catch {
		throw new Error("The workspace delete selection is invalid.");
	}
}

function confirmationDetail(
	entries: readonly DeleteSelectionEntry[],
	descendantEntries: number,
	dirtyWorkingCopies: number,
	readonlyEntries: number,
): string {
	const names = entries
		.slice(0, 10)
		.map(({ name }) => `• ${name}`)
		.join("\n");
	const remaining =
		entries.length > 10 ? `\n…以及另外 ${entries.length - 10} 项` : "";
	const descendants =
		descendantEntries > 0
			? `\n\n所选目录还包含 ${descendantEntries} 个后代条目。`
			: "";
	const dirty =
		dirtyWorkingCopies > 0
			? `\n\n${dirtyWorkingCopies} 个未保存的工作副本会在对应条目成功删除后丢失。`
			: "";
	const readonly =
		readonlyEntries > 0
			? `\n\n${readonlyEntries} 个所选条目被配置为只读。`
			: "";
	return `${names}${remaining}${descendants}${dirty}${readonly}\n\n此操作永久且不可撤销，不会移入废纸篓。`;
}

function trashConfirmationDetail(
	entries: readonly DeleteSelectionEntry[],
	dirtyWorkingCopies: number,
	readonlyEntries: number,
): string {
	const names = entries
		.slice(0, 10)
		.map(({ name }) => `• ${name}`)
		.join("\n");
	const remaining =
		entries.length > 10 ? `\n…以及另外 ${entries.length - 10} 项` : "";
	const dirty =
		dirtyWorkingCopies > 0
			? `\n\n${dirtyWorkingCopies} 个未保存的工作副本会在对应条目成功移入废纸篓后丢失。`
			: "";
	const readonly =
		readonlyEntries > 0
			? `\n\n${readonlyEntries} 个所选条目被配置为只读。`
			: "";
	return `${names}${remaining}${dirty}${readonly}\n\n所选项目将移到系统废纸篓，可在废纸篓中恢复。`;
}

function createAuthorizedEdits(
	selection: readonly DeleteSelectionEntry[],
	plan: WorkspaceDeleteBatchPlan,
): Readonly<{
	edits: readonly ResourceFileEdit[];
	authorizations: readonly PlainWorkspaceDeleteAuthorization[];
}> {
	if (plan.entries.length !== selection.length) {
		throw new Error("The permanent delete plan is invalid.");
	}
	const authorizations: PlainWorkspaceDeleteAuthorization[] = [];
	const edits = plan.entries.map((entry, index) => {
		const selected = selection[index];
		if (selected === undefined) {
			throw new Error("The permanent delete plan is invalid.");
		}
		const options = {
			recursive: true,
			folder: entry.kind === "directory",
			ignoreIfNotExists: false,
			skipTrashBin: true,
		};
		const authorization = authorizePlainWorkspaceDeleteResourceEdit(
			options,
			selected.resource.resource,
			{
				confirmationId: plan.confirmationId,
				entryId: entry.entryId,
				rootId: selected.resource.rootId,
				relativePath: selected.resource.relativePath,
				recursive: true,
				kind: entry.kind,
				permanent: true,
			},
		);
		authorizations.push(authorization);
		return new ResourceFileEdit(selected.resource.resource, undefined, options);
	});
	return Object.freeze({
		edits: Object.freeze(edits),
		authorizations: Object.freeze(authorizations),
	});
}

function createAuthorizedTrashEdits(
	selection: readonly DeleteSelectionEntry[],
	plan: WorkspaceTrashBatchPlan,
): Readonly<{
	edits: readonly ResourceFileEdit[];
	authorizations: readonly PlainWorkspaceDeleteAuthorization[];
}> {
	if (plan.entries.length !== selection.length) {
		throw new Error("The system Trash plan is invalid.");
	}
	const authorizations: PlainWorkspaceDeleteAuthorization[] = [];
	const edits = plan.entries.map((entry, index) => {
		const selected = selection[index];
		if (selected === undefined) {
			throw new Error("The system Trash plan is invalid.");
		}
		const options = {
			recursive: true,
			folder: entry.kind === "directory",
			ignoreIfNotExists: false,
			skipTrashBin: false,
		};
		const authorization = authorizePlainWorkspaceDeleteResourceEdit(
			options,
			selected.resource.resource,
			{
				confirmationId: plan.confirmationId,
				entryId: entry.entryId,
				rootId: selected.resource.rootId,
				relativePath: selected.resource.relativePath,
				recursive: true,
				kind: entry.kind,
				permanent: false,
			},
		);
		authorizations.push(authorization);
		return new ResourceFileEdit(selected.resource.resource, undefined, options);
	});
	return Object.freeze({
		edits: Object.freeze(edits),
		authorizations: Object.freeze(authorizations),
	});
}

function classifyAuthorizationResults(
	authorizations: readonly PlainWorkspaceDeleteAuthorization[],
): Readonly<{
	deletedEntries: number;
	pendingEntries: number;
	ordinaryFailures: number;
	outcomeUnknown: boolean;
	incompleteResult?: WorkspaceDeleteResult;
}> {
	let deletedEntries = 0;
	let pendingEntries = 0;
	let ordinaryFailures = 0;
	let outcomeUnknown = false;
	let incompleteResult: WorkspaceDeleteResult | undefined;
	for (const authorization of authorizations) {
		const result = getPlainWorkspaceDeleteState(authorization);
		if (result.status === "pending" || result.status === "inFlight") {
			pendingEntries += 1;
		} else if (result.status === "deleted") {
			deletedEntries += 1;
		} else if (result.status === "ordinaryFailure") {
			ordinaryFailures += 1;
		} else if (result.status === "outcomeUnknown") {
			outcomeUnknown = true;
		} else if (result.status === "trashed") {
			outcomeUnknown = true;
		} else if (result.status === "entryRetained") {
			if (result.reason === "trashFailed") {
				outcomeUnknown = true;
			} else if (incompleteResult === undefined) {
				incompleteResult = Object.freeze({
					status: result.status,
					reason: result.reason,
				});
			}
		} else if (incompleteResult === undefined) {
			incompleteResult = result;
		}
	}
	return Object.freeze({
		deletedEntries,
		pendingEntries,
		ordinaryFailures,
		outcomeUnknown,
		...(incompleteResult === undefined ? {} : { incompleteResult }),
	});
}

function classifyTrashAuthorizationResults(
	authorizations: readonly PlainWorkspaceDeleteAuthorization[],
): Readonly<{
	trashedEntries: number;
	pendingEntries: number;
	ordinaryFailures: number;
	outcomeUnknown: boolean;
	incompleteResult?: WorkspaceTrashResult;
}> {
	let trashedEntries = 0;
	let pendingEntries = 0;
	let ordinaryFailures = 0;
	let outcomeUnknown = false;
	let incompleteResult: WorkspaceTrashResult | undefined;
	for (const authorization of authorizations) {
		const result = getPlainWorkspaceDeleteState(authorization);
		if (result.status === "pending" || result.status === "inFlight") {
			pendingEntries += 1;
		} else if (result.status === "trashed") {
			trashedEntries += 1;
		} else if (result.status === "ordinaryFailure") {
			ordinaryFailures += 1;
		} else if (result.status === "outcomeUnknown") {
			outcomeUnknown = true;
			if (incompleteResult === undefined) {
				incompleteResult = Object.freeze({ status: result.status });
			}
		} else if (result.status === "entryRetained") {
			if (result.reason === "deleteFailed") {
				outcomeUnknown = true;
			} else if (incompleteResult === undefined) {
				incompleteResult = Object.freeze({
					status: result.status,
					reason: result.reason,
				});
			}
		} else {
			outcomeUnknown = true;
		}
	}
	return Object.freeze({
		trashedEntries,
		pendingEntries,
		ordinaryFailures,
		outcomeUnknown,
		...(incompleteResult === undefined ? {} : { incompleteResult }),
	});
}

async function runDelete(
	bridge: PlainBridge,
	provider: PlainWorkspaceDeleteProvider,
	getNotificationService: () => Promise<PlainDeleteErrorNotificationService>,
	context: PlainWorkspaceDeleteCoordinatorContext,
): Promise<void> {
	if (context.useTrash !== false) {
		throw new Error(
			"The permanent delete coordinator requires permanent intent.",
		);
	}
	const selection = snapshotSelection(context, provider);
	const requests = Object.freeze(
		selection.map(({ resource }) =>
			Object.freeze({
				rootId: resource.rootId,
				relativePath: resource.relativePath,
				recursive: true,
			}),
		),
	);
	const plan = await bridge.workspacePrepareDelete(requests);
	let beginAttempted = false;
	let completed = false;
	let authorizations: readonly PlainWorkspaceDeleteAuthorization[] = [];

	try {
		const descendantEntries = plan.entries.reduce(
			(total, entry) => total + entry.descendantEntries,
			0,
		);
		const dirtyWorkingCopies = new Set<unknown>();
		let readonlyEntries = 0;
		for (const { resource } of selection) {
			for (const dirty of context.workingCopyFileService.getDirty(
				resource.resource,
			)) {
				dirtyWorkingCopies.add(dirty);
			}
			if (context.filesConfigurationService.isReadonly(resource.resource)) {
				readonlyEntries += 1;
			}
		}
		const response = await context.dialogService.confirm(
			Object.freeze({
				type: "warning" as const,
				message:
					selection.length === 1
						? `永久删除“${selection[0]!.name}”？`
						: `永久删除所选 ${selection.length} 项？`,
				detail: confirmationDetail(
					selection,
					descendantEntries,
					dirtyWorkingCopies.size,
					readonlyEntries,
				),
				primaryButton: "永久删除",
			}),
		);
		const confirmed = response.confirmed;
		if (confirmed !== true) {
			return;
		}

		beginAttempted = true;
		await bridge.workspaceBeginDelete(plan.confirmationId);
		const authorized = createAuthorizedEdits(selection, plan);
		authorizations = authorized.authorizations;
		await context.explorerService.applyBulkEdit(
			authorized.edits,
			Object.freeze({
				undoLabel: "永久删除",
				progressLabel:
					selection.length === 1
						? "正在永久删除 1 项"
						: `正在永久删除 ${selection.length} 项`,
			}),
		);
		const results = classifyAuthorizationResults(authorizations);
		if (
			results.incompleteResult !== undefined ||
			results.outcomeUnknown ||
			results.ordinaryFailures !== 0 ||
			results.pendingEntries !== 0 ||
			results.deletedEntries !== selection.length
		) {
			throw new WorkspaceDeleteIncompleteError(
				results.deletedEntries,
				results.incompleteResult,
			);
		}
		completed = true;
	} catch (error) {
		if (beginAttempted) {
			provider.plainRefreshDeleteRoots(
				selection.map(({ resource }) => resource.resource),
			);
		}
		const results = classifyAuthorizationResults(authorizations);
		let brandedError: WorkspaceDeleteIncompleteError | undefined;
		if (error instanceof WorkspaceDeleteIncompleteError) {
			brandedError = error;
		} else if (
			results.incompleteResult !== undefined ||
			results.outcomeUnknown ||
			results.deletedEntries > 0
		) {
			brandedError = new WorkspaceDeleteIncompleteError(
				results.deletedEntries,
				results.incompleteResult,
			);
		}
		if (brandedError !== undefined) {
			try {
				const notificationService = await getNotificationService();
				notificationService.error(brandedError.message);
				return;
			} catch {
				throw brandedError;
			}
		}
		throw error;
	} finally {
		if (!completed) {
			try {
				await bridge.workspaceCancelDelete(plan.confirmationId);
			} catch {}
		}
	}
}

async function runTrash(
	bridge: PlainBridge,
	provider: PlainWorkspaceDeleteProvider,
	getNotificationService: () => Promise<PlainDeleteErrorNotificationService>,
	context: PlainWorkspaceDeleteCoordinatorContext,
): Promise<void> {
	if (context.useTrash !== true) {
		throw new Error("The system Trash coordinator requires Trash intent.");
	}
	const selection = snapshotSelection(context, provider);
	const requests = Object.freeze(
		selection.map(({ resource }) =>
			Object.freeze({
				rootId: resource.rootId,
				relativePath: resource.relativePath,
			}),
		),
	);
	const plan = await bridge.workspacePrepareTrash(requests);
	let beginAttempted = false;
	let completed = false;
	let authorizations: readonly PlainWorkspaceDeleteAuthorization[] = [];

	try {
		const dirtyWorkingCopies = new Set<unknown>();
		let readonlyEntries = 0;
		for (const { resource } of selection) {
			for (const dirty of context.workingCopyFileService.getDirty(
				resource.resource,
			)) {
				dirtyWorkingCopies.add(dirty);
			}
			if (context.filesConfigurationService.isReadonly(resource.resource)) {
				readonlyEntries += 1;
			}
		}
		const response = await context.dialogService.confirm(
			Object.freeze({
				type: "warning" as const,
				message:
					selection.length === 1
						? `将“${selection[0]!.name}”移到废纸篓？`
						: `将所选 ${selection.length} 项移到废纸篓？`,
				detail: trashConfirmationDetail(
					selection,
					dirtyWorkingCopies.size,
					readonlyEntries,
				),
				primaryButton: "移到废纸篓",
			}),
		);
		if (response.confirmed !== true) {
			return;
		}

		beginAttempted = true;
		await bridge.workspaceBeginTrash(plan.confirmationId);
		const authorized = createAuthorizedTrashEdits(selection, plan);
		authorizations = authorized.authorizations;
		await context.explorerService.applyBulkEdit(
			authorized.edits,
			Object.freeze({
				undoLabel: "移到废纸篓",
				progressLabel:
					selection.length === 1
						? "正在将 1 项移到废纸篓"
						: `正在将 ${selection.length} 项移到废纸篓`,
			}),
		);
		const results = classifyTrashAuthorizationResults(authorizations);
		if (
			results.incompleteResult !== undefined ||
			results.outcomeUnknown ||
			results.ordinaryFailures !== 0 ||
			results.pendingEntries !== 0 ||
			results.trashedEntries !== selection.length
		) {
			throw new WorkspaceTrashIncompleteError(
				results.trashedEntries,
				results.incompleteResult,
			);
		}
		completed = true;
	} catch (error) {
		if (beginAttempted) {
			provider.plainRefreshDeleteRoots(
				selection.map(({ resource }) => resource.resource),
			);
		}
		const results = classifyTrashAuthorizationResults(authorizations);
		const coordinatorFailureResult = trashCoordinatorFailureResult(error);
		let brandedError: WorkspaceTrashIncompleteError | undefined;
		if (error instanceof WorkspaceTrashIncompleteError) {
			brandedError = error;
		} else if (coordinatorFailureResult !== undefined) {
			brandedError = new WorkspaceTrashIncompleteError(
				results.trashedEntries,
				coordinatorFailureResult,
			);
		} else if (
			results.incompleteResult !== undefined ||
			results.outcomeUnknown ||
			results.trashedEntries > 0
		) {
			brandedError = new WorkspaceTrashIncompleteError(
				results.trashedEntries,
				results.incompleteResult,
			);
		}
		if (brandedError !== undefined) {
			try {
				const notificationService = await getNotificationService();
				notificationService.error(brandedError.message);
				return;
			} catch {
				throw brandedError;
			}
		}
		throw error;
	} finally {
		if (!completed) {
			try {
				await bridge.workspaceCancelTrash(plan.confirmationId);
			} catch {}
		}
	}
}

export function registerWorkspaceDeleteCoordinator(
	bridge: PlainBridge,
	provider: PlainWorkspaceDeleteProvider,
	getNotificationService: () => Promise<PlainDeleteErrorNotificationService>,
): IDisposable {
	return registerPlainWorkspaceDeleteCoordinator((context) =>
		context.useTrash
			? runTrash(bridge, provider, getNotificationService, context)
			: runDelete(bridge, provider, getNotificationService, context),
	);
}
