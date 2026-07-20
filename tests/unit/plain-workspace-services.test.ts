import { readFileSync } from "node:fs";

import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it } from "vitest";

import {
	PlainWorkspaceEditingService,
	PlainWorkspaceOperationUnsupportedError,
	PlainWorkspacesService,
	PLAIN_WORKSPACE_OPERATION_UNSUPPORTED,
} from "../../app/services/plain-workspace-services";

const privateUri = URI.file("/Users/private/secret-workspace");
const workspaceIdentifier = {
	id: "private-workspace-id",
	configPath: privateUri.with({
		path: `${privateUri.path}/secret.code-workspace`,
	}),
};

async function expectSanitizedFailure(operation: () => Promise<unknown>) {
	let failure: unknown;
	try {
		await operation();
	} catch (error) {
		failure = error;
	}

	expect(failure).toBeInstanceOf(PlainWorkspaceOperationUnsupportedError);
	expect(failure).toMatchObject({
		name: "PlainWorkspaceOperationUnsupportedError",
		code: PLAIN_WORKSPACE_OPERATION_UNSUPPORTED,
		message: "Plain does not expose generic workspace operations.",
	});
	expect(String(failure)).not.toContain("private");
	expect(String(failure)).not.toContain("secret");
}

describe("Plain workspace service boundaries", () => {
	it("rejects every generic workspace editing operation before side effects", async () => {
		const service = new PlainWorkspaceEditingService();
		expect(Object.isFrozen(service)).toBe(true);
		expect(Object.isFrozen(PlainWorkspaceEditingService.prototype)).toBe(true);
		const events: unknown[] = [];
		const listener = service.onDidEnterWorkspace((event: unknown) =>
			events.push(event),
		);
		const operations = [
			() => service.addFolders([{ uri: privateUri }]),
			() => service.removeFolders([privateUri]),
			() => service.updateFolders(0, 1, [{ uri: privateUri }]),
			() => service.enterWorkspace(privateUri),
			() => service.createAndEnterWorkspace([{ uri: privateUri }], privateUri),
			() => service.saveAndEnterWorkspace(privateUri),
			() => service.copyWorkspaceSettings(workspaceIdentifier),
			() => service.pickNewWorkspacePath(),
		];

		try {
			for (const operation of operations) {
				await expectSanitizedFailure(operation);
			}
			expect(events).toEqual([]);
		} finally {
			listener.dispose();
		}
	});

	it("keeps recent and dirty workspace state empty without inspecting mutations", async () => {
		const service = new PlainWorkspacesService();
		expect(Object.isFrozen(service)).toBe(true);
		expect(Object.isFrozen(PlainWorkspacesService.prototype)).toBe(true);
		const events: unknown[] = [];
		const listener = service.onDidChangeRecentlyOpened((event: unknown) =>
			events.push(event),
		);
		const hostileRecents = new Proxy([], {
			get() {
				throw new Error("recent input must remain unread");
			},
		});
		const hostileUris = new Proxy([], {
			get() {
				throw new Error("URI input must remain unread");
			},
		});

		try {
			await expect(
				service.addRecentlyOpened(hostileRecents),
			).resolves.toBeUndefined();
			await expect(
				service.removeRecentlyOpened(hostileUris),
			).resolves.toBeUndefined();
			await expect(service.clearRecentlyOpened()).resolves.toBeUndefined();

			const firstRecent = await service.getRecentlyOpened();
			firstRecent.workspaces.push({ folderUri: privateUri });
			expect(await service.getRecentlyOpened()).toEqual({
				workspaces: [],
				files: [],
			});

			const firstDirty = await service.getDirtyWorkspaces();
			firstDirty.push({ folderUri: privateUri });
			expect(await service.getDirtyWorkspaces()).toEqual([]);
			expect(events).toEqual([]);
		} finally {
			listener.dispose();
		}
	});

	it("rejects generic workspace lifecycle and identifier helpers", async () => {
		const service = new PlainWorkspacesService();
		for (const operation of [
			() => service.enterWorkspace(privateUri),
			() => service.createUntitledWorkspace([{ uri: privateUri }]),
			() => service.deleteUntitledWorkspace(workspaceIdentifier),
			() => service.getWorkspaceIdentifier(privateUri),
		]) {
			await expectSanitizedFailure(operation);
		}
	});

	it("overrides both configuration defaults with delayed Plain services", () => {
		const source = readFileSync(
			new URL("../../app/services.ts", import.meta.url),
			"utf8",
		);
		const configurationOverride = source.indexOf(
			"...getConfigurationServiceOverride(),",
		);
		const lastPackageOverride = source.indexOf(
			"...getTextmateServiceOverride(),",
		);
		const editingOverride = source.indexOf(
			"[IWorkspaceEditingService.toString()]",
		);
		const workspacesOverride = source.indexOf(
			"[IWorkspacesService.toString()]",
		);
		const dialogOverride = source.indexOf("[IDialogService.toString()]");

		expect(configurationOverride).toBeGreaterThanOrEqual(0);
		expect(lastPackageOverride).toBeGreaterThan(configurationOverride);
		expect(editingOverride).toBeGreaterThan(lastPackageOverride);
		expect(workspacesOverride).toBeGreaterThan(editingOverride);
		expect(dialogOverride).toBeGreaterThan(workspacesOverride);
		expect(source).toContain(
			`new SyncDescriptor(
			PlainWorkspaceEditingService,
			[],
			true,
		)`,
		);
		expect(source).toContain(
			`new SyncDescriptor(
			PlainWorkspacesService,
			[],
			true,
		)`,
		);
	});
});
