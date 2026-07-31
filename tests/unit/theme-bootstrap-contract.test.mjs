import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const MAIN_SOURCE = await readFile(
	new URL("../../app/main.ts", import.meta.url),
	"utf8",
);

describe("real-renderer theme bootstrap contract", () => {
	it("waits for Workbench restoration before applying any startup theme axis", () => {
		const restoredWaits = [
			...MAIN_SOURCE.matchAll(
				/await\s*\(\s*await getService\(ILifecycleService\)\s*\)\.when\(\s*LifecyclePhase\.Restored\s*\);/g,
			),
		];
		expect(restoredWaits).toHaveLength(1);

		const restoredWaitIndex = restoredWaits[0].index;
		for (const call of [
			"await applyDefaultColorTheme(",
			"await applyDefaultFileIconTheme(",
			"await applyDefaultProductIconTheme(",
			"await applyPersistedThemeSelection(",
			"await applyPersistedFileIconThemeSelection(",
			"await applyPersistedProductIconThemeSelection(",
		]) {
			const callIndex = MAIN_SOURCE.indexOf(call);
			expect(callIndex, `${call} must remain in app/main.ts`).toBeGreaterThan(
				-1,
			);
			expect(
				callIndex,
				`${call} must run after LifecyclePhase.Restored`,
			).toBeGreaterThan(restoredWaitIndex);
		}
	});
});
