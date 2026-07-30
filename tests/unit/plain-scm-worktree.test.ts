import { describe, expect, it, vi } from "vitest";

import {
	WORKTREE_CONFIRM_PRIMARY_BUTTON,
	resolveWorktreeConfirmation,
	worktreeConfirmationDetail,
	worktreeConfirmationMessage,
	type WorktreeConfirmDialogService,
} from "../../app/features/scm/plain-scm-worktree";

function fakeDialogService(
	confirmed: boolean,
): WorktreeConfirmDialogService & { confirm: ReturnType<typeof vi.fn> } {
	return {
		confirm: vi.fn().mockResolvedValue({ confirmed }),
	};
}

describe("worktreeConfirmationMessage", () => {
	it("names the worktree label for removeDirty", () => {
		expect(
			worktreeConfirmationMessage({
				kind: "removeDirty",
				worktreeLabel: "feature-1 (/parent/linked)",
			}),
		).toBe('Force remove worktree at "feature-1 (/parent/linked)"?');
	});
});

describe("worktreeConfirmationDetail", () => {
	it("states plainly that a forced removal is irreversible", () => {
		const detail = worktreeConfirmationDetail({
			kind: "removeDirty",
			worktreeLabel: "feature-1 (/parent/linked)",
		});
		expect(detail).toContain("cannot be undone");
		expect(detail).toContain("modified or untracked files");
	});
});

describe("resolveWorktreeConfirmation", () => {
	it("always shows the dialog for removeDirty", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveWorktreeConfirmation(dialogService, {
			kind: "removeDirty",
			worktreeLabel: "feature-1 (/parent/linked)",
		});
		expect(decision).toEqual({ kind: "confirmed" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("returns declined and performs no further action when the dialog is dismissed", async () => {
		const dialogService = fakeDialogService(false);
		const decision = await resolveWorktreeConfirmation(dialogService, {
			kind: "removeDirty",
			worktreeLabel: "feature-1 (/parent/linked)",
		});
		expect(decision).toEqual({ kind: "declined" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("uses removeDirty's own primary button label", async () => {
		const dialogService = fakeDialogService(true);
		await resolveWorktreeConfirmation(dialogService, {
			kind: "removeDirty",
			worktreeLabel: "feature-1 (/parent/linked)",
		});
		const options = dialogService.confirm.mock.calls[0]![0] as {
			primaryButton: string;
		};
		expect(options.primaryButton).toBe(
			WORKTREE_CONFIRM_PRIMARY_BUTTON.removeDirty,
		);
	});
});
