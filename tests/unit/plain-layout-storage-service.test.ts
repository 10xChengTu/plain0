import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import {
	StorageScope,
	StorageTarget,
	WillSaveStateReason,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage";
import { describe, expect, it, vi } from "vitest";

import type {
	LayoutStorageEntry,
	LayoutStorageSnapshot,
} from "../../app/platform/tauri/contracts";
import {
	isPlainLayoutStorageKey,
	PlainLayoutStorageService,
} from "../../app/services/plain-layout-storage-service";

function snapshot(
	entries: readonly LayoutStorageEntry[],
	workspaceAvailable = true,
): LayoutStorageSnapshot {
	return Object.freeze({
		workspaceAvailable,
		entries: Object.freeze([...entries]),
	});
}

describe("PlainLayoutStorageService", () => {
	it("hydrates before use and flushes only the audited layout subset", async () => {
		const writes: readonly LayoutStorageEntry[][] = [];
		const bridge = {
			layoutRead: vi.fn(),
			layoutWrite: vi.fn(async (entries: readonly LayoutStorageEntry[]) => {
				(writes as LayoutStorageEntry[][]).push([...entries]);
			}),
		};
		const service = new PlainLayoutStorageService(
			bridge,
			snapshot([
				{ scope: "profile", key: "workbench.sideBar.size", value: "318" },
				{
					scope: "workspace",
					key: "workbench.sideBar.hidden",
					value: "true",
				},
			]),
		);
		expect(
			service.getNumber("workbench.sideBar.size", StorageScope.PROFILE),
		).toBe(318);
		expect(
			service.getBoolean("workbench.sideBar.hidden", StorageScope.WORKSPACE),
		).toBe(true);

		service.store(
			"workbench.panel.hidden",
			false,
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
		service.store(
			"history.entries",
			"secret-history",
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
		service.store(
			"authentication.session",
			"secret-session",
			StorageScope.PROFILE,
			StorageTarget.MACHINE,
		);
		await service.flush(WillSaveStateReason.SHUTDOWN);

		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual([
			{ scope: "profile", key: "workbench.sideBar.size", value: "318" },
			{
				scope: "workspace",
				key: "workbench.panel.hidden",
				value: "false",
			},
			{
				scope: "workspace",
				key: "workbench.sideBar.hidden",
				value: "true",
			},
		]);
		service.dispose();
	});

	it("switches workspace storage from Rust without cross-attaching old keys", async () => {
		const bridge = {
			layoutRead: vi.fn(async () =>
				snapshot([
					{
						scope: "workspace",
						key: "workbench.sideBar.hidden",
						value: "false",
					},
				]),
			),
			layoutWrite: vi.fn(async () => undefined),
		};
		const service = new PlainLayoutStorageService(
			bridge,
			snapshot([
				{
					scope: "workspace",
					key: "workbench.sideBar.hidden",
					value: "true",
				},
			]),
		);
		await service.switch(
			{
				id: "00000000-0000-4000-8000-000000000001",
				configPath: URI.parse(
					"plain-workspace-config://workspace/workspace.code-workspace",
				),
			},
			false,
		);
		expect(bridge.layoutRead).toHaveBeenCalledOnce();
		expect(
			service.getBoolean("workbench.sideBar.hidden", StorageScope.WORKSPACE),
		).toBe(false);
		service.dispose();
	});

	it("keeps the TypeScript allowlist scope-specific", () => {
		expect(isPlainLayoutStorageKey("profile", "views.customizations")).toBe(
			true,
		);
		expect(
			isPlainLayoutStorageKey("workspace", "workbench.sideBar.hidden"),
		).toBe(true);
		expect(isPlainLayoutStorageKey("profile", "workbench.sideBar.hidden")).toBe(
			false,
		);
		expect(isPlainLayoutStorageKey("workspace", "history.entries")).toBe(false);
	});
});
