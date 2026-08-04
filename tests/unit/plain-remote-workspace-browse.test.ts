import { describe, expect, it } from "vitest";

import {
	remoteWorkspaceBrowseItems,
	remoteWorkspaceJoinPath,
} from "../../app/features/remote/plain-remote-workspace-browse";

describe("plain-remote-workspace-browse", () => {
	describe("remoteWorkspaceJoinPath", () => {
		it("joins a non-root directory with a child name using a slash", () => {
			expect(remoteWorkspaceJoinPath("/home/octocat", "project")).toBe(
				"/home/octocat/project",
			);
		});

		it("joins the filesystem root without a doubled slash", () => {
			expect(remoteWorkspaceJoinPath("/", "home")).toBe("/home");
		});
	});

	describe("remoteWorkspaceBrowseItems", () => {
		it("always leads with a useCurrent action carrying the canonical path", () => {
			const items = remoteWorkspaceBrowseItems({
				canonicalPath: "/home/octocat",
				parentPath: "/home",
				entries: [],
				hasMore: false,
			});
			expect(items[0]).toEqual({
				kind: "useCurrent",
				label: "$(check) Use This Folder",
				description: "/home/octocat",
			});
		});

		it("omits the up entry only at the filesystem root", () => {
			const atRoot = remoteWorkspaceBrowseItems({
				canonicalPath: "/",
				parentPath: null,
				entries: [],
				hasMore: false,
			});
			expect(atRoot.some((item) => item.kind === "up")).toBe(false);

			const nested = remoteWorkspaceBrowseItems({
				canonicalPath: "/home",
				parentPath: "/",
				entries: [],
				hasMore: false,
			});
			const up = nested.find((item) => item.kind === "up");
			expect(up).toEqual({ kind: "up", label: "..", targetPath: "/" });
		});

		it("lists every entry as a directory item with its joined absolute path", () => {
			const items = remoteWorkspaceBrowseItems({
				canonicalPath: "/home/octocat",
				parentPath: "/home",
				entries: ["project", "scratch"],
				hasMore: false,
			});
			const directories = items.filter((item) => item.kind === "directory");
			expect(directories).toEqual([
				{
					kind: "directory",
					label: "project",
					targetPath: "/home/octocat/project",
				},
				{
					kind: "directory",
					label: "scratch",
					targetPath: "/home/octocat/scratch",
				},
			]);
		});

		it("preserves entry order without re-sorting (the backend already sorts)", () => {
			const items = remoteWorkspaceBrowseItems({
				canonicalPath: "/",
				parentPath: null,
				entries: ["zzz", "aaa"],
				hasMore: false,
			});
			const directoryLabels = items
				.filter((item) => item.kind === "directory")
				.map((item) => item.label);
			expect(directoryLabels).toEqual(["zzz", "aaa"]);
		});

		it("appends a loadMore item only when the page reports more entries", () => {
			const withMore = remoteWorkspaceBrowseItems({
				canonicalPath: "/var",
				parentPath: "/",
				entries: ["log"],
				hasMore: true,
			});
			expect(withMore.at(-1)).toEqual({
				kind: "loadMore",
				label: "Show more…",
				targetPath: "/var",
			});

			const withoutMore = remoteWorkspaceBrowseItems({
				canonicalPath: "/var",
				parentPath: "/",
				entries: ["log"],
				hasMore: false,
			});
			expect(withoutMore.some((item) => item.kind === "loadMore")).toBe(false);
		});

		it("orders items as useCurrent, up, entries, loadMore", () => {
			const items = remoteWorkspaceBrowseItems({
				canonicalPath: "/srv",
				parentPath: "/",
				entries: ["app"],
				hasMore: true,
			});
			expect(items.map((item) => item.kind)).toEqual([
				"useCurrent",
				"up",
				"directory",
				"loadMore",
			]);
		});

		it("returns a frozen array", () => {
			const items = remoteWorkspaceBrowseItems({
				canonicalPath: "/",
				parentPath: null,
				entries: [],
				hasMore: false,
			});
			expect(Object.isFrozen(items)).toBe(true);
		});
	});
});
