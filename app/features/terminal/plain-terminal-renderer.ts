import type {
	TerminalCell,
	TerminalColors,
	TerminalCursor,
	TerminalCursorStyle,
	TerminalFrame,
	TerminalRgb,
	TerminalRow,
	TerminalScrollbackRow,
	TerminalStyle,
} from "../../platform/tauri/contracts";

/**
 * F190 S4 "Ghostty metadata and links": whether `url` (a cell's OSC 8
 * hyperlink, or `null` for none) is ever eligible to become a clickable
 * link at all — `http:`/`https:` only, exactly mirroring
 * `src-tauri/src/terminal/opener.rs`'s own scheme restriction so the
 * renderer never *looks* clickable for a scheme the backend would reject
 * anyway (a `file:`/`javascript:`/anything-else URI always renders as
 * plain, inert text, no matter what OSC 8 payload a program writes).
 */
export function isClickableHyperlinkUrl(url: string | null): url is string {
	return (
		url !== null && (url.startsWith("http://") || url.startsWith("https://"))
	);
}

/**
 * F070 "WebView DOM 渲染": a wterm-style DOM terminal grid — one real DOM
 * element per visible row, rebuilt/patched from `TerminalFrame`s, with
 * *native* text selection, Cmd+F find and accessibility (no custom
 * selection/hit-testing code, unlike a canvas/WebGL renderer — see
 * `docs/research/2026-07-24-libghostty-terminal.md`'s 决策 B).
 *
 * This file has two halves with very different testability:
 *
 * - [`TerminalGridModel`]: a pure, DOM-free retained grid — applies a
 *   `TerminalFrame` onto plain data and reports which rows actually
 *   changed. Fully unit-testable in this repo's Node-only Vitest
 *   environment (`vitest.config.ts` has no jsdom — see
 *   `plain-terminal-input.ts`'s own module doc for the same constraint).
 * - [`PlainTerminalRenderer`]: the DOM paint layer wrapping a model — owns
 *   real row elements, a cursor overlay and glyph measurement. This half
 *   necessarily needs a real `document` and is exercised only by this
 *   slice's Browser E2E (`tests/browser/terminal.spec.ts`), the same
 *   division of labor `PlainSearchView` (DOM-heavy, no dedicated unit test
 *   file) vs. `plain-search-service.ts` (DOM-free, unit-tested) already
 *   establishes for this repository.
 *
 * # Scrollback view mode (F070 "多 tab/split/scrollback" slice)
 *
 * [`PlainTerminalRenderer`] can show one of two things at a time: the
 * normal, continuously-updated live viewport (unchanged from the prior
 * slice), or a fetched window of [`TerminalScrollbackRow`]s via
 * [`showScrollbackRows`] — never both. While showing history,
 * [`applyFrame`] still updates the retained [`TerminalGridModel`] (so
 * `TerminalPaneController.scrollController`'s eventual [`showLive`] call
 * repaints current content immediately, with nothing lost) and still drives
 * the same `onFramePainted` ack callback (so VT → frontend frame backpressure
 * keeps flowing even while a pane is parked in history — see
 * `src-tauri/src/terminal/service.rs`'s "VT → frontend frame delivery
 * backpressure" section), it just skips repainting the on-screen grid/cursor
 * — exactly what `docs/research/2026-07-24-libghostty-terminal.md`'s "新输出
 * 到达时若在历史位置不强制跳底" design requires. A resize arriving while in
 * history mode (`frame.dirty === "full"` or a dimension change) is the one
 * case that forces an implicit return to live: the cached history window's
 * row/column shape would otherwise no longer match the grid it was painted
 * into, and resizing while manually scrolled is a rare enough interaction
 * that "snap back to live" is a reasonable, simple resolution rather than
 * re-fetching/re-aligning a stale scrollback window.
 */

const BLANK_STYLE: TerminalStyle = Object.freeze({
	bold: false,
	italic: false,
	faint: false,
	blink: false,
	inverse: false,
	invisible: false,
	strikethrough: false,
	overline: false,
	underline: "none",
});

const BLANK_CELL: TerminalCell = Object.freeze({
	graphemes: "",
	fg: null,
	bg: null,
	style: BLANK_STYLE,
	hyperlink: null,
	semantic: "output",
});

function blankRow(cols: number): TerminalCell[] {
	return Array.from({ length: cols }, () => BLANK_CELL);
}

/** Coerces a Rust-provided row's cells to exactly `cols` entries — Rust
 * always sends a row whose cell count matches the frame's own `cols`, but
 * padding/truncating defensively here keeps every retained row the same,
 * predictable length regardless, so paint code never needs its own bounds
 * check on top of `noUncheckedIndexedAccess`. */
function normalizedRowCells(
	cells: readonly TerminalCell[],
	cols: number,
): TerminalCell[] {
	const result: TerminalCell[] = [];
	for (let index = 0; index < cols; index += 1) {
		result.push(cells[index] ?? BLANK_CELL);
	}
	return result;
}

/**
 * Adapts one [`TerminalScrollbackRow`] into the same [`TerminalCell`] shape
 * the live grid paints — `fg`/`bg` are always `null` (a scrollback cell
 * carries no resolved color at all; see that type's own doc comment for why
 * — palette resolution only happens for the live viewport), so history text
 * paints in the pane's default foreground/background plus whatever
 * bold/italic/underline/etc. attributes its `style` does carry. This is a
 * deliberate scope limit for this slice (documented, not a bug): full
 * per-cell scrollback color fidelity would need a `src-tauri` DTO change
 * (resolving `libghostty_vt::style::StyleColor` against a captured palette)
 * this slice does not make — see the F070 "多 tab/split/scrollback" slice
 * report for the reasoning. `hyperlink`/`semantic` are likewise always
 * `null`/`"output"` — F190 S4's own scope decision: `terminal::vt::ScrollbackCell`
 * (deliberately lighter than the live `DirtyCell`, see that type's doc
 * comment) does not carry either, so a scrollback link never renders as
 * clickable and scrollback text never carries semantic CSS classes; only
 * the live viewport does.
 */
function scrollbackCellAsTerminalCell(cell: {
	readonly graphemes: string;
	readonly style: TerminalStyle;
}): TerminalCell {
	return Object.freeze({
		graphemes: cell.graphemes,
		fg: null,
		bg: null,
		style: cell.style,
		hyperlink: null,
		semantic: "output",
	});
}

export interface TerminalGridApplyResult {
	/** `true` when every row was (re)built from scratch — either because
	 * `frame.dirty === "full"`, or (defensively) because `frame.cols`/`rows`
	 * differ from what this model previously held, regardless of what
	 * `dirty` claimed. `changedRowIndices` still lists every row index in
	 * this case (`0..rows`), so a caller never needs to special-case
	 * `rebuilt` to know which rows to repaint — only whether it may reuse
	 * existing row elements or must recreate them. */
	readonly rebuilt: boolean;
	readonly changedRowIndices: readonly number[];
}

/**
 * A pure, retained terminal grid: applies incoming [`TerminalFrame`]s onto
 * plain in-memory rows and cursor/color state, with no DOM involved at all.
 * See the module doc for why this half is split out from
 * [`PlainTerminalRenderer`].
 */
export class TerminalGridModel {
	#cols = 0;
	#rows = 0;
	#cellRows: TerminalCell[][] = [];
	/** F190 S4 "Ghostty metadata and links": each row's OSC 133 semantic
	 * prompt classification — a parallel array to `#cellRows`, kept in sync
	 * the same way (rebuilt to `"none"` on a full redraw/resize, replaced per
	 * row on a partial update). Drives `PlainTerminalRenderer.jumpToAdjacentPrompt`'s
	 * command-navigation search. */
	#rowSemanticPrompts: TerminalRow["semanticPrompt"][] = [];
	#cursor: TerminalCursor | undefined;
	#colors: TerminalColors | undefined;

	get cols(): number {
		return this.#cols;
	}

	get rows(): number {
		return this.#rows;
	}

	get cursor(): TerminalCursor | undefined {
		return this.#cursor;
	}

	get colors(): TerminalColors | undefined {
		return this.#colors;
	}

	cellAt(rowIndex: number, colIndex: number): TerminalCell | undefined {
		return this.#cellRows[rowIndex]?.[colIndex];
	}

	rowCells(rowIndex: number): readonly TerminalCell[] | undefined {
		return this.#cellRows[rowIndex];
	}

	/** F190 S4: this retained row's OSC 133 semantic prompt classification,
	 * or `undefined` for a row index outside the current grid. */
	rowSemanticPrompt(
		rowIndex: number,
	): TerminalRow["semanticPrompt"] | undefined {
		return this.#rowSemanticPrompts[rowIndex];
	}

	/**
	 * Applies one frame, in the order this session's `TerminalStream`
	 * delivered it. `colors`/`cursor` are always replaced (a frame carries
	 * them even when `dirty === "clean"` — see `TerminalFrame`'s own doc
	 * comment); `rowsData` is applied incrementally onto the retained grid,
	 * never treated as a complete snapshot by itself, exactly as that same
	 * doc comment requires of callers.
	 */
	applyFrame(frame: TerminalFrame): TerminalGridApplyResult {
		this.#colors = frame.colors;
		this.#cursor = frame.cursor;

		const dimensionsChanged =
			frame.cols !== this.#cols || frame.rows !== this.#rows;
		const rebuilt = dimensionsChanged || frame.dirty === "full";
		if (rebuilt) {
			this.#cols = frame.cols;
			this.#rows = frame.rows;
			this.#cellRows = Array.from({ length: frame.rows }, () =>
				blankRow(frame.cols),
			);
			this.#rowSemanticPrompts = Array.from(
				{ length: frame.rows },
				() => "none",
			);
		}

		const changed = new Set<number>();
		for (const row of frame.rowsData) {
			if (row.rowIndex < 0 || row.rowIndex >= this.#rows) {
				// Defensive: a malformed/stale frame naming a row outside the
				// current grid is dropped rather than corrupting `#cellRows`'
				// fixed shape.
				continue;
			}
			this.#cellRows[row.rowIndex] = normalizedRowCells(row.cells, this.#cols);
			this.#rowSemanticPrompts[row.rowIndex] = row.semanticPrompt;
			changed.add(row.rowIndex);
		}

		if (rebuilt) {
			return Object.freeze({
				rebuilt: true,
				changedRowIndices: Object.freeze(
					Array.from({ length: this.#rows }, (_unused, index) => index),
				),
			});
		}
		return Object.freeze({
			rebuilt: false,
			changedRowIndices: Object.freeze([...changed].sort((a, b) => a - b)),
		});
	}
}

// ---------------------------------------------------------------------
// DOM paint layer — see the module doc for why this half is exercised only
// by Browser E2E, never a Node-only unit test.
// ---------------------------------------------------------------------

function rgbCss(rgb: TerminalRgb): string {
	return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/** One contiguous run of cells sharing the exact same paint attributes,
 * built by `groupRowRuns` — minimizes DOM element count per row (one `span`
 * per run, not per cell) while keeping every cell's actual text content in
 * real, selectable/copyable DOM text nodes. */
interface CellRun {
	readonly text: string;
	readonly fg: TerminalRgb | null;
	readonly bg: TerminalRgb | null;
	readonly style: TerminalStyle;
	/** Only ever non-`null` when [`isClickableHyperlinkUrl`] already
	 * accepted it — a run never merges a clickable and non-clickable (or
	 * differently-linked) cell together, so this field alone is enough for
	 * paint code to decide link affordance without re-checking scheme. */
	readonly clickableLink: string | null;
	readonly semantic: TerminalCell["semantic"];
}

function runKey(cell: TerminalCell): string {
	const { style } = cell;
	const clickableLink = isClickableHyperlinkUrl(cell.hyperlink)
		? cell.hyperlink
		: null;
	return [
		cell.fg === null ? "-" : `${cell.fg.r},${cell.fg.g},${cell.fg.b}`,
		cell.bg === null ? "-" : `${cell.bg.r},${cell.bg.g},${cell.bg.b}`,
		style.bold ? "b" : "",
		style.italic ? "i" : "",
		style.faint ? "f" : "",
		style.blink ? "k" : "",
		style.inverse ? "v" : "",
		style.invisible ? "h" : "",
		style.strikethrough ? "s" : "",
		style.overline ? "o" : "",
		style.underline,
		clickableLink ?? "-",
		cell.semantic,
	].join("|");
}

function groupRowRuns(cells: readonly TerminalCell[]): CellRun[] {
	const runs: CellRun[] = [];
	let currentKey: string | undefined;
	for (const cell of cells) {
		const key = runKey(cell);
		const text = cell.graphemes === "" ? " " : cell.graphemes;
		const last = runs.at(-1);
		if (key === currentKey && last !== undefined) {
			runs[runs.length - 1] = Object.freeze({
				...last,
				text: last.text + text,
			});
		} else {
			runs.push(
				Object.freeze({
					text,
					fg: cell.fg,
					bg: cell.bg,
					style: cell.style,
					clickableLink: isClickableHyperlinkUrl(cell.hyperlink)
						? cell.hyperlink
						: null,
					semantic: cell.semantic,
				}),
			);
			currentKey = key;
		}
	}
	return runs;
}

function applyRunToSpan(
	span: HTMLSpanElement,
	run: CellRun,
	colors: TerminalColors,
): void {
	span.textContent = run.text;
	const { style } = run;
	const swapColors = style.inverse;
	const fg =
		(swapColors ? run.bg : run.fg) ?? (swapColors ? colors.background : null);
	const bg =
		(swapColors ? run.fg : run.bg) ?? (swapColors ? colors.foreground : null);
	if (fg !== null) {
		span.style.setProperty("--plain-terminal-cell-fg", rgbCss(fg));
	} else {
		span.style.removeProperty("--plain-terminal-cell-fg");
	}
	if (bg !== null) {
		span.style.setProperty("--plain-terminal-cell-bg", rgbCss(bg));
	} else {
		span.style.removeProperty("--plain-terminal-cell-bg");
	}

	const classes = ["plain-terminal-cell"];
	if (style.bold) classes.push("plain-terminal-cell--bold");
	if (style.italic) classes.push("plain-terminal-cell--italic");
	if (style.faint) classes.push("plain-terminal-cell--faint");
	if (style.blink) classes.push("plain-terminal-cell--blink");
	if (style.invisible) classes.push("plain-terminal-cell--invisible");
	if (run.semantic !== "output") {
		classes.push(`plain-terminal-cell--semantic-${run.semantic}`);
	}
	if (run.clickableLink !== null) {
		classes.push("plain-terminal-cell--link");
		span.dataset.plainTerminalLink = run.clickableLink;
		span.title = `Cmd/Ctrl+Click to open ${run.clickableLink}`;
	} else {
		delete span.dataset.plainTerminalLink;
		span.removeAttribute("title");
	}
	span.className = classes.join(" ");

	const decorations: string[] = [];
	if (style.underline !== "none") decorations.push("underline");
	if (style.strikethrough) decorations.push("line-through");
	if (style.overline) decorations.push("overline");
	if (decorations.length > 0) {
		span.style.textDecorationLine = decorations.join(" ");
		span.style.textDecorationStyle = underlineCssStyle(style.underline);
	} else {
		span.style.textDecorationLine = "none";
		span.style.textDecorationStyle = "";
	}
}

function underlineCssStyle(underline: TerminalStyle["underline"]): string {
	switch (underline) {
		case "double":
			return "double";
		case "curly":
			return "wavy";
		case "dotted":
			return "dotted";
		case "dashed":
			return "dashed";
		default:
			return "solid";
	}
}

function cursorCssClassForStyle(style: TerminalCursorStyle): string {
	switch (style) {
		case "bar":
			return "plain-terminal-cursor--bar";
		case "underline":
			return "plain-terminal-cursor--underline";
		case "blockHollow":
			return "plain-terminal-cursor--block-hollow";
		default:
			return "plain-terminal-cursor--block";
	}
}

export interface PlainTerminalRendererOptions {
	readonly container: HTMLElement;
	/** Invoked once per painted animation-frame batch, with the highest
	 * `sequence` folded into that batch — drives `TerminalStream.ack` (see
	 * `PlainTerminalView`). Frame-level ack coalescing (painting once for
	 * several frames that arrived within the same tick, then acking only
	 * the newest) is intentional — see `terminal-stream.ts`'s own doc
	 * comment on frame-level backpressure. */
	readonly onFramePainted: (sequence: number) => void;
	/** Defaults to `requestAnimationFrame`; overridable so a future test
	 * harness with a real DOM can drive painting deterministically without
	 * waiting on a real animation frame. */
	readonly scheduleRepaint?: (callback: () => void) => void;
	/**
	 * Invoked when the user Cmd/Ctrl+Clicks a cell carrying a clickable
	 * (`http:`/`https:`) OSC 8 hyperlink (F190 S4 "Ghostty metadata and
	 * links") — a *plain* click (no modifier) never invokes this, and a
	 * click on a cell with no hyperlink, or one whose scheme
	 * [`isClickableHyperlinkUrl`] rejected, never invokes this either. The
	 * only side effect this renderer itself performs is calling this
	 * callback with the exact URL text the cell carried — actually opening
	 * it (through the audited `terminalOpenExternalLink` bridge call) is the
	 * caller's job, not this DOM-only paint layer's.
	 */
	readonly onExternalLinkClick?: (url: string) => void;
}

/**
 * DOM paint layer for one terminal session's grid. Builds one row `<div>`
 * per visible row (each containing one `<span>` per same-styled cell run —
 * see `groupRowRuns`) plus one absolutely-positioned cursor overlay,
 * batching multiple `applyFrame` calls that land within the same animation
 * frame into a single DOM paint pass (`requestAnimationFrame` coalescing —
 * see the module's F070 doc section).
 */
export class PlainTerminalRenderer {
	readonly #container: HTMLElement;
	readonly #grid: HTMLElement;
	readonly #cursorElement: HTMLElement;
	readonly #measureProbe: HTMLElement;
	readonly #onFramePainted: (sequence: number) => void;
	readonly #scheduleRepaint: (callback: () => void) => void;
	readonly #model = new TerminalGridModel();
	readonly #rowElements: HTMLElement[] = [];

	#pendingRebuild = false;
	#pendingRows = new Set<number>();
	#pendingSequence: number | undefined;
	#paintScheduled = false;
	/** See the module doc's "Scrollback view mode" section. */
	#viewMode: "live" | "history" = "live";
	/** F190 S4: the row `jumpToAdjacentPrompt` last landed on — the anchor
	 * the *next* call searches relative to, so repeated "previous"/"next"
	 * invocations walk further rather than re-finding the same row. */
	#promptAnchorRow: number | undefined;

	constructor(options: PlainTerminalRendererOptions) {
		this.#container = options.container;
		this.#onFramePainted = options.onFramePainted;
		this.#scheduleRepaint =
			options.scheduleRepaint ??
			((callback) => {
				const view = options.container.ownerDocument.defaultView;
				if (view === null || view === undefined) {
					setTimeout(callback, 0);
					return;
				}
				view.requestAnimationFrame(() => callback());
			});

		this.#container.classList.add("plain-terminal-surface");

		this.#grid = this.#container.ownerDocument.createElement("div");
		this.#grid.className = "plain-terminal-grid";

		this.#cursorElement = this.#container.ownerDocument.createElement("div");
		this.#cursorElement.className = "plain-terminal-cursor";

		this.#measureProbe = this.#container.ownerDocument.createElement("span");
		this.#measureProbe.className = "plain-terminal-measure-probe";
		this.#measureProbe.setAttribute("aria-hidden", "true");
		this.#measureProbe.textContent = "X".repeat(50);

		this.#container.append(this.#grid, this.#cursorElement, this.#measureProbe);

		const onExternalLinkClick = options.onExternalLinkClick;
		if (onExternalLinkClick !== undefined) {
			this.#grid.addEventListener("click", (event) => {
				if (!(event.metaKey || event.ctrlKey)) {
					// A plain click (no modifier) is ordinary text
					// selection/cursor placement — never a link activation. See
					// `PlainTerminalRendererOptions.onExternalLinkClick`'s doc.
					return;
				}
				const target = event.target;
				if (!(target instanceof HTMLElement)) {
					return;
				}
				const linkSpan = target.closest<HTMLElement>(
					"[data-plain-terminal-link]",
				);
				const url = linkSpan?.dataset.plainTerminalLink;
				if (url === undefined) {
					return;
				}
				onExternalLinkClick(url);
			});
		}
	}

	/** One monospace cell's pixel size, measured once per call against the
	 * currently-applied stylesheet (cheap — a single `getBoundingClientRect`
	 * call). `PlainTerminalView` uses this (together with a
	 * `ResizeObserver` on the surrounding container) to compute the
	 * cols/rows to request via `TerminalStream.resize`. */
	measureCellSizePx(): { readonly width: number; readonly height: number } {
		const rect = this.#measureProbe.getBoundingClientRect();
		return Object.freeze({ width: rect.width / 50, height: rect.height });
	}

	/** The live grid's current row/column count — `TerminalPaneController`
	 * uses these to size its scrollback fetch window (see
	 * `plain-terminal-pane.ts`), not just for layout. */
	get rows(): number {
		return this.#model.rows;
	}

	get cols(): number {
		return this.#model.cols;
	}

	/** `true` while showing a fetched scrollback window instead of the live
	 * viewport — see the module doc's "Scrollback view mode" section. */
	get isViewingHistory(): boolean {
		return this.#viewMode === "history";
	}

	/**
	 * Paints `rows` (oldest first, at most [`rows`][PlainTerminalRenderer#rows]
	 * entries — see the module doc) as a static scrollback window, hiding the
	 * cursor, and stops applying further live paints until [`showLive`] is
	 * called again. Fewer rows than the viewport height are padded with
	 * blank rows *above* the real content, so the newest of `rows` always
	 * lands on the viewport's bottom line — the same "not enough history yet"
	 * blank space a real terminal shows near the very top of its scrollback.
	 */
	showScrollbackRows(rows: readonly TerminalScrollbackRow[]): void {
		if (this.#rowElements.length === 0) {
			// No live frame has painted yet (so there is no row DOM to reuse,
			// and no sensible cols/rows to align against) — scrolling before a
			// session has ever rendered anything is a no-op.
			return;
		}
		this.#viewMode = "history";
		const viewportRows = this.#model.rows;
		const cols = this.#model.cols;
		const visible = rows.slice(Math.max(0, rows.length - viewportRows));
		const padCount = Math.max(0, viewportRows - visible.length);
		const colors = this.#model.colors;
		if (colors === undefined) {
			return;
		}
		for (let index = 0; index < padCount; index += 1) {
			const rowElement = this.#rowElements[index];
			if (rowElement !== undefined) {
				this.#paintRowCells(rowElement, blankRow(cols), colors);
			}
		}
		for (const [offset, row] of visible.entries()) {
			const rowElement = this.#rowElements[padCount + offset];
			if (rowElement === undefined) {
				continue;
			}
			const cells = normalizedRowCells(
				row.cells.map(scrollbackCellAsTerminalCell),
				cols,
			);
			this.#paintRowCells(rowElement, cells, colors);
		}
		this.#cursorElement.style.display = "none";
	}

	/** Returns to the live viewport, immediately repainting every row (and
	 * the cursor) from the retained model's *current* state — frames kept
	 * updating that model the whole time a pane was showing history (see the
	 * module doc), so this reflects up-to-the-moment content, not whatever
	 * was last live before scrolling away. A no-op if already live. */
	showLive(): void {
		if (this.#viewMode === "live") {
			return;
		}
		this.#viewMode = "live";
		for (let rowIndex = 0; rowIndex < this.#model.rows; rowIndex += 1) {
			this.#paintRow(rowIndex);
		}
		this.#paintCursor();
	}

	/**
	 * F190 S4 "Ghostty metadata and links": finds the nearest retained
	 * *live-viewport* row (see the module doc — scrollback rows carry no
	 * semantic tagging in this slice, so this never searches into history)
	 * whose OSC 133 classification is a primary prompt line (`"prompt"`, not
	 * `"continuation"` or `"none"`), relative to `#promptAnchorRow` (or the
	 * bottom-most row on the very first call), and briefly highlights it
	 * (`plain-terminal-row--prompt-target`, cleared after ~1.2s) so the
	 * caller has something to actually see happen. Returns the found row
	 * index, or `undefined` if there is no such row in the search direction
	 * (the anchor is left unchanged in that case — a "previous"/"next" that
	 * finds nothing is a no-op, not a wrap-around).
	 */
	jumpToAdjacentPrompt(direction: "previous" | "next"): number | undefined {
		const promptRows: number[] = [];
		for (let rowIndex = 0; rowIndex < this.#model.rows; rowIndex += 1) {
			if (this.#model.rowSemanticPrompt(rowIndex) === "prompt") {
				promptRows.push(rowIndex);
			}
		}
		const anchor = this.#promptAnchorRow ?? this.#model.rows;
		let target: number | undefined;
		if (direction === "previous") {
			for (let index = promptRows.length - 1; index >= 0; index -= 1) {
				if (promptRows[index]! < anchor) {
					target = promptRows[index];
					break;
				}
			}
		} else {
			for (const rowIndex of promptRows) {
				if (rowIndex > anchor) {
					target = rowIndex;
					break;
				}
			}
		}
		if (target === undefined) {
			return undefined;
		}
		this.#promptAnchorRow = target;
		this.#flashRow(target);
		return target;
	}

	#flashRow(rowIndex: number): void {
		const rowElement = this.#rowElements[rowIndex];
		if (rowElement === undefined) {
			return;
		}
		rowElement.classList.add("plain-terminal-row--prompt-target");
		const view = this.#container.ownerDocument.defaultView;
		const clear = () => {
			rowElement.classList.remove("plain-terminal-row--prompt-target");
		};
		if (view === null || view === undefined) {
			clear();
			return;
		}
		view.setTimeout(clear, 1_200);
	}

	/** Applies one frame onto the retained model, then schedules (but does
	 * not immediately perform) a DOM paint — see the class doc comment for
	 * why multiple calls within one animation frame coalesce into a single
	 * paint pass and a single `onFramePainted` ack. */
	applyFrame(frame: TerminalFrame, sequence: number): void {
		const result = this.#model.applyFrame(frame);
		if (result.rebuilt) {
			this.#pendingRebuild = true;
			this.#pendingRows.clear();
		} else {
			for (const rowIndex of result.changedRowIndices) {
				this.#pendingRows.add(rowIndex);
			}
		}
		this.#pendingSequence =
			this.#pendingSequence === undefined
				? sequence
				: Math.max(this.#pendingSequence, sequence);

		if (!this.#paintScheduled) {
			this.#paintScheduled = true;
			this.#scheduleRepaint(() => this.#paint());
		}
	}

	#paint(): void {
		this.#paintScheduled = false;
		const rebuild = this.#pendingRebuild;
		const rows = this.#pendingRows;
		const sequence = this.#pendingSequence;
		this.#pendingRebuild = false;
		this.#pendingRows = new Set();
		this.#pendingSequence = undefined;

		if (this.#viewMode === "history" && rebuild) {
			// Dimensions changed (or a full redraw arrived) while a pane was
			// showing history — the cached window's shape no longer matches
			// the grid it was painted into. See the module doc's "Scrollback
			// view mode" section for why falling back to live here (rather
			// than trying to re-align a stale window) is this slice's chosen
			// behavior.
			this.#viewMode = "live";
		} else if (this.#viewMode === "history") {
			// Model already absorbed this frame above (via `applyFrame`); the
			// on-screen history view itself is left untouched, but backpressure
			// still needs this frame acked exactly as if it had been painted —
			// see the module doc.
			if (sequence !== undefined) {
				this.#onFramePainted(sequence);
			}
			return;
		}

		const colors = this.#model.colors;
		if (colors === undefined) {
			return;
		}

		this.#container.style.setProperty(
			"--plain-terminal-fg",
			rgbCss(colors.foreground),
		);
		this.#container.style.setProperty(
			"--plain-terminal-bg",
			rgbCss(colors.background),
		);

		if (rebuild) {
			this.#rowElements.length = 0;
			this.#grid.replaceChildren();
			for (let rowIndex = 0; rowIndex < this.#model.rows; rowIndex += 1) {
				const rowElement = this.#container.ownerDocument.createElement("div");
				rowElement.className = "plain-terminal-row";
				this.#rowElements.push(rowElement);
				this.#grid.append(rowElement);
				this.#paintRow(rowIndex);
			}
		} else {
			for (const rowIndex of rows) {
				this.#paintRow(rowIndex);
			}
		}

		this.#paintCursor();

		if (sequence !== undefined) {
			this.#onFramePainted(sequence);
		}
	}

	#paintRow(rowIndex: number): void {
		const rowElement = this.#rowElements[rowIndex];
		const cells = this.#model.rowCells(rowIndex);
		const colors = this.#model.colors;
		if (
			rowElement === undefined ||
			cells === undefined ||
			colors === undefined
		) {
			return;
		}
		this.#paintRowCells(rowElement, cells, colors);
	}

	/** Shared by the live-model path ([`#paintRow`]) and the scrollback path
	 * ([`showScrollbackRows`]) — paints an arbitrary cell array into
	 * `rowElement`, reusing its existing `<span>` run elements where
	 * possible. */
	#paintRowCells(
		rowElement: HTMLElement,
		cells: readonly TerminalCell[],
		colors: TerminalColors,
	): void {
		const runs = groupRowRuns(cells);
		const spans = rowElement.children;
		while (spans.length > runs.length) {
			spans[spans.length - 1]?.remove();
		}
		for (const [index, run] of runs.entries()) {
			let span = spans[index] as HTMLSpanElement | undefined;
			if (span === undefined) {
				span = this.#container.ownerDocument.createElement("span");
				rowElement.append(span);
			}
			applyRunToSpan(span, run, colors);
		}
	}

	#paintCursor(): void {
		const cursor = this.#model.cursor;
		const cellSize = this.measureCellSizePx();
		if (cursor === undefined || !cursor.visible || cursor.viewport === null) {
			this.#cursorElement.style.display = "none";
			return;
		}
		this.#cursorElement.style.display = "block";
		this.#cursorElement.style.left = `${cursor.viewport.x * cellSize.width}px`;
		this.#cursorElement.style.top = `${cursor.viewport.y * cellSize.height}px`;
		this.#cursorElement.style.width = `${cellSize.width}px`;
		this.#cursorElement.style.height = `${cellSize.height}px`;
		this.#cursorElement.className = [
			"plain-terminal-cursor",
			cursorCssClassForStyle(cursor.style),
			cursor.blinking ? "plain-terminal-cursor--blinking" : "",
		]
			.filter((value) => value.length > 0)
			.join(" ");
	}

	dispose(): void {
		this.#grid.remove();
		this.#cursorElement.remove();
		this.#measureProbe.remove();
	}
}
