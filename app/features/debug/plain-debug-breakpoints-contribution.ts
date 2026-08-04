/**
 * `F100` S3 — Monaco glyph-margin breakpoints: attaches to every code editor
 * (existing and future, via `ICodeEditorService`, mirroring
 * `plain-git-blame-contribution.ts`'s exact "registration glue, not logic"
 * shape) and renders `DebugBreakpointStore`'s state as glyph-margin
 * decorations. Uses Monaco's own core editor API
 * (`IModelDeltaDecoration.options.glyphMarginClassName`/
 * `glyphMarginHoverMessage`, `ICodeEditor.onMouseDown`'s
 * `MouseTargetType.GUTTER_GLYPH_MARGIN`) — the same technique class F090's
 * inline blame already established, just glyph margin instead of an
 * `after`-content decoration — so no `debug-service-override` package is
 * needed (per the frozen research doc's "决策 3": breakpoint UI is Monaco
 * core, self-built).
 *
 * # Capability-gated condition/log-point editing
 *
 * A left-click toggles a plain breakpoint unconditionally (every real DAP
 * adapter must support at least unconditional line breakpoints). A
 * right-click on an *existing* breakpoint's glyph opens a small popup to
 * edit its condition/log-message/hit-count — but the three inputs are
 * disabled (with an explanatory placeholder, never silently accepted and
 * silently ignored) whenever the live session's negotiated `Capabilities` do
 * not advertise `supportsConditionalBreakpoints`/`supportsLogPoints`/
 * `supportsHitConditionalBreakpoints` respectively. Before any session has
 * ever started, all three are enabled (there is no adapter yet to
 * contradict) — the real gate only engages once a live session's
 * capabilities are known, matching this feature's "不得假设支持" requirement
 * without blocking editing before a session even exists. The hit-count
 * expression itself (e.g. `"5"`, `">=3"`) is never parsed by Plain — it is
 * sent verbatim to the adapter, which is the only party that understands its
 * grammar (`docs/research/2026-08-04-complete-debug.md`'s "架构裁定 §3").
 */

import { addDisposableListener } from "@codingame/monaco-vscode-api/vscode/vs/base/browser/dom";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { ICodeEditorService } from "@codingame/monaco-vscode-api/vscode/vs/editor/browser/services/codeEditorService.service";
import { MouseTargetType } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/standalone/standaloneEnums";
import type { IModelDeltaDecoration } from "@codingame/monaco-vscode-api/vscode/vs/editor/common/model";
import { IWorkspaceContextService } from "@codingame/monaco-vscode-api/vscode/vs/platform/workspace/common/workspace.service";

import type {
	DebugBreakpointStore,
	DebugBreakpointView,
} from "./plain-debug-breakpoints";
import {
	plainDebugSourceForResource,
	type PlainDebugSource,
} from "./plain-debug-root";
import type { DebugSessionController } from "./plain-debug-session";

const BREAKPOINT_DECORATION_DESCRIPTION = "plain-debug-breakpoint";

interface PlainDebugMouseTargetPosition {
	readonly lineNumber: number;
}

interface PlainDebugMouseTarget {
	readonly type: number;
	readonly position: PlainDebugMouseTargetPosition | null;
}

interface PlainDebugEditorMouseEvent {
	readonly target: PlainDebugMouseTarget;
	// Real Monaco `IEditorMouseEvent` has no `preventDefault`/button flags of
	// its own — they live one level down, on the wrapped `IMouseEvent`
	// (`event.event`), which itself wraps the real DOM `MouseEvent`. Verified
	// against the vendored `editor.api.d.ts` after a real E2E run caught two
	// bugs here in turn: an earlier version of this interface declared
	// `preventDefault` directly on the event (threw `event.preventDefault is
	// not a function` the moment a real right-click reached this handler),
	// and — once that was fixed — `onMouseDown`'s own handler turned out to
	// toggle the breakpoint for *any* mouse button, including the right
	// button that opens the popup: a real right-click first fired
	// `onMouseDown` (toggling the breakpoint back off) and only *then*
	// `onContextMenu`, which by that point found no breakpoint left to show
	// a popup for. `leftButton`/`rightButton` are what let `onMouseDown`
	// ignore anything but a genuine left click.
	readonly event: {
		readonly leftButton: boolean;
		readonly rightButton: boolean;
		preventDefault(): void;
	};
}

/** The narrow shape of a real `ICodeEditor` this contribution needs — same
 * "declare the narrow structural shape once" discipline as
 * `plain-git-blame-contribution.ts`'s own `PlainGitBlameAttachableEditor`. */
interface PlainDebugBreakpointAttachableEditor {
	getModel(): { readonly uri: URI } | null;
	getDomNode(): HTMLElement | null;
	deltaDecorations(
		oldDecorationIds: readonly string[],
		newDecorations: readonly IModelDeltaDecoration[],
	): string[];
	onDidChangeModel(listener: () => void): { dispose(): void };
	onMouseDown(listener: (event: PlainDebugEditorMouseEvent) => void): {
		dispose(): void;
	};
	onContextMenu(listener: (event: PlainDebugEditorMouseEvent) => void): {
		dispose(): void;
	};
}

function glyphClassName(view: DebugBreakpointView): string {
	if (view.verification === null) {
		return "plain-debug-breakpoint-glyph plain-debug-breakpoint-glyph-unverified";
	}
	return view.verification.verified
		? "plain-debug-breakpoint-glyph plain-debug-breakpoint-glyph-verified"
		: "plain-debug-breakpoint-glyph plain-debug-breakpoint-glyph-rejected";
}

function glyphHoverText(view: DebugBreakpointView): string {
	const parts: string[] = [];
	if (view.condition !== null && view.condition.length > 0) {
		parts.push(`Condition: ${view.condition}`);
	}
	if (view.logMessage !== null && view.logMessage.length > 0) {
		parts.push(`Log message: ${view.logMessage}`);
	}
	if (view.hitCondition !== null && view.hitCondition.length > 0) {
		parts.push(`Hit count: ${view.hitCondition}`);
	}
	if (view.verification !== null) {
		if (!view.verification.verified) {
			parts.push(
				view.verification.message ??
					"The debug adapter rejected this breakpoint.",
			);
		} else if (
			view.verification.actualLine !== null &&
			view.verification.actualLine !== view.line
		) {
			parts.push(`Moved to line ${view.verification.actualLine}.`);
		}
	}
	return parts.length > 0 ? parts.join("\n") : "Breakpoint";
}

function buildDecorations(
	views: readonly DebugBreakpointView[],
): IModelDeltaDecoration[] {
	return views.map((view) => ({
		range: {
			startLineNumber: view.line,
			startColumn: 1,
			endLineNumber: view.line,
			endColumn: 1,
		},
		options: {
			description: BREAKPOINT_DECORATION_DESCRIPTION,
			glyphMarginClassName: glyphClassName(view),
			glyphMarginHoverMessage: { value: glyphHoverText(view) },
		},
	}));
}

/** Reads a `supportsXxx` capability field the same deterministic way the
 * Rust side's `Capabilities::supports` does — present and exactly `true` is
 * supported, everything else (absent, `false`, non-boolean) is not. Exported
 * for this module's own unit test. */
export function capabilitySupported(
	capabilities: Readonly<Record<string, unknown>> | undefined,
	name: string,
): boolean {
	if (capabilities === undefined) {
		// No live session yet — there is no adapter to contradict offering
		// the input; the real gate only engages once a session's
		// capabilities are actually known.
		return true;
	}
	return capabilities[name] === true;
}

interface BreakpointPopupHandle {
	readonly element: HTMLElement;
	dispose(): void;
}

function createBreakpointPopup(
	container: HTMLElement,
	line: number,
	view: DebugBreakpointView,
	conditionSupported: boolean,
	logPointSupported: boolean,
	hitConditionSupported: boolean,
	onSave: (
		condition: string | null,
		logMessage: string | null,
		hitCondition: string | null,
	) => void,
	onRemove: () => void,
): BreakpointPopupHandle {
	const element = document.createElement("div");
	element.className = "plain-debug-breakpoint-popup";
	element.setAttribute("role", "dialog");
	element.setAttribute("aria-label", `Breakpoint at line ${line}`);

	const conditionLabel = document.createElement("label");
	conditionLabel.textContent = "Condition";
	const conditionInput = document.createElement("input");
	conditionInput.type = "text";
	conditionInput.className = "plain-debug-breakpoint-popup-condition";
	conditionInput.value = view.condition ?? "";
	conditionInput.disabled = !conditionSupported;
	conditionInput.placeholder = conditionSupported
		? "Expression"
		: "Not supported by this adapter";
	conditionLabel.append(conditionInput);

	const logMessageLabel = document.createElement("label");
	logMessageLabel.textContent = "Log Message";
	const logMessageInput = document.createElement("input");
	logMessageInput.type = "text";
	logMessageInput.className = "plain-debug-breakpoint-popup-log-message";
	logMessageInput.value = view.logMessage ?? "";
	logMessageInput.disabled = !logPointSupported;
	logMessageInput.placeholder = logPointSupported
		? "Message to log instead of stopping"
		: "Not supported by this adapter";
	logMessageLabel.append(logMessageInput);

	const hitConditionLabel = document.createElement("label");
	hitConditionLabel.textContent = "Hit Count";
	const hitConditionInput = document.createElement("input");
	hitConditionInput.type = "text";
	hitConditionInput.className = "plain-debug-breakpoint-popup-hit-condition";
	hitConditionInput.value = view.hitCondition ?? "";
	hitConditionInput.disabled = !hitConditionSupported;
	hitConditionInput.placeholder = hitConditionSupported
		? "e.g. 5 or >=3"
		: "Not supported by this adapter";
	hitConditionLabel.append(hitConditionInput);

	const saveButton = document.createElement("button");
	saveButton.type = "button";
	saveButton.textContent = "Save";
	saveButton.className = "plain-debug-breakpoint-popup-save";

	const removeButton = document.createElement("button");
	removeButton.type = "button";
	removeButton.textContent = "Remove Breakpoint";
	removeButton.className = "plain-debug-breakpoint-popup-remove";

	const disposables = [
		addDisposableListener(saveButton, "click", () => {
			const trimmedHitCondition = hitConditionInput.value.trim();
			onSave(
				conditionSupported && conditionInput.value.length > 0
					? conditionInput.value
					: null,
				logPointSupported && logMessageInput.value.length > 0
					? logMessageInput.value
					: null,
				hitConditionSupported && trimmedHitCondition.length > 0
					? trimmedHitCondition
					: null,
			);
		}),
		addDisposableListener(removeButton, "click", () => {
			onRemove();
		}),
	];

	element.append(
		conditionLabel,
		logMessageLabel,
		hitConditionLabel,
		saveButton,
		removeButton,
	);
	container.append(element);

	return {
		element,
		dispose() {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			element.remove();
		},
	};
}

export function createPlainDebugBreakpointsContribution(
	codeEditorService: ICodeEditorService,
	workspaceContextService: IWorkspaceContextService,
	breakpoints: DebugBreakpointStore,
	session: DebugSessionController,
): { dispose(): void } {
	const editorDisposables = new WeakMap<object, { dispose(): void }[]>();
	const activePopups = new WeakMap<object, BreakpointPopupHandle>();

	function sourceForEditor(
		editor: PlainDebugBreakpointAttachableEditor,
	): PlainDebugSource | undefined {
		const model = editor.getModel();
		if (model === null) {
			return undefined;
		}
		return plainDebugSourceForResource(
			workspaceContextService.getWorkspace().folders,
			model.uri,
		);
	}

	function redraw(editor: PlainDebugBreakpointAttachableEditor): void {
		const source = sourceForEditor(editor);
		const views =
			source === undefined
				? []
				: breakpoints.viewsForPath(source.rootId, source.path);
		const previous = decorationIds.get(editor) ?? [];
		const next = editor.deltaDecorations(previous, buildDecorations(views));
		decorationIds.set(editor, next);
	}

	const decorationIds = new WeakMap<object, string[]>();

	function closePopup(editor: PlainDebugBreakpointAttachableEditor): void {
		activePopups.get(editor)?.dispose();
		activePopups.delete(editor);
	}

	function openPopup(
		editor: PlainDebugBreakpointAttachableEditor,
		source: PlainDebugSource,
		line: number,
	): void {
		closePopup(editor);
		const view = breakpoints
			.viewsForPath(source.rootId, source.path)
			.find((candidate) => candidate.line === line);
		if (view === undefined) {
			return;
		}
		const domNode = editor.getDomNode();
		if (domNode === null) {
			return;
		}
		const capabilities = session.state?.capabilities;
		const conditionSupported = capabilitySupported(
			capabilities,
			"supportsConditionalBreakpoints",
		);
		const logPointSupported = capabilitySupported(
			capabilities,
			"supportsLogPoints",
		);
		const hitConditionSupported = capabilitySupported(
			capabilities,
			"supportsHitConditionalBreakpoints",
		);
		const popup = createBreakpointPopup(
			domNode,
			line,
			view,
			conditionSupported,
			logPointSupported,
			hitConditionSupported,
			(condition, logMessage, hitCondition) => {
				// A single atomic update (see `DebugBreakpointStore.setDetails`'s
				// own doc comment for why this must not be separate
				// `setCondition`/`setLogMessage`/`setHitCondition` calls) — an
				// unsupported field keeps its existing value rather than being
				// overwritten with whatever the (disabled, unusable) input
				// happened to hold.
				breakpoints.setDetails(
					source.rootId,
					source.path,
					line,
					conditionSupported ? condition : view.condition,
					logPointSupported ? logMessage : view.logMessage,
					hitConditionSupported ? hitCondition : view.hitCondition,
				);
				closePopup(editor);
			},
			() => {
				breakpoints.remove(source.rootId, source.path, line);
				closePopup(editor);
			},
		);
		activePopups.set(editor, popup);
	}

	function attach(editor: PlainDebugBreakpointAttachableEditor): void {
		const disposables = [
			editor.onDidChangeModel(() => redraw(editor)),
			breakpoints.onDidChange((rootId, path) => {
				const source = sourceForEditor(editor);
				if (source?.rootId === rootId && source.path === path) {
					redraw(editor);
				}
			}),
			editor.onMouseDown((event) => {
				if (
					event.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN ||
					event.target.position === null ||
					!event.event.leftButton
				) {
					return;
				}
				const source = sourceForEditor(editor);
				if (source === undefined) {
					return;
				}
				closePopup(editor);
				breakpoints.toggle(
					source.rootId,
					source.path,
					event.target.position.lineNumber,
				);
			}),
			editor.onContextMenu((event) => {
				if (
					event.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN ||
					event.target.position === null
				) {
					return;
				}
				const source = sourceForEditor(editor);
				if (source === undefined) {
					return;
				}
				event.event.preventDefault();
				openPopup(editor, source, event.target.position.lineNumber);
			}),
		];
		editorDisposables.set(editor, disposables);
		redraw(editor);
	}

	function detach(editor: PlainDebugBreakpointAttachableEditor): void {
		closePopup(editor);
		for (const disposable of editorDisposables.get(editor) ?? []) {
			disposable.dispose();
		}
		editorDisposables.delete(editor);
		decorationIds.delete(editor);
	}

	for (const editor of codeEditorService.listCodeEditors()) {
		attach(editor as unknown as PlainDebugBreakpointAttachableEditor);
	}
	const addRegistration = codeEditorService.onCodeEditorAdd((editor) =>
		attach(editor as unknown as PlainDebugBreakpointAttachableEditor),
	);
	const removeRegistration = codeEditorService.onCodeEditorRemove((editor) =>
		detach(editor as unknown as PlainDebugBreakpointAttachableEditor),
	);

	return {
		dispose(): void {
			addRegistration.dispose();
			removeRegistration.dispose();
			for (const editor of codeEditorService.listCodeEditors()) {
				detach(editor as unknown as PlainDebugBreakpointAttachableEditor);
			}
		},
	};
}
