import {
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
import { Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import {
	Disposable,
	type IDisposable,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import type {
	PlainBridge,
	WorkspaceEntryKind,
	WorkspaceEntryStat,
} from "../../platform/tauri";
import { frozenWorkspaceEntryRequest } from "../../platform/tauri/workspace-codec";

export const PLAIN_WORKSPACE_SCHEME = "plain-workspace" as const;

interface ResolvedResource {
	readonly rootId: string;
	readonly relativePath: string;
}

export interface PlainWorkspaceProviderStat extends IStat {
	readonly plainVersion: string | null;
}

export interface PlainWorkspaceReadFileResult {
	readonly stat: PlainWorkspaceProviderStat;
	readonly value: Uint8Array;
}

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

/**
 * Read-only Workbench provider for capability-authorized Plain workspace roots.
 *
 * PathCaseSensitive is intentionally omitted: one provider can represent roots
 * from case-sensitive and case-insensitive volumes at the same time, while the
 * Workbench capability is provider-wide rather than root-specific.
 */
export class PlainWorkspaceFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities: Event<void> = Event.None;
	readonly onDidChangeFile: Event<readonly IFileChange[]> = Event.None;

	constructor(private readonly bridge: PlainBridge) {}

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
): PlainWorkspaceFileSystemProvider {
	return new PlainWorkspaceFileSystemProvider(bridge);
}
