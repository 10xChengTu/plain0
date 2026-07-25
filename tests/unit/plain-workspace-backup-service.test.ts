import {
	VSBuffer,
	bufferToReadable,
	streamToBuffer,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { beforeEach, describe, expect, it } from "vitest";

import type {
	BackupEntry,
	PlainBridge,
} from "../../app/platform/tauri/contracts";
import {
	configurePlainWorkingCopyBackupBridge,
	MAX_BACKUP_PAYLOAD_BYTES,
	PlainWorkingCopyBackupService,
} from "../../app/services/plain-workspace-backup-service";

interface FakeBridgeState {
	readonly writes: Array<{ key: string; bytes: Uint8Array }>;
	readonly discards: string[];
	discardAllCalls: number;
	readAllCalls: number;
	readonly entries: Map<string, Uint8Array>;
}

function notImplemented(): never {
	throw new Error("not implemented in fake bridge for this test");
}

function createFakeBridge(overrides: Partial<PlainBridge> = {}): {
	bridge: PlainBridge;
	state: FakeBridgeState;
} {
	const state: FakeBridgeState = {
		writes: [],
		discards: [],
		discardAllCalls: 0,
		readAllCalls: 0,
		entries: new Map(),
	};
	const bridge: PlainBridge = {
		runtimeInfo: notImplemented,
		onRuntimeReady: notImplemented,
		workspaceCapabilities: notImplemented,
		workspaceSnapshot: notImplemented,
		workspaceReconcileWatchRoots: notImplemented,
		workspaceWatch: notImplemented,
		workspacePickRoots: notImplemented,
		workspaceRemoveRoot: notImplemented,
		workspaceCreateFile: notImplemented,
		workspaceCreateDirectory: notImplemented,
		workspaceRename: notImplemented,
		workspaceCopy: notImplemented,
		workspaceMove: notImplemented,
		workspacePrepareDelete: notImplemented,
		workspaceCancelDelete: notImplemented,
		workspaceBeginDelete: notImplemented,
		workspaceCommitDeleteEntry: notImplemented,
		workspaceStat: notImplemented,
		workspaceReadDirectory: notImplemented,
		workspaceReadFile: notImplemented,
		workspaceWriteFile: notImplemented,
		workspaceSearchFiles: notImplemented,
		workspaceSearchTextStart: notImplemented,
		workspaceSearchTextPoll: notImplemented,
		workspaceSearchTextCancel: notImplemented,
		workspaceSearchTextWatch: notImplemented,
		async backupWrite(key, bytes) {
			state.writes.push({ key, bytes });
			state.entries.set(key, bytes);
		},
		async backupReadAll(): Promise<readonly BackupEntry[]> {
			state.readAllCalls += 1;
			return [...state.entries.entries()].map(([key, bytes]) =>
				Object.freeze({ key, bytes }),
			);
		},
		async backupDiscard(key) {
			state.discards.push(key);
			state.entries.delete(key);
		},
		async backupDiscardAll() {
			state.discardAllCalls += 1;
			state.entries.clear();
		},
		themeImportVsix: notImplemented,
		themeImportDirectory: notImplemented,
		themeList: notImplemented,
		themeReadResource: notImplemented,
		themeRemove: notImplemented,
		themeGetSelection: notImplemented,
		themeSetSelection: notImplemented,
		themeSetFileIconThemeSelection: notImplemented,
		themeSetProductIconThemeSelection: notImplemented,
		terminalStart: notImplemented,
		terminalInputText: notImplemented,
		terminalInputKey: notImplemented,
		terminalFocus: notImplemented,
		terminalResize: notImplemented,
		terminalAck: notImplemented,
		terminalScrollback: notImplemented,
		terminalKill: notImplemented,
		terminalWatchData: notImplemented,
		terminalWatchExit: notImplemented,
		workspaceTrustState: notImplemented,
		workspaceTrustGrant: notImplemented,
		workspaceTrustRevoke: notImplemented,
		gitStatus: notImplemented,
		gitDiffFiles: notImplemented,
		gitShowBlob: notImplemented,
		...overrides,
	};
	return { bridge, state };
}

function identifierFor(uri: string, typeId = "") {
	return { resource: URI.parse(uri), typeId };
}

function readableFromString(text: string) {
	return bufferToReadable(VSBuffer.fromString(text));
}

async function readValueToString(
	value: Awaited<ReturnType<PlainWorkingCopyBackupService["resolve"]>>,
): Promise<string> {
	if (value === undefined) {
		throw new Error("expected a resolved backup");
	}
	const buffer = await streamToBuffer(value.value);
	return buffer.toString();
}

describe("PlainWorkingCopyBackupService", () => {
	beforeEach(() => {
		// Every test configures its own fake bridge before touching the
		// service; this just guards against a stray unconfigured call leaking
		// from a previous test file sharing the module cache.
		configurePlainWorkingCopyBackupBridge(createFakeBridge().bridge);
	});

	it("hasBackupSync becomes true immediately after backup() resolves and false immediately after discardBackup() resolves", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/a.txt");

		expect(service.hasBackupSync(identifier)).toBe(false);
		await service.backup(identifier, readableFromString("hello"), 1);
		expect(service.hasBackupSync(identifier)).toBe(true);
		expect(service.hasBackupSync(identifier, 1)).toBe(true);
		expect(service.hasBackupSync(identifier, 2)).toBe(false);

		await service.discardBackup(identifier);
		expect(service.hasBackupSync(identifier)).toBe(false);
	});

	it("rolls the sync index back to its exact prior state when the underlying write fails", async () => {
		const { bridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/a.txt");

		// First: a successful backup establishes a known-good baseline entry.
		await service.backup(identifier, readableFromString("first"), 1);
		expect(service.hasBackupSync(identifier, 1)).toBe(true);

		// Second: a failing write for the *same* resource, at a new version,
		// must not leave hasBackupSync reporting the new (never-written)
		// version, nor lose the fact that a backup still exists at all.
		let shouldFail = true;
		const failingBridge = createFakeBridge({
			backupWrite: async (key, bytes) => {
				if (shouldFail) {
					throw new Error("disk full");
				}
				state.writes.push({ key, bytes });
				state.entries.set(key, bytes);
			},
		});
		configurePlainWorkingCopyBackupBridge(failingBridge.bridge);
		await expect(
			service.backup(identifier, readableFromString("second"), 2),
		).rejects.toThrow("disk full");
		expect(service.hasBackupSync(identifier, 2)).toBe(false);
		expect(service.hasBackupSync(identifier, 1)).toBe(true);

		// A backup for a resource with *no* prior entry that then fails must
		// roll all the way back to "no entry", not a stale ghost entry.
		const neverBackedUp = identifierFor("plain-workspace://root/b.txt");
		await expect(
			service.backup(neverBackedUp, readableFromString("x"), 1),
		).rejects.toThrow("disk full");
		expect(service.hasBackupSync(neverBackedUp)).toBe(false);

		shouldFail = false;
	});

	it("rolls discardBackup's sync index change back on failure, keeping the entry present", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/a.txt");
		await service.backup(identifier, readableFromString("hello"), 1);

		const { bridge: failingDiscardBridge } = createFakeBridge({
			backupDiscard: async () => {
				throw new Error("discard failed");
			},
		});
		configurePlainWorkingCopyBackupBridge(failingDiscardBridge);
		await expect(service.discardBackup(identifier)).rejects.toThrow(
			"discard failed",
		);
		expect(service.hasBackupSync(identifier, 1)).toBe(true);
	});

	it("derives a stable, distinct 64-character lowercase hex key per resource URI", async () => {
		const { bridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const first = identifierFor("plain-workspace://root/a.txt");
		const second = identifierFor("plain-workspace://root/b.txt");

		await service.backup(first, readableFromString("one"));
		await service.backup(first, readableFromString("one-again"));
		await service.backup(second, readableFromString("two"));

		expect(state.writes).toHaveLength(3);
		const [firstKey, firstKeyAgain, secondKey] = state.writes.map(
			(write) => write.key,
		);
		expect(firstKey).toMatch(/^[0-9a-f]{64}$/);
		expect(secondKey).toMatch(/^[0-9a-f]{64}$/);
		expect(firstKeyAgain).toBe(firstKey);
		expect(secondKey).not.toBe(firstKey);
	});

	it("round-trips typeId, custom meta and content through backup()/resolve() and getBackups()", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/notes.txt", "");
		const meta = { mtime: 12_345, orphaned: false };

		await service.backup(
			identifier,
			readableFromString("unsaved content"),
			1,
			meta,
		);

		const resolved = await service.resolve(identifier);
		expect(resolved).toBeDefined();
		expect(await readValueToString(resolved)).toBe("unsaved content");
		expect(resolved?.meta).toEqual(meta);

		const backups = await service.getBackups();
		expect(backups).toHaveLength(1);
		expect(backups[0]?.typeId).toBe("");
		expect(backups[0]?.resource.toString()).toBe(
			identifier.resource.toString(),
		);
	});

	it("resolve() returns undefined for a resource with no backup", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/missing.txt");
		expect(await service.resolve(identifier)).toBeUndefined();
	});

	it("getBackups() reports zero backups (never rejects) when the bridge reports the EMPTY workspace", async () => {
		const { bridge } = createFakeBridge({
			backupReadAll: async () => {
				throw Object.freeze({
					code: "BACKUP_UNAVAILABLE",
					message: "The backup store is not available for this window.",
				});
			},
		});
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		await expect(service.getBackups()).resolves.toEqual([]);
	});

	it("accepts a payload at the exact 8 MiB total-size boundary and rejects one byte more, leaving the index unaffected", async () => {
		const { bridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor("plain-workspace://root/big.txt");
		const preambleBytes = new TextEncoder().encode(
			`${JSON.stringify({
				resource: identifier.resource.toString(),
				typeId: identifier.typeId,
			})}\n`,
		).byteLength;
		const maxContentBytes = MAX_BACKUP_PAYLOAD_BYTES - preambleBytes;

		const exact = new Uint8Array(maxContentBytes).fill(0x61);
		await service.backup(identifier, bufferToReadable(VSBuffer.wrap(exact)));
		expect(service.hasBackupSync(identifier)).toBe(true);
		expect(state.writes[0]?.bytes.byteLength).toBe(
			preambleBytes + maxContentBytes,
		);

		await service.discardBackup(identifier);
		const oversized = new Uint8Array(maxContentBytes + 1).fill(0x61);
		await expect(
			service.backup(identifier, bufferToReadable(VSBuffer.wrap(oversized))),
		).rejects.toMatchObject({ code: "BACKUP_TOO_LARGE" });
		expect(service.hasBackupSync(identifier)).toBe(false);
	});

	it("discardBackups() with no filter discards everything through one backupDiscardAll call and rolls the whole index back on failure", async () => {
		const { bridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const first = identifierFor("plain-workspace://root/a.txt");
		const second = identifierFor("plain-workspace://root/b.txt");
		await service.backup(first, readableFromString("1"));
		await service.backup(second, readableFromString("2"));

		await service.discardBackups();
		expect(state.discardAllCalls).toBe(1);
		expect(service.hasBackupSync(first)).toBe(false);
		expect(service.hasBackupSync(second)).toBe(false);

		await service.backup(first, readableFromString("1"));
		await service.backup(second, readableFromString("2"));
		const { bridge: failingBridge } = createFakeBridge({
			backupDiscardAll: async () => {
				throw new Error("discard-all failed");
			},
		});
		configurePlainWorkingCopyBackupBridge(failingBridge);
		await expect(service.discardBackups()).rejects.toThrow(
			"discard-all failed",
		);
		expect(service.hasBackupSync(first)).toBe(true);
		expect(service.hasBackupSync(second)).toBe(true);
	});

	it("discardBackups({ except }) discards only the entries not in the exception list", async () => {
		const { bridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const kept = identifierFor("plain-workspace://root/keep.txt");
		const dropped = identifierFor("plain-workspace://root/drop.txt");
		await service.backup(kept, readableFromString("keep"));
		await service.backup(dropped, readableFromString("drop"));

		await service.discardBackups({ except: [kept] });
		expect(state.discardAllCalls).toBe(0);
		expect(service.hasBackupSync(kept)).toBe(true);
		expect(service.hasBackupSync(dropped)).toBe(false);
	});
});
