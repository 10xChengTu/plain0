import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type {
	IFolderBackupInfo,
	IWorkspaceBackupInfo,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/backup/common/backup";
import type { IWorkspaceIdentifier } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace";
import type {
	IRecent,
	IRecentlyOpened,
	IWorkspaceFolderCreationData,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces";
import type { IWorkspacesService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspaces/common/workspaces.service";
import type { IWorkspaceEditingService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workspaces/common/workspaceEditing.service";

export const PLAIN_WORKSPACE_OPERATION_UNSUPPORTED =
	"PLAIN_WORKSPACE_OPERATION_UNSUPPORTED" as const;

const PLAIN_WORKSPACE_OPERATION_UNSUPPORTED_MESSAGE =
	"Plain does not expose generic workspace operations.";

/**
 * Stable, path-free failure for upstream workspace operations that would
 * otherwise write a .code-workspace file, open a picker, or switch windows.
 */
export class PlainWorkspaceOperationUnsupportedError extends Error {
	readonly code = PLAIN_WORKSPACE_OPERATION_UNSUPPORTED;

	constructor() {
		super(PLAIN_WORKSPACE_OPERATION_UNSUPPORTED_MESSAGE);
		this.name = "PlainWorkspaceOperationUnsupportedError";
		Object.freeze(this);
	}
}

function rejectGenericWorkspaceOperation(): Promise<never> {
	return Promise.reject(new PlainWorkspaceOperationUnsupportedError());
}

/**
 * Plain mutates its Rust-owned workspace scope through its narrow bridge.
 * Generic Workbench editing must fail before it can reach dialogs, host
 * navigation, filesystem writes, profiles, trust, or untitled workspaces.
 */
export class PlainWorkspaceEditingService implements IWorkspaceEditingService {
	readonly _serviceBrand = undefined;
	readonly onDidEnterWorkspace: IWorkspaceEditingService["onDidEnterWorkspace"] =
		Event.None;

	constructor() {
		Object.freeze(this);
	}

	addFolders(
		_folders: IWorkspaceFolderCreationData[],
		_donotNotifyError?: boolean,
	): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	removeFolders(_folders: URI[], _donotNotifyError?: boolean): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	updateFolders(
		_index: number,
		_deleteCount?: number,
		_foldersToAdd?: IWorkspaceFolderCreationData[],
		_donotNotifyError?: boolean,
	): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	enterWorkspace(_path: URI): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	createAndEnterWorkspace(
		_folders: IWorkspaceFolderCreationData[],
		_path?: URI,
	): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	saveAndEnterWorkspace(_path: URI): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	copyWorkspaceSettings(_toWorkspace: IWorkspaceIdentifier): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	pickNewWorkspacePath(): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}
}

/**
 * Plain owns workspace persistence and window lifecycle in Rust. Workbench
 * recent history stays inert, while every generic workspace lifecycle method
 * fails before creating or deleting an untitled workspace.
 */
export class PlainWorkspacesService implements IWorkspacesService {
	readonly _serviceBrand = undefined;
	readonly onDidChangeRecentlyOpened: IWorkspacesService["onDidChangeRecentlyOpened"] =
		Event.None;

	constructor() {
		Object.freeze(this);
	}

	enterWorkspace(_workspaceUri: URI): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	createUntitledWorkspace(
		_folders?: IWorkspaceFolderCreationData[],
		_remoteAuthority?: string,
	): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	deleteUntitledWorkspace(_workspace: IWorkspaceIdentifier): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	getWorkspaceIdentifier(_workspaceUri: URI): Promise<never> {
		return rejectGenericWorkspaceOperation();
	}

	addRecentlyOpened(_recents: IRecent[]): Promise<void> {
		return Promise.resolve();
	}

	removeRecentlyOpened(_workspaces: URI[]): Promise<void> {
		return Promise.resolve();
	}

	clearRecentlyOpened(): Promise<void> {
		return Promise.resolve();
	}

	getRecentlyOpened(): Promise<IRecentlyOpened> {
		return Promise.resolve({ workspaces: [], files: [] });
	}

	getDirtyWorkspaces(): Promise<
		Array<IWorkspaceBackupInfo | IFolderBackupInfo>
	> {
		return Promise.resolve([]);
	}
}

Object.freeze(PlainWorkspaceEditingService.prototype);
Object.freeze(PlainWorkspacesService.prototype);
