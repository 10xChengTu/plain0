import { describe, expect, it, vi } from "vitest";

import {
	NETWORK_CONFIRM_PRIMARY_BUTTON,
	networkConfirmationDetail,
	networkConfirmationMessage,
	REMOTE_NETWORK_DISABLED_TITLE,
	resolveNetworkConfirmation,
	type NetworkConfirmationPreview,
	type NetworkConfirmDialogService,
} from "../../app/features/scm/plain-scm-network";

function fakeDialogService(
	confirmed: boolean,
): NetworkConfirmDialogService & { confirm: ReturnType<typeof vi.fn> } {
	return {
		confirm: vi.fn().mockResolvedValue({ confirmed }),
	};
}

const inSyncPreview: NetworkConfirmationPreview = {
	upstream: "origin/main",
	ahead: 0,
	behind: 0,
};

const noUpstreamPreview: NetworkConfirmationPreview = {
	upstream: null,
	ahead: null,
	behind: null,
};

describe("networkConfirmationMessage", () => {
	it("names the upstream for fetch/pull/push", () => {
		expect(
			networkConfirmationMessage({ kind: "fetch", preview: inSyncPreview }),
		).toBe("Fetch from origin/main?");
		expect(
			networkConfirmationMessage({ kind: "pull", preview: inSyncPreview }),
		).toBe("Pull from origin/main?");
		expect(
			networkConfirmationMessage({ kind: "push", preview: inSyncPreview }),
		).toBe("Push to origin/main?");
	});

	it("uses distinct wording for forcePush", () => {
		expect(
			networkConfirmationMessage({ kind: "forcePush", preview: inSyncPreview }),
		).toBe("Force push to origin/main?");
	});

	it("falls back to a generic description when there is no upstream", () => {
		expect(
			networkConfirmationMessage({ kind: "fetch", preview: noUpstreamPreview }),
		).toBe("Fetch from the configured remote?");
	});
});

describe("networkConfirmationDetail", () => {
	it("reports the ahead/behind counts when available", () => {
		const detail = networkConfirmationDetail({
			kind: "push",
			preview: { upstream: "origin/main", ahead: 2, behind: 1 },
		});
		expect(detail).toBe("2 commit(s) ahead, 1 commit(s) behind.");
	});

	it("reports missing tracking information instead of null counts", () => {
		const detail = networkConfirmationDetail({
			kind: "fetch",
			preview: noUpstreamPreview,
		});
		expect(detail).toBe("No upstream tracking information is available yet.");
	});

	it("appends an irreversible-rewrite warning only for forcePush", () => {
		const pushDetail = networkConfirmationDetail({
			kind: "push",
			preview: inSyncPreview,
		});
		expect(pushDetail).not.toContain("cannot be undone");

		const forcePushDetail = networkConfirmationDetail({
			kind: "forcePush",
			preview: inSyncPreview,
		});
		expect(forcePushDetail).toContain("--force-with-lease");
		expect(forcePushDetail).toContain("cannot be undone");
	});
});

describe("resolveNetworkConfirmation", () => {
	it("always shows the dialog, even when ahead/behind are both zero", async () => {
		const dialogService = fakeDialogService(true);
		const decision = await resolveNetworkConfirmation(dialogService, {
			kind: "fetch",
			preview: inSyncPreview,
		});
		expect(decision).toEqual({ kind: "confirmed" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("returns declined and performs no further action when the dialog is dismissed", async () => {
		const dialogService = fakeDialogService(false);
		const decision = await resolveNetworkConfirmation(dialogService, {
			kind: "push",
			preview: inSyncPreview,
		});
		expect(decision).toEqual({ kind: "declined" });
		expect(dialogService.confirm).toHaveBeenCalledTimes(1);
	});

	it("uses forcePush's own primary button label, distinct from push's", async () => {
		const dialogService = fakeDialogService(true);
		await resolveNetworkConfirmation(dialogService, {
			kind: "forcePush",
			preview: inSyncPreview,
		});
		const options = dialogService.confirm.mock.calls[0]![0] as {
			primaryButton: string;
		};
		expect(options.primaryButton).toBe(
			NETWORK_CONFIRM_PRIMARY_BUTTON.forcePush,
		);
		expect(options.primaryButton).not.toBe(NETWORK_CONFIRM_PRIMARY_BUTTON.push);
	});
});

describe("F220 S6 REMOTE_NETWORK_DISABLED_TITLE", () => {
	it("is a non-empty, stable tooltip/notification string for a remote-backed root's disabled network controls", () => {
		expect(REMOTE_NETWORK_DISABLED_TITLE.length).toBeGreaterThan(0);
	});

	it("names fetch, pull, and push explicitly, so the disabled reason is unambiguous", () => {
		expect(REMOTE_NETWORK_DISABLED_TITLE).toContain("fetch");
		expect(REMOTE_NETWORK_DISABLED_TITLE).toContain("pull");
		expect(REMOTE_NETWORK_DISABLED_TITLE).toContain("push");
	});

	it("says the operation is unsupported for a remote repository, not merely unavailable right now (distinct from a transient-failure message)", () => {
		expect(REMOTE_NETWORK_DISABLED_TITLE.toLowerCase()).toContain("remote");
		expect(REMOTE_NETWORK_DISABLED_TITLE.toLowerCase()).toContain(
			"not supported",
		);
	});
});
