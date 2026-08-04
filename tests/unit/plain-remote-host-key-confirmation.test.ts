import { describe, expect, it } from "vitest";

import type {
	RemoteSessionConnectResult,
	RemoteSessionEventPayload,
} from "../../app/platform/tauri/contracts";
import {
	REMOTE_HOST_KEY_CONFIRM_PRIMARY_BUTTON,
	remoteHostKeyConfirmationDetail,
	remoteHostKeyConfirmationMessage,
	remoteSessionEventNotification,
	resolveRemoteSessionConnect,
	type RemoteHostKeyConfirmBridge,
	type RemoteHostKeyConfirmDialogService,
} from "../../app/features/remote/plain-remote-host-key-confirmation";

const SESSION_ID = "00000000-0000-4000-8000-000000000101";
const FINGERPRINT = "SHA256:Nh0Me49Zh9fDw/VYUfq43IJmI1T+XrjiYONPND8GzaM";

function fakeBridge(options: {
	readonly connectResult: RemoteSessionConnectResult;
	readonly confirmResult?: RemoteSessionConnectResult;
}): RemoteHostKeyConfirmBridge & {
	readonly connectCalls: readonly (readonly [string, number, string])[];
	readonly confirmCalls: readonly (readonly [
		string,
		number,
		string,
		string,
		string,
	])[];
} {
	const connectCalls: (readonly [string, number, string])[] = [];
	const confirmCalls: (readonly [string, number, string, string, string])[] =
		[];
	return {
		async remoteSessionConnect(host, port, user) {
			connectCalls.push([host, port, user]);
			return options.connectResult;
		},
		async remoteHostKeyConfirm(host, port, user, algorithm, sha256Fingerprint) {
			confirmCalls.push([host, port, user, algorithm, sha256Fingerprint]);
			return (
				options.confirmResult ??
				(Object.freeze({
					status: "connected",
					sessionId: SESSION_ID,
				}) as RemoteSessionConnectResult)
			);
		},
		get connectCalls() {
			return connectCalls;
		},
		get confirmCalls() {
			return confirmCalls;
		},
	};
}

function fakeDialogService(confirmed: boolean): {
	readonly service: RemoteHostKeyConfirmDialogService;
	readonly calls: Array<{
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}>;
} {
	const calls: Array<{
		readonly message: string;
		readonly detail?: string;
		readonly primaryButton?: string;
	}> = [];
	return {
		service: {
			async confirm(options) {
				calls.push(options);
				return { confirmed };
			},
		},
		calls,
	};
}

describe("remoteHostKeyConfirmationMessage / remoteHostKeyConfirmationDetail", () => {
	it("names the host and port in the message", () => {
		expect(remoteHostKeyConfirmationMessage("example.com", 22)).toContain(
			"example.com:22",
		);
	});

	it("shows the full algorithm and fingerprint in the detail", () => {
		const detail = remoteHostKeyConfirmationDetail("example.com", 22, {
			algorithm: "ssh-ed25519",
			sha256Fingerprint: FINGERPRINT,
			knownHostsHit: false,
		});
		expect(detail).toContain("ssh-ed25519");
		expect(detail).toContain(FINGERPRINT);
		expect(detail).toContain("not present in your own ~/.ssh/known_hosts");
	});

	it("notes a real ~/.ssh/known_hosts hit distinctly from a miss", () => {
		const detail = remoteHostKeyConfirmationDetail("example.com", 22, {
			algorithm: "ssh-ed25519",
			sha256Fingerprint: FINGERPRINT,
			knownHostsHit: true,
		});
		expect(detail).toContain("also matches an entry in your own");
	});
});

describe("resolveRemoteSessionConnect", () => {
	it("returns connected without showing a dialog when already connected", async () => {
		const bridge = fakeBridge({
			connectResult: Object.freeze({
				status: "connected",
				sessionId: SESSION_ID,
			}),
		});
		const { service: dialogService, calls } = fakeDialogService(true);

		const decision = await resolveRemoteSessionConnect(
			bridge,
			dialogService,
			"example.com",
			22,
			"octocat",
		);

		expect(decision).toEqual({ kind: "connected", sessionId: SESSION_ID });
		expect(calls).toHaveLength(0);
		expect(bridge.confirmCalls).toHaveLength(0);
		expect(bridge.connectCalls).toEqual([["example.com", 22, "octocat"]]);
	});

	it("shows the dialog for an unknown host and pins+connects on accept", async () => {
		const bridge = fakeBridge({
			connectResult: Object.freeze({
				status: "hostKeyPendingConfirmation",
				algorithm: "ssh-ed25519",
				sha256Fingerprint: FINGERPRINT,
				knownHostsHit: false,
			}),
		});
		const { service: dialogService, calls } = fakeDialogService(true);

		const decision = await resolveRemoteSessionConnect(
			bridge,
			dialogService,
			"example.com",
			22,
			"octocat",
		);

		expect(decision).toEqual({ kind: "connected", sessionId: SESSION_ID });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.primaryButton).toBe(
			REMOTE_HOST_KEY_CONFIRM_PRIMARY_BUTTON,
		);
		expect(bridge.confirmCalls).toEqual([
			["example.com", 22, "octocat", "ssh-ed25519", FINGERPRINT],
		]);
	});

	it("declines and never calls confirm when the dialog is dismissed", async () => {
		const bridge = fakeBridge({
			connectResult: Object.freeze({
				status: "hostKeyPendingConfirmation",
				algorithm: "ssh-ed25519",
				sha256Fingerprint: FINGERPRINT,
				knownHostsHit: false,
			}),
		});
		const { service: dialogService } = fakeDialogService(false);

		const decision = await resolveRemoteSessionConnect(
			bridge,
			dialogService,
			"example.com",
			22,
			"octocat",
		);

		expect(decision).toEqual({ kind: "declined" });
		expect(bridge.confirmCalls).toHaveLength(0);
	});

	it("binds the confirm call to the exact fingerprint the pending response reported", async () => {
		const bridge = fakeBridge({
			connectResult: Object.freeze({
				status: "hostKeyPendingConfirmation",
				algorithm: "ecdsa-sha2-nistp256",
				sha256Fingerprint: "SHA256:distinct-fingerprint-value",
				knownHostsHit: true,
			}),
		});
		const { service: dialogService } = fakeDialogService(true);

		await resolveRemoteSessionConnect(
			bridge,
			dialogService,
			"example.com",
			22,
			"octocat",
		);

		expect(bridge.confirmCalls).toEqual([
			[
				"example.com",
				22,
				"octocat",
				"ecdsa-sha2-nistp256",
				"SHA256:distinct-fingerprint-value",
			],
		]);
	});

	it("propagates a thrown error from remoteSessionConnect (e.g. a changed host key) without ever showing the dialog", async () => {
		const bridge: RemoteHostKeyConfirmBridge = {
			async remoteSessionConnect() {
				throw Object.freeze({
					code: "REMOTE_HOST_KEY_CHANGED",
					message: "boom",
				});
			},
			async remoteHostKeyConfirm() {
				throw new Error("must not be called");
			},
		};
		const { service: dialogService, calls } = fakeDialogService(true);

		await expect(
			resolveRemoteSessionConnect(
				bridge,
				dialogService,
				"example.com",
				22,
				"octocat",
			),
		).rejects.toMatchObject({ code: "REMOTE_HOST_KEY_CHANGED" });
		expect(calls).toHaveLength(0);
	});
});

describe("remoteSessionEventNotification", () => {
	it("renders a connected event", () => {
		const event: RemoteSessionEventPayload = {
			event: "connected",
			sessionId: SESSION_ID,
			host: "example.com",
			port: 22,
			user: "octocat",
		};
		expect(remoteSessionEventNotification(event)).toBe(
			"Plain: connected to octocat@example.com:22.",
		);
	});

	it("renders a user-requested disconnect but not a window-closed one", () => {
		const base = {
			sessionId: SESSION_ID,
			host: "example.com",
			port: 22,
			user: "octocat",
		} as const;
		expect(
			remoteSessionEventNotification({
				event: "disconnected",
				...base,
				reason: "userRequested",
			}),
		).toBe("Plain: disconnected from octocat@example.com:22.");
		expect(
			remoteSessionEventNotification({
				event: "disconnected",
				...base,
				reason: "windowClosed",
			}),
		).toBeUndefined();
	});

	it("never includes a filesystem path", () => {
		const event: RemoteSessionEventPayload = {
			event: "connected",
			sessionId: SESSION_ID,
			host: "example.com",
			port: 22,
			user: "octocat",
		};
		expect(remoteSessionEventNotification(event)).not.toMatch(/[/\\]/);
	});
});
