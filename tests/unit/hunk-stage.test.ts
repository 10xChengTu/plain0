import { describe, expect, it } from "vitest";

import {
	computeContentAfterApplyingSelectedHunks,
	createHunkSelectionPlan,
	decodeHunkStageText,
	MAX_SELECTABLE_HUNKS,
} from "../../app/features/scm/hunk-stage";

describe("createHunkSelectionPlan", () => {
	it("returns two bounded immutable summaries for two independent changes", () => {
		const plan = createHunkSelectionPlan("one\ntwo\nthree", "ONE\ntwo\nTHREE");
		expect(plan.hitTimeout).toBe(false);
		expect(plan.totalHunkCount).toBe(2);
		expect(plan.truncated).toBe(false);
		expect(plan.hunks.map(({ index }) => index)).toEqual([0, 1]);
		expect(plan.hunks[0]?.label).toContain("Change 1");
		expect(plan.hunks[0]?.description).toBe("-1 +1");
		expect(plan.hunks[0]?.detail).toContain("one");
		expect(plan.hunks[0]?.detail).toContain("ONE");
		expect(plan.hunks.every(({ detail }) => detail.length <= 240)).toBe(true);
		expect(Object.isFrozen(plan)).toBe(true);
		expect(Object.isFrozen(plan.hunks)).toBe(true);
		expect(Object.isFrozen(plan.hunks[0])).toBe(true);
	});

	it("reports no selectable changes for identical content", () => {
		const plan = createHunkSelectionPlan("same", "same");
		expect(plan).toMatchObject({
			hunks: [],
			totalHunkCount: 0,
			truncated: false,
			hitTimeout: false,
		});
	});

	it("caps the visible selection list while retaining the real total", () => {
		const original: string[] = [];
		const modified: string[] = [];
		for (let index = 0; index < MAX_SELECTABLE_HUNKS + 10; index++) {
			original.push(`same-${index}`, `old-${index}`);
			modified.push(`same-${index}`, `new-${index}`);
		}
		const plan = createHunkSelectionPlan(
			original.join("\n"),
			modified.join("\n"),
		);
		expect(plan.totalHunkCount).toBe(MAX_SELECTABLE_HUNKS + 10);
		expect(plan.hunks).toHaveLength(MAX_SELECTABLE_HUNKS);
		expect(plan.truncated).toBe(true);
	});

	it("bounds very long source lines in the rendered detail", () => {
		const plan = createHunkSelectionPlan("a".repeat(2_000), "b".repeat(2_000));
		expect(plan.hunks[0]?.detail.length).toBeLessThanOrEqual(240);
	});
});

describe("computeContentAfterApplyingSelectedHunks", () => {
	const original = "one\ntwo\nthree";
	const modified = "ONE\ntwo\nTHREE";

	it("applies only the explicitly selected first hunk", () => {
		expect(
			computeContentAfterApplyingSelectedHunks(original, modified, [0]),
		).toBe("ONE\ntwo\nthree");
	});

	it("applies only the explicitly selected second hunk", () => {
		expect(
			computeContentAfterApplyingSelectedHunks(original, modified, [1]),
		).toBe("one\ntwo\nTHREE");
	});

	it("applies multiple selected hunks in one pass without shifted ranges", () => {
		expect(
			computeContentAfterApplyingSelectedHunks(original, modified, [0, 1]),
		).toBe(modified);
	});

	it("applies insertions and deletions selected across independent ranges", () => {
		const before = "one\ntwo\nthree\nfour";
		const after = "zero\none\ntwo\nfour\nfive";
		expect(
			computeContentAfterApplyingSelectedHunks(before, after, [0, 1, 2]),
		).toBe(after);
	});

	it("handles a brand-new file", () => {
		expect(
			computeContentAfterApplyingSelectedHunks("", "brand new content", [0]),
		).toBe("brand new content");
	});

	it.each([
		["empty", []],
		["duplicate", [0, 0]],
		["negative", [-1]],
		["out of range", [2]],
		["non-integer", [0.5]],
	])("refuses an %s selection", (_label, selection) => {
		expect(
			computeContentAfterApplyingSelectedHunks(
				original,
				modified,
				selection as number[],
			),
		).toBeUndefined();
	});

	it("returns undefined when the texts have no changed range", () => {
		expect(
			computeContentAfterApplyingSelectedHunks("same", "same", [0]),
		).toBeUndefined();
	});
});

describe("decodeHunkStageText", () => {
	it("refuses a UTF-8 BOM even though it could round-trip", () => {
		const bytes = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode("hello"),
		]);
		expect(decodeHunkStageText(bytes)).toBeUndefined();
	});

	it("refuses NUL-bearing valid UTF-8 as binary content", () => {
		expect(
			decodeHunkStageText(new Uint8Array([0x61, 0x00, 0x62])),
		).toBeUndefined();
	});

	it("refuses invalid UTF-8", () => {
		const bytes = new Uint8Array([...new TextEncoder().encode("Hell"), 0xe9]);
		expect(decodeHunkStageText(bytes)).toBeUndefined();
	});

	it("refuses a lone-surrogate WTF-8-style byte sequence", () => {
		expect(
			decodeHunkStageText(new Uint8Array([0xed, 0xa0, 0x80])),
		).toBeUndefined();
	});

	it("accepts valid ASCII and non-ASCII UTF-8 without a BOM", () => {
		expect(decodeHunkStageText(new TextEncoder().encode("hello"))).toBe(
			"hello",
		);
		expect(decodeHunkStageText(new TextEncoder().encode("café 😀"))).toBe(
			"café 😀",
		);
	});
});
