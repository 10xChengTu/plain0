import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	createWorkspaceTopologyCoordinator,
	projectWorkspaceSnapshot,
	WORKSPACE_PROJECTION_CONFLICT,
	WORKSPACE_PROJECTION_FAILED,
	type WorkspaceConfigurationStore,
} from "../../app/features/workspace/workspace-projection";
import type {
	WorkspaceRoot,
	WorkspaceSnapshot,
} from "../../app/platform/tauri/contracts";
import { frozenWorkspaceSnapshot } from "../../app/platform/tauri/workspace-codec";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const firstRoot = Object.freeze({
	rootId: "00000000-0000-4000-8000-000000000101",
	displayName: "plain-workspace",
	uri: "plain-workspace://00000000-0000-4000-8000-000000000101/",
}) satisfies WorkspaceRoot;
const secondRoot = Object.freeze({
	rootId: "00000000-0000-4000-8000-000000000102",
	displayName: "plain-library",
	uri: "plain-workspace://00000000-0000-4000-8000-000000000102/",
}) satisfies WorkspaceRoot;

function snapshot(
	revision: number,
	roots: readonly WorkspaceRoot[],
): WorkspaceSnapshot {
	return frozenWorkspaceSnapshot(workspaceId, revision, roots);
}

function configurationStore() {
	const configPath = URI.parse(
		`plain-workspace-config://${workspaceId}/workspace.code-workspace`,
		true,
	);
	const state: { installed: WorkspaceSnapshot | undefined } = {
		installed: undefined,
	};
	return {
		configPath,
		state,
		store: {
			install: vi.fn((installed: WorkspaceSnapshot) => {
				state.installed = installed;
				return Object.freeze({ configPath });
			}),
			clear: vi.fn(() => {
				state.installed = undefined;
			}),
		} satisfies WorkspaceConfigurationStore,
	};
}

function readAdoption(harness: ReturnType<typeof configurationStore>) {
	return vi.fn(async () =>
		Object.freeze({
			id: workspaceId,
			configPath:
				harness.state.installed === undefined ? undefined : harness.configPath,
			rootUris: Object.freeze(
				harness.state.installed?.roots.map(({ uri }) => uri) ?? [],
			),
		}),
	);
}

describe("workspace projection", () => {
	it("projects zero roots as EMPTY and clears stale generated configuration", async () => {
		const { store } = configurationStore();
		const projection = projectWorkspaceSnapshot(snapshot(0, []), store);

		expect(store.clear).toHaveBeenCalledOnce();
		expect(store.install).not.toHaveBeenCalled();
		expect(projection.provider.workspace).toBeUndefined();
		expect(projection.provider.trusted).toBe(false);
		expect(projection.identifier).toEqual({ id: workspaceId });
		expect(Object.isFrozen(projection)).toBe(true);
		expect(Object.isFrozen(projection.provider)).toBe(true);
		expect(Object.isFrozen(projection.identifier)).toBe(true);
		expect(await projection.provider.open(undefined)).toBe(false);
	});

	it("projects every non-empty snapshot through one stable virtual workspace", async () => {
		const { store, configPath } = configurationStore();
		for (const roots of [[firstRoot], [firstRoot, secondRoot]]) {
			const projection = projectWorkspaceSnapshot(snapshot(1, roots), store);
			const workspace = projection.provider.workspace;

			expect(workspace).toEqual({ workspaceUri: configPath, id: workspaceId });
			expect(projection.identifier).toEqual({
				id: workspaceId,
				configPath,
			});
			expect(projection.provider.trusted).toBe(false);
			expect(Object.isFrozen(workspace)).toBe(true);
			expect(await projection.provider.open(workspace)).toBe(false);
		}
		expect(store.install).toHaveBeenCalledTimes(2);
	});

	it("projects the maximum strict snapshot without truncating roots", () => {
		const { store } = configurationStore();
		const roots = Array.from({ length: 256 }, (_, index) => {
			const suffix = (index + 1).toString(16).padStart(12, "0");
			const rootId = `00000000-0000-4000-8000-${suffix}`;
			return Object.freeze({
				rootId,
				displayName: `root-${index + 1}`,
				uri: `plain-workspace://${rootId}/`,
			});
		});

		projectWorkspaceSnapshot(snapshot(1, roots), store);
		expect(store.install).toHaveBeenCalledOnce();
		expect(store.install.mock.calls[0]?.[0].roots).toHaveLength(256);
	});

	it("revalidates the strict snapshot contract before touching configuration", () => {
		const { store } = configurationStore();
		const malformed = {
			workspaceId,
			revision: 1,
			roots: [{ ...firstRoot, uri: `${firstRoot.uri}?native=/private` }],
		} as WorkspaceSnapshot;

		expect(() => projectWorkspaceSnapshot(malformed, store)).toThrowError(
			expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
		);
		expect(store.install).not.toHaveBeenCalled();
		expect(store.clear).not.toHaveBeenCalled();
	});
});

describe("workspace topology coordinator", () => {
	it("accepts a non-empty initial projection only after Workbench adoption", async () => {
		const harness = configurationStore();
		const reinitialize = vi.fn(async () => {});
		const adoption = readAdoption(harness);
		const reconcileWatchRoots = vi.fn();
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(0, [firstRoot])),
			adoption,
			vi.fn(),
			reconcileWatchRoots,
		);

		const projection = coordinator.prepareInitial(snapshot(0, [firstRoot]));
		expect(reconcileWatchRoots).toHaveBeenCalledExactlyOnceWith([
			firstRoot.rootId,
		]);
		expect(Object.isFrozen(reconcileWatchRoots.mock.calls[0]![0])).toBe(true);
		await expect(coordinator.completeInitial()).resolves.toBe(
			projection.identifier,
		);
		expect(reinitialize).not.toHaveBeenCalled();
		expect(adoption).toHaveBeenCalledOnce();
	});

	it("reinitializes an empty initial projection and verifies EMPTY adoption", async () => {
		const harness = configurationStore();
		const reinitialize = vi.fn(async () => {});
		const adoption = readAdoption(harness);
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(0, [])),
			adoption,
		);

		const projection = coordinator.prepareInitial(snapshot(0, []));
		await coordinator.completeInitial();
		expect(reinitialize).toHaveBeenCalledExactlyOnceWith(projection.identifier);
		expect(adoption).toHaveBeenCalledOnce();
		expect(projection.identifier).toEqual({ id: workspaceId });
	});

	it("projects removal of the final root as EMPTY without restoring a root", async () => {
		const harness = configurationStore();
		const initial = snapshot(0, [firstRoot]);
		const empty = snapshot(1, []);
		const load = vi.fn(async () => empty);
		const reinitialize = vi.fn(async () => {});
		const adoption = readAdoption(harness);
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			load,
			adoption,
		);
		coordinator.prepareInitial(initial);
		await coordinator.completeInitial();

		await expect(
			coordinator.runMutation(async () =>
				Object.freeze({ result: empty, snapshot: empty }),
			),
		).resolves.toBe(empty);

		expect(harness.store.clear).toHaveBeenCalledOnce();
		expect(harness.store.install).toHaveBeenCalledExactlyOnceWith(initial);
		expect(harness.state.installed).toBeUndefined();
		expect(reinitialize).toHaveBeenCalledExactlyOnceWith({ id: workspaceId });
		expect(adoption).toHaveBeenCalledTimes(2);
		await expect(adoption.mock.results[1]?.value).resolves.toEqual({
			id: workspaceId,
			configPath: undefined,
			rootUris: [],
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("serializes bytes, reinitialize and adoption in exact revision order", async () => {
		const harness = configurationStore();
		const releases: Array<() => void> = [];
		const seenRevisions: number[] = [];
		const reinitialize = vi.fn(async () => {
			seenRevisions.push(harness.state.installed?.revision ?? -1);
			await new Promise<void>((resolve) => releases.push(resolve));
		});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(2, [secondRoot])),
			readAdoption(harness),
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		const first = coordinator.apply(snapshot(1, [firstRoot, secondRoot]));
		const second = coordinator.apply(snapshot(2, [secondRoot]));
		await vi.waitFor(() => expect(reinitialize).toHaveBeenCalledTimes(1));
		expect(seenRevisions).toEqual([1]);
		expect(harness.state.installed?.revision).toBe(1);
		releases.shift()?.();
		await first;
		await vi.waitFor(() => expect(reinitialize).toHaveBeenCalledTimes(2));
		expect(seenRevisions).toEqual([1, 2]);
		expect(harness.state.installed?.revision).toBe(2);
		releases.shift()?.();
		await second;
	});

	it("serializes native mutations with their complete snapshot projections", async () => {
		const harness = configurationStore();
		const releases: Array<() => void> = [];
		const calls: string[] = [];
		const reinitialize = vi.fn(async () => {
			calls.push(`project-${harness.state.installed?.revision}`);
			await new Promise<void>((resolve) => releases.push(resolve));
		});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(2, [secondRoot])),
			readAdoption(harness),
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		const first = coordinator.runMutation(async () => {
			calls.push("native-1");
			return Object.freeze({
				result: "first",
				snapshot: snapshot(1, [firstRoot, secondRoot]),
			});
		});
		const second = coordinator.runMutation(async () => {
			calls.push("native-2");
			return Object.freeze({
				result: "second",
				snapshot: snapshot(2, [secondRoot]),
			});
		});

		await vi.waitFor(() => expect(reinitialize).toHaveBeenCalledTimes(1));
		expect(calls).toEqual(["native-1", "project-1"]);
		releases.shift()?.();
		await expect(first).resolves.toBe("first");
		await vi.waitFor(() => expect(reinitialize).toHaveBeenCalledTimes(2));
		expect(calls).toEqual(["native-1", "project-1", "native-2", "project-2"]);
		releases.shift()?.();
		await expect(second).resolves.toBe("second");
	});

	it("preserves a rejected mutation error after authority proves no topology change", async () => {
		const harness = configurationStore();
		const initial = snapshot(0, [firstRoot]);
		const load = vi.fn(async () => initial);
		const reinitialize = vi.fn(async () => {});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			load,
			readAdoption(harness),
		);
		coordinator.prepareInitial(initial);
		await coordinator.completeInitial();
		const responseError = Object.freeze({ code: "IPC_RESPONSE_UNAVAILABLE" });

		await expect(
			coordinator.runMutation(async () => Promise.reject(responseError)),
		).rejects.toBe(responseError);
		expect(load).toHaveBeenCalledOnce();
		expect(reinitialize).not.toHaveBeenCalled();
		await expect(
			coordinator.runMutation(async () =>
				Object.freeze({ result: "still-usable", snapshot: undefined }),
			),
		).resolves.toBe("still-usable");
	});

	it("converges to newer authority before reporting a rejected mutation response", async () => {
		const harness = configurationStore();
		const initial = snapshot(0, [firstRoot]);
		const authoritative = snapshot(1, [firstRoot, secondRoot]);
		const load = vi.fn(async () => authoritative);
		const reinitialize = vi.fn(async () => {});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			load,
			readAdoption(harness),
		);
		coordinator.prepareInitial(initial);
		await coordinator.completeInitial();
		const responseError = Object.freeze({ code: "IPC_CONTRACT_VIOLATION" });

		await expect(
			coordinator.runMutation(async () => Promise.reject(responseError)),
		).rejects.toBe(responseError);
		expect(load).toHaveBeenCalledOnce();
		expect(reinitialize).toHaveBeenCalledOnce();
		expect(harness.state.installed?.revision).toBe(1);
		await expect(coordinator.apply(authoritative)).resolves.toMatchObject({
			id: workspaceId,
		});
		expect(reinitialize).toHaveBeenCalledOnce();
	});

	it("locks permanently when a rejected mutation cannot be reconciled", async () => {
		const harness = configurationStore();
		const onReloadRequired = vi.fn();
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			vi.fn(async () => {}),
			vi.fn(async () => Promise.reject(new Error("private snapshot failure"))),
			readAdoption(harness),
			onReloadRequired,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		await expect(
			coordinator.runMutation(async () =>
				Promise.reject(new Error("private response failure")),
			),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_FAILED });
		expect(onReloadRequired).toHaveBeenCalledOnce();
		const forbiddenMutation = vi.fn(async () =>
			Object.freeze({ result: undefined, snapshot: undefined }),
		);
		await expect(
			coordinator.runMutation(forbiddenMutation),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_FAILED });
		expect(forbiddenMutation).not.toHaveBeenCalled();
	});

	it("deduplicates identical revisions without reinstall and rejects stale responses", async () => {
		const harness = configurationStore();
		const reinitialize = vi.fn(async () => {});
		const reconcileWatchRoots = vi.fn();
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(1, [firstRoot, secondRoot])),
			readAdoption(harness),
			vi.fn(),
			reconcileWatchRoots,
		);
		coordinator.prepareInitial(snapshot(1, [firstRoot, secondRoot]));
		await coordinator.completeInitial();
		const installsAfterInitial = harness.store.install.mock.calls.length;

		await coordinator.apply(snapshot(1, [firstRoot, secondRoot]));
		expect(harness.store.install).toHaveBeenCalledTimes(installsAfterInitial);
		expect(reinitialize).not.toHaveBeenCalled();
		expect(reconcileWatchRoots).toHaveBeenCalledOnce();
		await expect(
			coordinator.apply(snapshot(0, [firstRoot])),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_CONFLICT });
		expect(reinitialize).not.toHaveBeenCalled();
		expect(reconcileWatchRoots).toHaveBeenCalledOnce();
	});

	it("applies a queued newer revision and then rejects an older late response", async () => {
		const harness = configurationStore();
		const reinitialize = vi.fn(async () => {});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => snapshot(2, [secondRoot])),
			readAdoption(harness),
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		const newer = coordinator.apply(snapshot(2, [secondRoot]));
		const older = coordinator.apply(snapshot(1, [firstRoot, secondRoot]));
		await expect(newer).resolves.toMatchObject({ id: workspaceId });
		await expect(older).rejects.toMatchObject({
			code: WORKSPACE_PROJECTION_CONFLICT,
		});
		expect(reinitialize).toHaveBeenCalledOnce();
		expect(harness.state.installed?.revision).toBe(2);
	});

	it("reloads authoritative Rust state only after pre-dispatch install failure", async () => {
		const harness = configurationStore();
		const next = snapshot(1, [firstRoot, secondRoot]);
		let rejectedInstall = false;
		harness.store.install.mockImplementation((installed) => {
			if (installed.revision === 1 && !rejectedInstall) {
				rejectedInstall = true;
				throw new Error("private install failure");
			}
			harness.state.installed = installed;
			return Object.freeze({ configPath: harness.configPath });
		});
		const reinitialize = vi.fn(async () => {});
		const load = vi.fn(async () => next);
		const reconcileWatchRoots = vi.fn();
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			load,
			readAdoption(harness),
			vi.fn(),
			reconcileWatchRoots,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		await expect(coordinator.apply(next)).resolves.toMatchObject({
			id: workspaceId,
		});
		expect(load).toHaveBeenCalledOnce();
		expect(reinitialize).toHaveBeenCalledOnce();
		expect(reconcileWatchRoots.mock.calls).toEqual([
			[[firstRoot.rootId]],
			[[firstRoot.rootId, secondRoot.rootId]],
		]);
	});

	it("treats reinitialize rejection as outcome unknown without retry", async () => {
		const harness = configurationStore();
		const next = snapshot(1, [firstRoot, secondRoot]);
		const authorityOrder: string[] = [];
		const reinitialize = vi.fn(async () => {
			authorityOrder.push("dispatch");
			throw new Error("private partial failure");
		});
		const load = vi.fn(async () => next);
		const onReloadRequired = vi.fn();
		const reconcileWatchRoots = vi.fn((rootIds: readonly string[]) => {
			authorityOrder.push(`authority:${rootIds.join(",")}`);
		});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			load,
			readAdoption(harness),
			onReloadRequired,
			reconcileWatchRoots,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();
		authorityOrder.length = 0;

		await expect(coordinator.apply(next)).rejects.toMatchObject({
			code: WORKSPACE_PROJECTION_FAILED,
			message: expect.not.stringContaining("private partial failure"),
		});
		expect(onReloadRequired).toHaveBeenCalledOnce();
		expect(reinitialize).toHaveBeenCalledOnce();
		expect(load).not.toHaveBeenCalled();
		expect(harness.state.installed?.revision).toBe(1);
		expect(authorityOrder).toEqual([
			`authority:${firstRoot.rootId},${secondRoot.rootId}`,
			"dispatch",
		]);

		await expect(
			coordinator.apply(snapshot(2, [secondRoot])),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_FAILED });
		const forbiddenMutation = vi.fn(async () =>
			Object.freeze({
				result: undefined,
				snapshot: snapshot(2, [secondRoot]),
			}),
		);
		await expect(
			coordinator.runMutation(forbiddenMutation),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_FAILED });
		expect(forbiddenMutation).not.toHaveBeenCalled();
		expect(reinitialize).toHaveBeenCalledOnce();
		expect(load).not.toHaveBeenCalled();
	});

	it("locks before dispatch when watcher authority reconciliation fails", async () => {
		const harness = configurationStore();
		const next = snapshot(1, [firstRoot, secondRoot]);
		const reinitialize = vi.fn(async () => {});
		const onReloadRequired = vi.fn();
		const reconcileWatchRoots = vi.fn((rootIds: readonly string[]) => {
			if (rootIds.length === 2) {
				throw new Error("private watcher failure");
			}
		});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			reinitialize,
			vi.fn(async () => next),
			readAdoption(harness),
			onReloadRequired,
			reconcileWatchRoots,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		await expect(coordinator.apply(next)).rejects.toMatchObject({
			code: WORKSPACE_PROJECTION_FAILED,
			message: expect.not.stringContaining("private watcher failure"),
		});
		expect(reinitialize).not.toHaveBeenCalled();
		expect(onReloadRequired).toHaveBeenCalledOnce();
	});

	it("locks after a resolved reinitialize fails the adoption handshake", async () => {
		const harness = configurationStore();
		const next = snapshot(1, [firstRoot, secondRoot]);
		const load = vi.fn(async () => next);
		const onReloadRequired = vi.fn();
		const adoption = readAdoption(harness)
			.mockResolvedValueOnce({
				id: workspaceId,
				configPath: harness.configPath,
				rootUris: [firstRoot.uri],
			})
			.mockResolvedValueOnce({
				id: workspaceId,
				configPath: harness.configPath,
				rootUris: [firstRoot.uri],
			});
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			vi.fn(async () => {}),
			load,
			adoption,
			onReloadRequired,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();

		await expect(coordinator.apply(next)).rejects.toMatchObject({
			code: WORKSPACE_PROJECTION_FAILED,
		});
		expect(load).not.toHaveBeenCalled();
		expect(onReloadRequired).toHaveBeenCalledOnce();
	});

	it("fails closed on initial or same-revision adoption conflicts", async () => {
		const initialHarness = configurationStore();
		const initialReload = vi.fn();
		const initialCoordinator = createWorkspaceTopologyCoordinator(
			initialHarness.store,
			vi.fn(async () => {}),
			vi.fn(async () => snapshot(0, [firstRoot])),
			vi.fn(async () => ({
				id: workspaceId,
				configPath: undefined,
				rootUris: [],
			})),
			initialReload,
		);
		initialCoordinator.prepareInitial(snapshot(0, [firstRoot]));
		await expect(initialCoordinator.completeInitial()).rejects.toMatchObject({
			code: WORKSPACE_PROJECTION_FAILED,
		});
		expect(initialReload).toHaveBeenCalledOnce();

		const harness = configurationStore();
		const onReloadRequired = vi.fn();
		const coordinator = createWorkspaceTopologyCoordinator(
			harness.store,
			vi.fn(async () => {}),
			vi.fn(async () => snapshot(0, [firstRoot])),
			readAdoption(harness),
			onReloadRequired,
		);
		coordinator.prepareInitial(snapshot(0, [firstRoot]));
		await coordinator.completeInitial();
		await expect(
			coordinator.apply(snapshot(0, [secondRoot])),
		).rejects.toMatchObject({ code: WORKSPACE_PROJECTION_FAILED });
		expect(onReloadRequired).toHaveBeenCalledOnce();
	});
});
