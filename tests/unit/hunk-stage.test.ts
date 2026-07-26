import { describe, expect, it } from "vitest";

import {
	computeContentAfterApplyingHunk,
	countHunks,
	decodeLosslessUtf8,
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

describe("decodeLosslessUtf8", () => {
	it("decodes a UTF-8 BOM prefix into a leading U+FEFF and round-trips exactly", () => {
		const bytes = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode("hello"),
		]);
		const decoded = decodeLosslessUtf8(bytes);
		expect(decoded).not.toBeUndefined();
		expect(decoded?.startsWith("﻿")).toBe(true);
		expect(new TextEncoder().encode(decoded as string)).toEqual(bytes);
	});

	it("refuses invalid UTF-8 (a Latin-1 byte sequence with a dangling lead byte)", () => {
		// "Hell" followed by a lone 0xE9 — a Latin-1 "é" byte that is an
		// incomplete/invalid UTF-8 lead byte in this position.
		const bytes = new Uint8Array([...new TextEncoder().encode("Hell"), 0xe9]);
		expect(decodeLosslessUtf8(bytes)).toBeUndefined();
	});

	it("refuses a lone-surrogate WTF-8-style byte sequence", () => {
		// Non-standard 3-byte WTF-8 encoding of a lone UTF-16 high surrogate
		// U+D800 — real UTF-8 forbids surrogate code points entirely.
		const bytes = new Uint8Array([0xed, 0xa0, 0x80]);
		expect(decodeLosslessUtf8(bytes)).toBeUndefined();
	});

	it("decodes plain ASCII with no BOM and round-trips exactly (regression guard)", () => {
		const bytes = new TextEncoder().encode("hello world");
		const decoded = decodeLosslessUtf8(bytes);
		expect(decoded).toBe("hello world");
		expect(new TextEncoder().encode(decoded as string)).toEqual(bytes);
	});

	it("decodes valid non-ASCII UTF-8 with no BOM and round-trips exactly", () => {
		const original = "café 😀";
		const bytes = new TextEncoder().encode(original);
		const decoded = decodeLosslessUtf8(bytes);
		expect(decoded).toBe(original);
		expect(new TextEncoder().encode(decoded as string)).toEqual(bytes);
	});
});
