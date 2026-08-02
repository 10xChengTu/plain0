import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { describe, expect, it, vi } from "vitest";

import {
	plainDebugSourceForResource,
	selectPlainDebugRoot,
} from "../../app/features/debug/plain-debug-root";
import { plainWorkspaceRootsFromFolders } from "../../app/features/workspace/plain-workspace-roots";

const ROOT_A = "11111111-1111-4111-8111-111111111111";
const ROOT_B = "22222222-2222-4222-8222-222222222222";

function folder(name: string, rootId: string) {
	return {
		name,
		uri: URI.from({
			scheme: "plain-workspace",
			authority: rootId,
			path: "/",
		}),
	};
}

const folders = [folder("alpha", ROOT_A), folder("beta", ROOT_B)];
const roots = plainWorkspaceRootsFromFolders(folders);

describe("selectPlainDebugRoot", () => {
	it("returns no root for an empty workspace without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(selectPlainDebugRoot([], pick)).resolves.toBeUndefined();
		expect(pick).not.toHaveBeenCalled();
	});

	it("automatically selects a sole root without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(selectPlainDebugRoot([roots[0]!], pick)).resolves.toEqual(
			roots[0],
		);
		expect(pick).not.toHaveBeenCalled();
	});

	it("requires an explicit multi-root choice and preserves cancellation", async () => {
		const pickSecond = vi.fn(async (items) => items[1]);
		await expect(selectPlainDebugRoot(roots, pickSecond)).resolves.toEqual(
			roots[1],
		);
		expect(pickSecond.mock.calls[0]?.[0]).toEqual([
			{ label: "alpha", description: ".vscode/launch.json", root: roots[0] },
			{ label: "beta", description: ".vscode/launch.json", root: roots[1] },
		]);
		await expect(
			selectPlainDebugRoot(roots, async () => undefined),
		).resolves.toBeUndefined();
	});
});

describe("plainDebugSourceForResource", () => {
	it("keeps identical relative paths distinct by their exact root authority", () => {
		expect(
			plainDebugSourceForResource(
				folders,
				URI.from({
					scheme: "plain-workspace",
					authority: ROOT_A,
					path: "/src/main.py",
				}),
			),
		).toEqual({ rootId: ROOT_A, path: "src/main.py" });
		expect(
			plainDebugSourceForResource(
				folders,
				URI.from({
					scheme: "plain-workspace",
					authority: ROOT_B,
					path: "/src/main.py",
				}),
			),
		).toEqual({ rootId: ROOT_B, path: "src/main.py" });
	});

	it("fails closed for foreign, malformed, or root-directory resources", () => {
		expect(
			plainDebugSourceForResource(
				folders,
				URI.from({ scheme: "file", path: "/src/main.py" }),
			),
		).toBeUndefined();
		expect(
			plainDebugSourceForResource(
				folders,
				URI.from({
					scheme: "plain-workspace",
					authority: ROOT_A,
					path: "/",
				}),
			),
		).toBeUndefined();
		expect(
			plainDebugSourceForResource(
				[folder("bad", "not-a-root-id")],
				URI.from({
					scheme: "plain-workspace",
					authority: "not-a-root-id",
					path: "/main.py",
				}),
			),
		).toBeUndefined();
	});
});
