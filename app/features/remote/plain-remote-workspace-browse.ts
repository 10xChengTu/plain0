/**
 * `F220` S3's own QuickPick directory-browsing logic — kept as a pure,
 * DOM/service-free module (mirrors `plain-remote-host-key-confirmation.ts`'s
 * identical split rationale) so it is unit-testable without a Workbench.
 * `plain-remote-workspace-commands.ts` is the only caller: it drives
 * `remoteWorkspacePickDirectory` in a loop and turns each page into the
 * items this module produces, entirely deferring path-joining/pagination
 * arithmetic to here.
 */

export type RemoteWorkspaceBrowseItemKind =
	"useCurrent" | "up" | "directory" | "loadMore";

export interface RemoteWorkspaceBrowseItem {
	readonly kind: RemoteWorkspaceBrowseItemKind;
	readonly label: string;
	readonly description?: string;
	/** The absolute remote path a `"up"`/`"directory"` selection should
	 * browse to next, or a `"loadMore"` item's *own current* directory (the
	 * caller re-requests the same `canonicalPath` at a larger `limit`). Not
	 * present for `"useCurrent"` (the caller already tracks the current
	 * page's own `canonicalPath` for that case). */
	readonly targetPath?: string;
}

export interface RemoteWorkspaceBrowsePage {
	readonly canonicalPath: string;
	readonly parentPath: string | null;
	readonly entries: readonly string[];
	readonly hasMore: boolean;
}

/**
 * Turns one `remoteWorkspacePickDirectory` page into an ordered QuickPick
 * item list: an always-present "use this folder" action first, an ".."
 * entry when not already at the filesystem root, then every subdirectory
 * name (each carrying its own joined absolute path), then a "show more"
 * action when the page is not the last one for this directory.
 */
export function remoteWorkspaceBrowseItems(
	page: RemoteWorkspaceBrowsePage,
): readonly RemoteWorkspaceBrowseItem[] {
	const items: RemoteWorkspaceBrowseItem[] = [
		{
			kind: "useCurrent",
			label: "$(check) Use This Folder",
			description: page.canonicalPath,
		},
	];
	if (page.parentPath !== null) {
		items.push({ kind: "up", label: "..", targetPath: page.parentPath });
	}
	for (const name of page.entries) {
		items.push({
			kind: "directory",
			label: name,
			targetPath: remoteWorkspaceJoinPath(page.canonicalPath, name),
		});
	}
	if (page.hasMore) {
		items.push({
			kind: "loadMore",
			label: "Show more…",
			targetPath: page.canonicalPath,
		});
	}
	return Object.freeze(items);
}

/** Joins an absolute remote directory path with a single, already-validated
 * child name using `/` (SFTP is always POSIX-style on the wire, regardless
 * of the connecting client's own platform) — mirrors
 * `remote::remote_fs::join_remote_path`'s own trailing-slash handling. */
export function remoteWorkspaceJoinPath(
	directoryPath: string,
	childName: string,
): string {
	return directoryPath === "/"
		? `/${childName}`
		: `${directoryPath}/${childName}`;
}
