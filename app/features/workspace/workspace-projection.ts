import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import type { IAnyWorkspaceIdentifier } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace";
import type { IWorkspaceProvider } from "@codingame/monaco-vscode-api/vscode/vs/workbench/browser/web.api";

import type { WorkspaceSnapshot } from "../../platform/tauri";
import { decodeWorkspaceSnapshot } from "../../platform/tauri/workspace-codec";

export const WORKSPACE_PROJECTION_CONFLICT =
	"WORKSPACE_PROJECTION_CONFLICT" as const;
export const WORKSPACE_PROJECTION_FAILED =
	"WORKSPACE_PROJECTION_FAILED" as const;

export class WorkspaceProjectionConflictError extends Error {
	readonly code = WORKSPACE_PROJECTION_CONFLICT;

	constructor() {
		super(
			"The native workspace topology conflicts with the visible workspace.",
		);
		this.name = "WorkspaceProjectionConflictError";
		Object.freeze(this);
	}
}

export class WorkspaceProjectionFailedError extends Error {
	readonly code = WORKSPACE_PROJECTION_FAILED;

	constructor() {
		super("The workspace view could not be updated. Reload Plain to continue.");
		this.name = "WorkspaceProjectionFailedError";
		Object.freeze(this);
	}
}

export interface WorkspaceConfigurationStore {
	install(snapshot: WorkspaceSnapshot): Readonly<{ configPath: URI }>;
	clear(): void;
}

export interface WorkspaceProjection {
	readonly provider: IWorkspaceProvider;
	readonly identifier: IAnyWorkspaceIdentifier;
}

export type ReinitializeWorkspace = (
	identifier: IAnyWorkspaceIdentifier,
) => Promise<void>;

export type ReconcileWorkspaceWatchRoots = (rootIds: readonly string[]) => void;

export type RefreshWorkspaceStoragePartition = () => Promise<void>;

export interface WorkbenchWorkspaceAdoption {
	readonly id: string;
	readonly configPath: URI | undefined;
	readonly rootUris: readonly string[];
}

export interface WorkspaceTopologyMutationResult<T> {
	readonly result: T;
	readonly snapshot: WorkspaceSnapshot | undefined;
}

export interface WorkspaceTopologyCoordinator {
	prepareInitial(snapshot: WorkspaceSnapshot): WorkspaceProjection;
	completeInitial(): Promise<IAnyWorkspaceIdentifier>;
	apply(snapshot: WorkspaceSnapshot): Promise<IAnyWorkspaceIdentifier>;
	runMutation<T>(
		mutation: () => Promise<WorkspaceTopologyMutationResult<T>>,
	): Promise<T>;
}

interface ProjectedState {
	readonly snapshot: WorkspaceSnapshot;
	readonly topologyKey: string;
	readonly projection: WorkspaceProjection;
}

const rejectWorkbenchWorkspaceOpen: IWorkspaceProvider["open"] = async () =>
	false;

function workspaceTopologyKey(snapshot: WorkspaceSnapshot): string {
	return JSON.stringify(
		snapshot.roots.map(({ rootId, displayName, uri }) => [
			rootId,
			displayName,
			uri,
		]),
	);
}

function projectDecodedSnapshot(
	snapshot: WorkspaceSnapshot,
	configurationStore: WorkspaceConfigurationStore,
): ProjectedState {
	const rootCount = snapshot.roots.length;
	let workspace: IWorkspaceProvider["workspace"];
	let identifier: IAnyWorkspaceIdentifier;
	if (rootCount === 0) {
		configurationStore.clear();
		workspace = undefined;
		identifier = Object.freeze({ id: snapshot.workspaceId });
	} else {
		const { configPath } = configurationStore.install(snapshot);
		workspace = Object.freeze({
			workspaceUri: configPath,
			id: snapshot.workspaceId,
		});
		identifier = Object.freeze({
			id: snapshot.workspaceId,
			configPath,
		});
	}

	return Object.freeze({
		snapshot,
		topologyKey: workspaceTopologyKey(snapshot),
		projection: Object.freeze({
			provider: Object.freeze({
				workspace,
				// Native directory authorization does not grant Git, PTY or DAP
				// process trust. Plain keeps execution trust in Rust.
				trusted: false,
				open: rejectWorkbenchWorkspaceOpen,
			}),
			identifier,
		}),
	});
}

export function projectWorkspaceSnapshot(
	snapshot: WorkspaceSnapshot,
	configurationStore: WorkspaceConfigurationStore,
): WorkspaceProjection {
	return projectDecodedSnapshot(
		decodeWorkspaceSnapshot(snapshot),
		configurationStore,
	).projection;
}

export function createWorkspaceTopologyCoordinator(
	configurationStore: WorkspaceConfigurationStore,
	reinitializeWorkspace: ReinitializeWorkspace,
	loadAuthoritativeSnapshot: () => Promise<WorkspaceSnapshot>,
	readWorkbenchAdoption: () => Promise<WorkbenchWorkspaceAdoption>,
	onReloadRequired: (error: WorkspaceProjectionFailedError) => void = () => {},
	reconcileWorkspaceWatchRoots: ReconcileWorkspaceWatchRoots = () => undefined,
	refreshWorkspaceStoragePartition: RefreshWorkspaceStoragePartition = async () =>
		undefined,
): WorkspaceTopologyCoordinator {
	let preparedInitial: ProjectedState | undefined;
	let current: ProjectedState | undefined;
	let initialCompleted = false;
	let fatalError: WorkspaceProjectionFailedError | undefined;
	let queueTail: Promise<void> = Promise.resolve();

	const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
		const pending = queueTail.then(task);
		queueTail = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	};

	const failPermanently = (): WorkspaceProjectionFailedError => {
		if (fatalError === undefined) {
			fatalError = new WorkspaceProjectionFailedError();
			current = undefined;
			try {
				onReloadRequired(fatalError);
			} catch {
				// A UI marker must never replace the stable projection failure.
			}
		}
		return fatalError;
	};

	const acceptWatcherAuthority = (projected: ProjectedState): void => {
		try {
			reconcileWorkspaceWatchRoots(
				Object.freeze(projected.snapshot.roots.map(({ rootId }) => rootId)),
			);
		} catch {
			throw failPermanently();
		}
	};

	const assertWorkbenchAdoption = async (
		projected: ProjectedState,
	): Promise<void> => {
		let adoption: WorkbenchWorkspaceAdoption;
		try {
			adoption = await readWorkbenchAdoption();
		} catch {
			throw failPermanently();
		}
		const expectedConfigPath =
			"configPath" in projected.projection.identifier
				? projected.projection.identifier.configPath.toString()
				: undefined;
		let adoptedConfigPath: string | undefined;
		try {
			adoptedConfigPath = adoption.configPath?.toString();
		} catch {
			throw failPermanently();
		}
		if (
			adoption.id !== projected.snapshot.workspaceId ||
			adoptedConfigPath !== expectedConfigPath ||
			adoption.rootUris.length !== projected.snapshot.roots.length ||
			adoption.rootUris.some(
				(uri, index) => uri !== projected.snapshot.roots[index]?.uri,
			)
		) {
			throw failPermanently();
		}
	};

	const assertCompatibleSnapshot = (
		candidate: WorkspaceSnapshot,
		candidateKey: string,
		failed: WorkspaceSnapshot,
		failedKey: string,
	): void => {
		if (
			current === undefined ||
			candidate.workspaceId !== current.snapshot.workspaceId ||
			candidate.revision < failed.revision
		) {
			throw failPermanently();
		}
		if (
			(candidate.revision === failed.revision && candidateKey !== failedKey) ||
			(candidate.revision === current.snapshot.revision &&
				candidateKey !== current.topologyKey)
		) {
			throw failPermanently();
		}
	};

	const reinitializeProjectedState = async (
		projected: ProjectedState,
	): Promise<IAnyWorkspaceIdentifier> => {
		if (fatalError !== undefined) {
			throw fatalError;
		}
		acceptWatcherAuthority(projected);
		try {
			await reinitializeWorkspace(projected.projection.identifier);
		} catch {
			// WorkspaceService.initialize can reject after partially updating its
			// in-memory workspace. Re-dispatch could then miss folder events, so
			// every post-dispatch failure is an outcome-unknown reload boundary.
			throw failPermanently();
		}
		await assertWorkbenchAdoption(projected);
		try {
			await refreshWorkspaceStoragePartition();
		} catch {
			// Workbench already adopted the new topology. Continuing with the old
			// Rust layout partition would cross-attach workspace state, so this is
			// the same outcome-unknown reload boundary as an adoption mismatch.
			throw failPermanently();
		}
		current = projected;
		return projected.projection.identifier;
	};

	const applyInQueue = async (
		snapshot: WorkspaceSnapshot,
	): Promise<IAnyWorkspaceIdentifier> => {
		if (fatalError !== undefined) {
			throw fatalError;
		}
		if (!initialCompleted || current === undefined) {
			throw new WorkspaceProjectionConflictError();
		}

		const decoded = decodeWorkspaceSnapshot(snapshot);
		if (decoded.workspaceId !== current.snapshot.workspaceId) {
			throw failPermanently();
		}
		if (decoded.revision < current.snapshot.revision) {
			throw new WorkspaceProjectionConflictError();
		}
		const decodedKey = workspaceTopologyKey(decoded);
		if (decoded.revision === current.snapshot.revision) {
			if (decodedKey === current.topologyKey) {
				return current.projection.identifier;
			}
			throw failPermanently();
		}

		let projected: ProjectedState;
		try {
			projected = projectDecodedSnapshot(decoded, configurationStore);
		} catch {
			let authoritativeSnapshot: WorkspaceSnapshot;
			let authoritativeKey: string;
			try {
				authoritativeSnapshot = decodeWorkspaceSnapshot(
					await loadAuthoritativeSnapshot(),
				);
				authoritativeKey = workspaceTopologyKey(authoritativeSnapshot);
				assertCompatibleSnapshot(
					authoritativeSnapshot,
					authoritativeKey,
					decoded,
					decodedKey,
				);
			} catch {
				throw failPermanently();
			}

			try {
				projected = projectDecodedSnapshot(
					authoritativeSnapshot,
					configurationStore,
				);
			} catch {
				throw failPermanently();
			}
		}
		return reinitializeProjectedState(projected);
	};

	const reconcileRejectedMutation = async (error: unknown): Promise<never> => {
		let authoritative: WorkspaceSnapshot;
		let authoritativeKey: string;
		try {
			authoritative = decodeWorkspaceSnapshot(
				await loadAuthoritativeSnapshot(),
			);
			authoritativeKey = workspaceTopologyKey(authoritative);
		} catch {
			throw failPermanently();
		}
		if (
			current === undefined ||
			authoritative.workspaceId !== current.snapshot.workspaceId ||
			authoritative.revision < current.snapshot.revision
		) {
			throw failPermanently();
		}
		if (authoritative.revision === current.snapshot.revision) {
			if (authoritativeKey !== current.topologyKey) {
				throw failPermanently();
			}
			throw error;
		}

		try {
			await applyInQueue(authoritative);
		} catch {
			throw failPermanently();
		}
		throw error;
	};

	const runMutationInQueue = async <T>(
		mutation: () => Promise<WorkspaceTopologyMutationResult<T>>,
	): Promise<T> => {
		if (fatalError !== undefined) {
			throw fatalError;
		}
		if (!initialCompleted || current === undefined) {
			throw new WorkspaceProjectionConflictError();
		}

		let result: T;
		let snapshot: WorkspaceSnapshot | undefined;
		try {
			const mutationResult = await mutation();
			result = mutationResult.result;
			snapshot = mutationResult.snapshot;
		} catch (error) {
			return reconcileRejectedMutation(error);
		}
		if (snapshot !== undefined) {
			await applyInQueue(snapshot);
		}
		return result;
	};

	return Object.freeze({
		prepareInitial(snapshot: WorkspaceSnapshot) {
			if (preparedInitial !== undefined || initialCompleted) {
				throw new WorkspaceProjectionConflictError();
			}
			const projected = projectDecodedSnapshot(
				decodeWorkspaceSnapshot(snapshot),
				configurationStore,
			);
			acceptWatcherAuthority(projected);
			preparedInitial = projected;
			return preparedInitial.projection;
		},
		completeInitial() {
			return enqueue(async () => {
				if (
					fatalError !== undefined ||
					preparedInitial === undefined ||
					initialCompleted
				) {
					throw fatalError ?? new WorkspaceProjectionConflictError();
				}
				const initial = preparedInitial;
				if (initial.snapshot.roots.length === 0) {
					try {
						await reinitializeWorkspace(initial.projection.identifier);
					} catch {
						throw failPermanently();
					}
				}
				await assertWorkbenchAdoption(initial);
				current = initial;
				initialCompleted = true;
				return initial.projection.identifier;
			});
		},
		apply(snapshot: WorkspaceSnapshot) {
			return enqueue(() => applyInQueue(snapshot));
		},
		runMutation<T>(
			mutation: () => Promise<WorkspaceTopologyMutationResult<T>>,
		) {
			return enqueue(() => runMutationInQueue(mutation));
		},
	});
}
