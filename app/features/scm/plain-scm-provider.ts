import { constObservable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/observableInternal/observables/constObservable";
import {
	Emitter,
	Event,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ResourceTree } from "@codingame/monaco-vscode-api/vscode/vs/base/common/resourceTree";
import type { ITextModel } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";
import type {
	ISCMProvider,
	ISCMResource,
	ISCMResourceDecorations,
	ISCMResourceGroup,
} from "@codingame/monaco-vscode-api/vscode/vs/workbench/contrib/scm/common/scm";

import type {
	GitStatusEntry,
	GitStatusResult,
} from "../../platform/tauri/contracts";
import { encodeGitResourceUri } from "./git-uri";

/** Structural subset of `PlainBridge` `PlainScmProvider` itself needs — same
 * "narrow enough for a plain fake object in a unit test" discipline
 * `TerminalTrustBridge` (`plain-terminal-trust.ts`) already established for
 * this codebase. `PlainScmView` (./plain-scm-view.ts) owns the
 * trust/repository *discovery* decision (whether to register a provider at
 * all); this bridge slice is only what an already-registered provider needs
 * to refresh itself. */
export interface PlainScmProviderBridge {
	gitStatus(): Promise<GitStatusResult>;
}

/** Structural subset of `IEditorService` needed to open a resource's working
 * file on click — kept narrow for the same testability reason as the bridge
 * above, and because `PlainScmResource.open` is the one and only Workbench
 * service touchpoint this whole module needs. */
export interface PlainScmEditorOpener {
	openEditor(input: { readonly resource: URI }): Promise<unknown>;
}

/** Structural subset of `IModelService` needed for `inputBoxTextModel`
 * (`ISCMProvider`'s own required, but — see this class's module doc comment
 * — never read by any of this app's reachable code this slice). Narrowed to
 * one method for the same unit-testability reason as the two interfaces
 * above: a fake satisfying this needs no DOM, no Workbench bootstrap, and no
 * of the dozen other `IModelService` methods this class never calls. */
export interface PlainScmModelFactory {
	createModel(
		value: string,
		languageSelection: null,
		resource: URI,
	): ITextModel;
}

const WORKING_TREE_GROUP_ID = "workingTree";
const STAGED_GROUP_ID = "staged";

/**
 * One `(relativePath, status-letter)` pair destined for one `ISCMResource` —
 * an ordinary/rename-or-copy `GitStatusEntry` can produce up to *two* of
 * these (one for `indexStatus` in the Staged group, one for `worktreeStatus`
 * in the Working Tree group — real `git status` "MM" semantics: a file with
 * both staged and unstaged changes legitimately appears in both), which is
 * why this is a flat descriptor built by `classifyStatusEntries` rather than
 * `GitStatusEntry` itself being rendered 1:1 into one resource.
 */
interface ResourceDescriptor {
	readonly relativePath: string;
	readonly origRelativePath: string | undefined;
	/** The single porcelain-v2 status character driving this resource's
	 * label/decorations — `indexStatus`/`worktreeStatus` for
	 * ordinary/rename-or-copy entries, or a synthetic `"?"`/`"U"` for
	 * untracked/unmerged (which carry no `X`/`Y` pair of their own). */
	readonly statusChar: string;
	readonly isConflict: boolean;
}

function statusLabel(statusChar: string, isConflict: boolean): string {
	if (isConflict) {
		return "Unmerged";
	}
	switch (statusChar) {
		case "A":
			return "Added";
		case "C":
			return "Copied";
		case "D":
			return "Deleted";
		case "M":
			return "Modified";
		case "R":
			return "Renamed";
		case "T":
			return "Type Changed";
		case "?":
			return "Untracked";
		default:
			return "Changed";
	}
}

/**
 * Splits S1's `GitStatusResult.entries` into the Working Tree / Staged
 * descriptor lists `PlainScmProvider.applyStatus` turns into the two
 * `ISCMResourceGroup`s decision 4 asks for. `ignored` entries are dropped
 * entirely — matching both real `git`/VS Code SCM convention (ignored files
 * are an Explorer-decoration concern, never a Source Control changes-list
 * entry) and this app's own product scope (nothing here reads them).
 */
export function classifyStatusEntries(entries: readonly GitStatusEntry[]): {
	readonly workingTree: readonly ResourceDescriptor[];
	readonly staged: readonly ResourceDescriptor[];
} {
	const workingTree: ResourceDescriptor[] = [];
	const staged: ResourceDescriptor[] = [];
	for (const entry of entries) {
		switch (entry.type) {
			case "ignored":
				break;
			case "untracked":
				workingTree.push({
					relativePath: entry.path,
					origRelativePath: undefined,
					statusChar: "?",
					isConflict: false,
				});
				break;
			case "unmerged":
				workingTree.push({
					relativePath: entry.path,
					origRelativePath: undefined,
					statusChar: "U",
					isConflict: true,
				});
				break;
			case "ordinary":
			case "renameOrCopy": {
				const origRelativePath =
					entry.type === "renameOrCopy" ? entry.origPath : undefined;
				if (entry.indexStatus !== ".") {
					staged.push({
						relativePath: entry.path,
						origRelativePath,
						statusChar: entry.indexStatus,
						isConflict: false,
					});
				}
				if (entry.worktreeStatus !== ".") {
					workingTree.push({
						relativePath: entry.path,
						origRelativePath,
						statusChar: entry.worktreeStatus,
						isConflict: false,
					});
				}
				break;
			}
		}
	}
	return Object.freeze({
		workingTree: Object.freeze(workingTree),
		staged: Object.freeze(staged),
	});
}

/** Exported (unlike the module-private `PlainScmResourceGroup`) so
 * `plain-scm-view.ts` can recover `relativePath`/`isConflict` for a resource
 * it only ever receives back as the vendor `ISCMResource` interface type
 * (from `ISCMResourceGroup.resources`) — an `instanceof` check against this
 * concrete class is how the view's own Stage/Unstage/Discard button handlers
 * (`F080` S3) know which repository-relative path to send to `PlainBridge`,
 * without recomputing it from `sourceUri`/`rootUri` URI math a second time. */
export class PlainScmResource implements ISCMResource {
	readonly sourceUri: URI;
	readonly decorations: ISCMResourceDecorations;
	readonly contextValue: string | undefined;
	/** Repository-toplevel-relative path — the exact string `PlainBridge`'s
	 * `gitStagePaths`/`gitUnstagePaths`/`gitStageBlob`/`gitDiscardPaths` all
	 * expect. */
	readonly relativePath: string;
	/** `true` for an unmerged (conflicted) entry — mirrors
	 * `ResourceDescriptor.isConflict`; `plain-scm-view.ts` uses this (rather
	 * than re-deriving it from `contextValue === "conflict"`) to decide
	 * whether Discard applies to a resource the same way `contextValue !==
	 * "?"` already excludes untracked ones. */
	readonly isConflict: boolean;
	/** The single status character this resource represents — `"?"` for an
	 * untracked entry, `"U"` for unmerged, otherwise the real porcelain-v2
	 * `X`/`Y` letter. `plain-scm-view.ts` uses this to decide whether
	 * Discard applies (never for `"?"`, which has no index/HEAD version to
	 * restore from — see `src-tauri/src/git/discard.rs`'s own doc comment). */
	readonly statusChar: string;
	// Untyped (inferred `undefined`) rather than an explicit `Command |
	// undefined` annotation — deliberately never imports the real `Command`
	// type from `@codingame/monaco-vscode-api/vscode/vs/editor/common/
	// languages`: `scripts/plain/workspace-topology-contracts.mjs`'s
	// `FORBIDDEN_COMMAND_WRITER_IMPORTS` closed list (a guard against
	// sneaking in the *editor command/keybinding* writer surface through an
	// unrelated import) flags any import literally named `Command` from a
	// constrained `@codingame/monaco-vscode-*` package, and `implements`
	// checking only needs this field to be *assignable to* `ISCMResource`'s
	// `command?: Command`, which a bare inferred `undefined` already is.
	readonly command = undefined;
	readonly multiDiffEditorOriginalUri: URI | undefined = undefined;
	readonly multiDiffEditorModifiedUri: URI | undefined = undefined;

	constructor(
		readonly resourceGroup: ISCMResourceGroup,
		rootUri: URI,
		descriptor: ResourceDescriptor,
		private readonly editorOpener: PlainScmEditorOpener,
	) {
		this.sourceUri = URI.joinPath(rootUri, descriptor.relativePath);
		this.relativePath = descriptor.relativePath;
		this.isConflict = descriptor.isConflict;
		this.statusChar = descriptor.statusChar;
		this.contextValue = descriptor.isConflict
			? "conflict"
			: descriptor.statusChar;
		const label = statusLabel(descriptor.statusChar, descriptor.isConflict);
		this.decorations = Object.freeze({
			tooltip:
				descriptor.origRelativePath === undefined
					? label
					: `${label} (from ${descriptor.origRelativePath})`,
			strikeThrough: descriptor.statusChar === "D",
			faded: descriptor.statusChar === "?",
		});
		Object.freeze(this);
	}

	async open(_preserveFocus: boolean): Promise<void> {
		// Best-effort: a resource whose working-tree file no longer exists
		// (e.g. a staged deletion) simply fails to open — never an unhandled
		// rejection surfaced to the caller for what is, from the user's
		// perspective, an inert click.
		try {
			await this.editorOpener.openEditor({ resource: this.sourceUri });
		} catch {
			// Intentionally swallowed — see above.
		}
	}
}

class PlainScmResourceGroup implements ISCMResourceGroup {
	readonly resources: readonly ISCMResource[];
	readonly resourceTree: ResourceTree<ISCMResource, ISCMResourceGroup>;
	readonly onDidChange: Event<void> = Event.None;
	contextValue: string | undefined = undefined;
	readonly multiDiffEditorEnableViewChanges = false;

	#onDidChangeResources = new Emitter<void>();
	readonly onDidChangeResources = this.#onDidChangeResources.event;

	constructor(
		readonly id: string,
		readonly label: string,
		readonly provider: ISCMProvider,
		readonly hideWhenEmpty: boolean,
		rootUri: URI,
		descriptors: readonly ResourceDescriptor[],
		editorOpener: PlainScmEditorOpener,
	) {
		this.resourceTree = new ResourceTree(this, rootUri);
		this.resources = descriptors.map((descriptor) => {
			const resource = new PlainScmResource(
				this,
				rootUri,
				descriptor,
				editorOpener,
			);
			this.resourceTree.add(resource.sourceUri, resource);
			return resource;
		});
		Object.freeze(this.resources);
	}
}

/**
 * `F080` S2 decision 4: `ISCMProvider` implementation backed by S1's
 * `git_status` DTO. Registered with `ISCMService.registerSCMProvider` by
 * `PlainScmView` (./plain-scm-view.ts) only once that view has confirmed a
 * trusted, real Git repository — never speculatively, and never itself
 * deciding whether to spawn anything (this class only ever calls
 * `bridge.gitStatus()`, already trust-gated server-side).
 *
 * This slice intentionally implements *display* only: the commit input box
 * is a real, live `ISCMInput` (constructed for free by `SCMService.
 * registerSCMProvider` — see that class's own `common/scmService.js`) that
 * the view lets the user type into, but nothing here ever calls a commit
 * command — that is `F080` S3's job. Several `ISCMProvider` fields upstream
 * uses for richer UI this slice does not build (history graph, artifacts, an
 * action button, a status-bar command, an accept-input command) are
 * therefore constant, untyped (inferred) `undefined`/`constObservable(
 * undefined)` values rather than live ones with an explicit type annotation:
 * nothing in this app's own reachable code path (`PlainScmView`, never the
 * vendor `SCMViewPane`) ever reads them, so there is nothing to keep in sync
 * with — and, for the `Command`-typed ones specifically, no explicit
 * annotation also means never importing the real `Command` type at all (see
 * `PlainScmResource.command`'s own comment for why that specific import is
 * avoided).
 */
export class PlainScmProvider implements ISCMProvider {
	readonly id: string;
	readonly providerId = "git";
	readonly label = "Git";
	readonly name = "Git";
	readonly rootUri: URI;
	readonly inputBoxTextModel: ITextModel;
	readonly contextValue = constObservable<string | undefined>("git");
	readonly count = constObservable<number | undefined>(undefined);
	readonly commitTemplate = constObservable("");
	readonly artifactProvider = constObservable(undefined);
	readonly historyProvider = constObservable(undefined);
	readonly acceptInputCommand = undefined;
	readonly actionButton = constObservable(undefined);
	readonly statusBarCommands = constObservable(undefined);
	readonly iconPath: URI | undefined = undefined;
	readonly isHidden = false;
	readonly parentId: string | undefined = undefined;

	#groups: readonly ISCMResourceGroup[] = Object.freeze([]);
	get groups(): readonly ISCMResourceGroup[] {
		return this.#groups;
	}

	#onDidChangeResourceGroups = new Emitter<void>();
	readonly onDidChangeResourceGroups = this.#onDidChangeResourceGroups.event;
	#onDidChangeResources = new Emitter<void>();
	readonly onDidChangeResources = this.#onDidChangeResources.event;

	constructor(
		id: string,
		rootUri: URI,
		private readonly bridge: PlainScmProviderBridge,
		private readonly editorOpener: PlainScmEditorOpener,
		modelService: PlainScmModelFactory,
	) {
		this.id = id;
		this.rootUri = rootUri;
		this.inputBoxTextModel = modelService.createModel(
			"",
			null,
			URI.from({ scheme: "plain-scm-input", path: `/${id}` }),
		);
	}

	/** Fetches the latest status from Rust and re-derives both resource
	 * groups — called once by `PlainScmController` right after registration,
	 * and again on every manual/`.git`-adjacent refresh. */
	async refresh(): Promise<void> {
		const status = await this.bridge.gitStatus();
		this.applyStatus(status);
	}

	applyStatus(status: GitStatusResult): void {
		const { workingTree, staged } = classifyStatusEntries(status.entries);
		this.#groups = Object.freeze([
			new PlainScmResourceGroup(
				WORKING_TREE_GROUP_ID,
				"Changes",
				this,
				true,
				this.rootUri,
				workingTree,
				this.editorOpener,
			),
			new PlainScmResourceGroup(
				STAGED_GROUP_ID,
				"Staged Changes",
				this,
				true,
				this.rootUri,
				staged,
				this.editorOpener,
			),
		]);
		this.#onDidChangeResourceGroups.fire();
		this.#onDidChangeResources.fire();
	}

	async getOriginalResource(uri: URI): Promise<URI | null> {
		const relativePath = relativePathUnder(this.rootUri, uri);
		if (relativePath === undefined) {
			return null;
		}
		return encodeGitResourceUri(this.rootUri.authority, "head", relativePath);
	}

	dispose(): void {
		this.inputBoxTextModel.dispose();
		this.#onDidChangeResourceGroups.dispose();
		this.#onDidChangeResources.dispose();
	}
}

/** Repository-toplevel-relative path of `uri` under `rootUri`, or `undefined`
 * if `uri` is not (a descendant of) `rootUri` at all — mirrors `IUri
 * IdentityService.extUri.relativePath`'s contract without pulling that
 * service in for what is, here, a same-scheme same-authority prefix check.
 * Exported (`F080` S3) so `plain-scm-commands.ts`'s
 * `plain.scm.stageActiveFileFirstHunk` command can map the active editor's
 * `URI` to the same repository-relative path string `PlainBridge`'s git
 * methods expect, without a second URI-math implementation. */
export function relativePathUnder(rootUri: URI, uri: URI): string | undefined {
	if (uri.scheme !== rootUri.scheme || uri.authority !== rootUri.authority) {
		return undefined;
	}
	const rootPath = rootUri.path.endsWith("/")
		? rootUri.path
		: `${rootUri.path}/`;
	if (!uri.path.startsWith(rootPath)) {
		return undefined;
	}
	return uri.path.slice(rootPath.length);
}
