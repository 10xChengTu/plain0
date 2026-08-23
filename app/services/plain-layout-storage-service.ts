import type { StorageValue } from "@codingame/monaco-vscode-api/vscode/vs/base/parts/storage/common/storage";
import {
	InMemoryStorageService,
	IS_NEW_KEY,
	StorageScope,
	StorageTarget,
	WillSaveStateReason,
} from "@codingame/monaco-vscode-api/vscode/vs/platform/storage/common/storage";

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
		const snapshot = await this.#bridge.layoutRead();
		this.#workspaceAvailable = snapshot.workspaceAvailable;
		this.#seed(snapshot, false, true);
		this.#mutationGeneration += 1;
		this.#flushedGeneration = this.#mutationGeneration;
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
