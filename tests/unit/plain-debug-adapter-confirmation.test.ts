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

const FAKE_ROOT_ID = "00000000-0000-4000-8000-000000000001";

const STDIO_REQUEST: DebugAdapterConfirmationRequest = {
	subject: {
		command: "/usr/bin/python3",
		args: ["-m", "debugpy.adapter"],
		transport: "stdio",
	},
	rootId: FAKE_ROOT_ID,
	configSource: ".plain/debug-adapters.json",
};

const TCP_REQUEST: DebugAdapterConfirmationRequest = {
	subject: {
		command: "/usr/bin/lldb-dap",
		args: ["--tcp-server-port=0"],
		transport: "tcp",
	},
	rootId: FAKE_ROOT_ID,
	configSource: ".vscode/launch.json (inline plainAdapter override)",
};

// `F210` S6 — a spawn-then-connect confirmation still carries the plain
// `"tcp"` wire subject (see `plain-debug-adapter-launch.ts`'s own mapping),
// with `spawnBeforeConnect`/`port` as the extra, frontend-only presentation
// detail this module's own message/detail functions consult.
const TCP_SPAWN_REQUEST: DebugAdapterConfirmationRequest = {
	subject: {
		command: "/usr/bin/python3",
		args: ["-m", "debugpy.adapter", "--listen"],
		transport: "tcp",
	},
	rootId: FAKE_ROOT_ID,
	configSource: ".plain/debug-adapters.json",
	spawnBeforeConnect: true,
	port: 5678,
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

	// `F220` S7 — a real, visible fact distinguishing a remote-root
	// confirmation from a local one; absent entirely for the ordinary local
	// case (`isRemoteRoot` unset on every other fixture in this file).
	it("names the remote host when isRemoteRoot is set, and omits that notice entirely otherwise", () => {
		const localDetail = debugAdapterConfirmationDetail(STDIO_REQUEST);
		expect(localDetail).not.toContain("remote host");

		const remoteRequest: DebugAdapterConfirmationRequest = {
			...STDIO_REQUEST,
			isRemoteRoot: true,
		};
		const remoteDetail = debugAdapterConfirmationDetail(remoteRequest);
		expect(remoteDetail).toContain(
			"This command will run on the remote host for this workspace root, not on this machine.",
		);
		// The message (the dialog's short title) is deliberately unaffected —
		// only the detail body grows the extra notice, mirroring how
		// spawnBeforeConnect's own extra semantics are also detail-only for
		// everything except the loopback target itself.
		expect(debugAdapterConfirmationMessage(remoteRequest)).toBe(
			debugAdapterConfirmationMessage(STDIO_REQUEST),
		);
	});

	it("states the spawn-then-connect semantics (start command AND connect to the fixed loopback port) when spawnBeforeConnect is set", () => {
		const message = debugAdapterConfirmationMessage(TCP_SPAWN_REQUEST);
		expect(message).toContain("/usr/bin/python3");
		expect(message).toContain("127.0.0.1:5678");
		const detail = debugAdapterConfirmationDetail(TCP_SPAWN_REQUEST);
		expect(detail).toContain("/usr/bin/python3 -m debugpy.adapter --listen");
		expect(detail).toContain("127.0.0.1:5678");
		expect(detail).toContain(TCP_SPAWN_REQUEST.configSource);
	});

	it("falls back to the plain tcp copy when spawnBeforeConnect is set but port is missing", () => {
		const incomplete: DebugAdapterConfirmationRequest = {
			...TCP_REQUEST,
			spawnBeforeConnect: true,
		};
		expect(debugAdapterConfirmationMessage(incomplete)).toBe(
			debugAdapterConfirmationMessage(TCP_REQUEST),
		);
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
