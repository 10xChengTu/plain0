import { describe, expect, it, vi } from "vitest";

import type { DebugStepInTarget } from "../../app/platform/tauri/contracts";
import {
	selectPlainStepInTarget,
	type PlainDebugStepInTargetPicker,
} from "../../app/features/debug/plain-debug-step-in-target-pick";

const TARGET_A: DebugStepInTarget = { id: 1, label: "quicksort(arr, lo, hi)" };
const TARGET_B: DebugStepInTarget = { id: 2, label: "partition(arr, lo, hi)" };

describe("selectPlainStepInTarget", () => {
	it("returns no target for an empty list without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(
			selectPlainStepInTarget([], false, pick),
		).resolves.toBeUndefined();
		expect(pick).not.toHaveBeenCalled();
	});

	it("automatically selects a sole target without invoking the picker", async () => {
		const pick = vi.fn();
		await expect(
			selectPlainStepInTarget([TARGET_A], false, pick),
		).resolves.toEqual(TARGET_A);
		expect(pick).not.toHaveBeenCalled();
	});

	it("requires an explicit multi-target choice and preserves cancellation", async () => {
		const targets = [TARGET_A, TARGET_B];
		const pickSecond = vi.fn<PlainDebugStepInTargetPicker>(
			async (items) => items[1],
		);
		await expect(
			selectPlainStepInTarget(targets, false, pickSecond),
		).resolves.toEqual(TARGET_B);
		expect(pickSecond.mock.calls[0]?.[0]).toEqual([
			{
				label: "quicksort(arr, lo, hi)",
				description: "#1",
				target: TARGET_A,
			},
			{
				label: "partition(arr, lo, hi)",
				description: "#2",
				target: TARGET_B,
			},
		]);
		expect(pickSecond.mock.calls[0]?.[1]).toEqual({ truncated: false });

		await expect(
			selectPlainStepInTarget(targets, false, async () => undefined),
		).resolves.toBeUndefined();
	});

	it("forwards the truncated flag to the picker's own context argument", async () => {
		const targets = [TARGET_A, TARGET_B];
		const pick = vi.fn<PlainDebugStepInTargetPicker>(async (items) => items[0]);
		await selectPlainStepInTarget(targets, true, pick);
		expect(pick.mock.calls[0]?.[1]).toEqual({ truncated: true });
	});
});
