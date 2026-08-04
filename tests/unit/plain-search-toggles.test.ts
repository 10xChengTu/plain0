import { describe, expect, it } from "vitest";

import {
	buildSearchContentPattern,
	toggleAriaPressed,
} from "../../app/features/search/plain-search-toggles";

describe("toggleAriaPressed", () => {
	it('flips off ("false") to on (true)', () => {
		expect(toggleAriaPressed("false")).toBe(true);
	});

	it('flips on ("true") to off (false)', () => {
		expect(toggleAriaPressed("true")).toBe(false);
	});

	it("treats a never-set attribute (null, the DOM default before renderBody sets it) as off, flipping to on", () => {
		expect(toggleAriaPressed(null)).toBe(true);
	});

	it("treats any other stray value as off, flipping to on (fail-closed, not fail-open)", () => {
		expect(toggleAriaPressed("")).toBe(true);
		expect(toggleAriaPressed("TRUE")).toBe(true);
	});
});

describe("buildSearchContentPattern", () => {
	it("F200 S1 regression contract: all three toggles false reproduces the pre-F200 request body byte-for-byte", () => {
		expect(
			buildSearchContentPattern("needle", {
				isRegExp: false,
				isCaseSensitive: false,
				isWordMatch: false,
			}),
		).toEqual({
			pattern: "needle",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
		});
	});

	it("maps the case-sensitivity toggle straight through to isCaseSensitive", () => {
		expect(
			buildSearchContentPattern("Needle", {
				isRegExp: false,
				isCaseSensitive: true,
				isWordMatch: false,
			}),
		).toEqual({
			pattern: "Needle",
			isRegExp: false,
			isCaseSensitive: true,
			isWordMatch: false,
		});
	});

	it("maps the whole-word toggle straight through to isWordMatch", () => {
		expect(
			buildSearchContentPattern("cat", {
				isRegExp: false,
				isCaseSensitive: false,
				isWordMatch: true,
			}),
		).toEqual({
			pattern: "cat",
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: true,
		});
	});

	it("all four fields are independent — every combination is preserved exactly, none coupled to another", () => {
		expect(
			buildSearchContentPattern("(a|b)", {
				isRegExp: true,
				isCaseSensitive: true,
				isWordMatch: true,
			}),
		).toEqual({
			pattern: "(a|b)",
			isRegExp: true,
			isCaseSensitive: true,
			isWordMatch: true,
		});
	});
});
