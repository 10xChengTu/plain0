import { describe, expect, it } from "vitest";

import {
	computeContentAfterApplyingHunk,
	countHunks,
} from "../../app/features/scm/hunk-stage";

describe("computeContentAfterApplyingHunk", () => {
	it("applies only the first of two independent hunks", () => {
		const original = "one\ntwo\nthree\n".slice(0, -1);
		const modified = "ONE\ntwo\nTHREE";
		const result = computeContentAfterApplyingHunk(original, modified, 0);
		expect(result).toBe("ONE\ntwo\nthree");
	});

	it("applies the second hunk when index 1 is requested", () => {
		const original = "one\ntwo\nthree";
		const modified = "ONE\ntwo\nTHREE";
		const result = computeContentAfterApplyingHunk(original, modified, 1);
		expect(result).toBe("one\ntwo\nTHREE");
	});

	it("returns the full modified content when there is exactly one hunk", () => {
		const original = "alpha\nbeta\ngamma";
		const modified = "alpha\nBETA\ngamma";
		const result = computeContentAfterApplyingHunk(original, modified, 0);
		expect(result).toBe("alpha\nBETA\ngamma");
	});

	it("returns undefined when there is no such hunk", () => {
		const original = "same\ncontent";
		const modified = "same\ncontent";
		expect(
			computeContentAfterApplyingHunk(original, modified, 0),
		).toBeUndefined();
	});

	it("returns undefined when hunkIndex exceeds the number of hunks", () => {
		const original = "one\ntwo";
		const modified = "ONE\ntwo";
		expect(
			computeContentAfterApplyingHunk(original, modified, 1),
		).toBeUndefined();
	});

	it("applies a hunk that adds brand-new lines (empty original range)", () => {
		const original = "one\ntwo";
		const modified = "one\ninserted\ntwo";
		const result = computeContentAfterApplyingHunk(original, modified, 0);
		expect(result).toBe("one\ninserted\ntwo");
	});

	it("applies a hunk that deletes lines entirely (empty modified range)", () => {
		const original = "one\ntwo\nthree";
		const modified = "one\nthree";
		const result = computeContentAfterApplyingHunk(original, modified, 0);
		expect(result).toBe("one\nthree");
	});

	it("handles a brand-new file (empty original text)", () => {
		const result = computeContentAfterApplyingHunk("", "brand new content", 0);
		expect(result).toBe("brand new content");
	});
});

describe("countHunks", () => {
	it("counts zero for identical content", () => {
		expect(countHunks("same", "same")).toBe(0);
	});

	it("counts two for two independent changed line ranges", () => {
		expect(countHunks("one\ntwo\nthree", "ONE\ntwo\nTHREE")).toBe(2);
	});

	it("counts one for a single contiguous change", () => {
		expect(countHunks("one\ntwo\nthree", "one\nTWO\nthree")).toBe(1);
	});
});
