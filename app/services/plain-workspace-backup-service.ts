import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	VSBuffer,
	bufferToStream,
	readableToBuffer,
	streamToBuffer,
	type VSBufferReadable,
	type VSBufferReadableStream,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import type { CancellationToken } from "@codingame/monaco-vscode-api/vscode/vs/base/common/cancellation";
import { isReadableStream } from "@codingame/monaco-vscode-api/vscode/vs/base/common/stream";
import type {
	IWorkingCopyBackupMeta,
	IWorkingCopyIdentifier,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopy";
import type { IResolvedWorkingCopyBackup } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup";
import type { IWorkingCopyBackupService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopyBackup.service";

import type {
	BackupEntry,
	PlainBridge,
	WorkspaceSnapshot,
} from "../platform/tauri/contracts";

/** Mirrors the Rust `MAX_BACKUP_ENTRY_BYTES` ceiling: the *whole* stored
 * payload (this service's own JSON preamble plus the raw content) must fit,
 * not just the content by itself. Exported so unit tests can compute an exact
 * boundary rather than duplicating the preamble-encoding logic. */
export const MAX_BACKUP_PAYLOAD_BYTES = 8 * 1_024 * 1_024;
const PREAMBLE_NEWLINE = 0x0a;

let configuredBridge: PlainBridge | undefined;

/**
 * Wires the Tauri/browser-mock bridge into `PlainWorkingCopyBackupService`
 * without adding a non-service constructor parameter (which the DI container
 * cannot supply automatically, and which would otherwise force a
 * `SyncDescriptor` static argument outside this file's audited closed
 * shape). Must be called exactly once, before Workbench `initialize()` ever
 * resolves `IWorkingCopyBackupService`.
 */
export function configurePlainWorkingCopyBackupBridge(
	bridge: PlainBridge,
): void {
	configuredBridge = bridge;
}

function requireBridge(): PlainBridge {
	if (configuredBridge === undefined) {
		throw new Error(
			"PlainWorkingCopyBackupService was used before configurePlainWorkingCopyBackupBridge",
		);
	}
	return configuredBridge;
}

function hexFromBytes(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

/**
 * The wire-level backup key: a stable SHA-256 hex digest of the resource
 * URI's own text. `[0-9a-f]{64}` is inherently a valid Rust `BackupKey`
 * (`[a-z0-9-]{1,128}`), so no further sanitizing is needed. Deliberately
 * ignores `typeId`: every working copy Plain currently registers
 * (`TextFileEditorModel`) uses the reserved empty `NO_TYPE_ID`, so a
 * resource-only key cannot yet collide across two different working-copy
 * kinds for the same resource. Should Plain ever register a second working
 * copy type for the same resource space, this key derivation would need to
 * incorporate `typeId` too.
 */
async function backupKeyForResource(resource: URI): Promise<string> {
	const bytes = new TextEncoder().encode(resource.toString());
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return hexFromBytes(new Uint8Array(digest));
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const owned = Uint8Array.from(bytes);
	return hexFromBytes(
		new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)),
	);
}

function workspaceResourceParts(
	resource: URI,
): Readonly<{ rootId: string; relativePath: string }> | undefined {
	if (
		resource.scheme !== "plain-workspace" ||
		resource.authority.length === 0 ||
		resource.query !== "" ||
		resource.fragment !== "" ||
		!resource.path.startsWith("/") ||
		resource.path.length < 2
	) {
		return undefined;
	}
	return Object.freeze({
		rootId: resource.authority,
		relativePath: resource.path.slice(1),
	});
}

// A plain function call, rather than repeated inline `token?.isCancellationRequested`
// property narrowing, so TypeScript does not (incorrectly) assume the token's
// cancellation state cannot change between two checks that straddle an `await`.
function isCancelled(token: CancellationToken | undefined): boolean {
	return token?.isCancellationRequested === true;
}

function backupTooLarge(): never {
	throw Object.freeze({
		code: "BACKUP_TOO_LARGE",
		message: "The backup payload exceeds the supported size limit.",
	});
}

async function contentToBytes(
	content: VSBufferReadable | VSBufferReadableStream | undefined,
): Promise<Uint8Array> {
	if (content === undefined) {
		return new Uint8Array(0);
	}
	const buffer = isReadableStream(content)
		? await streamToBuffer(content)
		: readableToBuffer(content);
	return buffer.buffer;
}

/**
 * Encodes `identifier`/`meta`/`content` into a single payload using the same
 * shape upstream's own file-backed `WorkingCopyBackupServiceImpl` uses: one
 * JSON preamble line (here holding the original resource URI text and
 * `typeId`, the only two fields needed to reconstruct the identifier),
 * followed by a newline, followed by the raw content bytes.
 */
function encodeBackupPayload(
	identifier: IWorkingCopyIdentifier,
	meta: IWorkingCopyBackupMeta | undefined,
	content: Uint8Array,
	baselineSha256: string | undefined,
): Uint8Array {
	const preamble = {
		...meta,
		...(baselineSha256 === undefined
			? {}
			: { plainBaselineSha256: baselineSha256 }),
		resource: identifier.resource.toString(),
		typeId: identifier.typeId,
	};
	const preambleBytes = new TextEncoder().encode(
		`${JSON.stringify(preamble)}\n`,
	);
	const totalBytes = preambleBytes.byteLength + content.byteLength;
	if (totalBytes > MAX_BACKUP_PAYLOAD_BYTES) {
		backupTooLarge();
	}
	const payload = new Uint8Array(totalBytes);
	payload.set(preambleBytes, 0);
	payload.set(content, preambleBytes.byteLength);
	return payload;
}

interface DecodedBackupPayload {
	readonly identifier: IWorkingCopyIdentifier;
	readonly meta: IWorkingCopyBackupMeta | undefined;
	readonly content: Uint8Array;
	readonly baselineSha256: string | undefined;
}

/**
 * The inverse of `encodeBackupPayload`. Returns `undefined` for anything
 * that fails to parse as this service's own format, rather than throwing:
 * mirrors the Rust store's own tolerant `read_all_entries` philosophy of
 * treating a single malformed/foreign entry as noise, not a hard failure
 * for the whole enumeration.
 */
function decodeBackupPayload(
	bytes: Uint8Array,
): DecodedBackupPayload | undefined {
	const newlineIndex = bytes.indexOf(PREAMBLE_NEWLINE);
	if (newlineIndex < 0) {
		return undefined;
	}
	let preamble: unknown;
	try {
		preamble = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				bytes.slice(0, newlineIndex),
			),
		);
	} catch {
		return undefined;
	}
	if (
		typeof preamble !== "object" ||
		preamble === null ||
		typeof (preamble as { resource?: unknown }).resource !== "string"
	) {
		return undefined;
	}
	const {
		resource: resourceText,
		typeId,
		plainBaselineSha256,
		...meta
	} = preamble as {
		resource: string;
		typeId?: unknown;
		plainBaselineSha256?: unknown;
	} & Record<string, unknown>;
	let resource: URI;
	try {
		resource = URI.parse(resourceText);
	} catch {
		return undefined;
	}
	const resolvedTypeId = typeof typeId === "string" ? typeId : "";
	const metaKeys = Object.keys(meta);
	return Object.freeze({
		identifier: Object.freeze({ resource, typeId: resolvedTypeId }),
		meta: metaKeys.length > 0 ? (meta as IWorkingCopyBackupMeta) : undefined,
		content: bytes.slice(newlineIndex + 1),
		baselineSha256:
			typeof plainBaselineSha256 === "string" &&
			/^[0-9a-f]{64}$/u.test(plainBaselineSha256)
				? plainBaselineSha256
				: undefined,
	});
}

interface SyncIndexEntry {
	readonly identifier: IWorkingCopyIdentifier;
	readonly versionId: number | undefined;
}

function remapResourceAuthority(resource: URI, authority: string): URI {
	return resource.with({ authority });
}

/**
 * Plain's `IWorkingCopyBackupService`, backed by the Rust backup domain (see
 * `src-tauri/src/backup/`) through the four `backup_*` bridge commands.
 *
 * Synchronous index design: `hasBackupSync` cannot perform IPC, so this
 * service keeps an in-memory `Map<resource URI text, SyncIndexEntry>` that
 * mirrors on-disk existence. `backup()`/`discardBackup()` update it
 * optimistically as soon as their own async bridge call *settles*
 * (mirroring upstream's own `model.add()`-after-`writeFile()` ordering), and
 * roll the optimistic entry back to its exact prior state if that bridge
 * call throws — so a failed write or discard never leaves the sync index
 * disagreeing with reality. `getBackups()` deliberately re-queries the
 * bridge on every call rather than trusting a single one-shot preload: see
 * the doc comment on `PlainWorkingCopyBackupTracker` for why a one-shot
 * preload cannot work in Plain's bootstrap-before-folder-is-opened ordering.
 */
export class PlainWorkingCopyBackupService implements IWorkingCopyBackupService {
	readonly _serviceBrand = undefined;

	private readonly index = new Map<string, SyncIndexEntry>();
	private readonly storageKeys = new Map<string, string>();

	hasBackupSync(
		identifier: IWorkingCopyIdentifier,
		versionId?: number,
	): boolean {
		const entry = this.index.get(identifier.resource.toString());
		if (entry === undefined) {
			return false;
		}
		return versionId === undefined || entry.versionId === versionId;
	}

	async getBackups(): Promise<readonly IWorkingCopyIdentifier[]> {
		const bridge = requireBridge();
		let entries: readonly BackupEntry[];
		try {
			entries = await bridge.backupReadAll();
		} catch {
			// No workspace open yet (Rust reports `BACKUP_UNAVAILABLE` for the
			// EMPTY workspace) or any other transport failure: report zero
			// backups rather than rejecting. The tracker's restoration pass
			// must never see this promise reject.
			return Object.freeze(
				[...this.index.values()].map((entry) => entry.identifier),
			);
		}
		for (const entry of entries) {
			const parsed = decodeBackupPayload(entry.bytes);
			if (parsed === undefined) {
				continue;
			}
			const identifier = await this.currentIdentifier(parsed.identifier);
			if (identifier === undefined) {
				continue;
			}
			const resourceKey = identifier.resource.toString();
			this.index.set(resourceKey, {
				identifier,
				versionId: this.index.get(resourceKey)?.versionId,
			});
			this.storageKeys.set(resourceKey, entry.key);
		}
		return Object.freeze(
			[...this.index.values()].map((entry) => entry.identifier),
		);
	}

	async resolve<T extends IWorkingCopyBackupMeta>(
		identifier: IWorkingCopyIdentifier,
	): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		const bridge = requireBridge();
		const resourceKey = identifier.resource.toString();
		const key =
			this.storageKeys.get(resourceKey) ??
			(await backupKeyForResource(identifier.resource));
		let entries: readonly BackupEntry[];
		try {
			entries = await bridge.backupReadAll();
		} catch {
			return undefined;
		}
		const entry = entries.find((candidate) => candidate.key === key);
		if (entry === undefined) {
			return undefined;
		}
		const parsed = decodeBackupPayload(entry.bytes);
		if (parsed === undefined) {
			return undefined;
		}
		const meta = await this.currentMeta(identifier, parsed);
		return Object.freeze({
			value: bufferToStream(VSBuffer.wrap(parsed.content)),
			meta: meta as T | undefined,
		});
	}

	async backup(
		identifier: IWorkingCopyIdentifier,
		content?: VSBufferReadable | VSBufferReadableStream,
		versionId?: number,
		meta?: IWorkingCopyBackupMeta,
		token?: CancellationToken,
	): Promise<void> {
		const bridge = requireBridge();
		const resourceKey = identifier.resource.toString();
		const previous = this.index.get(resourceKey);
		const previousStorageKey = this.storageKeys.get(resourceKey);
		this.index.set(resourceKey, { identifier, versionId });
		try {
			if (isCancelled(token)) {
				this.rollbackIndex(resourceKey, previous);
				return;
			}
			const bytes = await contentToBytes(content);
			if (isCancelled(token)) {
				this.rollbackIndex(resourceKey, previous);
				return;
			}
			const baselineSha256 = await this.baselineSha256(identifier, meta);
			const payload = encodeBackupPayload(
				identifier,
				meta,
				bytes,
				baselineSha256,
			);
			const wireKey = await backupKeyForResource(identifier.resource);
			await bridge.backupWrite(wireKey, payload);
			if (previousStorageKey !== undefined && previousStorageKey !== wireKey) {
				try {
					await bridge.backupDiscard(previousStorageKey);
				} catch (error) {
					try {
						await bridge.backupDiscard(wireKey);
					} catch {
						// Preserve the original migration failure. A later read still
						// prefers the old, already-indexed entry for this process.
					}
					throw error;
				}
			}
			this.storageKeys.set(resourceKey, wireKey);
		} catch (error) {
			this.rollbackIndex(resourceKey, previous);
			this.rollbackStorageKey(resourceKey, previousStorageKey);
			throw error;
		}
	}

	async discardBackup(
		identifier: IWorkingCopyIdentifier,
		_token?: CancellationToken,
	): Promise<void> {
		const bridge = requireBridge();
		const resourceKey = identifier.resource.toString();
		const previous = this.index.get(resourceKey);
		const previousStorageKey = this.storageKeys.get(resourceKey);
		this.index.delete(resourceKey);
		this.storageKeys.delete(resourceKey);
		try {
			const wireKey =
				previousStorageKey ?? (await backupKeyForResource(identifier.resource));
			await bridge.backupDiscard(wireKey);
		} catch (error) {
			this.rollbackIndex(resourceKey, previous);
			this.rollbackStorageKey(resourceKey, previousStorageKey);
			throw error;
		}
	}

	async discardBackups(filter?: {
		except: IWorkingCopyIdentifier[];
	}): Promise<void> {
		const bridge = requireBridge();
		const except = filter?.except;
		if (except === undefined || except.length === 0) {
			const previousEntries = new Map(this.index);
			const previousStorageKeys = new Map(this.storageKeys);
			this.index.clear();
			this.storageKeys.clear();
			try {
				await bridge.backupDiscardAll();
			} catch (error) {
				this.index.clear();
				this.storageKeys.clear();
				for (const [resourceKey, entry] of previousEntries) {
					this.index.set(resourceKey, entry);
				}
				for (const [resourceKey, key] of previousStorageKeys) {
					this.storageKeys.set(resourceKey, key);
				}
				throw error;
			}
			return;
		}
		const exceptKeys = new Set(
			except.map((identifier) => identifier.resource.toString()),
		);
		const targets = [...this.index.values()].filter(
			(entry) => !exceptKeys.has(entry.identifier.resource.toString()),
		);
		for (const entry of targets) {
			await this.discardBackup(entry.identifier);
		}
	}

	private rollbackIndex(
		resourceKey: string,
		previous: SyncIndexEntry | undefined,
	): void {
		if (previous === undefined) {
			this.index.delete(resourceKey);
		} else {
			this.index.set(resourceKey, previous);
		}
	}

	/**
	 * Rust deliberately issues a fresh, unguessable root capability UUID each
	 * time a folder is authorized. A persisted backup therefore cannot reuse
	 * its old `plain-workspace://<root-id>/...` authority after a real process
	 * restart. In a single-root workspace the replacement is unambiguous: keep
	 * the relative path and bind it to the sole currently authorized root. For
	 * multi-root workspaces an old authority is skipped rather than guessed;
	 * restoring it against the wrong root would be worse than failing closed.
	 */
	private async currentIdentifier(
		stored: IWorkingCopyIdentifier,
	): Promise<IWorkingCopyIdentifier | undefined> {
		const bridge = requireBridge();
		let snapshot: WorkspaceSnapshot;
		try {
			snapshot = await bridge.workspaceSnapshot();
		} catch {
			// Unit/browser fakes predating native capability rotation can still
			// use their original identifier unchanged.
			return stored;
		}
		if (stored.resource.scheme !== "plain-workspace") {
			return stored;
		}
		if (
			snapshot.roots.some((root) => root.rootId === stored.resource.authority)
		) {
			return stored;
		}
		if (snapshot.roots.length !== 1) {
			return undefined;
		}
		return Object.freeze({
			resource: remapResourceAuthority(
				stored.resource,
				snapshot.roots[0]!.rootId,
			),
			typeId: stored.typeId,
		});
	}

	private async baselineSha256(
		identifier: IWorkingCopyIdentifier,
		meta: IWorkingCopyBackupMeta | undefined,
	): Promise<string | undefined> {
		const etag = (meta as { etag?: unknown } | undefined)?.etag;
		const parts = workspaceResourceParts(identifier.resource);
		if (typeof etag !== "string" || parts === undefined) {
			return undefined;
		}
		try {
			const current = await requireBridge().workspaceReadFile(
				parts.rootId,
				parts.relativePath,
			);
			if (current.stat.version !== etag) {
				return undefined;
			}
			return sha256(current.value.copy());
		} catch {
			return undefined;
		}
	}

	private async currentMeta(
		identifier: IWorkingCopyIdentifier,
		parsed: DecodedBackupPayload,
	): Promise<IWorkingCopyBackupMeta | undefined> {
		if (
			parsed.identifier.resource.toString() ===
				identifier.resource.toString() ||
			parsed.baselineSha256 === undefined
		) {
			return parsed.meta;
		}
		const parts = workspaceResourceParts(identifier.resource);
		if (parts === undefined) {
			return parsed.meta;
		}
		try {
			const current = await requireBridge().workspaceReadFile(
				parts.rootId,
				parts.relativePath,
			);
			if (
				current.stat.version === null ||
				(await sha256(current.value.copy())) !== parsed.baselineSha256
			) {
				return parsed.meta;
			}
			return Object.freeze({
				...parsed.meta,
				size: current.stat.size,
				mtime: current.stat.mtime,
				ctime: current.stat.ctime,
				etag: current.stat.version,
			});
		} catch {
			return parsed.meta;
		}
	}

	private rollbackStorageKey(
		resourceKey: string,
		previous: string | undefined,
	): void {
		if (previous === undefined) {
			this.storageKeys.delete(resourceKey);
		} else {
			this.storageKeys.set(resourceKey, previous);
		}
	}
}

Object.freeze(PlainWorkingCopyBackupService.prototype);
