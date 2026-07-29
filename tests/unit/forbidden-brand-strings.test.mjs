import { describe, expect, it } from "vitest";

import {
	FORBIDDEN_BRAND_STRINGS,
	KNOWN_INERT_BRAND_STRINGS,
	findForbiddenBrandStrings,
} from "../../scripts/plain/forbidden-brand-strings.mjs";

describe("findForbiddenBrandStrings", () => {
	it("reports nothing against clean, Plain-branded bundle content", () => {
		expect(
			findForbiddenBrandStrings(
				'const nameShort = "Plain"; document.title = "Plain";',
			),
		).toEqual([]);
	});

	it("reports every forbidden brand string present, not just the first", () => {
		const haystack = FORBIDDEN_BRAND_STRINGS.map(
			(term) => `prefix-${term}-suffix`,
		).join(" | ");
		expect(findForbiddenBrandStrings(haystack)).toEqual(
			FORBIDDEN_BRAND_STRINGS,
		);
	});

	for (const term of FORBIDDEN_BRAND_STRINGS) {
		it(`catches a reintroduced literal ${JSON.stringify(term)}`, () => {
			expect(findForbiddenBrandStrings(`prefix ${term} suffix`)).toEqual([
				term,
			]);
		});
	}

	it("has no duplicate entries and at least one real, currently-enforced string", () => {
		expect(FORBIDDEN_BRAND_STRINGS.length).toBeGreaterThan(0);
		expect(new Set(FORBIDDEN_BRAND_STRINGS).size).toBe(
			FORBIDDEN_BRAND_STRINGS.length,
		);
	});

	// `F120` S7: every known-inert string is documented, real evidence, and
	// disjoint from the actively-enforced list -- a string cannot be both
	// "genuinely absent, zero-tolerance" and "known to already be present
	// and accepted" at the same time; if a future edit ever added the same
	// string to both lists it would be silently self-contradictory.
	it("keeps the known-inert documentation disjoint from the enforced list", () => {
		const inert = new Set(Object.keys(KNOWN_INERT_BRAND_STRINGS));
		for (const term of FORBIDDEN_BRAND_STRINGS) {
			expect(inert.has(term)).toBe(false);
		}
	});

	it("documents a non-empty reason for every known-inert string", () => {
		for (const [term, reason] of Object.entries(KNOWN_INERT_BRAND_STRINGS)) {
			expect(typeof term).toBe("string");
			expect(term.length).toBeGreaterThan(0);
			expect(typeof reason).toBe("string");
			expect(reason.length).toBeGreaterThan(0);
		}
	});
});
