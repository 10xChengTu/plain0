import type {
	Unlisten,
	WorkspaceWatchPendingRoot,
	WorkspaceWatchSyncRequest,
	WorkspaceWatchSyncResult,
	WorkspaceWatchWakeEvent,
} from "./contracts";

export type {
	WorkspaceWatchPendingRoot,
	WorkspaceWatchSyncRequest,
	WorkspaceWatchSyncResult,
	WorkspaceWatchSyncRootRequest,
	WorkspaceWatchWakeEvent,
} from "./contracts";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_WORKSPACE_WATCH_GENERATION = 0xffff_ffff;

export type WorkspaceWatchListener = () => void | Promise<void>;

/**
 * The narrow, already-decoded transport used by one PlainBridge instance.
 * Wire validation and Tauri event decoding stay in the native/browser bridge.
 */
export interface WorkspaceWatcherTransport {
	listenWake(
		listener: (wake: WorkspaceWatchWakeEvent) => void,
	): Promise<Unlisten>;
	sync(request: WorkspaceWatchSyncRequest): Promise<WorkspaceWatchSyncResult>;
}

export interface WorkspaceWatcherClock {
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface WorkspaceWatcherPageLifecycle {
	addEventListener(type: "pagehide", listener: EventListener): void;
	removeEventListener(type: "pagehide", listener: EventListener): void;
}

export interface WorkspaceWatcherManagerOptions {
	readonly pollIntervalMs?: number;
	readonly clock?: WorkspaceWatcherClock;
	readonly pageLifecycle?: WorkspaceWatcherPageLifecycle | null;
}

export interface WorkspaceWatcherManager {
	reconcileRoots(rootIds: readonly string[]): void;
	workspaceWatch(rootId: string, listener: WorkspaceWatchListener): Unlisten;
	dispose(): Promise<void>;
}

interface Subscription {
	readonly listener: WorkspaceWatchListener;
	readonly cancelled: Promise<void>;
	cancel(): void;
	lastDeliveredGeneration: number;
}

interface RootSubscriptionState {
	readonly rootId: string;
	readonly subscriptions: Set<Subscription>;
	acknowledgedGeneration: number | null;
}

interface ScheduledPull {
	readonly handle: unknown;
	readonly urgent: boolean;
}

type DeliveryOutcome = "acknowledged" | "ignored" | "retry-now" | "retry-later";

const systemClock: WorkspaceWatcherClock = Object.freeze({
	setTimeout(callback: () => void, delayMs: number): unknown {
		return globalThis.setTimeout(callback, delayMs);
	},
	clearTimeout(handle: unknown): void {
		globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
	},
});

function defaultPageLifecycle(): WorkspaceWatcherPageLifecycle | undefined {
	return typeof window === "undefined" ? undefined : window;
}

function createSubscription(listener: WorkspaceWatchListener): Subscription {
	let active = true;
	let resolveCancelled!: () => void;
	const cancelled = new Promise<void>((resolve) => {
		resolveCancelled = resolve;
	});

	return {
		listener,
		cancelled,
		lastDeliveredGeneration: 0,
		cancel(): void {
			if (!active) {
				return;
			}
			active = false;
			resolveCancelled();
		},
	};
}

class PerBridgeWorkspaceWatcherManager implements WorkspaceWatcherManager {
	readonly #transport: WorkspaceWatcherTransport;
	readonly #clock: WorkspaceWatcherClock;
	readonly #pollIntervalMs: number;
	readonly #pageLifecycle: WorkspaceWatcherPageLifecycle | undefined;
	readonly #roots = new Map<string, RootSubscriptionState>();
	#authorizedRoots: ReadonlySet<string> = new Set();

	#scheduledPull: ScheduledPull | undefined;
	#syncInFlight = false;
	#pullRequested = false;
	#wakeUnlisten: Unlisten | undefined;
	#wakeListenPromise: Promise<void> | undefined;
	#unlistenBarrier: Promise<void> | undefined;
	#disposed = false;
	#disposePromise: Promise<void> | undefined;
	#workspaceId: string | undefined;

	readonly #onWake = (wake: WorkspaceWatchWakeEvent): void => {
		if (
			this.#workspaceId !== undefined &&
			wake.workspaceId !== this.#workspaceId
		) {
			return;
		}
		this.#schedulePull(true);
	};

	readonly #onPageHide: EventListener = (): void => {
		void this.dispose();
	};

	constructor(
		transport: WorkspaceWatcherTransport,
		options: WorkspaceWatcherManagerOptions,
	) {
		const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
			throw new TypeError("The workspace watcher poll interval is invalid.");
		}

		this.#transport = transport;
		this.#clock = options.clock ?? systemClock;
		this.#pollIntervalMs = pollIntervalMs;
		this.#pageLifecycle =
			options.pageLifecycle === undefined
				? defaultPageLifecycle()
				: (options.pageLifecycle ?? undefined);
		this.#pageLifecycle?.addEventListener("pagehide", this.#onPageHide);
	}

	readonly reconcileRoots = (rootIds: readonly string[]): void => {
		if (this.#disposed) {
			return;
		}
		const authorizedRoots = new Set<string>();
		for (const rootId of rootIds) {
			if (typeof rootId !== "string" || authorizedRoots.has(rootId)) {
				throw new TypeError("The workspace watcher root set is invalid.");
			}
			authorizedRoots.add(rootId);
		}
		this.#authorizedRoots = authorizedRoots;

		const revokedStates: RootSubscriptionState[] = [];
		for (const [rootId, state] of this.#roots) {
			if (authorizedRoots.has(rootId)) {
				continue;
			}
			this.#roots.delete(rootId);
			revokedStates.push(state);
		}
		for (const state of revokedStates) {
			for (const subscription of state.subscriptions) {
				subscription.cancel();
			}
			state.subscriptions.clear();
		}

		if (this.#roots.size === 0) {
			this.#pullRequested = false;
			this.#clearScheduledPull();
			void this.#detachWakeListener();
		} else if (revokedStates.length > 0) {
			this.#schedulePull(true);
		}
	};

	readonly workspaceWatch = (
		rootId: string,
		listener: WorkspaceWatchListener,
	): Unlisten => {
		if (this.#disposed) {
			throw new Error("The workspace watcher manager has been disposed.");
		}
		if (!this.#authorizedRoots.has(rootId)) {
			return () => {};
		}

		let state = this.#roots.get(rootId);
		if (state === undefined) {
			state = {
				rootId,
				acknowledgedGeneration: null,
				subscriptions: new Set(),
			};
			this.#roots.set(rootId, state);
		}

		const subscription = createSubscription(listener);
		subscription.lastDeliveredGeneration = state.acknowledgedGeneration ?? 0;
		state.subscriptions.add(subscription);
		this.#ensureWakeListener();
		this.#schedulePull(true);

		let listening = true;
		return (): void => {
			if (!listening) {
				return;
			}
			listening = false;
			subscription.cancel();
			state.subscriptions.delete(subscription);

			if (state.subscriptions.size === 0 && this.#roots.get(rootId) === state) {
				this.#roots.delete(rootId);
			}

			if (this.#roots.size === 0) {
				this.#pullRequested = false;
				this.#clearScheduledPull();
				void this.#detachWakeListener();
			}
		};
	};

	readonly dispose = (): Promise<void> => {
		if (this.#disposePromise !== undefined) {
			return this.#disposePromise;
		}

		this.#disposed = true;
		this.#pageLifecycle?.removeEventListener("pagehide", this.#onPageHide);
		this.#pullRequested = false;
		this.#clearScheduledPull();
		for (const state of this.#roots.values()) {
			for (const subscription of state.subscriptions) {
				subscription.cancel();
			}
		}
		this.#roots.clear();

		const initializing = this.#wakeListenPromise ?? Promise.resolve();
		const detaching = this.#detachWakeListener();
		this.#disposePromise = Promise.all([initializing, detaching]).then(
			async (): Promise<void> => {
				await this.#unlistenBarrier;
			},
		);
		return this.#disposePromise;
	};

	#ensureWakeListener(): void {
		if (
			this.#disposed ||
			this.#roots.size === 0 ||
			this.#wakeUnlisten !== undefined ||
			this.#wakeListenPromise !== undefined ||
			this.#unlistenBarrier !== undefined
		) {
			return;
		}

		let pendingUnlisten: Promise<Unlisten>;
		try {
			pendingUnlisten = this.#transport.listenWake(this.#onWake);
		} catch {
			this.#schedulePull(false);
			return;
		}

		let listenPromise!: Promise<void>;
		listenPromise = Promise.resolve(pendingUnlisten).then(
			async (unlisten): Promise<void> => {
				if (this.#wakeListenPromise === listenPromise) {
					this.#wakeListenPromise = undefined;
				}
				if (
					!this.#disposed &&
					this.#roots.size > 0 &&
					this.#wakeUnlisten === undefined &&
					this.#unlistenBarrier === undefined
				) {
					this.#wakeUnlisten = unlisten;
					return;
				}
				await this.#queueUnlisten(unlisten);
			},
			(): void => {
				if (this.#wakeListenPromise === listenPromise) {
					this.#wakeListenPromise = undefined;
				}
				this.#schedulePull(false);
			},
		);
		this.#wakeListenPromise = listenPromise;
	}

	#detachWakeListener(): Promise<void> {
		const unlisten = this.#wakeUnlisten;
		this.#wakeUnlisten = undefined;
		return unlisten === undefined
			? (this.#unlistenBarrier ?? Promise.resolve())
			: this.#queueUnlisten(unlisten);
	}

	#queueUnlisten(unlisten: Unlisten): Promise<void> {
		const previous = this.#unlistenBarrier ?? Promise.resolve();
		const current = previous
			.then(async (): Promise<void> => {
				await unlisten();
			})
			.catch((): void => undefined);
		this.#unlistenBarrier = current;
		void current.then((): void => {
			if (this.#unlistenBarrier !== current) {
				return;
			}
			this.#unlistenBarrier = undefined;
			this.#ensureWakeListener();
		});
		return current;
	}

	#schedulePull(urgent: boolean): void {
		if (this.#disposed || this.#roots.size === 0) {
			return;
		}
		if (this.#syncInFlight) {
			this.#pullRequested ||= urgent;
			return;
		}

		if (this.#scheduledPull !== undefined) {
			if (!urgent || this.#scheduledPull.urgent) {
				return;
			}
			this.#clock.clearTimeout(this.#scheduledPull.handle);
			this.#scheduledPull = undefined;
		}

		const scheduled: { handle?: unknown; readonly urgent: boolean } = {
			urgent,
		};
		scheduled.handle = this.#clock.setTimeout(
			(): void => {
				if (this.#scheduledPull !== scheduled) {
					return;
				}
				this.#scheduledPull = undefined;
				void this.#pull();
			},
			urgent ? 0 : this.#pollIntervalMs,
		);
		this.#scheduledPull = scheduled as ScheduledPull;
	}

	#clearScheduledPull(): void {
		if (this.#scheduledPull === undefined) {
			return;
		}
		this.#clock.clearTimeout(this.#scheduledPull.handle);
		this.#scheduledPull = undefined;
	}

	async #pull(): Promise<void> {
		if (this.#disposed || this.#roots.size === 0 || this.#syncInFlight) {
			return;
		}

		this.#ensureWakeListener();
		this.#syncInFlight = true;
		this.#pullRequested = false;
		const requestedStates = new Map(this.#roots);
		const roots = Object.freeze(
			Array.from(requestedStates.values(), (state) =>
				Object.freeze({
					rootId: state.rootId,
					acknowledgedGeneration: state.acknowledgedGeneration,
				}),
			),
		);
		const request = Object.freeze({ roots });

		let retryImmediately = false;
		try {
			const result = await this.#transport.sync(request);
			if (this.#workspaceId === undefined) {
				this.#workspaceId = result.workspaceId;
			} else if (result.workspaceId !== this.#workspaceId) {
				return;
			}
			const pendingByRoot = new Map<string, WorkspaceWatchPendingRoot>();
			for (const pending of result.roots) {
				if (!requestedStates.has(pending.rootId)) {
					continue;
				}
				const previous = pendingByRoot.get(pending.rootId);
				if (
					previous === undefined ||
					pending.generation > previous.generation
				) {
					pendingByRoot.set(
						pending.rootId,
						Object.freeze({
							rootId: pending.rootId,
							generation: pending.generation,
							rescanRequired:
								pending.rescanRequired || (previous?.rescanRequired ?? false),
						}),
					);
				} else if (pending.rescanRequired && !previous.rescanRequired) {
					pendingByRoot.set(
						pending.rootId,
						Object.freeze({ ...previous, rescanRequired: true }),
					);
				}
			}

			for (const pending of pendingByRoot.values()) {
				const state = requestedStates.get(pending.rootId);
				if (state === undefined || this.#roots.get(pending.rootId) !== state) {
					continue;
				}
				const outcome = await this.#deliver(state, pending);
				retryImmediately ||=
					outcome === "acknowledged" || outcome === "retry-now";
			}
		} catch {
			// Keep every acknowledgedGeneration unchanged. The low-frequency pull
			// retries both transport failures and rejected listeners.
		} finally {
			this.#syncInFlight = false;
			if (!this.#disposed && this.#roots.size > 0) {
				this.#ensureWakeListener();
				this.#schedulePull(this.#pullRequested || retryImmediately);
			}
		}
	}

	async #deliver(
		state: RootSubscriptionState,
		pending: WorkspaceWatchPendingRoot,
	): Promise<DeliveryOutcome> {
		const saturatedReplay =
			pending.generation === MAX_WORKSPACE_WATCH_GENERATION &&
			state.acknowledgedGeneration === MAX_WORKSPACE_WATCH_GENERATION &&
			pending.rescanRequired;
		if (
			pending.generation <= (state.acknowledgedGeneration ?? 0) &&
			!saturatedReplay
		) {
			return "ignored";
		}

		let listenerFailed = false;
		for (const subscription of Array.from(state.subscriptions)) {
			if (
				this.#roots.get(state.rootId) !== state ||
				!state.subscriptions.has(subscription) ||
				(subscription.lastDeliveredGeneration >= pending.generation &&
					!saturatedReplay)
			) {
				continue;
			}

			const delivery = Promise.resolve()
				.then(() => subscription.listener())
				.then(
					() => "delivered" as const,
					() => "failed" as const,
				);
			const outcome = await Promise.race([
				delivery,
				subscription.cancelled.then(() => "cancelled" as const),
			]);
			if (
				outcome === "delivered" &&
				this.#roots.get(state.rootId) === state &&
				state.subscriptions.has(subscription)
			) {
				subscription.lastDeliveredGeneration = pending.generation;
			} else if (
				outcome === "failed" &&
				this.#roots.get(state.rootId) === state &&
				state.subscriptions.has(subscription)
			) {
				listenerFailed = true;
			}
		}

		if (
			this.#roots.get(state.rootId) !== state ||
			state.subscriptions.size === 0
		) {
			return "ignored";
		}
		if (
			Array.from(state.subscriptions).every(
				(subscription) =>
					subscription.lastDeliveredGeneration >= pending.generation,
			)
		) {
			state.acknowledgedGeneration = pending.generation;
			return saturatedReplay ? "retry-later" : "acknowledged";
		}
		return listenerFailed ? "retry-later" : "retry-now";
	}
}

export function createWorkspaceWatcherManager(
	transport: WorkspaceWatcherTransport,
	options: WorkspaceWatcherManagerOptions = {},
): WorkspaceWatcherManager {
	return new PerBridgeWorkspaceWatcherManager(transport, options);
}
