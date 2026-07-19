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
import {
	Disposable,
	type IDisposable,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import type {
	PlainBridge,
	WorkspaceCapabilities,
	WorkspaceEntryKind,
	WorkspaceEntryStat,
	WorkspaceWriteResult,
} from "../../platform/tauri";
import {
	decodeWorkspaceEntryStat,
	decodeWorkspaceCapabilities,
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

const SANITIZED_MESSAGES = Object.freeze({
	entryNotFound: "The workspace entry does not exist.",
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
 * Read-only Workbench provider for capability-authorized Plain workspace roots.
 *
 * PathCaseSensitive is intentionally omitted: one provider can represent roots
 * from case-sensitive and case-insensitive volumes at the same time, while the
 * Workbench capability is provider-wide rather than root-specific.
 */
class PlainWorkspaceFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities: Event<void> = Event.None;
	private readonly changeEmitter = new Emitter<readonly IFileChange[]>();
	readonly onDidChangeFile: Event<readonly IFileChange[]> =
		this.changeEmitter.event;

	constructor(
		private readonly bridge: PlainBridge,
		private readonly allowsMutationDispatch: boolean,
	) {}

	watch(resource: URI, options: IWatchOptions): IDisposable {
		void options;
		this.resolveResource(resource);
		return Disposable.None;
	}

	async stat(resource: URI): Promise<PlainWorkspaceProviderStat> {
		const resolved = this.resolveResource(resource);
		try {
			const stat = await this.bridge.workspaceStat(
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
			const result = await this.bridge.workspaceReadDirectory(
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
			const receipt = await this.bridge.workspaceReadFile(
				resolved.rootId,
				resolved.relativePath,
			);
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
			const result = await this.bridge.workspaceWriteFile(
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

	async plainCreateFile(resource: URI): Promise<PlainWorkspaceProviderStat> {
		this.requireMutationDispatchAllowed();
		const resolved = this.resolveMutationResource(resource);
		try {
			const stat = createdProviderStat(
				await this.bridge.workspaceCreateFile(
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
				await this.bridge.workspaceCreateDirectory(
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
		throw noPermissions();
	}

	async rename(
		_from: URI,
		_to: URI,
		_options: IFileOverwriteOptions,
	): Promise<void> {
		throw noPermissions();
	}

	private requireMutationDispatchAllowed(): void {
		if (!this.allowsMutationDispatch) {
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

	private resolveMutationResource(resource: URI): ResolvedMutationResource {
		try {
			const scheme = resource.scheme;
			const authority = resource.authority;
			const path = resource.path;
			const query = resource.query;
			const fragment = resource.fragment;
			if (
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

export function createPlainWorkspaceFileSystemProvider(
	bridge: PlainBridge,
	platformCapabilities: WorkspaceCapabilities,
): PlainWorkspaceFileSystemProvider {
	return new PlainWorkspaceFileSystemProvider(
		bridge,
		createPlainWorkspaceMutationPolicy(platformCapabilities),
	);
}
