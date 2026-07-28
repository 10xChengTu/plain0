import { describe, expect, it } from "vitest";

import {
	debugAdapterCommandLine,
	debugAdapterConfirmationDetail,
	debugAdapterConfirmationMessage,
	DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON,
	resolveDebugAdapterConfirmation,
	type DebugAdapterConfirmBridge,
	type DebugAdapterConfirmDialogService,
	type DebugAdapterConfirmationRequest,
} from "../../app/features/debug/plain-debug-adapter-confirmation";

function fakeBridge(initiallyConfirmed: boolean): DebugAdapterConfirmBridge & {
	readonly stateCalls: number;
	readonly grantCalls: readonly unknown[];
} {
	let confirmed = initiallyConfirmed;
	let stateCalls = 0;
	const grantCalls: unknown[] = [];
	return {
		async debugAdapterConfirmationState() {
			stateCalls += 1;
			return { confirmed };
		},
		async debugAdapterConfirmationGrant(descriptor) {
			grantCalls.push(descriptor);
			confirmed = true;
		},
		get stateCalls() {
			return stateCalls;
		},
		get grantCalls() {
			return grantCalls;
		},
	};
}

function fakeDialogService(confirmed: boolean): {
	readonly service: DebugAdapterConfirmDialogService;
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

const STDIO_REQUEST: DebugAdapterConfirmationRequest = {
	subject: {
		command: "/usr/bin/python3",
		args: ["-m", "debugpy.adapter"],
		transport: "stdio",
	},
	configSource: ".plain/debug-adapters.json",
};

const TCP_REQUEST: DebugAdapterConfirmationRequest = {
	subject: {
		command: "/usr/bin/lldb-dap",
		args: ["--tcp-server-port=0"],
		transport: "tcp",
	},
	configSource: ".vscode/launch.json (inline plainAdapter override)",
};

describe("debugAdapterCommandLine", () => {
	it("joins command and args with a space, quoting only args containing whitespace", () => {
		expect(debugAdapterCommandLine(STDIO_REQUEST.subject)).toBe(
			"/usr/bin/python3 -m debugpy.adapter",
		);
		expect(
			debugAdapterCommandLine({
				command: "/usr/bin/tool",
				args: ["a value with spaces", "plain"],
				transport: "stdio",
			}),
		).toBe('/usr/bin/tool "a value with spaces" plain');
	});
});

describe("debugAdapterConfirmationMessage/Detail", () => {
	it("shows the full literal command line, transport and config source", () => {
		expect(debugAdapterConfirmationMessage(STDIO_REQUEST)).toContain(
			"/usr/bin/python3",
		);
		const detail = debugAdapterConfirmationDetail(STDIO_REQUEST);
		expect(detail).toContain("/usr/bin/python3 -m debugpy.adapter");
		expect(detail).toContain("stdio");
		expect(detail).toContain(".plain/debug-adapters.json");
	});

	it("labels the tcp transport distinctly from stdio", () => {
		const detail = debugAdapterConfirmationDetail(TCP_REQUEST);
		expect(detail).toContain("TCP");
		expect(detail).toContain(TCP_REQUEST.configSource);
	});
});

describe("resolveDebugAdapterConfirmation", () => {
	it("skips the dialog entirely when already confirmed", async () => {
		const bridge = fakeBridge(true);
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveDebugAdapterConfirmation(
			bridge,
			service,
			STDIO_REQUEST,
		);

		expect(decision).toEqual({ kind: "already-confirmed" });
		expect(bridge.stateCalls).toBe(1);
		expect(calls).toEqual([]);
		expect(bridge.grantCalls).toEqual([]);
	});

	it("always shows the dialog for an unconfirmed subject and grants on confirm", async () => {
		const bridge = fakeBridge(false);
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveDebugAdapterConfirmation(
			bridge,
			service,
			STDIO_REQUEST,
		);

		expect(decision).toEqual({ kind: "confirmed" });
		expect(calls).toEqual([
			{
				message: debugAdapterConfirmationMessage(STDIO_REQUEST),
				detail: debugAdapterConfirmationDetail(STDIO_REQUEST),
				primaryButton: DEBUG_ADAPTER_CONFIRM_PRIMARY_BUTTON,
			},
		]);
		expect(bridge.grantCalls).toEqual([STDIO_REQUEST.subject]);
	});

	it("reports declined and never grants when the user dismisses the dialog", async () => {
		const bridge = fakeBridge(false);
		const { service } = fakeDialogService(false);

		const decision = await resolveDebugAdapterConfirmation(
			bridge,
			service,
			STDIO_REQUEST,
		);

		expect(decision).toEqual({ kind: "declined" });
		expect(bridge.grantCalls).toEqual([]);
	});

	it("re-shows the dialog after a revoke — an unconfirmed state never skips it, regardless of history", async () => {
		let confirmed = true;
		const bridge: DebugAdapterConfirmBridge = {
			async debugAdapterConfirmationState() {
				return { confirmed };
			},
			async debugAdapterConfirmationGrant() {
				confirmed = true;
			},
		};
		// Simulate an external revoke between two resolution attempts.
		confirmed = false;
		const { service, calls } = fakeDialogService(true);

		const decision = await resolveDebugAdapterConfirmation(
			bridge,
			service,
			STDIO_REQUEST,
		);

		expect(decision).toEqual({ kind: "confirmed" });
		expect(calls).toHaveLength(1);
	});
});
