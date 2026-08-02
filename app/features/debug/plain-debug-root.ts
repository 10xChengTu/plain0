import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

import {
	plainWorkspaceRootsFromFolders,
	type PlainWorkspaceRoot,
} from "../workspace/plain-workspace-roots";
import { relativePathUnder } from "../scm/plain-scm-provider";

export interface PlainDebugRootPickItem {
	readonly label: string;
	readonly description: string;
	readonly root: PlainWorkspaceRoot;
}

export type PlainDebugRootPicker = (
	items: readonly PlainDebugRootPickItem[],
) => Promise<PlainDebugRootPickItem | undefined>;

/** Resolves the root whose launch configuration a new session owns. A sole
 * root is safe to use automatically; a multi-root workspace must go through
 * the injected user picker and cancellation returns no root. */
export async function selectPlainDebugRoot(
	roots: readonly PlainWorkspaceRoot[],
	pick: PlainDebugRootPicker,
): Promise<PlainWorkspaceRoot | undefined> {
	if (roots.length === 0) {
		return undefined;
	}
	if (roots.length === 1) {
		return roots[0];
	}
	const items = roots.map((root) =>
		Object.freeze({
			label: root.label,
			description: ".vscode/launch.json",
			root,
		}),
	);
	return (await pick(Object.freeze(items)))?.root;
}

export interface PlainDebugSource {
	readonly rootId: string;
	readonly path: string;
}

/** Maps one editor resource back to its exact authorized workspace root.
 * Duplicate relative paths in two roots intentionally produce distinct
 * sources; malformed topology and non-workspace resources fail closed. */
export function plainDebugSourceForResource(
	folders: readonly { readonly name: string; readonly uri: URI }[],
	resource: URI,
): PlainDebugSource | undefined {
	const roots = plainWorkspaceRootsFromFolders(folders);
	const root = roots.find(
		(candidate) =>
			candidate.uri.scheme === resource.scheme &&
			candidate.rootId === resource.authority,
	);
	if (root === undefined) {
		return undefined;
	}
	const path = relativePathUnder(root.uri, resource);
	return path === undefined || path.length === 0
		? undefined
		: Object.freeze({ rootId: root.rootId, path });
}
