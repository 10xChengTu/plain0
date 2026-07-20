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
import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import type { WorkspaceSnapshot } from "../../platform/tauri";
import { decodeWorkspaceSnapshot } from "../../platform/tauri/workspace-codec";

export const PLAIN_WORKSPACE_CONFIGURATION_SCHEME =
	"plain-workspace-config" as const;
export const PLAIN_WORKSPACE_CONFIGURATION_PATH =
	"/workspace.code-workspace" as const;

const MAX_WORKSPACE_CONFIGURATION_BYTES = 512 * 1_024;
const CONTRACT_ERROR_MESSAGE =
	"The workspace configuration snapshot violates the Plain contract.";
const NO_PERMISSIONS_MESSAGE =
	"The generated workspace configuration cannot be accessed.";
const FILE_NOT_FOUND_MESSAGE =
	"The generated workspace configuration does not exist.";
const utf8Encoder = new TextEncoder();
const uint8ArraySlice = Uint8Array.prototype.slice;

interface InstalledWorkspaceConfiguration {
	readonly workspaceId: string;
	readonly revision: number;
	readonly configPath: URI;
	readonly bytes: Uint8Array;
}

interface WorkspaceConfigurationBinding {
	readonly workspaceId: string;
	readonly installed: InstalledWorkspaceConfiguration | undefined;
}

interface ResourceSnapshot {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
}

export interface PlainWorkspaceConfigurationInstallation {
	readonly workspaceId: string;
	readonly revision: number;
	readonly configPath: URI;
}

export interface PlainWorkspaceConfigurationProvider extends IFileSystemProviderWithFileReadWriteCapability {
	install(snapshot: WorkspaceSnapshot): PlainWorkspaceConfigurationInstallation;
	clear(): void;
	copy(from: URI, to: URI, options: IFileOverwriteOptions): Promise<void>;
}

class WorkspaceConfigurationContractViolation extends Error {
	readonly code = "IPC_CONTRACT_VIOLATION" as const;

	constructor() {
		super(CONTRACT_ERROR_MESSAGE);
		this.name = "WorkspaceConfigurationContractViolation";
		Object.freeze(this);
	}
}

function contractViolation(): never {
	throw new WorkspaceConfigurationContractViolation();
}

function noPermissions(): FileSystemProviderError {
	return FileSystemProviderError.create(
		NO_PERMISSIONS_MESSAGE,
		FileSystemProviderErrorCode.NoPermissions,
	);
}

function fileNotFound(): FileSystemProviderError {
	return FileSystemProviderError.create(
		FILE_NOT_FOUND_MESSAGE,
		FileSystemProviderErrorCode.FileNotFound,
	);
}

function exactDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return contractViolation();
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return contractViolation();
	}

	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		return contractViolation();
	}

	const snapshot: Record<string, unknown> = Object.create(null);
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return contractViolation();
		}
		snapshot[key] = descriptor.value;
	}
	return Object.freeze(snapshot);
}

function exactRootArray(value: unknown): readonly unknown[] {
	if (
		typeof value !== "object" ||
		value === null ||
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype
	) {
		return contractViolation();
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
	if (
		lengthDescriptor === undefined ||
		!("value" in lengthDescriptor) ||
		!Number.isSafeInteger(lengthDescriptor.value) ||
		lengthDescriptor.value < 1 ||
		lengthDescriptor.value > 256
	) {
		return contractViolation();
	}
	const length = lengthDescriptor.value as number;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const descriptorMap = descriptors as unknown as Record<
		PropertyKey,
		PropertyDescriptor
	>;
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== length + 1) {
		return contractViolation();
	}

	const entries: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = descriptorMap[String(index)];
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		) {
			return contractViolation();
		}
		entries.push(descriptor.value);
	}
	for (const key of keys) {
		if (key === "length") {
			continue;
		}
		if (
			typeof key !== "string" ||
			!/^(?:0|[1-9][0-9]*)$/u.test(key) ||
			Number(key) >= length
		) {
			return contractViolation();
		}
	}
	return Object.freeze(entries);
}

function strictWorkspaceSnapshot(value: unknown): WorkspaceSnapshot {
	try {
		const snapshot = exactDataRecord(value, [
			"workspaceId",
			"revision",
			"roots",
		]);
		const roots = exactRootArray(snapshot.roots).map((root) => {
			const rootSnapshot = exactDataRecord(root, [
				"rootId",
				"displayName",
				"uri",
			]);
			return {
				rootId: rootSnapshot.rootId,
				displayName: rootSnapshot.displayName,
				uri: rootSnapshot.uri,
			};
		});
		structuredClone(value);
		return decodeWorkspaceSnapshot({
			workspaceId: snapshot.workspaceId,
			revision: snapshot.revision,
			roots,
		});
	} catch {
		return contractViolation();
	}
}

function configurationBytes(snapshot: WorkspaceSnapshot): Uint8Array {
	const json = JSON.stringify(
		{
			folders: snapshot.roots.map((root) => ({
				uri: root.uri,
				name: root.displayName,
			})),
		},
		null,
		"\t",
	);
	const bytes = utf8Encoder.encode(json);
	if (bytes.byteLength > MAX_WORKSPACE_CONFIGURATION_BYTES) {
		return contractViolation();
	}
	return bytes;
}

function configurationUri(workspaceId: string): URI {
	const resource = URI.from(
		{
			scheme: PLAIN_WORKSPACE_CONFIGURATION_SCHEME,
			authority: workspaceId,
			path: PLAIN_WORKSPACE_CONFIGURATION_PATH,
		},
		true,
	);
	resource.toString();
	void resource.fsPath;
	Object.freeze(resource);
	return resource;
}

function resourceSnapshot(resource: URI): ResourceSnapshot {
	try {
		if (typeof resource !== "object" || resource === null) {
			throw noPermissions();
		}
		const descriptors = Object.getOwnPropertyDescriptors(resource);
		const values: Record<string, string> = Object.create(null);
		for (const key of ["scheme", "authority", "path", "query", "fragment"]) {
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
			values[key] = descriptor.value;
		}
		structuredClone(resource);
		const scheme = values.scheme!;
		const authority = values.authority!;
		const path = values.path!;
		const query = values.query!;
		const fragment = values.fragment!;
		return Object.freeze({ scheme, authority, path, query, fragment });
	} catch {
		throw noPermissions();
	}
}

class PlainWorkspaceConfigurationProviderImpl implements PlainWorkspaceConfigurationProvider {
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities: Event<void> = Event.None;
	readonly onDidChangeFile: Event<readonly IFileChange[]> = Event.None;

	#binding: WorkspaceConfigurationBinding | undefined;

	constructor() {
		Object.freeze(this);
	}

	install(
		snapshot: WorkspaceSnapshot,
	): PlainWorkspaceConfigurationInstallation {
		const decoded = strictWorkspaceSnapshot(snapshot);
		const configPath = configurationUri(decoded.workspaceId);
		const installed = Object.freeze({
			workspaceId: decoded.workspaceId,
			revision: decoded.revision,
			configPath,
			bytes: configurationBytes(decoded),
		});
		this.#binding = Object.freeze({
			workspaceId: decoded.workspaceId,
			installed,
		});
		return Object.freeze({
			workspaceId: installed.workspaceId,
			revision: installed.revision,
			configPath: installed.configPath,
		});
	}

	clear(): void {
		if (this.#binding === undefined || this.#binding.installed === undefined) {
			return;
		}
		this.#binding = Object.freeze({
			workspaceId: this.#binding.workspaceId,
			installed: undefined,
		});
	}

	watch(resource: URI, _options: IWatchOptions): IDisposable {
		const candidate = resourceSnapshot(resource);
		const schemeRoot =
			candidate.scheme === PLAIN_WORKSPACE_CONFIGURATION_SCHEME &&
			candidate.authority === "" &&
			candidate.path === "/" &&
			candidate.query === "" &&
			candidate.fragment === "";
		if (!schemeRoot) {
			this.boundFile(candidate);
		}
		return Object.freeze({ dispose(): void {} });
	}

	async stat(resource: URI): Promise<IStat> {
		const installed = this.boundFile(resourceSnapshot(resource));
		if (installed === undefined) {
			throw fileNotFound();
		}
		return Object.freeze({
			type: FileType.File,
			ctime: 0,
			mtime: 0,
			size: installed.bytes.byteLength,
			permissions: FilePermission.Readonly,
		});
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const installed = this.boundFile(resourceSnapshot(resource));
		if (installed === undefined) {
			throw fileNotFound();
		}
		return Reflect.apply(uint8ArraySlice, installed.bytes, []) as Uint8Array;
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

	async readdir(_resource: URI): Promise<[string, FileType][]> {
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

	async copy(
		_from: URI,
		_to: URI,
		_options: IFileOverwriteOptions,
	): Promise<void> {
		throw noPermissions();
	}

	private boundFile(
		candidate: ResourceSnapshot,
	): InstalledWorkspaceConfiguration | undefined {
		if (
			candidate.scheme !== PLAIN_WORKSPACE_CONFIGURATION_SCHEME ||
			candidate.path !== PLAIN_WORKSPACE_CONFIGURATION_PATH ||
			candidate.query !== "" ||
			candidate.fragment !== "" ||
			this.#binding === undefined ||
			candidate.authority !== this.#binding.workspaceId
		) {
			throw noPermissions();
		}
		return this.#binding.installed;
	}
}

Object.freeze(PlainWorkspaceConfigurationProviderImpl.prototype);

export function createPlainWorkspaceConfigurationProvider(): PlainWorkspaceConfigurationProvider {
	return new PlainWorkspaceConfigurationProviderImpl();
}
