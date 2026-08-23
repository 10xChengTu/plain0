import type { StorageValue } from "@codingame/monaco-vscode-api/vscode/vs/base/parts/storage/common/storage";
import {
	InMemoryStorageService,
	IS_NEW_KEY,
	StorageScope,
	StorageTarget,
	WillSaveStateReason,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage";
import type {
	Parts,
	Position,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/layout/browser/layoutService";
import type { IWorkbenchLayoutService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/layout/browser/layoutService.service";
import type { IPaneCompositePartService } from "@codingame/monaco-vscode-api/vscode/vs/workbench/services/panecomposite/browser/panecomposite.service";
import type { ViewContainerLocation } from "@codingame/monaco-vscode-api/vscode/vs/workbench/common/views";

import type {
	LayoutStorageEntry,
	LayoutStorageScope,
	LayoutStorageSnapshot,
	PlainBridge,
} from "../platform/tauri/contracts";

const PROFILE_EXACT_KEYS = new Set([
	"views.customizations",
	"workbench.auxiliaryBar.empty",
	"workbench.auxiliaryBar.lastNonMaximizedSize",
	"workbench.auxiliaryBar.size",
	"workbench.panel.alignment",
	"workbench.panel.lastNonMaximizedHeight",
	"workbench.panel.lastNonMaximizedWidth",
	"workbench.panel.placeholderPanels",
	"workbench.panel.pinnedPanels",
	"workbench.panel.size",
	"workbench.sideBar.size",
	"workbench.activity.pinnedViewlets2",
	"workbench.activity.placeholderViewlets",
	"workbench.auxiliarybar.pinnedPanels",
	"workbench.auxiliarybar.placeholderPanels",
]);

const WORKSPACE_EXACT_KEYS = new Set([
	"workbench.activityBar.hidden",
	"workbench.auxiliaryBar.hidden",
	"workbench.auxiliaryBar.lastNonMaximizedVisibility",
	"workbench.auxiliaryBar.wasLastMaximized",
	"workbench.editor.centered",
	"workbench.editor.hidden",
	"workbench.panel.hidden",
	"workbench.panel.position",
	"workbench.panel.wasLastMaximized",
	"workbench.sideBar.hidden",
	"workbench.sideBar.position",
	"workbench.statusBar.hidden",
	"workbench.zenMode.active",
	"workbench.zenMode.exitInfo",
	"workbench.sidebar.activeviewletid",
	"workbench.panelpart.activepanelid",
	"workbench.auxiliarybar.activepanelid",
	"workbench.activity.viewletsWorkspaceState",
	"workbench.panel.viewContainersWorkspaceState",
	"workbench.auxiliarybar.viewContainersWorkspaceState",
]);

const VIEW_STORAGE_IDS = Object.freeze([
	"workbench.explorer.views.state",
	"workbench.view.search",
	"plain.workbench.viewContainer.scm",
	"plain.workbench.viewContainer.terminal",
	"plain.workbench.viewContainer.debug",
	"plain.workbench.viewContainer.debugConsole",
]);

const AUTO_FLUSH_DELAY_MS = 750;
const POSITION_LEFT = 0 as Position;
const POSITION_RIGHT = 1 as Position;
const POSITION_BOTTOM = 2 as Position;
const POSITION_TOP = 3 as Position;
const VIEW_LOCATION_SIDEBAR = 0 as ViewContainerLocation;
const VIEW_LOCATION_PANEL = 1 as ViewContainerLocation;
const PART_ACTIVITYBAR = "workbench.parts.activitybar" as Parts;
const PART_SIDEBAR = "workbench.parts.sidebar" as Parts;
const PART_PANEL = "workbench.parts.panel" as Parts;
const PART_AUXILIARYBAR = "workbench.parts.auxiliarybar" as Parts;
const PART_EDITOR = "workbench.parts.editor" as Parts;
const PART_STATUSBAR = "workbench.parts.statusbar" as Parts;

const DEFAULT_SIDEBAR_CONTAINER = "workbench.view.explorer";
const DEFAULT_PANEL_CONTAINER = "plain.workbench.viewContainer.debugConsole";
const SIDEBAR_CONTAINERS = new Set([
	DEFAULT_SIDEBAR_CONTAINER,
	"workbench.view.search",
	"plain.workbench.viewContainer.scm",
	"plain.workbench.viewContainer.debug",
]);
const PANEL_CONTAINERS = new Set([
	"plain.workbench.viewContainer.terminal",
	DEFAULT_PANEL_CONTAINER,
]);

type WorkspaceLayoutService = Pick<
	IWorkbenchLayoutService,
	| "centerMainEditorLayout"
	| "getPanelPosition"
	| "getSideBarPosition"
	| "isPanelMaximized"
	| "isAuxiliaryBarMaximized"
	| "setAuxiliaryBarMaximized"
	| "setPanelPosition"
	| "setPartHidden"
	| "toggleMaximizedPanel"
	| "toggleZenMode"
> & {
	readonly isZenModeActive: () => boolean;
	readonly setSideBarPosition: (position: Position) => void;
};

export interface PlainWorkspaceLayoutRuntime {
	readonly layoutService: IWorkbenchLayoutService;
	readonly paneCompositePartService: Pick<
		IPaneCompositePartService,
		"openPaneComposite"
	>;
	readonly setSideBarPositionContext: (position: "left" | "right") => void;
}

function workspaceEntryMap(
	snapshot: LayoutStorageSnapshot,
): ReadonlyMap<string, string> {
	return new Map(
		snapshot.entries
			.filter((entry) => entry.scope === "workspace")
			.map((entry) => [entry.key, entry.value]),
	);
}

function booleanEntry(
	entries: ReadonlyMap<string, string>,
	key: string,
	fallback: boolean,
): boolean {
	const value = entries.get(key);
	if (value === "true") return true;
	if (value === "false") return false;
	return fallback;
}

function positionEntry(
	entries: ReadonlyMap<string, string>,
	key: string,
	allowed: ReadonlySet<Position>,
	fallback: Position,
): Position {
	const value = Number(entries.get(key));
	return Number.isInteger(value) && allowed.has(value as Position)
		? (value as Position)
		: fallback;
}

function containerEntry(
	entries: ReadonlyMap<string, string>,
	key: string,
	allowed: ReadonlySet<string>,
	fallback: string,
): string {
	const value = entries.get(key);
	return value !== undefined && allowed.has(value) ? value : fallback;
}

/**
 * Projects the newly seeded workspace partition into the already-constructed
 * Workbench runtime. `reinitializeWorkspace()` only updates configuration and
 * folder context; without this projection, a fresh root set inherits the
 * previous workspace's live side bar, panel, and active containers even though
 * its Rust storage partition is empty.
 */
export async function applyPlainWorkspaceLayoutRuntime(
	snapshot: LayoutStorageSnapshot,
	runtime: PlainWorkspaceLayoutRuntime,
): Promise<void> {
	const layoutService =
		runtime.layoutService as unknown as WorkspaceLayoutService;
	const entries = workspaceEntryMap(snapshot);
	const sideBarPosition = positionEntry(
		entries,
		"workbench.sideBar.position",
		new Set([POSITION_LEFT, POSITION_RIGHT]),
		POSITION_LEFT,
	);
	const panelPosition = positionEntry(
		entries,
		"workbench.panel.position",
		new Set([POSITION_LEFT, POSITION_RIGHT, POSITION_BOTTOM, POSITION_TOP]),
		POSITION_BOTTOM,
	);
	const sideBarContainer = containerEntry(
		entries,
		"workbench.sidebar.activeviewletid",
		SIDEBAR_CONTAINERS,
		DEFAULT_SIDEBAR_CONTAINER,
	);
	const panelContainer = containerEntry(
		entries,
		"workbench.panelpart.activepanelid",
		PANEL_CONTAINERS,
		DEFAULT_PANEL_CONTAINER,
	);
	const desiredZenMode = booleanEntry(
		entries,
		"workbench.zenMode.active",
		false,
	);

	if (layoutService.isZenModeActive()) {
		layoutService.toggleZenMode();
	}
	layoutService.setSideBarPosition(sideBarPosition);
	runtime.setSideBarPositionContext(
		sideBarPosition === POSITION_RIGHT ? "right" : "left",
	);
	layoutService.setPanelPosition(panelPosition);
	await runtime.paneCompositePartService.openPaneComposite(
		sideBarContainer,
		VIEW_LOCATION_SIDEBAR,
		false,
	);
	await runtime.paneCompositePartService.openPaneComposite(
		panelContainer,
		VIEW_LOCATION_PANEL,
		false,
	);

	for (const [part, hidden, fallback] of [
		[PART_ACTIVITYBAR, "workbench.activityBar.hidden", false],
		[PART_SIDEBAR, "workbench.sideBar.hidden", false],
		[PART_PANEL, "workbench.panel.hidden", true],
		[PART_AUXILIARYBAR, "workbench.auxiliaryBar.hidden", true],
		[PART_EDITOR, "workbench.editor.hidden", false],
		[PART_STATUSBAR, "workbench.statusBar.hidden", false],
	] as const) {
		layoutService.setPartHidden(booleanEntry(entries, hidden, fallback), part);
	}
	layoutService.centerMainEditorLayout(
		booleanEntry(entries, "workbench.editor.centered", false),
	);
	const panelMaximized = booleanEntry(
		entries,
		"workbench.panel.wasLastMaximized",
		false,
	);
	if (layoutService.isPanelMaximized() !== panelMaximized) {
		layoutService.toggleMaximizedPanel();
	}
	layoutService.setAuxiliaryBarMaximized(
		booleanEntry(entries, "workbench.auxiliaryBar.wasLastMaximized", false),
	);
	if (desiredZenMode) layoutService.toggleZenMode();
}

function wireScope(scope: StorageScope): LayoutStorageScope | undefined {
	if (scope === StorageScope.PROFILE) return "profile";
	if (scope === StorageScope.WORKSPACE) return "workspace";
	return undefined;
}

function serviceScope(scope: LayoutStorageScope): StorageScope {
	return scope === "profile" ? StorageScope.PROFILE : StorageScope.WORKSPACE;
}

export function isPlainLayoutStorageKey(
	scope: LayoutStorageScope,
	key: string,
): boolean {
	const exact = scope === "profile" ? PROFILE_EXACT_KEYS : WORKSPACE_EXACT_KEYS;
	if (exact.has(key)) return true;
	return VIEW_STORAGE_IDS.some((storageId) =>
		scope === "profile"
			? key === `${storageId}.hidden`
			: key === storageId || key === `${storageId}.numberOfVisibleViews`,
	);
}

function identity(scope: LayoutStorageScope, key: string): string {
	return `${scope}\0${key}`;
}

/**
 * Keeps the ordinary Workbench storage API synchronous while making only its
 * audited layout subset durable through Rust. All unrelated keys remain in
 * the inherited in-memory store and can never cross the layout IPC boundary.
 */
export class PlainLayoutStorageService extends InMemoryStorageService {
	readonly #bridge: Pick<PlainBridge, "layoutRead" | "layoutWrite">;
	readonly #persisted = new Map<string, LayoutStorageEntry>();
	#workspaceAvailable: boolean;
	#mutationGeneration = 0;
	#flushedGeneration = 0;
	#writeTail: Promise<void> = Promise.resolve();
	#flushTimer: ReturnType<typeof setTimeout> | undefined;
	#seeding = false;
	#workspaceRuntime: PlainWorkspaceLayoutRuntime | undefined;

	constructor(
		bridge: Pick<PlainBridge, "layoutRead" | "layoutWrite">,
		snapshot: LayoutStorageSnapshot,
	) {
		super();
		this.#bridge = bridge;
		this.#workspaceAvailable = snapshot.workspaceAvailable;
		this.#seed(snapshot, true, true);
	}

	override store(
		key: string,
		value: StorageValue,
		scope: StorageScope,
		target: StorageTarget,
		external?: boolean,
	): void {
		super.store(key, value, scope, target, external);
		const persistedScope = wireScope(scope);
		if (
			this.#seeding ||
			persistedScope === undefined ||
			!isPlainLayoutStorageKey(persistedScope, key)
		) {
			return;
		}
		const stored = super.get(key, scope);
		if (stored === undefined) return;
		this.#persisted.set(
			identity(persistedScope, key),
			Object.freeze({ scope: persistedScope, key, value: stored }),
		);
		this.#markDirty();
	}

	override remove(key: string, scope: StorageScope, external?: boolean): void {
		super.remove(key, scope, external);
		const persistedScope = wireScope(scope);
		if (
			this.#seeding ||
			persistedScope === undefined ||
			!isPlainLayoutStorageKey(persistedScope, key)
		) {
			return;
		}
		this.#persisted.delete(identity(persistedScope, key));
		this.#markDirty();
	}

	override async flush(
		reason: WillSaveStateReason = WillSaveStateReason.NONE,
	): Promise<void> {
		await super.flush(reason);
		if (this.#flushTimer !== undefined) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = undefined;
		}
		const generation = this.#mutationGeneration;
		if (generation <= this.#flushedGeneration) {
			await this.#writeTail;
			return;
		}
		const entries = Object.freeze(
			[...this.#persisted.values()]
				.filter(
					(entry) => entry.scope === "profile" || this.#workspaceAvailable,
				)
				.sort(
					(left, right) =>
						left.scope.localeCompare(right.scope) ||
						left.key.localeCompare(right.key),
				),
		);
		const write = this.#writeTail
			.catch(() => undefined)
			.then(() => this.#bridge.layoutWrite(entries));
		this.#writeTail = write;
		await write;
		this.#flushedGeneration = Math.max(this.#flushedGeneration, generation);
		if (this.#mutationGeneration > this.#flushedGeneration)
			this.#scheduleFlush();
	}

	protected override async switchToWorkspace(): Promise<void> {
		await this.switchWorkspacePartition();
	}

	async switchWorkspacePartition(): Promise<void> {
		if (this.#flushTimer !== undefined) {
			clearTimeout(this.#flushTimer);
			this.#flushTimer = undefined;
		}
		const previousWorkspaceAvailable = this.#workspaceAvailable;
		const snapshot = await this.#bridge.layoutRead();
		this.#workspaceAvailable = snapshot.workspaceAvailable;
		this.#seed(snapshot, false, true);
		if (
			this.#workspaceRuntime !== undefined &&
			(previousWorkspaceAvailable || !snapshot.workspaceAvailable)
		) {
			await applyPlainWorkspaceLayoutRuntime(snapshot, this.#workspaceRuntime);
		}
		this.#mutationGeneration += 1;
		this.#flushedGeneration = this.#mutationGeneration;
	}

	configureWorkspaceRuntime(runtime: PlainWorkspaceLayoutRuntime): void {
		this.#workspaceRuntime = runtime;
	}

	override dispose(): void {
		if (this.#flushTimer !== undefined) clearTimeout(this.#flushTimer);
		super.dispose();
	}

	#seed(
		snapshot: LayoutStorageSnapshot,
		includeProfile: boolean,
		includeWorkspace: boolean,
	): void {
		this.#seeding = true;
		try {
			for (const scope of ["profile", "workspace"] as const) {
				if (
					(scope === "profile" && !includeProfile) ||
					(scope === "workspace" && !includeWorkspace)
				) {
					continue;
				}
				for (const entry of this.#persisted.values()) {
					if (entry.scope !== scope) continue;
					super.remove(entry.key, serviceScope(scope));
					this.#persisted.delete(identity(scope, entry.key));
				}
				const entries = snapshot.entries.filter(
					(entry) =>
						entry.scope === scope && isPlainLayoutStorageKey(scope, entry.key),
				);
				for (const entry of entries) {
					super.store(
						entry.key,
						entry.value,
						serviceScope(scope),
						StorageTarget.MACHINE,
					);
					this.#persisted.set(identity(scope, entry.key), entry);
				}
				super.store(
					IS_NEW_KEY,
					entries.length === 0,
					serviceScope(scope),
					StorageTarget.MACHINE,
				);
			}
		} finally {
			this.#seeding = false;
		}
	}

	#markDirty(): void {
		this.#mutationGeneration += 1;
		this.#scheduleFlush();
	}

	#scheduleFlush(): void {
		if (this.#flushTimer !== undefined) clearTimeout(this.#flushTimer);
		this.#flushTimer = setTimeout(() => {
			this.#flushTimer = undefined;
			void this.flush().catch(() => undefined);
		}, AUTO_FLUSH_DELAY_MS);
	}
}
