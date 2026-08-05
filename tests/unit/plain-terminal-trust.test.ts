import { describe, expect, it } from "vitest";

import {
	resolveTerminalTrust,
	TERMINAL_TRUST_CONFIRM_DETAIL,
	TERMINAL_TRUST_CONFIRM_MESSAGE,
	TERMINAL_TRUST_CONFIRM_PRIMARY_BUTTON,
	TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL,
	TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE,
	type TerminalTrustBridge,
	type TerminalTrustDialogService,
} from "../../app/features/terminal/plain-terminal-trust";

interface FakeDialogCall {
	readonly kind: "confirm" | "info";
	readonly message: string;
	readonly detail?: string;
	readonly primaryButton?: string;
}

function fakeBridge(
	overrides: Partial<TerminalTrustBridge> = {},
): TerminalTrustBridge & {
	readonly grantCalls: number;
} {
	let granted = false;
	let grantCalls = 0;
	return {
		async workspaceTrustState() {
			return { trusted: granted };
		},
		async workspaceTrustGrant() {
			granted = true;
			grantCalls += 1;
			return { trusted: true };
		},
		...overrides,
		get grantCalls() {
			return grantCalls;
		},
	};
}

function fakeDialogService(confirmed: boolean): {
	readonly service: TerminalTrustDialogService;
	readonly calls: FakeDialogCall[];
} {
	const calls: FakeDialogCall[] = [];
	const service: TerminalTrustDialogService = {
		async confirm(options) {
			calls.push({
				kind: "confirm",
				message: options.message,
				detail: options.detail,
				primaryButton: options.primaryButton,
			});
			return { confirmed };
		},
		async info(message, detail) {
			calls.push({ kind: "info", message, detail });
		},
	};
	return { service, calls };
}

describe("resolveTerminalTrust", () => {
	it("reports empty-workspace and shows an info dialog, without ever checking or granting trust", async () => {
		let stateCalls = 0;
		let grantCalls = 0;
		const bridge: TerminalTrustBridge = {
			async workspaceTrustState() {
				stateCalls += 1;
				return { trusted: false };
			},
			async workspaceTrustGrant() {
				grantCalls += 1;
				return { trusted: true };
			},
		};
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveTerminalTrust(bridge, service, true);

		expect(decision).toEqual({ kind: "empty-workspace" });
		expect(stateCalls).toBe(0);
		expect(grantCalls).toBe(0);
		expect(calls).toEqual([
			{
				kind: "info",
				message: TERMINAL_TRUST_EMPTY_WORKSPACE_MESSAGE,
				detail: TERMINAL_TRUST_EMPTY_WORKSPACE_DETAIL,
			},
		]);
	});

	it("reports trusted with no dialog at all when the workspace is already trusted", async () => {
		const bridge = fakeBridge({
			async workspaceTrustState() {
				return { trusted: true };
			},
		});
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveTerminalTrust(bridge, service, false);

		expect(decision).toEqual({ kind: "trusted" });
		expect(calls).toEqual([]);
		expect(bridge.grantCalls).toBe(0);
	});

	it("shows the risk confirm dialog and grants trust when the user confirms", async () => {
		const bridge = fakeBridge();
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveTerminalTrust(bridge, service, false);

		expect(decision).toEqual({ kind: "granted" });
		expect(bridge.grantCalls).toBe(1);
		expect(calls).toEqual([
			{
				kind: "confirm",
				message: TERMINAL_TRUST_CONFIRM_MESSAGE,
				detail: TERMINAL_TRUST_CONFIRM_DETAIL,
				primaryButton: TERMINAL_TRUST_CONFIRM_PRIMARY_BUTTON,
			},
		]);
	});

	it("reports declined and never grants trust when the user cancels the confirm dialog", async () => {
		const bridge = fakeBridge();
		const { service } = fakeDialogService(false);

		const decision = await resolveTerminalTrust(bridge, service, false);

		expect(decision).toEqual({ kind: "declined" });
		expect(bridge.grantCalls).toBe(0);
	});

	it("documents each external execution surface trust unlocks, per product-scope.md:53 and ADR 0003:27", () => {
		for (const term of [
			"hooks",
			"filters",
			"fsmonitor",
			"credential helper",
			"SSH",
		]) {
			expect(TERMINAL_TRUST_CONFIRM_DETAIL).toContain(term);
		}
	});
});
