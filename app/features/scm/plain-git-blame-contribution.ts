import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ICodeEditorService } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service";
import type { IModelDeltaDecoration } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";
import { ILanguageFeaturesService } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/services/languageFeatures.service";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";

import {
	PlainGitBlameEditorController,
	PlainGitBlameFileIndex,
	PlainGitBlameHoverProvider,
	type PlainGitBlameBridge,
} from "./plain-git-blame";
import { plainGitRootsFromWorkspaceFolders } from "./plain-git-root";
import { relativePathUnder } from "./plain-scm-provider";

/** The real `ICodeEditor` (`@codingame/monaco-vscode-api`'s own type alias
 * for `monaco-editor`'s `editor.ICodeEditor`) structurally satisfies this —
 * `PlainGitBlameEditorLike` (the narrower shape `plain-git-blame.ts`'s own
 * unit-tested logic depends on, which only requires `getModel().uri` to
 * have a `toString()`) plus the two change events this contribution's
 * live-editor wiring needs to know *when* to refetch, and the real `URI`
 * type this file's own `relativePathUnder` call needs. Kept as its own
 * declared interface (rather than importing `ICodeEditor` by name) so this
 * file's one Workbench-object-shaped cast happens exactly once, at the two
 * `ICodeEditorService` entry points below, instead of once per method
 * call. */
interface PlainGitBlameAttachableEditor {
	getModel(): { readonly uri: URI; getLineCount(): number } | null;
	deltaDecorations(
		oldDecorationIds: readonly string[],
		newDecorations: readonly IModelDeltaDecoration[],
	): string[];
	onDidChangeModel(listener: () => void): { dispose(): void };
	onDidChangeModelContent(listener: () => void): { dispose(): void };
}

/**
 * `F090` S0 wiring: attaches [`PlainGitBlameEditorController`] to every
 * created code editor (existing + future, via `ICodeEditorService`) and
 * registers one global [`PlainGitBlameHoverProvider`] — the "touches real
 * Workbench services" half of this feature, kept as thin as possible so
 * every piece of actual logic stays in `plain-git-blame.ts`'s pure/
 * narrow-interface functions and classes (unit-tested there). Mirrors
 * `scm-contribution.ts`'s own "registration glue, not logic" shape.
 *
 * Only ever attaches to a model whose `uri` resolves (via
 * `relativePathUnder`) to a path inside one exact authorized workspace root.
 * The root id is carried through both the blame fetch and later hover-message
 * fetch, so identically named files in two open repositories cannot share Git
 * state. A file outside the workspace (or no workspace open at all) is left
 * undecorated.
 */
export function createPlainGitBlameContribution(
	bridge: PlainGitBlameBridge,
	codeEditorService: ICodeEditorService,
	languageFeaturesService: ILanguageFeaturesService,
	workspaceContextService: IWorkspaceContextService,
): { dispose(): void } {
	/** One index per currently-blamed model, keyed by `URI.toString()` — the
	 * hover provider looks up by this same key, so a hover always reflects
	 * whatever a `PlainGitBlameEditorController` most recently fetched for
	 * that model, without a second round trip. */
	const indexes = new Map<string, PlainGitBlameFileIndex>();
	/** Debounce timers, keyed by editor instance — content-change-triggered
	 * refetches are coalesced so a fast typist does not trigger one
	 * `gitBlameFile` call per keystroke. */
	const debounceTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
	const controllers = new WeakMap<object, PlainGitBlameEditorController>();
	const editorDisposables = new WeakMap<object, { dispose(): void }[]>();
	const indexedModelKeys = new WeakMap<object, string>();

	const BLAME_REFRESH_DEBOUNCE_MS = 300;

	function relativePathForEditor(
		editor: PlainGitBlameAttachableEditor,
	): { readonly rootId: string; readonly relativePath: string } | undefined {
		const model = editor.getModel();
		if (model === null) {
			return undefined;
		}
		const roots = plainGitRootsFromWorkspaceFolders(
			workspaceContextService.getWorkspace().folders,
		);
		const root = roots.find(
			({ rootId }) =>
				model.uri.scheme === "plain-workspace" &&
				model.uri.authority === rootId,
		);
		if (root === undefined) {
			return undefined;
		}
		const relativePath = relativePathUnder(root.uri, model.uri);
		return relativePath === undefined
			? undefined
			: { rootId: root.rootId, relativePath };
	}

	function scheduleRefresh(editor: PlainGitBlameAttachableEditor): void {
		const existing = debounceTimers.get(editor);
		if (existing !== undefined) {
			clearTimeout(existing);
		}
		const target = relativePathForEditor(editor);
		const modelKey = editor.getModel()?.uri.toString();
		const previousModelKey = indexedModelKeys.get(editor);
		if (previousModelKey !== undefined && previousModelKey !== modelKey) {
			indexes.delete(previousModelKey);
			indexedModelKeys.delete(editor);
		}
		if (target === undefined) {
			if (modelKey !== undefined) {
				indexes.delete(modelKey);
			}
			controllers.get(editor)?.clear(editor);
			return;
		}
		debounceTimers.set(
			editor,
			setTimeout(() => {
				debounceTimers.delete(editor);
				let controller = controllers.get(editor);
				if (controller === undefined) {
					controller = new PlainGitBlameEditorController(bridge);
					controllers.set(editor, controller);
				}
				const model = editor.getModel();
				if (model !== null) {
					const key = model.uri.toString();
					indexes.set(key, controller.index);
					indexedModelKeys.set(editor, key);
				}
				void controller.refresh(editor, target.relativePath, target.rootId);
			}, BLAME_REFRESH_DEBOUNCE_MS),
		);
	}

	function attach(editor: PlainGitBlameAttachableEditor): void {
		const disposables = [
			editor.onDidChangeModel(() => scheduleRefresh(editor)),
			editor.onDidChangeModelContent(() => scheduleRefresh(editor)),
		];
		editorDisposables.set(editor, disposables);
		scheduleRefresh(editor);
	}

	function detach(editor: PlainGitBlameAttachableEditor): void {
		const timer = debounceTimers.get(editor);
		if (timer !== undefined) {
			clearTimeout(timer);
			debounceTimers.delete(editor);
		}
		for (const disposable of editorDisposables.get(editor) ?? []) {
			disposable.dispose();
		}
		editorDisposables.delete(editor);
		const modelKey = indexedModelKeys.get(editor);
		if (modelKey !== undefined) {
			indexes.delete(modelKey);
			indexedModelKeys.delete(editor);
		}
		controllers.delete(editor);
	}

	for (const editor of codeEditorService.listCodeEditors()) {
		attach(editor as unknown as PlainGitBlameAttachableEditor);
	}
	const addRegistration = codeEditorService.onCodeEditorAdd((editor) =>
		attach(editor as unknown as PlainGitBlameAttachableEditor),
	);
	const removeRegistration = codeEditorService.onCodeEditorRemove((editor) =>
		detach(editor as unknown as PlainGitBlameAttachableEditor),
	);

	const hoverProvider = new PlainGitBlameHoverProvider(
		(uri) => indexes.get(uri.toString()),
		bridge,
	);
	const hoverRegistration = languageFeaturesService.hoverProvider.register(
		"*",
		hoverProvider,
	);

	return {
		dispose(): void {
			addRegistration.dispose();
			removeRegistration.dispose();
			hoverRegistration.dispose();
			for (const editor of codeEditorService.listCodeEditors()) {
				detach(editor as unknown as PlainGitBlameAttachableEditor);
			}
		},
	};
}
