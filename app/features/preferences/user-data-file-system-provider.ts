import {
	Emitter,
	Event,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	FileChangeType,
	FileOperationError,
	FileOperationResult,
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

import type {
	PlainBridge,
	UserDataResource,
	UserDataResult,
} from "../../platform/tauri";

export const PLAIN_USER_DATA_SCHEME = "vscode-userdata" as const;

const USER_DIRECTORY_PATH = "/User";
const RESOURCE_PATHS = Object.freeze({
	settings: "/User/settings.json",
	keybindings: "/User/keybindings.json",
} satisfies Record<UserDataResource, string>);

interface CachedResource {
	readonly revision: number;
	readonly content: string;
	readonly bytes: Uint8Array;
}

type ResolvedResource =
	| Readonly<{ kind: "root" }>
	| Readonly<{ kind: "userDirectory" }>
	| Readonly<{ kind: "file"; resource: UserDataResource }>
	| Readonly<{ kind: "missingFile" }>;

function providerError(
	code: FileSystemProviderErrorCode,
	message: string,
): FileSystemProviderError {
	return FileSystemProviderError.create(message, code);
}

function unavailable(): FileSystemProviderError {
	return providerError(
		FileSystemProviderErrorCode.Unavailable,
		"The local user-data store is unavailable.",
	);
}

function noPermissions(): FileSystemProviderError {
	return providerError(
		FileSystemProviderErrorCode.NoPermissions,
		"This user-data resource is not available in Plain.",
	);
}

function fileNotFound(): FileSystemProviderError {
	return providerError(
		FileSystemProviderErrorCode.FileNotFound,
		"The local user-data resource does not exist.",
	);
}

function commandErrorCode(error: unknown): string | undefined {
	try {
		if (typeof error !== "object" || error === null) return undefined;
		const code = Reflect.get(error, "code");
		return typeof code === "string" ? code : undefined;
	} catch {
		return undefined;
	}
}

function mapReadError(error: unknown): Error {
	return commandErrorCode(error) === "USER_DATA_INVALID"
		? noPermissions()
		: unavailable();
}

function mapWriteError(error: unknown): Error {
	switch (commandErrorCode(error)) {
		case "USER_DATA_CONFLICT":
			return new FileOperationError(
				"The local user-data resource changed before it could be saved.",
				FileOperationResult.FILE_MODIFIED_SINCE,
			);
		case "USER_DATA_TOO_LARGE":
			return providerError(
				FileSystemProviderErrorCode.FileTooLarge,
				"The local user-data resource is too large.",
			);
		case "USER_DATA_INVALID":
			return providerError(
				FileSystemProviderErrorCode.Unknown,
				"The settings or keybindings JSONC is invalid.",
			);
		default:
			return unavailable();
	}
}

function resolveResource(resource: URI): ResolvedResource {
	try {
		if (!(resource instanceof URI)) throw noPermissions();
		const descriptors = Object.getOwnPropertyDescriptors(resource);
		const read = (
			key: "scheme" | "authority" | "path" | "query" | "fragment",
		) => {
			const descriptor = descriptors[key];
			if (
				descriptor === undefined ||
				!("value" in descriptor) ||
				descriptor.get !== undefined ||
				descriptor.set !== undefined ||
				typeof descriptor.value !== "string"
			) {
				throw noPermissions();
			}
			return descriptor.value;
		};
		const scheme = read("scheme");
		const authority = read("authority");
		const path = read("path");
		const query = read("query");
		const fragment = read("fragment");
		structuredClone(resource);
		if (
			scheme !== PLAIN_USER_DATA_SCHEME ||
			authority !== "" ||
			query !== "" ||
			fragment !== ""
		) {
			throw noPermissions();
		}
		if (path === "/") return Object.freeze({ kind: "root" });
		if (path === USER_DIRECTORY_PATH) {
			return Object.freeze({ kind: "userDirectory" });
		}
		for (const [name, candidate] of Object.entries(RESOURCE_PATHS) as [
			UserDataResource,
			string,
		][]) {
			if (path === candidate) {
				return Object.freeze({ kind: "file", resource: name });
			}
		}
		// Several retained Workbench services probe conventional top-level JSON
		// resources even though Plain does not expose those features. Report a
		// syntactically ordinary `/User/<name>.json` probe as absent so the
		// caller follows its normal optional-file path; readdir still lists only
		// the two audited resources, and every write remains denied.
		if (/^\/User\/[A-Za-z0-9._-]+\.json$/u.test(path)) {
			return Object.freeze({ kind: "missingFile" });
		}
		throw noPermissions();
	} catch (error) {
		if (error instanceof FileSystemProviderError) throw error;
		throw noPermissions();
	}
}

function directoryStat(): IStat {
	return Object.freeze({
		type: FileType.Directory,
		ctime: 1,
		mtime: 1,
		size: 0,
	});
}

function fileStat(entry: CachedResource): IStat {
	return Object.freeze({
		type: FileType.File,
		ctime: 1,
		mtime: entry.revision,
		size: entry.bytes.byteLength,
	});
}

export function userDataUri(resource: UserDataResource): URI {
	return URI.from({
		scheme: PLAIN_USER_DATA_SCHEME,
		path: RESOURCE_PATHS[resource],
	});
}

export class PlainUserDataFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite;
	readonly onDidChangeCapabilities: Event<void> = Event.None;
	readonly #changeEmitter = new Emitter<readonly IFileChange[]>();
	readonly onDidChangeFile = this.#changeEmitter.event;
	readonly #cache = new Map<UserDataResource, CachedResource>();
	readonly #bridge: PlainBridge;

	constructor(bridge: PlainBridge) {
		this.#bridge = bridge;
		void bridge
			.onUserDataChanged((event) => {
				const cached = this.#cache.get(event.resource);
				if (cached !== undefined && cached.revision >= event.revision) return;
				this.#cache.delete(event.resource);
				this.fireUpdated(event.resource);
			})
			.catch(() => undefined);
	}

	watch(_resource: URI, _options: IWatchOptions): IDisposable {
		return Object.freeze({ dispose() {} });
	}

	async stat(resource: URI): Promise<IStat> {
		const resolved = resolveResource(resource);
		if (resolved.kind === "missingFile") throw fileNotFound();
		return resolved.kind === "file"
			? fileStat(await this.load(resolved.resource))
			: directoryStat();
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const resolved = resolveResource(resource);
		if (resolved.kind === "root") return [["User", FileType.Directory]];
		if (resolved.kind === "userDirectory") {
			return [
				["settings.json", FileType.File],
				["keybindings.json", FileType.File],
			];
		}
		throw providerError(
			FileSystemProviderErrorCode.FileNotADirectory,
			"The user-data resource is not a directory.",
		);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const resolved = resolveResource(resource);
		if (resolved.kind === "missingFile") throw fileNotFound();
		if (resolved.kind !== "file") {
			throw providerError(
				FileSystemProviderErrorCode.FileIsADirectory,
				"The user-data resource is a directory.",
			);
		}
		return (await this.load(resolved.resource)).bytes.slice();
	}

	async writeFile(
		resource: URI,
		content: Uint8Array,
		_options: IFileWriteOptions,
	): Promise<void> {
		const resolved = resolveResource(resource);
		if (resolved.kind !== "file") throw noPermissions();
		let baseline: CachedResource;
		try {
			baseline = await this.load(resolved.resource);
		} catch (error) {
			throw mapReadError(error);
		}
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(content);
		} catch {
			throw providerError(
				FileSystemProviderErrorCode.Unknown,
				"The settings or keybindings file must be UTF-8.",
			);
		}
		try {
			const result = await this.#bridge.userDataWrite(
				resolved.resource,
				baseline.revision,
				text,
			);
			this.#cache.set(resolved.resource, this.cacheResult(result));
			this.fireUpdated(resolved.resource);
		} catch (error) {
			if (commandErrorCode(error) === "USER_DATA_CONFLICT") {
				this.#cache.delete(resolved.resource);
			}
			throw mapWriteError(error);
		}
	}

	async mkdir(resource: URI): Promise<void> {
		const resolved = resolveResource(resource);
		if (resolved.kind !== "root" && resolved.kind !== "userDirectory") {
			throw noPermissions();
		}
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

	private async load(resource: UserDataResource): Promise<CachedResource> {
		const cached = this.#cache.get(resource);
		if (cached !== undefined) return cached;
		try {
			const result = await this.#bridge.userDataRead(resource);
			const entry = this.cacheResult(result);
			this.#cache.set(resource, entry);
			return entry;
		} catch (error) {
			throw mapReadError(error);
		}
	}

	private cacheResult(result: UserDataResult): CachedResource {
		return Object.freeze({
			revision: result.revision,
			content: result.content,
			bytes: new TextEncoder().encode(result.content),
		});
	}

	private fireUpdated(resource: UserDataResource): void {
		this.#changeEmitter.fire(
			Object.freeze([
				Object.freeze({
					type: FileChangeType.UPDATED,
					resource: userDataUri(resource),
				}),
			]),
		);
	}
}

export function createPlainUserDataFileSystemProvider(
	bridge: PlainBridge,
): PlainUserDataFileSystemProvider {
	return new PlainUserDataFileSystemProvider(bridge);
}
