import {
	FileChangeType,
	FileOperationError,
	FileOperationResult,
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderError,
	FileSystemProviderErrorCode,
	FileType,
	type IFileChange,
	type IFileDeleteOptions,
	type IFileOverwriteOptions,
	type IFileSystemProviderWithFileReadWriteCapability,
	type IFileWriteOptions,
	type IStat,
	type IWatchOptions,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files";
import {
	Emitter,
	Event,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	beginPlainWorkspaceDeleteProviderDispatch,
	completePlainWorkspaceDeleteProviderFailure,
	completePlainWorkspaceDeleteProviderResult,
	getPlainWorkspaceDeleteAuthorizationSnapshot,
	takePlainWorkspaceDeleteProviderAuthorization,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/files/common/plainWorkspaceDelete";

import type {
	PlainBridge,
	WorkspaceCapabilities,
	WorkspaceDeleteResult,
	WorkspaceEntryKind,
	WorkspaceEntryStat,
	WorkspaceTrashResult,
	WorkspaceWriteResult,
} from "../../platform/tauri";
import {
	decodeWorkspaceEntryStat,
	decodeWorkspaceCapabilities,
	decodeWorkspaceDeleteResult,
	decodeWorkspaceMoveResult,
	decodeWorkspaceTrashResult,
	frozenWorkspaceEntryRequest,
} from "../../platform/tauri/workspace-codec";

export const PLAIN_WORKSPACE_SCHEME = "plain-workspace" as const;

interface ResolvedResource {
	readonly rootId: string;
	readonly relativePath: string;
}

interface ResolvedMutationResource extends ResolvedResource {
	readonly resource: URI;
}

export interface PlainWorkspaceDeleteResource {
	readonly rootId: string;
	readonly relativePath: string;
	readonly resource: URI;
}

export interface PlainWorkspaceDeleteProvider {
	plainSnapshotDeleteResource(resource: URI): PlainWorkspaceDeleteResource;
	plainRefreshDeleteRoots(resources: readonly URI[]): void;
}

export interface PlainWorkspaceProviderStat extends IStat {
	readonly plainVersion: string | null;
}

export interface PlainWorkspaceReadFileResult {
	readonly stat: PlainWorkspaceProviderStat;
	readonly value: Uint8Array;
}

export type PlainWorkspaceWriteFileResult =
	| Readonly<{
			status: "written";
			stat: PlainWorkspaceProviderStat;
	  }>
	| Exclude<WorkspaceWriteResult, Readonly<{ status: "written" }>>;

const MAX_TRACKED_OPEN_RESOURCES_PER_ROOT = 256;

const SANITIZED_MESSAGES = Object.freeze({
	entryNotFound: "The workspace entry does not exist.",
	moveIncomplete:
		"The workspace move published its target but could not remove all of its source.",
	moveOutcomeUnknown:
		"The workspace move outcome is unknown. The source and target locations were refreshed; check both locations before continuing.",
	notDirectory: "The workspace entry is not a directory.",
	noPermissions: "The workspace entry cannot be accessed.",
	unavailable: "The workspace is unavailable.",
});

function fileSystemError(
	code: FileSystemProviderErrorCode,
	message: string,
): FileSystemProviderError {
	return FileSystemProviderError.create(message, code);
}

function noPermissions(): FileSystemProviderError {
	return fileSystemError(
		FileSystemProviderErrorCode.NoPermissions,
		SANITIZED_MESSAGES.noPermissions,
	);
}

function createPlainWorkspaceMutationPolicy(
	platformCapabilities: WorkspaceCapabilities,
): boolean {
	const snapshot = decodeWorkspaceCapabilities(platformCapabilities);
	return (
		snapshot.create &&
		snapshot.renameNoReplace &&
		snapshot.copyMove &&
		snapshot.delete &&
		snapshot.versionedWrite
	);
}

function unavailable(): FileSystemProviderError {
	return fileSystemError(
		FileSystemProviderErrorCode.Unavailable,
		SANITIZED_MESSAGES.unavailable,
	);
}

function commandErrorCode(error: unknown): string | undefined {
	try {
		if (typeof error !== "object" || error === null) {
			return undefined;
		}
		const code = Reflect.get(error, "code");
		return typeof code === "string" ? code : undefined;
	} catch {
		return undefined;
	}
}

function mapReadError(error: unknown): FileSystemProviderError {
	const code = commandErrorCode(error);
	switch (code) {
		case "ENTRY_NOT_FOUND":
			return fileSystemError(
				FileSystemProviderErrorCode.FileNotFound,
				SANITIZED_MESSAGES.entryNotFound,
			);
		case "ENTRY_TYPE_MISMATCH":
			return fileSystemError(
				FileSystemProviderErrorCode.FileNotADirectory,
				SANITIZED_MESSAGES.notDirectory,
			);
		case "ROOT_NOT_AUTHORIZED":
		case "INVALID_RELATIVE_PATH":
		case "PATH_OUTSIDE_ROOT":
		case "PERMISSION_DENIED":
			return noPermissions();
		case "ROOT_UNAVAILABLE":
		case "PATH_ENCODING_UNSUPPORTED":
		case "WORKSPACE_CONFLICT":
		case "WORKSPACE_FILE_CHANGED":
		case "WORKSPACE_WINDOW_CLOSED":
		case "DIRECTORY_TOO_LARGE":
		case "FILE_TOO_LARGE":
		case "IO_FAILED":
			return unavailable();
		default:
			return unavailable();
	}
}

function mapWriteError(error: unknown): Error {
	const code = commandErrorCode(error);
	switch (code) {
		case "WORKSPACE_FILE_MODIFIED":
			return new FileOperationError(
				"The workspace file changed before it could be written.",
				FileOperationResult.FILE_MODIFIED_SINCE,
			);
		case "ROOT_NOT_AUTHORIZED":
		case "PERMISSION_DENIED":
			return noPermissions();
		case "FILE_TOO_LARGE":
			return fileSystemError(
				FileSystemProviderErrorCode.FileTooLarge,
				"The workspace file exceeds the supported write limit.",
			);
		default:
			return unavailable();
	}
}

function mapCreateError(error: unknown): Readonly<{
	error: FileSystemProviderError;
	rescan: boolean;
}> {
	let code: string | undefined;
	try {
		if (typeof error === "object" && error !== null) {
			const value = Reflect.get(error, "code");
			code = typeof value === "string" ? value : undefined;
		}
	} catch {
		code = undefined;
	}
	switch (code) {
		case "ENTRY_ALREADY_EXISTS":
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace entry already exists.",
					FileSystemProviderErrorCode.FileExists,
				),
				rescan: false,
			});
		case "ENTRY_NOT_FOUND":
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace entry does not exist.",
					FileSystemProviderErrorCode.FileNotFound,
				),
				rescan: false,
			});
		case "ENTRY_TYPE_MISMATCH":
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace entry is not a directory.",
					FileSystemProviderErrorCode.FileNotADirectory,
				),
				rescan: false,
			});
		case "ROOT_NOT_AUTHORIZED":
		case "INVALID_RELATIVE_PATH":
		case "PATH_OUTSIDE_ROOT":
		case "PERMISSION_DENIED":
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace entry cannot be accessed.",
					FileSystemProviderErrorCode.NoPermissions,
				),
				rescan: false,
			});
		case "ROOT_UNAVAILABLE":
		case "PATH_ENCODING_UNSUPPORTED":
		case "WORKSPACE_CONFLICT":
		case "WORKSPACE_WINDOW_CLOSED":
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace is unavailable.",
					FileSystemProviderErrorCode.Unavailable,
				),
				rescan: false,
			});
		default:
			return Object.freeze({
				error: FileSystemProviderError.create(
					"The workspace is unavailable.",
					FileSystemProviderErrorCode.Unavailable,
				),
				rescan: true,
			});
	}
}

function requireNoOverwriteOptions(options: IFileOverwriteOptions): void {
	try {
		if (typeof options !== "object" || options === null) {
			throw noPermissions();
		}
		const prototype = Object.getPrototypeOf(options);
		if (prototype !== Object.prototype && prototype !== null) {
			throw noPermissions();
		}
		const descriptors = Object.getOwnPropertyDescriptors(options);
		const keys = Reflect.ownKeys(descriptors);
		const overwrite = descriptors.overwrite;
		if (
			keys.length !== 1 ||
			keys[0] !== "overwrite" ||
			overwrite === undefined ||
			!("value" in overwrite) ||
			overwrite.enumerable !== true ||
			overwrite.value !== false
		) {
			throw noPermissions();
		}
		structuredClone(options);
	} catch {
		throw noPermissions();
	}
}

function copyMoveCommandErrorCode(error: unknown): string | undefined {
	try {
		if (typeof error !== "object" || error === null) {
			return undefined;
		}
		const prototype = Object.getPrototypeOf(error);
		if (prototype !== Object.prototype && prototype !== null) {
			return undefined;
		}
		const descriptors = Object.getOwnPropertyDescriptors(error);
		const keys = Reflect.ownKeys(descriptors);
		const code = descriptors.code;
		const message = descriptors.message;
		if (
			keys.length !== 2 ||
			!keys.includes("code") ||
			!keys.includes("message") ||
			code === undefined ||
			message === undefined ||
			!("value" in code) ||
			!("value" in message) ||
			code.enumerable !== true ||
			message.enumerable !== true ||
			typeof code.value !== "string" ||
			typeof message.value !== "string" ||
			message.value.length < 1 ||
			message.value.length > 512
		) {
			return undefined;
		}
		structuredClone(error);
		return code.value;
	} catch {
		return undefined;
	}
}

function mapCopyMoveError(error: unknown): Readonly<{
	error: FileSystemProviderError;
	rescan: boolean;
}> {
	const code = copyMoveCommandErrorCode(error);
	switch (code) {
		case "ENTRY_ALREADY_EXISTS":
			return Object.freeze({
				error: fileSystemError(
					FileSystemProviderErrorCode.FileExists,
					"The workspace entry already exists.",
				),
				rescan: false,
			});
		case "ENTRY_NOT_FOUND":
			return Object.freeze({
				error: fileSystemError(
					FileSystemProviderErrorCode.FileNotFound,
					SANITIZED_MESSAGES.entryNotFound,
				),
				rescan: false,
			});
		case "ENTRY_TYPE_MISMATCH":
			return Object.freeze({
				error: fileSystemError(
					FileSystemProviderErrorCode.FileNotADirectory,
					SANITIZED_MESSAGES.notDirectory,
				),
				rescan: false,
			});
		case "ROOT_NOT_AUTHORIZED":
		case "INVALID_RELATIVE_PATH":
		case "PATH_OUTSIDE_ROOT":
		case "PERMISSION_DENIED":
			return Object.freeze({ error: noPermissions(), rescan: false });
		case "ROOT_UNAVAILABLE":
		case "PATH_ENCODING_UNSUPPORTED":
		case "WORKSPACE_CONFLICT":
		case "WORKSPACE_WINDOW_CLOSED":
			return Object.freeze({ error: unavailable(), rescan: false });
		case "DIRECTORY_TOO_LARGE":
		case "FILE_TOO_LARGE":
			return Object.freeze({
				error: fileSystemError(
					FileSystemProviderErrorCode.FileTooLarge,
					"The workspace entry exceeds the supported copy limits.",
				),
				rescan: false,
			});
		default:
			return Object.freeze({ error: unavailable(), rescan: true });
	}
}

function mapDeleteError(error: unknown): Readonly<{
	error: FileSystemProviderError;
	rescan: boolean;
	outcome: "ordinaryFailure" | "outcomeUnknown";
}> {
	const code = copyMoveCommandErrorCode(error);
	switch (code) {
		case "ROOT_NOT_AUTHORIZED":
			return Object.freeze({
				error: noPermissions(),
				rescan: false,
				outcome: "ordinaryFailure",
			});
		case "WORKSPACE_DELETE_PLAN_INVALID":
		case "WORKSPACE_TRASH_PLAN_INVALID":
		case "WORKSPACE_TRASH_UNAVAILABLE":
		case "ROOT_UNAVAILABLE":
		case "WORKSPACE_WINDOW_CLOSED":
		case "ENTRY_TYPE_MISMATCH":
		case "INVALID_RELATIVE_PATH":
		case "WORKSPACE_CONFLICT":
			return Object.freeze({
				error: unavailable(),
				rescan: false,
				outcome: "ordinaryFailure",
			});
		default:
			return Object.freeze({
				error: unavailable(),
				rescan: true,
				outcome: "outcomeUnknown",
			});
	}
}

function requireVoidMutationReceipt(value: unknown): void {
	if (value !== undefined) {
		throw unavailable();
	}
}

class WorkspaceMoveIncompleteError extends FileOperationError {
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
}

class WorkspaceMoveOutcomeUnknownError extends FileOperationError {
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
}

function kindToFileType(kind: WorkspaceEntryKind): FileType {
	switch (kind) {
		case "file":
			return FileType.File;
		case "directory":
			return FileType.Directory;
		case "symlink":
			return FileType.SymbolicLink;
		case "symlinkFile":
			return FileType.SymbolicLink | FileType.File;
		case "symlinkDirectory":
			return FileType.SymbolicLink | FileType.Directory;
		case "other":
			return FileType.Unknown;
	}
}

function providerStat(stat: WorkspaceEntryStat): PlainWorkspaceProviderStat {
	const readonlyFile =
		(stat.kind === "file" || stat.kind === "symlinkFile") &&
		stat.version === null;
	return Object.freeze({
		type: kindToFileType(stat.kind),
		size: stat.size,
		mtime: stat.mtime,
		ctime: stat.ctime,
		...(readonlyFile ? { permissions: FilePermission.Readonly } : {}),
		plainVersion: stat.version,
	});
}

function createdProviderStat(
	value: unknown,
	expectedKind: "file" | "directory",
): PlainWorkspaceProviderStat {
	const stat = decodeWorkspaceEntryStat(value);
	if (
		stat.kind !== expectedKind ||
		stat.size !== 0 ||
		stat.mtime !== 0 ||
		stat.ctime !== 0 ||
		stat.version !== null
	) {
		throw unavailable();
	}
	return Object.freeze({
		type: expectedKind === "file" ? FileType.File : FileType.Directory,
		size: 0,
		mtime: 0,
		ctime: 0,
		...(expectedKind === "file"
			? { permissions: FilePermission.Readonly }
			: {}),
		plainVersion: null,
	});
}

/**
 * Workbench provider for capability-authorized Plain workspace roots.
 *
 * PathCaseSensitive is intentionally omitted: one provider can represent roots
 * from case-sensitive and case-insensitive volumes at the same time, while the
 * Workbench capability is provider-wide rather than root-specific.
 */
class PlainWorkspaceFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
	readonly #bridge: PlainBridge;
	readonly #allowsMutationDispatch: boolean;
	readonly capabilities: FileSystemProviderCapabilities;
	readonly onDidChangeCapabilities: Event<void> = Event.None;
	private readonly changeEmitter = new Emitter<readonly IFileChange[]>();
	readonly onDidChangeFile: Event<readonly IFileChange[]> =
		this.changeEmitter.event;
	readonly #watchState = new Map<
		string,
		{
			paths: Map<string, URI>;
			missing: Set<string>;
			reconciling: boolean;
			dirty: boolean;
		}
	>();

	constructor(bridge: PlainBridge, allowsMutationDispatch: boolean) {
		this.#bridge = bridge;
		this.#allowsMutationDispatch = allowsMutationDispatch;
		this.capabilities =
			FileSystemProviderCapabilities.FileReadWrite |
			(allowsMutationDispatch
				? FileSystemProviderCapabilities.FileFolderCopy
				: FileSystemProviderCapabilities.Readonly);
		Object.freeze(this);
	}

	watch(resource: URI, options: IWatchOptions): IDisposable {
		void options;
		const resolved = this.resolveResource(resource);
		const unlisten = this.#bridge.workspaceWatch(resolved.rootId, () => {
			this.fireRootUpdated(resource);
			void this.reconcileWatchedPaths(resolved.rootId);
		});
		let disposed = false;
		return {
			dispose(): void {
				if (disposed) {
					return;
				}
				disposed = true;
				try {
					void Promise.resolve(unlisten()).catch(() => undefined);
				} catch {
					// Disposal is best-effort and must remain safe during window teardown.
				}
			},
		};
	}

	async stat(resource: URI): Promise<PlainWorkspaceProviderStat> {
		const resolved = this.resolveResource(resource);
		try {
			const stat = await this.#bridge.workspaceStat(
				resolved.rootId,
				resolved.relativePath,
			);
			return providerStat(stat);
		} catch (error) {
			throw mapReadError(error);
		}
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const resolved = this.resolveResource(resource);
		try {
			const result = await this.#bridge.workspaceReadDirectory(
				resolved.rootId,
				resolved.relativePath,
			);
			return result.entries.map(({ name, kind }): [string, FileType] => [
				name,
				kindToFileType(kind),
			]);
		} catch (error) {
			throw mapReadError(error);
		}
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		return (await this.plainReadFile(resource)).value.slice();
	}

	async plainReadFile(resource: URI): Promise<PlainWorkspaceReadFileResult> {
		const resolved = this.resolveResource(resource);
		try {
			const receipt = await this.#bridge.workspaceReadFile(
				resolved.rootId,
				resolved.relativePath,
			);
			if (resolved.relativePath !== "") {
				this.trackOpenResource(
					resolved.rootId,
					resolved.relativePath,
					resource,
				);
			}
			return Object.freeze({
				stat: providerStat(receipt.stat),
				value: receipt.value.copy(),
			});
		} catch (error) {
			throw mapReadError(error);
		}
	}

	async plainWriteFile(
		resource: URI,
		content: Uint8Array,
		expectedVersion: string,
	): Promise<PlainWorkspaceWriteFileResult> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveResource(resource);
		try {
			const result = await this.#bridge.workspaceWriteFile(
				resolved.rootId,
				resolved.relativePath,
				expectedVersion,
				content,
			);
			if (result.status === "written") {
				return Object.freeze({
					status: result.status,
					stat: providerStat(result.stat),
				});
			}
			this.changeEmitter.fire(
				Object.freeze([
					Object.freeze({
						type: FileChangeType.UPDATED,
						resource: resource.with({
							path: "/",
							query: null,
							fragment: null,
						}),
					}),
				]),
			);
			return result;
		} catch (error) {
			throw mapWriteError(error);
		}
	}

	async plainPublishFile(
		resource: URI,
		content: Uint8Array,
	): Promise<PlainWorkspaceWriteFileResult> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(resource);
		try {
			const result = await this.#bridge.workspacePublishFile(
				resolved.rootId,
				resolved.relativePath,
				content,
			);
			if (result.status === "written") {
				this.trackOpenResource(
					resolved.rootId,
					resolved.relativePath,
					resolved.resource,
				);
				this.fireCreated(resolved.resource);
				return Object.freeze({
					status: result.status,
					stat: providerStat(result.stat),
				});
			}
			this.fireRootUpdated(resolved.resource);
			return result;
		} catch (error) {
			const failure = mapCreateError(error);
			if (failure.rescan) this.fireRootUpdated(resolved.resource);
			throw failure.error;
		}
	}

	async plainCreateFile(resource: URI): Promise<PlainWorkspaceProviderStat> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(resource);
		try {
			const stat = createdProviderStat(
				await this.#bridge.workspaceCreateFile(
					resolved.rootId,
					resolved.relativePath,
				),
				"file",
			);
			this.fireCreated(resolved.resource);
			return stat;
		} catch (error) {
			const failure = mapCreateError(error);
			if (failure.rescan) {
				this.fireRootUpdated(resolved.resource);
			}
			throw failure.error;
		}
	}

	async plainCreateDirectory(
		resource: URI,
	): Promise<PlainWorkspaceProviderStat> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(resource);
		try {
			const stat = createdProviderStat(
				await this.#bridge.workspaceCreateDirectory(
					resolved.rootId,
					resolved.relativePath,
				),
				"directory",
			);
			this.fireCreated(resolved.resource);
			return stat;
		} catch (error) {
			const failure = mapCreateError(error);
			if (failure.rescan) {
				this.fireRootUpdated(resolved.resource);
			}
			throw failure.error;
		}
	}

	async writeFile(
		_resource: URI,
		_content: Uint8Array,
		_options: IFileWriteOptions,
	): Promise<void> {
		throw noPermissions();
	}

	async mkdir(_resource: URI): Promise<void> {
		throw noPermissions();
	}

	async delete(_resource: URI, _options: IFileDeleteOptions): Promise<void> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(_resource);
		let authorization;
		try {
			authorization = takePlainWorkspaceDeleteProviderAuthorization(
				_options,
				resolved.resource,
			);
		} catch {
			throw noPermissions();
		}
		if (authorization === undefined) {
			throw noPermissions();
		}
		const authorizationSnapshot =
			getPlainWorkspaceDeleteAuthorizationSnapshot(authorization);
		if (
			authorizationSnapshot.rootId !== resolved.rootId ||
			authorizationSnapshot.relativePath !== resolved.relativePath ||
			authorizationSnapshot.recursive !== true ||
			typeof authorizationSnapshot.permanent !== "boolean"
		) {
			throw noPermissions();
		}
		beginPlainWorkspaceDeleteProviderDispatch(authorization);

		let result: WorkspaceDeleteResult | WorkspaceTrashResult;
		try {
			result = authorizationSnapshot.permanent
				? decodeWorkspaceDeleteResult(
						await this.#bridge.workspaceCommitDeleteEntry(
							authorizationSnapshot.confirmationId,
							authorizationSnapshot.entryId,
							authorizationSnapshot.rootId,
							authorizationSnapshot.relativePath,
							authorizationSnapshot.recursive,
						),
					)
				: decodeWorkspaceTrashResult(
						await this.#bridge.workspaceCommitTrashEntry(
							authorizationSnapshot.confirmationId,
							authorizationSnapshot.entryId,
							authorizationSnapshot.rootId,
							authorizationSnapshot.relativePath,
						),
					);
		} catch (error) {
			const failure = mapDeleteError(error);
			completePlainWorkspaceDeleteProviderFailure(
				authorization,
				failure.outcome,
			);
			if (failure.rescan) {
				this.fireRootUpdated(resolved.resource);
			}
			throw failure.error;
		}
		try {
			completePlainWorkspaceDeleteProviderResult(authorization, result);
		} catch {
			completePlainWorkspaceDeleteProviderFailure(
				authorization,
				"outcomeUnknown",
			);
			this.fireRootUpdated(resolved.resource);
			throw unavailable();
		}
		const succeeded = authorizationSnapshot.permanent
			? result.status === "deleted"
			: result.status === "trashed";
		if (!succeeded) {
			this.fireRootUpdated(resolved.resource);
			throw unavailable();
		}
		this.fireDeleted(resolved.resource);
	}

	plainSnapshotDeleteResource(resource: URI): PlainWorkspaceDeleteResource {
		this.requireMutationDispatchAllowed();
		return this.resolveMutationResource(resource);
	}

	plainRefreshDeleteRoots(resources: readonly URI[]): void {
		this.requireMutationDispatchAllowed();
		const roots = new Map<string, URI>();
		for (const resource of resources) {
			const resolved = this.resolveMutationResource(resource);
			if (!roots.has(resolved.rootId)) {
				roots.set(
					resolved.rootId,
					resolved.resource.with({
						path: "/",
						query: null,
						fragment: null,
					}),
				);
			}
		}
		const changes = [...roots.values()].map((resource) => {
			resource.toString();
			void resource.fsPath;
			Object.freeze(resource);
			return Object.freeze({ type: FileChangeType.UPDATED, resource });
		});
		if (changes.length > 0) {
			this.changeEmitter.fire(Object.freeze(changes));
		}
	}

	async copy(
		from: URI,
		to: URI,
		options: IFileOverwriteOptions,
	): Promise<void> {
		this.requireMutationDispatchAllowed();
		requireNoOverwriteOptions(options);
		const source = this.resolveMutationResource(from);
		const target = this.resolveMutationResource(to);
		if (
			source.rootId === target.rootId &&
			source.relativePath === target.relativePath
		) {
			throw fileSystemError(
				FileSystemProviderErrorCode.FileExists,
				"The workspace entry already exists.",
			);
		}
		try {
			const receipt = (await this.#bridge.workspaceCopy(
				source.rootId,
				source.relativePath,
				target.rootId,
				target.relativePath,
			)) as unknown;
			requireVoidMutationReceipt(receipt);
		} catch (error) {
			const failure = mapCopyMoveError(error);
			if (failure.rescan) {
				this.fireRootUpdated(target.resource);
			}
			throw failure.error;
		}
		this.fireCreated(target.resource);
	}

	async rename(
		from: URI,
		to: URI,
		options: IFileOverwriteOptions,
	): Promise<void> {
		this.requireMutationDispatchAllowed();
		requireNoOverwriteOptions(options);
		const source = this.resolveMutationResource(from);
		const target = this.resolveMutationResource(to);
		if (
			source.rootId === target.rootId &&
			source.relativePath === target.relativePath
		) {
			throw fileSystemError(
				FileSystemProviderErrorCode.FileExists,
				"The workspace entry already exists.",
			);
		}

		if (source.rootId === target.rootId) {
			try {
				const receipt = (await this.#bridge.workspaceRename(
					source.rootId,
					source.relativePath,
					target.relativePath,
				)) as unknown;
				requireVoidMutationReceipt(receipt);
			} catch (error) {
				const failure = mapCopyMoveError(error);
				if (failure.rescan) {
					this.fireRootUpdated(source.resource);
				}
				throw failure.error;
			}
			this.fireMoved(source.resource, target.resource);
			return;
		}

		let result;
		try {
			result = decodeWorkspaceMoveResult(
				await this.#bridge.workspaceMove(
					source.rootId,
					source.relativePath,
					target.rootId,
					target.relativePath,
				),
			);
		} catch (error) {
			const failure = mapCopyMoveError(error);
			if (failure.rescan) {
				this.fireRootsUpdated(source.resource, target.resource);
				throw workspaceMoveOutcomeUnknown();
			}
			throw failure.error;
		}
		if (result.status !== "moved") {
			this.fireRootsUpdated(source.resource, target.resource);
			throw workspaceMoveIncomplete();
		}
		this.fireMoved(source.resource, target.resource);
	}

	private requireMutationDispatchAllowed(): void {
		if (!this.#allowsMutationDispatch) {
			throw noPermissions();
		}
	}

	private fireCreated(resource: URI): void {
		this.changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.ADDED,
					resource,
				}),
			]),
		);
	}

	private fireDeleted(resource: URI): void {
		this.changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.DELETED,
					resource,
				}),
			]),
		);
	}

	private fireMoved(source: URI, target: URI): void {
		this.changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.DELETED,
					resource: source,
				}),
				Object.freeze({
					type: FileChangeType.ADDED,
					resource: target,
				}),
			]),
		);
	}

	private fireRootUpdated(resource: URI): void {
		const root = resource.with({ path: "/", query: null, fragment: null });
		root.toString();
		void root.fsPath;
		Object.freeze(root);
		this.changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.UPDATED,
					resource: root,
				}),
			]),
		);
	}

	private fireRootsUpdated(source: URI, target: URI): void {
		const sourceRoot = source.with({ path: "/", query: null, fragment: null });
		const targetRoot = target.with({ path: "/", query: null, fragment: null });
		sourceRoot.toString();
		void sourceRoot.fsPath;
		targetRoot.toString();
		void targetRoot.fsPath;
		Object.freeze(sourceRoot);
		Object.freeze(targetRoot);
		this.changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.UPDATED,
					resource: sourceRoot,
				}),
				Object.freeze({
					type: FileChangeType.UPDATED,
					resource: targetRoot,
				}),
			]),
		);
	}

	private async reconcileWatchedPaths(rootId: string): Promise<void> {
		const state = this.#watchState.get(rootId);
		if (state === undefined) {
			return;
		}
		if (state.reconciling) {
			state.dirty = true;
			return;
		}
		state.reconciling = true;
		state.dirty = false;
		try {
			for (const relativePath of state.paths.keys()) {
				if (this.#watchState.get(rootId) !== state) {
					return;
				}
				let missing: boolean;
				try {
					await this.#bridge.workspaceStat(rootId, relativePath);
					missing = false;
				} catch (error) {
					const code = commandErrorCode(error);
					if (code !== "ENTRY_NOT_FOUND" && code !== "ENTRY_TYPE_MISMATCH") {
						continue;
					}
					missing = true;
				}
				if (this.#watchState.get(rootId) !== state) {
					return;
				}
				const current = state.paths.get(relativePath);
				if (current === undefined) {
					continue;
				}
				if (missing && !state.missing.has(relativePath)) {
					state.missing.add(relativePath);
					this.fireDeleted(current);
				} else if (!missing && state.missing.has(relativePath)) {
					state.missing.delete(relativePath);
					this.fireCreated(current);
				}
			}
		} finally {
			state.reconciling = false;
			if (state.dirty && this.#watchState.get(rootId) === state) {
				state.dirty = false;
				void this.reconcileWatchedPaths(rootId);
			}
		}
	}

	private trackOpenResource(
		rootId: string,
		relativePath: string,
		resource: URI,
	): void {
		let state = this.#watchState.get(rootId);
		if (state === undefined) {
			state = {
				paths: new Map<string, URI>(),
				missing: new Set<string>(),
				reconciling: false,
				dirty: false,
			};
			this.#watchState.set(rootId, state);
		}
		state.paths.delete(relativePath);
		resource.toString();
		void resource.fsPath;
		Object.freeze(resource);
		state.paths.set(relativePath, resource);
		while (state.paths.size > MAX_TRACKED_OPEN_RESOURCES_PER_ROOT) {
			const oldest = state.paths.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			state.paths.delete(oldest);
			state.missing.delete(oldest);
		}
	}

	private resolveMutationResource(resource: URI): ResolvedMutationResource {
		try {
			const scheme = resource.scheme;
			const authority = resource.authority;
			const path = resource.path;
			const query = resource.query;
			const fragment = resource.fragment;
			if (
				typeof scheme !== "string" ||
				typeof authority !== "string" ||
				typeof path !== "string" ||
				typeof query !== "string" ||
				typeof fragment !== "string" ||
				scheme !== PLAIN_WORKSPACE_SCHEME ||
				query !== "" ||
				fragment !== "" ||
				path.length <= 1 ||
				!path.startsWith("/")
			) {
				throw noPermissions();
			}

			const relativePath = path === "/" ? "" : path.slice(1);
			const request = frozenWorkspaceEntryRequest(authority, relativePath);
			const eventResource = URI.from(
				{ scheme, authority, path, query, fragment },
				true,
			);
			eventResource.toString();
			void eventResource.fsPath;
			Object.freeze(eventResource);
			return Object.freeze({ ...request, resource: eventResource });
		} catch {
			throw noPermissions();
		}
	}

	private resolveResource(resource: URI): ResolvedResource {
		try {
			if (
				resource.scheme !== PLAIN_WORKSPACE_SCHEME ||
				resource.query !== "" ||
				resource.fragment !== "" ||
				resource.path.length === 0 ||
				!resource.path.startsWith("/")
			) {
				throw noPermissions();
			}

			const relativePath = resource.path === "/" ? "" : resource.path.slice(1);
			return frozenWorkspaceEntryRequest(resource.authority, relativePath);
		} catch {
			throw noPermissions();
		}
	}
}

Object.freeze(PlainWorkspaceFileSystemProvider.prototype);

export function createPlainWorkspaceFileSystemProvider(
	bridge: PlainBridge,
	platformCapabilities: WorkspaceCapabilities,
): PlainWorkspaceFileSystemProvider {
	return new PlainWorkspaceFileSystemProvider(
		bridge,
		createPlainWorkspaceMutationPolicy(platformCapabilities),
	);
}
