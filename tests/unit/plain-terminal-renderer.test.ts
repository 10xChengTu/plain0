import { describe, expect, it } from "vitest";

import type {
	TerminalCell,
	TerminalColors,
	TerminalCursor,
	TerminalFrame,
	TerminalRow,
	TerminalStyle,
} from "../../app/platform/tauri/contracts";
import { TerminalGridModel } from "../../app/features/terminal/plain-terminal-renderer";

const DEFAULT_STYLE: TerminalStyle = Object.freeze({
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

const DEFAULT_COLORS: TerminalColors = Object.freeze({
	background: { r: 0, g: 0, b: 0 },
	foreground: { r: 229, g: 229, b: 229 },
	cursor: null,
});

function cell(
	graphemes: string,
	overrides: Partial<TerminalCell> = {},
): TerminalCell {
	return Object.freeze({
		graphemes,
		fg: null,
		bg: null,
		style: DEFAULT_STYLE,
		...overrides,
	});
}

function row(rowIndex: number, cells: readonly TerminalCell[]): TerminalRow {
	return Object.freeze({ rowIndex, cells });
}

function cursorAt(x: number, y: number): TerminalCursor {
	return Object.freeze({
		visible: true,
		blinking: false,
		viewport: Object.freeze({ x, y, atWideTail: false }),
		style: "block",
	});
}

function frame(overrides: Partial<TerminalFrame> = {}): TerminalFrame {
	return Object.freeze({
		dirty: "full",
		cols: 4,
		rows: 2,
		cursor: cursorAt(0, 0),
		colors: DEFAULT_COLORS,
		rowsData: [],
		...overrides,
	});
}

describe("TerminalGridModel", () => {
	it("applies a full frame by populating every row and reporting every index as changed", () => {
		const model = new TerminalGridModel();
		const result = model.applyFrame(
			frame({
				dirty: "full",
				rowsData: [
					row(0, [cell("h"), cell("i"), cell(""), cell("")]),
					row(1, [cell("!"), cell(""), cell(""), cell("")]),
				],
			}),
		);

		expect(result.rebuilt).toBe(true);
		expect(result.changedRowIndices).toEqual([0, 1]);
		expect(model.cols).toBe(4);
		expect(model.rows).toBe(2);
		expect(model.cellAt(0, 0)?.graphemes).toBe("h");
		expect(model.cellAt(0, 1)?.graphemes).toBe("i");
		expect(model.cellAt(1, 0)?.graphemes).toBe("!");
	});

	it("leaves rows untouched by a subsequent partial frame and only reports the changed ones", () => {
		const model = new TerminalGridModel();
		model.applyFrame(
			frame({
				dirty: "full",
				rowsData: [
					row(0, [cell("a"), cell("b"), cell(""), cell("")]),
					row(1, [cell("c"), cell("d"), cell(""), cell("")]),
				],
			}),
		);

		const result = model.applyFrame(
			frame({
				dirty: "partial",
				rowsData: [row(1, [cell("z"), cell(""), cell(""), cell("")])],
			}),
		);

		expect(result.rebuilt).toBe(false);
		expect(result.changedRowIndices).toEqual([1]);
		// Row 0 is untouched by the partial frame.
		expect(model.cellAt(0, 0)?.graphemes).toBe("a");
		expect(model.cellAt(0, 1)?.graphemes).toBe("b");
		// Row 1 reflects the partial update.
		expect(model.cellAt(1, 0)?.graphemes).toBe("z");
		expect(model.cellAt(1, 1)?.graphemes).toBe("");
	});

	it("reports no changed rows for a clean frame with no rowsData, but still updates cursor/colors", () => {
		const model = new TerminalGridModel();
		model.applyFrame(
			frame({
				dirty: "full",
				rowsData: [row(0, [cell("a"), cell(""), cell(""), cell("")])],
			}),
		);

		const nextColors: TerminalColors = Object.freeze({
			background: { r: 10, g: 10, b: 10 },
			foreground: { r: 250, g: 250, b: 250 },
			cursor: { r: 255, g: 0, b: 0 },
		});
		const result = model.applyFrame(
			frame({
				dirty: "clean",
				rowsData: [],
				cursor: cursorAt(2, 1),
				colors: nextColors,
			}),
		);

		expect(result.rebuilt).toBe(false);
		expect(result.changedRowIndices).toEqual([]);
		expect(model.cursor).toEqual(cursorAt(2, 1));
		expect(model.colors).toEqual(nextColors);
		// Row content from the earlier full frame is preserved.
		expect(model.cellAt(0, 0)?.graphemes).toBe("a");
	});

	it("force-rebuilds (even under a partial dirty flag) when the frame's dimensions differ from what is retained", () => {
		const model = new TerminalGridModel();
		model.applyFrame(
			frame({
				cols: 4,
				rows: 2,
				dirty: "full",
				rowsData: [row(0, [cell("a"), cell(""), cell(""), cell("")])],
			}),
		);

		const result = model.applyFrame(
			frame({
				cols: 2,
				rows: 3,
				dirty: "partial",
				rowsData: [row(0, [cell("x"), cell("y")])],
			}),
		);

		expect(result.rebuilt).toBe(true);
		expect(result.changedRowIndices).toEqual([0, 1, 2]);
		expect(model.cols).toBe(2);
		expect(model.rows).toBe(3);
		expect(model.cellAt(0, 0)?.graphemes).toBe("x");
		// Rows the new, smaller frame never mentioned are blanked, not stale.
		expect(model.cellAt(1, 0)?.graphemes).toBe("");
	});

	it("drops a rowsData entry whose rowIndex falls outside the current grid instead of corrupting state", () => {
		const model = new TerminalGridModel();
		const result = model.applyFrame(
			frame({
				cols: 2,
				rows: 1,
				dirty: "full",
				rowsData: [
					row(0, [cell("a"), cell("b")]),
					row(5, [cell("z"), cell("z")]),
				],
			}),
		);

		expect(result.changedRowIndices).toEqual([0]);
		expect(model.rowCells(5)).toBeUndefined();
		expect(model.cellAt(0, 0)?.graphemes).toBe("a");
	});

	it("pads a row whose cells array is shorter than cols with blank cells", () => {
		const model = new TerminalGridModel();
		model.applyFrame(
			frame({
				cols: 4,
				rows: 1,
				dirty: "full",
				rowsData: [row(0, [cell("a")])],
			}),
		);

		expect(model.cellAt(0, 0)?.graphemes).toBe("a");
		expect(model.cellAt(0, 1)?.graphemes).toBe("");
		expect(model.cellAt(0, 3)?.graphemes).toBe("");
	});

	it("starts with an empty grid before any frame is applied", () => {
		const model = new TerminalGridModel();
		expect(model.cols).toBe(0);
		expect(model.rows).toBe(0);
		expect(model.cursor).toBeUndefined();
		expect(model.colors).toBeUndefined();
		expect(model.cellAt(0, 0)).toBeUndefined();
	});
});
