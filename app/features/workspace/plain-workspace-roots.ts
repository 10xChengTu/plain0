import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";

const ROOT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PlainWorkspaceRoot {
	readonly rootId: string;
	readonly label: string;
	readonly uri: URI;
}

interface WorkspaceFolderLike {
	readonly name: string;
	readonly uri: URI;
}

/** Projects Workbench folders back into Plain's opaque native root
 * identities. Invalid or duplicate authorities fail closed as an empty
 * result so process-owning domains never turn corrupt topology into a
 * best-effort root guess. */
export function plainWorkspaceRootsFromFolders(
	folders: readonly WorkspaceFolderLike[],
): readonly PlainWorkspaceRoot[] {
	const seen = new Set<string>();
	const roots: PlainWorkspaceRoot[] = [];
	for (const folder of folders) {
		const rootId = folder.uri.authority;
		if (
			folder.uri.scheme !== "plain-workspace" ||
			folder.uri.path !== "/" ||
			!ROOT_ID_PATTERN.test(rootId) ||
			seen.has(rootId)
		) {
			return Object.freeze([]);
		}
		seen.add(rootId);
		roots.push(Object.freeze({ rootId, label: folder.name, uri: folder.uri }));
	}
	return Object.freeze(roots);
}

type RootSelectionListener = () => void;

/** Domain-local root selection state machine. A sole root is safe to select
 * automatically; entering a multi-root workspace clears an automatic choice
 * and requires an explicit selection. Callers instantiate one per domain so
 * Git and Terminal choices never silently drive each other. */
export class PlainWorkspaceRootSelection {
	#rootId: string | undefined;
	#explicit = false;
	readonly #listeners = new Set<RootSelectionListener>();

	onDidChange(listener: RootSelectionListener): { dispose(): void } {
		this.#listeners.add(listener);
		return {
			dispose: () => {
				this.#listeners.delete(listener);
			},
		};
	}

	#update(rootId: string | undefined, explicit: boolean): void {
		if (this.#rootId === rootId && this.#explicit === explicit) {
			return;
		}
		this.#rootId = rootId;
		this.#explicit = explicit;
		for (const listener of Array.from(this.#listeners)) {
			listener();
		}
	}

	synchronize(roots: readonly PlainWorkspaceRoot[]): string | undefined {
		if (roots.length === 0) {
			this.#update(undefined, false);
			return undefined;
		}
		if (roots.length === 1) {
			this.#update(roots[0]!.rootId, false);
			return roots[0]!.rootId;
		}
		if (
			this.#explicit &&
			this.#rootId !== undefined &&
			roots.some(({ rootId }) => rootId === this.#rootId)
		) {
			return this.#rootId;
		}
		this.#update(undefined, false);
		return undefined;
	}

	select(
		rootId: string | undefined,
		roots: readonly PlainWorkspaceRoot[],
	): boolean {
		if (rootId === undefined) {
			this.#update(undefined, false);
			return true;
		}
		if (!roots.some((root) => root.rootId === rootId)) {
			return false;
		}
		this.#update(rootId, true);
		return true;
	}

	resolve(
		roots: readonly PlainWorkspaceRoot[],
	): PlainWorkspaceRoot | undefined {
		const rootId = this.synchronize(roots);
		return roots.find((root) => root.rootId === rootId);
	}
}
