import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { IWorkingCopy } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/workingCopy/common/workingCopy";
import { describe, expect, it, vi } from "vitest";

import {
	flushPlainWorkingCopyBackupsForTopologyChange,
	flushStableWorkingCopyBackups,
	PLAIN_WORKING_COPY_BACKUP_FLUSH_FAILED,
} from "../../app/services/plain-workspace-backup-tracker";

function workingCopy(
	version: { value: number },
	backup: () => Promise<Readonly<{ content: undefined; meta: undefined }>>,
): IWorkingCopy {
	return {
		resource: URI.parse("plain-workspace://root/file.txt"),
		typeId: "",
		capabilities: 0,
		name: "file.txt",
		isDirty: () => true,
		isModified: () => true,
		backup,
		version,
	} as unknown as IWorkingCopy;
}

describe("working-copy topology flush", () => {
	it("fails closed with a stable path-free error before the tracker is active", async () => {
		await expect(
			flushPlainWorkingCopyBackupsForTopologyChange(),
		).rejects.toMatchObject({
			name: "PlainWorkingCopyBackupFlushFailedError",
			code: PLAIN_WORKING_COPY_BACKUP_FLUSH_FAILED,
			message: "Plain could not preserve every modified file. Try again.",
		});
	});

	it("cancels stale work and persists one stable content version", async () => {
		const version = { value: 7 };
		const copy = workingCopy(
			version,
			vi.fn(async () => ({
				content: undefined,
				meta: undefined,
			})),
		);
		const cancelPendingBackups = vi.fn();
		const backup = vi.fn(async () => undefined);
		const discardBackup = vi.fn(async () => undefined);
		const logError = vi.fn();

		await flushStableWorkingCopyBackups({
			modifiedWorkingCopies: [copy],
			hotExitEnabled: true,
			cancelPendingBackups,
			getContentVersion: () => version.value,
			backupService: { backup, discardBackup },
			logError,
		});

		expect(cancelPendingBackups).toHaveBeenCalledOnce();
		expect(copy.backup).toHaveBeenCalledOnce();
		expect(backup).toHaveBeenCalledOnce();
		expect((backup.mock.calls as unknown[][])[0]?.[2]).toBe(7);
		expect(discardBackup).not.toHaveBeenCalled();
		expect(logError).not.toHaveBeenCalled();
	});

	it("retries a changing copy four times, logs it, and exposes only a stable error", async () => {
		const version = { value: 1 };
		const copy = workingCopy(
			version,
			vi.fn(async () => {
				version.value += 1;
				return { content: undefined, meta: undefined };
			}),
		);
		const backup = vi.fn(async () => undefined);
		const logError = vi.fn();

		await expect(
			flushStableWorkingCopyBackups({
				modifiedWorkingCopies: [copy],
				hotExitEnabled: true,
				cancelPendingBackups: vi.fn(),
				getContentVersion: () => version.value,
				backupService: {
					backup,
					discardBackup: vi.fn(async () => undefined),
				},
				logError,
			}),
		).rejects.toMatchObject({
			code: PLAIN_WORKING_COPY_BACKUP_FLUSH_FAILED,
			message: "Plain could not preserve every modified file. Try again.",
		});
		expect(copy.backup).toHaveBeenCalledTimes(4);
		expect(backup).not.toHaveBeenCalled();
		expect(logError).toHaveBeenCalledOnce();
	});

	it("blocks immediately when hot exit is disabled and leaves pending work untouched", async () => {
		const cancelPendingBackups = vi.fn();
		await expect(
			flushStableWorkingCopyBackups({
				modifiedWorkingCopies: [
					workingCopy(
						{ value: 1 },
						vi.fn(async () => ({
							content: undefined,
							meta: undefined,
						})),
					),
				],
				hotExitEnabled: false,
				cancelPendingBackups,
				getContentVersion: () => 1,
				backupService: {
					backup: vi.fn(),
					discardBackup: vi.fn(),
				},
				logError: vi.fn(),
			}),
		).rejects.toMatchObject({
			code: PLAIN_WORKING_COPY_BACKUP_FLUSH_FAILED,
		});
		expect(cancelPendingBackups).not.toHaveBeenCalled();
	});
});
