import {
	VSBuffer,
	bufferToReadable,
	streamToBuffer,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/buffer";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	BackupEntry,
	PlainBridge,
} from "../../app/platform/tauri/contracts";
import {
	configurePlainWorkingCopyBackupBridge,
	MAX_BACKUP_PAYLOAD_BYTES,
	PlainWorkingCopyBackupService,
} from "../../app/services/plain-workspace-backup-service";
import { plainUntitledResourceForScratchId } from "../../app/services/plain-untitled-resource";

interface FakeBridgeState {
	readonly writes: Array<{ rootId: string; key: string; bytes: Uint8Array }>;
	readonly discards: Array<{ rootId: string; key: string }>;
	discardAllCalls: number;
	scratchDiscardAllCalls: number;
	readAllCalls: number;
	scratchReadAllCalls: number;
	readonly scratchWrites: Array<{ scratchId: string; bytes: Uint8Array }>;
	readonly scratchDiscards: string[];
	readonly scratchEntries: Map<string, Uint8Array>;
	readonly entries: Map<
		string,
		{ rootId: string; key: string; bytes: Uint8Array }
	>;
}

const ROOT_ID = "00000000-0000-4000-8000-000000000101";
const SECOND_ROOT_ID = "00000000-0000-4000-8000-000000000102";
const backupMapKey = (rootId: string, key: string): string =>
	`${rootId}\0${key}`;

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
		scratchDiscardAllCalls: 0,
		readAllCalls: 0,
		scratchReadAllCalls: 0,
		scratchWrites: [],
		scratchDiscards: [],
		scratchEntries: new Map(),
		entries: new Map(),
	};
	const bridge: PlainBridge = {
		runtimeInfo: notImplemented,
		windowCreate: notImplemented,
		onRuntimeReady: notImplemented,
		onNativeCloseRequested: notImplemented,
		lifecycleCompleteClose: notImplemented,
		lifecycleRequestClose: notImplemented,
		userDataRead: notImplemented,
		userDataWrite: notImplemented,
		onUserDataChanged: notImplemented,
		workspaceCapabilities: notImplemented,
		workspaceSnapshot: notImplemented,
		workspaceReconcileWatchRoots: notImplemented,
		workspaceWatch: notImplemented,
		workspacePickRoots: notImplemented,
		workspaceOpenFiles: notImplemented,
		workspacePickSaveTarget: notImplemented,
		workspaceRecentList: notImplemented,
		workspaceOpenRecent: notImplemented,
		workspaceRemoveRecent: notImplemented,
		workspaceClearRecent: notImplemented,
		workspaceRemoveRoot: notImplemented,
		workspaceCloseFolder: notImplemented,
		workspaceCreateFile: notImplemented,
		workspaceCreateDirectory: notImplemented,
		workspaceRename: notImplemented,
		workspaceCopy: notImplemented,
		workspaceMove: notImplemented,
		workspacePrepareDelete: notImplemented,
		workspaceCancelDelete: notImplemented,
		workspaceBeginDelete: notImplemented,
		workspaceCommitDeleteEntry: notImplemented,
		workspacePrepareTrash: notImplemented,
		workspaceCancelTrash: notImplemented,
		workspaceBeginTrash: notImplemented,
		workspaceCommitTrashEntry: notImplemented,
		workspaceStat: notImplemented,
		workspaceReadDirectory: notImplemented,
		workspaceReadFile: notImplemented,
		workspaceWriteFile: notImplemented,
		workspacePublishFile: notImplemented,
		workspaceSearchFiles: notImplemented,
		workspaceSearchTextStart: notImplemented,
		workspaceSearchTextPoll: notImplemented,
		workspaceSearchTextCancel: notImplemented,
		workspaceSearchTextWatch: notImplemented,
		workspaceSearchExpandReplacements: notImplemented,
		async backupWrite(rootId, key, bytes) {
			state.writes.push({ rootId, key, bytes });
			state.entries.set(backupMapKey(rootId, key), { rootId, key, bytes });
		},
		async backupReadAll(): Promise<readonly BackupEntry[]> {
			state.readAllCalls += 1;
			return [...state.entries.values()].map(({ rootId, key, bytes }) =>
				Object.freeze({ rootId, key, bytes }),
			);
		},
		async backupDiscard(rootId, key) {
			state.discards.push({ rootId, key });
			state.entries.delete(backupMapKey(rootId, key));
		},
		async backupDiscardAll() {
			state.discardAllCalls += 1;
			state.entries.clear();
		},
		scratchCreate: notImplemented,
		async scratchWrite(scratchId, bytes) {
			const snapshot = bytes.slice();
			state.scratchWrites.push({ scratchId, bytes: snapshot });
			state.scratchEntries.set(scratchId, snapshot);
		},
		async scratchReadAll() {
			state.scratchReadAllCalls += 1;
			return [...state.scratchEntries].map(([scratchId, bytes]) =>
				Object.freeze({ scratchId, bytes: bytes.slice() }),
			);
		},
		async scratchDiscard(scratchId) {
			state.scratchDiscards.push(scratchId);
			state.scratchEntries.delete(scratchId);
		},
		async scratchDiscardAll() {
			state.scratchDiscardAllCalls += 1;
			state.scratchEntries.clear();
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
		terminalProfiles: notImplemented,
		terminalStart: notImplemented,
		terminalInputText: notImplemented,
		terminalInputKey: notImplemented,
		terminalFocus: notImplemented,
		terminalResize: notImplemented,
		terminalAck: notImplemented,
		terminalScrollback: notImplemented,
		terminalKill: notImplemented,
		terminalOpenExternalLink: notImplemented,
		terminalLifecycleMarker: notImplemented,
		terminalWatchData: notImplemented,
		terminalWatchExit: notImplemented,
		workspaceTrustState: notImplemented,
		workspaceTrustGrant: notImplemented,
		workspaceTrustRevoke: notImplemented,
		gitStatus: notImplemented,
		gitDiffFiles: notImplemented,
		gitShowBlob: notImplemented,
		gitStagePaths: notImplemented,
		gitUnstagePaths: notImplemented,
		gitStageBlob: notImplemented,
		gitCommit: notImplemented,
		gitDiscardPaths: notImplemented,
		gitNetworkPreview: notImplemented,
		gitFetch: notImplemented,
		gitPull: notImplemented,
		gitPush: notImplemented,
		gitNetworkCancel: notImplemented,
		gitBlameFile: notImplemented,
		gitBlameCommitMessages: notImplemented,
		gitFileHistory: notImplemented,
		gitLineHistoryList: notImplemented,
		gitLineHistoryDetail: notImplemented,
		gitShowCommit: notImplemented,
		gitShowCommitBlob: notImplemented,
		gitLogGraph: notImplemented,
		gitRefsList: notImplemented,
		gitRemotesList: notImplemented,
		gitReflogList: notImplemented,
		gitContributorsList: notImplemented,
		gitBranchCreate: notImplemented,
		gitBranchSwitch: notImplemented,
		gitBranchRename: notImplemented,
		gitBranchDelete: notImplemented,
		gitTagCreate: notImplemented,
		gitTagDelete: notImplemented,
		gitRemoteAdd: notImplemented,
		gitRemoteRename: notImplemented,
		gitRemoteSetUrl: notImplemented,
		gitRemoteRemove: notImplemented,
		gitUpstreamSet: notImplemented,
		gitUpstreamUnset: notImplemented,
		gitHistoryState: notImplemented,
		gitHistoryPreview: notImplemented,
		gitMerge: notImplemented,
		gitRebase: notImplemented,
		gitCherryPick: notImplemented,
		gitRevert: notImplemented,
		gitReset: notImplemented,
		gitHistoryContinue: notImplemented,
		gitHistoryAbort: notImplemented,
		gitHistoryCancel: notImplemented,
		gitStashList: notImplemented,
		gitStashShow: notImplemented,
		gitStashPush: notImplemented,
		gitStashApply: notImplemented,
		gitStashPop: notImplemented,
		gitStashDrop: notImplemented,
		gitWorktreeList: notImplemented,
		gitWorktreeAdd: notImplemented,
		gitWorktreeRemove: notImplemented,
		debugAdapterConfirmationState: notImplemented,
		debugAdapterConfirmationGrant: notImplemented,
		debugAdapterConfirmationRevoke: notImplemented,
		debugLaunch: notImplemented,
		debugAttach: notImplemented,
		debugDisconnect: notImplemented,
		debugSetBreakpoints: notImplemented,
		debugStackTrace: notImplemented,
		debugScopes: notImplemented,
		debugVariables: notImplemented,
		debugEvaluate: notImplemented,
		debugContinue: notImplemented,
		debugNext: notImplemented,
		debugStepIn: notImplemented,
		debugStepInTargets: notImplemented,
		debugStepOut: notImplemented,
		debugPause: notImplemented,
		debugDisassemble: notImplemented,
		debugOutputAck: notImplemented,
		debugWatchEvent: notImplemented,
		remoteSessionConnect: notImplemented,
		remoteHostKeyConfirm: notImplemented,
		remoteSessionConnectCancel: notImplemented,
		remoteSessionDisconnect: notImplemented,
		remoteSessionState: notImplemented,
		remoteHostKeyForget: notImplemented,
		remoteHostKeyList: notImplemented,
		remoteSessionWatchEvent: notImplemented,
		remoteWorkspacePickDirectory: notImplemented,
		remoteWorkspaceAddRoot: notImplemented,
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
		const identifier = identifierFor(`plain-workspace://${ROOT_ID}/a.txt`);

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
		const identifier = identifierFor(`plain-workspace://${ROOT_ID}/a.txt`);

		// First: a successful backup establishes a known-good baseline entry.
		await service.backup(identifier, readableFromString("first"), 1);
		expect(service.hasBackupSync(identifier, 1)).toBe(true);

		// Second: a failing write for the *same* resource, at a new version,
		// must not leave hasBackupSync reporting the new (never-written)
		// version, nor lose the fact that a backup still exists at all.
		let shouldFail = true;
		const failingBridge = createFakeBridge({
			backupWrite: async (rootId, key, bytes) => {
				if (shouldFail) {
					throw new Error("disk full");
				}
				state.writes.push({ rootId, key, bytes });
				state.entries.set(backupMapKey(rootId, key), { rootId, key, bytes });
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
		const neverBackedUp = identifierFor(`plain-workspace://${ROOT_ID}/b.txt`);
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
		const identifier = identifierFor(`plain-workspace://${ROOT_ID}/a.txt`);
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
		const first = identifierFor(`plain-workspace://${ROOT_ID}/a.txt`);
		const second = identifierFor(`plain-workspace://${ROOT_ID}/b.txt`);

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
		const identifier = identifierFor(
			`plain-workspace://${ROOT_ID}/notes.txt`,
			"",
		);
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

	it("routes Plain Untitled backups through the independent Rust scratch partition", async () => {
		const { bridge, state } = createFakeBridge({
			backupReadAll: async () => {
				throw Object.freeze({ code: "BACKUP_UNAVAILABLE" });
			},
		});
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const scratchId = "00000000-0000-4000-8000-000000000111";
		const identifier = {
			resource: plainUntitledResourceForScratchId(scratchId),
			typeId: "",
		};

		await service.backup(identifier, readableFromString("unsaved scratch"), 7);
		expect(state.writes).toEqual([]);
		expect(state.scratchWrites).toHaveLength(1);
		expect(service.hasBackupSync(identifier, 7)).toBe(true);
		expect(await readValueToString(await service.resolve(identifier))).toBe(
			"unsaved scratch",
		);
		expect(await service.getBackups()).toEqual([identifier]);
		expect(service.hasBackupSync(identifier, 7)).toBe(true);

		await service.discardBackup(identifier);
		expect(state.scratchDiscards).toEqual([scratchId]);
		expect(state.discards).toEqual([]);
		expect(service.hasBackupSync(identifier)).toBe(false);
	});

	it("coalesces concurrent scratch discards so tracker cleanup remains idempotent", async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const scratchDiscard = vi.fn(async () => pending);
		const { bridge } = createFakeBridge({ scratchDiscard });
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor(
			plainUntitledResourceForScratchId(
				"00000000-0000-4000-8000-000000000113",
			).toString(),
		);
		await service.backup(identifier, readableFromString("dirty"));

		const first = service.discardBackup(identifier);
		const second = service.discardBackup(identifier);
		expect(scratchDiscard).toHaveBeenCalledTimes(1);
		release();
		await Promise.all([first, second]);
		await service.discardBackup(identifier);
		expect(scratchDiscard).toHaveBeenCalledTimes(1);
		expect(service.hasBackupSync(identifier)).toBe(false);
	});

	it("re-enables native scratch cleanup after a discarded working copy is backed up again", async () => {
		const scratchDiscard = vi.fn(async () => undefined);
		const { bridge } = createFakeBridge({ scratchDiscard });
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor(
			plainUntitledResourceForScratchId(
				"00000000-0000-4000-8000-000000000114",
			).toString(),
		);

		await service.backup(identifier, readableFromString("first"));
		await service.discardBackup(identifier);
		await service.backup(identifier, readableFromString("second"));
		await service.discardBackup(identifier);

		expect(scratchDiscard).toHaveBeenCalledTimes(2);
		expect(service.hasBackupSync(identifier)).toBe(false);
	});

	it("restores orphan scratch even when no workspace backup store is available", async () => {
		const scratchId = "00000000-0000-4000-8000-000000000112";
		const { bridge, state } = createFakeBridge({
			backupReadAll: async () => {
				throw Object.freeze({ code: "BACKUP_UNAVAILABLE" });
			},
		});
		state.scratchEntries.set(
			scratchId,
			new TextEncoder().encode("crash recovery"),
		);
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();

		const backups = await service.getBackups();
		expect(backups).toHaveLength(1);
		expect(backups[0]?.resource.toString()).toBe(
			plainUntitledResourceForScratchId(scratchId).toString(),
		);
		expect(await readValueToString(await service.resolve(backups[0]!))).toBe(
			"crash recovery",
		);
	});

	it("rejects ordinary untitled URIs that do not carry a Rust scratch id", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		await expect(
			service.backup(
				identifierFor("untitled:/Untitled-1"),
				readableFromString("not owned"),
			),
		).rejects.toMatchObject({ code: "BACKUP_UNAVAILABLE" });
	});

	it("remaps a persisted backup only to the exact current root returned by native storage", async () => {
		const oldRootId = "00000000-0000-4000-8000-000000000101";
		const newRootId = "00000000-0000-4000-8000-000000000201";
		const oldVersion = `wv1:${"a".repeat(64)}`;
		const newVersion = `wv1:${"b".repeat(64)}`;
		const baselineBytes = new TextEncoder().encode("disk base\n");
		let currentDiskBytes = baselineBytes;
		const readReceipt = (version: string, bytes = baselineBytes) =>
			Object.freeze({
				stat: Object.freeze({
					kind: "file" as const,
					size: bytes.byteLength,
					mtime: 123,
					ctime: 456,
					version,
				}),
				value: Object.freeze({
					byteLength: bytes.byteLength,
					copy: () => bytes.slice(),
				}),
			});
		const storedIdentifier = identifierFor(
			`plain-workspace://${oldRootId}/hot.txt`,
		);
		const { bridge: writerBridge, state: writerState } = createFakeBridge({
			workspaceReadFile: async () => readReceipt(oldVersion),
		});
		configurePlainWorkingCopyBackupBridge(writerBridge);
		const writer = new PlainWorkingCopyBackupService();
		await writer.backup(
			storedIdentifier,
			readableFromString("unsaved recovery"),
			1,
			{ etag: oldVersion, orphaned: false },
		);
		const storedKey = [...writerState.entries.values()][0]!.key;

		const { bridge: readerBridge } = createFakeBridge({
			workspaceSnapshot: async () =>
				Object.freeze({
					workspaceId: "00000000-0000-4000-8000-000000000301",
					revision: 1,
					roots: Object.freeze([
						Object.freeze({
							rootId: newRootId,
							displayName: "fixture",
							uri: `plain-workspace://${newRootId}/`,
						}),
					]),
				}),
			backupReadAll: async () =>
				[...writerState.entries.values()].map(({ key, bytes }) =>
					Object.freeze({ rootId: newRootId, key, bytes }),
				),
			backupDiscard: async (rootId, key) => {
				writerState.discards.push({ rootId, key });
				writerState.entries.delete(backupMapKey(oldRootId, key));
			},
			workspaceReadFile: async () => readReceipt(newVersion, currentDiskBytes),
		});
		configurePlainWorkingCopyBackupBridge(readerBridge);
		const reader = new PlainWorkingCopyBackupService();

		const [currentIdentifier] = await reader.getBackups();
		expect(currentIdentifier?.resource.toString()).toBe(
			`plain-workspace://${newRootId}/hot.txt`,
		);
		const resolved = await reader.resolve(currentIdentifier!);
		expect(await readValueToString(resolved)).toBe("unsaved recovery");
		expect(resolved?.meta).toMatchObject({
			etag: newVersion,
			size: baselineBytes.byteLength,
			mtime: 123,
			ctime: 456,
		});
		currentDiskBytes = new TextEncoder().encode("external change\n");
		const conflicted = await reader.resolve(currentIdentifier!);
		expect(conflicted?.meta).toMatchObject({ etag: oldVersion });

		await reader.discardBackup(currentIdentifier!);
		expect(writerState.discards).toEqual([
			{ rootId: newRootId, key: storedKey },
		]);
		expect(writerState.entries.size).toBe(0);
	});

	it("keeps same-path multi-root backups distinct when both capability ids rotate", async () => {
		const { bridge: writerBridge, state } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(writerBridge);
		const writer = new PlainWorkingCopyBackupService();
		await writer.backup(
			identifierFor(`plain-workspace://${ROOT_ID}/shared.txt`),
			readableFromString("PRIMARY UNSAVED"),
		);
		await writer.backup(
			identifierFor(`plain-workspace://${SECOND_ROOT_ID}/shared.txt`),
			readableFromString("SECONDARY UNSAVED"),
		);

		const currentPrimary = "00000000-0000-4000-8000-000000000201";
		const currentSecondary = "00000000-0000-4000-8000-000000000202";
		const currentRootFor = (oldRootId: string): string =>
			oldRootId === ROOT_ID ? currentPrimary : currentSecondary;
		const persistedEntries = (): readonly BackupEntry[] =>
			[...state.entries.values()].map(({ rootId, key, bytes }) =>
				Object.freeze({ rootId: currentRootFor(rootId), key, bytes }),
			);
		const { bridge: readerBridge } = createFakeBridge({
			workspaceSnapshot: async () =>
				Object.freeze({
					workspaceId: "00000000-0000-4000-8000-000000000301",
					revision: 2,
					roots: Object.freeze([
						Object.freeze({
							rootId: currentPrimary,
							displayName: "primary",
							uri: `plain-workspace://${currentPrimary}/`,
						}),
						Object.freeze({
							rootId: currentSecondary,
							displayName: "secondary",
							uri: `plain-workspace://${currentSecondary}/`,
						}),
					]),
				}),
			backupReadAll: async () => persistedEntries(),
		});
		configurePlainWorkingCopyBackupBridge(readerBridge);
		const reader = new PlainWorkingCopyBackupService();
		const backups = [...(await reader.getBackups())].sort((left, right) =>
			left.resource.authority.localeCompare(right.resource.authority),
		);
		expect(backups.map(({ resource }) => resource.toString())).toEqual([
			`plain-workspace://${currentPrimary}/shared.txt`,
			`plain-workspace://${currentSecondary}/shared.txt`,
		]);
		expect(await readValueToString(await reader.resolve(backups[0]!))).toBe(
			"PRIMARY UNSAVED",
		);
		expect(await readValueToString(await reader.resolve(backups[1]!))).toBe(
			"SECONDARY UNSAVED",
		);
	});

	it("resolve() returns undefined for a resource with no backup", async () => {
		const { bridge } = createFakeBridge();
		configurePlainWorkingCopyBackupBridge(bridge);
		const service = new PlainWorkingCopyBackupService();
		const identifier = identifierFor(
			`plain-workspace://${ROOT_ID}/missing.txt`,
		);
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
		const identifier = identifierFor(`plain-workspace://${ROOT_ID}/big.txt`);
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
		const first = identifierFor(`plain-workspace://${ROOT_ID}/a.txt`);
		const second = identifierFor(`plain-workspace://${ROOT_ID}/b.txt`);
		await service.backup(first, readableFromString("1"));
		await service.backup(second, readableFromString("2"));

		await service.discardBackups();
		expect(state.discardAllCalls).toBe(1);
		expect(state.scratchDiscardAllCalls).toBe(1);
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
		const kept = identifierFor(`plain-workspace://${ROOT_ID}/keep.txt`);
		const dropped = identifierFor(`plain-workspace://${ROOT_ID}/drop.txt`);
		await service.backup(kept, readableFromString("keep"));
		await service.backup(dropped, readableFromString("drop"));

		await service.discardBackups({ except: [kept] });
		expect(state.discardAllCalls).toBe(0);
		expect(service.hasBackupSync(kept)).toBe(true);
		expect(service.hasBackupSync(dropped)).toBe(false);
	});
});
