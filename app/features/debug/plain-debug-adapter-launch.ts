/**
 * `F100` S1 debug adapter launch preparation — the orchestrator tying
 * `plain-debug-adapter-config.ts`'s pure config parsing/resolution together
 * with `plain-debug-adapter-confirmation.ts`'s confirmation gate.
 * `prepareDebugAdapterLaunch` is this codebase's **sole production caller**
 * of `resolveDebugAdapterConfirmation`
 * (`scripts/plain/boundary-contracts.mjs`'s
 * `validateDebugAdapterConfirmationBoundary` mechanically locks this).
 *
 * # Why this exists ahead of any debug UI
 *
 * S1 does not add a call-stack/variables/REPL view or a "start debugging"
 * button — those are S3/S4's job. This module exists now anyway, exactly
 * mirroring `src-tauri/src/debug/exec.rs`'s own S0/S1 precedent ("no
 * production caller exists yet in this slice" for `spawn_adapter`): a real,
 * shipped, non-test production function that a future UI entry point will
 * call, rather than a placeholder invented just to satisfy a contract. This
 * lets the confirmation gate's AST contract lock a genuine, exercised
 * production shape *now*, instead of waiting for S3/S4 to retrofit one.
 *
 * # This function never itself spawns or connects to anything
 *
 * `prepareDebugAdapterLaunch` resolves configuration and confirmation, then
 * hands back a ready-to-launch [`AdapterDescriptor`] — it never calls
 * `spawn_adapter`/`connect_adapter` (no Tauri command for that exists yet;
 * `src-tauri/src/debug/commands.rs`'s own module doc explains why). Actually
 * starting a session from this descriptor is S2's job.
 *
 * # `F210` S6 — a `"tcpSpawn"` descriptor is confirmed under the plain `"tcp"` identity
 *
 * `resolved.descriptor.transport === "tcpSpawn"` is confirmed under the
 * *same* `"tcp"` wire identity a plain `"tcp"` descriptor uses — never a
 * third, distinct confirmation identity — mirroring
 * `src-tauri/src/debug/exec.rs`'s `spawn_adapter_as_tcp_companion`, which
 * builds its own confirmation subject with `AdapterTransportKind::Tcp`,
 * never a `TcpSpawn` variant (`docs/research/2026-08-04-complete-debug.md`'s
 * "架构裁定 §6"). `spawnBeforeConnect`/`port` are passed to
 * `resolveDebugAdapterConfirmation` alongside that mapped subject purely so
 * the confirmation dialog's own copy can accurately say "spawn *and*
 * connect" instead of the plain `"tcp"` case's "connect only" wording — see
 * `debugAdapterConfirmationDetail`'s own doc comment.
 */

import { isKnownRemoteRootId } from "../remote/plain-remote-workspace-commands";
import {
	parseDebugAdapterRegistry,
	parseLaunchConfigurations,
	resolveAdapterDescriptor,
	type AdapterDescriptor,
} from "./plain-debug-adapter-config";
import {
	resolveDebugAdapterConfirmation,
	type DebugAdapterConfirmBridge,
	type DebugAdapterConfirmDialogService,
} from "./plain-debug-adapter-confirmation";

export type DebugAdapterLaunchPreparation =
	| Readonly<{
			kind: "ready";
			descriptor: AdapterDescriptor;
			configSource: string;
			warnings: readonly string[];
			launchArguments: Readonly<Record<string, unknown>>;
	  }>
	| Readonly<{ kind: "invalid-registry"; reason: string }>
	| Readonly<{ kind: "invalid-launch-configuration"; reason: string }>
	| Readonly<{ kind: "configuration-not-found"; name: string }>
	| Readonly<{ kind: "adapter-not-found"; type: string }>
	| Readonly<{ kind: "declined" }>;

/**
 * Parses both config files, resolves `configurationName` against
 * `.vscode/launch.json`'s `configurations` array, resolves that
 * configuration's adapter descriptor against the (optional)
 * `.plain/debug-adapters.json` registry, and — only once a descriptor has
 * been resolved — runs it through the confirmation gate. `registryBytes` is
 * `null` when `.plain/debug-adapters.json` does not exist in the workspace
 * (a `launch.json` entry with an inline `plainAdapter` override needs no
 * registry at all).
 */
export async function prepareDebugAdapterLaunch(
	bridge: DebugAdapterConfirmBridge,
	dialogService: DebugAdapterConfirmDialogService,
	registryBytes: Uint8Array | null,
	launchConfigurationBytes: Uint8Array,
	configurationName: string,
	rootId: string,
): Promise<DebugAdapterLaunchPreparation> {
	const registryResult =
		registryBytes === null
			? Object.freeze({ kind: "ok" as const, value: Object.freeze([]) })
			: parseDebugAdapterRegistry(registryBytes);
	if (registryResult.kind === "error") {
		return Object.freeze({
			kind: "invalid-registry",
			reason: registryResult.reason,
		});
	}
	const launchResult = parseLaunchConfigurations(launchConfigurationBytes);
	if (launchResult.kind === "error") {
		return Object.freeze({
			kind: "invalid-launch-configuration",
			reason: launchResult.reason,
		});
	}
	const configuration = launchResult.value.find(
		(candidate) => candidate.name === configurationName,
	);
	if (configuration === undefined) {
		return Object.freeze({
			kind: "configuration-not-found",
			name: configurationName,
		});
	}
	const resolved = resolveAdapterDescriptor(
		configuration,
		registryResult.value,
	);
	if (resolved.kind === "adapter-not-found") {
		return Object.freeze({ kind: "adapter-not-found", type: resolved.type });
	}
	const isSpawnThenConnect = resolved.descriptor.transport === "tcpSpawn";
	const isRemoteRoot = isKnownRemoteRootId(rootId);
	const decision = await resolveDebugAdapterConfirmation(
		bridge,
		dialogService,
		{
			subject: {
				command: resolved.descriptor.command,
				args: resolved.descriptor.args,
				transport: isSpawnThenConnect ? "tcp" : resolved.descriptor.transport,
			},
			rootId,
			isRemoteRoot,
			configSource: resolved.configSource,
			spawnBeforeConnect: isSpawnThenConnect,
			port: isSpawnThenConnect ? resolved.descriptor.port : undefined,
		},
	);
	if (decision.kind === "declined") {
		return Object.freeze({ kind: "declined" });
	}
	return Object.freeze({
		kind: "ready",
		descriptor: resolved.descriptor,
		configSource: resolved.configSource,
		warnings: resolved.warnings,
		launchArguments: configuration.launchArguments,
	});
}
