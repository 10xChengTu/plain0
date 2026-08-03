import { describe, expect, it } from "vitest";

import type { TerminalScrollbackRow } from "../../app/platform/tauri/contracts";
import {
	TERMINAL_FIND_MAX_MATCHES,
	TERMINAL_FIND_MAX_QUERY_LENGTH,
	terminalScrollbackRowText,
	TerminalFindController,
} from "../../app/features/terminal/plain-terminal-find";

describe("TerminalFindController", () => {
	it("starts with no query, no matches and no active index", () => {
		const controller = new TerminalFindController();

		expect(controller.state).toEqual({
			query: "",
			caseSensitive: false,
			matches: [],
			activeMatchIndex: undefined,
			queryTruncated: false,
			matchesTruncated: false,
		});
	});

	it("an empty query yields zero matches even against non-empty lines", () => {
		const controller = new TerminalFindController();
		controller.setLines(["hello world", "hello again"]);

		const state = controller.setQuery("");

		expect(state.matches).toEqual([]);
		expect(state.activeMatchIndex).toBeUndefined();
	});

	it("finds every non-overlapping match across multiple lines, in order", () => {
		const controller = new TerminalFindController();
		controller.setLines(["foo bar foo", "no match here", "foo"]);

		const state = controller.setQuery("foo");

		expect(state.matches).toEqual([
			{ lineIndex: 0, start: 0, end: 3 },
			{ lineIndex: 0, start: 8, end: 11 },
			{ lineIndex: 2, start: 0, end: 3 },
		]);
		expect(state.activeMatchIndex).toBe(0);
	});

	it("matches on a line are non-overlapping (advances past each match's own end)", () => {
		const controller = new TerminalFindController();
		controller.setLines(["aaaa"]);

		const state = controller.setQuery("aa");

		// Non-overlapping: positions 0-2 and 2-4, never also 1-3.
		expect(state.matches).toEqual([
			{ lineIndex: 0, start: 0, end: 2 },
			{ lineIndex: 0, start: 2, end: 4 },
		]);
	});

	it("is case-insensitive by default", () => {
		const controller = new TerminalFindController();
		controller.setLines(["Hello HELLO hello"]);

		const state = controller.setQuery("hello");

		expect(state.matches).toHaveLength(3);
	});

	it("case-sensitive mode only matches the exact case, and toggling changes the match set", () => {
		const controller = new TerminalFindController();
		controller.setLines(["Hello HELLO hello"]);
		controller.setQuery("hello");

		const sensitive = controller.setCaseSensitive(true);
		expect(sensitive.matches).toEqual([{ lineIndex: 0, start: 12, end: 17 }]);
		expect(sensitive.caseSensitive).toBe(true);

		const insensitiveAgain = controller.setCaseSensitive(false);
		expect(insensitiveAgain.matches).toHaveLength(3);
	});

	it("next/previous wrap around the match list", () => {
		const controller = new TerminalFindController();
		controller.setLines(["a a a"]);
		controller.setQuery("a");
		expect(controller.state.matches).toHaveLength(3);
		expect(controller.state.activeMatchIndex).toBe(0);

		expect(controller.next().activeMatchIndex).toBe(1);
		expect(controller.next().activeMatchIndex).toBe(2);
		// Wraps from the last match back to the first.
		expect(controller.next().activeMatchIndex).toBe(0);

		// Wraps backward from the first match to the last.
		expect(controller.previous().activeMatchIndex).toBe(2);
		expect(controller.previous().activeMatchIndex).toBe(1);
	});

	it("next/previous on a single match stay on it (self-wrap)", () => {
		const controller = new TerminalFindController();
		controller.setLines(["only one match"]);
		controller.setQuery("only");

		expect(controller.next().activeMatchIndex).toBe(0);
		expect(controller.previous().activeMatchIndex).toBe(0);
	});

	it("next/previous are no-ops with zero matches", () => {
		const controller = new TerminalFindController();
		controller.setLines(["nothing here"]);
		controller.setQuery("zzz");

		expect(controller.next().activeMatchIndex).toBeUndefined();
		expect(controller.previous().activeMatchIndex).toBeUndefined();
	});

	it("truncates a query longer than TERMINAL_FIND_MAX_QUERY_LENGTH and reports it", () => {
		const controller = new TerminalFindController();
		const longQuery = "x".repeat(TERMINAL_FIND_MAX_QUERY_LENGTH + 50);

		const state = controller.setQuery(longQuery);

		expect(state.query).toHaveLength(TERMINAL_FIND_MAX_QUERY_LENGTH);
		expect(state.query).toBe("x".repeat(TERMINAL_FIND_MAX_QUERY_LENGTH));
		expect(state.queryTruncated).toBe(true);
	});

	it("does not report queryTruncated for a query within the limit", () => {
		const controller = new TerminalFindController();

		const state = controller.setQuery(
			"x".repeat(TERMINAL_FIND_MAX_QUERY_LENGTH),
		);

		expect(state.queryTruncated).toBe(false);
	});

	it("stops at TERMINAL_FIND_MAX_MATCHES and reports matchesTruncated", () => {
		const controller = new TerminalFindController();
		// Far more than the cap: one line, every character an 'a'.
		controller.setLines(["a".repeat(TERMINAL_FIND_MAX_MATCHES * 4)]);

		const state = controller.setQuery("a");

		expect(state.matches).toHaveLength(TERMINAL_FIND_MAX_MATCHES);
		expect(state.matchesTruncated).toBe(true);
	});

	it("does not report matchesTruncated when the true match count is within the cap", () => {
		const controller = new TerminalFindController();
		controller.setLines(["a a a"]);

		const state = controller.setQuery("a");

		expect(state.matchesTruncated).toBe(false);
	});

	it("setLines replaces the corpus and re-runs the current query, resetting to the first match", () => {
		const controller = new TerminalFindController();
		controller.setLines(["foo"]);
		controller.setQuery("foo");
		controller.next(); // still index 0 (only one match, self-wrap)

		const state = controller.setLines(["nothing", "foo here", "foo there"]);

		expect(state.matches).toEqual([
			{ lineIndex: 1, start: 0, end: 3 },
			{ lineIndex: 2, start: 0, end: 3 },
		]);
		expect(state.activeMatchIndex).toBe(0);
	});

	it("reset clears query, matches, case sensitivity and truncation flags", () => {
		const controller = new TerminalFindController();
		controller.setLines(["a".repeat(TERMINAL_FIND_MAX_MATCHES * 2)]);
		controller.setCaseSensitive(true);
		controller.setQuery("a");
		expect(controller.state.matches.length).toBeGreaterThan(0);

		const state = controller.reset();

		expect(state).toEqual({
			query: "",
			caseSensitive: false,
			matches: [],
			activeMatchIndex: undefined,
			queryTruncated: false,
			matchesTruncated: false,
		});
	});

	it("a match spanning a line boundary never happens (each match stays within one line)", () => {
		const controller = new TerminalFindController();
		controller.setLines(["abc", "def"]);

		const state = controller.setQuery("cd");

		expect(state.matches).toEqual([]);
	});
});

describe("terminalScrollbackRowText", () => {
	const style = Object.freeze({
		bold: false,
		italic: false,
		faint: false,
		blink: false,
		inverse: false,
		invisible: false,
		strikethrough: false,
		overline: false,
		underline: "none",
	} as const);

	function row(
		...cells: readonly { readonly graphemes: string }[]
	): TerminalScrollbackRow {
		return Object.freeze({
			rowIndex: 0,
			cells: cells.map((cell) =>
				Object.freeze({ graphemes: cell.graphemes, style }),
			),
		});
	}

	it("joins cell graphemes, treating an empty cell as a space", () => {
		const text = terminalScrollbackRowText(
			row({ graphemes: "h" }, { graphemes: "i" }, { graphemes: "" }),
		);

		expect(text).toBe("hi");
	});

	it("trims trailing blank cells but keeps interior spacing", () => {
		const text = terminalScrollbackRowText(
			row(
				{ graphemes: "a" },
				{ graphemes: "" },
				{ graphemes: "b" },
				{ graphemes: "" },
				{ graphemes: "" },
			),
		);

		expect(text).toBe("a b");
	});

	it("returns an empty string for an all-blank row", () => {
		const text = terminalScrollbackRowText(
			row({ graphemes: "" }, { graphemes: "" }),
		);

		expect(text).toBe("");
	});
});
