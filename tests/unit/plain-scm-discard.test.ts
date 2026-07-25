import { describe, expect, it, vi } from "vitest";

import {
	DISCARD_CONFIRM_PRIMARY_BUTTON,
	discardConfirmationDetail,
	discardConfirmationMessage,
	resolveDiscardConfirmation,
	type DiscardConfirmDialogService,
} from "../../app/features/scm/plain-scm-discard";

function fakeDialogService(confirmed: boolean): DiscardConfirmDialogService & {
	confirm: ReturnType<typeof vi.fn>;
} {
	return {
		confirm: vi.fn().mockResolvedValue({ confirmed }),
	};
}

describe("discardConfirmationMessage", () => {
	it("uses the singular, quoted-path form for exactly one path", () => {
		expect(discardConfirmationMessage(["a.txt"])).toBe(
			'Discard changes in "a.txt"?',
		);
	});

	it("uses the plural, count form for more than one path", () => {
		expect(discardConfirmationMessage(["a.txt", "b.txt"])).toBe(
			"Discard changes in 2 files?",
		);
	});
});

describe("discardConfirmationDetail", () => {
	it("names every path when there are 10 or fewer", () => {
		const detail = discardConfirmationDetail(["a.txt", "b.txt"]);
		expect(detail).toContain("• a.txt");
		expect(detail).toContain("• b.txt");
		expect(detail).toContain("cannot be undone");
		expect(detail).not.toContain("more");
	});

	it("names only the first 10 and summarizes the rest", () => {
		const paths = Array.from(
			{ length: 13 },
			(_unused, index) => `f${index}.txt`,
		);
		const detail = discardConfirmationDetail(paths);
		for (let index = 0; index < 10; index += 1) {
			expect(detail).toContain(`• f${index}.txt`);
		}
		expect(detail).not.toContain("f10.txt");
		expect(detail).toContain("…and 3 more");
	});
});

describe("resolveDiscardConfirmation", () => {
	it("is a no-op and never shows a dialog for an empty path list", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveDiscardConfirmation(dialogService, []);
		expect(decision).toEqual({ kind: "no-op" });
		expect(dialogService.confirm).not.toHaveBeenCalled();
	});

	it("returns confirmed and shows the impact preview when the dialog is accepted", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveDiscardConfirmation(dialogService, [
			"src/a.ts",
		]);
		expect(decision).toEqual({ kind: "confirmed" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
		const options = dialogService.confirm.mock.calls[0]![0] as {
			message: string;
			detail: string;
			primaryButton: string;
		};
		expect(options.message).toBe('Discard changes in "src/a.ts"?');
		expect(options.detail).toContain("• src/a.ts");
		expect(options.detail).toContain("cannot be undone");
		expect(options.primaryButton).toBe(DISCARD_CONFIRM_PRIMARY_BUTTON);
	});

	it("returns declined and performs no further action when the dialog is dismissed", async () => {
		const dialogService = fakeDialogService(false);
		const decision = await resolveDiscardConfirmation(dialogService, [
			"src/a.ts",
		]);
		expect(decision).toEqual({ kind: "declined" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});
});
