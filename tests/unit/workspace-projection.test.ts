import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	applyWorkspaceSnapshot,
	createWorkspaceProjector,
	projectWorkspaceSnapshot,
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

describe("workspace projection", () => {
	it("projects an empty snapshot into an inert initial provider and empty identifier", async () => {
		const projection = projectWorkspaceSnapshot(snapshot(0, []));

		expect(projection.provider.workspace).toBeUndefined();
		expect(projection.provider.trusted).toBe(false);
		expect(projection.identifier).toEqual({ id: workspaceId });
		expect(Object.isFrozen(projection)).toBe(true);
		expect(Object.isFrozen(projection.provider)).toBe(true);
		expect(Object.isFrozen(projection.identifier)).toBe(true);

		expect(await projection.provider.open(undefined)).toBe(false);
		expect(
			await projection.provider.open({
				folderUri: URI.file("/private/unapproved"),
				id: "unapproved",
				label: "Unapproved",
			}),
		).toBe(false);
	});

	it("projects one authorized root with its opaque URI, id and label", async () => {
		const projection = projectWorkspaceSnapshot(snapshot(1, [firstRoot]));
		const workspace = projection.provider.workspace;

		expect(workspace).toBeDefined();
		expect(workspace).toMatchObject({
			id: workspaceId,
			label: firstRoot.displayName,
		});
		if (workspace === undefined || !("folderUri" in workspace)) {
			expect.fail("single-root projection must be a folder workspace");
		}
		expect(workspace.folderUri.toString()).toBe(firstRoot.uri);
		expect(projection.identifier).toMatchObject({ id: workspaceId });
		if (!("uri" in projection.identifier)) {
			expect.fail("single-root identifier must contain a folder URI");
		}
		expect(projection.identifier.uri).toBe(workspace.folderUri);
		expect(projection.provider.trusted).toBe(false);
		expect(Object.isFrozen(workspace)).toBe(true);

		expect(
			await projection.provider.open({
				folderUri: URI.parse(secondRoot.uri),
				id: "arbitrary",
				label: secondRoot.displayName,
			}),
		).toBe(false);
	});

	it("projects only the first root while multi-root UI remains disabled", () => {
		const projection = projectWorkspaceSnapshot(
			snapshot(1, [firstRoot, secondRoot]),
		);
		const workspace = projection.provider.workspace;

		expect(workspace).toBeDefined();
		if (workspace === undefined || !("folderUri" in workspace)) {
			expect.fail("the first native root must remain the visible folder");
		}
		expect(workspace.folderUri.toString()).toBe(firstRoot.uri);
		expect("uri" in projection.identifier).toBe(true);
		if ("uri" in projection.identifier) {
			expect(projection.identifier.uri.toString()).toBe(firstRoot.uri);
		}
	});

	it("revalidates the strict snapshot contract before creating any URI", () => {
		const malformed = {
			workspaceId,
			revision: 1,
			roots: [
				{
					...firstRoot,
					uri: `${firstRoot.uri}?native=/private`,
				},
			],
		} as WorkspaceSnapshot;

		expect(() => projectWorkspaceSnapshot(malformed)).toThrowError(
			expect.objectContaining({ code: "IPC_CONTRACT_VIOLATION" }),
		);
	});

	it("applies the projected identifier before resolving and preserves callback order", async () => {
		const order: string[] = [];
		let release: (() => void) | undefined;
		const reinitialize = vi.fn(async (identifier) => {
			order.push(`start:${identifier.id}`);
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			order.push(`finish:${identifier.id}`);
		});
		const pending = applyWorkspaceSnapshot(
			snapshot(1, [firstRoot]),
			reinitialize,
		).then((identifier) => {
			order.push(`return:${identifier.id}`);
			return identifier;
		});

		await vi.waitFor(() => expect(reinitialize).toHaveBeenCalledOnce());
		expect(order).toEqual([`start:${workspaceId}`]);
		const argument = reinitialize.mock.calls[0]![0];
		expect(argument).toMatchObject({ id: workspaceId });
		expect("uri" in argument && argument.uri.toString()).toBe(firstRoot.uri);

		release?.();
		const identifier = await pending;
		expect(identifier).toBe(argument);
		expect(order).toEqual([
			`start:${workspaceId}`,
			`finish:${workspaceId}`,
			`return:${workspaceId}`,
		]);
	});

	it("projector remains stateless across empty and folder applications", async () => {
		const identifiers: object[] = [];
		const projector = createWorkspaceProjector(async (identifier) => {
			identifiers.push(identifier);
		});

		const empty = projector.project(snapshot(0, []));
		const folder = projector.project(snapshot(1, [firstRoot]));
		expect(empty.identifier).toEqual({ id: workspaceId });
		expect(folder.identifier).toMatchObject({ id: workspaceId });
		expect(empty.identifier).not.toBe(folder.identifier);

		await projector.apply(snapshot(0, []));
		await projector.apply(snapshot(1, [firstRoot]));
		expect(identifiers).toHaveLength(2);
		expect("uri" in identifiers[0]!).toBe(false);
		expect(
			"uri" in identifiers[1]! &&
				identifiers[1]!.uri instanceof URI &&
				identifiers[1]!.uri.toString(),
		).toBe(firstRoot.uri);
	});

	it("does not invoke reinitialize for malformed snapshots or picker cancellation alone", async () => {
		const reinitialize = vi.fn(async () => {});
		const projector = createWorkspaceProjector(reinitialize);
		const cancelledPick = Object.freeze({
			status: "cancelled" as const,
			snapshot: snapshot(0, []),
		});

		// Cancellation stays with the command layer. Pure projection of the
		// unchanged snapshot has no side effects and does not imply an apply.
		expect(projector.project(cancelledPick.snapshot).identifier).toEqual({
			id: workspaceId,
		});
		expect(reinitialize).not.toHaveBeenCalled();

		const malformed = {
			...snapshot(1, [firstRoot]),
			roots: [{ ...firstRoot, uri: "file:///private" }],
		} as WorkspaceSnapshot;
		await expect(projector.apply(malformed)).rejects.toMatchObject({
			code: "IPC_CONTRACT_VIOLATION",
		});
		expect(reinitialize).not.toHaveBeenCalled();
	});
});
