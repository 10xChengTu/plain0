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
	applyPlainWorkspaceLayoutRuntime,
	PlainLayoutStorageService,
} from "../../app/services/plain-layout-storage-service";

const POSITION_LEFT = 0;
const POSITION_RIGHT = 1;
const POSITION_BOTTOM = 2;
const PART_SIDEBAR = "workbench.parts.sidebar";
const PART_PANEL = "workbench.parts.panel";
const VIEW_LOCATION_SIDEBAR = 0;
const VIEW_LOCATION_PANEL = 1;

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
	function runtime() {
		const layoutService = {
			centerMainEditorLayout: vi.fn(),
			getPanelPosition: vi.fn(() => POSITION_BOTTOM),
			getSideBarPosition: vi.fn(() => POSITION_RIGHT),
			isAuxiliaryBarMaximized: vi.fn(() => false),
			isPanelMaximized: vi.fn(() => false),
			isZenModeActive: vi.fn(() => false),
			setAuxiliaryBarMaximized: vi.fn(),
			setPanelPosition: vi.fn(),
			setPartHidden: vi.fn(),
			setSideBarPosition: vi.fn(),
			toggleMaximizedPanel: vi.fn(),
			toggleZenMode: vi.fn(),
		};
		const paneCompositePartService = {
			openPaneComposite: vi.fn(async () => undefined),
		};
		const setSideBarPositionContext = vi.fn();
		return {
			layoutService,
			paneCompositePartService,
			setSideBarPositionContext,
			value: {
				layoutService: layoutService as never,
				paneCompositePartService: paneCompositePartService as never,
				setSideBarPositionContext,
			},
		};
	}

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
		const workspaceRuntime = runtime();
		service.configureWorkspaceRuntime(workspaceRuntime.value);
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
		expect(
			workspaceRuntime.layoutService.setSideBarPosition,
		).toHaveBeenCalledWith(POSITION_LEFT);
		expect(workspaceRuntime.layoutService.setPartHidden).toHaveBeenCalledWith(
			false,
			PART_SIDEBAR,
		);
		service.dispose();
	});

	it("keeps the initial empty-to-workspace transition on Workbench startup defaults", async () => {
		const bridge = {
			layoutRead: vi.fn(async () => snapshot([], true)),
			layoutWrite: vi.fn(async () => undefined),
		};
		const service = new PlainLayoutStorageService(bridge, snapshot([], false));
		const workspaceRuntime = runtime();
		service.configureWorkspaceRuntime(workspaceRuntime.value);

		await service.applyCurrentWorkspaceRuntime();
		await service.switchWorkspacePartition();

		expect(bridge.layoutRead).toHaveBeenCalledOnce();
		expect(
			workspaceRuntime.layoutService.setSideBarPosition,
		).not.toHaveBeenCalled();
		service.dispose();
	});

	it("reapplies the hydrated active container after built-mode initialization", async () => {
		const service = new PlainLayoutStorageService(
			{
				layoutRead: vi.fn(),
				layoutWrite: vi.fn(async () => undefined),
			},
			snapshot([
				{
					scope: "workspace",
					key: "workbench.sidebar.activeviewletid",
					value: "workbench.view.search",
				},
			]),
		);
		const workspaceRuntime = runtime();
		service.configureWorkspaceRuntime(workspaceRuntime.value);

		await service.applyCurrentWorkspaceRuntime();

		expect(
			workspaceRuntime.paneCompositePartService.openPaneComposite,
		).toHaveBeenNthCalledWith(
			1,
			"workbench.view.search",
			VIEW_LOCATION_SIDEBAR,
			false,
		);
		service.dispose();
	});

	it("resets an empty workspace partition instead of inheriting live layout", async () => {
		const workspaceRuntime = runtime();
		await applyPlainWorkspaceLayoutRuntime(
			snapshot([], true),
			workspaceRuntime.value,
		);

		expect(
			workspaceRuntime.layoutService.setSideBarPosition,
		).toHaveBeenCalledWith(POSITION_LEFT);
		expect(workspaceRuntime.setSideBarPositionContext).toHaveBeenCalledWith(
			"left",
		);
		expect(
			workspaceRuntime.layoutService.setPanelPosition,
		).toHaveBeenCalledWith(POSITION_BOTTOM);
		expect(
			workspaceRuntime.paneCompositePartService.openPaneComposite,
		).toHaveBeenNthCalledWith(
			1,
			"workbench.view.explorer",
			VIEW_LOCATION_SIDEBAR,
			false,
		);
		expect(
			workspaceRuntime.paneCompositePartService.openPaneComposite,
		).toHaveBeenNthCalledWith(
			2,
			"plain.workbench.viewContainer.debugConsole",
			VIEW_LOCATION_PANEL,
			false,
		);
		expect(workspaceRuntime.layoutService.setPartHidden).toHaveBeenCalledWith(
			false,
			PART_SIDEBAR,
		);
		expect(workspaceRuntime.layoutService.setPartHidden).toHaveBeenCalledWith(
			true,
			PART_PANEL,
		);
	});

	it("projects only valid persisted positions and active containers", async () => {
		const workspaceRuntime = runtime();
		await applyPlainWorkspaceLayoutRuntime(
			snapshot([
				{
					scope: "workspace",
					key: "workbench.sideBar.position",
					value: "1",
				},
				{
					scope: "workspace",
					key: "workbench.sideBar.hidden",
					value: "true",
				},
				{
					scope: "workspace",
					key: "workbench.panel.hidden",
					value: "false",
				},
				{
					scope: "workspace",
					key: "workbench.sidebar.activeviewletid",
					value: "rogue.view",
				},
				{
					scope: "workspace",
					key: "workbench.panelpart.activepanelid",
					value: "plain.workbench.viewContainer.terminal",
				},
			]),
			workspaceRuntime.value,
		);

		expect(
			workspaceRuntime.layoutService.setSideBarPosition,
		).toHaveBeenCalledWith(POSITION_RIGHT);
		expect(workspaceRuntime.setSideBarPositionContext).toHaveBeenCalledWith(
			"right",
		);
		expect(
			workspaceRuntime.paneCompositePartService.openPaneComposite,
		).toHaveBeenNthCalledWith(
			1,
			"workbench.view.explorer",
			VIEW_LOCATION_SIDEBAR,
			false,
		);
		expect(
			workspaceRuntime.paneCompositePartService.openPaneComposite,
		).toHaveBeenNthCalledWith(
			2,
			"plain.workbench.viewContainer.terminal",
			VIEW_LOCATION_PANEL,
			false,
		);
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
