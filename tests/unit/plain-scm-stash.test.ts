import { describe, expect, it, vi } from "vitest";

import {
	STASH_CONFIRM_PRIMARY_BUTTON,
	resolveStashConfirmation,
	stashConfirmationDetail,
	stashConfirmationMessage,
	type StashConfirmDialogService,
} from "../../app/features/scm/plain-scm-stash";

function fakeDialogService(
	confirmed: boolean,
): StashConfirmDialogService & { confirm: ReturnType<typeof vi.fn> } {
	return {
		confirm: vi.fn().mockResolvedValue({ confirmed }),
	};
}

describe("stashConfirmationMessage", () => {
	it("names the entry label for pop", () => {
		expect(
			stashConfirmationMessage({
				kind: "pop",
				entryLabel: "#0 — fix login bug",
			}),
		).toBe("Pop stash #0 — fix login bug?");
	});

	it("names the entry label for drop", () => {
		expect(
			stashConfirmationMessage({
				kind: "drop",
				entryLabel: "#1 — wip",
			}),
		).toBe("Drop stash #1 — wip?");
	});
});

describe("stashConfirmationDetail", () => {
	it("mentions the conflict-retains-the-entry escape hatch for pop", () => {
		const detail = stashConfirmationDetail({
			kind: "pop",
			entryLabel: "#0 — fix login bug",
		});
		expect(detail).toContain("kept so you can resolve it manually");
		expect(detail).not.toContain("cannot be undone");
	});

	it("states plainly that drop is irreversible", () => {
		const detail = stashConfirmationDetail({
			kind: "drop",
			entryLabel: "#0 — fix login bug",
		});
		expect(detail).toContain("cannot be undone");
	});
});

describe("resolveStashConfirmation", () => {
	it("always shows the dialog for pop", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveStashConfirmation(dialogService, {
			kind: "pop",
			entryLabel: "#0 — fix login bug",
		});
		expect(decision).toEqual({ kind: "confirmed" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("always shows the dialog for drop", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveStashConfirmation(dialogService, {
			kind: "drop",
			entryLabel: "#0 — fix login bug",
		});
		expect(decision).toEqual({ kind: "confirmed" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("returns declined and performs no further action when the dialog is dismissed", async () => {
		const dialogService = fakeDialogService(false);
		const decision = await resolveStashConfirmation(dialogService, {
			kind: "drop",
			entryLabel: "#0 — fix login bug",
		});
		expect(decision).toEqual({ kind: "declined" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("uses drop's own primary button label, distinct from pop's", async () => {
		const dialogService = fakeDialogService(true);
		await resolveStashConfirmation(dialogService, {
			kind: "drop",
			entryLabel: "#0 — fix login bug",
		});
		const options = dialogService.confirm.mock.calls[0]![0] as {
			primaryButton: string;
		};
		expect(options.primaryButton).toBe(STASH_CONFIRM_PRIMARY_BUTTON.drop);
		expect(options.primaryButton).not.toBe(STASH_CONFIRM_PRIMARY_BUTTON.pop);
	});
});
