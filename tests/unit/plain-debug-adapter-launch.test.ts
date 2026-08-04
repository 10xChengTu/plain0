import { describe, expect, it } from "vitest";

import { prepareDebugAdapterLaunch } from "../../app/features/debug/plain-debug-adapter-launch";
import type {
	DebugAdapterConfirmBridge,
	DebugAdapterConfirmDialogService,
} from "../../app/features/debug/plain-debug-adapter-confirmation";

function utf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function fakeBridge(
	initiallyConfirmed: boolean,
): DebugAdapterConfirmBridge & { readonly grantCalls: readonly unknown[] } {
	let confirmed = initiallyConfirmed;
	const grantCalls: unknown[] = [];
	return {
		async debugAdapterConfirmationState() {
			return { confirmed };
		},
		async debugAdapterConfirmationGrant(descriptor) {
			grantCalls.push(descriptor);
			confirmed = true;
		},
		get grantCalls() {
			return grantCalls;
		},
	};
}

function fakeDialogService(
	confirmed: boolean,
): DebugAdapterConfirmDialogService {
	return {
		async confirm() {
			return { confirmed };
		},
	};
}

const REGISTRY_BYTES = utf8(
	JSON.stringify([
		{
			type: "debugpy",
			transport: "stdio",
			command: "/usr/bin/python3",
			args: ["-m", "debugpy.adapter"],
		},
	]),
);

function launchBytes(configurations: readonly unknown[]): Uint8Array {
	return utf8(JSON.stringify({ configurations }));
}

describe("prepareDebugAdapterLaunch", () => {
	it("resolves via the registry and reports ready once already confirmed", async () => {
		const bridge = fakeBridge(true);
		const dialogService = fakeDialogService(true);
		const configurations = [
			{ type: "debugpy", request: "launch", name: "Run" },
		];

		const result = await prepareDebugAdapterLaunch(
			bridge,
			dialogService,
			REGISTRY_BYTES,
			launchBytes(configurations),
			"Run",
		);

		expect(result).toEqual({
			kind: "ready",
			descriptor: {
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter"],
				transport: "stdio",
			},
			configSource: ".plain/debug-adapters.json",
			warnings: [],
			launchArguments: {},
		});
		expect(bridge.grantCalls).toEqual([]);
	});

	it("shows the confirmation dialog when unconfirmed and reports ready once the user confirms", async () => {
		const bridge = fakeBridge(false);
		const dialogService = fakeDialogService(true);
		const configurations = [
			{ type: "debugpy", request: "launch", name: "Run" },
		];

		const result = await prepareDebugAdapterLaunch(
			bridge,
			dialogService,
			REGISTRY_BYTES,
			launchBytes(configurations),
			"Run",
		);

		expect(result.kind).toBe("ready");
		expect(bridge.grantCalls).toEqual([
			{
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter"],
				transport: "stdio",
			},
		]);
	});

	it("reports declined and never grants when the user dismisses the confirmation dialog", async () => {
		const bridge = fakeBridge(false);
		const dialogService = fakeDialogService(false);
		const configurations = [
			{ type: "debugpy", request: "launch", name: "Run" },
		];

		const result = await prepareDebugAdapterLaunch(
			bridge,
			dialogService,
			REGISTRY_BYTES,
			launchBytes(configurations),
			"Run",
		);

		expect(result).toEqual({ kind: "declined" });
		expect(bridge.grantCalls).toEqual([]);
	});

	it("resolves an inline plainAdapter override without needing a registry file", async () => {
		const bridge = fakeBridge(true);
		const dialogService = fakeDialogService(true);
		const configurations = [
			{
				type: "anything",
				request: "launch",
				name: "Run",
				plainAdapter: {
					transport: "stdio",
					command: "/usr/bin/override",
					args: [],
				},
			},
		];

		const result = await prepareDebugAdapterLaunch(
			bridge,
			dialogService,
			null,
			launchBytes(configurations),
			"Run",
		);

		expect(result).toEqual({
			kind: "ready",
			descriptor: {
				command: "/usr/bin/override",
				args: [],
				transport: "stdio",
			},
			configSource: ".vscode/launch.json (inline plainAdapter override)",
			warnings: [],
			launchArguments: {},
		});
	});

	it("reports invalid-registry for a malformed .plain/debug-adapters.json", async () => {
		const result = await prepareDebugAdapterLaunch(
			fakeBridge(true),
			fakeDialogService(true),
			utf8("not json"),
			launchBytes([{ type: "debugpy", request: "launch", name: "Run" }]),
			"Run",
		);
		expect(result.kind).toBe("invalid-registry");
	});

	it("reports invalid-launch-configuration for a malformed .vscode/launch.json", async () => {
		const result = await prepareDebugAdapterLaunch(
			fakeBridge(true),
			fakeDialogService(true),
			REGISTRY_BYTES,
			utf8("not json"),
			"Run",
		);
		expect(result.kind).toBe("invalid-launch-configuration");
	});

	it("reports configuration-not-found when no configuration matches the requested name", async () => {
		const result = await prepareDebugAdapterLaunch(
			fakeBridge(true),
			fakeDialogService(true),
			REGISTRY_BYTES,
			launchBytes([{ type: "debugpy", request: "launch", name: "Other" }]),
			"Run",
		);
		expect(result).toEqual({ kind: "configuration-not-found", name: "Run" });
	});

	it("reports adapter-not-found when the type has no registry entry (acceptance criterion 4)", async () => {
		const result = await prepareDebugAdapterLaunch(
			fakeBridge(true),
			fakeDialogService(true),
			REGISTRY_BYTES,
			launchBytes([{ type: "unknown-type", request: "launch", name: "Run" }]),
			"Run",
		);
		expect(result).toEqual({ kind: "adapter-not-found", type: "unknown-type" });
	});

	// -----------------------------------------------------------------
	// `F210` S6 — `"tcpSpawn"` descriptors are confirmed under the plain
	// `"tcp"` identity (never a third confirmation identity), with
	// `spawnBeforeConnect`/`port` passed alongside purely for dialog copy.
	// -----------------------------------------------------------------

	it("confirms a tcpSpawn descriptor under the tcp identity and reports it spawnBeforeConnect with its port", async () => {
		const bridge = fakeBridge(false);
		const confirmCalls: Array<{
			readonly message: string;
			readonly detail?: string;
		}> = [];
		const dialogService: DebugAdapterConfirmDialogService = {
			async confirm(dialogOptions) {
				confirmCalls.push(dialogOptions);
				return { confirmed: true };
			},
		};
		const configurations = [
			{
				type: "anything",
				request: "launch",
				name: "Run",
				plainAdapter: {
					transport: "tcpSpawn",
					command: "/usr/bin/python3",
					args: ["-m", "debugpy.adapter", "--listen"],
					port: 5678,
				},
			},
		];

		const result = await prepareDebugAdapterLaunch(
			bridge,
			dialogService,
			null,
			launchBytes(configurations),
			"Run",
		);

		expect(result).toEqual({
			kind: "ready",
			descriptor: {
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter", "--listen"],
				transport: "tcpSpawn",
				port: 5678,
			},
			configSource: ".vscode/launch.json (inline plainAdapter override)",
			warnings: [],
			launchArguments: {},
		});
		// The confirmation grant itself carries the plain "tcp" wire
		// identity — never a third "tcpSpawn" confirmation identity — see
		// `src-tauri/src/debug/exec.rs`'s `spawn_adapter_as_tcp_companion`
		// doc comment for the real Rust side of this same mapping.
		expect(bridge.grantCalls).toEqual([
			{
				command: "/usr/bin/python3",
				args: ["-m", "debugpy.adapter", "--listen"],
				transport: "tcp",
			},
		]);
		// The dialog shown to the user must accurately say "start <command>
		// and connect to 127.0.0.1:<port>" — not merely "run <command>",
		// which alone would understate what confirming actually authorizes.
		expect(confirmCalls).toHaveLength(1);
		expect(confirmCalls[0]?.message).toContain("127.0.0.1:5678");
		expect(confirmCalls[0]?.detail).toContain("127.0.0.1:5678");
	});

	it("treats a null registry as an empty registry rather than an error", async () => {
		const result = await prepareDebugAdapterLaunch(
			fakeBridge(true),
			fakeDialogService(true),
			null,
			launchBytes([{ type: "debugpy", request: "launch", name: "Run" }]),
			"Run",
		);
		expect(result).toEqual({ kind: "adapter-not-found", type: "debugpy" });
	});
});
