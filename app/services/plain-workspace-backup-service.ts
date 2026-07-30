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

import type { BackupEntry, PlainBridge } from "../platform/tauri/contracts";

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
): Uint8Array {
	const preamble = {
		...meta,
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
		...meta
	} = preamble as {
		resource: string;
		typeId?: unknown;
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
	});
}

interface SyncIndexEntry {
	readonly identifier: IWorkingCopyIdentifier;
	readonly versionId: number | undefined;
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
			const resourceKey = parsed.identifier.resource.toString();
			this.index.set(resourceKey, {
				identifier: parsed.identifier,
				versionId: this.index.get(resourceKey)?.versionId,
			});
		}
		return Object.freeze(
			[...this.index.values()].map((entry) => entry.identifier),
		);
	}

	async resolve<T extends IWorkingCopyBackupMeta>(
		identifier: IWorkingCopyIdentifier,
	): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		const bridge = requireBridge();
		const key = await backupKeyForResource(identifier.resource);
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
		return Object.freeze({
			value: bufferToStream(VSBuffer.wrap(parsed.content)),
			meta: parsed.meta as T | undefined,
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
			const payload = encodeBackupPayload(identifier, meta, bytes);
			const wireKey = await backupKeyForResource(identifier.resource);
			await bridge.backupWrite(wireKey, payload);
		} catch (error) {
			this.rollbackIndex(resourceKey, previous);
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
		this.index.delete(resourceKey);
		try {
			const wireKey = await backupKeyForResource(identifier.resource);
			await bridge.backupDiscard(wireKey);
		} catch (error) {
			this.rollbackIndex(resourceKey, previous);
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
			this.index.clear();
			try {
				await bridge.backupDiscardAll();
			} catch (error) {
				this.index.clear();
				for (const [resourceKey, entry] of previousEntries) {
					this.index.set(resourceKey, entry);
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
}

Object.freeze(PlainWorkingCopyBackupService.prototype);
